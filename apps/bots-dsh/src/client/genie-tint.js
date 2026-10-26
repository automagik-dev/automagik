// Genie's art (its clay character and its pet) is painted magenta: its body and plume sit
// at about 325° (measured over the pet's first frame). A Genie in another color (genie-dsh
// gives each Genie one no other Genie wears, GENIE_COLORS there) is that painting turned to
// the color's ink: gray and black lose the color, brown and black are darker, yellow and
// orange sit a little warmer than their ink (a hue turn darkens them), and aurora drifts
// through its gradient (GENIE_AURORA, an animation in styles.js). Magenta, and a Genie with
// no color, are the painting as it is.
import { INKS, isHex } from './inks.js'

const GENIE_HUE = 325
const AS_PAINTED = new Set([undefined, null, '', 'magenta'])
const HUE = { yellow: 54, orange: 30 }
/** What genieTint answers for aurora: the mark plays the bt-genie-aurora animation instead of one filter. */
export const GENIE_AURORA = 'aurora'
const GRAY = { gray: 'saturate(0) brightness(1.05)', black: 'saturate(0) brightness(.42) contrast(1.25)' }
const EXTRA = { brown: ' saturate(.5) brightness(.82)', yellow: ' brightness(1.18) saturate(1.1)', orange: ' brightness(1.06)' }

export function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const span = max - Math.min(r, g, b)
  if (span === 0) return 0
  const hue = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4
  return (hue * 60 + 360) % 360
}

/** The CSS filter that turns Genie's art to `color` (a Bot team color id or #hex), or undefined as painted. */
export function genieTint(color) {
  if (AS_PAINTED.has(color)) return undefined
  if (color === 'aurora') return GENIE_AURORA
  if (GRAY[color]) return GRAY[color]
  const ink = isHex(color) ? color : INKS[color]?.[0]
  if (!ink) return undefined
  const turn = Math.round((HUE[color] ?? hueOf(ink)) - GENIE_HUE)
  return Math.abs(turn) < 6 ? (EXTRA[color]?.trim() || undefined) : `hue-rotate(${turn}deg)${EXTRA[color] ?? ''}`
}
