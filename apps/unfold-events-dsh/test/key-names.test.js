// Secret key names in any case, with any prefix joined by _ or -, in the three forms a reply
// carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the value
// reaches the event window's rows or change payloads, whole or across its private 16 KiB bound,
// and the browser's copy of the redaction hides it too. Words that only contain a key name are
// not keys. The value is built from words at run time. Fields like pass_rate are not secrets, and
// camelCase words with no key part are words.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalog } from '../src/catalog.js'
import { EventWindow, redact, redactText } from '../src/window.js'
import { redact as clientRedact, redactText as clientRedactText, secretsIn as clientSecretsIn } from '../src/client/redact.js'

const WORDS = ['correct', 'horse', 'battery', 'staple']
const PHRASE = WORDS.join(' ')
const JOINED = WORDS.join('')
const KEYS = ['password', 'PASSWD', 'pass', 'Secret', 'client_secret', 'passphrase', 'TOKEN', 'api_key', 'private_key', 'db_password', 'DB_PASS', 'x-api-key', 'secret_key', 'SECRET_KEY', 'aws_secret_access_key', 'AWS_SECRET_ACCESS_KEY', 'accessToken', 'clientSecret', 'dbPassword', 'apiKey', 'privateKey', 'authToken', 'dbPass', 'userPass', 'adminPass', 'ClientSecret', 'AccessToken', 'DbPassword', 'DbPass']
const SCHEMES = [`authorization: bearer ${JOINED}`, `AUTHORIZATION: BEARER ${JOINED}`, `Authorization: basic ${JOINED}`, `{"authorization": "bearer ${PHRASE}"}`]
// 80k characters of each input that could make a rule quadratic: a start after - or --, an open
// quote, a camelCase run, a YAML block, an open escaped JSON value, a prefix run, many line starts,
// many escaped JSON values, many YAML keys, many names mid-line, bearer runs, a word of upper-case names, long indents before a YAML key or
// any key, repeated names, keys and flags, open quotes of each kind, and backslash and escaped
// quote runs.
// A scheme in any case with no key name before it, before a token-shaped word (16+ characters of the
// token alphabet with a digit), built from words at run time.
const SHAPED = WORDS.join('9')
const ALONE = [`bearer ${SHAPED}`, `BEARER ${SHAPED}`, `basic ${SHAPED}`, `the header was bEaReR ${SHAPED}, then more`]
const NOT_TOKENS = ['bearer bonds', 'basic steps', 'the bearer of bad news', 'bearer v2 of the api']
// A token after a bare scheme whose digit comes last, and the same token in two deltas.
const LATE = `use bearer ${JOINED}9 now`
const LATE_SPLIT = [`use bearer ${WORDS.slice(0, 2).join('')}`, `${WORDS.slice(2).join('')}9 now`]
const FILL = 17_000 // past the private 16 KiB bound
// An escaped JSON value still open where the keep is cut, ending inside an escape: two backslashes
// (an escape begun one level down) or three (and one begun here). The next delta must still be read
// as part of the value, so the words after the escaped quote stay hidden.
const MID_ESCAPE = [2, 3].map((run) => [`${run} backslashes`, `{\\"password\\": \\"${'x'.repeat(FILL)}${'\\'.repeat(run)}`, `${run === 2 ? '\\"' : '"'}${PHRASE}\\"} done`])
// Spaces, tabs or both before a YAML block key: 80k of them, and 16k (the window's bound).
const INDENTED = [80_000, 16_000].flatMap((n) => [' ', '\t', ' \t'].flatMap((run) => ['password', 'accessToken'].map((key) => [`${n} ${JSON.stringify(run)} before ${key}: |`, `${run.repeat(n / run.length)}${key}: |\n`])))
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
  'upper names in one word': `${'TOKEN'.repeat(16_000)} =`,
  'leading spaces, then a key': `${' '.repeat(80_000)}password: x`,
  'leading tabs, then KEY=': `${'\t'.repeat(80_000)}API_TOKEN="x`,
  'leading mixed runs, then a camelCase key': `${' \t'.repeat(40_000)}accessToken: x`,
  'repeated names': 'password '.repeat(8_900),
  'repeated camelCase keys': 'accessToken: '.repeat(6_200),
  'repeated PascalCase keys': 'ClientSecret='.repeat(6_200),
  'repeated flags': '--token='.repeat(10_000),
  'repeated KEY=': 'API_TOKEN='.repeat(8_000),
  'open single quote': `password: '${'x '.repeat(40_000)}`,
  'open backtick': `password: \`${'x '.repeat(40_000)}`,
  'quote runs': `${'"'.repeat(27_000)}${"'".repeat(27_000)}${'`'.repeat(26_000)}`,
  'backslash run': '\\'.repeat(80_000),
  'backslashes in an open value': `password: "${'\\'.repeat(80_000)}`,
  'escaped quote pairs': '\\"'.repeat(40_000),
  'escaped quote pairs in an open value': `password: "${'\\"'.repeat(40_000)}`,
  'escaped quote pairs in an escaped value': `{\\"password\\": \\"${'\\"'.repeat(40_000)}`,
  ...Object.fromEntries(INDENTED),
}
const YAML_LINES = Array.from({ length: 400 }, (_, i) => `    ${PHRASE} ${i}\n`) // more than either keep
// A bare value is one unbroken run (only its first word would be hidden), so it never takes the
// spaced value the 16 KiB row sends.
const FORMS = [
  ['KEY=value', (k, v) => `${k}="${v}"`], ['JSON', (k, v) => `{"${k}": "${v}"}`], ['key: value', (k, v) => `${k}: '${v}'`],
  ['key: `value`', (k, v) => `${k}: \`${v}\``], ['key=`value`', (k, v) => `${k}=\`${v}\``],
  ['--key=value', (k) => `tool --${k}=${JOINED}`, 'bare'], ['--key="value"', (k, v) => `tool --${k}="${v}"`],
  ['key: value, bare', (k) => `${k}: ${JOINED}`, 'bare'],
  ['escaped JSON', (k, v) => `{\\"${k}\\": \\"${v}\\"}`],
  ['YAML >', (k, v) => `\n${k}: >\n  ${v}\n  ${PHRASE}\nnext: shown`], ['YAML |', (k, v) => `\n  ${k}: |-\n    ${v}\n\n    ${PHRASE}\n  next: shown`],
  ['key = value', (k) => `${k} = ${JOINED}`, 'bare'], ['key : "value"', (k, v) => `${k} : "${v}"`], ['{"key" : "value"}', (k, v) => `{"${k}" : "${v}"}`],
]
const CASES = KEYS.flatMap((k) => FORMS.map(([form, text, bare]) => [`${k} (${form})`, (v = PHRASE) => text(k, v), bare]))
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

