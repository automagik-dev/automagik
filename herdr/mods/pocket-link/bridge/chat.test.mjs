// node --test bridge/chat.test.mjs: the chat route's wire and limits, with a fake hc behind the
// engine and a temp home (never a live Herdr, never iroh).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BACKFILL_ROWS, CLOSE, CREDIT, ChatConnection, ChatEngines, CREDIT_WINDOW, DATA, frame, MAX_SUBSCRIPTIONS, ROW_TEXT_MAX, SEND_TEXT_MAX
} from './chat.mjs'
import { Engine, LINGER_MS } from '../chat/engine.js'
import { createFakeHc, fakeTerminal } from '../chat/fake-hc.mjs'

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }
const noTimers = { setTimeout: () => ({}), clearTimeout: () => {}, setInterval: () => ({}), clearInterval: () => {} }
const user = (uuid, text) => JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } }) + '\n'

function world({ lines = user('u1', 'hello'), terminals, timers = noTimers } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'chat-route-')))
  const path = join(home, '.claude/projects/p/s.jsonl')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, lines)
  const hc = createFakeHc({ terminals: terminals ?? [fakeTerminal('t1', { labels: { 'agent.transcript': path } }), fakeTerminal('t2', { labels: { 'agent.transcript': path } })], screens: { t1: '', t2: '' } })
  const engine = new Engine({ hc, home, timers, projection: { watch: null } })
  return { home, path, hc, engine }
}

/** A phone on the chat route: it writes requests, reads frames back. */
function phone(engine, options = {}) {
  let out = Buffer.alloc(0)
  const ended = []
  const conn = new ChatConnection({ engine, write: b => { out = Buffer.concat([out, b]) }, end: r => ended.push(r), ...options })
  let nextId = 1
  const p = {
    conn, ended,
    hello(params = { generation: 1, framed: true }) {
      conn.feed(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'hello', params }) + '\n'))
      const at = out.indexOf(10)
      const line = JSON.parse(out.subarray(0, at).toString())
      out = out.subarray(at + 1)
      return line
    },
    /** Every frame written since the last call. */
    frames() {
      const got = []
      while (out.length >= 9) {
        const channel = out.readUInt32LE(0), kind = out.readUInt8(4), length = out.readUInt32LE(5)
        if (out.length < 9 + length) break
        got.push({ channel, kind, payload: out.subarray(9, 9 + length) })
        out = out.subarray(9 + length)
      }
      return got
    },
    async call(method, params = {}) {
      const id = nextId++
      conn.feed(frame(0, DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))))
      // Until its own answer arrives (a backfill reads the file again), at most ~2 s.
      for (let i = 0; i < 200; i++) {
        await settle()
        const all = p.frames()
        p.pending.push(...all.filter(f => f.channel !== 0))
        p.answers.push(...all.filter(f => f.channel === 0).map(f => JSON.parse(f.payload)))
        const answer = p.answers.find(m => m.id === id)
        if (answer) return answer
        await new Promise(r => setTimeout(r, 10))
      }
      return undefined
    },
    pending: [],
    answers: [],
    /** Events received on a channel so far (JSON lines). */
    events(channel) {
      p.pending.push(...p.frames().filter(f => f.channel !== 0))
      return p.pending.filter(f => f.channel === channel && f.kind === DATA).flatMap(f => f.payload.toString().split('\n').filter(Boolean).map(l => JSON.parse(l)))
    },
  }
  return p
}

test('hello: generation 1, framed, chat 1, the credit window and the limits', () => {
  const { engine } = world()
  const answer = phone(engine).hello()
  assert.equal(answer.id, 0)
  assert.deepEqual([answer.result.generation, answer.result.framed, answer.result.chat, answer.result.credit], [1, true, 1, CREDIT_WINDOW])
  assert.ok(answer.result.methods.includes('chat.subscribe'))
  assert.equal(answer.result.limits.subscriptions, MAX_SUBSCRIPTIONS)
  engine.close()
})

