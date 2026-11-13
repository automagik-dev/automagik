// The "level not applied" rule for a Bot on an ACP agent (Claude Code, Codex). The agent runs
// its own tools under its own mode, which the team's tools/execute guard never reaches, so the
// team also answers acp-dsh's turn gate (`acpAgents.holdTurns`) from the same mark, and ends
// the agent session of a Session the moment it is marked (`acpAgents.endSession`). Both only
// ever refuse. acp-dsh is a fake here: the gates it was given and the sessions it was told to end.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hardToUndo, parseVerdict, JUDGE_SYSTEM, installAhead } from '../src/host/auto-judge.js'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { Context } from '@deepseek-ai/cordis'
import * as approvals from '../src/host/approvals.js'
import { DshChatSource } from '../src/host/pocket-chat.js'

const FULL = 'danger-full-access'
const WRITE = 'workspace-write'
const STOCK = {
  [WRITE]: { sandbox: 'workspace-write', approval: 'ask' },
  [FULL]: { sandbox: 'danger-full-access', approval: 'never' },
}
const AUTO_SPEC = { sandbox: 'danger-full-access', approval: 'ask' }

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', name: 'ada', role: '', instructions: '', createdAt: 1 },
    b2: { id: 'b2', name: 'someone', role: '', instructions: '', createdAt: 2 },
  },
  rooms: { r1: { id: 'r1', name: 'x', named: true, members: ['m1', 'b2'], mode: 'everyone', notice: '', sessions: { m1: 'g1', b2: 'g2' }, seq: 0, log: [] } },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

// The whole team over a fake DSH presets service, as in permissions.test.js. `failing`
// holds the Sessions whose set throws; `sets` counts every set DSH was asked for.
function team(t, { acp = true, auto = true, bots = {}, room = {}, tasks, closed = [], presets = true, levels = {}, failing: failingAtStart = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-unapplied-agents-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ ...TEAM, bots: { m1: { ...TEAM.bots.m1, ...bots.m1 }, b2: { ...TEAM.bots.b2, ...bots.b2 } }, rooms: { r1: { ...TEAM.rooms.r1, ...room } }, ...(tasks ? { tasks } : {}) }))
  const presetOf = new Map(Object.entries(levels))
  const failing = new Set(failingAtStart)
  const sets = []
  const service = {
    auto,
    names: () => [...Object.keys(STOCK), ...(service.auto ? ['auto'] : [])],
    catalog: () => ({ options: service.names().map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: WRITE }),
    resolve: (name) => {
      if (!service.names().includes(name)) throw new Error(`permission: unknown preset "${name}"`)
      return name === 'auto' ? AUTO_SPEC : STOCK[name]
    },
    current: session => presetOf.get(session.id),
    set: (session, name) => {
      service.resolve(name)
      sets.push(`${session.id}=${name}`)
      if (failing.has(session.id)) throw new Error('permission: the Session log refused the write')
      presetOf.set(session.id, name)
    },
  }
  // acp-dsh's service, as the team sees it: the gates it registered, the sessions it ended.
  const gates = []
  const ended = []
  let answerer
  const acpAgents = {
    ownMode: answer => { answerer = answer; return () => { answerer = undefined } },
    ownModeOf: () => ({ mode: 'agent', bridged: false, answerer: answerer !== undefined }),
    ownModeIn: () => true,
    holdTurns: (gate) => { gates.push(gate); return () => { gates.splice(gates.indexOf(gate), 1) } },
    endSession: (sessionId, why) => { ended.push([sessionId, why]); return true },
  }
  const ctx = fakeContext({ services: { ...(presets ? { permissionPresets: service } : {}), ...(acp === true ? { acpAgents } : acp ? { acpAgents: acp } : {}) } })
  const open = new Set()
  const headers = {}
  let sessions = 0
  Object.assign(ctx, {
    workspaceRegistry: {
      get: () => ({ id: 'w1', path: home }),
      resolveByPath: async path => ({ id: 'w1', path }),
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      async resolveAgent(sessionId) {
        if (closed.includes(sessionId)) return { error: { code: 'gateway/internal', message: `resume failed for session "${sessionId}": Error: permission: cannot restore preset "auto" without its active integration` } }
        const session = { id: sessionId }
        if (!open.has(sessionId)) {
          open.add(sessionId)
          for (const listener of ctx.listeners.get('session/created') ?? []) void Promise.resolve(listener(session)).catch(() => {})
        }
        await new Promise(resolve => setTimeout(resolve, 1))
        return { agent: { session, followup() {} } }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => [...open].map(id => ({ id })), get: id => (headers[id] ? { header: headers[id] } : undefined) },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const rt = ctx.provided.get('omniTeam')
  t.mock.method(rt, 'warn', () => {})
  // Every refused call tries the apply again, unless a test spaces the tries out.
  rt.levelRetryMs = 0
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  // One tool call of a Session through the team's guard, the first tools/execute listener.
  // Resolves 'ran' when the tool's body was reached.
  const tool = (sessionId, { name = 'bash', header } = {}) => ctx.listeners.get('tools/execute')[0](
    { name, arguments: {}, agent: { id: sessionId, session: { id: sessionId, ...(header ? { header } : {}) } } },
    async () => 'ran',
  )
  // DSH opens a Session: its level is set again within the announce.
  const opens = async (sessionId) => {
    for (const listener of ctx.listeners.get('session/created') ?? []) void Promise.resolve(listener({ id: sessionId })).catch(() => {})
    await settle()
  }
  // acp-dsh asking the team before an agent acts for a Session.
  // Bounded: a gate that never answers fails its test, it does not hang the run.
  const turn = (sessionId, header) => {
    let timer
    const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('the gate did not answer in 10 s')), 10_000) })
    const answer = Promise.resolve().then(() => gates[0]({ sessionId, provider: 'acp-claude', agent: { id: sessionId, session: { id: sessionId, ...(header ? { header } : {}) } } }))
    return Promise.race([answer, late]).finally(() => clearTimeout(timer))
  }
  return { home, acpAgents, answer: id => answerer({ sessionId: id, agent: { session: { id } }, provider: 'acp-codex' }), ctx, rt, service, call, settle, failing, sets, headers, tool, opens, gates, ended, turn, levelOf: id => presetOf.get(id) }
}

