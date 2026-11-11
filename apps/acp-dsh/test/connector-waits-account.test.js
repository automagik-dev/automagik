// A connector that waits for the account record says so (#970, experience review 9). On a new
// install no connector is installed before the first-run account record is on disk (#869). When
// that record could not be written the install only logged a warning, and the status went on
// saying "installing" for good. It now says `failed` with the reason, so the settings page shows
// it with Retry, and a turn names it. Nothing is installed without the record, as before.
//
// Fakes only: no CLI runs, nothing is installed, the record lives in a temp folder and every
// identity is invented.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, SERVICE } from '../index.js'
import { AGENTS } from '../src/host/agents.js'
import { CONSENT_FILE, ConsentStore } from '../src/host/consent.js'
import { UNAVAILABLE } from '../src/host/image.js'
import { MODEL_ACCESS_REQUIRED } from '../src/host/names.js'

const CLAUDE = AGENTS['acp-claude']
const CODEX = AGENTS['acp-codex']
const WORK = { kind: 'account', id: 'claude\norg-work\nana@work.example', facets: { kind: 'account', email: 'ana@work.example', org: 'org-work' }, email: 'ana@work.example', org: 'Acme', plan: 'team' }
const CODEX_WORK = { kind: 'account', id: 'codex\nchatgpt\nana@work.example', facets: { kind: 'account', email: 'ana@work.example' }, email: 'ana@work.example', plan: 'business' }
const INSTALLED = { [CLAUDE.adapter]: { path: '/adapters/claude', version: '1' }, [CODEX.adapter]: { path: '/adapters/codex', version: '1' } }
const settle = async () => { for (let turn = 0; turn < 6; turn++) await new Promise(resolve => setImmediate(resolve)) }

/**
 * Where the account record goes, and a way to make it unwritable: `block()` puts a plain file
 * where the record's folder should be, `unblock()` takes it away.
 */
function place(t) {
  const dir = mkdtempSync(join(tmpdir(), 'acp-dsh-waits-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const folder = join(dir, 'acp')
  return {
    dir,
    file: join(folder, CONSENT_FILE),
    block: () => writeFileSync(folder, ''),
    unblock: () => rmSync(folder, { force: true }),
  }
}

/** The plugin over a fake connector store: `installs` lists what it was asked to install. */
function harness(t, { file, bins = {}, signedIn = {}, accounts = {}, failures = {}, busy = {}, lands = true } = {}) {
  const logs = []
  const listeners = new Map()
  const services = {}
  const registered = {}
  const installs = []
  const ctx = {
    logger: { warn: message => logs.push(message), info: message => logs.push(message) },
    llm: {
      registerAdapter(providers, adapter) { registered.adapter = adapter; return Object.assign(() => {}, { replace() {} }) },
      listProviders: () => Object.keys(AGENTS).map(id => ({ id, name: id })),
      listModels: () => new Promise(() => {}),
    },
    agents: { get: () => ({ status: 'idle', ctx: { tools: { register: () => () => {} } }, session: { header: {} } }), list: () => [] },
    get: () => undefined,
    provide: (name, value) => { services[name] = value },
    on: (name, listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    effect: (setup) => { const cleanup = setup(); listeners.set('stop', [...(listeners.get('stop') ?? []), cleanup]) },
    emit: (name, ...args) => { for (const listener of listeners.get(name) ?? []) listener(...args) },
  }
  const store = {
    binOf: pkg => bins[pkg],
    busy: pkg => busy[pkg] === true,
    lastError: pkg => failures[pkg]?.message,
    lastFailure: pkg => failures[pkg],
    // An install that lands puts the connector in place, as the real store does.
    update: async (pkg) => { installs.push(pkg); if (lands) bins[pkg] = INSTALLED[pkg] },
    dispose() {},
  }
  apply(ctx, { claude: true, codex: true }, {
    store,
    cliStore: undefined,
    find: name => ({ claude: '/bin/claude', codex: '/bin/codex' })[name],
    signedIn: async spec => signedIn[spec.key],
    account: async spec => accounts[spec.key],
    consentFile: file,
    imageSetup: async () => ({ ok: true }),
  })
  t.after(() => ctx.emit('stop'))
  const row = async id => (await services[SERVICE].status()).agents.find(agent => agent.id === id)
  const turn = async (provider) => {
    const events = []
    for await (const event of registered.adapter.stream({ provider, model: 'default', sessionId: 's1', messages: [{ role: 'user', content: 'hi' }] })) events.push(event)
    return events
  }
  return { service: services[SERVICE], logs, installs, bins, failures, busy, row, turn, adapter: registered.adapter }
}

test('a record that cannot be written: the connector says failed with the reason, and nothing is installed', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file })
  // Before anything tried the install, it is on its way, as on any new install.
  assert.equal((await h.row('acp-claude')).connector.state, 'installing')
  await h.service.retry('acp-claude')
  await settle()
  const { connector } = await h.row('acp-claude')
  assert.equal(connector.state, 'failed')
  assert.match(connector.error, /^the account record could not be saved \([A-Z][A-Z0-9_]+\)$/)
  assert.deepEqual(h.installs, [], 'no connector was installed without the record')
  assert.ok(h.logs.some(line => /not installed yet: the account record could not be saved/.test(line)), 'the host log line stays')
  // The other agent was not tried: it is still on its way.
  assert.equal((await h.row('acp-codex')).connector.state, 'installing')
})

