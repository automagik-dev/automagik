// Issue #957: a bridged tool call still open when its step ends. The agent runs its calls in
// parallel, and the bridge puts no deadline on one, so a long wait (call A) can outlive the
// step: DSH's loop ends the step as soon as its own work is done. The log then held `step/end`
// with A unresolved, and A's result landed later inside the next step with the old step's
// stamp; the v4 loader refuses both, and the session never opened again.
//
// The write guard (#958) closes such a call before the step/end row and drops its late result.
// These tests replay the issue's order through the real Backchannel on the real Session and
// check the stored log with the real pinned v4 loader, and cover the bridge's own half (review
// on #958, lifecycle findings 1 to 4): a call has its own controller, stopped by Stop, by its
// turn's end and by a caller that went away; a stopped, revoked or late call writes nothing
// more; a result the log refuses still closes its call; an advertised call whose tool/call row
// cannot be written is answered. No real session, id or text is read or copied.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES, Session } from '@deepseek-ai/dsh-session'
import { restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { Backchannel } from '../src/host/backchannel.js'
import { CANCELLED, SUPERSEDED } from '../src/host/write-guard.js'

const TOOLS = [
  { name: 'job_output', description: 'Read a job', parameters: { type: 'object', properties: { job: { type: 'string' }, wait: { type: 'number' } } } },
]
const A = 'bridge_call_a'
const B = 'bridge_call_b'

const assertLoadable = (session) => {
  const artifact = {
    header: { version: 4, id: session.id, createdAt: 0, isSeeded: false, delegationDepth: 0 },
    events: session.snapshotEvents(),
    inheritedEventCount: 0,
  }
  assert.equal(restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES), artifact)
}

const resultsOf = (session, callId) => session.snapshotEvents()
  .filter(event => event.type === 'tool/result' && event.data.message?.toolCallId === callId)
const callsOf = (session, callId) => session.snapshotEvents()
  .filter(event => event.type === 'tool/call' && event.data.callId === callId)
const textOf = event => event.data.message.content.map(block => block.text ?? '').join('')
const seqOf = (session, type, data) => session.snapshotEvents()
  .find(event => event.type === type && Object.entries(data).every(([key, value]) => event.data[key] === value))?.seq

