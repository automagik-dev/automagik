// The power shortcut in the Bot team's sidebar (src/client/power-shortcut.js), the power store it
// shares with the team step (src/client/power-store.js), and the team step opened on purpose.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/client/power-shortcut.js'",
      "export * from './src/client/power-store.js'",
      "export { TeamStep, explicitOf, powerLocked, powerOff, POLL_MS } from './src/client/team.js'",
    ].join('\n'),
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@automagik/bots-dsh/client'],
  loader: { '.css': 'text' },
})

// A small hook runtime: state, refs and effects keep their slots across renders, so a component
// runs as it would mounted; effects run after each render when their dependencies changed.
let slots = []
let at = 0
let pending = []
const changed = (before, deps) => !before || !deps || deps.length !== before.length || deps.some((dep, i) => !Object.is(dep, before[i]))
const effect = (run, deps) => {
  const slot = at++
  if (changed(slots[slot], deps)) {
    slots[slot] = deps ?? null
    pending.push(run)
  }
}
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'Fragment',
  useState(initial) {
    const slot = at++
    if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
    return [slots[slot], (value) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value }]
  },
  useRef(current) {
    const slot = at++
    if (!(slot in slots)) slots[slot] = { current }
    return slots[slot]
  },
  useEffect: effect,
  useLayoutEffect: effect,
  useCallback: fn => fn,
  useMemo: make => make(),
  useId: () => 'power-card',
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}
const fetched = []
let answers = {}
const fetchStub = async (_route, init) => {
  const { endpoint, payload } = JSON.parse(init.body)
  fetched.push({ endpoint, payload })
  const value = typeof answers[endpoint] === 'function' ? answers[endpoint](payload) : answers[endpoint] ?? {}
  return { ok: true, json: async () => ({ ok: true, value }) }
}
const storage = new Map()
const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
const client = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module: client, exports: client.exports, URL, setTimeout, clearTimeout, AbortController, Promise, JSON,
  fetch: fetchStub, sessionStorage, matchMedia: () => ({ matches: true }),
  require: name => ({ react, 'react-dom': { createPortal: node => node } })[name],
})
const shortcut = client.exports

