// Static multi-page source. No build step is needed on Pages; generated HTML is committed.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { waitlistForm, privacyNote } from '../waitlist/lib/ui.js'

export const routes = ['/', '/desktop/', '/mobile/', '/omni/', '/genie/', '/cloud/', '/arca/', '/mykes/']
const repo = 'https://github.com/automagik-si/automagik'
const mac = `${repo}/releases/latest/download/Automagik-Mac.dmg`
const linux = `${repo}/releases/latest/download/Automagik-Linux.deb`
// LINKS OUT: guides and help live on the docs site (no deep paths yet). GitHub is linked for
// the downloads and once, quietly, in the footer; nothing links to a design document.
const docs = 'https://docs.automagik.dev'
const releases = JSON.parse(await readFile(new URL('../assets/releases.json', import.meta.url), 'utf8'))
const artFiles = JSON.parse(await readFile(new URL('../assets/art/manifest.json', import.meta.url), 'utf8')).files
// WE UNFOLD: the one place for its link and wording. The owner approves both lines before the
// site goes live; change them here and regenerate. Rules from the we unfold team: "Open
// Intelligence" always with both capitals and never shortened; "we unfold" in lower case in
// running text; "part of" is the movement, not ownership; no logo, the text is the link.
export const weUnfold = {
  url: 'https://weunfold.ai/',
  name: 'we unfold',
  partOf: 'Automagik is part of we unfold, the home of the Open Intelligence movement.',
  openIntelligence: 'Open Intelligence: a future more people can understand, question, and shape.',
}
// ARCA: a stand-in page until Arca's own site is served at /arca/. Its one line is the
// owner's own (2026-11-12), used exactly as given wherever Arca is described. Get Arca opens
// this page, where the install command is text to copy: the installer's address answers
// with a shell script, so nothing links to it.
export const arca = {
  line: 'Be your own cloud. Infrastructure for AI agents.',
  install: 'curl -fsSL https://get.automagik.si/arca | sh',
  needs: 'Today it needs a Linux machine (x86_64) with Incus, and a person comfortable with a terminal.',
}
// ARCA'S LOGO, A SLOT: Arca's logo kit is not published yet, so the committed pages show a
// plain placeholder wherever Arca's logo belongs. Once the kit's icon files are in
// assets/brand/arca/, the pages use them in place of the placeholder. Arca's rules: one
// colour (ink on a light ground, ivory on a dark one), never redrawn, tinted, animated or
// locked up with another mark.
export const arcaKit = existsSync(new URL('../assets/brand/arca/arca-icon-ink.svg', import.meta.url))
const arcaMark = cls => arcaKit
  ? `<span class="arca-mark at-${cls}" data-arca-logo="kit"><picture><source media="(prefers-color-scheme: dark)" srcset="/assets/brand/arca/arca-icon-ivory.svg"><img src="/assets/brand/arca/arca-icon-ink.svg" width="64" height="64" alt="" aria-hidden="true" decoding="async"></picture></span>`
  : `<span class="arca-mark at-${cls}" data-arca-logo="placeholder" aria-hidden="true"></span>`
const licensing = 'Automagik, Genie and Omni are free and open source (Apache-2.0). Cloud will be a private, paid service; its contracts are public.'
const arrow = '<span aria-hidden="true">→</span>'
const down = '<span aria-hidden="true">↓</span>'
const out = '<span aria-hidden="true">↗</span>'

