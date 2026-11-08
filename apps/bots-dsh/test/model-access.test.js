import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install as installModels } from '../src/host/models.js'
import { install as installProviders } from '../src/host/providers.js'

function setup({ provider = 'test-provider', profile = { apiKeyEnv: 'TEST_KEY' }, auth, configured = false, account = false, agent } = {}) {
  const calls = []
  const services = {
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { [provider]: profile } } }] },
    credentials: {
      describe: async ref => { calls.push(['describe', ref]); return { configured, writable: true } },
      describeRecord: async ref => { calls.push(['record', ref]); return { configured: account } },
      get: () => assert.fail('Never read a credential value'),
      resolve: () => assert.fail('Never resolve a credential value'),
    },
    acpAgents: { inspect: async id => { calls.push(['inspect', id]); return agent } },
  }
  const ctx = {
    get: name => services[name],
    llm: {
      listProviders: () => [{ id: provider }],
      listModels: async () => [{ id: 'model' }],
      listConfigurableProviders: () => [{ provider, displayName: 'Test provider', settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider], ...(auth ? { nativeAuth: auth } : {}) }],
    },
  }
  const rt = { ctx, state: { bots: {} }, save: async () => { calls.push(['save']) } }
  installModels(rt)
  installProviders(rt)
  return { rt, calls, services, ref: `${provider}/model` }
}

test('missing keys deny exact and named choices without remembering providers or reading secrets', async () => {
  const { rt, ref, calls } = setup()
  const access = await rt.modelAccess(ref)
  assert.deepEqual(access, { ref, provider: 'test-provider', ready: false, status: 'missing-key', message: 'Save an API key for this provider before changing models.', recovery: { kind: 'api-key', provider: 'test-provider' } })
  for (const choice of [ref, 'model']) {
    await assert.rejects(rt.resolveModel(choice, { remember: false, checkAccess: true }), error => error.code === 'bot/model-access' && error.access.status === 'missing-key')
  }
  assert.equal(rt.state.providersSeen, undefined)
  assert.equal(calls.some(([name]) => name === 'save'), false)
})

test('readiness is checked afresh and never saves the team, even for a usable model', async () => {
  const { rt, ref, services, calls } = setup({ configured: true })
  assert.equal((await rt.modelAccess(ref)).ready, true)
  services.credentials.describe = async () => ({ configured: false })
  assert.equal((await rt.modelAccess(ref)).status, 'missing-key')
  assert.equal(rt.state.providersSeen, undefined)
  assert.equal(calls.some(([name]) => name === 'save'), false)
})

test('an explicit missing API key cannot be bypassed by a native account', async () => {
  const { rt, ref } = setup({ account: true, auth: { env: [], oauth: true } })
  assert.equal((await rt.modelAccess(ref)).status, 'missing-key')
})

test('native auth accepts stored and launch-environment keys through DSH presence metadata', async () => {
  const nativeRef = 'AUTOMAGIK_TEST_NATIVE_STORED_API_KEY'
  assert.equal(process.env[nativeRef], undefined)
  for (const source of ['file', 'env', 'project-env', 'user-env']) {
    const { rt, ref, services } = setup({ profile: {}, auth: { env: [nativeRef], oauth: false } })
    const checked = []
    services.credentials.describe = async name => { checked.push(name); return { configured: name === nativeRef, source, writable: true } }
    assert.equal((await rt.modelAccess(ref)).ready, true, source)
    assert.deepEqual(checked, [nativeRef])
  }
})

test('Anthropic identifiers alone cannot replace a key, token or complete federation identity', async () => {
  const env = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_IDENTITY_TOKEN_FILE', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID']
  const { rt, ref, services } = setup({ provider: 'anthropic', profile: {}, auth: { env, oauth: true } })
  let configured = new Set()
  services.credentials.describe = async name => ({ configured: configured.has(name) })
  for (const names of [
    ['ANTHROPIC_WORKSPACE_ID'], ['ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID'],
    ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID'],
  ]) {
    configured = new Set(names)
    assert.equal((await rt.modelAccess(ref)).status, 'sign-in-required')
  }
  for (const names of [
    ['ANTHROPIC_AUTH_TOKEN'], ['ANTHROPIC_OAUTH_TOKEN'], ['ANTHROPIC_API_KEY'],
    ['ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_IDENTITY_TOKEN_FILE'],
  ]) {
    configured = new Set(names)
    assert.equal((await rt.modelAccess(ref)).ready, true)
  }
})