test('a hello that is not generation 1 and framed is refused and the connection ends', () => {
  const { engine } = world()
  const p = phone(engine)
  assert.equal(p.hello({ generation: 1 }).error.data.kind, 'unsupported')
  assert.deepEqual(p.ended, ['unsupported'])
  engine.close()
})

test('chat.list answers the live terminals with a decoder, from the fake hc', async () => {
  // A cold engine: nothing watched yet. t2 is a shell, with no decoder, so it is not a chat.
  const { engine } = world({ terminals: [fakeTerminal('t1'), fakeTerminal('t2', { app: 'zsh', argv: ['zsh'] })] })
  const p = phone(engine)
  p.hello()
  const answer = await p.call('chat.list')
  assert.deepEqual(answer.result.terminals.map(t => [t.terminal, t.agent]), [['t1', 'claude']])
  engine.close()
})

test('chat.list after the last subscriber stops still answers the live terminals', async () => {
  // Timeouts kept, fired by hand: the 10-minute linger after the last client is what ends the watch.
  const timeouts = []
  const timers = { ...noTimers, setTimeout: (fn, ms) => { const h = { fn, ms }; timeouts.push(h); return h }, clearTimeout: h => { const i = timeouts.indexOf(h); if (i >= 0) timeouts.splice(i, 1) } }
  const { engine, hc } = world({ timers })
  const p = phone(engine)
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  p.conn.feed(frame(1, CLOSE))
  p.events(1)
  assert.equal(p.conn.subs.size, 0)
  timeouts.find(h => h.ms === LINGER_MS).fn()
  assert.equal(engine.entries.size, 0, 'nothing watched any more')
  assert.equal(hc.subscriptions, 1, 'the engine keeps its one events subscription')
  const answer = await p.call('chat.list')
  assert.deepEqual(answer.result.terminals.map(t => [t.terminal, t.agent]), [['t1', 'claude'], ['t2', 'claude']])
  hc.change('t2', 'status', { state: 'finished' })
  assert.deepEqual((await p.call('chat.list')).result.terminals.map(t => t.terminal), ['t1'], 'and stays current')
  engine.close()
  assert.equal(hc.subscriptions, 0, 'closing the engine ends it')
})

test('chat.subscribe streams a snapshot then rows on its own channel', async () => {
  const { engine, path } = world()
  const p = phone(engine)
  p.hello()
  const { result: { channel } } = await p.call('chat.subscribe', { terminal: 't1' })
  assert.equal(channel, 1)
  await settle()
  await engine.entries.get('t1').projection.ready
  appendFileSync(path, user('u2', 'second'))
  await engine.entries.get('t1').projection.tail.tick()
  const events = p.events(1)
  assert.equal(events[0].type, 'snapshot')
  const texts = events.filter(e => e.type === 'rows').flatMap(e => e.rows.map(r => r.text))
  assert.deepEqual(texts, ['hello', 'second'])
  engine.close()
})

test('events wait for credit: nothing past the window until the phone grants more', async () => {
  const { engine, path } = world()
  const p = phone(engine, { window: 400 })
  assert.equal(p.hello().result.credit, 400)
  await p.call('chat.subscribe', { terminal: 't1' })
  await engine.entries.get('t1').projection.ready
  appendFileSync(path, Array.from({ length: 20 }, (_, i) => user(`m${i}`, `message ${i} ${'x'.repeat(40)}`)).join(''))
  await engine.entries.get('t1').projection.tail.tick()
  const sent = () => p.pending.filter(f => f.channel === 1 && f.kind === DATA).reduce((n, f) => n + f.payload.length, 0)
  p.events(1)
  assert.ok(sent() <= 400, `sent ${sent()} bytes on a 400-byte window`)
  const before = sent()
  const c = Buffer.alloc(4); c.writeUInt32LE(100_000, 0)
  p.conn.feed(frame(1, CREDIT, c))
  p.events(1)
  assert.ok(sent() > before, 'credit lets the rest go')
  engine.close()
})

