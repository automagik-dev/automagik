// Native Hermes wire. Its public boundary is rows, questions and durable identities; no ACP SDK.
export const HERMES_DEADLINES = Object.freeze({ start: 60_000, control: 15_000, cancel: 5000 })
export const LOST = 'Connection lost; remote outcome unknown'
export const CONTRACT = 'Remote Hermes requires standalone Desktop contract 8 with server-request approvals.'
export const CANONICAL = 'Canonical-authority Hermes is not supported. Use a standalone Desktop contract 8 backend.'
const failure = message => Object.assign(new Error(message), { code: 'bot/hermes' })
const safeModel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]@-]{0,200}$/.test(value)

export function remoteAddress(input) {
  let url
  try { url = new URL(input) } catch { throw failure('Enter an HTTPS address for Hermes.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw failure('Use an HTTPS origin without credentials, a path, query or fragment.')
  }
  return url.origin
}

// Errors are fixed sentences. Never forward a fetch/socket/RPC error, headers or response body
// to the caller: those surfaces can echo credentials, tickets and private remote configuration.
// Known transient values are also removed from model names, rows, and approval descriptions.
export class HermesTransport {
  constructor({ address, profile, credential, fetch: fetcher = globalThis.fetch, socket = (url, protocols) => new WebSocket(url, protocols), deadlines = HERMES_DEADLINES }) {
    this.address = remoteAddress(address)
    this.profile = profile
    this.credential = credential
    this.fetcher = fetcher
    this.socket = socket
    this.deadlines = deadlines
    this.startUntil = Date.now() + deadlines.start
    this.pending = new Map()
    this.listeners = new Set()
    this.secrets = new Set([credential])
    this.serial = 0
  }

  redact(value) {
    const clean = text => {
      for (const secret of this.secrets) {
        if (!secret) continue
        for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) text = text.split(form).join('[redacted]')
      }
      return text.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/hermes-gateway-ticket\.[A-Za-z0-9._~-]+/g, 'hermes-gateway-ticket.[redacted]')
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

  async bounded(promise, ms, message) {
    let timer
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(failure(message)), ms) })]) }
    finally { clearTimeout(timer) }
  }

  async connect() {
    try {
      await this.bounded(this.open(), this.deadlines.start, 'Remote Hermes did not start within 60 seconds.')
      return this
    } catch (error) {
      this.close()
      if (error?.code === 'bot/hermes') throw error
      throw failure('Remote Hermes could not connect. Check the saved credential and address.')
    }
  }

  async open() {
    const controller = new AbortController()
    this.openAbort = controller
    let response
    try {
      response = await this.fetcher(`${this.address}/api/auth/ws-ticket`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.credential}` },
        redirect: 'error', signal: controller.signal,
      })
    } catch { throw failure('Remote Hermes authentication failed. Check the saved credential.') }
    if (!response.ok) throw failure('Remote Hermes authentication expired or was refused. Replace the saved credential.')
    let ticket
    try { ticket = (await response.json()).ticket } catch { throw failure('Remote Hermes returned an invalid authentication ticket.') }
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(ticket)) throw failure('Remote Hermes returned an invalid authentication ticket.')
    this.secrets.add(ticket)
    if (this.closed || controller.signal.aborted) throw failure('Remote Hermes startup was cancelled.')
    let readyResolve, readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    this.readyReject = readyReject
    const url = new URL('/api/ws', this.address)
    url.protocol = 'wss:'
    this.ws = this.socket(url.href, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`])
    this.ws.addEventListener('message', event => {
      let frame
      try { frame = JSON.parse(event.data) } catch { this.lost(); return }
      if (frame.method === 'event' && frame.params?.type === 'gateway.ready') {
        if (frame.params.payload?.session_authority === true) { readyReject(failure(CANONICAL)); return }
        this.epoch = frame.params.payload?.replay_epoch
        readyResolve()
      } else this.receive(frame)
    })
    this.ws.addEventListener('close', () => this.lost())
    this.ws.addEventListener('error', () => this.lost())
    await ready
    if (this.closed || controller.signal.aborted) throw failure('Remote Hermes startup was cancelled.')
    this.readyReject = undefined
    const capabilities = await this.request('client.capabilities', { server_requests: true })
    if (!capabilities.server_requests?.includes('approval')) throw failure(CONTRACT)
    this.connected = true
  }

  receive(frame) {
    if (frame.method && frame.id !== undefined) {
      for (const listener of this.listeners) listener({ kind: 'question', id: frame.id, method: frame.method, params: this.redact(frame.params) })
      return
    }
    if (frame.method === 'event') {
      const params = this.redact(frame.params)
      for (const listener of this.listeners) listener({ kind: 'event', ...params })
      return
    }
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    clearTimeout(pending.timer)
    if (frame.error) pending.reject(failure('Remote Hermes refused a control request. Check the remote session.'))
    else pending.resolve(this.redact(frame.result))
  }

  request(method, params = {}, ms = this.deadlines.control) {
    const id = ++this.serial
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(failure(method === 'prompt.submit' ? LOST : 'Remote Hermes did not answer a control request within 15 seconds.'))
      }, ms)
      this.pending.set(id, { resolve, reject, timer })
      try { this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, ...(this.profile ? { profile: this.profile } : {}) } })) }
      catch { this.lost() }
    })
  }

  answer(id, result, unsupported = false) {
    try { this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, ...(unsupported ? { error: { code: -32601, message: 'This client does not support this request.' } } : { result }) })) }
    catch { this.lost() }
  }

  lost() {
    if (this.closed) return
    this.connected = false
    this.readyReject?.(failure(LOST))
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(failure(LOST)) }
    this.pending.clear()
    for (const listener of this.listeners) listener({ kind: 'lost' })
  }

  close() {
    this.openAbort?.abort()
    this.lost()
    this.closed = true
    try { this.ws?.close() } catch {}
  }

  check(snapshot) {
    if (snapshot?.session_authority || snapshot?.protocol === 'hermes-gateway-v1') throw failure(CANONICAL)
    if (snapshot?.info?.desktop_contract !== 8) throw failure(CONTRACT)
    if (!snapshot.session_id || !snapshot.stored_session_id) throw failure('Remote Hermes did not return both stored and runtime session IDs.')
    // A remote profile that auto-approves cannot honour a restrictive DSH level. Never alter it.
    if (snapshot.info.yolo === true || snapshot.info.approval_mode !== 'manual') throw failure('Set this remote profile to manual approvals in Hermes before connecting. DSH does not change its global approval setting.')
    return snapshot
  }

  async session(identity, model) {
    const remaining = () => {
      const ms = this.startUntil - Date.now()
      if (ms <= 0) throw failure('Remote Hermes did not start within 60 seconds.')
      return Math.min(ms, this.deadlines.control)
    }
    const snapshot = this.check(await this.request(identity?.storedSessionId ? 'session.resume' : 'session.create', identity?.storedSessionId
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
      this.push({ kind: 'error', text: LOST })
      return
    }
    const sid = event.kind === 'question' ? event.params?.session_id : event.session_id
    if (sid !== this.identity.runtimeSessionId && sid !== this.identity.storedSessionId) return
    if (event.kind === 'question') { if (this.question) void this.control(event); return }
    if (Number.isInteger(event.seq)) {
      if (event.seq <= (this.identity.lastSeq ?? 0)) return
      this.identity.lastSeq = event.seq
    }
    const payload = event.payload ?? {}
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
      void this.save().then(() => this.push(terminal), () => this.push({ kind: 'error', text: 'Remote session identity could not be saved.' }))
    }
    if (event.type === 'error') {
      this.identity.uncertain = true
      void this.save().catch(() => {})
      this.push({ kind: 'error', text: 'Remote Hermes reported a turn failure. Inspect the remote session before sending again.' })
    }
  }

  async control(event) {
    if (event.method === 'approval' && !this.question) return
    if (this.questions.has(event.id)) return
    this.questions.set(event.id, true)
    if (event.method !== 'approval') { this.transport.answer(event.id, undefined, true); return }
    let choice = 'deny'
    try {
      choice = await this.transport.bounded(Promise.resolve(this.question(event.params)), this.transport.deadlines.control, 'Approval deadline expired.')
    } catch {}
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

  async reconcile({ answerQuestions = false } = {}) {
    await this.prepare()
    const replay = await this.transport.request('session.events.since', {
      session_id: this.identity.runtimeSessionId, last_seen: this.identity.lastSeq ?? 0, replay_epoch: this.identity.epoch,
    })
    const gap = replay.truncated || (this.identity.epoch && replay.epoch !== this.identity.epoch)
    // Snapshot AFTER replay: a completion between resume and replay must not be lost when
    // advancing the replay watermark. Live events for the resumed runtime now reach receive.
    let snapshot
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = this.terminalCounter ?? 0
      snapshot = this.transport.check(await this.transport.request('session.activate', { session_id: this.identity.runtimeSessionId }))
      if ((this.terminalCounter ?? 0) === before) break
      if (attempt === 2) throw failure('Remote session changed while reconciling. Reconnect and reconcile again before sending.')
    }
    Object.assign(this.identity, { runtimeSessionId: snapshot.session_id, storedSessionId: snapshot.stored_session_id })
    this.identity.epoch = replay.epoch
    this.identity.lastSeq = Math.max(this.identity.lastSeq ?? 0, replay.latest_seq)
    this.identity.uncertain = snapshot.running === true || snapshot.info?.running === true || snapshot.hydrating === true || snapshot.inflight?.streaming === true
      || ['starting', 'waiting', 'working', 'streaming', 'resuming'].includes(snapshot.status) || (snapshot.open_requests?.length ?? 0) > 0 || Boolean(snapshot.auto_continue)
    if (!this.identity.uncertain) this.identity.pendingSubmit = false
    await this.save()
    if (answerQuestions) for (const request of snapshot.open_requests ?? replay.open_requests ?? []) void this.control({ ...request, kind: 'question' })
    // Always use a fresh authoritative snapshot: a replay gap must never append guessed deltas.
    return { snapshot, gap, unknown: this.identity.uncertain }
  }

  async submit(text, model) {
    if (this.identity.pendingSubmit || this.identity.uncertain) throw failure('Reconcile the existing remote session before sending again; its outcome is unknown.')
    await this.prepare(model)
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
