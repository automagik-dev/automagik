import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { STAGE_CSS } from '../src/client/stage.js'

// Requires the dev/harness dependency install; reads its supported DSH InputBar CSS,
// not a second layout model. This does not inspect or modify the installed GUI.
const requireHarness = createRequire(new URL('../dev/harness/package.json', import.meta.url))
const nativeBundle = readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const hostCss = [...nativeBundle.matchAll(/const css\$?\w* = ("(?:[^"\\]|\\.)*");/g)]
  .map(match => JSON.parse(match[1])).find(css => /_card\{/.test(css) && /_placeholder\{/.test(css))
assert.ok(hostCss, 'supported DSH InputBar CSS must be present')
const prefix = hostCss.match(/\.([\w]+)_card\{/)[1]
const { outputFiles } = await build({
  stdin: { contents: "export { CONVERSATION_CSS } from './src/client/styles.js'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const botCss = module.exports.CONVERSATION_CSS
const executablePath = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium')

// This is a layout fixture, NOT an end-to-end replacement for the shell's editor.
// Bot mode installs CONVERSATION_CSS and ComposerPlus; a native wish installs neither.
function fixture(bot, running, stage = STAGE_CSS) {
  const cls = name => `${prefix}_${name}`
  return `<style>
    :root{--dsh-composer-card-max-width:748px;--dsh-composer-text-max-height:240px;--dsw-font-family:Arial}
    *{box-sizing:border-box}body{margin:0}main{height:600px;display:flex;flex-direction:column;justify-content:flex-end;padding:16px}
    ${hostCss}\n${bot ? botCss : ''}\n${stage}
  </style><main><aside>To-dos · Ongoing Goal</aside><div class="${cls('root')} fixture_composerStack">
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
const UNSCOPED = STAGE_CSS.replaceAll(':has(.bt-plus)', '')

test('all six structural stage rules require the Bot composer ownership marker', () => {
  assert.notEqual(UNSCOPED, STAGE_CSS)
  const structural = STAGE_CSS.split('\n').filter(rule => rule.startsWith('html body [data-composer-card][data-composer-card]'))
  assert.equal(structural.length, 6)
  for (const rule of structural) assert.ok(rule.startsWith('html body [data-composer-card][data-composer-card]:has(.bt-plus)'), rule)
  assert.match(STAGE_CSS, /html body \[data-composer-card\]\{background:/, 'cosmetics remain available to native sessions')
})

test('stage leaves native wish geometry intact; Bot controls keep their two-row layout', async t => {
  if (!existsSync(executablePath)) return t.skip('Browser layout check requires CHROME_BIN; structural check still runs')
  let chromium
  try { ({ chromium } = await import('playwright-core')) } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    return t.skip('Browser layout check requires the root bun install (playwright-core)')
  }
  const browser = await chromium.launch({ executablePath, headless: true })
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
})
