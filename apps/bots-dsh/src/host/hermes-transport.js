// Native Hermes wire. Its public boundary is rows, questions and durable identities; no ACP SDK.
export const HERMES_DEADLINES = Object.freeze({ start: 60_000, control: 15_000, cancel: 5000 })
export const LOST = 'Connection lost; remote outcome unknown'
export const CONTRACT = 'Remote Hermes requires standalone Desktop contract 8 with server-request approvals.'
export const CANONICAL = 'Canonical-authority Hermes is not supported. Use a standalone Desktop contract 8 backend.'
const localFailures = new WeakSet()
const failure = (message, code = 'bot/hermes') => {
  const error = Object.assign(new Error(message), { code })
  localFailures.add(error)
  return error
}
const safeModel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]@-]{0,200}$/.test(value)

export const INVALID_FRAME = 'Remote Hermes returned an invalid protocol frame. Reconnect and reconcile the remote session.'
const FRAME_BYTES = 8 * 1024 * 1024
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = value => typeof value === 'string'
const id = value => string(value) || Number.isSafeInteger(value)
const optional = (value, type) => value === undefined || value === null || type(value)
const fields = (value, names, type) => names.every(name => optional(value[name], type))
const infoShape = value => object(value) && fields(value, ['approval_mode', 'stored_session_id', 'model', 'provider'], string)
  && fields(value, ['yolo', 'running', 'lazy'], value => typeof value === 'boolean')
const requestShape = value => object(value) && id(value.id) && string(value.method) && object(value.params)
  && (value.method !== 'approval' || (string(value.params.session_id) && string(value.params.request_id)
    && fields(value.params, ['command', 'description'], string)))
function eventShape(value) {
  if (!object(value) || !string(value.type) || !object(value.payload) || !optional(value.session_id, string)
    || !optional(value.seq, value => Number.isSafeInteger(value) && value >= 0)) return false
  const p = value.payload
  if (['session.info', 'message.delta', 'message.interim', 'message.complete', 'tool.start', 'tool.complete', 'request.cancel'].includes(value.type) && (!string(value.session_id) || !value.session_id)) return false
  if (value.type === 'gateway.ready') return string(p.replay_epoch) && optional(p.session_authority, value => typeof value === 'boolean')
  if (value.type === 'session.info') return infoShape(p)
  if (value.type === 'request.cancel') return string(p.id) && string(p.method) && string(p.reason)
  if (['message.delta', 'message.interim'].includes(value.type)) return string(p.text)
    && optional(p.offset, value => Number.isSafeInteger(value) && value >= 0) && optional(p.already_streamed, value => typeof value === 'boolean')
  if (value.type === 'message.complete') return fields(p, ['text', 'status', 'error', 'failure_reason'], string)
    && optional(p.response_reused, value => typeof value === 'boolean')
  if (['tool.start', 'tool.complete'].includes(value.type)) return string(p.tool_id)
    && (value.type !== 'tool.start' || string(p.name)) && fields(p, ['name', 'result_text', 'summary'], string)
    && optional(p.args, object)
  return true // Unknown events are ignored by the chat boundary.
}
function snapshotShape(value) {
  return object(value) && string(value.session_id) && infoShape(value.info)
    && fields(value, ['stored_session_id', 'session_key', 'status', 'admission_id'], string)
    && fields(value, ['running', 'hydrating'], value => typeof value === 'boolean')
    && optional(value.inflight, value => object(value) && fields(value, ['assistant', 'user'], string) && optional(value.streaming, value => typeof value === 'boolean'))
    && optional(value.open_requests, value => Array.isArray(value) && value.every(requestShape))
    && Array.isArray(value.messages) && value.messages.every(message => object(message) && string(message.role)
      && optional(message.text, string))
}
function resultShape(method, value) {
  if (!object(value)) return false
  if (['session.create', 'session.resume', 'session.activate'].includes(method)) return snapshotShape(value)
  if (method === 'client.capabilities') return Array.isArray(value.server_requests) && value.server_requests.every(string)
  if (method === 'session.events.since') return string(value.epoch) && Number.isSafeInteger(value.latest_seq) && value.latest_seq >= 0
    && typeof value.truncated === 'boolean' && Array.isArray(value.events) && value.events.every(eventShape)
    && Array.isArray(value.open_requests) && value.open_requests.every(requestShape)
  if (method === 'model.options') return Array.isArray(value.providers) && value.providers.every(provider => object(provider)
    && string(provider.slug) && optional(provider.models, value => Array.isArray(value) && value.every(string))
    && optional(provider.unavailable_models, value => Array.isArray(value) && value.every(string))
    && optional(provider.authenticated, value => typeof value === 'boolean'))
  if (method === 'config.set') return fields(value, ['scope'], string)
    && fields(value, ['confirm_required', 'deferred'], value => typeof value === 'boolean')
  if (method === 'prompt.submit') return fields(value, ['admission_id', 'status'], string)
  return true
}
function frameShape(value) {
  if (!object(value) || value.jsonrpc !== '2.0') return false
  if (value.method !== undefined) return string(value.method) && !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error') && (value.method === 'event'
    ? value.id === undefined && eventShape(value.params) : requestShape(value))
  return id(value.id) && (Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error'))
    && (!Object.hasOwn(value, 'error') || (object(value.error) && Number.isInteger(value.error.code) && string(value.error.message)))
}
// Bound structure before recursive redaction; JSON.parse itself does not recurse through user callbacks.
function boundedStructure(value) {
  const stack = [[value, 0]]
  while (stack.length) {
    const [item, depth] = stack.pop()
    if (depth > 32) return false
    if (item && typeof item === 'object') for (const nested of Object.values(item)) stack.push([nested, depth + 1])
  }
  return true
}

