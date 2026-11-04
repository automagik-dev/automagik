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
// A step that only records that it ran.
const note = (order, name) => (...args) => { order.push(`${name}${args.length ? ` ${args.join(' ')}` : ''}`) }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('dsh spawns only once the port, the profile then the lane\'s plugins, and the tools are all ready', async () => {
  const order = []
  const port = gate(order, 'port', 4100)
  const profile = gate(order, 'profile')
  const tools = gate(order, 'tools')
  const dsh = gate(order, 'dsh', { url: 'http://127.0.0.1:4100/?token=t' })
  const started = startUp({
    port: port.step,
    profile: profile.step,
    lane: note(order, 'lane'),
    tools: tools.step,
    spawn: dsh.step,
    load: ({ url }) => { order.push(`load ${url}`); return 'loaded' },
    mark: step => order.push(`mark ${step}`),
  })
  await tick()
  // The three start together; the lane waits for the profile.
  assert.deepEqual(order, ['port start', 'profile start', 'tools start'])
  port.release()
  tools.release()
  await tick()
  assert.ok(!order.includes('lane') && !order.includes('dsh start 4100'), 'the lane and dsh wait for the profile')
  profile.release()
  await tick()
  assert.deepEqual(order.slice(-4), ['profile end', 'lane', 'mark profile ready', 'dsh start 4100'])
  dsh.release()
  assert.equal(await started, 'loaded')
  assert.equal(order.at(-1), 'load http://127.0.0.1:4100/?token=t')
})

test('while dsh boots the guard goes up before the page\'s view, and the page loads once dsh is ready and earlier logins are gone', async () => {
  const order = []
  const dsh = gate(order, 'dsh', { url: 'u' })
  const forget = gate(order, 'forget')
  const started = startUp({
    port: () => 4100,
    profile: () => {},
    tools: () => {},
    spawn: dsh.step,
    forget: forget.step,
    after: note(order, 'after'),
    guard: note(order, 'guard'),
    view: note(order, 'view'),
    load: () => { order.push('load') },
    updates: note(order, 'updates'),
  })
  await tick()
  // All of it before dsh is ready; the guard before the view it must cover.
  assert.deepEqual(order, ['dsh start 4100', 'forget start 4100', 'after 4100', 'guard 4100', 'view 4100'])
  dsh.release()
  await tick()
  assert.ok(!order.includes('load'), 'the page does not load before the earlier logins are gone')
  assert.ok(!order.includes('updates'), 'updates are not watched before the page can load')
  forget.release()
  await started
  assert.deepEqual(order.slice(-4), ['dsh end', 'forget end', 'load', 'updates'])
})

test('a start whose profile or dsh fails rejects, and loads and watches nothing', async () => {
  const done = []
  const base = { port: () => 1, tools: () => {}, load: note(done, 'load'), updates: note(done, 'updates') }
  await assert.rejects(startUp({ ...base, profile: async () => { throw new Error('no room') }, lane: note(done, 'lane'), spawn: note(done, 'spawn') }), /no room/)
  assert.deepEqual(done, [], 'neither the lane nor dsh go on a profile that is not in place')
  // A forget still running when dsh fails leaves no unhandled rejection behind.
  await assert.rejects(startUp({ ...base, profile: () => {}, spawn: async () => { throw new Error('dsh exited') }, forget: () => new Promise((_, fail) => setImmediate(() => fail(new Error('later')))) }), /dsh exited/)
  await tick()
  assert.deepEqual(done, [], 'no page load and no update watcher when dsh never came up')
})

test('a page that fails to load still has updates watched', async () => {
  const done = []
  await assert.rejects(startUp({ port: () => 1, profile: () => {}, tools: () => {}, spawn: () => ({ url: 'u' }), load: async () => { throw new Error('ERR_CONNECTION_REFUSED') }, updates: note(done, 'updates') }), /CONNECTION_REFUSED/)
  assert.deepEqual(done, ['updates'])
})
