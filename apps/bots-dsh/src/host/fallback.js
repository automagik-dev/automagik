// A model that fails does not end the conversation: the next turn runs on the fallback
// model (the profile's default, DeepSeek out of the box, or config.fallbackModel) and the
// turn after it is back on the Bot's own model. It covers every Session of the team (a
// Bot's chat, a group seat, a task), after everything that answers a failed request before
// it: DSH's own retries of the same model, and parts.js, which moves a full or stuck chat
// to a fresh part. A full context, a stop, and a fallback that fails too end the turn as
// before. config.fallback: false turns it off.
//
// DSH fixes a step's route before the request and keeps it across that step's retries, and
// agent/request may no longer move it (dsh 0.2.2): the choice is recorded on the Agent with
// agent.model.select() and the continuing turn is woken with agent.followup(). This plugin
// used to rewrite agent/request, which dsh 0.2.2 rejects before the request is admitted.
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

/** What the model and the person read where the conversation moved: which model failed, and why. */
export function fallbackNotice(failed, fallback, failure) {
  const why = String(failure?.message ?? failure?.code ?? 'it failed').split('\n')[0].slice(0, 200)
  const text = `[model fallback: ${label(failed)} failed (${failure?.code ?? 'error'}: ${why}); `
    + `the next turn continues with ${label(fallback)}]`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'model-selection', form: 'notice', summary: `${label(failed)} failed → ${label(fallback)}` },
  })
}

export function install(rt) {
  const { ctx, config } = rt
  if (config.fallback === false) return
  // Agent id -> the route the Bot answers on again, and the turn that failed: the fallback
  // turn ends after it, so the Bot's own route comes back once that turn is over.
  const restore = new Map()
  const fallbackRoute = async () => splitRef(config.fallbackModel ?? await rt.defaultModel())

  ctx.on('agent/request-error', async (payload, next) => {
    const decided = await next()
    if (decided !== undefined || payload.signal?.aborted) return decided
    const { agent, failure, turn } = payload
    if (!rt.isBotSession(agent.id)) return decided
    const failed = agent.session.requestHeader?.()?.config
    const fallback = fallbackFor({ failure, failed, fallback: await fallbackRoute().catch(() => undefined) })
    if (fallback === undefined) return decided
    // DSH prepares the next step's route from agent.model; the failed step's own retry
    // keeps its fixed route, so the backup runs the turn this wakes.
    try {
      agent.model.select({ provider: fallback.provider, model: fallback.model })
    } catch (error) {
      rt.warn('ds-bot: the fallback route was not recorded: %s', error)
      return decided
    }
    if (!restore.has(agent.id) && failed?.provider !== undefined && failed.model !== undefined) {
      restore.set(agent.id, {
        agent,
        route: { provider: failed.provider, model: failed.model },
        failedTurn: turn,
      })
    }
    rt.warn(
      'ds-bot: %s failed on %s (%s); the next turn continues on %s',
      rt.botOf?.(agent.id)?.name ?? agent.id, label(failed), failure.code, label(fallback),
    )
    try {
      agent.followup(fallbackNotice(failed, fallback, failure))
    } catch (error) {
      rt.warn('ds-bot: the fallback turn was not woken: %s', error)
    }
    return decided
  })

  // The turn after the failed one (the fallback turn) ends: the Bot answers on its own
  // model again. The failed turn's own end comes first and is passed over.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end' || typeof event.data?.turn !== 'number') return
    for (const [id, pending] of restore) {
      const sameSession = pending.agent.session?.id === session?.id
      if (!sameSession || event.data.turn <= pending.failedTurn) continue
      restore.delete(id)
      try {
        pending.agent.model.select(pending.route)
      } catch (error) {
        rt.warn('ds-bot: the Bot\'s own model was not restored: %s', error)
      }
    }
  })
}
