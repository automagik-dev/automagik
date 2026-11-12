import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { LANE_KEYS } from '../src/lane-keys.js'
import { PUBLISHERS, beforeStart, carryDependencies, confirm, laneMemory, laneUpdate, satisfies, stage, stagedOf, stagedVersion, trialFailed, verifyLane } from '../src/lane.js'
import { updatePresentation } from '../src/frame.js'
import { tarOf } from '../src/tar.js'

const temp = (t) => { const dir = mkdtempSync(join(tmpdir(), 'lane-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }
const automagik = PUBLISHERS.find(entry => entry.publisher === 'automagik')
const lane = (patch = {}) => ({
  schemaVersion: 1, publisher: 'automagik', keyId: 'k1', sequence: 220001, issuedAt: '2026-10-26T03:00:00Z', version: '3.22.1', base: '3.22.0',
  plugins: [{ name: '@automagik/bots-dsh', version: '3.22.1', url: 'https://github.com/automagik-si/automagik/releases/download/v3.22.1/automagik-bots-dsh-3.22.1.tgz', integrity: 'sha512-x', sha256: 'y', size: 1, engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }],
  ...patch,
})
const context = { publisher: automagik, appVersion: '3.22.0', dshVersion: '0.2.1-rc.3', installed: { '@automagik/bots-dsh': '3.22.0', '@automagik/welcome-dsh': '3.22.0' } }

test('the app trusts the keys the repository publishes', () => {
  const published = JSON.parse(readFileSync(new URL('../../../plugin-lane/keys.json', import.meta.url), 'utf8')).keys
  assert.deepEqual(LANE_KEYS.automagik.map(key => ({ ...key })), published)
  // Each publisher's keys are its own: Genie's never open Automagik's lane.
  assert.ok(!LANE_KEYS.genie.some(key => published.some(own => own.publicKey === key.publicKey)))
})

test('a lane opens only with its signer\'s key, byte for byte', () => {
  const pair = generateKeyPairSync('ed25519')
  const keys = [{ keyId: 'k1', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }]
  const bytes = Buffer.from(JSON.stringify(lane()))
  const signature = sign(null, bytes, pair.privateKey).toString('base64')
  assert.equal(verifyLane(bytes, signature, keys).version, '3.22.1')
  assert.throws(() => verifyLane(Buffer.from(JSON.stringify(lane({ version: '3.99.0' }))), signature, keys), /signature/)
  assert.throws(() => verifyLane(bytes, signature, [{ keyId: 'other', publicKey: keys[0].publicKey }]), /no key/)
})

test('Genie\'s lane is taken on any app at or past its base, and only for its own plugin', () => {
  const genie = PUBLISHERS.find(entry => entry.publisher === 'genie')
  const own = { schemaVersion: 1, publisher: 'genie', keyId: 'genie-2026-10', sequence: 10002, version: '0.1.2', base: '3.3.0', plugins: [{ name: '@automagik/genie-dsh', version: '0.1.2', url: 'https://github.com/automagik-si/genie/releases/download/v0.1.2/genie-dsh-0.1.2.tgz', engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }] }
  const installed = { '@automagik/genie-dsh': '0.1.1' }
  assert.deepEqual(laneUpdate(own, { publisher: genie, appVersion: '3.25.0', dshVersion: '0.2.1-rc.3', installed })?.plugins.map(plugin => plugin.name), ['@automagik/genie-dsh'])
  assert.equal(laneUpdate(own, { publisher: genie, appVersion: '3.2.0', dshVersion: '0.2.1-rc.3', installed }), null)
  // Not installed here (a team without Genie): nothing to update.
  assert.equal(laneUpdate(own, { publisher: genie, appVersion: '3.25.0', dshVersion: '0.2.1-rc.3', installed: {} }), null)
  // Genie's lane cannot name Automagik's plugins, nor Automagik's Genie's.
  assert.equal(laneUpdate({ ...own, plugins: [{ ...own.plugins[0], name: '@automagik/bots-dsh', version: '9.0.0' }] }, { publisher: genie, appVersion: '3.25.0', dshVersion: '0.2.1-rc.3', installed: { '@automagik/bots-dsh': '3.25.0' } }), null)
  assert.equal(laneUpdate({ ...own, publisher: 'automagik' }, { publisher: genie, appVersion: '3.25.0', dshVersion: '0.2.1-rc.3', installed }), null)
})

test('engines ranges read as DSH reads them, prereleases included', () => {
  for (const version of ['0.2.1-rc.3', '0.2.1-rc.10', '0.2.1']) assert.equal(satisfies(version, '>=0.2.1-rc.3 <0.2.2-0'), true, version)
  for (const version of ['0.2.1-rc.2', '0.2.2', '0.2.2-alpha.1', '0.3.0']) assert.equal(satisfies(version, '>=0.2.1-rc.3 <0.2.2-0'), false, version)
  assert.equal(satisfies('0.2.1', ''), false)
})

test('the app takes a lane meant for it, and nothing else', () => {
  assert.deepEqual(laneUpdate(lane(), context)?.plugins.map(plugin => plugin.name), ['@automagik/bots-dsh'])
  // Another 3.N waits for its own app; an older lane is a replay; a failed version stays out.
  assert.equal(laneUpdate(lane(), { ...context, appVersion: '3.21.0' }), null)
  assert.equal(laneUpdate(lane({ base: '3.23.0' }), { ...context, appVersion: '3.22.4' }), null)
  assert.equal(laneUpdate(lane(), { ...context, last: 220002 }), null)
  assert.equal(laneUpdate(lane(), { ...context, bad: ['3.22.1'] }), null)
  // A plugin of another publisher, one not newer, one off GitHub, or one this DSH cannot run.
  const only = plugin => laneUpdate(lane({ plugins: [{ ...lane().plugins[0], ...plugin }] }), context)
  assert.equal(only({ name: '@automagik/omni-channels-dsh' }), null)
  assert.equal(only({ version: '3.22.0' }), null)
  assert.equal(only({ url: 'https://example.com/x.tgz' }), null)
  assert.equal(only({ engines: { dsh: '>=0.3.0' } }), null)
  const rc2 = lane({ plugins: [{ ...lane().plugins[0], engines: { dsh: '>=0.2.2-rc.2 <0.3.0-0' } }] })
  assert.equal(laneUpdate(rc2, { ...context, dshVersion: '0.2.2-rc.1' }), null, 'an rc.1 desktop never takes the rc.2 plugins')
  assert.ok(laneUpdate(rc2, { ...context, dshVersion: '0.2.2-rc.2' }), 'the matching rc.2 desktop accepts them')
  assert.equal(laneUpdate(rc2, { ...context, dshVersion: '0.3.0-alpha.1' }), null, 'the ceiling excludes the next minor prerelease')
})

// A profile as pnpm lays it out: node_modules/<name> links into the store.
function profileWith(root, version) {
  const real = join(root, 'profile', 'node_modules', '.pnpm', `@automagik+bots-dsh@${version}`, 'node_modules', '@automagik', 'bots-dsh')
  mkdirSync(real, { recursive: true })
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: '@automagik/bots-dsh', version }))
  mkdirSync(join(root, 'profile', 'node_modules', '@automagik'), { recursive: true })
  symlinkSync(real, join(root, 'profile', 'node_modules', '@automagik', 'bots-dsh'))
  // package.json and the lock as pnpm wrote them for the shipped tarball (pnpm 10, lockfile 9).
  const id = `file:vendor/automagik-bots-dsh-${version}.tgz`
  writeFileSync(join(root, 'profile', 'package.json'), JSON.stringify({ dependencies: { '@automagik/bots-dsh': id } }))
  writeFileSync(join(root, 'profile', 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'", '', 'importers:', '', '  .:', '    dependencies:',
    "      '@automagik/bots-dsh':", `        specifier: ${id}`, `        version: ${id}`,
    "      '@automagik/omni-channels-dsh':", '        specifier: file:vendor/automagik-omni-channels-dsh-2.tgz', `        version: file:vendor/automagik-omni-channels-dsh-2.tgz(@automagik/bots-dsh@${id})`,
    '', 'packages:', '', `  '@automagik/bots-dsh@${id}':`, `    resolution: {integrity: sha512-old, tarball: ${id}}`, `    version: ${version}`, '',
    'snapshots:', '', `  '@automagik/bots-dsh@${id}': {}`, '',
  ].join('\n'))
  return { target: join(root, 'profile'), real }
}
function tarball(root, version) {
  const dir = join(root, 'pack', 'package')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@automagik/bots-dsh', version }))
  writeFileSync(join(dir, 'index.js'), `export const version = '${version}'\n`)
  const file = join(root, 'plugin.tgz')
  execFileSync(tarOf(), ['-czf', file, '-C', join(root, 'pack'), 'package'])
  return readFileSync(file)
}

