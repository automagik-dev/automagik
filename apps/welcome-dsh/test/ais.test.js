import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COVERED, OLLAMA_KEY_REF, SUBSCRIPTION_ONLY, VENDORS } from '../src/host/ais.js'
import { install } from '../src/host/endpoint.js'
import { fakeContext } from './fake-ctx.js'

const SECRET = 'sk-never-leaves-0123456789'
const offline = async () => { throw new Error('offline') }

// DSH's authorization service, offering the sign-ins pi-ai registers here.
const flows = (keys = ['llm-pi-ai/anthropic', 'llm-pi-ai/openai-codex']) => ({ describe: key => (keys.includes(key) ? { key, label: key, methods: [{ id: 'oauth' }] } : undefined) })

function host({ providers = {}, entries = {}, fetch = offline, services = {}, ...rest } = {}) {
  const fake = fakeContext({ entries: { 'omni-ai': {}, 'llm-pi-ai': { providers }, ...entries }, services: { authorization: flows(), ...services }, ...rest })
  const { handle } = install(fake.ctx, { fetch })
  const rows = async () => (await handle('ais')).value
  const row = async id => (await rows()).rows.find(item => item.id === id)
  return { ...fake, handle, rows, row }
}

test('one row per AI, and no row reaches a vendor another row already covers', () => {
  const ids = VENDORS.map(vendor => vendor.id)
  assert.deepEqual(ids, ['claude', 'chatgpt', 'deepseek', 'kimi', 'copilot', 'grok', 'openai', 'openrouter', 'zai', 'moonshot', 'opencode', 'cliproxy', 'ollama'])
  // Claude is pi-ai's anthropic route, signed in or on a key: one row, no Anthropic API row beside it.
  assert.deepEqual(VENDORS.find(vendor => vendor.id === 'claude'), { id: 'claude', name: 'Claude', via: 'Your Claude Pro or Max plan, or an Anthropic API key', kind: 'signin', provider: 'anthropic', envRefs: ['ANTHROPIC_API_KEY'], keyUrl: 'https://console.anthropic.com/settings/keys' })
  assert.equal(VENDORS.filter(vendor => vendor.provider === 'anthropic').length, 1)
  // pi-ai's own DeepSeek route is not offered: DeepSeek is DSH's key and account.
  assert.ok(!VENDORS.some(vendor => vendor.provider === 'deepseek' && vendor.route !== false))
  // The dsh-subscriptions vendors Omni offers are only the ones nothing else covers.
  for (const vendor of Object.keys(COVERED)) assert.ok(!SUBSCRIPTION_ONLY.includes(vendor), vendor)
})

test('what this computer has is found: names and states only, never a key', async () => {
  const fake = host({
    providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' }, anthropic: {} },
    credentials: { OPENAI_API_KEY: SECRET },
    env: { DEEPSEEK_API_KEY: SECRET, XAI_API_KEY: SECRET },
    records: ['llm-pi-ai/kimi-coding', 'llm-pi-ai/anthropic'],
    fetch: async url => (String(url).endsWith('/api/tags') ? new Response('{"models":[]}') : new Response('', { status: 404 })),
  })
  const reply = await fake.rows()
  assert.ok(!JSON.stringify(reply).includes(SECRET))
  const by = Object.fromEntries(reply.rows.map(row => [row.id, row]))
  assert.deepEqual([by.claude.found, by.claude.on, by.claude.signIn], ['Signed in to Claude', true, true])
  assert.deepEqual([by.deepseek.found, by.deepseek.on], ['DEEPSEEK_API_KEY found', true])
  assert.deepEqual([by.openai.found, by.openai.on], ['Key saved', true])
  // Signed in but no route: ready, not on until switched.
  assert.deepEqual([by.kimi.found, by.kimi.ready, by.kimi.on], ['Signed in to Kimi', true, false])
  assert.deepEqual([by.grok.found, by.grok.ready, by.grok.on], ['XAI_API_KEY found', true, false])
  assert.deepEqual([by.ollama.found, by.ollama.ready, by.ollama.on], ['Running on this computer', true, false])
  assert.deepEqual([by.openrouter.found, by.openrouter.ready], [null, false])
})

