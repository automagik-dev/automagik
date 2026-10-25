import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPrivacy, SHARES } from '../src/host/privacy.js'

const fileIn = () => join(mkdtempSync(join(tmpdir(), 'bots-privacy-')), 'privacy.json')

test('everything starts off, and a switch writes only the shares the desktop app knows', () => {
  const file = fileIn()
  const privacy = createPrivacy({ env: { AUTOMAGIK_PRIVACY_FILE: file } })
  assert.deepEqual(privacy.view(), { managed: true, share: Object.fromEntries(SHARES.map(key => [key, false])) })
  assert.equal(privacy.set('deepseek-feedback', true).share['deepseek-feedback'], true)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).share['deepseek-feedback'], true)
  assert.equal(privacy.set('deepseek-feedback', false).share['deepseek-feedback'], false)
  assert.throws(() => privacy.set('everything', true), /Unknown share/)
})

test('a file that is not the app\'s own shares nothing', () => {
  const file = fileIn()
  writeFileSync(file, JSON.stringify({ share: { spellcheck: 'yes', 'stable-id': 1 } }))
  const share = createPrivacy({ env: { AUTOMAGIK_PRIVACY_FILE: file } }).view().share
  assert.equal(Object.values(share).some(Boolean), false)
})

test('outside the desktop app the page says so, and nothing can be switched on', () => {
  const privacy = createPrivacy({ env: {} })
  assert.equal(privacy.view().managed, false)
  assert.throws(() => privacy.set('spellcheck', true), /managed by the Automagik desktop app/)
})
