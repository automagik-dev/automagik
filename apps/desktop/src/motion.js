// How the window comes and goes: a short fade where the system can draw one (macOS and Windows
// blend a window's opacity; Linux cannot, so there it shows and hides at once). Quitting hides
// the window first and lets dsh stop behind it, so a quit never looks stuck. Pure: main.js
// passes the window, tests pass a stand-in.

export const FADE_MS = 160
const FRAME_MS = 16

/** Fades `win` to opacity `to` (0 hides it at the end, 1 shows it first); resolves when done. */
export function fade(win, { to, ms = FADE_MS, platform = process.platform, reduced = false, timers = globalThis, now = () => Date.now() } = {}) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve()
    const blends = platform !== 'linux' && !reduced && ms > 0
    if (to === 0 && !win.isVisible()) return resolve()
    if (!blends) {
      if (to === 0) win.hide()
      else { win.setOpacity?.(1); win.show() }
      return resolve()
    }
    const from = to === 0 ? 1 : 0
    if (to === 1) { win.setOpacity(0); win.show() }
    const start = now()
    const tick = () => {
      if (win.isDestroyed()) return resolve()
      const t = Math.min(1, (now() - start) / ms)
      // Ease out: quick at first, settling at the end.
      win.setOpacity(from + (to - from) * (1 - (1 - t) ** 2))
      if (t < 1) return void timers.setTimeout(tick, FRAME_MS)
      if (to === 0) { win.hide(); win.setOpacity(1) }
      resolve()
    }
    tick()
  })
}

// dsh's page comes in over the splash as a short fade rather than a cut (insertCSS before it
// is laid in); none when the person asked for less motion.
export const PAGE_IN_CSS = 'html{animation:automagik-in .22s ease-out both}@keyframes automagik-in{from{opacity:0}}@media (prefers-reduced-motion:reduce){html{animation:none}}'
