// The Bot's agent cursor: where the Bot points, clicks and navigates in its browser, drawn over
// the Bot tab the panel shows. It is a window, not a view: a transparent, frameless child of the
// app window that lets every real pointer event through to the page (`setIgnoreMouseEvents`
// exists only on windows, and a view over the tab would take the owner's clicks during a
// takeover). Nothing goes into the Bot's page: the relay (bot-relay.js) hands over the Bot's
// mouse and navigation commands as it forwards them, and the cursor window draws them on a page
// of its own (bot-cursor.html), in a session of its own. There is one cursor window at most,
// open while the panel shows a tab with its Bot attached and not held by the owner, and while
// the app window is on screen; it switches to another Bot's tab, and closes when there is none.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// The page commands that start a navigation.
const NAVIGATIONS = new Set(['Page.navigate', 'Page.reload', 'Page.navigateToHistoryEntry'])
// The app window's changes the cursor follows; a resize lays the tabs out again, and their new
// place comes through bot-views.js.
const FOLLOWS = ['move', 'minimize', 'restore', 'hide', 'show']

export class BotCursor {
  #window
  #BrowserWindow
  #views
  #placeable
  // The app window whose changes the cursor follows.
  #parent = null
  // The cursor window ({ window, entry, radius, loaded }), while it is open.
  #cursor = null

  /**
   * @param {{ window: () => any, BrowserWindow: any, views: import('./bot-views.js').BotViews, placeable?: boolean }} options
   * `placeable` is false where a window cannot place itself (Wayland): no cursor is drawn there.
   */
  constructor({ window, BrowserWindow, views, placeable = true }) {
    this.#window = window
    this.#BrowserWindow = BrowserWindow
    this.#views = views
    this.#placeable = placeable
    views.cursor = this
  }

  /** The tabs were placed, attached, held or closed, or the app window changed: the cursor follows. */
  update() {
    const parent = this.#window()
    if (!this.#placeable || !parent || parent.isDestroyed()) return this.#close()
    this.#follow(parent)
    const entry = parent.isVisible() && !parent.isMinimized()
      ? this.#views.shown().find(value => !this.#views.isHeld(value.botId) && this.#views.relay?.attached(value) === true)
      : undefined
    if (!entry) return this.#close()
    const cursor = this.#cursor ?? this.#open(parent)
    const content = parent.getContentBounds()
    const view = entry.view.getBounds()
    cursor.window.setBounds({ x: content.x + view.x, y: content.y + view.y, width: view.width, height: view.height })
    // Another tab, or new corners: the pointer is where the Bot left it there, with no travel.
    if (cursor.entry !== entry || cursor.radius !== entry.radius) {
      cursor.entry = entry
      cursor.radius = entry.radius
      this.#draw({ instant: true })
    }
    if (!cursor.window.isVisible()) cursor.window.showInactive()
  }

  /** A command the relay forwards to a Bot's page: the pointer moves and clicks, a navigation starts. */
  forwarded(entry, method, params) {
    let effect
    if (method === 'Input.dispatchMouseEvent') {
      if (!Number.isFinite(params?.x) || !Number.isFinite(params?.y)) return
      entry.pointer = { x: params.x, y: params.y }
      if (params.type === 'mousePressed') effect = 'click'
    } else if (NAVIGATIONS.has(method)) effect = 'navigate'
    else return
    if (this.#cursor?.entry === entry) this.#draw({ effect })
  }

  dispose() {
    this.#close()
  }

  // The app window's changes, followed once per window; when it closes, the cursor goes with it
  // (a window destroyed, as macOS and Windows close the app's, keeps its child windows).
  #follow(parent) {
    if (this.#parent === parent) return
    this.#parent = parent
    for (const change of FOLLOWS) parent.on(change, () => this.update())
    parent.once('closed', () => this.#close())
  }

  #open(parent) {
    const window = new this.#BrowserWindow({
      parent, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      // Linux keeps a window that cannot take focus on top of every other, on every workspace;
      // there, showing it inactive and letting the pointer through keeps the focus off it.
      focusable: process.platform === 'linux', resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true,
      webPreferences: {
        partition: 'automagik-cursor', preload: join(HERE, 'bot-cursor-preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: false,
      },
    })
    window.setIgnoreMouseEvents(true)
    const cursor = { window, entry: null, radius: undefined, loaded: window.loadFile(join(HERE, 'bot-cursor.html')).catch(() => {}) }
    window.once('closed', () => { if (this.#cursor === cursor) this.#cursor = null })
    this.#cursor = cursor
    return cursor
  }

  #close() {
    const cursor = this.#cursor
    this.#cursor = null
    if (cursor && !cursor.window.isDestroyed()) cursor.window.destroy()
  }

  // The pointer in the window's pixels (the page's CSS pixels times its zoom), once loaded.
  #draw({ effect, instant = false }) {
    const cursor = this.#cursor
    const { entry } = cursor
    const zoom = entry.contents.isDestroyed() ? 1 : entry.contents.getZoomFactor()
    const pointer = entry.pointer ? { x: entry.pointer.x * zoom, y: entry.pointer.y * zoom } : null
    const draw = { pointer, effect, instant, radius: entry.radius ?? 0 }
    void cursor.loaded.then(() => {
      if (!cursor.window.isDestroyed()) cursor.window.webContents.send('automagik-cursor', draw)
    })
  }
}
