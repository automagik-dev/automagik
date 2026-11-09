// The macOS application menu. The File menu is ours: Cmd+W closes the focused pane or tab in
// dsh's page (pane-close.js), never the window and never the app; the window's own close button
// is the one that asks first while a bot runs (quit-guard.js). No Electron here: main.js builds
// this template with Menu, and the tests inspect it without Electron.

/** The pane's key, the one dsh's page binds `page.close` to in the runtime the page runs as. */
export const CLOSE_PANE_ACCELERATOR = 'CmdOrCtrl+W'

/**
 * The menu template for `platform`, or null where the app has no menu bar. `product` is the
 * app menu's title; `dshTuiLabel` adds the dsh-TUI entry when the platform supports it.
 */
export function appMenuTemplate({
  product,
  platform = process.platform,
  dshTuiLabel = null,
  onCheckForUpdates = () => {},
  onDshTui = () => {},
  onClosePane = () => {},
}) {
  if (platform !== 'darwin') return null
  return [
    { label: product, submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => onCheckForUpdates() },
      ...(dshTuiLabel ? [{ label: dshTuiLabel, click: () => onDshTui() }] : []),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    // No `fileMenu` and no `close` role: those carry Cmd+W, which must reach dsh's page.
    { label: 'File', submenu: [
      { label: 'Close Pane', accelerator: CLOSE_PANE_ACCELERATOR, click: () => onClosePane() },
    ] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
}
