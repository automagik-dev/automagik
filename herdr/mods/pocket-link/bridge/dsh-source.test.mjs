// node --test bridge/dsh-source.test.mjs: the Automagik Bots' chats beside the terminal chats
// (#517), with a fake bots-dsh socket in a temp folder and a fake terminal engine (never a live
// DSH, Herdr or iroh).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatConnection, DATA, frame } from './chat.mjs'
import { ANSWER_ON_COMPUTER, DshSource, INTERRUPT_MS, WRITES_PER_MINUTE, ownerOnly, socketPaths, teamHomes, withDsh } from './dsh-source.mjs'
import { endRemoved } from './guard.mjs'

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }

/** What a socket with writes answers by default (RFC 0015, Amendments: the chat.* shapes). */
const WROTE = { send: (m) => ({ state: 'sent', id: m.params.id }), interrupt: () => ({ state: 'sent' }), answer: () => ({ ok: true }) }

/**
 * A stand-in for bots-dsh's pocket-socket.js: answers like it, records every request. In its own
 * temp home, or in the team home `at` (made if missing, left for the caller to remove).
 * `write`: answer a hello that asks for writes with `readOnly: false, write: 1` and serve send,
 * interrupt and answer; `reply[method](m)` is that method's answer ({result} or {error}; null
 * answers nothing, so the write stays in flight), else WROTE's.
 */
async function fakeSocket({ readOnly = true, write = false, reply = {}, mode = 0o600, dirMode = 0o700, at } = {}) {
  const home = at ?? mkdtempSync(join(tmpdir(), 'dsh-src-'))
  const dir = join(home, 'pocket')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'chat.sock')
  const requests = []
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      let at
      while ((at = buffer.indexOf('\n')) !== -1) {
        const m = JSON.parse(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
        requests.push(m)
        const send = (o) => socket.write(JSON.stringify(o) + '\n')
        const methods = ['hello', 'list', 'subscribe', 'unsubscribe', 'backfill']
        if (m.method === 'hello') {
          send({ id: m.id, result: write && m.params?.write === 1 ? { protocol: 1, readOnly: false, write: 1, methods: [...methods, 'send', 'interrupt', 'answer'] } : { protocol: 1, readOnly, methods } })
        } else if (write && Object.hasOwn(WROTE, m.method)) {
          const answer = reply[m.method] ? reply[m.method](m) : { result: WROTE[m.method](m) }
          if (answer) send({ id: m.id, ...answer })
        }
        else if (m.method === 'list') send({ id: m.id, result: { terminals: [{ terminal: 'dsh:omni', machine: null, agent: 'dsh', title: 'Omni', status: { state: 'idle' }, chat: 'session' }, { terminal: 't9', agent: 'claude' }] } })
        else if (m.method === 'subscribe') {
          const row = { id: 'dsh:s1:4', turn: 1, at: 1, source: 'session', kind: 'text', role: 'assistant', text: 'hello' }
          send({ channel: m.params.channel, event: { type: 'snapshot', reset: false, rows: [row], screen: [], status: { state: 'blocked', kind: 'permission', msg: ANSWER_ON_COMPUTER }, approval: { id: 'dsh:s1:4#approval', kind: 'approval', summary: ANSWER_ON_COMPUTER, choices: [], open: true, answerable: false }, held: [] } })
          send({ id: m.id, result: { channel: m.params.channel } })
          send({ channel: m.params.channel, event: { type: 'rows', rows: [{ ...row, id: 'dsh:s1:5', text: 'x'.repeat(70 * 1024) }] } })
        } else if (m.method === 'backfill') send({ id: m.id, result: { rows: [{ id: 'dsh:s1:1', kind: 'text', role: 'user', text: 'hi' }] } })
        else if (m.method === 'unsubscribe') send({ id: m.id, result: {} })
        else send({ id: m.id, error: { kind: 'read-only', message: 'read-only' } })
      }
    })
  })
  await new Promise(r => server.listen(path, r))
  chmodSync(path, mode)
  chmodSync(dir, dirMode)
  return {
    home, path, requests,
    async close() {
      for (const s of sockets) s.destroy()
      await new Promise(r => server.close(r))
      if (!at) rmSync(home, { recursive: true, force: true })
    },
  }
}

