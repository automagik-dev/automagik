// ACP agents as DSH models. Each agent is a provider route whose models and reasoning efforts
// are the agent's own (catalog.js); the chosen ones are set on its session before each prompt,
// with the permission mode. A DSH turn on it is
// one ACP prompt to that Session's agent process: its words stream as text, its thoughts as
// reasoning, and each of its tool calls ends the model step with a call to the mirror tool
// (tool.js), so DSH shows the card and asks for approval. The next step drains what the agent
// said since. DSH keeps the Session, its history and the sidebar.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, boundContextSummary, createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { AgentRun, valuesOf } from './acp.js'
import { recordDrift } from './backchannel.js'
import { DEFAULT_MODEL } from './catalog.js'
import { BRIDGE_NAME, CREDENTIAL_ENV, SYNTHETIC_KIND, URL_ENV } from './names.js'
import { agentRoute, boundaryNotice, lastProviderOf, replayBlocks, turnStart } from './switch.js'
import { callArguments, levelOf, mirrorTool, TOOL_NAME } from './tool.js'

const CANCEL_WAIT_MS = 5000
// A bridge that never listed its tools fails the turn: codex-acp skips a server whose name the
// person's own Codex config defines, and a Session must not run with half a tool set.
const BRIDGE_READY_MS = 15_000
const BRIDGE_READY_POLL_MS = 25
// The MCP bridge script, spawned by the adapter as a child of its own.
export const BRIDGE_PATH = fileURLToPath(new URL('./bridge.js', import.meta.url))
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

/** The source kind of the row that says a new agent session does not see the chat before it. */
export const NOTICE_KIND = 'acp-session'

/**
 * The chat row that says the agent is a new session and has not seen the chat's earlier
 * messages: a user-role notice DSH draws as a one-line row outside the reply, never reply text.
 * @param {string} name the agent's name
 */
export function freshSessionNotice(name) {
  const summary = `A new ${name} session: it does not see this chat's earlier messages`
  return createUserMessage({
    content: [{ type: 'text', text: `[${summary}.]` }],
    source: { kind: NOTICE_KIND, form: 'notice', summary: boundContextSummary(summary) },
  })
}

// What the person said this turn: the user messages after the last assistant or tool one.
// DSH's own context notes (its tool and file policies) are for its own loop, not the agent's,
// and the new-session notice is for the person.
export function promptOf(messages) {
  let start = messages.length
  while (start > 0 && messages[start - 1].role === 'user') start--
  const turn = messages.slice(start).filter(message => message.source?.kind !== NOTICE_KIND)
  const own = turn.filter(message => message.source?.kind === 'user')
  const text = (own.length > 0 ? own : turn).map(message => textOf(message.content)).filter(Boolean).join('\n\n')
  return [{ type: 'text', text }]
}

/** Where a Session title on an agent's chat goes when DSH's default model is an agent too. */
export const SIDE_MODEL = Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash' })
const TITLE_PURPOSE = 'session-title'
// Auto review is a side request DSH's Auto preset makes on the Session's route. Like a title it
// must not reach the agent; unlike a title it reads the Session, so it gets the redactor.
const REVIEW_PURPOSE = 'auto-review'
const SIDE_PURPOSES = new Set([TITLE_PURPOSE, REVIEW_PURPOSE])

/** Redact the fixed system prompt and every text block of a review request. */
function redactedReview(options, redact) {
  return {
    ...options,
    ...(typeof options.system === 'string' ? { system: redact(options.system) } : {}),
    ...(Array.isArray(options.messages) ? {
      messages: options.messages.map(message => ({
        ...message,
        ...(Array.isArray(message.content) ? {
          content: message.content.map(block => (block?.type === 'text' && typeof block.text === 'string' ? { ...block, text: redact(block.text) } : block)),
        } : {}),
      })),
    } : {}),
  }
}

