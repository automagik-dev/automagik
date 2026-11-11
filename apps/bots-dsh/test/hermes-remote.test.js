import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { HermesTransport, RemoteChat, LOST, HERMES_DEADLINES, INVALID_FRAME } from '../src/host/hermes-transport.js'
import { remoteApproval, RemoteChatAdapter } from '../src/host/remote-chat-adapter.js'
import { install } from '../src/host/hermes-remote.js'
import { fallbackFor } from '../src/host/fallback.js'
import { routeOf, selectorRouteOf, crossesHarness } from '../src/shared/routes.js'
import { contractPin, differences, USED_METHODS } from '../scripts/hermes-contract.mjs'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { desktop8Session } from './fixtures/hermes-desktop8.mjs'

// All addresses and secrets are generated per test. No network or Hermes process is used.
function fixture(t, overrides = {}) {
  const credential = randomUUID(), ticket = randomUUID()
  const address = `https://${randomUUID()}.invalid`
  const sent = [], headers = [], identities = []
  const source = desktop8Session(randomUUID(), randomUUID())
  const snapshot = source.create
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
        : ['session.create', 'session.resume', 'session.activate'].includes(frame.method) ? { ...(frame.method === 'session.create' ? snapshot : source.live), ...overrides.snapshot }
          : frame.method === 'session.events.since' ? { events: [], latest_seq: 9, epoch: 'epoch-a', truncated: false, count: 0, open_requests: [], ...overrides.replay }
            : frame.method === 'model.options' ? { providers: [{ slug: 'sample', name: 'Sample', authenticated: true, models: ['sample-model'] }] }
              : { status: 'streaming', ...overrides.result }
      if (frame.method === 'session.events.since' && Array.isArray(result.events)) {
        result.events = result.events.map((event, index) => ({ session_id: snapshot.session_id, seq: index + 1, ...event }))
        result.count = result.events.length
      }
      queueMicrotask(() => {
        this.reply(frame, result)
        if (frame.method === 'session.create' && overrides.metadata !== false) queueMicrotask(() => this.event('session.info', { ...source.info, ...overrides.metadata }))
      })
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
  return { wire, run, identity, identities, sent, headers, snapshot, live: source.live, info: source.info, credential, ticket, socket: () => socket }
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
    queueMicrotask(() => socket.frame({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: `${f.credential} ${f.ticket}`, data: { Authorization: f.credential } } }))
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
  f.socket().event('tool.complete', { tool_id: 'sample-tool', name: 'sample', result_text: 'Sample result' })
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
  const f = fixture(t, { snapshot: { running: true, open_requests: [{ id: 'srq-pending', method: 'approval', params: { session_id: 'sample-runtime', request_id: 'pending' } }] } })
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
  await f.run.prepare({ model: 'other-model', provider: 'sample' })
  const change = f.sent.find(frame => frame.method === 'config.set')
  assert.equal(change.params.key, 'model')
  assert.equal(change.params.value, 'other-model --provider sample --session')
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
    queueMicrotask(() => socket.reply(frame, { ...f.live, running: false, messages: [{ role: 'assistant', text: 'Finished' }] }))
    return true
  } })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: 'old', pendingSubmit: true, uncertain: true })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.unknown, false)
  assert.equal(result.snapshot.messages.at(-1).text, 'Finished')
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

test('fresh lazy create waits for authoritative approval metadata before any submit', async t => {
  const f = fixture(t, { metadata: false })
  await f.wire.connect()
  const submitting = f.run.submit('After metadata only')
  while (!f.sent.some(frame => frame.method === 'session.create')) await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(Object.hasOwn(f.snapshot.info, 'approval_mode'), false)
  assert.equal(Object.hasOwn(f.snapshot.info, 'yolo'), false)
  assert.ok(!f.sent.some(frame => frame.method === 'prompt.submit'))
  f.socket().frame({ jsonrpc: '2.0', method: 'event', params: { type: 'session.info', session_id: randomUUID(), payload: f.info } })
  assert.ok(!f.sent.some(frame => frame.method === 'prompt.submit'))
  f.socket().event('session.info', f.info)
  await submitting
  assert.equal(f.sent.filter(frame => frame.method === 'prompt.submit').length, 1)
  assert.equal(f.identity.storedSessionId, f.snapshot.stored_session_id)
})

