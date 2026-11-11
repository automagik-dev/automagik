// Fake vendor auth stores and CLI processes only. No real credential is read or copied.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { apply, SERVICE } from '../index.js'
import { HOME_ENV, trackRun } from '../src/host/cli-homes.js'
import { MODEL_ACCESS_REQUIRED } from '../src/host/names.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const who = email => ({ kind: 'account', id: email, facets: { kind: 'account', email }, email })

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'isolated-accounts-'))
  const terminalHomes = { claude: join(root, 'terminal', '.claude'),
    codex: join(root, 'terminal', '.codex') }
  const auth = {
    has: dir => existsSync(join(dir, 'account')),
    get: dir => readFileSync(join(dir, 'account'), 'utf8'),
    set(dir, email) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'account'), email)
    },
    delete: dir => rmSync(join(dir, 'account'), { force: true }),
  }
  for (const [vendor, name] of [['claude', 'CLAUDE_CONFIG_DIR'], ['codex', 'CODEX_HOME']]) {
    auth.set(terminalHomes[vendor], 'terminal-work@example.test')
    const previous = process.env[name]
    process.env[name] = terminalHomes[vendor]
    t.after(() => {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    })
  }
  const terminal = join(terminalHomes.claude, 'account')
  const selected = (vendor, env) => (
    env[vendor === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'] ?? terminalHomes[vendor]
  )
  const calls = []
  const events = []
  const cleanups = []
  let service, adapter
  const ctx = {
    logger: { info() {}, warn() {} },
    agents: { list: () => [], get: () => ({ status: 'idle',
      ctx: { tools: { register: () => () => {} } }, session: { header: {} } }) },
    llm: { registerAdapter(ids, value) { adapter = value; return () => {} },
      listProviders: () => [], listModels: () => new Promise(() => {}) },
    on() {}, get() {}, provide(name, value) { if (name === SERVICE) service = value },
    effect(setup) { cleanups.push(setup()) }, emit(name) { events.push(name) },
  }
  const signedIn = async (spec, cli, { env }) => {
    calls.push({ kind: 'status', vendor: spec.key, env })
    return auth.has(selected(spec.key, env))
  }
  let nextAccount = 'personal@example.test'
  let failLogout = false
  let imageCheck = async () => ({ ok: true })
  const spawn = (cli, args, options) => {
    calls.push({ kind: 'login', cli, args, ...options })
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.exitCode = child.signalCode = null
    child.kill = () => {
      if (child.exitCode === null) {
        child.exitCode = 0
        queueMicrotask(() => child.emit('close', 0))
      }
    }
    const complete = () => auth.set(selected(cli.endsWith('claude') ? 'claude' : 'codex',
      options.env), nextAccount)
    if (cli.endsWith('claude')) {
      setImmediate(() => { complete(); child.exitCode = 0; child.emit('close', 0) })
    } else {
      child.stdin.on('data', line => {
        const request = JSON.parse(String(line))
        if (request.method === 'initialize') child.stdout.write(
          `${JSON.stringify({ id: request.id, result: {} })}\n`)
        if (request.method === 'account/login/start') {
          complete()
          child.stdout.write(`${JSON.stringify({ id: request.id, result: {
            type: 'chatgptDeviceCode', loginId: 'fake-login', userCode: 'ABCD-1234',
            verificationUrl: 'https://auth.openai.com/codex/device',
          } })}\n`)
          child.stdout.write(`${JSON.stringify({ method: 'account/login/completed',
            params: { loginId: 'fake-login', success: true } })}\n`)
        }
      })
    }
    return child
  }
  apply(ctx, {}, {
    store: { home: join(root, 'adapters'),
      binOf: () => ({ path: '/fake/adapter', version: '1' }), update: async () => {} },
    cliStore: undefined, find: name => `/fake/${name}`,
    signedIn, account: async (spec, cli, { env }) => {
      calls.push({ kind: 'account', vendor: spec.key, env })
      const home = selected(spec.key, env)
      return auth.has(home) ? who(auth.get(home)) : undefined
    },
    loginSpawn: spawn,
    logoutRun(cli, args, options, done) {
      calls.push({ kind: 'logout', cli, args, ...options })
      if (!failLogout) auth.delete(selected(cli.endsWith('claude') ? 'claude' : 'codex',
        options.env))
      done(failLogout ? new Error('invented-private-output') : null)
    },
    imageSetup: (...args) => imageCheck(...args),
  })
  t.after(async () => {
    for (const cleanup of cleanups) cleanup()
    await tick()
    rmSync(root, { recursive: true, force: true })
  })
  const login = async id => {
    const attempt = await service.loginStart(id)
    for (let i = 0; i < 30; i++) {
      await tick()
      if (service.loginStatus(id, attempt.attemptId).status === 'ready') return
    }
    assert.fail('fake sign-in did not finish')
  }
  return { service, adapter, auth, calls, events, root, terminal, login,
    next: email => { nextAccount = email }, fail: value => { failLogout = value },
    imageCheck: check => { imageCheck = check } }
}

