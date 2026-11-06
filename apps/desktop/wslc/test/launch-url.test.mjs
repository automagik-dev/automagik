// CHECK 2's comparison, exercised without the image: the ready frame and DSH's launch line are
// compared raw after both pipes close, never while stderr can still be in flight, and only the
// message masks. The token is built at runtime, never written down.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { encode } from '../lib/frame.mjs'
import { FakeElectron } from '../smoke/driver.mjs'
import { launchUrlMismatch, maskUrl, printedLaunchUrl } from '../smoke/launch-url.mjs'

const tokenOf = seed => createHash('sha256').update(seed).digest('hex').slice(0, 32)

/** `message` carries none of `token`, not even a fragment of it. */
function assertNoToken(message, token, label) {
  assert.ok(!message.includes(token), `${label}: the token is in the message`)
  for (let at = 0; at + 8 <= token.length; at++) {
    assert.ok(!message.includes(token.slice(at, at + 8)),
      `${label}: the token from ${at} is in the message`)
  }
}

test('the ready frame and DSH\'s line compare equal when stderr arrives after stdout', async () => {
  const url = `http://127.0.0.1:41700/?token=${tokenOf('out of order')}`
  // DSH's line goes to stderr only after an ipc frame comes back, so it cannot win the race: the
  // ready frame has already been read when the check would have compared, as in run 42178052200.
  const frame = encode({ v: 1, type: 'ready', url, port: 41700 })
  const script = [
    `process.stdout.write(${JSON.stringify(`${frame}\n`)})`,
    'process.stdin.resume()',
    `process.stdin.once('data', () => {`,
    `  process.stderr.write(${JSON.stringify(`dsh web: ${url}\n`)})`,
    '  process.exit(0)',
    '})',
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const electron = new FakeElectron(child)
    const ready = await electron.waitFor(frame => frame.type === 'ready', 5_000, 'ready')
    // The old comparison, run at this point, would fail: stderr is not here yet.
    assert.ok(!electron.stderr.includes(`dsh web: ${ready.url}`), 'the launch line beat the frame')
    electron.send({ type: 'ipc', message: { type: 'go' } })
    await electron.close()
    assert.equal(launchUrlMismatch(ready.url, electron.stderr), null)
  } finally {
    child.kill('SIGKILL')
  }
})

test('a genuine mismatch still fails, and its message masks both sides', () => {
  const printed = `http://127.0.0.1:41700/?token=${tokenOf('printed')}`
  const ready = `http://127.0.0.1:41700/?token=${tokenOf('ready')}`
  const message = launchUrlMismatch(ready, `[dsh] starting\ndsh web: ${printed}\n`)
  assert.equal(typeof message, 'string')
  assert.match(message,
    /^ready's url http:\/\/127\.0\.0\.1:41700\/\?token=<masked> is not the one DSH printed/)
  assert.match(message, /\(http:\/\/127\.0\.0\.1:41700\/\?token=<masked>\)$/)
  assertNoToken(message, printed.split('token=')[1], 'printed')
  assertNoToken(message, ready.split('token=')[1], 'ready')
})

test('a masked log line is not one of the two sides; the raw line is', () => {
  const url = `http://127.0.0.1:41700/?token=${tokenOf('masked side')}`
  assert.equal(maskUrl(url), 'http://127.0.0.1:41700/?token=<masked>')
  // The forwarded CI log is masked; comparing it with the ready frame's raw url is the
  // masked-vs-unmasked mismatch the flake was blamed on, so the comparison refuses that side.
  assert.equal(printedLaunchUrl(`dsh web: ${maskUrl(url)}\n`),
    'http://127.0.0.1:41700/?token=<masked>')
  assert.notEqual(launchUrlMismatch(url, `dsh web: ${maskUrl(url)}\n`), null)
  // The launcher's own stderr is raw, as is the ready frame: those two are the sides.
  assert.equal(printedLaunchUrl(`dsh web: ${url}\n`), url)
  assert.equal(launchUrlMismatch(url, `dsh web: ${url}\n`), null)
  assert.equal(launchUrlMismatch(url, 'no launch line here\n'),
    `ready's url ${maskUrl(url)} is not the one DSH printed (no launch line on stderr)`)
})