test('approval metadata can precede the create reply without being missed', async t => {
  const f = fixture(t, { metadata: false, handle: (frame, socket) => {
    if (frame.method !== 'session.create') return false
    socket.event('session.info', f.info)
    queueMicrotask(() => socket.reply(frame, f.snapshot))
    return true
  } })
  await f.wire.connect(); await f.run.submit('Sample')
  assert.equal(f.sent.filter(frame => frame.method === 'prompt.submit').length, 1)
})

test('missing or unsafe authoritative approval metadata never submits or changes global approval mode', async t => {
  for (const metadata of [false, { approval_mode: 'off', yolo: true }, { approval_mode: 'manual', yolo: true }, { approval_mode: 'smart', yolo: false }]) {
    const f = fixture(t, { metadata })
    f.wire.startUntil = Date.now() + 35
    await f.wire.connect()
    await assert.rejects(f.run.submit('Never sent'), /approval metadata|manual approvals/)
    assert.ok(!f.sent.some(frame => ['prompt.submit', 'config.set'].includes(frame.method)))
    assert.equal(f.wire.listeners.size, 1)
  }
})

test('resume and activate normalize session_key and nested stored identity before saving', async t => {
  const f = fixture(t, { snapshot: { messages: [{ role: 'user', text: 'Sample' }, { role: 'assistant', text: 'Sample reply' }] } })
  assert.equal(Object.hasOwn(f.live, 'stored_session_id'), false)
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: randomUUID(), uncertain: true })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.snapshot.stored_session_id, f.live.session_key)
  assert.equal(f.identity.runtimeSessionId, f.live.session_id)
  assert.equal(f.identity.storedSessionId, f.live.info.stored_session_id)
  assert.ok(f.identities.every(identity => !identity.storedSessionId || identity.storedSessionId === f.live.session_key))
  assert.ok(f.sent.some(frame => frame.method === 'session.resume'))
  assert.ok(f.sent.some(frame => frame.method === 'session.activate'))
  await f.run.submit('Next turn')
  assert.ok(!f.sent.some(frame => frame.method === 'session.create'))
})

test('conflicting remote stored identities are refused before submit', async t => {
  const f = fixture(t, { snapshot: { session_key: randomUUID() } })
  await f.wire.connect()
  await assert.rejects(f.run.submit('Never sent'), /conflicting stored session IDs/)
  assert.ok(!f.sent.some(frame => frame.method === 'prompt.submit'))
})

test('epoch restart resets watermark and old stream state, then accepts new deltas and completion', async t => {
  let resolveQuestion
  const f = fixture(t, { ready: { replay_epoch: 'epoch-b' }, replay: { epoch: 'epoch-b', latest_seq: 1 },
    snapshot: { running: true, status: 'working', inflight: { streaming: true } }, question: () => new Promise(resolve => { resolveQuestion = resolve }) })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: f.snapshot.session_id, epoch: 'epoch-a', lastSeq: 100, pendingSubmit: true, uncertain: true })
  f.run.queue.push({ kind: 'text', text: 'Old epoch text' })
  let toolReleased = false
  f.run.tools.set('old-tool', { status: 'running', done: () => { toolReleased = true } })
  f.run.streamed = 'Old epoch text'
  f.wire.textCarry = 'Old prefix'
  const question = f.run.control({ id: 'old-question', method: 'approval', params: { session_id: f.snapshot.session_id, request_id: 'old' } })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(result.gap, true)
  assert.equal(result.unknown, true)
  assert.equal(f.identity.lastSeq, 1)
  assert.equal(f.identity.epoch, 'epoch-b')
  assert.equal(f.run.queue.length, 0)
  assert.equal(f.run.tools.size, 0)
  assert.equal(f.run.questions.size, 0)
  assert.equal(f.run.streamed, '')
  assert.equal(f.wire.textCarry, '')
  assert.equal(toolReleased, true)
  resolveQuestion('once'); await question
  assert.ok(!f.sent.some(frame => frame.id === 'old-question'))
  f.socket().event('message.delta', { text: 'New epoch text' }, 2)
  f.socket().event('message.complete', { text: 'New epoch text', status: 'complete' }, 3)
  assert.deepEqual(await f.run.next(), { kind: 'text', text: 'New epoch text' })
  assert.equal((await f.run.next()).kind, 'done')
  assert.equal(f.identity.lastSeq, 3)
  assert.equal(f.identity.pendingSubmit, false)
  assert.equal(f.identity.uncertain, false)
})

