import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { HermesTransport, RemoteChat, LOST, HERMES_DEADLINES } from '../src/host/hermes-transport.js'
import { remoteApproval, RemoteChatAdapter } from '../src/host/remote-chat-adapter.js'
import { install } from '../src/host/hermes-remote.js'
import { fallbackFor } from '../src/host/fallback.js'
import { routeOf, selectorRouteOf, crossesHarness } from '../src/shared/routes.js'
import { contractPin, differences, USED_METHODS } from '../scripts/hermes-contract.mjs'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// All addresses and secrets are generated per test. No network or Hermes process is used.
function fixture(t, overrides = {}) {
  const credential = randomUUID(), ticket = randomUUID()
  const address = `https://${randomUUID()}.invalid`
  const sent = [], headers = [], identities = []
  const snapshot = { session_id: randomUUID(), stored_session_id: randomUUID(), running: false, messages: [], info: { desktop_contract: 8, approval_mode: 'manual', yolo: false } }
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.event('gateway.ready', { replay_epoch: 'epoch-a', ...overrides.ready })) }
    frame(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })) }
    event(type, payload, seq) { this.frame({ jsonrpc: '2.0', method: 'event', params: { type, payload, session_id: snapshot.session_id, ...(seq ? { seq } : {}) } }) }
    reply(frame, result) { this.frame({ jsonrpc: '2.0', id: frame.id, result }) }
    send(text) {
      const frame = JSON.parse(text); sent.push(frame)
      if (!frame.method) return
      if (overrides.handle?.(frame, this) === true) return
      const result = frame.method === 'client.capabilities' ? { server_requests: ['approval'] }
        : ['session.create', 'session.resume', 'session.activate'].includes(frame.method) ? { ...snapshot, ...overrides.snapshot }
          : frame.method === 'session.events.since' ? { events: [], latest_seq: 9, epoch: 'epoch-a', truncated: false, open_requests: [], ...overrides.replay }
            : frame.method === 'model.options' ? { providers: [{ slug: 'sample', name: 'Sample', authenticated: true, models: ['sample-model'] }] }
              : { status: 'streaming', ...overrides.result }
      queueMicrotask(() => this.reply(frame, result))
    }
    close() { this.dispatchEvent(new Event('close')) }
  }
  let socket
  const wire = new HermesTransport({ address, credential, profile: 'sample', deadlines: { start: 200, control: 100, cancel: 30 },
    fetch: async (url, init) => { headers.push({ url, init }); if (overrides.authError) throw Error(`${credential} ${ticket}`); return { ok: !overrides.expired, json: async () => ({ ticket }) } },
    socket: (url, protocols) => { headers.push({ url, protocols }); socket = new Socket(); return socket },
  })
  const identity = { createKey: randomUUID() }
  const run = new RemoteChat(wire, { identity, save: async () => identities.push(structuredClone(identity)), question: overrides.question })
  t.after(() => run.dispose())
  return { wire, run, identity, identities, sent, headers, snapshot, credential, ticket, socket: () => socket }
}

test('ticket handshake negotiates server requests first, persists IDs before submit and shows text/tool', async t => {
  const f = fixture(t, { result: { admission_id: randomUUID() } })
  await f.wire.connect()
  assert.equal(f.sent[0].method, 'client.capabilities')
  assert.equal(f.sent[0].params.server_requests, true)
  assert.equal(f.headers[0].init.headers.Authorization, `Bearer ${f.credential}`)
  assert.equal(f.headers[0].init.redirect, 'error')
  assert.ok(f.headers[1].protocols.includes(`hermes-gateway-ticket.${f.ticket}`))
  assert.ok(!f.headers[1].url.includes(f.credential) && !f.headers[1].url.includes(f.ticket))
  await f.run.submit('Sample text')
  assert.equal(f.identity.runtimeSessionId, f.snapshot.session_id)
  assert.equal(f.identity.storedSessionId, f.snapshot.stored_session_id)
  assert.ok(f.identity.admissionId)
  assert.ok(f.identities.some(identity => identity.pendingSubmit && identity.storedSessionId))
  f.socket().event('message.delta', { text: 'Sample reply' }, 1)
  f.socket().event('tool.start', { tool_id: 'sample-tool', name: 'sample', args: { value: 1 } }, 2)
  assert.deepEqual(await f.run.next(), { kind: 'text', text: 'Sample reply' })
  assert.equal((await f.run.next()).tool.status, 'running')
  f.socket().event('tool.complete', { tool_id: 'sample-tool', name: 'sample', result_text: 'Done' }, 3)
  assert.equal(f.run.tools.get('sample-tool').text, 'Done')
  f.socket().event('message.complete', { text: 'Sample reply' }, 4)
  assert.equal((await f.run.next()).kind, 'done')
  assert.equal(f.identity.pendingSubmit, false)
})

