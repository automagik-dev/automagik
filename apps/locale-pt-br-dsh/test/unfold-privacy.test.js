// The Privacy page in Unfold's own instance (AUTOMAGIK_HOST=unfold, bots-dsh privacy.js): Unfold's
// Privacy controls what is shared, and the page says so in pt-BR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { omniKeys } from '../scripts/copy-check.mjs'
import { loadDictionaries } from '../scripts/dictionaries.mjs'

const UNFOLD_PRIVACY = [
  'Your Bots, chats, memory and files stay on this computer. Uploads are off here, and nothing on this page can turn one on.',
  'What is shared',
  "Unfold's Privacy controls this",
  "To see or change what is shared, open Unfold's settings.",
]

test('the Privacy page under Unfold reads in pt-BR', async () => {
  const keys = await omniKeys()
  assert.deepEqual(UNFOLD_PRIVACY.filter((key) => !keys.has(key)), [], 'no longer the Bot team\'s keys')
  const omni = loadDictionaries()['omni-ui']
  assert.deepEqual(UNFOLD_PRIVACY.filter((key) => typeof omni[key] !== 'string' || omni[key] === ''), [])
})
