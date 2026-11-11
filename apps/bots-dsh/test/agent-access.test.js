import assert from 'node:assert/strict'
import { test } from 'node:test'
import { request as httpRequest } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { createAgentAccess, AGENT_TOOLS } from '../src/host/agent-access.js'
import { fakeContext } from './fake-ctx.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'agent-access-'))
  await writeFile(join(home, 'state.json'), JSON.stringify({ version: 1, revision: 1,
    mainBotIds: ['a'], workspaceId: 'w', bots: {
      a: { id: 'a', name: 'Alpha', instructions: 'Help', capabilities: [] },
      b: { id: 'b', name: 'Beta', instructions: '', capabilities: [] },
      c: { id: 'c', name: 'Gamma', instructions: '', capabilities: [] },
    }, rooms: {}, agents: {}, exchanges: [] }))
  const ctx = fakeContext()
  const agents = new Map()
  let count = 0
  ctx.llm = { listProviders: () => [], listModels: async () => [] }
  ctx.workspaceRegistry = { get: () => ({ id: 'w', path: home }),
    archiveSession: async () => {} }
  ctx.sessionController = {
    create: async () => ({ sessionId: `created-${++count}` }),
    resolveAgent: async id => {
      if (!agents.has(id)) agents.set(id, { session: { id }, followup: async () => {} })
      return { agent: agents.get(id) }
    },
    selectModel: async () => {},
  }
  ctx.sessions = { flush: async () => {} }
  ctx.sessionTitle = { rename: async () => {} }
  let route
  ctx.connection.fetch.register = options => {
    if (options.path === '/api/omni-ui') route = options
    return () => {}
  }
  const rt = createRuntime(ctx, { home, memory: false, browser: false, updateCheck: false })
  await rt.load()
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/omni-ui', {
      method: 'POST', body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json()
  }
  const created = await call('agent-token-create', { name: 'Test agent' })
  assert.equal(created.ok, true)
  const { token, id } = created.value
  const view = () => call('agent-access').then(result => result.value)
  const request = (body, auth = token, headers = {}) => new Request('http://localhost/mcp', {
    method: 'POST', headers: {
      ...(auth === null ? {} : { authorization: `Bearer ${auth}` }),
      accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers,
    }, body: JSON.stringify(body),
  })
  let rpcId = 0
  const rpc = (method, params, auth = token, headers) => rt.agentAccess.fetch(request({
    jsonrpc: '2.0', id: ++rpcId, method, params,
  }, auth, headers))
  const tool = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args })
    assert.equal(response.status, 200)
    const result = await response.json()
    if (result.error) return result
    return { ...result.result, value: JSON.parse(result.result.content[0].text) }
  }
  t.after(async () => { await ctx.dispose(); await rm(home, { recursive: true, force: true }) })
  return { rt, ctx, home, token, id, call, view, request, rpc, tool }
}

test('token create stores only hash; revoke immediately refuses the token', async t => {
  const { home, token, id, view, call, rpc } = await fixture(t)
  const saved = await readFile(join(home, 'agent-tokens.json'), 'utf8')
  assert.equal(saved.includes(token), false)
  assert.equal(JSON.parse(saved)[0].hash, createHash('sha256').update(token).digest('hex'))
  assert.equal((await stat(join(home, 'agent-tokens.json'))).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(await view()).includes(token), false)
  assert.equal((await rpc('tools/list')).status, 200)
  assert.equal((await rpc('tools/list', {}, 'wrong')).status, 401)
  assert.equal((await rpc('tools/list', {}, null)).status, 401)
  assert.equal((await call('agent-token-revoke', { id })).ok, true)
  assert.equal((await rpc('tools/list')).status, 401)
  assert.equal((await view()).audit.at(-1).tokenName, 'Test agent')
})

test('refusal audit records missing, wrong, revoked, unknown and invalid calls', async t => {
  const { rpc, view, call, id, tool } = await fixture(t)
  await rpc('tools/list', {}, null)
  await rpc('tools/list', {}, 'wrong')
  await rpc('tools/call', { name: 'secret-set', arguments: { value: 'not recorded' } })
  await tool('update_bot', { id: 'a', workDir: '/not-allowed' })
  await tool('update_bot', { id: 'missing', name: 'Nope' })
  await call('agent-token-revoke', { id })
  await rpc('tools/list')
  const audit = (await view()).audit.filter(entry => entry.outcome === 'refused')
  assert.equal(audit.length, 6)
  assert.equal(audit.at(-1).tokenName, 'Test agent')
  assert.equal(audit.some(entry => entry.action === 'update_bot'
    && entry.target === 'missing'), true)
  assert.equal(JSON.stringify(audit).includes('not recorded'), false)
})

