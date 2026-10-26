import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LANE_KEYS } from '../src/lane-keys.js'
import { PUBLISHERS, beforeStart, confirm, laneMemory, laneUpdate, satisfies, stage, stagedOf, stagedVersion, trialFailed, verifyLane } from '../src/lane.js'
import { updatePresentation } from '../src/frame.js'

const temp = (t) => { const dir = mkdtempSync(join(tmpdir(), 'lane-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }
const automagik = PUBLISHERS.find(entry => entry.publisher === 'automagik')
const lane = (patch = {}) => ({
  schemaVersion: 1, publisher: 'automagik', keyId: 'k1', sequence: 220001, issuedAt: '2026-10-26T03:00:00Z', version: '3.22.1', base: '3.22.0',
  plugins: [{ name: '@automagik/bots-dsh', version: '3.22.1', url: 'https://github.com/automagik-dev/automagik/releases/download/v3.22.1/automagik-bots-dsh-3.22.1.tgz', integrity: 'sha512-x', sha256: 'y', size: 1, engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }],
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
  const own = { schemaVersion: 1, publisher: 'genie', keyId: 'genie-2026-10', sequence: 10002, version: '0.1.2', base: '3.3.0', plugins: [{ name: '@automagik/genie-dsh', version: '0.1.2', url: 'https://github.com/automagik-dev/genie/releases/download/v0.1.2/genie-dsh-0.1.2.tgz', engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }] }
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
})

// A profile as pnpm lays it out: node_modules/<name> links into the store.
function profileWith(root, version) {
  const real = join(root, 'profile', 'node_modules', '.pnpm', `@automagik+bots-dsh@${version}`, 'node_modules', '@automagik', 'bots-dsh')
  mkdirSync(real, { recursive: true })
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: '@automagik/bots-dsh', version }))
  mkdirSync(join(root, 'profile', 'node_modules', '@automagik'), { recursive: true })
  symlinkSync(real, join(root, 'profile', 'node_modules', '@automagik', 'bots-dsh'))
  return { target: join(root, 'profile'), real }
}
function tarball(root, version) {
  const dir = join(root, 'pack', 'package')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@automagik/bots-dsh', version }))
  writeFileSync(join(dir, 'index.js'), `export const version = '${version}'\n`)
  const file = join(root, 'plugin.tgz')
  execFileSync('tar', ['-czf', file, '-C', join(root, 'pack'), 'package'])
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
  assert.equal(beforeStart({ home, target }), 'applied')
  trialFailed(home)
  assert.equal(beforeStart({ home, target }), 'restored')
  assert.equal(JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version, '3.22.0')
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
    execFileSync('tar', ['-czf', file, '-C', join(dir, '..'), 'package'])
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
  const genieLane = { schemaVersion: 1, publisher: 'genie', keyId: 'genie-2026-10', sequence: 10005, version: '0.1.5', base: '3.3.0', plugins: [{ ...genie.plugin, version: '0.1.5', url: 'https://github.com/automagik-dev/genie/releases/download/v0.1.5/genie-dsh-0.1.5.tgz', engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }] }
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
