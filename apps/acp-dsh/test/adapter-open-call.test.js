// Issue #957, Tester 2's Bug C on this PR's first head: the row that closes an open bridge call
// at its step's end comes after the mirror call's result, so it is the last message of the next
// step's transcript. The adapter must still see the mirror result and continue the agent's
// turn, not end it as interrupted. The real adapter, back-channel and Session, with the fake
// ACP agent; every id and text is synthetic.
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createAssistantMessage, createToolResultMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session } from '@deepseek-ai/dsh-session'
import { apply } from '../index.js'
import { TOOL_NAME } from '../src/host/tool.js'

const FAKE_AGENT = join(resolve(import.meta.dirname, '..'), 'dev', 'fake-agent.mjs')
const TOOLS = [
  { name: 'job_output', description: 'Read output from a running job', parameters: { type: 'object', properties: { job: { type: 'string' }, wait: { type: 'number' } } } },
]

test('#957: a bridge call closed at step/end after the mirror call\'s result does not end the turn as interrupted', async () => {
  const session = Session.create('probe-adapter-step2')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'acp-fake', model: 'default' }, tools: TOOLS },
    reason: 'initial',
  })

  const registered = {}
  const disposers = []
  const toolsMap = new Map()
  const agent = {
    session,
    model: { current: () => ({ provider: 'acp-fake', model: 'default' }) },
    options: { provider: 'acp-fake' },
    status: 'idle',
    ctx: {
      tools: {
        register: (def) => {
          toolsMap.set(def.name, def)
          return () => toolsMap.delete(def.name)
        },
      },
    },
  }
  const waiting = new Map()
  const started = new Map()
  const ctx = {
    llm: {
      registerAdapter: (providers, adapter) => {
        for (const id of providers) registered[id] = adapter
        return () => {}
      },
    },
    agents: { get: id => (id === session.id ? agent : undefined), list: () => [agent] },
    get: (name) => {
      if (name === 'tools') {
        return {
          definitions: () => TOOLS,
          executable: n => TOOLS.find(t => t.name === n),
          execute: async ({ calls }) => {
            const call = calls[0]
            if (!started.has(call.id)) started.set(call.id, Promise.withResolvers())
            started.get(call.id).resolve()
            const gate = Promise.withResolvers()
            waiting.set(call.id, gate)
            const text = await gate.promise
            return { results: [{ callId: call.id, result: { content: [{ type: 'text', text }], isError: false } }] }
          },
        }
      }
      if (name === 'approval') return { effectivePolicy: () => 'never', request: async () => 'allowed-once' }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'danger-full-access' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
    on: () => () => {},
    effect: fn => disposers.push(fn()),
    provide: () => {},
  }

  apply(ctx, { fakeAgent: FAKE_AGENT, claude: false, codex: false, dshTools: true })
  const adapter = registered['acp-fake']

  try {
    // User message in step 1
    session.append('user/message', {
      turn: 1,
      message: { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
    }, { surfaceOp: 'append' })

    // Stream step 1 from adapter: fake-agent emits a mirror tool call (acp_<uuid>)
    const step1Chunks = []
    for await (const chunk of adapter.stream(
      markAgentLoopRequest({
        provider: 'acp-fake',
        model: 'default',
        sessionId: session.id,
        messages: session.deriveMessages(),
      }),
    )) {
      step1Chunks.push(chunk)
    }
    const step1Finish = step1Chunks.at(-1)
    assert.equal(step1Finish.reason.kind, 'tool-calls')

    // Meanwhile, an out-of-band bridge tool call (bridge_open_1) started in step 1 and is still running
    const live = adapter.live.get(session.id)
    assert.ok(live?.bridge, 'bridge record is minted for session')
    const bridgePromise = adapter.backchannel.call(live.bridge, {
      name: 'job_output',
      arguments: { job: 'j1', wait: 240 },
      callId: 'bridge_open_1',
    })
    while (!started.has('bridge_open_1')) await new Promise(r => setImmediate(r))
    await started.get('bridge_open_1').promise

    // Record the assistant message and mirror tool/call + tool/result just as DSH's agent loop does
    const blocks = step1Chunks.filter(c => c.type === 'block-end').map(c => c.block)
    const mirrorCall = blocks.find(b => b.type === 'tool-call')
    assert.ok(mirrorCall, 'mirror tool call emitted in step 1')

    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: blocks,
        source: { kind: 'model', provider: 'acp-fake', model: 'default' },
      }),
    }, { surfaceOp: 'append' })
    const mirrorCallSeq = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: mirrorCall.id,
      name: mirrorCall.name,
      arguments: mirrorCall.arguments,
    }).seq

    const mirrorTool = toolsMap.get(TOOL_NAME)
    const mirrorArgs = JSON.parse(mirrorCall.arguments)
    const mirrorVal = await mirrorTool.execute(mirrorArgs, {
      agent,
      callId: mirrorCall.id,
      signal: new AbortController().signal,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: mirrorCall.id,
        content: mirrorTool.output.render(mirrorArgs, mirrorVal),
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [mirrorCallSeq] })

    // Now DSH ends step 1 while bridge_open_1 is still running!
    // Backchannel's guard closes bridge_open_1 right before step/end, which appends a tool/result for bridge_open_1
    // AFTER mirrorCall's tool/result.
    session.append('step/end', { turn: 1, step: 1 })
    session.append('step/start', { turn: 1, step: 2 })

    // DSH derives messages for step 2 and calls adapter.stream()
    const step2Messages = session.deriveMessages()
    const step2Chunks = []
    for await (const chunk of adapter.stream(
      markAgentLoopRequest({
        provider: 'acp-fake',
        model: 'default',
        sessionId: session.id,
        messages: step2Messages,
      }),
    )) {
      step2Chunks.push(chunk)
    }

    waiting.get('bridge_open_1').resolve('job finished in step 2')
    await bridgePromise
    session.append('step/end', { turn: 1, step: 2 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const step2Text = step2Chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
    assert.doesNotMatch(
      step2Text,
      /was interrupted before it finished/,
      `Step 2 must continue the turn rather than aborting as interrupted (got: ${JSON.stringify(step2Text)})`,
    )
    assert.match(step2Text, /It printed hello 1\./)
  } finally {
    for (const fn of disposers) fn()
  }
})
