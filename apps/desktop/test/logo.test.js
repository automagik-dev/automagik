import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { LOCKUPS, lockupFor, showUpdateSplash, splashFiles } from '../src/splash.js'

// The Automagik logo in the desktop app is the approved set's own files (final-triskle-seam):
// the window bar's lockup, the waking mark, the macOS update splash's lockup, the icon's mark.
const APP = new URL('../', import.meta.url)
const bytes = file => readFileSync(new URL(file, APP))
const text = file => bytes(file).toString('utf8')
const sha256 = data => createHash('sha256').update(data).digest('hex')
// Each file's sha256 in the final set. A new set replaces the file and this line together.
const APPROVED = {
  'src/art/triskle-three-colours.svg': 'bc9fd54124f5d3cfdd0461c5ab6ac6860254c14bfdedf46a11cc5ca433e01a72',
  'src/art/automagik-lockup-three-colours-ink-header.svg': '4d0f87696e31e5f889e2e60d98c7814d515a85f2f60918f4bd999f298338af2f',
  'src/art/automagik-lockup-three-colours-cream-header.svg': 'e8dd0d21e42d7b2722386738972d46432f083895fb2bf00a990ee7588d3561f7',
  'src/splash/automagik-lockup-three-colours-ink-128.png': '89a274a63cf3812a4ff2ecf832204e33236444118c06ece93d5766b58d595380',
  'src/splash/automagik-lockup-three-colours-cream-128.png': 'f1113affc7f486217330d7ebc4fbce0c9538d63f84ddea88c40680ec79a87e9a',
  'assets/triskle-three-colours.svg': 'bc9fd54124f5d3cfdd0461c5ab6ac6860254c14bfdedf46a11cc5ca433e01a72',
}
const css = text('src/shell.css')
const html = text('src/shell.html')
// A PNG's width and height, from its header.
const pngSize = data => [data.readUInt32BE(16), data.readUInt32BE(20)]
// The pixels of an 8-bit RGBA PNG that is not interlaced: answers (x, y) => [r, g, b, a].
function pngPixels(data) {
  const [width, height] = pngSize(data)
  assert.deepEqual([data[24], data[25], data[28]], [8, 6, 0], '8-bit RGBA, not interlaced')
  const parts = []
  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at)
    if (data.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(data.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * 4
  const out = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[y * stride + x - 4] : 0
      const up = y > 0 ? out[(y - 1) * stride + x] : 0
      const corner = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0
      const paeth = () => { const p = left + up - corner; const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]; return a <= b && a <= c ? left : b <= c ? up : corner }
      const base = [0, left, up, (left + up) >> 1, filter === 4 ? paeth() : 0][filter]
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + base) & 255
    }
  }
  return (x, y) => [...out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
}

test('every logo file is the approved set\'s, byte for byte', () => {
  for (const [file, hash] of Object.entries(APPROVED)) assert.equal(sha256(bytes(file)), hash, `${file} is not the final set's file`)
  assert.deepEqual(readdirSync(new URL('src/art/', APP)).sort(), ['SOURCE.json', ...Object.keys(APPROVED).filter(file => file.startsWith('src/art/')).map(file => file.slice('src/art/'.length))].sort(), 'src/art holds the approved files and their record')
  assert.deepEqual(readdirSync(new URL('src/splash/', APP)).sort(), Object.keys(APPROVED).filter(file => file.startsWith('src/splash/')).map(file => file.slice('src/splash/'.length)).sort(), 'src/splash holds the two lockups and nothing else')
  // The record says the same, and where in the set each came from.
  const source = JSON.parse(text('src/art/SOURCE.json'))
  assert.equal(source.set, 'final-triskle-seam')
  assert.deepEqual(Object.keys(source.files).sort(), Object.keys(APPROVED).sort())
  for (const [file, entry] of Object.entries(source.files)) {
    assert.equal(entry.sha256, APPROVED[file], `SOURCE.json: ${file}`)
    assert.equal(entry.bytes, bytes(file).length, `SOURCE.json: ${file}`)
    assert.ok(entry.from.endsWith(`/${file.slice(file.lastIndexOf('/') + 1)}`), `${file} keeps its name in the set`)
  }
  // The old pictures are gone: the uppercase lockup and the earlier clay mark, which nothing
  // reads any more (the icon draws the approved mark, and the site builds its art from the set).
  assert.equal(existsSync(new URL('src/splash/lockup.png', APP)), false)
  assert.equal(existsSync(new URL('assets/mark.png', APP)), false)
})

test('the window bar shows the lockup: ink letters by day, cream at night', () => {
  const [light, dark] = [...css.matchAll(/--lockup:url\("([^"]+)"\)/g)].map(match => match[1])
  assert.equal(light, 'art/automagik-lockup-three-colours-ink-header.svg')
  assert.equal(dark, 'art/automagik-lockup-three-colours-cream-header.svg')
  assert.equal([...css.matchAll(/--lockup:/g)].length, 2)
  // The cream one is the dark scheme's, and only that.
  const night = /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/.exec(css)[1]
  assert.match(night, /--lockup:url\("art\/automagik-lockup-three-colours-cream-header\.svg"\)/)
  assert.doesNotMatch(night, /ink-header/)
  // The lockup keeps its frame (1632.34 by 264) at 24px tall, in the 40px bar.
  assert.match(css, /\.brand-mark\{display:block;width:148px;height:24px;background:var\(--lockup\) center\/contain no-repeat\}/)
  assert.equal(Math.round(24 * 1632.34 / 264), 148)
  // The word is in the picture: the label is still there for a screen reader, and not drawn.
  assert.match(html, /<i class="brand-mark" aria-hidden="true"><\/i>\s*<b>Automagik<\/b>/)
  assert.match(css, /\.brand b\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap\}/)
  assert.match(css, /\.brand\{position:relative\}/)
})

