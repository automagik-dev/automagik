import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { prepareHermesConnection, refreshHermesProfiles } from '../src/host/hermes-connection.js'
import { install } from '../src/host/hermes-remote.js'
import { fakeContext } from './fake-ctx.js'

const deadlines = { start: 300, control: 100, cancel: 10 }
const response = (value, status = 200, cookies = []) => ({ ok: status >= 200 && status < 300, status, json: async () => value, headers: { getSetCookie: () => cookies } })
function dashboard(overrides = {}) {
  const credential = randomUUID(), access = randomUUID(), refresh = randomUUID(), password = randomUUID(), username = `sample-${randomUUID()}`
  const address = `https://${randomUUID()}.invalid/prefix`, calls = []
  const fetch = async (url, init) => {
    calls.push({ url, ...init })
    const path = url.slice(address.length)
    const custom = await overrides.handle?.(path, init)
    if (custom) return custom
    if (path === '/api/auth/providers') return response({ providers: overrides.providers ?? [{ name: 'basic', supports_password: true }] })
    if (path === '/auth/password-login') return response({ ok: true, next: '/prefix/' }, 200, [`hermes_session_at=${access}; HttpOnly`, `hermes_session_rt=${refresh}; HttpOnly`])
    if (path === '/api/status') return response(overrides.status ?? { gateway_shared_with: ['sample-profile', 'uninstalled'] })
    if (path === '/api/profiles') return response(overrides.inventory ?? { profiles: [{ name: 'sample-profile', display_name: 'Sample profile' }, { name: 'not-served' }] })
    if (path === '/api/profiles/active') return response(overrides.active ?? { active: 'not-served', current: 'sample-profile' })
    throw Error('Unexpected fixture request')
  }
  return { fetch, calls, credential, access, refresh, password, username, address,
    token: { mode: 'remote', address, authMode: 'token', credential },
    login: { mode: 'remote', address, authMode: 'password', username, password } }
}
function runtime(t, fixture, overrides = {}) {
  const ctx = fakeContext(), endpoints = new Map(), secrets = new Map(), secretCalls = [], snapshots = [], wires = []
  ctx.llm.registerAdapter = () => () => {}
  const rt = { ctx, state: { prefs: {} }, hooks: { endpoint: (name, fn) => endpoints.set(name, fn) },
    load: async () => {}, loadSecrets: async () => {}, secretValue: name => secrets.get(name),
    save: async () => { snapshots.push(JSON.stringify(rt.state)) },
    secretEndpoint: async (name, body) => { secretCalls.push({ endpoint: name, ...body }); if (name === 'secret-set') secrets.set(body.name, body.value); else secrets.delete(body.name) },
  }
  class Wire {
    constructor(options) { this.options = options; this.listeners = new Set(); this.secrets = new Set(options.redactionSecrets); this.sent = []; wires.push(this) }
    async connect() {
      if (overrides.gatewayDelay) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, overrides.gatewayDelay)
        this.cancelConnect = () => { clearTimeout(timer); reject(Error('Fixture gateway closed')) }
      })
      return this
    }
    async session() { await overrides.beforeSession?.(this); return { session_id: randomUUID(), stored_session_id: randomUUID(), info: { desktop_contract: 8, approval_mode: 'manual', yolo: false } } }
    async models() { await overrides.beforeModels?.(this); return overrides.models ?? [{ id: 'sample:model', model: 'model', provider: 'sample', name: 'Sample model' }] }
    async request(method, params) { this.sent.push({ method, params }); return {} }
    close() { if (this.closed) return; this.closed = true; this.cancelConnect?.(); for (const listener of this.listeners) listener({ kind: 'lost' }) }
  }
  install(rt, { transport: options => new Wire(options), fetch: fixture.fetch, deadlines, ...overrides })
  t.after(() => ctx.dispose())
  return { rt, endpoints, secrets, secretCalls, snapshots, wires }
}
const sshFetch = async url => url.endsWith('/api/status') ? response({ gateway_shared_with: ['sample-profile'] }) : response({ profiles: [{ name: 'sample-profile' }] })

