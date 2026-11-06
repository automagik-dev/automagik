// Live switching (RFC 0003, amendment, "Live switching"). A Session keeps the record: moving to
// an agent replays the transcript into `session/prompt` content, in order, and moving back leaves
// what the agent streamed in DSH's log. The redactor runs at each crossing only — the replay out
// to an agent, and the transcript handed back to a native provider — never at ingest. Each
// crossing writes a visible provider-boundary row, so the chat says who answered.
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SYNTHETIC_KIND } from './names.js'

/** The source kind of the row that names the provider a turn came from or went to. */
export const BOUNDARY_KIND = 'acp-boundary'
const REPLAY_LIMIT = 120_000
const PART_LIMIT = 8_000

/** Where this turn's user messages start: the transcript before it is replay material. */
export function turnStart(messages) {
  let start = messages.length
  while (start > 0 && messages[start - 1].role === 'user') start--
  return start
}

/** The provider that wrote the last answer in `messages`, when one is known. */
export function lastProviderOf(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'assistant') continue
    if (message.source?.synthetic === SYNTHETIC_KIND) continue
    const provider = message.source?.provider
    return typeof provider === 'string' && provider !== '' ? provider : undefined
  }
  return undefined
}

/**
 * The chat row that says the conversation crossed to another provider: a user-role notice DSH
 * draws as a one-line row outside the reply, never reply text (the mirror of the new-session
 * notice, `adapter.js`).
 * @param {string} summary e.g. "Now answered by Claude Code (acp-claude)"
 */
export function boundaryNotice(summary) {
  return createUserMessage({
    content: [{ type: 'text', text: `[${summary}.]` }],
    source: { kind: BOUNDARY_KIND, form: 'notice', summary: boundContextSummary(summary) },
  })
}

/** The source kind of the row that says a reasoning effort could not cross. */
export const EFFORT_KIND = 'acp-effort'

/**
 * The target's own id for `effort`: the same id, or the one level with the same name.
 * Undefined when the target cannot express it.
 * @param {{ efforts?: { id: string, name?: string }[] } | undefined} reasoning
 * @param {unknown} effort
 * @returns {string | undefined}
 */
export function effortIdOf(reasoning, effort) {
  if (typeof effort !== 'string' || effort === '') return undefined
  const levels = reasoning?.efforts
  if (!Array.isArray(levels) || levels.length === 0) return undefined
  if (levels.some(level => level?.id === effort)) return effort
  const wanted = effort.trim().toLowerCase()
  const named = levels.filter(level =>
    typeof level?.name === 'string' && level.name.trim().toLowerCase() === wanted)
  return named.length === 1 ? named[0].id : undefined
}

/**
 * The chat row that says the reasoning effort the Session ran on is not offered by the model
 * it moved to, so that model runs on its own. A user-role notice, never reply text.
 * @param {string} effort
 * @param {string} target `provider/model`
 */
export function effortNotice(effort, target) {
  const summary =
    `Reasoning effort ${effort} is not available on ${target}; this chat runs on its own`
  return createUserMessage({
    content: [{ type: 'text', text: `[${summary}.]` }],
    source: { kind: EFFORT_KIND, form: 'notice', summary: boundContextSummary(summary) },
  })
}

/**
 * The `session/event` listener that carries a Session's reasoning effort across a model
 * crossing, both ways. DSH records the target model's own default effort on every model
 * change; this replaces it with the effort the Session ran on when the target offers it. An
 * effort-only change on the same route is the person's own pick and is left alone. When the
 * target's levels are known and lack that effort, a notice says so. The corrected selection
 * is marked, so the event it appends is never carried again.
 * @param {(provider: string, model: string) => Promise<{
 *   efforts?: { id: string, name?: string }[]
 * } | undefined>} reasoningOf
 * @param {() => boolean} [on] whether live switching is on (the setting)
 * @param {(previous: any, next: any) => boolean} [crossing] whether this route change crosses
 *   a provider boundary; without one every model change is a crossing
 */
