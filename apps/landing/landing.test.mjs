import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileText, scan } from '../../herdr/scripts/privacy-check.mjs'
import { supportPrivacy } from './waitlist/lib/ui.js'
import { themeCss } from './scripts/sync-theme.mjs'
import { pages, routes, rootFiles, weUnfold, arca, seal } from './scripts/build-pages.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)))
const read = path => readFileSync(resolve(root, path), 'utf8')
const theme = read('theme.css'), css = read('styles.css')
const captures = read('assets/CAPTURES.md')
const manifest = JSON.parse(read('assets/screens/manifest.json'))
const art = JSON.parse(read('assets/art/manifest.json'))
const release = JSON.parse(read('assets/releases.json')).pocket
const privacy = JSON.parse(read('../../herdr/scripts/privacy-list.json'))
const generated = pages()
const htmlAt = route => read(`${route.slice(1)}index.html`)
const repo = 'https://github.com/automagik-si/automagik'
const docs = 'https://docs.automagik.dev'
const downloads = [...['Mac.dmg', 'Linux.deb', 'Linux.AppImage'].map(name => `${repo}/releases/latest/download/Automagik-${name}`), release.url]
const allowed = new Set([repo, docs, ...downloads, ...routes.map(route => `https://automagik.si${route}`), 'mailto:privacy@automagik.si', weUnfold.url, 'https://weunfold.ai'])
// Text as a reader gets it: inline tags vanish, block tags become a space.
const plain = html => html.replace(/<\/?(?:a|span|strong)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const productOrder = ['/desktop/', '/mobile/', '/omni/', '/genie/', '/cloud/', '/arca/', '/mykes/']
const local = path => {
  const full = resolve(root, path.replace(/^\//, ''))
  assert.ok(full.startsWith(root + sep) || full === root.slice(0, -1), path)
  assert.ok(existsSync(full), path)
}

test('approved umbrella map, one h1 per page, generated sources current, no client scripting', () => {
  assert.deepEqual(routes, ['/', ...productOrder])
  for (const route of routes) {
    const html = htmlAt(route)
    assert.equal(html, generated.get(route), `Regenerate ${route}`)
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, route)
    assert.match(html, /<html lang="en">/)
    // Production is indexable: no page asks a search engine or an AI crawler to stay away.
    assert.doesNotMatch(html, /<meta[^>]*name="robots"|noindex|nofollow/i, route)
    assert.match(html, /href="\/theme.css"/)
    // The docs site is the one automagik.dev address the pages name, and only as a link.
    assert.doesNotMatch(html.replaceAll(`href="${docs}"`, ''), /<(?:script|iframe)\b|\bon\w+\s*=|javascript:|automagik\.dev|automagik-dev|\.pages\.dev/i)
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    assert.equal(new Set(ids).size, ids.length)
    assert.match(html, /class="skip" href="#main"/)
  }
  const home = htmlAt('/')
  assert.match(home, /id="film"/); assert.match(home, /id="blocks"/)
  assert.equal((home.match(/class="product-card"/g) ?? []).length, 7)
  assert.equal([...generated.values()].join('').match(/data-film=/g).length, 1)
  assert.match(home, /data-film="placeholder"/)
})

test('distribution order, real release links, no links for Windows or iPhone soon', () => {
  const desktop = htmlAt('/desktop/'), mobile = htmlAt('/mobile/')
  const desktopOrder = ['Download for Mac', 'Download for Linux', 'Download for Windows', 'Install on Herdr', 'Install on DSH'].map(text => desktop.indexOf(text))
  assert.ok(desktopOrder.every(index => index >= 0)); assert.deepEqual(desktopOrder, [...desktopOrder].sort((a, b) => a - b))
  assert.ok(mobile.indexOf('Download for Android') < mobile.indexOf('Download for iPhone'))
  for (const html of [desktop, mobile]) assert.doesNotMatch(html, /<a[^>]+>Download for (?:Windows|iPhone)/)
  assert.match(desktop, /Download for Windows<\/strong><span>Soon/)
  assert.match(mobile, /Download for iPhone<\/strong><span>Soon/)
  assert.ok(mobile.includes(release.url))
  assert.match(release.url, /^https:\/\/github.com\/automagik-si\/automagik\/releases\/download\/v[0-9.]+\/automagik-pocket-[0-9.]+\.apk$/)
  assert.match(release.sha256, /^[a-f0-9]{64}$/)
  assert.match(desktop, /Code mode needs Herdr and the pack; the app download alone does not set it up/)
  assert.match(desktop, /switch still says Work/)
  assert.match(htmlAt('/cloud/'), /Cloud is not live/)
  for (const route of ['/mykes/']) assert.match(htmlAt(route), /Coming soon\./)
})

test('every href/action points locally or to an exact reviewed destination', () => {
  for (const [route, html] of generated) {
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (/^[a-z]+:/i.test(href) || href.startsWith('//')) assert.ok(allowed.has(href), href)
      else {
        const url = new URL(href, `https://automagik.si${route}`)
        if (routes.includes(url.pathname)) {
          if (url.hash) assert.ok(htmlAt(url.pathname).includes(`id="${url.hash.slice(1)}"`), href)
        } else local(url.pathname)
      }
    }
    for (const [, action] of html.matchAll(/action="([^"]+)"/g)) assert.equal(action, '/api/waitlist')
    // Guides and help are on the docs site. GitHub is linked for the downloads and once,
    // quietly, at the end of the footer; no page links to a design document or to the
    // capture notes, which stay in the repository.
    const github = [...html.matchAll(/href="(https:\/\/github\.com[^"]*)"/g)].map(match => match[1]).filter(href => !downloads.includes(href))
    assert.deepEqual(github, [repo], route)
    assert.ok(html.slice(html.indexOf('class="footer-license"')).includes(`<a href="${repo}">Source code `), route)
    assert.doesNotMatch(html, /href="[^"]*(?:\/rfcs\/|CAPTURES\.md|raw\.githubusercontent)/, route)
  }
})

