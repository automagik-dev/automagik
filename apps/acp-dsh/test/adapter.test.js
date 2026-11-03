// The adapter against the fake agent over real stdio, driven the way DSH's agent loop drives a
// model: stream a step, run the tool calls it ends on, stream the next step with the results.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { apply } from '../index.js'
import { optionFor, TOOL_NAME } from '../src/host/tool.js'
import { aside, promptOf } from '../src/host/adapter.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')

function host({ answer = 'allowed-once' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'acp-dsh-'))
  const registered = {}
  const asked = []
  const disposers = []
  const tools = new Map()
  const agent = { session: { id: 's1', header: { cwd } }, ctx: { tools: { register: (def) => { assert.ok(!tools.has(def.name), 'registered once'); tools.set(def.name, def); return () => tools.delete(def.name) } } } }
  const ctx = {
    llm: { registerAdapter: (providers, adapter) => { for (const id of providers) registered[id] = adapter; return () => {} } },
    agents: { get: id => (id === 's1' ? agent : undefined) },
    get: name => (name === 'approval' ? { request: async (req) => { asked.push(req); return typeof answer === 'function' ? answer(req) : answer } } : undefined),
    on: (name, fn) => { if (name === 'dispose') disposers.push(fn) },
  }
  apply(ctx, { fakeAgent: FAKE, claude: false, codex: false })
  const close = () => { for (const fn of disposers) fn(); rmSync(cwd, { recursive: true, force: true }) }
  return { adapter: registered['acp-fake'], agent, tools, asked, close, registered }
}

async function step(adapter, messages, { signal, onChunk } = {}) {
  const chunks = []
  for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: 'acp-fake', model: 'fake', sessionId: 's1', messages, signal }))) {
    chunks.push(chunk)
    onChunk?.(chunks)
  }
  return chunks
}

// One DSH turn: steps until the model stops, tool calls run between them like DSH runs them.
async function turn(h, messages, text) {
  messages.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const steps = []
  for (;;) {
    const chunks = await step(h.adapter, messages)
    steps.push(chunks)
    const blocks = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)
    messages.push({ role: 'assistant', source: { kind: 'model', provider: 'acp-fake', model: 'fake' }, content: blocks })
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    if (finish.reason.kind !== 'tool-calls') return { steps, finish }
    for (const call of blocks.filter(block => block.type === 'tool-call')) {
      const tool = h.tools.get(call.name)
      assert.ok(tool, `${call.name} is registered in the agent's scope before its call`)
      const args = JSON.parse(call.arguments)
      const value = await tool.execute(args, { agent: h.agent, callId: call.id, signal: new AbortController().signal })
      messages.push({ role: 'tool', toolCallId: call.id, source: { kind: 'tool', callId: call.id }, content: tool.output.render(args, value), meta: tool.output.presentationMeta(args, value) })
      steps.at(-1).result = { args, value, call: tool.presentCall(args), view: tool.presentResult(args, { content: tool.output.render(args, value), isError: false, meta: value }) }
    }
  }
}

const textIn = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')

test('a turn streams text, ends its step at the tool call, asks DSH, and goes on after the result', async () => {
  const h = host()
  try {
    assert.deepEqual(await h.adapter.listModels('acp-fake'), [{ provider: 'acp-fake', id: 'fake', name: 'Fake agent' }])
    const messages = []
    const { steps, finish } = await turn(h, messages, 'hi')
    assert.equal(finish.reason.kind, 'stop')
    assert.equal(steps.length, 2)
    const [first, second] = steps
    assert.equal(textIn(first), 'Fake agent, turn 1: you said "hi".')
    assert.ok(first.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === 'Thinking it over.'))
    const call = first.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block
    assert.equal(call.name, TOOL_NAME)
    assert.deepEqual(JSON.parse(call.arguments), { id: 'call-1-1', title: 'Run echo hello 1', kind: 'execute', input: { command: 'echo hello 1' } })
    assert.equal(first.at(-1).reason.kind, 'tool-calls')
    // The card: a terminal with the command, then its output.
    assert.deepEqual(first.result.call, { card: 'terminal', title: 'Run echo hello 1', description: 'echo hello 1' })
    assert.deepEqual(first.result.view, { card: 'terminal', title: 'Run echo hello 1', output: 'hello 1' })
    assert.equal(first.result.value.status, 'completed')
    // DSH's approval service was asked, about this exact call.
    assert.equal(h.asked.length, 1)
    assert.equal(h.asked[0].toolName, TOOL_NAME)
    assert.equal(h.asked[0].callId, call.id)
    assert.equal(h.asked[0].agent, h.agent)
    assert.match(h.asked[0].reason, /Fake agent: Run echo hello 1/)
    assert.equal(textIn(second), ' It printed hello 1.')
    // A second turn goes to the same agent session.
    const next = await turn(h, messages, 'again')
    assert.match(textIn(next.steps[0]), /turn 2: you said "again"/)
  } finally {
    h.close()
  }
})

