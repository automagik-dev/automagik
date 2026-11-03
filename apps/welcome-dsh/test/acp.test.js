// Claude Code and Codex in Connect AI and in Settings: the host's acp endpoints over acp-dsh's
// acpAgents service (or none), and every state a row can show, in English and in pt-BR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { install } from '../src/host/endpoint.js'
import { ACP_ENTRY, agentView } from '../src/host/acp.js'
import { fakeContext } from './fake-ctx.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))

// ---- The host -------------------------------------------------------------------------------

// acp-dsh's service as its status() answers, with what a call did.
function fakeAcp(agents, { settingsEntry } = {}) {
  const calls = []
  const service = {
    ...(settingsEntry === undefined ? {} : { settingsEntry }),
    status: async () => { calls.push('status'); return { agents: structuredClone(agents) } },
    refresh: async () => { calls.push('refresh'); return { agents: structuredClone(agents) } },
    retry: async (id) => { calls.push(['retry', id]); return { agents: structuredClone(agents) } },
  }
  return { service, calls }
}
const agent = (id, over = {}) => ({
  id,
  key: id === 'acp-claude' ? 'claude' : 'codex',
  name: id === 'acp-claude' ? 'Claude Code' : 'Codex',
  on: true,
  cli: { found: true, installUrl: 'https://example.com/install' },
  connector: { state: 'ready', version: '1.2.3' },
  signedIn: true,
  model: { provider: id, id: 'default', name: 'x', listed: true },
  restartNeeded: false,
  ...over,
})

function host({ acp, entries = { 'omni-ai': {}, [ACP_ENTRY]: { claude: true, codex: true } } } = {}) {
  const fake = fakeContext({ entries, services: acp ? { acpAgents: acp.service } : {} })
  const { handle } = install(fake.ctx)
  return { ...fake, handle }
}

test('without acp-dsh the acp endpoint answers unavailable, and nothing else is touched', async () => {
  const fake = host()
  assert.deepEqual(await fake.handle('acp', { refresh: true }), { ok: true, value: { available: false, agents: [] } })
  const reply = await fake.handle('acp-switch', { id: 'acp-claude', on: true })
  assert.equal(reply.ok, false)
  assert.equal(reply.error.code, 'omni-ai/refused')
  assert.deepEqual(fake.updates, [])
})

test('the status passes through what the page draws, refreshed only when asked', async () => {
  const acp = fakeAcp([agent('acp-claude', { extra: 'x', cli: { found: true, installUrl: 'javascript:alert(1)' } }), agent('acp-codex', { connector: { state: 'failed', error: 'npm answered 503' }, signedIn: undefined }), agent('acp-gemini')])
  const fake = host({ acp })
  const { value } = await fake.handle('acp')
  assert.deepEqual(acp.calls, ['status'])
  assert.equal(value.available, true)
  assert.deepEqual(value.agents.map(row => row.id), ['acp-claude', 'acp-codex'])
  // Only an https install link reaches the page; nothing it does not draw.
  assert.deepEqual(value.agents[0].cli, { found: true })
  assert.equal('extra' in value.agents[0], false)
  assert.deepEqual(value.agents[1].connector, { state: 'failed', error: 'npm answered 503' })
  assert.equal('signedIn' in value.agents[1], false)
  await fake.handle('acp', { refresh: true })
  assert.deepEqual(acp.calls, ['status', 'refresh'])
})

test("a switch writes acp-dsh's own setting under its key, at the revision it read", async () => {
  const acp = fakeAcp([agent('acp-claude'), agent('acp-codex', { on: false })])
  const fake = host({ acp })
  const on = await fake.handle('acp-switch', { id: 'acp-codex', on: true })
  assert.equal(on.ok, true)
  assert.deepEqual(fake.updates, [{ ns: 'acp-dsh', patch: { codex: true }, expectedRevision: 3 }])
  // Turned on: the CLI and its sign-in are looked at again.
  assert.equal(acp.calls.at(-1), 'refresh')
  await fake.handle('acp-switch', { id: 'acp-claude', on: false })
  assert.deepEqual(fake.updates.at(-1), { ns: 'acp-dsh', patch: { claude: false }, expectedRevision: 4 })
  assert.equal(acp.calls.at(-1), 'status')
  for (const bad of [{ id: 'acp-gemini', on: true }, { id: 'acp-claude' }, { id: 'acp-claude', on: 'yes' }, null]) {
    const reply = await fake.handle('acp-switch', bad)
    assert.equal(reply.error.code, 'omni-ai/invalid')
  }
  assert.equal(fake.updates.length, 2)
})

