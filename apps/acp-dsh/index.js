// Automagik ACP for DeepSeek Harness: agents other than DSH's own, over the Agent Client
// Protocol, as DSH models (RFC 0003). A Session on one keeps DSH's history and sidebar; the
// agent's tool calls show as DSH tool cards and ask through DSH's approval dialog.
//
// Host only: no browser half, so nothing here can stop the web UI from loading. An agent is
// offered only when its CLI is on this computer; with none, no route is registered at all.
import z from '@deepseek-ai/schemastery'
import { AcpAdapter, aside } from './src/host/adapter.js'
import { AGENTS, findCommand } from './src/host/agents.js'
import { AdapterStore, CHECK_EVERY_MS } from './src/host/install.js'

export const name = 'acp-dsh'
export const inject = ['llm', 'agents']

export const Config = z.object({
  claude: z.boolean().default(true).description('Offer Claude Code as the acp-claude model when the claude CLI is installed.'),
  codex: z.boolean().default(true).description('Offer Codex as the acp-codex model when the codex CLI is installed.'),
  fakeAgent: z.string().description('Tests only: a script that speaks ACP, served as the acp-fake model. The command comes from these host settings, never from a client route.'),
})

const FIRST_CHECK_MS = 5000

// The Node that runs an adapter: the one on DSH's PATH (the desktop app puts its own there),
// else the one running DSH, as Node when that is Electron's binary.
function nodeCommand(env = process.env) {
  const node = findCommand('node', { env })
  if (node) return { command: node, env: {} }
  return { command: process.execPath, env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} }
}

export function apply(ctx, config = {}, { store = new AdapterStore({ log: message => info(ctx, message) }) } = {}) {
  const agents = new Map()
  if (config.fakeAgent) {
    agents.set('acp-fake', {
      name: 'Fake agent',
      model: { id: 'fake', name: 'Fake agent' },
      spawn: () => ({ command: process.execPath, args: [config.fakeAgent] }),
    })
  }
  const real = []
  for (const [id, spec] of Object.entries(AGENTS)) {
    if (config[spec.key] === false) continue
    const cli = findCommand(spec.cli)
    if (cli === undefined) continue
    real.push(spec)
    agents.set(id, {
      name: spec.name,
      model: spec.model,
      modeFor: spec.modeFor,
      spawn: () => {
        const bin = store.binOf(spec.adapter, spec.bin)
        if (bin === undefined) {
          store.update(spec.adapter, spec.bin).catch(error => warn(ctx, `${spec.adapter} not installed: ${error?.message ?? error}`))
          throw new Error(`its ACP adapter (${spec.adapter}) is still being installed; send this again in a minute`)
        }
        const node = nodeCommand()
        return { command: node.command, args: [bin.path], env: { ...node.env, ...spec.env(cli) } }
      },
    })
  }
  if (agents.size === 0) return
  const adapter = new AcpAdapter(ctx, agents)
  ctx.llm.registerAdapter([...agents.keys()], adapter)
  ctx.on?.('llm/stream', aside(agents))
  // The newest adapter releases, at start and daily after; a Session already running keeps its own.
  const refresh = () => {
    for (const spec of real) store.update(spec.adapter, spec.bin).catch(error => warn(ctx, `${spec.adapter} update failed: ${error?.message ?? error}`))
  }
  const first = real.length > 0 ? setTimeout(refresh, FIRST_CHECK_MS) : undefined
  const daily = real.length > 0 ? setInterval(refresh, CHECK_EVERY_MS) : undefined
  first?.unref?.()
  daily?.unref?.()
  ctx.on?.('dispose', () => {
    clearTimeout(first)
    clearInterval(daily)
    adapter.dispose()
  })
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`acp-dsh: ${message}`)
  } catch {}
}

function info(ctx, message) {
  try {
    ctx.logger?.info?.(`acp-dsh: ${message}`)
  } catch {}
}
