import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))

test("the app carries Automagik's version, the same as every package in this repository", () => {
  const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
  assert.match(version, /^\d+\.\d{6}\.\d+$/)
  assert.equal(read('package.json').version, version)
  const lock = read('package-lock.json')
  assert.equal(lock.version, version)
  assert.equal(lock.packages[''].version, version)
})

test('omni.json pins the Omni release whose channels and canvases the app carries, to one commit', () => {
  const omni = read('omni.json')
  assert.match(omni.version, /^\d+\.\d+\.\d+$/)
  assert.match(omni.commit, /^[0-9a-f]{40}$/)
  assert.equal(omni.repository, 'https://github.com/automagik-dev/omni')
})
