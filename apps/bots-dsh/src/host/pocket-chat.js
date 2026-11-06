// Pocket live chat for the team's own Bots (#517). A paired phone already sees Herdr's terminal
// agents through Pocket Link (RFC 0015); this is the source beside them for the Bots this plugin
// runs, read from their DSH Session logs instead of a screen. Claude, Codex and omp panes keep
// their transcript > status > screen sources unchanged: none of this touches them.
//
// - Read only. It lists, follows and pages. It never prompts, cancels, answers an approval or a
//   question, and never opens DSH's owner event stream (`$events`), so a pending approval can
//   never be routed to, or claimed by, the phone. A pending approval or question shows as a row
//   that says to answer on the computer.
// - Own Bots only: each live Bot's own current chat Session. No group, task or archived Sessions,
//   no subagents (a Session whose header says `origin: 'subagent'` is refused).
// - No import of a DSH package. The Session API is DSH 0.2.2's Session Controller (`follow`,
//   `events`, `state`, `observeState`), reached through `ctx.sessionController`, behind a
//   capability check and a lazy import of the adapter (pocket-chat-adapter.js). On a runtime
//   without those methods the source is absent: nothing is listed and no socket is opened.
// - Served to Pocket Link over a Unix socket in the team's home, owner-only (pocket-socket.js).
import { startPocketSocket } from './pocket-socket.js'

/** The Session Controller methods this source needs (DSH 0.2.2); all of them, or none is used. */
export const SESSION_METHODS = Object.freeze(['follow', 'events', 'state', 'observeState'])
export const hasSessionApi = controller => controller != null && SESSION_METHODS.every(name => typeof controller[name] === 'function')

/** What every read-only row, status and refusal tells the person. */
export const ANSWER_ON_COMPUTER = 'Answer on the computer'
/** Rows kept per followed Session (the bridge keeps as many for a terminal, RFC 0015). */
export const KEEP_ROWS = 500
/** One page: at most this many rows and bytes of JSON (Pocket Link's backfill limits). */
export const PAGE_ROWS = 200
export const PAGE_BYTES = 1024 * 1024
/** A row's text is cut here, a tool's input or output preview here (RFC 0015 limits). */
export const TEXT_MAX = 64 * 1024
export const PREVIEW_MAX = 8 * 1024
/** While a turn runs, the state is read again this often: a pending approval alone does not
 *  wake `observeState` (dsh-api-session-controller types.d.ts:584-585). */
export const STATE_POLL_MS = 2000
/** Sessions followed at once. */
export const MAX_FOLLOWED = 8

const TERMINAL_PREFIX = 'dsh:'
const realTimers = { setInterval, clearInterval }

export const terminalOf = botId => `${TERMINAL_PREFIX}${botId}`
export const botIdOf = terminal => (typeof terminal === 'string' && terminal.startsWith(TERMINAL_PREFIX) && terminal.length > TERMINAL_PREFIX.length
  ? terminal.slice(TERMINAL_PREFIX.length)
  : null)

/** A row id: `dsh:<sessionId>:<seq>`, with `#<part>` when one event makes more than one row. */
export const rowIdOf = (sessionId, seq, part) => `${TERMINAL_PREFIX}${sessionId}:${seq}${part ? `#${part}` : ''}`

/** The Session and event seq a row id names, or null. */
export function cursorOf(id) {
  if (typeof id !== 'string' || !id.startsWith(TERMINAL_PREFIX)) return null
  const rest = id.slice(TERMINAL_PREFIX.length)
  const at = rest.lastIndexOf(':')
  if (at <= 0) return null
  const seq = Number(rest.slice(at + 1).split('#')[0])
  return Number.isSafeInteger(seq) && seq >= 0 ? { sessionId: rest.slice(0, at), seq } : null
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)
const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
}
const count = value => (Number.isFinite(value) && value >= 0 ? value : 0)

/**
 * The Pocket rows one committed Session event makes (Pocket Link chat/types.js row kinds).
 * `scope` carries what the fold needs across events: the open turn and the tool-call rows by call id.
 * @param {{ type: string, seq: number, time?: number, data?: any }} event
 * @param {{ sessionId: string, turn: number, calls: Map<string, string> }} scope
 */
