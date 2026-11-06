// Pocket live chat for the team's own Bots (#517), driven by a fake DSH 0.2.2 Session Controller
// with the rc.1 Host Remote shapes (follow, events, state, observeState). No DSH package is
// loaded: the fake is the controller.
import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { createAdapter } from '../src/host/pocket-chat-adapter.js'
import {
  ANSWER_ON_COMPUTER, DshChatSource, cursorOf, hasSessionApi, install, ownBots, rowIdOf, rowsOf, statusOf,
} from '../src/host/pocket-chat.js'
import { MAX_LINE, socketPathOf, startPocketSocket } from '../src/host/pocket-socket.js'
import { fakeContext } from './fake-ctx.js'

// ---- the fake Session Controller

/** A push-fed async iterable that ends when its signal aborts. */
function feed(signal) {
  const items = []
  const waiting = []
  let done = false
  const finish = () => { done = true; for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true }) }
  signal?.addEventListener('abort', finish, { once: true })
  return {
    push(value) { if (done) return; const next = waiting.shift(); if (next) next({ value, done: false }); else items.push(value) },
    end: finish,
    [Symbol.asyncIterator]() { return this },
    next() {
      if (items.length) return Promise.resolve({ value: items.shift(), done: false })
      if (done) return Promise.resolve({ value: undefined, done: true })
      return new Promise(resolve => waiting.push(resolve))
    },
  }
}

const event = (seq, type, data) => ({ type: 'event', event: { type, seq, time: 1_000 + seq, data } })
const text = value => [{ type: 'text', text: value }]
const userAt = (seq, value, source = { kind: 'user' }) => event(seq, 'user/message', { id: `m${seq}`, role: 'user', content: text(value), source })
const assistantAt = (seq, value, extra = {}) => event(seq, 'assistant/message', { turn: 1, step: 0, message: { id: `a${seq}`, role: 'assistant', content: text(value), source: { kind: 'model' } }, stream: [], ...extra })

function fakeController(sessions) {
  const calls = []
  const followers = new Map()
  const observers = new Map()
  const live = id => sessions[id]
  return {
    calls,
    follow({ address }, signal) {
      calls.push(`follow ${address.kind} ${address.sessionId}`)
      const session = live(address.sessionId)
      const stream = feed(signal)
      if (!session) { stream.end(); return stream }
      const window = session.records.slice(-(session.window ?? session.records.length))
      stream.push({ type: 'snapshot', header: { version: 1, id: address.sessionId, createdAt: 0, isSeeded: false, ...session.header }, cursor: session.records.at(-1)?.event.seq ?? -1, records: window, hasMore: window.length < session.records.length, projections: { asOfSeq: -1, values: {} } })
      followers.set(address.sessionId, stream)
      return stream
    },
    async events({ address, beforeSeq, maxMessages }) {
      calls.push(`events ${address.sessionId} before ${beforeSeq} max ${maxMessages}`)
      const older = live(address.sessionId).records.filter(record => beforeSeq === undefined || record.event.seq < beforeSeq)
      const records = older.slice(-(maxMessages ?? older.length))
      return { records, hasMore: records.length < older.length, cursor: records.at(-1)?.event.seq ?? -1 }
    },
    async state({ sessionId }) {
      calls.push(`state ${sessionId}`)
      const session = live(sessionId)
      return { cursor: session.records.at(-1)?.event.seq ?? -1, active: true, running: session.running ?? false, queue: [], pendingInput: session.pending ?? [] }
    },
    observeState({ sessionId }, signal) {
      calls.push(`observeState ${sessionId}`)
      const stream = feed(signal)
      observers.set(sessionId, stream)
      return stream
    },
    // Writes a read-only source must never reach.
    async prompt() { calls.push('prompt') },
    cancel() { calls.push('cancel') },
    // Test helpers.
    append(sessionId, record) { live(sessionId).records.push(record); followers.get(sessionId)?.push(record) },
    observe(sessionId, state) { observers.get(sessionId)?.push(state) },
  }
}

// ---- a team

const settle = () => new Promise(resolve => setImmediate(resolve))
const timers = { setInterval: () => ({ unref() {} }), clearInterval() {} }

function team() {
  const state = {
    bots: {
      omni: { id: 'omni', name: 'Omni', sessionId: 's-omni-2', segments: [{ sessionId: 's-omni-1' }] },
      ada: { id: 'ada', name: 'Ada' },
    },
    rooms: { room1: { id: 'room1', sessions: { omni: 's-group-omni' } } },
  }
  return {
    state,
    load: async () => {},
    botOf: id => state.bots[id],
    chatOf: id => state.bots[id]?.sessionId ?? id,
  }
}

