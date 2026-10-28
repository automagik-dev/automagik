// Secret key names in any case, with any prefix joined by _ or -, in the three forms a served
// value carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the
// value is left in a served string, at any depth. Words that only contain a key name are not keys.
// The value is built from words at run time.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redact, redactText } from '../src/redact.js'

const WORDS = ['correct', 'horse', 'battery', 'staple']
const PHRASE = WORDS.join(' ')
const KEYS = ['password', 'PASSWD', 'pass', 'Secret', 'client_secret', 'passphrase', 'TOKEN', 'api_key', 'private_key', 'db_password', 'DB_PASS', 'x-api-key']
const FORMS = [['KEY=value', (k) => `${k}="${PHRASE}"`], ['JSON', (k) => `{"${k}": "${PHRASE}"}`], ['key: value', (k) => `${k}: '${PHRASE}'`]]
const CASES = KEYS.flatMap((k) => FORMS.map(([form, text]) => [`${k} (${form})`, text(k)]))
const leaked = (text) => [...new Set(text.match(/[a-z]{3,}/gi) ?? [])].filter((t) => WORDS.some((w) => w.includes(t.toLowerCase())))

test('every key form in a served string, at any depth: no word of its value is left', () => {
  for (const [what, text] of CASES) {
    assert.deepEqual(leaked(redactText(`the config has ${text} and goes on`)), [], what)
    assert.deepEqual(leaked(JSON.stringify(redact({ host: { note: text }, list: [text] }))), [], what)
  }
})

test('a field named for a secret is hidden whatever its value', () => {
  for (const key of ['passphrase', 'db_pass', 'pass']) assert.deepEqual(leaked(JSON.stringify(redact({ [key]: PHRASE }))), [], key)
  assert.deepEqual(redact({ compass: 'north', bypass: 'open' }), { compass: 'north', bypass: 'open' })
})

test('words that only contain a key name are not keys', () => {
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast'
  assert.equal(redactText(prose), prose)
})
