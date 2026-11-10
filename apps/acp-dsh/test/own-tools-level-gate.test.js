// Which of an ACP agent's actions a `tools/execute` guard can refuse, and which it cannot. The
// Bot team marks a Session whose permission level could not be set and refuses every tool
// there in its `tools/execute` guard (bots-dsh, permissions.js `levelHolds`). These tests run
// the adapter over the fake agent on real stdio and DSH's real tool pipeline (its ToolsService
// and native executor), with a stand-in for that guard: a `tools/execute` listener that throws
// on the Sessions a test marks. This package's tests need no Bot team.
//
// The facts, one test each: an own tool that asks is refused before it runs; an own tool that
// does not ask (its mode lets it through) has run whatever the guard says, in the wide mode the
// Session's unset level gave the agent; a DSH tool over the bridge is refused.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session } from '@deepseek-ai/dsh-session'
import { ToolsService } from '@deepseek-ai/dsh-tools'
import * as native from '@deepseek-ai/dsh-tool-executor-native'
import { apply } from '../index.js'
import { AcpAdapter, HELD_TEXT } from '../src/host/adapter.js'
import { AGENTS } from '../src/host/agents.js'
import { Backchannel } from '../src/host/backchannel.js'
import { TOOL_NAME } from '../src/host/tool.js'
import { assertLoadable } from './support/bridge-host.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const PROVIDER = 'acp-fake'
const FULL = 'danger-full-access'
const WRITE = 'workspace-write'
// The sentence the Bot team's guard refuses with (bots-dsh, permissions.js).
const SENTENCE = 'The workspace-write permission level could not be set on this conversation, so no tool runs here until it is. Tell the user: restarting DeepSeek Harness, or changing the permission level, tries again.'

// Nothing here waits without a bound: a hanging agent fails its test, it never hangs the run.
const within = (promise, what, ms = 15_000) => {
  let timer
  return Promise.race([promise, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`${what} did not finish in ${ms} ms`)), ms) })]).finally(() => clearTimeout(timer))
}
const waitFor = async (check, ms = 10_000) => {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const textIn = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
const callsIn = chunks => chunks.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').map(chunk => chunk.block)
const said = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })

/**
 * One DSH host: the real pipeline, fakes for the services around it, and the adapter on the
 * fake agent. `level` is what every Session reads (the level it HAS, which on a marked Session
 * is not the one chosen), `modes` what the fake agent offers, `modeFor` the agent's own map
 * from a level to its modes, `bridge` whether DSH's tools reach the agent.
 */
