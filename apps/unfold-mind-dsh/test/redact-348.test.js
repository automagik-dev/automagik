// The #348 table, test/fixtures/redact-348.json: the same file, byte for byte, in unfold-events-dsh
// and unfold-settings-dsh (scripts/unfold-copies.test.ts), so the copies of the redaction cannot
// diverge on it. Invisible characters inside a credential name (NUL, zero-width, BOM, bidi marks,
// raw or as a JSON \u escape) and YAML anchors and tags before its value. A text row serves the
// shape of its plain form; an object row hides the value under a key read without its invisible
// characters and keeps the key as written; a near miss keeps its value.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadDefinitions } from '../src/definitions.js'
import { MindStream } from '../src/mind.js'
import { redact, redactText, secretsIn } from '../src/redact.js'

const TABLE = JSON.parse(readFileSync(new URL('./fixtures/redact-348.json', import.meta.url), 'utf8'))
const VALUE = /hunter2/
// The rows whose value the redaction hides.
const HIDDEN = TABLE.text.filter(([, input, want]) => VALUE.test(input) && !VALUE.test(want))
// A block scalar's key line: a name, its colon, up to two anchors or tags, then an indicator, a
// comment (after a space or glued on) and a CR.
const BLOCK = /:[ \t]*(?:[&!][^\s"'`]*[ \t]+){0,2}[|>][-+0-9]*(?:[ \t]*#[^\r\n]*)?[ \t]*\r?$/m
// The rows whose anchor or tag has no value on its line: the next line's key is never the value.
const NEXT_LINE = TABLE.text.filter(([what]) => what.startsWith('next line:'))
// The invalid YAML rows (three or more anchors and tags): left as written, nothing remembered.
const INVALID = TABLE.text.filter(([what]) => what.startsWith('invalid YAML:'))

for (const [what, input, want] of TABLE.text) test(`text: ${what}`, () => assert.equal(redactText(input), want))
for (const [what, input, want] of TABLE.object) test(`object: ${what}`, () => assert.deepEqual(redact(input), want))

test('a hidden value is remembered as the value, not as an anchor, a tag or a name', () => {
  for (const [what, input] of HIDDEN) {
    assert.ok(!secretsIn(`${input} `).some((v) => /^[&!|>]/.test(v)), what)
    if (BLOCK.test(input)) continue // a block scalar's lines are not remembered, as for its plain form
    assert.ok(secretsIn(`${input} `).some((v) => VALUE.test(v)), what)
  }
})

test('an invalid YAML row is remembered as nothing', () => {
  for (const [what, input] of INVALID) assert.deepEqual(secretsIn(`${input} `), [], what)
})

function journal() {
  const mind = new MindStream({ now: () => 1 })
  mind.life = 'lifeZ'
  let seq = 0
  const send = (text) => mind.agentd({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text }, { via: 'agentd journal', file: '/j', offset: seq })
  mind.agentd({ v: 2, id: 'g:0', producer: 'g', seq: 0, t_ns: 0, source: 'guest', kind: 'response_started', response_id: 'rK' }, { via: 'agentd journal', file: '/j', offset: 0 })
  const served = () => [JSON.stringify(mind.snapshot()), ...mind.rows.map((x) => JSON.stringify(mind.detail(x.id, loadDefinitions())))].join('\n')
  return { send, served, row: () => mind.rows.find((x) => x.kind === 'agent_delta') }
}

test('served: every row the table hides stays hidden in the stream, whole and a character at a time', () => {
  for (const [what, input] of HIDDEN) {
    const whole = journal()
    whole.send(`the config has ${input}\nand goes on`)
    assert.doesNotMatch(whole.served(), VALUE, what)
    const split = journal()
    for (const ch of `the config has ${input}\nand goes on`) split.send(ch)
    assert.doesNotMatch(split.served(), VALUE, `${what}, a character at a time`)
  }
})

test('served: a value under an invisible name or an anchor that the 4096 cut sweeps through stays hidden', () => {
  for (const head of ['pass​word: ', 'pass\u0000word: ', 'password: &a ', 'password: !!str ', 'password: &a !!str ']) {
    const r = journal()
    r.send(`${head}"${'hunter2 '.repeat(800)}"`)
    r.send(' and goes on')
    assert.doesNotMatch(r.served(), VALUE, JSON.stringify(head))
  }
})

// A block scalar under an anchor or tag before its indicator, longer than the bound, streamed a line
// at a time: no line of it is served, and the text after it is.
const BLOCK_HEADS = ['password: &a |', 'password: !!str >-', 'password: !<tag:yaml.org,2002:str> |', 'dbPassword: &a !!str |+']
const BLOCK_LINES = Array.from({ length: 700 }, (_, i) => `    hunter2 line ${i}\n`)
test('served: a block scalar under an anchor or tag longer than the 4096 keep, a line at a time, stays hidden', () => {
  for (const head of BLOCK_HEADS) {
    const r = journal()
    r.send(`config:\n  ${head}\n`)
    for (const line of BLOCK_LINES) r.send(line)
    assert.doesNotMatch(r.served(), VALUE, head)
    r.send('next: shown')
    assert.match(r.served(), /next: shown/, head)
  }
})

test('an anchor or tag with no value on its line never makes the next line\'s key a remembered value', () => {
  for (const [what, input] of NEXT_LINE) {
    assert.deepEqual(secretsIn(`${input} `).filter((v) => /username|bob|^[&!]/.test(v)), [], what)
    const r = journal()
    r.send(`${input}\n`)
    r.send('later username: carol')
    assert.match(r.served(), /later username: carol/, what)
  }
})

// A key line, then a blank run longer than the 4096 keep before its indicator: the cut lands in the
// run, and the key line is kept, so the block's lines that arrive next are hidden under it.
test('served: a blank run past the 4096 keep between a key line and its block indicator keeps the block hidden', () => {
  for (const [what, head, indicator] of TABLE.blank_run) {
    const r = journal()
    r.send(`config:\n  ${head}${' '.repeat(17_000)}`)
    r.send(`${indicator}\n`)
    for (const line of BLOCK_LINES.slice(0, 5)) r.send(line)
    assert.doesNotMatch(r.served(), VALUE, what)
    r.send('next: shown')
    assert.match(r.served(), /next: shown/, what)
  }
})

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
const SECRET = FILL['{value}']
const CONTINUED = TABLE.continuation.map(([what, input, want]) => [what, fill(input), fill(want)])
const CONTINUED_HIDDEN = CONTINUED.filter(([, input, want]) => input.includes(SECRET) && !want.includes(SECRET))
// The rows that keep the value (a sibling, a child with no credential name, a comment line that
// names a key): it is served, and never remembered.
const KEPT = CONTINUED.filter(([, , want]) => want.includes(SECRET))
// A block indicator on a later line: its lines are not remembered, as under one on the key's line.
const LATER_BLOCK = /^[ \t]+(?:[&!][^\s"'`]*[ \t]+){0,2}[|>][-+0-9]*(?:[ \t]*#[^\r\n]*)?[ \t]*$/m
// The name a row's key line holds, served again after a cut.
const nameOf = (input) => (input.includes(FILL['{camel}']) ? FILL['{camel}'] : FILL['{name}'])
// Where a cut can land before the value: the end of each line before it (a CRLF's CR), and right
// before the value. A blank run there keeps each line as it reads: a key line or a line under it
// gains trailing blanks, and a blank line stays blank.
const cutsOf = (input) => {
  const at = input.indexOf(SECRET)
  const cuts = [at]
  for (let i = 0; i < at; i++) if ((input[i] === '\r' || input[i] === '\n') && input[i - 1] !== '\r') cuts.push(i)
  return cuts
}

for (const [what, input, want] of CONTINUED) test(`continuation: ${what}`, () => assert.equal(redactText(input), want))

// A value on a later line is remembered once its line has ended (#406): a blank after it is not
// enough, as a key may hold one and a cut pads with them, so each row ends at a line break here.
test('continuation: a hidden value is remembered, and no anchor, tag, indicator or kept value is', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const kept = secretsIn(`${input}\n`)
    assert.ok(!kept.some((v) => /^[&!|>]/.test(v)), what)
    if (!LATER_BLOCK.test(input)) assert.ok(kept.some((v) => v.includes(SECRET)), what)
  }
  for (const [what, input] of KEPT) assert.ok(!secretsIn(`${input}\n`).some((v) => v.includes(SECRET)), what)
})

test('served: a value on a later line stays hidden in the stream, whole and a character at a time; a kept one is served', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const whole = journal()
    whole.send(`${input}\nand goes on`)
    assert.ok(!whole.served().includes(SECRET), what)
    const split = journal()
    for (const ch of `${input}\nand goes on`) split.send(ch)
    assert.ok(!split.served().includes(SECRET), `${what}, a character at a time`)
  }
  for (const [what, input] of KEPT) {
    const whole = journal()
    whole.send(`${input}\nand goes on`)
    assert.ok(whole.served().includes(SECRET), what)
    const split = journal()
    for (const ch of `${input}\nand goes on`) split.send(ch)
    assert.ok(split.served().includes(SECRET), `${what}, a character at a time`)
  }
})

