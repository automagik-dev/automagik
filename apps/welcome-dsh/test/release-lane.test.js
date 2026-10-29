// A welcome installed from a release tarball installs its siblings from the same release, and
// only after checking every one against the lane.json signed for that release: a tarball that
// does not match, a sibling the lane does not list, a bad or missing signature, a lane for
// another version, or no lane at all is refused, nothing is installed and no file is written.
// The same holds for each flow that installs siblings: Unfold, Omni and the Genie team step.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/host/endpoint.js'
import { OMNI_PLUGINS, UNFOLD_PLUGIN, UNFOLD_PLUGINS } from '../src/host/bot-types.js'
import { fakeContext } from './fake-ctx.js'
import { EVERYTHING, KEYS, RELEASE, V, entryOf, filesOf, laneOf, release, signatureOf, tarballOf, urlOf } from './lane-fixture.js'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })

function rig(t, files, { homeAs } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'welcome-lane-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const bundles = [{ name: PKG.name, availability: 'profile', enabled: true, source: urlOf({ dir: 'welcome-dsh' }), version: V }]
  const calls = []
  const manager = {
    async listBundles() { return structuredClone(bundles) },
    async installBundle(spec) {
      calls.push(spec)
      const plugin = EVERYTHING.find(entry => spec.includes(`${entry.name.replace('/', '+')}-${V}-`))
      if (!plugin) return { application: 'failed', error: { code: 'not-found', diagnostic: `${spec} is not a checked tarball` } }
      bundles.push({ name: plugin.name, availability: 'profile', enabled: true, version: V })
      return { application: 'restart-required', changed: true }
    },
    async setBundleEnabled() { return { application: 'applied', changed: true } },
  }
  const net = release(files)
  const team = { state: { bots: {} }, async load() {} }
  const fake = fakeContext({ entries: { 'omni-ai': {} }, services: { pluginManager: manager, omniTeam: team } })
  const env = { AUTOMAGIK_HOME: homeAs ?? home }
  const { handle } = install(fake.ctx, { env, checkClaude: noClaude, checkGit: async () => null, genieSkills: () => false, release: { fetch: net.fetch, keys: KEYS } })
  const dir = join(home, 'welcome', 'tarballs')
  const run = async (flow = 'unfold-plugin') => {
    const started = await handle(`${flow}-install`, {})
    assert.equal(started.ok, true, JSON.stringify(started.error))
    for (let i = 0; i < 200; i++) {
      const status = (await handle(flow, {})).value
      if (status.install?.phase !== 'installing') return status.install
      await new Promise(resolve => setTimeout(resolve, 1))
    }
    throw new Error(`the ${flow} install never ended`)
  }
  return { run, calls, dir, asked: net.asked }
}
const filesIn = dir => (existsSync(dir) ? readdirSync(dir) : [])

test('every sibling is checked against the release lane, kept 0600 at a stable path, and installed from it', async (t) => {
  const r = rig(t, filesOf())
  const done = await r.run()
  assert.equal(done.phase, 'restart', done.error)
  assert.equal(r.calls.length, EVERYTHING.length)
  for (const [i, spec] of r.calls.entries()) {
    const plugin = EVERYTHING[i]
    assert.equal(spec, join(r.dir, `${plugin.name.replace('/', '+')}-${V}-${entryOf(plugin).sha256}.tgz`))
    assert.deepEqual(readFileSync(spec), tarballOf(plugin))
    assert.equal(statSync(spec).mode & 0o777, 0o600, spec)
  }
  assert.equal(statSync(r.dir).mode & 0o777, 0o700)
  assert.deepEqual(filesIn(r.dir).sort(), r.calls.map(spec => spec.slice(r.dir.length + 1)).sort(), 'nothing else is left there')
})

const refused = [
  ['one flipped byte in a sibling tarball', () => {
    const bad = Buffer.from(tarballOf(UNFOLD_PLUGINS[2]))
    bad[3] ^= 1
    return filesOf({ tarballs: { [UNFOLD_PLUGINS[2].name]: bad } })
  }, /does not match the lane/],
  ['a sibling the lane does not list', () => filesOf({ lane: laneOf({ plugins: EVERYTHING.filter(p => p !== UNFOLD_PLUGINS[4]).map(p => entryOf(p)) }) }), /not in the release's lane/],
  ['a signature that does not match', () => filesOf({ sig: signatureOf(Buffer.from('another lane')) }), /signature/],
  ['no signature', () => filesOf({ sig: null }), /lane\.json\.sig: HTTP 404/],
  ['a lane for another version', () => {
    const lane = laneOf({ version: '3.0.0' })
    return filesOf({ lane })
  }, /is for 3\.0\.0/],
  ['no lane on the release', () => {
    const files = filesOf()
    delete files[`${RELEASE}lane.json`]
    return files
  }, /lane\.json: HTTP 404/],
  ['the last sibling failing, after every earlier one matched', () => {
    const bad = Buffer.concat([tarballOf(UNFOLD_PLUGIN), Buffer.from('x')])
    return filesOf({ tarballs: { [UNFOLD_PLUGIN.name]: bad } })
  }, /not the size the lane names/],
]
for (const [what, files, reason] of refused) {
  test(`refused, nothing installed and no file written: ${what}`, async (t) => {
    const r = rig(t, files())
    const done = await r.run()
    assert.equal(done.phase, 'failed')
    assert.match(done.error, reason)
    assert.deepEqual(r.calls, [], 'installBundle is never called')
    assert.deepEqual(filesIn(r.dir), [], 'no file under the tarball dir')
  })
}

const botTeamFlipped = () => {
  const bad = Buffer.from(tarballOf(OMNI_PLUGINS[0]))
  bad[3] ^= 1
  return filesOf({ tarballs: { [OMNI_PLUGINS[0].name]: bad } })
}
for (const [what, flow] of [['the Omni install', 'omni-plugins'], ['the Genie install\'s Bot team step', 'genie-plugin']]) {
  test(`refused, nothing installed and no file written: ${what}, with a flipped Bot team tarball`, async (t) => {
    const r = rig(t, botTeamFlipped())
    const done = await r.run(flow)
    assert.equal(done.phase, 'failed')
    assert.match(done.error, /does not match the lane/)
    assert.deepEqual(r.calls, [], 'installBundle is never called')
    assert.deepEqual(filesIn(r.dir), [], 'no file under the tarball dir')
  })
}

// The profile records the tarball's path, so it must not hang on the working directory.
for (const [what, homeAs] of [['a relative AUTOMAGIK_HOME', `welcome-home-${process.pid}`], ['a ~ AUTOMAGIK_HOME', `~/welcome-home-${process.pid}`]]) {
  test(`refused before anything is fetched or written: ${what}`, async (t) => {
    const where = join(process.cwd(), homeAs)
    t.after(() => {
      rmSync(where, { recursive: true, force: true })
      if (homeAs.startsWith('~/')) try { rmdirSync(join(process.cwd(), '~')) } catch {}
    })
    const r = rig(t, filesOf(), { homeAs })
    const done = await r.run()
    assert.equal(done.phase, 'failed')
    assert.match(done.error, /AUTOMAGIK_HOME is not an absolute path/)
    assert.deepEqual(r.calls, [], 'installBundle is never called')
    assert.deepEqual(r.asked, [], 'nothing is fetched')
    assert.equal(existsSync(where), false, 'nothing is written under the working directory')
  })
}
