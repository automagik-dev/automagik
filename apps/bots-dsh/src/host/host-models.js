// Bots whose model menu belongs to the plugin that hosts them. A plugin that runs a Bot kind on
// its own engine, not on a DSH model (the Unfold Bot answers through its app), registers that
// kind with `rt.hooks.botModels(kind, source)` (extend.js). The team then never selects a DSH
// model on those Bots' Sessions (models.js), their menu lists only what the source lists, and
// a pick goes to the source. Without a registration nothing here shows: no state field, no menu.
//
// The source:
//
//   snapshot(bot)           the menu as last read, synchronous (the state answer reads it on
//                           every poll, so it never asks the plugin's engine): a Menu, or
//                           undefined before the first read
//   pick(bot, { id?, effort?, ack? })
//                           apply a pick: `id` an entry, `effort` one of its levels, `ack`
//                           the person confirmed an entry marked `confirm`; resolves when the
//                           engine took it, rejects with a message meant for the person
//   refresh?(bot)           read the menu again; the team calls it when a menu opens
//
// Menu: { entries: [Entry], level?, status?, error? }
//   Entry: { id, label, group?, levels?: [{ id, name }], privacy?, confirm?, current?, answering? }
//     `current` the entry picked; `answering` the one that answers now (they differ during a
//     switch or a fallback). `privacy` says where a message goes, as facts the menu words:
//     { kind: 'local', device? } | { kind: 'direct', provider, memories? }
//     | { kind: 'relay', provider, via, device? }
//   `level` the level picked on the current entry; `status` { kind: 'after-reply' |
//   'switching' | 'fallback', answering? } while the pick has not taken over; `error` why the
//   menu could not be read, for the person.
const MAX_ENTRIES = 64
const MAX_TEXT = 200
const PRIVACY = new Set(['local', 'direct', 'relay'])
const STATUS = new Set(['after-reply', 'switching', 'fallback'])
const REFRESH_MS = 5000

const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : undefined)
const some = (key, value) => (value === undefined ? {} : { [key]: value })

function cleanLevels(levels) {
  if (!Array.isArray(levels)) return undefined
  const clean = levels.flatMap(level => (text(level?.id) ? [{ id: text(level.id), name: text(level.name) ?? text(level.id) }] : []))
  return clean.length > 0 ? clean : undefined
}

function cleanPrivacy(privacy) {
  if (!PRIVACY.has(privacy?.kind)) return undefined
  return {
    kind: privacy.kind,
    ...some('device', text(privacy.device)),
    ...some('provider', text(privacy.provider)),
    ...some('via', text(privacy.via)),
    ...(privacy.memories === true ? { memories: true } : {}),
  }
}

// What the browser gets of a source's menu: the documented fields only, bounded.
export function cleanMenu(menu) {
  if (menu === null || typeof menu !== 'object') return { entries: [], loading: true }
  const entries = (Array.isArray(menu.entries) ? menu.entries : []).slice(0, MAX_ENTRIES).flatMap((entry) => {
    const id = text(entry?.id)
    if (id === undefined) return []
    return [{
      id,
      label: text(entry.label) ?? id,
      ...some('group', text(entry.group)),
      ...some('levels', cleanLevels(entry.levels)),
      ...some('privacy', cleanPrivacy(entry.privacy)),
      ...(entry.confirm === true ? { confirm: true } : {}),
      ...(entry.current === true ? { current: true } : {}),
      ...(entry.answering === true ? { answering: true } : {}),
    }]
  })
  const status = STATUS.has(menu.status?.kind) ? { kind: menu.status.kind, ...some('answering', text(menu.status.answering)) } : undefined
  return { entries, ...some('level', text(menu.level)), ...some('status', status), ...some('error', text(menu.error)) }
}

export function install(rt) {
  const sourceOf = bot => rt.extended?.botModelsOf?.(bot?.kind)
  const owned = () => Object.values(rt.state?.bots ?? {}).filter(bot => sourceOf(bot) !== undefined)
  const hostOwned = bot => sourceOf(bot) !== undefined

  // Every state answer: `hostModels`, per host-owned Bot, its menu; no field at all while
  // there is none, so a team without such a plugin answers as before.
  function hostModelsView() {
    const bots = owned()
    if (bots.length === 0) return {}
    return {
      hostModels: Object.fromEntries(bots.map((bot) => {
        let menu
        try { menu = sourceOf(bot).snapshot(bot) } catch (error) { menu = { entries: [], error: error?.message } }
        return [bot.id, cleanMenu(menu)]
      })),
    }
  }

  // A menu about to open reads its source again; a slow source never holds the answer long.
  async function refreshHostModels() {
    await Promise.all(owned().map(async (bot) => {
      const source = sourceOf(bot)
      if (typeof source.refresh !== 'function') return
      let timer
      await Promise.race([
        Promise.resolve().then(() => source.refresh(bot)),
        new Promise((resolve) => { timer = setTimeout(resolve, REFRESH_MS) }),
      ]).catch(error => rt.warn?.('ds-bot: the model menu of %s was not read: %s', bot.name, error?.message ?? error))
      clearTimeout(timer)
    }))
  }

  // The person's pick for a host-owned Bot (roster.js routes update-bot here). Only the
  // person picks: a Bot's change never reaches a source.
  async function pickHostModel(bot, { id, effort, ack } = {}, actorId) {
    const source = sourceOf(bot)
    if (source === undefined) throw new Error('Unknown Bot')
    if (actorId !== undefined) throw new Error(`Only the user picks the model ${bot.name} answers with`)
    const pick = { ...some('id', text(id)), ...some('effort', text(effort)), ...(ack === true ? { ack: true } : {}) }
    if (pick.id === undefined && pick.effort === undefined) throw new Error('Pick a model or a thinking level')
    await source.pick(bot, pick)
  }

  Object.assign(rt, { hostOwned, hostModelsView, refreshHostModels, pickHostModel })
}
