import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createRuntime } from '../index.js'
import { createAgentRedactor } from '../src/host/agent-redaction.js'
import { fakeContext } from './fake-ctx.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'agent-redaction-'))
  const keys = new Map([['FIXTURE_PROVIDER_KEY', 'fixture-provider-credential-1093']])
  const records = new Map()
  let configuredSecret = 'fixture-settings-password-1093'
  const services = {
    credentials: {
      resolve: async ref => keys.has(ref) ? { value: keys.get(ref), source: 'file' } : undefined,
      describe: async ref => ({ configured: keys.has(ref), writable: true }),
      listRecords: async () => [...records].map(([key, record]) => ({ key, kind: record.kind })),
      readRecord: async key => records.get(key),
    },
    settings: { describe: ({ redactSecrets } = {}) => [{
      ns: 'llm-fixture', revision: 0, schema: {},
      value: { apiKeyEnv: 'FIXTURE_PROVIDER_KEY',
        ...(redactSecrets ? {} : { password: configuredSecret }) },
      ...(redactSecrets ? { secrets: [{ path: ['password'], set: true }] } : {}),
    }] },
  }
  const ctx = fakeContext({ services })
  ctx.llm = {
    listProviders: () => [], listModels: async () => [],
    listConfigurableProviders: () => [{ provider: 'fixture', settingsNs: 'llm-fixture',
      settingsPath: [], nativeAuth: { env: ['FIXTURE_NATIVE_KEY'] } }],
  }
  ctx.workspaceRegistry = { get: () => ({ id: 'w', path: home }) }
  ctx.sessions = { flush: async () => {} }
  ctx.sessionController = { selectModel: async () => {} }
  await writeFile(join(home, 'state.json'), JSON.stringify({ version: 1, revision: 1,
    mainBotIds: ['a'], workspaceId: 'w', bots: {
      a: { id: 'a', name: 'Alpha', instructions: 'Help', capabilities: [] },
    }, rooms: {}, agents: {}, exchanges: [] }))
  const rt = createRuntime(ctx, { home, memory: false, browser: false, updateCheck: false })
  await rt.load()
  const { token } = await rt.agentAccess.owner('create', { name: 'Credential regression' })
  const { url } = await rt.agentAccess.owner('view')
  const client = new Client({ name: 'credential-regression', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }))
  t.after(async () => {
    await client.close()
    await ctx.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const tool = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args })
    assert.equal(result.isError, false)
    return JSON.parse(result.content[0].text)
  }
  return { rt, home, keys, records, ctx, tool,
    setConfiguredSecret: value => { configuredSecret = value } }
}

const absent = (value, secrets) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of secrets) assert.equal(text.includes(secret), false,
    'a planted credential crossed the MCP/audit boundary')
}

