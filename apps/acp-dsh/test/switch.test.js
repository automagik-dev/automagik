// Live switching's transcript: what crosses to an agent, in order and redacted, and the row
// that says the conversation changed provider (RFC 0003, amendment, "Live switching").
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOUNDARY_KIND, boundaryNotice, lastProviderOf, renderMessage, replayBlocks, turnStart } from '../src/host/switch.js'

const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const answer = (text, provider = 'deepseek-official') => ({ role: 'assistant', source: { kind: 'model', provider }, content: [{ type: 'text', text }] })
const note = text => ({ role: 'user', source: { kind: 'context' }, content: [{ type: 'text', text }] })

test('the last answer\'s provider is the one a turn crosses from', () => {
  assert.equal(lastProviderOf([]), undefined)
  assert.equal(lastProviderOf([user('q'), answer('a', 'acp-claude'), user('next')]), 'acp-claude')
  // An answer with no provider source still counts as a crossing only when unknown: no provider.
  assert.equal(lastProviderOf([user('q'), { role: 'assistant', content: [{ type: 'text', text: 'a' }] }]), undefined)
})

test('the transcript before this turn is the replay material', () => {
  // DSH's own turn shape: the trailing user messages are this turn (a context note among them),
  // everything before them is the chat a replay carries.
  const messages = [user('q1'), answer('a1'), note('DSH policy'), user('q2'), user('now')]
  assert.equal(turnStart(messages), 2)
  assert.equal(turnStart([user('first')]), 0)
  assert.equal(turnStart([]), 0)
})

test('a message renders as the person, the model, a named call or a result; DSH notes stay out', () => {
  assert.equal(renderMessage(user('hello')), 'User: hello')
  assert.equal(renderMessage(answer('hi')), 'Assistant: hi')
  assert.equal(renderMessage({ ...answer(''), content: [{ type: 'tool-call', name: 'bash' }] }), '[called bash]')
  assert.equal(renderMessage({ role: 'tool', content: [{ type: 'text', text: 'ok' }] }), 'Tool result: ok')
  assert.equal(renderMessage(note('Current DSH file policy')), undefined)
  assert.equal(renderMessage({ role: 'user', source: { kind: BOUNDARY_KIND }, content: [{ type: 'text', text: '[Now answered by X.]' }] }), undefined)
})

test('a replay is one header block then the messages in order, each redacted', () => {
  const messages = [user('my key is hunter2'), answer('noted'), { role: 'tool', content: [{ type: 'text', text: 'result' }] }]
  const blocks = replayBlocks(messages, { redact: text => text.replaceAll('hunter2', '[secret:TOKEN]'), from: 'DSH', to: 'Fake agent' })
  assert.deepEqual(blocks[0], { type: 'text', text: 'The chat so far, moved from DSH to Fake agent:' })
  assert.deepEqual(blocks.slice(1), [
    { type: 'text', text: 'User: my key is [secret:TOKEN]' },
    { type: 'text', text: 'Assistant: noted' },
    { type: 'text', text: 'Tool result: result' },
  ])
  assert.equal(JSON.stringify(blocks).includes('hunter2'), false)
})

test('a long transcript keeps the most recent messages, with a marker that older ones were left out', () => {
  const messages = Array.from({ length: 20 }, (_, i) => user(`${i}: ${'x'.repeat(9_000)}`))
  const blocks = replayBlocks(messages, { redact: text => text, to: 'X' })
  assert.match(blocks[1].text, /earlier messages left out here/)
  assert.match(blocks.at(-1).text, /^User: 19:/)
  // The oldest kept line is recent, not the start of the chat.
  const first = Number(/^User: (\d+):/.exec(blocks[2].text)[1])
  assert.ok(first > 0, `kept from message ${first}`)
})

test('the boundary row is a notice outside the reply, naming where the turn came from', () => {
  const row = boundaryNotice('Now answered by Claude Code (acp-claude)')
  assert.equal(row.role, 'user')
  assert.equal(row.source.kind, BOUNDARY_KIND)
  assert.equal(row.source.form, 'notice')
  assert.equal(row.source.summary, 'Now answered by Claude Code (acp-claude)')
  assert.deepEqual(row.content, [{ type: 'text', text: '[Now answered by Claude Code (acp-claude).]' }])
})
