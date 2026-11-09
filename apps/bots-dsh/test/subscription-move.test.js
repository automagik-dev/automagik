import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { SUBSCRIPTION_MOVES, movedRef } from '../src/host/subscription-move.js'
import { fakeContext } from './fake-ctx.js'
import { until } from './until.js'

const bot = (id, model, extra = {}) => ({ id, sessionId: id, name: id, role: 'Work', instructions: '', createdAt: 1, model, ...extra })

const seed = (bots, extra = {}) => ({
  version: 1,
  mainBotIds: [],
  revision: 2,
  whaleStored: true,
  octopusStored: true,
  genieClayStored: true,
  claudeCodeMoved: true,
  bots: Object.fromEntries(bots.map(entry => [entry.id, entry])),
  rooms: {},
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  ...extra,
})

// DSH's settings with pi-ai's routes as given: `anthropic: {}` is the Claude Pro/Max sign-in's
// route, `anthropic: { apiKeyEnv }` the API key's.
const piSettings = providers => ({
  describe: () => [{ ns: 'llm-pi-ai', revision: 0, value: { providers }, user: { providers }, base: {} }],
})

// DSH's credential store, as descriptions only: `records` maps a record key to its kind,
// `keys` lists the references found (a stored key or one in the environment).
const fakeCredentials = ({ records, keys }) => ({
  describeRecord: async key => (Object.hasOwn(records, key) ? { configured: true, kind: records[key], writable: true } : { configured: false, writable: true }),
  describe: async ref => (keys.includes(ref) ? { configured: true, source: 'env', writable: true } : { configured: false, writable: true }),
})

