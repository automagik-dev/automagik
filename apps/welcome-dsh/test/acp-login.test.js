import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createAcpLoginActions, LOGIN_LIFETIME_MS, LOGIN_MAX_TEXT } from '../src/host/acp-login.js'

const settled = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture({ spawn, path, command } = {}) {
  const calls = [], handles = [], timers = new Set()
  const acp = {
    cliPath: async id => path ? path(id) : `/managed/${id === 'acp-claude' ? 'claude' : 'codex'}`,
    cliEnv: id => id === 'acp-claude' ? { DISABLE_UPDATES: '1' } : {},
    ...(command ? { loginCommand: command } : {}),
  }
  const subprocess = {
    spawnTerminal: async (spec) => {
      calls.push(spec)
      if (spawn) await spawn(spec)
      const outcome = deferred()
      const handle = {
        output: new PassThrough(), done: outcome.promise, writes: [], sizes: [], closes: 0,
        write: async data => { handle.writes.push(data) },
        resize: async (cols, rows) => { handle.sizes.push([cols, rows]) },
        terminate: async () => { handle.closes++; handle.output.end(); outcome.resolve({ exitCode: null, signal: 'SIGTERM' }) },
        exit: (code) => { outcome.resolve({ exitCode: code, signal: null }) },
      }
      handles.push(handle)
      return handle
    },
  }
  const ctx = {
    get: name => ({ acpAgents: acp, subprocess })[name],
    logger: { warn: () => assert.fail('Login data must never be logged') },
  }
  const bridge = createAcpLoginActions(ctx, {
    home: '/fake/home', env: { PATH: '/bin', OPENAI_API_KEY: 'do-not-forward' },
    timer: (fn, ms) => { const value = { fn, ms }; timers.add(value); return value },
    untimer: value => timers.delete(value),
  })
  return { ...bridge, calls, handles, timers, acp }
}

test('explicit start invokes only the chosen managed CLI with its fixed login command', async (t) => {
  const f = fixture()
  t.after(() => f.dispose())
  assert.deepEqual(f.calls, [])
  const claude = await f.actions['acp-login-start']({ id: 'acp-claude', cols: 70, rows: 9 })
  const codex = await f.actions['acp-login-start']({ id: 'acp-codex' })
  assert.deepEqual(f.calls.map(spec => spec.argv), [['/managed/claude', 'auth', 'login'], ['/managed/codex', 'login']])
  assert.equal(f.calls[0].cwd, '/fake/home')
  assert.deepEqual(f.calls[0].env, { DISABLE_UPDATES: '1', PATH: '/managed:/bin' })
  assert.equal(f.calls[0].cols, 70)
  assert.equal(f.calls[0].rows, 9)
  assert.equal(f.calls[0].terminalType, 'xterm-256color')
  assert.equal(f.calls[1].env.OPENAI_API_KEY, undefined)
  assert.notEqual(claude.terminal, codex.terminal)
  assert.equal(claude.status, 'running')
  // A second click cannot launch a second concurrent browser login for the same CLI.
  assert.equal((await f.actions['acp-login-start']({ id: 'acp-claude' })).terminal, claude.terminal)
  assert.equal(f.calls.length, 2)
})

test('payloads cannot add commands, paths, unsupported agents, oversized input, or arbitrary terminal ids', async (t) => {
  const f = fixture()
  t.after(() => f.dispose())
  for (const payload of [null, { id: 'acp-other' }, { id: 'acp-codex', command: 'sh' }, { id: 'acp-claude', path: '/bin/sh' }, { id: 'acp-codex', cols: 1 }]) {
    await assert.rejects(f.actions['acp-login-start'](payload), { code: 'omni-ai/invalid' })
  }
  const { terminal } = await f.actions['acp-login-start']({ id: 'acp-codex' })
  await assert.rejects(f.actions['acp-login-write']({ terminal, data: 'x'.repeat(4097) }), { code: 'omni-ai/invalid' })
  assert.throws(() => f.actions['acp-login-read']({ terminal: 'guess' }), { code: 'omni-ai/invalid' })
  assert.throws(() => f.actions['acp-login-read']({ terminal: '00000000-0000-4000-8000-000000000000' }), { code: 'omni-ai/refused' })
  assert.equal(f.calls.length, 1)
})

test('Windows batch CLI login uses only ACP\'s authoritative quoted command and environment', async (t) => {
  const argv = ['C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', '""C:\\Users\\First Last & Team\\bin\\codex.cmd" "login""']
  const env = { PATH: 'C:\\Users\\First Last & Team\\bin;C:\\Windows\\System32', CODEX_MANAGED_BY_NPM: undefined }
  const seen = []
  const f = fixture({
    path: () => assert.fail('The descriptor already selected the executable'),
    command: (id) => { seen.push(id); return { argv, env } },
  })
  t.after(() => f.dispose())
  await f.actions['acp-login-start']({ id: 'acp-codex' })
  assert.deepEqual(seen, ['acp-codex'])
  assert.deepEqual(f.calls[0].argv, argv)
  assert.deepEqual(f.calls[0].env, env)
  assert.equal(Object.hasOwn(f.calls[0].env, 'CODEX_MANAGED_BY_NPM'), true)
  assert.equal(f.calls[0].argv[0].endsWith('.cmd'), false)
  await assert.rejects(f.actions['acp-login-start']({ id: 'acp-codex', argv: ['cmd.exe', '/c', 'anything'] }), { code: 'omni-ai/invalid' })
  assert.equal(f.calls.length, 1)
})