test('staged plugins go in at the next start, and stay once the page draws', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const { target, real } = profileWith(root, '3.22.0')
  const bytes = tarball(root, '3.22.1')
  const plugin = { ...lane().plugins[0], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  const seen = []
  await stage({ version: '3.22.1', sequence: 220001, plugins: [plugin] }, { home, fetch: async () => new Response(bytes), onProgress: percent => seen.push(percent) })
  assert.deepEqual(seen, [0, 100])
  assert.equal(stagedOf(home).version, '3.22.1')
  assert.equal(beforeStart({ home, target }), 'applied')
  // The store's folder now holds the new version; the one it replaced waits beside it.
  assert.equal(JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version, '3.22.1')
  assert.equal(JSON.parse(readFileSync(`${real}.lane-prev/package.json`, 'utf8')).version, '3.22.0')
  // pnpm sees the lane's tarball: a plugin manager install keeps it instead of putting 3.22.0 back.
  const id = 'file:vendor/automagik-bots-dsh-3.22.1.tgz'
  assert.equal(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).dependencies['@automagik/bots-dsh'], id)
  assert.deepEqual(readFileSync(join(target, 'vendor', 'automagik-bots-dsh-3.22.1.tgz')), bytes)
  const lock = readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8')
  assert.equal(lock.includes('3.22.0'), false)
  assert.ok(lock.includes(`  '@automagik/bots-dsh@${id}':\n    resolution: {integrity: ${plugin.integrity}, tarball: ${id}}\n    version: 3.22.1\n`))
  assert.ok(lock.includes(`(@automagik/bots-dsh@${id})`))
  assert.equal(confirm(home), true)
  assert.equal(existsSync(`${real}.lane-prev`), false)
  assert.equal(laneMemory(home).last, 220001)
  // A tarball that is not the lane's is refused before anything is written.
  await assert.rejects(stage({ version: '3.22.2', sequence: 220002, plugins: [{ ...plugin, version: '3.22.2' }] }, { home, fetch: async () => new Response(Buffer.from('other')) }), /size|match/)
})