const plantEnv = (t, entries) => {
  const previous = new Map(Object.keys(entries).map(name => [name, process.env[name]]))
  for (const [name, value] of Object.entries(entries)) process.env[name] = value
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

test('provider credentials in chat, configuration, arguments and audit are redacted', async t => {
  const { rt, home, keys, tool } = await fixture(t)
  const credential = keys.get('FIXTURE_PROVIDER_KEY')
  rt.chatPage = async () => ({ items: [{ kind: 'user', seq: 1,
    text: `Pasted ${credential}`, time: 1 }], cursor: null })
  absent(await tool('read_messages', { id: 'a' }), [credential])
  rt.state.bots.a.instructions = `Before ${credential}`
  absent(await tool('get_bot', { id: 'a' }), [credential])
  absent(await tool('list_bots'), [credential])
  await tool('update_bot', { id: 'a', instructions: `After ${credential}` })
  absent(rt.state.bots.a.instructions, [credential])
  const audit = await readFile(join(home, 'agent-audit.jsonl'), 'utf8')
  absent(audit, [credential])
  const change = audit.trim().split('\n').map(JSON.parse)
    .findLast(row => row.changes?.bots?.a?.instructions).changes.bots.a.instructions
  assert.equal(change.before.includes('[secret:credential]'), true)
  assert.equal(change.after.includes('[secret:credential]'), true)
  absent(await tool('read_audit'), [credential])
})

test('rotated provider, native, record, settings and environment secrets refresh', async t => {
  const { rt, keys, records, tool, setConfiguredSecret } = await fixture(t)
  const envName = 'AUTOMAGIK_FIXTURE_API_KEY'
  const previous = process.env[envName]
  t.after(() => {
    if (previous === undefined) delete process.env[envName]
    else process.env[envName] = previous
  })
  const oldKey = keys.get('FIXTURE_PROVIDER_KEY')
  const refreshed = ['fixture-rotated-provider-1093', 'fixture-native-credential-1093',
    'fixture-record-api-key-1093', 'fixture-access-token-1093', 'fixture-refresh-token-1093',
    'fixture-new-settings-secret-1093', 'fixture-environment-credential-1093']
  keys.set('FIXTURE_PROVIDER_KEY', refreshed[0])
  keys.set('FIXTURE_NATIVE_KEY', refreshed[1])
  records.set('llm-fixture/key', { kind: 'api-key', key: refreshed[2] })
  records.set('llm-fixture/grant', { kind: 'grant', payload: {
    accessToken: refreshed[3], refreshToken: refreshed[4],
  } })
  setConfiguredSecret(refreshed[5])
  process.env[envName] = refreshed[6]
  const planted = [oldKey, ...refreshed]
  rt.chatPage = async () => ({ items: [{ kind: 'user', seq: 1,
    text: planted.join(' '), time: 1 }], cursor: null })
  absent(await tool('read_messages', { id: 'a' }), planted)
  rt.state.bots.a.instructions = planted.join(' ')
  rt.state.prefs.theme = planted.join(' ')
  absent(await tool('get_bot', { id: 'a' }), planted)
  absent(await tool('read_settings'), planted)
  await tool('update_bot', { id: 'a', instructions: planted.join(' ') })
  absent(await rt.agentAccess.history(), planted)
  // A key can rotate during the read itself; the response boundary refreshes too.
  rt.chatPage = async () => {
    keys.set('FIXTURE_PROVIDER_KEY', 'fixture-rotated-during-read-1093')
    return { items: [{ kind: 'user', text: keys.get('FIXTURE_PROVIDER_KEY'), seq: 1 }],
      cursor: null }
  }
  absent(await tool('read_messages', { id: 'a' }), [keys.get('FIXTURE_PROVIDER_KEY')])
})

test('central redactor cleans credential-bearing dictionary keys and escaped forms', async t => {
  const { rt, keys } = await fixture(t)
  const credential = 'fixture-key-with-quote-"-1093'
  keys.set('FIXTURE_PROVIDER_KEY', credential)
  const redaction = createAgentRedactor(rt)
  await redaction.refresh()
  const raw = { [credential]: [credential, JSON.stringify(credential).slice(1, -1),
    encodeURIComponent(credential)] }
  absent(redaction.clean(raw), [credential, JSON.stringify(credential).slice(1, -1),
    encodeURIComponent(credential)])
})

test('long provider credentials containing regex metacharacters are literal values', async t => {
  const { rt, keys } = await fixture(t)
  for (const credential of ['fixture+provider+1093', 'fixture.provider[1093]',
    'fixture(provider)?1093', 'fixture\\provider$1093']) {
    keys.set('FIXTURE_PROVIDER_KEY', credential)
    const redaction = createAgentRedactor(rt)
    await redaction.refresh()
    assert.equal(redaction.text(`Before ${credential} after`),
      'Before [secret:credential] after')
    assert.equal(redaction.text('Unrelated fixture-provider-1093'),
      'Unrelated fixture-provider-1093')
  }
})

test('short provider credentials containing regex metacharacters cannot throw or leak', async t => {
  const { rt, keys } = await fixture(t)
  for (const credential of ['(', '+', '[', '\\', 'a.b']) {
    keys.set('FIXTURE_PROVIDER_KEY', credential)
    const redaction = createAgentRedactor(rt)
    await redaction.refresh()
    assert.equal(redaction.text(`Before ${credential} after`),
      'Before [secret:credential] after')
    assert.equal(redaction.text('Unrelated text'), 'Unrelated text')
  }
})

const environmentCases = [
  ['PGPASSWORD', 'fixture-postgres-password-1093'],
  ['MYSQL_PWD', 'fixture-mysql-password-1093'],
  ['AUTOMAGIK_REVIEW_DB_PASS', 'fixture-database-pass-1093'],
  ['AUTOMAGIK_REVIEW_DATABASE_URL',
    'postgres://fixture:fixture-database-password-1093@database.invalid:5432/fixture'],
  ['AUTOMAGIK_REVIEW_CREDENTIALS', 'fixture-plural-credentials-1093'],
  ['AUTOMAGIK_REVIEW_ENDPOINT',
    'postgres://fixture:fixture-neutral-password-1093@database.invalid:5432/fixture'],
]

for (const [name, credential] of environmentCases) {
  test(`environment ${name} is redacted across SDK reads, arguments and audit`, async t => {
    const { rt, home, tool } = await fixture(t)
    const harmless = {
      AUTOMAGIK_REVIEW_COMPASS: 'fixture-readable-compass-1093',
      AUTOMAGIK_REVIEW_MONKEY: 'fixture-readable-monkey-1093',
      AUTOMAGIK_REVIEW_KEYBOARD: 'fixture-readable-keyboard-1093',
    }
    plantEnv(t, { [name]: credential, ...harmless })
    const readable = Object.values(harmless).join(' ')
    rt.chatPage = async () => ({ items: [{ kind: 'user', seq: 1,
      text: `Pasted ${credential} ${readable}`, time: 1 }], cursor: null })
    const messages = await tool('read_messages', { id: 'a' })
    absent(messages, [credential])
    assert.equal(messages.items[0].text, `Pasted [secret:credential] ${readable}`)
    rt.state.bots.a.instructions = `Before ${credential} ${readable}`
    rt.state.prefs.theme = credential
    absent(await tool('get_bot', { id: 'a' }), [credential])
    absent(await tool('list_bots'), [credential])
    absent(await tool('read_settings'), [credential])
    absent(await tool('update_bot', { id: 'a', instructions: `After ${credential} ${readable}` }),
      [credential])
    absent(rt.state.bots.a.instructions, [credential])
    assert.equal(rt.state.bots.a.instructions, `After [secret:credential] ${readable}`)
    const audit = await readFile(join(home, 'agent-audit.jsonl'), 'utf8')
    absent(audit, [credential])
    const change = audit.trim().split('\n').map(JSON.parse)
      .findLast(row => row.changes?.bots?.a?.instructions).changes.bots.a.instructions
    assert.equal(change.before, `Before [secret:credential] ${readable}`)
    assert.equal(change.after, `After [secret:credential] ${readable}`)
    absent(await tool('read_audit'), [credential])
  })
}

test('full credential words match prefixed and suffixed environment names', async t => {
  const { rt } = await fixture(t)
  const words = ['PASSWORD', 'PASSWD', 'PASSPHRASE', 'SECRET', 'TOKEN', 'CREDENTIAL',
    'CREDENTIALS', 'APIKEY', 'PRIVATEKEY']
  const names = words.flatMap(word => [word, `PREFIX${word}`, `${word}SUFFIX`,
    `PREFIX${word.toLowerCase()}SUFFIX`])
  const entries = Object.fromEntries(names.map((name, index) => [
    `AUTOMAGIK_REVIEW_${name}`, `fixture-full-credential-word-${index}-1093`,
  ]))
  plantEnv(t, entries)
  const redaction = createAgentRedactor(rt)
  await redaction.refresh()
  for (const credential of Object.values(entries)) {
    assert.equal(redaction.text(credential), '[secret:credential]')
  }
})

test('password name parts and password URLs refresh without masking harmless environment',
  async t => {
    const { rt } = await fixture(t)
    const redaction = createAgentRedactor(rt)
    await redaction.refresh()
    const secretNames = ['PASS', 'PASSWD', 'PASSWORD', 'PWD', 'CREDENTIAL', 'CREDENTIALS',
      'SECRET', 'SECRETS', 'TOKEN', 'TOKENS', 'KEY', 'KEYS', 'PRIVATE']
    const secretEntries = Object.fromEntries(secretNames.map(name => [
      `AUTOMAGIK_REVIEW_${name}_VALUE`, `fixture-env-${name.toLowerCase()}-value-1093`,
    ]))
    const harmless = {
      AUTOMAGIK_REVIEW_PATH: '/fixture/harmless/bin',
      AUTOMAGIK_REVIEW_HOME: '/fixture/harmless/home',
      AUTOMAGIK_REVIEW_PORT: '54321',
      AUTOMAGIK_REVIEW_ENABLED: 'true',
      AUTOMAGIK_REVIEW_DISABLED: 'false',
      AUTOMAGIK_REVIEW_COMPASS: 'fixture-harmless-compass-1093',
      AUTOMAGIK_REVIEW_MONKEY: 'fixture-harmless-monkey-1093',
      AUTOMAGIK_REVIEW_KEYBOARD: 'fixture-harmless-keyboard-1093',
      AUTOMAGIK_REVIEW_URL: 'postgres://fixture@database.invalid:5432/fixture',
    }
    plantEnv(t, { ...secretEntries, ...harmless,
      AUTOMAGIK_REVIEW_ADDRESS:
        'postgres://fixture:fixture%21escaped%3Apassword@database.invalid:5432/fixture',
    })
    await redaction.refresh()
    for (const credential of Object.values(secretEntries)) {
      assert.equal(redaction.text(credential), '[secret:credential]')
    }
    for (const value of Object.values(harmless)) assert.equal(redaction.text(value), value)
    for (const name of ['PATH', 'HOME', 'PWD', 'OLDPWD']) {
      const value = process.env[name]
      if (value !== undefined) assert.equal(redaction.text(value), value)
    }
    assert.equal(redaction.text('fixture%21escaped%3Apassword'), '[secret:credential]')
    assert.equal(redaction.text('fixture!escaped:password'), '[secret:credential]')
  })
