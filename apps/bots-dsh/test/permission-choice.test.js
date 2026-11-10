// The explained permission choice: the list in Details, the card in a Bot's chat and the lines
// under the segmented picker, rendered with the React DSH ships in jsdom. The options are the
// host catalog's, in its order: three in the common install, four while Auto review is offered.
// Only a press by the person saves a level, through actions.updateBot.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const harness = process.env.DSH_HARNESS
const require = createRequire(join(harness, 'package.json'))
const { JSDOM } = require('jsdom')
const assets = join(harness, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const frontend = readFileSync(join(assets, readdirSync(assets).find(name => /^index-.*\.js$/.test(name))), 'utf8')
const seed = /function (\w+)\(\)\{return\{react:[\s\S]*?\}\}/.exec(frontend)
assert.ok(seed, 'the declared native harness supplies its React seed factory')
const seedsBuild = await build({ stdin: { contents: `${frontend.slice(0, seed.index + seed[0].length)}; globalThis.nativeSeeds = ${seed[1]}();`, resolveDir: assets }, bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' })
const seedDom = new JSDOM('<!doctype html><html><body></body></html>')
const seedContext = { window: seedDom.window, document: seedDom.window.document, navigator: seedDom.window.navigator, MutationObserver: seedDom.window.MutationObserver, fetch: async () => { throw new Error('seed bootstrap must not fetch') }, console, setTimeout, clearTimeout, performance, TextEncoder, TextDecoder }
runInNewContext(seedsBuild.outputFiles[0].text, seedContext)
const nativeRequire = name => seedContext.nativeSeeds[name] ?? require(name)
const React = nativeRequire('react')
const { createRoot } = nativeRequire('react-dom/client')
const { flushSync } = nativeRequire('react-dom')
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
const act = async (fn = () => {}) => { flushSync(fn); await tick() }
const { outputFiles } = await build({
  stdin: { contents: [
    "export { PermissionPicker, PermissionList, PermissionExplanations, presetText } from './src/client/permission-picker.js'",
    "export { PermissionChoiceDock, reopenPermissionChoice } from './src/client/permission-card.js'",
    "export { BotPanel } from './src/client/browser-pane.js'",
    "export { GroupSettingsForm } from './src/client/group-settings.js'",
    "export { indexRoster } from './src/client/sources.js'",
    "export { STORAGE } from './src/client/storage.js'",
  ].join('\n'), resolveDir: plugin },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

const READ = { value: 'read-only', name: 'Read only', description: 'dsh read' }
const WORK = { value: 'workspace-write', name: 'Workspace', description: 'dsh workspace' }
const AUTO = { value: 'auto', name: 'Auto review', description: 'dsh auto' }
const FULL = { value: 'danger-full-access', name: 'Full access', description: 'dsh full' }
// The owner's install: three levels, read-only by default.
const THREE = { options: [READ, WORK, FULL], defaultPreset: 'read-only' }
// While DSH's Auto review layer is loaded, in DSH's order.
const FOUR = { options: [READ, WORK, AUTO, FULL], defaultPreset: 'workspace-write' }
const TEXT = {
  'read-only': 'It cannot change files unless you allow that one action. It can still run commands and use the network and its other tools.',
  'workspace-write': 'Changes files inside its folder and a temporary folder without asking. For other files it asks you first. It can still run commands and use the network and its other tools.',
  auto: 'A model reviews each action first. You are asked only about the ones it stops. The rest run with full access, and it can let a wrong one through.',
  'danger-full-access': 'Runs commands and changes files anywhere without asking you. Choose it only when you trust what you asked for.',
}

function mount(t) {
  const dom = new JSDOM('<body><div id="mount"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.innerWidth = 1200
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, require: name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownText: () => null } : nativeRequire(name),
    window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, matchMedia: window.matchMedia, ResizeObserver: window.ResizeObserver,
    MutationObserver: window.MutationObserver, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement, HTMLSelectElement: window.HTMLSelectElement,
    CSS: { escape: name => name }, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval, console, performance, URL,
  })
  const root = createRoot(window.document.querySelector('#mount'))
  t.after(async () => { try { await act(() => root.unmount()) } catch {} dom.window.close() })
  const click = async (node, init = {}) => { assert.ok(node, 'the control to press is on the page'); await act(() => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init }))) }
  const key = async name => act(() => { (window.document.activeElement ?? window.document.body).dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })
  return { window, document: window.document, root, click, key, ...module.exports }
}