test('images are reviewed brand assets, unchanged captures or recorded crops of them', () => {
  // Arca's two icon files are its kit's, under the kit's own names.
  const brand = new Set(['/assets/brand/lockup.webp', '/assets/brand/mark.webp', '/assets/brand/omni-pleased.png', '/assets/brand/arca/svg/arca-icon-ink.svg', '/assets/brand/arca/svg/arca-icon-ivory.svg'])
  for (const html of generated.values()) {
    for (const [, value] of html.matchAll(/(?:src|srcset|poster)="([^"]+)"/g)) {
      for (const source of value.split(',').map(candidate => candidate.trim().split(/\s+/)[0])) {
        local(source)
        const derived = source.startsWith('/assets/art/') && Object.hasOwn(art.files, source.slice('/assets/art/'.length))
        assert.ok(brand.has(source) || derived || Object.hasOwn(manifest.images, source.replace(/^\/assets\/screens\//, '')), source)
      }
    }
    for (const [image] of html.matchAll(/<img\b[^>]*>/g)) {
      // Plain-words alt text, or an explicitly decorative image hidden from assistive technology.
      assert.match(image, /alt="[^"]{20,}"|alt="Automagik"|alt="" aria-hidden="true"/)
      assert.match(image, /\bwidth="\d+" height="\d+"/, image)
      assert.match(image, /loading="lazy"|fetchpriority="high"|decoding="async"|alt="Automagik"/, image)
    }
  }
  const files = readdirSync(resolve(root, 'assets/screens')).filter(file => file.endsWith('.png')).sort()
  assert.deepEqual(Object.keys(manifest.images).sort(), files)
  for (const file of files) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'assets/screens', file))).digest('hex'), manifest.images[file], file)
    assert.ok(captures.includes(file), file)
  }
  assert.equal(manifest.captureScriptsClean, true)
  assert.equal(manifest.themeCapture.runtime.version, '0.2.2-rc.1')
  assert.equal(manifest.themeCapture.reports.length, 4)
  assert.deepEqual(manifest.pocketCapture.images.toSorted(), files.filter(file => file.startsWith('pocket-')))
  assert.ok(existsSync(resolve(root, 'capture/pocket/PocketDemoShotsTest.kt')))
})

