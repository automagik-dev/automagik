// The connector's self-update with a way back (#958, the owner's addition): a new adapter
// release must start before it replaces the one in use, the one in use is the last-known-good,
// and a release that fails its start check, or its first session start, is rolled back and
// reported. No network and no real adapter: npm's answers and the installs are given.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { AcpAdapter } from '../src/host/adapter.js'
import { AGENTS } from '../src/host/agents.js'
import { Catalog } from '../src/host/catalog.js'
import { HANDSHAKE_TIMEOUT_MS, handshake } from '../src/host/handshake.js'
import { AdapterStore, BAD_TTL_MS, CHECK_EVERY_MS, CHECK_TICK_MS } from '../src/host/install.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const { adapter: PKG, bin: BIN } = AGENTS['acp-claude']
const FOLDER = 'agentclientprotocol__claude-agent-acp'

function scratch(t) {
  const home = mkdtempSync(join(tmpdir(), 'acp-rollback-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
const fakeInstall = calls => async (dir) => {
  const { dependencies } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const [pkg, version] of Object.entries(dependencies)) {
    calls.push(version)
    const root = join(dir, 'node_modules', ...pkg.split('/'))
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'index.js'), `// ${pkg}@${version}\n`)
  }
}
const current = home => JSON.parse(readFileSync(join(home, FOLDER, 'current.json'), 'utf8'))
const versionsOn = home => readdirSync(join(home, FOLDER)).filter(name => !name.endsWith('.json')).sort()

// A store whose clock, npm answer and start check the test moves.
function storeOf(t, { bad = new Set() } = {}) {
  const home = scratch(t)
  const world = { home, version: '1.0.0', now: 1_000, installs: [], checked: [], logs: [], bad }
  world.store = new AdapterStore({
    home,
    latest: async () => world.version,
    install: fakeInstall(world.installs),
    now: () => world.now,
    log: message => world.logs.push(message),
    check: async (pkg, staged) => {
      world.checked.push(staged.version)
      assert.ok(existsSync(staged.path), 'the staged adapter is on disk when it is checked')
      if (world.bad.has(staged.version)) throw new Error(`it exited (1) before it answered initialize: boom ${staged.version}`)
    },
  })
  world.nextCheck = () => { world.now += CHECK_EVERY_MS + 1 }
  return world
}

test('npm is asked at least once a day: the timer ticks well inside the freshness window', () => {
  assert.ok(CHECK_EVERY_MS + CHECK_TICK_MS <= 24 * 60 * 60 * 1000, 'a check is never more than a day after the last')
  assert.ok(CHECK_TICK_MS < CHECK_EVERY_MS)
})

test('a new release that fails its start check never replaces the one in use, and is reported', async (t) => {
  const world = storeOf(t)
  const { store } = world
  assert.equal((await store.update(PKG, BIN)).version, '1.0.0')
  store.markGood(PKG)
  world.version = '1.1.0'
  world.bad.add('1.1.0')
  world.nextCheck()
  // The update is not a failure: the adapter in use is what it answers with.
  assert.equal((await store.update(PKG, BIN)).version, '1.0.0')
  assert.equal(store.binOf(PKG, BIN).version, '1.0.0')
  assert.deepEqual(versionsOn(world.home), ['1.0.0'], 'the failed release is not kept, and no half-done folder')
  const state = store.stateOf(PKG)
  assert.equal(state.version, '1.0.0')
  assert.deepEqual({ from: state.rolledBack.from, to: state.rolledBack.to }, { from: '1.1.0', to: '1.0.0' })
  assert.match(state.rolledBack.reason, /boom 1\.1\.0/)
  assert.equal(state.bad.version, '1.1.0')
  assert.ok(world.logs.some(line => /1\.1\.0 failed its start check .* staying on 1\.0\.0/.test(line)))
  assert.equal(store.lastFailure(PKG), undefined, 'the connector is not shown as failed: it works')

  // The same release is left alone while it is held back...
  world.nextCheck()
  await store.update(PKG, BIN)
  assert.deepEqual(world.installs, ['1.0.0', '1.1.0'])
  assert.equal(store.stateOf(PKG).rolledBack.from, '1.1.0')
  // ...a newer one is tried at once...
  world.version = '1.1.1'
  world.nextCheck()
  assert.equal((await store.update(PKG, BIN)).version, '1.1.1')
  assert.equal(store.stateOf(PKG).rolledBack, undefined, 'the rollback is over once a release took its place')
  assert.equal(store.stateOf(PKG).previous, '1.0.0')
})

test('a held-back release is tried again once its hold runs out', async (t) => {
  const world = storeOf(t)
  const { store } = world
  await store.update(PKG, BIN)
  world.version = '2.0.0'
  world.bad.add('2.0.0')
  world.nextCheck()
  await store.update(PKG, BIN)
  world.now += BAD_TTL_MS + 1
  world.bad.clear()
  assert.equal((await store.update(PKG, BIN)).version, '2.0.0')
  assert.deepEqual(world.checked, ['1.0.0', '2.0.0', '2.0.0'])
  assert.equal(store.stateOf(PKG).bad, undefined)
})

test('a first install has no last-known-good: it is promoted even when its check fails', async (t) => {
  const world = storeOf(t, { bad: new Set(['1.0.0']) })
  assert.equal((await world.store.update(PKG, BIN)).version, '1.0.0')
  assert.equal(world.store.stateOf(PKG).proven, false)
  assert.ok(world.logs.some(line => /installed anyway/.test(line)))
})

