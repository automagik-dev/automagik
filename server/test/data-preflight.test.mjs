// The /data preflight: an unwritable data directory must fail before dsh starts with one
// stderr line naming the directory, uid 1000 and the initial.uid/initial.gid fix, and no stack
// trace. This drives the real `ensureDataDirs` helper the entrypoint calls, in this process for
// the writable case and in a child process for the failure case (so stderr and the exit code
// are the observable output, as in the container).
//
// It also drives `prepareWorkspace`, the step before the preflight that repairs an empty
// root-owned workspace. Incus pre-creates the image WorkingDir on the mounted volume as root,
// so /data/workspace can exist 0:0 755: an empty one is removed and recreated as uid 1000; a
// non-empty one is left for ensureDataDirs to refuse.
//
// What it does NOT cover: the image/container itself, the real Incus or Docker volume mount
// (the root-owned workspace is simulated by a chmod'ed 0555 temp directory whose parent is a
// writable temp directory, as /data is for uid 1000), and everything the entrypoint does after
// the preflight (the profile seed, the model key and the exec of dsh). The children reproduce
// the entrypoint's catch (`warn(error.message)`, exit 1) because entrypoint.mjs exports no
// helper and its hardcoded `/data/secrets` path cannot be redirected at a temp directory; the
// preflight itself is not copied.
//
// The repair case keeps the old directory open while it runs: the removed inode cannot be reused
// while its descriptor is open, so the recreated directory's inode proves it was replaced and not
// merely chmod'ed. A further case makes the workspace empty but its parent unwritable, so the
// entry cannot be removed: the helper must leave it and let the preflight refuse, never force it.
//
// As root the probe write succeeds through a 0555 directory, so the failure, repair and
// unremovable cases would be meaningless and those tests skip.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ensureDataDirs, prepareWorkspace } from '../lib.mjs'

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
const skipAsRoot = root ? 'root can write through 0555, so the case is meaningless' : false

test(
  'an unwritable /data fails with one line naming the uid fix, writable passes',
  { skip: skipAsRoot },
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
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', preflight, bad],
        { encoding: 'utf8', timeout: 30_000 },
      )
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

test('a missing or writable workspace passes prepareWorkspace', () => {
  const parent = temp()
  const writable = join(parent, 'writable')
  mkdirSync(writable)
  const writableIno = statSync(writable).ino
  assert.equal(prepareWorkspace(writable, { uid: 1000 }), false, 'a writable directory passes')
  assert.equal(statSync(writable).ino, writableIno, 'a writable workspace is not recreated')
  ensureDataDirs([writable], { uid: 1000 })
  assert.equal(readdirSync(writable).length, 0, 'the write probe must leave no file behind')

  const missing = join(parent, 'missing')
  assert.equal(prepareWorkspace(missing, { uid: 1000 }), false, 'a missing directory passes')
  ensureDataDirs([missing], { uid: 1000 })
  assert.ok(existsSync(missing), 'the preflight creates the missing workspace')
})

test(
  'an empty root-owned workspace is repaired and the preflight then passes',
  { skip: skipAsRoot },
  () => {
    const parent = temp()
    const workspace = join(parent, 'workspace')
    mkdirSync(workspace)
    chmodSync(workspace, 0o555)
    // An open descriptor keeps the old inode allocated, so the recreated directory cannot reuse
    // its number: a chmod-only "repair" would leave the descriptor's inode in place.
    const old = openSync(workspace, 'r')
    const oldIno = fstatSync(old).ino
    try {
      assert.throws(
        () => ensureDataDirs([workspace], { uid: 1000 }),
        /is not writable by uid 1000/,
        'the untouched root-owned workspace must fail the preflight first',
      )
      assert.equal(prepareWorkspace(workspace, { uid: 1000 }), true, 'the helper repairs it')
      assert.notEqual(statSync(workspace).ino, oldIno, 'the workspace is recreated, not chmod-ed')
      const mode = statSync(workspace).mode & 0o777
      assert.notEqual(mode & 0o200, 0, 'the recreated workspace is writable by its owner')
      assert.equal(statSync(workspace).uid, process.getuid(), 'recreated by this process')
      assert.equal(readdirSync(workspace).length, 0, 'the write probe must leave no file behind')
      ensureDataDirs([workspace], { uid: 1000 })
    } finally {
      closeSync(old)
      chmodSync(workspace, 0o755)
    }
  },
)