async function start(team, {
  providers = ['deepseek', 'openai-codex', 'acp-codex', 'anthropic', 'acp-claude'],
  pi = { anthropic: {} },
  records = { 'llm-pi-ai/anthropic': 'grant' },
  keys = [],
  catalog = {},
  services = {},
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-subs-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext({
    services: {
      ...(pi === null ? {} : { settings: piSettings(pi), credentials: fakeCredentials({ records, keys }) }),
      ...services,
    },
  })
  const routes = { list: [...providers] }
  const models = Object.assign(Object.create(null), {
    deepseek: [{ id: 'deepseek-v4-flash' }],
    'openai-codex': [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }],
    'acp-codex': [{ id: 'default' }, { id: 'gpt-6.1-sol' }],
    anthropic: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }],
    'acp-claude': [{ id: 'default' }, { id: 'opus' }, { id: 'sonnet' }, { id: 'haiku' }],
    openai: [{ id: 'gpt-6.1-sol' }],
    ...catalog,
  })
  const selected = []
  Object.assign(ctx, {
    llm: {
      listProviders: () => routes.list.map(id => ({ id, name: id })),
      listModels: async provider => models[provider] ?? [],
      resolveModelInfo: async () => ({}),
      listConfigurableProviders: () => ['openai-codex', 'anthropic', 'openai']
        .map(id => ({ provider: id, displayName: id, settingsNs: 'llm-pi-ai', settingsPath: ['providers', id] })),
    },
    workspaceRegistry: {
      get: () => undefined,
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
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
  apply(ctx, { home })
  const rt = ctx.provided.get('omniTeam')
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  const saved = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  return { ctx, rt, routes, models, saved, selected, stop }
}

test('movedRef keeps the same id when the agent lists it, else the family, else default', () => {
  const [codex, claude] = SUBSCRIPTION_MOVES
  assert.equal(movedRef('openai-codex/gpt-6.1-sol', codex, ['default', 'gpt-6.1-sol']), 'acp-codex/gpt-6.1-sol')
  assert.equal(movedRef('openai-codex/gpt-6.1-sol', codex, ['default', 'gpt-6.1-sol/high']), 'acp-codex/gpt-6.1-sol/high')
  assert.equal(movedRef('openai-codex/gpt-6-astra', codex, ['default', 'gpt-6.1-sol']), 'acp-codex/default')
  assert.equal(movedRef('openai-codex/gpt-6', codex, ['gpt-6.1-sol']), 'acp-codex/default')
  assert.equal(movedRef('anthropic/claude-opus-5-5', claude, ['default', 'opus', 'sonnet']), 'acp-claude/opus')
  assert.equal(movedRef('anthropic/claude-sonnet-5-5', claude, ['claude-sonnet-5-5', 'sonnet']), 'acp-claude/claude-sonnet-5-5')
  assert.equal(movedRef('anthropic/claude-haiku-4-5', claude, ['default', 'opus']), 'acp-claude/default')
  assert.equal(movedRef('openai/gpt-6.1-sol', codex, ['gpt-6.1-sol']), undefined)
  assert.equal(movedRef('deepseek/deepseek-v4-flash', claude, []), undefined)
  assert.equal(movedRef(undefined, codex, []), undefined)
})

test('subscription Bots move once to their CLI; key and other Bots stay; the Session selects the target', async (t) => {
  const team = seed([
    bot('c1', 'openai-codex/gpt-6.1-sol', { effort: 'high', appliedModel: 'openai-codex/gpt-6.1-sol', previousModel: 'openai-codex/gpt-6.1-sol' }),
    bot('c2', 'openai-codex/gpt-6-astra'),
    bot('a1', 'anthropic/claude-opus-5-5', { previousModel: 'deepseek/deepseek-v4-flash' }),
    bot('k1', 'openai/gpt-6.1-sol'),
    bot('d1', 'deepseek/deepseek-v4-flash', { previousModel: 'openai-codex/gpt-6-astra' }),
  ])
  const host = await start(team)
  t.after(host.stop)
  await until(() => host.saved().subscriptionCliMoved?.anthropic === true && host.saved().subscriptionCliMoved?.['openai-codex'] === true, { label: 'the move ran' })
  await until(() => host.saved().bots.c1.appliedModel === 'acp-codex/gpt-6.1-sol', { label: 'the target was applied' })
  const { bots } = host.saved()
  assert.equal(bots.c1.model, 'acp-codex/gpt-6.1-sol')
  assert.equal(bots.c1.effort, 'high')
  assert.deepEqual(bots.c1.subscriptionMoved, { from: { model: 'openai-codex/gpt-6.1-sol', effort: 'high' }, target: 'acp-codex/gpt-6.1-sol' })
  // A confirmed Bot stays confirmed: no switch back to a route that no longer answers.
  assert.equal(bots.c1.previousModel, 'acp-codex/gpt-6.1-sol')
  assert.equal(bots.c2.model, 'acp-codex/default')
  assert.equal(bots.a1.model, 'acp-claude/opus')
  // A pending switch keeps the model it came from.
  assert.equal(bots.a1.previousModel, 'deepseek/deepseek-v4-flash')
  assert.equal(bots.k1.model, 'openai/gpt-6.1-sol')
  assert.equal(bots.k1.subscriptionMoved, undefined)
  assert.equal(bots.d1.model, 'deepseek/deepseek-v4-flash')
  assert.equal(bots.d1.previousModel, 'acp-codex/default')
  await until(() => host.selected.length >= 3, { label: 'the Sessions selected the targets' })
  assert.deepEqual(
    host.selected.map(request => `${request.sessionId}:${request.provider}/${request.model}`).sort(),
    ['a1:acp-claude/opus', 'c1:acp-codex/gpt-6.1-sol', 'c2:acp-codex/default'],
  )
})

test('a Claude Bot on an Anthropic API key never moves', async (t) => {
  const team = seed([bot('a1', 'anthropic/claude-opus-5-5'), bot('c1', 'openai-codex/gpt-6.1-sol')])
  const host = await start(team, { pi: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } } })
  t.after(host.stop)
  await until(() => host.saved().subscriptionCliMoved?.['openai-codex'] === true, { label: 'the codex move ran' })
  const state = host.saved()
  assert.equal(state.bots.a1.model, 'anthropic/claude-opus-5-5')
  assert.equal(state.bots.a1.subscriptionMoved, undefined)
  assert.equal(state.subscriptionCliMoved.anthropic, undefined)
  assert.equal(state.bots.c1.model, 'acp-codex/gpt-6.1-sol')
})

