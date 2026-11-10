import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { currentPart } from './text.js'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, SlidersIcon } from './icons.js'
import { BotMark } from './mark.js'
import { KeyIcon, MaskedInput } from './secret-card.js'
import { SPRING_POP, SPRING_SHAPE, spring, useLinger, useViewport, viewBottom } from './motion.js'
import { hostText, t } from './i18n.js'
import { HostModelMenu } from './host-model-menu.js'

const MENU_EXIT_MS = 120

// -------------------------------------------------------------------------
// A Bot's model: the picker in its details panel and settings, and the message its
// chat opens on while it has none. Models come from DeepSeek Harness, grouped by provider.

// A connection's name: the brand the host gives (`providerName`) and how it is connected
// (`via`): "OpenAI · API key", "Anthropic · API key"; an agent or DSH's own provider by its
// name alone ("Codex", "Claude Code", "DeepSeek"). "· sign-in" names a DSH sign-in route, shown
// only as a Bot's own model when its CLI covers it (`covered`).
export function connectionOf(model) {
  const provider = model?.providerName ?? model?.provider ?? String(model?.ref ?? '').split('/')[0]
  if (model?.via === 'key') return t('{provider} · API key', { provider })
  if (model?.via === 'signin') return t('{provider} · sign-in', { provider })
  return provider
}

// A model a Bot's chat can start on now: its provider has its key, its sign-in is stored or its
// agent signed in, and no CLI covers its route (the host's catalog marks).
const usableModel = model => !model.needsKey && !model.needsSignIn && !model.covered
// A model a Bot cannot run on: a key or a sign-in is missing, or its plan signs in only
// through its CLI (Claude Code, Codex).
export const unavailableModel = model => model?.needsKey === true || model?.needsSignIn === true || model?.covered === true

// The connection a model belongs to, as a key: its route.
const groupKey = model => model.provider ?? model.providerName ?? model.ref.split('/')[0]

export function groupModels(models) {
  const groups = new Map()
  for (const model of models ?? []) {
    const provider = groupKey(model)
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider).push(model)
  }
  const names = new Map()
  for (const list of groups.values()) {
    const name = connectionOf(list[0])
    names.set(name, (names.get(name) ?? 0) + 1)
  }
  return [...groups].map(([provider, list]) => {
    const name = connectionOf(list[0])
    return [names.get(name) > 1 ? `${name} (${provider})` : name, list]
  })
}

const servedOf = (roster, ref) => (roster.models ?? []).find(model => model.ref === ref)

// What a Bot runs on, for display: the chosen model, else the one it last ran on.
export function modelOf(bot, roster) {
  const ref = bot.model ?? bot.appliedModel
  if (!ref) return undefined
  const served = servedOf(roster, ref)
  const [provider, ...rest] = ref.split('/')
  return { ref, name: served ? modelLabel(served) : rest.join('/'), provider: served ? connectionOf(served) : provider, served: served !== undefined, unavailable: served === undefined || unavailableModel(served) }
}

// What a Bot's model really did, from the host's model state (model-state.js): a switch that
// failed and went back, a model that needs a sign-in, or a switch not answered yet. "Answered"
// is never claimed from a pick or a started request. Undefined when there is nothing to say.
export const SWITCH_FAILED = 'MODEL_SWITCH_COMPACTION_FAILED'
export const MODEL_ACCESS_REQUIRED = 'MODEL_ACCESS_REQUIRED'
const labelOf = (roster, ref) => (typeof ref === 'string' ? servedOf(roster, ref)?.name ?? (ref.split('/').slice(1).join('/') || ref) : t('the new model'))
export function modelStateLine(state, roster) {
  if (state === undefined || state === null) return undefined
  const failure = state.lastFailure
  if (failure?.kept) {
    const params = { model: labelOf(roster, failure.ref), kept: labelOf(roster, failure.kept) }
    if (failure.code === SWITCH_FAILED) return t('{model} could not take over this conversation. This Bot stays on {kept}.', params)
    if (failure.code === MODEL_ACCESS_REQUIRED) return t('{model} needs a sign-in before it can answer. This Bot stays on {kept}.', params)
    return t('{model} did not answer. This Bot stays on {kept}.', params)
  }
  if (failure?.code === MODEL_ACCESS_REQUIRED && failure.ref === state.selected) return t('{model} needs a sign-in before it can answer.', { model: labelOf(roster, failure.ref) })
  if (state.pending === true) return t('Switching to this model. It has not answered yet.')
  return undefined
}

