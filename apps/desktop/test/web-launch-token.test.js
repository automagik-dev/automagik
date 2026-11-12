// The launch-token recovery contract (issue #361), tested against the real pinned packages
// rather than stand-ins: fixtures/web-launch-token/index.js is the unmodified lib/index.js of
// @deepseek-ai/dsh-web-app 0.2.2-rc.2, and fixtures/client-connection-cookie-lax/index.js is
// the unmodified lib/index.js of @deepseek-ai/dsh-client-connection 0.2.2-rc.2 (MIT; LICENSE
// beside each). Their sha256 must be the `before` hash in runtime/patches/patches.json, so
// these tests apply the carried patches to the bytes npm actually installs, import the patched
// modules, and drive their real apply()/authorizeIndex: the real web app records the launch URL
// owner-only, and the real Connection writes the 401 that names it.
//
// The 401 wording rides in client-connection-cookie-lax.patch: one patch entry owns that file,
// and this new patch owns the web app, so each applies to the pinned package on its own.
//
// What this does NOT cover: prepare-runtime's install (npm ci, the profile, pruning), the
// desktop build and the server image build (the boot check and the Server image CI job exercise
// those), and a real browser: the URL is read from the file here, not from a browser address bar.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const PATCHES = join(APP, 'runtime', 'patches')
const WEB_FIXTURE = join(HERE, 'fixtures', 'web-launch-token')
const CONNECTION_FIXTURE = join(HERE, 'fixtures', 'client-connection-cookie-lax', 'index.js')
const DSH = '0.2.2-rc.2'
const PATCH = 'web-launch-token-persistence.patch'
const COOKIE_PATCH = 'client-connection-cookie-lax.patch'
const WEB_APP = '@deepseek-ai/dsh-web-app'
const CONNECTION = '@deepseek-ai/dsh-client-connection'
const FILE = 'lib/index.js'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = text => createHash('sha256').update(text).digest('hex')
const lockVersion = (name) => readJson(join(APP, 'runtime', 'package-lock.json'))
  .packages[`node_modules/${name}`]?.version

// The packages' load-time imports, which only have to load and construct the modules under test.
// schemastery builds the web app's Config and the connection's schemas; cordis's Service base is
// what puts HostConnectionService on the owning context; credentials and scope are touched while
// creating the browser-session owner; zod builds the connection's wire schemas.
const STUBS = {
  '@deepseek-ai/schemastery': [
    'const chain = () => {',
    '  const callable = () => chain()',
    '  callable.min = () => callable',
    '  callable.max = () => callable',
    '  callable.default = value => value',
    '  return callable',
    '}',
    'export default {',
    '  object: shape => Object.assign(() => shape, { default: value => value }),',
    '  array: () => chain(),',
    '  natural: () => chain(),',
    '  number: () => chain(),',
    '  string: () => chain(),',
    '  boolean: () => chain(),',
    '  transform: schema => schema,',
    '}',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-credentials': [
    'export const credentialKey = (namespace, key) => `${namespace}:${key}`',
    '',
  ].join('\n'),
  '@deepseek-ai/cordis': [
    'export class Service {',
    '  constructor(ctx, name) {',
    '    this.ctx = ctx',
    '    if (name !== undefined) ctx[name] = this',
    '  }',
    '}',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-scope': [
    'export const createScope = (owner, key) => ({ ctx: owner, dispose: async () => {} })',
    '',
  ].join('\n'),
  'zod': [
    'const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain })',
    'export const z = chain',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-app-boot': 'export const auditStartupEntries = async () => {}\n',
  '@deepseek-ai/dsh-host-frontend-static': 'export const apply = () => {}\n',
  '@deepseek-ai/dsh-host-webserver': [
    'export const bindUrlHost = host => host',
    'export const isLoopbackHost = () => true',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-launch-environment': [
    'export const launchEnvironmentOf = () => ({})',
    'export const launchedThroughSsh = () => false',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-subprocess': 'export const scrubbedParentEnv = () => ({})\n',
  'open': 'export default async () => {}\n',
}

function writeStub(root, name, source) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-test', type: 'module', main: 'index.js' }),
  )
  writeFileSync(join(dir, 'index.js'), source)
}