test('derived art: each file is one recorded rectangle of a hashed source, at 1x and 2x', () => {
  const files = readdirSync(resolve(root, 'assets/art')).filter(file => file !== 'manifest.json').sort()
  assert.deepEqual(Object.keys(art.files).sort(), files)
  for (const [file, entry] of Object.entries(art.files)) {
    assert.match(file, /^[a-z0-9-]+\.webp$/)
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'assets/art', file))).digest('hex'), entry.sha256, file)
    const source = resolve(root, '../..', entry.source)
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), entry.sourceSha256, `${file} source changed: rebuild the art`)
    // A crop of a capture comes from the unchanged, provenance-backed file itself.
    if (entry.source.startsWith('apps/landing/assets/screens/')) assert.equal(entry.sourceSha256, manifest.images[entry.source.split('/').pop()], file)
    else assert.ok(/^apps\/(?:desktop|bots-dsh|landing)\/(?:assets|src)\//.test(entry.source), entry.source)
    assert.equal(entry.rect.length, 4)
    // An app capture never sits as a bright box on a dark page: each crop has a twin cut from
    // the dark capture of the same view, with the same rectangle (the pack's share image is
    // dark in both).
    if (entry.source.startsWith('apps/landing/assets/screens/') && !entry.source.endsWith('/code-sidebar.png')) {
      const other = art.files[/-dark(?:-2x)?\.webp$/.test(file) ? file.replace('-dark', '') : file.replace(/(-2x)?\.webp$/, '-dark$1.webp')]
      assert.ok(other, `${file} needs its light or dark twin`)
      assert.deepEqual(other.rect, entry.rect, file)
      const view = source => source.replace(/-(?:light|dark)\.png$/, '.png')
      assert.equal(view(other.source), view(entry.source), file)
      assert.notEqual(other.source, entry.source, file)
    }
    const twin = file.endsWith('-2x.webp') ? file.replace('-2x.webp', '.webp') : file.replace('.webp', '-2x.webp')
    assert.ok(Object.hasOwn(art.files, twin), `${file} needs its ${twin}`)
  }
  for (const [file, entry] of Object.entries(art.files)) {
    if (!file.endsWith('-2x.webp')) assert.ok(art.files[file.replace('.webp', '-2x.webp')].width >= entry.width * 1.5, `${file}: 2x is too small`)
  }
})

test('only Cloud carries the add/removal forms, fields, explicit consent and privacy', () => {
  for (const route of routes) {
    const forms = htmlAt(route).match(/<form\b/g) ?? []
    assert.equal(forms.length, route === '/cloud/' ? 2 : 0, route)
  }
  const html = htmlAt('/cloud/')
  assert.equal((html.match(/method="post" action="\/api\/waitlist"/g) ?? []).length, 2)
  for (const field of ['goal', 'platform', 'apps', 'expected_result', 'channel', 'language', 'email', 'consent']) assert.ok(html.includes(`name="${field}"`), field)
  assert.match(html, /name="goal" required maxlength="1000"/)
  assert.match(html, /name="apps" maxlength="200"/)
  assert.match(html, /name="expected_result" required maxlength="500"/)
  assert.match(html, /type="checkbox" name="consent" value="yes" required/)
  for (const text of ['Namastex Labs', 'European Union', 'Resend', 'WhatsApp/Meta', 'opaque sender ID', 'ANPD', 'six months', 'withdraw consent', 'Remove my details']) assert.ok(html.includes(text), text)
})