test('a subscriber that never grants credit is closed as slow, not queued forever', async () => {
  const { engine, path } = world()
  const p = phone(engine, { window: 10, maxQueued: 2000 })
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  await engine.entries.get('t1').projection.ready
  appendFileSync(path, Array.from({ length: 40 }, (_, i) => user(`m${i}`, 'y'.repeat(100))).join(''))
  await engine.entries.get('t1').projection.tail.tick()
  p.events(1)
  const closed = p.pending.find(f => f.channel === 1 && f.kind === CLOSE)
  assert.deepEqual(JSON.parse(closed.payload), { reason: 'slow' })
  assert.equal(p.conn.subs.size, 0)
  engine.close()
})

test('limits: a send over 32 KiB is refused untyped; at most 8 subscriptions; a long row is cut', async () => {
  const many = Array.from({ length: MAX_SUBSCRIPTIONS + 1 }, (_, i) => fakeTerminal(`t${i + 1}`))
  const { engine, hc } = world({ terminals: many, lines: user('u1', 'z'.repeat(ROW_TEXT_MAX + 10)) })
  const p = phone(engine)
  p.hello()
  for (let i = 1; i <= MAX_SUBSCRIPTIONS; i++) assert.ok((await p.call('chat.subscribe', { terminal: `t${i}` })).result.channel)
  assert.equal((await p.call('chat.subscribe', { terminal: `t${MAX_SUBSCRIPTIONS + 1}` })).error.data.kind, 'too_many')
  const big = await p.call('chat.send', { terminal: 't1', text: 'q'.repeat(SEND_TEXT_MAX + 1), id: 'm1' })
  assert.deepEqual(big.result, { state: 'refused', id: 'm1', reason: 'too-long' })
  assert.equal(hc.calls.filter(c => c.method === 'terminal.send').length, 0)
  engine.close()
})

test('a long row is cut at 64 KiB and says so', async () => {
  const { engine } = world({ lines: user('u1', 'z'.repeat(ROW_TEXT_MAX + 10)) })
  const p = phone(engine)
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  await engine.entries.get('t1').projection.ready
  await settle()
  const row = p.events(1).filter(e => e.type === 'rows').flatMap(e => e.rows)[0]
  assert.equal(row.cut, true)
  assert.equal(row.text.length, ROW_TEXT_MAX + 1)
  engine.close()
})

test('reconnect: a cursor still held gets what it missed; one not held gets reset and the latest page', async () => {
  const { engine } = world({ lines: user('u1', 'one') + user('u2', 'two') + user('u3', 'three') })
  const first = phone(engine)
  first.hello()
  await first.call('chat.subscribe', { terminal: 't1' })
  await engine.entries.get('t1').projection.ready
  first.conn.close()
  const again = phone(engine)
  again.hello()
  await again.call('chat.subscribe', { terminal: 't1', after: '1:1.0' })
  const snap = again.events(1)[0]
  assert.deepEqual([snap.type, snap.reset, snap.rows.map(r => r.text)], ['snapshot', false, ['two', 'three']])
  const third = phone(engine)
  third.hello()
  await third.call('chat.subscribe', { terminal: 't1', after: '9:9.0' })
  const fresh = third.events(1)[0]
  assert.deepEqual([fresh.reset, fresh.rows.map(r => r.text)], [true, ['one', 'two', 'three']])
  engine.close()
})

test('backfill pages at most 200 rows, only for a subscribed terminal', async () => {
  const lines = Array.from({ length: 300 }, (_, i) => user(`u${i}`, `m${i}`)).join('')
  const { engine } = world({ lines })
  const p = phone(engine)
  p.hello()
  assert.equal((await p.call('chat.backfill', { terminal: 't1', before: '1:300.0' })).error.data.kind, 'not_watching')
  await p.call('chat.subscribe', { terminal: 't1' })
  await engine.entries.get('t1').projection.ready
  const page = await p.call('chat.backfill', { terminal: 't1', before: '1:300.0', limit: 999 })
  assert.equal(page.result.rows.length, BACKFILL_ROWS)
  assert.equal(page.result.rows.at(-1).text, 'm298')
  engine.close()
})

