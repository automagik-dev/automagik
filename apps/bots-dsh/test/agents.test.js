import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { TEAM_TOOLS } from '../src/host/constants.js'
import { fakeContext } from './fake-ctx.js'

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve() }

// Enough of the dsh services for the roster and the agents module; tool restrict
// calls and archived Sessions are recorded for the assertions.
function start(team, { config = {}, home = mkdtempSync(join(tmpdir(), 'ds-bot-agents-')) } = {}) {
  if (team !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext()
  const workspaces = new Map()
  const created = []
  const archived = []
  const failArchive = { on: false }
  const restricted = []
  const renamed = []
  let sessions = 0
  ctx.tools.schemas = () => [...TEAM_TOOLS, 'read', 'write'].map(name => ({ name }))
  Object.assign(ctx, {
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async (sessionId) => {
        if (failArchive.on) throw new Error('session is running')
        archived.push(sessionId)
      },
    },
    sessionController: {
      create: async (options) => {
        created.push(options)
        return { sessionId: options.sessionId ?? `s${++sessions}` }
      },
      resolveAgent: async (sessionId) => {
        const agent = {
          session: { id: sessionId },
          ctx: {
            tools: { restrict: (filter) => { restricted.push({ sessionId, filter }); return () => {} } },
            effect: execute => execute(),
          },
          followup() {},
        }
        return { agent }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async (session, title) => { renamed.push({ id: session.id, title }) } },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home, ...config })
  const call = async (endpoint, payload) => {
    const response = await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))
    return response.json()
  }
  const createdAgents = payload => (ctx.listeners.get('agent/created') ?? []).map(listener => listener(payload))
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { call, stop, home, created, archived, failArchive, restricted, renamed, createdAgents, ctx }
}

test('adoption is additive, retains registration, and rollback restores the original', async (t) => {
  const { call, stop, ctx, created, archived, createdAgents, restricted } = start(TEAM)
  t.after(stop)
  await call('state', {})
  ctx.provided.set('agentPresets', { serviceFor: () => undefined, list: async () => [{ id: 'standard' }, { id: 'cordis' }] })
  const rt = ctx.provided.get('omniTeam')
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'ds-bot-adoption-project-')))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  const entry = (await call('add-agent', { name: 'Native', profile: 'cordis', workDir: project })).value
  const original = rt.state.agents[entry.id]
  Object.assign(original, { avatar: { shape: 'kitty' }, color: 'red', capabilities: ['native-skill'] })
  const snapshot = structuredClone(original)
  const second = (await call('agent-session', { agentId: entry.id })).value.sessionId
  snapshot.sessions.push(second)
  const resolve = rt.resolveAgent
  rt.resolveAgent = async id => {
    const live = await resolve(id)
    live.session.requestHeader = () => ({ config: { provider: 'native', model: 'chosen', reasoningEffort: 'high' } })
    return live
  }
  const before = created.length
  assert.equal((await call('agent-bot-adopt', { agentId: entry.id })).value.botId, second)
  const bot = rt.state.bots[second]
  assert.equal(created.length, before)
  assert.equal(rt.state.agents[entry.id], original)
  assert.equal(original.adoptedBotId, second)
  assert.equal(bot.kind, 'dsh')
  assert.equal(bot.model, 'native/chosen')
  assert.equal(bot.effort, 'high')
  assert.equal(bot.profile, 'cordis')
  assert.deepEqual(bot.avatar, snapshot.avatar)
  assert.deepEqual(bot.capabilities, snapshot.capabilities)
  assert.equal(rt.agentOf(second), undefined)
  assert.deepEqual(rt.dshBots.list(), [])
  assert.deepEqual((await call('state', {})).value.agents, [])
  const count = restricted.length
  createdAgents({ agent: { session: { id: second }, ctx: { effect: execute => execute(), tools: { restrict: () => { throw new Error('adopted session restricted') } } } } })
  await flush()
  assert.equal(restricted.length, count)
  assert.equal((await call('agent-bot-rollback', { agentId: entry.id })).ok, true)
  assert.deepEqual(original, snapshot)
  assert.equal(rt.state.bots[second], undefined)
  assert.equal(rt.agentOf(second), original)
  assert.equal(rt.dshBots.list()[0].id, entry.id)
  assert.deepEqual(archived, [])
  assert.equal(restricted.length, count + 2)
})