test('a start whose page never draws the Bot team brings the previous plugins back, and that version stays out', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const { target, real } = profileWith(root, '3.22.0')
  const bytes = tarball(root, '3.22.1')
  const plugin = { ...lane().plugins[0], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  await stage({ version: '3.22.1', sequence: 220001, plugins: [plugin] }, { home, fetch: async () => new Response(bytes) })
  const lockBefore = readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8')
  const manifestBefore = readFileSync(join(target, 'package.json'), 'utf8')
  assert.equal(beforeStart({ home, target }), 'applied')
  trialFailed(home)
  assert.equal(beforeStart({ home, target }), 'restored')
  assert.equal(JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version, '3.22.0')
  assert.equal(readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8'), lockBefore)
  assert.equal(readFileSync(join(target, 'package.json'), 'utf8'), manifestBefore)
  assert.deepEqual(laneMemory(home).bad, ['3.22.1'])
  assert.equal(laneUpdate(lane(), { ...context, bad: laneMemory(home).bad }), null)
})

test('a newer app\'s own plugins win over what was staged for the old one', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const { target } = profileWith(root, '3.23.0')
  const bytes = tarball(root, '3.22.1')
  const plugin = { ...lane().plugins[0], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  await stage({ version: '3.22.1', sequence: 220001, plugins: [plugin] }, { home, fetch: async () => new Response(bytes) })
  assert.equal(beforeStart({ home, target }), null)
  assert.equal(stagedOf(home), null)
})

test('the sidebar offers a start into staged plugins when the app has no update of its own', () => {
  assert.deepEqual(updatePresentation(null, { plugins: '3.22.1' }), { phase: 'ready', version: '3.22.1', kind: 'plugins' })
  assert.deepEqual(updatePresentation({ state: 'ready', version: '3.23.0' }, { plugins: '3.22.1' }), { phase: 'ready', version: '3.23.0' })
})

test('each lane keeps its own sequence, failures and staging: Genie\'s still goes in after an Automagik patch', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const target = join(root, 'profile')
  const install = (name, version) => {
    const real = join(target, 'node_modules', '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name)
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'package.json'), JSON.stringify({ name, version }))
    mkdirSync(join(target, 'node_modules', '@automagik'), { recursive: true })
    symlinkSync(real, join(target, 'node_modules', name))
  }
  const pack = (name, version) => {
    const dir = join(root, 'pack', name, version, 'package')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
    const file = join(root, 'pack', `${name.replace('/', '+')}-${version}.tgz`)
    execFileSync(tarOf(), ['-czf', file, '-C', join(dir, '..'), 'package'])
    const bytes = readFileSync(file)
    return { bytes, plugin: { name, version, url: `https://github.com/x/${version}.tgz`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } }
  }
  install('@automagik/bots-dsh', '3.22.0')
  install('@automagik/genie-dsh', '0.1.3')
  const ours = pack('@automagik/bots-dsh', '3.22.1')
  const genie = pack('@automagik/genie-dsh', '0.1.4')
  const fetchOf = bytes => async () => new Response(bytes)
  // Both lanes have something in one look: neither's staging replaces the other's.
  await stage({ publisher: 'automagik', version: '3.22.1', sequence: 220001, plugins: [ours.plugin] }, { home, fetch: fetchOf(ours.bytes) })
  await stage({ publisher: 'genie', version: '0.1.4', sequence: 10004, plugins: [genie.plugin] }, { home, fetch: fetchOf(genie.bytes) })
  assert.deepEqual(stagedOf(home).plugins.map(plugin => `${plugin.publisher} ${plugin.name}@${plugin.version}`).sort(), ['automagik @automagik/bots-dsh@3.22.1', 'genie @automagik/genie-dsh@0.1.4'])
  assert.equal(stagedOf(home).version, '3.22.1')
  assert.equal(stagedVersion(home, 'genie'), '0.1.4')
  // Staged again by the same lane: its earlier staging goes, the other lane's stays.
  await stage({ publisher: 'genie', version: '0.1.4', sequence: 10004, plugins: [genie.plugin] }, { home, fetch: fetchOf(genie.bytes) })
  assert.equal(stagedOf(home).plugins.length, 2)
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(confirm(home), true)
  assert.equal(JSON.parse(readFileSync(join(target, 'node_modules', '@automagik/genie-dsh', 'package.json'), 'utf8')).version, '0.1.4')
  // Each lane's own sequence: Genie's numbers are not measured against Automagik's.
  assert.equal(laneMemory(home, 'automagik').last, 220001)
  assert.equal(laneMemory(home, 'genie').last, 10004)
  const genieLane = { schemaVersion: 1, publisher: 'genie', keyId: 'genie-2026-10', sequence: 10005, version: '0.1.5', base: '3.3.0', plugins: [{ ...genie.plugin, version: '0.1.5', url: 'https://github.com/automagik-si/genie/releases/download/v0.1.5/genie-dsh-0.1.5.tgz', engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }] }
  const geniePublisher = PUBLISHERS.find(entry => entry.publisher === 'genie')
  assert.equal(laneUpdate(genieLane, { publisher: geniePublisher, appVersion: '3.22.0', dshVersion: '0.2.1-rc.3', installed: { '@automagik/genie-dsh': '0.1.4' }, ...laneMemory(home, 'genie') })?.version, '0.1.5')
  // A Genie trial that fails marks Genie's version bad, not Automagik's.
  const next = pack('@automagik/genie-dsh', '0.1.5')
  await stage({ publisher: 'genie', version: '0.1.5', sequence: 10005, plugins: [next.plugin] }, { home, fetch: fetchOf(next.bytes) })
  assert.equal(beforeStart({ home, target }), 'applied')
  trialFailed(home)
  assert.equal(beforeStart({ home, target }), 'restored')
  assert.deepEqual(laneMemory(home, 'genie').bad, ['0.1.5'])
  assert.deepEqual(laneMemory(home, 'automagik').bad, [])
  // Taken stays per lane after another lane's trial: Automagik's sequence is still remembered.
  assert.equal(laneMemory(home, 'automagik').last, 220001)
})

test('a lane record from before each lane kept its own still reads', (t) => {
  const home = join(temp(t), 'home')
  mkdirSync(join(home, 'lane'), { recursive: true })
  writeFileSync(join(home, 'lane', 'applied.json'), JSON.stringify({ version: '3.26.1', sequence: 260001, plugins: [{ name: '@automagik/bots-dsh' }], pending: false }))
  writeFileSync(join(home, 'lane', 'bad.json'), JSON.stringify(['3.25.9']))
  assert.deepEqual(laneMemory(home, 'automagik'), { last: 260001, bad: ['3.25.9'] })
  assert.deepEqual(laneMemory(home, 'genie'), { last: 0, bad: [] })
})

