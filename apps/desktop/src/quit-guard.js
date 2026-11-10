// Quitting while a bot runs is a question, not a silent stop. The welcome's busy file
// ({ running, at }, idle.js) is the only source: a missing or unreadable one is an older
// welcome, or a dsh that is not up, and the quit goes ahead as it always has. So does a file
// this run's dsh did not write (liveBusy): one left by a crash names bots that are gone. Pure:
// main.js supplies the reading, the dialog and the app's clean stop.

/**
 * The busy reading, only when it is the running dsh's own: `child` is the dsh process now
 * (dshRun's) and `since` when it was spawned. Nothing runs without a live dsh, and the welcome
 * writes the file when it loads and at every change after, so a reading older than the spawn is
 * a leftover (a crash, or a quit that stopped a bot mid-run) and is not asked about.
 */
export function liveBusy(busy, { child, since } = {}) {
  if (!busy) return null
  if (!child || child.exitCode != null || child.signalCode != null) return null
  if (!Number.isFinite(busy.at) || !Number.isFinite(since) || busy.at < since) return null
  return busy
}

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
 * The window the question is a sheet on, brought where the person sees it: restored when
 * minimized, shown when hidden, then focused. Null when there is no window to show (gone, or
 * it cannot be shown): the question is then asked with no parent, as a dialog of its own,
 * never as a sheet on a window nobody sees.
 */
export function surfaceWindow(win) {
  try {
    if (!win || win.isDestroyed()) return null
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    return win.isVisible() && !win.isMinimized() ? win : null
  } catch {
    return null
  }
}

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
     * A close that found nothing to ask is settled: the quit it leads to is that same decision
     * and is not asked again, whatever starts running in between.
     */
    settle() { confirmed = true },
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

/**
 * The close button's way out, one step at a time: the window fades, and only then is the
 * question looked at again. A bot that started during the fade brings the window back
 * (`fadeIn`, or `reveal` at once when that fails) and is asked about (`ask`), so Cancel leaves
 * a window to use. With nothing to ask the close is settled before the window is destroyed, so
 * the quit that follows cannot ask with no window left. A fade that fails does not stop the
 * close: the window is destroyed and the app quits cleanly.
 */
export async function closeAfterFade({ guard, fadeOut, fadeIn, reveal = () => {}, ask, destroy, log = () => {} }) {
  try {
    await fadeOut()
  } catch (error) {
    log(`quit: the window's fade failed (${error?.message ?? error}); closing without it`)
  }
  if (guard.needs()) {
    try {
      await fadeIn()
    } catch (error) {
      log(`quit: the window did not fade back in (${error?.message ?? error}); shown at once`)
      try { reveal() } catch {}
    }
    return ask()
  }
  guard.settle()
  destroy()
  return 'closed'
}