// Saves through updateBot only; every other action a component reaches for does nothing.
function recorder({ fail, hold } = {}) {
  const saves = []
  const other = []
  // `hold` keeps each save open until the test settles it (`held`).
  const held = []
  const actions = new Proxy({
    updateBot: (id, patch) => {
      saves.push(JSON.parse(JSON.stringify({ id, patch })))
      if (hold) return new Promise((resolve) => { held.push(resolve) })
      return fail ? Promise.reject(new Error(fail)) : Promise.resolve({})
    },
  }, { get: (known, name) => known[name] ?? ((...args) => { other.push([name, args]); return Promise.resolve() }) })
  return { saves, other, held, actions }
}
const rows = scope => [...scope.querySelectorAll('.bt-q-list .bt-q-opt')]
const rowOf = (scope, value) => scope.querySelector(`.bt-q-opt[data-permission="${value}"]`)
const button = (scope, label) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === label)
const hook = value => select => select(value)
const BOT = { id: 'omni', name: 'Omni', sessionId: 'omni', model: 'deepseek/v3' }
const teamOf = (indexRoster, { bot = BOT, catalog = THREE, readOnly, rooms = [] } = {}) => ({
  ...indexRoster({ bots: [bot], rooms }), permissions: catalog, models: [{ ref: 'deepseek/v3', id: 'v3' }], exchangeTurns: {}, questions: {}, sideChats: {}, memory: false, prefs: {},
  ...(readOnly ? { readOnly } : {}),
})

// --- the list (Details) ------------------------------------------------------------

for (const [label, catalog] of [['three', THREE], ['four', FOUR]]) {
  test(`the list shows exactly the ${label} levels the catalog offers, in its order, each explained`, async (t) => {
    const { document, root, PermissionList } = mount(t)
    await act(() => root.render(React.createElement(PermissionList, { catalog, saved: catalog.defaultPreset, onPick: async () => true })))
    assert.deepEqual(rows(document).map(row => row.dataset.permission), catalog.options.map(option => option.value))
    for (const option of catalog.options) {
      const row = rowOf(document, option.value)
      assert.equal(row.querySelector('.bt-q-label').firstChild.textContent, option.name)
      assert.equal(row.querySelector('.bt-q-desc').textContent, TEXT[option.value], 'our words, not the catalog description')
      assert.equal(row.getAttribute('aria-pressed'), String(option.value === catalog.defaultPreset))
      assert.equal(row.querySelector('.bt-q-check') !== null, option.value === catalog.defaultPreset, 'only the current level carries the check')
      const danger = option.value === 'danger-full-access'
      assert.equal(row.querySelector('.bt-q-label').classList.contains('bt-danger'), danger)
      assert.equal(row.querySelector('.bt-q-desc').classList.contains('bt-danger'), danger)
      assert.equal(row.querySelector('.bt-perm-exp') !== null, option.value === 'auto', 'only Auto review is marked experimental')
    }
    assert.equal(document.querySelector('.bt-key'), null, 'no letter keys')
  })
}

