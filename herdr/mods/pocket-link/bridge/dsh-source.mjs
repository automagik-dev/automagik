// The chat route's second source (#517): the Automagik Bots' own chats, read from the bots-dsh
// plugin over its read-only Unix socket, `<team home>/pocket/chat.sock` (bots-dsh
// src/host/pocket-socket.js). It sits beside the terminal engine: Claude, Codex and omp terminals
// keep the transcript > status > screen sources, untouched; a `dsh:<botId>` chat comes from here.
//
// Read only. A DSH chat can be listed, subscribed and paged. chat.answer, chat.sendHeld and
// chat.cancelHeld are refused (approvals and questions are answered on the computer), and so are
// chat.send and chat.interrupt until the owner decides otherwise; none of them reaches the socket,
// which accepts no write anyway. Plain Node only (no dependency, the bridge's Node floor).
//
// Absent is empty: no socket, a socket another account could reach, or one that does not say it
// is read-only, and the source lists nothing and opens nothing.
import { lstatSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { cutRow, page } from './chat.mjs'

export const PREFIX = 'dsh:'
export const ANSWER_ON_COMPUTER = 'Answer on the computer'
/** One answer at most, in milliseconds. */
export const REQUEST_MS = 5000
/** One line from the socket at most (a snapshot page is about 1 MiB); past it, the socket is dropped. */
export const MAX_LINE = 8 * 1024 * 1024

export const isDsh = (terminal) => typeof terminal === 'string' && terminal.startsWith(PREFIX)

const expand = (text) => (text === '~' ? homedir() : /^~[\\/]/.test(text) ? join(homedir(), text.slice(2)) : text)

/** The team's home as bots-dsh reads it (src/host/folders.js teamHomeOf). */
export function teamHome(env = process.env) {
  if (env.AUTOMAGIK_BOTS_HOME?.trim()) return resolve(expand(env.AUTOMAGIK_BOTS_HOME.trim()))
  const automagik = env.AUTOMAGIK_HOME?.trim() ? resolve(expand(env.AUTOMAGIK_HOME.trim())) : join(homedir(), '.automagik')
  return join(automagik, 'bots')
}

export const socketPath = (env = process.env) => join(teamHome(env), 'pocket', 'chat.sock')

/** A socket only this account reaches: a socket, owned by us, no group or other bits, in such a folder. */
export function ownerOnly(path, uid = process.getuid?.()) {
  try {
    const socket = lstatSync(path)
    const folder = lstatSync(dirname(path))
    const ours = (s) => uid === undefined || s.uid === uid
    return socket.isSocket() && folder.isDirectory() && (socket.mode & 0o077) === 0 && (folder.mode & 0o077) === 0 && ours(socket) && ours(folder)
  } catch {
    return false
  }
}

/** What the phone gets for a write on a DSH chat. */
export const refusedDsh = (id) => ({ state: 'refused', ok: false, reason: 'read-only', message: ANSWER_ON_COMPUTER, ...(id === undefined ? {} : { id }) })

const rowsCut = (e) => (Array.isArray(e?.rows) ? { ...e, rows: e.rows.map(cutRow) } : e)

export class DshSource {
  /** @param {{ path?: string, connect?: typeof createConnection, check?: (path: string) => boolean, log?: (...a: any[]) => void, requestMs?: number }} [options] */
  constructor({ path = socketPath(), connect = createConnection, check = ownerOnly, log = () => {}, requestMs = REQUEST_MS } = {}) {
    Object.assign(this, { path, connect, check, log, requestMs })
    this.socket = null
    this.opening = null
    this.pending = new Map()
    /** channel -> { listener, status, approval } */
    this.subs = new Map()
    this.nextId = 1
    this.nextChannel = 1
  }

  /** The socket, connected and greeted, or null when the source is absent. */
  open() {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket)
    if (this.opening) return this.opening
    if (!this.check(this.path)) return Promise.resolve(null)
    this.opening = new Promise((done) => {
      const socket = this.connect(this.path)
      let buffer = ''
      const fail = () => { socket.destroy(); done(null) }
      socket.setEncoding('utf8')
      socket.once('error', fail)
      socket.on('data', (chunk) => {
        buffer += chunk
        if (buffer.length > MAX_LINE && !buffer.includes('\n')) { socket.destroy(); return }
        let at
        while ((at = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, at)
          buffer = buffer.slice(at + 1)
          let m
          try { m = JSON.parse(line) } catch { socket.destroy(); return }
          this.onMessage(m)
        }
      })
      socket.on('close', () => this.onClose(socket))
      socket.once('connect', () => {
        this.socket = socket
        this.ask('hello').then((hello) => {
          if (hello?.protocol !== 1 || hello?.readOnly !== true) { this.log('chat: the DSH socket is not the read-only one; not used'); fail(); return }
          socket.off('error', fail)
          socket.on('error', () => {})
          done(socket)
        }, fail)
      })
    }).finally(() => { this.opening = null })
    return this.opening
  }

  ask(method, params) {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.reject(Object.assign(new Error('closed'), { kind: 'unavailable' }))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('timeout'), { kind: 'timeout' })) }, this.requestMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      socket.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async request(method, params) {
    if (!(await this.open())) throw Object.assign(new Error('absent'), { kind: 'unavailable' })
    return this.ask(method, params)
  }

  onMessage(m) {
    if (m && Object.hasOwn(m, 'id') && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.error) p.reject(Object.assign(new Error(String(m.error.message ?? m.error.kind)), { kind: m.error.kind }))
      else p.resolve(m.result)
      return
    }
    const sub = Number.isSafeInteger(m?.channel) ? this.subs.get(m.channel) : null
    if (!sub || !m.event || typeof m.event.type !== 'string') return
    const e = rowsCut(m.event)
    if (e.type === 'snapshot' || e.type === 'status') sub.status = e.status ?? sub.status
    if (e.type === 'snapshot' || e.type === 'approval') sub.approval = e.type === 'snapshot' ? e.approval : (e.row?.open === false ? null : e.row)
    try { sub.listener(e) } catch {}
  }

  onClose(socket) {
    if (this.socket === socket) this.socket = null
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Object.assign(new Error('closed'), { kind: 'unavailable' })) }
    this.pending.clear()
    for (const sub of this.subs.values()) { try { sub.listener({ type: 'gone', reason: 'unavailable' }) } catch {} }
    this.subs.clear()
  }

  /** The DSH chats, as chat.list rows; [] when the source is absent. */
  async list() {
    try {
      const result = await this.request('list')
      return (Array.isArray(result?.terminals) ? result.terminals : []).filter((t) => isDsh(t?.terminal))
    } catch {
      return []
    }
  }

  /**
   * A subscription handle in the engine's shape. The snapshot comes from the socket, so the route
   * calls start(after) instead of building one (`streamsSnapshot`).
   */
  watch(terminal, _client, listener) {
    const channel = this.nextChannel++
    const sub = { listener, status: null, approval: null }
    return {
      streamsSnapshot: true,
      start: (after) => {
        this.subs.set(channel, sub)
        this.request('subscribe', { terminal, channel, ...(typeof after === 'string' ? { after } : {}) }).catch((error) => {
          if (!this.subs.delete(channel)) return
          try { listener({ type: 'gone', reason: error.kind ?? 'unavailable' }) } catch {}
        })
      },
      rows: () => null,
      screen: () => [],
      status: () => sub.status,
      approval: () => sub.approval,
      held: () => [],
      backfill: async (before, limit) => {
        const result = await this.request('backfill', { channel, before, limit })
        return page(Array.isArray(result?.rows) ? result.rows : [])
      },
      close: () => {
        if (this.subs.delete(channel)) this.ask('unsubscribe', { channel }).catch(() => {})
      },
    }
  }

  close() { this.socket?.destroy() }
}

