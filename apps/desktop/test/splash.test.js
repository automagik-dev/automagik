import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { OSASCRIPT, SPLASH_SCRIPT, dismissSplash, showUpdateSplash, splashFiles, splashText } from '../src/splash.js'

const homeOf = (t) => {
  const home = mkdtempSync(join(tmpdir(), 'splash-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}
const recorder = () => {
  const calls = []
  const spawn = (command, args, options) => { calls.push({ command, args, options }); return { on() {}, unref() { calls.at(-1).unref = true } } }
  return { calls, spawn }
}

test('on macOS the splash goes up from copies outside the app, and outlives it', (t) => {
  const home = homeOf(t)
  const { calls, spawn } = recorder()
  assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.21.0', platform: 'darwin', spawn }), true)
  const files = splashFiles(home)
  // The bundle is swapped while the splash runs, so it reads nothing from inside it.
  assert.equal(readFileSync(files.script, 'utf8'), SPLASH_SCRIPT)
  assert.ok(readFileSync(files.image).length > 1000)
  assert.ok(existsSync(files.up))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, OSASCRIPT)
  assert.deepEqual(calls[0].args, ['-l', 'JavaScript', files.script, files.image, 'Updating Automagik to 3.21.0', 'Automagik opens again by itself in a few seconds.', files.up])
  assert.equal(calls[0].options.detached, true)
  assert.equal(calls[0].unref, true)
  // The new copy's page is in: the splash's file goes, and with it the splash.
  dismissSplash(home)
  assert.equal(existsSync(files.up), false)
  dismissSplash(home)
})

test('elsewhere there is no splash, and nothing is written', (t) => {
  const home = homeOf(t)
  const { calls, spawn } = recorder()
  assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.21.0', platform: 'linux', spawn }), false)
  assert.equal(calls.length, 0)
  assert.equal(existsSync(splashFiles(home).dir), false)
})

test('a splash that cannot start leaves no file behind to wait on', (t) => {
  const home = homeOf(t)
  const spawn = () => { throw new Error('no osascript') }
  assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.21.0', platform: 'darwin', spawn }), false)
  assert.equal(existsSync(splashFiles(home).up), false)
})

test('the splash says what it waits for, and gives up after two minutes', () => {
  assert.deepEqual(splashText('Automagik', undefined), { title: 'Updating Automagik', detail: 'Automagik opens again by itself in a few seconds.' })
  assert.match(SPLASH_SCRIPT, /fileExistsAtPath\(up\) && Date\.now\(\) < until/)
  assert.match(SPLASH_SCRIPT, /\|\| 120000;/)
  // A non-activating panel: it never takes the keyboard from what the person is doing.
  assert.match(SPLASH_SCRIPT, /initWithContentRectStyleMaskBackingDefer\(frame, 128, 2, false\)/)
})
