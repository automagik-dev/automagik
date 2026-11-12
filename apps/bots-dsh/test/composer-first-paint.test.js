import { nativeCss } from './native-css.js'
// #322: a Bot's composer card must have its settled height on its first paint. DSH paints the
// card before it mounts any input slot (its controls row is empty for a few frames), so the
// Stage rules key on the conversation group's page marker, not on the "+" inside the card,
// and the tools group holds a one-control floor. Laid out in headless Chrome under the pinned
// DSH InputBar CSS, CONVERSATION_CSS and STAGE_CSS, as in test/composer-layout.test.js.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { CONVERSATION_MARK, STAGE_CSS, markConversation } from '../src/client/stage.js'
import { browserGuard } from './browser-guard.js'

const requireHarness = createRequire(new URL('../dev/harness/package.json', import.meta.url))
const nativeBundle = readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const hostCss = nativeCss(nativeBundle).find(css => /_card\{/.test(css) && /_placeholder\{/.test(css))
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

const FLOOR = 'gap:6px;min-width:28px;min-height:28px}'
// The same sheet without the floor: what the marker alone gives the first paint.
const UNFLOORED = STAGE_CSS.replace(FLOOR, 'gap:6px}')

test('the conversation group marks the page; the tools group holds a floor, never a height', () => {
  const tools = STAGE_CSS.split('\n').filter(rule => rule.startsWith(`html[${CONVERSATION_MARK}] body`) && rule.includes('[class*="_tools"]'))
  assert.equal(tools.length, 1)
  assert.ok(tools[0].endsWith(FLOOR), `the tools group keeps the box of the "+" it will hold: ${tools[0]}`)
  assert.notEqual(UNFLOORED, STAGE_CSS)
  for (const rule of STAGE_CSS.split('\n').filter(rule => rule.startsWith(`html[${CONVERSATION_MARK}]`))) {
    assert.doesNotMatch(rule, /(^|[;{])(max-)?height:/, `no fixed or capped height: ${rule}`)
  }
  const attributes = new Map()
  const root = { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) }
  const unmark = markConversation(root)
  assert.equal(attributes.get(CONVERSATION_MARK), '', 'mounting the group marks the page')
  unmark()
  assert.equal(attributes.has(CONVERSATION_MARK), false, 'withdrawing the group clears the mark')
  // The group's first step, so the mark is on before the composer's CSS and slots and off last.
  const index = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  assert.match(index, /const installConversation = \(\) => \[\n(\s*\/\/.*\n)*\s*\(\) => markConversation\(\),/)
})

// A Bot chat's composer card. `controls` false is DSH's first paint: the card is up, its input
// slots are not, so the tools group and the trailing group hold nothing that shows.
function fixture({ marked = true, controls = true, stage = STAGE_CSS, tall = false } = {}) {
  const cls = name => `${prefix}_${name}`
  return `${marked ? `<html ${CONVERSATION_MARK}>` : ''}<style>
    :root{--dsh-composer-card-max-width:748px;--dsh-composer-text-max-height:240px;--dsw-font-family:Arial}
    *{box-sizing:border-box}body{margin:0}main{height:600px;display:flex;flex-direction:column;justify-content:flex-end;padding:16px}
    ${hostCss}\n${botCss}\n${stage}
  </style><main><div class="${cls('root')} fixture_composerStack">
    <div data-composer-card class="${cls('card')}">
      <div data-slot="conversation.input.attachments"></div>
      <div data-input-scroll class="${cls('scroll')}"><div class="${cls('grow')}">
        <div contenteditable="true" role="textbox" data-composer-input class="${cls('input')}"><p><br></p></div>
        <div data-composer-placeholder class="${cls('placeholder')}">Message Omni</div>
      </div></div>
      <div class="${cls('row')}"><div class="${cls('tools')}"><button class="${cls('add')}" aria-label="Attach files">+</button><input type="file" hidden><div class="${cls('modes')}"></div>${controls ? `<button class="bt-plus" aria-label="Add">+</button>${tall ? '<button style="height:44px">Tall</button>' : ''}` : ''}</div>
        <div class="${cls('trailing')}"><div class="${cls('standardControls')}">${controls ? '<div data-slot="conversation.input.right"><button class="bt-mic" aria-label="Dictate">m</button><button class="bt-voice" aria-label="Voice">v</button></div><span>DeepSeek Flash</span>' : ''}<button class="${cls('primary')}" aria-label="Send" disabled>↑</button></div></div>
      </div>
    </div></div><footer>Footer</footer></main>`
}

test('the Bot composer card has its settled height on first paint', async t => {
  // CI must run the browser half (#323, #364): the shared guard fails there, never skips.
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const card = page.locator('[data-composer-card]')
  const height = async () => (await card.boundingBox()).height
  const evidence = process.env.COMPOSER_EVIDENCE_DIR
  for (const width of [390, 1200]) {
    await t.test(`first paint equals the settled card at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 720 })
      await page.setContent(fixture())
      const settled = await height()
      // Failing-before directions: a card waiting for an in-card marker (dev's :has(.bt-plus))
      // paints single-row, and the marker without the floor paints an empty second row.
      await page.setContent(fixture({ marked: false, controls: false }))
      const unmarked = await height()
      await page.setContent(fixture({ controls: false, stage: UNFLOORED }))
      const unfloored = await height()
      // The first paint, then DSH mounts the input slots in the same page.
      await page.setContent(fixture({ controls: false }))
      const first = await height()
      if (width === 390 && evidence) await page.screenshot({ path: `${evidence}/first-paint-390.png` })
      await page.locator(`.${prefix}_tools`).evaluate(el => el.insertAdjacentHTML('beforeend', '<button class="bt-plus" aria-label="Add">+</button>'))
      await page.locator(`.${prefix}_standardControls`).evaluate(el => el.insertAdjacentHTML('afterbegin', '<div data-slot="conversation.input.right"><button class="bt-mic" aria-label="Dictate">m</button><button class="bt-voice" aria-label="Voice">v</button></div><span>DeepSeek Flash</span>'))
      const mounted = await height()
      if (width === 390 && evidence) await page.screenshot({ path: `${evidence}/settled-390.png` })
      t.diagnostic(`${width}px: no marker ${unmarked}px, marker without floor ${unfloored}px, first paint ${first}px, slots mounted ${mounted}px, settled ${settled}px`)
      assert.ok(settled - unmarked > 20, `without the marker the first paint is single-row (${unmarked}px vs ${settled}px)`)
      assert.ok(settled - unfloored > 20, `without the floor the first paint has an empty second row (${unfloored}px vs ${settled}px)`)
      assert.ok(Math.abs(first - settled) <= 1, `first paint ${first}px must equal the settled ${settled}px`)
      assert.ok(Math.abs(mounted - first) <= 1, `mounting the input slots must not move the card (${first}px to ${mounted}px)`)
      assert.equal(await card.evaluate(el => getComputedStyle(el).flexWrap), 'wrap', 'the Stage two-row rules apply on first paint')
    })
    await t.test(`a floor, not a height: taller content still grows at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 720 })
      await page.setContent(fixture())
      const settled = await height()
      await page.setContent(fixture({ controls: false }))
      await page.locator('[data-composer-input]').fill('First line\nSecond line\nThird line\nFourth line')
      const multiline = await height()
      await page.locator('[data-slot="conversation.input.attachments"]').evaluate(el => { el.innerHTML = '<button style="height:36px">attachment.png ×</button>' })
      const attached = await height()
      await page.setContent(fixture({ tall: true }))
      const tall = await height()
      t.diagnostic(`${width}px: first paint with a four-line draft ${multiline}px, plus an attachment ${attached}px; a 44px control ${tall}px`)
      assert.ok(multiline > settled + 20, `a longer draft grows the first-paint card (${settled}px to ${multiline}px)`)
      assert.ok(attached > multiline + 20, `an attachment grows it again (${multiline}px to ${attached}px)`)
      assert.ok(tall >= settled + 15, `a control taller than the floor grows the row (${settled}px to ${tall}px)`)
      const footer = await page.locator('footer').boundingBox()
      const box = await card.boundingBox()
      assert.ok(footer.y >= box.y + box.height - 1, 'footer stays below the grown card')
    })
  }
})
