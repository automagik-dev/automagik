import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/context-menu.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  document: { body: {} },
  window: { innerWidth: 1280, innerHeight: 800 },
  navigator: { clipboard: { writeText: () => {} } },
  require: name => {
    const platform = {
      react: {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        Fragment: 'Fragment',
        useState: initial => [initial, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useRef: current => ({ current }),
        useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})

const { ContextMenu } = module.exports

function walk(tree, found = []) {
  if (!tree || typeof tree !== 'object') return found
  found.push(tree)
  for (const child of tree.children ?? []) walk(child, found)
  return found
}

function menuFor(roster, id) {
  const actions = new Proxy({}, { get: () => () => {} })
  return ContextMenu({ menu: { kind: 'bot', id, x: 10, y: 10 }, roster, actions })
}

const roster = {
  byId: {
    adopted: { id: 'adopted', name: 'Original adopted', dshAgentId: 'agent-1' },
    ordinary: { id: 'ordinary', name: 'Ordinary test bot' },
  },
  roomsById: {}, mainBotId: 'main', mainBotIds: ['main'],
}

test('an adopted original offers rollback with an explanation instead of the refused delete', () => {
  const labels = walk(menuFor(roster, 'adopted')).filter(node => node.props?.role === 'menuitem')
    .map(node => node.children.filter(child => typeof child === 'string').at(-1))
  assert.equal(labels.includes('Delete'), false)
  assert.equal(labels.includes('Roll back DSH adoption…'), true)
  const note = walk(menuFor(roster, 'adopted')).filter(node => node.props?.className === 'bt-menu-note').map(node => node.children.join(''))
  assert.equal(note.some(text => /Delete is unavailable for an adopted original/.test(text)), true)
})

test('an ordinary Bot still offers the plain delete and no rollback', () => {
  const labels = walk(menuFor(roster, 'ordinary')).filter(node => node.props?.role === 'menuitem')
    .map(node => node.children.filter(child => typeof child === 'string').at(-1))
  assert.equal(labels.includes('Delete'), true)
  assert.equal(labels.includes('Roll back DSH adoption…'), false)
})
