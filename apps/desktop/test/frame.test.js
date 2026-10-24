import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { BAR_HEIGHT, pageLayout, RADIUS, TABLE, tableColor, updateView, WINDOW_ACTIONS, windowChrome } from '../src/frame.js'

test('no system frame on either platform: a transparent frameless window on Linux, a hidden title bar on macOS', () => {
  assert.deepEqual(
    { frame: windowChrome('linux').frame, transparent: windowChrome('linux').transparent, menu: windowChrome('linux').autoHideMenuBar },
    { frame: false, transparent: true, menu: true },
  )
  assert.equal(windowChrome('darwin').titleBarStyle, 'hiddenInset')
  assert.equal(windowChrome('darwin').frame, undefined)
})

test("the window is the clay table, light or dark as the system is: no dark flash before dsh's page paints", () => {
  assert.deepEqual(TABLE, { light: '#f6eee2', dark: '#1e1923' })
  assert.equal(tableColor(false), '#f6eee2')
  assert.equal(tableColor(true), '#1e1923')
  // macOS: the solid table, no vibrancy (clay is matte); Linux stays transparent for its corners.
  assert.equal(windowChrome('darwin').vibrancy, undefined)
  assert.equal(windowChrome('darwin').backgroundColor, TABLE.light)
  assert.equal(windowChrome('darwin', { dark: true }).backgroundColor, TABLE.dark)
  assert.equal(windowChrome('linux', { dark: true }).backgroundColor, '#00000000')
  // The frame page draws the same table: its light tokens, and its prefers-color-scheme dark ones.
  const css = readFileSync(new URL('../src/shell.css', import.meta.url), 'utf8')
  const [light, dark] = [...css.matchAll(/--table:(#[0-9a-f]{6})/g)].map(match => match[1])
  assert.deepEqual({ light, dark }, TABLE)
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{:root\{\s*--table:#1e1923/)
})

test("dsh's page fills the window below the bar, with no border; its corners round with the window on Linux", () => {
  const size = { width: 1360, height: 860 }
  const page = { x: 0, y: BAR_HEIGHT, width: 1360, height: 860 - BAR_HEIGHT }
  assert.deepEqual(pageLayout(size, { platform: 'linux', maximized: false }), { bounds: page, radius: RADIUS })
  assert.deepEqual(pageLayout(size, { platform: 'linux', maximized: true }), { bounds: page, radius: 0 })
  assert.equal(pageLayout(size, { platform: 'darwin', maximized: false }).radius, 0)
  assert.equal(pageLayout({ width: 4, height: 10 }, { platform: 'linux', maximized: false }).bounds.height, 0)
})

test('the frame page can ask for the window buttons, the update notice and the bar menu, and nothing else', () => {
  assert.deepEqual([...WINDOW_ACTIONS].sort(), ['close', 'maximize', 'menu', 'minimize', 'update', 'update-later', 'update-page'])
})

test('a ready update shows a notice with Restart now and Later; after Later a small Restart button stays', () => {
  const ready = { version: '2.261024.1', state: 'ready' }
  assert.deepEqual(updateView(ready), {
    text: 'Automagik 2.261024.1 is ready.',
    actions: [{ act: 'update', label: 'Restart now', primary: true }, { act: 'update-later', label: 'Later' }],
  })
  assert.deepEqual(updateView(ready, { dismissed: true }).actions, [{ act: 'update', label: 'Restart to update', primary: true }])
  assert.equal(updateView(ready, { dismissed: true }).text, undefined)
})

test('a download shows its progress with no button; a deb sees Download and Later; a check answers in a line', () => {
  assert.deepEqual(updateView({ version: '2.261024.1', state: 'downloading', percent: 42 }), { text: 'Updating · 42%', title: 'Downloading Automagik 2.261024.1', actions: [] })
  const out = { version: '2.261024.1', state: 'available', page: 'https://github.com/automagik-dev/omni-desktop/releases/tag/v2.261024.1' }
  assert.deepEqual(updateView(out).actions.map(a => a.act), ['update-page', 'update-later'])
  assert.deepEqual(updateView(out, { dismissed: true }).actions, [{ act: 'update-page', label: 'Automagik 2.261024.1 is out' }])
  assert.deepEqual(updateView(null, { message: 'Automagik is up to date' }), { text: 'Automagik is up to date', actions: [] })
  assert.equal(updateView(null), null)
  assert.equal(updateView(out, { message: 'Automagik is up to date' }).text, 'Automagik 2.261024.1 is out.')
})