test('no raw token or secret values in responses or audit, including pasted config', async t => {
  const { rt, home, token, tool, view, rpc } = await fixture(t)
  await rt.secretEndpoint('secret-set', {
    name: 'PRIVATE_KEY', value: 'fake-value-1091', scope: 'all',
  })
  await tool('update_bot', { id: 'a', instructions: `fake-value-1091 ${token}` })
  await rpc('tools/call', { name: token, arguments: { value: 'fake-value-1091' } })
  await rpc('tools/list', {}, token + '-wrong')
  const results = [await tool('get_bot', { id: 'a' }), await tool('list_bots'), await view()]
  const echoed = await (await rt.agentAccess.fetch(new Request('http://localhost/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: token, method: 'ping' }),
  }))).text()
  assert.equal(echoed.includes(token), false)
  const audit = await readFile(join(home, 'agent-audit.jsonl'), 'utf8')
  for (const text of [JSON.stringify(results), audit]) {
    assert.equal(text.includes(token), false)
    assert.equal(text.includes('fake-value-1091'), false)
  }
})

test('every tool uses the channel handler and edits appear in the ordinary team state', async t => {
  const { rt, tool, call, view, rpc } = await fixture(t)
  const listed = await (await rpc('tools/list')).json()
  assert.deepEqual(listed.result.tools.map(item => item.name), AGENT_TOOLS.map(item => item.name))
  assert.equal((await tool('list_bots')).value.length, 3)
  assert.equal((await tool('get_bot', { id: 'a' })).value.name, 'Alpha')
  const seen = []
  for (const key of ['createBot', 'updateBot', 'deleteBot', 'setMain',
    'createRoom', 'updateRoom', 'deleteRoom']) {
    const original = rt[key]
    rt[key] = (...args) => { seen.push(key); return original(...args) }
  }
  const created = await tool('create_bot', { name: 'Writer', instructions: 'Write well' })
  assert.equal(created.isError, false)
  const bot = created.value
  // Models/efforts and preset availability still resolve through the owner's validators.
  rt.resolveModel = async ref => ref
  rt.resolveEffort = async (ref, effort) => effort
  rt.applyModel = async () => {}
  rt.checkPreset = level => { assert.equal(level, 'workspace-write'); return level }
  rt.setPermission = async (row, level) => { row.permission = rt.checkPreset(level) }
  const updated = await tool('update_bot', { id: bot.id, instructions: 'New instructions',
    model: 'provider/model', effort: 'high', permission: 'workspace-write' })
  assert.equal(updated.isError, false)
  assert.equal(updated.value.instructions, 'New instructions')
  assert.equal(updated.value.model, 'provider/model')
  assert.equal(updated.value.effort, 'high')
  assert.equal(updated.value.permission, 'workspace-write')
  assert.equal((await call('list-bots')).value.find(row => row.id === bot.id).instructions,
    'New instructions')
  assert.equal((await tool('set_main', { id: bot.id, main: true })).isError, false)
  assert.equal((await call('state')).value.mainBotIds.includes(bot.id), true)
  assert.equal((await tool('get_bot', { id: bot.id })).value.main, true)
  const group = (await tool('create_group', { name: 'Writers', members: ['a', bot.id] })).value
  assert.equal((await tool('list_groups')).value.length, 1)
  assert.equal((await tool('get_group', { id: group.id })).value.name, 'Writers')
  assert.equal((await tool('update_group', { id: group.id, add: ['b'], notice: 'Plan' })).isError,
    false)
  assert.deepEqual((await call('get-room', { id: group.id })).value.members, ['a', bot.id, 'b'])
  assert.equal((await tool('delete_group', { id: group.id })).isError, false)
  assert.equal((await tool('list_groups')).value.length, 0)
  assert.equal((await tool('set_main', { id: bot.id, main: false })).isError, false)
  assert.equal((await tool('delete_bot', { id: bot.id })).isError, false)
  assert.equal((await tool('list_bots')).value.some(row => row.id === bot.id), false)
  assert.deepEqual(seen, ['createBot', 'updateBot', 'setMain', 'createRoom', 'updateRoom',
    'deleteRoom', 'setMain', 'deleteBot'])
  const audit = (await view()).audit
  const changed = audit.find(entry => entry.action === 'update_bot' && entry.outcome === 'allowed')
  assert.equal(JSON.stringify(changed.changes).includes('New instructions'), true)
  assert.equal(changed.target, bot.id)
  assert.equal(typeof changed.time, 'number')
  assert.equal(changed.tokenName, 'Test agent')
})