// A blank run past the 4096 keep at each place a cut can land before the value (the end of the key
// line, of each blank, comment, anchor, tag or indicator line under it, and right before the value):
// the key line and the lines under it that hold anchors, tags or an indicator are kept, and the
// value that arrives next, a character at a time, is hidden.
test('served: a cut after a key line, in the lines under it or before its value keeps the key and hides the value', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    for (const at of cutsOf(input)) {
      const r = journal()
      r.send(`${input.slice(0, at)}${' '.repeat(17_000)}`)
      for (const ch of `${input.slice(at)}\nand goes on`) r.send(ch)
      assert.ok(!r.served().includes(SECRET), `${what}, cut at ${at}`)
      assert.ok(r.served().includes(nameOf(input)), `${what}, cut at ${at}: the key is still served`)
    }
  }
})

// #406, the table's `partial_key` rows: in the stream, a line more indented than a key line with no
// colon on it yet (a child key still arriving; `{cut}` marks where the first part stops) is never
// remembered as the key's value, so later text that names a credential is served as written, and
// once the rest arrives the row is served as its whole text is. Each row is sent whole, a character
// at a time, in two parts split at the cut, and past the 4096 keep (filler before it, so the keep's
// cut lands in the filler, then the rest a character at a time). A blank run past the keep at the cut
// pads the partial line with blanks: nothing on it is remembered either (the padded text is no longer
// the row's, so its value is not checked).
const LATER = fill('\nlater the {name}, {parent} and user words stay')
const PARTIAL = TABLE.partial_key.map(([what, input, want]) => [what, fill(input).split('{cut}'), fill(want)])
const FILLER = 'filler words here\n'.repeat(Math.ceil(4096 / 18))