test('a level the app does not know shows its name and what the catalog says, or nothing', async (t) => {
  const { document, root, PermissionList, presetText } = mount(t)
  const catalog = { options: [READ, { value: 'team-custom', name: 'Careful', description: 'Asks about deploys.' }, { value: 'bare' }], defaultPreset: 'read-only' }
  await act(() => root.render(React.createElement(PermissionList, { catalog, saved: 'read-only', onPick: async () => true })))
  assert.equal(rowOf(document, 'team-custom').querySelector('.bt-q-label').textContent, 'Careful')
  assert.equal(rowOf(document, 'team-custom').querySelector('.bt-q-desc').textContent, 'Asks about deploys.')
  assert.equal(rowOf(document, 'bare').querySelector('.bt-q-label').textContent, 'bare')
  assert.equal(rowOf(document, 'bare').querySelector('.bt-q-desc'), null, 'no explanation is made up')
  assert.equal(presetText('bare', catalog), '')
  assert.equal(presetText('constructor', catalog), '', 'an inherited name is not a level')
})

test('a press on a row saves that level once; Full access asks first and Cancel sends nothing', async (t) => {
  const { document, root, click, PermissionList } = mount(t)
  const picks = []
  let saved = 'read-only'
  const render = () => root.render(React.createElement(PermissionList, { catalog: THREE, saved, onPick: async (value) => { picks.push(value); return true } }))
  await act(render)
  await click(rowOf(document, 'workspace-write'))
  assert.deepEqual(picks, ['workspace-write'])
  saved = 'workspace-write'
  await act(render)
  await click(rowOf(document, 'workspace-write'))
  assert.deepEqual(picks, ['workspace-write'], 'the level already saved is not sent again')

  await click(rowOf(document, 'danger-full-access'))
  assert.deepEqual(picks, ['workspace-write'], 'Full access is not sent by the first press')
  assert.equal(rowOf(document, 'danger-full-access').getAttribute('aria-pressed'), 'false', 'and is not shown as chosen')
  const confirm = document.querySelector('.bt-perm-confirm')
  assert.equal(confirm.getAttribute('role'), 'alert')
  assert.match(confirm.textContent, /Runs commands and changes files anywhere without asking you\./)
  assert.ok(confirm.querySelector('.bt-danger'), 'the warning is in the danger ink')
  await click(button(confirm, 'Cancel'))
  assert.equal(document.querySelector('.bt-perm-confirm'), null)
  assert.deepEqual(picks, ['workspace-write'])

  await click(rowOf(document, 'danger-full-access'))
  await click(button(document.querySelector('.bt-perm-confirm'), 'Give full access'))
  assert.deepEqual(picks, ['workspace-write', 'danger-full-access'])
  assert.equal(document.querySelector('.bt-perm-confirm'), null)
})

test('Auto review keeps its own question in the list', async (t) => {
  const { document, root, click, PermissionList } = mount(t)
  const picks = []
  await act(() => root.render(React.createElement(PermissionList, { catalog: FOUR, saved: 'workspace-write', onPick: async (value) => { picks.push(value); return true } })))
  await click(rowOf(document, 'auto'))
  assert.deepEqual(picks, [])
  assert.match(document.querySelector('.bt-perm-confirm').textContent, /Auto review runs tools without a sandbox/)
  await click(button(document, 'Use Auto review'))
  assert.deepEqual(picks, ['auto'])
})

test('a Bot with no level of its own: the default is marked and a press on it still saves it', async (t) => {
  const { document, root, click, PermissionList } = mount(t)
  const picks = []
  await act(() => root.render(React.createElement(PermissionList, { catalog: THREE, saved: 'read-only', repick: true, onPick: async (value) => { picks.push(value); return true } })))
  assert.equal(rowOf(document, 'read-only').getAttribute('aria-pressed'), 'true')
  await click(rowOf(document, 'read-only'))
  assert.deepEqual(picks, ['read-only'])
})

test('a list that is disabled has no live row and never saves', async (t) => {
  const { document, root, PermissionList, window } = mount(t)
  const picks = []
  await act(() => root.render(React.createElement(PermissionList, { catalog: FOUR, saved: 'workspace-write', disabled: true, onPick: async (value) => { picks.push(value); return true } })))
  assert.equal(rows(document).length, 4)
  for (const row of rows(document)) {
    assert.equal(row.disabled, true)
    row.click()
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  }
  await act()
  assert.deepEqual(picks, [])
  assert.equal(document.querySelector('.bt-perm-confirm'), null)
})

