import { nativeCss } from './native-css.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { CONVERSATION_MARK, STAGE_CSS } from '../src/client/stage.js'
import { browserGuard } from './browser-guard.js'

// Requires the dev/harness dependency install; reads its supported DSH InputBar CSS,
// not a second layout model. This does not inspect or modify the installed GUI.
const requireHarness = createRequire(new URL('../dev/harness/package.json', import.meta.url))
const nativeBundle = readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const hostCss = nativeCss(nativeBundle).find(css => /_card\{/.test(css) && /_placeholder\{/.test(css))
assert.ok(hostCss, 'supported DSH InputBar CSS must be present')
const prefix = hostCss.match(/\.([\w]+)_card\{/)[1]
const { outputFiles } = await build({
  stdin: { contents: "export { CONVERSATION_CSS } from './src/client/styles.js'; export { MODEL_CSS } from './src/client/model-menu.js'; export { COMPOSER_PACK_CSS } from './src/client/composer-pack-cells.js'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const botCss = module.exports.CONVERSATION_CSS
const { MODEL_CSS, COMPOSER_PACK_CSS } = module.exports

// This is a layout fixture, NOT an end-to-end replacement for the shell's editor.
// Bot mode's conversation group marks the page and installs CONVERSATION_CSS and ComposerPlus;
// a native wish mounts no conversation group, so it has none of the three.
function fixture(bot, running, stage = STAGE_CSS, hero = false) {
  const cls = name => `${prefix}_${name}`
  return `${bot ? `<html ${CONVERSATION_MARK}>` : ''}<style>
    :root{--dsh-composer-card-max-width:748px;--dsh-composer-text-max-height:240px;--dsw-font-family:Arial}
    *{box-sizing:border-box}body{margin:0}main{height:600px;display:flex;flex-direction:column;justify-content:flex-end;padding:16px}
    ${hostCss}\n${bot ? botCss : ''}\n${stage}
  </style><main><aside>To-dos · Ongoing Goal</aside><div class="${cls('root')}${hero ? ` ${cls('hero')}` : ''} fixture_composerStack">
    <div data-composer-card class="${cls('card')}">
      <div data-slot="conversation.input.attachments"></div>
      <div data-input-scroll class="${cls('scroll')}"><div class="${cls('grow')}">
        <div contenteditable="true" role="textbox" data-composer-input class="${cls('input')}"><p><br></p></div>
        <div data-composer-placeholder class="${cls('placeholder')}">Message the wish thread</div>
      </div></div>
      <div class="${cls('row')}"><div class="${cls('tools')}">
        ${bot ? '<button class="bt-plus">+</button>' : '<button>Attach files</button><button>Workspace</button>'}
      </div><div class="${cls('trailing')}"><span>GPT-6.1 Sol High</span>
        <button class="${cls('primary')}" aria-label="${running ? 'Stop' : 'Send'}">${running ? '■' : '↑'}</button>
      </div></div>
    </div></div><footer>Footer</footer></main>`
}

// dev before #88: the same six rules without the marker.
const MARKED = `html[${CONVERSATION_MARK}] body [data-composer-card][data-composer-card]`
const UNSCOPED = STAGE_CSS.replaceAll(MARKED, 'html body [data-composer-card][data-composer-card]')

test('all six structural stage rules require the Bot conversation group marker', () => {
  assert.equal(CONVERSATION_MARK, 'data-bt-conversation')
  assert.notEqual(UNSCOPED, STAGE_CSS)
  const structural = STAGE_CSS.split('\n').filter(rule => /^html(\[[^\]]+\])? body \[data-composer-card\]\[data-composer-card\]/.test(rule))
  assert.equal(structural.length, 6)
  for (const rule of structural) assert.ok(rule.startsWith(MARKED), rule)
  assert.doesNotMatch(STAGE_CSS, /:has\(\.bt-plus\)/, 'no structural rule waits for the "+" inside the card (#322)')
  assert.match(STAGE_CSS, /html body \[data-composer-card\]\{background:/, 'cosmetics remain available to native sessions')
})

test('stage leaves native wish geometry intact; Bot controls keep their two-row layout', async t => {
  // CI must run the browser half (#323, #364): the shared guard fails there, never skips.
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 720 })
    // Failing-before direction: the same native fixture under dev's unscoped rules
    // reproduces #88, so the native assertions below can fail.
    for (const running of [false, true]) {
      await t.test(`unscoped rules inflate the native wish card (${running ? 'running' : 'idle'}, ${width}px)`, async () => {
        await page.setContent(fixture(false, running, UNSCOPED))
        const card = await page.locator('[data-composer-card]').boundingBox()
        const flex = await page.locator('[data-input-scroll]').evaluate(el => getComputedStyle(el).flexGrow)
        t.diagnostic(`unscoped wish ${width}px ${running ? 'running' : 'idle'}: empty card ${card.height}px, flex-grow ${flex}`)
        assert.equal(flex, '1', 'dev rules give the native column the Bot row flex growth')
        assert.ok(card.height >= 160, `dev rules inflate the empty native card, got ${card.height}px`)
      })
    }
    for (const bot of [false, true]) for (const running of [false, true]) {
      await t.test(`${bot ? 'Bot' : 'wish'} ${running ? 'running' : 'idle'} at ${width}px`, async () => {
        await page.setContent(fixture(bot, running))
        const card = page.locator('[data-composer-card]')
        const editor = page.locator('[data-composer-input]')
        const before = await card.boundingBox()
        const assertGeometry = async () => {
          const box = await card.boundingBox()
          const footer = await page.locator('footer').boundingBox()
          assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'card fits the viewport')
          assert.ok(box.width <= 761, 'shared Stage card width cap remains intact')
          assert.ok(footer.y >= box.y + box.height - 1, 'footer stays below the card')
          assert.ok(footer.y + footer.height <= 720, 'footer remains in the viewport')
          const control = await page.getByRole('button', { name: running ? 'Stop' : 'Send', exact: true }).boundingBox()
          assert.ok(control.x >= box.x && control.x + control.width <= box.x + box.width + 1, 'send/stop fits horizontally')
          assert.ok(control.y >= box.y && control.y + control.height <= box.y + box.height + 1, 'send/stop fits vertically')
        }
        await assertGeometry()
        if (!bot && running && process.env.COMPOSER_EVIDENCE_DIR) {
          await page.screenshot({ path: `${process.env.COMPOSER_EVIDENCE_DIR}/wish-running-${width}.png` })
        }
        assert.ok(before.height < 160, `empty card must be content-sized, got ${before.height}px`)
        const flex = await page.locator('[data-input-scroll]').evaluate(el => getComputedStyle(el).flexGrow)
        assert.equal(flex, bot ? '1' : '0', 'native column must not inherit Bot row flex growth')
        const primary = page.getByRole('button', { name: running ? 'Stop' : 'Send', exact: true })
        await primary.click()
        assert.ok(await primary.isVisible())
        const control = await primary.boundingBox()
        assert.ok(control.x >= before.x && control.x + control.width <= before.x + before.width + 1, 'send/stop stays within card')
        assert.equal(await card.evaluate(el => getComputedStyle(el).flexDirection), bot ? 'row' : 'column')
        if (!bot) {
          const scroll = await page.locator('[data-input-scroll]').boundingBox()
          assert.ok(scroll.width >= before.width - 16, 'native placeholder/editor keep the full column width')
        }
        t.diagnostic(`${bot ? 'Bot' : 'wish'} ${width}px ${running ? 'running' : 'idle'}: empty card ${before.height}px`)
        const tools = await page.locator(`.${prefix}_tools`).boundingBox()
        const input = await editor.boundingBox()
        assert.ok(tools.y >= input.y + input.height - 1, 'controls remain below the editor')
        await editor.fill('First line\nSecond line\nThird line\nFourth line')
        const multiline = (await card.boundingBox()).height
        assert.ok(multiline > before.height, 'multiline grows naturally')
        await assertGeometry()
        await page.locator('[data-slot="conversation.input.attachments"]').evaluate(el => {
          el.innerHTML = '<button style="height:36px">attachment.png ×</button>'
        })
        const attachment = await page.getByRole('button', { name: 'attachment.png ×' }).boundingBox()
        const withAttachment = (await card.boundingBox()).height
        t.diagnostic(`${bot ? 'Bot' : 'wish'} ${width}px ${running ? 'running' : 'idle'}: multiline ${multiline}px, with attachment ${withAttachment}px`)
        assert.ok(attachment.y < (await editor.boundingBox()).y, 'attachments stay above the draft')
        await assertGeometry()
        // Explicit inline heights model user sizing, not the native drag-resize handler.
        for (const height of [80, 180, 220]) {
          await editor.evaluate((el, height) => { el.style.height = `${height}px` }, height)
          assert.equal(Math.round((await editor.boundingBox()).height), height)
          await editor.fill('Still editing')
          assert.equal(Math.round((await editor.boundingBox()).height), height)
          await assertGeometry()
        }
      })
    }
  }
  // DSH's welcome composer is the same column at variant="hero", where its own sheet floors
  // the draft at 52px; the Bot rules forced 40px and the row growth on it as well.
  for (const width of [390, 1200]) {
    await t.test(`native hero composer keeps its own draft floor at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 720 })
      const editor = page.locator('[data-composer-input]')
      const scroll = page.locator('[data-input-scroll]')
      await page.setContent(fixture(false, false, UNSCOPED, true))
      assert.equal(await editor.evaluate(el => getComputedStyle(el).minHeight), '40px', 'dev rules floor the hero draft')
      assert.equal(await scroll.evaluate(el => getComputedStyle(el).flexGrow), '1', 'dev rules grow the hero draft by height')
      t.diagnostic(`unscoped hero ${width}px: empty card ${(await page.locator('[data-composer-card]').boundingBox()).height}px, draft floor 40px`)
      await page.setContent(fixture(false, false, STAGE_CSS, true))
      const card = page.locator('[data-composer-card]')
      const before = await card.boundingBox()
      assert.equal(await editor.evaluate(el => getComputedStyle(el).minHeight), '52px', 'the hero keeps DSH\'s draft floor')
      assert.equal(await scroll.evaluate(el => getComputedStyle(el).flexGrow), '0')
      assert.ok(before.height < 160, `empty hero must be content-sized, got ${before.height}px`)
      assert.ok((await scroll.boundingBox()).width >= before.width - 16, 'the hero draft keeps the full column width')
      const footer = await page.locator('footer').boundingBox()
      assert.ok(footer.y >= before.y + before.height - 1, 'footer stays below the hero card')
      await editor.fill('First line\nSecond line\nThird line\nFourth line')
      const multiline = (await card.boundingBox()).height
      assert.ok(multiline > before.height, 'the hero grows with the draft')
      t.diagnostic(`hero ${width}px: empty card ${before.height}px, multiline ${multiline}px`)
    })
  }
})

// The Bot's model in its composer (composer-pack-cells.js), where DSH seats its model cell: in
// the trailing group, beside the voice button and send. A Bot's composer flattens DSH's control
// row (display:contents), so DSH's compact switch, which measures that row, always fires; the
// model's name and level must still show, and a long name must end in an ellipsis in the card.
function modelFixture(name, chatWidth) {
  const cls = part => `${prefix}_${part}`
  return `<html ${CONVERSATION_MARK}><style>
    :root{--dsh-composer-card-max-width:748px;--dsh-composer-text-max-height:240px;--dsw-font-family:Arial}
    *{box-sizing:border-box}body{margin:0;display:flex;justify-content:flex-end}main{width:${chatWidth}px;height:600px;display:flex;flex-direction:column;justify-content:flex-end;padding:16px}
    ${hostCss}\n${botCss}\n${STAGE_CSS}\n${MODEL_CSS}\n${COMPOSER_PACK_CSS}
  </style><main><div class="${cls('root')} fixture_composerStack"><div data-composer-card class="${cls('card')}">
    <div data-slot="conversation.input.attachments"></div>
    <div data-input-scroll class="${cls('scroll')}"><div class="${cls('grow')}">
      <div contenteditable="true" role="textbox" data-composer-input class="${cls('input')}"><p><br></p></div>
      <div data-composer-placeholder class="${cls('placeholder')}">Message</div>
    </div></div>
    <div class="${cls('row')}"><div class="${cls('tools')}"><button class="bt-plus">+</button></div>
      <div class="${cls('trailing')}"><div class="${cls('standardControls')}"><button class="bt-mic">m</button>
        <span class="bt-composer-model" data-pack="model"><button type="button" class="bt-model-trigger" aria-label="Model"><span class="bt-model-copy">
          <span class="bt-model-name">${name}</span><span class="bt-model-provider">DeepSeek · High</span></span><svg class="bt-model-caret" width="16" height="16"></svg></button></span></div>
        <button class="${cls('primary')}" aria-label="Send">↑</button></div></div>
  </div></div></main></html>`
}

// DSH's own rule (observeControlRow): compact when the row's children outgrow the row's width.
const measureRow = () => {
  const row = document.querySelector('[class*="_row"]')
  row.removeAttribute('data-model-compact')
  const style = getComputedStyle(row)
  const available = row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const widths = Array.from(row.children, child => child.getBoundingClientRect().width).filter(width => width > 0)
  const needed = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * parseFloat(style.columnGap)
  row.toggleAttribute('data-model-compact', needed > available)
}

test('a Bot\'s composer shows its model\'s name and level, and a long name fits the card', async t => {
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setViewportSize({ width: 720, height: 720 })
  const long = 'Claude Opus 5.5 with an extended context window (1M tokens) preview'
  for (const chatWidth of [720, 460, 360]) for (const name of ['DeepSeek V4', long]) {
    await page.setContent(modelFixture(name, chatWidth))
    await page.evaluate(measureRow)
    const shown = await page.evaluate(() => {
      const box = el => document.querySelector(el).getBoundingClientRect()
      const copy = document.querySelector('.bt-model-copy')
      const label = document.querySelector('.bt-model-name')
      return {
        copy: getComputedStyle(copy).display, nameWidth: box('.bt-model-name').width, card: box('[data-composer-card]').toJSON(),
        trigger: box('.bt-model-trigger').toJSON(), send: box('[aria-label="Send"]').toJSON(),
        clipped: label.scrollWidth > label.clientWidth, page: document.documentElement.scrollWidth,
      }
    })
    t.diagnostic(`${chatWidth}px, ${name.length} chars: name ${Math.round(shown.nameWidth)}px, clipped ${shown.clipped}`)
    assert.notEqual(shown.copy, 'none', 'the model\'s name and level show')
    assert.ok(shown.nameWidth > 0)
    assert.ok(shown.trigger.left >= shown.card.left && shown.trigger.right <= shown.card.right + 1, 'the model fits the card')
    assert.ok(shown.send.right <= shown.card.right + 1, 'send stays in the card')
    assert.ok(shown.page <= 720, 'no sideways scroll')
    if (name === long && chatWidth < 720) assert.ok(shown.clipped, 'a long name ends in an ellipsis')
  }
})
