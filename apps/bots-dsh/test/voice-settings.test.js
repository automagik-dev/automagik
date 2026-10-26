import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The voice settings' module as the browser gets it, with stand-ins for the platform it runs on.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/voice-settings.js', import.meta.url))],
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
const { voicePrefs } = module.exports
const storing = text => ({ getItem: () => text })

test('voice chat reads the saved voice and speed, and falls back on anything else', () => {
  assert.deepEqual({ ...voicePrefs(storing(JSON.stringify({ voice: 'com.apple.voice.Samantha', rate: 1.2 }))) }, { voice: 'com.apple.voice.Samantha', rate: 1.2 })
  assert.deepEqual({ ...voicePrefs(storing(JSON.stringify({ voice: 3, rate: 9 }))) }, { voice: '', rate: 1 })
  assert.deepEqual({ ...voicePrefs(storing('not json')) }, { voice: '', rate: 1 })
  assert.deepEqual({ ...voicePrefs(storing(null)) }, { voice: '', rate: 1 })
})
