// The bridge→DSH leg (RFC 0003, amendment, "The bridge"). The bridge runs as the agent's child,
// so it cannot inherit a pipe from DSH: it reaches this plugin over a loopback HTTP channel with
// a per-session credential minted at spawn and passed only in that bridge's env. The credential
// binds a request to its Session and is revoked with the bridge; it carries no approval, and
// every DSH tool call still enters DSH's approval service under the Session's level. Nothing
// here is a boundary against same-user code (it can read the bridge's environment); the
// boundary is server-side.
//
// This module also owns the tool set the bridge serves: the Session's preset tools (standard,
// or cordis in creator mode: whatever preset the Session runs), minus the tools its level cannot
// use, minus the mirror tool. A preset, model or level change is a new signature, and the
// bridge announces it (`notifications/tools/list_changed`) instead of the agent keeping a stale
// list.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createAssistantMessage, createDeveloperMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { SYNTHETIC_KIND } from './names.js'
import { levelOf, TOOL_NAME } from './tool.js'

/** How long a bridge's long-poll waits before answering "nothing changed". */
export const WAIT_MS = 20_000
const MAX_BODY = 16 * 1024 * 1024
const OUTPUT_LIMIT = 20_000
// A reviewer that never answers must not hold the bridge's call forever. Auto only.
const REVIEW_TIMEOUT_MS = 120_000
// Events that can change the Session's level while a review is pending.
const LEVEL_EVENTS = new Set(['permission/preset', 'sandbox/mode', 'approval/policy'])

// Tools that only write files: a Session in DSH's read-only sandbox cannot run them, so they
// are not offered. Shell tools stay (read-only commands are legitimate; the sandbox denies the
// writes) and every other tool is DSH's own decision at execution time.
export const MUTATING_TOOLS = Object.freeze(new Set(['write', 'edit', 'apply_patch', 'str_replace_editor']))

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (block?.type === 'text' ? block.text ?? '' : block?.type === 'resource' ? block.resource?.text ?? '' : '')).filter(Boolean).join('\n')
}

/** The agent's preset, as the preset registry records it; `standard` when no registry composes. */
export function presetOf(ctx, session) {
  try {
    return ctx?.get?.('agentPresets')?.presetForSession?.(session) ?? 'standard'
  } catch {
    return 'standard'
  }
}

/**
 * What the bridge offers this Session right now: its preset's visible tools, without the mirror
 * tool, and without the file-only mutators when the Session is read-only.
 * @param {{ get?: (name: string) => any }} ctx
 * @param {any} agent the DSH Agent the Session runs
 * @returns {Array<{ name: string, description: string, inputSchema: object }>}
 */
export function offeredTools(ctx, agent) {
  const tools = ctx?.get?.('tools')
  if (tools?.definitions === undefined || agent === undefined) return []
  const level = levelOf(ctx?.get?.('approval'), agent.session, ctx?.get?.('sandboxPolicy'), ctx?.get?.('permissionPresets'))
  return tools.definitions(agent)
    .filter((definition) => definition.name !== TOOL_NAME)
    // A conditional tool (step admission via `when`) has no call outside a model step; DSH's
    // own tools here run outside the agent's loop, so only unconditionally executable ones are
    // offered.
    .filter((definition) => typeof tools.executable !== 'function' || tools.executable(definition.name, agent) !== undefined)
    .filter((definition) => level.sandbox !== 'read-only' || !MUTATING_TOOLS.has(definition.name))
    .map((definition) => ({
      name: definition.name,
      description: typeof definition.description === 'string' ? definition.description : '',
      inputSchema: definition.parameters ?? { type: 'object', properties: {} },
    }))
}

/** A stable fingerprint of what the bridge would list: preset, level and every tool's schema. */
export function signatureOf(ctx, agent) {
  const level = levelOf(ctx?.get?.('approval'), agent?.session, ctx?.get?.('sandboxPolicy'), ctx?.get?.('permissionPresets'))
  return JSON.stringify({
    preset: presetOf(ctx, agent?.session),
    sandbox: level.sandbox ?? null,
    approval: level.policy ?? null,
    tools: offeredTools(ctx, agent).map((tool) => [tool.name, tool.description, tool.inputSchema]),
  })
}

