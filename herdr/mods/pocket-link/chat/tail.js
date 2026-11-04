// Following a transcript as the agent writes it (RFC 0015, "Tailing"). Ours.
//   LocalTail: this computer. fs.watch plus a one-second poll (the poll is what counts; watch only
//   wakes it sooner), reading from the last byte offset, holding a partial last line until its
//   newline. A file that shrinks or is replaced starts again from line 1 (onReset).
//   RemoteTail: another machine, through `file.read` with a line `offset`, every 2 s while the
//   agent works and every 10 s when idle, paging by `limit`. `on` is fixed at construction (the
//   caller takes it from the terminal's address) and no `cwd` is ever sent, so a home-relative
//   path is read from that machine's home.
// Both hand over complete lines as { n, text } (n counts from 1; text is null for a line too long
// to keep) and never log a line's text.
import { open, stat } from 'node:fs/promises'
import { watch as fsWatch } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/** A line longer than this is counted but not kept (text: null). */
export const MAX_LINE = 16 * 1024 * 1024
const CHUNK = 1024 * 1024
const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval }

export class LocalTail {
  /**
   * @param {string} path  a path the folder rule accepted
   * @param {{ onLines(lines: { n: number, text: string | null }[]): void, onReset?(): void,
   *   onError?(e: Error): void, pollMs?: number, watch?: typeof fsWatch | null, timers?: typeof realTimers }} options
   */
  constructor(path, { onLines, onReset = () => {}, onError = () => {}, pollMs = 1000, watch = fsWatch, timers = realTimers }) {
    Object.assign(this, { path, onLines, onReset, onError, pollMs, watchFn: watch, timers })
    this.fh = null
    this.ino = null
    this.offset = 0
    this.line = 0
    this.partial = ''
    this.skipping = false
    this.decoder = new StringDecoder('utf8')
    this.busy = null
    this.again = false
    this.stopped = false
  }

  start() {
    this.timer = this.timers.setInterval(() => { this.tick() }, this.pollMs)
    this.timer.unref?.()
    try {
      this.watcher = this.watchFn?.(this.path, () => { this.tick() })
      this.watcher?.on?.('error', () => {})
    } catch {}
    return this.tick()
  }

  stop() {
    this.stopped = true
    this.timers.clearInterval(this.timer)
    try { this.watcher?.close() } catch {}
    const fh = this.fh
    this.fh = null
    return (this.busy ?? Promise.resolve()).then(() => fh?.close()).catch(() => {})
  }

  /** Read whatever is new. Concurrent calls collapse into one more pass. */
  tick() {
    if (this.stopped) return Promise.resolve()
    if (this.busy) { this.again = true; return this.busy }
    this.busy = (async () => {
      do {
        this.again = false
        try { await this.readNew() } catch (e) { this.onError(e) }
      } while (this.again && !this.stopped)
    })().finally(() => { this.busy = null })
    return this.busy
  }

  async reset() {
    try { await this.fh?.close() } catch {}
    this.fh = null
    Object.assign(this, { offset: 0, line: 0, partial: '', skipping: false, decoder: new StringDecoder('utf8') })
    this.onReset()
  }

  async readNew() {
    let onDisk
    try { onDisk = await stat(this.path) } catch { return } // gone for now: keep what was read
    if (this.fh && (onDisk.ino !== this.ino || onDisk.size < this.offset)) await this.reset()
    if (!this.fh) {
      this.fh = await open(this.path, 'r')
      this.ino = (await this.fh.stat()).ino
    }
    const buf = Buffer.alloc(CHUNK)
    for (;;) {
      if (this.stopped) return
      const { bytesRead } = await this.fh.read(buf, 0, CHUNK, this.offset)
      if (bytesRead === 0) return
      this.offset += bytesRead
      this.take(this.decoder.write(buf.subarray(0, bytesRead)))
    }
  }

  /** Split decoded text into complete lines; keep the rest as the partial last line. */
  take(text) {
    const out = []
    let from = 0
    let at
    while ((at = text.indexOf('\n', from)) !== -1) {
      const piece = text.slice(from, at)
      from = at + 1
      this.line += 1
      if (this.skipping) { this.skipping = false; this.partial = ''; out.push({ n: this.line, text: null }); continue }
      const whole = (this.partial + piece).replace(/\r$/, '')
      this.partial = ''
      out.push({ n: this.line, text: whole })
    }
    const rest = text.slice(from)
    if (!this.skipping) {
      this.partial += rest
      if (this.partial.length > MAX_LINE) { this.skipping = true; this.partial = '' }
    }
    if (out.length) this.onLines(out)
  }
}

export class RemoteTail {
  /**
   * @param {{ hc: { call(m: string, p: object): Promise<any> }, on: string, path: string,
   *   onLines(lines: { n: number, text: string | null }[]): void, onReset?(): void, onError?(e: Error): void,
   *   working?(): boolean, page?: number, workingMs?: number, idleMs?: number, timers?: typeof realTimers }} options
   */
  constructor({ hc, on, path, onLines, onReset = () => {}, onError = () => {}, working = () => false, page = 2000, workingMs = 2000, idleMs = 10_000, timers = realTimers }) {
    Object.assign(this, { hc, on, path, onLines, onReset, onError, working, page, workingMs, idleMs, timers })
    this.next = 1
    this.stopped = false
    this.busy = null
  }

  start() { return this.tick() }

  stop() {
    this.stopped = true
    this.timers.clearTimeout(this.timer)
    return this.busy ?? Promise.resolve()
  }

  /** Read now (also wakes the next poll early, as on a status change). */
  tick() {
    if (this.stopped) return Promise.resolve()
    if (this.busy) return this.busy
    this.timers.clearTimeout(this.timer)
    this.busy = this.readPages().finally(() => {
      this.busy = null
      if (this.stopped) return
      this.timer = this.timers.setTimeout(() => { this.tick() }, this.working() ? this.workingMs : this.idleMs)
      this.timer.unref?.()
    })
    return this.busy
  }

  async readPages() {
    for (;;) {
      if (this.stopped) return
      let r
      try {
        // Never a cwd: the path is home-relative and `on` is the terminal's own machine.
        r = await this.hc.call('file.read', { path: this.path, on: this.on, offset: this.next, limit: this.page })
      } catch (e) { this.onError(e); return }
      if (r.lines < this.next - 1) { this.next = 1; this.onReset(); continue }
      if (r.last < r.first) {
        // Nothing given although the file has more: one line past the 8 MB a read gives.
        if (r.lines >= this.next) { this.onLines([{ n: this.next, text: null }]); this.next += 1; continue }
        return
      }
      const pieces = r.text.match(/[^\n]*\n|[^\n]+$/g) ?? []
      const out = []
      for (const piece of pieces) {
        if (!piece.endsWith('\n')) break // the last line, still being written: read again next time
        out.push({ n: r.first + out.length, text: piece.slice(0, -1).replace(/\r$/, '') })
      }
      if (out.length) { this.next = r.first + out.length; this.onLines(out) }
      if (!out.length || r.last >= r.lines) return
    }
  }
}