// One art file at 1x and 2x. Decorative art carries an empty alt and aria-hidden.
// dark: the visitor's dark theme gets the picture's dark twin (name-dark), so an app capture
// never sits as a bright box on a dark page. sizes: the layout's widths, when the picture
// scales with the page. narrow: another picture of the same thing for phone-width screens.
function art(name, alt, { cls = '', eager = false, dark = false, sizes = '', narrow = '' } = {}) {
  const file = (key, suffix = '') => artFiles[`${key}${suffix}.webp`]
  const set = key => sizes
    ? `/assets/art/${key}.webp ${file(key).width}w, /assets/art/${key}-2x.webp ${file(key, '-2x').width}w`
    : `/assets/art/${key}.webp 1x, /assets/art/${key}-2x.webp 2x`
  const source = (key, media) => `<source media="${media}" srcset="${set(key)}"${sizes ? ` sizes="${sizes}"` : ''} width="${file(key).width}" height="${file(key).height}">`
  const { width, height } = file(name)
  const label = alt ? `alt="${alt}"` : 'alt="" aria-hidden="true"'
  const img = `<img${cls ? ` class="${cls}"` : ''} src="/assets/art/${name}.webp" srcset="${set(name)}"${sizes ? ` sizes="${sizes}"` : ''} width="${width}" height="${height}" ${label}${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`
  const sources = [
    narrow && dark ? source(`${narrow}-dark`, '(max-width: 700px) and (prefers-color-scheme: dark)') : '',
    narrow ? source(narrow, '(max-width: 700px)') : '',
    dark ? source(`${name}-dark`, '(prefers-color-scheme: dark)') : '',
  ].join('')
  return sources ? `<picture>${sources}${img}</picture>` : img
}
// The clay dots and threads of the app's install art, drawn once per page behind a stage.
function constellation() {
  const nodes = [[60, 120, 9, 'p'], [150, 70, 6, 'c'], [250, 150, 12, 'v'], [120, 260, 7, 'c'], [40, 380, 10, 'v'], [180, 470, 6, 'p'], [330, 540, 9, 'c'],
    [880, 520, 8, 'v'], [1010, 560, 11, 'p'], [1120, 470, 7, 'c'], [1160, 330, 9, 'p'], [1060, 230, 6, 'v'], [1150, 120, 12, 'c'], [980, 60, 7, 'p']]
  const links = [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5], [5, 6], [3, 2], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [10, 12]]
  const line = ([a, b]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}"/>`
  const dot = ([x, y, r, tone]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#clay-${tone})"/>`
  const ball = (tone, light, dark) => `<radialGradient id="clay-${tone}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`
  return `<svg class="constellation" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${ball('c', '#a6ecf8', '#1aa9cc')}${ball('p', '#ffb3d8', '#d63384')}${ball('v', '#d9c2ff', '#8457e0')}</defs><g class="threads">${links.map(line).join('')}</g><path class="arc" d="M200 40 Q300 120 290 220"/><path class="arc" d="M1000 420 Q930 470 900 560"/>${nodes.map(dot).join('')}</svg>`
}