async function world(t, { level: startLevel = FULL, modes, modeFor, bridge = false, env = {}, gates = [], holdWaitMs, access, spec: extra = {}, answer = 'allowed-once', bash } = {}) {
  let level = startLevel
  const dir = mkdtempSync(join(tmpdir(), 'acp-own-tools-'))
  const tracePath = join(dir, 'trace.jsonl')
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools() {}, section() {} })
  await ctx.plugin(ToolsService)
  await ctx.plugin(native)
  // A DSH tool of its own, for the bridge: its body records that it ran.
  const executed = []
  ctx.tools.register({
    name: 'bash',
    description: 'Run a command',
    parameters: { type: 'object', properties: {} },
    output: { schema: {}, render: () => [{ type: 'text', text: 'ran bash' }] },
    async execute(args) {
      executed.push(args)
      await bash?.(executed.length)
      return {}
    },
  })
  const asked = []
  ctx.provide('approval', {
    effectivePolicy: () => (level === FULL ? 'never' : 'ask'),
    overrideOf: () => 'ask',
    request: async (request) => { asked.push(request); return typeof answer === 'function' ? answer(request) : answer },
  })
  ctx.provide('permissionPresets', { current: () => level, set() {}, registerAuto: () => () => {} })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: level }) })
  ctx.provide('sessions', { list: () => [] })
  ctx.provide('workingDirectory', { ensure: async () => dir })
  ctx.provide('agentPresets', { presetForSession: () => 'standard' })
  const agents = new Map()
  ctx.provide('agents', { get: id => agents.get(id), list: () => [...agents.values()], turnBoundaryOf: () => ({ lastTurn: 1 }) })

  // The stand-in for the Bot team's guard: every tool of a marked Session is refused at
  // `tools/execute`, before its body.
  const marked = new Set()
  const guarded = []
  ctx.on('tools/execute', (exec, next) => {
    const id = exec.agent?.session?.id
    if (!marked.has(id)) return next()
    guarded.push(exec.name)
    throw Object.assign(new Error(SENTENCE), { code: 'bot/refused' })
  }, { prepend: true })

  const spec = {
    name: 'Fake agent',
    catalog: { models: async () => [{ id: 'default', name: 'Fake agent' }], model: async () => undefined, ownEffort: () => undefined, dispose() {} },
    installed: () => true,
    spawn: () => ({ command: process.execPath, args: [FAKE], env: { FAKE_ACP_TRACE: tracePath, ...(modes === undefined ? {} : { FAKE_ACP_MODES: modes.join(',') }), ...env } }),
    ...(modeFor === undefined ? {} : { modeFor }),
    ...extra,
  }
  const backchannel = new Backchannel({ ctx })
  const adapter = new AcpAdapter(ctx, new Map([[PROVIDER, spec]]), { dshTools: () => bridge, backchannel, holds: () => gates, ...(access === undefined ? {} : { access }), ...(holdWaitMs === undefined ? {} : { holdWaitMs }) })
  let scopes
  await ctx.plugin({ name: 'test-agents', inject: ['tools'], apply(child) { scopes = child } })
  // Every agent process a test started, whatever became of its run: none outlives its test.
  const runs = new Set()
  const pids = () => { try { return new Set(readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).pid)) } catch { return new Set() } }
  t.after(async () => {
    for (const run of runs) { try { run.child?.kill('SIGKILL') } catch {} }
    for (const pid of pids()) { try { process.kill(pid, 'SIGKILL') } catch {} }
    adapter.dispose()
    backchannel.dispose()
    await ctx.root.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  // One chat on the agent: a DSH Session in an open step, its agent scope, the mirror in it.
  const chat = (id) => {
    const session = Session.create(id, undefined, { version: 4, id, createdAt: 0, isSeeded: false, cwd: dir })
    const agent = { session, status: 'idle' }
    const scope = createScope(scopes, agent)
    t.after(() => scope.dispose())
    agent.ctx = scope.ctx
    agents.set(id, agent)
    adapter.registerMirror(agent)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const { name, description, parameters } = adapter.tool
    session.append('request/header', { header: { config: { provider: PROVIDER, model: 'default' }, tools: [{ name, description, parameters }] } })
    const messages = []
    // One model step, as DSH's loop streams it.
    const step = () => within((async () => {
      const chunks = []
      for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: PROVIDER, model: 'default', sessionId: id, messages }))) chunks.push(chunk)
      messages.push({ role: 'assistant', source: { kind: 'model', provider: PROVIDER, model: 'default' }, content: chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block) })
      return chunks
    })(), 'the step')
    // The step's mirror call through the pipeline, as the loop runs it: the assistant row, the
    // step's admission, the batch with its log. The result goes back as the tool message.
    const run = block => within((async () => {
      session.append('assistant/message', {
        turn: 1, step: 1, stream: [],
        message: createAssistantMessage({ content: [{ type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }], source: { provider: PROVIDER, model: 'default' } }),
      }, { surfaceOp: 'append' })
      const signal = new AbortController().signal
      const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: PROVIDER, model: 'default' }, signal })
      try {
        const batch = await ctx.tools.execute({ calls: [{ id: block.id, name: block.name, arguments: block.arguments }], agent, signal, log: { turn: 1, step: 1 }, toolSet, maxParallelToolCalls: 1 })
        const result = batch.results[0].result
        messages.push({ role: 'tool', toolCallId: block.id, source: { kind: 'tool', callId: block.id }, content: result.content })
        return result
      } finally {
        toolSet.dispose()
      }
    })(), 'the tool call')
    const say = text => messages.push(said(text))
    return { id, session, agent, messages, step, run, say }
  }
  const trace = () => (existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
  const events = name => trace().filter(entry => entry.event === name)
  // The fake writes its trace beside its updates: a line is waited for, never assumed there.
  const seen = async (name, count = 1) => { await waitFor(() => events(name).length >= count); return events(name) }
  return { ctx, adapter, backchannel, runs, chat, marked, guarded, executed, asked, trace, events, seen, gates, setLevel: (next) => { level = next } }
}

const resultText = result => (result.content ?? []).map(block => block.text ?? '').join('\n')

// --- the facts ----------------------------------------------------------------------------

test('fact: an own tool that asks passes tools/execute, so the guard refuses it before it runs', async (t) => {
  const w = await world(t, { level: WRITE })
  const c = w.chat('s1')
  w.marked.add('s1')
  c.say('hi')
  const first = await c.step()
  const [call] = callsIn(first)
  assert.equal(call.name, TOOL_NAME)
  assert.equal(first.at(-1).reason.kind, 'tool-calls')
  const result = await c.run(call)
  assert.equal(result.isError, true)
  assert.match(resultText(result), /could not be set on this conversation/)
  assert.deepEqual(w.guarded, [TOOL_NAME])
  assert.equal(w.asked.length, 0, 'the body never asked: the call was refused before it')
  // The agent's question got the refusal, so its tool did not run.
  const second = await c.step()
  assert.match(textIn(second), /I was not allowed to run it/)
  assert.equal(second.at(-1).reason.kind, 'stop')
})

