// The composer hint "Type a prompt to start. Save it here…" is dsh-oh-my-claude's starter
// card, which its `starterOff` hint hides. On a fresh install, onboarding hides it once:
// the plugin keeps its hints in one hints.json for the whole computer (every DSH profile
// on it), so this adds `starterOff` only when the file has no such key, never changes a
// key that is there, and leaves a file it cannot read alone. The plugin's own setting
// still turns the hint back on. Nothing of dsh-oh-my-claude is changed.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Where dsh-oh-my-claude keeps its hints: its state folder (DSH_OMC_STATE_DIR), hints.json. */
export const hintsFile = (env = process.env) => join(env.DSH_OMC_STATE_DIR || join(homedir(), '.local', 'state', 'dsh-oh-my-claude'), 'hints.json')

/** Adds `starterOff: true` when the hints have no `starterOff` yet. True when it wrote. */
export async function seedStarterOff(file) {
  let hints = {}
  try {
    hints = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') return false
  }
  if (hints === null || typeof hints !== 'object' || Array.isArray(hints) || Object.hasOwn(hints, 'starterOff')) return false
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ ...hints, starterOff: true }, null, 2)}\n`)
  await rename(temp, file)
  return true
}
