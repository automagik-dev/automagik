import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readBusy } from '../src/idle.js'
import {
  closeAfterFade, createQuitGuard, liveBusy, quitChoice, quitPrompt, requestQuit, runningBots,
  surfaceWindow,
} from '../src/quit-guard.js'

test('only a trustable busy file with agents running asks; a missing one never does', () => {
  assert.equal(runningBots({ running: 1, at: 1 }), 1)
  assert.equal(runningBots({ running: 4 }), 4)
  const untrusted = [
    null, undefined, {}, { running: 0 }, { running: -1 }, { running: '1' }, { running: 1.5 },
  ]
  for (const busy of untrusted) assert.equal(runningBots(busy), 0)
})

test('the question names the bots and makes Cancel (and Escape) the safe answer', () => {
  const one = quitPrompt({ product: 'Automagik', running: 1 })
  assert.deepEqual(one.buttons, ['Cancel', 'Quit'])
  assert.equal(one.defaultId, 0)
  assert.equal(one.cancelId, 0)
  assert.equal(one.type, 'question')
  assert.equal(one.message, 'Automagik is still working')
  assert.equal(one.detail, 'A bot is running. Quitting stops it.')
  const many = quitPrompt({ product: 'Automagik', running: 3 })
  assert.equal(many.detail, '3 bots are running. Quitting stops them.')
  assert.equal(quitChoice(1), 'quit')
  assert.equal(quitChoice(0), 'cancel')
  assert.equal(quitChoice(undefined), 'cancel')
})

test('with nothing running the quit is clean and the dialog is never shown', async () => {
  let prompts = 0
  let stops = 0
  const guard = createQuitGuard({
    busy: () => null,
    prompt: async () => { prompts++; return { response: 1 } },
  })
  assert.equal(guard.needs(), false)
  assert.equal(await guard.ask(), 'clean')
  assert.equal(await requestQuit({ guard, beginQuit: async () => { stops++ } }), 'clean')
  assert.equal(prompts, 0)
  assert.equal(stops, 1)
})

test('Cancel keeps the app and dsh running: no clean stop, no confirmed quit', async () => {
  const asked = []
  let stops = 0
  const guard = createQuitGuard({
    busy: () => ({ running: 2, at: 1 }),
    prompt: async ({ running, parent }) => {
      asked.push({ running, parent })
      return { response: 0 }
    },
  })
  assert.equal(guard.needs(), true)
  assert.equal(
    await requestQuit({ guard, parent: 'window', beginQuit: async () => { stops++ } }),
    'cancel',
  )
  assert.equal(stops, 0)
  assert.equal(guard.confirmed, false)
  assert.deepEqual(asked, [{ running: 2, parent: 'window' }])
  // The next Cmd+Q asks again: nothing was remembered as a quit.
  assert.equal(await guard.ask(), 'cancel')
  assert.equal(asked.length, 2)
})

test('Quit runs the clean stop once, and the quit that follows is not asked again', async () => {
  let prompts = 0
  let stops = 0
  const guard = createQuitGuard({
    busy: () => ({ running: 1, at: 1 }),
    prompt: async () => { prompts++; return { response: 1 } },
  })
  assert.equal(await requestQuit({ guard, beginQuit: async () => { stops++ } }), 'quit')
  assert.equal(stops, 1)
  assert.equal(prompts, 1)
  assert.equal(guard.confirmed, true)
  assert.equal(guard.needs(), false)
  assert.equal(await guard.ask(), 'quit')
  assert.equal(prompts, 1)
})

test('one question at a time: concurrent quits share the dialog and the answer', async () => {
  let release
  const answer = new Promise(resolve => { release = resolve })
  let prompts = 0
  const guard = createQuitGuard({
    busy: () => ({ running: 1, at: 1 }),
    prompt: () => { prompts++; return answer },
  })
  const first = guard.ask()
  const second = guard.ask()
  assert.equal(prompts, 1)
  release({ response: 1 })
  assert.deepEqual(await Promise.all([first, second]), ['quit', 'quit'])
})

test('a dialog that fails keeps the app running instead of quitting under a bot', async () => {
  const log = []
  const guard = createQuitGuard({
    busy: () => ({ running: 1, at: 1 }),
    prompt: async () => { throw new Error('no display') },
    log: line => log.push(line),
  })
  assert.equal(await guard.ask(), 'cancel')
  assert.equal(guard.confirmed, false)
  assert.match(log[0], /keeps running/)
})

test("the welcome's real busy file is what the guard reads", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'automagik-quit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'busy.json')
  writeFileSync(file, JSON.stringify({ running: 1, at: Date.now() }))
  let prompts = 0
  const guard = createQuitGuard({
    busy: () => readBusy(file),
    prompt: async () => { prompts++; return { response: 0 } },
  })
  assert.equal(guard.needs(), true)
  assert.equal(await guard.ask(), 'cancel')
  assert.equal(prompts, 1)
  writeFileSync(file, JSON.stringify({ running: 0, at: Date.now() }))
  assert.equal(guard.needs(), false)
  assert.equal(await guard.ask(), 'clean')
})

