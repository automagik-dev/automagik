// The advertisement a stopped app left (#971, lifecycle review 13). A bridge call writes a marked
// assistant block and hides it when the call settles. When the app stops in the middle of the
// call, DSH's own closers make the log loadable at the next start, but the block stays on the
// surface: the write guard hid only the advertisements of the open turn. It now hides one an
// earlier turn left too, before the first step that ends on a Session a bridge serves again.
//
// The real Session, the real Backchannel and the pinned v4 reader, as write-guard.test.js. The
// earlier run is written as it leaves the log: the bridge's two rows, then DSH's closers.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssistantMessage, createDeveloperMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallRecovery, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { SYNTHETIC_KIND } from '../src/host/names.js'
import { GUARD_RECORD } from '../src/host/write-guard.js'
import { assertLoadable, bridgeHost, eventsOf, resultsOf, ticks } from './support/bridge-host.js'

const ROUTE = { provider: 'acp-probe', model: 'probe-model' }
const reportsOf = session => session.snapshotEvents().map(pluginRecordOf).filter(record => record?.type === GUARD_RECORD).map(record => record.data)
const hiddenReports = session => reportsOf(session).filter(report => report.kind === 'advertisement-hidden')
const isAdvert = message => message.source?.synthetic === SYNTHETIC_KIND
const surfaceAdverts = session => session.deriveMessages().filter(isAdvert)
const advertIds = session => surfaceAdverts(session).flatMap(message => message.content.filter(block => block.type === 'tool-call').map(block => block.id))
/**
 * The model surface without the bridge's own blocks: the messages a later request is built
 * from. Not the person's transcript, whose tool cards come from the rows themselves and stay.
 */
const others = session => session.deriveMessages()
  .filter(message => !isAdvert(message) && message.source?.kind !== SYNTHETIC_KIND)
  .map(message => ({ role: message.role, id: message.id, content: message.content }))
const hides = session => eventsOf(session, 'developer/message').filter(event => event.data.message?.source?.kind === SYNTHETIC_KIND)

const say = (host, text) => host.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
const answer = (host, text) => host.session.append('assistant/message', {
  turn: host.turn,
  step: host.step,
  stream: [],
  message: createAssistantMessage({ content: [{ type: 'text', text }], source: ROUTE }),
}, { surfaceOp: 'append' })

/**
 * The bridge's advertisement, and the `tool/call` row of each call that got that far. One id, or
 * several for a block that advertises more than one call.
 */
function advertise(host, callId, { started = true } = {}) {
  const ids = [callId].flat()
  const row = host.session.append('assistant/message', {
    turn: host.turn,
    step: host.step,
    stream: [],
    message: createAssistantMessage({
      content: ids.map(id => ({ type: 'tool-call', id, name: 'bash', arguments: '{}' })),
      source: { ...ROUTE, bridge: true, synthetic: SYNTHETIC_KIND },
    }),
  }, { surfaceOp: 'append' })
  if (started) for (const id of ids) host.session.append('tool/call', { turn: host.turn, step: host.step, callId: id, name: 'bash', arguments: '{}' })
  return row.seq
}

/** The result row of one call, in the open step. */
const resolve = (host, callId) => host.session.append('tool/result', {
  turn: host.turn,
  step: host.step,
  message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'probe ran' }], isError: false }),
}, { surfaceOp: 'append' })

/** From here the Session refuses the result row of these calls: nothing can close them. */
function refuseResults(host, ...callIds) {
  const append = host.session.append.bind(host.session)
  host.session.append = (type, data, ...rest) => {
    if (type === 'tool/result' && callIds.includes(data?.message?.toolCallId)) throw new Error('refused by the probe')
    return append(type, data, ...rest)
  }
}

/**
 * One turn of an earlier run that stopped in the middle of a bridge call: the person's message,
 * the bridge's rows, then what DSH writes at the next start (its own closers, the step's end and
 * the turn's). No bridge is live while this is written, as none is at a start.
 */
