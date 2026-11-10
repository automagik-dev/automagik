// A change of level that does not reach every Session is reported to the person who made
// it, not only logged: the level stays saved as chosen (never taken back to the wider
// one), and the answer says some conversations kept the level they had. The failure is
// injected in the fake presets service's `set`, as DSH would throw it.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const FULL = 'danger-full-access'
const WRITE = 'workspace-write'
const STOCK = {
  [WRITE]: { sandbox: 'workspace-write', approval: 'ask' },
  [FULL]: { sandbox: 'danger-full-access', approval: 'never' },
}
const AUTO_SPEC = { sandbox: 'danger-full-access', approval: 'ask' }
const NOT_EVERYWHERE = 'The permission level was saved, but some conversations could not take it and keep the level they had until DeepSeek Harness opens them again.'

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', name: 'Omni', role: '', instructions: '', createdAt: 1 },
    b2: { id: 'b2', name: 'Ada', role: '', instructions: '', createdAt: 2 },
  },
  rooms: {
    r1: { id: 'r1', name: 'Launch', named: true, members: ['m1', 'b2'], mode: 'everyone', notice: '', sessions: { m1: 'g1', b2: 'g2' }, seq: 0, log: [] },
    r2: { id: 'r2', name: 'Review', named: true, members: ['m1', 'b2'], mode: 'everyone', notice: '', sessions: { b2: 'h2' }, seq: 0, log: [] },
  },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

// The whole team over a fake DSH presets service, as in permissions.test.js. `failing`
// makes the set on those Sessions throw; `closed` are Sessions DSH will not reopen while
// Auto review is off.
function team(t, { auto = true, bots = {}, rooms = {}, tasks, loaded = [], closed = [], custom = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-change-failure-'))
  const saved = { ...TEAM, bots: { m1: { ...TEAM.bots.m1, ...bots.m1 }, b2: { ...TEAM.bots.b2, ...bots.b2 } }, rooms: { r1: { ...TEAM.rooms.r1, ...rooms.r1 }, r2: { ...TEAM.rooms.r2, ...rooms.r2 } }, ...(tasks ? { tasks } : {}) }
  writeFileSync(join(home, 'state.json'), JSON.stringify(saved))
  const presetOf = new Map()
  const failing = new Set()
  const service = {
    auto,
    names: () => [...Object.keys(STOCK), ...Object.keys(custom), ...(service.auto ? ['auto'] : [])],
    catalog: () => ({ options: service.names().map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: WRITE }),
    resolve: (name) => {
      if (!service.names().includes(name)) throw new Error(`permission: unknown preset "${name}"`)
      return name === 'auto' ? AUTO_SPEC : STOCK[name] ?? custom[name]
    },
    current: session => presetOf.get(session.id),
    set: (session, name) => {
      service.resolve(name)
      if (failing.has(session.id)) throw new Error('permission: the Session log refused the write')
      presetOf.set(session.id, name)
    },
  }
  const ctx = fakeContext({ services: { permissionPresets: service } })
  const open = new Set(loaded)
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
        if (closed.includes(sessionId)) return { error: { code: 'gateway/internal', message: `resume failed for session "${sessionId}": Error: permission: cannot restore preset "auto" without its active integration` } }
        const session = { id: sessionId }
        if (!open.has(sessionId)) {
          open.add(sessionId)
          for (const listener of ctx.listeners.get('session/created') ?? []) void Promise.resolve(listener(session)).catch(() => {})
        }
        await new Promise(resolve => setTimeout(resolve, 1))
        return { agent: { session, followup() {} } }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => loaded.map(id => ({ id })) },
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
  const warnings = []
  t.mock.method(rt, 'warn', (...args) => { warnings.push(args.map(String).join(' ')) })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  const onDisk = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  // Every Session starts at the level it would have had before the change.
  const start = (levels) => { for (const [id, name] of Object.entries(levels)) presetOf.set(id, name) }
  return { ctx, rt, service, call, settle, onDisk, failing, start, warnings, levelOf: id => presetOf.get(id) }
}

