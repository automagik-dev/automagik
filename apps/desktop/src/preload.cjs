// The window runs dsh's web app as a plain page; it needs nothing from Electron. This
// preload only tells the page it is inside the desktop app; `omniDesktop` and its `app` value
// are what the page's plugins look for, so they keep the name the app shipped under.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('omniDesktop', Object.freeze({ app: 'omni-desktop', platform: process.platform }))
