import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The first Main Bot is a sidebar row like the others: pinned first, a larger avatar
// wearing the crown, its role beside its name, and the status line, badges and unread dot
// every row has. The sidebar runs on a minimal React stand-in, as in sidebar-switch.test.js:
// components are plain functions, and the test calls the ones it looks into.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: {
    contents: "export { TeamSidebar } from './src/client/sidebar.js'\nexport { badges } from './src/client/extend.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id', useCallback: fn => fn,
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : {}),
  window: { innerWidth: 1280, matchMedia: () => ({ matches: false }) },
  document: { body: { dataset: {} } },
  matchMedia: () => ({ matches: false }),
})
const { TeamSidebar } = module.exports

const pip = { id: 'pip', name: 'Pip', role: 'Orchestrator', sessionId: 'pip', createdAt: 1 }
const omni = { id: 'omni', name: 'Omni', role: 'Channel keeper', kind: 'omni', sessionId: 'omni', createdAt: 2 }
const roster = {
  bots: [pip, omni], rooms: [], agents: [], byId: { pip, omni }, roomsById: {}, agentOf: {},
  mainBotId: 'pip', mainBotIds: ['pip'], exchangeTurns: {}, questions: {}, ready: true,
}

const find = (node, match, found = []) => {
  if (Array.isArray(node)) { node.forEach(child => find(child, match, found)); return found }
  if (!node || typeof node !== 'object') return found
  if (match(node)) found.push(node)
  find(node.props?.children, match, found)
  return found
}
const named = name => node => node.type?.name === name
const textOf = node => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '')

function sidebar({ wide = true, unread = false } = {}) {
  const tree = TeamSidebar({
    wide, actions: {},
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {} }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: {} }), useUpdate: () => ({}),
    useSessionStatus: pick => pick(new Map(unread ? [['pip', { completionUnread: true }]] : [])),
    useSessionRetainInfo: (_id, pick) => pick(undefined),
    useActivity: pick => pick({}),
    useWork: pick => pick({ approvals: [], rooms: {}, waiting: {} }),
  })
  const rows = find(tree, named('BotRow'))
  // A row renders by calling it with its props, as React would.
  const render = row => row.type(row.props)
  return { tree, rows, render }
}

test('the first Main Bot is the first row, crowned, with its role and the Main Bot label', () => {
  const { tree, rows, render } = sidebar()
  assert.equal(find(tree, node => node.props?.className === 'bt-tile' || node.props?.className === 'bt-tile-wrap').length, 0, 'no tile')
  assert.deepEqual(rows.map(row => row.props.bot.id), ['pip', 'omni'])
  const row = render(rows[0])
  assert.equal(row.type, 'button')
  assert.equal(row.props.className, 'bt-row bt-row-crowned')
  assert.match(row.props['aria-label'], /^Pip, Orchestrator, Main Bot/)
  const [avatar] = find(row, named('BotAvatar'))
  assert.equal(avatar.props.size, 42)
  assert.equal(avatar.props.crown, true)
  // The crown takes the Main Bot star's place.
  const mark = avatar.type(avatar.props)
  assert.equal(find(mark, named('Crown')).length, 1)
  assert.equal(find(mark, node => node.props?.className === 'bt-badge bt-badge-main').length, 0)
  const [chip] = find(row, node => node.props?.className === 'bt-role')
  assert.equal(textOf(chip), 'Orchestrator')
  // Badges other plugins add (Omni's events badge among them) render on its row.
  assert.equal(find(row, named('RowBadges')).length, 1)
  // Its children (what other plugins hang under a Bot) follow it too.
  assert.ok(find(tree, named('BotChildren')).some(node => node.props.bot.id === 'pip'))
})

test('the crowned row shows unread, and only it wears the crown and the role', () => {
  const { rows, render } = sidebar({ unread: true })
  const row = render(rows[0])
  assert.equal(find(row, node => node.props?.className === 'bt-unread').length, 1)
  const other = render(rows[1])
  assert.equal(other.props.className, 'bt-row')
  assert.equal(find(other, named('BotAvatar'))[0].props.crown, false)
  assert.equal(find(other, named('BotAvatar'))[0].props.size, 36)
  assert.equal(find(other, node => node.props?.className === 'bt-role').length, 0)
})

test('in the narrow rail the crowned row keeps the crown at the rail size', () => {
  const { rows, render } = sidebar({ wide: false })
  const row = render(rows[0])
  const [avatar] = find(row, named('BotAvatar'))
  assert.equal(avatar.props.size, 36)
  assert.equal(avatar.props.crown, true)
  assert.equal(row.props.title, 'Pip')
})
