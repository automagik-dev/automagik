import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { currentPart } from './text.js'
import { CheckIcon, SlidersIcon } from './icons.js'
import { BotMark } from './mark.js'
import { KeyIcon, MaskedInput } from './secret-card.js'
import { SPRING_POP, SPRING_SHAPE, spring, useLinger, useViewport, viewBottom } from './motion.js'
import { hostText, t } from './i18n.js'
import { HostModelMenu } from './host-model-menu.js'
import { chooseAccessibleModel, modelCompanies } from './model-companies.js'

const MENU_EXIT_MS = 120
// DSH stores only its declared registration options. Extension metadata travels
// on the component, which the slot registry preserves unchanged.
const accountDescriptor = entry => entry.component?.accounts ?? entry.options ?? {}

// -------------------------------------------------------------------------
// A Bot's model: the picker in its details panel and settings, and the message its
// chat opens on while it has none. Models come from DeepSeek Harness, grouped by provider.

export function groupModels(models) {
  const groups = new Map()
  for (const model of models ?? []) {
    const provider = model.provider ?? model.providerName ?? model.ref.split('/')[0]
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider).push(model)
  }
  const names = new Map()
  for (const [provider, list] of groups) {
    const name = list[0].providerName ?? provider
    names.set(name, (names.get(name) ?? 0) + 1)
  }
  return [...groups].map(([provider, list]) => {
    const name = list[0].providerName ?? provider
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
  return { ref, name: served?.name ?? rest.join('/'), provider: served?.providerName ?? provider, served: served !== undefined }
}

// The line under a Bot's model in its settings.
export function modelHint(bot, roster) {
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
  if (bot.appliedModel && bot.appliedModel === bot.model) return t('Every message of this Bot runs on it.')
  return t('Applies from the next message.')
}

// A Bot that waits for a model pick: none chosen, and no plugin answers for it.
export const needsModelPick = (bot, roster) => modelOf(bot, roster) === undefined && roster.hostModels?.[bot.id] === undefined

// The thinking levels of one model, `{efforts, defaultEffort?}` or undefined when it
// has none. The catalog carries them for models Bots use; any other ref asks the host.
const effortCache = new Map()
function useEfforts(served, ref, actions) {
  const [fetched, setFetched] = useState(undefined)
  useEffect(() => {
    setFetched(undefined)
    if (ref === undefined || served?.reasoning !== undefined || actions?.efforts === undefined) return undefined
    let live = true
    if (effortCache.has(ref)) setFetched(effortCache.get(ref))
    else void Promise.resolve(actions.efforts(ref)).then((value) => {
      const reasoning = value?.efforts ? value : null
      effortCache.set(ref, reasoning)
      if (live) setFetched(reasoning)
    }).catch(() => {})
    return () => { live = false }
  }, [ref, served?.reasoning !== undefined, actions])
  return served?.reasoning ?? fetched
}

// The rows of the Thinking section: a Default row that clears the Bot's pick, then every
// level the model serves.
export function effortRows(reasoning) {
  if (reasoning?.efforts === undefined || reasoning.efforts.length === 0) return []
  return [
    { effort: undefined, label: t('Default') },
    ...reasoning.efforts.map(effort => ({ effort: effort.id, label: effort.name })),
  ]
}

function EffortRows({ reasoning, current, onPick }) {
  return h(Fragment, null,
    h('div', { className: 'bt-menu-sep', role: 'separator' }),
    h('div', { className: 'bt-model-group', role: 'presentation' }, t('Thinking level')),
    effortRows(reasoning).map(row => h('button', {
      key: row.effort ?? 'default', type: 'button', role: 'menuitemradio', 'aria-checked': (row.effort ?? null) === (current ?? null),
      onClick: () => onPick(row.effort),
    },
    h('span', { className: 'bt-menu-label' }, row.label),
    h('span', { className: 'bt-model-tick', 'aria-hidden': true }, (row.effort ?? null) === (current ?? null) ? h(CheckIcon) : null))))
}

// A model a newer one of its family replaces (`superseded`, Claude's older versions) is left
// out of the menu, unless the Bot is on it.
export const offeredModels = (models, current) => (models ?? []).filter(model => model.superseded !== true || model.ref === current)

function ModelRows({ roster, current, onPick, disabled = false }) {
  return groupModels(offeredModels(roster.models, current)).map(([provider, list]) => h(Fragment, { key: list[0].provider ?? provider },
    h('div', { className: 'bt-model-group', role: 'presentation' }, provider),
    list.map(model => h('button', {
      key: model.ref, type: 'button', role: 'menuitemradio', 'aria-checked': model.ref === current, title: model.ref,
      onClick: () => onPick(model.ref), disabled,
    },
    h('span', { className: 'bt-menu-label' }, model.name),
    model.ref === roster.defaultModel ? h('span', { className: 'bt-menu-hint' }, t('Default')) : null,
    h('span', { className: 'bt-model-tick', 'aria-hidden': true }, model.ref === current ? h(CheckIcon) : null)))))
}

export const Caret = () => h('svg', { className: 'bt-model-caret', width: 12, height: 12, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M5.5 8l4.5 4.5L14.5 8' }))

// A menu that opens under its trigger, or above when the window has no room below. A
// click outside, Escape, or a scroll outside it closes it.
export function useAnchoredMenu(minWidth = 240) {
  const [anchor, setAnchor] = useState(null)
  const [place, setPlace] = useState(null)
  const [shownPlace, leaving] = useLinger(place, MENU_EXIT_MS)
  const button = useRef(null)
  const menu = useRef(null)
  const tick = useViewport()
  const close = () => { setAnchor(null); setPlace(null) }
  useEffect(() => {
    if (place === null) return undefined
    const onDown = (event) => {
      if (menu.current?.contains(event.target) || button.current?.contains(event.target)) return
      close()
    }
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); button.current?.focus() } }
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
    const width = Math.min(Math.max(minWidth, rect.width), window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const below = viewBottom() - rect.bottom
    setPlace(below >= 260 || below >= rect.top
      ? { left, width, top: rect.bottom + 4, maxHeight: below - 16, '--bt-origin': 'top right' }
      : { left, width, bottom: viewBottom() - rect.top + 4, maxHeight: rect.top - 16, '--bt-origin': 'bottom right' })
  }, [anchor, tick, minWidth])
  return { isOpen: place !== null, shownPlace, leaving, button, menu, open, close }
}

// The trigger shows the model name over its provider. A Thinking section lists the
// levels of the shown model when it has them.
// `onPick`/`onPickEffort` replace saving to the Bot, for a Bot that does not exist yet.
// `link`: the trigger is a small "change" link, as in the line under a Bot's greeting.
// A Bot whose model menu its plugin owns gets that menu instead (host-model-menu.js).
export function ModelMenu(props) {
  return h(props.roster?.hostModels?.[props.bot?.id] === undefined ? DshModelMenu : HostModelMenu, props)
}

// Configured/custom providers without a Welcome account use the exact credential
// reference advertised by DSH. This form never passes through the chat composer.
function ProviderKeySetup({ provider, actions, onConnected, onClose }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const save = async event => {
    event?.preventDefault()
    if (busy || !value.trim()) return
    setBusy(true)
    setProblem('')
    try {
      await actions.setProviderKey(provider, value)
      setValue('')
      await onConnected()
    } catch {
      setProblem(t('Could not save the key. Try again.'))
    } finally { setBusy(false) }
  }
  return h('form', { className: 'bt-model-key-form', onSubmit: save },
    h(MaskedInput, { value, onChange: setValue, onEnter: () => save(), label: t('API key'), autoFocus: true }),
    h('p', null, t('The key is saved securely and is not sent as a chat message.')),
    problem ? h('p', { role: 'alert', className: 'bt-model-error' }, problem) : null,
    h('button', { type: 'submit', disabled: busy || !value.trim() }, busy ? t('Saving…') : t('Save key')),
    h('button', { type: 'button', disabled: busy, onClick: onClose }, t('Back to models')))
}

function DshModelMenu({ bot, roster, actions, wide = false, link = false, onPick, onPickEffort, disabled = false }) {
  const { isOpen, shownPlace, leaving, button, menu, open, close } = useAnchoredMenu(360)
  const [accounts, setAccounts] = useState([])
  const [company, setCompany] = useState('')
  const [provider, setProvider] = useState('')
  const [setup, setSetup] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const changing = useRef(false)
  const live = useRef(true)
  useLayoutEffect(() => { if (isOpen) menu.current?.querySelector('select')?.focus() }, [isOpen])
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => actions?.subscribeModelAccounts?.(() => setRevision(value => value + 1)), [actions])
  useEffect(() => {
    if (!isOpen) return undefined
    let mounted = true
    const entries = actions?.modelAccountEntries?.() ?? []
    const sources = [Promise.resolve().then(() => actions?.modelProviders?.()).then(value => [
      ...(value?.providers ?? []).map(row => ({ ...row, provider: row.id })),
      ...(value?.addable ?? []).map(row => ({ ...row, provider: row.id })),
    ]), ...entries.map(entry => Promise.resolve().then(() => accountDescriptor(entry).providers?.() ?? []))]
    void Promise.allSettled(sources).then(results => {
      if (mounted) setAccounts(results.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []))
    })
    return () => { mounted = false }
  }, [isOpen, actions, revision])
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
  const toggle = () => {
    if (isOpen) { close(); return }
    // DSH settings can change the list at any time, so opening asks again.
    void actions?.refreshModels?.()
    setProblem('')
    setSetup('')
    setCompany('')
    setProvider('')
    open()
  }
  const change = async (select) => {
    if (changing.current || disabled) return
    changing.current = true
    setBusy(true)
    setProblem('')
    try {
      await select()
      if (live.current) close()
    } catch (error) {
      if (live.current) setProblem(`${hostText(error?.message ?? 'Could not change the model.')}${error?.code === 'bot/model-access' ? ` ${t('Your previous model is unchanged.')}` : ''}`)
    } finally {
      changing.current = false
      if (live.current) setBusy(false)
    }
  }
  const pick = ref => {
    if (ref === current && bot.model) { close(); return }
    return change(() => chooseAccessibleModel({ ref, actions,
      select: value => onPick ? onPick(value) : actions.updateBot(bot.id, { model: value }),
    }))
  }
  const pickEffort = effort => change(() => onPickEffort ? onPickEffort(effort)
    : effort !== bot.effort ? actions.updateBot(bot.id, { effort: effort ?? null }) : undefined)
  const models = roster.models ?? []
  const companies = modelCompanies(offeredModels(models, current), accounts)
  const currentProvider = current?.split('/')[0]
  const activeCompany = companies.find(row => row.name === company)
    ?? companies.find(row => row.providers.some(item => item.provider === currentProvider)) ?? companies[0]
  const activeProvider = activeCompany?.providers.find(row => row.provider === provider)
    ?? activeCompany?.providers.find(row => row.provider === currentProvider) ?? activeCompany?.providers[0]
  const accountEntry = (actions?.modelAccountEntries?.() ?? []).find(entry => accountDescriptor(entry).matches?.(setup || activeProvider?.provider))
  const keySetup = activeProvider?.key?.writable === true && typeof actions?.setProviderKey === 'function'
  const connected = async () => {
    await actions?.refreshModels?.()
    if (!live.current) return
    setRevision(value => value + 1)
    setSetup('')
    setProblem('')
  }
  const manage = manageModels(actions)
  return h(Fragment, null,
    link ? h('button', {
      ref: button, type: 'button', className: 'bt-model-change', 'aria-haspopup': 'dialog', 'aria-expanded': isOpen, disabled,
      'aria-label': t('Change the model of {name}', { name: bot.name }), onClick: toggle,
    }, t('change')) : h('button', {
      ref: button, type: 'button', className: 'bt-model-trigger', 'data-wide': wide || undefined,
      'aria-haspopup': 'dialog', 'aria-expanded': isOpen, 'aria-label': t('Model: {model}', { model: shown?.name ?? t('none') }), disabled,
      'data-missing': shown !== undefined && !shown.served && models.length > 0 ? '' : undefined, onClick: toggle,
    },
    h('span', { className: 'bt-model-copy' },
      h('span', { className: 'bt-model-name' }, shown?.name ?? t('Choose a model')),
      shown ? h('span', { className: 'bt-model-provider' }, shown.served || models.length === 0
        ? (effortLabel === undefined ? shown.provider : `${shown.provider} · ${effortLabel}`)
        : t('{provider} · not available', { provider: shown.provider })) : null),
    h(Caret)),
    shownPlace ? createPortal(h('div', { ref: menu, className: `bt-menu bt-model-menu bt-model-account-menu${shownPlace.bottom !== undefined ? ' bt-menu-up' : ''}`, role: 'dialog', 'aria-label': t('Model for {name}', { name: bot.name }), 'aria-busy': busy, style: shownPlace, 'data-leaving': leaving || undefined },
      h('label', { className: 'bt-model-field' }, t('Company'), h('select', { 'aria-label': t('Company'), value: activeCompany?.name ?? '', disabled: busy, onChange: event => { setCompany(event.target.value); setProvider(''); setSetup(''); setProblem('') } },
        companies.map(row => h('option', { key: row.name, value: row.name }, row.name)))),
      activeCompany?.providers.length > 1 ? h('label', { className: 'bt-model-field' }, t('Connection'), h('select', { 'aria-label': t('Connection'), value: activeProvider?.provider ?? '', disabled: busy, onChange: event => { setProvider(event.target.value); setSetup(''); setProblem('') } },
        activeCompany.providers.map(row => h('option', { key: row.provider, value: row.provider },
          activeCompany.providers.filter(other => other.name === row.name).length > 1 ? `${row.name ?? row.provider} (${row.provider})` : row.name ?? row.provider)))) : null,
      problem ? h('div', { className: 'bt-model-error', role: 'alert' }, problem) : null,
      busy ? h('div', { className: 'bt-model-none', role: 'status' }, t('Checking access…')) : null,
      setup && (accountEntry || keySetup) ? h('div', { className: 'bt-model-account-setup' }, h(accountEntry?.component ?? ProviderKeySetup, { provider: setup, actions, onConnected: connected, onClose: () => setSetup('') }))
        : h(Fragment, null,
          (accountEntry || keySetup) && activeProvider ? h('button', { type: 'button', disabled: busy, onClick: () => setSetup(activeProvider.provider) }, h(KeyIcon), accountEntry ? t('Save key or sign in') : t('Save key')) : null,
          activeProvider?.models.length > 0 ? h('div', { role: 'menu', 'aria-label': t('Models') }, h(ModelRows, { roster: { ...roster, models: activeProvider.models }, current, onPick: pick, disabled: busy || disabled }))
            : h('div', { className: 'bt-model-none' }, t('Connect this account to load its models.')),
          activeProvider?.provider === currentProvider && effortRows(reasoning).length > 0 ? h('div', { role: 'menu', 'aria-label': t('Thinking level') }, h(EffortRows, { reasoning, current: picked, onPick: pickEffort })) : null),
      manage ? h('div', { className: 'bt-menu-sep', role: 'separator' }) : null,
      manage ? h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); manage() } }, h(SlidersIcon), h('span', { className: 'bt-menu-label' }, t('Models and providers…'))) : null), document.body) : null)
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
  return { model: served?.name ?? rest.join('/'), provider: served?.providerName ?? served?.provider ?? provider }
}

