// Settings → Feedback, "Permissions": for each Bot conversation open now, the level saved for
// it, the level it runs at, and what its agent's own permission layer last did. It only shows
// what the host read from memory (host/permission-diagnostics.js): no control, no retry, the
// same for a window that only views the team. Rows are the page's own error rows.
import { createElement as h, useEffect, useState } from 'react'
import { CLI_NAMES } from './cli-login-model.js'
import { quietly } from './diagnostics.js'
import { dateLocale, t } from './i18n.js'
import { cliAuto, cliOfBot, presetName } from './permission-picker.js'

const PERMISSION_ANSWER = 1

// As the error rows tell a time (feedback.js whenText).
function permWhen(time) {
  const date = new Date(time)
  const clock = date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  return new Date().toDateString() === date.toDateString() ? clock : `${date.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })} ${clock}`
}

const PERM_SAVED = {
  group: 'Saved level: {level}, set for the group',
  bot: 'Saved level: {level}, set for the Bot',
  task: 'Saved level: {level}, for this task',
}
const PERM_WHY = {
  'no-backchannel': 'this install cannot offer them',
  'agent-no-bridge': 'this agent does not take them',
  'agent-default': 'the usual for this agent',
  setting: 'chosen in the settings',
}
const PERM_PATHS = {
  'dsh-bridge': 'a tool of DeepSeek Harness',
  mcp: 'a tool of another tool server',
  cli: "the agent's own tool",
  loader: 'a search for a tool',
  drift: "the agent's own tool, which was not allowed here, so the turn was stopped",
}
const PERM_REVIEWERS = {
  'built-in': 'the built-in reviewer',
  agent: "the agent's own model",
  custom: 'a model you chose',
}
const PERM_REVIEWS = {
  AUTO_REVIEW_NO_STEP: 'it could not see the action',
  AUTO_REVIEW_NO_ROUTE: 'it could not see the action',
  AUTO_REVIEW_NO_SCHEMA: 'it could not see the action',
  AUTO_REVIEW_FAILED: 'it failed',
  AUTO_REVIEW_LEVEL_CHANGED: 'the permission level changed before it finished',
  AUTO_REVIEW_TIMEOUT: 'it took too long',
  AUTO_REVIEW_DENIED: 'it stopped the action',
}

const permText = value => (typeof value === 'string' ? value : undefined)
const permTime = value => (typeof value === 'number' && Number.isFinite(value) ? permWhen(value) : undefined)

// A level by the name the app shows for it. The host names only the stock levels; a preset of
// the person's own arrives as `custom`, with neither its key nor its label.
const PERM_LEVELS = new Set(['read-only', 'workspace-write', 'danger-full-access', 'auto'])
// `cli`: the coding CLI the row's Bot runs on (cliOfBot), where Full access reads "Auto".
function levelName(level, cli) {
  const value = permText(level?.value)
  if (value === undefined) return undefined
  return PERM_LEVELS.has(value) ? presetName(value, undefined, cli) : t('A custom level')
}

// The CLIs' own no-ask modes, the first one asked of them at Full access (acp-dsh modeFor).
const NO_ASK = new Set(['bypassPermissions', 'agent-full-access'])
/**
 * The mode a running CLI is in, when it was asked for its no-ask mode and the record says it is
 * in another one now. Only the record's own `current` counts, and only while the agent runs:
 * the mode asked for or chosen says nothing of where the CLI is, and neither does a stopped
 * agent's last run. Answers `{ mode }` or undefined; nothing is inferred.
 * @param {unknown} acp one row's `acp` (host/permission-diagnostics.js acpView)
 */
export function noAskMissed(acp) {
  if (acp === null || typeof acp !== 'object' || acp.active !== true) return undefined
  const modes = acp.modes
  if (modes === null || typeof modes !== 'object' || !Array.isArray(modes.wanted)) return undefined
  const asked = modes.wanted[0]
  if (typeof asked !== 'string' || !NO_ASK.has(asked)) return undefined
  const current = permText(modes.current)
  if (current === undefined || current === 'other' || NO_ASK.has(current)) return undefined
  return { mode: current }
}

