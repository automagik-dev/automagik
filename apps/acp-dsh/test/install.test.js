// Delivery 3's plumbing without the network: the CLI search, the background adapter install
// (fake registry, fake package manager), the routes only for CLIs that are here, and full access.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { apply, nodeCommand } from '../index.js'
import { AGENTS, findCommand } from '../src/host/agents.js'
import { AdapterStore, CHECK_EVERY_MS, defaultInstall, INSTALL_TIMEOUT_MS, platformPackages } from '../src/host/install.js'
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
  let installed
  let failed
  const store = { binOf: () => installed, update: async (pkg) => { updates.push(pkg) }, lastError: () => failed }
  const ctx = { llm: { registerAdapter: (providers, adapter) => registered.push({ providers, adapter }) }, agents: { get: () => undefined }, get: () => undefined, on: () => {} }
  apply(ctx, { codex: false }, { store })
  assert.deepEqual(registered[0].providers, ['acp-claude'])
  // No model until the adapter is installed: nothing (a picker, a Bot) can pick it before it can answer.
  assert.deepEqual(await registered[0].adapter.listModels('acp-claude'), [])
  const turn = async () => {
    const chunks = []
    for await (const chunk of registered[0].adapter.stream(markAgentLoopRequest({ provider: 'acp-claude', model: 'default', sessionId: 's1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))) chunks.push(chunk)
    return chunks.at(-1).reason
  }
  // A Session already on it says the adapter is being installed, and why the last install failed.
  let reason = await turn()
  assert.equal(reason.kind, 'error')
  assert.match(reason.failure.message, /still being installed; send this again/)
  failed = 'npm answered 503'
  reason = await turn()
  assert.match(reason.failure.message, /still being installed; the last install failed: npm answered 503/)
  assert.deepEqual(updates, ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/claude-agent-acp'])
  installed = { path: join(home, 'index.js'), version: '1.0.0' }
  // An adapter that cannot answer (this one is no script) leaves the usual models standing in.
  assert.deepEqual((await registered[0].adapter.listModels('acp-claude')).map(model => model.id), ['default', 'opus', 'sonnet', 'haiku'])
  assert.deepEqual((await registered[0].adapter.resolveModel('acp-claude', 'sonnet')).reasoning.efforts.map(effort => effort.id), ['low', 'medium', 'high'])
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
  assert.deepEqual(claude(level('ask', 'workspace-write')), ['default'])
  assert.deepEqual(claude(level('never', 'workspace-write')), ['auto', 'default'])
  assert.deepEqual(claude(level('never', 'danger-full-access')), ['bypassPermissions', 'default'])
  assert.deepEqual(codex(level('ask', 'read-only')), ['read-only'])
  assert.deepEqual(codex(level('ask', 'workspace-write')), ['workspace-write'])
  assert.deepEqual(codex(level('never', 'workspace-write')), ['agent', 'workspace-write'])
  assert.deepEqual(codex(level('never', 'danger-full-access')), ['agent-full-access', 'workspace-write'])
})

test("the Session's sandbox is the one DSH's sandbox-policy service resolves, deployment default included", () => {
  const ask = { effectivePolicy: () => 'ask' }
  const never = { effectivePolicy: () => 'never' }
  const noRows = { snapshotEvents: () => [] }
  // DSH_PERMISSION_MODE=read-only and no row in the Session: Codex gets read-only, not workspace-write.
  const readOnly = { resolve: () => ({ mode: 'read-only' }) }
  assert.deepEqual(AGENTS['acp-codex'].modeFor(levelOf(ask, noRows, readOnly)), ['read-only'])
  // A full-access deployment under the never policy is full access.
  assert.equal(fullAccess(never, noRows, { resolve: () => ({ mode: 'danger-full-access' }) }), true)
  // Without the service, the Session's own last row.
  assert.equal(levelOf(ask, { snapshotEvents: () => [{ type: 'sandbox/mode', data: { mode: 'read-only' } }] }).sandbox, 'read-only')
})

test("a missing strict mode fails the turn; a missing permissive one falls back to the strict one", async () => {
  const { AgentRun } = await import('../src/host/acp.js')
  const runWith = (ids, current) => {
    const run = new AgentRun({ name: 'probe', cwd: '/' })
    const set = []
    run.conn = { setSessionMode: async ({ modeId }) => { set.push(modeId) } }
    run.gone = new Promise(() => {})
    run.modes = ids === undefined ? undefined : { currentModeId: current, availableModes: ids.map(id => ({ id, name: id })) }
    return { run, set }
  }
  // Claude renamed `default`: the turn fails instead of keeping the person's `auto`.
  let probe = runWith(['auto', 'acceptEdits', 'plan'], 'auto')
  await assert.rejects(probe.run.setMode(['default']), /offers none of the modes default/)
  assert.deepEqual(probe.set, [])
  // No modes reported at all: the same.
  probe = runWith(undefined)
  await assert.rejects(probe.run.setMode(['workspace-write']), /no modes/)
  // bypassPermissions not offered (root, or settings that disable it): `default`, never the agent's own.
  probe = runWith(['default', 'auto', 'plan'], 'auto')
  await probe.run.setMode(['bypassPermissions', 'default'])
  assert.deepEqual(probe.set, ['default'])
  assert.equal(probe.run.modes.currentModeId, 'default')
  // Already there: nothing sent.
  await probe.run.setMode(['default'])
  assert.deepEqual(probe.set, ['default'])
})

test("the adapter runs on DSH's own Node, never another node on PATH", () => {
  assert.equal(nodeCommand().command, process.execPath)
})

// A package manager script that says which one ran (in ../used) and "installs" the adapter's entry script.
const fakeManager = (dir, name, label) => {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  const entry = 'node_modules/@agentclientprotocol/claude-agent-acp/dist'
  writeFileSync(file, `#!/bin/sh\necho ${label} "$@" > "$PWD/../used"\n/bin/mkdir -p ${entry} && echo > ${entry}/index.js\n`, { mode: 0o755 })
  chmodSync(file, 0o755)
  return file
}

test("adapters install with the desktop app's pnpm, never the person's; else npm", async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-claude']
  fakeManager(join(home, 'person'), 'pnpm', 'person-pnpm')
  fakeManager(join(home, 'person'), 'npm', 'person-npm')
  const app = fakeManager(join(home, 'app'), 'pnpm', 'app-pnpm')
  const install = async (name, env) => {
    const dir = join(home, name, 'pkg')
    mkdirSync(dir, { recursive: true })
    await defaultInstall(dir, adapter, '1.0.0', env)
    assert.ok(existsSync(join(dir, 'node_modules', ...adapter.split('/'), bin)))
    return readFileSync(join(home, name, 'used'), 'utf8')
  }
  // The person's pnpm (pnpm 12 pulls in the bundled CLIs) comes first on PATH; the app's is AUTOMAGIK_PNPM.
  assert.match(await install('one', { PATH: join(home, 'person'), AUTOMAGIK_PNPM: app }), /^app-pnpm install --prod --ignore-scripts/)
  // Without the app's pnpm (a DSH the person runs): npm, never the person's pnpm.
  assert.match(await install('two', { PATH: join(home, 'person') }), /^person-npm install --omit=optional/)
  assert.match(await install('three', { PATH: join(home, 'person'), AUTOMAGIK_PNPM: join(home, 'missing', 'pnpm') }), /^person-npm install/)
})

test('an install that pulls in a bundled CLI is refused, and the working adapter stays', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-codex']
  let version = '1.0.0'
  let now = 1_000
  let extra = []
  const install = async (dir, ...rest) => {
    await fakeInstall([])(dir, ...rest)
    for (const pkg of extra) mkdirSync(join(dir, 'node_modules', ...pkg.split('/')), { recursive: true })
  }
  const store = new AdapterStore({ home, latest: async () => version, install, now: () => now })
  // @openai/codex (no platform in its name) is a launcher codex-acp depends on: allowed.
  extra = ['@openai/codex', '@anthropic-ai/claude-agent-sdk']
  assert.equal((await store.update(adapter, bin)).version, '1.0.0')
  version = '2.0.0'
  now += CHECK_EVERY_MS + 1
  extra = ['@openai/codex', '@openai/codex-darwin-arm64']
  await assert.rejects(store.update(adapter, bin), /installed the CLIs it bundles \(@openai\/codex-darwin-arm64\); refused/)
  assert.equal(store.binOf(adapter, bin).version, '1.0.0')
  assert.match(store.lastError(adapter), /refused/)
  const folder = join(home, 'agentclientprotocol__codex-acp')
  assert.deepEqual(readdirSync(folder).sort(), ['1.0.0', 'current.json'])
  // Nested and pnpm-store spellings are found too.
  const tree = join(home, 'tree')
  mkdirSync(join(tree, 'node_modules', 'a', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64-musl'), { recursive: true })
  mkdirSync(join(tree, 'node_modules', '.pnpm', '@openai+codex-win32-x64@0.1.0'), { recursive: true })
  assert.deepEqual(platformPackages(tree).sort(), ['@anthropic-ai/claude-agent-sdk-linux-x64-musl', '@openai+codex-win32-x64@0.1.0'])
  // A later install that works clears the last error.
  extra = []
  await store.update(adapter, bin)
  assert.equal(store.lastError(adapter), undefined)
})

test('a half-done install DSH quit in the middle of is dropped once stale; a running one stays', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-claude']
  const folder = join(home, 'agentclientprotocol__claude-agent-acp')
  const stale = join(folder, '.install-1-1')
  const running = join(folder, '.install-2-2')
  mkdirSync(stale, { recursive: true })
  mkdirSync(running, { recursive: true })
  const old = (Date.now() - INSTALL_TIMEOUT_MS - 60_000) / 1000
  utimesSync(stale, old, old)
  const store = new AdapterStore({ home, latest: async () => '1.0.0', install: fakeInstall([]) })
  await store.update(adapter, bin)
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(running), true)
})
