// Live switching (RFC 0003, amendment, "Live switching"). A Session keeps the record: moving to
// an agent replays the transcript into `session/prompt` content, in order, and moving back leaves
// what the agent streamed in DSH's log. The redactor runs at each crossing only — the replay out
// to an agent, and the transcript handed back to a native provider — never at ingest. Each
// crossing writes a visible provider-boundary row, so the chat says who answered.
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'

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

/** Whether a transcript carries a turn an agent wrote (its answer, with its calls and results). */
export function fromAgent(messages, providers) {
  return (messages ?? []).some(message =>
    message?.role === 'assistant' && providers.has(message?.source?.provider))
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
    if (providers.has(options.provider) || options.sessionId === undefined) return next()
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
