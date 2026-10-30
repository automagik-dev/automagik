// The web app's name: off unless `appManifest` is configured; set, the plugin serves its own
// manifest and icon on exact webServer routes and swaps index.html's <title>.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../index.js'
import { fakeLlm } from './fake-llm.js'

// DSH's own index.html head and manifest, as dsh-web-frontend ships them.
const DSH_INDEX = '<!doctype html>\n<html lang="en">\n  <head>\n    <link rel="manifest" href="./manifest.webmanifest" />\n    <title>DeepSeek Harness</title>\n  </head>\n</html>\n'
const DSH_MANIFEST = { name: 'DeepSeek Harness', short_name: 'DSH', start_url: './', scope: './', display: 'fullscreen', icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'

// DSH's webServer as the plugin sees it: exact routes (a duplicate path throws) and index taps.
function fakeWebServer() {
  const exact = new Map()
  const taps = []
  return {
    exact,
    taps,
    register(route) {
      assert.equal(route.kind, 'exact')
      if (exact.has(route.path)) throw new Error(`duplicate exact route "${route.path}"`)
      exact.set(route.path, route)
      return () => exact.delete(route.path)
    },
    tapIndex(transform) {
      taps.push(transform)
      return () => taps.splice(taps.indexOf(transform), 1)
    },
    renderIndex: html => taps.reduce((out, tap) => tap(out), html),
  }
}

// The host context: ctx.inject hands DSH's webServer to a webServer row, holds the work view.
function fakeContext(webServer) {
  const disposers = []
  const logs = []
  const injected = []
  const effect = execute => { disposers.push(execute()) }
  return {
    llm: fakeLlm(),
    logs,
    injected,
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(['warn', ...args]) },
    effect,
    inject(names, callback) {
      injected.push(names)
      if (names.includes('webServer')) callback({ webServer, effect, logger: this.logger })
    },
    async unload() { for (const dispose of disposers.reverse()) await dispose?.() },
  }
}

async function withPlugin(config, run) {
  const dir = mkdtempSync(join(tmpdir(), 'unfold-bridge-app-'))
  const was = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = dir
  const web = fakeWebServer()
  const ctx = fakeContext(web)
  try {
    plugin.apply(ctx, typeof config === 'function' ? config(dir) : config)
    await run({ web, ctx, dir })
  } finally {
    await ctx.unload()
    if (was === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = was
    rmSync(dir, { recursive: true, force: true })
  }
}

// One request through a route's handler: status, headers and body.
async function call(route, method = 'GET') {
  const out = { status: 0, headers: {}, body: Buffer.alloc(0) }
  await route.handler({ method, url: route.path, headers: {} }, {
    writeHead(status, headers = {}) { out.status = status; out.headers = headers },
    end(body) { if (body !== undefined) out.body = Buffer.from(body) },
  })
  return out
}

test('unset or incomplete, appManifest registers no route and leaves the title as DSH has it', async () => {
  const configs = [undefined, {}, { appManifest: null }, { appManifest: { name: 'Unfold Automagik' } }, { appManifest: { name: '', short_name: 'Unfold' } }, { appManifest: { name: 'A', short_name: 'B', theme_color: 'red' } }, { appManifest: { name: 'A', short_name: 'B', icon: 'relative.svg' } }]
  for (const config of configs) {
    await withPlugin(config, ({ web, ctx }) => {
      assert.ok(!ctx.injected.some(names => names.includes('webServer')), `no webServer use for ${JSON.stringify(config)}`)
      assert.equal(web.exact.size, 0)
      assert.equal(web.renderIndex(DSH_INDEX), DSH_INDEX)
    })
  }
  // A config that names the feature but can't run it says so, once; an unset one says nothing.
  const { appManifestOf } = await import('../src/host/app-manifest.js')
  assert.equal(appManifestOf(undefined, { warn: () => assert.fail('unset warns') }), null)
  const warned = []
  assert.equal(appManifestOf({ appManifest: { name: 'Unfold Automagik' } }, { warn: line => warned.push(line) }), null)
  assert.deepEqual(warned, ["appManifest refused (name and short_name are required); the page keeps DSH's own name"])
})

test('set, /manifest.webmanifest serves the configured names as DSH\'s manifest does, and unload removes it', async () => {
  const config = { appManifest: { name: 'Unfold Automagik', short_name: 'Unfold', theme_color: '#1a1a2e', background_color: '#fbf5ec' } }
  let web
  await withPlugin(config, async (got) => {
    web = got.web
    assert.deepEqual([...web.exact.keys()], ['/manifest.webmanifest'])
    const res = await call(web.exact.get('/manifest.webmanifest'))
    assert.equal(res.status, 200)
    assert.equal(res.headers['content-type'], 'application/manifest+json')
    assert.deepEqual(JSON.parse(res.body.toString('utf8')), { ...DSH_MANIFEST, name: 'Unfold Automagik', short_name: 'Unfold', theme_color: '#1a1a2e', background_color: '#fbf5ec' })
    const head = await call(web.exact.get('/manifest.webmanifest'), 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body.length, 0)
    const post = await call(web.exact.get('/manifest.webmanifest'), 'POST')
    assert.equal(post.status, 405)
  })
  assert.equal(web.exact.size, 0, 'unload drops the routes, so a reload can register them again')
  assert.equal(web.taps.length, 0)
})

test('set with an icon, the manifest points at the icon route and that route serves the file', async () => {
  await withPlugin(dir => {
    const icon = join(dir, 'mark.svg')
    writeFileSync(icon, SVG)
    return { appManifest: { name: 'Unfold Automagik', short_name: 'Unfold', icon } }
  }, async ({ web }) => {
    assert.deepEqual([...web.exact.keys()], ['/manifest.webmanifest', '/unfold-bridge/app-icon.svg'])
    const manifest = JSON.parse((await call(web.exact.get('/manifest.webmanifest'))).body.toString('utf8'))
    assert.deepEqual(manifest.icons, [{ src: 'unfold-bridge/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }])
    const res = await call(web.exact.get('/unfold-bridge/app-icon.svg'))
    assert.equal(res.status, 200)
    assert.equal(res.headers['content-type'], 'image/svg+xml')
    assert.equal(res.body.toString('utf8'), SVG)
  })
})

test('set, index.html\'s <title> carries the configured name, escaped, and nothing else in the page changes', async () => {
  await withPlugin({ appManifest: { name: 'Unfold <Automagik> & co', short_name: 'Unfold' } }, ({ web }) => {
    assert.equal(web.taps.length, 1)
    assert.equal(web.renderIndex(DSH_INDEX), DSH_INDEX.replace('<title>DeepSeek Harness</title>', '<title>Unfold &#60;Automagik&#62; &#38; co</title>'))
  })
})
