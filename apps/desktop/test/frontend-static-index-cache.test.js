// The SPA index cache contract (issue #142), tested against the real pinned package rather
// than a stand-in: fixtures/frontend-static-index-cache/index.js is the unmodified
// lib/index.js of @deepseek-ai/dsh-host-frontend-static 0.2.2-rc.2 (MIT; LICENSE beside it).
// Its sha256 must be the `before` hash in runtime/patches/patches.json, so these tests apply
// the carried patch to the bytes npm actually installs and then run the patched code.
//
// What this does NOT cover: prepare-runtime's install (npm ci, the profile, pruning) and the
// server image build; the boot check and the Server image CI job exercise those. It also does
// not open a browser or an Electron window: it drives the patched fallback handler directly.
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
const FIXTURE = join(HERE, 'fixtures', 'frontend-static-index-cache', 'index.js')
const PACKAGE = '@deepseek-ai/dsh-host-frontend-static'
const FILE = 'lib/index.js'
const PATCH = 'frontend-static-index-cache.patch'
// The release this patch is carried for, as the PR promises: dsh and the package are both
// 0.2.2-rc.2. The runtime pins must agree, and the fixture must be the file they were made on.
const DSH = '0.2.2-rc.2'
const VERSION = '0.2.2-rc.2'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = text => createHash('sha256').update(text).digest('hex')

function entry() {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === PATCH)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${PATCH}`)
  return entries[0]
}

// A runtime the helper can patch: the dsh pin, the package's version, the real before file,
// and a patches folder holding only this entry (the teammate patch targets packages this
// test does not carry, and patchRuntime is all-or-nothing over the folder).
function makeRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-frontend-static-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')
  const pkg = join(modules, PACKAGE)
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  mkdirSync(join(modules, '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(join(modules, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: DSH }))
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: PACKAGE, version: VERSION, type: 'module' }))
  writeFileSync(join(pkg, FILE), readFileSync(FIXTURE))
  const patches = join(root, 'patches')
  mkdirSync(patches)
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify([entry()], null, 2)}\n`)
  cpSync(join(PATCHES, PATCH), join(patches, PATCH))
  return { root, modules, patches, file: join(pkg, FILE) }
}

test('patches.json pins the real 0.2.2-rc.2 file to the desktop runtime', () => {
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
  const patchText = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(patchText.startsWith(`--- a/${PACKAGE}/${FILE}\n+++ b/${PACKAGE}/${FILE}\n`), patchText.slice(0, 120))
})

test('the carried patch applies to the real file it pins, and a re-run leaves it alone', (t) => {
  const runtime = makeRuntime(t)
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(({ name, state }) => ({ name, state })), [{ name: `${PACKAGE}/${FILE}`, state: 'patched' }])
  const after = entry().files[0].after
  assert.equal(sha256(readFileSync(runtime.file)), after)
  const second = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(second.map(({ state }) => state), ['already patched'])
  assert.equal(sha256(readFileSync(runtime.file)), after)
})