test('adoption and rollback save failures restore both records without archiving', async (t) => {
  const { call, stop, ctx, archived } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const entry = (await call('add-agent', { name: 'Native' })).value
  const rt = ctx.provided.get('omniTeam')
  const original = rt.state.agents[entry.id]
  const save = rt.save
  let fail = true
  rt.save = async () => { if (fail) { fail = false; throw new Error('disk full') } return save() }
  assert.match((await call('agent-bot-adopt', { agentId: entry.id })).error.message, /disk full/)
  assert.equal(rt.state.agents[entry.id], original)
  assert.equal(original.adoptedBotId, undefined)
  assert.equal(rt.state.bots[entry.sessions[0]], undefined)
  assert.equal(rt.agentOf(entry.sessions[0]), original)
  assert.equal((await call('agent-bot-adopt', { agentId: entry.id })).ok, true)
  const bot = rt.state.bots[entry.sessions[0]]
  fail = true
  assert.match((await call('agent-bot-rollback', { agentId: entry.id })).error.message, /disk full/)
  assert.equal(original.adoptedBotId, bot.id)
  assert.equal(rt.state.bots[bot.id], bot)
  assert.equal(rt.agentOf(bot.id), undefined)
  rt.save = save
  assert.equal((await call('agent-bot-rollback', { agentId: entry.id })).ok, true)
  assert.deepEqual(archived, [])
})

test('adoption rejects a host shutdown during Session resolution and retains the original registration', async (t) => {
  const { call, stop, ctx, home } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const entry = (await call('add-agent', { name: 'Native' })).value
  const rt = ctx.provided.get('omniTeam')
  const original = structuredClone(rt.state.agents[entry.id])
  const resolve = rt.resolveAgent
  rt.resolveAgent = async id => {
    const live = await resolve(id)
    await ctx.dispose()
    return live
  }
  await assert.rejects(rt.adoptAsBot(entry.id), /host stopped/)
  assert.deepEqual(rt.state.agents[entry.id], original)
  assert.equal(rt.state.bots[entry.sessions[0]], undefined)
  assert.equal(rt.agentOf(entry.sessions[0]), rt.state.agents[entry.id])
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.deepEqual(saved.agents[entry.id], original)
  assert.equal(saved.bots[entry.sessions[0]], undefined)
})

test('rollback rejects skipped persistence after shutdown and restores adopted records and indexes', async (t) => {
  const { call, stop, ctx, home } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const entry = (await call('add-agent', { name: 'Native' })).value
  const rt = ctx.provided.get('omniTeam')
  await rt.adoptAsBot(entry.id)
  const original = structuredClone(rt.state.agents[entry.id])
  const bot = rt.state.bots[entry.sessions[0]]
  const save = rt.save
  rt.save = async options => {
    await ctx.dispose()
    return save(options)
  }
  await assert.rejects(rt.rollbackAdoption(entry.id), /host stopped/)
  assert.deepEqual(rt.state.agents[entry.id], original)
  assert.equal(rt.state.bots[bot.id], bot)
  assert.equal(rt.agentOf(bot.id), undefined)
  assert.equal(rt.selfOf(bot.id), bot.id)
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.deepEqual(saved.agents[entry.id], original)
  assert.deepEqual(saved.bots[bot.id], bot)
})

test('adoption refuses an original registration changed while its Session resolves', async (t) => {
  const { call, stop, ctx } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const entry = (await call('add-agent', { name: 'Native' })).value
  const rt = ctx.provided.get('omniTeam')
  const resolve = rt.resolveAgent
  rt.resolveAgent = async id => {
    const live = await resolve(id)
    delete rt.state.agents[entry.id]
    return live
  }
  assert.match((await call('agent-bot-adopt', { agentId: entry.id })).error.message, /changed during adoption/)
  assert.equal(rt.state.bots[entry.sessions[0]], undefined)
})

test('adopted preset backs new group/fresh Sessions and tasks; rollback refuses new team history', async (t) => {
  const { call, stop, ctx, created } = start(TEAM)
  t.after(stop)
  await call('state', {})
  ctx.provided.set('agentPresets', { serviceFor: () => undefined, list: async () => [{ id: 'standard' }, { id: 'cordis' }] })
  const rt = ctx.provided.get('omniTeam')
  const entry = (await call('add-agent', { name: 'Native', profile: 'cordis' })).value
  await call('agent-bot-adopt', { agentId: entry.id })
  const bot = rt.state.bots[entry.sessions[0]]
  await rt.createSession('Native · group', { profile: bot.profile })
  assert.equal(created.at(-1).agentPreset, 'cordis')
  await rt.startTask({ title: 'Native task', text: 'Do it', from: bot.id })
  assert.equal(created.at(-1).agentPreset, 'cordis')
  assert.match((await call('agent-bot-rollback', { agentId: entry.id })).error.message, /new team history/)
  assert.equal(rt.state.agents[entry.id].adoptedBotId, bot.id)
})

