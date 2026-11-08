// Desktop starts and profile updates exercise the actual ACP activation. The plugin-manager
// case calls the pinned DSH update operation itself, with package I/O confined to a temp home.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { PluginManager } from '@deepseek-ai/dsh-plugin-manager'
import { apply } from '../index.js'
import { startUp } from '../../desktop/src/startup.js'
import { dshEnv, installProfile } from '../../desktop/src/dsh.js'
import { applyStaged } from '../../desktop/src/auto-apply.js'
import { beforeStart, confirm, stage, trialFailed } from '../../desktop/src/lane.js'
import { tarOf } from '../../desktop/src/tar.js'

const ACP = '@automagik/acp-dsh'
const BOTS = '@automagik/bots-dsh'
const temp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'required-cli-lifecycle-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
const json = (path, value) => write(path, JSON.stringify(value))
const read = path => JSON.parse(readFileSync(path, 'utf8'))

function activation() {
  const checks = []
  const events = new Map()
  const cleanups = []
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: { registerAdapter() { return () => {} } },
    agents: { get() {} }, get() {},
    on: (name, listener) => { events.set(name, listener) },
    emit: (name, change) => events.get(name)?.(change),
    provide() {}, effect: setup => cleanups.push(setup()),
  }
  apply(ctx, { claude: false, codex: false }, {
    store: { binOf() {}, dispose() {} }, find() {},
    signedIn: () => assert.fail('provisioning must never ask an account to sign in'),
    cliStore: {
      find() {}, dispose() {},
      async ensure(spec, external, options) { checks.push({ cli: spec.cli, force: options.force }) },
    },
  })
  return { ctx, checks, stop: () => cleanups.forEach(cleanup => cleanup?.()) }
}

function shippedProfile(root, version) {
  const source = join(root, 'shipped')
  const shipped = read(join(import.meta.dirname, '../../desktop/profile/package.json'))
  assert.ok(shipped.dsh.profile.bundles.includes(ACP), 'first-run desktop profile must load ACP before onboarding')
  json(join(source, 'package.json'), { dependencies: { [ACP]: '*', [BOTS]: '*' }, dsh: shipped.dsh })
  write(join(source, 'cordis.patch.yml'), '[]\n')
  write(join(source, '.build-id'), version)
  json(join(source, 'node_modules', BOTS, 'package.json'), { name: BOTS, version })
  return source
}

test('first launch before onboarding, each launch, and a new app build check both required CLIs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const home = temp(t)
  const source = shippedProfile(home, '3.105.0')
  const env = dshEnv({ base: {}, home, userHome: join(home, 'user'), binDir: join(home, 'bin') })
  assert.equal(env.AUTOMAGIK_APP_BROWSER, '1')
  assert.ok(env.AUTOMAGIK_PNPM)
  const installed = []
  const checks = []
  for (const build of ['3.105.0', '3.105.0', '3.106.0']) {
    write(join(source, '.build-id'), build)
    let target
    let active
    await startUp({
      port: () => 0, tools() {},
      profile: async () => {
        const result = await installProfile({ dshHome: env.DSH_HOME, source })
        target = result.target
        installed.push(result.installed)
      },
      spawn: () => {
        assert.ok(read(join(target, 'package.json')).dsh.profile.bundles.includes(ACP))
        assert.equal(readFileSync(join(target, 'cordis.patch.yml'), 'utf8'), '[]\n')
        active = activation()
      },
      load() {},
    })
    t.mock.timers.tick(5000)
    await Promise.resolve()
    checks.push(active.checks)
    active.stop()
  }
  assert.deepEqual(installed, [true, false, true])
  for (const checked of checks) assert.deepEqual(checked, [{ cli: 'claude', force: true }, { cli: 'codex', force: true }])
})

