// Live switching's transcript: what crosses to an agent, in order and redacted, and the row
// that says the conversation changed provider (RFC 0003, amendment, "Live switching").
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SYNTHETIC_KIND } from '../src/host/names.js'
import {
  agentRoute, BOUNDARY_KIND, boundaryNotice, carryEffort, crossed, EFFORT_KIND, effortIdOf,
  effortNotice, fromAgent, lastProviderOf, redactTranscript, renderMessage, replayBlocks,
  turnStart,
} from '../src/host/switch.js'
import { credentialShapes } from '../src/host/redact.js'

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

test('Auto review\'s synthetic bridge call never renders and never names a crossing provider', () => {
  const synthetic = {
    role: 'assistant',
    source: { kind: 'model', provider: 'acp-fake', model: 'default', bridge: true, synthetic: SYNTHETIC_KIND },
    content: [{ type: 'tool-call', id: 'bridge-1', name: 'bridge_synthetic', arguments: '{}' }],
  }
  assert.equal(renderMessage(synthetic), undefined)
  assert.equal(lastProviderOf([user('q'), synthetic]), undefined)
  const blocks = replayBlocks([user('q'), synthetic, user('next')], { redact: text => text, to: 'Fake agent' })
  assert.equal(JSON.stringify(blocks).includes('bridge_synthetic'), false)
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

const LEVELS = {
  efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
}

test('the effort notice is a drawn row outside the reply, naming what could not cross', () => {
  const row = effortNotice('high', 'deepseek-official/plain')
  const summary = 'Reasoning effort high is not available on deepseek-official/plain; '
    + 'this chat runs on its own'
  assert.equal(row.role, 'user')
  assert.equal(row.source.kind, EFFORT_KIND)
  assert.equal(row.source.form, 'notice')
  assert.equal(row.source.summary, summary)
  assert.deepEqual(row.content, [{ type: 'text', text: `[${summary}.]` }])
  // A name the target uses for the same level counts as expressible.
  assert.equal(effortIdOf({ efforts: [{ id: 'max', name: 'High' }] }, 'high'), 'max')
  assert.equal(effortIdOf(LEVELS, 'high'), 'high')
  assert.equal(effortIdOf({ efforts: [{ id: 'low', name: 'Low' }] }, 'high'), undefined)
})

test('a crossing carries the Session\'s effort both ways, and says where it cannot', async () => {
  const appended = []
  let previous = { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' }
  let defaulted = false
  const session = {
    requestHeader: () => ({
      config: previous,
      ...(defaulted ? { adapterDefaults: { reasoningEffort: true } } : {}),
    }),
    append: (type, data, options) => {
      appended.push({ type, data, options })
      return { seq: appended.length }
    },
  }
  const reasoning = new Map([
    ['acp-fake/fake-large', LEVELS],
    ['acp-fake/fake-small', { efforts: [{ id: 'low', name: 'Low' }] }],
    ['deepseek-official/deepseek-v4', LEVELS],
    ['deepseek-official/plain', { efforts: [] }],
  ])
  const acpCrossing = (previous, next) =>
    previous.provider.startsWith('acp-') || next.provider.startsWith('acp-')
  const carry = carryEffort(
    async (provider, model) => reasoning.get(`${provider}/${model}`),
    () => true,
    acpCrossing,
  )
  const cross = data => carry(session, { type: 'model/selection', data })
  // Native -> agent: DSH records the target's default (low); high crosses instead.
  await cross({ provider: 'acp-fake', model: 'fake-large', reasoningEffort: 'low' })
  assert.deepEqual(appended.at(-1), {
    type: 'model/selection',
    data: { provider: 'acp-fake', model: 'fake-large', reasoningEffort: 'high' },
    options: undefined,
  })
  // Agent -> native: the same high crosses back.
  previous = { provider: 'acp-fake', model: 'fake-large', reasoningEffort: 'high' }
  appended.length = 0
  await cross({ provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'low' })
  assert.deepEqual(appended.at(-1).data, {
    provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high',
  })
  // The same route with another effort is the person's own pick, not a crossing.
  appended.length = 0
  await cross({ provider: 'acp-fake', model: 'fake-large', reasoningEffort: 'low' })
  assert.equal(appended.length, 0)
  // A native model change is not an ACP crossing, so it is left alone.
  previous = { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' }
  await cross({ provider: 'deepseek-official', model: 'deepseek-other', reasoningEffort: 'low' })
  assert.equal(appended.length, 0)
  // Into an agent whose known levels lack it: the notice comes in this direction too.
  await cross({ provider: 'acp-fake', model: 'fake-small' })
  assert.equal(appended.at(-1).type, 'user/message')
  assert.equal(appended.at(-1).data.source.kind, EFFORT_KIND)
  assert.match(appended.at(-1).data.content[0].text, /Reasoning effort high is not available/)
  // Out of an agent whose target is a known model without it.
  appended.length = 0
  previous = { provider: 'acp-fake', model: 'fake-large', reasoningEffort: 'high' }
  await cross({ provider: 'deepseek-official', model: 'plain' })
  assert.equal(appended.at(-1).type, 'user/message')
  assert.match(appended.at(-1).data.content[0].text, /Reasoning effort high is not available/)
  // An effort DSH itself defaulted is not the person's pick and is not carried.
  appended.length = 0
  defaulted = true
  previous = { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'medium' }
  await cross({ provider: 'acp-fake', model: 'fake-large' })
  assert.equal(appended.length, 0)
})

test('a newer selection wins over a carry still reading the target', async () => {
  const appended = []
  let finish
  const session = {
    requestHeader: () => ({
      config: { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' },
    }),
    append: (type, data) => { appended.push({ type, data }) },
  }
  const carry = carryEffort(() => new Promise(resolve => { finish = resolve }))
  const pending = carry(session, {
    type: 'model/selection',
    data: { provider: 'acp-fake', model: 'fake-large', reasoningEffort: 'low' },
  })
  // The person picks again while the first carry waits on the agent's catalog.
  const newer = { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' }
  await carry(session, { type: 'model/selection', data: newer })
  finish(LEVELS)
  await pending
  assert.equal(appended.length, 0)
})

test('a transcript crossing back to a native provider is redacted, its source untouched', () => {
  const messages = [
    user('look'),
    {
      role: 'assistant',
      source: { kind: 'model', provider: 'acp-claude' },
      content: [
        { type: 'text', text: 'read sk-abcdef123456' },
        { type: 'reasoning', text: 'thought sk-abcdef123456' },
        {
          type: 'tool-call', id: 'c1', name: 'bash',
          arguments: '{"command":"deploy ghp_abcdefghijklmnopqrst"}',
        },
      ],
    },
    {
      role: 'tool', toolCallId: 'c1', source: { kind: 'tool', callId: 'c1' },
      content: [{ type: 'text', text: 'token sk-abcdef123456' }],
    },
  ]
  const redacted = redactTranscript(messages, credentialShapes)
  const json = JSON.stringify(redacted)
  assert.doesNotMatch(json, /sk-abcdef123456|ghp_abcdefghijklmnopqrst/)
  assert.match(json, /sk-\[hidden\]/)
  // The record DSH logged is not rewritten; every other field survives.
  assert.match(JSON.stringify(messages), /sk-abcdef123456/)
  assert.equal(redacted[2].toolCallId, 'c1')
})

test('an agent turn whose route is gone still crosses to native redacted', () => {
  // Probe G: the person turned the agent off (or its CLI went missing), so the live map no
  // longer names the route. The turn is still an agent's: the transcript must not cross raw.
  const sent = []
  const ctx = { llm: { stream: options => { sent.push(options); return 'stream' } } }
  const providers = new Map()
  const listen = crossed(providers, ctx, credentialShapes)
  const messages = [user('look'), answer('read sk-abcdef123456', 'acp-claude')]
  assert.equal(agentRoute(providers, 'acp-claude'), true)
  assert.equal(fromAgent(messages, providers), true)
  const request = { provider: 'deepseek-official', sessionId: 's1', messages }
  assert.equal(listen(request, () => 'next'), 'stream')
  assert.equal(JSON.stringify(sent[0].messages).includes('sk-abcdef123456'), false)
  assert.match(JSON.stringify(sent[0].messages), /sk-\[hidden\]/)
  // An acp- route is an agent's even with an empty map: it is not a native call.
  assert.equal(listen({ ...request, provider: 'acp-claude' }, () => 'next'), 'next')
  // A native turn is not an agent turn, and passes through untouched.
  const native = [user('hi'), answer('hello', 'deepseek-official')]
  assert.equal(agentRoute(providers, 'deepseek-official'), false)
  assert.equal(fromAgent(native, providers), false)
  assert.equal(listen({ ...request, messages: native }, () => 'next'), 'next')
})

test('a request carrying an agent turn is redacted before a native provider sees it', () => {
  const sent = []
  const ctx = { llm: { stream: options => { sent.push(options); return 'stream' } } }
  const providers = new Map([['acp-claude', {}]])
  const listen = crossed(providers, ctx, credentialShapes)
  const messages = [user('look'), answer('read sk-abcdef123456', 'acp-claude')]
  const request = { provider: 'deepseek-official', model: 'm', sessionId: 's1', messages }
  assert.equal(fromAgent(messages, providers), true)
  assert.equal(listen(request, () => 'next'), 'stream')
  assert.equal(sent.length, 1)
  assert.equal(JSON.stringify(sent[0].messages).includes('sk-abcdef123456'), false)
  assert.match(JSON.stringify(sent[0].messages), /sk-\[hidden\]/)
  // The original request and the messages DSH logged are untouched.
  assert.match(JSON.stringify(messages), /sk-abcdef123456/)
  // The nested call does not re-enter the listener.
  assert.equal(listen(sent[0], () => 'next'), 'next')
  // No agent turn, an agent route, no Session, or the setting off: unchanged.
  const plain = { provider: 'deepseek-official', sessionId: 's1', messages: [user('hi')] }
  assert.equal(listen(plain, () => 'next'), 'next')
  assert.equal(listen({ ...request, provider: 'acp-claude' }, () => 'next'), 'next')
  assert.equal(listen({ ...request, sessionId: undefined }, () => 'next'), 'next')
  const off = crossed(providers, ctx, credentialShapes, () => false)
  assert.equal(off(request, () => 'next'), 'next')
})
