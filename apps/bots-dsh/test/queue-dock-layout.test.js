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
// #363: the goal bar (ui-goal), the todo panel and the Bot's side-question (btw) dock join it.
const sheetsOf = id => [...readFileSync(requireHarness.resolve(id), 'utf8').matchAll(/const css\$?\w* = ("(?:[^"\\]|\\.)*");/g)]
  .map(match => JSON.parse(match[1]))
const sheets = ['@deepseek-ai/dsh-client-ui-conversation/client', '@deepseek-ai/dsh-client-ui-goal/client'].flatMap(sheetsOf)
const sheet = (name, test) => {
  const css = sheets.find(test)
  assert.ok(css, `supported DSH ${name} CSS must be present`)
  return css
}
const inputCss = sheet('InputBar', css => /_card\{/.test(css) && /_placeholder\{/.test(css))
const rootCss = sheet('ConversationRoot', css => /_composerStack\{/.test(css) && /_composerSeat\{/.test(css))
const queueCss = sheet('QueueDock', css => /_dock\{box-sizing/.test(css) && /_panel\{isolation/.test(css))
const goalCss = sheet('GoalBar', css => /_dock\{box-sizing/.test(css) && /_objective\{/.test(css))
const todoCss = sheet('TodoPanel', css => /_root\{box-sizing/.test(css) && /_progress\{/.test(css))
const input = inputCss.match(/\.([\w]+)_card\{/)[1]
const root = rootCss.match(/\.([\w]+)_composerStack\{/)[1]
const queue = queueCss.match(/\.([\w]+)_dock\{box-sizing/)[1]
const goal = goalCss.match(/\.([\w]+)_dock\{box-sizing/)[1]
const todo = todoCss.match(/\.([\w]+)_root\{box-sizing/)[1]
const { outputFiles } = await build({
  stdin: { contents: "export { CONVERSATION_CSS } from './src/client/styles.js'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const botCss = module.exports.CONVERSATION_CSS
const without = (css, rules) => rules.reduce((rest, rule) => rest.replace(`${rule}\n`, ''), css)
const BOT_RULE = botCss.split('\n').find(line => line.includes('[data-queue-dock]'))
const BOT_DOCK_RULE = botCss.split('\n').find(line => line.includes('[data-goal-bar]'))
// dev before #91 and #363: the Bot sheet without the docks' axis rules.
const BOT_BASELINE = without(botCss, [BOT_RULE, BOT_DOCK_RULE])

const RULE = STAGE_CSS.split('\n').find(line => line.includes('[data-queue-dock]'))
const DOCK_RULE = STAGE_CSS.split('\n').find(line => line.includes('[data-goal-bar]'))
const BTW_RULE = STAGE_CSS.split('\n').find(line => line.startsWith('html body [class*="_composerStack"] [data-composer-dock]:has(.bt-btw)'))
// dev before #91 and #363: the same theme without the dock rules.
const BASELINE = without(STAGE_CSS, [RULE, DOCK_RULE, BTW_RULE])

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

test('the goal bar, the todo panel and the btw dock take the Stage cap less four insets (#363)', () => {
  const cap = 'max-width:calc(760px - 4*var(--dsh-composer-dock-inset,8px))'
  assert.equal(DOCK_RULE, 'html body [class*="_composerStack"] :is([data-goal-bar],[data-goal-bar]>*,'
    + `[data-testid="todo-panel"],[data-composer-dock]:has(.bt-btw),.bt-btw-dock){${cap}}`)
  assert.equal(BTW_RULE, 'html body [class*="_composerStack"] [data-composer-dock]:has(.bt-btw)'
    + '{width:calc(100% - 4*var(--dsh-composer-dock-inset,8px))}')
  for (const rule of [DOCK_RULE, BTW_RULE]) assert.doesNotMatch(rule, /margin|padding|height|translate/, 'native seams and heights stay')
  // Per-dock rules, not a variable override: the hero shell, the hero stack and the composer
  // notice read --dsh-composer-card-max-width too, and keep DSH's value.
  assert.doesNotMatch(STAGE_CSS, /--dsh-composer-card-max-width\s*:/)
  assert.equal(BOT_DOCK_RULE, '[class*="_composerStack"]:has([class*="_root"]>[data-composer-card]) '
    + ':is([data-goal-bar],[data-testid="todo-panel"]){width:calc(100% - 27px - 4*var(--dsh-composer-dock-inset,8px));translate:2.5px 0}')
  assert.doesNotMatch(BOT_DOCK_RULE, /margin|max-width|!important/)
  // The hooks are DSH's own markup: GoalBar's data-goal-bar, TodoPanel's data-testid.
  assert.match(readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-goal/client'), 'utf8'), /"data-goal-bar": true/)
  assert.match(readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8'), /"data-testid": "todo-panel"/)
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
  // #363: the todo panel (order 0) and the goal bar (order 10) above the queue (order 20), as
  // DSH's input-dock slot orders them; a Bot's btw card in the composer dock under the card.
  const todoPanel = `<section class="${c(todo, 'root')}" data-testid="todo-panel" aria-label="Todos"><div class="${c(todo, 'body')}">
      <button type="button" class="${c(todo, 'header')}" aria-expanded="false"><span class="${c(todo, 'title')}">Todos</span>
      <span class="${c(todo, 'progress')}">1 of 3 done</span></button></div></section>`
  const goalBar = `<div class="${c(goal, 'dock')}" data-goal-bar><div class="${c(goal, 'bar')}">
      <span class="${c(goal, 'label')}">Goal</span><span class="${c(goal, 'objective')}">Ship the dock fix</span>
      <div class="${c(goal, 'actions')}"><button type="button" class="${c(goal, 'iconBtn')}" aria-label="Clear goal" ${hits}>×</button></div>
    </div></div>`
  const btwDock = `<div class="${c(input, 'dock')}" data-composer-dock><div data-slot="conversation.composer.dock" style="display:contents">
      <div class="bt-btw-dock"><div class="bt-btw bt-btw-compact"><div class="bt-btw-head">
        <button type="button" class="bt-btw-toggle" aria-expanded="false"><span class="bt-btw-q">A side question</span></button>
      </div></div></div></div><span>Context meter</span></div>`
  // A btw card shows only in advanced mode (styles.js hides the composer dock otherwise).
  return `${bot ? '<body data-bt-advanced>' : ''}<style>
    :root{--dsh-composer-text-max-height:240px;--dsw-font-family:Arial;--dsw-radius-lg:12px;--dsw-radius-md:8px;
      --dsw-radius-sm:6px;--dsw-radius-panel:20px;--dsw-specific-menu:#fffdf9;--dsw-alias-bg-base:#f6eee2;
      --dsw-alias-border-l1:rgba(60,48,73,.13)}
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{--vw:100vw}
    ${rootCss}\n${inputCss}\n${queueCss}\n${goalCss}\n${todoCss}\n${bot ? botSheet : ''}\n${stage}
  </style><div class="${c(root, 'root')}" data-phase="active">
    <div class="${c(root, 'body')}${embedded ? ` ${c(root, 'embeddedBody')}` : ''}" data-conversation-content data-content-phase="active"
      style="${style.join(';')}">
      <div class="${c(root, 'scrollBody')}" data-conversation-scroll>
        <div data-slot="conversation.session" style="display:contents"><div class="${c(root, 'viewArea')}">Transcript</div></div>
        <div class="${c(root, 'composerSeat')}" data-composer-seat><div class="${c(root, 'composerStack')}">
          <div data-slot="conversation.input.dock" style="display:contents">${todoPanel}${goalBar}
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
            </div>${bot ? btwDock : ''}
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
    // #363: the visible box of each other dock (the goal bar, the todo panel, the btw card) and
    // the btw dock that holds the card.
    const goalBar = document.querySelector('[data-goal-bar]').firstElementChild
    const btwDock = document.querySelector('[data-composer-dock]')
    const btwCard = document.querySelector('.bt-btw')
    return {
      card: c, dock: box(dock), panel: box(panel),
      goal: box(goalBar), todo: box(document.querySelector('[data-testid="todo-panel"]')),
      btwDock: btwDock && box(btwDock), btw: btwCard && box(btwCard),
      cornerPeek: corner.some(el => el !== null && panel.contains(el)),
      panelRadius: getComputedStyle(panel).borderTopLeftRadius,
      viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    }
  })
}

const report = m => `card ${m.card.w}px @${m.card.x}, dock ${m.dock.w}px, panel ${m.panel.w}px @${m.panel.x}; `
  + `inset L ${(m.panel.x - m.card.x).toFixed(1)} R ${(m.card.r - m.panel.r).toFixed(1)}, `
  + `axis Δ ${Math.abs((m.panel.x + m.panel.r) / 2 - (m.card.x + m.card.r) / 2).toFixed(2)}, `
  + `seam ${(m.panel.b - m.card.y).toFixed(1)}px under the card, corner peek ${m.cornerPeek}; `
  + otherDocks(m).map(([name, part]) => `${name} ${part.w}px inset L ${(part.x - m.card.x).toFixed(1)} R ${(m.card.r - part.r).toFixed(1)}`).join(', ')

// #363: the docks that size from the native card variable besides the queue: [name, visible box].
const otherDocks = m => [['goal', m.goal], ['todo', m.todo], ...(m.btw ? [['btw', m.btw]] : [])]

const CASES = [
  { name: '390px', viewport: { width: 390, height: 720 } },
  { name: '1200px', viewport: { width: 1200, height: 720 }, wide: true },
  { name: '1440px', viewport: { width: 1440, height: 900 }, wide: true },
  // DSH's narrowest column (680px): the variable is under the card, and boxes still reading it
  // would sit 40px inside the card, not 16px.
  { name: '1200px, narrow column (680px)', viewport: { width: 1200, height: 720 }, userWidth: 680, narrow: true },
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
        // #363: dev's goal bar, todo panel and btw card follow the variable, not the card.
        // A Bot chat ignores the user width (styles.js sets its content width to min(960px,100%)),
        // so its variable is 992px even in the narrow column.
        for (const [name, part] of otherDocks(m)) {
          if (shape.wide || (shape.narrow && bot)) assert.ok(part.x < m.card.x && part.r > m.card.r, `dev's ${name} is wider than the Stage card`)
          if (shape.narrow && !bot) assert.ok(part.x - m.card.x > 16.5 && m.card.r - part.r > 16.5, `dev's ${name} sits further in than 16px`)
        }
        if (bot) assert.equal(Math.abs((m.goal.x + m.goal.r) / 2 - (m.card.x + m.card.r) / 2), 2.5, 'dev\'s Bot card is off the goal axis')
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
          // (3b) #363: the goal bar, the todo panel and the btw card share the card's axis, 16px
          // inside each edge and under the Stage cap, in DSH's order with no overlap.
          for (const [name, part] of otherDocks(m)) {
            if (name === 'btw' && shape.stage !== undefined) continue // the btw cap is the Stage theme's
            assert.ok(Math.abs((part.x + part.r) / 2 - (m.card.x + m.card.r) / 2) <= 0.5, `${name} and card share one axis`)
            assert.ok(Math.abs(part.x - m.card.x - 16) <= 0.5 && Math.abs(m.card.r - part.r - 16) <= 0.5,
              `${name} sits 16px inside each card edge, got ${part.x - m.card.x}/${m.card.r - part.r}`)
            if (shape.stage === undefined) assert.ok(part.w <= 744.5, `${name} never exceeds the Stage cap less its insets`)
            assert.ok(part.x >= 0 && part.r <= m.viewport.w + 0.5 && part.y >= 0 && part.b <= m.viewport.h + 0.5, `${name} is inside the viewport`)
            const hit = await page.evaluate(({ x, y, name }) => {
              const el = document.elementFromPoint(x, y)
              return el?.closest({ goal: '[data-goal-bar]', todo: '[data-testid="todo-panel"]', btw: '.bt-btw' }[name]) != null
            }, { x: part.x + part.w / 2, y: part.y + part.h / 2, name })
            assert.ok(hit, `${name} is painted on top, not covered`)
          }
          assert.ok(m.todo.b <= m.goal.y + 0.5 && m.goal.b <= m.dock.y + 0.5, 'todo, goal and queue stack without overlap')
          if (m.btw) assert.ok(m.btwDock.y >= m.card.b - 0.5, 'the btw dock sits under the card')
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