test('UI DSH creation adds native team membership usable by roster, messages, groups and browser', async (t) => {
  const { call, stop, ctx, created } = start(TEAM, { config: {
    browserPlugin: 'refs',
    browserPluginApi: { id: 'refs', tools: [{ name: 'browser_native_test', needsBrowser: false, execute: async () => 'native browser ready' }] },
  } })
  t.after(stop)
  await call('state', {})
  const rt = ctx.provided.get('omniTeam')
  const entry = (await call('add-agent', { name: 'Native newcomer', teamMember: true })).value
  const bot = rt.findBot('Native newcomer')
  assert.ok(bot)
  assert.equal(bot.kind, 'dsh')
  assert.equal(bot.pendingCreation, undefined)
  assert.equal(entry.pendingCreation, undefined)
  assert.equal(entry.adoptedBotId, bot.id)
  assert.equal(rt.selfOf(entry.sessions[0]), bot.id)
  assert.equal(created.length, 1)
  assert.deepEqual((await call('state', {})).value.agents, [])
  assert.match(await ctx.registeredTools.get('list_bots').execute({}, { agent: { id: 'm1' } }), /Native newcomer/)
  const delivered = []
  rt.deliver = async message => { delivered.push(message) }
  await ctx.registeredTools.get('message_bot').execute({ to: bot.name, message: 'Welcome' }, { agent: { id: 'm1' } })
  assert.equal(delivered[0].toId, bot.id)
  const room = await rt.createRoom({ members: ['m1', bot.id], name: 'Native team' })
  assert.ok(room.members.includes(bot.id))
  assert.equal(await ctx.registeredTools.get('browser_native_test').execute({}, { agent: { id: bot.id }, signal: new AbortController().signal }), 'native browser ready')
})