/**
 * The route's engine with the DSH chats beside the terminal ones: listed after them, opened by
 * their `dsh:` id, every write on them refused before anything is called.
 */
export function withDsh(engine, dsh) {
  if (!dsh) return engine
  return {
    ready: () => engine.ready(),
    async list() {
      const [terminals, bots] = await Promise.all([engine.list(), dsh.list().catch(() => [])])
      return [...terminals, ...bots]
    },
    watch: (terminal, client, listener) => (isDsh(terminal) ? dsh.watch(terminal, client, listener) : engine.watch(terminal, client, listener)),
    send: (client, terminal, m) => (isDsh(terminal) ? refusedDsh(m?.id) : engine.send(client, terminal, m)),
    sendHeld: (client, terminal, m) => (isDsh(terminal) ? refusedDsh(m?.id) : engine.sendHeld(client, terminal, m)),
    cancelHeld: (client, terminal, m) => (isDsh(terminal) ? refusedDsh(m?.id) : engine.cancelHeld(client, terminal, m)),
    answer: (client, terminal, a) => (isDsh(terminal) ? refusedDsh() : engine.answer(client, terminal, a)),
    interrupt: (client, terminal) => (isDsh(terminal) ? refusedDsh() : engine.interrupt(client, terminal)),
  }
}
