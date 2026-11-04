// node --test bridge/devices.test.mjs: devices.json has one writer, the running bridge; `forget`
// hands it the removal over bridge.sock. Temp dirs only, never the real state dir; the phone keys
// and names are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  store, listen, ask, forget, unlinkOwn, fits, fileId, bridgeState, claim, clearStale, stopBridge, startedAt, commandOf,
  servesBridge,
  SOCKET, FILE, STATUS, SOCKET_MAX, BUSY_RETRIES, BUSY_WAIT,
} from './devices.mjs'

const A = { id: 'phone-key-a', name: 'Pixel 9', paired: 1_000, seen: 1_000 }
const B = { id: 'phone-key-b', name: 'Galaxy S24', paired: 2_000, seen: 2_000 }
// Short: a socket path must stay under ~104 bytes on macOS.
const tmp = () => mkdtempSync(join(tmpdir(), 'pl-'))
const ids = (dir) => JSON.parse(readFileSync(join(dir, FILE), 'utf8')).map((d) => d.id)
/** status.json naming a running bridge, as serve writes it: this test process's pid and start time. */
const running = (dir) => writeFileSync(join(dir, STATUS), JSON.stringify({ pid: process.pid, pidStart: startedAt(process.pid) }))
/**
 * status.json a bridge left when it crashed, its pid since given to another process: this test
 * process, which is alive and is no bridge. `pidStart` is the dead bridge's start time.
 */
