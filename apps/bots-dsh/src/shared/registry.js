// The shared Bot registry (RFC 0014): bots.json version 2, in the registry home
// (`~/.automagik/bots/bots.json`, the home file) and in a project
// (`<repo>/.automagik/bots/bots.json`, a repo file). Parse, check, and write-if-unchanged
// under the lock the automagik-herdr CLI already takes, so DSH and the CLI can edit one file.
//
// Self-contained on purpose: no imports. The same bytes are copied into
// herdr/mods/am-sidebar/ (RFC 0014 delivery 2, Q15), where Herdr's mod imports the parse and
// check half and has no node:fs. The write half loads node:fs only when it is called, from
// Node (the DSH host, the CLI), or takes an `fs` with the same sync calls (tests).
//
// Readers keep unknown fields: `raw` is the file exactly as parsed, and a write saves that,
// edited, so DSH never drops Herdr's fields and Herdr never drops DSH's.

export const REGISTRY_VERSION = 2
/** The home file's place under `$AUTOMAGIK_HOME`, and a repo file's place under the repo. */
export const HOME_PATH = 'bots/bots.json'
export const REPO_PATH = '.automagik/bots/bots.json'
export const KINDS = Object.freeze(['home', 'repo'])

/** Both id shapes, accepted forever (Q3): Herdr's `b-` mint and DSH's `session-<uuid>`. */
export const BOT_ID = /^(b-[a-z2-7]{10}|session-[0-9a-f-]{36})$/
export const isBotId = id => typeof id === 'string' && BOT_ID.test(id)

// RFC 4648 base32, lowercase.
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** `b-` plus 10 random lowercase base32 characters. `random` returns [0, 1). */
export function newBotId(random = Math.random) {
  let id = 'b-'
  for (let i = 0; i < 10; i += 1) id += BASE32[Math.floor(random() * 32) % 32]
  return id
}

/** Where a Bot's pet comes from: a pet DSH ships, or one in the team's pets folder. */
export const PET_SOURCES = Object.freeze(['builtin', 'team'])
/** A pet id is one path segment (DSH's cleanPetId) before any path is made from it. */
export const cleanPetId = id => (typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) && !id.includes('..') ? id : undefined)
/** An `hc machine` name, as Herdr checks one. */
export const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Per-Bot fields only the home file may set; a repo file's are ignored (Threat model). */
export const HOME_BOT_FIELDS = Object.freeze(['folder', 'machine', 'dsh'])
/** Top-level fields only the home file may set; never read from a repo file. */
export const HOME_FIELDS = Object.freeze(['projects', 'shown'])

const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const isText = x => typeof x === 'string' && x.trim() !== ''
const fail = (message, code) => Object.assign(new Error(message), { code })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const checkKind = kind => {
  if (!KINDS.includes(kind)) throw new Error(`registry: kind is "home" or "repo", not ${JSON.stringify(kind)}`)
}

/** Why a `pet` can't be used, or null. */
function petProblem(pet) {
  if (!isObject(pet)) return 'pet is not an object'
  if (!PET_SOURCES.includes(pet.source)) return `pet source ${JSON.stringify(pet.source)} is not builtin or team`
  if (cleanPetId(pet.id) === undefined) return `pet id ${JSON.stringify(pet.id)} is not one path segment`
  return null
}

/** Why a home-file `projects[]` entry can't be used, or null. */
function projectProblem(entry) {
  if (!isObject(entry) || !isText(entry.folder)) return 'a project with no folder'
  if (entry.machine !== undefined && !MACHINE_NAME.test(String(entry.machine))) return `project ${entry.folder}: machine is not a machine name`
  return null
}

/** Why a home-file `shown[]` entry can't be used, or null. */
function shownProblem(entry) {
  if (!isObject(entry)) return 'a shown entry is not an object'
  if (entry.project !== null && !isText(entry.project)) return 'a shown entry has no project (null for global Bots)'
  if (entry.machine !== undefined && !MACHINE_NAME.test(String(entry.machine))) return `shown ${entry.project}: machine is not a machine name`
  if (!Array.isArray(entry.bots)) return `shown ${entry.project}: no bots list`
  return null
}