test('expired authentication and thrown authentication errors never echo headers or bodies', async t => {
  for (const options of [{ expired: true }, { authError: true }]) {
    const f = fixture(t, options)
    await assert.rejects(f.wire.connect(), error => /credential|authentication/.test(error.message) && !error.stack.includes(f.credential) && !error.stack.includes(f.ticket))
    assert.equal(f.sent.length, 0)
  }
})

test('wrong Desktop version and canonical authority are refused before any submit', async t => {
  for (const snapshot of [{ info: { desktop_contract: 7 } }, { info: { desktop_contract: 9 } }, { info: {} }, { protocol: 'hermes-gateway-v1' }]) {
    const f = fixture(t, { snapshot }); await f.wire.connect()
    await assert.rejects(f.run.submit('Never sent'), /contract 8|Canonical/)
    assert.ok(!f.sent.some(frame => frame.method === 'prompt.submit'))
  }
  const f = fixture(t, { ready: { session_authority: true } })
  await assert.rejects(f.wire.connect(), /Canonical-authority/)
  assert.equal(f.sent.length, 0)
})

test('unanswered startup and control requests are bounded', async t => {
  const f = fixture(t, { handle: frame => frame.method === 'client.capabilities' })
  f.wire.deadlines.control = 5
  await assert.rejects(f.wire.connect(), /control request/)
  assert.equal(f.wire.pending.size, 0)
  assert.deepEqual(HERMES_DEADLINES, { start: 60_000, control: 15_000, cancel: 5000 })
})

test('dropped submit acknowledgment is durable unknown and never automatically retried', async t => {
  const f = fixture(t, { handle: (frame, socket) => { if (frame.method !== 'prompt.submit') return false; queueMicrotask(() => socket.close()); return true } })
  await f.wire.connect()
  await assert.rejects(f.run.submit('Once only'), { message: LOST })
  assert.ok(f.identity.pendingSubmit && f.identity.uncertain)
  await assert.rejects(f.run.submit('Once only'), /Reconcile/)
  assert.equal(f.sent.filter(frame => frame.method === 'prompt.submit').length, 1)
  assert.ok(f.identities.at(-1).uncertain)
})

test('reconnect resumes stored ID, refreshes runtime ID and replaces a replay gap with snapshot', async t => {
  const f = fixture(t, { replay: { truncated: true, epoch: 'epoch-b', events: [{ type: 'message.delta', payload: { text: 'obsolete' } }] } })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: 'old-runtime', pendingSubmit: true, uncertain: true, epoch: 'epoch-a' })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.gap, true)
  assert.equal(result.unknown, false)
  assert.equal(f.identity.runtimeSessionId, f.snapshot.session_id)
  assert.equal(f.sent.find(frame => frame.method === 'session.resume').params.session_id, f.snapshot.stored_session_id)
  assert.equal(f.run.queue.length, 0)
  assert.ok(!f.sent.some(frame => frame.method === 'prompt.submit'))
})

test('ignored Stop stays unknown; an interrupt acknowledgment does not prove remote children ended', async t => {
  const f = fixture(t)
  await f.wire.connect(); await f.run.submit('Sample')
  await f.run.stop()
  assert.ok(f.identity.uncertain && f.identity.pendingSubmit)
  assert.ok(f.sent.some(frame => frame.method === 'session.interrupt'))
  assert.equal((await f.run.next()).text, LOST)
})

