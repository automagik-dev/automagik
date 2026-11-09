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
import { BRIDGE_NAME, CREDENTIAL_ENV, isAuthRequired, MODEL_ACCESS_REQUIRED, SYNTHETIC_KIND, URL_ENV } from './names.js'
import { agentRoute, answered, boundaryNotice, isHandoff, lastProviderOf, missedBy, replayBlocks, turnStart } from './switch.js'
import { ImageLinks, savedPathsOf } from './agent-image.js'
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

// The exact disposer of the mirror-tool registration a Session agent carries. It lives on the
// agent, never in this module: a plugin reload replaces the module and the adapter while the
// agent and its scoped tools live on, so the next adapter must find and replace the registration
// the previous one made. A Symbol.for key is the same key in the reloaded module.
const MIRROR_REGISTRATION = Symbol.for('@automagik/acp-dsh/mirror-registration')

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
// An agent whose CLI is not signed in says so with ACP's `auth_required`, at the start of its
// session or of a prompt. The turn fails with its own code, never ACP_AGENT: a sign-in answers
// it, another model does not (the Bot team never falls back on it).
const signInFailure = (name, error) => finish('error', `${name} is not signed in: ${error?.message ?? error}`, MODEL_ACCESS_REQUIRED)

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
// and the new-session notice is for the person. A Bot part's handoff package is the record the
// part carries on from, so it stays beside the person's words (in its place) rather than being
// dropped for them; it is a crossing of earlier text, so it passes the redactor.
export function promptOf(messages, redact = text => text) {
  let start = messages.length
  while (start > 0 && messages[start - 1].role === 'user') start--
  const turn = messages.slice(start).filter(message => message.source?.kind !== NOTICE_KIND)
  const own = turn.filter(message => message.source?.kind === 'user' || isHandoff(message))
  const text = (own.length > 0 ? own : turn)
    .map(message => (isHandoff(message) ? redact(textOf(message.content)) : textOf(message.content)))
    .filter(Boolean).join('\n\n')
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
 * else an explicitly chosen `sideModel`, each configured non-agent route in turn, and the
 * built-in DeepSeek Flash last. DSH's default is the model the person last picked, so on a team
 * that chats with an agent it is usually an agent.
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
  // A credential or route failure on one candidate is not a review verdict: try the next model
  // the team has. Anything else (a bad reply, a timeout) is that candidate's answer.
  const NEXT_MODEL = new Set(['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'NO_ADAPTER'])
  // Every model that can answer beside the chat, in the order the team can reach it: DSH's
  // default model when it is not an agent, a sideModel the person chose, each configured
  // non-agent route in turn (capped), and only then the built-in DeepSeek Flash. Nothing here
  // reaches an agent: a review must never become a prompt in the chat it reviews.
  const choicesFor = async () => {
    const choices = []
    const add = (choice) => {
      if (!answers(choice)) return
      const same = seen => seen.provider === choice.provider && seen.model === choice.model
      if (choices.some(same)) return
      choices.push({ provider: choice.provider, model: choice.model })
    }
    try { add(ctx.get?.('agentDefaultModel')?.currentSelection?.()) } catch {}
    let configured
    try { configured = sideModel() } catch {}
    const explicit = computed => computed !== undefined
      && (computed.provider !== SIDE_MODEL.provider || computed.model !== SIDE_MODEL.model)
    if (answers(configured) && explicit(configured)) add(configured)
    let routes = []
    try { routes = ctx.llm?.listProviders?.() ?? [] } catch {}
    let probed = 0
    for (const route of Array.isArray(routes) ? routes : []) {
      // The cap is on routes examined, not candidates kept: one slow or model-less route must
      // not make the chain walk every provider on the machine.
      if (probed >= 8) break
      if (!answers({ provider: route?.id, model: 'candidate' })) continue
      probed += 1
      let models
      try { models = await ctx.llm?.listModels?.(route.id) } catch {}
      const first = Array.isArray(models)
        ? models.find(model => typeof model?.id === 'string' && model.id !== '')
        : undefined
      if (first === undefined) continue
      add({ provider: route.id, model: first.id })
    }
    // The built-in fallback is last, whatever the person configured: an explicit side model
    // that cannot run must not remove it.
    add(SIDE_MODEL)
    return choices
  }
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
    const routed = options.purpose === REVIEW_PURPOSE ? redactedReview(options, redact) : options
    const { reasoningEffort: _agentEffort, ...request } = routed
    return (async function* () {
      let last
      for (const chosen of await choicesFor()) {
        const chunks = []
        let failure
        let finished = false
        try {
          const attempt = { ...request, provider: chosen.provider, model: chosen.model }
          const stream = ctx.llm.stream(attempt)
          for await (const chunk of stream) {
            chunks.push(chunk)
            if (chunk?.type !== 'finish') continue
            finished = true
            const kind = chunk.reason?.kind
            if (kind === 'error' || kind === 'aborted') failure = chunk.reason.failure
            break
          }
        } catch (error) {
          failure = { message: error?.message ?? String(error), code: error?.code }
        }
        if (failure === undefined && finished) {
          for (const chunk of chunks) yield chunk
          return
        }
        last = failure ?? {
          message: `${chosen.provider}/${chosen.model} ended without an answer`,
          code: 'EMPTY_RESPONSE',
        }
        if (!NEXT_MODEL.has(last.code)) {
          yield finish('error', last.message, last.code)
          return
        }
      }
      yield finish('error', last?.message ?? 'An ACP agent answers only in its own chat',
        last?.code ?? 'UNSUPPORTED')
    })()
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
  constructor(ctx, agents, { dshTools = () => false, backchannel, redactor, onSignedOut, images = () => undefined } = {}) {
    super()
    // Told which agent answered ACP's auth_required, so a cached "signed in" is dropped at once.
    this.onSignedOut = onSignedOut
    this.ctx = ctx
    this.agents = agents
    this.dshTools = dshTools
    this.backchannel = backchannel
    this.redact = redactor ?? (text => text)
    this.live = new Map()
    this.tool = mirrorTool({ runOf: sessionId => this.live.get(sessionId), approval: () => ctx.get?.('approval'), sandboxPolicy: () => ctx.get?.('sandboxPolicy'), permissionPresets: () => ctx.get?.('permissionPresets'), images })
    // A new chat's first model step lists its tools after `agent/created`: register the mirror
    // tool there in every agent's own scope, with the step condition that admits it only on
    // this adapter's routes. A chat is created on DSH's default route and may be picked to an
    // ACP one before its first prompt, so a create-time check would miss that first step. The
    // stream's `scope()` stays as the fallback for an agent this event missed.
    this.ctx.on?.('agent/created', ({ agent } = {}) => this.registerMirror(agent))
    // A plugin reload replaces this adapter while live chats keep their agents. DSH resolves a
    // step's tools before the adapter streams it, so replacing a registration during a running
    // turn would close that step's admission of the mirror tool and its call would fail as
    // UNKNOWN_TOOL. Take over the agents that are idle now, before their next step resolves;
    // for an agent still running, replace on the status edge to idle, after its current step.
    this.ctx.on?.('agent/status', ({ agent, status } = {}) => { if (status === 'idle') this.registerMirror(agent) })
    for (const agent of this.ctx.agents?.list?.() ?? []) this.registerMirror(agent)
  }

  /**
   * Put the mirror tool in the Session agent's own scope, once per adapter, with the condition
   * DSH evaluates when it resolves a step's tools: admitted only while the step's provider is
   * one of this adapter's routes. No model selection means no admission, never a throw. An
   * agent registered by an earlier adapter instance is taken over: its exact disposer is called
   * once and this adapter's registration replaces it. While the agent is running, DSH has
   * already resolved the current step's tools, so a replacement now would fail that step's
   * mirror call as UNKNOWN_TOOL: keep the old registration for this turn and replace it on the
   * next idle edge. A missing agent is a no-op; `scope()` decides what that means for a turn.
   * @param {any} agent
   */
  registerMirror(agent) {
    if (agent === undefined) return
    const current = agent[MIRROR_REGISTRATION]
    if (current?.adapter === this) return
    if (current !== undefined && agent.status === 'running') return
    if (current !== undefined) {
      try { current.dispose() } catch {}
    }
    const dispose = agent.ctx.tools.register(this.tool, {
      when: ({ modelSelection }) => this.agents.has(modelSelection?.provider),
    })
    Object.defineProperty(agent, MIRROR_REGISTRATION, {
      value: { adapter: this, dispose },
      configurable: true,
      writable: true,
    })
  }

  /**
   * Whether DSH's tools reach this agent when the setting says nothing. Only an adapter that
   * can drop its own built-in tools is in the default: today that is Claude Code's. Codex keeps
   * its own tool set, so bridging it by default would run two tool sets; an explicit true
   * still does it.
   */
  bridgeDefault(agent) {
    return agent?.disableBuiltInTools === true
  }

  /**
   * Whether DSH's tools reach an agent at all: an explicit true/false decides, and an absent
   * setting takes the adapter's own switch (`bridgeDefault`).
   */
  bridgeOn(agent) {
    if (this.backchannel === undefined) return false
    const setting = this.dshTools()
    if (setting === true || setting === false) return setting
    return this.bridgeDefault(agent)
  }

  /**
   * Whether the chat crosses to an agent with it (plan A-5): independent of the bridge, so
   * Codex replays by default too. Only an explicit `dshTools: false`, the kill switch, keeps
   * the 2026-11-03 path, where an agent sees no transcript but its own session's.
   */
  replayOn() {
    return this.dshTools() !== false
  }

  /**
   * The kill switch flipped off: end every live agent session and its bridge. The DSH Session
   * keeps its transcript; the next turn starts a fresh agent session without the bridge, so a
   * credential minted while `dshTools` was on cannot keep reaching DSH tools.
   */
  endSessions() {
    for (const live of this.live.values()) {
      live.run?.dispose()
      if (live.bridge !== undefined) this.backchannel?.revoke(live.bridge)
    }
    this.live.clear()
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
    if (!this.bridgeOn(agent) || agent.drift !== true || tool.drift === true) return
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
    if (event?.type !== 'model/selection') return
    const live = this.live.get(session?.id)
    if (live === undefined) return
    // Off is the old path, byte for byte: the agent session is kept across a turn on another
    // provider, so switching back resumes the same ACP session. The default is per agent.
    if (!this.bridgeOn(this.agents.get(live.provider))) return
    const provider = event.data?.provider
    if (agentRoute(this.agents, provider)) return
    this.live.delete(session.id)
    live.run.dispose()
    if (live.bridge !== undefined && this.backchannel !== undefined) this.backchannel.revoke(live.bridge)
    try {
      session.append?.('user/message', boundaryNotice('Switching to DSH'), { surfaceOp: 'append' })
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

  // The mirror tool lives in the agent's own scope: no other Session's model sees it. The
  // agent/created listener (and a reloaded adapter's construction) registers it before the
  // first step; this fallback covers an agent those missed and fails clearly when the Session
  // has no live agent at all.
  scope(sessionId) {
    const agent = this.ctx.agents?.get?.(sessionId)
    if (agent === undefined) {
      const error = new Error(`the Session ${sessionId} has no live agent`)
      error.code = 'acp_agent_missing'
      throw error
    }
    this.registerMirror(agent)
    return agent
  }

  signedOut(id) {
    try { this.onSignedOut?.(id) } catch {}
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
      return yield finish('error', `${agent.name} cannot show its tools here: ${error?.message ?? error}`, error?.code)
    }
    const blocks = new Blocks()
    let live = this.live.get(sessionId)
    // The agent's links to the images it saved locally leave its text before DSH writes it
    // (agent-image.js): the chat shows the image in its own card instead.
    const links = new ImageLinks(() => savedPathsOf(live?.run?.tools?.values()))
    const shown = function* () {
      const rest = links.flush()
      if (rest !== '') yield* blocks.add('text', rest)
    }
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
      // The transcript before this turn: what a replay carries (plan A-5, independent of the
      // bridge; only the kill switch turns it off).
      const history = options.messages.slice(0, turnStart(options.messages))
      const replaying = this.replayOn()
      if (live === undefined) {
        crossing = replaying && prior !== undefined && prior !== options.provider
        const state = { provider: options.provider, name: agent.name, run: undefined, calls: new Set(), open: false, dshAgent, bridge: undefined, replay: undefined, owed: undefined, drifted: false }
        try {
          const spec = await agent.spawn()
          if (this.bridgeOn(agent)) {
            await this.backchannel.listen()
            state.bridge = this.backchannel.mint({ sessionId, agent: dshAgent, name: agent.name })
          }
          const run = new AgentRun({
            ...spec,
            cwd: dshAgent?.session?.header?.cwd ?? homedir(),
            name: agent.name,
            mcpServers: state.bridge === undefined ? [] : [this.bridgeServer(state.bridge)],
            ...(this.bridgeOn(agent) && agent.disableBuiltInTools === true
              ? { sessionMeta: { disableBuiltInTools: true } }
              : {}),
            dshTools: this.bridgeOn(agent),
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
          if (isAuthRequired(error)) {
            this.signedOut(options.provider)
            return yield signInFailure(agent.name, error)
          }
          return yield finish('error', `${agent.name} did not start: ${error?.message ?? error}`, error?.code === 'acp_bridge_missing' ? 'acp_bridge_missing' : undefined)
        }
        live = state
        fresh = true
        if (crossing) {
          this.appendBoundary(dshAgent, agent, options.provider)
          live.owed = { from: this.agents.get(prior)?.name ?? 'DSH' }
          live.replay = replayBlocks(history, { redact: this.redact, to: agent.name, ...live.owed })
        } else if (replaying && answered(history)) {
          // A new session of the same agent in a chat that already has answers (a restart, a
          // session ended by a crossing or a flip, the first real turn of a Bot part whose
          // handoff turn the Bot team answered itself) is a crossing too: the chat, the handoff
          // package included, reaches it. No boundary row: the chat did not change providers.
          const blocks = replayBlocks(history, { redact: this.redact, to: agent.name, renewed: true })
          if (blocks.length > 1) {
            live.owed = { renewed: true }
            live.replay = blocks
          }
        }
      } else if (replaying && live.replay !== undefined) {
        // The last turn never reached its prompt (a refused model, a busy agent): its replay is
        // still owed, read again over the chat as it is now. Its row is already written.
        const source = live.owed?.missed === true ? missedBy(history, options.provider) : history
        if (source !== undefined) live.replay = replayBlocks(source, { redact: this.redact, to: agent.name, ...live.owed })
      } else if (replaying) {
        // A live session resumed after the chat answered elsewhere (an agent whose session a
        // move off it keeps, Codex by default): the turns it missed are replayed before the
        // prompt, so Codex -> API -> Codex loses nothing, and the move back writes its row.
        const missed = missedBy(history, options.provider)
        const owed = { from: this.agents.get(prior)?.name ?? 'DSH', missed: true }
        const blocks = missed === undefined ? [] : replayBlocks(missed, { redact: this.redact, to: agent.name, ...owed })
        if (blocks.length > 1) {
          if (prior !== undefined && prior !== options.provider) this.appendBoundary(dshAgent, agent, options.provider)
          live.owed = owed
          live.replay = blocks
        }
      }
      // A preset or level change since the last turn: the bridge serves the new set, and an
      // agent that ignores `tools/list_changed` gets the list through a fork instead.
      if (live.bridge !== undefined && this.bridgeOn(agent)) {
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
        await choose(
          live.run, options.model, options.reasoningEffort,
          () => agent.catalog?.ownEffort(options.model),
        )
      } catch (error) {
        const at = options.reasoningEffort ? ` at ${options.reasoningEffort} effort` : ''
        const reason = error?.message ?? error
        const why = `${agent.name} would not take ${options.model}${at}: ${reason}`
        return yield finish('error', why)
      }
      try {
        await live.run.setMode(agent.modeFor?.(levelOf(this.ctx.get?.('approval'), dshAgent?.session, this.ctx.get?.('sandboxPolicy'), this.ctx.get?.('permissionPresets'))))
      } catch (error) {
        return yield finish('error', `${agent.name} would not take DSH's permission level: ${error?.message ?? error}`)
      }
      // A new agent session in a chat that already has answers says so once, in a row of its
      // own before the reply (bots-dsh's fallback.js writes its notice the same way). The
      // prompt below was read before it, and promptOf leaves it out of later ones.
      if (fresh && live.replay === undefined && options.messages.some(message => message.role === 'assistant')) {
        try {
          dshAgent?.session?.append?.('user/message', freshSessionNotice(agent.name), { surfaceOp: 'append' })
        } catch (error) {
          try { this.ctx.logger?.warn?.(`acp-dsh: the new-session notice was not written: ${error?.message ?? error}`) } catch {}
        }
      }
      const prompt = live.replay !== undefined
        ? [...live.replay, ...promptOf(options.messages, this.redact)]
        : promptOf(options.messages, this.redact)
      live.replay = undefined
      live.owed = undefined
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
      if (event.type === 'text') {
        const text = links.push(event.text)
        if (text !== '') yield* blocks.add('text', text)
      } else if (event.type === 'thought') {
        yield* shown()
        yield* blocks.add('reasoning', event.text)
      } else if (event.type === 'tool') {
        const tool = live.run.tools.get(event.id)
        // A DSH tool call is not a mirror call: the bridge writes its rows and DSH draws the one
        // card from them. On `acp-codex` no structured name is proven, so any MCP call there is
        // left to the bridge too; its own tools keep their cards.
        // `ToolSearch` is the adapter's own deferred-tool loader (it stays with `tools: []`); it
        // is not a DSH tool and gets no card or dialog either.
        const skip = tool.drift === true || tool.bridge === true
          || tool.structuredName === 'ToolSearch'
          || (agent.refresh === 'fork' && tool.mcp === true)
        if (this.bridgeOn(agent) && skip) continue
        yield* shown()
        await settle(tool, DETAIL_WAIT_MS)
        const id = `acp_${randomUUID()}`
        live.calls.add(id)
        yield* blocks.toolCall(id, TOOL_NAME, JSON.stringify(callArguments(tool)))
        return yield finish('tool-calls')
      } else if (event.type === 'end') {
        yield* shown()
        yield* blocks.close()
        if (event.stopReason === 'cancelled') return yield finish('aborted', 'Stopped', 'ABORTED')
        return yield finish(FINISH[event.stopReason] ?? 'stop')
      } else if (event.type === 'error') {
        yield* shown()
        yield* blocks.close()
        if (isAuthRequired(event)) {
          this.signedOut(options.provider)
          return yield signInFailure(agent.name, event)
        }
        return yield finish('error', `${agent.name}: ${event.message}`)
      } else if (event.type === 'aborted') {
        live.open = false
        await live.run.cancel()
        yield* shown()
        yield* blocks.close()
        return yield finish('aborted', 'Stopped', 'ABORTED')
      }
    }
  }

  /**
   * The row that says the chat is moving to another provider. It is written before the reply,
   * and the call can still fail after it, so it claims no answer (plan A-4): "Switching to X",
   * never "Now answered by X". Whether X answered is read from the next assistant message's
   * source, never from this row.
   */
  appendBoundary(dshAgent, agent, provider) {
    try {
      dshAgent?.session?.append?.('user/message', boundaryNotice(`Switching to ${agent.name} (${provider})`), { surfaceOp: 'append' })
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
