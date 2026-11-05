// The adapter against the fake agent over real stdio, driven the way DSH's agent loop drives a
// model: stream a step, run the tool calls it ends on, stream the next step with the results.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isAgentLoopRequest, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { apply } from '../index.js'
import { optionFor, TOOL_NAME } from '../src/host/tool.js'
import { aside, choose, NOTICE_KIND, promptOf, SIDE_MODEL } from '../src/host/adapter.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')

function host({ answer = 'allowed-once' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'acp-dsh-'))
  const registered = {}
  const asked = []
  const disposers = []
  const tools = new Map()
  // What the adapter writes to the Session's log itself: DSH's session.append, recorded. A test
  // that sets `h.log` gets each message there too, where DSH would put it in the chat.
  const appended = []
  const append = (type, data, options) => {
    appended.push({ type, data, options })
    h.log?.push(data)
    return { seq: appended.length }
  }
  const agent = { session: { id: 's1', header: { cwd }, append }, ctx: { tools: { register: (def) => { assert.ok(!tools.has(def.name), 'registered once'); tools.set(def.name, def); return () => tools.delete(def.name) } } } }
  const ctx = {
    llm: { registerAdapter: (providers, adapter) => { for (const id of providers) registered[id] = adapter; return () => {} } },
    agents: { get: id => (id === 's1' ? agent : undefined) },
    get: name => (name === 'approval' ? { request: async (req) => { asked.push(req); return typeof answer === 'function' ? answer(req) : answer } } : undefined),
    on: () => {},
    effect: (fn) => { disposers.push(fn()) },
  }
  apply(ctx, { fakeAgent: FAKE, claude: false, codex: false })
  const close = () => { for (const fn of disposers) fn(); rmSync(cwd, { recursive: true, force: true }) }
  const h = { adapter: registered['acp-fake'], agent, tools, asked, appended, close, registered }
  return h
}

async function step(adapter, messages, { signal, onChunk, model = 'default', effort } = {}) {
  const chunks = []
  for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: 'acp-fake', model, ...(effort ? { reasoningEffort: effort } : {}), sessionId: 's1', messages, signal }))) {
    chunks.push(chunk)
    onChunk?.(chunks)
  }
  return chunks
}

// One DSH turn: steps until the model stops, tool calls run between them like DSH runs them.
async function turn(h, messages, text, choice = {}) {
  messages.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const steps = []
  for (;;) {
    const chunks = await step(h.adapter, messages, choice)
    steps.push(chunks)
    const blocks = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)
    messages.push({ role: 'assistant', source: { kind: 'model', provider: 'acp-fake', model: choice.model ?? 'default' }, content: blocks })
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
const thoughtIn = chunks => chunks.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.text).join('')

