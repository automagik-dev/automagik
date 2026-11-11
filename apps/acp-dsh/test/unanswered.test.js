// #968: an agent that stops answering must not hold the chat. Every request the app sends
// before a prompt (initialize, session/new, a model or effort, a mode, a fork, a close) has a
// deadline and ends with the person's Stop, and an agent that ignores `session/cancel` is ended
// on the app's side, so the next message gets a new session with the chat replayed to it.
//
// The fake agent runs over real stdio and is made deaf to one ACP method at a time
// (FAKE_ACP_DEAF_TO): it logs each request it did not hear, so a test knows the request is out
// before it moves the clock. The deadlines are the real ones (60 s, 15 s, 5 s) on a clock each
// adapter is given (`timers`) and the test moves by hand: no test waits a deadline out, and no
// test's clock is another's. Everything else (the processes, the bridge) runs on real time.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session } from '@deepseek-ai/dsh-session'
import { AgentRun, KILL_AFTER_MS, REQUEST_MS, START_MS, isStopped, isUnanswered, waited } from '../src/host/acp.js'
import { AcpAdapter, CANCEL_WAIT_MS, unansweredText } from '../src/host/adapter.js'
import { Backchannel } from '../src/host/backchannel.js'
import { TOOL_NAME } from '../src/host/tool.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const ROUTE = 'acp-fake'

// What a test waits on is the agent's process (a request on the wire, an exit), never a deadline.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, what, ms = 20_000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(5)
  }
}

// A clock that only `tick` moves: the `timers` an adapter and its agent runs keep their
// deadlines on. Timers due at the new time fire in the order they were due.
function handClock() {
  let now = 0
  let made = 0
  const waiting = new Map()
  return {
    setTimeout(fn, ms) {
      const timer = { id: ++made, at: now + ms, fn, unref: () => timer }
      waiting.set(timer.id, timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer !== undefined) waiting.delete(timer.id)
    },
    tick(ms) {
      now += ms
      const due = [...waiting.values()].filter(timer => timer.at <= now).sort((a, b) => a.at - b.at || a.id - b.id)
      for (const timer of due) {
        if (waiting.delete(timer.id)) timer.fn()
      }
    },
  }
}

const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const answer = text => ({ role: 'assistant', source: { kind: 'model', provider: ROUTE, model: 'default' }, content: [{ type: 'text', text }] })
const textIn = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
const STOPPED = { kind: 'aborted', failure: { message: 'Stopped', code: 'ABORTED' } }

/**
 * One DSH Session on the fake agent. `deaf` is the ACP methods it never hears; `h.env` is read
 * at each spawn, so a test can let the next process hear again. With `toolsOn` unset the agent
 * keeps its own tools and the chat is replayed to a new session (Codex's default); `true`
 * gives it the DSH bridge. `h.tick(ms)` moves its clock; `realClock` leaves the deadlines on
 * real time, for a test that sets short ones.
 */