test('an older ACP cannot launch an external Windows batch CLI as a native process', async (t) => {
  const f = fixture({ path: () => 'C:\\Users\\First Last\\bin\\codex.cmd' })
  t.after(() => f.dispose())
  await assert.rejects(f.actions['acp-login-start']({ id: 'acp-codex' }), error => error.code === 'omni-ai/refused' && error.message.includes('Windows CLI'))
  assert.deepEqual(f.calls, [])
})

test('terminal input and resize stay on the login handle, and exit waits for final UTF-8 output', async (t) => {
  const f = fixture()
  t.after(() => f.dispose())
  const { terminal } = await f.actions['acp-login-start']({ id: 'acp-codex' })
  const handle = f.handles[0]
  await f.actions['acp-login-write']({ terminal, data: 'authorization-code\r' })
  await f.actions['acp-login-resize']({ terminal, cols: 100, rows: 20 })
  assert.deepEqual(handle.writes, ['authorization-code\r'])
  assert.deepEqual(handle.sizes, [[100, 20]])
  const bytes = Buffer.from('Signed in ✓')
  handle.output.write(bytes.subarray(0, bytes.length - 1))
  handle.exit(0)
  await settled()
  assert.equal(f.actions['acp-login-read']({ terminal }).status, 'running')
  handle.output.end(bytes.subarray(bytes.length - 1))
  await settled()
  const done = f.actions['acp-login-read']({ terminal })
  assert.equal(done.status, 'exited')
  assert.equal(done.exitCode, 0)
  assert.equal(done.text, 'Signed in ✓')
  await assert.rejects(f.actions['acp-login-write']({ terminal, data: 'ignored' }), { code: 'omni-ai/refused' })
})

test('output retains only a bounded in-memory tail and reports a cursor gap', async (t) => {
  const f = fixture()
  t.after(() => f.dispose())
  const { terminal } = await f.actions['acp-login-start']({ id: 'acp-claude' })
  f.handles[0].output.write('x'.repeat(LOGIN_MAX_TEXT + 20))
  await settled()
  const full = f.actions['acp-login-read']({ terminal })
  assert.equal(full.text.length, LOGIN_MAX_TEXT)
  assert.equal(full.lossy, true)
  assert.equal(full.nextOffset, LOGIN_MAX_TEXT + 20)
  f.handles[0].output.write('next')
  await settled()
  assert.equal(f.actions['acp-login-read']({ terminal, from: full.nextOffset }).text, 'next')
  assert.throws(() => f.actions['acp-login-read']({ terminal, from: 1_000_000 }), { code: 'omni-ai/invalid' })
})

test('explicit close, lost-window expiry, and plugin disposal terminate and erase their attempts', async () => {
  const f = fixture()
  const first = await f.actions['acp-login-start']({ id: 'acp-claude' })
  await f.actions['acp-login-close']({ terminal: first.terminal })
  await f.actions['acp-login-close']({ terminal: first.terminal })
  assert.equal(f.handles[0].closes, 1)
  assert.throws(() => f.actions['acp-login-read']({ terminal: first.terminal }), { code: 'omni-ai/refused' })
  const second = await f.actions['acp-login-start']({ id: 'acp-codex' })
  const expiry = [...f.timers][0]
  assert.equal(expiry.ms, LOGIN_LIFETIME_MS)
  expiry.fn()
  await settled()
  assert.equal(f.handles[1].closes, 1)
  assert.throws(() => f.actions['acp-login-read']({ terminal: second.terminal }), { code: 'omni-ai/refused' })
  await f.actions['acp-login-start']({ id: 'acp-claude' })
  await f.dispose()
  assert.equal(f.handles[2].closes, 1)
  assert.equal(f.timers.size, 0)
  await assert.rejects(f.actions['acp-login-start']({ id: 'acp-codex' }), { code: 'omni-ai/refused' })
})

test('disposal while PTY allocation is pending closes any late handle before start can succeed', async () => {
  const gate = deferred()
  const f = fixture({ spawn: () => gate.promise })
  const start = f.actions['acp-login-start']({ id: 'acp-codex' })
  const failed = assert.rejects(start, { code: 'omni-ai/refused' })
  await settled()
  const disposal = f.dispose()
  gate.resolve()
  await Promise.all([failed, disposal])
  assert.ok(f.handles[0].closes >= 1)
  assert.equal(f.calls[0].signal.aborted, true)
  assert.equal(f.timers.size, 0)
})

test('provider errors never expose authorization text and cleanup failures remain retryable', async (t) => {
  const failing = fixture({ spawn: () => { throw new Error('secret-authorization-value') } })
  await assert.rejects(failing.actions['acp-login-start']({ id: 'acp-codex' }), error => error.code === 'omni-ai/refused' && !error.message.includes('secret-authorization-value'))
  await failing.dispose()
  const f = fixture()
  t.after(() => f.dispose())
  const { terminal } = await f.actions['acp-login-start']({ id: 'acp-codex' })
  const handle = f.handles[0], close = handle.terminate
  handle.terminate = async () => { throw new Error('secret-authorization-value') }
  await assert.rejects(f.actions['acp-login-close']({ terminal }), error => error.code === 'omni-ai/refused' && !error.message.includes('secret-authorization-value'))
  handle.terminate = close
  await f.actions['acp-login-close']({ terminal })
  assert.equal(handle.closes, 1)
})
