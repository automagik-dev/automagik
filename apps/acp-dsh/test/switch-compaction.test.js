// A model switch onto an agent, through DSH's own switch guard. compaction-basic prices every
// switch on the destination's header with `compactPressure`; an agent declares no context
// window, so before this plugin's guard (src/host/pressure.js) the switch failed with
// MODEL_SWITCH_COMPACTION_FAILED before the agent was ever called. These cases run the pinned
// harness's real pieces: cordis, dsh-llm's runtime (resolveModelInfo, prepareCall), the
// compaction-basic engine with its automatic listeners, dsh-session, and the agent loop's own
// prepareRequest (the private loop class, exposed only to this test's module instance). The
// agent route is this plugin's real adapter over the fake ACP agent; the API route is a test
// adapter that declares a context window; the token meter is a test double.
//
// Plan (plano-cli-bots-automagik-v3, E0/E1): cases 1, 2, 5 and 10 hold since A-1. Case 9 is
// written down here and flips with E3 (A-4).
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session } from '@deepseek-ai/dsh-session'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { apply, inject } from '../index.js'
import { AcpAdapter } from '../src/host/adapter.js'
import { PRESSURE_METHOD, pressureGuard } from '../src/host/pressure.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const SWITCH_FAILED = 'MODEL_SWITCH_COMPACTION_FAILED'
const quiet = { warn() {}, info() {}, error() {}, debug() {} }

// An API route that declares its window, as a real provider adapter does. `plain` declares
// none: a native route with no window must still fail the guard (the bypass is for agents).
class ApiAdapter extends LlmAdapter {
  constructor(windows) {
    super()
    this.windows = windows
    this.calls = []
  }

  resolveModel(provider, model) {
    const window = this.windows[model]
    return Promise.resolve({ provider, id: model, name: model, ...(window === undefined ? {} : { context: { contextWindow: window } }) })
  }

  async *stream(options) {
    this.calls.push(options)
    yield { type: 'text-delta', index: 0, text: 'A summary of the earlier messages.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

// The loop class is private to dsh-agent-loop; this appends an export to this test's own
// module instance of it. No installed file is edited.
let loopPrototype
async function loop() {
  if (loopPrototype !== undefined) return loopPrototype
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'switch-compaction-test:agent-loop') {
        const result = next('@deepseek-ai/dsh-agent-loop', context)
        return { ...result, url: `${result.url}?switch-compaction-test` }
      }
      return next(specifier, context)
    },
    load(url, context, next) {
      const result = next(url, context)
      return url.endsWith('?switch-compaction-test') ? { ...result, source: `${result.source}\nexport { ReactLoopAgent as SwitchTestLoop }` } : result
    },
  })
  try {
    loopPrototype = (await import('switch-compaction-test:agent-loop')).SwitchTestLoop.prototype
  } finally {
    hook.deregister()
  }
  return loopPrototype
}

const words = (text, n) => `${text} `.repeat(n)
const header = (provider, model) => ({ reason: 'initial', header: { config: { provider, model } } })

// A meter that prices each surface node at `perNode` tokens, so compaction-basic's real
// range selection and summary pricing run on the real Session surface.
function meterOf(perNode) {
  const meter = {
    perNode,
    measure: (session) => {
      const nodes = session.surface.nodes.map(seq => ({ seq, tokens: meter.perNode, heuristicTokens: meter.perNode }))
      const summaries = session.snapshotEvents().filter(event => event.type === 'compaction/summary').length
      return { totalTokens: Math.max(0, nodes.length * meter.perNode - summaries * meter.perNode * 4), nodes }
    },
    estimateMessage: () => 100,
  }
  return meter
}