test('writes are refused for a terminal this connection does not watch, even one another phone watches', async () => {
  const { engine, hc } = world()
  const a = phone(engine)
  a.hello()
  await a.call('chat.subscribe', { terminal: 't1' })
  const b = phone(engine)
  b.hello()
  for (const [method, params] of [['chat.send', { terminal: 't1', text: 'x', id: 'm1' }], ['chat.interrupt', { terminal: 't1' }], ['chat.answer', { terminal: 't1', row: 'approval:x', choice: 'allow' }], ['chat.sendHeld', { terminal: 't1', id: 'm1' }]]) {
    assert.equal((await b.call(method, params)).result.reason, 'not-watching', method)
  }
  assert.equal(hc.calls.filter(c => ['terminal.send', 'terminal.keys', 'terminal.interrupt'].includes(c.method)).length, 0)
  engine.close()
})

test('a CLOSE on a channel ends that subscription and is answered with one CLOSE', async () => {
  const { engine } = world()
  const p = phone(engine)
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  p.conn.feed(frame(1, CLOSE))
  p.events(1)
  assert.equal(p.pending.filter(f => f.channel === 1 && f.kind === CLOSE).length, 1)
  assert.equal(p.conn.subs.size, 0)
  assert.equal((await p.call('chat.send', { terminal: 't1', text: 'x', id: 'm1' })).result.reason, 'not-watching')
  engine.close()
})

test('a request frame too big, or garbage after hello, ends the connection', () => {
  const { engine } = world()
  const p = phone(engine)
  p.hello()
  p.conn.feed(frame(0, DATA, Buffer.alloc(300 * 1024)))
  assert.deepEqual(p.ended, ['frame too big'])
  const q = phone(engine)
  q.hello()
  q.conn.feed(frame(0, DATA, Buffer.from('not json')))
  assert.deepEqual(q.ended, ['bad request'])
  engine.close()
})

// ---------------------------------------------------------------- engines per session

function fakeEngines(max = 3) {
  const made = []
  const engines = new ChatEngines({
    max,
    make: name => { const e = { name, closed: false, empty: true, onEmpty: null, close() { this.closed = true } }; made.push(e); return e },
  })
  return { engines, made }
}

test('one engine per session name, made lazily and shared by its connections', () => {
  const { engines, made } = fakeEngines()
  const a = engines.acquire('default', 'conn-a')
  assert.equal(engines.acquire('default', 'conn-b'), a)
  assert.notEqual(engines.acquire('work', 'conn-c'), a)
  assert.equal(made.length, 2)
})

test('an engine closes after its last connection AND its hold; held, it stays', () => {
  const { engines } = fakeEngines()
  const e = engines.acquire('default', 'a')
  e.empty = false // a terminal still held (10 minutes)
  engines.release('default', 'a')
  assert.equal(e.closed, false, 'kept while it holds rows')
  e.empty = true
  e.onEmpty()
  assert.equal(e.closed, true, 'closed once the hold is over')
  const f = engines.acquire('default', 'b')
  assert.notEqual(f, e, 'a new one for the next connection')
})

test('engines are capped: an unused one is closed first; if all are in use, the new session is refused', () => {
  const { engines } = fakeEngines(2)
  const one = engines.acquire('s1', 'a')
  const two = engines.acquire('s2', 'b')
  two.empty = false
  engines.release('s2', 'b') // held, no connection
  const three = engines.acquire('s3', 'c')
  assert.ok(three)
  assert.equal(two.closed, true, 'the unused one went')
  assert.equal(engines.acquire('s4', 'd'), null, 'all in use: refused')
  assert.equal(one.closed, false)
})

