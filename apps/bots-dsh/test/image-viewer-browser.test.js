// The image viewer (image-viewer.js) in a real browser: a finished image in the chat opens over
// the whole window from a click on it or from its Open tool, fits the window without growing past
// its own size, closes with Escape, Close or a click beside it, takes focus and gives it back,
// keeps Tab inside, sends what its field asks to the same chat and offers the image to save.
// The tool cell, the card, the styles and the themes are the Bot team's own; React is the pinned
// DSH's; the image route and the host's `send` are fakes in the page.
// IMAGE_VIEWER_SHOTS=<folder> saves screenshots there.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { browserGuard } from './browser-guard.js'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = join(process.env.DSH_HARNESS, 'node_modules/@deepseek-ai')
const assets = join(harness, 'dsh-web-frontend/dist/assets')
const frontend = readFileSync(join(assets, readdirSync(assets).find(name => /^index-.*\.js$/.test(name))), 'utf8')
const seedFactory = /function (\w+)\(\)\{return\{react:[\s\S]*?\}\}/.exec(frontend)
assert.ok(seedFactory, 'pinned DSH supplies the React seed factory')
const seeds = await build({ stdin: { contents: `${frontend.slice(0, seedFactory.index + seedFactory[0].length)}; window.nativeSeeds = ${seedFactory[1]}();`, resolveDir: assets }, bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })
const app = await build({
  entryPoints: [join(plugin, 'test/fixtures/image-viewer-browser-app.js')], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'], loader: { '.css': 'text' },
})
const SHOTS = process.env.IMAGE_VIEWER_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
// A screenshot waits for the tools' and the Send button's own fades to end.
const shot = async (page, name) => {
  if (!SHOTS) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

// The image route, faked: each id is a drawing of a known size.
const SIZES = { 'img-wide0001': [1536, 1024], 'img-tall0001': [1024, 1536], 'img-tiny0001': [240, 160] }
const drawing = ([width, height]) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  + '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27356b"/><stop offset=".6" stop-color="#e98a5b"/><stop offset="1" stop-color="#f6d28a"/></linearGradient></defs>'
  + `<rect width="${width}" height="${height}" fill="url(#sky)"/><rect y="${height * 0.78}" width="${width}" height="${height * 0.22}" fill="#1c2440"/>`
  + `<rect x="${width * 0.47}" y="${height * 0.34}" width="${width * 0.06}" height="${height * 0.46}" fill="#f4efe6"/><circle cx="${width * 0.5}" cy="${height * 0.31}" r="${height * 0.035}" fill="#ffe9a8"/></svg>`

async function fixture(t, { width = 1440, height = 820, dark = false } = {}) {
  const guard = await browserGuard()
  if (guard.skip) { t.skip(guard.skip); return null }
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(6000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()) })
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.href === 'https://automagik.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{background:var(--bt-main)}</style><div id="root"></div>' })
    const id = url.pathname === '/api/omni-ui/image' ? url.searchParams.get('id') : undefined
    if (!SIZES[id]) return route.abort()
    return route.fulfill({ contentType: 'image/svg+xml', body: drawing(SIZES[id]) })
  })
  await page.goto('https://automagik.test/')
  await page.addScriptTag({ content: seeds.outputFiles[0].text })
  await page.addScriptTag({ content: 'window.require=name=>window.nativeSeeds[name];' })
  await page.addScriptTag({ content: app.outputFiles[0].text })
  await page.evaluate(dark => window.setTheme('deepseek', dark), dark)
  t.after(() => assert.deepEqual(errors, [], 'the card and the viewer throw nothing'))
  return page
}

