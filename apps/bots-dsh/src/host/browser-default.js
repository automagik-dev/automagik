// The Bot browser is on unless the config turns it off (`browserPlugin: false`) or the host is
// Unfold's own instance (AUTOMAGIK_HOST=unfold): each Bot
// drives the refs plugin (browser-plugins.js) in a profile of its own, through
// playwright-core and a Chrome-family browser already on this computer, so nothing is
// downloaded. `browserExecutablePath` names another; `playwrightUrl` another Playwright.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { inUnfoldHost } from './constants.js'

export const DEFAULT_BROWSER_PLUGIN = 'refs'
export const DEFAULT_PLAYWRIGHT = 'playwright-core'

/** The browser plugin this config runs, or undefined when the Bot browser is off. */
export function browserPluginOf(config, env = process.env) {
  // Unfold's own instance has no Bot browser, whatever the config says.
  if (inUnfoldHost(env)) return undefined
  const name = config.browserPlugin
  if (name === false || name === 'off' || name === '') return undefined
  return name ?? (config.browserPluginApi ? undefined : DEFAULT_BROWSER_PLUGIN)
}

// Where each system keeps the Chrome-family browsers, most common first. Snap's Chromium
// is left out: its confinement cannot write a profile under a hidden folder of the home.
function candidates(platform, env, home) {
  if (platform === 'darwin') {
    const apps = [['Google Chrome', 'Google Chrome'], ['Microsoft Edge', 'Microsoft Edge'], ['Chromium', 'Chromium'], ['Brave Browser', 'Brave Browser']]
    return ['/Applications', join(home, 'Applications')].flatMap(root => apps.map(([app, binary]) => join(root, `${app}.app`, 'Contents', 'MacOS', binary)))
  }
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean)
    return roots.flatMap(root => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ])
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
    .flatMap(name => ['/usr/bin', '/usr/local/bin', '/opt/google/chrome'].map(dir => join(dir, name)))
}

/** The first Chrome-family browser installed here, or undefined. */
export function findBrowser({ platform = process.platform, env = process.env, home = homedir(), exists = existsSync } = {}) {
  return candidates(platform, env, home).find(path => exists(path))
}

export const NO_BROWSER_FOUND = 'No Chrome, Edge, Chromium or Brave is installed on this computer, so your browser cannot open. Tell the user to install Google Chrome; it is used as it is, with a profile of your own.'