test('a turn streams text, ends its step at the tool call, asks DSH, and goes on after the result', async () => {
  const h = host()
  try {
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

// DSH's side requests on an agent's route: a Session title goes to DSH's default model when
// that is not an agent, else to sideModel (DeepSeek by default), without the agent's effort;
// every other side request (a compaction summary) is refused. The agent never sees them.
const drain = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }
const codeOf = chunks => chunks.at(-1)?.reason?.failure?.code

test('a Session title on an agent\'s chat goes to DSH\'s default model, or to sideModel when the default is an agent', async () => {
  let passed = 0
  const next = () => { passed++; return (async function* () {})() }
  const sent = []
  let selection = { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'max' }
  let side = SIDE_MODEL
  const ctx = {
    llm: { stream: options => { sent.push(options); return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })() } },
    get: name => (name === 'agentDefaultModel' ? { currentSelection: () => selection } : undefined),
  }
  const listen = aside(new Map([['acp-fake', {}]]), ctx, () => side)
  const title = { provider: 'acp-fake', model: 'fake', reasoningEffort: 'high', maxTokens: 4096, sessionId: 's1', purpose: 'session-title', messages: [] }
  const route = async () => { sent.length = 0; const chunks = await drain(listen(title, next)); return sent.length === 1 ? `${sent[0].provider}/${sent[0].model}` : codeOf(chunks) }

  assert.equal(await route(), 'deepseek-official/deepseek-v4')
  assert.deepEqual(sent, [{ provider: 'deepseek-official', model: 'deepseek-v4', maxTokens: 4096, sessionId: 's1', purpose: 'session-title', messages: [] }])
  // The person last picked an agent (DSH's default follows every pick), or there is no default.
  for (const agentDefault of [{ provider: 'acp-fake', model: 'default' }, { provider: 'acp-claude', model: 'default' }, undefined]) {
    selection = agentDefault
    assert.equal(await route(), 'deepseek-official/deepseek-flash')
  }
  side = { provider: 'anthropic', model: 'claude-haiku-5-5' }
  assert.equal(await route(), 'anthropic/claude-haiku-5-5')
  for (const unusable of [{ provider: 'acp-codex', model: 'default' }, { provider: 'deepseek-official' }, undefined]) {
    side = unusable
    assert.equal(await route(), 'UNSUPPORTED')
  }
  assert.equal(codeOf(await drain(aside(new Map([['acp-fake', {}]]))(title, next))), 'UNSUPPORTED')

  // Any other side request on an agent's route is refused, whatever the default.
  selection = { provider: 'deepseek-official', model: 'deepseek-v4' }
  side = SIDE_MODEL
  sent.length = 0
  for (const purpose of ['compaction', undefined]) assert.equal(codeOf(await drain(listen({ ...title, purpose }, next))), 'UNSUPPORTED')
  assert.equal(sent.length, 0)

  // The agent loop's own requests, and other providers', go on.
  await drain(listen(markAgentLoopRequest({ provider: 'acp-fake', messages: [] }), next))
  await drain(listen({ provider: 'deepseek-official', purpose: 'compaction', messages: [] }, next))
  assert.deepEqual([passed, sent.length], [2, 0])
})

// The same through DSH's own llm service and DSH's own default-model service, saved on an agent
// as it is after the person picks one: the listener's nested call passes through the waterfall
// again, sideModel's adapter answers the title, and the agent's adapter sees no side request.
test('through DSH\'s real llm and default-model services, a title on an agent\'s chat is answered by sideModel', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: LlmRuntime, LlmAdapter } = await import('@deepseek-ai/dsh-llm')
  const { default: AgentDefaultModel } = await import('@deepseek-ai/dsh-agent-default-model')
  const seen = []
  class Route extends LlmAdapter {
    constructor(name) { super(); this.name = name }
    async listModels(provider) { return [{ provider, id: 'm', name: 'm' }] }
    async resolveModel(provider, model) { return { provider, id: model, name: model, contextWindow: 100000, maxOutputTokens: 8000 } }
    async *stream(options) {
      seen.push({ adapter: this.name, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort, agentLoop: isAgentLoopRequest(options) })
      yield { type: 'text-delta', index: 0, text: `from ${this.name}` }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentDefaultModel, { provider: 'acp-fake', model: 'default' })
  assert.deepEqual(ctx.get('agentDefaultModel').currentSelection(), { provider: 'acp-fake', model: 'default' })
  ctx.llm.registerAdapter(['acp-fake'], new Route('agent'))
  ctx.llm.registerAdapter(['deepseek-official'], new Route('deepseek'))
  ctx.on('llm/stream', aside(new Map([['acp-fake', {}]]), ctx))
  const run = async options => { let text = ''; let last; for await (const chunk of ctx.llm.stream(options)) { if (chunk.type === 'text-delta') text += chunk.text; last = chunk } return text || last?.reason?.failure?.code }
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Name this chat' }] }]
  assert.equal(await run({ provider: 'acp-fake', model: 'default', reasoningEffort: 'high', purpose: 'session-title', messages }), 'from deepseek')
  assert.equal(await run({ provider: 'acp-fake', model: 'default', purpose: 'compaction', messages }), 'UNSUPPORTED')
  assert.equal(await run(markAgentLoopRequest({ provider: 'acp-fake', model: 'default', messages })), 'from agent')
  assert.deepEqual(seen, [
    { adapter: 'deepseek', provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: undefined, agentLoop: false },
    { adapter: 'agent', provider: 'acp-fake', model: 'default', reasoningEffort: undefined, agentLoop: true },
  ])
})

