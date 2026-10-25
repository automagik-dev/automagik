import { createElement as h, useEffect, useRef, useState } from 'react'
import { call, callOmniUi } from './api.js'
import { OCTOPUS_SVG, omniFace } from './octopus.js'
import { CLAY_OMNI, LAMP, faceAt } from './vendor/clay-art.js'
import { Stage, reducedMotion, useFinish, useGate, useGlitch } from './stage.js'

// Step omni-team (order -270): who joins the companion's team. Each Bot type is a card with
// what it starts with (its model, plugins, tools, skills, folder and permissions), read from
// this DSH (src/host/bot-types.js), with a switch where the person sets it.
//
// Omni's card starts asleep. Its power button wakes it: when this DSH lacks the Omni plugins
// (a plain DSH; the desktop app ships them) it installs them through DSH's plugin manager,
// then it looks for an Omni to connect (the channels plugin's omni-discover) and offers
// what it found, or the ways to reach one. A link made here completes the Connect Omni step
// by itself; anything the card cannot finish waits for that step. Genie's power button
// installs its plugin (@automagik/genie-dsh, with the Bot team under it in a plain DSH), which
// puts the Genie Bot on the team.

export const WAKE_MS = 1100
export const LOOK_MS = 1800
export const POLL_MS = 900
// After an install, how long the new plugins may take to come up before a restart is asked.
export const READY_POLLS = 20

const abortError = () => Object.assign(new Error('Omni was switched off'), { name: 'AbortError' })
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError())
  if (ms <= 0) return resolve()
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(abortError())
  }, { once: true })
})

/**
 * Pressing the power button. `show(phase, detail)` draws each step: waking, installing
 * ({ plugins }), starting ({ plugins }: installed, coming up), looking, then linked ({ origin }), found ({ omnis, sandbox }), none
 * ({ sandbox }), restart ({ plugins }) or failed ({ message }). Returns the last phase.
 * `signal` is the power going off; `quick` (reduced motion) skips the pauses.
 */
export async function powerOn({ show, signal, omniAi = call, omniUi = callOmniUi, wait = sleep, quick = reducedMotion() }) {
  const check = () => { if (signal?.aborted) throw abortError() }
  const pause = ms => wait(quick ? 0 : ms, signal)
  const end = (phase, detail) => {
    check()
    show(phase, detail)
    return phase
  }
  show('waking')
  await pause(WAKE_MS)
  check()
  let plugins = await omniAi('omni-plugins')
  check()
  if (!plugins.ready) {
    show('installing', { plugins })
    if (plugins.install?.phase !== 'installing') {
      try {
        plugins = await omniAi('omni-plugins-install')
      } catch (error) {
        return end('failed', { message: error.message })
      }
    }
    let polls = 0
    while (plugins.install?.phase === 'installing' || (plugins.install?.phase === 'done' && !plugins.ready && polls < READY_POLLS)) {
      check()
      // Installed, and DSH is bringing the plugins up.
      show(plugins.install?.phase === 'installing' ? 'installing' : 'starting', { plugins })
      await wait(POLL_MS, signal)
      plugins = await omniAi('omni-plugins')
      if (plugins.install?.phase !== 'installing') polls += 1
    }
    if (plugins.install?.phase === 'failed') return end('failed', { message: plugins.install.error })
    if (!plugins.ready) return end('restart', { plugins })
  }
  show('looking')
  const started = Date.now()
  // The channels plugin answers on the Omni plugins' route once it runs; a route that is not
  // there yet waits for DSH to restart.
  let link = null
  try {
    link = await omniUi('omni-link')
  } catch (error) {
    if (error?.code === 'HTTP_404') return end('restart', { plugins })
  }
  check()
  if (link?.linked === true || link?.configured === true) {
    await pause(LOOK_MS / 2)
    return end('linked', { origin: link.origin ?? null })
  }
  const found = await omniUi('omni-discover').catch(() => null)
  check()
  await pause(Math.max(0, LOOK_MS - (Date.now() - started)))
  const omnis = Array.isArray(found?.omnis) ? found.omnis : []
  return end(omnis.length > 0 ? 'found' : 'none', { omnis, sandbox: found?.sandbox ?? null })
}

/**
 * Pressing Genie's power button: waking, installing ({ genie }), starting ({ genie }:
 * installed, coming up), then ready ({ bot }) once the Genie Bot is on the team, restart
 * ({ genie }) or failed ({ message }). Returns the last phase.
 */