// Oh My Claude left the lane with the app (dsh.js RETIRED): a lane that still carries it updates
// nothing of it, and an add-on the lane does not name is never taken either.
test('Automagik\'s lane updates only the plugins it names, never an add-on it does not', () => {
  const addon = (name, version) => ({ name, version, url: `https://github.com/automagik-si/automagik/releases/download/v3.22.1/${name.replace('/', '-')}-${version}.tgz`, integrity: 'sha512-x', sha256: 'y', size: 1, engines: { dsh: '>=0.2.0-rc.1 <0.3.0' } })
  const carried = lane({ addons: [addon('dsh-oh-my-claude', '1.5.6-omni.8'), addon('@goodandready/dsh-subscriptions', '0.7.22-omni.1')] })
  const installed = { ...context.installed, 'dsh-oh-my-claude': '1.5.6-omni.7', '@goodandready/dsh-subscriptions': '0.7.21-omni.1' }
  assert.deepEqual(laneUpdate(carried, { ...context, installed })?.plugins.map(plugin => `${plugin.name}@${plugin.version}`), ['@automagik/bots-dsh@3.22.1'])
})

// Unfold's plugins left this lane (Refs marketplace/unfold): Unfold's own release ships them. The
// lane is additive, never a mirror: a plugin it stops carrying is still installed, still at its
// version, with its profile entry and its data, through every lane update.
test('a lane that stops carrying a plugin leaves the installed one, and its data, untouched', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const { target } = profileWith(root, '3.22.0')
  // The bridge a person installed: its folder in the profile's store, its link, its dependency.
  const bridge = join(target, 'node_modules', '.pnpm', '@automagik+unfold-bridge-dsh@3.20.0', 'node_modules', '@automagik', 'unfold-bridge-dsh')
  mkdirSync(bridge, { recursive: true })
  writeFileSync(join(bridge, 'package.json'), JSON.stringify({ name: '@automagik/unfold-bridge-dsh', version: '3.20.0' }))
  const link = join(target, 'node_modules', '@automagik', 'unfold-bridge-dsh')
  symlinkSync(bridge, link)
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  manifest.dependencies['@automagik/unfold-bridge-dsh'] = 'github:automagik-si/automagik#0123456789abcdef0123456789abcdef01234567'
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  // What the bridge keeps outside node_modules: the sessions it watches.
  const data = join(home, 'team', 'unfold-bridge', 'state.json')
  mkdirSync(dirname(data), { recursive: true })
  writeFileSync(data, '{"watched":["session-1"]}')
  const before = readFileSync(join(bridge, 'package.json'))
  // The lane carries the Bot team, and a stale entry still names the bridge, newer than the one
  // installed: the publisher's list no longer includes it, so it is never selected. The one the
  // person installed stays as it was.
  const carried = lane({ plugins: [...lane().plugins, {
    ...lane().plugins[0], name: '@automagik/unfold-bridge-dsh', version: '3.22.1',
    url: 'https://github.com/automagik-si/automagik/releases/download/v3.22.1/automagik-unfold-bridge-dsh-3.22.1.tgz',
  }] })
  const installed = { ...context.installed, '@automagik/unfold-bridge-dsh': '3.20.0' }
  const update = laneUpdate(carried, { ...context, installed })
  assert.deepEqual(update?.plugins.map(plugin => plugin.name), ['@automagik/bots-dsh'])
  assert.equal(update?.plugins.some(plugin => plugin.name === '@automagik/unfold-bridge-dsh'), false)
  const bytes = tarball(root, '3.22.1')
  const plugin = { ...lane().plugins[0], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  await stage({ ...update, plugins: [plugin] }, { home, fetch: async () => new Response(bytes) })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(confirm(home), true)
  // The bridge is exactly as it was: same folder, version, dependency and data.
  assert.deepEqual(readFileSync(join(bridge, 'package.json')), before)
  assert.equal(existsSync(link), true)
  assert.equal(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).dependencies['@automagik/unfold-bridge-dsh'], manifest.dependencies['@automagik/unfold-bridge-dsh'])
  assert.equal(readFileSync(data, 'utf8'), '{"watched":["session-1"]}')
  // The lane's record names what it moved, and only that: no removal, no bridge.
  const applied = JSON.parse(readFileSync(join(home, 'lane', 'applied.json'), 'utf8'))
  assert.deepEqual(applied.plugins.map(plugin => plugin.name), ['@automagik/bots-dsh'])
})

// The other eight left with the bridge: a stale lane naming every Unfold plugin is still only a
// lane for the plugins the publisher lists, so one lane update moves none of them.
test('a lane carrying every Unfold plugin updates none of them', () => {
  const unfold = ['bot', 'capabilities', 'events', 'mind', 'session', 'settings', 'sse', 'trajectory', 'bridge']
    .map(name => `@automagik/unfold-${name}-dsh`)
  assert.equal(automagik.plugins.some(name => name.startsWith('@automagik/unfold-')), false)
  const plugin = (name, version) => ({ ...lane().plugins[0], name, version })
  const carried = lane({ plugins: [plugin('@automagik/bots-dsh', '3.22.1'), ...unfold.map(name => plugin(name, '3.22.1'))] })
  const installed = { ...context.installed, ...Object.fromEntries(unfold.map(name => [name, '3.20.0'])) }
  const update = laneUpdate(carried, { ...context, installed })
  assert.deepEqual(update?.plugins.map(plugin => plugin.name), ['@automagik/bots-dsh'])
})

