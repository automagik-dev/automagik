// The team's characters as cell pictures, without a browser: the same art (characters.js
// bakeMarkup), inks (inks.js) and poses (pet-poses.js) the Bot team's browser bake draws on a
// canvas (pet-bake.js), composed here as one SVG per cell. Omni in clay (clay-art.js
// OMNI_ATLAS) is not baked here.
import { CHARACTERS, SHAPES, bakeMarkup } from '../../bots-dsh/src/client/characters.js'
import { INKS } from '../../bots-dsh/src/client/inks.js'
import { BODY, CELL, DIRECTIONS, FLOOR, LOOK_ROW, NEUTRAL_COLUMN, POSES, ROWS, SLEEP, lookPose, rest, sleepPose, sleepZ } from '../../bots-dsh/src/client/pet-poses.js'

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTERS))
// Every ink, in inks.js order; the legacy names it still reads are not looks of their own.
export const COLOUR_IDS = Object.freeze(Object.keys(INKS))
// The theme a headless bake resolves inks in: the light one, DSH's body default (styles.js).
export const THEME = 'light'

/** A look id, `<character>-<colour>`, as { character, colour }; undefined when it names no look. */
export function parseLookId(id) {
  const match = typeof id === 'string' ? /^([a-z0-9]+)-([a-z0-9]+)$/.exec(id) : null
  if (!match || !Object.hasOwn(CHARACTERS, match[1]) || !Object.hasOwn(INKS, match[2])) return undefined
  return { character: match[1], colour: match[2] }
}
export const lookIdOf = ({ character, colour }) => `${character}-${colour}`
export const allLookIds = () => CHARACTER_IDS.flatMap(character => COLOUR_IDS.map(colour => lookIdOf({ character, colour })))

// Colors as the browser resolves them. The page gives each ink as a variable (--bt-ink-<name>,
// styles.js: the light value on body); color-mix(in srgb, a p%, b) mixes the encoded channels
// linearly, as CSS Color 5 defines it for opaque colors.
const channels = (hex) => {
  const full = hex.length === 4 ? `#${Array.from(hex.slice(1), digit => digit + digit).join('')}` : hex
  return [1, 3, 5].map(index => parseInt(full.slice(index, index + 2), 16))
}
const toHex = values => `#${values.map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const HEX = '#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})'
const MIX = new RegExp(`color-mix\\(in srgb,\\s*(${HEX})\\s+([\\d.]+)%,\\s*(${HEX})\\)`, 'g')
export const mixSrgb = (a, percent, b) => {
  const p = percent / 100
  const [left, right] = [channels(a), channels(b)]
  return toHex(left.map((value, index) => value * p + right[index] * (1 - p)))
}
/** SVG markup with every ink variable and color-mix put in as the hex color it resolves to. */
export function resolveInks(svg, theme = THEME) {
  const at = theme === 'dark' ? 1 : 0
  return svg
    .replace(/var\(--bt-ink-([a-z]+)\)/g, (_, name) => (INKS[name] ? INKS[name][at] : '#888888'))
    .replace(MIX, (_, a, percent, b) => mixSrgb(a, Number(percent), b))
}

// One layer of bakeMarkup (a whole <svg> in the character's box) placed in a 150px square,
// as the browser bake's drawImage places it.
const place = (svg, x, y) => svg.replace(/^<svg [^>]*>/, match => {
  const box = /viewBox="([^"]+)"/.exec(match)[1]
  return `<svg x="${x}" y="${y}" width="${BODY}" height="${BODY}" viewBox="${box}" overflow="hidden">`
})
const num = value => Number(value.toFixed(4))

/** The parts of a look, inks resolved: { box, body, faces } as bakeMarkup gives them. */
export function lookParts({ character, colour }, theme = THEME) {
  const parts = bakeMarkup(character, colour)
  return {
    box: parts.box,
    body: resolveInks(parts.body, theme),
    faces: Object.fromEntries(Object.entries(parts.faces).map(([name, svg]) => [name, resolveInks(svg, theme)])),
  }
}

/**
 * One 192x208 cell as SVG: the body and the pose's face, moved as pet-bake.js drawCell moves
 * them (translate to the feet, rotate, scale), and the sleep strip's z when `z` is given.
 */
export function cellSvg(parts, p, z) {
  const unit = BODY / parts.box
  const transform = `translate(${num(CELL.width / 2 + p.dx)} ${num(FLOOR + p.dy)}) rotate(${num(p.rot)}) scale(${num(p.sx)} ${num(p.sy)})`
  const face = parts.faces[p.face] ?? parts.faces.open
  const text = z ? `<text x="${z.x}" y="${z.y}" font-family="system-ui, sans-serif" font-weight="700" font-size="${z.size}" fill="${z.fill}">z</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL.width}" height="${CELL.height}" viewBox="0 0 ${CELL.width} ${CELL.height}">`
    + `<g transform="${transform}">${place(parts.body, -BODY / 2, -BODY)}${place(face, num(-BODY / 2 + p.gx * 4.5 * unit), num(-BODY + p.gy * 3.5 * unit))}</g>${text}</svg>`
}

/**
 * Every cell a v2 pet shows, in the order pet-bake.js draws them: each row's frames, the
 * neutral cell after the idle loop, the sixteen look directions, then the sleep strip.
 * `name` is the frames/ file name; `sheet` is 'atlas' or 'sleep'; row and column place it.
 */
export function cellPlan() {
  const cells = []
  for (const [name, { row, ms }] of Object.entries(ROWS)) {
    for (let frame = 0; frame < ms.length; frame += 1) cells.push({ group: name, name: `${name}-${frame}`, sheet: 'atlas', row, column: frame, pose: POSES[name](frame) })
  }
  cells.push({ group: 'neutral', name: 'neutral-0', sheet: 'atlas', row: ROWS.idle.row, column: NEUTRAL_COLUMN, pose: rest })
  for (let direction = 0; direction < DIRECTIONS; direction += 1) {
    cells.push({ group: 'look', name: `look-${direction}`, sheet: 'atlas', row: LOOK_ROW + Math.floor(direction / CELL.columns), column: direction % CELL.columns, pose: lookPose(direction) })
  }
  for (let frame = 0; frame < SLEEP.ms.length; frame += 1) cells.push({ group: 'sleep', name: `sleep-${frame}`, sheet: 'sleep', row: 0, column: frame, pose: sleepPose(frame), z: sleepZ(frame) })
  return cells
}

/** pet.json's rows: each group's frame count, ms per frame (null for still cells), cells and files. */
export function rowsManifest(cells = cellPlan()) {
  const ms = group => (group === 'sleep' ? [...SLEEP.ms] : ROWS[group] ? [...ROWS[group].ms] : null)
  const rows = {}
  for (const cell of cells) {
    const entry = rows[cell.group] ??= { image: cell.sheet === 'sleep' ? 'sleep.webp' : 'spritesheet.webp', frames: 0, ms: ms(cell.group), cells: [], files: [] }
    entry.frames += 1
    entry.cells.push([cell.row, cell.column])
    entry.files.push(`frames/${cell.name}.png`)
  }
  return rows
}

export const labelOf = character => SHAPES[character]?.label ?? character
export { CELL, SLEEP }
