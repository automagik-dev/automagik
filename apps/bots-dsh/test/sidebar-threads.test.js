import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// A Bot's running tasks hang under its row as threads, and its task card in the chat shows
// the same state: working, or waiting for the user. The sidebar and the card run on a
// minimal React stand-in, as in sidebar-switch.test.js; the test calls the components it
// looks into.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: {
    contents: "export { TeamSidebar, threadAge, THREADS_SHOWN } from './src/client/sidebar.js'\nexport { TaskCard, taskState } from './src/client/task-card.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
let stateSets = []
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {}, useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id', useCallback: fn => fn,
  useState: (initial) => {
    const set = value => stateSets.push(value)
    return [typeof initial === 'function' ? initial() : initial, set]
  },
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : {}),
  window: { innerWidth: 1280, matchMedia: () => ({ matches: false }) },
  matchMedia: () => ({ matches: false }),
})
const { TeamSidebar, TaskCard, taskState, threadAge, THREADS_SHOWN } = module.exports

const find = (node, match, found = []) => {
  if (Array.isArray(node)) { node.forEach(child => find(child, match, found)); return found }
  if (!node || typeof node !== 'object') return found
  if (match(node)) found.push(node)
  find(node.props?.children, match, found)
  return found
}
const named = name => node => node.type?.name === name
const textOf = node => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '')

const NOW = Date.now()
const pip = { id: 'pip', name: 'Pip', role: 'Orchestrator', sessionId: 'pip', createdAt: 1 }
const omni = { id: 'omni', name: 'Omni', kind: 'omni', sessionId: 'omni', createdAt: 2 }

function sidebar({ tasks, waiting = [], approvals = [], wide = true, agents = [] }) {
  const roster = {
    bots: [pip, omni], rooms: [], agents, byId: { pip, omni }, roomsById: {}, agentOf: {},
    mainBotId: 'pip', mainBotIds: ['pip'], exchangeTurns: {}, questions: {}, ready: true, tasks,
  }
  const opened = []
  const status = new Map(waiting.map(id => [id, { pendingInteraction: { kind: 'approval' } }]))
  const tree = TeamSidebar({
    wide, actions: { openSession: id => opened.push(id) },
    useRoster: pick => pick(roster), useUi: pick => pick({ unread: {} }), useRegistry: pick => pick({}),
    useSessions: pick => pick({ ids: [], byId: { 'session-a': { retainedBy: { mainView: 1 } } } }), useUpdate: () => ({}),
    useSessionStatus: pick => pick(status),
    useSessionRetainInfo: (_id, pick) => pick(undefined),
    useActivity: pick => pick({}),
    useWork: pick => pick({ approvals, rooms: {}, waiting: {} }),
  })
  const threadsOf = id => find(tree, named('BotThreads')).find(node => node.props.bot.id === id)
  const rowOf = id => find(tree, named('BotRow')).find(node => node.props.bot.id === id)
  return { tree, opened, threadsOf, rowOf }
}

const task = (from, title, minutes, status = 'working') => ({ from, title, at: NOW - minutes * 60_000, status })

test('a Bot\'s running tasks hang under its row: spinner while working, amber while waiting for you', () => {
  const { threadsOf, rowOf, opened } = sidebar({
    tasks: {
      'session-a': task('pip', 'Plan the launch week', 4),
      'session-b': task('pip', 'Approve: send summary to Ana?', 0),
      'session-c': task('pip', 'Old report', 90, 'done'),
      'session-d': task('omni', 'Triage 12 unread in #support', 1),
    },
    waiting: ['session-b'],
  })
  const threads = threadsOf('pip')
  const group = threads.type(threads.props)
  const rows = find(group, node => node.props?.className === 'bt-thread')
  // Waiting comes first; a finished task is not a thread.
  assert.deepEqual(rows.map(row => row.props['data-state']), ['waiting', 'working'])
  assert.deepEqual(rows.map(row => textOf(find(row, node => node.props?.className === 'bt-thread-title'))), ['Approve: send summary to Ana?', 'Plan the launch week'])
  assert.equal(find(rows[0], node => node.props?.className === 'bt-thread-wait').length, 1)
  assert.equal(find(rows[1], node => node.props?.className === 'bt-thread-spin').length, 1)
  assert.deepEqual(rows.map(row => textOf(find(row, node => node.props?.className === 'bt-thread-age'))), ['now', '4m'])
  assert.equal(rows[0].props['aria-label'], 'Approve: send summary to Ana?, Waiting for you')
  // The task open in the main view is marked.
  assert.equal(rows[1].props['aria-current'], 'page')
  rows[0].props.onClick()
  assert.deepEqual(opened, ['session-b'])
  // The Omni Bot has its own.
  const omniRows = find(threadsOf('omni').type(threadsOf('omni').props), node => node.props?.className === 'bt-thread')
  assert.equal(omniRows.length, 1)
  // The row says how many things the Bot is on.
  const row = rowOf('pip').type(rowOf('pip').props)
  assert.equal(textOf(find(row, node => node.props?.className === 'bt-row-preview')), 'Working on 2 things')
})

