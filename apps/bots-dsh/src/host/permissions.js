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
  // workspace-write. A change gives the team a new revision, so windows show it.
  const fellBack = new Set()
  function markFallback(key, on) {
    if (on === fellBack.has(key)) return
    if (on) fellBack.add(key)
    else fellBack.delete(key)
    void rt.save?.().catch(() => {})
  }
  // `{ permissionFallback }` for a Bot's or group's view when its Auto runs as workspace-write.
  function permissionFallbackOf(kind, owner) {
    if (owner.permission !== AUTO) return {}
    const service = presets()
    const fallback = service === undefined || !autoOffered(service) || fellBack.has(`${kind}:${owner.id}`)
    return fallback ? { permissionFallback: AUTO_FALLBACK } : {}
  }

  // Sets a level on one Session; `session` spares the resolve where the caller holds it.
  // Auto is set only once every dsh-oh-my-claude adapter has read back Claude Code's
  // `auto` for the Session; else it runs as workspace-write. Any other level is set
  // first, then an `auto` override is cleared. Resolves whether the level holds.
  async function applyLevel(sessionId, level, session) {
    const service = presets()
    const target = session ?? (await rt.resolveAgent(sessionId)).session
    if (level === AUTO && autoOffered(service) && await pinClaudeMode(sessionId, AUTO)) {
      try {
        service.set(target, AUTO)
        return true
      } catch (error) {
        rt.warn('ds-bot: Auto for %s not set: %s', sessionId, error)
      }
    }
    service.set(target, level === AUTO ? AUTO_FALLBACK : level)
    if (!await pinClaudeMode(sessionId, null)) rt.warn('ds-bot: Claude Code\'s auto mode for %s not cleared', sessionId)
    return level !== AUTO
  }

  // Sets the level on one of the Bot's Sessions: its group's there, else its own; a Bot
  // without one keeps DSH's default. `room` is for a group Session not indexed yet.
  async function applyPermission(bot, sessionId, room = roomOfSession(sessionId), session) {
    const name = room?.permission ?? bot.permission
    if (presets() === undefined || !name) return
    const held = await applyLevel(sessionId, name, session)
    markFallback(room?.permission ? `room:${room.id}` : `bot:${bot.id}`, !held)
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

  // A Session DSH opens, after a restart too, gets its level. Async: DSH only logs a rejection.
  ctx.on('session/created', async (session) => {
    if (presets() === undefined) return
    await rt.load()
    await reapply(session).catch(warnNotApplied(session.id))
  })
  // Auto review's layer loaded or unloaded: the loaded Sessions get their level again, so
  // one DSH moved off Auto runs as workspace-write, not full access. An idle Session is
  // left closed.
  ctx.on('permission-presets/catalog-changed', async () => {
    if (presets() === undefined) return
    await rt.load()
    for (const session of ctx.sessions.list()) await reapply(session).catch(warnNotApplied(session.id))
    // The catalog is in the team view; a new revision shows it.
    void rt.save?.().catch(() => {})
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
    return Object.assign(new Error('Turn Auto review back on in Plugins to open this chat.', { cause: error }), { code: error.code })
  }

  function checkPreset(name) {
    const service = presets()
    if (service === undefined) throw new Error('Permissions are not available in this DeepSeek Harness')
    const wanted = String(name ?? '').trim()
    service.resolve(wanted)
    return wanted
  }

  async function setPermission(bot, name) {
    const wanted = checkPreset(name)
    await applyPermission({ ...bot, permission: wanted }, rt.chatOf(bot.id))
    bot.permission = wanted
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

  Object.assign(rt, { permissionCatalog, permissionFallbackOf, autoClosed, applyLevel, applyPermission, checkPreset, setPermission, cleanRoomPermission, setRoomPermission })
}