function mount(Component, props) {
  slots = []
  const render = () => {
    at = 0
    pending = []
    const tree = Component(props)
    for (const run of pending) run()
    return tree
  }
  return { render }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
function findAll(node, match, out = []) {
  if (Array.isArray(node)) node.forEach(child => findAll(child, match, out))
  else if (node && typeof node === 'object') {
    if (match(node)) out.push(node)
    for (const child of node.children ?? []) findAll(child, match, out)
  }
  return out
}

const OMNI_BOT = { id: 'omni', kind: 'omni', name: 'Omni' }
const GENIE_BOT = { id: 'genie', kind: 'genie', name: 'Genie' }
const plain = value => JSON.parse(JSON.stringify(value))
const row = (kind, phase, context, detail = null) => shortcut.powerRow(kind, { phase, detail }, context)

test('each product\'s row follows the plan\'s state table', () => {
  const linked = { bots: [OMNI_BOT, GENIE_BOT], omniLinked: true }
  // On: Omni linked with its Bot, Genie with a Bot of its kind; the action powers it off. No Open
  // beside it: the Bot sits in the sidebar already.
  const omniOn = row('omni', 'asleep', { roster: linked })
  assert.deepEqual([omniOn.state, omniOn.action, omniOn.pressed, omniOn.locked, omniOn.secondary], ['on', 'off', true, false, null])
  assert.equal(shortcut.actionLabel(omniOn), 'Power Omni off')
  assert.equal(shortcut.secondaryLabel(omniOn), null)
  assert.equal(row('genie', 'asleep', { roster: linked }).secondary, null)
  assert.equal(omniOn.text, 'On · Connected')
  assert.equal(row('omni', 'linked', { roster: linked }, { origin: 'omni.example.com' }).text, 'On · Connected to omni.example.com')
  // Genie, once on the team, stays (the team step's box holds its power too): off shows held, and why.
  const genieOn = row('genie', 'asleep', { roster: linked })
  assert.deepEqual([genieOn.state, genieOn.text, genieOn.action, genieOn.locked, genieOn.note], ['on', 'On · Ready for a wish', 'off', true, 'Genie stays on once it joins your team.'])
  // Powered off here: asleep, not on the team, and Power on brings it back.
  const removed = row('omni', 'asleep', { roster: linked, status: { ready: true, installed: true, canInstall: true } }, { removed: true })
  assert.deepEqual([removed.state, removed.text, removed.action], ['off', 'Powered off · not on your team', 'power'])
  // Installed but not connected: power it on, here.
  const plain = { roster: { bots: [] }, status: { ready: true, installed: true, canInstall: true } }
  assert.deepEqual([row('omni', 'asleep', plain).state, row('omni', 'asleep', plain).action, row('omni', 'asleep', plain).text], ['off', 'power', 'Powered off'])
  // Not installed: Install, with what it does in one line.
  const genieMissing = row('genie', 'asleep', { roster: { bots: [] }, status: { ready: false, plugin: { installed: false }, canInstall: true } })
  assert.deepEqual([genieMissing.action, genieMissing.text, genieMissing.note], ['install', 'Not installed', 'Adds the Genie plugin to this DSH. Genie then joins your team.'])
  assert.equal(shortcut.actionLabel(genieMissing), 'Install Genie')
  const omniMissing = row('omni', 'asleep', { roster: { bots: [] }, status: { ready: false, installed: false, canInstall: true } })
  assert.deepEqual([omniMissing.action, omniMissing.note], ['install', 'Adds the Omni plugins to this DSH, then looks for your Omni.'])
  assert.equal(row('genie', 'asleep', { roster: { bots: [] }, status: { ready: false, plugin: { installed: true }, canInstall: true } }).action, 'power')
  // Found or none: where Omni lives is the team step's choice.
  assert.equal(row('omni', 'found', plain, { omnis: [] }).action, 'choose')
  assert.equal(row('omni', 'none', plain).action, 'choose')
  // Installing or starting: held as the team step's box is, a spinner, and the install goes on.
  const working = row('omni', 'installing', plain, null)
  assert.deepEqual([working.state, working.action, working.working, working.text, working.note], ['working', null, true, 'Installing Omni…', 'You can close this. The install keeps going.'])
  assert.equal(row('genie', 'starting', plain).text, 'Starting Genie in this DSH…')
  // Waking or looking: it can still be powered off, as on its box.
  assert.deepEqual([row('omni', 'looking', plain).action, row('omni', 'looking', plain).pressed], ['off', true])
  assert.equal(row('omni', 'pairing', plain, { pairing: {} }).action, 'off')
  // Restart: text only.
  assert.deepEqual([row('genie', 'restart', plain).action, row('genie', 'restart', plain).text], [null, 'Installed · restart DSH to start it'])
  // Failed: its message as an alert, and try again.
  const failed = row('omni', 'failed', plain, { message: 'git was not found' })
  assert.deepEqual([failed.state, failed.action, failed.alert], ['attention', 'retry', 'git was not found'])
  // Linked, but the Omni Bot was deleted: add it back.
  assert.equal(row('omni', 'asleep', { roster: { bots: [], omniLinked: true, omniAddable: true } }).secondary, 'add')
  // No plugin manager: the Plugins page.
  assert.equal(row('omni', 'asleep', { roster: { bots: [] }, status: { ready: false, canInstall: false } }).action, 'plugins')
  // A read-only team: text only.
  assert.equal(row('omni', 'asleep', { roster: { bots: [], readOnly: 'Read only' }, status: { canInstall: true } }).action, null)
  assert.equal(row('genie', 'asleep', { roster: { bots: [GENIE_BOT], readOnly: 'Read only' } }).action, null)
})

test('an install says its step and its place, from the host\'s job', () => {
  const genie = install => ({ genie: { install } })
  assert.equal(shortcut.workingText('genie', 'installing', genie({ phase: 'installing', steps: ['git', 'team', 'genie'], current: 'team', done: ['git'] })), 'Installing Genie · 2 of 3 · Bot team')
  assert.equal(shortcut.workingText('genie', 'installing', genie({ phase: 'installing', steps: ['git', 'team', 'genie'], current: 'git', done: [] })), 'Installing Genie · 1 of 3 · Checking git')
  assert.equal(shortcut.workingText('genie', 'installing', genie({ phase: 'installing', steps: ['team', 'genie'], current: 'genie', done: ['team'] })), 'Installing Genie · 2 of 2 · Genie plugin')
  // Before the job says: the team step's own line.
  assert.equal(shortcut.workingText('genie', 'installing', genie(null)), 'Installing Genie…')
  assert.equal(shortcut.workingText('genie', 'installing', genie({ phase: 'installing', log: '' })), 'Installing Genie…')
  const plugins = { plugins: [{ name: 'a', title: 'Bot team' }, { name: 'b', title: 'Omni channels' }, { name: 'c', title: 'Omni canvases' }], install: { phase: 'installing', current: 'b', done: ['a'] } }
  assert.equal(shortcut.workingText('omni', 'installing', { plugins }), 'Installing Omni · 2 of 3 · Omni channels')
  assert.equal(shortcut.workingText('omni', 'starting', { plugins }), 'Starting Omni in this DSH…')
  assert.equal(shortcut.powerRow('genie', { phase: 'installing', detail: genie({ steps: ['git', 'team', 'genie'], current: 'team', done: ['git'] }) }).text, 'Installing Genie · 2 of 3 · Bot team')
})

test('several Genie Bots: on, and the row wears the Main one\'s mark', () => {
  const roster = { bots: [GENIE_BOT, { id: 'genie-2', kind: 'genie' }], mainBotId: 'genie-2' }
  assert.equal(row('genie', 'asleep', { roster }).bot.id, 'genie-2')
  assert.equal(row('genie', 'asleep', { roster: { bots: [GENIE_BOT, { id: 'genie-2', kind: 'genie' }] } }).bot.id, 'genie')
})

test('Unfold shows only in its own instance, read-only, after Unfold', () => {
  assert.deepEqual(plain(shortcut.kindsOf({})), ['omni', 'genie'])
  assert.deepEqual(plain(shortcut.kindsOf({ preload: 'genie' })), ['genie', 'omni'])
  assert.deepEqual(plain(shortcut.kindsOf({ preload: 'unfold' })), ['omni', 'genie'])
  assert.deepEqual(plain(shortcut.kindsOf({ host: 'unfold', preload: 'unfold' })), ['unfold', 'omni', 'genie'])
  const unfold = row('unfold', 'asleep', { roster: { bots: [{ id: 'u', kind: 'unfold' }] } })
  assert.deepEqual([unfold.state, unfold.action, unfold.text], ['on', null, 'On your team'])
})

test('the button names each product\'s state, and badges only work and errors', () => {
  const rows = [row('omni', 'asleep', { roster: { bots: [OMNI_BOT], omniLinked: true } }), row('genie', 'asleep', { roster: { bots: [] } })]
  assert.equal(shortcut.buttonLabel(rows), 'Omni on, Genie off')
  assert.equal(shortcut.buttonLabel([row('omni', 'installing', {}), row('genie', 'failed', {})]), 'Omni working, Genie needs you')
  assert.equal(shortcut.badgeOf(['asleep', 'asleep']), null)
  assert.equal(shortcut.badgeOf(['found', 'linked']), null)
  assert.equal(shortcut.badgeOf(['starting', 'failed']), 'working')
  assert.equal(shortcut.badgeOf(['restart', 'ready']), 'error')
  assert.equal(shortcut.badgeOf(['asleep', 'failed']), 'error')
})

test('a power-on keeps running in the store after its view goes, and a second press starts nothing', async () => {
  shortcut.resetPower()
  let release
  let runs = 0
  const run = async ({ show, signal }) => {
    runs += 1
    show('installing')
    await new Promise((resolve) => { release = resolve })
    if (signal.aborted) return
    show('ready', { bot: GENIE_BOT })
  }
  const seen = []
  const off = shortcut.subscribePower(() => seen.push(shortcut.powerOf('genie').phase))
  off() // the view that started it is gone
  assert.ok(shortcut.startPower('genie', run))
  assert.equal(shortcut.startPower('genie', run), null)
  assert.equal(runs, 1)
  assert.equal(shortcut.powerOf('genie').phase, 'installing')
  release()
  await settle()
  assert.equal(shortcut.powerOf('genie').phase, 'ready')
  assert.deepEqual(seen, [])
  // Only an explicit stop aborts it.
  shortcut.startPower('omni', async ({ show, signal }) => {
    show('waking')
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }))))
  })
  shortcut.stopPower('omni')
  await settle()
  assert.equal(shortcut.powerOf('omni').phase, 'waking')
  assert.equal(shortcut.powerSignal('omni').aborted, true)
  // A run that throws ends failed, with its message.
  shortcut.runPower('genie', async () => { throw new Error('no git') })
  await settle()
  assert.deepEqual(plain(shortcut.powerOf('genie')), { phase: 'failed', detail: { message: 'no git' } })
  shortcut.resetPower()
})

