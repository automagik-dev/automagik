import { AUTO_MARK, MARK_LEVEL } from '../shared/permission-levels.js'

const routeOf = model => typeof model === 'string' ? model.split('/')[0] : undefined
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

export function install(rt) {
  const { ctx, state } = rt
  const inflight = new Map()
  const acp = () => ctx.get?.('acpAgents')
  const presets = () => ctx.get?.('permissionPresets')
  const sessionOf = id => (ctx.sessions?.list?.() ?? []).find(session => session?.id === id)
  const denied = bot => (bot.denyTools?.length ?? 0) > 0
  const presetOK = () => {
    const spec = presets()?.resolve(MARK_LEVEL)
    return spec?.sandbox === 'workspace-write' && spec?.approval === 'ask'
  }
  const owner = id => rt.botOf(rt.chatOwners.get(id) ?? state.tasks?.[id]?.from)
  const inherited = (bot, id) => {
    const task = state.tasks?.[id]
    return task?.from === bot.id && task.status === 'working' && task.auto === bot.permissionAuto && task.autoRev === (bot.permissionRev ?? 0) && !task.roomId && !task.levelRoomId && !task.levelTaskId && !task.permissionCap
  }
  const movePermissionRev = bot => { bot.permissionRev = (Number.isInteger(bot.permissionRev) ? bot.permissionRev : 0) + 1 }
  function autoWhy(bot, { sessionId, session, provider, view } = {}) {
    if (!rt.holdsLock() || !rt.teamLoaded()) return 'lock'
    if (bot.permissionAuto !== AUTO_MARK || bot.permission !== MARK_LEVEL) return 'level'
    if (denied(bot)) return 'deny'
    if (rt.chatOwners.get(sessionId) !== bot.id && !inherited(bot, sessionId)) return 'session'
    if (session !== undefined && (presets()?.current(session) !== MARK_LEVEL || !presetOK() || rt.levelHeld(sessionId))) return 'preset'
    if (provider !== AUTO_MARK || routeOf(bot.model) !== AUTO_MARK) return 'route'
    if (view) {
      const report = acp()?.ownModeOf?.(AUTO_MARK)
      if (report?.bridged !== false || report.answerer !== true) return 'agent'
    }
    return undefined
  }
  function autoOffer(bot) {
    try {
      const report = acp()?.ownModeOf?.(AUTO_MARK)
      return { offered: routeOf(bot.model) === AUTO_MARK && routeOf(bot.appliedModel) === AUTO_MARK && !denied(bot) && !rt.hostOwned?.(bot) && presetOK() && rt.holdsLock() && report?.bridged === false && report.answerer === true }
    } catch { return { offered: false } }
  }
  function autoViewOf(bot) {
    const out = autoOffer(bot).offered ? { autoOffered: true } : {}
    if (bot.permissionAuto) {
      try {
        const id = rt.chatOf(bot.id)
        if (autoWhy(bot, { sessionId: id, session: sessionOf(id), provider: routeOf(bot.appliedModel), view: true }) !== undefined) out.permissionFallback = MARK_LEVEL
      } catch { out.permissionFallback = MARK_LEVEL }
    }
    return out
  }
  function autoFactsOf(sessionId, session) {
    const bot = owner(sessionId)
    if (!bot?.permissionAuto || (rt.chatOwners.get(sessionId) !== bot.id && !state.tasks?.[sessionId]?.auto)) return undefined
    try {
      const why = autoWhy(bot, { sessionId, session, provider: routeOf(bot.appliedModel), view: true })
      return { counts: why === undefined, why }
    } catch { return { counts: false, why: 'agent' } }
  }
  function endAuto(bot, ids) {
    ids ??= [rt.chatOf(bot.id), ...Object.entries(state.tasks ?? {}).filter(([, task]) => task.from === bot.id && task.status === 'working' && task.auto).map(([id]) => id)]
    for (const id of ids) { try { acp()?.endSession?.(id) } catch {} }
  }
  async function clearAuto(bot) {
    await inflight.get(bot.id)?.catch(() => {})
    movePermissionRev(bot)
    if (!bot.permissionAuto) return
    delete bot.permissionAuto
    endAuto(bot)
    await rt.save({ required: true })
  }
  function sweepAuto() {
    for (const bot of Object.values(state.bots)) {
      if (!bot.permissionAuto || (bot.permission === MARK_LEVEL && !denied(bot) && routeOf(bot.model) === bot.permissionAuto)) continue
      delete bot.permissionAuto
      movePermissionRev(bot)
      endAuto(bot)
    }
  }
  async function setBotAuto(id, rev) {
    const bot = rt.botOf(id)
    if (!bot) throw refused('Unknown Bot')
    const stale = () => refused(`${bot.name}'s permissions changed meanwhile, so nothing was saved. Look again and choose.`)
    if (!Number.isInteger(rev) || rev !== (bot.permissionRev ?? 0)) throw stale()
    if (!autoOffer(bot).offered) throw refused(`Auto is not offered for ${bot.name} here.`)
    if (bot.permissionAuto === AUTO_MARK) return bot
    if (inflight.has(id)) { await inflight.get(id).catch(() => {}); throw stale() }
    const run = (async () => {
      const next = { permission: MARK_LEVEL, permissionAuto: AUTO_MARK, permissionRev: rev + 1 }
      const before = bot.permission
      const writing = rt.saveCopy(copy => Object.assign(copy.bots[id], next))
      const revision = state.revision
      await writing
      if (rt.botOf(id) !== bot || (bot.permissionRev ?? 0) !== rev) { void rt.save(); throw stale() }
      Object.assign(bot, next)
      try {
        if (state.revision > revision) await rt.save({ required: true })
      } catch (error) {
        if (before === undefined) delete bot.permission
        else bot.permission = before
        delete bot.permissionAuto
        movePermissionRev(bot)
        endAuto(bot)
        throw error
      }
      try { await rt.levelTo(bot, MARK_LEVEL, { before }) } catch (error) {
        if (error?.levelNotApplied === true) throw error
        delete bot.permissionAuto
        movePermissionRev(bot)
        endAuto(bot)
        await rt.save({ required: true })
        throw error
      }
      return bot
    })()
    inflight.set(id, run)
    try { return await run } finally { if (inflight.get(id) === run) inflight.delete(id) }
  }
  function autoOpener() {
    const sessionId = rt.callerSessionId()
    const bot = rt.botOf(rt.chatOwners.get(sessionId))
    if (!bot || acp()?.ownModeIn?.(sessionId) !== true) return undefined
    try {
      if (autoWhy(bot, { sessionId, session: sessionOf(sessionId), provider: routeOf(bot.appliedModel) }) === undefined) return { route: AUTO_MARK, rev: bot.permissionRev ?? 0, botId: bot.id }
    } catch {}
    return undefined
  }
  async function markInherited(bot, route) {
    if (bot.permission !== MARK_LEVEL || routeOf(bot.model) !== route || denied(bot)) return
    try {
      const writing = rt.saveCopy(copy => Object.assign(copy.bots[bot.id], { permissionAuto: route, permissionRev: 1 }))
      const revision = state.revision
      await writing
      if (rt.botOf(bot.id) !== bot) return
      Object.assign(bot, { permissionAuto: route, permissionRev: 1 })
      if (state.revision > revision) await rt.save({ required: true })
    } catch (error) {
      delete bot.permissionAuto
      movePermissionRev(bot)
      endAuto(bot)
      rt.warn('ds-bot: inherited Auto was not saved: %s', error)
    }
  }
  const register = sub => {
    const off = sub.acpAgents?.ownMode?.(({ sessionId, agent, provider }) => {
      try {
        const bot = owner(sessionId)
        return bot !== undefined && autoWhy(bot, { sessionId, session: agent?.session, provider }) === undefined
      } catch { return false }
    })
    if (typeof off === 'function') sub.effect(() => off, 'ds-bot: own mode on agents')
  }
  Object.assign(rt, { movePermissionRev, autoWhy, autoOffer, autoViewOf, autoFactsOf, endAuto, clearAuto, sweepAuto, setBotAuto, autoOpener, markInherited,
    autoKey: () => Object.values(state.bots).filter(bot => bot.permissionAuto || autoOffer(bot).offered).map(bot => {
      let counts = false
      try {
        const id = rt.chatOf(bot.id)
        counts = autoFactsOf(id, sessionOf(id))?.counts === true
      } catch {}
      return `${bot.id}:${autoOffer(bot).offered}${counts}`
    }).sort().join(',') })
  if (typeof ctx.inject === 'function') ctx.inject(['acpAgents'], register)
  else if (acp() !== undefined) register({ acpAgents: acp(), effect: (execute, label) => ctx.effect(execute, label) })
}