async function world(t, model = 'deepseek/v4') {
  const w = team(t, { bots: { m1: { model, appliedModel: model } } })
  const replies = []; const requests = []; const failures = []; const stops = []
  w.ctx.llm = {
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }] } }),
    async* stream(request) {
      requests.push(request)
      const reply = await replies.shift()
      if (reply instanceof Error) throw reply
      yield { type: 'text-delta', index: 0, text: reply ?? '{"decision":"allow","reason":"needed"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  await w.rt.load()
  w.rt.cachedBackground = () => 'deepseek/v4'
  w.rt.backgroundModel = async () => 'deepseek/v4'
  w.rt.cachedCatalog = () => [{ ref: 'deepseek/v4', name: 'x' }]
  await w.rt.setBotAuto('m1', 0)
  const id = w.rt.chatOf('m1'); const events = []
  const session = { id, requestHeader: () => ({ config: { provider: model.split('/')[0], model: model.split('/').slice(1).join('/') } }), snapshotEvents: () => events }
  w.ctx.sessions.list = () => [session]
  const oldGet = w.ctx.get.bind(w.ctx)
  let sandbox = true
  w.ctx.get = key => key === 'sandboxPolicy' ? sandbox ? { resolve: () => ({ mode: WRITE }) } : undefined : oldGet(key)
  w.rt.noteFailure = row => failures.push(row)
  w.rt.noteStop = (...args) => stops.push(args)
  const exec = { name: 'bash', callId: 'x', agent: { session }, arguments: { command: 'ls', sandbox_permissions: FULL, justification: 'needed' } }
  // The judge's gate is the last unnamed tools/pre-execute listener: the two installed after it (the schedule tools'
  // ownTasksGate, computer use's computerGate) came with v0.3.6 and are named.
  const pre = w.ctx.listeners.get('tools/pre-execute').filter(listener => listener.name === '').at(-1)
  const request = () => ({ agent: exec.agent, toolName: 'bash', callId: exec.callId, reason: `escalate sandbox to ${FULL}: needed` })
  // The team's approval/request listeners as cordis runs them: all are prepended, so the newest runs first (Auto's judge, then
  // approvals.js; Pocket's is not installed here). `last` stands for DSH's own dialog: the person.
  const approve = (req, last = () => 'person') => {
    const hooks = [...w.ctx.listeners.get('approval/request')].reverse()
    const step = i => () => (i < hooks.length ? hooks[i](req, step(i + 1)) : last())
    return step(0)()
  }
  const decide = (req = request()) => approve(req)
  const run = (patch = {}) => pre({ ...exec, ...patch }, () => 'ran')
  return { ...w, session, events, replies, requests, failures, stops, exec, request, approve, decide, run, noSandbox: () => { sandbox = false } }
}
test('judge grants exactly one matching DSH escalation', async t => {
  const w = await world(t)
  assert.equal(await w.run(), 'ran')
  assert.equal(w.requests.length, 1)
  assert.equal(w.requests[0].purpose, 'compaction')
  assert.deepEqual(w.requests[0].tools, [])
  assert.equal(w.requests[0].model, 'v4')
  const granted = await approveEscalation({ requestedMode: FULL, effectiveMode: WRITE, justification: 'needed', subject: 'step' }, { approver: { request: w.decide }, agent: w.exec.agent, toolName: 'bash', callId: 'x' })
  assert.equal(granted, FULL)
  assert.equal(await w.decide(), 'person')
  for (const patch of [{ callId: 'someone' }, { toolName: 'write' }, { reason: 'x' }, { agent: { session: { id: 'someone' } } }]) {
    await w.run()
    assert.equal(await w.decide({ ...w.request(), ...patch }), 'person')
    w.rt.dropAutoGrants([w.session.id])
  }
  await w.run()
  for (const listener of w.ctx.listeners.get('tools/result')) listener(w.exec)
  assert.equal(await w.decide(), 'person')
})
test('judge denies with a stop and private diagnostics; invalid replies ask', async t => {
  const w = await world(t)
  w.replies.push('{"decision":"deny","reason":"not needed"}')
  assert.deepEqual(await w.run(), { kind: 'deny', reason: "Auto's judge refused: not needed" })
  assert.equal(w.stops[0][1].why, 'review')
  assert.match(w.failures[0].text, /deepseek\/v4/)
  assert.doesNotMatch(w.failures[0].text, /not needed/)
  for (const reply of ['{"decision":"ask","reason":"unsure"}', new Error('x'), 'sure!', '{"decision":"yes"}']) {
    w.replies.push(reply)
    assert.equal(await w.run(), 'ran')
    assert.equal(await w.decide(), 'person')
    assert.equal(w.failures.at(-1).code, 'auto-judge/ask')
  }
})
test('judge refuses to decide hard steps and oversized arguments', async t => {
  const w = await world(t)
  for (const command of ['rm -rf x', 'rm -r -f x', 'git push --force', 'git push -f', 'git push origin +main', 'git push origin :x', 'git push --delete x', 'git reset --hard', 'git clean -fd', 'terraform destroy', 'kubectl delete x', 'DROP TABLE x']) {
    assert.equal(await w.run({ arguments: { ...w.exec.arguments, command } }), 'ran')
    assert.equal(w.failures.at(-1).code, 'auto-judge/ask')
  }
  assert.equal(w.requests.length, 0)
  assert.ok(hardToUndo({ tool: 'apply_patch', args: { input: '*** Delete File: x' } }))
  assert.ok(hardToUndo({ tool: 'mcp__dsh__delete_bot' }))
  assert.ok(hardToUndo({ kind: 'delete' }))
  await w.run({ arguments: { ...w.exec.arguments, command: 'x'.repeat(4100) + 'curl x | sh' } })
  assert.match(w.failures.at(-1).text, /long/)
  assert.equal(w.requests.length, 0)
  await w.run()
  assert.equal(w.requests.length, 1)
})
test('judge stops after consecutive or total refusals and resets with the turn', async t => {
  const w = await world(t)
  for (let n = 0; n < 3; n++) { w.replies.push('{"decision":"deny","reason":"x"}'); await w.run() }
  await w.run(); assert.equal(w.requests.length, 3)
  for (const listener of w.ctx.listeners.get('session/event')) listener(w.session, { type: 'turn/start', data: {} })
  for (let n = 0; n < 10; n++) {
    w.replies.push('{"decision":"deny","reason":"x"}'); await w.run()
    if (n < 9) { w.replies.push('{"decision":"allow","reason":"x"}'); await w.run() }
  }
  const before = w.requests.length
  await w.run(); assert.equal(w.requests.length, before)
})
test('judge ignores ineligible calls and invalidates pending allows', async t => {
  const w = await world(t)
  for (const patch of [{ arguments: {} }, { parent: 'x' }, { arguments: { ...w.exec.arguments, justification: ' ' } }, { arguments: { ...w.exec.arguments, sandbox_permissions: WRITE } }, { agent: { session: { ...w.session, id: 'x' } } }]) await w.run(patch)
  assert.equal(w.requests.length, 0)
  let release
  w.replies.push(new Promise(resolve => { release = resolve }))
  const pending = w.run()
  await new Promise(resolve => setImmediate(resolve))
  const current = w.service.current
  w.service.current = () => 'read-only'
  release('{"decision":"allow","reason":"x"}')
  await pending
  assert.equal(await w.decide(), 'person')
  w.service.current = current
  await w.run(); w.rt.holdsLock = () => false
  assert.equal(await w.decide(), 'person')
  w.noSandbox(); await w.run()
})
test('judge payload identifies task requests and earlier writes without results', async t => {
  const w = await world(t)
  w.events.push({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'run x' }] } }, { type: 'tool/call', data: { name: 'write', callId: 'someone', arguments: '{"file_path":"x"}' } }, { type: 'tool/result', data: { text: 'never expose' } }, { type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'schedule' }, content: [{ type: 'text', text: 'schedule' }] } })
  await w.run({ arguments: { ...w.exec.arguments, command: 'node x' } })
  const payload = JSON.parse(w.requests[0].messages[0].content[0].text)
  assert.equal(payload.requests[0].from, 'chat')
  assert.deepEqual(payload.step.runsFilesItWrote, ['x'])
  assert.doesNotMatch(JSON.stringify(payload), /never expose|schedule/)
  assert.match(JUDGE_SYSTEM, /another Bot wrote/)
})
for (const model of ['acp-hermes/default', 'acp-claude/default']) test(`judge mirror and bridge decisions on ${model}`, async t => {
  const w = await world(t, model)
  const mirror = model.startsWith('acp-hermes')
  w.events.push({ type: 'tool/call', data: { callId: 'x', name: 'bash', arguments: '{"command":"echo first"}' } })
  const request = { ...w.request(), toolName: mirror ? 'acp_tool' : 'bash', ...(mirror ? { mirrorCall: { title: 'bash', kind: 'execute', input: { command: 'echo second' }, allowOnce: true } } : { bridgeCall: { agentAsked: false } }) }
  assert.equal(await w.decide(request), 'allowed-once')
  assert.deepEqual(w.rt.approvalsView(), [])
  if (mirror) assert.match(w.requests[0].messages[0].content[0].text, /echo second/)
  w.replies.push('{"decision":"deny","reason":"not needed"}')
  assert.equal(await w.decide(request), 'rejected')
  assert.equal((mirror ? request.mirrorCall : request.bridgeCall).judged.reason, 'not needed')
  const before = w.requests.length
  if (mirror) request.mirrorCall.allowOnce = false
  else request.bridgeCall.agentAsked = true
  const pending = w.decide(request)
  assert.equal(w.rt.approvalsView().length, 1)
  assert.equal(await pending, 'person')
  assert.equal(w.requests.length, before)
})
test('judge marks are exact and route offers name the decider', async t => {
  const w = await world(t)
  const bot = w.rt.botOf('m1')
  assert.equal(bot.permissionAuto, 'api:deepseek/v4')
  assert.deepEqual(w.rt.autoViewOf(bot).autoJudge, { by: 'own', bridged: false, model: 'x' })
  bot.model = 'deepseek/v5'
  await w.run(); assert.equal(w.requests.length, 0)
  await w.rt.save()
  assert.equal(bot.permissionAuto, undefined)
  assert.equal(JSON.parse(readFileSync(join(w.home, 'state.json'), 'utf8')).bots.m1.permissionAuto, undefined)
})
test('judge verdict parsing accepts only the three decisions', () => {
  assert.deepEqual(parseVerdict('```json\n{"decision":"deny","reason":" x  x "}\n```'), { decision: 'deny', reason: 'x x' })
  assert.equal(parseVerdict('{"decision":"deny","reason":" "}'), undefined)
  assert.equal(parseVerdict('sure!'), undefined)
})

