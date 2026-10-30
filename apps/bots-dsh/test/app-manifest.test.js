// The web app's name: an Automagik install's page is "Automagik", with the Automagik app icon,
// on exact webServer routes ahead of DSH's static manifest, and index.html's <title> says so.
// config.appManifest names it otherwise (Unfold's own instance), or is false to keep DSH's name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// DSH's own index.html head and manifest, as dsh-web-frontend ships them.
const DSH_INDEX = '<!doctype html>\n<html lang="en">\n  <head>\n    <link rel="manifest" href="./manifest.webmanifest" />\n    <title>DeepSeek Harness</title>\n  </head>\n</html>\n'
const DSH_FIELDS = { start_url: './', scope: './', display: 'fullscreen' }
const appIcon = () => readFileSync(new URL('../src/host/app-icon.png', import.meta.url))
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'

// DSH's webServer as a plugin sees it: exact routes (a duplicate path throws) and index taps.
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
    renderIndex: (html) => taps.reduce((out, tap) => tap(out), html),
  }
}

// `server` is the webServer handed to the plugin: a fake by default, `null` for a host without one.
async function withRuntime(config, run, { server = fakeWebServer() } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-app-manifest-'))
  const web = server ?? undefined
  const ctx = fakeContext()
  const warnings = []
  ctx.logger = { info() {}, warn: (...args) => warnings.push(args.slice(1).join(' ')) }
  // Only webServer is handed over here; the runtime's other optional services stay absent.
  ctx.inject = (names, callback) => {
    if (names.length === 1 && names[0] === 'webServer') callback({ webServer: web, effect: ctx.effect })
  }
  try {
    createRuntime(ctx, { home, github: false, diagnosticsFile: false, ...(typeof config === 'function' ? config(home) : config) })
    await run({ web, warnings, home })
  } finally {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return web
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

const manifest = async (web) => {
  const res = await call(web.exact.get('/manifest.webmanifest'))
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/manifest+json')
  return JSON.parse(res.body.toString('utf8'))
}

test('by default the page is "Automagik", with the Automagik app icon, and unload removes it all', async () => {
  const web = await withRuntime({}, async ({ web, warnings }) => {
    assert.deepEqual([...web.exact.keys()], ['/manifest.webmanifest', '/omni-ui/app-icon.png'])
    assert.deepEqual(await manifest(web), {
      name: 'Automagik',
      short_name: 'Automagik',
      ...DSH_FIELDS,
      icons: [{ src: 'omni-ui/app-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
    })
    const icon = await call(web.exact.get('/omni-ui/app-icon.png'))
    assert.equal(icon.status, 200)
    assert.equal(icon.headers['content-type'], 'image/png')
    assert.ok(icon.body.equals(appIcon()))
    assert.equal(web.renderIndex(DSH_INDEX), DSH_INDEX.replace('<title>DeepSeek Harness</title>', '<title>Automagik</title>'))
    const head = await call(web.exact.get('/manifest.webmanifest'), 'HEAD')
    assert.deepEqual([head.status, head.body.length], [200, 0])
    assert.equal((await call(web.exact.get('/manifest.webmanifest'), 'POST')).status, 405)
    assert.deepEqual(warnings, [])
  })
  assert.equal(web.exact.size, 0, 'unload drops the routes, so a reload can register them again')
  assert.equal(web.taps.length, 0)
})

test('appManifest names the page: configured names, colors and icon, and the title', async () => {
  await withRuntime((home) => {
    writeFileSync(join(home, 'mark.svg'), SVG)
    return { appManifest: { name: 'Unfold <Automagik>', short_name: 'Unfold', theme_color: '#1a1a2e', background_color: '#fbf5ec', icon: join(home, 'mark.svg') } }
  }, async ({ web, warnings }) => {
    assert.deepEqual([...web.exact.keys()], ['/manifest.webmanifest', '/omni-ui/app-icon.svg'])
    assert.deepEqual(await manifest(web), {
      name: 'Unfold <Automagik>',
      short_name: 'Unfold',
      ...DSH_FIELDS,
      theme_color: '#1a1a2e',
      background_color: '#fbf5ec',
      icons: [{ src: 'omni-ui/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    })
    const icon = await call(web.exact.get('/omni-ui/app-icon.svg'))
    assert.deepEqual([icon.headers['content-type'], icon.body.toString('utf8')], ['image/svg+xml', SVG])
    assert.equal(web.renderIndex(DSH_INDEX), DSH_INDEX.replace('<title>DeepSeek Harness</title>', '<title>Unfold &#60;Automagik&#62;</title>'))
    assert.deepEqual(warnings, [])
  })
  // Without an icon, the configured names keep the Automagik app icon.
  await withRuntime({ appManifest: { name: 'Unfold Automagik', short_name: 'Unfold' } }, async ({ web }) => {
    const got = await manifest(web)
    assert.deepEqual([got.name, got.short_name, got.icons[0].src], ['Unfold Automagik', 'Unfold', 'omni-ui/app-icon.png'])
  })
})

test('an appManifest it cannot use is refused with a warning, and the page stays "Automagik"', async () => {
  const bad = [
    [{ name: 'Unfold Automagik' }, 'name and short_name are required'],
    [{ name: ' ', short_name: 'Unfold' }, 'name and short_name are required'],
    [{ name: 'A', short_name: 'B', theme_color: 'red' }, 'theme_color is not a #hex color'],
    [{ name: 'A', short_name: 'B', icon: 'relative.svg' }, 'icon is not an absolute path to an .svg or .png file'],
    [{ name: 'A', short_name: 'B', icon: '/no/such/icon.png' }, 'icon unreadable: ENOENT'],
    ['Unfold', 'not an object or false'],
  ]
  for (const [appManifest, why] of bad) {
    await withRuntime({ appManifest }, async ({ web, warnings }) => {
      assert.equal((await manifest(web)).name, 'Automagik', JSON.stringify(appManifest))
      assert.equal(web.renderIndex(DSH_INDEX).includes('<title>Automagik</title>'), true)
      assert.deepEqual(warnings, [`omni-ui: appManifest refused (${why}); the page is named Automagik`])
    })
  }
})

test('appManifest false keeps DSH\'s own name, where unset names the page "Automagik"', async () => {
  await withRuntime({}, async ({ web }) => assert.equal(web.exact.size, 2))
  await withRuntime({ appManifest: false }, async ({ web, warnings }) => {
    assert.equal(web.exact.size, 0)
    assert.equal(web.taps.length, 0)
    assert.equal(web.renderIndex(DSH_INDEX), DSH_INDEX)
    assert.deepEqual(warnings, [])
  })
})

test('the icon is never sniffed, and an SVG icon runs no script and loads nothing', async () => {
  await withRuntime({}, async ({ web }) => {
    const png = await call(web.exact.get('/omni-ui/app-icon.png'))
    assert.deepEqual(png.headers, { 'content-type': 'image/png', 'x-content-type-options': 'nosniff' })
  })
  await withRuntime((home) => {
    writeFileSync(join(home, 'mark.svg'), SVG)
    return { appManifest: { name: 'Unfold Automagik', short_name: 'Unfold', icon: join(home, 'mark.svg') } }
  }, async ({ web }) => {
    const svg = await call(web.exact.get('/omni-ui/app-icon.svg'))
    assert.deepEqual(svg.headers, { 'content-type': 'image/svg+xml', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" })
  })
})

test('registration is all or nothing, and a host without webServer gets nothing and no error', async () => {
  // Another plugin already holds the icon's path: the manifest route registered before it is released.
  const web = fakeWebServer()
  const other = { kind: 'exact', path: '/omni-ui/app-icon.png', handler: async () => {} }
  web.register(other)
  await assert.rejects(withRuntime({}, async () => {}, { server: web }), /duplicate exact route "\/omni-ui\/app-icon.png"/)
  assert.deepEqual([...web.exact.keys()], ['/omni-ui/app-icon.png'])
  assert.equal(web.exact.get('/omni-ui/app-icon.png'), other)
  assert.equal(web.taps.length, 0)
  await withRuntime({}, async ({ warnings }) => assert.deepEqual(warnings, []), { server: null })
})
