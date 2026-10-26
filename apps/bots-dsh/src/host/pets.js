// Pets: animated Bot avatars in the Codex pet format, the one codex-pets.net shares and Codex
// keeps in ~/.codex/pets: a folder with a pet.json and one spritesheet.webp atlas of 192x208
// cells, eight to a row (v1: 9 rows; v2: 11, the last two the sixteen directions a pet looks
// in). A pet may also carry the DSH extension's sleep strip (sleep.webp). Three places hold
// them: the pets this plugin ships (Genie), the team's own (<home>/pets: installed from
// codex-pets.net, or copied from Codex's folder when picked), and Codex's folder, read only.
// Nothing reaches codex-pets.net until the person opens the Pets tab or picks a pet there.
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MARKET = 'https://codex-pets.net'
const MARKET_ASSETS = `${MARKET}/assets/`
export const CELL = Object.freeze({ width: 192, height: 208, columns: 8 })
// The atlas sizes, by format version.
const ATLAS = Object.freeze({ 1: [1536, 1872], 2: [1536, 2288] })
const SLEEP = [1152, 208]
const MAX_SHEET = 12 * 1024 * 1024
const BUILTIN = fileURLToPath(new URL('./pets/', import.meta.url))
export const SOURCES = Object.freeze(['builtin', 'team', 'codex'])
export const SORTS = Object.freeze(['popular', 'new', 'views', 'random'])
const PAGE_SIZE = 24
const TIMEOUT_MS = 15_000

export const cleanPetId = id => (typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) && !id.includes('..') ? id : undefined)
const fail = (message, code = 'bot/invalid') => Object.assign(new Error(message), { code })

/** A WebP's width and height, from its header (VP8, VP8L or VP8X), or undefined. */
export function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return undefined
  const chunk = bytes.toString('latin1', 12, 16)
  if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)]
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff]
  return undefined
}

/** The Codex format version of a spritesheet's bytes (1 or 2), or undefined for anything else. */
export function sheetVersion(bytes) {
  const size = webpSize(bytes)
  if (!size) return undefined
  const found = Object.entries(ATLAS).find(([, [width, height]]) => size[0] === width && size[1] === height)
  return found ? Number(found[0]) : undefined
}
const isSleepStrip = (bytes) => { const size = webpSize(bytes); return size?.[0] === SLEEP[0] && size?.[1] === SLEEP[1] }

// A pet.json, kept to what the team shows; its sheet must be a file beside it.
function manifestOf(raw, fallbackId) {
  const id = cleanPetId(raw?.id) ?? cleanPetId(fallbackId)
  const sheet = typeof raw?.spritesheetPath === 'string' && /^[\w.-]+\.webp$/i.test(raw.spritesheetPath) ? raw.spritesheetPath : 'spritesheet.webp'
  if (!id) return undefined
  const name = String(raw?.displayName ?? raw?.name ?? id).trim().slice(0, 60) || id
  return { id, name, description: String(raw?.description ?? '').trim().slice(0, 240), sheet, from: typeof raw?.from === 'string' ? raw.from : undefined }
}

