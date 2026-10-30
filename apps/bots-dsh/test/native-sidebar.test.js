import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advancedBot, installSimpleControls, installLiveTab, sidebarActions } from '../src/client/native-sidebar.js'
import { surfaceGroups, groupsFor } from '../src/client/surface.js'

const source = (initial) => {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set: next => { value = next; for (const fn of listeners) fn() }, listeners }
}

test('Advanced follows canonical Bot including earlier parts, not another Bot or room', () => {
  const a = { id: 'a', advanced: true }
  const roster = { byId: { a, old: a, b: { id: 'b' } }, roomsById: { room: {} } }
  assert.equal(advancedBot(roster, 'old'), a)
  for (const id of ['b', 'room', 'native', undefined]) assert.equal(advancedBot(roster, id), null)
})

test('simple control shadow withdraws and restores with per-Bot preference and navigation', () => {
  const roster = source({ byId: { a: { id: 'a' }, b: { id: 'b', advanced: true } } })
  const mounted = source('a')
  let installs = 0; let releases = 0
  const off = installSimpleControls({ roster, sources: [mounted], sessionId: () => mounted.getSnapshot(), install: () => { installs++; return () => releases++ } })
  assert.equal(installs, 1)
  mounted.set('b'); assert.equal(releases, 1)
  mounted.set('a'); assert.equal(installs, 2)
  roster.set({ byId: { a: { id: 'a', advanced: true } } }); assert.equal(releases, 2)
  off(); assert.equal(roster.listeners.size, 0); assert.equal(mounted.listeners.size, 0)
})

test('Live registers native page and keyed body transactionally, releases both', () => {
  const records = []; const released = []
  const off = installLiveTab({ tabs: { register: def => { records.push(def); return () => released.push('type') } }, slots: { inject: (_name, install) => install(), register: (options, body) => { records.push({ options, body }); return () => released.push('body') } }, face: () => ({}), Body: 'Live' })
  assert.equal(records[0].kind, 'bot-live')
  assert.equal(records[0].guide, undefined, 'plain DSH guide has no team-only card')
  assert.equal(records[1].options.name, 'sidebar.right.pane.tab')
  assert.equal(records[1].options.key, records[0].id)
  assert.equal(records[1].body, 'Live')
  off(); assert.deepEqual(released, ['body', 'type'])
  let disposed = false
  assert.throws(() => installLiveTab({ tabs: { register: () => () => { disposed = true } }, slots: { inject: (_name, install) => install(), register: () => { throw Error('body failed') } }, Body: 'Live' }), /body failed/)
  assert.equal(disposed, true)
})

test('no on-screen Session installs no shadow, plain DSH withdraws all conversation gates', () => {
  const roster = source({ byId: {} })
  const mounted = source(undefined)
  let shadows = 0
  const groups = surfaceGroups({ shell: () => [], conversation: () => [() => installSimpleControls({ roster, sources: [mounted], sessionId: () => mounted.getSnapshot(), install: () => { shadows++; return () => { shadows-- } } })] })
  groups.reconcile(groupsFor({ mode: 'bot' })); assert.equal(shadows, 0)
  mounted.set('bot-before-roster'); assert.equal(shadows, 1)
  groups.reconcile(groupsFor({ mode: 'bot', plain: true })); assert.equal(shadows, 0)
  assert.equal(roster.listeners.size, 0)
  mounted.set('native'); roster.set({ byId: { 'bot-before-roster': { advanced: true } } })
  assert.equal(shadows, 0)
  groups.dispose()
})

test('Live unregister closes only its own tabs in their own Sessions before releasing body', () => {
  const calls = []
  const sidebar = { openTabs: source([{ sessionId: 'a', tabId: 'live-a', kind: 'bot-live' }, { sessionId: 'b', tabId: 'browser', kind: 'browser' }, { sessionId: 'old', tabId: 'live-old', kind: 'bot-live' }]), closeIn: (...args) => calls.push(args) }
  const off = installLiveTab({ tabs: { register: () => () => calls.push('type') }, slots: { inject: (_name, install) => install(), register: () => () => calls.push('body') }, sidebar, Body: 'Live' })
  off()
  assert.deepEqual(calls, [['a', 'live-a'], ['old', 'live-old'], 'body', 'type'])
})

test('plain navigation keeps Bot Live tabs registered without exposing a guide card', () => {
  const calls = []
  const groups = surfaceGroups({ shell: () => [() => installLiveTab({ tabs: { register: def => { assert.equal(def.guide, undefined); return () => calls.push('type') } }, slots: { inject: (_name, install) => install(), register: () => () => calls.push('body') }, sidebar: { openTabs: source([{ sessionId: 'bot', tabId: 'live', kind: 'bot-live' }]), closeIn: () => calls.push('close') }, Body: 'Live' })], conversation: () => [] })
  groups.reconcile(groupsFor({ mode: 'bot' }))
  groups.reconcile(groupsFor({ mode: 'bot', plain: true }))
  assert.deepEqual(calls, [])
  groups.reconcile(groupsFor({ mode: 'agent' }))
  assert.deepEqual(calls, ['close', 'body', 'type'])
})

test('plain Sessions cannot invoke the team Live action even when mounted and shown match', () => {
  let calls = 0
  const sidebar = { mounted: source('plain'), openTab: () => calls++, toggleExpanded: () => calls++ }
  const actions = sidebarActions({ sidebar: () => sidebar, shown: () => 'plain', teamSession: () => false, closePanel: () => calls++ })
  actions.openLive(); actions.toggleRightSidebar()
  assert.equal(calls, 0)
})

test('sidebar actions use native API, close competing drawer, and refuse stale navigation', () => {
  const calls = []; let mounted = 'a'
  const sidebar = { mounted: { getSnapshot: () => mounted }, openTab: kind => calls.push(kind), toggleExpanded: () => calls.push('toggle') }
  const actions = sidebarActions({ sidebar: () => sidebar, shown: () => 'a', teamSession: id => id === 'a', closePanel: () => calls.push('close'), reportError: error => calls.push(error.message) })
  actions.openLive(); actions.toggleRightSidebar()
  assert.deepEqual(calls, ['close', 'bot-live', 'close', 'toggle'])
  mounted = 'b'; actions.openLive()
  assert.equal(calls.length, 4)
})