async function bench({ perNode = 100, routed = ['api', 'big'], acp = true, messages = 3, events } = {}) {
  const ctx = new Context()
  ctx.provide('logger', quiet)
  ctx.provide('agents', { get: () => undefined, list: () => [] })
  const meter = meterOf(perNode)
  ctx.provide('tokenMeter', meter)
  ctx.provide('sessions', { flush: async () => {} })
  await ctx.plugin(LlmRuntime)
  const api = new ApiAdapter({ big: 1_000_000, small: 100_000 })
  ctx.llm.registerAdapter(['api', 'plain'], api)
  const compaction = ctx.plugin(BasicCompactionEngine, {})
  await compaction
  let plugin
  if (acp) {
    plugin = ctx.plugin({
      name: 'acp-dsh-under-test',
      inject,
      apply: scoped => apply(scoped, { fakeAgent: FAKE, claude: false, codex: false }, {
        store: { binOf: () => undefined, update: async () => {}, dispose() {} },
        find: () => undefined,
      }),
    })
    await plugin
  }
  let session
  if (events === undefined) {
    session = new Session('s1')
    session.append('request/header', header(...routed))
    for (let i = 0; i < messages; i++) {
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: words(`message ${i}`, 20) }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    }
  } else {
    // A reopened conversation: the log as it was saved, read back into a new Session.
    session = Session.create('s1', events)
  }
  // The agent's own scope takes the adapter's mirror tool at agent/created; no step runs here.
  const agent = { id: 's1', session, options: {}, requestHeaderLogged: events === undefined, loopCtx: { llm: ctx.llm }, ctx: { tools: { register: () => () => {} } } }
  agent.dispatch = agentEvents(ctx, agent)
  const proto = await loop()
  const prepare = (provider, model) => proto.prepareRequest.call(agent, 1, 1, { provider, model }, new AbortController().signal)
  // The raw engine: cordis hands out a fresh tracing proxy per get().
  const engine = () => raw(ctx.get('compaction'))
  return { ctx, api, meter, session, agent, prepare, engine, compaction, plugin }
}

const raw = service => service?.[Symbol.for('cordis.original')] ?? service
const created = agent => agent.dispatch.serial('agent/created', {})
const switchFails = promise => assert.rejects(promise, error => error?.code === SWITCH_FAILED)

test('case 1: API -> agent switches without compaction (the guard no longer asks an agent for a window)', async (t) => {
  const b = await bench()
  t.after(() => b.plugin?.dispose())
  await created(b.agent)
  const info = await b.ctx.llm.resolveModelInfo('api', 'big')
  assert.equal(info.context.contextWindow, 1_000_000, 'the API route declares its window')
  assert.equal((await b.ctx.llm.resolveModelInfo('acp-fake', 'default')).context, undefined, 'an agent declares none')
  const { config } = await b.prepare('acp-fake', 'default')
  assert.equal(config.provider, 'acp-fake')
  assert.equal(b.api.calls.length, 0, 'no summary was asked for')
})

test('case 2: agent -> agent (another model of the same agent) switches without compaction', async (t) => {
  const b = await bench({ routed: ['acp-fake', 'default'] })
  t.after(() => b.plugin?.dispose())
  await created(b.agent)
  const { config } = await b.prepare('acp-fake', 'fake-small')
  assert.deepEqual([config.provider, config.model], ['acp-fake', 'fake-small'])
  assert.equal(b.api.calls.length, 0)
})

test('case 5: a reopened conversation (header from the saved log, a fresh loop) switches to an agent', async (t) => {
  const first = await bench({ acp: false })
  const saved = first.session.snapshotEvents()
  const b = await bench({ events: saved })
  t.after(() => b.plugin?.dispose())
  assert.equal(b.session.requestHeader().config.provider, 'api', 'the reopened Session carries its earlier header')
  // No agent/created reaches this plugin for an agent made before it loaded: the request
  // itself adopts the engine.
  const { config } = await b.prepare('acp-fake', 'default')
  assert.equal(config.provider, 'acp-fake')
})

test('case 1 without this plugin reproduces the failure the guard fixes', async () => {
  const b = await bench({ acp: false })
  b.ctx.llm.registerAdapter(['acp-fake'], new ApiAdapter({}))
  await switchFails(b.prepare('acp-fake', 'default'))
})

