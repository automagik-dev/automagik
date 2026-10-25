// Updates: the app follows its own releases, `v<version>` in automagik-dev/automagik on
// GitHub (the ones `omni desktop` downloads). Builds released from automagik-dev/omni-desktop
// (up to 2.261023.x) reach these through that repository's last release, which is this app. A newer one downloads in the background and installs when
// the app quits, or at once from the title bar's Restart now. electron-updater downloads
// it, checks its sha512 and installs it (on macOS through Squirrel, which also requires the
// update to carry the running app's signature). This module picks the release: the newest
// one above this version, on this build's channel, that carries this platform's feed.
// A deb is the system package manager's to replace, so there the app only says a release is out.

export const RELEASES_URL = 'https://api.github.com/repos/automagik-dev/automagik/releases?per_page=50'
export const DESKTOP_TAG_PREFIX = 'v'
const DOWNLOADS = 'https://github.com/automagik-dev/automagik/releases/download/'
const RELEASE_PAGE = 'https://github.com/automagik-dev/automagik/releases/tag/'
export const FIRST_CHECK_MS = 20_000
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
export const RETRY_MS = 30 * 60 * 1000
// A network that changed or dropped during a check (Wi-Fi, a VPN, waking from sleep) is usually
// back within a minute: such a failure is retried that soon, a few times, before RETRY_MS.
export const QUICK_RETRY_MS = 60 * 1000
export const QUICK_RETRIES = 3
export const isTransient = error => /net::ERR_|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH/.test(String(error?.message ?? error ?? ''))

/** The update feed electron-updater reads for `platform`, or null where the app does not update. */
export function feedFileOf(platform) {
  if (platform === 'darwin') return 'latest-mac.yml'
  if (platform === 'linux') return 'latest-linux.yml'
  return null
}

/**
 * How this copy of the app updates: `auto` (a packaged build on macOS, or run from an
 * AppImage), `notify` (a packaged Linux build installed from the deb, which belongs to the
 * system's package manager: the app only says a release is out), or null (a dev run, another
 * platform, or OMNI_DESKTOP_UPDATES=off).
 */
export function updateMode({ packaged, platform, env }) {
  if (!packaged || env.OMNI_DESKTOP_UPDATES === 'off') return null
  if (platform === 'darwin') return 'auto'
  if (platform === 'linux') return env.APPIMAGE ? 'auto' : 'notify'
  return null
}

/** Whether this copy of the app replaces itself (see updateMode). */
export function updatesEnabled(options) {
  return updateMode(options) === 'auto'
}

/**
 * The channel this build follows: OMNI_DESKTOP_UPDATE_CHANNEL (`stable` or `prerelease`), else
 * the channel of its own release, else stable. A stable build never moves to a prerelease.
 */
export function channelOf(releases, { current, env = {} }) {
  const wanted = env.OMNI_DESKTOP_UPDATE_CHANNEL?.trim()
  if (wanted === 'stable' || wanted === 'prerelease') return wanted
  const own = (Array.isArray(releases) ? releases : []).find(release => release?.tag_name === `${DESKTOP_TAG_PREFIX}${current}`)
  return own?.prerelease === true ? 'prerelease' : 'stable'
}

/** OMNI_DESKTOP_UPDATE_FEED: a feed folder to take updates from instead (https, or http on loopback). */
export function feedOverride(env) {
  const raw = env.OMNI_DESKTOP_UPDATE_FEED?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.href.endsWith('/') ? url.href : `${url.href}/`
  } catch {}
  return null
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Semver precedence: negative when `a` is older than `b`, 0 when equal, NaN when either is not a version. */
export function compareVersions(a, b) {
  const x = VERSION.exec(a)
  const y = VERSION.exec(b)
  if (!x || !y) return Number.NaN
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i])
    if (d !== 0) return Math.sign(d)
  }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0
  const p = x[4].split('.')
  const q = y[4].split('.')
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    if (p[i] === q[i]) continue
    const pn = /^\d+$/.test(p[i])
    const qn = /^\d+$/.test(q[i])
    if (pn && qn) return Math.sign(Number(p[i]) - Number(q[i]))
    if (pn !== qn) return pn ? -1 : 1
    return p[i] < q[i] ? -1 : 1
  }
  return Math.sign(p.length - q.length)
}

/**
 * The newest desktop release above `current` on `channel` that carries `platform`'s update
 * feed: `{ version, url, page }`, where `url` is the folder electron-updater reads the feed from
 * and `page` the release's own page. Null when there is none. A prerelease is only offered on
 * the prerelease channel.
 */
