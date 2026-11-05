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
  return { send, served }
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

// #396, the table's `continuation` rows: a credential name with no value on its line continues to
// the next line when that line is strictly more indented. Anchors and tags may end the key line,
// start the value line, or stand on lines of their own between them; the first more indented line
// with a value is the scalar, hidden and remembered, and the key line and the properties stay
// where they were written. A value at the same or a lower indent, a sibling key and indented prose
// under a plain name are not hidden. The rows hold placeholders, filled here from pieces, so no
// credential-shaped text is committed.
const FILL = { '{name}': ['pass', 'word'].join(''), '{camel}': ['api', 'Key'].join(''), '{value}': ['hunter', 2].join('') }
const fill = (s) => s.replace(/\{(?:name|camel|value)\}/g, (k) => FILL[k])
const SECRET = FILL['{value}']
const CONTINUED = TABLE.continuation.map(([what, input, want]) => [what, fill(input), fill(want)])
const CONTINUED_HIDDEN = CONTINUED.filter(([, input, want]) => input.includes(SECRET) && !want.includes(SECRET))
const GUARDS = CONTINUED.filter(([what]) => what.startsWith('guard:'))
// The name the row's key line holds, served again after a cut.
const nameOf = (input) => (input.includes(FILL['{camel}']) ? FILL['{camel}'] : FILL['{name}'])

for (const [what, input, want] of CONTINUED) test(`continuation: ${what}`, () => assert.equal(redactText(input), want))

test('continuation: a hidden value is remembered, and no anchor, tag or guard value is', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const kept = secretsIn(`${input} `)
    assert.ok(kept.some((v) => v.includes(SECRET)), what)
    assert.ok(!kept.some((v) => /^[&!|>]/.test(v)), what)
  }
  for (const [what, input] of GUARDS) assert.ok(!secretsIn(`${input} `).some((v) => v.includes(SECRET)), what)
})

test('served: a continued value stays hidden in the stream, whole and a character at a time', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const whole = journal()
    whole.send(`${input}\nand goes on`)
    assert.ok(!whole.served().includes(SECRET), what)
    const split = journal()
    for (const ch of `${input}\nand goes on`) split.send(ch)
    assert.ok(!split.served().includes(SECRET), `${what}, a character at a time`)
  }
})

// A blank run past the 4096 keep right before the value (inside its quotes for a quoted one): the
// cut lands between the key and its value, so the key line and its properties are kept and the
// value that arrives next is hidden.
test('served: a cut between a continued key and its value keeps the key and hides the value', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const at = input.indexOf(SECRET)
    const mind = new MindStream({ now: () => 1 })
    mind.life = 'lifeZ'
    let seq = 0
    const send = (text) => mind.agentd({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text }, { via: 'agentd journal', file: '/j', offset: seq })
    mind.agentd({ v: 2, id: 'g:0', producer: 'g', seq: 0, t_ns: 0, source: 'guest', kind: 'response_started', response_id: 'rK' }, { via: 'agentd journal', file: '/j', offset: 0 })
    send(`${input.slice(0, at)}${' '.repeat(17_000)}`)
    for (const ch of `${input.slice(at)}\nand goes on`) send(ch)
    const served = [JSON.stringify(mind.snapshot()), ...mind.rows.map((x) => JSON.stringify(mind.detail(x.id, loadDefinitions())))].join('\n')
    assert.ok(!served.includes(SECRET), what)
    assert.ok(mind.rows.at(-1).text.includes(nameOf(input)), `${what}: the key is still served`)
  }
})
