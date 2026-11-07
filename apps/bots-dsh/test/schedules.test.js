import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { reminderText } from '../src/host/schedules.js'

const TEAM = {
  version: 1,
  mainBotIds: ['m1'],
  revision: 1,
  bots: {
    m1: { id: 'm1', sessionId: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: '', createdAt: 1 },
    w1: { id: 'w1', sessionId: 'w2', name: 'Writer', role: '', instructions: '', createdAt: 2, segments: [{ sessionId: 'w1', endedAt: 3 }] },
  },
  rooms: { g1: { id: 'g1', name: 'Launch', named: true, members: ['m1', 'w1'], admin: 'm1', mode: 'admin', notice: '', createdAt: 4 } },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

// An in-memory stand-in for DSH 0.2.2's schedule service: typed timing, target-based
// create, and edit({ action: 'delete' }) — the API apps/bots-dsh/src/host/schedules.js uses.
function scheduleService() {
  const tasks = new Map()
  let next = 1
  return {
    tasks,
    async create(request, actorSessionId) {
      const id = `schedule-${next++}`
      const timing = request.timing
      const entry = {
        id,
        kind: timing.kind,
        title: request.title,
        prompt: request.prompt,
        scheduledAt: timing.kind === 'at' ? timing.at : '2030-01-01T01:00:00.000Z',
        everySeconds: timing.every_seconds,
        time: timing.daily?.time ?? timing.weekly?.time,
        timeZone: timing.daily?.time_zone ?? timing.weekly?.time_zone ?? timing.cron?.time_zone,
        weekdays: timing.weekly?.weekdays,
        expression: timing.cron?.expression,
        rrule: timing.rrule,
        request,
        target: request.target,
        // DSH records the acting Session and the named target as involved.
        involvedSessionIds: [...new Set([
          ...(actorSessionId === undefined ? [] : [actorSessionId]),
          ...(request.target?.kind === 'new' ? [] : [request.target?.sessionId]),
        ])],
        status: 'active',
      }
      tasks.set(id, entry)
      return entry
    },
    async catalog() { return [...tasks.values()].map(entry => ({ ...entry })) },
    async edit({ id, action, patch }) {
      if (!tasks.has(id)) return { id, deleted: false, code: 'schedule_not_found' }
      if (action === 'delete') {
        tasks.delete(id)
        return { id, deleted: true }
      }
      if (action !== 'update') throw new Error(`unexpected edit ${action}`)
      const entry = tasks.get(id)
      if (patch?.active === false) entry.status = 'paused'
      else if (patch?.active === true) entry.status = 'active'
      return entry
    },
  }
}

function setup(services = {}, team = TEAM) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-schedules-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext({ services })
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => { ctx.route = route; return register(route) }
  const rt = createRuntime(ctx, { home })
  const call = async (endpoint, payload) => (await ctx.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  return { ctx, home, call, rt }
}

test('without the schedule service the page says so and creating is refused', async (t) => {
  const { ctx, home, call } = setup()
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  assert.deepEqual((await call('schedules', {})).value, { available: false, tasks: [] })
  const refused = await call('schedule-create', { target: 'm1', title: 'Briefing', prompt: 'Sum up', when: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /Automation tasks are off/)
})

test('tasks are created on the Bot’s current part, listed by Bot, and deleted', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const daily = await call('schedule-create', { target: 'w1', title: ' Briefing ', prompt: 'Sum up the day', when: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } })
  assert.equal(daily.ok, true, JSON.stringify(daily))
  const [created] = [...schedule.tasks.values()]
  assert.equal(created.target.sessionId, 'w2')
  assert.deepEqual(created.request.timing, { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } })
  assert.equal(created.title, 'Briefing')

  await schedule.create({ title: 'Old part', prompt: 'x', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'w1' } })
  await schedule.create({ title: 'Not ours', prompt: 'x', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'outside' } })
  const listed = (await call('schedules', {})).value
  assert.equal(listed.available, true)
  assert.deepEqual(listed.tasks.map(task => [task.title, task.botId]), [['Briefing', 'w1'], ['Old part', 'w1']])

  const weekly = await call('schedule-create', { target: 'm1', title: 'Week', prompt: 'Plan', when: { kind: 'weekly', time: '18:30', timeZone: 'UTC', weekdays: [5, 1, 1, 9] } })
  assert.equal(weekly.ok, true)
  assert.deepEqual([...schedule.tasks.values()].at(-1).request.timing, { kind: 'weekly', weekly: { time: '18:30:00', time_zone: 'UTC', weekdays: [1, 5] } })
  const every = await call('schedule-create', { target: 'm1', title: 'Ping', prompt: 'Check', when: { kind: 'every', minutes: 30 } })
  assert.deepEqual([...schedule.tasks.values()].at(-1).request.timing, { kind: 'every', every_seconds: 1800 }, JSON.stringify(every))

  for (const [when, message] of [
    [{ kind: 'at', at: '2000-01-01T00:00:00Z' }, /future/],
    [{ kind: 'weekly', time: '09:00', weekdays: [] }, /at least one day/],
    [{ kind: 'daily', time: '9am' }, /time of day/],
    [{ kind: 'every', minutes: 0 }, /1 minute to 7 days/],
  ]) {
    const refused = await call('schedule-create', { target: 'm1', title: 'x', prompt: 'y', when })
    assert.match(refused.error.message, message)
  }
  assert.match((await call('schedule-create', { target: 'm1', title: '', prompt: 'y', when: { kind: 'every', minutes: 5 } })).error.message, /name/)

  const removed = await call('schedule-delete', { sessionId: 'w2', id: created.id })
  assert.deepEqual(removed.value.tasks.map(task => task.title), ['Old part', 'Week', 'Ping'])
  assert.match((await call('schedule-delete', { sessionId: 'outside', id: 'schedule-3' })).error.message, /No such task/)
})

