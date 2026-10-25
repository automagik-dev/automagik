// Screenshot the main Bot team screens, the same on both ends, one PNG per screen plus a
// JSON with its visible text runs (box, size, colour) and a DOM outline of its regions, so a
// redraw can be checked against it. The screens, in order:
//   team, sidebar, model-card (only while the Main Bot still waits for a model), main-greets,
//   private-chat, details, details-model, details-settings, memory-saved, memory-team,
//   details-memory, memory-summary, memory-entries, memory-ask, memory-pill, group-chat,
//   group-details, group-details-settings, context-menu, bot-settings, bot-settings-end,
//   bots-page, groups-page, group-settings, usage, usage-end, usage-models, usage-calendar,
//   usage-custom, usage-bot, usage-bot-tip, harness-settings, builtin-plugins, account-menu,
//   plugins, plugins-end, sessions (DSH's classic Agent mode).
// Writer (pinned) and Coder and their group are created through POST api/omni-ui, and each
// chat gets the messages the mock model (dev/mock-llm.mjs) answers.
//
//   node dev/ui-shots.mjs web <dsh-repo> <out-dir> <bench-name> <web-port> [<mock-port>]
//   node dev/ui-shots.mjs desktop <dsh-repo> <out-dir> <renderer-port>
//
// Web: with <mock-port>, the bench is reset first (dev/bench.sh <name> <web-port> <mock-port>
// reset, with this process's environment, so run it with the bench's), which empties the
// team; without it the team must be fresh. The page is 1440×900. It logs in with the token
// URL in the bench's web.log and never prints it. Chrome: CHROME_BIN, else google-chrome,
// chromium or chromium-browser on PATH, else playwright's own download. playwright-core
// comes from <dsh-repo>, else from PLAYWRIGHT_CORE (a playwright-core folder).
// Desktop attaches to a running window (desktop.sh); set SHOT_DISPLAY and XAUTHORITY to grab
// the screen instead of a CDP screenshot.
// Web writes <screen>.png and <screen>.json; Desktop prefixes them desktop-, so both can share
// a folder. SHOTS=name,name limits what is written (the flow still runs). Exits 1 if a check
// failed; index.json lists the screens taken and the failures.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectApp, playwright, waitTeam } from './desktop-linux/lib.mjs'

const [mode, repo, outDir, target, webPort, mockPort] = process.argv.slice(2)
if (!['desktop', 'web'].includes(mode) || !repo || !outDir || !target || (mode === 'web' && !webPort)) {
  console.error('usage: node dev/ui-shots.mjs web <dsh-repo> <out-dir> <bench-name> <web-port> [<mock-port>]\n       node dev/ui-shots.mjs desktop <dsh-repo> <out-dir> <renderer-port>')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(',').map(name => name.trim())) : undefined
const hideToken = text => String(text).replace(/token=[^\s&"']+/g, 'token=…')

const findChrome = () => {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim() } catch {}
  }
  return undefined
}
const loadPlaywright = async () => {
  try {
    return playwright(repo)
  } catch (error) {
    if (!process.env.PLAYWRIGHT_CORE) throw new Error(`no playwright-core in ${repo}; set PLAYWRIGHT_CORE to a playwright-core folder (${error.message.split('\n')[0]})`)
    const module = await import(pathToFileURL(join(resolve(process.env.PLAYWRIGHT_CORE), 'index.mjs')).href)
    return module.default ?? module
  }
}