export function carryEffort(reasoningOf, on = () => true, crossing = () => true) {
  const latest = new WeakMap()
  const expected = new WeakMap()
  const same = (a, b) => a.provider === b.provider && a.model === b.model
    && (a.reasoningEffort ?? undefined) === (b.reasoningEffort ?? undefined)
  return async (session, event) => {
    if (on() !== true || event?.type !== 'model/selection') return
    const next = event.data
    if (next === null || typeof next !== 'object') return
    const key = session === null || typeof session !== 'object' ? undefined : session
    // A newer pick always wins over a carry still reading the target's levels.
    if (key !== undefined) latest.set(key, next)
    const expecting = key === undefined ? undefined : expected.get(key)
    if (expecting !== undefined && same(expecting, next)) {
      // The selection this listener appended, read back from the log: never carried again.
      expected.delete(key)
      return
    }
    if (typeof next.provider !== 'string' || typeof next.model !== 'string') return
    const header = session?.requestHeader?.()
    // DSH's own projection drops an effort its adapter defaulted; it is not the person's.
    if (header?.adapterDefaults?.reasoningEffort === true) return
    const previous = header?.config
    const effort = previous?.reasoningEffort
    if (typeof effort !== 'string' || effort === '') return
    // The same route is an effort-only pick (the person's), not a crossing.
    if (previous.provider === next.provider && previous.model === next.model) return
    if (crossing(previous, next) !== true) return
    let reasoning
    try {
      reasoning = await reasoningOf(next.provider, next.model)
    } catch {
      return
    }
    if (key !== undefined && latest.get(key) !== next) return
    // An answer that has not read the model's levels says nothing: it is not a "cannot".
    if (!Array.isArray(reasoning?.efforts)) return
    const carried = effortIdOf(reasoning, effort)
    if (carried === undefined) {
      const row = effortNotice(effort, `${next.provider}/${next.model}`)
      try { session.append?.('user/message', row, { surfaceOp: 'append' }) } catch {}
      return
    }
    if (next.reasoningEffort === carried) return
    const choice = { provider: next.provider, model: next.model, reasoningEffort: carried }
    if (key !== undefined) expected.set(key, choice)
    try {
      session.append?.('model/selection', choice)
    } catch {
      if (key !== undefined) expected.delete(key)
    }
  }
}

/**
 * A transcript with every text-bearing part redacted, for a crossing to another provider. The
 * messages and their content are copied, never changed: DSH keeps the record it logged.
 * @param {any[]} messages
 * @param {(text: string) => string} redact
 * @returns {any[]}
 */
export function redactTranscript(messages, redact) {
  return messages.map((message) => {
    const content = message?.content
    if (typeof content === 'string') return { ...message, content: redact(content) }
    if (!Array.isArray(content)) return message
    return {
      ...message,
      content: content.map((block) => {
        if (block === null || typeof block !== 'object') return block
        const out = { ...block }
        if (typeof out.text === 'string') out.text = redact(out.text)
        if (typeof out.arguments === 'string') out.arguments = redact(out.arguments)
        return out
      }),
    }
  })
}

/**
 * Whether a provider id is one of the agents' routes. A Session keeps it in its history after
 * the agent is turned off or its CLI goes missing — the live map drops it — so the route's
 * public shape (`acp-<agent>`) outlives the map entry and must still classify the turn.
 * @param {Map<string, unknown>} providers the agents' live routes
 * @param {unknown} provider
 * @returns {boolean}
 */
export function agentRoute(providers, provider) {
  return providers.has(provider) || String(provider).startsWith('acp-')
}

/** Whether a transcript carries a turn an agent wrote (its answer, with its calls and results). */
export function fromAgent(messages, providers) {
  return (messages ?? []).some(message =>
    message?.role === 'assistant' && agentRoute(providers, message?.source?.provider))
}