test('a group chat task lives on the group Session and lists under the group', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const made = await call('schedule-create', { target: 'g1', title: 'Standup', prompt: 'Where are we?', when: { kind: 'daily', time: '10:00', timeZone: 'UTC' } })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal([...schedule.tasks.values()][0].target.sessionId, 'g1')
  assert.deepEqual(made.value.tasks.map(task => [task.title, task.roomId, task.botId]), [['Standup', 'g1', undefined]])
  assert.match((await call('schedule-create', { target: 'nobody', title: 'x', prompt: 'y', when: { kind: 'every', minutes: 5 } })).error.message, /No such Bot or group chat/)
})

test('a due reminder reaches a group as its prompts', () => {
  const one = ['[SCHEDULE REMINDER]', 'framing', 'schedule_id_json: "s1"', 'occurrence_at: 2030-01-01T00:00:00Z', 'reminder_prompt_json: "Where are we?"'].join('\n')
  assert.equal(reminderText(one), '[Scheduled task] Where are we?')
  const batch = ['[SCHEDULE REMINDER BATCH]', 'framing', `reminders_json: ${JSON.stringify([{ schedule_id: 'a', reminder_prompt: 'One' }, { schedule_id: 'b', reminder_prompt: 'Two' }])}`].join('\n')
  assert.equal(reminderText(batch), '[Scheduled task] One\n[Scheduled task] Two')
  assert.equal(reminderText('plain text'), 'plain text')
})

