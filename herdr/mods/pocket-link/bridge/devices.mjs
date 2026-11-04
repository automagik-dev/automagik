// devices.json, the paired phones, has one writer: the running bridge. `forget` (the dialog's
// Remove) runs as its own process, so it hands the removal to the bridge over bridge.sock in the
// state folder and waits for the answer; it writes the file itself only when no bridge answers.
// Two writers each reading, changing and writing the file could put a removed phone back.
//
//   bridge.sock   one JSON line in, {"forget": "<id>"}; one line out, {"ok", "removed"} or {"ok": false, "error"}
//
// No dependencies, so node --test runs it without the bridge's packages.
import { createConnection, createServer } from 'node:net'
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SOCKET = 'bridge.sock'
export const FILE = 'devices.json'
// How long `forget` waits for the bridge, and the bridge for a request line.
export const TIMEOUT = 5_000
const MAX_REQUEST = 4096

const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }

/**
 * The phones in devices.json. Every change reads the file again and writes it whole (tmp + rename),
 * synchronously, so changes within one process never interleave. `held` runs between a change's
 * read and its write: the moment another process's write would be lost (devices.test.mjs).
 */
export function store(path, { held = () => {} } = {}) {
  const list = () => { const v = readJson(path, []); return Array.isArray(v) ? v : [] }
  const read = () => { const all = list(); held(); return all }
  const write = (value) => { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, path) }
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
      resolve(server)
    })
  })
}

/**
 * Sends one request to the bridge and resolves to its answer, or to null when nothing listens
 * there (no bridge, one that died, or an older bridge without the socket). Rejects when a bridge
 * listens but gives no answer within `timeout`.
 */
export function ask(path, request, { timeout = TIMEOUT } = {}) {
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
      if (!connected && ['ENOENT', 'ECONNREFUSED', 'ENOTSOCK'].includes(e.code)) finish(resolve, null)
      else finish(reject, new Error(`The bridge did not answer: ${e.message}`))
    })
    sock.on('close', () => finish(reject, new Error('The bridge hung up without an answer.')))
  })
}

const defaultAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

/**
 * `bridge.mjs forget <id>`: removes a paired phone from the state folder `dir`.
 * - A bridge runs (status.json's pid is alive): it removes the phone and ends its sessions; this
 *   waits for its answer and never writes the file itself.
 * - None answers on bridge.sock (none runs, or an older one without the socket that a mod update
 *   left running): this writes the file, then tells a bridge that started meanwhile too.
 * Resolves to {ok: true, removed, via: 'bridge' | 'file'}; rejects when the bridge refuses or
 * gives no answer, and then nothing was written.
 */
export async function forget({ dir, id, alive = defaultAlive, timeout = TIMEOUT }) {
  if (typeof id !== 'string' || id === '') throw new Error('forget needs the id of a paired phone')
  const sock = join(dir, SOCKET)
  const status = readJson(join(dir, 'status.json'), {})
  if (Number.isInteger(status?.pid) && alive(status.pid)) {
    const answer = await ask(sock, { forget: id }, { timeout })
    if (answer) {
      if (!answer.ok) throw new Error(answer.error || 'The bridge refused.')
      return { ok: true, removed: Boolean(answer.removed), via: 'bridge' }
    }
  }
  const removed = store(join(dir, FILE)).remove(id)
  // A bridge that bound the socket after the check above may have read the list before this write.
  const late = await ask(sock, { forget: id }, { timeout }).catch(() => null)
  return { ok: true, removed: removed || Boolean(late?.removed), via: 'file' }
}