function fixture(t, { deaf, toolsOn, spec: extra = {}, cancelWaitMs, realClock = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acp-dsh-unanswered-'))
  const trace = join(dir, 'trace.ndjson')
  const env = { FAKE_ACP_TRACE: trace, ...(deaf === undefined ? {} : { FAKE_ACP_DEAF_TO: deaf }) }
  const session = Session.create('s1')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 0 })
  const tools = new Map()
  const warnings = []
  const definitions = [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } }]
  const agent = { session, ctx: { tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } } } }
  const ctx = {
    agents: { get: () => agent, turnBoundaryOf: () => ({ lastTurn: 1 }) },
    get: (key) => {
      if (key === 'tools') return { definitions: () => definitions, executable: name => definitions.find(definition => definition.name === name), execute: async () => ({ results: [] }) }
      if (key === 'approval') return { effectivePolicy: () => 'ask', request: async () => 'allowed-once' }
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (key === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
    logger: { warn: message => warnings.push(message), info: () => {} },
  }
  const catalog = { models: async () => [{ id: 'default', name: 'Fake agent' }], model: async () => undefined, ownEffort: () => undefined, dispose() {} }
  const spec = { name: 'Fake agent', catalog, installed: () => true, spawn: () => ({ command: process.execPath, args: [FAKE], env: { ...env } }), ...extra }
  const backchannel = new Backchannel({ ctx })
  const clock = handClock()
  const adapter = new AcpAdapter(ctx, new Map([[ROUTE, spec]]), { dshTools: () => toolsOn, backchannel, ...(cancelWaitMs === undefined ? {} : { cancelWaitMs }), ...(realClock ? {} : { timers: clock }) })
  const events = () => (existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
  // The trace is read before the folder goes, for a failure that reports after the close.
  let closed
  const close = () => {
    closed ??= events()
    adapter.dispose()
    backchannel.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
  // A test that fails or times out still ends its agent processes: nothing outlives the file.
  t.after(close)
  return {
    adapter, agent, backchannel, definitions, env, spec, tools, warnings,
    tick: ms => clock.tick(ms),
    live: () => adapter.live.get('s1'),
    // The requests the agent got and never answered, in order.
    unheard: () => events().filter(event => event.event === 'unheard').map(event => event.method),
    // What each prompt carried, and how many agent sessions were opened.
    prompts: () => events().filter(event => event.event === 'prompt').map(event => event.text),
    sessions: () => events().filter(event => event.event === 'new-session').length,
    // The processes the agents started themselves (FAKE_ACP_CHILD), once each one runs.
    children: () => events().filter(event => event.event === 'child').map(event => event.child),
    close,
  }
}

// A wait on the adapter that the real clock bounds: one that never ends fails by name, with
// what the turn had streamed, instead of hanging the test.
async function within(promise, what, ms = 20_000) {
  let timer
  const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`still waiting for ${what()}`)), ms) })
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

async function step(h, messages, { signal, onChunk, model = 'default' } = {}) {
  const chunks = []
  const said = messages.at(-1).content[0].text
  await within((async () => {
    for await (const chunk of h.adapter.stream(markAgentLoopRequest({ provider: ROUTE, model, sessionId: 's1', messages, signal }))) {
      chunks.push(chunk)
      onChunk?.(chunks)
    }
  })(), () => `the turn on "${said}" to end; so far ${JSON.stringify(chunks.map(chunk => chunk.type))}, unheard ${JSON.stringify(h.unheard())}`)
  return chunks
}

// One turn that ends by itself, logged the way DSH logs it.
async function turn(h, messages, text) {
  messages.push(user(text))
  const chunks = await step(h, messages)
  assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1).reason))
  messages.push(answer(textIn(chunks)))
  return chunks
}

// A turn on "hang" (the agent waits to be cancelled), stopped once the agent has spoken.
async function stoppedTurn(h, messages) {
  const controller = new AbortController()
  messages.push(user('hang'))
  const chunks = await step(h, messages, {
    signal: controller.signal,
    onChunk: seen => { if (!controller.signal.aborted && /you said "hang"/.test(textIn(seen))) controller.abort() },
  })
  messages.push(answer(textIn(chunks)))
  return chunks
}

// The same turn left without a Stop: DSH drops the stream, and the agent's prompt stays open.
async function droppedTurn(h, messages) {
  messages.push(user('hang'))
  const seen = []
  await within((async () => {
    for await (const chunk of h.adapter.stream(markAgentLoopRequest({ provider: ROUTE, model: 'default', sessionId: 's1', messages }))) {
      seen.push(chunk)
      if (/you said "hang"/.test(textIn(seen))) break
    }
  })(), () => `the agent to speak; so far ${JSON.stringify(textIn(seen))}`)
  messages.push(answer(textIn(seen)))
}

const gone = run => until(() => run.exited !== undefined, 'the agent process to exit')
// Whether the adapter has asked `run` to stop again. Once it has, its own wait for the prompt
// is armed: a test must not move the clock before that.
function askedAgain(run) {
  let asked = false
  const cancel = run.cancel.bind(run)
  run.cancel = async () => {
    await cancel()
    asked = true
  }
  return () => asked
}
// Whether a process is still running. One that ended and waits for its parent to collect it
// still takes a signal, so Linux is asked for its state too.
function running(pid) {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== 'linux') return true
  try {
    return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return false
  }
}
const ended = (pid, what) => until(() => !running(pid), `${what} to end`)
// Whether a promise is still pending after the event loop had time to settle it.
async function pending(promise) {
  let settled = false
  promise.then(() => { settled = true }, () => { settled = true })
  await sleep(25)
  return !settled
}