test('a failed task move can resume without losing identical remaining tasks', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const seed = { title: 'Ping', prompt: 'Check', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'session', sessionId: 'w2' } }
  await schedule.create(seed)
  await schedule.create(seed)
  // The Bot's own schedule tool makes rrule tasks on 0.2.2; a rotation must carry them too.
  await schedule.create({ title: 'Bot task', prompt: 'Check the build', timing: { kind: 'rrule', rrule: 'DTSTART:20300101T090000Z\nRRULE:FREQ=DAILY' }, target: { kind: 'session', sessionId: 'w2' } })

  const create = schedule.create
  let attempts = 0
  schedule.create = async (...args) => {
    if (++attempts === 2) throw new Error('down')
    return create(...args)
  }
  await assert.rejects(rt.moveSchedules('w2', 's9'), /down/)
  const on = id => [...schedule.tasks.values()].filter(task => task.target.sessionId === id)
  assert.equal(on('s9').length, 1)
  assert.equal(on('w2').length, 2)

  schedule.create = create
  await rt.moveSchedules('w2', 's9')
  assert.equal(on('s9').length, 3)
  assert.equal(on('w2').length, 0)
  const movedRrule = on('s9').find(task => task.request.timing.kind === 'rrule')
  assert.equal(movedRrule?.request.timing.rrule, 'DTSTART:20300101T090000Z\nRRULE:FREQ=DAILY')
})

// #584, L5: a fresh-Session target (`new`/`new_once`) opens a Session no deny layer binds.
// A restricted Bot's already-armed tasks are paused; the record stays so the user can see it.
const freshTask = (schedule, actor, title = 'Nightly') => schedule.create({
  title, prompt: 'Check the build', timing: { kind: 'every', every_seconds: 3600 },
  target: { kind: 'new', create: { cwd: '/tmp' } },
}, actor)

test('restricting a Bot pauses the fresh-Session tasks its Sessions armed', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  await rt.load()
  // Armed by w1's own chat (`w2`) before it had a deny list.
  const fresh = await freshTask(schedule, 'w2')
  const bound = await schedule.create({
    title: 'Reminder', prompt: 'Check', timing: { kind: 'every', every_seconds: 3600 },
    target: { kind: 'session', sessionId: 'w2' },
  }, 'w2')
  const outside = await freshTask(schedule, 'outside', 'Elsewhere')
  // A `new_once` task is rewritten to its fresh Session after the first delivery; that
  // Session has no lineage, so the task is still unbound.
  const delivered = await schedule.create({
    title: 'Once', prompt: 'Check', timing: { kind: 'every', every_seconds: 3600 },
    target: { kind: 'session', sessionId: 'fresh-1' },
  }, 'w2')
  // An unrestricted Bot keeps its fresh-Session task, whatever the sweep sees.
  await rt.revokeNewSchedules()
  assert.equal(schedule.tasks.get(fresh.id).status, 'active')
  // The user's settings restrict it: its fresh-Session tasks pause, the bound one stays.
  await rt.updateBot('w1', { denyTools: ['bash'] })
  assert.equal(schedule.tasks.get(fresh.id).status, 'paused')
  assert.equal(schedule.tasks.get(delivered.id).status, 'paused')
  assert.equal(schedule.tasks.get(bound.id).status, 'active')
  assert.equal(schedule.tasks.get(outside.id).status, 'active')
})

// DSH's live registry holds loaded Sessions only; the durable copy keeps a child's
// parent and subagent origin after it ends or before it reopens on a restart.
const durableChild = async id => (id === 'child-1'
  ? { header: { origin: 'subagent', parentSession: 'w2' } }
  : undefined)

test('a subagent child that is no longer live resolves through its durable header', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  ctx.sessions = undefined
  ctx.sessionPersistence = { stat: durableChild }
  await rt.load()
  const armed = await freshTask(schedule, 'child-1', 'Child')
  await rt.updateBot('w1', { denyTools: ['bash'] })
  assert.equal(schedule.tasks.get(armed.id).status, 'paused')
})

