// The acpAgents service a settings page reads, and the live route set behind it: a switch
// flipped in the settings, a CLI installed after DSH started, and a connector that lands all
// reach the model picker without a restart. No CLI runs and nothing is downloaded here.
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, Config, dshToolsOn, flagOf, INSPECT_TTL_MS, SERVICE, SIGNED_IN_TTL_MS } from '../index.js'
import { AGENTS, signedInOf } from '../src/host/agents.js'

// A live setting, as the running fiber holds it: a reference DSH's settings service rewrites.
const live = (value) => {
  let current = value
  return { get: () => current, set: (next) => { current = next } }
}

function harness({ clis = {}, signedIn = {}, bins = {}, busy = {}, errors = {}, failures = {} } = {}) {
  const log = []
  const logs = []
  const emitted = []
  const listeners = new Map()
  const services = {}
  const routes = { now: [] }
  const registered = {}
  const ctx = {
    logger: {
      warn: message => logs.push(['warn', message]),
      info: message => logs.push(['info', message]),
    },
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
    effect: (setup) => { const cleanup = setup(); listeners.set('stop', [...(listeners.get('stop') ?? []), cleanup]) },
    emit: (name, ...args) => {
      emitted.push([name, ...args])
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
  }
  const installs = []
  const store = {
    binOf: pkg => bins[pkg],
    busy: pkg => busy[pkg] === true,
    lastError: pkg => errors[pkg],
    lastFailure: pkg => failures[pkg] ?? (errors[pkg] === undefined ? undefined : { message: errors[pkg] }),
    update: async (pkg) => { installs.push(pkg) },
    dispose: () => { log.push(['store disposed']) },
  }
  const probes = []
  const deps = {
    store,
    find: name => clis[name],
    signedIn: async (spec, cli) => { probes.push([spec.key, cli]); return signedIn[spec.key] },
  }
  return {
    ctx, deps, log, logs, emitted, services, installs, probes, routes, store, bins, busy, errors,
    failures, clis, registered,
  }
}

const CLAUDE = AGENTS['acp-claude']
const CODEX = AGENTS['acp-codex']
const byId = (status, id) => status.agents.find(agent => agent.id === id)

test('the switches are live settings under their old keys, read through a reference', () => {
  const parsed = new Config({})
  assert.equal(flagOf(parsed.claude), true)
  assert.equal(flagOf(parsed.codex), true)
  assert.equal(flagOf(parsed.dshTools), undefined)
  assert.equal(flagOf(new Config({ claude: false }).claude), false)
  assert.equal(flagOf(false), false)
})

test('dshTools keeps its key, is live, hidden, and has no schema default', () => {
  // The key is public: an installed team's profile patch keeps it, and an explicit false stays
  // the kill switch.
  assert.equal(flagOf(new Config({}).dshTools), undefined)
  assert.equal(flagOf(new Config({ dshTools: false }).dshTools), false)
  assert.equal(flagOf(new Config({ dshTools: true }).dshTools), true)
  // No schema default: absent must stay distinguishable from an explicit true, or Codex would
  // read the materialised true as the person's word and bridge by default.
  const { uid, refs } = Config.toJSON()
  const node = refs[refs[uid].dict.dshTools]
  assert.equal('default' in node.meta, false)
  assert.deepEqual({ type: node.type, ...node.meta }, {
    type: 'boolean',
    volatile: true,
    hidden: true,
    description: node.meta.description,
  })
  // A direct apply without a parsed Config reads the same default.
  assert.equal(dshToolsOn(undefined), true)
  assert.equal(dshToolsOn(true), true)
  assert.equal(dshToolsOn(false), false)
  assert.equal(dshToolsOn(live(false)), false)
  assert.equal(dshToolsOn(live(true)), true)
  assert.equal(dshToolsOn(live(undefined)), true)
})

test('the service answers even with no CLI here, with each install link, and registers no route', async () => {
  const h = harness()
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  assert.deepEqual(h.log, [])
  const status = await h.services[SERVICE].status()
  // The native agents are listed too, off until the person turns one on (native.test.js).
  assert.deepEqual(status.agents.map(agent => [agent.id, agent.connector.state, agent.cli.found]), [['acp-claude', 'no-cli', false], ['acp-codex', 'no-cli', false], ['acp-hermes', 'off', false], ['acp-antigravity', 'off', false], ['acp-omp', 'off', false]])
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
  assert.deepEqual(status.agents.slice(0, 2).map(agent => [agent.on, agent.connector.state]), [[false, 'off'], [false, 'off']])
  // On again: a new registration.
  config.claude.set(true)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(h.log.at(-1), ['register', ['acp-claude']])
})

test('a live dshTools flip is announced, so the Bot team can reverse its move at once', () => {
  const h = harness()
  const config = { claude: live(false), codex: live(false), dshTools: live(true) }
  apply(h.ctx, config, h.deps)
  const announced = () => h.emitted
    .filter(([name]) => name === 'acp-dsh/dsh-tools-changed')
    .map(([, payload]) => payload)
  // No flip, no announcement: a repeated loader event for other fields is not a change.
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(announced(), [])
  config.dshTools.set(false)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(announced(), [{ on: false }])
  config.dshTools.set(true)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(announced(), [{ on: false }, { on: true }])
})

test('a throwing flip listener is logged, and the flip and its reconcile still land', () => {
  const h = harness({ clis: { claude: '/bin/claude' } })
  const config = { claude: live(false), codex: live(false), dshTools: live(true) }
  apply(h.ctx, config, h.deps)
  const announced = () => h.emitted
    .filter(([name]) => name === 'acp-dsh/dsh-tools-changed')
    .map(([, payload]) => payload)
  h.ctx.on('acp-dsh/dsh-tools-changed', () => {
    throw new Error('the Bot team could not read its file')
  })
  // One loader event both turns the bridge off and turns Claude on: the announcement fails,
  // but the setting keeps and the reconcile after it still offers the agent.
  config.dshTools.set(false)
  config.claude.set(true)
  assert.doesNotThrow(() => h.ctx.emit('loader/volatile-update'))
  assert.deepEqual(announced(), [{ on: false }])
  assert.deepEqual(h.routes.now, ['acp-claude'])
  const warning = h.logs.find(([level]) => level === 'warn')
  assert.ok(warning, 'the failed announcement is in the plugin log')
  assert.equal(warning[1], 'acp-dsh: the dshTools flip was not announced: '
    + 'the Bot team could not read its file; the next start reverses')
  // The setting is recorded: the same event again announces nothing, and the other flip does.
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(announced(), [{ on: false }])
  config.dshTools.set(true)
  h.ctx.emit('loader/volatile-update')
  assert.deepEqual(announced(), [{ on: false }, { on: true }])
  // Both failed announcements are visible: a throwing listener never defers silently.
  assert.equal(h.logs.filter(([level]) => level === 'warn').length, 2)
})

test('a failed connector shows its log path relative to the home directory', async () => {
  const logPath = join(homedir(), '.automagik', 'acp', 'adapters', 'logs', 'agentclientprotocol__codex-acp.log')
  const h = harness({ clis: { codex: '/bin/codex' }, failures: { [CODEX.adapter]: { message: 'npm answered 503', logPath } } })
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  const status = await h.services[SERVICE].status()
  assert.equal(byId(status, 'acp-codex').connector.logPath, '~/.automagik/acp/adapters/logs/agentclientprotocol__codex-acp.log')
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
  const run = answer => (file, args, options, done) => { runs.push({ file, args, path: options.env.PATH, updates: options.env.DISABLE_UPDATES }); setImmediate(() => answer(done)) }
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
  // A status check never updates the CLI itself (DISABLE_UPDATES, as clis.js asks --version).
  assert.ok(runs.every(r => r.updates === '1'))
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

test('dispose stops the adapter installs', () => {
  const h = harness({ clis: { claude: '/bin/claude' } })
  apply(h.ctx, { claude: live(true), codex: live(false) }, h.deps)
  assert.ok(!h.log.some(([what]) => what === 'store disposed'))
  h.ctx.emit('stop')
  assert.ok(h.log.some(([what]) => what === 'store disposed'))
})

// The Bot team's check before it puts a Bot on an agent (bots-dsh models.js `modelAccess`):
// one agent's row with a fresh sign-in answer. Read-only: no install, no switch, no login.
test('inspect probes only the requested CLI, without installing or starting anything', async () => {
  const signedIn = { codex: false, claude: true }
  const h = harness({
    clis: { claude: '/bin/claude', codex: '/bin/codex' }, signedIn,
    bins: { [CODEX.adapter]: '/adapters/codex', [CLAUDE.adapter]: '/adapters/claude' },
  })
  const config = { claude: live(true), codex: live(true) }
  apply(h.ctx, config, h.deps)
  const service = h.services[SERVICE]
  const before = await service.inspect('acp-codex')
  assert.equal(before.signedIn, false)
  assert.equal(before.connector.state, 'ready')
  assert.equal(before.on, true)
  assert.deepEqual(h.probes, [['codex', '/bin/codex']])
  assert.equal(await service.inspect('not-an-agent'), undefined)
  assert.equal(h.probes.length, 1)
  assert.deepEqual(h.installs, [])
  assert.equal(flagOf(config.codex), true, 'the switch is left as it was')
  h.ctx.emit('stop')
})

test('inspect shares one probe between checks a moment apart, and a refresh asks again', async () => {
  const signedIn = { codex: false }
  const h = harness({ clis: { codex: '/bin/codex' }, signedIn, bins: { [CODEX.adapter]: '/adapters/codex' } })
  apply(h.ctx, { claude: live(false), codex: live(true) }, h.deps)
  const service = h.services[SERVICE]
  const [one, two] = await Promise.all([service.inspect('acp-codex'), service.inspect('acp-codex')])
  assert.equal(one.signedIn, false)
  assert.equal(two.signedIn, false)
  assert.equal((await service.inspect('acp-codex')).signedIn, false, 'within the TTL: the same answer')
  assert.equal(h.probes.length, 1)
  signedIn.codex = true
  await service.refresh()
  assert.equal((await service.inspect('acp-codex')).signedIn, true, 'after a refresh the answer is new')
  h.ctx.emit('stop')
})

// F5: `auth status` spawns the whole CLI and a Bot's turn asks before its first call. A confirmed
// sign-in stands for minutes; the agent's own auth_required (MODEL_ACCESS_REQUIRED) drops it.
test('inspect keeps a confirmed sign-in for minutes, a signed-out answer for seconds, and drops it on auth_required', async (t) => {
  let now = 10_000_000
  t.mock.method(Date, 'now', () => now)
  const signedIn = { codex: true, claude: false }
  const h = harness({ clis: { codex: '/bin/codex', claude: '/bin/claude' }, signedIn, bins: { [CODEX.adapter]: '/adapters/codex', [CLAUDE.adapter]: '/adapters/claude' } })
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  const service = h.services[SERVICE]
  const count = key => h.probes.filter(([probe]) => probe === key).length
  assert.equal((await service.inspect('acp-codex')).signedIn, true)
  assert.equal((await service.inspect('acp-claude')).signedIn, false)
  now += INSPECT_TTL_MS + 1
  assert.equal((await service.inspect('acp-codex')).signedIn, true)
  assert.equal(count('codex'), 1, 'a confirmed sign-in is not asked again after a few seconds')
  await service.inspect('acp-claude')
  assert.equal(count('claude'), 2, 'a signed-out answer is asked again')
  now += SIGNED_IN_TTL_MS
  await service.inspect('acp-codex')
  assert.equal(count('codex'), 2, 'after its minutes, asked again')
  // The agent says it is signed out: the cached yes goes at once, and the status says so.
  signedIn.codex = false
  h.registered.adapter.onSignedOut('acp-codex')
  assert.equal(byId(await service.status(), 'acp-codex').signedIn, false)
  assert.equal((await service.inspect('acp-codex')).signedIn, false)
  assert.equal(count('codex'), 3)
  h.registered.adapter.onSignedOut('not-an-agent')
  h.ctx.emit('stop')
})

// Only the sign-in answer is kept: the setting, the CLI and the connector are read on every
// inspect, so an agent turned off within a confirmed sign-in's minutes is never reported on.
test('inspect keeps only the sign-in answer: an agent turned off within its minutes says on:false at once', async (t) => {
  let now = 10_000_000
  t.mock.method(Date, 'now', () => now)
  const signedIn = { codex: true }
  const h = harness({ clis: { codex: '/bin/codex' }, signedIn, bins: { [CODEX.adapter]: '/adapters/codex' } })
  const config = { claude: live(false), codex: live(true) }
  apply(h.ctx, config, h.deps)
  const service = h.services[SERVICE]
  const first = await service.inspect('acp-codex')
  assert.equal(first.signedIn, true)
  assert.equal(first.on, true)
  assert.equal(first.connector.state, 'ready')
  config.codex.set(false)
  now += 1000
  const off = await service.inspect('acp-codex')
  assert.equal(off.on, false, 'the setting is read again')
  assert.equal(off.connector.state, 'off')
  assert.equal(h.probes.length, 1, 'the sign-in answer itself is still kept')
  config.codex.set(true)
  assert.equal((await service.inspect('acp-codex')).on, true)
  assert.equal(h.probes.length, 1)
  h.ctx.emit('stop')
})

test('inspect reports a connector that is not ready without triggering its installer', async () => {
  const h = harness({ clis: { codex: '/bin/codex' }, signedIn: { codex: true } })
  apply(h.ctx, { claude: live(false), codex: live(true) }, h.deps)
  const status = await h.services[SERVICE].inspect('acp-codex')
  assert.equal(status.cli.found, true)
  assert.notEqual(status.connector.state, 'ready')
  assert.deepEqual(h.installs, [])
  h.ctx.emit('stop')
})

// Sign-in through the service (login.js; plan v3 2.3): the Bot team's owner-only route calls
// these. A fake CLI process and clock; nothing real runs.
test('a sign-in through the service records the confirmed CLI, refreshes inspect and announces ready and the busy count', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  const signedIn = { codex: false }
  const h = harness({ clis: { codex: '/bin/codex' }, signedIn, bins: { [CODEX.adapter]: '/adapters/codex' } })
  const children = []
  const timers = { now: () => 5_000_000, setTimeout: () => ({ unref() {} }), clearTimeout() {} }
  const loginSpawn = (file, args) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.writes = []
    child.stdin.on('data', chunk => child.writes.push(String(chunk)))
    child.kill = () => true
    children.push({ file, args, child })
    return child
  }
  apply(h.ctx, { claude: live(false), codex: live(true) }, { ...h.deps, loginSpawn, loginTimers: timers })
  const service = h.services[SERVICE]
  assert.equal((await service.inspect('acp-codex')).signedIn, false)
  assert.equal(service.loginActive(), 0)
  assert.equal(service.loginCurrent('acp-codex'), undefined)
  const started = service.loginStart('acp-codex', { label: 'first-bot' })
  assert.equal(service.loginActive(), 1)
  assert.deepEqual(h.emitted.filter(([name]) => name === 'acp-dsh/login-active').map(([, value]) => value), [{ active: 1 }])
  const settle = () => new Promise(resolve => setImmediate(resolve))
  await settle()
  const { child, file } = children[0]
  assert.equal(file, '/bin/codex')
  const sent = () => child.writes.flatMap(chunk => chunk.trim().split('\n')).filter(Boolean).map(line => JSON.parse(line))
  child.stdout.write(`${JSON.stringify({ id: sent()[0].id, result: {} })}\n`)
  await settle()
  const login = sent().find(row => row.method === 'account/login/start')
  child.stdout.write(`${JSON.stringify({ id: login.id, result: { type: 'chatgptDeviceCode', loginId: 'login-1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' } })}\n`)
  await settle()
  // A second view (another window or Bot) reads the same attempt, never a new one.
  assert.equal(service.loginStart('acp-codex', { label: 'second-bot' }).attemptId, started.attemptId)
  assert.equal(service.loginCurrent('acp-codex').userCode, 'ABCD-1234')
  assert.equal(children.length, 1)
  signedIn.codex = true
  child.stdout.write(`${JSON.stringify({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } })}\n`)
  await settle()
  await settle()
  assert.equal(service.loginStatus('acp-codex', started.attemptId).status, 'ready')
  assert.deepEqual(h.emitted.filter(([name]) => name === 'acp-dsh/login-ready').map(([, value]) => value), [{ id: 'acp-codex' }])
  assert.deepEqual(h.emitted.filter(([name]) => name === 'acp-dsh/login-active').map(([, value]) => value), [{ active: 1 }, { active: 0 }])
  // The cached "signed out" answer is dropped with the ready sign-in.
  assert.equal((await service.inspect('acp-codex')).signedIn, true)
  assert.equal(service.loginActive(), 0)
  assert.equal(service.loginTextMatches('nothing here'), false)
  h.ctx.emit('stop')
})

test('the status shows the previous connector, and a rollback while the failed release is held back', async () => {
  const h = harness({ clis: { claude: '/bin/claude', codex: '/bin/codex' } })
  h.bins[CLAUDE.adapter] = { path: '/x/dist/index.js', version: '0.9.1' }
  h.bins[CODEX.adapter] = { path: '/y/dist/index.js', version: '2.0.0' }
  const states = {
    [CLAUDE.adapter]: { version: '0.9.1', proven: true, previous: '0.9.0', rolledBack: { from: '0.9.2', to: '0.9.1', at: 5, reason: 'it exited (1) before it answered initialize' } },
    [CODEX.adapter]: { version: '2.0.0', proven: true },
  }
  h.deps.store.stateOf = pkg => states[pkg]
  apply(h.ctx, { claude: live(true), codex: live(true) }, h.deps)
  const status = await h.services[SERVICE].status()
  assert.deepEqual(byId(status, 'acp-claude').connector, {
    state: 'ready',
    version: '0.9.1',
    previous: '0.9.0',
    rolledBack: { from: '0.9.2', to: '0.9.1', at: 5, reason: 'it exited (1) before it answered initialize' },
  })
  assert.deepEqual(byId(status, 'acp-codex').connector, { state: 'ready', version: '2.0.0' })
})

test('catalog changes publish only for the current catalog while the plugin is alive', async t => {
  const h = harness({ clis: { codex: '/fake/codex' },
    bins: { [CODEX.adapter]: { path: '/fake/adapter', version: '1' } } })
  apply(h.ctx, { claude: false, codex: true }, h.deps)
  t.after(() => h.ctx.emit('stop'))
  const old = h.registered.adapter.agents.get('acp-codex').catalog
  old.spec.spawn = () => ({ command: process.execPath,
    args: [join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')] })
  const before = h.log.length
  await old.refresh()
  assert.ok(h.log.length > before)
  assert.equal(h.log.at(-1)[0], 'replace')
  h.clis.codex = '/fake/next-codex'
  await h.services[SERVICE].refresh()
  assert.notEqual(h.registered.adapter.agents.get('acp-codex').catalog, old)
  const replaced = h.log.length
  old.spec.onChange(old)
  assert.equal(h.log.length, replaced)
  const current = h.registered.adapter.agents.get('acp-codex').catalog
  h.ctx.emit('stop')
  const stopped = h.log.length
  current.spec.onChange(current)
  assert.equal(h.log.length, stopped)
})
