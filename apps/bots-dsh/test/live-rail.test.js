import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The rail's module as the browser gets it, with stand-ins for the platform it runs on.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/live-rail.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
const effects = []
const timers = []
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports,
  require: (name) => {
    const platform = {
      react: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect), useRef: initial => ({ current: initial }), useLayoutEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useSyncExternalStore: () => undefined, Fragment: 'fragment', forwardRef: fn => fn, memo: fn => fn, createContext: () => ({}), useContext: () => undefined },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
  document: undefined, window: undefined, Date, Math, JSON, Intl, setTimeout, clearTimeout,
  setInterval: (_tick, ms) => { timers.push(ms); return 'live-timer' }, clearInterval: id => timers.push(id),
})
const { liveOf, liveSummary, LiveRail, LiveTab, LIVE_CSS } = module.exports

test('native Live body takes its container room with no fixed rail or width reservation', () => {
  const roster = { byId: {}, tasks: {} }
  const body = LiveRail({ roster, actions: {}, useWork: select => select({}) })
  assert.equal(body.type, 'aside')
  assert.equal(body.props['aria-label'], 'Live')
  assert.equal(effects.length, 1, 'only the relative-time timer, no chatRoom geometry effect')
  const release = effects[0](); release()
  assert.deepEqual(timers, [30000, 'live-timer'])
  assert.doesNotMatch(LIVE_CSS, /position:fixed|width:320px|right:0/)
  assert.match(LIVE_CSS, /width:100%;height:100%;min-width:0/)
  const tab = LiveTab({ useRoster: select => select(roster), actions: {} })
  assert.equal(tab.type, LiveRail)
  assert.equal(tab.props.roster, roster)
})
// Cross-realm values compare by their plain JSON.
const plain = value => JSON.parse(JSON.stringify(value))

const roster = {
  byId: { omni: { id: 'omni', name: 'Omni' }, genie: { id: 'genie', name: 'Genie' }, writer: { id: 'writer', name: 'Writer' } },
  roomsById: { room: { id: 'room', name: 'You, Writer, Genie', members: ['writer', 'genie'] } },
  tasks: {
    t1: { from: 'genie', status: 'working', title: 'Add a README', at: 1_000 },
    t2: { from: 'genie', status: 'failed', title: 'Fix the test', summary: 'git is missing\nmore', at: 500, endedAt: 2_000 },
    t3: { from: 'genie', status: 'working', title: 'Waits on you', at: 900 },
    old: { from: 'genie', status: 'done', title: 'Long ago', at: 0, endedAt: 1 },
  },
}

test('the rail puts what needs you first, then what runs, then what just ended', () => {
  const work = {
    approvals: [
      { id: 'a1', botId: 'genie', taskId: 't3', tool: 'bash' },
      // A task gone from the roster still names itself from the approval's own label.
      { id: 'a2', botId: 'writer', taskId: 'gone', label: 'A task that ended', tool: 'bash' },
    ],
    bots: { omni: { tool: 'web_search' } },
    rooms: { room: [{ botId: 'writer' }, { botId: 'omni' }] },
  }
  const live = liveOf(work, roster, 6 * 60 * 60 * 1000 + 1_000)
  assert.deepEqual(plain(live.needs.map(item => [item.bot.name, item.tool, item.open])), [['Genie', 'bash', 't3'], ['Writer', 'bash', 'gone']])
  // The task that waits is named, not just its Bot.
  assert.deepEqual(live.needs.map(item => item.place), ['Waits on you', 'A task that ended'])
  // A Bot at work in its own chat and in a group is listed once; a waiting task is under Needs you.
  assert.deepEqual(plain(live.working.map(item => [item.key, item.open])), [['bot:omni', 'omni'], ['room:room:writer', 'room'], ['task:t1', 't1']])
  assert.equal(live.working[1].place, 'You, Writer, Genie')
  // Ended in the last six hours only, newest first, a failure naming why.
  assert.deepEqual(plain(live.ended.map(item => [item.title, item.label])), [['Fix the test', 'Failed: git is missing']])
})

test('Bots that are not on the team are left out', () => {
  const live = liveOf({ approvals: [{ id: 'x', botId: 'gone' }], bots: { gone: { tool: 'bash' } } }, { byId: {}, roomsById: {}, tasks: { t: { from: 'gone', status: 'working' } } })
  assert.deepEqual(plain(live), { needs: [], working: [], ended: [] })
})

test('the summary counts what needs you and what works', () => {
  assert.equal(liveSummary({ needs: [], working: [] }), 'nothing working')
  assert.equal(liveSummary({ needs: [{}], working: [{}, {}] }), '1 needs you · 2 working')
})

// #164. The rail lists ended tasks from the team's task records alone, three at most and
// six hours at most; these cases pin that window. A record forgotten past the host's cap
// (agents.js TASKS_KEPT, which now forgets ended tasks first and keeps the working ones)
// leaves the rail, and its Session goes back under the Tasks row (task-card.js).
const HOUR = 60 * 60 * 1000
test('ended tasks stay three at most, newest end first, and six hours at most', () => {
  const now = 10 * HOUR
  const ended = (title, endedAt) => ({ from: 'genie', status: 'stopped', title, at: 0, endedAt })
  const tasks = {
    a: ended('Event-driven Omni 1', now - 1 * HOUR),
    b: ended('Event-driven Omni 2', now - 2 * HOUR),
    c: ended('Bug 2 at the source', now - 3 * HOUR),
    wish: ended('Wish: Fix Claude wish permission denial reporting', now - 4 * HOUR),
    stale: ended('Ended long ago', now - 7 * HOUR),
  }
  const live = liveOf({}, { ...roster, tasks }, now)
  assert.deepEqual(plain(live.ended.map(item => [item.title, item.label])), [
    ['Event-driven Omni 1', 'Stopped'], ['Event-driven Omni 2', 'Stopped'], ['Bug 2 at the source', 'Stopped'],
  ])
  // Fewer ended tasks: the fourth is listed again, the one past six hours never is.
  delete tasks.a
  assert.deepEqual(plain(liveOf({}, { ...roster, tasks }, now).ended.map(item => item.open)), ['b', 'c', 'wish'])
})

const cardBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/task-card.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const cardModule = { exports: {} }
runInNewContext(cardBundle.outputFiles[0].text, {
  module: cardModule, exports: cardModule.exports,
  require: (name) => {
    if (name === 'react') return { createElement: () => null, useState: initial => [initial, () => {}], useEffect: () => {} }
    if (name === 'react-dom' || name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`no platform module ${name}`)
  },
  document: undefined, window: undefined, Date, Math, JSON, Intl, setTimeout, clearTimeout,
})
const { agentRowSessions } = cardModule.exports

test('a task Session with no task record is not in the rail but stays under the Tasks row', () => {
  const tasksRecord = { id: 'a:tasks', kind: 'tasks', sessions: ['kept', 'forgotten'] }
  const tasks = { kept: { from: 'genie', status: 'stopped', title: 'Kept', at: 0, endedAt: 1_000 } }
  const live = liveOf({}, { ...roster, tasks }, 2_000)
  assert.deepEqual(plain(live.ended.map(item => item.open)), ['kept'])
  // The kept task shows with its Bot (the rail, its chat); the forgotten one under Tasks.
  assert.deepEqual(plain(agentRowSessions(tasksRecord, { ...roster, tasks })), ['forgotten'])
})
