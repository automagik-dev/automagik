// A Claude or ChatGPT subscription signs in once, through its own CLI (Claude Code, Codex),
// which Automagik installs. Bots that still run on a subscription through DSH (pi-ai's
// `openai-codex`, the ChatGPT sign-in; pi-ai's `anthropic` on a Claude Pro or Max sign-in) move
// once per team to that CLI's route over ACP: `acp-codex/<same id>` and `acp-claude/<same id,
// else the same family>`, else the agent's `default`. A Bot on an API key never moves:
// `openai`, every other route, and `anthropic` whenever a key may be what it runs on.
//
// `anthropic` counts as the Pro or Max sign-in only when all of these hold (anthropicSubscription):
// DSH's settings show its route with no `apiKeyEnv`, DSH's credential store holds pi-ai's
// `llm-pi-ai/anthropic` record as a sign-in grant (its kind only: the value is never read), and
// no ANTHROPIC_API_KEY is set where pi-ai's own discovery would find it. Anything else, or
// anything this cannot read, is a key route or an unknown one, and is left alone and unmarked.
//
// The move needs the CLI's route registered (acp-dsh serves it while the agent is on) and the
// agent's catalog really read: until acp-dsh's probe answers, a route lists only the agent's
// `default` stand-in, and moving then would drop every Bot's model. Such a pass moves nothing
// and marks nothing; the next pass (an adapter or settings change, or the retry a waiting pass
// schedules) maps each Bot to the closest model. A CLI that is not signed in still takes the
// Bot once its catalog is known, and its first turn asks for the sign-in in the Bot's chat
// (MODEL_ACCESS_REQUIRED, cli-login.js). No credential is copied or read between programs:
// only the route names on the Bots change.
//
// acp-adoption.js follows the same rule: once a Claude plan signs in only through Claude Code,
// its rollback never puts a Bot back on the `anthropic` sign-in route.
//
// Each source route is done once (`state.subscriptionCliMoved[<route>]`), so a model the
// person picks later is theirs. Each moved Bot keeps a record (`subscriptionMoved`: the model
// and level it had, and the target). `previousModel` follows the same mapping: a confirmed Bot
// stays confirmed on its target, and a pending switch keeps the model it would go back to,
// never a subscription route that no longer answers. The Session and its history stay; the
// next sync selects the target, carrying the Bot's level where the agent offers it.
// Auxiliary jobs (prefs.backgroundModel) never run on an agent and are not touched here.
import { claudeFamilyOf } from './claude-models.js'
import { splitRef } from './text.js'

const PI_AI_NS = 'llm-pi-ai'
// The agent's own "default" row, which acp-dsh always serves (acp-dsh catalog.js DEFAULT_MODEL).
const AGENT_DEFAULT = 'default'
// pi-ai's stored sign-in for Claude, and the variable its own discovery reads for a key.
const ANTHROPIC_RECORD = `${PI_AI_NS}/anthropic`
const ANTHROPIC_KEY_REF = 'ANTHROPIC_API_KEY'
// A pass that waited on an agent's catalog looks again after this long.
const CATALOG_RETRY_MS = 60_000

/** Whether an agent's list is its real catalog: acp-dsh's stand-in before a probe may be only `default`. */
const catalogRead = listed => listed.some(id => id !== AGENT_DEFAULT)