// The line under a Bot's model in its settings. `state`: the host's model state for this Bot.
export function modelHint(bot, roster, state) {
  // A Bot whose model its plugin owns: the DSH model saved on it answers nothing. The hint
  // names what answers now, from the plugin's menu, or says nothing.
  const host = roster.hostModels?.[bot.id]
  if (host !== undefined) {
    const answering = host.entries?.find(entry => entry.answering)?.label
    return answering ? t('{model} answers now.', { model: answering }) : null
  }
  const shown = modelOf(bot, roster)
  if (shown === undefined) return t('Pick the model this Bot runs on.')
  if (!shown.served && (roster.models ?? []).length > 0) return t('This model is not available now. Pick another one.')
  const served = servedOf(roster, shown.ref)
  if (served?.needsSignIn) return t('{model} needs a sign-in before it can answer.', { model: served.name })
  // Signed in on this computer, to an account the person has not confirmed for Bots (#869).
  if (served?.needsAccount) return t('{model} waits for you to confirm its account.', { model: served.name })
  // A plan route whose Bots wait for its CLI (the host's subscription-move.js): the Bot still
  // answers on this model, and moves once the CLI can take it.
  const waiting = served?.covered ? roster.subscriptionWaiting?.[served.provider] : undefined
  if (waiting?.reason === 'sign-in') return t('This Bot stays on {model} until {cli} is signed in.', { model: served.name, cli: waiting.cli })
  if (waiting !== undefined) return t('This Bot stays on {model} until {cli} is ready.', { model: served.name, cli: waiting.cli })
  if (served?.needsKey || served?.covered) return t('This model is not available now. Pick another one.')
  const honest = modelStateLine(state, roster)
  if (honest !== undefined) return honest
  if (bot.appliedModel && bot.appliedModel === bot.model) return t('Every message of this Bot runs on it.')
  return t('Applies from the next message.')
}

// A Bot that waits for a model pick: none chosen, and no plugin answers for it.
export const needsModelPick = (bot, roster) => modelOf(bot, roster) === undefined && roster.hostModels?.[bot.id] === undefined

// The thinking levels of one model, `{efforts, defaultEffort?}`, or null when it has none.
// The catalog carries them for models Bots use; any other ref asks the host once, and the
// answer is kept (a failed ask is not).
const effortCache = new Map()
const effortAsks = new Map()
function askEfforts(ref, actions) {
  if (effortCache.has(ref)) return Promise.resolve(effortCache.get(ref))
  if (actions?.efforts === undefined) return Promise.resolve(null)
  if (!effortAsks.has(ref)) {
    effortAsks.set(ref, Promise.resolve().then(() => actions.efforts(ref)).then((value) => {
      const reasoning = value?.efforts ? value : null
      effortCache.set(ref, reasoning)
      return reasoning
    }, () => null).finally(() => effortAsks.delete(ref)))
  }
  return effortAsks.get(ref)
}
// A model's levels as known now: the catalog's, else a kept answer; undefined while unknown.
const knownEfforts = model => model?.reasoning ?? (effortCache.has(model?.ref) ? effortCache.get(model.ref) : undefined)

function useEfforts(served, ref, actions) {
  const [fetched, setFetched] = useState(undefined)
  useEffect(() => {
    setFetched(undefined)
    if (ref === undefined || served?.reasoning !== undefined || actions?.efforts === undefined) return undefined
    let live = true
    void askEfforts(ref, actions).then((reasoning) => { if (live) setFetched(reasoning) })
    return () => { live = false }
  }, [ref, served?.reasoning !== undefined, actions])
  return served?.reasoning ?? fetched
}

// The rows of a model's levels (the menu's third step): a Default row that clears the Bot's
// pick, then every level the model serves.
export function effortRows(reasoning) {
  if (reasoning?.efforts === undefined || reasoning.efforts.length === 0) return []
  return [
    { effort: undefined, label: t('Default') },
    ...reasoning.efforts.map(effort => ({ effort: effort.id, label: effort.name })),
  ]
}

// A model's name in the menu. An agent's own `default` row carries the agent's name ("Codex"
// under "Codex"): it reads "Default (6.1 Sol)" when the catalog says what that runs on
// (`resolvesTo`, models.js), else "Default".
export function modelLabel(model) {
  const name = model?.name
  const own = model?.id === 'default' || String(model?.ref ?? '').endsWith('/default')
  if (!own || name !== connectionOf(model)) return name
  return model.resolvesTo ? t('Default ({model})', { model: model.resolvesTo }) : t('Default')
}

// The menu offers what is set up: a model that cannot run (no key, no sign-in), one on a route
// a CLI covers (`covered`) and one a newer one of its family replaces
// (`superseded`, Claude's older versions) are left out, unless the Bot is on it. The Bot's own
// model always shows, even one no longer served, and says when it cannot run.
export function offeredModels(models, current) {
  const list = (models ?? []).filter(model => model.ref === current || (model.superseded !== true && usableModel(model)))
  if (typeof current !== 'string' || !current.includes('/') || list.some(model => model.ref === current)) return list
  const [provider, ...rest] = current.split('/')
  return [{ ref: current, provider, name: rest.join('/'), missing: true }, ...list]
}

const offModel = model => model.missing === true || unavailableModel(model)
const Tick = ({ on }) => h('span', { className: 'bt-model-tick', 'aria-hidden': true }, on ? h(CheckIcon) : null)

// The steps of the model menu, one at a time: `{step: 'connections'}`, then
// `{step: 'models', provider}` (one connection's models), then `{step: 'levels', provider, ref}`
// (one model's thinking levels).
export const MENU_ROOT = Object.freeze({ step: 'connections' })