test('completion during activate causes a newer snapshot before reconciliation settles', async t => {
  let activates = 0
  const f = fixture(t, { handle: (frame, socket) => {
    if (frame.method !== 'session.activate') return false
    activates++
    if (activates === 1) socket.event('message.complete', { text: 'Finished', status: 'complete' }, 10)
    queueMicrotask(() => socket.reply(frame, { ...f.live, running: activates === 1, status: activates === 1 ? 'working' : 'idle' }))
    return true
  } })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, epoch: 'epoch-a', pendingSubmit: true, uncertain: true })
  await f.wire.connect()
  const result = await f.run.reconcile()
  assert.equal(activates, 2)
  assert.equal(result.unknown, false)
  assert.equal(f.identity.pendingSubmit, false)
})

test('malformed JSON-RPC frames fail closed without uncaught callbacks or leaked remote data', async t => {
  const malformed = [
    () => null, () => [], () => 1,
    () => ({ method: 'event', params: {} }),
    () => ({ jsonrpc: '2.0', method: 'event', params: null }),
    () => ({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta', payload: { text: {} } } }),
    () => ({ jsonrpc: '2.0', method: 'event', params: { type: 'session.info', payload: { yolo: 'false' } } }),
    () => ({ jsonrpc: '2.0', method: 'event', params: { type: 'request.cancel', session_id: 'sample', payload: { id: {}, method: 'approval', reason: 'sample' } } }),
    () => ({ jsonrpc: '2.0', id: 1, method: 'approval', params: null }),
    () => ({ jsonrpc: '2.0', id: 1, method: 'approval', params: { session_id: 'sample', request_id: 'sample', command: {} } }),
    () => ({ jsonrpc: '2.0', id: 99, result: {}, error: { code: -1, message: 'sample' } }),
    () => ({ jsonrpc: '2.0', id: 99, error: null }),
  ]
  for (const make of malformed) {
    const f = fixture(t, { handle: frame => frame.method === 'sample' })
    await f.wire.connect()
    const pending = assert.rejects(f.wire.request('sample'), { message: INVALID_FRAME })
    assert.doesNotThrow(() => f.socket().frame(make()))
    await pending
    assert.equal(f.wire.pending.size, 0)
    assert.equal(f.wire.connected, false)
    assert.equal(f.wire.closed, true)
    assert.equal((await f.run.next()).text, INVALID_FRAME)
  }
})

test('malformed RPC results consumed by the client close and clean up pending requests', async t => {
  for (const [method, result] of [
    ['client.capabilities', { server_requests: {} }], ['model.options', { providers: [null] }],
    ['model.options', { providers: [{ slug: 'sample', models: 'sample' }] }],
    ['session.resume', { session_id: 'sample', info: null, messages: [] }],
    ['session.activate', { session_id: 'sample', info: {}, messages: {} }],
    ['session.events.since', { events: [], epoch: 'epoch-a', latest_seq: {}, truncated: false, open_requests: [] }],
    ['config.set', { scope: {} }], ['prompt.submit', { admission_id: {} }],
  ]) {
    const f = fixture(t, { handle: (frame, socket) => {
      if (frame.method !== method || (method === 'client.capabilities' && !f.wire.connected)) return false
      queueMicrotask(() => socket.reply(frame, result)); return true
    } })
    await f.wire.connect()
    await assert.rejects(f.wire.request(method), { message: INVALID_FRAME })
    assert.equal(f.wire.pending.size, 0)
    assert.equal(f.wire.closed, true)
  }
})

test('invalid startup frames and bounded byte/depth violations close without throwing', async t => {
  const startup = fixture(t, { handle: (frame, socket) => {
    if (frame.method !== 'client.capabilities') return false
    socket.frame(null); return true
  } })
  await assert.rejects(startup.wire.connect(), { message: INVALID_FRAME })
  assert.equal(startup.wire.closed, true)
  const envelope = payload => ({ jsonrpc: '2.0', method: 'event', params: { type: 'ignored', payload } })
  let nested = {}
  for (let depth = 0; depth < 40; depth++) nested = { nested }
  for (const data of ['{', JSON.stringify(envelope({ text: 'x'.repeat(8 * 1024 * 1024) })), JSON.stringify(envelope(nested))]) {
    const f = fixture(t)
    await f.wire.connect()
    assert.doesNotThrow(() => f.socket().dispatchEvent(new MessageEvent('message', { data })))
    assert.equal(f.wire.closed, true)
    assert.equal((await f.run.next()).text, INVALID_FRAME)
  }
})

test('reconcile fences old approval before awaiting resume and can answer a reused current request ID afterward', async t => {
  let resumeFrame, resolveOldQuestion
  const currentRequest = { id: 'srq-reused', method: 'approval', params: { session_id: randomUUID(), request_id: 'current', command: 'Current command' } }
  let asked = 0
  const f = fixture(t, { replay: { epoch: 'epoch-b', latest_seq: 1 }, snapshot: { open_requests: [currentRequest] },
    question: () => ++asked === 1 ? new Promise(resolve => { resolveOldQuestion = resolve }) : 'once',
    handle: frame => { if (frame.method !== 'session.resume') return false; resumeFrame = frame; return true },
  })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, runtimeSessionId: f.snapshot.session_id, epoch: 'epoch-a', uncertain: true })
  currentRequest.params.session_id = f.snapshot.session_id
  await f.wire.connect()
  const oldQuestion = f.run.control({ id: currentRequest.id, method: 'approval', epoch: 'epoch-a', params: { session_id: f.snapshot.session_id, request_id: 'old', command: 'Old command' } })
  f.wire.epoch = 'epoch-b'
  const reconciling = f.run.reconcile({ answerQuestions: true })
  while (!resumeFrame) await new Promise(resolve => setImmediate(resolve))
  resolveOldQuestion('once')
  await oldQuestion
  assert.ok(!f.sent.some(frame => frame.id === currentRequest.id))
  f.socket().reply(resumeFrame, f.live)
  await reconciling
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(asked, 2)
  assert.deepEqual(f.sent.filter(frame => frame.id === currentRequest.id), [{ jsonrpc: '2.0', id: currentRequest.id, result: { choice: 'once' } }])
  await f.run.control({ id: 'stale-epoch', method: 'approval', epoch: 'epoch-a', params: currentRequest.params })
  assert.equal(asked, 2)
  assert.ok(!f.sent.some(frame => frame.id === 'stale-epoch'))
})

