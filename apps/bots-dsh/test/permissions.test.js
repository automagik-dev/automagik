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

// The whole team over a fake DSH presets service and fake dsh-oh-my-claude adapters, all
// writing to one log. A fake adapter clamps its override to the ceiling of the access
// mode, as the real one does; `config` stands for its permissionMode setting.
const RANK = { plan: 0, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 4 }
const CEILING = { 'read-only': 'default', 'workspace-write': 'acceptEdits', 'danger-full-access': 'bypassPermissions' }
function claudeAdapter(log, { config = 'dsh', restore = async () => {} } = {}) {
  const overrides = new Map()
  return {
    async restorePermissionMode(sessionId, mode) {
      await restore()
      overrides.set(sessionId, mode)
      log.push(`${sessionId} override ${mode}`)
    },
    async setPermissionMode(sessionId, mode) {
      if (mode === null) overrides.delete(sessionId)
      else overrides.set(sessionId, mode)
      log.push(`${sessionId} override ${mode}`)
    },
    permissionModeInfo: sessionId => ({ override: overrides.get(sessionId) ?? null }),
    getPermissionMode(sessionId, access) {
      const ceiling = config === 'dsh' ? CEILING[access] ?? 'acceptEdits' : config
      const override = overrides.get(sessionId)
      const mode = override !== undefined && RANK[override] <= RANK[ceiling] ? override : ceiling
      log.push(`${sessionId} reads ${mode}`)
      return mode
    },
  }
}

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

function team(t, { auto = true, adapters = () => [], bots = {}, loaded = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-permissions-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ ...TEAM, bots: { m1: TEAM.bots.m1, b2: { ...TEAM.bots.b2, ...bots.b2 } } }))
  const log = []
  const opened = []
  const service = {
    auto,
    names: () => ['read-only', 'workspace-write', 'danger-full-access', ...(service.auto ? ['auto'] : [])],
    catalog: () => ({ options: service.names().map(value => ({ value, name: value })), defaultOptions: [], defaultPreset: 'workspace-write' }),
    resolve: (name) => { if (!service.names().includes(name)) throw new Error(`permission: unknown preset "${name}"`); return {} },
    set: (session, name) => { service.resolve(name); log.push(`${session.id} preset ${name}`) },
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
      resolveAgent: async (sessionId) => { opened.push(sessionId); return { agent: { session: { id: sessionId }, followup() {} } } },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => loaded.map(id => ({ id })) },
  })
  globalThis[Symbol.for('dsh-oh-my-claude.adapter')] = new Map(adapters(log).map((adapter, index) => [`claude-code-${index}`, adapter]))
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  t.after(async () => {
    delete globalThis[Symbol.for('dsh-oh-my-claude.adapter')]
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const of = sessionId => log.filter(line => line.startsWith(`${sessionId} `))
  return { ctx, rt: ctx.provided.get('omniTeam'), service, call, of, opened }
}

test('Auto is set only after every Claude Code adapter reads back auto; a lower level clears it after', async (t) => {
  const { rt, call, of } = team(t, { adapters: log => [claudeAdapter(log), claudeAdapter(log)] })
  const AUTO_ORDER = id => [`${id} override auto`, `${id} override auto`, `${id} reads auto`, `${id} reads auto`, `${id} preset auto`]
  assert.equal((await call('update-bot', { id: 'b2', permission: 'auto' })).ok, true)
  assert.deepEqual(of('b2'), AUTO_ORDER('b2'))
  assert.deepEqual(of('g2'), AUTO_ORDER('g2'))
  assert.equal((await call('update-room', { id: 'r1', permission: 'auto' })).ok, true)
  assert.deepEqual(of('g2'), [...AUTO_ORDER('g2'), ...AUTO_ORDER('g2')])
  await rt.applyPermission(rt.botOf('b2'), 'fresh')
  assert.deepEqual(of('fresh'), AUTO_ORDER('fresh'))
  // A new Bot takes the team default.
  assert.equal((await call('set-prefs', { permission: 'auto' })).ok, true)
  const created = await call('create-bot', { name: 'Nova' })
  assert.equal(created.value.permission, 'auto')
  assert.deepEqual(of(created.value.id), AUTO_ORDER(created.value.id))
  // Below Auto the preset goes first, then the auto override is cleared.
  await call('update-bot', { id: 'b2', permission: 'workspace-write' })
  assert.deepEqual(of('b2').slice(5), ['b2 preset workspace-write', 'b2 override null', 'b2 override null'])
})

test('a saved Auto that cannot hold runs as workspace-write and says so', async (t) => {
  const runsAsFallback = async (setup, act) => {
    const { call, of, rt } = team(t, setup)
    await act({ call, rt })
    const presets = of('b2').filter(line => line.includes(' preset '))
    assert.deepEqual(presets, ['b2 preset workspace-write'])
    const { value } = await call('state', {})
    const bot = value.bots.find(entry => entry.id === 'b2')
    assert.equal(bot.permission, 'auto')
    assert.equal(bot.permissionFallback, 'workspace-write')
  }
  const pickAuto = ({ call }) => call('update-bot', { id: 'b2', permission: 'auto' })
  // Without the layer DSH offers no Auto; a Bot saved on it before runs below it.
  await runsAsFallback({ auto: false, bots: { b2: { permission: 'auto' } } }, async ({ rt }) => {
    await rt.load()
    await rt.applyPermission(rt.botOf('b2'), 'b2')
  })
  // dsh-oh-my-claude set to its own mode, not 'dsh'.
  await runsAsFallback({ adapters: log => [claudeAdapter(log, { config: 'acceptEdits' })] }, pickAuto)
  // An adapter without the methods, and one whose write fails.
  await runsAsFallback({ adapters: log => [claudeAdapter(log), {}] }, pickAuto)
  await runsAsFallback({ adapters: log => [claudeAdapter(log, { restore: async () => { throw new Error('disk full') } })] }, pickAuto)
  // The layer unloads: the loaded Auto Session moves to workspace-write; an idle one stays closed.
  const { ctx, service, of, opened } = team(t, { bots: { b2: { permission: 'auto' } }, loaded: ['b2'] })
  service.auto = false
  await Promise.all(ctx.listeners.get('permission-presets/catalog-changed').map(listener => listener()))
  assert.deepEqual(of('b2'), ['b2 preset workspace-write'])
  assert.deepEqual(of('g2'), [])
  assert.deepEqual(opened, [])
})