/**
 * The `llm/stream` listener that keeps DSH's side requests (a Session title, a compaction
 * summary) away from the agents: they would reach the agent as prompts of their own. A Session
 * title on an agent's route goes to a model that answers on its own instead, without the
 * agent's effort, which is the agent's model's: DSH's default model when that is not an agent,
 * else `sideModel()` (acp-dsh's `sideModel` setting, DeepSeek by default). DSH's default is the
 * model the person last picked, so on a team that chats with an agent it is usually an agent.
 * Auto review is another side request: DSH's Auto preset sends it on the Session's route, and
 * it must reach a model that answers on its own just as a title does. It is redacted first:
 * the reviewer reads the Session's history, so its text passes the shared redactor.
 * Every other side request (a compaction summary) is turned down: it would carry the agent's
 * whole chat to another provider, and the agent manages its own context. The agent loop's own
 * requests, and every other route's, go on as they are. Only here is the agent loop's mark on
 * a request reliable; DSH rebuilds the request before the adapter sees it whenever the
 * Session's tool set changed. `next` takes no request, so the side call is a nested
 * `ctx.llm.stream`, which passes through this listener again as another route's.
 * @param {Map<string, unknown>} providers the agents' routes
 * @param {{ llm?: { stream(options: object): AsyncIterable<object> }, get?: (name: string) => any }} [ctx]
 * @param {() => { provider?: string, model?: string } | undefined} [sideModel]
 * @param {(text: string) => string} [redact] the shared redactor, for Auto review
 */
export function aside(providers, ctx, sideModel = () => SIDE_MODEL, redact = text => text) {
  const answers = choice => typeof choice?.provider === 'string' && choice.provider !== ''
    && typeof choice.model === 'string' && choice.model !== ''
    && !agentRoute(providers, choice.provider)
  const synthetic = message => message?.source?.synthetic === SYNTHETIC_KIND
  const refuse = () => (async function* () { yield finish('error', 'An ACP agent answers only in its own chat', 'UNSUPPORTED') })()
  return (options, next) => {
    if (!providers.has(options.provider)) {
      // A bridge review block that outlived its call (a crash, a failed replacement) is not a
      // turn: drop it before any native model sees it. The nested call re-enters here clean.
      if (Array.isArray(options.messages) && options.messages.some(synthetic) && ctx?.llm !== undefined) {
        return ctx.llm.stream({ ...options, messages: options.messages.filter(message => !synthetic(message)) })
      }
      return next()
    }
    if (isAgentLoopRequest(options)) return next()
    if (!SIDE_PURPOSES.has(options.purpose) || ctx?.llm === undefined) return refuse()
    const chosen = [ctx.get?.('agentDefaultModel')?.currentSelection?.(), sideModel()].find(answers)
    if (chosen === undefined) return refuse()
    const routed = options.purpose === REVIEW_PURPOSE ? redactedReview(options, redact) : options
    const { reasoningEffort: _agentEffort, ...request } = routed
    return ctx.llm.stream({ ...request, provider: chosen.provider, model: chosen.model })
  }
}

/**
 * Put the agent on DSH's model and effort, the model first: the efforts it offers are that
 * model's. DSH's `default` model is the one the agent started on. With no effort, the model's
 * own comes back, so an earlier turn's choice does not stay: the agent's "default" row when it
 * has one (Claude Code's, which hands effort back to its settings), else `ownEffort()`, the one
 * the agent showed for that model when it was read, asked only then; when it is not known, no
 * effort is set.
 * @param {AgentRun} run
 * @param {string} model
 * @param {string | undefined} effort
 * @param {() => string | undefined} [ownEffort]
 */
export async function choose(run, model, effort, ownEffort) {
  const option = run.option('model')
  if (option === undefined) {
    if (model !== DEFAULT_MODEL) throw new Error(`it offers no choice of model, so not ${model}`)
  } else {
    const target = model === DEFAULT_MODEL && !valuesOf(option).some(choice => choice.value === DEFAULT_MODEL) ? run.startModel : model
    if (target !== undefined) await run.setOption('model', target)
  }
  if (effort !== undefined) return run.setOption('thought_level', effort)
  const levels = run.option('thought_level')
  if (levels === undefined) return
  const offered = valuesOf(levels).map(choice => choice.value)
  if (offered.includes(DEFAULT_MODEL)) return run.setOption('thought_level', DEFAULT_MODEL)
  const own = ownEffort?.()
  if (own !== undefined && offered.includes(own)) await run.setOption('thought_level', own)
}

