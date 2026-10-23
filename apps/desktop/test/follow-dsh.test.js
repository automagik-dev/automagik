import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { pinRuntime } from '../scripts/follow-dsh.mjs'

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

test('follow-omni follows only an Omni release tested on the dsh the desktop runs', () => {
  const text = readFileSync(new URL('../../../.github/workflows/follow-omni.yml', import.meta.url), 'utf8')
  assert.match(text, /apps\/omni-channels-dsh\/dev\/harness\/package\.json/)
  assert.match(text, /require\('\.\/apps\/desktop\/runtime\/package\.json'\)/)
  assert.ok(text.indexOf('not following it until the Bot team moves') < text.indexOf('git commit -qam'), 'a mismatch stops before the commit')
  // The welcome installs the same Omni release in a plain DSH: both pins move in one commit.
  assert.ok(text.indexOf('apps/welcome-dsh/package.json') < text.indexOf('git commit -qam'))
  assert.match(text, /pkg\.automagik\.omni = \{ \.\.\.pkg\.automagik\.omni, version, commit \}/)
})
