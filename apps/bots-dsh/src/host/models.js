// Models. Every Bot runs on one model of its own, fixed when it is created and changed
// only in its settings or by a Main Bot. The team's first Main Bot has none until the
// user picks one in its chat. The Session keeps the selection durably.
import { piAiRoutes, routeOf } from '../shared/routes.js'
import { refusal } from './refusal.js'
import { normalize, splitRef } from './text.js'
import { install as installHostModels } from './host-models.js'
import { PI_AI_CLAUDE, claudeFamilyOf, supersededClaude } from './claude-models.js'

const CATALOG_TTL_MS = 10_000
// What a refused model says, by case; `{connection}` is the agent's name and route. The client
// words each template in the interface language (i18n.js hostText).
export const ACCESS_MESSAGES = Object.freeze({
  off: 'Turn on {connection} in Settings → Claude Code and Codex before using this model.',
  installing: 'Wait for {connection} to finish installing, or retry it in Settings → Claude Code and Codex.',
  signIn: 'Sign in to {connection} before using this model.',
  // Signed in on this computer, to an account the person has not confirmed for Bots (#869).
  account: 'Confirm the account of {connection} before using this model.',
})
// The refusal of a model whose agent is signed in to an account the person has not confirmed
// (acp-dsh's `consent: 'needed'`): the sign-in card's confirm step answers it, a sign-in does not.
export const ACCOUNT_CONFIRM_REQUIRED = 'bot/account-confirm-required'
const ROUTE_WAIT_MS = 30_000
// How often an agent whose sign-in acp-dsh has not checked yet is asked once, in the
// background: the menu reads acp-dsh's last answer and never spawns a check when it opens.
const SIGN_IN_CHECK_MS = 5 * 60_000
// How long a fresh catalog waits on acp-dsh's status before it keeps the last answer.
const STATUS_WAIT_MS = 1000

// A connection's name in the model menu: the brand, without the route's id. How it is
// connected (`via`) is worded by the menu (API key, sign-in); an agent is its CLI's name.
const BRANDS = Object.freeze({ anthropic: 'Anthropic', openai: 'OpenAI', 'openai-codex': 'ChatGPT', 'acp-claude': 'Claude Code', 'acp-codex': 'Codex' })
function brandOf(provider, directory) {
  if (BRANDS[provider.id] !== undefined) return BRANDS[provider.id]
  const name = typeof provider.name === 'string' && provider.name !== '' && provider.name !== provider.id ? provider.name : undefined
  if (routeOf(provider.id).connectedBy === 'acp') return (name ?? provider.id).replace(/\s*\(ACP\)$/, '')
  return name ?? directory.find(entry => entry?.provider === provider.id)?.displayName ?? provider.id
}
// The agent that serves a subscription DSH could also sign in to: ChatGPT and Claude Pro/Max
// sign in only through their CLIs (D-a), so a Bot runs a plan through Claude Code or Codex
// (D-c), never DSH's own sign-in route. That route is `covered`: no Bot connection, shown only
// as the model a Bot is still on. The jobs beside the chats keep it (D-g).
const CLI_OF_SIGNIN = Object.freeze({ 'openai-codex': 'acp-codex', anthropic: 'acp-claude' })
const PLAN_NAMES = Object.freeze({ 'openai-codex': 'ChatGPT', anthropic: 'Claude' })
const coveredBy = entry => (entry.via === 'signin' ? CLI_OF_SIGNIN[entry.provider] : undefined)
// What a Bot's own chat can start on: a provider with its key, an agent that is signed in, a
// sign-in route of another provider that is stored, and never a route a CLI covers. An agent
// signed in to an account nobody confirmed (`needsAccount`, #869) is never a default: a Bot
// goes on it only by the person's own pick, which asks them first.
export const configured = entry => !entry.needsKey && !entry.needsSignIn && !entry.covered && !entry.needsAccount
// The model of a covered sign-in route on its agent, among `usable`: the same id, else the same
// Claude family (Claude Code names its models `opus`, `sonnet`, `haiku`, or a versioned id such
// as `claude-fable-5-1[1m]`), else the agent's own
// `default`, else its first. Undefined when the agent offers nothing that can run.
function cliPeerOf(entry, usable) {
  const agent = CLI_OF_SIGNIN[entry?.provider]
  const own = agent === undefined ? [] : usable.filter(item => item.provider === agent)
  if (own.length === 0) return undefined
  const family = entry.provider === PI_AI_CLAUDE ? claudeFamilyOf(`claude-code/${entry.id}`) : undefined
  const sameFamily = family === undefined ? undefined : own.find(item => item.id === family) ?? own.find(item => claudeFamilyOf(`claude-code/${item.id}`) === family)
  return own.find(item => item.id === entry.id) ?? sameFamily ?? own.find(item => item.id === 'default') ?? own[0]
}