test('case 10: controls — same route, API -> API, agent -> API below the line, and a native route without a window still fails', async (t) => {
  const b = await bench()
  t.after(() => b.plugin?.dispose())
  await created(b.agent)
  // Same route: the guard does not run.
  assert.equal((await b.prepare('api', 'big')).config.model, 'big')
  // API -> a smaller API model, below its threshold: passes without a summary.
  assert.equal((await b.prepare('api', 'small')).config.model, 'small')
  assert.equal(b.api.calls.length, 0)
  // A native destination without a window is not an agent: the guard still refuses it.
  await switchFails(b.prepare('plain', 'none'))

  const back = await bench({ routed: ['acp-fake', 'default'] })
  t.after(() => back.plugin?.dispose())
  await created(back.agent)
  assert.equal((await back.prepare('api', 'small')).config.model, 'small', 'agent -> API below the destination threshold passes')
})

test('case 10: API -> a smaller API model above its threshold still compacts through the real engine', async (t) => {
  // 100k window, 65,536 headroom: threshold ~34k. 3 messages x 20k tokens are over it.
  const b = await bench({ perNode: 20_000 })
  t.after(() => b.plugin?.dispose())
  await created(b.agent)
  // Automatic compaction runs inside a turn, as prepareRequest does.
  b.session.append('turn/start', { turn: 1 })
  const { config } = await b.prepare('api', 'small')
  assert.equal(config.model, 'small')
  assert.equal(b.api.calls.length, 1, 'one summary was written by the native engine')
  assert.equal(b.session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 1)
})

test('an agent destination answers no pressure at step boundaries either (no "no context capacity" warning)', async (t) => {
  const b = await bench({ routed: ['acp-fake', 'default'] })
  t.after(() => b.plugin?.dispose())
  await created(b.agent)
  assert.equal(await b.engine().compactIfNeeded(b.agent, 'pressure', new AbortController().signal), null)
})

test('a recreated compaction engine is adopted on the next request, without a new agent/created', async (t) => {
  const b = await bench()
  t.after(() => b.plugin?.dispose())
  await created(b.agent)
  const before = b.engine()
  assert.equal(Object.hasOwn(before, PRESSURE_METHOD), true, 'adopted at agent/created')
  await b.compaction.dispose()
  const again = b.ctx.plugin(BasicCompactionEngine, {})
  await again
  t.after(() => again.dispose())
  const after = b.engine()
  assert.notEqual(after, before)
  assert.equal(Object.hasOwn(after, PRESSURE_METHOD), false)
  const { config } = await b.prepare('acp-fake', 'default')
  assert.equal(config.provider, 'acp-fake')
  assert.equal(Object.hasOwn(after, PRESSURE_METHOD), true, 'adopted on agent/request')
})

test('disposing the plugin unwinds its wrapper from the real engine, and the switch fails as before', async () => {
  const b = await bench()
  await created(b.agent)
  const engine = b.engine()
  assert.equal(Object.hasOwn(engine, PRESSURE_METHOD), true)
  await b.plugin.dispose()
  assert.equal(Object.hasOwn(engine, PRESSURE_METHOD), false)
  assert.equal(engine[PRESSURE_METHOD], BasicCompactionEngine.prototype[PRESSURE_METHOD])
  b.ctx.llm.registerAdapter(['acp-fake'], new ApiAdapter({}))
  await switchFails(b.prepare('acp-fake', 'default'))
})

// The method this plugin wraps is private to compaction-basic. If an upgrade renames it,
// changes its arguments, or stops calling it through `this` for a switch, this fails first.
test('guard: compaction-basic still prices a switch through this.compactPressure(agent, header, signal, true)', () => {
  const proto = BasicCompactionEngine.prototype
  assert.equal(typeof proto[PRESSURE_METHOD], 'function')
  assert.equal(proto[PRESSURE_METHOD].length, 4)
  assert.match(proto._registerAutomaticCompaction.toString(), /this\.compactPressure\(agent, header, signal, true\)/)
  assert.match(proto._registerAutomaticCompaction.toString(), /"agent\/request"[\s\S]*prepend: true/)
  assert.match(proto.compactIfNeeded.toString(), /this\.compactPressure\(agent, header, signal, false\)/)
  assert.match(proto[PRESSURE_METHOD].toString(), /const target = header\.config/)
})

