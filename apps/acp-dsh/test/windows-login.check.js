import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { launchWindowsLogin, windowsLoginCommand } from '../src/host/windows-login.js'

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'windows-login-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function fake(t, extra = {}) {
  const root = scratch(t)
  const child = new EventEmitter()
  child.pid = 8123
  child.exitCode = null
  child.signalCode = null
  let request
  const kills = []
  const owner = launchWindowsLogin('C:\\tools\\codex.cmd', ['app-server'], {
    cwd: root, env: { SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe' },
  }, {
    spawn(command, args, options) {
      assert.match(command, /powershell\.exe$/)
      assert.ok(args.includes('-NoProfile'))
      assert.equal(options.shell, false)
      request = JSON.parse(options.env.AUTOMAGIK_LOGIN_JOB)
      return child
    },
    taskkill(command, args, options, done) { kills.push({ command, args }); done() },
    ...extra,
  })
  return { root, child, request, owner, kills,
    acknowledge() {
      writeFileSync(request.done, request.nonce)
      child.exitCode = 0
      child.emit('close', 0)
    } }
}

test('Windows login commands preserve argv and batch quoting without shell interpolation', () => {
  const native = windowsLoginCommand('C:\\tools\\codex.exe', ['path with spaces', 'a"b'], {})
  assert.equal(native.executable, 'C:\\tools\\codex.exe')
  assert.equal(native.line, '"C:\\tools\\codex.exe" "path with spaces" "a\\"b"')
  const batch = windowsLoginCommand('C:\\tools here\\codex.cmd', ['app-server'], {
    ComSpec: 'C:\\Windows\\cmd.exe',
  })
  assert.equal(batch.executable, 'C:\\Windows\\cmd.exe')
  assert.equal(batch.line, '"C:\\Windows\\cmd.exe" /d /s /c '
    + '""C:\\tools here\\codex.cmd" "app-server""')
  assert.throws(() => windowsLoginCommand('codex.cmd', ['%UNSAFE%'], {}), /refusing/)
})

test('Windows stop waits for full-job proof, then removes its private markers', async t => {
  const h = fake(t)
  let done = false
  h.owner.done.then(() => { done = true })
  const stopped = h.owner.stop()
  assert.equal(existsSync(h.request.stop), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(done, false)
  h.acknowledge()
  await stopped
  await h.owner.done
  assert.equal(existsSync(h.request.done), false)
  assert.deepEqual(h.kills, [])
  await h.owner.stop()
})

test('a raw Windows wrapper close without job proof cannot authorize an auth change', async t => {
  const h = fake(t)
  h.child.exitCode = 0
  h.child.emit('close', 0)
  await assert.rejects(h.owner.done, /complete sign-in process tree/)
  await assert.rejects(h.owner.stop(), /complete sign-in process tree/)
  assert.equal(existsSync(h.request.stop), true, 'unproved ownership is not discarded')
})

test('an unresponsive Windows supervisor gets taskkill /T but no unproved success', async t => {
  const h = fake(t, { stopMs: 10 })
  await assert.rejects(h.owner.stop(), /complete sign-in process tree/)
  assert.deepEqual(h.kills, [{ command: 'taskkill.exe',
    args: ['/PID', '8123', '/T', '/F'] }])
  h.acknowledge()
  await h.owner.stop()
})

test('a known-exited supervisor is never taskkilled while its pipes are still open', async t => {
  const h = fake(t, { stopMs: 10 })
  h.child.exitCode = 0
  h.child.emit('exit', 0)
  await assert.rejects(h.owner.stop(), /could not be stopped/)
  assert.deepEqual(h.kills, [])
  h.acknowledge()
  await h.owner.done
})

test('a .cmd wrapper cannot leave a delayed credential writer after login stop', {
  skip: process.platform !== 'win32' && 'requires Windows Job Objects and PowerShell',
  timeout: 20_000,
}, async t => {
  const root = scratch(t)
  const ready = join(root, 'ready')
  const wrote = join(root, 'invented-credentials')
  const script = join(root, 'wrapper.cjs')
  const batch = join(root, 'vendor.cmd')
  // The intermediate Node process exits while its detached child remains in the owned Job.
  writeFileSync(script, `const {spawn}=require('node:child_process');
    const fs=require('node:fs');
    const code="setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],"
      +"'invented-login'),1500)";
    spawn(process.execPath,['-e',code,process.argv[2]],
      {stdio:'ignore',detached:true}).unref();
    fs.writeFileSync(process.argv[3],'wrapper-exited');`)
  writeFileSync(batch, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  const owner = launchWindowsLogin(batch, [wrote, ready], {
    cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
  }, { stopMs: 10_000 })
  t.after(() => owner.stop().catch(() => {}))
  const errors = []
  owner.child.stderr.on('data', chunk => errors.push(String(chunk)))
  const deadline = Date.now() + 10_000
  while (!existsSync(ready) && Date.now() < deadline) {
    if (owner.child.exitCode !== null) assert.fail(errors.join(''))
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(readFileSync(ready, 'utf8'), 'wrapper-exited')
  await owner.stop()
  await new Promise(resolve => setTimeout(resolve, 1700))
  assert.equal(existsSync(wrote), false)
  await owner.done
})
