// The write-time guard (#958): the bridge never stores a row DSH's Session reader refuses. The
// real Backchannel writes on a real Session, the test ends steps and turns as DSH's loop does,
// and each log is loaded with the pinned v4 reader.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import { SYNTHETIC_KIND } from '../src/host/names.js'
import { CANCELLED, GUARD_RECORD, NOT_JSON, SUPERSEDED, guardSession, isPlainJson } from '../src/host/write-guard.js'
import { assertLoadable, bridgeHost, eventsOf, loadError, resultsOf, ticks } from './support/bridge-host.js'

const reportsOf = session => session.snapshotEvents().map(pluginRecordOf).filter(record => record?.type === GUARD_RECORD).map(record => record.data)
const surfaceAdverts = session => session.deriveMessages()
  .filter(message => message.source?.synthetic === SYNTHETIC_KIND)

function opened(options) {
  const host = bridgeHost(options)
  host.mint()
  host.startTurn()
  host.startStep()
  return host
}

test('without the guard, a call open at step/end makes the log unloadable (the control)', async () => {
  const host = opened({ guard: false })
  void host.call({ callId: 'bridge_a' })
  await ticks()
  host.endStep()
  assert.match(String(loadError(host.session)?.message), /step\/end leaves unresolved tool call bridge_a/)
})

test('a call still open at step/end is closed as superseded first, and its late result is not written', async () => {
  const host = opened()
  const answer = host.call({ callId: 'bridge_a' })
  await ticks()
  host.endStep()
  assertLoadable(host.session, ' after step/end')
  const [closing] = resultsOf(host.session, 'bridge_a')
  assert.equal(closing.data.step, 1)
  assert.equal(closing.data.message.isError, true)
  assert.deepEqual(closing.data.error, SUPERSEDED)
  assert.ok(closing.seq < eventsOf(host.session, 'step/end')[0].seq, 'the closing result is before step/end')

  host.startStep()
  host.finish('ok')
  const body = await answer
  // The agent still gets the real answer; the log keeps the one result the call already has.
  assert.equal(body.isError, false)
  assert.equal(body.content[0].text, 'probe ran')
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
  host.endStep()
  host.endTurn()
  assertLoadable(host.session, ' at the end')
  assert.deepEqual(surfaceAdverts(host.session), [], 'no advertisement is left on the surface')
  const kinds = reportsOf(host.session).map(report => [report.kind, report.callId])
  assert.deepEqual(kinds, [['call-closed', 'bridge_a'], ['result-dropped', 'bridge_a']])
  assert.ok(host.logs.some(line => /write guard: call-closed/.test(line)), 'the repair is logged too')
})

test('issue 957\'s order: call A, call B, result B, step end, late result A', async () => {
  const host = opened()
  const first = host.call({ callId: 'bridge_a' })
  await ticks()
  const second = host.call({ callId: 'bridge_b' })
  await ticks()
  // B's body is the second one the bridge reached.
  host.bodies[1].done = true
  host.bodies[1].resolve({ results: [{ callId: 'bridge_b', result: { content: [{ type: 'text', text: 'b' }], isError: false } }] })
  await second
  host.endStep()
  host.startStep()
  host.finish('ok')
  await first
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
  assert.equal(resultsOf(host.session, 'bridge_b').length, 1)
  assert.equal(resultsOf(host.session, 'bridge_b')[0].data.message.isError, false)
})

test('a turn/end over an open step with an open call ends the call as cancelled and the step first', async () => {
  const host = opened()
  const answer = host.call({ callId: 'bridge_a' })
  await ticks()
  host.endTurn()
  assertLoadable(host.session)
  assert.deepEqual(resultsOf(host.session, 'bridge_a')[0].data.error, CANCELLED)
  assert.equal(eventsOf(host.session, 'step/end').length, 1)
  host.finish('ok')
  await answer
  assertLoadable(host.session, ' after the late result')
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
})

test('an advertisement whose call never started gets DSH\'s own not-started repair', async () => {
  const host = opened()
  // The advertisement alone, as a bridge that died between its two rows leaves it.
  const { createAssistantMessage } = await import('@deepseek-ai/dsh-llm')
  host.session.append('assistant/message', {
    turn: 1,
    step: 1,
    stream: [],
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: 'bridge_lost', name: 'bash', arguments: '{}' }],
      source: { provider: 'acp-probe', model: 'probe-model', bridge: true, synthetic: SYNTHETIC_KIND },
    }),
  }, { surfaceOp: 'append' })
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  const [repair] = resultsOf(host.session, 'bridge_lost')
  assert.equal(repair.data.error.code, 'TOOL_NOT_STARTED')
  assert.deepEqual(surfaceAdverts(host.session), [])
})

test('a result stamped with an ended step, a second result, and one for no call are not written', async () => {
  const host = opened()
  const answer = host.call({ callId: 'bridge_a' })
  await ticks()
  host.finish('ok')
  await answer
  const row = step => [{ turn: 1, step, message: createToolResultMessage({ callId: 'bridge_a', content: [], isError: false }) }, { surfaceOp: 'append' }]
  assert.equal(host.session.append('tool/result', ...row(1)).dropped, true, 'a second result')
  host.endStep()
  host.startStep()
  assert.equal(host.session.append('tool/result', ...row(1)).dropped, true, 'a result stamped with the ended step')
  assert.equal(host.session.append('tool/result', { turn: 1, step: 2, message: createToolResultMessage({ callId: 'bridge_none', content: [], isError: false }) }, { surfaceOp: 'append' }).dropped, true, 'a result for no call')
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
  assert.deepEqual(reportsOf(host.session).map(report => report.kind), ['result-dropped', 'result-dropped', 'result-dropped'], host.logs.join('\n'))
})

