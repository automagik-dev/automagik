// The guest half of the CDP tunnel (RFC 0016, "The Bot browser"). Electron answers a Bot's
// browser-endpoint request with its relay's URL, ws://127.0.0.1:<relay port>/devtools/browser/
// <token>, which names Windows' loopback, not the container's. The launcher listens on the
// container's 127.0.0.1 instead, hands DSH the same URL on its own port, and carries each
// connection to it over the framed stdio as a `tunnel`: Electron connects to the relay from
// Windows' 127.0.0.1, so the relay's checks (a loopback peer, no Origin, the Bot's token) hold.
// The token is never read here: it only passes through, inside the bytes.
import { createServer } from 'node:net'
import { MAX_CHUNK, MAX_CHUNK_BASE64 } from './frame.mjs'

export const MAX_TUNNELS = 64
// What Electron may send ahead of a socket that does not read: past this the tunnel closes.
export const MAX_BUFFERED = 8 * 1024 * 1024
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * The tunnels of one launcher. `writer` is its FrameWriter; `log(level, text)` its log.
 * `endpoint(url)` makes (or reuses) the listener for the loopback address `url` names and
 * answers `url` on that listener's port; `receive(frame)` takes Electron's `tunnel` frames.
 */
export class Tunnels {
  #writer
  #log
  #listeners = new Map()
  #sockets = new Map()
  #next = 0
  #closed = false
  constructor({ writer, log = () => {} }) {
    this.#writer = writer
    this.#log = log
    writer.onDrain(() => { for (const { socket } of this.#sockets.values()) socket.resume() })
  }

  get count() { return this.#sockets.size }

  /** `url` rewritten to a guest listener when it names a loopback ws:/http: port; else as it is. */
  async endpoint(url) {
    let parsed
    try { parsed = new URL(url) } catch { return url }
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname)) return url
    const port = Number(parsed.port || (parsed.protocol === 'ws:' || parsed.protocol === 'http:' ? 80 : 443))
    const listener = await this.#listenerFor(port)
    parsed.hostname = '127.0.0.1'
    parsed.port = String(listener.address().port)
    return parsed.href
  }

  #listenerFor(port) {
    if (this.#closed) return Promise.reject(new Error('the launcher is stopping'))
    const known = this.#listeners.get(port)
    if (known) return known
    const server = createServer(socket => this.#open(socket, port))
    const ready = new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve(server)
      })
    })
    this.#listeners.set(port, ready)
    ready.catch(() => this.#listeners.delete(port))
    return ready
  }

  #open(socket, port) {
    if (this.#closed || this.#sockets.size >= MAX_TUNNELS) {
      this.#log('warn', `tunnel refused: ${this.#closed ? 'stopping' : `${MAX_TUNNELS} already open`}`)
      socket.destroy()
      return
    }
    const id = ++this.#next
    const entry = { socket, port, closed: false }
    this.#sockets.set(id, entry)
    this.#send({ type: 'tunnel', op: 'open', id, host: '127.0.0.1', port })
    socket.on('data', (chunk) => {
      for (let at = 0; at < chunk.length; at += MAX_CHUNK) {
        const piece = chunk.subarray(at, at + MAX_CHUNK)
        if (this.#send({ type: 'tunnel', op: 'data', id, data: piece.toString('base64') }) === false) socket.pause()
      }
    })
    socket.on('end', () => { if (!entry.closed) this.#send({ type: 'tunnel', op: 'end', id }) })
    socket.on('error', () => {})
    socket.on('close', () => this.#forget(id, null))
  }

  // Sends a frame; a launcher whose stdout is gone tunnels nothing more.
  #send(frame) {
    try {
      return this.#writer.send(frame)
    } catch (error) {
      this.#log('error', `tunnel frame not sent: ${error.message}`)
      return true
    }
  }

  // Closes tunnel `id` once, telling Electron unless Electron closed it.
  #forget(id, error, { tell = true } = {}) {
    const entry = this.#sockets.get(id)
    if (!entry) return
    this.#sockets.delete(id)
    entry.closed = true
    entry.socket.destroy()
    if (tell) this.#send({ type: 'tunnel', op: 'close', id, ...(error ? { error } : {}) })
  }

  /** One `tunnel` frame from Electron: `data` (base64), `end` (half-close) or `close`. */
  receive(frame) {
    const { id, op } = frame
    const entry = this.#sockets.get(id)
    if (!entry) {
      // Electron may still be sending for a tunnel that closed here: it hears once more that it is.
      if (op === 'data' || op === 'end') this.#send({ type: 'tunnel', op: 'close', id, error: 'no such tunnel' })
      return
    }
    if (op === 'close') return this.#forget(id, null, { tell: false })
    if (op === 'end') return void entry.socket.end()
    if (op !== 'data') return this.#forget(id, `unknown tunnel op ${JSON.stringify(op)}`)
    if (typeof frame.data !== 'string' || frame.data.length > MAX_CHUNK_BASE64 || !BASE64.test(frame.data)) {
      return this.#forget(id, 'tunnel data is not base64 of at most 48 KiB')
    }
    entry.socket.write(Buffer.from(frame.data, 'base64'))
    if (entry.socket.writableLength > MAX_BUFFERED) this.#forget(id, 'the guest socket does not read')
  }

  /** Every tunnel and listener closes; Electron is not told (the launcher is going). */
  async close() {
    this.#closed = true
    for (const id of [...this.#sockets.keys()]) this.#forget(id, null, { tell: false })
    const servers = await Promise.allSettled([...this.#listeners.values()])
    this.#listeners.clear()
    await Promise.all(servers.filter(result => result.status === 'fulfilled').map(({ value }) => new Promise(done => value.close(() => done()))))
  }
}