test('a switch writes to the settings entry acp-dsh names as its own', async () => {
  const acp = fakeAcp([agent('acp-claude')], { settingsEntry: 'acp-dsh-work' })
  const fake = host({ acp, entries: { 'omni-ai': {}, [ACP_ENTRY]: { claude: true }, 'acp-dsh-work': { claude: true } } })
  const reply = await fake.handle('acp-switch', { id: 'acp-claude', on: false })
  assert.equal(reply.ok, true)
  assert.deepEqual(fake.updates, [{ ns: 'acp-dsh-work', patch: { claude: false }, expectedRevision: 3 }])
})

test('a DSH without the acp-dsh settings entry refuses the switch in words', async () => {
  const acp = fakeAcp([agent('acp-claude')])
  const fake = host({ acp, entries: { 'omni-ai': {} } })
  const reply = await fake.handle('acp-switch', { id: 'acp-claude', on: false })
  assert.equal(reply.error.code, 'omni-ai/refused')
  assert.match(reply.error.message, /cannot change/)
})

test('retry asks acp-dsh to install the connector again', async () => {
  const acp = fakeAcp([agent('acp-codex', { connector: { state: 'failed', error: 'x' } })])
  const fake = host({ acp })
  const reply = await fake.handle('acp-retry', { id: 'acp-codex' })
  assert.equal(reply.ok, true)
  assert.deepEqual(acp.calls, [['retry', 'acp-codex']])
})

test('an unknown connector state from a newer acp-dsh reads as installing', () => {
  assert.equal(agentView(agent('acp-claude', { connector: { state: 'warming' } })).connector.state, 'installing')
})

// ---- The page -------------------------------------------------------------------------------

const bundle = await build({
  stdin: { contents: "export * from './src/client/acp-agents.js'\nexport { installLocale, PT_BR } from './src/client/i18n.js'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn,
}
const client = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module: client, exports: client.exports, setTimeout, clearTimeout, setInterval, clearInterval, require: name => ({ react, 'react-dom': {} })[name] })
const ui = client.exports

function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return { ...node, children: node.children.map(render) }
}
const textOf = node => (Array.isArray(node) ? node.map(textOf).join('') : node === null || node === undefined || node === false ? '' : typeof node === 'object' ? textOf(node.children) : String(node))
function findAll(node, match, out = []) {
  if (Array.isArray(node)) node.forEach(child => findAll(child, match, out))
  else if (node && typeof node === 'object') {
    if (match(node)) out.push(node)
    findAll(node.children, match, out)
  }
  return out
}
const view = agents => ({ available: true, agents: agents.map(agentView) })
const acpOf = (agents, over = {}) => {
  const acted = []
  return { acted, view: view(agents), busy: null, problems: {}, isOn: row => row.on, flip: row => acted.push(['flip', row.id]), retry: row => acted.push(['retry', row.id]), check: row => acted.push(['check', row.id]), ...over }
}
const rowOf = (row, acp = acpOf([row])) => render(ui.AcpAgentRow({ agent: agentView(row), acp }))
const buttons = (tree, label) => findAll(tree, node => node.type === 'button' && textOf(node) === label)

test('no CLI: the row says so, links its install page, and checks again on request', () => {
  const acp = acpOf([])
  const tree = rowOf(agent('acp-claude', { cli: { found: false, installUrl: 'https://code.claude.com/docs/en/setup' }, connector: { state: 'no-cli' }, signedIn: undefined }), acp)
  assert.match(textOf(tree), /Not installed/)
  assert.match(textOf(tree), /The claude CLI is not on this computer/)
  const [link] = findAll(tree, node => node.type === 'a')
  assert.equal(link.props.href, 'https://code.claude.com/docs/en/setup')
  assert.equal(textOf(link), 'Install Claude Code')
  buttons(tree, 'Check again')[0].props.onClick()
  assert.deepEqual(acp.acted, [['check', 'acp-claude']])
  assert.equal(tree.props['data-state'], 'no-cli')
})

test('installing: the connector is said to be on its way, with no retry', () => {
  const tree = rowOf(agent('acp-codex', { connector: { state: 'installing' }, signedIn: undefined }))
  assert.match(textOf(tree), /Setting up/)
  assert.match(textOf(tree), /Installing its connector in the background/)
  assert.deepEqual(buttons(tree, 'Retry'), [])
  assert.equal(findAll(tree, node => /oai-waiting/.test(node.props?.className ?? '')).length, 1)
})

