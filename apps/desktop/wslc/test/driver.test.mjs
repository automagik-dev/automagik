// The smoke's driver keeps the launcher's raw stderr and frames to report a wait that timed out;
// that report reaches the public CI log and the run's summary through the smoke's FAIL line, so
// the launch token is masked there too. The token is built at runtime, never written down.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { FakeElectron } from '../smoke/driver.mjs'

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
