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
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }
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
  for (const route of routes) for (const colorScheme of ['light', 'dark']) for (const width of [1440, 1024, 390, 320]) {
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
      assert.ok(layout.tag.logo * 676 / 902 >= layout.tag.width, `The tag is never bigger than the logo's word: ${label} ${layout.tag.logo}`)
      assert.deepEqual(layout.themed.filter(source => /(?:-dark(?:-2x)?\.webp|\/arca-icon-ivory\.svg|\/automagik-lockup-oi-cream\.svg)$/.test(source) !== (colorScheme === 'dark')), [], `App pictures follow the theme: ${label}`)
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
