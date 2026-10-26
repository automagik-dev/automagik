import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULTS, overlayOf, privacyEnv, readChoices, SHARES } from '../src/privacy.js'

const off = text => [...text.matchAll(/^- id: (\S+)\n  disabled: true$/gm)].map(match => match[1]).sort()

test('with nothing chosen, what could train a model is off and the rest works as shipped', () => {
  assert.deepEqual(DEFAULTS, { 'deepseek-session-log': false, 'deepseek-feedback': false, 'claude-errors': true, spellcheck: true, 'stable-id': true })
  assert.deepEqual(off(overlayOf(DEFAULTS)), ['desktop-product-telemetry', 'plugin-package-inventory-deepseek', 'product-analytics', 'session-log-deepseek', 'session-telemetry-otel'])
  const env = privacyEnv(DEFAULTS)
  for (const name of ['DO_NOT_TRACK', 'DSH_TELEMETRY_DISABLED', 'DISABLE_TELEMETRY', 'OPENUI_TELEMETRY_DISABLED']) assert.equal(env[name], '1', name)
  // Claude Code's own error reports and updates are not training data: they work.
  assert.equal(env.DISABLE_ERROR_REPORTING, undefined)
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, undefined)
  // Switched off, they stop.
  assert.equal(privacyEnv({ ...DEFAULTS, 'claude-errors': false }).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1')
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

test('the choices file is read strictly: known shares, booleans only, else each default', () => {
  const reading = text => () => text
  assert.deepEqual(readChoices('/p', reading(JSON.stringify({ share: { 'deepseek-feedback': true, spellcheck: 'yes', unknown: true, 'claude-errors': false } }))), { ...DEFAULTS, 'deepseek-feedback': true, 'claude-errors': false })
  assert.deepEqual(readChoices('/p', reading('not json')), DEFAULTS)
  assert.deepEqual(readChoices('/p', () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }), DEFAULTS)
})

test('the Bot team\'s Privacy page offers exactly the shares the app applies', async () => {
  const { SHARES: saved, DEFAULTS: pageDefaults } = await import('../../bots-dsh/src/host/privacy.js')
  assert.deepEqual({ ...pageDefaults }, { ...DEFAULTS })
  const page = readFileSync(new URL('../../bots-dsh/src/client/privacy.js', import.meta.url), 'utf8')
  const shown = [...page.matchAll(/^\s+key: '([\w-]+)',$/gm)].map(match => match[1])
  assert.deepEqual([...saved].sort(), Object.keys(SHARES).sort())
  assert.deepEqual([...shown].sort(), Object.keys(SHARES).sort())
})
