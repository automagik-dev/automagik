// The layout-widths persistence contract (issue #483), tested against the real pinned package
// rather than a stand-in: fixtures/layout-widths-persistence/client.js is the unmodified
// lib/client.js of @deepseek-ai/dsh-client-ui-layout 0.2.2-rc.1 (MIT; LICENSE beside it).
// Its sha256 must be the `before` hash in runtime/patches/patches.json, so these tests apply
// the carried patch to the bytes npm actually installs, import the patched client module
// through the DSH module loader, and drive its real apply()/createLayoutStore with a fake
// window, document and localStorage.
//
// What this does NOT cover: a real Electron/browser reload. Here a "reload" is a fresh module
// instance and a fresh store over the same storage bytes; Chromium's own localStorage and
// document lifecycle are not exercised. prepare-runtime's install, the desktop build and the
// server image build are also out of scope: the boot check and the Server image CI job
// exercise those.
//
// Load-time stand-ins, only at the module's package imports: react and react/jsx-runtime are
// touched only while rendering, which this test never does; @deepseek-ai/dsh-client-store's
// real engine imports zustand and immer (the live client bundle's dependencies), so the stub
// below implements just the defineStore contract this test uses (init, actions, getSnapshot,
// subscribe). The layout store under test is the patched bytes themselves, not a copy.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const PATCHES = join(APP, 'runtime', 'patches')
const FIXTURE_DIR = join(HERE, 'fixtures', 'layout-widths-persistence')
const FIXTURE = join(FIXTURE_DIR, 'client.js')
const LICENSE = join(FIXTURE_DIR, 'LICENSE')
const PACKAGE = '@deepseek-ai/dsh-client-ui-layout'
const FILE = 'lib/client.js'
const PATCH = 'layout-widths-persistence.patch'
// The release this patch is carried for, as the PR promises: dsh and the package are both
// 0.2.2-rc.1. The runtime pins must agree, and the fixture must be the file they were made on.
const DSH = '0.2.2-rc.1'
const VERSION = '0.2.2-rc.1'
const KEY = 'dsh.layout.widths'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = text => createHash('sha256').update(text).digest('hex')

// The two imports the client factory requires only while rendering. Nothing here calls them.
const REACT = {
  useEffect() {},
  useLayoutEffect() {},
  useMemo() {},
  useCallback() {},
  useRef() {},
  useState() {},
}
const JSX = { jsx() {}, jsxs() {}, Fragment: Symbol('react.fragment') }

// The store-engine slice createLayoutStore uses: a fresh state per create(), actions that
// mutate it, and getSnapshot/subscribe. The real engine would additionally pass the state
// through immer and notify subscribers through zustand; no test here subscribes.
function defineStore(declaration) {
  return {
    spec: declaration,
    create() {
      const state = declaration.init()
      const listeners = new Set()
      const actions = {}
      for (const [name, mutate] of Object.entries(declaration.actions)) {
        actions[name] = (...params) => {
          mutate(state, ...params)
          for (const listener of [...listeners]) listener(state)
        }
      }
      return {
        actions,
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    },
  }
}

function entry() {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === PATCH)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${PATCH}`)
  return entries[0]
}

// A runtime the helper can patch: the dsh pin, the package's version, the real before file,
// and a patches folder holding only this entry (patchRuntime is all-or-nothing over a folder,
// and the other carried patches target packages this test would have to invent too).
function makeRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-layout-widths-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')
  const pkg = join(modules, PACKAGE)
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  mkdirSync(join(modules, '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(join(modules, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: DSH }))
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: PACKAGE, version: VERSION, type: 'module' }))
  writeFileSync(join(pkg, FILE), readFileSync(FIXTURE))
  const patches = join(root, 'patches')
  mkdirSync(patches)
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify([entry()], null, 2)}\n`)
  cpSync(join(PATCHES, PATCH), join(patches, PATCH))
  return { root, modules, patches, file: join(pkg, FILE) }
}

// The fake document apply() touches: the module-scope CSS injector and the theme presenter
// (createElement, dataset, head/body/documentElement and their style/attribute methods).
function fakeElement(tag) {
  return {
    tag,
    style: { setProperty() {}, removeProperty() {}, colorScheme: '' },
    dataset: {},
    name: '',
    content: '',
    textContent: '',
    isConnected: false,
    setAttribute() {},
    removeAttribute() {},
    hasAttribute() {
      return false
    },
    append() {},
    appendChild() {},
    remove() {},
  }
}

function fakeDocument() {
  return {
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    title: '',
    createElement: fakeElement,
    querySelector() {
      return null
    },
  }
}

