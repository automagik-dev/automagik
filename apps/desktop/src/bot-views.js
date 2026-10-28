// The Bot browsers in the app window. Each Bot tab is one WebContentsView in its Bot's own
// persistent partition, laid over the rectangle the Bot browser panel reports (bots-dsh
// src/client/bot-browsers.js, through preload.cjs `dsBotApp.browser`); the owner steers them
// there, and the Bot drives the same views through the loopback CDP relay (bot-relay.js).
// Bot views are not the app's pages: harden() in main.js leaves them alone (`owns`), and they
// get the policy below instead. A page's new window becomes a new tab of the same Bot, nothing
// goes to the system browser, and a page gets no non-web scheme and not dsh's own port at a
// loopback address or name (localhost, *.localhost, 127.x, [::1]); a public name that resolves
// to loopback is not caught here, since the Bot team's executor resolves hosts and decides
// the rest. Saved tabs are dsh's (browser-profiles/<botId>); these views only reopen what dsh
// or the panel asks for.
//
// Ported from DS Bot's app, app/src/bot-views.mjs and app/src/bot-browser.mjs at
// 4a7b55069ad300eae8be42a74f31bc170b40ead7 (https://github.com/Fei2411/DS-Bot, Apache-2.0;
// see NOTICE): the relay moved to bot-relay.js, the view-state file left out, dialogs reach
// the Bot, and a crashed page loads again.
import { createHash, randomUUID } from 'node:crypto'

const BOT_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
export const isBotId = value => typeof value === 'string' && BOT_ID.test(value)
export const isTabId = value => typeof value === 'string' && value.length > 0 && value.length <= 200

/** A Bot's persistent partition: the same Bot keeps the same storage (and sign-ins) across restarts. */
export const partitionOf = botId => `persist:ds-bot-browser-${createHash('sha256').update(`bot:${botId}`).digest('hex').slice(0, 32)}`

const LOOPBACK = new Set(['localhost', '0.0.0.0', '[::1]', '[::]', '[::ffff:7f00:1]'])

/** Whether a URL reaches dsh itself: its port answers under every loopback name. */
export function isAppHost(url, origin) {
  if (!origin) return false
  const host = new URL(origin)
  if (url.port !== host.port) return false
  const name = url.hostname.replace(/\.$/u, '')
  return name === host.hostname || LOOPBACK.has(name) || name.endsWith('.localhost') || /^127\./u.test(name)
}

const credentialFree = url => url.username === '' && url.password === ''

/** Where a Bot page may go, or open a new tab to: http(s) without credentials, never dsh. */
export function allowedNavigation(value, origin) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:') && credentialFree(url) && !isAppHost(url, origin)
}

/** Every request of a Bot page: network ones as navigations allow, else only inert local schemes. */
export function requestAllowed(value, origin) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return credentialFree(url) && !isAppHost(url, origin)
  return ['about:', 'data:', 'blob:'].includes(url.protocol)
}

// The panel's rectangle in its page's CSS pixels.
const rectOf = rect => ({
  x: Math.max(0, Math.round(Number(rect?.left) || 0)),
  y: Math.max(0, Math.round(Number(rect?.top) || 0)),
  width: Math.max(1, Math.round(Number(rect?.width) || 800)),
  height: Math.max(1, Math.round(Number(rect?.height) || 600)),
})
// A tab the panel never placed takes this much of dsh's page.
const UNPLACED = { width: 1280, height: 900 }

export class BotViews {
  #window
  #WebContentsView
  #session
  #origin
  #page
  #devTools
  #onChange
  #views = new Map()
  #held = new Set()
  // The Bot partitions' sessions opened here: a webContents in one of them is a Bot view.
  #storages = new WeakSet()
  #configured = new Set()
  /** The CDP relay (bot-relay.js), told about each view's life. */
  relay = null

  /**
   * @param {{ window: () => any, WebContentsView: any, session: any, origin: () => string | undefined, page?: () => ({ x: number, y: number, width: number, height: number, zoom: number, radius?: number } | null), devTools?: boolean, onChange?: (change: object) => void }} options
   * `page` is where dsh's page sits in the window (null until it is laid in), since the panel
   * reports its rectangle in that page; a tab takes the page's corner radius.
   */
  constructor({ window, WebContentsView, session, origin, page = () => null, devTools = false, onChange = () => {} }) {
    this.#window = window
    this.#WebContentsView = WebContentsView
    this.#session = session
    this.#origin = origin
    this.#page = page
    this.#devTools = devTools
    this.#onChange = onChange
  }

  /** Whether a webContents is a Bot view's: its session is a Bot partition opened here. */
  owns(contents) {
    try {
      return this.#storages.has(contents.session)
    } catch {
      return false
    }
  }