for (const [id, modes, wide] of [
  ['acp-claude', ['default', 'auto', 'bypassPermissions'], 'bypassPermissions'],
  ['acp-codex', ['read-only', 'workspace-write', 'agent', 'agent-full-access'], 'agent-full-access'],
]) {
  test(`fact: on a Session still at full access ${id} gets ${wide}, and an own tool that does not ask runs whatever the guard says`, async (t) => {
    // The Session was to be lowered and was not: it reads full access, and is marked.
    const w = await world(t, { level: FULL, modes, modeFor: AGENTS[id].modeFor })
    const c = w.chat('s1')
    w.marked.add('s1')
    c.say('unasked')
    const first = await c.step()
    // The agent's mode came from the level the Session has, not the one chosen.
    assert.deepEqual(w.events('set-mode').map(entry => entry.modeId), [wide])
    const [call] = callsIn(first)
    assert.equal(call.name, TOOL_NAME)
    // The guard refuses the mirror call...
    const result = await c.run(call)
    assert.equal(result.isError, true)
    assert.match(resultText(result), /could not be set on this conversation/)
    assert.deepEqual(w.guarded, [TOOL_NAME])
    // ...and the agent's tool ran all the same: the mirror's body runs nothing, it only shows.
    assert.deepEqual((await w.seen('own-tool-ran')).map(entry => [entry.toolCallId, entry.mode]), [['unasked-1-1', wide]])
    const second = await c.step()
    assert.match(textIn(second), /It ran unasked 1/)
    assert.equal(second.at(-1).reason.kind, 'stop')
  })
}

test('fact: even the strict mode of the level the Session has runs an own tool that does not ask', async (t) => {
  // Chosen read-only, still at workspace-write: Codex's workspace-write writes in the workspace unasked.
  const w = await world(t, { level: WRITE, modes: ['read-only', 'workspace-write', 'agent', 'agent-full-access'], modeFor: AGENTS['acp-codex'].modeFor })
  const c = w.chat('s1')
  w.marked.add('s1')
  c.say('unasked')
  const first = await c.step()
  assert.deepEqual(w.events('set-mode').map(entry => entry.modeId), ['workspace-write'])
  assert.equal((await c.run(callsIn(first)[0])).isError, true)
  assert.deepEqual((await w.seen('own-tool-ran')).map(entry => entry.mode), ['workspace-write'])
})

test('fact: a DSH tool over the bridge passes tools/execute, so the guard refuses it', async (t) => {
  const w = await world(t, { level: FULL, bridge: true })
  const c = w.chat('s1')
  w.marked.add('s1')
  c.say('bridge bash')
  const chunks = await c.step()
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.deepEqual(callsIn(chunks), [], 'a bridge call has no mirror call')
  assert.match(textIn(chunks), /The bridge said: .*could not be set on this conversation/)
  assert.deepEqual(w.guarded, ['bash'])
  assert.deepEqual(w.executed, [], 'the tool body never ran')
})

test('fact: on a Session that is not marked the same calls run', async (t) => {
  const w = await world(t, { level: FULL, bridge: true })
  const c = w.chat('s1')
  c.say('bridge bash')
  assert.match(textIn(await c.step()), /The bridge said: ran bash/)
  assert.deepEqual(w.executed, [{}])
  assert.deepEqual(w.guarded, [])
})

test('fact: a call the agent only reports once it is done has run whatever the guard says', async (t) => {
  const w = await world(t, { level: FULL })
  const c = w.chat('s1')
  w.marked.add('s1')
  c.say('leak-tool')
  const first = await c.step()
  assert.equal((await c.run(callsIn(first)[0])).isError, true)
  assert.match(textIn(await c.step()), /done/)
})

// --- the gate: no agent acts for a held Session -------------------------------------------

const CLAUDE = { modes: ['default', 'auto', 'bypassPermissions'], modeFor: AGENTS['acp-claude'].modeFor }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
// A gate over a set of held Sessions, as the Bot team's is over its marks.
const gateOf = (heldIds, seen = []) => ({ sessionId }) => { seen.push(sessionId); return heldIds.has(sessionId) ? SENTENCE : undefined }
const onlySentence = (chunks, text = SENTENCE) => {
  assert.equal(textIn(chunks), text)
  assert.deepEqual(callsIn(chunks), [])
  assert.equal(chunks.at(-1).reason.kind, 'stop')
}