test('main.js asks in before-quit, on the close button, and behind window-all-closed', () => {
  // main.js is the Electron entry and cannot be imported under node --test (frame.test.js,
  // dsh.test.js read it at source for the same reason).
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /createQuitGuard\(\{/)
  // The reading is trusted only as the running dsh's own: a crash's leftover does not ask.
  assert.match(main, /busy: \(\) => liveBusy\(readBusy\(busyFileOf\(home\)\), \{ child: dshProcess\.child, since: dshProcess\.since \}\)/)
  assert.match(main, new RegExp(
    "app\\.on\\('before-quit', \\(event\\) => \\{"
    + "[\\s\\S]{0,220}?requestQuit\\(\\{ guard: quitGuard,"
    + " parent: window, beginQuit: stopAndQuit \\}\\)",
  ))
  assert.match(main, new RegExp(
    "window\\.on\\('close', \\(event\\) => \\{"
    + "[\\s\\S]{0,220}?quitGuard\\.needs\\(\\)",
  ))
  assert.match(main, /app\.on\('window-all-closed', \(\) => app\.quit\(\)\)/)
  // The clean stop is unchanged: fade, stop dsh, then quit.
  assert.match(main, new RegExp(
    "fade\\(window, \\{ to: 0, reduced: lessMotion\\(\\) \\}\\)"
    + "[\\s\\S]{0,160}?dshProcess\\.stop\\(\\)[\\s\\S]{0,160}?app\\.quit\\(\\)",
  ))
})

// Issue #882, item 1: a busy.json left by a crash names bots that are gone.
test("a busy file is trusted only as the running dsh's own: a crash's leftover does not ask", async () => {
  const alive = { exitCode: null, signalCode: null }
  const busy = { running: 2, at: 5_000 }
  assert.equal(liveBusy(busy, { child: alive, since: 4_000 }), busy)
  assert.equal(liveBusy(busy, { child: alive, since: 5_000 }), busy, 'written as dsh spawned still counts')
  // Written before this dsh was spawned: the last run's file, not yet replaced by the welcome.
  assert.equal(liveBusy(busy, { child: alive, since: 5_001 }), null)
  // No dsh, or one that has ended: nothing can be running.
  assert.equal(liveBusy(busy, { child: null, since: 4_000 }), null)
  assert.equal(liveBusy(busy, { child: { exitCode: 1, signalCode: null }, since: 4_000 }), null)
  assert.equal(liveBusy(busy, { child: { exitCode: null, signalCode: 'SIGKILL' }, since: 4_000 }), null)
  // A reading or a spawn time that cannot be compared is not trusted.
  assert.equal(liveBusy({ running: 2 }, { child: alive, since: 4_000 }), null)
  assert.equal(liveBusy(busy, { child: alive, since: null }), null)
  assert.equal(liveBusy(busy), null)
  assert.equal(liveBusy(null, { child: alive, since: 0 }), null)

  // Through the guard: the stale file quits clean with no dialog; the live one asks.
  let prompts = 0
  const guardOver = since => createQuitGuard({
    busy: () => liveBusy(busy, { child: alive, since }),
    prompt: async () => { prompts++; return { response: 0 } },
  })
  const stale = guardOver(9_000)
  assert.equal(stale.needs(), false)
  assert.equal(await stale.ask(), 'clean')
  assert.equal(prompts, 0)
  const live = guardOver(1_000)
  assert.equal(live.needs(), true)
  assert.equal(await live.ask(), 'cancel')
  assert.equal(prompts, 1)
})

// A window stand-in that records what it was told.
function windowStand({ minimized = false, visible = true, destroyed = false, stuck = false } = {}) {
  const calls = []
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore() { calls.push('restore'); if (!stuck) minimized = false },
    show() { calls.push('show'); if (!stuck) visible = true },
    focus() { calls.push('focus') },
  }
}

// Issue #882, item 2: the question is a sheet on the window, so the window must be in sight.
test('the question surfaces its window first: restored, shown and focused, or no parent at all', () => {
  const plain = windowStand()
  assert.equal(surfaceWindow(plain), plain)
  assert.deepEqual(plain.calls, ['focus'])

  const minimized = windowStand({ minimized: true })
  assert.equal(surfaceWindow(minimized), minimized)
  assert.deepEqual(minimized.calls, ['restore', 'focus'])

  const hidden = windowStand({ visible: false })
  assert.equal(surfaceWindow(hidden), hidden)
  assert.deepEqual(hidden.calls, ['show', 'focus'])

  const both = windowStand({ minimized: true, visible: false })
  assert.equal(surfaceWindow(both), both)
  assert.deepEqual(both.calls, ['restore', 'show', 'focus'])

  // A window that stays out of sight is never the sheet's parent: the dialog stands alone.
  assert.equal(surfaceWindow(windowStand({ minimized: true, stuck: true })), null)
  assert.equal(surfaceWindow(windowStand({ visible: false, stuck: true })), null)
  const gone = windowStand({ destroyed: true })
  assert.equal(surfaceWindow(gone), null)
  assert.deepEqual(gone.calls, [], 'a destroyed window is not touched')
  assert.equal(surfaceWindow(null), null)
  const throwing = { ...windowStand(), focus() { throw new Error('Object has been destroyed') } }
  assert.equal(surfaceWindow(throwing), null)
})

