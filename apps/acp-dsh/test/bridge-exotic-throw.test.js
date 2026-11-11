// Whatever a DSH tool throws, its bridged call is closed with one plain-JSON result (#855,
// item 1). A tool body is somebody else's code: it can throw a Symbol, an object with no
// prototype, nothing at all, or an error whose own fields throw when read. Building the
// result's text from such a value used to throw in turn, the call got no `tool/result` row,
// and a Session with a call left open does not load. #979 added a last recovery for a call
// whose settlement fails; it covered the plain cases and still read the thrown value again.
// These rows pin every such value, with the recovery made independent of what was thrown.
//
// The real Backchannel, Session and write guard, and the pinned reader (`assertLoadable`).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertLoadable, bridgeHost, eventsOf, resultsOf, ticks } from './support/bridge-host.js'

// One bridge call whose tool body ends as `end` says (`reject` with a value, or `resolve`
// with DSH's own result shape), on a Session at `level`. The call's rows are read as they
// stand when the agent is answered, BEFORE the step ends: at a step's end the write guard
// closes any call still open, which would hide a call this left with no result.
async function settled(end, { level = 'full', callId = 'probe-855-throw', guard = true } = {}) {
  const host = bridgeHost({ id: `probe-855-${level}`, level, guard })
  host.mint()
  host.startTurn()
  host.startStep()
  const answering = host.call({ callId })
  // Manual asks first; the dialog is answered, then the body is reached.
  for (let turn = 0; turn < 50 && host.bodies.length === 0; turn += 1) {
    host.answer('allowed-once')
    await ticks(1)
  }
  assert.equal(host.bodies.length, 1, 'the tool body was reached')
  const body = host.bodies[0]
  body.done = true
  if ('reject' in end) body.reject(end.reject)
  else body.resolve({ results: [{ callId: body.call.id, result: end.resolve }] })
  const answer = await answering
  const calls = eventsOf(host.session, 'tool/call').filter(event => event.data.callId === callId)
  const results = resultsOf(host.session, callId)
  return { host, answer, calls, results }
}

// What every row asserts of a call that failed: the agent can read why, the call has its one
// plain-JSON result naming a string error, and the Session loads once its step and turn end.
function assertClosed({ host, answer, calls, results }, note) {
  assert.equal(answer.isError, true)
  // What the agent is answered with is plain JSON too: it is sent over HTTP as it is.
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer)
  assert.ok(Array.isArray(answer.content) && answer.content.length > 0)
  assert.ok(answer.content.every(block => block.type === 'text' && typeof block.text === 'string' && block.text !== ''), 'the answer is text')
  assert.equal(calls.length, 1)
  assert.equal(results.length, 1, 'the call has its one result when the agent is answered')
  const row = results[0].data
  assert.equal(row.message.isError, true)
  // Plain JSON through and through: it survives a round trip unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row)
  // The error it names: a string name, and a code only when it is a string.
  assert.equal(typeof row.error?.name, 'string')
  assert.ok(row.error.name !== '')
  assert.ok(row.error.code === undefined || typeof row.error.code === 'string')
  assert.deepEqual(Object.keys(row.error).filter(key => key !== 'name' && key !== 'code'), [])
  // Nothing more is written for it when its step and turn end, and the Session loads.
  host.endStep()
  host.endTurn()
  assert.equal(resultsOf(host.session, calls[0].data.callId).length, 1, 'no second result at the boundary')
  assertLoadable(host.session, note)
  return row
}

// A value that throws itself whenever anything of it is read.
function selfThrowing() {
  const bad = new Proxy({}, { get() { throw bad }, has() { throw bad }, ownKeys() { throw bad }, getPrototypeOf() { throw bad } })
  return bad
}

const EXOTIC = [
  ['a Symbol', () => Symbol('odd')],
  ['an object with no prototype', () => Object.create(null)],
  ['an object with no prototype and fields', () => Object.assign(Object.create(null), { code: 7n, name: Symbol('name') })],
  ['undefined', () => undefined],
  ['null', () => null],
  ['a number', () => 42],
  ['a BigInt', () => 7n],
  ['a function', () => function thrown() {}],
  ['an error whose message throws when read', () => Object.defineProperty(new Error('x'), 'message', { get() { throw new Error('no message for you') } })],
  ['an error whose message throws a Symbol when read', () => Object.defineProperty(new Error('x'), 'message', { get() { throw Symbol('again') } })],
  ['an error whose name throws when read', () => Object.defineProperty(new Error('named'), 'name', { get() { throw Object.create(null) } })],
  ['an error whose code throws when read', () => Object.defineProperty(new Error('coded'), 'code', { get() { throw Symbol('code') } })],
  ['an error whose name and code are not strings', () => Object.assign(new Error('odd'), { name: Symbol('n'), code: { deep: 1n } })],
  ['an object whose every field throws', () => new Proxy({}, { get() { throw new Error('closed') } })],
  ['an object that throws itself whenever it is read', selfThrowing],
  ['an object whose string form throws a Symbol', () => ({ toString() { throw Symbol('no string') }, [Symbol.toPrimitive]() { throw Symbol('no primitive') } })],
  ['a cyclic object', () => { const loop = { name: 'Loop' }; loop.self = loop; return loop }],
]

