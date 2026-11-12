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
// What the app last sent (the hook's state) and the app's bridge, for a drawing of the pill.
const shown = { state: null }
const opened = []
const omniDesktop = { updates: { status: async () => shown.state, subscribe: () => () => {}, open: async () => { opened.push('open') }, applyPlugins: async () => { opened.push('plugins') } } }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: initial => [shown.state ?? initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }), useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useSyncExternalStore: () => undefined, Fragment: 'fragment', forwardRef: fn => fn, memo: fn => fn, createContext: () => ({}), useContext: () => undefined },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
  document: undefined, window: undefined, omniDesktop, Date, Math, JSON, Intl, setTimeout, clearTimeout,
})
const { DesktopUpdate, appState, updatePill } = module.exports

// Issue #859: the app's download shows its bytes, a failure says what failed, and the pill is a
// row of the sidebar (never something over the page) that only the ready one asks a click of.
const MB = 1024 * 1024

test('the download says how much of it is here, when the app counts the bytes', () => {
  const pill = updatePill({ phase: 'downloading', version: '3.96.0', percent: 42, transferred: 41.24 * MB, total: 98.36 * MB })
  assert.equal(pill.label, 'Updating · 42% · 41.2 of 98.4 MB')
  // A narrow sidebar cuts the one line: the whole of it is the title.
  assert.equal(pill.title, pill.label)
  assert.equal(pill.busy, true)
  assert.equal(updatePill({ phase: 'downloading', percent: 100, transferred: 99 * MB, total: 98 * MB }).label, 'Updating · 100% · 98.0 of 98.0 MB')
  assert.equal(updatePill({ phase: 'downloading', percent: 0, transferred: 0, total: 5 * MB }).label, 'Updating · 0% · 0.0 of 5.0 MB')
})

test('an app that does not count the bytes gets the label it had', () => {
  for (const state of [{ percent: 42 }, { percent: 42, transferred: 5 }, { percent: 42, transferred: 5, total: 0 }, { percent: 42, transferred: '5', total: '9' }, { percent: 42, transferred: -1, total: 9 }]) {
    const pill = updatePill({ phase: 'downloading', ...state })
    assert.equal(pill.label, 'Updating · 42%')
    assert.equal(pill.title, undefined)
  }
})

test('a failure says what failed, and an app that does not say keeps the check\'s words', () => {
  assert.equal(updatePill({ phase: 'error', failure: 'download', version: '3.96.0' }).label, 'Update download failed · Retry')
  assert.equal(updatePill({ phase: 'error', failure: 'verify', version: '3.96.0' }).label, 'Update could not be verified · Retry')
  assert.equal(updatePill({ phase: 'error', failure: 'check' }).label, 'Update check failed · Retry')
  assert.equal(updatePill({ phase: 'error' }).label, 'Update check failed · Retry')
  assert.equal(updatePill({ phase: 'error', failure: 'other' }).label, 'Update check failed · Retry')
  // A failure is not busy: its click tries again.
  assert.equal(updatePill({ phase: 'error', failure: 'download' }).busy, undefined)
})

// The app's row as the sidebar draws it for one presentation: the button's element.
function drawn(app) {
  shown.state = { ...app, app, plugins: { phase: 'idle', changes: [], auto: true } }
  try {
    const rows = DesktopUpdate()
    assert.equal(rows.type, 'div')
    assert.equal(rows.props.className, 'bt-desk-updates')
    const [row] = rows.children.filter(Boolean)
    return row.type(row.props)
  } finally {
    shown.state = null
  }
}
const barOf = button => button.children.filter(Boolean).find(child => child.props.className === 'bt-desk-update-bar')

