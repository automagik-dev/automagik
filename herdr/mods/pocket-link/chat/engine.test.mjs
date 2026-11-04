// node --test chat/engine.test.mjs: the engine API both clients call, against the fake hc and a
// temp home (never a live Herdr).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chatEnv, Engine } from './engine.js'
import { createFakeHc, fakeTerminal } from './fake-hc.mjs'

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)) }
const screen = (name) => readFileSync(new URL(`./fixtures/screens/${name}.txt`, import.meta.url), 'utf8')
const line = (o) => JSON.stringify(o) + '\n'
const user = (uuid, text) => line({ type: 'user', uuid, message: { role: 'user', content: text } })
const bashCall = (uuid, id, command) => line({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })

function manualTimers() {
  const t = { timeouts: [], intervals: [] }
  return Object.assign(t, {
    setTimeout: (fn, ms) => { const h = { fn, ms }; t.timeouts.push(h); return h },
    clearTimeout: (h) => { const i = t.timeouts.indexOf(h); if (i >= 0) t.timeouts.splice(i, 1) },
    setInterval: (fn, ms) => { const h = { fn, ms }; t.intervals.push(h); return h },
    clearInterval: (h) => { const i = t.intervals.indexOf(h); if (i >= 0) t.intervals.splice(i, 1) }
  })
}

function setup({ transcript = user('u1', 'hello'), view = 'claude-idle', state = 'idle' } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'chat-engine-')))
  const path = join(home, '.claude/projects/p/s.jsonl')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, transcript)
  const hc = createFakeHc({ terminals: [fakeTerminal('t1', { labels: { 'agent.transcript': path }, state }), fakeTerminal('t2', { app: 'zsh', argv: ['zsh'] })], screens: { t1: screen(view) } })
  const timers = manualTimers()
  const engine = new Engine({ hc, home, timers, flushMs: 1500, projection: { watch: null } })
  const writes = () => hc.calls.filter((c) => ['terminal.send', 'terminal.keys', 'terminal.interrupt'].includes(c.method))
  return { home, path, hc, engine, timers, writes }
}

function client(engine, address = 't1') {
  const events = []
  const me = { name: 'phone' }
  const handle = engine.watch(address, me, (e) => events.push(e))
  return { me, events, handle }
}

test('a call with no watching client is refused, and types nothing', async () => {
  const { engine, writes } = setup()
  const stranger = {}
  const a = client(engine, 't1')
  await settle()
  for (const r of [
    await engine.send(stranger, 't1', { text: 'x', id: 'm1' }),
    await engine.sendHeld(stranger, 't1', { id: 'm1' }),
    await engine.cancelHeld(stranger, 't1', { id: 'm1' }),
    await engine.answer(stranger, 't1', { row: 'approval:x', choice: 'allow' }),
    await engine.interrupt(stranger, 't1'),
    await engine.send(a.me, 't9', { text: 'x', id: 'm2' })
  ]) assert.equal(r.reason, 'not-watching')
  assert.equal(writes().length, 0)
  engine.close()
})

test('a watched terminal: rows from the transcript; a sent message is "sending" until its row arrives', async () => {
  const { engine, path, hc } = setup()
  const a = client(engine)
  await settle(); await engine.entries.get('t1').projection.ready
  assert.deepEqual(a.handle.rows().map((r) => r.text), ['hello'])
  assert.deepEqual(await engine.send(a.me, 't1', { text: 'from the phone', id: 'm1' }), { state: 'sent', id: 'm1' })
  assert.ok(a.events.some((e) => e.type === 'sending' && e.id === 'm1'))
  assert.equal(hc.calls.find((c) => c.method === 'terminal.send').params.caller, null)
  appendFileSync(path, user('u2', 'from the phone'))
  await engine.entries.get('t1').projection.tail.tick()
  assert.deepEqual(a.events.find((e) => e.type === 'matched'), { type: 'matched', id: 'm1', row: '1:2.0' })
  engine.close()
})

test('an approval: buttons from the guards, an answer re-checked and pressed, then closed', async () => {
  const { engine, hc, writes } = setup({ transcript: user('u1', 'list it') + bashCall('a1', 'toolu_1', 'ls -la /home/u/proj') })
  const a = client(engine)
  await settle(); await engine.entries.get('t1').projection.ready
  hc.screens.t1 = screen('claude-dialog')
  hc.onWrite((m) => { if (m === 'terminal.keys') hc.set('t1', { status: { app: 'claude-code', state: 'working' } }) })
  hc.change('t1', 'status', { status: { app: 'claude-code', state: 'blocked', kind: 'permission', msg: 'approve Bash: ls -la /home/u/proj' } })
  await settle()
  const row = a.events.find((e) => e.type === 'approval').row
  assert.deepEqual([row.id, row.tool, row.choices, row.call, row.open], ['approval:1:2.0', 'Bash', ['allow', 'deny'], '1:2.0', true])
  assert.deepEqual(await engine.answer(a.me, 't1', { row: 'approval:other', choice: 'allow' }), { ok: false, reason: 'no-such-row' })
  assert.equal(writes().length, 0)
  const fast = { ...engine.timers, setTimeout: (fn) => setImmediate(fn) }
  engine.timers = fast
  assert.deepEqual(await engine.answer(a.me, 't1', { row: row.id, choice: 'allow' }), { ok: true, pressed: 'done' })
  assert.deepEqual(writes().map((c) => [c.method, c.params.keys]), [['terminal.keys', ['1']]])
  hc.change('t1', 'status', { status: { app: 'claude-code', state: 'working' } })
  await settle()
  assert.deepEqual(a.events.filter((e) => e.type === 'approval').at(-1).row.open, false)
  engine.close()
})