function sessions() {
  return {
    's-omni-2': {
      records: [
        event(0, 'turn/start', { turn: 1 }),
        userAt(1, 'hi'),
        userAt(2, 'file changed', { kind: 'tool' }),
        event(3, 'step/start', { turn: 1, step: 0 }),
        assistantAt(4, 'hello', { usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 } }),
        event(5, 'tool/call', { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }),
        event(6, 'tool/result', { turn: 1, step: 0, message: { id: 'r1', role: 'tool', toolCallId: 'c1', content: text('a b'), source: { kind: 'tool' } } }),
      ],
    },
    ada: { records: [userAt(0, 'yo')] },
    's-sub': { header: { origin: 'subagent' }, records: [] },
  }
}

const sourceOf = (controller, rt = team()) => new DshChatSource({ adapter: createAdapter(controller), bots: ownBots(rt), timers })
const watcher = () => {
  const events = []
  return { events, listener: e => events.push(e), last: type => events.filter(e => e.type === type).at(-1) }
}

// ---- tests

test('lists only the team\'s own live Bots, each with its own current chat Session', async () => {
  const rt = team()
  assert.deepEqual(await ownBots(rt)(), [
    { id: 'omni', name: 'Omni', sessionId: 's-omni-2' },
    { id: 'ada', name: 'Ada', sessionId: 'ada' },
  ])
  const listed = await sourceOf(fakeController(sessions()), rt).list()
  assert.deepEqual(listed.map(row => [row.terminal, row.agent, row.chat, row.title]), [['dsh:omni', 'dsh', 'session', 'Omni'], ['dsh:ada', 'dsh', 'session', 'Ada']])
  // No group, task or archived segment Session is ever listed.
  assert.ok(!JSON.stringify(listed).includes('s-group-omni') && !JSON.stringify(listed).includes('s-omni-1'))
})

test('a subagent Session is refused', async () => {
  const rt = team()
  rt.state.bots.sub = { id: 'sub', name: 'Sub', sessionId: 's-sub' }
  const result = await sourceOf(fakeController(sessions()), rt).watch('dsh:sub', () => {})
  assert.deepEqual(result, { ok: false, reason: 'subagent' })
})

test('a snapshot maps the log to rows in seq order, with the status, and follows passively', async () => {
  const controller = fakeController(sessions())
  const w = watcher()
  const handle = await sourceOf(controller).watch('dsh:omni', w.listener)
  assert.equal(handle.ok, true)
  const snapshot = w.events[0]
  assert.equal(snapshot.type, 'snapshot')
  assert.equal(snapshot.reset, false)
  assert.deepEqual(snapshot.screen, [])
  assert.deepEqual(snapshot.held, [])
  assert.equal(snapshot.approval, null)
  assert.deepEqual(snapshot.status, { state: 'idle', kind: null, msg: '', turn: 1 })
  assert.deepEqual(snapshot.rows.map(row => [row.id, row.kind, row.role ?? null, row.source]), [
    ['dsh:s-omni-2:1', 'text', 'user', 'session'],
    ['dsh:s-omni-2:4', 'text', 'assistant', 'session'],
    ['dsh:s-omni-2:4#tokens', 'tokens', null, 'session'],
    ['dsh:s-omni-2:5', 'tool-call', null, 'session'],
    ['dsh:s-omni-2:6', 'tool-result', null, 'session'],
  ])
  assert.deepEqual(snapshot.rows[2], { id: 'dsh:s-omni-2:4#tokens', turn: 1, at: 1004, source: 'session', kind: 'tokens', input: 10, output: 3, cache: 2 })
  assert.equal(snapshot.rows[3].tool, 'bash')
  assert.equal(snapshot.rows[4].call, 'dsh:s-omni-2:5')
  assert.equal(snapshot.rows[4].output, 'a b')
  // An ordinary Session address, a passive follow, and nothing but reads.
  assert.deepEqual(controller.calls, ['follow session s-omni-2', 'state s-omni-2', 'observeState s-omni-2'])
  handle.close()
})

