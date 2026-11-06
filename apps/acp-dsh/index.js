// Automagik ACP for DeepSeek Harness: agents other than DSH's own, over the Agent Client
// Protocol, as DSH models (RFC 0003). A Session on one keeps DSH's history and sidebar; the
// agent's tool calls show as DSH tool cards and ask through DSH's approval dialog.
//
// Host only: no browser half, so nothing here can stop the web UI from loading. An agent is
// offered only when its CLI is on this computer and its setting is on; with none, no route is
// registered at all. The set follows the settings and the CLIs live: turning an agent on or
// off, a CLI installed after DSH started (found by the service's refresh), and an adapter
// install that lands all reach the model picker without a restart (`llm/adapters-updated`).
//
// The `acpAgents` service tells a settings page (the welcome's Connect AI and its Settings
// section) what each agent has: its CLI, its connector (the ACP adapter), its sign-in, and
// whether its model is in the picker. It writes nothing: the switches are this plugin's own
// live settings, written through DSH's settings service.
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { AcpAdapter, aside, SIDE_MODEL } from './src/host/adapter.js'
import { AGENTS, findCommand, signedInOf } from './src/host/agents.js'
import { Catalog, cliStamp, DEFAULT_MODEL } from './src/host/catalog.js'
import { AdapterStore, CHECK_EVERY_MS } from './src/host/install.js'

export const name = 'acp-dsh'
export const inject = ['llm', 'agents']

// claude, codex and sideModel are live (volatile): DSH's settings service writes them without remounting
// the plugin, and loader/volatile-update brings the change here.
export const Config = z.object({
  claude: z.boolean().default(true).volatile().description("Offer Claude Code as the acp-claude model when the claude CLI is installed. It keeps the person's own Claude Code settings: what their allow rules and hooks allow runs without DSH's approval dialog."),
  codex: z.boolean().default(true).volatile().description('Offer Codex as the acp-codex model when the codex CLI is installed.'),
  sideModel: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default({ ...SIDE_MODEL }).volatile().description("The model that writes a Session's title when the Session is on an agent and DSH's default model is an agent too. Never an agent."),
  fakeAgent: z.string().description('Tests only: a script that speaks ACP, served as the acp-fake model. The command comes from these host settings, never from a client route.'),
})

export const SERVICE = 'acpAgents'
const FIRST_CHECK_MS = 5000

// A live field is a reference ({ get() }) in the running fiber; a plain value elsewhere (tests).
export const flagOf = value => (typeof value?.get === 'function' ? value.get() : value)

// The Node that runs an adapter: the one running DSH (as Node when that is Electron's binary),
// never another node on the PATH, which may be too old for the adapter (Node 22 or newer).
export function nodeCommand() {
  return { command: process.execPath, env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} }
}

/**
 * @param {any} ctx
 * @param {{ claude?: any, codex?: any, sideModel?: any, fakeAgent?: string }} [config]
 * @param {{ store?: any, find?: typeof findCommand, signedIn?: typeof signedInOf, catalogHome?: string }} [deps]
 *   catalogHome: where each agent's models and efforts are kept (beside the adapters by default).
 */
