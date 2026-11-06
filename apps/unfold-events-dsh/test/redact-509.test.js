// #509: with a comment between an explicit key's quoted name and its `:` line, the plain
// `name:value` rules read a colon inside the quoted name as a separator. The name's tail was
// masked and remembered, so every later bare occurrence of a non-secret word was masked although
// nothing was served. The plain name rules (and the gap rules) now take the first quoted token of
// an explicit key as one while its quote closes on its line: the name is served whole, nothing in
// it is remembered, and the value on the `:` line is still hidden and remembered. These rows run
// against the browser copy (which remembers) and the window's own copy of the rule. A, B and the
// empty-colon twin (the #500 rows) are unchanged. Rows are built from pieces, so no
// credential-shaped text is committed.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REDACTED, redactText, secretsIn } from '../src/client/redact.js'
import { redactText as windowText } from '../src/window.js'

const PASS = ['pass', 'word'].join('')
const KEY = ['api', '_key'].join('')
const VALUE = ['Kx7', 'plumTree'].join('')
const LEAK = ['hunter', '42x'].join('')
const OWNER = ['Owner', '4Ada'].join('')
const TAIL = ['pri', 'mary'].join('') // six characters, over the four-character remember minimum
const SHORT = ['d', 'b'].join('') // two characters, under it
const SHY = `${PASS.slice(0, 4)}\u00ad${PASS.slice(4)}` // an invisible character inside the name
const masked = (text, kept) => kept.reduce((t, v) => t.split(v).join(REDACTED), text)

// 1. The Fixer repro, in every name form: the quoted name stays whole, no part of it is
// remembered, and the value on the `:` line is hidden and remembered.
const NAMES = [
  ['a double-quoted name', `? "${PASS}:${TAIL}" # note\n: ${VALUE}\n`, `? "${PASS}:${TAIL}" # note\n: ${REDACTED}\n`],
  ['a single-quoted name', `? '${KEY}:${TAIL}' # note\n: ${VALUE}\n`, `? '${KEY}:${TAIL}' # note\n: ${REDACTED}\n`],
  ['a name after an anchor and a tag', `? &a !!str "${PASS}:${TAIL}" # note\n: ${VALUE}\n`, `? &a !!str "${PASS}:${TAIL}" # note\n: ${REDACTED}\n`],
  ['a list item', `- ? "${PASS}:${TAIL}" # note\n  : ${VALUE}\n`, `- ? "${PASS}:${TAIL}" # note\n  : ${REDACTED}\n`],
  ['an invisible character in the name', `? "${SHY}:${TAIL}" # note\n: ${VALUE}\n`, `? "${PASS}:${TAIL}" # note\n: ${REDACTED}\n`],
]
for (const [what, input, want] of NAMES) {
  test(`#509: a comment gap keeps a quoted explicit name whole (${what})`, () => {
    assert.equal(redactText(input), want, 'the browser copy serves the name whole and hides the value')
    assert.equal(windowText(input), want, 'the window serves the name whole and hides the value')
    const kept = secretsIn(input)
    assert.ok(kept.includes(VALUE), 'the value is remembered')
    assert.ok(!kept.includes(TAIL), 'no part of the name is remembered')
    assert.ok(masked(`later note: ${TAIL}`, kept).includes(TAIL), 'a later bare occurrence of the name tail is served')
    assert.ok(!masked(`later note: ${VALUE}`, kept).includes(VALUE), 'a later bare occurrence of the value is masked')
  })
}

// 2. The boundaries: a two-character tail (under the remember minimum) is still part of the name
// and never read as a value, and an unquoted name has no tail to lose.
const BOUNDARIES = [
  ['a two-character tail', `? "${PASS}:${SHORT}" # note\n: ${VALUE}\n`, `? "${PASS}:${SHORT}" # note\n: ${REDACTED}\n`],
  ['an unquoted name', `? ${PASS} # note\n: ${VALUE}\n`, `? ${PASS} # note\n: ${REDACTED}\n`],
]
for (const [what, input, want] of BOUNDARIES) {
  test(`#509: a comment gap keeps the name whole at the boundary (${what})`, () => {
    assert.equal(redactText(input), want, 'the browser copy serves the name as written and hides the value')
    assert.equal(windowText(input), want, 'the window serves the name as written and hides the value')
    const kept = secretsIn(input)
    assert.ok(kept.includes(VALUE), 'the value is remembered')
    assert.ok(!kept.includes(SHORT), 'nothing under four characters is remembered')
    assert.ok(!kept.includes(PASS), 'the name is not remembered')
  })
}