test('an unmarked route switch makes the old Auto confirmation stale', async t => {
  const w = team(t, { bots: { m1: { model: 'deepseek/v4', appliedModel: 'deepseek/v4' } } })
  await w.rt.load()
  w.rt.resolveModel = async ref => ref
  w.rt.applyModel = async bot => { bot.appliedModel = bot.model }
  const bot = w.rt.botOf('m1')
  const rev = bot.permissionRev ?? 0
  const response = await w.call('update-bot', { id: 'm1', model: 'acp-codex/default' })
  assert.equal(response.ok, true)
  assert.equal(bot.model, 'acp-codex/default')
  assert.equal(bot.permissionRev, rev + 1)
  await assert.rejects(w.rt.setBotAuto('m1', rev), /changed meanwhile/)
  assert.equal(bot.permissionAuto, undefined)
})

for (const kind of ['group', 'task without record', 'earlier part', 'subagent', 'unmarked']) test(`judge leaves ${kind} to the person without a model call`, async t => {
  const w = await world(t)
  const bot = w.rt.botOf('m1')
  const session = { ...w.session, id: kind === 'group' ? 'g1' : kind === 'unmarked' ? w.session.id : 'x' }
  w.service.set(session, WRITE)
  if (kind === 'task without record' || kind === 'subagent') {
    w.rt.state.tasks ??= {}
    w.rt.state.tasks.x = { from: 'm1', status: 'working', ...(kind === 'subagent' ? { auto: bot.permissionAuto, autoRev: bot.permissionRev, levelTaskId: 'someone' } : {}) }
  }
  if (kind === 'earlier part') {
    bot.segments = [{ sessionId: 'x', endedAt: 1 }]
    assert.equal(w.rt.partsOf(bot.id)[0].sessionId, 'x')
  }
  if (kind === 'unmarked') delete bot.permissionAuto
  const agent = { session }
  assert.equal(await w.run({ agent }), 'ran')
  const pending = w.decide({ ...w.request(), agent })
  if (kind === 'group') {
    const [entry] = w.rt.approvalsView()
    assert.equal(entry.sessionId, session.id)
    w.rt.answerApproval(entry.id, 'reject')
    assert.equal(await pending, 'rejected')
  } else assert.equal(await pending, 'person')
  assert.equal(w.requests.length, 0)
})

