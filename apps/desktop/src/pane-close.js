// Cmd+W closes what is focused in dsh's page, never the app's window. Panes and tabs live in
// the runtime's web client (dsh-client-ui-sidebar-right registers `page.close` for the focused
// sidebar pane/tab); the page runs as a browser page, not as DSH's own desktop app
// (preload.cjs), so that command's key is primary+alt+W. The File menu (menu.js) runs this on
// Cmd+W and the page receives that key. With nothing focused `page.close` is blocked and the
// key does nothing; a Bot view is content inside a pane, and the frame page has no panes, so
// both resolve to the page and neither the window nor the app is ever closed from here.

/** The keydown dsh's page handles: the page-close binding of the runtime it runs as. */
export const paneCloseScript = (platform = process.platform) => {
  const primary = platform === 'darwin' ? 'metaKey' : 'ctrlKey'
  return `(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'w', code: 'KeyW', ${primary}: true, altKey: true, bubbles: true, cancelable: true,
    })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })()`
}

/**
 * Ask dsh's page to close its focused pane/tab. Answers false when there is no page to ask
 * (before the page is in, or after it is gone); the caller then does nothing at all.
 */
export function sendPaneClose(contents, { platform = process.platform } = {}) {
  if (!contents || typeof contents.executeJavaScript !== 'function') return false
  if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return false
  void Promise.resolve(contents.executeJavaScript(paneCloseScript(platform))).catch(() => {})
  return true
}
