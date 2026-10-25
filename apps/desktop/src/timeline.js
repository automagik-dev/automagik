// How long the app takes to come and go, in logs/start.log: a start's steps from the moment the
// process began, a quit's from the click, and an update's restart as a whole, asked for in one
// copy of the app and back in the next (logs/restart.json carries the moment across). Pure
// apart from the files it is given: main.js passes the real ones, tests a folder of their own.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/**
 * A run of steps timed from `since` (ms): `mark(step)` writes "<iso> <kind>: <step> +<ms> ms"
 * through `write`. A step marked twice keeps its first time.
 */
export function steps(kind, { write, since, now = Date.now }) {
  const seen = new Set()
  return {
    mark(step) {
      if (seen.has(step)) return
      seen.add(step)
      const at = now()
      write(`${new Date(at).toISOString()} ${kind}: ${step} +${Math.max(0, Math.round(at - since))} ms\n`)
    },
  }
}

/** An update restart is under way: the next start says how long it took. */
export function noteRestart(file, { from, to, at = Date.now() }) {
  try {
    writeFileSync(file, `${JSON.stringify({ from, to, at })}\n`)
  } catch {}
}

/**
 * The restart this start ends, as one line, or null: "update restart: 3.14.0 → 3.15.0, back
 * after 23.4 s" (or "did not take" when the copy that came back is still the old one). The
 * note is read once.
 */
export function restartLine(file, { version, now = Date.now() }) {
  let note
  try {
    note = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  } finally {
    rmSync(file, { force: true })
  }
  if (!Number.isFinite(note?.at)) return null
  const seconds = ((now - note.at) / 1000).toFixed(1)
  const took = version === note.to ? '' : `, but ${version} came back (the update did not take)`
  return `${new Date(now).toISOString()} update restart: ${note.from} → ${note.to}, back after ${seconds} s${took}\n`
}