/**
 * Reads a version 2 file. Throws when it is not JSON, not version 2 or has no bots list;
 * otherwise anything it can't use is left out of `file` with a warning, as Herdr's
 * parseBots does. `kind` is "home" or "repo": a repo file's folder, machine and dsh (per
 * Bot) and its projects and shown (top level) are ignored, since a clone brings it.
 * `raw` is a separate copy of the file exactly as read: edit that one to write it back, so
 * entries and fields left out of `file` survive. `indent` is the file's indentation.
 */
export function parseRegistry(text, { kind } = {}) {
  checkKind(kind)
  const raw = JSON.parse(text)
  if (!isObject(raw)) throw new Error('bots.json: not an object')
  if (raw.version !== REGISTRY_VERSION) throw new Error(`bots.json: version ${JSON.stringify(raw.version)}, expected ${REGISTRY_VERSION}`)
  if (!Array.isArray(raw.bots)) throw new Error('bots.json: no bots list')
  const file = JSON.parse(text)
  const warnings = []
  if (kind === 'repo') {
    for (const key of HOME_FIELDS) {
      if (file[key] === undefined) continue
      warnings.push(`${key} is read from the home file only; ignored`)
      delete file[key]
    }
    if (file.name !== undefined && typeof file.name !== 'string') { warnings.push('name is not text; ignored'); delete file.name }
    if (file.categories !== undefined && !Array.isArray(file.categories)) { warnings.push('categories is not a list; ignored'); delete file.categories }
  } else {
    file.projects = (Array.isArray(file.projects) ? file.projects : []).filter(entry => {
      const why = projectProblem(entry)
      if (why) warnings.push(`${why}; left out`)
      return !why
    })
    file.shown = (Array.isArray(file.shown) ? file.shown : []).filter(entry => {
      const why = shownProblem(entry)
      if (why) warnings.push(`${why}; left out`)
      return !why
    }).map(entry => {
      const bots = entry.bots.filter(isBotId)
      if (bots.length < entry.bots.length) warnings.push(`shown ${entry.project}: an id that is not a Bot id is left out`)
      return { ...entry, bots }
    })
  }
  const bots = []
  file.bots.forEach((b, i) => {
    const where = isObject(b) && isText(b.id) ? b.id : `entry ${i + 1}`
    if (!isObject(b) || !isBotId(b.id)) return warnings.push(`${where}: id is not b- plus 10 base32 characters or session-<uuid>, left out`)
    if (bots.some(k => k.id === b.id)) return warnings.push(`${where}: id used twice, left out`)
    if (!isText(b.name)) return warnings.push(`${where}: no name, left out`)
    const bot = { ...b }
    for (const key of ['role', 'instructions']) {
      if (typeof bot[key] === 'string') continue
      if (bot[key] !== undefined) warnings.push(`${where}: ${key} is not text`)
      bot[key] = ''
    }
    if (bot.main !== undefined && typeof bot.main !== 'boolean') { warnings.push(`${where}: main is not true or false; ignored`); delete bot.main }
    if (bot.identity !== undefined && !isText(bot.identity)) { warnings.push(`${where}: identity is not text; ignored`); delete bot.identity }
    if (bot.pet !== undefined) {
      const why = petProblem(bot.pet)
      if (why) { warnings.push(`${where}: ${why}; ignored`); delete bot.pet }
    }
    if (kind === 'repo') {
      for (const key of HOME_BOT_FIELDS) {
        if (bot[key] === undefined) continue
        warnings.push(`${where}: ${key} is read from the home file only; ignored`)
        delete bot[key]
      }
    } else {
      if (bot.folder !== undefined && !isText(bot.folder)) { warnings.push(`${where}: folder is not text; ignored`); delete bot.folder }
      if (bot.machine !== undefined && (bot.folder === undefined || !MACHINE_NAME.test(String(bot.machine)))) {
        warnings.push(`${where}: machine needs a folder and a machine name; ignored`)
        delete bot.machine
      }
      if (bot.dsh !== undefined && !isObject(bot.dsh)) { warnings.push(`${where}: dsh is not an object; ignored`); delete bot.dsh }
    }
    bots.push(bot)
  })
  if (kind === 'repo' && bots.length) {
    const mains = bots.filter(b => b.main === true)
    if (mains.length === 0) warnings.push('no main bot')
    if (mains.length > 1) {
      warnings.push(`${mains.length} main bots; ${mains[0].id} counts`)
      for (const b of mains.slice(1)) b.main = false
    }
  }
  file.bots = bots
  return { file, warnings, raw, indent: indentOf(text) }
}