// --- the segmented picker (Settings, group settings) ----------------------------------

test('the segmented picker is as it was unless asked to confirm Full access', async (t) => {
  const { document, root, click, PermissionPicker } = mount(t)
  const picks = []
  const onPick = async (value) => { picks.push(value); return true }
  await act(() => root.render(React.createElement(PermissionPicker, { catalog: THREE, saved: 'read-only', onPick })))
  await click(button(document, 'Full access'))
  assert.deepEqual(picks, ['danger-full-access'], 'without confirmFull the pick is sent at once, as before')
  await act(() => root.render(null))

  picks.length = 0
  await act(() => root.render(React.createElement(PermissionPicker, { key: 'asks', catalog: THREE, saved: 'read-only', confirmFull: true, onPick })))
  await click(button(document, 'Full access'))
  assert.deepEqual(picks, [])
  assert.equal(button(document, 'Full access').getAttribute('aria-pressed'), 'false')
  await click(button(document, 'Workspace'))
  assert.deepEqual(picks, ['workspace-write'], 'another pick goes as before')
  assert.equal(document.querySelector('.bt-perm-confirm'), null, 'and drops the open question')
  await click(button(document, 'Full access'))
  await click(button(document, 'Give full access'))
  assert.deepEqual(picks, ['workspace-write', 'danger-full-access'])
})

for (const [label, catalog] of [['three', THREE], ['four', FOUR]]) {
  test(`the lines under a segmented picker explain all ${label} levels`, async (t) => {
    const { document, root, PermissionExplanations } = mount(t)
    await act(() => root.render(React.createElement(PermissionExplanations, { catalog })))
    const lines = [...document.querySelectorAll('.bt-note')].map(line => line.textContent)
    assert.deepEqual(lines, catalog.options.map(option => `${option.name}: ${TEXT[option.value]}`))
    assert.equal(document.querySelectorAll('.bt-danger').length, 1)
    assert.equal(document.querySelector('.bt-danger').textContent, 'Full access')
    assert.equal(document.querySelector('button'), null, 'the lines are text only')
  })
}

test('a group\'s shared level asks before Full access and explains every level', async (t) => {
  const { document, root, click, GroupSettingsForm, indexRoster } = mount(t)
  const room = { id: 'group', name: 'Team', members: ['omni'], permission: 'read-only' }
  const roster = teamOf(indexRoster, { rooms: [room] })
  const { actions, other } = recorder()
  await act(() => root.render(React.createElement(GroupSettingsForm, { room, roster, actions, run: promise => Promise.resolve(promise).then(() => true, () => false), onClose() {} })))
  const section = document.querySelector('.bt-gs-perm')
  assert.ok(section, 'the group keeps its segmented picker')
  assert.equal([...section.querySelectorAll('.bt-note')].filter(line => Object.values(TEXT).some(text => line.textContent.endsWith(text))).length, 3)
  const sent = () => other.filter(([, args]) => args.some(arg => arg && typeof arg === 'object' && 'permission' in arg))
  await click(button(section, 'Full access'))
  assert.deepEqual(sent(), [], 'Full access for the whole group is asked about first')
  await click(button(section, 'Cancel'))
  assert.deepEqual(sent(), [])
})

// --- Details --------------------------------------------------------------------------

const panelProps = { useSessions: hook({ byId: {} }), useSessionStatus: hook(new Map()), useActivity: hook({}), useWork: hook({}), useBrowserTabs: hook({}), useBrowserPages: hook({}) }

