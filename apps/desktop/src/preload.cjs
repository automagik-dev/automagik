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

// The Bot browsers (main.js, bot-views.js), in the shape the Bot team's panel drives
// (bots-dsh src/client/bot-browsers.js `bridge.views`): each tab is a view the app lays over
// the panel's rectangle. `forget` closes a deleted Bot's tabs and clears its sign-ins.
// `dsBotApp` carries only this; the rest of DS Bot's app bridge is not the app's.
const viewListeners = new Set()
ipcRenderer.on('automagik-browser-view', (_event, change) => {
  for (const listener of [...viewListeners]) {
    try { listener(change) } catch (error) { console.error('Automagik: a browser view listener failed', error) }
  }
})
const call = (channel, ...args) => ipcRenderer.invoke(`automagik-browser-${channel}`, ...args)
const browser = Object.freeze({
  forget: key => call('forget', String(key)),
  views: Object.freeze({
    create: (botId, tabId, url) => call('create', String(botId), String(tabId), typeof url === 'string' ? url : undefined),
    sync: botId => call('sync', String(botId)),
    place: (tabId, rect, visible) => call('place', String(tabId), rect ?? null, visible === true),
    navigate: (botId, tabId, url) => call('navigate', String(botId), String(tabId), String(url)),
    command: (botId, tabId, command) => call('command', String(botId), String(tabId), String(command)),
    focus: (botId, tabId) => call('focus', String(botId), String(tabId)),
    read: (botId, tabId, script) => call('read', String(botId), String(tabId), String(script)),
    close: (botId, tabId) => call('close', String(botId), String(tabId)),
    hold: (botId, held) => call('hold', String(botId), held === true),
    subscribe(listener) {
      viewListeners.add(listener)
      return () => viewListeners.delete(listener)
    },
  }),
})
contextBridge.exposeInMainWorld('dsBotApp', Object.freeze({ browser }))

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