test('token auth uses its dedicated header, preserves the prefix and filters installed profiles to served profiles', async () => {
  const f = dashboard(), stages = []
  const c = await prepareHermesConnection(f.token, { fetch: f.fetch, deadlines, onProgress: stage => stages.push(stage) })
  assert.deepEqual(c.profiles, [{ id: 'sample-profile', name: 'Sample profile' }])
  assert.deepEqual(stages, ['reach', 'sign-in', 'open'])
  assert.ok(f.calls.every(call => call.url.startsWith(`${f.address}/api/`) && call.headers['X-Hermes-Session-Token'] === f.credential && call.headers.Authorization === undefined && call.redirect === 'manual'))
  assert.ok(f.calls.every(call => !call.url.includes(f.credential)))
  await c.close()
})
test('standalone fallback uses the running current profile, not the sticky CLI active profile', async () => {
  const f = dashboard({ status: {} })
  const c = await prepareHermesConnection(f.token, { fetch: f.fetch, deadlines })
  assert.equal(c.profiles[0].id, 'sample-profile')
  assert.ok(f.calls.some(call => call.url.endsWith('/api/profiles/active')))
})
test('password sign-in selects one supported provider and keeps cookies instead of the password', async () => {
  const f = dashboard(), c = await prepareHermesConnection(f.login, { fetch: f.fetch, deadlines })
  const call = f.calls.find(call => call.url.endsWith('/auth/password-login'))
  assert.deepEqual(JSON.parse(call.body), { provider: 'basic', username: f.username, password: f.password })
  assert.equal(c.authHeaders.Cookie, `hermes_session_at=${f.access}; hermes_session_rt=${f.refresh}`)
  assert.deepEqual(c.secret, { kind: 'session', cookie: c.authHeaders.Cookie })
  assert.ok(!JSON.stringify(c.secret).includes(f.password) && !JSON.stringify(c.secret).includes(f.username))
  assert.ok(c.redactionSecrets.includes(f.password) && c.redactionSecrets.includes(f.access) && c.redactionSecrets.includes(f.refresh))
})
test('password-provider ambiguity or absence does not submit credentials to an arbitrary provider', async () => {
  for (const providers of [[], [{ name: 'oidc', supports_password: false }], [{ name: 'a', supports_password: true }, { name: 'b', supports_password: true }]]) {
    const f = dashboard({ providers })
    await assert.rejects(prepareHermesConnection(f.login, { fetch: f.fetch, deadlines }), { code: 'bot/hermes-unsupported' })
    assert.ok(!f.calls.some(call => call.url.endsWith('/auth/password-login')))
  }
})
test('HTTP redirects, external post-login redirects and thrown fetch details fail closed without disclosure', async () => {
  for (const kind of ['http', 'login-next', 'thrown']) {
    const f = dashboard({ handle: path => {
      if (kind === 'http' && path === '/api/status') return response({}, 302)
      if (kind === 'login-next' && path === '/auth/password-login') return response({ ok: true, next: 'https://other.invalid/' })
      if (kind === 'thrown') throw Error('private fixture detail')
    } })
    await assert.rejects(prepareHermesConnection(kind === 'login-next' ? f.login : f.token, { fetch: f.fetch, deadlines }), error => error.code.startsWith('bot/hermes-') && !error.message.includes('private fixture detail'))
    assert.ok(f.calls.every(call => call.url.startsWith(f.address)))
  }
})
test('rejected sign-in never echoes the remote response', async () => {
  const f = dashboard({ handle: path => path === '/auth/password-login' ? response({ error: 'private fixture detail' }, 401) : undefined })
  await assert.rejects(prepareHermesConnection(f.login, { fetch: f.fetch, deadlines }), error => error.code === 'bot/hermes-auth' && !error.message.includes('private fixture detail'))
})
test('profile labels redact credential echoes and credential-shaped IDs are excluded', async () => {
  const f = dashboard()
  const fetch = async url => url.endsWith('/api/status') ? response({ gateway_shared_with: ['sample-profile', f.credential] })
    : response({ profiles: [{ name: 'sample-profile', display_name: `Sample ${f.credential}` }, { name: f.credential }] })
  const c = await prepareHermesConnection(f.token, { fetch, deadlines })
  assert.deepEqual(c.profiles, [{ id: 'sample-profile', name: 'Sample [redacted]' }])
})
test('draft flags cannot authorize HTTP, but the owned SSH factory grants loopback and closes exactly once', async () => {
  const f = dashboard(); let closed = 0
  await assert.rejects(prepareHermesConnection({ ...f.token, address: 'http://127.0.0.1', allowLoopback: true }, { fetch: f.fetch, deadlines }))
  const c = await prepareHermesConnection({ mode: 'ssh', ssh: { host: 'example.invalid' } }, {
    startSsh: async () => ({ address: 'http://127.0.0.1:12345', credential: f.credential, close: async () => { closed++ } }), fetch: sshFetch, deadlines,
  })
  assert.equal(c.allowLoopback, true); assert.equal(c.secret, undefined)
  await Promise.all([c.close(), c.close()]); assert.equal(closed, 1)
})
test('unanswered and aborted requests are bounded and SSH is cleaned on failed profile discovery', async () => {
  const f = dashboard(), controller = new AbortController()
  const pending = prepareHermesConnection(f.token, { fetch: () => new Promise(() => {}), signal: controller.signal, deadlines })
  controller.abort(); await assert.rejects(pending, /did not answer|cancelled/)
  await assert.rejects(prepareHermesConnection(f.token, { fetch: () => new Promise(() => {}), deadlines: { start: 15, control: 10, cancel: 5 } }), /did not answer/)
  let closed = 0
  await assert.rejects(prepareHermesConnection({ mode: 'ssh', ssh: { host: 'example.invalid' } }, {
    startSsh: async () => ({ address: 'http://127.0.0.1:12345', credential: f.credential, close: async () => { closed++ } }), fetch: async () => response({}), deadlines,
  }), /profiles/)
  assert.equal(closed, 1)
})
test('profile refresh reuses cookies without another password and saved restoration performs no REST discovery', async () => {
  const f = dashboard(), c = await prepareHermesConnection(f.login, { fetch: f.fetch, deadlines })
  f.calls.length = 0
  assert.equal((await refreshHermesProfiles(c, { fetch: f.fetch, deadlines }))[0].id, 'sample-profile')
  assert.ok(f.calls.every(call => !call.url.includes('/auth/') && call.headers.Cookie))
  const restored = await prepareHermesConnection({ mode: 'remote', address: f.address, authMode: 'password' }, { secret: c.secret, discover: false, fetch: () => { throw Error('No REST discovery permitted') }, deadlines })
  assert.equal(restored.authHeaders.Cookie, c.authHeaders.Cookie)
})
test('quoted session cookies keep their wire form while unquoted echoes are redacted, including rotated credentials', async () => {
  const token = randomUUID(), rotated = randomUUID()
  const f = dashboard({ handle: path => {
    if (path === '/auth/password-login') return response({ ok: true }, 200, [`hermes_session_at="${token}"; HttpOnly`])
    if (path === '/api/status') return response({ gateway_shared_with: ['sample-profile'] }, 200, [`hermes_session_at="${rotated}"; HttpOnly`])
    if (path === '/api/profiles') return response({ profiles: [{ name: 'sample-profile', display_name: `Sample ${token} ${rotated}` }] })
  } })
  const c = await prepareHermesConnection(f.login, { fetch: f.fetch, deadlines })
  assert.equal(c.authHeaders.Cookie, `hermes_session_at="${rotated}"`)
  assert.equal(c.secret.cookie, c.authHeaders.Cookie)
  assert.deepEqual(c.profiles, [{ id: 'sample-profile', name: 'Sample [redacted] [redacted]' }])
  assert.ok(c.redactionSecrets.includes(token) && c.redactionSecrets.includes(rotated))
})
test('ticket cookie rotation updates the existing scoped secret reference and wire redaction without storing a password', async t => {
  const rotated = randomUUID(), f = dashboard({ handle: path => path === '/api/auth/ws-ticket' ? response({ ticket: 'sample-ticket' }, 200, [`hermes_session_at="${rotated}"; HttpOnly`]) : undefined })
  const h = runtime(t, f), tested = await h.rt.hermesRemote.test(f.login)
  const view = await h.rt.hermesRemote.save({ testId: tested.testId, profile: 'sample-profile' })
  await h.rt.hermesRemote.connect()
  const wire = h.wires.at(-1)
  await wire.options.fetch(`${f.address}/api/auth/ws-ticket`, { headers: wire.options.authHeaders })
  const stored = h.secrets.get(view.credentialRef)
  assert.ok(JSON.parse(stored).cookie.includes(rotated))
  assert.ok(!stored.includes(f.password) && !stored.includes(f.username))
  assert.ok(wire.secrets.has(rotated))
})
test('test IDs keep the adapter off until selected-profile validation; state stores only a scoped secret reference', async t => {
  const f = dashboard(), h = runtime(t, f)
  const tested = await h.rt.hermesRemote.test(f.login)
  assert.equal(h.rt.hermesRemote.view().enabled, false)
  await assert.rejects(h.rt.hermesRemote.save({ testId: tested.testId, profile: 'not-served' }), { code: 'bot/hermes-profiles' })
  const view = await h.rt.hermesRemote.save({ testId: tested.testId, profile: 'sample-profile' })
  assert.equal(view.enabled, true); assert.equal(view.modelRef, 'hermes-remote/sample:model')
  for (const secret of [f.password, f.username, f.access, f.refresh]) assert.ok(!JSON.stringify(view).includes(secret) && !h.snapshots.join('').includes(secret))
  const stored = h.secrets.get(view.credentialRef)
  assert.equal(JSON.parse(stored).kind, 'session'); assert.ok(!stored.includes(f.password) && !stored.includes(f.username))
  assert.deepEqual(h.secretCalls.find(call => call.endpoint === 'secret-set').scope, [])
  assert.ok(h.wires.every(wire => !wire.sent.some(frame => frame.method === 'prompt.submit')))
})
test('progress reflects authenticated REST and contract probing, while refresh never requests the password again', async t => {
  const f = dashboard(), requestId = randomUUID(); let status
  const h = runtime(t, f, { beforeSession: () => { status = h.endpoints.get('hermes-remote-test-status')({ requestId }) } })
  const tested = await h.rt.hermesRemote.test({ ...f.login, requestId })
  assert.deepEqual(status, { stage: 'open' })
  assert.deepEqual(h.endpoints.get('hermes-remote-test-status')({ requestId }), { stage: 'connected' })
  f.calls.length = 0
  assert.equal((await h.endpoints.get('hermes-remote-test-profiles')({ testId: tested.testId })).profiles[0].id, 'sample-profile')
  assert.ok(f.calls.every(call => !call.url.endsWith('/auth/password-login')))
})
test('saved one-click connect uses the saved profile/session without REST discovery or an automatic submit', async t => {
  const f = dashboard(), h = runtime(t, f), tested = await h.rt.hermesRemote.test(f.login)
  await h.rt.hermesRemote.save({ testId: tested.testId, profile: 'sample-profile' })
  const before = f.calls.length, result = await h.rt.hermesRemote.connect()
  assert.equal(result.profile, 'sample-profile'); assert.ok(result.modelRef); assert.equal(f.calls.length, before)
  assert.equal(h.wires.at(-1).options.authHeaders.Cookie, `hermes_session_at=${f.access}; hermes_session_rt=${f.refresh}`)
  assert.equal(h.wires.at(-1).options.profile, 'sample-profile')
})
test('tests-only cancellation aborts before a test ID exists and leaves the saved configuration untouched', async t => {
  const f = dashboard({ handle: () => new Promise(() => {}) }), h = runtime(t, f)
  h.rt.state.prefs.hermesRemote = { enabled: true, address: 'https://example.invalid', profile: 'sample-profile', models: [] }
  h.rt.state.hermesSessions = { chat: { storedSessionId: 'saved', pendingSubmit: true, uncertain: true } }
  const original = JSON.stringify(h.rt.state)
  const pending = h.rt.hermesRemote.test(f.token), rejected = assert.rejects(pending)
  await new Promise(resolve => setImmediate(resolve))
  await h.rt.hermesRemote.disconnect({ testsOnly: true }); await rejected
  assert.equal(JSON.stringify(h.rt.state), original)
})
test('replaced and expired IDs cannot save; replacing and disposing close owned SSH resources', async t => {
  const f = dashboard(), clock = { now: 0 }; let closed = 0
  const h = runtime(t, { ...f, fetch: sshFetch }, { now: () => clock.now,
    startSsh: async () => ({ address: 'http://127.0.0.1:12345', credential: f.credential, close: async () => { await new Promise(resolve => setImmediate(resolve)); closed++ } }),
  })
  const first = await h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' } })
  const second = await h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' } })
  assert.equal(closed, 1)
  await assert.rejects(h.rt.hermesRemote.save({ testId: first.testId, profile: 'sample-profile' }), { code: 'bot/hermes-expired' })
  clock.now += 5 * 60_000 + 1
  await assert.rejects(h.rt.hermesRemote.save({ testId: second.testId, profile: 'sample-profile' }), { code: 'bot/hermes-expired' })
  await h.rt.ctx.dispose(); assert.equal(closed, 2)
})
test('replacing the remote target refuses uncertain sessions and preserves their durable identities', async t => {
  const f = dashboard(), h = runtime(t, f)
  h.rt.state.prefs.hermesRemote = { enabled: true, address: 'https://example.invalid/other', profile: 'sample-profile', models: [] }
  h.rt.state.hermesSessions = { chat: { storedSessionId: 'saved', runtimeSessionId: 'runtime', pendingSubmit: true, uncertain: true } }
  const before = JSON.stringify(h.rt.state), tested = await h.rt.hermesRemote.test(f.token)
  await assert.rejects(h.rt.hermesRemote.save({ testId: tested.testId, profile: 'sample-profile' }), /Reconcile uncertain/)
  assert.equal(JSON.stringify(h.rt.state), before)
})
test('one action budget covers delayed auth plus gateway startup and closes the remaining probe', async t => {
  let first = true
  const f = dashboard({ handle: async () => { if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 25)) } } })
  const h = runtime(t, f, { deadlines: { start: 45, control: 40, cancel: 5 }, gatewayDelay: 40 })
  await assert.rejects(h.rt.hermesRemote.test(f.token), /closed|cancelled|timed out/)
  assert.ok(h.wires[0].options.deadlines.start < 35)
  assert.equal(h.wires[0].closed, true)
  assert.equal(h.rt.hermesRemote.view().enabled, false)
})
test('concurrent saved SSH users share a lease, tests-only cancellation preserves it, and the last user closes it', async t => {
  const f = dashboard(), waiting = []; let started = 0, closed = 0
  const h = runtime(t, { ...f, fetch: sshFetch }, {
    startSsh: async () => { started++; return { address: 'http://127.0.0.1:12345', credential: f.credential, close: async () => { closed++ } } },
    beforeModels: () => h.rt.hermesRemote.view().enabled ? new Promise(resolve => waiting.push(resolve)) : undefined,
  })
  const tested = await h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' } })
  await h.rt.hermesRemote.save({ testId: tested.testId, profile: 'sample-profile' })
  assert.equal(closed, 1)
  const first = h.rt.hermesRemote.connect(), second = h.rt.hermesRemote.connect()
  const until = Date.now() + 1000
  while (waiting.length !== 2 && Date.now() < until) await new Promise(resolve => setImmediate(resolve))
  assert.equal(waiting.length, 2); assert.equal(started, 2)
  await h.rt.hermesRemote.disconnect({ testsOnly: true })
  assert.equal(closed, 1)
  waiting[0](); await first; assert.equal(closed, 1)
  waiting[1](); await second; assert.equal(closed, 2)
})
test('a lost completed test response can be cancelled by its preassigned request ID before the client knows a test ID', async t => {
  const f = dashboard(), requestId = randomUUID(), controller = new AbortController(); let closed = 0
  const h = runtime(t, { ...f, fetch: sshFetch }, {
    startSsh: async () => ({ address: 'http://127.0.0.1:12345', credential: f.credential, close: async () => { closed++ } }),
  })
  // The handler completed, but its result/testId was dropped before client delivery.
  await h.endpoints.get('hermes-remote-test')({ mode: 'ssh', ssh: { host: 'example.invalid' }, requestId }, controller.signal).then(() => undefined)
  assert.equal(closed, 0)
  controller.abort()
  await h.rt.hermesRemote.disconnect({ testsOnly: true, requestId })
  assert.equal(closed, 1)
  assert.deepEqual(h.endpoints.get('hermes-remote-test-status')({ requestId }), { stage: 'reach' })
  assert.equal(h.rt.hermesRemote.view().enabled, false)
})
test('request-scoped cancellation aborts the matching pending test and ignores a wrong or older request', async t => {
  let requestSignal, started
  const began = new Promise(resolve => { started = resolve })
  const f = dashboard({ handle: (_path, init) => { requestSignal = init.signal; started(); return new Promise(() => {}) } })
  const h = runtime(t, f), requestId = randomUUID()
  const pending = h.rt.hermesRemote.test({ ...f.token, requestId }), rejected = assert.rejects(pending)
  await began
  await h.rt.hermesRemote.disconnect({ testsOnly: true, requestId: randomUUID() })
  assert.equal(requestSignal.aborted, false)
  await h.rt.hermesRemote.disconnect({ testsOnly: true, requestId })
  await rejected
  assert.equal(requestSignal.aborted, true)
})
test('stale request IDs and conflicting test IDs cannot cancel a newer completed SSH test', async t => {
  const f = dashboard(), oldRequest = randomUUID(), currentRequest = randomUUID(); let closed = 0
  const h = runtime(t, { ...f, fetch: sshFetch }, {
    startSsh: async () => ({ address: 'http://127.0.0.1:12345', credential: f.credential, close: async () => { closed++ } }),
  })
  await h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' }, requestId: oldRequest })
  const current = await h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' }, requestId: currentRequest })
  assert.equal(closed, 1)
  await h.rt.hermesRemote.disconnect({ testsOnly: true, requestId: oldRequest })
  await h.rt.hermesRemote.disconnect({ testsOnly: true, requestId: currentRequest, testId: randomUUID() })
  assert.equal(closed, 1)
  assert.deepEqual(h.endpoints.get('hermes-remote-test-status')({ requestId: currentRequest }), { stage: 'connected' })
  await h.rt.hermesRemote.disconnect({ testsOnly: true, requestId: currentRequest, testId: current.testId })
  assert.equal(closed, 2)
})
test('a request cancelled while the previous test is cleaning up never starts its own SSH process afterward', async t => {
  const f = dashboard(); let started = 0, closeStarted, releaseClose
  const closing = new Promise(resolve => { closeStarted = resolve })
  const h = runtime(t, { ...f, fetch: sshFetch }, {
    startSsh: async () => { started++; return { address: 'http://127.0.0.1:12345', credential: f.credential, close: () => {
      closeStarted(); return new Promise(resolve => { releaseClose = resolve })
    } } },
  })
  await h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' }, requestId: randomUUID() })
  const requestId = randomUUID(), pending = h.rt.hermesRemote.test({ mode: 'ssh', ssh: { host: 'example.invalid' }, requestId }), rejected = assert.rejects(pending)
  await closing
  const cancelled = h.rt.hermesRemote.disconnect({ testsOnly: true, requestId })
  releaseClose()
  await cancelled; await rejected
  assert.equal(started, 1)
})
