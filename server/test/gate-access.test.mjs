import assert from 'node:assert/strict'
import { constants, createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { AccessConfigurationError, accessConfig, AccessSignIn, CERT_TTL_MS, CLOCK_SKEW_SECONDS, fetchAccessKeys, REFRESH_INTERVAL_MS } from '../gate-access.mjs'
import { createGate } from '../gate.mjs'
import { COOKIE, readOwner, SessionStore } from '../gate-store.mjs'
import { DSH_HOST } from '../gate-upstream.mjs'

// Reserved placeholders only. Private keys are generated in memory on every test run.
const ORIGIN = 'https://workspace.invalid'
const ENV = {
  AUTOMAGIK_GATE_ACCESS_TEAM_DOMAIN: 'team.invalid',
  AUTOMAGIK_GATE_ACCESS_AUD: '{application-audience}',
  AUTOMAGIK_GATE_ACCESS_EMAILS: 'owner@example.invalid',
}
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
const current = pair(), next = pair()
const jwk = (key, kid) => ({ ...key.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' })
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
async function listen(server) { server.listen(0, DSH_HOST); await once(server, 'listening'); return server.address().port }
function request(port, { path = '/', method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: DSH_HOST, port, path, method, headers: { host: new URL(ORIGIN).host, ...headers } }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', part => { body += part })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.on('connect', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode, headers: response.headers, body: '' }) })
    req.on('upgrade', (response, socket) => resolve({ status: response.statusCode, headers: response.headers, socket, body: '' }))
    req.setTimeout(5000, () => req.destroy(new Error('Test timeout')))
    req.end()
  })
}
async function fixture(t, env = ENV) {
  let now = 1_800_000_000_000
  const dir = mkdtempSync(join(tmpdir(), 'automagik-access-'))
  const config = accessConfig(ENV)
  const audit = [], fetched = [], proxied = []
  let status = 200, document = { keys: [jwk(current, 'current')] }
  const issuer = http.createServer((req, res) => {
    fetched.push({ path: req.url, headers: req.headers })
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(document))
  })
  const issuerPort = await listen(issuer)
  const loader = url => {
    assert.equal(url.href, `${config.issuer}/cdn-cgi/access/certs`, 'cert location comes only from configured team')
    return fetchAccessKeys(url, { request: (endpoint, options, callback) => http.get({ ...options, hostname: DSH_HOST, port: issuerPort, path: endpoint.pathname }, callback) })
  }
  const enabled = accessConfig(env)
  const access = enabled ? new AccessSignIn(enabled, { ownerDir: dir, now: () => now, loadKeys: loader }) : undefined
  const sessions = new SessionStore(dir, { now: () => now })
  const upstream = http.createServer((req, res) => {
    proxied.push(req.headers)
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'dsh-hidden=secret' }).end(JSON.stringify({ principal: JSON.parse(Buffer.from(req.headers['x-automagik-principal'], 'base64url')), cookie: req.headers.cookie }))
  })
  upstream.on('upgrade', (req, socket) => {
    proxied.push(req.headers)
    socket.on('error', () => {})
    socket.on('end', () => socket.end())
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSet-Cookie: dsh-hidden=secret\r\n\r\n')
    socket.on('data', data => socket.write(data))
  })
  const upstreamPort = await listen(upstream)
  const gate = createGate({ origin: ORIGIN, sessions, credentials: { port: upstreamPort, authority: `${DSH_HOST}:${upstreamPort}`, cookie: async () => 'dsh-credential=server-held' }, access, auditAccess: entry => audit.push(entry) })
  const gatePort = await listen(gate)
  t.after(async () => {
    await gate.closeGate()
    issuer.closeAllConnections(); upstream.closeAllConnections()
    await Promise.all([new Promise(resolve => issuer.close(resolve)), new Promise(resolve => upstream.close(resolve))])
    rmSync(dir, { recursive: true, force: true })
  })
  const token = ({ claims = {}, header = {}, key = current, hmac = false } = {}) => {
    const time = Math.floor(now / 1000)
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'current', ...header })}.${encode({ iss: config.issuer, aud: [config.audience], iat: time - 1, nbf: time - 1, exp: time + 600, email: 'owner@example.invalid', type: 'app', sub: '{person-subject}', ...claims })}`
    const signature = hmac
      ? createHmac('sha256', current.publicKey.export({ format: 'pem', type: 'spki' })).update(input).digest()
      : sign('RSA-SHA256', Buffer.from(input), { key: key.privateKey, padding: constants.RSA_PKCS1_PADDING })
    return `${input}.${signature.toString('base64url')}`
  }
  return { dir, config, access, sessions, audit, fetched, proxied, gatePort, token, advance: ms => { now += ms }, now: () => now / 1000, down: () => { status = 503 }, up: () => { status = 200 }, publish: value => { document = value }, stopIssuer: () => new Promise(resolve => issuer.close(resolve)) }
}
const assertion = value => ({ 'cf-access-jwt-assertion': value })

// Mutant ACCESS_ALWAYS_ACCEPT skips verification and would admit these negative assertions.
test('valid Access assertion mints the normal gate cookie and stable random local owner', async t => {
  const f = await fixture(t, { ...ENV, AUTOMAGIK_GATE_ACCESS_EMAILS: ' OWNER@EXAMPLE.INVALID , alternate@example.invalid ' })
  const jwt = f.token({ claims: { email: 'OwNeR@ExAmPlE.InVaLiD' } })
  const response = await request(f.gatePort, { headers: { ...assertion(jwt), 'cf-access-authenticated-user-email': 'forged@example.invalid' } })
  assert.equal(response.status, 200)
  const cookie = response.headers['set-cookie'][0]
  assert.match(cookie, /^__Host-automagik-session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/)
  assert.ok(!response.body.includes(jwt))
  const owner = readOwner(f.dir)
  const body = JSON.parse(response.body)
  assert.deepEqual(body.principal, { issuer: `local:${owner.instance_id}`, subject: owner.local_id, workspace: owner.instance_id, roles: ['owner'] })
  assert.equal(body.cookie, 'dsh-credential=server-held')
  assert.equal(f.proxied[0]['cf-access-jwt-assertion'], undefined)
  assert.equal(f.proxied[0]['cf-access-authenticated-user-email'], undefined)
  assert.equal(f.fetched.length, 1)
  assert.equal(f.fetched[0].headers['cf-access-jwt-assertion'], undefined)
  const again = await request(f.gatePort, { headers: { cookie: cookie.split(';')[0] } })
  assert.equal(again.status, 200)
  assert.equal(again.headers['set-cookie'], undefined)
  assert.deepEqual(readOwner(f.dir), owner)
  assert.equal(f.fetched.length, 1)
  assert.deepEqual(f.audit, [])
})

test('wrong issuer, audience, e-mail, signature, type or clock claims cannot establish a session', async t => {
  const f = await fixture(t)
  const cases = [
    ['audience', { claims: { aud: ['{other-audience}'] } }],
    ['issuer', { claims: { iss: 'https://other.invalid' } }],
    ['expired', { claims: { exp: f.now() - CLOCK_SKEW_SECONDS, iat: f.now() - 600, nbf: f.now() - 600 } }],
    ['not yet valid', { claims: { nbf: f.now() + CLOCK_SKEW_SECONDS + 1 } }],
    ['future issued', { claims: { iat: f.now() + CLOCK_SKEW_SECONDS + 1 } }],
    ['missing issued', { claims: { iat: undefined } }],
    ['missing expiry', { claims: { exp: undefined } }],
    ['missing nbf', { claims: { nbf: undefined } }],
    ['string timestamp', { claims: { exp: String(f.now() + 600) } }],
    ['e-mail', { claims: { email: 'other@example.invalid' } }],
    ['whitespace e-mail', { claims: { email: ' owner@example.invalid ' } }],
    ['e-mail missing', { claims: { email: undefined } }],
    ['organisation token', { claims: { type: 'org' } }],
    ['wrong signature', { key: next }],
    ['untrusted critical header', { header: { crit: ['untrusted'] } }],
    ['unencoded payload', { header: { b64: false } }],
  ]
  for (const [name, options] of cases) {
    assert.equal((await request(f.gatePort, { headers: { ...assertion(f.token(options)), 'cf-access-authenticated-user-email': 'owner@example.invalid' } })).status, 401, name)
  }
  assert.equal(f.sessions.list().length, 0)
  assert.equal(existsSync(join(f.dir, 'owner.json')), false)
  for (const entry of f.audit) {
    assert.deepEqual(Object.keys(entry).sort(), ['request_id', 'status'])
    assert.equal(entry.status, 401)
    assert.match(entry.request_id, /^[a-f0-9-]{36}$/)
  }
  assert.equal(f.audit.length, cases.length)
  assert.ok(!JSON.stringify(f.audit).includes('example.invalid'))
})

test('alg none and HS256 signed with the RSA public key are refused before fetching certs', async t => {
  const f = await fixture(t)
  const none = f.token({ header: { alg: 'none' } }).replace(/\.[^.]+$/, '.')
  for (const jwt of [none, f.token({ header: { alg: 'none' } }), f.token({ header: { alg: 'HS256' } }), f.token({ header: { alg: 'HS256' }, hmac: true })]) {
    assert.equal((await request(f.gatePort, { headers: assertion(jwt) })).status, 401)
  }
  assert.equal(f.fetched.length, 0)
  assert.equal(f.sessions.list().length, 0)
})

test('missing assertion and e-mail-only headers refuse; mode off has identical 401 bytes and no cert connection', async t => {
  const enabled = await fixture(t)
  for (const headers of [{}, { 'cf-access-authenticated-user-email': 'owner@example.invalid' }]) {
    const response = await request(enabled.gatePort, { headers })
    assert.equal(response.status, 401)
    assert.equal(response.headers['set-cookie'], undefined)
  }
  assert.equal(enabled.fetched.length, 0)
  const disabled = await fixture(t, {})
  const plain = await request(disabled.gatePort)
  const withHeader = await request(disabled.gatePort, { headers: assertion(disabled.token()) })
  assert.equal(withHeader.status, plain.status)
  assert.equal(withHeader.body, plain.body)
  assert.equal(withHeader.headers['set-cookie'], undefined)
  assert.equal(disabled.fetched.length, 0)
  assert.deepEqual(disabled.audit, [])
  assert.equal(existsSync(join(disabled.dir, 'owner.json')), false)
})

test('fresh cert cache is bounded, unknown kid refetches are rate limited and key rotation works', async t => {
  const f = await fixture(t)
  const principal = await f.access.signIn(f.token())
  await f.access.signIn(f.token())
  assert.equal(f.fetched.length, 1)
  f.advance(REFRESH_INTERVAL_MS + 1)
  await assert.rejects(f.access.signIn(f.token({ header: { kid: 'unknown' } })))
  assert.equal(f.fetched.length, 2)
  for (let i = 0; i < 5; i++) await assert.rejects(f.access.signIn(f.token({ header: { kid: `unknown-${i}` } })))
  assert.equal(f.fetched.length, 2)
  f.publish({ keys: [jwk(current, 'current'), jwk(next, 'next')] })
  f.advance(REFRESH_INTERVAL_MS + 1)
  assert.deepEqual(await f.access.signIn(f.token({ header: { kid: 'next' }, key: next })), principal)
  assert.equal(f.fetched.length, 3)
  f.advance(CERT_TTL_MS + 1)
  await f.access.signIn(f.token({ header: { kid: 'next' }, key: next }))
  assert.equal(f.fetched.length, 4, 'expired cache refetches even a known kid')
})

test('unreachable cert endpoint fails closed and failed refresh cannot use cached keys', async t => {
  const f = await fixture(t)
  await f.access.signIn(f.token())
  f.advance(CERT_TTL_MS + 1)
  f.down()
  await assert.rejects(f.access.signIn(f.token()))
  const attempted = f.fetched.length
  await assert.rejects(f.access.signIn(f.token()))
  assert.equal(f.fetched.length, attempted, 'failed fetch is also rate limited')
  f.up(); f.advance(REFRESH_INTERVAL_MS + 1)
  await f.access.signIn(f.token())
  const fresh = await fixture(t)
  await fresh.stopIssuer()
  const response = await request(fresh.gatePort, { headers: assertion(fresh.token()) })
  assert.equal(response.status, 401)
  assert.equal(response.headers['set-cookie'], undefined)
  assert.equal(fresh.sessions.list().length, 0)
})

test('concurrent assertions share the cert fetch and leave one owner record', async t => {
  const f = await fixture(t)
  const principals = await Promise.all(Array.from({ length: 8 }, () => f.access.signIn(f.token())))
  assert.equal(f.fetched.length, 1)
  for (const principal of principals) assert.deepEqual(principal, principals[0])
  assert.equal(readOwner(f.dir).instance_id, principals[0].workspace)
})

test('existing sessions rotate and revoke normally; old cookies cannot silently reauthenticate with Access', async t => {
  const f = await fixture(t)
  const jwt = f.token()
  const entered = await request(f.gatePort, { headers: assertion(jwt) })
  const original = entered.headers['set-cookie'][0].split(';')[0]
  const renewed = await request(f.gatePort, { method: 'POST', path: '/_gate/session/renew', headers: { cookie: original, origin: ORIGIN } })
  const latest = renewed.headers['set-cookie'][0].split(';')[0]
  assert.notEqual(latest, original)
  assert.equal((await request(f.gatePort, { headers: { cookie: original, ...assertion(jwt) } })).status, 401)
  assert.equal((await request(f.gatePort, { headers: { cookie: latest, ...assertion(jwt) } })).status, 401)
  assert.equal(f.sessions.list().length, 0)
  const enteredAgain = await request(f.gatePort, { headers: assertion(jwt) })
  const logoutCookie = enteredAgain.headers['set-cookie'][0].split(';')[0]
  const logout = await request(f.gatePort, { method: 'POST', path: '/_gate/sign-out-everywhere', headers: { cookie: logoutCookie, origin: ORIGIN } })
  assert.equal(logout.status, 200)
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/)
  assert.equal((await request(f.gatePort, { headers: { cookie: logoutCookie, ...assertion(jwt) } })).status, 401)
})

test('Access still pins Host and Origin; only verified safe top-level navigation may be cross-site', async t => {
  const f = await fixture(t)
  const headers = assertion(f.token())
  for (const extra of [{ host: 'other.invalid' }, { host: 'workspace.invalid:444' }, { origin: 'https://other.invalid' }, { origin: 'https://workspace.invalid:444' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await request(f.gatePort, { headers: { ...headers, ...extra } })).status, 401)
  }
  assert.equal((await request(f.gatePort, { method: 'POST', headers })).status, 401)
  assert.equal((await request(f.gatePort, { path: '/?token=placeholder', headers })).status, 401)
  assert.equal(f.fetched.length, 0)
  const navigation = await request(f.gatePort, { headers: { ...headers, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } })
  assert.equal(navigation.status, 200)
  assert.ok(navigation.headers['set-cookie'])
})

test('token key URLs are ignored, malformed cert sets fail closed, and no key is taken from the JWT', async t => {
  const f = await fixture(t)
  const jwt = f.token({ header: { jku: 'https://other.invalid/keys', jwk: jwk(next, 'current') }, key: next })
  assert.equal((await request(f.gatePort, { headers: assertion(jwt) })).status, 401)
  assert.equal(f.fetched.length, 1)
  assert.equal(f.fetched[0].path, '/cdn-cgi/access/certs')
  f.publish({ keys: [jwk(current, 'current'), jwk(next, 'current')] })
  f.advance(CERT_TTL_MS + 1)
  await assert.rejects(f.access.signIn(f.token()))
})

test('all-or-none fixed settings validate domain-only values and name missing settings at startup', () => {
  assert.equal(accessConfig({}), undefined)
  const names = Object.keys(ENV)
  for (const present of [names.slice(0, 1), names.slice(0, 2), names.slice(1), names.slice(2)]) {
    const env = Object.fromEntries(present.map(name => [name, ENV[name]]))
    assert.throws(() => accessConfig(env), error => {
      assert.ok(error instanceof AccessConfigurationError)
      for (const name of names.filter(name => !present.includes(name))) assert.ok(error.message.includes(name))
      return true
    })
  }
  for (const domain of ['https://team.invalid', 'team.invalid/path', 'team.invalid:443', 'user@team.invalid', '*.team.invalid', 'team.invalid.', 'localhost', 'bad_host.invalid']) {
    assert.throws(() => accessConfig({ ...ENV, AUTOMAGIK_GATE_ACCESS_TEAM_DOMAIN: domain }), AccessConfigurationError)
  }
  const missing = { AUTOMAGIK_GATE_ACCESS_TEAM_DOMAIN: ENV.AUTOMAGIK_GATE_ACCESS_TEAM_DOMAIN }
  assert.throws(() => execFileSync(process.execPath, ['server/gate-entrypoint.mjs'], { env: { ...missing, PATH: process.env.PATH }, stdio: 'pipe' }), error => {
    assert.equal(error.status, 1)
    assert.ok(error.stderr.toString().includes('AUTOMAGIK_GATE_ACCESS_AUD'))
    assert.ok(error.stderr.toString().includes('AUTOMAGIK_GATE_ACCESS_EMAILS'))
    assert.ok(!error.stderr.toString().includes(ENV.AUTOMAGIK_GATE_ACCESS_TEAM_DOMAIN))
    return true
  })
})

// Mutant ACCESS_ENTRY_PREFETCH performs a key lookup before checking optional mode settings.
test('the real unset-mode entrypoint opens no HTTPS or fetch connection even with an assertion', async t => {
  const f = await fixture(t, {})
  const marker = join(f.dir, 'outbound-attempt')
  const guard = join(f.dir, 'no-outbound.mjs')
  writeFileSync(guard, `import https from 'node:https'; import { writeFileSync } from 'node:fs';
