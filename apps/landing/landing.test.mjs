import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileText, scan } from '../../herdr/scripts/privacy-check.mjs'
import { supportPrivacy } from './waitlist/lib/ui.js'
import { themeCss } from './scripts/sync-theme.mjs'
import { pages, routes, rootFiles, weUnfold, arca, oiTag, platforms, offered } from './scripts/build-pages.mjs'
import { GEOMETRY, LOGO, TONES, tagInner } from './scripts/build-lockup.mjs'

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
const allowed = new Set([repo, docs, ...downloads, ...routes.map(route => `https://automagik.si${route}`), 'mailto:privacy@automagik.si', weUnfold.url])
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

test('the download hook: live platforms open a sheet with the exact file, soon ones are not controls', () => {
  assert.deepEqual(Object.keys(offered), ['/', '/desktop/', '/mobile/'])
  assert.deepEqual(Object.keys(platforms).filter(id => platforms[id].soon), ['windows', 'iphone'])
  for (const [route, ids] of Object.entries(offered)) {
    const html = htmlAt(route)
    const row = html.match(/<ul class="get-row">(.*?)<\/ul>/)[1]
    const chips = row.split('</li>').slice(0, -1)
    assert.equal((html.match(/class="get-row"/g) ?? []).length, 1, route)
    assert.deepEqual(chips.map(chip => chip.match(/class="get-name">([^<]+)</)[1]), ids.map(id => platforms[id].name), route)
    const sheets = new Map([...html.matchAll(/<div class="sheet" id="get-([a-z]+)" popover role="dialog" aria-labelledby="get-\1-title">([\s\S]*?)(?=<div class="sheet" id=|<\/body>)/g)].map(match => [match[1], match[2]]))
    assert.deepEqual([...sheets.keys()], ids.filter(id => !platforms[id].soon), route)
    ids.forEach((id, index) => {
      const chip = chips[index], platform = platforms[id]
      if (platform.soon) {
        // Coming later: a label, never a link or a button, and no file is named for it.
        assert.match(chip, /^<li class="get-chip soon">/, `${route} ${id}`)
        assert.doesNotMatch(chip, /<a\b|<button\b|href=|popovertarget/, `${route} ${id}`)
        assert.match(chip, /<small class="get-kind">Soon<\/small>$/, `${route} ${id}`)
        return
      }
      // One button that opens this platform's sheet, and a plain link for a browser without popovers.
      assert.equal((chip.match(/<button\b/g) ?? []).length, 1, `${route} ${id}`)
      assert.match(chip, new RegExp(`<button class="get-chip" type="button" popovertarget="get-${id}" aria-label="${platform.name}: `), `${route} ${id}`)
      const fallback = chip.match(/<a class="get-chip get-fallback" href="([^"]+)">/)[1]
      assert.equal(fallback, route === '/' ? `${platform.page}#install` : platform.download[1], `${route} ${id}`)
      const sheet = sheets.get(id)
      assert.match(sheet, new RegExp(`<h2 id="get-${id}-title" tabindex="-1" autofocus>For ${platform.name}</h2>`))
      assert.match(sheet, /<button class="sheet-close" type="button" popovertarget="get-[a-z]+" popovertargetaction="hide" aria-label="Close">/)
      assert.ok(sheet.includes(`<p class="sheet-gets">${platform.gets}</p>`), `${route} ${id}`)
      // The file the sheet names is the file its one download button fetches.
      const links = [...sheet.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1])
      const files = links.filter(href => downloads.includes(href))
      assert.deepEqual(files.sort(), [platform.download[1], ...(platform.other ? [platform.other[2]] : [])].sort(), `${route} ${id}`)
      assert.deepEqual([...sheet.matchAll(/<a class="button primary" href="([^"]+)"/g)].map(match => match[1]), [platform.download[1]], `${route} ${id}`)
      assert.equal(platform.download[1].split('/').pop(), platform.file, id)
      assert.ok(sheet.includes(`<dt>File</dt><dd><code>${platform.file}</code></dd>`), `${route} ${id}`)
      assert.ok(sheet.includes(`>${platform.download[0]} `), `${route} ${id}`)
      // How to install, here, and one link to the guide on the docs site.
      assert.ok((sheet.match(/<ol class="steps">(.*?)<\/ol>/)[1].match(/<li>/g) ?? []).length >= 2, `${route} ${id}`)
      assert.deepEqual(links.filter(href => href.startsWith(docs)).length, 1, `${route} ${id}`)
      assert.match(sheet, new RegExp(`<a class="detail-link" href="${docs}[^"]*">${platform.name} guide `))
      assert.equal(links.includes(platform.page), route === '/', `${route} ${id}`)
    })
    // Nothing on a page offers a download for a platform that has none.
    assert.doesNotMatch(html, /Download for (?:Windows|iPhone)|\.exe\b|\.msi\b|\.ipa\b|apps\.apple\.com/i, route)
  }
  for (const route of routes.filter(route => !(route in offered))) assert.doesNotMatch(htmlAt(route), /class="get-row"|class="sheet"/, route)
  const mobile = htmlAt('/mobile/'), desktop = htmlAt('/desktop/')
  assert.equal(platforms.android.download[1], release.url)
  assert.match(release.url, /^https:\/\/github.com\/automagik-si\/automagik\/releases\/download\/v[0-9.]+\/automagik-pocket-[0-9.]+\.apk$/)
  assert.match(release.sha256, /^[a-f0-9]{64}$/)
  for (const html of [mobile, htmlAt('/')]) assert.ok(html.replaceAll('<wbr>', '').includes(`<code class="sum">${release.sha256}</code>`))
  // Herdr and DSH: two short entries after the downloads, each with one link to its guide and no commands.
  const ways = desktop.match(/<ul class="way-list">(.*?)<\/ul>/)[1]
  assert.ok(desktop.indexOf('class="get-row"') < desktop.indexOf('class="way-list"'))
  assert.deepEqual([...ways.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1]), ['Install on Herdr', 'Install on DSH'])
  assert.deepEqual([...ways.matchAll(/<a class="detail-link" href="([^"]+)">(\w+) guide /g)].map(match => [match[1].startsWith(docs), match[2]]), [[true, 'Herdr'], [true, 'DSH']])
  assert.equal((ways.match(/<a\b/g) ?? []).length, 2)
  assert.doesNotMatch(ways, /<code\b|<pre\b/)
  assert.match(ways, /It needs Herdr and the Automagik pack; the app alone does not set it up\./)
  assert.match(desktop, /switch still says Work/)
  assert.match(htmlAt('/cloud/'), /Cloud is not live/)
  for (const route of ['/mykes/']) assert.match(htmlAt(route), /Coming soon\./)
  // The sheet is a popover: no script. It moves only for visitors who allow motion, and a
  // browser without popovers gets the plain links instead of dead buttons.
  assert.match(css, /@supports not selector\(:popover-open\)\{[^}]*\n?\s*button\.get-chip,\.sheet\{display:none !important\}/)
  assert.match(css, /\.get-fallback\{display:none\}/)
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
    for (const [, action] of html.matchAll(/\saction="([^"]+)"/g)) assert.equal(action, '/api/waitlist')
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
  const brand = new Set(['/assets/brand/lockup.webp', '/assets/brand/mark.webp', '/assets/brand/omni-pleased.png', '/assets/brand/arca/svg/arca-icon-ink.svg', '/assets/brand/arca/svg/arca-icon-ivory.svg', '/assets/brand/automagik/automagik-lockup-oi-ink.svg', '/assets/brand/automagik/automagik-lockup-oi-cream.svg'])
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
  // each carry one; nothing else does, and it never stands with the Open Intelligence tag.
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
    assert.doesNotMatch(html.slice(html.indexOf('<div class="footer-end">')), /arca-mark|<img/, route)
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
    // The tag's own words are capitals inside the tag; the wording rules are for sentences.
    const text = plain(html.replace(oiTag, ''))
    // The part-of line stays in the footer and in the Company menu, never beside the tag.
    const footer = html.slice(html.indexOf('<footer'))
    assert.ok(plain(footer.slice(0, footer.indexOf('<div class="footer-end">'))).includes(weUnfold.partOf), route)
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
})