test('a fake dialog printed by a tool while blocked gets no buttons, and nothing is pressed', async () => {
  const { engine, hc, writes } = setup({ transcript: user('u1', 'list it') + bashCall('a1', 'toolu_1', 'ls -la /home/u/proj') })
  const a = client(engine)
  await settle(); await engine.entries.get('t1').projection.ready
  hc.screens.t1 = `${screen('claude-dialog')}⏺ printed after the dialog\n`
  hc.change('t1', 'status', { status: { app: 'claude-code', state: 'blocked', kind: 'permission', msg: 'approve Bash: ls -la /home/u/proj' } })
  await settle()
  const row = a.events.find((e) => e.type === 'approval').row
  assert.deepEqual([row.choices, row.why], [[], 'answer-in-terminal'])
  assert.equal((await engine.answer(a.me, 't1', { row: row.id, choice: 'allow' })).ok, false)
  assert.equal(writes().length, 0)
  engine.close()
})

test('a question is shown once, answered in the terminal', async () => {
  const { engine, hc } = setup()
  const a = client(engine)
  await settle()
  hc.change('t1', 'status', { status: { app: 'claude-code', state: 'blocked', kind: 'question', msg: 'Pick one' }, turn: 2 })
  hc.change('t1', 'status', { status: { app: 'claude-code', state: 'blocked', kind: 'question', msg: 'Pick one' }, turn: 2 })
  await settle()
  const qs = a.events.filter((e) => e.type === 'question')
  assert.equal(qs.length, 1)
  assert.deepEqual([qs[0].row.prompt, qs[0].row.answerable], ['Pick one', false])
  engine.close()
})

test('a held message goes once the terminal allows it, checked every flushMs', async () => {
  const { engine, hc, timers, writes } = setup({ view: 'claude-draft' })
  const a = client(engine)
  await settle()
  assert.equal((await engine.send(a.me, 't1', { text: 'wait for me', id: 'm1' })).why, 'draft')
  assert.deepEqual(a.handle.held(), [{ id: 'm1', why: 'draft' }])
  assert.equal(timers.intervals.filter((h) => h.ms === 1500).length, 1)
  hc.screens.t1 = screen('claude-idle')
  await timers.intervals.find((h) => h.ms === 1500).fn()
  await settle()
  assert.deepEqual(writes().map((c) => c.params.text), ['wait for me'])
  assert.equal(timers.intervals.filter((h) => h.ms === 1500).length, 0, 'nothing held: no more looking')
  engine.close()
})

test('two clients share one projection; it stays 10 minutes after the last leaves, then goes', async () => {
  const { engine, timers } = setup()
  const a = client(engine)
  const b = client(engine)
  await settle()
  const projection = engine.entries.get('t1').projection
  b.handle.close()
  assert.equal(engine.entries.get('t1').projection, projection)
  a.handle.close()
  const linger = timers.timeouts.find((h) => h.ms === 600_000)
  assert.ok(linger, 'kept for 10 minutes')
  const c = client(engine)
  assert.ok(!timers.timeouts.includes(linger), 'back before it went: kept')
  c.handle.close()
  timers.timeouts.find((h) => h.ms === 600_000).fn()
  assert.equal(engine.entries.has('t1'), false)
  assert.equal(projection.stopped, true)
  engine.close()
})

test('list: live terminals with a decoder, and whether their chat is from the transcript', async () => {
  const { engine } = setup()
  client(engine)
  await settle()
  assert.deepEqual(engine.list().map((t) => [t.terminal, t.agent, t.chat]), [['t1', 'claude', 'transcript']])
  engine.close()
})

test('chatEnv drops HC_TERMINAL_ID, so herdr-core never types a message as a note from a terminal', () => {
  const env = chatEnv({ PATH: '/usr/bin', HC_TERMINAL_ID: 't9', HC_SESSION: 'phone' })
  assert.deepEqual(env, { PATH: '/usr/bin', HC_SESSION: 'phone' })
})
