// The chat engine: one per process, behind the one API both clients call (RFC 0015 delivery 3).
// Ours. Pocket Link's chat route (delivery 4) and the Automagik window (RFC 0014 delivery 9) use
// it; its methods mirror the route's `chat.*`.
//
// - One projection per watched terminal (projection.js), shared by every client watching it; kept
//   10 minutes after the last client leaves, then dropped (nothing is on disk).
// - send, sendHeld, cancelHeld, answer and interrupt act only for a client that watches that
//   terminal, and only on what that client's person did; they are never a tool, an automation or
//   another plugin's (RFC 0015, "Who can call the engine"). The engine never answers on its own.
// - herdr-core is reached with no caller and with HC_TERMINAL_ID removed from hc's environment
//   (chatEnv), so a message is typed as the person wrote it, not as a note from a terminal.
//
// Events to a client's listener: the projection's (rows, screen, status, source, gone, offline),
// plus { type: 'approval', row } (open, or closed with open: false), { type: 'question', row },
// { type: 'held' | 'sent' | 'cancelled', id, ... } from input.js, and { type: 'sending', id } then
// { type: 'matched', id, row } once the transcript shows the message.
import { addressParts, connectHc } from './hc.js'
import { agentOf, findTranscript } from './find.js'
import { StatusHub, statusOf } from './status.js'
import { Projection } from './projection.js'
import { Input } from './input.js'
import { answerApproval, approvalRow, approvalState } from './approve.js'

/** How long a terminal's rows are kept after its last client leaves (RFC 0015, "Reconnect"). */
export const LINGER_MS = 10 * 60_000
/** While messages are held, how often to look whether they can go. */
export const FLUSH_MS = 2000
/** Sent messages waiting for their transcript row, per terminal; the oldest goes past this. */
export const MAX_PENDING = 100
const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval }

/** The environment for the engine's `hc connect`: without HC_TERMINAL_ID, so no send has a caller. */
export function chatEnv(env = process.env) {
  const out = { ...env }
  delete out.HC_TERMINAL_ID
  return out
}

/** An engine with its own hc (the bridge passes hcPath and its environment). */
export function createEngine({ home, appHome, hcPath, env = process.env, log } = {}) {
  const engine = new Engine({ hc: connectHc({ hcPath, env: chatEnv(env) }), home, appHome, log })
  // Its own hc: closed with it.
  engine.ownsHc = true
  return engine
}

const refused = (reason = 'not-watching') => ({ state: 'refused', ok: false, reason })

export class Engine {
  /**
   * @param {{ hc: any, home: string, appHome?: string, log?: (l: string) => void,
   *   timers?: typeof realTimers, lingerMs?: number, flushMs?: number, hub?: StatusHub, projection?: object }} options
   *   projection: extra options for each Projection (tests)
   */
  constructor({ hc, home, appHome, log = () => {}, timers = realTimers, lingerMs = LINGER_MS, flushMs = FLUSH_MS, hub, projection = {} }) {
    Object.assign(this, { hc, home, appHome, log, timers, lingerMs, flushMs, projectionOptions: projection })
    this.hub = hub ?? new StatusHub(hc, { timers })
    this.refused = new Set()
    /** @type {Map<string, any>} address -> entry */
    this.entries = new Map()
  }

  /** Live terminals with a decoder (Claude, Codex, omp): what a client can open as a chat. */
  list() {
    return this.hub.all().filter((t) => t.state !== 'finished' && agentOf(t)).map((t) => {
      const watched = this.entries.get(t.address)
      const source = watched ? watched.projection.found.source : findTranscript(t, { home: this.home, appHome: this.appHome, log: this.log, refused: this.refused }).source
      return {
        terminal: t.address, machine: addressParts(t.address).machine, agent: agentOf(t), title: t.title ?? '',
        status: statusOf(t), chat: source === 'none' ? 'screen' : 'transcript'
      }
    })
  }

  watching(client, address) { return this.entries.get(address)?.clients.has(client) ?? false }