// The wrapper's own contract, on a plain engine with a prototype method.
function plainEngine() {
  const calls = []
  class Engine {
    compactPressure(agent, header) {
      calls.push(`native ${header.config.provider}`)
      return Promise.resolve('native')
    }
  }
  return { engine: new Engine(), calls, Engine }
}
const agentRoute = provider => String(provider).startsWith('acp-')
const call = (engine, provider) => engine.compactPressure({}, { config: { provider, model: 'm' } }, undefined, true)

function outside(engine, calls, name) {
  const below = engine.compactPressure
  const own = Object.hasOwn(engine, 'compactPressure')
  engine.compactPressure = function other(...args) {
    calls.push(name)
    return below.apply(this, args)
  }
  return () => {
    if (own) engine.compactPressure = below
    else delete engine.compactPressure
  }
}

test('wrapper: agent destinations answer null, the rest delegates to the method below at call time', async () => {
  const { engine, calls, Engine } = plainEngine()
  const guard = pressureGuard({ agentDestination: agentRoute })
  assert.equal(guard.adopt(engine), true)
  assert.equal(guard.adopt(engine), false, 'once per engine')
  assert.equal(await call(engine, 'acp-claude'), null)
  assert.equal(await call(engine, 'deepseek'), 'native')
  // A replaced prototype method is read at the call, not at adoption.
  Engine.prototype.compactPressure = () => Promise.resolve('replaced')
  assert.equal(await call(engine, 'deepseek'), 'replaced')
  assert.deepEqual(calls, ['native deepseek'])
  guard.dispose()
  assert.equal(Object.hasOwn(engine, 'compactPressure'), false)
  assert.equal(guard.adopt(engine), false, 'a disposed guard adopts nothing')
})

test('wrapper: composes over an earlier wrapper and unwinds to it', async () => {
  const { engine, calls } = plainEngine()
  const remove = outside(engine, calls, 'earlier')
  const earlier = engine.compactPressure
  const guard = pressureGuard({ agentDestination: agentRoute })
  guard.adopt(engine)
  assert.equal(await call(engine, 'acp-codex'), null)
  assert.equal(await call(engine, 'deepseek'), 'native')
  assert.deepEqual(calls, ['earlier', 'native deepseek'])
  guard.dispose()
  assert.equal(engine.compactPressure, earlier, 'on top: unwinds to the wrapper below')
  remove()
  assert.equal(Object.hasOwn(engine, 'compactPressure'), false)
})

test('wrapper: a later wrapper above it keeps working when this one is disposed first (inert, not removed)', async () => {
  const { engine, calls } = plainEngine()
  const guard = pressureGuard({ agentDestination: agentRoute })
  guard.adopt(engine)
  const remove = outside(engine, calls, 'later')
  guard.dispose()
  assert.equal(Object.hasOwn(engine, 'compactPressure'), true, 'not on top: stays in place')
  // Inert: an agent destination now reaches the native method, through the later wrapper.
  assert.equal(await call(engine, 'acp-codex'), 'native')
  assert.deepEqual(calls, ['later', 'native acp-codex'])
  remove()
  assert.equal(await call(engine, 'deepseek'), 'native', 'the inert wrapper passes calls down')
  // A new guard (a reloaded plugin) adopts the engine again over the inert one.
  const next = pressureGuard({ agentDestination: agentRoute })
  assert.equal(next.adopt(engine), true)
  assert.equal(await call(engine, 'acp-codex'), null)
  next.dispose()
})

test('wrapper: the other way round, the later wrapper unwinds first and this one is still on top after', async () => {
  const { engine, calls } = plainEngine()
  const guard = pressureGuard({ agentDestination: agentRoute })
  guard.adopt(engine)
  const remove = outside(engine, calls, 'later')
  remove()
  assert.equal(await call(engine, 'acp-codex'), null)
  guard.dispose()
  assert.equal(Object.hasOwn(engine, 'compactPressure'), false)
  assert.deepEqual(calls, [])
})

