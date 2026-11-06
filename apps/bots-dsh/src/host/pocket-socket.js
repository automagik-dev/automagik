// The read-only local socket Pocket Link reads the team's Bot chats from (#517). A Unix domain
// socket in the team's home, `<team home>/pocket/chat.sock`: the folder is 0700 and the socket
// 0600, so only the person's own account reaches it. Never a TCP port, never on Windows.
//
// Wire: one JSON object per line each way. Requests `{ id, method, params }`; answers
// `{ id, result }` or `{ id, error: { kind, message } }`; chat events `{ channel, event }` on the
// channel the client named in its subscribe. Methods: hello, list, subscribe {terminal, channel,
// after?}, unsubscribe {channel}, backfill {channel, before, limit?}. Every other method, every
// write among them, is answered `read-only`: the socket accepts no writes.
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { join } from 'node:path'

export const SOCKET_DIR = 'pocket'
export const SOCKET_NAME = 'chat.sock'
export const DIR_MODE = 0o700
export const SOCKET_MODE = 0o600
export const PROTOCOL = 1
export const METHODS = Object.freeze(['hello', 'list', 'subscribe', 'unsubscribe', 'backfill'])
/** One request line at most (a request is small); past it the connection ends. */
export const MAX_LINE = 64 * 1024
export const MAX_CONNECTIONS = 4
export const MAX_SUBSCRIPTIONS = 8
/** Bytes written and not yet taken by the reader; past it the connection ends. */
export const MAX_UNSENT = 4 * 1024 * 1024

export const socketPathOf = home => join(home, SOCKET_DIR, SOCKET_NAME)

const readOnly = id => ({ id, error: { kind: 'read-only', message: 'This socket only reads; answer on the computer.' } })

/** Whether something answers on `path` (another host serving the same team). */
function answers(path) {
  return new Promise((resolve) => {
    const probe = createConnection(path)
    probe.once('connect', () => { probe.destroy(); resolve(true) })
    probe.once('error', () => resolve(false))
  })
}

/**
 * Serve `source` (a pocket-chat.js DshChatSource) on the team home's socket.
 * @param {{ home: string, source: any, log?: (...args: any[]) => void }} options
 * @returns {Promise<{ path: string, close(): Promise<void> }>}
 */
export async function startPocketSocket({ home, source, log = () => {} }) {
  const dir = join(home, SOCKET_DIR)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  const folder = await lstat(dir)
  if (!folder.isDirectory()) throw new Error('the Pocket socket folder is not a folder')
  await chmod(dir, DIR_MODE)
  const path = socketPathOf(home)
  const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (existing) {
    if (!existing.isSocket()) throw new Error('something that is not a socket is at the Pocket socket path')
    if (await answers(path)) throw new Error('another host already serves this team to Pocket')
    await unlink(path)
  }
  const connections = new Set()
  const server = createServer(socket => {
    if (connections.size >= MAX_CONNECTIONS) { socket.destroy(); return }
    const connection = serve(socket, source, log)
    connections.add(connection)
    socket.once('close', () => { connections.delete(connection); connection.close() })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => { server.off('error', reject); resolve() })
  })
  // The folder is already 0700, so nobody else could reach the socket before this.
  await chmod(path, SOCKET_MODE)
  return {
    path,
    async close() {
      for (const connection of connections) connection.end()
      await new Promise(resolve => server.close(() => resolve()))
      await unlink(path).catch(() => {})
    },
  }
}

/** One reader of the socket. */
function serve(socket, source, log) {
  let buffer = ''
  let closed = false
  /** channel -> handle (or a pending marker while its watch opens) */
  const subs = new Map()
  const write = (message) => {
    if (closed || socket.destroyed) return
    if (socket.writableLength > MAX_UNSENT) { end(); return }
    socket.write(`${JSON.stringify(message)}\n`)
  }
  const close = () => {
    if (closed) return
    closed = true
    for (const handle of subs.values()) handle?.close?.()
    subs.clear()
  }
  const end = () => { close(); socket.destroy() }

  async function request(message) {
    const id = message?.id ?? null
    const params = message?.params && typeof message.params === 'object' ? message.params : {}
    switch (message?.method) {
      case 'hello':
        return { id, result: { protocol: PROTOCOL, readOnly: true, methods: METHODS } }
      case 'list':
        return { id, result: { terminals: await source.list() } }
      case 'subscribe': {
        const { terminal, channel, after } = params
        if (typeof terminal !== 'string' || !Number.isSafeInteger(channel) || channel <= 0) return { id, error: { kind: 'invalid_params', message: 'terminal, channel' } }
        if (subs.has(channel)) return { id, error: { kind: 'invalid_params', message: 'channel in use' } }
        if (subs.size >= MAX_SUBSCRIPTIONS) return { id, error: { kind: 'too_many', message: `at most ${MAX_SUBSCRIPTIONS} subscriptions` } }
        subs.set(channel, null)
        const handle = await source.watch(terminal, event => write({ channel, event }), { after: typeof after === 'string' ? after : undefined })
        if (!handle.ok) { subs.delete(channel); return { id, error: { kind: handle.reason, message: handle.reason } } }
        if (closed || !subs.has(channel)) { handle.close(); return { id, error: { kind: 'closed', message: 'closed' } } }
        subs.set(channel, handle)
        return { id, result: { channel } }
      }
      case 'unsubscribe': {
        const handle = subs.get(params.channel)
        subs.delete(params.channel)
        handle?.close()
        return { id, result: {} }
      }
      case 'backfill': {
        const handle = subs.get(params.channel)
        if (!handle) return { id, error: { kind: 'not_watching', message: 'not_watching' } }
        if (typeof params.before !== 'string') return { id, error: { kind: 'invalid_params', message: 'before' } }
        return { id, result: { rows: await handle.backfill(params.before, params.limit) } }
      }
      default:
        return readOnly(id)
    }
  }

  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    if (buffer.length > MAX_LINE && !buffer.includes('\n')) { end(); return }
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (line.length > MAX_LINE) { end(); return }
      if (!line.trim()) continue
      let message
      try { message = JSON.parse(line) } catch { end(); return }
      request(message).then(write, (error) => {
        log('pocket chat: %s', error?.message ?? error)
        write({ id: message?.id ?? null, error: { kind: 'failed', message: 'failed' } })
      })
    }
  })
  socket.on('error', () => close())
  return { close, end: () => socket.end() }
}
