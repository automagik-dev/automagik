// The Unfold Bot type (@automagik/unfold-bot-dsh) and Unfold's own instance: AUTOMAGIK_PRELOAD=unfold
// opens onboarding on Unfold, and AUTOMAGIK_HOST=unfold is the instance Unfold ships whole, with
// Omni and Genie inside it.
import { test } from 'node:test'
import PluginMarket from '@deepseek-ai/dsh-plugin-market'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_INSTALL } from '../src/host/ais.js'
import { install } from '../src/host/endpoint.js'
import { OMNI_PLUGINS, UNFOLD_PLUGIN, UNFOLD_PLUGINS, installTargetOf } from '../src/host/bot-types.js'
import { OMNI_BOT, UNFOLD_BOT } from '../src/host/companion.js'
import { hostOf } from '../src/host/host.js'
import { PRELOADS, preloadOf } from '../src/host/preload.js'
import { fakeContext } from './fake-ctx.js'
import { KEYS, filesOf, release } from './lane-fixture.js'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })
const OWN_LINK = 'link:/home/someone/automagik/apps/welcome-dsh'
const UNFOLD = { AUTOMAGIK_PRELOAD: 'unfold', AUTOMAGIK_HOST: 'unfold' }
const folder = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-ai-unfold-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// DSH's plugin manager over allowed release tarballs or linked apps; no npm package is published.
function fakeManager({ bundles = [{ name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK, version: PKG.version }], registry = new Set() } = {}) {
  const calls = []
  return {
    calls,
    bundles,
    async listBundles() { return structuredClone(bundles) },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      const linked = /^link:.*\/apps\/([\w-]+)$/.exec(spec)?.[1]
      const released = /\/automagik-([\w-]+)-[0-9][^/]*\.tgz$/.exec(spec)?.[1]
      // A release tarball welcome checked against the release's lane and kept.
      const checked = /\/@automagik\+([\w-]+)-[0-9][^/]*-[0-9a-f]{64}\.tgz$/.exec(spec)?.[1]
      const name = linked ? `@automagik/${linked}` : registry.has(spec) && released ? `@automagik/${released}` : checked ? `@automagik/${checked}` : undefined
      if (name === undefined) return { application: 'failed', error: { code: 'not-found', diagnostic: `${spec} is not in the registry` } }
      bundles.push({ name, availability: 'profile', enabled: true, version: PKG.version })
      return { application: 'restart-required', changed: true }
    },
    async setBundleEnabled(name, enabled) {
      calls.push(['enable', name, enabled])
      bundles.find(row => row.name === name).enabled = enabled
      return { application: 'applied', changed: true }
    },
  }
}

