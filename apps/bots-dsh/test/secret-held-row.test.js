import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// #484: a hand-edited secret below the write floor is held (used nowhere). Settings must
// say so: the row shows the floor reason in place of "not used yet", and the opened row
// shows why nothing uses it, so a held key never reads as a normal unused one.
const { outputFiles } = await build({
  stdin: {
    contents: "export { SecretRow } from './src/client/secret-card.js'",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: initial => ({ current: initial }),
  useId: () => 'row-id',
  useEffect: () => {}, useLayoutEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : { MarkdownText: ({ text }) => text }),
  document: {
    activeElement: null, querySelector: () => null,
    addEventListener: () => {}, removeEventListener: () => {},
  },
  location: { protocol: 'http:', hostname: 'localhost' },
  HTMLInputElement: class {}, HTMLTextAreaElement: class {},
  HTMLSelectElement: class {}, HTMLElement: class {},
  URL, URLSearchParams,
})
const { SecretRow } = module.exports

const text = (node) => {
  if (Array.isArray(node)) return node.map(text).join('')
  if (!node || typeof node !== 'object') return node == null || node === false ? '' : String(node)
  return text(node.props.children)
}
const roster = { byId: {}, bots: [], secrets: [] }
const actions = {}
const run = async () => true
const row = (secret, open) =>
  text(SecretRow({ secret, roster, actions, run, open, onToggle: () => {} }))
const base = { scope: 'all', createdAt: 0 }
const held = { ...base, name: 'HAND_TOKEN', held: true }
const normal = { ...base, name: 'SAVED_TOKEN' }

test('a held secret shows the floor reason instead of "not used yet"', () => {
  const shown = row(held, false)
  assert.match(shown, /Held: the saved value is shorter than 4 characters/)
  assert.doesNotMatch(shown, /not used yet/)
})

test('an unheld secret keeps the plain unused line', () => {
  const shown = row(normal, false)
  assert.match(shown, /not used yet/)
  assert.doesNotMatch(shown, /Held/)
})

test('the opened held row says nothing uses the key until a longer value is saved', () => {
  const shown = row(held, true)
  assert.match(shown, /nothing uses this key until you save a value of at least 4 characters/)
})

test('the opened normal row carries no held notice', () => {
  assert.doesNotMatch(row(normal, true), /nothing uses this key/)
})
