import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPEN_CHAT, REOPEN, rememberOpen, takeReopen } from '../src/client/reopen.js'

const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values }
}

test('the chat on screen comes back after a restart of DSH the app asked for, once', () => {
  const store = storage()
  rememberOpen('session-bot-7', store)
  assert.equal(store.getItem(OPEN_CHAT), 'session-bot-7')
  // A reload nobody asked for lands where it always did.
  assert.equal(takeReopen(store), null)
  // The desktop sets the flag before it stops DSH (apps/desktop src/main.js cycleDsh).
  store.setItem(REOPEN, '1')
  assert.equal(takeReopen(store), 'session-bot-7')
  assert.equal(store.getItem(REOPEN), null)
  assert.equal(takeReopen(store), null)
  // Nothing was open: nothing to reopen.
  rememberOpen(undefined, store)
  store.setItem(REOPEN, '1')
  assert.equal(takeReopen(store), null)
})

test('storage that throws (a private window, a sandbox) changes nothing', () => {
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.doesNotThrow(() => rememberOpen('x', broken))
  assert.equal(takeReopen(broken), null)
  assert.equal(takeReopen(null), null)
})