test('Claude signs in through pi-ai\'s anthropic flow and runs on it with a route that names no key', async () => {
  // Not signed in, no key: not set up, the page opens the sign-in, and on is refused.
  const fresh = host()
  const before = await fresh.row('claude')
  assert.deepEqual([before.ready, before.on, before.signIn, before.keyUrl], [false, false, true, 'https://console.anthropic.com/settings/keys'])
  assert.equal((await fresh.handle('ai-switch', { id: 'claude', on: true })).error.code, 'omni-ai/refused')
  assert.equal(fresh.valueOf('llm-pi-ai').providers.anthropic, undefined)
  // Signed in (the record llm-pi-ai/anthropic): on writes a route that names no key, and does
  // not retry the plan's 429 (SIGNIN_ROUTES), also after off and on again.
  const fake = host({ records: ['llm-pi-ai/anthropic'] })
  assert.deepEqual([(await fake.row('claude')).ready, (await fake.row('claude')).on], [true, false])
  assert.equal((await fake.handle('ai-switch', { id: 'claude', on: true })).value.on, true)
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.anthropic, { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] } })
  // Turning it on again (the page's dedupe after a sign-in) never takes the route away.
  await fake.handle('ai-dedupe', { id: 'claude' })
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.anthropic, { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] } })
  assert.equal((await fake.row('claude')).duplicates, undefined)
  assert.equal((await fake.handle('ai-switch', { id: 'claude', on: false })).value.on, false)
  assert.equal(fake.valueOf('llm-pi-ai').providers.anthropic, undefined)
  assert.equal((await fake.row('claude')).ready, true)
  assert.equal((await fake.handle('ai-switch', { id: 'claude', on: true })).value.on, true)
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.anthropic, { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] } })
})

test('Claude on an Anthropic API key: the same row, on the key the route names', async () => {
  const saved = host({ providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } }, credentials: { ANTHROPIC_API_KEY: SECRET } })
  assert.deepEqual([(await saved.row('claude')).found, (await saved.row('claude')).on], ['Key saved', true])
  const fromEnv = host({ env: { ANTHROPIC_API_KEY: SECRET } })
  assert.deepEqual([(await fromEnv.row('claude')).found, (await fromEnv.row('claude')).on], ['ANTHROPIC_API_KEY found', false])
  assert.equal((await fromEnv.handle('ai-switch', { id: 'claude', on: true })).value.on, true)
  assert.deepEqual(fromEnv.valueOf('llm-pi-ai').providers.anthropic, { apiKeyEnv: 'ANTHROPIC_API_KEY' })
  // A route left on a key that is gone is off; signed in, on moves it to the sign-in.
  const stale = host({ providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', reasoning: 'high' } }, records: ['llm-pi-ai/anthropic'] })
  assert.equal((await stale.row('claude')).on, false)
  assert.equal((await stale.handle('ai-switch', { id: 'claude', on: true })).value.on, true)
  assert.deepEqual(stale.valueOf('llm-pi-ai').providers.anthropic, { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] }, reasoning: 'high' })
  // A route a sign-in made, turned on with a key instead: the key's route, with DSH's retries.
  const signedOut = host({ providers: { anthropic: { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] } } }, env: { ANTHROPIC_API_KEY: SECRET } })
  assert.equal((await signedOut.handle('ai-switch', { id: 'claude', on: true })).value.on, true)
  assert.deepEqual(signedOut.valueOf('llm-pi-ai').providers.anthropic, { apiKeyEnv: 'ANTHROPIC_API_KEY' })
  assert.ok(!JSON.stringify([saved.updates, fromEnv.updates, stale.updates, signedOut.updates]).includes(SECRET))
})

test('off stops using an AI and keeps its key or sign-in; on brings it back', async () => {
  const fake = host({ credentials: { OPENROUTER_API_KEY: SECRET }, records: ['llm-pi-ai/openai-codex'] })
  // A key: on writes the route that names it, off removes the route only.
  assert.equal((await fake.handle('ai-switch', { id: 'openrouter', on: true })).value.on, true)
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.openrouter, { apiKeyEnv: 'OPENROUTER_API_KEY' })
  assert.equal((await fake.handle('ai-switch', { id: 'openrouter', on: false })).value.on, false)
  assert.equal(fake.valueOf('llm-pi-ai').providers.openrouter, undefined)
  assert.equal(fake.secrets.get('OPENROUTER_API_KEY'), SECRET)
  // A sign-in: the route names no key, so it runs on the sign-in.
  assert.equal((await fake.handle('ai-switch', { id: 'chatgpt', on: true })).value.on, true)
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers['openai-codex'], {})
  assert.equal((await fake.handle('ai-switch', { id: 'chatgpt', on: false })).value.on, false)
  assert.equal((await fake.row('chatgpt')).ready, true)
  // What is not set up is refused, and nothing is written for it.
  assert.equal((await fake.handle('ai-switch', { id: 'openai', on: true })).error.code, 'omni-ai/refused')
  assert.equal(fake.valueOf('llm-pi-ai').providers.openai, undefined)
  assert.equal((await fake.handle('ai-switch', { id: 'nope', on: true })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('ai-switch', { id: 'openrouter' })).error.code, 'omni-ai/invalid')
})

test('an environment key turns on by naming its variable; DeepSeek, DSH\'s own route, cannot be switched off here', async () => {
  const fake = host({ env: { OPENAI_API_KEY: SECRET, DEEPSEEK_API_KEY: SECRET } })
  await fake.handle('ai-switch', { id: 'openai', on: true })
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.openai, { apiKeyEnv: 'OPENAI_API_KEY' })
  assert.equal((await fake.handle('ai-switch', { id: 'deepseek', on: false })).error.code, 'omni-ai/refused')
  assert.ok(!JSON.stringify(fake.updates).includes(SECRET))
})

