import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { BotViews } from '../src/bot-views.js'
import { PAGE_CLOSE_SOURCE, pageCloseMismatch, paneCloseScript, sendPaneClose } from '../src/pane-close.js'

test("the page receives dsh's page-close binding: primary+alt+W from a keydown", () => {
  const mac = paneCloseScript('darwin')
  assert.match(mac, /code: 'KeyW'/)
  assert.match(mac, /metaKey: true/)
  assert.match(mac, /altKey: true/)
  assert.match(mac, /bubbles: true/)
  assert.match(mac, /cancelable: true/)
  assert.match(mac, /window\.dispatchEvent\(event\)/)
  // The page runs as a browser page (preload.cjs), so its close binding is the web one.
  const windows = paneCloseScript('win32')
  assert.match(windows, /ctrlKey: true/)
  assert.doesNotMatch(windows, /metaKey: true/)
})

test('sending the close asks only the page, and never a window or the app', async () => {
  const scripts = []
  const contents = { executeJavaScript: async (script) => { scripts.push(script) } }
  assert.equal(sendPaneClose(contents, { platform: 'darwin' }), true)
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0], paneCloseScript('darwin'))
  assert.equal(sendPaneClose(contents, { platform: 'win32' }), true)
  assert.equal(scripts[1], paneCloseScript('win32'))
})

test('no page, a destroyed page, or a page that fails changes nothing', async () => {
  assert.equal(sendPaneClose(null), false)
  assert.equal(sendPaneClose({}), false)
  assert.equal(sendPaneClose({ isDestroyed: () => true, executeJavaScript: async () => {} }), false)
  // A page that goes away mid-call is not an error the menu has to handle.
  const gone = {
    executeJavaScript: () => Promise.reject(new Error('gone')),
    isDestroyed: () => false,
  }
  assert.equal(sendPaneClose(gone), true)
  await new Promise(resolve => setImmediate(resolve))
})

// Issue #882, item 3: with the keyboard in a Bot view, the page's own focus is stale.
class FakeKeyboardEvent {
  constructor(type, init) { Object.assign(this, { type, defaultPrevented: false }, init) }
}
function pageStand(elementAt) {
  const sent = []
  const context = createContext({
    KeyboardEvent: FakeKeyboardEvent,
    window: { dispatchEvent: (event) => { sent.push({ to: 'window', event }) } },
    document: {
      asked: [],
      elementFromPoint(x, y) { this.asked.push([x, y]); return elementAt(x, y) },
    },
  })
  return { sent, context }
}

test('with a point, the key goes to the element under it, never to the window or the last focus', () => {
  const pane = { dispatchEvent(event) { this.got = event; event.defaultPrevented = true } }
  const page = pageStand(() => pane)
  assert.equal(runInContext(paneCloseScript('darwin', { x: 640.4, y: 300.5 }), page.context), true)
  assert.deepEqual(page.context.document.asked, [[640, 301]])
  assert.equal(page.sent.length, 0, 'the window is not the target: its focus is not the Bot view')
  assert.equal(pane.got.type, 'keydown')
  assert.equal(pane.got.code, 'KeyW')
  assert.equal(pane.got.metaKey, true)
  assert.equal(pane.got.altKey, true)
  assert.equal(pane.got.bubbles, true, "it bubbles to the window, where dsh's shortcuts listen")

  // Nothing under the point: no key at all, so nothing else can be closed by mistake.
  const empty = pageStand(() => null)
  assert.equal(runInContext(paneCloseScript('darwin', { x: 5, y: 5 }), empty.context), false)
  assert.equal(empty.sent.length, 0)

  // Without a usable point the script is the page's own: its focused pane, as before.
  for (const at of [null, undefined, {}, { x: Number.NaN, y: 1 }, { x: 1 }]) {
    assert.equal(paneCloseScript('darwin', at), paneCloseScript('darwin'))
  }
  const sent = []
  sendPaneClose({ executeJavaScript: async (script) => { sent.push(script) } }, { platform: 'win32', at: { x: 10, y: 20 } })
  assert.deepEqual(sent, [paneCloseScript('win32', { x: 10, y: 20 })])
  assert.match(sent[0], /document\.elementFromPoint\(10, 20\)/)
})

// The least of Electron a Bot view needs to be made and placed.
function botViews() {
  const emitter = () => ({ on() {}, once() {} })
  const storage = {
    ...emitter(),
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {},
    setDisplayMediaRequestHandler() {}, webRequest: { onBeforeRequest() {} },
  }
  class WebContentsView {
    webContents = {
      ...emitter(), focused: false, destroyed: false,
      isFocused() { return this.focused }, isDestroyed() { return this.destroyed },
      setWindowOpenHandler() {}, loadURL: async () => {}, navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      getURL: () => 'about:blank', getTitle: () => '', isLoading: () => false,
    }
    setBounds() {}
    setBorderRadius() {}
    setVisible() {}
  }
  return new BotViews({
    window: () => ({ contentView: { addChildView() {} } }),
    WebContentsView,
    session: { fromPartition: () => storage },
    origin: () => 'http://127.0.0.1:3081',
  })
}

