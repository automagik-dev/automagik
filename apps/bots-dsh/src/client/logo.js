import { createElement as h } from 'react'
import { LOGO } from './clay.js'

// The Automagik logo, drawn as vectors: the triskelion (three bent arms, from the brand file;
// it matches the owner's automagik-triskelion.svg silhouette at 0.97 IoU) and the uppercase
// AUTOMAGIK wordmark (the letter outlines of the owner's automagik-wordmark.svg). Each is drawn
// three times, the cyan piece nudged left and the magenta one right under the shape itself,
// which takes the current text colour: plum ink on the light clay, cream at night. The two
// pigments are the ones those files use.
const MARK = 'M61.6 6.7L118.4 103.6L98.6 103.6L61.6 41.8L24.6 103.6L4.4 103.6ZM137.9 55.1L188.2 145.3L84.9 145.3L94.8 127.8L158.1 127.8L127.6 72.7ZM65 93.6L75 111.9L43.7 167.8L107.7 167.8L117.7 185.5L13.6 185.5Z'
const MARK_BOX = 192.6
const WORD = 'M59.7 74.9C59.8 75.1 59.8 75.4 59.6 75.6C59.4 75.9 59.1 76 58.8 76L45.7 76C45.3 76 45 75.8 44.8 75.4L29.8 33.1L15 75.4C15 75.8 14.6 76 14.1 76L1.1 76C0.6 76 0.3 75.9 0.2 75.6C0 75.4 0 75.1 0.1 74.9L28.9 0.6C29 0.2 29.3 0 29.8 0C30.4 0 30.7 0.2 30.8 0.6ZM59.7 74.9M118.7 0C119.4 0 119.7 0.3 119.7 0.9L119.7 50.6C119.7 56 118.4 60.5 115.9 64.3C113.4 68.1 110 71 105.7 73C101.4 75 96.6 76 91.2 76C86 76 81.2 75 76.9 72.9C72.6 70.9 69.1 67.9 66.5 64.1C64 60.3 62.7 55.8 62.7 50.6L62.7 13.8L77 13.8L77 50.5C77.5 54.3 79.1 57.1 81.8 59.1C84.6 61.1 87.7 62 91.2 62C93.6 62 95.9 61.6 98 60.8C100.2 60 101.9 58.7 103.3 57C104.7 55.3 105.3 53.2 105.3 50.6L105.3 0.9C105.3 0.3 105.7 0 106.4 0ZM118.7 0M138.2 27.6L152.6 27.6L152.6 75.1C152.6 75.7 152.2 76 151.5 76L139.2 76C138.5 76 138.2 75.7 138.2 75.1ZM123.6 13C122.9 13 122.5 12.8 122.5 12.2L122.5 0.9C122.5 0.3 122.9 0 123.6 0L167.2 0C167.8 0 168.2 0.3 168.2 0.9L168.2 12.2C168.2 12.8 167.8 13 167.2 13ZM123.6 13M214.2 38.2C214.2 40.2 213.5 41.9 212.1 43.2C210.7 44.6 209.1 45.3 207 45.3C205.1 45.3 203.4 44.6 202 43.2C200.6 41.9 199.9 40.2 199.9 38.2C199.9 36.2 200.6 34.5 202 33.1C203.4 31.7 205.1 31 207 31C209.1 31 210.7 31.7 212.1 33.1C213.5 34.5 214.2 36.2 214.2 38.2ZM243.6 37.9C243.6 42.7 242.8 47.3 241.3 51.8C239.8 56.4 237.5 60.4 234.5 64.1C231.4 67.7 227.6 70.6 223.1 72.8C218.5 74.9 213.2 76 207.1 76C201 76 195.6 74.9 191 72.8C186.4 70.6 182.6 67.7 179.6 64.1C176.6 60.4 174.3 56.4 172.8 51.8C171.2 47.3 170.5 42.7 170.5 37.9C170.5 33.2 171.2 28.6 172.8 24.1C174.3 19.6 176.6 15.5 179.6 11.9C182.6 8.3 186.4 5.4 191 3.3C195.6 1.1 201 0 207.1 0C213.2 0 218.5 1.1 223.1 3.3C227.6 5.4 231.4 8.3 234.5 11.9C237.5 15.5 239.8 19.6 241.3 24.1C242.8 28.6 243.6 33.2 243.6 37.9ZM229.4 38.2C229.4 35.1 228.9 32.1 227.9 29.1C227 26.2 225.6 23.5 223.7 21.2C221.9 18.8 219.6 16.9 216.8 15.5C214 14.1 210.8 13.4 207.1 13.4C203.4 13.4 200.1 14.1 197.3 15.5C194.6 16.9 192.2 18.8 190.4 21.2C188.5 23.5 187.1 26.2 186.2 29.1C185.3 32.1 184.8 35.1 184.8 38.2C184.8 41.2 185.3 44.2 186.2 47.1C187.1 50 188.5 52.7 190.4 55C192.2 57.4 194.6 59.2 197.3 60.6C200.1 62 203.4 62.7 207.1 62.7C210.8 62.7 214 62 216.8 60.6C219.6 59.2 221.9 57.4 223.7 55C225.6 52.7 227 50 227.9 47.1C228.9 44.2 229.4 41.2 229.4 38.2ZM229.4 38.2M315.2 57.7L315.2 33.6L295.8 72.4C295.7 72.8 295.4 73 295 73L283.3 73C282.8 73 282.5 72.8 282.3 72.4L261.7 32.5L261.7 75.1C261.7 75.7 261.4 76 260.7 76L248.2 76C247.5 76 247.2 75.7 247.2 75.1L247.2 0.9C247.2 0.3 247.5 0 248.2 0L260.9 0C261.4 0 261.7 0.2 261.8 0.6L289.1 56.2L315 0.6C315.3 0.2 315.6 0 316 0L328.6 0C329.3 0 329.6 0.3 329.6 0.9L329.6 57.7ZM315.2 57.7M393.4 74.9C393.6 75.1 393.5 75.4 393.3 75.6C393.1 75.9 392.9 76 392.6 76L379.5 76C379 76 378.7 75.8 378.6 75.4L363.6 33.1L348.8 75.4C348.7 75.8 348.4 76 347.9 76L334.9 76C334.4 76 334.1 75.9 333.9 75.6C333.8 75.4 333.8 75.1 333.9 74.9L362.7 0.6C362.8 0.2 363.1 0 363.6 0C364.1 0 364.4 0.2 364.6 0.6ZM393.4 74.9M454.4 14L439.9 14C438 13.9 435.9 14 433.4 14.1C430.9 14.3 428.4 14.8 425.8 15.6C423.2 16.4 420.8 17.6 418.6 19.3C416.3 21 414.5 23.4 413.1 26.4C411.8 29.5 411.1 33.3 411.1 38C411.1 44 412.4 48.9 414.9 52.5C417.4 56.1 420.8 58.7 425.1 60.2C429.4 61.8 434.4 62.4 439.9 62.1L439.9 43.1L425.2 43.1L425.2 28.6L454.4 28.6L454.4 75.1C454.4 75.7 454 76 453.4 76L441 76C437.3 76 433.4 75.8 429.3 75.2C425.2 74.7 421.2 73.8 417.3 72.3C413.4 70.8 409.9 68.7 406.8 65.9C403.6 63.1 401.1 59.5 399.3 54.9C397.4 50.4 396.5 44.7 396.5 38C396.5 31.5 397.4 26 399.2 21.5C401.1 17.1 403.5 13.4 406.7 10.6C409.8 7.8 413.3 5.6 417.2 4.1C421 2.5 425 1.5 429.1 0.9C433.2 0.3 437.2 0 441 0L453.4 0C454 0 454.4 0.3 454.4 0.9ZM454.4 14M488.3 63C489 63 489.3 63.3 489.3 63.8L489.3 75.1C489.3 75.7 489 76 488.3 76L458.4 76C457.7 76 457.3 75.7 457.3 75.1L457.3 63.8C457.3 63.3 457.7 63 458.4 63L466.2 63L466.2 0L480.7 0L480.7 63ZM488.3 63M551.5 74.6C551.9 75 551.9 75.3 551.7 75.6C551.5 75.9 551.2 76 550.7 76L534.3 76C534 76 533.7 75.9 533.5 75.7L511.4 48.4C511.1 48.7 510.3 49.5 509.2 50.7C508.1 51.9 506.8 53.4 505.2 55.2C503.7 56.9 502.1 58.7 500.5 60.6C498.8 62.4 497.3 64.2 495.8 65.8C494.3 67.5 493.2 68.8 492.3 69.8C491.4 70.8 491 71.3 491 71.3L491 0.9C491 0.3 491.3 0 492 0L504.5 0C505.2 0 505.5 0.3 505.5 0.9L505.5 35.5L534.1 0.3C534.3 0.1 534.5 0 534.9 0L550.4 0C550.9 0 551.3 0.2 551.4 0.5C551.6 0.8 551.6 1.1 551.3 1.5L521.1 38.7ZM551.5 74.6'
const WORD_BOX = [551.92, 76]
const SHIFT = 4.3
const WORD_SHIFT = 2.73

