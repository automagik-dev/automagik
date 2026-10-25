import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fade, FADE_MS } from '../src/motion.js'

// A window stand-in that records what it was told, on a clock the test moves.
function stand() {
  const calls = []
  let visible = true
  let opacity = 1
  const win = {
    calls,
    get opacity() { return opacity },
    isDestroyed: () => false,
    isVisible: () => visible,
    show() { visible = true; calls.push('show') },
    hide() { visible = false; calls.push('hide') },
    setOpacity(value) { opacity = value },
  }
  let clock = 0
  const queue = []
  const timers = { setTimeout: (fn) => queue.push(fn) }
  const run = () => { while (queue.length) { clock += 16; queue.shift()() } }
  return { win, timers, now: () => clock, run, hide: () => { visible = false } }
}

test('a quit fades the window out, then hides it, and leaves it opaque for next time', async () => {
  const { win, timers, now, run } = stand()
  const done = fade(win, { to: 0, platform: 'darwin', timers, now })
  run()
  await done
  assert.deepEqual(win.calls, ['hide'])
  assert.equal(win.opacity, 1)
})

test('an opening window starts clear, shows, and fades in to full', async () => {
  const { win, timers, now, run, hide } = stand()
  hide()
  const seen = []
  const set = win.setOpacity
  win.setOpacity = (value) => { seen.push(value); set(value) }
  const done = fade(win, { to: 1, platform: 'darwin', timers, now })
  run()
  await done
  assert.deepEqual(win.calls, ['show'])
  assert.equal(seen[0], 0)
  assert.equal(seen.at(-1), 1)
  assert.ok(seen.length >= FADE_MS / 16, 'it takes several frames')
})

test('on Linux, or with less motion asked for, it shows and hides at once', async () => {
  for (const options of [{ platform: 'linux' }, { platform: 'darwin', reduced: true }]) {
    const out = stand()
    await fade(out.win, { to: 0, timers: out.timers, now: out.now, ...options })
    assert.deepEqual(out.win.calls, ['hide'])
    const back = stand()
    back.hide()
    await fade(back.win, { to: 1, timers: back.timers, now: back.now, ...options })
    assert.deepEqual(back.win.calls, ['show'])
  }
})

test('a hidden window is not faded out again', async () => {
  const { win, timers, now, hide } = stand()
  hide()
  await fade(win, { to: 0, platform: 'darwin', timers, now })
  assert.deepEqual(win.calls, [])
})