test('theme primitives match the app source, with keyboard and motion support', () => {
  assert.equal(theme, themeCss())
  for (const source of [...(theme + css).matchAll(/url\("([^"]+)"\)/g)].map(match => match[1])) local(source)
  assert.match(css, /background:var\(--st-stage\)/)
  assert.match(css, /:focus-visible/)
  assert.match(theme, /prefers-color-scheme:dark/)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.doesNotMatch(css, /overflow-x:\s*hidden/)
})

test('motion: only for visitors who allow it, only transform and opacity, and never Arca\'s logo', () => {
  // Scroll-driven motion, page transitions and the entrances all sit inside the one
  // no-preference block; a visitor who asks for reduced motion gets none of it.
  const start = css.indexOf('@media (prefers-reduced-motion:no-preference){'), end = css.indexOf('@keyframes page-out')
  assert.ok(start > 0 && end > start)
  const outside = css.slice(0, start) + css.slice(end)
  assert.doesNotMatch(outside, /animation-timeline|view-timeline|@view-transition|@starting-style|view-transition-name/)
  const motion = css.slice(start, end)
  for (const feature of ['@view-transition{navigation:auto}', '@supports (animation-timeline:view())', 'animation-timeline:view()', 'animation-timeline:scroll(root)', '@starting-style']) assert.ok(motion.includes(feature), feature)
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{html\{scroll-behavior:auto\}\*,\*::before,\*::after\{animation:none!important;transition:none!important\}\}/)
  // Nothing that moves can shift the layout: keyframes and transitions touch only these.
  const still = new Set(['opacity', 'translate', 'scale', 'rotate', 'transform'])
  const frames = [...css.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^{}]*\})+)\}/g)]
  assert.ok(frames.length >= 15)
  for (const [, name, body] of frames) for (const [, property] of body.matchAll(/[{;]\s*([a-z-]+):/g)) assert.ok(still.has(property), `@keyframes ${name} animates ${property}`)
  for (const [, list] of css.matchAll(/transition:([^;}]+)/g)) {
    for (const part of list.replace(/\([^)]*\)/g, '').split(',')) assert.match(part.trim(), /^(?:opacity|translate|scale|rotate|transform|box-shadow|border-color|background|color|none)\b/, `transition: ${part}`)
  }
  // Arca's rule: its logo is never animated here. No motion rule names it, and the heading's
  // entrance skips it.
  assert.ok(motion.includes('.hero-heading>:not(.arca-mark){animation:'))
  assert.equal(motion.split('arca-mark').length, 2)
})

test('all landing files pass privacy; no tracking or preview URL is committed', () => {
  const walk = folder => {
    for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
      const path = `${folder}${folder ? '/' : ''}${entry.name}`
      if (entry.isDirectory()) walk(path)
      else assert.deepEqual(scan(`apps/landing/${path}`, fileText(readFileSync(resolve(root, path))), privacy), [], path)
    }
  }
  walk('')
  for (const html of generated.values()) assert.doesNotMatch(html, /(?:gtag|googletagmanager|google-analytics|plausible\.io)/i)
  // The site's own headers never keep a crawler out; previews get Cloudflare Pages' own header.
  assert.equal(read('_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n')
})