test('past three threads the rest fold into a count, which unfolds them', () => {
  const tasks = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`session-${index}`, task('pip', `Task ${index}`, index + 1)]))
  const { threadsOf } = sidebar({ tasks })
  const threads = threadsOf('pip')
  const group = threads.type(threads.props)
  const rows = find(group, node => node.props?.className === 'bt-thread')
  assert.equal(rows.length, THREADS_SHOWN)
  const [more] = find(group, node => node.props?.className === 'bt-thread bt-thread-more')
  assert.equal(textOf(more), '+3 more')
  stateSets = []
  more.props.onClick()
  assert.deepEqual(stateSets, [true])
  // Four fit without a count: a "+1 more" row would take the same room.
  const four = sidebar({ tasks: Object.fromEntries(Object.entries(tasks).slice(0, 4)) }).threadsOf('pip')
  const fourGroup = four.type(four.props)
  assert.equal(find(fourGroup, node => node.props?.className === 'bt-thread').length, 4)
})

test('no threads in the narrow rail, nor for a Bot with no running task', () => {
  const narrow = sidebar({ tasks: { 'session-a': task('pip', 'Plan', 2) }, wide: false }).threadsOf('pip')
  assert.equal(narrow.type(narrow.props), null)
  const idle = sidebar({ tasks: {} }).threadsOf('pip')
  assert.equal(idle.type(idle.props), null)
})

test('a thread\'s age is short', () => {
  assert.equal(threadAge(NOW - 20_000, NOW), 'now')
  assert.equal(threadAge(NOW - 4 * 60_000, NOW), '4m')
  assert.equal(threadAge(NOW - 3 * 3_600_000, NOW), '3h')
  assert.equal(threadAge(NOW - 50 * 3_600_000, NOW), '2d')
})

test('the task card in the chat shows the same state as the thread', () => {
  assert.equal(taskState({ status: 'working' }, true), 'waiting')
  assert.equal(taskState({ status: 'working' }, false), 'working')
  assert.equal(taskState({ status: 'done' }, true), 'done')
  const card = (waiting) => TaskCard({
    sessionId: 'session-b', title: 'Send summary to Ana?', task: task('pip', 'Send summary to Ana?', 0), onOpen() {},
    useSessionStatus: pick => pick(new Map(waiting ? [['session-b', { pendingInteraction: { kind: 'approval' } }]] : [])),
  })
  const waiting = card(true)
  assert.equal(waiting.props['data-state'], 'waiting')
  assert.match(textOf(waiting), /Waiting for you/)
  assert.equal(find(waiting, node => node.props?.className === 'op-task-wait').length, 1)
  assert.match(textOf(waiting), /Answer it/)
  const working = card(false)
  assert.equal(working.props['data-state'], 'working')
  assert.match(textOf(working), /Task running/)
  // Without the shell's status hook the card still draws, as working.
  assert.equal(TaskCard({ sessionId: 'session-b', title: 'x', task: task('pip', 'x', 0) }).props['data-state'], 'working')
})

test('a task waiting on an approval the host noted for it is amber too, in the sidebar and its card', () => {
  const approvals = [{ id: 'k1', sessionId: 'session-a', botId: 'pip', taskId: 'session-a', tool: 'bash' }]
  const { threadsOf } = sidebar({ tasks: { 'session-a': task('pip', 'Deploy the site', 2) }, approvals })
  const group = threadsOf('pip').type(threadsOf('pip').props)
  assert.deepEqual(find(group, node => node.props?.className === 'bt-thread').map(row => row.props['data-state']), ['waiting'])
  const card = TaskCard({
    sessionId: 'session-a', title: 'Deploy the site', task: task('pip', 'Deploy the site', 2),
    useSessionStatus: pick => pick(new Map()), useWork: pick => pick({ approvals }),
  })
  assert.equal(card.props['data-state'], 'waiting')
})

test('a task a Bot started is listed under that Bot, not under Tasks; a DSH bot lists all its Sessions', () => {
  const tasks = { id: 'tasks', kind: 'tasks', name: 'Tasks', sessions: ['from-pip', 'from-gone'], createdAt: 3 }
  const site = { id: 'site', kind: 'dsh', name: 'Site', sessions: ['one', 'two'], createdAt: 4 }
  const team = agents => sidebar({
    agents,
    tasks: {
      'from-pip': task('pip', 'Wish: hello', 2, 'done'),
      // Its Bot was deleted: the task stays findable under Tasks.
      'from-gone': task('gone', 'Old chore', 5, 'done'),
    },
  })
  const rows = find(team([tasks, site]).tree, named('AgentRow')).map(row => row.type(row.props).props.children)
  const listed = Object.fromEntries(rows.map(([head, list]) => [head.props['aria-label'], find(list, named('AgentSessionRow')).map(node => node.props.session.id).sort()]))
  assert.deepEqual(listed, { Tasks: ['from-gone'], Site: ['one', 'two'] })
  // Without a task whose Bot is gone, there is no Tasks row.
  const [alone] = find(team([{ ...tasks, sessions: ['from-pip'] }]).tree, named('AgentRow'))
  assert.equal(alone.type(alone.props), null)
})

test('an ended task card says how it ended: a failed one names why, a stopped one is not finished', () => {
  const kicker = task => textOf(find(TaskCard({ sessionId: 's', title: 'Wish', task }), node => node.props?.className === 'op-task-kicker')[0])
  const ended = (status, summary) => ({ from: 'pip', title: 'Wish', at: NOW - 1000, endedAt: NOW, status, summary })
  assert.equal(kicker(ended('failed', 'the provider refused the key\nat step 3')), 'Failed: the provider refused the key')
  assert.equal(kicker(ended('failed', '')), 'Failed')
  assert.equal(kicker(ended('stopped', 'half done')), 'Stopped')
  assert.equal(kicker(ended('done', 'all done')), 'Task finished')
})
