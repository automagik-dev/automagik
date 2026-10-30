import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { install } from '../src/host/parts.js'
import { fakeContext } from './fake-ctx.js'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const text = value => ({ role: 'user', content: [{ type: 'text', text: value }] })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function bench({ meter = true, loaded = true, native = false } = {}) {
  const calls = { compact: 0, flush: 0, renewed: 0, resolved: 0, saved: 0, streams: [] }
  let tokens = 10000
  const session = { id: 's1', seq: 3, requestHeader: () => ({ config: { provider: 'p', model: 'm', maxTokens: 1000 } }), deriveMessages: () => [text('hello'), { role: 'assistant', content: [{ type: 'text', text: 'world' }] }], toolHistory: () => [] }
  const agent = { id: 's1', session, status: 'idle', inbox: { nextStep: [], nextTurn: [], prepend(_where, message) { this.nextTurn.unshift(message) }, remove(id) { this.nextTurn = this.nextTurn.filter(message => message.id !== id) } }, send(message) { this.inbox.nextTurn.push(message) } }
  const compaction = { summarize() {}, async compactIfNeeded() {}, async compactRegion() {}, async compactNow(target, signal) { calls.compact++; await calls.hold?.promise; signal.throwIfAborted(); if (calls.failure) throw calls.failure; tokens = 100; return calls.result === undefined ? {} : calls.result } }
  const ctx = fakeContext({ services: { compaction, ...(meter ? { tokenMeter: { measure: () => ({ totalTokens: tokens }) } } : {}) } })
  ctx.sessions = { list: () => loaded ? [session] : [], flush: async () => { calls.flush++ } }
  ctx.llm = { resolveModelInfo: async () => ({ context: { contextWindow: 100000 } }), stream: options => { calls.streams.push(options); return (async function* () { yield { type: 'text-delta', index: 0, text: 'A summary' }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }
  const bot = { id: 'b1', name: 'Bot', createdAt: 1, sessionId: 's1', ...(native ? { kind: 'dsh' } : {}) }
  const rt = { ctx, config: {}, state: { switching: {}, bots: { b1: bot } }, botOf: id => rt.state.bots[id], roomOf: () => undefined, chatOf: id => rt.state.bots[id]?.sessionId, selfOf: id => id === 's1' ? 'b1' : undefined, chatOwners: new Map([['s1', 'b1']]), groupOwners: new Map(), pastOwners: new Map(), isBotSession: id => id === 's1', readOnly: () => calls.readOnly, load: async () => {}, save: async () => { calls.saved++ }, warn() {}, renewMemory: () => { calls.renewed++ }, resolveAgent: async () => { calls.resolved++; return agent }, tagUsage: (messages, tag) => Object.assign(messages, { tag }) }
  install(rt)
  if (loaded) ctx.emit('agent/created', { agent })
  const preStep = ctx.listeners.get('agent/pre-step')[0]
  return { rt, ctx, agent, bot, calls, compaction, preStep, stop: () => ctx.dispose() }
}

// Real installed compaction transaction + real Session surface/event projection.
// Only the agent admission boundary, persistence sink and LLM are test doubles.
function backendBench() {
  const b = bench()
  const session = new Session('s1')
  session.append('request/header', { reason: 'initial', header: { config: { provider: 'p', model: 'm', maxTokens: 1000 } } })
  for (const value of ['first '.repeat(200), 'second '.repeat(200), 'latest input']) session.append('user/message', createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  b.agent.session = session
  b.ctx.sessions.list = () => [session]
  const meter = { measure: target => ({ totalTokens: target.surface.nodes.length * 10000, nodes: target.surface.nodes.map(seq => ({ seq, tokens: 10000, heuristicTokens: 10000 })) }), estimateMessage: () => 100 }
  const get = b.ctx.get
  b.ctx.get = name => name === 'tokenMeter' ? meter : get(name)
  b.ctx.tokenMeter = meter
  b.compaction.ctx = b.ctx
  b.compaction.regionDependencies = () => ({ meter, summarize: (...args) => b.compaction.summarize(...args), recover: () => false })
  b.compaction[Symbol.for('ds-bot/compaction')].compactNow = BasicCompactionEngine.prototype.compactNow
  b.agent.runMaintenance = job => {
    assert.equal(b.calls.maintenance, undefined, 'must not nest maintenance')
    const controller = new AbortController()
    b.calls.maintenance = controller
    return Promise.resolve().then(() => job(controller.signal)).finally(() => { delete b.calls.maintenance })
  }
  const flush = b.ctx.sessions.flush
  b.ctx.sessions.flush = async target => { await flush(target); b.calls.persisted = target.snapshotEvents() }
  b.rt.eventsBackwards = async function* () { yield* [...session.snapshotEvents()].reverse() }
  return { ...b, session }
}

// Expose the installed private loop class only in this test's module instance.
// Its real admission/wake methods run unchanged; no installed files are edited.
async function loopPrototype() {
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'context-test:agent-loop') {
        const result = next('@deepseek-ai/dsh-agent-loop', context)
        return { ...result, url: `${result.url}?context-maintenance-test` }
      }
      return next(specifier, context)
    },
    load(url, context, next) {
      const result = next(url, context)
      return url.endsWith('?context-maintenance-test') ? { ...result, source: `${result.source}\nexport { ReactLoopAgent as ContextTestLoop }` } : result
    },
  })
  try { return (await import('context-test:agent-loop')).ContextTestLoop.prototype } finally { hook.deregister() }
}

