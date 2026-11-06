// Scheduled tasks. DSH's schedule service stores each task with the Session it belongs
// to and, when it is due, sends its prompt to that Session as a new message. This
// module lists the team's tasks for Settings, creates and removes them there, and moves
// a Bot's tasks along when its chat goes on in a fresh part, so the Bot keeps seeing
// them. A group chat's task lives on the group's own Session, so the reminder reaches
// the group like a message from the user (see reminderText). DSH 0.2.0 mounts the service only with its Automation tasks bundle on, so
// the service is optional and every endpoint reports whether it is there.

const MAX_TITLE = 120
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// What a group sees of a due reminder: DSH frames it for one Session's model
// ("[SCHEDULE REMINDER]" with JSON fields); the group gets each prompt as one line.
export function reminderText(text) {
  const prompts = []
  const one = /^reminder_prompt_json: (.*)$/m.exec(text)
  const batch = /^reminders_json: (.*)$/m.exec(text)
  try {
    if (one) prompts.push(JSON.parse(one[1]))
    if (batch) for (const entry of JSON.parse(batch[1])) prompts.push(entry.reminder_prompt)
  } catch {
    // A framing this module cannot read goes to the group as it came.
    return text
  }
  const lines = prompts.filter(prompt => typeof prompt === 'string' && prompt.trim() !== '')
  return lines.length === 0 ? text : lines.map(prompt => `[Scheduled task] ${prompt}`).join('\n')
}

// The create request that gives a stored record its timing again, for a move. DSH 0.2.2
// replaced the flat 0.2.1 request with a typed `timing` selector.
function timingOf(record) {
  switch (record.kind) {
    case 'after':
    case 'at': return { kind: 'at', at: record.scheduledAt }
    case 'every': return { kind: 'every', every_seconds: record.everySeconds }
    case 'daily': return { kind: 'daily', daily: { time: record.time, time_zone: record.timeZone } }
    case 'weekly': return { kind: 'weekly', weekly: { time: record.time, time_zone: record.timeZone, weekdays: record.weekdays } }
    case 'cron': return { kind: 'cron', cron: { expression: record.expression, time_zone: record.timeZone } }
    // DSH 0.2.2's own schedule tools create rrule tasks; a move must carry them too.
    case 'rrule': return { kind: 'rrule', rrule: record.rrule }
    default: return null
  }
}

function requestOf(record) {
  const timing = timingOf(record)
  return timing === null ? null : { title: record.title, prompt: record.prompt, timing }
}

// The Session a task delivers to; a `new` target has none until it creates one.
const targetSessionOf = entry => (entry.target?.kind === 'new' ? undefined : entry.target?.sessionId)

// The settings form's timing as DSH 0.2.2's typed create selector.
function selectorOf(when) {
  const zone = typeof when?.timeZone === 'string' && when.timeZone !== '' ? when.timeZone : 'UTC'
  switch (when?.kind) {
    case 'at': {
      const at = new Date(String(when.at ?? ''))
      if (Number.isNaN(at.getTime())) throw invalid('Pick a date and time')
      if (at.getTime() <= Date.now()) throw invalid('Pick a time in the future')
      return { kind: 'at', at: at.toISOString() }
    }
    case 'daily':
      if (!TIME.test(String(when.time))) throw invalid('Pick a time of day')
      return { kind: 'daily', daily: { time: `${when.time}:00`, time_zone: zone } }
    case 'weekly': {
      if (!TIME.test(String(when.time))) throw invalid('Pick a time of day')
      const weekdays = [...new Set((Array.isArray(when.weekdays) ? when.weekdays : []).map(Number))].filter(day => Number.isInteger(day) && day >= 1 && day <= 7).sort()
      if (weekdays.length === 0) throw invalid('Pick at least one day')
      return { kind: 'weekly', weekly: { time: `${when.time}:00`, time_zone: zone, weekdays } }
    }
    case 'every': {
      const minutes = Number(when.minutes)
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) throw invalid('Repeat every 1 minute to 7 days')
      return { kind: 'every', every_seconds: minutes * 60 }
    }
    default:
      throw invalid('Pick when it runs')
  }
}

