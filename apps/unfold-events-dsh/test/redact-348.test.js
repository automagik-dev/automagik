// The #348 table, test/fixtures/redact-348.json: the same file, byte for byte, in unfold-mind-dsh
// and unfold-settings-dsh (scripts/unfold-copies.test.ts), so the copies of the redaction cannot
// diverge on it. Invisible characters inside a credential name (NUL, zero-width, BOM, bidi marks,
// raw or as a JSON \u escape) and YAML anchors and tags before its value. A text row serves the
// shape of its plain form; an object row hides the value under a key read without its invisible
// characters and keeps the key as written; a near miss keeps its value. The window and the
// browser's copy both meet every row.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadCatalog } from '../src/catalog.js'
import { EventWindow, redact, redactEnvelope, redactText } from '../src/window.js'
import { redact as clientRedact, redactText as clientRedactText, secretsIn as clientSecretsIn } from '../src/client/redact.js'

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

for (const [what, input, want] of TABLE.text) {
  test(`text: ${what}`, () => {
    assert.equal(redactText(input), want, 'window')
    assert.equal(clientRedactText(input), want, 'browser copy')
  })
}
for (const [what, input, want] of TABLE.object) {
  test(`object: ${what}`, () => {
    assert.deepEqual(redact(input), want, 'window')
    assert.deepEqual(clientRedact(input), want, 'browser copy')
  })
}

test('an envelope field under an invisible name is hidden, its key kept as written', () => {
  const env = { v: 2, id: 'g:1', producer: 'g', seq: 1, t_ns: 1, source: 'guest', kind: 'tool_call', 'pass\u0000word': 'hunter2', args: { 'api​key': 'hunter2', note: 'password: &a hunter2' } }
  const out = redactEnvelope(env)
  assert.doesNotMatch(JSON.stringify(out), VALUE)
  assert.deepEqual(Object.keys(out.args), ['api​key', 'note'])
})

test('the browser copy remembers the value, not an anchor, a tag or a name', () => {
  for (const [what, input] of HIDDEN) {
    assert.ok(!clientSecretsIn(`${input} `).some((v) => /^[&!|>]/.test(v)), what)
    if (BLOCK.test(input)) continue // a block scalar's lines are not remembered, as for its plain form
    assert.ok(clientSecretsIn(`${input} `).some((v) => VALUE.test(v)), what)
  }
})

test('an invalid YAML row is remembered as nothing', () => {
  for (const [what, input] of INVALID) assert.deepEqual(clientSecretsIn(`${input} `), [], what)
})

const catalog = loadCatalog()
let seq = 0
function rig() {
  const w = new EventWindow(catalog, { limit: 20 })
  const seen = []
  w.onChange((change, payload) => seen.push(JSON.stringify(payload)))
  const push = (text) => w.push({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text })
  return { push, served: () => [...seen, JSON.stringify(w.rows)].join('\n') }
}

test('served: every row the table hides stays hidden in the window, whole and a character at a time', () => {
  for (const [what, input] of HIDDEN) {
    const whole = rig()
    whole.push(`the config has ${input}\nand goes on`)
    assert.doesNotMatch(whole.served(), VALUE, what)
    const split = rig()
    for (const ch of `the config has ${input}\nand goes on`) split.push(ch)
    assert.doesNotMatch(split.served(), VALUE, `${what}, a character at a time`)
  }
})

test('served: a value under an invisible name or an anchor that crosses the 16 KiB bound stays hidden', () => {
  for (const head of ['pass​word: ', 'pass\u0000word: ', 'password: &a ', 'password: !!str ', 'password: &a !!str ']) {
    const quoted = rig()
    quoted.push(`${head}"${'hunter2 '.repeat(2_200)}`)
    quoted.push(`${'hunter2 '.repeat(200)}" and goes on`)
    assert.doesNotMatch(quoted.served(), VALUE, `${JSON.stringify(head)}, quoted`)
  }
})