test('the deadlines are 60 s to start, 15 s for a request before a prompt, 5 s to stop', () => {
  assert.deepEqual([START_MS, REQUEST_MS, CANCEL_WAIT_MS], [60_000, 15_000, 5000])
  assert.equal(waited(START_MS), '60 s')
  assert.equal(
    unansweredText('Claude Code', 'starting', START_MS),
    'Claude Code did not answer while starting (60 s). Open it once in a terminal to check it is not waiting for you, then send again.',
  )
})

// --- the start ------------------------------------------------------------------------------

for (const method of ['initialize', 'session/new']) {
  test(`an agent that never answers ${method} fails the turn at the start deadline and says where to look`, async (t) => {
    const h = fixture(t, { deaf: method })
    try {
      const running = step(h, [user('plain')])
      await until(() => h.unheard().includes(method), `${method} to reach the agent`)
      const run = h.live().run
      h.tick(START_MS - 1)
      assert.ok(await pending(running), 'the turn still waits one millisecond before the deadline')
      h.tick(1)
      const reason = (await running).at(-1).reason
      assert.equal(reason.kind, 'error')
      assert.equal(reason.failure.message, 'Fake agent did not answer while starting (60 s). Open it once in a terminal to check it is not waiting for you, then send again.')
      // Nothing of the session is left: no live entry, no held event loop, no process.
      assert.equal(h.adapter.live.size, 0)
      assert.equal(run.alive, false)
      assert.equal(run.hold, undefined)
      await gone(run)
      // The log names the request nobody answered.
      assert.ok(h.warnings.some(line => line.includes(`did not answer ${method} within 60 s`)), h.warnings.join('\n'))
      // Once the CLI answers again, the next message starts a session as usual.
      delete h.env.FAKE_ACP_DEAF_TO
      assert.match(textIn(await turn(h, [], 'plain')), /turn 1: you said "plain"/)
    } finally {
      h.close()
    }
  })

  test(`Stop while the agent does not answer ${method} ends the turn as stopped and the process with it`, async (t) => {
    const h = fixture(t, { deaf: method })
    try {
      const controller = new AbortController()
      const running = step(h, [user('plain')], { signal: controller.signal })
      await until(() => h.unheard().includes(method), `${method} to reach the agent`)
      const run = h.live().run
      controller.abort()
      assert.deepEqual((await running).at(-1).reason, STOPPED)
      assert.equal(h.adapter.live.size, 0)
      assert.equal(run.hold, undefined)
      await gone(run)
      delete h.env.FAKE_ACP_DEAF_TO
      assert.match(textIn(await turn(h, [], 'plain')), /turn 1: you said "plain"/)
    } finally {
      h.close()
    }
  })
}

test('with the DSH bridge and a deadline of its own, a start nobody answers leaves no bridge credential behind', async (t) => {
  const h = fixture(t, { deaf: 'session/new', toolsOn: true, spec: { startMs: 150 }, realClock: true })
  try {
    const reason = (await step(h, [user('plain')])).at(-1).reason
    assert.equal(reason.failure.message, 'Fake agent did not answer while starting (150 ms). Open it once in a terminal to check it is not waiting for you, then send again.')
    assert.equal(h.adapter.live.size, 0)
    assert.equal(h.backchannel.records.size, 0)
  } finally {
    h.close()
  }
})

// --- the requests before a prompt -------------------------------------------------------------

// A session that is open, and a second turn whose first request before the prompt is `method`.
const BEFORE_PROMPT = {
  // The fake starts at medium effort; a turn with no effort sets it back to its default row.
  'session/set_config_option': {
    doing: 'taking default',
    ready: async () => {},
  },
  // The fake offers no modes of its own: the run is told it has some, as a real agent says.
  'session/set_mode': {
    doing: 'taking DSH\'s permission level',
    ready: async (h, messages) => {
      await turn(h, messages, 'plain')
      h.live().run.modes = { availableModes: [{ id: 'loose' }, { id: 'strict' }], currentModeId: 'loose' }
      h.spec.modeFor = () => 'strict'
    },
  },
}

