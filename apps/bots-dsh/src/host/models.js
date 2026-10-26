// Models. Every Bot runs on one model of its own, fixed when it is created and changed
// only in its settings or by a Main Bot. The team's first Main Bot has none until the
// user picks one in its chat. The Session keeps the selection durably.
import { normalize, splitRef } from './text.js'

const CATALOG_TTL_MS = 10_000
const ROUTE_WAIT_MS = 30_000

// Claude through Claude Code (dsh-oh-my-claude, provider claude-code or claude-code-<box>)
// lists the CLI's own lineup and then every model the plugin has known, so a Session stored
// on an older id still resolves. Omni offers the newest of each family: a model that a newer
// one of its family, or the CLI's alias for the family (opus, sonnet, haiku), supersedes is
// left out, and the 1M variant stands in for its plain twin. A model a Bot runs on stays.
const isClaudeCode = provider => provider === 'claude-code' || String(provider).startsWith('claude-code-')
const VERSIONED = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/
const versionOf = (id) => {
  const match = VERSIONED.exec(id)
  return match ? { family: match[1], version: Number(match[2]) + Number(match[3] ?? 0) / 100, wide: match[4] !== undefined } : undefined
}
export function currentClaudeModels(entries, keep = new Set()) {
  const providers = new Map()
  for (const entry of entries) {
    if (!isClaudeCode(entry.provider)) continue
    const seen = providers.get(entry.provider) ?? { aliases: new Set(), newest: new Map() }
    providers.set(entry.provider, seen)
    if (/^[a-z]+$/.test(entry.id) && entry.id !== 'default') seen.aliases.add(entry.id)
    const at = versionOf(entry.id)
    const best = at && seen.newest.get(at.family)
    if (at && (!best || at.version > best.version || (at.version === best.version && at.wide && !best.wide))) seen.newest.set(at.family, at)
  }
  return entries.filter((entry) => {
    const at = isClaudeCode(entry.provider) && !keep.has(entry.ref) ? versionOf(entry.id) : undefined
    if (at === undefined) return true
    const seen = providers.get(entry.provider)
    const best = seen.newest.get(at.family)
    return !seen.aliases.has(at.family) && at.version === best.version && at.wide === best.wide
  })
}

export function install(rt) {
  const { ctx, state } = rt

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

  // A provider's model list can change in DSH settings without any event, so a picker
  // that is about to be used asks for a `fresh` one. Entries for models a Bot uses
  // also carry their `reasoning`, so the picker can offer thinking levels.
  async function catalog({ fresh = false } = {}) {
    if (!fresh && Date.now() - catalogCache.at < CATALOG_TTL_MS && catalogCache.value.length > 0) return catalogCache.value
    const listed = []
    for (const provider of ctx.llm.listProviders()) {
      let models = []
      try { models = await ctx.llm.listModels(provider.id) } catch { continue }
      for (const model of models) {
        listed.push({
          ref: `${provider.id}/${model.id}`,
          provider: provider.id,
          providerName: provider.name ?? provider.id,
          id: model.id,
          name: model.name ?? model.id,
          ...(model.inputModalities ? { input: [...model.inputModalities] } : {}),
        })
      }
    }
    const used = new Set(Object.values(state.bots ?? {}).flatMap(bot => [bot.model, bot.appliedModel].filter(Boolean)))
    const entries = currentClaudeModels(listed, used)
    // DSH serves a provider's models whether or not its key is set; without one, every
    // turn on them fails.
    const missing = await rt.missingKeys?.([...new Set(entries.map(entry => entry.provider))]) ?? new Set()
    for (const entry of entries) if (missing.has(entry.provider)) entry.needsKey = true
    noteConnected(entries)
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
  // connected here; Claude Code last, since it can run from the start on the credentials of
  // a Claude Code already on this computer, not an account connected here. Within a
  // provider, its `default` alias (Claude Code's "Default (recommended)") comes after the
  // models it names. Nothing can run: none, and a Bot made then waits for one.
  function pickDefault(entries) {
    const usable = entries.filter(entry => !entry.needsKey)
    const ref = defaultRef()
    const chosen = usable.find(entry => entry.ref === ref)
    if (chosen) return chosen.ref
    const seen = Array.isArray(state.providersSeen) ? state.providersSeen : []
    const rank = entry => (isClaudeCode(entry.provider) ? 1 : 0) * 1e6 + (seen.includes(entry.provider) ? seen.indexOf(entry.provider) : seen.length)
    const ordered = usable.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry)
    const first = ordered[0]?.provider
    const own = ordered.filter(entry => entry.provider === first)
    return (own.find(entry => entry.id !== 'default') ?? own[0])?.ref
  }
  const defaultModel = async () => pickDefault(await catalog())

  // A full `provider/model` ref, or a model id or name that only one provider serves.
  async function resolveModel(text) {
    const entries = await catalog({ fresh: true })
    const wanted = String(text ?? '').trim()
    const exact = entries.find(entry => entry.ref === wanted)
    if (exact) return exact.ref
    const key = normalize(wanted)
    const named = entries.filter(entry => normalize(entry.id) === key || normalize(entry.name) === key)
    if (named.length === 1) return named[0].ref
    const known = entries.map(entry => entry.ref).join(', ') || 'none'
    throw new Error(named.length > 1
      ? `Model ${wanted} is served by more than one provider; use one of ${named.map(entry => entry.ref).join(', ')}`
      : `Model ${wanted} is not available. Available models: ${known}`)
  }

  // A Bot with no model yet waits for the user to pick one and changes nothing. A
  // model that is no longer served falls back to the last one it ran on, then the default.
  async function desiredModel(bot) {
    if (!bot.model) return undefined
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
    return reasoning?.efforts?.some(effort => effort.id === bot.effort) ? bot.effort : undefined
  }

  // A thinking level id, or a name only one level of the model has, like resolveModel.
  async function resolveEffort(ref, text) {
    const wanted = String(text ?? '').trim()
    if (wanted === '') return undefined
    const reasoning = await reasoningOf(ref)
    const efforts = reasoning?.efforts ?? []
    if (efforts.length === 0) throw new Error(`Model ${ref} has no thinking levels`)
    const key = normalize(wanted)
    const named = efforts.filter(effort => normalize(effort.id) === key || normalize(effort.name) === key)
    if (named.length === 1) return named[0].id
    throw new Error(`Thinking level ${wanted} is not available for ${ref}. Available: ${efforts.map(effort => effort.name).join(', ')}`)
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
      if (!bot.model) return undefined
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
    defaultRef, defaultModel, resolveModel, desiredModel, reasoningOf, resolveEffort, desiredEffort,
    selectSessionModel, applyModel, waitForModel, syncModels,
    dropCatalog: () => { catalogCache = { at: 0, value: [] } },
  })
}
