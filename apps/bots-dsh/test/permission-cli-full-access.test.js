// Full access keeps its name on a Bot that runs on a coding CLI (Claude Code, Codex), with
// an explanation in that CLI's words. The stored level stays
// danger-full-access, and a CLI that did not take its no-ask mode is said where the level is
// shown. Words only: nothing here decides a permission.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { DICTIONARY } from '../src/client/i18n.js'

const plugin = fileURLToPath(new URL('..', import.meta.url))
const { outputFiles } = await build({
  stdin: { contents: [
    "export { PermissionPicker, PermissionList, PermissionOptions, presetName, presetText, cliOfBot } from './src/client/permission-picker.js'",
    "export { ComposerPermission } from './src/client/composer.js'",
    "export { PermissionChoiceDock } from './src/client/permission-card.js'",
    "export { permissionRows, noAskMissed } from './src/client/permission-diagnostics.js'",
  ].join('\n'), resolveDir: plugin },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

// A small stateful React, as permission-picker.test.js uses: cells live across renders.
function load() {
  const cells = []
  const prev = []
  let hook = 0
  let effects = []
  const changed = (deps, before) => deps === undefined || before === undefined || deps.length !== before.length || deps.some((dep, i) => !Object.is(dep, before[i]))
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    useState(initial) {
      const i = hook++
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial
      return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next }]
    },
    useRef(initial) { const i = hook++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i] },
    useEffect(fn, deps) { effects.push({ i: hook++, fn, deps }) },
    useLayoutEffect(fn, deps) { effects.push({ i: hook++, fn, deps }) },
    useMemo: make => make(),
    useId: () => 'id',
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    Fragment: Symbol('Fragment'),
  }
  const store = new Map()
  const localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, String(value)) }, removeItem: key => store.delete(key) }
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, window: { localStorage, addEventListener() {}, removeEventListener() {} }, localStorage,
    URL, URLSearchParams, setTimeout, clearTimeout, navigator: {}, Date, Promise, Intl, console,
    require: name => (name === 'react' ? react : {}),
  })
  // One component kept across renders: its own hooks only, children expanded without hooks.
  const render = (component, props) => {
    hook = 0
    effects = []
    const tree = component(props)
    for (const { i, fn, deps } of effects) if (changed(deps, prev[i])) { prev[i] = deps; fn() }
    return tree
  }
  return { ...module.exports, render }
}

// Every node of a tree, components expanded (only ones that use no hook of their own).
function nodes(tree, out = []) {
  if (Array.isArray(tree)) { for (const item of tree) nodes(item, out); return out }
  if (tree === null || tree === undefined || typeof tree !== 'object') { if (typeof tree === 'string' || typeof tree === 'number') out.push(String(tree)); return out }
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props), out)
  out.push(tree)
  return nodes(tree.props?.children, out)
}
const textOf = tree => nodes(tree).filter(node => typeof node === 'string').join(' ')
const buttons = tree => nodes(tree).filter(node => node?.type === 'button')
const labelOf = button => textOf(button.props.children)

const FULL = 'danger-full-access'
const CATALOG = { options: [
  { value: 'read-only', name: 'Read only' },
  { value: 'workspace-write', name: 'Workspace' },
  { value: 'auto', name: 'Auto review' },
  { value: FULL, name: 'Full access' },
], defaultPreset: 'read-only' }
const CLAUDE = { id: 'b1', name: 'Ada', model: 'acp-claude/opus', appliedModel: 'acp-claude/opus', permission: FULL, sessionId: 's1' }
const CODEX = { id: 'b2', name: 'Bob', model: 'acp-codex/default', appliedModel: 'acp-codex/gpt-5', permission: FULL, sessionId: 's2' }
const NATIVE = { id: 'b3', name: 'Cy', model: 'deepseek-official/deepseek-chat', appliedModel: 'deepseek-official/deepseek-chat', permission: FULL, sessionId: 's3' }

