import { createHash } from 'node:crypto'
import { refusal } from './refusal.js'
import { encodeUrlComponent } from './secrets.js'
import { own } from './store.js'

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SECRET_REFERENCE = /\$DSH_SECRET_([A-Z][A-Z0-9_]*)/g
const ENSURE_TIMEOUT_MS = 15_000
// One initialize request, as the mount sends it. The SDK's reconnect budget is not a probe:
// a save that retried would leave the user waiting on a server that already refused.
const PROBE_TIMEOUT_MS = 10_000
const PROBE_EXCERPT_CHARS = 200
const PROBE_REASON_CHARS = 300
const PROBE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'automagik-bots-dsh', version: '1' } },
})

// Connector ids are reserved: a capability named like one would collide with
// its mcp__<id>__* tool prefix. The connectors module registers its ids here.
export const CONNECTOR_IDS = new Set(['github', 'mail'])
export function validateCapabilityName(value, reserved = CONNECTOR_IDS) {
  const name = String(value ?? '').trim()
  if (name.length > 32 || !NAME.test(name) || name === 'github' || reserved.has(name)) {
    throw refusal('Use a capability name with lowercase letters, digits, and single hyphens; connector names are reserved.')
  }
  return name
}

export function expandCapabilityNames(capabilities, library) {
  const expanded = new Set()
  for (const name of capabilities ?? []) {
    const item = own(library, name)
    if (!item) throw refusal(`No capability named ${name}.`)
    if (item.kind === 'pack') {
      for (const childName of item.items ?? []) {
        const child = own(library, childName)
        if (!child || !['mcp', 'skill'].includes(child.kind)) throw refusal(`Pack ${name} refers to an unavailable capability ${childName}.`)
        expanded.add(childName)
      }
    } else if (item.kind === 'mcp' || item.kind === 'skill') {
      expanded.add(name)
    } else {
      throw refusal(`Capability ${name} has an unknown kind.`)
    }
  }
  return expanded
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const strings = value => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw refusal('Arguments must be a list of text values.')
  return [...value]
}
const stringMap = (value, label) => {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some(item => typeof item !== 'string')) throw refusal(`${label} must contain text values.`)
  return Object.fromEntries(Object.entries(value))
}

