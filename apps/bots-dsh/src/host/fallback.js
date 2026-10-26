// A model that fails does not end the turn: the step is tried again on the fallback model
// (the profile's default, DeepSeek out of the box, or config.fallbackModel) and the rest of
// that turn runs there; the next turn is back on the Bot's own model. It covers every
// Session of the team (a Bot's chat, a group seat, a task), after everything that answers a
// failed request before it: DSH's own retries of the same model, and parts.js, which moves a
// full or stuck chat to a fresh part. A full context, a stop, and a fallback that fails too
// end the turn as before. config.fallback: false turns it off.
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { splitRef } from './text.js'

// Failures another model cannot answer better: the conversation is too long (parts.js moves
// it on), the person stopped it, or an image has to leave the request first.
export const KEEP_CODES = new Set(['CONTEXT_WINDOW_EXCEEDED', 'ABORTED', 'IMAGE_OFFLOAD_REQUIRED'])

const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model
const label = route => `${route.provider}/${route.model}`

/**
 * The route a failed request moves to, or undefined when it stays failed: a failure kept
 * as it is, no fallback route, or a request already on the fallback.
 */
export function fallbackFor({ failure, failed, fallback }) {
  if (!failure || KEEP_CODES.has(failure.code)) return undefined
  if (fallback?.provider === undefined || fallback.model === undefined) return undefined
  if (failed === undefined || sameRoute(failed, fallback)) return undefined
  return fallback
}

/** What the model and the person read where the turn moved: which model failed, and why. */
export function fallbackNotice(failed, fallback, failure) {
  const why = String(failure?.message ?? failure?.code ?? 'it failed').split('\n')[0].slice(0, 200)
  return createUserMessage({
    content: [{ type: 'text', text: `[model fallback: ${label(failed)} failed (${failure?.code ?? 'error'}: ${why}); this turn continues with ${label(fallback)}]` }],
    source: { kind: 'model-selection', form: 'notice', summary: `${label(failed)} failed → ${label(fallback)}` },
  })
}

export function install(rt) {
  const { ctx, config } = rt
  if (config.fallback === false) return
  // Agent id -> the turn that moved and where it went.
  const moved = new Map()
  const fallbackRoute = async () => splitRef(config.fallbackModel ?? await rt.defaultModel())

  ctx.on('agent/request-error', async (payload, next) => {
    const decided = await next()
    if (decided !== undefined || payload.signal?.aborted) return decided
    const { agent, failure, turn } = payload
    if (!rt.isBotSession(agent.id)) return decided
    const failed = agent.session.requestHeader?.()?.config
    const fallback = fallbackFor({ failure, failed, fallback: await fallbackRoute().catch(() => undefined) })
    if (fallback === undefined) return decided
    moved.set(agent.id, { turn, route: fallback })
    rt.warn('ds-bot: %s failed on %s (%s); turn %d continues on %s', rt.botOf?.(agent.id)?.name ?? agent.id, label(failed), failure.code, turn, label(fallback))
    try {
      agent.session.append('user/message', fallbackNotice(failed, fallback, failure), { surfaceOp: 'append' })
    } catch (error) {
      rt.warn('ds-bot: the fallback notice was not written: %s', error)
    }
    return { kind: 'retry' }
  })

  // Ahead of the model selection's own rewrite, so the moved turn's route wins. Effort and
  // output limit were the failed model's, so the fallback takes its own defaults.
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const entry = moved.get(payload.agent?.id)
    if (entry === undefined) return resolved
    if (entry.turn !== payload.turn) {
      moved.delete(payload.agent.id)
      return resolved
    }
    const { reasoningEffort: _effort, maxTokens: _maxTokens, ...rest } = resolved
    return { ...rest, provider: entry.route.provider, model: entry.route.model }
  }, { prepend: true })
}