function writePackage(dir, name, fields = {}) {
  const value = { name, version: DSH, type: 'module', ...fields }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(value))
}

function entryOf(name) {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === name)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${name}`)
  return entries[0]
}

// A runtime the helper can patch: the dsh pin, both packages at their pinned version and with
// the real pinned file, the web app's public-url module beside it, and a patches folder holding
// only the two entries this contract needs (patchRuntime is all-or-nothing over a folder).
function makeRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-launch-token-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')
  mkdirSync(join(modules, '@deepseek-ai', 'dsh'), { recursive: true })
  writePackage(join(modules, '@deepseek-ai', 'dsh'), '@deepseek-ai/dsh')

  const connection = join(modules, CONNECTION)
  mkdirSync(join(connection, 'lib'), { recursive: true })
  writePackage(connection, CONNECTION)
  cpSync(CONNECTION_FIXTURE, join(connection, FILE))

  const web = join(modules, WEB_APP)
  mkdirSync(join(web, 'lib'), { recursive: true })
  writePackage(web, WEB_APP)
  cpSync(join(WEB_FIXTURE, 'index.js'), join(web, FILE))
  cpSync(join(WEB_FIXTURE, 'public-url-D_dMK-yI.js'), join(web, 'lib', 'public-url-D_dMK-yI.js'))

  // The web app resolves the built frontend from this package; its bytes are not under test.
  const frontend = join(modules, '@deepseek-ai', 'dsh-web-frontend')
  mkdirSync(join(frontend, 'dist'), { recursive: true })
  writePackage(frontend, '@deepseek-ai/dsh-web-frontend')
  writeFileSync(join(frontend, 'dist', 'index.html'), '<!doctype html>\n')

  for (const [name, source] of Object.entries(STUBS)) writeStub(root, name, source)
  const patches = join(root, 'patches')
  mkdirSync(patches)
  const entries = [entryOf(COOKIE_PATCH), entryOf(PATCH)]
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify(entries, null, 2)}\n`)
  for (const item of entries) cpSync(join(PATCHES, item.patch), join(patches, item.patch))
  return {
    root, modules, patches, webFile: join(web, FILE), connectionFile: join(connection, FILE),
  }
}

// Drive the patched web app's real apply(): the fake context supplies the web server and the
// Connection service, and keeps the effect disposers so a test can shut the process down.
function openWebApp(apply, token) {
  const disposers = []
  const ctx = {
    webServer: { protocol: 'http:', host: '127.0.0.1', getOrigin: () => 'http://127.0.0.1:43123' },
    provide() {},
    plugin() {},
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    inject(names, callback) {
      if (!names.includes('connection')) return
      callback({
        root: {},
        get: () => undefined,
        connection: { authenticatedUrl: base => `${base}/?token=${token}` },
      })
    },
  }
  apply(ctx, { openBrowser: false, printUrl: true, surfaceContext: false })
  return disposers
}

// A folder a non-root POSIX process cannot write into: the write-failure path's fixture. Windows
// has no folder mode that blocks a write, and root writes into any folder.
const readOnlyFolder = { skip: process.platform === 'win32' ? 'Windows has no read-only folder mode' : process.getuid?.() === 0 ? 'root writes into any folder' : false }

// The launch URL line a start prints, and the error it may report, kept for a test.
function captureOutput(t) {
  const logged = []
  const errored = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args) => logged.push(args.join(' '))
  console.error = (...args) => errored.push(args.join(' '))
  t.after(() => {
    console.log = originalLog
    console.error = originalError
  })
  return { logged, errored }
}