test('Details lists every level explained and saves a press through updateBot', async (t) => {
  const { document, root, click, BotPanel, indexRoster } = mount(t)
  const { actions, saves } = recorder()
  await act(() => root.render(React.createElement(BotPanel, { pane: { id: 'omni', view: 'details' }, leaving: false, roster: teamOf(indexRoster), actions, ...panelProps })))
  const section = document.querySelector('.bt-drawer-permission')
  assert.equal(section.querySelector('.bt-seg'), null, 'the segmented picker is gone from Details')
  assert.deepEqual(rows(section).map(row => row.dataset.permission), ['read-only', 'workspace-write', 'danger-full-access'])
  assert.deepEqual(rows(section).map(row => row.querySelector('.bt-q-desc').textContent), [TEXT['read-only'], TEXT['workspace-write'], TEXT['danger-full-access']])
  assert.equal(rowOf(section, 'read-only').getAttribute('aria-pressed'), 'true', 'the default the Bot runs at is marked')
  assert.deepEqual(saves, [], 'opening Details saves nothing')
  await click(rowOf(section, 'workspace-write'))
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'workspace-write' } }])
  await click(rowOf(section, 'danger-full-access'))
  assert.equal(saves.length, 1, 'Full access waits for its question')
  await click(button(section, 'Give full access'))
  assert.deepEqual(saves[1], { id: 'omni', patch: { permission: 'danger-full-access' } })
})

test('Details in a window that can only view the team has no live permission control', async (t) => {
  const { document, root, BotPanel, indexRoster } = mount(t)
  const { actions, saves } = recorder()
  await act(() => root.render(React.createElement(BotPanel, { pane: { id: 'omni', view: 'details' }, leaving: false, roster: teamOf(indexRoster, { catalog: FOUR, readOnly: 'This window can only view the team' }), actions, ...panelProps })))
  const section = document.querySelector('.bt-drawer-permission')
  assert.equal(rows(section).length, 4, 'the levels are still explained')
  assert.deepEqual([...section.querySelectorAll('button')].filter(node => !node.disabled), [], 'no button there can be pressed')
  for (const row of rows(section)) row.click()
  await act()
  assert.deepEqual(saves, [])
})

test('a group\'s level in Details carries its explanation', async (t) => {
  const { document, root, BotPanel, indexRoster } = mount(t)
  const room = { id: 'group', name: 'Team', members: ['omni'], permission: 'danger-full-access' }
  const { actions } = recorder()
  await act(() => root.render(React.createElement(BotPanel, { pane: { id: 'group', view: 'details' }, leaving: false, roster: teamOf(indexRoster, { rooms: [room] }), actions, ...panelProps })))
  assert.ok([...document.querySelectorAll('.bt-note')].some(line => line.textContent === TEXT['danger-full-access']))
})

// --- the card in the chat ---------------------------------------------------------------

const card = document => document.querySelector('form.bt-q')
function dock(t, options = {}) {
  const page = mount(t)
  const calls = recorder(options)
  let roster = teamOf(page.indexRoster, options)
  const render = () => page.root.render(React.createElement(page.PermissionChoiceDock, { sessionId: options.sessionId ?? 'omni', useRoster: select => select(roster), actions: calls.actions }))
  const setBot = async (bot) => { roster = teamOf(page.indexRoster, { ...options, bot }); await act(render) }
  const setTeam = async (patch) => { roster = { ...teamOf(page.indexRoster, { ...options, ...patch }), ...(patch.extra ?? {}) }; await act(render) }
  return { ...page, ...calls, render, setBot, setTeam }
}

for (const [label, catalog] of [['three', THREE], ['four', FOUR]]) {
  test(`the card lists the ${label} levels of the catalog with every explanation at once`, async (t) => {
    const { document, render, saves, other } = dock(t, { catalog })
    await act(render)
    const form = card(document)
    assert.ok(form, 'a Bot with no level chosen gets the card')
    assert.equal(form.querySelector('.bt-q-title').textContent, 'Permissions · What may Omni do on its own?')
    assert.equal(form.querySelector('.bt-q-detail').textContent, 'You choose. Nothing changes until you save.')
    assert.deepEqual(rows(form).map(row => row.dataset.permission), catalog.options.map(option => option.value))
    assert.deepEqual(rows(form).map(row => row.querySelector('.bt-q-desc').textContent), catalog.options.map(option => TEXT[option.value]))
    assert.equal(rowOf(form, catalog.defaultPreset).getAttribute('aria-pressed'), 'true', 'the level in force is the one marked')
    assert.equal(form.querySelectorAll('.bt-q-opt[aria-pressed="true"]').length, 1)
    assert.ok(rowOf(form, 'danger-full-access').querySelector('.bt-q-desc.bt-danger'))
    assert.match(form.textContent, /You can change this any time in Details\./)
    assert.ok(button(form, 'Not now') && button(form, 'Save'))
    assert.deepEqual(saves, [], 'showing the card saves nothing')
    assert.deepEqual(other, [], 'and calls nothing else')
  })
}

