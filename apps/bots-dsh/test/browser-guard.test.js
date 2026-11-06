// The shared browser guard (#364), with every input injected: no real env, no browser, no import.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DARWIN_CHROME, LINUX_CHROMIUM, browserGuard, browserPath } from './browser-guard.js'

const missing = () => false
const present = () => true
const FAKE = { launch() {} }
const notFound = async () => { throw Object.assign(new Error("Cannot find package 'playwright-core'"), { code: 'ERR_MODULE_NOT_FOUND' }) }

test('CHROME_BIN wins on every platform; else Chrome on macOS, else /usr/bin/chromium', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.equal(browserPath({ env: { CHROME_BIN: '/opt/chrome' }, platform }), '/opt/chrome')
  }
  assert.equal(browserPath({ env: {}, platform: 'darwin' }), DARWIN_CHROME)
  assert.equal(browserPath({ env: {}, platform: 'linux' }), LINUX_CHROMIUM)
  assert.equal(DARWIN_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  assert.equal(LINUX_CHROMIUM, '/usr/bin/chromium')
})

test('under CI a missing browser fails, naming the path and CHROME_BIN', async () => {
  const load = () => assert.fail('no import once the browser is missing')
  await assert.rejects(browserGuard({ env: { CI: 'true' }, platform: 'linux', exists: missing, load }),
    { name: 'AssertionError', message: /no browser at \/usr\/bin\/chromium \(CHROME_BIN=unset\); CI must run it/ })
  await assert.rejects(browserGuard({ env: { CI: '1', CHROME_BIN: '/nowhere/chrome' }, platform: 'linux', exists: missing, load }),
    { name: 'AssertionError', message: /no browser at \/nowhere\/chrome \(CHROME_BIN=\/nowhere\/chrome\)/ })
})

test('away from CI a missing browser is a skip', async () => {
  const guard = await browserGuard({ env: {}, platform: 'darwin', exists: missing, load: notFound })
  assert.deepEqual(guard, { skip: 'Browser layout check requires CHROME_BIN; the structural checks still run' })
})

test('playwright-core that cannot be imported fails under CI and skips away from it', async () => {
  await assert.rejects(browserGuard({ env: { CI: 'true' }, platform: 'linux', exists: present, load: notFound }),
    { name: 'AssertionError', message: /cannot import playwright-core \(Cannot find package 'playwright-core'\)/ })
  const guard = await browserGuard({ env: {}, platform: 'linux', exists: present, load: notFound })
  assert.deepEqual(guard, { skip: 'Browser layout check requires the root bun install (playwright-core)' })
})

test('an import error that is not a missing module is thrown as it is, CI or not', async () => {
  const broken = new SyntaxError('bad module')
  for (const env of [{ CI: 'true' }, {}]) {
    await assert.rejects(browserGuard({ env, platform: 'linux', exists: present, load: async () => { throw broken } }), broken)
  }
})

test('a browser and playwright-core give the launcher and the resolved path', async () => {
  const checked = []
  const guard = await browserGuard({
    env: { CI: 'true', CHROME_BIN: '/opt/chrome' }, platform: 'linux',
    exists: path => { checked.push(path); return true }, load: async () => ({ chromium: FAKE }),
  })
  assert.deepEqual(guard, { chromium: FAKE, executablePath: '/opt/chrome' })
  assert.deepEqual(checked, ['/opt/chrome'])
})
