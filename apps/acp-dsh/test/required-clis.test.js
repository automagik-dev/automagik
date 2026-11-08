// Acceptance at the activation boundary: real CliStore and --version subprocesses,
// isolated homes, fake package payloads, and no network or account operations.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { apply, SERVICE } from '../index.js'
import { AGENTS } from '../src/host/agents.js'
import { CliStore, CLI_CHECK_EVERY_MS, cliLayout } from '../src/host/clis.js'

const specs = Object.values(AGENTS)
const platform = { platform: 'linux', arch: 'x64', musl: false }
const unixOnly = { skip: process.platform === 'win32' ? 'the fake native executables use a POSIX shebang' : false }
const write = (path, text, mode = 0o600) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { mode })
  chmodSync(path, mode)
  return path
}
const fakeCli = (path, name, version, audit) => write(path, `#!${process.execPath}
import('node:fs').then(({ appendFileSync }) => {
  appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ name: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n')
  if (process.argv.length !== 3 || process.argv[2] !== '--version') process.exit(91)
  console.log(${JSON.stringify(`${name} ${version}`)})
})
`, 0o755)

function fixture(t, { external = {}, adaptersReady = false, latest = () => '2.0.0', installFailure = () => false, afterPayload = async () => {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'automagik-required-clis-'))
  const audit = join(home, 'version-checks.jsonl')
  const saved = [
    write(join(home, 'profile', 'cordis.patch.yml'), 'welcome:\n  completed: true\nacp-dsh:\n  claude: false\n  codex: false\n'),
    write(join(home, 'user', '.claude', 'settings.json'), '{"theme":"dark"}\n'),
    write(join(home, 'user', '.codex', 'config.toml'), 'model = "personal-model"\n'),
    write(join(home, 'user', '.codex', 'auth.json'), '{"testCredential":"fixture-only"}\n'),
  ]
  const clis = {}
  for (const [name, version] of Object.entries(external)) {
    clis[name] = fakeCli(join(home, 'user', 'bin', name), name, version, audit)
    saved.push(clis[name])
  }
  const before = saved.map(path => [path, readFileSync(path)])
  const checked = []
  const installed = []
  const jobs = []
  const createCliStore = () => {
    const store = new CliStore({
      home: join(home, 'managed'), platform,
      env: { ...process.env, HOME: join(home, 'user') },
      latest: async pkg => { checked.push(pkg); return latest(pkg) },
      install: async (dir, spec, version, env, options) => {
        installed.push(spec.key)
        if (installFailure(spec)) throw new Error('fixture registry unavailable')
        fakeCli(join(dir, cliLayout(spec, version, platform).bins[0]), spec.cli, version, audit)
        await afterPayload(spec, options.signal, version)
      },
    })
    const ensure = store.ensure.bind(store)
    store.ensure = (...args) => {
      const job = ensure(...args)
      jobs.push(job)
      return job
    }
    return store
  }
  let cliStore = createCliStore()
  const bins = new Map(adaptersReady ? specs.map(spec => [spec.adapter, { path: '/fixture/adapter.js', version: '1.0.0' }]) : [])
  const adapterInstalls = []
  const routes = []
  const services = {}
  const cleanups = []
  const warnings = []
  const listeners = new Map()
  let stopped = false
  const ctx = {
    logger: { info() {}, warn: message => warnings.push(message) },
    llm: {
      registerAdapter(ids) {
        routes.splice(0, routes.length, ...ids)
        const unregister = () => routes.splice(0)
        unregister.replace = next => routes.splice(0, routes.length, ...next)
        return unregister
      },
      listProviders: () => routes.map(id => ({ id })),
    },
    agents: { get: () => undefined },
    get: () => undefined,
    on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]) },
    provide: (name, value) => { services[name] = value },
    effect: setup => cleanups.push(setup()),
  }
  const store = {
    binOf: pkg => bins.get(pkg),
    busy: () => false,
    lastFailure: () => undefined,
    update: async pkg => {
      adapterInstalls.push(pkg)
      bins.set(pkg, { path: '/fixture/adapter.js', version: '1.0.0' })
    },
    dispose() {},
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const cleanup of cleanups.splice(0)) cleanup?.()
    listeners.clear()
  }
  t.after(() => { stop(); rmSync(home, { recursive: true, force: true }) })
  return {
    start(config = {}) {
      if (stopped) {
        cliStore = createCliStore()
        stopped = false
      }
      apply(ctx, config, {
        store, cliStore, find: name => clis[name],
        signedIn: () => { assert.fail('automatic provisioning must not probe or start authentication') },
      })
      return services[SERVICE]
    },
    async settle() {
      let completed = 0
      do {
        const pending = jobs.slice(completed)
        completed = jobs.length
        await Promise.allSettled(pending)
        await new Promise(resolve => setImmediate(resolve))
      } while (completed < jobs.length)
    },
    emit(name, payload) { for (const listener of listeners.get(name) ?? []) listener(payload) },
    assertPreserved() {
      for (const [path, bytes] of before) assert.deepEqual(readFileSync(path), bytes)
      const invocations = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      assert.ok(invocations.length > 0, 'real --version subprocesses ran')
      assert.ok(invocations.every(call => call.args.length === 1 && call.args[0] === '--version'))
    },
    get cliStore() { return cliStore },
    checked, installed, adapterInstalls, routes, warnings, stop,
  }
}