// Below this size the coloured pieces would only smear the edges, so the shape is drawn alone.
const GLITCH_MIN = 16
// The small-size mark: under 40px a nudge of SHIFT is less than a pixel, so the pieces
// move a whole pixel instead and stay visible as two colours at 32px.
const shiftAt = size => Math.max(SHIFT, MARK_BOX / size)

const layers = (d, glitch, shift = SHIFT) => [
  glitch ? h('path', { key: 'c', d, fill: LOGO.left, transform: `translate(-${shift} 0)` }) : null,
  glitch ? h('path', { key: 'm', d, fill: LOGO.right, transform: `translate(${shift} 0)` }) : null,
  h('path', { key: 'top', d, fill: 'currentColor' }),
]

// The mark (the name stays: other Omni plugins draw it through omni.ui.OmniMark).
export function OmniMark({ size = 16 }) {
  const shift = shiftAt(size)
  return h('svg', { className: 'omni-logo', width: size, height: size, viewBox: `${-shift} 0 ${MARK_BOX + 2 * shift} ${MARK_BOX}`, 'aria-hidden': true, focusable: 'false' }, layers(MARK, size >= GLITCH_MIN, shift))
}

export function Wordmark({ height = 14 }) {
  const [w, hgt] = WORD_BOX
  return h('svg', { className: 'omni-logo', height, width: Math.round(height * (w + 2 * WORD_SHIFT) / hgt), viewBox: `${-WORD_SHIFT} 0 ${w + 2 * WORD_SHIFT} ${hgt}`, role: 'img', 'aria-label': 'Automagik', focusable: 'false' }, layers(WORD, true, WORD_SHIFT))
}

