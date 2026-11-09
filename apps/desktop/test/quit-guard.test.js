import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readBusy } from '../src/idle.js'
import {
  createQuitGuard, quitChoice, quitPrompt, requestQuit, runningBots,
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
  assert.match(main, /busy: \(\) => readBusy\(busyFileOf\(home\)\)/)
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
