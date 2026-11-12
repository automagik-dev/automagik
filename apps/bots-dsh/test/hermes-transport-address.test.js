import assert from 'node:assert/strict'
import { randomBytes, randomUUID, randomInt } from 'node:crypto'
import { test } from 'node:test'
import { prepareHermesConnection } from '../src/host/hermes-connection.js'
import { HermesTransport, redactSocketQuery, remoteAddress } from '../src/host/hermes-transport.js'

// What a real Hermes does (proven against real installs, v0.21.5 to the pinned commit):
// POST /api/auth/ws-ticket answers 401 to a session token, which opens /api/ws itself as
// ?token=, with no subprotocol; a signed-in session (cookies, a bearer) mints a ticket.
function handshake(options = {}) {
  const ticket = randomUUID(), calls = [], sent = []
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.frame({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: randomUUID() } } })) }
    frame(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', ...frame }) })) }
    send(text) { const frame = JSON.parse(text); sent.push(frame); this.frame({ id: frame.id, result: frame.method === 'model.options' ? { providers: [] } : { server_requests: ['approval'] } }) }
    close() {}
  }
  const wire = new HermesTransport({ address: `https://${randomUUID()}.invalid/gateway/`, credential: randomUUID(),
    fetch: async (url, init) => { calls.push({ url, headers: init.headers }); return { ok: true, status: 200, json: async () => ({ ticket }) } },
    socket: (url, protocols) => { calls.push({ url, protocols }); return new Socket() }, ...options })
  return { wire, calls, ticket, sent, Socket }
}
const response = (value, status = 200, cookies = []) => ({ ok: status >= 200 && status < 300, status, json: async () => value, headers: { getSetCookie: () => cookies } })

test('a session token opens the socket itself: no ticket request, the token only in the socket address', async t => {
  const token = randomBytes(32).toString('hex'), f = handshake({ authHeaders: { 'X-Hermes-Session-Token': token } })
  t.after(() => f.wire.close())
  await f.wire.connect()
  assert.equal(f.calls.length, 1, 'no ticket is asked for')
  // The reverse-proxy prefix survives; Hermes takes no subprotocol beside a token.
  assert.equal(f.calls[0].url, `${f.wire.address.replace('https:', 'wss:')}/api/ws?token=${token}`)
  assert.deepEqual(f.calls[0].protocols, [])
})

test('a signed-in session keeps its ticket: a cookie or a bearer is never put in an address', async t => {
  for (const authHeaders of [{ Cookie: `hermes_session_at=${randomUUID()}` }, undefined]) {
    const f = handshake({ authHeaders })
    t.after(() => f.wire.close())
    await f.wire.connect()
    assert.equal(f.calls[0].url, `${f.wire.address}/api/auth/ws-ticket`)
    assert.deepEqual(f.calls[0].headers, authHeaders ?? { Authorization: `Bearer ${f.wire.credential}` })
    assert.equal(f.calls[1].url, f.wire.address.replace('https:', 'wss:') + '/api/ws')
    assert.deepEqual(f.calls[1].protocols, ['hermes-gateway-v1', `hermes-gateway-ticket.${f.ticket}`])
    for (const secret of [f.wire.credential, f.ticket, ...Object.values(f.wire.authHeaders)]) assert.ok(f.calls.every(call => !call.url.includes(secret)))
  }
})

test('each sign-in kind reaches its own socket path: SSH and a session token carry the token, a password sign-in mints a ticket', async t => {
  const address = `https://${randomUUID()}.invalid`, loopback = `http://127.0.0.1:${randomInt(1024, 65536)}`
  const token = randomBytes(32).toString('hex'), oneTime = randomBytes(32).toString('hex'), cookie = randomUUID()
  const answers = async (url, init) => {
    const path = new URL(url).pathname
    if (path === '/api/auth/providers') return response({ providers: [{ name: 'basic', supports_password: true }] })
    if (path === '/auth/password-login') return response({ ok: true }, 200, [`hermes_session_at=${cookie}; HttpOnly`])
    if (path === '/api/status') return response({ gateway_shared_with: ['sample-profile'] })
    if (path === '/api/profiles') return response({ profiles: [{ name: 'sample-profile' }] })
    throw new Error(`unexpected ${path} ${init?.method ?? 'GET'}`)
  }
  const kinds = [
    ['ssh', { mode: 'ssh', ssh: { host: 'sample.invalid' } }, loopback, oneTime],
    ['token', { mode: 'remote', address, authMode: 'token', credential: token }, address, token],
    ['password', { mode: 'remote', address, authMode: 'password', username: 'sample-user', password: randomUUID() }, address, undefined],
  ]
  for (const [kind, draft, base, carried] of kinds) {
    // The connection as the wizard prepares it, then the transport as the host builds it.
    const connection = await prepareHermesConnection(draft, { fetch: answers, startSsh: async () => ({ address: loopback, credential: oneTime, close: async () => {} }) })
    const f = handshake({ address: connection.address, credential: connection.credential, authHeaders: connection.authHeaders, allowLoopback: connection.allowLoopback, redactionSecrets: connection.redactionSecrets })
    t.after(() => f.wire.close())
    await f.wire.connect()
    const socket = f.calls.at(-1), socketBase = `${base.replace(/^http/, 'ws')}/api/ws`
    if (carried) {
      assert.equal(f.calls.length, 1, `${kind}: no ticket request`)
      assert.equal(socket.url, `${socketBase}?token=${carried}`, kind)
      assert.deepEqual(socket.protocols, [], kind)
    } else {
      assert.equal(f.calls[0].url, `${base}/api/auth/ws-ticket`, kind)
      assert.equal(f.calls[0].headers.Cookie, `hermes_session_at=${cookie}`, kind)
      assert.equal(socket.url, socketBase, `${kind}: nothing in the socket address`)
      assert.deepEqual(socket.protocols, ['hermes-gateway-v1', `hermes-gateway-ticket.${f.ticket}`], kind)
      assert.ok(f.calls.every(call => !call.url.includes(cookie)), kind)
    }
  }
})