test('Ollama on lists its models into a local route; off removes the route', async () => {
  const fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) return new Response('{"models":[]}')
    if (String(url).endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen2.5-coder' }, { id: 'llama3.2' }] }))
    return new Response('', { status: 404 })
  }
  const fake = host({ fetch })
  assert.equal((await fake.handle('ai-switch', { id: 'ollama', on: true })).value.on, true)
  const route = fake.valueOf('llm-pi-ai').providers.ollama
  assert.deepEqual([route.baseURL, route.apiKeyEnv, route.models.map(model => model.id)], ['http://127.0.0.1:11434/v1', OLLAMA_KEY_REF, ['qwen2.5-coder', 'llama3.2']])
  await fake.handle('ai-switch', { id: 'ollama', on: false })
  assert.equal(fake.valueOf('llm-pi-ai').providers.ollama, undefined)
  // Not running: not set up, and turning it on is refused.
  assert.equal((await host().handle('ai-switch', { id: 'ollama', on: true })).error.code, 'omni-ai/refused')
})

const subsEntry = (slots, hiddenModels = []) => ({ 'dsh-subscriptions': { slots, hiddenModels } })
const llmWith = models => ({ listProviders: () => [], listModels: async provider => models[provider] ?? [] })

test('turning Claude on hides dsh-subscriptions\' Claude, deletes none of its accounts, and keeps Claude\'s route', async () => {
  const fake = host({
    providers: { anthropic: {} },
    records: ['llm-pi-ai/anthropic'],
    entries: subsEntry([{ provider: 'claude', index: 1 }, { provider: 'cursor', index: 1 }]),
    credentials: { CLAUDE_OAUTH_1: SECRET, CURSOR_OAUTH_1: SECRET },
    services: { llm: llmWith({ claude: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }], cursor: [{ id: 'auto' }] }) },
  })
  const before = await fake.row('claude')
  assert.deepEqual(before.duplicates.map(duplicate => [duplicate.via, duplicate.provider, duplicate.hidden]), [['dsh-subscriptions', 'claude', false]])
  await fake.handle('ai-switch', { id: 'claude', on: true })
  const subs = fake.valueOf('dsh-subscriptions')
  assert.deepEqual(subs.hiddenModels, [{ provider: 'claude', id: 'claude-opus-5-5' }, { provider: 'claude', id: 'claude-sonnet-5-5' }])
  // The accounts stay: their slots and credentials are untouched, cursor's models too.
  assert.deepEqual(subs.slots, [{ provider: 'claude', index: 1 }, { provider: 'cursor', index: 1 }])
  assert.equal(fake.secrets.get('CLAUDE_OAUTH_1'), SECRET)
  // Claude's own route is the row's, never a duplicate of it.
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.anthropic, { retryPolicy: { mode: 'normal', retryableCodes: ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT'] } })
  const after = await fake.row('claude')
  assert.equal(after.on, true)
  assert.deepEqual(after.duplicates.map(duplicate => duplicate.hidden), [true])
  assert.ok(!JSON.stringify(fake.updates).includes(SECRET))
})

test('a subscription only dsh-subscriptions has: off hides its models, on shows them again', async () => {
  const fake = host({
    entries: subsEntry([{ provider: 'cursor', index: 1 }, { provider: 'kiro', index: 1 }], [{ provider: 'kiro', id: 'x' }]),
    credentials: { CURSOR_OAUTH_1: SECRET },
    services: { llm: llmWith({ cursor: [{ id: 'auto' }, { id: 'gpt-5' }] }) },
  })
  // kiro has a slot but no credential: not an account.
  assert.deepEqual((await fake.rows()).subscriptions, { accounts: [{ provider: 'cursor', index: 1 }], hidden: [] })
  const off = (await fake.handle('ai-subscription', { provider: 'cursor', on: false })).value
  assert.deepEqual(off.subscriptions.hidden, ['cursor'])
  assert.deepEqual(fake.valueOf('dsh-subscriptions').hiddenModels, [{ provider: 'kiro', id: 'x' }, { provider: 'cursor', id: 'auto' }, { provider: 'cursor', id: 'gpt-5' }])
  await fake.handle('ai-subscription', { provider: 'cursor', on: true })
  assert.deepEqual(fake.valueOf('dsh-subscriptions').hiddenModels, [{ provider: 'kiro', id: 'x' }])
  assert.equal((await fake.handle('ai-subscription', { provider: 'kiro', on: true })).error.code, 'omni-ai/refused')
  // A covered vendor is not a subscription row.
  assert.equal((await fake.handle('ai-subscription', { provider: 'claude', on: false })).error.code, 'omni-ai/invalid')
  assert.equal((await host().handle('ai-subscription', { provider: 'cursor', on: false })).error.code, 'omni-ai/refused')
})