test('Full access answers once, restrictive no-ask denies, manual uses DSH approval', async () => {
  let requests = 0
  const agent = { session: {} }
  const ask = async (policy, sandbox, preset, result = 'allowed-once') => remoteApproval({ get: name => ({
    approval: { effectivePolicy: () => policy, request: async () => { requests++; return result } },
    sandboxPolicy: { resolve: () => ({ mode: sandbox }) }, permissionPresets: { current: () => preset },
  })[name] }, agent, { request_id: 'question', command: 'sample' })
  assert.equal(await ask('never', 'danger-full-access', 'full'), 'once')
  assert.equal(await ask('never', 'read-only', 'read-only'), 'deny')
  assert.equal(requests, 0)
  assert.equal(await ask('ask', 'workspace-write', 'manual'), 'once')
  assert.equal(await ask('ask', 'workspace-write', 'manual', 'rejected'), 'deny')
  assert.equal(await ask('never', 'danger-full-access', 'auto'), 'deny')
  assert.equal(requests, 2)
})

test('an unanswered server approval is denied within control deadline and duplicates answer once', async t => {
  const f = fixture(t, { question: () => new Promise(() => {}) })
  f.wire.deadlines.control = 5
  await f.wire.connect(); await f.run.prepare()
  const question = { jsonrpc: '2.0', id: 'srq-sample', method: 'approval', params: { session_id: f.identity.runtimeSessionId, request_id: 'approval-sample', choices: ['once', 'deny'] } }
  f.socket().frame(question); f.socket().frame(question)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(f.sent.filter(frame => frame.id === question.id), [{ jsonrpc: '2.0', id: question.id, result: { choice: 'deny' } }])
  assert.ok(!f.sent.some(frame => /approval.*(mode|set)/.test(frame.method ?? '')))
})

test('redaction covers ticket/token echoes, nested headers, URL and JSON forms, RPC failures', async t => {
  const f = fixture(t, { handle: (frame, socket) => {
    if (frame.method !== 'sample') return false
    queueMicrotask(() => socket.frame({ id: frame.id, error: { message: `${f.credential} ${f.ticket}`, data: { Authorization: f.credential } } }))
    return true
  } })
  await f.wire.connect()
  const redacted = JSON.stringify(f.wire.redact({ text: `${f.credential} ${f.ticket}`, headers: { Authorization: f.credential }, nested: [{ ticket: f.ticket }] }))
  assert.ok(!redacted.includes(f.credential) && !redacted.includes(f.ticket))
  await assert.rejects(f.wire.request('sample'), error => !error.stack.includes(f.credential) && !error.stack.includes(f.ticket))
})

test('DSH adapter produces a real mirror tool card then continues the same remote turn', async t => {
  const f = fixture(t)
  const registered = []
  const agent = { session: { id: 'sample-chat' }, ctx: { tools: { register: tool => { registered.push(tool); return () => {} } } } }
  const rt = { ctx: { get: name => name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined, on() {} } }
  const adapter = new RemoteChatAdapter(rt, { enabled: () => true, models: () => [{ id: 'sample:model', model: 'model', provider: 'sample' }], identity: () => f.identity, save: async () => {}, open: async () => { await f.wire.connect(); return f.run } })
  t.after(() => adapter.dispose())
  const options = markAgentLoopRequest({ provider: 'hermes-remote', model: 'sample:model', sessionId: 'sample-chat', messages: [{ role: 'user', content: 'Sample' }] })
  const stream = adapter.stream(options)
  const first = stream.next()
  while (!f.sent.some(frame => frame.method === 'prompt.submit')) await new Promise(resolve => setImmediate(resolve))
  f.socket().event('tool.start', { tool_id: 'sample-tool', name: 'Sample tool', args: {} })
  const chunks = [(await first).value]
  for await (const chunk of stream) chunks.push(chunk)
  const call = chunks.find(chunk => chunk.type === 'block-end').block
  assert.equal(call.type, 'tool-call')
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  const execution = registered[0].execute({ id: 'sample-tool', title: 'Sample tool' }, { agent })
  f.socket().event('tool.complete', { tool_id: 'sample-tool', result_text: 'Sample result' })
  assert.equal((await execution).text, 'Sample result')
  f.socket().event('message.delta', { text: 'After tool' })
  f.socket().event('message.complete', { text: 'After tool' })
  const next = markAgentLoopRequest({ ...options, messages: [{ role: 'tool', toolCallId: call.id, content: 'Sample result' }] })
  const continued = []
  for await (const chunk of adapter.stream(next)) continued.push(chunk)
  assert.equal(continued.find(chunk => chunk.type === 'text-delta').text, 'After tool')
  assert.equal(f.sent.filter(frame => frame.method === 'prompt.submit').length, 1)
})