export class AcpAdapter extends LlmAdapter {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {Map<string, { name: string, catalog: import('./catalog.js').Catalog, installed?(): boolean, spawn(): { command: string, args?: string[], env?: Record<string, string> } }>} agents
   */
  constructor(ctx, agents, { dshTools = () => false, backchannel, redactor } = {}) {
    super()
    this.ctx = ctx
    this.agents = agents
    this.dshTools = dshTools
    this.backchannel = backchannel
    this.redact = redactor ?? (text => text)
    this.live = new Map()
    this.scoped = new WeakSet()
    this.tool = mirrorTool({ runOf: sessionId => this.live.get(sessionId), approval: () => ctx.get?.('approval'), sandboxPolicy: () => ctx.get?.('sandboxPolicy'), permissionPresets: () => ctx.get?.('permissionPresets') })
  }

  /** Whether DSH's tools reach an agent in this Session at all (`dshTools`, off unless set). */
  bridgeOn() {
    return this.dshTools() === true && this.backchannel !== undefined
  }

  /** The `session/new` server entry for one bridge: the adapter spawns it with this env only. */
  bridgeServer(record) {
    return {
      name: BRIDGE_NAME,
      command: process.execPath,
      args: [BRIDGE_PATH],
      env: [
        ...(process.versions.electron ? [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] : []),
        { name: CREDENTIAL_ENV, value: record.credential },
        { name: URL_ENV, value: this.backchannel.urlFor(record) },
      ],
    }
  }