test('the 32 KiB send limit is on what the phone sent, before any cleaning', async () => {
  const { engine, hc } = world()
  const p = phone(engine)
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  // Cleaned, this is one letter; on the wire it is over the limit, so it is refused untouched.
  const answer = await p.call('chat.send', { terminal: 't1', text: `a${'\u0001'.repeat(SEND_TEXT_MAX)}`, id: 'm1' })
  assert.equal(answer.result.reason, 'too-long')
  assert.equal(hc.calls.filter(c => c.method === 'terminal.send').length, 0)
  engine.close()
})

test('credit is clamped to the window; an event bigger than the window still goes once credit is full', async () => {
  const { engine, path } = world()
  const p = phone(engine, { window: 300 })
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  await engine.entries.get('t1').projection.ready
  const sub = p.conn.subs.get(1)
  const grant = n => { const c = Buffer.alloc(4); c.writeUInt32LE(n, 0); p.conn.feed(frame(1, CREDIT, c)) }
  grant(10_000_000)
  assert.ok(sub.credit <= 300, `credit ${sub.credit} past the window`)
  appendFileSync(path, user('big', 'w'.repeat(2000)))
  await engine.entries.get('t1').projection.tail.tick()
  grant(300)
  const rows = p.events(1).filter(e => e.type === 'rows').flatMap(e => e.rows)
  assert.ok(rows.some(r => r.text === 'w'.repeat(2000)), 'the big event went at full credit')
  engine.close()
})

test('at most 16 requests at once: more are answered busy', async () => {
  const { engine } = world()
  const waiting = []
  engine.interrupt = () => new Promise(r => waiting.push(r))
  const p = phone(engine)
  p.hello()
  for (let i = 1; i <= 17; i++) p.conn.feed(frame(0, DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'chat.interrupt', params: { terminal: 't1' } }))))
  await settle()
  const answers = p.frames().filter(f => f.channel === 0).map(f => JSON.parse(f.payload))
  assert.deepEqual(answers.map(a => [a.id, a.error?.data?.kind]), [[17, 'busy']])
  for (const r of waiting) r({ ok: true })
  await settle()
  p.conn.feed(frame(0, DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 18, method: 'chat.list' }))))
  await settle()
  assert.ok(p.frames().map(f => JSON.parse(f.payload)).find(m => m.id === 18)?.result, 'room again once answered')
  engine.close()
})

test('a phone that stops taking bytes is closed, not buffered without end', () => {
  const { engine } = world()
  const ended = []
  const conn = new ChatConnection({ engine, write: () => new Promise(() => {}), end: r => ended.push(r), maxUnsent: 1000 })
  conn.feed(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'hello', params: { generation: 1, framed: true } }) + '\n'))
  for (let i = 0; i < 20 && !conn.closed; i++) conn.reply({ jsonrpc: '2.0', id: i, result: 'x'.repeat(200) })
  assert.deepEqual(ended, ['slow'])
  engine.close()
})

test('every frame from the phone is capped, CREDIT and CLOSE included; frames split across reads are read whole', async () => {
  const { engine } = world()
  const p = phone(engine)
  p.hello()
  const head = Buffer.alloc(9); head.writeUInt32LE(5, 0); head.writeUInt8(CREDIT, 4); head.writeUInt32LE(300 * 1024, 5)
  p.conn.feed(head)
  assert.deepEqual(p.ended, ['frame too big'])
  const q = phone(engine)
  q.hello()
  const req = frame(0, DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'chat.list' })))
  for (const byte of req) q.conn.feed(Buffer.from([byte])) // one byte per read
  await settle()
  assert.deepEqual(q.frames().map(f => JSON.parse(f.payload)).find(m => m.id === 9)?.result?.terminals?.map(t => t.terminal), ['t1', 't2'])
  engine.close()
})

