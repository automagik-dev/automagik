// -------------------------------------------------------------------------
// The pet atlas and its poses, as plain data and functions: no DOM, no React, no canvas. The
// player (pet.js) and the browser bake (pet-bake.js) import them from here, and so does the
// headless bake (apps/automagik-pets), which draws the same poses into the same cells without a
// browser.

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

const TAU = Math.PI * 2
// Where the character stands in its 192x208 cell: 150px tall, its feet 12px off the bottom,
// with room above for a jump.
export const BODY = 150
export const FLOOR = 196
export const NEUTRAL_COLUMN = 6

// The pose of one cell: dx, dy (px), rot (degrees), sx, sy (scale from the feet), the face
// (bakeMarkup's names) and gaze (gx, gy, -1 to 1: where the eyes look).
export const rest = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, face: 'open', gx: 0, gy: 0 }
const pose = patch => ({ ...rest, ...patch })
export const POSES = {
  idle: (f) => {
    const breath = Math.sin((f / 6) * TAU)
    return pose({ sy: 1 + breath * 0.02, sx: 1 - breath * 0.012, face: f === 3 ? 'closed' : 'open' })
  },
  'running-right': f => hop(f, 1),
  'running-left': f => hop(f, -1),
  waving: f => pose({ rot: f % 2 === 0 ? -9 : 9, dy: f % 2 === 0 ? 0 : -5, face: 'happy' }),
  // Anticipation, lift, peak, descent, settle.
  jumping: f => pose({
    ...[{ sy: 0.88, sx: 1.08 }, { sy: 1.08, sx: 0.94, dy: -24 }, { sy: 1.02, dy: -38 }, { sy: 1.04, sx: 0.98, dy: -16 }, { sy: 0.9, sx: 1.06 }][f],
    face: f === 0 || f === 4 ? 'closed' : 'happy',
  }),
  failed: f => pose({ dy: 7, sy: 0.93, sx: 1.04, rot: -4 + Math.sin((f / 8) * TAU) * 2.5, face: 'sad', gy: 0.7 }),
  waiting: f => pose({ dy: [0, -9, -4, 0, 0, 0][f], sy: f === 3 ? 0.96 : 1, face: 'open', gy: -1, gx: Math.sin((f / 6) * TAU) * 0.2 }),
  running: (f) => {
    const beat = Math.abs(Math.sin((f / 6) * TAU))
    return pose({ dy: -8 * beat, sy: 1 - (1 - beat) * 0.05, sx: 1 + (1 - beat) * 0.03, rot: Math.sin((f / 6) * TAU) * 3, face: 'focused' })
  },
  review: f => pose({ rot: Math.sin((f / 6) * TAU) * 2.5, face: 'focused', gx: Math.sin((f / 6) * TAU), gy: 0.35 }),
}
function hop(f, way) {
  const lift = Math.sin(((f % 4) / 4) * Math.PI)
  return pose({ dy: -16 * lift, rot: 7 * way, sy: f % 4 === 0 ? 0.92 : 1 + lift * 0.03, sx: f % 4 === 0 ? 1.06 : 1, gx: way })
}
// Direction d of sixteen, 0 up and clockwise: the eyes and a little of the body turn that way.
export const lookPose = (d) => {
  const angle = (d / DIRECTIONS) * TAU
  const gx = Math.sin(angle)
  const gy = -Math.cos(angle)
  return pose({ dx: gx * 4, dy: gy * 3, rot: gx * 4, gx, gy })
}
export const sleepPose = f => pose({ sy: 1 + Math.sin((f / 6) * TAU) * 0.018, face: 'asleep', dy: 2 })
// The small z that drifts up beside a sleeper in sleep cell f: where its baseline starts in the
// cell (px), its size and its color.
export const sleepZ = f => ({ x: 138 + f * 2, y: 60 - f * 6, size: 20 + f * 2, fill: 'rgba(90,100,140,.75)' })
