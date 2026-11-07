// The browser-session cookie contract (issue #632), tested against the real pinned package
// rather than a stand-in: fixtures/client-connection-cookie-lax/index.js is the unmodified
// lib/index.js of @deepseek-ai/dsh-client-connection 0.2.2-rc.1 (MIT; LICENSE beside it).
// Its sha256 must be the `before` hash in runtime/patches/patches.json, so these tests apply
// the carried patch to the bytes npm actually installs, import the patched module, and drive
// its real apply(): the real BrowserAuth/HostConnectionService mint the launch cookie through
// authorizeIndex, the entry the web carrier calls.
//
// What this does NOT cover: prepare-runtime's install (npm ci, the profile, pruning), the
// desktop build and the server image build (the boot check and the Server image CI job
// exercise those), and a real browser: no phone camera or QR scan opens the link here, so
// this asserts the Set-Cookie the patched serializer mints, not that a browser sends it on a
// cross-site navigation. schemastery, zod, cordis, dsh-credentials and dsh-scope are load-time
// stand-ins; the code under test is BrowserAuth in the patched bytes, not plugin wiring or
// credential storage.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const PATCHES = join(APP, 'runtime', 'patches')
const FIXTURE_DIR = join(HERE, 'fixtures', 'client-connection-cookie-lax')
const FIXTURE = join(FIXTURE_DIR, 'index.js')
const LICENSE = join(FIXTURE_DIR, 'LICENSE')
const PACKAGE = '@deepseek-ai/dsh-client-connection'
const FILE = 'lib/index.js'
const PATCH = 'client-connection-cookie-lax.patch'
// The release this patch is carried for, as the PR promises: dsh and the package are both
// 0.2.2-rc.1. The runtime pins must agree, and the fixture must be the file they were made on.
const DSH = '0.2.2-rc.1'
const VERSION = '0.2.2-rc.1'
// The Host the fake requests carry; the cookie audience is derived from it (and, on TLS, from
// its https origin), exactly as requestAudience reads a real node:http request.
const HOST = '127.0.0.1:3773'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = text => createHash('sha256').update(text).digest('hex')

// Stand-ins for the package's five imports, which only have to load and construct the module:
// schemastery and zod build schemas at module load (schemastery is also called by apply for
// the recovery defaults), cordis supplies the Service base the exported HostConnectionService
// extends, and credentials and dsh-scope are touched while creating the browser-session owner
// and the browser Peer. None of them is under test; the patched serializer is in the vendored
// bytes. Cordis's one modelled behavior is the one this test needs: the Service constructor
// puts the instance on the owning context, which is how the real Cordis hands out a service.
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
    '}',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-credentials': 'export const credentialKey = (namespace, key) => `${namespace}:${key}`\n',
  '@deepseek-ai/cordis': [
    'export class Service {',
    '  constructor(ctx, name) {',
    '    this.ctx = ctx',
    '    if (name !== undefined) ctx[name] = this',
    '  }',
    '}',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-scope': 'export const createScope = (owner, key) => ({ ctx: owner, dispose: async () => {} })\n',
  'zod': 'const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain })\nexport const z = chain\n',
}

function writeStub(root, name, source) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0-test', type: 'module', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), source)
}

function entry() {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === PATCH)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${PATCH}`)
  return entries[0]
}

// A runtime the helper can patch: the dsh pin, the package's version, the real before file,
// and a patches folder holding only this entry (patchRuntime is all-or-nothing over a folder,
// and the other carried patches target packages this test would have to invent too).
function makeRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-cookie-lax-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')
  const pkg = join(modules, PACKAGE)
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  mkdirSync(join(modules, '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(join(modules, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: DSH }))
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: PACKAGE, version: VERSION, type: 'module' }))
  writeFileSync(join(pkg, FILE), readFileSync(FIXTURE))
  for (const [name, source] of Object.entries(STUBS)) writeStub(root, name, source)
  const patches = join(root, 'patches')
  mkdirSync(patches)
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify([entry()], null, 2)}\n`)
  cpSync(join(PATCHES, PATCH), join(patches, PATCH))
  return { root, modules, patches, file: join(pkg, FILE) }
}

// The patched plugin's real entry point: apply() builds the real BrowserAuth and the exported
// HostConnectionService. The fake context supplies only what apply/construction read, and its
// mutable webServer is what HostConnectionService.authorizeIndex reads for the TLS decision.
async function openConnection(t) {
  const runtime = makeRuntime(t)
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const { apply } = await import(pathToFileURL(runtime.file).href)
  const webServer = { protocol: 'http:', host: HOST, register() {} }
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
  assert.equal(typeof connection?.authorizeIndex, 'function', 'apply must provide the Connection service')
  return { connection, webServer }
}

// Drive one request through the real authorizeIndex with the minimal fake node:http pair.
function authorize(connection, { url = '/', method = 'GET', headers = {} } = {}) {
  const response = { status: undefined, headers: undefined, body: undefined, ended: false }
  const res = {
    writeHead(status, table) { response.status = status; response.headers = table },
    end(body) { response.body = body; response.ended = true },
  }
  const allowed = connection.authorizeIndex({ url, method, headers }, res)
  return { allowed, ...response }
}

