import { createElement as h, useEffect, useRef, useState } from 'react'

// -------------------------------------------------------------------------
// The pet player: every live Bot mark is a pet in the Codex format (codex-pets.net, and
// Codex's ~/.codex/pets): one atlas of 192x208 cells, eight to a row, a row per animation.
// v1 has the nine rows below; v2 adds two rows of eight, the sixteen directions the pet
// looks in (0 is up, clockwise in 22.5° steps), which follow the pointer here. A pet may add
// the DSH extension's sleep strip (six cells, its own image). Where the pet comes from
// (a pet the team installed, Genie's, or a team character baked into an atlas: pet-bake.js)
// does not matter here.

export const CELL = Object.freeze({ width: 192, height: 208, columns: 8 })
// Each row's cell durations, as Codex plays them (the toolkit's animation-rows.md).
const even = (count, ms, last) => [...Array(count - 1).fill(ms), last]
export const ROWS = Object.freeze({
  idle: { row: 0, ms: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, ms: even(8, 120, 220) },
  'running-left': { row: 2, ms: even(8, 120, 220) },
  waving: { row: 3, ms: even(4, 140, 280) },
  jumping: { row: 4, ms: even(5, 140, 280) },
  failed: { row: 5, ms: even(8, 140, 240) },
  waiting: { row: 6, ms: even(6, 150, 260) },
  running: { row: 7, ms: even(6, 120, 220) },
  review: { row: 8, ms: even(6, 150, 280) },
})
export const LOOK_ROW = 9
export const DIRECTIONS = 16
export const SLEEP = Object.freeze({ ms: Array(6).fill(320) })
export const rowsOf = version => (version === 2 ? 11 : 9)
// Rows that play once, then hand back to the state's own loop.
export const ONCE = Object.freeze(['waving', 'jumping'])

// What the Bot is doing (mark.js STATES), as the adoption contract maps it (the pet
// toolkit's FORMAT.md): every kind of work runs, searching reviews, work handed on is a
// quiet idle, a question or an approval waits for the person, the settle after a run jumps
// once and a poke waves once. Beyond it: a turn that failed is `failed`, a reply ready to read
// is Codex's own `review`, and asleep is the sleep strip (else a slow idle).
const ROW_OF_STATE = Object.freeze({
  idle: 'idle',
  thinking: 'running',
  working: 'running',
  sending: 'running',
  orbit: 'running',
  searching: 'review',
  waiting: 'idle',
  alert: 'waiting',
  review: 'review',
  done: 'jumping',
  failed: 'failed',
  poked: 'waving',
  sleeping: 'idle',
})
export const petRowOf = state => ROW_OF_STATE[state] ?? 'idle'

/** The look direction (0 up, clockwise, 16 steps) for a pointer at dx, dy from the pet. */
export const directionOf = (dx, dy) => Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / (360 / DIRECTIONS)) % DIRECTIONS

/** The cell to show: { row, frame } for an animation row and frame, or a look direction. */
export function cellOf(row, frame, direction) {
  if (direction !== undefined) return { row: LOOK_ROW + Math.floor(direction / CELL.columns), frame: direction % CELL.columns }
  const { row: index, ms } = ROWS[row] ?? ROWS.idle
  return { row: index, frame: frame % ms.length }
}

// The person's last input anywhere in the window, for pets that fall asleep when nobody is
// there. One listener for every mark.
const DROWSY_MS = 10 * 60_000
let lastInput = Date.now()
let drowsyListening = false
const sleepers = new Set()
function listenForInput() {
  if (drowsyListening || typeof window === 'undefined') return
  drowsyListening = true
  const wake = () => {
    const was = Date.now() - lastInput > DROWSY_MS
    lastInput = Date.now()
    if (was) for (const set of sleepers) set(false)
  }
  for (const type of ['pointermove', 'keydown', 'pointerdown', 'wheel']) window.addEventListener(type, wake, { passive: true, capture: true })
  setInterval(() => { if (Date.now() - lastInput > DROWSY_MS) for (const set of sleepers) set(true) }, 30_000).unref?.()
}
/** True while nobody has touched the window for ten minutes. */
export function useDrowsy(enabled = true) {
  const [drowsy, setDrowsy] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    listenForInput()
    sleepers.add(setDrowsy)
    return () => { sleepers.delete(setDrowsy) }
  }, [enabled])
  return enabled && drowsy
}

