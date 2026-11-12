// The permission section of the diagnostics page (Settings → Feedback), window side
// (client/permission-diagnostics.js): what it shows of the host's answer, that it is only
// text in the page's own rows with no control, and that an answer it does not know how to
// read shows nothing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { DICTIONARY } from '../src/client/i18n.js'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/permission-diagnostics.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

// The section with `report` as its loaded answer. `actions` counts what it asks of the host.
function load(report = null) {
  const asked = []
  const effects = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState: () => [report, () => {}],
    useEffect: (effect) => { effects.push(effect) },
    useRef: current => ({ current }),
    useLayoutEffect: () => {},
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, window: {}, URL, URLSearchParams, setTimeout, clearTimeout, navigator: {}, Date, Promise, Intl,
    require: (name) => {
      if (name === 'react') return react
      if (name === 'react-dom' || name === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`no platform module ${name}`)
    },
  })
  const actions = { diagnosticsPermissions: async () => { asked.push('diagnostics-permissions'); return report } }
  return { ...module.exports, react, actions, asked, effects }
}

const ROSTER = { bots: [{ id: 'b2', name: 'Ada' }, { id: 'm1', name: 'Omni' }], rooms: [{ id: 'r1', name: 'Launch' }] }
const AT = new Date(2026, 0, 5, 14, 2).getTime()
const ACP = {
  agent: 'acp-claude', active: true,
  bridge: { on: true, why: 'agent-default', open: true },
  modes: { wanted: ['bypassPermissions', 'default'], offered: ['default', 'plan'], chosen: 'default', current: 'default', applied: true, fellToStrict: true },
  lastCall: { path: 'dsh-bridge', at: AT },
  reviewer: { route: 'built-in', ok: false, code: 'TIMEOUT', at: AT },
  review: { code: 'AUTO_REVIEW_TIMEOUT', at: AT },
}
const REPORT = {
  version: 1,
  sessions: [
    { kind: 'group', botId: 'b2', roomId: 'r1', open: true, source: 'group', saved: { value: 'workspace-write' }, effective: { value: 'danger-full-access' }, differs: true, unapplied: { level: { value: 'workspace-write' }, at: AT }, acp: ACP },
    { kind: 'chat', botId: 'b2', open: true, source: 'bot', saved: { value: 'auto' }, effective: { value: 'workspace-write' }, differs: true, fallback: true },
    { kind: 'chat', botId: 'm1', open: true, source: 'none', effective: { value: 'custom', name: '/home/alice/client-x' } },
    { kind: 'task', botId: 'gone', open: false, source: 'task', saved: { value: '/home/alice/client-x' } },
  ],
}

const nodes = node => (Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children)] : [])
const texts = node => (Array.isArray(node) ? node.flatMap(texts) : node && typeof node === 'object' ? texts(node.children) : typeof node === 'string' ? [node] : [])
const render = (report, roster = ROSTER) => {
  const page = load(report)
  return { page, tree: page.PermissionDiagnostics({ actions: page.actions, roster, Section: 'section', Row: 'row' }) }
}

test('each Session is one row: who, its level facts, and what its agent last did', () => {
  const { permissionRows } = load()
  const rows = permissionRows(REPORT, ROSTER)
  assert.deepEqual(rows.map(row => row.label), ['Ada · Launch', 'Ada', 'Omni', 'A Bot · Task'])
  assert.equal(rows[0].level, 'Saved level: Workspace, set for the group · Running as: Full access · The level in force here is not the saved one. · Not applied: Workspace could not be set on this conversation (Jan 5 02:02 PM). Tools may be held back here until it is.')
  assert.equal(rows[0].agent, [
    'Claude Code',
    'The agent is in its mode "default"',
    'It took its strictest mode, because the agent does not offer the wider ones',
    'Modes asked for, in order: bypassPermissions, default',
    'Modes the agent offers: default, plan',
    'Tools of DeepSeek Harness: on (the usual for this agent)',
    'Last action: a tool of DeepSeek Harness (Jan 5 02:02 PM)',
    'Auto review asked the built-in reviewer, which did not answer (Jan 5 02:02 PM)',
    'Last Auto review that did not pass: it took too long (Jan 5 02:02 PM)',
  ].join(' · '))
  assert.equal(rows[1].level, 'Saved level: Auto review, set for the Bot · Running as: Workspace · Runs as Workspace here')
  assert.equal(rows[1].agent, '')
  // A preset of the person's own has no name here, whatever the answer carries.
  assert.equal(rows[2].level, 'No saved level: it uses the default of DeepSeek Harness · Running as: A custom level')
  assert.equal(rows[3].level, 'Saved level: A custom level, for this task · Not open now')
  assert.equal(JSON.stringify(rows).includes('alice'), false)
})