// A bare `tar` on Windows can be Git for Windows' GNU tar, which reads C:\... as a remote host.
test('the lane unpacks with the system\'s own tar: System32 on Windows, /usr/bin on macOS', () => {
  assert.equal(tarOf({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' } }), 'C:\\Windows\\System32\\tar.exe')
  assert.equal(tarOf({ platform: 'win32', env: {} }), 'C:\\Windows\\System32\\tar.exe')
  assert.equal(tarOf({ platform: 'darwin', env: {} }), '/usr/bin/tar')
  assert.equal(tarOf({ platform: 'linux', env: {} }), 'tar')
})

// A plugin's own dependencies (#lane-deps): pnpm put ACP's SDK inside the plugin's folder, and the
// swap of that folder for the release tarball, which has no node_modules, left it without them.
// A profile with one plugin installed the hoisted way (a real folder) or pnpm's store way (a link).
function depsProfile(t, { name = '@automagik/acp-dsh', version = '3.22.0', dependencies = { '@agentclientprotocol/sdk': '2.5.0', zod: '4.4.3' }, store = false } = {}) {
  const root = temp(t)
  const target = join(root, 'profile')
  const link = join(target, 'node_modules', name)
  const real = store ? join(target, 'node_modules', '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name) : link
  mkdirSync(real, { recursive: true })
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name, version, dependencies }))
  writeFileSync(join(real, 'index.js'), `export const version = '${version}'\n`)
  if (store) { mkdirSync(dirname(link), { recursive: true }); symlinkSync(real, link) }
  const packageIn = (dir, dependency, depVersion = '1.0.0') => {
    mkdirSync(join(dir, 'node_modules', dependency), { recursive: true })
    writeFileSync(join(dir, 'node_modules', dependency, 'package.json'), JSON.stringify({ name: dependency, version: depVersion }))
    writeFileSync(join(dir, 'node_modules', dependency, 'index.js'), `export const of = '${dependency}@${depVersion}'\n`)
  }
  // The release tarball of `next`: `files` puts in what a tarball would not normally hold.
  const stageNext = async (next, { publisher = 'automagik', sequence = 220001, manifest = {}, files = {} } = {}) => {
    const dir = join(root, 'pack', next, 'package')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: next, dependencies, ...manifest }))
    writeFileSync(join(dir, 'index.js'), `export const version = '${next}'\n`)
    for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text) }
    const file = join(root, 'pack', `${next}.tgz`)
    execFileSync(tarOf(), ['-czf', file, '-C', join(dir, '..'), 'package'])
    const bytes = readFileSync(file)
    const plugin = { name, version: next, url: `https://github.com/x/${next}.tgz`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
    await stage({ publisher, version: next, sequence, plugins: [plugin] }, { home: join(root, 'home'), fetch: async () => new Response(bytes) })
  }
  return { root, home: join(root, 'home'), target, real, link, packageIn, stageNext }
}
// Everything under `dir`: each folder, each file with its text, each link with its text (never followed).
function listing(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((entry) => {
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) return [`${prefix}${entry} -> ${readlinkSync(full)}`]
    if (stat.isDirectory()) return [`${prefix}${entry}/`, ...listing(full, `${prefix}${entry}/`)]
    return [`${prefix}${entry} = ${readFileSync(full, 'utf8')}`]
  })
}
const versionAt = dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
// A refusal writes nothing a later run of the app reads: no bad.json, no sequence taken.
const neverBad = home => ({ bad: existsSync(join(home, 'lane', 'bad.json')), last: laneMemory(home).last })
const unixOnly = process.platform === 'win32' ? 'links and modes as on Linux and macOS' : false

test('a plugin keeps the dependencies pnpm put inside its folder through a lane update', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  const before = listing(join(real, 'node_modules'))
  await stageNext('3.22.1')
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(versionAt(real), '3.22.1')
  assert.deepEqual(listing(join(real, 'node_modules')), before)
  // The folder it replaced is whole, its dependencies still in it.
  assert.deepEqual(listing(join(`${real}.lane-prev`, 'node_modules')), before)
  assert.equal(confirm(home), true)
  assert.equal(existsSync(`${real}.lane-prev`), false)
  assert.deepEqual(listing(join(real, 'node_modules')), before)
})

test('a plugin with no dependencies of its own in its folder gets none from a lane update', async (t) => {
  const { home, target, real, stageNext } = depsProfile(t, { dependencies: {} })
  await stageNext('3.22.1')
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.deepEqual(listing(real), ['index.js = export const version = \'3.22.1\'\n', `package.json = ${JSON.stringify({ name: '@automagik/acp-dsh', version: '3.22.1', dependencies: {} })}`])
})

test('a failed trial brings the previous plugin back exactly as it was, dependencies included', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  const before = listing(real)
  await stageNext('3.22.1', { files: { 'new.js': 'new\n' } })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.ok(existsSync(join(real, 'new.js')))
  trialFailed(home)
  assert.equal(beforeStart({ home, target }), 'restored')
  assert.deepEqual(listing(real), before)
  assert.equal(existsSync(`${real}.lane-prev`), false)
  assert.deepEqual(laneMemory(home).bad, ['3.22.1'])
})

test('a staged plugin that carries its own node_modules keeps it: nothing is copied over or into it', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  const own = { 'node_modules/@agentclientprotocol/sdk/package.json': '{"name":"@agentclientprotocol/sdk","version":"2.5.1"}', 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.4"}' }
  await stageNext('3.22.1', { files: own })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.deepEqual(listing(join(real, 'node_modules')), ['@agentclientprotocol/', '@agentclientprotocol/sdk/', `@agentclientprotocol/sdk/package.json = ${own['node_modules/@agentclientprotocol/sdk/package.json']}`, 'zod/', `zod/package.json = ${own['node_modules/zod/package.json']}`])
})