const quiet = () => typeof document !== 'undefined' && (document.body?.dataset.btMotion === 'quiet' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)

// The pointer's direction from the pet, while it moves; nothing once it rests a moment.
function useLook(ref, enabled) {
  const [direction, setDirection] = useState(undefined)
  useEffect(() => {
    if (!enabled) return undefined
    let frame = 0
    let rest
    let point = null
    const place = () => {
      frame = 0
      const node = ref.current
      if (!node || !point) return
      const box = node.getBoundingClientRect()
      const dx = point.x - box.left - box.width / 2
      const dy = point.y - box.top - box.height / 2
      setDirection(Math.hypot(dx, dy) < box.width * 0.6 ? undefined : directionOf(dx, dy))
    }
    const onMove = (event) => {
      point = { x: event.clientX, y: event.clientY }
      if (!frame) frame = requestAnimationFrame(place)
      clearTimeout(rest)
      rest = setTimeout(() => setDirection(undefined), 2400)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => { cancelAnimationFrame(frame); clearTimeout(rest); window.removeEventListener('pointermove', onMove) }
  }, [enabled])
  return direction
}

/**
 * A pet drawn at `size` (its 192x208 cell fit to the height, centered), playing the row for
 * `state`. `live` animates it (a still one shows its row's first cell, as a transcript keeps
 * still); `gaze` turns it toward the pointer at rest, on a pet with look rows. `onOnce`
 * hears a row that plays once (a wave, a jump) end.
 */
export function PetSprite({ pet, size, state = 'idle', live = false, gaze = false, onOnce }) {
  const ref = useRef(null)
  const asleep = state === 'sleeping' && pet.sleep !== undefined
  const row = petRowOf(state)
  const [frame, setFrame] = useState(0)
  const look = useLook(ref, live && gaze && pet.version === 2)
  const resting = row === 'idle' && !asleep
  const direction = resting && look !== undefined ? look : undefined
  const onceRef = useRef(onOnce)
  onceRef.current = onOnce
  useEffect(() => { setFrame(0) }, [row, asleep])
  useEffect(() => {
    if (!live || quiet() || direction !== undefined) return undefined
    const { ms } = asleep ? SLEEP : ROWS[row]
    const slow = state === 'sleeping' && !asleep ? 3 : 1
    const timer = setTimeout(() => {
      const next = frame + 1
      if (next >= ms.length && ONCE.includes(row)) { onceRef.current?.(row); return }
      setFrame(next % ms.length)
    }, ms[frame % ms.length] * slow)
    return () => clearTimeout(timer)
  }, [live, row, asleep, frame, direction, state])
  const scale = size / CELL.height
  const width = CELL.width * scale
  const cell = cellOf(row, frame, direction)
  const style = asleep
    ? { backgroundImage: `url("${pet.sleep}")`, backgroundSize: `${width * SLEEP.ms.length}px ${size}px`, backgroundPosition: `${-(frame % SLEEP.ms.length) * width}px 0` }
    : { backgroundImage: `url("${pet.sheet}")`, backgroundSize: `${width * CELL.columns}px ${size * rowsOf(pet.version)}px`, backgroundPosition: `${-cell.frame * width}px ${-cell.row * size}px` }
  return h('span', { ref, className: 'bt-pet', 'data-row': asleep ? 'sleep' : direction !== undefined ? 'look' : row, style: { width: size, height: size } },
    h('span', { className: 'bt-pet-cell', style: { width, height: size, ...style } }))
}

export const PET_CSS = `
.bt-pet{position:relative;display:inline-flex;justify-content:center;align-items:flex-end;overflow:visible;flex:none}
.bt-pet-cell{display:block;flex:none;background-repeat:no-repeat;image-rendering:auto}
`
