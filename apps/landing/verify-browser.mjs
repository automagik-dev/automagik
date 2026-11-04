// Loads the page in a separate headless Chrome from a loopback server of its own and checks it
// as a visitor would: every image request answers 200, every image decodes, phone widths get
// the phone captures, nothing scrolls sideways, and the page makes no request elsewhere.
// Writes full-page screenshots to .cache/landing-evidence (ignored). Run from the checkout root:
// node apps/landing/verify-browser.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = dirname(fileURLToPath(import.meta.url))
const evidence = resolve(root, '../../.cache/landing-evidence')
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (!path.startsWith(root + sep)) return res.writeHead(403).end()
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.LANDING_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  for (const [width, phone] of [[1440, false], [1024, false], [390, true], [320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const outside = []
    const responses = []
    const errors = []
    await page.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : (outside.push(route.request().url()), route.abort())))
    page.on('response', response => responses.push({ url: response.url(), status: response.status(), type: response.request().resourceType() }))
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin, { waitUntil: 'load' })
    // Lazy images load as they come into view: walk the page once.
    for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += 600) await page.evaluate(top => scrollTo(0, top), y)
    await page.evaluate(() => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode() })).then(() => document.fonts.ready))
    await page.waitForLoadState('networkidle')
    const report = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
      images: [...document.images].map(image => ({ src: image.currentSrc.replace(location.origin, ''), ok: image.complete && image.naturalWidth > 0, shown: image.getBoundingClientRect().width })),
      fonts: document.fonts.check('16px Manrope') && document.fonts.check('16px "DM Sans"'),
    }))
    assert.equal(report.scroll, report.viewport, `Horizontal overflow at ${width}px`)
    assert.ok(report.images.every(image => image.ok && image.shown > 0), `Every image decodes and shows at ${width}px`)
    assert.ok(report.fonts, `Fonts load at ${width}px`)
    const images = responses.filter(response => response.type === 'image')
    // Each distinct image the page shows was fetched and answered 200 (a repeat is one request).
    for (const src of new Set(report.images.map(image => image.src))) assert.ok(images.some(response => response.url === origin + src && response.status === 200), `${src} answered 200 at ${width}px`)
    assert.deepEqual(images.filter(response => response.status !== 200), [], `Every image request answers 200 at ${width}px`)
    assert.deepEqual(responses.filter(response => response.status >= 400), [], `No failed request at ${width}px`)
    assert.deepEqual(outside, [], `No request outside the page at ${width}px`)
    assert.deepEqual(errors, [], `No page error at ${width}px`)
    const phoneShots = report.images.filter(image => image.src.endsWith('-phone.png')).length
    assert.equal(phoneShots, phone ? 2 : 0, `Phone captures ${phone ? 'used' : 'unused'} at ${width}px`)
    console.log(`PASS ${width}px: no overflow; ${images.length} image requests, all 200; ${report.images.length} images decoded (${phoneShots} phone captures)`)
    if (width === 1440 || width === 390) {
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: join(evidence, `landing-${width}.png`), fullPage: true })
    }
    await context.close()
  }
  console.log(`Screenshots: ${evidence}`)
} finally {
  await browser.close()
  await new Promise(done => server.close(done))
}
