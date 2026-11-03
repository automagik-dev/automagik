// Delivery 3's plumbing without the network: the CLI search, the background adapter install
// (fake registry, fake package manager), the routes only for CLIs that are here, and full access.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { apply } from '../index.js'
import { AGENTS, findCommand } from '../src/host/agents.js'
import { AdapterStore, CHECK_EVERY_MS } from '../src/host/install.js'
import { fullAccess, levelOf } from '../src/host/tool.js'

const scratch = () => mkdtempSync(join(tmpdir(), 'acp-dsh-install-'))
const tool = (dir, name) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), '#!/bin/sh\n', { mode: 0o755 })
  chmodSync(join(dir, name), 0o755)
  return join(dir, name)
}
// A package manager that "installs" whatever package.json asks for: one entry script per dep.
const fakeInstall = calls => async (dir) => {
  calls.push(dir)
  const { dependencies } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const [pkg, version] of Object.entries(dependencies)) {
    const root = join(dir, 'node_modules', ...pkg.split('/'))
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'index.js'), `// ${pkg}@${version}\n`)
  }
}

test('a CLI is found on PATH, or where its installer puts it when PATH is short', () => {
  const home = scratch()
  try {
    const onPath = tool(join(home, 'bin'), 'codex')
    const local = tool(join(home, '.local', 'bin'), 'claude')
    writeFileSync(join(home, 'bin', 'gemini'), 'not executable', { mode: 0o644 })
    const env = { PATH: join(home, 'bin') }
    assert.equal(findCommand('codex', { env, home }), onPath)
    assert.equal(findCommand('claude', { env, home }), local)
    assert.equal(findCommand('gemini', { env: { PATH: join(home, 'bin') }, home }), undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an adapter installs at its newest release into a folder of its own, and moves up when npm does', async () => {
  const home = scratch()
  try {
    let version = '1.0.0'
    let now = 1_000
    const calls = []
    const store = new AdapterStore({ home, latest: async () => version, install: fakeInstall(calls), now: () => now })
    const { adapter, bin } = AGENTS['acp-claude']
    assert.equal(store.binOf(adapter, bin), undefined)
    const first = await store.update(adapter, bin)
    assert.equal(first.version, '1.0.0')
    assert.ok(first.path.endsWith(join('1.0.0', 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist', 'index.js')))
    // Checked within a day: nothing asked, nothing installed.
    version = '1.1.0'
    await store.update(adapter, bin)
    assert.equal(calls.length, 1)
    // A day later: the newer release, and the old one kept for a Session that still runs it.
    now += CHECK_EVERY_MS + 1
    assert.equal((await store.update(adapter, bin)).version, '1.1.0')
    assert.equal(store.binOf(adapter, bin).version, '1.1.0')
    version = '1.2.0'
    now += CHECK_EVERY_MS + 1
    await store.update(adapter, bin)
    const folder = join(home, 'agentclientprotocol__claude-agent-acp')
    assert.deepEqual(readdirSync(folder).filter(name => !name.endsWith('.json')).sort(), ['1.1.0', '1.2.0'])
    // Two asks at once share one install.
    version = '1.3.0'
    now += CHECK_EVERY_MS + 1
    const before = calls.length
    await Promise.all([store.update(adapter, bin), store.update(adapter, bin)])
    assert.equal(calls.length, before + 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a failed install leaves the working adapter in place and no half-installed folder', async () => {
  const home = scratch()
  try {
    let fail = false
    let now = 0
    const calls = []
    const good = fakeInstall(calls)
    const store = new AdapterStore({ home, latest: async () => (fail ? '2.0.0' : '1.0.0'), install: async (dir, ...rest) => { if (fail) { writeFileSync(join(dir, 'partial'), 'x'); throw new Error('network gone') } return good(dir, ...rest) }, now: () => now })
    const { adapter, bin } = AGENTS['acp-codex']
    await store.update(adapter, bin)
    fail = true
    now += CHECK_EVERY_MS + 1
    await assert.rejects(store.update(adapter, bin), /network gone/)
    assert.equal(store.binOf(adapter, bin).version, '1.0.0')
    const folder = join(home, 'agentclientprotocol__codex-acp')
    assert.deepEqual(readdirSync(folder).sort(), ['1.0.0', 'current.json'])
    assert.ok(existsSync(store.binOf(adapter, bin).path))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('routes are offered only for CLIs that are here; before its adapter is in, a turn says so', async (t) => {
  const home = scratch()
  const path = process.env.PATH
  t.after(() => { process.env.PATH = path; rmSync(home, { recursive: true, force: true }) })
  // Only a claude CLI on PATH (the search adds the usual folders, so codex may be found there too).
  process.env.PATH = join(home, 'bin')
  tool(join(home, 'bin'), 'claude')
  const registered = []
  const updates = []
  const store = { binOf: () => undefined, update: async (pkg) => { updates.push(pkg) } }
  const ctx = { llm: { registerAdapter: (providers, adapter) => registered.push({ providers, adapter }) }, agents: { get: () => undefined }, get: () => undefined, on: () => {} }
  apply(ctx, { codex: false }, { store })
  assert.deepEqual(registered[0].providers, ['acp-claude'])
  assert.deepEqual(await registered[0].adapter.listModels('acp-claude'), [{ provider: 'acp-claude', id: 'default', name: 'Claude Code' }])
  const chunks = []
  for await (const chunk of registered[0].adapter.stream(markAgentLoopRequest({ provider: 'acp-claude', model: 'default', sessionId: 's1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.match(chunks.at(-1).reason.failure.message, /still being installed/)
  assert.deepEqual(updates, ['@agentclientprotocol/claude-agent-acp'])
  // Turned off in the settings: not offered even with the CLI here.
  const none = []
  apply({ ...ctx, llm: { registerAdapter: providers => none.push(providers) } }, { claude: false, codex: false }, { store })
  assert.deepEqual(none, [])
})

test('full access lets the agent through; any other level asks', () => {
  const session = mode => ({ snapshotEvents: () => [{ type: 'sandbox/mode', data: { mode: 'workspace-write' } }, { type: 'sandbox/mode', data: { mode } }] })
  const policy = value => ({ effectivePolicy: () => value })
  assert.equal(fullAccess(policy('never'), session('danger-full-access')), true)
  assert.equal(fullAccess(policy('never'), session('workspace-write')), false)
  assert.equal(fullAccess(policy('ask'), session('danger-full-access')), false)
  assert.equal(fullAccess({}, session('danger-full-access')), false)
  assert.equal(fullAccess(policy('never'), {}), false)
})

test("a command's streamed output is the card's output, and the question's title never renames the call", async () => {
  const { AgentRun } = await import('../src/host/acp.js')
  const run = new AgentRun({ name: 'probe', cwd: '/' })
  await run.onUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'curl https://example.com', kind: 'execute', status: 'pending' })
  const answer = run.onPermission({ toolCall: { toolCallId: 'c1', title: 'Run command?' }, options: [] })
  const tool = run.tools.get('c1')
  assert.equal(tool.title, 'curl https://example.com')
  assert.equal(tool.permission.title, 'Run command?')
  tool.permission.answer({ outcome: { outcome: 'cancelled' } })
  assert.deepEqual(await answer, { outcome: { outcome: 'cancelled' } })
  await run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', _meta: { terminal_output: { data: 'acp-', terminal_id: 'c1' } } })
  await run.onUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', _meta: { terminal_output: { data: 'ok\n', terminal_id: 'c1' } } })
  assert.equal(tool.output, 'acp-ok\n')
})

test("DSH's level becomes each agent's own mode: Manual, Auto, full access", () => {
  const level = (policy, sandbox) => levelOf({ effectivePolicy: () => policy }, { snapshotEvents: () => [{ type: 'sandbox/mode', data: { mode: sandbox } }] })
  const claude = AGENTS['acp-claude'].modeFor
  const codex = AGENTS['acp-codex'].modeFor
  assert.equal(claude(level('ask', 'workspace-write')), 'default')
  assert.equal(claude(level('never', 'workspace-write')), 'auto')
  assert.equal(claude(level('never', 'danger-full-access')), 'bypassPermissions')
  assert.equal(codex(level('ask', 'read-only')), 'read-only')
  assert.equal(codex(level('ask', 'workspace-write')), 'workspace-write')
  assert.equal(codex(level('never', 'workspace-write')), 'agent')
  assert.equal(codex(level('never', 'danger-full-access')), 'agent-full-access')
})
