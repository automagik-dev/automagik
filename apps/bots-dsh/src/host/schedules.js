// Scheduled tasks. DSH's schedule service stores each task with the Session it belongs
// to and, when it is due, sends its prompt to that Session as a new message. This
// module lists the team's tasks for Settings, creates and removes them there, and moves
// a Bot's tasks along when its chat goes on in a fresh part, so the Bot keeps seeing
// them. A group chat's task lives on the group's own Session, so the reminder reaches
// the group like a message from the user (see reminderText). DSH 0.2.0 mounts the service only with its Automation tasks bundle on, so
// the service is optional and every endpoint reports whether it is there.

const MAX_TITLE = 120
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
// The targets whose delivery opens a Session of its own: no subagent lineage, no task
// record, so no Bot's restriction can bind it (#584, L5).
const NEW_TARGETS = new Set(['new', 'new_once'])

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
  // Tasks whose pause failed. While one is stuck, an unlineaged delivery is refused rather
  // than let it run with no Bot to bind it; the next successful sweep clears it. `swept`
  // holds deliveries closed through the boot window, before the first check has run.
  const stuck = new Set()
  // The boot check runs after the team loads; before that an empty team would read as "no
  // restricted Bot" and open the guard too early, so only a load-backed sweep opens it.
  let teamLoaded = false
  let swept = false

  const attach = (sub) => {
    const own = sub.schedule
    service = own
    sub.effect(() => () => { if (service === own) service = null }, 'ds-bot: schedule service')
    void revokeNewSchedules()
      .catch(error => rt.warn('ds-bot: fresh-Session tasks were not checked: %s', error))
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

  // The durable header of a Session: the live registry first, then DSH's persisted copy.
  // The live registry only holds Sessions that are loaded, so a subagent child that ended,
  // or a team loaded after a restart before the child reopened, would be missed.
  const headerOf = async (sessionId) => {
    const live = ctx.sessions?.get?.(sessionId)?.header
    if (live !== undefined) return live
    if (typeof ctx.sessionPersistence?.stat !== 'function') return undefined
    try {
      return (await ctx.sessionPersistence.stat(sessionId))?.header
    } catch {
      return undefined
    }
  }
  // The Bot an involved Session speaks for: its own chat, a group Session, an earlier part,
  // a task run, or a subagent child (through its parent lineage). DSH records every Session
  // involved in a task, the creating one included.
  const botOfTaskSession = async (sessionId) => {
    let current = sessionId
    for (let depth = 0; typeof current === 'string' && current !== '' && depth < 32; depth += 1) {
      const direct = rt.botOf(current)
      if (direct !== undefined) return direct
      const owner = rt.selfOf?.(current) ?? rt.state?.tasks?.[current]?.from
      if (owner !== undefined) {
        const bot = rt.botOf(owner)
        if (bot !== undefined) return bot
      }
      const header = await headerOf(current)
      if (header?.origin !== 'subagent' || header.parentSession === undefined) return undefined
      current = header.parentSession
    }
    return undefined
  }
  const restricted = bot => Array.isArray(bot?.denyTools) && bot.denyTools.length > 0
  // Every Session a Bot speaks from now, plus the ones a caller already has.
  const sessionsOf = (bot, extra = []) => {
    const ids = new Set(extra)
    for (const id of rt.sessionsOfBot?.(bot.id) ?? []) ids.add(id)
    for (const part of bot.segments ?? []) ids.add(part.sessionId)
    for (const room of Object.values(rt.state?.rooms ?? {})) {
      for (const part of room.segments?.[bot.id] ?? []) ids.add(part.sessionId)
    }
    for (const [id, task] of Object.entries(rt.state?.tasks ?? {})) {
      if (task.from === bot.id) ids.add(id)
    }
    return ids
  }
  /**
   * Pause every active task with a fresh-Session target that a restricted Bot is involved
   * in. Scoped to one Bot when `botId` is given (a restriction or a deletion), else every
   * Bot in the team (a restart, or a task armed by the user for a restricted Bot's Session).
   * The record stays; only its deliveries stop. Resolves the ids it paused.
   * @param {string} [botId] - the Bot whose Sessions must not open fresh Sessions.
   * @param {string[]} [extra] - Sessions of that Bot a caller already holds (deletion).
   * @param {{ any?: boolean }} [options] - pause for this Bot even without a deny list
   *   (its deletion).
   */
  async function revokeNewSchedules(botId, extra = [], { any = false } = {}) {
    if (service === null) return []
    // The attach-time check can run before the team is read; it must neither act on an empty
    // team nor write another host's store. The load-backed sweep does the first check.
    if (botId === undefined && !teamLoaded) return []
    // A host that only reads the team does not write another host's schedule store, and it
    // cannot vouch for what it did not read: the guard stays closed for unlineaged
    // deliveries until this host owns the team and a later sweep runs.
    if (typeof rt.readOnly === 'function' && rt.readOnly() !== undefined) return []
    // Only a sweep that started with the team loaded may open the guard: an attach-time
    // sweep can finish after the boot chain and would otherwise vouch for pre-load state.
    const loadedThen = teamLoaded
    const scoped = botId !== undefined
    const bot = scoped ? rt.botOf(botId) : undefined
    if (scoped && bot === undefined) return []
    const sessions = scoped ? sessionsOf(bot, extra) : undefined
    const cache = new Map()
    const botFor = async (sessionId) => {
      if (cache.has(sessionId)) return cache.get(sessionId)
      const resolved = await botOfTaskSession(sessionId)
      cache.set(sessionId, resolved)
      return resolved
    }
    const paused = []
    const checked = new Set()
    for (const entry of await service.catalog()) {
      if (entry.status === 'active') checked.add(entry.id)
      const target = entry.target ?? {}
      // A delivered `new_once` is rewritten to a session target on the Session it opened,
      // which has no team lineage: the task is still unbound and must be paused.
      const targetBot = target.kind === 'session' ? await botFor(target.sessionId) : undefined
      const unbound = target.kind === 'session' && targetBot === undefined
        && !(sessions !== undefined && sessions.has(target.sessionId))
      if (entry.status !== 'active' || (!NEW_TARGETS.has(target.kind) && !unbound)) continue
      const involved = Array.isArray(entry.involvedSessionIds) ? entry.involvedSessionIds : []
      // A scoped caller vouches for the Session ids it hands over (a group Session leaving
      // the maps, a task record being evicted), so they are resolved before the maps go.
      const matched = sessions === undefined
        ? involved
        : involved.filter(sessionId => sessions.has(sessionId))
      let fromBot = false
      if (sessions === undefined) {
        for (const sessionId of involved) {
          if (restricted(await botFor(sessionId))) { fromBot = true; break }
        }
      } else if (matched.length > 0 && (any || restricted(bot))) {
        fromBot = true
      } else if (bot !== undefined) {
        // A subagent child is in no team map; its durable header still names the Bot.
        for (const sessionId of involved) {
          const owner = await botFor(sessionId)
          if (owner?.id === bot.id && (any || restricted(bot))) { fromBot = true; break }
        }
      }
      if (!fromBot) continue
      try {
        await service.edit({ id: entry.id, action: 'update', patch: { active: false } })
        stuck.delete(entry.id)
        paused.push(entry.id)
        rt.warn('ds-bot: paused the scheduled task %s: '
          + 'its fresh Session would run with no Bot lineage', entry.title ?? entry.id)
      } catch (error) {
        stuck.add(entry.id)
        rt.warn('ds-bot: the scheduled task %s could not be paused (%s); '
          + 'a delivery to a fresh Session is refused until it is', entry.title ?? entry.id,
        error?.message ?? error)
      }
    }
    for (const id of stuck) if (!checked.has(id)) stuck.delete(id)
    swept = swept || loadedThen
    return paused
  }
  // A restart keeps both the deny list and the armed task: check once the team is loaded.
  void Promise.resolve(rt.load?.()).then(() => {
    teamLoaded = true
    return revokeNewSchedules()
  }).catch(error => rt.warn('ds-bot: fresh-Session tasks were not checked: %s', error))
  // A task armed later for a restricted Bot's Session (by the user, in DSH's own surface)
  // is checked the moment the service reports it.
  ctx.on('schedule/changed', () => {
    void revokeNewSchedules()
      .catch(error => rt.warn('ds-bot: fresh-Session tasks were not checked: %s', error))
  })
  // The last line for a fresh delivery: if the check has not run yet, or a task could not be
  // paused, a Session with no Bot lineage must not be activated. DSH drives deliveries
  // through this waterfall, before the prompt runs.
  ctx.on('schedule/resolve-agent', async (sessionId, next) => {
    if (swept && stuck.size === 0) return next()
    if (await botOfTaskSession(sessionId) !== undefined) return next()
    // Never wait on the schedule service here: DSH runs this waterfall inside the delivery
    // drive, and a management write queues behind it, so awaiting one would deadlock the
    // drive. Ask for the check and refuse this delivery; the next attempt runs after it.
    void revokeNewSchedules()
      .catch(error => rt.warn('ds-bot: fresh-Session tasks were not checked: %s', error))
    throw new Error('ds-bot: a scheduled fresh Session is blocked until its task can be paused')
  })

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

  Object.assign(rt, {
    scheduleEndpoint: (endpoint, body) => endpoints[endpoint](body ?? {}),
    moveSchedules,
    revokeNewSchedules,
  })
}
