import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileText, scan } from '../../herdr/scripts/privacy-check.mjs'
import { htmlPage, supportPrivacy } from './waitlist/lib/ui.js'
import { themeCss, titleFace, brandFonts } from './scripts/sync-theme.mjs'
import { pages, routes, rootFiles, weUnfold, arca, oiTag, platforms, offered, used, usedCredit, trademarks, brand as siteLogo, icons, manifest as webManifest } from './scripts/build-pages.mjs'
import { BOX, GEOMETRY, LOGO, TONES, logoInner, tagInner } from './scripts/build-lockup.mjs'

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
const allowed = new Set([repo, docs, ...downloads, ...routes.map(route => `https://automagik.si${route}`), 'mailto:privacy@automagik.si', weUnfold.url, ...used.map(project => project.href)])
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
  const brand = new Set(['/assets/brand/automagik-lockup-three-colours-ink-header.svg', '/assets/brand/automagik-lockup-three-colours-cream-header.svg', '/assets/brand/triskle-three-colours.svg', '/assets/brand/triskle-three-colours-32.svg', '/assets/brand/omni-pleased.png', '/assets/brand/arca/svg/arca-icon-ink.svg', '/assets/brand/arca/svg/arca-icon-ivory.svg', '/assets/brand/automagik/automagik-lockup-oi-ink.svg', '/assets/brand/automagik/automagik-lockup-oi-cream.svg'])
  for (const { mark: [light, dark] } of used) for (const file of [light, dark]) if (file) brand.add(`/assets/brand/used/${file}`)
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