test('owner read-only and invalid permissions refuse edits through the same handlers', async t => {
  const { rt, tool, call } = await fixture(t)
  assert.equal((await tool('update_bot', { id: 'a', permission: 'invented' })).isError, true)
  rt.readOnly = () => 'Owner has read-only access'
  assert.equal((await tool('update_bot', { id: 'a', instructions: 'bad' })).isError, true)
  assert.equal((await call('agent-token-create', { name: 'extra' })).ok, false)
  assert.equal(rt.state.bots.a.instructions, 'Help')
})

test('failed authentication rate limit counts attempts and resets after its window', async t => {
  const { rt, home, request } = await fixture(t)
  let time = 0
  const access = createAgentAccess(rt, () => {}, { now: () => time })
  t.after(access.close)
  for (let i = 0; i < 10; i++) {
    assert.equal((await access.fetch(request({}, 'wrong'))).status, 401)
  }
  assert.equal((await access.fetch(request({}, 'wrong'))).status, 429)
  time = 60001
  assert.equal((await access.fetch(request({}, 'wrong'))).status, 401)
  const audit = await readFile(join(home, 'agent-audit.jsonl'), 'utf8')
  assert.equal(audit.includes('Too many failed attempts'), true)
})

test('HTTP initialize, notifications, restricted surface and loopback binding', async t => {
  const { rt, rpc, token, view, request } = await fixture(t)
  const info = await view()
  assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  const initialized = await (await rpc('initialize', { protocolVersion: '2025-06-18' })).json()
  assert.equal(initialized.result.protocolVersion, '2025-06-18')
  assert.equal((await rt.agentAccess.fetch(request({ jsonrpc: '2.0',
    method: 'notifications/initialized' }))).status, 202)
  const network = await fetch(info.url, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  assert.equal(network.status, 200)
  assert.equal((await rpc('tools/list', {}, token, { origin: 'https://attacker.invalid' })).status,
    403)
  assert.equal((await rpc('tools/list', {}, token, {
    'mcp-protocol-version': 'wrong',
  })).status, 400)
  assert.equal((await rt.agentAccess.fetch(new Request(info.url, {
    headers: { authorization: `Bearer ${token}` },
  }))).status, 405)
  assert.equal((await rt.agentAccess.fetch(new Request(info.url + '?token=forbidden', {
    headers: { authorization: `Bearer ${token}` },
  }))).status, 403)
  for (const name of ['secret-set', 'run_shell', 'read_file', 'install_plugin', 'chat']) {
    const result = await (await rpc('tools/call', { name })).json()
    assert.equal(result.error.code, -32602)
  }
})

test('tokens and revocation tombstones persist after restart', async t => {
  const { rt, request, id, rpc } = await fixture(t)
  const next = createAgentAccess(rt, async () => ({ ok: true }))
  t.after(next.close)
  assert.equal((await next.fetch(request({ jsonrpc: '2.0', id: 1, method: 'ping' }))).status, 200)
  await next.owner('revoke', { id })
  assert.equal((await rpc('ping')).status, 401, 'an existing reader reloads revocations')
  const restarted = createAgentAccess(rt, async () => ({ ok: true }))
  t.after(restarted.close)
  assert.equal((await restarted.fetch(request({ jsonrpc: '2.0', id: 2, method: 'ping' }))).status,
    401)
})

test('an unavailable audit refuses to perform a mutation', async t => {
  const { home, tool, rt, call } = await fixture(t)
  await mkdir(join(home, 'agent-audit.jsonl'))
  const response = await rt.agentAccess.fetch(new Request('http://localhost/mcp'))
  assert.equal(response.status, 503)
  await assert.rejects(tool('update_bot', { id: 'a', instructions: 'bad' }))
  assert.equal(rt.state.bots.a.instructions, 'Help')
  assert.equal((await call('update-bot', { id: 'b', role: 'Still editable' })).ok, true)
})


test('owner edits cannot interleave with an MCP audit transaction', async t => {
  const { rt, tool, call, view } = await fixture(t)
  let release
  let entered
  const blocked = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const original = rt.updateBot
  rt.updateBot = async (id, ...args) => {
    if (id === 'a') { entered(); await blocked }
    return original(id, ...args)
  }
  const agentEdit = tool('update_bot', { id: 'a', instructions: 'Agent edit' })
  await ready
  const ownerEdit = call('update-bot', { id: 'b', instructions: 'Owner edit' })
  await new Promise(resolve => setImmediate(resolve))
  const beforeRelease = rt.state.bots.b.instructions
  release()
  await Promise.all([agentEdit, ownerEdit])
  assert.equal(beforeRelease, '')
  const completed = (await view()).audit.find(entry => entry.action === 'update_bot'
    && entry.outcome === 'allowed')
  assert.deepEqual(completed.changes.bots, {
    a: { instructions: { before: 'Help', after: 'Agent edit' } },
  })
  assert.equal((await call('get-bot', { id: 'b' })).value.instructions, 'Owner edit')
})

test('real HTTP oversized and unsupported requests retain token audit identity', async t => {
  const { token, view } = await fixture(t)
  const { url } = await view()
  const headers = { authorization: `Bearer ${token}`,
    accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
  const large = await fetch(url, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_bot',
      arguments: { id: 'a', instructions: 'x'.repeat(65536) } },
  }) })
  assert.equal(large.status, 413)
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'TRACE', headers }, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(status, 405)
  const refused = (await view()).audit.filter(entry => entry.outcome === 'refused')
  assert.equal(refused.length, 2)
  assert.equal(refused.every(entry => entry.tokenName === 'Test agent' && entry.callId), true)
})