export function rowsOf(event, scope) {
  const data = event?.data ?? {}
  if (Number.isInteger(data.turn)) scope.turn = data.turn
  if (!Number.isSafeInteger(event?.seq)) return []
  const base = part => ({ id: rowIdOf(scope.sessionId, event.seq, part), turn: scope.turn, at: Number.isFinite(event.time) ? event.time : null, source: 'session' })
  switch (event.type) {
    case 'user/message': {
      // A person's prompt only: injected context (file notices, skills, reminders) is not chat.
      if (data.role !== 'user' || data.source?.kind !== 'user') return []
      const text = textOf(data.content)
      return text.trim() ? [{ ...base(), kind: 'text', role: 'user', text: cut(text, TEXT_MAX) }] : []
    }
    case 'assistant/message': {
      const rows = []
      const text = textOf(data.message?.content)
      if (text.trim()) rows.push({ ...base(), kind: 'text', role: 'assistant', text: cut(text, TEXT_MAX), ...(data.interrupted === true ? { interrupted: true } : {}) })
      const usage = data.usage
      if (usage && typeof usage === 'object') rows.push({ ...base('tokens'), kind: 'tokens', input: count(usage.inputTokens), output: count(usage.outputTokens), cache: count(usage.cacheReadTokens) })
      return rows
    }
    case 'tool/call': {
      const row = { ...base(), kind: 'tool-call', tool: String(data.name ?? ''), summary: String(data.name ?? ''), input: cut(typeof data.arguments === 'string' ? data.arguments : '', PREVIEW_MAX) }
      if (typeof data.callId === 'string') scope.calls.set(data.callId, row.id)
      return [row]
    }
    case 'tool/result': {
      const message = data.message ?? {}
      const call = scope.calls.get(message.toolCallId) ?? null
      return [{ ...base(), kind: 'tool-result', call, ok: message.isError !== true, output: cut(textOf(message.content), PREVIEW_MAX) }]
    }
    default:
      return []
  }
}

/** Pocket status from a Session state (`SessionState`, dsh-api-session-controller types.d.ts:578-588). */
export function statusOf(state, turn = 0) {
  const pending = Array.isArray(state?.pendingInput) ? state.pendingInput : []
  if (pending.includes('approval')) return { state: 'blocked', kind: 'permission', msg: ANSWER_ON_COMPUTER, turn }
  if (pending.includes('question')) return { state: 'blocked', kind: 'question', msg: ANSWER_ON_COMPUTER, turn }
  if (pending.length) return { state: 'blocked', kind: null, msg: ANSWER_ON_COMPUTER, turn }
  return { state: state?.running === true ? 'working' : 'idle', kind: null, msg: '', turn }
}

/**
 * The read-only row for what the Session waits on, or null. It has no buttons and no tool input:
 * the state does not say which call is pending, and the tool-call row already shows it.
 */
export function pendingRowOf(state, sessionId, turn = 0) {
  const pending = Array.isArray(state?.pendingInput) ? state.pendingInput : []
  const at = Number.isSafeInteger(state?.cursor) ? state.cursor : 0
  if (pending.includes('approval')) {
    return { id: rowIdOf(sessionId, at, 'approval'), turn, at: null, source: 'session', kind: 'approval', tool: '', summary: ANSWER_ON_COMPUTER, choices: [], open: true, answerable: false }
  }
  if (pending.includes('question')) {
    return { id: rowIdOf(sessionId, at, 'question'), turn, at: null, source: 'session', kind: 'question', prompt: ANSWER_ON_COMPUTER, options: [], multi: false, answerable: false }
  }
  return null
}

/** The newest rows that fit one page. */
export function pageOf(rows, limit = PAGE_ROWS) {
  const out = []
  let bytes = 0
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const size = Buffer.byteLength(JSON.stringify(rows[i]))
    if (bytes + size > PAGE_BYTES) break
    bytes += size
    out.unshift(rows[i])
  }
  return out
}

const seqOf = row => cursorOf(row.id)?.seq ?? -1

/** What the phone may never do here, and why. */
export function refusal(id) {
  return { state: 'refused', ok: false, reason: 'read-only', message: ANSWER_ON_COMPUTER, ...(id === undefined ? {} : { id }) }
}

