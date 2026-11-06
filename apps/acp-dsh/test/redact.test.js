// Redaction before text crosses a provider boundary: the Bot team's saved secrets first, then
// the credential shapes its diagnostics already mask (RFC 0003, amendment, "Live switching").
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialShapes, redactorFor } from '../src/host/redact.js'

test('credential shapes are masked: provider keys, bearer tokens, tokens in addresses', () => {
  const text = [
    'key sk-abcdef123456 and ghp_abcdefghijklmnopqrst',
    'github_pat_abcdefghijklmnopqrstu',
    'AKIAABCDEFGHIJKLMNOP',
    'xoxb-12345678-abcd',
    'AIzaabcdefghijklmnopqrstu',
    'jwt eyJhbGciOiJIUz.eyJzdWIiOiJ.abcdefgh',
    'Authorization: Bearer abcdefgh',
    'https://x.test/cb?access_token=secretvalue',
    '{"api_key": "abcdef123"}',
  ].join('\n')
  const out = credentialShapes(text)
  assert.doesNotMatch(out, /sk-abcdef123456|ghp_abcdefghijklmnopqrst|github_pat_abcdefghijklmnopqrstu|AKIAABCDEFGHIJKLMNOP|xoxb-12345678-abcd|AIzaabcdefghijklmnopqrstu|eyJhbGciOi|Bearer abcdefgh|access_token=secretvalue|abcdef123/)
  assert.match(out, /sk-\[hidden\]/)
  assert.match(out, /Authorization: [^\n]*hidden/)
  assert.match(out, /access_token=\[hidden\]/)
})

test('non-strings pass through: the filter never changes a block it was not given', () => {
  assert.equal(credentialShapes(undefined), undefined)
  assert.equal(credentialShapes(42), 42)
  assert.deepEqual(credentialShapes([1]), [1])
})

test('the Bot team store is used when composed; without it only the shapes apply', () => {
  const team = { redactSecrets: text => text.replaceAll('hunter2', '[secret:TOKEN]') }
  const withTeam = redactorFor({ get: name => (name === 'omniTeam' ? team : undefined) })
  assert.equal(withTeam('hunter2 and ghp_abcdefghijklmnopqrst'), '[secret:TOKEN] and [hidden]')
  const withoutTeam = redactorFor({ get: () => undefined })
  assert.equal(withoutTeam('hunter2 and ghp_abcdefghijklmnopqrst'), 'hunter2 and [hidden]')
  const noCtx = redactorFor(undefined)
  assert.equal(noCtx('sk-abcdef123456'), 'sk-[hidden]')
})

test('a store that throws does not block the turn: the shapes still land', () => {
  const team = { redactSecrets: () => { throw new Error('store failed') } }
  const redact = redactorFor({ get: name => (name === 'omniTeam' ? team : undefined) })
  assert.equal(redact('ghp_abcdefghijklmnopqrst'), '[hidden]')
})

test('a store read that throws is skipped as if it were absent', () => {
  const redact = redactorFor({ get: () => { throw new Error('no service') } })
  assert.equal(redact('sk-abcdef123456'), 'sk-[hidden]')
})