test('each action does its one thing', async () => {
  const calls = []
  const actions = {
    openSession: id => calls.push(['openSession', id]),
    openHarnessOnboarding: id => calls.push(['onboarding', id]),
    selectPanel: id => calls.push(['panel', id]),
    addOmni: async () => { calls.push(['addOmni']); return { id: 'omni-new' } },
  }
  const close = () => calls.push(['close'])
  const problems = []
  const onProblem = (kind, message) => { if (message) problems.push([kind, message]) }
  const started = []
  const start = (kind, run) => { started.push([kind, run.name]) }
  const options = { actions, close, onProblem, start }
  const stopped = []
  options.stop = kind => stopped.push(kind)
  shortcut.actOn({ kind: 'omni', action: 'power' }, options)
  shortcut.actOn({ kind: 'genie', action: 'retry' }, options)
  shortcut.actOn({ kind: 'genie', action: 'install' }, options)
  assert.deepEqual(started, [['omni', 'powerOn'], ['genie', 'geniePowerOn'], ['genie', 'geniePowerOn']])
  // Off is the team step's own power-off; a held one does nothing.
  shortcut.actOn({ kind: 'omni', action: 'off' }, options)
  shortcut.actOn({ kind: 'genie', action: 'off', locked: true }, options)
  assert.deepEqual(stopped, ['omni'])
  shortcut.actOn({ kind: 'omni', action: 'plugins' }, options)
  await shortcut.actOn({ kind: 'omni', action: 'add' }, options)
  // Where Omni lives: the team step, with the shortcut's intent to power Omni on.
  shortcut.actOn({ kind: 'omni', action: 'choose' }, options)
  assert.deepEqual(calls, [['close'], ['panel', 'plugins'], ['addOmni'], ['close'], ['openSession', 'omni-new'], ['close'], ['onboarding', 'omni-team']])
  const intent = shortcut.takeTeamIntent()
  assert.equal(intent.power, 'omni')
  assert.equal(shortcut.takeTeamIntent(), null, 'the intent is one-shot')
  // Open team setup: the intent without a card to power on.
  shortcut.openTeamSetup({ actions, close })
  assert.equal(shortcut.takeTeamIntent().power, null)
  // A failed Add Omni says why on its row.
  await shortcut.actOn({ kind: 'omni', action: 'add' }, { ...options, actions: { ...actions, addOmni: async () => { throw new Error('read only') } } })
  assert.deepEqual(problems, [['omni', 'read only']])
})