/**
 * Every reason `file` must not be written as it is (empty: fine). Stricter than
 * parseRegistry. `before` is the file the edit started from (its text or object; null:
 * none): in a repo file, a home-only field is refused only when it is new or changed, so a
 * hand-written file is never locked; readers still ignore it.
 */
export function checkRegistry(file, { kind, before = null } = {}) {
  checkKind(kind)
  let had = before
  if (typeof had === 'string') { try { had = JSON.parse(had) } catch { had = null } }
  if (!isObject(had)) had = null
  if (!isObject(file) || file.version !== REGISTRY_VERSION || !Array.isArray(file.bots)) return ['not a version 2 bots file']
  const errors = []
  const hadBot = id => (Array.isArray(had?.bots) ? had.bots.find(b => isObject(b) && b.id === id) : undefined)
  if (kind === 'repo') {
    for (const key of HOME_FIELDS) {
      if (file[key] !== undefined && !same(file[key], had?.[key])) errors.push(`${key}: only the home file holds it`)
    }
    if (file.name !== undefined && typeof file.name !== 'string') errors.push('name is not text')
    if (file.categories !== undefined && !Array.isArray(file.categories)) errors.push('categories is not a list')
  } else {
    if (file.projects !== undefined) {
      if (!Array.isArray(file.projects)) errors.push('projects is not a list')
      else for (const entry of file.projects) { const why = projectProblem(entry); if (why) errors.push(why) }
    }
    if (file.shown !== undefined) {
      if (!Array.isArray(file.shown)) errors.push('shown is not a list')
      else {
        for (const entry of file.shown) {
          const why = shownProblem(entry)
          if (why) errors.push(why)
          else if (!entry.bots.every(isBotId)) errors.push(`shown ${entry.project}: an id that is not a Bot id`)
        }
      }
    }
  }
  const ids = new Set()
  for (const b of file.bots) {
    if (!isObject(b) || !isBotId(b.id)) { errors.push(`${b?.id ?? 'a bot'}: id is not b- plus 10 base32 characters or session-<uuid>`); continue }
    const at = b.id
    if (ids.has(at)) errors.push(`${at}: id used twice`)
    ids.add(at)
    if (!isText(b.name)) errors.push(`${at}: no name`)
    for (const key of ['role', 'instructions']) if (b[key] !== undefined && typeof b[key] !== 'string') errors.push(`${at}: ${key} is not text`)
    if (b.main !== undefined && typeof b.main !== 'boolean') errors.push(`${at}: main is not true or false`)
    if (b.identity !== undefined && !isText(b.identity)) errors.push(`${at}: identity is not text`)
    if (b.pet !== undefined) { const why = petProblem(b.pet); if (why) errors.push(`${at}: ${why}`) }
    if (kind === 'repo') {
      const was = hadBot(at)
      for (const key of HOME_BOT_FIELDS) {
        if (b[key] !== undefined && !same(b[key], was?.[key])) errors.push(`${at}: ${key}: only the home file holds it`)
      }
    } else {
      if (b.folder !== undefined && !isText(b.folder)) errors.push(`${at}: folder is not text`)
      if (b.machine !== undefined && (b.folder === undefined || !MACHINE_NAME.test(String(b.machine)))) errors.push(`${at}: machine needs a folder and a machine name`)
      if (b.dsh !== undefined && !isObject(b.dsh)) errors.push(`${at}: dsh is not an object`)
    }
  }
  if (kind === 'repo' && file.bots.length) {
    const mains = file.bots.filter(b => b?.main === true).length
    if (mains !== 1) errors.push(`${mains} main bots; a project has exactly one`)
  }
  return errors
}

