// How the app's window looks. No system frame and no border anywhere: on Linux the window
// is transparent and the shell page (shell.html) draws its rounded shape, title bar and
// window buttons; on macOS there is no bar: dsh's page fills the window, and the system's
// traffic lights sit in the sidebar's top row, beside its buttons (bots-dsh sidebar.js), as
// in Claude, Codex or DSH's own app.
// The frame is the clay theme's table (apps/bots-dsh src/client/clay.js), light or dark as
// the system is: cream by day, the same clay at night.
// dsh's page is a view laid in edge to edge below the bar, its corners rounded with
// the window's. Chromium keeps a frameless window's resize edge over the view.

import { PRODUCT } from './identity.js'

export const BAR_HEIGHT = 40
export const RADIUS = 14
// The traffic lights' top left on macOS: centred on the sidebar's top row (its 30px buttons,
// 18px down the page), inside the sidebar's card.
export const TRAFFIC_LIGHTS = Object.freeze({ x: 26, y: 32 })

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
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { ...TRAFFIC_LIGHTS }, backgroundColor: tableColor(dark) }
  }
  return { frame: false, transparent: true, backgroundColor: '#00000000', autoHideMenuBar: true }
}

/**
 * Where dsh's page goes in a window whose content is `size`, and how round its corners
 * are: below the bar and rounded with the window on Linux; the whole window on macOS (whose
 * window rounds itself), and square when maximized.
 */
export function pageLayout(size, { platform, maximized }) {
  const top = platform === 'darwin' ? 0 : BAR_HEIGHT
  return {
    bounds: { x: 0, y: top, width: size.width, height: Math.max(0, size.height - top) },
    radius: platform === 'darwin' || maximized ? 0 : RADIUS,
  }
}

/** What the shell page may ask the main process for: the window buttons and the title bar's menu. */
export const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'close', 'menu'])

/**
 * The update as the page's sidebar shows it, at the bottom left beside the settings, as DSH's
 * own desktop app does (its DesktopUpdateIndicator): `{ phase, version?, percent?, failure? }`,
 * phase one of idle, checking, available, downloading, installing, ready, error. `update` is
 * update.js's state; `checking` and `failed` (a check that failed) come from Check for Updates.
 */
export function updatePresentation(update, { checking = false, failed = false, plugins, fetching } = {}) {
  const version = update?.version ? { version: update.version } : {}
  if (update?.state === 'restarting') return { phase: 'installing', ...version }
  if (update?.state === 'ready') return { phase: 'ready', ...version }
  // Plugins the lane staged (lane.js) are ready too: a start puts them in, in a few seconds.
  if (plugins && update?.state !== 'downloading' && update?.state !== 'available') return { phase: 'ready', version: plugins, kind: 'plugins' }
  if (update?.state === 'downloading') return { phase: 'downloading', ...version, percent: Math.floor(update.percent ?? 0) }
  if (update?.state === 'available') return { phase: 'available', ...version }
  // Plugins the lane is downloading: the sidebar shows them coming, not only once staged.
  if (fetching) return { phase: 'downloading', version: fetching.version, percent: Math.floor(fetching.percent ?? 0), kind: 'plugins' }
  if (checking) return { phase: 'checking' }
  if (failed) return { phase: 'error', failure: 'check' }
  return { phase: 'idle' }
}
