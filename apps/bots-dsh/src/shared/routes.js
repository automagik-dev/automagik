// A model's route (RFC 0003): the Harness that runs the loop, and what it is Connected by.
// Both ids are a public contract. The route is computed from the provider id and never stored
// in place of a Session's model reference, so every existing Session and Bot keeps its model.
//
//   connectedBy  native              DSH's own provider, signed in with a key or DSH's sign-in
//                pi-ai               a plan through pi-ai: DSH's llm-pi-ai routes, dsh-subscriptions
//                claude-code-plugin  the Claude Code plugin (dsh-oh-my-claude): claude-code, claude-code-<box>
//                acp                 an agent over ACP, through @automagik/acp-dsh: acp-<agent>
//   harness      dsh, claude-code, codex, gemini (and herdr later, RFC 0006)
// The Claude Code plugin is retired (3.56), but Sessions and Bots stored on its ids still name them.
const isClaudeCode = provider => provider === 'claude-code' || provider.startsWith('claude-code-')

/**
 * Whether a provider is one of the two coding CLIs' routes, Claude Code's and Codex's over ACP.
 * Named one by one: another agent over ACP (acp-gemini, a test's acp-fake) is not one.
 */
const CODING_CLIS = Object.freeze(['acp-claude', 'acp-codex'])
export const cliRoute = provider => CODING_CLIS.includes(provider)
/** Whether a move from `from` to `to` leaves a coding CLI for another provider; another model of the same CLI does not. */
export const leavesCli = (from, to) => cliRoute(from?.provider) && to?.provider !== from.provider

export const CONNECTED_BY = Object.freeze(['native', 'pi-ai', 'claude-code-plugin', 'acp'])
export const HARNESSES = Object.freeze(['dsh', 'claude-code', 'codex', 'gemini'])

// The settings namespace DSH's pi-ai adapter (dsh-llm-pi-ai) declares its routes under.
export const PI_AI_NS = 'llm-pi-ai'
// dsh-subscriptions registers its plans straight on the adapter registry, with no directory
// entry: its own route ids (adapter-manager.js, 0.7.21). It no longer ships `codex` or `claude`
// (0.7.21-omni.1's BUILTIN_PROVIDERS): ChatGPT and Claude plans run on their CLIs (acp-codex,
// acp-claude), so an id of those is not a plan route here.
export const SUBSCRIPTION_ROUTES = Object.freeze(['grok', 'antigravity'])

// The agent an ACP route runs, and the harness that agent is. ACP ids never start with
// claude-code: those are the Claude Code plugin's.
const ACP_HARNESS = Object.freeze({ claude: 'claude-code', codex: 'codex', gemini: 'gemini' })

// The providers pi-ai connects, from DSH's configurable-provider directory: what a caller
// passes as `piAi` to routeOf.
export const piAiRoutes = directory => new Set([
  ...SUBSCRIPTION_ROUTES,
  ...(directory ?? []).filter(entry => entry?.settingsNs === PI_AI_NS).map(entry => entry.provider),
])

/**
 * The route of a provider id: `{ harness, connectedBy }`. A provider this cannot place is
 * DSH's own (`native` on `dsh`).
 * @param {string} provider
 * @param {{ piAi?: Set<string> }} [known] the providers pi-ai connects (piAiRoutes)
 */
export function routeOf(provider, { piAi = new Set(SUBSCRIPTION_ROUTES) } = {}) {
  const id = String(provider ?? '')
  if (isClaudeCode(id)) return { harness: 'claude-code', connectedBy: 'claude-code-plugin' }
  if (id.startsWith('acp-')) return { harness: ACP_HARNESS[id.slice(4)] ?? id.slice(4), connectedBy: 'acp' }
  if (piAi.has(id)) return { harness: 'dsh', connectedBy: 'pi-ai' }
  return { harness: 'dsh', connectedBy: 'native' }
}