test('UI DSH creation fails without leaving a plain orphan if membership cannot be saved', async (t) => {
  const { call, stop, ctx, archived, home } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const rt = ctx.provided.get('omniTeam')
  const save = rt.save
  let failed = false
  rt.save = async options => {
    if (!failed && Object.values(rt.state.bots).some(bot => bot.kind === 'dsh')) {
      failed = true
      throw new Error('membership disk failure')
    }
    return save(options)
  }
  const result = await call('add-agent', { name: 'Native newcomer', teamMember: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /membership disk failure/)
  assert.equal(failed, true)
  assert.deepEqual(rt.state.agents, {})
  assert.equal(rt.findBot('Native newcomer'), undefined)
  assert.equal(archived.length, 1)
  assert.match(archived[0], /^session-/)
  const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.deepEqual(saved.agents, {})
  assert.equal(Object.values(saved.bots).some(bot => bot.name === 'Native newcomer'), false)
})

test('failed membership archive retains a pending owned Session and restart cleans it up', async (t) => {
  const first = start(TEAM)
  t.after(first.stop)
  await first.call('state', {})
  const rt = first.ctx.provided.get('omniTeam')
  const save = rt.save
  let failed = false
  rt.save = async options => {
    if (!failed && Object.values(rt.state.bots).some(bot => bot.kind === 'dsh')) {
      failed = true
      throw new Error('membership disk failure')
    }
    return save(options)
  }
  first.failArchive.on = true
  const result = await first.call('add-agent', { name: 'Pending newcomer', teamMember: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /membership disk failure/)
  assert.match(result.error.message, /session is running/)
  const [pending] = Object.values(rt.state.agents)
  assert.ok(pending)
  assert.equal(pending.pendingCreation, true)
  assert.equal(rt.agentOf(pending.sessions[0]), pending)
  assert.equal(rt.findBot('Pending newcomer'), undefined)
  assert.deepEqual(first.archived, [])
  const disk = JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8'))
  assert.deepEqual(disk.agents[pending.id], pending)
  // A later agent resolution must still receive the standalone restriction.
  const before = first.restricted.length
  first.createdAgents({ agent: { session: { id: pending.sessions[0] }, ctx: { effect: execute => execute(), tools: { restrict: filter => { first.restricted.push({ sessionId: pending.sessions[0], filter }); return () => {} } } } } })
  await rt.load()
  await flush()
  assert.ok(first.restricted.length > before)
  await first.ctx.dispose()
  const restarted = start(undefined, { home: first.home })
  t.after(restarted.stop)
  await restarted.call('state', {})
  const recovered = restarted.ctx.provided.get('omniTeam')
  assert.deepEqual(restarted.archived, [pending.sessions[0]])
  assert.deepEqual(recovered.state.agents, {})
  assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents, {})
})

test('failed membership after real disposal keeps durable pending ownership until restart cleanup', async (t) => {
  const first = start(TEAM)
  t.after(first.stop)
  await first.call('state', {})
  const rt = first.ctx.provided.get('omniTeam')
  const resolve = rt.resolveAgent
  let resolutions = 0
  rt.resolveAgent = async id => {
    const live = await resolve(id)
    if (++resolutions === 2) await first.ctx.dispose()
    return live
  }
  const result = await first.call('add-agent', { name: 'Stopped newcomer', teamMember: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /host stopped/)
  const [pending] = Object.values(rt.state.agents)
  assert.ok(pending)
  assert.equal(pending.pendingCreation, true)
  assert.equal(rt.agentOf(pending.sessions[0]), pending)
  assert.deepEqual(first.archived, [])
  const disk = JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8'))
  assert.deepEqual(disk.agents[pending.id], pending)
  assert.equal(Object.values(disk.bots).some(bot => bot.kind === 'dsh'), false)
  const restarted = start(undefined, { home: first.home })
  t.after(restarted.stop)
  await restarted.call('state', {})
  assert.deepEqual(restarted.archived, [pending.sessions[0]])
  assert.deepEqual(restarted.ctx.provided.get('omniTeam').state.agents, {})
  assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents, {})
})

test('disposal during allocation preserves the reserved Session for restart cleanup', async (t) => {
  const first = start(TEAM)
  t.after(first.stop)
  await first.call('state', {})
  const rt = first.ctx.provided.get('omniTeam')
  const create = first.ctx.sessionController.create
  first.ctx.sessionController.create = async options => {
    const created = await create(options)
    await first.ctx.dispose()
    return created
  }
  const result = await first.call('add-agent', { name: 'Allocation stop', teamMember: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /Cleanup pending.*host stopped/)
  const [pending] = Object.values(rt.state.agents)
  assert.equal(pending.pendingCreation, true)
  assert.equal(rt.agentOf(pending.sessions[0]), pending)
  assert.deepEqual(first.archived, [])
  assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents[pending.id], pending)
  const restarted = start(undefined, { home: first.home })
  t.after(restarted.stop)
  await restarted.call('state', {})
  assert.deepEqual(restarted.archived, pending.sessions)
  assert.deepEqual(restarted.ctx.provided.get('omniTeam').state.agents, {})
})

test('writer loss preserves pending ownership and writer restoration retries cleanup', async (t) => {
  const first = start(TEAM)
  t.after(first.stop)
  await first.call('state', {})
  const rt = first.ctx.provided.get('omniTeam')
  const resolve = rt.resolveAgent
  let resolutions = 0
  rt.resolveAgent = async id => {
    const live = await resolve(id)
    if (++resolutions === 2) writeFileSync(join(first.home, 'state.lock'), JSON.stringify({ pid: process.pid, host: 'other-test-host', token: 'other-test-writer' }))
    return live
  }
  const result = await first.call('add-agent', { name: 'Lost writer', teamMember: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /Cleanup pending.*cannot save/)
  const [pending] = Object.values(rt.state.agents)
  assert.equal(pending.pendingCreation, true)
  assert.equal(rt.agentOf(pending.sessions[0]), pending)
  assert.deepEqual(first.archived, [])
  assert.deepEqual(rt.dshBots.list(), [])
  assert.deepEqual((await first.call('state', {})).value.agents, [])
  await assert.rejects(rt.adoptAsBot(pending.id), /another dsh|cleanup is pending/)
  // Only the test's own temporary foreign lock is removed to restore authority.
  rmSync(join(first.home, 'state.lock'))
  await rt.refresh()
  await rt.load()
  assert.deepEqual(first.archived, pending.sessions)
  assert.deepEqual(rt.state.agents, {})
  assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents, {})
})

test('post-archive persistence failure retains intent and restart retries idempotently', async (t) => {
  const first = start(TEAM)
  t.after(first.stop)
  await first.call('state', {})
  const rt = first.ctx.provided.get('omniTeam')
  const save = rt.save
  let failed = false
  rt.save = async options => {
    if (!failed && Object.values(rt.state.bots).some(bot => bot.kind === 'dsh')) {
      failed = true
      throw new Error('membership disk failure')
    }
    if (first.archived.length > 0) throw new Error('cleanup disk failure')
    return save(options)
  }
  const result = await first.call('add-agent', { name: 'Archive saved first', teamMember: true })
  assert.equal(result.ok, false)
  assert.match(result.error.message, /membership disk failure.*Cleanup pending.*cleanup disk failure/)
  const [pending] = Object.values(rt.state.agents)
  assert.equal(pending.pendingCreation, true)
  assert.deepEqual(first.archived, pending.sessions)
  assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents[pending.id], pending)
  await first.ctx.dispose()
  const restarted = start(undefined, { home: first.home })
  t.after(restarted.stop)
  // Match DSH's real archive contract: an already archived identity succeeds.
  restarted.ctx.workspaceRegistry.archiveSession = async id => { assert.ok(first.archived.includes(id)) }
  await restarted.call('state', {})
  assert.deepEqual(restarted.ctx.provided.get('omniTeam').state.agents, {})
  assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents, {})
})

