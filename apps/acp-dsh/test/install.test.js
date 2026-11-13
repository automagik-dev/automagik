// Delivery 3's plumbing without the network: the CLI search, the background adapter install
// (fake registry, fake package manager), the routes only for CLIs that are here, and full access.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets'
import { apply, nodeCommand, PROBE_RETRY_MS } from '../index.js'
import { AGENTS, findCommand } from '../src/host/agents.js'
import { AdapterStore, CHECK_EVERY_MS, defaultInstall, INSTALL_TIMEOUT_MS, platformPackages, runInstall } from '../src/host/install.js'
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

test('an install with no package name is refused in words, before npm is asked or a folder made', async () => {
  const home = scratch()
  try {
    const asked = []
    const calls = []
    const store = new AdapterStore({ home, latest: async (pkg) => { asked.push(pkg); return '1.0.0' }, install: fakeInstall(calls) })
    // What a native agent's spec gives for `adapter` (#1110), and the other ways a name is missing.
    assert.equal(AGENTS['acp-hermes'].adapter, undefined)
    for (const missing of [AGENTS['acp-hermes'].adapter, '', null, 7]) {
      for (const run of [() => store.update(missing, 'dist/index.js'), () => store.updateNow(missing, 'dist/index.js', false)]) {
        await assert.rejects(run, (error) => {
          assert.ok(!(error instanceof TypeError), `a TypeError for ${String(missing)}: ${error.message}`)
          assert.match(error.message, /^an adapter install needs a package name, and got /)
          return true
        })
      }
      assert.equal(store.busy(missing), false)
      assert.equal(store.lastFailure(missing), undefined)
    }
    assert.deepEqual(asked, [])
    assert.deepEqual(calls, [])
    assert.deepEqual(readdirSync(home), [])
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
  // A live agent for the Session: this test is about the install message, not a missing agent.
  const agent = { session: { id: 's1' }, ctx: { tools: { register: () => () => {} } } }
  const ctx = { llm: { registerAdapter: (providers, adapter) => registered.push({ providers, adapter }) }, agents: { get: id => (id === 's1' ? agent : undefined) }, get: () => undefined, on: () => {} }
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

// DSH's own presets, from its own objects: the stock catalog as its Config resolves it, and
// Auto's fixed spec through the same specOf a live Auto integration reads. A harness that
// moves a preset moves this fixture; a hand-copied table would stay green against it.
const stockPresets = PermissionPresetService.Config({}).presets
const presetService = Object.assign(Object.create(PermissionPresetService.prototype), { presets: stockPresets, autoAdmit: () => {} })
const PRESET = Object.freeze({
  manual: presetService.resolve('workspace-write'),
  auto: presetService.specOf('auto'),
  full: presetService.resolve('danger-full-access'),
})
// DSH resolves both the identity and the knobs; a real Session logs both. The service read is
// what the review gate itself uses, so the fixture supplies it.
const levelOfPreset = ({ sandbox, approval }, preset) => levelOf(
  { effectivePolicy: () => approval },
  { snapshotEvents: () => [
    { type: 'permission/preset', data: { preset } },
    { type: 'sandbox/mode', data: { mode: sandbox } },
  ] },
  undefined,
  { current: () => preset },
)

test("DSH's Manual preset (workspace-write, ask) stays Manual for every agent", () => {
  const level = levelOfPreset(PRESET.manual, 'workspace-write')
  assert.deepEqual(level, { sandbox: 'workspace-write', policy: 'ask', full: false, auto: false })
  assert.deepEqual(AGENTS['acp-claude'].modeFor(level), ['default'])
  assert.deepEqual(AGENTS['acp-codex'].modeFor(level), ['workspace-write'])
})

test("DSH's Auto preset (danger-full-access, ask) is Auto, not Manual", () => {
  const level = levelOfPreset(PRESET.auto, 'auto')
  assert.deepEqual(level, { sandbox: 'danger-full-access', policy: 'ask', full: false, auto: true })
  assert.deepEqual(AGENTS['acp-claude'].modeFor(level), ['auto', 'default'])
  assert.deepEqual(AGENTS['acp-codex'].modeFor(level), ['agent', 'workspace-write'])
})

test("a custom preset with Auto's knobs is not Auto: the bridge keeps its own ask", () => {
  // dsh-experimental-auto-review gates on identity (`current !== 'auto'`), so this Session has
  // no reviewer; the bridge must not skip its approval.
  const level = levelOfPreset(PRESET.auto, 'custom')
  assert.deepEqual(level,
    { sandbox: 'danger-full-access', policy: 'ask', full: false, auto: false })
  const session = { snapshotEvents: () => [
    { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
  ] }
  const ask = { effectivePolicy: () => 'ask' }
  assert.equal(fullAccess(ask, session, undefined, { current: () => 'custom' }), false)
  assert.deepEqual(AGENTS['acp-claude'].modeFor(level), ['default'])
})

test("DSH's Full access preset (danger-full-access, never) is full access, not Auto", () => {
  const level = levelOfPreset(PRESET.full, 'danger-full-access')
  assert.deepEqual(level, { sandbox: 'danger-full-access', policy: 'never', full: true, auto: false })
  assert.deepEqual(AGENTS['acp-claude'].modeFor(level), ['bypassPermissions', 'default'])
  assert.deepEqual(AGENTS['acp-codex'].modeFor(level), ['agent-full-access', 'workspace-write'])
})

test("a Session's Auto row beats a delegated child's never policy: not full access, and the call asks", () => {
  const session = { snapshotEvents: () => [{ type: 'sandbox/mode', data: { mode: 'danger-full-access' } }] }
  const never = { effectivePolicy: () => 'never' }
  // dsh-subagent pins a child to `never`; the Session's own row still says Auto.
  const autoRow = { current: () => 'auto' }
  const level = levelOf(never, session, undefined, autoRow)
  assert.deepEqual(level, { sandbox: 'danger-full-access', policy: 'never', full: false, auto: true })
  assert.equal(fullAccess(never, session, undefined, autoRow), false)
  assert.deepEqual(AGENTS['acp-claude'].modeFor(level), ['auto', 'default'])
  assert.deepEqual(AGENTS['acp-codex'].modeFor(level), ['agent', 'workspace-write'])
})

test('an Auto row without the preset service is never Full and never claims Auto', () => {
  // dsh-subagent pins a delegated child to `never`. With no permission-preset service there is
  // no Auto identity and no review gate, so the row may only stop a Full read; claiming Auto
  // would skip the bridge's own approval while nothing reviews the call.
  const auto = { snapshotEvents: () => [
    { type: 'permission/preset', data: { preset: 'auto' } },
    { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
  ] }
  const never = { effectivePolicy: () => 'never' }
  assert.deepEqual(levelOf(never, auto),
    { sandbox: 'danger-full-access', policy: 'never', full: false, auto: false })
  assert.equal(fullAccess(never, auto), false)
  assert.deepEqual(AGENTS['acp-claude'].modeFor(levelOf(never, auto)), ['default'])
  // A service that throws on the read falls back to the same row.
  const throwing = { current: () => { throw new Error('the preset service went away') } }
  assert.equal(fullAccess(never, auto, undefined, throwing), false)
  assert.equal(levelOf(never, auto, undefined, throwing).auto, false)
  // No Auto row and no service: Full access still reads Full, as DSH's own Full preset should.
  const full = { snapshotEvents: () => [
    { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
  ] }
  assert.deepEqual(levelOf(never, full),
    { sandbox: 'danger-full-access', policy: 'never', full: true, auto: false })
  assert.equal(fullAccess(never, full), true)
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

test('a failed install redacts credentials and writes an owner-only log', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-claude']
  const token = ['ghp_', 'a'.repeat(24)].join('')
  const npmToken = ['npm_', 'b'.repeat(24)].join('')
  const user = ['deploy', 'bot'].join('')
  const pass = ['secret', 'pass'].join('')
  const auth = Buffer.from([user, pass].join(':')).toString('base64')
  const url = ['https://', user, ':', pass, '@registry.npmjs.org/pkg'].join('')
  const homeLog = `${homedir()}/.npm/_logs/2026-11-06T00_00_00_000Z-debug-0.log`
  const quotedKey = 'quoted-secret-123456'
  const quotedAuth = 'quoted-auth-secret=='
  const envToken = 'env-token-secret'
  const npmConfig = 'npm-config-secret'
  const nodeToken = 'node-auth-secret'
  const myToken = 'my-npm-secret'
  const jsonToken = 'json-npm-secret'
  const store = new AdapterStore({
    home,
    latest: async () => '1.0.0',
    install: async () => { throw new Error(`npm ERR! 401 token=${token}\nnpm ERR! path ${homeLog}\nnpm ERR! _authToken=${auth}\nnpm ERR! fetch ${url}\nnpm ERR! token ${npmToken}\nnpm ERR! secret ${url}\n{"_authToken": "${quotedKey}"}\n{"//registry.npmjs.org/:_auth": "${quotedAuth}"}\nNPM_TOKEN=${envToken}\nnpm_config__authToken=${npmConfig}\nNODE_AUTH_TOKEN=${nodeToken}\nMY_NPM_TOKEN=${myToken}\n{"NPM_TOKEN": "${jsonToken}"}`) },
  })
  await assert.rejects(store.update(adapter, bin))
  const failure = store.lastFailure(adapter)
  for (const raw of [token, npmToken, auth, pass, homedir(), quotedKey, quotedAuth, envToken, npmConfig, nodeToken, myToken, jsonToken]) {
    assert.ok(!failure.diagnostic.includes(raw), `the diagnostic hides ${raw}`)
    assert.ok(!failure.message.includes(raw), `the short message hides ${raw}`)
    assert.ok(!readFileSync(failure.logPath, 'utf8').includes(raw), `the log hides ${raw}`)
  }
  assert.match(failure.diagnostic, /npm_\[hidden\]/)
  assert.match(failure.diagnostic, /_authToken=\[hidden\]/)
  assert.match(failure.diagnostic, /https:\/\/\[hidden\]@registry\.npmjs\.org/)
  assert.match(failure.diagnostic, /~\/\.npm\/_logs\//)
  assert.match(failure.diagnostic, /_authToken["']?:\s*\[hidden\]/)
  assert.match(failure.diagnostic, /_auth["']?:\s*\[hidden\]/)
  assert.match(failure.diagnostic, /NPM_TOKEN=\[hidden\]/)
  assert.match(failure.diagnostic, /npm_config__authToken=\[hidden\]/)
  assert.match(failure.diagnostic, /NODE_AUTH_TOKEN=\[hidden\]/)
  assert.match(failure.diagnostic, /MY_NPM_TOKEN=\[hidden\]/)
  assert.match(failure.diagnostic, /"NPM_TOKEN": \[hidden\]/)
  const mode = statSync(failure.logPath).mode & 0o777
  assert.equal(mode, 0o600)
  assert.equal(statSync(join(home, 'logs')).mode & 0o777, 0o700)
  // The install path's warn goes through the store's redacted message, never the raw error.
  const warnings = []
  let service
  const ctx = {
    llm: { registerAdapter: () => () => {}, listProviders: () => [] },
    agents: { get: () => undefined },
    get: () => undefined,
    provide: (name, value) => { if (name === 'acpAgents') service = value },
    on: () => {},
    effect: () => {},
    logger: { warn: message => warnings.push(message), info: () => {} },
  }
  apply(ctx, {}, { store, find: name => (name === 'claude' ? '/bin/claude' : undefined), signedIn: async () => undefined })
  await service.retry('acp-claude')
  await new Promise(resolve => setTimeout(resolve, 20))
  const line = warnings.find(message => message.includes('not installed'))
  assert.ok(line, 'the failed install is logged')
  for (const raw of [token, npmToken, auth, pass, homedir(), quotedKey, quotedAuth, envToken, npmConfig, nodeToken, myToken, jsonToken]) {
    assert.ok(!line.includes(raw), `the log line hides ${raw}`)
  }
  assert.match(line, /\[hidden\]/)
})

test('the service gates the Bot team\'s Claude move on a real bridge probe, cached per adapter version', async () => {
  const installed = { path: '/fake/adapter', version: '1.0.0' }
  const tools = [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } }]
  const serviceFor = (config, { bin = installed, mode = 'ok' } = {}) => {
    let service
    let toolsMode = mode
    let toolReads = 0
    const ctx = {
      llm: { registerAdapter: () => () => {}, listProviders: () => [] },
      agents: { get: () => undefined },
      get: (name) => {
        if (name === 'tools') {
          if (toolsMode === 'throw') throw new Error('the tools service is unavailable')
          return toolsMode === 'ok' ? { definitions: () => { toolReads += 1; return tools }, executable: () => tools[0] } : undefined
        }
        if (name === 'approval') return { effectivePolicy: () => 'ask', overrideOf: () => 'never' }
        if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
        if (name === 'agentPresets') return { presetForSession: () => 'standard' }
        return undefined
      },
      provide: (name, value) => { if (name === 'acpAgents') service = value },
      on: () => {},
      effect: () => {},
      logger: { warn: () => {}, info: () => {} },
    }
    apply(ctx, config, { store: { home: undefined, update: async () => {}, binOf: () => bin ?? undefined }, find: () => undefined, signedIn: async () => undefined })
    return { service, toolReads: () => toolReads, setMode: next => { toolsMode = next } }
  }
  // On is the default: an absent dshTools still probes and the bridge answers initialize +
  // tools/list for a minted credential.
  assert.deepEqual(await serviceFor({}).service.bridge(), { on: true, probesPass: true })
  // False is the kill switch: the 2026-11-03 behaviour, and the bridge is never spawned.
  assert.deepEqual(await serviceFor({ dshTools: false }).service.bridge(),
    { on: false, probesPass: false })
  const on = serviceFor({ dshTools: true })
  assert.deepEqual(await on.service.bridge(), { on: true, probesPass: true })
  // Success is cached: a second ask reads no tools again (no second probe).
  const reads = on.toolReads()
  assert.deepEqual(await on.service.bridge(), { on: true, probesPass: true })
  assert.equal(on.toolReads(), reads)
  // A new adapter version is a new probe.
  installed.version = '1.0.1'
  assert.deepEqual(await on.service.bridge(), { on: true, probesPass: true })
  assert.ok(on.toolReads() > reads)
  // A missing adapter, a bridge error, or no tools to list all fail closed.
  assert.deepEqual(await serviceFor({ dshTools: true }, { bin: null }).service.bridge(), { on: true, probesPass: false })
  assert.deepEqual(await serviceFor({ dshTools: true }, { mode: 'throw' }).service.bridge(), { on: true, probesPass: false })
  assert.deepEqual(await serviceFor({ dshTools: true }, { mode: 'none' }).service.bridge(), { on: true, probesPass: false })
})

test('a failed probe is retried after its backoff, and a success is reused', async () => {
  const installed = { path: '/fake/adapter', version: '2.0.0' }
  const tools = [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } }]
  let toolsMode = 'throw'
  let service
  const ctx = {
    llm: { registerAdapter: () => () => {}, listProviders: () => [] },
    agents: { get: () => undefined },
    get: (name) => {
      if (name === 'tools') {
        if (toolsMode === 'throw') throw new Error('the tools service is unavailable')
        return { definitions: () => tools, executable: () => tools[0] }
      }
      if (name === 'approval') return { effectivePolicy: () => 'ask', overrideOf: () => 'never' }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
    provide: (name, value) => { if (name === 'acpAgents') service = value },
    on: () => {},
    effect: () => {},
    logger: { warn: () => {}, info: () => {} },
  }
  apply(ctx, { dshTools: true }, { store: { home: undefined, update: async () => {}, binOf: () => installed }, find: () => undefined, signedIn: async () => undefined })
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  try {
    assert.deepEqual(await service.bridge(), { on: true, probesPass: false })
    // A transient failure is not kept forever: inside the backoff it is still false...
    toolsMode = 'ok'
    assert.deepEqual(await service.bridge(), { on: true, probesPass: false })
    // ...and after the backoff the probe runs again and succeeds.
    now += PROBE_RETRY_MS + 1
    assert.deepEqual(await service.bridge(), { on: true, probesPass: true })
    // The success is then reused: the probe does not run again.
    now += PROBE_RETRY_MS * 10
    assert.deepEqual(await service.bridge(), { on: true, probesPass: true })
  } finally {
    Date.now = realNow
  }
})

test('a disposed plugin does not start the probe again, even past its backoff', async () => {
  const installed = { path: '/fake/adapter', version: '3.0.0' }
  const tools = [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } }]
  let toolsMode = 'throw'
  let toolReads = 0
  let service
  let dispose
  const ctx = {
    llm: { registerAdapter: () => () => {}, listProviders: () => [] },
    agents: { get: () => undefined },
    get: (name) => {
      if (name === 'tools') {
        if (toolsMode === 'throw') throw new Error('the tools service is unavailable')
        return { definitions: () => { toolReads += 1; return tools }, executable: () => tools[0] }
      }
      if (name === 'approval') return { effectivePolicy: () => 'ask', overrideOf: () => 'never' }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
    provide: (name, value) => { if (name === 'acpAgents') service = value },
    on: () => {},
    effect: (fn) => { dispose = fn() },
    logger: { warn: () => {}, info: () => {} },
  }
  apply(ctx, { dshTools: true }, { store: { home: undefined, update: async () => {}, binOf: () => installed }, find: () => undefined, signedIn: async () => undefined })
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  try {
    // A failed probe leaves a cache entry that a later ask would re-probe once its backoff ends.
    assert.deepEqual(await service.bridge(), { on: true, probesPass: false })
    dispose()
    toolsMode = 'ok'
    now += PROBE_RETRY_MS + 1
    // Stopped, the plugin has nothing left to probe for, so it neither spawns the bridge nor
    // reads DSH's tools again.
    assert.deepEqual(await service.bridge(), { on: false, probesPass: false })
    assert.equal(toolReads, 0)
  } finally {
    Date.now = realNow
  }
})

test('the probe child gets only the bridge variables, not this process env', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const installed = { path: '/fake/adapter', version: '4.0.0' }
  const tools = [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } }]
  let service
  const ctx = {
    llm: { registerAdapter: () => () => {}, listProviders: () => [] },
    agents: { get: () => undefined },
    get: (name) => {
      if (name === 'tools') return { definitions: () => tools, executable: () => tools[0] }
      if (name === 'approval') return { effectivePolicy: () => 'ask', overrideOf: () => 'never' }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      return undefined
    },
    provide: (name, value) => { if (name === 'acpAgents') service = value },
    on: () => {},
    effect: () => {},
    logger: { warn: () => {}, info: () => {} },
  }
  apply(ctx, { dshTools: true }, { store: { home: undefined, update: async () => {}, binOf: () => installed }, find: () => undefined, signedIn: async () => undefined })
  // A preload named in NODE_OPTIONS runs only in a child that inherited this process env; it
  // records the canary so the probe either shows the leak or proves the env never crossed.
  const marker = join(home, 'inherited.json')
  const preload = join(home, 'preload.cjs')
  writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.env.ACP_PROBE_CANARY))\n`)
  process.env.ACP_PROBE_CANARY = 'from-the-parent'
  process.env.NODE_OPTIONS = `--require=${preload}`
  try {
    // The bridge still answers, so the trim drops the parent env without starving the probe.
    assert.deepEqual(await service.bridge(), { on: true, probesPass: true })
  } finally {
    delete process.env.ACP_PROBE_CANARY
    delete process.env.NODE_OPTIONS
  }
  assert.equal(existsSync(marker), false, 'the bridge child must not inherit this process env')
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
  // The failure also carries the full diagnostic and the log file it was written to.
  const failure = store.lastFailure(adapter)
  assert.match(failure.message, /refused/)
  assert.match(failure.diagnostic, /refused/)
  assert.ok(failure.logPath && existsSync(failure.logPath), 'the install log is written')
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

test('a half-done install DSH was killed in the middle of is dropped once its DSH is gone or it is stale; a running one stays', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-claude']
  const folder = join(home, 'agentclientprotocol__claude-agent-acp')
  // A pid that ran and is gone.
  const gone = spawnSync(process.execPath, ['-e', '']).pid
  const stale = join(folder, `.install-${process.pid}-1`)
  const orphaned = join(folder, `.install-${gone}-2`)
  const running = join(folder, `.install-${process.pid}-3`)
  for (const dir of [stale, orphaned, running]) mkdirSync(dir, { recursive: true })
  const old = (Date.now() - INSTALL_TIMEOUT_MS - 60_000) / 1000
  utimesSync(stale, old, old)
  const store = new AdapterStore({ home, latest: async () => '1.0.0', install: fakeInstall([]) })
  await store.update(adapter, bin)
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(orphaned), false, 'the DSH that started it is gone: dropped at once')
  assert.equal(existsSync(running), true)
})

// A package manager that never finishes and starts a worker of its own that writes into the
// install folder, as npm's and pnpm's children do. Each records its pid.
const slowInstaller = (dir) => tool(dir, 'pnpm') && writeFileSync(join(dir, 'pnpm'), [
  '#!/bin/sh',
  'echo $$ > "$ACP_TEST_PIDS/installer"',
  'sh -c \'echo $$ > "$ACP_TEST_PIDS/worker"; while :; do echo x >> progress; sleep 0.05; done\' &',
  'wait',
  '',
].join('\n'), { mode: 0o755 })
const alive = (pid) => {
  try { process.kill(pid, 0); return true } catch { return false }
}
const until = async (check, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(done => setTimeout(done, 20))) if (check()) return true
  return check()
}
const pidsIn = dir => ['installer', 'worker'].map(name => Number(readFileSync(join(dir, name), 'utf8')))

test('on dispose, a running install is killed with everything it started, and the working adapter stays', { skip: process.platform === 'win32' }, async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-claude']
  const folder = join(home, 'agentclientprotocol__claude-agent-acp')
  await new AdapterStore({ home, latest: async () => '1.0.0', install: fakeInstall([]) }).update(adapter, bin)
  const pids = join(home, 'pids')
  mkdirSync(pids)
  slowInstaller(join(home, 'bin'))
  const env = { ...process.env, AUTOMAGIK_PNPM: join(home, 'bin', 'pnpm'), ACP_TEST_PIDS: pids }
  const store = new AdapterStore({ home, env, latest: async () => '2.0.0' })
  const job = store.update(adapter, bin, { force: true })
  const halfDone = () => readdirSync(folder).filter(name => name.startsWith('.install-'))
  assert.ok(await until(() => existsSync(join(pids, 'worker')) && halfDone().some(name => existsSync(join(folder, name, 'progress')))), 'the installer and its worker run')
  const [installer, worker] = pidsIn(pids)
  assert.ok(alive(installer) && alive(worker))

  store.dispose()
  // Gone at once: DSH may exit before the install's own cleanup runs.
  assert.deepEqual(halfDone(), [])
  await assert.rejects(job, /DSH is quitting/)
  assert.ok(await until(() => !alive(installer) && !alive(worker), 3000), 'the installer and its worker are killed')
  await new Promise(done => setTimeout(done, 200))
  assert.deepEqual(halfDone(), [], 'nothing writes into the adapters home after dispose')
  assert.equal(JSON.parse(readFileSync(join(folder, 'current.json'), 'utf8')).version, '1.0.0')
  assert.equal(store.binOf(adapter, bin)?.version, '1.0.0')
  assert.equal(store.busy(adapter), false)
  // And none starts after it.
  await assert.rejects(store.update(adapter, bin, { force: true }), /DSH is quitting/)
})

test('an install that finishes after dispose is not moved into place', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const { adapter, bin } = AGENTS['acp-claude']
  const folder = join(home, 'agentclientprotocol__claude-agent-acp')
  let finish
  let calls = 0
  const store = new AdapterStore({ home, latest: async () => '1.0.0', install: async () => { calls++; await new Promise(done => { finish = done }) } })
  const job = store.update(adapter, bin)
  assert.ok(await until(() => finish !== undefined))
  store.dispose()
  finish()
  await assert.rejects(job, /DSH is quitting/)
  assert.deepEqual(readdirSync(folder), [], 'no current.json, no version folder, no half-done one')
  assert.equal(store.binOf(adapter, bin), undefined)
  assert.equal(calls, 1)
})

test('an install past its time is killed with everything it started', { skip: process.platform === 'win32' }, async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const pids = join(home, 'pids')
  mkdirSync(pids)
  slowInstaller(join(home, 'bin'))
  // Through /bin/sh: macOS can hold a script written a moment ago for a scan before it first runs.
  await assert.rejects(runInstall('/bin/sh', [join(home, 'bin', 'pnpm'), 'install'], { cwd: home, env: { ...process.env, ACP_TEST_PIDS: pids }, timeoutMs: 1500 }), /timed out/)
  const [installer, worker] = pidsIn(pids)
  assert.ok(await until(() => !alive(installer) && !alive(worker), 3000), 'the installer and its worker are killed')
})

test('a stop after the install exited kills nothing: its pid may already be a stranger\'s', { skip: process.platform === 'win32' }, async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  // Exits at once; a child of its own holds the output open, so 'close' comes a second later.
  writeFileSync(join(home, 'quick'), '#!/bin/sh\necho $$ > "$ACP_TEST_PIDS/installer"\nsleep 1 &\nexit 0\n')
  const kills = []
  const quit = new AbortController()
  let pid
  let exited
  const job = runInstall('/bin/sh', [join(home, 'quick')], {
    cwd: home,
    env: { ...process.env, ACP_TEST_PIDS: home },
    signal: quit.signal,
    kill: killed => kills.push(killed),
    onSpawn: (child) => {
      pid = child.pid
      exited = new Promise(done => child.once('exit', done))
    },
  })
  // 'exit' is the signal, not a poll: Node has reaped the installer, so its pid may already be
  // a stranger's. 'close' still comes a second later, so the stop does reach an install in flight.
  await exited
  assert.equal(Number(readFileSync(join(home, 'installer'), 'utf8')), pid, 'the installer ran')
  quit.abort()
  await assert.rejects(job, /DSH is quitting/)
  assert.deepEqual(kills, [])
})
