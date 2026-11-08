import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/host-model-menu.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, document: { body: {} }, window: { innerWidth: 1280, innerHeight: 800 },
  require: name => {
    if (name === 'react') return {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
      Fragment: 'Fragment', useState: initial => [initial === null ? { left: 0, top: 0, width: 240 } : initial, () => {}],
      useEffect: () => {}, useLayoutEffect: () => {}, useRef: current => ({ current }),
      useSyncExternalStore: (_subscribe, get) => get(),
    }
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`Unexpected module ${name}`)
  },
})
const { HostModelMenu } = module.exports
const nodes = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))]

test('a locked host-owned picker disables its trigger and rows and rejects even stale callbacks', () => {
  const writes = []
  const roster = { hostModels: { bot: {
    entries: [{ id: 'local', label: 'Local', current: true, levels: [{ id: 'high', name: 'High' }] }, { id: 'cloud', label: 'Cloud' }],
    level: 'auto',
  } } }
  for (const link of [false, true]) {
    const tree = HostModelMenu({
      bot: { id: 'bot', name: 'Host Bot' }, roster, disabled: true, link,
      actions: { updateBot: (...args) => writes.push(args), refreshModels: () => writes.push('refresh') }, run: promise => promise,
    })
    const buttons = nodes(tree, node => node.type === 'button')
    assert.equal(buttons.length, 4)
    for (const button of buttons) {
      assert.equal(button.props.disabled, true)
      button.props.onClick()
    }
  }
  assert.deepEqual(writes, [])
})