test('no turn starts on a held Session: no agent process, no mode, no prompt, no tool; others run, and it runs once let go', async (t) => {
  const heldIds = new Set(['s1'])
  const w = await world(t, { ...CLAUDE, gates: [gateOf(heldIds)] })
  const c = w.chat('s1')
  c.say('unasked')
  onlySentence(await c.step())
  // A queued follow-up is a turn too.
  c.say('unasked')
  onlySentence(await c.step())
  assert.deepEqual(w.trace(), [], 'the agent was never started')
  assert.equal(w.adapter.live.has('s1'), false)
  // Another Session is not looked at twice: it runs as ever.
  const other = w.chat('s2')
  other.say('plain')
  assert.match(textIn(await other.step()), /you said "plain"/)
  // Let go: the same chat runs, in the mode its level gives now.
  heldIds.clear()
  c.say('unasked')
  const first = await c.step()
  assert.equal(callsIn(first).length, 1)
  assert.equal((await w.seen('own-tool-ran')).length, 1)
})

test('a held chat that already has answers (a resumed or replayed turn) starts nothing either', async (t) => {
  const w = await world(t, { gates: [() => SENTENCE] })
  const c = w.chat('s1')
  c.messages.push(said('earlier'), { role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model: 'x' }, content: [{ type: 'text', text: 'an answer' }] })
  c.say('unasked')
  onlySentence(await c.step())
  assert.deepEqual(w.trace(), [])
  assert.equal(c.session.snapshotEvents().some(event => event.type === 'user/message'), false, 'no boundary or new-session row')
})

test('mutant gate-only-first-step: a Session held after its turn began gets no further step, and its agent session ends', async (t) => {
  const heldIds = new Set()
  const w = await world(t, { level: WRITE, gates: [gateOf(heldIds)] })
  const c = w.chat('s1')
  c.say('twice')
  const first = await c.step()
  const [call] = callsIn(first)
  const pid = w.events('prompt')[0].pid
  heldIds.add('s1')
  w.marked.add('s1')
  assert.equal((await c.run(call)).isError, true)
  onlySentence(await c.step())
  assert.equal(w.adapter.live.has('s1'), false)
  await waitFor(() => !alive(pid))
  // The second call of that turn never came: the agent was told no, then stopped.
  assert.equal(w.asked.length, 0)
})

test('mutant mark-during-start: a Session held while the agent started gets no prompt', async (t) => {
  // The first ask (the step's entry) lets it go; the mark lands while the start is awaited.
  let asks = 0
  const w = await world(t, { ...CLAUDE, gates: [() => (++asks === 1 ? undefined : SENTENCE)] })
  const c = w.chat('s1')
  c.say('unasked')
  onlySentence(await c.step())
  assert.equal(asks, 2)
  assert.equal(w.events('new-session').length, 1, 'it had started')
  assert.deepEqual(w.events('prompt'), [])
  assert.deepEqual(w.events('own-tool-ran'), [])
  assert.equal(w.adapter.live.has('s1'), false)
  await waitFor(() => !alive(w.events('new-session')[0].pid))
})

test('a Session ended while its agent starts answers the sentence, and no connector is rolled back for it', async (t) => {
  let rolledBack = 0
  const w = await world(t, {
    // An agent that never answers `initialize`: the start waits on it.
    spec: { spawn: () => ({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }), rollback: () => { rolledBack += 1; return false } },
  })
  const c = w.chat('s1')
  c.say('hi')
  const stepping = c.step()
  await waitFor(() => w.adapter.live.get('s1')?.run !== undefined)
  w.runs.add(w.adapter.live.get('s1').run)
  assert.equal(w.adapter.endSession('s1', SENTENCE), true)
  onlySentence(await stepping)
  assert.equal(rolledBack, 0)
})

test('a Session ended right after the start (before the model, the mode or a fork) answers the sentence, not an error', async (t) => {
  let w
  w = await world(t, { ...CLAUDE, spec: { proven: () => w.adapter.endSession('s1', SENTENCE) } })
  const c = w.chat('s1')
  c.say('unasked')
  onlySentence(await c.step())
  assert.deepEqual(w.events('prompt'), [])
})