// What a close does, in order, over a guard whose busy reading the test moves.
function closing({ running = 0, response = 0, fadeOut, fadeIn } = {}) {
  const state = { running }
  const steps = []
  const logged = []
  const guard = createQuitGuard({
    busy: () => ({ running: state.running, at: 1 }),
    prompt: async () => { steps.push('prompt'); return { response } },
  })
  const run = () => closeAfterFade({
    guard,
    fadeOut: fadeOut ?? (async () => { steps.push('fade out') }),
    fadeIn: fadeIn ?? (async () => { steps.push('fade in') }),
    reveal: () => { steps.push('reveal') },
    ask: () => requestQuit({ guard, beginQuit: async () => { steps.push('clean stop') } }),
    destroy: () => { steps.push('destroy') },
    log: line => logged.push(line),
  })
  return { state, steps, logged, guard, run }
}

// Issue #882, item 5: the fade and the question are one sequence.
test('a close with nothing running fades, settles the quit, then destroys the window', async () => {
  const close = closing()
  assert.equal(await close.run(), 'closed')
  assert.deepEqual(close.steps, ['fade out', 'destroy'])
  // A bot that starts after the window is gone is not asked about: there is no window to keep.
  close.state.running = 1
  assert.equal(close.guard.needs(), false)
  assert.equal(await requestQuit({ guard: close.guard, beginQuit: async () => { close.steps.push('clean stop') } }), 'quit')
  assert.deepEqual(close.steps, ['fade out', 'destroy', 'clean stop'], 'the quit behind the close goes on unasked')
})

test('a bot that starts during the fade brings the window back and is asked about; Cancel keeps it', async () => {
  const racing = closing({
    fadeOut: async () => { racing.steps.push('fade out'); racing.state.running = 1 },
  })
  assert.equal(await racing.run(), 'cancel')
  assert.deepEqual(racing.steps, ['fade out', 'fade in', 'prompt'])
  assert.equal(racing.steps.includes('destroy'), false, 'the window is never destroyed under a running bot')
  assert.equal(racing.guard.confirmed, false)
  assert.equal(racing.guard.needs(), true, 'a later close asks again')

  const quitting = closing({
    response: 1,
    fadeOut: async () => { quitting.steps.push('fade out'); quitting.state.running = 2 },
  })
  assert.equal(await quitting.run(), 'quit')
  assert.deepEqual(quitting.steps, ['fade out', 'fade in', 'prompt', 'clean stop'])
})

test('a failed fade still quits cleanly, and a failed fade back still leaves a window to use', async () => {
  const failed = closing({ fadeOut: async () => { throw new Error('no compositor') } })
  assert.equal(await failed.run(), 'closed')
  assert.deepEqual(failed.steps, ['destroy'])
  assert.match(failed.logged[0], /fade failed \(no compositor\)/)

  const back = closing({
    fadeOut: async () => { back.steps.push('fade out'); back.state.running = 1 },
    fadeIn: async () => { throw new Error('no compositor') },
  })
  assert.equal(await back.run(), 'cancel')
  assert.deepEqual(back.steps, ['fade out', 'reveal', 'prompt'])
  assert.match(back.logged[0], /did not fade back in/)
})

test('main.js surfaces the window for the question and closes through closeAfterFade', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const guard = main.slice(main.indexOf('const quitGuard = createQuitGuard({'), main.indexOf('// dsh\'s origin'))
  assert.match(guard, /const sheet = surfaceWindow\(parent \?\? window\)/)
  assert.match(guard, /return sheet \? dialog\.showMessageBox\(sheet, question\) : dialog\.showMessageBox\(question\)/)
  const close = main.slice(main.indexOf("window.on('close', (event) => {"), main.indexOf("window.on('closed'"))
  assert.match(close, /void closeAfterFade\(\{\s*guard: quitGuard,/)
  assert.match(close, /ask: askToQuit,/)
  assert.match(close, /destroy: \(\) => \{ out\.mark\('window gone'\); window\?\.destroy\(\) \}/)
  // The window is destroyed only inside that sequence, never beside it.
  assert.equal(close.match(/destroy\(\)/g).length, 1)
  assert.match(close, /if \(process\.platform === 'linux'\) \{ quitGuard\.settle\(\); return \}/)
})
