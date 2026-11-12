// The outer wall of browser_exec (src/host/browser/script-runner.js): what the script's
// process cannot do even when the script owns all of its JavaScript. So the checks are
// not scripts: fixtures/browser-script-wall-child.mjs is plain Node code, started by the
// real runner in place of script-child.js, and each check is one ordinary call that must
// be refused. One test for each thing the wall closes, on each runtime the Bot team ships
// on: Node, and Electron as Node (the desktop app). A runtime that takes the flags and
// enforces nothing answers 'allowed' and turns its test red.
//
// The network has no test: this wall does not close it (see script-runner.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = fileURLToPath(new URL('./fixtures/browser-script-wall-host.mjs', import.meta.url))
const SECRET = 'BROWSER_SCRIPT_TEST_SECRET'
const REFUSED = /not a helper call or an answer/

// ELECTRON_BIN, else the binary of the desktop app's own install (apps/desktop, npm ci).
export function electronPath({ env = process.env, read = readFileSync } = {}) {
  if (env.ELECTRON_BIN) return env.ELECTRON_BIN
  const dir = resolve(import.meta.dirname, '..', '..', 'desktop', 'node_modules', 'electron')
  try { return join(dir, 'dist', read(join(dir, 'path.txt'), 'utf8').trim()) } catch { return undefined }
}

// Under CI the Electron half never skips: its job installs the desktop app's Electron.
export function electronGuard({ env = process.env, exists = existsSync, read = readFileSync } = {}) {
  const path = electronPath({ env, read })
  if (path !== undefined && exists(path)) return { path }
  if (env.CI) assert.fail(`The script wall check found no Electron at ${path ?? 'apps/desktop/node_modules/electron'} (ELECTRON_BIN=${env.ELECTRON_BIN ?? 'unset'}); CI must run it`)
  return { skip: 'The Electron half requires ELECTRON_BIN or the desktop app\'s npm install' }
}

const RUNTIMES = [
  { name: 'Node', find: () => ({ path: process.execPath }), env: {} },
  { name: 'Electron as Node', find: electronGuard, env: { ELECTRON_RUN_AS_NODE: '1' }, electron: true },
]

// Runs one check in a host on this runtime; undefined when the test was skipped.
async function check(t, runtime, request) {
  const { path, skip } = runtime.find()
  if (skip) {
    t.skip(skip)
    return undefined
  }
  const stdout = await new Promise((done, fail) => {
    execFile(path, [HOST, JSON.stringify({ timeout: 10_000, ...request })], {
      env: { ...process.env, ...runtime.env, [SECRET]: 'test-only-value' },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }, (error, out, err) => error ? fail(new Error(`${runtime.name} host failed: ${error.message}\n${err}`)) : done(out))
  })
  const result = JSON.parse(stdout.trim().split('\n').at(-1))
  // The host really ran on the runtime this test names.
  assert.equal(typeof result.electron, runtime.electron ? 'string' : 'object', `host ran on ${JSON.stringify(result)}`)
  t.diagnostic(`node ${result.node}${result.electron ? `, electron ${result.electron}` : ''}`)
  return result
}

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'script-wall-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const denied = (result, code) => {
  assert.equal(result.error, undefined)
  assert.equal(JSON.parse(result.answer), code)
}

for (const runtime of RUNTIMES) {
  test(`${runtime.name}: the script's process cannot read a file`, async (t) => {
    // A file the host can read. (The process's own entry file is the one it may read.)
    const path = join(scratch(t), 'readable.txt')
    writeFileSync(path, 'host file')
    const result = await check(t, runtime, { check: 'readFile', path })
    if (result) denied(result, 'ERR_ACCESS_DENIED')
  })

  test(`${runtime.name}: the script's process cannot write a file`, async (t) => {
    const path = join(scratch(t), 'written.txt')
    const result = await check(t, runtime, { check: 'writeFile', path })
    if (!result) return
    denied(result, 'ERR_ACCESS_DENIED')
    assert.equal(existsSync(path), false)
  })

  test(`${runtime.name}: the script's process cannot start another process`, async (t) => {
    const result = await check(t, runtime, { check: 'spawn' })
    if (result) denied(result, 'ERR_ACCESS_DENIED')
  })

  test(`${runtime.name}: the script's process cannot start a worker thread`, async (t) => {
    const result = await check(t, runtime, { check: 'worker' })
    if (result) denied(result, 'ERR_ACCESS_DENIED')
  })

  test(`${runtime.name}: the script's process cannot load a native addon`, async (t) => {
    // No such file: without the wall the load is tried and fails with another code.
    const result = await check(t, runtime, { check: 'addon', path: join(scratch(t), 'missing.node') })
    if (result) denied(result, 'ERR_DLOPEN_DISABLED')
  })

  test(`${runtime.name}: the script's process has none of the host's environment`, async (t) => {
    const result = await check(t, runtime, { check: 'env' })
    if (!result) return
    assert.equal(result.error, undefined)
    const names = JSON.parse(result.answer)
    assert.equal(names.includes(SECRET), false)
    // Windows needs SystemRoot to start a process, Electron needs its switch to be Node,
    // and macOS adds its text encoding to every process.
    assert.deepEqual(names.filter(name => !['SystemRoot', 'ELECTRON_RUN_AS_NODE', '__CF_USER_TEXT_ENCODING'].includes(name)), [])
    assert.equal(names.includes('ELECTRON_RUN_AS_NODE'), Boolean(runtime.electron))
  })

  test(`${runtime.name}: a process that ignores the polite stop is gone at the deadline`, async (t) => {
    const result = await check(t, runtime, { check: 'ignoreStop', timeout: 300 })
    if (!result) return
    assert.match(result.error, /longer than 0\.3 seconds/)
    assert.notEqual(result.exit, 'survived')
    // Not a Windows matter: there every kill is the hard one.
    if (process.platform !== 'win32') assert.equal(result.exit.signal, 'SIGKILL')
  })

  test(`${runtime.name}: a line that is not a helper call or an answer ends the run`, async (t) => {
    const lines = ['notJson', 'notAnObject', 'unknownType', 'unknownHelper', 'inheritedHelper', 'argsNotText', 'idNotANumber', 'answerNotText', 'errorNotText']
    for (const line of lines) {
      const result = await check(t, runtime, { check: line, timeout: 3_000 })
      if (!result) return
      assert.match(result.error ?? `answered ${result.answer}`, REFUSED, line)
      assert.equal(result.helperCalls, 0, line)
      assert.notEqual(result.exit, 'survived', line)
    }
  })

  test(`${runtime.name}: a message with no end ends the run`, async (t) => {
    // More than the longest line the host holds (script-runner.js MAX_LINE).
    const result = await check(t, runtime, { check: 'endlessLine', length: 25_000_000, timeout: 5_000 })
    if (!result) return
    assert.match(result.error, REFUSED)
    assert.notEqual(result.exit, 'survived')
  })
}

test('under CI a missing Electron fails, naming the path and ELECTRON_BIN', () => {
  const missing = () => false
  assert.throws(() => electronGuard({ env: { CI: '1', ELECTRON_BIN: '/nowhere/electron' }, exists: missing }),
    { name: 'AssertionError', message: /no Electron at \/nowhere\/electron \(ELECTRON_BIN=\/nowhere\/electron\); CI must run it/ })
  assert.match(electronGuard({ env: {}, exists: missing }).skip, /ELECTRON_BIN/)
  assert.deepEqual(electronGuard({ env: { ELECTRON_BIN: '/opt/electron' }, exists: () => true }), { path: '/opt/electron' })
})
