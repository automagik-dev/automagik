import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paneCloseScript, sendPaneClose } from '../src/pane-close.js'

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
