import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/approvals.js'

// The approval listener, with the team state it reads: a running task a Bot started, the
// Bots' own chats, and hidden group Sessions.
function bench({ tasks = {}, chats = [], groups = [], runs = [] } = {}) {
  const handlers = []
  const noted = []
  const disposers = []
  const stops = []
  const rt = {
    ctx: { on: (event, handler) => handlers.push({ event, handler }), effect: fn => disposers.push(fn()) },
    state: { tasks },
    groupOwners: new Map(groups),
    chatOwners: new Map(chats),
    botOf: id => (['genie', 'writer', 'ada'].includes(id) ? { id } : undefined),
    teamOwnerOf: id => new Map(runs).get(id),
    warn: () => {},
    noteStop: (...args) => stops.push(args),
    noteApproval: (sessionId, note) => noted.push([sessionId, note]),
    callDetail: () => ({ text: 'bun test', code: 'bun test' }),
    yieldRoomTurn: () => {},
  }
  install(rt)
  return { rt, handlers, noted, disposers, stops }
}

const request = (sessionId, toolName = 'bash') => ({ toolName, reason: 'run the tests', agent: { session: { id: sessionId } }, callId: 'c1' })

test('a task approval carries the task id and title, and clears when the task chat answers it', async () => {
  const { rt, handlers, noted } = bench({ tasks: { task1: { from: 'genie', status: 'working', title: 'Clone the automagik repo' } } })
  assert.equal(handlers.length, 1)
  assert.equal(handlers[0].event, 'approval/request')
  let settle
  const delegated = handlers[0].handler(request('task1'), () => new Promise((resolve) => { settle = resolve }))
  // A task's approval stays DSH's to answer in the task's own chat; the team notes it.
  const [entry] = rt.approvalsView()
  assert.equal(entry.sessionId, 'task1')
  assert.equal(entry.taskId, 'task1')
  assert.equal(entry.label, 'Clone the automagik repo')
  assert.equal(entry.botId, 'genie')
  assert.equal(entry.tool, 'bash')
  // Since v0.3.6 an approval outside a group races DSH's own card: it can be answered from the team's card
  // too, and whichever answers first settles both.
  assert.equal(entry.answerable, true)
  assert.deepEqual(noted.at(-1), ['task1', { tool: 'bash', reason: 'run the tests' }])
  // Answered in the task's chat: the note goes, so the parent card and the Live rail follow.
  settle('allowed-once')
  assert.equal(await delegated, 'allowed-once')
  assert.deepEqual(rt.approvalsView(), [])
  assert.equal(noted.at(-1)[1], undefined)
})

test('a group approval is still answered once, from the team surface', async () => {
  const { rt, handlers } = bench({ groups: [['room-session', { botId: 'writer', roomId: 'room1' }]] })
  const answered = handlers[0].handler(request('room-session'), () => Promise.resolve('delegated'))
  const [entry] = rt.approvalsView()
  assert.equal(entry.roomId, 'room1')
  assert.equal(entry.answerable, true)
  rt.answerApproval(entry.id, 'allow')
  assert.equal(await answered, 'allowed-once')
  // A second decision for the same request is refused, not applied twice.
  assert.throws(() => rt.answerApproval(entry.id, 'allow'), /no longer open/)
  assert.throws(() => rt.answerApproval(entry.id, 'reject'), /no longer open/)
  assert.deepEqual(rt.approvalsView(), [])
})

test('a Bot\'s own approval keeps DSH\'s card, noted only', async () => {
  const { rt, handlers } = bench({ chats: [['bot-session', 'genie']] })
  const outcome = await handlers[0].handler(request('bot-session'), () => Promise.resolve('allowed-once'))
  assert.equal(outcome, 'allowed-once')
  assert.deepEqual(rt.approvalsView(), [])
})

test('an approval nobody on the team owns goes on to the next answerer', async () => {
  const { rt, handlers } = bench()
  const outcome = await handlers[0].handler(request('other'), () => Promise.resolve('unavailable'))
  assert.equal(outcome, 'unavailable')
  assert.deepEqual(rt.approvalsView(), [])
})

test('a run ask is noted and DSH still answers it, and a run whose Bot left passes unnoted', async () => {
  const { rt, handlers, noted } = bench({ runs: [['x', { kind: 'run', run: true, botId: 'ada', taskId: 'x', label: 'someone' }]] })
  let settle
  const outcome = handlers[0].handler(request('x'), () => new Promise(resolve => { settle = resolve }))
  const [entry] = rt.approvalsView()
  assert.deepEqual([entry.botId, entry.sessionId, entry.taskId, entry.label, entry.answerable], ['ada', 'x', 'x', 'someone', true])
  settle('rejected')
  assert.equal(await outcome, 'rejected')
  assert.deepEqual(rt.approvalsView(), [])
  assert.equal(noted.at(-1)[1], undefined)
  const gone = bench()
  assert.equal(await gone.handlers[0].handler(request('x'), () => 'unavailable'), 'unavailable')
  assert.deepEqual(gone.noted, [])
})

test('a run child is cancelled with a stop and no approval note', async () => {
  const b = bench({ runs: [['x', { run: true, child: true, botId: 'ada' }]] })
  assert.equal(await b.handlers[0].handler(request('x'), () => assert.fail('must not pass to DSH')), 'cancelled')
  assert.deepEqual(b.noted, [])
  assert.equal(b.stops[0][1].why, 'unavailable')
})

test('a chat child is held and unload cancels it', async () => {
  const b = bench({ runs: [['x', { kind: 'chat', child: true, botId: 'ada', sessionId: 'ada-chat' }]] })
  const answer = b.handlers[0].handler(request('x'), () => assert.fail('must not pass to DSH'))
  assert.equal(b.rt.approvalsView()[0].answerable, true)
  assert.deepEqual(b.noted, [])
  b.disposers[0]()
  assert.equal(await answer, 'cancelled')
  assert.deepEqual(b.rt.approvalsView(), [])
})

test('a chat child whose signal is already aborted is cancelled, not held', async () => {
  const b = bench({ runs: [['x', { kind: 'chat', child: true, botId: 'ada', sessionId: 'ada-chat' }]] })
  const answer = b.handlers[0].handler({ ...request('x'), signal: AbortSignal.abort() }, () => assert.fail('must not pass to DSH'))
  assert.deepEqual(b.rt.approvalsView(), [])
  assert.equal(await answer, 'cancelled')
})