/**
 * The turn and step the Session is in, for the `tool/call` and `tool/result` rows the bridge
 * writes on the Session's behalf. DSH's own loop puts them on every tool row; a call that runs
 * outside the loop (this one) reads them from the log it already committed.
 */
export function positionOf(ctx, session) {
  const turn = (() => {
    try {
      return ctx?.agents?.turnBoundaryOf?.(session)?.lastTurn ?? 0
    } catch {
      return 0
    }
  })()
  let step = 0
  const events = session?.snapshotEvents?.() ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'turn/start') break
    if (event?.type === 'step/start' && typeof event.data?.step === 'number') {
      step = event.data.step
      break
    }
  }
  return { turn, step }
}

/**
 * The step a call can open in, if one is still open. Auto review requires it: its snapshot
 * reads the pending call's `turn`/`step` from the step the Session log has not closed.
 * @returns {{ turn: number, step: number } | undefined}
 */
export function openStepOf(session) {
  const events = session?.snapshotEvents?.() ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'turn/start' || event?.type === 'turn/end' || event?.type === 'step/end') return undefined
    if (event?.type === 'step/start' && typeof event.data?.step === 'number') {
      return { turn: event.data.turn, step: event.data.step }
    }
  }
  return undefined
}

/**
 * What Auto review needs before it can read a bridge call: an open step, the Session's route,
 * and exactly one complete schema for the call in the request header. Missing any of them is a
 * refusal, never a call that runs unreviewed.
 * @returns {{ step: { turn: number, step: number }, provider: string, model: string } | { error: { code: string, text: string } }}
 */
export function reviewRouteOf(session, name) {
  const step = openStepOf(session)
  if (step === undefined) return { error: { code: 'AUTO_REVIEW_NO_STEP', text: 'Auto review cannot see this call: the Session has no open step.' } }
  let header
  try {
    header = session?.requestHeader?.()
  } catch {
    header = undefined
  }
  const provider = header?.config?.provider
  const model = header?.config?.model
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
    return { error: { code: 'AUTO_REVIEW_NO_ROUTE', text: 'Auto review cannot see this call: the Session has no request route.' } }
  }
  const schemas = (Array.isArray(header.tools) ? header.tools : []).filter(tool => tool?.name === name)
  const schema = schemas[0]
  if (schemas.length !== 1 || typeof schema?.description !== 'string' || schema.parameters === null || typeof schema.parameters !== 'object' || Array.isArray(schema.parameters)) {
    return { error: { code: 'AUTO_REVIEW_NO_SCHEMA', text: `Auto review cannot see this call: the request header has no single complete schema for ${name}.` } }
  }
  return { step, provider, model }
}

/**
 * The `acp_toolset_drift` record: a plugin record (replay-safe, outside DSH's released event
 * schemas) naming the structured call that should have been an MCP name. A reader that does not
 * know it retains and skips it.
 * @returns {boolean} whether the record landed
 */
export function recordDrift(session, data) {
  try {
    appendPluginRecord(session, 'plugin:acp-dsh/toolset-drift', data)
    return true
  } catch {
    return false
  }
}

/**
 * One back-channel for the plugin instance. Every ACP session gets its own credential; all of
 * them reach the same loopback server, which resolves the credential to its Session before it
 * reads anything else.
 */
export class Backchannel {
  /**
   * @param {{ ctx: any, log?: (message: string) => void, reviewTimeoutMs?: number }} options
   */
  constructor({ ctx, log = () => {}, reviewTimeoutMs = REVIEW_TIMEOUT_MS }) {
    this.ctx = ctx
    this.log = log
    this.reviewTimeoutMs = reviewTimeoutMs
    this.records = new Map()
    this.closed = false
  }

