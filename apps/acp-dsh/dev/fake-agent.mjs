#!/usr/bin/env node
// A fake ACP agent for tests. Each prompt: two text chunks, one shell-like tool call that asks
// permission first, then a line saying whether it ran. A prompt that says "twice" makes two
// calls; one that says "hang" waits until it is cancelled; one that says "bridge <tool>" calls
// that tool on the `dsh` MCP server it was given and reports what it answered; one that says
// "drift" announces a built-in tool call (a call `tools: []` should have removed) and waits;
// one that says "image-call" makes an image the way Codex's image tool reports it.
//
// It connects every `mcpServers` entry of `session/new` itself, as both real adapters do, so the
// plugin's bridge is exercised over real stdio. With FAKE_ACP_SKIP_MCP=1 it connects none, as
// codex-acp does when the person's own Codex config already defines that server name.
//
// Like Claude Code's and Codex's adapters it offers its models and each model's efforts as
// session config options (categories `model` and `thought_level`, the effort list rebuilt per
// model), and each turn's thoughts start with the model and effort it runs on. With
// FAKE_ACP_NO_OPTIONS=1 in its environment it offers none, as an older agent would. Its effort
// list starts with a "default" row, as Claude Code's does; FAKE_ACP_NO_DEFAULT_EFFORT=1 leaves it
// out, as Codex's does. FAKE_ACP_AUTH=session (or prompt) refuses `session/new` (or every
// prompt) with ACP's auth_required, as an adapter whose CLI is signed out does.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { PROTOCOL_VERSION, RequestError, ndJsonStream } from '@agentclientprotocol/sdk/unstable'
import { serveAgent } from './serve-agent.mjs'

const MODELS = [
  { value: 'fake-large', name: 'Fake Large', efforts: ['low', 'medium', 'high'], effort: 'medium' },
  { value: 'fake-small', name: 'Fake Small', description: 'Quick and cheap', efforts: ['low', 'high'], effort: 'low' },
  { value: 'fake-plain', name: 'Fake Plain', efforts: [], effort: undefined },
]
const OFFERS = process.env.FAKE_ACP_NO_OPTIONS !== '1'
const DEFAULT_ROW = process.env.FAKE_ACP_NO_DEFAULT_EFFORT === '1' ? [] : [{ value: 'default', name: 'Default' }]
const SKIP_MCP = process.env.FAKE_ACP_SKIP_MCP === '1'
const AUTH = process.env.FAKE_ACP_AUTH
// A test can read what the client asked for (its servers, a fork, a close) from this file.
const TRACE = process.env.FAKE_ACP_TRACE
const trace = (entry) => {
  if (TRACE === undefined) return
  try { appendFileSync(TRACE, `${JSON.stringify({ pid: process.pid, ...entry })}\n`) } catch {}
}

function configOptions(session) {
  const model = MODELS.find(entry => entry.value === session.model)
  const options = [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model.value, options: MODELS.map(({ value, name, description }) => ({ value, name, ...(description ? { description } : {}) })) }]
  if (model.efforts.length > 0) {
    options.push({ id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: session.effort ?? 'default', options: [...DEFAULT_ROW, ...model.efforts.map(value => ({ value, name: value[0].toUpperCase() + value.slice(1) }))] })
  }
  return options
}

// One MCP server as an agent's adapter would use it: newline-delimited JSON-RPC over its stdio.
// A `tools/list_changed` notification makes it re-list, as Claude Code's adapter does (Codex
// ignores it, which is why the plugin forks there instead); the trace keeps the order observable.
function connect(server, sessionId) {
  const env = { ...process.env, ...Object.fromEntries((server.env ?? []).map(({ name, value }) => [name, value])) }
  const child = spawn(server.command, server.args ?? [], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.on('error', () => {})
  let seq = 0
  const pending = new Map()
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.method === 'notifications/tools/list_changed') {
        void request('tools/list', {}).then((listed) => {
          trace({ event: 'relist', sessionId, server: server.name, at: Date.now(), tools: (listed?.tools ?? []).map(tool => tool?.name) })
        }).catch(() => {})
        continue
      }
      if (message.id === undefined) continue
      const waiter = pending.get(message.id)
      if (waiter === undefined) continue
      pending.delete(message.id)
      waiter(message)
    }
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (message) => (message.error === undefined ? resolve(message.result) : reject(new Error(message.error.message))))
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  const ready = (async () => {
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-agent', version: '1' } })
    notify('notifications/initialized', {})
    const listed = await request('tools/list', {})
    return Array.isArray(listed?.tools) ? listed.tools : []
  })()
  return { name: server.name, child, request, tools: ready, close: () => { try { child.stdin.end() } catch {} ; try { child.kill('SIGTERM') } catch {} } }
}