for (const kind of ['no bridgeCall', 'strict', 'unmarked', 'own mirror']) test(`Claude ${kind} asks the person without a model call`, async t => {
  const w = await world(t, 'acp-claude/default')
  w.events.push({ type: 'tool/call', data: { callId: 'x', name: 'bash', arguments: '{"command":"ls"}' } })
  const request = { ...w.request(), bridgeCall: { agentAsked: false } }
  if (kind === 'no bridgeCall') delete request.bridgeCall
  if (kind === 'strict') w.acpAgents.ownModeIn = () => false
  if (kind === 'unmarked') delete w.rt.botOf('m1').permissionAuto
  if (kind === 'own mirror') Object.assign(request, { toolName: 'acp_tool', mirrorCall: { title: 'bash', input: { command: 'ls' }, allowOnce: true } })
  assert.equal(await w.decide(request), 'person')
  assert.equal(w.requests.length, 0)
})
test('Claude returning to strict mode while the judge replies asks the person', async t => {
  const w = await world(t, 'acp-claude/default')
  w.events.push({ type: 'tool/call', data: { callId: 'x', name: 'bash', arguments: '{"command":"ls"}' } })
  let release
  w.replies.push(new Promise(resolve => { release = resolve }))
  let personSaw = false
  const pending = w.approve({ ...w.request(), bridgeCall: { agentAsked: false } }, () => { personSaw = w.rt.approvalsView().length === 1; return 'person' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(w.requests.length, 1)
  w.acpAgents.ownModeIn = () => false
  release('{"decision":"allow","reason":"needed"}')
  assert.equal(await pending, 'person')
  assert.equal(personSaw, true)
})

test('Hermes without mirrorCall asks the person without a model call', async t => {
  const w = await world(t, 'acp-hermes/default')
  assert.equal(await w.decide({ ...w.request(), toolName: 'acp_tool' }), 'person')
  assert.equal(w.requests.length, 0)
})
test('Hermes preset changing while the judge replies leaves a person approval', async t => {
  const w = await world(t, 'acp-hermes/default')
  let release
  w.replies.push(new Promise(resolve => { release = resolve }))
  let personSaw = false
  const pending = w.approve({ ...w.request(), toolName: 'acp_tool', mirrorCall: { title: 'bash', input: { command: 'ls' }, allowOnce: true } }, () => { personSaw = w.rt.approvalsView().length === 1; return 'person' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(w.requests.length, 1)
  w.service.current = () => 'read-only'
  release('{"decision":"allow","reason":"needed"}')
  assert.equal(await pending, 'person')
  assert.equal(personSaw, true)
})

test('judge timeout passes to the person with one ask diagnostic', async t => {
  const w = await world(t)
  w.rt.autoJudgeMs = 20
  w.ctx.llm.stream = async function* (request) {
    w.requests.push(request)
    await new Promise((resolve, reject) => {
      const keepAlive = setTimeout(resolve, 1000)
      request.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(request.signal.reason) }, { once: true })
    })
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  assert.equal(await w.run(), 'ran')
  assert.equal(await w.decide(), 'person')
  assert.equal(w.requests.length, 1)
  assert.deepEqual(w.failures.map(row => row.code), ['auto-judge/ask'])
})

test('counting inherited task labels instructions as task and excludes bot rows', async t => {
  const w = await world(t)
  const bot = w.rt.botOf('m1')
  w.rt.state.tasks ??= {}
  w.rt.state.tasks.x = { from: bot.id, status: 'working', auto: bot.permissionAuto, autoRev: bot.permissionRev }
  const session = { ...w.session, id: 'x' }
  w.service.set(session, WRITE)
  w.events.push(...['user', 'bot', 'schedule'].map(kind => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text: kind === 'user' ? 'run x' : kind }] } })))
  assert.equal(await w.run({ agent: { session } }), 'ran')
  assert.equal(w.requests.length, 1)
  const payload = JSON.parse(w.requests[0].messages[0].content[0].text)
  assert.deepEqual(payload.requests, [{ from: 'task', text: 'run x' }])
  assert.match(JUDGE_SYSTEM, /another Bot wrote/)
})

