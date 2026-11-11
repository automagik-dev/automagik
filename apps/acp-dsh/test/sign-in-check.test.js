// A sign-in check that ran and could not tell says why (#971, experience review 12). A status
// row had no `signedIn` in three different cases: no check yet, a CLI that did not answer in
// time, and an answer nobody could read. The row now carries `signInCheck` for the last two.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, SERVICE } from '../index.js'
import { AGENTS, SIGN_IN_TIMEOUT_MS, signedInOf } from '../src/host/agents.js'

const CLAUDE = AGENTS['acp-claude']
const CODEX = AGENTS['acp-codex']
const ENV = { PATH: '/usr/bin' }

// `execFile` with the answer the row gives: (error, stdout).
const run = (error, stdout = '') => (_file, _args, _options, done) => { setImmediate(() => done(error, stdout)) }
const exit = code => Object.assign(new Error('exit'), { code })
// What Node hands back when it killed the CLI at the timeout.
const timedOut = () => Object.assign(new Error('Command failed'), { killed: true, code: null, signal: 'SIGTERM' })

// One check, with what it answered and why it could not tell (an array: told at most once).
async function check(spec, cli, runner) {
  const whys = []
  const answer = await signedInOf(spec, cli, { env: ENV, run: runner, onUnknown: why => whys.push(why) })
  return { answer, whys }
}

test('#971: a CLI killed at the timeout is "timeout"', async () => {
  assert.deepEqual(await check(CODEX, '/bin/codex', run(timedOut())), { answer: undefined, whys: ['timeout'] })
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(timedOut())), { answer: undefined, whys: ['timeout'] })
  // A CLI that caught the signal and exited with a code of its own was still ended at the timeout.
  const caught = () => Object.assign(new Error('Command failed'), { killed: true, code: 2, signal: null })
  assert.deepEqual(await check(CODEX, '/bin/codex', run(caught())), { answer: undefined, whys: ['timeout'] })
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(caught(), 'half an answer')), { answer: undefined, whys: ['timeout'] })
  // It caught the signal and exited 0 with half an answer: Node reports no error at all, and
  // marks the process it ended.
  const ended = (_file, _args, _options, done) => { const child = { killed: true }; setImmediate(() => done(null, '{"logged')); return child }
  assert.deepEqual(await check(CLAUDE, '/bin/claude', ended), { answer: undefined, whys: ['timeout'] })
  // The same unread answer from a CLI nobody ended is unreadable.
  const alive = (_file, _args, _options, done) => { const child = { killed: false }; setImmediate(() => done(null, '{"logged')); return child }
  assert.deepEqual(await check(CLAUDE, '/bin/claude', alive), { answer: undefined, whys: ['unreadable'] })
  // An exit code that tells is the answer it always was, timeout or not.
  assert.deepEqual(await check(CODEX, '/bin/codex', run(Object.assign(new Error('Command failed'), { killed: true, code: 1, signal: null }))), { answer: false, whys: [] })
  // The timeout the check runs with is the one the reason speaks of.
  let options
  await signedInOf(CODEX, '/bin/codex', { env: ENV, run: (_file, _args, given, done) => { options = given; done(null, '') } })
  assert.equal(options.timeout, SIGN_IN_TIMEOUT_MS)
  assert.equal(SIGN_IN_TIMEOUT_MS, 8000)
})

