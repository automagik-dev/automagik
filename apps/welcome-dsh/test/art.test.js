import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

// Unfold's expression strip is the one approved, byte for byte: lossless, never re-encoded.
test('the Unfold strip keeps its approved bytes', () => {
  const strip = readFileSync(new URL('../src/client/vendor/art/unfold-expressions.webp', import.meta.url))
  assert.equal(createHash('sha256').update(strip).digest('hex'), '081a3d3677e78c5b3b15db45dfeb2aed67b5a49b69f4eb16e6d225950155dbb0')
})

// The welcome carries no font. Its titles name a family, and the face comes from the Bot team's
// theme, which is on the page with it. So the welcome's first title family must be the family of
// the Bot team's @font-face rule, in both Bot team sheets, and the whole list is the brand's.
test("the welcome's title family is the face the Bot team's theme carries, and the brand's list", () => {
  const head = /--oai-head:([^;]+);/.exec(readFileSync(new URL('../src/client/clay.js', import.meta.url), 'utf8'))[1]
  const first = head.split(',')[0].replaceAll('"', '').trim()
  for (const sheet of ['clay.js', 'stage.js']) {
    const text = readFileSync(new URL(`../../bots-dsh/src/client/${sheet}`, import.meta.url), 'utf8')
    const faces = [...text.matchAll(/@font-face\{font-family:"?([^";]+)"?;[^}]*\}/g)].map(match => match[1])
    assert.ok(faces.includes(first), `the Bot team's ${sheet} carries ${faces.join(', ')}, and the welcome's titles ask for ${first}`)
    assert.ok(text.includes(`const HEAD = '${head}'`), `the Bot team's ${sheet} names another title family than the welcome's`)
  }
  const tokens = JSON.parse(readFileSync(new URL('../../../docs/brand/tokens/tokens.json', import.meta.url), 'utf8'))
  assert.equal(head, tokens.type.families.head.replaceAll(', ', ','))
  // The weights are the Bot team theme's variables, which hold the brand's three weights; each
  // rule keeps the weight it had as the fallback for a page without that theme.
  for (const file of ['octopus.js', 'onboard-css.js']) {
    const text = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
    const rules = [...text.matchAll(/font:([^;}]*) var\(--oai-head\)/g)].map(match => match[1])
    assert.ok(rules.length > 0)
    for (const rule of rules) assert.match(rule, /^var\(--bt-weight-(title|strong),[78]00\) /, `${file}: a title rule sets its own weight (${rule})`)
  }
})
