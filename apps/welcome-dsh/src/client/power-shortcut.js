import { createElement as h, Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call } from './api.js'
import { t } from './i18n.js'
import { WORKING, setTeamIntent, startPower, usePowerState } from './power-store.js'
import { PowerIcon, geniePowerOn, genieStatusOf, powerLocked, powerOff, powerOn, statusOf, teamOrder, unfoldStatusOf } from './team.js'

// Omni's and Genie's power, from the Bot team's sidebar: one button in its top row (and in the
// collapsed rail) that opens a small card with a row per product, each with the one thing to do
// next. The Bot team draws it through its sidebarTools registry (@automagik/bots-dsh/client);
// it wears that sidebar's own pieces (.bt-round, the update card's .bt-update-*), so it follows
// every theme and adds no look of its own. Powering on is the team step's own run (team.js
// powerOn, geniePowerOn) in the shared power store: closing the card does not stop it.

const NAMES = { omni: 'Omni', genie: 'Genie', unfold: 'Unfold' }
// What powering on leaves for the person: Omni found or not found, where it should live.
const CHOOSE = new Set(['found', 'none'])
const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
// The face a row wears before its Bot is on the team: the look the welcome gives the Omni Bot
// (companion.js OMNI_BOT) and the Genie and Unfold Bots' own kinds, drawn by the Bot team's BotMark.
const LOOKS = {
  omni: { id: 'omni', kind: 'omni', color: 'deepseek', avatar: { shape: 'octopus' } },
  genie: { id: 'genie', kind: 'genie' },
  unfold: { id: 'unfold', kind: 'unfold' },
}
export const MARK_SIZE = 28

const statusText = (kind, phase, detail) => (kind === 'omni' ? statusOf(phase, detail) : kind === 'unfold' ? unfoldStatusOf(phase, detail) : genieStatusOf(phase, detail))

// Genie's install steps (bot-types.js runGenieInstall), as the line names them.
const GENIE_STEPS = { git: () => t('Checking git'), team: () => t('Bot team'), genie: () => t('Genie plugin') }

/**
 * Where an install is: { at, count, step } from what the host's job says (Omni: the plugin it
 * installs now among the Omni plugins, the team step's InstallProgress; Genie: its steps), or
 * null before the job says.
 */
export function installStepOf(kind, detail) {
  if (kind === 'omni') {
    const rows = detail?.plugins?.plugins ?? []
    const install = detail?.plugins?.install
    const title = rows.find(row => row.name === install?.current)?.title
    if (!title || rows.length === 0) return null
    return { at: Math.min(rows.length, (install.done?.length ?? 0) + 1), count: rows.length, step: t(title) }
  }
  const install = detail?.[kind]?.install
  const steps = Array.isArray(install?.steps) ? install.steps : []
  if (!install?.current || steps.length === 0 || !GENIE_STEPS[install.current]) return null
  return { at: Math.min(steps.length, (install.done?.length ?? 0) + 1), count: steps.length, step: GENIE_STEPS[install.current]() }
}

// A row's status line while it works: the install's step and place, else the team step's line.
export function workingText(kind, phase, detail) {
  const at = phase === 'installing' ? installStepOf(kind, detail) : null
  return at ? t('Installing {name} · {at} of {count} · {step}', { name: NAMES[kind], ...at }) : statusText(kind, phase, detail)
}

// Whether the product is missing from this DSH, by the host's omni-plugins or genie-plugin answer.
const notInstalled = (kind, status) => (kind === 'omni' ? status?.installed === false : status?.plugin?.installed === false)
const INSTALL_NOTE = {
  omni: () => t('Adds the Omni plugins to this DSH, then looks for your Omni.'),
  genie: () => t('Adds the Genie plugin to this DSH. Genie then joins your team.'),
}

// The product's Bot on the team (the Main Bot when it is one of the kind, else the first): its
// row wears that Bot's mark. The Bot sits in the sidebar already, so the row does not open it.
function botOf(roster, kind) {
  const bots = (roster?.bots ?? []).filter(bot => bot.kind === kind)
  return bots.find(bot => bot.id === roster?.mainBotId) ?? bots[0] ?? null
}

