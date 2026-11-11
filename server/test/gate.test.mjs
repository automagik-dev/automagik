import assert from 'node:assert/strict'
import crypto, { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { COOKIE, cookieSecret, createOwner, IDLE_MS, principalOf, readOwner, SessionStore, sessionCookie } from '../gate-store.mjs'
import { createGate, pinOrigin } from '../gate.mjs'
import { DSH_HOST, DshCredentials } from '../gate-upstream.mjs'

// Reserved placeholder; no private deployment address, issuer or account belongs in tests.
const ORIGIN = 'https://workspace.invalid:8443'
const HOST = new URL(ORIGIN).host
const source = file => readFileSync(new URL(file, import.meta.url), 'utf8')
function store(t, options) {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-gate-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, sessions: new SessionStore(dir, options) }
}
async function listen(server) {
  server.listen(0, DSH_HOST)
  await once(server, 'listening')
  return server.address().port
}
function request(port, path = '/', { method = 'GET', headers = {}, body, upgrade = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: DSH_HOST, port, path, method, headers: Object.fromEntries(Object.entries({ host: HOST, ...headers }).filter(([, v]) => v !== undefined)) }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }))
    })
    req.on('error', reject)
    req.on('connect', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode, headers: response.headers }) })
    if (upgrade) req.on('upgrade', (response, socket, head) => resolve({ status: response.statusCode, headers: response.headers, socket, head }))
    req.setTimeout(5000, () => req.destroy(new Error('Test request timed out')))
    req.end(body)
  })
}
const websocketHeaders = { origin: ORIGIN, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' }

async function fixture(t) {
  let now = 1000
  const state = store(t, { now: () => now })
  const owner = createOwner(state.dir)
  const principal = principalOf(owner)
  const issued = state.sessions.issue(ORIGIN, principal)
  const seen = []
  let generation = 1
  let exchanges = 0
  const launchFile = join(state.dir, 'launch')
  const launch = () => writeFileSync(launchFile, `http://ignored.invalid/?${new URLSearchParams({ token: String(generation) })}`)
  launch()
  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN)
    if (url.searchParams.get('token') === String(generation)) {
      exchanges++
      res.writeHead(303, { location: './', 'set-cookie': `dsh-credential=${generation}; HttpOnly; Path=/` }).end()
      return
    }
    seen.push({ url: req.url, headers: req.headers, method: req.method })
    if (req.headers.cookie !== `dsh-credential=${generation}`) { res.writeHead(401).end(); return }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => res.writeHead(200, { 'set-cookie': 'dsh-hidden=secret', 'content-type': 'text/plain' }).end(body || 'DSH'))
  })
  upstream.on('upgrade', (req, socket) => {
    const entry = { url: req.url, headers: req.headers, upgrade: true, chunks: [], closed: once(socket, 'close') }
    seen.push(entry)
    socket.on('error', () => {})
    socket.on('end', () => socket.end())
    if (req.headers.cookie !== `dsh-credential=${generation}`) { socket.end('HTTP/1.1 401 Refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSet-Cookie: dsh-hidden=secret\r\n\r\n')
    socket.on('data', data => { entry.chunks.push(data.toString()); socket.write(data) })
  })
  const port = await listen(upstream)
  const credentials = new DshCredentials({ launchFile, port })
  const gate = createGate({ origin: ORIGIN, sessions: state.sessions, credentials })
  const gatePort = await listen(gate)
  t.after(async () => { await gate.closeGate(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)) })
  return { ...state, owner, principal, issued, credentials, gate, gatePort, seen, headers: { cookie: `${COOKIE}=${issued.secret}`, origin: ORIGIN }, advance: ms => { now += ms }, restart: () => { generation++; launch() }, exchanges: () => exchanges }
}

test('all paths and methods and upgrades refuse without a session before any DSH connection', async t => {
  const f = await fixture(t)
  const routes = ['/', '/index.html', '/assets/client.js', '/connect', '/api', '/api/remote.mux', '/unknown', '/_gate/sessions', '/_gate/session/renew', '/_gate/sign-out-everywhere', '//other.invalid/path', '/?token=placeholder']
  for (const path of routes) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'TRACE', 'CONNECT']) {
      assert.equal((await request(f.gatePort, path, { method })).status, 401, `${method} ${path}`)
    }
    assert.equal((await request(f.gatePort, path, { headers: websocketHeaders, upgrade: true })).status, 401, `WS ${path}`)
  }
  assert.equal(f.exchanges(), 0)
  assert.equal(f.seen.length, 0)
  const fake = sessionCookie(randomBytes(32).toString('base64url')).split(';')[0]
  assert.equal((await request(f.gatePort, '/', { headers: { cookie: fake } })).status, 401)
})