test('first desktop activation installs both required CLIs and offers their existing ACP routes', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fixture(t)
  const service = f.start()
  assert.deepEqual(f.installed, [])
  t.mock.timers.tick(5000)
  await f.settle()
  assert.deepEqual([...f.installed].sort(), ['claude', 'codex'])
  assert.deepEqual([...f.checked].sort(), specs.map(spec => spec.cliPackage).sort())
  assert.deepEqual([...f.routes].sort(), ['acp-claude', 'acp-codex'])
  const status = await service.status()
  assert.ok(status.agents.every(agent => agent.cli.found && agent.cli.managed && agent.cli.version === '2.0.0'))
  assert.ok(status.agents.every(agent => agent.connector.state === 'ready'))
  f.assertPreserved()
})

test('activation after an update fills a missing CLI with both models off and no onboarding reset', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fixture(t, { external: { claude: '3.0.0' }, adaptersReady: true })
  const config = { claude: false, codex: false }
  const service = f.start(config)
  t.mock.timers.tick(5000)
  await f.settle()
  assert.deepEqual(f.installed, ['codex'])
  assert.deepEqual(f.routes, [])
  assert.deepEqual(f.adapterInstalls, [])
  assert.deepEqual(config, { claude: false, codex: false })
  const status = await service.status()
  const claude = status.agents.find(agent => agent.id === 'acp-claude')
  const codex = status.agents.find(agent => agent.id === 'acp-codex')
  assert.equal(claude.cli.managed, false)
  assert.equal(codex.cli.managed, true)
  assert.ok(status.agents.every(agent => agent.cli.found && agent.on === false && agent.connector.state === 'off'))
  f.assertPreserved()
})

test('every app startup checks both releases and upgrades installed managed CLIs without a fifteen-minute wait', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let latest = '1.0.0'
  const f = fixture(t, { latest: () => latest, adaptersReady: true })
  const config = { claude: false, codex: false }
  f.start(config)
  t.mock.timers.tick(5000)
  await f.settle()
  const previous = specs.map(spec => f.cliStore.find(spec))
  assert.ok(previous.every(cli => cli.version === '1.0.0'))
  assert.equal(f.checked.length, 2)
  f.stop()

  // This restart represents either launching the app again or launching its updated build.
  // All payloads and the profile stay on disk; only the host/service process is recreated.
  latest = '2.0.0'
  let service = f.start(config)
  t.mock.timers.tick(5000)
  await f.settle()
  let status = await service.status()
  assert.ok(status.agents.every(agent => agent.cli.version === '2.0.0' && agent.cli.managed))
  assert.equal(f.checked.length, 4, 'both registries checked at the second startup')
  assert.equal(f.installed.length, 4, 'both installed tools upgraded')
  for (const old of previous) assert.equal(existsSync(old.path), true, 'running sessions retain their executable')
  assert.deepEqual(f.routes, [])
  assert.deepEqual(config, { claude: false, codex: false })
  f.assertPreserved()
  f.stop()

  // Even a current installation checks the registry on its very next startup.
  service = f.start(config)
  t.mock.timers.tick(5000)
  await f.settle()
  status = await service.status()
  assert.ok(status.agents.every(agent => agent.cli.version === '2.0.0'))
  assert.equal(f.checked.length, 6)
  assert.equal(f.installed.length, 4, 'current versions are not downloaded again')
  f.assertPreserved()
})