test('patches.json pins the new web app patch and the connection 401 path', () => {
  const patch = entryOf(PATCH)
  assert.equal(patch.dsh, DSH)
  assert.equal(readJson(join(APP, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh'], DSH)
  assert.equal(patch.files.length, 1)
  const [file] = patch.files
  assert.deepEqual(
    { package: file.package, version: file.version, file: file.file },
    { package: WEB_APP, version: DSH, file: FILE },
  )
  assert.equal(lockVersion(WEB_APP), DSH)
  assert.match(file.before, /^[0-9a-f]{64}$/)
  assert.match(file.after, /^[0-9a-f]{64}$/)
  assert.notEqual(file.before, file.after)
  const pinned = readFileSync(join(WEB_FIXTURE, 'index.js'), 'utf8')
  assert.equal(sha256(pinned), file.before)
  assert.match(readFileSync(join(WEB_FIXTURE, 'LICENSE'), 'utf8'), /^MIT License\n/)
  assert.match(pinned, /console\.log\(`dsh web: \$\{authenticatedUrl\}`\)/)
  const text = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(
    text.startsWith(`--- a/${WEB_APP}/${FILE}\n+++ b/${WEB_APP}/${FILE}\n`),
    text.slice(0, 120),
  )
  assert.match(text, /^\+.*mode: 0o600/m)
  assert.match(text, /^\+.*launch-url/m)
  assert.doesNotMatch(text, new RegExp(`^\\+\\+\\+ b/${CONNECTION.replace('/', '\\/')}`, 'm'))

  // The connection patch that owns the file also carries the 401 wording; it still applies to
  // the unmodified pinned bytes on its own.
  const cookie = entryOf(COOKIE_PATCH)
  const [connection] = cookie.files
  assert.equal(connection.package, CONNECTION)
  assert.equal(lockVersion(CONNECTION), DSH)
  assert.equal(sha256(readFileSync(CONNECTION_FIXTURE)), connection.before)
  const connectionText = readFileSync(join(PATCHES, COOKIE_PATCH), 'utf8')
  assert.match(connectionText, /^\+function launchUrlFile\(\)/m)
  assert.match(connectionText, /^\+.*open the launch URL saved in \$\{location\}/m)
})

test('the carried patches apply to the pinned bytes, and a re-run leaves them alone', (t) => {
  const runtime = makeRuntime(t)
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(({ name, state }) => ({ name, state })), [
    { name: `${CONNECTION}/${FILE}`, state: 'patched' },
    { name: `${WEB_APP}/${FILE}`, state: 'patched' },
  ])
  assert.equal(sha256(readFileSync(runtime.connectionFile)), entryOf(COOKIE_PATCH).files[0].after)
  assert.equal(sha256(readFileSync(runtime.webFile)), entryOf(PATCH).files[0].after)
  const second = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(second.map(({ state }) => state), ['already patched', 'already patched'])
})

test('the patched web app records the launch URL owner-only, then removes it', async (t) => {
  const runtime = makeRuntime(t)
  patchRuntime(runtime.modules, runtime.patches)
  const { apply } = await import(pathToFileURL(runtime.webFile).href)
  const home = join(runtime.root, 'dsh')
  mkdirSync(home, { recursive: true })
  const file = join(home, 'launch-url')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const logged = []
  const originalLog = console.log
  console.log = (...args) => logged.push(args.join(' '))
  t.after(() => { console.log = originalLog })

  // A file from an earlier start is replaced, never reused.
  writeFileSync(file, 'http://127.0.0.1:1/?token=stale\n')
  const first = openWebApp(apply, 'first')
  const firstUrl = 'http://127.0.0.1:43123/?token=first'
  assert.equal(readFileSync(file, 'utf8'), `${firstUrl}\n`)
  assert.equal(logged.at(-1), `dsh web: ${firstUrl}`)
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)

  // A restart replaces the URL and the file; the first context's cleanup must not remove it.
  const second = openWebApp(apply, 'second')
  const secondUrl = 'http://127.0.0.1:43123/?token=second'
  assert.equal(readFileSync(file, 'utf8'), `${secondUrl}\n`)
  first[0]()
  assert.equal(readFileSync(file, 'utf8'), `${secondUrl}\n`)
  second[0]()
  assert.equal(existsSync(file), false)
})

// A malformed DSH_HOME: its parent is a regular file, so the temporary file cannot be written
// and removing it fails with ENOTDIR too. The write failure is reported, recordLaunchUrl returns
// null, and the launch URL line still prints (#739).
test('a malformed DSH_HOME reports the write failure and still prints the launch URL', async (t) => {
  const runtime = makeRuntime(t)
  patchRuntime(runtime.modules, runtime.patches)
  const { apply } = await import(pathToFileURL(runtime.webFile).href)
  const parent = join(runtime.root, 'not-a-folder')
  writeFileSync(parent, 'a regular file where the home should be\n')
  const home = join(parent, 'dsh')
  const file = join(home, 'launch-url')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const { logged, errored } = captureOutput(t)

  const disposers = openWebApp(apply, 'malformed')
  assert.equal(logged.at(-1), 'dsh web: http://127.0.0.1:43123/?token=malformed', 'the URL line still prints')
  assert.equal(errored.length, 1)
  assert.ok(errored[0].includes(`could not save the launch URL in ${file}`), errored[0])
  // On POSIX the write and its cleanup removal both fail with ENOTDIR; the removal must be caught,
  // not escape, so the reported failure is the write and the line above still printed.
  if (process.platform !== 'win32') assert.match(errored[0], /ENOTDIR/, errored[0])
  assert.equal(existsSync(file), false)
  // recordLaunchUrl returned null: shutdown has nothing to remove, and its effect does not throw.
  assert.equal(disposers.length, 1)
  for (const dispose of disposers) assert.doesNotThrow(dispose)
})

// The write-failure path against a read-only DSH_HOME: reported, never fatal, and the launch URL
// line still prints (#739).
test('a launch URL that cannot be written to a read-only DSH_HOME is reported, not fatal', readOnlyFolder, async (t) => {
  const runtime = makeRuntime(t)
  patchRuntime(runtime.modules, runtime.patches)
  const { apply } = await import(pathToFileURL(runtime.webFile).href)
  const home = join(runtime.root, 'dsh')
  mkdirSync(home)
  const file = join(home, 'launch-url')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const { logged, errored } = captureOutput(t)
  chmodSync(home, 0o500)
  try {
    const disposers = openWebApp(apply, 'read-only')
    assert.equal(logged.at(-1), 'dsh web: http://127.0.0.1:43123/?token=read-only', 'the URL line still prints')
    assert.equal(errored.length, 1)
    assert.ok(errored[0].includes(`could not save the launch URL in ${file}`), errored[0])
    assert.match(errored[0], /EACCES/, errored[0])
    assert.equal(existsSync(file), false)
    assert.equal(disposers.length, 1)
    for (const dispose of disposers) assert.doesNotThrow(dispose)
  } finally {
    chmodSync(home, 0o700)
  }
})

test('the connection 401 names the launch URL file, resolved from DSH_HOME', async (t) => {
  const runtime = makeRuntime(t)
  patchRuntime(runtime.modules, runtime.patches)
  const { apply } = await import(pathToFileURL(runtime.connectionFile).href)
  const webServer = { protocol: 'http:', host: '127.0.0.1:43123', register() {} }
  const ctx = {
    root: {},
    credentials: { async modifyRecord(key, modify) { return await modify(undefined) } },
    get(name) { return name === 'webServer' ? webServer : undefined },
    effect() { return () => {} },
    inject() {},
    on() {},
  }
  await apply(ctx, {})
  const { connection } = ctx
  const home = join(runtime.root, 'dsh')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const deny = () => {
    const response = { status: undefined, body: undefined }
    const res = {
      writeHead(status) { response.status = status },
      end(body) { response.body = body },
    }
    const request = { url: '/', method: 'GET', headers: { host: '127.0.0.1:43123' } }
    connection.authorizeIndex(request, res)
    return response
  }
  const denied = deny()
  assert.equal(denied.status, 401)
  assert.ok(denied.body.includes(`${home}/launch-url`), denied.body)
  process.env.DSH_HOME = ''
  const fallback = deny()
  assert.equal(fallback.status, 401)
  assert.ok(fallback.body.includes('~/.dsh/launch-url'), fallback.body)
})