test('patches.json pins the real 0.2.2-rc.1 file to the desktop runtime', () => {
  const patch = entry()
  assert.equal(patch.dsh, DSH)
  assert.equal(readJson(join(APP, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh'], DSH)
  assert.equal(patch.files.length, 1)
  const [file] = patch.files
  assert.deepEqual({ package: file.package, version: file.version, file: file.file }, { package: PACKAGE, version: VERSION, file: FILE })
  assert.equal(readJson(join(APP, 'runtime', 'package-lock.json')).packages[`node_modules/${PACKAGE}`]?.version, VERSION)
  assert.match(file.before, /^[0-9a-f]{64}$/)
  assert.match(file.after, /^[0-9a-f]{64}$/)
  assert.notEqual(file.before, file.after)
  assert.equal(sha256(readFileSync(FIXTURE)), file.before, 'the checked-in fixture must be the exact file the entry was made against')
  assert.match(readFileSync(LICENSE, 'utf8'), /^MIT License\n/)
  assert.match(readFileSync(FIXTURE, 'utf8'), /HttpOnly; SameSite=Strict/)
  const patchText = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(patchText.startsWith(`--- a/${PACKAGE}/${FILE}\n+++ b/${PACKAGE}/${FILE}\n`), patchText.slice(0, 120))
  assert.match(patchText, /^-\t.*HttpOnly; SameSite=Strict`;$/m)
  assert.match(patchText, /^\+\t.*HttpOnly; SameSite=Lax`;$/m)
})

test('the carried patch applies to the real file it pins, and a re-run leaves it alone', (t) => {
  const runtime = makeRuntime(t)
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(({ name, state }) => ({ name, state })), [{ name: `${PACKAGE}/${FILE}`, state: 'patched' }])
  const { after } = entry().files[0]
  assert.equal(sha256(readFileSync(runtime.file)), after)
  const patched = readFileSync(runtime.file, 'utf8')
  assert.match(patched, /HttpOnly; SameSite=Lax/)
  assert.doesNotMatch(patched, /SameSite=Strict/)
  const second = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(second.map(({ state }) => state), ['already patched'])
  assert.equal(sha256(readFileSync(runtime.file)), after)
})

test('the patched browser auth mints an HttpOnly, SameSite=Lax cookie and redirects to ./', async (t) => {
  const { connection, webServer } = await openConnection(t)

  for (const secure of [false, true]) {
    webServer.protocol = secure ? 'https:' : 'http:'
    const scheme = secure ? 'https' : 'http'
    const authority = secure ? `${scheme}://${HOST}` : HOST
    const token = new URL(connection.authenticatedUrl(`${scheme}://${HOST}/`)).searchParams.get('token')
    assert.match(token, /^[A-Za-z0-9_-]{43}$/, `${scheme}: launch token shape`)

    const minted = authorize(connection, { url: `/?token=${encodeURIComponent(token)}`, headers: { host: HOST } })
    assert.equal(minted.allowed, false, `${scheme}: the mint owns the response`)
    assert.equal(minted.status, 303, `${scheme}: status`)
    assert.equal(minted.headers.location, './', `${scheme}: location`)
    assert.equal(minted.headers['cache-control'], 'no-store', `${scheme}: cache-control`)
    assert.equal(minted.headers['referrer-policy'], 'no-referrer', `${scheme}: referrer-policy`)
    assert.equal(minted.ended, true, `${scheme}: response ends`)
    assert.equal(minted.body, undefined, `${scheme}: no body`)

    const cookie = minted.headers['set-cookie']
    assert.equal(typeof cookie, 'string', `${scheme}: one Set-Cookie string`)
    assert.doesNotMatch(cookie, /SameSite=Strict/)
    const [pair, ...attributes] = cookie.split('; ')
    const at = pair.indexOf('=')
    const name = pair.slice(0, at)
    const value = pair.slice(at + 1)
    assert.match(name, /^dsh-auth-[A-Za-z0-9_-]{43}$/, `${scheme}: dsh-auth-* base64url audience hash`)
    assert.equal(name, `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`, `${scheme}: cookie name is unchanged`)
    const [version, body, signature] = value.split('.')
    assert.equal(version, 'v1', `${scheme}: cookie value version`)
    assert.match(body, /^[A-Za-z0-9_-]+$/, `${scheme}: base64url payload`)
    assert.match(signature, /^[A-Za-z0-9_-]{43}$/, `${scheme}: base64url signature`)
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    assert.equal(payload.version, 1, `${scheme}: payload version`)
    assert.equal(payload.authority, authority, `${scheme}: payload authority`)
    assert.ok(Number.isSafeInteger(payload.issuedAt), `${scheme}: issuedAt`)
    assert.ok(Number.isSafeInteger(payload.expiresAt), `${scheme}: expiresAt`)
    assert.ok(payload.expiresAt > payload.issuedAt, `${scheme}: expires after issue`)

    assert.ok(attributes.includes('HttpOnly'), `${scheme}: HttpOnly is unchanged`)
    assert.ok(attributes.includes('SameSite=Lax'), `${scheme}: SameSite=Lax`)
    assert.equal(attributes.includes('Secure'), secure, `${scheme}: Secure only on a TLS listener`)
    assert.ok(attributes.includes('Path=/'), `${scheme}: Path=/`)

    // The value still verifies: replaying the exact pair on a token-less index request is
    // allowed, so the minted name/value shape is the one the verifier expects.
    const replay = authorize(connection, { headers: { host: HOST, cookie: pair } })
    assert.equal(replay.allowed, true, `${scheme}: the minted cookie authenticates the index`)
    assert.equal(replay.ended, false, `${scheme}: an allowed request owns no response`)
  }
})
