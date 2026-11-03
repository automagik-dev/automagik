#!/usr/bin/env node
// A fake ACP agent for tests. Each prompt: two text chunks, one shell-like tool call that asks
// permission first, then a line saying whether it ran. A prompt that says "twice" makes two
// calls; one that says "hang" waits until it is cancelled.
//
// Like Claude Code's and Codex's adapters it offers its models and each model's efforts as
// session config options (categories `model` and `thought_level`, the effort list rebuilt per
// model), and each turn's thoughts start with the model and effort it runs on. With
// FAKE_ACP_NO_OPTIONS=1 in its environment it offers none, as an older agent would.
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, PROTOCOL_VERSION, RequestError, ndJsonStream } from '@agentclientprotocol/sdk'

const MODELS = [
  { value: 'fake-large', name: 'Fake Large', efforts: ['low', 'medium', 'high'], effort: 'medium' },
  { value: 'fake-small', name: 'Fake Small', description: 'Quick and cheap', efforts: ['low', 'high'], effort: 'low' },
  { value: 'fake-plain', name: 'Fake Plain', efforts: [], effort: undefined },
]
const OFFERS = process.env.FAKE_ACP_NO_OPTIONS !== '1'

function configOptions(session) {
  const model = MODELS.find(entry => entry.value === session.model)
  const options = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model.value, options: MODELS.map(({ value, name, description }) => ({ value, name, ...(description ? { description } : {}) })) }]
  if (model.efforts.length > 0) {
    options.push({ id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: session.effort ?? 'default', options: [{ value: 'default', name: 'Default' }, ...model.efforts.map(value => ({ value, name: value[0].toUpperCase() + value.slice(1) }))] })
  }
  return options
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
const sessions = new Map()

new AgentSideConnection(conn => ({
  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [] }
  },
  async newSession(params) {
    const sessionId = `fake-${sessions.size + 1}`
    const session = { cwd: params.cwd, cancelled: false, turns: 0, model: MODELS[0].value, effort: MODELS[0].effort }
    sessions.set(sessionId, session)
    return { sessionId, ...(OFFERS ? { configOptions: configOptions(session) } : {}) }
  },
  async setSessionConfigOption({ sessionId, configId, value }) {
    const session = sessions.get(sessionId)
    if (!OFFERS || !session) throw RequestError.invalidParams(undefined, `Unknown config option: ${configId}`)
    const option = configOptions(session).find(entry => entry.id === configId)
    if (!option?.options.some(entry => entry.value === value)) throw RequestError.invalidParams(undefined, `Invalid value for config option ${configId}: ${value}`)
    if (configId === 'model') {
      const model = MODELS.find(entry => entry.value === value)
      session.model = value
      // A new model keeps the effort when it offers it, else takes its own.
      if (!model.efforts.includes(session.effort)) session.effort = model.effort
    } else {
      session.effort = value === 'default' ? undefined : value
    }
    return { configOptions: configOptions(session) }
  },
  async authenticate() { return {} },
  async cancel({ sessionId }) {
    const session = sessions.get(sessionId)
    if (session) {
      session.cancelled = true
      session.wake?.()
    }
  },
  async prompt({ sessionId, prompt }) {
    const session = sessions.get(sessionId)
    session.cancelled = false
    session.turns++
    const said = prompt.filter(block => block.type === 'text').map(block => block.text).join(' ')
    const update = u => conn.sessionUpdate({ sessionId, update: u })
    if (OFFERS) await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `On ${session.model} at ${session.effort ?? 'no'} effort. ` } })
    await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking it over.' } })
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Fake agent, turn ${session.turns}: ` } })
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `you said "${said}".` } })
    if (/hang/.test(said)) {
      if (!session.cancelled) await new Promise((resolve) => { session.wake = resolve })
      return { stopReason: 'cancelled' }
    }
    const calls = /twice/.test(said) ? 2 : 1
    for (let n = 1; n <= calls; n++) {
      const toolCallId = `call-${session.turns}-${n}`
      const command = `echo hello ${n}`
      await update({ sessionUpdate: 'tool_call', toolCallId, title: `Run ${command}`, kind: 'execute', status: 'pending', rawInput: { command } })
      const answer = await conn.requestPermission({
        sessionId,
        toolCall: { toolCallId, title: `Run ${command}`, kind: 'execute', rawInput: { command } },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })
      if (session.cancelled || answer.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' }
      const allowed = answer.outcome.optionId === 'yes'
      if (allowed) {
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' })
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: `hello ${n}` } }] })
      } else {
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'Not allowed' } }] })
      }
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? ` It printed hello ${n}.` : ' I was not allowed to run it.' } })
    }
    return { stopReason: 'end_turn' }
  },
}), stream)