/**
 * The source: one follow per watched Bot's Session, shared by every listener of it.
 * @param {{ adapter: { follow(sessionId: string, signal: AbortSignal): AsyncIterable<any>,
 *   events(sessionId: string, page: { beforeSeq?: number, maxMessages?: number }, signal: AbortSignal): Promise<{ records: any[], hasMore: boolean }>,
 *   state(sessionId: string, signal: AbortSignal): Promise<any>, observeState(sessionId: string, signal: AbortSignal): AsyncIterable<any> },
 *   bots: () => Promise<Array<{ id: string, name: string, sessionId: string }>>, timers?: typeof realTimers, pollMs?: number,
 *   keep?: number, maxFollowed?: number, log?: (...args: any[]) => void }} options
 */
export class DshChatSource {
  constructor({ adapter, bots, timers = realTimers, pollMs = STATE_POLL_MS, keep = KEEP_ROWS, maxFollowed = MAX_FOLLOWED, log = () => {} }) {
    Object.assign(this, { adapter, bots, timers, pollMs, keep, maxFollowed, log })
    /** botId -> entry */
    this.entries = new Map()
  }

  /** The Bots a phone can open, each as `dsh:<botId>`. */
  async list() {
    const bots = await this.bots()
    return bots.map(bot => ({
      terminal: terminalOf(bot.id), machine: null, agent: 'dsh', title: bot.name ?? '',
      status: this.entries.get(bot.id)?.status ?? statusOf(null), chat: 'session',
    }))
  }

  /**
   * Start watching a Bot's chat. The listener gets a `snapshot` first, then `rows`, `status`,
   * `approval` and `question` events, and `gone` if the Session stops being followable.
   * @returns {Promise<{ ok: true, close(): void, backfill(before: string, limit?: number): Promise<any[]> } | { ok: false, reason: string }>}
   */
  async watch(terminal, listener, { after } = {}) {
    const botId = botIdOf(terminal)
    if (botId === null) return { ok: false, reason: 'not-found' }
    const bot = (await this.bots()).find(item => item.id === botId)
    if (!bot) return { ok: false, reason: 'not-found' }
    let entry = this.entries.get(botId)
    if (entry && entry.sessionId !== bot.sessionId) { this.drop(entry, 'moved'); entry = undefined }
    if (!entry) {
      if (this.entries.size >= this.maxFollowed) return { ok: false, reason: 'too-many' }
      entry = this.open(bot)
      this.entries.set(botId, entry)
    }
    let opened
    try { opened = await entry.ready } catch { opened = { ok: false, reason: 'unavailable' } }
    if (!opened.ok) { this.drop(entry); return opened }
    entry.listeners.add(listener)
    this.emitTo(listener, await this.snapshotFor(entry, after))
    if (entry.question) this.emitTo(listener, { type: 'question', row: entry.question })
    return {
      ok: true,
      close: () => this.leave(entry, listener),
      backfill: (before, limit) => this.backfill(entry, before, limit),
    }
  }

  open(bot) {
    const controller = new AbortController()
    const entry = {
      botId: bot.id, sessionId: bot.sessionId, controller, listeners: new Set(), rows: [], floorSeq: 0, cursor: -1,
      scope: { sessionId: bot.sessionId, turn: 0, calls: new Map() }, status: statusOf(null), approval: null, question: null, poller: null, gone: false,
    }
    entry.ready = this.start(entry)
    return entry
  }

  async start(entry) {
    const { signal } = entry.controller
    const stream = this.adapter.follow(entry.sessionId, signal)[Symbol.asyncIterator]()
    const first = await stream.next()
    const opening = first.value
    if (first.done || opening?.type !== 'snapshot') return { ok: false, reason: 'unavailable' }
    if (opening.header?.origin === 'subagent') return { ok: false, reason: 'subagent' }
    const records = Array.isArray(opening.records) ? opening.records : []
    entry.floorSeq = records.length ? records[0].event.seq : (Number.isSafeInteger(opening.cursor) ? opening.cursor + 1 : 0)
    entry.cursor = Number.isSafeInteger(opening.cursor) ? opening.cursor : -1
    this.keepRows(entry, records.flatMap(record => rowsOf(record.event, entry.scope)))
    this.applyState(entry, await this.adapter.state(entry.sessionId, signal), { quiet: true })
    void this.pump(entry, stream)
    void this.watchState(entry)
    entry.poller = this.timers.setInterval(() => { if (entry.status.state !== 'idle') void this.readState(entry) }, this.pollMs)
    entry.poller?.unref?.()
    return { ok: true }
  }