test('picking a row only marks it; Save sends that level once', async (t) => {
  const { document, render, click, saves, setBot } = dock(t)
  await act(render)
  await click(rowOf(document, 'workspace-write'))
  assert.equal(rowOf(document, 'workspace-write').getAttribute('aria-pressed'), 'true')
  assert.deepEqual(saves, [], 'a marked row is not a saved level')
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'workspace-write' } }])
  await setBot({ ...BOT, permission: 'workspace-write' })
  assert.equal(card(document), null, 'the card leaves once the level is saved')
})

test('Save with nothing picked keeps the level in force, never a wider one', async (t) => {
  const { document, render, click, saves } = dock(t)
  await act(render)
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'read-only' } }])
})

test('Not now and Dismiss send nothing and the card does not come back on its own', async (t) => {
  for (const label of ['Not now', 'Dismiss']) {
    const { document, render, click, saves, other, window, STORAGE } = dock(t)
    await act(render)
    await click(rowOf(document, 'danger-full-access'))
    await click(label === 'Dismiss' ? card(document).querySelector('.bt-q-x') : button(card(document), label))
    assert.equal(card(document), null)
    assert.deepEqual(saves, [], `${label} saves no level, even with Full access marked`)
    assert.deepEqual(other, [])
    assert.deepEqual(JSON.parse(window.localStorage.getItem(STORAGE.permissionAsked)), { omni: true })
    await act(render)
    assert.equal(card(document), null)
  }
})

test('Full access from the card asks once more, and a double click on Save cannot answer it', async (t) => {
  const { document, render, click, saves } = dock(t)
  await act(render)
  await click(rowOf(document, 'danger-full-access'))
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [], 'Save does not send Full access')
  const form = card(document)
  assert.equal(form.getAttribute('role'), 'alert')
  assert.equal(form.querySelector('.bt-q-title').textContent, 'Give Omni full access?')
  assert.equal(form.querySelector('.bt-q-detail .bt-danger').textContent, 'Omni will run commands and change files anywhere without asking you first.')
  assert.match(form.textContent, /Choose it only when you trust what you asked for\./)
  await click(button(form, 'Give full access'), { detail: 2 })
  assert.deepEqual(saves, [], 'the second press of a double click is not an answer')
  await click(button(form, 'Cancel'))
  assert.deepEqual(saves, [])
  assert.equal(rowOf(document, 'danger-full-access').getAttribute('aria-pressed'), 'true', 'back on the list, the row is still only marked')
  await click(button(card(document), 'Save'))
  await click(button(card(document), 'Give full access'))
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'danger-full-access' } }])
})

test('Auto review from the card asks with its own warning', async (t) => {
  const { document, render, click, saves } = dock(t, { catalog: FOUR })
  await act(render)
  await click(rowOf(document, 'auto'))
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [])
  assert.match(card(document).textContent, /Auto review runs tools without a sandbox/)
  await click(button(card(document), 'Use Auto review'))
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'auto' } }])
})

test('keys and time never answer the card', async (t) => {
  const { document, render, key, saves, other, window } = dock(t, { catalog: FOUR })
  await act(render)
  for (const name of ['a', 'b', 'c', 'd', 'A', 'D', '1', '4', 'Enter', ' ', 'Escape', 'y']) await key(name)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(rowOf(document, 'workspace-write').getAttribute('aria-pressed'), 'true', 'the mark did not move')
  assert.ok(card(document), 'the card is still there')
  assert.deepEqual(saves, [])
  assert.deepEqual(other, [])
  assert.equal(window.localStorage.length, 0)
})