  /** A Bot's partition, its permissions and requests set before any view opens in it. */
  storageOf(botId) {
    const partition = partitionOf(botId)
    const storage = this.#session.fromPartition(partition)
    if (!this.#configured.has(partition)) {
      this.#configured.add(partition)
      this.#storages.add(storage)
      // Nothing a site asks for is granted: no camera, location, notifications or devices.
      storage.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
      storage.setPermissionCheckHandler(() => false)
      storage.setDevicePermissionHandler(() => false)
      storage.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
      storage.on('will-download', (event, item, source) => {
        const entry = [...this.#views.values()].find(value => value.botId === botId && value.contents === source)
        if (entry && this.relay) this.relay.download(entry, event, item)
        else event.preventDefault()
      })
      storage.webRequest.onBeforeRequest((details, callback) => { callback({ cancel: !requestAllowed(details.url, this.#origin()) }) })
    }
    return { partition, storage }
  }

  create(botId, { url = 'about:blank', createdByBot = false, openerId, tabId: requested } = {}) {
    const tabId = requested ?? randomUUID()
    const existing = this.#views.get(tabId)
    if (existing) {
      if (existing.botId !== botId) throw new Error('Browser tab belongs to another Bot')
      return existing
    }
    const { partition } = this.storageOf(botId)
    const view = new this.#WebContentsView({
      webPreferences: {
        partition, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, plugins: false, navigateOnDragDrop: false, spellcheck: false,
        // A hidden tab keeps its timers: the Bot works in tabs the panel does not show.
        backgroundThrottling: false, devTools: this.#devTools,
      },
    })
    // The tab's contents, kept: once they are destroyed, `view.webContents` answers with others.
    const entry = { tabId, botId, view, contents: view.webContents, createdByBot, openerId, requestedUrl: url, favicon: null, error: null, rect: null, shown: false }
    this.#views.set(tabId, entry)
    this.#window()?.contentView.addChildView(view)
    this.#lay(entry)
    const contents = entry.contents
    const publish = () => this.#publish(entry)
    for (const name of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) contents.on(name, publish)
    // dsh's page draws the tab's icon: only a self-contained one, never an address it would fetch.
    contents.on('page-favicon-updated', (_event, favicons) => {
      const favicon = favicons?.find(icon => typeof icon === 'string' && icon.startsWith('data:'))
      entry.favicon = favicon ?? null
      publish()
    })
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { entry.error = description; publish() }
    })
    contents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) { entry.error = null; publish() }
    })
    const away = (event, target) => { if (!allowedNavigation(target, this.#origin())) event.preventDefault() }
    contents.on('will-navigate', away)
    contents.on('will-redirect', away)
    contents.on('will-frame-navigate', (event) => { if (event.isMainFrame) away(event, event.url) })
    // A page's new window is a new tab of the same Bot; a form posted to a new window is not.
    contents.setWindowOpenHandler(({ url: target, postBody }) => {
      if (postBody === undefined && allowedNavigation(target, this.#origin())) {
        this.create(botId, { url: target, createdByBot: this.relay?.attached(entry) === true, openerId: tabId })
      }
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', event => event.preventDefault())
    // HTTP authentication is refused: the Bot signs in through the page, the owner through a handoff.
    contents.on('login', (event, _details, _auth, callback) => { event.preventDefault(); callback() })
    // A page that closes itself (a sign-in popup, say) is gone like a tab closed from the panel.
    contents.once('destroyed', () => this.#gone(entry))
    // A crashed page drops the Bot's connection (dsh opens a new one at its next call) and loads again.
    contents.on('render-process-gone', (_event, details) => {
      if (this.#views.get(tabId) !== entry || details?.reason === 'clean-exit') return
      this.relay?.drop(botId)
      entry.error = 'The page crashed. It is loading again.'
      publish()
      setTimeout(() => { if (!contents.isDestroyed()) contents.reload() }, 0)
    })
    this.relay?.created(entry)
    this.#onChange({ type: 'created', ...this.#state(entry) })
    void contents.loadURL(allowedNavigation(url, this.#origin()) ? url : 'about:blank').catch(() => {})
    return entry
  }

  place(tabId, rect, visible = rect !== null) {
    const entry = this.#views.get(tabId)
    if (!entry) return false
    if (rect !== null) entry.rect = rectOf(rect)
    entry.shown = visible === true
    this.#lay(entry)
    return true
  }

  /** Every view off screen, as when dsh's page loads again and its panel is gone. */
  hideAll() {
    for (const entry of this.#views.values()) {
      entry.shown = false
      this.#lay(entry)
    }
  }

  /** dsh's page moved or was laid in: every view follows it. */
  relayout() {
    for (const entry of this.#views.values()) this.#lay(entry)
  }

  // Where a tab goes: over the panel's rectangle, else over the start of dsh's page, with the
  // page's corners. A shown tab sits on top of the page (which may have been laid in after
  // it); the others are hidden, still at that size, so the Bot's pages keep their layout.
  #lay(entry) {
    const page = this.#page()
    const zoom = page?.zoom > 0 ? page.zoom : 1
    const box = entry.rect ?? { x: 0, y: 0, width: Math.min(UNPLACED.width, page?.width ?? UNPLACED.width), height: Math.min(UNPLACED.height, page?.height ?? UNPLACED.height) }
    const scale = entry.rect ? zoom : 1
    entry.view.setBounds({
      x: Math.round((page?.x ?? 0) + box.x * scale),
      y: Math.round((page?.y ?? 0) + box.y * scale),
      width: Math.max(1, Math.round(box.width * scale)),
      height: Math.max(1, Math.round(box.height * scale)),
    })
    entry.view.setBorderRadius(page?.radius ?? 0)
    if (entry.shown) this.#window()?.contentView.addChildView(entry.view)
    entry.view.setVisible(entry.shown)
  }

  async operate(botId, action, payload = {}) {
    const entry = this.#owned(botId, payload.tabId)
    const contents = entry.contents
    const history = contents.navigationHistory
    switch (action) {
      case 'navigate': {
        const url = String(payload.url)
        if (!allowedNavigation(url, this.#origin())) throw new Error('This address is not allowed')
        return contents.loadURL(url)
      }
      case 'command':
        if (payload.command === 'back' && history.canGoBack()) history.goBack()
        else if (payload.command === 'forward' && history.canGoForward()) history.goForward()
        else if (payload.command === 'reload') contents.reload()
        else if (payload.command === 'stop') contents.stop()
        return true
      case 'focus': contents.focus(); return true
      case 'read': return contents.executeJavaScript(String(payload.script))
      case 'close': return this.close(botId, payload.tabId)
      default: throw new Error('Unknown browser view operation')
    }
  }

  async close(botId, tabId) {
    const entry = this.#owned(botId, tabId)
    this.#gone(entry)
    if (!entry.contents.isDestroyed()) entry.contents.close()
    return true
  }

  // A tab leaves: its Bot sessions end, and the view leaves the window too (closing only its
  // contents would keep the child view).
  #gone(entry) {
    if (this.#views.get(entry.tabId) !== entry) return
    this.relay?.closing(entry)
    this.#views.delete(entry.tabId)
    this.#window()?.contentView.removeChildView(entry.view)
    this.#onChange({ type: 'closed', botId: entry.botId, tabId: entry.tabId })
  }

  /** A deleted Bot: its tabs close and its partition's storage (its sign-ins) is cleared. */
  async forget(botId) {
    for (const entry of [...this.#views.values()]) if (entry.botId === botId) await this.close(botId, entry.tabId)
    this.relay?.drop(botId)
    this.#held.delete(botId)
    const { storage } = this.storageOf(botId)
    await storage.clearStorageData()
    await storage.clearCache()
  }

  /**
   * The owner takes the Bot's browser (a takeover, a login handoff) or gives it back. While
   * held, the Bot's relay connection is closed and no new one is issued; the views stay and
   * take the owner's input. (The Bot's cursor window, when there is one, hides here too.)
   */
  async hold(botId, held) {
    if (!held) {
      this.#held.delete(botId)
      return true
    }
    this.#held.add(botId)
    this.relay?.drop(botId)
    return true
  }

  isHeld(botId) {
    return this.#held.has(botId)
  }

  sync(botId) {
    return this.entriesOf(botId).map(entry => this.#state(entry))
  }

  entriesOf(botId) {
    return [...this.#views.values()].filter(entry => entry.botId === botId)
  }

  entry(tabId) {
    return this.#views.get(tabId)
  }

  /** The view's state changed (a Bot attached or left). */
  changed(entry) {
    this.#publish(entry)
  }

  dispose() {
    for (const entry of this.#views.values()) if (!entry.contents.isDestroyed()) entry.contents.close()
    this.#views.clear()
  }

  #owned(botId, tabId) {
    const entry = this.#views.get(tabId)
    if (!entry || entry.botId !== botId) throw new Error('Browser tab does not belong to this Bot')
    return entry
  }

  #state(entry) {
    const contents = entry.contents
    const history = contents.navigationHistory
    return {
      botId: entry.botId, tabId: entry.tabId, createdByBot: entry.createdByBot,
      // Before its first load a tab shows the address it was opened for.
      url: contents.getURL() || entry.requestedUrl, title: contents.getTitle(), loading: contents.isLoading(),
      canGoBack: history.canGoBack(), canGoForward: history.canGoForward(),
      favicon: entry.favicon, error: entry.error, live: true,
      botAttached: this.relay?.attached(entry) === true,
    }
  }

  #publish(entry) {
    if (this.#views.get(entry.tabId) === entry && !entry.contents.isDestroyed()) this.#onChange({ type: 'changed', ...this.#state(entry) })
  }
}
