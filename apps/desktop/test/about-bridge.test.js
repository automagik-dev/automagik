import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { laneMissedOf, versionsAnswer } from '../src/frame.js'

// What the Bot team's About page asks the app for (#90): what this copy is, and a check that
// is only a check. preload.cjs runs in a context of its own with a fake Electron, as in
// preload.test.js; main.js is the Electron entry, so its wiring is read at source.
function loadUpdates() {
  const exposed = {}
  const invoked = []
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value } },
    ipcRenderer: { invoke: (...args) => { invoked.push(args); return Promise.resolve('answered') }, on: () => {}, off: () => {} },
  }
  const context = vm.createContext({
    require: name => { if (name === 'electron') return electron; throw new Error(`no ${name} in a sandboxed preload`) },
    process: { platform: 'linux' },
    document: { documentElement: { dataset: {} }, addEventListener: () => {} },
    navigator: {},
    console,
  })
  vm.runInContext(readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8'), context)
  return { updates: exposed.omniDesktop.updates, invoked }
}

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
// One ipcMain.handle call, from its channel to the next handler or top-level comment.
const handlerOf = (channel) => {
  const from = main.indexOf(`ipcMain.handle('${channel}'`)
  assert.notEqual(from, -1, `main.js handles ${channel}`)
  const rest = main.slice(from + 1)
  const next = rest.search(/\n(?:\/\/|ipcMain\.handle\()/)
  return main.slice(from, next === -1 ? undefined : from + 1 + next)
}

test('the answer names the app, its runtime and its plugins, and says whether this copy updates', () => {
  assert.deepEqual(
    versionsAnswer({ app: '3.117.2', dsh: '0.2.3-rc.5', plugins: { '@automagik/bots-dsh': '3.117.4', '@automagik/genie-dsh': '1.4.0' }, mode: 'auto' }),
    { app: '3.117.2', dsh: '0.2.3-rc.5', plugins: [{ name: '@automagik/bots-dsh', version: '3.117.4' }, { name: '@automagik/genie-dsh', version: '1.4.0' }], updates: true },
  )
  assert.equal(versionsAnswer({ app: '3.117.2', mode: 'notify' }).updates, true)
  // A dev run, or OMNI_DESKTOP_UPDATES=off: this copy does not update.
  assert.deepEqual(versionsAnswer({ app: '3.117.2', dsh: null, plugins: {}, mode: null }), { app: '3.117.2', dsh: null, plugins: [], updates: false })
  assert.deepEqual(versionsAnswer(), { app: null, dsh: null, plugins: [], updates: false })
})

test('the answer carries version text only: nothing else a package.json could hold', () => {
  const answer = versionsAnswer({
    app: '/home/someone/app', dsh: { version: '1.0.0' },
    plugins: { '@automagik/bots-dsh': 'file:../somewhere', '@automagik/acp-dsh': 7, '@automagik/welcome-dsh': '3.117.2', '@automagik/genie-dsh': `1.0.0${'x'.repeat(80)}`, '@automagik/locale-pt-br-dsh': `${'9'.repeat(70)}.0.0` },
    mode: 'yes',
  })
  assert.deepEqual(answer, { app: null, dsh: null, plugins: [{ name: '@automagik/welcome-dsh', version: '3.117.2' }], updates: false })
})

test('the page can ask for a check and for the versions, with nothing of its own sent to main', async () => {
  const { updates, invoked } = loadUpdates()
  assert.equal(await updates.check({ install: true }), 'answered')
  assert.equal(await updates.versions('/etc'), 'answered')
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [['automagik-updates-check'], ['automagik-updates-versions']])
  assert.ok(Object.isFrozen(updates))
  // What an older Bot team reads is still there.
  for (const name of ['status', 'open', 'applyPlugins', 'setAutoApply', 'subscribe']) assert.equal(typeof updates[name], 'function', name)
})

test('a check from the page is only a check: it never installs, applies plugins or opens a page', () => {
  const check = handlerOf('automagik-updates-check')
  assert.match(check, /fromPage\(event\)/)
  assert.match(check, /checkForUpdates\(\{ quiet: true \}\)/)
  assert.doesNotMatch(check, /installUpdate|applyLaneNow|restartForLane|openExternal|relaunch/)
  // The button that may restart is still its own channel.
  assert.match(handlerOf('automagik-updates-open'), /installUpdate\(\)/)
})

test('the versions go to the page alone, and name only the plugins of the publishers the app follows', () => {
  const versions = handlerOf('automagik-updates-versions')
  assert.match(versions, /fromPage\(event\) \? versionsAnswer\(/)
  assert.match(versions, /: null\)\)/)
  assert.match(versions, /installedVersions\(laneProfile, PUBLISHERS\.flatMap\(publisher => publisher\.plugins\)\)/)
})

test('a lane that could not be read is a failed check when nothing else was found, never "up to date"', () => {
  assert.equal(laneMissedOf({ result: 'latest', laneFailed: true, staged: false }), true)
  // Plugins already staged, a lane that answered, or any other result says what it is itself.
  assert.equal(laneMissedOf({ result: 'latest', laneFailed: true, staged: true }), false)
  assert.equal(laneMissedOf({ result: 'latest', laneFailed: false, staged: false }), false)
  for (const result of ['found', 'ready', 'error', 'busy']) assert.equal(laneMissedOf({ result, laneFailed: true, staged: false }), false, result)
  assert.match(main, /const laneMissed = laneMissedOf\(\{ result, laneFailed, staged: Boolean\(laneReady\) \}\)\n/)
  assert.match(main, /if \(laneMissed\) checkFailed = true\n/)
  const upToDate = main.split('\n').filter(line => line.includes('is up to date'))
  assert.equal(upToDate.length, 1)
  assert.match(upToDate[0], /result === 'latest' && !laneMissed/)
  // Each look starts clean, and only a lane's own failure sets it.
  assert.match(main, /async function lookOnce\(\) \{\n  laneFailed = false\n/)
  const sets = main.split('\n').filter(line => line.includes('laneFailed = true'))
  assert.equal(sets.length, 1)
  // A publisher none of whose plugins is installed has nothing to miss (Genie's lane, without Genie).
  assert.match(sets[0], /if \(Object\.keys\(installedVersions\(laneProfile, publisher\.plugins\)\)\.length > 0\) laneFailed = true/)
})