test('a refused save says why, keeps the card and sends nothing more', async (t) => {
  const { document, render, click, saves } = dock(t, { fail: 'Only the user can do that' })
  await act(render)
  await click(rowOf(document, 'workspace-write'))
  await click(button(card(document), 'Save'))
  assert.equal(saves.length, 1)
  assert.equal(card(document).querySelector('[role="alert"]').textContent, 'Only the user can do that')
  assert.equal(rowOf(document, 'workspace-write').getAttribute('aria-pressed'), 'true')
})

test('no card: a level already chosen, a view-only window, no catalog, no model, an earlier part, a group', async (t) => {
  const cases = {
    'a Bot with its own level': { bot: { ...BOT, permission: 'workspace-write' } },
    'a window that can only view the team': { readOnly: 'This window can only view the team' },
    'a DSH with no presets': { catalog: null },
    'an empty catalog': { catalog: { options: [] } },
    'a Bot still waiting for its model': { bot: { id: 'omni', name: 'Omni', sessionId: 'omni' } },
    'an earlier part of the chat': { bot: { ...BOT, sessionId: 'part-2', parts: ['omni', 'part-2'] } },
    'a Session that is no Bot chat': { sessionId: 'group-session' },
  }
  for (const [label, options] of Object.entries(cases)) {
    const { document, render, saves } = dock(t, options)
    await act(render)
    assert.equal(card(document), null, label)
    assert.deepEqual(saves, [], label)
  }
})

test('Details opens the card again, for a Bot that already has a level too; closing it changes nothing', async (t) => {
  const { document, render, click, saves, reopenPermissionChoice } = dock(t, { bot: { ...BOT, permission: 'workspace-write' }, catalog: FOUR })
  await act(render)
  assert.equal(card(document), null)
  await act(() => reopenPermissionChoice('omni'))
  assert.equal(rowOf(card(document), 'workspace-write').getAttribute('aria-pressed'), 'true', 'the saved level is the one marked')
  await click(button(card(document), 'Not now'))
  assert.equal(card(document), null)
  assert.deepEqual(saves, [])
  await act(() => reopenPermissionChoice('omni'))
  await click(rowOf(card(document), 'read-only'))
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'read-only' } }])
  assert.equal(card(document), null)
})

test('a view-only window shows no card even when it was opened again', async (t) => {
  const { document, render, reopenPermissionChoice } = dock(t, { readOnly: 'This window can only view the team' })
  await act(() => reopenPermissionChoice('omni'))
  await act(render)
  assert.equal(card(document), null)
})

test('the mark follows a level saved elsewhere until the person picks one', async (t) => {
  const { document, render, click, setBot, reopenPermissionChoice } = dock(t, { bot: { ...BOT, permission: 'workspace-write' } })
  await act(() => reopenPermissionChoice('omni'))
  await act(render)
  await setBot({ ...BOT, permission: 'read-only' })
  assert.equal(rowOf(card(document), 'read-only').getAttribute('aria-pressed'), 'true')
  await click(rowOf(card(document), 'workspace-write'))
  await setBot({ ...BOT, permission: 'danger-full-access' })
  assert.equal(rowOf(card(document), 'workspace-write').getAttribute('aria-pressed'), 'true', 'the person\'s own pick is kept')
})

test('Save with nothing picked on a Bot that has a level sends nothing, so a level narrowed elsewhere stays', async (t) => {
  const { document, render, click, saves, setBot, reopenPermissionChoice } = dock(t, { bot: { ...BOT, permission: 'danger-full-access' } })
  await act(() => reopenPermissionChoice('omni'))
  await act(render)
  await setBot({ ...BOT, permission: 'read-only' })
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [], 'neither the old wider level nor a repeat of the saved one is sent')
  assert.equal(card(document), null)
})