test('failed: the last error and a Retry that reinstalls', () => {
  const acp = acpOf([])
  const tree = rowOf(agent('acp-codex', { connector: { state: 'failed', error: 'npm answered 503' } }), acp)
  assert.match(textOf(tree), /Needs a retry/)
  assert.match(textOf(tree), /The connector did not install: npm answered 503/)
  buttons(tree, 'Retry')[0].props.onClick()
  assert.deepEqual(acp.acted, [['retry', 'acp-codex']])
})

test('ready and signed in: where to find it in the model picker', () => {
  const tree = rowOf(agent('acp-claude'))
  const text = textOf(tree)
  assert.match(text, /Ready/)
  assert.match(text, /Found the claude CLI on this computer/)
  assert.match(text, /Signed in to Claude Code/)
  assert.match(text, /Connector ready \(version 1\.2\.3\)/)
  assert.match(text, /Ready: pick Claude Code in the model picker/)
  const [toggle] = findAll(tree, node => node.props?.role === 'switch')
  assert.equal(toggle.props['aria-checked'], 'true')
})

test('signed out: how to sign in, in a terminal; the page never asks for credentials', () => {
  const tree = rowOf(agent('acp-codex', { signedIn: false }))
  assert.match(textOf(tree), /Not signed in\. Run codex login in a terminal/)
  assert.deepEqual(findAll(tree, node => node.type === 'input'), [])
  assert.match(textOf(rowOf(agent('acp-claude', { signedIn: false }))), /Run claude auth login/)
})

test('ready but missing from the picker: a plain restart note', () => {
  const text = textOf(rowOf(agent('acp-claude', { restartNeeded: true, model: { listed: false } })))
  assert.match(text, /Restart needed/)
  assert.match(text, /Restart DSH to see Claude Code in the model picker/)
  assert.doesNotMatch(text, /Ready: pick/)
})

test('off: the switch is off and flipping it asks for the setting', () => {
  const acp = acpOf([])
  const tree = rowOf(agent('acp-claude', { on: false, connector: { state: 'off' } }), acp)
  assert.match(textOf(tree), /Off\. Turn it on to use Claude Code/)
  const [toggle] = findAll(tree, node => node.props?.role === 'switch')
  assert.equal(toggle.props['aria-checked'], 'false')
  toggle.props.onClick()
  assert.deepEqual(acp.acted, [['flip', 'acp-claude']])
})

test('without acp-dsh the Connect AI section draws nothing', () => {
  assert.equal(ui.AcpAgents({ acp: { view: { available: false, agents: [] } } }), null)
  assert.equal(ui.AcpAgents({ acp: { view: null } }), null)
  const section = render(ui.AcpAgents({ acp: acpOf([agent('acp-claude'), agent('acp-codex')]) }))
  assert.equal(findAll(section, node => node.props?.['data-acp']).length, 2)
  assert.match(textOf(section), /Coding agents/)
})

test('the Settings section registers only when acp-dsh answers', async () => {
  const registered = []
  const ctx = { slots: { inject: (name, register) => { register(); return () => registered.push('disposed') }, register: options => registered.push(options.id) } }
  ui.installAcpSection(ctx, async () => ({ available: false, agents: [] }))
  ui.installAcpSection(ctx, async () => { throw new Error('HTTP_404') })
  await new Promise(done => setImmediate(done))
  assert.deepEqual(registered, [])
  const dispose = ui.installAcpSection(ctx, async () => ({ available: true, agents: [] }))
  await new Promise(done => setImmediate(done))
  assert.deepEqual(registered, ['acp-agents'])
  dispose()
  assert.deepEqual(registered, ['acp-agents', 'disposed'])
})

test('the rows read in pt-BR once it is the DSH language', () => {
  const fill = (text, params) => text.replace(/\{(\w+)\}/g, (match, name) => (params && name in params ? String(params[name]) : match))
  const off = ui.installLocale({ register: () => () => {}, bind: () => (key, params) => fill(ui.PT_BR[key] ?? key, params) })
  try {
    const text = textOf(rowOf(agent('acp-codex', { connector: { state: 'failed', error: 'npm answered 503' }, signedIn: false })))
    assert.match(text, /A CLI codex está neste computador/)
    assert.match(text, /Sem login\. Rode codex login em um terminal/)
    assert.match(text, /O conector não foi instalado: npm answered 503/)
    assert.match(text, /Tentar de novo/)
  } finally {
    off()
  }
})
