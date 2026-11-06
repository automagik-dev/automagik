import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { t } from './i18n.js'

// Claude Code and Codex as DSH models (@automagik/acp-dsh), set up from the page: whether the
// CLI is on this computer (with its install link when it is not), the connector acp-dsh
// installs in the background, the CLI's own sign-in, and a switch that is acp-dsh's own
// claude/codex setting. Drawn in Connect AI and in Settings (the acp-agents section); without
// acp-dsh the host answers { available: false }: Connect AI draws nothing, Settings says so.

export const CLI_OF = { 'acp-claude': 'claude', 'acp-codex': 'codex' }
export const LOGO_OF = { 'acp-claude': 'CC', 'acp-codex': 'CX' }
// How the person signs in to the CLI, in a terminal: the page never sees their credentials.
export const SIGN_IN_OF = { 'acp-claude': 'claude auth login', 'acp-codex': 'codex login' }
export const POLL_MS = 2000
export const SETTINGS_SECTION = 'acp-agents'

// The chip beside the name: the one word that says where the agent stands.
export function badgeOf(agent) {
  if (!agent.cli.found) return t('Not installed')
  if (!agent.on) return t('Off')
  const state = agent.connector.state
  if (state === 'installing') return t('Setting up')
  if (state === 'failed') return t('Needs a retry')
  if (state === 'ready') return agent.restartNeeded ? t('Restart needed') : t('Ready')
  return null
}

/**
 * What the row says under its name, line by line: the CLI, the connector, the sign-in, and
 * where to find the model. Each line: { tone: ok|wait|bad|muted, text, link?, action? }, an
 * action being 'check' (look again) or 'retry' (the connector's install).
 */
export function agentLines(agent) {
  const name = agent.name
  const cli = CLI_OF[agent.id] ?? agent.key
  const lines = []
  if (!agent.cli.found) {
    lines.push({ tone: 'muted', text: t('The {cli} CLI is not on this computer. Install it, sign in, then check again.', { cli }), ...(agent.cli.installUrl ? { link: { href: agent.cli.installUrl, text: t('Install {name}', { name }) } } : {}), action: 'check' })
    return lines
  }
  lines.push({ tone: 'ok', text: t('Found the {cli} CLI on this computer.', { cli }) })
  if (agent.signedIn === true) lines.push({ tone: 'ok', text: t('Signed in to {name}.', { name }) })
  if (agent.signedIn === false) lines.push({ tone: 'bad', text: t('Not signed in. Run {command} in a terminal, then check again.', { command: SIGN_IN_OF[agent.id] ?? cli }), action: 'check' })
  if (!agent.on) {
    lines.push({ tone: 'muted', text: t('Off. Turn it on to use {name} as a model in DSH.', { name }) })
    return lines
  }
  const { state, version, error, diagnostic, logPath } = agent.connector
  if (state === 'installing') lines.push({ tone: 'wait', text: t('Installing its connector in the background. This takes a minute or two.') })
  if (state === 'failed') {
    lines.push({
      tone: 'bad',
      text: error ? t('The connector did not install: {error}', { error }) : t('The connector did not install.'),
      action: 'retry',
      // What DSH 0.2.2 shows for a failed plugin install: the full diagnostic and its log file.
      ...(diagnostic ? { details: { diagnostic, ...(logPath ? { logPath } : {}) } } : {}),
    })
  }
  if (state === 'ready') {
    lines.push({ tone: 'ok', text: version ? t('Connector ready (version {version}).', { version }) : t('Connector ready.') })
    lines.push(agent.restartNeeded
      ? { tone: 'bad', text: t('Restart DSH to see {name} in the model picker.', { name }) }
      : { tone: 'ok', text: t('Ready: pick {name} in the model picker.', { name }), ready: true })
  }
  return lines
}