/** A terminal engine that records what reaches it. */
function fakeEngine() {
  const calls = []
  return {
    calls,
    ready: async () => {},
    list: () => [{ terminal: 't1', machine: 'local', agent: 'claude', title: 'a', status: { state: 'idle' }, chat: 'transcript' }],
    watch: () => null,
    send: (_c, t, m) => { calls.push(`send ${t}`); return { state: 'sent', id: m.id } },
    sendHeld: (_c, t) => { calls.push(`sendHeld ${t}`); return { state: 'sent' } },
    cancelHeld: (_c, t) => { calls.push(`cancelHeld ${t}`); return { ok: true } },
    answer: (_c, t) => { calls.push(`answer ${t}`); return { ok: true } },
    interrupt: (_c, t) => { calls.push(`interrupt ${t}`); return { ok: true } },
  }
}

/** A phone on the route (the same wire as chat.test.mjs); `device` is its paired key. */
function phone(engine, { device } = {}) {
  let out = Buffer.alloc(0)
  const conn = new ChatConnection({ engine, device, write: b => { out = Buffer.concat([out, b]) }, end: () => {} })
  conn.feed(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'hello', params: { generation: 1, framed: true } }) + '\n'))
  const hello = JSON.parse(out.subarray(0, out.indexOf(10)).toString()).result
  out = out.subarray(out.indexOf(10) + 1)
  let nextId = 1
  const frames = []
  const drain = () => {
    while (out.length >= 9) {
      const channel = out.readUInt32LE(0), length = out.readUInt32LE(5)
      if (out.length < 9 + length) break
      frames.push({ channel, payload: out.subarray(9, 9 + length) })
      out = out.subarray(9 + length)
    }
  }
  return {
    conn, hello,
    async call(method, params = {}) {
      const id = nextId++
      conn.feed(frame(0, DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))))
      for (let i = 0; i < 200; i++) {
        await settle()
        drain()
        const answer = frames.filter(f => f.channel === 0).map(f => JSON.parse(f.payload)).find(m => m.id === id)
        if (answer) return answer
        await new Promise(r => setTimeout(r, 10))
      }
      return undefined
    },
    events(channel) {
      drain()
      return frames.filter(f => f.channel === channel).flatMap(f => f.payload.toString().split('\n').filter(Boolean).map(l => JSON.parse(l)))
    },
  }
}

test('DSH chats are listed beside the terminal chats, and only dsh: ones come from the socket', async () => {
  const sock = await fakeSocket()
  const dsh = new DshSource({ path: sock.path })
  try {
    const p = phone(withDsh(fakeEngine(), dsh))
    const { result } = await p.call('chat.list')
    assert.deepEqual(result.terminals.map(t => [t.terminal, t.chat]), [['t1', 'transcript'], ['dsh:omni', 'session']])
  } finally {
    dsh.close()
    await sock.close()
  }
})

test('a DSH chat streams the socket\'s snapshot and rows, with the phone\'s cursor passed on', async () => {
  const sock = await fakeSocket()
  const dsh = new DshSource({ path: sock.path })
  try {
    const p = phone(withDsh(fakeEngine(), dsh))
    const { result } = await p.call('chat.subscribe', { terminal: 'dsh:omni', after: 'dsh:s1:3' })
    for (let i = 0; i < 50 && p.events(result.channel).length < 2; i++) await new Promise(r => setTimeout(r, 10))
    const [snapshot, rows] = p.events(result.channel)
    assert.equal(snapshot.type, 'snapshot')
    assert.deepEqual(snapshot.rows.map(r => r.id), ['dsh:s1:4'])
    assert.equal(snapshot.approval.summary, 'Answer on the computer')
    assert.equal(snapshot.approval.answerable, false)
    assert.equal(rows.type, 'rows')
    assert.equal(rows.rows[0].cut, true, 'a long row is cut as the route cuts terminal rows')
    const subscribe = sock.requests.find(m => m.method === 'subscribe')
    assert.deepEqual(subscribe.params, { terminal: 'dsh:omni', channel: 1, after: 'dsh:s1:3' })
    const back = await p.call('chat.backfill', { terminal: 'dsh:omni', before: 'dsh:s1:4' })
    assert.deepEqual(back.result.rows.map(r => r.id), ['dsh:s1:1'])
  } finally {
    dsh.close()
    await sock.close()
  }
})