/** A new, empty file of `kind`. */
export const emptyRegistry = kind => {
  checkKind(kind)
  return kind === 'home' ? { version: REGISTRY_VERSION, bots: [], projects: [], shown: [] } : { version: REGISTRY_VERSION, bots: [] }
}

/** The indentation `text` was written with: its first indented line's, none for one line. */
export function indentOf(text) {
  const found = /\n([ \t]+)\S/.exec(String(text ?? ''))
  if (found) return found[1]
  return String(text ?? '').trim().includes('\n') ? '  ' : ''
}

/** The file's text: `indent` as found (two spaces for a new file, #230) and a final newline. */
export const serializeRegistry = (raw, indent = '  ') => `${JSON.stringify(raw, null, indent)}\n`

/**
 * Sets the Bot `patch.id` in `raw` (added at the end when new): only the fields `patch`
 * names change, a field set to undefined is removed, and the Bot's other fields and every
 * other Bot are kept as they were. Returns `raw`.
 */
export function putBot(raw, patch) {
  if (!isBotId(patch?.id)) throw new Error(`putBot: ${JSON.stringify(patch?.id)} is not a Bot id`)
  const at = raw.bots.findIndex(b => isObject(b) && b.id === patch.id)
  const bot = at === -1 ? {} : { ...raw.bots[at] }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete bot[key]
    else bot[key] = value
  }
  if (at === -1) raw.bots.push(bot)
  else raw.bots[at] = bot
  return raw
}

/** Takes the Bot `id` out of `raw`. Returns `raw`. */
export function dropBot(raw, id) {
  raw.bots = raw.bots.filter(b => !(isObject(b) && b.id === id))
  return raw
}

// ---- the lock (automagik-herdr's helper, the same protocol on disk) ----
//
// `<file>.lock` beside the file: made exclusively (wx), holding its holder's pid and a token,
// so one writer at a time, DSH or the CLI, does the compare and the rename; a holder removes
// only its own lock. Waited for up to LOCK_WAIT ms; one older than LOCK_STALE ms (a writer
// killed mid-write) is taken over. The CLI waits with Atomics.wait; this one sleeps, so a
// host's event loop keeps running.

export const LOCK_WAIT = 3000
export const LOCK_STALE = 10_000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const loadFs = async fs => fs ?? await import('node:fs')
const pidOf = () => globalThis.process?.pid ?? 0
const parentOf = path => {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? path.slice(0, at + 1) || '.' : path.slice(0, at)
}

const isStale = (fs, path, staleMs) => {
  try { return Date.now() - fs.statSync(path).mtimeMs > staleMs } catch { return false }
}

// A stale lock is moved aside first, so of two waiters only one takes it. Aside, it is checked
// again: a lock made fresh in between goes back (by link, which never replaces a newer one).
function takeOverStale(fs, lock, staleMs) {
  if (!isStale(fs, lock, staleMs)) return
  const aside = `${lock}.${pidOf()}`
  try { fs.renameSync(lock, aside) } catch { return } // another waiter moved it first
  if (!isStale(fs, aside, staleMs)) { try { fs.linkSync(aside, lock) } catch { /* a newer lock is there */ } }
  try { fs.unlinkSync(aside) } catch { /* gone already */ }
}

/** Takes `lock`; resolves with the token to drop it with. Refused after `wait` ms. */
export async function takeLock(lock, { fs, wait = LOCK_WAIT, stale = LOCK_STALE } = {}) {
  const io = await loadFs(fs)
  const token = `${pidOf()} ${globalThis.crypto.randomUUID()}`
  const until = Date.now() + wait
  for (;;) {
    try { io.writeFileSync(lock, token, { flag: 'wx' }); return token } catch (e) {
      if (e?.code !== 'EEXIST') throw e
      takeOverStale(io, lock, stale)
      if (Date.now() > until) throw fail(`${lock} is held by another writer`, 'registry/locked')
      await sleep(5 + Math.floor(Math.random() * 20))
    }
  }
}

