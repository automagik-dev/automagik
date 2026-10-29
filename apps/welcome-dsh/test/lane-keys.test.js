// src/host/lane-keys.json is this plugin's copy of the repository's plugin-lane/keys.json, carried
// byte for byte: the welcome installs on its own, and trusts a release's lane only from these keys.
// A key rotation changes plugin-lane/keys.json first; copy it here and move the pin.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const PINNED = '9e04c415facbdba7e7d360f59fbd6db5104c9a9fad4ec3b928ad8074faa1850a'
const sha = url => createHash('sha256').update(readFileSync(url)).digest('hex')

test('src/host/lane-keys.json is plugin-lane/keys.json, byte for byte', () => {
  assert.equal(sha(new URL('../src/host/lane-keys.json', import.meta.url)), PINNED)
  const source = new URL('../../../plugin-lane/keys.json', import.meta.url)
  if (existsSync(source)) assert.equal(sha(source), PINNED, 'plugin-lane/keys.json moved: copy it to src/host/lane-keys.json and move the pin')
})
