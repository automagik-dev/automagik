// Real browser QA against local static pages and the real Pages Functions with an isolated
// in-memory SQLite fixture. No production binding, provider key or mail delivery is used.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { routes, rootFiles, platforms, offered, used } from './scripts/build-pages.mjs'
import { fixture } from './waitlist/d1-fixture.mjs'
import { onRequest as waitlist } from './functions/api/waitlist.js'
import { onRequest as emailLink } from './functions/api/waitlist/email-confirm.js'

const root = dirname(fileURLToPath(import.meta.url))
const evidence = resolve(process.env.LANDING_EVIDENCE ?? join(root, '../../.cache/landing-evidence'))
const types = { '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }
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
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch { res.writeHead(404).end() }
})
// The projects row's files for a dark page, as each project names them.
const rowDark = used.flatMap(({ mark: [, dark] }) => dark ? [`/assets/brand/used/${dark}`] : [])
let browser
const reports = []
// Layout shift, as the browser itself scores it (shifts right after a click or key do not
// count). The observer is the test's; the pages carry no script.
const watchShift = context => context.addInitScript(() => {
  window.__shift = 0
  new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value }).observe({ type: 'layout-shift', buffered: true })
})
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
    assert.equal(response.headers.get('x-robots-tag'), null, `${path} is indexable`)
  }
  console.log('PASS root discovery files: 200, generated content, indexable')
  browser = await chromium.launch({ executablePath: process.env.LANDING_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  for (const route of routes) for (const colorScheme of ['light', 'dark']) for (const width of [1440, 1024, 880, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
    try {
      const outside = await guard(context)
      await watchShift(context)
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
      const headingBounds = await page.evaluate(() => [...document.querySelectorAll('.hero-heading h1')].map(heading => {
        const card = heading.closest('.hero-heading'), box = card.getBoundingClientRect(), style = getComputedStyle(card)
        const range = document.createRange(); range.selectNodeContents(heading)
        const horizontal = rect => ({ left: rect.left, right: rect.right })
        return {
          card: horizontal(box),
          content: { left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) },
          heading: horizontal(heading.getBoundingClientRect()),
          text: [...range.getClientRects()].filter(rect => rect.width > 0).map(horizontal),
        }
      }))
      // Layout checks for the redesign: no heading word split across lines at any width, every
      // image sized, the film's still never the biggest picture, and a visible keyboard focus.
      // App pictures: a dark page shows the dark capture of each view and a light page the
      // light one; the home's speech bubble stays off the app window; and the hero's capture is
      // shown near its real size (a 1100px window, or the 390px one on phone-width screens).
      const layout = await page.evaluate(() => {
        const brokenWords = []
        for (const heading of document.querySelectorAll('h1, h2, h3')) {
          if (!heading.getClientRects().length) continue
          const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const match of node.data.matchAll(/\S+/g)) {
              const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length)
              const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top)))
              if (lines.size > 1) brokenWords.push(`${heading.tagName} "${match[0]}"`)
            }
          }
        }
        const area = image => { const box = image.getBoundingClientRect(); return box.width * box.height }
        const shown = [...document.images].filter(image => image.getClientRects().length && getComputedStyle(image).visibility !== 'hidden')
        const film = document.querySelector('[data-film] img')
        const unsized = [...document.images].filter(image => !image.getAttribute('width') || !image.getAttribute('height')).map(image => image.src)
        const themed = [...document.querySelectorAll('picture')].filter(picture => picture.querySelector('source[media*="prefers-color-scheme: dark"]')).map(picture => picture.querySelector('img').currentSrc.replace(location.origin, ''))
        const box = selector => { const node = document.querySelector(selector); return node ? node.getBoundingClientRect().toJSON() : null }
        // The Open Intelligence tag in the footer: its size, its colour, where it sits in the
        // footer's last row, what its link holds, and the logo it sits with.
        const tagLink = document.querySelector('.footer-end > .oi-tag'), tagBox = tagLink.querySelector('svg').getBoundingClientRect()
        const row = document.querySelector('.footer-end').getBoundingClientRect(), licence = document.querySelector('.footer-license').getBoundingClientRect()
        const tag = {
          width: tagBox.width, height: tagBox.height, left: Math.round(tagBox.left - row.left), right: Math.round(row.right - tagBox.right),
          beside: tagBox.top < licence.bottom && tagBox.bottom > licence.top, under: tagBox.top >= licence.bottom,
          colour: getComputedStyle(tagLink.querySelector('text')).fill, text: getComputedStyle(document.querySelector('.site-footer nav a')).color,
          holds: [...tagLink.childNodes].map(node => node.nodeName), href: tagLink.href, words: tagLink.querySelector('text').textContent,
          font: document.fonts.check('600 18px "IBM Plex Mono"'), logo: document.querySelector('.footer-brand .brand img').getBoundingClientRect().width,
        }
        return { tag, brokenWords, unsized, film: film ? area(film) : 0, largest: Math.max(0, ...shown.filter(image => !image.closest('[data-film]')).map(area)), themed, bubble: box('.bubble'), heroWindow: box('.scene-window img') }
      })
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => ({ skip: document.activeElement?.classList.contains('skip'), outline: getComputedStyle(document.activeElement).outlineStyle }))
      await page.keyboard.press('Tab')
      const nextFocus = await page.evaluate(() => { const style = getComputedStyle(document.activeElement).outlineStyle; document.activeElement.blur(); return style })
      const label = `${route} ${colorScheme} ${width}px`
      assert.deepEqual(layout.brokenWords, [], `A heading word breaks across lines: ${label}`)
      assert.deepEqual(layout.unsized, [], `Images without width/height: ${label}`)
      assert.ok(layout.tag.width === 170 && layout.tag.height === 32 && layout.tag.colour === layout.tag.text && layout.tag.font && layout.tag.words === 'OPEN INTELLIGENCE', `The Open Intelligence tag is 170 by 32 px, in the footer's text colour and its own type: ${label} ${JSON.stringify(layout.tag)}`)
      assert.ok(layout.tag.holds.length === 1 && layout.tag.holds[0] === 'svg' && layout.tag.href === 'https://weunfold.ai/', `The tag's link holds nothing but the tag: ${label} ${JSON.stringify(layout.tag.holds)}`)
      assert.ok(width > 700 ? layout.tag.right === 0 && layout.tag.beside : layout.tag.left === 0 && layout.tag.under, `The tag ends the footer's last row on a wide screen and sits under it, at the left, on a phone: ${label} ${JSON.stringify(layout.tag)}`)
      assert.ok(layout.tag.logo * 1325 / 1632.34 >= layout.tag.width, `The tag is never bigger than the logo's word: ${label} ${layout.tag.logo}`)
      assert.deepEqual(layout.themed.filter(source => (/(?:-dark(?:-2x)?\.webp|\/arca-icon-ivory\.svg|\/automagik-lockup-oi-cream\.svg|\/automagik-lockup-three-colours-cream-header\.svg)$/.test(source) || rowDark.some(file => source.endsWith(file))) !== (colorScheme === 'dark')), [], `App pictures follow the theme: ${label}`)
      if (route === '/') {
        assert.ok(layout.themed.length >= 4, `The home's app pictures have dark captures: ${label}`)
        assert.ok(layout.bubble.bottom <= layout.heroWindow.top && layout.bubble.left >= 0 && layout.bubble.right <= width, `The speech bubble stays off the app window: ${label} ${JSON.stringify([layout.bubble, layout.heroWindow])}`)
        const real = width > 700 ? 1100 : 390
        assert.ok(layout.heroWindow.width >= real * 0.7, `The hero shows the app near its real size: ${label} ${layout.heroWindow.width}px of ${real}px`)
      }
      if (layout.film) assert.ok(layout.film < layout.largest, `The film still must not be the biggest picture: ${label} ${layout.film} vs ${layout.largest}`)
      assert.ok(focus.skip && focus.outline !== 'none' && nextFocus !== 'none', `Keyboard focus is visible: ${label}`)
      for (const bounds of headingBounds) {
        assert.ok([bounds.heading, ...bounds.text].every(box => box.left >= bounds.content.left - 0.5 && box.right <= bounds.content.right + 0.5), `Heading stays inside card padding: ${label} ${JSON.stringify(bounds)}`)
      }
      assert.equal(report.scroll, report.viewport, `Horizontal overflow: ${label}`)
      // The homepage's brand accent hides on narrow screens by design; shown product images
      // still must decode, and every image request must return 200.
      assert.ok(report.images.every(image => image.ok), `Every image decodes: ${label}`)
      assert.ok(report.fonts, `Both bundled fonts loaded: ${label}`)
      assert.equal(report.robots, undefined, `No robots meta, the page is indexable: ${label}`); assert.equal(report.h1, 1)
      // Reduced motion: nothing runs, nothing is held back from view, and nothing shifts.
      assert.ok(report.reducedMotion)
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0, `Reduced motion runs no animation: ${label}`)
      assert.equal(await page.evaluate(() => window.__shift), 0, `No layout shift: ${label}`)
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
      reports.push({ route, colorScheme, width, ...report, headingBounds, responses, screenshot })
      console.log(`PASS ${label}: no overflow; images and fonts loaded; local requests`)
    } finally { await context.close() }
  }
  // The menus, with real clicks and keys. No script runs on the page: the browser's popover
  // opens and closes each panel, keeps the button's expanded state and returns the focus.
  const panelState = (page, id) => page.evaluate(id => {
    const panel = document.getElementById(id), box = panel.getBoundingClientRect(), active = document.activeElement
    return {
      open: panel.matches(':popover-open'), shown: getComputedStyle(panel).display !== 'none' && box.height > 0, box: box.toJSON(),
      focusButton: active?.getAttribute('popovertarget') ?? null, focusInside: panel.contains(active), focusHref: active?.getAttribute('href') ?? null,
      overflow: document.documentElement.scrollWidth - innerWidth,
    }
  }, id)
  // What assistive technology is told: the button's expanded state in the accessibility tree.
  const expanded = async (cdp, name) => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const button = nodes.find(node => node.role?.value === 'button' && (node.name?.value ?? '').startsWith(name))
    return button?.properties?.find(property => property.name === 'expanded')?.value.value
  }
  const linkCheck = async page => {
    const links = await page.evaluate(() => [...document.querySelectorAll('.menu-panel a, .drawer a, .site-footer a, .crumbs a, .pager a')].map(link => link.getAttribute('href')))
    assert.ok(links.length >= 40, 'menus, phone menu and footer carry their links')
    for (const href of new Set(links)) {
      const url = new URL(href, origin)
      if (url.origin !== origin) { assert.equal(url.protocol, 'https:', href); continue }
      const response = await fetch(url)
      assert.equal(response.status, 200, `menu link answers 200: ${href}`)
      if (url.hash) assert.ok((await response.text()).includes(`id="${url.hash.slice(1)}"`), `menu link target exists: ${href}`)
    }
  }
  for (const colorScheme of ['light', 'dark']) for (const route of ['/', '/genie/', '/arca/']) {
    const label = `${route} ${colorScheme}`, slug = route === '/' ? 'home' : route.split('/')[1]
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
    try {
      const outside = await guard(desk), page = await desk.newPage(), cdp = await desk.newCDPSession(page)
      await page.goto(origin + route, { waitUntil: 'load' })
      const button = id => page.locator(`[popovertarget="menu-${id}"]`)
      for (const name of ['Products', 'Resources', 'Company']) assert.equal(await expanded(cdp, name), false, `${name} starts collapsed: ${label}`)
      // Click opens and closes; the panel sits under the header, inside the page's width.
      await button('products').click()
      let state = await panelState(page, 'menu-products')
      const header = await page.locator('.top').boundingBox()
      assert.ok(state.open && state.shown, `Click opens Products: ${label}`)
      assert.equal(await expanded(cdp, 'Products'), true, `Products is announced expanded: ${label}`)
      assert.ok(state.box.left >= 0 && state.box.right <= 1440 && Math.abs(state.box.top - (header.y + header.height)) <= 2 && state.overflow === 0, `Products panel sits under the header: ${label} ${JSON.stringify(state.box)}`)
      assert.equal(await page.locator('#menu-products .menu-item').count(), 7)
      await page.screenshot({ path: join(evidence, `menu-products-${slug}-${colorScheme}.png`) })
      await button('products').click()
      assert.ok(!(await panelState(page, 'menu-products')).open && await expanded(cdp, 'Products') === false, `A second click closes Products: ${label}`)
      // Keyboard: Enter and Space open, Tab goes into the panel, Escape closes and the focus
      // returns to the button.
      for (const key of ['Enter', 'Space']) {
        await button('resources').focus(); await page.keyboard.press(key)
        assert.ok((await panelState(page, 'menu-resources')).open, `${key} opens Resources: ${label}`)
        await page.keyboard.press('Tab')
        state = await panelState(page, 'menu-resources')
        assert.ok(state.focusInside && state.focusHref, `Tab moves into the open panel: ${label}`)
        assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', `Menu links show keyboard focus: ${label}`)
        await page.keyboard.press('Escape')
        state = await panelState(page, 'menu-resources')
        assert.ok(!state.open && !state.shown && state.focusButton === 'menu-resources', `Escape closes Resources and returns focus: ${label} ${JSON.stringify(state)}`)
      }
      // One panel at a time, and a click outside closes it.
      await button('products').click(); await button('company').click()
      assert.ok(!(await panelState(page, 'menu-products')).open && (await panelState(page, 'menu-company')).open, `Opening Company closes Products: ${label}`)
      await page.screenshot({ path: join(evidence, `menu-company-${slug}-${colorScheme}.png`) })
      await page.mouse.click(720, 760)
      assert.ok(!(await panelState(page, 'menu-company')).shown, `A click outside closes the panel: ${label}`)
      // Hover opens the same panel in the same place, and it stays while the pointer is in it.
      await page.mouse.move(720, 760); await button('resources').hover()
      state = await panelState(page, 'menu-resources')
      assert.ok(state.shown && !state.open, `Hover shows Resources: ${label}`)
      const hovered = state.box
      await page.locator('#menu-resources .menu-item').last().hover()
      assert.ok((await panelState(page, 'menu-resources')).shown, `The panel stays while the pointer is in it: ${label}`)
      await button('resources').click()
      state = await panelState(page, 'menu-resources')
      assert.ok(state.open && Math.abs(state.box.top - hovered.top) < 1 && Math.abs(state.box.left - hovered.left) < 1, `Hover and click show the panel in one place: ${label}`)
      await page.keyboard.press('Escape'); await page.mouse.move(720, 760)
      assert.ok(!(await panelState(page, 'menu-resources')).shown, `The panel goes when the pointer leaves: ${label}`)
      // The active page in the header, and a menu link that takes you there.
      const here = await page.evaluate(() => ({ button: document.querySelector('.menu-button[data-here] .menu-here')?.lastChild.textContent ?? null, current: document.querySelector('#menu-products [aria-current="page"]')?.getAttribute('href') ?? null, crumb: document.querySelector('.crumbs [aria-current="page"]')?.textContent ?? null }))
      if (route === '/') assert.deepEqual(here, { button: null, current: null, crumb: null })
      else assert.ok(here.button && here.button === here.crumb && here.current === route, `The header shows the active page: ${label} ${JSON.stringify(here)}`)
      await linkCheck(page)
      if (route === '/arca/') {
        // Get Arca is the install command as text: one click selects the whole line, and
        // nothing on the page links to the installer or to Arca's repository.
        const get = await page.evaluate(() => { const code = document.querySelector('.install-line code'); return { text: code.textContent, select: getComputedStyle(code).userSelect, links: [...document.links].map(link => link.href).filter(href => /get\.automagik\.si|automagik-si\/arca/.test(href)) } })
        assert.deepEqual(get, { text: 'curl -fsSL https://get.automagik.si/arca | sh', select: 'all', links: [] }, `The install line is text to copy: ${label}`)
      }
      await button('products').click(); await page.locator('#menu-products .menu-item[href="/omni/"]').click()
      await page.waitForURL(origin + '/omni/')
      assert.equal(await page.locator('.menu-button[data-here] .menu-here').evaluate(node => node.lastChild.textContent), 'Omni')
      assert.deepEqual(outside, [], `No external request from the menus: ${label}`)
    } finally { await desk.close() }
    // The phone menu: one sheet under the header with the same groups.
    for (const width of [390, 320]) {
      const phone = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
      try {
        const page = await phone.newPage(), cdp = await phone.newCDPSession(page)
        await page.goto(origin + route, { waitUntil: 'load' })
        const menu = page.locator('.menu-open')
        assert.ok(await menu.isVisible() && !(await page.locator('.main-nav').isVisible()), `The phone header shows one Menu button: ${label} ${width}px`)
        assert.equal(await expanded(cdp, 'Menu'), false)
        await menu.click()
        let state = await panelState(page, 'site-menu')
        const header = await page.locator('.top').boundingBox()
        const behind = () => page.evaluate(() => ({ main: getComputedStyle(document.querySelector('main')).visibility, footer: getComputedStyle(document.querySelector('.site-footer')).visibility, scroll: getComputedStyle(document.documentElement).overflowY }))
        assert.ok(state.open && state.shown && state.overflow === 0, `Menu opens the sheet: ${label} ${width}px`)
        assert.equal(await expanded(cdp, 'Menu'), true, `Menu is announced expanded: ${label} ${width}px`)
        assert.ok(state.box.left === 0 && state.box.width === width && Math.abs(state.box.top - (header.y + header.height)) <= 1 && Math.abs(state.box.bottom - 844) <= 1, `The sheet fills the screen under the header: ${label} ${width}px ${JSON.stringify(state.box)}`)
        assert.deepEqual(await behind(), { main: 'hidden', footer: 'hidden', scroll: 'hidden' }, `The page behind the sheet is out of reach: ${label} ${width}px`)
        assert.deepEqual(await page.locator('#site-menu .drawer-label').allInnerTexts().then(labels => labels.map(text => text.toLowerCase())), ['products', 'resources', 'company'])
        assert.equal(await page.locator('#site-menu .menu-item').count(), 13)
        if (route !== '/') assert.equal(await page.locator('#site-menu [aria-current="page"]').getAttribute('href'), route, `The sheet marks the active page: ${label}`)
        if (width === 390) await page.screenshot({ path: join(evidence, `menu-phone-${slug}-${colorScheme}.png`) })
        // The keyboard stays in the header and the sheet, and reaches every link of the sheet.
        const stops = new Set()
        for (let press = 0; press < 40; press++) {
          await page.keyboard.press('Tab')
          stops.add(await page.evaluate(() => { const active = document.activeElement; return active === document.body ? 'page' : active.closest('#site-menu') ? `sheet:${active.getAttribute('href')}` : active.closest('.top') ? 'header' : `behind:${active.outerHTML.slice(0, 60)}` }))
        }
        assert.deepEqual([...stops].filter(stop => stop.startsWith('behind:')), [], `Tab never lands behind the sheet: ${label} ${width}px`)
        assert.equal([...stops].filter(stop => stop.startsWith('sheet:')).length, 12, `Tab reaches every link of the sheet: ${label} ${width}px`)
        await page.keyboard.press('Escape')
        state = await panelState(page, 'site-menu')
        assert.ok(!state.open && state.focusButton === 'site-menu', `Escape closes the sheet and returns focus to Menu: ${label} ${width}px`)
        assert.deepEqual(await behind(), { main: 'visible', footer: 'visible', scroll: 'visible' })
        // Menu toggles the sheet, and a link in it goes to its page.
        await menu.click(); await menu.click()
        assert.ok(!(await panelState(page, 'site-menu')).open, `Menu closes the sheet again: ${label} ${width}px`)
        await menu.click(); await page.locator('#site-menu .menu-item[href="/mobile/"]').click()
        await page.waitForURL(origin + '/mobile/')
        assert.ok(!(await panelState(page, 'site-menu')).open)
        assert.equal(await page.locator('.crumbs [aria-current="page"]').innerText(), 'Mobile')
      } finally { await phone.close() }
    }
    console.log(`PASS menus ${label}: click, keyboard, Escape and focus return, hover, one panel at a time, active page, links, phone sheet`)
  }
  // The logo in the header and the footer: the kit's lockup for small sizes, the triskle in
  // colour with ink letters on the light page and cream ones on the dark page (read from the
  // name's drawn colour, not only from the file's name), drawn at its own proportions. The triskle (222 of the file's 264 in height) keeps the size and the
  // centred place it had, nothing in the header is pushed aside, and the browser's icons
  // load from the site.
  for (const colorScheme of ['light', 'dark']) for (const [width, header, footer] of [[1440, 32, 40], [1024, 32, 40], [390, 26, 34], [320, 23, 34]]) {
    const label = `${colorScheme} ${width}px`
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
    try {
      const outside = await guard(context)
      const page = await context.newPage()
      await page.goto(origin + '/', { waitUntil: 'load' })
      await page.evaluate(() => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode() })).then(() => document.fonts.ready))
      const logo = await page.evaluate(async () => {
        // The colour the name is drawn in: the commonest solid pixel to the right of the triskle.
        const word = image => {
          const canvas = document.createElement('canvas'); canvas.width = 816; canvas.height = 132
          const pen = canvas.getContext('2d'); pen.drawImage(image, 0, 0, canvas.width, canvas.height)
          const from = Math.ceil(canvas.width * 300 / 1632.34), pixels = pen.getImageData(from, 0, canvas.width - from, canvas.height).data, seen = new Map()
          for (let at = 0; at < pixels.length; at += 4) if (pixels[at + 3] === 255) { const colour = `${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`; seen.set(colour, (seen.get(colour) || 0) + 1) }
          return [...seen].sort((one, other) => other[1] - one[1])[0]?.[0].split(',').map(Number) ?? null
        }
        // The ground the logo stands on: every background from the page down to the logo's own
        // link, painted one over the other (a see-through one lets the one under it show).
        const ground = image => {
          const layers = []; for (let node = image.parentElement; node; node = node.parentElement) layers.unshift(getComputedStyle(node).backgroundColor)
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
          const pen = canvas.getContext('2d'); pen.fillStyle = '#fff'; pen.fillRect(0, 0, 1, 1)
          for (const layer of layers) { pen.fillStyle = layer; pen.fillRect(0, 0, 1, 1) }
          return [...pen.getImageData(0, 0, 1, 1).data.slice(0, 3)]
        }
        const place = scope => {
          const link = document.querySelector(`${scope} .brand`), image = link.querySelector('img'), box = image.getBoundingClientRect(), frame = link.getBoundingClientRect()
          return {
            size: [box.width, box.height], top: box.top, hang: box.bottom - frame.bottom, right: box.right, file: image.currentSrc.split('/').pop(), drawn: image.naturalWidth > 0, word: word(image), ground: ground(image),
            effects: [link, image].map(node => { const style = getComputedStyle(node); return [style.filter, style.opacity, style.transform, style.mixBlendMode].join(' ') }),
          }
        }
        const row = document.querySelector('.top-inner').getBoundingClientRect()
        const shown = [...document.querySelectorAll('.top-inner > *')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect()).sort((one, other) => one.left - other.left)
        const tabs = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map(link => new URL(link.href).pathname)
        return {
          top: place('.top'), foot: place('.footer-brand'), rowMiddle: row.top + row.height / 2, tabs,
          apart: shown.every((box, index) => index === 0 || box.left >= shown[index - 1].right), inside: shown.at(-1).right <= innerWidth && shown[0].left >= 0,
          column: document.querySelector('.footer-brand').getBoundingClientRect().right, over: document.documentElement.scrollWidth - innerWidth,
        }
      })
      for (const [name, spot, mark] of [['header', logo.top, header], ['footer', logo.foot, footer]]) {
        const unit = mark / 222, near = (value, wanted) => Math.abs(value - wanted) <= 0.6
        assert.equal(spot.file, `automagik-lockup-three-colours-${colorScheme === 'dark' ? 'cream' : 'ink'}-header.svg`, `The logo's file follows the theme: ${name} ${label}`)
        // The file's name is not enough: the name must be drawn dark on a light ground and light on a
        // dark one, measured against the ground the logo itself stands on (the header's, the footer's).
        const light = colour => colour.map(value => value / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
        const against = spot.word && (Math.max(light(spot.word), light(spot.ground)) + 0.05) / (Math.min(light(spot.word), light(spot.ground)) + 0.05)
        assert.ok(against >= 7, `The name is drawn in the theme's colour, clear against its own ground: ${name} ${label} ${JSON.stringify([spot.word, spot.ground, against])}`)
        assert.ok(spot.drawn && near(spot.size[1], 264 * unit) && near(spot.size[0], 1632.34 * unit), `The logo's size, unstretched: ${name} ${label} ${spot.size}`)
        assert.ok(near(spot.hang, name === 'header' ? 42 * unit : 0), `The g's tail hangs under the header's link and inside the footer's: ${name} ${label} ${spot.hang}`)
        assert.deepEqual([...new Set(spot.effects)], ['none 1 none normal'], `Nothing is drawn over the logo: ${name} ${label}`)
      }
      assert.ok(Math.abs(logo.top.top + header / 2 - logo.rowMiddle) <= 0.6, `The triskle stays centred in the header: ${label} ${[logo.top.top, logo.rowMiddle]}`)
      assert.ok(logo.apart && logo.inside && logo.over <= 0, `The wider logo pushes nothing aside: ${label} ${JSON.stringify([logo.apart, logo.inside, logo.over])}`)
      assert.ok(logo.foot.right <= logo.column, `The footer's logo stays in its column: ${label} ${[logo.foot.right, logo.column]}`)
      // The page's own policy allows no fetch from script, so the icons are asked for from here.
      const tabs = []
      for (const path of logo.tabs) { const answer = await context.request.get(origin + path); tabs.push([path, answer.status(), (await answer.body()).length > 0]) }
      assert.deepEqual(tabs, [['/favicon.ico', 200, true], ['/favicon.svg', 200, true], ['/apple-touch-icon.png', 200, true], ['/site.webmanifest', 200, true]], `The browser's icons load: ${label}`)
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
      const ring = await page.evaluate(() => { const link = document.activeElement, style = getComputedStyle(link), box = link.getBoundingClientRect(), word = link.querySelector('img')?.getBoundingClientRect(); return { link: link.className, clears: word && box.bottom + parseFloat(style.outlineOffset) >= word.bottom, style: style.outlineStyle } })
      assert.deepEqual(ring, { link: 'brand', clears: true, style: 'solid' }, `The focus ring goes round the whole logo: ${label} ${JSON.stringify(ring)}`)
      assert.deepEqual(outside, [], `No outside request: ${label}`)
      console.log(`PASS logo ${label}: the kit's file for the theme, its name drawn in the theme's colour, at its own proportions, header and footer in place, icons load`)
    } finally { await context.close() }
  }
  // The triskle alone is the kit's drawing for the size shown, drawn and square: the 32 px
  // drawing in the Products menu's Mykes entry, the large one in the Cloud and Mykes heroes.
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
    try {
      const outside = await guard(context)
      const page = await context.newPage()
      const seen = async selector => page.evaluate(async selector => {
        const image = [...document.querySelectorAll(selector)].find(node => node.getClientRects().length)
        if (!image) return null
        await image.decode()
        const box = image.getBoundingClientRect()
        return [image.currentSrc.split('/').pop(), image.naturalWidth > 0, Math.round(box.width), Math.round(box.height)]
      }, selector)
      await page.goto(origin + '/', { waitUntil: 'load' })
      await page.locator('[popovertarget="menu-products"]').click()
      assert.deepEqual(await seen('.menu-item[href="/mykes/"] .menu-art'), ['triskle-three-colours-32.svg', true, 32, 32], `The Mykes entry's mark: ${colorScheme}`)
      for (const [route, selector, size] of [['/cloud/', '.hero-mark', 300], ['/mykes/', '.coming-mark', 120]]) {
        await page.goto(origin + route, { waitUntil: 'load' })
        assert.deepEqual(await seen(selector), ['triskle-three-colours.svg', true, size, size], `The hero's mark: ${route} ${colorScheme}`)
      }
      assert.deepEqual(outside, [], `No outside request: marks ${colorScheme}`)
      console.log(`PASS marks ${colorScheme}: the kit's triskle for the size shown, in the menu and the two heroes`)
    } finally { await context.close() }
  }
  // The download hook, with real clicks and keys. A live platform opens its sheet: in the
  // middle of a wide window, rising from the bottom edge of a phone. A platform that is
  // coming later is a label: no click, no focus, no file.
  const sheetBehind = page => page.evaluate(() => ({ scroll: getComputedStyle(document.documentElement).overflowY, inert: [...document.querySelectorAll('.top, main, .site-footer')].map(part => getComputedStyle(part).interactivity) }))
  for (const colorScheme of ['light', 'dark']) for (const [route, ids] of Object.entries(offered)) for (const [width, height] of [[1440, 900], [390, 844], [320, 700]]) {
    const label = `${route} ${colorScheme} ${width}px`, slug = route === '/' ? 'home' : route.split('/')[1]
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme, reducedMotion: 'reduce' })
    try {
      const outside = await guard(context)
      await watchShift(context)
      const page = await context.newPage(), cdp = await context.newCDPSession(page)
      await page.goto(origin + route, { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      const chips = await page.evaluate(() => [...document.querySelectorAll('.get-row > li')].map(item => {
        const chip = item.matches('.get-chip') ? item : item.querySelector('button.get-chip'), fallback = item.querySelector('.get-fallback')
        const box = chip.getBoundingClientRect(), top = selector => Math.round(chip.querySelector(selector).getBoundingClientRect().top)
        return { name: chip.querySelector('.get-name').textContent, target: chip.getAttribute('popovertarget'), controls: item.querySelectorAll('a, button').length, left: box.left, right: box.right, top: Math.round(box.top), width: box.width, height: Math.round(box.height), sign: top('.platform-sign'), word: top('.get-name'), kind: chip.querySelector('.get-kind').textContent, fallback: fallback && getComputedStyle(fallback).display }
      }))
      assert.deepEqual(chips.map(chip => [chip.name, chip.target, chip.controls, chip.kind === 'Soon']), ids.map(id => platforms[id].soon ? [platforms[id].name, null, 0, true] : [platforms[id].name, `get-${id}`, 2, false]), `The tray offers its platforms in order, and the ones coming later are not controls: ${label}`)
      for (const chip of chips) {
        assert.ok(chip.left >= 0 && chip.right <= width && chip.width >= 44 && chip.height >= 44, `Each platform is a full tap target inside the screen: ${label} ${JSON.stringify(chip)}`)
        assert.deepEqual([chip.top, chip.height, chip.sign, chip.word], [chips[0].top, chips[0].height, chips[0].sign, chips[0].word], `Live and coming platforms line up: ${label} ${chip.name}`)
        if (chip.target) assert.equal(chip.fallback, 'none', `The plain link is only for a browser without popovers: ${label}`)
      }
      // The keyboard stops on the live platforms, in order, and on nothing else in the tray
      // (a short page comes round to them again; each stop counts once).
      const stops = []
      for (let press = 0; press < 40; press++) {
        await page.keyboard.press('Tab')
        const stop = await page.evaluate(() => document.activeElement.closest('.get-row') ? document.activeElement.getAttribute('popovertarget') ?? document.activeElement.outerHTML.slice(0, 60) : null)
        if (stop && !stops.includes(stop)) stops.push(stop)
      }
      assert.deepEqual(stops, chips.filter(chip => chip.target).map(chip => chip.target), `Tab reaches the live platforms only: ${label}`)
      await page.locator('.get-chip.soon').first().click()
      assert.equal(await page.locator(':popover-open').count(), 0, `A platform that is coming later opens nothing: ${label}`)
      for (const id of ids.filter(id => !platforms[id].soon)) {
        const platform = platforms[id], button = page.locator(`.get-row [popovertarget="get-${id}"]`), sheet = page.locator(`#get-${id}`), about = `${label} ${id}`
        assert.equal(await expanded(cdp, `${platform.name}: `), false, `The platform starts collapsed: ${about}`)
        await button.click()
        let state = await panelState(page, `get-${id}`)
        assert.ok(state.open && state.shown && state.overflow === 0, `A click opens the sheet: ${about}`)
        // The page behind an open sheet is inert, the platform's button with it: it is not announced at all.
        assert.equal(await expanded(cdp, `${platform.name}: `), undefined, `The platform is out of reach behind its sheet: ${about}`)
        assert.ok(state.box.left >= 0 && state.box.right <= width && state.box.top >= 0 && state.box.bottom <= height, `The sheet is inside the screen: ${about} ${JSON.stringify(state.box)}`)
        if (width > 700) assert.ok(Math.abs(state.box.left + state.box.width / 2 - width / 2) <= 1 && Math.abs(state.box.top + state.box.height / 2 - height / 2) <= 1, `The sheet sits in the middle of the window: ${about} ${JSON.stringify(state.box)}`)
        else assert.ok(state.box.left === 0 && state.box.width === width && Math.abs(state.box.bottom - height) <= 1, `The sheet rises from the bottom edge: ${about} ${JSON.stringify(state.box)}`)
        assert.ok(state.focusInside, `The focus moves into the sheet: ${about}`)
        assert.equal(await sheet.getAttribute('role'), 'dialog')
        assert.equal(await page.evaluate(id => document.getElementById(document.getElementById(id).getAttribute('aria-labelledby')).textContent, `get-${id}`), `For ${platform.name}`)
        assert.deepEqual(await sheetBehind(page), { scroll: width > 700 ? 'visible' : 'hidden', inert: ['inert', 'inert', 'inert'] }, `The page behind the sheet is out of reach: ${about}`)
        // What the sheet says: the exact file, how to install it, the download, one guide.
        assert.equal(await sheet.locator('.sheet-facts code').first().innerText(), platform.file, `The sheet names the file: ${about}`)
        assert.ok(await sheet.locator('.steps > li').count() >= 2, `The sheet says how to install: ${about}`)
        const download = sheet.locator('a.button.primary')
        assert.equal(await download.getAttribute('href'), platform.download[1], `The button fetches that file: ${about}`)
        assert.equal(await sheet.locator('.detail-link').count(), 1)
        // Every part of the sheet can be brought onto the screen, on the smallest phone too.
        for (const part of [download, sheet.locator('.detail-link'), sheet.locator('.sheet-close')]) {
          await part.scrollIntoViewIfNeeded()
          const box = await part.boundingBox()
          assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height && box.height >= 44, `The sheet's controls are reachable, full tap targets: ${about} ${JSON.stringify(box)}`)
        }
        assert.equal(await sheet.evaluate(node => node.scrollWidth - node.clientWidth), 0, `Nothing in the sheet is wider than it: ${about}`)
        if (width !== 320) await page.screenshot({ path: join(evidence, `hook-${slug}-${id}-${colorScheme}-${width}.png`) })
        // The keyboard stays in the sheet and reaches its close button, download and guide.
        const inside = new Set()
        for (let press = 0; press < 12; press++) {
          await page.keyboard.press('Tab')
          inside.add(await page.evaluate(id => { const active = document.activeElement; return active === document.body ? 'page' : active.closest(`#${id}`) ? `sheet:${active.getAttribute('href') ?? active.className}` : `behind:${active.outerHTML.slice(0, 60)}` }, `get-${id}`))
        }
        assert.deepEqual([...inside].filter(stop => stop.startsWith('behind:')), [], `Tab never lands behind the sheet: ${about}`)
        for (const stop of ['sheet:sheet-close', `sheet:${platform.download[1]}`]) assert.ok(inside.has(stop), `Tab reaches ${stop}: ${about} ${[...inside]}`)
        // Escape, from anywhere in the sheet, closes it and the focus goes back to the platform.
        await sheet.locator('.sheet-close').focus()
        await page.keyboard.press('Escape')
        state = await panelState(page, `get-${id}`)
        assert.ok(!state.open && !state.shown && state.focusButton === `get-${id}`, `Escape closes the sheet and returns the focus: ${about} ${JSON.stringify(state)}`)
        assert.equal(await expanded(cdp, `${platform.name}: `), false)
        assert.deepEqual(await sheetBehind(page), { scroll: 'visible', inert: ['auto', 'auto', 'auto'] }, `The page is back in reach: ${about}`)
        // Enter opens it from the keyboard; its own button and a click beside it close it.
        await page.keyboard.press('Enter')
        assert.ok((await panelState(page, `get-${id}`)).open, `Enter opens the sheet: ${about}`)
        await sheet.locator('.sheet-close').click()
        state = await panelState(page, `get-${id}`)
        assert.ok(!state.open && state.focusButton === `get-${id}`, `The close button closes the sheet and returns the focus: ${about}`)
        await button.click(); await page.mouse.click(6, 6)
        assert.ok(!(await panelState(page, `get-${id}`)).shown, `A click beside the sheet closes it: ${about}`)
      }
      assert.equal(await page.evaluate(() => window.__shift), 0, `The sheets never shift the page: ${label}`)
      assert.deepEqual(outside, [], `No external request from the download hook: ${label}`)
    } finally { await context.close() }
    console.log(`PASS download hook ${label}: order, alignment, tap targets, soon is a label, sheet in place, file and download, keyboard, Escape, focus return`)
  }
  // For a visitor who allows motion the sheet eases in (opacity and a short rise) and ends
  // fully shown, in place; with reduced motion it simply appears.
  for (const reducedMotion of ['no-preference', 'reduce']) for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion })
    try {
      const page = await context.newPage()
      await page.goto(origin + '/', { waitUntil: 'load' })
      const eased = await page.evaluate(async () => {
        const sheet = document.getElementById('get-mac')
        document.querySelector('[popovertarget="get-mac"]').click()
        await new Promise(done => requestAnimationFrame(done))
        const running = sheet.getAnimations(), moved = running.map(animation => animation.transitionProperty).sort()
        await Promise.all(running.map(animation => animation.finished))
        const style = getComputedStyle(sheet)
        return { open: sheet.matches(':popover-open'), moved, opacity: style.opacity, translate: style.translate }
      })
      assert.deepEqual(eased, { open: true, moved: reducedMotion === 'reduce' ? [] : ['opacity', 'translate'], opacity: '1', translate: 'none' }, `The sheet's entrance: ${reducedMotion} ${width}px ${JSON.stringify(eased)}`)
    } finally { await context.close() }
  }
  console.log('PASS download hook motion: the sheet eases in for visitors who allow motion, appears at once otherwise, and ends in place')
  // The projects row. Every mark is the project's own file at its own proportions, the dark
  // file on a dark page. For a visitor who allows motion it is one line that drifts (slower on
  // a phone, where every name is whole on screen as it passes), stops under the pointer and
  // turns into the still list for the keyboard; with reduced motion it is the still, wrapped
  // list. The copy that fills the gap is never reached.
  const drift = {}
  for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [390, 844]]) for (const reducedMotion of ['no-preference', 'reduce']) {
    const label = `${width}px ${colorScheme} ${reducedMotion}`
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme, reducedMotion })
    try {
      const outside = await guard(context), page = await context.newPage()
      await page.goto(origin + '/', { waitUntil: 'load' })
      await page.locator('.we-use').scrollIntoViewIfNeeded()
      await page.evaluate(() => Promise.all([...document.querySelectorAll('.we-use-list:not(.we-use-copy) img')].map(image => { image.loading = 'eager'; return image.decode().catch(() => {}) })))
      const row = () => page.evaluate(() => {
        const track = document.querySelector('.we-use-track'), [list, copy] = track.querySelectorAll('.we-use-list'), style = getComputedStyle(list)
        const edge = parseFloat(getComputedStyle(track).getPropertyValue('--edge')) || 0
        return {
          items: [...list.children].map(item => { const box = item.getBoundingClientRect(), image = item.querySelector('img'), drawn = image.getBoundingClientRect(); return { left: box.left, right: box.right, middle: Math.round(box.top + box.height / 2), width: box.width, file: new URL(image.currentSrc).pathname, loaded: image.naturalWidth > 0, ratio: image.naturalWidth / image.naturalHeight, drawn: [drawn.width, drawn.height], link: item.querySelector('a').getBoundingClientRect().height } }),
          wraps: style.flexWrap, copy: getComputedStyle(copy).display, running: list.getAnimations().map(animation => [animation.animationName, animation.playState]),
          lap: parseFloat(style.animationDuration), length: list.getBoundingClientRect().width, clear: track.clientWidth * (1 - 2 * edge / 100), overflow: document.documentElement.scrollWidth - innerWidth,
        }
      })
      let state = await row()
      assert.equal(state.overflow, 0, `The row never widens the page: ${label}`)
      used.forEach(({ name, mark: [light, dark, markWidth, markHeight], shown }, index) => {
        const item = state.items[index]
        assert.ok(item.loaded && item.file === `/assets/brand/used/${colorScheme === 'dark' && dark ? dark : light}`, `${name} shows its own file for the theme: ${label} ${item.file}`)
        assert.ok(Math.abs(item.drawn[1] - shown) < 0.5 && Math.abs(item.drawn[0] / item.drawn[1] - markWidth / markHeight) < 0.03 && Math.abs(item.ratio - markWidth / markHeight) < 0.03, `${name} is drawn at its own proportions: ${label} ${JSON.stringify(item.drawn)}`)
        assert.ok(item.link >= 44, `${name} is a 44px target: ${label}`)
      })
      if (reducedMotion === 'reduce') {
        assert.deepEqual([state.wraps, state.copy, state.running], ['wrap', 'none', []], `Reduced motion: the still, wrapped list: ${label}`)
        for (const item of state.items) assert.ok(item.left >= 0 && item.right <= width, `Every item is on screen: ${label}`)
      } else {
        assert.deepEqual([state.wraps, state.copy, state.running], ['nowrap', 'flex', [['we-use-drift', 'running']]], `The row is one drifting line: ${label} ${JSON.stringify(state.running)}`)
        assert.equal(new Set(state.items.map(item => item.middle)).size, 1, `Every item sits on one centre line: ${label}`)
        // Slow enough to read: the widest item fits whole between the faded edges, with time to spare.
        const speed = state.length / state.lap, widest = Math.max(...state.items.map(item => item.width))
        drift[width] = speed
        assert.ok(widest < state.clear && (state.clear - widest) / speed >= 4, `Each name is whole on screen for seconds as it passes: ${label} ${speed.toFixed(1)}px/s`)
        if (width === 1440) {
          const band = await page.locator('.we-use-track').boundingBox()
          await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2)
          assert.deepEqual((await row()).running, [['we-use-drift', 'paused']], `The row stops under the pointer: ${label}`)
          await page.mouse.move(0, 0)
        }
      }
      await page.screenshot({ path: join(evidence, `we-use-${width}-${colorScheme}-${reducedMotion === 'reduce' ? 'still' : 'drifting'}.png`) })
      // The keyboard reaches the eleven links once, in order, and the row holds still while it is in it.
      await page.locator('.we-use-title').evaluate(node => { node.tabIndex = -1; node.focus() })
      const reached = []
      for (const { href } of used) {
        await page.keyboard.press('Tab')
        reached.push(await page.evaluate(() => { const active = document.activeElement, box = active.getBoundingClientRect(); return [active.getAttribute('href'), Boolean(active.closest('.we-use-copy')), box.left >= 0 && box.right <= innerWidth] }))
      }
      assert.deepEqual(reached, used.map(({ href }) => [href, false, true]), `Tab walks the row once, each link on screen: ${label}`)
      state = await row()
      assert.deepEqual([state.wraps, state.copy, state.running], ['wrap', 'none', []], `With the keyboard in it the row is the still list: ${label}`)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.we-use'))), false, `The copy is never reached: ${label}`)
      assert.deepEqual(outside, [], `The row asks nothing of another site: ${label}`)
    } finally { await context.close() }
  }
  assert.ok(drift[390] < drift[1440] && drift[390] <= 16, `The phone drift is the slower one: ${JSON.stringify(drift)}`)
  console.log('PASS projects row: own files per theme at their proportions, one drifting line that stops for pointer and keyboard, readable phone drift, still wrapped list with reduced motion, copy out of reach, no outside request')
  // Motion, for a visitor who allows it. Every page is scrolled from top to bottom at desktop
  // and phone width: something moves, nothing shifts the layout (the browser's own layout-shift
  // score stays 0), nothing overflows, and everything that rises into view ends fully shown,
  // down to the last section. Then a link is followed: the page-to-page transition runs to
  // its end, and the menu eases in.
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' })
    try {
      const outside = await guard(context)
      await watchShift(context)
      await context.addInitScript(() => addEventListener('pagereveal', event => {
        window.__arrived = event.viewTransition ? 'running' : 'plain'
        event.viewTransition?.finished.then(() => { window.__arrived = 'finished' }, () => { window.__arrived = 'skipped' })
      }))
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      for (const route of routes) {
        const label = `${route} ${width}px`
        await page.goto(origin + route, { waitUntil: 'load' })
        await page.evaluate(() => Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode() })).then(() => document.fonts.ready))
        const seen = { held: 0, driven: 0, timed: 0 }
        for (let top = 0, last = false; !last; top += 160) {
          const step = await page.evaluate(async top => {
            scrollTo({ top, behavior: 'instant' })
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
            const animations = document.getAnimations(), driven = animations.filter(animation => animation.timeline instanceof ScrollTimeline)
            const rising = driven.filter(animation => ['rise', 'press'].includes(animation.animationName))
            const end = scrollY + innerHeight >= document.documentElement.scrollHeight - 1
            // Held back: the rise has not finished, so the element is still dim or low.
            const held = animation => (animation.effect.getComputedTiming().progress ?? 1) < 1
            const name = ({ effect: { target } }) => `${target.tagName.toLowerCase()}.${target.className}`.slice(0, 60)
            return {
              end, driven: driven.length, timed: animations.length - driven.length, held: rising.filter(held).length,
              // Well inside the screen, or anywhere on it at the page's end: fully shown.
              stuck: rising.filter(animation => held(animation) && animation.effect.target.getBoundingClientRect().top < innerHeight - (end ? 0 : 520)).map(name),
              overflow: document.documentElement.scrollWidth - innerWidth,
            }
          }, top)
          assert.deepEqual(step.stuck, [], `Everything that rises into view ends fully shown: ${label} at ${top}px`)
          assert.equal(step.overflow, 0, `Motion never widens the page: ${label} at ${top}px`)
          seen.held = Math.max(seen.held, step.held); seen.driven = Math.max(seen.driven, step.driven); seen.timed = Math.max(seen.timed, step.timed)
          last = step.end
        }
        assert.ok(seen.driven > 0 && seen.held > 0, `Scrolling drives the page's motion: ${label} ${JSON.stringify(seen)}`)
        if (route === '/') assert.ok(seen.timed > 0, `The home's stage moves on its own: ${label}`)
        assert.equal(await page.evaluate(() => window.__shift), 0, `No layout shift with motion: ${label}`)
        // Arca's logo is never animated.
        assert.deepEqual(await page.evaluate(() => document.getAnimations().map(animation => animation.effect.target).filter(element => element.closest?.('.arca-mark')).length), 0, `Arca's logo stays still: ${label}`)
      }
      // Page to page: the browser's cross-document transition runs to its end (a name used
      // twice on a page would skip it), and the character named on both pages is one of a kind.
      const names = () => page.evaluate(() => { const count = {}; for (const element of document.querySelectorAll('*')) { const name = getComputedStyle(element).viewTransitionName; if (name !== 'none') count[name] = (count[name] ?? 0) + 1 } return count })
      // A busy machine can make the browser drop one transition, so the walk gets three tries;
      // a page that breaks transitions fails all three.
      let arrived = ''
      for (let attempt = 0; attempt < 3 && arrived !== 'finished'; attempt++) {
        await page.goto(origin + '/', { waitUntil: 'load' })
        assert.deepEqual(await names(), { root: 1, 'site-top': 1, genie: 1, omni: 1, pet: 1 }, `Transition names are unique on the home: ${width}px`)
        if (width > 860) { await page.locator('[popovertarget="menu-products"]').click(); await page.locator('#menu-products .menu-item[href="/genie/"]').click() }
        else { await page.locator('.menu-open').click(); await page.locator('#site-menu .menu-item[href="/genie/"]').click() }
        await page.waitForURL(origin + '/genie/')
        await page.waitForFunction(() => window.__arrived === 'finished' || window.__arrived === 'skipped' || window.__arrived === 'plain')
        arrived = await page.evaluate(() => window.__arrived)
      }
      assert.equal(arrived, 'finished', `The page-to-page transition runs: ${width}px`)
      assert.deepEqual(await names(), { root: 1, 'site-top': 1, genie: 1, omni: 1, pet: 1 }, `Transition names are unique on a product page: ${width}px`)
      // The menu eases in and settles fully shown, in place.
      const opener = width > 860 ? '[popovertarget="menu-products"]' : '.menu-open', eased = width > 860 ? '#menu-products .menu-card' : '#site-menu'
      await page.locator(opener).click()
      assert.notEqual(await page.locator(eased).evaluate(node => getComputedStyle(node).transitionDuration), '0s', `The menu has an entrance: ${width}px`)
      await page.waitForFunction(selector => { const style = getComputedStyle(document.querySelector(selector)); return style.opacity === '1' && style.translate === 'none' }, eased)
      assert.deepEqual(outside, []); assert.deepEqual(errors, [])
      console.log(`PASS motion ${width}px: every page scrolled; scroll-driven and timed motion run; layout shift 0; nothing left dim; page transition and menu entrance`)
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
    // The answer page carries the site's logo at the header's size, and none of the retired pictures.
    const answerLogo = await page.evaluate(async () => {
      await Promise.all([...document.images].map(image => image.decode()))
      const image = document.querySelector('.top .brand img')
      return { height: image.getBoundingClientRect().height, file: image.currentSrc.split('/').pop(), drawn: image.naturalWidth > 0, pictures: [...document.images].map(image => new URL(image.currentSrc).pathname) }
    })
    assert.ok(Math.abs(answerLogo.height - 26 * 264 / 222) <= 0.6 && answerLogo.drawn && answerLogo.file === 'automagik-lockup-three-colours-ink-header.svg', `The answer page's logo is the header's: ${JSON.stringify(answerLogo)}`)
    assert.deepEqual(answerLogo.pictures.filter(source => /\.webp$/.test(source)), [], 'No answer page shows a retired picture')
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