test('wrapper: an engine without the method, or a non-object, is left alone', () => {
  const guard = pressureGuard({ agentDestination: agentRoute })
  assert.equal(guard.adopt(undefined), false)
  assert.equal(guard.adopt({}), false)
  assert.equal(guard.adopt(Object.freeze({ compactPressure() {} })), false)
})

// Case 9 (E3, A-4): the row the new route writes before its first answer must not claim an
// answer: the call can still fail after the header is logged.
test('case 9: the boundary row written before the agent answers does not claim an answer', () => {
  const rows = []
  const adapter = new AcpAdapter({ on() {}, logger: quiet }, new Map(), { dshTools: () => false })
  adapter.appendBoundary({ session: { append: (type, message) => rows.push(message) } }, { name: 'Fake agent' }, 'acp-fake')
  const text = rows[0].content[0].text
  assert.doesNotMatch(text, /answered/i)
  assert.equal(text, '[Switching to Fake agent (acp-fake).]')
  assert.equal(rows[0].source.summary, 'Switching to Fake agent (acp-fake)')
  // The row back to a native provider, written at the model selection, claims none either.
  const back = []
  const session = { id: 's1', append: (type, message) => back.push(message) }
  adapter.live.set('s1', { provider: 'acp-fake', run: { dispose() {} } })
  adapter.bridgeOn = () => true
  adapter.noteEvent(session, { type: 'model/selection', data: { provider: 'deepseek-official' } })
  assert.equal(back[0].content[0].text, '[Switching to DSH.]')
})

// #871 (L6): compactPressure is compaction-basic's private method, so a DSH update can remove
// it. An engine this plugin cannot guard is reported, once per engine, never passed over.
test('wrapper: an engine that cannot be guarded is reported once, a guarded one and a non-object never', () => {
  const said = []
  const guard = pressureGuard({ agentDestination: agentRoute, onUnguarded: reason => said.push(reason) })
  assert.equal(guard.adopt(undefined), false)
  assert.equal(guard.adopt(null), false)
  assert.equal(guard.adopt('compaction'), false)
  assert.deepEqual(said, [], 'nothing to guard is not a missing method')
  const { engine } = plainEngine()
  assert.equal(guard.adopt(engine), true)
  assert.equal(guard.adopt(engine), false)
  assert.deepEqual(said, [], 'a guarded engine is not reported')
  const gone = {}
  assert.equal(guard.adopt(gone), false)
  assert.equal(guard.adopt(gone), false)
  assert.deepEqual(said, ['missing'], 'once per engine')
  assert.equal(guard.adopt({ compactPressure: 'not a function' }), false)
  assert.deepEqual(said, ['missing', 'missing'])
  const frozen = Object.freeze({ compactPressure() {} })
  assert.equal(guard.adopt(frozen), false)
  assert.equal(guard.adopt(frozen), false)
  assert.deepEqual(said, ['missing', 'missing', 'locked'])
  // A callback that throws never breaks the request that adopted.
  const loud = pressureGuard({ agentDestination: agentRoute, onUnguarded: () => { throw new Error('logger down') } })
  assert.equal(loud.adopt({}), false)
  // Without a callback the answer is as before.
  assert.equal(pressureGuard({ agentDestination: agentRoute }).adopt({}), false)
  guard.dispose()
})

test('a DSH whose compaction engine lost the method: the plugin warns once and the switch fails as without it', async (t) => {
  const b = await bench()
  t.after(() => b.plugin?.dispose())
  // What an update that removed the private method leaves: nothing callable under its name.
  const engine = b.engine()
  engine[PRESSURE_METHOD] = undefined
  await created(b.agent)
  await created(b.agent)
  await switchFails(b.prepare('acp-fake', 'default'))
  // The context's own logger keeps what plugins log.
  const said = b.ctx.logger.buffer.filter(record => record.type === 'warn').map(record => record.args.join(' ')).filter(line => line.includes(PRESSURE_METHOD))
  assert.equal(said.length, 1, 'once, not on every request')
  assert.match(said[0], /^acp-dsh: the compaction engine has no compactPressure: /)
  assert.equal(engine[PRESSURE_METHOD], undefined, 'nothing was installed in its place')
})
