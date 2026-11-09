import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { appMenuTemplate, CLOSE_PANE_ACCELERATOR } from '../src/menu.js'

test('the File menu closes a pane on Cmd+W, never the window or the app', () => {
  let panes = 0
  const template = appMenuTemplate({
    product: 'Automagik',
    platform: 'darwin',
    onClosePane: () => { panes++ },
  })
  assert.equal(template.some(entry => entry.role === 'fileMenu'), false)
  assert.equal(template.some(entry => entry.role === 'close'), false)
  const file = template.find(entry => entry.label === 'File')
  assert.ok(file, 'the File menu is ours')
  const close = file.submenu.find(entry => entry.accelerator === CLOSE_PANE_ACCELERATOR)
  assert.equal(close.label, 'Close Pane')
  assert.equal(close.role, undefined, 'no role close hides behind the accelerator')
  close.click()
  assert.equal(panes, 1)
  assert.equal(file.submenu.some(entry => entry.role === 'close'), false)
})

test('the app menu keeps Check for Updates, quit, edit, view and window', () => {
  const template = appMenuTemplate({ product: 'Automagik', platform: 'darwin' })
  const app = template[0]
  assert.equal(app.label, 'Automagik')
  assert.ok(app.submenu.some(entry => entry.label === 'Check for Updates…'))
  assert.ok(app.submenu.some(entry => entry.role === 'quit'))
  assert.deepEqual(
    template.filter(entry => entry.role).map(entry => entry.role),
    ['editMenu', 'viewMenu', 'windowMenu'],
  )
})

test('the dsh-TUI entry is offered only with a label, and the app has no menu elsewhere', () => {
  const plain = appMenuTemplate({ product: 'Automagik', platform: 'darwin' })
  assert.equal(plain[0].submenu.some(entry => entry.label === 'dsh-TUI'), false)
  const tui = appMenuTemplate({ product: 'Automagik', platform: 'darwin', dshTuiLabel: 'dsh-TUI' })
  assert.ok(tui[0].submenu.some(entry => entry.label === 'dsh-TUI'))
  assert.equal(appMenuTemplate({ product: 'Automagik', platform: 'linux' }), null)
})

test('main.js builds that menu and routes Cmd+W to the focused pane, not the window', () => {
  // main.js is the Electron entry and cannot be imported under node --test (frame.test.js,
  // dsh.test.js read it at source for the same reason).
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /Menu\.buildFromTemplate\(appMenuTemplate\(\{/)
  assert.match(main, /onClosePane: \(\) => closeFocusedPane\(\)/)
  assert.match(main, /sendPaneClose\(page\.webContents\)/)
  assert.doesNotMatch(main, /role: 'fileMenu'/)
  assert.doesNotMatch(main, /role: 'close'/)
})