test('unallocated reservation cleanup accepts only a matching native unknown-session error', async (t) => {
  for (const matching of [true, false]) {
    const first = start(TEAM)
    t.after(first.stop)
    await first.call('state', {})
    const rt = first.ctx.provided.get('omniTeam')
    first.ctx.sessionController.create = async () => { throw new Error('allocation refused') }
    first.ctx.workspaceRegistry.archiveSession = async sessionId => {
      const error = new Error('session is unknown')
      error.name = 'WorkspaceUnknownSessionError'
      error.sessionId = matching ? sessionId : 'unrelated'
      throw error
    }
    const result = await first.call('add-agent', { name: 'Never allocated', teamMember: true })
    assert.equal(result.ok, false)
    assert.match(result.error.message, /allocation refused/)
    if (matching) {
      assert.doesNotMatch(result.error.message, /Cleanup pending/)
      assert.deepEqual(rt.state.agents, {})
      assert.deepEqual(JSON.parse(readFileSync(join(first.home, 'state.json'), 'utf8')).agents, {})
    } else {
      assert.match(result.error.message, /Cleanup pending.*session is unknown/)
      assert.equal(Object.values(rt.state.agents)[0].pendingCreation, true)
    }
  }
})

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 2,
  bots: { m1: { id: 'm1', sessionId: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: '', createdAt: 1 } },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

test('add-agent creates a DSH bot with a first Session in the Omni workspace', async (t) => {
  const { call, stop, created } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  assert.equal(agent.name, 'Notes')
  assert.equal(agent.sessions.length, 1)
  const view = (await call('state', {})).value
  assert.deepEqual(view.agents.map(entry => entry.id), [agent.id])
  // The Session was created in the workspace the Bots live in.
  const workspaceId = view.workspaceId
  assert.equal(created.at(-1).workspaceId, workspaceId)
})

test('DSH bots: several, each in its own folder with its own preset, listed for other plugins', async (t) => {
  const { call, stop, created, ctx, renamed } = start(TEAM)
  t.after(stop)
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'ds-bot-project-')))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  await call('state', {})
  ctx.provided.set('agentPresets', { list: async () => [{ id: 'standard', name: 'Standard' }, { id: 'cordis', name: 'Creator' }, { id: 'broken', broken: 'no tools' }] })
  assert.deepEqual((await call('agent-presets')).value.map(preset => preset.id), ['standard', 'cordis'])
  const rt = ctx.provided.get('omniTeam')
  const changes = []
  rt.dshBots.onChange(list => changes.push(list.map(bot => bot.name)))
  const site = (await call('add-agent', { name: 'Site', workDir: project, profile: 'cordis' })).value
  assert.deepEqual(created.at(-1), { cwd: project, agentPreset: 'cordis' })
  const scratch = (await call('add-agent', { name: 'Scratch' })).value
  assert.deepEqual(Object.keys(created.at(-1)), ['workspaceId'])
  assert.equal((await call('add-agent', { name: 'site' })).error.message, 'A DSH bot named site already exists')
  assert.equal((await call('add-agent', { name: 'Odd', profile: 'broken' })).error.message, 'The preset broken is not available in this DSH')
  // A task is not a DSH bot: it never shows in the list.
  await rt.startTask({ title: 'Wish', text: 'Do it', from: 'm1' })
  assert.deepEqual(rt.dshBots.list(), [
    { id: site.id, name: 'Site', workDir: project, profile: 'cordis' },
    { id: scratch.id, name: 'Scratch', workDir: null, profile: null },
  ])
  // Settings apply to the Sessions made after them.
  await call('update-agent', { agentId: scratch.id, name: 'Scratch', workDir: project, profile: 'standard' })
  const { sessionId } = await rt.dshBots.createSession(scratch.id, { title: 'Fix the build', firstMessage: 'Run the tests' })
  assert.deepEqual(created.at(-1), { cwd: project, agentPreset: 'standard' })
  assert.deepEqual(renamed.at(-1), { id: sessionId, title: 'Fix the build' })
  assert.deepEqual(changes, [['Site'], ['Site', 'Scratch'], ['Site', 'Scratch']])
  await assert.rejects(rt.dshBots.createSession(rt.agentOf(Object.keys(rt.state.tasks)[0]).id, {}), /Unknown DSH bot/)
})

