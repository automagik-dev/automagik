// Claude on ACP (RFC 0003, delivery 4). The Claude Code plugin left Automagik and its Bots
// moved once to pi-ai's `anthropic` route (store.js, `claudeCodeMoved`). With dshTools on,
// those Bots move on to `acp-claude`, once per team (`claudeAcpMoved`), when the route can
// actually take them: the ACP plugin's per-session bridge is on and a live probe on this
// machine passes, the adapter is installed, and the route lists the model. A Bot the person
// has changed since (or whose model the route does not list) is left alone.
//
// `acpAgents.bridge()` runs a live probe on this machine: a fresh per-session credential, the
// bridge over stdio, MCP `initialize` and `tools/list`. A success is cached per installed
// adapter version; a failure is retried after ten minutes or the next start, so one slow start
// never blocks the move forever. An older ACP plugin has no such method and is not migrated.
import { claudeFamilyOf, piAiClaudeOf } from './claude-models.js'

const ACP_AGENT = 'acp-claude'

/**
 * The `acp-claude/<model>` a Bot should move to, or undefined when it must stay.
 * `listed` is the model ids the route serves, as DSH lists them.
 * @param {any} bot
 * @param {string[]} listed
 */
export function acpClaudeTarget(bot, listed) {
  const moved = piAiClaudeOf(bot?.claudeCodeModel)
  // Still on the exact pi-ai model the earlier move picked: a Bot the person changed since
  // is theirs, and the route must name a model it serves.
  if (moved === undefined || bot.model !== moved) return undefined
  const model = moved.slice(moved.indexOf('/') + 1)
  if (listed.includes(model)) return `${ACP_AGENT}/${model}`
  // The agents' own catalog uses Claude Code's aliases (`opus`, `sonnet`, `haiku`), while
  // pi-ai names exact versions. Same family, same route; no listing means no move. Claude
  // Code's `default` names no family on its own, so the pi-ai model it became names it.
  const family = claudeFamilyOf(bot.claudeCodeModel) ?? claudeFamilyOf(`claude-code/${model}`)
  if (family !== undefined && listed.includes(family)) return `${ACP_AGENT}/${family}`
  return undefined
}

/**
 * Whether this host may move Bots to `acp-claude` now: the bridge is on and its probes pass,
 * the adapter is installed, and the route is in DSH's picker.
 * @returns {Promise<{ listed: string[] } | undefined>}
 */
async function acpClaudeReady(ctx) {
  const acp = ctx.get?.('acpAgents')
  let bridge
  try {
    bridge = typeof acp?.bridge === 'function' ? await acp.bridge() : undefined
  } catch {
    return undefined
  }
  if (bridge?.on !== true || bridge?.probesPass !== true) return undefined
  let status
  try {
    status = await acp.status?.()
  } catch {
    return undefined
  }
  const agent = status?.agents?.find?.(row => row?.id === ACP_AGENT)
  // A route appears only once its CLI is here; its adapter installs behind it, and the
  // model menu is the route's own.
  if (agent?.connector?.state !== 'ready' || agent?.model?.listed !== true) return undefined
  try {
    const models = await ctx.llm.listModels(ACP_AGENT)
    const listed = (Array.isArray(models) ? models : []).map(model => model?.id).filter(id => typeof id === 'string')
    return listed.length > 0 ? { listed } : undefined
  } catch {
    return undefined
  }
}

export function install(rt) {
  const { ctx, state } = rt
  let running

  const move = async () => {
    await rt.load()
    // Nothing is written by a host that only reads the team; the writer moves them.
    if (rt.readOnly?.() !== undefined) return
    if (state.claudeAcpMoved === true) return
    const ready = await acpClaudeReady(ctx)
    if (ready === undefined) return
    const moved = []
    let waiting = false
    for (const bot of Object.values(state.bots ?? {})) {
      const target = acpClaudeTarget(bot, ready.listed)
      if (target === undefined) {
        // Eligible but this route does not list its model yet: the next catalog may, so the
        // team is not marked done and the Bot is not touched.
        if (bot?.claudeCodeModel !== undefined && bot.model === piAiClaudeOf(bot.claudeCodeModel)) waiting = true
        continue
      }
      bot.model = target
      moved.push(bot)
    }
    if (moved.length > 0) {
      // The Session's record of the model it ran on goes with it, so the next sync selects
      // the ACP model. The Session and its history stay.
      for (const bot of moved) {
        delete bot.appliedModel
        delete bot.appliedEffort
      }
    }
    if (!waiting) state.claudeAcpMoved = true
    if (moved.length > 0 || !waiting) await rt.save()
    // A lock lost during the save leaves the file unchanged; do not move live Sessions to a
    // model the team file does not record.
    if (rt.readOnly?.() !== undefined) return
    for (const bot of moved) {
      const apply = rt.applyModel
      if (typeof apply !== 'function') break
      await apply(bot, { force: true })
        .catch(error => rt.warn('ds-bot: model for %s not applied: %s', bot.name, error))
    }
  }

  // One pass at a time. An event that arrives while a pass awaits the route sets `again`,
  // so an adapter that lands mid-pass still moves the team in a second pass.
  let again = false
  const migrate = () => {
    if (running !== undefined) {
      again = true
      return running
    }
    running = (async () => {
      for (;;) {
        again = false
        await move()
        if (!again) break
      }
    })()
      .catch(error => rt.warn('ds-bot: the Claude Bots were not moved to acp-claude: %s', error))
      .finally(() => {
        running = undefined
        // An event that landed after the loop's last check gets its own pass.
        if (again) {
          again = false
          void migrate()
        }
      })
    return running
  }

  // At start, and again when the ACP route or its settings change: an adapter installed
  // later, or dshTools turned on, still moves a team that has not moved.
  void rt.load().then(migrate)
  for (const event of ['llm/adapters-updated', 'settings/document-updated', 'loader/volatile-update', 'acp-agents/bridge-ready']) {
    ctx.on?.(event, () => { void migrate() })
  }
}
