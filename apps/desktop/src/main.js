// Automagik desktop: one window on a DeepSeek Harness of the app's own (see dsh.js for where it
// keeps things). The window opens at once on its own frame (frame.js, shell.html) with the
// Automagik mark waking up; the main process starts dsh on a loopback port, waits for the launch
// URL with dsh's per-launch token, and lays dsh's page into the frame; quitting stops dsh.
// Both pages are plain browser pages with no Node in them: context isolation and the
// renderer sandbox are on, dsh's page can navigate only within dsh's origin, web links open
// in the system browser, and the frame page never navigates.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, session, shell, systemPreferences, WebContentsView } from 'electron'
import updaterModule from 'electron-updater'
import { appendFileSync, createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linkInArgs, parseDeepLink, SCHEME } from './deeplink.js'
import { fade, PAGE_IN_CSS } from './motion.js'
import { noteRestart, restartLine, steps } from './timeline.js'
import { ANONYMOUS_ID, appHome, automagikHome, busyFileOf, dshEnv, freePort, installProfile, navigationOf, pinProfileStore, preloadOf, resourcesOf, startDsh, stopDsh, storeLayoutOf, writeTools } from './dsh.js'
import { pageLayout, tableColor, updatePresentation, WINDOW_ACTIONS, windowChrome } from './frame.js'
import { dataPathsOf, PRODUCT } from './identity.js'
import { awayInstall, LOOK_EVERY_MS, readBusy } from './idle.js'
import { isReleasePage, startUpdates, updateMode } from './update.js'

const HERE = dirname(fileURLToPath(import.meta.url))
// Before anything reads it (the single-instance lock does): the window's data is filed under
// the app's own name (identity.js), whatever Electron derives from the running binary.
for (const [name, path] of Object.entries(dataPathsOf(app.getPath('appData')))) app.setPath(name, path)
const root = automagikHome()
const home = appHome()
let dsh = null
// dsh's process from the moment it is spawned: a quit before it is ready still stops it.
let dshChild = null
let window = null
let page = null
let quitting = false
// The window is fading out on its way to close.
let closing = false
// The system's "reduce motion" (macOS accessibility, Windows animation settings).
const lessMotion = () => systemPreferences.getAnimationSettings?.().prefersReducedMotion === true
let ready = false
// The update the title bar shows ({ version, state, percent }), once there is one.
let update = null
let updates = null
// Check for Updates is under way, or its last check failed (frame.js updatePresentation).
let checking = false
let checkFailed = false
// logs/start.log (timeline.js): a start's steps from the process's own start, and the way out
// (a quit, or a restart into an update) from the moment it was asked for.
const startLog = (line) => { try { appendFileSync(join(home, 'logs', 'start.log'), line) } catch {} }
const RESTART_NOTE = () => join(home, 'logs', 'restart.json')
const started = steps('start', { write: startLog, since: Date.now() - process.uptime() * 1000 })
let leaving = null
const leave = (kind) => (leaving ??= steps(kind, { write: startLog, since: Date.now() }))

// omni:// links (deeplink.js): the system hands them to the running app (macOS: open-url;
// Linux: a second instance with the link as an argument), or starts the app with one.
// A link that arrives before the app's page is up waits for it.
let pendingLink = linkInArgs(process.argv)
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [process.argv[1]])
else app.setAsDefaultProtocolClient(SCHEME)
app.on('open-url', (event, url) => {
  event.preventDefault()
  receiveLink(url)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // `omni desktop` or `genie desktop` while the app runs: kept for the next start.
    preloadOf({ home: root, argv, env: {} })
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
    const link = linkInArgs(argv)
    if (link) receiveLink(link)
  })
  app.whenReady().then(launch).catch(fail)
}

function receiveLink(text) {
  const link = parseDeepLink(text)
  if (!link) return
  if (window) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
  if (link.action !== 'connect') return
  pendingLink = text
  if (ready) void connectFromLink()
}

