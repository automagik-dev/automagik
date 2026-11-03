// ACP agents as DSH models. Each agent is a provider route whose models and reasoning efforts
// are the agent's own (catalog.js); the chosen ones are set on its session before each prompt,
// with the permission mode. A DSH turn on it is
// one ACP prompt to that Session's agent process: its words stream as text, its thoughts as
// reasoning, and each of its tool calls ends the model step with a call to the mirror tool
// (tool.js), so DSH shows the card and asks for approval. The next step drains what the agent
// said since. DSH keeps the Session, its history and the sidebar.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { AgentRun, valuesOf } from './acp.js'
import { DEFAULT_MODEL } from './catalog.js'
import { callArguments, levelOf, mirrorTool, TOOL_NAME } from './tool.js'

const CANCEL_WAIT_MS = 5000
// An agent may announce a call before it says what the call does (Claude Code's adapter sends
// the command in an update right after): the card waits this long for it.
const DETAIL_WAIT_MS = 1500

const detailed = tool => (tool.rawInput !== undefined && tool.rawInput !== null && Object.keys(tool.rawInput).length > 0) || tool.permission !== undefined || tool.status !== 'pending'
function settle(tool, ms) {
  if (detailed(tool)) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      tool.listeners.delete(check)
      resolve()
    }
    const check = () => { if (detailed(tool)) done() }
    const timer = setTimeout(done, ms)
    tool.listeners.add(check)
  })
}

const failure = (message, code = 'ACP_AGENT') => ({ message, code })
const finish = (kind, message, code) => ({ type: 'finish', reason: message === undefined ? { kind } : { kind, failure: failure(message, code) } })
const FINISH = { end_turn: 'stop', max_tokens: 'max-tokens', max_turn_requests: 'stop', refusal: 'stop' }

// The blocks of one model step: text and reasoning open as they come, close before a tool call.
class Blocks {
  constructor() { this.index = 0; this.open = undefined }
  *add(type, text) {
    if (this.open?.type !== type) {
      yield* this.close()
      this.open = { type, index: this.index++, text: '' }
      yield { type: 'block-start', index: this.open.index, blockType: type }
    }
    this.open.text += text
    yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: this.open.index, text }
  }
  *close() {
    if (this.open === undefined) return
    const { type, index, text } = this.open
    this.open = undefined
    yield { type: 'block-end', index, block: { type, text } }
  }
  *toolCall(id, name, args) {
    yield* this.close()
    const index = this.index++
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id, name, argumentsDelta: args }
    yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
  }
}

const textOf = content => (typeof content === 'string' ? content : (content ?? []).filter(block => block?.type === 'text').map(block => block.text).join('\n'))

// What the person said this turn: the user messages after the last assistant or tool one.
// DSH's own context notes (its tool and file policies) are for its own loop, not the agent's.
export function promptOf(messages) {
  let start = messages.length
  while (start > 0 && messages[start - 1].role === 'user') start--
  const turn = messages.slice(start)
  const own = turn.filter(message => message.source?.kind === 'user')
  const text = (own.length > 0 ? own : turn).map(message => textOf(message.content)).filter(Boolean).join('\n\n')
  return [{ type: 'text', text }]
}

/**
 * The `llm/stream` listener that keeps DSH's side requests (a Session title, a summary) away
 * from the agents: they would reach the agent as prompts of their own. Only here is the agent
 * loop's mark on a request reliable; DSH rebuilds the request before the adapter sees it
 * whenever the Session's tool set changed.
 */
export function aside(providers) {
  return (options, next) => {
    if (!providers.has(options.provider) || isAgentLoopRequest(options)) return next()
    return (async function* () { yield finish('error', 'An ACP agent answers only in its own chat', 'UNSUPPORTED') })()
  }
}

/**
 * Put the agent on DSH's model and effort, the model first: the efforts it offers are that
 * model's. DSH's `default` model is the one the agent started on, and no effort leaves its own.
 * @param {AgentRun} run
 * @param {string} model
 * @param {string | undefined} effort
 */
export async function choose(run, model, effort) {
  const option = run.option('model')
  if (option === undefined) {
    if (model !== DEFAULT_MODEL) throw new Error(`it offers no choice of model, so not ${model}`)
  } else {
    const target = model === DEFAULT_MODEL && !valuesOf(option).some(choice => choice.value === DEFAULT_MODEL) ? run.startModel : model
    if (target !== undefined) await run.setOption('model', target)
  }
  if (effort !== undefined) await run.setOption('thought_level', effort)
}

export class AcpAdapter extends LlmAdapter {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {Map<string, { name: string, catalog: import('./catalog.js').Catalog, installed?(): boolean, spawn(): { command: string, args?: string[], env?: Record<string, string> } }>} agents
   */
  constructor(ctx, agents) {
    super()
    this.ctx = ctx
    this.agents = agents
    this.live = new Map()
    this.scoped = new WeakSet()
    this.tool = mirrorTool({ runOf: sessionId => this.live.get(sessionId), approval: () => ctx.get?.('approval'), sandboxPolicy: () => ctx.get?.('sandboxPolicy') })
  }

  providerInfo(provider) {
    return { id: provider, name: this.agents.get(provider)?.name ?? provider }
  }

  // An agent whose ACP adapter is not installed yet lists no model, so nothing (a picker, a
  // Bot's model) can choose one that cannot answer.
  async listModels(provider) {
    const agent = this.agents.get(provider)
    if (agent === undefined || agent.installed?.() === false) return []
    return (await agent.catalog.models()).map(model => ({ provider, id: model.id, name: model.name, ...(model.description ? { description: model.description } : {}) }))
  }

