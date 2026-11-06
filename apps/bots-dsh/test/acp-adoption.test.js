import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { until } from './until.js'

// A team already through the Claude Code -> pi-ai move (store.js), with Bots the ACP move can
// and cannot take: still on the model it was moved to; changed by the person since; and one
// the route does not list.
const seed = (bots = {}) => ({
  version: 1,
  mainBotIds: ['m1'],
  revision: 2,
  whaleStored: true,
  octopusStored: true,
  genieClayStored: true,
  claudeCodeMoved: true,
  bots: {
    m1: {
      id: 'm1', sessionId: 'm1', name: 'Omni', role: 'Boss', instructions: '', createdAt: 1,
      model: 'anthropic/claude-opus-5-5', claudeCodeModel: 'claude-code/opus', appliedModel: 'anthropic/claude-opus-5-5', appliedEffort: 'high', effort: 'high',
    },
    w2: {
      id: 'w2', sessionId: 'w2', name: 'Writer', role: 'Write', instructions: '', createdAt: 2,
      model: 'anthropic/claude-sonnet-4-5', claudeCodeModel: 'claude-code-work/claude-sonnet-4-5-20250929[1m]',
    },
    d3: {
      id: 'd3', sessionId: 'd3', name: 'Coder', role: 'Code', instructions: '', createdAt: 3,
      model: 'deepseek/deepseek-v4-flash', claudeCodeModel: 'claude-code/opus',
    },
    ...bots,
  },
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
})

// What the ACP plugin says when its bridge and probes are usable, and the route lists Claude's
// aliases as Claude Code's own catalog does.
const readyAcp = (models = ['default', 'opus', 'sonnet', 'haiku']) => ({
  bridge: () => ({ on: true, probesPass: true }),
  status: async () => ({ agents: [{ id: 'acp-claude', connector: { state: 'ready' }, model: { id: 'default', listed: true } }] }),
  models,
})

async function start(team, { acp = readyAcp(), providers = ['anthropic', 'deepseek', 'acp-claude'], acpModels = undefined } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-acp-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext({ services: { acpAgents: acp } })
  const workspaces = new Map()
  const selected = []
  const catalog = {
    anthropic: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-4-5' }],
    deepseek: [{ id: 'deepseek-v4-flash' }],
    'acp-claude': (acpModels ?? acp.models ?? []).map(id => ({ id })),
  }
  Object.assign(ctx, {
    llm: {
      listProviders: () => providers.map(id => ({ id, name: id })),
      listModels: async provider => catalog[provider] ?? [],
      resolveModelInfo: async (provider) => (provider === 'acp-claude' ? { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } } : {}),
      listConfigurableProviders: () => [],
    },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {}, cancel() {} } }),
      selectModel: async request => { selected.push(request) },
      page: async () => ({ records: [], hasMore: false }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {}, list: () => [] },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', {
    method: 'POST', body: JSON.stringify({ endpoint, payload }),
  }))).json()
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  const saved = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  const teamNow = async () => Object.fromEntries((await call('state', {})).value.bots.map(bot => [bot.id, bot]))
  // The move runs after the team loads and the ACP route answers, not synchronously.
  const moved = () => until(() => {
    const state = saved()
    return state.claudeAcpMoved === true || state.bots.m1.model !== team.bots.m1.model
  }, { label: 'the ACP move ran' })
  return { home, ctx, call, stop, saved, teamNow, selected, moved }
}

test('a Bot still on the pi-ai model it was moved to goes to acp-claude once, keeping its Session', async (t) => {
  const host = await start(seed())
  t.after(host.stop)
  await host.moved()
  // The model is recorded on the Session after the save that moved the Bot.
  await until(() => host.saved().bots.m1.appliedModel === 'acp-claude/opus' && host.saved().bots.w2.appliedModel === 'acp-claude/sonnet', { label: 'the ACP models were applied' })
  const state = host.saved()
  assert.equal(state.claudeAcpMoved, true)
  // The route lists Claude's aliases, not pi-ai's exact ids: the family stands in.
  assert.equal(state.bots.m1.model, 'acp-claude/opus')
  assert.equal(state.bots.w2.model, 'acp-claude/sonnet')
  assert.equal(state.bots.m1.claudeCodeModel, 'claude-code/opus')
  assert.equal(state.bots.m1.appliedModel, 'acp-claude/opus')
  assert.equal(state.bots.m1.appliedEffort, 'high')
  assert.deepEqual([state.bots.m1.sessionId, state.bots.w2.sessionId], ['m1', 'w2'])
})

