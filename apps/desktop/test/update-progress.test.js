// Issue #859: the app's update downloads behind the app with its bytes on show, a failure says
// what failed and leaves the running version alone, and nothing restarts the app but the person.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { updatePresentation } from '../src/frame.js'
import { SPLASH_SCRIPT, SPLASH_STEPS, dismissSplash, markSplashStep, showUpdateSplash, splashFiles } from '../src/splash.js'
import { isVerification, QUICK_RETRIES, QUICK_RETRY_MS, RETRY_MS, startUpdates } from '../src/update.js'

const release = tag => ({ tag_name: tag, draft: false, assets: [{ name: 'latest-mac.yml' }, { name: 'latest-linux.yml' }, { name: 'latest.yml' }] })
const quiet = { info() {}, warn() {}, error() {}, debug() {} }

function fakeUpdater() {
  const updater = new EventEmitter()
  updater.installs = []
  updater.setFeedURL = () => {}
  updater.checkForUpdates = async () => ({ checked: true })
  updater.quitAndInstall = (...args) => updater.installs.push(args)
  return updater
}

function recordingTimers() {
  const scheduled = []
  const timers = {
    setTimeout: (fn, ms) => { const entry = { fn, ms }; scheduled.push(entry); return entry },
    setInterval: () => ({ interval: true }),
    clearTimeout() {},
    clearInterval() {},
  }
  return { timers, retries: ms => scheduled.filter(entry => entry.ms === ms) }
}

// An app on 3.95.0 with 3.96.0 out, as main.js starts it.
function watching({ platform = 'linux', squirrel = false } = {}) {
  const updater = fakeUpdater()
  if (squirrel) updater.nativeUpdater = new EventEmitter()
  const states = []
  const warnings = []
  const infos = []
  const recorded = recordingTimers()
  const updates = startUpdates({
    updater, current: '3.95.0', platform, env: {}, timers: recorded.timers,
    log: { ...quiet, warn: message => warnings.push(message), info: message => infos.push(message) },
    onState: state => states.push(state),
    releases: async () => [release('v3.96.0')],
  })
  return { updater, states, warnings, infos, updates, ...recorded }
}

const MB = 1024 * 1024

test('the download reports its bytes beside the percent, and nothing is ready or installed meanwhile', async () => {
  const { updater, states, updates } = watching()
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('download-progress', { percent: 25.2, transferred: 25 * MB, total: 100 * MB, bytesPerSecond: 9 })
  updater.emit('download-progress', { percent: 99.6, transferred: 101 * MB, total: 100 * MB })
  assert.deepEqual(states, [
    { version: '3.96.0', state: 'downloading', percent: 25, transferred: 25 * MB, total: 100 * MB },
    // Never more than the whole.
    { version: '3.96.0', state: 'downloading', percent: 100, transferred: 100 * MB, total: 100 * MB },
  ])
  // Downloading is not ready: the app goes on as it is, and Restart does nothing yet.
  assert.equal(updates.ready, null)
  updates.install()
  assert.deepEqual(updater.installs, [])
})

test('a progress without usable byte counts keeps the shape it had', async () => {
  const { updater, states, updates } = watching()
  await updates.check()
  for (const progress of [{ percent: 10 }, { percent: 10, transferred: 5, total: 0 }, { percent: 10, transferred: Number.NaN, total: 9 }, { percent: 10, transferred: -1, total: 9 }, { percent: 10, transferred: '5', total: '9' }]) {
    updater.emit('download-progress', progress)
    assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'downloading', percent: 10 })
  }
})

test('a downloaded update waits: no restart, no install, until the person asks', async () => {
  const { updater, states, updates } = watching()
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('download-progress', { percent: 100, transferred: MB, total: MB })
  updater.emit('update-downloaded', { version: '3.96.0' })
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'ready' })
  // Checks go on, and none of them installs.
  assert.deepEqual(await updates.check(), { result: 'ready', version: '3.96.0' })
  assert.deepEqual(updater.installs, [])
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'ready' })
  // The person's Restart, and only that.
  updates.install()
  assert.deepEqual(updater.installs, [[false, true]])
})