async function attach(session, servers, sessionId) {
  session.mcp = new Map()
  if (SKIP_MCP) return
  for (const server of servers ?? []) {
    const connection = connect(server, sessionId)
    session.mcp.set(server.name, connection)
    const tools = await connection.tools.catch(() => [])
    // The adapter's first `tools/list` for this session, before its `session/new` (or fork)
    // answer: the delivery 6 probes read this order from the trace.
    trace({ event: 'mcp-list', sessionId, server: server.name, tools: tools.map(tool => tool?.name) })
  }
}

// A 1x1 PNG, for the image calls.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
const sessions = new Map()
let created = 0

function newSession(sessionId, cwd) {
  const session = { cwd, cancelled: false, turns: 0, model: MODELS[0].value, effort: MODELS[0].effort, mcp: new Map() }
  sessions.set(sessionId, session)
  return session
}

const implementation = {
  async initialize() {
    // FAKE_ACP_PROTOCOL answers another protocol version, as an adapter built for a later ACP does.
    const protocolVersion = process.env.FAKE_ACP_PROTOCOL === undefined ? PROTOCOL_VERSION : Number(process.env.FAKE_ACP_PROTOCOL)
    return { protocolVersion, agentCapabilities: { loadSession: false }, authMethods: [] }
  },
  async newSession(params) {
    if (AUTH === 'session') throw RequestError.authRequired(undefined, 'run the CLI\'s login first')
    const sessionId = `fake-${++created}`
    trace({ event: 'new-session', sessionId, servers: (params.mcpServers ?? []).map(server => server.name) })
    const session = newSession(sessionId, params.cwd)
    await attach(session, params.mcpServers, sessionId)
    trace({ event: 'new-answer', sessionId, at: Date.now() })
    return { sessionId, ...(OFFERS ? { configOptions: configOptions(session) } : {}) }
  },
  async forkSession(params) {
    if (process.env.FAKE_ACP_FORK_FAIL === '1') throw RequestError.invalidParams(undefined, 'fork refused')
    const source = sessions.get(params.sessionId)
    if (source === undefined) throw RequestError.invalidParams(undefined, `Unknown session: ${params.sessionId}`)
    const sessionId = `fake-${++created}`
    const session = newSession(sessionId, params.cwd ?? source.cwd)
    // The fork continues the same conversation: the fake carries its turn count (the point the
    // plugin's refresh relies on) and the agent's mode.
    session.turns = source.turns
    session.model = source.model
    session.effort = source.effort
    session.forkedFrom = params.sessionId
    trace({ event: 'fork', from: params.sessionId, sessionId, servers: (params.mcpServers ?? []).map(server => server.name) })
    // A fork that cannot offer the bridge: `session/fork` answers with a session whose server
    // never started, as codex-acp does when the person's Codex config defines that name.
    if (process.env.FAKE_ACP_FORK_SKIP_MCP !== '1') await attach(session, params.mcpServers, sessionId)
    // The answer is held open, so a probe can land a preset change while the session does not
    // exist yet (the ordering rule is exercised from both sides).
    const delay = Number(process.env.FAKE_ACP_FORK_DELAY_MS ?? 0)
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    trace({ event: 'fork-answer', sessionId, from: params.sessionId, at: Date.now() })
    return { sessionId, ...(OFFERS ? { configOptions: configOptions(session) } : {}) }
  },
  async closeSession({ sessionId }) {
    trace({ event: 'close', sessionId })
    const session = sessions.get(sessionId)
    if (session !== undefined) {
      session.closed = true
      for (const connection of session.mcp.values()) connection.close()
    }
    return {}
  },
  async setSessionConfigOption({ sessionId, configId, value }) {
    const session = sessions.get(sessionId)
    if (!OFFERS || !session) throw RequestError.invalidParams(undefined, `Unknown config option: ${configId}`)
    const option = configOptions(session).find(entry => entry.id === configId)
    if (!option?.options.some(entry => entry.value === value)) throw RequestError.invalidParams(undefined, `Invalid value for config option ${configId}: ${value}`)
    if (configId === 'model') {
      const model = MODELS.find(entry => entry.value === value)
      session.model = value
      // A new model keeps the effort when it offers it, else takes its own.
      if (!model.efforts.includes(session.effort)) session.effort = model.effort
    } else {
      session.effort = value === 'default' ? undefined : value
    }
    return { configOptions: configOptions(session) }
  },
  async authenticate() { return {} },
  async cancel({ sessionId }) {
    trace({ event: 'cancel', sessionId })
    const session = sessions.get(sessionId)
    if (session) {
      session.cancelled = true
      session.wake?.()
    }
  },
  async prompt({ sessionId, prompt }) {
    if (AUTH === 'prompt') throw RequestError.authRequired()
    const session = sessions.get(sessionId)
    session.cancelled = false
    session.turns++
    const said = prompt.filter(block => block.type === 'text').map(block => block.text).join(' ')
    // What the client actually sent this turn (a replayed transcript, for a crossing).
    trace({ event: 'prompt', sessionId, turns: session.turns, text: said })
    const update = u => conn.sessionUpdate({ sessionId, update: u })
    if (OFFERS) await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `On ${session.model} at ${session.effort ?? 'no'} effort. ` } })
    await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking it over.' } })
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Fake agent, turn ${session.turns}: ` } })
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `you said "${said}".` } })
    // Updates a newer or a broken adapter could send: a kind this client does not know, and a
    // tool update with no call id. Neither may end the turn or hide what comes after.
    if (/odd-updates/.test(said)) {
      await update({ sessionUpdate: 'kind_from_the_future', detail: { anything: true } })
      await update({ sessionUpdate: 'tool_call_update', status: 'completed' })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' Still here.' } })
      return { stopReason: 'end_turn' }
    }
    // A question the agent takes back before it is answered (`$/cancel_request`).
    if (/withdraw/.test(said)) {
      const toolCallId = `withdrawn-${session.turns}`
      await update({ sessionUpdate: 'tool_call', toolCallId, title: 'echo withdrawn', kind: 'execute', status: 'pending', rawInput: { command: 'echo withdrawn' } })
      const controller = new AbortController()
      const asked = conn.requestPermission({
        sessionId,
        toolCall: { toolCallId, title: 'Run command?' },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
      }, { cancellationSignal: controller.signal })
      setTimeout(() => controller.abort(), Number(process.env.FAKE_ACP_WITHDRAW_MS ?? 50))
      const answer = await asked.then(value => value.outcome?.outcome, error => `error ${error?.code}`)
      trace({ event: 'withdrawn', sessionId, answer })
      await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` Withdrawn: ${answer}.` } })
      return { stopReason: 'end_turn' }
    }
    // A plain answer with no tool call: the turn ends cleanly, for tests about the session.
    if (/plain/.test(said)) return { stopReason: 'end_turn' }
    if (/hang/.test(said)) {
      if (!session.cancelled) await new Promise((resolve) => { session.wake = resolve })
      return { stopReason: 'cancelled' }
    }
    // A tool call the agent should not be able to make with `tools: []`: the plugin's drift
    // detector records it and cancels on this trace.
    if (/drift/.test(said)) {
      const toolCallId = `drift-${session.turns}`
      trace({ event: 'builtin-tool-call', sessionId, toolCallId, name: 'Bash' })
      await update({ sessionUpdate: 'tool_call', toolCallId, name: 'Bash', title: 'Bash: rm -rf build', kind: 'execute', status: 'pending', rawInput: { command: 'rm -rf build' } })
      if (!session.cancelled) await new Promise((resolve) => { session.wake = resolve })
      return { stopReason: 'cancelled' }
    }
    // The adapter's own deferred-tool loader, seen with `tools: []`: it is not a DSH tool.
    if (/toolsearch/.test(said)) {
      const toolCallId = `search-${session.turns}`
      await update({ sessionUpdate: 'tool_call', toolCallId, name: 'ToolSearch', title: 'ToolSearch', kind: 'other', status: 'pending', rawInput: { query: 'select:mcp__dsh__bash' } })
      await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'found bash' } }] })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' I found it.' } })
      return { stopReason: 'end_turn' }
    }
    // Agent output carrying credentials: DSH logs what the agent says, so the plugin must
    // redact it before it is written down.
    if (/leak-tool/.test(said)) {
      const toolCallId = `leak-${session.turns}`
      await update({ sessionUpdate: 'tool_call', toolCallId, title: 'Read key', kind: 'read', status: 'pending', rawInput: { file_path: '/tmp/leak', note: 'sk-abcdef123456' } })
      await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'token sk-abcdef123456 npm_abcdefghijklmnopqrstuvwxyz' } }] })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' done' } })
      return { stopReason: 'end_turn' }
    }
    if (/leak/.test(said)) {
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'leak sk-abcdef123456 npm_abcdefghijklmnopqrstuvwxyz Bearer abcdefgh1234' } })
      await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thought sk-abcdef123456' } })
      return { stopReason: 'end_turn' }
    }
    // An MCP call from codex-acp: no structured name at all, only `is_mcp_tool_call`.
    if (/mcp-call/.test(said)) {
      const toolCallId = `mcp-${session.turns}`
      await update({ sessionUpdate: 'tool_call', toolCallId, title: 'mcp.dsh.bash', kind: 'other', status: 'pending', _meta: { is_mcp_tool_call: true } })
      await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'answered' } }] })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' The MCP tool answered.' } })
      return { stopReason: 'end_turn' }
    }
    // A tool call on the `dsh` bridge, by the name Claude Code puts on the wire. With "permit"
    // the call first asks session/request_permission, as Claude Code does in Manual; without it
    // the call runs with no ACP-level request at all, as it would in Auto.
    const bridged = /bridge(-permit)? (\S+)/.exec(said)
    if (bridged !== null) {
      const permit = bridged[1] === '-permit'
      const name = bridged[2]
      const connection = session.mcp.get('dsh')
      const toolCallId = `bridge-${session.turns}`
      const structured = `mcp__dsh__${name}`
      const toolCall = { toolCallId, name: structured, title: structured, kind: 'other', status: 'pending', rawInput: {}, _meta: { claudeCode: { toolName: structured } } }
      await update({ sessionUpdate: 'tool_call', ...toolCall })
      let permitted = 'not-asked'
      if (permit) {
        const answer = await conn.requestPermission({
          sessionId,
          toolCall,
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        })
        permitted = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : answer.outcome.outcome
        if (permitted === 'cancelled') return { stopReason: 'cancelled' }
      }
      let text = 'the bridge is not connected'
      if (connection !== undefined) {
        try {
          const answer = await connection.request('tools/call', { name, arguments: {} })
          text = (answer.content ?? []).map(block => block.text ?? '').join('\n') || '(no text)'
        } catch (error) {
          text = `bridge failed: ${error?.message ?? error}`
        }
      }
      await update({ sessionUpdate: 'tool_call_update', toolCallId, status: session.cancelled ? 'failed' : 'completed', content: [{ type: 'content', content: { type: 'text', text } }] })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` The bridge said: ${text} (permit ${permitted})` } })
      return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' }
    }
    // Codex's built-in image tool as codex-acp reports it: an `other` call titled "Image
    // generation" whose finished update carries the PNG (an ACP image block and rawOutput.result)
    // and a saved path under a Codex home that must never be opened; then a reply that links that
    // path, split across chunks. "image-call-fail" fails the call; "image-call-other" is a call
    // that makes no image but answers with one (a Read of a JPEG on disk).
    const imaged = /image-call(-fail|-other)?/.exec(said)
    if (imaged !== null) {
      const toolCallId = `image-${session.turns}`
      const other = imaged[1] === '-other'
      const title = other ? 'Read photo.jpg' : 'Image generation'
      await update({ sessionUpdate: 'tool_call', toolCallId, title, kind: other ? 'read' : 'other', status: 'in_progress', rawInput: { id: toolCallId } })
      if (imaged[1] === '-fail') {
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', rawOutput: { status: 'failed' } })
        await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' It did not work.' } })
        return { stopReason: 'end_turn' }
      }
      const savedPath = '/fake-codex-home/generated_images/never-open-me.png'
      await update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: other
          ? [{ type: 'content', content: { type: 'text', text: 'Read photo.jpg' } }, { type: 'content', content: { type: 'image', data: '/9j/4AAQSkZJRgABAQ==', mimeType: 'image/jpeg', uri: '/work/photo.jpg' } }]
          : [{ type: 'content', content: { type: 'text', text: 'Revised prompt: a fox' } }, { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png', uri: savedPath } }],
        ...(other ? {} : { rawOutput: { status: 'completed', revisedPrompt: 'a fox', result: PNG, savedPath } }),
      })
      for (const text of [' Here it is: ![a fox](/fake-codex-', 'home/generated_images/never-open-me.png)', ' Also at `/fake-codex-home/generated_', 'images/never-open-me.png`.']) {
        await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
      }
      return { stopReason: 'end_turn' }
    }
    const calls = /twice/.test(said) ? 2 : 1
    for (let n = 1; n <= calls; n++) {
      const toolCallId = `call-${session.turns}-${n}`
      const command = `echo hello ${n}`
      await update({ sessionUpdate: 'tool_call', toolCallId, title: `Run ${command}`, kind: 'execute', status: 'pending', rawInput: { command } })
      const answer = await conn.requestPermission({
        sessionId,
        toolCall: { toolCallId, title: `Run ${command}`, kind: 'execute', rawInput: { command } },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })
      if (session.cancelled || answer.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' }
      const allowed = answer.outcome.optionId === 'yes'
      if (allowed) {
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' })
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: `hello ${n}` } }] })
      } else {
        await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'Not allowed' } }] })
      }
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? ` It printed hello ${n}.` : ' I was not allowed to run it.' } })
    }
    return { stopReason: 'end_turn' }
  },
}

const conn = serveAgent(implementation, stream)
