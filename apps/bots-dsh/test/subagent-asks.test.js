import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { ApprovalService, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { install as stops } from '../src/host/stops.js'
import { install as approvals } from '../src/host/approvals.js'
import { install, CHILD_ASKS_CONTEXT } from '../src/host/subagent-asks.js'
import { install as turns, detailOfArgs } from '../src/host/turns.js'

const WRITE = 'workspace-write'
const FULL = 'danger-full-access'
async function bench(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ApprovalService)
  const approval = ctx.get('approval')
  const sessions = ctx.get('sessions')
  const levels = new Map()
  const modes = new Map()
  const sets = []
  const sandboxWrites = []
  const warnings = []
  const yielded = []
  const contexts = []
  const specs = { 'read-only': { sandbox: 'read-only', approval: 'ask' }, [WRITE]: { sandbox: WRITE, approval: 'ask' }, [FULL]: { sandbox: FULL, approval: 'never' }, auto: { sandbox: FULL, approval: 'ask' } }
  const sandbox = { defaultMode: WRITE, overrideOf: session => modes.get(session.id) }
  const presets = {
    current: session => levels.get(session.id) ?? 'custom',
    resolve: level => { if (!specs[level]) throw new Error('unknown level'); return specs[level] },
    set: (session, level) => {
      const spec = presets.resolve(level)
      sets.push([session.id, level])
      levels.set(session.id, level)
      if (spec.sandbox !== (sandbox.overrideOf(session) ?? sandbox.defaultMode)) {
        sandboxWrites.push([session.id, spec.sandbox])
        modes.set(session.id, spec.sandbox)
      }
      if (approval.overrideOf(session) !== spec.approval) setApprovalPolicy(session, spec.approval)
    },
  }
  ctx.provide('permissionPresets', presets)
  ctx.provide('sandboxPolicy', sandbox)
  ctx.provide('systemPrompt', { context: entry => { contexts.push(entry); return () => {} } })
  const rt = {
    ctx, state: { tasks: {}, questions: {}, exchangeTurns: {} }, chatOwners: new Map([['ada-chat', 'ada']]), groupOwners: new Map(), taskOwners: new Map(), pastOwners: new Map(),
    botOf: id => id === 'ada' ? { id, name: 'ada' } : undefined,
    load: async () => {}, warn: (...args) => warnings.push(args), noteFailure: () => {},
    yieldRoomTurn: id => yielded.push(id),
    isBotSession: id => rt.chatOwners.has(id) || rt.groupOwners.has(id) || rt.taskOwners.has(id),
    roomOf: () => undefined,
    selfOf: id => rt.chatOwners.get(id) ?? rt.groupOwners.get(id)?.botId ?? rt.taskOwners.get(id)?.botId,
    save: async () => {}, deliver: async () => {}, switchJobs: () => [], dropKickoff: () => {},
  }
  turns(rt)
  stops(rt)
  approvals(rt)
  install(rt)
  const parent = (id = 'ada-chat', level = WRITE, policy = specs[level]?.approval ?? 'ask') => {
    const session = sessions.create(id)
    levels.set(id, level)
    modes.set(id, specs[level]?.sandbox ?? WRITE)
    setApprovalPolicy(session, policy)
    return session
  }
  const created = (session, source = 'startup') => ctx.serial('agent/created', { agent: { id: session.id, session }, source })
  const child = async (id = 'child', parentSession = 'ada-chat', { level, mode = modes.get(parentSession), source = 'startup' } = {}) => {
    const session = sessions.create(id, { meta: { origin: 'subagent', parentSession } })
    modes.set(id, mode)
    if (level) levels.set(id, level)
    setApprovalPolicy(session, 'never')
    await created(session, source)
    return session
  }
  const ask = (session, callId = 'x', signal) => {
    session.append('turn/start', { turn: 1 })
    return approval.request({ agent: { session }, toolName: 'bash', callId, reason: 'someone', signal })
  }
  const held = async (session, callId = 'x', signal) => {
    const answer = ask(session, callId, signal)
    await new Promise(resolve => setImmediate(resolve))
    const entry = rt.approvalsView().find(item => item.sessionId === session.id)
    assert.ok(entry, 'the ask must be held before DSH fallback')
    return { answer, entry }
  }
  const context = session => contexts[0].text({ agent: { id: session.id, session } })
  return { ctx, rt, sessions, approval, levels, modes, sets, sandboxWrites, presets, warnings, yielded, contexts, parent, child, created, ask, held, context }
}

