// devices.json, the paired phones, has one writer: the running bridge. `forget` (the dialog's
// Remove) runs as its own process, so it hands the removal to the bridge over bridge.sock in the
// state folder and waits for the answer; it writes the file itself only when no bridge answers.
// Two writers each reading, changing and writing the file could put a removed phone back.
//
//   bridge.sock   one JSON line in, {"forget": "<id>"}; one line out, {"ok", "removed"} or {"ok": false, "error"}
//
// No dependencies, so node --test runs it without the bridge's packages.
import { createConnection, createServer } from 'node:net'
import { chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SOCKET = 'bridge.sock'
export const FILE = 'devices.json'
// How long `forget` waits for the bridge (its loop can be busy finding hc for a session), and the
// bridge for a request line. Under the dialog's 30s exec limit.
export const TIMEOUT = 10_000
const MAX_REQUEST = 4096
// A running bridge whose socket refuses (its backlog full): try again for this long, then fail.
export const BUSY_RETRIES = 10
export const BUSY_WAIT = 200
// The longest Unix socket path, in bytes, that binds where it was asked. macOS, measured on Node 22
// and 24: 104 binds; 105 fails with EINVAL on Node 24, and on Node 22 listen() reports success but
// binds the path cut short, outside the state folder. Linux: not measured here; 107, from the classic
// 108-byte sun_path less its NUL, kept on the safe side. Neither end uses a path that does not fit.
export const SOCKET_MAX = process.platform === 'darwin' ? 104 : 107
export const fits = (path) => Buffer.byteLength(path) <= SOCKET_MAX

const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }

/**
 * The phones in devices.json. Every change reads the file again and writes it whole, synchronously,
 * so changes within one process never interleave. Atomic and durable: the temp file is flushed to
 * disk before the rename, and the folder after it, so a crash leaves the old list or the new one. `held` runs between a change's
 * read and its write: the moment another process's write would be lost (devices.test.mjs).
 */
export function store(path, { held = () => {} } = {}) {
  const list = () => { const v = readJson(path, []); return Array.isArray(v) ? v : [] }
  const read = () => { const all = list(); held(); return all }
  const write = (value) => {
    const tmp = `${path}.${process.pid}.tmp`
    const fd = openSync(tmp, 'w', 0o600)
    try { writeSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, path)
    // The rename itself; a filesystem that can't fsync a folder still has the flushed file.
    let dirFd = null
    try { dirFd = openSync(dirname(path), 'r'); fsyncSync(dirFd) } catch {} finally { if (dirFd !== null) closeSync(dirFd) }
  }
  return {
    list,
    /** Adds the phone, replacing one with the same id. */
    add: (device) => write([...read().filter((d) => d.id !== device.id), device]),
    /** A phone's last-seen time; a phone that is no longer listed stays removed. */
    touch: (id, now = Date.now()) => { const all = read(); if (all.some((d) => d.id === id)) write(all.map((d) => (d.id === id ? { ...d, seen: now } : d))) },
    /** True when the phone was listed. */
    remove: (id) => { const all = read(); const kept = all.filter((d) => d.id !== id); if (kept.length !== all.length) write(kept); return kept.length !== all.length },
  }
}

/**
 * The bridge's end of bridge.sock: `forget(id)` removes the phone (and ends its sessions) and
 * returns whether it was listed. A stale socket from a bridge that died is replaced. Resolves to
 * the server once it listens; the socket is the owner's only (and the state folder is 0700).
 */
export function listen(path, { forget, log = () => {} }) {
  if (!fits(path)) return Promise.reject(new Error(`${path} is ${Buffer.byteLength(path)} bytes, too long for a socket (at most ${SOCKET_MAX})`))
  try { unlinkSync(path) } catch {}
  const server = createServer((sock) => {
    sock.setEncoding('utf8')
    sock.setTimeout(TIMEOUT, () => sock.destroy())
    sock.on('error', () => {})
    let buf = ''
    const onData = (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) { if (buf.length > MAX_REQUEST) sock.destroy(); return }
      sock.off('data', onData)
      let answer
      try {
        const request = JSON.parse(buf.slice(0, nl))
        if (typeof request?.forget !== 'string' || request.forget === '') throw new Error('unknown request')
        answer = { ok: true, removed: Boolean(forget(request.forget)) }
      } catch (e) { answer = { ok: false, error: e.message } }
      sock.end(JSON.stringify(answer) + '\n')
    }
    sock.on('data', onData)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      server.on('error', (e) => log('control:', e.message))
      try { chmodSync(path, 0o600) } catch {}
      try { server.socketIno = statSync(path).ino } catch {}
      resolve(server)
    })
  })
}

