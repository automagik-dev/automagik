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
const { updatePill } = module.exports

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