export async function geniePowerOn({ show, signal, genieAi = call, wait = sleep, quick = reducedMotion() }) {
  const check = () => { if (signal?.aborted) throw abortError() }
  const end = (phase, detail) => {
    check()
    show(phase, detail)
    return phase
  }
  show('waking')
  await wait(quick ? 0 : WAKE_MS, signal)
  check()
  let genie = await genieAi('genie-plugin')
  check()
  if (genie.ready) return end('ready', { bot: genie.bot })
  show('installing', { genie })
  if (genie.install?.phase !== 'installing') {
    try {
      genie = await genieAi('genie-plugin-install')
    } catch (error) {
      return end('failed', { message: error.message })
    }
  }
  let polls = 0
  while (!genie.ready && (genie.install?.phase === 'installing' || (genie.install?.phase === 'done' && polls < READY_POLLS))) {
    check()
    show(genie.install?.phase === 'installing' ? 'installing' : 'starting', { genie })
    await wait(POLL_MS, signal)
    genie = await genieAi('genie-plugin')
    if (genie.install?.phase !== 'installing') polls += 1
  }
  if (genie.ready) return end('ready', { bot: genie.bot })
  if (genie.install?.phase === 'failed') return end('failed', { message: genie.install.error })
  return end('restart', { genie })
}

const onMac = (scope = globalThis) => /Mac/i.test(scope.navigator?.platform ?? '') || /Mac OS X/.test(scope.navigator?.userAgent ?? '')
const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const portOf = (url) => {
  try {
    return new URL(url).port
  } catch {
    return ''
  }
}

/**
 * One found Omni as a choice: its title, the line under it, and its one-tap action — `use`
 * (this computer has its key), `connect` (approve this device from the phone) — or none,
 * with a note on what the Connect Omni step can do for it instead.
 */
export function foundChoice(omni, { mac = false } = {}) {
  const here = mac ? 'this Mac' : 'this computer'
  const title = omni.source === 'sandbox' ? `Your Omni on ${here}` : omni.local ? `Omni on ${here}` : hostOf(omni.url)
  const port = omni.local ? portOf(omni.url) : ''
  const sub = [omni.version ? `v${omni.version}` : null, port ? `port ${port}` : null, !omni.local ? 'saved in your Omni CLI' : null].filter(Boolean).join(' · ')
  const row = (action, note = null) => ({ id: omni.id, title, sub, action, note })
  if (omni.local && omni.reachable === false) return row(null, 'Not answering right now.')
  if (omni.updateTo || (omni.pairing === 'too-old' && !omni.hasKey)) return row(null, 'Needs an update first; Connect Omni, next, does it.')
  if (omni.hasKey) return row('use')
  if (omni.pairing === 'off') return row(null, 'Sign-in from devices is off on it.')
  return row('connect')
}

// The link an Omni sends its owner (https://<omni>/api/login/app?grant=…, or the
// omni://connect?url=…&grant=… it opens), or an address to sign in to.
export function readRemote(text) {
  const value = String(text ?? '').trim()
  if (value === '') return null
  let link = null
  try {
    link = new URL(value)
  } catch { /* an address without a scheme */ }
  const grant = link?.searchParams.get('grant') ?? ''
  if (/^[A-Za-z0-9_-]{24}$/.test(grant)) {
    if (link.protocol === 'omni:') {
      const url = link.searchParams.get('url')
      return url ? { kind: 'grant', url, grant } : { kind: 'bad-link' }
    }
    if (/\/api\/login\/app\/?$/.test(link.pathname)) return { kind: 'grant', url: `${link.origin}${link.pathname.replace(/\/api\/login\/app\/?$/, '')}`, grant }
  }
  if (/^omni:/i.test(value) || /[?&]grant=/.test(value)) return { kind: 'bad-link' }
  return { kind: 'address', url: value }
}

const TYPE_LABEL = { 'whatsapp-baileys': 'WhatsApp', 'whatsapp-cloud': 'WhatsApp Business', slack: 'Slack', telegram: 'Telegram', discord: 'Discord', gupshup: 'Gupshup' }
export const channelLabel = channel => TYPE_LABEL[channel.type] ?? channel.type ?? 'Channel'

// Genie's setup (genie-dsh in the genie repository).
export const GENIE_TYPE = {
  type: 'genie',
  groups: [
    { id: 'plugins', label: 'Plugins', rows: [{ id: 'genie', label: 'Genie', detail: 'Installs when Genie powers on' }] },
    { id: 'tools', label: 'Tools', rows: [{ id: 'threads', label: 'A Task per wish', detail: 'Under Genie, with its report in Genie\'s chat' }, { id: 'computer', label: 'Shell, files and git', detail: 'In the wish\'s own copy of the project' }] },
    { id: 'setup', label: 'Setup', rows: [{ id: 'folder', label: 'Folder', detail: 'Its own, in your team workspace' }] },
  ],
}