// The patched plugin's real entry point: apply() builds the store through the real
// createLayoutStore. The fake context supplies only the services apply reads; its
// slots.register call is where the root store seat is captured.
function mountPlugin(exports) {
  let registration
  const dispose = () => {}
  const ctx = {
    effect(callback) {
      callback()
      return dispose
    },
    locale: { register: () => dispose, bind: () => () => 'Toggle left sidebar' },
    slots: {
      entries: () => [],
      provideRoot: () => dispose,
      register(options) {
        registration = options
        return dispose
      },
      subscribe: () => dispose,
    },
    reflect: { provide: () => dispose },
    shortcuts: { register: () => dispose },
    theme: {
      getTheme: () => ({
        preference: 'system',
        active: { colorScheme: 'light', tokens: {} },
        fontSizes: { text: 14, code: 13, terminal: 13 },
        fontFamilies: { text: '', code: '', terminal: '' },
      }),
    },
    on: () => dispose,
  }
  exports.apply(ctx)
  assert.ok(registration, 'apply must register the root frame')
  assert.equal(typeof registration.store?.create, 'function', 'the registration carries the layout store')
  return registration.store
}

function saveGlobals(t, values) {
  const previous = new Map()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    if (value === undefined) Reflect.deleteProperty(globalThis, name)
    else Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
      else Object.defineProperty(globalThis, name, descriptor)
    }
  })
}

// A localStorage that records the exact strings written, and can fail on either side.
function fakeStorage(raw, { readError = false, writeError = false } = {}) {
  const values = new Map()
  if (raw !== undefined) values.set(KEY, raw)
  return {
    values,
    getItem(key) {
      if (readError) throw new Error('localStorage read failed')
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      if (writeError) throw new Error('localStorage write failed')
      values.set(key, String(value))
    },
    saved() {
      const raw = values.get(KEY)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
  }
}

// Load the patched client module the way the browser loader does (window.__ModuleLoader__),
// then mount it and create the root layout store. `storage: null` removes localStorage, as a
// browser with storage disabled would.
async function openStore(t, { innerWidth = 1200, raw, storage, readError = false, writeError = false } = {}) {
  const runtime = makeRuntime(t)
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  let exports
  const window = {
    innerWidth,
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, PACKAGE)
        exports = factory(name => {
          if (name === '@deepseek-ai/dsh-client-store') return { defineStore }
          if (name === 'react') return REACT
          if (name === 'react/jsx-runtime') return JSX
          throw new Error(`the client module required an unexpected package: ${name}`)
        })
      },
    },
  }
  const document = fakeDocument()
  const local = storage === undefined ? fakeStorage(raw, { readError, writeError }) : storage
  saveGlobals(t, { window, document, localStorage: local === null ? undefined : local, getComputedStyle: () => ({ backgroundColor: 'rgb(0, 0, 0)' }) })
  await import(pathToFileURL(runtime.file).href)
  assert.ok(exports, 'the client module must load through window.__ModuleLoader__')
  const store = mountPlugin(exports)
  const instance = store.create()
  return { runtime, window, document, storage: local, store, instance, layout: () => instance.getSnapshot().layoutInfo }
}

test('patches.json pins the real 0.2.2-rc.1 file to the desktop runtime', () => {
  const patch = entry()
  assert.equal(patch.dsh, DSH)
  assert.equal(readJson(join(APP, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh'], DSH)
  assert.equal(patch.files.length, 1)
  const [file] = patch.files
  assert.deepEqual({ package: file.package, version: file.version, file: file.file }, { package: PACKAGE, version: VERSION, file: FILE })
  assert.equal(readJson(join(APP, 'runtime', 'package-lock.json')).packages[`node_modules/${PACKAGE}`]?.version, VERSION)
  assert.match(file.before, /^[0-9a-f]{64}$/)
  assert.match(file.after, /^[0-9a-f]{64}$/)
  assert.notEqual(file.before, file.after)
  assert.equal(sha256(readFileSync(FIXTURE)), file.before, 'the checked-in fixture must be the exact file the entry was made against')
  assert.match(readFileSync(LICENSE, 'utf8'), /^MIT License\n/)
  assert.match(readFileSync(FIXTURE, 'utf8'), /window\.__ModuleLoader__\.load/)
  assert.doesNotMatch(readFileSync(FIXTURE, 'utf8'), /dsh\.layout\.widths/, 'the fixture must be the unpatched npm file')
  const patchText = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(patchText.startsWith(`--- a/${PACKAGE}/${FILE}\n+++ b/${PACKAGE}/${FILE}\n`), patchText.slice(0, 120))
  assert.match(patchText, /WIDTHS_KEY = "dsh\.layout\.widths"/)
  assert.match(patchText, /sidebar: saved\.sidebar/)
  assert.match(patchText, /sidebar = d\.layoutInfo\.sidebar === 0 \? lastSidebar : 0/)
  assert.match(patchText, /normalizeRightbar/)
  assert.doesNotMatch(patchText, /clampWidth\(d\.layoutInfo\.rightbar/, 'a viewport change must not clamp the preference')
  const development = readFileSync(join(APP, 'docs', 'DEVELOPMENT.md'), 'utf8')
  assert.match(development, /`layout-widths-persistence\.patch`/)
  assert.match(development, /Delete it in the DSH release whose ui-layout persists the panel widths itself/)
})

test('the carried patch applies to the real file it pins, and a re-run leaves it alone', (t) => {
  const runtime = makeRuntime(t)
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(({ name, state }) => ({ name, state })), [{ name: `${PACKAGE}/${FILE}`, state: 'patched' }])
  const { after } = entry().files[0]
  assert.equal(sha256(readFileSync(runtime.file)), after)
  assert.match(readFileSync(runtime.file, 'utf8'), /WIDTHS_KEY = "dsh\.layout\.widths"/)
  const second = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(second.map(({ state }) => state), ['already patched'])
  assert.equal(sha256(readFileSync(runtime.file)), after)
})

test('a reload restores the sidebar and rightbar widths from dsh.layout.widths', async (t) => {
  const { instance, layout, storage } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: 380, rightbar: 500 }) })
  const info = layout()
  assert.equal(info.sidebar, 380)
  assert.equal(info.rightbar, 500)
  assert.equal(info.viewportWidth, 1200)
  assert.deepEqual(storage.saved(), { sidebar: 380, rightbar: 500 })
})