// Ask, then hand the address to Omni's page (apps/omni-channels-dsh, the omni-desktop:connect
// event). With a grant the page trades it for this device's key at once; without one it
// starts the sign-in on that Omni and opens its approval page in the browser.
async function connectFromLink() {
  const link = parseDeepLink(pendingLink)
  pendingLink = null
  if (!link || link.action !== 'connect' || !window || !page) return
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    buttons: ['Connect', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Connect ${PRODUCT} to ${link.host}?`,
    detail: (link.grant
      ? `Your Omni sent you this link on WhatsApp. Connecting gives this computer its own key to ${link.host}.`
      : `You'll sign in on ${link.host} with Face ID, Touch ID, your fingerprint or a code on WhatsApp.`)
      + (link.secure ? '' : '\n\nThis address is not encrypted (http). Connect only if it is your own network.'),
  })
  if (response !== 0) return
  await page.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('omni-desktop:connect', { detail: ${JSON.stringify({ url: link.url, ...(link.grant ? { grant: link.grant } : {}) })} }))`)
}

// app.exit skips before-quit, so dsh is stopped here: a start that fails after dsh came up
// must not leave it running on loopback with no window.
function fail(error) {
  quitting = true
  sendState({ status: `${PRODUCT} could not start.`, problem: true })
  dialog.showErrorBox(`${PRODUCT} could not start`, `${error?.message ?? error}\n\nLog: ${join(home, 'logs', 'dsh.log')}`)
  void stopDsh(dshChild).finally(() => app.exit(1))
}

// macOS's app menu: the system's usual menus, with Check for Updates under the app's name.
function appMenu() {
  return Menu.buildFromTemplate([
    { label: PRODUCT, submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => void checkForUpdates() },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])
}

async function launch() {
  // No menu bar on Linux; macOS keeps its app menu for the usual shortcuts.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  else {
    app.setAboutPanelOptions({ applicationName: PRODUCT })
    Menu.setApplicationMenu(appMenu())
  }
  mkdirSync(join(home, 'logs'), { recursive: true })
  started.mark(`${app.getVersion()} ready`)
  openWindow()
  nativeTheme.on('updated', followTheme)
  const resources = resourcesOf({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
  const { target } = installProfile({ dshHome: join(home, 'dsh'), source: resources.profile })
  pinProfileStore({ target, home, layout: storeLayoutOf(resources.pnpm) })
  const port = await freePort()
  const log = createWriteStream(join(home, 'logs', 'dsh.log'), { flags: 'a' })
  // Electron's own binary runs dsh as Node, so the app ships one runtime.
  const binDir = writeTools({ dir: join(home, 'bin'), node: process.execPath, pnpm: resources.pnpm })
  // `--preload=omni|genie` from `omni desktop` / `genie desktop`, kept in Automagik's home.
  const preload = preloadOf({ home: root, argv: process.argv, env: process.env })
  // A new anonymous id every launch (dsh.js ANONYMOUS_ID); the privacy overlay always applies.
  rmSync(join(home, 'dsh', ANONYMOUS_ID), { force: true })
  dsh = await startDsh({ node: process.execPath, bin: resources.bin, env: dshEnv({ home, electronAsNode: true, binDir, preload }), port, cwd: home, log, privacy: resources.privacy, onSpawn: (child) => { dshChild = child; started.mark('dsh spawned') } })
  started.mark('dsh ready')
  dsh.child.once('exit', (code) => {
    if (!quitting) fail(new Error(`dsh stopped (${code}).`))
  })
  const origin = new URL(dsh.url).origin
  harden(origin)
  if (!window) return
  page = new WebContentsView({
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      // Chromium fetches dictionaries from Google on Linux and Windows; macOS checks spelling itself.
      spellcheck: process.platform === 'darwin',
    },
  })
  page.setBackgroundColor(tableColor(nativeTheme.shouldUseDarkColors))
  page.webContents.on('before-input-event', (event, input) => shortcut(event, input))
  page.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) sendState({ status: `${PRODUCT} could not load (${description}).`, problem: true })
  })
  // Laid in once painted, so the frame's splash stays up until there is something to show.
  page.webContents.once('did-finish-load', async () => {
    if (!window) return
    await page.webContents.insertCSS(PAGE_IN_CSS).catch(() => {})
    if (!window) return
    window.contentView.addChildView(page)
    ready = true
    layout()
    started.mark('page in')
    const back = restartLine(RESTART_NOTE(), { version: app.getVersion() })
    if (back) startLog(back)
    if (pendingLink) void connectFromLink()
  })
  // Before the page load: a page that fails to load must not stop the app from updating.
  watchUpdates()
  await page.webContents.loadURL(dsh.url)
}

// See update.js. Its log is logs/update.log.
function watchUpdates() {
  const mode = updateMode({ packaged: app.isPackaged, platform: process.platform, env: process.env })
  if (!mode || updates) return
  const out = createWriteStream(join(home, 'logs', 'update.log'), { flags: 'a' })
  const line = level => message => out.write(`${new Date().toISOString()} ${level} ${message}\n`)
  const log = { info: line('info'), warn: line('warn'), error: line('error'), debug() {} }
  log.info(`update: ${app.getVersion()} checks for updates (${mode})`)
  updates = startUpdates({
    updater: updaterModule.autoUpdater,
    current: app.getVersion(),
    platform: process.platform,
    env: process.env,
    log,
    mode,
    onState: (state) => {
      update = state
      checkFailed = false
      publishUpdate()
    },
  })
  if (mode !== 'auto') return
  // A downloaded update goes in while the person is away (idle.js); else at a quit or Restart.
  const away = setInterval(() => {
    const why = awayInstall({
      ready: updates.ready,
      idleMs: powerMonitor.getSystemIdleTime() * 1000,
      focused: window?.isFocused() === true,
      busy: readBusy(busyFileOf(home)),
    })
    if (why !== 'install') return
    clearInterval(away)
    log.info(`update: ${updates.ready} installs now, while the computer is not in use`)
    installUpdate({ away: true })
  }, LOOK_EVERY_MS)
}

// The update shows in the page's sidebar (the Bot team's, bottom left, as in DSH's own app),
// through the page's preload (preload.cjs `omniDesktop.updates`).
const presentUpdate = () => updatePresentation(update, { checking, failed: checkFailed })
function publishUpdate() {
  if (page && !page.webContents.isDestroyed()) page.webContents.send('automagik-updates', presentUpdate())
}
const fromPage = event => page !== null && event.sender === page.webContents
ipcMain.handle('automagik-updates-status', event => (fromPage(event) ? presentUpdate() : null))
// The sidebar's update button: restart into a downloaded update, open the release page of one
// this copy cannot install itself (a deb), or check.
ipcMain.handle('automagik-updates-open', async (event) => {
  if (!fromPage(event)) return
  if (updates?.ready) return installUpdate()
  if (update?.state === 'available' && isReleasePage(update.page)) return void shell.openExternal(update.page)
  await checkForUpdates({ quiet: true })
})

// Check for Updates (the app menu, the title bar's menu, the sidebar): the sidebar shows the
// check and what it found; asked from a menu, a check that finds nothing says so in a dialog.
async function checkForUpdates({ quiet = false } = {}) {
  if (!updates) {
    if (!quiet) void dialog.showMessageBox(window ?? undefined, { type: 'info', message: `Updates are off in this copy of ${PRODUCT}` })
    return
  }
  checking = true
  checkFailed = false
  publishUpdate()
  const { result } = await updates.check()
  checking = false
  checkFailed = result === 'error'
  publishUpdate()
  if (quiet) return
  if (result === 'latest') void dialog.showMessageBox(window ?? undefined, { type: 'info', message: `${PRODUCT} is up to date`, detail: `Version ${app.getVersion()}` })
  else if (result === 'error') void dialog.showMessageBox(window ?? undefined, { type: 'warning', message: 'Could not check for updates', detail: 'Check your connection and try again.' })
}

// The title bar's menu, on a right click; on macOS the app menu has the same entry.
function barMenu() {
  return Menu.buildFromTemplate([{ label: 'Check for Updates…', click: () => void checkForUpdates() }])
}

// Restart into the downloaded update: dsh is stopped first, as on any quit. macOS then checks
// the new app for up to a minute before it opens it, with nothing on screen, and the app opened
// again meanwhile cancels the install. So the sidebar says "Installing" before the window goes,
// and on macOS a notification goes on saying it while macOS swaps the app.
const RESTART_NOTICE_MS = 600
function installUpdate({ away = false } = {}) {
  if (!updates?.ready || quitting) return
  quitting = true
  const out = leave(away ? 'update while away' : 'update restart')
  update = { ...update, state: 'restarting' }
  publishUpdate()
  if (process.platform === 'darwin' && Notification.isSupported()) {
    new Notification({ title: `Updating ${PRODUCT}`, body: `${PRODUCT} reopens by itself in about a minute. Leave it closed until then.`, silent: true }).show()
  }
  setTimeout(() => {
    void fade(window, { to: 0, reduced: lessMotion() })
      .then(() => { out.mark('window gone'); return stopDsh(dshChild) })
      .finally(() => {
        out.mark('dsh stopped')
        noteRestart(RESTART_NOTE(), { from: app.getVersion(), to: update?.version })
        updates.install()
      })
  }, RESTART_NOTICE_MS)
}

const WINDOW_PREFERENCES = {
  preload: join(HERE, 'shell-preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
  spellcheck: false,
}

// The system turned light or dark: the table under dsh's page (and macOS's solid window) turns
// with it. The frame page follows on its own (prefers-color-scheme).
function followTheme() {
  const color = tableColor(nativeTheme.shouldUseDarkColors)
  page?.setBackgroundColor(color)
  if (process.platform === 'darwin') window?.setBackgroundColor(color)
}

function openWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: PRODUCT,
    show: false,
    ...windowChrome(process.platform, { dark: nativeTheme.shouldUseDarkColors }),
    webPreferences: WINDOW_PREFERENCES,
  })
  const frame = window.webContents
  frame.setWindowOpenHandler(() => ({ action: 'deny' }))
  frame.on('will-navigate', event => event.preventDefault())
  frame.on('before-input-event', (event, input) => shortcut(event, input))
  frame.once('did-finish-load', () => sendState())
  window.once('ready-to-show', () => {
    started.mark('window shown')
    void fade(window, { to: 1, reduced: lessMotion() })
  })
  // Closing fades the window out first; 'closed' and quitting follow.
  window.on('close', (event) => {
    if (closing || quitting || process.platform === 'linux') return
    event.preventDefault()
    closing = true
    const out = leave('quit')
    void fade(window, { to: 0, reduced: lessMotion() }).finally(() => { out.mark('window gone'); window?.destroy() })
  })
  for (const change of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) window.on(change, layout)
  window.on('closed', () => { window = null; page = null })
  void window.loadFile(join(HERE, 'shell.html'))
}

// dsh's page goes below the frame's title bar; see frame.js.
function layout() {
  if (!window) return
  const maximized = window.isMaximized() || window.isFullScreen()
  if (page && ready) {
    const { bounds, radius } = pageLayout(window.getContentBounds(), { platform: process.platform, maximized })
    page.setBounds(bounds)
    page.setBorderRadius(radius)
  }
  sendState()
}

function sendState(extra = {}) {
  if (!window || window.webContents.isLoading()) return
  const maximized = window.isMaximized() || window.isFullScreen()
  window.webContents.send('omni-window-state', { maximized, ready, ...extra })
}

ipcMain.on('omni-window', (event, action) => {
  if (!window || event.sender !== window.webContents || !WINDOW_ACTIONS.has(action)) return
  if (action === 'menu') barMenu().popup({ window })
  else if (action === 'minimize') window.minimize()
  else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
  else window.close()
})

// Without a menu on Linux, the few shortcuts a window is expected to have.
function shortcut(event, input) {
  if (input.type !== 'keyDown' || process.platform === 'darwin') return
  const key = input.key.toLowerCase()
  const zoom = page?.webContents
  if (input.control && key === 'q') app.quit()
  else if (input.key === 'F11') window?.setFullScreen(!window.isFullScreen())
  else if (input.control && (key === '=' || key === '+') && zoom) zoom.setZoomLevel(zoom.getZoomLevel() + 0.5)
  else if (input.control && key === '-' && zoom) zoom.setZoomLevel(zoom.getZoomLevel() - 0.5)
  else if (input.control && key === '0' && zoom) zoom.setZoomLevel(0)
  else return
  event.preventDefault()
}

function harden(origin) {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (navigationOf(url, origin) === 'external') void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const verdict = navigationOf(url, origin)
      if (verdict === 'allow') return
      event.preventDefault()
      if (verdict === 'external') void shell.openExternal(url)
    })
    // A server redirect is a navigation too.
    contents.on('will-redirect', (event, url) => {
      if (navigationOf(url, origin) !== 'allow') event.preventDefault()
    })
    contents.on('will-attach-webview', event => event.preventDefault())
  })
  // The page asks for nothing beyond notifications and the clipboard.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(new URL(contents.getURL()).origin === origin && ['notifications', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission))
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting || !dshChild) return
  quitting = true
  event.preventDefault()
  const out = leave('quit')
  // The window goes at once; dsh stops behind it, so a quit never looks stuck.
  void fade(window, { to: 0, reduced: lessMotion() })
    .then(() => { out.mark('window gone'); return stopDsh(dshChild) })
    .finally(() => { out.mark('dsh stopped'); app.quit() })
})