test('exact origin, port, Host and CSRF checks cannot be overridden with forwarding headers', async t => {
  const f = await fixture(t)
  for (const headers of [
    { origin: 'https://other.invalid:8443' }, { origin: 'https://workspace.invalid:8444' },
    { origin: 'http://workspace.invalid:8443' }, { origin: 'null' },
    { host: 'workspace.invalid:8444' }, { host: 'other.invalid:8443' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'https://other.invalid', 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https', forwarded: `host=${HOST};proto=https` },
  ]) {
    assert.equal((await request(f.gatePort, '/', { headers: { ...f.headers, ...headers } })).status, 401)
    assert.equal((await request(f.gatePort, '/api/remote.mux', { headers: { ...websocketHeaders, ...f.headers, ...headers }, upgrade: true })).status, 401)
  }
  assert.equal((await request(f.gatePort, '/_gate/sign-out-everywhere', { method: 'POST', headers: { cookie: f.headers.cookie } })).status, 401)
  assert.equal((await request(f.gatePort, '/api/remote.mux', { headers: { ...websocketHeaders, ...f.headers, origin: undefined }, upgrade: true })).status, 401)
  assert.equal(f.exchanges(), 0)
  assert.equal(f.sessions.list().length, 1)
})

test('DSH sees only gate credentials and the generated principal; browser never receives DSH cookies', async t => {
  const f = await fixture(t)
  const response = await request(f.gatePort, '/api/example?q=1', { method: 'POST', body: 'payload', headers: { ...f.headers, 'content-type': 'text/plain', authorization: 'Bearer placeholder', 'x-automagik-principal': 'forged', 'x-forwarded-host': 'other.invalid', connection: 'x-automagik-principal' } })
  assert.equal(response.status, 200)
  assert.equal(response.body, 'payload')
  assert.equal(response.headers['set-cookie'], undefined)
  const upstream = f.seen.at(-1)
  assert.equal(upstream.url, '/api/example?q=1')
  assert.equal(upstream.headers.authorization, undefined)
  assert.equal(upstream.headers['x-forwarded-host'], undefined)
  assert.equal(upstream.headers.cookie, 'dsh-credential=1')
  assert.equal(upstream.headers.host, f.credentials.authority)
  assert.deepEqual(JSON.parse(Buffer.from(upstream.headers['x-automagik-principal'], 'base64url')), f.principal)
  assert.equal(f.exchanges(), 1)
  const navigation = await request(f.gatePort, '/', { headers: { cookie: f.headers.cookie } })
  assert.equal(navigation.status, 200, 'same-origin top-level GET may omit Origin')
  for (const path of ['/?token=placeholder', '/connect?token=placeholder', '/connect']) {
    assert.equal((await request(f.gatePort, path, { headers: f.headers })).status, 401)
  }
})

test('renewal rotates and reuse revokes the family, while a second family stays signed in', async t => {
  const f = await fixture(t)
  const second = f.sessions.issue(ORIGIN, f.principal)
  const response = await request(f.gatePort, '/_gate/session/renew', { method: 'POST', headers: f.headers })
  assert.equal(response.status, 200)
  const setCookie = response.headers['set-cookie'][0]
  for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=43200']) assert.ok(setCookie.includes(flag))
  assert.ok(setCookie.startsWith('__Host-'))
  assert.ok(!/Domain=/i.test(setCookie))
  const fresh = setCookie.split(';')[0]
  assert.notEqual(fresh, f.headers.cookie)
  assert.equal((await request(f.gatePort, '/_gate/sessions', { headers: { ...f.headers, cookie: fresh } })).status, 200)
  assert.equal((await request(f.gatePort, '/', { headers: f.headers })).status, 401)
  assert.equal((await request(f.gatePort, '/', { headers: { ...f.headers, cookie: fresh } })).status, 401)
  assert.equal((await request(f.gatePort, '/', { headers: { ...f.headers, cookie: `${COOKIE}=${second.secret}` } })).status, 200)
})

test('session list omits secrets, reports local trust, and sign out everywhere clears all families', async t => {
  const f = await fixture(t)
  f.sessions.issue(ORIGIN, f.principal)
  const response = await request(f.gatePort, '/_gate/sessions', { headers: f.headers })
  const list = JSON.parse(response.body)
  assert.equal(list.sessions.length, 2)
  assert.equal(list.current, f.issued.family.id)
  assert.match(list.local_trust_notice, /replay.*Origin/)
  assert.ok(!response.body.includes(f.issued.secret))
  const logout = await request(f.gatePort, '/_gate/sign-out-everywhere', { method: 'POST', headers: f.headers })
  assert.equal(logout.status, 200)
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/)
  assert.equal((await request(f.gatePort, '/', { headers: f.headers })).status, 401)
  assert.equal(new SessionStore(f.dir).list().length, 0)
})