export function createPets({ home, codexHome = join(homedir(), '.codex'), builtinDir = BUILTIN, fetch: get = globalThis.fetch, warn = () => {} }) {
  // The team's home may be settled after the channel is made, so it is read on use.
  const teamDirOf = () => join(typeof home === 'function' ? home() : home, 'pets')
  const dirOf = source => (source === 'builtin' ? builtinDir : source === 'team' ? teamDirOf() : join(codexHome, 'pets'))

  async function readPet(source, id) {
    const dir = join(dirOf(source), id)
    let raw
    try { raw = JSON.parse(await readFile(join(dir, 'pet.json'), 'utf8')) } catch { return undefined }
    const manifest = manifestOf(raw, id)
    if (!manifest || manifest.id !== id) return undefined
    let bytes
    try {
      if ((await stat(join(dir, manifest.sheet))).size > MAX_SHEET) return undefined
      bytes = await readFile(join(dir, manifest.sheet))
    } catch { return undefined }
    const version = sheetVersion(bytes)
    if (version === undefined) return undefined
    let sleep = false
    try { sleep = isSleepStrip(await readFile(join(dir, 'sleep.webp'))) } catch { sleep = false }
    return { ...manifest, source, version, sleep, dir }
  }

  async function listIn(source) {
    let names = []
    try { names = (await readdir(dirOf(source), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name) } catch { return [] }
    const pets = await Promise.all(names.filter(name => cleanPetId(name)).map(name => readPet(source, name)))
    return pets.filter(Boolean)
  }

  const view = ({ dir: _dir, sheet: _sheet, ...pet }) => pet

  /** The pets on this computer: the plugin's own, the team's, then Codex's not copied yet. */
  async function list() {
    const [builtin, team, codex] = await Promise.all(SOURCES.map(listIn))
    const kept = new Set(team.map(pet => pet.id))
    return [...builtin, ...team, ...codex.filter(pet => !kept.has(pet.id))].map(view)
  }

  /** A pet's sheet (or `part: 'sleep'`, its sleep strip) for the route, or undefined. */
  async function file(source, id, part = 'sheet') {
    if (!SOURCES.includes(source) || !cleanPetId(id)) return undefined
    const pet = await readPet(source, id)
    if (!pet || (part === 'sleep' && !pet.sleep)) return undefined
    return readFile(join(pet.dir, part === 'sleep' ? 'sleep.webp' : pet.sheet))
  }

  const timed = () => AbortSignal.timeout(TIMEOUT_MS)
  async function marketJson(path) {
    const response = await get(`${MARKET}${path}`, { headers: { accept: 'application/json' }, signal: timed() })
    if (!response.ok) throw fail(`codex-pets.net answered ${response.status}`, 'bot/unavailable')
    return response.json()
  }
  const assetUrl = url => (typeof url === 'string' && url.startsWith(MARKET_ASSETS) ? url : undefined)
  const marketView = pet => ({
    id: pet.id,
    name: String(pet.displayName ?? pet.id).slice(0, 60),
    description: String(pet.description ?? '').slice(0, 240),
    kind: typeof pet.kind === 'string' ? pet.kind : undefined,
    by: typeof pet.ownerName === 'string' ? pet.ownerName.slice(0, 60) : undefined,
    version: pet.spriteVersionNumber === 2 ? 2 : 1,
    poster: assetUrl(pet.posterUrl),
    // Its sheet, for the character select's preview before it is picked.
    sheet: assetUrl(pet.spritesheetUrl),
    likes: Number(pet.likeCount) || 0,
  })

  /** One page of codex-pets.net, safe content only. */
  async function browse({ query = '', page = 1, sort = 'popular' } = {}) {
    const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(Number(page)) || 1)), pageSize: String(PAGE_SIZE) })
    const q = String(query ?? '').trim().slice(0, 80)
    if (q) params.set('q', q)
    if (SORTS.includes(sort) && sort !== 'new') params.set('sort', sort)
    const answer = await marketJson(`/api/pets?${params}`)
    const pets = (Array.isArray(answer?.pets) ? answer.pets : []).filter(pet => cleanPetId(pet?.id) && pet.ownerShadowbanned !== true)
    return { pets: pets.map(marketView), page: Number(answer?.page) || 1, pages: Number(answer?.totalPages) || 1, total: Number(answer?.total) || 0 }
  }

  // A pet is written beside the others under a temporary name and moved in whole.
  async function keep(id, manifest, sheet, sleep) {
    const teamDir = teamDirOf()
    await mkdir(teamDir, { recursive: true })
    const next = join(teamDir, `.${id}.${process.pid}.tmp`)
    await rm(next, { recursive: true, force: true })
    await mkdir(next)
    await writeFile(join(next, 'pet.json'), `${JSON.stringify({ id, displayName: manifest.name, description: manifest.description, spriteVersionNumber: sheetVersion(sheet), spritesheetPath: 'spritesheet.webp', ...(manifest.from ? { from: manifest.from } : {}) }, null, 2)}\n`)
    await writeFile(join(next, 'spritesheet.webp'), sheet)
    if (sleep) await writeFile(join(next, 'sleep.webp'), sleep)
    await rm(join(teamDir, id), { recursive: true, force: true })
    await rename(next, join(teamDir, id))
    const pet = await readPet('team', id)
    if (!pet) throw fail('That pet could not be kept')
    return view(pet)
  }

  async function download(url) {
    const response = await get(url, { signal: timed() })
    if (!response.ok) throw fail(`codex-pets.net answered ${response.status}`, 'bot/unavailable')
    if (Number(response.headers.get('content-length')) > MAX_SHEET) throw fail('That pet\'s spritesheet is too large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_SHEET) throw fail('That pet\'s spritesheet is too large')
    return bytes
  }

  /**
   * Makes a pet the team's, so a Bot wearing it never depends on the network or Codex's
   * folder: from codex-pets.net (`market`), or copied from Codex's own (`codex`). The plugin's
   * own pets are used where they are.
   */
  async function adopt(source, id) {
    const clean = cleanPetId(id)
    if (!clean) throw fail('Unknown pet')
    if (source === 'builtin' || source === 'team') {
      const pet = await readPet(source, clean)
      if (!pet) throw fail('That pet is gone', 'bot/not-found')
      return view(pet)
    }
    if (source === 'codex') {
      const pet = await readPet('codex', clean)
      if (!pet) throw fail('That pet is gone from Codex\'s folder', 'bot/not-found')
      let sleep
      try { sleep = pet.sleep ? await readFile(join(pet.dir, 'sleep.webp')) : undefined } catch { sleep = undefined }
      return keep(clean, { ...pet, from: 'codex' }, await readFile(join(pet.dir, pet.sheet)), sleep)
    }
    if (source !== 'market') throw fail('Unknown pet source')
    const answer = await marketJson(`/api/pets/${encodeURIComponent(clean)}`)
    const listed = answer?.pet
    const url = assetUrl(listed?.spritesheetUrl)
    if (!listed || listed.id !== clean || !url) throw fail('codex-pets.net does not list that pet', 'bot/not-found')
    const sheet = await download(url)
    if (sheetVersion(sheet) === undefined) throw fail('That pet\'s spritesheet is not in the Codex format (1536x1872 or 1536x2288 WebP)')
    const manifest = manifestOf(listed, clean)
    warn('ds-bot: pet %s installed from codex-pets.net', clean)
    return keep(clean, { ...manifest, from: `${MARKET}/#/pets/${clean}` }, sheet)
  }

  /**
   * Writes a pet the team made (a character baked into an atlas) to Codex's own folder, so
   * Codex's pet picker lists it: its sheet with a pet.json, or (`part: 'sleep'`) the sleep
   * strip beside a sheet written before.
   */
  async function toCodex(id, { name, description = '', bytes, part = 'sheet' }) {
    const clean = cleanPetId(id)
    if (!clean) throw fail('Unknown pet')
    const dir = join(codexHome, 'pets', clean)
    if (part === 'sleep') {
      if (!isSleepStrip(bytes)) throw fail('The sleep strip is not 1152x208 WebP')
      await stat(join(dir, 'pet.json')).catch(() => { throw fail('Write the pet before its sleep strip') })
      await writeFile(join(dir, 'sleep.webp'), bytes)
      return { id: clean, dir }
    }
    const version = sheetVersion(bytes)
    if (version === undefined) throw fail('The spritesheet is not in the Codex format')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'spritesheet.webp'), bytes)
    await writeFile(join(dir, 'pet.json'), `${JSON.stringify({ id: clean, displayName: String(name ?? clean).slice(0, 60), description: String(description).slice(0, 240), spriteVersionNumber: version, spritesheetPath: 'spritesheet.webp' }, null, 2)}\n`)
    return { id: clean, dir }
  }

  return { list, file, browse, adopt, toCodex }
}
