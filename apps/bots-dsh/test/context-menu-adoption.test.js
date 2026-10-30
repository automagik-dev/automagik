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
let confirmResult = false
const windowState = { innerWidth: 1280, innerHeight: 800, confirm: () => confirmResult }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  document: { body: {} },
  window: windowState,
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

function menuFor(roster, id, actions = new Proxy({}, { get: () => () => {} })) {
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
  assert.equal(note.some(text => /A confirmation is required/.test(text)), true)
})

test('the rollback item describes itself and clicking it calls rollbackAdoption with the adopted agent id', async () => {
  const actions = new Proxy({ get: () => () => {} }, {
    get: (target, name) => name in target ? target[name] : () => {},
  })
  const calls = []
  const reported = []
  actions.closeMenu = () => calls.push('close')
  actions.rollbackAdoption = agentId => { calls.push(agentId); return Promise.reject(new Error('Remove Main Bot/group roles and resolve new team history before rolling back adoption')) }
  actions.reportError = (error, where) => reported.push([error.message, where])
  const tree = menuFor(roster, 'adopted', actions)
  const rollback = walk(tree).find(node => node.props?.role === 'menuitem' && node.children.includes('Roll back DSH adoption…'))
  assert.equal(rollback.props['aria-describedby'], 'bt-menu-note')
  confirmResult = false
  rollback.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['close'])
  confirmResult = true
  rollback.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['close', 'close', 'agent-1'])
  assert.equal(reported.length, 1)
  assert.equal(reported[0][0], 'Remove Main Bot/group roles and resolve new team history before rolling back adoption')
  assert.equal(reported[0][1], 'menu')
})

test('an adopted original in a group or with tasks is not offered rollback and says to leave all groups', () => {
  const blocked = {
    ...roster,
    roomsById: { room: { id: 'room', members: ['adopted'] } },
    tasks: { task: { from: 'adopted', title: 'Synthetic task' } },
  }
  const tree = menuFor(blocked, 'adopted')
  const labels = walk(tree).filter(node => node.props?.role === 'menuitem')
    .map(node => node.children.filter(child => typeof child === 'string').at(-1))
  assert.equal(labels.includes('Roll back DSH adoption…'), false)
  const note = walk(tree).filter(node => node.props?.className === 'bt-menu-note').map(node => node.children.join('')).join('')
  assert.match(note, /leaves all groups/)
  assert.match(note, /tasks or new team history/)
})

test('an ordinary Bot still offers the plain delete and no rollback', () => {
  const labels = walk(menuFor(roster, 'ordinary')).filter(node => node.props?.role === 'menuitem')
    .map(node => node.children.filter(child => typeof child === 'string').at(-1))
  assert.equal(labels.includes('Delete'), true)
  assert.equal(labels.includes('Roll back DSH adoption…'), false)
})