test('lowering a Bot whose group Session does not take the level is reported, and the level stays', async (t) => {
  const { ctx, rt, call, settle, onDisk, failing, start, warnings, levelOf } = team(t, { bots: { b2: { permission: FULL } } })
  await call('state', {})
  start({ b2: FULL, g2: FULL, h2: FULL })
  failing.add('g2')
  const answer = await call('update-bot', { id: 'b2', permission: WRITE, role: 'Writer' })
  await settle()
  assert.equal(answer.ok, false)
  assert.deepEqual([answer.error.code, answer.error.message], ['bot/refused', NOT_EVERYWHERE])
  // Saved as chosen, with the rest of the same change; never back to the wider level.
  assert.equal(rt.botOf('b2').permission, WRITE)
  assert.deepEqual([onDisk().bots.b2.permission, onDisk().bots.b2.role], [WRITE, 'Writer'])
  // The Sessions that could take it did; the one that could not is named in the log.
  assert.deepEqual([levelOf('b2'), levelOf('h2'), levelOf('g2')], [WRITE, WRITE, FULL])
  assert.ok(warnings.some(line => line.includes('was not applied on') && line.endsWith('Ada g2')), warnings.join(' | '))

  // The Session takes the saved level when DSH opens it next.
  failing.clear()
  for (const listener of ctx.listeners.get('session/created') ?? []) void listener({ id: 'g2' })
  await settle()
  assert.equal(levelOf('g2'), WRITE)
})

test('lowering a Bot whose task does not take the level is reported', async (t) => {
  const tasks = { t1: { title: 'Wish', from: 'b2', at: 1, status: 'working' }, t2: { title: 'Chore', from: 'b2', at: 2, status: 'working' } }
  const { rt, call, settle, failing, start, levelOf } = team(t, { bots: { b2: { permission: FULL } }, tasks })
  await call('state', {})
  start({ b2: FULL, g2: FULL, h2: FULL, t1: FULL, t2: FULL })
  failing.add('t1')
  const answer = await call('update-bot', { id: 'b2', permission: WRITE })
  await settle()
  assert.equal(answer.ok, false)
  assert.equal(answer.error.message, NOT_EVERYWHERE)
  assert.equal(rt.botOf('b2').permission, WRITE)
  assert.deepEqual([levelOf('t1'), levelOf('t2'), levelOf('g2')], [FULL, WRITE, WRITE])
})

test('lowering a group whose member Session or task does not take the level is reported', async (t) => {
  const tasks = { t1: { title: 'Wish', from: 'm1', at: 1, status: 'working', roomId: 'r1' } }
  const { rt, call, settle, onDisk, failing, start, warnings, levelOf } = team(t, { rooms: { r1: { permission: FULL } }, tasks })
  await call('state', {})
  start({ g1: FULL, g2: FULL, t1: FULL })
  failing.add('g2')
  const answer = await call('update-room', { id: 'r1', permission: WRITE, notice: 'Be brief' })
  await settle()
  assert.equal(answer.ok, false)
  assert.deepEqual([answer.error.code, answer.error.message], ['bot/refused', NOT_EVERYWHERE])
  assert.equal(rt.roomOf('r1').permission, WRITE)
  assert.deepEqual([onDisk().rooms.r1.permission, onDisk().rooms.r1.notice], [WRITE, 'Be brief'])
  assert.deepEqual([levelOf('g1'), levelOf('t1'), levelOf('g2')], [WRITE, WRITE, FULL])
  assert.ok(warnings.some(line => line.includes('was not applied on') && line.endsWith('Launch g2')), warnings.join(' | '))

  // The same level picked again changes nothing, as before.
  failing.clear()
  const idle = await call('update-room', { id: 'r1', permission: WRITE })
  assert.equal(idle.ok, true)
  assert.deepEqual(idle.value.changes, [])

  // A task that does not take the group's level is reported the same way.
  failing.add('t1')
  const lowered = await call('update-room', { id: 'r1', permission: null })
  await settle()
  assert.equal(lowered.ok, false)
  assert.equal(lowered.error.message, NOT_EVERYWHERE)
  assert.equal(rt.roomOf('r1').permission, undefined)
})