const mount = async (page, options = {}) => {
  await page.evaluate(options => window.mount(options), options)
  await page.locator('.bt-img[data-state=done]').waitFor()
}
const viewer = page => page.getByRole('dialog', { name: 'Image viewer' })
const openTool = page => page.getByRole('button', { name: 'Open image' })
const field = page => viewer(page).getByRole('textbox', { name: 'Ask for changes to this image' })
const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
const open = async (page) => {
  await page.locator('.bt-img-final').click()
  await viewer(page).waitFor()
  await page.waitForFunction(() => { const image = document.querySelector('.bt-imgv-img'); return image?.complete && image.naturalWidth > 0 })
}
// Where the viewer's parts are, and the image's own size.
const layout = page => page.evaluate(() => {
  const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
  const image = document.querySelector('.bt-imgv-img')
  return {
    image: box('.bt-imgv-img'), bar: box('.bt-imgv-bar'), ask: box('.bt-imgv-ask'), layer: box('.bt-imgv-layer'),
    natural: { width: image.naturalWidth, height: image.naturalHeight },
    window: { width: innerWidth, height: innerHeight },
    scrolls: document.documentElement.scrollWidth > innerWidth,
  }
})
const assertFits = (at, label) => {
  assert.deepEqual([at.layer.left, at.layer.top, at.layer.width, at.layer.height], [0, 0, at.window.width, at.window.height], `${label}: the viewer covers the window`)
  assert.ok(at.image.left >= 0 && at.image.right <= at.window.width, `${label}: the image is inside the window's width`)
  assert.ok(at.image.top >= at.bar.bottom && at.image.bottom <= at.ask.top, `${label}: the image sits between the tools and the field`)
  assert.ok(at.image.width <= at.natural.width + 0.5 && at.image.height <= at.natural.height + 0.5, `${label}: the image is not drawn above its own size`)
  assert.ok(Math.abs(at.image.width / at.image.height - at.natural.width / at.natural.height) < 0.01, `${label}: the image keeps its shape`)
  assert.ok(at.ask.bottom <= at.window.height && at.ask.left >= 0 && at.ask.right <= at.window.width, `${label}: the field is inside the window`)
  assert.ok(at.bar.right <= at.window.width && at.bar.top >= 0, `${label}: the tools are inside the window`)
  assert.equal(at.scrolls, false, `${label}: nothing scrolls sideways`)
}

test('the image opens over the window from a click or its Open tool, and fits', async (t) => {
  const page = await fixture(t)
  if (!page) return
  await mount(page)
  assert.equal(await viewer(page).count(), 0, 'nothing is open until asked')
  await open(page)
  assert.equal(await viewer(page).getAttribute('aria-modal'), 'true')
  const wide = await layout(page)
  assertFits(wide, 'landscape')
  // A large image takes all the room there is, in one direction at least.
  assert.ok(wide.image.height >= wide.ask.top - wide.bar.bottom - 24 - 1, 'a large image fills the height left for it')
  assert.equal(await focused(page), 'Ask for changes to this image', 'focus moves into the viewer')
  await shot(page, 'viewer-light-1440')
  await page.keyboard.press('Escape')
  await viewer(page).waitFor({ state: 'detached' })
  assert.equal(await focused(page), 'Open image', 'focus returns to the image card')

  // The Open tool, by keyboard.
  await page.keyboard.press('Enter')
  await viewer(page).waitFor()
  await viewer(page).getByRole('button', { name: 'Close image' }).click()
  await viewer(page).waitFor({ state: 'detached' })
  assert.equal(await focused(page), 'Open image')

  // A click beside the image closes it; a click on the image does not.
  await openTool(page).click()
  await viewer(page).waitFor()
  await page.locator('.bt-imgv-img').click()
  assert.equal(await viewer(page).count(), 1)
  await page.mouse.click(20, 400)
  await viewer(page).waitFor({ state: 'detached' })

  // A portrait image is bound by the height; a small one keeps its own size.
  await mount(page, { id: 'img-tall0001' })
  await open(page)
  assertFits(await layout(page), 'portrait')
  await page.keyboard.press('Escape')
  await mount(page, { id: 'img-tiny0001' })
  await open(page)
  const tiny = await layout(page)
  assertFits(tiny, 'small')
  assert.deepEqual([Math.round(tiny.image.width), Math.round(tiny.image.height)], [240, 160], 'a small image is not blown up')
})

test('Tab stays in the viewer', async (t) => {
  const page = await fixture(t)
  if (!page) return
  await mount(page)
  await open(page)
  const walk = async (key, steps) => { const seen = []; for (let step = 0; step < steps; step++) { await page.keyboard.press(key); seen.push(await focused(page)) } return seen }
  // Send is off while the field is empty, so it is not a stop.
  assert.deepEqual(await walk('Tab', 3), ['Save image', 'Close image', 'Ask for changes to this image'])
  assert.deepEqual(await walk('Shift+Tab', 2), ['Close image', 'Save image'])
  await field(page).fill('Warmer light')
  await field(page).focus()
  assert.deepEqual(await walk('Tab', 4), ['Send', 'Save image', 'Close image', 'Ask for changes to this image'])
  // A click on the image keeps focus in the viewer, so Tab still does not reach the chat behind.
  await page.locator('.bt-imgv-img').click()
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'dialog')
  assert.deepEqual(await walk('Tab', 1), ['Save image'])
  await page.locator('.bt-imgv-img').click()
  assert.deepEqual(await walk('Shift+Tab', 1), ['Send'])
})

