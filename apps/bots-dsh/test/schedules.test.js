import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    async create(request) {
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
        status: 'active',
      }
      tasks.set(id, entry)
      return entry
    },
    async catalog() { return [...tasks.values()].map(entry => ({ ...entry })) },
    async edit({ id, action }) {
      if (action !== 'delete') throw new Error(`unexpected edit ${action}`)
      if (!tasks.has(id)) return { id, deleted: false, code: 'schedule_not_found' }
      tasks.delete(id)
      return { id, deleted: true }
    },
  }
}

function setup(services = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsb-schedules-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(TEAM))
  const ctx = fakeContext({ services })
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (route) => { ctx.route = route; return register(route) }
  const rt = createRuntime(ctx, { home })
  const call = async (endpoint, payload) => (await ctx.route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  return { ctx, home, call, rt }
}

test('without the schedule service the page says so and creating is refused', async (t) => {
  const { ctx, home, call } = setup()
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  assert.deepEqual((await call('schedules', {})).value, { available: false, tasks: [] })
  const refused = await call('schedule-create', { target: 'm1', title: 'Briefing', prompt: 'Sum up', when: { kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /Automation tasks are off/)
})

test('tasks are created on the Bot’s current part, listed by Bot, and deleted', async (t) => {
  const schedule = scheduleService()
  const { ctx, home, call } = setup({ schedule })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
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
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
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
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
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