test('a Claude route on a key with no apiKeyEnv never moves: an environment key or a stored api-key record', async (t) => {
  for (const [label, options] of [
    ['an ANTHROPIC_API_KEY pi-ai finds', { keys: ['ANTHROPIC_API_KEY'] }],
    ['a stored api-key record', { records: { 'llm-pi-ai/anthropic': 'api-key' } }],
    ['nothing signed in', { records: {} }],
  ]) {
    const team = seed([bot('a1', 'anthropic/claude-opus-5-5'), bot('c1', 'openai-codex/gpt-6.1-sol')])
    const host = await start(team, options)
    t.after(host.stop)
    await until(() => host.saved().subscriptionCliMoved?.['openai-codex'] === true, { label: `the codex move ran (${label})` })
    await host.rt.moveSubscriptionBots()
    const state = host.saved()
    assert.equal(state.bots.a1.model, 'anthropic/claude-opus-5-5', label)
    assert.equal(state.bots.a1.subscriptionMoved, undefined, label)
    assert.equal(state.subscriptionCliMoved.anthropic, undefined, label)
  }
})

test('a Codex catalog not read yet (only its default) moves no one and marks nothing; the real catalog moves to the same model', async (t) => {
  const team = seed([bot('c1', 'openai-codex/gpt-6.1-sol', { effort: 'high' })])
  const host = await start(team, { catalog: { 'acp-codex': [{ id: 'default' }] } })
  t.after(host.stop)
  await host.rt.moveSubscriptionBots()
  assert.equal(host.saved().bots.c1.model, 'openai-codex/gpt-6.1-sol')
  assert.equal(host.saved().bots.c1.subscriptionMoved, undefined)
  assert.equal(host.saved().subscriptionCliMoved?.['openai-codex'], undefined)
  host.models['acp-codex'] = [{ id: 'default' }, { id: 'gpt-6.1-sol' }]
  host.ctx.emit('llm/adapters-updated', {})
  await until(() => host.saved().subscriptionCliMoved?.['openai-codex'] === true, { label: 'the move ran once the catalog was read' })
  assert.equal(host.saved().bots.c1.model, 'acp-codex/gpt-6.1-sol')
  assert.equal(host.saved().bots.c1.effort, 'high')
})

// The subscription move already ran for this team (it marks a route done even when no Bot is
// on it), so only the ACP rollback can still change these Bots.
const DONE = { subscriptionCliMoved: { anthropic: true, 'openai-codex': true } }

test('the Claude Code route gone: the ACP rollback never puts a Claude plan Bot back on the anthropic sign-in route', async (t) => {
  const record = { from: { model: 'anthropic/claude-opus-5-5' }, target: 'acp-claude/opus' }
  const team = seed([bot('a1', 'acp-claude/opus', { claudeCodeModel: 'claude-code/opus', acpMoved: record })], { claudeAcpMoved: true, ...DONE })
  // No acpAgents service and no loader entry: acp-adoption reads the route as gone.
  const host = await start(team, { providers: ['deepseek', 'anthropic', 'acp-claude'] })
  t.after(host.stop)
  await until(() => host.saved().claudeAcpMoved === undefined, { label: 'the rollback ran' })
  const { bots } = host.saved()
  assert.equal(bots.a1.model, 'acp-claude/opus')
  assert.equal(bots.a1.acpMoved, undefined)
})

test('dshTools off: a Claude plan Bot the subscription move took stays on Claude Code', async (t) => {
  const team = seed([bot('a1', 'acp-claude/opus', {
    claudeCodeModel: 'claude-code/opus',
    subscriptionMoved: { from: { model: 'anthropic/claude-opus-5-5' }, target: 'acp-claude/opus' },
  })], { claudeAcpMoved: true, ...DONE })
  const acpAgents = { bridge: async () => ({ on: false }), status: async () => ({ agents: [] }) }
  const host = await start(team, { services: { acpAgents } })
  t.after(host.stop)
  await until(() => host.saved().claudeAcpMoved === undefined, { label: 'the rollback ran' })
  const { bots } = host.saved()
  assert.equal(bots.a1.model, 'acp-claude/opus')
  assert.equal(bots.a1.acpMoved, undefined)
})

test('with a key on the anthropic route, the ACP rollback still restores the key model', async (t) => {
  const record = { from: { model: 'anthropic/claude-opus-5-5' }, target: 'acp-claude/opus' }
  const team = seed([bot('a1', 'acp-claude/opus', { claudeCodeModel: 'claude-code/opus', acpMoved: record })], { claudeAcpMoved: true })
  const host = await start(team, { providers: ['deepseek', 'anthropic', 'acp-claude'], pi: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } } })
  t.after(host.stop)
  await until(() => host.saved().bots.a1.model === 'anthropic/claude-opus-5-5', { label: 'the rollback restored the key model' })
  assert.equal(host.saved().subscriptionCliMoved?.anthropic, undefined)
})

