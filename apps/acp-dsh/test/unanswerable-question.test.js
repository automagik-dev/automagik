// A permission question nobody will answer (#969, lifecycle review 10a and 10c). The agent's
// `session/request_permission` waits for the card of its call to ask it. Where no card can come
// any more, the question is answered at once, and only ever as cancelled: a call first seen after
// its prompt ended, a call left from an earlier prompt, a call that is drift at its first sight,
// and a call whose card's body is over. Every other question waits for its card, as before: a
// call found to be drift after its card was made included.
//
// The real AgentRun and the real mirror tool, with no agent process: the test plays the agent's
// side (its updates, its questions, the end of its prompt). Every wait is bounded (`soon`,
// `still`), so a question left hanging fails the test instead of holding it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentRun } from '../src/host/acp.js'
import { callArguments, mirrorTool } from '../src/host/tool.js'

const CANCELLED = { outcome: { outcome: 'cancelled' } }
const OPTIONS = [
  { optionId: 'yes', kind: 'allow_once' },
  { optionId: 'always', kind: 'allow_always' },
  { optionId: 'no', kind: 'reject_once' },
]
const picked = optionId => ({ outcome: { outcome: 'selected', optionId } })
const tick = () => new Promise(resolve => setImmediate(resolve))

/** The value of a promise that must settle now; a hanging one fails here, in bounded time. */
async function soon(promise, ms = 500) {
  let timer
  const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`nothing answered within ${ms} ms`)), ms) })
  try {
    return await Promise.race([promise, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Whether a promise is still waiting after a few turns of the loop. */
async function still(promise) {
  let settled = false
  promise.then(() => { settled = true }, () => { settled = true })
  for (let index = 0; index < 5; index += 1) await tick()
  return !settled
}

/**
 * A run with no process behind it. `begin()` starts a prompt as the adapter does, and the
 * function it returns ends that prompt as the agent's answer would.
 * @param {import('node:test').TestContext} t
 */
function probe(t, { drift = false, dshTools = false } = {}) {
  const run = new AgentRun({
    name: 'Probe agent',
    cwd: process.cwd(),
    dshTools,
    // As the adapter's checkDrift marks a built-in call while the bridge is on.
    onToolCall: (tool) => { if (drift && tool.structuredName !== undefined && !tool.structuredName.startsWith('mcp__')) tool.drift = true },
  })
  run.gone = new Promise(() => {})
  // A prompt the test leaves open holds the event loop, as a real one does: let it go.
  t.after(() => run.letGo(true))
  const begin = () => {
    let end
    run.conn = { prompt: () => new Promise((resolve) => { end = resolve }) }
    const prompting = run.prompt([{ type: 'text', text: 'go' }])
    return async (stopReason = 'end_turn') => {
      end({ stopReason })
      await prompting
    }
  }
  const see = (toolCallId, more = {}) => run.onUpdate({ sessionUpdate: 'tool_call', toolCallId, title: `Read ${toolCallId}`, kind: 'read', status: 'pending', ...more })
  const ask = (toolCallId, options = OPTIONS, signal) => run.onPermission({ toolCall: { toolCallId, title: 'Read it?' }, options }, signal)
  return { run, begin, see, ask }
}

/** The mirror tool over one run, with a dialog the test answers. */
function mirrorOf(run, { broken = false } = {}) {
  const asked = []
  const tool = mirrorTool({
    runOf: () => ({ run, name: 'Probe agent' }),
    approval: () => broken ? (() => { throw new Error('the approval service is gone') })() : ({
      effectivePolicy: () => 'ask',
      request: request => new Promise((resolve) => { asked.push({ request, resolve }) }),
    }),
    sandboxPolicy: () => ({ resolve: () => ({ mode: 'workspace-write' }) }),
    attachments: () => undefined,
  })
  const session = { id: 's1', snapshotEvents: () => [] }
  const execute = (id, signal = new AbortController().signal) => tool.execute(callArguments(run.tools.get(id)), { callId: `mirror-${id}`, agent: { session }, signal })
  return { asked, execute }
}

// --- a call with no card to come ---------------------------------------------------------------

test('a question for a call first seen after its prompt ended is answered cancelled at once', async (t) => {
  const p = probe(t)
  const end = p.begin()
  await end()
  const answer = await soon(p.ask('late-1'))
  assert.deepEqual(answer, CANCELLED)
  assert.equal(p.run.tools.get('late-1').permission, undefined, 'nothing is left waiting on the call')
})

test('it is cancelled whatever the agent offers: never an allow option', async (t) => {
  const p = probe(t)
  await p.begin()()
  for (const options of [OPTIONS, [{ optionId: 'always', kind: 'allow_always' }], [{ optionId: 'yes', kind: 'allow_once' }], []]) {
    assert.deepEqual(await soon(p.ask('late-1', options)), CANCELLED)
  }
})

test('a call announced after the end, then asked about: cancelled, and still recorded for diagnostics', async (t) => {
  const p = probe(t)
  await p.begin()()
  await p.see('late-2', { name: 'Bash' })
  assert.deepEqual(await soon(p.ask('late-2')), CANCELLED)
  const tool = p.run.tools.get('late-2')
  assert.equal(tool.structuredName, 'Bash', 'the call is observed as before')
  assert.equal(tool.title, 'Read late-2', "the question's title does not rename the call")
})

test('a question whose request the agent already took back is cancelled and nothing is stored', async (t) => {
  const p = probe(t)
  await p.begin()()
  const withdrawn = new AbortController()
  withdrawn.abort()
  assert.deepEqual(await soon(p.ask('late-3', OPTIONS, withdrawn.signal)), CANCELLED)
  assert.equal(p.run.tools.get('late-3').permission, undefined)
})

test('a question after a fork cleared the calls, between two prompts, is cancelled', async (t) => {
  const p = probe(t)
  const end = p.begin()
  await p.see('before-fork')
  await end()
  // As fork() does once the agent answered it.
  p.run.tools.clear()
  assert.deepEqual(await soon(p.ask('before-fork')), CANCELLED)
})

// --- a call of an earlier prompt ---------------------------------------------------------------

test("a question during the next prompt for an earlier prompt's call is cancelled; a new call's waits", async (t) => {
  const p = probe(t)
  const endFirst = p.begin()
  await p.see('old-1')
  await endFirst()
  const endSecond = p.begin()
  assert.deepEqual(await soon(p.ask('old-1')), CANCELLED, 'no second card is made for a known call')
  await p.see('new-1')
  const waiting = p.ask('new-1')
  assert.equal(await still(waiting), true, "the new call's question waits for its card")
  assert.notEqual(p.run.tools.get('new-1').permission, undefined)
  await endSecond()
  assert.deepEqual(await soon(waiting), CANCELLED, "the prompt's end withdraws it, as before")
})

test('a question left on a call when the next prompt starts is withdrawn there', async (t) => {
  const p = probe(t)
  const end = p.begin()
  await p.see('old-2')
  await end()
  // Seen before the end, so it may still get its card: it waits.
  const waiting = p.ask('old-2')
  assert.equal(await still(waiting), true)
  p.begin()
  assert.deepEqual(await soon(waiting), CANCELLED)
})

test('after a second prompt ends, a late call is cancelled again', async (t) => {
  const p = probe(t)
  await p.begin()()
  await p.begin()()
  assert.deepEqual(await soon(p.ask('late-4')), CANCELLED)
})

// --- questions that still have their answer ----------------------------------------------------

test('control: during a prompt, a question waits for its card', async (t) => {
  const p = probe(t)
  const end = p.begin()
  await p.see('live-1')
  const waiting = p.ask('live-1')
  assert.equal(await still(waiting), true)
  assert.equal(p.run.tools.get('live-1').permission.title, 'Read it?')
  await end()
  assert.deepEqual(await soon(waiting), CANCELLED)
})

test('control: a run that never prompted keeps its question waiting', async (t) => {
  const p = probe(t)
  const waiting = p.ask('never-1')
  assert.equal(await still(waiting), true)
  p.run.tools.get('never-1').permission.answer(CANCELLED)
  assert.deepEqual(await soon(waiting), CANCELLED)
})

test('the prompt ended before its card ran: the question that comes then is asked by the card and takes the answer', async (t) => {
  const p = probe(t)
  const m = mirrorOf(p.run)
  const end = p.begin()
  // Its event is queued ahead of the prompt's end: the adapter still makes its card.
  await p.see('slow-1')
  await end()
  const question = p.ask('slow-1')
  assert.equal(await still(question), true, 'it waits: its card is still to come')
  // The card's body, delayed by a gate until now. The call ended with its prompt, so only a
  // body that asks before it reads the status can answer.
  const body = m.execute('slow-1')
  await tick()
  assert.equal(m.asked.length, 1, 'the card asks the stored question')
  m.asked[0].resolve('allowed-once')
  assert.deepEqual(await soon(question), picked('yes'))
  await soon(body)
})

test('a question that comes after its card returned is cancelled, in the same prompt too', async (t) => {
  const p = probe(t)
  const m = mirrorOf(p.run)
  const end = p.begin()
  await p.see('done-1')
  const body = m.execute('done-1')
  await tick()
  await p.run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'done-1', status: 'completed' })
  await soon(body)
  assert.deepEqual(await soon(p.ask('done-1')), CANCELLED)
  assert.equal(m.asked.length, 0, 'no dialog was raised')
  await end()
  assert.deepEqual(await soon(p.ask('done-1')), CANCELLED, 'and after the prompt')
})

test('a card still running answers a second question itself', async (t) => {
  const p = probe(t)
  const m = mirrorOf(p.run)
  const end = p.begin()
  await p.see('twice-1')
  const first = p.ask('twice-1')
  const body = m.execute('twice-1')
  await tick()
  m.asked[0].resolve('allowed-once')
  assert.deepEqual(await soon(first), picked('yes'))
  const second = p.ask('twice-1')
  await tick()
  assert.equal(m.asked.length, 2, 'the running card asks the second one')
  m.asked[1].resolve('rejected')
  assert.deepEqual(await soon(second), picked('no'))
  await p.run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'twice-1', status: 'failed' })
  await soon(body)
  await end()
})

