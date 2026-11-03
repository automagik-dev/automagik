// The one-time pairing code: what a try does to it, cancelling it, and the short key fingerprint
// the dialog shows next to each phone. No iroh here, so `node --test` runs it without npm.
import { createHash, timingSafeEqual } from 'node:crypto'
import { unlinkSync, readFileSync } from 'node:fs'

/** Wrong tries one phone key gets at a code; after that its tries are refused and not counted. */
export const TRIES_PER_PHONE = 3
/** Wrong tries from all phones together that end a code. */
export const TRIES_PER_CODE = 20

export const sameCode = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest(), y = createHash('sha256').update(String(b)).digest()
  return timingSafeEqual(x, y)
}

/** The first 12 hex characters of a key in groups of four, as the dialog and the log show it. */
export const fingerprint = id => (String(id).slice(0, 12).match(/.{1,4}/g) ?? []).join(' ')

/**
 * One try at the pending code (pairing.json) from `phone` (its full key). Returns `verdict`
 * ('gone' | 'locked' | 'wrong' | 'ok') and `next`: the pairing.json to write, null to delete it,
 * or undefined to leave it as it is.
 *
 * One phone that keeps getting it wrong locks only itself out, so it can't end each new code for
 * everyone; TRIES_PER_CODE still ends a code that many keys guess at.
 */
export function judgeCode(pending, phone, code, now = Date.now()) {
  if (!pending || !(now <= pending.expires)) return { verdict: 'gone', next: undefined }
  const tries = pending.tries?.[phone] ?? 0
  if (tries >= TRIES_PER_PHONE) return { verdict: 'locked', next: undefined }
  if (sameCode(code, pending.code)) return { verdict: 'ok', next: null }
  const failures = (pending.failures ?? 0) + 1
  if (failures >= TRIES_PER_CODE) return { verdict: 'wrong', next: null }
  return { verdict: 'wrong', next: { ...pending, failures, tries: { ...pending.tries, [phone]: tries + 1 } } }
}

/** Ends the live code, if any. True when there was one that still worked. */
export function cancelCode(path, now = Date.now()) {
  let pending = null
  try { pending = JSON.parse(readFileSync(path, 'utf8')) } catch {}
  try { unlinkSync(path) } catch { return false }
  return Boolean(pending && now <= pending.expires)
}
