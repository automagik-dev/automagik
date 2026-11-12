import { nativeCss } from './native-css.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { allThemes, themeCss } from '../src/client/themes.js'
import { browserGuard } from './browser-guard.js'

// The Bot chat's header (its pill, "Live", the arrow and "Details") is a band of its own
// above the transcript. It used to float over the transcript, so messages scrolled under
// its see-through buttons, and once the window narrowed, the right-aligned user bubbles
// and their timestamps sat under "Live" and the arrow.

// Requires the dev/harness dependency install; reads DSH's own conversation layout CSS
// (ConversationRoot and the transcript column), not a second layout model.
const requireHarness = createRequire(new URL('../dev/harness/package.json', import.meta.url))
const rootBundle = readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
const rootCss = nativeCss(rootBundle).find(css => css.includes('_headerLeading{'))
assert.ok(rootCss, 'supported DSH ConversationRoot CSS must be present')
const chatBundle = readFileSync(requireHarness.resolve('@deepseek-ai/dsh-client-ui-chat/client'), 'utf8')
const flowCss = nativeCss(chatBundle).find(css => /_column\{/.test(css) && css.includes('--dsh-chat-content-width'))
assert.ok(flowCss, 'supported DSH transcript column CSS must be present')
const ROOT = rootCss.match(/\.(\w+)_root\{/)[1]
const FLOW = flowCss.match(/\.(\w+)_column\{/)[1]

const { outputFiles } = await build({
  stdin: { contents: "export { SHELL_CSS, CONVERSATION_CSS } from './src/client/styles.js'", resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'cjs', platform: 'browser', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: () => ({}) })
const { SHELL_CSS, CONVERSATION_CSS } = module.exports

// dev before the fix: the floating header, its fade and the transcript's 60px clearance.
const FLOATING = `
header[class*="_header"]:has(.bt-head){position:absolute!important;top:0;left:0;right:0;z-index:8;display:flex!important;padding:10px 0 0!important;background:transparent!important;pointer-events:none;justify-content:center}
[class*="_scroll"]:has(> [class*="_column"]){padding-top:calc(60px + env(safe-area-inset-top,0px))!important}`

test('the chat header is laid out above the transcript, not over it', () => {
  const rule = CONVERSATION_CSS.match(/header\[class\*="_header"\]:has\(\.bt-head\)\{[^}]*\}/)?.[0]
  assert.ok(rule, 'the Bot header rule is present')
  assert.doesNotMatch(rule, /position:absolute/)
  assert.match(rule, /position:relative!important/)
  assert.match(rule, /background:var\(--bt-main\)!important/, 'the band is painted with a theme token')
  assert.doesNotMatch(CONVERSATION_CSS, /position:absolute!important;top:0;left:0;right:0;z-index:8/)
  assert.doesNotMatch(CONVERSATION_CSS, /_header"\]:has\(\.bt-head\)::before/, 'no fade is left to hide')
  assert.doesNotMatch(CONVERSATION_CSS, /_column"\]\)\{padding:calc\(60px/, 'the transcript no longer clears a floating header')
  for (const [id, theme] of Object.entries(allThemes())) {
    assert.doesNotMatch(theme.css ?? '', /_header"\]:has\(\.bt-head\)::before/, id)
  }
})

const messages = Array.from({ length: 14 }, (_, index) => index % 2
  ? `<div class="msg bot"><p>Reply ${index}: a long Bot reply with several lines of text, enough to fill the column and let the transcript scroll past the header row.</p><div class="img"></div></div>`
  : `<div class="msg user"><div class="bubble">Draw an octopus ${index} with colourful tentacles and a hat</div><div class="time">09:4${index}</div></div>`).join('')

function fixture(theme, dark, { sidebar, rail, leading = '', clearance = 0, name = 'Back to chat' }, extra = '') {
  return `<!doctype html><html data-bt-conversation><head><style>
    *{box-sizing:border-box}html,body{margin:0;height:100%;font:14px/20px Arial}
    .frame{display:flex;height:100vh}.side{width:${sidebar}px;flex:none}.right{width:${rail}px;flex:none}
    .center{flex:1;min-width:0;display:flex}[data-slot="main.conversation"]{flex:1;min-width:0;height:100%}
    .msg.user{align-self:flex-end;display:flex;flex-direction:column;align-items:flex-end;margin:12px 0}
    .msg.user .bubble{background:var(--bt-user);color:var(--bt-user-ink);padding:10px 14px;border-radius:18px;max-width:70%}
    .msg.user .time{font-size:11px;color:var(--bt-ink-2)}
    .msg.bot{margin:12px 0;color:var(--bt-ink)}.msg.bot .img{height:120px;border-radius:12px;background:var(--bt-accent)}
    ${rootCss}\n${flowCss}\n${SHELL_CSS}\n${CONVERSATION_CSS}\n${themeCss(theme)}\n${extra}
  </style></head><body${dark ? ' data-ds-dark-theme' : ''}><div class="frame"${clearance ? ` style="--dsh-frame-leading-clearance:${clearance}px"` : ''}>${sidebar ? '<aside class="side"></aside>' : ''}
  <div class="center"><div data-slot="main.conversation"><div class="${ROOT}_root" data-phase="active">
    <header class="${ROOT}_header"><div class="${ROOT}_headerLeading">${leading}</div><div class="bt-head">
      <button type="button" class="bt-pill"><span class="bt-pill-name">${name}</span></button>
      <span class="bt-sr" role="status"></span>
      <button type="button" class="bt-head-details" title="Live" aria-label="Open Live">Live</button>
      <button type="button" class="bt-head-details" data-bt-right-sidebar title="Right sidebar" aria-label="Toggle right sidebar">→</button>
      <button type="button" class="bt-head-details" title="Details" aria-label="View conversation details" aria-expanded="false">Details</button>
    </div></header>
    <div class="${ROOT}_body" data-content-phase="active"><div class="${ROOT}_scrollBody" data-conversation-scroll>
      <div class="${ROOT}_viewArea"><div class="${FLOW}_scroll"><div class="${FLOW}_column">${messages}</div></div></div>
      <div class="${ROOT}_composerSeat" style="height:120px"><div data-composer-card style="height:96px;margin:0 16px"></div></div>
    </div></div>
  </div></div>${rail ? '<aside class="right"></aside>' : ''}</div></div></body></html>`
}

// Scrolls a user bubble to the transcript's top edge, then measures what the header covers.
function measure() {
  const scroller = document.querySelector('[data-conversation-scroll]')
  const header = document.querySelector('header')
  const target = [...document.querySelectorAll('.msg.user')][3]
  scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20
  const box = scroller.getBoundingClientRect()
  const buttons = [...header.querySelectorAll('button')].map(button => button.getBoundingClientRect())
  const pill = header.querySelector('.bt-pill').getBoundingClientRect()
  // The window chrome DSH seats over the pane's top-left corner, and the header's own leading controls.
  const frame = document.querySelector('.frame')
  const clearance = parseFloat(getComputedStyle(frame).getPropertyValue('--dsh-frame-leading-clearance')) || 0
  const chromeEnd = Math.max(frame.getBoundingClientRect().left + clearance,
    ...[...header.querySelectorAll('[class*="_headerLeading"] button')].map(button => button.getBoundingClientRect().right))
  const covered = []
  for (const element of document.querySelectorAll('.msg.user .bubble,.msg.user .time,.msg.bot p,.msg.bot .img')) {
    const rect = element.getBoundingClientRect()
    const top = Math.max(rect.top, box.top)
    const bottom = Math.min(rect.bottom, box.bottom)
    if (bottom <= top) continue
    if (buttons.some(b => rect.left < b.right && rect.right > b.left && top < b.bottom && bottom > b.top)) covered.push(element.className)
  }
  const headerBox = header.getBoundingClientRect()
  return {
    position: getComputedStyle(header).position,
    under: headerBox.bottom - box.top,
    buttonsInside: buttons.every(b => b.top >= headerBox.top && b.bottom <= headerBox.bottom && b.left >= headerBox.left - 0.5 && b.right <= headerBox.right + 0.5),
    pillClear: pill.left >= chromeEnd - 0.5,
    covered: [...new Set(covered)],
  }
}

const SIZES = [[720, 520], [900, 700], [1100, 800], [1366, 768], [1920, 1080]]
const LAYOUTS = [{ sidebar: 260, rail: 0 }, { sidebar: 0, rail: 0 }, { sidebar: 260, rail: 320 }]
// Narrow windows with a long Bot name: the collapsed sidebar's buttons in the header's leading
// slot, and the drawer's seat (84px) or macOS's traffic lights and seat (160px) over the corner.
const LONG = 'Back to chat with a rather long Bot name that will not fit'
const LEADING = '<button type="button" style="width:28px;height:28px">=</button><button type="button" style="width:28px;height:28px">+</button>'
const CORNERS = [
  { sidebar: 56, rail: 0, leading: LEADING, name: LONG },
  { sidebar: 0, rail: 320, clearance: 84, name: LONG },
  { sidebar: 0, rail: 320, clearance: 160, name: LONG },
]

test('no transcript content renders under the header buttons, at any width', async t => {
  // CI must run the browser half (#323, #364): the shared guard fails there, never skips.
  const guard = await browserGuard()
  if (guard.skip) return t.skip(guard.skip)
  const browser = await guard.chromium.launch({ executablePath: guard.executablePath, headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()

  // Failing-before direction: the same fixture under dev's floating header reproduces the
  // report (content under the header, a bubble under "Live" on a 1366px window).
  await t.test('the floating header covered the transcript', async () => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.setContent(fixture(allThemes().deepseek, false, LAYOUTS[0], FLOATING))
    const result = await page.evaluate(measure)
    assert.equal(result.position, 'absolute')
    assert.ok(result.under > 0, 'the transcript started under the header')
    assert.ok(result.covered.length > 0, 'a message sat under a header button')
  })

  for (const [id, theme] of Object.entries(allThemes())) {
    await t.test(`${id} theme`, async () => {
      for (const dark of [false, true]) {
        for (const [width, height] of SIZES) {
          for (const layout of LAYOUTS) {
            if (layout.rail && width < 1100) continue
            const label = `${dark ? 'dark' : 'light'} ${width}x${height} sidebar ${layout.sidebar} rail ${layout.rail}`
            await page.setViewportSize({ width, height })
            await page.setContent(fixture(theme, dark, layout))
            const result = await page.evaluate(measure)
            assert.notEqual(result.position, 'absolute', label)
            assert.ok(result.under <= 0.5, `${label}: the transcript starts ${result.under}px under the header`)
            assert.ok(result.buttonsInside, `${label}: the header buttons stay inside the header band`)
            assert.deepEqual(result.covered, [], `${label}: content under a header button`)
            assert.ok(result.pillClear, `${label}: the pill reaches under the window chrome`)
          }
        }
        for (const layout of CORNERS) {
          const label = `${dark ? 'dark' : 'light'} 720x520 ${JSON.stringify({ ...layout, name: undefined, leading: !!layout.leading })}`
          await page.setViewportSize({ width: 720, height: 520 })
          await page.setContent(fixture(theme, dark, layout))
          const result = await page.evaluate(measure)
          assert.ok(result.under <= 0.5, `${label}: the transcript starts ${result.under}px under the header`)
          assert.ok(result.buttonsInside, `${label}: the header buttons stay inside the header band`)
          assert.deepEqual(result.covered, [], `${label}: content under a header button`)
          assert.ok(result.pillClear, `${label}: the pill reaches under the window chrome`)
        }
      }
    })
  }
})