test('connection is off by default, record stores a reference and credential stays mode 0600', async t => {
  const home = await mkdtemp(join(tmpdir(), 'hermes-fixture-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const ctx = fakeContext()
  const rt = createRuntime(ctx, { home })
  t.after(() => ctx.dispose())
  await rt.load(); await rt.loadSecrets()
  assert.equal(rt.hermesRemote.view().enabled, false)
  const credential = randomUUID()
  await rt.hermesRemote.configure({ enabled: true, address: `https://${randomUUID()}.invalid`, profile: 'sample', credential })
  const stored = await readFile(join(home, 'state.json'), 'utf8')
  assert.ok(!stored.includes(credential))
  assert.equal((await stat(join(home, 'secrets.json'))).mode & 0o777, 0o600)
  assert.ok((await readFile(join(home, 'secrets.json'), 'utf8')).includes(credential))
  assert.equal(rt.canUseSecret('HERMES_REMOTE_CREDENTIAL', 'sample-chat'), false)
})

test('remote route crosses from Native and local ACP Hermes; changing only its model does not', () => {
  assert.equal(selectorRouteOf('hermes-remote'), 'hermes-remote')
  assert.deepEqual(routeOf('hermes-remote'), { harness: 'hermes', connectedBy: 'hermes-remote' })
  assert.equal(crossesHarness('acp-hermes/default', 'hermes-remote/sample:model'), true)
  assert.equal(crossesHarness('native/sample', 'hermes-remote/sample:model'), true)
  assert.equal(crossesHarness('hermes-remote/sample:a', 'hermes-remote/sample:b'), false)
})

test('release contract diff follows generated schemas and detects drift without a network', () => {
  const contract = { methods: USED_METHODS.map(name => ({ name, result: { schema: { $ref: '#/components/schemas/Sample' } } })), components: { schemas: { Sample: { type: 'string' } } },
    'x-server-requests': [{ name: 'approval' }], 'x-notifications': ['gateway.ready', 'session.info', 'message.start', 'message.delta', 'message.interim', 'message.complete', 'tool.start', 'tool.complete', 'error'].map(name => ({ name })) }
  const before = contractPin(contract)
  contract.components.schemas.Sample.type = 'number'
  assert.deepEqual(differences(before, contractPin(contract)), ['schema:Sample'])
})

test('final-only text is visible and terminal failure and interruption never become success', async t => {
  for (const status of ['complete', 'error', 'interrupted']) {
    const f = fixture(t)
    await f.wire.connect(); await f.run.submit('Sample')
    f.socket().event('message.complete', { text: 'Final-only sample', status })
    assert.deepEqual(await f.run.next(), { kind: 'text', text: 'Final-only sample' })
    assert.equal((await f.run.next()).kind, status === 'complete' ? 'done' : status === 'error' ? 'error' : 'aborted')
    assert.equal(f.identity.pendingSubmit, false)
  }
})

test('Settings reconciliation observes pending approvals without answering them', async t => {
  const f = fixture(t, { snapshot: { running: true, open_requests: [{ id: 'srq-pending', method: 'approval', params: { request_id: 'pending' } }] } })
  f.identity.storedSessionId = f.snapshot.stored_session_id
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.unknown, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!f.sent.some(frame => frame.id === 'srq-pending'))
})

test('real adapter signal Stop keeps socket open for interrupt and honours the cancel grace', async t => {
  const f = fixture(t)
  const agent = { session: { id: 'sample-stop' }, ctx: { tools: { register: () => () => {} } } }
  const ctx = fakeContext({ services: { agents: { get: () => agent, list: () => [agent] } } })
  ctx.llm.registerAdapter = () => () => {}
  const rt = { ctx, state: { prefs: { hermesRemote: { enabled: true, address: f.wire.address, profile: 'sample', credentialRef: 'SAMPLE', models: [{ id: 'sample:model', model: 'model', provider: 'sample' }] } } },
    hooks: { endpoint() {} }, load: async () => {}, save: async () => {}, loadSecrets: async () => {}, secretValue: () => f.credential }
  install(rt, { transport: () => f.wire })
  t.after(() => ctx.dispose())
  const controller = new AbortController()
  const stream = rt.hermesRemote.adapter.stream(markAgentLoopRequest({ provider: 'hermes-remote', model: 'sample:model', sessionId: agent.session.id, signal: controller.signal, messages: [{ role: 'user', content: 'Sample' }] }))
  const first = stream.next()
  while (!f.sent.some(frame => frame.method === 'prompt.submit')) await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await first
  await stream.return()
  assert.ok(f.sent.some(frame => frame.method === 'session.interrupt'))
  assert.ok(rt.state.hermesSessions[agent.session.id].uncertain)
})

test('an uncertain remote turn never falls back to another model', () => {
  assert.equal(fallbackFor({ failure: { code: 'REMOTE_HERMES', message: LOST }, failed: { provider: 'hermes-remote', model: 'sample' }, fallback: { provider: 'native', model: 'sample' } }), undefined)
})

test('resumed model changes explicitly opt out of profile persistence', async t => {
  const f = fixture(t, { result: { scope: 'session' } })
  f.identity.storedSessionId = f.snapshot.stored_session_id
  await f.wire.connect()
  await f.run.prepare({ model: 'sample-model', provider: 'sample' })
  const change = f.sent.find(frame => frame.method === 'config.set')
  assert.equal(change.params.key, 'model')
  assert.equal(change.params.value, 'sample-model --provider sample --session')
})

test('streaming redaction carries credential and one-use ticket prefixes across frames', async t => {
  const f = fixture(t)
  await f.wire.connect(); await f.run.submit('Sample')
  for (const secret of [f.credential, f.ticket]) {
    const half = Math.floor(secret.length / 2)
    f.socket().event('message.delta', { text: secret.slice(0, half) })
    f.socket().event('message.delta', { text: secret.slice(half) + ' ' })
  }
  f.socket().event('message.complete', { response_reused: true, status: 'complete' })
  let output = ''
  for (;;) { const row = await f.run.next(); if (row.kind === 'done') break; if (row.kind === 'text') output += row.text }
  assert.ok(!output.includes(f.credential) && !output.includes(f.ticket))
  assert.match(output, /redacted/)
})

test('observational reconciliation never answers a live approval delivered during replay', async t => {
  const f = fixture(t, { handle: (frame, socket) => {
    if (frame.method === 'session.events.since') socket.frame({ jsonrpc: '2.0', id: 'srq-live', method: 'approval', params: { session_id: f.identity.runtimeSessionId, request_id: 'live' } })
    return false
  } })
  f.identity.storedSessionId = f.snapshot.stored_session_id
  await f.wire.connect(); await f.run.reconcile()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!f.sent.some(frame => frame.id === 'srq-live'))
})