for (const id of ['acp-claude', 'acp-codex']) {
  test(`${id}: isolated login/logout/switch preserve the signed-in terminal`, async t => {
    const h = fixture(t)
    assert.equal((await h.service.inspect(id)).signedIn, false)
    assert.equal(h.service.authScope, 'isolated')
    const blocked = []
    for await (const event of h.adapter.stream({ provider: id, model: 'default',
      sessionId: 'bot', messages: [{ role: 'user', content: 'hello' }] })) blocked.push(event)
    assert.ok(JSON.stringify(blocked).includes(MODEL_ACCESS_REQUIRED))
    assert.match(JSON.stringify(blocked), /Sign in.*in the app/)
    await h.login(id)
    const account = await h.service.account(id, { fresh: true })
    assert.equal(account.account.email, 'personal@example.test')
    assert.equal(account.consent, 'given', 'old connector does not carry terminal consent')
    assert.equal((await h.service.terminalAccount(id)).account.email,
      'terminal-work@example.test')
    const launch = h.adapter.agents.get(id).spawn()
    const login = h.calls.find(call => call.kind === 'login')
    assert.equal(launch.env[HOME_ENV], login.env[HOME_ENV])
    assert.equal(h.adapter.agents.get(id).catalog.spec.spawn().env[HOME_ENV],
      login.env[HOME_ENV])
    for (const call of h.calls.filter(call => ['status', 'account'].includes(call.kind)
      && call.env[HOME_ENV])) assert.equal(call.env[HOME_ENV], launch.env[HOME_ENV])
    await h.service.accountSignOut(id)
    assert.equal((await h.service.inspect(id)).signedIn, false)
    assert.equal((await h.service.account(id)).account, undefined)
    h.next('second@example.test')
    await h.service.accountSwitch(id, { label: 'bot' })
    for (let i = 0; i < 20; i++) await tick()
    assert.equal((await h.service.account(id, { fresh: true })).account.email,
      'second@example.test')
    assert.equal(readFileSync(h.terminal, 'utf8'), 'terminal-work@example.test')
    assert.equal(readFileSync(join(h.root, 'terminal', '.codex', 'account'), 'utf8'),
      'terminal-work@example.test')
    assert.ok(h.calls.filter(call => call.kind === 'logout').every(call =>
      call.cwd === launch.env[HOME_ENV]))
  })
}

test('sign-out blocks new work and waits for running work before invoking logout', async t => {
  const h = fixture(t)
  await h.login('acp-codex')
  const env = h.adapter.agents.get('acp-codex').spawn().env
  const before = h.calls.filter(call => call.kind === 'logout').length
  let release
  trackRun({ spec: { env }, stop: () => new Promise(resolve => { release = resolve }) })
  const changing = h.service.accountSignOut('acp-codex')
  while (!release) await tick()
  assert.equal(h.calls.filter(call => call.kind === 'logout').length, before)
  assert.equal((await h.service.imageAccess()).ready, false)
  await assert.rejects(h.service.accountSignOut('acp-codex'), { code: 'acp-account/busy' })
  release()
  await changing
  assert.equal(h.calls.filter(call => call.kind === 'logout').length, before + 1)
})

test('logout errors pause work, hide CLI output, and allow explicit retry', async t => {
  const h = fixture(t)
  await h.login('acp-codex')
  h.fail(true)
  await assert.rejects(h.service.accountSignOut('acp-codex'), error => {
    assert.equal(error.code, 'acp-account/logout')
    assert.doesNotMatch(error.message, /private/)
    return true
  })
  assert.equal((await h.service.inspect('acp-codex')).signedIn, false)
  assert.equal((await h.service.imageAccess()).ready, false)
  h.fail(false)
  await h.service.accountSignOut('acp-codex')
  assert.equal((await h.service.inspect('acp-codex')).signedIn, false)
})

test('image readiness delayed across sign-out never authorizes work on the next account',
  async t => {
    const h = fixture(t)
    await h.login('acp-codex')
    let release, began
    const waiting = new Promise(resolve => { began = resolve })
    h.imageCheck(() => new Promise(resolve => { release = resolve; began() }))
    const access = h.service.imageAccess()
    await waiting
    await h.service.accountSignOut('acp-codex')
    release({ ok: true })
    assert.equal((await access).ready, false)
  })

test('a generation-zero image ticket is refused after switching to another Bot account',
  async t => {
    const h = fixture(t)
    const env = h.adapter.agents.get('acp-codex').spawn().env
    h.auth.set(env.CODEX_HOME, 'first@example.test')
    await h.service.accountConfirm('acp-codex')
    const before = await h.service.imageAccess()
    assert.equal(before.accountGeneration, 0)
    h.next('second@example.test')
    await h.service.accountSwitch('acp-codex')
    for (let i = 0; i < 20; i++) await tick()
    assert.equal((await h.service.account('acp-codex')).account.email, 'second@example.test')
    await assert.rejects(h.service.generateImage({ prompt: 'a fox',
      accountGeneration: before.accountGeneration }), { code: 'acp/image-signed-out' })
  })