test('the move runs once per team: a model the person picks afterwards is never moved again', async (t) => {
  const host = await start(seed())
  t.after(host.stop)
  await host.moved()
  assert.equal((await host.call('update-bot', { id: 'm1', model: 'deepseek/deepseek-v4-flash' })).ok, true)
  await until(() => host.saved().bots.m1.model === 'deepseek/deepseek-v4-flash')
  // A later catalog (another start reads the same file) sees the flag and leaves the Bot be.
  const again = await start(host.saved(), { acp: readyAcp() })
  t.after(again.stop)
  await again.call('state', {})
  await until(() => again.saved().bots.m1.model === 'deepseek/deepseek-v4-flash')
  assert.equal(again.saved().bots.m1.model, 'deepseek/deepseek-v4-flash')
  assert.equal(again.saved().claudeAcpMoved, true)
})

test('a Bot the person moved off its pi-ai Claude model is left alone', async (t) => {
  const host = await start(seed())
  t.after(host.stop)
  await host.moved()
  const state = host.saved()
  assert.equal(state.bots.d3.model, 'deepseek/deepseek-v4-flash')
  assert.equal(state.bots.d3.claudeCodeModel, 'claude-code/opus')
})

test('a Bot whose model the route does not list is left alone, and the team is not marked done', async (t) => {
  // Only `default`: neither opus nor the exact pi-ai id is served by the route yet.
  const host = await start(seed(), { acp: readyAcp(['default']) })
  t.after(host.stop)
  await host.call('state', {})
  await new Promise(resolve => setTimeout(resolve, 100))
  const state = host.saved()
  assert.equal(state.bots.m1.model, 'anthropic/claude-opus-5-5')
  assert.equal(state.bots.w2.model, 'anthropic/claude-sonnet-4-5')
  // Not marked: an adapter installed later may list them, and that catalog moves them then.
  assert.equal(state.claudeAcpMoved, undefined)
})

test('a Bot moved from Claude Code\'s default model takes Opus on the route', async (t) => {
  const def = {
    id: 'def', sessionId: 'def', name: 'Default', role: 'Boss', instructions: '', createdAt: 4,
    model: 'anthropic/claude-opus-5-5', claudeCodeModel: 'claude-code/default',
  }
  const host = await start(seed({ def }))
  t.after(host.stop)
  await host.moved()
  await until(() => host.saved().bots.def.appliedModel === 'acp-claude/opus', { label: 'the default Bot moved' })
  assert.equal(host.saved().bots.def.model, 'acp-claude/opus')
})

test('an event that lands while the route is being read runs one more pass', async (t) => {
  let release
  let calls = 0
  const acp = {
    ...readyAcp(),
    status: () => {
      calls += 1
      if (calls === 1) {
        return new Promise((resolve) => {
          release = () => resolve({ agents: [{ id: 'acp-claude', connector: { state: 'installing' }, model: { listed: false } }] })
        })
      }
      return Promise.resolve({ agents: [{ id: 'acp-claude', connector: { state: 'ready' }, model: { listed: true } }] })
    },
  }
  const host = await start(seed(), { acp })
  t.after(host.stop)
  await until(() => calls === 1, { label: 'the first route read started' })
  // The adapter lands while the first pass waits on the route.
  host.ctx.emit('llm/adapters-updated')
  release()
  await until(() => host.saved().claudeAcpMoved === true, { label: 'the queued pass moved the team' })
  assert.equal(host.saved().bots.m1.model, 'acp-claude/opus')
})

test('dshTools off is the 2026-11-03 behaviour: no Bot moves', async (t) => {
  const off = { ...readyAcp(), bridge: () => ({ on: false, probesPass: true }) }
  const host = await start(seed(), { acp: off })
  t.after(host.stop)
  await host.call('state', {})
  await new Promise(resolve => setTimeout(resolve, 100))
  const state = host.saved()
  assert.equal(state.bots.m1.model, 'anthropic/claude-opus-5-5')
  assert.equal(state.bots.w2.model, 'anthropic/claude-sonnet-4-5')
  assert.equal(state.claudeAcpMoved, undefined)
})

test('a bridge whose probes do not pass, or an adapter that is not installed, moves nothing', async (t) => {
  for (const acp of [
    { ...readyAcp(), bridge: () => ({ on: true, probesPass: false }) },
    { ...readyAcp(), status: async () => ({ agents: [{ id: 'acp-claude', connector: { state: 'installing' }, model: { listed: false } }] }) },
  ]) {
    const host = await start(seed(), { acp })
    t.after(host.stop)
    await host.call('state', {})
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(host.saved().bots.m1.model, 'anthropic/claude-opus-5-5')
    assert.equal(host.saved().claudeAcpMoved, undefined)
  }
})