test('a pending approval shows a read-only row that says Answer on the computer', async () => {
  const data = sessions()
  const controller = fakeController(data)
  const w = watcher()
  const handle = await sourceOf(controller).watch('dsh:omni', w.listener)
  // A new call: the source re-reads the state, since a pending approval alone wakes nothing.
  data['s-omni-2'].pending = ['approval']
  data['s-omni-2'].running = true
  controller.append('s-omni-2', event(7, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'rm', arguments: '{}' }))
  await settle(); await settle()
  assert.deepEqual(w.last('rows').rows.map(row => row.id), ['dsh:s-omni-2:7'])
  assert.deepEqual(w.last('status').status, { state: 'blocked', kind: 'permission', msg: ANSWER_ON_COMPUTER, turn: 1 })
  const row = w.last('approval').row
  assert.equal(row.kind, 'approval')
  assert.equal(row.summary, 'Answer on the computer')
  assert.equal(row.answerable, false)
  assert.deepEqual(row.choices, [])
  assert.equal(row.open, true)
  // Answered on the computer: observeState carries the change, and the row closes.
  controller.observe('s-omni-2', { cursor: 8, active: true, running: true, queue: [], pendingInput: [] })
  await settle()
  assert.deepEqual(w.last('approval').row.open, false)
  assert.equal(w.last('status').status.state, 'working')
  // A question is the same: read-only, answered on the computer.
  controller.observe('s-omni-2', { cursor: 9, active: true, running: true, queue: [], pendingInput: ['question'] })
  await settle()
  assert.deepEqual([w.last('question').row.kind, w.last('question').row.prompt, w.last('question').row.answerable], ['question', ANSWER_ON_COMPUTER, false])
  assert.ok(!controller.calls.includes('prompt') && !controller.calls.includes('cancel'))
  handle.close()
})

test('reconnect: a cursor in the window gets only what it missed; an older one is paged; another Session\'s resets', async () => {
  const data = sessions()
  data['s-omni-2'].window = 3
  const controller = fakeController(data)
  const source = sourceOf(controller)
  const first = watcher()
  const handle = await source.watch('dsh:omni', first.listener)
  assert.deepEqual(first.events[0].rows.map(row => row.id), ['dsh:s-omni-2:4', 'dsh:s-omni-2:4#tokens', 'dsh:s-omni-2:5', 'dsh:s-omni-2:6'])
  // Missed within the rows kept.
  const again = watcher()
  await source.watch('dsh:omni', again.listener, { after: 'dsh:s-omni-2:5' })
  assert.deepEqual([again.events[0].reset, again.events[0].rows.map(row => row.id)], [false, ['dsh:s-omni-2:6']])
  // Older than the kept rows: one events page fills the gap.
  const older = watcher()
  await source.watch('dsh:omni', older.listener, { after: 'dsh:s-omni-2:1' })
  assert.equal(older.events[0].reset, false)
  assert.deepEqual(older.events[0].rows.map(row => row.id), ['dsh:s-omni-2:4', 'dsh:s-omni-2:4#tokens', 'dsh:s-omni-2:5', 'dsh:s-omni-2:6'])
  assert.ok(controller.calls.includes('events s-omni-2 before 4 max 200'))
  // The Bot moved to a new part since: the old cursor resets to the latest page.
  const moved = watcher()
  await source.watch('dsh:omni', moved.listener, { after: 'dsh:s-omni-1:3' })
  assert.equal(moved.events[0].reset, true)
  assert.deepEqual(moved.events[0].rows.map(row => row.id), ['dsh:s-omni-2:4', 'dsh:s-omni-2:4#tokens', 'dsh:s-omni-2:5', 'dsh:s-omni-2:6'])
  // Older rows on request, from the log.
  assert.deepEqual((await handle.backfill('dsh:s-omni-2:5', 10)).map(row => row.id), ['dsh:s-omni-2:1', 'dsh:s-omni-2:4', 'dsh:s-omni-2:4#tokens'])
  source.close()
})

test('every write is refused and reaches no controller method', async () => {
  const controller = fakeController(sessions())
  const source = sourceOf(controller)
  for (const [name, args] of [['send', ['dsh:omni', { text: 'x', id: 'm1' }]], ['sendHeld', ['dsh:omni', { id: 'm1' }]], ['cancelHeld', ['dsh:omni', { id: 'm1' }]], ['answer', ['dsh:omni', { row: 'r', choice: 'allow' }]], ['interrupt', ['dsh:omni']]]) {
    const answer = source[name](...args)
    assert.equal(answer.state, 'refused', name)
    assert.equal(answer.reason, 'read-only', name)
    assert.equal(answer.message, ANSWER_ON_COMPUTER, name)
  }
  assert.deepEqual(controller.calls, [])
})

