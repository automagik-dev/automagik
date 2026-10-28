// The Bot's agent cursor: where the Bot points, clicks and navigates in its browser, drawn over
// the Bot tab the panel shows. It is a window, not a view: a transparent, frameless child of the
// app window that never takes focus and lets every real pointer event through to the page
// (`setIgnoreMouseEvents` exists only on windows, and a view over the tab would take the owner's
// clicks during a takeover). Nothing goes into the Bot's page: the relay (bot-relay.js) hands
// over the Bot's mouse and navigation commands as it forwards them, and the cursor window
// draws them on a page of its own (bot-cursor.html). Each Bot has one, shown while the panel
// shows one of its tabs and the Bot is attached to it; a hold hides it until the Bot's next
// session, and it closes with the Bot's last tab.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// The page commands that start a navigation.
const NAVIGATIONS = new Set(['Page.navigate', 'Page.reload', 'Page.navigateToHistoryEntry'])
// The app window's changes the cursor follows itself; a new place for the tab comes through
// bot-views.js.
const FOLLOWS = ['move', 'resize']

export class BotCursor {
  #window
  #BrowserWindow
  #views
  // Per Bot: its cursor window, and the tab it draws for (null while hidden).
  #cursors = new Map()

  /** @param {{ window: () => any, BrowserWindow: any, views: import('./bot-views.js').BotViews }} options */
  constructor({ window, BrowserWindow, views }) {
    this.#window = window
    this.#BrowserWindow = BrowserWindow
    this.#views = views
    views.cursor = this
  }

  /** A Bot's tabs were placed, attached, held or closed: its cursor follows the shown one. */
  update(botId) {
    const entries = this.#views.entriesOf(botId)
    if (entries.length === 0) return this.close(botId)
    const entry = entries.find(value => value.shown)
    const shown = entry !== undefined && !this.#views.isHeld(botId) && this.#views.relay?.attached(entry) === true
    let cursor = this.#cursors.get(botId)
    if (!shown) {
      if (cursor && !cursor.window.isDestroyed()) cursor.window.hide()
      if (cursor) cursor.entry = null
      return
    }
    cursor ??= this.#open(botId)
    if (!cursor) return
    const content = this.#window().getContentBounds()
    const view = entry.view.getBounds()
    cursor.window.setBounds({ x: content.x + view.x, y: content.y + view.y, width: view.width, height: view.height })
    // Another tab, or shown again: the pointer is where the Bot left it there, with no travel.
    if (cursor.entry !== entry) {
      cursor.entry = entry
      this.#draw(cursor, { instant: true })
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
    const cursor = this.#cursors.get(entry.botId)
    if (cursor?.entry === entry) this.#draw(cursor, { effect })
  }

  close(botId) {
    const cursor = this.#cursors.get(botId)
    this.#cursors.delete(botId)
    if (cursor && !cursor.window.isDestroyed()) cursor.window.destroy()
  }

  dispose() {
    for (const botId of [...this.#cursors.keys()]) this.close(botId)
  }

  #open(botId) {
    const parent = this.#window()
    if (!parent || parent.isDestroyed()) return undefined
    const window = new this.#BrowserWindow({
      parent, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true,
      webPreferences: {
        preload: join(HERE, 'bot-cursor-preload.cjs'), sandbox: true, contextIsolation: true,
        nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: false,
      },
    })
    window.setIgnoreMouseEvents(true)
    const cursor = { window, entry: null, loaded: window.loadFile(join(HERE, 'bot-cursor.html')).catch(() => {}) }
    const follow = () => this.update(botId)
    for (const change of FOLLOWS) parent.on(change, follow)
    window.once('closed', () => {
      for (const change of FOLLOWS) parent.off(change, follow)
      if (this.#cursors.get(botId) === cursor) this.#cursors.delete(botId)
    })
    this.#cursors.set(botId, cursor)
    return cursor
  }

  // The pointer in the window's pixels (the page's CSS pixels times its zoom), once loaded.
  #draw(cursor, { effect, instant = false }) {
    const { entry } = cursor
    const zoom = entry.contents.isDestroyed() ? 1 : entry.contents.getZoomFactor()
    const pointer = entry.pointer ? { x: entry.pointer.x * zoom, y: entry.pointer.y * zoom } : null
    void cursor.loaded.then(() => {
      if (!cursor.window.isDestroyed()) cursor.window.webContents.send('automagik-cursor', { pointer, effect, instant })
    })
  }
}
