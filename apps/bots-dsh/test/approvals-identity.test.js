import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/approvals.js'

// The approval listener, with the team state it reads: a running task a Bot started, the
// Bots' own chats, and hidden group Sessions.
function bench({ tasks = {}, chats = [], groups = [] } = {}) {
  const handlers = []
  const noted = []
  const rt = {
    ctx: { on: (event, handler) => handlers.push({ event, handler }) },
    state: { tasks },
    groupOwners: new Map(groups),
    chatOwners: new Map(chats),
    botOf: id => (['genie', 'writer'].includes(id) ? { id } : undefined),
    noteApproval: (sessionId, note) => noted.push([sessionId, note]),
    callDetail: () => ({ text: 'bun test', code: 'bun test' }),
    yieldRoomTurn: () => {},
  }
  install(rt)
  return { rt, handlers, noted }
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
  assert.equal(entry.answerable, false)
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
