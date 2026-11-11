import assert from 'node:assert/strict'
import { randomUUID, randomInt } from 'node:crypto'
import { test } from 'node:test'
import { HermesTransport, remoteAddress } from '../src/host/hermes-transport.js'

function handshake(options = {}) {
  const ticket = randomUUID(), calls = []
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.frame({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: randomUUID() } } })) }
    frame(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', ...frame }) })) }
    send(text) { const frame = JSON.parse(text); this.frame({ id: frame.id, result: { server_requests: ['approval'] } }) }
    close() {}
  }
  const wire = new HermesTransport({ address: `https://${randomUUID()}.invalid/gateway/`, credential: randomUUID(),
    fetch: async (url, init) => { calls.push({ url, headers: init.headers }); return { ok: true, json: async () => ({ ticket }) } },
    socket: (url, protocols) => { calls.push({ url, protocols }); return new Socket() }, ...options })
  return { wire, calls, ticket }
}

test('remote reverse-proxy prefix survives ticket and socket requests without credentials in URLs', async t => {
  const token = randomUUID(), f = handshake({ authHeaders: { 'X-Hermes-Session-Token': token } })
  t.after(() => f.wire.close())
  await f.wire.connect()
  assert.equal(f.calls[0].url, `${f.wire.address}/api/auth/ws-ticket`)
  assert.equal(f.calls[0].headers['X-Hermes-Session-Token'], token)
  assert.equal(f.calls[0].headers.Authorization, undefined)
  assert.equal(f.calls[1].url, f.wire.address.replace('https:', 'wss:') + '/api/ws')
  assert.ok(f.calls[1].protocols.includes(`hermes-gateway-ticket.${f.ticket}`))
  assert.ok(f.calls.every(call => !call.url.includes(token) && !call.url.includes(f.ticket)))
})

test('plain HTTP is restricted to trusted numeric SSH loopback endpoints', async t => {
  const address = `http://127.0.0.1:${randomInt(1024, 65536)}`
  assert.throws(() => remoteAddress(address), /HTTPS/)
  assert.throws(() => remoteAddress('http://example.invalid', { allowLoopback: true }), /HTTPS/)
  for (const invalid of ['https://example.invalid?token=value', 'https://example.invalid#fragment', 'https://user:password@example.invalid']) assert.throws(() => remoteAddress(invalid), /HTTPS/)
  const f = handshake({ address, allowLoopback: true, authHeaders: { 'X-Hermes-Session-Token': randomUUID() } })
  t.after(() => f.wire.close())
  await f.wire.connect()
  assert.equal(f.calls[1].url, address.replace('http:', 'ws:') + '/api/ws')
})

test('individual session cookies, bearer credentials and transient sign-in secrets are redacted', () => {
  const cookie = randomUUID(), refresh = randomUUID(), quoted = randomUUID(), access = randomUUID(), password = randomUUID()
  const f = handshake({ authHeaders: { Cookie: `session=${cookie}; refresh=${refresh}; quoted="${quoted}"`, Authorization: `Bearer ${access}` }, redactionSecrets: [password] })
  const text = f.wire.redact(`${cookie} ${refresh} ${quoted} ${access} ${password}`)
  for (const secret of [cookie, refresh, quoted, access, password]) assert.ok(!text.includes(secret))
  assert.equal(f.wire.redact({ headers: 'private', response: { token: access } }).headers, '[redacted]')
})