test('Open Intelligence is applied as on Arca\'s site: the horizontal tag in the footer, and the official lockup', () => {
  // The tag is we unfold's file, pasted as given: one colour (the text colour around it), its
  // own words, no round seal anywhere. A new tag file is a reviewed change here.
  assert.equal(oiTag, read('assets/brand/open-intelligence/open-intelligence-tag.svg').trim())
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'assets/brand/open-intelligence/open-intelligence-tag.svg'))).digest('hex'), '5fc165fb016108292d99eb21bc3ba7f3fcd8a1cb6d96ce14501c3a26c332666c')
  assert.match(oiTag, /^<svg id="oi-badge-ink-kit" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 340 64" width="340" height="64" role="img" aria-label="Open Intelligence badge, one colour">/)
  assert.match(oiTag, /<text x="68" y="39" font-family="IBM Plex Mono, monospace" font-size="18" font-weight="600" letter-spacing="3\.2" fill="currentColor">OPEN INTELLIGENCE<\/text><\/svg>$/)
  assert.deepEqual([...new Set([...oiTag.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map(match => match[1]))].sort(), ['currentColor', 'none'])
  assert.deepEqual(readdirSync(resolve(root, 'assets/brand/open-intelligence')), ['open-intelligence-tag.svg'])
  for (const [route, html] of generated) {
    // Footer: the last row ends with the tag, a link to we unfold that holds nothing but the
    // tag. No words in the link, no sentence about it, no seal, and the tag nowhere else.
    assert.ok(html.includes(`<span aria-hidden="true">↗</span></a></p><a class="oi-tag" href="${weUnfold.url}">${oiTag}</a></div></div></footer>`), route)
    assert.match(html, /<div class="footer-end"><p class="footer-license">[^<]*Apache-2\.0[^<]*<a href="https:\/\/github\.com\/automagik-si\/automagik">Source code /, route)
    assert.equal(html.split(oiTag).length, 2, route)
    assert.equal(html.split('OPEN INTELLIGENCE').length, 2, route)
    assert.doesNotMatch(html, /Support Open Intelligence|Open Intelligence seal|site-seal|footer-open|class="stamp|seal-ring/, route)
    // The official lockup is shown once, on the home page's brand block: never in a header,
    // a hero, the favicon or a share picture.
    assert.equal(html.split('automagik-lockup-oi').length, route === '/' ? 7 : 1, route)
    assert.doesNotMatch(html.slice(0, html.indexOf('<main')), /lockup-oi|oi-tag|oi-badge/, route)
    assert.doesNotMatch(html, /<meta[^>]*(?:og:image|twitter:image)/, route)
  }
  const block = htmlAt('/').match(/<section id="brand" class="wrap kit"[\s\S]*?<\/section>/)[0]
  assert.ok(block.includes('<picture><source media="(prefers-color-scheme: dark)" srcset="/assets/brand/automagik/automagik-lockup-oi-cream.svg"><img src="/assets/brand/automagik/automagik-lockup-oi-ink.svg" width="902" height="340" alt="The Automagik logo, with the Open Intelligence tag under it at the right" loading="lazy" decoding="async"></picture>'))
  assert.deepEqual([...block.matchAll(/href="([^"]+)" download/g)].map(match => match[1]), ['ink.svg', 'ink.png', 'cream.svg', 'cream.png'].map(name => `/assets/brand/automagik/automagik-lockup-oi-${name}`))
  assert.ok(htmlAt('/').indexOf('<section id="brand"') > htmlAt('/').indexOf('<section id="film"'))
  // Size and colour, as Arca's footer: 170 by 32 px in the footer's text colour, never an
  // effect on it, and never bigger than the logo it sits with (the logo's word alone, 676 of
  // the lockup's 902 px, passes 170 px).
  assert.match(css, /\.oi-tag,\.oi-tag:hover\{flex:none;display:block;border-radius:16px;color:var\(--text\)\}\n\.oi-tag svg\{width:170px;height:32px;max-width:none\}/)
  for (const [rule] of css.matchAll(/[^{}]*oi-tag[^{}]*\{[^}]*\}/g)) assert.doesNotMatch(rule, /filter|shadow|stroke|outline|opacity|transform|scale|rotate|animation|transition|background/, rule)
  const footerLogo = Number(css.match(/\.footer-brand \.brand img\{width:(\d+)px\}/)[1])
  assert.ok(footerLogo * 676 / 902 >= 170, 'the footer logo\'s word is at least as wide as the tag')
  assert.equal([...css.matchAll(/\.brand img\{width:\d+px\}/g)].length, 4, 'no narrower footer logo at any width')
  assert.match(css, /@media \(max-width:700px\)\{\.footer-end\{flex-direction:column;align-items:flex-start\}\}/)
  assert.match(css, /@font-face\{font-family:"IBM Plex Mono";font-style:normal;font-weight:600;font-display:block;src:url\("assets\/brand\/ibm-plex-mono-latin-600\.woff2"\) format\("woff2"\)\}/)
  // The lockup files: Automagik's logo, unchanged, with the tag under it, right edges
  // together, the tag 170/275 of the logo's width (Arca's proportion), one colour per ground.
  assert.deepEqual(readdirSync(resolve(root, 'assets/brand/automagik')).sort(), ['automagik-lockup-oi-cream.png', 'automagik-lockup-oi-cream.svg', 'automagik-lockup-oi-ink.png', 'automagik-lockup-oi-ink.svg'])
  assert.ok(Math.abs(GEOMETRY.scale * 340 / LOGO.width - 170 / 275) < 1e-9 && Math.abs(GEOMETRY.x + 340 * GEOMETRY.scale - LOGO.width) < 1e-9 && GEOMETRY.y > LOGO.height)
  assert.deepEqual(TONES, { ink: '#3c3049', cream: '#f3e9dd' })
  const font = readFileSync(resolve(root, 'assets/brand/ibm-plex-mono-latin-600.woff2')).toString('base64')
  const size = png => [png.readUInt32BE(16), png.readUInt32BE(20), png[25]]
  for (const [tone, colour] of Object.entries(TONES)) {
    const svg = read(`assets/brand/automagik/automagik-lockup-oi-${tone}.svg`)
    assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 902 340.02" width="902" height="340.02" color="${colour}" role="img" aria-label="Automagik, with the Open Intelligence tag"><style>@font-face{font-family:"IBM Plex Mono";font-weight:600;src:url(data:font/woff2;base64,${font}) format("woff2")}</style><image href="data:image/png;base64,`), tone)
    assert.ok(svg.endsWith(`" width="902" height="192"/><g transform="translate(344.40 235.06) scale(1.64000)">${tagInner()}</g></svg>\n`), tone)
    assert.deepEqual(size(Buffer.from(svg.match(/<image href="data:image\/png;base64,([^"]+)"/)[1], 'base64')), [902, 192, 6], tone)
    assert.deepEqual(size(readFileSync(resolve(root, `assets/brand/automagik/automagik-lockup-oi-${tone}.png`))), [3000, 1131, 6], tone)
  }
  assert.equal(oiTag, oiTag.replace(/^(<svg\b[^>]*>)[\s\S]*(<\/svg>)$/, `$1${tagInner()}$2`))
  // Arca's own lockup is not cleared for a public repository: it is never among these files.
  const walk = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(folder, entry.name)) : [entry.name])
  assert.deepEqual(walk(root).filter(name => /arca-lockup/i.test(name)), [])
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
