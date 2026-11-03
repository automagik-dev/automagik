// The mirror tool. An ACP agent runs its own tools; DSH should still show each one as its own
// tool card and ask through its own approval dialog. So the adapter ends the model step at the
// agent's tool call with a call to this tool, registered in that agent's scope only. DSH writes
// the tool/call and tool/result rows itself, as for any tool. The body runs nothing: it waits
// for the agent's call to finish, and when the agent asks permission for it, asks DSH's
// approval service and hands the agent the answer.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { contentText, isTerminal } from './acp.js'

export const TOOL_NAME = 'acp_tool'
const DSH_KINDS = new Set(['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch', 'other'])
const kindOf = kind => (DSH_KINDS.has(kind) ? kind : 'other')
const OUTPUT_LIMIT = 20_000

const diffsOf = content => (Array.isArray(content) ? content : [])
  .filter(item => item?.type === 'diff' && typeof item.path === 'string')
  .map(item => ({ path: item.path, oldText: item.oldText ?? null, newText: item.newText ?? '' }))

const commandOf = (input) => {
  const command = input?.command ?? input?.cmd
  if (Array.isArray(command)) return command.join(' ')
  return typeof command === 'string' ? command : undefined
}

/** The arguments the adapter writes for one of the agent's calls, as it first shows it. */
export function callArguments(tool) {
  const diffs = diffsOf(tool.content)
  return {
    id: tool.id,
    title: tool.title,
    kind: tool.kind,
    input: tool.rawInput ?? null,
    ...(tool.locations?.length ? { locations: tool.locations.map(at => ({ path: at.path, ...(at.line == null ? {} : { line: at.line }) })) } : {}),
    ...(diffs.length ? { diffs } : {}),
  }
}

function resultOf(tool) {
  const text = contentText(tool.content) || tool.output || (tool.rawOutput === undefined ? '' : typeof tool.rawOutput === 'string' ? tool.rawOutput : JSON.stringify(tool.rawOutput))
  const diffs = diffsOf(tool.content)
  return {
    title: tool.title,
    kind: tool.kind,
    status: tool.status,
    text: text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}…` : text,
    ...(diffs.length ? { diffs } : {}),
  }
}

// DSH's one-shot answer, as the option the agent offered for it.
export function optionFor(outcome, options) {
  const pick = kinds => kinds.map(kind => options.find(option => option.kind === kind)).find(Boolean)
  const chosen = outcome === 'allowed-once' ? pick(['allow_once', 'allow_always']) : outcome === 'rejected' ? pick(['reject_once', 'reject_always']) : undefined
  return chosen ? { outcome: { outcome: 'selected', optionId: chosen.optionId } } : { outcome: { outcome: 'cancelled' } }
}

const changed = (tool, signal) => new Promise((resolve) => {
  const done = () => {
    tool.listeners.delete(done)
    signal?.removeEventListener('abort', done)
    resolve()
  }
  tool.listeners.add(done)
  signal?.addEventListener('abort', done, { once: true })
})

/**
 * @param {{ runOf(sessionId: string): { run: import('./acp.js').AgentRun, name: string } | undefined, approval(): any }} host
 */
export function mirrorTool(host) {
  return defineTool({
    name: TOOL_NAME,
    description: 'A tool call the ACP agent made with its own tools. Only the agent calls it; it shows the call and asks for approval when the agent needs it.',
    parameters: {
      id: { type: 'string', required: true, description: "The agent's own id for the call." },
      title: { type: 'string', required: true },
      kind: { type: 'string', required: true },
      input: { type: 'json' },
      locations: { type: 'json' },
      diffs: { type: 'json' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          status: { type: 'string', required: true },
          text: { type: 'string', required: true },
          diffs: { type: 'json' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text || `${value.title}: ${value.status}` }],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const live = host.runOf(exec.agent?.session?.id)
      const tool = live?.run.tools.get(args.id)
      if (!tool) return { title: args.title, kind: args.kind, status: 'failed', text: 'The agent is no longer running this call.' }
      for (;;) {
        if (exec.signal?.aborted) {
          tool.permission?.answer({ outcome: { outcome: 'cancelled' } })
          await live.run.cancel()
          break
        }
        const permission = tool.permission
        if (permission && !permission.asked) {
          permission.asked = true
          permission.answer(optionFor(await ask(host, live, tool, exec), permission.options))
          continue
        }
        if (isTerminal(tool) || !live.run.busy) break
        await changed(tool, exec.signal)
      }
      return resultOf(tool)
    },
    presentCall(args) {
      const title = typeof args?.title === 'string' ? args.title : 'Tool'
      if (Array.isArray(args?.diffs) && args.diffs.length > 0) return { card: 'diff', title, diffs: args.diffs, ...(args.locations ? { locations: args.locations } : {}) }
      const command = commandOf(args?.input)
      if (args?.kind === 'execute') return { card: 'terminal', title, ...(command ? { description: command } : {}) }
      return { card: 'generic', title, kind: kindOf(args?.kind), ...(args?.input == null ? {} : { rawInput: args.input }), ...(Array.isArray(args?.locations) ? { locations: args.locations } : {}) }
    },
    presentResult(args, result) {
      const meta = result?.meta && typeof result.meta === 'object' ? result.meta : undefined
      const title = meta?.title ?? args?.title
      if (Array.isArray(meta?.diffs) && meta.diffs.length > 0) return { card: 'diff', title, diffs: meta.diffs }
      if ((meta?.kind ?? args?.kind) === 'execute') return { card: 'terminal', title, output: meta?.text ?? contentText(result?.content) }
      return { card: 'generic', title, content: result?.content ?? [] }
    },
  })
}

// The sandbox mode the Session runs in: its last sandbox/mode row.
function sandboxOf(session) {
  const events = session?.snapshotEvents?.() ?? []
  for (let i = events.length - 1; i >= 0; i--) if (events[i]?.type === 'sandbox/mode') return events[i].data?.mode
  return undefined
}

/** The Session's level: its sandbox mode, its approval policy, and whether that is full access. */
export function levelOf(approval, session) {
  let policy
  let sandbox
  try {
    policy = approval?.effectivePolicy?.(session)
    sandbox = sandboxOf(session)
  } catch {}
  // DSH's presets: Full access is no prompts and no sandbox; Auto is no prompts in the workspace sandbox.
  return { sandbox, policy, full: policy === 'never' && sandbox === 'danger-full-access', auto: policy === 'never' && sandbox === 'workspace-write' }
}

// Full access (no approval prompts, no sandbox) lets the agent's calls through as it lets DSH's
// own: DSH's approval service would reject them unasked under its `never` policy.
export const fullAccess = (approval, session) => levelOf(approval, session).full

async function ask(host, live, tool, exec) {
  const approval = host.approval()
  if (!approval || !exec.agent) return 'unavailable'
  if (fullAccess(approval, exec.agent.session)) return 'allowed-once'
  const asking = tool.permission?.title
  const reason = `${live.name}: ${asking && asking !== tool.title ? `${asking.replace(/\?$/, '')}: ` : ''}${tool.title}`
  try {
    return await approval.request({ agent: exec.agent, toolName: TOOL_NAME, callId: exec.callId, reason, displayReason: { en: reason }, signal: exec.signal })
  } catch {
    return 'unavailable'
  }
}
