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
// whether its model is in the picker. Provisioning keeps its own CLI store; switches remain
// this plugin's live settings, written through DSH's settings service.
import { spawn } from 'node:child_process'
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { AcpAdapter, aside, BRIDGE_PATH, SIDE_MODEL } from './src/host/adapter.js'
import { AGENTS, findCommand, signedInOf } from './src/host/agents.js'
import { Backchannel } from './src/host/backchannel.js'
import { Catalog, cliStamp, DEFAULT_MODEL } from './src/host/catalog.js'
import { CliStore, CLI_CHECK_EVERY_MS } from './src/host/clis.js'
import { AdapterStore, CHECK_EVERY_MS } from './src/host/install.js'
import { drawImage, imageRefusal, SIGNED_OUT, UNAVAILABLE } from './src/host/image.js'
import { CliLogins } from './src/host/login.js'
import { CREDENTIAL_ENV, URL_ENV } from './src/host/names.js'
import { enginesFor, pressureGuard } from './src/host/pressure.js'
import { redactorFor } from './src/host/redact.js'
import { agentRoute, carryEffort, crossed } from './src/host/switch.js'

export const name = 'acp-dsh'
export const inject = ['llm', 'agents']

// The bridge, its DSH approval, the drift detector and live switching: an absent key takes the
// per-agent default for the bridge (Claude on; Codex only on an explicit true), the transcript
// replay reaches both agents unless the key is false (plan A-5), and false is the kill switch.
// The key is public (installed teams keep it in their profile patch). DSH_TOOLS_DEFAULT is the
// Claude/service view used for the bridge probe, crossings and effort carry; it is not a schema
// default, so an absent key still reaches the adapter as absent.
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
  // No schema default: absent is the per-agent default (Claude Code on, because only its
  // adapter can drop the built-in tool set; Codex off, so it never runs two tool sets), and an
  // explicit true/false is the person's word. False is also the kill switch and the 2026-11-03
  // behaviour. A schema default would materialise true and erase the difference. Hidden from
  // settings forms (`.hidden()`): it is a rollback lever, not a preference, and stays writable
  // through DSH's settings service and the profile patch.
  dshTools: z.boolean().volatile().hidden().description([
    "Hand DSH's own tools to the agent over a per-session MCP bridge named dsh (the Session's",
    "preset, filtered by its level), approve every DSH tool call in DSH whatever the agent's own",
    "rules say, and turn the agent's built-in tools off where its adapter allows. On by default",
    "for Claude Code; an agent whose adapter cannot drop its own tools (Codex) bridges only on an",
    'explicit true. The transcript reaches either agent when a Session moves to it, whatever the',
    'bridge, unless this is false. False is the kill switch and the behaviour without it: each',
    'agent keeps its own tools and approvals, and sees only its own session.',
  ].join(' ')),
})

export const SERVICE = 'acpAgents'
const FIRST_CHECK_MS = 5000
// A failed probe is retried after this long in the same process; a new process starts with an
// empty cache, so the next app start also retries. A success is kept for its adapter version.
export const PROBE_RETRY_MS = 10 * 60 * 1000
// How long one fresh sign-in check (`inspect`) stands for the same agent.
export const INSPECT_TTL_MS = 3000
// How long a confirmed "signed in" stands: `auth status` spawns the whole CLI, and a Bot's turn
// asks before its first call. A sign-in that ends meanwhile is caught by the agent itself: its
// ACP `auth_required` is MODEL_ACCESS_REQUIRED (adapter.js) and drops this answer at once.
export const SIGNED_IN_TTL_MS = 5 * 60 * 1000

// A live field is a reference ({ get() }) in the running fiber; a plain value elsewhere (tests).
export const flagOf = value => (typeof value?.get === 'function' ? value.get() : value)

