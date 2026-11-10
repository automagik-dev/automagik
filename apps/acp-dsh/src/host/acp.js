// One agent process over ACP (Agent Client Protocol): spawned once per DSH Session, one ACP
// session inside it, prompted once per DSH turn. What the agent streams lands in a queue the
// adapter drains step by step; its tool calls are kept by id so the mirror tool (tool.js) can
// wait on each one and answer its permission request through DSH.
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import { batchSafe } from './batch-spawn.js'
import { isBridgeName } from './names.js'

const STDERR_KEEP = 4000
const TERMINAL = new Set(['completed', 'failed'])

/**
 * The structured tool name a call carries, when the adapter sends one: Claude Code puts it at
 * the update's root and in `_meta.claudeCode.toolName` (the spike's wire). codex-acp sends none
 * for an MCP call, so matching there stays unsupported until a name is proven.
 */
export function structuredNameOf(update) {
  if (typeof update?.name === 'string' && update.name !== '') return update.name
  const meta = update?._meta?.claudeCode
  if (typeof meta?.toolName === 'string' && meta.toolName !== '') return meta.toolName
  return undefined
}

// The text of ACP content: a content block, or a tool call's content items.
export function contentText(content) {
  if (content == null) return ''
  if (Array.isArray(content)) return content.map(contentText).filter(Boolean).join('\n')
  if (content.type === 'content') return contentText(content.content)
  if (content.type === 'text') return content.text ?? ''
  if (content.type === 'resource_link') return content.uri ?? ''
  if (content.type === 'resource') return content.resource?.text ?? content.resource?.uri ?? ''
  return ''
}

// The image blocks of ACP content: a content block, or a tool call's content items. An image is
// `{ type: 'image', data, mimeType }`, inside a `content` wrapper or not. The block is returned
// as the agent sent it, so its base64 data is never decoded and encoded again; a durable DSH
// image block (`attachment`) is returned too, for a tool result that already carries one.
export function contentImages(content) {
  if (content == null) return []
  if (Array.isArray(content)) return content.flatMap(contentImages)
  if (content.type === 'content') return contentImages(content.content)
  return content.type === 'image' ? [content] : []
}

export class AgentRun {
  /**
   * @param {{ command: string, args?: string[], env?: Record<string, string>, cwd: string, name: string }} spec
   */
  constructor(spec) {
    this.spec = spec
    this.queue = []
    this.waiters = []
    this.tools = new Map()
    this.stderr = ''
    this.prompting = undefined
    this.exited = undefined
  }

