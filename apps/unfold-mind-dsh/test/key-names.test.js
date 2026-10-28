// Secret key names in any case, with any prefix joined by _ or -, in the three forms a reply
// carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the value
// reaches a Mind row, snapshot, audit record or change payload, inside the 4096-char keep or with
// the cut sweeping through it. Words that only contain a key name are not keys. The value is
// built from words at run time. Fields like pass_rate are not secrets, and camelCase words with
// no key part are words.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadDefinitions } from '../src/definitions.js'
import { MindStream } from '../src/mind.js'
import { redact, redactText, secretsIn } from '../src/redact.js'

const WORDS = ['correct', 'horse', 'battery', 'staple']
const PHRASE = WORDS.join(' ')
const JOINED = WORDS.join('')
const KEYS = ['password', 'PASSWD', 'pass', 'Secret', 'client_secret', 'passphrase', 'TOKEN', 'api_key', 'private_key', 'db_password', 'DB_PASS', 'x-api-key', 'secret_key', 'SECRET_KEY', 'aws_secret_access_key', 'AWS_SECRET_ACCESS_KEY', 'accessToken', 'clientSecret', 'dbPassword', 'apiKey', 'privateKey', 'authToken', 'dbPass']
const SCHEMES = [`authorization: bearer ${JOINED}`, `AUTHORIZATION: BEARER ${JOINED}`, `Authorization: basic ${JOINED}`, `{"authorization": "bearer ${PHRASE}"}`]
// 80k characters of each input that could make a rule quadratic: a start after - or --, an open
// quote, a camelCase run, a YAML block, an open escaped JSON value, a prefix run, many line starts,
// many escaped JSON values, many YAML keys, many names mid-line and bearer runs.
// A scheme in any case with no key name before it, before a token-shaped word (16+ characters of the
// token alphabet with a digit), built from words at run time.
const SHAPED = WORDS.join('9')
const ALONE = [`bearer ${SHAPED}`, `BEARER ${SHAPED}`, `basic ${SHAPED}`, `the header was bEaReR ${SHAPED}, then more`]
const NOT_TOKENS = ['bearer bonds', 'basic steps', 'the bearer of bad news', 'bearer v2 of the api']
const ADVERSARIAL = {
  'a- repeat': 'a-'.repeat(40_000),
  'open quote': `password: "${'x '.repeat(40_000)}`,
  'camelCase run': `a${'Bc'.repeat(40_000)}Token: x`,
  'camelCase words': 'aBc '.repeat(20_000),
  'YAML block': `password: |\n${'  a line of the block\n'.repeat(3_700)}`,
  'escaped JSON': `{\\"password\\": \\"${'\\\\'.repeat(40_000)}`,
  'prefix run': `${'a_'.repeat(40_000)}token: x`,
  'line starts': '\n '.repeat(40_000),
  'escaped JSON run': '\\"token\\": \\"x\\" '.repeat(5_000),
  'YAML keys': '\npassword: |'.repeat(6_700),
  'names mid-line': 'a password: '.repeat(6_700),
  'camelCase names mid-line': 'x dbPassword: '.repeat(5_700),
  'bearer runs': 'bearer x '.repeat(9_000),
  'bearer long run': `bearer ${'a'.repeat(80_000)}`,
}
const YAML_LINES = Array.from({ length: 400 }, (_, i) => `    ${PHRASE} ${i}\n`) // more than either keep
const FORMS = [
  ['KEY=value', (k) => `${k}="${PHRASE}"`], ['JSON', (k) => `{"${k}": "${PHRASE}"}`], ['key: value', (k) => `${k}: '${PHRASE}'`],
  ['key: `value`', (k) => `${k}: \`${PHRASE}\``], ['key=`value`', (k) => `${k}=\`${PHRASE}\``],
  ['--key=value', (k) => `tool --${k}=${JOINED}`], ['--key="value"', (k) => `tool --${k}="${PHRASE}"`],
  ['key: value, bare', (k) => `${k}: ${JOINED}`],
  ['escaped JSON', (k) => `{\\"${k}\\": \\"${PHRASE}\\"}`],
  ['YAML >', (k) => `\n${k}: >\n  ${PHRASE}\n  ${PHRASE}\nnext: shown`], ['YAML |', (k) => `\n  ${k}: |-\n    ${PHRASE}\n\n    ${PHRASE}\n  next: shown`],
  ['key = value', (k) => `${k} = ${JOINED}`], ['key : "value"', (k) => `${k} : "${PHRASE}"`], ['{"key" : "value"}', (k) => `{"${k}" : "${PHRASE}"}`],
]
const CASES = KEYS.flatMap((k) => FORMS.map(([form, text]) => [`${k} (${form})`, text(k)]))
const leaked = (text) => [...new Set(text.match(/[a-z]{3,}/gi) ?? [])].filter((t) => WORDS.some((w) => w.includes(t.toLowerCase()) || t.toLowerCase().includes(w)))
// The best of three runs: noise only slows a run, and a quadratic rule is slow every time.
const timed = (fn) => {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    fn()
    best = Math.min(best, performance.now() - t0)
  }
  return best
}
const FAST_MS = 50

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
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast a-bypass=1 -bypass=1 --bypass=open secret_sauce: butter basic steps first bearer bonds accessLevel: admin clientName: acme passRate: 0.9 maxTokens: 512 tokenCount: 12 primaryKey: id sortKey: name keyboardLayout: us passengerCount: 4 tokenizerName: bpe compassHeading: north the bearer of bad news'
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

test('80k characters of adversarial input stay fast, in the rules and in the stream', () => {
  for (const [what, text] of Object.entries(ADVERSARIAL)) {
    assert.ok(timed(() => redactText(text)) < FAST_MS, `${what}: redactText`)
    assert.ok(timed(() => secretsIn(text)) < FAST_MS, `${what}: secretsIn`)
    assert.ok(timed(() => journal().send(text)) < FAST_MS, `${what}: the stream`)
  }
})

test('fields named for a pass count are kept; fields named for a pass are hidden', () => {
  assert.deepEqual(redact({ pass_rate: 0.9, pass_count: 3 }), { pass_rate: 0.9, pass_count: 3 })
  assert.deepEqual(redact({ pass: 'x1', db_pass: 'x2' }), { pass: '[redacted]', db_pass: '[redacted]' })
})

test('a YAML block longer than the keep, streamed a line at a time: no word of it is served', () => {
  for (const key of ['password', 'dbPassword']) {
    const r = journal()
    r.send(`config:\n  ${key}: |\n`)
    for (const line of YAML_LINES) r.send(line)
    assert.deepEqual(leaked(r.served()), [], key)
    r.send('next: shown')
    assert.match(r.served(), /next: shown/, key)
  }
})

test('a scheme in any case with no key name hides a token-shaped word, in the keep and across the cut', () => {
  for (const text of ALONE) {
    const r = journal()
    r.send(text)
    assert.deepEqual(leaked(r.served()), [], text)
    for (const lead of [0, 2]) {
      const c = journal()
      c.send(`${text} `)
      c.send('w'.repeat(4096 - text.length - 8 + lead))
      for (let i = 0; i < text.length + 16; i++) c.send('z')
      assert.deepEqual(leaked(c.served()), [], `${text}, lead ${lead}`)
    }
  }
  for (const text of NOT_TOKENS) assert.equal(redactText(text), text)
})