/**
 * The `llm/stream` listener for the crossing back to DSH's own providers: a transcript that
 * carries an agent's turn is redacted before a native model sees it, so a secret the agent read
 * with its own tools never reaches that provider. `next` takes no request, so the redacted call
 * is a nested `ctx.llm.stream`; a WeakSet keeps that call from re-entering this listener.
 * @param {Map<string, unknown>} providers the agents' routes
 * @param {{ llm?: { stream(options: object): AsyncIterable<object> } }} [ctx]
 * @param {(text: string) => string} redact
 * @param {() => boolean} [on] whether live switching is on (the setting); off is the old path
 */
export function crossed(providers, ctx, redact, on = () => true) {
  const rewritten = new WeakSet()
  return (options, next) => {
    if (on() !== true) return next()
    if (agentRoute(providers, options.provider) || options.sessionId === undefined) return next()
    if (rewritten.has(options) || ctx?.llm?.stream === undefined) return next()
    if (!fromAgent(options.messages, providers)) return next()
    const request = { ...options, messages: redactTranscript(options.messages, redact) }
    rewritten.add(request)
    return ctx.llm.stream(request)
  }
}

const textOf = (content) => (typeof content === 'string' ? content : (content ?? [])
  .filter(block => block?.type === 'text')
  .map(block => block.text)
  .join('\n'))

const clip = (text) => (text.length > PART_LIMIT ? `${text.slice(0, PART_LIMIT)}…` : text)

/**
 * Render one message of the transcript for replay: the person's words, the model's words, a tool
 * call by name, and a tool result. DSH's own context notes and the plugin's notices are for
 * this harness, not for the agent, and stay out.
 * @param {any} message
 * @returns {string | undefined}
 */
export function renderMessage(message) {
  // A bridge's synthetic review block is not a turn: it never crosses to another provider.
  if (message?.source?.synthetic === SYNTHETIC_KIND) return undefined
  const kind = message?.source?.kind
  if (message?.role === 'user') {
    if (kind !== 'user' && kind !== undefined) return undefined
    const text = textOf(message.content)
    return text === '' ? undefined : `User: ${clip(text)}`
  }
  if (message?.role === 'assistant') {
    const parts = []
    const text = textOf(message.content)
    if (text !== '') parts.push(`Assistant: ${clip(text)}`)
    for (const block of message.content ?? []) {
      if (block?.type === 'tool-call' && typeof block.name === 'string') parts.push(`[called ${block.name}]`)
    }
    return parts.length === 0 ? undefined : parts.join('\n')
  }
  if (message?.role === 'tool') {
    const text = textOf(message.content)
    return text === '' ? undefined : `Tool result: ${clip(text)}`
  }
  return undefined
}

/**
 * The blocks that replay the chat before this turn into a prompt: a header naming the move, then
 * every message in order, each already redacted. When the transcript is longer than the cap the
 * oldest messages are dropped, with a marker, so the most recent context survives.
 * @param {any[]} messages the whole model input (this turn's user message included; it is rendered here too)
 * @param {{ redact: (text: string) => string, from?: string, to: string }} options
 * @returns {Array<{ type: 'text', text: string }>}
 */
export function replayBlocks(messages, { redact, from, to }) {
  const header = from === undefined
    ? `The chat so far, moved to ${to}:`
    : `The chat so far, moved from ${from} to ${to}:`
  const rendered = []
  for (const message of messages) {
    const line = renderMessage(message)
    if (line === undefined) continue
    rendered.push(redact(line))
  }
  let total = 0
  let start = rendered.length
  for (let i = rendered.length - 1; i >= 0; i--) {
    total += rendered[i].length
    if (total > REPLAY_LIMIT) break
    start = i
  }
  const blocks = [{ type: 'text', text: header }]
  if (start > 0) blocks.push({ type: 'text', text: `[${start} earlier message${start === 1 ? '' : 's'} left out here: the transcript is long.]` })
  for (const line of rendered.slice(start)) blocks.push({ type: 'text', text: line })
  return blocks
}