test('judge denial needs no noteStop and records the deny code', async t => {
  const w = await world(t)
  delete w.rt.noteStop
  w.replies.push('{"decision":"deny","reason":"not needed"}')
  assert.deepEqual(await w.run(), { kind: 'deny', reason: "Auto's judge refused: not needed" })
  assert.deepEqual(w.failures.map(row => row.code), ['auto-judge/deny'])
})
test('missing sandboxPolicy makes no model call', async t => {
  const w = await world(t)
  w.noSandbox()
  assert.equal(await w.run(), 'ran')
  assert.equal(await w.decide(), 'person')
  assert.equal(w.requests.length, 0)
})

test('Hermes is offered only with a background model and bridged Claude is offered', async t => {
  const w = await world(t, 'acp-hermes/default')
  const bot = w.rt.botOf('m1')
  assert.equal(bot.permissionAuto, 'acp-hermes')
  assert.equal(w.rt.autoOffer(bot).offered, true)
  assert.deepEqual(w.rt.autoViewOf(bot).autoJudge, { by: 'team', bridged: false, model: 'x' })
  w.rt.cachedBackground = () => undefined
  assert.equal(w.rt.autoOffer(bot).offered, false)
  const claude = await world(t, 'acp-claude/default')
  claude.acpAgents.ownModeOf = () => ({ mode: 'auto', answerer: true, bridged: true })
  assert.equal(claude.rt.botOf('m1').permissionAuto, 'acp-claude')
  assert.equal(claude.rt.autoOffer(claude.rt.botOf('m1')).offered, true)
  assert.deepEqual(claude.rt.autoViewOf(claude.rt.botOf('m1')).autoJudge, { by: 'claude', bridged: true, model: 'x' })
})

