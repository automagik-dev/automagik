// Isolated browser QA for the static Pages directory. No app profile or external requests.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = dirname(fileURLToPath(import.meta.url))
const evidence = resolve(process.env.LANDING_EVIDENCE ?? join(root, '../../.cache/landing-evidence'))
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4' }
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(root + sep)) return res.writeHead(403).end()
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'X-Robots-Tag': 'noindex, nofollow' }).end(body)
  } catch { res.writeHead(404).end() }
})
let browser
const reports = []
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const origin = `http://127.0.0.1:${server.address().port}`
  await mkdir(evidence, { recursive: true })
  browser = await chromium.launch({ executablePath: process.env.LANDING_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [1440, 1024, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
      try {
        const page = await context.newPage()
        const outside = [], responses = [], errors = []
        await page.route('**/*', route => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())))
        page.on('response', response => responses.push({ url: response.url().replace(origin, ''), status: response.status(), type: response.request().resourceType(), contentType: response.headers()['content-type'] }))
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(origin, { waitUntil: 'load' })
        await page.evaluate(() => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode() })).then(() => document.fonts.ready))
        await page.waitForLoadState('networkidle')
        const report = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          viewport: innerWidth,
          images: [...document.images].map(image => ({ src: image.currentSrc.replace(location.origin, ''), ok: image.complete && image.naturalWidth > 0, shown: image.getBoundingClientRect().width })),
          fonts: ['Manrope', 'DM Sans'].every(family => [...document.fonts].some(font => font.family.replaceAll('"', '') === family && font.status === 'loaded')),
          robots: document.querySelector('meta[name="robots"]')?.content,
          film: document.querySelectorAll('[data-film]').length,
          localLinks: [...document.querySelectorAll('a[href^="#"]')].every(link => document.getElementById(link.hash.slice(1))),
          reducedMotion: [...document.getAnimations()].every(animation => animation.playState !== 'running'),
          background: getComputedStyle(document.body).backgroundColor,
        }))
        const label = `${colorScheme} ${width}px`
        assert.equal(report.scroll, report.viewport, `Horizontal overflow: ${label}`)
        assert.ok(report.images.every(image => image.ok && image.shown > 0), `Every image decodes and shows: ${label}`)
        assert.ok(report.fonts, `Both bundled fonts loaded: ${label}`)
        assert.equal(report.robots, 'noindex, nofollow')
        assert.equal(report.film, 1)
        assert.ok(report.localLinks, `Anchor targets exist: ${label}`)
        assert.ok(report.reducedMotion, `Reduced motion respected: ${label}`)
        assert.equal(report.background, colorScheme === 'dark' ? 'rgb(22, 19, 28)' : 'rgb(250, 248, 252)')
        for (const src of new Set(report.images.map(image => image.src))) assert.ok(responses.some(response => response.url === src && response.status === 200), `${src} answered 200: ${label}`)
        const phoneShots = report.images.filter(image => image.src.endsWith('-phone.png')).length
        assert.equal(phoneShots, width <= 700 ? 2 : 0, `Responsive captures: ${label}`)
        // D2 can replace the placeholder with one native player, without weakening media QA.
        if (await page.locator('video').count()) {
          const video = page.locator('video')
          assert.equal(await video.count(), 1)
          await video.evaluate(async element => { element.muted = true; await element.play() })
          await page.waitForFunction(() => document.querySelector('video').currentTime > 0)
          const media = await video.evaluate(element => { element.pause(); return { ready: element.readyState, error: element.error?.message, poster: element.poster.replace(location.origin, '') } })
          assert.ok(media.ready >= 2 && !media.error, `Film plays: ${label}`)
          assert.ok(responses.some(response => response.url.endsWith('.mp4') && response.contentType === 'video/mp4' && [200, 206].includes(response.status)), `Local video/mp4: ${label}`)
          assert.ok(responses.some(response => response.url === media.poster && response.status === 200), `Poster answered 200: ${label}`)
        }
        assert.deepEqual(responses.filter(response => response.status >= 400), [], `No failed request: ${label}`)
        assert.deepEqual(outside, [], `No request outside the page: ${label}`)
        assert.deepEqual(errors, [], `No page error: ${label}`)
        await page.evaluate(() => scrollTo(0, 0))
        const screenshot = join(evidence, `landing-${colorScheme}-${width}.png`)
        await page.screenshot({ path: screenshot, fullPage: true })
        reports.push({ colorScheme, width, ...report, responses, screenshot })
        console.log(`PASS ${label}: no overflow; images decoded; fonts loaded; local requests; screenshot ${screenshot}`)
      } finally { await context.close() }
    }
  }
  await writeFile(join(evidence, 'browser-report.json'), JSON.stringify(reports, null, 2) + '\n')
} finally {
  await browser?.close()
  if (server.listening) await new Promise(done => server.close(done))
}
