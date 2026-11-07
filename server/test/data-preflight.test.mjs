// The /data preflight: an unwritable data directory must fail before dsh starts with one
// stderr line naming the directory, uid 1000 and the initial.uid/initial.gid fix, and no
// stack trace. This drives the real `ensureDataDirs` helper the entrypoint calls, in this
// process for the writable case and in a child process for the failure case (so stderr and
// the exit code are the observable output, as in the container).
//
// What it does NOT cover: the image/container itself, the real Incus or Docker volume mount
// (only a chmod'ed temp directory is tested), and everything the entrypoint does after the
// preflight (the profile seed, the model key and the exec of dsh). The child reproduces the
// entrypoint's catch (`warn(error.message)`, exit 1) because entrypoint.mjs exports no helper
// and its hardcoded `/data/secrets` path cannot be redirected at a temp directory; the
// preflight itself is not copied.
//
// As root the probe write succeeds through a 0555 directory, so the failure case would be
// meaningless and the test skips.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ensureDataDirs } from '../lib.mjs'

const LIB = fileURLToPath(new URL('../lib.mjs', import.meta.url))
const temps = []
after(() => {
  for (const dir of temps) {
    chmodSync(dir, 0o755)
    rmSync(dir, { recursive: true, force: true })
  }
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-preflight-test-'))
  temps.push(dir)
  return dir
}
const root = typeof process.getuid === 'function' && process.getuid() === 0

test(
  'an unwritable /data fails with one line naming the uid fix, writable passes',
  { skip: root ? 'root can write through 0555, so the failure case is meaningless' : false },
  () => {
    const parent = temp()
    const good = join(parent, 'writable')
    ensureDataDirs([good], { uid: 1000 })
    assert.equal(readdirSync(good).length, 0, 'the write probe must leave no file behind')

    const bad = join(parent, 'unwritable')
    mkdirSync(bad)
    chmodSync(bad, 0o555)
    try {
      // The same helper call the entrypoint makes, with the same uid it passes, in a fresh
      // process; its catch mirrors entrypoint.mjs's `warn(error.message)` and exit 1.
      const preflight = `
        import { ensureDataDirs } from ${JSON.stringify(LIB)}
        try {
          ensureDataDirs([process.argv[1]], { uid: 1000 })
        } catch (error) {
          process.stderr.write('automagik-web: ' + error.message + '\\n')
          process.exit(1)
        }
      `
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', preflight, bad], {
        encoding: 'utf8',
        timeout: 30_000,
      })
      assert.equal(result.status, 1, 'the unwritable preflight must exit 1')
      assert.equal(result.stdout, '', 'the preflight must fail before logging anything')
      assert.equal(result.stderr.trim().split('\n').length, 1, 'exactly one stderr line')
      assert.match(result.stderr, /automagik-web: /)
      assert.ok(result.stderr.includes(bad), 'the line names the unwritable directory')
      assert.match(result.stderr, /uid 1000/)
      assert.match(result.stderr, /initial\.uid=1000/)
      assert.match(result.stderr, /initial\.gid=1000/)
      assert.match(result.stderr, /cannot chown/)
      assert.doesNotMatch(result.stderr, /^\s+at\s/m, 'no stack frames')
      assert.doesNotMatch(result.stderr, /^Error:/m, 'the error name is not printed')
    } finally {
      chmodSync(bad, 0o755)
    }
  },
)
