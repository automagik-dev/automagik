// Claude Code and Codex as DSH models, through @automagik/acp-dsh: what each has (its CLI,
// its connector, its sign-in, its model in the picker), read from acp-dsh's `acpAgents`
// service, and its switch, which is acp-dsh's own live setting (`claude`, `codex`) in its
// settings entry. Without acp-dsh every answer is { available: false } and the page shows
// nothing of it.
//
//   acp { refresh? }        the agents; `refresh` looks for the CLIs again and asks each
//                           whether it is signed in (the page does this when it opens)
//   acp-switch { id, on }   turns an agent on or off in acp-dsh's settings
//   acp-retry { id }        starts a failed connector install again
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { z } from 'zod'
import { parse } from './payloads.js'

export const ACP_SERVICE = 'acpAgents'
export const ACP_ENTRY = 'acp-dsh'
export const ACP_IDS = ['acp-claude', 'acp-codex']

const AgentId = z.enum(ACP_IDS)
const RefreshPayload = z.object({ refresh: z.boolean().optional() })
const SwitchPayload = z.object({ id: AgentId, on: z.boolean() })
const RetryPayload = z.object({ id: AgentId })

const failure = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => failure('omni-ai/invalid', message)
const refused = message => failure('omni-ai/refused', message)

// Only the fields the page draws: a newer acp-dsh may say more.
import { redactText } from './redact.js'

// A path under the person's home is shown relative to it, never as an absolute home path.
const shownText = (text) => {
  let out = String(text ?? '')
  const home = homedir()
  if (home.length > 1) {
    out = out.split(home).join('~')
    const slashes = home.replace(/\\/g, '/')
    if (slashes !== home) out = out.split(slashes).join('~')
  }
  return out
}
const shownPath = (path) => {
  if (typeof path !== 'string') return undefined
  const home = homedir()
  return path === home || path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
}

export function agentView(agent) {
  return {
    id: agent.id,
    key: agent.key,
    name: agent.name,
    on: agent.on === true,
    cli: {
      found: agent.cli?.found === true,
      ...(typeof agent.cli?.installUrl === 'string' && agent.cli.installUrl.startsWith('https://') ? { installUrl: agent.cli.installUrl } : {}),
      ...(['installing', 'failed', 'ready'].includes(agent.cli?.state) ? { state: agent.cli.state } : {}),
      ...(typeof agent.cli?.managed === 'boolean' ? { managed: agent.cli.managed } : {}),
      ...(typeof agent.cli?.updating === 'boolean' ? { updating: agent.cli.updating } : {}),
      ...(typeof agent.cli?.version === 'string' ? { version: agent.cli.version } : {}),
      ...(typeof agent.cli?.error === 'string' ? { error: shownText(redactText(agent.cli.error)).slice(0, 300) } : {}),
      ...(typeof agent.cli?.diagnostic === 'string' ? { diagnostic: shownText(redactText(agent.cli.diagnostic)).slice(0, 4000) } : {}),
      ...(typeof agent.cli?.logPath === 'string' ? { logPath: shownPath(agent.cli.logPath) } : {}),
    },
    connector: {
      state: ['off', 'no-cli', 'installing', 'failed', 'ready'].includes(agent.connector?.state) ? agent.connector.state : 'installing',
      ...(typeof agent.connector?.version === 'string' ? { version: agent.connector.version } : {}),
      ...(typeof agent.connector?.error === 'string' ? { error: shownText(redactText(agent.connector.error)).slice(0, 300) } : {}),
      // The installer's own output and where it was written, for a failed connector.
      ...(typeof agent.connector?.diagnostic === 'string' ? { diagnostic: shownText(redactText(agent.connector.diagnostic)).slice(0, 4000) } : {}),
      ...(typeof agent.connector?.logPath === 'string' ? { logPath: shownPath(agent.connector.logPath) } : {}),
    },
    ...(typeof agent.signedIn === 'boolean' ? { signedIn: agent.signedIn } : {}),
    listed: agent.model?.listed === true,
    restartNeeded: agent.restartNeeded === true,
  }
}

export function createAcpActions(ctx) {
  const service = () => {
    try {
      const found = ctx.get?.(ACP_SERVICE)
      return typeof found?.status === 'function' ? found : undefined
    } catch {
      return undefined
    }
  }
  const view = async (ask) => {
    const acp = service()
    if (acp === undefined) return { available: false, agents: [] }
    const status = await ask(acp)
    return { available: true, agents: (status?.agents ?? []).filter(agent => ACP_IDS.includes(agent?.id)).map(agentView) }
  }

  return {
    acp: (payload) => {
      const { refresh } = parse(RefreshPayload, payload ?? {}) ?? {}
      return view(acp => (refresh === true && typeof acp.refresh === 'function' ? acp.refresh() : acp.status()))
    },
    'acp-switch': async (payload) => {
      const asked = parse(SwitchPayload, payload)
      if (asked === undefined) throw invalid('Say which agent, and on or off.')
      const acp = service()
      if (acp === undefined) throw refused('The ACP agents plugin is not running in this DSH.')
      const agent = (await acp.status()).agents.find(row => row.id === asked.id)
      // The settings entry acp-dsh says is its own; an older acp-dsh does not say.
      const ns = typeof acp.settingsEntry === 'string' && acp.settingsEntry !== '' ? acp.settingsEntry : ACP_ENTRY
      const entry = ctx.settings.describe().find(row => row.ns === ns)
      if (agent === undefined || entry === undefined) throw refused('This DSH cannot change the ACP agents\' settings.')
      try {
        await ctx.settings.update(ns, { [agent.key]: asked.on }, entry.revision)
      } catch (error) {
        if (error?.code === 'SETTINGS_CONFLICT') throw refused('The ACP agents\' settings changed while saving. Try again.')
        throw refused(`DSH did not save the switch: ${error?.message ?? error}`)
      }
      // Turning one on looks for its CLI and its sign-in at once.
      return view(next => (asked.on && typeof next.refresh === 'function' ? next.refresh() : next.status()))
    },
    'acp-retry': async (payload) => {
      const asked = parse(RetryPayload, payload)
      if (asked === undefined) throw invalid('Say which agent.')
      const acp = service()
      if (acp === undefined) throw refused('The ACP agents plugin is not running in this DSH.')
      return view(next => next.retry(asked.id))
    },
  }
}