test('a lane update of another plugin starts a fresh ACP check when DSH cycles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const home = temp(t)
  const source = shippedProfile(home, '3.105.0')
  const { target } = await installProfile({ dshHome: join(home, 'dsh'), source })
  const packed = join(home, 'pack', 'package')
  json(join(packed, 'package.json'), { name: BOTS, version: '3.105.1' })
  const tar = join(home, 'bots.tgz')
  execFileSync(tarOf(), ['-czf', tar, '-C', dirname(packed), 'package'])
  const bytes = readFileSync(tar)
  await stage({ publisher: 'automagik', version: '3.105.1', sequence: 3105001, plugins: [{ name: BOTS, version: '3.105.1', url: 'https://github.com/automagik-dev/automagik/releases/download/v3.105.1/bots.tgz', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }] }, { home, fetch: async () => new Response(bytes) })
  let active = activation()
  t.mock.timers.tick(5000)
  await Promise.resolve()
  const previous = active.checks
  const outcome = await applyStaged({
    cycle: async prepare => {
      active.stop()
      const prepared = prepare()
      active = activation()
      return prepared
    },
    beforeStart: () => beforeStart({ home, target }),
    confirm: () => confirm(home), trialFailed: () => trialFailed(home), judge: async () => true,
  })
  assert.equal(outcome, 'good')
  assert.equal(read(join(target, 'node_modules', BOTS, 'package.json')).version, '3.105.1')
  t.mock.timers.tick(5000)
  await Promise.resolve()
  assert.deepEqual(previous, [{ cli: 'claude', force: true }, { cli: 'codex', force: true }])
  assert.deepEqual(active.checks, previous)
  active.stop()
})

test('the pinned DSH registry bundle update notifies ACP to check both CLIs without a restart', async t => {
  const dir = temp(t)
  const name = '@fixture/unrelated-plugin'
  const manifest = version => ({ name, version, dsh: { bundle: { patch: './cordis.patch.yml' } } })
  json(join(dir, 'package.json'), { dependencies: { [name]: '1.0.0' } })
  json(join(dir, 'node_modules', name, 'package.json'), manifest('1.0.0'))
  write(join(dir, 'node_modules', name, 'cordis.patch.yml'), '[]\n')
  const active = activation()
  t.after(active.stop)
  const emitted = []
  // Use DSH's actual updateBundle, installBundle and change methods. Only registry/package
  // I/O and runtime reload are fixtures; the event name and reason come from pinned DSH.
  const manager = Object.assign(Object.create(PluginManager.prototype), {
    profile: { dir, installAnchor: join(dir, 'package.json') },
    abort: new AbortController(), installs: new Map(), packageOperations: new Set(), installedFrom: new Map(),
    ownerContext: { get() {}, emit: (event, change) => { emitted.push({ event, change }); active.ctx.emit(event, change) } },
    listBundles: async () => [{ name, version: '1.0.0', installed: true, availability: 'profile', source: `${name}@1.0.0`, enabled: true }],
    registries: async () => ({ registry: 'https://registry.npmjs.org/', resolved: 'https://registry.npmjs.org/', fallbackRegistries: [] }), registryFor() {},
    askRegistries: async () => ({ status: 'answered', answer: manifest('2.0.0'), registry: 'https://registry.npmjs.org/' }),
    readRestoredFiles: async () => [], restoreFiles: async () => {},
    configure: operation => operation(), selectBundle: async () => {}, reportOperation() {},
    runPnpm: async () => {
      json(join(dir, 'package.json'), { dependencies: { [name]: '2.0.0' } })
      json(join(dir, 'node_modules', name, 'package.json'), manifest('2.0.0'))
      return { exitCode: 0, output: '' }
    },
  })
  const result = await manager.updateBundle(name, '2.0.0')
  assert.equal(result.result.application, 'restart-required')
  assert.equal(result.result.version, '2.0.0')
  assert.deepEqual(emitted, [{ event: 'plugin-manager/changed', change: { reason: 'install' } }])
  assert.deepEqual(active.checks, [{ cli: 'claude', force: true }, { cli: 'codex', force: true }])
})
