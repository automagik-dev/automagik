import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install as installTurns, opensByItself } from '../src/host/turns.js'
import { SOURCE_KIND } from '../src/host/constants.js'
import { isHiddenTurn } from '../src/client/text.js'

// A turn Claude Code opens by itself after a restart carries the reply the person waits
// for: a Bot's request that lands inside it must not claim it, hide it and take its reply
// (issue #62).
function host() {
  let listener
  const delivered = []
  const rt = {
    ctx: { on: (name, fn) => { if (name === 'session/event') listener = fn } },
    state: { exchangeTurns: {}, questions: {} },
    bots: { a: { id: 'a', name: 'Omni' }, b: { id: 'b', name: 'Writer' } },
    isBotSession: () => true, roomOf: () => undefined, groupOwners: new Map(), chatOwners: new Map(),
    botOf: id => rt.bots[id], selfOf: id => id, save: async () => {},
    deliver: async (args) => { delivered.push(args) }, noteFailure() {}, warn() {}, switchJobs: () => [], dropKickoff() {},
  }
  installTurns(rt)
  let seq = 0
  const emit = (type, data) => listener({ id: 'b' }, { type, seq: ++seq, data })
  return { rt, emit, delivered, shown: turn => !isHiddenTurn({ exchangeTurns: rt.state.exchangeTurns }, 'b', turn) }
}
const text = value => [{ type: 'text', text: value }]
const request = { kind: SOURCE_KIND, form: 'relay', role: 'request', exchangeId: 'e1', senderSessionId: 'a', senderName: 'Omni' }

for (const [label, opener] of [
  ['Claude Code reattached after a restart', { kind: 'plugin:dsh-oh-my-claude', form: 'notice', summary: 'reattached' }],
  ['Claude Code woke (v3 log)', { kind: 'plugin', plugin: 'dsh-oh-my-claude' }],
  ['a goal round', { kind: 'goal', goalId: 'g', revision: 1, round: 2 }],
]) {
  test(`a turn opened by ${label} keeps its reply when another Bot's request joins it`, async () => {
    const { rt, emit, delivered, shown } = host()
    emit('turn/start', { turn: 7 })
    emit('user/message', { content: text('opener'), source: opener })
    emit('assistant/message', { message: { content: text('Here is the final answer: the migration is done.') } })
    emit('user/message', { content: text('[Message from Omni]\nstatus?'), source: request })
    emit('assistant/message', { message: { content: text('Still on it.') } })
    emit('turn/end', { turn: 7, reason: { kind: 'completed' } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(shown(7), true)
    assert.deepEqual({ ...rt.state.exchangeTurns }, {})
    assert.ok(!delivered.some(entry => entry.role === 'reply' && /final answer/.test(entry.text ?? '')))
  })
}

test('only goal rounds and Claude Code\'s own notices open a turn by themselves', () => {
  assert.equal(opensByItself({ kind: 'plugin:dsh-oh-my-claude' }), true)
  assert.equal(opensByItself({ kind: 'plugin:claude-code' }), true)
  assert.equal(opensByItself({ kind: 'plugin', plugin: 'dsh-oh-my-claude' }), true)
  assert.equal(opensByItself({ kind: 'goal' }), true)
  assert.equal(opensByItself({ kind: 'plugin:something-else' }), false)
  assert.equal(opensByItself({ kind: 'system-prompt' }), false)
  assert.equal(opensByItself(undefined), false)
})
