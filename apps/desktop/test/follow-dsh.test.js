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

test('follow-omni moves the runtime with omni.json, from the release it carries', () => {
  const text = readFileSync(new URL('../.github/workflows/follow-omni.yml', import.meta.url), 'utf8')
  assert.match(text, /apps\/omni-ui-dsh\/dev\/harness\/package\.json\?ref=v\$\{VERSION\}/)
  assert.match(text, /node scripts\/follow-dsh\.mjs "\$\{dsh\}"/)
  assert.ok(text.indexOf('follow-dsh.mjs') < text.indexOf('git commit -qam'), 'the runtime moves in the same commit')
})