test('sessions slide for 12-hour idle, survive restart as hashes, and stay origin-bound', t => {
  let now = 0
  const f = store(t, { now: () => now })
  const owner = createOwner(f.dir)
  const issued = f.sessions.issue(ORIGIN, principalOf(owner))
  const saved = readFileSync(join(f.dir, 'sessions.json'), 'utf8')
  assert.ok(!saved.includes(issued.secret))
  assert.equal(statSync(join(f.dir, 'sessions.json')).mode & 0o777, 0o600)
  const restarted = new SessionStore(f.dir, { now: () => now })
  assert.equal(restarted.authenticate(issued.secret, 'https://other.invalid'), undefined)
  now += IDLE_MS - 1
  assert.ok(restarted.authenticate(issued.secret, ORIGIN))
  now += IDLE_MS - 1
  const family = restarted.authenticate(issued.secret, ORIGIN)
  assert.ok(family)
  const rotated = restarted.renew(family)
  const again = new SessionStore(f.dir, { now: () => now })
  assert.ok(again.authenticate(rotated, ORIGIN))
  assert.equal(again.authenticate(issued.secret, ORIGIN), undefined)
  assert.equal(again.authenticate(rotated, ORIGIN), undefined)
  const idle = again.issue(ORIGIN, principalOf(owner))
  now += IDLE_MS
  assert.equal(again.authenticate(idle.secret, ORIGIN), undefined)
})

test('random owner ids persist; unknown, corrupt or linked records never reopen a claim', t => {
  const a = store(t), b = store(t)
  assert.equal(readOwner(a.dir), undefined)
  const first = createOwner(a.dir), second = createOwner(b.dir)
  assert.notEqual(first.instance_id, second.instance_id)
  assert.notEqual(first.local_id, second.local_id)
  assert.deepEqual(readOwner(a.dir), first)
  assert.equal(statSync(join(a.dir, 'owner.json')).mode & 0o777, 0o600)
  assert.deepEqual(principalOf(first), { issuer: `local:${first.instance_id}`, subject: first.local_id, roles: ['owner'], workspace: first.instance_id })
  for (const record of [{ ...first, version: 2 }, { ...first, linked: {} }, { version: 1 }, '{bad json']) {
    const bytes = typeof record === 'string' ? record : JSON.stringify(record)
    writeFileSync(join(a.dir, 'owner.json'), bytes)
    assert.throws(() => readOwner(a.dir))
    assert.throws(() => createOwner(a.dir), { code: 'EEXIST' })
    assert.equal(readFileSync(join(a.dir, 'owner.json'), 'utf8'), bytes)
  }
})

test('a DSH restart re-reads the launch credential; failed POST is never replayed', async t => {
  const f = await fixture(t)
  assert.equal((await request(f.gatePort, '/', { headers: f.headers })).status, 200)
  f.restart()
  assert.equal((await request(f.gatePort, '/api/mutate', { method: 'POST', body: 'once', headers: f.headers })).status, 401)
  assert.equal((await request(f.gatePort, '/', { headers: f.headers })).status, 200)
  assert.equal(f.exchanges(), 2)
  assert.equal(f.seen.filter(r => r.method === 'POST').length, 1)
})