test('a card whose body throws while it asks: its question is withdrawn, and a later one is cancelled', async (t) => {
  const p = probe(t)
  const m = mirrorOf(p.run, { broken: true })
  const end = p.begin()
  await p.see('broken-1')
  const first = p.ask('broken-1')
  await assert.rejects(m.execute('broken-1'), /approval service is gone/)
  assert.deepEqual(await soon(first), CANCELLED, 'the question the body had taken is not left hanging')
  assert.deepEqual(await soon(p.ask('broken-1')), CANCELLED, 'and no later one waits for a body that is gone')
  await end()
})

// --- answers that keep their precedence --------------------------------------------------------

test('a call DSH refused keeps its reject option after the prompt ended and in the next prompt', async (t) => {
  const p = probe(t)
  const end = p.begin()
  await p.see('refused-1')
  p.run.refuse('refused-1', false)
  await end()
  assert.deepEqual(await soon(p.ask('refused-1')), picked('no'), 'the refusal of #937, not a cancel')
  p.begin()
  assert.deepEqual(await soon(p.ask('refused-1')), picked('no'))
})

test("the bridge's own call keeps today's answer after the prompt ended", async (t) => {
  const p = probe(t, { dshTools: true })
  const end = p.begin()
  await p.see('bridge-1', { name: 'mcp__dsh__bash' })
  await end()
  assert.deepEqual(await soon(p.ask('bridge-1')), picked('yes'))
})