function stoppedTurn(host, callId, { started = true } = {}) {
  host.startTurn()
  host.startStep()
  say(host, `please run ${callId}`)
  const seq = advertise(host, callId, { started })
  const recovery = new ToolCallRecovery()
  for (const event of host.session.snapshotEvents()) recovery.observe(event)
  for (const closer of recovery.results()) host.session.append('tool/result', closer.data, { surfaceOp: 'append' })
  host.endStep()
  host.endTurn()
  return seq
}

/** The next turn, on a Session a bridge serves again: its first step is open. */
function nextTurn(host, { bridge = true } = {}) {
  host.startTurn()
  host.startStep()
  say(host, 'and now?')
  if (bridge) host.mint()
}

/** No advertisement leaves the surface while its call has no result: that call may be running. */
function assertNoOpenCallHidden(session) {
  const onSurface = new Set(advertIds(session))
  for (const event of eventsOf(session, 'assistant/message')) {
    if (event.data.message?.source?.synthetic !== SYNTHETIC_KIND) continue
    for (const block of event.data.message.content) {
      if (block.type !== 'tool-call' || onSurface.has(block.id)) continue
      assert.ok(resultsOf(session, block.id).length > 0, `${block.id} was hidden with no result`)
    }
  }
}

test('control: after the stop and DSH\'s closers the log loads, and the block is still on the surface', () => {
  const host = bridgeHost()
  stoppedTurn(host, 'bridge_lost')
  assertLoadable(host.session)
  assert.deepEqual(advertIds(host.session), ['bridge_lost'])
  assert.equal(resultsOf(host.session, 'bridge_lost')[0].data.error.code, 'TOOL_OUTCOME_UNKNOWN')
})

test('a started call the app stopped in: the next turn\'s first step end hides its block, and says so', () => {
  const host = bridgeHost()
  const seq = stoppedTurn(host, 'bridge_lost')
  nextTurn(host)
  const before = others(host.session)
  assert.deepEqual(advertIds(host.session), ['bridge_lost'], 'not hidden when the guard is installed')
  host.endStep()
  assert.deepEqual(advertIds(host.session), [])
  assertLoadable(host.session)
  assert.deepEqual(hiddenReports(host.session), [{ kind: 'advertisement-hidden', seq, from: 1, turn: 2, step: 1, before: 'step/end' }])
  // The hide is a row of the open step, the only stamp the reader takes now.
  const [hide] = hides(host.session)
  assert.deepEqual({ turn: hide.data.turn, step: hide.data.step, op: hide.surfaceOp }, { turn: 2, step: 1, op: { op: 'replace', startSeq: seq, endSeq: seq } })
  assert.deepEqual(others(host.session), before, 'nothing else on the surface changed')
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_lost').length, 1, 'its one result is the one DSH wrote')
  assertNoOpenCallHidden(host.session)
})

test('a call that never started: its block is hidden the same way', () => {
  const host = bridgeHost()
  const seq = stoppedTurn(host, 'bridge_unstarted', { started: false })
  assert.equal(resultsOf(host.session, 'bridge_unstarted')[0].data.error.code, 'TOOL_NOT_STARTED')
  nextTurn(host)
  host.endStep()
  host.endTurn()
  assert.deepEqual(advertIds(host.session), [])
  assertLoadable(host.session)
  assert.deepEqual(hiddenReports(host.session).map(report => report.seq), [seq])
  assertNoOpenCallHidden(host.session)
})

test('two stopped turns: both blocks are hidden at the first step end, and no later one writes again', () => {
  const host = bridgeHost()
  const first = stoppedTurn(host, 'bridge_one')
  const second = stoppedTurn(host, 'bridge_two', { started: false })
  nextTurn(host)
  assert.deepEqual(advertIds(host.session), ['bridge_one', 'bridge_two'])
  host.endStep()
  assert.deepEqual(advertIds(host.session), [])
  assert.deepEqual(hiddenReports(host.session).map(report => [report.seq, report.from]), [[first, 1], [second, 2]])
  const written = hides(host.session).length
  host.startStep()
  answer(host, 'done')
  host.endStep()
  host.endTurn()
  host.startTurn()
  host.startStep()
  host.endStep()
  host.endTurn()
  assert.equal(hides(host.session).length, written, 'each block is hidden once')
  assert.equal(hiddenReports(host.session).length, 2)
  assertLoadable(host.session)
})