// The rows a step shows (model-menu cascade). `current` is the Bot's model, `picked` its level
// when that model serves it, `levelName` that level's name for the current connection's line.
// `go(view)` opens another step; `onModel(model)` and `onLevel(model, effort)` pick.
export function ModelSteps({ roster, view, current, picked, levelName, go, onModel, onLevel, onManage }) {
  const groups = groupModels(offeredModels(roster.models, current))
  const group = view.step === 'connections' ? undefined : groups.find(([, list]) => groupKey(list[0]) === view.provider)
  const model = view.step === 'levels' ? group?.[1].find(entry => entry.ref === view.ref) : undefined
  const levels = model === undefined ? [] : effortRows(knownEfforts(model))
  if (model !== undefined && levels.length > 0) {
    const label = group[0]
    const on = model.ref === current
    return h('div', { key: `levels:${model.ref}`, className: 'bt-model-step', role: 'group', 'aria-label': t('Thinking level') },
      h('button', { type: 'button', role: 'menuitem', className: 'bt-model-back', 'aria-label': t('Back to {connection}', { connection: label }), onClick: () => go({ step: 'models', provider: view.provider }) },
        h(ChevronLeftIcon), h('span', { className: 'bt-menu-label' }, modelLabel(model))),
      h('div', { className: 'bt-model-group', role: 'presentation' }, t('Thinking level')),
      levels.map((row) => {
        const checked = on && (row.effort ?? null) === (picked ?? null)
        return h('button', { key: row.effort ?? 'default', type: 'button', role: 'menuitemradio', 'aria-checked': checked, onClick: () => onLevel(model, row.effort) },
          h('span', { className: 'bt-menu-label' }, row.label), h(Tick, { on: checked }))
      }))
  }
  if (group !== undefined) {
    const [label, list] = group
    return h('div', { key: `models:${view.provider}`, className: 'bt-model-step', role: 'group', 'aria-label': label },
      h('button', { type: 'button', role: 'menuitem', className: 'bt-model-back', 'aria-label': t('Back to connections'), onClick: () => go(MENU_ROOT) },
        h(ChevronLeftIcon), h('span', { className: 'bt-menu-label' }, label)),
      h('div', { className: 'bt-menu-sep', role: 'separator' }),
      list.map((entry) => {
        const off = offModel(entry)
        const name = modelLabel(entry)
        const more = !off && effortRows(knownEfforts(entry)).length > 0
        return h('button', {
          key: entry.ref, type: 'button', role: 'menuitemradio', 'aria-checked': entry.ref === current, title: entry.ref,
          'aria-haspopup': more ? 'menu' : undefined,
          'aria-label': off ? `${name} · ${t('Not available')}` : undefined,
          onClick: () => onModel(entry),
        },
        h('span', { className: 'bt-menu-label' }, name),
        off ? h('span', { className: 'bt-menu-hint' }, t('Not available'))
          : entry.ref === roster.defaultModel ? h('span', { className: 'bt-menu-hint' }, t('Default')) : null,
        h(Tick, { on: entry.ref === current }),
        more ? h(ChevronRightIcon) : null)
      }))
  }
  return h('div', { key: 'connections', className: 'bt-model-step', role: 'group', 'aria-label': t('Connections') },
    groups.length > 0 ? groups.map(([label, list]) => {
      const on = list.find(entry => entry.ref === current)
      const now = on === undefined ? undefined
        : offModel(on) ? `${modelLabel(on)} · ${t('Not available')}`
          : levelName === undefined ? modelLabel(on) : `${modelLabel(on)} · ${levelName}`
      return h('button', {
        key: groupKey(list[0]), type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'data-current': on ? '' : undefined,
        'aria-label': now === undefined ? undefined : t('{connection}, current model {model}', { connection: label, model: now }),
        onClick: () => go({ step: 'models', provider: groupKey(list[0]) }),
      },
      h('span', { className: 'bt-menu-label' }, label),
      now === undefined ? null : h('span', { className: 'bt-menu-hint' }, now),
      h(Tick, { on: on !== undefined }),
      h(ChevronRightIcon))
    }) : h('div', { className: 'bt-model-none' }, t('No models are set up in DeepSeek Harness yet.')),
    onManage ? h('div', { className: 'bt-menu-sep', role: 'separator' }) : null,
    onManage ? h('button', { type: 'button', role: 'menuitem', onClick: onManage }, h(SlidersIcon), h('span', { className: 'bt-menu-label' }, t('Models and providers…'))) : null)
}

// The rows a menu's keys move through, in order.
const menuRows = node => [...node.querySelectorAll('[role^="menuitem"]:not(:disabled)')]