export function install(rt) {
  const { ctx, state } = rt
  const agents = new Map()
  // Mounted fibers live in each Agent's own context, so they outlive this plugin unless
  // its cleanup disposes them; a strong map keeps them reachable for that.
  const mounts = new Map()
  // One reconcile chain per Agent: a slow MCP server holds up only its own Agent.
  const chains = new WeakMap()
  const queued = new WeakSet()
  const sessionStatuses = new Map()
  let pluginPromise
  let scheduled = null
  let loadingSecrets = 0
  let stopped = false

  const library = () => state.capabilities.items
  const ensureLibrary = () => {
    state.capabilities ??= { items: {} }
    state.capabilities.items ??= {}
    return library()
  }
  const writeCheck = () => {
    const readOnly = rt.readOnly()
    if (readOnly !== undefined) throw refusal(readOnly)
  }
  const allowedToEdit = (item, botId) => rt.isMain(botId) || item.createdBy === botId
  const usedByOthers = (name, botId) => Object.values(state.bots).some(bot => bot.id !== botId
    && (bot.capabilities ?? []).some((attached) => {
      const item = own(library(), attached)
      return attached === name || (item?.kind === 'pack' && (item.items ?? []).includes(name))
    }))
  // A creator that is not a Main Bot could otherwise rewrite what a Main Bot runs.
  const editCheck = (item, botId, verb) => {
    if (!allowedToEdit(item, botId)) throw refusal(`Only ${item.createdBy ? 'its creator or a Main Bot' : 'a Main Bot'} can ${verb} ${item.name}.`)
    if (!rt.isMain(botId) && usedByOthers(item.name, botId)) throw refusal(`Another Bot uses ${item.name}, so only a Main Bot can ${verb} it.`)
  }
  const itemInput = (body, { botId, ui }) => {
    const name = validateCapabilityName(body.name)
    const kind = body.kind
    if (!['mcp', 'skill', 'pack'].includes(kind)) throw refusal('Choose an MCP server, skill, or pack.')
    const items = ensureLibrary()
    const previous = own(items, name)
    if (previous && !ui) editCheck(previous, botId, 'change')
    if (previous && previous.kind !== kind) throw refusal('A capability cannot change its kind. Delete it and save a new one.')
    const now = Date.now()
    const item = {
      name,
      kind,
      description: String(body.description ?? '').trim().slice(0, 2000),
      createdBy: previous?.createdBy ?? (ui ? null : botId),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    if (kind === 'mcp') {
      const transport = body.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
      if (transport === 'stdio') {
        const command = String(body.command ?? '').trim()
        if (command === '') throw refusal('Enter a command for the MCP server.')
        const args = strings(body.args)
        const env = stringMap(body.env, 'Environment variables')
        const changed = !previous || previous.kind !== 'mcp' || previous.transport !== 'stdio'
          || previous.command !== command || !same(previous.args ?? [], args) || !same(previous.env ?? {}, env)
        Object.assign(item, { transport, command, args, env, approved: ui ? true : changed ? false : previous.approved === true })
      } else {
        const url = String(body.url ?? '').trim()
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw refusal()
        } catch { throw refusal('Enter a valid HTTP or HTTPS URL.') }
        Object.assign(item, { transport, url, headers: stringMap(body.headers, 'Headers'), approved: true })
      }
    } else if (kind === 'skill') {
      item.content = String(body.content ?? '').trim()
    } else {
      const names = [...new Set(strings(body.items))]
      for (const childName of names) {
        const child = own(items, childName)
        if (!child || !['mcp', 'skill'].includes(child.kind)) throw refusal(`Packs can include only saved MCP servers and skills. ${childName} is not one.`)
      }
      item.items = names
    }
    return item
  }
  const capabilitySave = async (body, options = {}) => {
    await rt.load()
    writeCheck()
    const item = itemInput(body ?? {}, options)
    if (item.kind === 'mcp' && item.transport === 'streamable-http') {
      item.verification = options.ui && body?.unverified === true
        ? { checkedAt: new Date().toISOString(), status: 'unverified' }
        : await probeHttpCapability(item, options.botId)
    }
    ensureLibrary()[item.name] = item
    await rt.save()
    return item
  }
  const capabilityDelete = async (name, { botId, ui } = {}) => {
    await rt.load()
    writeCheck()
    const items = ensureLibrary()
    const item = own(items, String(name ?? ''))
    if (!item) throw refusal(`No capability named ${name}.`)
    if (!ui) editCheck(item, botId, 'delete')
    delete items[item.name]
    for (const pack of Object.values(items)) if (pack.kind === 'pack') pack.items = (pack.items ?? []).filter(child => child !== item.name)
    for (const bot of Object.values(state.bots)) bot.capabilities = (bot.capabilities ?? []).filter(attached => attached !== item.name)
    await rt.save()
    return true
  }
  // Called with the Bot being deleted, after it left the team. The shared list belongs to
  // the user, so only a local MCP this Bot added, nobody approved and no other Bot or pack
  // uses goes: no one is left to ask for it, and approving it would start a server for no one.
  // Anything a pack lists stays.
  const dropOrphanCapabilities = (bot) => {
    const items = library()
    const packed = name => Object.values(items).some(item => item.kind === 'pack' && (item.items ?? []).includes(name))
    for (const name of bot.capabilities ?? []) {
      const item = own(items, name)
      if (item === undefined || item.kind !== 'mcp' || item.transport !== 'stdio' || item.approved === true) continue
      if (item.createdBy !== bot.id || usedByOthers(name, bot.id) || packed(name)) continue
      delete items[item.name]
    }
  }
  const changeAttachment = async (endpoint, { name, bot: targetRef }, callerId) => {
    await rt.load()
    writeCheck()
    const caller = rt.botOf(callerId)
    if (!caller) throw refusal('Only Bots on the team can change capabilities.')
    const target = targetRef ? rt.findBot(targetRef) : caller
    if (!target) throw refusal(`No Bot named ${targetRef}.`)
    if (target.id !== caller.id && !rt.isMain(callerId)) throw refusal('Only a Main Bot can change another Bot’s capabilities.')
    const item = own(ensureLibrary(), String(name ?? ''))
    if (!item) throw refusal(`No capability named ${name}.`)
    await setAttached(target, item.name, endpoint === 'attach')
    return { bot: target.name, attached: endpoint === 'attach' }
  }
  // Changes one name against the saved list, so two quick changes both land.
  const setAttached = async (bot, name, attached) => {
    bot.capabilities ??= []
    const wasEmpty = bot.capabilities.length === 0
    if (attached && !bot.capabilities.includes(name)) bot.capabilities.push(name)
    if (!attached) bot.capabilities = bot.capabilities.filter(entry => entry !== name)
    await rt.save()
    if (wasEmpty && bot.capabilities.length > 0) {
      await trackBotAgents(bot)
      void scheduleReconcile()
    }
    return bot.capabilities
  }

  const statusSet = (botId, itemName, sessionId, status) => {
    let byItem = sessionStatuses.get(botId)
    if (!byItem) sessionStatuses.set(botId, byItem = new Map())
    let bySession = byItem.get(itemName)
    if (!bySession) byItem.set(itemName, bySession = new Map())
    bySession.set(sessionId, status)
  }
  const clearStatus = (botId, itemName, sessionId) => {
    const byItem = sessionStatuses.get(botId)
    const bySession = byItem?.get(itemName)
    bySession?.delete(sessionId)
    if (bySession?.size === 0) byItem.delete(itemName)
    if (byItem?.size === 0) sessionStatuses.delete(botId)
  }
  const clearSession = sessionId => {
    for (const [botId, byItem] of sessionStatuses) {
      for (const [name, bySession] of byItem) {
        bySession.delete(sessionId)
        if (bySession.size === 0) byItem.delete(name)
      }
      if (byItem.size === 0) sessionStatuses.delete(botId)
    }
  }
  const statusFor = (botId, name) => {
    const values = [...(sessionStatuses.get(botId)?.get(name)?.values() ?? [])]
    if (values.some(status => status.state === 'error')) return values.find(status => status.state === 'error')
    if (values.some(status => status.state === 'needs-approval')) return { state: 'needs-approval' }
    if (values.some(status => status.state === 'connecting')) return { state: 'connecting' }
    return values.length > 0 ? { state: 'ready' } : undefined
  }
  const capabilityStatusesView = () => {
    const result = {}
    for (const bot of Object.values(state.bots)) {
      const statuses = {}
      for (const name of bot.capabilities ?? []) {
        const item = own(library(), name)
        if (!item) continue
        if (item.kind !== 'pack') {
          const status = statusFor(bot.id, name)
          if (status) statuses[name] = status
          continue
        }
        const children = (item.items ?? []).map(child => statusFor(bot.id, child)).filter(Boolean)
        const status = children.find(status => status.state === 'error')
          ?? children.find(status => status.state === 'needs-approval')
          ?? children.find(status => status.state === 'connecting')
          ?? children[0]
        if (status) statuses[name] = status
      }
      result[bot.id] = statuses
    }
    return result
  }
  const libraryView = () => Object.values(library()).map(item => ({
    ...item,
    ...(item.env ? { env: { ...item.env } } : {}),
    ...(item.headers ? { headers: { ...item.headers } } : {}),
    ...(item.items ? { items: [...item.items] } : {}),
  }))

  async function loadMcpPlugin() {
    if (!pluginPromise) {
      pluginPromise = (async () => {
        const loader = ctx.get?.('loader')
        if (typeof loader?.import !== 'function') throw refusal('This DSH cannot load MCP servers.')
        const exports = await loader.import(MCP_CLIENT)
        return loader.unwrapExports?.(exports) ?? exports?.default ?? exports
      })()
    }
    return pluginPromise
  }
  function secretFor(name, botId) {
    const value = rt.canUseSecret(name, botId) ? rt.secretValue(name) : undefined
    if (value === undefined) throw refusal(rt.secretHeldReason?.(name) ?? `Secret ${name} is missing or unavailable for this Bot.`)
    return value
  }
  function resolveValues(values, botId) {
    const resolved = {}
    for (const [key, raw] of Object.entries(values ?? {})) {
      resolved[key] = String(raw).replace(SECRET_REFERENCE, (_match, name) => secretFor(name, botId))
    }
    return resolved
  }
  const resolveUrl = (url, botId) => String(url).replace(SECRET_REFERENCE, (_match, name) => encodeUrlComponent(secretFor(name, botId)))
  const resolveList = (list, botId) => (list ?? []).map(raw => String(raw).replace(SECRET_REFERENCE, (_match, name) => secretFor(name, botId)))
  const configFor = (item, botId) => {
    if (item.kind === 'skill') return { name: item.name, description: item.description, content: item.content }
    if (item.transport === 'stdio') return { transport: 'stdio', serverName: item.name, command: item.command, args: resolveList(item.args, botId), env: resolveValues(item.env, botId), failOnStartupError: true }
    return { transport: 'streamable-http', serverName: item.name, url: resolveUrl(item.url, botId), headers: resolveValues(item.headers, botId), failOnStartupError: true }
  }
  // A Bot resolves only the secrets it may use; the operator saving from Settings resolves a
  // stored secret only when some Bot could use it, and the value only ever goes to the URL.
  const probeSecret = (name, botId) => {
    const usable = botId === undefined
      ? Object.values(state.bots).some(bot => rt.canUseSecret(name, bot.id))
      : rt.canUseSecret(name, botId)
    const value = usable ? rt.secretValue(name) : undefined
    if (value === undefined) throw refusal(rt.secretHeldReason?.(name) ?? `Secret ${name} is missing or unavailable${botId === undefined ? '' : ' for this Bot'}.`)
    return value
  }
  // One initialize POST, with the headers the mount would send. Redact before truncating, so a
  // secret cut at the excerpt edge cannot survive as a fragment.
  const probeHttpCapability = async (item, botId) => {
    const checkedAt = new Date().toISOString()
    let url
    let headers
    let sent
    try {
      const resolved = resolveProbeHeaders(item.headers, botId)
      sent = Object.values(resolved).filter(value => value !== '').sort((a, b) => b.length - a.length)
      url = String(item.url).replace(SECRET_REFERENCE, (_match, name) => encodeUrlComponent(probeSecret(name, botId)))
      headers = { ...resolved, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    } catch (error) {
      return { checkedAt, status: 'unverified', reason: rt.redactSecrets(String(error?.message ?? error)).slice(0, PROBE_REASON_CHARS) }
    }
    // The redactor goes first, over the whole text, and here it replaces every known value
    // wherever it sits, even a 4-7 character one inside a run of letters: a stored secret is
    // replaced whole, so no edge of it can survive. Scrub the sent header values only after
    // that, and only where a secret did not already cover them: scrubbing first would cut a
    // secret around a header value that is a substring of it and leave that secret's prefix
    // and suffix behind. A header that embeds a secret therefore reads as [secret:NAME], not
    // [header]; the label is secondary. Truncation happens only after both, so a cap cannot
    // split a secret.
    const clean = (text) => {
      let out = rt.redactSecretsAnywhere(String(text ?? ''))
      for (const value of sent) out = out.split(value).join('[header]')
      return out.replace(/\s+/g, ' ').trim()
    }
    let response
    try {
      // Never follow a redirect: the second origin would receive the headers, and a GET would
      // hide a POST the capability never made. One request, and a 3xx is the verdict.
      response = await fetch(url, {
        method: 'POST', headers, body: PROBE_BODY, redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      const reason = timedOut ? `timed out after ${PROBE_TIMEOUT_MS / 1000}s` : `could not reach the server: ${clean(error?.message ?? error)}`
      return { checkedAt, status: 'unverified', reason: reason.slice(0, PROBE_REASON_CHARS) }
    }
    if (response.status >= 300 && response.status < 400) {
      try { await response.body?.cancel() } catch { /* the status is the verdict */ }
      const reason = `HTTP ${response.status} (a redirect is not followed)`
      return { checkedAt, status: 'unverified', reason: reason.slice(0, PROBE_REASON_CHARS) }
    }
    if (response.status === 401 || response.status === 403) {
      let excerpt = ''
      try { excerpt = clean(await response.text()).slice(0, PROBE_EXCERPT_CHARS) } catch { /* the status is the verdict */ }
      const challenge = clean(response.headers.get('www-authenticate') ?? '')
        .slice(0, PROBE_EXCERPT_CHARS) || '(none)'
      throw refusal(`Not saved: ${item.name} answered HTTP ${response.status} (WWW-Authenticate: ${challenge}; body: ${excerpt || '(empty)'}). A capability stores headers only and has no sign-in flow. To keep it anyway, use Save unverified in Settings > Capabilities.`)
    }
    if (response.ok) {
      try { await response.body?.cancel() } catch { /* the status is the verdict */ }
      return { checkedAt, status: 'verified' }
    }
    let reason = `HTTP ${response.status}`
    try {
      const excerpt = clean(await response.text()).slice(0, PROBE_EXCERPT_CHARS)
      if (excerpt !== '') reason += `: ${excerpt}`
    } catch { /* the status is the verdict */ }
    return { checkedAt, status: 'unverified', reason: reason.slice(0, PROBE_REASON_CHARS) }
  }
  const resolveProbeHeaders = (values, botId) => {
    const resolved = {}
    for (const [key, raw] of Object.entries(values ?? {})) {
      resolved[key] = String(raw).replace(SECRET_REFERENCE, (_match, name) => probeSecret(name, botId))
    }
    return resolved
  }
  const disposeMount = async mount => {
    if (mount?.fiber) await Promise.resolve().then(() => mount.fiber.dispose()).catch(() => {})
  }
  const mountOne = async (agent, bot, agentMounts, name) => {
    const sessionId = agent.session.id
    const item = own(library(), name)
    const drop = async () => {
      await disposeMount(agentMounts.get(name))
      agentMounts.delete(name)
    }
    if (item.kind === 'mcp' && item.transport === 'stdio' && item.approved !== true) {
      await drop()
      statusSet(bot.id, name, sessionId, { state: 'needs-approval' })
      return
    }
    let config
    try {
      config = configFor(item, bot.id)
    } catch (error) {
      await drop()
      statusSet(bot.id, name, sessionId, { state: 'error', error: rt.redactSecrets(error.message).slice(0, 300) })
      return
    }
    const key = `${name}:${createHash('sha256').update(JSON.stringify(config)).digest('hex')}`
    if (agentMounts.get(name)?.key === key) return
    await drop()
    statusSet(bot.id, name, sessionId, { state: 'connecting' })
    try {
      const plugin = item.kind === 'skill'
        ? {
          name: `ds-bot-capability-skill-${name}`,
          inject: ['skills'],
          apply(c) {
            c.effect(() => c.skills.register({ name: config.name, description: config.description, source: 'runtime', content: config.content }))
          },
        }
        : await loadMcpPlugin()
      if (stopped) return
      const fiber = item.kind === 'skill' ? agent.ctx.plugin(plugin) : agent.ctx.plugin(plugin, config)
      agentMounts.set(name, { key, fiber })
      await fiber.await()
      if (stopped || agents.get(sessionId)?.deref() !== agent) return
      statusSet(bot.id, name, sessionId, { state: 'ready' })
    } catch (error) {
      await drop()
      const message = rt.redactSecrets([error, error?.cause].filter(Boolean).map(part => String(part?.message ?? part)).join(': ') || 'Connection failed').slice(0, 300)
      statusSet(bot.id, name, sessionId, { state: 'error', error: message })
    }
  }
  const reconcileAgent = async (agent, bot) => {
    const sessionId = agent.session.id
    const desired = bot ? expandCapabilityNames(bot.capabilities, library()) : new Set()
    const agentMounts = mounts.get(agent) ?? new Map()
    if (desired.size > 0) mounts.set(agent, agentMounts)
    if (bot) {
      for (const name of sessionStatuses.get(bot.id)?.keys() ?? []) {
        if (!desired.has(name)) clearStatus(bot.id, name, sessionId)
      }
    } else {
      clearSession(sessionId)
    }
    for (const [name, mount] of agentMounts) {
      if (desired.has(name)) continue
      await disposeMount(mount)
      agentMounts.delete(name)
    }
    await Promise.all([...desired].map(name => mountOne(agent, bot, agentMounts, name)))
    if (agentMounts.size === 0 && mounts.get(agent) === agentMounts) mounts.delete(agent)
  }
  const botOfSession = sessionId => (rt.isBotSession(sessionId) ? rt.botOf(rt.selfOf(sessionId)) : undefined)
  // At most one run waits behind the running one; it reads the latest state when it starts.
  const reconcileOne = agent => {
    if (queued.has(agent)) return chains.get(agent)
    queued.add(agent)
    const run = (chains.get(agent) ?? Promise.resolve()).then(async () => {
      queued.delete(agent)
      const sessionId = agent.session.id
      if (stopped || agents.get(sessionId)?.deref() !== agent) return
      await reconcileAgent(agent, botOfSession(sessionId))
    }).catch(error => rt.warn('omni-ui: capability reconcile for %s failed: %s', agent.session?.id, error))
    chains.set(agent, run)
    return run
  }
  const loadInputs = async () => {
    await rt.load()
    loadingSecrets += 1
    try {
      await rt.loadSecrets()
    } finally {
      loadingSecrets -= 1
    }
  }
  async function reconcile() {
    if (stopped) return
    await loadInputs()
    const runs = []
    for (const [sessionId, reference] of agents) {
      const agent = reference.deref()
      if (agent) {
        runs.push(reconcileOne(agent))
        continue
      }
      agents.delete(sessionId)
      clearSession(sessionId)
    }
    await Promise.all(runs)
  }
  const scheduleReconcile = () => {
    if (!scheduled) {
      scheduled = new Promise(resolve => queueMicrotask(() => {
        scheduled = null
        resolve(reconcile().catch(error => rt.warn('omni-ui: capability reconcile failed: %s', error)))
      }))
    }
    return scheduled
  }
  // A run that outlasts the limit goes on in the background, and later requests for the
  // same Agent do not wait for it again.
  const stalled = new WeakSet()
  const prepare = async (agent, sessionId) => {
    const run = loadInputs().then(() => reconcileOne(agent)).then(() => true, error => {
      rt.warn('omni-ui: capability mount for %s failed: %s', sessionId, error)
      return true
    })
    if (stalled.has(agent)) return
    const timeoutMs = rt.capabilityEnsureTimeoutMs ?? ENSURE_TIMEOUT_MS
    let timer
    const completed = await Promise.race([run, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs, false) })])
    clearTimeout(timer)
    if (completed) return
    stalled.add(agent)
    void run.then(() => stalled.delete(agent))
    rt.warn('omni-ui: capability mount for %s did not finish within %dms; continuing', sessionId, timeoutMs)
  }
  async function ensureCapabilities(sessionId) {
    await rt.load()
    const bot = botOfSession(sessionId)
    if (!bot) return
    if ((bot.capabilities ?? []).length === 0 && !mounts.get(agents.get(sessionId)?.deref())?.size) return
    let agent
    try {
      agent = await rt.resolveAgent(sessionId)
    } catch (error) {
      rt.warn('omni-ui: capability Agent for %s could not be resolved: %s', sessionId, rt.redactSecrets(String(error)))
      return
    }
    trackAgent(agent)
    await prepare(agent, sessionId)
  }
  const trackAgent = agent => {
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || !agent.ctx) return
    if (agents.get(sessionId)?.deref() === agent) return
    agents.set(sessionId, new WeakRef(agent))
    agent.ctx.effect(() => () => {
      if (agents.get(sessionId)?.deref() === agent) agents.delete(sessionId)
      clearSession(sessionId)
      for (const mount of mounts.get(agent)?.values() ?? []) void disposeMount(mount)
      mounts.delete(agent)
    }, `omni-ui: capabilities ${sessionId}`)
  }
  const trackBotAgents = async bot => {
    const sessionIds = new Set()
    try {
      const sessionId = rt.chatOf(bot.id)
      if (typeof sessionId === 'string') sessionIds.add(sessionId)
    } catch (error) {
      rt.warn('omni-ui: capability chat session for %s could not be read: %s', bot.id, error)
    }
    try {
      for (const sessionId of rt.groupSessionsOf(bot.id) ?? []) {
        if (typeof sessionId === 'string') sessionIds.add(sessionId)
      }
    } catch (error) {
      rt.warn('omni-ui: capability group sessions for %s could not be read: %s', bot.id, error)
    }
    for (const sessionId of sessionIds) {
      try {
        trackAgent(await rt.resolveAgent(sessionId))
      } catch (error) {
        rt.warn('omni-ui: capability Agent for %s could not be resolved: %s', sessionId, error)
      }
    }
  }

  async function capabilityEndpoint(endpoint, body = {}) {
    if (endpoint === 'capability-save') return capabilitySave(body, { ui: true })
    if (endpoint === 'capability-delete') return capabilityDelete(body.name, { ui: true })
    if (endpoint === 'capability-approve') {
      await rt.load()
      writeCheck()
      const item = own(library(), String(body.name ?? ''))
      if (!item || item.kind !== 'mcp' || item.transport !== 'stdio') throw refusal(`No unapproved stdio MCP named ${body.name}.`)
      item.approved = true
      item.updatedAt = Date.now()
      await rt.save()
      return item
    }
    if (endpoint === 'bot-capability') {
      await rt.load()
      writeCheck()
      const bot = rt.botOf(String(body.botId ?? ''))
      if (!bot) throw refusal('Unknown Bot')
      const name = String(body.name ?? '')
      if (!own(library(), name)) throw refusal(`No capability named ${name}.`)
      return setAttached(bot, name, body.attached === true)
    }
    throw refusal('Unknown capability operation.')
  }
  const secretsChanged = rt.secretsChanged
  rt.secretsChanged = () => {
    secretsChanged?.()
    if (loadingSecrets === 0) void scheduleReconcile()
  }
  rt.capabilitiesStateSaved = () => { void scheduleReconcile() }
  // Creation waits for these listeners, so a new Agent's first request already has its
  // tools and skill catalog. agent/pre-step is too late: a step assembles its tools first.
  ctx.on('agent/created', async function prepareCapabilities({ agent }) {
    trackAgent(agent)
    try {
      await rt.load()
      const bot = botOfSession(agent.session.id)
      if ((bot?.capabilities ?? []).length > 0) await prepare(agent, agent.session.id)
    } catch (error) {
      rt.warn('omni-ui: capability load failed: %s', error)
    }
  })
  ctx.effect(() => {
    void rt.load().then(async () => {
      for (const bot of Object.values(state.bots)) {
        if ((bot.capabilities ?? []).length > 0) await trackBotAgents(bot)
      }
      await scheduleReconcile()
    }).catch(error => rt.warn('omni-ui: capability startup failed: %s', error))
    return async () => {
      stopped = true
      const live = [...mounts.values()]
      mounts.clear()
      agents.clear()
      sessionStatuses.clear()
      await Promise.all(live.flatMap(agentMounts => [...agentMounts.values()].map(disposeMount)))
    }
  }, 'omni-ui: capabilities')
  Object.assign(rt, {
    capabilitySave,
    capabilityDelete,
    dropOrphanCapabilities,
    capabilityEndpoint,
    capabilityLibraryView: libraryView,
    capabilityStatusesView,
    reconcileCapabilities: reconcile,
    scheduleCapabilitiesReconcile: scheduleReconcile,
    ensureCapabilities,
    expandCapabilities: names => expandCapabilityNames(names, library()),
    changeCapabilityAttachment: changeAttachment,
  })
}