test('rows and status helpers keep their contract', () => {
  assert.deepEqual(cursorOf(rowIdOf('s1', 12, 'tokens')), { sessionId: 's1', seq: 12 })
  assert.equal(cursorOf('t3:7'), null)
  assert.deepEqual(rowsOf({ type: 'request/header', seq: 1, data: {} }, { sessionId: 's', turn: 0, calls: new Map() }), [])
  assert.equal(statusOf({ running: true, pendingInput: [] }).state, 'working')
  assert.equal(hasSessionApi({ follow() {} }), false, 'DSH 0.2.1 has follow alone: not enough')
})

// ---- the socket

const tempHome = () => mkdtempSync(join(tmpdir(), 'pchat-'))

function client(path) {
  const socket = createConnection(path)
  let buffer = ''
  const lines = []
  const waiting = []
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += chunk
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
      lines.push(message)
      for (const wait of waiting.splice(0)) wait()
    }
  })
  const until = async (match) => {
    for (;;) {
      const found = lines.find(match)
      if (found) return found
      await new Promise(resolve => waiting.push(resolve))
    }
  }
  let next = 1
  return {
    socket, lines, until,
    ask: (method, params) => { const id = next++; socket.write(`${JSON.stringify({ id, method, params })}\n`); return until(line => line.id === id) },
    closed: () => new Promise(resolve => socket.once('close', resolve)),
  }
}

test('the socket is a Unix socket under the team home, mode 0600 in a 0700 folder', async () => {
  const home = tempHome()
  try {
    const server = await startPocketSocket({ home, source: sourceOf(fakeController(sessions())) })
    assert.equal(server.path, socketPathOf(home))
    assert.ok(!relative(home, server.path).startsWith('..'), 'under the team home')
    assert.ok(lstatSync(server.path).isSocket())
    assert.equal(statSync(server.path).mode & 0o777, 0o600)
    assert.equal(statSync(join(home, 'pocket')).mode & 0o777, 0o700)
    await server.close()
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('over the socket: list and subscribe read; every other method is answered read-only', async () => {
  const home = tempHome()
  const controller = fakeController(sessions())
  const server = await startPocketSocket({ home, source: sourceOf(controller) })
  const c = client(server.path)
  try {
    assert.deepEqual((await c.ask('hello')).result, { protocol: 1, readOnly: true, methods: ['hello', 'list', 'subscribe', 'unsubscribe', 'backfill'] })
    assert.deepEqual((await c.ask('list')).result.terminals.map(row => row.terminal), ['dsh:omni', 'dsh:ada'])
    assert.deepEqual((await c.ask('subscribe', { terminal: 'dsh:omni', channel: 3 })).result, { channel: 3 })
    const snapshot = await c.until(line => line.channel === 3 && line.event.type === 'snapshot')
    assert.equal(snapshot.event.rows.length, 5)
    for (const method of ['send', 'sendHeld', 'cancelHeld', 'answer', 'interrupt', 'prompt', '$events']) {
      assert.equal((await c.ask(method, { terminal: 'dsh:omni' })).error.kind, 'read-only', method)
    }
    assert.ok(!controller.calls.includes('prompt') && !controller.calls.includes('cancel'))
    // A line past the limit ends the connection.
    const gone = c.closed()
    c.socket.write('x'.repeat(MAX_LINE + 2))
    await gone
  } finally {
    c.socket.destroy()
    await server.close()
    rmSync(home, { recursive: true, force: true })
  }
})

// ---- install

const rtFor = (ctx, home) => ({ ...team(), ctx, home, warn() {} })

test('without DSH 0.2.2\'s Session API, install registers nothing and opens no socket', async () => {
  const home = tempHome()
  try {
    for (const services of [{}, { sessionController: { follow() {} } }]) {
      const ctx = fakeContext({ services })
      install(rtFor(ctx, home))
      assert.deepEqual(ctx.calls, [])
    }
    assert.throws(() => lstatSync(socketPathOf(home)), { code: 'ENOENT' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('with the Session API, install loads the adapter lazily and serves the socket until disposed', async () => {
  const home = tempHome()
  const ctx = fakeContext({ services: { sessionController: fakeController(sessions()) } })
  try {
    install(rtFor(ctx, home))
    assert.deepEqual(ctx.calls, ['effect ds-bot: pocket chat'])
    let found = null
    for (let i = 0; i < 200 && !found; i++) {
      try { found = lstatSync(socketPathOf(home)) } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
    }
    assert.ok(found?.isSocket(), 'the socket appears')
    const c = client(socketPathOf(home))
    assert.deepEqual((await c.ask('list')).result.terminals.map(row => row.terminal), ['dsh:omni', 'dsh:ada'])
    c.socket.destroy()
    await ctx.dispose()
    assert.throws(() => lstatSync(socketPathOf(home)), { code: 'ENOENT' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