  // A model's efforts are the ones the agent offers for it; DSH turns down any other before the
  // agent sees it. An id the agent does not list resolves bare, as DSH's routing allows.
  async resolveModel(provider, model) {
    const found = await this.agents.get(provider)?.catalog.model(model)
    if (found === undefined) return { provider, id: model, name: model }
    return { provider, id: found.id, name: found.name, ...(found.description ? { description: found.description } : {}), ...(found.reasoning ? { reasoning: found.reasoning } : {}) }
  }

  // The mirror tool lives in the agent's own scope: no other Session's model sees it.
  scope(sessionId) {
    const agent = this.ctx.agents?.get?.(sessionId)
    if (agent === undefined || this.scoped.has(agent)) return agent
    agent.ctx.tools.register(this.tool)
    this.scoped.add(agent)
    return agent
  }

  async *stream(options) {
    const agent = this.agents.get(options.provider)
    if (agent === undefined) return yield finish('error', `No ACP agent is set up as ${options.provider}`, 'NO_ADAPTER')
    // A title or summary DSH asks for on the side is refused at the llm/stream waterfall (aside).
    if (options.sessionId === undefined) return yield finish('error', `${agent.name} answers only in its own chat`, 'UNSUPPORTED')
    const sessionId = options.sessionId
    let dshAgent
    try {
      dshAgent = this.scope(sessionId)
    } catch (error) {
      return yield finish('error', `${agent.name} cannot show its tools here: ${error?.message ?? error}`)
    }
    const blocks = new Blocks()
    let live = this.live.get(sessionId)
    const last = options.messages.at(-1)
    const continuing = last?.role === 'tool' && live?.provider === options.provider && live.calls.has(last.toolCallId) && live.open
    if (!continuing) {
      if (last?.role === 'tool') {
        yield* blocks.add('text', `${agent.name} was interrupted before it finished, so it is not answering this turn any more.`)
        yield* blocks.close()
        return yield finish('stop')
      }
      if (live !== undefined && (live.provider !== options.provider || !live.run.alive)) {
        live.run.dispose()
        this.live.delete(sessionId)
        live = undefined
      }
      let fresh = false
      if (live === undefined) {
        let run
        try {
          run = new AgentRun({ ...(await agent.spawn()), cwd: dshAgent?.session?.header?.cwd ?? homedir(), name: agent.name })
          await run.start()
        } catch (error) {
          return yield finish('error', `${agent.name} did not start: ${error?.message ?? error}`)
        }
        live = { provider: options.provider, name: agent.name, run, calls: new Set(), open: false }
        this.live.set(sessionId, live)
        fresh = true
      }
      if (live.run.busy) {
        await live.run.cancel()
        await Promise.race([live.run.prompting, new Promise(resolve => setTimeout(resolve, CANCEL_WAIT_MS).unref?.())])
        if (live.run.busy) return yield finish('error', `${agent.name} is still finishing its last answer; send this again in a moment`)
      }
      // The Session's model and effort, then its level as the agent's own permission mode, before every prompt.
      try {
        await choose(live.run, options.model, options.reasoningEffort)
      } catch (error) {
        return yield finish('error', `${agent.name} would not take ${options.model}${options.reasoningEffort ? ` at ${options.reasoningEffort} effort` : ''}: ${error?.message ?? error}`)
      }
      try {
        await live.run.setMode(agent.modeFor?.(levelOf(this.ctx.get?.('approval'), dshAgent?.session, this.ctx.get?.('sandboxPolicy'))))
      } catch (error) {
        return yield finish('error', `${agent.name} would not take DSH's permission level: ${error?.message ?? error}`)
      }
      if (fresh && options.messages.some(message => message.role === 'assistant')) {
        yield* blocks.add('text', `(A new ${agent.name} session: it does not see this chat's earlier messages.)\n\n`)
      }
      live.open = true
      live.run.prompt(promptOf(options.messages)).catch(() => {})
    }
    // The turn stays open until its end is drained here: the agent may finish it before DSH
    // asks for the step after a tool result.
    for (;;) {
      const event = await live.run.next(options.signal)
      if (event.type === 'end' || event.type === 'error') live.open = false
      if (event.type === 'text') yield* blocks.add('text', event.text)
      else if (event.type === 'thought') yield* blocks.add('reasoning', event.text)
      else if (event.type === 'tool') {
        const tool = live.run.tools.get(event.id)
        await settle(tool, DETAIL_WAIT_MS)
        const id = `acp_${randomUUID()}`
        live.calls.add(id)
        yield* blocks.toolCall(id, TOOL_NAME, JSON.stringify(callArguments(tool)))
        return yield finish('tool-calls')
      } else if (event.type === 'end') {
        yield* blocks.close()
        if (event.stopReason === 'cancelled') return yield finish('aborted', 'Stopped', 'ABORTED')
        return yield finish(FINISH[event.stopReason] ?? 'stop')
      } else if (event.type === 'error') {
        yield* blocks.close()
        return yield finish('error', `${agent.name}: ${event.message}`)
      } else if (event.type === 'aborted') {
        live.open = false
        await live.run.cancel()
        yield* blocks.close()
        return yield finish('aborted', 'Stopped', 'ABORTED')
      }
    }
  }

  dispose() {
    for (const agent of this.agents.values()) agent.catalog?.dispose()
    for (const live of this.live.values()) live.run.dispose()
    this.live.clear()
  }
}
