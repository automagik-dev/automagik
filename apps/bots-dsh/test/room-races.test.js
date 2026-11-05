import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

// #200, #205: a group change read the team, waited (for a Session or a folder check), and
// then wrote what it had read. A Bot deleted, or another change made, in that wait was undone.
const TEAM = {
  version: 1,
  mainBotIds: ['a'],
  workspaceId: 'w1',
  bots: {
    a: { id: 'a', name: 'Omni', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
    c: { id: 'c', name: 'Coder', role: 'Code', sessionId: 'c', createdAt: 3 },
    d: { id: 'd', name: 'Tester', role: 'Test', sessionId: 'd', createdAt: 4 },
  },
  rooms: { r1: { id: 'r1', name: 'Ops', named: true, members: ['a', 'b'], admin: 'a', mode: 'admin', notice: '' } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
}

async function start(team = TEAM) {
  // The project folder sits beside the team's data, which no Bot may work in.
  // The native realpath: on Windows the JS one keeps 8.3 short names.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ds-bot-room-races-')))
  const home = join(root, 'bot')
  const folder = join(root, 'project')
  for (const dir of [home, folder]) mkdirSync(dir)
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext()
  const archived = []
  let sessions = 0
  // While `hold` is set, the next Session waits until it is let go.
  let hold
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: {
      get: id => (id === 'w1' ? { id: 'w1', path: home } : undefined),
      resolveByPath: async () => undefined,
      create: async path => ({ id: 'w1', path }),
      archiveSession: async (sessionId) => { archived.push(sessionId) },
    },
    sessionController: {
      create: async () => {
        const sessionId = `s${++sessions}`
        if (hold !== undefined) await hold.promise
        return { sessionId }
      },
      resolveAgent: async sessionId => ({ agent: { id: sessionId, session: { id: sessionId }, followup() {} } }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const rt = createRuntime(ctx, { home })
  await rt.load()
  const held = () => {
    let release
    hold = { promise: new Promise(resolve => { release = resolve }) }
    return () => { hold = undefined; release() }
  }
  const saved = () => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  const stop = async () => {
    await ctx.dispose()
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
  return { rt, ctx, home, folder, archived, held, saved, stop }
}

// Holds the next call to `rt[method]` at its start until the test opens it, so two changes
// meet in one chosen order with no timers: `entered` settles once the call is waiting.
function gate(t, rt, method) {
  const original = rt[method]
  let enter
  let open
  const entered = new Promise(resolve => { enter = resolve })
  const opened = new Promise(resolve => { open = resolve })
  rt[method] = async (...args) => {
    rt[method] = original
    enter()
    await opened
    return original(...args)
  }
  t.after(() => { rt[method] = original })
  return { entered, open }
}

test('a Bot deleted while its group is made stays out of it, and so does the admin role it was given', async (t) => {
  const { rt, held, stop } = await start()
  t.after(stop)
  const release = held()
  const making = rt.createRoom({ name: 'Trio', members: ['a', 'b', 'c'], admin: 'c' })
  await rt.deleteBot('c')
  release()
  const room = await making
  assert.deepEqual(room.members, ['a', 'b'])
  // The lead goes to the Main Bot member, as for a group made without a chosen admin.
  assert.equal(room.admin, 'a')
})

test('a group left with one Bot by a deletion while it is made is not made', async (t) => {
  const { rt, held, archived, stop } = await start()
  t.after(stop)
  const release = held()
  const making = rt.createRoom({ name: 'Pair', members: ['b', 'c'] })
  await rt.deleteBot('c')
  release()
  await assert.rejects(making, /A group chat needs at least two Bots/)
  assert.deepEqual(Object.keys(rt.state.rooms), ['r1'])
  // Its Session was made already, so it is archived, not left over.
  assert.ok(archived.includes('s1'))
})

test('a change that waits for its folder keeps the member another change added meanwhile', async (t) => {
  const { rt, folder, saved, stop } = await start()
  t.after(stop)
  const moving = rt.updateRoom('r1', { add: ['c'], workDir: folder })
  const adding = rt.updateRoom('r1', { add: ['d'] })
  const [moved, added] = await Promise.all([moving, adding])
  assert.deepEqual(added.changes, ['added Tester'])
  assert.deepEqual(moved.changes, ['added Coder', `every member now works in ${folder} here`])
  assert.deepEqual(saved().rooms.r1.members, ['a', 'b', 'd', 'c'])
})

// #366: the folder change goes on while the deletion still waits on the Bot's Sessions.
test('a Bot whose deletion has begun is not added by a folder change that goes on first', async (t) => {
  const { rt, folder, saved, stop } = await start()
  t.after(stop)
  const folderCheck = gate(t, rt, 'cleanWorkDir')
  const release = gate(t, rt, 'releaseBot')
  const moving = rt.updateRoom('r1', { add: ['c'], workDir: folder })
  await folderCheck.entered
  const deleting = rt.deleteBot('c')
  await release.entered
  folderCheck.open()
  const moved = await moving
  // The folder change's own save does not write the Bot back while the deletion goes on.
  assert.deepEqual(saved().rooms.r1.members, ['a', 'b'])
  release.open()
  await deleting
  assert.deepEqual(moved.changes, [`every member now works in ${folder} here`])
  assert.deepEqual(moved.room.members, ['a', 'b'])
  assert.deepEqual(saved().rooms.r1.members, ['a', 'b'])
  assert.equal(saved().rooms.r1.workDir, folder)
  assert.equal(saved().bots.c, undefined)
})

// The deletion ends while the folder change still waits for its folder check.
test('a Bot deleted while a change waits for its folder is not added back', async (t) => {
  const { rt, folder, saved, stop } = await start()
  t.after(stop)
  const folderCheck = gate(t, rt, 'cleanWorkDir')
  const moving = rt.updateRoom('r1', { add: ['c'], workDir: folder })
  await folderCheck.entered
  await rt.deleteBot('c')
  folderCheck.open()
  const moved = await moving
  assert.deepEqual(moved.changes, [`every member now works in ${folder} here`])
  assert.deepEqual(moved.room.members, ['a', 'b'])
  assert.deepEqual(saved().rooms.r1.members, ['a', 'b'])
  assert.equal(saved().rooms.r1.workDir, folder)
  assert.equal(saved().bots.c, undefined)
})

// The deletion begins after the change added the Bot, while that change is being saved.
test('a Bot deleted while the change that added it is saved is not reported as added', async (t) => {
  const { rt, saved, stop } = await start()
  t.after(stop)
  const saving = gate(t, rt, 'save')
  const adding = rt.updateRoom('r1', { add: ['c'], notice: 'Ship on Friday' })
  await saving.entered
  assert.deepEqual(rt.state.rooms.r1.members, ['a', 'b', 'c'])
  const deleting = rt.deleteBot('c')
  saving.open()
  const [added] = await Promise.all([adding, deleting])
  assert.deepEqual(added.changes, ['updated the notice'])
  assert.deepEqual(saved().rooms.r1.members, ['a', 'b'])
  assert.equal(saved().bots.c, undefined)
})

test('a Bot added with a folder change and no deletion is added and reported', async (t) => {
  const { rt, folder, saved, stop } = await start()
  t.after(stop)
  const moved = await rt.updateRoom('r1', { add: ['c'], workDir: folder })
  assert.deepEqual(moved.changes, ['added Coder', `every member now works in ${folder} here`])
  assert.deepEqual(saved().rooms.r1.members, ['a', 'b', 'c'])
})

test('a deletion whose release fails puts the Bot back and keeps a change made meanwhile', async (t) => {
  const team = { ...TEAM, rooms: { r1: { ...TEAM.rooms.r1, members: ['a', 'c', 'b'], admin: 'c' } } }
  const { rt, saved, stop } = await start(team)
  t.after(stop)
  const releaseBot = rt.releaseBot
  let fail
  rt.releaseBot = () => new Promise((resolve, reject) => { fail = reject })
  t.after(() => { rt.releaseBot = releaseBot })
  const deleting = rt.deleteBot('c')
  // While its Sessions are released, the Bot is out of the group and cannot lead it.
  assert.deepEqual([rt.state.rooms.r1.members, rt.state.rooms.r1.admin], [['a', 'b'], null])
  assert.deepEqual((await rt.updateRoom('r1', { add: ['d'] })).changes, ['added Tester'])
  fail(new Error('release failed'))
  await assert.rejects(deleting, /release failed/)
  assert.deepEqual([rt.state.rooms.r1.members, rt.state.rooms.r1.admin], [['a', 'c', 'b', 'd'], 'c'])
  assert.ok(rt.botOf('c'))
  // The deletion is over, so the Bot can be changed, and deleted, again.
  rt.releaseBot = releaseBot
  assert.deepEqual((await rt.updateRoom('r1', { remove: ['d'] })).changes, ['removed Tester'])
  await rt.deleteBot('c')
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'b'], null])
  assert.equal(saved().bots.c, undefined)
})

// #376: Coder leads the group, and has btw cards and side chats on disk.
const LEADS = { ...TEAM, rooms: { r1: { ...TEAM.rooms.r1, members: ['a', 'c', 'b'], admin: 'c' } } }
function keptFiles(home) {
  const card = { id: 'kept', botId: 'c', partId: 'c', atSeq: 1, question: 'Old?', answer: 'Yes.', status: 'done', createdAt: 5, finishedAt: 6 }
  const cards = join(home, 'btw', 'c')
  const chats = join(home, 'side', 'c.json')
  mkdirSync(cards, { recursive: true })
  writeFileSync(join(cards, 'c.json'), JSON.stringify([card]))
  mkdirSync(join(home, 'side'))
  writeFileSync(chats, '[]')
  return [cards, chats]
}

// Holds the next call to `rt[method]` until the test fails it, with no timers: `entered`
// settles once the call is waiting, and `fail` rejects it.
function failing(t, rt, method) {
  const original = rt[method]
  let enter
  let reject
  const entered = new Promise(resolve => { enter = resolve })
  rt[method] = () => new Promise((resolve, fail) => {
    rt[method] = original
    reject = fail
    enter()
  })
  t.after(() => { rt[method] = original })
  return { entered, fail: error => reject(error) }
}

// #376: the drop steps ran before releaseBot, so a failed release lost the files.
test('a deletion whose release fails keeps the Bot\'s cards and side chats, and saves its place', async (t) => {
  const { rt, home, saved, stop } = await start(LEADS)
  t.after(stop)
  const files = keptFiles(home)
  const release = failing(t, rt, 'releaseBot')
  const deleting = rt.deleteBot('c')
  await release.entered
  release.fail(new Error('release failed'))
  await assert.rejects(deleting, /release failed/)
  for (const file of files) assert.equal(existsSync(file), true, `${file} is kept`)
  assert.deepEqual([rt.state.rooms.r1.members, rt.state.rooms.r1.admin], [['a', 'c', 'b'], 'c'])
  // The restore is saved, not left for the next save to write.
  assert.ok(saved().revision > LEADS.revision, 'the restore was saved')
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'c', 'b'], 'c'])
  assert.ok(saved().bots.c)
  // The Bot is usable: it can be changed, and deleted, which then drops its files.
  assert.deepEqual((await rt.updateRoom('r1', { notice: 'Ship on Friday' })).changes, ['updated the notice'])
  await rt.deleteBot('c')
  for (const file of files) assert.equal(existsSync(file), false, `${file} is removed`)
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'b'], null])
  assert.equal(saved().bots.c, undefined)
})

