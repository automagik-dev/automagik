import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { channelOf, compareVersions, feedFileOf, feedOverride, isReleasePage, pickUpdate, RETRY_MS, startUpdates, updateMode, updatesEnabled } from '../src/update.js'

const release = (tag, assets = ['latest-mac.yml', 'latest-linux.yml'], extra = {}) => ({ tag_name: tag, draft: false, assets: assets.map(name => ({ name })), ...extra })

test('versions compare by semver: a dev cut is newer than the labs build of the version before it', () => {
  assert.equal(compareVersions('2.261022.1', '2.261019.10-labs.14'), 1)
  assert.equal(compareVersions('2.261019.10', '2.261019.10-labs.14'), 1)
  assert.equal(compareVersions('2.261019.10-labs.14', '2.261019.10-labs.9'), 1)
  assert.equal(compareVersions('2.261019.9', '2.261019.10'), -1)
  assert.equal(compareVersions('2.261019.10', '2.261019.10'), 0)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1)
  assert.ok(Number.isNaN(compareVersions('v2', '2.0.0')))
})

test("the update is the newest release above this one with this platform's feed; drafts and other tags are not", () => {
  const releases = [
    release('nightly'),
    release('v2.261025.1', ['latest-linux.yml']),
    release('v2.261024.2', ['latest-mac.yml', 'latest-linux.yml'], { draft: true }),
    release('v2.261023.1'),
    release('v2.261022.1'),
    release('v2.261019.1'),
    { tag_name: 7 },
    null,
  ]
  assert.deepEqual(pickUpdate(releases, { current: '2.261019.10-labs.14', platform: 'darwin' }), {
    version: '2.261023.1',
    url: 'https://github.com/automagik-dev/omni-desktop/releases/download/v2.261023.1/',
    page: 'https://github.com/automagik-dev/omni-desktop/releases/tag/v2.261023.1',
  })
  assert.equal(pickUpdate(releases, { current: '2.261019.10-labs.14', platform: 'linux' }).version, '2.261025.1')
  assert.equal(pickUpdate(releases, { current: '2.261025.1', platform: 'linux' }), null)
  assert.equal(pickUpdate(releases, { current: '2.261019.10', platform: 'win32' }), null)
  assert.equal(pickUpdate({ message: 'rate limited' }, { current: '2.261019.10', platform: 'darwin' }), null)
})

test('only a packaged build updates itself: on macOS, or from an AppImage; OMNI_DESKTOP_UPDATES=off turns it off', () => {
  assert.equal(updatesEnabled({ packaged: true, platform: 'darwin', env: {} }), true)
  assert.equal(updatesEnabled({ packaged: true, platform: 'darwin', env: { OMNI_DESKTOP_UPDATES: 'off' } }), false)
  assert.equal(updatesEnabled({ packaged: false, platform: 'darwin', env: {} }), false)
  assert.equal(updatesEnabled({ packaged: true, platform: 'linux', env: { APPIMAGE: '/home/u/Omni.AppImage' } }), true)
  assert.equal(updatesEnabled({ packaged: true, platform: 'linux', env: {} }), false)
  assert.equal(updatesEnabled({ packaged: true, platform: 'win32', env: {} }), false)
  assert.equal(feedFileOf('darwin'), 'latest-mac.yml')
  assert.equal(feedFileOf('linux'), 'latest-linux.yml')
})

test('a feed override is https, or http on loopback only', () => {
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'https://example.com/feed' }), 'https://example.com/feed/')
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'http://127.0.0.1:8099/' }), 'http://127.0.0.1:8099/')
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'http://example.com/feed' }), null)
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'file:///tmp/feed' }), null)
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'not a url' }), null)
  assert.equal(feedOverride({}), null)
})

function fakeUpdater() {
  const updater = new EventEmitter()
  updater.feeds = []
  updater.installs = []
  updater.setFeedURL = feed => updater.feeds.push(feed)
  updater.checkForUpdates = async () => ({ checked: true })
  updater.quitAndInstall = (...args) => updater.installs.push(args)
  return updater
}
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const noTimers = { setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {} }

test('a check points electron-updater at the chosen release, reports the download, and installs only once it is ready', async () => {
  const updater = fakeUpdater()
  const states = []
  const updates = startUpdates({
    updater, current: '2.261019.10-labs.14', platform: 'darwin', env: {}, log: quiet, timers: noTimers,
    onState: state => states.push(state),
    releases: async () => [release('v2.261022.1')],
  })
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.allowDowngrade, false)
  updates.install()
  assert.deepEqual(updater.installs, [])
  assert.deepEqual(await updates.check(), { result: 'found', version: '2.261022.1' })
  assert.deepEqual(updater.feeds, [{ provider: 'generic', url: 'https://github.com/automagik-dev/omni-desktop/releases/download/v2.261022.1/' }])
  updater.emit('download-progress', { percent: 41.6 })
  updater.emit('update-downloaded', { version: '2.261022.1' })
  assert.deepEqual(states, [{ version: '2.261022.1', state: 'downloading', percent: 42 }, { version: '2.261022.1', state: 'ready' }])
  assert.equal(updates.ready, '2.261022.1')
  assert.deepEqual(await updates.check(), { result: 'ready', version: '2.261022.1' })
  updates.install()
  assert.deepEqual(updater.installs, [[false, true]])
})

