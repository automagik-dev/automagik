import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { BAR_HEIGHT, pageLayout, RADIUS, TABLE, tableColor, updatePresentation, WINDOW_ACTIONS, windowChrome, windowPageLayout } from '../src/frame.js'

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

test("dsh's page fills the window below the bar, with no border; its corners round with the window on Linux; on macOS it is the whole window", () => {
  const size = { width: 1360, height: 860 }
  const page = { x: 0, y: BAR_HEIGHT, width: 1360, height: 860 - BAR_HEIGHT }
  assert.deepEqual(pageLayout(size, { platform: 'linux', maximized: false }), { bounds: page, radius: RADIUS })
  assert.deepEqual(pageLayout(size, { platform: 'linux', maximized: true }), { bounds: page, radius: 0 })
  assert.deepEqual(pageLayout(size, { platform: 'darwin', maximized: false }), { bounds: { x: 0, y: 0, ...size }, radius: 0 })
  assert.equal(pageLayout({ width: 4, height: 10 }, { platform: 'linux', maximized: false }).bounds.height, 0)
})

test('Linux resize follows the native window even when content bounds still report the previous size', () => {
  let previous = { width: 1360, height: 860 }
  // X11 can emit resize before its content view lays out, with no further resize
  // event after that. Exercise maximize, restore, tiling, full screen and shrink.
  for (const [width, height, maximized, fullScreen] of [
    [1920, 1168, true, false],
    [1360, 860, false, false],
    [960, 1168, false, false],
    [1920, 1200, false, true],
    [720, 520, false, false],
  ]) {
    const window = {
      getBounds: () => ({ x: 300, y: 32, width, height }),
      getContentBounds: () => ({ x: 300, y: 32, ...previous }),
      isMaximized: () => maximized,
      isFullScreen: () => fullScreen,
    }
    const layout = windowPageLayout(window, { platform: 'linux' })
    assert.deepEqual(layout, {
      bounds: { x: 0, y: BAR_HEIGHT, width, height: height - BAR_HEIGHT },
      radius: maximized || fullScreen ? 0 : RADIUS,
    })
    previous = { width, height }
  }
})

test('macOS and Windows keep the content size instead of including native window insets', () => {
  const window = {
    getBounds: () => ({ x: 100, y: 50, width: 1400, height: 900 }),
    getContentBounds: () => ({ x: 108, y: 58, width: 1384, height: 884 }),
    isMaximized: () => false,
    isFullScreen: () => false,
  }
  assert.deepEqual(windowPageLayout(window, { platform: 'darwin' }), {
    bounds: { x: 0, y: 0, width: 1384, height: 884 }, radius: 0,
  })
  assert.deepEqual(windowPageLayout(window, { platform: 'win32' }), {
    bounds: { x: 0, y: BAR_HEIGHT, width: 1384, height: 884 - BAR_HEIGHT }, radius: RADIUS,
  })
})

test('the frame page can ask for the window buttons and the bar menu, and nothing else', () => {
  assert.deepEqual([...WINDOW_ACTIONS].sort(), ['close', 'maximize', 'menu', 'minimize'])
})

test('the update reaches the sidebar in DSH desktop\'s phases, with its version and progress', () => {
  assert.deepEqual(updatePresentation(null), { phase: 'idle' })
  assert.deepEqual(updatePresentation(null, { checking: true }), { phase: 'checking' })
  assert.deepEqual(updatePresentation(null, { failed: true }), { phase: 'error', failure: 'check' })
  assert.deepEqual(updatePresentation({ version: '3.17.0', state: 'downloading', percent: 41.6 }), { phase: 'downloading', version: '3.17.0', percent: 41 })
  // A lane patch shows up while it downloads, not only once it is staged.
  assert.deepEqual(updatePresentation(null, { fetching: { version: '3.25.4', percent: 62.5 }, checking: true }), { phase: 'downloading', version: '3.25.4', percent: 62, kind: 'plugins' })
  assert.deepEqual(updatePresentation({ version: '3.26.0', state: 'downloading', percent: 10 }, { fetching: { version: '3.25.4', percent: 50 } }), { phase: 'downloading', version: '3.26.0', percent: 10 })
  assert.deepEqual(updatePresentation({ version: '3.17.0', state: 'ready' }, { checking: true }), { phase: 'ready', version: '3.17.0' })
  assert.deepEqual(updatePresentation({ version: '3.17.0', state: 'available', page: 'https://x' }), { phase: 'available', version: '3.17.0' })
  // Restart pressed: the sidebar says it installs while the window goes.
  assert.deepEqual(updatePresentation({ version: '3.17.0', state: 'restarting' }), { phase: 'installing', version: '3.17.0' })
})