// #376: a save in the window wrote the group without the Bot, and the restore was memory only.
test('a group saved while a deletion fails has the Bot and its admin role back on disk', async (t) => {
  const { rt, saved, stop } = await start(LEADS)
  t.after(stop)
  const release = failing(t, rt, 'releaseBot')
  const deleting = rt.deleteBot('c')
  await release.entered
  assert.deepEqual((await rt.updateRoom('r1', { add: ['d'] })).changes, ['added Tester'])
  // That save wrote the group as it is while the Bot is released: without it.
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'b', 'd'], null])
  release.fail(new Error('release failed'))
  await assert.rejects(deleting, /release failed/)
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'c', 'b', 'd'], 'c'])
  assert.deepEqual([rt.state.rooms.r1.members, rt.state.rooms.r1.admin], [['a', 'c', 'b', 'd'], 'c'])
})

// #376: a second deletion while the first ran threw Unknown Bot, though the Bot was there.
test('a second deletion of a Bot being deleted ends with the first, which runs once', async (t) => {
  const { rt, home, saved, stop } = await start(LEADS)
  t.after(stop)
  const files = keptFiles(home)
  const releaseBot = rt.releaseBot
  let releases = 0
  rt.releaseBot = (...args) => { releases += 1; return releaseBot(...args) }
  t.after(() => { rt.releaseBot = releaseBot })
  const release = gate(t, rt, 'releaseBot')
  const deleting = rt.deleteBot('c')
  await release.entered
  const again = rt.deleteBot('c')
  release.open()
  await Promise.all([deleting, again])
  assert.equal(releases, 1)
  assert.equal(rt.botOf('c'), undefined)
  assert.equal(saved().bots.c, undefined)
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'b'], null])
  for (const file of files) assert.equal(existsSync(file), false, `${file} is removed`)
  // Once the deletion is over, the Bot is unknown.
  await assert.rejects(rt.deleteBot('c'), /Unknown Bot/)
})