test('on a read-only socket every write on a DSH chat is refused before the socket or the engine; terminal chats still write', async () => {
  const sock = await fakeSocket()
  const dsh = new DshSource({ path: sock.path })
  const engine = fakeEngine()
  try {
    const p = phone(withDsh(engine, dsh))
    await p.call('chat.subscribe', { terminal: 'dsh:omni' })
    for (const [method, params] of [
      ['chat.send', { terminal: 'dsh:omni', text: 'hi', id: 'm1' }],
      ['chat.sendHeld', { terminal: 'dsh:omni', id: 'm1' }],
      ['chat.cancelHeld', { terminal: 'dsh:omni', id: 'm1' }],
      ['chat.answer', { terminal: 'dsh:omni', row: 'dsh:s1:4#approval', choice: 'allow' }],
      ['chat.interrupt', { terminal: 'dsh:omni' }],
    ]) {
      const { result } = await p.call(method, params)
      assert.equal(result.state, 'refused', method)
      assert.equal(result.reason, 'read-only', method)
      assert.equal(result.message, ANSWER_ON_COMPUTER, method)
    }
    assert.deepEqual(engine.calls, [])
    assert.deepEqual([...new Set(sock.requests.map(m => m.method))].sort(), ['hello', 'subscribe'])
    // A terminal chat keeps its engine.
    await p.call('chat.send', { terminal: 't1', text: 'hi', id: 'm2' })
    assert.deepEqual(engine.calls, ['send t1'])
  } finally {
    dsh.close()
    await sock.close()
  }
})

/** Wait until `ok()` holds (at most about a second). */
const until = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 10)) }

/** A source on a socket with writes, opened before the phone's hello, and that phone subscribed to dsh:omni. */
async function writer({ reply, now, requestMs, device = 'phone-key', by = 'Pixel' } = {}) {
  const sock = await fakeSocket({ write: true, reply })
  const dsh = new DshSource({ path: sock.path, ...(now ? { now } : {}), ...(requestMs ? { requestMs } : {}) })
  await dsh.open()
  const engine = fakeEngine()
  const p = phone(withDsh(engine, dsh, { by }), { device })
  const { result } = await p.call('chat.subscribe', { terminal: 'dsh:omni' })
  await until(() => sock.requests.some(m => m.method === 'subscribe'))
  const done = async () => { dsh.close(); await sock.close() }
  return { sock, dsh, engine, p, channel: result.channel, socketChannel: sock.requests.find(m => m.method === 'subscribe').params.channel, done }
}

test('an old read-only socket: the bridge asks for writes, gets none, and refuses every write as before', async () => {
  const sock = await fakeSocket()
  const dsh = new DshSource({ path: sock.path })
  try {
    await dsh.open()
    assert.deepEqual(sock.requests[0], { id: 1, method: 'hello', params: { write: 1 } })
    assert.equal(dsh.writable(), false)
    const p = phone(withDsh(fakeEngine(), dsh))
    assert.equal(p.hello.dshWrite, undefined, 'no dshWrite: the phone keeps the DSH chat read-only')
    await p.call('chat.subscribe', { terminal: 'dsh:omni' })
    for (const [method, params] of [
      ['chat.send', { terminal: 'dsh:omni', text: 'hi', id: 'm1' }],
      ['chat.answer', { terminal: 'dsh:omni', row: 'dsh:s1:4#approval', choice: 'allow', text: 'x' }],
      ['chat.interrupt', { terminal: 'dsh:omni' }],
    ]) {
      const { result } = await p.call(method, params)
      assert.equal(result.reason, 'read-only', method)
      assert.equal(result.message, ANSWER_ON_COMPUTER, method)
    }
    assert.deepEqual([...new Set(sock.requests.map(m => m.method))].sort(), ['hello', 'subscribe'])
  } finally {
    dsh.close()
    await sock.close()
  }
})