test('Arca has exactly one stand-in page here; home links to its same-tab canonical path', () => {
  // Arca's own site takes this address over later. Until then Pages carries this one page
  // and nothing under it; the root discovery files keep Arca's own lines (next test).
  assert.deepEqual(readdirSync(resolve(root, 'arca')), ['index.html'])
  assert.deepEqual(routes.filter(route => route.startsWith('/arca')), ['/arca/'])
  const page = htmlAt('/arca/')
  assert.match(page, /<h1>Arca<\/h1><p class="intro">([^<]+)<\/p>/)
  assert.equal(page.match(/<h1>Arca<\/h1><p class="intro">([^<]+)<\/p>/)[1], arca.line)
  // The owner's own line, exactly, wherever Arca is described: the page, the home block,
  // the Products menu and the phone sheet on every page.
  assert.equal(arca.line, 'Be your own cloud. Infrastructure for AI agents.')
  for (const [route, html] of generated) {
    const said = [...html.matchAll(/<strong>Arca<\/strong><span>([^<]*)<\/span>/g)].map(match => match[1])
    assert.deepEqual(said, [arca.line, arca.line], `${route}: the menu and the sheet say Arca's line`)
  }
  // Get Arca opens this page, where the install command is text to copy. The installer's
  // address answers with a shell script, so no link anywhere points at it.
  assert.equal(arca.install, 'curl -fsSL https://get.automagik.si/arca | sh')
  assert.equal(arca.needs, 'Today it needs a Linux machine (x86_64) with Incus, and a person comfortable with a terminal.')
  assert.ok(page.includes(`<div class="install-line"><h2 id="get">Get Arca</h2><pre><code>${arca.install}</code></pre><p>${arca.needs}</p></div>`))
  for (const [route, html] of generated) assert.doesNotMatch(html, /href="[^"]*(?:get\.automagik\.si|automagik-si\/arca)/, `${route}: neither the installer nor Arca's repository is a link`)
  assert.match(page, /<a class="button secondary" href="\/#blocks">All products /)
  assert.doesNotMatch(page, /Coming soon\.<\/p><p class="lede">/)
  const card = htmlAt('/').match(/<article class="product-card" data-block="arca">[\s\S]*?<\/article>/)?.[0]
  assert.ok(card?.includes(`<h3><a href="/arca/">Arca</a></h3><p>${arca.line}</p><span class="detail-link" aria-hidden="true">Get Arca →</span>`))
  // The card says only Arca's name and the owner's line: no tag of guessed wording.
  assert.doesNotMatch(card, /tile-tag/)
  // Arca's own logo stands wherever Arca does, never another product's mark: its kit's icon,
  // ink in light and ivory in dark. The two menus, the home card and the page's heading
  // each carry one; nothing else does, and it never stands with the Open Intelligence seal.
  const slot = /<span class="arca-mark at-(\w+)"><picture><source media="\(prefers-color-scheme: dark\)" srcset="\/assets\/brand\/arca\/svg\/arca-icon-ivory\.svg"><img src="\/assets\/brand\/arca\/svg\/arca-icon-ink\.svg" width="64" height="64" alt="" aria-hidden="true" decoding="async"><\/picture><\/span>/g
  // The kit's files, never redrawn here: one colour each, Arca's ink and Arca's ivory.
  for (const [tone, colour] of [['ink', '#2a1d12'], ['ivory', '#ebe6da']]) {
    const icon = readFileSync(resolve(root, `assets/brand/arca/svg/arca-icon-${tone}.svg`), 'utf8')
    assert.deepEqual([...new Set([...icon.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(match => match[0].toLowerCase()))], [colour], tone)
    assert.doesNotMatch(icon, /gradient|filter|<animate|<script|<image|href=/i, tone)
  }
  assert.deepEqual(readdirSync(resolve(root, 'assets/brand/arca/svg')).sort(), ['arca-icon-ink.svg', 'arca-icon-ivory.svg'])
  for (const [route, html] of generated) {
    const places = [...html.matchAll(slot)].map(match => match[1])
    assert.deepEqual(places, ['menu', 'menu', ...(route === '/' ? ['card'] : route === '/arca/' ? ['hero'] : [])], route)
    assert.equal((html.match(/arca-mark/g) ?? []).length, places.length, route)
    for (const [item] of html.matchAll(/<a class="menu-item" href="\/arca\/"[\s\S]*?<\/a>/g)) assert.doesNotMatch(item, /<img[^>]*\/assets\/(?:art|brand\/(?:mark|lockup))/, route)
    assert.doesNotMatch(html.slice(html.indexOf('<div class="footer-open">')), /arca-mark|<img/, route)
  }
  assert.doesNotMatch(page.match(/<main[\s\S]*<\/main>/)[0].split('class="more ')[0], /<img[^>]*\/assets\/(?:art|brand\/(?:mark|lockup))/)
  for (const html of generated.values()) for (const [link] of html.matchAll(/<a\b[^>]*href="\/arca\/"[^>]*>/g)) assert.doesNotMatch(link, /target=/)
  // The root sitemap lists Arca only through Arca's own supplied line.
  assert.equal(read('sitemap.xml').split('https://automagik.si/arca/</loc>').length, 2)
})