export const Caret = () => h('svg', { className: 'bt-model-caret', width: 12, height: 12, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M5.5 8l4.5 4.5L14.5 8' }))

// A menu that opens under its trigger, or above when the window has no room below. A
// click outside, Escape, or a scroll outside it closes it. `onEscape` (a menu with steps)
// handles Escape first, and returns true when it went back a step instead.
export function useAnchoredMenu({ onEscape } = {}) {
  const [anchor, setAnchor] = useState(null)
  const [place, setPlace] = useState(null)
  const [shownPlace, leaving] = useLinger(place, MENU_EXIT_MS)
  const button = useRef(null)
  const menu = useRef(null)
  const tick = useViewport()
  const escape = useRef(onEscape)
  escape.current = onEscape
  const close = () => { setAnchor(null); setPlace(null) }
  useEffect(() => {
    if (place === null) return undefined
    const onDown = (event) => {
      if (menu.current?.contains(event.target) || button.current?.contains(event.target)) return
      close()
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (escape.current?.() === true) return
      close()
      button.current?.focus()
    }
    const onScroll = (event) => { if (!menu.current?.contains(event.target)) close() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [place])
  const open = () => setAnchor({})
  // Re-reads the trigger's rect whenever the visible viewport moves: the menu
  // tracks its anchor through the on-screen keyboard, not past it.
  useLayoutEffect(() => {
    if (anchor === null || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const width = Math.max(240, rect.width)
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const below = viewBottom() - rect.bottom
    setPlace(below >= 260 || below >= rect.top
      ? { left, width, top: rect.bottom + 4, maxHeight: below - 16, '--bt-origin': 'top right' }
      : { left, width, bottom: viewBottom() - rect.top + 4, maxHeight: rect.top - 16, '--bt-origin': 'bottom right' })
  }, [anchor, tick])
  return { isOpen: place !== null, shownPlace, leaving, button, menu, open, close }
}

// The trigger shows the model name over its connection and level. The menu goes in steps:
// the connections that are set up (the current one marked), then one connection's models,
// then a model's thinking levels when it has them; a model without levels applies at once.
// Arrow keys move through a step, Right opens the next, Left and Escape go back one.
// `onPick`/`onPickEffort` replace saving to the Bot, for a Bot that does not exist yet.
// `link`: the trigger is a small "change" link, as in the line under a Bot's greeting.
// A Bot whose model menu its plugin owns gets that menu instead (host-model-menu.js).
export function ModelMenu(props) {
  return h(props.roster?.hostModels?.[props.bot?.id] === undefined ? DshModelMenu : HostModelMenu, props)
}

function DshModelMenu({ bot, roster, actions, run, wide = false, link = false, chat = false, onPick, onPickEffort }) {
  const [view, setView] = useState(MENU_ROOT)
  // Levels that arrive for a step on screen draw it again.
  const [, setAsked] = useState(0)
  // Whether the next step takes the focus: the menu was opened or is used from the keyboard.
  const keys = useRef(false)
  const back = () => {
    if (view.step === 'connections') return false
    keys.current = true
    setView(view.step === 'levels' ? { step: 'models', provider: view.provider } : MENU_ROOT)
    return true
  }
  const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu({ onEscape: back })
  const live = useRef(false)
  live.current = isOpen
  const shown = modelOf(bot, roster)
  const current = bot.model ?? bot.appliedModel
  const served = servedOf(roster, current)
  const reasoning = useEfforts(served, current, actions)
  // The level the Bot runs on: its pick when the model serves it, else the model's own.
  const picked = reasoning?.efforts?.some(effort => effort.id === bot.effort) ? bot.effort : undefined
  const currentEffort = picked ?? reasoning?.defaultEffort
  const effortLabel = currentEffort === undefined
    ? (reasoning?.efforts?.length > 0 ? t('Default') : undefined)
    : reasoning.efforts.find(effort => effort.id === currentEffort)?.name ?? currentEffort
  // A connection's models whose levels the catalog does not carry are asked for as it opens,
  // so each row can say whether a level step follows.
  useEffect(() => {
    if (!isOpen || view.step !== 'models') return undefined
    let on = true
    const unknown = (roster.models ?? []).filter(model => groupKey(model) === view.provider && !offModel(model) && knownEfforts(model) === undefined)
    for (const model of unknown) void askEfforts(model.ref, actions).then(() => { if (on) setAsked(count => count + 1) })
    return () => { on = false }
  }, [isOpen, view, roster.models])
  // The step that opens takes the focus when the menu is used from the keyboard (or a row was
  // clicked): its current row, else its first.
  useEffect(() => {
    const node = menu.current
    if (!isOpen || !node || !keys.current) return
    keys.current = false
    const rows = menuRows(node)
    ;(rows.find(row => row.getAttribute('aria-checked') === 'true' || row.hasAttribute('data-current')) ?? rows[0])?.focus()
  }, [isOpen, view])
  const go = (next) => {
    keys.current = Boolean(menu.current?.contains(document.activeElement))
    setView(next)
  }
  const toggle = (event) => {
    if (isOpen) { close(); return }
    // A click with no pointer (Enter, Space) opens the menu with the focus in it.
    keys.current = event?.detail === 0
    setView(MENU_ROOT)
    // DSH settings can change the list at any time, so opening asks again.
    void actions?.refreshModels?.()
    open()
  }
  const finish = () => {
    const focused = Boolean(menu.current?.contains(document.activeElement))
    close()
    if (focused) button.current?.focus()
  }
  // Only the Bot's own saved model is the same one: with `onPick` the model shown stands in for
  // one the Bot does not have yet, so a level picked on it saves the model too.
  const same = ref => !onPick && ref === current && Boolean(bot.model)
  const pickModel = (ref) => {
    if (onPick) return onPick(ref)
    // In a Bot's chat a signed-out agent opens the sign-in row there (cli-login.js, rule 2).
    if (!same(ref)) return run(chat && actions.chooseModelInChat ? actions.chooseModelInChat(bot.id, ref) : actions.updateBot(bot.id, { model: ref }))
    return undefined
  }
  const pickEffort = (effort) => {
    if (onPickEffort) onPickEffort(effort)
    else if (effort !== bot.effort) void run(actions.updateBot(bot.id, { effort: effort ?? null }))
  }
  // A model with levels opens its level step; one without applies now. Levels not known yet
  // are asked for first.
  const onModel = (model) => {
    const decide = (levels) => {
      if (!live.current) return
      if (!offModel(model) && effortRows(levels).length > 0) go({ step: 'levels', provider: groupKey(model), ref: model.ref })
      else { finish(); void pickModel(model.ref) }
    }
    const known = offModel(model) ? null : knownEfforts(model)
    if (known !== undefined) decide(known)
    else void askEfforts(model.ref, actions).then(decide)
  }
  // A level of the current model changes the level only; on another model, the model and its
  // level go together (one update where the Bot is saved here).
  const onLevel = (model, effort) => {
    finish()
    if (same(model.ref)) { pickEffort(effort); return }
    if (onPick) {
      void Promise.resolve(onPick(model.ref)).then((done) => {
        if (done === false) return
        if (onPickEffort) onPickEffort(effort)
        else if (effort !== undefined || bot.effort) void run(actions.updateBot(bot.id, { effort: effort ?? null }))
      }, () => {})
      return
    }
    void run(chat && actions.chooseModelInChat
      ? actions.chooseModelInChat(bot.id, model.ref, { effort: effort ?? null })
      : actions.updateBot(bot.id, { model: model.ref, effort: effort ?? null }))
  }
  const onKeyDown = (event) => {
    const rows = menuRows(event.currentTarget)
    if (rows.length === 0) return
    const at = rows.indexOf(event.target)
    const to = event.key === 'ArrowDown' ? (at + 1) % rows.length
      : event.key === 'ArrowUp' ? (at <= 0 ? rows.length - 1 : at - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : undefined
    if (to !== undefined) { event.preventDefault(); rows[to].focus(); return }
    if (event.key === 'ArrowRight' && at >= 0 && rows[at].getAttribute('aria-haspopup') === 'menu') { event.preventDefault(); keys.current = true; rows[at].click(); return }
    if (event.key === 'ArrowLeft' && back()) event.preventDefault()
  }
  const models = roster.models ?? []
  const manage = manageModels(actions)
  return h(Fragment, null,
    link ? h('button', {
      ref: button, type: 'button', className: 'bt-model-change', 'aria-haspopup': 'menu', 'aria-expanded': isOpen,
      'aria-label': t('Change the model of {name}', { name: bot.name }), onClick: toggle,
    }, t('change')) : h('button', {
      ref: button, type: 'button', className: 'bt-model-trigger', 'data-wide': wide || undefined,
      'aria-haspopup': 'menu', 'aria-expanded': isOpen, 'aria-label': t('Model: {model}', { model: shown?.name ?? t('none') }),
      'data-missing': shown !== undefined && shown.unavailable && models.length > 0 ? '' : undefined, onClick: toggle,
    },
    h('span', { className: 'bt-model-copy' },
      h('span', { className: 'bt-model-name' }, shown?.name ?? t('Choose a model')),
      shown ? h('span', { className: 'bt-model-provider' }, !shown.unavailable || models.length === 0
        ? (effortLabel === undefined ? shown.provider : `${shown.provider} · ${effortLabel}`)
        : t('{provider} · not available', { provider: shown.provider })) : null),
    h(Caret)),
    shownPlace ? createPortal(h('div', { ref: menu, className: `bt-menu bt-model-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`, role: 'menu', 'aria-label': t('Model for {name}', { name: bot.name }), style: shownPlace, 'data-leaving': leaving || undefined, onKeyDown },
      h(ModelSteps, {
        roster, view, current, picked, levelName: effortLabel, go, onModel, onLevel,
        onManage: manage ? () => { finish(); manage() } : undefined,
      })), document.body) : null)
}

// True while a chat holds only the Bot's greeting: its one turn is the one the team started
// (the held kickoff, delivery.js), which DSH's turn outline lists with no prompt of the
// user's, and no one has written in it yet.
const KICKOFF = /^\[Bot team setup\]/
export const greetingOnly = outline => Array.isArray(outline) && outline.length === 1 && (!outline[0]?.prompt || KICKOFF.test(outline[0].prompt))

// What a model is called in a line: its name, and its provider's.
function modelWords(roster, ref) {
  const served = servedOf(roster, ref)
  const [provider, ...rest] = String(ref ?? '').split('/')
  return { model: served ? modelLabel(served) : rest.join('/'), provider: served ? connectionOf(served) : provider }
}

// One line naming the model a Bot runs on and its provider, with "change" opening the
// model menu (which also leads to the providers): "Using Claude Opus 5.5 · Anthropic ·
// change". `modelRef` and `onPick` stand in for a model the Bot does not have yet (not
// `ref`: React keeps that prop for itself, issue #153).
export function ModelLine({ bot, roster, actions, run, modelRef, onPick, chat = false }) {
  const words = modelWords(roster, modelRef ?? bot.model ?? bot.appliedModel)
  return h('div', { className: 'bt-model-line' },
    h('span', { className: 'bt-model-line-text' }, t('Using {model} · {provider}', words)),
    h('span', { className: 'bt-model-line-sep', 'aria-hidden': true }, '·'),
    h(ModelMenu, { bot: modelRef ? { ...bot, model: modelRef } : bot, roster, actions, run, link: true, chat, onPick }))
}

const outlineOf = (list, sessionId) => list.projectionsBySession?.[sessionId]?.values?.turnOutline ?? list.byId?.[sessionId]?.projectionValues?.turnOutline

// Under the Bot's greeting, on its turn's tail, while the chat holds only that greeting:
// the line naming the model the Bot runs on. It goes once anyone writes.
export function ModelLineTail({ turn, sessionId, useRoster, useSessions, actions }) {
  const roster = useRoster(value => value)
  const first = useSessions(list => (greetingOnly(outlineOf(list, sessionId)) ? outlineOf(list, sessionId)[0].turn : null))
  const [error, setError] = useState('')
  const bot = roster.byId[sessionId]
  if (!bot || currentPart(bot) !== sessionId || first === null || first !== turn?.turn) return null
  if (roster.hostModels?.[bot.id] !== undefined) return null
  if (!bot.model || !(roster.models ?? []).some(model => model.ref === bot.model)) return null
  const run = promise => Promise.resolve(promise).then(() => { setError(''); return true }, (failure) => { setError(failure?.message ?? String(failure)); return false })
  return h('div', { className: 'bt-model-tail' },
    h(ModelLine, { bot, roster, actions, run, chat: true }),
    error ? h('div', { className: 'bt-secret-error', role: 'alert' }, error) : null)
}

// The card a Bot's chat opens on while the Bot has no model, or has one that is no
// longer served. A Bot made without a model holds its greeting until it has one: the
// welcome (@automagik/welcome-dsh) gives the companion and the Omni Bot one once Connect AI
// succeeds, and here one press starts it on the model it would get.
export function ModelChoiceDock({ sessionId, useRoster, actions }) {
  const roster = useRoster(value => value)
  const bot = roster.byId[sessionId]
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  // A Bot whose model its plugin picks never waits for a DSH model.
  const hosted = roster.hostModels?.[bot?.id] !== undefined
  const shown = Boolean(bot) && currentPart(bot) === sessionId && roster.ready && !hosted
  useEffect(() => { if (shown) void actions.refreshModels?.() }, [shown, sessionId])
  if (!shown) return null
  const models = roster.models ?? []
  // A model whose provider has no API key or sign-in fails every turn, so it is no choice;
  // nor is one another connection already offers.
  const usable = models.filter(usableModel)
  const lost = bot.model ? !models.some(model => model.ref === bot.model) : false
  const run = promise => Promise.resolve(promise).then(() => { setError(''); return true }, (failure) => { setError(failure?.message ?? String(failure)); return false })
  // An unknown catalog (none listed) cannot tell a lost model from a slow provider.
  if (bot.model && (!lost || models.length === 0)) return null
  // A window without DSH's own settings takes the missing key here.
  const keyFor = usable.length === 0 && actions.setProviderKey ? models.find(model => model.needsKey) : undefined
  const manage = manageModels(actions)
  // Settles true once the model is saved, so a level picked with it follows (ModelMenu).
  const pick = (ref) => {
    setBusy(ref)
    setError('')
    return Promise.resolve(actions.chooseModelInChat ? actions.chooseModelInChat(bot.id, ref) : actions.updateBot(bot.id, { model: ref }))
      .then(() => true, (failure) => { setError(failure?.message ?? String(failure)); void actions.refreshModels?.(); return false })
      .finally(() => setBusy(''))
  }
  // Models that can run and none chosen yet: no grid of choices. The Bot offers the model
  // it would get (DSH's default when it can run, else the first that can), one press
  // starts it, and "change" picks another.
  if (!lost && usable.length > 0) {
    const suggested = usable.find(model => model.ref === roster.defaultModel)?.ref ?? (usable.find(model => model.id !== 'default' && model.superseded !== true) ?? usable.find(model => model.id !== 'default') ?? usable[0]).ref
    return h('div', { className: 'bt-model-dock' },
      h('div', { className: 'bt-astack', 'data-lead': '' },
        h('div', { className: 'bt-msg' },
          h('div', { className: 'bt-msg-line' },
            h(BotMark, { bot, size: 22 }),
            h('div', { className: 'bt-bubble' }, t("Hi, I'm {name}. Say when, and I'll start.", { name: bot.name }))))),
      h('div', { className: 'bt-model-offer' },
        h('button', {
          type: 'button', className: 'bt-model-chip bt-model-start', disabled: busy !== '', 'aria-busy': busy === suggested || undefined,
          onClick: () => pick(suggested),
        }, t('Start'), busy === suggested ? h('span', { className: 'bt-model-spin', 'aria-label': t('Saving…') }) : null),
        h(ModelLine, { bot, roster, actions, run, modelRef: suggested, onPick: pick })),
      error ? h('div', { className: 'bt-secret-error bt-model-error', role: 'alert' }, error) : null)
  }
  // The recovery cases: the model went away, a key is missing, or nothing is set up. The
  // pick reads as the Bot's own first message, with the choices as replies under it.
  const text = lost
    ? t('{model} is not available anymore. Pick another model for me.', { model: bot.model.split('/').slice(1).join('/') })
    : keyFor
      ? t("Hi, I'm {name}. I need a {provider} API key before I can start.", { name: bot.name, provider: keyFor.providerName ?? keyFor.provider })
      : t("Hi, I'm {name}. I don't have a model yet. How do you want to set one up?", { name: bot.name })
  const choices = usable.length === 0
    ? setupChoices(actions).map(([label, run]) => h('button', { key: label, type: 'button', className: 'bt-model-chip', onClick: run }, label))
    : [
        ...groupModels(usable).map(([provider, list]) => h('div', { key: list[0].provider ?? provider, className: 'bt-model-choice-group', role: 'group', 'aria-label': provider },
          h('div', { className: 'bt-model-choice-provider', 'aria-hidden': true }, provider),
          h('div', { className: 'bt-model-choice-chips' }, list.map(model => h('button', {
            key: model.ref, type: 'button', className: 'bt-model-chip', disabled: busy !== '', 'aria-busy': busy === model.ref || undefined,
            'aria-label': `${modelLabel(model)} · ${provider}`,
            title: model.ref === roster.defaultModel ? `${model.ref} · ${t('Harness default')}` : model.ref,
            onClick: () => pick(model.ref),
          }, modelLabel(model), busy === model.ref ? h('span', { className: 'bt-model-spin', 'aria-label': t('Saving…') }) : null))))),
        manage ? h('button', { key: 'manage', type: 'button', className: 'bt-model-chip bt-model-chip-quiet', onClick: manage }, h(SlidersIcon), t('Manage models')) : null,
      ]
  return h('div', { className: 'bt-model-dock' },
    h('div', { className: 'bt-astack', 'data-lead': '' },
      h('div', { className: 'bt-msg' },
        h('div', { className: 'bt-msg-line' },
          h(BotMark, { bot, size: 22 }),
          h('div', { className: 'bt-bubble' }, text)))),
    keyFor
      ? h(ModelKeyCard, { key: keyFor.provider, model: keyFor, actions })
      : h('div', { className: 'bt-model-chips', role: 'group', 'aria-label': t('Choose a model') }, choices),
    error ? h('div', { className: 'bt-secret-error bt-model-error', role: 'alert' }, error) : null)
}

// The provider's API key, saved through the host; once it is set, the provider's
// models become the choices.
function ModelKeyCard({ model, actions }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = t('{provider} API key', { provider: model.providerName ?? model.provider })
  const ready = value.trim() !== '' && !busy
  const save = () => {
    if (!ready) return
    setBusy(true)
    setError('')
    void Promise.resolve(actions.setProviderKey(model.provider, value))
      .then(() => setValue(''), failure => setError(hostText(failure?.message ?? String(failure))))
      .finally(() => setBusy(false))
  }
  return h('div', { className: 'bt-q bt-model-key', role: 'group', 'aria-label': label },
    h('div', { className: 'bt-model-key-title' }, h(KeyIcon), label),
    h('label', { className: 'bt-q-field bt-secret-field' }, h(MaskedInput, { value, onChange: setValue, onEnter: save, label, autoFocus: true })),
    error ? h('div', { className: 'bt-secret-error', role: 'alert' }, error) : null,
    h('div', { className: 'bt-q-foot' },
      actions.openModels ? h('button', { type: 'button', className: 'bt-q-btn bt-model-key-other', onClick: actions.openModels }, t('Another provider')) : null,
      h('button', { type: 'button', className: 'bt-q-submit', disabled: !ready, onClick: save }, busy ? t('Saving…') : t('Save'))))
}

// Where the providers are set up: the window's own Models page, else DSH's settings.
const manageModels = actions => actions.openModels ?? actions.openHarnessSettings

// Ways to get a first model. Connect an AI is the welcome plugin's step (@automagik/welcome-dsh:
// a subscription sign-in, an API key or a gateway); the DeepSeek sign-in exists only where
// the shell carries its account plugin (the Desktop); the API key and custom models use the
// shell's own editors.
function setupChoices(actions) {
  return [
    actions.openHarnessOnboarding ? [t('Connect an AI: ChatGPT, Claude, Kimi or an API key'), () => actions.openHarnessOnboarding('omni-connect-ai')] : null,
    actions.canSignIn?.() ? [t('Sign in to DeepSeek'), () => actions.signIn()] : null,
    actions.openHarnessOnboarding ? [t('Enter a DeepSeek API key'), () => actions.openHarnessOnboarding('deepseek-official')] : null,
    actions.openHarnessSettings ? [t('Open settings to set up a custom model'), actions.openHarnessSettings] : null,
  ].filter(Boolean)
}

// The shell's own DeepSeek sign-in dialog, borrowed from its account plugin: the
// plugin's model sign-in entry renders here with the plugin's own operations.
export function DeepSeekSignIn({ useUi, actions }) {
  const open = useUi(state => state.signIn)
  const entry = open ? actions.signInEntry?.() : null
  if (!entry) return null
  return h(SignInHost, { key: open, entry, actions })
}

function SignInHost({ entry, actions }) {
  const [ops] = useState(() => entry.inject?.() ?? {})
  const close = () => actions.closeSignIn()
  const useHook = source => selector => useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  const [hooks] = useState(() => ({ useAccount: useHook(ops.hooks.account), useTheme: useHook(ops.hooks.theme) }))
  return h(entry.component, {
    ...ops,
    ...hooks,
    t: actions.accountT(),
    complete: close,
    useApiKey: () => { close(); actions.openHarnessOnboarding('deepseek-official') },
  })
}

export const MODEL_CSS = `
.bt-model-trigger{display:inline-flex;align-items:center;gap:8px;max-width:100%;min-width:0;height:auto;min-height:32px;padding:4px 8px 4px 10px;border:0;border-radius:8px;background:var(--bt-hover);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:background-color .12s ease}
.bt-model-trigger:hover,.bt-model-trigger[aria-expanded=true]{background:var(--bt-active)}
.bt-model-trigger:focus-visible{outline:2px solid var(--bt-accent);outline-offset:1px}
.bt-model-trigger[data-missing] .bt-model-provider{color:var(--bt-danger)}
.bt-model-trigger[data-wide]{display:flex;width:100%;min-height:48px;padding:7px 12px;justify-content:space-between;border-radius:12px;background:var(--bt-card);box-shadow:inset 0 0 0 1px var(--bt-line)}
.bt-model-trigger[data-wide]:hover,.bt-model-trigger[data-wide][aria-expanded=true]{background:var(--bt-hover)}
.bt-model-copy{display:flex;flex-direction:column;min-width:0}
.bt-model-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-model-provider{font-size:11px;line-height:14px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-model-caret{flex:none;color:var(--bt-ink-3);transition:${spring(SPRING_SHAPE, 'transform')}}
.bt-model-trigger[aria-expanded=true] .bt-model-caret{transform:rotate(180deg)}
.bt-model-menu{overflow-y:auto;scrollbar-width:thin}
.bt-model-group{flex:none;padding:8px 8px 2px;font-size:11px;line-height:14px;font-weight:500;color:var(--bt-ink-3);text-transform:none}
.bt-model-group:first-child{padding-top:2px}
.bt-model-tick{flex:none;width:16px;height:16px;display:inline-flex;color:var(--bt-ink-2)}
.bt-model-tick svg{animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} 60ms backwards}
.bt-model-none{padding:8px;font-size:13px;line-height:18px;color:var(--bt-ink-2)}
.bt-model-step{display:flex;flex-direction:column;gap:2px;min-width:0;animation:bt-veil-in .14s ease-out}
.bt-model-menu .bt-model-step .bt-menu-hint{min-width:0;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-model-menu .bt-model-step > button > svg:last-child:not(:first-child){color:var(--bt-ink-3)}
.bt-menu .bt-model-back{color:var(--bt-ink-2);font-weight:500}
.bt-model-menu .bt-model-step button:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-host-model-copy{display:flex;flex-direction:column;flex:1;min-width:0}
.bt-host-model-detail{font-size:11px;line-height:14px;color:var(--bt-ink-3);white-space:normal}
.bt-host-model-status{padding:2px 8px 6px;font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.bt-host-model-confirm{flex:none;color:var(--bt-accent);font-size:12px;font-weight:600}
.bt-model-dock{width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:0 0 10px;box-sizing:border-box;animation:bt-model-in ${SPRING_POP.duration}ms ${SPRING_POP.easing} backwards}
.bt-model-chips{display:flex;flex-wrap:wrap;gap:6px;margin-left:30px;max-width:min(560px,calc(100% - 30px));max-height:min(240px,36vh);max-height:min(240px,36dvh);overflow-y:auto;scrollbar-width:thin}
.bt-model-choice-group{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0}
.bt-model-choice-provider{padding-top:4px;font-size:12px;line-height:16px;font-weight:500;color:var(--bt-ink-2);overflow-wrap:anywhere}
.bt-model-choice-chips{display:flex;flex-wrap:wrap;gap:6px}
.bt-model-chip{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:5px 12px;border:.5px solid var(--bt-line-2);border-radius:999px;background:var(--bt-surface,transparent);color:var(--bt-ink);font:inherit;font-size:13px;line-height:18px;cursor:pointer;transition:background-color .12s ease,border-color .12s ease}
.bt-model-chip:hover:not(:disabled){background:var(--bt-hover)}
.bt-model-chip:focus-visible{outline:2px solid var(--bt-accent);outline-offset:1px}
.bt-model-chip-quiet{color:var(--bt-ink-2)}
.bt-model-chip svg{width:14px;height:14px}
.bt-model-chip:disabled{cursor:default}
.bt-model-chip:disabled:not([aria-busy]){opacity:.5}
.bt-model-error{margin-left:30px}
.bt-model-tail{margin:2px 0 6px 6px}
.bt-model-line{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 6px;font-size:12px;line-height:18px;color:var(--bt-ink-2)}
.bt-model-line-text{min-width:0;overflow-wrap:anywhere}
.bt-model-line-sep{color:var(--bt-ink-3)}
.bt-model-change{padding:0;border:0;background:none;color:var(--bt-accent);font:inherit;font-weight:600;cursor:pointer}
.bt-model-change:hover,.bt-model-change[aria-expanded=true]{text-decoration:underline;text-underline-offset:3px}
.bt-model-change:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px;border-radius:4px}
.bt-model-offer{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;margin-left:30px}
.bt-model-offer .bt-model-line{margin-left:0}
.bt-q.bt-model-key{margin:0 0 0 30px;width:min(480px,calc(100% - 30px));gap:10px}
.bt-model-key-title{display:flex;align-items:center;gap:6px;font-size:13px;line-height:18px;font-weight:500;color:var(--bt-ink-2)}
.bt-model-key-title svg{flex:none;width:16px;height:16px}
.bt-model-key .bt-q-foot{margin-top:2px}
.bt-model-key-other{margin-right:auto}
@keyframes bt-model-in{from{opacity:0;transform:translateY(6px)}}
.bt-model-spin{flex:none;width:14px;height:14px;border-radius:50%;border:1.5px solid var(--bt-line-2);border-top-color:var(--bt-ink-2);animation:bt-model-spin .7s linear infinite}
@keyframes bt-model-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.bt-model-dock{animation:none}.bt-model-step{animation:none}.bt-model-spin{animation-duration:2s}.bt-model-caret{transition:none}.bt-model-tick svg{animation:none}}
`