test('a dependency the plugin found before the swap and not after it undoes the swap, and marks nothing bad', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  const before = listing(target)
  // The staged folder brings a node_modules of its own, without the SDK: the carry leaves it alone.
  await stageNext('3.22.1', { files: { 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.3"}' } })
  const lines = []
  assert.equal(beforeStart({ home, target, log: line => lines.push(line) }), null)
  assert.deepEqual(listing(target), before)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /@automagik\/acp-dsh would lose @agentclientprotocol\/sdk\); nothing changed, and it waits for the app's next start$/)
  assert.deepEqual(neverBad(home), { bad: false, last: 0 })
  // No trial began: the next start has nothing to judge or to put back.
  assert.equal(beforeStart({ home, target }), null)
  assert.deepEqual(listing(target), before)
})

test('a dependency the plugin did not find before the swap is never a reason to refuse it', async (t) => {
  // Declared and nowhere on disk (DSH's loader supplies it, or it was already missing).
  const { home, target, real, packageIn, stageNext } = depsProfile(t, { dependencies: { '@agentclientprotocol/sdk': '2.5.0', 'supplied-elsewhere': '1.0.0' } })
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  // A dependency only the new version names is not one either.
  await stageNext('3.22.1', { manifest: { dependencies: { '@agentclientprotocol/sdk': '2.5.0', 'supplied-elsewhere': '1.0.0', 'new-and-absent': '1.0.0' } } })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(versionAt(real), '3.22.1')
  assert.ok(existsSync(join(real, 'node_modules', '@agentclientprotocol', 'sdk', 'package.json')))
  assert.deepEqual(laneMemory(home).bad, [])
})

test('dependencies hoisted beside the plugin are found after the swap as before it, with nothing copied', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(target, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(target, 'zod', '4.4.3')
  await stageNext('3.22.1')
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(existsSync(join(real, 'node_modules')), false)
})

test('links inside the carried node_modules are copied as links, relative ones right again in place', { skip: unixOnly }, async (t) => {
  const { root, home, target, real, stageNext } = depsProfile(t, { store: true })
  // pnpm's store layout: the plugin's own node_modules links each dependency, relatively, into .pnpm.
  const store = join(target, 'node_modules', '.pnpm', 'sdk@2.5.0', 'node_modules', '@agentclientprotocol', 'sdk')
  mkdirSync(store, { recursive: true })
  writeFileSync(join(store, 'package.json'), '{"name":"@agentclientprotocol/sdk","version":"2.5.0"}')
  mkdirSync(join(real, 'node_modules', '@agentclientprotocol'), { recursive: true })
  const relative = '../../../../../../sdk@2.5.0/node_modules/@agentclientprotocol/sdk'
  symlinkSync(relative, join(real, 'node_modules', '@agentclientprotocol', 'sdk'))
  assert.equal(versionAt(join(real, 'node_modules', '@agentclientprotocol', 'sdk')), '2.5.0')
  // A link out of the profile altogether (zod): never followed, never copied through.
  const outside = join(root, 'outside', 'zod')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'package.json'), '{"name":"zod","version":"4.4.3"}')
  writeFileSync(join(outside, 'big.js'), 'outside\n')
  symlinkSync(outside, join(real, 'node_modules', 'zod'))
  const storeBefore = listing(store)
  const outsideBefore = listing(outside)
  await stageNext('3.22.1')
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(versionAt(real), '3.22.1')
  assert.deepEqual(listing(join(real, 'node_modules')), ['@agentclientprotocol/', `@agentclientprotocol/sdk -> ${relative}`, `zod -> ${outside}`])
  assert.equal(versionAt(join(real, 'node_modules', '@agentclientprotocol', 'sdk')), '2.5.0')
  assert.deepEqual(listing(store), storeBefore)
  assert.deepEqual(listing(outside), outsideBefore)
  // Back out again: the links of the previous folder are as they were, and what they name too.
  trialFailed(home)
  assert.equal(beforeStart({ home, target }), 'restored')
  assert.deepEqual(listing(join(real, 'node_modules')), ['@agentclientprotocol/', `@agentclientprotocol/sdk -> ${relative}`, `zod -> ${outside}`])
  assert.deepEqual(listing(store), storeBefore)
  assert.deepEqual(listing(outside), outsideBefore)
})

test('a node_modules that is itself a link is carried as that link', { skip: unixOnly }, async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  const shared = join(target, 'shared')
  packageIn(shared, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(shared, 'zod', '4.4.3')
  symlinkSync('../../../shared/node_modules', join(real, 'node_modules'))
  assert.equal(versionAt(join(real, 'node_modules', 'zod')), '4.4.3')
  const sharedBefore = listing(shared)
  await stageNext('3.22.1')
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(readlinkSync(join(real, 'node_modules')), '../../../shared/node_modules')
  assert.equal(versionAt(join(real, 'node_modules', 'zod')), '4.4.3')
  assert.equal(confirm(home), true)
  // The trial's end deletes the replaced folder, never what its link named.
  assert.deepEqual(listing(shared), sharedBefore)
})

test('a copy of the dependencies that fails half way changes nothing: the installed plugin stays whole', { skip: unixOnly || (process.getuid?.() === 0 && 'root reads any file') }, async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  const unreadable = join(real, 'node_modules', 'zod', 'index.js')
  const before = listing(target)
  chmodSync(unreadable, 0o000)
  await stageNext('3.22.1')
  const lines = []
  assert.equal(beforeStart({ home, target, log: line => lines.push(line) }), null)
  chmodSync(unreadable, 0o644)
  assert.match(lines.join('\n'), /could not be put in place .*; nothing changed/)
  assert.deepEqual(listing(target), before)
  assert.equal(existsSync(`${real}.lane-prev`), false)
  assert.deepEqual(neverBad(home), { bad: false, last: 0 })
})

