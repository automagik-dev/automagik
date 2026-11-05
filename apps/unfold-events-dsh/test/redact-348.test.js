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
// A block scalar's key line: a name, its colon, up to two anchors or tags, then an indicator.
const BLOCK = /:[ \t]*(?:[&!][^\s"'`]*[ \t]+){0,2}[|>][-+0-9]*[ \t]*$/m

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
