// The files this package shares with @automagik/unfold-mind-dsh, carried byte for byte: each plugin
// installs on its own, so it keeps its own copy, and the trajectory explains a reply in the same
// words as Mind. src/mind/ ships in client.js; test/support/ and catalog/ drive the real event
// window -> Mind path in the tests. Change a file there, copy it here, and move its pin.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// Our path: [its path in unfold-mind-dsh, sha256].
const PINNED = {
  'src/mind/metrics.js': ['src/metrics.js', 'da9cd2482d337613821df000dc23d52a5420a84db2d66d25893b8b0421e6c9cb'],
  'src/mind/moments.js': ['src/moments.js', '8cf3966723733950012457448fd9b8ce68f489236a949ee98d9d55c449d4f327'],
  'test/support/mind.js': ['src/mind.js', 'c91723c4fe4e7b4841cd88f672ba764be7858652beb8a58210459129b3ed208c'],
  'test/support/redact.js': ['src/redact.js', '9d60d667f39f69543f9197bb40b394e186d2bf73d9c3540d1123087851b18264'],
  'test/support/sentences.js': ['src/sentences.js', '3602f811415cbb91f0795845d4fc9f86019977fa83f41cb4b7ec7a248e59410a'],
  'test/support/display.js': ['src/display.js', '41aa8e7d2def996f7a1ffa1e516c7ddf814379d83ee6138740cc1015abae5c13'],
  'test/support/catalog.js': ['test/support/catalog.js', 'c3e93d3df9136234fff3649243cd5157d5731e7663f1030ce9bc0c29cdd4912e'],
  'test/support/window.js': ['test/support/window.js', '54d35803fde23aab37bb740445031d22874ebf31aee001310c2963a9f23a37e6'],
  'catalog/events.v3.json': ['catalog/events.v3.json', '386f87aa7e0124ef16fac7dd9ecff2e3bb2cd3139a10f0f1a5ac7da1364e0647'],
}
const sha = (url) => createHash('sha256').update(readFileSync(url)).digest('hex')

for (const [ours, [theirs, pin]] of Object.entries(PINNED)) {
  test(`${ours} is unfold-mind-dsh's ${theirs}, byte for byte`, () => {
    assert.equal(sha(new URL(`../${ours}`, import.meta.url)), pin)
    const sibling = new URL(`../../unfold-mind-dsh/${theirs}`, import.meta.url)
    if (existsSync(sibling)) assert.equal(sha(sibling), pin, `${theirs} moved: copy apps/unfold-mind-dsh/${theirs} to ${ours} and move the pin`)
  })
}
