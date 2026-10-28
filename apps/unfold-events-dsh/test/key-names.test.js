// Secret key names in any case, with any prefix joined by _ or -, in the three forms a reply
// carries them (KEY=value, JSON, key: value), the value quoted with spaces: no word of the value
// reaches the event window's rows or change payloads, whole or across its private 16 KiB bound,
// and the browser's copy of the redaction hides it too. Words that only contain a key name are
// not keys. The value is built from words at run time.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalog } from '../src/catalog.js'
import { EventWindow, redactText } from '../src/window.js'
import { redactText as clientRedactText } from '../src/client/redact.js'

const WORDS = ['correct', 'horse', 'battery', 'staple']
const PHRASE = WORDS.join(' ')
const KEYS = ['password', 'PASSWD', 'pass', 'Secret', 'client_secret', 'passphrase', 'TOKEN', 'api_key', 'private_key', 'db_password', 'DB_PASS', 'x-api-key']
const FORMS = [['KEY=value', (k, v) => `${k}="${v}"`], ['JSON', (k, v) => `{"${k}": "${v}"}`], ['key: value', (k, v) => `${k}: '${v}'`]]
const CASES = KEYS.flatMap((k) => FORMS.map(([form, text]) => [`${k} (${form})`, (v = PHRASE) => text(k, v)]))
const leaked = (text) => [...new Set(text.match(/[a-z]{3,}/gi) ?? [])].filter((t) => WORDS.some((w) => w.includes(t.toLowerCase())))

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
  for (const [what, text] of CASES) {
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
  const prose = 'bypass=open compass: north passenger: aboard tokenizer: fast'
  assert.equal(redactText(prose), prose)
  assert.equal(clientRedactText(prose), prose)
})
