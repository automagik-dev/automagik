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

for (const [what, input, want] of TABLE.text) test(`text: ${what}`, () => assert.equal(redactText(input), want))
for (const [what, input, want] of TABLE.object) test(`object: ${what}`, () => assert.deepEqual(redact(input), want))

test('a hidden value is remembered as the value, not as an anchor, a tag or a name', () => {
  for (const [what, input] of HIDDEN) {
    if (/:[ \t]*[|>]/.test(input)) continue // a block scalar's lines are not remembered, as for its plain form
    assert.ok(secretsIn(`${input} `).some((v) => VALUE.test(v)), what)
    assert.ok(!secretsIn(`${input} `).some((v) => /^[&!]/.test(v)), what)
  }
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
