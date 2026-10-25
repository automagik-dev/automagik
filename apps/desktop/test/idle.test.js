import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AWAY_MS, awayInstall, readBusy } from '../src/idle.js'

const away = { ready: '3.16.0', idleMs: AWAY_MS, focused: false, busy: { running: 0, at: 1 } }

test('a downloaded update goes in once the person is away and no agent is at work', () => {
  assert.equal(awayInstall(away), 'install')
})

test('it waits while the person is here, the window is in front, or an agent works', () => {
  assert.equal(awayInstall({ ...away, ready: null }), 'no update')
  assert.equal(awayInstall({ ...away, idleMs: AWAY_MS - 1 }), 'person here')
  assert.equal(awayInstall({ ...away, focused: true }), 'window in front')
  assert.equal(awayInstall({ ...away, busy: { running: 1, at: 1 } }), 'agents at work')
})

test('without a busy file it can trust, the update waits for a quit or Restart', () => {
  assert.equal(awayInstall({ ...away, busy: null }), 'busy unknown')
  const reading = text => () => text
  assert.equal(readBusy('/busy.json', reading('{"running":0,"at":5}')).running, 0)
  assert.equal(readBusy('/busy.json', reading('{"running":-1}')), null)
  assert.equal(readBusy('/busy.json', reading('{"running":"0"}')), null)
  assert.equal(readBusy('/busy.json', reading('not json')), null)
  assert.equal(readBusy('/busy.json', () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }), null)
})