test('a download that fails says so, keeps the running version, and the next check tries again', async () => {
  const { updater, states, warnings, infos, updates, retries } = watching()
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('download-progress', { percent: 40, transferred: 40, total: 100 })
  updater.emit('error', new Error('the server closed the connection'))
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'failed', failure: 'download' })
  assert.equal(retries(RETRY_MS).length, 1, 'a retry is scheduled')
  assert.deepEqual(warnings, ['update: the server closed the connection'])
  assert.match(infos.at(-1), /3\.96\.0 did not download; 3\.95\.0 stays/)
  // No half-applied state: nothing is ready, and Restart installs nothing.
  assert.equal(updates.ready, null)
  updates.install()
  assert.deepEqual(updater.installs, [])
  // The next check takes the failure away and the download starts over.
  assert.deepEqual(await updates.check(), { result: 'found', version: '3.96.0' })
  assert.deepEqual(states.at(-1), { state: 'idle' })
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('update-downloaded', { version: '3.96.0' })
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'ready' })
})

test('an update whose hash or signature is wrong is a verification failure, and is never ready', async () => {
  assert.equal(isVerification(Object.assign(new Error('boom'), { code: 'ERR_CHECKSUM_MISMATCH' })), true)
  assert.equal(isVerification(Object.assign(new Error('boom'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })), true)
  assert.equal(isVerification(new Error('sha512 checksum mismatch, expected a, got b')), true)
  assert.equal(isVerification(new Error('Code signature at URL file:///x did not pass validation')), true)
  assert.equal(isVerification(new Error('New version 3.96.0 is not signed by the application owner')), true)
  assert.equal(isVerification(new Error('net::ERR_NETWORK_CHANGED')), false)
  assert.equal(isVerification(new Error('GitHub answered 404 for the desktop releases')), false)
  assert.equal(isVerification(undefined), false)

  const { updater, states, updates } = watching()
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('download-progress', { percent: 100, transferred: 9, total: 9 })
  updater.emit('error', Object.assign(new Error('sha512 checksum mismatch, expected a, got b'), { code: 'ERR_CHECKSUM_MISMATCH' }))
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'failed', failure: 'verify' })
  assert.equal(updates.ready, null)
  updates.install()
  assert.deepEqual(updater.installs, [])
})

test('on macOS a bundle Squirrel turns down after the download is a verification failure', async () => {
  const { updater, states, updates } = watching({ platform: 'darwin', squirrel: true })
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('update-downloaded', { version: '3.96.0' })
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'downloading', percent: 100 })
  // electron-updater passes Squirrel's error on, and repeats it.
  const refused = new Error('Code signature at URL file:///tmp/Automagik.app did not pass validation')
  updater.emit('error', refused)
  updater.emit('error', refused)
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'failed', failure: 'verify' })
  assert.equal(updates.ready, null)
  updates.install()
  assert.deepEqual(updater.installs, [])
})

test('an error after the update is ready does not take the ready update away', async () => {
  const { updater, states, updates } = watching({ platform: 'darwin', squirrel: true })
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('update-downloaded', { version: '3.96.0' })
  updater.nativeUpdater.emit('update-downloaded')
  assert.equal(updates.ready, '3.96.0')
  updater.emit('error', new Error('Code signature at URL file:///x did not pass validation'))
  updater.emit('error', new Error('the server closed the connection'))
  assert.equal(updates.ready, '3.96.0')
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'ready' })
})

test('a feed that cannot be read is a failed check, not a failed download', async () => {
  const { updater, states, updates } = watching()
  // electron-updater emits the error, then rejects the check: no download had started.
  updater.checkForUpdates = async () => {
    const error = new Error('Cannot find latest-linux.yml in the release')
    updater.emit('error', error)
    throw error
  }
  assert.deepEqual(await updates.check(), { result: 'error' })
  assert.deepEqual(states, [])
})

test('a network that drops mid-download is retried within a minute a few times, then it is a failed download', async () => {
  const { updater, states, updates, retries } = watching()
  for (let attempt = 1; attempt <= QUICK_RETRIES; attempt++) {
    // Each check passes (and would reset the check's own retry count) before its download fails.
    assert.deepEqual(await updates.check(), { result: 'found', version: '3.96.0' })
    updater.emit('update-available', { version: '3.96.0' })
    updater.emit('download-progress', { percent: 10, transferred: 1, total: 10 })
    updater.emit('error', new Error('net::ERR_NETWORK_CHANGED'))
    assert.deepEqual(states.at(-1), { state: 'retrying', failure: 'check' }, `attempt ${attempt}`)
    assert.equal(retries(QUICK_RETRY_MS).length, attempt)
    retries(QUICK_RETRY_MS).at(-1).fn()
    await new Promise(resolve => setImmediate(resolve))
  }
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('error', new Error('net::ERR_NETWORK_CHANGED'))
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'failed', failure: 'download' })
  assert.equal(retries(QUICK_RETRY_MS).length, QUICK_RETRIES, 'no quick retry without end')
  assert.equal(retries(RETRY_MS).length, 1)
})