test('a duplicate call id while the first is open is refused, and the first still loads', async () => {
  const host = opened()
  const first = host.call({ callId: 'bridge_same' })
  await ticks()
  const second = await host.call({ callId: 'bridge_same' })
  assert.equal(second.isError, true)
  assert.equal(second.error.code, 'BRIDGE_RECORD_FAILED')
  host.finish('ok')
  await first
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_same').length, 1)
})

test('a tool/call with no advertisement is refused before it is stored', () => {
  const host = opened()
  assert.throws(() => host.session.append('tool/call', { turn: 1, step: 1, callId: 'bridge_bare', name: 'bash', arguments: '{}' }), { code: 'BRIDGE_WRITE_REFUSED' })
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(eventsOf(host.session, 'tool/call').length, 0)
})

test('an error whose name and code are not strings, and data that is not JSON, still leave a loadable row', async () => {
  const host = opened()
  const odd = host.call({ callId: 'bridge_odd' })
  await ticks()
  host.finish('throw-odd')
  await odd
  assert.deepEqual(resultsOf(host.session, 'bridge_odd')[0].data.error, { name: 'Error' })

  // A result row whose content is not plain JSON, written straight at the Session.
  const raw = host.call({ callId: 'bridge_raw' })
  await ticks()
  const message = { ...createToolResultMessage({ callId: 'bridge_raw', content: [], isError: true }), content: [{ type: 'text', text: 'x', at: new Date(0), size: 1n }] }
  const written = host.session.append('tool/result', { turn: 1, step: 1, message, error: { name: 'E' } }, { surfaceOp: 'append' })
  assert.deepEqual(written.data.error, NOT_JSON)
  host.finish('ok')
  await raw
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_raw').length, 1)
  assert.equal(isPlainJson({ a: [1, 'x', null, { b: true }] }), true)
  assert.equal(isPlainJson({ a: undefined }), false)
  assert.equal(isPlainJson({ a: Number.NaN }), false)
})

test('a bridge revoked while its call runs leaves a loadable log, and the guard goes with the last bridge', async () => {
  const host = opened()
  const plain = Object.hasOwn(host.session, 'append')
  assert.equal(plain, true, 'the guard stands in front of append while a bridge is live')
  const second = guardSession(host.session)
  const answer = host.call({ callId: 'bridge_a' })
  await ticks()
  host.backchannel.revoke(host.record)
  host.finish('ok')
  assert.deepEqual(await answer, { revoked: true })
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
  assert.equal(Object.hasOwn(host.session, 'append'), true, 'another hold keeps the guard')
  second.release()
  second.release()
  assert.equal(Object.hasOwn(host.session, 'append'), false, 'the Session has its own append back')
})

test('a wrapper stacked on the guard keeps working after the guard is released', () => {
  const host = opened()
  const under = host.session.append
  let seen = 0
  host.session.append = (...args) => {
    seen += 1
    return under(...args)
  }
  host.backchannel.revoke(host.record)
  host.endStep()
  host.endTurn()
  assert.equal(seen, 2)
  assertLoadable(host.session)
})

test('a guard installed mid-turn reads the calls already open from the log', async () => {
  const host = opened()
  const answer = host.call({ callId: 'bridge_a' })
  await ticks()
  // The bridge is replaced (a fork, a reload): the new guard starts from the log as it stands.
  host.backchannel.revoke(host.record)
  host.mint()
  host.endStep()
  assertLoadable(host.session)
  host.finish('ok')
  await answer
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
})


test('a batch closes a running bridge call before its step and turn end', async () => {
  const host = opened()
  const answer = host.call({ callId: 'bridge_batch' })
  await ticks()
  const written = host.session.append([
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: 'stop' }],
  ])
  assert.deepEqual(written.map(event => event.type), ['step/end', 'turn/end'])
  assert.equal(resultsOf(host.session, 'bridge_batch').length, 1)
  assert.ok(resultsOf(host.session, 'bridge_batch')[0].seq < written[0].seq)
  assertLoadable(host.session)
  host.finish('ok')
  await answer
  assert.equal(resultsOf(host.session, 'bridge_batch').length, 1)
  assert.ok(reportsOf(host.session).some(report => report.kind === 'result-dropped'))
})

test('a batch updates guard observation before a later single append', async () => {
  const host = bridgeHost()
  host.mint()
  host.session.append([['turn/start', { turn: 1 }], ['step/start', { turn: 1, step: 1 }]])
  assert.throws(() => host.session.append('tool/call', { turn: 1, step: 1, callId: 'unadvertised_batch', name: 'bash', arguments: {} }), /no advertisement/)
  assert.equal(eventsOf(host.session, 'tool/call').length, 0)
})

test('a rejected batch publishes no partial repairs and leaves the guard ready', async () => {
  const host = opened()
  const answer = host.call({ callId: 'bridge_atomic' })
  await ticks()
  const before = host.session.snapshotEvents()
  assert.throws(() => host.session.append([
    ['step/end', { turn: 1, step: 1 }],
    ['turn/end', { turn: 1, reason: 'stop', invalid: 1n }],
  ]))
  assert.deepEqual(host.session.snapshotEvents(), before, 'native batch rejection is atomic, including repairs/reports')
  host.endStep()
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_atomic').length, 1)
  host.finish('ok')
  await answer
})