function host({ manager, team, env = {}, entries = { 'omni-ai': {} }, checkGit, genieSkills = () => false, genieCli, release } = {}) {
  const fake = fakeContext({ entries, services: { ...(manager ? { pluginManager: manager } : {}), ...(team ? { omniTeam: team } : {}) } })
  const { handle } = install(fake.ctx, { env, checkClaude: noClaude, ...(checkGit ? { checkGit } : {}), genieSkills, ...(genieCli ? { genieCli } : {}), ...(release ? { release } : {}) })
  return { ...fake, handle }
}
const value = async (fake, endpoint, payload) => {
  const reply = await fake.handle(endpoint, payload)
  assert.equal(reply.ok, true, JSON.stringify(reply.error))
  return reply.value
}
const settleUnfold = async (fake) => {
  for (let i = 0; i < 50; i++) {
    const status = await value(fake, 'unfold-plugin')
    if (status.install?.phase !== 'installing') return status
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('the Unfold install never ended')
}

test('unfold is a preload, and Unfold\'s instance (host kind or preload unfold) a host kind; nothing else is', () => {
  assert.ok(PRELOADS.includes('unfold'))
  assert.equal(preloadOf({ AUTOMAGIK_PRELOAD: ' Unfold ' }), 'unfold')
  assert.equal(hostOf({ AUTOMAGIK_HOST: 'unfold' }), 'unfold')
  assert.equal(hostOf({ AUTOMAGIK_PRELOAD: 'unfold' }), 'unfold')
  assert.equal(hostOf({ AUTOMAGIK_HOST: 'desktop' }), null)
  assert.equal(hostOf({ AUTOMAGIK_PRELOAD: 'genie' }), null)
  assert.equal(hostOf({}), null)
})

// The three packages that tell Unfold's instance apart install on their own, so each keeps the
// rule; this holds the three copies to one answer.
test('the Bot team, the Unfold Bot and the welcome tell Unfold\'s instance by one rule', async () => {
  const { inUnfoldInstance } = await import('../../bots-dsh/src/host/constants.js')
  const { unfoldLeads } = await import('../../unfold-bot-dsh/src/host/unfold.js')
  const envs = [{}, { AUTOMAGIK_HOST: 'unfold' }, { AUTOMAGIK_PRELOAD: 'unfold' }, UNFOLD, { AUTOMAGIK_HOST: ' Unfold ' }, { AUTOMAGIK_PRELOAD: 'genie' }, { AUTOMAGIK_HOST: 'desktop', AUTOMAGIK_PRELOAD: 'omni' }]
  for (const env of envs) {
    const want = env === envs[0] || env === envs[5] || env === envs[6] ? false : true
    assert.deepEqual([inUnfoldInstance(env), unfoldLeads(env), hostOf(env) === 'unfold'], [want, want, want], JSON.stringify(env))
  }
})

test('the Unfold Bot sits beside the Omni Bot: Unfold, of kind unfold', () => {
  assert.equal(OMNI_BOT.kind, 'omni')
  assert.deepEqual({ name: UNFOLD_BOT.name, kind: UNFOLD_BOT.kind }, { name: 'Unfold', kind: 'unfold' })
})

test('in Unfold\'s instance, the companion step is done (Unfold leads) and Omni is not chosen', async () => {
  // Named by its host kind, its preload, or both.
  for (const env of [{ AUTOMAGIK_PRELOAD: 'unfold' }, { AUTOMAGIK_HOST: 'unfold' }, UNFOLD]) {
    const state = await value(host({ env }), 'state')
    assert.deepEqual([state.preload, state.host, state.companionDone, state.companionName, state.teamOmni], ['unfold', 'unfold', true, 'Unfold', false], JSON.stringify(env))
  }
  // Elsewhere the companion step stays the person's.
  const plain = await value(host({ env: {} }), 'state')
  assert.equal(plain.companionDone, false)
  assert.equal(plain.teamOmni, true)
})

test('the Unfold type\'s plugins are the Bot type plugin\'s own defaults, then the plugin', () => {
  const source = readFileSync(new URL('../../unfold-bot-dsh/src/host/unfold.js', import.meta.url), 'utf8')
  const theirs = [...source.matchAll(/name: '(@automagik\/unfold-[\w-]+-dsh)'/g)].map(match => match[1])
  assert.deepEqual(UNFOLD_PLUGINS.map(plugin => plugin.name), theirs)
  assert.equal(UNFOLD_PLUGIN.name, '@automagik/unfold-bot-dsh')
  for (const plugin of [...UNFOLD_PLUGINS, UNFOLD_PLUGIN]) {
    assert.deepEqual(installTargetOf(plugin, OWN_LINK), { spec: `link:/home/someone/automagik/apps/${plugin.dir}`, options: {} })
    assert.deepEqual(installTargetOf(plugin, undefined), { spec: `https://github.com/automagik-dev/automagik/releases/download/v${PKG.version}/automagik-${plugin.dir}-${PKG.version}.tgz`, options: {} })
  }
})

test('release and absent welcome sources resolve every Automagik plugin to a release tarball', () => {
  const version = '3.35.2'
  const ownRelease = `https://github.com/automagik-dev/automagik/releases/download/v${version}/automagik-welcome-dsh-${version}.tgz`
  for (const source of [ownRelease, undefined]) {
    for (const plugin of [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN]) {
      assert.deepEqual(installTargetOf(plugin, source, version), {
        spec: `https://github.com/automagik-dev/automagik/releases/download/v${version}/automagik-${plugin.dir}-${version}.tgz`,
        options: {},
      })
    }
  }
})

test('outside Unfold\'s own instance nothing of Unfold\'s installs: no unfold-* plugin, no git', async (t) => {
  // Even where every release tarball would resolve, the install is refused before any of it runs.
  const bundles = [{ name: PKG.name, availability: 'profile', enabled: true, source: `https://github.com/automagik-dev/automagik/releases/download/v${PKG.version}/automagik-welcome-dsh-${PKG.version}.tgz`, version: PKG.version }]
  const everything = [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN]
  const manager = fakeManager({ bundles, registry: new Set(everything.map(plugin => `https://github.com/automagik-dev/automagik/releases/download/v${PKG.version}/automagik-${plugin.dir}-${PKG.version}.tgz`)) })
  let gitChecks = 0
  const team = { state: { bots: {} }, async load() {} }
  const home = folder(t)
  const net = release(filesOf())
  for (const env of [{ AUTOMAGIK_HOME: home }, { AUTOMAGIK_HOME: home, AUTOMAGIK_PRELOAD: 'omni' }, { AUTOMAGIK_HOME: home, AUTOMAGIK_HOST: 'desktop' }]) {
    const fake = host({ manager, team, env, release: { fetch: net.fetch, keys: KEYS }, checkGit: async () => { gitChecks += 1; return null } })
    const reply = await fake.handle('unfold-plugin-install')
    assert.equal(reply.ok, false, JSON.stringify(env))
    assert.equal(reply.error.code, 'omni-ai/refused')
    const status = await value(fake, 'unfold-plugin')
    assert.equal(status.install, null)
    assert.equal(status.canInstall, false, JSON.stringify(env))
  }
  assert.deepEqual(manager.calls, [])
  assert.equal(gitChecks, 0)
})

test('in Unfold\'s own instance everything is preinstalled: choosing Unfold installs nothing and checks no git', async () => {
  const preinstalled = [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN].map(plugin => ({ name: plugin.name, availability: 'profile', enabled: true, version: PKG.version }))
  const manager = fakeManager({ bundles: [{ name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK, version: PKG.version }, ...preinstalled] })
  let gitChecks = 0
  const team = { state: { bots: { u: { id: 'u', name: 'Unfold', kind: 'unfold' } } }, async load() {} }
  const fake = host({ manager, team, env: UNFOLD, checkGit: async () => { gitChecks += 1; return null } })
  const status = await value(fake, 'unfold-plugin')
  assert.equal(status.ready, true)
  assert.equal(status.canInstall, true)
  assert.ok(status.plugins.every(row => row.installed === true))
  await value(fake, 'unfold-plugin-install')
  assert.equal((await settleUnfold(fake)).install.phase, 'done')
  assert.deepEqual(manager.calls, [])
  assert.equal(gitChecks, 0)
})

// Unfold's instance reaches its plugins only through Unfold's own pack: with a bundled plugin
// missing or switched off, a power button (or any page script posting the install endpoints)
// switches on what is there and installs nothing, from npm or git.
test('in Unfold\'s instance a missing bundled plugin installs nothing: no npm, no git, a fixed error', async () => {
  const settle = async (fake, endpoint, phaseOf) => {
    for (let i = 0; i < 50; i++) {
      const status = await value(fake, endpoint)
      if (phaseOf(status) !== 'installing') return status
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    throw new Error(`${endpoint} never ended`)
  }
  const own = { name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK, version: PKG.version }
  const row = (plugin, enabled = true) => ({ name: plugin.name, availability: 'profile', enabled, version: PKG.version })
  const cases = [
    // Genie's plugin missing from the pack.
    ['genie-plugin', [row(OMNI_PLUGINS[0])], status => status.install?.phase],
    // One Unfold plugin removed on the Plugins page; the Bot team switched off.
    ['unfold-plugin', [row(OMNI_PLUGINS[0], false), ...UNFOLD_PLUGINS.slice(1).map(plugin => row(plugin)), row(UNFOLD_PLUGIN)], status => status.install?.phase],
    // Omni's canvases missing.
    ['omni-plugins', OMNI_PLUGINS.slice(0, 2).map(plugin => row(plugin)), status => status.install?.phase],
  ]
  for (const [endpoint, rows, phaseOf] of cases) {
    // Every spec resolves: an install would succeed, so only the guard stops it.
    const manager = fakeManager({ bundles: [own, ...rows], registry: new Set([...OMNI_PLUGINS, ...UNFOLD_PLUGINS, UNFOLD_PLUGIN].map(plugin => `https://github.com/automagik-dev/automagik/releases/download/v${PKG.version}/automagik-${plugin.dir}-${PKG.version}.tgz`)) })
    let gitChecks = 0
    const fake = host({ manager, team: { state: { bots: {} }, async load() {} }, env: UNFOLD, checkGit: async () => { gitChecks += 1; return null } })
    await value(fake, `${endpoint}-install`)
    const status = await settle(fake, endpoint, phaseOf)
    assert.equal(status.install.phase, 'failed', endpoint)
    assert.match(status.install.error, /Unfold brings this plugin, and it is missing from this instance\./, endpoint)
    assert.deepEqual(manager.calls.filter(([kind]) => kind === 'install'), [], endpoint)
    assert.equal(gitChecks, 0, endpoint)
  }
  // A bundled plugin that is only switched off is switched back on, and nothing installs.
  const off = fakeManager({ bundles: [own, row(OMNI_PLUGINS[0], false), ...UNFOLD_PLUGINS.map(plugin => row(plugin)), row(UNFOLD_PLUGIN)] })
  const fake = host({ manager: off, team: { state: { bots: {} }, async load() {} }, env: UNFOLD })
  await value(fake, 'unfold-plugin-install')
  assert.equal((await settleUnfold(fake)).install.phase, 'done')
  assert.deepEqual(off.calls, [['enable', OMNI_PLUGINS[0].name, true]])
})

test('under AUTOMAGIK_HOST=unfold, Genie\'s card never carries the curl line: its CLI is the bundled one', async (t) => {
  const bin = join(folder(t), 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'genie'), '#!/bin/sh\n')
  chmodSync(join(bin, 'genie'), 0o755)
  const bundled = await value(host({ manager: fakeManager(), env: { ...UNFOLD, PATH: `/nowhere:${bin}` } }), 'genie-plugin')
  assert.equal(bundled.cli, join(bin, 'genie'))
  assert.equal(bundled.cliBundled, true)
  const none = await value(host({ manager: fakeManager(), env: { ...UNFOLD, PATH: '/nowhere' } }), 'genie-plugin')
  assert.equal(none.cli, null)
  for (const reply of [bundled, none]) {
    assert.doesNotMatch(String(reply.cli), /curl/)
    assert.doesNotMatch(String(reply.cli), /\| *bash/)
  }
  // Elsewhere the card keeps the line that installs it.
  assert.match((await value(host({ manager: fakeManager(), env: {} }), 'genie-plugin')).cli, /^curl /)
})

// A command named genie on the PATH that is not Genie's command line: an app that embeds DSH may
// put a stand-in there that refuses to run (exit 127, one line on stderr), or one that never
// answers. The script answers only `--version`, so the card must ask with exactly that.
const genieOn = (t, script) => {
  const bin = join(folder(t), 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'genie'), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, 'genie'), 0o755)
  return bin
}

