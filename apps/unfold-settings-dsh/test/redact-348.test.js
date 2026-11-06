// The #348 table, test/fixtures/redact-348.json: the same file, byte for byte, in unfold-mind-dsh
// and unfold-events-dsh (scripts/unfold-copies.test.ts), so the copies of the redaction cannot
// diverge on it. Invisible characters inside a credential name (NUL, zero-width, BOM, bidi marks,
// raw or as a JSON \u escape) and YAML anchors and tags before its value. A text row serves the
// shape of its plain form; an object row hides the value under a key read without its invisible
// characters and keeps the key as written; a near miss keeps its value.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { redact, redactText } from '../src/redact.js'

const TABLE = JSON.parse(readFileSync(new URL('./fixtures/redact-348.json', import.meta.url), 'utf8'))

for (const [what, input, want] of TABLE.text) test(`text: ${what}`, () => assert.equal(redactText(input), want))
for (const [what, input, want] of TABLE.object) test(`object: ${what}`, () => assert.deepEqual(redact(input), want))

// #396 and #410, the table's `continuation` rows (one table, read the same way by the Mind, window
// and settings copies): a credential key line that ends at its colon, or at up to two anchors and
// tags, a comment after them or not, continues on a later line. Blank and comment lines are
// skipped, and so are lines of anchors and tags indented under the key; then the first line strictly
// more indented is the value (hidden with its continued lines, or a block indicator, whose lines are
// hidden), a more indented mapping line is a child key, and a line at the key's indent or less is a
// sibling. The key line and each blank, comment, anchor and tag line are kept as written. The rows
// hold placeholders, filled here from pieces, so no credential-shaped text is committed.
const FILL = { '{name}': ['pass', 'word'].join(''), '{camel}': ['api', 'Key'].join(''), '{parent}': ['sec', 'ret'].join(''), '{value}': ['hunter', 2].join(''), '{pass}': 'pass', '{word}': 'word' }
const fill = (s) => s.replace(/\{(?:name|camel|parent|value|pass|word)\}/g, (k) => FILL[k])

for (const [what, input, want] of TABLE.continuation) test(`continuation: ${what}`, () => assert.equal(redactText(fill(input)), fill(want)))

// #406, the table's `partial_key` rows read whole (`{cut}` marks where a stream's first part stops).
for (const [what, input, want] of TABLE.partial_key) test(`partial key: ${what}`, () => assert.equal(redactText(fill(input).split('{cut}').join('')), fill(want)))

// #406 F-B residual: a cut pads the unfinished line with blanks. In a growing buffer that line may
// still be arriving, so a bare token on it is neither hidden nor remembered until its line ends (a
// colon makes it a child key, a line end its parent's scalar); until then it is withheld, never
// served. A whole payload keeps the old, fail-closed read of its last line.
const PARTIAL = TABLE.partial_key.map(([what, input]) => [what, fill(input).split('{cut}')])
const PADDED = PARTIAL.filter(([, [head]]) => {
  const pending = head.slice(head.search(/[^\r\n]*$/)).trim()
  return pending && !pending.includes(':') && !/^[ \t]*[|>]/m.test(head)
})
test('a partial child key padded by a cut is neither hidden nor served while its line is open', () => {
  assert.equal(PADDED.length, 4, 'the anchor line, the anchored child, the spaced child and the plain guard')
  for (const [what, [head]] of PADDED) {
    const pending = head.slice(head.search(/[^\r\n]*$/)).trim()
    const out = redactText(`${head}${' '.repeat(17_000)}`, true)
    assert.ok(!out.includes('[redacted]'), `${what}: not masked while the line is open`)
    assert.ok(!out.includes(pending), `${what}: withheld, never served`)
    assert.ok(redactText(head).includes('[redacted]'), `${what}: a whole payload still hides it`)
  }
})

// #406's last frame: the value that completes the token on a cut-padded line. While that line is
// still arriving no rule can read it (its head is cut, so the name arrives in parts) and the value
// is not remembered until its line ends, so the frame must withhold the rest of the line too: on
// every prefix of the growing buffer, the value is never served.
test('a cut-padded line never serves the value at the frame that completes it', () => {
  const VALUE = /hunter2/
  for (const [what, [head, tail]] of PARTIAL) {
    let grown = `${head}${' '.repeat(17_000)}`
    for (const ch of `${tail}\nand goes on`) {
      grown += ch
      assert.doesNotMatch(redactText(grown, true), VALUE, `${what}: no frame serves the value`)
    }
  }
})

