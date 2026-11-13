// Follow-ups to the permission section of the diagnostics page (#1020), host side: a window
// that only views the team says its answer is as of its last refresh; the answer keeps its
// hard cap and counts the marked Sessions it leaves out; "not loaded" is the store's own fact,
// not a count of Bots. Reading stays reading: no refresh, load, lock, save, set or Session.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { MAX_ROWS } from '../src/host/permission-diagnostics.js'

const FULL = 'danger-full-access'
const WRITE = 'workspace-write'
const STOCK = {
  [WRITE]: { sandbox: 'workspace-write', approval: 'ask' },
  [FULL]: { sandbox: 'danger-full-access', approval: 'never' },
}
const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', name: 'Omni', role: '', instructions: '', createdAt: 1 },
    b2: { id: 'b2', name: 'Ada', role: '', instructions: '', createdAt: 2, permission: FULL },
  },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

// A bounded wait for `check` to hold: no step here leans on a fixed sleep.
async function until(check, what = 'the condition') {
  const end = Date.now() + 15_000
  for (;;) {
    if (check()) return
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

// `file`: the saved team as an object, the file's raw text, or null for no file at all.
// `writer`: another DSH holds the team's lock, as a live process on this machine does.
function team(t, { file = TEAM, writer = false, folder = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-permission-followups-'))
  const statePath = join(home, 'state.json')
  const lockPath = join(home, 'state.lock')
  // The saved team as another DSH writes it: a new size or time, which a reading host sees.
  let writes = 0
  const write = (content) => {
    writes += 1
    writeFileSync(statePath, typeof content === 'string' ? content : `${JSON.stringify(content)}${' '.repeat(writes)}`)
  }
  if (file !== null) writeFileSync(statePath, typeof file === 'string' ? file : JSON.stringify(file))
  // A folder where the file should be: reading it fails, and not as a file that is not there.
  if (folder) mkdirSync(statePath)
  if (writer) writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, host: hostname(), token: 'the-other-dsh' }))
  const presetOf = new Map()
  const failing = new Set()
  const sets = []
  const service = {
    catalog: () => ({ options: Object.keys(STOCK).map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: WRITE }),
    resolve: (name) => {
      if (!Object.hasOwn(STOCK, name)) throw new Error(`permission: unknown preset "${name}"`)
      return STOCK[name]
    },
    current: session => presetOf.get(session.id),
    set: (session, name) => {
      service.resolve(name)
      sets.push(`${session.id}=${name}`)
      if (failing.has(session.id)) throw new Error('permission: the Session log refused the write')
      presetOf.set(session.id, name)
    },
  }
  const ctx = fakeContext({ services: { permissionPresets: service } })
  const open = new Set()
  let sessions = 0
  Object.assign(ctx, {
    workspaceRegistry: {
      get: () => ({ id: 'w1', path: home }),
      resolveByPath: async path => ({ id: 'w1', path }),
      create: async path => ({ id: 'w1', path }),
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      async resolveAgent(sessionId) {
        const session = { id: sessionId }
        open.add(sessionId)
        await new Promise(resolve => setTimeout(resolve, 1))
        return { agent: { session, followup() {} } }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => [...open].map(id => ({ id })), get: () => undefined },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const rt = ctx.provided.get('omniTeam')
  t.mock.method(rt, 'warn', () => {})
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  // DSH opens these Sessions, which it then lists: each takes its level within the announce.
  // Waits for every one whose set fails to be marked, and every other set to be made.
  const opens = async (...ids) => {
    const before = sets.length
    const wanted = ids.filter(id => failing.has(id)).length
    const marks = () => rt.unappliedSessions().filter(id => ids.includes(id)).length
    for (const sessionId of ids) {
      open.add(sessionId)
      for (const listener of ctx.listeners.get('session/created') ?? []) void Promise.resolve(listener({ id: sessionId })).catch(() => {})
    }
    await until(() => marks() === wanted, `${wanted} Sessions to be marked`)
    return before
  }
  // Everything a read must leave alone.
  const watch = () => {
    const spies = [t.mock.method(rt, 'refresh'), t.mock.method(rt, 'load'), t.mock.method(rt, 'save'), t.mock.method(rt, 'resolveAgent'), t.mock.method(ctx.sessionController, 'resolveAgent'), t.mock.method(ctx.sessionController, 'create')]
    const before = { sets: sets.length, state: JSON.stringify(rt.state) }
    return () => {
      for (const spy of spies) assert.equal(spy.mock.callCount(), 0)
      assert.equal(sets.length, before.sets)
      assert.equal(JSON.stringify(rt.state), before.state)
    }
  }
  return { ctx, rt, home, statePath, lockPath, write, call, failing, opens, watch, sets }
}
const read = async (call) => {
  const answer = await call('diagnostics-permissions', {})
  assert.equal(answer.ok, true)
  return answer.value
}
const tasks = (count, from = 'b2') => Object.fromEntries(Array.from({ length: count }, (_, i) => [`t${i}`, { title: 'Task', from, at: i + 1, status: 'done' }]))
const ids = count => Array.from({ length: count }, (_, i) => `t${i}`)

test('a window that only views the team says so, as a flag, and reads nothing more for it', async (t) => {
  const { rt, call, opens, watch } = team(t)
  await call('state', {})
  await opens('b2')
  // A window that may write: no flag.
  const writer = await read(call)
  assert.equal(Object.hasOwn(writer, 'viewOnly'), false)
  t.mock.method(rt, 'readOnly', () => 'The Bot team in /home/alice/.dsh is open in another dsh (Web or Desktop, pid 4242 on alices-laptop).')
  const untouched = watch()
  const answer = await call('diagnostics-permissions', {})
  untouched()
  assert.equal(answer.value.viewOnly, true)
  assert.deepEqual(answer.value.sessions.map(row => [row.kind, row.botId, row.saved.value]), [['chat', 'b2', FULL]])
  // Only the fact leaves: not the sentence, its folder, pid or host.
  assert.doesNotMatch(JSON.stringify(answer), /alice|4242|another dsh/)
})

test('the answer never passes its cap, and counts the marked Sessions it leaves out', async (t) => {
  const marked = MAX_ROWS + 5
  const { rt, call, opens, failing, watch } = team(t, { file: { ...TEAM, tasks: { ...tasks(marked), ...Object.fromEntries(Object.entries(tasks(8, 'm1')).map(([id, task]) => [`o${id}`, task])) } } })
  await rt.load()
  for (const id of ids(marked)) failing.add(id)
  await opens(...ids(marked), ...ids(8).map(id => `o${id}`))
  assert.equal(rt.unappliedSessions().length, marked)
  const untouched = watch()
  const report = await read(call)
  untouched()
  assert.equal(report.sessions.length, MAX_ROWS)
  assert.ok(report.sessions.every(row => row.unapplied !== undefined), 'no other row takes the place of a marked one')
  assert.equal(report.more, true)
  assert.equal(report.moreMarked, 5)
})

test('marked Sessions under the cap come first, and the others fill what is left', async (t) => {
  const { rt, call, opens, failing } = team(t, { file: { ...TEAM, tasks: tasks(60) } })
  await rt.load()
  for (const id of ids(3)) failing.add(id)
  await opens(...ids(60))
  const report = await read(call)
  assert.equal(report.sessions.length, MAX_ROWS)
  assert.deepEqual(report.sessions.map(row => row.unapplied !== undefined).indexOf(false), 3)
  assert.equal(report.sessions.filter(row => row.unapplied !== undefined).length, 3)
  assert.equal(report.more, true)
  assert.equal(Object.hasOwn(report, 'moreMarked'), false)

  // Under the cap nothing is left out, and nothing says so.
  const few = team(t, { file: { ...TEAM, tasks: tasks(4) } })
  await few.rt.load()
  few.failing.add('t0')
  await few.opens(...ids(4))
  const small = await read(few.call)
  assert.equal(small.sessions.length, 4)
  assert.equal(Object.hasOwn(small, 'more'), false)
  assert.equal(Object.hasOwn(small, 'moreMarked'), false)
})

test('a loaded team with no Bot answers, and one never loaded does not', async (t) => {
  const empty = team(t, { file: { ...TEAM, mainBotIds: [], bots: {} } })
  // The saved empty team is available before startup yields.
  assert.deepEqual(empty.rt.permissionDiagnostics(), { version: 2, sessions: [] })
  assert.equal(empty.rt.teamLoaded(), true)
  assert.deepEqual(await read(empty.call), { version: 2, sessions: [] })

  // No file yet: a new team, loaded and empty.
  const fresh = team(t, { file: null })
  await fresh.rt.load()
  assert.equal(fresh.rt.teamLoaded(), true)
  assert.deepEqual(await read(fresh.call), { version: 2, sessions: [] })

  // A read does not load the team to find out.
  const cold = team(t)
  t.mock.method(cold.rt, 'teamLoaded', () => false)
  const load = t.mock.method(cold.rt, 'load')
  assert.deepEqual(cold.rt.permissionDiagnostics(), { version: 2, unavailable: true })
  assert.equal(load.mock.callCount(), 0)
})

test('a saved team that cannot be read is not a loaded one, until a team is saved again', async (t) => {
  // Corrupt: set aside, and the empty team in memory is not the saved one.
  const corrupt = team(t, { file: '{"version":1,"bots":' })
  await corrupt.rt.load()
  assert.equal(corrupt.rt.teamLoaded(), false)
  assert.deepEqual(await read(corrupt.call), { version: 2, unavailable: true })
  // The first state read makes a new team and saves it: loaded from then on.
  await corrupt.call('state', {})
  assert.equal(corrupt.rt.teamLoaded(), true)
  assert.equal((await read(corrupt.call)).unavailable, undefined)

  // Saved by a version this one cannot read: left untouched, and not loaded.
  const newer = team(t, { file: { ...TEAM, version: 9999 } })
  await newer.rt.load()
  assert.equal(newer.rt.teamLoaded(), false)
  assert.deepEqual(await read(newer.call), { version: 2, unavailable: true })

})

test('an accessor that throws gives a safe answer: no error text, no failure noted, nothing done', async (t) => {
  const { rt, call, opens, watch } = team(t)
  await call('state', {})
  await opens('b2')
  const noted = t.mock.method(rt, 'noteFailure')
  // Whether the window only views cannot be told: the rest is answered, and said partial.
  const readOnly = t.mock.method(rt, 'readOnly', () => { throw new Error('boom at /home/alice/.dsh/state.lock') })
  let untouched = watch()
  const partial = await call('diagnostics-permissions', {})
  untouched()
  assert.equal(partial.ok, true)
  assert.equal(partial.value.partial, true)
  assert.equal(Object.hasOwn(partial.value, 'viewOnly'), false)
  assert.equal(partial.value.sessions.length, 1)
  assert.doesNotMatch(JSON.stringify(partial), /boom|alice/)
  readOnly.mock.restore()
  // Whether the team is loaded cannot be told: nothing is answered from it.
  t.mock.method(rt, 'teamLoaded', () => { throw new Error('boom at /home/alice/.dsh/state.json') })
  untouched = watch()
  const none = await call('diagnostics-permissions', {})
  untouched()
  assert.deepEqual(none, { ok: true, value: { version: 2, unavailable: true } })
  assert.equal(noted.mock.callCount(), 0)
})

test('a second host, with the team held by another DSH, answers as view-only and loaded, then takes over', async (t) => {
  const { rt, call, opens, write, lockPath, watch } = team(t, { writer: true })
  // Its own state read loads the team without the lock.
  await call('state', {})
  assert.notEqual(rt.readOnly(), undefined)
  assert.equal(rt.teamLoaded(), true)
  await opens('b2')
  let untouched = watch()
  const viewing = await read(call)
  untouched()
  assert.equal(viewing.viewOnly, true)
  assert.deepEqual(viewing.sessions.map(row => [row.kind, row.botId, row.saved.value]), [['chat', 'b2', FULL]])
  // The other DSH lowers the level: this window still tells what it last read, as it says.
  write({ ...TEAM, revision: 2, bots: { ...TEAM.bots, b2: { ...TEAM.bots.b2, permission: WRITE } } })
  untouched = watch()
  const stale = await read(call)
  untouched()
  assert.deepEqual([stale.viewOnly, stale.sessions[0].saved.value], [true, FULL])
  // Its next refresh reads the file, and the answer follows.
  await rt.refresh()
  const fresh = await read(call)
  assert.deepEqual([fresh.viewOnly, fresh.sessions[0].saved.value], [true, WRITE])
  // The other DSH closes: this one takes the team over and says no more that it only views.
  rmSync(lockPath)
  await rt.refresh()
  assert.equal(rt.readOnly(), undefined)
  assert.equal(rt.teamLoaded(), true)
  const writing = await read(call)
  assert.equal(Object.hasOwn(writing, 'viewOnly'), false)
  assert.equal(writing.sessions[0].saved.value, WRITE)
})

test('a reread that fails makes the team not loaded, and a repaired file loads it again', async (t) => {
  const { rt, call, write } = team(t, { writer: true })
  await call('state', {})
  assert.equal(rt.teamLoaded(), true)
  // The file turns corrupt under a host that only reads it.
  write('{"version":1,"bots":')
  await rt.refresh()
  assert.equal(rt.teamLoaded(), false)
  assert.deepEqual(await read(call), { version: 2, unavailable: true })
  // Saved by a version this one cannot read.
  write({ ...TEAM, version: 9999 })
  await rt.refresh()
  assert.equal(rt.teamLoaded(), false)
  assert.deepEqual(await read(call), { version: 2, unavailable: true })
  // Repaired: the next refresh reads it, and the answer is back.
  write({ ...TEAM, revision: 3 })
  await rt.refresh()
  assert.equal(rt.teamLoaded(), true)
  const back = await read(call)
  assert.equal(back.unavailable, undefined)
  assert.equal(back.viewOnly, true)
})

test('a file that cannot be read at all is not a loaded team', async (t) => {
  const { rt, call } = team(t, { file: null, folder: true })
  await rt.load()
  assert.notEqual(rt.readOnly(), undefined)
  assert.equal(rt.teamLoaded(), false)
  assert.deepEqual(await read(call), { version: 2, unavailable: true })
})

test('a save that fails does not make the team loaded; the one that succeeds does', async (t) => {
  const { rt, call, statePath } = team(t, { file: '{"version":1,"bots":' })
  await rt.load()
  assert.equal(rt.teamLoaded(), false)
  // The file the save writes first cannot be written: a folder is in its place.
  const temp = `${statePath}.${process.pid}.tmp`
  mkdirSync(temp)
  await assert.rejects(rt.save())
  assert.equal(rt.teamLoaded(), false)
  assert.deepEqual(await read(call), { version: 2, unavailable: true })
  rmSync(temp, { recursive: true })
  await rt.save()
  assert.equal(rt.teamLoaded(), true)
  assert.deepEqual(await read(call), { version: 2, sessions: [] })
})

test('marked tasks come before unmarked chats when the answer overflows', async (t) => {
  // More open chats, none marked, than the answer holds; a chat sorts ahead of a task.
  const chats = Object.fromEntries(Array.from({ length: MAX_ROWS + 5 }, (_, i) => [`c${i}`, { id: `c${i}`, name: `Bot ${i}`, role: '', instructions: '', createdAt: 10 + i }]))
  const { rt, call, opens, failing } = team(t, { file: { ...TEAM, bots: { ...TEAM.bots, ...chats }, tasks: tasks(5) } })
  await rt.load()
  for (const id of ids(5)) failing.add(id)
  // The chats are opened first, so nothing but the order puts the marked ones ahead.
  await opens(...Object.keys(chats))
  await opens(...ids(5))
  const report = await read(call)
  assert.equal(report.sessions.length, MAX_ROWS)
  assert.deepEqual(report.sessions.slice(0, 5).map(row => [row.kind, row.unapplied !== undefined]), Array.from({ length: 5 }, () => ['task', true]))
  assert.ok(report.sessions.slice(5).every(row => row.kind === 'chat' && row.unapplied === undefined))
  assert.equal(report.more, true)
  assert.equal(Object.hasOwn(report, 'moreMarked'), false)
})