  /**
   * The session/new answer is in: release the bridge's first announcement and wait for its
   * first `tools/list`. A bridge that never asks is the turn's failure, not a quiet half set.
   */
  async ready(agent, state) {
    const record = state.bridge
    if (record === undefined) return
    this.backchannel.announce(record)
    const deadline = Date.now() + (agent.bridgeReadyMs ?? BRIDGE_READY_MS)
    while (!record.listed && !record.closed) {
      if (Date.now() > deadline) {
        const error = new Error(`the ${BRIDGE_NAME} bridge did not reach DSH (a server of that name in the agent's own config skips it)`)
        error.code = 'acp_bridge_missing'
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, BRIDGE_READY_POLL_MS).unref?.())
    }
    if (record.closed) {
      const error = new Error(`the ${BRIDGE_NAME} bridge closed before it listed its tools`)
      error.code = 'acp_bridge_missing'
      throw error
    }
  }

  /**
   * A preset or level change on an agent that ignores `tools/list_changed` (`acp-codex`): fork
   * the ACP session with the new server set, close the source (with its bridge), and go on from
   * the fork. The fork continues the same conversation; the source is never left holding a
   * second bridge.
   */
  async refork(agent, live, dshAgent) {
    const previous = live.bridge
    const next = this.backchannel.mint({ sessionId: dshAgent?.session?.id, agent: dshAgent, name: agent.name })
    live.bridge = next
    try {
      await live.run.fork({
        cwd: dshAgent?.session?.header?.cwd ?? homedir(),
        mcpServers: [this.bridgeServer(next)],
      })
    } catch (error) {
      // The fork may already have moved the run to a new ACP session (a bridge that never
      // listed). Nothing can resume that half state: revoke both credentials, end the run and
      // let the next turn start clean.
      live.bridge = previous
      this.backchannel.revoke(next)
      live.run.dispose()
      this.live.delete(dshAgent?.session?.id ?? '')
      if (previous !== undefined) this.backchannel.revoke(previous)
      throw error
    }
    this.backchannel.revoke(previous)
    return next
  }

  /**
   * The runtime drift detector, an allowlist (RFC 0003, amendment, delivery 6). With `dshTools`
   * on and the agent's built-in tools off, every structured call name must be an MCP name — the
   * bridge's `mcp__dsh__<tool>` or a server the session was given, `mcp__<server>__<tool>` — or
   * `ToolSearch`, the deferred-tool loader the adapter keeps with `tools: []`. Anything else is
   * a built-in file or shell tool and drift: it DETECTS and CANCELS. It cannot prevent the call
   * that triggered it (the update arrives after the call started), so the turn is cancelled on
   * the same trace and the record says what ran.
   */
  checkDrift(sessionId, agent, tool) {
    if (!this.bridgeOn() || agent.drift !== true || tool.drift === true) return
    const name = tool.structuredName
    if (name === undefined || name.startsWith('mcp__') || name === 'ToolSearch') return
    // Every drifted call stays cardless, but the record and the cancel belong to the turn: a
    // latch that outlived the turn would let a later turn's built-in call through unrecorded
    // (and would draw it as a mirror card).
    tool.drift = true
    const live = this.live.get(sessionId)
    if (live?.drifted === true) return
    if (live !== undefined) live.drifted = true
    const session = live?.dshAgent?.session ?? this.ctx.agents?.get?.(sessionId)?.session
    const recorded = session === undefined ? false : recordDrift(session, { name, title: tool.title, provider: live?.provider })
    try {
      this.ctx.logger?.warn?.(`acp-dsh: acp_toolset_drift: ${name} is not an MCP tool${recorded ? '' : ' (the record could not be written)'}`)
    } catch {}
    void live?.run.cancel()
  }

  /**
   * A model selection on a Session this adapter served: moving off the agent is a crossing too,
   * and ends its agent session (and the bridge that belongs to it). The row is the one the chat
   * shows; the model selection itself is DSH's.
   */
  noteEvent(session, event) {
    // Off is the old path, byte for byte: the agent session is kept across a turn on another
    // provider, so switching back resumes the same ACP session.
    if (!this.bridgeOn()) return
    if (event?.type !== 'model/selection') return
    const live = this.live.get(session?.id)
    if (live === undefined) return
    const provider = event.data?.provider
    if (agentRoute(this.agents, provider)) return
    this.live.delete(session.id)
    live.run.dispose()
    if (live.bridge !== undefined && this.backchannel !== undefined) this.backchannel.revoke(live.bridge)
    try {
      session.append?.('user/message', boundaryNotice('Now answered by DSH'), { surfaceOp: 'append' })
    } catch (error) {
      try { this.ctx.logger?.warn?.(`acp-dsh: the provider-boundary row was not written: ${error?.message ?? error}`) } catch {}
    }
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
        if (live.bridge !== undefined) this.backchannel?.revoke(live.bridge)
        this.live.delete(sessionId)
        live = undefined
      }
      let fresh = false
      let crossing = false
      const prior = lastProviderOf(options.messages)
      if (live === undefined) {
        crossing = this.bridgeOn() && prior !== undefined && prior !== options.provider
        const state = { provider: options.provider, name: agent.name, run: undefined, calls: new Set(), open: false, dshAgent, bridge: undefined, replay: undefined, drifted: false }
        try {
          const spec = await agent.spawn()
          if (this.bridgeOn()) {
            await this.backchannel.listen()
            state.bridge = this.backchannel.mint({ sessionId, agent: dshAgent, name: agent.name })
          }
          const run = new AgentRun({
            ...spec,
            cwd: dshAgent?.session?.header?.cwd ?? homedir(),
            name: agent.name,
            mcpServers: state.bridge === undefined ? [] : [this.bridgeServer(state.bridge)],
            ...(this.bridgeOn() && agent.disableBuiltInTools === true ? { sessionMeta: { disableBuiltInTools: true } } : {}),
            dshTools: this.bridgeOn(),
            onReady: state.bridge === undefined ? undefined : () => this.ready(agent, state),
            onToolCall: tool => this.checkDrift(sessionId, agent, tool),
          })
          state.run = run
          this.live.set(sessionId, state)
          await run.start()
        } catch (error) {
          state.run?.dispose()
          if (state.bridge !== undefined) this.backchannel?.revoke(state.bridge)
          this.live.delete(sessionId)
          return yield finish('error', `${agent.name} did not start: ${error?.message ?? error}`, error?.code === 'acp_bridge_missing' ? 'acp_bridge_missing' : undefined)
        }
        live = state
        fresh = true
        if (crossing) {
          this.appendBoundary(dshAgent, agent, options.provider)
          live.replay = replayBlocks(options.messages.slice(0, turnStart(options.messages)), {
            redact: this.redact,
            from: this.agents.get(prior)?.name ?? 'DSH',
            to: agent.name,
          })
        }
      }
      // A preset or level change since the last turn: the bridge serves the new set, and an
      // agent that ignores `tools/list_changed` gets the list through a fork instead.
      if (live.bridge !== undefined && this.bridgeOn()) {
        const changed = this.backchannel.refresh(live.bridge)
        if (changed && agent.refresh === 'fork') {
          try {
            await this.refork(agent, live, dshAgent)
          } catch (error) {
            return yield finish('error', `${agent.name} would not refresh its DSH tools: ${error?.message ?? error}`, error?.code === 'acp_bridge_missing' ? 'acp_bridge_missing' : undefined)
          }
        }
      }
      if (live.run.busy) {
        await live.run.cancel()
        await Promise.race([live.run.prompting, new Promise(resolve => setTimeout(resolve, CANCEL_WAIT_MS).unref?.())])
        if (live.run.busy) return yield finish('error', `${agent.name} is still finishing its last answer; send this again in a moment`)
      }
      // The Session's model and effort, then its level as the agent's own permission mode, before every prompt.
      try {
        await choose(live.run, options.model, options.reasoningEffort, () => agent.catalog?.ownEffort(options.model))
      } catch (error) {
        return yield finish('error', `${agent.name} would not take ${options.model}${options.reasoningEffort ? ` at ${options.reasoningEffort} effort` : ''}: ${error?.message ?? error}`)
      }
      try {
        await live.run.setMode(agent.modeFor?.(levelOf(this.ctx.get?.('approval'), dshAgent?.session, this.ctx.get?.('sandboxPolicy'), this.ctx.get?.('permissionPresets'))))
      } catch (error) {
        return yield finish('error', `${agent.name} would not take DSH's permission level: ${error?.message ?? error}`)
      }
      // A new agent session in a chat that already has answers says so once, in a row of its
      // own before the reply (bots-dsh's fallback.js writes its notice the same way). The
      // prompt below was read before it, and promptOf leaves it out of later ones.
      if (fresh && !crossing && options.messages.some(message => message.role === 'assistant')) {
        try {
          dshAgent?.session?.append?.('user/message', freshSessionNotice(agent.name), { surfaceOp: 'append' })
        } catch (error) {
          try { this.ctx.logger?.warn?.(`acp-dsh: the new-session notice was not written: ${error?.message ?? error}`) } catch {}
        }
      }
      const prompt = fresh && live.replay !== undefined
        ? [...live.replay, ...promptOf(options.messages)]
        : promptOf(options.messages)
      live.replay = undefined
      live.drifted = false
      live.open = true
      live.run.prompt(prompt).catch(() => {})
    }
    // The turn stays open until its end is drained here: the agent may finish it before DSH
    // asks for the step after a tool result.
    for (;;) {
      const event = await live.run.next(options.signal)
      if (event.type === 'end' || event.type === 'error') live.open = false
      // Inbound text is logged as the agent said it: DSH does not redact at ingest, and neither
      // does this plugin. The redactor runs at each provider crossing instead — the replay out
      // (`replayBlocks`) and the transcript handed back to a native provider (`crossed`).
      if (event.type === 'text') yield* blocks.add('text', event.text)
      else if (event.type === 'thought') yield* blocks.add('reasoning', event.text)
      else if (event.type === 'tool') {
        const tool = live.run.tools.get(event.id)
        // A DSH tool call is not a mirror call: the bridge writes its rows and DSH draws the one
        // card from them. On `acp-codex` no structured name is proven, so any MCP call there is
        // left to the bridge too; its own tools keep their cards.
        // `ToolSearch` is the adapter's own deferred-tool loader (it stays with `tools: []`); it
        // is not a DSH tool and gets no card or dialog either.
        if (this.bridgeOn() && (tool.drift === true || tool.bridge === true || tool.structuredName === 'ToolSearch' || (agent.refresh === 'fork' && tool.mcp === true))) continue
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

  /** The row that says which provider answered from here on, written before the reply. */
  appendBoundary(dshAgent, agent, provider) {
    try {
      dshAgent?.session?.append?.('user/message', boundaryNotice(`Now answered by ${agent.name} (${provider})`), { surfaceOp: 'append' })
    } catch (error) {
      try { this.ctx.logger?.warn?.(`acp-dsh: the provider-boundary row was not written: ${error?.message ?? error}`) } catch {}
    }
  }

  dispose() {
    for (const agent of this.agents.values()) agent.catalog?.dispose()
    for (const live of this.live.values()) {
      live.run?.dispose()
      if (live.bridge !== undefined) this.backchannel?.revoke(live.bridge)
    }
    this.live.clear()
  }
}
