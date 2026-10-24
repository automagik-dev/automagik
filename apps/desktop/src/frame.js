// How the app's window looks. No system frame and no border anywhere: on Linux the window
// is transparent and the shell page (shell.html) draws its rounded shape, title bar and
// window buttons; on macOS the title bar is hidden behind the system's own traffic lights.
// The frame is the clay theme's table (apps/bots-dsh src/client/clay.js), light or dark as
// the system is: cream by day, the same clay at night.
// dsh's page is a view laid in edge to edge below the bar, its corners rounded with
// the window's. Chromium keeps a frameless window's resize edge over the view.

import { PRODUCT } from './identity.js'

export const BAR_HEIGHT = 40
export const RADIUS = 14

// The clay table (CLAY_LIGHT.bg and CLAY_DARK.bg in the clay theme): what a window or page
// shows before its page paints, so a light system never sees a dark flash.
export const TABLE = Object.freeze({ light: '#f6eee2', dark: '#1e1923' })

/** The table colour for the system's light or dark setting (Electron's nativeTheme). */
export const tableColor = dark => (dark ? TABLE.dark : TABLE.light)

/**
 * BrowserWindow options for the frame on `platform`. macOS gets the solid table, not
 * vibrancy: clay is matte and opaque, and the desktop blurred through it would not read as
 * clay. Linux stays transparent so the shell page can round the window's corners.
 */
export function windowChrome(platform, { dark = false } = {}) {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 }, backgroundColor: tableColor(dark) }
  }
  return { frame: false, transparent: true, backgroundColor: '#00000000', autoHideMenuBar: true }
}

/**
 * Where dsh's page goes in a window whose content is `size`, and how round its corners
 * are: rounded with the window on Linux, square when maximized or on macOS (whose window
 * rounds itself).
 */
export function pageLayout(size, { platform, maximized }) {
  return {
    bounds: { x: 0, y: BAR_HEIGHT, width: size.width, height: Math.max(0, size.height - BAR_HEIGHT) },
    radius: platform === 'darwin' || maximized ? 0 : RADIUS,
  }
}

/**
 * What the shell page may ask the main process for: the window buttons, the update notice's
 * buttons (restart into it, Later, open the release page) and the title bar's menu.
 */
export const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'close', 'update', 'update-later', 'update-page', 'menu'])

/**
 * What the title bar shows about updates (see update.js): null, or `{ text?, title?, actions }`,
 * each action `{ act, label, primary? }` naming a WINDOW_ACTIONS entry. A ready or available
 * update first shows as a notice with Later; after Later only a small button stays. A message
 * (the menu's Check for Updates answering) shows while there is no update to show.
 */
export function updateView(update, { dismissed = false, message = null } = {}) {
  const version = update?.version ? `${PRODUCT} ${update.version}` : 'An update'
  if (update?.state === 'downloading') {
    return { text: `Updating · ${update.percent ?? 0}%`, title: `Downloading ${version}`, actions: [] }
  }
  if (update?.state === 'ready') {
    if (dismissed) return { title: `${version} is ready: restart to use it`, actions: [{ act: 'update', label: 'Restart to update', primary: true }] }
    return { text: `${version} is ready.`, actions: [{ act: 'update', label: 'Restart now', primary: true }, { act: 'update-later', label: 'Later' }] }
  }
  if (update?.state === 'available') {
    if (dismissed) return { title: 'Open the release page to download it', actions: [{ act: 'update-page', label: `${version} is out` }] }
    return { text: `${version} is out.`, actions: [{ act: 'update-page', label: 'Download', primary: true }, { act: 'update-later', label: 'Later' }] }
  }
  return message ? { text: message, actions: [] } : null
}