test('a stored object with one field restores it and defaults the other', async (t) => {
  await t.test('sidebar only', async (t) => {
    const { layout } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: 380 }) })
    assert.equal(layout().sidebar, 380)
    assert.equal(layout().rightbar, null)
  })
  await t.test('rightbar only', async (t) => {
    const { layout } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ rightbar: 500 }) })
    assert.equal(layout().sidebar, 280)
    assert.equal(layout().rightbar, 500)
  })
})

test('restore and save round a stored width the same way', async (t) => {
  const { instance, layout, storage } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: 380.4, rightbar: 500.6 }) })
  assert.equal(layout().sidebar, 380)
  assert.equal(layout().rightbar, 501)
  instance.actions.setSidebar(400.4)
  assert.deepEqual(storage.saved(), { sidebar: 400, rightbar: 501 }, 'the save writes the restored rounding')
})

test('toggleSidebar collapses to 0 and reopens at the last positive width, not 280', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: 380, rightbar: 500 }) })
  const info = layout()
  instance.actions.toggleSidebar()
  assert.equal(info.sidebar, 0)
  instance.actions.toggleSidebar()
  assert.equal(info.sidebar, 380, 'reopen uses the restored width, not SIDEBAR_DEFAULT')
  instance.actions.setSidebar(400)
  assert.equal(info.sidebar, 400)
  instance.actions.toggleSidebar()
  assert.equal(info.sidebar, 0)
  instance.actions.toggleSidebar()
  assert.equal(info.sidebar, 400, 'reopen uses the last positive width the store set')
})

test('setViewportWidth keeps the rightbar preference and writes nothing', async (t) => {
  const { instance, layout, storage } = await openStore(t, { innerWidth: 600, raw: JSON.stringify({ sidebar: 380, rightbar: 500 }) })
  assert.equal(layout().rightbar, 500, 'the store keeps 500 even though a 600px frame displays at most 420')
  instance.actions.setViewportWidth(1400)
  assert.equal(layout().rightbar, 500, 'the 500px preference displays again on the wider frame')
  assert.equal(layout().viewportWidth, 1400)
  assert.deepEqual(storage.saved(), { sidebar: 380, rightbar: 500 }, 'a viewport change persists nothing')
  assert.deepEqual([...storage.values.keys()], [KEY], 'only dsh.layout.widths is written')
})

test('the first open at viewport 1200 uses 45% and persists it', async (t) => {
  const { instance, layout, storage } = await openStore(t, { innerWidth: 1200 })
  assert.equal(layout().rightbar, null)
  instance.actions.openRightbar(false, false)
  const info = layout()
  assert.equal(info.rightbar, 540, '1200 * 0.45 = 540')
  assert.equal(info.rightbarShown, true)
  assert.equal(info.rightbarTrack, false)
  assert.deepEqual(storage.saved(), { sidebar: 280, rightbar: 540 })
})