  /**
   * A client opens a terminal's chat. `listener` gets its events; the handle reads rows.
   * @returns {{ rows(after?: string): any[] | null, screen(): any[], backfill(before: string, limit?: number): Promise<any[]>,
   *   status(): any, approval(): any, held(): any[], close(): void }}
   */
  watch(address, client, listener) {
    const entry = this.entries.get(address) ?? this.open(address)
    this.timers.clearTimeout(entry.linger)
    entry.linger = null
    entry.clients.set(client, listener)
    return {
      rows: (after) => entry.projection.rows(after),
      screen: () => entry.projection.screen(),
      backfill: (before, limit) => entry.projection.backfill(before, limit),
      status: () => entry.projection.status,
      approval: () => entry.approval,
      held: () => entry.input.held.map(({ id, why }) => ({ id, why })),
      close: () => this.leave(address, client)
    }
  }

  leave(address, client) {
    const entry = this.entries.get(address)
    if (!entry || !entry.clients.delete(client) || entry.clients.size) return
    entry.linger = this.timers.setTimeout(() => { this.drop(address) }, this.lingerMs)
    entry.linger.unref?.()
  }

  drop(address) {
    const entry = this.entries.get(address)
    if (!entry) return
    this.entries.delete(address)
    this.timers.clearTimeout(entry.linger)
    this.timers.clearInterval(entry.flusher)
    entry.projection.stop()
    if (!this.entries.size) this.onEmpty?.()
  }

  /** No terminal held any more (every client gone and every hold over): the owner may close it. */
  get empty() { return this.entries.size === 0 }

  close() {
    this.onEmpty = null
    for (const a of [...this.entries.keys()]) this.drop(a)
    this.hub.close()
    if (this.ownsHc) this.hc.close()
  }

  open(address) {
    const projection = new Projection(address, { hc: this.hc, hub: this.hub, home: this.home, appHome: this.appHome, log: this.log, refused: this.refused, timers: this.timers, ...this.projectionOptions })
    const entry = { address, projection, clients: new Map(), linger: null, approval: null, question: null, pending: new Map(), checking: null, flusher: null,
      answering: null, answered: new Set() }
    const emit = (e) => { for (const l of [...entry.clients.values()]) { try { l(e) } catch {} } }
    entry.emit = emit
    entry.read = () => this.read(entry)
    entry.input = new Input({ hc: this.hc, address, read: entry.read })
    entry.input.on((e) => {
      if (e.type === 'sent') {
        // The text stays here, to find the transcript's row for it; clients already have it.
        const { text, ...rest } = e
        emit(rest)
        entry.pending.set(e.id, text)
        if (entry.pending.size > MAX_PENDING) entry.pending.delete(entry.pending.keys().next().value)
        emit({ type: 'sending', id: e.id })
      } else emit(e)
      this.flushing(entry)
    })
    projection.on((e) => {
      emit(e)
      if (e.type === 'rows') this.match(entry, e.rows)
      if (e.type === 'status') { entry.input.flush(); this.checkApproval(entry) }
      if (e.type === 'screen') entry.input.flush()
    })
    this.entries.set(address, entry)
    projection.start()
    return entry
  }

  /** Facts read now, for a send or an answer: herdr-core's status and screen, the open calls. */
  async read(entry) {
    const [t, r] = await Promise.all([
      this.hc.call('terminal.get', { terminal: entry.address }),
      this.hc.call('terminal.read', { terminal: entry.address })
    ])
    return { agent: agentOf(t), status: statusOf(t), screen: typeof r?.text === 'string' ? r.text : '', openCalls: entry.projection.openCalls() }
  }

  /** While messages are held, look again every FLUSH_MS. */
  flushing(entry) {
    if (entry.input.held.length && !entry.flusher) {
      entry.flusher = this.timers.setInterval(() => { entry.input.flush() }, this.flushMs)
      entry.flusher.unref?.()
    } else if (!entry.input.held.length && entry.flusher) {
      this.timers.clearInterval(entry.flusher)
      entry.flusher = null
    }
  }

