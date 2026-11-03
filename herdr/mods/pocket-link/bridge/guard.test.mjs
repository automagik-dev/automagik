// node --test bridge/guard.test.mjs: the handshake deadline, the connection cap, the log throttle
// and rotation. Fake iroh objects only; no network, no npm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, openSync, writeSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptOne, slots, throttle, rotateLog, readLine, MAX_LINE } from './guard.mjs'

const never = () => new Promise(() => {})
const later = (ms, value) => new Promise(r => setTimeout(() => r(value), ms))

/** A stream that hands out these chunks, then the end; `hang` never answers after them. */
function recv(chunks, { hang = false } = {}) {
  const queue = chunks.map(c => [...Buffer.from(c)])
  return { read: async () => queue.length ? queue.shift() : hang ? never() : [] }
}

/** A fake peer. Each step can be swapped for one that is slow or never answers. */
function peer({ alpn = 'pair', id = 'a'.repeat(64), lines = ['{"code":"x"}\n'], hang = false, connect, acceptBi } = {}) {
  const conn = {
    closedWith: null,
    remoteId: () => ({ toString: () => id }),
    close(code, reason) { this.closedWith = Buffer.from(reason).toString() },
    acceptBi: acceptBi ?? (async () => ({ recv: recv(lines, { hang }), send: {} })),
    closed: async () => 'closed',
  }
  const incoming = {
    refused: false,
    refuse: async () => { incoming.refused = true },
    accept: async () => ({ alpn: async () => [...Buffer.from(alpn)], connect: connect ? () => connect(conn) : async () => conn }),
  }
  return { conn, incoming }
}

const logged = () => { const lines = []; const f = (...a) => lines.push(a.join(' ')); f.lines = lines; return f }

test('a peer that connects and then says nothing is closed at the deadline, and its slot comes back', async () => {
  const { conn, incoming } = peer({ acceptBi: never })
  const cap = slots({ pending: 1, open: 1 })
  const refused = logged()
  let ran = false
  await acceptOne(incoming, { routes: { pair: { admit: () => true, run: () => { ran = true }, timed: true } }, cap, refused, ms: 30 })
  assert.equal(conn.closedWith, 'too slow')
  assert.equal(ran, false)
  assert.match(refused.lines[0], /^connection nothing within/)
  assert.deepEqual(cap.counts(), { pending: 0, open: 0 })
})

test('a header that never ends a line is cut off at the deadline too', async () => {
  const { conn, incoming } = peer({ lines: ['{"code":'], hang: true })
  await acceptOne(incoming, { routes: { pair: { admit: () => true, run: () => {}, timed: true } }, cap: slots(), refused: logged(), ms: 30 })
  assert.equal(conn.closedWith, 'too slow')
})

test('a handshake that finishes after the deadline is closed when it does', async () => {
  const { conn, incoming } = peer({ connect: c => later(60, c) })
  await acceptOne(incoming, { routes: { pair: { admit: () => true, run: () => {}, timed: true } }, cap: slots(), refused: logged(), ms: 20 })
  assert.equal(conn.closedWith, null)
  await later(80)
  assert.equal(conn.closedWith, 'too slow')
})

test('an unpaired key is closed before anything is read from it', async () => {
  let read = false
  const { conn, incoming } = peer({ alpn: 'session', acceptBi: async () => { read = true; return { recv: recv([]) } } })
  const refused = logged()
  await acceptOne(incoming, { routes: { session: { admit: () => false, run: () => {}, timed: false } }, cap: slots(), refused, ms: 1000 })
  assert.equal(conn.closedWith, 'not paired')
  assert.equal(read, false)
  assert.match(refused.lines[0], /^refused unpaired aaaaaaaaaa$/)
})

