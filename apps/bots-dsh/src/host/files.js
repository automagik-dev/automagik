<<<<<<< HEAD
import { rename as move } from 'node:fs/promises'
=======
import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
>>>>>>> vendor/ds-bot-0.3.6-prepared

// On Windows a file cannot be replaced while another program has it open: another DSH
// reading the team's state, the search indexer, a virus scanner, a sync client. Those
// readers let go within moments.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
const TRIES = 6
const WAIT_MS = 40
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Moves `temp` over `path`, trying again for a moment while Windows reports `path` busy.
 * `check` runs before each new try and throws to stop, as when the lock that allows the
 * write was lost in the meantime. `options` injects what only a test has to decide: the
 * platform that makes busy codes retried, the wait between tries, and the move itself
 * (no runner makes a real rename fail with EBUSY).
 */
export async function replaceFile(temp, path, check = () => {}, { platform = process.platform, sleep = wait, rename = move } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await rename(temp, path)
    } catch (error) {
<<<<<<< HEAD
      if (platform !== 'win32' || attempt >= TRIES || !BUSY.has(error?.code)) throw error
      await sleep(WAIT_MS * attempt)
=======
      if (process.platform !== 'win32' || attempt >= TRIES || !BUSY.has(error?.code)) throw error
      // Real filesystem contention must clear even while tests freeze application timers.
      await delay(WAIT_MS * attempt)
>>>>>>> vendor/ds-bot-0.3.6-prepared
      check()
    }
  }
}