const reused = (dir, pidStart = 'Thu Jan  1 00:00:00 1970') => writeFileSync(join(dir, STATUS), JSON.stringify({ pid: process.pid, ...(pidStart ? { pidStart } : {}) }))
/** A socket file whose listener is gone: connecting to it is refused, as a bridge with a full backlog refuses. */
function refusing(path) {
  const r = spawnSync(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, 'SIGKILL'))`])
  assert.equal(r.signal, 'SIGKILL')
  assert.ok(existsSync(path))
}
/** A state folder inside `base` whose bridge.sock path is over 110 bytes, too long for a socket. */
function longDir() {
  const base = tmp()
  const dir = join(base, 'state-'.padEnd(120, 'x'))
  mkdirSync(dir, { mode: 0o700 })
  assert.ok(Buffer.byteLength(join(dir, SOCKET)) > 110)
  return { base, dir }
}
/** Every socket file under `dir`: Node 22 binds a too-long path cut short, beside the state folder. */
function sockets(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name), st = lstatSync(path)
    return st.isDirectory() ? sockets(path) : st.isSocket() ? [path] : []
  })
}
/** Blocks this thread, as a synchronous read-then-write does, until `done()` or `ms` pass. */
function block(done, ms) {
  const cell = new Int32Array(new SharedArrayBuffer(4))
  for (const end = Date.now() + ms; !done() && Date.now() < end;) Atomics.wait(cell, 0, 0, 5)
}

test('the store adds, touches and removes phones, writing the file whole and owner-only', () => {
  const dir = tmp()
  const phones = store(join(dir, FILE))
  assert.deepEqual(phones.list(), [])
  phones.add(A); phones.add(B)
  phones.add({ ...A, name: 'Pixel 9 Pro' })
  assert.deepEqual(phones.list().map((d) => d.name), ['Galaxy S24', 'Pixel 9 Pro'], 'pairing again replaces the phone')
  phones.touch(B.id, 9_000)
  assert.equal(phones.list().find((d) => d.id === B.id).seen, 9_000)
  assert.equal(phones.remove(A.id), true)
  assert.equal(phones.remove(A.id), false)
  phones.touch(A.id, 10_000)
  assert.deepEqual(ids(dir), [B.id], 'touching a removed phone does not bring it back')
  assert.equal(statSync(join(dir, FILE)).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(dir), [FILE], 'no temp file left behind')
})

// The race in issue #248. A session's "seen" update reads devices.json and writes it back; a Remove
// that a separate `forget` process writes between the two is overwritten, and the phone is back.
// Here the bridge's update is held open at that moment while the real `forget` runs as its own
// process, as the dialog runs it. A `forget` that writes the file itself fails this test.
test('a Remove while the bridge updates a phone\'s seen time stays removed', async () => {
  const dir = tmp()
  const path = join(dir, FILE)
  store(path).add(A); store(path).add(B)
  running(dir)
  const ready = join(dir, 'forget.started')
  let child = null
  const phones = store(path, {
    held: () => {
      if (child) return
      const before = readFileSync(path, 'utf8')
      child = spawn(process.execPath, ['--input-type=module', '-e', `
        import { writeFileSync } from 'node:fs'
        import { forget } from ${JSON.stringify(new URL('./devices.mjs', import.meta.url).href)}
        writeFileSync(process.env.READY, '')
        process.stdout.write(JSON.stringify(await forget({ dir: process.env.DIR, id: process.env.ID })))
      `], { env: { ...process.env, DIR: dir, ID: A.id, READY: ready }, stdio: ['ignore', 'pipe', 'inherit'] })
      // The bridge's thread stays here until forget has started and has had time to write.
      block(() => existsSync(ready), 10_000)
      block(() => readFileSync(path, 'utf8') !== before, 500)
    },
  })
  const server = await listen(join(dir, SOCKET), { forget: (id) => phones.remove(id) })
  try {
    phones.touch(A.id, 5_000)
    let stdout = ''
    child.stdout.on('data', (c) => { stdout += c })
    const code = await new Promise((resolve) => child.on('exit', resolve))
    assert.equal(code, 0)
    assert.deepEqual(JSON.parse(stdout), { ok: true, removed: true, via: 'bridge' })
    assert.deepEqual(ids(dir), [B.id], 'the removed phone stays removed')
    phones.touch(A.id, 6_000)
    assert.deepEqual(ids(dir), [B.id])
  } finally { server.close() }
})

test('with a bridge running, forget leaves the file to it and waits for its answer', async () => {
  const dir = tmp()
  store(join(dir, FILE)).add(A)
  running(dir)
  const before = readFileSync(join(dir, FILE), 'utf8'), inode = statSync(join(dir, FILE)).ino
  const asked = []
  const server = await listen(join(dir, SOCKET), { forget: (id) => { asked.push(id); return true } })
  try {
    assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'bridge' })
    assert.deepEqual(asked, [A.id])
    assert.equal(readFileSync(join(dir, FILE), 'utf8'), before, 'forget wrote nothing')
    assert.equal(statSync(join(dir, FILE)).ino, inode)
  } finally { server.close() }
})

test('a bridge that refuses or gives no answer: forget fails and writes nothing', async () => {
  const dir = tmp()
  store(join(dir, FILE)).add(A)
  running(dir)
  const before = readFileSync(join(dir, FILE), 'utf8')
  let server = await listen(join(dir, SOCKET), { forget: () => { throw new Error('busy') } })
  try {
    await assert.rejects(forget({ dir, id: A.id }), /busy/)
  } finally { server.close() }
  // Takes the connection, never answers.
  server = createServer(() => {})
  await new Promise((resolve) => server.listen(join(dir, SOCKET), resolve))
  try {
    await assert.rejects(forget({ dir, id: A.id, timeout: 200 }), /did not answer/)
  } finally { server.close() }
  assert.equal(readFileSync(join(dir, FILE), 'utf8'), before)
})

test('a running bridge whose socket refuses (busy): forget tries again, then fails and writes nothing', async () => {
  const dir = tmp()
  store(join(dir, FILE)).add(A)
  running(dir)
  refusing(join(dir, SOCKET))
  const before = readFileSync(join(dir, FILE), 'utf8')
  const started = Date.now()
  await assert.rejects(forget({ dir, id: A.id, retries: 3, wait: 50 }), /busy/)
  assert.ok(Date.now() - started >= 150, 'it tried again before giving up')
  assert.equal(readFileSync(join(dir, FILE), 'utf8'), before, 'nothing written')
})

test('a busy bridge that takes the removal while forget tries again', async () => {
  const dir = tmp()
  const path = join(dir, FILE)
  store(path).add(A)
  running(dir)
  refusing(join(dir, SOCKET))
  let server = null
  const later = setTimeout(async () => { server = await listen(join(dir, SOCKET), { forget: (id) => store(path).remove(id) }) }, 100)
  try {
    assert.deepEqual(await forget({ dir, id: A.id, retries: 20, wait: 50 }), { ok: true, removed: true, via: 'bridge' })
    assert.deepEqual(ids(dir), [])
  } finally { clearTimeout(later); server?.close() }
})

test('no bridge running: forget writes the file itself', async () => {
  const dir = tmp()
  store(join(dir, FILE)).add(A); store(join(dir, FILE)).add(B)
  assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'file' })
  assert.deepEqual(ids(dir), [B.id])
  assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: false, via: 'file' })
  // A stale status.json (its pid gone) and a stale socket are no bridge either.
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ pid: 4_000_000 }))
  assert.deepEqual(await forget({ dir, id: B.id, alive: () => false }), { ok: true, removed: true, via: 'file' })
  assert.deepEqual(ids(dir), [])
})

test('a running bridge without the socket (an older one a mod update left running): forget writes the file', async () => {
  const dir = tmp()
  store(join(dir, FILE)).add(A)
  // Its status.json has no start time; its command line says it is the bridge.
  reused(dir, null)
  const command = () => '/usr/local/bin/node /mods/pocket-link/bridge/bridge.mjs serve'
  assert.deepEqual(await bridgeState({ dir, command }), { running: true, pid: process.pid, stale: false })
  assert.deepEqual(await forget({ dir, id: A.id, command }), { ok: true, removed: true, via: 'file' })
  assert.deepEqual(ids(dir), [])
})

test('a state folder too long for a socket: the bridge binds none, and forget writes the file', async () => {
  const { base, dir } = longDir()
  const sock = join(dir, SOCKET)
  assert.equal(fits(sock), false)
  assert.equal(fits(join(base, SOCKET)), true)
  assert.equal(fits('/'.padEnd(SOCKET_MAX, 'x')), true, 'exactly SOCKET_MAX bytes fits')
  assert.equal(fits('/'.padEnd(SOCKET_MAX + 1, 'x')), false, 'one byte more does not')
  await assert.rejects(listen(sock, { forget: () => true }), /too long for a socket/)
  assert.equal(await ask(sock, { forget: A.id }), null)
  store(join(dir, FILE)).add(A); store(join(dir, FILE)).add(B)
  running(dir)
  assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'file' })
  assert.deepEqual(ids(dir), [B.id])
  assert.deepEqual(sockets(base), [], 'no socket anywhere, not even at a path cut short')
})

test('a socket path of exactly SOCKET_MAX bytes binds and answers; one byte more is refused', async (t) => {
  assert.equal(fits('/'.padEnd(SOCKET_MAX, 'x')), true)
  assert.equal(fits('/'.padEnd(SOCKET_MAX + 1, 'x')), false)
  // Only macOS's 104 was measured. Linux's 107 (108-byte sun_path less its NUL) is unverified.
  if (process.platform !== 'darwin') return t.skip('the Linux bound (107 of 108) is not measured')
  const base = tmp()
  /** A state folder in `base` whose bridge.sock path is `bytes` long. */
  const sized = (bytes) => {
    const dir = join(base, ''.padEnd(bytes - Buffer.byteLength(base) - 2 - SOCKET.length, String(bytes % 10)))
    mkdirSync(dir, { mode: 0o700 })
    const sock = join(dir, SOCKET)
    assert.equal(Buffer.byteLength(sock), bytes)
    return sock
  }
  const at = sized(SOCKET_MAX)
  const server = await listen(at, { forget: () => true })
  try {
    assert.ok(existsSync(at), 'bound at the path asked for')
    assert.deepEqual(await ask(at, { forget: A.id }), { ok: true, removed: true })
  } finally { server.close() }
  // Node 22 would report this bind a success and make a shorter path instead, so only listen() refusing counts.
  const over = sized(SOCKET_MAX + 1)
  await assert.rejects(listen(over, { forget: () => true }), /too long for a socket/)
  assert.equal(existsSync(over), false)
})

test('a bridge that starts while forget writes the file is told too', async () => {
  const dir = tmp()
  const path = join(dir, FILE)
  store(path).add(A)
  const asked = []
  // Listening, but status.json does not name it yet: it may have read the list before forget's write.
  const server = await listen(join(dir, SOCKET), { forget: (id) => { asked.push(id); return store(path).remove(id) } })
  try {
    assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'file' })
    assert.deepEqual(asked, [A.id], 'it was told after the file was written')
    assert.deepEqual(ids(dir), [])
  } finally { server.close() }
})

test('the socket: replaces a stale one, owner-only, and refuses what is not a forget', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  writeFileSync(sock, 'left by a bridge that died')
  const server = await listen(sock, { forget: () => true })
  try {
    assert.equal(statSync(sock).mode & 0o777, 0o600)
    assert.deepEqual(await ask(sock, { hello: 1 }), { ok: false, error: 'unknown request' })
    assert.deepEqual(await ask(sock, { forget: '' }), { ok: false, error: 'unknown request' })
    assert.deepEqual(await ask(sock, { forget: A.id }), { ok: true, removed: true })
  } finally { server.close() }
  assert.equal(await ask(join(dir, 'nothing.sock'), { forget: A.id }), null, 'nothing listening: null')
  refusing(join(dir, 'dead.sock'))
  assert.equal(await ask(join(dir, 'dead.sock'), { forget: A.id }), null, 'a refusing socket: null')
  await assert.rejects(forget({ dir }), /needs the id/)
})

test('on exit a bridge removes bridge.sock only while it is still its own', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  const first = await listen(sock, { forget: () => true })
  // A later bridge puts its own socket in place.
  const second = await listen(sock, { forget: () => true })
  try {
    unlinkOwn(first, sock)
    assert.ok(existsSync(sock), 'the first bridge leaves the later one\'s socket')
    assert.deepEqual(await ask(sock, { forget: A.id }), { ok: true, removed: true })
    unlinkOwn(second, sock)
    assert.equal(existsSync(sock), false)
    unlinkOwn(null, sock)
  } finally { second.close(); first.close() }
})

// Issue #301: after a bridge crash, status.json's pid can belong to an unrelated process. Every
// command goes by bridgeState(), which asks the socket and checks the pid's start time.

const DEAD_START = 'Thu Jan  1 00:00:00 1970'
/** A process whose command line runs the bridge, without being one; killed when the test ends. */
async function lookalike(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '/mods/pocket-link/bridge/bridge.mjs', 'serve'], { stdio: 'ignore' })
  t.after(() => child.kill('SIGKILL'))
  await new Promise((resolve) => child.once('spawn', resolve))
  return child
}

test('a process\'s start time and command line, read the same way by every command', async (t) => {
  const first = startedAt(process.pid)
  assert.match(first, /\d\d:\d\d:\d\d \d{4}$/)
  assert.equal(startedAt(process.pid), first, 'the same each time')
  assert.equal(startedAt(4_000_000), null, 'no such process')
  assert.equal(servesBridge(commandOf(process.pid)), false, 'this test runner is not a bridge')
  const child = await lookalike(t)
  assert.equal(servesBridge(commandOf(child.pid)), true)
  assert.equal(servesBridge('/usr/bin/node /home/me/pocket-link/bridge/bridge.mjs serve'), true)
  assert.equal(servesBridge('node bridge.mjs serve'), true)
  for (const line of ['node bridge.mjs status', 'node old-bridge.mjs serve', 'vim bridge.mjs.serve', 'node --test bridge/devices.test.mjs']) assert.equal(servesBridge(line), false, line)
})

test('a live pid that is not the bridge: not running, stale, with no socket, a refusing one, or an old start time', async () => {
  for (const socket of ['none', 'refusing']) {
    for (const pidStart of [DEAD_START, null]) {
      const dir = tmp()
      reused(dir, pidStart)
      if (socket === 'refusing') refusing(join(dir, SOCKET))
      const state = await bridgeState({ dir })
      assert.equal(state.running, false, `${socket} socket, pidStart ${pidStart}`)
      assert.equal(state.stale, true)
      assert.equal(state.pid, null, 'nothing to signal')
    }
  }
})

test('status.running: a genuine bridge is found by its ping, by its start time, or busy', async () => {
  // Answers the ping with its pid, whatever status.json says about the pid's start time.
  let dir = tmp()
  reused(dir)
  let server = await listen(join(dir, SOCKET), { forget: () => true, pid: 4242 })
  try {
    assert.deepEqual(await bridgeState({ dir }), { running: true, pid: 4242, stale: false })
    assert.deepEqual(await ask(join(dir, SOCKET), { ping: true }), { ok: true, pid: 4242 })
  } finally { server.close() }
  // A bridge from before the ping: it answers, with an error. Its pid is not verified, so not given.
  dir = tmp()
  reused(dir)
  server = createServer((sock) => { sock.on('data', () => sock.end(JSON.stringify({ ok: false, error: 'unknown request' }) + '\n')) })
  await new Promise((resolve) => server.listen(join(dir, SOCKET), resolve))
  try { assert.deepEqual(await bridgeState({ dir }), { running: true, pid: null, stale: false }) } finally { server.close() }
  // Takes the connection, too busy to answer in time.
  dir = tmp()
  running(dir)
  server = createServer(() => {})
  await new Promise((resolve) => server.listen(join(dir, SOCKET), resolve))
  try { assert.deepEqual(await bridgeState({ dir, timeout: 100 }), { running: true, pid: process.pid, stale: false }) } finally { server.close() }
  // Its socket refuses (a full backlog) and its start time is the recorded one.
  dir = tmp()
  running(dir)
  refusing(join(dir, SOCKET))
  assert.deepEqual(await bridgeState({ dir }), { running: true, pid: process.pid, stale: false })
  // ps can't say: counted as the bridge, as before the check.
  dir = tmp()
  reused(dir)
  assert.equal((await bridgeState({ dir, started: () => null })).running, true)
  // No status.json, or a pid that is gone: none.
  dir = tmp()
  assert.deepEqual(await bridgeState({ dir }), { running: false, pid: null, stale: false })
  writeFileSync(join(dir, STATUS), JSON.stringify({ pid: 4_000_000 }))
  assert.equal((await bridgeState({ dir })).running, false)
  assert.equal((await bridgeState({ dir })).stale, true)
})

test('serve and start: a stale pid is cleared, its socket and status.json, and never blocks a new bridge', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  reused(dir)
  refusing(sock)
  const state = await claim({ dir })
  assert.equal(state.running, false, 'not "already running": serve binds, start spawns')
  assert.equal(existsSync(sock), false, 'the stale socket is gone')
  assert.equal(existsSync(join(dir, STATUS)), false, 'the stale status.json is gone')
  // The new bridge binds, writes its status.json and answers.
  const server = await listen(sock, { forget: () => true })
  running(dir)
  try { assert.deepEqual(await bridgeState({ dir }), { running: true, pid: process.pid, stale: false }) } finally { server.close() }
  // serve's own pid in status.json (an earlier bridge had it): stale too.
  const again = tmp()
  running(again)
  assert.equal((await claim({ dir: again, self: process.pid })).running, false)
  assert.equal(existsSync(join(again, STATUS)), false)
})

test('serve and start: a genuine bridge means already running, and nothing of it is touched', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  reused(dir)
  const server = await listen(sock, { forget: () => true })
  try {
    const state = await claim({ dir, self: 4_000_001 })
    assert.equal(state.running, true, 'serve exits 0, start spawns nothing: never two bridges')
    assert.ok(existsSync(sock))
    assert.ok(existsSync(join(dir, STATUS)))
    assert.deepEqual(await ask(sock, { forget: A.id }), { ok: true, removed: true })
  } finally { server.close() }
  // A busy bridge whose socket refuses, start time recorded: running, its socket kept.
  const busy = tmp()
  running(busy)
  refusing(join(busy, SOCKET))
  assert.equal((await claim({ dir: busy })).running, true)
  assert.ok(existsSync(join(busy, SOCKET)))
})

test('clearing a stale bridge leaves a socket and status.json a new bridge put there meanwhile', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  reused(dir)
  refusing(sock)
  const state = await bridgeState({ dir })
  assert.equal(state.stale, true)
  const server = await listen(sock, { forget: () => true })
  writeFileSync(join(dir, STATUS), JSON.stringify({ pid: 4_000_002 }))
  try {
    clearStale(dir, state)
    assert.deepEqual(await ask(sock, { forget: A.id }), { ok: true, removed: true }, 'the new socket stays')
    assert.equal(JSON.parse(readFileSync(join(dir, STATUS), 'utf8')).pid, 4_000_002, 'the new status.json stays')
  } finally { server.close() }
})

test('stop never signals a pid that is not the bridge, and clears what the crash left', async () => {
  for (const pidStart of [DEAD_START, null]) {
    const dir = tmp()
    reused(dir, pidStart)
    refusing(join(dir, SOCKET))
    const signalled = []
    assert.deepEqual(await stopBridge({ dir, kill: (pid) => signalled.push(pid) }), { stopped: null, running: false })
    assert.deepEqual(signalled, [], 'this test process was not signalled')
    assert.equal(existsSync(join(dir, SOCKET)), false)
    assert.equal(existsSync(join(dir, STATUS)), false)
  }
  // Something busy on the socket, but status.json's pid is not the bridge: not that pid either.
  const dir = tmp()
  reused(dir)
  const server = createServer(() => {})
  await new Promise((resolve) => server.listen(join(dir, SOCKET), resolve))
  const signalled = []
  try {
    assert.deepEqual(await stopBridge({ dir, kill: (pid) => signalled.push(pid), timeout: 100 }), { stopped: null, running: true })
    assert.deepEqual(signalled, [])
  } finally { server.close() }
})

test('stop signals the genuine bridge: the pid its ping gives, or the one its start time verifies', async () => {
  let dir = tmp()
  reused(dir)
  const server = await listen(join(dir, SOCKET), { forget: () => true, pid: 4242 })
  let signalled = []
  try {
    assert.deepEqual(await stopBridge({ dir, kill: (pid) => signalled.push(pid) }), { stopped: 4242, running: true })
    assert.deepEqual(signalled, [4242])
  } finally { server.close() }
  dir = tmp()
  running(dir)
  refusing(join(dir, SOCKET))
  signalled = []
  assert.deepEqual(await stopBridge({ dir, kill: (pid) => signalled.push(pid) }), { stopped: process.pid, running: true })
  assert.deepEqual(signalled, [process.pid], 'recorded, not sent: the spy stands in for the signal')
})

test('forget with a live pid that is not the bridge writes the file, never "busy"', async () => {
  for (const socket of ['none', 'refusing']) {
    const dir = tmp()
    store(join(dir, FILE)).add(A); store(join(dir, FILE)).add(B)
    reused(dir)
    if (socket === 'refusing') refusing(join(dir, SOCKET))
    const started = Date.now()
    assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'file' }, socket)
    assert.ok(Date.now() - started < BUSY_RETRIES * BUSY_WAIT, 'no retries for a bridge that is not there')
    assert.deepEqual(ids(dir), [B.id])
  }
})

test('a genuine bridge that does not take the removal: forget fails closed with what to do next', async () => {
  const dir = tmp()
  store(join(dir, FILE)).add(A)
  running(dir)
  const before = readFileSync(join(dir, FILE), 'utf8')
  refusing(join(dir, SOCKET))
  await assert.rejects(forget({ dir, id: A.id, retries: 1, wait: 10 }), (e) => {
    assert.match(e.message, new RegExp(`^The bridge \\(pid ${process.pid}\\) is busy`))
    assert.match(e.message, /still paired: Remove it again, or Turn off Pocket Link, Remove it, then Turn on\.$/)
    return true
  })
  // Takes the connection and never answers.
  let quiet = createServer(() => {})
  unlinkSync(join(dir, SOCKET))
  await new Promise((resolve) => quiet.listen(join(dir, SOCKET), resolve))
  try {
    await assert.rejects(forget({ dir, id: A.id, timeout: 150 }), /^Error: The bridge \(pid \d+\) did not answer\. The phone is still paired/)
  } finally { quiet.close() }
  quiet = await listen(join(dir, SOCKET), { forget: () => { throw new Error('devices.json is not writable') } })
  try {
    await assert.rejects(forget({ dir, id: A.id }), /refused the removal: devices\.json is not writable\. The phone is still paired/)
  } finally { quiet.close() }
  assert.equal(readFileSync(join(dir, FILE), 'utf8'), before, 'nothing written')
})

/**
 * lstat as Linux can answer it after a socket is removed and another bound: the same device and
 * inode number, a later change time. `real` is lstatSync.
 */
const reusedInode = (real) => (path, options) => {
  const s = real(path, options)
  return { dev: s.dev, ino: s.ino, ctimeNs: s.ctimeNs + 1_000_000n, birthtimeNs: s.birthtimeNs + 1_000_000n }
}

test('a socket\'s identity is more than its inode: a reused inode number is another file', () => {
  const dir = tmp()
  const path = join(dir, 'x')
  writeFileSync(path, '')
  const id = fileId(path)
  assert.match(id, /^\d+:\d+:\d+:\d+$/)
  assert.equal(fileId(path), id, 'the same file, the same identity')
  assert.notEqual(fileId(path, reusedInode(lstatSync)), id)
  assert.equal(fileId(join(dir, 'none')), null)
})

test('clearing a stale bridge keeps a new socket given the dead one\'s inode number', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  reused(dir)
  refusing(sock)
  const state = await bridgeState({ dir })
  assert.equal(state.stale, true)
  // A new bridge's socket and status.json, its inode number the dead socket's.
  writeFileSync(join(dir, STATUS), JSON.stringify({ pid: 4_000_003 }))
  clearStale(dir, state, { stat: reusedInode(lstatSync) })
  assert.ok(existsSync(sock), 'the new socket stays')
  assert.equal(JSON.parse(readFileSync(join(dir, STATUS), 'utf8')).pid, 4_000_003, 'the new status.json stays')
  // The same file still there: cleared.
  reused(dir)
  clearStale(dir, state)
  assert.equal(existsSync(sock), false)
  assert.equal(existsSync(join(dir, STATUS)), false)
})

test('on exit a bridge keeps a later socket given its own socket\'s inode number', async () => {
  const dir = tmp()
  const sock = join(dir, SOCKET)
  const server = await listen(sock, { forget: () => true })
  try {
    unlinkOwn(server, sock, { stat: reusedInode(lstatSync) })
    assert.ok(existsSync(sock), 'a later bridge\'s socket stays')
    assert.deepEqual(await ask(sock, { ping: true }), { ok: true, pid: process.pid })
    unlinkOwn(server, sock)
    assert.equal(existsSync(sock), false, 'its own socket goes')
  } finally { server.close() }
})