test('a Claude route DSH settings cannot show is left alone', async (t) => {
  const team = seed([bot('a1', 'anthropic/claude-opus-5-5')])
  const host = await start(team, { pi: null })
  t.after(host.stop)
  await host.rt.moveSubscriptionBots()
  assert.equal(host.saved().bots.a1.model, 'anthropic/claude-opus-5-5')
  assert.equal(host.saved().subscriptionCliMoved?.anthropic, undefined)
})

test('nothing moves until the CLI route is registered, then it moves on the adapters event', async (t) => {
  const team = seed([bot('c1', 'openai-codex/gpt-6.1-sol')])
  const host = await start(team, { providers: ['deepseek', 'openai-codex'] })
  t.after(host.stop)
  await host.rt.moveSubscriptionBots()
  assert.equal(host.saved().bots.c1.model, 'openai-codex/gpt-6.1-sol')
  assert.equal(host.saved().subscriptionCliMoved, undefined)
  host.routes.list.push('acp-codex')
  host.ctx.emit('llm/adapters-updated', {})
  await until(() => host.saved().bots.c1.model === 'acp-codex/gpt-6.1-sol', { label: 'the move ran once the route came' })
})

test('the move is done once: a team already moved keeps a later subscription pick', async (t) => {
  const team = seed([bot('c1', 'openai-codex/gpt-6.1-sol')], { subscriptionCliMoved: { 'openai-codex': true, anthropic: true } })
  const host = await start(team)
  t.after(host.stop)
  await host.rt.moveSubscriptionBots()
  await host.rt.moveSubscriptionBots()
  assert.equal(host.saved().bots.c1.model, 'openai-codex/gpt-6.1-sol')
  assert.equal(host.saved().bots.c1.subscriptionMoved, undefined)
})

test('a second pass changes nothing after the first', async (t) => {
  const team = seed([bot('c1', 'openai-codex/gpt-6.1-sol')])
  const host = await start(team)
  t.after(host.stop)
  await until(() => host.saved().subscriptionCliMoved?.['openai-codex'] === true, { label: 'the move ran' })
  const before = host.saved()
  await host.rt.moveSubscriptionBots()
  const after = host.saved()
  assert.equal(after.bots.c1.model, 'acp-codex/gpt-6.1-sol')
  assert.deepEqual(after.subscriptionCliMoved, before.subscriptionCliMoved)
  assert.deepEqual(after.bots.c1.subscriptionMoved, before.bots.c1.subscriptionMoved)
})

// The move, the model menu (providers.js routeAuth) and Connect AI (through
// omniTeam.anthropicSubscription) read anthropic's route by one rule: they never disagree.
test('the move and the model menu agree on whether anthropic\'s route is the Claude plan', async () => {
  const { anthropicSubscription } = await import('../src/host/subscription-move.js')
  const { install: installProviders } = await import('../src/host/providers.js')
  for (const [records, keys, plan] of [
    [{ 'llm-pi-ai/anthropic': 'grant' }, [], true],
    [{ 'llm-pi-ai/anthropic': 'grant' }, ['ANTHROPIC_API_KEY'], false],
    [{ 'llm-pi-ai/anthropic': 'api-key' }, [], false],
    [{}, ['ANTHROPIC_API_KEY'], false],
  ]) {
    const services = { settings: piSettings({ anthropic: {} }), credentials: fakeCredentials({ records, keys }) }
    const ctx = {
      get: name => services[name],
      llm: { listConfigurableProviders: () => [{ provider: 'anthropic', displayName: 'Anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], nativeAuth: { env: ['ANTHROPIC_API_KEY'], oauth: true } }] },
    }
    const rt = { ctx, state: { bots: {} } }
    installProviders(rt)
    const why = JSON.stringify([records, keys])
    assert.equal(await anthropicSubscription(ctx), plan, why)
    assert.equal((await rt.routeAuth(['anthropic'])).get('anthropic').via, plan ? 'signin' : 'key', why)
  }
})
