// The composer's unsent drafts, kept where the page's origin does not reach (#141). DSH keeps
// each Session's draft in the page's localStorage, under `dsh.conversation.<session id>`, and
// localStorage belongs to an origin: when dsh has to serve on another port (dsh.js launchPort:
// the stored one was taken), the page opens on a new origin and finds none of them. The page's
// preload (preload.cjs) copies those entries here as they change and, on an origin that is not
// the one they were copied from, puts them back before the page reads them. DSH still owns the
// drafts and their format: an entry is the string DSH stored, never read or changed here.
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The localStorage keys DSH's composer keeps a Session's draft under. */
export const DRAFT_PREFIX = 'dsh.conversation.'

// The copy is written whole each time a draft changes, so it stays small: an entry larger than
// DRAFT_MAX_BYTES, or one that would take the copy past DRAFTS_MAX_BYTES, is left out of it (and
// so never put back); the others are kept.
export const DRAFT_MAX_BYTES = 256 * 1024
export const DRAFTS_MAX_BYTES = 2 * 1024 * 1024

export const draftsFileOf = home => join(home, 'drafts.json')

const ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

// What DSH stores for a Session is an object holding `draft`; its other keys under the prefix
// (a width) are not drafts. The same test as the preload's (preload.cjs isDraftEntry).
const IS_DRAFT = `(key, value) => {
  if (typeof key !== 'string' || !key.startsWith(${JSON.stringify(DRAFT_PREFIX)}) || typeof value !== 'string') return false
  try { const stored = JSON.parse(value); return stored !== null && typeof stored === 'object' && 'draft' in stored } catch { return false }
}`

/** Run in dsh's page (main.js keepPageDrafts): its drafts as they are now. */
export const PAGE_DRAFTS = `(() => {
  const isDraft = ${IS_DRAFT}
  const entries = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    const value = localStorage.getItem(key)
    if (isDraft(key, value)) entries[key] = value
  }
  return entries
})()`

/**
 * `entries` when it is the drafts of a page ({ 'dsh.conversation.<id>': string }), without the
 * ones too large to keep; null when it is anything else.
 */
export function draftEntries(entries) {
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return null
  const kept = {}
  let size = 0
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(DRAFT_PREFIX) || key.length === DRAFT_PREFIX.length || typeof value !== 'string') return null
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(value)
    if (bytes > DRAFT_MAX_BYTES || size + bytes > DRAFTS_MAX_BYTES) continue
    size += bytes
    kept[key] = value
  }
  return kept
}

/** The copy in `file` ({ origin, entries }), or null when there is none or it is not one. */
export function readDrafts(file) {
  let saved
  try { saved = JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
  if (saved === null || typeof saved !== 'object' || typeof saved.origin !== 'string' || !ORIGIN.test(saved.origin)) return null
  const entries = draftEntries(saved.entries)
  return entries === null ? null : { origin: saved.origin, entries }
}

/**
 * Keep `entries`, the drafts of the page on `origin`, in `file`: written whole, for this user
 * only. Answers whether it was kept; anything that is not a page's drafts is refused, and the
 * earlier copy stays.
 */
export function saveDrafts(file, origin, entries) {
  const kept = draftEntries(entries)
  if (kept === null || typeof origin !== 'string' || !ORIGIN.test(origin)) return false
  const temporary = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ origin, entries: kept })}\n`, { mode: 0o600 })
    // An earlier temporary file left by a crash keeps its own mode.
    chmodSync(temporary, 0o600)
    renameSync(temporary, file)
    return true
  } catch {
    rmSync(temporary, { force: true })
    return false
  }
}

/**
 * What the page on `origin` gets back as it starts: { moved, entries }. When the copy was taken
 * on another origin (`moved`), its entries are the newest state of those Sessions and replace
 * the page's, and the copy is `origin`'s from then on. On the same origin the page's own storage
 * is the newer one, and the entries only fill in keys it has lost (a put-back that failed
 * halfway, a storage Chromium never wrote): DSH keeps a Session's key after a send, with an
 * empty draft, so a key that is there is never replaced and a sent draft stays sent. Only reads
 * and writes one small file.
 */
export function takeDrafts(file, origin) {
  const none = { moved: false, entries: {} }
  if (typeof origin !== 'string' || !ORIGIN.test(origin)) return none
  const saved = readDrafts(file)
  if (saved === null) return none
  if (saved.origin === origin) return { moved: false, entries: saved.entries }
  saveDrafts(file, origin, saved.entries)
  return { moved: true, entries: saved.entries }
}