test('a paired session runs past the deadline once its header is in, and holds its slot until it ends', async () => {
  const { conn, incoming } = peer({ alpn: 'session', lines: ['{"session":"main"}\nrest'] })
  const cap = slots({ pending: 4, open: 4 })
  let seen = null, finish
  const done = acceptOne(incoming, {
    routes: { session: { admit: () => true, run: job => { seen = job; return new Promise(r => { finish = r }) }, timed: false } },
    cap, refused: logged(), ms: 20,
  })
  await later(60)
  assert.deepEqual(seen.value, { session: 'main' })
  assert.equal(Buffer.from(seen.rest).toString(), 'rest')
  assert.equal(conn.closedWith, null)
  assert.deepEqual(cap.counts(), { pending: 0, open: 1 })
  finish()
  await done
  assert.deepEqual(cap.counts(), { pending: 0, open: 0 })
})

test('over the cap, a connection is refused before its handshake', async () => {
  const cap = slots({ pending: 2, open: 3 })
  const hung = [peer({ acceptBi: never }), peer({ acceptBi: never })]
  const routes = { pair: { admit: () => true, run: () => {}, timed: true } }
  const waiting = hung.map(p => acceptOne(p.incoming, { routes, cap, refused: logged(), ms: 50 }))
  await later(5)
  assert.deepEqual(cap.counts(), { pending: 2, open: 2 })
  const extra = peer()
  let accepted = false
  extra.incoming.accept = async () => { accepted = true; throw new Error('should not get here') }
  const refused = logged()
  await acceptOne(extra.incoming, { routes, cap, refused, ms: 50 })
  assert.equal(extra.incoming.refused, true)
  assert.equal(accepted, false)
  assert.deepEqual(refused.lines, ['refused too many connections'])
  await Promise.all(waiting)
  assert.deepEqual(cap.counts(), { pending: 0, open: 0 })
})

test('open sessions count toward the total cap, not the pending one', () => {
  const cap = slots({ pending: 1, open: 2 })
  const a = cap.enter(); a.trusted()
  const b = cap.enter()
  assert.ok(b)
  assert.equal(cap.enter(), null) // open is full
  b.done(); b.done() // twice changes nothing
  assert.deepEqual(cap.counts(), { pending: 0, open: 1 })
})

test('the log throttle keeps a few lines of each kind a minute and says how many it left out', () => {
  let t = 0
  const log = logged()
  const say = throttle(log, { burst: 2, per: 60_000, now: () => t })
  for (let i = 0; i < 5; i++) say('refused', 'peer', i)
  say('pair', 'wrong code')
  assert.deepEqual(log.lines, ['refused: peer 0', 'refused: peer 1', 'pair: wrong code'])
  t = 60_000
  say('refused', 'peer', 9)
  assert.deepEqual(log.lines.slice(3), ['refused: 3 more like this in the last minute', 'refused: peer 9'])
})

test('rotation copies a full log to .1 and empties it in place; an appending writer carries on at the start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-guard-test-'))
  const path = join(dir, 'bridge.log')
  const fd = openSync(path, 'a', 0o600) // as launchd opens the service's stderr
  writeSync(fd, 'x'.repeat(100))
  assert.equal(rotateLog(path, 200), false)
  writeSync(fd, 'y'.repeat(150))
  assert.equal(rotateLog(path, 200), true)
  assert.equal(readFileSync(`${path}.1`, 'utf8'), 'x'.repeat(100) + 'y'.repeat(150))
  assert.equal(statSync(`${path}.1`).mode & 0o777, 0o600)
  writeSync(fd, 'after\n')
  closeSync(fd)
  assert.equal(readFileSync(path, 'utf8'), 'after\n')
  assert.equal(rotateLog(join(dir, 'missing.log'), 1), false)
})

test('a header line longer than the limit is refused', async () => {
  await assert.rejects(readLine(recv(['x'.repeat(MAX_LINE + 10)])), /header too long/)
  await assert.rejects(readLine(recv(['{"a":1}'])), /closed before its header/)
  const { value, rest } = await readLine(recv(['{"a":', '1}\nmore']))
  assert.deepEqual(value, { a: 1 })
  assert.equal(Buffer.from(rest).toString(), 'more')
})