const inCall = (w, name, body) => {
  const exec = { name, arguments: {}, agent: { id: w.session.id, session: w.session } }
  const hooks = [...w.ctx.listeners.get('tools/execute')]
  const next = i => () => i < hooks.length ? hooks[i](exec, next(i + 1)) : body(exec)
  return next(0)()
}
test('update_bot to another API model clears the exact mark', async t => {
  const w = await world(t)
  w.rt.resolveModel = async ref => ref
  w.rt.applyModel = async bot => { bot.appliedModel = bot.model }
  const result = await inCall(w, 'update_bot', exec => w.ctx.registeredTools.get('update_bot').execute({ model: 'deepseek/v5' }, exec))
  assert.equal(result, 'Updated ada.')
  assert.equal(w.rt.botOf('m1').model, 'deepseek/v5')
  assert.equal(w.rt.botOf('m1').permissionAuto, undefined)
  assert.equal(JSON.parse(readFileSync(join(w.home, 'state.json'), 'utf8')).bots.m1.permissionAuto, undefined)
})
test('start_task inherits API Auto without ownModeIn', async t => {
  const w = await world(t)
  delete w.acpAgents.ownModeIn
  const id = await inCall(w, 'start_task', () => w.rt.startTask({ title: 'x', text: 'run x', from: 'm1' }))
  await w.settle()
  assert.equal(w.rt.state.tasks[id].auto, 'api:deepseek/v4')
  assert.equal(w.rt.state.tasks[id].autoRev, w.rt.botOf('m1').permissionRev)
})
for (const model of ['deepseek/v4', 'deepseek/v5']) test(`create_bot inherits API Auto only on the exact model: ${model}`, async t => {
  const w = await world(t)
  w.ctx.llm.listProviders = () => [{ id: 'deepseek', name: 'x' }]
  w.ctx.llm.listModels = async () => [{ id: 'v4' }, { id: 'v5' }]
  const result = await inCall(w, 'create_bot', exec => w.ctx.registeredTools.get('create_bot').execute({ name: 'x', role: 'x', instructions: 'x', model }, { ...exec, callId: 'x', signal: new AbortController().signal }))
  assert.match(result, /^Created x/)
  const bot = w.rt.findBot('x')
  assert.equal(bot.model, model)
  const expected = model === 'deepseek/v4' ? 'api:deepseek/v4' : undefined
  assert.equal(bot.permissionAuto, expected)
  assert.equal(JSON.parse(readFileSync(join(w.home, 'state.json'), 'utf8')).bots[bot.id].permissionAuto, expected)
})

