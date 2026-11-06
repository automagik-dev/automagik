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
import { spawn } from 'node:child_process'
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { AcpAdapter, aside, BRIDGE_PATH, SIDE_MODEL } from './src/host/adapter.js'
import { AGENTS, findCommand, signedInOf } from './src/host/agents.js'
import { Backchannel } from './src/host/backchannel.js'
import { Catalog, cliStamp, DEFAULT_MODEL } from './src/host/catalog.js'
import { AdapterStore, CHECK_EVERY_MS } from './src/host/install.js'
import { CREDENTIAL_ENV, URL_ENV } from './src/host/names.js'
import { redactorFor } from './src/host/redact.js'
import { crossed } from './src/host/switch.js'

export const name = 'acp-dsh'
export const inject = ['llm', 'agents']

// The bridge, its DSH approval, the drift detector and live switching are on unless the person
// turns them off; the key is public (installed teams keep it in their profile patch). One source
// for the schema default and for a direct `apply` without a parsed Config.
export const DSH_TOOLS_DEFAULT = true

// claude, codex, sideModel and dshTools are live (volatile): DSH's settings service writes them
// without remounting the plugin, and loader/volatile-update brings the change here.
export const Config = z.object({
  claude: z.boolean().default(true).volatile().description("Offer Claude Code as the acp-claude model when the claude CLI is installed. It keeps the person's own Claude Code settings: what their allow rules and hooks allow runs without DSH's approval dialog."),
  codex: z.boolean().default(true).volatile().description('Offer Codex as the acp-codex model when the codex CLI is installed.'),
  sideModel: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default({ ...SIDE_MODEL }).volatile().description("The model that writes a Session's title when the Session is on an agent and DSH's default model is an agent too. Never an agent."),
  fakeAgent: z.string().description('Tests only: a script that speaks ACP, served as the acp-fake model. The command comes from these host settings, never from a client route.'),
  // On unless explicitly false: the bridge, its DSH approval, the drift detector and live
  // switching (RFC 0003, amendment, "Setting and order"). False is the kill switch and the
  // 2026-11-03 behaviour. Hidden from settings forms (`.hidden()`): it is a rollback lever, not
  // a preference, and stays writable through DSH's settings service and the profile patch.
  dshTools: z.boolean().default(DSH_TOOLS_DEFAULT).volatile().hidden().description([
    "Hand DSH's own tools to the agent over a per-session MCP bridge named dsh (the Session's",
    "preset, filtered by its level), approve every DSH tool call in DSH whatever the agent's own",
    "rules say, turn the agent's built-in tools off where its adapter allows, and carry the",
    'transcript when a Session moves between providers. On unless explicitly false; false is the',
    'kill switch and the behaviour without it: each agent keeps its own tools and its own',
    'approvals.',
  ].join(' ')),
})

export const SERVICE = 'acpAgents'
const FIRST_CHECK_MS = 5000
// A failed probe is retried after this long in the same process; a new process starts with an
// empty cache, so the next app start also retries. A success is kept for its adapter version.
export const PROBE_RETRY_MS = 10 * 60 * 1000

// A live field is a reference ({ get() }) in the running fiber; a plain value elsewhere (tests).
export const flagOf = value => (typeof value?.get === 'function' ? value.get() : value)

// `dshTools` with the schema default applied: absent means on, and only an explicit false (a
// plain false or a live reference reading false) is the kill switch.
export const dshToolsOn = (value) => {
  const read = flagOf(value)
  return (read === undefined ? DSH_TOOLS_DEFAULT : read) === true
}

// The Node that runs an adapter: the one running DSH (as Node when that is Electron's binary),
// never another node on the PATH, which may be too old for the adapter (Node 22 or newer).
export function nodeCommand() {
  return { command: process.execPath, env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} }
}