test('a socket that answered write: 1 gets send, interrupt and answer on the phone\'s channel, unchanged', async () => {
  const w = await writer()
  try {
    assert.equal(w.dsh.writable(), true)
    assert.equal(w.p.hello.dshWrite, true, 'the chat hello says dshWrite')
    const sent = await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'line one\nline two', id: 'm-7' })
    assert.deepEqual(sent.result, { state: 'sent', id: 'm-7' })
    const answered = await w.p.call('chat.answer', { terminal: 'dsh:omni', row: 'dsh:s1:9#question', choice: 'other', text: 'Use the staging box' })
    assert.deepEqual(answered.result, { ok: true })
    const stopped = await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })
    assert.deepEqual(stopped.result, { state: 'sent' })
    const writes = w.sock.requests.filter(m => ['send', 'answer', 'interrupt'].includes(m.method)).map(m => [m.method, m.params])
    assert.deepEqual(writes, [
      ['send', { channel: w.socketChannel, text: 'line one\nline two', id: 'm-7', by: 'Pixel', phone: 'phone-key' }],
      ['answer', { channel: w.socketChannel, row: 'dsh:s1:9#question', choice: 'other', text: 'Use the staging box', by: 'Pixel', phone: 'phone-key' }],
      ['interrupt', { channel: w.socketChannel, by: 'Pixel', phone: 'phone-key' }],
    ])
    // Nothing is held on a DSH chat, so held messages stay refused and never reach the socket.
    for (const method of ['chat.sendHeld', 'chat.cancelHeld']) {
      const { result } = await w.p.call(method, { terminal: 'dsh:omni', id: 'm-7' })
      assert.equal(result.reason, 'read-only', method)
    }
    assert.deepEqual(w.engine.calls, [], 'the terminal engine sees no DSH write')
    assert.equal(w.sock.requests.filter(m => /held/i.test(m.method)).length, 0)
  } finally {
    await w.done()
  }
})

test('a write on a DSH chat this connection does not watch is refused not-watching, before the socket', async () => {
  const w = await writer()
  try {
    const other = phone(withDsh(fakeEngine(), w.dsh), { device: 'phone-key' })
    const { result } = await other.call('chat.send', { terminal: 'dsh:omni', text: 'hi', id: 'm1' })
    assert.deepEqual(result, { state: 'refused', ok: false, reason: 'not-watching', id: 'm1' })
    const answer = await other.call('chat.answer', { terminal: 'dsh:omni', row: 'r', choice: 'allow' })
    assert.equal(answer.result.reason, 'not-watching')
    assert.equal(w.sock.requests.filter(m => ['send', 'answer', 'interrupt'].includes(m.method)).length, 0)
  } finally {
    await w.done()
  }
})

test('the socket\'s refusals reach the phone as they are, a settled answer with its receipt', async () => {
  const receipt = { where: 'computer', choice: 'deny', at: 1762500000000 }
  const errors = ['rate', 'busy', 'not-watching', 'not-shown', 'changed', 'invalid', 'text-on-approval', 'empty', 'too-long']
  let next = 0
  const w = await writer({
    reply: {
      // A settled answer comes back as the socket's own result, receipt and all.
      answer: (m) => (m.params.row === 'settled-row' ? { result: { ok: false, state: 'refused', reason: 'settled', receipt } } : { error: { kind: m.params.choice, message: `socket says ${m.params.choice}` } }),
      send: (m) => ({ error: { kind: errors[next++], message: 'no' } }),
    },
  })
  try {
    const settled = await w.p.call('chat.answer', { terminal: 'dsh:omni', row: 'settled-row', choice: 'allow' })
    assert.deepEqual(settled.result, { ok: false, state: 'refused', reason: 'settled', receipt })
    for (const kind of errors) {
      const { result } = await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'hi', id: `m-${kind}` })
      assert.deepEqual(result, { state: 'refused', ok: false, reason: kind, message: 'no', id: `m-${kind}` }, kind)
    }
    const global = await w.p.call('chat.answer', { terminal: 'dsh:omni', row: 'r2', choice: 'not-shown' })
    assert.equal(global.result.reason, 'not-shown')
    assert.equal(global.result.message, 'socket says not-shown')
    // The socket's own read-only (a channel it serves without writes) reads as the bridge's.
    const ro = await w.p.call('chat.answer', { terminal: 'dsh:omni', row: 'r3', choice: 'read-only' })
    assert.equal(ro.result.reason, 'read-only')
    assert.equal(ro.result.message, ANSWER_ON_COMPUTER)
  } finally {
    await w.done()
  }
})