export function remoteAddress(input, { allowLoopback = false } = {}) {
  let url
  try { url = new URL(input) } catch { throw failure('Enter an HTTPS address for Hermes.') }
  const tunnel = allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!tunnel && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.href.length > 2048) {
    throw failure('Use an HTTPS address without credentials, a query or fragment.')
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

// A socket address carries its credential in the query (token, ticket, internal): whatever
// follows one of those names is never kept, whoever's token it is.
const SOCKET_QUERY = /([?&](?:token|ticket|internal)=)[^&#\s"'<>\\]+/gi
/** Text with the credential of any socket address in it removed. */
export const redactSocketQuery = text => String(text ?? '').replace(SOCKET_QUERY, '$1[redacted]')

// The requests that are about the connection, not a profile: Hermes refuses a field its
// contract does not name, so these never carry one.
const UNSCOPED = new Set(['client.capabilities'])

// Errors are fixed sentences. Never forward a fetch/socket/RPC error, headers or response body
// to the caller: those surfaces can echo credentials, tickets and private remote configuration.
// Known transient values are also removed from model names, rows, and approval descriptions.
export class HermesTransport {
  constructor({ address, profile, credential, authHeaders, allowLoopback = false, redactionSecrets = [], fetch: fetcher = globalThis.fetch, socket = (url, protocols) => new WebSocket(url, protocols), deadlines = HERMES_DEADLINES }) {
    this.address = remoteAddress(address, { allowLoopback })
    this.profile = profile
    this.credential = credential
    this.fetcher = fetcher
    this.socket = socket
    this.deadlines = deadlines
    this.startUntil = Date.now() + deadlines.start
    this.pending = new Map()
    this.listeners = new Set()
    this.authHeaders = authHeaders ?? { Authorization: `Bearer ${credential}` }
    // A session token (the one-time token of an SSH connection, a saved session token)
    // opens the chat socket itself, as Hermes Desktop does: Hermes mints a socket ticket
    // only for a signed-in session (a password sign-in's cookies, a bearer).
    const sessionToken = Object.entries(this.authHeaders).find(([name]) => /^x-hermes-session-token$/i.test(name))?.[1]
    this.socketToken = typeof sessionToken === 'string' && sessionToken ? sessionToken : undefined
    this.secrets = new Set([credential, ...redactionSecrets].filter(value => typeof value === 'string' && value))
    for (const [name, value] of Object.entries(this.authHeaders)) {
      if (typeof value !== 'string' || !value) continue
      this.secrets.add(value)
      if (/^authorization$/i.test(name)) this.secrets.add(value.replace(/^\S+\s+/, ''))
      if (/^cookie$/i.test(name)) for (const pair of value.split(';')) {
        const separator = pair.indexOf('=')
        if (separator >= 0) {
          const cookie = pair.slice(separator + 1).trim()
          if (cookie) this.secrets.add(cookie)
          if (cookie.startsWith('"') && cookie.endsWith('"')) this.secrets.add(cookie.slice(1, -1))
        }
      }
    }
    this.serial = 0
    this.sessionInfos = new Map()
  }

  redact(value) {
    const clean = text => {
      for (const secret of this.secrets) {
        if (!secret) continue
        for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) text = text.split(form).join('[redacted]')
      }
      return text.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/hermes-gateway-ticket\.[A-Za-z0-9._~-]+/g, 'hermes-gateway-ticket.[redacted]')
        .replace(SOCKET_QUERY, '$1[redacted]')
    }
    if (typeof value === 'string') return clean(value)
    if (Array.isArray(value)) return value.map(item => this.redact(item))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [clean(key), /authorization|cookie|ticket|token|secret|password|headers/i.test(key) ? '[redacted]' : this.redact(item)]))
    return value
  }

  text(text = '', flush = false) {
    this.textCarry = (this.textCarry ?? '') + text
    this.textCarry = this.redact(this.textCarry)
    let keep = 0
    if (!flush) for (const secret of this.secrets) {
      if (!secret) continue
      for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
        for (let count = Math.min(form.length - 1, this.textCarry.length); count > keep; count--) {
          if (form.startsWith(this.textCarry.slice(-count))) { keep = count; break }
        }
      }
    }
    const output = this.redact(this.textCarry.slice(0, this.textCarry.length - keep))
    this.textCarry = keep ? this.textCarry.slice(-keep) : ''
    return output
  }

  async bounded(promise, ms, message, code = 'bot/hermes-timeout') {
    let timer
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(failure(message, code)), ms) })]) }
    finally { clearTimeout(timer) }
  }

  async connect() {
    try {
      await this.bounded(this.open(), this.deadlines.start, 'Remote Hermes did not start within 60 seconds.')
      return this
    } catch (error) {
      const unopened = this.unopened === true
      this.close()
      if (unopened) throw await this.refusal()
      if (localFailures.has(error)) throw error
      throw failure('Remote Hermes could not connect. Check the saved credential and address.', 'bot/hermes-connection')
    }
  }

  // A socket that never opened does not say why. One request with the same token tells a
  // token Hermes refuses from a Hermes that is not answering.
  async refusal() {
    const refused = () => failure('Remote Hermes authentication expired or was refused. Replace the saved credential.', 'bot/hermes-auth')
    try {
      const response = await this.bounded(this.fetcher(`${this.address}/api/profiles`, { headers: this.authHeaders, redirect: 'error' }), Math.min(this.deadlines.control, 5000), 'Remote Hermes did not answer.')
      if (response?.status === 401 || response?.status === 403) return refused()
    } catch (error) { if (error?.code === 'bot/hermes-auth') return refused() }
    return failure('Remote Hermes did not open the chat connection. Check that Hermes is running, then test again.', 'bot/hermes-connection')
  }

  // The single-use ticket a signed-in session (cookies, a bearer) opens its socket with.
  async ticket(controller) {
    let response
    try {
      response = await this.fetcher(`${this.address}/api/auth/ws-ticket`, {
        method: 'POST', headers: this.authHeaders,
        redirect: 'error', signal: controller.signal,
      })
    } catch (error) {
      if (error?.code === 'bot/hermes-auth') throw failure('Remote Hermes authentication expired or was refused. Replace the saved credential.', 'bot/hermes-auth')
      if (error?.code === 'bot/hermes-timeout') throw failure('Remote Hermes did not answer within the connection deadline. Test the connection again.', 'bot/hermes-timeout')
      throw failure('Remote Hermes could not connect. Check the saved address and that Hermes is running.', 'bot/hermes-connection')
    }
    if (!response.ok) throw response.status === 401 || response.status === 403
      ? failure('Remote Hermes authentication expired or was refused. Replace the saved credential.', 'bot/hermes-auth')
      : failure('Remote Hermes could not complete the connection request. Check that Hermes is running.', 'bot/hermes-connection')
    let ticket
    try { ticket = (await response.json()).ticket } catch { throw failure('Remote Hermes returned an invalid authentication ticket.', 'bot/hermes-protocol') }
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(ticket)) throw failure('Remote Hermes returned an invalid authentication ticket.', 'bot/hermes-protocol')
    this.secrets.add(ticket)
    return ticket
  }

  async open() {
    const controller = new AbortController()
    this.openAbort = controller
    const ticket = this.socketToken ? undefined : await this.ticket(controller)
    if (this.closed || controller.signal.aborted) throw failure('Remote Hermes startup was cancelled.')
    let readyResolve, readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    // A socket that cannot even be made ends this open before anything waits on `ready`.
    ready.catch(() => {})
    this.readyReject = readyReject
    const url = new URL(`${this.address}/api/ws`)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // The address that holds the token goes to the socket and nowhere else: it is never
    // kept, logged or put in an error. Hermes takes no subprotocol beside a token.
    if (this.socketToken) url.searchParams.set('token', this.socketToken)
    this.ws = this.socket(url.href, this.socketToken ? [] : ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`])
    // With a token on the address, a socket Hermes turns away closes before it says anything.
    let answered = false
    const dropped = () => { if (this.socketToken && !answered && !this.closed) this.unopened = true; this.lost() }
    this.ws.addEventListener('open', () => { answered = true })
    this.ws.addEventListener('message', event => {
      answered = true
      if (this.closed || this.lostNotified) return
      try {
        if (!string(event.data) || Buffer.byteLength(event.data, 'utf8') > FRAME_BYTES) throw failure(INVALID_FRAME, 'bot/hermes-protocol')
        const frame = JSON.parse(event.data)
        if (!boundedStructure(frame) || !frameShape(frame)) throw failure(INVALID_FRAME, 'bot/hermes-protocol')
        if (frame.method === 'event' && frame.params.type === 'gateway.ready') {
          if (frame.params.payload.session_authority === true) { readyReject(failure(CANONICAL, 'bot/hermes-unsupported')); return }
          this.epoch = frame.params.payload.replay_epoch
          readyResolve()
        } else this.receive(frame)
      } catch { this.lost(INVALID_FRAME); this.close() }
    })
    this.ws.addEventListener('close', dropped)
    this.ws.addEventListener('error', dropped)
    await ready
    if (this.closed || controller.signal.aborted) throw failure('Remote Hermes startup was cancelled.')
    this.readyReject = undefined
    const capabilities = await this.request('client.capabilities', { server_requests: true })
    if (!capabilities.server_requests?.includes('approval')) throw failure(CONTRACT, 'bot/hermes-unsupported')
    this.connected = true
  }

  receive(frame) {
    if (frame.method && frame.id !== undefined) {
      for (const listener of this.listeners) listener({ kind: 'question', id: frame.id, method: frame.method, params: this.redact(frame.params), epoch: this.epoch })
      return
    }
    if (frame.method === 'event') {
      const params = this.redact(frame.params)
      if (params.type === 'session.info') this.sessionInfos.set(params.session_id, params.payload)
      for (const listener of this.listeners) listener({ kind: 'event', ...params, epoch: this.epoch })
      return
    }
    const pending = this.pending.get(frame.id)
    if (!pending) return
    if (!frame.error && !resultShape(pending.method, frame.result)) throw failure(INVALID_FRAME, 'bot/hermes-protocol')
    this.pending.delete(frame.id)
    clearTimeout(pending.timer)
    if (frame.error) pending.reject(failure('Remote Hermes refused a control request. Check the remote session.'))
    else pending.resolve(this.redact(frame.result))
  }

  request(method, params = {}, ms = this.deadlines.control) {
    if (this.closed || this.lostNotified) return Promise.reject(failure(LOST))
    const id = ++this.serial
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(failure(method === 'prompt.submit' ? LOST : 'Remote Hermes did not answer a control request within 15 seconds.', method === 'prompt.submit' ? 'bot/hermes' : 'bot/hermes-timeout'))
      }, ms)
      this.pending.set(id, { resolve, reject, timer, method })
      try { this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, ...(this.profile && !UNSCOPED.has(method) ? { profile: this.profile } : {}) } })) }
      catch { this.lost() }
    })
  }

  answer(id, result, unsupported = false) {
    if (this.closed || this.lostNotified) return
    try { this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, ...(unsupported ? { error: { code: -32601, message: 'This client does not support this request.' } } : { result }) })) }
    catch { this.lost() }
  }

  lost(message = LOST) {
    if (this.closed || this.lostNotified) return
    this.lostNotified = true
    this.connected = false
    this.readyReject?.(failure(message))
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(failure(message)) }
    this.pending.clear()
    for (const listener of this.listeners) listener({ kind: 'lost', text: message })
  }

  close() {
    this.openAbort?.abort()
    this.lost()
    this.closed = true
    try { this.ws?.close() } catch {}
  }

  check(snapshot, approvals = true) {
    // Create uses stored_session_id; live resume/activate use session_key (plus info's copy).
    const stored = [snapshot?.stored_session_id, snapshot?.session_key, snapshot?.info?.stored_session_id].filter(Boolean)
    if (new Set(stored).size > 1) throw failure('Remote Hermes returned conflicting stored session IDs.')
    snapshot = { ...snapshot, stored_session_id: stored[0] }
    if (snapshot?.session_authority || snapshot?.protocol === 'hermes-gateway-v1') throw failure(CANONICAL, 'bot/hermes-unsupported')
    if (snapshot?.info?.desktop_contract !== 8) throw failure(CONTRACT, 'bot/hermes-unsupported')
    if (!snapshot.session_id || !snapshot.stored_session_id) throw failure('Remote Hermes did not return both stored and runtime session IDs.')
    // A remote profile that auto-approves cannot honour a restrictive DSH level. Never alter it.
    if (approvals && (snapshot.info.yolo !== false || snapshot.info.approval_mode !== 'manual')) throw failure('Set this remote profile to manual approvals in Hermes before connecting. Automagik does not change its global approval setting.', 'bot/hermes-approvals')
    return snapshot
  }

  async approvalSnapshot(snapshot) {
    snapshot = this.check(snapshot, false)
    const complete = info => info && typeof info.yolo === 'boolean' && typeof info.approval_mode === 'string'
    if (complete(snapshot.info)) return this.check(snapshot)
    let listener
    try {
      const info = await this.bounded(new Promise((resolve, reject) => {
        listener = event => {
          if (event.kind === 'lost') reject(failure(event.text ?? LOST))
          if (event.kind === 'event' && event.type === 'session.info' && event.session_id === snapshot.session_id && complete(event.payload)) resolve(event.payload)
        }
        this.listeners.add(listener)
        const cached = this.sessionInfos.get(snapshot.session_id)
        if (complete(cached)) resolve(cached)
      }), Math.max(1, this.startUntil - Date.now()), 'Remote Hermes did not provide approval metadata within 60 seconds.')
      return this.check({ ...snapshot, info })
    } finally { this.listeners.delete(listener) }
  }

  async session(identity, model) {
    const remaining = () => {
      const ms = this.startUntil - Date.now()
      if (ms <= 0) throw failure('Remote Hermes did not start within 60 seconds.', 'bot/hermes-timeout')
      return Math.min(ms, this.deadlines.control)
    }
    const snapshot = await this.approvalSnapshot(await this.request(identity?.storedSessionId ? 'session.resume' : 'session.create', identity?.storedSessionId
      ? { session_id: identity.storedSessionId, inline_images: false, close_on_disconnect: false }
      : { model: model?.model, provider: model?.provider, idempotency_key: identity?.createKey, close_on_disconnect: false, source: 'automagik' }, remaining()))
    if (identity?.storedSessionId && model && (snapshot.info.model !== model.model || snapshot.info.provider !== model.provider)) {
      if (!safeModel(model.model) || !safeModel(model.provider)) throw failure('Hermes returned an unsupported model identifier.')
      const result = await this.request('config.set', { session_id: snapshot.session_id, key: 'model', value: `${model.model} --provider ${model.provider} --session` }, remaining())
      if (result.scope !== 'session' || result.confirm_required || result.deferred) throw failure('Hermes has not applied this session model. Confirm it in Hermes before sending again.')
    }
    return snapshot
  }

  async models() {
    const result = await this.request('model.options', { include_unconfigured: false })
    return (result.providers ?? []).filter(provider => provider.authenticated !== false && safeModel(provider.slug)).flatMap(provider =>
      (provider.models ?? []).filter(id => safeModel(id) && !provider.unavailable_models?.includes(id)).map(model => ({ id: `${provider.slug}:${model}`, name: model, provider: provider.slug, model })))
  }
}

// Transport-neutral chat boundary. A run owns only one turn; resume always inspects the
// existing session before any submit. In particular no pending submit is ever replayed.
export class RemoteChat {
  constructor(transport, { identity = {}, save = async () => {}, question } = {}) {
    this.transport = transport
    this.identity = identity
    this.save = save
    this.question = question
    this.queue = []
    this.tools = new Map()
    this.questions = new Map()
    this.cancelledQuestions = new Set()
    this.streamed = ''
    this.off = event => this.receive(event)
    transport.listeners.add(this.off)
  }

  push(row) { this.queue.push(row); this.wake?.(); this.wake = undefined }

  async next() {
    if (!this.queue.length) await new Promise(resolve => { this.wake = resolve })
    return this.queue.shift()
  }

  receive(event) {
    if (event.kind === 'lost') {
      this.identity.uncertain = true
      for (const tool of this.tools.values()) { tool.status = 'unknown'; tool.done?.() }
      void this.save().catch(() => {})
      this.push({ kind: 'error', text: event.text ?? LOST })
      return
    }
    if (this.reconciling) { this.reconciling.push(event); return }
    if (event.epoch && this.identity.epoch && event.epoch !== this.identity.epoch) return
    const sid = event.kind === 'question' ? event.params?.session_id : event.session_id
    if (sid !== this.identity.runtimeSessionId && sid !== this.identity.storedSessionId) return
    if (event.kind === 'question') { if (this.question) void this.control(event); return }
    if (Number.isInteger(event.seq)) {
      if (event.seq <= (this.identity.lastSeq ?? 0)) return
      this.identity.lastSeq = event.seq
    }
    const payload = event.payload ?? {}
    if (event.type === 'request.cancel') {
      this.cancelledQuestions.add(payload.id)
      this.questions.delete(payload.id)
      return
    }
    if (event.type === 'session.info' && typeof payload.stored_session_id === 'string' && payload.stored_session_id) {
      this.identity.storedSessionId = payload.stored_session_id
      void this.save().catch(() => {})
    }
    if (event.type === 'message.delta' && typeof payload.text === 'string') {
      const text = Number.isInteger(payload.offset) ? payload.text.slice(Math.max(0, this.streamed.length - payload.offset)) : payload.text
      this.streamed += text
      const safe = this.transport.text(text)
      if (safe) this.push({ kind: 'text', text: safe })
    }
    if (event.type === 'message.interim') {
      const safe = this.transport.text(!payload.already_streamed ? payload.text ?? '' : '', true)
      if (safe) this.push({ kind: 'text', text: safe })
      this.streamed = ''
    }
    if (event.type === 'tool.start') {
      const safe = this.transport.text('', true)
      if (safe) this.push({ kind: 'text', text: safe })
      const tool = { id: payload.tool_id, title: payload.name, input: payload.args, status: 'running' }
      this.tools.set(tool.id, tool)
      this.push({ kind: 'tool', tool })
    }
    if (event.type === 'tool.complete') {
      const tool = this.tools.get(payload.tool_id)
      if (tool) { tool.status = 'completed'; tool.text = payload.result_text ?? payload.summary ?? ''; tool.done?.() }
    }
    if (event.type === 'message.complete') {
      this.terminalCounter = (this.terminalCounter ?? 0) + 1
      this.terminalPayload = payload
      let rest = ''
      if (!payload.response_reused && typeof payload.text === 'string') {
        rest = payload.text.startsWith(this.streamed) ? payload.text.slice(this.streamed.length) : payload.text
      }
      const safe = this.transport.text(rest, true)
      if (safe) this.push({ kind: 'text', text: safe })
      this.identity.uncertain = false
      this.identity.pendingSubmit = false
      this.stopped?.()
      const terminal = payload.status === 'error' || payload.error || payload.failure_reason
        ? { kind: 'error', text: 'Remote Hermes reported a failed turn. Review the remote session.' }
        : payload.status === 'interrupted' ? { kind: 'aborted', text: 'The remote turn was interrupted. Background remote work may continue.' } : { kind: 'done' }
      const generation = this.generation
      void this.save().then(() => { if (generation === this.generation) this.push(terminal) }, () => { if (generation === this.generation) this.push({ kind: 'error', text: 'Remote session identity could not be saved.' }) })
    }
    if (event.type === 'error') {
      this.identity.uncertain = true
      void this.save().catch(() => {})
      this.push({ kind: 'error', text: 'Remote Hermes reported a turn failure. Inspect the remote session before sending again.' })
    }
  }

  async control(event) {
    const epoch = event.epoch ?? this.transport.epoch
    if (this.reconciling || epoch !== this.transport.epoch || (epoch && this.identity.epoch && epoch !== this.identity.epoch)) return
    if (event.method === 'approval' && !this.question) return
    if (event.params?.session_id !== this.identity.runtimeSessionId && event.params?.session_id !== this.identity.storedSessionId) return
    if (this.questions.has(event.id) || this.cancelledQuestions.has(event.id)) return
    this.questions.set(event.id, true)
    const generation = this.generation
    if (event.method !== 'approval') { this.transport.answer(event.id, undefined, true); return }
    let choice = 'deny'
    try {
      choice = await this.transport.bounded(Promise.resolve(this.question(event.params)), this.transport.deadlines.control, 'Approval deadline expired.')
    } catch {}
    if (this.reconciling || this.cancelledQuestions.has(event.id) || generation !== this.generation || epoch !== this.transport.epoch
      || (epoch && this.identity.epoch && epoch !== this.identity.epoch)) return
    this.transport.answer(event.id, { choice: choice === 'once' ? 'once' : 'deny' })
  }

  async prepare(model) {
    await this.save()
    const snapshot = await this.transport.session(this.identity, model)
    Object.assign(this.identity, { runtimeSessionId: snapshot.session_id, storedSessionId: snapshot.stored_session_id })
    if (snapshot.admission_id) this.identity.admissionId = snapshot.admission_id
    await this.save()
    return snapshot
  }

  resetStream() {
    this.generation = (this.generation ?? 0) + 1
    this.queue.length = 0
    for (const tool of this.tools.values()) { tool.status = 'unknown'; tool.done?.() }
    this.tools.clear()
    this.questions.clear()
    this.cancelledQuestions.clear()
    this.streamed = ''
    this.transport.textCarry = ''
  }

  async reconcile({ answerQuestions = false } = {}) {
    // Fence outstanding answers before resume, replay or persistence can yield. A restarted
    // server can reuse request IDs while an old DSH approval is still awaiting a choice.
    this.generation = (this.generation ?? 0) + 1
    this.reconciling = []
    try {
      await this.prepare()
      const replay = await this.transport.request('session.events.since', {
        session_id: this.identity.runtimeSessionId, last_seen: this.identity.lastSeq ?? 0, replay_epoch: this.identity.epoch,
      })
      const changedEpoch = this.identity.epoch !== replay.epoch
      const gap = replay.truncated || Boolean(this.identity.epoch && changedEpoch)
      this.resetStream()
      this.identity.epoch = replay.epoch
      this.transport.epoch = replay.epoch
      this.identity.lastSeq = changedEpoch ? replay.latest_seq : Math.max(this.identity.lastSeq ?? 0, replay.latest_seq)
      // Buffer live events while fetching an authoritative snapshot. A terminal received
      // during the fetch requires a newer snapshot; no old queued delta can cross epochs.
      // Controls can also be emitted after _open_requests was captured but before the
      // reply was written. Re-read their current pending state before answering any.
      const snapshotChanges = () => this.reconciling.filter(event => event.epoch === replay.epoch
        && (event.kind === 'question' ? [this.identity.runtimeSessionId, this.identity.storedSessionId].includes(event.params?.session_id)
          : ['message.complete', 'request.cancel'].includes(event.type) && [this.identity.runtimeSessionId, this.identity.storedSessionId].includes(event.session_id))).length
      let snapshot
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = snapshotChanges()
        snapshot = await this.transport.approvalSnapshot(await this.transport.request('session.activate', { session_id: this.identity.runtimeSessionId }))
        if (snapshotChanges() === before) break
        if (attempt === 2) throw failure('Remote session changed while reconciling. Reconnect and reconcile again before sending.')
      }
      Object.assign(this.identity, { runtimeSessionId: snapshot.session_id, storedSessionId: snapshot.stored_session_id })
      for (const event of this.reconciling) if (event.epoch === replay.epoch && Number.isSafeInteger(event.seq)) this.identity.lastSeq = Math.max(this.identity.lastSeq, event.seq)
      this.identity.uncertain = snapshot.running === true || snapshot.info?.running === true || snapshot.hydrating === true || snapshot.inflight?.streaming === true
        || ['starting', 'waiting', 'working', 'streaming', 'resuming'].includes(snapshot.status) || (snapshot.open_requests?.length ?? 0) > 0 || Boolean(snapshot.auto_continue)
      if (!this.identity.uncertain) this.identity.pendingSubmit = false
      this.reconciling = undefined
      await this.save()
      if (answerQuestions) for (const request of snapshot.open_requests ?? []) void this.control({ ...request, kind: 'question', epoch: replay.epoch })
      return { snapshot, gap, unknown: this.identity.uncertain }
    } finally { this.reconciling = undefined }
  }

  async submit(text, model) {
    if (this.identity.pendingSubmit || this.identity.uncertain) throw failure('Reconcile the existing remote session before sending again; its outcome is unknown.')
    await this.prepare(model)
    // A completed turn may resume on a newly owned SSH backend. Its sequence numbers
    // start again; only uncertain turns take the reconciliation path above.
    if (this.identity.epoch !== this.transport.epoch) {
      this.resetStream()
      this.identity.lastSeq = 0
    }
    this.identity.epoch = this.transport.epoch
    this.identity.pendingSubmit = true
    await this.save() // Durable before any submit bytes leave.
    try {
      const result = await this.transport.request('prompt.submit', { session_id: this.identity.runtimeSessionId, text })
      if (result.admission_id) this.identity.admissionId = result.admission_id
      await this.save()
    } catch {
      this.identity.uncertain = true
      await this.save()
      throw failure(LOST)
    }
  }

  async stop() {
    if (this.stopping) return this.stopping
    this.stopping = this.stopOnce()
    return this.stopping
  }

  async stopOnce() {
    if (!this.identity.pendingSubmit) { this.dispose(); return }
    this.identity.uncertain = true
    await this.save()
    try {
      // An interrupt reply is only receipt. Wait for message.complete during the cancel grace.
      await this.transport.bounded((async () => {
        await this.transport.request('session.interrupt', { session_id: this.identity.runtimeSessionId })
        if (this.identity.pendingSubmit) await new Promise(resolve => { this.stopped = resolve })
      })(), this.transport.deadlines.cancel, LOST)
    } catch { this.push({ kind: 'error', text: LOST }) }
    await this.save()
    // Closing detaches this viewer; it says nothing about remote children.
    this.dispose()
  }

  dispose() {
    this.transport.listeners.delete(this.off)
    for (const tool of this.tools.values()) { if (tool.status === 'running') tool.status = 'unknown'; tool.done?.() }
    this.transport.close()
  }
}
