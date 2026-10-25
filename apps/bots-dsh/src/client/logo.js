import { createElement as h } from 'react'
import { MARK_ART, WORDMARK_ART, WORDMARK_RATIO } from './clay-art.js'

// The Automagik logo, both halves in the owner's modelling clay: the mark is the triskelion
// (art/mark.webp, the three bent arms, the same picture as the desktop app's icon), and the
// uppercase AUTOMAGIK wordmark is the lockup's clay letters (art/wordmark.webp), cyan to
// magenta, the same by day and at night.

// The mark, `size` square (the name stays: other Omni plugins draw it through omni.ui.OmniMark).
export function OmniMark({ size = 16 }) {
  return h('img', { className: 'omni-logo omni-mark', src: MARK_ART, width: size, height: size, alt: '', 'aria-hidden': true, draggable: false })
}

export function Wordmark({ height = 14 }) {
  return h('img', { className: 'omni-logo omni-wordmark', src: WORDMARK_ART, height, width: Math.round(height * WORDMARK_RATIO), alt: 'Automagik', draggable: false })
}

// The browser tab's icon: DSH sets one per color scheme; the app swaps in its clay mark for both
// and puts DSH's back when the plugin goes away.
export function installFavicon() {
  const links = [...document.querySelectorAll('link[rel~="icon"]')]
  const saved = links.map(link => [link, link.getAttribute('href'), link.getAttribute('type')])
  for (const link of links) {
    link.setAttribute('href', MARK_ART)
    link.setAttribute('type', 'image/webp')
  }
  if (links.length === 0) {
    const link = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/webp', href: MARK_ART })
    document.head.append(link)
    return () => link.remove()
  }
  return () => {
    for (const [link, href, type] of saved) {
      if (href === null) link.removeAttribute('href'); else link.setAttribute('href', href)
      if (type === null) link.removeAttribute('type'); else link.setAttribute('type', type)
    }
  }
}
