import assert from 'node:assert/strict'
import test from 'node:test'
import { startUp } from '../src/startup.js'

// A step that records its start and end in `order`, and finishes when `release` is called.
function gate(order, name, value) {
  let release
  const done = new Promise(resolve => { release = () => resolve(value) })
  const step = (...args) => {
    order.push(`${name} start${args.length ? ` ${args.join(' ')}` : ''}`)
    return done.then((result) => { order.push(`${name} end`); return result })
  }
  return { step, release }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('dsh spawns only once the port, the profile with the lane\'s plugins and the tools are all ready', async () => {
  const order = []
  const port = gate(order, 'port', 4100)
  const profile = gate(order, 'profile')
  const tools = gate(order, 'tools')
  const dsh = gate(order, 'dsh', { url: 'http://127.0.0.1:4100/?token=t' })
  const started = startUp({
    port: port.step,
    profile: profile.step,
    tools: tools.step,
    spawn: dsh.step,
    load: ({ url }) => { order.push(`load ${url}`); return 'loaded' },
    mark: step => order.push(`mark ${step}`),
  })
  await tick()
  // The three start together.
  assert.deepEqual(order, ['port start', 'profile start', 'tools start'])
  port.release()
  tools.release()
  await tick()
  assert.ok(!order.includes('dsh start 4100'), 'dsh waits for the profile')
  profile.release()
  await tick()
  assert.deepEqual(order.slice(-2), ['mark profile ready', 'dsh start 4100'])
  dsh.release()
  assert.equal(await started, 'loaded')
  assert.equal(order.at(-1), 'load http://127.0.0.1:4100/?token=t')
})

test('the page is made and earlier logins forgotten while dsh boots, and it loads only once both are done', async () => {
  const order = []
  const dsh = gate(order, 'dsh', { url: 'u' })
  const forget = gate(order, 'forget')
  const started = startUp({
    port: () => 4100,
    profile: () => {},
    tools: () => {},
    spawn: dsh.step,
    forget: forget.step,
    after: (port) => { order.push(`after ${port}`) },
    load: () => { order.push('load') },
  })
  await tick()
  // Both run before dsh is ready.
  assert.deepEqual(order, ['dsh start 4100', 'forget start 4100', 'after 4100'])
  dsh.release()
  await tick()
  assert.ok(!order.includes('load'), 'the page does not load before the earlier logins are gone')
  forget.release()
  await started
  assert.deepEqual(order.slice(-3), ['dsh end', 'forget end', 'load'])
})

test('a start whose profile or dsh fails rejects, and loads nothing', async () => {
  let spawned = false
  let loaded = false
  const base = { port: () => 1, tools: () => {}, load: () => { loaded = true } }
  await assert.rejects(startUp({ ...base, profile: async () => { throw new Error('no room') }, spawn: () => { spawned = true } }), /no room/)
  assert.equal(spawned, false, 'dsh does not start on a profile that is not in place')
  // A forget still running when dsh fails leaves no unhandled rejection behind.
  await assert.rejects(startUp({ ...base, profile: () => {}, spawn: async () => { throw new Error('dsh exited') }, forget: () => new Promise((_, fail) => setImmediate(() => fail(new Error('later')))) }), /dsh exited/)
  await tick()
  assert.equal(loaded, false)
})