test('a turn that ends over its open step hides the block before it', () => {
  const host = bridgeHost()
  stoppedTurn(host, 'bridge_lost')
  nextTurn(host)
  host.endTurn()
  assert.deepEqual(advertIds(host.session), [])
  assertLoadable(host.session)
  assert.equal(hiddenReports(host.session)[0].before, 'turn/end')
})

test('control: with no bridge in the later turn nothing guards the Session, and the block stays', () => {
  const host = bridgeHost()
  stoppedTurn(host, 'bridge_lost')
  nextTurn(host, { bridge: false })
  host.endStep()
  host.endTurn()
  assert.deepEqual(advertIds(host.session), ['bridge_lost'])
  assert.deepEqual(hides(host.session), [])
  assertLoadable(host.session)
})

test('a block already taken off the surface gets no hide and no report', () => {
  const host = bridgeHost()
  const seq = stoppedTurn(host, 'bridge_lost')
  // Something else replaced it meanwhile (a compaction over that part of the chat).
  host.startTurn()
  host.startStep()
  host.session.append('developer/message', { turn: host.turn, step: host.step, message: createDeveloperMessage({ content: [], source: { kind: 'probe-compaction' } }) }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
  assert.deepEqual(advertIds(host.session), [])
  host.mint()
  host.endStep()
  host.endTurn()
  assert.deepEqual(hides(host.session), [])
  assert.deepEqual(hiddenReports(host.session), [])
  assertLoadable(host.session)
})

test('a guard installed mid-turn with a stale block and a live call: nothing is hidden at once, and the live call keeps its block while its step is open', async () => {
  const host = bridgeHost()
  const stale = stoppedTurn(host, 'bridge_lost')
  host.startTurn()
  host.startStep()
  say(host, 'run it again')
  answer(host, 'on it')
  // The bridge arrives in the middle of the turn (a fork, a reload) and takes a call.
  host.mint()
  const before = others(host.session)
  const running = host.call({ callId: 'bridge_live' })
  await ticks()
  assert.equal(host.bodies.length, 1, 'the live call is running')
  assert.deepEqual(advertIds(host.session), ['bridge_lost', 'bridge_live'], 'neither block is hidden while the step is open')
  assert.deepEqual(hides(host.session), [])
  assert.deepEqual(hiddenReports(host.session), [])
  assertLoadable(host.session)
  // The live call answers inside its step: the bridge hides its own block, and only that one.
  host.finish('ok')
  await running
  assert.deepEqual(advertIds(host.session), ['bridge_lost'])
  assert.equal(hides(host.session).length, 1)
  assert.deepEqual(hiddenReports(host.session), [], 'its own hide is not a repair')
  host.endStep()
  assert.deepEqual(advertIds(host.session), [])
  assert.deepEqual(hiddenReports(host.session).map(report => report.seq), [stale])
  host.endTurn()
  assertLoadable(host.session)
  // The person's messages, the answer and the tool rows around them are as they were; the
  // live call's result is the only one added.
  const after = others(host.session)
  assert.deepEqual(after.filter(message => before.some(kept => kept.id === message.id)), before)
  assert.deepEqual(after.filter(message => !before.some(kept => kept.id === message.id)).map(message => message.role), ['tool'])
  assert.equal(resultsOf(host.session, 'bridge_live')[0].data.message.isError, false, 'its real result, not a closer')
  assertNoOpenCallHidden(host.session)
})

test('a live call still running at its step end is closed there as before, beside the stale block', async () => {
  const host = bridgeHost()
  const stale = stoppedTurn(host, 'bridge_lost')
  nextTurn(host)
  const running = host.call({ callId: 'bridge_live' })
  await ticks()
  host.endStep()
  // Today's rule for the open turn is unchanged: the open call is closed first, then hidden.
  assert.equal(resultsOf(host.session, 'bridge_live')[0].data.error.code, 'BRIDGE_CALL_SUPERSEDED')
  assert.deepEqual(advertIds(host.session), [])
  assert.deepEqual(hiddenReports(host.session).map(report => report.seq), [stale], 'only the stale one is reported as a repair')
  assertLoadable(host.session)
  host.finish('ok')
  await running
  host.endTurn()
  assertLoadable(host.session)
  assert.equal(resultsOf(host.session, 'bridge_live').length, 1)
  assertNoOpenCallHidden(host.session)
})

test('a block of an earlier turn whose call could not be closed is left on the surface: that call may still run', () => {
  const host = bridgeHost()
  // An earlier turn that ended with its call open, and no closer after it: not a log DSH
  // leaves, but the guard must not take the block away on the strength of the turn alone.
  host.startTurn()
  host.startStep()
  advertise(host, 'bridge_open')
  host.endStep()
  host.endTurn()
  host.startTurn()
  host.startStep()
  // The Session refuses the row that would close it.
  refuseResults(host, 'bridge_open')
  host.mint()
  host.endStep()
  assert.equal(resultsOf(host.session, 'bridge_open').length, 0, 'the call is still open')
  assert.deepEqual(advertIds(host.session), ['bridge_open'], 'its block is not hidden')
  assert.deepEqual(hiddenReports(host.session), [])
  assertNoOpenCallHidden(host.session)
})

test('a guard installed on a log that already holds a stale block and a running call\'s block keeps the running one', () => {
  const host = bridgeHost()
  const stale = stoppedTurn(host, 'bridge_lost')
  host.startTurn()
  host.startStep()
  say(host, 'run it again')
  // The call was advertised and started before this guard existed (a bridge replaced mid-call):
  // the guard learns both blocks from the log alone.
  const live = advertise(host, 'bridge_running')
  const before = others(host.session)
  host.mint()
  assert.deepEqual(advertIds(host.session), ['bridge_lost', 'bridge_running'], 'installing the guard hides nothing')
  assert.deepEqual(hides(host.session), [])
  assert.deepEqual(hiddenReports(host.session), [])
  assert.deepEqual(others(host.session), before)
  assertLoadable(host.session)
  // The step ends with the call still open: it is closed first, as any open call of the turn,
  // and only then is its block hidden. The stale one goes with it, and alone is a repair.
  host.endStep()
  assert.equal(resultsOf(host.session, 'bridge_running')[0].data.error.code, 'BRIDGE_CALL_SUPERSEDED')
  assert.deepEqual(advertIds(host.session), [], 'the guard knew the running block from the log')
  assert.deepEqual(hides(host.session).map(event => event.surfaceOp.startSeq).toSorted(), [stale, live].toSorted())
  assert.deepEqual(hiddenReports(host.session).map(report => report.seq), [stale])
  host.endTurn()
  assertLoadable(host.session)
  assertNoOpenCallHidden(host.session)
})

test('a block of an earlier turn that advertises two calls stays while one of them has no result', () => {
  const host = bridgeHost()
  host.startTurn()
  host.startStep()
  advertise(host, ['bridge_a', 'bridge_b'])
  resolve(host, 'bridge_a')
  host.endStep()
  host.endTurn()
  host.startTurn()
  host.startStep()
  refuseResults(host, 'bridge_b')
  host.mint()
  host.endStep()
  assert.equal(resultsOf(host.session, 'bridge_a').length, 1)
  assert.equal(resultsOf(host.session, 'bridge_b').length, 0, 'the second call is still open')
  assert.deepEqual(advertIds(host.session), ['bridge_a', 'bridge_b'], "one call's result does not release the block")
  assert.deepEqual(hiddenReports(host.session), [])
  assertNoOpenCallHidden(host.session)
})

test("an unrelated call's result does not release another block: the completed one is hidden, the open one stays", () => {
  const host = bridgeHost()
  host.startTurn()
  host.startStep()
  advertise(host, 'bridge_open')
  const done = advertise(host, 'bridge_done')
  resolve(host, 'bridge_done')
  host.endStep()
  host.endTurn()
  host.startTurn()
  host.startStep()
  refuseResults(host, 'bridge_open')
  host.mint()
  host.endStep()
  assert.equal(resultsOf(host.session, 'bridge_open').length, 0)
  assert.deepEqual(advertIds(host.session), ['bridge_open'], 'only the block whose call has its result is hidden')
  assert.deepEqual(hiddenReports(host.session).map(report => report.seq), [done])
  assertNoOpenCallHidden(host.session)
})