for (const mode of ['explicit', 'explicit-failure', 'automatic']) test(`${mode} authority is revoked before a real maintenance wake finishes delayed assembly`, async t => {
  const b = backendBench(); t.after(b.stop)
  Object.setPrototypeOf(b.agent, await loopPrototype())
  delete b.agent.status; delete b.agent.runMaintenance; delete b.agent.send
  b.agent.phase = { kind: 'idle', lastTurn: 0 }
  b.agent.dispatch = { emit: (name, payload) => b.ctx.emit(name, { agent: b.agent, ...payload }) }
  b.agent.loopCtx = { agents: { withInitiator: (_agent, fn) => fn() } }
  Object.defineProperty(b.agent.inbox, 'hasPending', { get() { return this.nextTurn.length + this.nextStep.length > 0 } })
  b.agent.inbox.splice = function (target, _start, _delete, messages) { this[target === 'next-turn' ? 'nextTurn' : 'nextStep'].push(...messages) }
  const assembly = deferred(), releaseAssembly = deferred(), driverDone = deferred()
  const original = b.compaction[Symbol.for('ds-bot/compaction')]
  b.calls.nativePressure = 0
  original.compactIfNeeded = async () => { b.calls.nativePressure++; return null }
  b.compaction.overflowRetries = new WeakMap(); b.compaction.overflowAgents = new WeakMap()
  BasicCompactionEngine.prototype._registerAutomaticCompaction.call(b.compaction)
  const nativePreStep = b.ctx.listeners.get('agent/pre-step').at(-1)
  b.agent.kick = async () => {
    assembly.resolve()
    try {
      await releaseAssembly.promise
      const payload = { agent: b.agent, signal: new AbortController().signal, messages: [], step: 1 }
      await b.preStep(payload, () => nativePreStep(payload, () => ({ kind: 'continue' })))
      assert.equal(b.calls.nativePressure, 0, 'native pressure compaction must not inherit expired Bot authority')
      await assert.rejects(b.compaction.compactNow(b.agent, payload.signal), /makes room on its own/)
      driverDone.resolve()
    } catch (error) { driverDone.resolve(error) }
  }
  const measure = b.ctx.tokenMeter.measure
  b.ctx.tokenMeter.measure = session => ({ ...measure(session), totalTokens: session.snapshotEvents().some(event => event.type === 'compaction/summary') ? 100 : 30000 })
  b.ctx.llm.stream = options => (async function* () {
    if (options.messages.tag.kind !== 'steward') b.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'arrived during maintenance' }], source: { kind: 'user' } }))
    if (mode === 'explicit-failure') throw new Error('The checkpoint summary failed')
    yield { type: 'text-delta', index: 0, text: options.messages.tag.kind === 'steward' ? '{"action":"compact"}' : 'A summary' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
  let checkpoint
  if (mode !== 'automatic') checkpoint = b.rt.checkpointBot('b1', { sessionId: 's1' })
  else { b.bot.contextCheckRatio = .05; b.ctx.emit('agent/status', { agent: b.agent, status: 'idle' }) }
  await assembly.promise
  if (mode === 'explicit-failure') await assert.rejects(checkpoint, /could not produce a smaller summary/)
  else if (checkpoint) await checkpoint
  else await new Promise(setImmediate)
  assert.equal((await b.rt.contextStatus('b1')).markers.checking, false)
  releaseAssembly.resolve()
  assert.equal(await driverDone.promise, undefined)
  await b.agent.activityDone
})

