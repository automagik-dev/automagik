import { createElement as h } from 'react'
import {
  genieLockupThreeColoursCreamHeader, genieLockupThreeColoursInkHeader,
  omniLockupThreeColoursCreamHeader, omniLockupThreeColoursInkHeader,
} from './vendor/art/inline.js'

// Genie's and Omni's names on their cards, as the approved lockups (vendor/art/brand, byte
// copies of the final set; SOURCE.json): the triskle in its three colours beside the lowercase
// name, whose i carries the product's sparkle (Genie pink, Omni cyan). The drawing is the one
// made for headers. Its letters are ink on a light ground and cream on a dark one; the ground
// is DSH's Appearance setting, read from body[data-ds-dark-theme] like the rest of the styles.
// The three lockups share one frame 264 tall, so at one height the mark and the letters are
// the same size on every card.
export const LOCKUP_HEIGHT = 36
export const PRODUCT_LOCKUPS = Object.freeze({
  omni: Object.freeze({ name: 'Omni', ink: omniLockupThreeColoursInkHeader, cream: omniLockupThreeColoursCreamHeader, frame: 916.53 }),
  genie: Object.freeze({ name: 'Genie', ink: genieLockupThreeColoursInkHeader, cream: genieLockupThreeColoursCreamHeader, frame: 976.34 }),
})
export const lockupWidth = product => Math.round(LOCKUP_HEIGHT * PRODUCT_LOCKUPS[product].frame / 264)

// A card's heading: the lockup is the picture, and the name stays as text for a screen reader
// (the word is in the picture, so it is not drawn twice).
export function ProductLockup({ product }) {
  return h('h2', { className: 'oai-product' },
    h('i', { className: `oai-lockup oai-lockup-${product}`, 'aria-hidden': true }),
    h('span', { className: 'oai-hidden' }, PRODUCT_LOCKUPS[product].name))
}

// The lockup is wider than the plain name was: on a narrow card the line beside it ("On your
// team", Remove) goes under it whole instead of being squeezed.
export const PRODUCT_LOCKUP_CSS = `
.oai-fighter h2.oai-product{position:relative;display:flex;line-height:0}
.oai-fighter header:has(.oai-lockup){flex-wrap:wrap;row-gap:8px}
.oai-fighter header:has(.oai-lockup) .oai-team-line{flex:none}
.oai-lockup{display:block;flex:none;height:${LOCKUP_HEIGHT}px;background:center/contain no-repeat}
${Object.entries(PRODUCT_LOCKUPS).map(([product, art]) => `.oai-lockup-${product}{width:${lockupWidth(product)}px;background-image:url("${art.ink}")}
body[data-ds-dark-theme] .oai-lockup-${product}{background-image:url("${art.cream}")}`).join('\n')}
`