// --- a drifted call ----------------------------------------------------------------------------

test("the bridge's own call first seen after the prompt ended: the bridge branch still answers first", async (t) => {
  const p = probe(t, { dshTools: true })
  await p.begin()()
  // No card can come for it, and it is the bridge's: the bridge's answer is the one given.
  const answer = await soon(p.run.onPermission({ toolCall: { toolCallId: 'bridge-late', title: 'Run?', name: 'mcp__dsh__bash' }, options: OPTIONS }))
  assert.equal(p.run.tools.get('bridge-late').unanswerable, true, 'the cancellation rule holds for it too')
  assert.deepEqual(answer, picked('yes'))
})

test("the bridge's own call from an earlier prompt, asked in the next: the bridge branch still answers first", async (t) => {
  const p = probe(t, { dshTools: true })
  const end = p.begin()
  await p.see('bridge-old', { name: 'mcp__dsh__bash' })
  await end()
  p.begin()
  assert.equal(p.run.tools.get('bridge-old').unanswerable, true)
  assert.deepEqual(await soon(p.ask('bridge-old')), picked('yes'))
})

test('a call that is drift at its first sight gets no card: its question is cancelled at once', async (t) => {
  const p = probe(t, { drift: true })
  const end = p.begin()
  await p.see('drift-1', { name: 'Bash' })
  assert.equal(p.run.tools.get('drift-1').drift, true)
  assert.deepEqual(await soon(p.ask('drift-1')), CANCELLED)
  await end()
})