const denied = () => { writeFileSync(${JSON.stringify(marker)}, 'attempted'); throw new Error('Unexpected outbound'); };
https.get = denied; https.request = denied; globalThis.fetch = denied;
`)
  const reservation = http.createServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, 'server/gate-entrypoint.mjs'], {
    env: { PATH: process.env.PATH, TMPDIR: tmpdir(), AUTOMAGIK_GATE_ENABLED: '1', AUTOMAGIK_GATE_ORIGIN: ORIGIN, AUTOMAGIK_GATE_PORT: String(port), AUTOMAGIK_GATE_HOME: join(f.dir, 'entry-home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Entry startup timeout')), 5000)
      child.stdout.on('data', chunk => { if (chunk.toString().includes('listening on loopback')) { clearTimeout(timer); resolve() } })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Entry exited ${code}; outbound=${existsSync(marker)}; ${stderr}`)) })
    })
    const response = await request(port, { headers: assertion(f.token()) })
    assert.equal(response.status, 401)
    assert.equal(response.body, JSON.stringify({ error: 'Session required' }))
    assert.equal(response.headers['set-cookie'], undefined)
    assert.equal(existsSync(marker), false, 'unset Access mode must never attempt outbound HTTPS or fetch')
    assert.equal(stderr, '')
  } finally {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
})