test('under AUTOMAGIK_HOST=unfold, a genie that fails --version is not installed: the card never shows its path', async (t) => {
  const standIn = genieOn(t, 'echo "genie: this app does not include Genie" >&2\nexit 127')
  const refused = await value(host({ manager: fakeManager(), env: { ...UNFOLD, PATH: standIn } }), 'genie-plugin')
  assert.equal(refused.cli, null)
  assert.equal(refused.cliBundled, true)
  const working = genieOn(t, '[ "$1" = --version ] || exit 2\necho "genie 1.0.0"')
  assert.equal((await value(host({ manager: fakeManager(), env: { ...UNFOLD, PATH: working } }), 'genie-plugin')).cli, join(working, 'genie'))
  assert.equal((await value(host({ manager: fakeManager(), env: { ...UNFOLD, PATH: '/nowhere' } }), 'genie-plugin')).cli, null)
})

test('under AUTOMAGIK_HOST=unfold, a genie that never answers --version is not installed, and the card does not wait for it', async (t) => {
  const silent = genieOn(t, 'while :; do sleep 1; done')
  const t0 = performance.now()
  const hung = await value(host({ manager: fakeManager(), env: { ...UNFOLD, PATH: silent } }), 'genie-plugin')
  assert.equal(hung.cli, null)
  assert.ok(performance.now() - t0 < 4000, `the card answered after ${Math.round(performance.now() - t0)} ms`)
})

