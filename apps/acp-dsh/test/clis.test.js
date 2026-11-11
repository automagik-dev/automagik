// No network, global tools, credentials or live profile: package managers and CLIs are fakes.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { AGENTS } from '../src/host/agents.js'
import { CliHomes, HOME_ENV } from '../src/host/cli-homes.js'
import { CliStore, CLI_CHECK_EVERY_MS, cliLayout, cliPlatform, cliVersion, installCli } from '../src/host/clis.js'

const CLAUDE = AGENTS['acp-claude']
const CODEX = AGENTS['acp-codex']
const PLATFORM = { platform: 'linux', arch: 'x64', musl: false }
const scratch = t => {
  const home = mkdtempSync(join(tmpdir(), 'automagik-cli-test-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
const executable = (path, version) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, version, { mode: 0o755 })
  chmodSync(path, 0o755)
  return path
}
const fakeInstall = async (dir, spec, version, env, { platform }) => {
  executable(join(dir, cliLayout(spec, version, platform).bins[0]), version)
}
const fakeVersion = async path => { try { return readFileSync(path, 'utf8') } catch { return undefined } }
const storeOf = (home, overrides = {}) => new CliStore({ home, platform: PLATFORM, latest: async () => '2.0.0', install: fakeInstall, versionOf: fakeVersion, ...overrides })

test('external and staged version probes use vendor homes; installation keeps its own env',
  async t => {
    const root = scratch(t)
    const env = { HOME: join(root, 'terminal'), CODEX_HOME: join(root, 'terminal-codex'),
      CLAUDE_CONFIG_DIR: join(root, 'terminal-claude'), OPENAI_API_KEY: 'invented-terminal',
      AUTOMAGIK_PNPM: '/fake/manager', PATH: '/fake/runtime' }
    const queries = []
    const installs = []
    const store = storeOf(join(root, 'clis'), {
      env,
      versionOf: async (path, { env: isolated }) => {
        queries.push({ path, env: isolated })
        return fakeVersion(path)
      },
      install: async (...args) => { installs.push(args[3]); await fakeInstall(...args) },
    })
    t.after(() => store.dispose())
    for (const spec of [CLAUDE, CODEX]) {
      const own = executable(join(root, 'terminal-bin', spec.key), '1.0.0')
      await store.ensure(spec, own)
      const calls = queries.filter(call => call.env.HOME.endsWith(spec.key))
      assert.equal(calls.length, 2, 'external and freshly installed binaries are both checked')
      for (const { env: isolated } of calls) {
        assert.equal(isolated.HOME, join(root, 'cli-homes', spec.key))
        assert.equal(isolated.CLAUDE_CONFIG_DIR, join(isolated.HOME, '.claude'))
        assert.equal(isolated.CODEX_HOME, join(isolated.HOME, '.codex'))
        assert.equal(isolated.OPENAI_API_KEY, undefined)
        assert.equal(isolated.AUTOMAGIK_PNPM, undefined)
      }
    }
    assert.equal(installs.length, 2)
    for (const installEnv of installs) assert.equal(installEnv, env)
  })

test('version execution keeps isolated cwd and env without restoring inherited credentials',
  async t => {
    const homes = new CliHomes(scratch(t))
    t.after(() => homes.dispose())
    const env = homes.environment('codex', { OPENAI_API_KEY: 'invented-terminal' })
    let seen
    const version = await cliVersion('/fake/codex', { env,
      run: (file, args, options, done) => {
        seen = { file, args, options }
        done(null, 'codex-cli 2.0.0')
      },
    })
    assert.equal(version, '2.0.0')
    assert.equal(seen.options.cwd, env[HOME_ENV])
    assert.equal(seen.options.env.OPENAI_API_KEY, undefined)
    assert.equal(seen.options.env.CODEX_HOME, env.CODEX_HOME)
    assert.deepEqual(seen.args, ['--version'])
  })

test('native layout covers supported desktop platforms, musl, and Rosetta without shell commands', () => {
  for (const platform of ['linux', 'darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
    const host = cliPlatform({ platform, arch, musl: false, translated: false })
    const claude = cliLayout(CLAUDE, '2.0.0', host)
    const codex = cliLayout(CODEX, '1.0.0', host)
    assert.equal(claude.pkg, `@anthropic-ai/claude-code-${platform}-${arch}`)
    assert.equal(codex.dependency, `npm:@openai/codex@1.0.0-${platform}-${arch}`)
    assert.equal(claude.bins[0].endsWith('.exe'), platform === 'win32')
    assert.equal(codex.bins[0].endsWith('.exe'), platform === 'win32')
  }
  assert.match(cliLayout(CLAUDE, '2.0.0', cliPlatform({ platform: 'linux', arch: 'arm64', musl: true })).pkg, /linux-arm64-musl$/)
  assert.equal(cliPlatform({ platform: 'darwin', arch: 'x64', translated: true }).arch, 'arm64')
  assert.throws(() => cliPlatform({ platform: 'linux', arch: 'ia32' }), /do not support/)
})

test('the desktop package manager installs only locally, with exact official native dependencies and scripts disabled', async t => {
  const home = scratch(t)
  const manager = executable(join(home, 'pnpm'), 'fake')
  const env = { AUTOMAGIK_PNPM: manager, HOME: join(home, 'user'), HTTP_PROXY: 'http://test-proxy.invalid' }
  for (const spec of [CLAUDE, CODEX]) {
    let invocation
    await installCli(home, spec, '2.0.0', env, { platform: PLATFORM, run: async (...args) => { invocation = args } })
    const [command, args, options] = invocation
    assert.equal(command, manager)
    assert.equal(args.includes('--ignore-scripts'), true)
    assert.equal(args.includes('-g'), false)
    assert.equal(options.cwd, home)
    assert.equal(options.env.HOME, env.HOME)
    assert.equal(options.env.HTTP_PROXY, env.HTTP_PROXY)
    const manifest = JSON.parse(readFileSync(join(home, 'package.json')))
    assert.equal(manifest.dependencies[spec.cliPackage], '2.0.0')
    const layout = cliLayout(spec, '2.0.0', PLATFORM)
    assert.equal(manifest.dependencies[layout.pkg], layout.dependency)
    assert.deepEqual(manifest.pnpm.supportedArchitectures, { os: ['linux'], cpu: ['x64'], libc: ['glibc'] })
  }
  await assert.rejects(installCli(home, CLAUDE, '2.0.0', {}, { platform: PLATFORM }), /restart Automagik and retry/)
})

test('first initialization resolves latest, installs both required binaries and never writes user configuration', async t => {
  const home = scratch(t)
  const config = join(home, 'user-settings.json')
  writeFileSync(config, 'keep my settings')
  const fetched = []
  const store = storeOf(join(home, 'managed'), { latest: async pkg => { fetched.push(pkg); return '2.0.0' } })
  for (const spec of [CLAUDE, CODEX]) {
    assert.equal(store.find(spec), undefined)
    const found = await store.ensure(spec)
    assert.equal(found.version, '2.0.0')
    assert.equal(found.managed, true)
    assert.equal(readFileSync(found.path, 'utf8'), '2.0.0')
    assert.equal(store.find(spec).path, found.path)
  }
  assert.deepEqual(fetched, [CLAUDE.cliPackage, CODEX.cliPackage])
  assert.equal(readFileSync(config, 'utf8'), 'keep my settings')
})

test('checks every fifteen minutes, preserves running native binaries, and never downgrades the managed release', async t => {
  const home = scratch(t)
  let version = '2.0.0'
  let now = 1000
  let checks = 0
  const store = storeOf(home, { now: () => now, latest: async () => { checks++; return version } })
  const before = await store.ensure(CLAUDE)
  version = '2.1.0'
  assert.equal((await store.ensure(CLAUDE)).path, before.path)
  assert.equal(checks, 1)
  now += CLI_CHECK_EVERY_MS
  const after = await store.ensure(CLAUDE)
  assert.equal(after.version, '2.1.0')
  assert.equal(existsSync(before.path), true)
  version = '2.0.0'
  now += CLI_CHECK_EVERY_MS
  assert.equal((await store.ensure(CLAUDE)).path, after.path)
})

test('a newer user CLI is reused untouched; an older one gets a separate managed upgrade', async t => {
  const home = scratch(t)
  const own = executable(join(home, 'user', 'claude'), '3.0.0')
  let installs = 0
  const store = storeOf(join(home, 'managed'), { install: async (...args) => { installs++; await fakeInstall(...args) } })
  assert.deepEqual(await store.ensure(CLAUDE, own), { path: own, version: '3.0.0', managed: false })
  assert.equal(installs, 0)
  assert.equal(readFileSync(own, 'utf8'), '3.0.0')
  writeFileSync(own, '1.0.0')
  const upgraded = await store.ensure(CLAUDE, own, { force: true })
  assert.equal(upgraded.managed, true)
  assert.notEqual(upgraded.path, own)
  assert.equal(readFileSync(own, 'utf8'), '1.0.0')
})

test('offline or failed upgrade leaves the previous CLI usable; explicit retry clears its redacted diagnostic', async t => {
  const home = scratch(t)
  let failure = false
  const store = storeOf(home, { latest: async () => { if (failure) throw new Error('network failed: ANTHROPIC_API_KEY=sk-ant-secret-test'); return '2.0.0' } })
  const before = await store.ensure(CLAUDE)
  failure = true
  await assert.rejects(store.ensure(CLAUDE, undefined, { force: true }), /network failed/)
  assert.equal(store.find(CLAUDE).path, before.path)
  const diagnostic = store.lastFailure(CLAUDE.cliPackage)
  assert.ok(diagnostic.message)
  assert.equal(diagnostic.diagnostic.includes('sk-ant-secret-test'), false)
  assert.equal(readFileSync(diagnostic.logPath, 'utf8').includes('sk-ant-secret-test'), false)
  failure = false
  await store.ensure(CLAUDE, undefined, { force: true })
  assert.equal(store.lastFailure(CLAUDE.cliPackage), undefined)
})

test('an offline restart retains the verified managed upgrade instead of falling back to an older global CLI', async t => {
  const home = scratch(t)
  const own = executable(join(home, 'user', 'claude'), '1.0.0')
  const managedHome = join(home, 'managed')
  const installed = await storeOf(managedHome).ensure(CLAUDE, own)
  const restarted = storeOf(managedHome, { latest: async () => { throw new Error('offline') } })
  assert.equal(restarted.find(CLAUDE, own).path, installed.path)
  await assert.rejects(restarted.ensure(CLAUDE, own), /offline/)
  assert.equal(restarted.find(CLAUDE, own).path, installed.path)
  assert.equal(readFileSync(own, 'utf8'), '1.0.0')
})

test('an offline restart discovers a newer personal CLI before a failed registry request', async t => {
  const home = scratch(t)
  const managedHome = join(home, 'managed')
  const installed = await storeOf(managedHome).ensure(CLAUDE)
  const own = executable(join(home, 'user', 'claude'), '3.0.0')
  const restarted = storeOf(managedHome, { latest: async () => { throw new Error('offline') } })
  await assert.rejects(restarted.ensure(CLAUDE, own), /offline/)
  assert.deepEqual(restarted.find(CLAUDE, own), { path: own, version: '3.0.0', managed: false })
  assert.equal(existsSync(installed.path), true)
  assert.equal(readFileSync(own, 'utf8'), '3.0.0')
})

test('an unverifiable user wrapper stays untouched while Automagik selects a verified managed release', async t => {
  const home = scratch(t)
  const own = executable(join(home, 'user', 'codex'), 'custom wrapper')
  const store = storeOf(join(home, 'managed'), {
    versionOf: async path => path === own ? undefined : fakeVersion(path),
  })
  const found = await store.ensure(CODEX, own)
  assert.equal(found.managed, true)
  assert.equal(found.version, '2.0.0')
  assert.notEqual(found.path, own)
  assert.equal(readFileSync(own, 'utf8'), 'custom wrapper')
  assert.equal(store.find(CODEX, own).path, found.path)
})

test('a missing, unusable or prerelease binary is not published as installed', async t => {
  for (const overrides of [
    { install: async () => {} },
    { versionOf: async () => undefined },
    { latest: async () => '2.0.0-beta.1' },
    { latest: async () => '../../outside' },
  ]) {
    const home = scratch(t)
    const store = storeOf(home, overrides)
    await assert.rejects(store.ensure(CODEX))
    assert.equal(store.find(CODEX), undefined)
    assert.equal(existsSync(join(home, 'openai__codex', 'current.json')), false)
    const entries = existsSync(join(home, 'openai__codex')) ? readdirSync(join(home, 'openai__codex')) : []
    assert.equal(entries.some(name => name.startsWith('.install-')), false)
  }
})

test('concurrent requests share an install, and quitting removes staging without publication', async t => {
  const home = scratch(t)
  let complete
  let entered
  const ready = new Promise(resolve => { entered = resolve })
  const store = storeOf(home, { install: async (...args) => { await fakeInstall(...args); entered(); await new Promise(resolve => { complete = resolve }) } })
  const first = store.ensure(CLAUDE)
  assert.equal(store.ensure(CLAUDE), first)
  await ready
  assert.equal(store.busy(CLAUDE.cliPackage), true)
  store.dispose()
  complete()
  await assert.rejects(first)
  assert.equal(store.find(CLAUDE), undefined)
  assert.equal(readdirSync(join(home, 'anthropic-ai__claude-code')).some(name => name.startsWith('.install-')), false)
})

test('two desktop processes publishing out of order always discover the newest completed native version', async t => {
  const home = scratch(t)
  let finishOld
  let entered
  const ready = new Promise(resolve => { entered = resolve })
  const old = storeOf(home, { latest: async () => '1.0.0', install: async (...args) => { await fakeInstall(...args); entered(); await new Promise(resolve => { finishOld = resolve }) } })
  const older = old.ensure(CODEX)
  await ready
  const newest = await storeOf(home).ensure(CODEX)
  finishOld()
  assert.equal((await older).version, '2.0.0')
  assert.equal(storeOf(home).find(CODEX).path, newest.path)
})

test('version checks accept official native output, never login, and reject failed or prerelease commands', async () => {
  for (const [stdout, error, expected] of [['2.1.319 (Claude Code)\n', null, '2.1.319'], ['codex-cli 0.167.0\n', null, '0.167.0'], ['codex-cli 0.167.0-beta.1\n', null, undefined], ['2.1.319\n', new Error('failed'), undefined]]) {
    assert.equal(await cliVersion('/fake/cli', { run: (file, args, options, callback) => {
      assert.equal(file, '/fake/cli')
      assert.deepEqual(args, ['--version'])
      assert.equal(options.env.DISABLE_UPDATES, '1')
      callback(error, stdout)
    } }), expected)
  }
})