export function pickUpdate(releases, { current, platform, channel = 'prerelease' }) {
  const feed = feedFileOf(platform)
  let best = null
  for (const release of Array.isArray(releases) ? releases : []) {
    const tag = release?.tag_name
    if (release?.draft || typeof tag !== 'string' || !tag.startsWith(DESKTOP_TAG_PREFIX)) continue
    if (release.prerelease === true && channel !== 'prerelease') continue
    const version = tag.slice(DESKTOP_TAG_PREFIX.length)
    if (!(compareVersions(version, current) > 0)) continue
    if (!release.assets?.some(asset => asset?.name === feed)) continue
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, url: `${DOWNLOADS}${encodeURIComponent(tag)}/`, page: `${RELEASE_PAGE}${encodeURIComponent(tag)}` }
    }
  }
  return best
}

export async function fetchReleases(fetchImpl = fetch) {
  const response = await fetchImpl(RELEASES_URL, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'omni-desktop' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for the desktop releases`)
  return response.json()
}

/**
 * Checks after FIRST_CHECK_MS and every CHECK_EVERY_MS (sooner, after RETRY_MS, when a check
 * failed), and reports to `onState`:
 * - `auto`: `{ version, state: 'downloading', percent }`, then `{ version, state: 'ready' }`;
 *   `install()` restarts into the downloaded update, which otherwise installs on quit.
 * - `notify`: `{ version, state: 'available', page }`; nothing is downloaded.
 * `check()` also serves the menu's Check for Updates, and answers what it found:
 * `{ result: 'latest' | 'found' | 'ready' | 'error' | 'busy', version? }`.
 */
export function startUpdates({ updater, current, platform, env, log, onState, mode = 'auto', releases = fetchReleases, timers = globalThis }) {
  let busy = false
  let pending = null
  let ready = null
  let retry = null
  let quickRetries = 0
  const auto = mode === 'auto'
  if (auto) {
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.allowDowngrade = false
    updater.logger = log
  }
  // On macOS the download is handed to Squirrel, which swaps the app on quit only once it has
  // the update too: until Squirrel says so, the update is not ready.
  const squirrel = auto && platform === 'darwin' ? updater.nativeUpdater : null
  const markReady = () => {
    if (ready) return
    ready = pending
    log.info(`update: ${ready} is ready and installs on quit`)
    onState({ version: ready, state: 'ready' })
  }
  if (auto) {
    updater.on('download-progress', progress => onState({ version: pending, state: 'downloading', percent: Math.round(progress?.percent ?? 0) }))
    updater.on('update-downloaded', info => {
      pending = info?.version ?? pending
      if (!squirrel) return markReady()
      log.info(`update: ${pending} is downloaded; macOS is preparing it`)
      onState({ version: pending, state: 'downloading', percent: 100 })
    })
    squirrel?.on('update-downloaded', markReady)
    squirrel?.on('error', error => log.warn(`update (macOS): ${error?.message ?? error}`))
    updater.on('error', (error) => {
      log.warn(`update: ${error?.message ?? error}`)
      retryLater(error)
    })
  }

  function retryLater(error) {
    if (retry !== null) return
    const soon = isTransient(error) && quickRetries < QUICK_RETRIES
    if (soon) quickRetries += 1
    retry = timers.setTimeout(() => { retry = null; void check() }, soon ? QUICK_RETRY_MS : RETRY_MS)
  }

  async function check() {
    if (ready) return { result: 'ready', version: ready }
    if (busy) return { result: 'busy' }
    busy = true
    try {
      const override = auto ? feedOverride(env) : null
      let update
      if (override) update = { version: null, url: override }
      else {
        const list = await releases()
        const channel = channelOf(list, { current, env })
        update = pickUpdate(list, { current, platform, channel })
        if (!update) {
          log.info(`update check: ${current} is the newest ${channel} release`)
          quickRetries = 0
          return { result: 'latest' }
        }
      }
      log.info(`update check: ${update.version ?? 'a release from the feed override'} is out`)
      if (!auto) {
        onState({ version: update.version, state: 'available', page: update.page })
        return { result: 'found', version: update.version }
      }
      pending = update.version
      // GitHub's download host answers a request for several ranges at once with 501, which
      // costs the whole app instead of the blocks that changed: ask for them one range at a time.
      updater.setFeedURL({ provider: 'generic', url: update.url, useMultipleRangeRequest: false })
      await updater.checkForUpdates()
      quickRetries = 0
      return { result: 'found', version: update.version }
    } catch (error) {
      log.warn(`update check: ${error?.message ?? error}`)
      retryLater(error)
      return { result: 'error' }
    } finally {
      busy = false
    }
  }

  const first = timers.setTimeout(check, FIRST_CHECK_MS)
  const every = timers.setInterval(check, CHECK_EVERY_MS)
  return {
    check,
    get ready() { return ready },
    install: () => { if (ready) updater.quitAndInstall(false, true) },
    stop: () => {
      timers.clearTimeout(first)
      timers.clearInterval(every)
      if (retry !== null) timers.clearTimeout(retry)
    },
  }
}

/** Whether `url` is a desktop release page, the only page the notice may open. */
export function isReleasePage(url) {
  return typeof url === 'string' && url.startsWith(RELEASE_PAGE) && !url.slice(RELEASE_PAGE.length).includes('/')
}