test('the intent lives a minute, and survives a fresh module through sessionStorage', () => {
  shortcut.setTeamIntent('omni', 1000)
  assert.equal(shortcut.takeTeamIntent(1000 + shortcut.INTENT_MS), null)
  shortcut.setTeamIntent(null, 1000)
  storage.set('automagik.welcome.team-intent', JSON.stringify({ power: 'omni', at: 2000 }))
  shortcut.resetPower()
  assert.equal(shortcut.takeTeamIntent(2500).power, 'omni')
  assert.equal(storage.has('automagik.welcome.team-intent'), false)
})

test('the button draws a spinner while working, the cloud\'s dot on an error, and the card opens per the state table', () => {
  shortcut.resetPower()
  const roster = { bots: [OMNI_BOT], omniLinked: true }
  const actions = {}
  let view = mount(shortcut.PowerShortcut, { roster, actions })
  let tree = view.render()
  const button = findAll(tree, node => node.type === 'button')[0]
  assert.equal(button.props.className, 'bt-round bt-side-tool bt-power')
  assert.equal(button.props['aria-haspopup'], 'dialog')
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(button.props['aria-label'], 'Omni on, Genie off')
  assert.equal(findAll(tree, node => node.props?.className === 'bt-update-dot').length, 0)
  shortcut.showPower('genie', 'installing')
  view = mount(shortcut.PowerShortcut, { roster, actions })
  tree = view.render()
  assert.equal(findAll(tree, node => node.props?.className === 'bt-thread-spin').length, 1)
  shortcut.showPower('genie', 'failed', { message: 'no git' })
  view = mount(shortcut.PowerShortcut, { roster, actions })
  tree = view.render()
  assert.equal(findAll(tree, node => node.props?.className === 'bt-update-dot').length, 1)
  shortcut.resetPower()
})