test('the focused Bot tab answers the centre of its panel; no focused, shown, placed tab answers null', () => {
  const views = botViews()
  const bot = 'session-00000000-0000-4000-8000-000000000001'
  const one = views.create(bot, { tabId: 'one' })
  const two = views.create(bot, { tabId: 'two' })
  assert.equal(views.focusedPoint(), null, 'nothing placed, nothing focused')
  views.place('one', { left: 900, top: 100, width: 400, height: 600 }, true)
  views.place('two', { left: 100, top: 50, width: 300, height: 200 }, true)
  assert.equal(views.focusedPoint(), null, 'the keyboard is in the page')
  two.contents.focused = true
  assert.deepEqual(views.focusedPoint(), { x: 250, y: 150 })
  two.contents.focused = false
  one.contents.focused = true
  assert.deepEqual(views.focusedPoint(), { x: 1100, y: 400 })
  // A tab the panel does not show is not where the person is, whatever its focus says.
  views.place('one', null, false)
  assert.equal(views.focusedPoint(), null)
  views.place('one', null, true)
  one.contents.destroyed = true
  assert.equal(views.focusedPoint(), null)
})

test('main.js sends Cmd+W to the pane under a focused Bot view, else to the page as it is', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const handler = main.slice(main.indexOf('function closeFocusedPane'), main.indexOf('async function launch'))
  assert.match(handler, /const at = botViews\.focusedPoint\(\)/)
  assert.match(handler, /if \(at\) sendPaneClose\(page\.webContents, \{ at \}\)\s+else sendPaneClose\(page\.webContents\)/)
})

// Issue #882, item 4: the binding Cmd+W sends is DSH's, so it is pinned. The fixture is the
// `page.close` registration of @deepseek-ai/dsh-client-ui-sidebar-right 0.2.2-rc.2's
// lib/client.js, cut verbatim from the published bundle (MIT; LICENSE beside it).
const REGISTRATION = readFileSync(new URL('./fixtures/page-close/sidebar-right-page-close.js.txt', import.meta.url), 'utf8')

test("the pinned client still registers page.close on the key Cmd+W sends", () => {
  assert.deepEqual(pageCloseMismatch(REGISTRATION), [])
  assert.deepEqual(PAGE_CLOSE_SOURCE, { package: '@deepseek-ai/dsh-client-ui-sidebar-right', file: 'lib/client.js' })
  // The script's key is the contract's: primary+alt+W, a keydown.
  const script = paneCloseScript('darwin')
  assert.match(script, /code: 'KeyW', metaKey: true, altKey: true/)
  // The runtime the app pins carries that package at the version the fixture was cut from.
  const lock = JSON.parse(readFileSync(new URL('../runtime/package-lock.json', import.meta.url), 'utf8')).packages
  assert.equal(lock[`node_modules/${PAGE_CLOSE_SOURCE.package}`]?.version, '0.2.2-rc.2',
    'the runtime moved: cut the fixture again from the new bundle and check Cmd+W still closes a pane')
})

test('a renamed command, another key or another binding is named as a mismatch', () => {
  const moved = (from, to) => {
    assert.ok(REGISTRATION.includes(from), from)
    return pageCloseMismatch(REGISTRATION.replace(from, to))
  }
  assert.deepEqual(moved('id:`page.${kind}`', 'id:`pane.${kind}`'), ['the `page.close` command id'])
  assert.deepEqual(moved('`KeyW`', '`KeyQ`'), ['its key, KeyW'])
  assert.deepEqual(moved('modifiers:[`primary`,`alt`]', 'modifiers:[`primary`,`shift`]'), ['its web binding, primary+alt'])
  assert.deepEqual(moved('{"web:macos":web}', '{"web:linux":web}'), ['the web binding on macOS'])
  assert.equal(pageCloseMismatch('').length, 4)
  assert.equal(pageCloseMismatch(undefined).length, 4)
})

test('prepare-runtime fails the build when the installed client no longer shows that contract', () => {
  const script = readFileSync(new URL('../scripts/prepare-runtime.mjs', import.meta.url), 'utf8')
  assert.match(script, /import \{ PAGE_CLOSE_SOURCE, pageCloseMismatch \} from '\.\.\/src\/pane-close\.js'/)
  assert.match(script, /const closeMismatch = pageCloseMismatch\(readFileSync\(join\(runtimeDir, 'node_modules', \.\.\.PAGE_CLOSE_SOURCE\.package\.split\('\/'\), PAGE_CLOSE_SOURCE\.file\), 'utf8'\)\)/)
  assert.match(script, /if \(closeMismatch\.length > 0\) throw new Error\(/)
})
