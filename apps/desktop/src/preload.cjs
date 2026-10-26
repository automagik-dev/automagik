// The window runs dsh's web app as a plain page. This preload tells the page it is inside the
// desktop app (`omniDesktop` and its `app` value are what the page's plugins look for, so they
// keep the name the app shipped under) and hands it the app's update, for the Bot team's
// sidebar to show: `updates` has DSH's desktop shape (status, open, subscribe), under our own
// name, since a page that finds `dshDesktop` takes itself for DSH's own app.
const { contextBridge, ipcRenderer } = require('electron')

const updates = Object.freeze({
  status: () => ipcRenderer.invoke('automagik-updates-status'),
  open: () => ipcRenderer.invoke('automagik-updates-open'),
  subscribe(listener) {
    const handle = (_event, presentation) => listener(presentation)
    ipcRenderer.on('automagik-updates', handle)
    return () => ipcRenderer.off('automagik-updates', handle)
  },
})

contextBridge.exposeInMainWorld('omniDesktop', Object.freeze({ app: 'omni-desktop', platform: process.platform, updates }))

// The page's styles know they are in the app, on which system, and whether it is full screen:
// on macOS the sidebar's top row makes room for the traffic lights and drags the window
// (bots-dsh sidebar.js), and the title bar's brand is the only one.
const root = () => document.documentElement
const mark = () => { if (root()) root().dataset.automagikDesktop = process.platform }
mark()
document.addEventListener('DOMContentLoaded', mark)
ipcRenderer.on('automagik-window', (_event, state) => {
  if (!root()) return
  if (state?.fullScreen) root().dataset.automagikFullscreen = ''
  else delete root().dataset.automagikFullscreen
})
