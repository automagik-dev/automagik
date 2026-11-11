import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { Script } from 'node:vm'
import { CLAIM_MS, CHALLENGE_MS, ClaimConfigurationError, SelfHostedClaim, passkeyOrigin } from '../gate-claim.mjs'
import { controlServer, hostCommand } from '../gate-control.mjs'
import { SessionStore, readOwner } from '../gate-store.mjs'
import { createGate } from '../gate.mjs'
import { DSH_HOST } from '../gate-upstream.mjs'
import { SoftwareAuthenticator } from './fixtures/software-authenticator.mjs'
import { claimPage } from '../gate-claim-ui.mjs'

const ORIGIN = 'http://localhost:4381'
const listen = async server => { server.listen(0, DSH_HOST); await once(server, 'listening'); return server.address().port }

// Mutant UI_LITERAL_NEWLINE emits invalid JavaScript inside the rendered HTML.
test('every generated sign-in page contains browser-parseable JavaScript', () => {
  for (const mode of ['claim', 'sign-in', 'recovery', 'settings']) {
    const html = claimPage(mode, 'fixture-nonce')
    const script = html.match(/<script nonce="fixture-nonce">([\s\S]*?)<\/script>/)?.[1]
    assert.ok(script)
    assert.doesNotThrow(() => new Script(script))
  }
})
async function fixture(t, { origin = ORIGIN, interactive = false, published = DSH_HOST } = {}) {
  let now = Date.now(), closed = false
  const dir = mkdtempSync(join(tmpdir(), 'automagik-claim-'))
  const sessions = new SessionStore(dir, { now: () => now })
  const logs = [], shown = [], seen = []
  const claim = new SelfHostedClaim({ dir, origin, sessions, now: () => now, audit: record => logs.push(record) })
  const control = await controlServer(claim)
  await claim.start({ interactive, show: value => shown.push(value) })
  const upstream = http.createServer((req, res) => { seen.push(req.url); res.end('workspace') })
  const upstreamPort = await listen(upstream)
  const gate = createGate({ origin, sessions, credentials: { authority: `${DSH_HOST}:${upstreamPort}`, port: upstreamPort, cookie: async () => 'dsh=server-held' }, selfHosted: claim })
  const port = await listen(gate)
  claim.bindingChange = (claimed, drop) => gate.rebind(port, () => claim.claimed ? published : DSH_HOST, drop)
  const request = (path, { data, cookie, headers = {}, method = data === undefined ? 'GET' : 'POST' } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: DSH_HOST, port, path, method, headers: { host: new URL(origin).host,
      connection: 'close', ...(data === undefined ? {} : { origin, 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', value => { text += value });
      res.on('end', () => { let body; try { body = JSON.parse(text) } catch { body = text } resolve({ status: res.statusCode, headers: res.headers, text, body }) })
    })
    req.on('error', reject); req.setTimeout(8000, () => req.destroy(new Error('Test request timeout')))
    req.end(data === undefined ? undefined : JSON.stringify(data))
  })
  const code = () => interactive ? shown.at(-1) : readFileSync(join(dir, 'claim-code'), 'utf8').trim()
  const close = async () => { if (closed) return; closed = true; await gate.closeGate(); await new Promise(resolve => control.close(resolve)); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)) }
  t.after(async () => { await close(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, sessions, claim, gate, request, logs, shown, seen, code, origin, advance: ms => { now += ms }, close }
}
const cookieOf = response => response.headers['set-cookie']?.[0].split(';')[0]
async function enroll(f, device = new SoftwareAuthenticator()) {
  const code = f.code()
  const options = await f.request('/_gate/claim/options', { data: { code } })
  assert.equal(options.status, 200)
  const credential = device.register(options.body.options, f.origin)
  const completed = await f.request('/_gate/claim/verify', { data: { id: options.body.id, code, credential } })
  assert.equal(completed.status, 200)
  return { device, completed, cookie: cookieOf(completed), recovery: completed.body.recoveryCodes, code }
}
async function signIn(f, device) {
  const options = await f.request('/_gate/signin/options', { data: {} })
  assert.equal(options.status, 200)
  const completed = await f.request('/_gate/signin/verify', { data: { id: options.body.id, credential: device.authenticate(options.body.options, f.origin) } })
  assert.equal(completed.status, 200)
  return cookieOf(completed)
}

// Mutants CLAIM_CODE_RESPONSE and CLAIM_NO_EXPIRY expose a secret or allow expired claims.
test('claim code is 128-bit, private, hashed, absent from responses/logs and replaced only by the host', async t => {
  const f = await fixture(t)
  const code = f.code()
  assert.match(code, /^[a-f0-9]{32}$/)
  assert.equal(statSync(join(f.dir, 'claim-code')).mode & 0o777, 0o600)
  const state = readFileSync(join(f.dir, 'claim-state.json'), 'utf8')
  assert.ok(!state.includes(code))
  for (const path of ['/', '/_gate/sign-in', '/_gate/settings', '/_gate/passkeys', '/_gate/claim-code', '/claim-code']) {
    const r = await f.request(path); assert.equal(r.status, 401); assert.ok(!r.text.includes(code))
  }
  const page = await f.request('/_gate/claim')
  assert.equal(page.status, 200); assert.ok(!page.text.includes(code))
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
  f.advance(CLAIM_MS)
  assert.equal((await f.request('/_gate/claim/options', { data: { code } })).status, 401)
  assert.equal(f.code(), code, 'a network request must not replace an expired code')
  await hostCommand(f.dir, 'renew-claim')
  assert.notEqual(f.code(), code)
  assert.equal((await f.request('/_gate/claim/options', { data: { code } })).status, 401)
  assert.ok(!JSON.stringify(f.logs).includes(code))
})

test('interactive host shows the code only through its console callback', async t => {
  const f = await fixture(t, { interactive: true })
  assert.match(f.code(), /^[a-f0-9]{32}$/)
  assert.equal(existsSync(join(f.dir, 'claim-code')), false)
  assert.equal(f.shown.length, 1)
  assert.ok(!readFileSync(join(f.dir, 'claim-state.json'), 'utf8').includes(f.code()))
})

// Mutants CLAIM_BAD_EXPIRY and CLAIM_EXPIRE_DURING_VERIFY permit invalid or late commits.
test('malformed claim expiry fails closed and an expiry during asynchronous work prevents the owner commit', async t => {
  const f = await fixture(t), code = f.code(), path = join(f.dir, 'claim-state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  for (const expires of [undefined, null, 'later', Number.MAX_SAFE_INTEGER + 1]) {
    writeFileSync(path, JSON.stringify({ ...state, expires }))
    assert.throws(() => f.claim.checkCode(code))
  }
  writeFileSync(path, JSON.stringify(state))
  const o = await f.request('/_gate/claim/options', { data: { code } }), device = new SoftwareAuthenticator()
  const original = f.claim.recoveryCodes.bind(f.claim)
  f.claim.recoveryCodes = async () => { const result = await original(); f.advance(CLAIM_MS); return result }
  assert.equal((await f.request('/_gate/claim/verify', { data: { code, id: o.body.id, credential: device.register(o.body.options, f.origin) } })).status, 401)
  assert.equal(readOwner(f.dir), undefined)
  assert.equal(f.sessions.list().length, 0)
})

// Mutant CONTROL_KEEP_STALE_SOCKET prevents restart after a killed gate.
test('host control recovers a crash socket but refuses to replace a live controller or a file', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-control-crash-'))
  const moduleURL = new URL('../gate-control.mjs', import.meta.url).href
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {controlServer} from ${JSON.stringify(moduleURL)};await controlServer({dir:process.argv[1]});console.log('ready')`, dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  let control
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'exit'); child.kill('SIGKILL'); await closed }
    if (control) await new Promise(resolve => control.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw Error('Control fixture exited before ready') })])
  const closed = once(child, 'exit'); child.kill('SIGKILL'); await closed
  assert.equal(statSync(join(dir, 'control.sock')).isSocket(), true)
  control = await controlServer({ dir, renewCode: async () => ({ renewed: true }) })
  await assert.rejects(controlServer({ dir }), /already running/)
  assert.deepEqual(await hostCommand(dir, 'renew-claim'), { renewed: true })
  await new Promise(resolve => control.close(resolve)); control = undefined
  writeFileSync(join(dir, 'control.sock'), 'preserve', { mode: 0o600 })
  await assert.rejects(controlServer({ dir }), /not a socket/)
  assert.equal(readFileSync(join(dir, 'control.sock'), 'utf8'), 'preserve')
})

// Mutant CLAIM_HASH_STRING_EQUALITY bypasses the fixed-length native comparison.
test('claim hashes are compared with timingSafeEqual for both good and bad secrets', async t => {
  const f = await fixture(t)
  const real = crypto.timingSafeEqual, calls = []
  t.mock.method(crypto, 'timingSafeEqual', (left, right) => { calls.push([left.length, right.length]); return real(left, right) })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  f.claim.checkCode(f.code())
  assert.throws(() => f.claim.checkCode('wrong'))
  assert.deepEqual(calls, [[32, 32], [32, 32]])
})

// Mutant CLAIM_REPLACE_OWNER overwrites the first claim and permits two successful claimers.
test('two concurrent passkey claims leave exactly one owner and one winning session', async t => {
  const f = await fixture(t), code = f.code()
  const devices = [new SoftwareAuthenticator(), new SoftwareAuthenticator()]
  const options = await Promise.all(devices.map(() => f.request('/_gate/claim/options', { data: { code } })))
  const results = await Promise.all(options.map((o, i) => f.request('/_gate/claim/verify', { data: { code, id: o.body.id, credential: devices[i].register(o.body.options, f.origin) } })))
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401])
  const owner = readOwner(f.dir)
  assert.equal(owner.auth.credentials.length, 1)
  assert.equal(f.sessions.list().length, 1)
  assert.equal(existsSync(join(f.dir, 'claim-code')), false)
  assert.equal(existsSync(join(f.dir, 'claim-state.json')), false)
  assert.ok(results.find(r => r.status === 200).body.offerSecondPasskey)
  assert.equal((await f.request('/_gate/claim/options', { data: { code } })).status, 401)
  assert.ok(!results.some(r => r.text.includes(code)))
})

// Mutants PASSKEY_WRONG_ORIGIN and PASSKEY_NO_UV weaken the real WebAuthn verification.
test('real registration and sign-in reject wrong origin/port, RP, challenge, missing UV and replay', async t => {
  const f = await fixture(t)
  for (const extra of [{ origin: 'http://localhost:4382' }, { rpID: 'other.invalid' }, { challenge: 'wrong' }, { uv: false }, { crossOrigin: true }]) {
    f.advance(60_001)
    const o = await f.request('/_gate/claim/options', { data: { code: f.code() } })
    const device = new SoftwareAuthenticator()
    const response = device.register(o.body.options, extra.origin ?? f.origin, extra)
    assert.notEqual((await f.request('/_gate/claim/verify', { data: { code: f.code(), id: o.body.id, credential: response } })).status, 200)
    assert.equal(readOwner(f.dir), undefined)
  }
  f.advance(60_001)
  const enrolled = await enroll(f)
  assert.equal((await f.request('/', { cookie: enrolled.cookie })).status, 200)
  assert.equal((await f.request('/?token=launch-secret')).status, 401)
  assert.equal((await f.request('/connect?token=launch-secret')).status, 401)
  for (const extra of [{ origin: 'http://localhost:4382' }, { rpID: 'other.invalid' }, { challenge: 'wrong' }, { uv: false }, { corrupt: true }, { crossOrigin: true }]) {
    const o = await f.request('/_gate/signin/options', { data: {} })
    const credential = enrolled.device.authenticate(o.body.options, extra.origin ?? f.origin, extra)
    const data = { id: o.body.id, credential }
    assert.notEqual((await f.request('/_gate/signin/verify', { data })).status, 200)
    assert.equal((await f.request('/_gate/signin/verify', { data })).status, 401)
    f.advance(60_001)
  }
  assert.ok(await signIn(f, enrolled.device))
})

test('HTTP origin and IP checks explain the refusal and all reserved aliases fail before claims', async t => {
  const f = await fixture(t)
  for (const headers of [{ host: 'localhost:4382' }, { origin: 'http://localhost:4382' }, { 'x-forwarded-host': 'localhost:4381', host: 'other.invalid' }]) {
    assert.equal((await f.request('/_gate/claim/options', { data: { code: f.code() }, headers })).status, 403)
  }
  const ip = await f.request('/_gate/claim', { headers: { host: DSH_HOST } })
  assert.equal(ip.status, 400); assert.match(ip.body.error, /IP origins.*localhost/)
  assert.throws(() => passkeyOrigin(`https://${DSH_HOST}`), /IP origins/)
  assert.throws(() => passkeyOrigin(`http://${DSH_HOST}`), /IP origins/)
  assert.equal(passkeyOrigin('https://instance.invalid:8443').hostname, 'instance.invalid')
  for (const path of ['/x/..//_gate/claim', '/_gate/%63laim', '/%5fgate/claim/options', '/_gate/./recovery/options']) {
    assert.equal((await f.request(path, { data: { code: f.code() } })).status, 400)
  }
  assert.equal(readOwner(f.dir), undefined)
})