test('a Workspace chat child asks its person, and their allow or reject is no stop', async t => {
  const b = await bench(t)
  b.parent()
  const child = await b.child()
  assert.deepEqual(b.sets, [['child', WRITE]])
  assert.equal(b.approval.overrideOf(child), 'ask')
  assert.deepEqual(b.sandboxWrites, [])
  const first = await b.held(child)
  assert.deepEqual([first.entry.botId, first.entry.child, first.entry.ownerSessionId, first.entry.answerable], ['ada', true, 'ada-chat', true])
  b.rt.answerApproval(first.entry.id, 'allow')
  assert.equal(await first.answer, 'allowed-once')
  assert.deepEqual(b.rt.approvalsView(), [])
  const second = await b.held(child, 'y')
  b.rt.answerApproval(second.entry.id, 'reject')
  assert.equal(await second.answer, 'rejected')
  assert.deepEqual(b.rt.stopsView(), [])
})

test('incomparable, never and changed captures keep DSH’s never pin', async t => {
  for (const [level, policy, capture] of [
    [FULL, 'never', { level: FULL }], ['custom', 'ask', {}], ['unknown', 'ask', {}],
    [WRITE, 'never', {}], [WRITE, 'ask', { mode: 'read-only' }],
    ['auto', 'ask', { level: FULL, mode: FULL }],
  ]) await t.test(`${level} ${policy} ${JSON.stringify(capture)}`, async t => {
    const b = await bench(t)
    b.parent('ada-chat', level, policy)
    const child = await b.child('child', 'ada-chat', capture)
    assert.deepEqual(b.sets, [])
    assert.equal(await b.ask(child), 'rejected')
    assert.deepEqual(b.rt.stopsView().map(e => [e.why, e.child]), [['never', true]])
  })
})

test('Auto review and Read only parents keep their level without a sandbox write', async t => {
  for (const level of ['auto', 'read-only']) await t.test(level, async t => {
    const b = await bench(t)
    b.parent('ada-chat', level)
    const child = await b.child('child', 'ada-chat', { level: level === 'auto' ? level : undefined })
    assert.deepEqual(b.sets, [['child', level]])
    assert.equal(b.approval.overrideOf(child), 'ask')
    assert.deepEqual(b.sandboxWrites, [])
  })
})

test('a grandchild keeps the switched level and asks through the original chat', async t => {
  const b = await bench(t)
  b.parent()
  await b.child()
  const child = await b.child('grandchild', 'child')
  assert.deepEqual(b.sets, [['child', WRITE], ['grandchild', WRITE]])
  const held = await b.held(child)
  assert.equal(held.entry.ownerSessionId, 'ada-chat')
  b.rt.answerApproval(held.entry.id, 'allow')
  assert.equal(await held.answer, 'allowed-once')
})

test('owners without an answering surface keep never, and forced asks cancel with a stop', async t => {
  for (const kind of ['run', 'part', 'task', 'hook']) await t.test(kind, async t => {
    const b = await bench(t)
    b.parent('x')
    if (kind === 'run') b.rt.taskOwners.set('x', { botId: 'ada' })
    if (kind === 'part') b.rt.pastOwners.set('x', { botId: 'ada' })
    if (kind === 'task') b.rt.state.tasks.x = { from: 'ada', status: 'done', title: 'someone' }
    if (kind === 'hook') b.rt.extended = { sessionOwner: id => id === 'x' ? { botId: 'ada' } : undefined }
    const child = await b.child('child', 'x')
    assert.deepEqual(b.sets, [])
    assert.equal(await b.ask(child), 'rejected')
    setApprovalPolicy(child, 'ask')
    assert.equal(b.context(child), '')
    assert.equal(await b.ask(child, 'y'), 'cancelled')
    assert.deepEqual(b.rt.approvalsView(), [])
    assert.deepEqual(b.rt.stopsView().map(e => e.why), ['never', 'unavailable'])
  })
})