export function apply(ctx, config = {}, { store = new AdapterStore({ log: message => info(ctx, message) }), find = name => findCommand(name), signedIn = signedInOf, catalogHome = store.home ? join(dirname(store.home), 'catalog') : undefined } = {}) {
  const agents = new Map()
  const log = message => info(ctx, message)
  if (config.fakeAgent) {
    const spawn = () => ({ command: process.execPath, args: [config.fakeAgent] })
    agents.set('acp-fake', {
      name: 'Fake agent',
      catalog: new Catalog({ id: 'acp-fake', name: 'Fake agent', defaultName: 'Fake agent', fallback: [{ id: DEFAULT_MODEL, name: 'Fake agent' }], key: () => config.fakeAgent, spawn, log }),
      spawn,
    })
  }
  const adapter = new AcpAdapter(ctx, agents)
  const clis = new Map()
  const signIns = new Map()
  let registration
  let disposed = false

  const enabled = spec => flagOf(config[spec.key]) !== false
  // The routes DSH serves follow `agents`; each change is published as llm/adapters-updated.
  const publish = () => {
    if (disposed) return
    const routes = [...agents.keys()]
    if (routes.length === 0) {
      registration?.()
      registration = undefined
    } else if (registration === undefined) {
      registration = ctx.llm.registerAdapter(routes, adapter) ?? (() => {})
    } else {
      registration.replace?.(routes)
    }
  }
  const install = (spec) => {
    const before = store.binOf(spec.adapter, spec.bin)?.version
    return store.update(spec.adapter, spec.bin).then(
      // A connector that landed (or moved up) is announced, so the picker lists its model now.
      () => { if (store.binOf(spec.adapter, spec.bin)?.version !== before && agents.has(idOf(spec))) publish() },
      error => { if (!disposed) warn(ctx, `${spec.adapter} not installed: ${error?.message ?? error}`) },
    )
  }
  const agentOf = (spec, cli, id = idOf(spec), node = nodeCommand()) => ({
    name: spec.name,
    modeFor: spec.modeFor,
    cli,
    // The agent's own models and efforts, read from the adapter release installed now.
    catalog: new Catalog({
      id,
      name: spec.name,
      defaultName: spec.defaultName,
      fallback: spec.fallback,
      home: catalogHome,
      log,
      key: () => {
        const bin = store.binOf(spec.adapter, spec.bin)
        return bin === undefined ? undefined : `${bin.path} ${cliStamp(cli)}`
      },
      spawn: () => ({ command: node.command, args: [store.binOf(spec.adapter, spec.bin).path], env: { ...node.env, ...spec.env(cli) } }),
    }),
    installed: () => store.binOf(spec.adapter, spec.bin) !== undefined,
    spawn: () => {
      const bin = store.binOf(spec.adapter, spec.bin)
      if (bin === undefined) {
        const failed = store.lastError?.(spec.adapter)
        void install(spec)
        throw new Error(failed
          ? `its ACP adapter (${spec.adapter}) is still being installed; the last install failed: ${failed}`
          : `its ACP adapter (${spec.adapter}) is still being installed; send this again in a minute`)
      }
      const node = nodeCommand()
      return { command: node.command, args: [bin.path], env: { ...node.env, ...spec.env(cli) } }
    },
  })

  // The agents that should be offered now: setting on and CLI here. `kick` installs the
  // connector of one that just became offered (at start, the first check waits a little).
  const reconcile = ({ kick = true } = {}) => {
    let changed = false
    const added = []
    for (const [id, spec] of Object.entries(AGENTS)) {
      const cli = find(spec.cli)
      clis.set(id, cli)
      const want = enabled(spec) && cli !== undefined
      const have = agents.get(id)
      if (want && have?.cli !== cli) {
        have?.catalog?.dispose()
        agents.set(id, agentOf(spec, cli))
        changed = true
        if (have === undefined) added.push(spec)
      } else if (!want && have !== undefined) {
        have.catalog?.dispose()
        agents.delete(id)
        changed = true
      }
    }
    if (changed) publish()
    if (kick) for (const spec of added) void install(spec)
    return added
  }

  const probe = async (id) => {
    const spec = AGENTS[id]
    const cli = clis.get(id)
    signIns.set(id, cli === undefined ? undefined : await signedIn(spec, cli).catch(() => undefined))
  }
  const probeAll = () => Promise.all(Object.keys(AGENTS).map(probe))

  // A path under the person's home is shown relative to it, as the Bot team's report row does.
  const shownPath = (path) => {
    if (typeof path !== 'string') return undefined
    const home = homedir()
    return path === home || path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path
  }

  // What one agent has, without spawning anything: the CLI search ran in the last reconcile,
  // the sign-in in the last refresh (a settings page refreshes when it opens).
  const statusOf = async (id) => {
    const spec = AGENTS[id]
    const cli = clis.get(id)
    const on = enabled(spec)
    const bin = cli === undefined ? undefined : store.binOf(spec.adapter, spec.bin)
    const busy = store.busy?.(spec.adapter) === true
    const failure = store.lastFailure?.(spec.adapter)
    const connector = !on ? 'off'
      : cli === undefined ? 'no-cli'
        : bin !== undefined ? 'ready'
          : busy || failure === undefined ? 'installing'
            : 'failed'
    // In the picker: DSH serves the route. Read from the registry, never the model list, which may
    // wait on a first read of the agent's models (catalog.js); a settings page must not.
    let listed = false
    if (connector === 'ready' && agents.has(id)) {
      try { listed = ctx.llm.listProviders?.().some(provider => provider.id === id) === true } catch {}
    }
    return {
      id,
      key: spec.key,
      name: spec.defaultName,
      on,
      cli: { found: cli !== undefined, installUrl: spec.installUrl },
      connector: {
        state: connector,
        ...(bin ? { version: bin.version } : {}),
        ...(connector === 'failed'
          ? {
            error: failure?.message,
            ...(failure?.diagnostic ? { diagnostic: failure.diagnostic } : {}),
            ...(failure?.logPath ? { logPath: shownPath(failure.logPath) } : {}),
          }
          : {}),
        ...(connector === 'ready' && busy ? { updating: true } : {}),
      },
      ...(signIns.get(id) === undefined ? {} : { signedIn: signIns.get(id) }),
      model: { provider: id, id: DEFAULT_MODEL, name: spec.defaultName, listed },
      // Ready but not in the picker: only a DSH that has not loaded this plugin's routes.
      restartNeeded: connector === 'ready' && !listed,
    }
  }
  const status = async () => ({ agents: await Promise.all(Object.keys(AGENTS).map(statusOf)) })

  const service = {
    settingsEntry: name,
    status,
    /** Looks for the CLIs again (one installed since DSH started) and asks each whether it is signed in. */
    async refresh() {
      reconcile()
      await probeAll()
      return status()
    },
    /** Starts the connector's install again after a failure; answers at once, while it runs. */
    async retry(id) {
      const spec = AGENTS[id]
      if (spec === undefined) throw new Error(`no ACP agent ${String(id).slice(0, 40)}`)
      reconcile({ kick: false })
      if (agents.has(id)) void install(spec)
      return status()
    },
  }

  reconcile({ kick: false })
  // The fake agent alone changes nothing reconcile counts.
  if (registration === undefined) publish()
  ctx.provide?.(SERVICE, service)
  ctx.on?.('llm/stream', aside(agents, ctx, () => flagOf(config.sideModel) ?? SIDE_MODEL))
  // A switch flipped in the settings: offer or withdraw the agent now, and install what it needs.
  ctx.on?.('loader/volatile-update', () => reconcile())
  // The newest adapter releases, at start and daily after; a Session already running keeps its own.
  const refresh = () => {
    for (const [id, spec] of Object.entries(AGENTS)) if (agents.has(id)) void install(spec)
  }
  const first = setTimeout(refresh, FIRST_CHECK_MS)
  const daily = setInterval(() => { reconcile({ kick: false }); refresh() }, CHECK_EVERY_MS)
  first.unref?.()
  daily.unref?.()
  // Cordis 4 has no 'dispose' event: an effect's cleanup is what runs when the plugin stops.
  ctx.effect?.(() => () => {
    disposed = true
    clearTimeout(first)
    clearInterval(daily)
    // A running adapter install would otherwise outlive DSH and keep writing into its home.
    store.dispose?.()
    adapter.dispose()
  })
}

const idOf = spec => Object.keys(AGENTS).find(id => AGENTS[id] === spec)

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
