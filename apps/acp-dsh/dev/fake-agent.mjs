#!/usr/bin/env node
// A fake ACP agent for tests. Each prompt: two text chunks, one shell-like tool call that asks
// permission first, then a line saying whether it ran. A prompt that says "twice" makes two
// calls; one that says "hang" waits until it is cancelled.
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
const sessions = new Map()

new AgentSideConnection(conn => ({
  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [] }
  },
  async newSession(params) {
    const sessionId = `fake-${sessions.size + 1}`
    sessions.set(sessionId, { cwd: params.cwd, cancelled: false, turns: 0 })
    return { sessionId }
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
