import { bakeMarkup } from './characters.js'
import { inkFill } from './inks.js'
import { OMNI_ATLAS, faceAt } from './clay-art.js'
import { BODY, CELL, DIRECTIONS, FLOOR, LOOK_ROW, NEUTRAL_COLUMN, POSES, ROWS, SLEEP, lookPose, rest, sleepPose, sleepZ } from './pet-poses.js'

// -------------------------------------------------------------------------
// The team's characters as Codex pets: each character (in the Bot's own color) and Omni in
// clay are baked into a v2 atlas, the format every live mark plays (pet.js), from the same
// art the marks draw. A pose per cell moves the body whole (a breath, a hop, a slump) and
// sets the eyes (open, closed, happy, focused, sad, looking a way), so every row means what
// the contract says (the pet toolkit's animation-rows.md). Baked once per look and kept for
// the page; at full size the same atlas goes to Codex's own pets folder.

// Omni in clay has faces, not eyes: each face the pose's eyes stand for.
const OMNI_FACE = { open: 'calm', closed: 'calm', happy: 'delighted', focused: 'focused', sad: 'sad', asleep: 'asleep' }

const loadImage = src => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('A pet layer did not load'))
  image.src = src
})
const svgSrc = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

// A picture drawn as an image sees none of the page's CSS variables, and the inks are
// variables (inks.js inkFill): they are put in as the colors they are now, in this theme.
const resolveVars = text => (typeof document === 'undefined' ? text
  : text.replace(/var\((--[\w-]+)\)/g, (_, name) => getComputedStyle(document.body).getPropertyValue(name).trim() || '#888888'))

async function charactersLayers(shape, color) {
  const parts = bakeMarkup(shape, color)
  const [body, ...faces] = await Promise.all([parts.body, ...Object.values(parts.faces)].map(svg => loadImage(svgSrc(resolveVars(svg)))))
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
    const z = sleepZ(frame)
    stripContext.fillStyle = z.fill
    stripContext.font = `700 ${Math.round(z.size * scale)}px system-ui, sans-serif`
    stripContext.fillText('z', (frame * CELL.width + z.x) * scale, z.y * scale)
    stripContext.restore()
  }
  const [sheetBlob, sleepBlob] = await Promise.all([blobOf(sheet), blobOf(strip)])
  return { sheet: sheetBlob, sleep: sleepBlob, version: 2 }
}

// Marks play a half-size atlas (96x104 cells), plenty for a mark of 88px or less; kept per
// look for the page's life.
const baked = new Map()
export const canBake = () => typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL?.createObjectURL === 'function'
// The ink as it resolves now is in the key, so a theme that changes it bakes anew.
export const bakeKey = look => (look.clay === 'omni' ? 'clay:omni' : `${look.shape}|${look.color}|${resolveVars(inkFill(look.color))}`)
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
