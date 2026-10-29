// The in-app Bot browser, end to end: the app's own views, relay and cursor (src/bot-views.js,
// src/bot-relay.js, src/bot-cursor.js) in a real Electron, driven by the Playwright the Bot
// team uses, the way a Bot drives them (`connectOverCDP`). Run it as Electron's main script
// from apps/desktop:
//
//   npx electron scripts/browser-smoke.mjs          (Linux without a display: xvfb-run -a …)
//
// It serves its own pages on 127.0.0.1 and reaches a second site at localhost on the same port,
// so the iframe below is cross-site (its own process). It exits 0 when every check passes and
// prints each one. Nothing leaves the computer.
import { app, BrowserWindow, session, shell, WebContentsView } from 'electron'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { BotCursor } from '../src/bot-cursor.js'
import { BotRelay } from '../src/bot-relay.js'
import { BotViews } from '../src/bot-views.js'
import { guardContents } from '../src/dsh.js'

const BOT = 'session-1b4e28ba-2fa1-4d3b-a3f5-ef19f1a2b3c4'
const OTHER = 'session-2b4e28ba-2fa1-4d3b-a3f5-ef19f1a2b3c4'
const require = createRequire(new URL('../../bots-dsh/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const scratch = mkdtempSync(join(tmpdir(), 'automagik-browser-smoke-'))
app.setPath('userData', scratch)

const page = (title, body) => `<!doctype html><title>${title}</title><body>${body}</body>`
let port
const server = createServer((request, response) => {
  const site = (request.headers.host ?? '').startsWith('localhost') ? 'other' : 'home'
  const send = (html, status = 200, headers = {}) => response.writeHead(status, { 'content-type': 'text/html', ...headers }).end(html)
  if (request.url === '/' && site === 'home') {
    return send(page('Home', `
      <p id="out">ready</p>
      <iframe src="http://localhost:${port}/frame" width="300" height="80"></iframe>
      <button id="poke" onclick="out.textContent = 'poked'">Poke</button>
      <button id="alert" onclick="alert('hi'); out.textContent = 'after alert'">Alert</button>
      <button id="fetch" onclick="fetch('/api').then(() => out.textContent = 'fetched', () => out.textContent = 'fetch refused')">Fetch</button>
      <button id="popup" onclick="window.open('http://localhost:${port}/popup')">Popup</button>
      <button id="closer" onclick="window.open('http://localhost:${port}/closer')">Closer</button>
      <a id="away" href="http://localhost:${port}/away">Away</a>`))
  }
  if (request.url === '/closer') return send(page('Closer', '<script>setTimeout(() => window.close(), 300)</script>'))
  if (request.url === '/fav') return send(page('Fav', `<link rel="icon" href="http://localhost:${port}/icon.png">`))
  if (request.url === '/frame') return send(page('Frame', '<button onclick="this.textContent = \'clicked inside\'">Inside</button>'))
  if (request.url === '/redirect') return send('', 302, { location: `http://localhost:${port}/landed` })
  if (request.url === '/api') return send('{}', 200, { 'content-type': 'application/json' })
  return send(page(request.url.slice(1) || 'page', `<p>${site} ${request.url}</p>`))
})

const failures = []
async function check(name, run) {
  try {
    await run()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${error?.message ?? error}`)
  }
}
const assert = (value, message) => { if (!value) throw new Error(message) }
const until = async (test, what, ms = 5_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(done => setTimeout(done, 100))) if (test()) return
  throw new Error(`${what} within ${ms} ms`)
}
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms))])

app.whenReady().then(async () => {
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  port = server.address().port
  const home = `http://127.0.0.1:${port}/`
  // Stands in for dsh: it answers, and a Bot page must still not reach it.
  const dsh = createServer((_request, response) => response.end('dsh'))
  await new Promise(done => dsh.listen(0, '127.0.0.1', done))
  const dshOrigin = `http://127.0.0.1:${dsh.address().port}`
  const external = []
  shell.openExternal = async (url) => { external.push(url) }
  const window = new BrowserWindow({ width: 1000, height: 760, show: true })
  // A stand-in for dsh's page under the title bar, as main.js lays it in.
  const stand = new WebContentsView()
  stand.setBounds({ x: 0, y: 40, width: 1000, height: 720 })
  window.contentView.addChildView(stand)
  await stand.webContents.loadURL('data:text/html,<body style="background:%23eee">dsh</body>')
  const views = new BotViews({ window: () => window, WebContentsView, session, origin: () => dshOrigin, page: () => ({ ...stand.getBounds(), zoom: 1, radius: 10 }) })
  const relay = new BotRelay({ views })
  const cursor = new BotCursor({ window: () => window, BrowserWindow, views })
  const cursors = () => window.getChildWindows()
  // The last check closes the window: the smoke goes on without it.
  app.on('window-all-closed', () => {})
  // Where the shown tab is on screen, which its cursor window must cover.
  const onScreen = (view) => {
    const content = window.getContentBounds()
    const bounds = view.getBounds()
    return { ...bounds, x: content.x + bounds.x, y: content.y + bounds.y }
  }
  const same = (a, b) => ['x', 'y', 'width', 'height'].every(key => a[key] === b[key])
  // Where the cursor page draws the pointer, if it does.
  const drawn = () => cursors()[0].webContents.executeJavaScript(
    "(pointer => pointer.classList.contains('on') && ['--x', '--y'].map(name => parseFloat(pointer.style.getPropertyValue(name))))(document.querySelector('.pointer'))")
  // The app's own rules, as main.js harden() sets them, with Bot views left to theirs.
  app.on('web-contents-created', (_event, contents) => guardContents(contents, { origin: dshOrigin, openExternal: url => shell.openExternal(url), isBotView: view => views.owns(view) }))

  let browser = await chromium.connectOverCDP(await relay.endpoint(BOT, { downloadRoots: [scratch] }))
  let context = browser.contexts()[0]
  let tab = context.pages()[0]

  await check('a Bot view is recognised as one, the app\'s window is not', () => {
    assert(views.owns(views.entriesOf(BOT)[0].contents), 'the Bot view is not recognised')
    assert(!views.owns(window.webContents), 'the window counts as a Bot view')
  })
  await check('the page loads through the relay', async () => {
    await tab.goto(home)
    assert(await tab.title() === 'Home', `title ${await tab.title()}`)
  })
  await check('a cross-site iframe is read and clicked', async () => {
    const main = views.entriesOf(BOT)[0].contents.mainFrame
    assert(main.framesInSubtree.some(frame => frame.osProcessId !== main.osProcessId), 'the iframe shares the page\'s process')
    const button = tab.frameLocator('iframe').getByRole('button', { name: 'Inside' })
    await within(button.click(), 10_000, 'the click in the iframe')
    assert(await button.textContent() === 'clicked inside', 'the iframe did not take the click')
  })
  await check('a JS dialog reaches the Bot', async () => {
    const seen = new Promise(done => tab.once('dialog', dialog => { void dialog.accept(); done(dialog.message()) }))
    await within(tab.click('#alert'), 10_000, 'the click that opens the dialog')
    assert(await within(seen, 5_000, 'the dialog') === 'hi', 'wrong dialog')
    await tab.waitForFunction(() => document.querySelector('#out').textContent === 'after alert', null, { timeout: 5_000 })
  })
  await check('a tab the panel does not show can be screenshot', async () => {
    assert(!views.entriesOf(BOT)[0].view.getVisible(), 'the view is shown')
    const image = await within(tab.screenshot(), 10_000, 'the screenshot')
    assert(image.length > 1000, 'empty screenshot')
  })
  await check('the panel\'s rectangle places the shown tab over dsh\'s page', () => {
    const { tabId, view } = views.entriesOf(BOT)[0]
    views.place(tabId, { left: 500, top: 10, width: 480, height: 600 }, true)
    const bounds = view.getBounds()
    assert(view.getVisible() && bounds.x === 500 && bounds.y === 50 && bounds.width === 480, JSON.stringify(bounds))
    views.place(tabId, null, false)
    assert(!view.getVisible(), 'the tab stayed on screen')
  })
  await check('a page request is seen and aborted through context.route', async () => {
    let routed = false
    await context.route('**/api', (route) => { routed = true; void route.abort() })
    await tab.click('#fetch')
    await tab.waitForFunction(() => document.querySelector('#out').textContent === 'fetch refused', null, { timeout: 5_000 })
    assert(routed, 'the route never saw the request')
    await context.unroute('**/api')
  })
  await check('window.open becomes a new tab of the same Bot', async () => {
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), tab.click('#popup')])
    await popup.waitForLoadState()
    assert(popup.url().endsWith('/popup'), `popup at ${popup.url()}`)
    assert(views.sync(BOT).length === 2, `${views.sync(BOT).length} tabs`)
    await popup.close()
  })
  await check('a tab that closes itself goes, and the Bot keeps working', async () => {
    const [closer] = await within(Promise.all([context.waitForEvent('page', { timeout: 10_000 }), tab.click('#closer')]), 10_000, 'the tab opening')
    await within(closer.waitForEvent('close'), 10_000, 'the tab closing itself')
    await until(() => views.entriesOf(BOT).length === 1, 'the closed tab never left')
    assert(views.sync(BOT).length === 1, 'the panel cannot list the tabs')
    assert(await within(tab.evaluate(() => 1 + 1), 5_000, 'the Bot\'s next call') === 2, 'the Bot\'s connection broke')
    const again = await within(chromium.connectOverCDP(await relay.endpoint(BOT)), 10_000, 'a new connection')
    assert(again.contexts()[0].pages().length === 1, 'a new connection failed')
    await again.close()
  })
  await check('a page\'s favicon from the web never reaches dsh\'s page', async () => {
    await tab.goto(`${home}fav`)
    await new Promise(done => setTimeout(done, 1000))
    const favicon = views.sync(BOT)[0].favicon
    assert(favicon === null || favicon.startsWith('data:'), `favicon ${favicon}`)
    await tab.goto(home)
  })
  await check('a link to another origin stays in the view', async () => {
    await Promise.all([tab.waitForURL('**/away', { timeout: 10_000 }), tab.click('#away')])
  })
  await check('a server redirect to another origin stays in the view', async () => {
    await tab.goto(`${home}redirect`)
    assert(tab.url().endsWith('/landed'), `at ${tab.url()}`)
  })
  await check('nothing opened in the system browser', () => assert(external.length === 0, external.join(', ')))
  await check('dsh\'s own port is out of reach', async () => {
    for (const url of [`${dshOrigin}/`, `http://localhost:${dsh.address().port}/`]) {
      const refused = await tab.goto(url).then(() => false, () => true)
      assert(refused, `${url} loaded`)
    }
    // The refusal leaves an error page loading behind it.
    await tab.waitForLoadState()
  })
  await check('a crashed page drops the connection and loads again', async () => {
    await tab.goto(`${home}before-crash`)
    const gone = new Promise(done => browser.once('disconnected', done))
    views.entriesOf(BOT)[0].contents.forcefullyCrashRenderer()
    await within(gone, 10_000, 'the disconnect')
    browser = await chromium.connectOverCDP(await relay.endpoint(BOT))
    context = browser.contexts()[0]
    tab = context.pages()[0]
    await tab.waitForURL('**/before-crash', { timeout: 10_000 })
    assert(await tab.title() === 'before-crash', 'the page did not load again')
  })
  await check('the Bot\'s cursor covers the shown tab', async () => {
    assert(cursors().length === 0, 'a cursor while no tab is shown')
    const { tabId, view } = views.entriesOf(BOT)[0]
    views.place(tabId, { left: 100, top: 20, width: 600, height: 500 }, true)
    await until(() => cursors()[0]?.isVisible(), 'the cursor never showed')
    const [shown] = cursors()
    assert(same(shown.getBounds(), onScreen(view)), `${JSON.stringify(shown.getBounds())} over ${JSON.stringify(onScreen(view))}`)
  })
  await check('the cursor stays on the tab as the app window moves, and goes while it is hidden', async () => {
    const [x, y] = window.getPosition()
    window.setPosition(x + 40, y + 30)
    const { view } = views.entriesOf(BOT)[0]
    await until(() => window.getPosition()[0] === x + 40, 'the window never moved')
    await until(() => same(cursors()[0].getBounds(), onScreen(view)), 'the cursor stayed behind')
    window.hide()
    await until(() => cursors().length === 0, 'the cursor outlived the hidden window')
    window.show()
    await until(() => cursors()[0]?.isVisible(), 'the cursor never came back')
  })
  await check('the cursor follows the Bot\'s click', async () => {
    await tab.goto(home)
    const box = await tab.locator('#poke').boundingBox()
    await tab.click('#poke')
    await tab.waitForFunction(() => document.querySelector('#out').textContent === 'poked', null, { timeout: 5_000 })
    const at = [box.x + box.width / 2, box.y + box.height / 2]
    const near = point => point && point.every((value, index) => Math.abs(value - at[index]) < 1)
    let seen
    for (const end = Date.now() + 5_000; Date.now() < end && !near(seen = await drawn());) await new Promise(done => setTimeout(done, 100))
    assert(near(seen), `drawn at ${seen}, clicked at ${at}`)
  })
  await check('a hold closes the Bot\'s connection and refuses a new one, with its cursor hidden', async () => {
    const gone = new Promise(done => browser.once('disconnected', done))
    await views.hold(BOT, true)
    await within(gone, 5_000, 'the disconnect')
    assert(cursors().length === 0, 'the cursor shows under the hold')
    const refused = await relay.endpoint(BOT).then(() => false, () => true)
    assert(refused, 'an endpoint was issued under the hold')
    await views.hold(BOT, false)
    assert(cursors().length === 0, 'the cursor shows before the Bot is back')
  })
  await check('the cursor shows again for the Bot\'s next session', async () => {
    browser = await chromium.connectOverCDP(await relay.endpoint(BOT))
    await until(() => cursors()[0]?.isVisible(), 'the cursor stayed hidden')
    await browser.close()
  })
  await check('another Bot cannot reach this Bot\'s tabs', async () => {
    const other = await chromium.connectOverCDP(await relay.endpoint(OTHER))
    const urls = other.contexts()[0].pages().map(target => target.url())
    assert(!urls.some(url => url.includes(String(port))), urls.join(', '))
    await other.close()
  })
  await check('a page session reaches only its own tab', async () => {
    const socket = new WebSocket(await relay.endpoint(BOT))
    await within(new Promise((done, fail) => { socket.once('open', done); socket.once('error', fail) }), 5_000, 'the connection')
    const answers = new Map()
    let sessionId
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.method === 'Target.attachedToTarget') sessionId ??= message.params.sessionId
      if (message.id) answers.set(message.id, message)
    })
    let id = 0
    const ask = async (method, params = {}, session) => {
      const asked = ++id
      socket.send(JSON.stringify({ id: asked, method, params, ...(session ? { sessionId: session } : {}) }))
      await until(() => answers.has(asked), `${method} answered`)
      return answers.get(asked)
    }
    await ask('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    await until(() => sessionId !== undefined, 'the tab attached')
    for (const method of ['Target.getTargets', 'Target.attachToBrowserTarget', 'Target.createTarget']) {
      const answer = await ask(method, method === 'Target.createTarget' ? { url: 'about:blank' } : {}, sessionId)
      if (!answer.error) throw new Error(`${method} on a page session answered ${JSON.stringify(answer.result)?.slice(0, 200)}`)
    }
    socket.close()
  })
  await check('closing the Bot\'s tabs closes its cursor', async () => {
    browser = await chromium.connectOverCDP(await relay.endpoint(BOT))
    await until(() => cursors().length === 1, 'no cursor to close')
    const [shown] = cursors()
    for (const { tabId } of views.entriesOf(BOT)) await views.close(BOT, tabId)
    assert(shown.isDestroyed() && cursors().length === 0, 'the cursor outlived the tabs')
    await browser.close()
  })
  await check('closing the app window as macOS and Windows do leaves no cursor behind', async () => {
    const other = await chromium.connectOverCDP(await relay.endpoint(OTHER))
    views.place(views.entriesOf(OTHER)[0].tabId, { left: 0, top: 0, width: 400, height: 300 }, true)
    await until(() => cursors().length === 1, 'no cursor to leave behind')
    // main.js: the close is held for the fade, then the window is destroyed.
    window.once('close', (event) => { event.preventDefault(); window.destroy() })
    const closed = new Promise(done => window.once('closed', done))
    window.close()
    await within(closed, 5_000, 'the window closing')
    await until(() => BrowserWindow.getAllWindows().length === 0, `${BrowserWindow.getAllWindows().length} windows left`)
    await other.close()
  })

  cursor.dispose()
  relay.dispose()
  views.dispose()
  server.close()
  dsh.close()
  rmSync(scratch, { recursive: true, force: true })
  console.log(failures.length === 0 ? 'browser smoke: all passed' : `browser smoke: ${failures.length} failed`)
  app.exit(failures.length === 0 ? 0 : 1)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
