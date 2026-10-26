import { bakeMarkup } from './characters.js'
import { OMNI_ATLAS, faceAt } from './clay-art.js'
import { CELL, DIRECTIONS, LOOK_ROW, ROWS, SLEEP } from './pet.js'

// -------------------------------------------------------------------------
// The team's characters as Codex pets: each character (in the Bot's own color) and Omni in
// clay are baked into a v2 atlas, the format every live mark plays (pet.js), from the same
// art the marks draw. A pose per cell moves the body whole (a breath, a hop, a slump) and
// sets the eyes (open, closed, happy, focused, sad, looking a way), so every row means what
// the contract says (the pet toolkit's animation-rows.md). Baked once per look and kept for
// the page; at full size the same atlas goes to Codex's own pets folder.

const TAU = Math.PI * 2
// Where the character stands in its 192x208 cell: 150px tall, its feet 12px off the bottom,
// with room above for a jump.
const BODY = 150
const FLOOR = 196
const NEUTRAL_COLUMN = 6

// The pose of one cell: dx, dy (px), rot (degrees), sx, sy (scale from the feet), the face
// (bakeMarkup's names) and gaze (gx, gy, -1 to 1: where the eyes look).
const rest = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, face: 'open', gx: 0, gy: 0 }
const pose = patch => ({ ...rest, ...patch })
const POSES = {
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
const lookPose = (d) => {
  const angle = (d / DIRECTIONS) * TAU
  const gx = Math.sin(angle)
  const gy = -Math.cos(angle)
  return pose({ dx: gx * 4, dy: gy * 3, rot: gx * 4, gx, gy })
}
const sleepPose = f => pose({ sy: 1 + Math.sin((f / 6) * TAU) * 0.018, face: 'asleep', dy: 2 })

// Omni in clay has faces, not eyes: each face the pose's eyes stand for.
const OMNI_FACE = { open: 'calm', closed: 'calm', happy: 'delighted', focused: 'focused', sad: 'sad', asleep: 'asleep' }

const loadImage = src => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('A pet layer did not load'))
  image.src = src
})
const svgSrc = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

async function charactersLayers(shape, color) {
  const parts = bakeMarkup(shape, color)
  const [body, ...faces] = await Promise.all([parts.body, ...Object.values(parts.faces)].map(svg => loadImage(svgSrc(svg))))
  const byName = Object.fromEntries(Object.keys(parts.faces).map((name, index) => [name, faces[index]]))
  // The eyes move a few units of the character's 100-unit box when they look.
  return (context, p) => {
    context.drawImage(body, -BODY / 2, -BODY, BODY, BODY)
    const unit = BODY / parts.box
    context.drawImage(byName[p.face] ?? byName.open, -BODY / 2 + p.gx * 4.5 * unit, -BODY + p.gy * 3.5 * unit, BODY, BODY)
  }
}
async function omniLayers() {
  const atlas = await loadImage(OMNI_ATLAS)
  const side = atlas.naturalHeight
  return (context, p) => {
    const at = faceAt(OMNI_FACE[p.face] ?? 'calm') * side
    // The face cell, nudged toward where it looks.
    context.drawImage(atlas, at, 0, side, side, -BODY / 2 - 8 + p.gx * 5, -BODY - 14 + p.gy * 4, BODY + 16, BODY + 16)
  }
}

function drawCell(context, draw, column, row, p, scale) {
  context.save()
  // Nothing a pose moves may reach the next cell, which Codex keeps transparent when unused.
  context.beginPath()
  context.rect(column * CELL.width * scale, row * CELL.height * scale, CELL.width * scale, CELL.height * scale)
  context.clip()
  context.translate((column * CELL.width + CELL.width / 2 + p.dx) * scale, (row * CELL.height + FLOOR + p.dy) * scale)
  context.scale(scale, scale)
  context.rotate((p.rot * Math.PI) / 180)
  context.scale(p.sx, p.sy)
  draw(context, p)
  context.restore()
}
const canvasOf = (width, height) => Object.assign(document.createElement('canvas'), { width, height })
const blobOf = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The pet could not be encoded'))), 'image/webp', 1))

/** A look's atlas and sleep strip as WebP blobs, at `scale` (1 is Codex's own size). */
export async function bakeBlobs(look, scale = 1) {
  const draw = look.clay === 'omni' ? await omniLayers() : await charactersLayers(look.shape, look.color)
  const sheet = canvasOf(CELL.width * CELL.columns * scale, CELL.height * 11 * scale)
  const context = sheet.getContext('2d')
  context.imageSmoothingQuality = 'high'
  for (const [name, { row, ms }] of Object.entries(ROWS)) {
    for (let frame = 0; frame < ms.length; frame += 1) drawCell(context, draw, frame, row, POSES[name](frame), scale)
  }
  // A v2 atlas keeps its neutral, front-facing cell after the idle loop: where the look
  // directions start from (the pet toolkit's validate_atlas.py requires it).
  drawCell(context, draw, NEUTRAL_COLUMN, ROWS.idle.row, rest, scale)
  for (let direction = 0; direction < DIRECTIONS; direction += 1) {
    drawCell(context, draw, direction % CELL.columns, LOOK_ROW + Math.floor(direction / CELL.columns), lookPose(direction), scale)
  }
  const strip = canvasOf(CELL.width * SLEEP.ms.length * scale, CELL.height * scale)
  const stripContext = strip.getContext('2d')
  for (let frame = 0; frame < SLEEP.ms.length; frame += 1) {
    drawCell(stripContext, draw, frame, 0, sleepPose(frame), scale)
    // A small z drifts up beside the sleeper.
    stripContext.save()
    stripContext.fillStyle = 'rgba(90,100,140,.75)'
    stripContext.font = `700 ${Math.round((20 + frame * 2) * scale)}px system-ui, sans-serif`
    stripContext.fillText('z', (frame * CELL.width + 138 + frame * 2) * scale, (60 - frame * 6) * scale)
    stripContext.restore()
  }
  const [sheetBlob, sleepBlob] = await Promise.all([blobOf(sheet), blobOf(strip)])
  return { sheet: sheetBlob, sleep: sleepBlob, version: 2 }
}

// Marks play a half-size atlas (96x104 cells), plenty for a mark of 88px or less; kept per
// look for the page's life.
const baked = new Map()
export const canBake = () => typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL?.createObjectURL === 'function'
export const bakeKey = look => (look.clay === 'omni' ? 'clay:omni' : `${look.shape}|${look.color}`)
/** The pet for a look ({ sheet, sleep, version } with object URLs), baked once. */
export function bakedPet(look) {
  const key = bakeKey(look)
  let pet = baked.get(key)
  if (pet === undefined) {
    pet = bakeBlobs(look, 0.5).then(({ sheet, sleep, version }) => ({ sheet: URL.createObjectURL(sheet), sleep: URL.createObjectURL(sleep), version }))
    pet.catch(() => baked.delete(key))
    baked.set(key, pet)
  }
  return pet
}
