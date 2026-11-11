// Real browser QA against local static pages and the real Pages Functions with an isolated
// in-memory SQLite fixture. No production binding, provider key or mail delivery is used.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { routes, rootFiles } from './scripts/build-pages.mjs'
import { fixture } from './waitlist/d1-fixture.mjs'
import { onRequest as waitlist } from './functions/api/waitlist.js'
import { onRequest as emailLink } from './functions/api/waitlist/email-confirm.js'

const root = dirname(fileURLToPath(import.meta.url))
const evidence = resolve(process.env.LANDING_EVIDENCE ?? join(root, '../../.cache/landing-evidence'))
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }
const isolated = fixture()
let bindingMode = 'missing', origin
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/api/waitlist' || pathname === '/api/waitlist/email-confirm') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const request = new Request(origin + req.url, { method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': '203.0.113.1' }, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) })
      const env = bindingMode === 'ready' ? isolated.env : {}
      const response = await (pathname.endsWith('email-confirm') ? emailLink : waitlist)({ request, env })
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()))
      return
    }
    const path = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`)
    if (!path.startsWith(root + sep)) return res.writeHead(403).end()
    const body = await readFile(path)
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'X-Robots-Tag': 'noindex, nofollow' }).end(body)
  } catch { res.writeHead(404).end() }
})
let browser
const reports = []
async function guard(context) {
  const outside = []
  await context.route('**/*', route => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())))
  return outside
}
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  origin = `http://127.0.0.1:${server.address().port}`
  await mkdir(evidence, { recursive: true })
  for (const [path, text] of rootFiles()) {
    const response = await fetch(`${origin}/${path}`)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), text, path)
    assert.match(response.headers.get('x-robots-tag'), /noindex/)
  }
  console.log('PASS root discovery files: 200, generated content, preview noindex')
  browser = await chromium.launch({ executablePath: process.env.LANDING_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  for (const route of routes) for (const colorScheme of ['light', 'dark']) for (const width of [1440, 1024, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
    try {
      const outside = await guard(context)
      const page = await context.newPage(), responses = [], errors = []
      page.on('response', response => responses.push({ url: response.url().replace(origin, ''), status: response.status(), type: response.request().resourceType(), contentType: response.headers()['content-type'] }))
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(origin + route, { waitUntil: 'load' })
      await page.evaluate(() => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode() })).then(() => document.fonts.ready))
      await page.waitForLoadState('networkidle')
      const report = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth, viewport: innerWidth,
        images: [...document.images].map(image => ({ src: image.currentSrc.replace(location.origin, ''), ok: image.complete && image.naturalWidth > 0, shown: image.getBoundingClientRect().width })),
        fonts: ['Manrope', 'DM Sans'].every(family => [...document.fonts].some(font => font.family.replaceAll('"', '') === family && font.status === 'loaded')),
        robots: document.querySelector('meta[name="robots"]')?.content,
        h1: document.querySelectorAll('h1').length,
        reducedMotion: [...document.getAnimations()].every(animation => animation.playState !== 'running'),
        background: getComputedStyle(document.body).backgroundColor,
      }))
      const label = `${route} ${colorScheme} ${width}px`
      assert.equal(report.scroll, report.viewport, `Horizontal overflow: ${label}`)
      // The homepage's brand accent hides on narrow screens by design; shown product images
      // still must decode, and every image request must return 200.
      assert.ok(report.images.every(image => image.ok), `Every image decodes: ${label}`)
      assert.ok(report.fonts, `Both bundled fonts loaded: ${label}`)
      assert.equal(report.robots, 'noindex, nofollow'); assert.equal(report.h1, 1)
      assert.ok(report.reducedMotion)
      assert.equal(report.background, colorScheme === 'dark' ? 'rgb(30, 25, 35)' : 'rgb(246, 238, 226)')
      for (const src of new Set(report.images.map(image => image.src))) assert.ok(responses.some(response => response.url === src && response.status === 200), `${src} answered 200: ${label}`)
      assert.deepEqual(responses.filter(response => response.status >= 400), [], `No failed request: ${label}`)
      assert.deepEqual(outside, [], `No external request: ${label}`); assert.deepEqual(errors, [])
      if (await page.locator('video').count()) {
        const video = page.locator('video'); assert.equal(await video.count(), 1)
        await video.evaluate(async element => { element.muted = true; await element.play() })
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0)
        await video.evaluate(element => element.pause())
        assert.ok(responses.some(response => response.url.endsWith('.mp4') && response.contentType === 'video/mp4' && [200, 206].includes(response.status)))
      }
      if (route === '/cloud/') {
        await page.locator('#privacy').evaluate(details => { details.open = true })
        await page.getByRole('heading', { name: 'Support on WhatsApp', exact: true }).waitFor()
        await page.getByRole('heading', { name: 'Suporte pelo WhatsApp', exact: true }).waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Expanded privacy overflow: ${label}`)
        await page.locator('#privacy').evaluate(details => { details.open = false })
      }
      const slug = route === '/' ? 'home' : route.split('/')[1]
      const screenshot = join(evidence, `${slug}-${colorScheme}-${width}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      if ([1440, 390].includes(width)) {
        const viewportShot = await page.screenshot()
        const appShot = await readFile(join(root, `assets/screens/app-stage-${colorScheme}-${width}.png`))
        const comparison = await context.newPage()
        await comparison.setViewportSize({ width: width * 2, height: 934 })
        await comparison.setContent(`<html><body style="margin:0;background:${report.background};color:${colorScheme === 'dark' ? '#f3e9dd' : '#3c3049'};font:14px system-ui;display:flex"><div style="width:${width}px;flex:none"><p style="height:34px;margin:0;padding:6px 12px;box-sizing:border-box">Site ${route} · ${colorScheme} · ${width}px</p><img style="display:block;width:100%" src="data:image/png;base64,${viewportShot.toString('base64')}"></div><div style="width:${width}px;flex:none"><p style="height:34px;margin:0;padding:6px 12px;box-sizing:border-box">Real app · ${colorScheme} · ${width}px</p><img style="display:block;width:100%" src="data:image/png;base64,${appShot.toString('base64')}"></div></body></html>`)
        await comparison.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
        await comparison.screenshot({ path: join(evidence, `comparison-${slug}-${colorScheme}-${width}.png`) })
        await comparison.close()
      }
      reports.push({ route, colorScheme, width, ...report, responses, screenshot })
      console.log(`PASS ${label}: no overflow; images and fonts loaded; local requests`)
    } finally { await context.close() }
  }
  // Native form submissions against the actual function, with no real binding/provider.
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const outside = await guard(context)
  try {
    const page = await context.newPage()
    const fill = async () => {
      await page.goto(origin + '/cloud/')
      await page.locator('[name=goal]').fill('Review the project reports')
      await page.locator('[name=expected_result]').fill('A report I can review')
      await page.locator('.waitlist-form [name=channel]').selectOption('whatsapp')
      await page.locator('[name=consent]').check()
    }
    await fill()
    const failure = page.waitForResponse(response => response.url() === origin + '/api/waitlist' && response.request().method() === 'POST')
    await page.getByRole('button', { name: /Register my interest/ }).click()
    assert.equal((await failure).status(), 503)
    await page.getByRole('heading', { name: 'Registration is unavailable' }).waitFor()
    assert.doesNotMatch(await page.locator('main').innerText(), /Your interest is confirmed/)
    bindingMode = 'ready'
    await fill()
    const success = page.waitForResponse(response => response.url() === origin + '/api/waitlist' && response.request().method() === 'POST')
    await page.getByRole('button', { name: /Register my interest/ }).click()
    assert.equal((await success).status(), 200)
    await page.getByRole('heading', { name: 'Send your confirmation to our support Bot' }).waitFor()
    assert.ok(await page.locator('a[href^="https://wa.me/15555550100"]').count())
    assert.ok(await page.locator('.qr svg').count())
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
    await page.screenshot({ path: join(evidence, 'whatsapp-code-390.png'), fullPage: true })
    assert.deepEqual(outside, [])
    assert.equal(isolated.sqlite.prepare('SELECT count(*) AS n FROM waitlist WHERE confirmed_at IS NOT NULL').get().n, 0)
    console.log('PASS native form: missing binding 503; isolated WhatsApp code 200; QR rendered; no external request or false confirmation')
  } finally { await context.close() }
  await writeFile(join(evidence, 'browser-report.json'), JSON.stringify(reports, null, 2) + '\n')
} finally {
  await browser?.close()
  if (server.listening) await new Promise(done => server.close(done))
  isolated.close()
}