test('a rejection reaches the agent, and each of several calls gets its own step and question', async () => {
  let n = 0
  const h = host({ answer: () => (++n === 1 ? 'rejected' : 'allowed-once') })
  try {
    const { steps } = await turn(h, [], 'do it twice')
    assert.equal(steps.length, 3)
    assert.equal(steps[0].result.value.status, 'failed')
    assert.equal(textIn(steps[1]), ' I was not allowed to run it.')
    assert.equal(steps[1].result.value.status, 'completed')
    assert.equal(textIn(steps[2]), ' It printed hello 2.')
    assert.equal(h.asked.length, 2)
  } finally {
    h.close()
  }
})

test('stopping the turn cancels the agent and finishes aborted', async () => {
  const h = host()
  try {
    const controller = new AbortController()
    const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hang' }] }]
    // Stop once the agent has said its words and is waiting on "hang": a reaction to the
    // stream, not a timer, so a slow start under load cannot abort before the agent speaks.
    const chunks = await step(h.adapter, messages, {
      signal: controller.signal,
      onChunk: seen => { if (!controller.signal.aborted && /you said "hang"/.test(textIn(seen))) controller.abort() },
    })
    assert.ok(controller.signal.aborted, 'the step was still streaming when it was stopped')
    assert.equal(chunks.at(-1).reason.kind, 'aborted')
    assert.match(textIn(chunks), /you said "hang"/)
    // The next turn starts cleanly on the same process.
    const next = await turn(h, [...messages, { role: 'assistant', source: { kind: 'model' }, content: [] }], 'hi')
    assert.equal(next.finish.reason.kind, 'stop')
  } finally {
    h.close()
  }
})

test('a request DSH builds on the side never reaches the agent', async () => {
  const listen = aside(new Map([['acp-fake', {}]]))
  const chunks = []
  let passed = 0
  const next = () => { passed++; return (async function* () {})() }
  for await (const chunk of listen({ provider: 'acp-fake', model: 'fake', sessionId: 's1', messages: [] }, next)) chunks.push(chunk)
  assert.equal(passed, 0)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.failure.code, 'UNSUPPORTED')
  // The agent loop's own requests, and other providers', go on.
  for await (const chunk of listen(markAgentLoopRequest({ provider: 'acp-fake', messages: [] }), next)) chunks.push(chunk)
  for await (const chunk of listen({ provider: 'deepseek', messages: [] }, next)) chunks.push(chunk)
  assert.equal(passed, 2)
})

test('an agent that cannot start fails the step with its reason', async () => {
  const registered = {}
  const ctx = { llm: { registerAdapter: (providers, adapter) => { for (const id of providers) registered[id] = adapter } }, agents: { get: () => undefined }, get: () => undefined }
  apply(ctx, { fakeAgent: join(import.meta.dirname, 'fixtures', 'no-such-agent.mjs'), claude: false, codex: false })
  const chunks = []
  for await (const chunk of registered['acp-fake'].stream(markAgentLoopRequest({ provider: 'acp-fake', model: 'fake', sessionId: 's9', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.match(chunks.at(-1).reason.failure.message, /Fake agent did not start/)
})

test('without an agent the plugin registers no route', () => {
  let calls = 0
  apply({ llm: { registerAdapter: () => { calls++ } } }, { claude: false, codex: false })
  assert.equal(calls, 0)
})

test('the prompt is what the person said this turn, not DSH context notes', () => {
  const messages = [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'new question' }] },
    { role: 'user', source: { kind: 'context' }, content: [{ type: 'text', text: 'Current DSH file policy: ...' }] },
  ]
  assert.deepEqual(promptOf(messages), [{ type: 'text', text: 'new question' }])
})

test("DSH's answer maps to the option the agent offered", () => {
  const options = [{ optionId: 'a', kind: 'allow_always' }, { optionId: 'o', kind: 'allow_once' }, { optionId: 'r', kind: 'reject_once' }]
  assert.deepEqual(optionFor('allowed-once', options), { outcome: { outcome: 'selected', optionId: 'o' } })
  assert.deepEqual(optionFor('rejected', options), { outcome: { outcome: 'selected', optionId: 'r' } })
  assert.deepEqual(optionFor('unavailable', options), { outcome: { outcome: 'cancelled' } })
  assert.deepEqual(optionFor('cancelled', options), { outcome: { outcome: 'cancelled' } })
})