test('the bridge counts too: one write in flight per chat, 20 a minute per phone, one interrupt per chat every 5 s', async () => {
  let clock = 1_000_000
  let hold = true
  const held = []
  const w = await writer({
    now: () => clock,
    requestMs: 300,
    reply: { send: (m) => (hold ? (held.push(m), null) : { result: { state: 'sent', id: m.params.id } }) },
  })
  try {
    // A second write while the first is unanswered: busy, and the socket sees only the first.
    const first = w.p.call('chat.send', { terminal: 'dsh:omni', text: 'one', id: 'a1' })
    await until(() => held.length === 1)
    const second = await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'two', id: 'a2' })
    assert.deepEqual(second.result, { state: 'refused', ok: false, reason: 'busy', id: 'a2' })
    assert.equal(w.sock.requests.filter(m => m.method === 'send').length, 1)
    hold = false
    w.sock.requests.length = 0
    // The held one ends with the socket's timeout as offline (maybe not sent), never queued.
    assert.equal((await first).result.reason, 'offline')
    // One interrupt per chat every 5 s.
    assert.equal((await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })).result.state, 'sent')
    assert.equal((await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })).result.reason, 'rate')
    clock += INTERRUPT_MS
    assert.equal((await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })).result.state, 'sent')
    // 20 writes a minute in all (a1 and two interrupts so far); the 21st is rate, a minute later it goes.
    for (let i = 3; i < WRITES_PER_MINUTE; i++) assert.equal((await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: `r${i}` })).result.state, 'sent', `write ${i + 1}`)
    const over = await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: 'r21' })
    assert.deepEqual(over.result, { state: 'refused', ok: false, reason: 'rate', id: 'r21' })
    assert.equal(w.sock.requests.filter(m => ['send', 'interrupt'].includes(m.method)).length, WRITES_PER_MINUTE - 1)
    clock += 60_000
    assert.equal((await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: 'r22' })).result.state, 'sent')
  } finally {
    await w.done()
  }
})

/** One more phone on the writer's source, subscribed to dsh:omni. */
async function another(w, { device, by }) {
  const p = phone(withDsh(fakeEngine(), w.dsh, { by }), { device })
  const subscribed = w.sock.requests.filter(m => m.method === 'subscribe').length
  await p.call('chat.subscribe', { terminal: 'dsh:omni' })
  await until(() => w.sock.requests.filter(m => m.method === 'subscribe').length > subscribed)
  return p
}

const writesAt = (sock) => sock.requests.filter(m => ['send', 'answer', 'interrupt'].includes(m.method))

test('two phones on one bridge: each write names its own phone, and each phone has its own 20 a minute and interrupt every 5 s', async () => {
  const w = await writer({ device: 'key-a', by: 'Pixel' })
  try {
    const b = await another(w, { device: 'key-b', by: 'Galaxy' })
    assert.equal((await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })).result.state, 'sent')
    assert.equal((await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })).result.reason, 'rate')
    assert.equal((await b.call('chat.interrupt', { terminal: 'dsh:omni' })).result.state, 'sent', 'A\'s interrupt does not hold B\'s')
    for (let i = 1; i < WRITES_PER_MINUTE; i++) assert.equal((await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: `a${i}` })).result.state, 'sent')
    assert.equal((await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: 'a21' })).result.reason, 'rate')
    assert.equal((await b.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: 'b1' })).result.state, 'sent', 'A\'s 20 do not count against B')
    // The socket can count per phone: every write carries the phone's key and name, set by the bridge.
    const byPhone = {}
    for (const m of writesAt(w.sock)) byPhone[`${m.params.phone} ${m.params.by}`] = (byPhone[`${m.params.phone} ${m.params.by}`] ?? 0) + 1
    assert.deepEqual(byPhone, { 'key-a Pixel': WRITES_PER_MINUTE, 'key-b Galaxy': 2 })
  } finally {
    await w.done()
  }
})

test('one phone on two connections: one 20 a minute across both, counted by its paired key', async () => {
  const w = await writer({ device: 'key-a' })
  try {
    const second = await another(w, { device: 'key-a', by: 'Pixel' })
    for (let i = 0; i < WRITES_PER_MINUTE; i++) {
      const p = i % 2 ? second : w.p
      assert.equal((await p.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: `m${i}` })).result.state, 'sent', `write ${i + 1}`)
    }
    assert.deepEqual((await second.call('chat.send', { terminal: 'dsh:omni', text: 'x', id: 'm21' })).result, { state: 'refused', ok: false, reason: 'rate', id: 'm21' })
    assert.equal((await w.p.call('chat.interrupt', { terminal: 'dsh:omni' })).result.reason, 'rate')
    assert.equal(writesAt(w.sock).length, WRITES_PER_MINUTE)
  } finally {
    await w.done()
  }
})