  async start() {
    const { command, args = [], env, cwd, mcpServers = [], sessionMeta } = this.spec
    // Through batchSafe: a native agent's CLI can be a Windows batch file (hermes.cmd), which
    // Node refuses to spawn without a shell.
    const child = spawn(...batchSafe(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }))
    this.child = child
    // An idle agent never keeps DSH running: only a prompt in flight holds the event loop.
    child.unref()
    for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.unref?.()
    this.holdOn()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-STDERR_KEEP) })
    const gone = new Promise((_, fail) => {
      child.once('error', error => fail(error))
      child.once('exit', (code, signal) => {
        this.exited = { code, signal }
        fail(new Error(`${this.spec.name} exited (${signal ?? code})${this.stderr ? `: ${this.stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`))
      })
    })
    gone.catch(() => {})
    this.gone = gone
    child.stdin.on('error', () => {})
    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    this.conn = new ClientSideConnection(() => ({
      sessionUpdate: params => this.onUpdate(params.update),
      requestPermission: params => this.onPermission(params),
    }), stream)
    const ready = (async () => {
      this.init = await this.conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      const session = await this.conn.newSession({
        cwd,
        mcpServers,
        ...(sessionMeta === undefined ? {} : { _meta: sessionMeta }),
      })
      this.sessionId = session.sessionId
      this.modes = session.modes
      this.options = withModels(session.configOptions ?? [], session.models)
      // The model the agent started on: DSH's `default` model goes back to it.
      this.startModel = optionOf(this.options, 'model')?.currentValue
      // The session exists (the spike's ordering rule for the bridge's first announcement) and
      // a bridge that never listed its tools fails the turn here, before the prompt.
      await this.spec.onReady?.(this)
    })()
    try {
      await Promise.race([ready, gone])
    } catch (error) {
      this.dispose()
      throw error
    } finally {
      this.letGo()
    }
    return this
  }

  /**
   * Replace this ACP session with a fork that carries the same conversation and the new server
   * set, then close the source session: `acp-codex` ignores `tools/list_changed` and a new server
   * list on resume, so this is how its tool set follows a preset or level change. Both bridges
   * are the plugin's to end; the source's credential is revoked by the caller.
   * @param {{ cwd: string, mcpServers: any[] }} options
   * @returns {Promise<string>} the forked session id
   */
  async fork({ cwd, mcpServers }) {
    if (typeof this.conn.unstable_forkSession !== 'function') throw new Error('it cannot fork its session')
    const source = this.sessionId
    const answer = await this.held(() => Promise.race([
      this.conn.unstable_forkSession({ sessionId: source, cwd, mcpServers }),
      this.gone,
    ]))
    this.sessionId = answer.sessionId
    if (answer.modes !== undefined && answer.modes !== null) this.modes = answer.modes
    if (Array.isArray(answer.configOptions)) this.options = withModels(answer.configOptions, answer.models ?? modelStateOf(this.options))
    this.tools.clear()
    // The fork's source is closed by us: the spike did not show the fork closing it, and a
    // Session must never hold two bridges.
    try {
      if (typeof this.conn.closeSession === 'function') {
        await this.held(() => Promise.race([this.conn.closeSession({ sessionId: source }), this.gone]))
      }
    } catch {
      // A source session that will not close still ends with this process, which is disposed
      // with the fork's Session.
    }
    await this.spec.onReady?.(this)
    return this.sessionId
  }

  // Each request the agent has yet to answer holds the event loop; the last answer lets it go.
  holdOn() {
    this.holds = (this.holds ?? 0) + 1
    this.hold ??= setInterval(() => {}, 1 << 30)
  }
  letGo(all = false) {
    this.holds = all ? 0 : Math.max(0, (this.holds ?? 0) - 1)
    if (this.holds > 0) return
    clearInterval(this.hold)
    this.hold = undefined
  }
  async held(work) {
    this.holdOn()
    try {
      return await work()
    } finally {
      this.letGo()
    }
  }

  get alive() { return this.child !== undefined && this.exited === undefined }
  get busy() { return this.prompting !== undefined }

  push(event) {
    const waiter = this.waiters.shift()
    if (waiter) waiter(event)
    else this.queue.push(event)
  }

  /** The next event the agent sent: text, thought, tool (first sight of a call), end, error. */
  next(signal) {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift())
    return new Promise((resolve) => {
      const onAbort = () => {
        this.waiters = this.waiters.filter(waiter => waiter !== take)
        resolve({ type: 'aborted' })
      }
      const take = (event) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(event)
      }
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(take)
    })
  }

  prompt(prompt) {
    if (this.busy) throw new Error(`${this.spec.name} is still answering`)
    this.queue = []
    this.holdOn()
    const run = this.conn.prompt({ sessionId: this.sessionId, prompt })
    this.prompting = Promise.race([run, this.gone]).then(
      result => this.endPrompt({ type: 'end', stopReason: result?.stopReason ?? 'end_turn' }),
      error => this.endPrompt({ type: 'error', message: error?.message ?? String(error), ...(error?.code === undefined ? {} : { code: error.code }) }),
    )
    return this.prompting
  }

  endPrompt(event) {
    this.prompting = undefined
    this.letGo()
    // A call the agent never closed is over with its turn; a question it never got an answer to is withdrawn.
    for (const tool of this.tools.values()) {
      tool.permission?.answer({ outcome: { outcome: 'cancelled' } })
      if (!TERMINAL.has(tool.status)) this.changeTool(tool, { status: tool.status === 'pending' ? 'failed' : 'completed', ended: true })
    }
    this.push(event)
  }

  /**
   * Switch the agent's own permission mode to the first of `modeIds` it offers (most wanted
   * first, the strict one last). One it lacks falls back to the next; when it offers none of
   * them, not even the strict one, the turn fails rather than run in whatever mode the agent
   * started in (the person's own default, which may let calls through unasked).
   * @param {string | string[] | undefined} modeIds
   */
  async setMode(modeIds) {
    if (modeIds === undefined) return
    const wanted = [modeIds].flat()
    const offered = new Set((this.modes?.availableModes ?? []).map(mode => mode.id))
    const modeId = wanted.find(id => offered.has(id))
    if (modeId === undefined) throw new Error(`it offers none of the modes ${wanted.join(', ')} (it offers ${[...offered].join(', ') || 'no modes'})`)
    if (this.modes?.currentModeId === modeId) return
    await this.held(() => Promise.race([this.conn.setSessionMode({ sessionId: this.sessionId, modeId }), this.gone]))
    this.modes = { ...this.modes, currentModeId: modeId }
  }

  /** The agent's own option of `category` (`model`, `thought_level`), as it last said. */
  option(category) {
    return optionOf(this.options, category)
  }

  /**
   * Set the agent's option of `category` to `value`, one of the values it offers. One it does
   * not offer fails, naming those it does: the turn then fails rather than run on another model
   * or effort than the person chose.
   * @param {string} category
   * @param {string} value
   */
  async setOption(category, value) {
    const option = this.option(category)
    if (option === undefined) throw new Error(`it has no ${category} setting`)
    const values = valuesOf(option)
    if (!values.some(choice => choice.value === value)) throw new Error(`it offers no ${category} ${value} (it offers ${values.map(choice => choice.value).join(', ') || 'none'})`)
    if (option.currentValue === value) return
    if (option.id === MODEL_STATE) {
      // The session's own model list (`session/set_model`), for an agent with no model option.
      const params = { sessionId: this.sessionId, modelId: value }
      try {
        await this.held(() => Promise.race([typeof this.conn.request === 'function' ? this.conn.request('session/set_model', params) : this.conn.extMethod('session/set_model', params), this.gone]))
      } catch (error) {
        // An agent can list a model it then cannot resolve (seen with Hermes: "Internal error",
        // the reason only in the error's data). Say which model and, when it is a plain word, why.
        const details = typeof error?.data?.details === 'string' && /^[\w .:-]{1,80}$/.test(error.data.details) ? ` (${error.data.details})` : ''
        throw new Error(`it could not switch to ${value}: ${error?.message ?? error}${details}`, { cause: error })
      }
      this.options = this.options.map(other => (other.id === MODEL_STATE ? { ...other, currentValue: value } : other))
      return
    }
    const answer = await this.held(() => Promise.race([this.conn.setSessionConfigOption({ sessionId: this.sessionId, configId: option.id, value }), this.gone]))
    // The answer is the whole set: a new model may bring other efforts.
    this.options = answer?.configOptions ? withModels(answer.configOptions, modelStateOf(this.options)) : this.options.map(other => (other.id === option.id ? { ...other, currentValue: value } : other))
  }

  async cancel() {
    if (!this.busy || this.sessionId === undefined) return
    await this.held(() => this.conn.cancel({ sessionId: this.sessionId })).catch(() => {})
  }

  dispose() {
    this.letGo(true)
    for (const tool of this.tools.values()) tool.permission?.answer({ outcome: { outcome: 'cancelled' } })
    try { this.child?.stdin.end() } catch {}
    const child = this.child
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 3000)
      timer.unref?.()
      child.once('exit', () => clearTimeout(timer))
    }
  }

  // --- the agent's side of the conversation ---------------------------------------------

  async onUpdate(update) {
    switch (update?.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = contentText(update.content)
        if (text) this.push({ type: 'text', text })
        break
      }
      case 'agent_thought_chunk': {
        const text = contentText(update.content)
        if (text) this.push({ type: 'thought', text })
        break
      }
      case 'tool_call':
        this.seeTool(update)
        break
      case 'tool_call_update': {
        const tool = this.tools.get(update.toolCallId) ?? this.seeTool(update)
        this.changeTool(tool, update)
        break
      }
      case 'config_option_update':
        if (Array.isArray(update.configOptions)) this.options = withModels(update.configOptions, modelStateOf(this.options))
        break
      case 'current_mode_update':
        if (this.modes) this.modes = { ...this.modes, currentModeId: update.currentModeId }
        break
      default:
        break
    }
  }

  seeTool(update) {
    const known = this.tools.get(update.toolCallId)
    if (known) {
      this.changeTool(known, update)
      return known
    }
    const tool = { id: update.toolCallId, title: update.title ?? 'Tool', kind: update.kind ?? 'other', status: update.status ?? 'pending', content: update.content ?? [], locations: update.locations ?? [], rawInput: update.rawInput, rawOutput: update.rawOutput, listeners: new Set() }
    this.markCall(tool, update)
    this.tools.set(tool.id, tool)
    this.push({ type: 'tool', id: tool.id })
    return tool
  }

  /** What an update says the call is: its structured name, whether it is MCP, the bridge's. */
  markCall(tool, update) {
    const name = structuredNameOf(update)
    if (name !== undefined) tool.structuredName = name
    if (update?._meta?.is_mcp_tool_call === true) tool.mcp = true
    if (tool.structuredName !== undefined && tool.structuredName.startsWith('mcp__')) tool.mcp = true
    if (isBridgeName(tool.structuredName)) tool.bridge = true
    if (tool.noted !== true && (tool.structuredName !== undefined || tool.mcp === true)) {
      tool.noted = true
      try {
        this.spec.onToolCall?.(tool)
      } catch {
        // Drift handling is the plugin's, not the run's: a throw must not stop the agent's call.
      }
    }
  }

  changeTool(tool, update) {
    // A command's output, for a client with no terminal of its own (Zed's terminal_output
    // extension, which codex-acp sends): kept as the call's output.
    const chunk = update._meta?.terminal_output?.data
    if (typeof chunk === 'string') tool.output = (tool.output ?? '') + chunk
    for (const key of ['title', 'kind', 'status', 'content', 'locations', 'rawInput', 'rawOutput', 'ended']) {
      if (update[key] !== undefined && update[key] !== null) tool[key] = update[key]
    }
    this.markCall(tool, update)
    for (const listener of tool.listeners) listener()
  }

  /**
   * DSH refused or cancelled the mirror call of the agent's tool `id` before its body ran, so
   * nothing there will answer the agent's question for it: answer it here, with the agent's own
   * reject option, or as cancelled when the call was stopped. A question that comes later gets
   * the same answer (onPermission). It only ever refuses.
   * @param {string} id
   * @param {boolean} cancelled
   */
  refuse(id, cancelled) {
    const tool = this.tools.get(id)
    if (tool === undefined) return
    tool.refused = cancelled ? 'cancelled' : 'rejected'
    const permission = tool.permission
    permission?.answer(refusal(tool.refused, permission.options))
  }

  onPermission(params) {
    const known = this.tools.get(params.toolCall?.toolCallId)
    const tool = known ?? this.seeTool({ status: 'pending', ...params.toolCall })
    // The question's own title ("Run command?") names the question, not the call the card shows.
    const { title, ...details } = params.toolCall ?? {}
    this.changeTool(tool, { ...details, status: undefined })
    // The bridge's call is not the mirror's: acp-dsh answers this ACP request itself with
    // `allow-once` and raises no DSH dialog from it. The bridge's own `approval/request` is the
    // one dialog the person sees (RFC 0003, amendment, "One dialog per call").
    if (this.spec.dshTools === true && tool.bridge === true) {
      const once = (params.options ?? []).find(option => option.kind === 'allow_once')
        ?? (params.options ?? []).find(option => option.kind === 'allow_always')
      return Promise.resolve(once === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: once.optionId } })
    }
    // DSH already refused this call before the mirror's body could ask (refuse): no body is
    // left to answer the agent, so the refusal is its answer.
    if (tool.refused !== undefined) return Promise.resolve(refusal(tool.refused, params.options ?? []))
    // A second question for the call while the first was not asked yet: the first is withdrawn,
    // or nothing would ever answer it. One already in its dialog keeps the dialog's answer.
    const earlier = tool.permission
    if (earlier !== undefined && earlier.asked !== true) earlier.answer({ outcome: { outcome: 'cancelled' } })
    return new Promise((resolve) => {
      let done = false
      const permission = {
        options: params.options ?? [],
        answer: (response) => {
          if (done) return
          done = true
          if (tool.permission === permission) tool.permission = undefined
          resolve(response)
          for (const listener of tool.listeners) listener()
        },
      }
      permission.title = title
      tool.permission = permission
      for (const listener of tool.listeners) listener()
    })
  }
}

// A refusal as the agent's own reject option; a stopped call, or an agent that offers no reject
// option, is answered as cancelled.
function refusal(kind, options) {
  const chosen = kind === 'rejected'
    ? options.find(option => option.kind === 'reject_once') ?? options.find(option => option.kind === 'reject_always')
    : undefined
  return chosen ? { outcome: { outcome: 'selected', optionId: chosen.optionId } } : { outcome: { outcome: 'cancelled' } }
}

// The id of the model option made from a session's own model list (`models` in the answer to
// `session/new`: `availableModels` and `currentModelId`, switched with `session/set_model`).
// Hermes offers its models only there. No agent's own option can carry this id by accident.
export const MODEL_STATE = '\u0000session-models'

/**
 * An agent's config options, with its session model list as the `model` option when it offers
 * no model option of its own (an agent that offers both, as Antigravity does, keeps its own).
 */
export function withModels(options, models) {
  if (optionOf(options, 'model') !== undefined) return options
  const offered = (Array.isArray(models?.availableModels) ? models.availableModels : []).filter(model => typeof model?.modelId === 'string' && model.modelId !== '')
  if (offered.length === 0) return options
  return [...options, {
    id: MODEL_STATE,
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: typeof models.currentModelId === 'string' ? models.currentModelId : undefined,
    options: offered.map(model => ({ value: model.modelId, name: typeof model.name === 'string' && model.name !== '' ? model.name : model.modelId, ...(typeof model.description === 'string' && model.description !== '' ? { description: model.description } : {}) })),
  }]
}

// The session model list an option set was made from, to carry it over an answer that names
// only the agent's own options.
const modelStateOf = (options) => {
  const made = (options ?? []).find(option => option?.id === MODEL_STATE)
  return made === undefined ? undefined : { currentModelId: made.currentValue, availableModels: made.options.map(({ value, name, description }) => ({ modelId: value, name, description })) }
}

/** The option of `category` among an agent's session config options. */
export const optionOf = (options, category) => (options ?? []).find(option => option?.category === category && option.type === 'select')

/** The values a select option offers, its groups flattened. */
export const valuesOf = option => (option?.options ?? []).flatMap(entry => (Array.isArray(entry?.options) ? entry.options : [entry])).filter(entry => typeof entry?.value === 'string')

export const isTerminal = tool => TERMINAL.has(tool.status) || tool.ended === true