test('completion between resume and replay is reconciled through a fresh authoritative snapshot', async t => {
  const f = fixture(t, { snapshot: { running: true }, replay: { events: [{ seq: 2, type: 'message.complete', payload: { text: 'Finished', status: 'complete' } }], latest_seq: 2 }, handle: (frame, socket) => {
    if (frame.method !== 'session.activate') return false
    queueMicrotask(() => socket.reply(frame, { ...f.snapshot, running: false, messages: [{ role: 'assistant', content: 'Finished' }] }))
    return true
  } })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: 'old', pendingSubmit: true, uncertain: true })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.unknown, false)
  assert.equal(result.snapshot.messages.at(-1).content, 'Finished')
  assert.equal(f.identity.pendingSubmit, false)
  assert.equal(f.identity.lastSeq, 2)
})

test('an earlier completion never overrides a fresh snapshot of a newly active remote turn', async t => {
  const f = fixture(t, { snapshot: { running: true, status: 'working', inflight: { streaming: true } }, handle: (frame, socket) => {
    if (frame.method === 'session.events.since') socket.event('message.complete', { text: 'Earlier turn', status: 'complete' })
    return false
  } })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: f.snapshot.session_id, pendingSubmit: true, uncertain: true })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.unknown, true)
  assert.equal(f.identity.uncertain, true)
  await assert.rejects(f.run.submit('Do not submit'), /Reconcile/)
})