test('an agent state that does not hold now is said as such, never as running', () => {
  const { permissionRows } = load()
  const agent = acp => permissionRows({ version: 1, sessions: [{ kind: 'chat', botId: 'b2', open: true, source: 'none', acp }] }, ROSTER)[0].agent
  assert.match(agent({ ...ACP, active: false, bridge: { on: true, why: 'setting' }, modes: { wanted: ['auto'], offered: [], chosen: 'auto', fellToStrict: false } }),
    /^Claude Code, not running now: this is from its last run · Mode asked of the agent: "auto", not confirmed now · Modes asked for, in order: auto · Tools of DeepSeek Harness: on in its last run \(chosen in the settings\)/)
  assert.match(agent({ ...ACP, modes: { wanted: ['auto', 'default'], offered: ['default'], chosen: 'auto', current: 'default', applied: false, fellToStrict: false } }), /The agent is in its mode "default", not the one asked for, "auto"/)
  // The strict mode was refused and the wide one stays: only the refusal is said.
  const refused = agent({ ...ACP, modes: { wanted: ['bypassPermissions', 'default'], offered: ['default', 'bypassPermissions'], chosen: 'default', current: 'bypassPermissions', applied: false, fellToStrict: true } })
  assert.match(refused, /The agent is in its mode "bypassPermissions", not the one asked for, "default"/)
  assert.doesNotMatch(refused, /strictest/)
  assert.doesNotMatch(agent({ ...ACP, active: false, modes: { wanted: ['auto', 'default'], offered: ['default'], chosen: 'default', fellToStrict: true } }), /strictest/)
  assert.match(agent({ ...ACP, modes: { wanted: ['auto'], offered: ['plan'], fellToStrict: false } }), /The agent offers none of the modes asked for/)
  assert.match(agent({ ...ACP, bridge: { on: true, why: 'agent-default', open: false } }), /Tools of DeepSeek Harness: on, but closed now/)
  assert.match(agent({ ...ACP, bridge: { on: false, why: 'no-backchannel' } }), /Tools of DeepSeek Harness: off \(this install cannot offer them\)/)
  assert.match(agent({ agent: 'other', active: true }), /^Another agent$/)
  // Values this window does not know are left out, not printed.
  const odd = agent({ agent: 'acp-codex', active: true, bridge: { on: true, why: 'other', open: true }, modes: { wanted: ['other', 'default'], offered: ['other'], chosen: 'default', fellToStrict: false }, lastCall: { path: 'other', at: AT }, reviewer: { route: 'other', ok: true, at: AT }, review: { code: 'other', at: AT } })
  assert.equal(odd, 'Codex · Mode asked of the agent: "default", not confirmed now · Modes asked for, in order: default · Tools of DeepSeek Harness: on')
})

test('without the levels of DSH the row says so and claims no running level', () => {
  const { permissionRows } = load()
  const rows = permissionRows({ version: 1, sessions: [
    { kind: 'chat', botId: 'b2', open: true, presets: false, source: 'bot', saved: { value: 'custom' }, unapplied: { level: { value: 'custom' }, at: AT } },
    { kind: 'task', botId: 'b2', open: true, presets: false, source: 'unknown' },
    { kind: 'other', open: false, source: 'none', unapplied: { level: { value: 'read-only' }, at: AT } },
  ] }, ROSTER)
  // The mark is told with no promise of a block, here as anywhere.
  assert.equal(rows[0].level, 'Permissions are not available in this DeepSeek Harness · Saved level: A custom level, set for the Bot · Not applied: A custom level could not be set on this conversation (Jan 5 02:02 PM). Tools may be held back here until it is.')
  assert.equal(rows[1].level, 'Permissions are not available in this DeepSeek Harness · Saved level: not known now')
  assert.equal(rows[2].label, 'A conversation no Bot owns now')
  assert.equal(rows[2].level, 'No saved level: it uses the default of DeepSeek Harness · Not open now · Not applied: Read only could not be set on this conversation (Jan 5 02:02 PM). Tools may be held back here until it is.')
})

test('the section is text in the page\'s own rows: no control, no handler, no new class', () => {
  const { tree } = render({ ...REPORT, more: true })
  assert.equal(tree.type, 'section')
  assert.equal(tree.props.title, 'Permissions')
  const all = nodes(tree)
  for (const node of all) {
    assert.ok(['section', 'row', 'div', 'span'].includes(node.type), String(node.type))
    for (const key of Object.keys(node.props)) assert.ok(['title', 'label', 'hint', 'className', 'key'].includes(key), key)
  }
  const classes = new Set(all.flatMap(node => String(node.props.className ?? '').split(' ').filter(Boolean)))
  assert.deepEqual([...classes].sort(), ['bt-fb-entry', 'bt-set-copy', 'bt-set-hint', 'bt-set-row'])
  assert.equal(all.filter(node => node.props.className === 'bt-set-row bt-fb-entry').length, 4)
  assert.ok(texts(tree).includes('Ada · Launch'))
  assert.equal(all.at(-1).props.label, 'More conversations are open than fit here.')
})

