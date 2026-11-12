// Genie's and Omni's names on the team step's cards are the approved lockups: byte copies of
// the final logo set (final-triskle-seam), the triskle in its three colours, each product's
// own sparkle, ink letters on a light ground and cream on a dark one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const BRAND = new URL('../src/client/vendor/art/brand/', import.meta.url)
const bytes = file => readFileSync(new URL(file, BRAND))
const sha256 = data => createHash('sha256').update(data).digest('hex')
// Each file's sha256 in the final set. A new set replaces the file and this line together.
const APPROVED = {
  'genie-lockup-three-colours-ink-header.svg': '6ea4dd15ca55c49c5f509f8b078b32e93029ca990b8114691f7a8fd82e3c55ee',
  'genie-lockup-three-colours-cream-header.svg': '726737ed38d35d5ea2ef9ab87f23527c738fc7b89b4f09ea7db660be9e69189c',
  'omni-lockup-three-colours-ink-header.svg': '04a4b973a92c2f57dd4e0911ae68931e8fc6403b79b28c7d8aca3acccc265c69',
  'omni-lockup-three-colours-cream-header.svg': '74cadeae1ba0a439dfb16a9dbeb42f3e36475e120bd5c563a7f25117f060e2b8',
}
// The mark's three colours, which are also the three sparkles: Automagik's, Genie's, Omni's.
const [VIOLET, PINK, CYAN] = ['#b586e7', '#ee5496', '#15bde0']
// The letters take the drawing's own colour: the set's ink, or its cream.
const [INK, CREAM] = ['#3c3049', '#f3e9dd']
const text = file => bytes(file).toString('utf8')
const fills = (file, colour) => text(file).split(`fill="${colour}"`).length - 1
const dataUrl = file => `data:image/svg+xml;base64,${bytes(file).toString('base64')}`

// The client modules, with a React that records elements instead of rendering them.
async function load(file) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/client/${file}`, import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn,
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, setTimeout, clearTimeout, require: name => ({ react, 'react-dom': { createPortal: node => node } })[name] })
  return module.exports
}
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return { ...node, children: node.children.map(render) }
}
function findAll(node, match, out = []) {
  if (Array.isArray(node)) node.forEach(child => findAll(child, match, out))
  else if (node && typeof node === 'object') {
    if (match(node)) out.push(node)
    node.children.forEach(child => findAll(child, match, out))
  }
  return out
}
const textOf = node => (Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.children) : node === null || node === undefined || node === false ? '' : String(node))
const classes = node => String(node?.props?.className ?? '').split(' ').filter(Boolean)
const byClass = name => node => classes(node).includes(name)
const byType = type => node => node.type === type

const lockup = await load('product-lockup.js')
const team = await load('team.js')
const css = lockup.PRODUCT_LOCKUP_CSS
// One CSS rule's declarations, by its exact selector.
const rule = selector => {
  const found = css.split('\n').filter(line => line.startsWith(`${selector}{`))
  assert.equal(found.length, 1, `one rule for ${selector}`)
  return found[0].slice(selector.length + 1, -1)
}

test('every lockup file is the final set\'s, byte for byte', () => {
  for (const [file, hash] of Object.entries(APPROVED)) assert.equal(sha256(bytes(file)), hash, `${file} is not the final set's file`)
  assert.deepEqual(readdirSync(BRAND).sort(), ['SOURCE.json', ...Object.keys(APPROVED)].sort(), 'brand/ holds the four lockups and their record')
  // The record says the same, and where in the set each came from.
  const source = JSON.parse(text('SOURCE.json'))
  assert.equal(source.set, 'final-triskle-seam')
  assert.deepEqual(Object.keys(source.files).sort(), Object.keys(APPROVED).sort())
  for (const [file, entry] of Object.entries(source.files)) {
    assert.equal(entry.sha256, APPROVED[file], `SOURCE.json: ${file}`)
    assert.equal(entry.bytes, bytes(file).length, `SOURCE.json: ${file}`)
    assert.equal(entry.from, `lockups/svg/${file}`, `${file} keeps its name in the set`)
  }
})

test('the triskle is in its three colours, and each product has its own sparkle', () => {
  // The mark carries one fill of each colour; the one more is the sparkle on the name's i.
  const counts = file => [fills(file, PINK), fills(file, CYAN), fills(file, VIOLET)]
  for (const tone of ['ink', 'cream']) {
    assert.deepEqual(counts(`genie-lockup-three-colours-${tone}-header.svg`), [2, 1, 1], `Genie's sparkle is pink (${tone})`)
    assert.deepEqual(counts(`omni-lockup-three-colours-${tone}-header.svg`), [1, 2, 1], `Omni's sparkle is cyan (${tone})`)
  }
  // The letters: ink in the ink file, cream in the cream one, and nothing else differs.
  for (const [name, label] of [['genie', 'Genie'], ['omni', 'Omni']]) {
    const [ink, cream] = ['ink', 'cream'].map(tone => text(`${name}-lockup-three-colours-${tone}-header.svg`))
    assert.ok(ink.includes(` role="img" aria-label="${label}" color="${INK}">`), `${name}: ink letters`)
    assert.ok(cream.includes(` role="img" aria-label="${label}" color="${CREAM}">`), `${name}: cream letters`)
    assert.equal(ink.split(INK).length, 2)
    assert.equal(ink.replace(INK, CREAM), cream, `${name}: the two differ only in the letters' colour`)
  }
  // Each keeps the set's shared frame, 264 tall.
  for (const tone of ['ink', 'cream']) {
    assert.match(text(`genie-lockup-three-colours-${tone}-header.svg`), / viewBox="0 -186 976\.34 264"/)
    assert.match(text(`omni-lockup-three-colours-${tone}-header.svg`), / viewBox="0 -186 916\.53 264"/)
  }
})