// One line naming the model a Bot runs on and its provider, with "change" opening the
// model menu (which also leads to the providers): "Using Claude Opus 5.5 · Anthropic ·
// change". `modelRef` and `onPick` stand in for a model the Bot does not have yet (not
// `ref`: React keeps that prop for itself, issue #153).
export function ModelLine({ bot, roster, actions, run, modelRef, onPick }) {
  const words = modelWords(roster, modelRef ?? bot.model ?? bot.appliedModel)
  return h('div', { className: 'bt-model-line' },
    h('span', { className: 'bt-model-line-text' }, t('Using {model} · {provider}', words)),
    h('span', { className: 'bt-model-line-sep', 'aria-hidden': true }, '·'),
    h(ModelMenu, { bot: modelRef ? { ...bot, model: modelRef } : bot, roster, actions, run, link: true, onPick }))
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
    h(ModelLine, { bot, roster, actions, run }),
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
  // A model whose provider has no API key fails every turn, so it is no choice.
  const usable = models.filter(model => !model.needsKey)
  const lost = bot.model ? !models.some(model => model.ref === bot.model) : false
  const run = promise => Promise.resolve(promise).then(() => { setError(''); return true }, (failure) => { setError(failure?.message ?? String(failure)); return false })
  // An unknown catalog (none listed) cannot tell a lost model from a slow provider.
  if (bot.model && (!lost || models.length === 0)) return null
  // A window without DSH's own settings takes the missing key here.
  const keyFor = usable.length === 0 && actions.setProviderKey ? models.find(model => model.needsKey) : undefined
  const manage = manageModels(actions)
  const pick = (ref) => {
    setBusy(ref)
    setError('')
    void Promise.resolve(actions.updateBot(bot.id, { model: ref }))
      .catch((failure) => { setError(failure?.message ?? String(failure)); void actions.refreshModels?.() })
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
            'aria-label': `${model.name} · ${provider}`,
            title: model.ref === roster.defaultModel ? `${model.ref} · ${t('Harness default')}` : model.ref,
            onClick: () => pick(model.ref),
          }, model.name, busy === model.ref ? h('span', { className: 'bt-model-spin', 'aria-label': t('Saving…') }) : null))))),
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
.bt-model-account-menu{padding:10px;box-sizing:border-box}
.bt-model-field{display:flex;flex-direction:column;gap:5px;padding:3px 2px 9px;font-size:12px;color:var(--bt-ink-2)}
.bt-model-field select{width:100%;min-height:34px;padding:5px 8px;border:1px solid var(--bt-line);border-radius:8px;background:var(--bt-surface);color:var(--bt-ink);font:inherit}
.bt-model-error{padding:8px;margin:4px 0;border-radius:8px;background:var(--bt-hover);color:var(--bt-danger);font-size:12px;line-height:1.5;white-space:normal}
.bt-model-account-setup{padding:6px 2px;white-space:normal}
.bt-model-key-form{display:grid;gap:8px;font-size:12px}
.bt-model-key-form input{box-sizing:border-box;width:100%;min-height:36px}
.bt-model-key-form p{margin:0;color:var(--bt-ink-2)}
.bt-model-account-menu button:disabled{opacity:.55;cursor:wait}
.bt-model-account-menu :focus-visible{outline:2px solid var(--bt-accent);outline-offset:1px}
.bt-model-group{flex:none;padding:8px 8px 2px;font-size:11px;line-height:14px;font-weight:500;color:var(--bt-ink-3);text-transform:none}
.bt-model-group:first-child{padding-top:2px}
.bt-model-tick{flex:none;width:16px;height:16px;display:inline-flex;color:var(--bt-ink-2)}
.bt-model-tick svg{animation:bt-check-pop ${SPRING_POP.duration}ms ${SPRING_POP.easing} 60ms backwards}
.bt-model-none{padding:8px;font-size:13px;line-height:18px;color:var(--bt-ink-2)}
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
@media (prefers-reduced-motion:reduce){.bt-model-dock{animation:none}.bt-model-spin{animation-duration:2s}.bt-model-caret{transition:none}.bt-model-tick svg{animation:none}}
`