test('mutants successful-retry-keeps-wide-mode and cancel-ignored: a mark mid-turn ends the agent session, and the next turn takes its mode again', async (t) => {
  const w = await world(t, { ...CLAUDE, env: { FAKE_ACP_IGNORE_CANCEL: '1', FAKE_ACP_UNASKED_GAP_MS: '60000' } })
  const c = w.chat('s1')
  c.say('unasked twice')
  const first = await c.step()
  assert.deepEqual(w.events('set-mode').map(entry => entry.modeId), ['bypassPermissions'])
  const [call] = callsIn(first)
  const pid = w.events('prompt')[0].pid
  // The Bot team marks the Session (a lowering failed) and ends its agent session at once.
  assert.equal(w.adapter.endSession('s1', SENTENCE), true)
  assert.equal(w.adapter.endSession('s1', SENTENCE), false, 'nothing left to end')
  const result = await c.run(call)
  assert.match(resultText(result), /no longer running this call/)
  // The process is gone although it ignores a cancel; its second call never ran.
  await waitFor(() => !alive(pid))
  assert.equal(w.events('own-tool-ran').length, 1)
  // The level then holds (workspace-write) and nothing holds the Session: the step that
  // continued the old turn says it was interrupted, and a new turn is a fresh agent session
  // in the mode of the level now, not the wide one the old session kept.
  w.setLevel(WRITE)
  assert.match(textIn(await c.step()), /was interrupted before it finished/)
  c.say('unasked')
  await c.step()
  assert.equal(w.events('new-session').length, 2)
  assert.deepEqual(w.events('set-mode').map(entry => entry.modeId), ['bypassPermissions'], 'the fresh session stays in its strict start mode')
  assert.deepEqual((await w.seen('own-tool-ran', 2)).map(entry => entry.mode), ['bypassPermissions', 'default'])
})

test('a step waiting on the agent when its Session is ended answers the sentence at once', async (t) => {
  const w = await world(t, { env: { FAKE_ACP_IGNORE_CANCEL: '1' } })
  const c = w.chat('s1')
  c.say('hang')
  const stepping = c.step()
  await waitFor(() => w.events('prompt').length === 1)
  w.adapter.endSession('s1', SENTENCE)
  const chunks = await stepping
  assert.match(textIn(chunks), /could not be set on this conversation/)
  assert.equal(chunks.at(-1).reason.kind, 'stop', 'not an error: no other model answers for it')
})

test('a permission question pending when the Session is ended is withdrawn, and its tool does not run', async (t) => {
  const w = await world(t, { level: WRITE })
  const c = w.chat('s1')
  c.say('hi')
  const first = await c.step()
  const [call] = callsIn(first)
  const live = w.adapter.live.get('s1')
  await waitFor(() => live.run.tools.get('call-1-1')?.permission !== undefined)
  w.adapter.endSession('s1', SENTENCE)
  assert.equal(live.run.tools.get('call-1-1').permission, undefined, 'the question was answered: cancelled')
  const result = await c.run(call)
  assert.match(resultText(result), /no longer running this call/)
  assert.equal(w.asked.length, 0, 'no dialog for a call of an ended agent session')
})

test('a bridge call outstanding when the Session is ended is revoked, and the log still loads', async (t) => {
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  let entered
  const reached = new Promise((resolve) => { entered = resolve })
  const w = await world(t, { level: FULL, bridge: true, bash: () => { entered(); return waiting } })
  const c = w.chat('s1')
  c.say('bridge bash')
  const stepping = c.step()
  await within(reached, 'the bridge call reaching its tool')
  const record = w.adapter.live.get('s1').bridge
  w.adapter.endSession('s1', SENTENCE)
  assert.equal(record.closed, true, 'the bridge credential is revoked: no new call is taken')
  const chunks = await stepping
  // What the agent had said stays; the sentence follows in a block of its own.
  const texts = chunks.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'text').map(chunk => chunk.block.text)
  assert.deepEqual(texts, ['Fake agent, turn 1: you said "bridge bash".', SENTENCE])
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.deepEqual(w.executed.length, 1, 'the call was already running: it is not interrupted')
  // DSH closes the step and the turn while the tool's body is still running: the guard is
  // still on the Session, so the open call is closed in its own step and the log loads.
  assert.equal(record.calls, 1)
  c.session.append('step/end', { turn: 1, step: 1 })
  c.session.append('turn/end', { turn: 1 })
  assertLoadable(c.session, ' after the step closed over a running call')
  const results = () => c.session.snapshotEvents().filter(event => event.type === 'tool/result').length
  assert.equal(results(), 1, 'the open call got its result before the step ended')
  // The body answers late: its result is not written outside the step, and the guard goes.
  release()
  await waitFor(() => record.calls === 0)
  assert.equal(results(), 1)
  assertLoadable(c.session, ' after the late result')
  assert.equal(Object.hasOwn(c.session, 'append'), false, 'the write guard was released with the last call')
  // And a held Session's next turn mints no bridge.
  w.gates.push(() => SENTENCE)
  c.say('bridge bash')
  onlySentence(await c.step())
  assert.equal(w.adapter.live.has('s1'), false)
})

