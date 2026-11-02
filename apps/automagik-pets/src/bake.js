// A look baked into a Codex v2 pet folder, <bots home>/pets/<character>-<colour>/:
//
//   pet.json          Codex's fields, the look, and each row's frame count, ms per frame,
//                     cells and frame files, so a reader never guesses or lists the folder
//   spritesheet.webp  the v2 atlas: 11 rows of 192x208 cells, 8 to a row (1536x2288)
//   sleep.webp        the DSH extension's sleep strip (1152x208)
//   frames/<row>-<n>.png  every cell on its own, for players that cannot crop a sprite
//
// The folder is written beside the others under a dot name (which the Bot team's pet list
// skips) and moved into place whole, so a reader sees the old pet or the new one, never half.
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { teamHomeOf } from '../../bots-dsh/src/host/folders.js'
import { CELL, SLEEP, THEME, cellPlan, cellSvg, labelOf, lookParts, parseLookId, rowsManifest } from './art.js'

const PACKAGE = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
export const VERSION = PACKAGE.version
export const TOOL = 'automagik-pets'
const ATLAS_ROWS = 11

const expandHome = text => (text === '~' ? homedir() : /^~[\\/]/.test(text) ? join(homedir(), text.slice(2)) : text)
/** The bots home: `--home` when given, else as the Bot team resolves it (folders.js teamHomeOf). */
export const botsHomeOf = (home, env = process.env) => (typeof home === 'string' && home.trim() ? resolve(expandHome(home.trim())) : teamHomeOf(env))

const fail = message => Object.assign(new Error(message), { code: 'pets/invalid' })

let sharpModule
async function loadSharp() {
  sharpModule ??= (await import('sharp')).default
  return sharpModule
}
const CELL_RAW = { width: CELL.width, height: CELL.height, channels: 4 }
/** An SVG cell as its 192x208 RGBA pixels, at one px per unit. */
export async function renderCell(svg) {
  const sharp = await loadSharp()
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer()
}
const pngOf = async raw => (await loadSharp())(raw, { raw: CELL_RAW }).png().toBuffer()
// The cells copied into place row by row, not composited: a blend would round the edges'
// partly transparent pixels, and each frames/ PNG must be its atlas cell exactly. Lossless and
// exact, so a transparent pixel keeps RGB 0 (the pet toolkit's validate_atlas.py checks it).
async function sheetOf(width, height, cells) {
  const pixels = Buffer.alloc(width * height * 4)
  const stride = CELL.width * 4
  for (const cell of cells) {
    for (let y = 0; y < CELL.height; y += 1) {
      cell.raw.copy(pixels, ((cell.row * CELL.height + y) * width + cell.column * CELL.width) * 4, y * stride, (y + 1) * stride)
    }
  }
  return (await loadSharp())(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true, exact: true }).toBuffer()
}

const exists = path => stat(path).then(() => true, () => false)

/** Moves `staging` to `target`, replacing any folder there; the old one is removed after. */
export async function moveIntoPlace(staging, target, tag) {
  const old = join(dirname(target), `.${basename(target)}.${tag}.old`)
  const had = await exists(target)
  if (had) await rename(target, old)
  try {
    await rename(staging, target)
  } catch (error) {
    if (had) await rename(old, target).catch(() => {})
    throw error
  }
  if (had) await rm(old, { recursive: true, force: true })
}

/**
 * Bakes the look `id` into `<home>/pets/<id>/` and returns { id, dir, files }. `render`
 * turns one cell's SVG into its RGBA pixels (renderCell unless given).
 */
export async function bakePet(id, { home, env = process.env, render = renderCell } = {}) {
  const look = parseLookId(id)
  if (!look) throw fail(`not a look id: ${JSON.stringify(String(id))} (want <character>-<colour>, e.g. kitty-blue)`)
  const petsDir = join(botsHomeOf(home, env), 'pets')
  const target = join(petsDir, id)
  const tag = `${process.pid}.${randomBytes(4).toString('hex')}`
  const staging = join(petsDir, `.${id}.${tag}.tmp`)
  const parts = lookParts(look)
  const plan = cellPlan()
  await mkdir(join(staging, 'frames'), { recursive: true })
  try {
    const cells = await Promise.all(plan.map(async cell => {
      const raw = await render(cellSvg(parts, cell.pose, cell.z))
      return { ...cell, raw, png: await pngOf(raw) }
    }))
    const [sheet, sleep] = await Promise.all([
      sheetOf(CELL.width * CELL.columns, CELL.height * ATLAS_ROWS, cells.filter(cell => cell.sheet === 'atlas')),
      sheetOf(CELL.width * SLEEP.ms.length, CELL.height, cells.filter(cell => cell.sheet === 'sleep')),
    ])
    const label = labelOf(look.character)
    const manifest = {
      id,
      displayName: label,
      description: `Automagik's ${label} in ${look.colour}, baked by ${TOOL}.`,
      spriteVersionNumber: 2,
      spritesheetPath: 'spritesheet.webp',
      look,
      cell: { ...CELL },
      rows: rowsManifest(plan),
      bake: { tool: TOOL, version: VERSION, theme: THEME },
    }
    await Promise.all([
      writeFile(join(staging, 'pet.json'), `${JSON.stringify(manifest, null, 2)}\n`),
      writeFile(join(staging, 'spritesheet.webp'), sheet),
      writeFile(join(staging, 'sleep.webp'), sleep),
      ...cells.map(cell => writeFile(join(staging, 'frames', `${cell.name}.png`), cell.png)),
    ])
    await moveIntoPlace(staging, target, tag)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { id, dir: target, files: 3 + plan.length }
}