// The switches the person sets: the tool groups that are not locked, as `{ id: on }`.
export const abilitiesOf = type => Object.fromEntries((type?.groups ?? []).find(group => group.id === 'tools')?.rows.filter(row => typeof row.on === 'boolean').map(row => [row.id, row.on]) ?? [])

// A long folder, shortened in the middle so it fits on one line: ~/…/workspace/omni.
export function shortPath(path, keep = 2) {
  const parts = String(path).split('/')
  const head = parts[0] === '~' ? '~' : ''
  const tail = parts.slice(-keep).filter(Boolean)
  return parts.length - (head ? 1 : 0) > keep + 1 ? `${head}/…/${tail.join('/')}` : path
}

const Check = () => h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true }, h('path', { d: 'M3 8.5l3 3 7-7', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))

/** A Bot type's preloaded setup, group by group, with a switch where it is tunable. */
export function Capabilities({ type, abilities = {}, onToggle, disabled = false }) {
  if (!type) return h('p', { className: 'oai-muted oai-caps-wait' }, 'Reading what it starts with…')
  return h('div', { className: 'oai-caps' }, type.groups.map(group => h('section', { key: group.id, className: 'oai-cap-group', 'aria-label': group.label },
    h('h3', null, group.label),
    group.rows.length === 0
      ? h('p', { className: 'oai-muted oai-cap-empty' }, group.empty ?? 'None')
      : h('ul', null, group.rows.map((row) => {
        const on = typeof row.on === 'boolean' ? abilities[row.id] ?? row.on : null
        return h('li', { key: row.id, className: `oai-cap${on === false ? ' oai-off' : ''}`, 'data-cap': row.id },
          h('span', { className: 'oai-cap-what' },
            h('strong', null, row.label),
            row.detail ? h('small', row.path ? { title: row.detail } : null, row.path ? shortPath(row.detail) : row.detail) : null,
            row.installed === false ? h('small', null, 'Installs when Omni powers on') : null,
            row.tools ? h('code', null, row.tools.join(' · ')) : null),
          row.version ? h('span', { className: `oai-version${row.installed === false ? ' oai-pending' : ''}` }, `v${row.version}`) : null,
          row.installed === true ? h('span', { className: 'oai-tick', title: 'Installed' }, h(Check)) : null,
          row.locked ? h('span', { className: 'oai-core', title: 'What this Bot is for: always on' }, 'Always on')
            : on !== null && onToggle ? h('button', { type: 'button', role: 'switch', className: 'oai-switch', 'aria-checked': on, 'aria-label': `${row.label} for this Bot`, disabled, onClick: () => onToggle(row.id, !on) })
              : null)
      })))))
}

const CLOSED_EYES = '<g class="oai-closed" fill="none" stroke="#06121f" stroke-width="3" stroke-linecap="round"><path d="M33 37Q40 42 47 37"/><path d="M53 37Q60 42 67 37"/></g>'
const PORTRAIT_SVG = OCTOPUS_SVG.replace('</svg>', `${CLOSED_EYES}</svg>`)

/**
 * Omni's face in its box, by the box's phase: asleep while powered off, focused while it
 * wakes, installs and looks, curious when it waits for the person (found, none, pairing,
 * restart), delighted once linked, sad when the install failed.
 */
export function omniFaceOf(phase) {
  if (phase === 'asleep') return 'asleep'
  if (phase === 'failed') return 'sad'
  if (phase === 'linked') return 'delighted'
  if (['waking', 'installing', 'starting', 'looking'].includes(phase)) return 'focused'
  return 'curious'
}
// The clay face, or the vector octopus (its eyes closed while asleep) with CLAY_OMNI off.
const portraitOf = phase => (CLAY_OMNI ? omniFace(omniFaceOf(phase)) : PORTRAIT_SVG)

/**
 * Genie's face on its card, by its box's phase: asleep while powered off, focused while it
 * wakes and installs, delighted once on the team, curious when a restart waits, sad when
 * the install failed.
 */
export function genieExpressionOf(phase) {
  if (phase === 'asleep') return 'asleep'
  if (phase === 'failed') return 'sad'
  if (phase === 'ready') return 'delighted'
  if (['waking', 'installing', 'starting'].includes(phase)) return 'focused'
  return 'curious'
}
const GeniePet = ({ expression }) => h('div', { className: 'oai-genie-pet oai-clay oai-clay-genie', 'data-face': expression, style: { '--oai-face-at': faceAt(expression) } })