test('the single DSH Agent of an older team becomes a DSH bot and the tasks record', async (t) => {
  const team = {
    ...TEAM,
    agents: { old: { id: 'old', name: 'Tasks', sessions: ['mine', 'handed', 'run'], createdAt: 5 } },
    tasks: { handed: { title: 'Wish', from: 'm1', at: 6, status: 'done' } },
    subscriptionRuns: [{ id: 'r', sessionId: 'run', task: 'Check', status: 'done' }],
  }
  const { call, stop, ctx, home } = start(team)
  t.after(stop)
  const view = (await call('state', {})).value
  assert.deepEqual(view.agents.map(agent => [agent.id, agent.kind, agent.sessions]), [['old', 'dsh', ['mine']], ['old:tasks', 'tasks', ['handed', 'run']]])
  assert.deepEqual(ctx.provided.get('omniTeam').dshBots.list().map(bot => bot.name), ['Tasks'])
  assert.equal(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).agents.old.kind, 'dsh')
})

test('agent-session appends Sessions; agent-archive removes one and archives it', async (t) => {
  const { call, stop, archived } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  const second = (await call('agent-session', { agentId: agent.id })).value
  assert.equal((await call('state', {})).value.agents[0].sessions.length, 2)
  assert.equal((await call('agent-archive', { agentId: agent.id, sessionId: second.sessionId })).ok, true)
  const view = (await call('state', {})).value
  assert.deepEqual(view.agents[0].sessions, agent.sessions)
  assert.deepEqual(archived, [second.sessionId])
})

test('a failed archive keeps the Session in the DSH bot and answers with the error', async (t) => {
  const { call, stop, archived, failArchive } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  const second = (await call('agent-session', { agentId: agent.id })).value
  failArchive.on = true
  const failed = await call('agent-archive', { agentId: agent.id, sessionId: second.sessionId })
  assert.equal(failed.ok, false)
  // The Session stays with the Agent, so the restriction and the retry stay.
  assert.deepEqual((await call('state', {})).value.agents[0].sessions, [agent.sessions[0], second.sessionId])
  assert.deepEqual(archived, [])
  failArchive.on = false
  assert.equal((await call('agent-archive', { agentId: agent.id, sessionId: second.sessionId })).ok, true)
})

test('agent-rename retitles an owned Session and refuses others', async (t) => {
  const { call, stop, renamed } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  assert.equal((await call('agent-rename', { agentId: agent.id, sessionId: agent.sessions[0], title: '  Scratch  ' })).ok, true)
  assert.deepEqual(renamed.at(-1), { id: agent.sessions[0], title: 'Scratch' })
  assert.equal((await call('agent-rename', { agentId: agent.id, sessionId: agent.sessions[0], title: '   ' })).ok, false)
  // A Bot's Session cannot be renamed through the agent endpoint.
  assert.equal((await call('agent-rename', { agentId: agent.id, sessionId: 'm1', title: 'x' })).ok, false)
})

test('remove-agent keeps the DSH bot with the Sessions it could not archive', async (t) => {
  const { call, stop, archived, failArchive } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  const second = (await call('agent-session', { agentId: agent.id })).value
  failArchive.on = true
  const failed = await call('remove-agent', { agentId: agent.id })
  assert.equal(failed.ok, false)
  // Nothing archived, so the Agent stays whole; the retry then removes it.
  assert.deepEqual((await call('state', {})).value.agents[0].sessions, [agent.sessions[0], second.sessionId])
  assert.deepEqual(archived, [])
  failArchive.on = false
  assert.equal((await call('remove-agent', { agentId: agent.id })).ok, true)
  assert.equal((await call('state', {})).value.agents.length, 0)
})

test('remove-agent archives every Session and drops the record', async (t) => {
  const { call, stop, archived } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  const second = (await call('agent-session', { agentId: agent.id })).value
  assert.equal((await call('remove-agent', { agentId: agent.id })).ok, true)
  assert.deepEqual((await call('state', {})).value.agents, [])
  assert.deepEqual([...archived].sort(), [agent.sessions[0], second.sessionId].sort())
})

test('a corrupt agents field resets instead of crashing the view', async (t) => {
  const { call, stop } = start({ ...TEAM, agents: 'junk' })
  t.after(stop)
  const view = (await call('state', {})).value
  assert.deepEqual(view.agents, [])
})

// The Omni channels and canvas plugins register these for the team; TEAM_TOOLS names them
// too, so a DSH Agent's Sessions never get them. The canvas plugin's tests check the whole
// list with all three installed.
const CHANNEL_TOOLS = ['find_chats', 'list_automations', 'save_automation', 'pause_automation', 'delete_automation', 'omni_endpoints', 'omni_call', 'omni_channels', 'omni_chats', 'omni_messages', 'omni_send', 'omni_react', 'omni_media', 'omni_delete', 'omni_connect', 'show_canvas']

