// RFC 0003's route descriptor: every model the team lists carries { harness, connectedBy },
// computed from its provider id, so a Session stored on any existing id resolves unchanged.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/models.js'
import { CONNECTED_BY, HARNESSES, piAiRoutes, routeOf } from '../src/shared/routes.js'

test('each provider id has one route', () => {
  const piAi = piAiRoutes([{ provider: 'openai-codex', settingsNs: 'llm-pi-ai' }, { provider: 'deepseek', settingsNs: 'llm-deepseek' }])
  const cases = {
    deepseek: { harness: 'dsh', connectedBy: 'native' },
    'deepseek-account': { harness: 'dsh', connectedBy: 'native' },
    'openai-codex': { harness: 'dsh', connectedBy: 'pi-ai' },
    codex: { harness: 'dsh', connectedBy: 'pi-ai' },
    claude: { harness: 'dsh', connectedBy: 'pi-ai' },
    'claude-code': { harness: 'claude-code', connectedBy: 'claude-code-plugin' },
    'claude-code-devbox': { harness: 'claude-code', connectedBy: 'claude-code-plugin' },
    'acp-claude': { harness: 'claude-code', connectedBy: 'acp' },
    'acp-codex': { harness: 'codex', connectedBy: 'acp' },
    'acp-gemini': { harness: 'gemini', connectedBy: 'acp' },
    'somebody-elses-route': { harness: 'dsh', connectedBy: 'native' },
  }
  for (const [provider, route] of Object.entries(cases)) {
    assert.deepEqual(routeOf(provider, { piAi }), route, provider)
    assert.ok(CONNECTED_BY.includes(route.connectedBy))
  }
  for (const id of ['acp-claude', 'acp-codex', 'acp-gemini']) assert.ok(HARNESSES.includes(routeOf(id).harness))
  // Without a directory, dsh-subscriptions' own plans still read as pi-ai.
  assert.equal(routeOf('grok').connectedBy, 'pi-ai')
})

test('every model in the catalog carries its route, and nothing about the ref changes', async () => {
  const providers = { deepseek: [{ id: 'deepseek-v4-pro' }], 'openai-codex': [{ id: 'gpt-5.5' }], 'claude-code': [{ id: 'opus' }], 'acp-claude': [{ id: 'default' }] }
  const ctx = {
    llm: {
      listProviders: () => Object.keys(providers).map(id => ({ id })),
      listModels: async id => providers[id],
      listConfigurableProviders: () => [{ provider: 'openai-codex', settingsNs: 'llm-pi-ai' }],
    },
    get: () => undefined,
  }
  const rt = { ctx, state: { bots: {} } }
  install(rt)
  const entries = await rt.catalog()
  assert.deepEqual(entries.map(entry => [entry.ref, entry.route.connectedBy, entry.route.harness]), [
    ['deepseek/deepseek-v4-pro', 'native', 'dsh'],
    ['openai-codex/gpt-5.5', 'pi-ai', 'dsh'],
    ['claude-code/opus', 'claude-code-plugin', 'claude-code'],
    ['acp-claude/default', 'acp', 'claude-code'],
  ])
  assert.equal(await rt.resolveModel('claude-code/opus'), 'claude-code/opus')
})

test('a DSH without the directory still lists every model', async () => {
  const ctx = { llm: { listProviders: () => [{ id: 'deepseek' }], listModels: async () => [{ id: 'v4' }], listConfigurableProviders: () => { throw new Error('no directory') } }, get: () => undefined }
  const rt = { ctx, state: { bots: {} } }
  install(rt)
  assert.deepEqual((await rt.catalog()).map(entry => entry.route), [{ harness: 'dsh', connectedBy: 'native' }])
})

test('a Bot that ran on the Claude Code plugin moves on to acp-claude once ACP serves it, unless repicked', async () => {
  const providers = { anthropic: [{ id: 'claude-opus-5-5' }] }
  const ctx = { llm: { listProviders: () => Object.keys(providers).map(id => ({ id })), listModels: async id => providers[id], listConfigurableProviders: () => [] }, get: () => undefined }
  const state = {
    bots: {
      a: { id: 'a', name: 'A', claudeCodeModel: 'claude-code/opus', model: 'anthropic/claude-opus-5-5', appliedModel: 'anthropic/claude-opus-5-5' },
      b: { id: 'b', name: 'B', claudeCodeModel: 'claude-code/opus', model: 'deepseek/v4' },
      c: { id: 'c', name: 'C', model: 'anthropic/claude-opus-5-5' },
    },
  }
  let saves = 0
  const rt = { ctx, state, save: async () => { saves++ } }
  install(rt)
  // No claude CLI here: acp-claude is not served, nothing moves, and the move stays pending.
  await rt.moveToAcpClaude()
  assert.equal(state.bots.a.model, 'anthropic/claude-opus-5-5')
  assert.equal(state.acpClaudeMoved, undefined)
  providers['acp-claude'] = [{ id: 'default', name: 'Claude Code' }]
  rt.dropCatalog()
  await rt.moveToAcpClaude()
  assert.equal(state.bots.a.model, 'acp-claude/default')
  assert.equal(state.bots.a.appliedModel, undefined)
  assert.equal(state.bots.a.claudeCodeModel, 'claude-code/opus')
  assert.equal(state.bots.b.model, 'deepseek/v4', 'a Bot the person moved since stays')
  assert.equal(state.bots.c.model, 'anthropic/claude-opus-5-5', 'a Bot that was never on Claude Code stays')
  assert.equal(state.acpClaudeMoved, true)
  // Once: a Bot moved back by hand is not moved again.
  state.bots.a.model = 'anthropic/claude-opus-5-5'
  await rt.moveToAcpClaude()
  assert.equal(state.bots.a.model, 'anthropic/claude-opus-5-5')
  assert.ok(saves >= 1)
})