// The model an agent's own `default` runs on, when its catalog says (acp-dsh catalog.js
// describes that row "Its own setting: <model>"): the menu names the row "Default (<model>)"
// rather than the agent's name twice.
const OWN_SETTING = /^Its own setting: (.+)$/
function resolvedDefault(provider, model) {
  if (model?.id !== 'default' || routeOf(provider).connectedBy !== 'acp') return {}
  const name = OWN_SETTING.exec(typeof model.description === 'string' ? model.description : '')?.[1]?.trim()
  return name ? { resolvesTo: name } : {}
}

export function install(rt) {
  const { ctx, state } = rt
  // Bots a plugin answers for on its own engine (host-models.js) never run on a DSH model.
  installHostModels(rt)
  const onDsh = bot => !rt.hostOwned(bot)

  let modelsSynced = null
  let catalogCache = { at: 0, value: [] }
  // A model's thinking levels, resolved once and kept for a short while: they change
  // only with the provider, which also drops the catalog cache.
  const reasoningCache = new Map()
  ctx.on?.('llm/adapters-updated', () => { catalogCache = { at: 0, value: [] }; reasoningCache.clear() })
  for (const name of ['credentials/reference-updated', 'settings/document-updated']) ctx.on?.(name, () => { catalogCache = { at: 0, value: [] } })

  // The thinking levels a model serves: `{efforts: [{id, name, description?}],
  // defaultEffort?}`, or undefined when it has none or the provider cannot say.
  async function reasoningOf(ref) {
    const cached = reasoningCache.get(ref)
    if (cached !== undefined && Date.now() - cached.at < CATALOG_TTL_MS) return cached.value
    const route = splitRef(ref)
    const info = route === undefined ? undefined : await ctx.llm.resolveModelInfo?.(route.provider, route.model).catch(() => undefined)
    const value = info?.reasoning === undefined ? undefined : {
      efforts: (info.reasoning.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name ?? effort.id, ...(effort.description ? { description: effort.description } : {}) })),
      ...(info.reasoning.defaultEffort === undefined ? {} : { defaultEffort: info.reasoning.defaultEffort }),
    }
    reasoningCache.set(ref, { at: Date.now(), value })
    return value
  }

  // Each agent's sign-in as acp-dsh last saw it: true, false, or absent while unknown. A
  // fresh catalog (a menu about to open) reads acp-dsh's `status()`, which spawns nothing; any
  // other catalog keeps the last answer. An unknown agent ready to run is checked once in the
  // background (acp-dsh's `inspect`, one `auth status`), at most every SIGN_IN_CHECK_MS.
  const agentSignIn = new Map()
  // The agents signed in to an account the person has not confirmed (acp-dsh's `consent`). An
  // older acp-dsh says nothing, and nothing is asked.
  const agentUnconfirmed = new Set()
  const noteConsent = (row) => {
    const needed = row?.signedIn === true && row.consent === 'needed'
    if (needed === agentUnconfirmed.has(row.id)) return false
    if (needed) agentUnconfirmed.add(row.id)
    else agentUnconfirmed.delete(row.id)
    return true
  }
  const signInChecks = new Map()
  const acpAgents = () => { try { return ctx.get?.('acpAgents') } catch { return undefined } }
  async function readAgentSignIns() {
    const agents = acpAgents()
    if (typeof agents?.status !== 'function') return
    let timer
    const late = new Promise((resolve) => { timer = setTimeout(resolve, STATUS_WAIT_MS) })
    let rows
    try { rows = (await Promise.race([Promise.resolve().then(() => agents.status()), late]))?.agents } catch {} finally { clearTimeout(timer) }
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (typeof row?.id !== 'string') continue
      noteConsent(row)
      if (typeof row.signedIn === 'boolean') { agentSignIn.set(row.id, row.signedIn); continue }
      agentSignIn.delete(row.id)
      const last = signInChecks.get(row.id)
      if (row.on === false || row.connector?.state !== 'ready' || typeof agents.inspect !== 'function' || (last !== undefined && Date.now() - last < SIGN_IN_CHECK_MS)) continue
      signInChecks.set(row.id, Date.now())
      void Promise.resolve().then(() => agents.inspect(row.id)).then((seen) => {
        if (typeof seen?.signedIn !== 'boolean') return
        noteConsent({ ...seen, id: row.id })
        agentSignIn.set(row.id, seen.signedIn)
        catalogCache = { at: 0, value: [] }
      }, () => {})
    }
  }

  // A provider's model list can change in DSH settings without any event, so a picker
  // that is about to be used asks for a `fresh` one. Entries for models a Bot uses
  // also carry their `reasoning`, so the picker can offer thinking levels.
  async function catalog({ fresh = false, remember = true } = {}) {
    if (!fresh && Date.now() - catalogCache.at < CATALOG_TTL_MS && catalogCache.value.length > 0) return catalogCache.value
    const listed = []
    let directory = []
    try { directory = ctx.llm.listConfigurableProviders?.() ?? [] } catch {}
    const piAi = piAiRoutes(directory)
    for (const provider of ctx.llm.listProviders()) {
      let models = []
      try { models = await ctx.llm.listModels(provider.id) } catch { continue }
      for (const model of models) {
        listed.push({
          ref: `${provider.id}/${model.id}`,
          provider: provider.id,
          providerName: brandOf(provider, directory),
          id: model.id,
          name: model.name ?? model.id,
          route: routeOf(provider.id, { piAi }),
          ...(model.inputModalities ? { input: [...model.inputModalities] } : {}),
          ...resolvedDefault(provider.id, model),
        })
      }
    }
    const used = new Set(Object.values(state.bots ?? {}).filter(onDsh).flatMap(bot => [bot.model, bot.appliedModel].filter(Boolean)))
    const entries = listed
    // Claude on pi-ai's anthropic route: the menu offers each family's newest model.
    const claude = entries.filter(entry => entry.provider === PI_AI_CLAUDE)
    const superseded = supersededClaude(claude.map(entry => entry.id))
    for (const entry of claude) if (superseded.has(entry.id)) entry.superseded = true
    // DSH serves a provider's models whether or not its key is set; without one, every
    // turn on them fails.
    const missing = await rt.missingKeys?.([...new Set(entries.map(entry => entry.provider))]) ?? new Set()
    for (const entry of entries) if (missing.has(entry.provider)) entry.needsKey = true
    // How each route is connected (providers.js routeAuth) and whether it can run: a plan
    // route with no stored sign-in, or an agent whose CLI is signed out, `needsSignIn`.
    const providers = [...new Set(entries.map(entry => entry.provider))]
    const agentsListed = entries.some(entry => routeOf(entry.provider).connectedBy === 'acp')
    const [auth] = await Promise.all([
      Promise.resolve().then(() => rt.routeAuth?.(providers)).catch(() => undefined).then(value => value ?? new Map()),
      fresh && agentsListed ? readAgentSignIns() : undefined,
    ])
    for (const entry of entries) {
      const how = routeOf(entry.provider).connectedBy === 'acp' ? { via: 'cli', ...(agentSignIn.get(entry.provider) === false ? { needsSignIn: true } : {}) } : auth.get(entry.provider)
      if (how?.via) entry.via = how.via
      if (how?.needsSignIn) entry.needsSignIn = true
      // Still offered in the menu: picking it opens the confirm step in the Bot's chat.
      if (how?.via === 'cli' && agentUnconfirmed.has(entry.provider)) entry.needsAccount = true
    }
    // DSH's own ChatGPT or Claude sign-in: its CLI serves that plan, signed in or not.
    for (const entry of entries) if (coveredBy(entry) !== undefined) entry.covered = true
    if (remember) noteConnected(entries)
    await Promise.all(entries.filter(entry => used.has(entry.ref)).map(async (entry) => {
      const reasoning = await reasoningOf(entry.ref)
      if (reasoning !== undefined) entry.reasoning = reasoning
    }))
    catalogCache = { at: Date.now(), value: entries }
    return entries
  }

  // The profile default model of DSH as set, served or not.
  const defaultRef = () => {
    const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
    return selection?.provider && selection?.model ? `${selection.provider}/${selection.model}` : undefined
  }
  // The providers in the order they could first run here (a key set, an account signed
  // in), kept with the team: "the first account you connected".
  function noteConnected(entries) {
    if (!Array.isArray(state.providersSeen)) state.providersSeen = []
    const seen = state.providersSeen
    const fresh = [...new Set(entries.filter(entry => !entry.needsKey).map(entry => entry.provider))].filter(provider => !seen.includes(provider))
    if (fresh.length === 0) return
    seen.push(...fresh)
    void rt.save?.()?.catch?.(() => {})
  }
  // The profile default model of DSH (DeepSeek, unless the user chose another there), when
  // it is served and can run (its provider has its key); else a model of the first account
  // connected here. Within a provider, a `default` alias comes after the models it names, and
  // a superseded model (an older Claude) after the current ones.
  // Nothing can run: none, and a Bot made then waits for one.
  // `canRun`: what counts as able to run. A Bot's own model skips a sign-in that is missing
  // and a route a CLI covers; the jobs beside the chats keep their own rule.
  // DSH's default on a ChatGPT or Claude sign-in it cannot run that way is read as the same
  // model on that plan's CLI, when the CLI can run.
  function pickDefault(entries, canRun = configured) {
    const usable = entries.filter(canRun)
    const ref = defaultRef()
    const chosen = usable.find(entry => entry.ref === ref)
    if (chosen) return chosen.ref
    const signIn = entries.find(entry => entry.ref === ref && entry.covered === true)
    const peer = signIn === undefined ? undefined : cliPeerOf(signIn, usable)
    if (peer) return peer.ref
    const seen = Array.isArray(state.providersSeen) ? state.providersSeen : []
    const rank = entry => (seen.includes(entry.provider) ? seen.indexOf(entry.provider) : seen.length)
    const ordered = usable.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry)
    const first = ordered[0]?.provider
    const own = ordered.filter(entry => entry.provider === first)
    return (own.find(entry => entry.id !== 'default' && entry.superseded !== true) ?? own.find(entry => entry.id !== 'default') ?? own[0])?.ref
  }
  const defaultModel = async () => pickDefault(await catalog())

  // The model of the jobs that run beside the chats (memory review, the memory panel, a part's
  // note or checkpoint when its chat is on an agent): one that answers a request on its own. An
  // agent over ACP answers only in its own chat, so it is never one. The team's pick
  // (prefs.backgroundModel, in Settings) when it is served and can run; else DSH's default
  // model (DeepSeek, unless the person chose another there) when that can; else the first
  // account connected here, as for a Bot's default.
  const answersAside = entry => routeOf(entry.provider).connectedBy !== 'acp'
  function pickBackground(entries) {
    const aside = entries.filter(answersAside)
    const chosen = state.prefs?.backgroundModel
    if (typeof chosen === 'string' && aside.some(entry => entry.ref === chosen && !entry.needsKey)) return chosen
    return pickDefault(aside, entry => !entry.needsKey)
  }
  const backgroundModel = async () => pickBackground(await catalog())
  /** Whether a `provider/model` ref can answer a job beside the chats (not an ACP agent). */
  const answersAsideRef = ref => typeof ref === 'string' && ref.includes('/') && routeOf(ref.split('/')[0]).connectedBy !== 'acp'

  // A ChatGPT or Claude plan runs a Bot only through its CLI (D-a, D-c), whoever picks the model
  // (the menu, a tool, the API, Pocket): a covered sign-in route is read as the closest model on
  // that plan's agent (cliPeerOf, as the one-time move maps it), signed in or not, so the
  // agent's own sign-in answers. `keep`, the model the Bot is on now, stays as it is. With no
  // model of that agent served (its CLI off), the pick is refused.
  function onPlanCli(ref, entries, keep) {
    const entry = entries.find(item => item.ref === ref)
    if (entry?.covered !== true || ref === keep) return ref
    const peer = cliPeerOf(entry, entries.filter(item => !item.covered && !item.needsKey))
    if (peer !== undefined) return peer.ref
    const plan = PLAN_NAMES[entry.provider] ?? entry.provider
    const cli = BRANDS[CLI_OF_SIGNIN[entry.provider]] ?? CLI_OF_SIGNIN[entry.provider]
    throw refusal(`A ${plan} plan runs Bots only through ${cli}. Turn ${cli} on, then pick one of its models.`)
  }

  // A full `provider/model` ref, or a model id or name that only one provider serves.
  // `checkAccess`: a model that cannot run now (modelAccess) is refused here, before anything
  // is written. `remember: false` leaves the team's record of connected providers alone, so a
  // refused pick changes nothing. `keep`: the Bot's current model, never moved (onPlanCli).
  async function resolveModel(text, { checkAccess = false, remember = true, keep } = {}) {
    const entries = await catalog({ fresh: true, remember })
    const wanted = String(text ?? '').trim()
    const exact = entries.find(entry => entry.ref === wanted)
    const named = exact ? [] : entries.filter(entry => normalize(entry.id) === normalize(wanted) || normalize(entry.name) === normalize(wanted))
    const picked = exact?.ref ?? (named.length === 1 ? named[0].ref : undefined)
    if (picked !== undefined) {
      const found = onPlanCli(picked, entries, keep)
      if (checkAccess) await assertModelAccess(found)
      return found
    }
    const known = entries.map(entry => entry.ref).join(', ') || 'none'
    throw refusal(named.length > 1
      ? `Model ${wanted} is served by more than one provider; use one of ${named.map(entry => entry.ref).join(', ')}`
      : `Model ${wanted} is not available. Available models: ${known}`)
  }

  // Whether a model can run now, read-only: nothing is installed, enabled or signed in, and no
  // model is called. An agent over ACP (Claude Code, Codex) is asked through acp-dsh's
  // `inspect` (a fresh `auth status` of that CLI only); its connection must be on, installed
  // and not signed out. A sign-in DSH cannot read (`signedIn` unknown, an older acp-dsh, a
  // failed check) does not refuse: the agent's own answer decides then, and a signed-out agent
  // fails its turn as MODEL_ACCESS_REQUIRED. Any other provider keeps the catalog's own marks
  // (a missing key shows in the picker) and is not refused here.
  // `{ ready: true }` or `{ ready: false, code, message }`; `code` is `bot/sign-in-required`
  // only when the CLI says it is signed out, the one case a sign-in answers, and
  // `bot/account-confirm-required` only when acp-dsh says the signed-in account waits for the
  // person's word (#869). An account that cannot be read, or an acp-dsh that says nothing of
  // consent, never refuses.
  async function modelAccess(ref) {
    const route = splitRef(ref)
    if (route === undefined || route.model === '') return { ready: false, code: 'bot/refused', message: 'Choose an available model.' }
    const { provider } = route
    if (routeOf(provider).connectedBy !== 'acp') return { ready: true, provider }
    const agents = ctx.get?.('acpAgents')
    if (typeof agents?.inspect !== 'function') return { ready: true, provider }
    let agent
    try {
      agent = await agents.inspect(provider)
    } catch (error) {
      rt.warn('ds-bot: the sign-in of %s could not be checked: %s', provider, error?.message ?? error)
      return { ready: true, provider }
    }
    if (agent === undefined) return { ready: true, provider }
    const connection = `${agent.name ?? provider} (${provider})`
    const denied = (template, code = 'bot/refused') => ({ ready: false, provider, code, template, message: template.replace('{connection}', connection) })
    if (agent.on === false) return denied(ACCESS_MESSAGES.off)
    if (agent.cli?.found === false || agent.connector?.state === 'installing' || agent.connector?.state === 'failed' || agent.connector?.state === 'no-cli') return denied(ACCESS_MESSAGES.installing)
    if (agent.signedIn === false) return denied(ACCESS_MESSAGES.signIn, 'bot/sign-in-required')
    if (noteConsent({ ...agent, id: provider })) catalogCache = { at: 0, value: [] }
    if (agent.signedIn === true && agent.consent === 'needed') return denied(ACCESS_MESSAGES.account, ACCOUNT_CONFIRM_REQUIRED)
    return { ready: true, provider }
  }

  async function assertModelAccess(ref) {
    const access = await modelAccess(ref)
    if (!access.ready) throw refusal(access.message, { code: access.code })
    return access
  }

  // A Bot with no model yet waits for the user to pick one and changes nothing. A
  // model that is no longer served falls back to the last one it ran on, then the default.
  async function desiredModel(bot) {
    if (!bot.model || !onDsh(bot)) return undefined
    const entries = await catalog()
    const served = new Set(entries.map(entry => entry.ref))
    return [bot.model, bot.appliedModel].find(ref => ref && served.has(ref)) ?? pickDefault(entries)
  }

  // The thinking level a Bot asked for, when the model it runs on serves it; else the
  // model's own default applies. A level the model does not have is ignored, never
  // sent: an explicit effort a provider does not know is a hard refusal there.
  async function desiredEffort(bot, ref) {
    if (bot.effort === undefined || ref === undefined) return undefined
    const reasoning = await reasoningOf(ref)
    const efforts = reasoning?.efforts ?? []
    if (efforts.some(effort => effort.id === bot.effort)) return bot.effort
    // A model may name the same level with another id, as resolveEffort already reads.
    const named = efforts.filter(effort => normalize(effort.name) === normalize(bot.effort))
    return named.length === 1 ? named[0].id : undefined
  }

  // A thinking level id, or a name only one level of the model has, like resolveModel.
  async function resolveEffort(ref, text) {
    const wanted = String(text ?? '').trim()
    if (wanted === '') return undefined
    const reasoning = await reasoningOf(ref)
    const efforts = reasoning?.efforts ?? []
    if (efforts.length === 0) throw refusal(`Model ${ref} has no thinking levels`)
    const key = normalize(wanted)
    const named = efforts.filter(effort => normalize(effort.id) === key || normalize(effort.name) === key)
    if (named.length === 1) return named[0].id
    throw refusal(`Thinking level ${wanted} is not available for ${ref}. Available: ${efforts.map(effort => effort.name).join(', ')}`)
  }

  // The profile default model's thinking level, when the model a Bot starts on
  // serves it. A level the model does not know is ignored, like an inherited
  // `bot.effort` — the model's own default applies instead.
  async function defaultEffort(ref) {
    const wanted = ctx.get?.('agentDefaultModel')?.currentSelection?.()?.reasoningEffort
    if (ref === undefined || wanted === undefined) return undefined
    return resolveEffort(ref, wanted).catch(() => undefined)
  }

  // DSH's selectModel also saves the selection as the profile default model, in the
  // background. A Bot's model is its own, so the user's default is written back after
  // it. Selections run one at a time and wait for the write-back: profile writes land in
  // submission order, so the next one reads the user's default, not a Bot's. A write-back
  // that fails while the default still reads as the user's lost nothing: inside DSH's
  // plugin reload every profile write is refused ("HMR transactions cannot be nested"),
  // DSH's own save of the selection included, so the default never moved.
  let selecting = Promise.resolve()
  function selectSessionModel(sessionId, { provider, model, reasoningEffort }) {
    const run = selecting.then(async () => {
      const defaults = ctx.get?.('agentDefaultModel')
      const before = defaults?.currentSelection?.()
      const result = await ctx.sessionController.selectModel({
        sessionId, provider, model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      })
      const saved = result?.selected ?? { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
      if (before?.provider && before?.model && !sameSelection(before, saved)) {
        await defaults.saveSelection(before).catch((error) => {
          if (!sameSelection(defaults.currentSelection(), before)) rt.warn('ds-bot: the default model was not restored: %s', error)
        })
      }
      return result
    })
    selecting = run.catch(() => {})
    return run
  }

  const sameSelection = (a, b) => a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort

  // `force` re-selects even when the record says it is applied: the composer's own
  // model picker can move the Session without telling this plugin.
  async function applyModel(bot, { force = false } = {}) {
    const ref = await desiredModel(bot)
    if (ref === undefined) return ref
    const effort = await desiredEffort(bot, ref)
    if (!force && bot.appliedModel === ref && (bot.appliedEffort ?? undefined) === effort) return ref
    const route = { ...splitRef(ref), ...(effort === undefined ? {} : { reasoningEffort: effort }) }
    await selectSessionModel(rt.chatOf(bot.id), route)
    for (const sessionId of rt.groupSessionsOf(bot.id)) {
      await selectSessionModel(sessionId, route)
        .catch(error => rt.warn('ds-bot: model for %s in a group not applied: %s', bot.name, error))
    }
    bot.appliedModel = ref
    if (effort === undefined) delete bot.appliedEffort
    else bot.appliedEffort = effort
    await rt.save()
    return ref
  }

  // A provider may register after the plugin starts; a greeting waits for its Bot's
  // model instead of failing with "no adapter registered".
  async function waitForModel(bot, ms = ROUTE_WAIT_MS) {
    const deadline = Date.now() + ms
    for (;;) {
      if (!bot.model || !onDsh(bot)) return undefined
      catalogCache = { at: 0, value: [] }
      const served = new Set((await catalog()).map(entry => entry.ref))
      if (served.has(bot.model) || Date.now() >= deadline) return desiredModel(bot)
      await new Promise((resolve) => {
        const timer = setTimeout(done, Math.min(2000, deadline - Date.now()))
        const off = ctx.on?.('llm/adapters-updated', done)
        function done() { clearTimeout(timer); off?.(); resolve() }
      })
    }
  }

  // Sequential, and again whenever the served models change: a provider that
  // registers late still gets its Bots' models selected.
  let syncedKey
  const syncModels = () => {
    const key = catalogCache.value.map(entry => entry.ref).join(',')
    if (key !== syncedKey) { syncedKey = key; modelsSynced = modelsSynced?.then(syncAll, syncAll) ?? syncAll() }
    return modelsSynced
  }
  async function syncAll() {
    for (const bot of Object.values(state.bots)) {
      await applyModel(bot).catch(error => rt.warn('ds-bot: model for %s not applied: %s', bot.name, error))
    }
  }

  Object.assign(rt, {
    catalog, cachedCatalog: () => catalogCache.value, cachedDefault: () => pickDefault(catalogCache.value),
    defaultRef, defaultModel, defaultEffort, resolveModel, modelAccess, assertModelAccess, desiredModel, reasoningOf, resolveEffort, desiredEffort,
    backgroundModel, cachedBackground: () => pickBackground(catalogCache.value), answersAside: answersAsideRef,
    selectSessionModel, applyModel, waitForModel, syncModels,
    dropCatalog: () => { catalogCache = { at: 0, value: [] } },
  })
}