test('#971: a CLI that cannot be run, or an answer nobody reads, is "unreadable"', async () => {
  // Gone, or not executable.
  assert.deepEqual(await check(CODEX, '/gone/codex', run(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))), { answer: undefined, whys: ['unreadable'] })
  assert.deepEqual(await check(CODEX, '/bin/codex', run(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))), { answer: undefined, whys: ['unreadable'] })
  // Killed for writing too much is not a timeout.
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(Object.assign(new Error('maxBuffer'), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }))), { answer: undefined, whys: ['unreadable'] })
  // Killed by something else (a signal, no timeout of ours).
  assert.deepEqual(await check(CODEX, '/bin/codex', run(Object.assign(new Error('killed'), { killed: false, code: null, signal: 'SIGKILL' }))), { answer: undefined, whys: ['unreadable'] })
  // It ran, and said something this does not read.
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(null, 'Logged in')), { answer: undefined, whys: ['unreadable'] })
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(null, JSON.stringify({ loggedIn: 'yes' }))), { answer: undefined, whys: ['unreadable'] })
  assert.deepEqual(await check(CODEX, '/bin/codex', run(exit(2))), { answer: undefined, whys: ['unreadable'] })
  // The runner itself throws.
  assert.deepEqual(await check(CODEX, '/bin/codex', () => { throw new Error('no spawn') }), { answer: undefined, whys: ['unreadable'] })
  // A reader that throws.
  const odd = { ...CODEX, signIn: { args: ['login', 'status'], read: () => { throw new Error('bad reader') } } }
  assert.deepEqual(await check(odd, '/bin/codex', run(null, '')), { answer: undefined, whys: ['unreadable'] })
})

test('#971: an answer that tells, and a check that never ran, give no reason', async () => {
  assert.deepEqual(await check(CODEX, '/bin/codex', run(null)), { answer: true, whys: [] })
  assert.deepEqual(await check(CODEX, '/bin/codex', run(exit(1))), { answer: false, whys: [] })
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(null, JSON.stringify({ loggedIn: true }))), { answer: true, whys: [] })
  assert.deepEqual(await check(CLAUDE, '/bin/claude', run(exit(1), JSON.stringify({ loggedIn: false }))), { answer: false, whys: [] })
  // Nothing to check: no CLI, or an agent with no status command.
  const never = () => assert.fail('nothing is run')
  assert.deepEqual(await check(CODEX, undefined, never), { answer: undefined, whys: [] })
  assert.deepEqual(await check({ ...CODEX, signIn: undefined }, '/bin/codex', never), { answer: undefined, whys: [] })
})

test('#971: a reason nobody listens for, or a listener that throws, changes no answer', async () => {
  assert.equal(await signedInOf(CODEX, '/bin/codex', { env: ENV, run: run(timedOut()) }), undefined)
  assert.equal(await signedInOf(CODEX, '/bin/codex', { env: ENV, run: run(timedOut()), onUnknown: () => { throw new Error('listener') } }), undefined)
  assert.equal(await signedInOf(CODEX, '/bin/codex', { env: ENV, run: run(null), onUnknown: () => { throw new Error('listener') } }), true)
})

// --- the status row -----------------------------------------------------------------------------

// The plugin with Claude and Codex found and installed; `checks` is what each CLI's next
// sign-in check answers: true, false, undefined (cannot tell, says nothing), or a reason.
function plugin(checks, checker, deps = {}) {
  const services = {}
  const cleanups = []
  const registered = {}
  const found = { claude: '/bin/claude', codex: '/bin/codex' }
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    llm: {
      registerAdapter(_providers, adapter) { registered.adapter = adapter; const handle = () => {}; handle.replace = () => {}; return handle },
      listProviders: () => [],
      listModels: () => new Promise(() => {}),
    },
    agents: { get: () => undefined },
    get: () => undefined,
    provide: (name, value) => { services[name] = value },
    on: () => {},
    effect: (setup) => { cleanups.push(setup()) },
    emit: () => {},
  }
  const store = {
    binOf: () => ({ path: '/x/dist/index.js', version: '1.0.0' }),
    busy: () => false,
    lastError: () => undefined,
    lastFailure: () => undefined,
    update: async () => {},
    dispose: () => {},
  }
  const signedIn = checker ?? (async (spec, _cli, { onUnknown } = {}) => {
    const answer = checks[spec.key]
    if (typeof answer === 'string') { onUnknown?.(answer); return undefined }
    return answer
  })
  const flag = value => ({ get: () => value })
  apply(ctx, { claude: flag(true), codex: flag(true) }, { store, find: name => found[name], signedIn, ...deps })
  const service = services[SERVICE]
  const row = async id => (await service.status()).agents.find(agent => agent.id === id)
  return { service, row, found, registered, stop: () => { for (const cleanup of cleanups) cleanup?.() } }
}

