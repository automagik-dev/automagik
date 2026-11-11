import assert from 'node:assert/strict'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter, dirname } from 'node:path'
import { test } from 'node:test'
import { startHermesSsh } from '../src/host/hermes-ssh.js'

async function fixture(t, scenario = 'ready') {
  const home = await mkdtemp(join(tmpdir(), 'hermes-ssh-'))
  const executable = join(home, 'ssh'), record = join(home, 'record.jsonl')
  const script = await readFile(new URL('./fixtures/hermes-fake-ssh.mjs', import.meta.url), 'utf8')
  await writeFile(executable, `#!${process.execPath}\n${script}`, { mode: 0o700 })
  const credential = randomBytes(32).toString('hex')
  const remotePort = randomInt(1024, 65536), localPort = randomInt(1024, 65536)
  const config = { host: `${randomUUID()}.invalid`, user: `sample-${randomUUID()}`, port: randomInt(1024, 65536), identityFile: join(home, randomUUID()), hermesPath: `/sample/${randomUUID()}/hermes` }
  const options = { env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${home}${delimiter}${process.env.PATH}`, HERMES_SSH_RECORD: record, HERMES_SSH_SCENARIO: scenario, HERMES_SSH_REMOTE_PORT: String(remotePort) }, allocatePort: async () => localPort,
    deadlines: { start: 5000, control: 3000, cancel: 250 }, randomBytes: size => size === 32 ? Buffer.from(credential, 'hex') : randomBytes(size) }
  const connections = []
  const records = async () => (await readFile(record, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const untilRecord = predicate => new Promise((resolve, reject) => {
    let settled = false
    const check = async () => {
      try {
        if (!settled && predicate(await records())) { settled = true; events.close(); resolve() }
      } catch (error) { settled = true; events.close(); reject(error) }
    }
    // Subscribe before the first read, so no record append can fall in a gap.
    const events = watch(home, () => { void check() })
    t.after(() => events.close())
    void check()
  })
  const open = async (ssh = config, overrides = {}) => { const connection = await startHermesSsh(ssh, { ...options, ...overrides }); connections.push(connection); return connection }
  t.after(async () => { for (const connection of connections) await connection.close().catch(error => error.localClosed); await rm(home, { recursive: true, force: true }) })
  return { home, config, options, open, credential, localPort, remotePort, records, untilRecord }
}

test('system ssh respects config/key arguments, enforces known-host key-only auth and tunnels numeric loopback', async t => {
  const f = await fixture(t)
  const connection = await f.open()
  assert.equal(connection.address, `http://127.0.0.1:${f.localPort}`)
  assert.equal(connection.credential, f.credential)
  const records = await f.records(), starts = records.filter(record => record.event === 'spawn')
  assert.equal(starts.length, 2)
  for (const { args } of starts) {
    for (const option of ['BatchMode=yes', 'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'PreferredAuthentications=publickey', 'StrictHostKeyChecking=yes', 'ExitOnForwardFailure=yes', 'ControlMaster=no']) assert.ok(args.includes(option), option)
    assert.equal(args[args.indexOf('-p') + 1], String(f.config.port))
    assert.equal(args[args.indexOf('-i') + 1], f.config.identityFile)
    assert.equal(args[args.indexOf('--') + 1], `${f.config.user}@${f.config.host}`)
    assert.ok(!JSON.stringify(args).includes(f.credential))
  }
  const tunnel = starts.find(record => record.role === 'tunnel')
  assert.equal(tunnel.args[tunnel.args.indexOf('-L') + 1], `127.0.0.1:${f.localPort}:127.0.0.1:${f.remotePort}`)
  assert.ok(starts.find(record => record.role === 'supervisor').args.at(-1).startsWith('exec python3 -u -c '))
  assert.equal(records.find(record => record.event === 'input').hermesPath, f.config.hermesPath)
  assert.ok(!JSON.stringify(records).includes(f.credential))
  await assert.rejects(access(f.config.identityFile)) // It was passed to ssh, never read/copied by DSH.
  const closing = connection.close()
  assert.equal(connection.close(), closing)
  await closing
  const ended = (await f.records()).filter(record => record.event === 'closed')
  assert.deepEqual(ended.map(record => record.role).sort(), ['supervisor', 'tunnel'])
})

test('SSH aliases and blank optional fields retain system configuration and remote executable autodetection', async t => {
  const f = await fixture(t)
  const alias = `sample-${randomUUID()}`
  await f.open({ host: alias })
  const records = await f.records()
  for (const record of records.filter(record => record.event === 'spawn')) {
    assert.equal(record.args[record.args.indexOf('--') + 1], alias)
    assert.ok(!record.args.includes('-p') && !record.args.includes('-i'))
  }
  assert.equal(records.find(record => record.event === 'input').hermesPath, '')
})

test('unknown/changed host keys and key authentication failures are fixed actionable errors with no raw output', async t => {
  for (const [scenario, kind] of [['host-key', 'host-key-changed'], ['changed-key', 'host-key-changed'], ['auth', 'auth-failed'], ['auth-delayed', 'auth-failed'], ['interactive', 'interactive-auth'], ['unreachable', 'unreachable'], ['python-missing', 'unsupported-platform']]) {
    const f = await fixture(t, scenario)
    await assert.rejects(f.open(), error => error.code === ({ 'host-key-changed': 'bot/hermes-ssh-host-key', 'auth-failed': 'bot/hermes-ssh-auth', 'interactive-auth': 'bot/hermes-ssh-interactive', unreachable: 'bot/hermes-ssh-unreachable', 'unsupported-platform': 'bot/hermes-ssh-platform' }[kind] ?? 'bot/hermes-ssh') && error.sshError === kind && !error.stack.includes(f.config.host) && !error.stack.includes(f.config.identityFile) && !error.stack.includes(f.credential))
    assert.equal((await f.records()).filter(record => record.event === 'spawn').length, 1)
  }
})

test('missing Hermes and unsupported ownership flags stop before a tunnel and clean the supervisor', async t => {
  for (const [scenario, kind] of [['missing', 'hermes-not-found'], ['old-contract', 'update-required']]) {
    const f = await fixture(t, scenario)
    await assert.rejects(f.open(), error => error.code === (kind === 'hermes-not-found' ? 'bot/hermes-ssh-missing' : 'bot/hermes-ssh-update') && error.sshError === kind && !error.cleanupUnknown)
    assert.equal((await f.records()).filter(record => record.event === 'spawn').length, 1)
    assert.equal((await f.records()).at(-1).event, 'closed')
  }
})

test('startup timeout is bounded and failed forwarding closes the remote supervisor without uncertain retries', async t => {
  const f = await fixture(t, 'timeout')
  await assert.rejects(f.open(undefined, { deadlines: { start: 150, control: 100, cancel: 200 } }), error => error.sshError === 'timeout' && error.code === 'bot/hermes-ssh-timeout')
  assert.equal((await f.records()).filter(record => record.event === 'spawn').length, 1)
  const broken = await fixture(t, 'tunnel-failure')
  await assert.rejects(broken.open(), error => error.code === 'bot/hermes-ssh' && !error.cleanupUnknown)
  assert.ok((await broken.records()).some(record => record.role === 'supervisor' && record.event === 'closed'))
})

test('abort before startup creates no process; abort of an active connection closes supervisor and tunnel', async t => {
  const f = await fixture(t)
  const before = new AbortController(); before.abort()
  await assert.rejects(f.open(undefined, { signal: before.signal }), /cancelled/)
  const active = new AbortController()
  const connection = await f.open(undefined, { signal: active.signal })
  active.abort()
  await connection.close()
  assert.deepEqual((await f.records()).filter(record => record.event === 'closed').map(record => record.role).sort(), ['supervisor', 'tunnel'])
})

test('abort interrupts a pending port allocation instead of waiting for a control deadline', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const pending = f.open(undefined, { signal: controller.signal, allocatePort: () => { controller.abort(); return new Promise(() => {}) } })
  await assert.rejects(pending, /cancelled/)
  assert.equal((await f.records()).filter(record => record.event === 'spawn').length, 1)
  assert.equal((await f.records()).at(-1).event, 'closed')
})

test('malformed supervisor records are bounded and never leak transient credentials', async t => {
  for (const scenario of ['wrong-nonce', 'bad-frame', 'oversized']) {
    const f = await fixture(t, scenario)
    await assert.rejects(f.open(), error => error.code === 'bot/hermes-ssh' && !error.stack.includes(f.credential) && !error.stack.includes(f.config.host))
    assert.ok(!JSON.stringify(await f.records()).includes(f.credential))
  }
})

test('close reports unconfirmed remote cleanup and still terminates local children within the grace', async t => {
  const f = await fixture(t, 'ignore-close')
  const connection = await f.open()
  const starts = (await f.records()).filter(record => record.event === 'spawn')
  let unknown
  await assert.rejects(connection.close(), error => { unknown = error; return error.cleanupUnknown && /could not be confirmed|background remote work may continue/.test(error.message) && !error.message.includes(f.credential) })
  await unknown.localClosed
  for (const { pid } of starts) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('invalid SSH fields are rejected before any executable can be started', async () => {
  let spawned = false
  for (const ssh of [{ host: '-option' }, { host: 'sample;command' }, { host: 'sample', user: '-option' }, { host: 'sample', port: '1;command' }, { host: 'sample', identityFile: '-option' }, { host: 'sample', hermesPath: 'sample\ncommand' }]) {
    await assert.rejects(startHermesSsh(ssh, { spawn: () => { spawned = true } }), error => error.code === 'bot/hermes-ssh')
  }
  assert.equal(spawned, false)
})

async function fakeRuntime(f) {
  const executable = join(f.home, randomUUID())
  await writeFile(executable, `#!${process.execPath}\n${await readFile(new URL('./fixtures/hermes-fake-runtime.mjs', import.meta.url), 'utf8')}`, { mode: 0o700 })
  return executable
}

async function waitFor(predicate) {
  const until = Date.now() + 5000
  while (!(await predicate())) {
    assert.ok(Date.now() < until, 'fake child did not reach its expected lifecycle state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('our remote supervisor runs only the fake Hermes, sends the token through a private file, and stops its owned child', async t => {
  const f = await fixture(t, 'runtime-ready')
  const hermesPath = await fakeRuntime(f)
  const connection = await f.open({ ...f.config, hermesPath })
  const runtime = (await f.records()).find(record => record.event === 'runtime-start')
  assert.ok(runtime)
  for (const flag of ['serve', '--isolated', '--host', '--port', '--ssh-session-token-file', '--ssh-owner-nonce']) assert.ok(runtime.args.includes(flag))
  assert.equal(runtime.args[runtime.args.indexOf('--host') + 1], '127.0.0.1')
  assert.equal(runtime.args[runtime.args.indexOf('--port') + 1], '0')
  assert.equal(runtime.tokenMode, 0o600)
  assert.equal(runtime.tokenHash, (await import('node:crypto')).createHash('sha256').update(f.credential).digest('hex'))
  assert.ok(!JSON.stringify(await f.records()).includes(f.credential))
  await connection.close()
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' })
  assert.ok((await f.records()).some(record => record.event === 'runtime-stop'))
  await assert.rejects(access(runtime.args[runtime.args.indexOf('--ssh-session-token-file') + 1]))
})

test('our supervisor checks actual fake capability output before starting a child', async t => {
  const f = await fixture(t, 'runtime-old')
  const hermesPath = await fakeRuntime(f)
  await assert.rejects(f.open({ ...f.config, hermesPath }), error => error.sshError === 'update-required' && error.code === 'bot/hermes-ssh-update' && !error.cleanupUnknown)
  assert.ok(!(await f.records()).some(record => record.event === 'runtime-start'))
})

test('our supervisor bounds the remote lease with heartbeats even when SSH stdin stays open', async t => {
  const f = await fixture(t, 'runtime-ready')
  const hermesPath = await fakeRuntime(f)
  const { spawn } = await import('node:child_process')
  const connection = await f.open({ ...f.config, hermesPath }, { spawn: (...args) => {
    const child = spawn(...args)
    const write = child.stdin.write.bind(child.stdin)
    child.stdin.write = (data, ...rest) => data === 'ping\n' ? true : write(data, ...rest)
    return child
  } })
  await waitFor(async () => (await f.records()).some(record => record.event === 'runtime-stop'))
  await connection.close()
  for (const { pid } of (await f.records()).filter(record => record.event === 'spawn' || record.event === 'runtime-start')) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('the remote supervisor force-stops only its owned fake child when graceful termination expires', async t => {
  const f = await fixture(t, 'runtime-ignore-term')
  const hermesPath = await fakeRuntime(f)
  const connection = await f.open({ ...f.config, hermesPath }, { deadlines: { start: 1500, control: 400, cancel: 1000 } })
  const runtime = (await f.records()).find(record => record.event === 'runtime-start')
  await connection.close()
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' })
})

test('a missing local ssh executable reports unreachable without claiming a remote cleanup failure', async t => {
  const f = await fixture(t)
  await assert.rejects(f.open(undefined, { sshCommand: join(f.home, randomUUID()) }), error => error.sshError === 'unreachable' && error.code === 'bot/hermes-ssh-unreachable' && !error.cleanupUnknown && !error.message.includes(f.home))
})

test('application exit detaches the private control channel and stops the owned fake server and tunnel', async t => {
  const f = await fixture(t, 'runtime-ready')
  const hermesPath = await fakeRuntime(f)
  const { spawn } = await import('node:child_process')
  const program = `import { startHermesSsh } from ${JSON.stringify(new URL('../src/host/hermes-ssh.js', import.meta.url).href)};
    await startHermesSsh(JSON.parse(process.env.HERMES_SSH_FIXTURE_CONFIG), { env: process.env, allocatePort: async () => Number(process.env.HERMES_SSH_FIXTURE_LOCAL_PORT), deadlines: { start: 2000, control: 500, cancel: 500 } });
    process.exit(0);`
  const app = spawn(process.execPath, ['--input-type=module', '-e', program], { env: { ...f.options.env, HERMES_SSH_FIXTURE_CONFIG: JSON.stringify({ ...f.config, hermesPath }), HERMES_SSH_FIXTURE_LOCAL_PORT: String(f.localPort) }, stdio: ['ignore', 'ignore', 'ignore'] })
  const status = await new Promise((resolve, reject) => { app.once('error', reject); app.once('close', resolve) })
  assert.equal(status, 0)
  await waitFor(async () => (await f.records()).some(record => record.event === 'runtime-stop') && (await f.records()).filter(record => record.event === 'closed').length === 2)
  const records = await f.records()
  assert.deepEqual(records.filter(record => record.event === 'closed').map(record => record.role).sort(), ['supervisor', 'tunnel'])
  // The live supervisor reaps its owned server; orphaned SSH clients are reaped by
  // the host after the app exits, so their PID disappearance is not a portable gate.
  assert.throws(() => process.kill(records.find(record => record.event === 'runtime-start').pid, 0), { code: 'ESRCH' })
})


for (const [exitsFirst, withoutWaitid] of [[false, false], [true, false], [true, true]]) {
  test(`owned group cleanup includes a TERM-ignoring descendant when its leader exits ${exitsFirst ? 'before close' : 'on TERM'}${withoutWaitid ? ' without waitid' : ''}`, { timeout: 10000 }, async t => {
    const f = await fixture(t, withoutWaitid ? 'runtime-leader-exits-first-no-waitid' : exitsFirst ? 'runtime-leader-exits-first' : 'runtime-leader-exits-term')
    const hermesPath = await fakeRuntime(f)
    const connection = await f.open({ ...f.config, hermesPath }, { deadlines: { start: 2000, control: 400, cancel: 1000 } })
    const records = await f.records()
    const leader = records.find(record => record.event === 'runtime-start')
    const descendant = records.find(record => record.event === 'descendant-start')
    assert.ok(descendant, 'the fake descendant has installed its TERM refusal before readiness')
    t.after(() => { try { process.kill(descendant.pid, 'SIGKILL') } catch {} })
    if (exitsFirst) {
      process.kill(leader.pid, 'SIGTERM')
      await f.untilRecord(records => records.some(record => record.event === 'runtime-stop'))
    }
    let unknown
    try { await connection.close() } catch (error) { unknown = error }
    if (unknown) {
      assert.equal(unknown.cleanupUnknown, true)
      assert.equal(unknown.code, 'bot/hermes-ssh-cleanup')
      assert.ok(unknown.localClosed instanceof Promise, 'unknown close exposes eventual local reaping')
      await unknown.localClosed
    } else {
      assert.throws(() => process.kill(descendant.pid, 0), { code: 'ESRCH' }, 'a clean verdict proves the whole owned group is gone')
    }
    assert.ok((await f.records()).some(record => record.event === 'descendant-term'), 'TERM targeted the group even after the leader exited')
  })
}

test('an unknown close retains an explicit completion promise until local SSH close events are reaped', { timeout: 10000 }, async t => {
  const f = await fixture(t, 'ignore-close')
  const { spawn } = await import('node:child_process')
  const delivered = []
  let localCount = 0, allClosed
  const closed = new Promise(resolve => { allClosed = resolve })
  const connection = await f.open(undefined, { spawn: (...args) => {
    const child = spawn(...args)
    localCount++
    const on = child.on.bind(child)
    child.on = (event, callback) => event === 'close' ? on(event, (...values) => {
      delivered.push(() => callback(...values))
      if (delivered.length === localCount) allClosed()
    }) : on(event, callback)
    return child
  } })
  const starts = (await f.records()).filter(record => record.event === 'spawn')
  let unknown
  await assert.rejects(connection.close(), error => { unknown = error; return error.cleanupUnknown === true && error.code === 'bot/hermes-ssh-cleanup' })
  assert.ok(unknown.localClosed instanceof Promise, 'the caller can await actual local process reaping after the bounded unknown verdict')
  let completed = false
  void unknown.localClosed.then(() => { completed = true })
  await Promise.resolve()
  assert.equal(completed, false)
  await closed
  for (const release of delivered) release()
  await unknown.localClosed
  for (const { pid } of starts) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})


test('the actual supervisor retains its ownership pin on older Python without waitid', async t => {
  const f = await fixture(t, 'runtime-no-waitid')
  const hermesPath = await fakeRuntime(f)
  const connection = await f.open({ ...f.config, hermesPath })
  const runtime = (await f.records()).find(record => record.event === 'runtime-start')
  await connection.close()
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' })
})

test('the actual supervisor refuses an unsupported platform before launching a runtime', async t => {
  const f = await fixture(t, 'runtime-unsupported-platform')
  const hermesPath = await fakeRuntime(f)
  await assert.rejects(f.open({ ...f.config, hermesPath }), error => error.code === 'bot/hermes-ssh-platform' && error.sshError === 'unsupported-platform' && !error.cleanupUnknown)
  assert.ok(!(await f.records()).some(record => record.event === 'runtime-start'))
})
