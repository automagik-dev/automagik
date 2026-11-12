// The crossing must go through the host's switchRoute, not updateBot: a saved Bot's settings
// picker passes onPick, so the decision cannot rely on "no onPick". This drives the real menu
// through its steps with a tiny stateful hook runtime (React is stubbed).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/model-menu.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const SLOTS = []
let at = 0
let rootProps
let rootTree
const PLACE = { left: 0, top: 0, width: 300, maxHeight: 400 }
const draw = () => {
  at = 0
  const picked = module.exports.ModelMenu(rootProps)
  rootTree = picked.type(picked.props)
  return rootTree
}
const module = { exports: {} }
const react = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: (initial) => {
    const index = at++
    if (!(index in SLOTS)) SLOTS[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    const slot = SLOTS[index]
    if (slot.kind !== 'state') throw new Error('hook order changed')
    // The anchored menu starts with two null states; the stub keeps it open for the test.
    if (slot.value === null && initial === null) slot.value = { ...PLACE }
    const set = (value) => {
      slot.value = typeof value === 'function' ? value(slot.value) : value
      draw()
    }
    return [slot.value, set]
  },
  useRef: (initial) => {
    const index = at++
    if (!(index in SLOTS)) SLOTS[index] = { kind: 'ref', value: { current: initial } }
    if (SLOTS[index].kind !== 'ref') throw new Error('hook order changed')
    return SLOTS[index].value
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  document: { body: {}, activeElement: null },
  window: { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
  requestAnimationFrame: fn => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  setTimeout, clearTimeout,
  require: name => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`no platform module ${name}`)
  },
})

const nodes = (tree, match) => (!tree || typeof tree !== 'object' ? []
  : [...(match(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, match))])
const find = (tree, match) => nodes(tree, match)[0]
const rosterOf = (bot = { id: 'b1', name: 'Ops', model: 'deepseek/flash', appliedModel: 'deepseek/flash' }) => ({
  ready: true,
  byId: { b1: bot },
  defaultModel: 'deepseek/flash',
  models: [
    { ref: 'deepseek/flash', provider: 'deepseek', providerName: 'DeepSeek', name: 'Flash' },
    // Reasoning known empty: the pick applies at once instead of asking the host.
    { ref: 'acp-claude/default', provider: 'acp-claude', providerName: 'Claude Code', name: 'Default', reasoning: { efforts: [] } },
    { ref: 'acp-claude/haiku', provider: 'acp-claude', providerName: 'Claude Code', name: 'Haiku', reasoning: { efforts: [] } },
  ],
})
const openModels = (roster, extra = {}) => {
  rootProps = { bot: roster.byId.b1, roster, actions: globalThis.ACTIONS, run: promise => promise, saved: true, ...extra }
  rootTree = draw()
  const steps = () => find(rootTree, node => node.type?.name === 'ModelSteps')
  steps().props.go({ step: 'agents', route: 'acp' })
  steps().props.go({ step: 'models', route: 'acp', provider: 'acp-claude' })
  return steps().type(steps().props)
}
const click = (tree, match) => {
  const row = find(tree, match)
  assert.ok(row, 'row must be on screen')
  row.props.onClick()
}
const confirmNow = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  const confirm = find(rootTree, node => node.type?.name === 'RouteConfirm')
  assert.ok(confirm, 'the crossing asks first')
  return confirm
}

test('the default crossing confirms and calls switchRoute, never updateBot', async () => {
  const switched = []
  const updated = []
  globalThis.ACTIONS = {
    updateBot: (id, patch) => { updated.push([id, patch]); return Promise.resolve() },
    switchRoute: (id, ref, patch) => { switched.push([id, ref, patch]); return Promise.resolve() },
    refreshModels: () => {},
  }
  const steps = openModels(rosterOf())
  click(steps, node => node.props.role === 'menuitemradio' && node.props.title === 'acp-claude/haiku')
  const confirm = await confirmNow()
  confirm.props.onConfirm()
  assert.deepEqual(JSON.parse(JSON.stringify(switched)), [['b1', 'acp-claude/haiku', {}]])
  assert.deepEqual(updated, [])
})

test('a saved Bot\'s settings picker keeps its onPick but still switches the route', async () => {
  const switched = []
  const picked = []
  const updated = []
  globalThis.ACTIONS = {
    updateBot: (id, patch) => { updated.push([id, patch]); return Promise.resolve() },
    switchRoute: (id, ref, patch) => { switched.push([id, ref, patch]); return Promise.resolve() },
    refreshModels: () => {},
  }
  const steps = openModels(rosterOf(), { onPick: (ref, options) => { picked.push([ref, options]); return Promise.resolve() } })
  click(steps, node => node.props.role === 'menuitemradio' && node.props.title === 'acp-claude/haiku')
  const confirm = await confirmNow()
  confirm.props.onConfirm()
  assert.deepEqual(JSON.parse(JSON.stringify(picked)), [['acp-claude/haiku', { routeChange: true }]])
  assert.deepEqual(switched, [])
  assert.deepEqual(updated, [])
})
