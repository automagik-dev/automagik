// Secret key names in any case, with any prefix joined by _ or -, in the three forms a reply
// carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the value
// reaches a Mind row, snapshot, audit record or change payload, inside the 4096-char keep or with
// the cut sweeping through it. Words that only contain a key name are not keys. The value is
// built from words at run time. Fields like pass_rate are not secrets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadDefinitions } from '../src/definitions.js'
import { MindStream } from '../src/mind.js'
import { redact, redactText, secretsIn } from '../src/redact.js'

const WORDS = ['correct', 'horse', 'battery', 'staple']
const PHRASE = WORDS.join(' ')
const JOINED = WORDS.join('')
const KEYS = ['password', 'PASSWD', 'pass', 'Secret', 'client_secret', 'passphrase', 'TOKEN', 'api_key', 'private_key', 'db_password', 'DB_PASS', 'x-api-key', 'secret_key', 'SECRET_KEY', 'aws_secret_access_key', 'AWS_SECRET_ACCESS_KEY']
const SCHEMES = [`authorization: bearer ${JOINED}`, `AUTHORIZATION: BEARER ${JOINED}`, `Authorization: basic ${JOINED}`, `{"authorization": "bearer ${PHRASE}"}`]
const DASHES = 'a-'.repeat(40_000) // 80k characters: a start after - or -- must not make the rule quadratic
const FORMS = [
  ['KEY=value', (k) => `${k}="${PHRASE}"`], ['JSON', (k) => `{"${k}": "${PHRASE}"}`], ['key: value', (k) => `${k}: '${PHRASE}'`],
  ['key: `value`', (k) => `${k}: \`${PHRASE}\``], ['key=`value`', (k) => `${k}=\`${PHRASE}\``],
  ['--key=value', (k) => `tool --${k}=${JOINED}`], ['--key="value"', (k) => `tool --${k}="${PHRASE}"`],
  ['key: value, bare', (k) => `${k}: ${JOINED}`],
  ['key = value', (k) => `${k} = ${JOINED}`], ['key : "value"', (k) => `${k} : "${PHRASE}"`], ['{"key" : "value"}', (k) => `{"${k}" : "${PHRASE}"}`],
]
const CASES = KEYS.flatMap((k) => FORMS.map(([form, text]) => [`${k} (${form})`, text(k)]))
const leaked = (text) => [...new Set(text.match(/[a-z]{3,}/gi) ?? [])].filter((t) => WORDS.some((w) => w.includes(t.toLowerCase()) || t.toLowerCase().includes(w)))
const timed = (fn) => {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

function journal() {
  const mind = new MindStream({ now: () => 1 })
  mind.life = 'lifeZ'
  const seen = []
  mind.onChange((change, payload) => seen.push(JSON.stringify(payload)))
  let seq = 0
  const send = (text) => mind.agentd({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text }, { via: 'agentd journal', file: '/j', offset: seq })
  mind.agentd({ v: 2, id: 'g:0', producer: 'g', seq: 0, t_ns: 0, source: 'guest', kind: 'response_started', response_id: 'rK' }, { via: 'agentd journal', file: '/j', offset: 0 })
  const served = () => {
    const defs = loadDefinitions()
    return [JSON.stringify(mind.snapshot()), ...mind.rows.map((x) => JSON.stringify(mind.detail(x.id, defs))), ...seen].join('\n')
  }
  return { send, served }
}

test('every key form inside the keep: no word of its value is served', () => {
  for (const [what, text] of CASES) {
    const r = journal()
    r.send(`the config has ${text} and goes on`)
    assert.deepEqual(leaked(r.served()), [], what)
  }
})

test('every key form the 4096 cut sweeps through: no word of its value is served', () => {
  for (const [what, text] of CASES) {
    for (const lead of [0, 2]) {
      const r = journal()
      r.send(`${text} `)
      r.send('w'.repeat(4096 - text.length - 8 + lead))
      for (let i = 0; i < text.length + 16; i++) r.send('z')
      assert.deepEqual(leaked(r.served()), [], `${what}, lead ${lead}`)
    }
  }
})

test('words that only contain a key name are not keys', () => {
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast a-bypass=1 -bypass=1 --bypass=open secret_sauce: butter basic steps first bearer bonds'
  assert.equal(redactText(prose), prose)
})

test('a scheme after a key name is hidden in any case, and the scheme word stays', () => {
  for (const text of SCHEMES) {
    const r = journal()
    r.send(`the config has ${text} and goes on`)
    assert.deepEqual(leaked(r.served()), [], text)
    if (!text.startsWith('{')) assert.match(redactText(text), /(bearer|BEARER|basic) \[redacted\]/, text)
  }
})

test('80k characters of a- stay fast, in the rules and in the stream', () => {
  assert.ok(timed(() => redactText(DASHES)) < 200, 'redactText')
  assert.ok(timed(() => secretsIn(DASHES)) < 200, 'secretsIn')
  assert.ok(timed(() => journal().send(DASHES)) < 200, 'the stream')
})

test('fields named for a pass count are kept; fields named for a pass are hidden', () => {
  assert.deepEqual(redact({ pass_rate: 0.9, pass_count: 3 }), { pass_rate: 0.9, pass_count: 3 })
  assert.deepEqual(redact({ pass: 'x1', db_pass: 'x2' }), { pass: '[redacted]', db_pass: '[redacted]' })
})