for (const [what, [head, tail], want] of PARTIAL) test(`partial key: ${what}`, () => assert.equal(redactText(`${head}${tail}`), want))

test('served: a child key still arriving under a key line is never remembered as its value, whole, in parts and past the 4096 keep', () => {
  for (const [what, [head, tail], want] of PARTIAL) {
    const whole = `${head}${tail}${LATER}`
    const partial = head.slice(head.search(/[^\r\n]*$/)).trim()
    const runs = {
      whole: (r) => r.send(whole),
      'a character at a time': (r) => { for (const ch of whole) r.send(ch) },
      'in two parts at the cut': (r) => { r.send(head); r.send(`${tail}${LATER}`) },
      'past the 4096 keep': (r) => { r.send(`${FILLER}${head}`); for (const ch of `${tail}${LATER}`) r.send(ch) },
      'a blank run past the keep at the cut': (r) => { r.send(`${head}${' '.repeat(17_000)}`); for (const ch of `${tail}${LATER}`) r.send(ch) },
    }
    for (const [how, run] of Object.entries(runs)) {
      const r = journal()
      run(r)
      const { secrets, text } = r.row()
      assert.ok(!secrets.some((v) => LATER.includes(v) || (partial && partial.includes(v))), `${what}, ${how}: remembered ${JSON.stringify(secrets)}`)
      assert.ok(text.endsWith(LATER), `${what}, ${how}: the later text is served as written`)
      if (how.startsWith('a blank run')) continue
      assert.ok(text.endsWith(`${want}${LATER}`), `${what}, ${how}: served as the whole text`)
      if (!want.includes(SECRET)) assert.ok(!r.served().includes(SECRET), `${what}, ${how}: the value is hidden`)
    }
  }
})
