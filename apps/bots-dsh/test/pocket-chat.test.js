// Pocket live chat for the team's own Bots (#517), driven by a fake DSH 0.2.2 Session Controller
// with the rc.1 Host Remote shapes (follow, events, state, observeState). No DSH package is
// loaded: the fake is the controller.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { createAdapter } from '../src/host/pocket-chat-adapter.js'
import {
  ANSWER_ON_COMPUTER, DshChatSource, cursorOf, hasSessionApi, install, ownBots, rowIdOf, rowsOf, statusOf,
} from '../src/host/pocket-chat.js'
import { CLOSE_GRACE_MS, MAX_LINE, socketPathOf, startPocketSocket } from '../src/host/pocket-socket.js'
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
/** How long a test waits for one answer or step before it fails (never hangs). */
const STEP_MS = 5000

/** `promise`, or a rejection after `ms`; the timer is cleared either way. */
function within(promise, ms = STEP_MS) {
  let timer
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`not within ${ms} ms`)), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

function client(path) {
  const socket = createConnection(path)
  let buffer = ''
  let ended = false
  const lines = []
  const waiting = []
  const wake = () => { for (const wait of waiting.splice(0)) wait() }
  socket.setEncoding('utf8')
  socket.on('error', () => {})
  socket.on('close', () => { ended = true; wake() })
  socket.on('data', (chunk) => {
    buffer += chunk
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
      lines.push(message)
    }
    wake()
  })
  // An answer that does not come fails the test: the socket closed, or STEP_MS went by.
  const until = async (match) => {
    for (;;) {
      const found = lines.find(match)
      if (found) return found
      if (ended) throw new Error('the socket closed before the answer')
      await within(new Promise(resolve => waiting.push(resolve)))
    }
  }
  let next = 1
  return {
    socket, lines, until,
    ask: (method, params) => { const id = next++; socket.write(`${JSON.stringify({ id, method, params })}\n`); return until(line => line.id === id) },
    closed: () => within(new Promise(resolve => (ended ? resolve() : socket.once('close', resolve)))),
  }
}

/**
 * One test's team home. Whatever the test opens through it (hosts, clients, child processes) is
 * closed after the test, passed or failed, and only then is the home removed: no handle outlives
 * a test.
 */
function scope(t) {
  const home = tempHome()
  const opened = []
  t.after(async () => {
    for (const close of opened.reverse()) await close()
    rmSync(home, { recursive: true, force: true })
  })
  return {
    home,
    path: socketPathOf(home),
    /** Run `close` after the test, before the home is removed (last opened, first closed). */
    defer: (close) => { opened.push(close) },
    /** A host on this home; closed after the test even if the test stopped waiting for it. */
    start(options = {}) {
      const started = startPocketSocket({ home, source: sourceOf(fakeController(sessions())), ...options })
      opened.push(async () => { const host = await started.catch(() => null); await host?.close() })
      return started
    },
    client(path = socketPathOf(home), options) {
      const c = options ? null : client(path)
      const socket = c?.socket ?? createConnection({ path, ...options })
      if (!c) socket.on('error', () => {})
      opened.push(() => socket.destroy())
      return c ?? socket
    },
    async hello(path = socketPathOf(home)) {
      const c = this.client(path)
      try { return (await c.ask('hello')).result } finally { c.socket.destroy() }
    },
    /** A socket left by a host that died: a child binds it and is killed (a clean close unlinks it). */
    async staleSocket() {
      mkdirSync(join(home, 'pocket'), { recursive: true, mode: 0o700 })
      const child = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(process.env.SOCK, () => console.log('ok'))"], { env: { ...process.env, SOCK: socketPathOf(home) }, stdio: ['ignore', 'pipe', 'inherit'] })
      const exited = new Promise(resolve => child.once('exit', resolve))
      const kill = async () => { child.kill('SIGKILL'); await exited; child.stdout.destroy() }
      opened.push(kill)
      try {
        await within(new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('the stale host exited before it bound'))) }))
      } finally {
        await kill()
      }
      return lstatSync(socketPathOf(home))
    },
  }
}

test('the socket is a Unix socket under the team home, mode 0600 in a 0700 folder', async (t) => {
  const s = scope(t)
  const server = await s.start()
  assert.equal(server.path, socketPathOf(s.home))
  assert.ok(!relative(s.home, server.path).startsWith('..'), 'under the team home')
  assert.ok(lstatSync(server.path).isSocket())
  assert.equal(statSync(server.path).mode & 0o777, 0o600)
  assert.equal(statSync(join(s.home, 'pocket')).mode & 0o777, 0o700)
  await server.close()
})

test('over the socket: list and subscribe read; every other method is answered read-only', async (t) => {
  const s = scope(t)
  const controller = fakeController(sessions())
  const server = await s.start({ source: sourceOf(controller) })
  const c = s.client(server.path)
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
})

// ---- the socket's start and stop (#548)

/**
 * Which file is at a path: the same tuple the stale check compares. An inode alone proves
 * nothing, since Linux hands a freed one to the next file at once (#301).
 */
const identityOf = s => ({ dev: s.dev, ino: s.ino, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs })
const identity = path => identityOf(lstatSync(path))

test('start refuses something that is not a socket at the path, and keeps it', async (t) => {
  const s = scope(t)
  mkdirSync(join(s.home, 'pocket'), { mode: 0o700 })
  writeFileSync(s.path, 'keep me')
  await assert.rejects(s.start(), /not a socket/)
  assert.equal(readFileSync(s.path, 'utf8'), 'keep me')
})

