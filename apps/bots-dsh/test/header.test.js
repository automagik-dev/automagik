import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { headerNavigation, installHeaderNavigation } from '../src/client/header-navigation.js'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/header.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: initial => [initial, () => {}], useEffect: () => {}, useRef: current => ({ current }), useLayoutEffect: () => {}, useMemo: make => make(), useCallback: fn => fn, Fragment: 'fragment' },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { HeaderPill, NativeBotHeader, NativeControlsNote } = module.exports

const roster = { byId: { a: { id: 'a', name: 'Omni', sessionId: 'a' } }, roomsById: {}, bots: [], exchangeTurns: {}, questions: {} }
const hook = value => select => select(value)
const header = (actions, navigation = {}) => HeaderPill({
  sessionId: 'a',
  useRoster: hook(roster),
  useSessions: hook({ byId: {} }),
  useSessionStatus: hook(new Map()),
  useSession: hook({}),
  useActivity: hook({}),
  useMemoryNews: hook({}),
  useTurnClock: hook({}),
  useUi: hook({}),
  useLive: hook({}),
  actions,
  ...navigation,
})
const sideButton = (node) => {
  if (node === null || typeof node !== 'object') return null
  if (node.props?.['data-bt-right-sidebar'] !== undefined) return node
  for (const child of node.children ?? []) {
    const found = sideButton(child)
    if (found) return found
  }
  return null
}

test('the simple Bot header exposes a real native sidebar action, omitted without service', () => {
  let toggles = 0
  const button = sideButton(header({ hasRightSidebar: () => true, toggleRightSidebar: () => { toggles++ } }))
  assert.equal(button.props['aria-label'], 'Toggle right sidebar')
  button.props.onClick(); assert.equal(toggles, 1)
  assert.equal(sideButton(header({})), null)
  assert.equal(sideButton(header({ hasRightSidebar: () => true }, { native: true })), null)
})

test('native header contribution is opt-in per Bot and owns no native child slots', () => {
  const props = { sessionId: 'a', useRoster: hook(roster) }
  assert.equal(NativeBotHeader(props), null)
  const enabled = { ...roster, byId: { a: { id: 'canonical', advanced: true } } }
  const node = NativeBotHeader({ ...props, useRoster: hook(enabled) })
  assert.equal(node.type, HeaderPill)
  assert.equal(node.props.native, true)
  assert.equal(NativeBotHeader({ ...props, sessionId: 'plain', useRoster: hook(enabled) }), null)
})

test('Advanced native action contribution opens Live and canonical Bot settings without replacing native corner', () => {
  const calls = []
  const enabled = { ...roster, byId: { a: { id: 'canonical', name: 'Bot', advanced: true } } }
  const node = header({ hasRightSidebar: () => true, openLive: () => calls.push('live'), openSettings: (...args) => calls.push(args) }, { native: true, useRoster: hook(enabled) })
  const find = (node, label) => node?.props?.['aria-label'] === label ? node : (node?.children ?? []).map(child => find(child, label)).find(Boolean)
  find(node, 'Open Live').props.onClick()
  find(node, 'Bot settings').props.onClick()
  assert.deepEqual(calls, ['live', ['bots', 'canonical']])
  assert.equal(sideButton(node), null)
  assert.equal(node.props.className, 'bt-native-head', 'native header never gains the floating replacement marker')
})

test('Advanced explains model permission ownership and guarded compaction with actual settings actions', () => {
  const calls = []
  const node = NativeControlsNote({ sessionId: 'old', useRoster: hook({ byId: { old: { id: 'a', advanced: true } } }), actions: { openSettings: (...args) => calls.push(args) } })
  const buttons = node.children.flatMap(paragraph => paragraph.children.filter(child => child?.type === 'button'))
  assert.equal(buttons.length, 2)
  for (const button of buttons) button.props.onClick()
  assert.deepEqual(calls, [['bots', 'a'], ['bots', 'a']])
  assert.equal(NativeControlsNote({ sessionId: 'b', useRoster: hook(roster) }), null)
})

const byClass = (node, className) => {
  if (node === null || typeof node !== 'object') return null
  if (node.props?.className === className) return node
  for (const child of node.children ?? []) {
    const found = byClass(child, className)
    if (found) return found
  }
  return null
}