// The Claude Code (and Bot-move) view of `dshTools`: absent means on, and only an explicit
// false is the kill switch. Per-agent bridging reads the raw setting in AcpAdapter.
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
 * @param {{ store?: any, cliStore?: any, find?: typeof findCommand, signedIn?: typeof signedInOf, catalogHome?: string, loginSpawn?: typeof spawn, loginTimers?: any }} [deps]
 *   catalogHome: where each agent's models and efforts are kept (beside the adapters by default).
 *   loginSpawn, loginTimers: tests only, a fake CLI process and clock for sign-in attempts.
 */
export function apply(ctx, config = {}, { store = new AdapterStore({ log: message => info(ctx, message) }), cliStore = !config.fakeAgent && (process.env.AUTOMAGIK_APP_BROWSER === '1' || process.env.AUTOMAGIK_PNPM) ? new CliStore({ log: message => info(ctx, message) }) : undefined, find = name => findCommand(name), signedIn = signedInOf, catalogHome = store.home ? join(dirname(store.home), 'catalog') : undefined, loginSpawn, loginTimers } = {}) {
  const agents = new Map()
  const log = message => info(ctx, message)
  if (config.fakeAgent) {
    const spawn = () => ({ command: process.execPath, args: [config.fakeAgent] })
    agents.set('acp-fake', {
      name: 'Fake agent',
      // Tests only: keep a test of the missing-bridge failure from waiting the real grace period.
      ...(Number(process.env.ACP_BRIDGE_READY_MS) > 0 ? { bridgeReadyMs: Number(process.env.ACP_BRIDGE_READY_MS) } : {}),
      catalog: new Catalog({ id: 'acp-fake', name: 'Fake agent', defaultName: 'Fake agent', fallback: [{ id: DEFAULT_MODEL, name: 'Fake agent' }], key: () => config.fakeAgent, spawn, log }),
      // The fake stands in for Claude Code where the bridge default is concerned: it declares
      // the adapter switch that drops its own built-in tool set.
      disableBuiltInTools: true,
      spawn,
    })
  }
  const backchannel = new Backchannel({ ctx, log })
  const redact = redactorFor(ctx)
  // The chat's image keeper (`keepImages`): where an image an agent makes in a chat is kept so the
  // chat can show it. One at a time; the Bot team registers its images folder.
  let imageKeeper
  const adapter = new AcpAdapter(ctx, agents, {
    images: () => imageKeeper,
    // The raw tri-state: an absent setting takes each agent's own switch in AcpAdapter.
    dshTools: () => flagOf(config.dshTools),
    backchannel,
    redactor: redact,
    onSignedOut: id => signedOut(id),
  })
  // The kill switch is live: any change of `dshTools` ends the agent sessions and revokes their
  // bridges, so a credential minted while it was on cannot keep calling DSH tools and a Session
  // started with the bridge never runs on the old tool set. The next turn starts afresh.
  // The flip is also announced on the plugin context: DSH delivers `loader/volatile-update`
  // only to the plugin whose config changed, so a Bot team watching its own context never sees
  // this one. A profile-patch edit emits no other event there, and the Bot move reverses on it.
  // A listener that throws must not undo the setting or the ended sessions above, but it must
  // not vanish either: the live reverse is lost, and the next start (off or route gone) is the
  // fallback, so the warning makes that deferral visible.
  let toolsSetting = flagOf(config.dshTools)
  const syncTools = () => {
    const next = flagOf(config.dshTools)
    if (toolsSetting === next) return
    toolsSetting = next
    adapter.endSessions()
    try {
      ctx.emit?.('acp-dsh/dsh-tools-changed', { on: dshToolsOn(config.dshTools) })
    } catch (error) {
      const why = error?.message ?? error
      warn(ctx, `the dshTools flip was not announced: ${why}; the next start reverses`)
    }
  }
  const clis = new Map()
  const cliDetails = new Map()
  const signIns = new Map()
  let registration
  let disposed = false
  const cliEnvironment = (spec, detail) => {
    if (!detail?.managed) return {}
    if (spec.key === 'claude') return { DISABLE_UPDATES: '1' }
    // Managed Codex runs its native executable; inherited package-manager ownership flags
    // must not send an upgrade command to a global installation.
    return { CODEX_MANAGED_BY_NPM: undefined, CODEX_MANAGED_BY_PNPM: undefined, CODEX_MANAGED_BY_BUN: undefined, CODEX_MANAGED_BY_VITE_PLUS: undefined, CODEX_MANAGED_PACKAGE_ROOT: undefined }
  }

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
  const agentOf = (spec, cli, id = idOf(spec), node = nodeCommand(), cliEnv = cliEnvironment(spec, cliDetails.get(id))) => ({
    name: spec.name,
    modeFor: spec.modeFor,
    // The adapter reads these off the agent object: without them the bridge default would not
    // find Claude's switch, the drift detector would never run and Codex would never fork.
    ...(spec.disableBuiltInTools === true ? { disableBuiltInTools: true } : {}),
    ...(spec.drift === true ? { drift: true } : {}),
    ...(spec.refresh === undefined ? {} : { refresh: spec.refresh }),
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
      spawn: () => ({ command: node.command, args: [store.binOf(spec.adapter, spec.bin).path], env: { ...node.env, ...cliEnv, ...spec.env(cli) } }),
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
      return { command: node.command, args: [bin.path], env: { ...node.env, ...cliEnv, ...spec.env(cli) } }
    },
  })

  // The agents that should be offered now: setting on and CLI here. `kick` installs the
  // connector of one that just became offered (at start, the first check waits a little).
  const reconcile = ({ kick = true } = {}) => {
    let changed = false
    const added = []
    for (const [id, spec] of Object.entries(AGENTS)) {
      const external = find(spec.cli)
      const detail = cliStore?.find(spec, external) ?? (external ? { path: external, managed: false } : undefined)
      const cli = detail?.path
      cliDetails.set(id, detail)
      if (clis.get(id) !== cli) signIns.delete(id)
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
    const authenticated = cli === undefined ? undefined : await signedIn(spec, cli, { env: { ...process.env, ...cliEnvironment(spec, cliDetails.get(id)) } }).catch(() => undefined)
    if (clis.get(id) === cli) signIns.set(id, authenticated)
  }
  const probeAll = () => Promise.all(Object.keys(AGENTS).map(probe))
  // One agent's status with a fresh sign-in check, for a Bot that is about to be put on it
  // (bots-dsh models.js). Read-only: it asks the CLI `auth status` and nothing else, never
  // installs, enables or starts a login. Only that sign-in check is shared and kept: checks a
  // few at once share one probe, and its answer stands for INSPECT_TTL_MS (a confirmed sign-in
  // for SIGNED_IN_TTL_MS) for the same CLI, so a burst of picks, or a Bot's turns, spawn the CLI
  // once. Everything else in the row (the setting, the CLI, the connector) is read again on every
  // inspect: an agent turned off or a connector that failed is never reported ready from cache.
  const inspections = new Map()
  // The agent itself said it is signed out (ACP auth_required): the cached answer goes, and the
  // next check asks the CLI again.
  const signedOut = (id) => {
    if (disposed || !Object.hasOwn(AGENTS, id)) return
    inspections.delete(id)
    if (signIns.get(id) !== false) {
      signIns.set(id, false)
      publish()
    }
  }
  const inspect = async (id) => {
    if (!Object.hasOwn(AGENTS, id)) return undefined
    reconcile({ kick: false })
    const cli = clis.get(id)
    let entry = inspections.get(id)
    if (entry === undefined || entry.cli !== cli || (entry.at !== undefined && Date.now() - entry.at >= entry.ttl)) {
      const fresh = { at: undefined, ttl: INSPECT_TTL_MS, cli, promise: undefined }
      fresh.promise = probe(id).then(() => {
        if (signIns.get(id) === true) fresh.ttl = SIGNED_IN_TTL_MS
      }).finally(() => { fresh.at = Date.now() })
      fresh.promise.catch(() => { if (inspections.get(id) === fresh) inspections.delete(id) })
      inspections.set(id, entry = fresh)
    }
    await entry.promise
    return statusOf(id)
  }

  // Required desktop tools are independent of model switches and onboarding. Installing
  // them never starts authentication; the existing explicit refresh owns sign-in checks.
  const ensureCli = (spec, { force = false } = {}) => {
    if (!cliStore || disposed) return Promise.resolve()
    return cliStore.ensure(spec, find(spec.cli), { force }).then(() => {
      if (!disposed) reconcile()
    }, () => {
      if (!disposed) {
        // Discovery may have found a newer verified local copy before the registry failed.
        reconcile()
        warn(ctx, `${spec.defaultName} update check failed: ${cliStore.lastError?.(spec.cliPackage) ?? 'the install failed'}`)
      }
    })
  }
  // Each lifecycle trigger checks the registry even if a previous check was recent. The
  // store shares in-flight work, so simultaneous plugin changes do not duplicate downloads.
  const required = () => { for (const spec of Object.values(AGENTS)) void ensureCli(spec, { force: true }) }

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
    const cliFailure = cliStore?.lastFailure(spec.cliPackage)
    const cliBusy = cliStore?.busy(spec.cliPackage) === true
    const detail = cliDetails.get(id)
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
      cli: {
        found: cli !== undefined, installUrl: spec.installUrl,
        state: cli ? 'ready' : cliBusy || (cliStore && !cliFailure) ? 'installing' : cliFailure ? 'failed' : 'missing',
        managed: detail?.managed === true,
        ...(detail?.version ? { version: detail.version } : {}),
        ...(cliBusy && cli ? { updating: true } : {}),
        ...(cliFailure ? {
          error: cliFailure.message,
          ...(cliFailure.diagnostic ? { diagnostic: cliFailure.diagnostic } : {}),
          ...(cliFailure.logPath ? { logPath: shownPath(cliFailure.logPath) } : {}),
        } : {}),
      },
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

  // Sign-in attempts (login.js): one per agent, owned here, read by any owner view. A ready
  // sign-in is recorded only for the executable that confirmed it (the update loop may have
  // installed a newer CLI meanwhile), and announced on the plugin context, as the dshTools flip
  // is, so the Bot team can apply the model the person chose (`acp-dsh/login-ready`). The
  // number at work is announced too (`acp-dsh/login-active`): the welcome adds it to the busy
  // file, so the app's own restarts wait for an attempt to end.
  const logins = new CliLogins({
    ...(loginSpawn ? { spawn: loginSpawn } : {}),
    ...(loginTimers ? { timers: loginTimers, now: () => loginTimers.now() } : {}),
    signedIn,
    resolve(id) {
      reconcile({ kick: false })
      return { cli: clis.get(id), env: { ...process.env, ...cliEnvironment(AGENTS[id], cliDetails.get(id)) } }
    },
    onReady(id, selected) {
      if (disposed) return
      if (clis.get(id) === selected.cli) signIns.set(id, true)
      inspections.delete(id)
      publish()
      try {
        ctx.emit?.('acp-dsh/login-ready', { id })
      } catch (error) {
        warn(ctx, `the sign-in of ${id} was not announced: ${error?.message ?? error}`)
      }
    },
    onChange(active) {
      try {
        ctx.emit?.('acp-dsh/login-active', { active })
      } catch (error) {
        warn(ctx, `the sign-in count was not announced: ${error?.message ?? error}`)
      }
    },
  })

  // Images on the person's ChatGPT plan, through the Codex CLI's own sign-in (image.js). Ready
  // means: Codex is on and found, its connector installed, and its CLI says it is signed in. An
  // unknown sign-in is asked once (`codex login status`, read-only); nothing else is spawned.
  const IMAGE_AGENT = 'acp-codex'
  const imageAccess = async () => {
    reconcile({ kick: false })
    const agent = agents.get(IMAGE_AGENT)
    if (agent === undefined || agent.installed?.() !== true) return { ready: false }
    if (signIns.get(IMAGE_AGENT) === undefined) await probe(IMAGE_AGENT).catch(() => {})
    const signedIn = signIns.get(IMAGE_AGENT)
    return { ready: signedIn === true, ...(signedIn === undefined ? {} : { signedIn }) }
  }
  const generateImage = async ({ prompt, size, quality, background, signal, timeoutMs } = {}) => {
    const access = await imageAccess()
    if (!access.ready) {
      if (access.signedIn === false) throw imageRefusal(SIGNED_OUT, 'Codex is not signed in. Sign in to Codex from a Bot\'s chat, or add an OpenAI key, then try again.')
      throw imageRefusal(UNAVAILABLE, 'Codex cannot draw images here yet: it is off, not installed, or its sign-in could not be checked.')
    }
    try {
      return await drawImage({ spawn: () => agents.get(IMAGE_AGENT).spawn(), prompt, size, quality, background, signal, ...(timeoutMs === undefined ? {} : { timeoutMs }), name: AGENTS[IMAGE_AGENT].defaultName })
    } catch (error) {
      // A run refused as signed out says the CLI's sign-in ended: the next check asks again.
      if (error?.code === SIGNED_OUT) signIns.delete(IMAGE_AGENT)
      throw error
    }
  }

  const service = {
    settingsEntry: name,
    status,
    // Sign-in, for the DSH owner's views only (the Bot team's owner-only route): never tools,
    // never listed by status(), and nothing here writes into a conversation or a model setting.
    // `label` names the view that opens an attempt (a Bot id) for the cancel confirmation.
    loginStart: (id, { label } = {}) => logins.start(id, { label }),
    /** The attempt at work for this agent, from any view, or undefined. Never starts or cancels one. */
    loginCurrent: id => logins.current(id),
    loginStatus: (id, attemptId) => logins.status(id, attemptId),
    loginAnswer: (id, attemptId, value) => logins.answer(id, attemptId, value),
    loginCancel: (id, attemptId) => logins.cancel(id, attemptId),
    /** Whether a text carries a Claude sign-in state shown in the last day. Only a boolean. */
    loginTextMatches: text => logins.textMatches(text),
    /** How many sign-in attempts are starting or waiting (the busy signal). */
    loginActive: () => logins.activeAttempts(),
    /**
     * Whether Codex can draw an image now, on its own ChatGPT sign-in: { ready, signedIn? }.
     * Never starts a sign-in and never reads a credential.
     */
    imageAccess,
    /**
     * Draws one image with the Codex CLI (image.js): { prompt, size?, quality?, background?,
     * signal?, timeoutMs? } -> { base64, mimeType }. Refusals carry an `acp/image-*` code and a
     * message to show as it is.
     */
    generateImage,
    /**
     * Where an image an agent makes in a chat goes (agent-image.js): `keeper` is
     * { start?({ callId, sessionId, via }), keep({ callId, sessionId, base64, mimeType, via }) ->
     * Promise<{ file }>, fail?({ callId, sessionId, error }) }. The PNG comes from the agent's own
     * tool update, never from a file it saved. Returns the disposer; a later keeper replaces it.
     */
    keepImages(keeper) {
      imageKeeper = keeper
      return () => { if (imageKeeper === keeper) imageKeeper = undefined }
    },
    /**
     * What the Bot team gates its one-time Claude move on: whether DSH's tools reach an agent
     * here (`dshTools`), and whether this machine's bridge really answers `initialize` and
     * `tools/list` for a freshly minted per-session credential. The answer is cached per
     * installed adapter version; off, a missing adapter, or a failed probe says no.
     */
    async bridge() {
      return bridgeStatus()
    },
    /**
     * One agent's status (`status()`'s row) with a fresh sign-in check: what the Bot team reads
     * before it puts a Bot on that agent. Read-only; undefined for an id that is no agent here.
     * @param {string} id
     */
    inspect,
    /** Looks for the CLIs again (one installed since DSH started) and asks each whether it is signed in. */
    async refresh() {
      inspections.clear()
      reconcile()
      await probeAll()
      return status()
    },
    /** Retries the required CLI and its connector; answers at once without enabling a model. */
    async retry(id) {
      const spec = AGENTS[id]
      if (spec === undefined) throw new Error(`no ACP agent ${String(id).slice(0, 40)}`)
      reconcile({ kick: false })
      void ensureCli(spec, { force: true })
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
  // DSH's updateBundle installs through installBundle, which emits reason "install" (there
  // is no "update" reason). It also emits when a change needs a later host restart. This
  // covers any plugin, not just ACP, and the background check never blocks plugin loading.
  ctx.on?.('plugin-manager/changed', change => { if (change?.reason === 'install') required() })
  // A model selection that moves a Session off its agent: its boundary row, and the agent
  // session (and bridge) belonging to the old route ends (RFC 0003, amendment, "Live switching").
  ctx.on?.('session/event', (session, event) => adapter.noteEvent(session, event))
  // The other half of a crossing: the effort the Session ran on follows it both ways when the
  // target offers it, and a notice says so when it cannot. Live switching's rule, so it
  // follows `dshTools`.
  const carry = carryEffort(
    async (provider, model) => (await ctx.llm.resolveModelInfo?.(provider, model))?.reasoning,
    () => dshToolsOn(config.dshTools),
    (previous, next) => agentRoute(agents, previous.provider) || agentRoute(agents, next.provider),
  )
  ctx.on?.('session/event', (session, event) => { void carry(session, event) })
  // The model-switch guard: an agent destination needs no compaction (pressure.js). Adopted when
  // an agent is created, and again on its requests, so an engine made after the agent (a
  // reloaded compaction plugin) is covered before its guard prices the next switch. The
  // request listener is not prepended: compaction-basic's prepended listener calls `next()`
  // (this one) before it prices the switch.
  const pressure = pressureGuard({ agentDestination: provider => agentRoute(agents, provider) })
  const adoptPressure = (agent) => {
    if (agent === undefined || agent === null) return
    for (const engine of enginesFor(ctx, agent)) pressure.adopt(engine)
  }
  ctx.on?.('agent/created', ({ agent } = {}) => adoptPressure(agent))
  ctx.on?.('agent/request', (payload, next) => {
    adoptPressure(payload?.agent)
    return next()
  })
  // The newest adapter releases, at start and daily after; a Session already running keeps its own.
  const refresh = () => {
    for (const [id, spec] of Object.entries(AGENTS)) if (agents.has(id)) void install(spec)
  }
  const first = setTimeout(() => { required(); refresh() }, FIRST_CHECK_MS)
  const cliChecks = cliStore ? setInterval(required, CLI_CHECK_EVERY_MS) : undefined
  const daily = setInterval(() => { reconcile({ kick: false }); refresh() }, CHECK_EVERY_MS)
  first.unref?.()
  daily.unref?.()
  cliChecks?.unref?.()
  // Cordis 4 has no 'dispose' event: an effect's cleanup is what runs when the plugin stops.
  ctx.effect?.(() => () => {
    disposed = true
    // First, so a throwing cleanup below never leaves the wrapper on a live engine.
    pressure.dispose()
    clearTimeout(first)
    clearInterval(daily)
    clearInterval(cliChecks)
    logins.dispose()
    // A running adapter install would otherwise outlive DSH and keep writing into its home.
    store.dispose?.()
    cliStore?.dispose?.()
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