  keepRows(entry, rows) {
    if (!rows.length) return
    entry.rows.push(...rows)
    if (entry.rows.length > this.keep) {
      entry.rows.splice(0, entry.rows.length - this.keep)
      entry.floorSeq = seqOf(entry.rows[0])
    }
  }

  async pump(entry, stream) {
    try {
      for (;;) {
        const { value: frame, done } = await stream.next()
        if (done || entry.gone) break
        if (frame?.type !== 'event' || !Number.isSafeInteger(frame.event?.seq)) continue
        entry.cursor = frame.event.seq
        const rows = rowsOf(frame.event, entry.scope)
        if (rows.length) { this.keepRows(entry, rows); this.emit(entry, { type: 'rows', rows }) }
        // A call can be waiting for approval now; turn edges change what is running.
        if (frame.event.type === 'tool/call' || frame.event.type === 'turn/start' || frame.event.type === 'turn/end') void this.readState(entry)
      }
      if (!entry.gone) this.drop(entry, 'ended')
    } catch (error) {
      if (!entry.gone) { this.log('pocket chat: follow ended: %s', error?.message ?? error); this.drop(entry, 'ended') }
    }
  }

  async watchState(entry) {
    try {
      for await (const state of this.adapter.observeState(entry.sessionId, entry.controller.signal)) {
        if (entry.gone) break
        this.applyState(entry, state)
      }
    } catch {
      // The follow decides when the chat is gone; the poll keeps the state meanwhile.
    }
  }

  async readState(entry) {
    if (entry.gone || entry.reading) return
    entry.reading = true
    try { this.applyState(entry, await this.adapter.state(entry.sessionId, entry.controller.signal)) } catch {} finally { entry.reading = false }
  }

  applyState(entry, state, { quiet = false } = {}) {
    if (entry.gone || state == null) return
    const status = statusOf(state, entry.scope.turn)
    const changed = ['state', 'kind', 'msg', 'turn'].some(key => status[key] !== entry.status[key])
    entry.status = status
    const row = pendingRowOf(state, entry.sessionId, entry.scope.turn)
    const approval = row?.kind === 'approval' ? row : null
    const question = row?.kind === 'question' ? row : null
    if (quiet) { entry.approval = approval; entry.question = question; return }
    if (changed) this.emit(entry, { type: 'status', status })
    if (entry.approval && entry.approval.id !== approval?.id) this.emit(entry, { type: 'approval', row: { ...entry.approval, open: false } })
    if (approval && entry.approval?.id !== approval.id) this.emit(entry, { type: 'approval', row: approval })
    if (question && entry.question?.id !== question.id) this.emit(entry, { type: 'question', row: question })
    entry.approval = approval
    entry.question = question
  }

  /**
   * Where the chat stands for one listener. A cursor in this Session gets what it missed (paging
   * older events when it is below the rows kept); a cursor from another Session (the Bot moved to
   * a new part), or one too old for a page, gets `reset` and the latest page.
   */
  async snapshotFor(entry, after) {
    const base = { type: 'snapshot', screen: [], status: entry.status, approval: entry.approval, held: [] }
    const latest = { ...base, reset: Boolean(after), rows: pageOf(entry.rows) }
    if (!after) return { ...latest, reset: false }
    const cursor = cursorOf(after)
    if (!cursor || cursor.sessionId !== entry.sessionId || cursor.seq > entry.cursor) return latest
    if (cursor.seq >= entry.floorSeq - 1) return { ...base, reset: false, rows: pageOf(entry.rows.filter(row => seqOf(row) > cursor.seq)) }
    let older
    try { older = await this.adapter.events(entry.sessionId, { beforeSeq: entry.floorSeq, maxMessages: PAGE_ROWS }, entry.controller.signal) } catch { return latest }
    const records = Array.isArray(older?.records) ? older.records : []
    if (!records.length || records[0].event.seq > cursor.seq + 1) return latest
    const scope = { sessionId: entry.sessionId, turn: 0, calls: new Map(entry.scope.calls) }
    const missed = records.filter(record => record.event.seq > cursor.seq).flatMap(record => rowsOf(record.event, scope))
    const rows = [...missed, ...entry.rows]
    // Everything missed must fit one page; otherwise the phone starts over from the latest page.
    return rows.length > PAGE_ROWS ? latest : { ...base, reset: false, rows: pageOf(rows) }
  }