  async listen() {
    if (this.server !== undefined) return this
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        try {
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'internal' }))
        } catch {}
        this.log(`bridge request failed: ${error?.message ?? error}`)
      })
    })
    this.server = server
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.unref?.()
    this.url = `http://127.0.0.1:${server.address().port}`
    return this
  }

  /**
   * Mint the credential of one ACP session's bridge. Every spawn (a new ACP session, a fork)
   * gets a fresh value; `revoke` is what ends it.
   * @param {{ sessionId: string, agent: any, name: string }} options
   */
  mint({ sessionId, agent, name }) {
    const credential = randomBytes(32).toString('hex')
    const record = {
      credential,
      sessionId,
      path: `/${encodeURIComponent(sessionId)}`,
      agent,
      name: name ?? 'agent',
      generation: 0,
      signature: signatureOf(this.ctx, agent),
      announced: false,
      listed: false,
      closed: false,
      waiters: new Set(),
      abort: new AbortController(),
    }
    this.records.set(credential, record)
    return record
  }

  /**
   * The URL one bridge posts to: its Session's own path, so a credential minted for another
   * Session is refused there even when it is otherwise live. Only this record's Session matches.
   */
  urlFor(record) {
    return `${this.url}${record.path}`
  }

  /** Revoke one bridge's credential and wake whatever it left waiting. */
  revoke(record) {
    if (record === undefined || record.closed) return
    record.closed = true
    this.records.delete(record.credential)
    try {
      record.abort.abort()
    } catch {}
    for (const wake of record.waiters) wake()
    record.waiters.clear()
  }

  /**
   * Recompute the offered set (a preset or level change may have landed since the last turn)
   * and, when it changed, let a waiting bridge announce it.
   * @returns {boolean} whether the list changed
   */
  refresh(record) {
    if (record === undefined || record.closed) return false
    const signature = signatureOf(this.ctx, record.agent)
    if (signature === record.signature) return false
    record.signature = signature
    record.generation++
    this.wake(record)
    return true
  }

  /**
   * The ACP session exists (`session/new` or `session/fork` answered): only now may the bridge
   * announce a changed list. The spike's ordering rule: a `list_changed` before that answer
   * produced no re-list.
   */
  announce(record) {
    if (record === undefined || record.closed) return
    record.announced = true
    this.wake(record)
  }

  wake(record) {
    for (const wake of record.waiters) wake()
    record.waiters.clear()
  }

  /** Read the JSON body, capped: the bridge speaks small JSON-RPC envelopes. */
  async body(request) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY) throw new Error('body too large')
      chunks.push(chunk)
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  async handle(request, response) {
    const reply = (status, value) => {
      if (response.writableEnded) return
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (request.method !== 'POST') return reply(405, { error: 'method' })
    const header = String(request.headers.authorization ?? '')
    const credential = header.startsWith('Bearer ') ? header.slice(7) : ''
    const record = this.records.get(credential)
    const path = (() => {
      try {
        return new URL(request.url, 'http://127.0.0.1').pathname
      } catch {
        return ''
      }
    })()
    // A missing, another Session's, or a revoked credential is refused before the body is read:
    // the path names the Session, and this credential must be that Session's.
    if (record === undefined || record.closed || record.path !== path) {
      request.resume()
      return reply(401, { error: 'refused' })
    }
    let body
    try {
      body = await this.body(request)
    } catch {
      return reply(400, { error: 'body' })
    }
    const op = body?.op
    if (op === 'hello') {
      this.refresh(record)
      return reply(200, { generation: record.generation })
    }
    if (op === 'list') {
      this.refresh(record)
      record.listed = true
      return reply(200, { tools: offeredTools(this.ctx, record.agent), generation: record.generation })
    }
    if (op === 'call') {
      const result = await this.call(record, {
        name: typeof body.name === 'string' ? body.name : '',
        arguments: body.arguments ?? {},
        callId: typeof body.callId === 'string' ? body.callId : undefined,
      })
      // Revoked while the call was awaiting approval: the caller sees the refusal, not a result.
      if (result?.revoked === true) return reply(401, { error: 'refused' })
      return reply(200, result)
    }
    if (op === 'wait') {
      const since = Number.isFinite(body.generation) ? body.generation : record.generation
      const timeout = Number.isFinite(body.timeoutMs) ? Math.min(Math.max(body.timeoutMs, 0), WAIT_MS) : WAIT_MS
      const ready = () => record.closed || (record.announced && record.generation > since)
      const deadline = Date.now() + timeout
      // A generation bump before `session/new` answered wakes this poll too; it must park again,
      // not answer, or the bridge would announce before the agent can re-list (the spike's rule).
      while (!ready()) {
        const left = deadline - Date.now()
        if (left <= 0) break
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer)
            record.waiters.delete(finish)
            resolve()
          }
          const timer = setTimeout(finish, left)
          timer.unref?.()
          record.waiters.add(finish)
        })
      }
      // A parked poll that times out while the list is still unannounceable answers with what
      // the bridge already knew, so the change is announced only after `session/new`.
      const answerable = record.closed || record.announced
      return reply(200, { generation: answerable ? record.generation : since, ...(record.closed ? { closed: true } : {}) })
    }
    if (op === 'bye') {
      this.revoke(record)
      return reply(200, { ok: true })
    }
    return reply(400, { error: 'op' })
  }

  /**
   * Run one DSH tool call for the bridge: it must be offered, DSH must approve it, and only
   * then does it run. Rows land on the Session as DSH's own tool rows do, so the chat shows the
   * call and its result; the bridge's call is the single record for it.
   * @param {any} record
   * @param {{ name: string, arguments: any, callId?: string }} call
   */
  async call(record, { name, arguments: args, callId }) {
    const error = (text) => ({ content: [{ type: 'text', text }], isError: true })
    const unavailable = (code, text) => ({ ...error(text), error: { name: 'AutoReviewUnavailableError', code } })
    // A revoked bridge (or one whose session ended) may not even write a row.
    if (record.closed || record.abort.signal.aborted) return { revoked: true }
    const session = record.agent?.session
    const tools = this.ctx?.get?.('tools')
    if (session === undefined || tools?.execute === undefined) return error(`DSH tools are not available to ${record.name}.`)
    const offered = offeredTools(this.ctx, record.agent)
    if (!offered.some((tool) => tool.name === name)) return error(`Tool "${name}" is not offered to this Session.`)
    const id = callId ?? `bridge_${randomBytes(8).toString('hex')}`
    const raw = JSON.stringify(args ?? {})
    const approval = this.ctx?.get?.('approval')
    const level = levelOf(approval, session, this.ctx?.get?.('sandboxPolicy'), this.ctx?.get?.('permissionPresets'))
    // Auto review reads the pending call from the model surface and the Session log. A bridge
    // call is out-of-band, so it gets the one synthetic assistant block the reviewer reads,
    // with the same turn/step, id, name and raw arguments the tool/call row carries. The block
    // is marked synthetic and replaced once the call settles: it is for that review only and
    // never crosses to a provider (switch.js also skips it).
    let review
    if (level.auto) {
      review = reviewRouteOf(session, name)
      if (review.error !== undefined) return unavailable(review.error.code, review.error.text)
    }
    const { turn, step } = review?.step ?? positionOf(this.ctx, session)
    let syntheticSeq
    if (review !== undefined) {
      try {
        syntheticSeq = session.append('assistant/message', {
          turn,
          step,
          stream: [],
          message: createAssistantMessage({
            content: [{ type: 'tool-call', id, name, arguments: raw }],
            source: { provider: review.provider, model: review.model, bridge: true, synthetic: SYNTHETIC_KIND },
          }),
        }, { surfaceOp: 'append' }).seq
      } catch (cause) {
        return unavailable('AUTO_REVIEW_FAILED', `Auto review could not see this call: ${cause?.message ?? cause}`)
      }
    }
    let callSeq
    try {
      callSeq = session.append('tool/call', { turn, step, callId: id, name, arguments: raw }).seq
    } catch (cause) {
      this.log(`bridge call row failed: ${cause?.message ?? cause}`)
    }
    const settle = (content, isError, info) => {
      try {
        session.append('tool/result', {
          turn,
          step,
          message: createToolResultMessage({ callId: id, content, isError }),
          ...(info === undefined ? {} : { error: info }),
        }, callSeq === undefined ? undefined : { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
      } catch (cause) {
        this.log(`bridge result row failed: ${cause?.message ?? cause}`)
      }
      const text = textOf(content)
      return {
        content: [{ type: 'text', text: text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}…` : text }],
        isError,
        ...(info === undefined ? {} : { error: info }),
      }
    }
    // The synthetic block is for the review only. Replace it with an empty developer message:
    // it derives to no model message, so no later request or crossing sees the fake call.
    const hideSynthetic = () => {
      if (syntheticSeq === undefined) return
      const seq = syntheticSeq
      syntheticSeq = undefined
      try {
        session.append('developer/message', {
          turn,
          step,
          message: createDeveloperMessage({ content: [], source: { kind: SYNTHETIC_KIND } }),
        }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
      } catch (cause) {
        this.log(`the synthetic bridge block was not removed: ${cause?.message ?? cause}`)
      }
    }
    let controller
    let unwatch
    let unwatchPre
    let timer
    let timedOut = false
    let levelChanged = false
    try {
      // Manual and every other asking level raise the one DSH dialog here. Auto does not: the
      // pipeline's pre-execute is auto-review's gate, and its ask (if any) is the one dialog.
      if (!level.full && !level.auto) {
        let outcome = 'unavailable'
        try {
          outcome = await approval.request({
            agent: record.agent,
            toolName: name,
            callId: id,
            reason: `${record.name}: ${name}`,
            displayReason: { en: `${record.name} wants to run ${name}` },
            signal: record.abort.signal,
          })
        } catch (cause) {
          outcome = 'unavailable'
          this.log(`approval for ${name} failed: ${cause?.message ?? cause}`)
        }
        if (outcome !== 'allowed-once') {
          // A revocation during the ask wins over a late grant: the credential is gone, so the
          // call is refused rather than answered with a dialog outcome. Its `tool/call` row was
          // already written, so the row is closed as an error (never left unanswered).
          if (record.closed || record.abort.signal.aborted) {
            settle([{ type: 'text', text: `The bridge was revoked before ${name} ran.` }], true, { name: 'BridgeRevokedError', code: 'BRIDGE_REVOKED' })
            return { revoked: true }
          }
          const why = outcome === 'rejected' ? 'The person rejected' : 'DSH could not approve'
          const text = `${why} ${name}.`
          return settle([{ type: 'text', text }], true, { name: 'ApprovalDeniedError', code: outcome.toUpperCase() })
        }
      }
      // The ask may have been answered after the bridge was revoked (a grant that lost its
      // session): nothing may execute then. Checked again after any await, immediately before
      // dispatch, because the signal alone lets a tool body that ignores it run anyway.
      if (record.closed || record.abort.signal.aborted) {
        settle([{ type: 'text', text: `The bridge was revoked before ${name} ran.` }], true, { name: 'BridgeRevokedError', code: 'BRIDGE_REVOKED' })
        return { revoked: true }
      }
      if (level.auto) {
        // A level that stopped being Auto before dispatch would let this call run unreviewed.
        // The subscription below also watches while the review is pending; this re-check covers
        // a host that composes no session/event listeners.
        let now
        try {
          now = levelOf(approval, session, this.ctx?.get?.('sandboxPolicy'), this.ctx?.get?.('permissionPresets'))
        } catch {
          now = { auto: false }
        }
        if (now.auto !== true) levelChanged = true
      }
      // The timeout and the level watcher cover the review and approval phase, not the body.
      // The pipeline reaches its tools/execute waterfall only after the pre-execute gate and any
      // approval ask have settled; disarming there, immediately around the body, keeps a long
      // allowed body out of the deadline and covers a level change while the ask is pending.
      if (!levelChanged && level.auto && typeof this.ctx?.on === 'function') {
        controller = new AbortController()
        timer = setTimeout(() => {
          timedOut = true
          controller.abort(new Error('Auto review timed out'))
        }, this.reviewTimeoutMs)
        timer.unref?.()
        unwatch = this.ctx.on('session/event', (eventSession, event) => {
          if (eventSession !== session || !LEVEL_EVENTS.has(event?.type)) return
          let now
          try {
            now = levelOf(approval, session, this.ctx?.get?.('sandboxPolicy'), this.ctx?.get?.('permissionPresets'))
          } catch {
            now = { auto: false }
          }
          if (now.auto !== true) {
            levelChanged = true
            controller.abort(new Error('the level changed during Auto review'))
          }
        })
        unwatchPre = this.ctx.on('tools/execute', (exec, next) => {
          if (exec?.callId !== id || exec.parent !== undefined || exec.agent !== record.agent) return next()
          if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
          }
          unwatch?.()
          unwatch = undefined
          return next()
        })
      }
      if (levelChanged) {
        return settle([{ type: 'text', text: `Auto review cannot finish ${name}: the permission level changed.` }], true, { name: 'AutoReviewUnavailableError', code: 'AUTO_REVIEW_LEVEL_CHANGED' })
      }
      const signal = controller === undefined ? record.abort.signal : AbortSignal.any([record.abort.signal, controller.signal])
      let settled
      try {
        settled = await tools.execute({
          calls: [{ id, name, arguments: raw }],
          agent: record.agent,
          signal,
        })
      } catch (cause) {
        if (record.closed || record.abort.signal.aborted) {
          settle([{ type: 'text', text: `The bridge was revoked before ${name} ran.` }], true, { name: 'BridgeRevokedError', code: 'BRIDGE_REVOKED' })
          return { revoked: true }
        }
        if (timedOut) {
          return settle([{ type: 'text', text: `Auto review timed out before ${name} ran.` }], true, { name: 'AutoReviewTimeoutError', code: 'AUTO_REVIEW_TIMEOUT' })
        }
        if (levelChanged) {
          return settle([{ type: 'text', text: `Auto review cannot finish ${name}: the permission level changed.` }], true, { name: 'AutoReviewUnavailableError', code: 'AUTO_REVIEW_LEVEL_CHANGED' })
        }
        const text = `Error: ${cause?.message ?? cause}`
        return settle([{ type: 'text', text }], true, { name: cause?.name ?? 'Error', code: cause?.code })
      }
      // A revocation, a timeout or a level change during the review wins over its result: the
      // body must not be reported as executed under a level or credential that no longer holds.
      if (record.closed || record.abort.signal.aborted) {
        settle([{ type: 'text', text: `The bridge was revoked before ${name} ran.` }], true, { name: 'BridgeRevokedError', code: 'BRIDGE_REVOKED' })
        return { revoked: true }
      }
      if (timedOut) {
        return settle([{ type: 'text', text: `Auto review timed out before ${name} ran.` }], true, { name: 'AutoReviewTimeoutError', code: 'AUTO_REVIEW_TIMEOUT' })
      }
      if (levelChanged) {
        return settle([{ type: 'text', text: `Auto review cannot finish ${name}: the permission level changed.` }], true, { name: 'AutoReviewUnavailableError', code: 'AUTO_REVIEW_LEVEL_CHANGED' })
      }
      const result = settled?.results?.[0]?.result
      if (result === undefined) return settle([{ type: 'text', text: 'The tool returned no result.' }], true)
      const info = result.isError === true ? (result.error?.info ?? (typeof result.error?.code === 'string' ? result.error : undefined)) : undefined
      return settle(result.content ?? [], result.isError === true, info)
    } finally {
      clearTimeout(timer)
      unwatch?.()
      unwatchPre?.()
      hideSynthetic()
    }
  }

  dispose() {
    this.closed = true
    // A Map iterator tolerates the deletes `revoke` makes; a copy here would be noise.
    for (const record of this.records.values()) this.revoke(record)
    try {
      this.server?.close()
    } catch {}
    this.server = undefined
  }
}
