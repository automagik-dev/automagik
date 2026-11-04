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
// Bakes of the same look may run at once (DSH and Herdr both call this): whichever folder lands
// last stays, and every bake that finds a complete pet in place has succeeded.
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { expandPath, teamHomeOf } from '../../bots-dsh/src/host/folders.js'
import { sheetVersion, webpSize } from '../../bots-dsh/src/host/pets.js'
import { CELL, SLEEP, THEME, cellPlan, cellSvg, labelOf, lookParts, parseLookId, rowsManifest } from './art.js'

const PACKAGE = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
export const VERSION = PACKAGE.version
export const TOOL = 'automagik-pets'
const ATLAS_ROWS = 11

/** The bots home: `--home` when given, else as the Bot team resolves it (folders.js teamHomeOf). */
export const botsHomeOf = (home, env = process.env) => (typeof home === 'string' && home.trim() ? expandPath(home.trim()) : teamHomeOf(env))

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
const isFile = path => stat(path).then(info => info.isFile(), () => false)

/** Whether `dir` holds a whole baked pet `id`: its pet.json, both sheets and every frame it lists. */
export async function isCompletePet(dir, id) {
  let manifest
  try { manifest = JSON.parse(await readFile(join(dir, 'pet.json'), 'utf8')) } catch { return false }
  if (manifest?.id !== id || manifest.spriteVersionNumber !== 2 || typeof manifest.rows !== 'object' || manifest.rows === null) return false
  try {
    if (sheetVersion(await readFile(join(dir, 'spritesheet.webp'))) !== 2) return false
    const sleep = webpSize(await readFile(join(dir, 'sleep.webp')))
    if (sleep?.[0] !== CELL.width * SLEEP.ms.length || sleep?.[1] !== CELL.height) return false
  } catch { return false }
  const files = Object.values(manifest.rows).flatMap(row => (Array.isArray(row?.files) ? row.files : []))
  return files.length > 0 && (await Promise.all(files.map(file => isFile(join(dir, file))))).every(Boolean)
}

// What another bake of the same look doing the same moves at the same time makes rename meet.
const RACED = new Set(['ENOENT', 'ENOTEMPTY', 'EEXIST'])
const MOVE_ATTEMPTS = 10
// A short, random pause between attempts, so bakes that raced do not race again in step.
const pause = () => new Promise(done => setTimeout(done, 5 + Math.random() * 20))

/**
 * Moves `staging` to `target`, replacing any folder there; the old one is removed after. When
 * a concurrent bake of the same pet moves first, a complete pet already in place counts as done
 * (`staging` is then removed); otherwise the move is tried again. `rename` is fs's unless given.
 */
export async function moveIntoPlace(staging, target, tag, { id = basename(target), rename = fsRename } = {}) {
  const old = join(dirname(target), `.${basename(target)}.${tag}.old`)
  const done = async () => {
    await Promise.all([rm(staging, { recursive: true, force: true }), rm(old, { recursive: true, force: true })])
  }
  let last
  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt += 1) {
    let had = false
    try {
      if (await exists(target)) {
        await rename(target, old)
        had = true
      }
      await rename(staging, target)
      if (had) await rm(old, { recursive: true, force: true })
      return { raced: false }
    } catch (error) {
      last = error
      if (had) await restore(old, target, error, rename)
      if (!RACED.has(error.code) || !(await exists(staging))) throw error
      if (await isCompletePet(target, id)) {
        await done()
        return { raced: true }
      }
      await pause()
    }
  }
  throw last
}
// Puts the folder moved aside back when the new one could not take its place. When it cannot go
// back because another bake of the same pet is moving folders there too, it is no longer needed:
// this bake still holds its own complete folder and tries again with it. Any other failure is
// reported, naming the folder left behind (the next bake's sweep removes it too).
async function restore(old, target, cause, rename) {
  try {
    await rename(old, target)
  } catch (error) {
    if (RACED.has(error.code)) {
      await rm(old, { recursive: true, force: true })
      return
    }
    throw Object.assign(new Error(`${cause.message}; and the pet moved aside could not be put back (${error.message}), it is left at ${old}`), { code: error.code, cause })
  }
}

// A bake's own temporary folders: .<id>.<pid>.<8 hex>.tmp while it writes, .old while it swaps.
const STALE_MS = 10 * 60_000
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
/**
 * Removes the temporary folders earlier bakes of `id` left in `petsDir` (killed mid-bake): those
 * of a process that is gone, and any older than ten minutes. A live bake's folders stay.
 */
export async function sweepStale(petsDir, id, now = Date.now()) {
  const shape = new RegExp(`^\\.${id}\\.(\\d+)\\.[0-9a-f]{8}\\.(tmp|old)$`)
  let entries = []
  try { entries = await readdir(petsDir, { withFileTypes: true }) } catch { return [] }
  const swept = []
  for (const entry of entries) {
    const match = shape.exec(entry.name)
    if (!match || !entry.isDirectory()) continue
    const path = join(petsDir, entry.name)
    let age = 0
    try { age = now - (await stat(path)).mtimeMs } catch { continue }
    if (alive(Number(match[1])) && age < STALE_MS) continue
    await rm(path, { recursive: true, force: true })
    swept.push(entry.name)
  }
  return swept
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
  await sweepStale(petsDir, id)
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
      displayName: `${label} (${look.colour})`,
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
    await moveIntoPlace(staging, target, tag, { id })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { id, dir: target, files: 3 + plan.length }
}