/** Removes `lock` if it still holds `token`. */
export async function dropLock(lock, token, { fs } = {}) {
  const io = await loadFs(fs)
  try { if (io.readFileSync(lock, 'utf8') === token) io.unlinkSync(lock) } catch { /* gone already */ }
}

/** Runs `fn` holding `lock`. */
export async function withLock(lock, fn, opts = {}) {
  const token = await takeLock(lock, opts)
  try { return await fn() } finally { await dropLock(lock, token, opts) }
}

// ---- reading and writing ----

/** The file's text, or null when there is none. */
export async function readRegistryText(path, { fs } = {}) {
  const io = await loadFs(fs)
  try { return io.readFileSync(path, 'utf8') } catch (e) {
    if (e?.code === 'ENOENT') return null
    throw e
  }
}

// Windows refuses a rename over a file another program has open: retried for up to a second.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
async function replaceFile(io, path, text) {
  const tmp = `${path}.${pidOf()}.tmp`
  io.writeFileSync(tmp, text)
  const until = Date.now() + 1000
  for (;;) {
    try { io.renameSync(tmp, path); return } catch (e) {
      if (BUSY.has(e?.code) && Date.now() < until) { await sleep(50); continue }
      try { io.unlinkSync(tmp) } catch { /* gone already */ }
      throw e
    }
  }
}

/**
 * Writes `raw` to `path` if the file still holds `expected`, the text the edit started from
 * (null: no file yet), else nothing. `raw` must pass checkRegistry. Under the lock beside the
 * file, across the compare and the rename: read again, compare, then write beside and rename
 * (a new file is created exclusively, its folder made first). The indentation `expected` was
 * written with is kept. Resolves with the text written. Refusals are errors with a `code`:
 * registry/invalid, registry/stale (changed since it was read), registry/locked.
 */
export async function writeRegistry(path, raw, expected, { kind, fs, wait, stale } = {}) {
  if (expected === undefined) throw new Error('writeRegistry: pass the text the edit started from (null for a new file)')
  const errors = checkRegistry(raw, { kind, before: expected })
  if (errors.length) throw fail(`Not saved: ${errors.join('; ')}`, 'registry/invalid')
  const io = await loadFs(fs)
  const text = serializeRegistry(raw, expected === null ? '  ' : indentOf(expected))
  io.mkdirSync(parentOf(path), { recursive: true })
  return withLock(`${path}.lock`, async () => {
    const now = await readRegistryText(path, { fs: io })
    if (now !== expected) throw fail(`Not saved: ${path} changed since it was read (another edit landed first)`, 'registry/stale')
    if (expected === null) {
      try { io.writeFileSync(path, text, { flag: 'wx' }) } catch (e) {
        if (e?.code === 'EEXIST') throw fail(`Not saved: ${path} appeared since it was read`, 'registry/stale')
        throw e
      }
    } else await replaceFile(io, path, text)
    return text
  }, { fs: io, wait, stale })
}

/**
 * Reads the file, applies `edit(raw)` (it edits `raw` in place or returns the new one) and
 * writes it if unchanged; when another write landed first, redoes the edit on the fresh text,
 * up to `tries` times (RFC 0014: then the caller notifies). No file yet: `edit` gets an empty
 * one. A file that does not parse is never written. Resolves with `{ text, raw }`.
 */
export async function updateRegistry(path, edit, { kind, fs, tries = 3, wait, stale } = {}) {
  const io = await loadFs(fs)
  for (let attempt = 1; ; attempt += 1) {
    const expected = await readRegistryText(path, { fs: io })
    const raw = expected === null ? emptyRegistry(kind) : parseRegistry(expected, { kind }).raw
    const next = (await edit(raw)) ?? raw
    try {
      const text = await writeRegistry(path, next, expected, { kind, fs: io, wait, stale })
      return { text, raw: next }
    } catch (e) {
      if (e?.code !== 'registry/stale' || attempt >= tries) throw e
    }
  }
}
