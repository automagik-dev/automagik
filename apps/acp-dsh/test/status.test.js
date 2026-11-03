// The acpAgents service a settings page reads, and the live route set behind it: a switch
// flipped in the settings, a CLI installed after DSH started, and a connector that lands all
// reach the model picker without a restart. No CLI runs and nothing is downloaded here.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, Config, flagOf, SERVICE } from '../index.js'
import { AGENTS, signedInOf } from '../src/host/agents.js'

// A live setting, as the running fiber holds it: a reference DSH's settings service rewrites.
const live = (value) => {
  let current = value
  return { get: () => current, set: (next) => { current = next } }
}

function harness({ clis = {}, signedIn = {}, bins = {}, busy = {}, errors = {} } = {}) {
  const log = []
  const listeners = new Map()
  const services = {}
  const routes = { now: [] }
  const registered = {}
  const ctx = {
    llm: {
      registerAdapter(providers, adapter) {
        registered.adapter = adapter
        routes.now = [...providers]
        log.push(['register', [...providers]])
        const handle = () => { routes.now = []; log.push(['dispose']) }
        handle.replace = (next) => { routes.now = [...next]; log.push(['replace', [...next]]) }
        return handle
      },
      listProviders: () => routes.now.map(id => ({ id, name: id })),
      // The status never asks for models: a first read of an agent's models may take seconds.
      listModels: () => new Promise(() => {}),
    },
    agents: { get: () => undefined },
    get: () => undefined,
    provide: (name, value) => { services[name] = value },
    on: (name, listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    emit: name => (listeners.get(name) ?? []).forEach(listener => listener()),
  }
  const installs = []
  const store = {
    binOf: pkg => bins[pkg],
    busy: pkg => busy[pkg] === true,
    lastError: pkg => errors[pkg],
    update: async (pkg) => { installs.push(pkg) },
  }
  const probes = []
  const deps = {
    store,
    find: name => clis[name],
    signedIn: async (spec, cli) => { probes.push([spec.key, cli]); return signedIn[spec.key] },
  }
  return { ctx, deps, log, services, installs, probes, routes, store, bins, busy, errors, clis, registered }
}

const CLAUDE = AGENTS['acp-claude']
const CODEX = AGENTS['acp-codex']
const byId = (status, id) => status.agents.find(agent => agent.id === id)

test('the switches are live settings under their old keys, read through a reference', () => {
  const parsed = new Config({})
  assert.equal(flagOf(parsed.claude), true)
  assert.equal(flagOf(parsed.codex), true)
  assert.equal(flagOf(new Config({ claude: false }).claude), false)
  assert.equal(flagOf(false), false)
})

test('the service answers even with no CLI here, with each install link, and registers no route', async () => {
  const h = harness()
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  assert.deepEqual(h.log, [])
  const status = await h.services[SERVICE].status()
  assert.deepEqual(status.agents.map(agent => [agent.id, agent.connector.state, agent.cli.found]), [['acp-claude', 'no-cli', false], ['acp-codex', 'no-cli', false]])
  assert.match(byId(status, 'acp-claude').cli.installUrl, /^https:\/\//)
  assert.match(byId(status, 'acp-codex').cli.installUrl, /^https:\/\//)
  // Asking for the status spawns nothing.
  assert.deepEqual(h.probes, [])
})

test('a CLI installed after DSH started is found by a refresh, offered, and its connector installed', async () => {
  const h = harness()
  apply(h.ctx, { claude: live(true), codex: live(false) }, h.deps)
  h.clis.claude = '/home/me/.local/bin/claude'
  const status = await h.services[SERVICE].refresh()
  assert.deepEqual(h.log, [['register', ['acp-claude']]])
  assert.deepEqual(h.installs, [CLAUDE.adapter])
  assert.equal(byId(status, 'acp-claude').connector.state, 'installing')
  assert.equal(byId(status, 'acp-codex').connector.state, 'off')
  // The refresh asked the CLIs it found whether they are signed in, and no others.
  assert.deepEqual(h.probes, [['claude', '/home/me/.local/bin/claude']])
})

test('flipping a switch offers or withdraws the agent at once, without a restart', async () => {
  const h = harness({ clis: { claude: '/bin/claude', codex: '/bin/codex' } })
  const config = { claude: live(true), codex: live(false) }
  apply(h.ctx, config, h.deps)
  assert.deepEqual(h.log, [['register', ['acp-claude']]])
  config.codex.set(true)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(h.log.at(-1), ['replace', ['acp-claude', 'acp-codex']])
  assert.deepEqual(h.installs, [CODEX.adapter])
  config.claude.set(false)
  config.codex.set(false)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(h.log.at(-1), ['dispose'])
  const status = await h.services[SERVICE].status()
  assert.deepEqual(status.agents.map(agent => [agent.on, agent.connector.state]), [[false, 'off'], [false, 'off']])
  // On again: a new registration.
  config.claude.set(true)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(h.log.at(-1), ['register', ['acp-claude']])
})

test('connector states: installing, failed with the last error, ready and in the picker', async () => {
  const h = harness({ clis: { claude: '/bin/claude', codex: '/bin/codex' } })
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  const service = h.services[SERVICE]
  h.busy[CLAUDE.adapter] = true
  h.errors[CODEX.adapter] = 'npm answered 503'
  let status = await service.status()
  assert.deepEqual(byId(status, 'acp-claude').connector, { state: 'installing' })
  assert.deepEqual(byId(status, 'acp-codex').connector, { state: 'failed', error: 'npm answered 503' })
  // An install that is running again after a failure shows as installing, not failed.
  h.busy[CODEX.adapter] = true
  assert.equal(byId(await service.status(), 'acp-codex').connector.state, 'installing')
  h.busy[CLAUDE.adapter] = false
  h.bins[CLAUDE.adapter] = { path: '/x/dist/index.js', version: '0.9.1' }
  status = await service.status()
  const claude = byId(status, 'acp-claude')
  assert.deepEqual(claude.connector, { state: 'ready', version: '0.9.1' })
  assert.deepEqual(claude.model, { provider: 'acp-claude', id: 'default', name: 'Claude Code', listed: true })
  assert.equal(claude.restartNeeded, false)
})

test('a connector that lands is announced, so the picker lists its model', async () => {
  const h = harness({ clis: { claude: '/bin/claude' } })
  let land
  h.store.update = pkg => new Promise((done) => { h.installs.push(pkg); land = () => { h.bins[pkg] = { path: '/x', version: '1.0.0' }; done() } })
  apply(h.ctx, { claude: live(true), codex: live(false) }, h.deps)
  await h.services[SERVICE].retry('acp-claude')
  assert.deepEqual(h.log, [['register', ['acp-claude']]])
  land()
  await new Promise(done => setImmediate(done))
  assert.deepEqual(h.log.at(-1), ['replace', ['acp-claude']])
  assert.equal(byId(await h.services[SERVICE].status(), 'acp-claude').model.listed, true)
})

test('retry starts the install again and answers at once', async () => {
  const h = harness({ clis: { codex: '/bin/codex' }, errors: { [CODEX.adapter]: 'network gone' } })
  h.store.update = (pkg) => { h.installs.push(pkg); return new Promise(() => {}) }
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  await h.services[SERVICE].retry('acp-codex')
  assert.deepEqual(h.installs, [CODEX.adapter])
  await assert.rejects(h.services[SERVICE].retry('acp-gemini'), /no ACP agent/)
})

test('a connector ready but not in the picker says a restart is needed', async () => {
  const h = harness({ clis: { claude: '/bin/claude' }, bins: { [CLAUDE.adapter]: { path: '/x', version: '1.0.0' } } })
  apply(h.ctx, { claude: live(true), codex: live(false) }, h.deps)
  h.ctx.llm.listProviders = () => []
  const claude = byId(await h.services[SERVICE].status(), 'acp-claude')
  assert.equal(claude.connector.state, 'ready')
  assert.equal(claude.restartNeeded, true)
})

test('sign-in comes from the CLI itself: loggedIn only, exit codes for Codex, unknown when it cannot tell', async () => {
  const runs = []
  const run = answer => (file, args, options, done) => { runs.push({ file, args, path: options.env.PATH }); setImmediate(() => answer(done)) }
  const exit = (code, stdout = '') => done => done(code === 0 ? null : Object.assign(new Error('exit'), { code }), stdout)
  const env = { PATH: '/usr/bin' }
  assert.equal(await signedInOf(CLAUDE, '/me/.local/bin/claude', { env, run: run(exit(0, JSON.stringify({ loggedIn: true, email: 'someone@example.com', orgId: 'x' }))) }), true)
  assert.equal(await signedInOf(CLAUDE, '/me/.local/bin/claude', { env, run: run(exit(1, JSON.stringify({ loggedIn: false }))) }), false)
  assert.equal(await signedInOf(CLAUDE, '/me/.local/bin/claude', { env, run: run(exit(0, 'Logged in')) }), undefined)
  assert.equal(await signedInOf(CODEX, '/me/.nvm/bin/codex', { env, run: run(exit(0)) }), true)
  assert.equal(await signedInOf(CODEX, '/me/.nvm/bin/codex', { env, run: run(exit(1)) }), false)
  // A timeout (killed, no exit code) or a CLI that is gone: unknown.
  assert.equal(await signedInOf(CODEX, '/me/.nvm/bin/codex', { env, run: run(done => done(Object.assign(new Error('killed'), { killed: true, code: null }))) }), undefined)
  assert.equal(await signedInOf(CODEX, '/gone/codex', { env, run: run(done => done(Object.assign(new Error('nope'), { code: 'ENOENT' }))) }), undefined)
  assert.equal(await signedInOf(CODEX, undefined, { env, run: run(exit(0)) }), undefined)
  assert.deepEqual(runs.slice(0, 1).map(r => [r.file, r.args]), [['/me/.local/bin/claude', ['auth', 'status', '--json']]])
  assert.deepEqual(runs[3].args, ['login', 'status'])
  // The CLI's own folder leads PATH, so a Node-script CLI finds its Node.
  assert.equal(runs[3].path.split(':')[0], '/me/.nvm/bin')
})

test('the status carries a yes or no for the sign-in and nothing else the CLI said', async () => {
  const h = harness({ clis: { claude: '/bin/claude', codex: '/bin/codex' }, signedIn: { claude: true, codex: false } })
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  const before = await h.services[SERVICE].status()
  assert.equal('signedIn' in byId(before, 'acp-claude'), false)
  const status = await h.services[SERVICE].refresh()
  assert.equal(byId(status, 'acp-claude').signedIn, true)
  assert.equal(byId(status, 'acp-codex').signedIn, false)
  assert.doesNotMatch(JSON.stringify(status), /@|email|org/i)
})

test("a catalog's key is the adapter release and the CLI as it resolves, so a CLI update reads the agent's models again", async (t) => {
  const { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = mkdtempSync(join(tmpdir(), 'acp-dsh-key-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  for (const version of ['1.0', '2.0']) {
    mkdirSync(join(home, version))
    writeFileSync(join(home, version, 'claude'), '#!/bin/sh\n')
  }
  const link = join(home, 'claude')
  symlinkSync(join(home, '1.0', 'claude'), link)
  const h = harness({ clis: { claude: link }, bins: { [CLAUDE.adapter]: { path: '/adapters/0.100.0/index.js', version: '0.100.0' } } })
  apply(h.ctx, { claude: live(true), codex: live(false) }, h.deps)
  const key = () => h.registered.adapter.agents.get('acp-claude').catalog.spec.key()
  const first = key()
  assert.match(first, /^\/adapters\/0\.100\.0\/index\.js .*1\.0\/claude \d/)
  unlinkSync(link)
  symlinkSync(join(home, '2.0', 'claude'), link)
  assert.notEqual(key(), first)
})