test('a phone cannot name itself: by and phone in its params are not what reaches the socket', async () => {
  const w = await writer({ device: 'phone-key', by: 'Pixel' })
  try {
    await w.p.call('chat.send', { terminal: 'dsh:omni', text: 'hi', id: 'm1', by: 'Evil', phone: 'other-key' })
    await w.p.call('chat.answer', { terminal: 'dsh:omni', row: 'r1', choice: 'deny', by: 'Evil', phone: 'other-key' })
    await w.p.call('chat.interrupt', { terminal: 'dsh:omni', by: 'Evil', phone: 'other-key' })
    assert.deepEqual(writesAt(w.sock).map(m => [m.method, m.params.by, m.params.phone]), [
      ['send', 'Pixel', 'phone-key'], ['answer', 'Pixel', 'phone-key'], ['interrupt', 'Pixel', 'phone-key'],
    ])
    // Through the source itself too: params never override the bridge's by and phone.
    await w.dsh.write(w.p.conn.client, 'dsh:omni', 'send', { text: 'x', id: 'm2', by: 'Evil', phone: 'other-key' }, { by: 'Pixel' })
    assert.deepEqual(writesAt(w.sock).at(-1).params, { channel: w.socketChannel, text: 'x', id: 'm2', by: 'Pixel', phone: 'phone-key' })
  } finally {
    await w.done()
  }
})

test('a connection with no paired key writes nothing: refused read-only, nothing at the socket', async () => {
  const w = await writer()
  try {
    for (const device of [undefined, '']) {
      const p = await another(w, { device, by: 'Pixel' })
      for (const [method, params] of [
        ['chat.send', { terminal: 'dsh:omni', text: 'hi', id: 'm1' }],
        ['chat.answer', { terminal: 'dsh:omni', row: 'r1', choice: 'allow' }],
        ['chat.interrupt', { terminal: 'dsh:omni' }],
      ]) assert.equal((await p.call(method, params)).result.reason, 'read-only', `${method} with device ${JSON.stringify(device)}`)
    }
    assert.equal(writesAt(w.sock).length, 0)
  } finally {
    await w.done()
  }
})

test('a removed phone\'s writes end within 2 s: revoke closes its chat, the socket hears unsubscribe, nothing more is sent', async () => {
  let hold = null
  const w = await writer({ requestMs: 300, reply: { send: (m) => (m.params.id === 'late' ? (hold = m, null) : { result: { state: 'sent', id: m.params.id } }) } })
  try {
    // As bridge.mjs does: the chat is in `live`, and revoke (every 2 s, bridge.mjs) ends a removed phone's.
    const live = new Set([{ phone: 'phone-key', end: () => w.p.conn.close('not paired') }])
    const inFlight = w.p.call('chat.send', { terminal: 'dsh:omni', text: 'sent before removal', id: 'late' })
    await until(() => hold)
    const removed = Date.now()
    assert.equal(endRemoved(live, new Set(['another-phone'])), 1)
    await until(() => w.sock.requests.some(m => m.method === 'unsubscribe'))
    assert.deepEqual(w.sock.requests.find(m => m.method === 'unsubscribe').params, { channel: w.socketChannel })
    assert.ok(Date.now() - removed < 2000, 'the socket is told within the revoke tick')
    // What the phone sends after removal never reaches the socket.
    const before = w.sock.requests.length
    w.p.conn.feed(frame(0, DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'chat.send', params: { terminal: 'dsh:omni', text: 'after', id: 'after' } }))))
    await settle()
    assert.equal(w.sock.requests.length, before)
    // Even through the source itself, a closed subscription writes nothing.
    const direct = await w.dsh.write(w.p.conn.client, 'dsh:omni', 'send', { text: 'after', id: 'after' }, { by: 'Pixel' })
    assert.equal(direct.reason, 'not-watching')
    // The write sent before removal ends at the socket's timeout into a closed connection: dropped, no error.
    assert.equal((await inFlight), undefined, 'a closed connection answers nothing')
    assert.equal(w.sock.requests.filter(m => m.method === 'send').length, 1)
  } finally {
    await w.done()
  }
})

