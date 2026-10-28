// Secret key names in any case, with any prefix joined by _ or -, in the three forms a reply
// carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the value
// reaches the event window's rows or change payloads, whole or across its private 16 KiB bound,
// and the browser's copy of the redaction hides it too. Words that only contain a key name are
// not keys. The value is built from words at run time. Fields like pass_rate are not secrets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalog } from '../src/catalog.js'
import { EventWindow, redact, redactText } from '../src/window.js'
import { redact as clientRedact, redactText as clientRedactText } from '../src/client/redact.js'

const WORDS = ['correct', 'horse', 'battery', 'staple']
const PHRASE = WORDS.join(' ')
const JOINED = WORDS.join('')
const KEYS = ['password', 'PASSWD', 'pass', 'Secret', 'client_secret', 'passphrase', 'TOKEN', 'api_key', 'private_key', 'db_password', 'DB_PASS', 'x-api-key', 'secret_key', 'SECRET_KEY', 'aws_secret_access_key', 'AWS_SECRET_ACCESS_KEY']
const SCHEMES = [`authorization: bearer ${JOINED}`, `AUTHORIZATION: BEARER ${JOINED}`, `Authorization: basic ${JOINED}`, `{"authorization": "bearer ${PHRASE}"}`]
const DASHES = 'a-'.repeat(40_000) // 80k characters: a start after - or -- must not make the rule quadratic
// A bare value is one unbroken run (only its first word would be hidden), so it never takes the
// spaced value the 16 KiB row sends.
const FORMS = [
  ['KEY=value', (k, v) => `${k}="${v}"`], ['JSON', (k, v) => `{"${k}": "${v}"}`], ['key: value', (k, v) => `${k}: '${v}'`],
  ['key: `value`', (k, v) => `${k}: \`${v}\``], ['key=`value`', (k, v) => `${k}=\`${v}\``],
  ['--key=value', (k) => `tool --${k}=${JOINED}`, 'bare'], ['--key="value"', (k, v) => `tool --${k}="${v}"`],
  ['key: value, bare', (k) => `${k}: ${JOINED}`, 'bare'],
  ['key = value', (k) => `${k} = ${JOINED}`, 'bare'], ['key : "value"', (k, v) => `${k} : "${v}"`], ['{"key" : "value"}', (k, v) => `{"${k}" : "${v}"}`],
]
const CASES = KEYS.flatMap((k) => FORMS.map(([form, text, bare]) => [`${k} (${form})`, (v = PHRASE) => text(k, v), bare]))
const leaked = (text) => [...new Set(text.match(/[a-z]{3,}/gi) ?? [])].filter((t) => WORDS.some((w) => w.includes(t.toLowerCase()) || t.toLowerCase().includes(w)))
const timed = (fn) => {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

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
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast a-bypass=1 -bypass=1 --bypass=open secret_sauce: butter basic steps first bearer bonds'
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

test('80k characters of a- stay fast, in the window and the browser copy', () => {
  assert.ok(timed(() => redactText(DASHES)) < 200, 'the window rules')
  assert.ok(timed(() => clientRedactText(DASHES)) < 200, 'the browser copy')
  assert.ok(timed(() => rig().push(DASHES)) < 200, 'the window')
})

test('fields named for a pass count are kept; fields named for a pass are hidden', () => {
  for (const redactOf of [redact, clientRedact]) {
    assert.deepEqual(redactOf({ pass_rate: 0.9, pass_count: 3 }), { pass_rate: 0.9, pass_count: 3 })
    assert.deepEqual(redactOf({ pass: 'x1', db_pass: 'x2' }), { pass: '[redacted]', db_pass: '[redacted]' })
  }
})
