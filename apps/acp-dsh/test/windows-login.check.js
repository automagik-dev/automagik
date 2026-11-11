import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CliHomes } from '../src/host/cli-homes.js'
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
  assert.equal(readFileSync(h.request.done, 'utf8'), h.request.nonce,
    'recovery proof survives until the persisted ownership record is cleared')
  h.owner.dispose()
  assert.equal(existsSync(h.request.done), false)
  assert.deepEqual(h.kills, [])
  await h.owner.stop()
})

test('Windows launch binds a private liveness challenge and exposes durable recovery identity',
  async t => {
    const h = fake(t)
    assert.equal(h.request.parent, process.pid)
    assert.deepEqual(h.owner.identity, { kind: 'windows', supervisor: h.child.pid,
      directory: h.request.done.split(/[\\/]/).at(-2), nonce: h.request.nonce })
    assert.match(h.owner.identity.directory, /^\.login-job-[A-Za-z0-9]+$/)
    writeFileSync(h.request.challenge, 'other-instance')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(existsSync(h.request.acknowledge), false)
    writeFileSync(h.request.challenge, h.request.nonce)
    const deadline = Date.now() + 1000
    while (!existsSync(h.request.acknowledge) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(readFileSync(h.request.acknowledge, 'utf8'), h.request.nonce)
    h.acknowledge()
    await h.owner.done
    h.owner.dispose()
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

for (const duringStartup of [true, false]) {
  const phase = duringStartup ? 'during startup' : 'during login'
  test(`Windows parent death ${phase} drains the Job`, {
    skip: process.platform !== 'win32' && 'requires Windows Job Objects and PowerShell',
    timeout: 25_000,
  }, async t => {
    const root = mkdtempSync(join(tmpdir(), 'windows-login-parent-test-'))
    const appFile = join(root, 'app.mjs')
    const identityFile = join(root, 'identity')
    const ready = join(root, 'ready')
    const wrote = join(root, 'claude', '.claude', 'invented-credentials')
    const module = new URL('../src/host/windows-login.js', import.meta.url).href
    const homesModule = new URL('../src/host/cli-homes.js', import.meta.url).href
    const recordsModule = new URL('../src/host/login-ownership.js', import.meta.url).href
    const recovered = new CliHomes(root)
    let app, identity
    t.after(async () => {
      if (app?.exitCode === null && app.signalCode === null) app.kill('SIGKILL')
      if (identity) {
        try { writeFileSync(join(root, 'claude', identity.directory, 'stop'), '') } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      recovered.end('claude')
      recovered.dispose()
      rmSync(root, { recursive: true, force: true })
    })
    const writer = "const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');"
      + "setTimeout(()=>fs.writeFileSync(process.argv[2],'old-login'),2000);"
      + 'setInterval(()=>{},1000)'
    writeFileSync(appFile, `import {writeFileSync} from 'node:fs';
      import {launchWindowsLogin} from ${JSON.stringify(module)};
      import {CliHomes} from ${JSON.stringify(homesModule)};
      import {recordLogin} from ${JSON.stringify(recordsModule)};
      const homes=new CliHomes(${JSON.stringify(root)});
      const env=homes.environment('claude');homes.begin('claude');
      const record=recordLogin(env);
      const owned=launchWindowsLogin(process.execPath,
        ['-e',${JSON.stringify(writer)},${JSON.stringify(ready)},${JSON.stringify(wrote)}],
        {cwd:env.HOME,env,stdio:['pipe','pipe','pipe']});
      record.update(owned.identity);
      owned.child.stdout.resume();owned.child.stderr.resume();
      owned.done.then(()=>{record.clear();owned.dispose()}).catch(()=>{});
      writeFileSync(${JSON.stringify(identityFile)},JSON.stringify(owned.identity));
      ${duringStartup ? 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);' : ''}
      setInterval(()=>{},1000);`)
    app = spawn(process.execPath, [appFile], { stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env, windowsHide: true })
    app.stdout.resume()
    app.stderr.resume()
    const deadline = Date.now() + 15_000
    while ((!existsSync(identityFile) || (!duringStartup && !existsSync(ready)))
      && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    identity = JSON.parse(readFileSync(identityFile, 'utf8'))
    if (!duringStartup) assert.equal(readFileSync(ready, 'utf8'), 'ready')
    assert.throws(() => recovered.begin('claude'), { code: 'acp-account/busy' })
    // This kills the app only. Its independently running PowerShell supervisor must notice.
    const exited = new Promise(resolve => app.once('exit', resolve))
    app.kill('SIGKILL')
    await exited
    const done = join(root, 'claude', identity.directory, 'done')
    let proof
    let recoveredAccount = false
    while (Date.now() < deadline) {
      try { proof = readFileSync(done, 'utf8') } catch {}
      if (proof === identity.nonce) break
      try {
        recovered.begin('claude')
        recoveredAccount = true
        proof = readFileSync(done, 'utf8')
        assert.equal(proof, identity.nonce, 'no account change before full-job proof')
        break
      } catch (error) { assert.equal(error.code, 'acp-account/busy') }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(proof, identity.nonce, 'job-empty proof precedes any recovery')
    if (duringStartup) assert.equal(existsSync(ready), false, 'dead app starts no vendor')
    assert.equal(existsSync(wrote), false)
    // A recovered app may write new credentials only after the old job is proved empty.
    if (!recoveredAccount) recovered.begin('claude')
    writeFileSync(wrote, 'new-login')
    await new Promise(resolve => setTimeout(resolve, 2200))
    assert.equal(readFileSync(wrote, 'utf8'), 'new-login')
  })
}