for (const [name, decide, judged] of [
  ['a grant', () => 'allowed-once', 'allowed-once'],
  ['a refusal', () => Promise.resolve('rejected'), 'rejected'],
  ['an ask', () => Promise.resolve(undefined), undefined],
  ['no judging', () => undefined, undefined],
  ['a judge that fails', () => Promise.reject(new Error('x')), undefined],
]) test(`Pocket and the computer's card see only what the judge passes on: ${name}`, async () => {
  const ctx = new Context()
  const phone = []
  const rt = { ctx, groupOwners: new Map(), chatOwners: new Map([['x', 'ada']]), state: { tasks: {} }, botOf: id => (id === 'ada' ? { id: 'ada' } : undefined), noteApproval() {}, callDetail: () => ({}), autoDecide: decide }
  approvals.install(rt)
  const source = new DshChatSource({ adapter: { prompt() {}, cancel() {} }, bots: async () => [], writable: true, chatOwner: id => rt.chatOwners.get(id) })
  source.entries.set('ada', { botId: 'ada', sessionId: 'x', gone: false, cursor: 0, scope: { turn: 1, calls: new Map() }, rows: [], listeners: new Set([event => phone.push(event)]) })
  // In the order createRuntime installs them: approvals.js, Pocket's race (pocket-chat.js install), then the judge.
  ctx.on('approval/request', (request, next) => source.raceApproval(request, next), { prepend: true })
  installAhead(rt)
  let cards = -1
  const outcome = await ctx.waterfall('approval/request', { agent: { id: 'x', session: { id: 'x' } }, toolName: 'acp_tool', callId: 'x', reason: 'x', signal: new AbortController().signal }, () => { cards = rt.approvalsView().length; return 'person' })
  if (judged) {
    assert.equal(outcome, judged)
    assert.deepEqual(phone, [])
    assert.equal(cards, -1)
  } else {
    assert.equal(outcome, 'person')
    assert.equal(phone[0]?.row?.answerable, true)
    assert.equal(cards, 1)
  }
  assert.deepEqual(rt.approvalsView(), [])
})

