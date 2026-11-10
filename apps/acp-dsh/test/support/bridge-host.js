// A real DSH Session with a real Backchannel on it, driven as DSH's loop and an agent would: the
// test opens and ends steps and turns itself, and holds each tool body until it says how it
// ends. The log is checked with the pinned v4 reader, the one a desktop reload runs. Every
// Session, id and text here is synthetic.
import assert from 'node:assert/strict'
import { KNOWN_SESSION_EVENT_TYPES, Session } from '@deepseek-ai/dsh-session'
import { restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { Backchannel } from '../../src/host/backchannel.js'

export const TOOLS = [
  { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
]

/** Why the pinned reader refuses the Session's log, or undefined when it loads. */
export function loadError(session) {
  const artifact = {
    header: { version: 4, id: session.id, createdAt: 0, isSeeded: false, delegationDepth: 0 },
    events: session.snapshotEvents(),
    inheritedEventCount: 0,
  }
  try {
    restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)
    return undefined
  } catch (error) {
    return error
  }
}

export function assertLoadable(session, note = '') {
  const error = loadError(session)
  assert.equal(error, undefined, `the pinned reader refuses the log${note}: ${error?.message}`)
}

/** Let the bridge's pending awaits run: its rows are written on later ticks. */
export const ticks = async (count = 3) => {
  for (let index = 0; index < count; index += 1) await new Promise(resolve => setImmediate(resolve))
}

/**
 * @param {{ id?: string, level?: 'full' | 'manual', guard?: boolean }} [options] `guard: false`
 *   lets the bridge write unguarded, as it did before #958 (the fuzz's control).
 */
export function bridgeHost({ id = 'probe-958', level = 'full', guard = true } = {}) {
  const session = Session.create(id)
  const agent = { session }
  let turn = 0
  let step = 0
  let stepOpen = false
  let turnOpen = false
  // One entry per tool body the bridge reached: the test ends it with `finish`.
  const bodies = []
  const asks = []
  const logs = []
  const ctx = {
    get: (name) => {
      if (name === 'tools') {
        return {
          definitions: () => TOOLS,
          executable: toolName => TOOLS.find(tool => tool.name === toolName),
          execute: ({ calls }) => new Promise((resolve, reject) => { bodies.push({ call: calls[0], resolve, reject, done: false }) }),
        }
      }
      if (name === 'approval') {
        return {
          effectivePolicy: () => (level === 'full' ? 'never' : 'ask'),
          request: request => new Promise((resolve) => { asks.push({ request, resolve, done: false }) }),
        }
      }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: level === 'full' ? 'danger-full-access' : 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      if (name === 'agents') return { turnBoundaryOf: () => ({ lastTurn: turn }) }
      return undefined
    },
  }
  const backchannel = new Backchannel({ ctx, log: message => logs.push(message) })
  const host = {
    session,
    agent,
    backchannel,
    bodies,
    asks,
    logs,
    record: undefined,
    get turn() { return turn },
    get step() { return step },
    get stepOpen() { return stepOpen },
    get turnOpen() { return turnOpen },
    mint() {
      host.record = backchannel.mint({ sessionId: session.id, agent, name: 'Probe agent' })
      if (!guard) host.record.guard?.release()
      return host.record
    },
    startTurn() {
      turn += 1
      step = 0
      turnOpen = true
      session.append('turn/start', { turn })
    },
    startStep() {
      step += 1
      stepOpen = true
      session.append('step/start', { turn, step })
      if (step === 1) session.append('request/header', { header: { config: { provider: 'acp-probe', model: 'probe-model' }, tools: TOOLS }, reason: 'initial' })
    },
    endStep() {
      stepOpen = false
      session.append('step/end', { turn, step })
    },
    /** `turn/end`, over an open step when the test left one (a turn cut short). */
    endTurn() {
      stepOpen = false
      turnOpen = false
      session.append('turn/end', { turn, reason: 'stop' })
    },
    /** One bridge call, as the bridge process posts it; the promise is the bridge's answer. */
    call({ callId, name = 'bash', args = { command: 'echo probe' } } = {}) {
      return backchannel.call(host.record, { name, arguments: args, callId })
    },
    /** End the oldest tool body still running. */
    finish(how = 'ok') {
      const body = bodies.find(entry => !entry.done)
      if (body === undefined) return false
      body.done = true
      if (how === 'ok') body.resolve({ results: [{ callId: body.call.id, result: { content: [{ type: 'text', text: 'probe ran' }], isError: false } }] })
      else if (how === 'tool-error') body.resolve({ results: [{ callId: body.call.id, result: { content: [{ type: 'text', text: 'probe failed' }], isError: true, error: { info: { name: 'ProbeError', code: 'PROBE' } } } }] })
      else if (how === 'throw') body.reject(new Error('the probe threw'))
      // An error whose name and code are not strings: its info must still land as plain JSON.
      else if (how === 'throw-odd') body.reject(Object.assign(new Error('odd'), { name: 7, code: 42 }))
      else if (how === 'empty') body.resolve({ results: [] })
      return true
    },
    /** Answer the oldest approval dialog still up. */
    answer(outcome = 'allowed-once') {
      const ask = asks.find(entry => !entry.done)
      if (ask === undefined) return false
      ask.done = true
      ask.resolve(outcome)
      return true
    },
  }
  return host
}

export const eventsOf = (session, type) => session.snapshotEvents().filter(event => event.type === type)
export const resultsOf = (session, callId) => eventsOf(session, 'tool/result').filter(event => event.data.message?.toolCallId === callId)