test('the socket address and its token reach no error, no kept value and no row', async t => {
  const token = randomBytes(32).toString('hex'), other = randomBytes(32).toString('hex')
  const leaks = value => [token, other, 'token=' + token.slice(0, 4)].some(secret => String(value).includes(secret))
  // The socket itself fails, naming its own address the way a client library would.
  const thrown = handshake({ authHeaders: { 'X-Hermes-Session-Token': token }, socket: url => { throw new Error(`could not open ${url}`) } })
  // Hermes turns the socket away; the token is then asked about once, in a header.
  const turnedAway = options => handshake({ authHeaders: { 'X-Hermes-Session-Token': token }, socket: () => { const socket = new EventTarget(); socket.close = () => {}; queueMicrotask(() => socket.dispatchEvent(new Event('close'))); return socket }, ...options })
  const refused = turnedAway({ fetch: async () => response({ detail: `no ${token}` }, 401) }), unanswered = turnedAway({ fetch: async url => { throw new Error(`fetch failed ${url}?token=${token}`) } })
  for (const [f, code] of [[thrown, 'bot/hermes-connection'], [refused, 'bot/hermes-auth'], [unanswered, 'bot/hermes-connection']]) {
    await assert.rejects(f.wire.connect(), error => {
      assert.equal(error.code, code)
      assert.ok(!leaks(error.message) && !leaks(error.stack) && !leaks(JSON.stringify(error)) && error.cause === undefined, error.message)
      return true
    })
  }
  // A connected transport keeps the address without its token, and cleans what Hermes sends.
  const f = handshake({ authHeaders: { 'X-Hermes-Session-Token': token } })
  t.after(() => f.wire.close())
  await f.wire.connect()
  assert.ok(Object.values(f.wire).every(value => typeof value !== 'string' || !value.includes('?')), 'no kept address has a query')
  // Another connection's token, which this transport does not know, in an echoed address.
  for (const name of ['token', 'ticket', 'internal']) {
    const echoed = `GET ws://127.0.0.1:4041/api/ws?${name}=${other} failed; see /api/pty?cols=80&${name}=${other}&rows=24.`
    assert.equal(f.wire.redact(echoed), `GET ws://127.0.0.1:4041/api/ws?${name}=[redacted] failed; see /api/pty?cols=80&${name}=[redacted]&rows=24.`)
    assert.equal(redactSocketQuery(echoed), f.wire.redact(echoed))
  }
  assert.ok(!leaks(JSON.stringify(f.wire.redact({ rows: [{ text: `ws://127.0.0.1:4041/api/ws?token=${token}` }, { text: `wss://sample.invalid/api/ws?token=${other}` }] }))))
  assert.ok(!leaks(f.wire.text(`ws://127.0.0.1:4041/api/ws?token=${other} `, true)))
})

test('a request about the connection names no profile; a request about a session does', async t => {
  const f = handshake({ authHeaders: { 'X-Hermes-Session-Token': randomUUID() }, profile: 'sample-profile' })
  t.after(() => f.wire.close())
  await f.wire.connect()
  await f.wire.models()
  // Hermes refuses a field its contract does not name: client.capabilities takes no profile.
  assert.deepEqual(f.sent.map(frame => [frame.method, frame.params]), [['client.capabilities', { server_requests: true }], ['model.options', { include_unconfigured: false, profile: 'sample-profile' }]])
})

test('plain HTTP is restricted to trusted numeric SSH loopback endpoints', async t => {
  const address = `http://127.0.0.1:${randomInt(1024, 65536)}`, token = randomUUID()
  assert.throws(() => remoteAddress(address), /HTTPS/)
  assert.throws(() => remoteAddress('http://example.invalid', { allowLoopback: true }), /HTTPS/)
  for (const invalid of ['https://example.invalid?token=value', 'https://example.invalid#fragment', 'https://user:password@example.invalid']) assert.throws(() => remoteAddress(invalid), /HTTPS/)
  const f = handshake({ address, allowLoopback: true, authHeaders: { 'X-Hermes-Session-Token': token } })
  t.after(() => f.wire.close())
  await f.wire.connect()
  assert.equal(f.calls[0].url, `${address.replace('http:', 'ws:')}/api/ws?token=${token}`)
})

test('individual session cookies, bearer credentials and transient sign-in secrets are redacted', () => {
  const cookie = randomUUID(), refresh = randomUUID(), quoted = `${randomUUID()}/cookie+`, access = randomUUID(), password = randomUUID()
  const f = handshake({ authHeaders: { Cookie: `session=${cookie}; refresh=${refresh}; quoted="${quoted}"`, Authorization: `Bearer ${access}` }, redactionSecrets: [password] })
  const text = f.wire.redact(`${cookie} ${refresh} ${quoted} ${access} ${password}`)
  for (const secret of [cookie, refresh, quoted, access, password]) assert.ok(!text.includes(secret))
  assert.equal(f.wire.redact(encodeURIComponent(quoted)), '[redacted]')
  const half = Math.floor(quoted.length / 2)
  const streamed = f.wire.text(quoted.slice(0, half)) + f.wire.text(quoted.slice(half), true)
  assert.equal(streamed, '[redacted]')
  assert.equal(f.wire.redact({ headers: 'private', response: { token: access } }).headers, '[redacted]')
})