test('it asks the host once, on mount, and shows what the answer brings', async () => {
  // A React that keeps state: the answer reaches the page only through the component's own
  // setter, as in the app.
  const page = load(null)
  const cells = []
  const effects = []
  let at = 0
  let asked = 0
  page.react.useState = (initial) => {
    const index = at++
    if (cells.length <= index) cells.push(initial)
    return [cells[index], (next) => { cells[index] = next }]
  }
  page.react.useEffect = (effect) => { effects.push(effect) }
  const actions = { diagnosticsPermissions: async () => { asked += 1; return REPORT } }
  const draw = () => { at = 0; return page.PermissionDiagnostics({ actions, roster: ROSTER, Section: 'section', Row: 'row' }) }
  assert.equal(draw(), null, 'nothing before the answer')
  assert.equal(asked, 0)
  assert.equal(effects.length, 1)
  const stop = effects[0]()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(asked, 1)
  const tree = draw()
  assert.equal(tree.props.title, 'Permissions')
  assert.ok(texts(tree).includes('Ada · Launch'))
  // A window that closed the page before the answer came keeps nothing.
  cells.length = 0
  draw()
  effects.at(-1)()()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(draw(), null)
  stop()
})

test('no open conversation shows one line; an answer it cannot read shows nothing', () => {
  const empty = render({ version: 1, sessions: [] }).tree
  assert.deepEqual(nodes(empty).map(node => node.props.label).filter(Boolean), ['No Bot conversation is open.'])
  for (const report of [null, undefined, 'x', [], {}, { version: 2, sessions: [] }, { version: 2, unavailable: true }, { version: 1, sessions: 'x' }]) assert.equal(render(report).tree, null)
  // Rows of an unknown kind or shape are skipped; the rest still shows.
  const { permissionRows } = load()
  assert.deepEqual(permissionRows({ version: 1, sessions: [null, 'x', { kind: 'new' }, { kind: 'chat', botId: 'b2', saved: 7, effective: {}, unapplied: 'x', acp: 'x' }] }, undefined).map(row => row.label), ['A Bot'])
})

test('a read that failed is said, never shown as nothing open', async () => {
  const labels = tree => nodes(tree).map(node => node.props.label).filter(Boolean)
  // The host could not read it at all.
  assert.deepEqual(labels(render({ version: 1, unavailable: true }).tree), ['This could not be read just now.'])
  // It read no row and says a part failed: not "No Bot conversation is open."
  assert.deepEqual(labels(render({ version: 1, sessions: [], partial: true }).tree), ['This could not be read just now.'])
  // It read some rows and says a part failed.
  const some = render({ ...REPORT, partial: true }).tree
  assert.deepEqual(labels(some), ['Some of this could not be read just now.'])
  assert.ok(texts(some).includes('Ada · Launch'))
  assert.deepEqual(labels(render(REPORT).tree), [])

  // The request itself fails: the page says so once the failure arrives.
  const page = load(null)
  let cell = null
  const effects = []
  page.react.useState = () => [cell, (next) => { cell = next }]
  page.react.useEffect = (effect) => { effects.push(effect) }
  const actions = { diagnosticsPermissions: async () => { throw new Error('offline') } }
  const draw = () => page.PermissionDiagnostics({ actions, roster: ROSTER, Section: 'section', Row: 'row' })
  assert.equal(draw(), null)
  effects[0]()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(labels(draw()), ['This could not be read just now.'])
})

test('two levels the host found different are said so, also when both are custom', () => {
  const { permissionRows } = load()
  const level = row => permissionRows({ version: 1, sessions: [{ kind: 'chat', botId: 'b2', open: true, source: 'bot', ...row }] }, ROSTER)[0].level
  const custom = { saved: { value: 'custom' }, effective: { value: 'custom' } }
  assert.equal(level({ ...custom, differs: true }), 'Saved level: A custom level, set for the Bot · Running as: A custom level · The level in force here is not the saved one.')
  assert.equal(level({ ...custom, differs: false }), 'Saved level: A custom level, set for the Bot · Running as: A custom level')
  assert.equal(level(custom), 'Saved level: A custom level, set for the Bot · Running as: A custom level')
})

test('every string of the section has its Chinese and its pt-BR text', () => {
  const source = readFileSync(new URL('../src/client/permission-diagnostics.js', import.meta.url), 'utf8')
  const pt = JSON.parse(readFileSync(new URL('../../locale-pt-br-dsh/src/client/locales/pt-BR/omni-ui.json', import.meta.url), 'utf8'))
  // Every quoted text of the file that reads as copy: a capital or a space in it.
  const literals = [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map(match => (match[1] ?? match[2]).replace(/\\(.)/g, '$1'))
  const copy = literals.filter(text => /[A-Za-z]{2} /.test(text) && !/^(?:bt-|\.\/)/.test(text))
  assert.ok(copy.length > 40)
  for (const text of [...copy, 'Permissions', 'Task', 'A Bot']) {
    assert.ok(Object.hasOwn(DICTIONARY.zh, text), `no Chinese text: ${text}`)
    assert.ok(Object.hasOwn(pt, text) && pt[text] !== text, `no pt-BR text: ${text}`)
  }
})