test('on macOS the update is ready only once Squirrel has it, since quitting earlier would not install it', async () => {
  const updater = fakeUpdater()
  updater.nativeUpdater = new EventEmitter()
  const states = []
  const updates = startUpdates({
    updater, current: '2.261019.10-labs.14', platform: 'darwin', env: {}, log: quiet, timers: noTimers,
    onState: state => states.push(state),
    releases: async () => [release('v2.261022.1')],
  })
  await updates.check()
  updater.emit('update-downloaded', { version: '2.261022.1' })
  assert.equal(updates.ready, null)
  updates.install()
  assert.deepEqual(updater.installs, [])
  updater.nativeUpdater.emit('update-downloaded')
  assert.equal(updates.ready, '2.261022.1')
  assert.deepEqual(states.at(-2), { version: '2.261022.1', state: 'downloading', percent: 100 })
  assert.deepEqual(states.at(-1), { version: '2.261022.1', state: 'ready' })
})

test('no newer release is logged as up to date; GitHub failing is a warning and a sooner retry', async () => {
  const updater = fakeUpdater()
  const infos = []
  const warnings = []
  const later = []
  const log = { ...quiet, info: message => infos.push(message), warn: message => warnings.push(message) }
  const timers = { ...noTimers, setTimeout: (fn, ms) => { later.push({ fn, ms }); return later.length } }
  const none = startUpdates({ updater, current: '2.261022.1', platform: 'linux', env: {}, log, timers, onState() {}, releases: async () => [release('v2.261022.1')] })
  assert.deepEqual(await none.check(), { result: 'latest' })
  assert.deepEqual(infos, ['update check: 2.261022.1 is the newest stable release'])
  later.length = 0
  let calls = 0
  const down = startUpdates({ updater, current: '2.261022.1', platform: 'linux', env: {}, log, timers, onState() {}, releases: async () => { calls++; throw new Error('offline') } })
  assert.deepEqual(await down.check(), { result: 'error' })
  assert.deepEqual(updater.feeds, [])
  assert.deepEqual(warnings, ['update check: offline'])
  const retry = later.filter(entry => entry.ms === RETRY_MS)
  assert.equal(retry.length, 1)
  await down.check()
  assert.equal(later.filter(entry => entry.ms === RETRY_MS).length, 1, 'one pending retry at a time')
  retry[0].fn()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 3)
})

test('an electron-updater error is logged and retried sooner', async () => {
  const updater = fakeUpdater()
  const later = []
  const warnings = []
  const timers = { ...noTimers, setTimeout: (fn, ms) => { later.push({ fn, ms }); return later.length } }
  startUpdates({ updater, current: '2.261022.1', platform: 'darwin', env: {}, log: { ...quiet, warn: m => warnings.push(m) }, timers, onState() {}, releases: async () => [] })
  updater.emit('error', new Error('sha512 checksum mismatch'))
  assert.deepEqual(warnings, ['update: sha512 checksum mismatch'])
  assert.equal(later.filter(entry => entry.ms === RETRY_MS).length, 1)
})

test('a deb build only says a release is out: no feed, no download, and its page to open', async () => {
  assert.equal(updateMode({ packaged: true, platform: 'linux', env: {} }), 'notify')
  assert.equal(updateMode({ packaged: true, platform: 'linux', env: { APPIMAGE: '/x' } }), 'auto')
  assert.equal(updateMode({ packaged: true, platform: 'darwin', env: {} }), 'auto')
  assert.equal(updateMode({ packaged: true, platform: 'linux', env: { OMNI_DESKTOP_UPDATES: 'off' } }), null)
  assert.equal(updateMode({ packaged: false, platform: 'linux', env: {} }), null)
  const updater = fakeUpdater()
  const states = []
  const updates = startUpdates({
    updater, current: '2.261022.1', platform: 'linux', env: {}, log: quiet, timers: noTimers, mode: 'notify',
    onState: state => states.push(state),
    releases: async () => [release('v2.261023.1')],
  })
  assert.deepEqual(await updates.check(), { result: 'found', version: '2.261023.1' })
  assert.deepEqual(states, [{ version: '2.261023.1', state: 'available', page: 'https://github.com/automagik-dev/omni-desktop/releases/tag/v2.261023.1' }])
  assert.deepEqual(updater.feeds, [])
  assert.equal(updater.autoDownload, undefined)
  assert.equal(updater.listenerCount('update-downloaded'), 0)
  assert.equal(isReleasePage(states[0].page), true)
  assert.equal(isReleasePage('https://github.com/automagik-dev/omni-desktop/releases/tag/v1/../../evil'), false)
  assert.equal(isReleasePage('https://evil.example/releases/tag/v1'), false)
})

test('a stable build never moves to a prerelease; a prerelease build follows both; the env can choose', () => {
  const releases = [
    release('v2.261024.1', undefined, { prerelease: true }),
    release('v2.261023.5'),
    release('v2.261023.3', undefined, { prerelease: true }),
  ]
  assert.equal(channelOf(releases, { current: '2.261023.5' }), 'stable')
  assert.equal(channelOf(releases, { current: '2.261023.3' }), 'prerelease')
  assert.equal(channelOf(releases, { current: '2.261023.4' }), 'stable')
  assert.equal(channelOf(releases, { current: '2.261023.5', env: { OMNI_DESKTOP_UPDATE_CHANNEL: 'prerelease' } }), 'prerelease')
  assert.equal(pickUpdate(releases, { current: '2.261023.5', platform: 'darwin', channel: 'stable' }), null)
  assert.equal(pickUpdate(releases, { current: '2.261023.5', platform: 'darwin', channel: 'prerelease' }).version, '2.261024.1')
  assert.equal(pickUpdate(releases, { current: '2.261023.3', platform: 'darwin', channel: 'stable' }).version, '2.261023.5')
})