test('revocable Bot guard still leaves plain DSH and child compaction native', async t => {
  const b = bench({ native: true }); t.after(b.stop)
  const signal = new AbortController().signal
  await b.compaction.compactNow(b.agent, signal)
  await b.compaction.compactNow({ id: 'child', session: { id: 'child' } }, signal)
  assert.equal(b.calls.compact, 2)
})

test('status readOnly is a boolean and matches the checkpoint refusal', async t => {
  const b = bench(); t.after(b.stop)
  assert.equal((await b.rt.contextStatus('b1')).readOnly, false)
  b.calls.readOnly = 'Another process owns this team'
  const status = await b.rt.contextStatus('b1')
  assert.equal(status.readOnly, true)
  assert.equal(status.checkpointReason, 'bot/read-only')
  assert.equal(status.canCheckpoint, false)
})

test('status is read-only, measured or estimated, and never reopens a Session', async t => {
  for (const meter of [true, false]) {
    const b = bench({ meter }); t.after(b.stop)
    const status = await b.rt.contextStatus('b1')
    assert.equal(status.sessionId, 's1')
    // A legacy meter's finite total has no provider-usage provenance.
    assert.equal(status.usage.source, 'estimated')
    if (meter) assert.equal(status.usage.tokens, 10000)
    assert.equal(status.counts.messages, 2)
    assert.equal(status.counts.parts, 1)
    assert.equal(status.lines.check, 79200)
    assert.equal(status.canCheckpoint, true)
    assert.deepEqual([b.calls.resolved, b.calls.compact, b.calls.saved, b.calls.streams.length], [0, 0, 0, 0])
  }
  const b = bench({ loaded: false }); t.after(b.stop)
  const status = await b.rt.contextStatus('b1')
  assert.equal(status.usage.source, 'unavailable')
  assert.equal(status.canCheckpoint, false)
  assert.equal(b.calls.resolved, 0)
})