/** The id an agent lists for a model: the same id, or a listed id that is that id with a suffix. */
const sameId = (id, listed) => (listed.includes(id)
  ? id
  : listed.find(entry => typeof entry === 'string' && /^[/[]/.test(entry.slice(id.length)) && entry.startsWith(id)))

export const SUBSCRIPTION_MOVES = Object.freeze([
  Object.freeze({
    from: 'openai-codex',
    to: 'acp-codex',
    target: (id, listed) => sameId(id, listed) ?? AGENT_DEFAULT,
  }),
  Object.freeze({
    from: 'anthropic',
    to: 'acp-claude',
    // Claude Code lists its aliases (`opus`, `sonnet`, `haiku`) where pi-ai names versions.
    target: (id, listed) => {
      const same = sameId(id, listed)
      if (same !== undefined) return same
      const family = claudeFamilyOf(`claude-code/${id}`)
      return family !== undefined && listed.includes(family) ? family : AGENT_DEFAULT
    },
  }),
])

/**
 * The `<agent>/<model>` a ref moves to, or undefined when it is not on `move.from`.
 * @param {string | undefined} ref
 * @param {{ from: string, to: string, target(id: string, listed: string[]): string }} move
 * @param {string[]} listed the model ids the agent's route serves
 */
export function movedRef(ref, move, listed) {
  const route = splitRef(ref)
  if (route === undefined || route.provider !== move.from || route.model === '') return undefined
  return `${move.to}/${move.target(route.model, listed)}`
}

/**
 * Whether `provider` is a pi-ai route set up in DSH's settings with no `apiKeyEnv`: true, false
 * (a key route, or not set up), or undefined when the settings cannot be read.
 */
function signInRoute(ctx, provider) {
  try {
    const settings = ctx.get?.('settings')
    const entry = ctx.llm.listConfigurableProviders?.()?.find(row => row?.provider === provider)
    if (settings === undefined || entry === undefined || entry.settingsNs !== PI_AI_NS) return undefined
    const section = settings.describe({ redactSecrets: true }).find(row => row?.ns === PI_AI_NS)
    const profile = (entry.settingsPath ?? []).reduce((value, key) => value?.[key], section?.value)
    if (profile === undefined || profile === null) return false
    return !(typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv !== '')
  } catch {
    return undefined
  }
}

/**
 * The one rule for whether a pi-ai route with no `apiKeyEnv` runs on its provider's sign-in
 * rather than a key, shared by the move (anthropicSubscription), the model menu (providers.js
 * routeAuth) and, through `omniTeam.anthropicSubscription`, Connect AI: pi-ai's stored record
 * is a sign-in grant (pi-ai stores a pasted key as a record too, of kind `api-key`), and no key
 * is found where pi-ai's own discovery would read one instead.
 * @param {{ configured?: boolean, kind?: string } | undefined} record DSH's description of the record
 * @param {boolean} keyFound
 */
export const runsOnSignIn = (record, keyFound) => record?.configured === true && record.kind === 'grant' && keyFound !== true

/**
 * Whether pi-ai's `anthropic` route runs on a Claude Pro or Max sign-in: true only when the
 * route names no `apiKeyEnv`, the stored record is a sign-in grant, and no ANTHROPIC_API_KEY is
 * found. false when a key is (or may be) what it runs on, or nothing is signed in; undefined
 * when DSH's settings or credential store cannot be read. Reads descriptions only, never a value.
 * @returns {Promise<boolean | undefined>}
 */
export async function anthropicSubscription(ctx) {
  const route = signInRoute(ctx, 'anthropic')
  if (route !== true) return route
  try {
    const credentials = ctx.get?.('credentials')
    if (credentials === undefined || typeof credentials.describeRecord !== 'function') return undefined
    const record = await credentials.describeRecord(ANTHROPIC_RECORD)
    if (!runsOnSignIn(record, false)) return false
    // pi-ai's own discovery finds a key in the environment or DSH's store: it may win over the
    // grant, so the route may be on a key.
    const key = await credentials.describe?.(ANTHROPIC_KEY_REF)
    return runsOnSignIn(record, key?.configured === true)
  } catch {
    return undefined
  }
}

export function install(rt) {
  const { ctx, state } = rt
  const subscription = async from => (from === 'anthropic' ? await anthropicSubscription(ctx) === true : true)

  const registered = (id) => {
    try {
      return ctx.llm.listProviders().some(provider => provider?.id === id)
    } catch {
      return false
    }
  }
  async function listedOf(id) {
    const models = await ctx.llm.listModels(id)
    return (Array.isArray(models) ? models : []).map(model => model?.id).filter(value => typeof value === 'string')
  }

  const move = async () => {
    await rt.load()
    // Nothing is written by a host that only reads the team.
    if (rt.readOnly?.() !== undefined) return
    const done = state.subscriptionCliMoved !== null && typeof state.subscriptionCliMoved === 'object' ? state.subscriptionCliMoved : {}
    const moved = []
    let changed = false
    let waiting = false
    for (const spec of SUBSCRIPTION_MOVES) {
      if (done[spec.from] === true) continue
      if (!registered(spec.to) || !await subscription(spec.from)) continue
      let listed
      try {
        listed = await listedOf(spec.to)
      } catch {
        continue
      }
      // Only the stand-in so far: every Bot would land on `default`. Not done; look again.
      if (!catalogRead(listed)) {
        waiting = true
        continue
      }
      for (const bot of Object.values(state.bots ?? {})) {
        if (bot === undefined || rt.hostOwned?.(bot) === true) continue
        // The model a pending switch would go back to follows too, whatever the Bot is on now.
        const previous = movedRef(bot.previousModel, spec, listed)
        if (previous !== undefined) bot.previousModel = previous
        const target = movedRef(bot.model, spec, listed)
        if (target === undefined) continue
        bot.subscriptionMoved = {
          from: { model: bot.model, ...(bot.effort === undefined ? {} : { effort: bot.effort }) },
          target,
        }
        bot.model = target
        moved.push(bot)
      }
      done[spec.from] = true
      changed = true
    }
    if (waiting) retry()
    if (!changed) return
    state.subscriptionCliMoved = done
    await rt.save()
    // A lock lost during the save leaves the file unchanged; do not move live Sessions to a
    // model the team file does not record.
    if (rt.readOnly?.() !== undefined) return
    for (const bot of moved) {
      rt.warn?.('ds-bot: %s moved from %s to %s (one sign-in per subscription)', bot.name, bot.subscriptionMoved.from.model, bot.model)
      const apply = rt.applyModel
      if (typeof apply !== 'function') break
      await apply(bot, { force: true })
        .catch(error => rt.warn('ds-bot: model for %s not applied: %s', bot.name, error))
    }
  }

  // A pass that waited on a catalog schedules one more; acp-dsh announces no finished probe.
  let retryTimer
  let stopped = false
  const retry = () => {
    if (retryTimer !== undefined || stopped) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void migrate()
    }, CATALOG_RETRY_MS)
    retryTimer.unref?.()
  }
  ctx.effect?.(() => () => {
    stopped = true
    clearTimeout(retryTimer)
    retryTimer = undefined
  }, 'ds-bot: subscription move retry')

  // One pass at a time; an event during a pass gets a pass of its own after it.
  let running
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
      .catch(error => rt.warn('ds-bot: the subscription Bots were not moved to their CLI: %s', error))
      .finally(() => {
        running = undefined
        if (again) {
          again = false
          void migrate()
        }
      })
    return running
  }
  rt.moveSubscriptionBots = migrate
  // The same rule for the other plugins that ask (Connect AI's duplicate of the Claude row).
  rt.anthropicSubscription = () => anthropicSubscription(ctx)

  // At start, and when a route or DSH's settings change: a CLI turned on later still takes the
  // team's subscription Bots.
  void rt.load().then(migrate)
  for (const event of ['llm/adapters-updated', 'settings/document-updated']) ctx.on?.(event, () => { void migrate() })
}