for (const level of ['full', 'manual']) {
  for (const [what, make] of EXOTIC) {
    test(`#855.1 ${level}: a tool that throws ${what} still closes its call with a plain result`, async () => {
      assertClosed(await settled({ reject: make() }, { level }), `${level}: ${what}`)
    })
  }
  test(`#855.1 ${level}: a tool whose own error object cannot be read still closes its call`, async () => {
    // The tool answered with an error, and the error it names throws when its fields are read.
    for (const info of [selfThrowing(), new Proxy({}, { get() { throw new Error('closed') } }), Object.defineProperty({}, 'name', { get() { throw Symbol('n') } })]) {
      const row = assertClosed(await settled({ resolve: { content: [{ type: 'text', text: 'failed' }], isError: true, error: { info } } }, { level }), `${level}: unreadable error info`)
      assert.deepEqual(row.error, { name: 'Error' })
    }
  })
}

test('#855.1 manual: an approval that fails with a value nobody can read still closes the call', async () => {
  // Not the tool this time: DSH's own approval service rejects, with such a value. The call's
  // row is already written, and what closes it is the last catch of the call.
  const host = bridgeHost({ id: 'probe-855-approval', level: 'manual' })
  const get = host.backchannel.ctx.get
  host.backchannel.ctx.get = name => (name === 'approval' ? { effectivePolicy: () => 'ask', request: () => Promise.reject(selfThrowing()) } : get(name))
  host.mint()
  host.startTurn()
  host.startStep()
  const callId = 'probe-855-approval-call'
  const answer = await host.call({ callId })
  assert.equal(host.bodies.length, 0, 'the tool did not run')
  const calls = eventsOf(host.session, 'tool/call').filter(event => event.data.callId === callId)
  assertClosed({ host, answer, calls, results: resultsOf(host.session, callId) }, 'an unreadable approval failure')
})

test('#855.1: a result whose own content throws when read still closes its call', async () => {
  // The tool answered, and a block of its answer throws a Symbol when the row is written.
  const done = await settled({ resolve: { content: [{ type: 'text', get text() { throw Symbol('row') } }], isError: true } })
  assert.equal(done.calls.length, 1)
  assert.equal(done.results.length, 1, 'the call has its one result when the agent is answered')
  const row = done.results[0].data
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row)
  assert.equal(row.message.isError, true)
  done.host.endStep()
  done.host.endTurn()
  assert.equal(resultsOf(done.host.session, 'probe-855-throw').length, 1)
  assertLoadable(done.host.session, 'content that throws')
})

test('#855.1: the same on a Session with no write guard, where the log itself refuses the row', async () => {
  // Without the guard nothing cleans the row first: writing it reads the block and throws the
  // Symbol, and the minimal row that replaces it is the call's result.
  const done = await settled({ resolve: { content: [{ type: 'text', get text() { throw Symbol('row') } }], isError: true } }, { guard: false })
  assert.equal(done.results.length, 1, 'the call has its one result when the agent is answered')
  const row = done.results[0].data
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row)
  assert.deepEqual(row.error, { name: 'BridgeRecordError', code: 'BRIDGE_RESULT_UNRECORDABLE' })
})

test('#855.1: an error object whose fields answer differently each time is read once', async () => {
  let reads = 0
  const info = { get name() { reads += 1; return reads === 1 ? 'ToolError' : 1n }, get code() { return reads > 1 ? Symbol('code') : 'TOOL' } }
  const done = await settled({ resolve: { content: [{ type: 'text', text: 'failed' }], isError: true, error: { info } } })
  const row = assertClosed(done, 'a changing error object')
  assert.equal(row.error.name, 'ToolError')
  assert.deepEqual(done.answer.error, row.error)
})

test('#855.1: a log that cannot be written does not cost the call its result', async () => {
  // The plugin's own log throws, on the path where the call's last catch speaks.
  const host = bridgeHost({ id: 'probe-855-log', level: 'manual' })
  const get = host.backchannel.ctx.get
  host.backchannel.ctx.get = name => (name === 'approval' ? { effectivePolicy: () => 'ask', request: () => Promise.reject(selfThrowing()) } : get(name))
  host.backchannel.log = () => { throw new Error('the log is gone') }
  host.mint()
  host.startTurn()
  host.startStep()
  const callId = 'probe-855-log-call'
  const answer = await host.call({ callId })
  const calls = eventsOf(host.session, 'tool/call').filter(event => event.data.callId === callId)
  assertClosed({ host, answer, calls, results: resultsOf(host.session, callId) }, 'a log that throws')
})

test('#855.1: an ordinary Error reads as it always did', async () => {
  const thrown = Object.assign(new TypeError('the probe threw'), { code: 'PROBE' })
  const done = await settled({ reject: thrown })
  assert.deepEqual(done.answer.content, [{ type: 'text', text: 'Error: the probe threw' }])
  const row = assertClosed(done, 'an ordinary error')
  assert.deepEqual(row.error, { name: 'TypeError', code: 'PROBE' })
})

test('#855.1: a value with no message says what it is', async () => {
  const symbol = await settled({ reject: Symbol('odd') })
  assert.deepEqual(symbol.answer.content, [{ type: 'text', text: 'Error: Symbol(odd)' }])
  assert.deepEqual(assertClosed(symbol, 'a symbol').error, { name: 'Error' })
  const nothing = await settled({ reject: undefined })
  assert.deepEqual(nothing.answer.content, [{ type: 'text', text: 'Error: undefined' }])
  assertClosed(nothing, 'undefined')
  const closed = await settled({ reject: selfThrowing() })
  assert.deepEqual(closed.answer.content, [{ type: 'text', text: 'Error: a value that cannot be shown' }])
  assertClosed(closed, 'a self-throwing value')
})