if (mode === 'web' && mockPort) {
  // bench.sh prints only its status; anything that looks like a token is cut all the same.
  try {
    const out = execFileSync('sh', [join(PLUGIN, 'dev', 'bench.sh'), target, webPort, mockPort, 'reset'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(hideToken(out).trim())
  } catch (error) {
    console.error(hideToken(`${error.stdout ?? ''}${error.stderr ?? ''}`).trim() || 'bench reset failed')
    process.exit(1)
  }
}

let browser
let page
if (mode === 'desktop') {
  ({ browser, page } = await connectApp(repo, target, 30_000))
} else {
  const { chromium } = await loadPlaywright()
  browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--force-color-profile=srgb'] })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  const log = readFileSync(join(dirname(PLUGIN), `.dsh-test-${target}`, 'web.log'), 'utf8')
  const login = log.match(new RegExp(`http://127\\.0\\.0\\.1:${webPort}/\\?token=[^\\s]+`))?.[0]
  if (!login) throw new Error(`no login URL in .dsh-test-${target}/web.log`)
  // A failed load names its URL in the error and its call log: rethrow it without the token.
  try {
    await page.goto(login)
  } catch (error) {
    await browser.close()
    throw new Error(hideToken(error.message))
  }
}

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}
const waits = (locator, timeout = 30_000) => locator.waitFor({ timeout }).then(() => true, () => false)

// A team without a linked Omni opens on the channels plugin's "Connect your Omni" step, a
// moment after the page (sometimes after the team shows); a handler skips it whenever it is
// there. Its Continue buttons stay disabled, so the preview notice's is the enabled one.
const skip = page.getByRole('button', { name: 'Skip for now' })
await page.addLocatorHandler(skip, async () => {
  await skip.click()
  await skip.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
})
// dsh shows a preview notice until it is dismissed once per profile; the handler clears it
// before any click, `shot` before a capture.
const notice = page.getByRole('dialog').getByRole('button', { name: 'Continue', disabled: false })
await page.addLocatorHandler(notice, () => notice.click())
const dismissNotice = async () => {
  for (const button of [skip, notice]) {
    // The click runs the button's own handler first, which may already have closed it.
    if (await button.isVisible()) {
      await button.click({ timeout: 3_000 }).catch(() => {})
      await page.waitForTimeout(600)
    }
  }
}
await page.waitForTimeout(4000)
await dismissNotice()
// A run that stopped in classic Agent mode left the profile there.
const back = page.locator('button.bt-return')
if (await back.isVisible().catch(() => false)) {
  await back.click()
  await page.waitForTimeout(1500)
}
await waitTeam(page)
await page.waitForTimeout(1500)

// What is on screen: wrappers that only repeat their child's box collapse (display:contents
// wrappers and shadow roots are looked through), and each node keeps its box, classes, role,
// label and the few styles a redraw needs; `texts` lists every visible text run.
const outline = () => page.evaluate(() => {
  const W = innerWidth
  const H = innerHeight
  const shown = el => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width >= 2 && r.height >= 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W
  }
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  const style = el => {
    const s = getComputedStyle(el)
    const o = {}
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') o.bg = s.backgroundColor
    if (s.backgroundImage !== 'none') o.bgImage = s.backgroundImage.slice(0, 80)
    if (s.borderRadius !== '0px') o.radius = s.borderRadius
    if (s.boxShadow !== 'none') o.shadow = s.boxShadow.slice(0, 80)
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(k => s[`border${k}Width`] !== '0px' && s[`border${k}Style`] !== 'none')
    if (sides.length) o.border = `${sides.map(k => k[0]).join('')} ${s[`border${sides[0]}Width`]} ${s[`border${sides[0]}Color`]}`
    return o
  }
  const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim()
  const meta = el => {
    const o = { tag: el.tagName.toLowerCase() }
    const cls = typeof el.className === 'string' ? el.className.trim() : el.getAttribute('class') ?? ''
    if (cls) o.cls = cls.split(/\s+/).slice(0, 5).join(' ')
    for (const a of ['id', 'role', 'aria-label', 'title', 'placeholder', 'data-bot-id', 'data-room-id', 'data-info-row', 'data-kind', 'aria-pressed', 'aria-selected', 'type']) {
      const v = el.getAttribute(a)
      if (v) o[a] = v.slice(0, 80)
    }
    return o
  }
  const kidsOf = el => [...(el.shadowRoot ? el.shadowRoot.children : []), ...el.children].flatMap(k => (getComputedStyle(k).display === 'contents' ? kidsOf(k) : [k]))
  function node(el, depth) {
    const kids = kidsOf(el).filter(shown)
    if (kids.length === 1 && box(kids[0]).join() === box(el).join() && !ownText(el)) return node(kids[0], depth)
    const o = { ...meta(el), box: box(el), ...style(el) }
    const t = ownText(el)
    if (t) { const s = getComputedStyle(el); o.text = t.slice(0, 160); o.font = `${s.fontSize} ${s.fontWeight}`; o.color = s.color }
    if (['svg', 'IMG', 'CANVAS'].includes(el.tagName)) return o
    if (depth < 18 && kids.length) o.children = kids.slice(0, 60).map(k => node(k, depth + 1))
    return o
  }
  const texts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = walker.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim()
    const el = n.parentElement
    if (!t || !el || !shown(el)) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    if (r.width < 1 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue
    const s = getComputedStyle(el)
    texts.push({ text: t.slice(0, 200), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight} ${s.fontFamily.split(',')[0]}`, color: s.color })
  }
  return { viewport: [W, H], title: document.title, tree: node(document.body, 0), texts }
})

const display = mode === 'desktop' ? process.env.SHOT_DISPLAY : undefined
const taken = []
// `move: false` keeps the mouse where it is, for menus and tooltips that close without it.
const shot = async (name, { move = true } = {}) => {
  await dismissNotice()
  if (move) {
    await page.mouse.move(100, 500)
    await page.waitForTimeout(300)
  }
  if (only && !only.has(name)) return
  // Desktop shots carry a prefix, so a Web and a Desktop run can share a folder (dev/check.sh).
  const stem = mode === 'web' ? name : `desktop-${name}`
  const path = join(outDir, `${stem}.png`)
  if (display) {
    const size = await page.evaluate(() => [window.outerWidth, window.outerHeight])
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', size.join('x'), '-i', `${display}+0,0`, '-frames:v', '1', path])
  } else {
    await page.screenshot({ path })
  }
  writeFileSync(join(outDir, `${stem}.json`), JSON.stringify({ screen: name, ...(await outline()) }, null, 1))
  taken.push(name)
  console.log(`shot ${name}`)
}
const api = async (endpoint, payload) => {
  const result = await page.evaluate(([e, p]) => fetch('api/omni-ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: e, payload: p }) }).then(r => r.json()), [endpoint, payload])
  if (!result.ok) throw new Error(`${endpoint}: ${result.error?.message}`)
  return result.value
}
const send = async (text) => {
  const box = page.locator('[contenteditable="true"], textarea').last()
  await box.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
const openRow = selector => page.locator(selector).first().click().then(() => page.waitForTimeout(1200))
const openDetails = () => page.getByRole('button', { name: 'View conversation details' }).first().click().then(() => page.waitForTimeout(800))
const closeDetails = () => page.getByRole('button', { name: 'Close details' }).first().click().then(() => page.waitForTimeout(600))
const scrollSettings = to => page.locator('.bt-settings-scroll').evaluate((node, end) => { node.scrollTop = end ? node.scrollHeight : 0 }, to === 'end')

try {
  await shot('team')

  let state = await api('state', {})
  for (const name of ['Writer', 'Coder']) {
    if (!state.bots.some(bot => bot.name === name)) await api('create-bot', { name, role: name === 'Writer' ? 'Writer' : 'Engineer' })
  }
  state = await api('state', {})
  const main = state.bots.find(bot => bot.id === state.mainBotId)
  const writer = state.bots.find(bot => bot.name === 'Writer')
  const coder = state.bots.find(bot => bot.name === 'Coder')
  const room = state.rooms.find(candidate => candidate.members.includes(writer.id) && candidate.members.includes(coder.id)) ?? await api('create-room', { members: [writer.id, coder.id] })
  await api('set-flags', { id: writer.id, pinned: true })
  const writerRow = `.bt-row[data-bot-id="${writer.id}"]`
  const mainRow = `.bt-row[data-bot-id="${main.id}"]`
  const roomRow = `.bt-row[data-room-id="${room.id}"]`
  check(await waits(page.locator(roomRow).first()), 'the group chat shows in the sidebar')
  check(await waits(page.locator(`${writerRow} .bt-pin`), 10_000), 'a pinned Bot shows a pin beside its name')
  for (const name of ['Writer', 'Coder']) check(await waits(page.getByText(`Hi, I'm ${name}`, { exact: false }).first(), 60_000), `${name} greets`)
  await openRow(mainRow)
  await page.waitForTimeout(800)
  await shot('sidebar')

  // A fresh Main Bot waits for its model: the details panel asks for one, then it greets.
  await openDetails()
  if ((await api('state', {})).bots.find(bot => bot.id === main.id)?.waiting) {
    await page.locator('.bt-panel .bt-model-trigger').first().click()
    check(await waits(page.locator('.bt-model-menu'), 5_000), `${main.name}'s details panel offers the models`)
    await page.waitForTimeout(500)
    await shot('model-card', { move: false })
    await page.locator('.bt-model-menu button, .bt-model-menu [role="menuitem"]').first().click()
  } else {
    console.log(`note: ${main.name} already had a model, so there is no model-card shot`)
  }
  check(await waits(page.getByText('先让团队帮你做哪块', { exact: false }).last(), 60_000), `${main.name} greets once it has a model`)
  await page.waitForTimeout(1200)
  await closeDetails()
  await page.waitForTimeout(1500)
  await shot('main-greets')

  await openRow(writerRow)
  await send('Hi, tell me about yourself')
  check(await waits(page.getByText('收到：Hi', { exact: false }).last()), 'Writer answers in its private chat')
  await page.waitForTimeout(1500)
  await shot('private-chat')
  await openDetails()
  const trigger = page.locator('.bt-panel .bt-model-trigger').first()
  check(await waits(trigger, 10_000), 'the details panel shows the model picker')
  await page.waitForTimeout(400)
  await shot('details')
  await trigger.click()
  check(await waits(page.locator('.bt-model-menu'), 5_000), 'the model picker opens a menu')
  await page.waitForTimeout(400)
  await shot('details-model', { move: false })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.locator('.bt-panel [data-info-row="settings"]').click()
  check(await waits(page.locator('.bt-panel .bt-bs'), 5_000), 'the details panel opens Bot settings in place')
  await page.waitForTimeout(600)
  await shot('details-settings')
  await closeDetails()

  // Memory: Writer saves one entry and may not write the team memory, which the Main Bot does.
  await send('记住 I like short answers, with the conclusion first')
  check(await waits(page.locator('.bt-event button', { hasText: 'Memory updated' }).last()), 'remember shows a "Memory updated" line')
  await send('团队记住 The weekly report is due Friday by 5 pm')
  check(await waits(page.getByText('没记成：Only Main Bots and group admins write the team memory', { exact: false }).last()), 'a Bot that is neither a Main Bot nor a group admin cannot write the team memory')
  await page.waitForTimeout(1200)
  await shot('memory-saved')
  await openRow(mainRow)
  await send('团队记住 The weekly report is due Friday by 5 pm')
  check(await waits(page.locator('.bt-event button', { hasText: 'Team memory updated' }).last()), 'the Main Bot writes the team memory, and the chat says so')
  await page.waitForTimeout(1200)
  await shot('memory-team')
  await openRow(writerRow)
  await openDetails()
  const memoryRow = page.locator('.bt-panel .bt-mem-row')
  check(await waits(memoryRow.filter({ hasText: '2 entries' }), 10_000), 'the details panel counts 2 memory entries')
  await page.waitForTimeout(400)
  await shot('details-memory')
  await memoryRow.click()
  const memory = page.locator('.bt-mem')
  check(await waits(memory.locator('.bt-mem-summary h3').first()), 'the memory dialog writes a summary')
  check(await waits(memory.locator('.bt-mem-status', { hasText: /Updated/ }), 10_000), 'the memory dialog says when the summary was written')
  await page.waitForTimeout(800)
  await shot('memory-summary')
  await memory.getByRole('button', { name: 'Memory options' }).click()
  await page.locator('.bt-mem-menu').getByRole('menuitem', { name: /All entries/ }).click()
  check(await waits(memory.locator('.bt-mem-entry').nth(1), 5_000) && await memory.locator('.bt-mem-entry').count() === 2, 'All entries lists both entries')
  await page.waitForTimeout(600)
  await shot('memory-entries')
  await memory.getByRole('button', { name: 'Back to the summary' }).click()
  await memory.locator('.bt-mem-input').fill('remember I write code in Vim')
  await page.keyboard.press('Enter')
  check(await waits(memory.locator('.bt-mem-changes li[data-ok]')), 'Ask or update adds an entry')
  check(await waits(memory.locator('.bt-mem-summary p', { hasText: 'Vim' })), 'the summary is written again with the new entry')
  await page.waitForTimeout(800)
  await shot('memory-ask')
  await memory.getByRole('button', { name: 'Close memory' }).click()
  check(await memory.waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false), 'the memory dialog closes')
  await closeDetails()
  // A lasting preference said in passing is kept by the memory review in the background,
  // and the header pill shows up to say so.
  await send('From now on, sum up the key points of my docs in Markdown tables')
  check(await waits(page.getByText('收到：From now on', { exact: false }).last()), 'Writer answers again')
  check(await waits(page.locator('.bt-pill[data-memory=updated]'), 20_000), 'the header pill says memory was updated')
  await shot('memory-pill')

  await openRow(roomRow)
  const before = await page.locator('.bt-group-msg').count()
  await send('Hi all, one line each please')
  check(await page.waitForFunction(count => document.querySelectorAll('.bt-group-msg').length > count + 1, before, { timeout: 60_000 }).then(() => true, () => false), 'both members answer in the group chat')
  await page.waitForTimeout(4000)
  await shot('group-chat')
  await openDetails()
  await shot('group-details')
  await page.locator('.bt-panel [data-info-row="settings"]').click()
  check(await waits(page.locator('.bt-panel .bt-bs .bt-seg'), 5_000), 'the details panel opens group settings in place')
  await page.waitForTimeout(600)
  await shot('group-details-settings')
  await closeDetails()

  await page.locator(writerRow).first().click({ button: 'right' })
  await page.waitForTimeout(500)
  await shot('context-menu', { move: false })
  await page.getByRole('menuitem', { name: 'Edit Bot' }).click()
  check(await waits(page.locator('.bt-settings'), 10_000), 'Edit Bot opens Bot settings')
  await page.waitForTimeout(800)
  await shot('bot-settings')
  // The working folder uses the same picker; the model's is the one labelled Model.
  check(await page.locator('.bt-settings .bt-model-trigger[aria-label^="Model:"]').count() === 1, 'Bot settings show the model picker')
  await scrollSettings('end')
  await page.waitForTimeout(400)
  await shot('bot-settings-end')
  await page.locator('.bt-settings-nav .bt-settings-item', { hasText: /^Bots$/ }).click()
  await page.waitForTimeout(800)
  check(await page.locator('.bt-settings select[aria-label="Main Bot"]').count() === 1, 'the Bots page can change the Main Bot')
  await shot('bots-page')
  await page.locator('.bt-settings-nav .bt-settings-item', { hasText: /^Group chats$/ }).click()
  await page.waitForTimeout(800)
  await shot('groups-page')
  await page.locator('.bt-settings-scroll button.bt-set-row').first().click()
  check(await waits(page.locator('.bt-settings .bt-bs .bt-seg'), 5_000), 'a group chat opens its own settings')
  await page.waitForTimeout(600)
  await shot('group-settings')

  const settingsBox = await page.locator('.bt-settings').boundingBox()
  await page.locator('.bt-settings-nav .bt-settings-item', { hasText: /^Usage$/ }).click()
  check(await waits(page.locator('.bt-us-stats'), 15_000), 'the Usage page shows the totals')
  const usageBox = await page.locator('.bt-settings').boundingBox()
  check(Boolean(settingsBox && usageBox) && Math.abs(usageBox.width - settingsBox.width) < 1 && Math.abs(usageBox.height - settingsBox.height) < 1, 'the settings dialog keeps its size on Usage')
  check(await waits(page.locator('.bt-us-row[data-kind="bot"]').first(), 15_000), 'the Usage page ranks the Bots that used tokens')
  check(await waits(page.locator('.bt-us-row[data-kind="model"]').first(), 5_000), 'the Usage page ranks the models')
  await page.waitForTimeout(1200)
  await shot('usage')
  await scrollSettings('end')
  await page.waitForTimeout(500)
  await shot('usage-end')
  await page.locator('.bt-us-chart').getByRole('button', { name: 'By model' }).click()
  check(await waits(page.locator('.bt-us-chart button.bt-us-key').first(), 5_000), 'the chart stacks by model')
  await page.waitForTimeout(800)
  await shot('usage-models')
  await scrollSettings('top')
  await page.locator('.bt-us-top').getByRole('button', { name: 'Custom' }).click()
  check(await waits(page.locator('.bt-us-pick'), 5_000), 'Custom opens a calendar')
  // The last three days of this month up to today, or as many as it has so far.
  const days = page.locator('.bt-us-month').nth(1).locator('.bt-us-day:not([disabled])')
  const open = await days.count()
  const picked = Math.min(3, open)
  await days.nth(open - picked).click()
  await scrollSettings('top')
  await days.nth(open - 1).hover()
  await page.waitForTimeout(300)
  check(await page.locator('.bt-us-pick .bt-us-day[data-in]').count() === picked, 'the calendar previews the span under the mouse')
  await shot('usage-calendar', { move: false })
  await days.nth(open - 1).click()
  check(await page.locator('.bt-us-pick').waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false), 'the second day closes the calendar')
  check(await page.locator('.bt-us-col').count() === (picked >= 3 ? picked : picked * 24), 'the chart shows the picked days')
  // Playwright may scroll while it retries a click on the calendar; a person's click does not.
  await scrollSettings('top')
  await page.waitForTimeout(800)
  await shot('usage-custom')
  await page.locator('.bt-us-top').getByRole('button', { name: '7 days' }).click()
  await page.locator('.bt-us-chart').getByRole('button', { name: 'By Bot' }).click()
  await page.locator('.bt-us-row[data-kind="bot"]').first().click()
  check(await waits(page.locator('.bt-us-profile'), 5_000), 'a Bot opens its own usage')
  check(await page.locator('.bt-us-heat').count() === 1, 'a Bot\'s usage shows its activity')
  await page.waitForTimeout(1200)
  await shot('usage-bot')
  await page.locator('.bt-us-col').last().hover()
  await page.waitForTimeout(400)
  check(await page.locator('.bt-us-tip').count() === 1, 'hovering a bar shows its tokens')
  await shot('usage-bot-tip', { move: false })
  await page.locator('.bt-settings-head .bt-icon-btn').click()
  check(await page.locator('.bt-us-profile').waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false), 'the back button returns to all usage')

  // DSH's own surfaces: its settings (through the Bot team settings), the Plugins page
  // (through the account menu) and its classic Agent mode with the session list.
  await page.locator('.bt-settings-nav .bt-settings-shell').click()
  const harness = page.locator('[data-shortcut-modal="settings"]')
  check(await waits(harness, 10_000), 'Harness settings opens DeepSeek Harness settings')
  await page.waitForTimeout(800)
  await shot('harness-settings')
  await harness.getByText('Built-in plugins', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  await shot('builtin-plugins')
  await page.keyboard.press('Escape')
  await harness.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(600)
  if (mode === 'web') {
    await page.locator('button.bt-account').click()
    await page.waitForTimeout(700)
    await shot('account-menu', { move: false })
    await page.getByRole('menuitem', { name: 'Plugins' }).click()
    await page.waitForTimeout(2500)
    await shot('plugins')
    const pluginsPage = selector => page.evaluate(end => document.querySelectorAll('[class*=_page]').forEach(node => { node.scrollTop = end ? node.scrollHeight : 0 }), selector)
    await pluginsPage(true)
    await page.waitForTimeout(600)
    await shot('plugins-end')
    await pluginsPage(false)
    await page.locator('button.bt-account').click()
    await page.waitForTimeout(600)
    await page.getByRole('menuitem', { name: 'Switch to classic Agent mode' }).click()
    check(await waits(back, 10_000), 'classic Agent mode offers the way back to the team')
    await page.waitForTimeout(2000)
    await page.getByText('Omni', { exact: true }).first().click()
    await page.waitForTimeout(1500)
    await page.getByText('Writer', { exact: true }).first().click()
    await page.waitForTimeout(2500)
    await page.mouse.move(900, 450)
    await shot('sessions', { move: false })
    await back.click()
    check(await waits(page.locator('.bt-row').first(), 10_000), 'the way back returns to the team')
  }
} catch (error) {
  await page.screenshot({ path: join(outDir, '_stopped.png') }).catch(() => {})
  failures.push(`stopped: ${hideToken(error.message.split('\n')[0])}`)
  console.log(`FAIL stopped: ${hideToken(error.message.split('\n')[0])}`)
}

writeFileSync(join(outDir, mode === 'web' ? 'index.json' : 'desktop-index.json'), JSON.stringify({ screens: taken, failures }, null, 1))
await browser.close()
console.log(failures.length ? `ui shots (${mode}): ${taken.length} screens, ${failures.length} failed` : `ui shots (${mode}): ${taken.length} screens, all passed`)
process.exitCode = failures.length ? 1 : 0