test('a switched child fails closed if its Bot or a middle Session disappears', async t => {
  for (const gone of ['bot', 'middle']) await t.test(gone, async t => {
    const b = await bench(t)
    b.parent()
    const middle = await b.child()
    const child = gone === 'middle' ? await b.child('grandchild', 'child') : middle
    if (gone === 'bot') b.rt.botOf = () => undefined
    else {
      const get = b.sessions.get.bind(b.sessions)
      t.mock.method(b.sessions, 'get', id => id === 'child' ? undefined : get(id))
    }
    assert.equal(b.context(child), '')
    let next = 0
    b.ctx.on('approval/request', (_request, proceed) => { next++; return proceed() })
    assert.equal(await b.ask(child), 'cancelled')
    assert.equal(next, 0)
    assert.deepEqual(b.rt.approvalsView(), [])
    assert.equal(b.warnings.length, 1)
  })
})

test('two held children are independent, with their own commands, and an abort cancels only its own ask', async t => {
  const b = await bench(t)
  b.parent()
  const a = await b.child('a')
  const c = await b.child('c')
  a.append('tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"ls x"}' })
  c.append('tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"cat x"}' })
  const abort = new AbortController()
  const first = await b.held(a, 'x', abort.signal)
  const second = await b.held(c)
  assert.equal(first.entry.detail.code, 'ls x')
  assert.equal(second.entry.detail.code, 'cat x')
  assert.equal(b.rt.approvalsView().length, 2)
  abort.abort()
  assert.equal(await first.answer, 'cancelled')
  assert.deepEqual(b.rt.approvalsView().map(e => e.id), [second.entry.id])
  b.rt.answerApproval(second.entry.id, 'reject')
  assert.equal(await second.answer, 'rejected')
  assert.equal(await b.ask(a, 'y', abort.signal), 'cancelled')
  assert.deepEqual(b.rt.approvalsView(), [])
})

test('group children yield and cancel through their seat; task children carry its title', async t => {
  const b = await bench(t)
  b.parent('seat')
  b.rt.groupOwners.set('seat', { botId: 'ada', roomId: 'room' })
  const seat = await b.child('child', 'seat')
  const group = await b.held(seat)
  assert.equal(group.entry.roomId, 'room')
  assert.deepEqual(b.yielded, ['seat'])
  assert.equal(b.rt.waitsForApproval('seat'), true)
  b.rt.cancelApprovals('seat')
  assert.equal(await group.answer, 'cancelled')
  assert.equal(b.rt.waitsForApproval('seat'), false)
  b.parent('task')
  b.rt.state.tasks.task = { from: 'ada', status: 'working', title: ' someone ' }
  const task = await b.held(await b.child('task-child', 'task'))
  assert.deepEqual([task.entry.taskId, task.entry.label, task.entry.ownerSessionId], ['task', 'someone', 'task'])
  b.rt.cancelApprovals('task')
  assert.equal(await task.answer, 'cancelled')
})

test('context and call details cover ordinary calls and each program sub-call', async t => {
  const b = await bench(t)
  const parent = b.parent()
  const child = await b.child()
  const never = await b.child('never', 'ada-chat', { mode: 'read-only' })
  assert.equal(b.contexts[0].order, 121)
  assert.equal(b.contexts[0].interpolate, false)
  assert.equal(b.context(child), CHILD_ASKS_CONTEXT)
  assert.equal(b.context(parent), '')
  assert.equal(b.context(never), '')
  for (const [type, data, callId, code] of [
    ['tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"ls x"}' }, 'x', 'ls x'],
    ['tool/ptc-dispatch-start', { subCallId: 'x:ptc:1', name: 'bash', arguments: { command: 'ls x' } }, 'x:ptc:1', 'ls x'],
    ['tool/ptc-dispatch-start', { subCallId: 'x:ptc:2', name: 'bash', arguments: { command: 'cat x' } }, 'x:ptc:2', 'cat x'],
  ]) {
    child.append(type, data)
    const held = await b.held(child, callId)
    assert.equal(held.entry.detail.code, code)
    b.rt.answerApproval(held.entry.id, 'allow')
    assert.equal(await held.answer, 'allowed-once')
  }
  parent.append('tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"ls ada"}' })
  assert.deepEqual(b.rt.callDetail('ada-chat', 'x'), { code: 'ls ada' })
  assert.equal(b.rt.childCallDetail('ada-chat', 'x'), undefined)
  never.append('tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"ls x"}' })
  assert.equal(b.rt.childCallDetail('never', 'x'), undefined)
  assert.equal(b.rt.childCallDetail(child.id, 'x:ptc:1').code, 'ls x')
  assert.equal(b.rt.childCallDetail(child.id, 'x:ptc:2').code, 'cat x')
  for (const key of ['command', 'cmd', 'file_path', 'path', 'url', 'query']) assert.deepEqual(detailOfArgs(JSON.stringify({ [key]: ' x ', justification: ' someone ' })), { text: 'someone', code: 'x' })
  assert.deepEqual(detailOfArgs('{'), {})
  assert.deepEqual(detailOfArgs(JSON.stringify({ description: 'x'.repeat(301), command: 'x'.repeat(401) })), { text: 'x'.repeat(300), code: 'x'.repeat(400) })
})

