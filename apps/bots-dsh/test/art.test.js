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
  for (const name of ['Fredoka', 'DMSans']) assert.match(readFileSync(new URL(`../src/client/art/fonts/OFL-${name}.txt`, import.meta.url), 'utf8'), /SIL Open Font License/)
})

// The title face is the brand's: the font file and its licence are byte copies of docs/brand/fonts,
// and the theme's font rule, family and three weights are the ones docs/brand/tokens records.
test("the title face is the brand folder's: its files byte for byte, its rule and its weights", () => {
  const brand = name => readFileSync(new URL(`../../../docs/brand/${name}`, import.meta.url))
  const ours = name => readFileSync(new URL(`../src/client/art/fonts/${name}`, import.meta.url))
  for (const name of ['fredoka-latin.woff2', 'OFL-Fredoka.txt']) assert.ok(ours(name).equals(brand(`fonts/${name}`)), `${name} differs from docs/brand/fonts/${name}: copy the brand's file`)
  const tokens = JSON.parse(brand('tokens/tokens.json').toString())
  const rule = /@font-face\{font-family:"Fredoka";[^}]*?\}/.exec(brand('tokens/tokens.css').toString())[0]
  const face = rule.slice(0, rule.indexOf('src:'))
  assert.match(face, /font-weight:300 700;.*size-adjust:105%;$/)
  const weight = name => tokens.type.weights.find(entry => entry.name === name).value
  const weights = `--bt-weight-title:${weight('weight-title')};--bt-weight-strong:${weight('weight-strong')};--bt-weight-label:${weight('weight-label')};`
  assert.equal(weights, '--bt-weight-title:536;--bt-weight-strong:469;--bt-weight-label:402;')
  for (const sheet of ['clay.js', 'stage.js']) {
    const text = readFileSync(new URL(`../src/client/${sheet}`, import.meta.url), 'utf8')
    assert.ok(text.includes(`${face}src:url("\${fredokaLatin}") format("woff2")}`), `${sheet}: the Fredoka @font-face rule is not the brand's`)
    assert.ok(text.includes(`const HEAD = '${tokens.type.families.head.replaceAll(', ', ',')}'`), `${sheet}: the title family is not the brand's`)
    assert.ok(text.includes(weights), `${sheet}: the three title weights are not the brand's (${weights})`)
    assert.doesNotMatch(text, /Manrope/)
  }
})
