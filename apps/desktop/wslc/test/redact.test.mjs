// The smoke's stderr masking (smoke/redact.mjs): the launch token never reaches the CI log, every
// line keeps its shape, and a token split across chunks is still masked. Token fixtures are built
// at runtime, never written down.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLineMasker, maskSecrets } from '../smoke/redact.mjs'

// DSH's per-launch token is 32 hex (16 bytes); the relay's CDP token is 64 hex (32 bytes).
const launchToken = Buffer.alloc(16, 0xab).toString('hex')
const cdpToken = Buffer.alloc(32, 0xcd).toString('hex')

test('the launch line keeps its shape and loses only the token', () => {
  const line = `dsh web: http://127.0.0.1:41700/?token=${launchToken}`
  assert.equal(maskSecrets(line), 'dsh web: http://127.0.0.1:41700/?token=[redacted]')
  assert.equal(maskSecrets(`?token=${launchToken}&state=smoke`), '?token=[redacted]&state=smoke')
  assert.equal(maskSecrets(`TOKEN=${launchToken}`), 'TOKEN=[redacted]')
})

test('other text is untouched', () => {
  for (const text of ['fake-dsh: up, argv --profile omni', 'the tokenizer tokenized tokens: 3', 'a path /home/automagik/.automagik/desktop', '']) {
    assert.equal(maskSecrets(text), text)
  }
})

test('the launcher\'s other credential shapes are masked too', () => {
  assert.equal(maskSecrets(`{"token":"${launchToken}"}`), '{"token":"[redacted]"}')
  assert.equal(maskSecrets(`api_key=${launchToken}`), 'api_key=[redacted]')
  assert.equal(maskSecrets(`Authorization: Bearer ${cdpToken}`), 'Authorization: Bearer [redacted]')
  assert.equal(maskSecrets(`ws://127.0.0.1:9222/devtools/browser/${cdpToken}`), 'ws://127.0.0.1:9222/devtools/browser/[redacted]')
})

test('a multiline chunk is masked and prefixed line by line', () => {
  const text = `fake-dsh: up\n\ndsh web: http://127.0.0.1:41700/?token=${launchToken}\nfake-dsh: SIGTERM\n`
  const log = createLineMasker('  [fake dsh] ')
  assert.equal(log.push(Buffer.from(text)), '  [fake dsh] fake-dsh: up\n  [fake dsh] \n  [fake dsh] dsh web: http://127.0.0.1:41700/?token=[redacted]\n  [fake dsh] fake-dsh: SIGTERM\n')
  assert.equal(log.flush(), '')
})

test('a token split across chunks is still masked whole', () => {
  const line = `dsh web: http://127.0.0.1:41700/?token=${launchToken}\n`
  const bytes = Buffer.from(line)
  const log = createLineMasker('  [dsh] ')
  let out = ''
  // Every byte on its own: every boundary, the ones inside the token included.
  for (const byte of bytes) out += log.push(Buffer.from([byte]))
  out += log.flush()
  assert.equal(out, '  [dsh] dsh web: http://127.0.0.1:41700/?token=[redacted]\n')
})

test('the last unterminated line is flushed once, with its prefix', () => {
  const log = createLineMasker('  [dsh] ')
  const bytes = Buffer.from(`dsh web: http://127.0.0.1:41700/?token=${launchToken}`)
  for (const byte of bytes) assert.equal(log.push(Buffer.from([byte])), '')
  assert.equal(log.flush(), '  [dsh] dsh web: http://127.0.0.1:41700/?token=[redacted]\n')
  assert.equal(log.flush(), '')
})

test('a chunk boundary inside a UTF-8 character does not corrupt the line', () => {
  const log = createLineMasker('  [dsh] ')
  let out = ''
  for (const byte of Buffer.from('  ação\n')) out += log.push(Buffer.from([byte]))
  assert.equal(out + log.flush(), '  [dsh]   ação\n')
})