// A blank run past the bound between an anchor or tag and its value: the cut lands in the run, so
// the next token is the value. An anchor or tag before a cut is a value's context, like a bare
// `password:`, so the value is never kept, and shown, as the start of the text.
test('served: the 16 KiB bound cut between an anchor or tag and its value keeps no orphaned value', () => {
  for (const head of ['password: &a', 'password: !!str', 'password: &a !!str', 'password: !!str &a']) {
    const r = rig()
    r.push(`${head}${' '.repeat(17_000)}hunter2`)
    r.push(' and goes on')
    assert.doesNotMatch(r.served(), VALUE, JSON.stringify(head))
  }
})

// A block scalar under an anchor or tag before its indicator, longer than the bound, streamed a line
// at a time: no line of it is served, and the text after it is.
const BLOCK_HEADS = ['password: &a |', 'password: !!str >-', 'password: !<tag:yaml.org,2002:str> |', 'dbPassword: &a !!str |+']
const BLOCK_LINES = Array.from({ length: 700 }, (_, i) => `    hunter2 line ${i}\n`)
test('served: a block scalar under an anchor or tag longer than the 16 KiB bound, a line at a time, stays hidden', () => {
  for (const head of BLOCK_HEADS) {
    const r = rig()
    r.push(`config:\n  ${head}\n`)
    for (const line of BLOCK_LINES) r.push(line)
    assert.doesNotMatch(r.served(), VALUE, head)
    r.push('next: shown')
    assert.match(r.served(), /next: shown/, head)
  }
})

test('the browser copy never remembers the next line\'s key under an anchor or tag with no value', () => {
  for (const [what, input] of NEXT_LINE) assert.deepEqual(clientSecretsIn(`${input} `).filter((v) => /username|bob|^[&!]/.test(v)), [], what)
})

// A key line, then a blank run longer than the 16 KiB bound before its indicator: the cut lands in
// the run, and the key line is kept, so the block's lines that arrive next are hidden under it.
test('served: a blank run past the 16 KiB bound between a key line and its block indicator keeps the block hidden', () => {
  for (const [what, head, indicator] of TABLE.blank_run) {
    const r = rig()
    r.push(`config:\n  ${head}${' '.repeat(17_000)}`)
    r.push(`${indicator}\n`)
    for (const line of BLOCK_LINES.slice(0, 5)) r.push(line)
    assert.doesNotMatch(r.served(), VALUE, what)
    r.push('next: shown')
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

for (const [what, input, want] of CONTINUED) {
  test(`continuation: ${what}`, () => {
    assert.equal(redactText(input), want, 'window')
    assert.equal(clientRedactText(input), want, 'browser copy')
  })
}

// A value on a later line is remembered once its line has ended (#406): a blank after it is not
// enough, as a key may hold one and a cut pads with them, so each row ends at a line break here.
test('continuation: the browser copy remembers a hidden value, and no anchor, tag, indicator or kept value', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const kept = clientSecretsIn(`${input}\n`)
    assert.ok(!kept.some((v) => /^[&!|>]/.test(v)), what)
    if (!LATER_BLOCK.test(input)) assert.ok(kept.some((v) => v.includes(SECRET)), what)
  }
  for (const [what, input] of KEPT) assert.ok(!clientSecretsIn(`${input}\n`).some((v) => v.includes(SECRET)), what)
})

test('served: a value on a later line stays hidden in the window, whole and a character at a time; a kept one is served', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    const whole = rig()
    whole.push(`${input}\nand goes on`)
    assert.ok(!whole.served().includes(SECRET), what)
    const split = rig()
    for (const ch of `${input}\nand goes on`) split.push(ch)
    assert.ok(!split.served().includes(SECRET), `${what}, a character at a time`)
  }
  for (const [what, input] of KEPT) {
    const whole = rig()
    whole.push(`${input}\nand goes on`)
    assert.ok(whole.served().includes(SECRET), what)
    const split = rig()
    for (const ch of `${input}\nand goes on`) split.push(ch)
    assert.ok(split.served().includes(SECRET), `${what}, a character at a time`)
  }
})

