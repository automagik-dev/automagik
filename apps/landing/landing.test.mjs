import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileText, scan } from '../../herdr/scripts/privacy-check.mjs'
import { themeCss } from './scripts/sync-theme.mjs'
import { pages, routes } from './scripts/build-pages.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)))
const read = path => readFileSync(resolve(root, path), 'utf8')
const theme = read('theme.css'), css = read('styles.css')
const captures = read('assets/CAPTURES.md')
const manifest = JSON.parse(read('assets/screens/manifest.json'))
const release = JSON.parse(read('assets/releases.json')).pocket
const privacy = JSON.parse(read('../../herdr/scripts/privacy-list.json'))
const generated = pages()
const htmlAt = route => read(`${route.slice(1)}index.html`)
const repo = 'https://github.com/automagik-si/automagik'
const allowed = new Set([
  repo, 'https://github.com/automagik-si/genie', 'https://github.com/automagik-si/omni',
  ...routes.map(route => `https://automagik.si${route}`), 'mailto:privacy@automagik.si',
  ...['Mac.dmg', 'Linux.deb', 'Linux.AppImage'].map(name => `${repo}/releases/latest/download/Automagik-${name}`),
  `${repo}/tree/dev/herdr#install`, `${repo}/tree/dev/apps/bots-dsh#install`, `${repo}/tree/dev/apps/pocket`,
  `${repo}/tree/dev/herdr/mods/pocket-link`, `${repo}/tree/dev/apps/desktop`,
  `${repo}/blob/dev/docs/rfcs/0024-automagik-cloud.md`, `${repo}/blob/dev/apps/landing/assets/CAPTURES.md`, release.url,
])
const local = path => {
  const full = resolve(root, path.replace(/^\//, ''))
  assert.ok(full.startsWith(root + sep) || full === root.slice(0, -1), path)
  assert.ok(existsSync(full), path)
}

test('approved umbrella map, one h1 per page, generated sources current, no client scripting', () => {
  assert.deepEqual(routes, ['/', '/desktop/', '/mobile/', '/omni/', '/genie/', '/cloud/', '/arca/', '/mykes/'])
  for (const route of routes) {
    const html = htmlAt(route)
    assert.equal(html, generated.get(route), `Regenerate ${route}`)
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, route)
    assert.match(html, /<html lang="en">/)
    assert.match(html, /name="robots" content="noindex, nofollow"/)
    assert.match(html, /href="\/theme.css"/)
    assert.doesNotMatch(html, /<(?:script|iframe)\b|\bon\w+\s*=|javascript:|automagik\.dev|automagik-dev|\.pages\.dev/i)
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    assert.equal(new Set(ids).size, ids.length)
    assert.match(html, /class="skip" href="#main"/)
  }
  const home = htmlAt('/')
  assert.match(home, /id="film"/); assert.match(home, /id="blocks"/)
  assert.equal((home.match(/class="product-card"/g) ?? []).length, 7)
  assert.equal([...generated.values()].join('').match(/data-film=/g).length, 1)
  assert.match(home, /data-film="placeholder"/)
  assert.match(home, /The film comes in D2/)
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
  for (const route of ['/arca/', '/mykes/']) assert.match(htmlAt(route), /Coming soon\./)
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
  }
})

test('images are reviewed brand assets or unchanged, provenance-backed captures', () => {
  const brand = new Set(['/assets/brand/lockup.webp', '/assets/brand/mark.webp', '/assets/brand/omni-pleased.png'])
  for (const html of generated.values()) {
    for (const [, source] of html.matchAll(/(?:src|srcset|poster)="([^"]+)"/g)) {
      local(source)
      assert.ok(brand.has(source) || Object.hasOwn(manifest.images, source.replace(/^\/assets\/screens\//, '')), source)
    }
    for (const [image] of html.matchAll(/<img\b[^>]*>/g)) assert.match(image, /alt="[^"]{20,}"|alt="Automagik"/)
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
  assert.match(read('_headers'), /X-Robots-Tag: noindex, nofollow/)
})