test('without dsh-oh-my-claude, the first step finished still finishes', async (t) => {
  // Its state folder cannot be made: a file stands where it would go.
  const dir = folder(t)
  writeFileSync(join(dir, 'omc'), 'not a folder')
  const fake = fakeContext({ entries: { 'omni-ai': {} } })
  const { handle } = install(fake.ctx, { env: UNFOLD, checkClaude: noClaude, hintsFile: join(dir, 'omc', 'hints.json') })
  const reply = await handle('done', { stepId: 'omni-team' })
  assert.equal(reply.ok, true)
  assert.deepEqual(reply.value, { teamDone: true })
})

test('Claude Code\'s install line comes with its row, never in the page; Unfold\'s instance sends none', async () => {
  const claude = async (env) => {
    const fake = fakeContext({ entries: { 'omni-ai': {}, 'llm-pi-ai': { providers: {} } } })
    const { handle } = install(fake.ctx, { env, checkClaude: async () => ({ plugin: true, installed: false, loggedIn: false }) })
    return (await handle('ais')).value.rows.find(row => row.id === 'claude')
  }
  const elsewhere = await claude({})
  assert.equal(elsewhere.needs, 'install')
  assert.equal(elsewhere.install, CLAUDE_INSTALL)
  const instance = await claude(UNFOLD)
  assert.equal(instance.needs, 'install')
  assert.equal('install' in instance, false)
})