test('the team step opened on purpose only closes on Continue: no team-save, no rename', async () => {
  for (const [explicit, intent, saves] of [[true, null, false], [false, 'omni', false], [false, null, true]]) {
    shortcut.resetPower()
    fetched.length = 0
    answers = { state: { companionName: 'Otto', teamDone: false, preload: null }, 'team-save': { omni: false, genie: false } }
    if (intent) shortcut.setTeamIntent(intent)
    let completed = 0
    const props = { stepId: 'omni-team', explicit, complete: () => { completed += 1 } }
    const view = mount(shortcut.TeamStep, props)
    view.render()
    await settle()
    const tree = view.render()
    assert.ok(tree, `the step shows (explicit ${explicit}, intent ${intent})`)
    const go = findAll(tree, node => node.type === 'button' && String(node.props.className).includes('oai-primary'))[0]
    go.props.onClick()
    await settle()
    await settle()
    assert.equal(fetched.some(call => call.endpoint === 'team-save'), saves)
    if (!saves) assert.equal(completed, 1)
    // The intent's Omni powers on by itself.
    if (intent === 'omni') assert.notEqual(shortcut.powerOf('omni').phase, 'asleep')
  }
  shortcut.resetPower()
  assert.equal(shortcut.explicitOf({ explicit: true }, null), true)
  assert.equal(shortcut.explicitOf({}, { power: null, at: 0 }), true)
  assert.equal(shortcut.explicitOf({}, null), false)
})

test('without the Bot team\'s opener, team setup only closes and leaves no intent behind', () => {
  shortcut.resetPower()
  let closed = 0
  shortcut.openTeamSetup({ actions: {}, close: () => { closed += 1 } }, 'omni')
  assert.equal(closed, 1)
  assert.equal(shortcut.takeTeamIntent(), null)
})

