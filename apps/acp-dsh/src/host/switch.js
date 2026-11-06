// Live switching (RFC 0003, amendment, "Live switching"). A Session keeps the record: moving to
// an agent replays the transcript into `session/prompt` content, in order, and moving back leaves
// what the agent streamed in DSH's log. Text passes the redactor both ways: the replay whole,
// and the agent's stream as it arrives, where a shape can straddle two chunks. Each crossing
// writes a visible provider-boundary row, so the chat says who answered.
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

// The widest shape in the credential table spans four whitespace-separated words (a quoted key,
// its separator and a quoted value), so no match can start before the fourth word from the end
// and still be growing. A wider table makes the stream hold more, never release early.
const HOLD_WORDS = 4

const isSpace = char => char === ' ' || char === '\t' || char === '\n' || char === '\r'
  || char === '\f' || char === '\v'

/**
 * Where the `words`th word from the end starts: the earliest point whose redaction can still
 * change when more text arrives. Zero when the text holds fewer words than asked for.
 * @param {string} text
 * @param {number} [words]
 * @returns {number}
 */
export function holdStart(text, words = 1) {
  let found = 0
  let index = text.length
  while (index > 0) {
    while (index > 0 && isSpace(text[index - 1])) index--
    if (index === 0) break
    while (index > 0 && !isSpace(text[index - 1])) index--
    found++
    if (found === words) return index
  }
  return 0
}

/**
 * A redactor for one streamed block. Text is released as it arrives, except a tail that could
 * still become a credential shape: a token split across two chunks must never reach DSH's log
 * in parts. What is released is final — redacting that prefix and the whole text agree — and
 * the rest goes out when the block closes.
 * @param {(text: string) => string} redact
 * @returns {{ push(text: string): string, close(): string }}
 */
export function streamRedactor(redact) {
  let raw = ''
  let sent = ''
  return {
    push(text) {
      raw += text
      const full = redact(raw)
      let cut = holdStart(raw)
      let stable = cut === 0 ? '' : redact(raw.slice(0, cut))
      // A shape that began before the cut and is completed here would change text already
      // released: hold more of the tail until the released prefix is final. A table wider than
      // these words holds everything until the block ends rather than stream a secret.
      for (let words = 2; words <= HOLD_WORDS && !full.startsWith(stable); words++) {
        cut = holdStart(raw, words)
        stable = cut === 0 ? '' : redact(raw.slice(0, cut))
      }
      if (!full.startsWith(stable) || stable.length <= sent.length) return ''
      const out = stable.slice(sent.length)
      sent = stable
      return out
    },
    close() {
      const full = redact(raw)
      const out = full.slice(sent.length)
      sent = full
      return out
    },
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
