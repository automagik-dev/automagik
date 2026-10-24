import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { inlineArt } from '../scripts/inline-art.mjs'

// The pictures and fonts reach the bundle through src/client/art/inline.js.
test('art/inline.js holds the files beside it', () => {
  assert.equal(inlineArt(), readFileSync(new URL('../src/client/art/inline.js', import.meta.url), 'utf8'), 'src/client/art/inline.js is stale: run `node scripts/inline-art.mjs` and commit it')
})

// The fonts the clay theme bundles are under the SIL Open Font License, shipped beside them.
test('every bundled font ships with its licence', () => {
  for (const name of ['Manrope', 'DMSans']) assert.match(readFileSync(new URL(`../src/client/art/fonts/OFL-${name}.txt`, import.meta.url), 'utf8'), /SIL Open Font License/)
})