test('the instance and the plugins are read on mount, so the button\'s name is right before the card opens', async () => {
  shortcut.resetPower()
  fetched.length = 0
  answers = { state: { host: 'unfold', preload: 'unfold' } }
  const view = mount(shortcut.PowerShortcut, { roster: { bots: [] }, actions: {} })
  view.render()
  await settle()
  const tree = view.render()
  // The plugins once on mount (an install running on the host is picked up), then only when the card opens.
  assert.deepEqual(fetched.map(call => call.endpoint), ['state', 'omni-plugins', 'genie-plugin'])
  view.render()
  await settle()
  assert.equal(fetched.length, 3, 'no read again while the card stays closed')
  assert.equal(findAll(tree, node => node.type === 'button')[0].props['aria-label'], 'Unfold off, Omni off, Genie off')
  shortcut.resetPower()
})

test('Power on waits for the plugins\' read, which may say Open Plugins instead', () => {
  const powers = { omni: { phase: 'asleep', detail: null }, genie: { phase: 'asleep', detail: null } }
  const roster = { bots: [] }
  const before = shortcut.cardRows(['omni', 'genie'], powers, { roster, read: { checked: false } })
  assert.deepEqual(before.map(entry => entry.action), [null, null])
  const off = { ready: false, canInstall: false }
  const after = shortcut.cardRows(['omni', 'genie'], powers, { roster, read: { omni: off, genie: { ready: false, canInstall: true }, checked: true } })
  assert.deepEqual(after.map(entry => entry.action), ['plugins', 'power'])
  // A failure still offers Try again before the read; a problem shows on its row.
  const failed = shortcut.cardRows(['omni'], { omni: { phase: 'failed', detail: { message: 'x' } } }, { roster, problems: { omni: 'read only' } })
  assert.deepEqual([failed[0].action, failed[0].alert], ['retry', 'read only'])
})

test('powering off from the shortcut is the team step\'s own off: the run stops, nothing else is undone', async () => {
  shortcut.resetPower()
  fetched.length = 0
  // A linked Omni: off only puts its box to sleep. No unlink, no Bot removed, no host call.
  shortcut.showPower('omni', 'linked', { origin: 'omni.example.com' })
  shortcut.powerOff('omni')
  assert.deepEqual(plain(shortcut.powerOf('omni')), { phase: 'asleep', detail: { removed: true } })
  assert.deepEqual(fetched, [])
  // Waiting on the phone: the sign-in is cancelled, as the box's own off does.
  const asked = []
  shortcut.showPower('omni', 'pairing', { pairing: { code: 'X' } })
  shortcut.powerOff('omni', shortcut.powerOf('omni'), endpoint => { asked.push(endpoint); return Promise.resolve({}) })
  assert.deepEqual(asked, ['omni-pair-cancel'])
  // A run in progress is stopped.
  shortcut.startPower('genie', async ({ show, signal }) => {
    show('waking')
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }))))
  })
  shortcut.powerOff('genie')
  await settle()
  assert.equal(shortcut.powerSignal('genie').aborted, true)
  assert.equal(shortcut.powerOf('genie').phase, 'asleep')
  // Held while it installs or starts, and Genie once on the team.
  assert.deepEqual(['installing', 'starting', 'ready', 'linked'].map(phase => shortcut.powerLocked('omni', phase)), [true, true, false, false])
  assert.equal(shortcut.powerLocked('genie', 'ready'), true)
  shortcut.resetPower()
})

test('each row leads with the Bot team\'s mark: its Bot, or the look that Bot is made with', () => {
  const Mark = () => null
  const own = shortcut.RowMark({ Mark, row: { kind: 'omni', bot: OMNI_BOT } })
  assert.deepEqual([own.type, own.props.bot, own.props.size, own.props.live], [Mark, OMNI_BOT, 28, false])
  // Not on the team yet: the look its Bot is made with (the welcome's Omni Bot, Genie's kind).
  assert.deepEqual(plain(shortcut.RowMark({ Mark, row: { kind: 'omni', bot: null } }).props.bot), { id: 'omni', kind: 'omni', color: 'deepseek', avatar: { shape: 'octopus' } })
  assert.deepEqual(plain(shortcut.RowMark({ Mark, row: { kind: 'genie', bot: null } }).props.bot), { id: 'genie', kind: 'genie' })
  // Without the Bot team's mark, the row has none.
  assert.equal(shortcut.RowMark({ Mark: null, row: { kind: 'omni' } }), null)
})