test('the label is Full access on a coding CLI and anywhere else', () => {
  const { presetName, cliOfBot } = load()
  for (const bot of [CLAUDE, CODEX, NATIVE, { name: 'No model yet', permission: FULL }]) {
    assert.equal(presetName(bot.permission, CATALOG), 'Full access')
  }
  assert.equal(cliOfBot({ name: 'No model yet' }), undefined)
  assert.equal(cliOfBot(CLAUDE).name, 'Claude Code')
  assert.equal(cliOfBot(CODEX).name, 'Codex')
  assert.equal(cliOfBot(NATIVE), undefined)
})

test('a Bot that changes route keeps its label and stored level', () => {
  const { presetName } = load()
  const bot = { ...NATIVE }
  assert.equal(presetName(bot.permission, CATALOG), 'Full access')
  Object.assign(bot, { model: 'acp-codex/default', appliedModel: 'acp-codex/default' })
  assert.equal(presetName(bot.permission, CATALOG), 'Full access')
  Object.assign(bot, { model: 'openai/gpt-5', appliedModel: 'openai/gpt-5' })
  assert.equal(presetName(bot.permission, CATALOG), 'Full access')
  assert.equal(bot.permission, FULL)
})

test('a Bot saved on a CLI that runs on another model reads Full access: there no CLI decides', () => {
  const { presetName, presetText, cliOfBot } = load()
  const plain = 'Runs commands and changes files anywhere without asking you. Choose it only when you trust what you asked for.'
  for (const applied of ['deepseek-official/deepseek-chat', 'acp-claude/opus', undefined, '']) {
    const bot = { ...CODEX, appliedModel: applied }
    assert.equal(cliOfBot(bot), undefined, String(applied))
    assert.equal(presetName(FULL, CATALOG), 'Full access', String(applied))
    assert.equal(presetText(FULL, CATALOG, cliOfBot(bot)), plain, String(applied))
  }
  // And the other way: applied on the CLI, saved elsewhere (a pick not applied yet).
  assert.equal(cliOfBot({ ...CODEX, model: 'openai/gpt-5' }), undefined)
  // Another model of the same CLI is still that CLI.
  assert.equal(cliOfBot(CODEX).name, 'Codex')
})

test('the other levels keep their names on a CLI Bot, DSH\'s reviewer level included', () => {
  const { presetName, presetText, cliOfBot } = load()
  const cli = cliOfBot(CLAUDE)
  assert.equal(presetName('auto', CATALOG), 'Auto review')
  assert.equal(presetName('read-only', CATALOG), 'Read only')
  assert.equal(presetName('workspace-write', CATALOG), 'Workspace')
  for (const value of ['auto', 'read-only', 'workspace-write']) assert.equal(presetText(value, CATALOG, cli), presetText(value, CATALOG))
})

test('the explanation names the CLI and its own mode, and says Automagik does not review or ask', () => {
  const { presetText, cliOfBot } = load()
  const claude = presetText(FULL, CATALOG, cliOfBot(CLAUDE))
  assert.match(claude, /^Claude Code decides by itself/)
  assert.match(claude, /without asking you/)
  assert.match(claude, /"bypass permissions" mode/)
  assert.match(claude, /Automagik asks it for its own "bypass permissions" mode, and does not review or ask\./)
  assert.match(claude, /while the Bot runs on Claude Code\./)
  const codex = presetText(FULL, CATALOG, cliOfBot(CODEX))
  assert.match(codex, /^Codex decides by itself/)
  assert.match(codex, /"full access" mode/)
  assert.equal(presetText(FULL, CATALOG, cliOfBot(NATIVE)), 'Runs commands and changes files anywhere without asking you. Choose it only when you trust what you asked for.')
})