test('the field sends the request to the same chat, naming the image, and the viewer closes', async (t) => {
  const page = await fixture(t)
  if (!page) return
  await mount(page)
  await open(page)
  const send = viewer(page).getByRole('button', { name: 'Send' })
  assert.equal(await send.isDisabled(), true, 'nothing to send yet')
  await field(page).fill('   ')
  assert.equal(await send.isDisabled(), true)
  await field(page).fill('Make the sky pink')
  await page.keyboard.press('Enter')
  await viewer(page).waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.sent), [{ sessionId: 'painter', text: 'About the image images/img-wide0001.png: Make the sky pink' }])
  assert.equal(await focused(page), 'Open image')

  // A group chat sends to its room; an agent's own image (acp_tool) names its file the same way.
  await mount(page, { sessionId: 'room', tool: 'acp_tool', id: 'img-tall0001' })
  await open(page)
  await field(page).fill('Add a boat')
  await send.click()
  await viewer(page).waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.sent), [{ sessionId: 'room', text: 'About the image images/img-tall0001.png: Add a boat' }])
})

test('a request that is not sent keeps the viewer and its text, and says why', async (t) => {
  const page = await fixture(t)
  if (!page) return
  await mount(page)
  await open(page)
  await page.evaluate(() => { window.failSend = true; window.holdSend = true })
  await field(page).fill('Make it night')
  await page.keyboard.press('Enter')
  const send = viewer(page).getByRole('button', { name: 'Send' })
  await page.waitForFunction(() => window.sent.length === 1)
  assert.equal(await send.isDisabled(), true, 'one request at a time')
  await page.keyboard.press('Enter')
  await page.evaluate(() => window.releaseSend())
  const alert = viewer(page).getByRole('alert')
  await alert.waitFor()
  assert.equal(await alert.textContent(), 'This Bot is not answering right now.')
  assert.equal(await field(page).inputValue(), 'Make it night')
  assert.equal(await send.isDisabled(), false)
  assert.equal(await page.evaluate(() => window.sent.length), 1)
  assertFits(await layout(page), 'with a refusal')
})

test('Save offers the image under its file name', async (t) => {
  const page = await fixture(t)
  if (!page) return
  await mount(page)
  await open(page)
  const save = viewer(page).getByRole('link', { name: 'Save image' })
  assert.equal(await save.evaluate(link => link.href), 'https://automagik.test/api/omni-ui/image?id=img-wide0001')
  assert.equal(await save.getAttribute('download'), 'img-wide0001.png')
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
  assert.equal(download.suggestedFilename(), 'img-wide0001.png')
  assert.equal(await viewer(page).count(), 1, 'saving leaves the viewer open')
})

test('an image that no longer loads says so in the viewer', async (t) => {
  const page = await fixture(t)
  if (!page) return
  await mount(page)
  await open(page)
  // The browser keeps the card's copy of the image, so the viewer's own load is failed by hand.
  await page.locator('.bt-imgv-img').evaluate(image => image.dispatchEvent(new Event('error')))
  const lost = viewer(page).getByRole('status')
  await lost.waitFor()
  assert.match(await lost.textContent(), /The image could not be shown.*no longer in the team folder/)
  assert.equal(await page.locator('.bt-imgv-img').count(), 0)
  assert.equal(await viewer(page).getByRole('link', { name: 'Save image' }).count(), 0, 'a lost image has nothing to save')
  await shot(page, 'viewer-lost')
  await page.keyboard.press('Escape')
  await viewer(page).waitFor({ state: 'detached' })
})

for (const [name, options] of [['dark-1440', { dark: true }], ['light-720', { width: 720, height: 540 }], ['dark-720', { width: 720, height: 540, dark: true }]]) {
  test(`the viewer fits and reads: ${name}`, async (t) => {
    const page = await fixture(t, options)
    if (!page) return
    await mount(page)
    await page.locator('.bt-img').hover()
    await shot(page, `card-${name}`)
    await open(page)
    assertFits(await layout(page), name)
    await field(page).fill('Make the sky pink and add a small boat')
    await shot(page, `viewer-${name}`)
    // The tools and the field stand on their own surfaces over the scrim, in the theme's ink.
    const paint = await page.evaluate(() => {
      const of = selector => getComputedStyle(document.querySelector(selector))
      return { tool: of('.bt-imgv-bar .bt-img-tool').color, ink: getComputedStyle(document.body).getPropertyValue('--bt-ink').trim(), field: of('.bt-imgv-ask').backgroundColor, scrim: of('.bt-imgv-layer .bt-scrim').backgroundColor }
    })
    assert.notEqual(paint.field, 'rgba(0, 0, 0, 0)')
    assert.equal(paint.scrim, options.dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.32)', 'the app\'s own scrim')
    await mount(page, { id: 'img-tall0001' })
    await open(page)
    assertFits(await layout(page), `${name}, portrait`)
    await shot(page, `viewer-${name}-portrait`)
  })
}