test('reconcile answers only requests still present in the authoritative activate snapshot', async t => {
  let asked = 0
  const f = fixture(t, { question: () => { asked++; return 'once' }, replay: { open_requests: [{ id: 'srq-finished', method: 'approval', params: { session_id: 'sample', request_id: 'finished' } }] } })
  f.identity.storedSessionId = f.snapshot.stored_session_id
  await f.wire.connect()
  await f.run.reconcile({ answerQuestions: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(asked, 0)
  assert.ok(!f.sent.some(frame => frame.id === 'srq-finished'))
})

test('an approval arriving after activate captures open_requests is recovered from a newer snapshot', async t => {
  for (const withdrawn of [false, true]) {
    let activates = 0, asked = 0, request
    const f = fixture(t, { question: () => { asked++; return 'once' }, handle: (frame, socket) => {
      if (frame.method !== 'session.activate') return false
      activates++
      // Source: _live_session_payload has already captured _open_requests(sid).
      const captured = { ...f.live, running: true, status: 'working', ...(activates > 1 && !withdrawn ? { open_requests: [request] } : {}) }
      if (activates === 1) {
        // server_requests.ServerRequest.frame can be written before the captured reply.
        request = { id: 'srq-during-capture', method: 'approval', params: { session_id: f.snapshot.session_id, request_id: randomUUID(), command: 'Sample command', choices: ['once', 'deny'] } }
        socket.frame({ jsonrpc: '2.0', ...request })
        if (withdrawn) socket.event('request.cancel', { id: request.id, method: request.method, reason: 'resolved' })
      }
      queueMicrotask(() => socket.reply(frame, captured))
      return true
    } })
    Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, pendingSubmit: true, uncertain: true, epoch: 'epoch-a' })
    await f.wire.connect()
    const result = await f.run.reconcile({ answerQuestions: true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(activates, 2)
    assert.equal(result.unknown, true)
    assert.equal(asked, withdrawn ? 0 : 1)
    assert.deepEqual(f.sent.filter(frame => frame.id === request.id), withdrawn ? [] : [{ jsonrpc: '2.0', id: request.id, result: { choice: 'once' } }])
    assert.ok(!f.sent.some(frame => frame.method === 'prompt.submit'))
  }
})

test('real adapter recovers upstream role/text history through reconcile without resubmission or secret echoes', async t => {
  const messages = [{ role: 'user', text: 'Earlier prompt' }, { role: 'assistant', text: '' }]
  const f = fixture(t, { snapshot: { messages } })
  messages[1].text = `Recovered answer ${f.credential} ${f.ticket}`
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, pendingSubmit: true, uncertain: true, epoch: 'epoch-a' })
  const agent = { session: { id: 'sample-recovered-chat' }, ctx: { tools: { register: () => () => {} } } }
  const rt = { ctx: { get: name => name === 'agents' ? { get: () => agent, list: () => [agent] } : undefined, on() {} } }
  const adapter = new RemoteChatAdapter(rt, { enabled: () => true, models: () => [{ id: 'sample:model', model: 'model', provider: 'sample' }], identity: () => f.identity, save: async () => {}, open: async () => { await f.wire.connect(); return f.run } })
  t.after(() => adapter.dispose())
  const chunks = []
  for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: 'hermes-remote', model: 'sample:model', sessionId: agent.session.id, messages: [{ role: 'user', content: 'Never resubmit this' }] }))) chunks.push(chunk)
  const recovered = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('\n')
  assert.match(recovered, /Recovered answer \[redacted\] \[redacted\]/)
  assert.ok(!JSON.stringify(chunks).includes(f.credential) && !JSON.stringify(chunks).includes(f.ticket))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.ok(f.sent.some(frame => frame.method === 'session.resume'))
  assert.ok(f.sent.some(frame => frame.method === 'session.activate'))
  assert.ok(!f.sent.some(frame => frame.method === 'session.create' || frame.method === 'prompt.submit'))
})

