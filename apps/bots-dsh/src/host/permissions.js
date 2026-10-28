// Permissions. A Bot's permission level is its own: kept on the Bot and set on every
// Session it speaks from, so a fresh part or a new group Session keeps it. A group may
// set one level for all its members there, in place of each member's own, as it may
// set one working folder. A level is DSH's preset name; DSH's Auto review is one while
// its layer is loaded, and a Claude Code Session at Auto runs Claude Code's own `auto`
// (../shared/permission-levels.js).
import { AUTO, AUTO_FALLBACK, pinClaudeMode } from '../shared/permission-levels.js'

export function install(rt) {
  const { ctx } = rt

  const presets = () => ctx.get?.('permissionPresets')
  const autoOffered = service => service.catalog().options.some(option => option.value === AUTO)

  // The presets DSH offers, or undefined when the profile has none.
  function permissionCatalog() {
    const service = presets()
    if (service === undefined) return undefined
    const { options, defaultPreset } = service.catalog()
    return { options, defaultPreset }
  }

  const roomOfSession = sessionId => rt.roomOf(rt.groupOwners.get(sessionId)?.roomId)

  // Bots (`bot:<id>`) and groups (`room:<id>`) whose saved Auto last ran as
  // workspace-write. Windows learn of a change, or of a new catalog, through
  // permissionKey in the team view's modelsKey, without a new revision.
  const fellBack = new Set()
  function markFallback(key, on) {
    if (on) fellBack.add(key)
    else fellBack.delete(key)
  }
  const permissionKey = () => `${presets()?.catalog().options.map(option => option.value).join(',') ?? ''}:${[...fellBack].sort().join(',')}`
  // `{ permissionFallback }` for a Bot's or group's view when its Auto runs as workspace-write.
  function permissionFallbackOf(kind, owner) {
    if (owner.permission !== AUTO) return {}
    const service = presets()
    const fallback = service === undefined || !autoOffered(service) || fellBack.has(`${kind}:${owner.id}`)
    return fallback ? { permissionFallback: AUTO_FALLBACK } : {}
  }

  // Applies run one at a time per Session, in call order; one with nothing before it
  // starts at once, so a listener's first preset lands inside DSH's announce. The chain
  // is in place before the job starts: a resolve inside it that opens the Session queues
  // the session/created re-apply behind it.
  const chains = new Map()
  function serial(sessionId, job) {
    const before = chains.get(sessionId)
    let release
    const tail = new Promise((resolve) => { release = resolve })
    chains.set(sessionId, tail)
    const run = before === undefined ? job() : before.then(job)
    void run.then(release, release)
    void tail.then(() => { if (chains.get(sessionId) === tail) chains.delete(sessionId) })
    return run
  }

  // Sets a level on one Session; `session` spares the resolve where the caller holds it.
  // Auto is set only once every dsh-oh-my-claude adapter has read back Claude Code's
  // `auto` for the Session; until then, and when it cannot, it runs as workspace-write,
  // never on what an earlier stop left (DSH moves Auto to full access when its layer
  // closes). Any other level is set first, then an `auto` override is cleared.
  // Resolves whether the level holds.
  async function applyLevel(sessionId, level, session) {
    const service = presets()
    const target = session ?? (await rt.resolveAgent(sessionId)).session
    if (level === AUTO) {
      if (service.current(target) !== AUTO) service.set(target, AUTO_FALLBACK)
      if (autoOffered(service) && await pinClaudeMode(sessionId, AUTO)) {
        try {
          service.set(target, AUTO)
          return true
        } catch (error) {
          rt.warn('ds-bot: Auto for %s not set: %s', sessionId, error)
        }
      }
    }
    service.set(target, level === AUTO ? AUTO_FALLBACK : level)
    if (!await pinClaudeMode(sessionId, null)) rt.warn('ds-bot: Claude Code\'s auto mode for %s not cleared', sessionId)
    return level !== AUTO
  }

  // Sets the level on one of the Bot's Sessions: its group's there, else its own; a Bot
  // without one keeps DSH's default. `room` is for a group Session not indexed yet. The
  // level is read when the apply runs, not when it is queued.
  async function applyPermission(bot, sessionId, room = roomOfSession(sessionId), session) {
    if (presets() === undefined) return
    return serial(sessionId, async () => {
      const name = room?.permission ?? bot.permission
      if (!name) return
      const held = await applyLevel(sessionId, name, session)
      markFallback(room?.permission ? `room:${room.id}` : `bot:${bot.id}`, !held)
    })
  }

  // A Session of a Bot's own chat or of a group, as DSH opens it or as the presets change.
  async function reapply(session) {
    if (rt.readOnly() !== undefined) return
    const group = rt.groupOwners.get(session.id)
    const bot = rt.botOf(group?.botId ?? rt.chatOwners.get(session.id))
    if (bot === undefined) return
    await applyPermission(bot, session.id, group && rt.roomOf(group.roomId), session)
  }
  const warnNotApplied = sessionId => error => rt.warn('ds-bot: permission for %s not applied: %s', sessionId, error)

  // A Session DSH opens, after a restart too, gets its level. Once the team is loaded the
  // first preset is set within DSH's announce, before the Session is published; the
  // rest is async, and DSH only logs a rejection.
  ctx.on('session/created', (session) => {
    if (presets() === undefined) return undefined
    const run = () => reapply(session).catch(warnNotApplied(session.id))
    return rt.chatOwners.has(session.id) || rt.groupOwners.has(session.id) ? run() : rt.load().then(run)
  })
  // Auto review's layer loaded or unloaded: the loaded Sessions get their level again, all
  // in one tick, so one DSH moved off Auto runs as workspace-write, not full access. An
  // idle Session is left closed.
  ctx.on('permission-presets/catalog-changed', async () => {
    if (presets() === undefined) return
    await rt.load()
    await Promise.all(ctx.sessions.list().map(session => reapply(session).catch(warnNotApplied(session.id))))
  })

  // DSH will not reopen a Session whose log holds Auto while Auto review's layer is off
  // (its pinInitialPermission throws), and its resolve says so only in the message. The
  // error a Bot's own resolve gives instead tells the user what to do.
  function autoClosed(sessionId, error) {
    if (!/cannot restore preset "auto"/.test(String(error?.message ?? ''))) return undefined
    const group = rt.groupOwners.get(sessionId)
    const room = group && rt.roomOf(group.roomId)
    const botId = group?.botId ?? rt.chatOwners.get(sessionId)
    if (room?.permission) markFallback(`room:${room.id}`, true)
    else if (botId !== undefined) markFallback(`bot:${botId}`, true)
    return Object.assign(new Error('Turn Auto review back on in Plugins to open this chat.', { cause: error }), { code: error.code, autoClosed: true })
  }

  function checkPreset(name) {
    const service = presets()
    if (service === undefined) throw new Error('Permissions are not available in this DeepSeek Harness')
    const wanted = String(name ?? '').trim()
    service.resolve(wanted)
    return wanted
  }

  // The level is kept before the apply: the resolve may open the Session, and the
  // session/created re-apply must find the new one. A chat DSH will not open while Auto
  // review is off keeps the new level and takes it when it opens again.
  async function setPermission(bot, name) {
    const wanted = checkPreset(name)
    const before = bot.permission
    bot.permission = wanted
    try {
      await applyPermission(bot, rt.chatOf(bot.id))
    } catch (error) {
      if (error?.autoClosed !== true) {
        if (before === undefined) delete bot.permission
        else bot.permission = before
        throw error
      }
    }
    for (const sessionId of rt.groupSessionsOf(bot.id)) {
      if (roomOfSession(sessionId)?.permission) continue
      await applyPermission(bot, sessionId)
        .catch(error => rt.warn('ds-bot: permission for %s in a group not applied: %s', bot.name, error))
    }
  }

  // A group's level, or null when each member uses its own.
  const cleanRoomPermission = name => (name === null || name === '' ? null : checkPreset(name))

  // Members' Sessions in the group change now; a member that has none there yet gets the
  // group's level when its first turn there makes one. Returns whether it changed.
  async function setRoomPermission(room, name) {
    const wanted = cleanRoomPermission(name) ?? undefined
    if (wanted === room.permission) return false
    if (wanted === undefined) delete room.permission
    else room.permission = wanted
    markFallback(`room:${room.id}`, false)
    const service = presets()
    if (service === undefined) return true
    for (const [botId, sessionId] of Object.entries(room.sessions ?? {})) {
      const bot = rt.botOf(botId)
      if (bot === undefined) continue
      // A member without a level of its own goes back to the default its Session started on.
      await applyPermission({ ...bot, permission: bot.permission ?? service.catalog().defaultPreset }, sessionId, room)
        .catch(error => rt.warn('ds-bot: permission for %s in %s not applied: %s', bot.name, room.name, error))
    }
    return true
  }

  Object.assign(rt, { permissionCatalog, permissionFallbackOf, permissionKey, autoClosed, applyLevel, applyPermission, checkPreset, setPermission, cleanRoomPermission, setRoomPermission })
}