test('the reason carries the write error code and nothing of the place it could not write', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file })
  await h.service.retry('acp-claude')
  await settle()
  const everything = JSON.stringify([await h.service.status(), h.logs])
  assert.match((await h.row('acp-claude')).connector.error, /\((ENOTDIR|EEXIST|EACCES|EPERM)\)/)
  assert.equal(everything.includes(at.dir), false, 'no path of the record')
  assert.equal(everything.includes(CONSENT_FILE), false, 'nor its name')
})

test('the record keeps only a code from the error: any other shape reads as "error"', (t) => {
  const at = place(t)
  at.block()
  const store = new ConsentStore({ file: at.file, ids: ['acp-claude'] })
  store.settle()
  assert.equal(store.saved, false)
  assert.match(store.saveError, /^[A-Z][A-Z0-9_]+$/)
  // Once the write works, nothing is left of the failure.
  at.unblock()
  store.settle()
  assert.equal(store.saved, true)
  assert.equal(store.saveError, undefined)
})

test('Retry while the record still cannot be written stays failed and installs nothing', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file })
  for (let again = 0; again < 3; again += 1) {
    const status = await h.service.retry('acp-claude')
    assert.equal(status.agents.find(agent => agent.id === 'acp-claude').connector.state, 'failed', 'the answer of Retry itself says so')
    await settle()
  }
  assert.deepEqual(h.installs, [])
})

test('Retry once the record can be written installs the connector, and the failure is gone', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file })
  await h.service.retry('acp-claude')
  await settle()
  assert.equal((await h.row('acp-claude')).connector.state, 'failed')
  at.unblock()
  await h.service.retry('acp-claude')
  await settle()
  assert.deepEqual(h.installs, [CLAUDE.adapter])
  const { connector } = await h.row('acp-claude')
  assert.equal(connector.state, 'ready')
  assert.equal(connector.error, undefined)
})

test('an install that starts after the wait and is still running says installing, not the old reason', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file, lands: false })
  await h.service.retry('acp-claude')
  await settle()
  at.unblock()
  h.busy[CLAUDE.adapter] = true
  await h.service.retry('acp-claude')
  await settle()
  const { connector } = await h.row('acp-claude')
  assert.equal(connector.state, 'installing')
  assert.equal(connector.error, undefined)
})

test('a turn on that agent names the reason instead of "send this again in a minute"', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file, signedIn: { claude: false } })
  const events = await h.turn('acp-claude')
  const failure = events.at(-1).reason.failure
  assert.match(failure.message, /the last install failed: the account record could not be saved \([A-Z][A-Z0-9_]+\)/)
  assert.doesNotMatch(failure.message, /send this again in a minute/)
  assert.equal(failure.message.includes(at.dir), false)
  assert.deepEqual(h.installs, [], 'the turn did not install it either')
})

test('a connector an earlier version installed is ready and still updated while the record cannot be written', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file, bins: { [CLAUDE.adapter]: INSTALLED[CLAUDE.adapter] } })
  await h.service.retry('acp-claude')
  await settle()
  assert.deepEqual(h.installs, [CLAUDE.adapter], 'its update goes on')
  const { connector } = await h.row('acp-claude')
  assert.equal(connector.state, 'ready')
  assert.equal(connector.error, undefined)
})