// One synthetic Session at turn 1, step 1. A call whose arguments carry `wait` stays open until
// the test answers it (`host.finish(callId, text)`); any other call answers at once.
function bridgeHost({ level = 'full', ignoreSignal = false, answer, request = async () => 'allowed-once' } = {}) {
  const session = Session.create(`probe-957-${level}`)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', { header: { config: { provider: 'acp-probe', model: 'probe-model' }, tools: TOOLS }, reason: 'initial' })
  const agent = { session }
  const waiting = new Map()
  const signals = new Map()
  const started = new Map()
  const startedOf = (callId) => {
    if (!started.has(callId)) started.set(callId, Promise.withResolvers())
    return started.get(callId)
  }
  const listeners = new Set()
  const ctx = {
    // The back-channel's own listener for a turn's end; a bare Session publishes nothing here.
    on: (name, listener) => {
      if (name === 'session/event') listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: (name) => {
      if (name === 'tools') {
        return {
          definitions: () => TOOLS,
          executable: toolName => TOOLS.find(tool => tool.name === toolName),
          execute: async ({ calls, signal }) => {
            const call = calls[0]
            startedOf(call.id).resolve()
            const args = JSON.parse(call.arguments)
            const done = text => ({ results: [{ callId: call.id, result: { content: [{ type: 'text', text }], isError: false } }] })
            if (answer !== undefined) return answer(call)
            if (args.wait === undefined) return done(`${call.id} read ${args.job}`)
            const gate = Promise.withResolvers()
            waiting.set(call.id, gate)
            signals.set(call.id, signal)
            if (!ignoreSignal) signal?.addEventListener('abort', () => gate.reject(new Error('aborted')), { once: true })
            return done(await gate.promise)
          },
        }
      }
      if (name === 'approval') {
        return {
          effectivePolicy: () => (level === 'full' ? 'never' : 'ask'),
          request,
        }
      }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: level === 'full' ? 'danger-full-access' : 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
  }
  const logged = []
  const backchannel = new Backchannel({ ctx, log: line => logged.push(line) })
  const record = backchannel.mint({ sessionId: session.id, agent, name: 'Probe agent' })
  return {
    session,
    backchannel,
    record,
    logged,
    call: (callId, args) => backchannel.call(record, { name: 'job_output', arguments: args, callId }),
    running: callId => startedOf(callId).promise,
    finish: (callId, text) => waiting.get(callId).resolve(text),
    signalOf: callId => signals.get(callId),
    endTurn(reason = { kind: 'completed' }) {
      const event = session.append('turn/end', { turn: 1, reason })
      for (const listener of listeners) listener(session, event)
    },
  }
}

// The order in the issue's table: call A (a long wait), call B on the same job, B's result, the
// step's end with A still open, the next step, and only then A's result.
async function overlap(host) {
  const a = host.call(A, { job: 'job-1', wait: 240 })
  await host.running(A)
  const b = await host.call(B, { job: 'job-1' })
  assert.equal(b.isError, false)
  host.session.append('step/end', { turn: 1, step: 1 })
  // In an object: returning the promise itself would make the caller wait for A.
  return { a }
}

for (const level of ['full', 'manual']) {
  test(`#957 ${level}: call A open at step/end, its result in the next step, and the stored log loads`, async () => {
    const host = bridgeHost({ level })
    try {
      const { a } = await overlap(host)
      host.session.append('step/start', { turn: 1, step: 2 })
      host.finish(A, 'the job finished')
      const answered = await a
      host.session.append('step/end', { turn: 1, step: 2 })
      host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      assert.doesNotThrow(() => assertLoadable(host.session), 'the stored log loads through the real v4 loader')

      // The agent still gets the real result of its own call.
      assert.equal(answered.isError, false)
      assert.deepEqual(answered.content, [{ type: 'text', text: 'the job finished' }])

      // A was closed before its step/end, in step 1's own coordinates, as superseded.
      const firstEnd = seqOf(host.session, 'step/end', { turn: 1, step: 1 })
      const [closer, ...extra] = resultsOf(host.session, A)
      assert.deepEqual(extra, [], 'A has exactly one result row')
      assert.ok(closer.seq < firstEnd, 'A is closed before its step ends')
      assert.deepEqual([closer.data.turn, closer.data.step], [1, 1])
      assert.deepEqual(closer.data.error, SUPERSEDED)
      // The late result is not written: nothing after step 1's end carries its stamp, and no
      // tool row of the bridge lands in step 2.
      for (const event of host.session.snapshotEvents()) {
        if (event.seq > firstEnd && event.data?.step === 1 && !event.type.startsWith('plugin:')) assert.fail(`${event.type} at seq ${event.seq} carries the ended step's stamp`)
        if (event.data?.step === 2 && (event.type === 'tool/call' || event.type === 'tool/result')) assert.fail(`${event.type} in step 2`)
      }
      // No fake call reaches provider history.
      const derived = host.session.deriveMessages().flatMap(message => (Array.isArray(message.content) ? message.content : []))
      assert.deepEqual(derived.filter(block => block?.type === 'tool-call'), [])
    } finally {
      host.backchannel.dispose()
    }
  })
}

test('#957: a turn that ends with call A open stops A, loads, and writes no tool row after turn/end', async () => {
  const host = bridgeHost()
  try {
    const { a } = await overlap(host)
    assert.equal(host.signalOf(A).aborted, false, 'a step ending does not stop a call the agent still waits for')
    host.endTurn()
    const toolRows = () => host.session.snapshotEvents().filter(event => event.type === 'tool/call' || event.type === 'tool/result').length
    const rows = toolRows()
    assert.equal(host.signalOf(A).aborted, true, 'the turn ending stops the call')
    const answered = await a
    assert.equal(answered.isError, true)
    assert.equal(answered.error.code, 'BRIDGE_CANCELLED')
    assert.equal(toolRows(), rows, 'no tool row is written after the turn ended')
    assert.equal(resultsOf(host.session, A).length, 1)
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

// Review test 3: Stop during a body that ignores its signal.
test('#957: Stop during a bridge body that ignores its signal leaves one result and nothing after turn/end', async () => {
  const host = bridgeHost({ ignoreSignal: true })
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await host.running(A)
    // The adapter's Stop path, then what DSH's loop writes for an aborted turn.
    host.backchannel.cancel(host.record, 'the turn was stopped')
    assert.equal(host.signalOf(A).aborted, true, 'the body got its abort signal')
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user' } })
    const toolRows = () => host.session.snapshotEvents().filter(event => event.type === 'tool/call' || event.type === 'tool/result').length
    const rows = toolRows()
    host.finish(A, 'finished anyway')
    await a
    assert.equal(toolRows(), rows, 'the late body wrote no tool row')
    assert.equal(resultsOf(host.session, A).length, 1, 'exactly one result')
    assert.doesNotThrow(() => assertLoadable(host.session))
    assert.equal(host.record.closed, false, 'Stop keeps the bridge for the next turn')
  } finally {
    host.backchannel.dispose()
  }
})

// Review test 4: Stop while the approval dialog of a bridge call is open.
test('#957: Stop while a bridge approval dialog is open withdraws it, never runs the tool, one result', async () => {
  let asked
  const pending = Promise.withResolvers()
  const host = bridgeHost({
    level: 'manual',
    request: ({ signal }) => {
      asked = signal
      signal.addEventListener('abort', () => pending.resolve('unavailable'), { once: true })
      return pending.promise
    },
  })
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(asked, 'the dialog is open')
    host.backchannel.cancel(host.record)
    assert.equal(asked.aborted, true, 'the dialog is withdrawn')
    const answered = await a
    assert.equal(answered.error.code, 'BRIDGE_CANCELLED')
    assert.equal(host.signalOf(A), undefined, 'the tool never ran')
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user' } })
    assert.equal(resultsOf(host.session, A).length, 1)
    assert.equal(resultsOf(host.session, A)[0].data.error.code, 'BRIDGE_CANCELLED')
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

// Review test 6: a model switch, the kill switch and dispose all revoke the bridge.
test('#957: a bridge revoked mid-call with a slow body leaves one result and a loadable log', async () => {
  const host = bridgeHost({ ignoreSignal: true })
  const a = host.call(A, { job: 'job-1', wait: 240 })
  await host.running(A)
  host.backchannel.dispose()
  host.session.append('step/end', { turn: 1, step: 1 })
  host.session.append('step/start', { turn: 1, step: 2 })
  host.finish(A, 'finished after the revocation')
  assert.deepEqual(await a, { revoked: true })
  host.session.append('step/end', { turn: 1, step: 2 })
  host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(resultsOf(host.session, A).length, 1)
  for (const event of host.session.snapshotEvents()) {
    if (event.seq > seqOf(host.session, 'step/end', { turn: 1, step: 1 }) && event.data?.step === 1 && !event.type.startsWith('plugin:')) assert.fail(`${event.type} carries the ended step's stamp`)
  }
  assert.doesNotThrow(() => assertLoadable(host.session))
  assert.equal(Object.hasOwn(host.session, 'append'), false, 'the guard left with the last call')
})

// Review test 8: a result the log refuses still closes its call.
test('#957: a tool result that is not plain JSON gets a fallback result row, and the log loads', async () => {
  const cases = {
    content: () => ({ results: [{ result: { content: [{ type: 'text', text: 'ok', extra: undefined }], isError: false } }] }),
    error: () => ({ results: [{ result: { content: [{ type: 'text', text: 'failed' }], isError: true, error: { info: { name: Symbol('odd'), code: 7n, detail: () => {} } } } }] }),
  }
  for (const [what, answer] of Object.entries(cases)) {
    const host = bridgeHost({ answer })
    try {
      const answered = await host.call(A, { job: 'job-1' })
      host.session.append('step/end', { turn: 1, step: 1 })
      host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const [row, ...extra] = resultsOf(host.session, A)
      assert.ok(row, `${what}: the call has a result row`)
      assert.deepEqual(extra, [], `${what}: exactly one`)
      if (what === 'content') {
        assert.equal(row.data.error.code, 'BRIDGE_RESULT_NOT_JSON')
        assert.equal(answered.isError, false, 'the agent still gets the real answer')
      } else {
        assert.deepEqual(row.data.error, { name: 'Error' }, 'only string fields enter the row')
      }
      assert.doesNotThrow(() => assertLoadable(host.session), what)
    } finally {
      host.backchannel.dispose()
    }
  }
})

// Review test 7 (the back-channel half): a caller that goes away stops its call.
test('#957: a client that disconnects mid-call aborts the body and the call is closed', async () => {
  const host = bridgeHost()
  try {
    await host.backchannel.listen()
    const client = new AbortController()
    const posted = fetch(host.backchannel.urlFor(host.record), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${host.record.credential}` },
      body: JSON.stringify({ op: 'call', name: 'job_output', arguments: { job: 'job-1', wait: 240 }, callId: A }),
      signal: client.signal,
    }).catch(error => error)
    await host.running(A)
    client.abort()
    await posted
    await new Promise((resolve) => {
      if (host.signalOf(A).aborted) return resolve()
      host.signalOf(A).addEventListener('abort', resolve, { once: true })
    })
    for (let i = 0; i < 50 && resultsOf(host.session, A).length === 0; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(resultsOf(host.session, A)[0].data.error.code, 'BRIDGE_CANCELLED')
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

test('#957: turn/end alone (no step/end before it) still closes an open call first', async () => {
  const host = bridgeHost()
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await host.running(A)
    // DSH always writes step/end first; a turn/end is guarded all the same.
    const before = host.session.snapshotEvents().length
    host.endTurn()
    const [closer] = resultsOf(host.session, A)
    assert.ok(closer, 'A was closed')
    assert.equal(closer.seq, before)
    assert.deepEqual(closer.data.error, CANCELLED)
    assert.equal(host.signalOf(A).aborted, true)
    assert.doesNotThrow(() => assertLoadable(host.session))
    host.finish(A, 'late')
    await a
  } finally {
    host.backchannel.dispose()
  }
})

test('#957: a call DSH already closed (its own interrupted-step recovery) is not closed twice', async () => {
  const host = bridgeHost()
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await host.running(A)
    // What the agent loop's ToolCallRecovery writes for a pending call when a step fails.
    host.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: A, content: [{ type: 'text', text: 'interrupted' }], isError: true }),
      error: { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' },
    }, { surfaceOp: 'append', sourceEventSeqs: [callsOf(host.session, A)[0].seq] })
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('step/start', { turn: 1, step: 2 })
    host.finish(A, 'after the recovery')
    await a
    host.session.append('step/end', { turn: 1, step: 2 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    assert.equal(resultsOf(host.session, A).length, 1, 'only the recovery result answers A')
    assert.equal(host.session.snapshotEvents().filter(event => event.type === 'tool/result').length, 1)
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

test('#957: a call that resolves inside its own step writes the same rows as before', async () => {
  const host = bridgeHost()
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await host.running(A)
    host.finish(A, 'in time')
    await a
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const events = host.session.snapshotEvents()
    assert.equal(events.filter(event => event.type === 'tool/call').length, 1)
    assert.equal(events.filter(event => event.type === 'tool/result').length, 1)
    assert.equal(textOf(resultsOf(host.session, A)[0]), 'in time')
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

// The second broken session: the error names an id that has no tool/call row at all. The
// advertisement was written, the call row was not, and hiding the advertisement only takes it
// off the surface: the loader still counts the advertised call and refuses the step's end.
test('#957: a call whose tool/call row cannot be written is answered as not started, and the log loads', async () => {
  const host = bridgeHost()
  try {
    const guarded = host.session.append
    host.session.append = (type, ...rest) => {
      if (type === 'tool/call') throw new Error('the call row was refused')
      return guarded.call(host.session, type, ...rest)
    }
    const answered = await host.call(A, { job: 'job-1' })
    assert.equal(answered.error.code, 'BRIDGE_RECORD_FAILED')
    assert.equal(host.signalOf(A), undefined, 'the tool never ran')
    host.session.append = guarded
    assert.deepEqual(callsOf(host.session, A), [], 'the log has no tool/call row for the id')
    const [row, ...extra] = resultsOf(host.session, A)
    assert.deepEqual(extra, [])
    assert.deepEqual(row.data.error, { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' })
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

// Tester 2's cases on this PR's first head (Bug A, B1, B2), kept as regressions.
test('#957: Stop on a body that ignores its signal and resolves before step/end is BRIDGE_CANCELLED, not its output', async () => {
  const host = bridgeHost({ ignoreSignal: true })
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await host.running(A)
    host.backchannel.cancel(host.record, 'the turn was stopped')
    host.finish(A, 'stale output after stop')
    const answered = await a
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user' } })
    assert.equal(answered.isError, true)
    assert.equal(answered.error?.code, 'BRIDGE_CANCELLED')
    assert.equal(resultsOf(host.session, A)[0].data.error.code, 'BRIDGE_CANCELLED')
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})

test('#957: a call revoked in step 1 and closed at its step/end writes no late rows into step 2', async () => {
  const host = bridgeHost({ ignoreSignal: true })
  const a = host.call(A, { job: 'job-1', wait: 240 })
  await host.running(A)
  host.backchannel.dispose()
  host.session.append('step/end', { turn: 1, step: 1 })
  host.session.append('step/start', { turn: 1, step: 2 })
  host.finish(A, 'finished after revocation')
  assert.deepEqual(await a, { revoked: true })
  host.session.append('step/end', { turn: 1, step: 2 })
  host.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const rows = host.session.snapshotEvents().filter(event => event.data?.step === 2 && (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'assistant/message'))
  assert.deepEqual(rows, [])
  assert.doesNotThrow(() => assertLoadable(host.session))
})

test('#957: a call stopped in turn 1 whose body ignores its signal writes nothing into turn 2', async () => {
  const host = bridgeHost({ ignoreSignal: true })
  try {
    const a = host.call(A, { job: 'job-1', wait: 240 })
    await host.running(A)
    host.backchannel.cancel(host.record, 'the turn was stopped')
    host.session.append('step/end', { turn: 1, step: 1 })
    host.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user' } })
    host.session.append('turn/start', { turn: 2 })
    host.session.append('step/start', { turn: 2, step: 1 })
    host.finish(A, 'stale output from turn 1')
    await a
    host.session.append('step/end', { turn: 2, step: 1 })
    host.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const rows = host.session.snapshotEvents().filter(event => event.data?.turn === 2 && (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'assistant/message'))
    assert.deepEqual(rows, [])
    assert.doesNotThrow(() => assertLoadable(host.session))
  } finally {
    host.backchannel.dispose()
  }
})