test('the waking mark is the large three-colour drawing, in its square', () => {
  assert.match(css, /\.mark\{display:block;width:128px;height:128px;background:url\("art\/triskle-three-colours\.svg"\) center\/contain no-repeat;/)
})

test('the frame page loads its pictures from its own files, and each one exists', () => {
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(match => match[1].replace(/^"|"$/g, ''))
  assert.ok(urls.length >= 5)
  for (const url of urls) {
    assert.doesNotMatch(url, /^(data:|https?:|\/)/, 'no inlined or remote picture')
    assert.ok(existsSync(new URL(`src/${url}`, APP)), `${url} is in src`)
  }
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'">/)
  // electron-builder packs src/**, so the art ships with the page.
  assert.match(text('electron-builder.yml'), /^files:\n {2}- src\/\*\*$/m)
})

test('the macOS update splash takes the lockup for the system\'s look', (t) => {
  assert.equal(lockupFor(false), LOCKUPS.ink)
  assert.equal(lockupFor(true), LOCKUPS.cream)
  assert.equal(lockupFor(undefined), LOCKUPS.ink)
  assert.match(LOCKUPS.ink, /src[\\/]splash[\\/]automagik-lockup-three-colours-ink-128\.png$/)
  assert.match(LOCKUPS.cream, /src[\\/]splash[\\/]automagik-lockup-three-colours-cream-128\.png$/)
  const home = mkdtempSync(join(tmpdir(), 'logo-splash-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const spawn = () => ({ on() {}, unref() {} })
  const shown = dark => {
    assert.equal(showUpdateSplash({ home, product: 'Automagik', version: '3.200.0', platform: 'darwin', spawn, ...(dark === undefined ? {} : { dark }) }), true)
    return sha256(readFileSync(splashFiles(home).image))
  }
  assert.equal(shown(true), APPROVED['src/splash/automagik-lockup-three-colours-cream-128.png'])
  assert.equal(shown(false), APPROVED['src/splash/automagik-lockup-three-colours-ink-128.png'])
  assert.equal(shown(undefined), APPROVED['src/splash/automagik-lockup-three-colours-ink-128.png'])
  // Both are the lockup at 128px tall, and the panel's picture box holds its shape.
  for (const file of Object.values(LOCKUPS)) assert.deepEqual(pngSize(readFileSync(file)), [791, 128])
  // main.js says which look the system shows.
  assert.match(text('src/main.js'), /showUpdateSplash\(\{ home, product: PRODUCT, version: update\?\.version, dark: nativeTheme\.shouldUseDarkColors \}\)/)
})

test('the app icon is drawn from the approved mark, on the set\'s ink ground', () => {
  const icon = text('assets/icon.svg')
  // The tile: the set's ink (#1e1923) is its ground, and no cream stop is left.
  const table = /<linearGradient id="table"[^>]*>([\s\S]*?)<\/linearGradient>/.exec(icon)[1]
  assert.deepEqual([...table.matchAll(/stop-color="(#[0-9a-f]{6})"/g)].map(match => match[1]), ['#2a2330', '#1e1923', '#16121a'])
  assert.doesNotMatch(icon, /#fbf5ec|#f6eee2|#ecdfcc/)
  // The tile keeps its shape: the rounded square, 824 wide with a 186 radius.
  assert.match(icon, /<rect x="100" y="100" width="824" height="824" rx="186" fill="url\(#table\)"\/>/)
  // The committed render is that drawing: ink above the mark, the mark in colour, clear corners.
  const pixel = pngPixels(bytes('assets/icon.png'))
  const [r, g, b, a] = pixel(512, 150)
  assert.equal(a, 255)
  assert.ok(r < 80 && g < 80 && b < 80, `the tile is ink above the mark, not rgb(${r},${g},${b})`)
  assert.ok(Math.abs(r - 0x24) < 24 && Math.abs(g - 0x1e) < 24 && Math.abs(b - 0x2a) < 24, `the tile is the set's ink, lit a little: rgb(${r},${g},${b})`)
  const [cr, cg, cb] = pixel(430, 330)
  assert.ok(cb > 180 && cg > 150 && cr < 110, `the upper arm is cyan, not rgb(${cr},${cg},${cb})`)
  assert.equal(pixel(4, 4)[3], 0, 'the corners are clear')
  const images = [...icon.matchAll(/<image\b[^>]*>/g)].map(match => match[0])
  assert.equal(images.length, 1)
  assert.match(images[0], / href="triskle-three-colours\.svg" /)
  assert.match(images[0], / xlink:href="triskle-three-colours\.svg" /)
  // Square, as the drawing is, and centred on the tile.
  assert.match(images[0], / x="180\.5" y="183\.5" width="663" height="663" /)
  assert.doesNotMatch(icon, /mark\.png/)
  assert.deepEqual(pngSize(bytes('assets/icon.png')), [1024, 1024])
  for (const use of [...text('electron-builder.yml').matchAll(/^\s*icon: (\S+)$/gm)]) assert.equal(use[1], 'assets/icon.png')
})
