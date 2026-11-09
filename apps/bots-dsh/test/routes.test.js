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
  // dsh-subscriptions no longer ships codex or claude: those plans are their CLIs' (acp-*).
  for (const id of ['codex', 'claude']) assert.equal(routeOf(id).connectedBy, 'native', id)
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