test('the projects row: eleven projects in the approved order, each with its own unchanged file and a link to its site', () => {
  const home = htmlAt('/')
  assert.deepEqual(used.map(project => project.name), ['DeepSeek Harness', 'Herdr', 'Agent Client Protocol', 'Model Context Protocol', 'A2A', 'Hermes Agent', 'Oh My Pi', 'Pi', 'NATS', 'iroh', 'Better Auth'])
  // Only the home carries the row, once, between the hero and the blocks.
  for (const route of routes) assert.equal(htmlAt(route).split('class="we-use"').length - 1, route === '/' ? 1 : 0, route)
  const row = home.slice(home.indexOf('<section class="we-use"'), home.indexOf('<section id="blocks"'))
  assert.ok(home.indexOf('<section class="we-use"') > home.indexOf('class="scene"') && row.length > 0)
  assert.match(row, /<h2 id="we-use-title" class="we-use-title">Things that made our stack possible<\/h2>/)
  assert.ok(row.endsWith(`<p class="we-use-note wrap">${usedCredit}</p></section>\n`))
  assert.equal(usedCredit, 'Each name and logo belongs to its project; none endorses Automagik.')
  // No ranking, sponsorship or endorsement wording, and no trademark sentence in the row.
  assert.doesNotMatch(plain(row), /sponsor|partner|powered by|trusted by|official|registered|trademark/i)
  const [list, copy] = [...row.matchAll(/<ul class="we-use-list[^"]*"[^>]*>(.*?)<\/ul>/g)]
  assert.equal(list[0].startsWith('<ul class="we-use-list">'), true)
  // The second copy only fills the gap while the row drifts: same items, out of reach.
  assert.ok(copy[0].startsWith('<ul class="we-use-list we-use-copy" aria-hidden="true" inert>') && copy[1] === list[1])
  const items = [...list[1].matchAll(/<li>(.*?)<\/li>/g)].map(match => match[1])
  assert.equal(items.length, used.length)
  const digests = new Map([...read('assets/brand/LICENSES.md').matchAll(/`used\/([^`]+)`[^|]*\|[^|]*\|[^|]*\| `([0-9a-f]{64})` \|/g)].map(match => [match[1], match[2]]))
  const files = readdirSync(resolve(root, 'assets/brand/used'), { recursive: true }).filter(file => /\.\w+$/.test(file)).map(file => file.split(sep).join('/')).sort()
  assert.deepEqual(used.flatMap(({ mark: [light, dark] }) => dark ? [light, dark] : [light]).sort(), files, 'every file in the folder is shown, and nothing else is there')
  used.forEach(({ name, href, mark: [light, dark, width, height], shown, alt, wordmark }, index) => {
    const item = items[index]
    // One link, to the project's own site, never to a page of ours or to a repository host.
    assert.ok(item.startsWith(`<a class="used" href="${href}">`) && item.endsWith('</a>') && item.split('<a ').length === 2, name)
    assert.match(href, /^https:\/\/[a-z0-9.-]+(?:\/harness)?$/)
    assert.doesNotMatch(href, /github|automagik/)
    // The file is drawn at its own proportions, never stretched, and never taller than the site's own name in the header.
    const image = item.match(/<img[^>]*>/)[0]
    assert.ok(image.includes(` src="/assets/brand/used/${light}" width="${Math.round(shown * width / height)}" height="${shown}" `), name)
    assert.ok(shown <= 32 || image.includes('class="used-inset"'), name)
    // The proportions written for a mark are the file's own: an SVG's box, a PNG's header.
    for (const file of dark ? [light, dark] : [light]) {
      const bytes = readFileSync(resolve(root, 'assets/brand/used', file)), tag = file.endsWith('.svg') ? bytes.toString('utf8').match(/<svg\b[^>]*>/)[0] : ''
      const box = tag.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/)?.slice(1) ?? [tag.match(/ width="([\d.]+)"/)?.[1], tag.match(/ height="([\d.]+)"/)?.[1]]
      const [w, h] = file.endsWith('.png') ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : box.map(Number)
      assert.ok(Math.abs(w / h - width / height) < 0.002, `${file} is ${w} by ${h}`)
    }
    assert.equal(item.includes(`<source media="(prefers-color-scheme: dark)" srcset="/assets/brand/used/${dark}">`), Boolean(dark), name)
    // The name is read once: from the site's own type, or from the alt text of a mark that carries words or a trademark sign.
    if (alt) assert.ok(image.includes(` alt="${alt}" `) && alt.startsWith(name === 'NATS' ? 'NATS™' : name), name)
    else assert.ok(image.includes(' alt="" aria-hidden="true" '), name)
    assert.equal(item.includes(`<span${alt ? ' aria-hidden="true"' : ''}>${name}</span>`), !wordmark, name)
    // Unchanged copies: each file's digest is the one recorded beside its source.
    for (const file of dark ? [light, dark] : [light]) {
      assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'assets/brand/used', file))).digest('hex'), digests.get(file), file)
      if (file.endsWith('.svg')) assert.doesNotMatch(read(`assets/brand/used/${file}`), /<script|<foreignObject|<image|href=/i, file)
    }
  })
  assert.equal(digests.size, files.length)
  // The marks keep their own colours: no filter, blend or opacity rule touches them.
  for (const [, rule] of css.matchAll(/\.used[^{]*\{([^}]*)\}/g)) assert.doesNotMatch(rule, /filter|mix-blend|opacity|invert/, rule)
  // The trademark sentence is in the footer's legal line, on every page; a logo comes down the day its owner asks.
  assert.equal(trademarks, 'DeepSeek Harness is a trademark of DeepSeek; NATS™ is a trademark of The Linux Foundation.')
  for (const route of routes) assert.ok(htmlAt(route).includes(`<p class="footer-license">Automagik, Genie and Omni are free and open source (Apache-2.0). Cloud will be a private, paid service; its contracts are public. ${trademarks} <a href="${repo}">Source code `), route)
  assert.match(read('assets/brand/LICENSES.md'), /If a project's owner asks, its logo comes down the same day\./)
  // Still by default: it drifts only for a visitor who allows motion, and stops for the pointer and the keyboard.
  const start = css.indexOf('@media (prefers-reduced-motion:no-preference){')
  assert.ok(css.indexOf('we-use-drift') > start && !css.slice(0, start).includes('.we-use-copy{display:flex}'))
  assert.ok(css.includes('.we-use-copy{display:none}') && css.includes('.we-use-track:hover .we-use-list{animation-play-state:paused}') && css.includes('.we-use-track:not(:focus-within) .we-use-list{'))
  // The pause switch, for a touch screen: one plain checkbox between the row and its credit,
  // no script, hidden unless the row drifts.
  assert.equal(row.split('<label class="we-use-pause"><input type="checkbox">').length - 1, 1)
  assert.match(row, /<\/ul><\/div>\n<label class="we-use-pause"><input type="checkbox">.*?<span class="when-moving">Pause<\/span><span class="when-paused">Paused<\/span><\/label>\n<p class="we-use-note wrap">/)
  assert.ok(!row.includes('<script') && !/\son[a-z]+=/.test(row))
  assert.ok(css.slice(0, start).includes('.we-use-pause{display:none}') && !css.slice(0, start).includes('.we-use-pause{position'))
  assert.ok(css.indexOf('.we-use:has(.we-use-pause input:checked) .we-use-list{animation-play-state:paused}') > start)
})

test('the logo and the icons: the logo kit\'s own files, unchanged, in the header, the footer and the browser tab', async () => {
  const notes = read('assets/brand/LICENSES.md')
  const logo = '<a class="brand" href="/" aria-label="Automagik home"><picture><source media="(prefers-color-scheme: dark)" srcset="/assets/brand/automagik-lockup-three-colours-cream-header.svg"><img src="/assets/brand/automagik-lockup-three-colours-ink-header.svg" width="1632" height="264" alt="Automagik"></picture></a>'
  assert.equal(siteLogo, logo)
  const tabs = '<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">'
  assert.equal(icons, tabs)
  for (const [route, html] of generated) {
    // The logo once in the header and once in the footer; the icons once in the head.
    assert.equal(html.split(logo).length, 3, route)
    assert.equal(html.split('class="brand"').length, 3, route)
    assert.ok(html.slice(0, html.indexOf('<main')).includes(`<div class="wrap top-inner">${logo}`), route)
    assert.ok(html.slice(html.indexOf('<footer')).includes(`<div class="footer-brand">${logo}`), route)
    assert.equal(html.slice(0, html.indexOf('</head>')).split(tabs).length, 2, route)
    assert.deepEqual([...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest|shortcut icon)"[^>]*>/g)].map(match => match[0]).join(''), tabs, route)
    // The retired logo (gradient capitals, the old clay triskle without its seam line) is in no page.
    assert.doesNotMatch(html, /(?:lockup|wordmark|triskle)\.webp|automagik-wordmark-|\/assets\/art\/mark/, route)
    // The mark alone is the kit's triskle in three colours, the drawing made for the size
    // shown: the 32 px drawing in the two menus, the large one in a hero.
    const marks = [...html.matchAll(/<img[^>]*\/triskle-[^>]*>/g)].map(match => match[0])
    assert.equal(marks.length, route === '/cloud/' || route === '/mykes/' ? 3 : 2, route)
    for (const image of marks) assert.match(image, /^<img class="(?:menu-art" src="\/assets\/brand\/triskle-three-colours-32\.svg" width="32" height="32" alt="" aria-hidden="true" loading="lazy"|(?:hero|coming)-mark" src="\/assets\/brand\/triskle-three-colours\.svg" width="300" height="300" alt="[^"]*"(?: aria-hidden="true")? fetchpriority="high") decoding="async">$/, image)
  }
  // The Cloud form's answer pages carry the same logo.
  const answer = await htmlPage('Checked', '<p>Checked.</p>').text()
  assert.ok(answer.includes(`<header class="top"><div class="wrap top-inner">${logo}<a href="/cloud/">Cloud</a></div></header>`))
  // Every file is the kit's, byte for byte: its digest is the one recorded beside its source.
  const kit = ['assets/brand/automagik-lockup-three-colours-ink-header.svg', 'assets/brand/automagik-lockup-three-colours-cream-header.svg', 'assets/brand/automagik-lockup-three-colours-ink.svg', 'assets/brand/automagik-lockup-three-colours-cream.svg', 'assets/brand/triskle-three-colours.svg', 'assets/brand/triskle-three-colours-32.svg', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']
  const pinned = new Map([...notes.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map(match => [match[1], match[3]]))
  assert.deepEqual([...pinned.keys()], kit)
  for (const file of kit) assert.equal(createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'), pinned.get(file), `${file} is not the kit's file`)
  // The lockups: one box for all four, the letters' tone in the file's colour, and nothing
  // that could load or run: no script, link, picture or text inside. The wordmark's own
  // drawing is pinned only by the digests above, so a newer kit is a file swap.
  for (const [tone, colour] of Object.entries(TONES)) for (const size of ['-header', '']) {
    const file = `automagik-lockup-three-colours-${tone}${size}.svg`, svg = read(`assets/brand/${file}`)
    assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -186 1632.34 264" role="img" aria-label="Automagik" color="${colour}">`), file)
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|<text|href=|url\((?!#)/i, file)
  }
  // The mark alone: one square frame for both drawings, in three colours.
  for (const file of ['triskle-three-colours.svg', 'triskle-three-colours-32.svg']) {
    const svg = read(`assets/brand/${file}`)
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="72 81 1166 1166" role="img" aria-label="Automagik triskle">'), file)
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|<text|href=|url\((?!#)/i, file)
  }
  // The icons: an .ico of three sizes, a square SVG in the same three colours, and three PNGs.
  const ico = readFileSync(resolve(root, 'favicon.ico'))
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4), ico[6], ico[22], ico[38]], [0, 1, 3, 16, 32, 48])
  assert.ok(read('favicon.svg').startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="72 81 1166 1166" '))
  assert.doesNotMatch(read('favicon.svg'), /<script|<foreignObject|<image|<text|href=|url\((?!#)/i)
  const png = file => { const bytes = readFileSync(resolve(root, file)); return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }
  assert.deepEqual([png('apple-touch-icon.png'), png('icon-192.png'), png('icon-512.png')], [[180, 180], [192, 192], [512, 512]])
  assert.deepEqual(webManifest, { name: 'Automagik', short_name: 'Automagik', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }], theme_color: '#3c3049', background_color: '#3c3049', display: 'browser', start_url: '/' })
  assert.deepEqual(JSON.parse(read('site.webmanifest')), webManifest)
  // The files this logo replaced are gone, and nothing the site serves or builds with names them.
  for (const file of ['assets/lockup.webp', 'assets/brand/lockup.webp', 'assets/brand/mark.webp', 'assets/art/mark.webp', 'assets/art/mark-2x.webp', 'assets/brand/wordmark.webp', 'assets/brand/triskle.webp', 'assets/brand/automagik-wordmark-ink.svg', 'assets/brand/automagik-wordmark-cream.svg']) assert.equal(existsSync(resolve(root, file)), false, file)
  for (const file of ['styles.css', 'scripts/build-pages.mjs', 'scripts/build-lockup.mjs', 'scripts/build-art.mjs', 'waitlist/lib/ui.js', 'verify-browser.mjs']) assert.doesNotMatch(read(file), /(?:lockup|wordmark|triskle)\.webp|automagik-wordmark-|art\/mark|'mark'/, file)
  // Sized by the triskle's height (--mark): the file is 264 tall where the triskle is 222,
  // the g's tail hangs under the link's box, and no rule draws on the logo.
  assert.ok(css.includes('.brand{--mark:32px;display:block;flex-shrink:0}\n.brand picture{display:contents}\n.brand:focus-visible{outline-offset:calc(var(--mark)*42/222 + 3px)}\n.brand img{width:auto;max-width:none;height:calc(var(--mark)*264/222);margin-bottom:calc(var(--mark)*-42/222)}\n'))
  assert.deepEqual([...css.matchAll(/\n\s*\.brand\{--mark:(\d+)px/g)].map(match => Number(match[1])), [32, 26, 23])
  for (const [rule] of css.matchAll(/[^{}]*\.brand[^{}]*\{[^}]*\}/g)) assert.doesNotMatch(rule, /filter|shadow|stroke|opacity|transform|scale|rotate|animation|transition|background|object-/, rule)
  // The footer's first column is never narrower than its logo.
  const column = Number(css.match(/\.footer-grid\{display:grid;grid-template-columns:minmax\((\d+)px,1\.5fr\)/)[1])
  assert.ok(column >= 40 * 1632.34 / 222 && column < 300, `the footer's first column holds the logo: ${column}`)
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

test('the title face is the brand\'s: Fredoka from docs/brand, at its three weights only', () => {
  const brand = JSON.parse(read('../../docs/brand/tokens/tokens.json')).type
  // The site serves byte copies of the brand's font and licence, and the font is the recorded build.
  assert.deepEqual(brandFonts.map(file => file.to.pathname.split('/').pop()), ['fredoka-latin.woff2', 'OFL-Fredoka.txt'])
  for (const { from, to } of brandFonts) assert.ok(readFileSync(to).equals(readFileSync(from)), to.pathname.split('/').pop())
  assert.equal(createHash('sha256').update(readFileSync(brandFonts[0].to)).digest('hex'), 'd1ceb16007127919aa1900fb85e4b5d612a4f242404a4068d43f3bc628b2aeca')
  assert.ok(read('../../docs/brand/fonts/README.md').includes('`d1ceb16007127919aa1900fb85e4b5d612a4f242404a4068d43f3bc628b2aeca`'))
  // The theme takes the family, the file, the size adjustment and the weights from the brand's tokens.
  assert.deepEqual({ family: titleFace.family, weight: titleFace.weight, sizeAdjust: titleFace.sizeAdjust }, { family: 'Fredoka', weight: '300 700', sizeAdjust: '105%' })
  assert.deepEqual(brand.weights.map(weight => [weight.name, weight.value]), [['weight-title', 536], ['weight-strong', 469], ['weight-label', 402]])
  assert.ok(theme.includes('@font-face{font-family:Fredoka;font-style:normal;font-weight:300 700;font-display:swap;size-adjust:105%;src:url("assets/brand/fredoka-latin.woff2") format("woff2")}\n'))
  assert.ok(theme.includes(':root{color-scheme:light;--weight-title:536;--weight-strong:469;--weight-label:402;'))
  assert.deepEqual(theme.match(/--bt-head-font:[^;]+;/g), ['--bt-head-font:Fredoka,"DM Sans",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;'])
  assert.ok(css.includes('--head:var(--bt-head-font);'))
  // Nothing set in the title face carries a weight of its own: a heavier Fredoka is heavier than the logo.
  assert.equal(css.match(/font:[^;}]*var\(--head\)/g).length, 39)
  assert.deepEqual(css.match(/font:[^;}]*var\(--head\)/g).filter(rule => !/^font:var\(--weight-(?:title|strong|label)\) /.test(rule)), [])
  assert.ok(css.includes('\nh1{font-weight:var(--weight-title);font-size:clamp(2.6rem,1.4rem + 4.2vw,4.6rem);line-height:1.02;letter-spacing:-.02em}\n'))
  assert.ok(css.includes('\nh2{font-weight:var(--weight-title);font-size:clamp(1.85rem,1.15rem + 2.3vw,3.05rem);line-height:1.08;letter-spacing:-.016em}\n'))
  assert.ok(css.includes('\nh3{font-weight:var(--weight-strong);font-size:1.3rem;line-height:1.25;letter-spacing:-.01em}\n'))
  // Fredoka's own word space is wide; the extra word spacing the old face needed is gone.
  assert.doesNotMatch(css, /word-spacing/)
  // Widths counted in the face's own zero: Fredoka's zero is narrower, so the counts grew to keep the same lines.
  for (const rule of ['.home-hero h1{font-size:clamp(1.95rem,.62rem + 5.5vw,5.6rem);max-width:16.5ch;', '.open-line{max-width:26.4ch;', 'bottom:clamp(30px,3.6vw,46px);max-width:27.5ch;']) assert.ok(css.includes(rule), rule)
  // The face it replaced is gone from what the site serves, and every page preloads the new file.
  for (const file of ['assets/brand/manrope-latin.woff2', 'assets/brand/OFL-Manrope.txt']) assert.equal(existsSync(resolve(root, file)), false, file)
  assert.doesNotMatch(theme + css + read('scripts/build-pages.mjs') + read('verify-browser.mjs'), /manrope/i)
  for (const route of routes) {
    const html = htmlAt(route)
    assert.equal(html.split('<link rel="preload" href="/assets/brand/fredoka-latin.woff2" as="font" type="font/woff2" crossorigin>').length, 2, route)
    assert.doesNotMatch(html, /manrope/i, route)
  }
})

test('the title face never ships without its licence, in the brand folder and on the site', () => {
  const places = { 'docs/brand/fonts': resolve(root, '../../docs/brand/fonts'), 'apps/landing/assets/brand': resolve(root, 'assets/brand') }
  for (const [place, folder] of Object.entries(places)) {
    assert.ok(existsSync(resolve(folder, 'fredoka-latin.woff2')), `${place} has no title font`)
    assert.ok(existsSync(resolve(folder, titleFace.license)), `${place} ships the title font without its licence, ${titleFace.license}`)
    const licence = readFileSync(resolve(folder, titleFace.license))
    assert.equal(createHash('sha256').update(licence).digest('hex'), '5c9e7eee5c6b25f4b05b8d53b2e470ea4962f9ced742d044a98f7d95d1375bab', `${place}: the licence text changed`)
    assert.match(licence.toString(), /^Copyright 2016 The Fredoka Project Authors/)
    assert.match(licence.toString(), /SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/)
  }
  assert.equal(titleFace.license, 'OFL-Fredoka.txt')
  assert.ok(read('assets/brand/LICENSES.md').includes('SIL Open Font License 1.1, in `OFL-Fredoka.txt`'))
  assert.ok(read('../../docs/brand/fonts/README.md').includes('OFL-Fredoka.txt'))
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
  assert.ok(block.includes('<picture><source media="(prefers-color-scheme: dark)" srcset="/assets/brand/automagik/automagik-lockup-oi-cream.svg"><img src="/assets/brand/automagik/automagik-lockup-oi-ink.svg" width="1628" height="529" alt="The Automagik logo, with the Open Intelligence tag under it at the right" loading="lazy" decoding="async"></picture>'))
  assert.deepEqual([...block.matchAll(/href="([^"]+)" download/g)].map(match => match[1]), ['ink.svg', 'ink.png', 'cream.svg', 'cream.png'].map(name => `/assets/brand/automagik/automagik-lockup-oi-${name}`))
  assert.ok(htmlAt('/').indexOf('<section id="brand"') > htmlAt('/').indexOf('<section id="film"'))
  // Size and colour, as Arca's footer: 170 by 32 px in the footer's text colour, never an
  // effect on it, and never bigger than the logo it sits with: the footer's word alone (its
  // letters are 1325 wide when the triskle is 222 tall) passes 170 px at every width.
  assert.match(css, /\.oi-tag,\.oi-tag:hover\{flex:none;display:block;border-radius:16px;color:var\(--text\)\}\n\.oi-tag svg\{width:170px;height:32px;max-width:none\}/)
  for (const [rule] of css.matchAll(/[^{}]*oi-tag[^{}]*\{[^}]*\}/g)) assert.doesNotMatch(rule, /filter|shadow|stroke|outline|opacity|transform|scale|rotate|animation|transition|background/, rule)
  const footerMarks = [...css.matchAll(/\.footer-brand \.brand\{--mark:(\d+)px[;}]/g)].map(match => Number(match[1]))
  assert.deepEqual(footerMarks, [40, 34], 'the footer logo: one size, and one for phones')
  for (const mark of footerMarks) assert.ok(mark * 1325 / 222 >= 170, 'the footer logo\'s word is at least as wide as the tag')
  assert.match(css, /@media \(max-width:700px\)\{\.footer-end\{flex-direction:column;align-items:flex-start\}\}/)
  assert.match(css, /@font-face\{font-family:"IBM Plex Mono";font-style:normal;font-weight:600;font-display:block;src:url\("assets\/brand\/ibm-plex-mono-latin-600\.woff2"\) format\("woff2"\)\}/)
  // The lockup files: the kit's large lockup, set inside unchanged, with the tag under it,
  // right edges together, the tag 170/275 of the logo's width (Arca's proportion), one tone
  // per ground. The logo ends where its letters end: at the k, and under the g's tail.
  assert.deepEqual(readdirSync(resolve(root, 'assets/brand/automagik')).sort(), ['automagik-lockup-oi-cream.png', 'automagik-lockup-oi-cream.svg', 'automagik-lockup-oi-ink.png', 'automagik-lockup-oi-ink.svg'])
  assert.ok(Math.abs(GEOMETRY.scale * 340 / LOGO.width - 170 / 275) < 1e-9 && Math.abs(GEOMETRY.x + 340 * GEOMETRY.scale - LOGO.width) < 1e-9 && GEOMETRY.y > LOGO.height)
  assert.deepEqual([TONES, BOX, LOGO], [{ ink: '#3c3049', cream: '#f3e9dd' }, { x: 0, y: -186, width: 1632.34, height: 264 }, { width: 321.34 + 1307, height: 186 + 76 }])
  const font = readFileSync(resolve(root, 'assets/brand/ibm-plex-mono-latin-600.woff2')).toString('base64')
  const size = png => [png.readUInt32BE(16), png.readUInt32BE(20), png[25]]
  for (const [tone, colour] of Object.entries(TONES)) {
    const svg = read(`assets/brand/automagik/automagik-lockup-oi-${tone}.svg`), kit = read(`assets/brand/automagik-lockup-three-colours-${tone}.svg`)
    assert.equal(kit, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -186 1632.34 264" role="img" aria-label="Automagik" color="${colour}">${logoInner(tone)}</svg>\n`, tone)
    assert.equal(svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1628.34 529.22" width="1628.34" height="529.22" color="${colour}" role="img" aria-label="Automagik, with the Open Intelligence tag"><style>@font-face{font-family:"IBM Plex Mono";font-weight:600;src:url(data:font/woff2;base64,${font}) format("woff2")}</style><svg width="1632.34" height="264" viewBox="0 -186 1632.34 264">${logoInner(tone)}</svg><g transform="translate(621.73 339.74) scale(2.96062)">${tagInner()}</g></svg>\n`, tone)
    assert.doesNotMatch(svg, /<image|<script|<foreignObject/, tone)
    assert.deepEqual(size(readFileSync(resolve(root, `assets/brand/automagik/automagik-lockup-oi-${tone}.png`))), [3000, 976, 6], tone)
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