test('a second Save while the first is still open sends nothing more', async (t) => {
  const { document, render, click, saves, held } = dock(t, { hold: true })
  await act(render)
  await click(rowOf(document, 'workspace-write'))
  const save = button(card(document), 'Save')
  await click(save)
  assert.equal(save.disabled, true, 'Save waits for the answer')
  await click(save)
  card(document).dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }))
  await act()
  assert.deepEqual(saves, [{ id: 'omni', patch: { permission: 'workspace-write' } }])
  held[0]({})
  await act()
})

test('the question in the card ends when DSH stops offering the level it asked about', async (t) => {
  const { document, render, click, saves, setTeam } = dock(t, { catalog: FOUR })
  await act(render)
  await click(rowOf(document, 'auto'))
  await click(button(card(document), 'Save'))
  assert.ok(button(card(document), 'Use Auto review'))
  await setTeam({ catalog: THREE })
  assert.equal(button(card(document), 'Use Auto review'), undefined, 'no button is left to give a level that is gone')
  assert.deepEqual(rows(card(document)).map(row => row.dataset.permission), ['read-only', 'workspace-write', 'danger-full-access'])
  assert.equal(button(card(document), 'Save').disabled, true, 'nothing offered is marked, so there is nothing to save')
  await click(button(card(document), 'Save'))
  assert.deepEqual(saves, [])
})

test('the question in the card is for one level: marking another row drops it', async (t) => {
  const { document, render, click, saves, setBot, reopenPermissionChoice } = dock(t, { bot: { ...BOT, permission: 'read-only' }, catalog: FOUR })
  await act(() => reopenPermissionChoice('omni'))
  await act(render)
  await click(rowOf(document, 'danger-full-access'))
  await click(button(card(document), 'Save'))
  assert.ok(button(card(document), 'Give full access'))
  await setBot({ ...BOT, permission: 'workspace-write' })
  assert.ok(button(card(document), 'Give full access'), 'the person\'s own pick is still the one asked about')
  await click(button(card(document), 'Cancel'))
  await click(rowOf(document, 'auto'))
  assert.equal(button(card(document), 'Give full access'), undefined)
  assert.equal(button(card(document), 'Use Auto review'), undefined, 'a newly marked level is asked about only after Save')
  assert.deepEqual(saves, [])
})

test('the question in the card puts focus on Cancel, never on the button that gives access', async (t) => {
  const { document, render, click } = dock(t)
  await act(render)
  await click(rowOf(document, 'danger-full-access'))
  await click(button(card(document), 'Save'))
  assert.equal(document.activeElement, button(card(document), 'Cancel'))
})

test('a Bot whose plugin runs its own engine gets no card', async (t) => {
  const { document, render, setTeam, saves } = dock(t)
  await setTeam({ extra: { hostModels: { omni: { id: 'own' } } } })
  assert.equal(card(document), null)
  assert.deepEqual(saves, [])
  await act(render)
})

test('in the list, Full access confirmed while another save is open waits its turn and is sent once', async (t) => {
  const { document, root, click, PermissionList } = mount(t)
  const open = []
  let saved = 'read-only'
  const render = () => root.render(React.createElement(PermissionList, { catalog: THREE, saved, onPick: value => new Promise((resolve) => { open.push({ value, resolve }) }) }))
  await act(render)
  await click(rowOf(document, 'workspace-write'))
  await click(rowOf(document, 'danger-full-access'))
  assert.deepEqual(open.map(entry => entry.value), ['workspace-write'], 'the unanswered question queues nothing')
  await click(button(document, 'Give full access'))
  assert.deepEqual(open.map(entry => entry.value), ['workspace-write'], 'one save at a time')
  open[0].resolve(true)
  saved = 'workspace-write'
  await act(render)
  assert.deepEqual(open.map(entry => entry.value), ['workspace-write', 'danger-full-access'])
  open[1].resolve(true)
  saved = 'danger-full-access'
  await act(render)
  assert.equal(open.length, 2)
  assert.equal(rowOf(document, 'danger-full-access').getAttribute('aria-pressed'), 'true')
})