// #406 F-B: a line a cut padded with blanks is hidden whole, as its name cannot be read across the
// pad (the parts of a credential name arrive apart). The same rule is in the window and the browser
// copy, byte for byte (scripts/unfold-copies.test.ts).
test('a padded line is hidden whole', () => {
  const VALUE = /hunter2/
  const padded = `${fill('{parent}: &d\n  {pass}')}${' '.repeat(17_000)}${fill('{word}: {value}')}\n`
  assert.doesNotMatch(redactText(padded), VALUE, 'whole payload')
  assert.doesNotMatch(redactText(padded, true), VALUE, 'growing buffer')
})

const SECRET = FILL['{value}']

// #406 Design A, the class rule: in a growing buffer the suffix after the last line terminator is
// never matched, served or remembered until its terminator arrives, however many deltas it came in,
// and no bound starts inside that open line. The table's `split_forms` (one table, byte-identical in
// mind/events/settings): a cut-padded key line, plain, an explicit key's block, a list item's
// explicit key, an explicit key's plain value and its list item, each with the value on the line
// under the pad (and the plain key line completed on its own line). One deterministic test per form,
// each cell run once: every pad (1000, under the 4096 keep; 4096, at it; 5000 and 17000, past it,
// and 17000 past the window's 16 KiB bound too) and every split (1, 10 and 100 characters, and the
// whole payload as one delta). From the frame that brings the value's first character on (no frame
// before it holds the value), no served frame holds the value, and the copies that remember values
// remember it only from the frame that ends its line on; at rest it is hidden and remembered.
const SPLIT_PADS = [1000, 4096, 5000, 17000]
const SPLIT_SIZES = [1, 10, 100, 'one delta']
// One redaction per delta: 1-character deltas over a pad at or past the 4096 keep cost minutes on a
// developer machine, so those cells run in CI only (GitHub Actions sets CI); elsewhere each one is
// skipped with this reason, never left out.
const SLOW_SPLIT = (pad, size) => size === 1 && pad >= 4096
const SLOW_SKIP = process.env.CI ? false : 'CI only: 1-character deltas over a pad at or past the 4096 keep (set CI=1 to run it)'
const splitPayload = (template, pad) => fill(template).replace('{pad}', ' '.repeat(pad)).replace('{later}', `later the ${FILL['{name}']} and user words stay`)
// Each cell of a form: its row, pad and split, the payload, where the value starts and the
// terminator that ends its line.
function* splitCells(rows) {
  for (const [what, template] of rows) for (const pad of SPLIT_PADS) for (const size of SPLIT_SIZES) {
    const payload = splitPayload(template, pad)
    const at = payload.indexOf(SECRET)
    const end = payload.indexOf('\n', at + SECRET.length)
    yield { name: `${what}, pad ${pad}, ${size === 'one delta' ? 'one delta' : `${size}-char deltas`}`, skip: SLOW_SPLIT(pad, size) && SLOW_SKIP, payload, at, end, step: size === 'one delta' ? payload.length : size }
  }
}

// Settings keeps no stream and no remembered values: each frame is its growing buffer read whole.
for (const [form, rows] of TABLE.split_forms) {
  test(`served however the deltas were split (#406 Design A): ${form}`, async (t) => {
    for (const cell of splitCells(rows)) {
      await t.test(cell.name, { skip: cell.skip }, () => {
        const { payload, at, step } = cell
        for (let i = 0; i < payload.length; i += step) {
          if (i + step <= at) continue // the value has not arrived
          const upto = Math.min(i + step, payload.length)
          assert.ok(!redactText(payload.slice(0, upto), true).includes(SECRET), `${cell.name}, the frame ending at ${upto}: the growing buffer hides the value`)
        }
        assert.ok(!redactText(payload).includes(SECRET), `${cell.name}: the completed text hides the value`)
        assert.ok(redactText(payload).endsWith('user words stay'), `${cell.name}: the text after it is served`)
      })
    }
  })
}