const PowerIcon = () => h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true },
  h('path', { d: 'M12 3v8', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' }),
  h('path', { d: 'M6.4 6.6a8 8 0 1 0 11.2 0', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' }))

const titleOf = (plugins, name) => plugins?.plugins?.find(row => row.name === name)?.title ?? 'Omni'

// The one status line inside the box, under Omni.
export function statusOf(phase, detail) {
  if (phase === 'asleep') return detail?.removed ? 'Powered off · not on your team' : 'Powered off'
  if (phase === 'installing') {
    const rows = detail?.plugins?.plugins ?? []
    const install = detail?.plugins?.install
    const at = Math.min(rows.length, (install?.done?.length ?? 0) + 1)
    return install?.current ? `Installing ${titleOf(detail.plugins, install.current)} · ${at} of ${rows.length}` : 'Installing Omni…'
  }
  if (phase === 'found') {
    const count = (detail?.omnis ?? []).filter(omni => foundChoice(omni).action).length
    return count === 1 ? 'Found an Omni' : count > 1 ? `Found ${count} Omnis` : 'Found Omnis, none ready to connect'
  }
  if (phase === 'linked') return detail?.origin ? `Connected to ${detail.origin}` : 'Connected'
  return {
    waking: 'Waking up…',
    starting: 'Starting Omni in this DSH…',
    looking: 'Looking for a connection…',
    none: 'No Omni found nearby',
    pairing: 'Approve this device on your phone',
    restart: 'Installed · restart DSH to start it',
    failed: 'Could not install Omni',
  }[phase] ?? ''
}

// Genie's status line, inside its box.
export function genieStatusOf(phase, detail) {
  if (phase === 'asleep') return detail?.removed ? 'Powered off · not on your team' : 'Powered off'
  return {
    waking: 'Waking up…',
    installing: 'Installing Genie…',
    starting: 'Starting Genie in this DSH…',
    ready: 'Ready for a wish',
    restart: 'Installed · restart DSH to start it',
    failed: 'Could not install Genie',
  }[phase] ?? ''
}
// Genie's lights: power, its plugin, and the Genie Bot on the team.
export function genieLightsOf(phase) {
  return [
    ['power', phase === 'asleep' ? 'off' : 'on'],
    ['plugins', phase === 'ready' ? 'on' : ['installing', 'starting'].includes(phase) ? 'busy' : phase === 'failed' || phase === 'restart' ? 'warn' : 'off'],
    ['team', phase === 'ready' ? 'on' : 'off'],
  ]
}

// The box's three lights: power, its plugins, its connection. Waking lights them one by one;
// then each shows what is true: on, working (a blink), or off.
export function lightsOf(phase) {
  const ready = ['looking', 'found', 'none', 'pairing', 'linked'].includes(phase)
  return [
    ['power', phase === 'asleep' ? 'off' : 'on'],
    ['plugins', ready ? 'on' : ['installing', 'starting'].includes(phase) ? 'busy' : phase === 'failed' || phase === 'restart' ? 'warn' : 'off'],
    ['link', phase === 'linked' ? 'on' : ['looking', 'pairing'].includes(phase) ? 'busy' : phase === 'found' ? 'warn' : 'off'],
  ]
}

function InstallProgress({ plugins }) {
  const install = plugins?.install
  const done = new Set(install?.done ?? [])
  return h('ol', { className: 'oai-install', 'aria-label': 'The Omni plugins' }, (plugins?.plugins ?? []).map((row) => {
    const state = done.has(row.name) || (row.installed && row.enabled !== false) ? 'done' : install?.current === row.name ? 'now' : 'next'
    return h('li', { key: row.name, className: `oai-install-${state}` },
      h('span', { className: 'oai-install-dot', 'aria-hidden': true }, state === 'done' ? h(Check) : null),
      row.title.replace(/^Omni /, ''))
  }))
}

function Pairing({ pairing, onCancel }) {
  return h('div', { className: 'oai-pairing', 'aria-live': 'polite' },
    h('code', { className: 'oai-pair-code' }, pairing.code),
    h('div', { className: 'oai-row' },
      pairing.waLink ? h('a', { className: 'oai-pill oai-pill-primary', href: pairing.waLink, target: '_blank', rel: 'noreferrer' }, 'Open WhatsApp') : null,
      pairing.approveUrl ? h('a', { className: `oai-pill${pairing.waLink ? '' : ' oai-pill-primary'}`, href: pairing.approveUrl, target: '_blank', rel: 'noreferrer' }, 'Approve') : null,
      h('button', { type: 'button', className: 'oai-pill', onClick: onCancel }, 'Cancel')))
}

function Found({ omnis, busy, onUse }) {
  const mac = onMac()
  return h('ul', { className: 'oai-found-list' }, omnis.map((omni) => {
    const choice = foundChoice(omni, { mac })
    return h('li', { key: omni.id, className: `oai-found-row${choice.action ? '' : ' oai-quiet'}`, title: choice.note ?? undefined },
      h('span', { className: 'oai-found-what' }, h('strong', null, choice.title), h('small', null, choice.note ?? choice.sub)),
      choice.action ? h('button', { type: 'button', className: 'oai-pill oai-pill-primary', disabled: busy !== null, onClick: () => onUse(omni) }, busy === omni.id ? 'Connecting…' : choice.action === 'use' ? 'Use it' : 'Connect') : null)
  }))
}

function Elsewhere({ busy, onRemote, onLocal }) {
  const [text, setText] = useState('')
  const wanted = readRemote(text)
  const submit = (event) => {
    event.preventDefault()
    if (wanted !== null) onRemote(wanted)
  }
  return h('div', { className: 'oai-elsewhere' },
    h('form', { className: 'oai-field', onSubmit: submit },
      h('input', { type: 'text', inputMode: 'url', autoComplete: 'off', spellCheck: false, value: text, placeholder: 'Its address, or the link Omni sent you', 'aria-label': 'Omni address or link', onChange: event => setText(event.target.value) }),
      h('button', { type: 'submit', className: 'oai-pill oai-pill-primary', disabled: busy !== null || wanted === null }, busy === 'remote' ? 'Connecting…' : 'Connect')),
    h('button', { type: 'button', className: 'oai-textlink', onClick: onLocal }, onMac() ? 'Or run Omni on this Mac' : 'Or run Omni on this computer'))
}

// What the box shows under the status line: one thing at a time, in the same place.
function Inside({ phase, detail, power, live, elsewhere, setElsewhere }) {
  const channels = live?.configured ? live.channels ?? [] : []
  if (phase === 'installing') return h(InstallProgress, { plugins: detail?.plugins })
  if (phase === 'pairing') return h(Pairing, { pairing: detail.pairing, onCancel: power.cancelPairing })
  if (phase === 'none' || (phase === 'found' && elsewhere)) return h(Elsewhere, { busy: power.busy, onRemote: power.remote, onLocal: power.local })
  if (phase === 'found') {
    return h('div', { className: 'oai-found-box' },
      h(Found, { omnis: detail?.omnis ?? [], busy: power.busy, onUse: power.use }),
      h('button', { type: 'button', className: 'oai-textlink', onClick: () => setElsewhere(true) }, 'Somewhere else?'))
  }
  // Once connected, its real channels, as they will sit in the menu.
  if (phase === 'linked' && channels.length > 0) {
    return h('div', { className: 'oai-menu' },
      h('span', { className: 'oai-menu-label' }, 'In your menu'),
      h('ul', { className: 'oai-menu-preview' }, channels.slice(0, 3).map(channel => h('li', { key: channel.id }, h('span', { className: `oai-dot ${channel.status === 'connected' ? 'ok' : 'warn'}` }), `${channelLabel(channel)} · ${channel.name}`))))
  }
  if (phase === 'restart') return h('p', { className: 'oai-inside-note' }, 'Restart DSH, then power Omni on again.')
  if (phase === 'failed') return h('p', { className: 'oai-inside-note oai-bad', title: detail?.message }, detail?.message ?? 'Add the Omni plugins on DSH\'s Plugins page.')
  return null
}

/**
 * The machine: one box of a fixed size, Omni inside it, a switch on its corner and three
 * lights. Asleep it is a powered-down screen; everything after happens inside, in place.
 */
export function Machine({ kind = 'omni', phase, detail, power, live, onPower, children }) {
  const [elsewhere, setElsewhere] = useState(false)
  const awake = phase !== 'asleep'
  const omni = kind === 'omni'
  const title = omni ? 'Omni' : 'Genie'
  // Genie, once on the team, stays: its plugin made the Genie Bot.
  const locked = phase === 'installing' || phase === 'starting' || (!omni && phase === 'ready')
  return h('div', { className: `oai-box oai-box-${kind} oai-is-${phase}`, 'data-phase': phase },
    h('div', { className: 'oai-box-top' },
      h('span', { className: 'oai-lights', 'aria-hidden': true }, (omni ? lightsOf(phase) : genieLightsOf(phase)).map(([id, state]) => h('i', { key: id, className: `oai-light oai-light-${state}`, title: id }))),
      h('button', { type: 'button', className: `oai-power${awake ? ' on' : ''}`, 'aria-pressed': awake, 'aria-label': awake ? `Power ${title} off` : `Power ${title} on`, onClick: onPower, disabled: locked }, h(PowerIcon))),
    h('div', { className: 'oai-screen', 'aria-hidden': 'true' },
      phase === 'looking' ? h('div', { className: 'oai-scan' }, h('i'), h('i'), h('i')) : null,
      phase === 'asleep' ? h('div', { className: 'oai-zzz' }, h('i', null, 'z'), h('i', null, 'z'), h('i', null, 'z')) : null,
      children),
    h('p', { className: `oai-status${['waking', 'installing', 'starting', 'looking'].includes(phase) ? ' oai-working' : ''}`, role: 'status', 'aria-live': 'polite' }, omni ? statusOf(phase, detail) : genieStatusOf(phase, detail)),
    h('div', { className: 'oai-inside' },
      omni ? h(Inside, { phase, detail, power, live, elsewhere, setElsewhere }) : h(GenieInside, { phase, detail }),
      omni && power?.problem ? h('p', { className: 'oai-inside-note oai-bad', role: 'alert' }, power.problem) : null))
}

// Under Genie's status line: what to do when it could not start.
function GenieInside({ phase, detail }) {
  if (phase === 'restart') return h('p', { className: 'oai-inside-note' }, 'Restart DSH, then power Genie on again.')
  if (phase === 'failed') return h('p', { className: 'oai-inside-note oai-bad', title: detail?.message }, detail?.message ?? 'Add @automagik/genie-dsh on DSH\'s Plugins page.')
  return null
}

// What a Bot type starts with, behind one disclosure, closed until asked.
const StartsWith = props => h('details', { className: 'oai-starts' }, h('summary', null, 'What it starts with'), h(Capabilities, props))

// Omni's card: the machine, its name and one sentence. The rest waits behind the disclosure.
export function OmniCard({ power, onPower, type, abilities, onToggle, live }) {
  const { phase, detail } = power
  const awake = phase !== 'asleep'
  return h('article', { className: `oai-fighter oai-omni${awake ? ' oai-chosen' : ''}`, 'data-phase': phase },
    h(Machine, { phase, detail, power, live, onPower },
      h('div', { className: 'oai-octo-wrap', dangerouslySetInnerHTML: { __html: portraitOf(phase) } })),
    h('header', null,
      h('h2', null, 'Omni'),
      awake && phase !== 'failed'
        ? h('span', { className: 'oai-team-line' }, h('span', { className: 'oai-on-team' }, h(Check), 'On your team'), h('button', { type: 'button', className: 'oai-remove', onClick: onPower, disabled: phase === 'installing' || phase === 'starting' }, 'Remove'))
        : null),
    h('p', { className: 'oai-about' }, 'Every chat on every channel, answered by your team.'),
    h(StartsWith, { type, abilities, onToggle, disabled: !awake }))
}

// Genie's card: its box, its name, the wish it grants. Joined once its Bot is on the team.
export function GenieCard({ power }) {
  const { phase, detail } = power
  const joined = phase === 'ready' || phase === 'restart'
  return h('article', { className: `oai-fighter oai-genie${joined ? ' oai-chosen' : ''}`, 'data-phase': phase },
    h(Machine, { kind: 'genie', phase, detail, onPower: power.toggle },
      h('div', { className: 'oai-genie-wrap' }, h(GeniePet, { expression: genieExpressionOf(phase) }))),
    h('header', null,
      h('h2', null, 'Genie'),
      joined ? h('span', { className: 'oai-team-line' }, h('span', { className: 'oai-on-team' }, h(Check), 'On your team')) : null),
    h('p', { className: 'oai-about oai-wish' },
      h('img', { className: 'oai-wish-lamp', src: LAMP, alt: '', draggable: false }),
      'Give it a wish, get one delivery.'),
    h(StartsWith, { type: GENIE_TYPE }))
}

// Genie's power button: on installs and starts it; off, before it joined, leaves it out.
function useGeniePower() {
  const [phase, setPhase] = useState('asleep')
  const [detail, setDetail] = useState(null)
  const run = useRef(null)
  useEffect(() => () => run.current?.abort(), [])
  const show = (next, value = null) => {
    setPhase(next)
    setDetail(value)
  }
  // Genie may already be on the team (installed before a restart or an update): its card
  // says so from the start, rather than asleep.
  useEffect(() => {
    let alive = true
    call('genie-plugin').then((genie) => {
      if (alive && genie?.ready && run.current === null) show('ready', { bot: genie.bot })
    }, () => {})
    return () => { alive = false }
  }, [])
  const on = () => {
    run.current?.abort()
    const controller = new AbortController()
    run.current = controller
    geniePowerOn({ show, signal: controller.signal }).catch((error) => {
      if (error?.name !== 'AbortError') show('failed', { message: error.message })
    })
  }
  const off = () => {
    run.current?.abort()
    show('asleep', { removed: true })
  }
  return { phase, detail, toggle: () => (phase === 'asleep' ? on() : off()) }
}

// The power button's state, and the connecting a found Omni or a typed address does.
function usePower() {
  const [phase, setPhase] = useState('asleep')
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const run = useRef(null)
  const back = useRef(null)
  useEffect(() => () => run.current?.abort(), [])

  const show = (next, value = null) => {
    setPhase(next)
    setDetail(value)
  }
  const on = () => {
    run.current?.abort()
    const controller = new AbortController()
    run.current = controller
    setProblem(null)
    powerOn({ show, signal: controller.signal }).catch((error) => {
      if (error?.name !== 'AbortError') show('failed', { message: error.message })
    })
  }
  // Off is Remove: Omni sleeps again and does not join the team.
  const off = () => {
    run.current?.abort()
    if (phase === 'pairing') void callOmniUi('omni-pair-cancel').catch(() => {})
    setProblem(null)
    setBusy(null)
    show('asleep', { removed: true })
  }

  // Each connect answers `paired`, `pairing` (approve it on the phone) or a message.
  const connect = async (row, endpoint, payload) => {
    setBusy(row)
    setProblem(null)
    try {
      const reply = await callOmniUi(endpoint, payload)
      if (run.current?.signal.aborted) return
      if (reply.status === 'paired') show('linked', { origin: reply.origin ?? null })
      else if (reply.pairing) {
        back.current = { phase, detail }
        show('pairing', { pairing: reply.pairing })
      } else setProblem(reply.message ?? 'That Omni cannot approve this app from here. Connect Omni, next, can use its API key.')
    } catch (error) {
      setProblem(error.message)
    } finally {
      setBusy(null)
    }
  }

  // A sign-in waits for the person's phone.
  useEffect(() => {
    if (phase !== 'pairing') return undefined
    let timer = 0
    let alive = true
    const tick = async () => {
      try {
        const reply = await callOmniUi('omni-pair-poll')
        if (!alive) return
        if (reply.status === 'paired') return show('linked', { origin: reply.origin ?? null })
        if (reply.status !== 'pending') {
          setProblem(reply.status === 'denied' ? 'The sign-in was denied.' : 'The code expired. Try again for a new one.')
          return show(back.current?.phase ?? 'none', back.current?.detail ?? null)
        }
      } catch (error) {
        if (alive) setProblem(error.message)
      }
      if (alive) timer = setTimeout(tick, detail?.pairing?.pollIntervalMs ?? 2000)
    }
    timer = setTimeout(tick, detail?.pairing?.pollIntervalMs ?? 2000)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [phase])

  return {
    phase, detail, busy, problem,
    toggle: () => (phase === 'asleep' ? on() : off()),
    use: omni => connect(omni.id, 'omni-discover-use', { id: omni.id }),
    remote: wanted => (wanted.kind === 'bad-link'
      ? setProblem('That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…')
      : wanted.kind === 'grant' ? connect('remote', 'omni-connect-grant', { url: wanted.url, grant: wanted.grant }) : connect('remote', 'omni-pair-start', { url: wanted.url })),
    cancelPairing: () => {
      void callOmniUi('omni-pair-cancel').catch(() => {})
      show(back.current?.phase ?? 'none', back.current?.detail ?? null)
    },
  }
}

// The product the desktop app was opened for (state.preload: 'omni', 'genie' or null, from
// AUTOMAGIK_PRELOAD): its card comes first and starts chosen, Omni's by powering on through
// its box as a press would. The other card stays there to add, then or later.
export function teamOrder(preload) {
  return preload === 'genie' ? ['genie', 'omni'] : ['omni', 'genie']
}
export const preselected = preload => ({ omni: preload === 'omni', genie: preload === 'genie' })
// Whether Omni powers on by itself now: preloaded, still asleep, and never switched off here.
export const powersOnByItself = (preload, phase, detail, started, kind = 'omni') =>
  preselected(preload)[kind] === true && !started && phase === 'asleep' && detail?.removed !== true

// Who joins, in words, for the button.
export function joinedLabel({ omni, genie }, name) {
  const who = [omni && 'Omni', genie && 'Genie'].filter(Boolean)
  return who.length === 0 ? `Continue with just ${name}` : `Continue with ${who.join(' and ')}`
}

// The speech bubble, by Omni's phase.
const speechOf = (phase, name, origin) => ({
  asleep: `${name} here! Omni is asleep. Press its power button to bring it along.`,
  waking: 'Omni is waking up…',
  installing: 'Bringing Omni into this DSH. One moment.',
  starting: 'Omni is starting up…',
  looking: 'Omni is looking for a connection…',
  found: 'Omni found where your channels live!',
  none: 'No Omni here yet. Tell Omni where yours lives.',
  pairing: 'Approve this device, and Omni connects.',
  linked: origin ? `Omni is connected to ${origin}!` : 'Omni is connected!',
  restart: 'Omni is installed. Restart DSH to wake it.',
  failed: 'Omni could not be installed here.',
})[phase]
const genieSpeechOf = phase => ({
  waking: 'Genie is waking up…',
  installing: 'Bringing Genie into this DSH. One moment.',
  starting: 'Genie is starting up…',
  ready: 'Genie is on your team. Give it a wish once you are in!',
  restart: 'Genie is installed. Restart DSH to wake it.',
  failed: 'Genie could not be installed here.',
})[phase]

export function TeamStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  const [glitching, glitch] = useGlitch()
  const power = usePower()
  const geniePower = useGeniePower()
  // The speech follows whichever box was pressed last.
  const [lastPressed, setLastPressed] = useState('omni')
  const [omniType, setOmniType] = useState(null)
  const [abilities, setAbilities] = useState({})
  const [live, setLive] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState(null)
  const autoPowered = useRef(false)
  const genieAutoPowered = useRef(false)

  const { phase } = power
  // Read again once Omni is awake, when what it brings may have just been installed.
  const awakeNow = phase === 'looking' || phase === 'linked'
  useEffect(() => { call('bot-type', { type: 'omni' }).then(setOmniType, () => {}) }, [awakeNow])
  useEffect(() => { callOmniUi('omni-overview', {}).then(setLive, () => setLive(null)) }, [])
  useEffect(() => {
    if (phase !== 'linked') return
    callOmniUi('omni-overview', {}).then(setLive, () => setLive(null))
    glitch()
  }, [phase, glitch])
  useEffect(() => { if (state) glitch() }, [state, glitch])
  useEffect(() => {
    if (!state || !powersOnByItself(state.preload, power.phase, power.detail, autoPowered.current)) return
    autoPowered.current = true
    power.toggle()
  }, [state])
  useEffect(() => {
    if (!state || !powersOnByItself(state.preload, geniePower.phase, geniePower.detail, genieAutoPowered.current, 'genie')) return
    genieAutoPowered.current = true
    setLastPressed('genie')
    geniePower.toggle()
  }, [state])
  if (!state) return null

  const name = state.companionName ?? 'Your companion'
  const omni = phase !== 'asleep' && phase !== 'failed'
  const genie = geniePower.phase === 'ready' || geniePower.phase === 'restart'
  const genieWorking = ['waking', 'installing', 'starting'].includes(geniePower.phase)
  const working = ['waking', 'installing', 'starting', 'looking'].includes(phase)
  const local = () => go({ omni: true })

  async function go({ omni: joined = omni } = {}) {
    setSaving(true)
    setProblem(null)
    try {
      await call('team-save', { omni: joined, genie, omniAbilities: { ...abilitiesOf(omniType), ...abilities } })
      finish()
    } catch (error) {
      setProblem(error.message)
      setSaving(false)
    }
  }
  const omniPower = { ...power, local }

  return h(Stage, {
    title: 'Grow your team',
    speech: (lastPressed === 'genie' && genieSpeechOf(geniePower.phase)) || speechOf(phase, name, power.detail?.origin),
    at: 'omni-team',
    glitching,
    wide: true,
  },
  h('p', { className: 'oai-lede' }, `${name} leads. Who comes along?`),
  h('div', { className: 'oai-select' },
    ...teamOrder(state.preload).map(id => (id === 'omni'
      ? h(OmniCard, { key: 'omni', power: omniPower, onPower: () => { setLastPressed('omni'); power.toggle() }, type: omniType, abilities, onToggle: (row, on) => setAbilities(rows => ({ ...rows, [row]: on })), live })
      : h(GenieCard, { key: 'genie', power: { ...geniePower, toggle: () => { setLastPressed('genie'); geniePower.toggle() } } })))),
  problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
  h('div', { className: 'oai-actions' },
    h('button', { type: 'button', className: 'oai-primary oai-big', disabled: saving || working || genieWorking, onClick: () => go() },
      saving ? 'Bringing them in…' : working ? 'Omni is waking…' : genieWorking ? 'Genie is waking…' : joinedLabel({ omni, genie }, name))))
}
