import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createGate } from '../gate.mjs'
import { SessionStore } from '../gate-store.mjs'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'gate-mcp-'))
  const sessions = new SessionStore(home)
  const token = `am_agent_${randomBytes(32).toString('hex')}`
  let revoked = false
  const seen = []
  const upstream = http.createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers })
    req.resume()
    const allowed = !revoked && req.url === '/api/omni-mcp'
      && req.headers.authorization === `Bearer ${token}`
      && req.headers.cookie === 'dsh-fixture=value'
    res.writeHead(allowed ? 200 : 401, { 'content-type': 'application/json',
      'set-cookie': 'upstream=hidden' }).end(JSON.stringify({ ok: allowed }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const port = upstream.address().port
  const credentials = { port, authority: `127.0.0.1:${port}`,
    cookie: async () => 'dsh-fixture=value' }
  const gate = createGate({ origin: 'https://space.invalid', sessions, credentials,
    auditAccess: () => {} })
  gate.listen(0, '127.0.0.1')
  await once(gate, 'listening')
  const request = (path, headers = {}, method = 'POST') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: gate.address().port, path, method,
      headers: { host: 'space.invalid', ...headers } }, res => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
  t.after(async () => {
    await gate.closeGate()
    upstream.closeAllConnections()
    await new Promise(resolve => upstream.close(resolve))
    await rm(home, { recursive: true, force: true })
  })
  return { request, token, seen, sessions, revoke: () => { revoked = true } }
}

test('only the exact MCP path reaches agent auth; browser and identity headers stay isolated',
  async t => {
    const { request, token, seen, sessions, revoke } = await fixture(t)
    const allowed = await request('/api/omni-mcp', { authorization: `Bearer ${token}`,
      cookie: 'external=discard', 'x-automagik-principal': 'forged',
      'x-forwarded-host': 'forged.invalid', 'mcp-protocol-version': '2025-11-25',
      accept: 'application/json, text/event-stream' })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers['set-cookie'], undefined)
    assert.equal(seen.at(-1).headers.cookie, 'dsh-fixture=value')
    assert.equal(seen.at(-1).headers['x-automagik-principal'], undefined)
    assert.equal(seen.at(-1).headers['x-forwarded-host'], undefined)
    assert.equal(seen.at(-1).headers['mcp-protocol-version'], '2025-11-25')
    assert.equal(sessions.list().length, 0)
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { cookie: 'browser=only' }]) {
      assert.equal((await request('/api/omni-mcp', headers)).status, 401)
    }
    revoke()
    assert.equal((await request('/api/omni-mcp', {
      authorization: `Bearer ${token}`,
    })).status, 401)
    const before = seen.length
    for (const path of ['/api/omni-ui', '/', '/api/omni-mcp?token=forbidden',
      '/api/omni-mcp/', '/api/%6fmni-mcp', '//api/omni-mcp', '/api/a/../omni-mcp']) {
      assert.equal((await request(path, { authorization: `Bearer ${token}` })).status, 401)
    }
    assert.equal(seen.length, before)
  })

test('MCP origin, pinned Host and cross-site refusals do not reach DSH', async t => {
  const { request, token, seen } = await fixture(t)
  for (const headers of [{ origin: 'https://other.invalid' }, { host: 'other.invalid' },
    { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await request('/api/omni-mcp', {
      authorization: `Bearer ${token}`, ...headers,
    })).status, 403)
  }
  assert.equal(seen.length, 0)
})
