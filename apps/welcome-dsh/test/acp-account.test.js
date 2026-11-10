// A CLI already signed in on this computer whose account the person has not confirmed for the
// app (#869, acp-dsh's `consent: 'needed'`): the welcome does not count it as a connection, and
// its row sends the person to a Bot's chat, where the account is shown. acp-dsh is a fake.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { agentRunning, agentView } from '../src/host/acp.js'
import { install } from '../src/host/endpoint.js'
import { PT_BR } from '../src/client/i18n.js'
import { fakeContext } from './fake-ctx.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const agent = (id, over = {}) => ({
  id,
  key: id === 'acp-claude' ? 'claude' : 'codex',
  name: id === 'acp-claude' ? 'Claude Code' : 'Codex',
  on: true,
  cli: { found: true, state: 'ready', installUrl: 'https://example.com/install' },
  connector: { state: 'ready', version: '1.2.3' },
  signedIn: true,
  model: { provider: id, id: 'default', name: 'x', listed: true },
  restartNeeded: false,
  ...over,
})

test('the host passes on only that the account waits, and such an agent answers no turn', () => {
  const waiting = agent('acp-claude', { consent: 'needed', account: { email: 'ana@work.example' } })
  assert.equal(agentView(waiting).consent, 'needed')
  assert.equal(JSON.stringify(agentView(waiting)).includes('ana@work.example'), false)
  assert.equal(agentRunning(waiting), false)
  // Consented, carried, or an acp-dsh that says nothing: as before.
  for (const consent of ['given', 'carried', undefined]) {
    const row = agent('acp-claude', consent === undefined ? {} : { consent })
    assert.equal('consent' in agentView(row), false, String(consent))
    assert.equal(agentRunning(row), true, String(consent))
  }
  // A signed-out agent has no account to wait for.
  assert.equal('consent' in agentView(agent('acp-codex', { signedIn: false, consent: 'needed' })), false)
})

test('Connect AI does not count an unconfirmed CLI account as a connected AI', async () => {
  const rowsWith = async (over) => {
    const list = () => [agent('acp-claude', over), agent('acp-codex')]
    const acpAgents = { status: async () => ({ agents: list() }), refresh: async () => ({ agents: list() }) }
    const fake = fakeContext({ entries: { 'omni-ai': {}, 'llm-pi-ai': { providers: {} }, 'acp-dsh': { claude: true, codex: true } }, services: { authorization: { describe: () => undefined }, acpAgents } })
    const { handle } = install(fake.ctx, { fetch: async () => { throw new Error('offline') } })
    return (await handle('ais')).value.rows
  }
  const waiting = (await rowsWith({ consent: 'needed' })).find(row => row.id === 'claude')
  assert.equal(waiting.ready, false)
  assert.equal(waiting.on, false)
  assert.equal(waiting.found, null)
  assert.equal(waiting.cli.consent, 'needed')
  const carried = (await rowsWith({ consent: 'carried' })).find(row => row.id === 'claude')
  assert.equal(carried.ready, true)
  assert.equal(carried.on, true)
  assert.equal(carried.found, 'Signed in to Claude Code')
  // The other vendor is untouched either way.
  assert.equal((await rowsWith({ consent: 'needed' })).find(row => row.id === 'chatgpt').ready, true)
})

const bundle = await build({
  stdin: { contents: "export * from './src/client/acp-agents.js'", resolveDir: PLUGIN },
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

test('the row says the account waits, and its button opens a Bot\'s chat: never "Ready"', () => {
  const acted = []
  const row = agentView(agent('acp-claude', { consent: 'needed' }))
  const acp = { view: { available: true, agents: [row] }, busy: null, problems: {}, isOn: item => item.on, flip() {}, retry() {}, check() {}, login: item => acted.push(['login', item.id]) }
  assert.equal(ui.stateOf(row), 'account')
  assert.equal(ui.badgeOf(row), 'Confirm account')
  const tree = render(ui.AcpAgentRow({ agent: row, acp }))
  const text = textOf(tree)
  assert.equal(tree.props['data-state'], 'account')
  assert.match(text, /Claude Code is signed in on this computer\. Confirm its account in a Bot's chat before Bots use it\./)
  assert.doesNotMatch(text, /Ready: pick/)
  assert.doesNotMatch(text, /Signed in to Claude Code\./)
  assert.deepEqual(findAll(tree, node => node.type === 'input'), [])
  const [button] = findAll(tree, node => node.type === 'button' && textOf(node) === 'Confirm account')
  button.props.onClick()
  assert.deepEqual(acted, [['login', 'acp-claude']])
  // A consented agent draws as it always did.
  const ready = agentView(agent('acp-claude'))
  assert.equal(ui.stateOf(ready), 'ready')
  assert.match(textOf(render(ui.AcpAgentRow({ agent: ready, acp }))), /Ready: pick Claude Code in the model picker/)
  // Both new strings read in pt-BR.
  for (const key of ['Confirm account', '{name} is signed in on this computer. Confirm its account in a Bot\'s chat before Bots use it.']) assert.ok(Object.hasOwn(PT_BR, key), key)
})