/**
 * @param {any} ctx
 * @param {{ claude?: any, codex?: any, sideModel?: any, fakeAgent?: string, dshTools?: any }}
 *   [config]
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
      // Tests only: keep a test of the missing-bridge failure from waiting the real grace period.
      ...(Number(process.env.ACP_BRIDGE_READY_MS) > 0 ? { bridgeReadyMs: Number(process.env.ACP_BRIDGE_READY_MS) } : {}),
      catalog: new Catalog({ id: 'acp-fake', name: 'Fake agent', defaultName: 'Fake agent', fallback: [{ id: DEFAULT_MODEL, name: 'Fake agent' }], key: () => config.fakeAgent, spawn, log }),
      spawn,
    })
  }
  const backchannel = new Backchannel({ ctx, log })
  const redact = redactorFor(ctx)
  const adapter = new AcpAdapter(ctx, agents, {
    dshTools: () => dshToolsOn(config.dshTools),
    backchannel,
    redactor: redact,
  })
  // The kill switch is live: any change of `dshTools` ends the agent sessions and revokes their
  // bridges, so a credential minted while it was on cannot keep calling DSH tools and a Session
  // started with the bridge never runs on the old tool set. The next turn starts afresh.
  let toolsOn = dshToolsOn(config.dshTools)
  const syncTools = () => {
    const next = dshToolsOn(config.dshTools)
    if (toolsOn !== next) adapter.endSessions()
    toolsOn = next
  }
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
      // The store's short message is already redacted and home-relative; the raw installer
      // error is not, so it never reaches the host log.
      () => { if (!disposed) warn(ctx, `${spec.adapter} not installed: ${store.lastError?.(spec.adapter) ?? 'the install failed'}`) },
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

  // A real probe of this machine's bridge, run once per installed adapter version and cached:
  // a fresh per-session credential, the bridge process over stdio, MCP `initialize`, then
  // `tools/list`. A missing adapter, a bridge that does not answer, or an empty list fails
  // closed, so the Bot team never moves a Bot onto a route whose bridge cannot work.
  const bridgeProbes = new Map()
  let probeSequence = 0
  function bridgeList(record) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BRIDGE_PATH], {
        env: {
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          [CREDENTIAL_ENV]: record.credential,
          [URL_ENV]: backchannel.urlFor(record),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stdin.on('error', () => {})
      let buffer = ''
      let sequence = 0
      let settled = false
      const pending = new Map()
      const finish = (error, tools) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { child.stdin.end() } catch {}
        try { child.kill('SIGTERM') } catch {}
        if (error === undefined) resolve(tools)
        else reject(error)
      }
      const timer = setTimeout(() => finish(new Error('the bridge did not answer in time')), 5000)
      timer.unref?.()
      child.on('error', error => finish(error))
      child.on('exit', code => finish(new Error(`the bridge exited with ${code}`)))
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim() === '') continue
          let message
          try { message = JSON.parse(line) } catch { continue }
          const waiter = pending.get(message.id)
          if (waiter === undefined) continue
          pending.delete(message.id)
          if (message.error !== undefined) waiter.reject(new Error(message.error.message))
          else waiter.resolve(message.result)
        }
      })
      const request = (method, params) => new Promise((res, rej) => {
        const id = ++sequence
        pending.set(id, { resolve: res, reject: rej })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
      request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acp-dsh-probe', version: '1' } })
        .then(() => request('tools/list', {}))
        .then(list => finish(undefined, Array.isArray(list?.tools) ? list.tools : []), error => finish(error))
    })
  }

  async function probeBridge() {
    await backchannel.listen()
    const sessionId = `acp-dsh-probe-${process.pid}-${++probeSequence}`
    // The bridge asks the back-channel for the Session's offered tools; a real DSH tools
    // service answers. No Session is started and no agent prompt is sent.
    const agent = { session: { id: sessionId, snapshotEvents: () => [] } }
    const record = backchannel.mint({ sessionId, agent, name: 'acp-dsh probe' })
    try {
      return (await bridgeList(record)).length > 0
    } finally {
      backchannel.revoke(record)
    }
  }

  async function bridgeStatus() {
    if (disposed) return { on: false, probesPass: false }
    const on = dshToolsOn(config.dshTools)
    if (!on) return { on: false, probesPass: false }
    const spec = AGENTS['acp-claude']
    const bin = store.binOf(spec.adapter, spec.bin)
    if (bin === undefined) return { on: true, probesPass: false }
    const key = `${bin.path}\u0000${bin.version ?? ''}`
    const cached = bridgeProbes.get(key)
    // A success is kept for its adapter version. A running probe is shared; a failure is kept
    // only until its backoff ends, so one transient start never blocks the move forever.
    if (cached?.ok === true) return { on: true, probesPass: true }
    if (cached !== undefined && cached.ok === undefined) return { on: true, probesPass: await cached.promise }
    if (cached?.ok === false && Date.now() - cached.at < PROBE_RETRY_MS) return { on: true, probesPass: false }
    const entry = { at: Date.now(), ok: undefined, promise: undefined }
    entry.promise = probeBridge().then(
      (ok) => {
        entry.ok = ok === true
        entry.at = Date.now()
        return entry.ok
      },
      () => {
        entry.ok = false
        entry.at = Date.now()
        return false
      },
    )
    bridgeProbes.set(key, entry)
    return { on: true, probesPass: await entry.promise }
  }

  const service = {
    settingsEntry: name,
    status,
    /**
     * What the Bot team gates its one-time Claude move on: whether DSH's tools reach an agent
     * here (`dshTools`), and whether this machine's bridge really answers `initialize` and
     * `tools/list` for a freshly minted per-session credential. The answer is cached per
     * installed adapter version; off, a missing adapter, or a failed probe says no.
     */
    async bridge() {
      return bridgeStatus()
    },
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
  ctx.on?.('llm/stream', aside(agents, ctx, () => flagOf(config.sideModel) ?? SIDE_MODEL, redact))
  // The other crossing: a transcript that carries an agent's turn is redacted before it is
  // handed back to a native provider. Live switching's rule, so it follows `dshTools`.
  const crossing = crossed(agents, ctx, redact, () => dshToolsOn(config.dshTools))
  ctx.on?.('llm/stream', crossing)
  // A switch flipped in the settings: offer or withdraw the agent now, and install what it needs.
  ctx.on?.('loader/volatile-update', () => { syncTools(); reconcile() })
  // A model selection that moves a Session off its agent: its boundary row, and the agent
  // session (and bridge) belonging to the old route ends (RFC 0003, amendment, "Live switching").
  ctx.on?.('session/event', (session, event) => adapter.noteEvent(session, event))
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
    backchannel.dispose()
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
