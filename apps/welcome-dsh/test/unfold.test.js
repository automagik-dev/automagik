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

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })
const OWN_LINK = 'link:/home/someone/automagik/apps/welcome-dsh'
const UNFOLD = { AUTOMAGIK_PRELOAD: 'unfold', AUTOMAGIK_HOST: 'unfold' }
const folder = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-ai-unfold-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// DSH's plugin manager over a fake registry: an install resolves only a spec the registry
// holds (this repository's release, or a link to one of its apps), as pnpm would.
function fakeManager({ bundles = [{ name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK, version: PKG.version }], registry = new Set() } = {}) {
  const calls = []
  return {
    calls,
    bundles,
    async listBundles() { return structuredClone(bundles) },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      const linked = /^link:.*\/apps\/([\w-]+)$/.exec(spec)?.[1]
      const name = linked ? `@automagik/${linked}` : registry.has(spec) ? spec.slice(0, spec.lastIndexOf('@')) : undefined
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

function host({ manager, team, env = {}, entries = { 'omni-ai': {} }, checkGit, genieSkills = () => false, genieCli } = {}) {
  const fake = fakeContext({ entries, services: { ...(manager ? { pluginManager: manager } : {}), ...(team ? { omniTeam: team } : {}) } })
  const { handle } = install(fake.ctx, { env, checkClaude: noClaude, ...(checkGit ? { checkGit } : {}), genieSkills, ...(genieCli ? { genieCli } : {}) })
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
    assert.deepEqual(installTargetOf(plugin, undefined), { spec: `${plugin.name}@${PKG.version}`, options: { saveExact: true } })
  }
})

test('in the Automagik app, powering Unfold on installs the Bot team, its defaults and Unfold, with no git', async () => {
  // The app's own welcome came from a release: every spec is that release, from the registry.
  const bundles = [{ name: PKG.name, availability: 'profile', enabled: true, source: `${PKG.name}@${PKG.version}`, version: PKG.version }]
  const everything = [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN]
  const manager = fakeManager({ bundles, registry: new Set(everything.map(plugin => `${plugin.name}@${PKG.version}`)) })
  let gitChecks = 0
  const team = { state: { bots: {} }, async load() {} }
  const fake = host({ manager, team, checkGit: async () => { gitChecks += 1; return null } })
  const before = await value(fake, 'unfold-plugin')
  assert.equal(before.ready, false)
  assert.equal(before.canInstall, true)
  assert.deepEqual(before.plugins.map(row => [row.name, row.installed]), everything.map(plugin => [plugin.name, false]))
  await value(fake, 'unfold-plugin-install')
  const after = await settleUnfold(fake)
  assert.equal(after.install.phase, 'restart', after.install.error)
  assert.deepEqual(manager.calls.map(([, spec]) => spec), everything.map(plugin => `${plugin.name}@${PKG.version}`))
  assert.equal(gitChecks, 0)
  // Ready once the plugin has made its Bot.
  team.state.bots.u = { id: 'u', name: 'Unfold', kind: 'unfold' }
  const ready = await value(fake, 'unfold-plugin')
  assert.equal(ready.ready, true)
  assert.deepEqual(ready.bot, { id: 'u', name: 'Unfold' })
})

test('in Unfold\'s own instance everything is preinstalled: choosing Unfold installs nothing and checks no git', async () => {
  const preinstalled = [OMNI_PLUGINS[0], ...UNFOLD_PLUGINS, UNFOLD_PLUGIN].map(plugin => ({ name: plugin.name, availability: 'profile', enabled: true, version: PKG.version }))
  const manager = fakeManager({ bundles: [{ name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK, version: PKG.version }, ...preinstalled] })
  let gitChecks = 0
  const team = { state: { bots: { u: { id: 'u', name: 'Unfold', kind: 'unfold' } } }, async load() {} }
  const fake = host({ manager, team, env: UNFOLD, checkGit: async () => { gitChecks += 1; return null } })
  const status = await value(fake, 'unfold-plugin')
  assert.equal(status.ready, true)
  assert.ok(status.plugins.every(row => row.installed === true))
  await value(fake, 'unfold-plugin-install')
  assert.equal((await settleUnfold(fake)).install.phase, 'done')
  assert.deepEqual(manager.calls, [])
  assert.equal(gitChecks, 0)
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