test('authenticated upgrades carry the principal and close on logout, replay and idle expiry', async t => {
  for (const reason of ['logout', 'replay', 'idle']) await t.test(reason, async t => {
    const f = await fixture(t)
    const response = await request(f.gatePort, '/api/remote.mux', { headers: { ...websocketHeaders, ...f.headers }, upgrade: true })
    assert.equal(response.status, 101)
    assert.equal(response.headers['set-cookie'], undefined)
    const socket = response.socket
    t.after(() => socket.destroy())
    const seen = f.seen.at(-1)
    assert.equal(seen.headers.cookie, 'dsh-credential=1')
    assert.deepEqual(JSON.parse(Buffer.from(seen.headers['x-automagik-principal'], 'base64url')), f.principal)
    const data = once(socket, 'data')
    socket.write('echo')
    assert.equal((await data)[0].toString(), 'echo')
    const closed = once(socket, 'close')
    socket.resume()
    if (reason === 'logout') f.sessions.revokeAll()
    if (reason === 'replay') { f.sessions.renew(f.issued.family); f.sessions.authenticate(f.issued.secret, ORIGIN) }
    if (reason === 'idle') { f.advance(IDLE_MS); socket.write('must-not-reach-dsh') }
    await closed
    await seen.closed
    assert.deepEqual(seen.chunks, ['echo'], 'no post-expiry frame reaches DSH')
  })
})

test('cookies reject duplicates and malformed values; configured origins are exact', () => {
  const value = randomBytes(32).toString('base64url')
  assert.equal(cookieSecret(`${COOKIE}=${value}`), value)
  assert.equal(cookieSecret(`${COOKIE}=${value}; ${COOKIE}=${value}`), undefined)
  assert.equal(cookieSecret(`${COOKIE}=bad`), undefined)
  assert.match(sessionCookie(value), /; Secure;/)
  for (const invalid of ['http://workspace.invalid', `${ORIGIN}/`, `${ORIGIN}/path`, `${ORIGIN}?x=1`, 'file:///tmp/gate']) assert.throws(() => pinOrigin(invalid))
  assert.equal(pinOrigin(ORIGIN).origin, ORIGIN)
  assert.equal(pinOrigin('http://localhost:3082').origin, 'http://localhost:3082')
})

test('the shipped gate stays disabled without explicit configuration', () => {
  assert.throws(() => execFileSync(process.execPath, ['server/gate-entrypoint.mjs'], { env: { PATH: process.env.PATH }, stdio: 'pipe' }), error => {
    assert.equal(error.status, 1)
    assert.match(error.stderr.toString(), /disabled or invalid/)
    return true
  })
})

// Real pinned DSH BrowserAuth, extracted without the unrelated plugin imports. This proves
// that its version-1 browser credential is also the owner credential admitted by /api.
test('gate exchange works against the pinned DSH authenticator, including restart recovery', async t => {
  const text = source('../../apps/desktop/test/fixtures/client-connection-cookie-lax/index.js')
  const manifest = JSON.parse(source('../../apps/desktop/runtime/patches/patches.json'))
  const pin = manifest.find(p => p.patch === 'client-connection-cookie-lax.patch')
  assert.equal(createHash('sha256').update(text).digest('hex'), pin.files[0].before)
  const start = text.indexOf('const AUTH_RECORD_KEY =')
  const end = text.indexOf('//#endregion', start)
  const { BrowserAuth } = runInNewContext(`${text.slice(start, end)}\n({ BrowserAuth })`, {
    Buffer, URL, Headers, Date, createHash, randomBytes,
    timingSafeEqual, createHmac,
    credentialKey: (a, b) => `${a}:${b}`,
  })
  let auth = new BrowserAuth({}, randomBytes(32), 30)
  const f = store(t)
  const launchFile = join(f.dir, 'launch')
  const server = http.createServer((req, res) => {
    if (auth.authorizeIndex(req, res)) res.end('owner')
  })
  const port = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const credentials = new DshCredentials({ launchFile, port })
  writeFileSync(launchFile, auth.authenticatedUrl(`http://ignored.invalid/`))
  const cookie = await credentials.cookie()
  assert.equal(auth.isAuthenticated({ headers: { host: credentials.authority, cookie } }), true)
  auth = new BrowserAuth({}, randomBytes(32), 30)
  assert.equal(auth.isAuthenticated({ headers: { host: credentials.authority, cookie } }), false)
  writeFileSync(launchFile, auth.authenticatedUrl('http://ignored.invalid/'))
  const fresh = await credentials.cookie(true)
  assert.notEqual(fresh, cookie)
  assert.equal(auth.isAuthenticated({ headers: { host: credentials.authority, cookie: fresh } }), true)
})

