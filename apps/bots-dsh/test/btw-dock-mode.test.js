import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { STAGE_CSS } from '../src/client/stage.js'
import { browserGuard } from './browser-guard.js'

// #404: a Bot's side-question (btw) card never showed in simple mode. The composer dock is
// hidden there (it holds the context meter), and the hide rule outranked the show rule.
// Requires the dev/harness install; reads the supported DSH InputBar and ConversationRoot CSS.
const requireHarness = createRequire(new URL('../dev/harness/package.json', import.meta.url))
const sheetsOf = id => [...readFileSync(requireHarness.resolve(id), 'utf8').matchAll(/const css\$?\w* = ("(?:[^"\\]|\\.)*");/g)]
  .map(match => JSON.parse(match[1]))
const sheets = sheetsOf('@deepseek-ai/dsh-client-ui-conversation/client')
const sheet = (name, test) => {
  const css = sheets.find(test)
  assert.ok(css, `supported DSH ${name} CSS must be present`)
  return css
}
const inputCss = sheet('InputBar', css => /_card\{/.test(css) && /_placeholder\{/.test(css))
const rootCss = sheet('ConversationRoot', css => /_composerStack\{/.test(css) && /_composerSeat\{/.test(css))
const input = inputCss.match(/\.([\w]+)_card\{/)[1]
const root = rootCss.match(/\.([\w]+)_composerStack\{/)[1]
const { outputFiles } = await build({
  stdin: { contents: "export { CONVERSATION_CSS } from './src/client/styles.js'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const botCss = module.exports.CONVERSATION_CSS

// The real nesting (DSH's display:contents slot outlets), DSH's own sheets and the Bot's.
// `simple` is a Bot with the data-bt-advanced attribute absent, as installAdvancedStyle leaves
// it for a Bot without an Advanced control session.
function fixture({ advanced, btw }) {
  const c = (prefix, name) => `${prefix}_${name}`
  return `${advanced ? '<body data-bt-advanced>' : '<body>'}<style>
    :root{--dsh-composer-card-max-width:748px;--dsh-composer-text-max-height:240px;--dsw-font-family:Arial;--dsh-composer-dock-inset:8px}
    *{box-sizing:border-box}html,body{height:100%;margin:0}
    ${rootCss}\n${inputCss}\n${botCss}\n${STAGE_CSS}
  </style><div class="${c(root, 'root')}" data-phase="active">
    <div class="${c(root, 'body')}" data-conversation-content data-content-phase="active">
      <div class="${c(root, 'scrollBody')}" data-conversation-scroll>
        <div data-slot="conversation.session" style="display:contents"><div class="${c(root, 'viewArea')}">Transcript</div></div>
        <div class="${c(root, 'composerSeat')}" data-composer-seat><div class="${c(root, 'composerStack')}">
          <div data-slot="conversation.composer.bar" style="display:contents"><div class="${c(input, 'root')}">
            <div data-composer-card class="${c(input, 'card')}">
              <div data-slot="conversation.input.attachments"></div>
              <div data-input-scroll class="${c(input, 'scroll')}"><div class="${c(input, 'grow')}">
                <div contenteditable="true" role="textbox" data-composer-input class="${c(input, 'input')}"><p><br></p></div>
                <div data-composer-placeholder class="${c(input, 'placeholder')}">Message the thread</div>
              </div></div>
              <div class="${c(input, 'row')}"><div class="${c(input, 'tools')}"><button class="bt-plus">+</button></div>
                <div class="${c(input, 'trailing')}"><span>Model</span>
                  <button class="${c(input, 'primary')}" aria-label="Send">↑</button>
                </div></div>
            </div>
            <div class="${c(input, 'dock')}" data-composer-dock>
              <div data-slot="conversation.composer.dock" style="display:contents">${btw ? `<div class="bt-btw-dock"><div class="bt-btw bt-btw-compact"><div class="bt-btw-head">
                <button type="button" class="bt-btw-toggle" aria-expanded="false"><span class="bt-btw-q">A side question</span></button>
              </div></div></div>` : ''}</div><span class="${c(input, 'meter')}">Context meter</span></div>
          </div></div>
        </div></div>
      </div>
    </div>
  </div>`
}

async function measure(page) {
  return page.evaluate(() => {
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } }
    const dock = document.querySelector('[data-composer-dock]')
    const btw = document.querySelector('.bt-btw')
    const meter = dock.lastElementChild
    const centre = node => node && document.elementFromPoint((node.getBoundingClientRect().x + node.getBoundingClientRect().right) / 2,
      (node.getBoundingClientRect().y + node.getBoundingClientRect().bottom) / 2)
    return {
      dockDisplay: getComputedStyle(dock).display,
      dockCap: getComputedStyle(dock).maxWidth,
      card: box(document.querySelector('[data-composer-card]')),
      dock: box(dock), btw: box(btw),
      meterDisplay: getComputedStyle(meter).display,
      painted: btw ? (centre(btw)?.closest('.bt-btw') != null) : null,
    }
  })
}

const report = m => `dock ${m.dockDisplay}/${m.dockCap} ${m.dock?.w}px, card ${m.card.w}px @${m.card.x}, `
  + `btw ${m.btw ? `${m.btw.w}px @${m.btw.x} painted ${m.painted}` : 'absent'}, meter ${m.meterDisplay}`

test('a btw card shows in simple mode with the Stage cap and axis, and the dock still hides without one', async t => {
  // CI must run the browser half (#364): the shared guard fails there, never skips.
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const evidence = process.env.BTW_EVIDENCE_DIR
  // 1440px: the composer stack outgrows the 760px card cap, so #363's 728px dock cap binds.
  // 390px: the column is under the cap and the btw card still sits 16px inside the card.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 720 }]) {
    await t.test(`btw card at ${viewport.width}px`, async () => {
      await page.setViewportSize(viewport)
      // The failing-before direction: simple mode, where the hide rule used to win.
      await page.setContent(fixture({ advanced: false, btw: true }))
      const simple = await measure(page)
      await page.setContent(fixture({ advanced: true, btw: true }))
      const advanced = await measure(page)
      t.diagnostic(`simple ${viewport.width}px: ${report(simple)}; advanced: ${report(advanced)}`)
      if (evidence) {
        await page.setContent(fixture({ advanced: false, btw: true }))
        await page.screenshot({ path: `${evidence}/simple-btw-${viewport.width}.png` })
      }
      // A btw card is visible and painted in simple mode, as in advanced mode.
      assert.equal(simple.dockDisplay, 'flex', 'the dock holding a btw card is visible in simple mode')
      assert.ok(simple.btw && simple.btw.w > 0 && simple.btw.h > 0, 'the btw card has a box in simple mode')
      assert.equal(simple.painted, true, 'the btw card is painted, not covered')
      // Same width and axis as advanced: one card, one column.
      assert.equal(simple.btw.w, advanced.btw.w, 'the btw card keeps advanced mode\'s width')
      assert.equal(simple.btw.x, advanced.btw.x, 'the btw card keeps advanced mode\'s axis')
      assert.ok(Math.abs((simple.btw.x + simple.btw.r) / 2 - (simple.card.x + simple.card.r) / 2) <= 0.5,
        'the btw card shares the composer card axis')
      // #363: the dock and the btw card keep the card cap less four insets (760 - 4*8 = 728).
      const cap = 760 - 4 * 8
      assert.equal(simple.dockCap, `${cap}px`)
      assert.ok(simple.dock.w <= cap + 0.5, `the dock stays under the ${cap}px cap, got ${simple.dock.w}px`)
      assert.ok(simple.btw.w <= cap + 0.5, `the btw card stays under the ${cap}px cap, got ${simple.btw.w}px`)
      // As natively, the btw card sits 16px inside each composer card edge.
      assert.ok(Math.abs(simple.btw.x - simple.card.x - 16) <= 0.5 && Math.abs(simple.card.r - simple.btw.r - 16) <= 0.5,
        `the btw card sits 16px inside each card edge, got ${simple.btw.x - simple.card.x}/${simple.card.r - simple.btw.r}`)
      // The dock wrapper also holds the context meter: only the btw slot shows.
      assert.equal(simple.meterDisplay, 'none', 'the context meter stays out of simple mode')
      if (viewport.width === 1440) assert.equal(simple.btw.w, cap, 'at 1440px the 728px cap is what sizes the card')
      // The hide rule still hides the dock when it holds no btw card.
      for (const advanced of [false, true]) {
        await page.setContent(fixture({ advanced, btw: false }))
        const m = await measure(page)
        t.diagnostic(`${advanced ? 'advanced' : 'simple'} without a btw: ${report(m)}`)
        assert.equal(m.btw, null)
        if (advanced) {
          assert.equal(m.dockDisplay, 'flex', 'advanced mode keeps the native dock')
          assert.notEqual(m.meterDisplay, 'none', 'advanced mode keeps the native context meter')
        } else {
          assert.equal(m.dockDisplay, 'none', 'simple mode without a btw card keeps the dock hidden')
        }
      }
    })
  }
})