// Mutant RESERVED_PATH_RAW_FORWARD disables the alias rejection before authentication.
test('reserved gate aliases get 400 before Access sign-in for encoded and dot-segment spellings', async t => {
  for (const env of [ENV, {}]) {
    const f = await fixture(t, env)
    const paths = ['/x//../_gate/sessions', '/x/..//_gate/sessions', '/.//_gate/sessions', '/_gate', '/_gate/../outside', '/x/../_gate/sessions', '/x/%2e%2e/_gate/sessions', '/%5fgate/sessions', '/_gat%65/sessions', '/%255fgate/sessions', '/_gate%2fsessions', '/%2f_gate/sessions', '/_gate/./sessions', '/_gate/%2e/sessions', '/_gate/session/../sessions', '/_gate/%73essions', '/_gate//sessions', '/_gate%5csessions']
    for (const path of paths) {
      for (const options of [{ headers: assertion(f.token()) }, { method: 'CONNECT', headers: assertion(f.token()) }, { headers: { ...assertion(f.token()), connection: 'Upgrade', upgrade: 'websocket', origin: ORIGIN } }]) {
        const response = await request(f.gatePort, { path, ...options })
        assert.equal(response.status, 400, `non-canonical gate path: ${path}`)
        assert.equal(response.headers['set-cookie'], undefined)
      }
    }
    assert.equal(f.fetched.length, 0)
    assert.equal(f.sessions.list().length, 0)
    assert.equal(f.proxied.length, 0)
    // Canonical management still requires authentication; ordinary raw upstream paths survive.
    assert.equal((await request(f.gatePort, { path: '/_gate/sessions' })).status, 401)
    if (env === ENV) assert.equal((await request(f.gatePort, { path: '/files/a%2Fb', headers: assertion(f.token()) })).status, 200)
  }
})