function levelFacts(row, cli) {
  const out = []
  if (row.presets === false) out.push(t('Permissions are not available in this DeepSeek Harness'))
  const saved = levelName(row.saved, cli)
  if (saved !== undefined && PERM_SAVED[row.source]) out.push(t(PERM_SAVED[row.source], { level: saved }))
  else if (row.source === 'unknown') out.push(t('Saved level: not known now'))
  else if (row.presets !== false) out.push(t('No saved level: it uses the default of DeepSeek Harness'))
  if (row.presets !== false) {
    const effective = levelName(row.effective, cli)
    if (row.open !== true) out.push(t('Not open now'))
    else if (effective !== undefined) out.push(t('Running as: {level}', { level: effective }))
    else out.push(t('Running as: not known now'))
  }
  if (row.fallback === true) out.push(t('Runs as Workspace here'))
  // The host compared the two levels by their own keys: two custom ones may differ.
  else if (row.differs === true && row.open === true) out.push(t('The level in force here is not the saved one.'))
  const missed = levelName(row.unapplied?.level, cli)
  if (row.unapplied && typeof row.unapplied === 'object') {
    // No promise either way: whether the gate holds tools back depends on more than the mark.
    out.push(t('Not applied: {level} could not be set on this conversation ({time}). Tools may be held back here until it is.', { level: missed ?? t('the saved level'), time: permTime(row.unapplied.at) ?? '?' }))
  }
  // Told with the level: the CLI is not in the mode this level asks of it.
  const noAsk = cliAuto(row.effective?.value ?? row.saved?.value, cli) ? noAskMissed(row.acp) : undefined
  if (noAsk !== undefined) out.push(t('{cli} is in its mode "{mode}" here, not its no-ask mode.', { cli: cli.name, mode: noAsk.mode }))
  return out
}

const modeList = list => (Array.isArray(list) ? list.filter(item => typeof item === 'string' && item !== 'other') : [])

function agentFacts(acp) {
  if (acp === null || typeof acp !== 'object') return []
  const out = []
  const name = CLI_NAMES[acp.agent] ?? t('Another agent')
  out.push(acp.active === true ? name : t('{name}, not running now: this is from its last run', { name }))
  const modes = acp.modes
  if (modes && typeof modes === 'object') {
    const chosen = permText(modes.chosen)
    const current = permText(modes.current)
    if (chosen === undefined) out.push(t('The agent offers none of the modes asked for'))
    else if (current !== undefined && modes.applied === false) out.push(t('The agent is in its mode "{current}", not the one asked for, "{mode}"', { current, mode: chosen }))
    else if (current !== undefined && modes.applied === true) out.push(t('The agent is in its mode "{mode}"', { mode: current }))
    else out.push(t('Mode asked of the agent: "{mode}", not confirmed now', { mode: chosen }))
    // Only a mode the agent is in was taken: a switch it refused says nothing more.
    if (modes.fellToStrict === true && modes.applied === true && current !== undefined) out.push(t('It took its strictest mode, because the agent does not offer the wider ones'))
    const wanted = modeList(modes.wanted)
    const offered = modeList(modes.offered)
    if (wanted.length > 0) out.push(t('Modes asked for, in order: {list}', { list: wanted.join(', ') }))
    if (offered.length > 0) out.push(t('Modes the agent offers: {list}', { list: offered.join(', ') }))
  }
  const bridge = acp.bridge
  if (bridge && typeof bridge === 'object' && typeof bridge.on === 'boolean') {
    const state = !bridge.on ? 'Tools of DeepSeek Harness: off' : bridge.open === true ? 'Tools of DeepSeek Harness: on' : bridge.open === false ? 'Tools of DeepSeek Harness: on, but closed now' : 'Tools of DeepSeek Harness: on in its last run'
    out.push(PERM_WHY[bridge.why] ? `${t(state)} (${t(PERM_WHY[bridge.why])})` : t(state))
  }
  const call = acp.lastCall
  if (call && typeof call === 'object' && PERM_PATHS[call.path] && permTime(call.at)) out.push(t('Last action: {path} ({time})', { path: t(PERM_PATHS[call.path]), time: permTime(call.at) }))
  const reviewer = acp.reviewer
  if (reviewer && typeof reviewer === 'object' && PERM_REVIEWERS[reviewer.route] && permTime(reviewer.at)) {
    const who = t(PERM_REVIEWERS[reviewer.route])
    out.push(reviewer.ok === true
      ? t('Auto review asked {who} ({time})', { who, time: permTime(reviewer.at) })
      : t('Auto review asked {who}, which did not answer ({time})', { who, time: permTime(reviewer.at) }))
  }
  const review = acp.review
  if (review && typeof review === 'object' && PERM_REVIEWS[review.code] && permTime(review.at)) out.push(t('Last Auto review that did not pass: {why} ({time})', { why: t(PERM_REVIEWS[review.code]), time: permTime(review.at) }))
  return out
}

