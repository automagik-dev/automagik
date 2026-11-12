// Where the machine DSH runs on is, seen from whoever reads the welcome: here (the person sits at
// it) or remote (they reach it from another machine), and its OS family. The copy that names it
// ("Omni on this Mac") describes DSH's machine, so its OS comes from the host (state's `machine`,
// src/host/host.js). Remote or uncertain locations use workspace wording instead. The viewer's
// own OS is only ever compared with the host's, never used to name it.

const DESKTOP_OS = { darwin: 'macos', linux: 'linux', win32: 'windows' }
const OS_FAMILIES = new Set(['macos', 'linux', 'windows', 'other'])

/**
 * True when a page's hostname is this machine's loopback: localhost and *.localhost (Chromium
 * resolves those to loopback), any 127.x.x.x, ::1, ::ffff:127.x.x.x (and the ::ffff:7f00:1 form
 * URL normalises it to), and 0.0.0.0. Brackets ([::1]) are ignored. The machine's own LAN or
 * Tailscale address is not loopback: a viewer on the host through it reads as remote.
 */
export function isLoopbackHost(hostname) {
  if (typeof hostname !== 'string') return false
  const name = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
  if (name === '') return false
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  if (name === '::1' || name === '0:0:0:0:0:0:0:1' || name === '0.0.0.0') return true
  const v4 = name.replace(/^::ffff:/, '')
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v4)) return true
  // ::ffff:7f00:1, the hex form of ::ffff:127.0.0.1: 7fxx in the high group is 127.x.
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(name)
}

/**
 * The viewer's OS family from its browser: 'macos', 'windows', 'linux', 'other', or undefined
 * when the browser does not say. Chromium's userAgentData first, then navigator.platform
 * (Firefox, Safari). Android reads 'other', not 'linux'.
 */
export function viewerOsOf(navigator) {
  if (!navigator || typeof navigator !== 'object') return undefined
  const hinted = navigator.userAgentData?.platform
  if (typeof hinted === 'string' && hinted !== '') {
    if (/^macOS$/i.test(hinted)) return 'macos'
    if (/^Windows$/i.test(hinted)) return 'windows'
    if (/^Linux$/i.test(hinted)) return 'linux'
    return 'other'
  }
  const platform = typeof navigator.platform === 'string' ? navigator.platform : ''
  if (platform === '') return undefined
  if (/^Mac/i.test(platform)) return 'macos'
  if (/^Win/i.test(platform)) return 'windows'
  if (/^Linux/i.test(platform)) return /Android/i.test(String(navigator.userAgent ?? '')) ? 'other' : 'linux'
  return 'other'
}

const osOfHost = machine => (OS_FAMILIES.has(machine?.os) ? machine.os : undefined)

/**
 * { at: 'here' | 'remote' | 'unknown', os? } for the machine DSH runs on:
 *   1. inside Automagik's desktop app (window.omniDesktop), here, with the app's own OS;
 *   2. a page opened from an address that is not loopback, remote;
 *   3. loopback: remote when DSH was launched over SSH, or when the viewer's OS and the host's
 *      are both known and differ (an SSH tunnel from a Mac to a Linux server); here otherwise;
 *   4. nothing readable, unknown.
 */
export function whereOf({ machine, scope = globalThis } = {}) {
  const host = osOfHost(machine)
  const desktop = scope?.omniDesktop
  if (desktop !== undefined && desktop !== null) {
    const platform = desktop.platform
    return { at: 'here', os: Object.hasOwn(DESKTOP_OS, platform) ? DESKTOP_OS[platform] : host ?? 'other' }
  }
  const hostname = scope?.location?.hostname
  const readable = typeof hostname === 'string' && hostname !== ''
  if (readable && !isLoopbackHost(hostname)) return { at: 'remote', os: host ?? 'other' }
  if (host === undefined) return { at: 'unknown' }
  if (machine.remoteHint === true) return { at: 'remote', os: host }
  if (!readable) return { at: 'unknown' }
  const viewer = viewerOsOf(scope?.navigator)
  if (viewer !== undefined && viewer !== 'other' && host !== 'other' && viewer !== host) return { at: 'remote', os: host }
  return { at: 'here', os: host }
}
