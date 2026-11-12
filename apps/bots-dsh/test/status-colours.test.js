import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The status colours are the brand's. docs/brand/tokens/tokens.json records them, chosen so that
// red-blind, green-blind and blue-blind sight can tell them apart; both theme sheets carry the same
// values, light and dark, so a status looks the same whichever theme is on.
const tokens = JSON.parse(readFileSync(new URL('../../../docs/brand/tokens/tokens.json', import.meta.url), 'utf8'))
const names = ['st-ok', 'st-okdot', 'st-bad', 'st-warn', 'st-warndot', 'st-work', 'bt-danger', 'bt-green']
const brand = (name, theme) => {
  const value = tokens.color.tokens.find(token => token.name === name)?.value[theme]
  assert.match(value ?? '', /^#[0-9a-f]{6}$/, `docs/brand/tokens/tokens.json has no ${theme} colour for ${name}`)
  return value
}
const blocks = sheet => {
  // The sheets are template strings: a `${name}` inside a block is not the block's end.
  const text = readFileSync(new URL(`../src/client/${sheet}`, import.meta.url), 'utf8').replace(/\$\{[^}]*\}/g, '')
  return {
    light: /\nhtml body\{([\s\S]*?)\}/.exec(text)[1],
    dark: /\nhtml body\[data-ds-dark-theme\]\{([\s\S]*?)\}/.exec(text)[1],
  }
}
const set = (block, name) => [...block.matchAll(new RegExp(`--${name}:([^;}]+)`, 'g'))].map(match => match[1])

for (const sheet of ['stage.js', 'clay.js']) {
  test(`${sheet}: every status colour is the brand's, light and dark`, () => {
    for (const [theme, block] of Object.entries(blocks(sheet))) {
      for (const name of names) assert.deepEqual(set(block, name), [brand(name, theme)], `${sheet}, ${theme}: --${name} is not the value docs/brand/tokens/tokens.json records`)
    }
  })
}

// The clay theme paints its done and failed marks with its own two names: they are the same green and red.
test("clay.js: the theme's own green and red are the status green and red", () => {
  for (const [theme, block] of Object.entries(blocks('clay.js'))) {
    assert.deepEqual(set(block, 'clay-ok'), [brand('st-ok', theme)], `clay.js, ${theme}: --clay-ok is not the brand's st-ok`)
    assert.deepEqual(set(block, 'clay-bad'), [brand('st-bad', theme)], `clay.js, ${theme}: --clay-bad is not the brand's st-bad`)
  }
})

// Text stays readable: 4.5 to 1 or more (WCAG) on the grounds it sits on. Two status texts sit on
// coloured grounds, where the brand's own values fall short, so each theme sheet carries a stronger
// shade for text alone: amber for the sidebar's "asks you" line (on the stage, on Clay's sidebar and
// on its selected lilac row) and red for text on a red-tinted ground. Dots keep the brand's values.
const channel = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const parts = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
const luminance = hex => { const [r, g, b] = parts(hex).map(part => channel(part / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const tint = (colour, share, ground) => `#${parts(colour).map((part, index) => Math.round(part * share + parts(ground)[index] * (1 - share)).toString(16).padStart(2, '0')).join('')}`
const one = (block, name) => { const found = set(block, name); assert.equal(found.length, 1, `--${name} is set ${found.length} times`); return found[0] }
const palette = (sheet, name) => Object.fromEntries([...new RegExp(`${name} = Object\\.freeze\\(\\{([^}]*)\\}`).exec(readFileSync(new URL(`../src/client/${sheet}`, import.meta.url), 'utf8'))[1].matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map(match => [match[1], match[2]]))

test('the strong amber and the strong red read at 4.5 to 1 or more on the coloured grounds they sit on', () => {
  const grounds = {
    'stage.js': { light: palette('stage.js', 'STAGE_LIGHT'), dark: palette('stage.js', 'STAGE_DARK') },
    'clay.js': { light: palette('clay.js', 'CLAY_LIGHT'), dark: palette('clay.js', 'CLAY_DARK') },
  }
  for (const sheet of ['stage.js', 'clay.js']) {
    for (const [theme, block] of Object.entries(blocks(sheet))) {
      const amber = one(block, 'st-warn-strong')
      const red = one(block, 'st-bad-strong')
      // The "asks you" line: on the stage's three colours, or on Clay's sidebar and its selected lilac row.
      const under = sheet === 'stage.js' ? one(block, 'st-stage').match(/#[0-9a-f]{6}/g) : [grounds[sheet][theme].sidebar, one(block, 'clay-lilac')]
      assert.ok(under.length >= 2, `${sheet}, ${theme}: no grounds found for the "asks you" line`)
      for (const ground of under) assert.ok(contrast(amber, ground) >= 4.5, `${sheet}, ${theme}: --st-warn-strong ${amber} on ${ground} is ${contrast(amber, ground).toFixed(2)} to 1`)
      // Red text on a red tint: a tenth of the status red over the card.
      const tinted = tint(one(block, 'bt-danger'), 0.1, grounds[sheet][theme].card)
      assert.ok(contrast(red, tinted) >= 4.5, `${sheet}, ${theme}: --st-bad-strong ${red} on ${tinted} is ${contrast(red, tinted).toFixed(2)} to 1`)
    }
  }
})

test('the four texts on coloured grounds read the strong shade', () => {
  const source = name => readFileSync(new URL(`../src/client/${name}`, import.meta.url), 'utf8')
  assert.ok(source('styles.js').includes('.bt-row-preview-ask{color:var(--st-warn-strong,var(--st-warn,var(--bt-ink-2)));'))
  // Each theme recolours a row's preview line with a more specific rule; the "asks you" line keeps its amber through it.
  assert.ok(source('stage.js').includes('html body .bt-row .bt-row-preview-ask,html body .bt-row[aria-current=page] .bt-row-preview-ask{color:var(--st-warn-strong)}'))
  assert.ok(source('clay.js').includes('html body .bt-row[aria-current=page] .bt-row-preview-ask{color:var(--st-warn-strong)}'))
  assert.ok(source('styles.js').includes('.bt-mem-remove[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--st-bad-strong,var(--bt-danger));'))
  assert.ok(source('schedules.js').includes('.bt-task-remove[data-confirm]{background:color-mix(in srgb,var(--bt-danger) 10%,transparent);color:var(--st-bad-strong,var(--bt-danger))}'))
  assert.ok(source('hermes-remote.js').includes('.bt-hw-error-note{background:color-mix(in srgb,var(--bt-danger) 10%,var(--bt-card));border-color:transparent;color:var(--st-bad-strong,var(--bt-danger))}'))
})