/**
 * One product's row: `state` (on, off, working, attention) for the button's label, the status
 * line, a `note` under it, an `alert` when a power-on failed, `action`, the one thing to do next
 * (off, power, install, retry, choose, add, plugins) or null, and `secondary` (add) beside it. `pressed` says the action is the power button's off (aria-pressed), `locked` that it is held
 * as the team step's own box holds it. `power` is its phase in the power store, `status` the
 * welcome host's omni-plugins or genie-plugin answer (null until the card read it). A read-only
 * team, and Unfold (shown only in its own instance), get text only.
 */
export function powerRow(kind, power, { roster = {}, status = null } = {}) {
  const { phase, detail } = power ?? { phase: 'asleep', detail: null }
  const name = NAMES[kind]
  const bot = botOf(roster, kind)
  const readOnly = Boolean(roster?.readOnly)
  const row = (state, text, action = null, extra = {}) => ({
    kind, name, state, text, action: null, secondary: null, alert: null, note: null, pressed: false, locked: false, bot, ...extra,
    ...(readOnly ? { action: null, secondary: null } : { action, secondary: extra.secondary ?? null }),
  })
  if (kind === 'unfold') return { ...row(bot ? 'on' : 'off', statusText(kind, bot ? 'ready' : 'asleep')), action: null }
  if (WORKING.has(phase)) {
    // An install keeps going on the host: its power is held, as the team step's box holds it.
    const held = powerLocked(kind, phase)
    return row('working', workingText(kind, phase, detail), held ? null : 'off', { working: true, pressed: true, note: held ? t('You can close this. The install keeps going.') : null })
  }
  if (phase === 'failed') return row('attention', statusText(kind, 'failed'), 'retry', { alert: detail?.message ?? null })
  if (phase === 'restart') return row('attention', statusText(kind, 'restart'))
  if (kind === 'omni' && CHOOSE.has(phase)) return row('attention', statusText(kind, phase, detail), 'choose')
  if (kind === 'omni' && phase === 'pairing') return row('attention', statusText(kind, phase, detail), 'off', { pressed: true })
  const removed = phase === 'asleep' && detail?.removed === true
  const on = kind === 'omni' ? !removed && (roster?.omniLinked === true || phase === 'linked') : bot !== null || phase === 'ready'
  if (on) {
    const text = t('On · {status}', { status: kind === 'omni' ? statusText(kind, 'linked', phase === 'linked' ? detail : null) : statusText(kind, 'ready') })
    const secondary = bot === null && kind === 'omni' && roster?.omniAddable === true ? 'add' : null
    // Genie, once on the team, stays (team.js powerLocked): its off is shown, held, and says why.
    const locked = powerLocked(kind, 'ready')
    return row('on', text, 'off', { secondary, pressed: true, locked, note: locked ? t('{name} stays on once it joins your team.', { name }) : null })
  }
  const asleep = statusText(kind, 'asleep', removed ? detail : null)
  // This DSH has no plugin manager to install with: its Plugins page is the way.
  if (status && status.canInstall === false && status.ready !== true) return row('off', asleep, 'plugins')
  if (notInstalled(kind, status)) return row('off', t('Not installed'), 'install', { note: INSTALL_NOTE[kind]() })
  return row('off', asleep, 'power')
}

// The card's rows. Until the plugins were read (`read.checked`), Power on and Install are not
// offered: this DSH may have no manager to install with, and then Open Plugins is the way.
// Without a way into the team step (`teamSetup` false: the Bot team has no onboarding opener),
// Choose where Omni lives is not offered either, so no button is left that does nothing.
export function cardRows(kinds, powers, { roster = {}, read = {}, problems = {}, teamSetup = true } = {}) {
  return kinds.map(kind => powerRow(kind, powers[kind], { roster, status: read[kind] ?? null }))
    .map(row => ((row.action === 'power' || row.action === 'install') && read.checked !== true ? { ...row, action: null, note: null } : row))
    .map(row => (row.action === 'choose' && !teamSetup ? { ...row, action: null } : row))
    .map(row => (problems[row.kind] ? { ...row, alert: problems[row.kind] } : row))
}

