import { test } from 'node:test'
import assert from 'node:assert/strict'
import { install } from '../src/host/endpoint.js'
import { preloadOf } from '../src/host/preload.js'
import { fakeContext } from './fake-ctx.js'

test('the preload is omni, genie or none, from AUTOMAGIK_PRELOAD', () => {
  assert.equal(preloadOf({ AUTOMAGIK_PRELOAD: 'omni' }), 'omni')
  assert.equal(preloadOf({ AUTOMAGIK_PRELOAD: ' Genie ' }), 'genie')
  for (const value of [undefined, '', 'other', 'omni,genie', 42]) assert.equal(preloadOf({ AUTOMAGIK_PRELOAD: value }), null)
  assert.equal(preloadOf({}), null)
  assert.equal(preloadOf(undefined), null)
})

test('the steps read the preload with their state', async () => {
  const handle = env => install(fakeContext({ entries: { 'omni-ai': {} } }).ctx, { env, checkClaude: async () => ({ plugin: false, installed: false, loggedIn: false }) }).handle
  assert.equal((await (handle({ AUTOMAGIK_PRELOAD: 'genie' }))('state')).value.preload, 'genie')
  assert.equal((await (handle({}))('state')).value.preload, null)
})
