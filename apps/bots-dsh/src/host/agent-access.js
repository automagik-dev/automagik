// Instance-local administration over stateless MCP Streamable HTTP. No browser cookies.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceFile } from './files.js'

const VERSION = '2025-06-18'
const VERSIONS = new Set([VERSION, '2025-03-26', '2025-11-25'])
const LIMIT = 65536
const BOT_FIELDS = ['id', 'name', 'role', 'color', 'instructions', 'model', 'effort', 'permission']
const ROOM_FIELDS = ['id', 'name', 'notice', 'members', 'admin', 'permission', 'mode']
const pick = (value, fields) => value == null ? null
  : Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
export const botConfig = bot => pick(bot, BOT_FIELDS)
export const roomConfig = room => pick(room, ROOM_FIELDS)
const string = { type: 'string', maxLength: 16000 }
const nullable = { anyOf: [string, { type: 'null' }] }
const members = { type: 'array', items: string, maxItems: 100 }
const botProps = Object.fromEntries(BOT_FIELDS.filter(key => key !== 'id').map(key => [key,
  ['model', 'effort'].includes(key) ? nullable : string]))
const roomProps = { name: string, notice: string, members, admin: string, permission: string }
const tool = (name, endpoint, description, properties = {}, required = []) => ({
  name, endpoint, description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
})
export const AGENT_TOOLS = [
  tool('list_bots', 'list-bots', 'List Bot configuration; no chats or credentials.'),
  tool('get_bot', 'get-bot', 'Get Bot configuration.', { id: string }, ['id']),
  tool('create_bot', 'create-bot', 'Create a Bot.',
    Object.fromEntries(Object.entries(botProps).filter(([key]) => key !== 'permission')), ['name']),
  tool('update_bot', 'update-bot', 'Edit instructions, model, effort or permissions.',
    { id: string, ...botProps }, ['id']),
  tool('delete_bot', 'delete-bot', 'Delete a Bot.', { id: string }, ['id']),
  tool('set_main', 'set-main', 'Set or remove the Main Bot role.',
    { id: string, main: { type: 'boolean' }, primary: { type: 'boolean' }, replace: string },
    ['id']),
  tool('list_groups', 'list-rooms', 'List group configuration; no messages.'),
  tool('get_group', 'get-room', 'Get group configuration.', { id: string }, ['id']),
  tool('create_group', 'create-room', 'Create a group with its members.',
    { name: string, members, admin: string }, ['name', 'members']),
  tool('update_group', 'update-room', 'Edit a group and its membership.',
    { id: string, ...roomProps, add: members, remove: members }, ['id']),
  tool('delete_group', 'delete-room', 'Delete a group.', { id: string }, ['id']),
]
const digest = value => createHash('sha256').update(value).digest()
const invalid = () => Object.assign(new Error('Invalid agent access request'), {
  code: 'bot/invalid',
})
const matches = (value, schema) => {
  if (schema.anyOf) return schema.anyOf.some(option => matches(value, option))
  if (schema.type === 'null') return value === null
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems
    && value.every(item => matches(item, schema.items))
  if (schema.type === 'string') return typeof value === 'string' && value.length <= schema.maxLength
  return typeof value === schema.type
}
const validArgs = (args, schema) => args !== null && typeof args === 'object'
  && !Array.isArray(args) && schema.required.every(key => Object.hasOwn(args, key))
  && Object.entries(args).every(([key, value]) => Object.hasOwn(schema.properties, key)
    && matches(value, schema.properties[key]))