  /** A sent message, shown as "sending" until the transcript's user row with its text arrives. */
  match(entry, rows) {
    for (const r of rows) {
      if (r.kind !== 'text' || r.role !== 'user' || r.source !== 'transcript') continue
      for (const [id, text] of entry.pending) {
        if (typeof text === 'string' && r.text.trim() === text.trim()) {
          entry.pending.delete(id)
          entry.emit({ type: 'matched', id, row: r.id })
          break
        }
      }
    }
  }

  /** Raise, update or close the approval (or question) row after a status change. */
  checkApproval(entry) {
    // One check at a time; anything that arrives meanwhile runs it once more after.
    if (entry.checking) { entry.recheck = true; return entry.checking }
    entry.checking = (async () => {
      do {
        entry.recheck = false
        await this.checkOnce(entry)
      } while (entry.recheck)
    })().finally(() => { entry.checking = null })
    return entry.checking
  }

  closeApproval(entry) {
    if (!entry.approval) return
    entry.emit({ type: 'approval', row: { ...entry.approval, open: false } })
    entry.approval = null
  }

  async checkOnce(entry) {
    const status = entry.projection.status
    if (status.state !== 'blocked') { entry.answered.clear(); this.closeApproval(entry); return }
    if (status.kind !== 'permission') {
      // Questions and pickers are answered in the terminal: no agent's was recorded.
      const id = `question:${status.turn}`
      if (entry.question === id) return
      entry.question = id
      entry.emit({ type: 'question', row: { id, turn: status.turn, at: null, source: 'status', kind: 'question', prompt: status.msg, options: [], multi: false, answerable: false } })
      return
    }
    let facts
    try { facts = await entry.read() } catch { return }
    const state = approvalState(facts)
    // Read fresh, no approval is open any more (answered, or the status moved on).
    if (!state) { this.closeApproval(entry); return }
    // A call already answered keeps its row, without buttons, until the status moves.
    const answered = state.call && entry.answered.has(state.call.id)
    const row = approvalRow(answered ? { ...state, choices: [], why: 'answered' } : state, { turn: status.turn, segment: entry.projection.store.segment })
    if (entry.approval && entry.approval.id === row.id && entry.approval.choices.join() === row.choices.join()) return
    if (entry.approval && entry.approval.id !== row.id) this.closeApproval(entry)
    entry.approval = row
    entry.emit({ type: 'approval', row })
  }

  // ---- what a client's person did

  async send(client, address, { text, id }) {
    if (!this.watching(client, address)) return refused()
    return this.entries.get(address).input.send({ text, id })
  }

  sendHeld(client, address, { id }) {
    if (!this.watching(client, address)) return refused()
    return this.entries.get(address).input.sendHeld({ id })
  }

  cancelHeld(client, address, { id }) {
    if (!this.watching(client, address)) return refused()
    return this.entries.get(address).input.cancelHeld({ id })
  }

  /**
   * An approval the person tapped: only the engine's own open row, checked again before the key.
   * One answer at a time per terminal, and one per open call: herdr-core types a key only after
   * ~3 s of quiet, during which the dialog stays and every re-read still passes, so a second tap,
   * another client or a retry after 'uncertain' would press again, maybe on the next dialog. An
   * answered call is refused until the status leaves blocked.
   */
  async answer(client, address, { row, choice }) {
    if (!this.watching(client, address)) return refused()
    const entry = this.entries.get(address)
    if (entry.answering) return { ok: false, reason: 'in-flight' }
    if (!entry.approval || entry.approval.id !== row) return { ok: false, reason: 'no-such-row' }
    if (entry.approval.call && entry.answered.has(entry.approval.call)) return { ok: false, reason: 'answered' }
    const call = entry.approval.call
    entry.answering = answerApproval({ hc: this.hc, address, rowId: row, choice, read: entry.read, timers: this.timers })
    let result
    try { result = await entry.answering } finally { entry.answering = null }
    // terminal.keys was called: that call is answered, whatever came back (a timeout or an error
    // may still have typed it) and whatever the dialog shows, until the status moves.
    if (result.sent && call) entry.answered.add(call)
    if (result.ok || result.reason === 'changed' || result.reason === 'closed') this.checkApproval(entry)
    return result
  }

  interrupt(client, address) {
    if (!this.watching(client, address)) return refused()
    return this.entries.get(address).input.interrupt()
  }
}