test('a second deletion of a Bot whose release then fails fails with it, and the Bot stays', async (t) => {
  const { rt, saved, stop } = await start(LEADS)
  t.after(stop)
  const release = failing(t, rt, 'releaseBot')
  const deleting = rt.deleteBot('c')
  await release.entered
  const again = rt.deleteBot('c')
  release.fail(new Error('release failed'))
  await assert.rejects(deleting, /release failed/)
  await assert.rejects(again, /release failed/)
  assert.ok(rt.botOf('c'))
  assert.deepEqual([rt.state.rooms.r1.members, rt.state.rooms.r1.admin], [['a', 'c', 'b'], 'c'])
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'c', 'b'], 'c'])
})

test('a group deleted while a change waits for its folder stays deleted', async (t) => {
  const { rt, folder, saved, stop } = await start()
  t.after(stop)
  const refused = assert.rejects(rt.updateRoom('r1', { workDir: folder }), /Unknown group chat/)
  await rt.deleteRoom('r1')
  await refused
  assert.deepEqual(saved().rooms, {})
})

test('a group left with one Bot can still change its settings, but not lose another member', async (t) => {
  const { rt, stop } = await start()
  t.after(stop)
  await rt.deleteBot('b')
  assert.deepEqual(rt.state.rooms.r1.members, ['a'])
  assert.deepEqual((await rt.updateRoom('r1', { notice: 'Ship on Friday' })).changes, ['updated the notice'])
  assert.deepEqual((await rt.updateRoom('r1', { add: ['c'] })).changes, ['added Coder'])
  await assert.rejects(rt.updateRoom('r1', { remove: ['c'] }), /A group chat needs at least two Bots/)
})

test('a team saved with a deleted Bot in a group, even as its admin, loads without it', async (t) => {
  const team = { ...TEAM, rooms: { r1: { ...TEAM.rooms.r1, members: ['a', 'b', 'gone'], admin: 'gone' } } }
  const { rt, saved, stop } = await start(team)
  t.after(stop)
  assert.deepEqual([rt.state.rooms.r1.members, rt.state.rooms.r1.admin], [['a', 'b'], null])
  assert.deepEqual([saved().rooms.r1.members, saved().rooms.r1.admin], [['a', 'b'], null])
})