test('the patched index sends no-cache and a weak ETag of the rendered bytes, and a match is an empty 304', async (t) => {
  const runtime = makeRuntime(t)
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')

  // The module imports @deepseek-ai/schemastery only to build Config at load time; this test
  // drives the fallback, so a stand-in that leaves the shape alone is enough to load it.
  const schemastery = join(runtime.root, 'node_modules', '@deepseek-ai', 'schemastery')
  mkdirSync(schemastery, { recursive: true })
  writeFileSync(join(schemastery, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', version: '0.0.0-test', type: 'module', main: 'index.js' }))
  writeFileSync(join(schemastery, 'index.js'), 'export default { object: shape => shape, string: () => ({ required: () => ({}) }) }\n')
  const { apply } = await import(pathToFileURL(runtime.file).href)

  const dist = join(runtime.root, 'dist')
  mkdirSync(dist, { recursive: true })
  const raw = '<!doctype html><html><head><title>raw</title></head><body>raw</body></html>\n'
  // The webserver's renderIndex output; the fallback then injects <base href="./">, so the
  // served bytes (and the ETag) are `served`, not `rendered`.
  const rendered = '<!doctype html><html><head><title>rendered</title></head><body>rendered</body></html>'
  const served = rendered.replace('<head>', '<head><base href="./">')
  const asset = 'console.log("asset");\n'
  writeFileSync(join(dist, 'index.html'), raw)
  writeFileSync(join(dist, 'app.js'), asset)

  let fallback
  let refuse = false
  let authCalls = 0
  const connection = {
    browserPeer: { id: 'browser' },
    authorizeIndex(request, sink) {
      authCalls += 1
      if (!refuse) return true
      sink.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      sink.end('denied')
      return false
    },
  }
  apply({
    connection,
    webServer: {
      registerFallback({ resource }) { fallback = resource },
      renderIndex(html, peer) {
        assert.equal(html, raw)
        assert.equal(peer, connection.browserPeer)
        return rendered
      },
    },
    effect: run => run(),
  }, { distIndex: join(dist, 'index.html') })
  assert.equal(typeof fallback, 'function')

  const etag = `W/"${createHash('sha1').update(served).digest('base64url')}"`
  for (const path of ['/', '/index.html']) {
    const response = await fallback(new Request(`http://127.0.0.1${path}`))
    assert.equal(response.status, 200, `${path}: status`)
    assert.equal(await response.text(), served, `${path}: rendered body`)
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8', `${path}: content-type`)
    assert.equal(response.headers.get('cache-control'), 'no-cache', `${path}: cache-control`)
    assert.equal(response.headers.get('etag'), etag, `${path}: weak ETag of the rendered bytes`)
    assert.equal(response.headers.get('last-modified'), null, `${path}: no Last-Modified`)

    const again = await fallback(new Request(`http://127.0.0.1${path}`, { headers: { 'if-none-match': etag } }))
    assert.equal(again.status, 304, `${path}: matching If-None-Match`)
    assert.equal(again.headers.get('cache-control'), 'no-cache', `${path}: 304 cache-control`)
    assert.equal(again.headers.get('etag'), etag, `${path}: 304 ETag`)
    assert.equal(await again.text(), '', `${path}: 304 body`)
  }

  const head = await fallback(new Request('http://127.0.0.1/', { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('cache-control'), 'no-cache')
  assert.equal(head.headers.get('etag'), etag)
  assert.equal(await head.text(), '')

  const beforeAsset = authCalls
  const assetResponse = await fallback(new Request('http://127.0.0.1/app.js'))
  assert.equal(assetResponse.status, 200)
  assert.equal(assetResponse.headers.get('content-type'), 'text/javascript; charset=utf-8')
  const assetEtag = `W/"${createHash('sha1').update(asset).digest('base64url')}"`
  assert.equal(assetResponse.headers.get('cache-control'), 'no-cache')
  assert.equal(assetResponse.headers.get('etag'), assetEtag)
  assert.equal(await assetResponse.text(), asset)
  assert.equal(authCalls, beforeAsset, 'the non-index path does not authorize')
  const assetAgain = await fallback(new Request('http://127.0.0.1/app.js', { headers: { 'if-none-match': assetEtag } }))
  assert.equal(assetAgain.status, 304)

  // Authorization answers before the index is read and before any ETag match: remove the file,
  // send the matching ETag and refuse, and the answer must still be the refusal, not a 304/404.
  const beforeRefusal = authCalls
  rmSync(join(dist, 'index.html'))
  refuse = true
  const denied = await fallback(new Request('http://127.0.0.1/', { headers: { 'if-none-match': etag } }))
  assert.equal(denied.status, 401)
  assert.equal(await denied.text(), 'denied')
  assert.equal(denied.headers.get('etag'), null)
  assert.equal(authCalls, beforeRefusal + 1)
})
