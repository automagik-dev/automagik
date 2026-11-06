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
import { ANSWER_ON_COMPUTER, DshSource, ownerOnly, socketPaths, teamHomes, withDsh } from './dsh-source.mjs'

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }

/**
 * A stand-in for bots-dsh's pocket-socket.js: answers like it, records every request. In its own
 * temp home, or in the team home `at` (made if missing, left for the caller to remove).
 */
async function fakeSocket({ readOnly = true, mode = 0o600, dirMode = 0o700, at } = {}) {
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
        if (m.method === 'hello') send({ id: m.id, result: { protocol: 1, readOnly, methods: ['hello', 'list', 'subscribe', 'unsubscribe', 'backfill'] } })
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

/** A phone on the route (the same wire as chat.test.mjs). */
function phone(engine) {
  let out = Buffer.alloc(0)
  const conn = new ChatConnection({ engine, write: b => { out = Buffer.concat([out, b]) }, end: () => {} })
  conn.feed(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'hello', params: { generation: 1, framed: true } }) + '\n'))
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
    conn,
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

test('every write on a DSH chat is refused before the socket or the engine; terminal chats still write', async () => {
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

test('absent is empty: no socket, a socket others can reach, or one that is not read-only', async () => {
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
    for (const mode of [0o775, 0o757]) {
      chmodSync(team, mode)
      assert.equal(ownerOnly(sock.path), false, mode.toString(8))
      assert.deepEqual(await new DshSource({ path: sock.path }).list(), [], mode.toString(8))
    }
    chmodSync(team, 0o1777)
    assert.equal(ownerOnly(sock.path), true, 'sticky: nobody else can rename what is ours in it')
    chmodSync(team, 0o755)
    const uid = process.getuid()
    assert.equal(ownerOnly(sock.path, uid, { lstat: ownedBy(both(c.root, uid + 1)) }), false, 'another account')
    assert.equal(ownerOnly(sock.path, uid, { lstat: ownedBy(both(c.root, 0)) }), true, 'root')
    // A link on the way: ours is fine, another account's is not (it could point it elsewhere).
    const link = join(c.root, 'link')
    symlinkSync(team, link)
    const viaLink = join(link, 'pocket', 'chat.sock')
    assert.equal(ownerOnly(viaLink), true)
    assert.equal(ownerOnly(viaLink, uid, { lstat: ownedBy({ [link]: uid + 1 }) }), false)
    assert.deepEqual(sock.requests, [])
  } finally {
    await sock.close()
    c.done()
  }
})