test('the list in Details shows Full access for a CLI Bot, in the danger ink, and asks before it sends', () => {
  const { PermissionList, cliOfBot, render } = load()
  const sent = []
  const props = { catalog: CATALOG, saved: 'read-only', name: 'Ada', cli: cliOfBot(CLAUDE), onPick: (value) => { sent.push(value); return true } }
  let tree = render(PermissionList, props)
  const row = buttons(tree).find(button => button.props['data-permission'] === FULL)
  assert.match(labelOf(row), /^Full access /)
  assert.match(labelOf(row), /Claude Code decides by itself/)
  assert.ok(nodes(row).some(node => /bt-danger/.test(node?.props?.className ?? '')), 'the danger ink stays')
  assert.ok(!nodes(tree).some(node => node?.props?.className?.startsWith('bt-q-label') && textOf(node) === 'Auto'))
  row.props.onClick()
  assert.deepEqual(sent, [], 'a click only asks')
  tree = render(PermissionList, props)
  const text = textOf(tree)
  assert.match(text, /Give Ada full access\? Claude Code will decide by itself and run without asking you\. Automagik will ask it for its own "bypass permissions" mode, and will not review or ask\./)
  const [use, cancel] = ['Give full access', 'Cancel'].map(label => buttons(tree).find(button => labelOf(button) === label))
  assert.ok(use && cancel)
  cancel.props.onClick()
  assert.deepEqual(sent, [])
  tree = render(PermissionList, props)
  assert.ok(!buttons(tree).some(button => labelOf(button) === 'Give full access'))
  buttons(tree).find(button => button.props['data-permission'] === FULL).props.onClick()
  tree = render(PermissionList, props)
  buttons(tree).find(button => labelOf(button) === 'Give full access').props.onClick()
  assert.deepEqual(sent, [FULL], 'the level sent is the stored one, unchanged')
})

test('the list for a Bot on another model is as it was: Full access and its own question', () => {
  const { PermissionList, cliOfBot, render } = load()
  const props = { catalog: CATALOG, saved: 'read-only', name: 'Cy', cli: cliOfBot(NATIVE), onPick: () => true }
  let tree = render(PermissionList, props)
  const row = buttons(tree).find(button => button.props['data-permission'] === FULL)
  assert.match(labelOf(row), /^Full access Runs commands and changes files anywhere/)
  row.props.onClick()
  tree = render(PermissionList, props)
  assert.match(textOf(tree), /Give Cy full access\? Cy will run commands and change files anywhere without asking you first\./)
  assert.ok(buttons(tree).some(button => labelOf(button) === 'Give full access'))
  assert.ok(!/Auto/.test(textOf(tree).replace(/Auto review/g, '')))
})

test('Settings and the group picker take no Bot, so they keep Full access', () => {
  const { PermissionPicker, render } = load()
  const tree = render(PermissionPicker, { catalog: CATALOG, saved: 'read-only', confirmFull: true, onPick: () => true })
  const labels = buttons(tree).map(labelOf)
  assert.ok(labels.includes('Full access'))
  assert.ok(!labels.includes('Auto'))
})

test('the composer chip of a CLI Bot reads Full access, including its tooltip and accessible label', () => {
  for (const bot of [CLAUDE, CODEX]) {
    const { ComposerPermission, render } = load()
    const roster = { byId: { [bot.sessionId]: bot }, permissions: CATALOG, readOnly: false }
    const tree = render(ComposerPermission, { sessionId: bot.sessionId, useRoster: pick => pick(roster), actions: {} })
    const chip = buttons(tree).find(button => button.props.className === 'bt-perm-chip')
    assert.ok(chip)
    assert.equal(labelOf(chip), 'Full access')
    assert.equal(chip.props.title, 'Permissions: Full access')
    assert.equal(chip.props['aria-label'], 'Permissions: Full access')
  }
})

