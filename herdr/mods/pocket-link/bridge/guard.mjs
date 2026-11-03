// What a phone can make the bridge do before it is trusted, and how much: a deadline on the
// handshake and the first line, a cap on connections, a throttle on the log lines a stranger can
// cause and a size cap on the log. bridge.mjs hands it iroh's objects; nothing here imports iroh,
// so `node --test` runs it without npm.
import { copyFileSync, chmodSync, statSync, truncateSync } from 'node:fs'

/** The handshake, the first stream and its header line, together; and a whole pairing. */
export const HANDSHAKE_MS = 10_000
/** Connections still in that phase. */
export const MAX_PENDING = 16
/** Every connection, open sessions included. */
export const MAX_OPEN = 64
/** A header line is at most this many bytes. */
export const MAX_LINE = 4096
/** The log is copied to <log>.1 and emptied past this size. */
export const LOG_MAX = 1024 * 1024

/** One line of JSON from a stream, at most MAX_LINE bytes; the rest of what was read comes back too. */
export async function readLine(recv) {
  let buf = Buffer.alloc(0)
  while (!buf.includes(10)) {
    if (buf.length > MAX_LINE) throw new Error('header too long')
    const chunk = await recv.read(MAX_LINE)
    if (!chunk || chunk.length === 0) throw new Error('closed before its header')
    buf = Buffer.concat([buf, Buffer.from(chunk)])
  }
  const end = buf.indexOf(10)
  return { value: JSON.parse(buf.subarray(0, end).toString('utf8')), rest: buf.subarray(end + 1) }
}

/** The connection cap: `enter()` gives a slot, or null when full. A slot is pending until `trusted()`. */
export function slots({ pending: maxPending = MAX_PENDING, open: maxOpen = MAX_OPEN } = {}) {
  let pending = 0, open = 0
  return {
    counts: () => ({ pending, open }),
    enter() {
      if (pending >= maxPending || open >= maxOpen) return null
      pending++; open++
      let waiting = true, done = false
      const settle = () => { if (waiting) { waiting = false; pending-- } }
      return { trusted: settle, done() { if (done) return; done = true; settle(); open-- } }
    },
  }
}

/**
 * At most `burst` lines of each kind per `per` ms; the first line after a quiet spell says how many
 * were left out. For what any peer can cause: refusals, timeouts, bad headers.
 */
export function throttle(log, { burst = 5, per = 60_000, now = Date.now } = {}) {
  const kinds = new Map()
  return (kind, ...args) => {
    const t = now()
    let k = kinds.get(kind)
    if (!k || t - k.since >= per) {
      const skipped = k?.skipped ?? 0
      k = { since: t, count: 0, skipped: 0 }
      kinds.set(kind, k)
      if (skipped) log(`${kind}: ${skipped} more like this in the last minute`)
    }
    if (k.count < burst) { k.count++; log(`${kind}:`, ...args) } else k.skipped++
  }
}

/**
 * Keeps a log under `max` bytes: copies it to <path>.1 (0600) and empties it in place. The
 * service's stderr is opened to append (launchd, `start`), so it keeps writing at the new end.
 */
export function rotateLog(path, max = LOG_MAX) {
  let size
  try { size = statSync(path).size } catch { return false }
  if (size <= max) return false
  copyFileSync(path, `${path}.1`)
  chmodSync(`${path}.1`, 0o600)
  truncateSync(path, 0)
  return true
}

const closeConn = (conn, why) => { try { conn.close(1n, [...Buffer.from(why)]) } catch {} }

/**
 * One incoming connection. Over the cap it is refused before its handshake. Then, within `ms`: the
 * handshake, `admit(alpn, peer)` (false closes it before anything is read), the first stream and
 * its header line. A route with `timed` (pairing) also runs, and waits for the phone to hang up,
 * inside that deadline; a session runs untimed once its header is in.
 *
 * `routes`: { [alpn]: { admit(peer), run({ conn, bi, value, rest, peer }), timed } }.
 * `refused(kind, ...why)` gets every refusal; it should be throttled.
 * Resolves when the connection is done with; never rejects.
 */
export async function acceptOne(incoming, { routes, cap, refused, ms = HANDSHAKE_MS }) {
  const slot = cap.enter()
  if (!slot) {
    refused('refused', 'too many connections')
    await Promise.resolve().then(() => incoming.refuse()).catch(() => {})
    return
  }
  let conn = null, expired = false, timer
  const late = () => { if (expired) { if (conn) closeConn(conn, 'too slow'); throw new Error('too slow') } }
  const work = (async () => {
    const accepting = await incoming.accept(); late()
    const alpn = Buffer.from(await accepting.alpn()).toString(); late()
    conn = await accepting.connect(); late()
    const peer = conn.remoteId().toString()
    const route = routes[alpn]
    if (!route || !route.admit(peer)) { closeConn(conn, 'not paired'); return { refusedPeer: peer } }
    const bi = await conn.acceptBi(); late()
    const { value, rest } = await readLine(bi.recv); late()
    const job = { conn, bi, value, rest, peer }
    if (!route.timed) return { route, job }
    await route.run(job); late()
    await conn.closed().catch(() => {})
    return {}
  })()
  try {
    const out = await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error(`nothing within ${ms / 1000} s`)) }, ms)
    })])
    clearTimeout(timer)
    if (out.refusedPeer) { refused('refused', 'unpaired', out.refusedPeer.slice(0, 10)); return }
    if (!out.route) return
    slot.trusted()
    await out.route.run(out.job)
  } catch (e) {
    clearTimeout(timer)
    if (expired && conn) closeConn(conn, 'too slow')
    refused('connection', e.message)
  } finally {
    work.catch(() => {})
    slot.done()
  }
}