const ACTION_LABEL = {
  power: name => t('Power {name} on', { name }),
  off: name => t('Power {name} off', { name }),
  install: name => t('Install {name}', { name }),
  retry: () => t('Try again'),
  choose: () => t('Choose where Omni lives'),
  add: () => t('Add Omni'),
  plugins: () => t('Open Plugins'),
}
export const actionLabel = row => (row.action ? ACTION_LABEL[row.action](row.name) : null)
export const secondaryLabel = row => (row.secondary ? ACTION_LABEL[row.secondary](row.name) : null)

const STATE_LABEL = {
  on: name => t('{name} on', { name }),
  off: name => t('{name} off', { name }),
  working: name => t('{name} working', { name }),
  attention: name => t('{name} needs you', { name }),
}
// The button's name: each row's state, "Omni on, Genie off".
export const buttonLabel = rows => rows.map(row => STATE_LABEL[row.state](row.name)).reduce((a, b) => t('{a}, {b}', { a, b }))

// Its badge: a spinner while a power-on works, the cloud's dot when one failed or waits for a
// restart, else none (an Omni or Genie that is simply off is no alarm).
export function badgeOf(phases) {
  if (phases.some(phase => WORKING.has(phase))) return 'working'
  if (phases.some(phase => phase === 'failed' || phase === 'restart')) return 'error'
  return null
}

// The products in the card, in the team step's order; Unfold only in Unfold's own instance.
export const kindsOf = ({ host = null, preload = null } = {}) => teamOrder(host === 'unfold' ? 'unfold' : preload).filter(kind => kind !== 'unfold' || host === 'unfold')

// Tab past the card's last control moves on to what follows the button, as if the card were not there.
function focusAfter(trigger) {
  const all = [...document.querySelectorAll(FOCUSABLE)].filter(node => node === trigger || node.getClientRects().length > 0)
  const next = all[all.indexOf(trigger) + 1]
  if (next) next.focus()
  else trigger?.focus()
}

// The team step, opened from here on purpose: it saves nothing on Continue, and with `power`
// ('omni') that card powers on by itself (TeamStep, power-store.js setTeamIntent).
// Without the Bot team's opener (an older one) nothing opens, so no intent is left behind for a
// team step that mounts later on its own.
export const canOpenTeamSetup = actions => typeof actions?.openHarnessOnboarding === 'function'
export function openTeamSetup({ actions, close }, power = null) {
  close()
  if (!canOpenTeamSetup(actions)) return
  setTeamIntent(power)
  actions.openHarnessOnboarding('omni-team')
}

// What a row's action does (`action`, else its `action` or `secondary`). Powering on and installing
// run in the power store, so they outlive the card; powering off is the team step's own (team.js
// powerOff).
export function actOn(row, { actions, close, onProblem, start = startPower, stop = powerOff }, action = row.action) {
  onProblem(row.kind, null)
  if (action === 'power' || action === 'install' || action === 'retry') {
    start(row.kind, row.kind === 'omni' ? powerOn : geniePowerOn)
  } else if (action === 'off') {
    if (!row.locked) stop(row.kind)
  } else if (action === 'choose') {
    openTeamSetup({ actions, close }, 'omni')
  } else if (action === 'add') {
    return Promise.resolve(actions.addOmni?.()).then((bot) => {
      if (!bot?.id) return
      close()
      actions.openSession(bot.id)
    }, error => onProblem(row.kind, error?.message ?? String(error)))
  } else if (action === 'plugins') {
    close()
    actions.selectPanel?.('plugins')
  }
  return undefined
}

// Whether the host's answer (omni-plugins, genie-plugin) has an install running.
export const installRunning = status => status?.install?.phase === 'installing'

/**
 * Picks up an install the host is running that this window is not following (the window was
 * reloaded, or the install was started in another one): the kind's power-on, resumed from that
 * answer, so it draws the install's step and place and polls the host (team.js POLL_MS) until it
 * is done or failed. It asks for no install of its own, and a kind already working starts nothing
 * (startPower). Returns the run, or null.
 */