test('the card in the chat of a CLI Bot shows Full access, asks in the CLI\'s words and sends Full access', async () => {
  const { PermissionChoiceDock, render } = load()
  const bot = { ...CODEX, permission: undefined }
  const sent = []
  const roster = { byId: { s2: bot }, permissions: CATALOG, ready: true, readOnly: false }
  const dock = PermissionChoiceDock({ sessionId: 's2', useRoster: pick => pick(roster), actions: { updateBot: async (id, patch) => { sent.push([id, patch]) } } })
  const card = nodes(dock.props.children).length ? dock.props.children.find(child => typeof child?.type === 'function') : undefined
  assert.ok(card, 'the card is raised for a Bot with no level yet')
  let tree = render(card.type, card.props)
  const row = buttons(tree).find(button => button.props['data-permission'] === FULL)
  assert.match(labelOf(row), /^Full access Codex decides by itself/)
  row.props.onClick()
  tree = render(card.type, card.props)
  nodes(tree).find(node => node?.type === 'form').props.onSubmit({ preventDefault() {} })
  tree = render(card.type, card.props)
  const text = textOf(tree)
  assert.match(text, /Give Bob full access\?/)
  assert.match(text, /Codex will decide by itself and run without asking you\. Automagik will ask it for its own "full access" mode, and will not review or ask\./)
  const use = buttons(tree).find(button => labelOf(button) === 'Give full access')
  assert.ok(use)
  assert.deepEqual(sent, [], 'nothing is sent before the second answer')
  use.props.onClick({ detail: 1 })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['b2', { permission: FULL }]], 'the level sent is danger-full-access, never DSH\'s reviewer level')
})

const row = (bot, acp, extra = {}) => ({ kind: 'chat', botId: bot.id, open: true, source: 'bot', saved: { value: FULL }, effective: { value: FULL }, ...(acp ? { acp } : {}), ...extra })
const record = (agent, modes) => ({ agent, active: true, modes })
const ROSTER = { bots: [CLAUDE, CODEX, NATIVE], rooms: [] }
const report = sessions => ({ version: 1, sessions })

test('the diagnostics section names the level Full access on every route', () => {
  const { permissionRows } = load()
  const rows = permissionRows(report([row(CLAUDE), row(NATIVE)]), ROSTER)
  assert.match(rows[0].level, /Saved level: Full access, set for the Bot · Running as: Full access/)
  assert.match(rows[1].level, /Saved level: Full access, set for the Bot · Running as: Full access/)
})

test('a running CLI that is in another mode than its no-ask one is said, from the record', () => {
  const { permissionRows, noAskMissed } = load()
  const fell = record('acp-claude', { wanted: ['bypassPermissions', 'default'], offered: ['default', 'plan'], chosen: 'default', current: 'default', applied: true, fellToStrict: true })
  assert.deepEqual({ ...noAskMissed(fell) }, { mode: 'default' })
  const [line] = permissionRows(report([row(CLAUDE, fell)]), ROSTER)
  assert.match(line.level, /Claude Code is in its mode "default" here, not its no-ask mode\./)
  assert.doesNotMatch(line.level, /ask you|refuse/, 'no promise of what it will do there')
  const refused = record('acp-codex', { wanted: ['agent-full-access', 'workspace-write'], offered: ['agent-full-access', 'workspace-write'], chosen: 'agent-full-access', current: 'workspace-write', applied: false })
  assert.deepEqual({ ...noAskMissed(refused) }, { mode: 'workspace-write' })
  assert.match(permissionRows(report([row(CODEX, refused)]), ROSTER)[0].level, /Codex is in its mode "workspace-write" here, not its no-ask mode\./)
})