test('with two plugins staged, one that would lose a dependency takes the other back out with it', async (t) => {
  const { root, home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  // Genie's plugin beside it, healthy, on its own lane.
  const genie = join(target, 'node_modules', '@automagik', 'genie-dsh')
  mkdirSync(join(genie, 'node_modules', 'yaml'), { recursive: true })
  writeFileSync(join(genie, 'package.json'), JSON.stringify({ name: '@automagik/genie-dsh', version: '0.1.3', dependencies: { yaml: '2.0.0' } }))
  writeFileSync(join(genie, 'node_modules', 'yaml', 'package.json'), '{"name":"yaml","version":"2.0.0"}')
  const dir = join(root, 'pack', 'genie', 'package')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@automagik/genie-dsh', version: '0.1.4', dependencies: { yaml: '2.0.0' } }))
  execFileSync(tarOf(), ['-czf', join(root, 'genie.tgz'), '-C', join(dir, '..'), 'package'])
  const bytes = readFileSync(join(root, 'genie.tgz'))
  await stage({ publisher: 'genie', version: '0.1.4', sequence: 10004, plugins: [{ name: '@automagik/genie-dsh', version: '0.1.4', url: 'https://github.com/x/g.tgz', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }] }, { home, fetch: async () => new Response(bytes) })
  await stageNext('3.22.1', { files: { 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.3"}' } })
  const before = listing(target)
  assert.equal(beforeStart({ home, target }), null)
  assert.deepEqual(listing(target), before)
  assert.deepEqual(neverBad(home), { bad: false, last: 0 })
  assert.equal(laneMemory(home, 'genie').last, 0)
})

test('Genie\'s lane carries its plugin\'s own dependencies the same way', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t, { name: '@automagik/genie-dsh', version: '0.1.3', dependencies: { yaml: '2.0.0' } })
  packageIn(real, 'yaml', '2.0.0')
  const before = listing(join(real, 'node_modules'))
  await stageNext('0.1.4', { publisher: 'genie', sequence: 10004 })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(versionAt(real), '0.1.4')
  assert.deepEqual(listing(join(real, 'node_modules')), before)
  assert.equal(confirm(home), true)
  assert.equal(laneMemory(home, 'genie').last, 10004)
})

test('a refused lane version is not taken again in this run of the app, and once more in the next', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  const refusedLane = lane({ plugins: [{ ...lane().plugins[0], name: '@automagik/acp-dsh' }] })
  const asked = { ...context, installed: { '@automagik/acp-dsh': '3.22.0' } }
  assert.equal(laneUpdate(refusedLane, { ...asked, ...laneMemory(home) })?.version, '3.22.1')
  await stageNext('3.22.1', { files: { 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.3"}' } })
  assert.equal(beforeStart({ home, target }), null)
  // The next look of this run: the app's own question (main.js lookOnce) finds nothing to stage.
  assert.deepEqual(laneMemory(home).bad, ['3.22.1'])
  assert.equal(laneUpdate(refusedLane, { ...asked, ...laneMemory(home) }), null)
  assert.equal(stagedOf(home), null)
  // Only that version of that lane, in that home: the next version and Genie's lane are taken.
  assert.equal(laneUpdate(lane({ version: '3.22.2', sequence: 220002, plugins: refusedLane.plugins.map(plugin => ({ ...plugin, version: '3.22.2' })) }), { ...asked, ...laneMemory(home) })?.version, '3.22.2')
  assert.deepEqual(laneMemory(home, 'genie').bad, [])
  assert.deepEqual(laneMemory(join(home, 'other')).bad, [])
  // Nothing on disk says so: the next run of the app (the module loaded anew) takes it once more.
  assert.equal(existsSync(join(home, 'lane', 'bad.json')), false)
  const nextRun = await import('../src/lane.js?next-run')
  assert.deepEqual(nextRun.laneMemory(home).bad, [])
  assert.equal(nextRun.laneUpdate(refusedLane, { ...asked, ...nextRun.laneMemory(home) })?.version, '3.22.1')
})

test('a dependency the staged folder lacks is not lost when a folder above still has it', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  // The profile's root has the SDK too: after the swap Node finds that one.
  packageIn(target, '@agentclientprotocol/sdk', '2.5.0')
  await stageNext('3.22.1', { files: { 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.3"}' } })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(existsSync(join(real, 'node_modules', '@agentclientprotocol')), false)
})

test('a dependency only the new version names, found before the swap, must still be found after it', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t, { dependencies: { zod: '4.4.3' } })
  packageIn(real, '@agentclientprotocol/sdk', '2.5.0')
  packageIn(real, 'zod', '4.4.3')
  const before = listing(target)
  await stageNext('3.22.1', { manifest: { dependencies: { '@agentclientprotocol/sdk': '2.5.0', zod: '4.4.3' } }, files: { 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.3"}' } })
  assert.equal(beforeStart({ home, target }), null)
  assert.deepEqual(listing(target), before)
})

test('Genie\'s plugin that would lose a dependency is refused the same way', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t, { name: '@automagik/genie-dsh', version: '0.1.3', dependencies: { yaml: '2.0.0', ms: '2.0.0' } })
  packageIn(real, 'yaml', '2.0.0')
  packageIn(real, 'ms', '2.0.0')
  const before = listing(target)
  await stageNext('0.1.4', { publisher: 'genie', sequence: 10004, files: { 'node_modules/ms/package.json': '{"name":"ms","version":"2.0.0"}' } })
  const lines = []
  assert.equal(beforeStart({ home, target, log: line => lines.push(line) }), null)
  assert.match(lines.join('\n'), /@automagik\/genie-dsh would lose yaml/)
  assert.deepEqual(listing(target), before)
  assert.deepEqual([laneMemory(home, 'genie').bad, laneMemory(home, 'automagik').bad], [['0.1.4'], []])
  assert.equal(existsSync(join(home, 'lane', 'bad.json')), false)
})

test('a refusal after the swap puts the profile\'s own records back exactly: package.json, the locks, pnpm\'s modules file', async (t) => {
  const root = temp(t)
  const home = join(root, 'home')
  const { target, real } = profileWith(root, '3.22.0')
  // The installed Bot team with a dependency in its own folder, and pnpm's records beside the lock.
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: '@automagik/bots-dsh', version: '3.22.0', dependencies: { yaml: '2.0.0', ms: '2.0.0' } }))
  for (const name of ['yaml', 'ms']) {
    mkdirSync(join(real, 'node_modules', name), { recursive: true })
    writeFileSync(join(real, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '2.0.0' }))
  }
  const id = 'file:vendor/automagik-bots-dsh-3.22.0.tgz'
  writeFileSync(join(target, 'node_modules', '.pnpm', 'lock.yaml'), readFileSync(join(target, 'pnpm-lock.yaml'), 'utf8'))
  writeFileSync(join(target, 'node_modules', '.modules.yaml'), `hoistedDependencies:\n  '@automagik/bots-dsh@${id}': public\n`)
  mkdirSync(join(target, 'vendor'))
  writeFileSync(join(target, 'vendor', 'automagik-bots-dsh-3.22.0.tgz'), 'the shipped tarball')
  const before = listing(target)
  // The new version brings a node_modules of its own, without yaml.
  const dir = join(root, 'pack', 'package')
  mkdirSync(join(dir, 'node_modules', 'ms'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@automagik/bots-dsh', version: '3.22.1', dependencies: { yaml: '2.0.0', ms: '2.0.0' } }))
  writeFileSync(join(dir, 'node_modules', 'ms', 'package.json'), '{"name":"ms","version":"2.0.0"}')
  execFileSync(tarOf(), ['-czf', join(root, 'plugin.tgz'), '-C', join(root, 'pack'), 'package'])
  const bytes = readFileSync(join(root, 'plugin.tgz'))
  const plugin = { ...lane().plugins[0], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  await stage({ version: '3.22.1', sequence: 220001, plugins: [plugin] }, { home, fetch: async () => new Response(bytes) })
  const lines = []
  assert.equal(beforeStart({ home, target, log: line => lines.push(line) }), null)
  assert.match(lines.join('\n'), /@automagik\/bots-dsh would lose yaml/)
  // The lane's tarball had gone into vendor/ by then, and stays, as after any trial that fails:
  // nothing names it any more.
  const left = 'vendor/automagik-bots-dsh-3.22.1.tgz'
  assert.deepEqual(listing(target).filter(entry => !entry.startsWith(left)), before)
  assert.ok(existsSync(join(target, left)))
  assert.equal(existsSync(join(home, 'lane', 'applied.json')), false)
})

test('a link to a folder that may not be made as a symbolic link is made as a junction to the same place', { skip: unixOnly }, async (t) => {
  const { root, home, target, real, packageIn, stageNext } = depsProfile(t)
  // As on Windows without the right to make symbolic links: EPERM for one, a junction is allowed.
  // This host makes no junctions, so the stand-in records the call and makes a link to that path.
  const store = join(target, 'store')
  packageIn(store, 'zod', '4.4.3')
  mkdirSync(join(real, 'node_modules'))
  symlinkSync('../../../../store/node_modules/zod', join(real, 'node_modules', 'zod'))
  writeFileSync(join(real, 'node_modules', 'file.js'), 'a file\n')
  symlinkSync('file.js', join(real, 'node_modules', 'file-link.js'))
  const calls = []
  const noSymlinks = (text, path, type) => {
    calls.push([text, type])
    if (type !== 'junction') throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' })
    symlinkSync(text, path)
  }
  const staged = join(root, 'staged-by-hand')
  mkdirSync(staged)
  carryDependencies(real, staged, { link: (text, path, type) => (type === 'file' ? symlinkSync(text, path) : noSymlinks(text, path, type)) })
  // Asked as a folder link with its own text first; then a junction, whose place is absolute:
  // where the link points from the installed folder, not from the staged one.
  assert.deepEqual(calls, [['../../../../store/node_modules/zod', 'dir'], [join(store, 'node_modules', 'zod'), 'junction']])
  assert.equal(versionAt(join(staged, 'node_modules', 'zod')), '4.4.3')
  assert.equal(readlinkSync(join(staged, 'node_modules', 'file-link.js')), 'file.js')
  // Through the whole apply: the plugin goes in with its dependency reachable.
  await stageNext('3.22.1')
  assert.equal(beforeStart({ home, target, link: noSymlinks }), null, 'a file link that cannot be made refuses the apply')
  assert.equal(versionAt(real), '3.22.0')
  rmSync(join(real, 'node_modules', 'file-link.js'))
  const again = await import('../src/lane.js?junction-run')
  await stageNext('3.22.1')
  assert.equal(again.beforeStart({ home, target, link: noSymlinks }), 'applied')
  assert.equal(versionAt(real), '3.22.1')
  assert.equal(versionAt(join(real, 'node_modules', 'zod')), '4.4.3')
})

test('no kind of link can be made: the apply is refused and the installed plugin stays whole', { skip: unixOnly }, async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t)
  const store = join(target, 'store')
  packageIn(store, 'zod', '4.4.3')
  mkdirSync(join(real, 'node_modules'))
  symlinkSync('../../../../store/node_modules/zod', join(real, 'node_modules', 'zod'))
  const before = listing(target)
  await stageNext('3.22.1')
  const lines = []
  const never = () => { throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' }) }
  assert.equal(beforeStart({ home, target, log: line => lines.push(line), link: never }), null)
  assert.match(lines.join('\n'), /EPERM.*nothing changed/)
  assert.deepEqual(listing(target), before)
  assert.deepEqual(neverBad(home), { bad: false, last: 0 })
})

test('a dependency the new version no longer names is not missed', async (t) => {
  const { home, target, real, packageIn, stageNext } = depsProfile(t, { dependencies: { zod: '4.4.3', ms: '2.0.0' } })
  packageIn(real, 'zod', '4.4.3')
  packageIn(real, 'ms', '2.0.0')
  await stageNext('3.22.1', { manifest: { dependencies: { zod: '4.4.3' } }, files: { 'node_modules/zod/package.json': '{"name":"zod","version":"4.4.3"}' } })
  assert.equal(beforeStart({ home, target }), 'applied')
  assert.equal(existsSync(join(real, 'node_modules', 'ms')), false)
})