test(
  'an empty workspace whose entry cannot be removed is left and refused, not forced',
  { skip: skipAsRoot },
  () => {
    const parent = temp()
    const workspace = join(parent, 'workspace')
    mkdirSync(workspace)
    chmodSync(workspace, 0o555)
    chmodSync(parent, 0o555)
    try {
      // uid 1000 can read the empty workspace but cannot unlink its entry from a 0555 parent.
      assert.equal(
        prepareWorkspace(workspace, { uid: 1000 }),
        false,
        'an unremovable entry is not claimed as repaired',
      )
      assert.ok(existsSync(workspace), 'the entry is left in place')
      const preflight = `
        import { ensureDataDirs, prepareWorkspace } from ${JSON.stringify(LIB)}
        try {
          prepareWorkspace(process.argv[1], { uid: 1000 })
          ensureDataDirs([process.argv[1]], { uid: 1000 })
        } catch (error) {
          process.stderr.write('automagik-web: ' + error.message + '\\n')
          process.exit(1)
        }
      `
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', preflight, workspace],
        { encoding: 'utf8', timeout: 30_000 },
      )
      assert.equal(result.status, 1, 'the unremovable workspace must fail the preflight')
      assert.equal(result.stdout, '', 'the preflight must fail before logging anything')
      assert.equal(result.stderr.trim().split('\n').length, 1, 'exactly one stderr line')
      assert.ok(result.stderr.includes(workspace), 'the line names the unwritable directory')
      assert.match(result.stderr, /uid 1000/)
      assert.match(result.stderr, /initial\.uid=1000/)
      assert.match(result.stderr, /cannot chown/)
      assert.doesNotMatch(result.stderr, /^\s+at\s/m, 'no stack frames')
      assert.ok(existsSync(workspace), 'the workspace is not forced')
      assert.equal(readdirSync(workspace).length, 0, 'the workspace is still empty')
    } finally {
      chmodSync(parent, 0o755)
    }
  },
)

test(
  'a non-empty root-owned workspace is refused with the one-line uid message and kept',
  { skip: skipAsRoot },
  () => {
    const parent = temp()
    const workspace = join(parent, 'workspace')
    mkdirSync(workspace)
    const keep = join(workspace, 'keep.txt')
    writeFileSync(keep, "the user's file\n")
    chmodSync(workspace, 0o555)
    try {
      // The entrypoint's two calls and its catch, in a child process so the stderr line and
      // exit code are observable without starting dsh.
      const preflight = `
        import { ensureDataDirs, prepareWorkspace } from ${JSON.stringify(LIB)}
        try {
          prepareWorkspace(process.argv[1], { uid: 1000 })
          ensureDataDirs([process.argv[1]], { uid: 1000 })
        } catch (error) {
          process.stderr.write('automagik-web: ' + error.message + '\\n')
          process.exit(1)
        }
      `
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', preflight, workspace],
        { encoding: 'utf8', timeout: 30_000 },
      )
      assert.equal(result.status, 1, 'the non-empty workspace must fail the preflight')
      assert.equal(result.stdout, '', 'the preflight must fail before logging anything')
      assert.equal(result.stderr.trim().split('\n').length, 1, 'exactly one stderr line')
      assert.ok(result.stderr.includes(workspace), 'the line names the unwritable directory')
      assert.match(result.stderr, /uid 1000/)
      assert.match(result.stderr, /initial\.uid=1000/)
      assert.match(result.stderr, /initial\.gid=1000/)
      assert.match(result.stderr, /cannot chown/)
      assert.doesNotMatch(result.stderr, /^\s+at\s/m, 'no stack frames')
      assert.doesNotMatch(result.stderr, /^Error:/m, 'the error name is not printed')
      assert.equal(readFileSync(keep, 'utf8'), "the user's file\n", 'the file is not removed')
      assert.equal(readdirSync(workspace).length, 1, 'the workspace itself is not removed')
    } finally {
      chmodSync(workspace, 0o755)
    }
  },
)