test('the release before stays on disk until the new one has opened a session', async (t) => {
  const world = storeOf(t)
  const { store } = world
  await store.update(PKG, BIN)
  store.markGood(PKG)
  world.version = '1.1.0'
  world.nextCheck()
  await store.update(PKG, BIN)
  assert.equal(current(world.home).proven, false)
  // A day later nothing changed on npm: the previous release is still the way back.
  world.nextCheck()
  await store.update(PKG, BIN)
  assert.deepEqual(versionsOn(world.home), ['1.0.0', '1.1.0'])
  assert.equal(store.stateOf(PKG).previous, '1.0.0')
  // It opened a session: it is the last-known-good, and the one before it can go.
  store.markGood(PKG)
  assert.equal(store.stateOf(PKG).proven, true)
  world.nextCheck()
  await store.update(PKG, BIN)
  assert.deepEqual(versionsOn(world.home), ['1.1.0'])
})

test('a release that fails its first session start goes back to the one before it', async (t) => {
  const world = storeOf(t)
  const { store } = world
  await store.update(PKG, BIN)
  store.markGood(PKG)
  assert.equal(store.rollback(PKG, BIN, new Error('x')), undefined, 'a proven release has nothing to go back from')
  world.version = '1.1.0'
  world.nextCheck()
  await store.update(PKG, BIN)
  const back = store.rollback(PKG, BIN, new Error('it exited (1): TypeError in dist/index.js'))
  assert.equal(back.version, '1.0.0')
  assert.equal(store.binOf(PKG, BIN).version, '1.0.0')
  const state = store.stateOf(PKG)
  assert.deepEqual({ from: state.rolledBack.from, to: state.rolledBack.to, proven: state.proven }, { from: '1.1.0', to: '1.0.0', proven: true })
  assert.match(state.rolledBack.reason, /TypeError/)
  assert.equal(store.rollback(PKG, BIN, new Error('again')), undefined, 'one way back, not a loop')
  // The failed release is held back at the next check too.
  world.nextCheck()
  assert.equal((await store.update(PKG, BIN)).version, '1.0.0')
  assert.deepEqual(world.installs, ['1.0.0', '1.1.0'])
})

test('the start check: a real handshake passes; another protocol, an exit and silence fail', async (t) => {
  const node = process.execPath
  assert.deepEqual(await handshake({ command: node, args: [FAKE] }), { protocolVersion: 1 })
  await assert.rejects(handshake({ command: node, args: [FAKE], env: { FAKE_ACP_PROTOCOL: '2' } }), /speaks ACP protocol version 2/)
  const dir = scratch(t)
  const dies = join(dir, 'dies.mjs')
  writeFileSync(dies, 'console.error("cannot find module x"); process.exit(3)\n')
  await assert.rejects(handshake({ command: node, args: [dies] }), /exited \(3\) before it answered initialize: cannot find module x/)
  const silent = join(dir, 'silent.mjs')
  writeFileSync(silent, 'setInterval(() => {}, 1000)\n')
  await assert.rejects(handshake({ command: node, args: [silent] }, { timeoutMs: 300 }), /did not answer initialize within/)
  const stopped = new AbortController()
  stopped.abort()
  await assert.rejects(handshake({ command: node, args: [silent] }, { signal: stopped.signal }), /stopped/)
  assert.ok(HANDSHAKE_TIMEOUT_MS >= 15_000)
})

// One turn on an agent whose newest connector cannot start and whose previous one can.
function turnHost(t, { rollback }) {
  const dir = scratch(t)
  const broken = join(dir, 'broken.mjs')
  writeFileSync(broken, 'console.error("bad release"); process.exit(1)\n')
  const world = { spawned: [], proven: 0, rolled: [], back: false }
  const dshAgent = { session: { id: 's1', header: { cwd: dir } }, ctx: { tools: { register: () => () => {} } } }
  const ctx = { agents: { get: id => (id === 's1' ? dshAgent : undefined) }, get: () => undefined, logger: { warn: message => (world.warned = message) } }
  const agent = {
    name: 'Probe agent',
    catalog: new Catalog({ id: 'acp-probe', name: 'Probe agent', defaultName: 'Probe agent', fallback: [{ id: 'default', name: 'Probe agent' }], key: () => undefined, spawn: () => ({ command: process.execPath, args: [FAKE] }), log: () => {} }),
    spawn: () => {
      const script = world.back ? FAKE : broken
      world.spawned.push(script === FAKE ? 'previous' : 'newest')
      return { command: process.execPath, args: [script] }
    },
    proven: () => { world.proven += 1 },
    rollback: (reason) => {
      world.rolled.push(String(reason?.message))
      world.back = rollback
      return rollback
    },
  }
  const adapter = new AcpAdapter(ctx, new Map([['acp-probe', agent]]), { dshTools: () => false })
  t.after(() => adapter.dispose())
  world.turn = async () => {
    const chunks = []
    for await (const chunk of adapter.stream(markAgentLoopRequest({ provider: 'acp-probe', model: 'default', sessionId: 's1', messages: [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }] }))) chunks.push(chunk)
    return chunks
  }
  return world
}

test('a turn on a connector that does not start goes back and answers on the one before it', async (t) => {
  const world = turnHost(t, { rollback: true })
  const chunks = await world.turn()
  assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1)))
  assert.match(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), /you said "plain"/)
  assert.deepEqual(world.spawned, ['newest', 'previous'])
  assert.equal(world.rolled.length, 1)
  assert.match(world.rolled[0], /exited \(1\)/)
  assert.equal(world.proven, 1, 'the one that opened the session is the last-known-good')
  assert.match(world.warned, /did not start on its newest connector/)
})

test('with nothing to go back to, the turn fails once with the reason, and nothing is marked good', async (t) => {
  const world = turnHost(t, { rollback: false })
  const chunks = await world.turn()
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.match(chunks.at(-1).reason.failure.message, /Probe agent did not start: .*bad release/)
  assert.deepEqual(world.spawned, ['newest'])
  assert.equal(world.proven, 0)
})