for (const [method, { doing, ready }] of Object.entries(BEFORE_PROMPT)) {
  test(`an agent that never answers ${method} fails the turn at the request deadline and ends its session`, async (t) => {
    const h = fixture(t, { deaf: method })
    try {
      const messages = []
      await ready(h, messages)
      const running = step(h, [...messages, user('plain')])
      await until(() => h.unheard().includes(method), `${method} to reach the agent`)
      const run = h.live().run
      h.tick(REQUEST_MS - 1)
      assert.ok(await pending(running), 'the turn still waits one millisecond before the deadline')
      h.tick(1)
      const reason = (await running).at(-1).reason
      assert.equal(reason.kind, 'error')
      assert.equal(reason.failure.message, `Fake agent did not answer while ${doing} (15 s), so its session was ended. Send again to start a new one.`)
      assert.equal(h.adapter.live.size, 0)
      assert.equal(run.hold, undefined)
      await gone(run)
      // "Send again" is true: the next message gets a new session (its own first turn).
      delete h.env.FAKE_ACP_DEAF_TO
      delete h.spec.modeFor
      assert.match(textIn(await turn(h, messages, 'plain')), /turn 1: you said/)
      assert.equal(h.sessions(), 2)
    } finally {
      h.close()
    }
  })

  test(`Stop while the agent does not answer ${method} ends the turn as stopped and its session`, async (t) => {
    const h = fixture(t, { deaf: method })
    try {
      const messages = []
      await ready(h, messages)
      const controller = new AbortController()
      const running = step(h, [...messages, user('plain')], { signal: controller.signal })
      await until(() => h.unheard().includes(method), `${method} to reach the agent`)
      const run = h.live().run
      controller.abort()
      assert.deepEqual((await running).at(-1).reason, STOPPED)
      assert.equal(h.adapter.live.size, 0)
      await gone(run)
    } finally {
      h.close()
    }
  })
}

// An agent whose models are its session's own list (a native agent, as Hermes: #959) is switched
// with `session/set_model`. That request has the same deadline and the same Stop as the others:
// its error must reach the turn as it is, not wrapped as "it could not switch to <model>".
const HAS_GROUPS = process.platform !== 'win32'
function ownModels(t) {
  const h = fixture(t, { deaf: 'session/set_model' })
  h.env.FAKE_ACP_SESSION_MODELS = '1'
  if (HAS_GROUPS) h.env.FAKE_ACP_CHILD = 'stubborn'
  return h
}
const reachedSetModel = h => until(() => h.unheard().includes('session/set_model') && (!HAS_GROUPS || h.children().length === 1), 'session/set_model to reach the agent, with its child running')

test('an agent that never answers session/set_model fails the turn at the request deadline and ends its session and what it started', async (t) => {
  const h = ownModels(t)
  try {
    const going = step(h, [user('plain')], { model: 'fake-small' })
    await reachedSetModel(h)
    const run = h.live().run
    const [child] = h.children()
    h.tick(REQUEST_MS - 1)
    assert.ok(await pending(going), 'the turn still waits one millisecond before the deadline')
    h.tick(1)
    const reason = (await going).at(-1).reason
    assert.equal(reason.kind, 'error')
    assert.equal(reason.failure.message, unansweredText('Fake agent', 'taking fake-small', REQUEST_MS))
    assert.equal(reason.failure.message, 'Fake agent did not answer while taking fake-small (15 s), so its session was ended. Send again to start a new one.')
    assert.equal(h.adapter.live.size, 0)
    assert.equal(run.hold, undefined)
    assert.deepEqual(h.warnings.filter(message => /did not answer/.test(message)), ['acp-dsh: Fake agent did not answer while taking fake-small within 15 s: its session was ended'])
    await gone(run)
    if (HAS_GROUPS) {
      h.tick(KILL_AFTER_MS - 1)
      assert.ok(running(child), 'the child that ignores SIGTERM has the agent\'s time to end')
      h.tick(1)
      await ended(child, 'the child that ignored SIGTERM')
    }
    assert.deepEqual(h.prompts(), [], 'no prompt reached an agent that did not take the model')
  } finally {
    h.close()
  }
})

