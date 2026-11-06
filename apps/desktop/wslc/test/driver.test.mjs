// The smoke's driver keeps the launcher's raw stderr and frames to report a wait that timed out;
// that report reaches the public CI log and the run's summary through the smoke's FAIL line, so
// the launch token is masked there too. The report shows only the last 2000 characters of each
// source, so the mask runs first: the cut can clip a `[redacted]` placeholder, never the value.
// The token is built at runtime, never written down.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { FakeElectron } from '../smoke/driver.mjs'

const tokenOf = seed => createHash('sha256').update(seed).digest('hex').slice(0, 32)

/** `message` carries none of `token`, not even a fragment of it. */
function assertNoToken(message, token, label) {
  assert.ok(!message.includes(token), `${label}: the token is in the report`)
  for (let at = 0; at + 8 <= token.length; at++) {
    assert.ok(!message.includes(token.slice(at, at + 8)), `${label}: the token from ${at} is in the report`)
  }
}

/** A child the driver can watch without a process: the pipes it wires, and nothing else. */
function stubChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { write: () => true, end() {} })
  return child
}

test('a timed-out wait reports its frames and stderr with the token masked', async () => {
  const token = Buffer.alloc(16, 0xef).toString('hex')
  const frame = JSON.stringify({ v: 1, type: 'ready', url: `http://127.0.0.1:41700/?token=${token}` })
  const script = [
    `process.stdout.write(${JSON.stringify(`${frame}\n`)})`,
    `process.stderr.write(${JSON.stringify(`dsh web: http://127.0.0.1:41700/?token=${token}\n`)})`,
    'setInterval(() => {}, 1000)',
  ].join('; ')
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const electron = new FakeElectron(child)
    await Promise.all([new Promise(resolve => child.stdout.once('data', resolve)), new Promise(resolve => child.stderr.once('data', resolve))])
    assert.equal(electron.frames.length, 1)
    await assert.rejects(electron.waitFor(seen => seen.type === 'lane', 50, 'the lane frame'), (error) => {
      assert.match(error.message, /^no the lane frame within 50 ms; frames: /)
      assert.match(error.message, /"url":"http:\/\/127\.0\.0\.1:41700\/\?token=\[redacted\]"/)
      assert.match(error.message, /stderr: dsh web: http:\/\/127\.0\.0\.1:41700\/\?token=\[redacted\]\n$/)
      assert.ok(!error.message.includes(token), 'the token is in the report')
      return true
    })
  } finally {
    child.kill('SIGKILL')
  }
})

test('a 2000-character cut that splits token= from its value still reports no token', async () => {
  const token = tokenOf('driver boundary stderr')
  const lead = 'a'.repeat(100)
  for (let offset = 0; offset <= 20; offset++) {
    // The raw source is long enough that its slice(-2000), the order that leaked, starts at the
    // key's first character plus `offset`: offsets 0..5 split `token=`, 6..20 split the value.
    // Alphanumeric filler fills the prefix, so the key is not at the string's start.
    const stderr = `${lead}token=${token} ${'b'.repeat(1961 + offset)}`
    assert.equal(stderr.length - 2000, lead.length + offset, 'the case lands where it says')
    const electron = new FakeElectron(stubChild())
    electron.stderr = stderr
    await assert.rejects(electron.waitFor(() => false, 5, 'the lane frame'), (error) => {
      assert.ok(error.message.startsWith('no the lane frame within 5 ms; frames: []; stderr: '), error.message)
      assert.ok(error.message.includes('token=[redacted] '), `offset ${offset}: the line shape is gone (${error.message})`)
      assert.ok(error.message.endsWith('b'), `offset ${offset}: the stderr tail is gone`)
      assertNoToken(error.message, token, `stderr offset ${offset}`)
      return true
    })
  }
})

test('a 2000-character cut that splits the digest path from its token still reports no token', async () => {
  const token = tokenOf('driver boundary frames')
  const url = `ws://127.0.0.1:9222/devtools/browser/${token}`
  for (let offset = 0; offset <= 20; offset++) {
    // Same geometry on the frames side: the raw JSON's slice(-2000) starts at `/devtools/browser/`
    // plus `offset` (0..17 split the path, 18..20 split the token's first characters).
    const json = JSON.stringify([{ v: 1, type: 'tunnel', op: 'open', id: 1, port: 9222, host: '127.0.0.1', url, tail: 'y'.repeat(1937 + offset) }])
    const keyStart = json.indexOf('/devtools/browser/')
    assert.equal(json.length - 2000, keyStart + offset, 'the case lands where it says')
    const electron = new FakeElectron(stubChild())
    electron.frames = JSON.parse(json)
    await assert.rejects(electron.waitFor(() => false, 5, 'the lane frame'), (error) => {
      assert.ok(error.message.startsWith('no the lane frame within 5 ms; frames: '), error.message)
      assert.ok(error.message.includes('/devtools/browser/[redacted]'), `offset ${offset}: the digest path is gone (${error.message})`)
      assert.ok(error.message.endsWith('; stderr: '), `offset ${offset}: the message shape is gone`)
      assertNoToken(error.message, token, `frames offset ${offset}`)
      return true
    })
  }
})
