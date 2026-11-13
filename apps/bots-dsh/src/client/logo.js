import { createElement as h, useSyncExternalStore } from 'react'
import { LOCKUP_ART, LOCKUP_RATIO, WORDMARK_ART, WORDMARK_RATIO, markArt } from './clay-art.js'

// The Automagik logo, as approved: the triskle in its three colours (always in colour), and
// the lowercase wordmark whose i carries Automagik's violet sparkle. The pictures are the
// approved set's own files (clay-art.js, art/brand).

// The letters are ink on a light ground and cream on a dark one. The ground is DSH's
// Appearance setting, which the app reads from body[data-ds-dark-theme] like its styles do.
const DARK = 'data-ds-dark-theme'
const isDark = () => document.body.hasAttribute(DARK)
const watchDark = (changed) => {
  const watch = new MutationObserver(changed)
  watch.observe(document.body, { attributes: true, attributeFilter: [DARK] })
  return () => watch.disconnect()
}
const useLetters = () => (useSyncExternalStore(watchDark, isDark, () => false) ? 'cream' : 'ink')

// The mark, `size` square (the name stays: other Omni plugins draw it through omni.ui.OmniMark).
export function OmniMark({ size = 16 }) {
  return h('img', { className: 'omni-logo omni-mark', src: markArt(size), width: size, height: size, alt: '', 'aria-hidden': true, draggable: false })
}

// The name alone, `height` tall: its frame is the lockup's, so beside a mark of about the same
// height the two stand as they do in the lockup.
export function Wordmark({ height = 24 }) {
  return h('img', { className: 'omni-logo omni-wordmark', src: WORDMARK_ART[useLetters()], height, width: Math.round(height * WORDMARK_RATIO), alt: 'Automagik', draggable: false })
}

// The mark and the name together, as the lockup draws them, `height` tall.
export function Lockup({ height = 32 }) {
  return h('img', { className: 'omni-logo omni-lockup', src: LOCKUP_ART[useLetters()], height, width: Math.round(height * LOCKUP_RATIO), alt: 'Automagik', draggable: false })
}

// The browser tab's icon: DSH sets one per color scheme; the app swaps in its mark for both
// (the drawing made for a tab's size: the set's favicon.svg is that same file; its three colours
// hold on a light and on a dark browser theme) and puts DSH's back when the plugin goes away.
export const FAVICON = Object.freeze({ href: markArt(32), type: 'image/svg+xml' })
export function installFavicon() {
  const links = [...document.querySelectorAll('link[rel~="icon"]')]
  const saved = links.map(link => [link, link.getAttribute('href'), link.getAttribute('type')])
  for (const link of links) {
    link.setAttribute('href', FAVICON.href)
    link.setAttribute('type', FAVICON.type)
  }
  if (links.length === 0) {
    const link = Object.assign(document.createElement('link'), { rel: 'icon', ...FAVICON })
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