test('we unfold and Open Intelligence: the approved wording, from one constant, on every page', () => {
  assert.equal(weUnfold.url, 'https://weunfold.ai/')
  assert.equal(weUnfold.partOf, 'Automagik is part of we unfold, the home of the Open Intelligence movement.')
  assert.equal(weUnfold.openIntelligence, 'Open Intelligence: a future more people can understand, question, and shape.')
  for (const [route, html] of generated) {
    const text = plain(html)
    // Every footer carries we unfold's official seal, byte for byte as given, once, beside
    // the Apache-2.0 line (it marks the part built in the open), with "Support Open
    // Intelligence" as link text beside it and never drawn into it. The part-of line stays
    // in the footer and in the Company menu. Automagik's own stamp is gone.
    const footer = html.slice(html.indexOf('<footer'))
    assert.equal(html.split(seal).length, 2, route)
    assert.ok(footer.includes(`<div class="footer-open">${seal}<div class="footer-open-copy"><p class="footer-open-label"><a href="${weUnfold.url}">Support Open Intelligence `), route)
    assert.match(footer.slice(footer.indexOf('footer-open-copy')), /^[^]*?<p class="footer-license">[^<]*Apache-2\.0/, route)
    assert.ok(plain(footer).includes(weUnfold.partOf), route)
    assert.doesNotMatch(html, /class="stamp|seal-ring|stamp-ink/, route)
    assert.ok(plain(html.match(/id="menu-company"[\s\S]*?<\/div><\/div>/)[0]).includes(weUnfold.partOf), route)
    assert.ok(html.includes(`<a href="${weUnfold.url}">we unfold</a>`), route)
    // Open Intelligence keeps both capitals and is never shortened; we unfold is lower case
    // in running text and one word only in its address; it is a movement, not an owner.
    for (const [found] of text.matchAll(/open intelligence/gi)) assert.equal(found, 'Open Intelligence', route)
    for (const [found] of html.matchAll(/we ?unfold/gi)) assert.ok(found === 'we unfold' || found === 'weunfold', `${route}: ${found}`)
    assert.equal(html.split('weunfold').length, html.split(/https:\/\/weunfold\.ai[\/"]/).length, route)
    assert.doesNotMatch(text, /\bby we unfold\b|\bwe unfold (?:product|company)\b|\bOI\b/i, route)
    assert.doesNotMatch(html, /<img[^>]*unfold/i, route)
  }
  const home = plain(htmlAt('/').match(/<main[\s\S]*<\/main>/)[0])
  assert.ok(home.includes(weUnfold.openIntelligence) && home.includes(weUnfold.partOf))
  // The seal is we unfold's own file: its link, its title, its words in the page's colour.
  assert.equal(seal, read('assets/brand/open-intelligence/site-seal-full-colour.snippet.html').trim())
  assert.match(seal, /^<!-- Open Intelligence seal -->\n<a href="https:\/\/weunfold\.ai" title="Open Intelligence: built in the open" style="display:inline-block;line-height:0;color:inherit;text-decoration:none"><svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 200 200" width="96" height="96" role="img" aria-label="Open Intelligence">/)
  // The file as the Unfold team handed it over; a new seal file is a reviewed change here.
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'assets/brand/open-intelligence/site-seal-full-colour.snippet.html'))).digest('hex'), '93cd10bc5b30c5de8a8d982ff1e4fc96793de482329e6e8decb0df5c7e03f14c')
})

test('navigation: menus, phone menu, footer sitemap, breadcrumb and previous/next on every page', () => {
  const hrefs = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1])
  for (const [route, html] of generated) {
    // Three header menus: a button that opens a popover panel, no scripting.
    const buttons = [...html.matchAll(/<button class="menu-button" type="button" popovertarget="(menu-[a-z]+)"/g)].map(match => match[1])
    assert.deepEqual(buttons, ['menu-products', 'menu-resources', 'menu-company'], route)
    for (const id of [...buttons, 'site-menu']) assert.match(html, new RegExp(`id="${id}" popover`), `${route} ${id}`)
    assert.match(html, /<button class="menu-open" type="button" popovertarget="site-menu">/, route)
    // The browser owns the expanded state of a popover's button; a written one would go stale.
    assert.doesNotMatch(html, /aria-expanded=/, route)
    const panel = id => html.match(new RegExp(`id="menu-${id}" popover>([\\s\\S]*?)</div></div></li>`))[1]
    const sheet = html.match(/<nav class="drawer"[\s\S]*?<\/nav>/)[0], footer = html.slice(html.indexOf('<footer'))
    const group = (source, label, end) => source.slice(source.indexOf(`>${label}</`), end ? source.indexOf(`>${end}</`) : undefined)
    // Products: the seven, in one order, in the menu, the phone menu and the footer.
    assert.deepEqual(hrefs(panel('products')).slice(0, 7), productOrder, route)
    assert.deepEqual(hrefs(group(sheet, 'Products', 'Resources')), productOrder, route)
    assert.deepEqual(hrefs(group(footer, 'Products', 'Resources')), productOrder, route)
    // Resources and Company: the same links in the menu, the phone menu and the footer.
    const resources = hrefs(panel('resources')), company = hrefs(panel('company')).slice(0, 3)
    assert.deepEqual(resources, [docs, '/desktop/#install', '/mobile/#install'], route)
    assert.deepEqual(company, [weUnfold.url, docs, '/cloud/#privacy'], route)
    assert.deepEqual(hrefs(group(sheet, 'Resources', 'Company')), resources, route)
    assert.deepEqual(hrefs(group(sheet, 'Company')).slice(0, 3), company, route)
    assert.deepEqual(hrefs(group(footer, 'Resources', 'Company')), resources, route)
    assert.deepEqual(hrefs(group(footer, 'Company')).slice(0, 3), company, route)
    // Every menu entry has a one-line description and its character, mark or glyph.
    for (const source of [panel('products'), panel('resources'), panel('company'), sheet]) {
      for (const [item] of source.matchAll(/<a class="menu-item"[\s\S]*?<\/a>/g)) assert.match(item, /<span class="menu-icon">(?:<img|<svg|<span class="arca-mark)[\s\S]*<strong>[^<]+[\s\S]*<\/strong><span>[^<]{8,}<\/span>/, `${route} ${item.slice(0, 80)}`)
    }
    // The active page: marked in the header button, the menu, the phone menu and the footer.
    const current = (html.match(/aria-current="page"/g) ?? []).length
    if (route === '/') {
      assert.equal(current, 0); assert.doesNotMatch(html, /class="crumbs|class="pager/)
      continue
    }
    const name = html.match(/<span aria-current="page">([^<]+)<\/span>/)[1]
    assert.ok(html.includes(`data-here>Products<span class="menu-here"><span class="sr">, current page: </span>${name}</span>`), route)
    for (const source of [panel('products'), sheet, footer]) assert.ok(source.includes(`href="${route}" aria-current="page"`), route)
    assert.equal(current, 4, route)
    // The way back, and the neighbours in the product order.
    assert.ok(html.includes(`<nav class="crumbs wrap" aria-label="Breadcrumb"><ol><li><a href="/#blocks">All products</a></li><li><span aria-current="page">${name}</span></li></ol></nav>`), route)
    const at = productOrder.indexOf(route), step = by => productOrder[(at + by + productOrder.length) % productOrder.length]
    assert.ok(html.includes(`rel="prev" href="${step(-1)}"`) && html.includes(`rel="next" href="${step(1)}"`), route)
    assert.match(html, /<a class="pager-all" href="\/#blocks">All products<\/a>/, route)
  }
})

test('root discovery files allow every crawler including training and preserve Arca lines', () => {
  for (const [path, text] of rootFiles()) assert.equal(read(path), text, path)
  const robots = read('robots.txt')
  assert.match(robots, /^User-agent: \*\nAllow: \/\nAllow: \/arca\n/m)
  assert.doesNotMatch(robots, /Disallow|ai-train=no|ai-input=no/i)
  const sitemap = read('sitemap.xml')
  for (const route of routes) assert.ok(sitemap.includes(`<url><loc>https://automagik.si${route}</loc></url>`))
  assert.ok(!existsSync(resolve(root, 'arca/llms.txt')) && !existsSync(resolve(root, 'arca/index.md')))
  assert.ok(sitemap.includes('<url><loc>https://automagik.si/arca/</loc></url> <url><loc>https://automagik.si/arca/llms.txt</loc></url> <url><loc>https://automagik.si/arca/index.md</loc></url>'))
  for (const line of ['- [Automagik Arca, the page](https://automagik.si/arca/)', '- [Automagik Arca, for an assistant](https://automagik.si/arca/llms.txt)']) assert.ok(read('llms.txt').split('\n').includes(line))
  assert.doesNotMatch(read('_headers'), /X-Robots-Tag|noindex|nofollow/i)
  assert.doesNotMatch(read('llms.txt'), /noindex/i)
})

test('WhatsApp remains visible with the English and Portuguese delay notice', () => {
  const html = htmlAt('/cloud/')
  assert.match(html, /<option value="whatsapp">WhatsApp/)
  assert.match(html, /WhatsApp confirmation may take a little while/)
  assert.match(html, /lang="pt-BR">A confirmação pelo WhatsApp pode demorar um pouco/)
})


test('approved WhatsApp support privacy is verbatim in English with its Portuguese counterpart', () => {
  const markup = supportPrivacy()
  const english = markup.match(/<section lang="en"[\s\S]*?<\/section>/)[0]
  const plain = text => text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const approved = read('waitlist/privacy-support.en.md').replace(/^## /, '')
  assert.equal(plain(english), plain(approved))
  const portuguese = markup.match(/<section lang="pt-BR"[\s\S]*?<\/section>/)[0]
  assert.equal(plain(portuguese), plain(read('waitlist/privacy-support.pt-BR.md').replace(/^## /, '')))
  for (const phrase of ['nunca inicia a conversa', 'seu próprio sandbox', 'nada é excluído automaticamente', 'modelo de IA', 'Não vendemos seus dados', 'baixar sua conversa ou reiniciá-la', 'nunca armazena o texto da sua mensagem']) assert.ok(plain(portuguese).includes(phrase), phrase)
  const html = htmlAt('/cloud/')
  assert.ok(html.includes(markup))
  assert.match(html, /180 days after code expiry/)
})


test('every public page forbids internal delivery and product-team jargon, including attributes', async () => {
  const forbidden = /\b(?:D[1-9]|GTM|rail|release\s+lane|lane)\b/i
  function inspect(directory = '') {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isDirectory()) inspect(path)
      else if (path.endsWith('.html')) assert.doesNotMatch(read(path), forbidden, path)
    }
  }
  inspect()
  // The shared dynamic form/confirmation pages expose the same privacy copy.
  const { onRequest } = await import('./functions/api/waitlist.js')
  const response = await onRequest({ request: new Request('https://automagik.si/api/waitlist'), env: {} })
  assert.doesNotMatch(await response.text(), forbidden, '/api/waitlist')
})