test('a live plugin update checks and upgrades both CLIs immediately even with both model switches off', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let latest = '1.0.0'
  const f = fixture(t, { latest: () => latest, adaptersReady: true })
  const service = f.start({ claude: false, codex: false })
  t.mock.timers.tick(5000)
  await f.settle()
  assert.equal(f.checked.length, 2)
  latest = '2.0.0'

  // Pinned DSH's updateBundle uses installBundle and announces reason: install.
  // No timer advances: the plugin update must bypass the successful-check cache.
  f.emit('plugin-manager/changed', { reason: 'install' })
  await f.settle()
  let status = await service.status()
  assert.equal(f.checked.length, 4)
  assert.equal(f.installed.length, 4)
  assert.ok(status.agents.every(agent => agent.cli.version === '2.0.0' && agent.on === false))
  assert.deepEqual(f.routes, [])
  assert.deepEqual(f.adapterInstalls, [])

  // An unrelated plugin update still checks both current versions, without redownloading.
  f.emit('plugin-manager/changed', { reason: 'install' })
  await f.settle()
  status = await service.status()
  assert.equal(f.checked.length, 6)
  assert.equal(f.installed.length, 4)
  assert.ok(status.agents.every(agent => agent.cli.version === '2.0.0'))
  for (const reason of ['remove', 'plugin', 'bundle']) f.emit('plugin-manager/changed', { reason })
  await f.settle()
  assert.equal(f.checked.length, 6, 'settings and removal events are not package updates')
  f.assertPreserved()
})

test('a plugin update arriving during downloads queues a fresh check after the active installations', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let latest = '1.0.0'
  let entered
  let release
  let started = 0
  const ready = new Promise(resolve => { entered = resolve })
  const downloading = new Promise(resolve => { release = resolve })
  const f = fixture(t, { latest: () => latest, afterPayload: async (spec, signal, version) => {
    if (version !== '1.0.0') return
    if (++started === 2) entered()
    await downloading
  } })
  const service = f.start({ claude: false, codex: false })
  t.mock.timers.tick(5000)
  await ready
  latest = '2.0.0'
  f.emit('plugin-manager/changed', { reason: 'install' })
  f.emit('plugin-manager/changed', { reason: 'install' })
  assert.equal(f.checked.length, 2, 'active downloads are not duplicated')
  release()
  await f.settle()
  const status = await service.status()
  assert.equal(f.checked.length, 4, 'one queued latest check per tool follows the busy period')
  assert.equal(f.installed.length, 4)
  assert.ok(status.agents.every(agent => agent.cli.version === '2.0.0' && agent.cli.managed))
  assert.deepEqual(f.routes, [])
  f.assertPreserved()
})

test('older user CLIs receive verified managed upgrades while their binaries and credentials stay unchanged', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fixture(t, { external: { claude: '1.0.0', codex: '1.1.0' }, adaptersReady: true })
  const service = f.start({ claude: false, codex: false })
  t.mock.timers.tick(5000)
  await f.settle()
  const status = await service.status()
  assert.ok(status.agents.every(agent => agent.cli.managed && agent.cli.version === '2.0.0'))
  assert.deepEqual([...f.installed].sort(), ['claude', 'codex'])
  f.assertPreserved()
})

