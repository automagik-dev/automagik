import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The pill's module as the browser gets it, with stand-ins for the platform it runs on.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/desktop-update.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: initial => [initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }), useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useSyncExternalStore: () => undefined, Fragment: 'fragment', forwardRef: fn => fn, memo: fn => fn, createContext: () => ({}), useContext: () => undefined },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
  document: undefined, window: undefined, Date, Math, JSON, Intl, setTimeout, clearTimeout,
})
const { appState, changeText, pluginPill, updatePill } = module.exports

test('the sidebar says what the desktop update is doing, and nothing when there is no update', () => {
  assert.equal(updatePill({ phase: 'idle' }), null)
  assert.equal(updatePill(undefined), null)
  assert.equal(updatePill({ phase: 'ready', version: '3.17.0' }).label, 'Restart to update to 3.17.0')
  assert.equal(updatePill({ phase: 'ready', version: '3.17.0' }).primary, true)
  assert.equal(updatePill({ phase: 'downloading', percent: 42 }).label, 'Updating · 42%')
  assert.equal(updatePill({ phase: 'downloading', percent: 42 }).busy, true)
  assert.equal(updatePill({ phase: 'available', version: '3.17.0' }).label, 'Automagik 3.17.0 is out')
  assert.equal(updatePill({ phase: 'installing' }).busy, true)
  assert.equal(updatePill({ phase: 'error', failure: 'check' }).label, 'Update check failed · Retry')
})

test('the plugins\' notice names each plugin updating, with its versions', () => {
  const bots = { name: '@automagik/bots-dsh', from: '3.58.1', to: '3.59.2' }
  const welcome = { name: '@automagik/welcome-dsh', from: '3.58.1', to: '3.59.2' }
  assert.equal(changeText(bots), 'Bot team 3.58.1 → 3.59.2')
  // One the app does not know the old version of, or by a name the page does not know.
  assert.equal(changeText({ name: '@automagik/genie-dsh', to: '0.2.1' }), 'Genie 0.2.1')
  assert.equal(changeText({ name: '@automagik/unfold-bot-dsh', from: '3.58.1', to: '3.59.2' }), 'unfold-bot-dsh 3.58.1 → 3.59.2')
  assert.equal(pluginPill({ phase: 'ready', auto: true, changes: [bots] }).label, 'Bot team 3.58.1 → 3.59.2 · updates when no agent is at work')
  assert.equal(pluginPill({ phase: 'ready', auto: false, changes: [bots, welcome] }).label, 'Update Bot team 3.58.1 → 3.59.2, Welcome 3.58.1 → 3.59.2 now')
  assert.equal(pluginPill({ phase: 'ready', auto: false, changes: [bots] }).primary, true)
  assert.equal(pluginPill({ phase: 'installing', changes: [bots] }).label, 'Updating Bot team 3.58.1 → 3.59.2…')
  assert.equal(pluginPill({ phase: 'installing', changes: [bots] }).busy, true)
  assert.equal(pluginPill({ phase: 'downloading', percent: 30, changes: [bots] }).label, 'Downloading Bot team 3.58.1 → 3.59.2 · 30%')
  // Three or more: the first and a count; the title lists them all.
  const three = pluginPill({ phase: 'installing', changes: [bots, welcome, { name: '@automagik/acp-dsh', from: '3.58.1', to: '3.59.2' }] })
  assert.equal(three.label, 'Updating Bot team 3.58.1 → 3.59.2 and 2 more…')
  assert.equal(three.title.split('\n').length, 3)
  assert.equal(pluginPill({ phase: 'idle', changes: [] }), null)
  assert.equal(pluginPill(undefined), null)
})

test('the app\'s own update reads apart from the plugins\', and an older app\'s as before', () => {
  const split = { phase: 'ready', kind: 'plugins', version: '3.59.2', app: { phase: 'idle' }, plugins: { phase: 'ready', changes: [] } }
  assert.deepEqual(appState(split), { phase: 'idle' })
  assert.equal(updatePill(appState(split)), null)
  const older = { phase: 'ready', version: '3.59.2', kind: 'plugins' }
  assert.equal(appState(older), older)
  assert.equal(updatePill(appState(older)).label, 'Restart to update to 3.59.2')
})