test('absent is empty: no socket, a socket others can reach, or one neither read-only nor write: 1', async () => {
  const none = new DshSource({ path: join(tmpdir(), 'no-such-dir', 'pocket', 'chat.sock') })
  assert.deepEqual(await none.list(), [])
  for (const options of [{ mode: 0o666 }, { dirMode: 0o755 }]) {
    const sock = await fakeSocket(options)
    try {
      assert.equal(ownerOnly(sock.path), false, JSON.stringify(options))
      assert.deepEqual(await new DshSource({ path: sock.path }).list(), [])
      assert.deepEqual(sock.requests, [], 'nothing is sent to a socket others can reach')
    } finally {
      await sock.close()
    }
  }
  const writable = await fakeSocket({ readOnly: false })
  const dsh = new DshSource({ path: writable.path })
  try {
    assert.equal(ownerOnly(writable.path), true)
    assert.deepEqual(await dsh.list(), [])
    assert.deepEqual(writable.requests.map(m => m.method), ['hello'])
  } finally {
    dsh.close()
    await writable.close()
  }
})

test('the team homes, in the order they are tried; HERDR_APP_HOME does not enter them', () => {
  const you = '/home/you'
  assert.deepEqual(teamHomes({}, you), [join(you, '.automagik', 'desktop', 'bots'), join(you, '.automagik', 'bots')])
  assert.deepEqual(teamHomes({ AUTOMAGIK_BOTS_HOME: '/srv/team', HERDR_APP_HOME: '/srv/herdr' }, you),
    ['/srv/team', join(you, '.automagik', 'desktop', 'bots'), join(you, '.automagik', 'bots')])
  assert.deepEqual(teamHomes({ AUTOMAGIK_HOME: '/srv/am', AUTOMAGIK_BOTS_HOME: ' ' }, you), [join('/srv/am', 'desktop', 'bots'), join('/srv/am', 'bots')])
  assert.deepEqual(teamHomes({ AUTOMAGIK_BOTS_HOME: '~/.automagik/desktop/bots' }, you), [join(you, '.automagik', 'desktop', 'bots'), join(you, '.automagik', 'bots')], 'once each')
  assert.deepEqual(socketPaths({ AUTOMAGIK_BOTS_HOME: '/srv/team' }, you)[0], join('/srv/team', 'pocket', 'chat.sock'))
})

/** Temp Automagik home with the three candidate team homes (#548): named by env, desktop, own dsh. */
function candidates() {
  const root = mkdtempSync(join(tmpdir(), 'dr-'))
  const env = { AUTOMAGIK_HOME: root, AUTOMAGIK_BOTS_HOME: join(root, 'named') }
  return { root, env, named: join(root, 'named'), desktop: join(root, 'desktop', 'bots'), own: join(root, 'bots'), done: () => rmSync(root, { recursive: true, force: true }) }
}

test('each team home is used when it is the only one with an owner-only socket', async () => {
  for (const which of ['named', 'desktop', 'own']) {
    const c = candidates()
    const sock = await fakeSocket({ at: c[which] })
    const dsh = new DshSource({ paths: socketPaths(c.env) })
    try {
      assert.deepEqual((await dsh.list()).map(t => t.terminal), ['dsh:omni'], which)
      assert.equal(dsh.path, sock.path, which)
    } finally {
      dsh.close()
      await sock.close()
      c.done()
    }
  }
})

test('the first team home with an owner-only socket wins; one others can reach is passed over', async () => {
  const c = candidates()
  const named = await fakeSocket({ at: c.named, mode: 0o666 })
  const desktop = await fakeSocket({ at: c.desktop })
  const own = await fakeSocket({ at: c.own })
  const dsh = new DshSource({ paths: socketPaths(c.env) })
  try {
    assert.deepEqual((await dsh.list()).map(t => t.terminal), ['dsh:omni'])
    assert.equal(dsh.path, desktop.path)
    assert.deepEqual(named.requests, [], 'nothing is sent to a socket others can reach')
    assert.deepEqual(own.requests, [])
  } finally {
    dsh.close()
    await Promise.all([named, desktop, own].map(s => s.close()))
    c.done()
  }
})

test('a wrong AUTOMAGIK_BOTS_HOME falls through to the desktop app\'s team', async () => {
  const c = candidates()
  const desktop = await fakeSocket({ at: c.desktop })
  const env = { ...c.env, AUTOMAGIK_BOTS_HOME: join(c.root, 'nowhere') }
  const dsh = new DshSource({ paths: socketPaths(env) })
  try {
    assert.deepEqual((await dsh.list()).map(t => t.terminal), ['dsh:omni'])
    assert.equal(dsh.path, desktop.path)
  } finally {
    dsh.close()
    await desktop.close()
    c.done()
  }
})