test('start refuses while another host serves the team, and leaves that host serving', async (t) => {
  const s = scope(t)
  const first = await s.start()
  const before = identity(first.path)
  await assert.rejects(s.start(), /another host already serves/)
  assert.deepEqual(identity(first.path), before, 'the live socket is kept')
  assert.equal((await s.hello()).readOnly, true)
})

test('start removes a dead host\'s stale socket and serves in its place', async (t) => {
  const s = scope(t)
  const stale = await s.staleSocket()
  assert.ok(stale.isSocket())
  const server = await s.start()
  assert.notDeepEqual(identity(server.path), identityOf(stale), 'another file than the stale one')
  assert.equal(statSync(server.path).mode & 0o777, 0o600)
  // The stale host is dead, so an answer can only come from the new one.
  assert.equal((await s.hello()).readOnly, true)
  await server.close()
  assert.equal(existsSync(server.path), false, 'a clean stop leaves no socket')
})

test('start tightens a folder others could open back to 0700', async (t) => {
  const s = scope(t)
  mkdirSync(join(s.home, 'pocket'))
  chmodSync(join(s.home, 'pocket'), 0o777)
  const server = await s.start()
  assert.equal(statSync(join(s.home, 'pocket')).mode & 0o777, 0o700)
  assert.equal(statSync(server.path).mode & 0o777, 0o600)
})

test('two starts at once: one serves, the other is refused, and the one serving keeps its socket', async (t) => {
  const s = scope(t)
  await s.staleSocket()
  const results = await Promise.allSettled([s.start(), s.start()])
  const won = results.filter(r => r.status === 'fulfilled').map(r => r.value)
  const lost = results.filter(r => r.status === 'rejected').map(r => r.reason.message)
  assert.equal(won.length, 1)
  assert.deepEqual(lost, ['another host already serves this team to Pocket'])
  assert.equal((await s.hello()).readOnly, true, 'the bound socket was not unlinked')
})

test('a stop cuts a reader that never ends its side, and the next start goes ahead', async (t) => {
  const s = scope(t)
  const first = await s.start()
  // A half-open reader: it keeps its side open after the host ends its own.
  const stuck = s.client(first.path, { allowHalfOpen: true })
  stuck.setEncoding('utf8')
  const answered = new Promise(resolve => stuck.once('data', resolve))
  stuck.write(`${JSON.stringify({ id: 1, method: 'hello' })}\n`)
  await within(answered)
  await within(first.close(), CLOSE_GRACE_MS + 2000)
  await within(s.start())
  assert.equal((await s.hello()).readOnly, true)
})

/** lstat with one field changed, as if the file at the path had been made again. */
const remade = field => (path) => {
  const s = lstatSync(path)
  return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { [field]: s[field] + 1 })
}

for (const field of ['ctimeMs', 'birthtimeMs']) {
  test(`a stale socket made again in its place (an inode reused) is not removed: ${field}`, async (t) => {
    const s = scope(t)
    const stale = await s.staleSocket()
    await assert.rejects(s.start({ lstat: remade(field) }), /another host already serves/)
    assert.deepEqual(identity(s.path), identityOf(stale), 'the file is kept')
  })
}

test('a bind that loses the race (EADDRINUSE) is refused like a live host', async (t) => {
  const s = scope(t)
  const stale = await s.staleSocket()
  // The re-check finds the path gone, as if another host had taken it: nothing is removed and
  // the bind meets the file still there.
  const gone = () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }
  await assert.rejects(s.start({ lstat: gone }), { message: 'another host already serves this team to Pocket' })
  assert.deepEqual(identity(s.path), identityOf(stale), 'the file is kept')
})

test('a stop and a start at once: the stop finishes first and the new host keeps its socket', async (t) => {
  const s = scope(t)
  const old = await s.start()
  const [, fresh] = await within(Promise.all([old.close(), s.start()]))
  assert.equal((await s.hello()).readOnly, true)
  await old.close()
  assert.equal((await s.hello()).readOnly, true, 'closing the old host again removes nothing')
  await fresh.close()
  assert.equal(existsSync(fresh.path), false)
})

// ---- install

const rtFor = (ctx, home) => ({ ...team(), ctx, home, warn() {} })

test('without DSH 0.2.2\'s Session API, install registers nothing and opens no socket', async (t) => {
  const s = scope(t)
  for (const services of [{}, { sessionController: { follow() {} } }]) {
    const ctx = fakeContext({ services })
    install(rtFor(ctx, s.home))
    assert.deepEqual(ctx.calls, [])
  }
  assert.throws(() => lstatSync(s.path), { code: 'ENOENT' })
})

test('with the Session API, install loads the adapter lazily and serves the socket until disposed', async (t) => {
  const s = scope(t)
  const ctx = fakeContext({ services: { sessionController: fakeController(sessions()) } })
  // Disposed after the test whatever happens (a second dispose is a no-op), before the home goes.
  s.defer(() => ctx.dispose())
  install(rtFor(ctx, s.home))
  assert.deepEqual(ctx.calls, ['effect ds-bot: pocket chat'])
  let found = null
  for (let i = 0; i < 200 && !found; i++) {
    try { found = lstatSync(s.path) } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  assert.ok(found?.isSocket(), 'the socket appears')
  const c = s.client()
  assert.deepEqual((await c.ask('list')).result.terminals.map(row => row.terminal), ['dsh:omni', 'dsh:ada'])
  c.socket.destroy()
  await within(ctx.dispose())
  assert.throws(() => lstatSync(s.path), { code: 'ENOENT' })
})