test('a restart with a restricted Bot pauses a child-armed task that is not live', async (t) => {
  const schedule = scheduleService()
  const armed = await freshTask(schedule, 'child-1', 'Child')
  const team = JSON.parse(JSON.stringify(TEAM))
  team.bots.w1.denyTools = ['bash']
  const { ctx, home, rt } = setup({ schedule }, team)
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  ctx.sessionPersistence = { stat: durableChild }
  await rt.load()
  for (let index = 0; index < 100 && schedule.tasks.get(armed.id).status === 'active'; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(schedule.tasks.get(armed.id).status, 'paused')
})

test('a pause that the schedule service refuses blocks unlineaged deliveries', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  await rt.load()
  const armed = await freshTask(schedule, 'w2')
  const edit = schedule.edit
  schedule.edit = async request => {
    if (request.action === 'update') throw new Error('schedule store is busy')
    return edit(request)
  }
  await rt.updateBot('w1', { denyTools: ['bash'] })
  assert.equal(schedule.tasks.get(armed.id).status, 'active')
  // Fail closed: an unlineaged Session is not activated while the pause is stuck...
  const guard = (ctx.listeners.get('schedule/resolve-agent') ?? [])[0]
  assert.equal(typeof guard, 'function')
  let nexted = 0
  await assert.rejects(
    () => guard('fresh-1', async () => { nexted += 1 }),
    /blocked until its task can be paused/,
  )
  // ...and the next sweep that can pause it clears the block.
  schedule.edit = edit
  await rt.revokeNewSchedules()
  assert.equal(schedule.tasks.get(armed.id).status, 'paused')
  assert.equal(await guard('fresh-1', async () => { nexted += 1; return 'live' }), 'live')
  assert.equal(nexted, 1)
})

test('a restart with the deny list already set pauses the armed fresh-Session task', async (t) => {
  const schedule = scheduleService()
  const armed = await freshTask(schedule, 'w2')
  assert.equal(armed.status, 'active')
  const team = JSON.parse(JSON.stringify(TEAM))
  team.bots.w1.denyTools = ['bash']
  const { ctx, home, rt } = setup({ schedule }, team)
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  await rt.load()
  // The check runs after the boot load; give it the turns it needs.
  for (let index = 0; index < 100 && schedule.tasks.get(armed.id).status === 'active'; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(schedule.tasks.get(armed.id).status, 'paused')
})

test('deleting a Bot pauses the fresh-Session task its Session armed', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, rt } = setup({ schedule })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  ctx.workspaceRegistry = { archiveSession: async () => {} }
  await rt.load()
  const armed = await freshTask(schedule, 'w2')
  await rt.deleteBot('w1')
  assert.equal(schedule.tasks.get(armed.id).status, 'paused')
})

test('a read-only host neither pauses nor vouches for unlineaged deliveries', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-schedules-'))
  const team = JSON.parse(JSON.stringify(TEAM))
  team.bots.w1.denyTools = ['bash']
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  // Another live process holds the team lock: this host only follows the file.
  writeFileSync(join(home, 'state.lock'),
    JSON.stringify({ pid: process.ppid, host: hostname(), token: 'other', since: Date.now() }))
  const schedule = scheduleService()
  const armed = await freshTask(schedule, 'w2')
  const ctx = fakeContext({ services: { schedule } })
  const rt = createRuntime(ctx, { home })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  await rt.load()
  // The other host owns the team: this one writes nothing and cannot vouch for the state.
  await rt.revokeNewSchedules()
  assert.equal(schedule.tasks.get(armed.id).status, 'active')
  const guard = (ctx.listeners.get('schedule/resolve-agent') ?? [])[0]
  await assert.rejects(
    () => guard('fresh-1', async () => 'ran'),
    /blocked until its task can be paused/,
  )
  // It takes the team over; the next delivery checks, pauses the task and refuses it.
  rmSync(join(home, 'state.lock'))
  await rt.refresh()
  await assert.rejects(
    () => guard('fresh-1', async () => 'ran'),
    /blocked until its task can be paused/,
  )
  // The refusal kicks the check off the delivery path; it pauses the task right after.
  for (let index = 0; index < 100 && schedule.tasks.get(armed.id).status === 'active'; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(schedule.tasks.get(armed.id).status, 'paused')
  // The guard opens once the check that pause kicked off has finished.
  let ran
  for (let index = 0; index < 100 && ran === undefined; index += 1) {
    try {
      ran = await guard('fresh-2', async () => 'ran')
    } catch {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  assert.equal(ran, 'ran')
})
