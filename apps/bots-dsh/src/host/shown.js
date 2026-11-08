// The person's picks for Pocket chat (RFC 0014, `shown[]` in the home file): which project Bots
// a phone may open. Read from `$AUTOMAGIK_HOME/bots/bots.json`, always the registry home,
// whatever AUTOMAGIK_BOTS_HOME says. A global Bot (no project) needs no yes; a project Bot is
// shown only when an entry `{ project, machine?, bots: [id] }` for its project, on its machine,
// lists its id.
//
// Fails closed: with no file, nothing is picked. An unreadable file or one that does not parse
// serves the last good read, with a warn, else no project Bot is shown. Read again on every
// call (the file is capped at 1 MB), so a yes taken back holds at the next list, watch or write.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_PATH, parseRegistry } from '../shared/registry.js'
import { automagikHomeOf } from './folders.js'

/** The home file's path: `$AUTOMAGIK_HOME/bots/bots.json`. */
export const homeRegistryPathOf = (env = process.env) => join(automagikHomeOf(env.AUTOMAGIK_HOME), HOME_PATH)

const EMPTY = Object.freeze({ shown: [], bots: new Map() })
/** A file that can't be read and no good read before it: nothing is known, nothing is shown. */
const UNKNOWN = Object.freeze({ shown: [], bots: null })

/**
 * A reader of the home file's picks and per-Bot places.
 * @param {{ path?: string, warn?: (...args: any[]) => void }} [options]
 * @returns {{ shown(bot: { id: string, project?: string | null, machine?: string | null }): boolean,
 *   places(): Map<string, { folder: string, machine?: string }> | null }}
 */
export function shownReader({ path = homeRegistryPathOf(), warn = () => {} } = {}) {
  let lastGood = null
  let lastError = null
  const read = () => {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      // No file: nothing is picked, and no earlier read stands in for it.
      if (error?.code === 'ENOENT') { lastGood = null; lastError = null; return EMPTY }
      return failed(error)
    }
    try {
      const { file } = parseRegistry(text, { kind: 'home' })
      const bots = new Map()
      for (const bot of file.bots) {
        if (typeof bot.folder === 'string') bots.set(bot.id, { folder: bot.folder, ...(bot.machine !== undefined ? { machine: String(bot.machine) } : {}) })
      }
      lastGood = { shown: file.shown, bots }
      lastError = null
      return lastGood
    } catch (error) {
      return failed(error)
    }
  }
  const failed = (error) => {
    const message = String(error?.message ?? error)
    // Once per new error, not on every 2 s check of every watched chat.
    if (message !== lastError) {
      lastError = message
      warn(lastGood ? 'ds-bot: %s unreadable (%s); Pocket chat keeps its last good read' : 'ds-bot: %s unreadable (%s); no project Bot is shown in Pocket chat', path, message)
    }
    return lastGood ?? UNKNOWN
  }
  return {
    shown(bot) {
      // A Bot whose place could not be read may be a project Bot: never shown as global.
      if (bot?.placeUnknown === true) return false
      if (bot?.project == null) return true
      if (typeof bot.project !== 'string' || typeof bot.id !== 'string') return false
      const machine = bot.machine ?? null
      // Machine compared both ways: a pick on one machine never grants the same folder on another.
      return read().shown.some(entry => entry.project === bot.project && (entry.machine ?? null) === machine && entry.bots.includes(bot.id))
    },
    /**
     * Each home-file Bot with a folder: id -> { folder, machine? }, one read for all of them;
     * null when the file can't be read and there is no good read to fall back on.
     */
    places() {
      return read().bots
    },
  }
}