test('a check that runs while a download is under way leaves its progress on screen', async () => {
  const { updater, states, updates } = watching()
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('download-progress', { percent: 30, transferred: 3, total: 10 })
  const before = states.length
  await updates.check()
  assert.equal(states.length, before)
})

test('a check that fails while a download is under way is not the download\'s failure', async () => {
  const { updater, states, updates } = watching()
  await updates.check()
  updater.emit('update-available', { version: '3.96.0' })
  updater.emit('download-progress', { percent: 40, transferred: 4, total: 10 })
  const before = states.length
  // The quarter hour's check cannot read the feed, while the download goes on.
  updater.checkForUpdates = async () => {
    const error = new Error('Cannot find latest-linux.yml in the release')
    updater.emit('error', error)
    throw error
  }
  assert.deepEqual(await updates.check(), { result: 'error' })
  assert.equal(states.length, before, 'the progress stays')
  // The download is still the one that can fail, or arrive.
  updater.emit('error', new Error('the server closed the connection'))
  assert.deepEqual(states.at(-1), { version: '3.96.0', state: 'failed', failure: 'download' })
})

test('a download that was discarded or cancelled leaves no download to fail', async () => {
  for (const end of [u => u.emit('update-downloaded', { version: '3.95.0' }), u => u.emit('update-cancelled', { version: '3.96.0' })]) {
    const { updater, states, updates } = watching()
    await updates.check()
    updater.emit('update-available', { version: '3.96.0' })
    end(updater)
    const before = states.length
    updater.emit('error', new Error('Cannot find latest-linux.yml in the release'))
    assert.equal(states.length, before)
    assert.equal(updates.ready, null)
  }
})

test('the sidebar is handed the bytes, and what failed', () => {
  assert.deepEqual(
    updatePresentation({ version: '3.96.0', state: 'downloading', percent: 41.6, transferred: 41 * MB, total: 98 * MB }),
    { phase: 'downloading', version: '3.96.0', percent: 41, transferred: 41 * MB, total: 98 * MB },
  )
  assert.deepEqual(updatePresentation({ version: '3.96.0', state: 'failed', failure: 'download' }), { phase: 'error', failure: 'download', version: '3.96.0' })
  assert.deepEqual(updatePresentation({ version: '3.96.0', state: 'failed', failure: 'verify' }), { phase: 'error', failure: 'verify', version: '3.96.0' })
  assert.deepEqual(updatePresentation({ state: 'failed', failure: 'something else' }), { phase: 'error', failure: 'download' })
  // A check in progress (the person's Retry) shows as a check, and a failed check keeps its word.
  assert.deepEqual(updatePresentation({ version: '3.96.0', state: 'failed', failure: 'download' }, { checking: true }), { phase: 'checking' })
  assert.deepEqual(updatePresentation(null, { failed: true }), { phase: 'error', failure: 'check' })
  // With the plugins apart, the app's part carries both; the plugins' part is untouched.
  const lane = { changes: [], auto: true }
  const split = updatePresentation({ version: '3.96.0', state: 'downloading', percent: 5, transferred: 5, total: 100 }, { lane })
  assert.deepEqual(split.app, { phase: 'downloading', version: '3.96.0', percent: 5, transferred: 5, total: 100 })
  assert.deepEqual(split.plugins, { phase: 'idle', changes: [], auto: true })
  assert.deepEqual(updatePresentation({ version: '3.96.0', state: 'failed', failure: 'verify' }, { lane }).app, { phase: 'error', failure: 'verify', version: '3.96.0' })
  // Ready is quiet, and restarting is the installing phase, as before.
  assert.deepEqual(updatePresentation({ version: '3.96.0', state: 'ready' }), { phase: 'ready', version: '3.96.0' })
  assert.deepEqual(updatePresentation({ version: '3.96.0', state: 'restarting' }), { phase: 'installing', version: '3.96.0' })
})

