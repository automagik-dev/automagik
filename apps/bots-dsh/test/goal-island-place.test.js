// Where a group's goal island sits in Automagik's header band. The band is right-aligned (Details on
// the right), so the island is placed by rule: on the chat column's centre where the band has room,
// in the row beside Details where it does not; level with Details; one surface, with no theme look
// of a header button on its inner parts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = name => readFileSync(new URL(`../src/client/${name}`, import.meta.url), 'utf8')
const goal = source('goal.js')

test('the island centres on the chat column in a wide band and stays in the row in a narrow one', () => {
  // The band, not the window, is measured: the left column and an open panel both narrow it.
  assert.ok(goal.includes('header[class*="_header"] .bt-head{container:bt-head/inline-size}'))
  assert.ok(goal.includes('@container bt-head (min-width:820px){.bt-island{position:absolute;top:var(--bt-island-top,0px);left:0;right:0;margin-inline:auto}}'))
  // Out of the container rule the island is a flex item of the band, at the row's start.
  const own = /\n\.bt-island\{([^}]*)\}/.exec(goal)[1]
  assert.match(own, /position:relative/)
  assert.match(own, /align-self:flex-start/)
  // Open, a centred island of 560 px ends before Details in a band of 820 px with the theme's 24 px edge.
  assert.match(goal, /\.bt-island\[data-open\]\{width:min\(560px,calc\(100% - 48px\)\)/)
  assert.ok((820 + 560) / 2 < 820 - 24 - 95, 'an open island reaches Details at the narrowest centred band')
})

test('the island takes its radius and its level from the theme, and the Automagik theme sets both', () => {
  const own = /\n\.bt-island\{([^}]*)\}/.exec(goal)[1]
  assert.match(own, /border-radius:var\(--bt-island-radius,20px\)/)
  assert.match(own, /margin-top:var\(--bt-island-lift,0px\)/)
  // The Automagik theme pads the band by 18 px and centres Details 3 px above the row's start.
  assert.ok(source('stage.js').includes('html body .bt-head{min-height:64px;padding:18px 24px 12px;--bt-island-top:18px;--bt-island-lift:-3px;--bt-island-radius:12px}'))
})

test('a theme\'s header button look stops at the island\'s edge', () => {
  assert.ok(goal.includes('html body .bt-island :is(.bt-pill,.bt-goal-bar,.bt-goal-step){border:0;border-radius:0;background:none;box-shadow:none}'))
  assert.ok(goal.includes('html body .bt-island :is(.bt-pill,.bt-goal-bar,.bt-goal-step):is(:hover,:active):not(:disabled){box-shadow:none;transform:none}'))
  // Both themes dress every button in the band; the island's rule is the more specific one.
  for (const sheet of ['stage.js', 'clay.js']) assert.ok(source(sheet).includes('html body :is(.bt-soft,.bt-q-btn,.bt-pill,.bt-model-chip,.bt-head button){'), sheet)
})