// The agents' state from the host, refreshed (CLI search, sign-in) when the page opens and
// polled while a connector installs or a switch has not settled yet.
export function useAcp(request = call) {
  const [view, setView] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problems, setProblems] = useState({})
  const [wanted, setWanted] = useState({})
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const show = useCallback((next) => {
    if (!live.current) return
    setView(next ?? { available: false, agents: [] })
    setWanted(previous => Object.fromEntries(Object.entries(previous).filter(([id, on]) => next?.agents?.find(agent => agent.id === id)?.on !== on)))
  }, [])
  const load = useCallback(async (refresh) => {
    try {
      show(await request('acp', refresh ? { refresh: true } : null))
    } catch {
      // No acp-dsh, or a DSH that does not answer: nothing to draw.
      if (live.current) setView(previous => previous ?? { available: false, agents: [] })
    }
  }, [request, show])
  useEffect(() => { void load(true) }, [load])

  const settling = view?.agents?.some(agent => (agent.on && agent.cli.found && agent.connector.state === 'installing') || (wanted[agent.id] !== undefined && wanted[agent.id] !== agent.on)) === true
  useEffect(() => {
    if (!settling) return undefined
    const timer = setInterval(() => { void load(false) }, POLL_MS)
    return () => clearInterval(timer)
  }, [settling, load])

  const say = (id, message) => setProblems(previous => ({ ...previous, [id]: message }))
  // Whether the host took it; a refusal leaves its words on the row.
  const act = async (id, endpoint, payload) => {
    say(id, null)
    setBusy(id)
    let ok = true
    try {
      show(await request(endpoint, payload))
    } catch (error) {
      ok = false
      say(id, error.message)
    }
    if (live.current) setBusy(null)
    return ok
  }
  return {
    view,
    busy,
    problems,
    isOn: agent => wanted[agent.id] ?? agent.on,
    flip: async (agent) => {
      const on = !(wanted[agent.id] ?? agent.on)
      setWanted(previous => ({ ...previous, [agent.id]: on }))
      // Refused: the switch goes back to what acp-dsh has, and nothing waits for it to settle.
      if (!(await act(agent.id, 'acp-switch', { id: agent.id, on })) && live.current) {
        setWanted(previous => (previous[agent.id] === on ? Object.fromEntries(Object.entries(previous).filter(([id]) => id !== agent.id)) : previous))
      }
    },
    retry: agent => act(agent.id, 'acp-retry', { id: agent.id }),
    check: agent => act(agent.id, 'acp', { refresh: true }),
  }
}

function Line({ line, agent, acp, busy }) {
  return h('div', { className: 'oai-acp-line-block' },
    h('p', { className: `oai-acp-line oai-acp-${line.tone}${line.tone === 'wait' ? ' oai-waiting' : ''}`, ...(line.tone === 'bad' ? { role: 'status' } : {}) },
      line.text,
      line.link ? [' ', h('a', { key: 'link', className: 'oai-link', href: line.link.href, target: '_blank', rel: 'noreferrer' }, line.link.text)] : null,
      line.action === 'retry' ? h('button', { type: 'button', className: 'oai-ghost oai-acp-act', disabled: busy, onClick: () => acp.retry(agent) }, t('Retry')) : null,
      line.action === 'check' ? h('button', { type: 'button', className: 'oai-ghost oai-acp-act', disabled: busy, onClick: () => acp.check(agent) }, t('Check again')) : null),
    line.details ? h('details', { className: 'oai-acp-details' },
      h('summary', null, t('Install details')),
      h('pre', { className: 'oai-acp-diagnostic' }, line.details.diagnostic),
      line.details.logPath ? h('p', { className: 'oai-acp-log' }, t('Log: {path}', { path: line.details.logPath })) : null) : null)
}

export function AcpAgentRow({ agent, acp }) {
  const on = acp.isOn(agent)
  const busy = acp.busy !== null
  const badge = badgeOf({ ...agent, on })
  const lines = agentLines(agent)
  return h('div', { className: `oai-ai oai-acp${on ? ' oai-ai-on' : ''}`, 'data-acp': agent.id, 'data-state': agent.cli.found ? (agent.on ? agent.connector.state : 'off') : 'no-cli' },
    h('div', { className: 'oai-ai-row' },
      h('div', { className: 'oai-logo', 'aria-hidden': true }, LOGO_OF[agent.id] ?? agent.name.slice(0, 1)),
      h('div', { className: 'oai-ai-what' },
        h('strong', null, agent.name),
        h('span', null, t('Your own {cli} CLI, as a model in DSH', { cli: CLI_OF[agent.id] ?? agent.key }))),
      badge ? h('em', { className: 'oai-found' }, badge) : null,
      h('button', { type: 'button', role: 'switch', className: 'oai-switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': agent.name, disabled: busy, onClick: () => acp.flip(agent) })),
    h('div', { className: 'oai-acp-lines' }, lines.map((line, i) => h(Line, { key: i, line, agent, acp, busy }))),
    acp.problems[agent.id] ? h('p', { className: 'oai-error oai-ai-problem', role: 'alert' }, acp.problems[agent.id]) : null)
}

