// Static contract for RFC 0027 D3. Browser checks exercise the same page at four widths.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileText, scan } from '../../herdr/scripts/privacy-check.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(resolve(root, path), 'utf8')
const html = read('index.html')
const css = read('styles.css')
const captures = read('assets/CAPTURES.md')
const manifest = JSON.parse(read('assets/screens/manifest.json'))
const privacyList = JSON.parse(read('../../herdr/scripts/privacy-list.json'))
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const images = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0])
const sources = [...html.matchAll(/(?:src|srcset|poster)="([^"]+)"/g)].map(match => match[1])
const cssSources = [...css.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1])
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
const blocks = ['team', 'code', 'genie', 'omni', 'pocket', 'meter', 'cloud']
const repo = 'https://github.com/automagik-si/automagik'
const downloads = ['Mac.dmg', 'Linux.deb', 'Linux.AppImage'].map(name => `${repo}/releases/latest/download/Automagik-${name}`)
const allowed = new Set([
  'https://automagik.si/', repo, `${repo}/releases/latest`, ...downloads,
  `${repo}/tree/dev/apps/bots-dsh`, `${repo}/tree/dev/herdr#install`,
  'https://github.com/automagik-si/genie', 'https://github.com/automagik-si/omni',
  `${repo}/tree/dev/apps/pocket`, `${repo}/tree/dev/meter/usagemeter`,
  `${repo}/blob/dev/docs/rfcs/0024-automagik-cloud.md`,
  `${repo}/tree/dev/apps/desktop`, `${repo}/blob/dev/apps/landing/assets/CAPTURES.md`,
])

function local(path) {
  const full = resolve(root, path)
  assert.ok(full.startsWith(root + sep), `Not inside the site: ${path}`)
  assert.ok(existsSync(full), `Missing local asset: ${path}`)
}

test('one page, all seven block anchors, one film slot; no scripts or waitlist forms', () => {
  assert.match(html, /<html lang="en">/)
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique')
  for (const id of ['main', 'film', 'blocks', 'install', ...blocks]) assert.ok(ids.includes(id), id)
  const blockIds = [...html.matchAll(/<article id="([^"]+)" class="block"/g)].map(match => match[1])
  assert.deepEqual(blockIds, blocks)
  assert.equal((html.match(/\bdata-film="(?:placeholder|player)"/g) ?? []).length, 1)
  const videos = html.match(/<video\b[^>]*>[\s\S]*?<\/video>/g) ?? []
  if (videos.length) {
    assert.equal(videos.length, 1)
    assert.match(html, /data-film="player"/)
    assert.match(videos[0], /\bcontrols\b/)
    assert.match(videos[0], /poster="assets\/film\/automagik-launch-poster.webp"/)
    assert.match(videos[0], /type="video\/mp4"/)
    assert.doesNotMatch(videos[0], /autoplay/)
    local('assets/film/automagik-launch.mp4')
    local('assets/film/LICENSES.md')
  } else {
    assert.match(html, /<figure class="film-placeholder" data-film="placeholder"/)
    assert.match(text, /The film comes in D2/)
  }
  assert.doesNotMatch(html, /<(?:script|iframe|form|input|button)\b|\bon\w+\s*=|javascript:/i)
  assert.match(html, /name="robots" content="noindex, nofollow"/)
  assert.doesNotMatch(html + css, /pages\.dev|automagik\.dev|automagik-dev/)
})