  /** Rows before a row id, newest last: at most `limit`, read from the log (cold-safe). */
  async backfill(entry, before, limit = 50) {
    const cursor = cursorOf(before)
    if (!cursor || cursor.sessionId !== entry.sessionId || entry.gone) return []
    const max = Math.min(Math.max(1, Number.isInteger(limit) ? limit : 50), PAGE_ROWS)
    const page = await this.adapter.events(entry.sessionId, { beforeSeq: cursor.seq, maxMessages: max }, entry.controller.signal)
    const scope = { sessionId: entry.sessionId, turn: 0, calls: new Map() }
    const rows = (page?.records ?? []).filter(record => record.event.seq < cursor.seq).flatMap(record => rowsOf(record.event, scope))
    return pageOf(rows, max)
  }

  emitTo(listener, event) { try { listener(event) } catch {} }
  emit(entry, event) { for (const listener of entry.listeners) this.emitTo(listener, event) }

  leave(entry, listener) {
    entry.listeners.delete(listener)
    if (!entry.listeners.size) this.drop(entry)
  }

  drop(entry, reason) {
    if (entry.gone) return
    entry.gone = true
    if (reason) this.emit(entry, { type: 'gone', reason })
    entry.listeners.clear()
    this.timers.clearInterval(entry.poller)
    entry.controller.abort()
    if (this.entries.get(entry.botId) === entry) this.entries.delete(entry.botId)
  }

  close() { for (const entry of this.entries.values()) this.drop(entry, 'closed') }

  // What a phone may do on a terminal and never on a DSH chat: each is refused, with no call.
  send(_terminal, message) { return refusal(message?.id) }
  sendHeld(_terminal, message) { return refusal(message?.id) }
  cancelHeld(_terminal, message) { return refusal(message?.id) }
  answer() { return refusal() }
  interrupt() { return refusal() }
}

/** The team's own live Bots, each with its current own-chat Session (never a group, task or archived one). */
export function ownBots(rt) {
  return async () => {
    await rt.load?.()
    const bots = Object.values(rt.state?.bots ?? {})
    return bots
      .filter(bot => typeof bot?.id === 'string' && rt.botOf(bot.id) === bot)
      .map(bot => ({ id: bot.id, name: typeof bot.name === 'string' ? bot.name : '', sessionId: rt.chatOf(bot.id) }))
      .filter(bot => typeof bot.sessionId === 'string' && bot.sessionId !== '')
  }
}

/**
 * Wire the source when the runtime has DSH 0.2.2's Session API and the team has a home; else
 * register nothing (the source is absent, and Pocket Link lists no DSH chats).
 */
export function install(rt) {
  const { ctx } = rt
  const controller = ctx.get?.('sessionController') ?? ctx.sessionController
  if (!hasSessionApi(controller) || typeof rt.home !== 'string' || process.platform === 'win32') return
  ctx.effect(() => {
    let source
    let socket
    let stopped = false
    const started = (async () => {
      const { createAdapter } = await import('./pocket-chat-adapter.js')
      if (stopped) return
      source = new DshChatSource({ adapter: createAdapter(controller), bots: ownBots(rt), log: (...args) => rt.warn?.(...args) })
      socket = await startPocketSocket({ home: rt.home, source, log: (...args) => rt.warn?.(...args) })
      if (stopped) await socket.close()
    })().catch(error => rt.warn?.('omni-ui: Pocket chat is off: %s', error?.message ?? error))
    return async () => {
      stopped = true
      await started
      source?.close()
      await socket?.close()
    }
  }, 'ds-bot: pocket chat')
}