test('a change that reaches every Session answers as before', async (t) => {
  const tasks = { t1: { title: 'Wish', from: 'b2', at: 1, status: 'working' } }
  const { call, settle, start, levelOf } = team(t, { bots: { b2: { permission: FULL } }, rooms: { r1: { permission: FULL } }, tasks })
  await call('state', {})
  start({ b2: FULL, g1: FULL, g2: FULL, h2: FULL, t1: FULL })
  const bot = await call('update-bot', { id: 'b2', permission: WRITE })
  assert.equal(bot.ok, true)
  assert.equal(bot.value.permission, WRITE)
  const room = await call('update-room', { id: 'r1', permission: WRITE })
  assert.equal(room.ok, true)
  assert.deepEqual(room.value.changes, [`every member now works with the ${WRITE} permissions here`])
  await settle()
  for (const id of ['b2', 'g1', 'g2', 'h2', 't1']) assert.equal(levelOf(id), WRITE, id)
})

test('a raise the Bot\'s own chat refuses is still not kept; a lowering it refuses stays saved', async (t) => {
  const { rt, call, settle, onDisk, failing, start, levelOf } = team(t, { bots: { b2: { permission: WRITE } } })
  await call('state', {})
  start({ b2: WRITE, g2: WRITE, h2: WRITE })
  failing.add('b2')
  const raised = await call('update-bot', { id: 'b2', permission: FULL })
  assert.equal(raised.ok, false)
  assert.notEqual(raised.error.message, NOT_EVERYWHERE)
  assert.equal(rt.botOf('b2').permission, WRITE)
  assert.deepEqual([levelOf('g2'), levelOf('h2')], [WRITE, WRITE], 'no other Session was raised')

  // Lowering: taking it back would save the wider level again.
  failing.clear()
  assert.equal((await call('update-bot', { id: 'b2', permission: FULL })).ok, true)
  failing.add('b2')
  const lowered = await call('update-bot', { id: 'b2', permission: WRITE })
  await settle()
  assert.equal(lowered.ok, false)
  assert.equal(lowered.error.message, NOT_EVERYWHERE)
  assert.equal(rt.botOf('b2').permission, WRITE)
  assert.equal(onDisk().bots.b2.permission, WRITE)
  assert.deepEqual([levelOf('b2'), levelOf('g2'), levelOf('h2')], [FULL, WRITE, WRITE])
})

test('a raise that some Sessions do not take leaves them at the narrower level and says so', async (t) => {
  const { rt, call, settle, failing, start, levelOf } = team(t, { rooms: { r1: { permission: WRITE } } })
  await call('state', {})
  start({ g1: WRITE, g2: WRITE })
  failing.add('g2')
  const answer = await call('update-room', { id: 'r1', permission: FULL })
  await settle()
  assert.equal(answer.ok, false)
  assert.equal(answer.error.message, NOT_EVERYWHERE)
  assert.equal(rt.roomOf('r1').permission, FULL)
  assert.deepEqual([levelOf('g1'), levelOf('g2')], [FULL, WRITE])
})

test('a Session DSH will not open while Auto review is off is not a failed change', async (t) => {
  // It keeps the saved level and takes it when it opens again.
  const { rt, call, settle, levelOf } = team(t, { auto: false, bots: { b2: { permission: 'auto' } }, closed: ['g2'] })
  await call('state', {})
  const answer = await call('update-bot', { id: 'b2', permission: WRITE })
  await settle()
  assert.equal(answer.ok, true, JSON.stringify(answer.error))
  assert.equal(rt.botOf('b2').permission, WRITE)
  assert.equal(levelOf('h2'), WRITE)
})