test('#971: before any check the row has neither field; after one that could not tell it says why', async (t) => {
  const checks = { claude: 'timeout', codex: 'unreadable' }
  const h = plugin(checks)
  t.after(h.stop)
  // No check has run: `status()` spawns nothing.
  for (const id of ['acp-claude', 'acp-codex']) {
    const row = await h.row(id)
    assert.equal('signedIn' in row, false)
    assert.equal('signInCheck' in row, false)
  }
  const status = await h.service.refresh()
  const claude = status.agents.find(agent => agent.id === 'acp-claude')
  const codex = status.agents.find(agent => agent.id === 'acp-codex')
  assert.equal('signedIn' in claude, false)
  assert.equal(claude.signInCheck, 'timeout')
  assert.equal('signedIn' in codex, false)
  assert.equal(codex.signInCheck, 'unreadable')
  // `inspect` answers the same row.
  assert.equal((await h.service.inspect('acp-claude')).signInCheck, 'timeout')
})

test('#971: the reason goes when the sign-in is known, and when the CLI changes', async (t) => {
  const checks = { claude: 'timeout', codex: 'timeout' }
  const h = plugin(checks)
  t.after(h.stop)
  await h.service.refresh()
  assert.equal((await h.row('acp-claude')).signInCheck, 'timeout')
  // The next check tells: the answer is there and the reason is not.
  checks.claude = false
  await h.service.refresh()
  let row = await h.row('acp-claude')
  assert.equal(row.signedIn, false)
  assert.equal('signInCheck' in row, false)
  checks.claude = true
  await h.service.refresh()
  row = await h.row('acp-claude')
  assert.equal(row.signedIn, true)
  assert.equal('signInCheck' in row, false)
  // Unknown again, this time with nothing said: no stale reason comes back.
  checks.claude = undefined
  await h.service.refresh()
  row = await h.row('acp-claude')
  assert.equal('signedIn' in row, false)
  assert.equal('signInCheck' in row, false)
  // Another CLI at another path: what was said of the old one is gone before any new check.
  assert.equal((await h.row('acp-codex')).signInCheck, 'timeout')
  h.found.codex = '/other/codex'
  // `retry` looks for the CLIs again and checks no sign-in.
  row = (await h.service.retry('acp-codex')).agents.find(agent => agent.id === 'acp-codex')
  assert.equal('signedIn' in row, false)
  assert.equal('signInCheck' in row, false)
})

test('#971: a sign-in that became known another way carries no reason of an older check', async (t) => {
  const h = plugin({ claude: 'timeout', codex: true })
  t.after(h.stop)
  await h.service.refresh()
  assert.equal((await h.row('acp-claude')).signInCheck, 'timeout')
  // The agent itself said it is signed out (ACP auth_required), with no check of the CLI.
  h.registered.adapter.signedOut('acp-claude')
  const row = await h.row('acp-claude')
  assert.equal(row.signedIn, false)
  assert.equal('signInCheck' in row, false)
})

test('#971: a sign-in made through the app carries no reason of an older check', async (t) => {
  const checks = { claude: 'timeout', codex: true }
  const h = plugin(checks)
  t.after(h.stop)
  await h.service.refresh()
  assert.equal((await h.row('acp-claude')).signInCheck, 'timeout')
  // The attempt finds the CLI signed in: `onReady` records it without a status-row check.
  checks.claude = true
  const attempt = await h.service.loginStart('acp-claude')
  assert.equal(typeof attempt.attemptId, 'string')
  let row
  for (let turn = 0; turn < 50 && (row = await h.row('acp-claude')).signedIn !== true; turn += 1) await new Promise(resolve => setImmediate(resolve))
  assert.equal(row.signedIn, true)
  assert.equal('signInCheck' in row, false)
  // Signed out again by the agent's own word, then unknown with nothing said: still no old reason.
  h.registered.adapter.signedOut('acp-claude')
  checks.claude = undefined
  await h.service.refresh()
  row = await h.row('acp-claude')
  assert.equal('signedIn' in row, false)
  assert.equal('signInCheck' in row, false)
})