test("the team's lookups pass Auto's judge untouched", async t => {
  const w = await world(t, 'acp-claude/default')
  w.events.push({ type: 'tool/call', data: { callId: 'x', name: 'mcp__dsh__list_bots', arguments: '{}' } })
  assert.equal(await w.decide({ ...w.request(), toolName: 'mcp__dsh__list_bots', bridgeCall: { agentAsked: false } }), 'allowed-once')
  assert.equal(w.requests.length, 0)
})

test('hardToUndo reads argv commands and titles', () => {
  assert.ok(hardToUndo({ tool: 'x', args: { command: ['rm', '-rf', 'x'] } }))
  assert.ok(hardToUndo({ tool: 'x', args: { command: ['git', 'push', '--force'] } }))
  assert.ok(hardToUndo({ tool: 'git push -f origin main', args: null }))
  assert.ok(hardToUndo({ tool: 'rm -rf x', args: null }))
  assert.equal(hardToUndo({ tool: 'x', args: { command: ['ls', '-la'] } }), false)
  assert.equal(hardToUndo({ tool: 'bash', args: { command: 'ls' } }), false)
})

test('hard steps reach the person through the judge without a model call', async t => {
  const hermes = await world(t, 'acp-hermes/default')
  for (const mirrorCall of [
    { title: 'x', kind: 'delete', input: {}, allowOnce: true },
    { title: 'rm -rf x', kind: 'execute', input: null, allowOnce: true },
    { title: 'x', kind: 'execute', input: { command: ['rm', '-rf', 'x'] }, allowOnce: true },
  ]) assert.equal(await hermes.decide({ ...hermes.request(), toolName: 'acp_tool', mirrorCall }), 'person', JSON.stringify(mirrorCall))
  assert.equal(hermes.requests.length, 0)
  assert.equal(await hermes.decide({ ...hermes.request(), toolName: 'acp_tool', mirrorCall: { title: 'x', kind: 'execute', input: { command: ['ls'] }, allowOnce: true } }), 'allowed-once')
  assert.equal(hermes.requests.length, 1)
  const claude = await world(t, 'acp-claude/default')
  claude.events.push({ type: 'tool/call', data: { callId: 'x', name: 'bash', arguments: '{"command":"rm -rf x"}' } })
  assert.equal(await claude.decide({ ...claude.request(), bridgeCall: { agentAsked: false } }), 'person')
  assert.equal(claude.requests.length, 0)
})

for (const model of ['acp-hermes/default', 'acp-claude/default']) test(`ask and failed verdicts reach the person on ${model}`, async t => {
  const w = await world(t, model)
  const mirror = model.startsWith('acp-hermes')
  w.events.push({ type: 'tool/call', data: { callId: 'x', name: 'bash', arguments: '{"command":"echo first"}' } })
  for (const reply of ['{"decision":"ask","reason":"x"}', new Error('x'), 'sure!']) {
    const fresh = { ...w.request(), toolName: mirror ? 'acp_tool' : 'bash', ...(mirror ? { mirrorCall: { title: 'bash', kind: 'execute', input: { command: 'echo second' }, allowOnce: true } } : { bridgeCall: { agentAsked: false } }) }
    const calls = w.requests.length
    w.replies.push(reply)
    let personSaw = false
    assert.equal(await w.approve(fresh, () => { personSaw = w.rt.approvalsView().length === 1; return 'person' }), 'person')
    assert.equal(personSaw, true)
    assert.equal(w.requests.length, calls + 1)
  }
})