// The names come from the roster this window already holds: the host sends none.
function rowLabel(row, roster) {
  if (row.kind === 'other') return t('A conversation no Bot owns now')
  const bot = (roster?.bots ?? []).find(item => item.id === row.botId)?.name ?? t('A Bot')
  const group = row.roomId === undefined ? undefined : (roster?.rooms ?? []).find(item => item.id === row.roomId)?.name
  return [bot, group, row.kind === 'task' ? t('Task') : undefined].filter(Boolean).join(' · ')
}

/** The section's rows, or null for an answer this window does not know how to read. */
export function permissionRows(report, roster) {
  if (report === null || typeof report !== 'object' || report.version !== PERMISSION_ANSWER || !Array.isArray(report.sessions)) return null
  return report.sessions.flatMap((row) => {
    if (row === null || typeof row !== 'object' || !['chat', 'group', 'task', 'other'].includes(row.kind)) return []
    const cli = cliOfBot((roster?.bots ?? []).find(item => item.id === row.botId))
    return [{ label: rowLabel(row, roster), level: levelFacts(row, cli).join(' · '), agent: agentFacts(row.acp).join(' · ') }]
  })
}

export function PermissionDiagnostics({ actions, roster, Section, Row }) {
  const [report, setReport] = useState(null)
  useEffect(() => {
    let live = true
    // A read that failed is said on the page, not shown as nothing to tell.
    const failed = (error) => {
      quietly('diagnostics-permissions')(error)
      if (live) setReport({ version: PERMISSION_ANSWER, unavailable: true })
    }
    void Promise.resolve().then(() => actions.diagnosticsPermissions()).then((next) => { if (live) setReport(next) }, failed)
    return () => { live = false }
  }, [])
  if (report !== null && typeof report === 'object' && report.version === PERMISSION_ANSWER && report.unavailable === true) {
    return h(Section, { title: t('Permissions') }, h(Row, { label: t('This could not be read just now.') }))
  }
  const rows = permissionRows(report, roster)
  if (rows === null) return null
  const partial = report.partial === true
  return h(Section, { title: t('Permissions') },
    rows.length === 0
      ? partial
        ? h(Row, { label: t('This could not be read just now.') })
        : h(Row, { label: t('No Bot conversation is open.'), hint: t('The permission level of a conversation shows here while it is open.') })
      : rows.map((row, index) => h('div', { key: index, className: 'bt-set-row bt-fb-entry' },
          h('div', { className: 'bt-set-copy' },
            h('span', null, row.label),
            h('span', { className: 'bt-set-hint' }, row.level),
            row.agent ? h('span', { className: 'bt-set-hint' }, row.agent) : null))),
    report.more === true ? h(Row, { label: t('More conversations are open than fit here.') }) : null,
    partial && rows.length > 0 ? h(Row, { label: t('Some of this could not be read just now.') }) : null)
}