export function install(rt) {
  const { ctx } = rt
  let service = null

  const attach = (sub) => {
    const own = sub.schedule
    service = own
    sub.effect(() => () => { if (service === own) service = null }, 'ds-bot: schedule service')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['schedule'], attach)
  else if (ctx.get?.('schedule') !== undefined) attach({ schedule: ctx.get('schedule'), effect: (execute, label) => ctx.effect(execute, label) })

  // The Bot (and group chat) a task's Session speaks for, the group chat for a group's
  // own Session, or nothing for a Session outside the team.
  const ownerOf = (sessionId) => {
    const chat = rt.chatOwners.get(sessionId)
    if (chat !== undefined) return { botId: chat }
    if (rt.roomOf(sessionId) !== undefined) return { roomId: sessionId }
    return rt.groupOwners.get(sessionId) ?? rt.pastOwners.get(sessionId)
  }
  const known = owner => owner !== undefined && (owner.botId === undefined ? rt.roomOf(owner.roomId) !== undefined : rt.botOf(owner.botId) !== undefined)

  async function schedulesView() {
    if (service === null) return { available: false, tasks: [] }
    const tasks = []
    for (const entry of await service.catalog()) {
      const sessionId = targetSessionOf(entry)
      const owner = ownerOf(sessionId)
      if (!known(owner)) continue
      tasks.push({ ...entry, sessionId, ...owner })
    }
    return { available: true, tasks }
  }

  const endpoints = {
    schedules: () => schedulesView(),
    async 'schedule-create'(body) {
      if (service === null) throw invalid('Automation tasks are off in DSH')
      const bot = rt.botOf(body.target)
      const room = rt.roomOf(body.target)
      if (bot === undefined && room === undefined) throw invalid('No such Bot or group chat')
      const title = String(body.title ?? '').trim()
      const prompt = String(body.prompt ?? '').trim()
      if (title === '') throw invalid('Give the task a name')
      if (title.length > MAX_TITLE) throw invalid(`Keep the name under ${MAX_TITLE} characters`)
      if (prompt === '') throw invalid('Say what the Bot should do')
      const sessionId = bot ? rt.chatOf(bot.id) : room.id
      await service.create({ title, prompt, timing: selectorOf(body.when), target: { kind: 'session', sessionId } })
      return schedulesView()
    },
    async 'schedule-delete'(body) {
      if (service === null) throw invalid('Automation tasks are off in DSH')
      if (ownerOf(body.sessionId) === undefined) throw invalid('No such task')
      const entry = (await service.catalog()).find(task => task.id === body.id)
      if (entry === undefined || targetSessionOf(entry) !== body.sessionId) throw invalid('No such task')
      await service.edit({ id: body.id, action: 'delete' })
      return schedulesView()
    },
  }

  // A fresh part takes over the earlier part's active tasks: each is created again on
  // the fresh Session before the old one goes, so a failure leaves it where it was.
  async function moveSchedules(fromId, toId) {
    if (service === null) return
    const records = (await service.catalog()).filter(entry => targetSessionOf(entry) === fromId && entry.status === 'active')
    for (const record of records) {
      const request = requestOf(record)
      if (request === null || (request.timing.kind === 'at' && Date.parse(request.timing.at) <= Date.now())) continue
      // A failed read or copy must prevent stopActivity from deleting an unmoved
      // task. Equal requests can be separate tasks; copy each source record.
      await service.create({ ...request, target: { kind: 'session', sessionId: toId } })
      try {
        await service.edit({ id: record.id, action: 'delete' })
      } catch (error) {
        // The copy is safe; archiving the earlier part will remove its old task.
        rt.warn('ds-bot: earlier copy of task %s not removed: %s', record.title, error?.message ?? error)
      }
    }
  }

  Object.assign(rt, { scheduleEndpoint: (endpoint, body) => endpoints[endpoint](body ?? {}), moveSchedules })
}