test('#971: a check of a CLI that was replaced meanwhile says nothing of the new one', async (t) => {
  // The checker answers when the row lets it: the old CLI's check is still out when the CLI changes.
  const pending = []
  const h = plugin({}, (spec, cli, { onUnknown } = {}) => new Promise((resolve) => { pending.push({ key: spec.key, cli, onUnknown, resolve }) }))
  t.after(h.stop)
  const refreshing = h.service.refresh()
  await new Promise(resolve => setImmediate(resolve))
  const old = pending.find(check => check.key === 'codex')
  assert.equal(old.cli, '/bin/codex')
  h.found.codex = '/other/codex'
  await h.service.retry('acp-codex')
  // Now the old check times out.
  for (const check of pending.splice(0)) { check.onUnknown('timeout'); check.resolve(undefined) }
  await refreshing
  const row = await h.row('acp-codex')
  assert.equal('signedIn' in row, false)
  assert.equal('signInCheck' in row, false, 'the reason of the old CLI is not said of the new one')
})

test('#971: of two checks of one CLI, the one that ends last is what the row says, as for the sign-in itself', async (t) => {
  const pending = []
  const h = plugin({}, (spec, cli, { onUnknown } = {}) => new Promise((resolve) => { pending.push({ key: spec.key, onUnknown, resolve }) }))
  t.after(h.stop)
  const first = h.service.refresh()
  await new Promise(resolve => setImmediate(resolve))
  const second = h.service.refresh()
  await new Promise(resolve => setImmediate(resolve))
  const [early, late] = pending.filter(check => check.key === 'claude')
  assert.ok(early && late, 'two checks of the same CLI are out')
  // The later check tells first; the earlier one times out after it.
  late.resolve(false)
  for (const check of pending.filter(other => other !== early && other !== late)) check.resolve(true)
  await second
  assert.equal((await h.row('acp-claude')).signedIn, false)
  early.onUnknown('timeout')
  early.resolve(undefined)
  await first
  const row = await h.row('acp-claude')
  // The order `signIns` has always had: the last check to end is the answer, and its reason with it.
  assert.equal('signedIn' in row, false)
  assert.equal(row.signInCheck, 'timeout')
})

test('#971: while a signed-in answer waits for its account to be read, the row still says what it said', async (t) => {
  // With the account consent on, a first "signed in" is shown only once the account is read.
  const dir = mkdtempSync(join(tmpdir(), 'acp-sign-in-check-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const checks = { claude: 'timeout', codex: false }
  const reads = []
  const account = spec => new Promise((resolve) => { reads.push({ key: spec.key, resolve }) })
  const h = plugin(checks, undefined, { consentFile: join(dir, 'consent.json'), account })
  t.after(h.stop)
  await h.service.refresh()
  assert.equal((await h.row('acp-claude')).signInCheck, 'timeout')
  // The next check says signed in; who it is has not been read yet.
  checks.claude = true
  const refreshing = h.service.refresh()
  for (let turn = 0; turn < 50 && reads.length === 0; turn += 1) await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads.length, 1, 'the account is being read')
  let row = await h.row('acp-claude')
  assert.equal('signedIn' in row, false, 'not shown as signed in before its account is read')
  assert.equal(row.signInCheck, 'timeout', 'and the reason it had is not lost meanwhile')
  reads[0].resolve({ kind: 'account', email: 'someone@example.com' })
  await refreshing
  row = await h.row('acp-claude')
  assert.equal(row.signedIn, true)
  assert.equal('signInCheck' in row, false)
  assert.equal(JSON.stringify(row).includes('example.com'), false)
})

test('#971: only the two reasons reach a row', async (t) => {
  const checks = { claude: 'someone@example.com', codex: 'TIMEOUT' }
  const h = plugin(checks)
  t.after(h.stop)
  const status = await h.service.refresh()
  for (const agent of status.agents.filter(agent => agent.id === 'acp-claude' || agent.id === 'acp-codex')) {
    assert.equal('signInCheck' in agent, false, agent.id)
    assert.equal(JSON.stringify(agent).includes('example.com'), false)
  }
})
