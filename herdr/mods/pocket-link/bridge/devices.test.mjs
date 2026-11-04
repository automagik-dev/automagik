// node --test bridge/devices.test.mjs: devices.json has one writer, the running bridge; `forget`
// hands it the removal over bridge.sock. Temp dirs only, never the real state dir; the phone keys
// and names are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { store, listen, ask, forget, unlinkOwn, fits, SOCKET, FILE, SOCKET_MAX } from './devices.mjs'

const A = { id: 'phone-key-a', name: 'Pixel 9', paired: 1_000, seen: 1_000 }
const B = { id: 'phone-key-b', name: 'Galaxy S24', paired: 2_000, seen: 2_000 }
// Short: a socket path must stay under ~104 bytes on macOS.
const tmp = () => mkdtempSync(join(tmpdir(), 'pl-'))
const ids = (dir) => JSON.parse(readFileSync(join(dir, FILE), 'utf8')).map((d) => d.id)
/** status.json naming a running bridge: this test process. */
const running = (dir) => writeFileSync(join(dir, 'status.json'), JSON.stringify({ pid: process.pid }))
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
  running(dir)
  assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'file' })
  assert.deepEqual(ids(dir), [])
})

test('a state folder too long for a socket: the bridge binds none, and forget writes the file', async () => {
  const { base, dir } = longDir()
  const sock = join(dir, SOCKET)
  assert.equal(fits(sock), false)
  assert.equal(fits(join(base, SOCKET)), true)
  assert.equal(fits('/'.padEnd(SOCKET_MAX - 1, 'x')), true, 'one byte under the limit fits')
  assert.equal(fits('/'.padEnd(SOCKET_MAX, 'x')), false, 'the NUL byte needs the last one')
  await assert.rejects(listen(sock, { forget: () => true }), /too long for a socket/)
  assert.equal(await ask(sock, { forget: A.id }), null)
  store(join(dir, FILE)).add(A); store(join(dir, FILE)).add(B)
  running(dir)
  assert.deepEqual(await forget({ dir, id: A.id }), { ok: true, removed: true, via: 'file' })
  assert.deepEqual(ids(dir), [B.id])
  assert.deepEqual(sockets(base), [], 'no socket anywhere, not even at a path cut short')
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