test('only the mode the record knows the CLI is in counts, and only while it runs', () => {
  const { permissionRows, noAskMissed } = load()
  // The switch to the strict mode did not hold: the CLI is still in its no-ask mode.
  const stillBypass = record('acp-claude', { wanted: ['bypassPermissions', 'default'], offered: ['default'], chosen: 'default', current: 'bypassPermissions', applied: false })
  assert.equal(noAskMissed(stillBypass), undefined)
  assert.doesNotMatch(permissionRows(report([row(CLAUDE, stillBypass)]), ROSTER)[0].level, /no-ask/)
  const taken = record('acp-claude', { wanted: ['bypassPermissions', 'default'], offered: ['bypassPermissions', 'default'], chosen: 'bypassPermissions', current: 'bypassPermissions', applied: true })
  assert.equal(noAskMissed(taken), undefined)
  // The mode chosen says nothing of where the CLI is: no current mode, no line.
  assert.equal(noAskMissed(record('acp-claude', { wanted: ['bypassPermissions', 'default'], offered: ['default'], chosen: 'default' })), undefined)
  assert.equal(noAskMissed(record('acp-codex', { wanted: ['agent-full-access', 'workspace-write'], offered: ['plan'] })), undefined, 'it offers none: the existing lines say that')
  assert.equal(noAskMissed(record('acp-claude', { wanted: ['bypassPermissions', 'default'], chosen: 'default', current: 'other', applied: true })), undefined, 'a mode this code does not know')
  // A stopped agent's record is its last run.
  assert.equal(noAskMissed({ agent: 'acp-claude', active: false, modes: { wanted: ['bypassPermissions', 'default'], chosen: 'default', current: 'default', applied: true } }), undefined)
  // Another level's modes: the no-ask mode was never asked for.
  assert.equal(noAskMissed(record('acp-codex', { wanted: ['workspace-write'], offered: ['workspace-write'], chosen: 'workspace-write', current: 'workspace-write', applied: true })), undefined)
  assert.equal(noAskMissed(record('acp-claude', { wanted: ['auto', 'default'], chosen: 'default', current: 'default', applied: true })), undefined)
  for (const bad of [undefined, null, 'x', {}, { active: true }, { active: true, modes: null }, { active: true, modes: { wanted: 'bypassPermissions' } }]) assert.equal(noAskMissed(bad), undefined)
  // A Bot that is not on a CLI, one that runs on another model, or another level: no such line.
  const fell = record('acp-claude', { wanted: ['bypassPermissions', 'default'], chosen: 'default', current: 'default', applied: true })
  assert.doesNotMatch(permissionRows(report([row(NATIVE, fell)]), ROSTER)[0].level, /no-ask/)
  assert.doesNotMatch(permissionRows(report([row(CLAUDE, fell)]), { bots: [{ ...CLAUDE, appliedModel: 'deepseek-official/deepseek-chat' }], rooms: [] })[0].level, /no-ask/)
  assert.doesNotMatch(permissionRows(report([row(CLAUDE, fell, { saved: { value: 'read-only' }, effective: { value: 'read-only' } })]), ROSTER)[0].level, /no-ask/)
})

test('Details shows no such line: it is told only where the record is read fresh', () => {
  const drawer = readFileSync(new URL('../src/client/details-drawer.js', import.meta.url), 'utf8')
  assert.doesNotMatch(drawer, /no-ask|diagnosticsPermissions|noAskMissed/)
})

const KEYS = [
  '{cli} decides by itself and runs commands and changes files anywhere without asking you. Automagik asks it for its own "{mode}" mode, and does not review or ask. This holds while the Bot runs on {cli}.',
  '{cli} will decide by itself and run without asking you. Automagik will ask it for its own "{mode}" mode, and will not review or ask. This holds while the Bot runs on {cli}.',
  'Give {name} full access?',
  'Give full access',
  '{cli} is in its mode "{mode}" here, not its no-ask mode.',
  'Full access',
]

test('the copy is there in English, Chinese and pt-BR, with its placeholders', () => {
  const source = ['permission-picker.js', 'permission-diagnostics.js', 'permission-card.js'].map(file => readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')).join('\n')
  const ptBR = JSON.parse(readFileSync(new URL('../../locale-pt-br-dsh/src/client/locales/pt-BR/omni-ui.json', import.meta.url), 'utf8'))
  const holes = text => (text.match(/\{\w+\}/g) ?? []).sort().join(',')
  for (const key of KEYS) {
    assert.ok(source.includes(`'${key}'`), `English: ${key}`)
    for (const [language, table] of [['Chinese', DICTIONARY.zh], ['pt-BR', ptBR]]) {
      assert.equal(typeof table[key], 'string', `${language}: ${key}`)
      assert.notEqual(table[key], key, `${language} translates: ${key}`)
      assert.equal(holes(table[key]), holes(key), `${language} keeps the placeholders of: ${key}`)
    }
  }
})