test('a session holding too many terminals refuses a new subscription', async () => {
  const { engine } = world()
  engine.maxTerminals = 1
  const p = phone(engine)
  p.hello()
  assert.ok((await p.call('chat.subscribe', { terminal: 't1' })).result.channel)
  assert.equal((await p.call('chat.subscribe', { terminal: 't2' })).error.data.kind, 'too_many')
  engine.close()
})

test('one device uses at most two sessions at once; others still get theirs', () => {
  const { engines } = fakeEngines(8)
  assert.ok(engines.acquire('s1', 'c1', 'phone-a'))
  assert.ok(engines.acquire('s2', 'c2', 'phone-a'))
  assert.equal(engines.acquire('s3', 'c3', 'phone-a'), null, 'a third session for the same phone')
  assert.ok(engines.acquire('s1', 'c4', 'phone-a'), 'another connection to a session it already uses')
  assert.ok(engines.acquire('s3', 'c5', 'phone-b'), 'another phone is not held back')
  engines.release('s2', 'c2')
  assert.ok(engines.acquire('s3', 'c6', 'phone-a'), 'room again once it left one')
})

test('through the route: a phone that reconnects and retries an id has it typed once', async () => {
  const { engine, hc } = world()
  hc.screens.t1 = readFileSync(new URL('../chat/fixtures/screens/claude-idle.txt', import.meta.url), 'utf8')
  const first = phone(engine, { device: 'paired-key-a' })
  first.hello()
  await first.call('chat.subscribe', { terminal: 't1' })
  assert.equal((await first.call('chat.send', { terminal: 't1', text: 'hi', id: 'm1' })).result.state, 'sent')
  first.conn.close('hung up')
  const again = phone(engine, { device: 'paired-key-a' })
  again.hello()
  await again.call('chat.subscribe', { terminal: 't1' })
  assert.equal((await again.call('chat.send', { terminal: 't1', text: 'hi', id: 'm1' })).result.state, 'sent')
  assert.equal(hc.calls.filter(c => c.method === 'terminal.send').length, 1)
  const other = phone(engine, { device: 'paired-key-b' })
  other.hello()
  await other.call('chat.subscribe', { terminal: 't1' })
  await other.call('chat.send', { terminal: 't1', text: 'hi', id: 'm1' })
  assert.equal(hc.calls.filter(c => c.method === 'terminal.send').length, 2, 'another device: its own message')
  engine.close()
})

test('chat.answer carries a question’s free text to the engine: digit N+1, then the text', async () => {
  const ask = JSON.stringify({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_q', name: 'AskUserQuestion',
    input: { questions: [{ question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] } }] } }) + '\n'
  const { engine, hc } = world({ lines: user('u1', 'pick one') + ask })
  const p = phone(engine)
  p.hello()
  await p.call('chat.subscribe', { terminal: 't1' })
  await settle(); await engine.entries.get('t1').projection.ready
  hc.screens.t1 = 'Which database?\n❯ 1. Postgres\n  2. SQLite\n  3. Type something.\nEsc to cancel\n'
  hc.change('t1', 'status', { status: { app: 'claude-code', state: 'blocked', kind: 'question', msg: 'Which database?' } })
  await settle()
  hc.onWrite((m) => { if (m === 'terminal.send') hc.set('t1', { status: { app: 'claude-code', state: 'working' } }) })
  engine.timers = { ...noTimers, setTimeout: (fn) => setImmediate(fn) }
  assert.equal((await p.call('chat.answer', { terminal: 't1', row: 'question:1:2.0', choice: 'other', text: 7 })).error?.message, 'invalid_params')
  const r = await p.call('chat.answer', { terminal: 't1', row: 'question:1:2.0', choice: 'other', text: 'MySQL' })
  assert.deepEqual(r.result, { ok: true, pressed: 'done', sent: true })
  assert.deepEqual(hc.calls.filter(c => ['terminal.send', 'terminal.keys'].includes(c.method)).map(c => [c.method, c.params.keys ?? c.params.text]),
    [['terminal.keys', ['3']], ['terminal.send', 'MySQL']])
  engine.close()
})