/**
 * For the bridge's exit: removes bridge.sock only while it is still this server's, never one a
 * later bridge has put in its place.
 */
export function unlinkOwn(server, path) {
  try { if (server?.socketIno !== undefined && statSync(path).ino === server.socketIno) unlinkSync(path) } catch {}
}

/**
 * Sends one request to the bridge and resolves to its answer, or to null when nothing took it:
 * no socket, a path too long for one (no bridge can listen there), or one that refuses (a bridge
 * that died, or one too busy to accept: `forget` tells these apart). Rejects when a bridge took the request but gives no answer within `timeout`.
 */
export function ask(path, request, { timeout = TIMEOUT } = {}) {
  if (!fits(path)) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const sock = createConnection(path)
    let buf = '', connected = false, done = false
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); fn(value) }
    const timer = setTimeout(() => finish(reject, new Error('The bridge did not answer. Try again.')), timeout)
    sock.setEncoding('utf8')
    sock.on('connect', () => { connected = true; sock.write(JSON.stringify(request) + '\n') })
    sock.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      try { finish(resolve, JSON.parse(buf.slice(0, nl))) } catch { finish(reject, new Error('The bridge gave an answer it could not read.')) }
    })
    sock.on('error', (e) => {
      if (!connected && ['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EAGAIN', 'EINVAL', 'ENAMETOOLONG'].includes(e.code)) finish(resolve, null)
      else finish(reject, new Error(`The bridge did not answer: ${e.message}`))
    })
    sock.on('close', () => finish(reject, new Error('The bridge hung up without an answer.')))
  })
}

const defaultAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

/**
 * `bridge.mjs forget <id>`: removes a paired phone from the state folder `dir`.
 * - A bridge runs (status.json's pid is alive): it removes the phone and ends its sessions; this
 *   waits for its answer and never writes the file itself. A socket that is there but refuses (a
 *   busy bridge) is tried again for BUSY_RETRIES x BUSY_WAIT ms, then this fails.
 * - None answers on bridge.sock (none runs, an older one without the socket that a mod update left
 *   running, or a state folder whose bridge.sock path does not `fit`): this writes the file, then tells a bridge that started meanwhile too.
 * Resolves to {ok: true, removed, via: 'bridge' | 'file'}; rejects when the bridge refuses or
 * gives no answer, and then nothing was written.
 */
export async function forget({ dir, id, alive = defaultAlive, timeout = TIMEOUT, retries = BUSY_RETRIES, wait = BUSY_WAIT }) {
  if (typeof id !== 'string' || id === '') throw new Error('forget needs the id of a paired phone')
  const sock = join(dir, SOCKET)
  const status = readJson(join(dir, 'status.json'), {})
  if (Number.isInteger(status?.pid) && alive(status.pid)) {
    for (let i = 0; ; i++) {
      const answer = await ask(sock, { forget: id }, { timeout })
      if (answer) {
        if (!answer.ok) throw new Error(answer.error || 'The bridge refused.')
        return { ok: true, removed: Boolean(answer.removed), via: 'bridge' }
      }
      // No socket at all (an older bridge without one, or a path too long for one): the file, below.
      if (!fits(sock) || !existsSync(sock)) break
      if (i >= retries) throw new Error('The bridge is busy and did not take the removal. Try again.')
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
  const removed = store(join(dir, FILE)).remove(id)
  // A bridge that bound the socket after the check above may have read the list before this write.
  const late = await ask(sock, { forget: id }, { timeout }).catch(() => null)
  return { ok: true, removed: removed || Boolean(late?.removed), via: 'file' }
}