for (const [name, gate] of [
  ['throws an error with a path in it', () => { throw new Error('ENOENT: /home/someone/.secret/state.json') }],
  ['throws undefined', () => { throw undefined }],
  ['throws an empty error', () => { throw new Error('') }],
  ['rejects', async () => { throw new Error('provider said no at https://example.invalid/key') }],
  ['answers an empty text', () => ''],
  ['answers blanks', () => '   '],
  ['answers false', () => false],
  ['answers a number', () => 42],
  ['answers an object', () => ({ held: false })],
]) {
  test(`mutant throw-empty: a gate that ${name} holds the Session with the fixed sentence`, async (t) => {
    const w = await world(t, { gates: [gate] })
    const c = w.chat('s1')
    c.say('unasked')
    onlySentence(await c.step(), HELD_TEXT)
    assert.deepEqual(w.trace(), [])
  })
}

test('mutant gate-never-settles: a gate with no answer in time holds the Session', async (t) => {
  const w = await world(t, { gates: [() => new Promise(() => {})], holdWaitMs: 40 })
  const c = w.chat('s1')
  c.say('unasked')
  const started = Date.now()
  onlySentence(await c.step(), HELD_TEXT)
  assert.ok(Date.now() - started < 2_000)
  assert.deepEqual(w.trace(), [])
})

test('a slow gate that lets go does not outlive a refusal: any refusal wins, the first to arrive', async (t) => {
  const w = await world(t, { gates: [() => new Promise(resolve => setTimeout(resolve, 5_000).unref()), () => SENTENCE], holdWaitMs: 10_000 })
  const c = w.chat('s1')
  c.say('unasked')
  const started = Date.now()
  onlySentence(await c.step())
  assert.ok(Date.now() - started < 2_000)
})

// --- the service: vetoes compose ----------------------------------------------------------

function plugin(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'acp-own-tools-'))
  const tracePath = join(cwd, 'trace.jsonl')
  const registered = {}
  const provided = {}
  const disposers = []
  const agent = { session: { id: 's1', header: { cwd }, append: () => ({ seq: 1 }) }, status: 'idle', ctx: { tools: { register: () => () => {} } } }
  const ctx = {
    llm: { registerAdapter: (providers, adapter) => { for (const id of providers) registered[id] = adapter; return () => {} } },
    agents: { get: () => agent, list: () => [agent] },
    get: () => undefined,
    on: () => () => {},
    effect: (fn) => { disposers.push(fn()) },
    provide: (name, service) => { provided[name] = service },
  }
  const before = process.env.FAKE_ACP_TRACE
  process.env.FAKE_ACP_TRACE = tracePath
  apply(ctx, { fakeAgent: FAKE, claude: false, codex: false, dshTools: false })
  t.after(() => {
    if (before === undefined) delete process.env.FAKE_ACP_TRACE
    else process.env.FAKE_ACP_TRACE = before
    for (const dispose of disposers) dispose?.()
    rmSync(cwd, { recursive: true, force: true })
  })
  const step = async (text = 'plain') => {
    const chunks = []
    for await (const chunk of registered[PROVIDER].stream(markAgentLoopRequest({ provider: PROVIDER, model: 'default', sessionId: 's1', messages: [said(text)] }))) chunks.push(chunk)
    return chunks
  }
  const bounded = step
  const stepWithin = text => within(bounded(text), 'the step')
  return { service: provided.acpAgents, adapter: registered[PROVIDER], step: stepWithin }
}

test('mutant last-gate-wins: several plugins hold turns, any refusal wins, in both orders, and a disposer removes only its own', async (t) => {
  const p = plugin(t)
  const asked = []
  const bots = (question) => { asked.push(Object.keys(question).sort().join(',')); return SENTENCE }
  const lenient = () => undefined
  // The Bot team first, then another plugin that lets everything go: still held.
  const offBots = p.service.holdTurns(bots)
  const offLenient = p.service.holdTurns(lenient)
  onlySentence(await p.step())
  assert.deepEqual(asked, ['agent,provider,sessionId'])
  // A stale disposer, called again and again, removes nothing of anyone else's.
  offLenient()
  offLenient()
  onlySentence(await p.step())
  // The other order (a reload of the Bot team puts it last): still held.
  offBots()
  const offLenientAgain = p.service.holdTurns(lenient)
  const offBotsAgain = p.service.holdTurns(bots)
  onlySentence(await p.step())
  // The stale disposer of the first registration does not remove the second.
  offBots()
  onlySentence(await p.step())
  // The same function registered twice is two registrations.
  const twice = p.service.holdTurns(bots)
  offBotsAgain()
  onlySentence(await p.step())
  twice()
  offLenientAgain()
  // No registrant left: the chat runs as it always did.
  assert.match(textIn(await p.step()), /Fake agent, turn 1: you said "plain"\./)
  // Not a function: nothing registered, and its disposer is harmless.
  p.service.holdTurns(undefined)()
  assert.match(textIn(await p.step()), /turn 2/)
})