const homeOf = (t) => {
  const home = mkdtempSync(join(tmpdir(), 'splash-steps-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
const spawn = () => ({ on() {}, unref() {} })

test('the splash has a determinate bar of real steps, not a spinner', () => {
  assert.deepEqual([...SPLASH_STEPS], ['installing', 'starting'])
  assert.match(SPLASH_SCRIPT, /bar\.setIndeterminate\(false\)/)
  assert.doesNotMatch(SPLASH_SCRIPT, /setIndeterminate\(true\)/)
  assert.doesNotMatch(SPLASH_SCRIPT, /startAnimation/)
  // Short of the end while the new copy starts: its page going in is the last step.
  assert.match(SPLASH_SCRIPT, /bar\.setMaxValue\(4\)/)
  // The steps are the files beside "up": the newest one there is where the bar stands.
  assert.match(SPLASH_SCRIPT, /const steps = up\.replace\(\/\[\^\/\]\*\$\/, ''\)/)
  assert.match(SPLASH_SCRIPT, /bar\.setDoubleValue\(files\.fileExistsAtPath\(steps \+ 'starting'\) \? 3 : files\.fileExistsAtPath\(steps \+ 'installing'\) \? 2 : 1\)/)
  // Still a small panel that takes no focus, and still gone after two minutes at most.
  assert.match(SPLASH_SCRIPT, /const W = 380, H = 236;/)
  assert.match(SPLASH_SCRIPT, /fileExistsAtPath\(up\) && Date\.now\(\) < until/)
})

test('the steps are told only while a splash is up, and go with it', (t) => {
  const home = homeOf(t)
  const files = splashFiles(home)
  const step = name => join(files.dir, name)
  // No splash (another system, or a start that follows no update): nothing is written.
  assert.equal(markSplashStep(home, 'starting'), false)
  assert.equal(existsSync(files.dir), false)
  assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.96.0', platform: 'darwin', spawn }), true)
  assert.equal(existsSync(step('installing')), false)
  assert.equal(markSplashStep(home, 'installing'), true)
  assert.equal(markSplashStep(home, 'starting'), true)
  assert.ok(existsSync(step('installing')) && existsSync(step('starting')))
  // Only the steps the splash knows: a name is never a path.
  assert.equal(markSplashStep(home, '../up'), false)
  assert.equal(markSplashStep(home, 'up'), false)
  dismissSplash(home)
  for (const name of ['up', 'installing', 'starting']) assert.equal(existsSync(step(name)), false, name)
  assert.equal(markSplashStep(home, 'starting'), false)
})

test('a step an earlier update left behind does not move the next splash\'s bar', (t) => {
  const home = homeOf(t)
  const files = splashFiles(home)
  assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.96.0', platform: 'darwin', spawn }), true)
  markSplashStep(home, 'installing')
  markSplashStep(home, 'starting')
  // That splash timed out, its files stayed; the next update starts from the first step.
  writeFileSync(files.up, 'stale\n')
  assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.97.0', platform: 'darwin', spawn }), true)
  assert.equal(existsSync(join(files.dir, 'installing')), false)
  assert.equal(existsSync(join(files.dir, 'starting')), false)
  assert.ok(existsSync(files.up))
})

test('main.js restarts into an update only when the person asks, and tells the splash its steps', () => {
  // main.js is the Electron entry and cannot be imported under node --test: read at source.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const code = main.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  // One caller: the sidebar's button, once an update is ready.
  const calls = code.split('\n').filter(line => /\binstallUpdate\(/.test(line) && !/^function installUpdate\(/.test(line))
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\s*if \(updates\?\.ready\) return installUpdate\(\)$/)
  const handler = code.slice(code.indexOf("ipcMain.handle('automagik-updates-open'"))
  assert.ok(handler.indexOf(calls[0]) > 0 && handler.indexOf(calls[0]) < handler.indexOf('ipcMain.handle(', 10), 'the call is inside the button\'s handler')
  // No timer decides it: the rule that installed while the person was away is not wired in.
  assert.doesNotMatch(code, /awayInstall/)
  assert.doesNotMatch(code, /update while away|not in use/)
  // electron-updater's own restart is reached only through installUpdate.
  assert.equal(code.split('updates.install()').length - 1, 1)
  assert.doesNotMatch(code, /quitAndInstall/)
  const install = code.slice(code.indexOf('function installUpdate('))
  assert.ok(install.indexOf("markSplashStep(home, 'installing')") > 0)
  assert.ok(install.indexOf("markSplashStep(home, 'installing')") < install.indexOf('updates.install()'))
  // The new copy says it started, once it holds the single-instance lock.
  assert.ok(code.indexOf("markSplashStep(home, 'starting')") > code.indexOf('app.requestSingleInstanceLock()'))
})
