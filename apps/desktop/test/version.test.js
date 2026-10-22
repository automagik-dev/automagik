import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))

test("the app's version is the Omni release it carries, pinned to one commit", () => {
  const omni = read('omni.json')
  assert.match(omni.version, /^\d+\.\d+\.\d+$/)
  assert.match(omni.commit, /^[0-9a-f]{40}$/)
  assert.equal(omni.repository, 'https://github.com/automagik-dev/omni')
  assert.equal(read('package.json').version, omni.version)
  const lock = read('package-lock.json')
  assert.equal(lock.version, omni.version)
  assert.equal(lock.packages[''].version, omni.version)
})