test('the service ends one Session\'s agent session, and says whether one was live', async (t) => {
  const p = plugin(t)
  assert.equal(p.service.endSession('s1', SENTENCE), false)
  await p.step()
  assert.equal(p.adapter.live.has('s1'), true)
  assert.equal(p.service.endSession('s1'), true)
  assert.equal(p.adapter.live.has('s1'), false)
  assert.equal(p.service.endSession('nowhere'), false)
  // The next turn is a fresh agent session.
  assert.match(textIn(await p.step()), /turn 1/)
})

test('a lowering that fails during the consent wait refuses that turn, also when a later retry lifts the mark', async (t) => {
  // The reviewer's sequence: the entry ask lets the turn go; while the consent is read (no
  // agent session exists yet) the Bot team marks the Session and ends it; the start takes
  // longer than the retry spacing, so the ask before the prompt retries, sets the level and
  // lets go. The turn must not run in the mode its old level would have given.
  let w
  let consent
  const asks = []
  w = await world(t, {
    ...CLAUDE,
    gates: [() => { asks.push(w.adapter.live.has('s1')); return undefined }],
    access: () => new Promise((resolve) => { consent = resolve }),
  })
  const c = w.chat('s1')
  c.say('unasked')
  const stepping = c.step()
  await waitFor(() => consent !== undefined)
  assert.equal(w.adapter.endSession('s1', SENTENCE), true, 'a turn was starting there')
  w.setLevel(WRITE)
  consent(undefined)
  onlySentence(await stepping)
  assert.deepEqual(w.trace(), [], 'nothing was started for that turn')
  assert.equal(w.adapter.live.has('s1'), false)
  assert.equal(w.adapter.starting.has('s1'), false)
  // The next turn is a fresh agent session in the mode of the level now.
  consent = undefined
  c.say('unasked')
  const next = c.step()
  await waitFor(() => consent !== undefined)
  consent(undefined)
  assert.equal(callsIn(await next).length, 1)
  assert.deepEqual(w.events('set-mode'), [], 'it stays in its strict start mode')
  assert.deepEqual((await w.seen('own-tool-ran')).map(entry => entry.mode), ['default'])
})

test('a Session ended between the start and the prompt is refused whatever the gate says then', async (t) => {
  // The mode was taken from the old level (full access); the gate lets go at the prompt.
  let w
  w = await world(t, { ...CLAUDE, gates: [() => undefined], spec: { proven: () => { w.adapter.starting.get('s1').held = SENTENCE } } })
  const c = w.chat('s1')
  c.say('unasked')
  onlySentence(await c.step())
  assert.deepEqual(w.events('prompt'), [])
  assert.equal(w.adapter.live.has('s1'), false)
  await waitFor(() => !alive(w.events('new-session')[0].pid))
})

test('ending a Session with nothing live or starting changes nothing, and a later turn runs', async (t) => {
  const w = await world(t, {})
  const c = w.chat('s1')
  assert.equal(w.adapter.endSession('s1', SENTENCE), false)
  c.say('plain')
  assert.match(textIn(await c.step()), /you said "plain"/)
  assert.equal(w.adapter.starting.has('s1'), false, 'the start is forgotten once its prompt is sent')
})

