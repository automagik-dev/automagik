import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { STAGE_CSS } from '../src/client/stage.js'
import { browserGuard } from './browser-guard.js'

// #91: DSH's queued-message dock under the Stage theme. Requires the dev/harness install;
// reads the supported DSH InputBar, ConversationRoot and QueueDock CSS, not a second layout
// model. This does not inspect or modify the installed GUI.
const requireHarness = createRequire(new URL('../dev/harness/package.json', import.meta.url))
const nativeBundle = readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const sheets = [...nativeBundle.matchAll(/const css\$?\w* = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1]))
const sheet = (name, test) => {
  const css = sheets.find(test)
  assert.ok(css, `supported DSH ${name} CSS must be present`)
  return css
}
const inputCss = sheet('InputBar', css => /_card\{/.test(css) && /_placeholder\{/.test(css))
const rootCss = sheet('ConversationRoot', css => /_composerStack\{/.test(css) && /_composerSeat\{/.test(css))
const queueCss = sheet('QueueDock', css => /_dock\{box-sizing/.test(css) && /_panel\{isolation/.test(css))
const input = inputCss.match(/\.([\w]+)_card\{/)[1]
const root = rootCss.match(/\.([\w]+)_composerStack\{/)[1]
const queue = queueCss.match(/\.([\w]+)_dock\{box-sizing/)[1]
const { outputFiles } = await build({
  stdin: { contents: "export { CONVERSATION_CSS } from './src/client/styles.js'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const botCss = module.exports.CONVERSATION_CSS
const BOT_RULE = botCss.split('\n').find(line => line.includes('[data-queue-dock]'))
// dev before #91: the Bot sheet without the dock's axis rule.
const BOT_BASELINE = botCss.replace(`${BOT_RULE}\n`, '')

const RULE = STAGE_CSS.split('\n').find(line => line.includes('[data-queue-dock]'))
// dev before #91: the same theme without the dock rule.
const BASELINE = STAGE_CSS.replace(`${RULE}\n`, '')

test('the queue dock takes the Stage card cap less its two native insets', () => {
  assert.notEqual(BASELINE, STAGE_CSS)
  assert.equal(RULE, 'html body [class*="_composerStack"] [data-queue-dock]'
    + '{max-width:calc(760px - 2*var(--dsh-composer-dock-inset,8px))!important}')
  const card = STAGE_CSS.split('\n').find(line => line.startsWith('html body [class*="_composerStack"] [data-composer-card]'))
  assert.match(card, /max-width:min\(760px,100%\)/, 'the dock cap follows the card cap')
  assert.equal(STAGE_CSS.split('\n').filter(line => line.includes('[data-queue-dock]')).length, 1)
  assert.doesNotMatch(RULE, /margin|padding|width:calc\(100%/, 'DSH keeps its own seam, padding and narrow width')
})

test('a Bot composer\'s queue dock follows the card in its 16/11 root', () => {
  assert.notEqual(BOT_BASELINE, botCss)
  assert.equal(BOT_RULE, '[class*="_composerStack"]:has([class*="_root"]>[data-composer-card]) [data-queue-dock]'
    + '{width:calc(100% - 27px - 2*var(--dsh-composer-dock-inset,8px));translate:2.5px 0}')
  assert.ok(botCss.includes('[class*="_root"]:has(> [data-composer-card]){padding:0 11px 13px 16px!important}'),
    'the rule\'s 27px and 2.5px follow the root\'s 16px + 11px padding')
  assert.doesNotMatch(BOT_RULE, /margin|max-width|!important/, 'the theme keeps its own cap and DSH its seam')
})

// A layout fixture, NOT the shell: the real nesting with DSH's display:contents slot outlets,
// and --dsh-conversation-column-width set inline where DSH sets it from a ResizeObserver.
function fixture({ bot, running, rows, stage, userWidth, embedded, botSheet = botCss }) {
  const c = (prefix, name) => `${prefix}_${name}`
  const hits = 'onclick="this.dataset.hits=(+this.dataset.hits||0)+1"'
  const row = index => `<li class="${c(queue, 'row')}">
      ${rows === 1 ? `<span class="${c(queue, 'lead')}" aria-hidden="true">≡</span>` : ''}
      <span class="${c(queue, 'preview')}">Queued follow-up ${index + 1}</span>
      <div class="${c(queue, 'actions')}">
        <button type="button" class="${c(queue, 'action')}" aria-label="Edit queued message" ${hits}>✎</button>
        <button type="button" class="${c(queue, 'action')}" aria-label="Remove queued message" ${hits}>×</button>
        <button type="button" class="${c(queue, 'action')}" aria-label="Steer queued message" ${hits}
          ${running ? '' : 'title="Steering is available only while the agent is running" disabled'}>➤</button>
      </div></li>`
  const header = rows > 1 ? `<button type="button" class="${c(queue, 'header')}" aria-expanded="true" ${hits}>
      <span class="${c(queue, 'lead')}">≡</span><span class="${c(queue, 'count')}">${rows} queued messages</span>
      <span class="${c(queue, 'chevron')}">⌄</span></button>` : ''
  const style = [`--dsh-conversation-column-width:var(--vw)`, userWidth ? `--dsh-chat-user-width:${userWidth}px` : '']
  return `<style>
    :root{--dsh-composer-text-max-height:240px;--dsw-font-family:Arial;--dsw-radius-lg:12px;--dsw-radius-md:8px;
      --dsw-radius-sm:6px;--dsw-radius-panel:20px;--dsw-specific-menu:#fffdf9;--dsw-alias-bg-base:#f6eee2;
      --dsw-alias-border-l1:rgba(60,48,73,.13)}
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{--vw:100vw}
    ${rootCss}\n${inputCss}\n${queueCss}\n${bot ? botSheet : ''}\n${stage}
  </style><div class="${c(root, 'root')}" data-phase="active">
    <div class="${c(root, 'body')}${embedded ? ` ${c(root, 'embeddedBody')}` : ''}" data-conversation-content data-content-phase="active"
      style="${style.join(';')}">
      <div class="${c(root, 'scrollBody')}" data-conversation-scroll>
        <div data-slot="conversation.session" style="display:contents"><div class="${c(root, 'viewArea')}">Transcript</div></div>
        <div class="${c(root, 'composerSeat')}" data-composer-seat><div class="${c(root, 'composerStack')}">
          <div data-slot="conversation.input.dock" style="display:contents">
            <div class="${c(queue, 'dock')}" data-queue-dock><div class="${c(queue, 'panel')}">${header}
              <ul class="${c(queue, 'list')}">${Array.from({ length: rows }, (_, index) => row(index)).join('')}</ul>
            </div></div>
          </div>
          <div data-slot="conversation.composer.bar" style="display:contents"><div class="${c(input, 'root')}">
            <div data-composer-card class="${c(input, 'card')}">
              <div data-slot="conversation.input.attachments"></div>
              <div data-input-scroll class="${c(input, 'scroll')}"><div class="${c(input, 'grow')}">
                <div contenteditable="true" role="textbox" data-composer-input class="${c(input, 'input')}"><p><br></p></div>
                <div data-composer-placeholder class="${c(input, 'placeholder')}">Message the thread</div>
              </div></div>
              <div class="${c(input, 'row')}"><div class="${c(input, 'tools')}">
                ${bot ? '<button class="bt-plus">+</button>' : '<button>Attach files</button><button>Workspace</button>'}
              </div><div class="${c(input, 'trailing')}"><span>Model</span>
                <button class="${c(input, 'primary')}" aria-label="${running ? 'Stop' : 'Send'}">${running ? '■' : '↑'}</button>
              </div></div>
            </div>
          </div></div>
        </div></div>
      </div>
    </div>
  </div>`
}

async function measure(page) {
  return page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } }
    const card = document.querySelector('[data-composer-card]')
    const dock = document.querySelector('[data-queue-dock]')
    const panel = dock.firstElementChild
    const c = box(card)
    // Chromium's hit test honours border-radius: just outside the card's rounded corner,
    // inside the panel's 3px seam, is where a wider panel shows past the card.
    const corner = [document.elementFromPoint(c.x + 3, c.y + 1), document.elementFromPoint(c.r - 3, c.y + 1)]
    return {
      card: c, dock: box(dock), panel: box(panel),
      cornerPeek: corner.some(el => el !== null && panel.contains(el)),
      panelRadius: getComputedStyle(panel).borderTopLeftRadius,
      viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    }
  })
}

const report = m => `card ${m.card.w}px @${m.card.x}, dock ${m.dock.w}px, panel ${m.panel.w}px @${m.panel.x}; `
  + `inset L ${(m.panel.x - m.card.x).toFixed(1)} R ${(m.card.r - m.panel.r).toFixed(1)}, `
  + `axis Δ ${Math.abs((m.panel.x + m.panel.r) / 2 - (m.card.x + m.card.r) / 2).toFixed(2)}, `
  + `seam ${(m.panel.b - m.card.y).toFixed(1)}px under the card, corner peek ${m.cornerPeek}`

const CASES = [
  { name: '390px', viewport: { width: 390, height: 720 } },
  { name: '1200px', viewport: { width: 1200, height: 720 }, wide: true },
  { name: '1200px, widened column (920px)', viewport: { width: 1200, height: 720 }, userWidth: 920, wide: true },
  { name: '1200px embedded', viewport: { width: 1200, height: 720 }, embedded: true, wide: true },
  { name: '1200px at 150% zoom', viewport: { width: 800, height: 480 }, deviceScaleFactor: 1.5 },
  // The Bot axis rule is theme-independent: a Bot chat under a theme with no composer cap.
  { name: '1200px, no theme', viewport: { width: 1200, height: 720 }, stage: '', botOnly: true },
]

test('the queued-message dock shares the Stage composer column without overlapping it', async t => {
  // CI must run the browser half (#364): the shared guard fails there, never skips.
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const evidence = process.env.QUEUE_EVIDENCE_DIR
  for (const shape of CASES) {
    const context = await browser.newContext({ viewport: shape.viewport, deviceScaleFactor: shape.deviceScaleFactor ?? 1 })
    const page = await context.newPage()
    const width = shape.viewport.width
    for (const bot of shape.botOnly ? [true] : [false, true]) for (const running of [false, true]) {
      const label = `${bot ? 'Bot' : 'native thread'} ${running ? 'running' : 'idle'} at ${shape.name}`
      const options = { bot, running, rows: 1, userWidth: shape.userWidth, embedded: shape.embedded }
      // Failing-before direction: dev's theme lets the dock follow the wider native card variable.
      await t.test(`before #91: ${label}`, async () => {
        await page.setContent(fixture({ ...options, stage: shape.stage ?? BASELINE, botSheet: BOT_BASELINE }))
        const m = await measure(page)
        t.diagnostic(`before ${label}: ${report(m)}`)
        if (evidence && !running) await page.screenshot({ path: `${evidence}/before-${bot ? 'bot' : 'native'}-${shape.name.replace(/\W+/g, '-')}.png` })
        if (shape.wide) {
          assert.ok(m.panel.x < m.card.x && m.panel.r > m.card.r, 'dev\'s queued panel is wider than the Stage card')
          assert.ok(m.cornerPeek, 'dev\'s queued panel shows past the card\'s rounded corners')
        }
        if (bot) assert.equal(Math.abs((m.panel.x + m.panel.r) / 2 - (m.card.x + m.card.r) / 2), 2.5, 'dev\'s Bot card is off the dock axis')
      })
      for (const rows of [1, 3]) {
        await t.test(`${label}, ${rows} queued`, async () => {
          await page.setContent(fixture({ ...options, rows, stage: shape.stage ?? BASELINE, botSheet: BOT_BASELINE }))
          const cardBefore = (await measure(page)).card
          await page.setContent(fixture({ ...options, rows, stage: shape.stage ?? STAGE_CSS }))
          const m = await measure(page)
          t.diagnostic(`after ${label}, ${rows} queued: ${report(m)}`)
          if (evidence && !running && rows === 3) await page.screenshot({ path: `${evidence}/after-${bot ? 'bot' : 'native'}-${shape.name.replace(/\W+/g, '-')}.png` })
          assert.deepEqual(m.card, cardBefore, 'the composer card itself is unchanged')
          // (1) one centred column: the panel sits 16px inside each card edge, as natively.
          assert.ok(Math.abs((m.panel.x + m.panel.r) / 2 - (m.card.x + m.card.r) / 2) <= 0.5, 'panel and card share one axis')
          assert.ok(Math.abs(m.panel.x - m.card.x - 16) <= 0.5 && Math.abs(m.card.r - m.panel.r - 16) <= 0.5,
            `panel sits 16px inside each card edge, got ${m.panel.x - m.card.x}/${m.card.r - m.panel.r}`)
          if (shape.stage === undefined) assert.ok(m.dock.w <= 744.5, 'the dock never exceeds the Stage cap less its insets')
          // (2) no overlap beyond DSH's own 3px seam under the card's top edge, and no peek.
          assert.ok(Math.abs(m.panel.b - m.card.y - 3) <= 0.5, `seam stays DSH's 3px, got ${m.panel.b - m.card.y}`)
          assert.equal(m.cornerPeek, false, 'the panel never shows past the card\'s rounded corners')
          // (3) inside the viewport, corners drawn and not clipped.
          for (const part of [m.card, m.dock, m.panel]) assert.ok(part.x >= 0 && part.r <= m.viewport.w + 0.5 && part.y >= 0 && part.b <= m.viewport.h + 0.5)
          assert.equal(m.panelRadius, '12px')
          const topLeft = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-queue-dock]') !== null,
            { x: m.panel.x + 6, y: m.panel.y + 6 })
          assert.ok(topLeft, 'the panel\'s top corner is painted, not covered')
          // (4) every row's actions are hit-testable and clickable; Steer only while running.
          assert.equal(await page.locator(`.${queue}_row`).count(), rows)
          if (rows > 1) await page.getByRole('button', { name: `${rows} queued messages` }).click()
          for (const name of ['Edit queued message', 'Remove queued message', 'Steer queued message']) {
            const buttons = page.getByRole('button', { name, exact: true })
            assert.equal(await buttons.count(), rows)
            for (let index = 0; index < rows; index++) {
              const button = buttons.nth(index)
              if (name.startsWith('Steer') && !running) { assert.ok(await button.isDisabled()); continue }
              const b = await button.boundingBox()
              assert.ok(b.x >= m.panel.x && b.x + b.width <= m.panel.r + 0.5 && b.y >= m.panel.y && b.y + b.height <= m.card.y + 0.5,
                `${name} ${index + 1} is inside the panel, above the card`)
              await button.click()
              assert.equal(await button.getAttribute('data-hits'), '1')
            }
          }
          // The composer keeps its own control.
          const primary = page.getByRole('button', { name: running ? 'Stop' : 'Send', exact: true })
          await primary.click()
          const p = await primary.boundingBox()
          assert.ok(p.x >= m.card.x && p.x + p.width <= m.card.r + 0.5 && p.y >= m.card.y && p.y + p.height <= m.card.b + 0.5)
          assert.ok(m.card.r <= width + 0.5)
        })
      }
    }
    await context.close()
  }
})