test('Stop while the agent does not answer session/set_model ends the turn as stopped, its session and what it started', async (t) => {
  const h = ownModels(t)
  try {
    const controller = new AbortController()
    const going = step(h, [user('plain')], { signal: controller.signal, model: 'fake-small' })
    await reachedSetModel(h)
    const run = h.live().run
    const [child] = h.children()
    controller.abort()
    assert.deepEqual((await going).at(-1).reason, STOPPED)
    assert.equal(h.adapter.live.size, 0)
    await gone(run)
    if (HAS_GROUPS) {
      h.tick(KILL_AFTER_MS)
      await ended(child, 'the child that ignored SIGTERM')
    }
  } finally {
    h.close()
  }
})

// A changed tool set on an agent that refreshes by fork (acp-codex): the fork is the request.
async function forking(h) {
  const messages = []
  await turn(h, messages, 'plain')
  h.definitions.push({ name: 'extra', description: 'Extra', parameters: { type: 'object', properties: {} } })
  return messages
}

test('a fork the agent never answers fails the turn at the request deadline, with no bridge left', async (t) => {
  const h = fixture(t, { deaf: 'session/fork', toolsOn: true, spec: { refresh: 'fork' } })
  try {
    const messages = await forking(h)
    const run = h.live().run
    const running = step(h, [...messages, user('plain')])
    await until(() => h.unheard().includes('session/fork'), 'session/fork to reach the agent')
    h.tick(REQUEST_MS - 1)
    assert.ok(await pending(running), 'the turn still waits one millisecond before the deadline')
    h.tick(1)
    const reason = (await running).at(-1).reason
    assert.equal(reason.kind, 'error')
    assert.equal(reason.failure.message, 'Fake agent did not answer while refreshing its DSH tools (15 s), so its session was ended. Send again to start a new one.')
    assert.equal(h.adapter.live.size, 0)
    assert.equal(h.backchannel.records.size, 0)
    await gone(run)
  } finally {
    h.close()
  }
})

test('Stop while the agent does not answer a fork ends the turn as stopped, with no bridge left', async (t) => {
  const h = fixture(t, { deaf: 'session/fork', toolsOn: true, spec: { refresh: 'fork' } })
  try {
    const messages = await forking(h)
    const run = h.live().run
    const controller = new AbortController()
    const running = step(h, [...messages, user('plain')], { signal: controller.signal })
    await until(() => h.unheard().includes('session/fork'), 'session/fork to reach the agent')
    controller.abort()
    assert.deepEqual((await running).at(-1).reason, STOPPED)
    assert.equal(h.adapter.live.size, 0)
    assert.equal(h.backchannel.records.size, 0)
    await gone(run)
  } finally {
    h.close()
  }
})

test('a fork whose source session never closes goes on after the close deadline', async () => {
  // A run with no process: the fork answers at once and the close never does.
  const h = handClock()
  const run = new AgentRun({ command: 'unused', cwd: tmpdir(), name: 'Stub agent', timers: h })
  let closing = false
  run.conn = { forkSession: async () => ({ sessionId: 'forked' }), closeSession: () => { closing = true; return new Promise(() => {}) } }
  run.sessionId = 'source'
  const forked = run.fork({ cwd: tmpdir(), mcpServers: [] })
  await until(() => closing, 'the close request')
  h.tick(REQUEST_MS - 1)
  assert.ok(await pending(forked))
  h.tick(1)
  assert.equal(await forked, 'forked')
  assert.equal(run.hold, undefined)
})

test('a request stopped before it is sent is never sent', async () => {
  const run = new AgentRun({ command: 'unused', cwd: tmpdir(), name: 'Stub agent' })
  const controller = new AbortController()
  controller.abort()
  let sent = false
  await assert.rejects(run.held(async () => { sent = true }, { signal: controller.signal }), isStopped)
  assert.equal(sent, false)
  // A deadline is the other early end, and neither is mistaken for the other.
  const late = await run.held(() => new Promise(() => {}), { ms: 5, what: 'testing' }).catch(error => error)
  assert.ok(isUnanswered(late) && !isStopped(late))
  assert.deepEqual([late.ms, late.message], [5, 'it did not answer while testing (5 ms)'])
  assert.equal(run.hold, undefined)
})