test('an unverifiable user wrapper gets a verified managed fallback without replacing a newer personal CLI', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fixture(t, { external: { claude: 'future-wrapper', codex: '3.0.0' }, adaptersReady: true })
  const service = f.start({ claude: false, codex: false })
  t.mock.timers.tick(5000)
  await f.settle()
  const status = await service.status()
  const claude = status.agents.find(agent => agent.id === 'acp-claude')
  const codex = status.agents.find(agent => agent.id === 'acp-codex')
  assert.equal(claude.cli.managed, true)
  assert.equal(claude.cli.version, '2.0.0')
  assert.equal(codex.cli.managed, false)
  assert.equal(codex.cli.version, '3.0.0')
  assert.deepEqual(f.installed, ['claude'])
  f.assertPreserved()
})

test('offline startup chooses the newer local CLI in either direction without touching user files', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let offline = false
  const f = fixture(t, {
    external: { claude: '1.0.0', codex: '3.0.0' }, adaptersReady: true,
    latest: () => {
      if (offline) throw new Error('fixture registry unavailable')
      return '2.0.0'
    },
  })
  // Existing managed installs predate this launch. The personal tools independently became
  // older than the managed Claude and newer than the managed Codex.
  for (const spec of specs) await f.cliStore.ensure(spec)
  offline = true
  const service = f.start({ claude: false, codex: false })
  t.mock.timers.tick(5000)
  await f.settle()
  const status = await service.status()
  const claude = status.agents.find(agent => agent.id === 'acp-claude')
  const codex = status.agents.find(agent => agent.id === 'acp-codex')
  assert.equal(claude.cli.version, '2.0.0')
  assert.equal(claude.cli.managed, true)
  assert.equal(codex.cli.version, '3.0.0')
  assert.equal(codex.cli.managed, false)
  assert.equal(f.installed.length, 2, 'offline check downloads neither replacement')
  assert.equal(f.checked.length, 4, 'the unavailable registry was still checked for both tools')
  assert.ok(status.agents.every(agent => agent.cli.found && agent.cli.state === 'ready'))
  f.assertPreserved()
})

test('one failed download does not block the other CLI, and the next scheduled check recovers', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let failCodex = true
  const f = fixture(t, { installFailure: spec => spec.cli === 'codex' && failCodex })
  const service = f.start()
  t.mock.timers.tick(5000)
  await f.settle()
  let status = await service.status()
  assert.equal(status.agents.find(agent => agent.id === 'acp-claude').cli.found, true)
  assert.equal(status.agents.find(agent => agent.id === 'acp-codex').cli.state, 'failed')
  assert.deepEqual(f.routes, ['acp-claude'])
  assert.ok(f.warnings.some(message => message.includes('fixture registry unavailable')))
  failCodex = false
  t.mock.timers.tick(CLI_CHECK_EVERY_MS)
  await f.settle()
  status = await service.status()
  assert.ok(status.agents.every(agent => agent.cli.found && agent.cli.state === 'ready'))
  assert.deepEqual([...f.routes].sort(), ['acp-claude', 'acp-codex'])
  assert.equal(f.installed.filter(name => name === 'claude').length, 1)
  assert.equal(f.installed.filter(name => name === 'codex').length, 2)
  f.assertPreserved()
})

test('shutdown cancels pending provisioning and never publishes a late CLI or route', unixOnly, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let ready
  let release
  let started = 0
  const entered = new Promise(resolve => { ready = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const signals = []
  const f = fixture(t, { afterPayload: async (spec, signal) => {
    signals.push(signal)
    if (++started === 2) ready()
    await blocked
  } })
  f.start()
  t.mock.timers.tick(5000)
  await entered
  assert.equal(signals.length, 2)
  assert.ok(signals.every(signal => !signal.aborted))
  f.emit('plugin-manager/changed', { reason: 'install' })
  f.stop()
  assert.ok(signals.every(signal => signal.aborted))
  release()
  await f.settle()
  assert.deepEqual(f.routes, [])
  assert.deepEqual(f.adapterInstalls, [])
  assert.ok(specs.every(spec => f.cliStore.find(spec) === undefined))
  assert.equal(f.checked.length, 2, 'queued checks are cancelled with the active downloads')
  t.mock.timers.tick(CLI_CHECK_EVERY_MS)
  assert.equal(f.installed.length, 2, 'no new downloads after shutdown')
})