test('an active token resumes the loopback listener after restart', async t => {
  const { rt, token } = await fixture(t)
  await rt.agentAccess.close()
  const resumed = createAgentAccess(rt, async () => ({ ok: true }))
  t.after(resumed.close)
  await resumed.resume()
  const info = await resumed.owner('view')
  assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  const response = await fetch(info.url, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
  assert.equal(response.status, 200)
})


test('internal Bot tool edits wait outside the external agent audit', async t => {
  const { rt, ctx, tool, view } = await fixture(t)
  let release
  let entered
  const blocked = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const original = rt.updateBot
  rt.updateBot = async (id, ...args) => {
    if (id === 'a') { entered(); await blocked }
    return original(id, ...args)
  }
  const agentEdit = tool('update_bot', { id: 'a', instructions: 'External edit' })
  await ready
  const internalEdit = ctx.registeredTools.get('update_bot').execute({
    bot: 'Beta', instructions: 'Internal edit',
  }, { agent: { id: 'a' } })
  await new Promise(resolve => setImmediate(resolve))
  const beforeRelease = rt.state.bots.b.instructions
  release()
  const [, response] = await Promise.all([agentEdit, internalEdit])
  assert.equal(beforeRelease, '')
  assert.match(response, /Updated Beta/)
  const completed = (await view()).audit.find(entry => entry.action === 'update_bot'
    && entry.outcome === 'allowed')
  assert.equal(completed.changes.bots.b, undefined)
  assert.equal(rt.state.bots.b.instructions, 'Internal edit')
})

test('queued MCP and owner edits complete after a refused MCP action', async t => {
  const { rt, tool, call, view } = await fixture(t)
  let release
  let entered
  const blocked = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const original = rt.updateBot
  rt.updateBot = async (id, patch, ...rest) => {
    if (patch.instructions === 'Refused edit') {
      entered()
      await blocked
      throw Object.assign(new Error('Refused edit'), { code: 'bot/refused' })
    }
    return original(id, patch, ...rest)
  }
  const refused = tool('update_bot', { id: 'a', instructions: 'Refused edit' })
  await ready
  const next = tool('update_bot', { id: 'a', instructions: 'Next edit' })
  const owner = call('update-bot', { id: 'b', instructions: 'Owner edit' })
  release()
  const [first, second, third] = await Promise.all([refused, next, owner])
  assert.equal(first.isError, true)
  assert.equal(second.isError, false)
  assert.equal(third.ok, true)
  const changes = (await view()).audit.filter(entry => entry.outcome === 'allowed'
    && entry.action === 'update_bot')
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0].changes.bots, {
    a: { instructions: { before: 'Help', after: 'Next edit' } },
  })
})