// --- a cancel the agent ignores ---------------------------------------------------------------

test('a Stop the agent ignores ends its session within the cancel wait, and the next message gets a new one with the chat', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  try {
    const messages = []
    await turn(h, messages, 'plain one')
    // The turn ends for the person at once, whatever the agent does with the cancel.
    assert.deepEqual((await stoppedTurn(h, messages)).at(-1).reason, STOPPED)
    await until(() => h.unheard().includes('session/cancel'), 'session/cancel to reach the agent')
    const live = h.live()
    const run = live.run
    assert.ok(run.busy, 'the agent is still on the prompt it was asked to stop')
    h.tick(CANCEL_WAIT_MS - 1)
    assert.equal(h.live(), live)
    h.tick(1)
    assert.equal(h.adapter.live.size, 0)
    assert.equal(run.alive, false)
    await gone(run)
    assert.ok(h.warnings.some(line => /did not stop its answer within 5 s/.test(line)), h.warnings.join('\n'))
    // The chat is usable with no restart: a new session, told what was said before it.
    const next = await turn(h, messages, 'plain three')
    assert.match(textIn(next), /turn 1: you said/)
    assert.equal(h.sessions(), 2)
    const sent = h.prompts().at(-1)
    assert.match(sent, /The chat so far, before this new Fake agent session:/)
    assert.match(sent, /plain one/)
    assert.match(sent, /you said "hang"/)
    assert.match(sent, /plain three$/)
  } finally {
    h.close()
  }
})

test('a message sent right after a Stop the agent ignores is answered in that turn, by a new session with the chat', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  try {
    const messages = []
    await turn(h, messages, 'plain one')
    await stoppedTurn(h, messages)
    const wedged = h.live().run
    messages.push(user('plain three'))
    const running = step(h, messages)
    // The new turn asks again before it gives up on the old prompt.
    await until(() => h.unheard().filter(method => method === 'session/cancel').length === 2, 'the second session/cancel')
    assert.ok(await pending(running))
    h.tick(CANCEL_WAIT_MS)
    const chunks = await running
    assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1).reason))
    assert.match(textIn(chunks), /turn 1: you said/)
    assert.notEqual(h.live().run, wedged)
    await gone(wedged)
    assert.match(h.prompts().at(-1), /The chat so far, before this new Fake agent session:[^]*plain one[^]*plain three$/)
  } finally {
    h.close()
  }
})

test('a prompt left open by a turn that ended without Stop is given the cancel wait, then replaced in the same turn', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  try {
    const messages = []
    await turn(h, messages, 'plain one')
    await droppedTurn(h, messages)
    const wedged = h.live().run
    assert.ok(wedged.busy)
    const asked = askedAgain(wedged)
    messages.push(user('plain three'))
    const running = step(h, messages)
    await until(asked, 'the new turn to ask the agent to stop')
    h.tick(CANCEL_WAIT_MS - 1)
    assert.ok(await pending(running), 'the old prompt has the whole wait to end')
    assert.ok(wedged.alive)
    h.tick(1)
    const chunks = await running
    assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1).reason))
    assert.match(textIn(chunks), /turn 1: you said/)
    messages.push(answer(textIn(chunks)))
    await gone(wedged)
    assert.deepEqual(h.unheard(), ['session/cancel'])
    assert.equal(h.sessions(), 2)
    assert.match(h.prompts().at(-1), /The chat so far, before this new Fake agent session:[^]*plain one[^]*plain three$/)
    assert.ok(h.warnings.some(line => /did not stop its last answer within 5 s: a new session replaces it/.test(line)), h.warnings.join('\n'))
    // And the turn after that is an ordinary one on the new session.
    assert.match(textIn(await turn(h, messages, 'plain four')), /turn 2: you said "plain four"/)
  } finally {
    h.close()
  }
})