test('a cancellation after activate captures a pending approval causes a newer snapshot with no answer', async t => {
  let activates = 0, asked = 0
  const f = fixture(t, { question: () => { asked++; return 'once' }, handle: (frame, socket) => {
    if (frame.method !== 'session.activate') return false
    activates++
    const request = { id: 'srq-withdrawn', method: 'approval', params: { session_id: f.snapshot.session_id, request_id: randomUUID(), choices: ['once', 'deny'] } }
    const captured = { ...f.live, ...(activates === 1 ? { open_requests: [request] } : {}) }
    if (activates === 1) socket.event('request.cancel', { id: request.id, method: request.method, reason: 'timeout' })
    queueMicrotask(() => socket.reply(frame, captured))
    return true
  } })
  Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, uncertain: true, epoch: 'epoch-a' })
  await f.wire.connect()
  const result = await f.run.reconcile({ answerQuestions: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(activates, 2)
  assert.equal(result.unknown, false)
  assert.equal(asked, 0)
  assert.ok(!f.sent.some(frame => frame.id === 'srq-withdrawn'))
})

test('a live request cancellation invalidates an approval choice still being awaited', async t => {
  let resolveQuestion
  const f = fixture(t, { question: () => new Promise(resolve => { resolveQuestion = resolve }) })
  await f.wire.connect(); await f.run.prepare()
  const request = { id: 'srq-cancelled-choice', method: 'approval', params: { session_id: f.snapshot.session_id, request_id: randomUUID(), choices: ['once', 'deny'] }, epoch: 'epoch-a' }
  const answering = f.run.control(request)
  f.socket().event('request.cancel', { id: request.id, method: request.method, reason: 'resolved' })
  resolveQuestion('once')
  await answering
  assert.ok(!f.sent.some(frame => frame.id === request.id))
  assert.equal(f.run.questions.has(request.id), false)
})

test('approval churn during activate is bounded and observational capture never answers questions', async t => {
  for (const churn of [true, false]) {
    let activates = 0, asked = 0, request
    const f = fixture(t, { question: () => { asked++; return 'once' }, handle: (frame, socket) => {
      if (frame.method !== 'session.activate') return false
      activates++
      const captured = { ...f.live, ...(request ? { open_requests: [request] } : {}) }
      if (churn || activates === 1) {
        request = { id: `srq-capture-${activates}`, method: 'approval', params: { session_id: f.snapshot.session_id, request_id: randomUUID(), choices: ['once', 'deny'] } }
        socket.frame({ jsonrpc: '2.0', ...request })
      }
      queueMicrotask(() => socket.reply(frame, captured))
      return true
    } })
    Object.assign(f.identity, { storedSessionId: f.snapshot.stored_session_id, uncertain: true, epoch: 'epoch-a' })
    await f.wire.connect()
    if (churn) await assert.rejects(f.run.reconcile({ answerQuestions: true }), /changed while reconciling/)
    else await f.run.reconcile()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(activates, churn ? 3 : 2)
    assert.equal(asked, 0)
    assert.ok(!f.sent.some(frame => frame.id === request.id || frame.method === 'prompt.submit'))
  }
})