test('each state is one quiet row; only ready and a failure take a click, and the click is the person\'s', () => {
  const lane = { phase: 'idle', changes: [], auto: true }
  const states = {
    downloading: { phase: 'downloading', version: '3.96.0', percent: 30, transferred: 30 * MB, total: 100 * MB },
    ready: { phase: 'ready', version: '3.96.0' },
    installing: { phase: 'installing', version: '3.96.0' },
    failed: { phase: 'error', failure: 'download', version: '3.96.0' },
  }
  const pills = Object.fromEntries(Object.entries(states).map(([name, app]) => [name, updatePill(appState({ ...app, app, plugins: lane }))]))
  assert.deepEqual(
    Object.fromEntries(Object.entries(pills).map(([name, pill]) => [name, { busy: pill.busy === true, primary: pill.primary === true }])),
    {
      downloading: { busy: true, primary: false },
      ready: { busy: false, primary: true },
      installing: { busy: true, primary: false },
      failed: { busy: false, primary: false },
    },
  )
  assert.equal(pills.ready.label, 'Restart to update to 3.96.0')
  assert.equal(pills.installing.label, 'Installing the update…')
})

test('the row draws the bar while it downloads, and nothing but the person\'s click restarts', () => {
  opened.length = 0
  const downloading = drawn({ phase: 'downloading', version: '3.96.0', percent: 30, transferred: 30 * MB, total: 100 * MB })
  assert.equal(downloading.type, 'button')
  assert.equal(downloading.props.className, 'bt-desk-update')
  assert.equal(downloading.props.title, 'Updating · 30% · 30.0 of 100.0 MB')
  assert.equal(barOf(downloading).children[0].props.style.width, '30%')
  // A download takes no click, and asks for none.
  assert.equal(downloading.props.disabled, true)

  const ready = drawn({ phase: 'ready', version: '3.96.0' })
  assert.equal(ready.props.disabled, false)
  assert.equal(ready.props.className, 'bt-desk-update bt-desk-update-go')
  assert.equal(barOf(ready), undefined)
  // Drawing any of it restarts nothing: only the click reaches the app.
  drawn({ phase: 'installing', version: '3.96.0' })
  const failed = drawn({ phase: 'error', failure: 'verify', version: '3.96.0' })
  assert.equal(failed.props.disabled, false)
  assert.deepEqual(opened, [])
  ready.props.onClick()
  assert.deepEqual(opened, ['open'])
  // No presentation, or an idle one, draws nothing at all.
  shown.state = { phase: 'idle', app: { phase: 'idle' }, plugins: { phase: 'idle', changes: [], auto: true } }
  assert.equal(DesktopUpdate(), null)
  shown.state = null
  assert.equal(DesktopUpdate(), null)
})

test('against an app that sends none of the new fields, every state reads and draws as it did', () => {
  // The presentations a desktop before #859 sends: no bytes, and a failure only of the check.
  const older = {
    checking: [{ phase: 'checking' }, 'Checking for updates…'],
    available: [{ phase: 'available', version: '3.96.0' }, 'Automagik 3.96.0 is out'],
    downloading: [{ phase: 'downloading', version: '3.96.0', percent: 42 }, 'Updating · 42%'],
    ready: [{ phase: 'ready', version: '3.96.0' }, 'Restart to update to 3.96.0'],
    installing: [{ phase: 'installing', version: '3.96.0' }, 'Installing the update…'],
    error: [{ phase: 'error', failure: 'check' }, 'Update check failed · Retry'],
  }
  for (const [name, [app, label]] of Object.entries(older)) {
    const pill = updatePill(app)
    assert.equal(pill.label, label, name)
    assert.equal(pill.title, undefined, name)
    const button = drawn(app)
    assert.equal(button.props.title, undefined, name)
    assert.equal(button.props.disabled, ['checking', 'downloading', 'installing'].includes(name), name)
    assert.equal(button.props.className, `bt-desk-update${['available', 'ready'].includes(name) ? ' bt-desk-update-go' : ''}`, name)
    assert.equal(barOf(button) !== undefined, name === 'downloading', name)
  }
  assert.equal(barOf(drawn(older.downloading[0])).children[0].props.style.width, '42%')
  // One that sends a single presentation for the app and the plugins (before the split).
  shown.state = { phase: 'downloading', version: '3.96.0', percent: 42 }
  const [row] = DesktopUpdate().children.filter(Boolean)
  assert.equal(row.type(row.props).children.filter(Boolean)[1].children[0], 'Updating · 42%')
  shown.state = null
})