// 3. Every gap kind: no gap (the value on the name's line), a blank line and a comment line. The
// name stays whole in all of them.
const GAPS = [
  ['no gap', `? "${PASS}:${TAIL}": ${VALUE}\n`],
  ['a blank line', `? "${PASS}:${TAIL}"\n\n: ${VALUE}\n`],
  ['a comment line', `? "${PASS}:${TAIL}"\n# owner: ${OWNER}\n: ${VALUE}\n`],
]
for (const [what, input] of GAPS) {
  test(`#509: a quoted explicit name is taken whole with ${what}`, () => {
    for (const [copy, served] of [['the browser copy', redactText(input)], ['the window', windowText(input)]]) {
      assert.ok(served.includes(`"${PASS}:${TAIL}"`), `${copy}: the name is served whole`)
      assert.ok(!served.includes(VALUE), `${copy}: the value is hidden`)
    }
    const kept = secretsIn(input)
    assert.ok(kept.includes(VALUE), 'the value is remembered')
    assert.ok(!kept.includes(TAIL), 'no part of the name is remembered')
  })
}

// 4. A, its unquoted twin, B and the empty-colon twin (#500) still hold with a quoted colon name:
// a credential inside the trailing comment is masked and remembered, the name stays whole, and a
// comment line before the value is served, never remembered.
test('#509: a credential in the trailing comment is still masked and remembered', () => {
  const input = `? "${PASS}:${TAIL}" # old ${PASS}: ${LEAK}\n: ${VALUE}\n`
  const want = `? "${PASS}:${TAIL}" # old ${PASS}: ${REDACTED}\n: ${REDACTED}\n`
  assert.equal(redactText(input), want, 'the browser copy hides both values')
  assert.equal(windowText(input), want, 'the window hides both values')
  const kept = secretsIn(input)
  assert.ok(kept.includes(LEAK), 'the comment value is remembered')
  assert.ok(kept.includes(VALUE), 'the real value is remembered')
  assert.ok(!kept.includes(TAIL), 'no part of the name is remembered')
})

test('#509: the unquoted A twin is unchanged', () => {
  const input = `? ${KEY} # old ${KEY}: ${LEAK}\n: ${VALUE}\n`
  const want = `? ${KEY} # old ${KEY}: ${REDACTED}\n: ${REDACTED}\n`
  assert.equal(redactText(input), want, 'the browser copy hides both values')
  assert.equal(windowText(input), want, 'the window hides both values')
  const kept = secretsIn(input)
  assert.ok(kept.includes(LEAK), 'the comment value is remembered')
  assert.ok(kept.includes(VALUE), 'the real value is remembered')
})

const B_ROWS = [
  ['a block', `? db_${PASS}\n# owner: ${OWNER}\n: |\n  ${VALUE}\n`],
  ['an empty colon', `? db_${PASS}\n# owner: ${OWNER}\n: ${VALUE}\n`],
]
for (const [what, input] of B_ROWS) {
  test(`#509: a comment line before the value is served and never remembered (${what})`, () => {
    for (const [copy, served] of [['the browser copy', redactText(input)], ['the window', windowText(input)]]) {
      assert.ok(served.includes(`# owner: ${OWNER}`), `${copy}: the comment line is served as written`)
      assert.ok(!served.includes(VALUE), `${copy}: the real value is hidden`)
    }
    const kept = secretsIn(input)
    assert.ok(!kept.includes(OWNER), "a comment's text is not remembered")
    assert.ok(kept.includes(VALUE), 'the real value is remembered')
  })
}