test('native token-meter provenance distinguishes provider usage from heuristic and repriced totals without changing numbers', async t => {
  const usage = { inputTokens: 80, outputTokens: 20 }
  const anchor = tokens => ({ kind: 'usage', tokens, usage: tokens === 0 ? { inputTokens: 0, outputTokens: 0 } : usage })
  // These are the pinned TokenMeasurement baseline union and signed surface delta,
  // not an assumption that a native service's number is necessarily measured.
  const cases = [
    ['none', { totalTokens: 0, baseline: { kind: 'none', tokens: 0 }, surfaceDeltaTokens: 0 }, 'estimated'],
    ['heuristic', { totalTokens: 100, baseline: { kind: 'estimated', tokens: 100 }, surfaceDeltaTokens: 0 }, 'estimated'],
    ['provider anchor', { totalTokens: 100, baseline: anchor(100), surfaceDeltaTokens: 0 }, 'measured'],
    ['provider zero', { totalTokens: 0, baseline: anchor(0), surfaceDeltaTokens: 0 }, 'measured'],
    ['positive repricing', { totalTokens: 110, baseline: anchor(100), surfaceDeltaTokens: 10 }, 'estimated'],
    ['negative repricing', { totalTokens: 90, baseline: anchor(100), surfaceDeltaTokens: -10 }, 'estimated'],
    ['legacy', { totalTokens: 100 }, 'estimated'],
    ['missing anchor', { totalTokens: 100, surfaceDeltaTokens: 0 }, 'estimated'],
    ['unknown anchor', { totalTokens: 100, baseline: { kind: 'other', tokens: 100 }, surfaceDeltaTokens: 0 }, 'estimated'],
    ['negative anchor', { totalTokens: 0, baseline: anchor(-1), surfaceDeltaTokens: 0 }, 'estimated'],
    ['infinite anchor', { totalTokens: 100, baseline: anchor(Infinity), surfaceDeltaTokens: 0 }, 'estimated'],
    ['NaN anchor', { totalTokens: 100, baseline: anchor(NaN), surfaceDeltaTokens: 0 }, 'estimated'],
    ['string anchor', { totalTokens: 100, baseline: anchor('100'), surfaceDeltaTokens: 0 }, 'estimated'],
    ['mismatched anchor', { totalTokens: 100, baseline: anchor(99), surfaceDeltaTokens: 0 }, 'estimated'],
    ['missing delta', { totalTokens: 100, baseline: anchor(100) }, 'estimated'],
    ['NaN delta', { totalTokens: 100, baseline: anchor(100), surfaceDeltaTokens: NaN }, 'estimated'],
    ['infinite delta', { totalTokens: 100, baseline: anchor(100), surfaceDeltaTokens: Infinity }, 'estimated'],
    ['null anchor', { totalTokens: 100, baseline: null, surfaceDeltaTokens: 0 }, 'estimated'],
  ]
  const b = bench(); t.after(b.stop)
  const get = b.ctx.get
  for (const [label, metadata, source] of cases) {
    const measurement = { logRevision: 3, surfaceTokens: 100, nodes: [], ...metadata }
    b.ctx.get = name => name === 'tokenMeter' ? { measure: () => measurement } : get(name)
    const status = await b.rt.contextStatus('b1')
    assert.deepEqual(status.usage, { tokens: metadata.totalTokens, source }, label)
    assert.deepEqual(status.lines, { window: 100000, usable: 99000, check: 79200, hard: 94050 }, `${label}: thresholds unchanged`)
  }
  assert.deepEqual([b.calls.resolved, b.calls.compact, b.calls.saved, b.calls.streams.length], [0, 0, 0, 0])
})

test('invalid/missing measurements fall back, unrouted history has no invented lines, and stale reads refuse', async t => {
  const b = bench(); t.after(b.stop)
  const get = b.ctx.get
  b.ctx.get = name => name === 'tokenMeter' ? { measure: () => ({ totalTokens: Infinity }) } : get(name)
  assert.equal((await b.rt.contextStatus('b1')).usage.source, 'estimated')
  b.agent.session.requestHeader = () => undefined
  const status = await b.rt.contextStatus('b1')
  assert.equal(status.lines, null)
  assert.equal(status.canCheckpoint, false)
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/refused' })
  b.agent.session.requestHeader = () => ({ config: { provider: 'p', model: 'm' } })
  const entered = deferred(), release = deferred()
  b.ctx.llm.resolveModelInfo = async () => { entered.resolve(); await release.promise; return {} }
  const pending = b.rt.contextStatus('b1')
  await entered.promise
  b.bot.sessionId = 's2'; release.resolve()
  await assert.rejects(pending, { code: 'bot/stale' })
  assert.deepEqual([b.calls.saved, b.calls.compact, b.calls.resolved], [0, 0, 0])
})

test('checkpoint is same-session maintenance, persisted, and native compaction stays guarded', async t => {
  const b = bench(); t.after(b.stop)
  await assert.rejects(b.compaction.compactNow(b.agent), /makes room on its own/)
  const done = await b.rt.checkpointBot('b1', { sessionId: 's1' })
  assert.equal(done.status, 'checkpointed')
  assert.equal(done.sessionId, 's1')
  assert.equal(b.bot.sessionId, 's1')
  assert.deepEqual([b.calls.compact, b.calls.flush, b.calls.renewed], [1, 1, 1])
  await assert.rejects(b.compaction.compactNow(b.agent), /makes room on its own/)
})

