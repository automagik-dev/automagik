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
const FILL = { '{name}': ['pass', 'word'].join(''), '{camel}': ['api', 'Key'].join(''), '{parent}': ['sec', 'ret'].join(''), '{value}': ['hunter', 2].join('') }
const fill = (s) => s.replace(/\{(?:name|camel|parent|value)\}/g, (k) => FILL[k])

for (const [what, input, want] of TABLE.continuation) test(`continuation: ${what}`, () => assert.equal(redactText(fill(input)), fill(want)))
