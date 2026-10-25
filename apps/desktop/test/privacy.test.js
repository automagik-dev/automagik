import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { overlayOf, privacyEnv, readChoices, SHARES } from '../src/privacy.js'

const off = text => [...text.matchAll(/^- id: (\S+)\n  disabled: true$/gm)].map(match => match[1]).sort()

test('with nothing chosen, everything DSH reports is off', () => {
  assert.deepEqual(off(overlayOf({})), ['desktop-product-telemetry', 'plugin-package-inventory-deepseek', 'product-analytics', 'session-log-deepseek', 'session-telemetry-otel'])
  const env = privacyEnv({})
  for (const name of ['DO_NOT_TRACK', 'DSH_TELEMETRY_DISABLED', 'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'OPENUI_TELEMETRY_DISABLED']) assert.equal(env[name], '1', name)
})

test('a share switched on drops only its own rows and opt-outs; product analytics never comes on', () => {
  const everything = Object.fromEntries(Object.keys(SHARES).map(key => [key, true]))
  assert.deepEqual(off(overlayOf(everything)), ['desktop-product-telemetry', 'product-analytics'])
  assert.deepEqual(off(overlayOf({ 'deepseek-session-log': true })), ['desktop-product-telemetry', 'product-analytics', 'session-telemetry-otel'])
  const env = privacyEnv(everything)
  assert.equal(env.DSH_TELEMETRY_DISABLED, undefined)
  assert.equal(env.DISABLE_ERROR_REPORTING, undefined)
  assert.equal(env.DO_NOT_TRACK, '1')
  assert.equal(env.DISABLE_TELEMETRY, '1')
})

test('the choices file is read strictly: only known shares, only true, and nothing when it is missing or broken', () => {
  const reading = text => () => text
  assert.deepEqual(readChoices('/p', reading(JSON.stringify({ share: { 'deepseek-feedback': true, spellcheck: 'yes', unknown: true, 'claude-errors': false } }))), { 'deepseek-feedback': true })
  assert.deepEqual(readChoices('/p', reading('not json')), {})
  assert.deepEqual(readChoices('/p', () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }), {})
})

test('the Bot team\'s Privacy page offers exactly the shares the app applies', async () => {
  const { SHARES: saved } = await import('../../bots-dsh/src/host/privacy.js')
  const page = readFileSync(new URL('../../bots-dsh/src/client/privacy.js', import.meta.url), 'utf8')
  const shown = [...page.matchAll(/^\s+key: '([\w-]+)',$/gm)].map(match => match[1])
  assert.deepEqual([...saved].sort(), Object.keys(SHARES).sort())
  assert.deepEqual([...shown].sort(), Object.keys(SHARES).sort())
})