// The browser tab's icon: DSH sets one per color scheme; the app swaps in its mark for each
// (the small-size one, a tab icon being 16 to 32 pixels) and puts DSH's back when the plugin
// goes away.
const ICON_SHIFT = shiftAt(32)
const markSvg = top => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-ICON_SHIFT} 0 ${MARK_BOX + 2 * ICON_SHIFT} ${MARK_BOX}"><path d="${MARK}" fill="${LOGO.left}" transform="translate(-${ICON_SHIFT} 0)"/><path d="${MARK}" fill="${LOGO.right}" transform="translate(${ICON_SHIFT} 0)"/><path d="${MARK}" fill="${top}"/></svg>`
const iconHref = top => `data:image/svg+xml,${encodeURIComponent(markSvg(top))}`

export function installFavicon() {
  const links = [...document.querySelectorAll('link[rel~="icon"]')]
  const saved = links.map(link => [link, link.getAttribute('href')])
  for (const link of links) link.setAttribute('href', iconHref(/dark/.test(link.media ?? '') ? LOGO.night : LOGO.ink))
  if (links.length === 0) {
    const link = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: iconHref(LOGO.ink) })
    document.head.append(link)
    return () => link.remove()
  }
  return () => { for (const [link, href] of saved) if (href === null) link.removeAttribute('href'); else link.setAttribute('href', href) }
}