test('a Bot in another Conversation View can return to chat without changing its draft', () => {
  const state = { view: 'study-workspace', draft: 'Keep this draft', viewRequest: null }
  const views = [{ id: 'chat' }, { id: 'study-workspace' }]
  let details = 0
  const navigation = {
    useStore: hook(state), useConversationViews: hook(views),
    selectView: view => { state.view = view },
  }
  const actions = { toggleDetails: () => { details += 1 } }
  const away = header(actions, navigation)
  const pill = byClass(away, 'bt-pill')
  assert.equal(pill.props['aria-label'], 'Back to chat')
  assert.equal(pill.props['aria-expanded'], undefined)
  assert.equal(pill.props.title, 'Omni')
  assert.equal(byClass(away, 'bt-head-details'), null)
  pill.props.onClick()
  assert.equal(state.view, 'chat')
  assert.equal(state.draft, 'Keep this draft')
  assert.equal(details, 0)
  const restored = header(actions, navigation)
  assert.equal(byClass(restored, 'bt-pill'), null)
  byClass(restored, 'bt-head-details').props.onClick()
  assert.equal(details, 1)
})

test('the header does not repeat the open chat\'s name; a small button opens its details', () => {
  const views = [{ id: 'chat' }, { id: 'trajectory' }]
  for (const view of [null, 'chat', 'uninstalled-plugin']) {
    const head = header({}, { useStore: hook({ view }), useConversationViews: hook(views), selectView() {} })
    assert.equal(byClass(head, 'bt-pill'), null)
    assert.equal(byClass(head, 'bt-head-details').props['aria-label'], 'View conversation details')
  }
  const plain = header({})
  assert.equal(byClass(plain, 'bt-pill'), null)
  assert.equal(byClass(plain, 'bt-pill-name'), null)
  assert.equal(byClass(plain, 'bt-head-details').props['aria-expanded'], false)
})

test('the replacement header shares DSH\'s store and navigation injection without declaring its children again', () => {
  const store = {}
  const views = { getSnapshot: () => [{ id: 'chat' }] }
  const roster = {}
  const picked = []
  const bound = { setView: view => picked.push(view) }
  const source = { options: {},
    store,
    children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    inject: (sessionId, actions) => ({ hooks: { conversationViews: views }, selectView: view => { assert.equal(sessionId, 'a'); actions.setView(view) } }),
  }
  const own = { actions: { openMemory() {} }, hooks: { roster } }
  const options = headerNavigation([{ options: {} }, source], () => own)
  assert.equal(options.store, store)
  assert.equal(options.children, undefined)
  const injected = options.inject('a', bound)
  assert.equal(injected.hooks.conversationViews, views)
  assert.equal(injected.hooks.roster, roster)
  assert.equal(injected.actions, own.actions)
  injected.selectView('chat')
  assert.deepEqual(picked, ['chat'])
  const absent = headerNavigation([], () => own)
  assert.equal(absent.store, undefined)
  assert.deepEqual(absent.inject('a'), own)
})

test('the Bot header follows a later host header registration and releases its subscription', () => {
  const entries = []
  const listeners = new Set()
  let registrations = 0
  const slots = {
    entries: () => entries,
    subscribe: (_name, listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    register: ({ priority, store, inject }, component) => {
      registrations += 1
      const entry = { options: { priority }, store, inject, component }
      entries.push(entry)
      return () => { const at = entries.indexOf(entry); if (at !== -1) entries.splice(at, 1) }
    },
  }
  const changed = () => { for (const listener of listeners) listener() }
  const own = { hooks: {}, actions: {} }
  const stop = installHeaderNavigation(slots, () => own, HeaderPill, -100)
  assert.equal(entries[0].store, undefined)
  const store = {}
  const host = { options: { priority: 0 }, component() {}, store, inject: () => ({ selectView() {} }) }
  entries.push(host)
  changed()
  assert.equal(entries.find(entry => entry.component === HeaderPill).store, store)
  assert.equal(registrations, 2)
  changed()
  assert.equal(registrations, 2, 'the replacement does not react to its own registration')
  entries.splice(entries.indexOf(host), 1)
  changed()
  assert.equal(entries[0].store, undefined, 'a removed host releases its old navigation face')
  stop()
  assert.equal(entries.length, 0)
  assert.equal(listeners.size, 0)
})