/** The agents' list, or nothing while loading or without acp-dsh. */
export function AcpAgents({ acp, heading = true }) {
  if (acp.view?.available !== true || acp.view.agents.length === 0) return null
  return h('section', { className: 'oai-group oai-acp-group', 'aria-label': t('Coding agents') },
    heading ? h('h2', null, t('Coding agents')) : null,
    heading ? h('p', { className: 'oai-muted oai-acp-intro' }, t('Claude Code and Codex run on this computer with your own sign-in, and show up in DSH\'s model picker.')) : null,
    h('div', { className: 'oai-list' }, acp.view.agents.map(agent => h(AcpAgentRow, { key: agent.id, agent, acp }))))
}

/** Settings → Claude Code and Codex: the same rows, after onboarding. */
export function AcpSettingsSection() {
  const acp = useAcp()
  return h('div', { className: 'oai-acp-page' },
    h('div', { className: 'oai-card' },
      h('h1', null, t('Claude Code and Codex')),
      h('p', null, t('Use the coding agents you already have as models in DSH. Each runs your own CLI, with your own sign-in and settings.')),
      acp.view === null ? h('p', { className: 'oai-muted oai-waiting' }, t('Looking at what this computer has…'))
        : acp.view.available ? h(AcpAgents, { acp, heading: false })
          : h('p', { className: 'oai-muted' }, t('The ACP agents plugin is not running in this DSH.'))))
}

// Settings → Claude Code and Codex, after onboarding too: DSH's settings and the
// Bot team's both list it. Always there, so an acp-dsh turned on after the page loaded has its
// page without a reload; without acp-dsh the page says the plugin is not running.
export function installAcpSection(ctx) {
  return ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: SETTINGS_SECTION, order: 30, label: () => t('Claude Code and Codex') }, AcpSettingsSection)) ?? (() => {})
}

export const ACP_CSS = `
.oai-acp-line-block{display:grid;gap:4px}
.oai-acp-details{font-size:12.5px;color:var(--oai-ink2)}
.oai-acp-details summary{cursor:pointer}
.oai-acp-diagnostic{max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:color-mix(in srgb,var(--oai-ink) 6%,transparent);border-radius:8px;padding:8px;font-size:11.5px}
.oai-acp-log{margin:0;font-size:12px;overflow-wrap:anywhere}
.oai-acp-page{padding:8px 0;font-family:var(--oai-font);color:var(--oai-ink)}
.oai-acp-page .oai-card{max-width:680px}
.oai-acp-group .oai-acp-intro{margin:0 0 8px!important}
.oai-acp-lines{padding:0 14px 12px 60px;display:grid;gap:4px}
.oai-card p.oai-acp-line{margin:0;font-size:13px;line-height:1.45;color:var(--oai-ink2)}
.oai-card p.oai-acp-ok::before{content:"✓ ";color:var(--oai-ok);font-weight:700}
.oai-card p.oai-acp-bad{color:var(--oai-bad)}
.oai-card button.oai-acp-act{display:inline-block;width:auto;min-height:0;margin:0 0 0 8px;padding:4px 10px;font-size:12.5px;vertical-align:baseline}
.oai-acp .oai-found{background:color-mix(in srgb,var(--oai-lilac) 70%,var(--oai-card));color:var(--oai-lilac-ink)}
.oai-acp[data-state="ready"] .oai-found{background:color-mix(in srgb,var(--oai-cyan) 45%,var(--oai-card));color:var(--oai-cyan-ink)}
.oai-acp[data-state="failed"] .oai-found{background:color-mix(in srgb,var(--oai-bad) 22%,var(--oai-card));color:var(--oai-bad)}
@media (max-width:520px){.oai-acp-lines{padding-left:14px}}
`