test('Cloudflare native authentication needs its key and complete account or gateway configuration', async () => {
  for (const provider of ['cloudflare-workers-ai', 'cloudflare-ai-gateway']) {
    const env = ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', ...(provider === 'cloudflare-ai-gateway' ? ['CLOUDFLARE_GATEWAY_ID'] : [])]
    const { rt, ref, services } = setup({ provider, profile: {}, auth: { env, oauth: false } })
    let configured = new Set()
    services.credentials.describe = async name => ({ configured: configured.has(name) })
    for (const absent of env) {
      configured = new Set(env.filter(name => name !== absent))
      assert.equal((await rt.modelAccess(ref)).status, 'missing-key', `${provider}: missing ${absent}`)
    }
    configured = new Set(env)
    assert.equal((await rt.modelAccess(ref)).ready, true)
  }
})

test('native accounts and API keys are distinguished; cloud credential chains remain available', async () => {
  const missing = setup({ profile: {}, auth: { env: ['AUTOMAGIK_TEST_UNUSED_API_KEY'], oauth: false } })
  assert.equal((await missing.rt.modelAccess(missing.ref)).status, 'missing-key')
  const signedOut = setup({ profile: {}, auth: { env: [], oauth: true } })
  assert.equal((await signedOut.rt.modelAccess(signedOut.ref)).status, 'sign-in-required')
  const signedIn = setup({ profile: {}, auth: { env: [], oauth: true }, account: true })
  assert.equal((await signedIn.rt.modelAccess(signedIn.ref)).ready, true)
  for (const provider of ['amazon-bedrock', 'google-vertex']) {
    const cloud = setup({ provider, profile: {}, auth: { env: ['AUTOMAGIK_TEST_UNUSED_API_KEY'], oauth: false } })
    assert.equal((await cloud.rt.modelAccess(cloud.ref)).ready, true)
  }
})

test('ACP switching checks only the chosen CLI freshly, and fails closed on unknown sign-in', async () => {
  const agent = { id: 'acp-codex', on: true, cli: { found: true }, connector: { state: 'ready' }, signedIn: true }
  const { rt, ref, calls } = setup({ provider: agent.id, agent })
  assert.equal((await rt.modelAccess(ref)).ready, true)
  agent.signedIn = false
  assert.deepEqual((await rt.modelAccess(ref)).recovery, { kind: 'sign-in', provider: agent.id, agent: agent.id })
  assert.equal((await rt.modelAccess(ref)).status, 'sign-in-required')
  delete agent.signedIn
  assert.equal((await rt.modelAccess(ref)).status, 'unknown')
  agent.cli.found = false
  assert.equal((await rt.modelAccess(ref)).status, 'not-installed')
  agent.cli.found = true
  agent.connector.state = 'installing'
  assert.equal((await rt.modelAccess(ref)).status, 'unavailable')
  assert.ok(calls.filter(([name]) => name === 'inspect').every(([, id]) => id === agent.id))
  assert.equal(calls.some(([name]) => name === 'save'), false)
})

test('unavailable models and failed status probes expose no adapter diagnostic or credential', async () => {
  const { rt, ref, services } = setup({ configured: true })
  assert.equal((await rt.modelAccess('test-provider/gone')).status, 'unavailable')
  services.credentials.describe = async () => { throw new Error('secret request token=do-not-expose') }
  const access = await rt.modelAccess(ref)
  assert.equal(access.status, 'unknown')
  assert.equal(JSON.stringify(access).includes('do-not-expose'), false)
})