test('the plugin sends titles on its agents\' routes to its sideModel setting when DSH\'s default is an agent', async () => {
  const listeners = {}
  const sent = []
  const defaults = { currentSelection: () => ({ provider: 'acp-fake', model: 'default' }) }
  const ctx = {
    llm: { registerAdapter: () => () => {}, stream: options => { sent.push(options); return (async function* () {})() } },
    agents: { get: () => undefined },
    get: name => (name === 'agentDefaultModel' ? defaults : undefined),
    on: (name, listener) => { listeners[name] = listener; return () => {} },
  }
  let side = { provider: 'deepseek-official', model: 'deepseek-v4' }
  apply(ctx, { fakeAgent: FAKE, claude: false, codex: false, sideModel: { get: () => side } })
  const title = () => drain(listeners['llm/stream']({ provider: 'acp-fake', model: 'default', purpose: 'session-title', messages: [] }, () => assert.fail('the agent got a side request')))
  assert.deepEqual(await title(), [])
  // A live setting: the next title reads the new value.
  side = { provider: 'anthropic', model: 'claude-haiku-5-5' }
  await title()
  assert.deepEqual(sent.map(options => `${options.provider}/${options.model}`), ['deepseek-official/deepseek-v4', 'anthropic/claude-haiku-5-5'])
})

test('sideModel is a live setting, DeepSeek Flash by default', async () => {
  const { resolveConfig } = await import('@deepseek-ai/cordis')
  const plugin = await import('../index.js')
  const config = resolveConfig(plugin, {})
  assert.deepEqual({ ...(typeof config.sideModel?.get === 'function' ? config.sideModel.get() : config.sideModel) }, { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(typeof config.sideModel?.get, 'function', 'a volatile field resolves to a reference')
})

test('an agent that cannot start fails the step with its reason', async () => {
  const registered = {}
  const ctx = { llm: { registerAdapter: (providers, adapter) => { for (const id of providers) registered[id] = adapter } }, agents: { get: () => undefined }, get: () => undefined }
  apply(ctx, { fakeAgent: join(import.meta.dirname, 'fixtures', 'no-such-agent.mjs'), claude: false, codex: false })
  const chunks = []
  for await (const chunk of registered['acp-fake'].stream(markAgentLoopRequest({ provider: 'acp-fake', model: 'default', sessionId: 's9', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))) chunks.push(chunk)
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

// An earlier answer in the chat, from another model or an earlier agent process.
const earlier = () => [
  { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'earlier question' }] },
  { role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' }, content: [{ type: 'text', text: 'earlier answer' }] },
]
const notices = h => h.appended.filter(entry => entry.data?.source?.kind === NOTICE_KIND)

test('a new agent session in a chat with earlier answers says so once in a notice row, never in the reply', async () => {
  const h = host()
  try {
    const messages = earlier()
    h.log = messages
    const first = await turn(h, messages, 'hi')
    // The reply is the agent's own words only: no text block carries the notice.
    for (const chunks of first.steps) assert.doesNotMatch(textIn(chunks), /does not see|new Fake agent session/i)
    assert.equal(textIn(first.steps[0]), 'Fake agent, turn 1: you said "hi".')
    for (const chunks of first.steps) {
      for (const block of chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)) {
        if (block.type === 'text') assert.doesNotMatch(block.text, /does not see/)
      }
    }
    // The notice: one user-role row in the Session's log, of DSH's notice form, outside the reply.
    assert.equal(notices(h).length, 1)
    const [{ type, data, options }] = notices(h)
    assert.equal(type, 'user/message')
    assert.deepEqual(options, { surfaceOp: 'append' })
    assert.equal(data.role, 'user')
    assert.equal(data.source.form, 'notice')
    assert.equal(data.source.summary, "A new Fake agent session: it does not see this chat's earlier messages")
    assert.deepEqual(data.content, [{ type: 'text', text: "[A new Fake agent session: it does not see this chat's earlier messages.]" }])
    // It lands before the reply, never as assistant content.
    const at = messages.indexOf(data)
    assert.equal(messages[at - 1].content[0].text, 'hi')
    assert.equal(messages[at + 1].role, 'assistant')
    assert.ok(messages.filter(message => message.role === 'assistant').every(message => message.content.every(block => !/does not see/.test(block.text ?? ''))))
    // The same session's next turn writes none, and the agent is prompted with the person's words only.
    const second = await turn(h, messages, 'again')
    assert.equal(notices(h).length, 1)
    assert.equal(textIn(second.steps[0]), 'Fake agent, turn 2: you said "again".')
  } finally {
    h.close()
  }
})

test('a new agent session in a chat with no answers yet writes no notice', async () => {
  const h = host()
  try {
    const { steps } = await turn(h, [], 'hi')
    assert.equal(textIn(steps[0]), 'Fake agent, turn 1: you said "hi".')
    assert.equal(h.appended.length, 0)
  } finally {
    h.close()
  }
})

test('the new-session notice never reaches the agent, even in a turn with no message of the person', () => {
  const notice = { role: 'user', source: { kind: NOTICE_KIND, form: 'notice', summary: 'A new Fake agent session' }, content: [{ type: 'text', text: '[A new Fake agent session.]' }] }
  const reply = { role: 'assistant', content: [{ type: 'text', text: 'reply' }] }
  const own = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'new question' }] }
  const relay = { role: 'user', source: { kind: 'relay-producer', form: 'relay' }, content: [{ type: 'text', text: 'go on' }] }
  assert.deepEqual(promptOf([reply, notice, own]), [{ type: 'text', text: 'new question' }])
  assert.deepEqual(promptOf([reply, notice, relay]), [{ type: 'text', text: 'go on' }])
  assert.deepEqual(promptOf([reply, notice]), [{ type: 'text', text: '' }])
})

