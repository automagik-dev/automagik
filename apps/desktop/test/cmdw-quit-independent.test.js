// Independent rows for #843 / PR #857, written from the issue and the PR body: Cmd+W closes the
// focused pane and can never close the window, and quitting while a bot runs asks first. The
// menu, pane-close and quit-guard modules are Electron-free; main.js is the Electron entry and
// cannot be imported under node --test, so its rows read the source (as frame.test.js does).
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { appMenuTemplate, CLOSE_PANE_ACCELERATOR } from '../src/menu.js'
import { paneCloseScript, sendPaneClose } from '../src/pane-close.js'
import { createQuitGuard, quitPrompt, requestQuit } from '../src/quit-guard.js'
import { readBusy } from '../src/idle.js'

const APP = 'Automagik'
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const menuSource = readFileSync(new URL('../src/menu.js', import.meta.url), 'utf8')

/** Every entry of a menu template, submenus included. */
function allEntries(template) {
  const found = []
  const walk = items => {
    for (const entry of items) {
      found.push(entry)
      if (Array.isArray(entry.submenu)) walk(entry.submenu)
    }
  }
  walk(template)
  return found
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('menu: darwin has no fileMenu/close role, and its only Cmd+W is our Close Pane', () => {
  let closed = 0
  const template = appMenuTemplate({
    product: APP,
    platform: 'darwin',
    onClosePane: () => { closed++ },
  })
  const entries = allEntries(template)
  assert.equal(entries.filter(entry => entry.role === 'fileMenu').length, 0,
    'the built-in fileMenu would own Cmd+W')
  assert.equal(entries.filter(entry => entry.role === 'close').length, 0,
    'a close role would close the window')

  const file = template.find(entry => entry.label === 'File')
  assert.ok(file, 'the File menu is ours')
  assert.equal(file.submenu.length, 1)
  const closePane = file.submenu[0]
  assert.equal(CLOSE_PANE_ACCELERATOR, 'CmdOrCtrl+W')
  assert.equal(closePane.label, 'Close Pane')
  assert.equal(closePane.accelerator, CLOSE_PANE_ACCELERATOR)
  assert.equal(closePane.role, undefined, 'the accelerator has no role behind it')
  assert.deepEqual(entries.filter(entry => entry.accelerator === CLOSE_PANE_ACCELERATOR),
    [closePane])
  assert.equal(typeof closePane.click, 'function')
  closePane.click()
  assert.equal(closed, 1)
})

test('menu: the app menu keeps updates and quit; edit/view/window stay; non-darwin has none', () => {
  const template = appMenuTemplate({ product: APP, platform: 'darwin' })
  const app = template[0]
  assert.equal(app.label, APP)
  assert.ok(app.submenu.some(entry => entry.label === 'Check for Updates…'))
  assert.ok(app.submenu.some(entry => entry.role === 'quit'))
  assert.deepEqual(template.filter(entry => entry.role).map(entry => entry.role),
    ['editMenu', 'viewMenu', 'windowMenu'])
  for (const platform of ['linux', 'win32']) {
    assert.equal(appMenuTemplate({ product: APP, platform }), null, `${platform} has no menu bar`)
  }
})

test('pane-close: darwin dispatches meta+alt+W, the non-mac twin ctrl+alt+W without meta', () => {
  const dispatched = []
  class FakeKeyboardEvent {
    constructor(type, init) {
      this.type = type
      Object.assign(this, init)
      this.defaultPrevented = false
    }
    preventDefault() { this.defaultPrevented = true }
  }
  const page = {
    window: { dispatchEvent: event => { dispatched.push(event); return false } },
    KeyboardEvent: FakeKeyboardEvent,
  }
  const darwin = paneCloseScript('darwin')
  runInContext(darwin, createContext(page))
  assert.equal(dispatched.length, 1)
  const mac = dispatched[0]
  assert.equal(mac.type, 'keydown')
  assert.equal(mac.key, 'w')
  assert.equal(mac.code, 'KeyW')
  assert.equal(mac.metaKey, true)
  assert.equal(mac.altKey, true)
  assert.equal(mac.bubbles, true)
  assert.equal(mac.cancelable, true)
  assert.equal(mac.ctrlKey, undefined)

  const other = paneCloseScript('win32')
  runInContext(other, createContext(page))
  assert.equal(dispatched.length, 2)
  const windows = dispatched[1]
  assert.equal(windows.ctrlKey, true)
  assert.equal(windows.altKey, true)
  assert.equal(windows.metaKey, undefined)
  assert.equal(windows.code, 'KeyW')
})

test('pane-close: only the page is asked; no page, a destroyed page or a block does nothing', async () => {
  const sent = []
  const page = { executeJavaScript: async script => { sent.push(script); return true } }
  assert.equal(sendPaneClose(page, { platform: 'darwin' }), true)
  assert.deepEqual(sent, [paneCloseScript('darwin')])

  assert.equal(sendPaneClose(null, { platform: 'darwin' }), false)
  assert.equal(sendPaneClose({}, { platform: 'darwin' }), false)
  assert.equal(sent.length, 1, 'nothing was sent without a page')

  let ran = 0
  const destroyed = { isDestroyed: () => true, executeJavaScript: async () => { ran++ } }
  assert.equal(sendPaneClose(destroyed, { platform: 'darwin' }), false)
  assert.equal(ran, 0, 'a destroyed page is never asked')

  const gone = {
    isDestroyed: () => false,
    executeJavaScript: () => Promise.reject(new Error('gone')),
  }
  assert.equal(sendPaneClose(gone, { platform: 'darwin' }), true)
  await tick()

  // The page's own command blocks Cmd+W (the script answers false): the menu clicked, the page
  // answered, and no window or app was touched.
  const scripts = []
  const touched = []
  const blocking = new Proxy({
    executeJavaScript: async script => { scripts.push(script); return false },
  }, {
    get(target, key) { touched.push(String(key)); return target[key] },
  })
  let clicks = 0
  const template = appMenuTemplate({
    product: APP,
    platform: 'darwin',
    onClosePane: () => { clicks++; return sendPaneClose(blocking) },
  })
  const closePane = allEntries(template).find(entry => entry.accelerator === CLOSE_PANE_ACCELERATOR)
  assert.equal(closePane.click(), true)
  await tick()
  assert.equal(clicks, 1)
  assert.deepEqual(scripts, [paneCloseScript(process.platform)])
  // Only the page's executeJavaScript and isDestroyed are looked at: no window.close, no quit.
  assert.ok(touched.length > 0)
  assert.ok(touched.every(key => key === 'executeJavaScript' || key === 'isDestroyed'), touched.join())
  assert.equal(touched.includes('close'), false)
  assert.equal(touched.includes('quit'), false)
})

test('main.js source: the menu is built from appMenuTemplate and Cmd+W reaches closeFocusedPane', () => {
  assert.match(mainSource, /Menu\.buildFromTemplate\(appMenuTemplate\(\{/)
  assert.match(mainSource, /onClosePane: \(\) => closeFocusedPane\(\)/)
  assert.match(mainSource, /sendPaneClose\(page\.webContents\)/)
  assert.doesNotMatch(mainSource, /role:\s*'fileMenu'/)
  assert.doesNotMatch(mainSource, /role:\s*'close'/)

  const start = mainSource.indexOf('function closeFocusedPane')
  assert.ok(start >= 0, 'main.js has a closeFocusedPane handler')
  const end = mainSource.indexOf('async function launch', start)
  assert.ok(end > start)
  const handler = mainSource.slice(start, end)
  assert.doesNotMatch(handler, /window\.close/)
  assert.doesNotMatch(handler, /app\.quit/)
})

test('main.js source: the clean stop keeps fade -> dshProcess.stop -> app.quit', () => {
  const start = mainSource.indexOf('function stopAndQuit')
  assert.ok(start >= 0, 'main.js has a stopAndQuit clean stop')
  const chainAt = mainSource.indexOf('return fade(window', start)
  assert.ok(chainAt > start, 'the clean stop fades the window first')
  const chain = mainSource.slice(chainAt)
  const dshAt = chain.indexOf('dshProcess.stop()')
  const quitAt = chain.indexOf('app.quit()')
  assert.ok(dshAt > 0, 'the clean stop stops dsh')
  assert.ok(quitAt > dshAt, 'the app quits only after dsh stopped')
})

test('main.js source: before-quit, window close and window-all-closed go through the guard', () => {
  const request = 'requestQuit({ guard: quitGuard, parent: window, beginQuit: stopAndQuit })'

  const closeAt = mainSource.indexOf("window.on('close'")
  assert.ok(closeAt >= 0)
  const closedAt = mainSource.indexOf("window.on('closed'", closeAt)
  assert.ok(closedAt > closeAt)
  const closeBlock = mainSource.slice(closeAt, closedAt)
  assert.match(closeBlock, /quitGuard\.needs\(\)/)
  assert.ok(closeBlock.includes(request))

  const beforeAt = mainSource.indexOf("app.on('before-quit'")
  assert.ok(beforeAt >= 0, 'main.js holds before-quit while the guard asks')
  const stopAt = mainSource.indexOf('function stopAndQuit', beforeAt)
  assert.ok(stopAt > beforeAt)
  const before = mainSource.slice(beforeAt, stopAt)
  assert.match(before, /event\.preventDefault\(\)/)
  assert.ok(before.includes(request))

  assert.match(mainSource, /app\.on\('window-all-closed', \(\) => app\.quit\(\)\)/)
  // Cmd+Q is the app menu's quit role: Electron turns it into app.quit, and before-quit holds it.
  assert.match(menuSource, /\{ role: 'quit' \}/)
  assert.match(mainSource, /Menu\.setApplicationMenu\(appMenu\(\)\)/)
})

test('quit guard: the question is Cancel/Quit, defaults to Cancel, and names the bot count', () => {
  const one = quitPrompt({ product: APP, running: 1 })
  assert.equal(one.type, 'question')
  assert.deepEqual(one.buttons, ['Cancel', 'Quit'])
  assert.equal(one.defaultId, 0)
  assert.equal(one.cancelId, 0)
  assert.match(one.message, /Automagik is still working/)
  assert.match(one.detail, /A bot is running/)
  assert.match(one.detail, /Quitting stops it/)

  const many = quitPrompt({ product: APP, running: 3 })
  assert.match(many.detail, /3 bots are running/)
  assert.match(many.detail, /Quitting stops them/)
})

test('quit guard: Cancel answers cancel, asks once, and requestQuit never begins the quit', async () => {
  const asked = []
  const guard = createQuitGuard({
    busy: () => ({ running: 2 }),
    prompt: async prompt => { asked.push(prompt); return { response: 0 } },
  })
  const parent = {}
  assert.equal(await guard.ask(parent), 'cancel')
  assert.equal(asked.length, 1)
  assert.equal(asked[0].running, 2)
  assert.equal(asked[0].parent, parent)
  assert.equal(guard.confirmed, false)
  assert.equal(guard.needs(), true)

  let began = 0
  assert.equal(await requestQuit({ guard, parent, beginQuit: async () => { began++ } }), 'cancel')
  assert.equal(began, 0, 'Cancel leaves dsh and the bot running')
  assert.equal(guard.confirmed, false)
})

test('quit guard: Quit begins once, stays confirmed, and later asks do not prompt', async () => {
  let prompts = 0
  const guard = createQuitGuard({
    busy: () => ({ running: 1 }),
    prompt: async () => { prompts++; return { response: 1 } },
  })
  assert.equal(await guard.ask(), 'quit')
  assert.equal(guard.confirmed, true)
  assert.equal(prompts, 1)
  assert.equal(await guard.ask(), 'quit')
  assert.equal(prompts, 1, 'a confirmed quit is not asked twice')
  assert.equal(guard.needs(), false)

  let began = 0
  assert.equal(await requestQuit({ guard, parent: {}, beginQuit: async () => { began++ } }), 'quit')
  assert.equal(began, 1)
})

test('quit guard: concurrent asks share one dialog', async () => {
  let prompts = 0
  let release = () => {}
  const guard = createQuitGuard({
    busy: () => ({ running: 1 }),
    prompt: () => { prompts++; return new Promise(resolve => { release = resolve }) },
  })
  const first = guard.ask()
  const second = guard.ask()
  await tick()
  assert.equal(prompts, 1)
  release({ response: 1 })
  assert.deepEqual(await Promise.all([first, second]), ['quit', 'quit'])
  assert.equal(guard.confirmed, true)
  assert.equal(prompts, 1)
})

test('quit guard: a failed question keeps the app running', async () => {
  const logged = []
  let prompts = 0
  const guard = createQuitGuard({
    busy: () => ({ running: 4 }),
    prompt: async () => { prompts++; throw new Error('dialog gone') },
    log: line => logged.push(line),
  })
  assert.equal(await guard.ask(), 'cancel')
  assert.equal(guard.confirmed, false)
  assert.equal(guard.needs(), true)

  let began = 0
  assert.equal(await requestQuit({ guard, parent: {}, beginQuit: async () => { began++ } }), 'cancel')
  assert.equal(began, 0)
  assert.equal(prompts, 2)
  assert.match(logged.join('\n'), /dialog gone/)
  assert.match(logged.join('\n'), /keeps running/)
})

test('quit guard: a missing or unreadable busy file asks nothing and quits as before', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-843-busy-'))
  try {
    const missing = join(dir, 'busy.json')
    assert.equal(readBusy(missing), null)
    const invalid = join(dir, 'invalid-busy.json')
    writeFileSync(invalid, '{not json')
    assert.equal(readBusy(invalid), null)
    const wrongShape = join(dir, 'wrong-shape.json')
    writeFileSync(wrongShape, JSON.stringify({ running: '2' }))
    assert.equal(readBusy(wrongShape), null)

    for (const file of [missing, invalid, wrongShape]) {
      let prompts = 0
      const guard = createQuitGuard({
        busy: () => readBusy(file),
        prompt: async () => { prompts++; return { response: 1 } },
      })
      assert.equal(await guard.ask(), 'clean')
      assert.equal(prompts, 0, 'an unknown busy file never asks')
      let began = 0
      assert.equal(await requestQuit({ guard, parent: {}, beginQuit: async () => { began++ } }), 'clean')
      assert.equal(began, 1, 'the quit goes ahead as before')
      assert.equal(guard.confirmed, false)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