// A blank run past the 16 KiB bound at each place a cut can land before the value (the end of the
// key line, of each blank, comment, anchor, tag or indicator line under it, and right before the
// value): the key line and the lines under it that hold anchors, tags or an indicator are kept, and
// the value that arrives next, a character at a time, is hidden. Inside a quoted value the cut
// withholds the rest of the value up to its closing quote, its key dropped with it, as for a quoted
// value on its key's line.
test('served: the 16 KiB bound cut after a key line, in the lines under it or before its value keeps the key and hides the value', () => {
  for (const [what, input] of CONTINUED_HIDDEN) {
    for (const at of cutsOf(input)) {
      const w = new EventWindow(catalog, { limit: 20 })
      const seen = []
      w.onChange((change, payload) => seen.push(JSON.stringify(payload)))
      const push = (text) => w.push({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text })
      push(`${input.slice(0, at)}${' '.repeat(17_000)}`)
      for (const ch of `${input.slice(at)}\nand goes on`) push(ch)
      assert.ok(![...seen, JSON.stringify(w.rows)].join('\n').includes(SECRET), `${what}, cut at ${at}`)
      if (input[at - 1] !== '"') assert.ok(w.rows.at(-1).text.includes(nameOf(input)), `${what}, cut at ${at}: the key is still served`)
    }
  }
})

// #406, the table's `partial_key` rows: in the window, a line more indented than a key line with no
// colon on it yet (a child key still arriving; `{cut}` marks where the first part stops) is never read
// as the key's value once the rest arrives: later text that names a credential is served as written
// and the row is served as its whole text is. Each row is pushed whole, a character at a time, in two
// parts split at the cut, and past the 16 KiB bound (filler before it, so the bound's cut lands in the
// filler, then the rest a character at a time); no payload serves the hidden value. The browser copy
// remembers nothing from the partial line, alone or padded with blanks as a cut pads it.
const LATER = fill('\nlater the {name}, {parent} and user words stay')
const PARTIAL = TABLE.partial_key.map(([what, input, want]) => [what, fill(input).split('{cut}'), fill(want)])
const FILLER = 'filler words here\n'.repeat(Math.ceil((16 * 1024) / 18))

for (const [what, [head, tail], want] of PARTIAL) {
  test(`partial key: ${what}`, () => {
    assert.equal(redactText(`${head}${tail}`), want, 'window')
    assert.equal(clientRedactText(`${head}${tail}`), want, 'browser copy')
  })
}

test('served: a child key still arriving under a key line is never read as its value, whole, in parts and past the 16 KiB bound', () => {
  for (const [what, [head, tail], want] of PARTIAL) {
    const partial = head.slice(head.search(/[^\r\n]*$/)).trim()
    for (const pending of [head, `${head} `, `${head}${' '.repeat(17_000)}`]) {
      assert.ok(!clientSecretsIn(pending).some((v) => LATER.includes(v) || (partial && partial.includes(v))), `${what}: the browser copy remembers nothing from the partial line`)
    }
    const whole = `${head}${tail}${LATER}`
    const runs = {
      whole: (push) => push(whole),
      'a character at a time': (push) => { for (const ch of whole) push(ch) },
      'in two parts at the cut': (push) => { push(head); push(`${tail}${LATER}`) },
      'past the 16 KiB bound': (push) => { push(`${FILLER}${head}`); for (const ch of `${tail}${LATER}`) push(ch) },
    }
    for (const [how, run] of Object.entries(runs)) {
      const w = new EventWindow(catalog, { limit: 20 })
      const seen = []
      w.onChange((change, payload) => seen.push(JSON.stringify(payload)))
      run((text) => w.push({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text }))
      const text = w.rows.at(-1).text
      assert.ok(text.endsWith(`${want}${LATER}`), `${what}, ${how}: served as the whole text`)
      if (!want.includes(SECRET)) assert.ok(![...seen, JSON.stringify(w.rows)].join('\n').includes(SECRET), `${what}, ${how}: no payload serves the value`)
    }
  }
})
