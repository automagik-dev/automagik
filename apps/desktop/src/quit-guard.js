// Quitting while a bot runs is a question, not a silent stop. The welcome's busy file
// ({ running, at }, idle.js) is the only source: a missing or unreadable one is an older
// welcome, or a dsh that is not up, and the quit goes ahead as it always has. Pure: main.js
// supplies the reading, the dialog and the app's clean stop.

/** How many bots the welcome says are running; a busy file it cannot trust is none. */
export const runningBots =
  busy => (Number.isInteger(busy?.running) && busy.running > 0 ? busy.running : 0)

/** The question a running bot puts before the app goes; Cancel is the default, and Escape. */
export function quitPrompt({ product, running }) {
  const one = running === 1
  const bots = one ? 'A bot is running' : `${running} bots are running`
  return {
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: `${product} is still working`,
    detail: `${bots}. Quitting stops ${one ? 'it' : 'them'}.`,
  }
}

/** The Quit button (the second) goes on; Cancel, Escape, or a closed dialog keeps the app. */
export const quitChoice = response => (response === 1 ? 'quit' : 'cancel')

/**
 * One quit question at a time. `busy()` returns the welcome's busy file reading and `prompt`
 * shows the question ({ running }) for it. A confirmed quit stays confirmed for the clean stop
 * that follows, so Cmd+Q after the dialog is not asked twice.
 */
export function createQuitGuard({ busy, prompt, log = () => {} }) {
  let asking = null
  let confirmed = false
  const running = () => runningBots(busy())
  return {
    get confirmed() { return confirmed },
    /** Whether a quit right now has a running bot to ask about. */
    needs: () => !confirmed && running() > 0,
    /**
     * 'clean' when no bot runs (quit as today), 'quit' when the person confirmed, or 'cancel'
     * when they kept the app running. Concurrent asks share one dialog, and a failed dialog
     * keeps the app running rather than quitting under a bot.
     */
    ask(parent) {
      if (confirmed) return Promise.resolve('quit')
      if (asking) return asking
      const count = running()
      if (count === 0) return Promise.resolve('clean')
      asking = (async () => {
        try {
          const { response } = await prompt({ running: count, parent })
          if (quitChoice(response) === 'quit') {
            confirmed = true
            return 'quit'
          }
          return 'cancel'
        } catch (error) {
          log(`quit: the question failed (${error?.message ?? error}); the app keeps running`)
          return 'cancel'
        } finally {
          asking = null
        }
      })()
      return asking
    },
  }
}

/**
 * A quit request with the guard in front: ask first, then run `beginQuit` (the app's clean
 * stop) only when there is nothing to ask or the person said Quit. Cancel leaves the app and
 * dsh running, untouched.
 */
export async function requestQuit({ guard, parent, beginQuit }) {
  const answer = await guard.ask(parent)
  if (answer === 'cancel') return 'cancel'
  await beginQuit()
  return answer
}