export function resumeInstall(kind, status, start = startPower) {
  if (!installRunning(status) || (kind !== 'omni' && kind !== 'genie')) return null
  const on = kind === 'omni' ? powerOn : geniePowerOn
  return start(kind, options => on({ ...options, resume: status }))
}

// What this DSH's plugins have (omni-plugins, genie-plugin), each null when its read failed.
export const readPlugins = (ask = call) => Promise.all([ask('omni-plugins'), ask('genie-plugin')].map(request => Promise.resolve(request).catch(() => null)))

// A row's face: the Bot team's own mark (its BotMark, the one its sidebar rows wear) for the
// product's Bot, or the look that Bot is made with while it is not on the team yet.
export function RowMark({ Mark, row }) {
  if (typeof Mark !== 'function') return null
  return h(Mark, { bot: row.bot ?? LOOKS[row.kind], size: MARK_SIZE, live: false })
}

export function PowerShortcut({ roster, actions, Mark = null }) {
  const omni = usePowerState('omni')
  const genie = usePowerState('genie')
  const unfold = usePowerState('unfold')
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState(null)
  const [read, setRead] = useState({ host: null, preload: null, omni: null, genie: null, checked: false })
  const [problems, setProblems] = useState({})
  const button = useRef(null)
  const card = useRef(null)
  const title = useRef(null)
  const id = useId()
  const powers = { omni, genie, unfold }

  // Which instance this is, read once when the button mounts (a cheap read), so the button's
  // name and the card's heading are right from the first paint.
  useEffect(() => {
    let alive = true
    void call('state').catch(() => null).then((state) => {
      if (alive) setRead(current => ({ ...current, host: state?.host ?? null, preload: state?.preload ?? null }))
    })
    return () => { alive = false }
  }, [])
  // What this DSH's plugins have, read when the button mounts and each time the card opens, not
  // polled while it is closed (genie-plugin loads the team on every read). An install the host
  // is running that this window does not follow (a reload, another window) is picked up then.
  const mounted = useRef(false)
  useEffect(() => {
    if (!open && mounted.current) return undefined
    mounted.current = true
    let alive = true
    void readPlugins().then(([omniStatus, genieStatus]) => {
      if (!alive) return
      setRead(current => ({ ...current, omni: omniStatus, genie: genieStatus, checked: true }))
      resumeInstall('omni', omniStatus)
      resumeInstall('genie', genieStatus)
    })
    return () => { alive = false }
  }, [open])

  // Escape closes it and gives the button its focus back; a click outside closes it.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (event.target instanceof Node && (card.current?.contains(event.target) || button.current?.contains(event.target))) return
      setOpen(false)
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Under the button, kept inside the window, as the update card is.
  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const rect = button.current?.getBoundingClientRect()
      if (rect) setBox({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.bottom + 6 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  // Opened, a row's first control takes the focus (else the card's title); a power button that
  // shows only once the plugins were read takes it then, unless the person moved on.
  const placed = open && box !== null
  useEffect(() => {
    if (!placed) return
    const at = document.activeElement
    if (card.current?.contains(at) && at !== title.current) return
    const first = card.current?.querySelector('.bt-update-dsh button:not(:disabled)')
    ;(first ?? title.current)?.focus()
  }, [placed, read.checked])
  // An action that went away while its power-on works leaves the focus on the card, not lost.
  useEffect(() => {
    if (placed && card.current && !card.current.contains(document.activeElement) && document.activeElement === document.body) title.current?.focus()
  })

  const kinds = kindsOf(read)
  const teamSetup = canOpenTeamSetup(actions)
  const rows = cardRows(kinds, powers, { roster, read, problems, teamSetup })
  const badge = badgeOf(kinds.map(kind => powers[kind].phase))
  const label = buttonLabel(rows)
  const readOnly = Boolean(roster?.readOnly)

  const close = () => setOpen(false)
  const onProblem = (kind, message) => setProblems(current => ({ ...current, [kind]: message }))
  const run = (row, action) => actOn(row, { actions, close, onProblem }, action)
  const onKeyDown = (event) => {
    // A letter typed here is not a search (the sidebar's type-to-search reads it otherwise).
    if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) event.preventDefault()
    if (event.key !== 'Tab') return
    const items = [...card.current.querySelectorAll(FOCUSABLE)]
    const at = document.activeElement
    if (!event.shiftKey && (items.length === 0 || at === items[items.length - 1])) {
      event.preventDefault()
      close()
      focusAfter(button.current)
    } else if (event.shiftKey && (at === items[0] || at === title.current)) {
      event.preventDefault()
      close()
      button.current?.focus()
    }
  }

  const heading = kinds.includes('unfold') ? t('Omni, Genie and Unfold') : t('Omni and Genie')
  return h(Fragment, null,
    h('button', {
      ref: button, type: 'button', className: 'bt-round bt-side-tool bt-power', 'aria-label': label, title: label,
      'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? id : undefined, onClick: () => setOpen(value => !value),
    },
    badge === 'working' ? h('span', { className: 'bt-thread-spin', 'aria-hidden': true }) : h(PowerIcon, { size: 16, stroke: 2 }),
    badge === 'error' ? h('span', { className: 'bt-update-dot', 'aria-hidden': true }) : null),
    placed ? createPortal(h('div', { ref: card, id, className: 'bt-update-pop bt-power-pop', role: 'dialog', 'aria-label': heading, style: box, onKeyDown },
      h('div', { ref: title, className: 'bt-update-title', tabIndex: -1 }, heading),
      rows.map(row => h('div', { key: row.kind, className: 'bt-update-dsh', 'data-power': row.kind, 'data-state': row.state },
        h('div', { className: 'bt-power-who' },
          h(RowMark, { Mark, row }),
          h('div', { className: 'bt-power-what' },
            h('div', { className: 'bt-update-title' }, row.name),
            h('div', { className: 'bt-update-text', role: 'status', 'aria-live': 'polite' }, row.text))),
        row.note ? h('div', { className: 'bt-update-text' }, row.note) : null,
        row.alert ? h('div', { className: 'bt-update-error', role: 'alert' }, row.alert) : null,
        row.working || row.action || row.secondary ? h('div', { className: 'bt-update-actions' },
          row.secondary ? h('button', { type: 'button', className: 'bt-update-notes', onClick: () => run(row, row.secondary) }, secondaryLabel(row)) : null,
          row.working ? h('span', { className: 'bt-thread-spin', 'aria-hidden': true }) : null,
          row.action ? h('button', {
            type: 'button', className: 'bt-update-go', disabled: row.locked, onClick: () => run(row, row.action),
            ...(row.action === 'off' || row.action === 'power' ? { 'aria-pressed': row.action === 'off' } : {}),
          }, actionLabel(row)) : null) : null)),
      readOnly || !teamSetup ? null : h('div', { className: 'bt-update-actions' },
        h('button', { type: 'button', className: 'bt-update-notes', onClick: () => openTeamSetup({ actions, close }) }, t('Open team setup')))), document.body) : null)
}

/**
 * Puts the shortcut in the Bot team's sidebar, when the Bot team runs here. Its client is
 * looked up only now (`dsh.client.external` loads it first when it is installed); without it,
 * or with one that has no sidebarTools, there is no button and nothing fails.
 */
export function installPowerShortcut(load = () => require('@automagik/bots-dsh/client')) {
  let tools = null
  let bots = null
  try {
    bots = load()
    tools = bots?.omni?.sidebarTools ?? null
  } catch {
    tools = null
  }
  if (typeof tools?.register !== 'function') return () => {}
  // Each row wears the Bot team's own mark for its product, the one its sidebar rows show.
  const Mark = typeof bots?.omni?.ui?.BotMark === 'function' ? bots.omni.ui.BotMark : null
  return tools.register({ id: 'welcome-power', order: 0, Component: props => h(PowerShortcut, { ...props, Mark }) })
}