test('every image or media source is a recorded capture, reviewed brand asset or D2 film', () => {
  const brand = new Set(['assets/brand/lockup.webp', 'assets/brand/omni-pleased.png'])
  const film = new Set(['assets/film/automagik-launch-poster.webp', 'assets/film/automagik-launch.mp4'])
  for (const src of sources) {
    local(src)
    assert.ok(brand.has(src) || film.has(src) || Object.hasOwn(manifest.images, src.replace(/^assets\/screens\//, '')), src)
  }
  for (const src of cssSources) {
    local(src)
    assert.ok(['assets/brand/manrope-latin.woff2', 'assets/brand/dm-sans-latin.woff2'].includes(src), src)
  }
  assert.ok(images.length > 0)
  for (const tag of images) assert.match(tag, /alt="[^"]{20,}"|alt="Automagik"/, tag)
  for (const licence of ['LICENSES.md', 'LICENSE-Apache-2.0.txt', 'OFL-Manrope.txt', 'OFL-DMSans.txt']) local(`assets/brand/${licence}`)
})

test('captures retain their digests and provenance, including the Herdr share image', () => {
  const files = readdirSync(resolve(root, 'assets/screens')).filter(name => name.endsWith('.png')).sort()
  assert.deepEqual(Object.keys(manifest.images).sort(), files)
  for (const file of files) {
    const digest = createHash('sha256').update(readFileSync(resolve(root, 'assets/screens', file))).digest('hex')
    assert.equal(digest, manifest.images[file], `${file} changed after its capture`)
    assert.ok(captures.includes(file), `${file} needs provenance`)
  }
  assert.deepEqual(readFileSync(resolve(root, 'assets/screens/code-sidebar.png')), readFileSync(resolve(root, '../../herdr/mods/am-sidebar/preview.png')))
  assert.equal(manifest.additionalCaptures['code-sidebar.png'].introducedBy, '6e116024aa760694bfc6af81111eb99c2fa1428a')
  assert.match(captures, /scrollbar was painted out/)
  assert.equal(manifest.runtime.version, '0.2.1-rc.5')
  assert.equal(manifest.captureScriptsClean, true)
  assert.deepEqual(Object.keys(manifest.plugins).sort(), ['@automagik/bots-dsh', '@automagik/genie-dsh', '@automagik/welcome-dsh'])
})

test('every href is local or an exact reviewed destination', () => {
  for (const href of hrefs) {
    if (href.startsWith('#')) assert.ok(html.includes(`id="${href.slice(1)}"`), href)
    else if (/^[a-z]+:/i.test(href) || href.startsWith('//')) assert.ok(allowed.has(href), href)
    else local(href)
  }
  for (const destination of allowed) assert.ok(hrefs.includes(destination), `Reviewed destination no longer used: ${destination}`)
})

test('the umbrella, platform, Cloud and Code caveats stay with the download and blocks', () => {
  assert.match(text, /Your own agent force\./)
  assert.match(text, /Superintelligence, in open building blocks\. Use one, or all of them\./)
  assert.match(text, /This repository, Genie and Omni are free and open source, Apache-2\.0/)
  assert.match(text, /not live.*private, paid hosted service: not free and not open source/)
  assert.match(text, /Code mode needs Herdr and the Automagik pack\. The app download alone does not set it up/)
  assert.match(text, /switch still says Work/)
  assert.match(text, /Mac with Apple silicon, macOS 13 or newer/)
  assert.match(text, /Linux on a 64-bit PC/)
  assert.match(text, /Windows is not supported yet/)
  assert.match(text, /scripted replies/)
  assert.match(text, /Main and Omni Bots.*without asking/)
  assert.match(text, /Always grant/)
  assert.doesNotMatch(text, /every time|fastest|testimonials|customers love|\bsoon\b/i)
  assert.equal((html.match(/class="button primary"/g) ?? []).length, 2, 'Same primary action in hero and Install')
  for (const name of ['Mac.dmg', 'Linux.deb']) assert.equal(hrefs.filter(href => href === `${repo}/releases/latest/download/Automagik-${name}`).length, 2)
  assert.ok(!html.includes('curl -fsSL'), 'Developer commands belong in the README')
})

test('all public landing files pass the privacy matcher, with no tracking or remote loads', () => {
  function check(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isDirectory()) check(path)
      else assert.deepEqual(scan(`apps/landing/${path}`, fileText(readFileSync(resolve(root, path))), privacyList), [], path)
    }
  }
  check('assets')
  for (const file of ['index.html', 'styles.css', '_headers', 'README.md']) {
    assert.deepEqual(scan(`apps/landing/${file}`, read(file), privacyList), [], file)
  }
  assert.doesNotMatch(html + css, /analytics|gtag|https?:\/\/[^"'\s)]+\.(?:js|css|woff2)/i)
  assert.match(read('_headers'), /X-Robots-Tag: noindex, nofollow/)
})

test('responsive, theme, motion and keyboard basics', () => {
  assert.match(html, /name="viewport"/)
  assert.match(html, /class="skip" href="#main"/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /@media \(max-width:700px\)/)
  assert.match(css, /prefers-color-scheme:dark/)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.doesNotMatch(css, /overflow-x:\s*hidden/)
})
