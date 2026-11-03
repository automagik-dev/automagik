import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { install } from '../src/host/permissions.js'
import { fakeContext } from './fake-ctx.js'

const PRESETS = { 'workspace-write': {}, 'danger-full-access': {} }

function runtime({ presets = true, fail = false } = {}) {
  const writes = []
  const service = {
    catalog: () => ({ options: Object.keys(PRESETS).map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: 'workspace-write' }),
    resolve: (name) => { if (!(name in PRESETS)) throw new Error(`permission: unknown preset "${name}"`); return PRESETS[name] },
    set: (session, name) => { if (fail) throw new Error('permission: rejected'); writes.push(`${session}=${name}`) },
  }
  const ctx = { get: name => (presets && name === 'permissionPresets' ? service : undefined), on() {} }
  const rt = {
    ctx,
    chatOf: id => `${id}-chat`,
    groupSessionsOf: id => [`${id}-group`],
    groupOwners: new Map(),
    roomOf: () => undefined,
    resolveAgent: async sessionId => ({ session: sessionId }),
    warn() {},
  }
  install(rt)
  return { rt, writes }
}

test('a Bot\'s preset is set on its chat and its group Sessions', async () => {
  const { rt, writes } = runtime()
  const bot = { id: 'b1', name: 'Ada' }
  await rt.setPermission(bot, 'danger-full-access')
  assert.equal(bot.permission, 'danger-full-access')
  assert.deepEqual(writes, ['b1-chat=danger-full-access', 'b1-group=danger-full-access'])
})

test('a fresh Session gets the Bot\'s preset, and a Bot without one keeps the default', async () => {
  const { rt, writes } = runtime()
  await rt.applyPermission({ id: 'b1' }, 'fresh')
  await rt.applyPermission({ id: 'b1', permission: 'workspace-write' }, 'fresh')
  assert.deepEqual(writes, ['fresh=workspace-write'])
})

test('an unknown preset is refused and the Bot keeps its own', async () => {
  const { rt, writes } = runtime()
  const bot = { id: 'b1', permission: 'workspace-write' }
  await assert.rejects(rt.setPermission(bot, 'everything'), /unknown preset/)
  assert.equal(bot.permission, 'workspace-write')
  assert.deepEqual(writes, [])
})

test('the catalog lists the presets DSH offers, or nothing without the presets service', () => {
  assert.deepEqual(runtime().rt.permissionCatalog(), { options: [{ value: 'workspace-write', name: 'workspace-write' }, { value: 'danger-full-access', name: 'danger-full-access' }], defaultPreset: 'workspace-write' })
  assert.equal(runtime({ presets: false }).rt.permissionCatalog(), undefined)
})

test('a preset the Bot\'s own chat refuses is not kept', async () => {
  const { rt } = runtime({ fail: true })
  const bot = { id: 'b1', permission: 'workspace-write' }
  await assert.rejects(rt.setPermission(bot, 'danger-full-access'), /rejected/)
  assert.equal(bot.permission, 'workspace-write')
})

// The whole team over a fake DSH presets service writing to one log. As in DSH, a Session's
// first open fires session/created inside the resolve ("announced" follows the listeners'
// synchronous part), and a preset that does not change appends nothing. A Session in
// `closed` holds Auto that DSH will not restore.
const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', name: 'Omni', role: '', instructions: '', createdAt: 1 },
    b2: { id: 'b2', name: 'Ada', role: '', instructions: '', createdAt: 2 },
  },
  rooms: { r1: { id: 'r1', name: 'Launch', named: true, members: ['m1', 'b2'], mode: 'everyone', notice: '', sessions: { b2: 'g2' }, seq: 0, log: [] } },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

function team(t, { auto = true, bots = {}, loaded = [], closed = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-permissions-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ ...TEAM, bots: { m1: TEAM.bots.m1, b2: { ...TEAM.bots.b2, ...bots.b2 } } }))
  const log = []
  const opened = []
  const open = new Set(loaded)
  const presetOf = new Map()
  const service = {
    auto,
    names: () => ['read-only', 'workspace-write', 'danger-full-access', ...(service.auto ? ['auto'] : [])],
    catalog: () => ({ options: service.names().map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: 'workspace-write' }),
    resolve: (name) => { if (!service.names().includes(name)) throw new Error(`permission: unknown preset "${name}"`); return {} },
    current: session => presetOf.get(session.id),
    set: (session, name) => {
      service.resolve(name)
      if (presetOf.get(session.id) !== name) log.push(`${session.id} preset ${name}`)
      presetOf.set(session.id, name)
    },
  }
  const ctx = fakeContext({ services: { permissionPresets: service } })
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
        opened.push(sessionId)
        if (closed.includes(sessionId)) return { error: { code: 'gateway/internal', message: `resume failed for session "${sessionId}": Error: permission: cannot restore preset "auto" without its active integration` } }
        const session = { id: sessionId }
        if (!open.has(sessionId)) {
          open.add(sessionId)
          for (const listener of ctx.listeners.get('session/created') ?? []) void listener(session)
          log.push(`${sessionId} announced`)
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
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const of = sessionId => log.filter(line => line.startsWith(`${sessionId} `))
  const presets = sessionId => of(sessionId).filter(line => line.includes(' preset ')).map(line => line.split(' preset ')[1])
  // Settles the session/created re-applies a step left queued.
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  return { ctx, rt: ctx.provided.get('omniTeam'), service, call, of, presets, opened, settle }
}