// Unfold's product overlay sets DSH's plugin-market.indexes to [] (installs reach the instance only
// through Unfold's pack). DSH's own market service lists what the Plugins page shows as sources.
test('the overlay\'s empty plugin-market.indexes shows as no market source on the Plugins page', () => {
  // The overlay's value goes through DSH's own config schema, as the profile's would.
  const sourcesFor = indexes => PluginMarket.prototype.listIndexes.call({ sources: PluginMarket.prototype.sources, config: PluginMarket.Config({ indexes }), cache: new Map(), errors: new Map() })
  assert.deepEqual(sourcesFor([]), [])
  // The Automagik app's profile lists its own market: one source.
  const automagik = 'https://raw.githubusercontent.com/automagik-dev/dsh-marketplace/main/index.json'
  assert.deepEqual(sourcesFor([automagik]).map(source => source.url), [automagik])
})

test('Unfold installs bundles, leaving its carried SSE library out of the plugin manager', () => {
  assert.ok(!UNFOLD_PLUGINS.some(plugin => plugin.name === '@automagik/unfold-sse-dsh'))
  for (const plugin of [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN]) {
    const manifest = JSON.parse(readFileSync(new URL(`../../${plugin.dir}/package.json`, import.meta.url), 'utf8'))
    assert.equal(typeof manifest.dsh?.bundle?.patch, 'string', `${plugin.name} must be installable by DSH installBundle`)
  }
})