test('a drifted call announced only by its question is cancelled at once', async (t) => {
  const p = probe(t, { drift: true })
  const end = p.begin()
  const answer = p.run.onPermission({ toolCall: { toolCallId: 'drift-q', title: 'Run?', name: 'Bash' }, options: OPTIONS })
  assert.deepEqual(await soon(answer), CANCELLED)
  await end()
})

test('a call whose card was made before its question showed the drift keeps its answer: the delayed body asks it', async (t) => {
  const p = probe(t, { drift: true })
  const m = mirrorOf(p.run)
  const end = p.begin()
  // No name yet: the adapter takes the event and makes the card. Its body is held by a gate.
  await p.see('drift-2', { rawInput: { command: 'ls' } })
  assert.deepEqual(await p.run.next(), { type: 'tool', id: 'drift-2' })
  assert.notEqual(p.run.tools.get('drift-2').drift, true)
  // The question names the built-in tool: drift, found after the card.
  const question = p.run.onPermission({ toolCall: { toolCallId: 'drift-2', title: 'Run?', name: 'Bash' }, options: OPTIONS })
  assert.equal(p.run.tools.get('drift-2').drift, true)
  assert.equal(await still(question), true, 'it is not cancelled: its card can still ask')
  const body = m.execute('drift-2')
  await tick()
  assert.equal(m.asked.length, 1, 'the delayed body asks it')
  m.asked[0].resolve('rejected')
  assert.deepEqual(await soon(question), picked('no'))
  await p.run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'drift-2', status: 'failed' })
  await soon(body)
  await end()
})

test('a question stored before a later update showed the drift is not withdrawn by that update', async (t) => {
  const p = probe(t, { drift: true })
  const end = p.begin()
  await p.see('drift-3')
  const waiting = p.ask('drift-3')
  await p.run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'drift-3', name: 'Bash' })
  assert.equal(p.run.tools.get('drift-3').drift, true)
  assert.equal(await still(waiting), true, 'its card may already exist')
  await end()
  assert.deepEqual(await soon(waiting), CANCELLED, "the prompt's end withdraws it, as before")
})

test("a drifted call's question already in its dialog is left to the dialog", async (t) => {
  const p = probe(t, { drift: true })
  const m = mirrorOf(p.run)
  const end = p.begin()
  await p.see('drift-4')
  const waiting = p.ask('drift-4')
  const body = m.execute('drift-4')
  await tick()
  assert.equal(m.asked.length, 1)
  await p.run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'drift-4', name: 'Bash' })
  assert.equal(await still(waiting), true, 'the dialog still holds the answer')
  m.asked[0].resolve('rejected')
  assert.deepEqual(await soon(waiting), picked('no'))
  await p.run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'drift-4', status: 'failed' })
  await soon(body)
  await end()
})

test('control: with no drift mark, a built-in call keeps its question waiting', async (t) => {
  const p = probe(t)
  const end = p.begin()
  await p.see('plain-1', { name: 'Bash' })
  const waiting = p.ask('plain-1')
  assert.equal(await still(waiting), true)
  await end()
  assert.deepEqual(await soon(waiting), CANCELLED)
})