test("DSH's answer maps to the option the agent offered", () => {
  const options = [{ optionId: 'a', kind: 'allow_always' }, { optionId: 'o', kind: 'allow_once' }, { optionId: 'r', kind: 'reject_once' }]
  assert.deepEqual(optionFor('allowed-once', options), { outcome: { outcome: 'selected', optionId: 'o' } })
  assert.deepEqual(optionFor('rejected', options), { outcome: { outcome: 'selected', optionId: 'r' } })
  assert.deepEqual(optionFor('unavailable', options), { outcome: { outcome: 'cancelled' } })
  assert.deepEqual(optionFor('cancelled', options), { outcome: { outcome: 'cancelled' } })
})

test("the agent's own models and each one's efforts are DSH's models and efforts", async () => {
  const h = host()
  try {
    assert.deepEqual(await h.adapter.listModels('acp-fake'), [
      { provider: 'acp-fake', id: 'default', name: 'Fake agent', description: 'Its own setting: Fake Large' },
      { provider: 'acp-fake', id: 'fake-large', name: 'Fake Large' },
      { provider: 'acp-fake', id: 'fake-small', name: 'Fake Small', description: 'Quick and cheap' },
      { provider: 'acp-fake', id: 'fake-plain', name: 'Fake Plain' },
    ])
    // Each model's own efforts, least to most; the agent's "default" row is no level, and its
    // current value (the person's own setting) is the default effort.
    await h.adapter.agents.get('acp-fake').catalog.probing
    const efforts = async model => (await h.adapter.resolveModel('acp-fake', model)).reasoning
    assert.deepEqual(await efforts('fake-large'), { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' })
    assert.deepEqual(await efforts('fake-small'), { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' })
    assert.deepEqual(await efforts('default'), await efforts('fake-large'))
    assert.equal(await efforts('fake-plain'), undefined)
    // An id the agent does not offer resolves bare, as DSH's routing allows.
    assert.deepEqual(await h.adapter.resolveModel('acp-fake', 'gone'), { provider: 'acp-fake', id: 'gone', name: 'gone' })
  } finally {
    h.close()
  }
})

test('the chosen model and effort reach the agent before each prompt; default goes back to its own model', async () => {
  const h = host()
  try {
    const messages = []
    let next = await turn(h, messages, 'hi', { model: 'fake-small', effort: 'high' })
    assert.match(thoughtIn(next.steps[0]), /^On fake-small at high effort\. Thinking it over\./)
    next = await turn(h, messages, 'again', { model: 'fake-large', effort: 'low' })
    assert.match(thoughtIn(next.steps[0]), /^On fake-large at low effort\./)
    // DSH's default model: the one the agent started on. A turn with no effort hands it back to
    // the agent's own "default" row, so the low effort of the turn before does not stay.
    await turn(h, messages, 'small', { model: 'fake-small' })
    next = await turn(h, messages, 'back', { model: 'default' })
    assert.match(thoughtIn(next.steps[0]), /^On fake-large at no effort\./)
    // A model or effort the agent does not offer fails the turn, saying what it does offer.
    const plain = await step(h.adapter, [...messages, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }], { model: 'fake-plain', effort: 'high' })
    assert.equal(plain.at(-1).reason.kind, 'error')
    assert.match(plain.at(-1).reason.failure.message, /Fake agent would not take fake-plain at high effort: it has no thought_level setting/)
    const unknown = await step(h.adapter, [...messages, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }], { model: 'fake-huge' })
    assert.match(unknown.at(-1).reason.failure.message, /it offers no model fake-huge \(it offers fake-large, fake-small, fake-plain\)/)
  } finally {
    h.close()
  }
})

test('an agent that offers no models is one model, default, with no efforts', async (t) => {
  process.env.FAKE_ACP_NO_OPTIONS = '1'
  t.after(() => { delete process.env.FAKE_ACP_NO_OPTIONS })
  const h = host()
  try {
    assert.deepEqual(await h.adapter.listModels('acp-fake'), [{ provider: 'acp-fake', id: 'default', name: 'Fake agent' }])
    assert.equal((await h.adapter.resolveModel('acp-fake', 'default')).reasoning, undefined)
    const { finish, steps } = await turn(h, [], 'hi')
    assert.equal(finish.reason.kind, 'stop')
    assert.equal(thoughtIn(steps[0]), 'Thinking it over.')
    const other = await step(h.adapter, [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }], { model: 'fake-small' })
    assert.match(other.at(-1).reason.failure.message, /it offers no choice of model, so not fake-small/)
  } finally {
    h.close()
  }
})

test("with no \"default\" effort row (Codex), a turn with no effort goes back to the model's own", async (t) => {
  process.env.FAKE_ACP_NO_DEFAULT_EFFORT = '1'
  t.after(() => { delete process.env.FAKE_ACP_NO_DEFAULT_EFFORT })
  const h = host()
  try {
    // The probe has read every model: each one's own effort is known.
    await h.adapter.listModels('acp-fake')
    await h.adapter.agents.get('acp-fake').catalog.probing
    const messages = []
    let next = await turn(h, messages, 'hi', { model: 'fake-large', effort: 'high' })
    assert.match(thoughtIn(next.steps[0]), /^On fake-large at high effort\./)
    next = await turn(h, messages, 'again', { model: 'fake-large' })
    assert.match(thoughtIn(next.steps[0]), /^On fake-large at medium effort\./)
    next = await turn(h, messages, 'small', { model: 'fake-small', effort: 'high' })
    next = await turn(h, messages, 'small again', { model: 'fake-small' })
    assert.match(thoughtIn(next.steps[0]), /^On fake-small at low effort\./)
  } finally {
    h.close()
  }
})

test("with no effort, the model's own is asked for only without a default row, and an unknown one sets nothing", async () => {
  const set = []
  const runOf = levels => ({
    startModel: 'm',
    option: category => (category === 'model' ? { id: 'model', category, type: 'select', currentValue: 'm', options: [{ value: 'm', name: 'M' }] } : { id: 'effort', category, type: 'select', currentValue: 'high', options: levels.map(value => ({ value, name: value })) }),
    setOption: async (category, value) => { set.push([category, value]) },
  })
  let asked = 0
  const own = value => () => { asked++; return value }
  // Claude Code: its default row, never the catalog.
  await choose(runOf(['default', 'low', 'high']), 'm', undefined, own('low'))
  assert.deepEqual([asked, set], [0, [['model', 'm'], ['thought_level', 'default']]])
  // Codex: the model's own, as read.
  set.length = 0
  await choose(runOf(['low', 'high']), 'm', undefined, own('low'))
  assert.deepEqual([asked, set], [1, [['model', 'm'], ['thought_level', 'low']]])
  // Not read yet: no effort is set (the agent keeps its own), and nothing waits.
  set.length = 0
  await choose(runOf(['low', 'high']), 'm', undefined, own(undefined))
  assert.deepEqual([asked, set], [2, [['model', 'm']]])
})