test('checkpoint rejects invalid, stale, deleted, read-only, busy and native targets', async t => {
  const b = bench(); t.after(b.stop)
  await assert.rejects(b.rt.checkpointBot('b1', {}), { code: 'bot/invalid' })
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 'old' }), { code: 'bot/stale' })
  await assert.rejects(b.rt.checkpointBot('gone', { sessionId: 's1' }), { code: 'bot/not-found' })
  b.calls.readOnly = 'another host'
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/read-only' })
  assert.equal((await b.rt.contextStatus('b1')).canCheckpoint, false)
  delete b.calls.readOnly
  b.agent.status = 'running'
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/busy' })
  b.agent.status = 'idle'; b.agent.inbox.nextTurn.push(text('queued'))
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/busy' })
  const n = bench({ native: true }); t.after(n.stop)
  await assert.rejects(n.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/refused' })
  assert.equal(b.calls.compact, 0)
})

test('reservation rejects duplicate/fresh operations and preserves arriving input at pre-step', async t => {
  const b = bench(); t.after(b.stop)
  b.calls.hold = deferred()
  const pending = b.rt.checkpointBot('b1', { sessionId: 's1' })
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/busy' })
  await assert.rejects(b.rt.startFresh('b1'), { code: 'bot/refused' })
  await assert.rejects(b.compaction.compactNow(b.agent), /makes room on its own/)
  await assert.rejects(b.compaction.compactRegion(0, 1, b.agent), /makes room on its own/)
  const message = { id: 'arrived', ...text('new input'), source: { kind: 'user' } }
  assert.deepEqual(await b.preStep({ agent: b.agent, messages: [message], step: 1 }, () => { throw new Error('must not run') }), { kind: 'reject' })
  b.calls.hold.resolve()
  await pending
  assert.deepEqual(b.agent.inbox.nextTurn.map(message => message.id), ['arrived'])
  assert.equal((await b.rt.contextStatus('b1')).markers.condensing, false)
})

test('real backend persists a checkpoint marker pair and restores the same Session surface', async t => {
  const b = backendBench(); t.after(b.stop)
  b.bot.contextCheckRatio = .6; b.bot.contextRecentTokens = 1
  const result = await b.rt.checkpointBot('b1', { sessionId: 's1' })
  assert.equal(result.context.counts.checkpoints, 1)
  assert.equal(result.context.policy.checkRatio, .6)
  assert.equal(result.context.lines.hard, 94050)
  assert.equal(result.context.lines.check, 59400)
  const events = b.calls.persisted
  assert.equal(events.filter(event => event.type === 'compaction/start').length, 1)
  assert.equal(events.filter(event => event.type === 'compaction/end').length, 1)
  assert.equal(events.filter(event => event.type === 'compaction/summary').length, 1)
  assert.equal(b.calls.streams[0].messages.tag.kind, 'checkpoint')
  assert.equal(b.calls.streams[0].purpose, 'compaction')
  assert.equal(b.calls.streams[0].sessionId, 's1')
  const restored = new Session('s1', events, b.session.header)
  assert.deepEqual(restored.deriveMessages(), b.session.deriveMessages())
  // The tiny per-Bot carry budget retains only the newest incoming message,
  // rather than using the plugin's 16k default.
  const summary = events.find(event => event.type === 'compaction/summary').data.summary[0].text
  assert.match(summary, /latest input/)
  assert.doesNotMatch(summary, /first first|second second/)
})

test('real backend durability failure is not reported as a successful checkpoint', async t => {
  const b = backendBench(); t.after(b.stop)
  b.ctx.sessions.flush = async () => { throw new Error('durability failed') }
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), /durability checkpoint failed/)
  assert.equal(b.calls.renewed, 0)
  assert.equal(b.bot.sessionId, 's1')
  assert.equal((await b.rt.contextStatus('b1')).markers.condensing, false)
})

test('real backend refuses its own busy maintenance boundary without writing a checkpoint', async t => {
  const b = backendBench(); t.after(b.stop)
  b.agent.runMaintenance = () => { throw new Error('already has active maintenance') }
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/busy' })
  assert.equal(b.session.snapshotEvents().some(event => event.type === 'compaction/start'), false)
})