// Mutant PASSKEY_SKIP_REVOKE leaves pre-change families valid.
test('offer second passkey; adding/removing passkeys and regenerating recovery codes revoke every session', async t => {
  const f = await fixture(t), enrolled = await enroll(f)
  assert.equal(enrolled.completed.body.offerSecondPasskey, true)
  const page = await f.request('/_gate/settings', { cookie: enrolled.cookie })
  assert.match(page.text, /Add a second passkey/)
  const info = await f.request('/_gate/passkeys', { cookie: enrolled.cookie })
  assert.match(info.body.bot_trust_notice, /not from its own Bots/)
  const second = new SoftwareAuthenticator()
  const o = await f.request('/_gate/passkeys/options', { data: {}, cookie: enrolled.cookie })
  const added = await f.request('/_gate/passkeys/verify', { data: { id: o.body.id, credential: second.register(o.body.options, f.origin) }, cookie: enrolled.cookie })
  assert.equal(added.status, 200); assert.equal(f.sessions.list().length, 0)
  assert.equal((await f.request('/', { cookie: enrolled.cookie })).status, 401)
  let cookie = await signIn(f, second)
  assert.equal((await f.request('/_gate/passkeys/remove', { data: { id: enrolled.device.id }, cookie })).status, 200)
  assert.equal(f.sessions.list().length, 0)
  cookie = await signIn(f, second)
  const replaced = await f.request('/_gate/recovery/codes', { data: {}, cookie })
  assert.equal(replaced.status, 200); assert.equal(replaced.body.recoveryCodes.length, 8)
  assert.equal(f.sessions.list().length, 0)
  const hashes = readOwner(f.dir).auth.recovery
  const derive = promisify(crypto.scrypt)
  for (let i = 0; i < hashes.length; i++) {
    const value = replaced.body.recoveryCodes[i].replaceAll('-', '')
    assert.equal((await derive(value, hashes[i].salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex'), hashes[i].hash)
    assert.ok(!JSON.stringify(hashes).includes(value))
  }
})

// Mutant RECOVERY_REUSE does not remove the used slow hash.
test('recovery codes work once, revoke sessions immediately, and only authorize passkey registration', async t => {
  const f = await fixture(t), enrolled = await enroll(f)
  const o = await f.request('/_gate/recovery/options', { data: { code: enrolled.recovery[0] } })
  assert.equal(o.status, 200); assert.equal(f.sessions.list().length, 0)
  assert.equal((await f.request('/', { cookie: enrolled.cookie })).status, 401)
  assert.equal((await f.request('/_gate/recovery/options', { data: { code: enrolled.recovery[0] } })).status, 401)
  assert.equal((await f.request('/')).status, 401)
  const newDevice = new SoftwareAuthenticator()
  const done = await f.request('/_gate/recovery/verify', { data: { id: o.body.id, credential: newDevice.register(o.body.options, f.origin) } })
  assert.equal(done.status, 200); assert.equal(done.headers['set-cookie'], undefined)
  assert.equal(f.sessions.list().length, 0)
  assert.ok(await signIn(f, newDevice))
})

// Mutant CLAIM_NO_RATE_LIMIT bypasses throttling for claim and recovery secrets.
test('claim and recovery routes are rate limited and expired challenges cannot be replayed', async t => {
  const f = await fixture(t)
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/_gate/claim/options', { data: { code: 'wrong' } })).status, 401)
  assert.equal((await f.request('/_gate/claim/options', { data: { code: f.code() } })).status, 429)
  f.advance(60_001)
  const o = await f.request('/_gate/claim/options', { data: { code: f.code() } })
  f.advance(CHALLENGE_MS)
  const device = new SoftwareAuthenticator()
  assert.equal((await f.request('/_gate/claim/verify', { data: { id: o.body.id, code: f.code(), credential: device.register(o.body.options, f.origin) } })).status, 401)
  const enrolled = await enroll(f)
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/_gate/recovery/options', { data: { code: 'wrong' } })).status, 401)
  assert.equal((await f.request('/_gate/recovery/options', { data: { code: enrolled.recovery[0] } })).status, 429)
})

// Mutant RESET_KEEP_PUBLIC_BIND fails the host-reset listener boundary.
test('host reset is a private socket operation, revokes all keys/sessions and returns the actual listener to loopback', async t => {
  const f = await fixture(t, { published: '0.0.0.0' })
  assert.equal(f.gate.address().address, DSH_HOST)
  assert.equal(statSync(join(f.dir, 'control.sock')).mode & 0o777, 0o600)
  const enrolled = await enroll(f)
  for (let i = 0; i < 100 && f.gate.address()?.address !== '0.0.0.0'; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(f.gate.address()?.address, '0.0.0.0')
  assert.equal((await f.request('/_gate/reset', { data: {}, cookie: enrolled.cookie })).status, 404)
  const before = readOwner(f.dir)
  await hostCommand(f.dir, 'reset')
  assert.equal(f.gate.address().address, DSH_HOST)
  const after = readOwner(f.dir)
  assert.equal(after.instance_id, before.instance_id); assert.equal(after.local_id, before.local_id)
  assert.equal(after.auth.credentials.length, 0); assert.equal(after.auth.recovery.length, 0)
  assert.equal(f.sessions.list().length, 0)
  assert.equal((await f.request('/', { cookie: enrolled.cookie })).status, 401)
  assert.equal((await f.request('/_gate/claim')).status, 200)
  assert.match(f.code(), /^[a-f0-9]{32}$/)
})

test('newer or malformed owner authentication state fails closed without making a new claim', async t => {
  const f = await fixture(t), enrolled = await enroll(f)
  await f.close()
  const owner = readOwner(f.dir); owner.auth.version = 2
  const data = JSON.stringify(owner)
  writeFileSync(join(f.dir, 'owner.json'), data)
  assert.throws(() => new SelfHostedClaim({ dir: f.dir, origin: f.origin, sessions: f.sessions }), ClaimConfigurationError)
  assert.equal(readFileSync(join(f.dir, 'owner.json'), 'utf8'), data)
  assert.equal(existsSync(join(f.dir, 'claim-code')), false)
  assert.ok(enrolled.recovery.length)
})

// Mutant RESET_WRITE_BEFORE_REBIND leaves an unclaimed public listener on a disk error.
test('reset closes the public listener before a failed claim-code write', async t => {
  const f = await fixture(t, { published: '0.0.0.0' })
  await enroll(f)
  for (let i = 0; i < 100 && f.gate.address()?.address !== '0.0.0.0'; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(f.gate.address()?.address, '0.0.0.0')
  f.claim.newCode = () => { throw new Error('Simulated disk failure') }
  await assert.rejects(hostCommand(f.dir, 'reset'), /Host operation refused/)
  assert.equal(f.gate.address()?.address, DSH_HOST)
  assert.equal(f.claim.claimed, false)
  assert.equal(f.sessions.list().length, 0)
})

test('a changed origin requires recovery to pin the new RP/origin; it never reopens the first claim', async t => {
  const f = await fixture(t), enrolled = await enroll(f)
  await f.close()
  const owner = readOwner(f.dir), origin = 'https://instance.invalid:8443'
  const replacement = new SelfHostedClaim({ dir: f.dir, origin, sessions: f.sessions, audit: () => {} })
  await replacement.start()
  assert.equal(replacement.claimable, false); assert.equal(replacement.claimed, false)
  assert.equal(existsSync(join(f.dir, 'claim-code')), false)
  assert.throws(() => replacement.newCode())
  const o = await replacement.action('recovery/options', { code: enrolled.recovery[0] })
  const device = new SoftwareAuthenticator()
  await replacement.action('recovery/verify', { id: o.id, credential: device.register(o.options, origin) })
  assert.equal(replacement.claimed, true)
  const changed = readOwner(f.dir)
  assert.equal(changed.instance_id, owner.instance_id)
  assert.equal(changed.auth.origin, origin); assert.equal(changed.auth.rpID, 'instance.invalid')
  assert.equal(changed.auth.credentials.length, 1)
})

async function entry(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-claim-entry-'))
  const reserve = http.createServer(), port = await listen(reserve)
  await new Promise(resolve => reserve.close(resolve))
  const child = spawn(process.execPath, ['server/gate-entrypoint.mjs'], {
    env: { PATH: process.env.PATH, TMPDIR: tmpdir(), AUTOMAGIK_GATE_ENABLED: '1', AUTOMAGIK_GATE_IMAGE: '1',
      AUTOMAGIK_GATE_HOME: dir, AUTOMAGIK_GATE_ORIGIN: ORIGIN, AUTOMAGIK_GATE_PORT: String(port), ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const startup = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gate entry startup timed out')), 8000)
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('listening on loopback')) { clearTimeout(timer); resolve() } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Gate entry exited ${code}: ${stderr}`)) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
  })
  t.after(async () => { if (child.exitCode === null) { const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed } rmSync(dir, { recursive: true, force: true }) })
  await startup
  const get = path => new Promise((resolve, reject) => {
    const req = http.get({ hostname: DSH_HOST, port, path, headers: { host: new URL(ORIGIN).host, connection: 'close' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk }); res.on('end', () => resolve({ status: res.statusCode, text }))
    }); req.on('error', reject)
  })
  return { dir, get, output: () => ({ stdout, stderr }) }
}

// Mutant IMAGE_CLAIM_STDOUT prints the generated claim secret in the image's application log.
test('the real image-mode entry writes a 0600 code file, never stdout/stderr or HTTP', async t => {
  const f = await entry(t)
  const secret = readFileSync(join(f.dir, 'claim-code'), 'utf8').trim()
  assert.equal(statSync(join(f.dir, 'claim-code')).mode & 0o777, 0o600)
  assert.match(secret, /^[a-f0-9]{32}$/)
  const claim = await f.get('/_gate/claim')
  assert.equal(claim.status, 200)
  assert.ok(!claim.text.includes(secret))
  const ordinary = await f.get('/')
  assert.equal(ordinary.status, 401)
  assert.ok(!JSON.stringify(f.output()).includes(secret), 'image code must never reach application stdout or stderr')
})

test('Access mode never opens claim pages, writes claim secrets or starts host-reset control', async t => {
  const f = await entry(t, { AUTOMAGIK_GATE_ACCESS_TEAM_DOMAIN: 'team.invalid', AUTOMAGIK_GATE_ACCESS_AUD: '{audience}', AUTOMAGIK_GATE_ACCESS_EMAILS: 'owner@example.invalid' })
  assert.equal((await f.get('/_gate/claim')).status, 401)
  assert.equal(existsSync(join(f.dir, 'claim-code')), false)
  assert.equal(existsSync(join(f.dir, 'claim-state.json')), false)
  assert.equal(existsSync(join(f.dir, 'control.sock')), false)
})

test('self-hosted ceremonies open no external connection and expired sign-in challenges fail', async t => {
  let fetches = 0
  t.mock.method(globalThis, 'fetch', () => { fetches++; throw new Error('Unexpected external connection') })
  const f = await fixture(t), enrolled = await enroll(f)
  const o = await f.request('/_gate/signin/options', { data: {} })
  f.advance(CHALLENGE_MS)
  assert.equal((await f.request('/_gate/signin/verify', { data: { id: o.body.id, credential: enrolled.device.authenticate(o.body.options, f.origin) } })).status, 401)
  assert.equal(fetches, 0)
})