test('several bridge calls under way when the Session is ended: the write guard stays until the last one is back', async (t) => {
  // Each call's body waits on its own latch.
  const latches = []
  const w = await world(t, { level: FULL, bridge: true, env: { FAKE_ACP_IGNORE_CANCEL: '1' }, bash: n => new Promise((resolve) => { latches[n - 1] = resolve }) })
  const c = w.chat('s1')
  c.say('hang')
  const stepping = c.step()
  await waitFor(() => w.events('prompt').length === 1)
  const record = w.adapter.live.get('s1').bridge
  const post = callId => fetch(w.backchannel.urlFor(record), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${record.credential}` },
    body: JSON.stringify({ op: 'call', name: 'bash', arguments: {}, callId }),
    signal: AbortSignal.timeout(15_000),
  }).then(response => response.status, () => 'failed')
  const answers = [post('two-1'), post('two-2')]
  await waitFor(() => latches.filter(Boolean).length === 2)
  assert.equal(record.calls, 2)
  w.adapter.endSession('s1', SENTENCE)
  assert.match(textIn(await stepping), /could not be set on this conversation/)
  c.session.append('step/end', { turn: 1, step: 1 })
  c.session.append('turn/end', { turn: 1 })
  assertLoadable(c.session, ' after the step closed over two running calls')
  const results = () => c.session.snapshotEvents().filter(event => event.type === 'tool/result').length
  assert.equal(results(), 2)
  // The first is back: the other still runs, so the guard stays.
  latches[0]()
  await waitFor(() => record.calls === 1)
  assert.equal(Object.hasOwn(c.session, 'append'), true, 'the guard is still on the Session')
  // A third call on the revoked bridge is refused and takes nothing.
  assert.equal(await post('two-3'), 401)
  assert.equal(record.calls, 1)
  latches[1]()
  await waitFor(() => record.calls === 0)
  assert.equal(Object.hasOwn(c.session, 'append'), false, 'released with the last call')
  assert.equal(results(), 2, 'no late result was written')
  assertLoadable(c.session, ' after both late results')
  assert.deepEqual(await within(Promise.all(answers), 'the bridge answers'), [401, 401])
})

test('a Session ended during the gate\'s own wait at the step\'s entry is refused, and nothing starts', async (t) => {
  let w
  let consents = 0
  w = await world(t, {
    ...CLAUDE,
    gates: [async () => { w.adapter.endSession('s1', SENTENCE); await new Promise(resolve => setImmediate(resolve)); return undefined }],
    access: () => { consents += 1; return undefined },
  })
  const c = w.chat('s1')
  c.say('unasked')
  onlySentence(await c.step())
  assert.equal(consents, 0, 'refused at the entry itself: not even the consent was read')
  assert.deepEqual(w.trace(), [], 'no agent process for a turn refused at its entry')
  assert.equal(w.adapter.starting.size, 0)
})

test('a Session ended during the gate\'s own wait before the prompt is refused, though that gate lets go', async (t) => {
  let w
  let asks = 0
  let prompts = 0
  w = await world(t, {
    ...CLAUDE,
    gates: [async () => {
      if (++asks !== 2) return undefined
      // Any prompt sent to this agent session from here on is counted.
      const run = w.adapter.live.get('s1').run
      const prompt = run.prompt.bind(run)
      run.prompt = (...args) => { prompts += 1; return prompt(...args) }
      w.adapter.endSession('s1', SENTENCE)
      return undefined
    }],
  })
  const c = w.chat('s1')
  c.say('unasked')
  onlySentence(await c.step())
  assert.equal(asks, 2)
  assert.equal(prompts, 0, 'no prompt was even tried')
  assert.deepEqual(w.events('prompt'), [])
  assert.equal(w.adapter.live.has('s1'), false)
  assert.equal(w.adapter.starting.size, 0)
})

test('no start is remembered past its step: after a consent refusal, a start failure, a refusal and a dispose the map is empty, and a healthy turn runs', async (t) => {
  let consent = 'Confirm the account first'
  let broken = true
  let w
  w = await world(t, {
    access: () => (typeof consent === 'function' ? consent() : consent),
    spec: { spawn: () => (broken ? { command: join(tmpdir(), 'acp-own-tools-no-such-binary') } : { command: process.execPath, args: [FAKE] }) },
  })
  const c = w.chat('s1')
  // The consent is missing: the step fails as it always did, and leaves nothing behind.
  c.say('plain')
  const refused = await c.step()
  assert.equal(refused.at(-1).reason.kind, 'error')
  assert.equal(w.adapter.starting.size, 0)
  assert.equal(w.adapter.endSession('s1', SENTENCE), false, 'nothing is starting there any more')
  // The agent cannot start: the same.
  consent = undefined
  c.say('plain')
  const failed = await c.step()
  assert.equal(failed.at(-1).reason.kind, 'error')
  assert.match(failed.at(-1).reason.failure.message, /did not start/)
  assert.equal(w.adapter.starting.size, 0)
  // A healthy turn runs, untouched by the two before it.
  broken = false
  c.say('plain')
  assert.match(textIn(await c.step()), /you said "plain"/)
  assert.equal(w.adapter.starting.size, 0)
  // A step abandoned by its consumer, and a dispose, leave nothing either.
  consent = () => new Promise(() => {})
  const stream = w.adapter.stream(markAgentLoopRequest({ provider: PROVIDER, model: 'default', sessionId: 's2', messages: [said('plain')] }))
  w.chat('s2')
  void stream.next()
  await waitFor(() => w.adapter.starting.has('s2'))
  w.adapter.dispose()
  assert.equal(w.adapter.starting.size, 0)
})