test('real maintenance cancellation closes markers without committing a summary or switching', async t => {
  const b = backendBench(); t.after(b.stop)
  b.ctx.llm.stream = () => (async function* () {
    b.calls.maintenance.abort({ kind: 'user' })
    yield { type: 'text-delta', index: 0, text: 'must not commit' }
  })()
  await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code: 'bot/cancelled' })
  const events = b.session.snapshotEvents()
  assert.equal(events.filter(event => event.type === 'compaction/start').length, 1)
  assert.equal(events.filter(event => event.type === 'compaction/end').length, 1)
  assert.equal(events.some(event => event.type === 'compaction/summary'), false)
  assert.equal(b.bot.sessionId, 's1')
  assert.equal((await b.rt.contextStatus('b1')).canCheckpoint, true)
})

test('read-only/deleted/stale races during real summarization do not commit a checkpoint', async t => {
  for (const [code, mutate] of [
    ['bot/read-only', b => { b.calls.readOnly = 'lock lost' }],
    ['bot/not-found', b => { delete b.rt.state.bots.b1 }],
    ['bot/stale', b => { b.bot.sessionId = 's2' }],
  ]) {
    const b = backendBench(); t.after(b.stop)
    b.ctx.llm.stream = () => (async function* () {
      mutate(b)
      yield { type: 'text-delta', index: 0, text: 'must not commit' }
    })()
    await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }), { code })
    assert.equal(b.session.snapshotEvents().some(event => event.type === 'compaction/summary'), false)
    assert.equal(b.calls.renewed, 0)
  }
})

test('automatic checks honor per-Bot soft policy and label steward/handoff overhead at actual calls', async t => {
  const b = bench(); t.after(b.stop)
  b.rt.eventsBackwards = async function* () {}
  b.ctx.emit('agent/status', { agent: b.agent, status: 'idle' })
  await new Promise(setImmediate)
  assert.equal(b.calls.streams.length, 0, 'below plugin default check line')
  b.bot.contextCheckRatio = .05
  b.agent.whenIdle = async () => {}
  b.agent.runMaintenance = fn => fn(new AbortController().signal)
  const finished = deferred()
  b.rt.save = async () => { if (++b.calls.saved === 2) finished.resolve() }
  b.ctx.llm.stream = options => {
    b.calls.streams.push(options)
    return (async function* () {
      yield { type: 'text-delta', index: 0, text: options.messages.tag.kind === 'steward' ? '{"action":"switch"}' : 'invalid note: no headings' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
  b.ctx.emit('agent/status', { agent: b.agent, status: 'idle' })
  await finished.promise
  assert.deepEqual(b.calls.streams.map(options => options.messages.tag.kind), ['steward', 'handoff', 'handoff'])
  assert.ok(b.calls.streams.every(options => options.sessionId === 's1' && options.purpose === 'compaction'))
  assert.equal(b.bot.sessionId, 's1', 'a failed soft handoff keeps the original conversation')
})

test('plugin disposal cancels a real in-flight checkpoint without committing its summary', async t => {
  const b = backendBench(); t.after(b.stop)
  const entered = deferred(), release = deferred()
  b.ctx.llm.stream = () => (async function* () {
    entered.resolve()
    await release.promise
    yield { type: 'text-delta', index: 0, text: 'must not commit' }
  })()
  const pending = b.rt.checkpointBot('b1', { sessionId: 's1' })
  await entered.promise
  await b.ctx.dispose()
  release.resolve()
  await assert.rejects(pending, { code: 'bot/cancelled' })
  assert.equal(b.session.snapshotEvents().some(event => event.type === 'compaction/summary'), false)
})

test('failure/cancellation release reservation without switching or claiming success', async t => {
  for (const code of ['cancelled', 'failed']) {
    const b = bench(); t.after(b.stop)
    b.calls.failure = Object.assign(new Error('backend failure'), { code })
    await assert.rejects(b.rt.checkpointBot('b1', { sessionId: 's1' }))
    assert.equal(b.bot.sessionId, 's1')
    assert.equal(b.calls.flush, 0)
    assert.equal((await b.rt.contextStatus('b1')).markers.condensing, false)
    delete b.calls.failure
    await b.rt.checkpointBot('b1', { sessionId: 's1' })
  }
})