export function createAgentAccess(rt, handle, { now = Date.now } = {}) {
  const tokenPath = join(rt.home, 'agent-tokens.json')
  const auditPath = join(rt.home, 'agent-audit.jsonl')
  let records
  let queue = Promise.resolve()
  let server
  let address = null
  let stopped = false
  let failures = 0
  let resetAt = 0
  const serial = fn => {
    const job = queue.then(fn)
    queue = job.catch(() => {})
    return job
  }
  const load = async () => {
    if (records !== undefined) return
    try {
      const value = JSON.parse(await readFile(tokenPath, 'utf8'))
      if (!Array.isArray(value) || value.some(row => !/^[a-f0-9]{64}$/.test(row.hash)
        || typeof row.name !== 'string' || typeof row.id !== 'string')) throw invalid()
      records = value
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      records = []
    }
  }
  const clean = value => {
    const text = JSON.stringify(value)
    // Redact keys too, and token-shaped strings even if copied into instructions or names.
    return JSON.parse(rt.redactSecretsAnywhere(text).replace(/am_agent_[a-f0-9]{64}/g,
      '[agent token]'))
  }
  const audit = async entry => {
    await mkdir(rt.home, { recursive: true })
    await appendFile(auditPath, JSON.stringify(clean({ time: now(), ...entry })) + '\n',
      { mode: 0o600 })
  }
  const persist = async next => {
    const temp = `${tokenPath}.${randomUUID()}.tmp`
    await mkdir(rt.home, { recursive: true })
    await writeFile(temp, JSON.stringify(next), { mode: 0o600 })
    await replaceFile(temp, tokenPath)
    records = next
  }
  const history = async () => {
    try {
      const file = await open(auditPath, 'r')
      try {
        const size = (await file.stat()).size
        const start = Math.max(0, size - 256 * 1024)
        const bytes = Buffer.alloc(size - start)
        await file.read(bytes, 0, bytes.length, start)
        const lines = bytes.toString('utf8').split('\n')
        if (start > 0) lines.shift()
        return clean(lines.filter(Boolean).slice(-200).map(line => JSON.parse(line)))
      } finally { await file.close() }
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
  const snapshot = () => clean({
    bots: Object.values(rt.state.bots).map(botConfig),
    groups: Object.values(rt.state.rooms).map(roomConfig), mainBotIds: [...rt.state.mainBotIds],
  })
  const changes = (before, after) => {
    const diff = {}
    for (const kind of ['bots', 'groups']) {
      const left = new Map(before[kind].map(row => [row.id, row]))
      const right = new Map(after[kind].map(row => [row.id, row]))
      for (const id of new Set([...left.keys(), ...right.keys()])) {
        const fields = {}
        const was = left.get(id) ?? {}
        const next = right.get(id) ?? {}
        for (const key of new Set([...Object.keys(was), ...Object.keys(next)])) {
          if (JSON.stringify(was[key]) !== JSON.stringify(next[key])) {
            fields[key] = { before: was[key] ?? null, after: next[key] ?? null }
          }
        }
        if (Object.keys(fields).length) (diff[kind] ??= {})[id] = fields
      }
    }
    if (JSON.stringify(before.mainBotIds) !== JSON.stringify(after.mainBotIds)) {
      diff.mainBotIds = { before: before.mainBotIds, after: after.mainBotIds }
    }
    return diff
  }
  const json = (status, value) => new Response(JSON.stringify(clean(value)), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
  const processRequest = async request => {
    await load()
    await rt.refresh()
    await rt.loadSecrets()
    const supplied = request.headers.get('authorization') ?? ''
    const candidate = supplied.startsWith('Bearer ') ? supplied.slice(7) : ''
    const hash = digest(candidate)
    // Hash lengths are fixed; compare all records, including tombstones for attribution.
    let identity
    for (const row of records) {
      if (timingSafeEqual(hash, Buffer.from(row.hash, 'hex'))) identity = row
    }
    const tokenName = identity?.name ?? 'Unknown token'
    const callId = randomUUID()
    const entry = { callId, tokenName, action: 'http', target: null }
    let body
    let bodyError
    try {
      const bytes = await request.arrayBuffer()
      if (bytes.byteLength > LIMIT) bodyError = 'Request too large'
      else body = JSON.parse(Buffer.from(bytes).toString('utf8'))
    } catch { bodyError = 'Invalid JSON' }
    const method = body?.method
    const definition = method === 'tools/call'
      ? AGENT_TOOLS.find(item => item.name === body.params?.name) : undefined
    if (definition) {
      entry.action = definition.name
      const target = body.params?.arguments?.id
      entry.target = typeof target === 'string' ? target : null
    } else if (['initialize', 'ping', 'tools/list'].includes(method)) entry.action = method
    const refuse = async (status, reason) => {
      await audit({ ...entry, outcome: 'refused', reason })
      return json(status, { error: reason })
    }
    if (!identity || identity.revokedAt !== undefined || candidate === '') {
      if (now() >= resetAt) { failures = 0; resetAt = now() + 60000 }
      failures += 1
      return refuse(failures > 10 ? 429 : 401,
        failures > 10 ? 'Too many failed attempts' : 'Invalid agent token')
    }
    const url = new URL(request.url)
    if (url.pathname !== '/mcp' || url.search || request.headers.has('origin')) {
      return refuse(403, 'Invalid MCP origin or URL')
    }
    if (request.method !== 'POST') return refuse(405, 'Use POST')
    const version = request.headers.get('mcp-protocol-version')
    if (version && !VERSIONS.has(version)) return refuse(400, 'Unsupported protocol version')
    const accept = request.headers.get('accept') ?? ''
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      return refuse(406, 'Accept JSON and event streams')
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return refuse(415, 'Use application/json')
    }
    if (bodyError) return refuse(bodyError === 'Request too large' ? 413 : 400, bodyError)
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string'
      || (body.id !== undefined && typeof body.id !== 'string' && typeof body.id !== 'number')) {
      return refuse(400, 'Invalid JSON-RPC request')
    }
    const knownMethods = ['initialize', 'ping', 'tools/list', 'tools/call',
      'notifications/initialized', 'notifications/cancelled']
    entry.action = knownMethods.includes(body.method) ? body.method : 'unknown-method'
    const reply = result => json(200, { jsonrpc: '2.0', id: body.id, result })
    const error = async (code, message) => {
      await audit({ ...entry, outcome: 'refused', reason: message })
      return json(200, { jsonrpc: '2.0', id: body.id ?? null, error: { code, message } })
    }
    if (body.method.startsWith('notifications/') && body.id === undefined) {
      if (!knownMethods.includes(body.method)) return refuse(400, 'Unknown notification')
      await audit({ ...entry, outcome: 'allowed' })
      return new Response(null, { status: 202 })
    }
    if (body.id === undefined) return refuse(400, 'Request id required')
    if (body.method !== 'tools/call') {
      let result
      if (body.method === 'initialize') result = {
        protocolVersion: VERSIONS.has(body.params?.protocolVersion)
          ? body.params.protocolVersion : VERSION,
        capabilities: { tools: {} }, serverInfo: { name: 'automagik-bots', version: '1' },
      }
      else if (body.method === 'ping') result = {}
      else if (body.method === 'tools/list') result = {
        tools: AGENT_TOOLS.map(({ endpoint, ...item }) => item),
      }
      else return error(-32601, 'Unknown method')
      await audit({ ...entry, outcome: 'allowed' })
      return reply(result)
    }
    if (!definition) return error(-32602, 'Unknown tool')
    entry.action = definition.name
    const args = body.params?.arguments ?? {}
    entry.target = typeof args?.id === 'string' ? args.id : null
    if (!validArgs(args, definition.inputSchema)) return error(-32602, 'Invalid tool arguments')
    const before = snapshot()
    // An intent persists before side effects. Audit failure therefore fails closed.
    await audit({ ...entry, outcome: 'started' })
    const result = await handle(definition.endpoint, args, request.signal)
    const after = snapshot()
    const delta = changes(before, after)
    if (args.id === undefined && definition.endpoint === 'create-bot') {
      entry.target = result.ok ? result.value.id : null
    }
    if (args.id === undefined && definition.endpoint === 'create-room') {
      entry.target = result.ok ? result.value.id : null
    }
    await audit({ ...entry, outcome: result.ok ? 'allowed' : 'refused', changes: delta })
    // Mutation handlers may answer a full UI view. Never send that view over MCP.
    const value = result.ok ? definition.endpoint === 'list-bots' ? after.bots
      : definition.endpoint === 'list-rooms' ? after.groups
        : definition.endpoint.endsWith('bot') || definition.endpoint === 'set-main'
          ? after.bots.find(bot => bot.id === (args.id ?? entry.target)) ?? null
          : after.groups.find(group => group.id === (args.id ?? entry.target)) ?? null
      : { error: 'Action refused', code: result.error.code }
    return reply({ isError: !result.ok, content: [{ type: 'text', text: JSON.stringify(value) }] })
  }
  const fetch = request => serial(async () => {
    try { return await processRequest(request) }
    catch { return json(503, { error: 'Agent access unavailable' }) }
  })
  const start = async () => {
    if (server || stopped) return
    const port = rt.config.agentAccessPort ?? 0
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw invalid()
    server = createServer(async (req, res) => {
      try {
        let size = 0
        const chunks = []
        for await (const chunk of req) {
          size += chunk.length
          if (size > LIMIT) {
            await serial(() => audit({ tokenName: 'Unknown token', action: 'http', target: null,
              outcome: 'refused', reason: 'Request too large' }))
            res.writeHead(413).end()
            return
          }
          chunks.push(chunk)
        }
        const response = await fetch(new Request(`http://127.0.0.1:${address.port}${req.url}`,
          { method: req.method, headers: req.headers,
            ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }))
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch { res.writeHead(503).end() }
    })
    server.requestTimeout = 10000
    server.headersTimeout = 10000
    server.maxConnections = 32
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
      })
      address = server.address()
      server.unref()
    } catch (error) { server = undefined; throw error }
  }
  const owner = (action, payload = {}) => serial(async () => {
    await load()
    if (rt.readOnly() !== undefined) throw invalid()
    await rt.loadSecrets()
    if (action === 'view') return clean({
      url: address ? `http://127.0.0.1:${address.port}/mcp` : null,
      tokens: records.map(({ hash, ...row }) => row), audit: await history(),
    })
    if (action === 'create') {
      if (typeof payload.name !== 'string' || !/^[\w .-]{1,60}$/.test(payload.name)
        || records.filter(row => row.revokedAt === undefined).length >= 100) throw invalid()
      const token = `am_agent_${randomBytes(32).toString('hex')}`
      const row = { id: randomUUID(), name: clean(payload.name),
        hash: digest(token).toString('hex'),
        createdAt: now() }
      await start()
      await persist([...records, row])
      return { id: row.id, token }
    }
    if (action === 'revoke') {
      if (!records.some(row => row.id === payload.id)) throw invalid()
      await persist(records.map(row => row.id === payload.id ? { ...row, revokedAt: now() } : row))
      return true
    }
    throw invalid()
  })
  const resume = () => serial(async () => {
    await rt.load()
    if (rt.readOnly() !== undefined) return
    await load()
    if (records.some(row => row.revokedAt === undefined)) await start()
  })
  const close = async () => {
    stopped = true
    await queue
    if (server) await new Promise(resolve => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
  return { owner, fetch, resume, close }
}
