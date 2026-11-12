// Follow-ups to the permission section of the diagnostics page (#1020), window side: the
// line a window that only views the team shows, and the count of conversations with a level
// not applied that the host left out. Both are the page's own rows, in three languages.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { DICTIONARY } from '../src/client/i18n.js'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/permission-diagnostics.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
function render(report) {
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState: () => [report, () => {}],
    useEffect: () => {},
    useRef: current => ({ current }),
    useLayoutEffect: () => {},
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, window: {}, URL, URLSearchParams, setTimeout, clearTimeout, navigator: {}, Date, Promise, Intl,
    require: (name) => {
      if (name === 'react') return react
      if (name === 'react-dom' || name === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`no platform module ${name}`)
    },
  })
  return module.exports.PermissionDiagnostics({ actions: {}, roster: { bots: [{ id: 'b2', name: 'Ada' }], rooms: [] }, Section: 'section', Row: 'row' })
}
const nodes = node => (Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children)] : [])
const labels = tree => nodes(tree).filter(node => node.type === 'row').map(node => node.props.label)

const VIEW_ONLY = 'This window only views the team: the saved levels here are as of its last refresh.'
const MORE = 'More conversations are open than fit here.'
const ROW = { kind: 'chat', botId: 'b2', open: true, source: 'bot', saved: { value: 'workspace-write' }, effective: { value: 'workspace-write' } }
const REPORT = { version: 2, sessions: [ROW] }

test('a window that only views the team says its levels are as of its last refresh', () => {
  assert.deepEqual(labels(render({ ...REPORT, viewOnly: true })), [VIEW_ONLY])
  // With nothing open too, after the empty line.
  assert.deepEqual(labels(render({ version: 2, sessions: [], viewOnly: true })), ['No Bot conversation is open.', VIEW_ONLY])
  // After the other closing lines' first one, before the partial one.
  assert.deepEqual(labels(render({ ...REPORT, more: true, viewOnly: true, partial: true })), [MORE, VIEW_ONLY, 'Some of this could not be read just now.'])
  // Not without the flag, not for another value, and not when nothing could be read.
  assert.deepEqual(labels(render(REPORT)), [])
  assert.deepEqual(labels(render({ ...REPORT, viewOnly: 'yes' })), [])
  assert.deepEqual(labels(render({ version: 2, unavailable: true, viewOnly: true })), ['This could not be read just now.'])
})

test('marked conversations the host left out are counted, in place of the general line', () => {
  assert.deepEqual(labels(render({ ...REPORT, more: true, moreMarked: 5 })), ['Conversations with a level not applied that do not fit here: 5.'])
  assert.deepEqual(labels(render({ ...REPORT, more: true })), [MORE])
  // A count that is not one is not shown as one.
  for (const moreMarked of [0, -3, 2.5, '7', null, {}]) assert.deepEqual(labels(render({ ...REPORT, more: true, moreMarked })), [MORE], String(moreMarked))
})

test('the new lines are the page\'s own rows: text only, no new class', () => {
  const all = nodes(render({ ...REPORT, more: true, moreMarked: 2, viewOnly: true }))
  for (const node of all) {
    assert.ok(['section', 'row', 'div', 'span'].includes(node.type), String(node.type))
    for (const key of Object.keys(node.props)) assert.ok(['title', 'label', 'hint', 'className', 'key'].includes(key), key)
  }
  const classes = new Set(all.flatMap(node => String(node.props.className ?? '').split(' ').filter(Boolean)))
  assert.deepEqual([...classes].sort(), ['bt-fb-entry', 'bt-set-copy', 'bt-set-hint', 'bt-set-row'])
})

test('both lines have their Chinese and pt-BR text, with the count kept', () => {
  const ptBR = JSON.parse(readFileSync(fileURLToPath(new URL('../../locale-pt-br-dsh/src/client/locales/pt-BR/omni-ui.json', import.meta.url)), 'utf8'))
  for (const key of [VIEW_ONLY, 'Conversations with a level not applied that do not fit here: {count}.']) {
    for (const [name, table] of [['zh', DICTIONARY.zh], ['pt-BR', ptBR]]) {
      assert.equal(typeof table[key], 'string', `${name}: ${key}`)
      assert.notEqual(table[key], key, name)
      assert.equal(table[key].includes('{count}'), key.includes('{count}'), name)
    }
  }
})
