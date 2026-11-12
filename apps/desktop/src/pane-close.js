// Cmd+W closes what is focused in dsh's page, never the app's window. Panes and tabs live in
// the runtime's web client (dsh-client-ui-sidebar-right registers `page.close` for the focused
// sidebar pane/tab); the page runs as a browser page, not as DSH's own desktop app
// (preload.cjs), so that command's key is primary+alt+W. The File menu (menu.js) runs this on
// Cmd+W and the page receives that key. With nothing focused `page.close` is blocked and the
// key does nothing; the frame page has no panes, so it resolves to the page and neither the
// window nor the app is ever closed from here.
//
// A Bot view is not the page: it is a web contents of its own laid over its panel
// (bot-views.js), so while the person types in one the page's own focus is whatever was focused
// there last, and the key would close that. The key is then sent to the element under the Bot
// view (`at`, the centre of its panel in the page's CSS pixels), which sits in the pane the
// person is in; `page.close` resolves the pane from the key's target before the page's focus.
// With no element there the key is not sent at all, never to the page's last focus.

/** The client package and file that register `page.close`, under the runtime's node_modules. */
export const PAGE_CLOSE_SOURCE = { package: '@deepseek-ai/dsh-client-ui-sidebar-right', file: 'lib/client.js' }

// What this file relies on in that client, each as the pinned bundle spells it: the command's
// id, its key, and the web binding (primary+alt) on macOS, where the File menu sends it.
const PAGE_CLOSE_CONTRACT = [
  ['the `page.close` command id', /for \(const kind of \["close", "refresh"\]\)[^]*?id: `page\.\$\{kind\}`/],
  ['its key, KeyW', /code: kind === "close" \? "KeyW" : "KeyR",\s*modifiers: \["primary"\]/],
  ['its web binding, primary+alt', /const web = \{\s*\.\.\.desktop,\s*modifiers: \["primary", "alt"\]\s*\}/],
  ['the web binding on macOS', /\.\.\.kind === "close" \? \{ "web:macos": web \} : \{\}/],
]

/**
 * What of the `page.close` contract `text` (the client bundle of PAGE_CLOSE_SOURCE) no longer
 * shows: empty when Cmd+W's key still reaches the command. prepare-runtime fails the build on
 * anything else, so a DSH that renames or rebinds the command is seen when it is pinned, not
 * as a Cmd+W that silently does nothing.
 */
export const pageCloseMismatch = text =>
  PAGE_CLOSE_CONTRACT.filter(([, pattern]) => !pattern.test(String(text))).map(([name]) => name)

const pointOf = at => (Number.isFinite(at?.x) && Number.isFinite(at?.y) ? { x: Math.round(at.x), y: Math.round(at.y) } : null)

/**
 * The keydown dsh's page handles: the page-close binding of the runtime it runs as. With `at`
 * it goes to the element at that point of the page, and nowhere when there is none.
 */
export const paneCloseScript = (platform = process.platform, at = null) => {
  const primary = platform === 'darwin' ? 'metaKey' : 'ctrlKey'
  const point = pointOf(at)
  const dispatch = point
    ? `const target = document.elementFromPoint(${point.x}, ${point.y})
    if (!target) return false
    target.dispatchEvent(event)`
    : 'window.dispatchEvent(event)'
  return `(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'w', code: 'KeyW', ${primary}: true, altKey: true, bubbles: true, cancelable: true,
    })
    ${dispatch}
    return event.defaultPrevented
  })()`
}

/**
 * Ask dsh's page to close its focused pane/tab, or the one under `at` when a Bot view has the
 * keyboard. Answers false when there is no page to ask (before the page is in, or after it is
 * gone); the caller then does nothing at all.
 */
export function sendPaneClose(contents, { platform = process.platform, at = null } = {}) {
  if (!contents || typeof contents.executeJavaScript !== 'function') return false
  if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return false
  void Promise.resolve(contents.executeJavaScript(paneCloseScript(platform, at))).catch(() => {})
  return true
}
