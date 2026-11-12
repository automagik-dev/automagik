// The official Automagik lockup: the Automagik logo with we unfold's Open Intelligence tag
// under it, right edges together. The proportions are the ones Arca's lockup uses: the tag is
// 170/275 (62%) of the logo's width, and the space between them is 102.47/2146.4 of it.
// The logo is the logo kit's own lockup, large drawing (assets/brand/automagik-lockup-three-colours-ink.svg
// and -cream.svg: the approved triskle and the lowercase wordmark), set inside unchanged. The
// tag is we unfold's file, unchanged, in the same tone: Automagik's ink for light grounds,
// its cream for dark ones. Its words are live text in IBM Plex Mono SemiBold, so the font
// travels inside the file.
// Writes assets/brand/automagik/automagik-lockup-oi-{ink,cream}.svg, and with --png the same
// at 3000 px wide on a see-through ground. --png needs playwright-core and a Chromium
// (LANDING_CHROME). Run from anywhere: node apps/landing/scripts/build-lockup.mjs --png
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const brand = new URL('../assets/brand/', import.meta.url)
export const TONES = { ink: '#3c3049', cream: '#f3e9dd' }
// The kit lockup's box, and where its letters end inside it (the box is a little larger
// than the drawing; the tag lines up with the k's right edge and sits under the g's tail).
export const BOX = { x: 0, y: -186, width: 1632.34, height: 264 }
export const LOGO = { width: 1628.34, height: 262 }
const TAG = { width: 340, height: 64 }
const scale = LOGO.width * (170 / 275) / TAG.width
const gap = LOGO.width * (102.47 / 2146.4)
export const GEOMETRY = { scale, x: LOGO.width - TAG.width * scale, y: LOGO.height + gap, width: LOGO.width, height: LOGO.height + gap + TAG.height * scale }
// The tag's own drawing, as given: everything inside its root element.
export const tagInner = () => readFileSync(new URL('open-intelligence/open-intelligence-tag.svg', brand), 'utf8').trim().replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>$/, '')
// The kit lockup's own drawing, as given: everything inside its root element.
export const logoInner = tone => readFileSync(new URL(`automagik-lockup-three-colours-${tone}.svg`, brand), 'utf8').trim().replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>$/, '')
export function lockupSvg(tone) {
  const font = readFileSync(new URL('ibm-plex-mono-latin-600.woff2', brand)).toString('base64')
  const { x, y, width, height } = GEOMETRY, n = value => value.toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}" color="${TONES[tone]}" role="img" aria-label="Automagik, with the Open Intelligence tag"><style>@font-face{font-family:"IBM Plex Mono";font-weight:600;src:url(data:font/woff2;base64,${font}) format("woff2")}</style><svg width="${BOX.width}" height="${BOX.height}" viewBox="${BOX.x} ${BOX.y} ${BOX.width} ${BOX.height}">${logoInner(tone)}</svg><g transform="translate(${n(x)} ${n(y)}) scale(${scale.toFixed(5)})">${tagInner()}</g></svg>\n`
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('automagik/', brand)
  mkdirSync(out, { recursive: true })
  for (const tone of Object.keys(TONES)) writeFileSync(new URL(`automagik-lockup-oi-${tone}.svg`, out), lockupSvg(tone))
  if (process.argv.includes('--png')) {
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath: process.env.LANDING_CHROME || undefined, headless: true })
    try {
      const context = await browser.newContext({ viewport: { width: Math.ceil(GEOMETRY.width), height: Math.ceil(GEOMETRY.height) }, deviceScaleFactor: 3000 / Math.ceil(GEOMETRY.width) })
      for (const tone of Object.keys(TONES)) {
        const page = await context.newPage()
        await page.goto(new URL(`automagik-lockup-oi-${tone}.svg`, out).href)
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: fileURLToPath(new URL(`automagik-lockup-oi-${tone}.png`, out)), omitBackground: true, clip: { x: 0, y: 0, width: Math.ceil(GEOMETRY.width), height: Math.ceil(GEOMETRY.height) } })
        await page.close()
      }
    } finally { await browser.close() }
  }
  console.log('wrote', fileURLToPath(out))
}