test('the shortcut takes the Bot team\'s BotMark when it registers', () => {
  const registered = []
  const BotMark = () => null
  const off = shortcut.installPowerShortcut(() => ({ omni: { sidebarTools: { register: entry => { registered.push(entry); return () => {} } }, ui: { BotMark } } }))
  assert.equal(typeof off, 'function')
  const drawn = registered[0].Component({ roster: {}, actions: {} })
  assert.equal(drawn.type, shortcut.PowerShortcut)
  assert.equal(drawn.props.Mark, BotMark)
})

// The host's Genie job, as genie-plugin answers it (bot-types.js genieStatus), at its second of three steps.
const GENIE_INSTALLING = { ready: false, plugin: { installed: false }, canInstall: true, install: { phase: 'installing', steps: ['git', 'team', 'genie'], current: 'team', done: ['git'], error: null } }
// A start that runs the resumed power-on with a stand-in host and no waits.
const resumedWith = (ai, polls = []) => (kind, run) => shortcut.startPower(kind, options => run({ ...options, genieAi: ai, omniAi: ai, omniUi: ai, wait: async (ms) => { polls.push(ms) }, quick: true }))

test('an install the host runs is picked up after a reload: its step and place, polled to the end, and no second install', async () => {
  shortcut.resetPower()
  const asked = []
  const replies = [GENIE_INSTALLING, { ...GENIE_INSTALLING, install: { ...GENIE_INSTALLING.install, phase: 'done', current: null, done: ['git', 'team', 'genie'] }, ready: true, bot: GENIE_BOT }]
  const ai = async (endpoint) => { asked.push(endpoint); return replies.shift() }
  const polls = []
  // Nothing running: nothing picked up.
  assert.equal(shortcut.resumeInstall('genie', { ...GENIE_INSTALLING, install: { phase: 'done' } }, resumedWith(ai, polls)), null)
  assert.equal(shortcut.resumeInstall('genie', null, resumedWith(ai, polls)), null)
  // A fresh window: the store says asleep, the host says installing. At once, the working row.
  assert.equal(shortcut.powerOf('genie').phase, 'asleep')
  assert.ok(shortcut.resumeInstall('genie', GENIE_INSTALLING, resumedWith(ai, polls)))
  assert.equal(shortcut.powerOf('genie').phase, 'installing')
  const working = shortcut.powerRow('genie', shortcut.powerOf('genie'), { roster: { bots: [] } })
  assert.deepEqual([working.state, working.text, working.working], ['working', 'Installing Genie · 2 of 3 · Bot team', true])
  assert.equal(shortcut.badgeOf([shortcut.powerOf('genie').phase]), 'working')
  // A second pickup (the card opening) starts nothing while it works.
  assert.equal(shortcut.resumeInstall('genie', GENIE_INSTALLING, resumedWith(ai, polls)), null)
  for (let i = 0; i < 4; i += 1) await settle()
  // Polled with the team step's interval until done; the install was never asked for again.
  assert.deepEqual(asked, ['genie-plugin', 'genie-plugin'])
  assert.ok(polls.every(ms => ms === shortcut.POLL_MS || ms === 0))
  assert.ok(polls.includes(shortcut.POLL_MS))
  assert.equal(shortcut.powerOf('genie').phase, 'ready')
  assert.equal(shortcut.powerRow('genie', shortcut.powerOf('genie'), { roster: { bots: [] } }).state, 'on')
  shortcut.resetPower()
})