test('malformed and newer session stores fail startup, never become empty valid stores', t => {
  const f = store(t)
  for (const record of [null, {}, { version: 2, families: [] }, { version: 1, families: [{}] }]) {
    const bytes = JSON.stringify(record)
    writeFileSync(join(f.dir, 'sessions.json'), bytes)
    assert.throws(() => new SessionStore(f.dir))
    assert.equal(readFileSync(join(f.dir, 'sessions.json'), 'utf8'), bytes)
  }
  assert.throws(() => f.sessions.issue(ORIGIN, { issuer: 'local:placeholder', subject: 'placeholder', roles: ['admin'], workspace: 'placeholder' }))
})

// Mutant REFUSE_FIN_ONLY restores end(response) without descriptor destruction or deadline.
test('refused half-open WebSocket and CONNECT clients release server descriptors', async t => {
  const f = await fixture(t)
  const clients = []
  try {
    for (const kind of ['upgrade', 'connect']) {
      const probes = Array.from({ length: 5 }, async () => {
        const socket = net.connect({ host: DSH_HOST, port: f.gatePort, allowHalfOpen: true })
        clients.push(socket)
        socket.on('error', () => {})
        await once(socket, 'connect')
        let response = ''
        socket.setEncoding('utf8')
        socket.on('data', chunk => { response += chunk })
        const ended = once(socket, 'end')
        socket.write(kind === 'upgrade'
          ? `GET /api/remote.mux HTTP/1.1\r\nHost: ${HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`
          : `CONNECT ${HOST} HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`)
        await ended
        assert.match(response, /^HTTP\/1\.1 401 Refused/)
        assert.equal(socket.writableEnded, false, 'the client deliberately keeps its writable half open')
      })
      await Promise.all(probes)
    }
    const deadline = Date.now() + 1500
    let connections
    do {
      connections = await new Promise((resolve, reject) => f.gate.getConnections((error, count) => error ? reject(error) : resolve(count)))
      if (connections === 0) break
      await new Promise(resolve => setTimeout(resolve, 10))
    } while (Date.now() < deadline)
    assert.equal(connections, 0, 'refused half-open sockets must release all gate descriptors')
    assert.equal(f.exchanges(), 0)
  } finally {
    for (const client of clients) client.destroy()
  }
})

function observeConstantTime(t) {
  const comparisons = []
  const real = crypto.timingSafeEqual
  t.mock.method(crypto, 'timingSafeEqual', (left, right) => {
    assert.ok(Buffer.isBuffer(left) && Buffer.isBuffer(right))
    assert.equal(left.length, 32)
    assert.equal(right.length, 32)
    comparisons.push(left.toString('hex'))
    return real(left, right)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  return comparisons
}

// Mutant CURRENT_HASH_STRING_EQUALITY replaces only the current timingSafeEqual call.
test('current session hashes use fixed-length timingSafeEqual', t => {
  const comparisons = observeConstantTime(t)
  const f = store(t)
  const issued = f.sessions.issue(ORIGIN, principalOf(createOwner(f.dir)))
  assert.equal(f.sessions.authenticate(issued.secret, ORIGIN), issued.family)
  assert.deepEqual(comparisons, [issued.family.current], 'current hash must use timingSafeEqual')
})

// Mutant ROTATED_HASH_STRING_EQUALITY replaces historical comparisons with string matching.
test('every rotated hash uses timingSafeEqual even when the current hash matched', t => {
  const comparisons = observeConstantTime(t)
  const f = store(t)
  const issued = f.sessions.issue(ORIGIN, principalOf(createOwner(f.dir)))
  f.sessions.renew(issued.family)
  const latest = f.sessions.renew(issued.family)
  const expected = [issued.family.current, ...issued.family.used]
  assert.equal(f.sessions.authenticate(latest, ORIGIN), issued.family)
  assert.deepEqual(comparisons, expected, 'current match must still compare all rotated hashes with timingSafeEqual')
  comparisons.length = 0
  assert.equal(f.sessions.authenticate(issued.secret, ORIGIN), undefined)
  assert.deepEqual(comparisons, expected, 'replay must compare every rotated hash with timingSafeEqual')
  assert.equal(f.sessions.list().length, 0)
})