test('Stop while a new turn waits on the old prompt ends that turn at once, and the old session still ends in time', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  try {
    const messages = []
    await droppedTurn(h, messages)
    const wedged = h.live().run
    const controller = new AbortController()
    const running = step(h, [...messages, user('plain')], { signal: controller.signal })
    await until(() => h.unheard().includes('session/cancel'), 'session/cancel to reach the agent')
    controller.abort()
    assert.deepEqual((await running).at(-1).reason, STOPPED)
    assert.ok(wedged.alive, 'the wait is not over yet')
    h.tick(CANCEL_WAIT_MS)
    assert.equal(h.adapter.live.size, 0)
    await gone(wedged)
  } finally {
    h.close()
  }
})

test('an agent that takes the cancel keeps its session: the wait ends nothing', async (t) => {
  const h = fixture(t)
  try {
    const messages = []
    assert.deepEqual((await stoppedTurn(h, messages)).at(-1).reason, STOPPED)
    const live = h.live()
    await until(() => !live.run.busy, 'the cancelled prompt to end')
    h.tick(CANCEL_WAIT_MS * 2)
    assert.equal(h.live(), live)
    assert.ok(live.run.alive)
    assert.match(textIn(await turn(h, messages, 'plain')), /turn 2: you said "plain"/)
    assert.equal(h.sessions(), 1)
    assert.deepEqual(h.warnings, [])
  } finally {
    h.close()
  }
})

test('a stopped tool call starts the same wait, and an agent that takes it keeps its session', async (t) => {
  const h = fixture(t)
  try {
    const waits = []
    const reap = h.adapter.reap.bind(h.adapter)
    h.adapter.reap = (sessionId, live) => { waits.push(sessionId); return reap(sessionId, live) }
    const chunks = await step(h, [user('hi')])
    assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
    const call = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block
    const args = JSON.parse(call.arguments)
    const live = h.live()
    // The agent's question for the call is in: the Stop below withdraws it, and the agent ends.
    await until(() => live.run.tools.get(args.id)?.permission !== undefined, 'the agent\'s permission request')
    const controller = new AbortController()
    controller.abort()
    await h.tools.get(TOOL_NAME).execute(args, { agent: h.agent, callId: call.id, signal: controller.signal })
    assert.deepEqual(waits, ['s1'])
    await until(() => !live.run.busy, 'the cancelled prompt to end')
    h.tick(CANCEL_WAIT_MS)
    assert.equal(h.live(), live)
  } finally {
    h.close()
  }
})

test('a drifted built-in call whose cancel the agent ignores ends with its session, not with the person\'s Stop', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel', toolsOn: true, spec: { drift: true }, cancelWaitMs: 150, realClock: true })
  try {
    const running = step(h, [user('drift')])
    await until(() => h.live()?.run !== undefined, 'the agent session')
    const run = h.live().run
    const reason = (await running).at(-1).reason
    // The prompt ends with the process; how it says so is the SDK's wording.
    assert.equal(reason.kind, 'error')
    assert.match(reason.failure.message, /^Fake agent: /)
    assert.deepEqual(h.unheard(), ['session/cancel'])
    assert.equal(h.adapter.live.size, 0)
    assert.equal(h.backchannel.records.size, 0)
    await gone(run)
  } finally {
    h.close()
  }
})

// --- what the agent started ends with it --------------------------------------------------------
//
// An agent that ignores a cancel is usually stuck in a tool command, and that command is its
// own child: ending the agent alone would leave it running in the person's folder, beside the
// session that replaces it. The agent leads a process group and the group ends as one. Windows
// has no groups (the tree is killed there), so these run where groups exist.
const grouped = { skip: process.platform === 'win32' && 'Windows has no process groups' }

test('a start nobody answers ends what the agent had started, not only the agent', grouped, async (t) => {
  const h = fixture(t, { deaf: 'initialize' })
  h.env.FAKE_ACP_CHILD = '1'
  try {
    const running_ = step(h, [user('plain')])
    await until(() => h.unheard().includes('initialize') && h.children().length === 1, 'the agent and its child to run')
    const run = h.live().run
    const [child] = h.children()
    assert.ok(running(child), 'the child runs while the start waits')
    h.tick(START_MS)
    assert.equal((await running_).at(-1).reason.kind, 'error')
    await gone(run)
    await ended(child, 'the child of an agent that never started')
  } finally {
    h.close()
  }
})