test('a child at ask that this instance never switched still shows its command and context', async t => {
  const b = await bench(t)
  b.parent()
  const child = b.sessions.create('reloaded', { meta: { origin: 'subagent', parentSession: 'ada-chat' } })
  setApprovalPolicy(child, 'ask')
  assert.equal(b.rt.asksThroughBot('reloaded'), false)
  assert.equal(b.context(child), CHILD_ASKS_CONTEXT)
  child.append('tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"ls x"}' })
  const held = await b.held(child)
  assert.equal(held.entry.detail.code, 'ls x')
  b.rt.answerApproval(held.entry.id, 'allow')
  assert.equal(await held.answer, 'allowed-once')
  const moved = await b.child('moved', 'ada-chat', { mode: 'read-only' })
  assert.deepEqual(b.sets, [])
  setApprovalPolicy(moved, 'ask')
  moved.append('tool/call', { callId: 'x', name: 'bash', arguments: '{"command":"cat x"}' })
  const movedHeld = await b.held(moved)
  assert.equal(movedHeld.entry.detail.code, 'cat x')
  b.rt.answerApproval(movedHeld.entry.id, 'reject')
  assert.equal(await movedHeld.answer, 'rejected')
})

test('a resumed child already at ask is tracked again without a write', async t => {
  const b = await bench(t)
  b.parent()
  const child = b.sessions.create('resumed', { meta: { origin: 'subagent', parentSession: 'ada-chat' } })
  setApprovalPolicy(child, 'ask')
  await b.created(child, 'resume')
  assert.deepEqual(b.sets, [])
  assert.equal(b.rt.asksThroughBot('resumed'), true)
  assert.equal(b.context(child), CHILD_ASKS_CONTEXT)
  b.rt.botOf = () => undefined
  let next = 0
  b.ctx.on('approval/request', (_request, proceed) => { next++; return proceed() })
  assert.equal(await b.ask(child), 'cancelled')
  assert.equal(next, 0)
})

test('creation failures are contained and a resumed never child is never switched', async t => {
  const b = await bench(t)
  b.parent()
  const set = b.presets.set
  b.presets.set = () => { throw new Error('someone') }
  const failed = await b.child('failed')
  assert.equal(b.approval.overrideOf(failed), 'never')
  assert.equal(b.warnings.length, 1)
  assert.match(b.warnings[0][0], /subagent level on agent\/created failed/)
  b.presets.set = set
  const child = await b.child()
  setApprovalPolicy(child, 'never')
  assert.equal(b.context(child), '', 'live policy check before resume')
  const count = b.sets.length
  await b.created(child, 'resume')
  await b.child('resumed', 'ada-chat', { source: 'resume' })
  assert.equal(b.sets.length, count)
  assert.equal(b.approval.overrideOf(child), 'never')
  assert.equal(b.context(child), '')
  const asking = await b.child('asking')
  await b.created(asking, 'resume')
  assert.equal(b.sets.length, count + 1)
  assert.equal(b.context(asking), CHILD_ASKS_CONTEXT)
  let loads = 0
  b.rt.load = async () => { loads++ }
  await b.created(b.sessions.get('ada-chat'))
  assert.equal(loads, 0)
  assert.equal(b.warnings.length, 1)
})