test('Auto is DSH\'s own Auto on every Session of the Bot or group; a lower level replaces it', async (t) => {
  const { rt, call, presets, settle } = team(t)
  assert.equal((await call('update-bot', { id: 'b2', permission: 'auto' })).ok, true)
  assert.equal((await call('update-room', { id: 'r1', permission: 'auto' })).ok, true)
  await rt.applyPermission(rt.botOf('b2'), 'fresh')
  // A new Bot takes the team default.
  assert.equal((await call('set-prefs', { permission: 'auto' })).ok, true)
  const created = await call('create-bot', { name: 'Nova' })
  assert.equal(created.value.permission, 'auto')
  await settle()
  for (const id of ['b2', 'g2', 'fresh', created.value.id]) assert.deepEqual(presets(id), ['auto'], id)
  await call('update-bot', { id: 'b2', permission: 'workspace-write' })
  await settle()
  assert.deepEqual(presets('b2'), ['auto', 'workspace-write'])

  // An idle Auto Bot: opening a Session sets its first preset within the announce, and
  // lowering the Bot opens its chat, whose session/created re-apply finds the new level.
  const idle = team(t, { bots: { b2: { permission: 'auto' } } })
  await idle.call('state', {})
  await idle.rt.resolveAgent('g2')
  assert.deepEqual(idle.of('g2').slice(0, 2), ['g2 preset auto', 'g2 announced'])
  assert.equal((await idle.call('update-bot', { id: 'b2', permission: 'workspace-write' })).ok, true)
  await idle.settle()
  assert.deepEqual(idle.presets('b2'), ['workspace-write'])

  // Applies to one Session run in turn: a lower level picked meanwhile lands last.
  const racing = team(t)
  await racing.call('state', {})
  await Promise.all([racing.call('update-bot', { id: 'b2', permission: 'auto' }), racing.call('update-bot', { id: 'b2', permission: 'workspace-write' })])
  await racing.settle()
  assert.equal(racing.service.current({ id: 'b2' }), 'workspace-write')
})

test('a saved Auto that cannot hold runs as workspace-write and says so', async (t) => {
  const runsAsFallback = async (setup, act) => {
    const { call, presets, rt, settle } = team(t, setup)
    await act({ call, rt })
    await settle()
    assert.deepEqual(presets('b2'), ['workspace-write'])
    const { value } = await call('state', {})
    const bot = value.bots.find(entry => entry.id === 'b2')
    assert.equal(bot.permission, 'auto')
    assert.equal(bot.permissionFallback, 'workspace-write')
  }
  // Without the layer DSH offers no Auto; a Bot saved on it before runs below it.
  await runsAsFallback({ auto: false, bots: { b2: { permission: 'auto' } } }, async ({ rt }) => {
    await rt.load()
    await rt.applyPermission(rt.botOf('b2'), 'b2')
  })
  // DSH refuses its own Auto when it comes to set it.
  const refusing = team(t)
  const set = refusing.service.set
  refusing.service.set = (session, name) => {
    if (name === 'auto') throw new Error('permission: Auto is not ready')
    set(session, name)
  }
  assert.equal((await refusing.call('update-bot', { id: 'b2', permission: 'auto' })).ok, true)
  await refusing.settle()
  assert.deepEqual(refusing.presets('b2'), ['workspace-write'])
  assert.equal((await refusing.call('state', {})).value.bots.find(entry => entry.id === 'b2').permissionFallback, 'workspace-write')
  // The layer unloads: every loaded Auto Session moves to workspace-write at once, and no
  // Session is opened. The windows learn of it through modelsKey, with no save.
  const { ctx, call, service, presets, opened, settle } = team(t, { bots: { b2: { permission: 'auto' } }, loaded: ['b2', 'g2'] })
  const before = (await call('state', {})).value
  service.auto = false
  for (const listener of ctx.listeners.get('permission-presets/catalog-changed')) void listener()
  await settle()
  assert.deepEqual(presets('b2'), ['workspace-write'])
  assert.deepEqual(presets('g2'), ['workspace-write'])
  assert.deepEqual(opened, [])
  const after = (await call('state', {})).value
  assert.equal(after.revision, before.revision)
  assert.notEqual(after.modelsKey, before.modelsKey)
  // Lowering a Bot whose chat DSH will not reopen keeps the new level for when it opens.
  const shut = team(t, { auto: false, bots: { b2: { permission: 'auto' } }, closed: ['b2'] })
  assert.equal((await shut.call('update-bot', { id: 'b2', permission: 'workspace-write' })).ok, true)
  assert.equal(shut.rt.botOf('b2').permission, 'workspace-write')
})