test('an assertion that expires during certificate lookup cannot establish an owner', async t => {
  const f = await fixture(t)
  const load = f.access.loadKeys
  f.access.loadKeys = async url => { const keys = await load(url); f.advance(60_000); return keys }
  const jwt = f.token({ claims: { exp: f.now() + 1 } })
  assert.equal((await request(f.gatePort, { headers: assertion(jwt) })).status, 401)
  assert.equal(f.sessions.list().length, 0)
  assert.equal(existsSync(join(f.dir, 'owner.json')), false)
})

test('invalid URL syntax is rejected before the reserved-path guard can throw', async t => {
  const f = await fixture(t)
  for (const path of ['//', 'http://[invalid/']) {
    assert.equal((await request(f.gatePort, { path })).status, 400)
  }
  assert.equal(f.fetched.length, 0)
})

test('Access can establish a WebSocket session and sends only its own cookie to the browser', async t => {
  const f = await fixture(t)
  const response = await request(f.gatePort, { path: '/api/remote.mux', headers: { ...assertion(f.token()), connection: 'Upgrade', upgrade: 'websocket', origin: ORIGIN } })
  assert.equal(response.status, 101)
  try {
    assert.equal(response.headers['set-cookie'].length, 1)
    assert.match(response.headers['set-cookie'][0], /^__Host-automagik-session=/)
    assert.equal(f.proxied[0]['cf-access-jwt-assertion'], undefined)
    assert.equal(f.proxied[0].cookie, 'dsh-credential=server-held')
    const echoed = once(response.socket, 'data')
    response.socket.write('owner')
    assert.equal((await echoed)[0].toString(), 'owner')
    const closed = once(response.socket, 'close')
    response.socket.resume()
    f.sessions.revokeAll()
    await closed
  } finally { response.socket.destroy() }
})