test('control: with a record that can be written, a first install is on its way and then ready', async (t) => {
  const at = place(t)
  const h = harness(t, { file: at.file, lands: false })
  h.busy[CLAUDE.adapter] = true
  await h.service.retry('acp-claude')
  await settle()
  assert.deepEqual(h.installs, [CLAUDE.adapter])
  assert.equal((await h.row('acp-claude')).connector.state, 'installing')
  h.busy[CLAUDE.adapter] = false
  h.bins[CLAUDE.adapter] = INSTALLED[CLAUDE.adapter]
  assert.equal((await h.row('acp-claude')).connector.state, 'ready')
})

test("the installer's own failure is the one shown when both exist", async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file })
  await h.service.retry('acp-claude')
  await settle()
  h.failures[CLAUDE.adapter] = { message: 'npm answered 503', diagnostic: 'npm answered 503 for the connector' }
  const { connector } = await h.row('acp-claude')
  assert.equal(connector.state, 'failed')
  assert.equal(connector.error, 'npm answered 503')
  assert.equal(connector.diagnostic, 'npm answered 503 for the connector')
})

test('a connector that appears while it waits is simply ready: the wait is not shown over it', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file })
  await h.service.retry('acp-claude')
  await settle()
  // A connector that appears by another way (an earlier version's, found late) is simply ready.
  h.bins[CLAUDE.adapter] = INSTALLED[CLAUDE.adapter]
  const { connector } = await h.row('acp-claude')
  assert.equal(connector.state, 'ready')
  assert.equal(connector.error, undefined)
})

// --- the consent it waits for is never skipped ---------------------------------------------------

test('after Retry installs it, the next start still asks for the account: chats and images stay refused until then', async (t) => {
  const at = place(t)
  at.block()
  const first = harness(t, { file: at.file, signedIn: { claude: true, codex: true }, accounts: { claude: WORK, codex: CODEX_WORK } })
  await first.service.retry('acp-claude')
  await first.service.retry('acp-codex')
  await settle()
  assert.deepEqual(first.installs, [])
  at.unblock()
  await first.service.retry('acp-claude')
  await first.service.retry('acp-codex')
  await settle()
  assert.deepEqual(first.installs.toSorted(), [CLAUDE.adapter, CODEX.adapter].toSorted())
  // In the same run the account already waits for the person's word.
  assert.equal((await first.service.inspect('acp-claude')).consent, 'needed')
  // The next start finds the connectors and the record: this version installed them, so no
  // vendor is carried as one an earlier version offered. It asks.
  const next = harness(t, { file: at.file, bins: { ...INSTALLED }, signedIn: { claude: true, codex: true }, accounts: { claude: WORK, codex: CODEX_WORK } })
  assert.equal((await next.service.inspect('acp-claude')).consent, 'needed')
  assert.equal((await next.service.inspect('acp-codex')).consent, 'needed')
  // A chat turn is refused before any process starts.
  const events = await next.turn('acp-claude')
  assert.equal(events.length, 1)
  assert.equal(events[0].reason.failure.code, MODEL_ACCESS_REQUIRED)
  // An image is not drawn on the unconfirmed account.
  assert.deepEqual(await next.service.imageAccess(), { ready: false, signedIn: true, reason: 'account' })
  await assert.rejects(next.service.generateImage({ prompt: 'a fox' }), error => error.code === UNAVAILABLE)
  // Only the person's word opens them.
  await next.service.accountConfirm('acp-claude')
  assert.equal(await next.adapter.access('acp-claude'), undefined)
  assert.equal((await next.service.inspect('acp-codex')).consent, 'needed', "the other vendor's word is its own")
})

test('while it waits for the record, a signed-in account is still asked for: the wait confirms nothing', async (t) => {
  const at = place(t)
  at.block()
  const h = harness(t, { file: at.file, signedIn: { claude: true }, accounts: { claude: WORK } })
  await h.service.retry('acp-claude')
  await settle()
  const row = await h.service.inspect('acp-claude')
  assert.equal(row.connector.state, 'failed')
  assert.equal(row.consent, 'needed')
  const events = await h.turn('acp-claude')
  assert.equal(events.at(-1).reason.failure.code, MODEL_ACCESS_REQUIRED)
  assert.deepEqual(h.installs, [])
})