test('TEAM_TOOLS names exactly the tools ds-bot registers, and those of the other Omni plugins', async (t) => {
  // read_browser registers only in the Desktop profile; the flag stands in for it.
  const { stop, ctx } = start(TEAM, { config: { browser: true } })
  t.after(stop)
  const browser = name => name.startsWith('browser_')
  assert.deepEqual([...ctx.registeredTools.keys()].filter(name => !browser(name)).sort(), TEAM_TOOLS.filter(name => !CHANNEL_TOOLS.includes(name)).sort())
  for (const name of CHANNEL_TOOLS) assert.ok(TEAM_TOOLS.includes(name), name)
})

test('agent-session honors a known workspace and falls back to the team workspace', async (t) => {
  const { call, stop, created, ctx } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  // An unknown workspace id falls back; a real one is used as given.
  await call('agent-session', { agentId: agent.id, workspaceId: 'nope' })
  assert.equal(created.at(-1).workspaceId, (await call('state', {})).value.workspaceId)
  const other = await ctx.workspaceRegistry.create('/tmp/elsewhere')
  await call('agent-session', { agentId: agent.id, workspaceId: other.id })
  assert.equal(created.at(-1).workspaceId, other.id)
})

test('agent-adopt takes an unowned Session and refuses team-owned ones', async (t) => {
  const { call, stop, restricted } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const agent = (await call('add-agent', { name: 'Notes' })).value
  // A plain root Session (the workspace picker's blank, or a fork) joins the Agent.
  const adopted = (await call('agent-adopt', { agentId: agent.id, sessionId: 'fresh' })).value
  assert.equal(adopted.sessionId, 'fresh')
  assert.deepEqual((await call('state', {})).value.agents[0].sessions, [...agent.sessions, 'fresh'])
  // It gets the team-tools mask too.
  assert.equal(restricted.at(-1).sessionId, 'fresh')
  // Adopting again is a no-op.
  assert.equal((await call('agent-adopt', { agentId: agent.id, sessionId: 'fresh' })).ok, true)
  // A Bot's Session and an unknown Agent are refused.
  assert.equal((await call('agent-adopt', { agentId: agent.id, sessionId: 'm1' })).ok, false)
  assert.equal((await call('agent-adopt', { agentId: 'none', sessionId: 'fresh2' })).error.message, 'Unknown DSH bot')
})

test('team tools are restricted on DSH bot Sessions but not on Bot Sessions', async (t) => {
  const { call, stop, restricted, createdAgents } = start(TEAM)
  t.after(stop)
  await call('state', {})
  // A Bot resolving its agent triggers agent/created but owns no team tools mask.
  createdAgents({
    agent: {
      session: { id: 'm1' },
      ctx: {
        tools: { restrict: filter => { restricted.push({ sessionId: 'm1', filter }) } },
        effect: execute => execute(),
      },
    },
  })
  await flush()
  assert.equal(restricted.length, 0)
  // Creating the agent records the session, then restrict fires on its own agent.
  const agent = (await call('add-agent', { name: 'Notes' })).value
  assert.equal(restricted.length, 1)
  assert.equal(restricted[0].sessionId, agent.sessions[0])
  assert.deepEqual([...restricted[0].filter.deny].sort(), [...TEAM_TOOLS].sort())
  // A later agent/created for that session does not restrict a second time.
  const listener = {
    session: { id: agent.sessions[0] },
    ctx: {
      tools: { restrict: filter => { restricted.push({ sessionId: agent.sessions[0], filter }) } },
      effect: execute => execute(),
    },
  }
  createdAgents({ agent: listener })
  await flush()
  // The listener path resolves through rt.load() + the session index; because the
  // fake resolveAgent is not consulted here, the WeakSet does not know this agent
  // object, so the event does restrict — but still only for the agent session.
  assert.equal(restricted.every(entry => entry.sessionId === agent.sessions[0]), true)
})

test('a task started with a folder of its own runs there, with a preset this DSH serves', async (t) => {
  const { call, stop, created, home, ctx } = start(TEAM)
  t.after(stop)
  await call('state', {})
  ctx.provided.set('agentPresets', { list: async () => [{ id: 'standard' }, { id: 'broken', broken: 'no tools' }] })
  const rt = ctx.provided.get('omniTeam')
  await rt.startTask({ title: 'Wish', text: 'Do it', from: 'm1', cwd: home, agentPreset: 'standard' })
  assert.deepEqual(created.at(-1), { cwd: home, agentPreset: 'standard' })
  // A path that is not a folder, or a preset DSH does not serve unbroken, falls back.
  await rt.startTask({ title: 'Wish 2', text: 'Do it', from: 'm1', cwd: join(home, 'missing'), agentPreset: 'broken' })
  assert.deepEqual(Object.keys(created.at(-1)), ['workspaceId'])
  await rt.startTask({ title: 'Wish 3', text: 'Do it', from: 'm1', cwd: 'relative/path' })
  assert.deepEqual(Object.keys(created.at(-1)), ['workspaceId'])
  const view = (await call('state', {})).value
  assert.equal(Object.values(view.tasks).filter(task => task.status === 'working').length, 3)
})