test('a restored rightbar does not reopen the closed panel', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: 380, rightbar: 500 }) })
  assert.equal(layout().rightbar, 500)
  assert.equal(layout().rightbarShown, false)
  assert.equal(layout().rightbarTrack, false)
  assert.equal(layout().rightbarFullscreen, false)
  instance.actions.setViewportWidth(600)
  assert.equal(layout().rightbar, 500, 'the renderer clamps the display to 420; the store keeps the preference')
  assert.equal(layout().rightbarShown, false, 'a resize does not show the panel')
  assert.equal(layout().rightbarTrack, false)
})

test('out-of-range stored widths clamp up to the minimums', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1000, raw: JSON.stringify({ sidebar: 100, rightbar: 200 }) })
  assert.equal(layout().sidebar, 264)
  assert.equal(layout().rightbar, 300)
})

test('a hand-stored sidebar 0 means no preference and restores as 280', async (t) => {
  const { layout, storage } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: 0, rightbar: 500 }) })
  assert.equal(layout().sidebar, 280, 'the runtime collapse is never stored, so 0 restores the default')
  assert.equal(layout().rightbar, 500)
  assert.deepEqual(storage.saved(), { sidebar: 0, rightbar: 500 }, 'restore writes nothing')
})

test('out-of-range stored widths clamp the sidebar but keep the rightbar preference', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1000, raw: JSON.stringify({ sidebar: 9999, rightbar: 99999 }) })
  assert.equal(layout().sidebar, 420)
  assert.equal(layout().rightbar, 99999, 'the renderer clamps the display to 700; the store keeps the preference')
})

test('stored values of the wrong type fall back to 280 and null', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, raw: JSON.stringify({ sidebar: '380', rightbar: {} }) })
  assert.equal(layout().sidebar, 280)
  assert.equal(layout().rightbar, null)
})

test('a non-object payload falls back to 280 and null', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, raw: '380' })
  assert.equal(layout().sidebar, 280)
  assert.equal(layout().rightbar, null)
})

test('invalid JSON falls back to 280 and null', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, raw: '{"sidebar":380,' })
  assert.equal(layout().sidebar, 280)
  assert.equal(layout().rightbar, null)
})

test('a storage read exception falls back to 280 and null', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, readError: true })
  assert.equal(layout().sidebar, 280)
  assert.equal(layout().rightbar, null)
})

test('a storage write exception leaves the store working', async (t) => {
  const { instance, layout, storage } = await openStore(t, { innerWidth: 1200, writeError: true })
  assert.equal(layout().sidebar, 280)
  instance.actions.setSidebar(380)
  assert.equal(layout().sidebar, 380)
  instance.actions.openRightbar(false, false)
  assert.equal(layout().rightbar, 540)
  assert.equal(storage.saved(), undefined)
})

test('no localStorage at all still opens at the defaults and accepts changes', async (t) => {
  const { instance, layout } = await openStore(t, { innerWidth: 1200, storage: null })
  assert.equal(layout().sidebar, 280)
  assert.equal(layout().rightbar, null)
  instance.actions.setSidebar(380)
  instance.actions.openRightbar(false, false)
  assert.equal(layout().sidebar, 380)
  assert.equal(layout().rightbar, 540)
})

for (const [label, raw] of [
  ['0', '{"sidebar":380,"rightbar":0}'],
  ['negative', '{"sidebar":380,"rightbar":-50}'],
  ['non-finite', '{"sidebar":380,"rightbar":1e999}'],
]) {
  test(`a stored rightbar of ${label} restores as null`, async (t) => {
    const { instance, layout } = await openStore(t, { innerWidth: 1200, raw })
    assert.equal(layout().sidebar, 380)
    assert.equal(layout().rightbar, null)
  })
}

test('the sidebar/rightbar clamps and the 45% first open are unchanged', async (t) => {
  const { instance, layout, storage } = await openStore(t, { innerWidth: 1200 })
  instance.actions.setSidebar(100)
  assert.equal(layout().sidebar, 264)
  instance.actions.setSidebar(9999)
  assert.equal(layout().sidebar, 420)
  instance.actions.setSidebar(380)
  assert.deepEqual(storage.saved(), { sidebar: 380, rightbar: null })

  instance.actions.setRightbar(50)
  assert.equal(layout().rightbar, 300)
  instance.actions.setRightbar(9999)
  assert.equal(layout().rightbar, 840, '1200 * 0.7 = 840')
  assert.deepEqual(storage.saved(), { sidebar: 380, rightbar: 840 })

  instance.actions.setViewportWidth(400)
  assert.equal(layout().rightbar, 840, 'a narrower frame changes only the display, not the preference')
  assert.deepEqual(storage.saved(), { sidebar: 380, rightbar: 840 }, 'a resize persists nothing')
  instance.actions.setViewportWidth(1200)
  assert.equal(layout().rightbar, 840, 'the wide frame displays the preference again')
})
