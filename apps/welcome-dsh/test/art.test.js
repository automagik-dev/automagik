import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { inlineArt } from '../scripts/inline-art.mjs'

// The pictures reach the bundle through src/client/vendor/art/inline.js.
test('vendor/art/inline.js holds the files beside it', () => {
  assert.equal(inlineArt(), readFileSync(new URL('../src/client/vendor/art/inline.js', import.meta.url), 'utf8'), 'src/client/vendor/art/inline.js is stale: run `node scripts/inline-art.mjs` and commit it')
})

// The copies are the Bot team's own pictures, byte for byte.
test('the vendored pictures are the Bot team\'s', () => {
  for (const name of ['genie-expressions.webp', 'lamp.webp', 'omni-expressions.webp', 'unfold-expressions.webp']) {
    assert.deepEqual(readFileSync(new URL(`../src/client/vendor/art/${name}`, import.meta.url)), readFileSync(new URL(`../../bots-dsh/src/client/art/${name}`, import.meta.url)), name)
  }
})