const catalog = loadCatalog()
let seq = 0
function rig() {
  const w = new EventWindow(catalog, { limit: 20 })
  const seen = []
  w.onChange((change, payload) => seen.push(JSON.stringify(payload)))
  const push = (text) => w.push({ v: 2, id: `g:${++seq}`, producer: 'g', seq, t_ns: seq, source: 'guest', kind: 'agent_delta', response_id: 'rK', text })
  return { push, served: () => [...seen, JSON.stringify(w.rows)].join('\n') }
}

test('every key form in one reply: no word of its value is in a row or a change', () => {
  for (const [what, text] of CASES) {
    const r = rig()
    r.push(`the config has ${text()} and goes on`)
    assert.deepEqual(leaked(r.served()), [], what)
  }
})

test('every key form whose quoted value crosses the private 16 KiB bound: no word of it is shown', () => {
  for (const [what, text] of CASES.filter(([, , bare]) => !bare)) {
    const r = rig()
    r.push('ordinary start ')
    r.push(text(`${' '.repeat(17000)}${PHRASE}`))
    r.push(' and the reply goes on')
    assert.deepEqual(leaked(r.served()), [], what)
  }
})

test('the browser copy and the window agree, and hide every key form', () => {
  for (const [what, text] of CASES) {
    assert.deepEqual(leaked(clientRedactText(text())), [], what)
    assert.equal(clientRedactText(text()), redactText(text()), what)
  }
})