test('no team home with an owner-only socket: no source, nothing connected, said once', async () => {
  const c = candidates()
  mkdirSync(join(c.named, 'pocket'), { recursive: true, mode: 0o700 })
  const desktop = await fakeSocket({ at: c.desktop, dirMode: 0o755 })
  const logs = []
  const connected = []
  const dsh = new DshSource({ paths: socketPaths(c.env), connect: (path) => { connected.push(path); throw new Error('no connect') }, log: (line) => logs.push(line) })
  try {
    assert.deepEqual(await dsh.list(), [])
    assert.deepEqual(await dsh.list(), [])
    assert.equal(dsh.path, null)
    assert.deepEqual(connected, [], 'no socket is read')
    assert.deepEqual(desktop.requests, [])
    assert.equal(logs.length, 1)
    assert.match(logs[0], /no DSH socket only this account reaches/)
  } finally {
    await desktop.close()
    c.done()
  }
})

/** lstat, with another owner for the folders in `owners` (real and as written). */
const ownedBy = (owners) => (path) => {
  const s = lstatSync(path)
  return Object.hasOwn(owners, path) ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { uid: owners[path] }) : s
}
const both = (path, uid) => ({ [path]: uid, [realpathSync(path)]: uid })

test('a folder above the socket that another account owns or could write fails closed (#548)', async () => {
  const c = candidates()
  const team = c.named
  const sock = await fakeSocket({ at: team })
  try {
    assert.equal(ownerOnly(sock.path), true)
    const uid = process.getuid()
    for (const mode of [0o757, 0o777]) {
      chmodSync(team, mode)
      assert.equal(ownerOnly(sock.path), false, mode.toString(8))
      assert.equal(ownerOnly(sock.path, uid, { platform: 'linux', gid: lstatSync(team).gid }), false, `${mode.toString(8)}: others, even in our group`)
      assert.deepEqual(await new DshSource({ path: sock.path }).list(), [], mode.toString(8))
    }
    // Group-writable: only on Linux, and only when the group is our own primary group.
    chmodSync(team, 0o775)
    const group = lstatSync(team).gid
    assert.equal(ownerOnly(sock.path, uid, { platform: 'linux', gid: group }), true, 'Linux, our own group')
    assert.equal(ownerOnly(sock.path, uid, { platform: 'linux', gid: group + 1 }), false, 'Linux, another group')
    assert.equal(ownerOnly(sock.path, uid, { platform: 'darwin', gid: group }), false, 'macOS: staff is shared')
    assert.deepEqual(await new DshSource({ path: sock.path, check: (p) => ownerOnly(p, uid, { platform: 'darwin', gid: group }) }).list(), [])
    chmodSync(team, 0o1777)
    assert.equal(ownerOnly(sock.path), true, 'sticky: nobody else can rename what is ours in it')
    chmodSync(team, 0o755)
    assert.equal(ownerOnly(sock.path, uid, { lstat: ownedBy(both(c.root, uid + 1)) }), false, 'another account')
    assert.equal(ownerOnly(sock.path, uid, { lstat: ownedBy(both(c.root, 0)) }), true, 'root')
    // A link on the way: ours is fine, another account's is not (it could point it elsewhere).
    const link = join(c.root, 'link')
    symlinkSync(team, link)
    const viaLink = join(link, 'pocket', 'chat.sock')
    assert.equal(ownerOnly(viaLink), true)
    assert.equal(ownerOnly(viaLink, uid, { lstat: ownedBy({ [link]: uid + 1 }) }), false)
    // A link that leads into a folder anyone can write: fine as written, refused on the real path.
    const open = join(c.root, 'open')
    const inner = join(open, 'team')
    mkdirSync(open)
    chmodSync(open, 0o777)
    const deep = await fakeSocket({ at: inner })
    const intoOpen = join(c.root, 'into-open')
    symlinkSync(inner, intoOpen)
    try {
      assert.equal(ownerOnly(join(intoOpen, 'pocket', 'chat.sock')), false)
      assert.equal(ownerOnly(join(intoOpen, 'pocket', 'chat.sock'), uid, { platform: 'linux', gid: lstatSync(open).gid }), false, 'even in our own group')
      assert.deepEqual(await new DshSource({ path: join(intoOpen, 'pocket', 'chat.sock') }).list(), [])
      assert.deepEqual(deep.requests, [])
    } finally {
      await deep.close()
    }
    assert.deepEqual(sock.requests, [])
  } finally {
    await sock.close()
    c.done()
  }
})
