// Secret key names in any case, with any prefix joined by _ or -, in the three forms a served
// value carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the
// value is left in a served string, at any depth. Words that only contain a key name are not keys.
// The value is built from words at run time. Fields like pass_rate are not secrets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redact, redactText } from '../src/redact.js'

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

test('every key form in a served string, at any depth: no word of its value is left', () => {
  for (const [what, text] of CASES) {
    assert.deepEqual(leaked(redactText(`the config has ${text} and goes on`)), [], what)
    assert.deepEqual(leaked(JSON.stringify(redact({ host: { note: text }, list: [text] }))), [], what)
  }
})

test('a field named for a secret is hidden whatever its value', () => {
  for (const key of ['passphrase', 'db_pass', 'pass']) assert.deepEqual(leaked(JSON.stringify(redact({ [key]: PHRASE }))), [], key)
  assert.deepEqual(redact({ compass: 'north', bypass: 'open', pass_rate: 0.9, pass_count: 3 }), { compass: 'north', bypass: 'open', pass_rate: 0.9, pass_count: 3 })
})

test('words that only contain a key name are not keys', () => {
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast a-bypass=1 -bypass=1 --bypass=open secret_sauce: butter basic steps first bearer bonds'
  assert.equal(redactText(prose), prose)
})

test('a scheme after a key name is hidden in any case, and the scheme word stays', () => {
  for (const text of SCHEMES) {
    assert.deepEqual(leaked(redactText(text)), [], text)
    if (!text.startsWith('{')) assert.match(redactText(text), /(bearer|BEARER|basic) \[redacted\]/, text)
  }
})

test('80k characters of a- stay fast', () => {
  assert.ok(timed(() => redactText(DASHES)) < 200)
})
