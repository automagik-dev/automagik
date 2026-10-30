import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PLUGINS, acceptsHarness, pinPatchVersions, pinRange, pinRuntime, rangeFor } from '../scripts/follow-dsh.mjs'

const runtime = { name: 'omni-desktop-runtime', private: true, dependencies: { '@deepseek-ai/dsh': '0.2.1-rc.2', pnpm: '10.34.6' } }

test('the runtime moves to the dsh the carried Omni tests on, and keeps the rest', () => {
  const next = pinRuntime(runtime, '0.2.1-rc.3')
  assert.equal(next.dependencies['@deepseek-ai/dsh'], '0.2.1-rc.3')
  assert.equal(next.dependencies.pnpm, '10.34.6')
  assert.equal(next.name, 'omni-desktop-runtime')
  assert.equal(runtime.dependencies['@deepseek-ai/dsh'], '0.2.1-rc.2', 'the input is not mutated')
})

test('a runtime already on that dsh is left alone', () => {
  assert.equal(pinRuntime(runtime, '0.2.1-rc.2'), null)
})

test('anything but an exact version is refused', () => {
  for (const bad of ['', undefined, 'latest', '^0.2.1', '0.2.1-rc.3; rm -rf /', '>=0.2.1']) {
    assert.throws(() => pinRuntime(runtime, bad), /not a dsh version/)
  }
})

test('a plugin tested on a dsh declares it up to the next patch, previews included', () => {
  assert.equal(rangeFor('0.2.1-rc.3'), '>=0.2.1-rc.3 <0.2.2-0')
  assert.equal(rangeFor('0.2.1'), '>=0.2.1 <0.2.2-0')
  assert.equal(rangeFor('0.3.0-alpha.1'), '>=0.3.0-alpha.1 <0.3.1-0')
  assert.throws(() => rangeFor('^0.2.1'), /not a dsh version/)
  assert.deepEqual(pinRange({ name: 'p', engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }, '0.2.2-rc.1'), { name: 'p', engines: { dsh: '>=0.2.2-rc.1 <0.2.3-0' } })
  assert.equal(pinRange({ engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } }, '0.2.1-rc.3'), null)
})

test('the plugins it moves are the ones that declare the range, and their range is the one it writes', () => {
  for (const name of PLUGINS) {
    const manifest = JSON.parse(readFileSync(new URL(`../../${name}/package.json`, import.meta.url), 'utf8'))
    const tested = JSON.parse(readFileSync(new URL(`../../${name}/dev/harness/package.json`, import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh']
    assert.equal(manifest.engines?.dsh, rangeFor(tested), name)
  }
})

test('follow-omni follows only an Omni release tested on the dsh the desktop runs', () => {
  const text = readFileSync(new URL('../../../.github/workflows/follow-omni.yml', import.meta.url), 'utf8')
  assert.match(text, /apps\/omni-channels-dsh\/dev\/harness\/package\.json/)
  assert.match(text, /require\('\.\/apps\/desktop\/runtime\/package\.json'\)/)
  assert.ok(text.indexOf('not following it until the Bot team moves') < text.indexOf('git commit -qam'), 'a mismatch stops before the commit')
  // The welcome installs the same Omni release in a plain DSH: both pins move in one commit.
  assert.ok(text.indexOf('apps/welcome-dsh/package.json') < text.indexOf('git commit -qam'))
  assert.match(text, /pkg\.automagik\.omni = \{ \.\.\.pkg\.automagik\.omni, version, commit \}/)
})


test('a carried Omni harness admits only newer compatible releases in the same patch series', () => {
  const range = '>=0.2.1-rc.3 <0.2.2-0'
  for (const version of ['0.2.1-rc.3', '0.2.1-rc.4', '0.2.1']) {
    assert.equal(acceptsHarness(version, '0.2.1-rc.3', range), true, version)
  }
  for (const version of ['0.2.1-rc.2', '0.2.2-alpha.1', '0.2.2', '0.3.0', 'latest', undefined]) {
    assert.equal(acceptsHarness(version, '0.2.1-rc.3', range), false, version)
  }
  assert.equal(acceptsHarness('0.2.1-rc.4', '0.2.1-rc.3', '>=0.2.1-rc.3 <0.2.1-rc.4'), false)
  assert.equal(acceptsHarness('0.2.1-rc.4', '0.2.1-rc.3', undefined), false)
  assert.equal(acceptsHarness('0.2.1-rc.4', undefined, range), false)
  assert.equal(acceptsHarness('0.2.2', '0.2.1-rc.3', '>=0.2.1-rc.2 <0.3.0'), false)
})

test('patch version tooling preserves exact-byte guards and does not mutate its input', () => {
  const patches = [{ patch: 'route.patch', about: 'keep routing', dsh: '0.2.1-rc.4', files: [
    { package: '@deepseek-ai/dsh-experimental-agent-team', version: '0.2.1-rc.4', file: 'lib/index.js', before: 'before-hash', after: 'after-hash' },
  ] }]
  const original = structuredClone(patches)
  const next = pinPatchVersions(patches, '0.2.1-rc.5')
  assert.equal(next[0].dsh, '0.2.1-rc.5')
  assert.equal(next[0].files[0].version, '0.2.1-rc.5')
  assert.deepEqual({ ...next[0], dsh: original[0].dsh, files: next[0].files.map((file, i) => ({ ...file, version: original[0].files[i].version })) }, original[0])
  assert.deepEqual(patches, original)
  assert.equal(pinPatchVersions(next, '0.2.1-rc.5'), null)
  assert.throws(() => pinPatchVersions(patches, '^0.2.1'), /not a dsh version/)
})

test('all runtime patch version guards track the desktop DSH pin', () => {
  const pinned = JSON.parse(readFileSync(new URL('../runtime/package.json', import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh']
  const patches = JSON.parse(readFileSync(new URL('../runtime/patches/patches.json', import.meta.url), 'utf8'))
  assert.equal(pinPatchVersions(patches, pinned), null)
})

test('all shipped plugin harnesses track the exact desktop DSH pin', () => {
  assert.deepEqual([...PLUGINS].sort(), ['bots-dsh', 'locale-pt-br-dsh', 'unfold-bot-dsh', 'unfold-bridge-dsh', 'unfold-capabilities-dsh', 'unfold-events-dsh', 'unfold-mind-dsh', 'unfold-session-dsh', 'unfold-settings-dsh', 'unfold-sse-dsh', 'unfold-trajectory-dsh', 'welcome-dsh'])
  const pinned = JSON.parse(readFileSync(new URL('../runtime/package.json', import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh']
  for (const name of PLUGINS) {
    const tested = JSON.parse(readFileSync(new URL(`../../${name}/dev/harness/package.json`, import.meta.url), 'utf8')).dependencies['@deepseek-ai/dsh']
    assert.equal(tested, pinned, name)
  }
})