test('a lowering from a saved Auto that DSH does not offer stays saved too', async (t) => {
  // With Auto review off the Bot ran as workspace-write: read-only is a lowering.
  const custom = { 'read-only': { sandbox: 'read-only', approval: 'ask' } }
  const { rt, call, failing, start } = team(t, { auto: false, bots: { b2: { permission: 'auto' } }, custom })
  await call('state', {})
  start({ b2: WRITE, g2: WRITE, h2: WRITE })
  failing.add('b2')
  const answer = await call('update-bot', { id: 'b2', permission: 'read-only' })
  assert.equal(answer.ok, false)
  assert.equal(answer.error.message, NOT_EVERYWHERE)
  assert.equal(rt.botOf('b2').permission, 'read-only')
  // A Bot without a level of its own ran at the catalog default: the same.
  const plain = team(t, { custom })
  await plain.call('state', {})
  plain.start({ b2: WRITE })
  plain.failing.add('b2')
  const lowered = await plain.call('update-bot', { id: 'b2', permission: 'read-only' })
  assert.equal(lowered.error?.message, NOT_EVERYWHERE)
  assert.equal(plain.rt.botOf('b2').permission, 'read-only')
})

test('a group\'s other changes in the same update are kept when its level did not reach every Session', async (t) => {
  const { rt, call, onDisk, failing, start } = team(t, { rooms: { r1: { permission: FULL } } })
  await call('state', {})
  start({ g1: FULL, g2: FULL })
  failing.add('g1')
  const answer = await call('update-room', { id: 'r1', permission: WRITE, name: 'Shipping' })
  assert.equal(answer.ok, false)
  assert.equal(answer.error.message, NOT_EVERYWHERE)
  assert.deepEqual([rt.roomOf('r1').name, onDisk().rooms.r1.name, onDisk().rooms.r1.permission], ['Shipping', 'Shipping', WRITE])
})

test('a level the chat refuses is not a lowering for an Auto that fell back, or when the service is gone', async (t) => {
  // The Bot's saved Auto fell back to workspace-write: `trusting` allows more than that,
  // so a chat that refuses it takes it back, and no other Session is raised to it.
  const custom = { trusting: { sandbox: 'workspace-write', approval: 'never' } }
  const { ctx, rt, call, service, failing, start, levelOf } = team(t, { bots: { b2: { permission: WRITE } }, custom })
  await call('state', {})
  start({ b2: WRITE, g2: WRITE, h2: WRITE })
  const set = service.set
  service.set = (session, name) => {
    if (name === 'auto') throw new Error('permission: Auto is not ready')
    set(session, name)
  }
  assert.equal((await call('update-bot', { id: 'b2', permission: 'auto' })).ok, true)
  assert.equal(levelOf('b2'), WRITE, 'the saved Auto runs as workspace-write')
  failing.add('b2')
  const answer = await call('update-bot', { id: 'b2', permission: 'trusting' })
  assert.equal(answer.ok, false)
  assert.notEqual(answer.error.message, NOT_EVERYWHERE)
  assert.equal(rt.botOf('b2').permission, 'auto')
  assert.deepEqual([levelOf('g2'), levelOf('h2')], [WRITE, WRITE])

  // The presets service leaves while the chat refuses: nothing can be ranked, so the
  // level is taken back as it always was.
  const get = ctx.get
  service.set = () => {
    ctx.get = name => (name === 'permissionPresets' ? undefined : get(name))
    throw new Error('permission: the Session log refused the write')
  }
  const gone = await call('update-bot', { id: 'b2', permission: FULL })
  ctx.get = get
  assert.equal(gone.ok, false)
  assert.equal(rt.botOf('b2').permission, 'auto')
})