test('a session ended for an ignored cancel takes the processes the agent started with it', grouped, async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  h.env.FAKE_ACP_CHILD = '1'
  try {
    const messages = []
    await stoppedTurn(h, messages)
    await until(() => h.unheard().includes('session/cancel') && h.children().length === 1, 'the cancel to reach the agent, with its child running')
    const run = h.live().run
    const [child] = h.children()
    h.tick(CANCEL_WAIT_MS - 1)
    assert.ok(running(child), 'nothing ends before the wait is over')
    h.tick(1)
    assert.equal(h.adapter.live.size, 0)
    await gone(run)
    await ended(child, 'the child of the ended session')
    // The session that replaces it starts its own, and that one is left alone.
    assert.match(textIn(await turn(h, messages, 'plain')), /turn 1: you said/)
    await until(() => h.children().length === 2, 'the new agent\'s child to run')
    assert.ok(running(h.children()[1]))
  } finally {
    h.close()
  }
})

test('a process that ignores the request to end is killed once the agent\'s own time to end is up', grouped, async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  h.env.FAKE_ACP_CHILD = 'stubborn'
  try {
    await stoppedTurn(h, [])
    await until(() => h.unheard().includes('session/cancel') && h.children().length === 1, 'the cancel to reach the agent, with its child running')
    const run = h.live().run
    const [child] = h.children()
    h.tick(CANCEL_WAIT_MS)
    // The agent ends when asked; its child was asked with it and goes on.
    await gone(run)
    h.tick(KILL_AFTER_MS - 1)
    assert.ok(running(child), 'the agent\'s exit does not end the wait for the rest of its group')
    h.tick(1)
    await ended(child, 'the child that ignored SIGTERM')
  } finally {
    h.close()
  }
})

test('an agent that ends by itself does not leave what it started behind', grouped, async (t) => {
  const h = fixture(t)
  h.env.FAKE_ACP_CHILD = '1'
  try {
    await turn(h, [], 'plain')
    await until(() => h.children().length === 1, 'the agent\'s child to run')
    const run = h.live().run
    const [child] = h.children()
    // The agent is gone with no word from the app (a crash, the person's own kill).
    process.kill(run.child.pid, 'SIGKILL')
    await gone(run)
    await ended(child, 'the child of an agent that ended by itself')
  } finally {
    h.close()
  }
})

// --- with the level hold (#1028) -----------------------------------------------------------------
//
// `endSession` ends an agent session for a Session whose level is not set. It may land while a
// cancel's own wait runs there: the hold wins, nothing new starts, and the wait ends nothing twice.

test('a session ended by a hold while a new turn waits on its old prompt is not replaced in that turn', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  try {
    const messages = []
    await droppedTurn(h, messages)
    const wedged = h.live().run
    const asked = askedAgain(wedged)
    const running = step(h, [...messages, user('plain')])
    await until(asked, 'the new turn to ask the agent to stop')
    assert.equal(h.adapter.endSession('s1', 'On hold.'), true)
    const chunks = await running
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(textIn(chunks), 'On hold.')
    assert.equal(h.adapter.live.size, 0)
    await gone(wedged)
    assert.equal(h.sessions(), 1, 'no agent session was started for the refused turn')
  } finally {
    h.close()
  }
})

test('a hold that ends a session whose cancel was ignored leaves the cancel wait nothing to do', async (t) => {
  const h = fixture(t, { deaf: 'session/cancel' })
  try {
    await stoppedTurn(h, [])
    await until(() => h.unheard().includes('session/cancel'), 'session/cancel to reach the agent')
    const live = h.live()
    assert.notEqual(live.reaper, undefined, 'the wait for the cancelled prompt is running')
    assert.equal(h.adapter.endSession('s1', 'On hold.'), true)
    assert.equal(live.reaper, undefined)
    await gone(live.run)
    h.tick(CANCEL_WAIT_MS)
    assert.deepEqual(h.warnings, [])
  } finally {
    h.close()
  }
})