test('the bundle carries those files: ink and cream for each product', () => {
  assert.deepEqual(Object.keys(lockup.PRODUCT_LOCKUPS).sort(), ['genie', 'omni'])
  for (const [product, art] of Object.entries(lockup.PRODUCT_LOCKUPS)) {
    assert.equal(art.ink, dataUrl(`${product}-lockup-three-colours-ink-header.svg`), `${product}: ink`)
    assert.equal(art.cream, dataUrl(`${product}-lockup-three-colours-cream-header.svg`), `${product}: cream`)
  }
  assert.equal(lockup.PRODUCT_LOCKUPS.omni.name, 'Omni')
  assert.equal(lockup.PRODUCT_LOCKUPS.genie.name, 'Genie')
})

test('ink letters on a light ground, cream on a dark one, by DSH\'s Appearance setting', () => {
  for (const product of ['omni', 'genie']) {
    const light = rule(`.oai-lockup-${product}`)
    const dark = rule(`body[data-ds-dark-theme] .oai-lockup-${product}`)
    assert.ok(light.endsWith(`background-image:url("${dataUrl(`${product}-lockup-three-colours-ink-header.svg`)}")`), `${product}: ink by default`)
    assert.equal(dark, `background-image:url("${dataUrl(`${product}-lockup-three-colours-cream-header.svg`)}")`, `${product}: cream in dark`)
  }
  // No other rule names a lockup picture: two per product.
  assert.equal(css.split('background-image:').length - 1, 4)
})

test('the lockup is 36px high, where the sparkle reads, and keeps its frame', () => {
  assert.equal(lockup.LOCKUP_HEIGHT, 36)
  assert.equal(rule('.oai-lockup'), 'display:block;flex:none;height:36px;background:center/contain no-repeat')
  // The set's frames at 36px: 916.53 by 264 and 976.34 by 264.
  assert.equal(lockup.lockupWidth('omni'), 125)
  assert.equal(lockup.lockupWidth('genie'), 133)
  assert.match(rule('.oai-lockup-omni'), /^width:125px;/)
  assert.match(rule('.oai-lockup-genie'), /^width:133px;/)
})

test('a narrow card puts its team line under the lockup instead of squeezing it', () => {
  assert.equal(rule('.oai-fighter header:has(.oai-lockup)'), 'flex-wrap:wrap;row-gap:8px')
  assert.equal(rule('.oai-fighter header:has(.oai-lockup) .oai-team-line'), 'flex:none')
  assert.equal(rule('.oai-fighter h2.oai-product'), 'position:relative;display:flex;line-height:0')
})

test('Omni\'s and Genie\'s cards draw their own lockup and keep the name as text', () => {
  const omni = render(team.OmniCard({ power: { phase: 'none', detail: { sandbox: null }, busy: null, problem: null, use: () => {}, remote: () => {}, local: () => {}, cancelPairing: () => {} }, onPower: () => {}, type: { type: 'omni', groups: [] }, abilities: {}, onToggle: () => {}, live: null }))
  const genie = render(team.GenieCard({ power: { phase: 'ready', detail: null, toggle: () => {} }, host: null }))
  for (const [card, product, name] of [[omni, 'omni', 'Omni'], [genie, 'genie', 'Genie']]) {
    const headings = findAll(card, byType('h2'))
    assert.equal(headings.length, 1, `${name}: one heading`)
    assert.deepEqual(classes(headings[0]), ['oai-product'])
    // The picture, hidden from a screen reader, then the name, read and not drawn.
    assert.equal(headings[0].children.length, 2)
    const [picture, label] = headings[0].children
    assert.equal(picture.type, 'i')
    assert.deepEqual(classes(picture), ['oai-lockup', `oai-lockup-${product}`])
    assert.equal(picture.props['aria-hidden'], true)
    assert.equal(picture.children.length, 0)
    assert.equal(label.type, 'span')
    assert.deepEqual(classes(label), ['oai-hidden'])
    assert.equal(textOf(headings[0]), name)
    // The heading sits in the card's header, before the team line.
    const header = findAll(card, byType('header'))[0]
    assert.equal(header.children[0], headings[0])
    assert.equal(findAll(card, byClass('oai-lockup')).length, 1)
  }
})

test('Unfold has no lockup in the set: its card keeps its name as text', () => {
  const unfold = render(team.UnfoldCard({ power: { phase: 'ready', detail: null, toggle: () => {} }, host: null }))
  const headings = findAll(unfold, byType('h2'))
  assert.equal(headings.length, 1)
  assert.deepEqual(classes(headings[0]), [])
  assert.deepEqual(headings[0].children, ['Unfold'])
  assert.equal(findAll(unfold, byClass('oai-lockup')).length, 0)
})

test('the welcome\'s styles include the lockups, and the hidden name\'s class exists', () => {
  const index = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  assert.match(index, /import \{ PRODUCT_LOCKUP_CSS \} from '\.\/product-lockup\.js'/)
  assert.match(index, /STAGE_CSS \+ ONBOARD_CSS \+ INK_CSS \+ CLAY_ART_CSS \+ PRODUCT_LOCKUP_CSS \+/)
  const stage = readFileSync(new URL('../src/client/octopus.js', import.meta.url), 'utf8')
  assert.match(stage, /\.oai-hidden\{position:absolute;[^}]*clip/)
  // The built bundle is this source: it carries each lockup once in ink and once in cream.
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  for (const file of Object.keys(APPROVED)) assert.ok(client.includes(dataUrl(file)), `client.js carries ${file}`)
})