// The site's navigation: three groups, the same in the header menus, the phone menu and the
// footer. Products keep one order everywhere, which is also the previous/next order.
const products = [
  { href: '/desktop/', name: 'Desktop', image: 'app-icon', line: 'Your agent team, in your chats.' },
  { href: '/mobile/', name: 'Mobile', image: 'app-icon', line: 'Your agents on your Android phone.' },
  { href: '/omni/', name: 'Omni', image: 'omni', line: 'Your chat apps, connected.' },
  { href: '/genie/', name: 'Genie', image: 'genie', line: 'A wish, a branch, a report.' },
  { href: '/cloud/', name: 'Cloud', image: 'pet', line: 'Coming soon. Register your interest.' },
  { href: '/arca/', name: 'Arca', mark: arcaMark('menu'), line: arca.line },
  { href: '/mykes/', name: 'Mykes', image: 'mark', line: 'Coming soon.' },
]
const resources = [
  { href: docs, name: 'Docs', glyph: 'book', line: 'Guides for the app and its blocks.', external: true },
  { href: '/desktop/#install', name: 'Get the app', glyph: 'download', line: 'Automagik Desktop, for Mac and Linux.' },
  { href: '/mobile/#install', name: 'Get the phone app', glyph: 'phone', line: 'Automagik Mobile, for Android.' },
]
const company = [
  { href: weUnfold.url, name: weUnfold.name, glyph: 'globe', line: weUnfold.openIntelligence, external: true },
  { href: docs, name: 'Support', glyph: 'chat', line: 'Answers and guides, in the docs.', external: true },
  { href: '/cloud/#privacy', name: 'Privacy', glyph: 'ask', line: 'What we keep, and how to remove your details.' },
]
const blocks = products.slice(0, 5).map(({ href, name, image, line }) => [href, name, image, line])
const partOf = () => {
  assert.equal(weUnfold.partOf.split(weUnfold.name).length, 2, 'the part-of line names we unfold once')
  return weUnfold.partOf.replace(weUnfold.name, `<a href="${weUnfold.url}">${weUnfold.name}</a>`)
}
const icon = {
  ai: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  files: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  secret: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.4"/>',
  ask: '<path d="M12 3.5l7 3v5.2c0 4.3-3 7.6-7 8.8-4-1.2-7-4.5-7-8.8V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M5 20.5A2.5 2.5 0 0 0 7.5 21H19v-3"/><path d="M9 7.5h6"/>',
  phone: '<rect x="7" y="2.8" width="10" height="18.4" rx="2.6"/><path d="M10.8 18h2.4"/>',
  download: '<path d="M12 4v11"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.7 2.5 2.7 14.7 0 17.2"/><path d="M12 3.4c-2.7 2.5-2.7 14.7 0 17.2"/>',
  chat: '<path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v6.5a2.5 2.5 0 0 1-2.5 2.5h-5.2L7.5 19.5v-4H7a2.5 2.5 0 0 1-2.5-2.5z"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  chevron: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
}
const glyph = (name, cls = 'glyph') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon[name]}</svg>`
const brand = '<a class="brand" href="/" aria-label="Automagik home"><img src="/assets/brand/lockup.webp" width="170" height="36" alt="Automagik"></a>'
const entry = route => ({ href, name, line, image, mark, glyph: sign, external }) => `<li><a class="menu-item" href="${href}"${href === route ? ' aria-current="page"' : ''}><span class="menu-icon">${image ? art(image, '', { cls: 'menu-art' }) : mark ?? glyph(sign)}</span><span class="menu-text"><strong>${name}${external ? ` ${out}` : ''}</strong><span>${line}</span></span></a></li>`
// OPEN INTELLIGENCE STAMP: Automagik's own mark for the movement it is part of, and the link
// to we unfold. Two cuts: the seal (the home page) and the tag (every footer). It is not
// we unfold's logo, and it never carries another product's logo.
const spark = 'M12 1.8l2.5 7 7.2 2.2-7.2 2.4L12 20.6l-2.5-7.2L2.3 11l7.2-2.2z'
const stampInk = id => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1aa9cc"/><stop offset=".55" stop-color="#8457e0"/><stop offset="1" stop-color="#d63384"/></linearGradient>`
function stamp(cut) {
  const words = `<span class="stamp-text"><strong>Open Intelligence</strong><span>Part of ${weUnfold.name} ${out}</span></span>`
  if (cut === 'tag') return `<a class="stamp tag" href="${weUnfold.url}"><svg class="stamp-core" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs>${stampInk('stamp-ink-tag')}</defs><circle cx="24" cy="24" r="21" fill="none" stroke="url(#stamp-ink-tag)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="112 20" transform="rotate(-62 24 24)"/><path fill="url(#stamp-ink-tag)" transform="translate(10.2 10.6) scale(1.15)" d="${spark}"/></svg>${words}</a>`
  const ring = `Open Intelligence · part of ${weUnfold.name} · `
  return `<a class="stamp seal" href="${weUnfold.url}"><span class="seal-art" aria-hidden="true"><svg class="seal-ring" viewBox="0 0 200 200" focusable="false"><defs><path id="seal-path" d="M100 27a73 73 0 1 1-.01 0"/></defs><text><textPath href="#seal-path" textLength="452" lengthAdjust="spacing">${ring}</textPath></text></svg><svg class="seal-core" viewBox="0 0 200 200" focusable="false"><defs>${stampInk('stamp-ink-seal')}</defs><circle cx="100" cy="100" r="97" fill="none" stroke="url(#stamp-ink-seal)" stroke-width="2.4"/><circle class="seal-inner" cx="100" cy="100" r="58" fill="none" stroke-width="1.4" stroke-dasharray="2 7" stroke-linecap="round"/><path fill="url(#stamp-ink-seal)" transform="translate(58 60) scale(3.5)" d="${spark}"/><path fill="url(#stamp-ink-seal)" transform="translate(128 50) scale(1.05)" d="${spark}"/></svg></span><span class="sr">Open Intelligence. Part of ${weUnfold.name}</span></a>`
}
// Menus without client scripting: each button opens its panel through the browser's own
// popover. The browser keeps the button's expanded state, closes the panel on Escape or a
// click outside, and returns focus to the button. Hover opens the same panel in CSS. On a
// phone the Menu button opens one sheet under the header with the same three groups.
function header(route) {
  const here = products.find(({ href }) => href === route)
  const groups = [
    ['products', 'Products', products, `<span>Use one, or bring them together.</span><a href="/#blocks">All products ${arrow}</a>`],
    ['resources', 'Resources', resources, `<span>${licensing}</span>`],
    ['company', 'Company', company, `<span>${partOf()}</span>`],
  ]
  const menus = groups.map(([id, label, items, foot]) => {
    const current = id === 'products' && here
    return `<li class="menu"><button class="menu-button" type="button" popovertarget="menu-${id}"${current ? ' data-here' : ''}>${label}${current ? `<span class="menu-here"><span class="sr">, current page: </span>${here.name}</span>` : ''}${glyph('chevron', 'chev')}</button><div class="menu-panel" id="menu-${id}" popover><div class="menu-card"><ul class="menu-list">${items.map(entry(route)).join('')}</ul><p class="menu-foot">${foot}</p></div></div></li>`
  }).join('')
  const sheet = groups.map(([id, label, items]) => `<section class="drawer-group" aria-labelledby="drawer-${id}"><h2 id="drawer-${id}" class="drawer-label">${label}</h2><ul class="menu-list">${items.map(entry(route)).join('')}</ul></section>`).join('')
  return `<header class="top"><div class="wrap top-inner">${brand}<nav class="main-nav" aria-label="Main navigation"><ul class="menus">${menus}</ul></nav><a class="button primary small top-cta" href="/desktop/#install">Get the app</a><button class="menu-open" type="button" popovertarget="site-menu">${glyph('menu', 'menu-glyph bars')}${glyph('close', 'menu-glyph cross')}Menu</button><a class="menu-fallback" href="#sitemap">Menu</a></div>
<nav class="drawer" id="site-menu" popover aria-label="All pages">${sheet}<div class="drawer-foot"><a class="button primary" href="/desktop/#install">Get the app ${arrow}</a><p class="fine">${partOf()}</p></div></nav></header>`
}
function footer(route) {
  const column = (label, items) => `<nav aria-label="${label}"><p class="footer-head">${label}</p>${items.map(({ href, name, external }) => `<a href="${href}"${href === route ? ' aria-current="page"' : ''}>${name}${external ? ` ${out}` : ''}</a>`).join('')}</nav>`
  // The one link to the repository on a page is the quiet one at the end of the footer.
  return `<footer class="site-footer"><div id="sitemap" class="wrap footer-grid"><div class="footer-brand">${brand}<p>Open building blocks of superintelligence.</p>${stamp('tag')}</div>${column('Products', products)}${column('Resources', resources)}${column('Company', company)}<p class="footer-license">${licensing} <a href="${repo}">Source code ${out}</a></p></div></footer>`
}
// Every product page says where it is and leads back to all products.
function crumbs(route) {
  const here = products.find(({ href }) => href === route)
  return `<nav class="crumbs wrap" aria-label="Breadcrumb"><ol><li><a href="/#blocks">All products</a></li><li><span aria-current="page">${here.name}</span></li></ol></nav>`
}
function frame(route, title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${title} · Automagik</title><meta name="description" content="Automagik: open building blocks of superintelligence. Desktop, Mobile, Omni, Genie, Cloud, Arca and Mykes."><meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#f6eee2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1e1923" media="(prefers-color-scheme: dark)"><link rel="canonical" href="https://automagik.si${route}"><link rel="icon" type="image/png" href="/assets/brand/app-icon.png"><link rel="preload" href="/assets/brand/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/assets/brand/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/styles.css"></head>
<body><a class="skip" href="#main">Skip to content</a>${header(route)}
<main id="main">${route === '/' ? '' : crumbs(route)}${body}</main>
${footer(route)}</body></html>\n`
}
// The other blocks, each with its own art: the way on from every page.
function more(route) {
  const items = blocks.filter(([href]) => href !== route).map(([href, label, image, line]) => `<li><a href="${href}">${art(image, '', { cls: `more-art more-${image}` })}<span><strong>${label}</strong><span>${line}</span></span></a></li>`).join('')
  const at = products.findIndex(({ href }) => href === route), step = by => products[(at + by + products.length) % products.length]
  const previous = step(-1), next = step(1)
  const pager = `<nav class="pager" aria-label="Previous and next product"><a class="pager-link" rel="prev" href="${previous.href}"><small><span aria-hidden="true">←</span> Previous</small><strong>${previous.name}</strong></a><a class="pager-all" href="/#blocks">All products</a><a class="pager-link next" rel="next" href="${next.href}"><small>Next ${arrow}</small><strong>${next.name}</strong></a></nav>`
  return `<section class="more wrap" aria-labelledby="more-title"><h2 id="more-title" class="more-title">More building blocks</h2><ul class="more-list">${items}</ul>${pager}</section>`
}
const heading = (eyebrow, title, intro) => `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="intro">${intro}</p>`

export function pages() {
  const preview = 'Automagik Mobile, in the app’s own interface preview with sample data'
  const phoneAlt = {
    home: `${preview}: the Home tab, with the agents that need you first.`,
    chat: `${preview}: a Bot’s chat asks for approval to run the tests, with No and Yes buttons.`,
    code: `${preview}: the Code tab, with three projects and their Bots.`,
  }
  const [term, rest] = weUnfold.openIntelligence.split(/(?<=:) /)
  assert.ok(rest, 'the Open Intelligence line starts with its name and a colon')
  const openLine = `<span class="ink-grad">${term}</span> ${rest}`
  const phone = (screen, cls, eager = false) => `<div class="phone ${cls}">${art(`pocket-${screen}`, phoneAlt[screen], { dark: true, sizes: '(max-width: 700px) 220px, 300px', eager })}</div>`

  const home = `<section class="hero home-hero">${constellation()}<div class="wrap home-hero-inner"><div class="hero-heading center">${heading('Automagik', 'Open building blocks of <span class="ink-grad">superintelligence.</span>', 'Tools that put your own agents to work. Use one, or bring them together.')}<div class="actions center"><a class="button primary" href="#blocks">Choose a block ${down}</a><a class="button secondary" href="/desktop/">Get Automagik Desktop ${arrow}</a></div></div>
<div class="scene"><div class="cast">${art('genie', 'Genie, Automagik’s clay character: a dark round face with a swirl of magenta hair.', { cls: 'scene-genie', eager: true })}<p class="bubble">A team of AI helpers that lives in your chats.</p>${art('omni', 'Omni, Automagik’s clay octopus, smiling.', { cls: 'scene-omni', eager: true })}</div><figure class="window scene-window">${art('team-chat', 'The real Automagik app: a fictional team’s chat. Pip, who leads the team, passes a request for a CSV export on to Genie and reports that it is running.', { dark: true, narrow: 'team-chat-phone', sizes: '(max-width: 700px) 94vw, (max-width: 1140px) 92vw, 1040px', eager: true })}</figure></div></div></div></section>
<section id="blocks" class="blocks wrap" aria-labelledby="blocks-title"><div class="section-heading"><p class="eyebrow">Choose a building block</p><h2 id="blocks-title">Start where your work is.</h2><p class="lede">Open a block to see what it does and how to use it.</p></div>
<div class="bento">
<article class="product-card" data-block="desktop"><div class="tile-copy"><p class="tile-tag">Mac and Linux</p><h3><a href="/desktop/">Automagik Desktop</a></h3><p>Your agent team, in your chats. A place to talk, hand work over and review what comes back.</p><span class="detail-link" aria-hidden="true">Download or install →</span></div><div class="tile-art window">${art('app-review-crop', 'The Automagik app: the team in the sidebar, and a finished wish’s report with the files it changed.', { dark: true, sizes: '(max-width: 700px) 640px, (max-width: 1100px) 92vw, 760px' })}</div></article>
<article class="product-card" data-block="mobile"><div class="tile-copy"><p class="tile-tag">Android</p><h3><a href="/mobile/">Automagik Mobile</a></h3><p>Your coding agents on your Android phone, paired to your own machines.</p><span class="detail-link" aria-hidden="true">Take your team along →</span></div><div class="tile-art">${phone('chat', 'tile-phone')}</div></article>
<article class="product-card" data-block="omni"><div class="tile-copy"><p class="tile-tag">Chat apps</p><h3><a href="/omni/">Omni</a></h3><p>Connect your chat apps to Automagik, with channels and canvases in the same window.</p><span class="detail-link" aria-hidden="true">Meet Omni →</span></div><div class="tile-art">${art('omni', 'Omni, the clay octopus.', { cls: 'tile-omni' })}</div></article>
<article class="product-card" data-block="genie"><div class="tile-copy"><p class="tile-tag">Wishes</p><h3><a href="/genie/">Genie</a></h3><p>Turn a wish into a branch, a test run and a report you approve.</p><ol class="wish-steps" aria-label="What a wish becomes"><li>Wish</li><li>Branch</li><li>Test run</li><li>Report</li></ol><span class="detail-link" aria-hidden="true">Meet Genie →</span></div><div class="tile-art">${art('genie', 'Genie, the clay character with magenta hair.', { cls: 'tile-genie' })}${art('lamp', '', { cls: 'tile-lamp' })}</div></article>
<article class="product-card" data-block="cloud"><div class="tile-art">${art('pet', 'The Automagik triskelion as a clay character with a small face.', { cls: 'tile-pet' })}</div><div class="tile-copy"><p class="tile-tag soon">Coming soon</p><h3><a href="/cloud/">Cloud</a></h3><p>One sign-in, organisations and hosted workspaces. Register your interest.</p><span class="detail-link" aria-hidden="true">Explore Cloud →</span></div></article>
<article class="product-card" data-block="arca"><div class="tile-copy">${arcaMark('card')}<h3><a href="/arca/">Arca</a></h3><p>${arca.line}</p><span class="detail-link" aria-hidden="true">Get Arca →</span></div></article>
</div>
<div class="also"><p class="also-label">Also on the way</p><article class="product-card"><h3><a href="/mykes/">Mykes</a></h3><p>Coming soon.</p></article></div></section>
<section class="wrap open" aria-labelledby="open-title">${stamp('seal')}<div class="open-copy"><h2 id="open-title" class="open-line">${openLine}</h2><p class="open-part">${partOf()}</p></div></section>
<section id="film" class="made wrap" aria-labelledby="made-title"><div class="made-copy"><p class="eyebrow">Made by this team</p><h2 id="made-title">From inside Automagik.</h2><p>This page began as Genie’s draft, in a group chat with our launch team.</p></div><figure class="film-still" data-film="placeholder">${art('team-step', 'The Automagik app’s team step, recorded: Pip leads, Omni sleeps until powered on, and Genie is ready for a wish.', { dark: true })}<figcaption><strong>A short film is coming.</strong> It shows our launch team at work.</figcaption></figure></section>`

  const desktop = `<section class="hero split-hero desktop-hero"><div class="wrap split"><div class="hero-heading">${art('app-icon', '', { cls: 'hero-icon', eager: true })}${heading('Your team, at your desk', 'Automagik Desktop', 'Bots that stay, each with its own name, role, model and memory. Talk with them, hand work over and keep the decisions that matter.')}<div id="install" class="distribution"><a class="button primary" href="${mac}">Download for Mac ${down}</a><a class="button secondary" href="${linux}">Download for Linux ${down}</a><div class="unavailable"><strong>Download for Windows</strong><span>Soon</span></div></div><p class="fine">Mac with Apple silicon, macOS 13 or newer. Linux on a 64-bit PC.</p></div></div>
<div class="wrap stage-frame">${constellation()}<figure class="window wide-window">${art('app-review', 'The real Automagik app: a fictional team in the sidebar, a finished wish’s report with its four edited files, and the new file open for review.', { dark: true, narrow: 'thread-phone', sizes: '(max-width: 700px) 92vw, (max-width: 1100px) 92vw, 1040px', eager: true })}</figure></div><p class="wrap caption">The real app, with a fictional team and project. The AI’s replies are scripted; the commands, tests and file changes are real.</p></section>
<section class="wrap channels" aria-labelledby="channels-title"><div class="section-heading"><p class="eyebrow">Two more ways in</p><h2 id="channels-title">Code mode and Team mode.</h2><p class="lede">The app’s switch still says Work for Team mode. Code mode installs separately.</p></div><div class="channel-grid"><article id="herdr" class="channel code"><div class="channel-copy"><h2>Install on Herdr</h2><p>Your code agents in the Herdr window, with the Automagik pack. Code mode needs Herdr and the pack; the app download alone does not set it up.</p><a class="detail-link" href="${docs}">Install Herdr and the pack ${out}</a></div><div class="channel-art">${art('code-tree', 'The Automagik pack’s sidebar in Herdr: a demo shop’s main Bot with build and quality squads.')}</div></article><article id="dsh" class="channel team"><div class="channel-copy"><h2>Install on DSH</h2><p>Already use DeepSeek Harness? Add the Automagik Bot team to your DSH through its plugin installer.</p><a class="detail-link" href="${docs}">Install the Bot team on DSH ${out}</a></div><div class="channel-art">${art('team-step', 'The Automagik Bot team’s welcome: Pip leads, and Omni and Genie can join the team.', { dark: true })}</div></article></div></section>
<section class="wrap principles-section" aria-labelledby="yours-title"><div class="section-heading"><p class="eyebrow">Make it yours</p><h2 id="yours-title">Your model. Your files. Your team.</h2></div><div class="principles"><article><span class="glyph-chip cyan">${glyph('ai')}</span><h3>Bring your AI.</h3><p>Connect an AI account or an API key. Each Bot runs on the model you give it. Omni and an AI account can wait until you are ready.</p></article><article><span class="glyph-chip lilac">${glyph('files')}</span><h3>Keep your files and memory.</h3><p>The team keeps its files in your computer’s <code>.automagik</code> folder. What Bots read and write goes to your connected AI provider under its terms.</p></article><article><span class="glyph-chip pink">${glyph('secret')}</span><h3>Secrets the Bots never see.</h3><p>Type keys and passwords into a card in the chat. The Bot never sees the value.</p></article><article><span class="glyph-chip cream">${glyph('ask')}</span><h3>Permission, with clear limits.</h3><p>It asks before sending as you to a person, deleting something or disconnecting a channel. Main and Omni Bots can read chats and post to groups, WhatsApp channels and your own chat without asking. Other Bots ask for chat access; an Always grant lets them post to that group again.</p></article></div></section>
<section class="wrap first-steps" aria-labelledby="steps-title"><div class="section-heading"><p class="eyebrow">First steps</p><h2 id="steps-title">Install the app.</h2></div><div class="install-grid"><article><h3>Mac</h3><ol class="steps"><li>Open Automagik-Mac.dmg.</li><li>Drag the Automagik icon to Applications.</li><li>Open Automagik from Applications.</li></ol></article><article><h3>Linux</h3><ol class="steps"><li>Open Automagik-Linux.deb and choose Install, or run <code>sudo apt install ./Automagik-Linux.deb</code>.</li><li>Open Automagik from your apps.</li></ol><p class="fine">On another Linux, use the <a href="${repo}/releases/latest/download/Automagik-Linux.AppImage">AppImage</a>.</p></article></div></section>${more('/desktop/')}`

  const mobile = `<section class="hero split-hero mobile-hero"><div class="wrap split"><div class="hero-heading">${heading('Pocket, with your team', 'Automagik Mobile', 'Your coding agents on your Android phone, paired to your own machines.')}<div id="install" class="distribution"><a class="button primary" href="${releases.pocket.url}">Download for Android ${down}</a><div class="unavailable"><strong>Download for iPhone</strong><span>Soon</span></div></div><p class="fine">Android 8.0 or newer.</p></div><div class="hero-visual stage-disc">${constellation()}${phone('home', 'hero-phone', true)}</div></div></section>
<section class="wrap close" aria-labelledby="close-title"><div class="close-copy"><p class="eyebrow">On your phone</p><h2 id="close-title">Keep your agents close.</h2><p class="lede">See which agents need you, open their terminals and answer from your phone. Teams and code spaces come from your own machines.</p></div><div class="close-phones">${phone('chat', 'close-phone')}${phone('code', 'close-phone')}</div></section>
<section class="wrap pair" aria-labelledby="pair-title"><div class="pair-card"><div class="pair-steps"><h2 id="pair-title">Pair with Pocket Link.</h2><ol class="steps"><li>Add Pocket Link to Herdr on your computer.</li><li>Choose Pair a phone.</li><li>Scan the QR code in Automagik Mobile.</li></ol></div><div class="pair-notes"><p class="pair-free">No Cloud account is needed.</p><p class="fine">Open the APK on your phone and allow your browser to install apps when Android asks. Pocket Link needs Herdr desktop and herdr-core on macOS or Linux.</p><a class="detail-link" href="${docs}">Set up Pocket Link ${out}</a></div></div></section>${more('/mobile/')}`

  const omni = `<section class="hero split-hero omni-hero"><div class="wrap split"><div class="hero-heading">${heading('Your chats, connected', 'Omni', 'The service that links your chat apps to Automagik, with channels and canvases in the same window.')}<div class="actions"><a class="button primary" href="/desktop/">Use it with Desktop ${arrow}</a><a class="button secondary" href="${docs}">Read the docs ${out}</a></div></div><div class="hero-visual omni-visual">${constellation()}${art('omni', 'Omni, Automagik’s clay octopus, smiling.', { cls: 'hero-omni', eager: true })}${art('omni-faces', 'Omni’s seven clay expressions, from pleased to sorry.', { cls: 'faces', eager: true })}</div></div></section>
<section class="wrap omni-story" aria-labelledby="bring-title"><article class="story-copy"><p class="eyebrow">Channels</p><h2 id="bring-title">Bring your conversations.</h2><p>WhatsApp, Telegram, Slack and other channels sit beside your team. Connect an Omni when you are ready.</p><ul class="chips" aria-label="Channels named here"><li>WhatsApp</li><li>Telegram</li><li>Slack</li><li>Other channels</li></ul></article><figure class="story-art">${art('omni-card', 'The Automagik app’s team step: Omni sleeps until you press its power button.', { dark: true })}<figcaption>In the app, Omni sleeps until you bring it along.</figcaption></figure></section>
<section class="wrap omni-canvas" aria-labelledby="canvas-title"><div class="canvas-card"><p class="eyebrow">Canvases</p><h2 id="canvas-title">Put work in the conversation.</h2><p>In a Main Bot’s canvas, lists, boards and forms can keep themselves up to date. Give Bots access to the chats where they should work.</p></div><p class="fine">No live channel or personal conversation is shown here. Permissions and their exceptions are in the <a href="${docs}">docs</a>.</p></section>${more('/omni/')}`

  const genie = `<section class="hero split-hero genie-hero"><div class="wrap split"><div class="hero-heading">${heading('Wish → branch → report', 'Genie', 'A wish becomes a branch, a test run and a report you approve.')}<div class="actions"><a class="button primary" href="/desktop/">Open your team ${arrow}</a><a class="button secondary" href="${docs}">Read the docs ${out}</a></div><p class="fine"><code class="command">genie desktop</code> opens it on the team.</p></div><div class="hero-visual genie-visual">${constellation()}${art('genie', 'Genie, Automagik’s clay character, smiling with eyes closed.', { cls: 'hero-genie', eager: true })}${art('lamp', 'Genie’s clay lamp in plum, cyan and magenta.', { cls: 'hero-lamp', eager: true })}</div></div></section>
<section class="wrap flow" aria-labelledby="flow-title"><div class="section-heading"><p class="eyebrow">One wish, start to finish</p><h2 id="flow-title">From a wish to a report you approve.</h2></div><ol class="flow-steps"><li><figure class="window">${art('ask', 'Recorded app capture: a fictional Northwind request for a CSV export, which Pip passes to Genie.', { dark: true })}</figure><h3>The wish</h3><p>Ask in the chat. Genie takes the project work.</p></li><li><figure class="window">${art('checks', 'Recorded app capture: the wish runs the project’s tests and the export on its own branch; both tests pass.', { dark: true })}</figure><h3>A branch and a test run</h3><p>Each wish runs in its own copy of the project, on its own branch.</p></li><li><figure class="window">${art('report', 'Recorded app capture: Genie reports the CSV export is done, with nothing pushed or merged.', { dark: true })}</figure><h3>A report you approve</h3><p>The report comes back to the chat. Merging stays your call.</p></li></ol><p class="caption">Genie reports the CSV export branch back to the fictional Northwind team. Model replies are scripted; commands, commits and file changes are real. Nothing was pushed or merged.</p>${art('genie-faces', 'Genie’s seven clay expressions, from beaming to sorry.', { cls: 'faces genie-faces' })}</section>${more('/genie/')}`

  const cloud = `<section class="hero split-hero cloud-hero"><div class="wrap split"><div class="hero-heading">${heading('<span class="soon-pill">Coming soon</span>', 'Automagik Cloud', 'One sign-in, organisations and hosted workspaces, with a place to open each workspace.')}<p class="lede">Cloud is not live. It will be a private, paid service, with public contracts. Register your interest and tell us what you would like your agents to do.</p><div class="actions"><a class="button primary" href="#interest">Register your interest ${down}</a></div></div><div class="hero-visual cloud-visual">${constellation()}${art('mark', 'The Automagik triskelion: three clay strokes in cyan, magenta and violet.', { cls: 'hero-mark', eager: true })}${art('pet', '', { cls: 'hero-pet', eager: true })}</div></div></section>
<section id="interest" class="wrap form-section" aria-labelledby="build-title"><div class="form-intro"><h2 id="build-title">What would you build?</h2><p>Choose email or WhatsApp to confirm your interest. This does not create a Cloud account or promise access. We send no launch or marketing message.</p></div><div class="form-card">${waitlistForm()}${privacyNote()}</div></section>${more('/cloud/')}`

  const coming = name => `<section class="hero coming"><div class="wrap"><div class="coming-card">${constellation()}<div class="hero-heading center">${art('mark', '', { cls: 'coming-mark', eager: true })}${heading('An Automagik building block', name, 'Coming soon.')}</div></div></div></section>${more('/mykes/')}`

  // Arca: one stand-in page until Arca's own site is served at this address.
  const arcaPage = `<section class="hero coming"><div class="wrap"><div class="coming-card">${constellation()}<div class="hero-heading center">${arcaMark('hero')}${heading('An Automagik building block', 'Arca', arca.line)}<div class="install-line"><h2 id="get">Get Arca</h2><pre><code>${arca.install}</code></pre><p>${arca.needs}</p></div><div class="actions center"><a class="button secondary" href="/#blocks">All products ${arrow}</a></div></div></div></div></section>${more('/arca/')}`

  return new Map([
    ['/', frame('/', 'Open building blocks of superintelligence', home)],
    ['/desktop/', frame('/desktop/', 'Desktop', desktop)], ['/mobile/', frame('/mobile/', 'Mobile', mobile)],
    ['/omni/', frame('/omni/', 'Omni', omni)], ['/genie/', frame('/genie/', 'Genie', genie)],
    ['/cloud/', frame('/cloud/', 'Cloud', cloud)], ['/arca/', frame('/arca/', 'Arca', arcaPage)], ['/mykes/', frame('/mykes/', 'Mykes', coming('Mykes'))],
  ])
}
export function rootFiles() {
  const arcaSitemap = '<url><loc>https://automagik.si/arca/</loc></url> <url><loc>https://automagik.si/arca/llms.txt</loc></url> <url><loc>https://automagik.si/arca/index.md</loc></url>'
  return new Map([
    ['robots.txt', 'User-agent: *\nAllow: /\nAllow: /arca\nSitemap: https://automagik.si/sitemap.xml\n'],
    ['sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.filter(route => route !== '/arca/').map(route => `<url><loc>https://automagik.si${route}</loc></url>`).join('\n')}
${arcaSitemap}
</urlset>
`],
    ['llms.txt', `# Automagik

> Open building blocks of superintelligence.

## Building blocks

- [Automagik Desktop](https://automagik.si/desktop/): Mac and Linux downloads; install on Herdr or DSH.
- [Automagik Mobile](https://automagik.si/mobile/): the Android companion for your own machines.
- [Omni](https://automagik.si/omni/): connect chat apps to your agent team.
- [Genie](https://automagik.si/genie/): a wish, a branch, a test run and a report.
- [Cloud](https://automagik.si/cloud/): coming soon; register your interest.
- [Automagik Arca, the page](https://automagik.si/arca/)
- [Automagik Arca, for an assistant](https://automagik.si/arca/llms.txt)
- [Mykes](https://automagik.si/mykes/): coming soon.

## Crawling

All crawlers are allowed, including AI training crawlers. Preview responses remain noindex;
production becomes indexable only after the owner's approval.
`],
  ])
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = [...pages()].map(([route, html]) => [`${route.slice(1)}index.html`, html])
  for (const [path, text] of [...files, ...rootFiles()]) {
    const target = new URL(`../${path}`, import.meta.url)
    if (process.argv[2] === '--check') assert.equal(await readFile(target, 'utf8'), text, `Regenerate ${path}`)
    else { await mkdir(new URL('.', target), { recursive: true }); await writeFile(target, text) }
  }
}