test('a picked-up install that fails shows why, with Try again; Omni\'s plugin install is picked up the same way', async () => {
  shortcut.resetPower()
  const failed = { ...GENIE_INSTALLING, install: { ...GENIE_INSTALLING.install, phase: 'failed', error: 'git was not found' } }
  const genieAsked = []
  shortcut.resumeInstall('genie', GENIE_INSTALLING, resumedWith(async (endpoint) => { genieAsked.push(endpoint); return failed }))
  for (let i = 0; i < 4; i += 1) await settle()
  const row = shortcut.powerRow('genie', shortcut.powerOf('genie'), { roster: { bots: [] } })
  assert.deepEqual([row.state, row.action, row.alert], ['attention', 'retry', 'git was not found'])
  assert.ok(!genieAsked.includes('genie-plugin-install'))
  // Omni: its plugins' job, at the second of two plugins.
  const plugins = [{ name: 'a', title: 'Omni tools' }, { name: 'b', title: 'Omni channels' }]
  const omniInstalling = { ready: false, installed: false, canInstall: true, plugins, install: { phase: 'installing', current: 'b', done: ['a'] } }
  const omniAsked = []
  const omniAi = async (endpoint) => { omniAsked.push(endpoint); return endpoint === 'omni-plugins' ? { ...omniInstalling, install: { phase: 'failed', error: 'no network' } } : {} }
  shortcut.resumeInstall('omni', omniInstalling, resumedWith(omniAi))
  assert.equal(shortcut.powerRow('omni', shortcut.powerOf('omni'), { roster: { bots: [] } }).text, 'Installing Omni · 2 of 2 · Omni channels')
  for (let i = 0; i < 4; i += 1) await settle()
  assert.deepEqual(omniAsked, ['omni-plugins'])
  assert.deepEqual(plain(shortcut.powerOf('omni')), { phase: 'failed', detail: { message: 'no network' } })
  shortcut.resetPower()
})

test('the shortcut picks up a running install when it mounts', async () => {
  shortcut.resetPower()
  fetched.length = 0
  answers = { state: { host: null, preload: null }, 'genie-plugin': GENIE_INSTALLING, 'omni-plugins': { ready: true, installed: true, canInstall: true } }
  const view = mount(shortcut.PowerShortcut, { roster: { bots: [] }, actions: {} })
  view.render()
  await settle()
  await settle()
  assert.equal(shortcut.powerOf('genie').phase, 'installing')
  const tree = view.render()
  const button = findAll(tree, node => node.type === 'button')[0]
  assert.match(button.props['aria-label'], /Genie working/)
  assert.equal(findAll(button, node => node.props?.className === 'bt-thread-spin').length, 1)
  assert.ok(!fetched.some(call => call.endpoint.endsWith('-install')), 'no second install')
  shortcut.resetPower()
})

test('Open team setup and Choose where Omni lives are offered only with the Bot team\'s onboarding opener', () => {
  shortcut.resetPower()
  assert.equal(shortcut.canOpenTeamSetup({ openHarnessOnboarding: () => {} }), true)
  assert.equal(shortcut.canOpenTeamSetup({}), false)
  assert.equal(shortcut.canOpenTeamSetup(undefined), false)
  const powers = { omni: { phase: 'found', detail: { omnis: [] } } }
  assert.equal(shortcut.cardRows(['omni'], powers, { roster: { bots: [] }, read: { checked: true } })[0].action, 'choose')
  assert.equal(shortcut.cardRows(['omni'], powers, { roster: { bots: [] }, read: { checked: true }, teamSetup: false })[0].action, null)
  // With the opener, it opens the welcome's team step.
  const opened = []
  shortcut.openTeamSetup({ actions: { openHarnessOnboarding: id => opened.push(id) }, close: () => {} })
  assert.deepEqual(opened, ['omni-team'])
  shortcut.resetPower()
})