test('a task thinks with the model of the Bot that asked, chosen before its first message', async (t) => {
  const team = { ...TEAM, bots: { m1: { ...TEAM.bots.m1, model: 'keyed/flash' } } }
  const { call, stop, ctx } = start(team)
  t.after(stop)
  // Only the Bot's own provider is served: DSH's default route would have no key here.
  ctx.llm = { listProviders: () => [{ id: 'keyed' }], listModels: async () => [{ id: 'flash' }] }
  await call('state', {})
  const steps = []
  ctx.sessionController.selectModel = async ({ sessionId, provider, model }) => { steps.push(['model', sessionId, `${provider}/${model}`]) }
  const resolve = ctx.sessionController.resolveAgent
  ctx.sessionController.resolveAgent = async (sessionId) => {
    const { agent } = await resolve(sessionId)
    return { agent: { ...agent, followup: () => steps.push(['message', sessionId]) } }
  }
  const rt = ctx.provided.get('omniTeam')
  const sessionId = await rt.startTask({ title: 'Wish', text: 'Do it', from: 'm1' })
  assert.deepEqual(steps.filter(step => step[1] === sessionId), [['model', sessionId, 'keyed/flash'], ['message', sessionId]])
  // A task no Bot asked for keeps DSH's default.
  const plain = await rt.startTask({ title: 'Chore', text: 'Do it' })
  assert.deepEqual(steps.filter(step => step[1] === plain), [['message', plain]])
})

test('a task that ends on an error is failed with its reason; one stopped is stopped, not done', async (t) => {
  const { call, stop, ctx } = start(TEAM)
  t.after(stop)
  await call('state', {})
  const rt = ctx.provided.get('omniTeam')
  const reports = []
  rt.deliver = async message => { reports.push(message) }
  const end = (sessionId, reason) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) listener({ id: sessionId }, { type: 'turn/end', data: { turn: 1, reason } })
  }
  const failed = await rt.startTask({ title: 'Wish', text: 'Do it', from: 'm1' })
  end(failed, { kind: 'error', error: { message: 'the provider refused the key', code: 'AUTH' } })
  const stopped = await rt.startTask({ title: 'Wish 2', text: 'Do it', from: 'm1' })
  end(stopped, { kind: 'aborted', reason: { kind: 'user' } })
  await flush()
  const { tasks } = (await call('state', {})).value
  assert.deepEqual([tasks[failed].status, tasks[failed].summary], ['failed', 'the provider refused the key'])
  assert.equal(tasks[stopped].status, 'stopped')
  assert.deepEqual(reports.map(report => [report.taskSessionId, report.text]), [
    [failed, 'It failed: the provider refused the key'],
    [stopped, 'It was stopped before it finished.'],
  ])
})

test('a task started in a group reports back to that group, not the Bot\'s own chat', async (t) => {
  const team = {
    ...TEAM,
    rooms: { r1: { id: 'r1', name: 'Demo', members: ['m1'], admin: 'm1', mode: 'admin', notice: '', createdAt: 2, createdBy: null, sessions: { m1: 'g1' } } },
  }
  const { call, stop, ctx } = start(team)
  t.after(stop)
  await call('state', {})
  const rt = ctx.provided.get('omniTeam')
  const reports = []
  rt.deliver = async message => { reports.push(message) }
  const end = (sessionId) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) listener({ id: sessionId }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  }
  // The tool is called from the Bot's Session in the group, which is what start_task sees.
  const said = await ctx.registeredTools.get('start_task').execute({ title: 'Clone it', instructions: 'Clone the repo' }, { agent: { id: 'g1' } })
  assert.match(said, /^Started task "Clone it"/)
  const [inGroup] = Object.keys((await call('state', {})).value.tasks)
  end(inGroup)
  // A task from the Bot's own chat keeps going to its own chat.
  await ctx.registeredTools.get('start_task').execute({ title: 'Private', instructions: 'Do it' }, { agent: { id: 'm1' } })
  const own = Object.keys((await call('state', {})).value.tasks).find(id => id !== inGroup)
  end(own)
  await flush()
  assert.deepEqual(reports.map(report => [report.taskSessionId, report.sessionId, report.roomId]), [
    [inGroup, 'g1', 'r1'],
    [own, undefined, undefined],
  ])
})