test('words that only contain a key name are not keys', () => {
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast a-bypass=1 -bypass=1 --bypass=open secret_sauce: butter basic steps first bearer bonds accessLevel: admin clientName: acme passRate: 0.9 maxTokens: 512 tokenCount: 12 primaryKey: id sortKey: name keyboardLayout: us passengerCount: 4 tokenizerName: bpe compassHeading: north my firstPass at it boardingPass alone AccessLevel: admin MaxTokens: 512 PassengerCount: 4 PassRate: 0.9 my FirstPass at it the bearer of bad news'
  assert.equal(redactText(prose), prose)
  assert.equal(clientRedactText(prose), prose)
})

test('a scheme after a key name is hidden in any case, in the window and the browser copy', () => {
  for (const text of SCHEMES) {
    const r = rig()
    r.push(`the config has ${text} and goes on`)
    assert.deepEqual(leaked(r.served()), [], text)
    assert.deepEqual(leaked(clientRedactText(text)), [], text)
    if (!text.startsWith('{')) assert.match(redactText(text), /(bearer|BEARER|basic) \[redacted\]/, text)
  }
})

test('80k characters of adversarial input stay fast, in the window and the browser copy', () => {
  for (const [what, text] of Object.entries(ADVERSARIAL)) {
    assert.ok(timed(() => redactText(text)) < FAST_MS, `${what}: the window rules`)
    assert.ok(timed(() => clientRedactText(text)) < FAST_MS, `${what}: the browser copy`)
    assert.ok(timed(() => clientSecretsIn(text)) < FAST_MS, `${what}: the browser copy's values`)
    assert.ok(timed(() => rig().push(text)) < FAST_MS, `${what}: the window`)
  }
})

test('fields named for a pass count are kept; fields named for a pass are hidden', () => {
  for (const redactOf of [redact, clientRedact]) {
    assert.deepEqual(redactOf({ pass_rate: 0.9, pass_count: 3 }), { pass_rate: 0.9, pass_count: 3 })
    assert.deepEqual(redactOf({ pass: 'x1', db_pass: 'x2' }), { pass: '[redacted]', db_pass: '[redacted]' })
  }
})

test('a YAML block longer than the 16 KiB bound, streamed a line at a time: no word of it is shown', () => {
  for (const key of ['password', 'dbPassword']) {
    const r = rig()
    r.push(`config:\n  ${key}: |\n`)
    for (const line of [...YAML_LINES, ...YAML_LINES]) r.push(line)
    assert.deepEqual(leaked(r.served()), [], key)
    r.push('next: shown')
    assert.match(r.served(), /next: shown/, key)
  }
})

test('a scheme in any case with no key name hides a token-shaped word, in the window and the browser copy', () => {
  for (const text of ALONE) {
    const r = rig()
    r.push(text)
    assert.deepEqual(leaked(r.served()), [], text)
    assert.deepEqual(leaked(clientRedactText(text)), [], text)
  }
  for (const text of NOT_TOKENS) {
    assert.equal(redactText(`${text}, then more`), `${text}, then more`)
    assert.equal(clientRedactText(`${text}, then more`), `${text}, then more`)
  }
})

test('a bound inside an escaped value that ends mid-escape: the rest of the value stays hidden', () => {
  for (const [what, head, rest] of MID_ESCAPE) {
    const r = rig()
    r.push(head)
    r.push(rest)
    assert.deepEqual(leaked(r.served()), [], what)
    assert.match(r.served(), /done/, what)
  }
})

test('a token after a bare scheme, streamed a character at a time: no prefix of it is shown', () => {
  const r = rig()
  for (const ch of LATE) r.push(ch)
  assert.deepEqual(leaked(r.served()), [], LATE)
  const split = rig()
  for (const text of LATE_SPLIT) split.push(text)
  assert.deepEqual(leaked(split.served()), [], LATE_SPLIT.join(' + '))
  assert.deepEqual(leaked(clientRedactText(LATE_SPLIT[0])), [], LATE_SPLIT[0])
  for (const text of NOT_TOKENS) {
    const p = rig()
    for (const ch of `${text}, then more`) p.push(ch)
    assert.ok(p.served().includes(`${text}, then more`), text)
  }
})
