// One image drawn by the Codex CLI, on the person's own Codex sign-in (owner decision D-g): a
// one-off codex-acp session that asks Codex's built-in image tool for one picture and ends.
//
// What the run never does:
// - write the person's Codex config, or set CODEX_HOME: the image feature is turned on for this
//   process only, through codex-acp's CODEX_CONFIG override;
// - give the agent a workspace, a server or a bridge: it starts in an empty scratch folder,
//   read-only, with no MCP servers, and every permission it asks for is cancelled except the
//   image call's own. ACP's server list is empty; the person's own servers are each turned off
//   by name (`mcp_servers.<name>.enabled = false`), the names read first through Codex's own
//   `codex mcp list --json` (names only: nothing else of that answer is kept or logged). An
//   empty `mcp_servers` table would not do it: Codex merges overrides into the config's tables,
//   so the person's entries would stay. A list that cannot be read stops the draw before Codex
//   starts;
// - run a command at all: Codex's shell and exec tools (and its other tool sources: the
//   JavaScript REPL, code mode, file patches, image viewing, sub-agents, apps, web search) are
//   turned off for this process, so a prompt cannot make it read a file. As a second line, the
//   first call that is not the image call (a command, a read, an MCP tool) ends the turn and
//   refuses the draw, and no image from that turn is returned;
// - open the file Codex saves under its home (`rawOutput.savedPath`): the PNG is taken from the
//   tool call's own content (an ACP image block) or its `rawOutput.result`;
// - log or keep the prompt or what the agent says.
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentRun } from './acp.js'
import { batchSafe } from './batch-spawn.js'
import { isAuthRequired } from './names.js'

// codex-acp's title for Codex's image tool (ImageGenerationReporter), of kind `other`.
export const IMAGE_TITLE = 'Image generation'
export const IMAGE_TIMEOUT_MS = 120_000
// Codex's features this run turns off: every way to run a command (the shell tool, unified exec,
// the JavaScript REPL, code mode), to write or read a file (patches, image viewing), and every
// other tool source (sub-agents, apps). Only the image tool is left. Codex warns on a feature it
// does not know and goes on, so a name a later Codex drops is harmless.
export const IMAGE_FEATURES_OFF = Object.freeze(['shell_tool', 'unified_exec', 'js_repl', 'code_mode', 'apply_patch_freeform', 'view_image', 'multi_agent', 'multi_agent_v2', 'apps'])
/**
 * The JSON codex-acp reads as config overrides for the Codex it starts (startAcpServer), for this
 * process only: the image feature on, every other tool source off, web search disabled, and each
 * of the person's own MCP servers (`names`) turned off.
 * @param {readonly string[]} [names]
 */
export function imageConfig(names = []) {
  return JSON.stringify({
    features: { image_generation: true, ...Object.fromEntries(IMAGE_FEATURES_OFF.map(feature => [feature, false])) },
    web_search: 'disabled',
    mcp_servers: Object.fromEntries(names.map(name => [name, { enabled: false }])),
  })
}
export const IMAGE_CONFIG = imageConfig()
export const MCP_LIST_TIMEOUT_MS = 15_000
const MCP_NAME = /^[A-Za-z0-9_.-]{1,128}$/
export const IMAGE_MODE = 'read-only'
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const SIZE_WORDS = {
  '1024x1024': 'square (1024x1024)',
  '1536x1024': 'landscape (1536x1024)',
  '1024x1536': 'portrait (1024x1536)',
}
const QUALITY_WORDS = { low: 'quick, low detail', medium: 'medium detail', high: 'high detail' }

/**
 * The names of the MCP servers the person's Codex config lists, through codex-acp's `cli`
 * passthrough (`codex mcp list --json`, the Codex the run will start). Names only: the rest of
 * the answer is dropped unread and never logged. Rejects when the list cannot be read.
 * @param {{ command: string, args?: string[], env?: Record<string, string> }} launch
 */
export function mcpServerNames(launch, { run = execFile, timeoutMs = MCP_LIST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const env = { ...process.env, ...launch.env, NO_COLOR: '1', DISABLE_UPDATES: '1' }
      run(...batchSafe(launch.command, [...(launch.args ?? []), 'cli', 'mcp', 'list', '--json'], { env, timeout: timeoutMs, maxBuffer: 1 << 20, windowsHide: true }), (error, stdout) => {
        if (error) return reject(new Error('the MCP server list could not be read'))
        let listed
        try {
          listed = JSON.parse(String(stdout ?? '').trim() || '[]')
        } catch {
          return reject(new Error('the MCP server list was not JSON'))
        }
        const rows = Array.isArray(listed) ? listed : Array.isArray(listed?.servers) ? listed.servers : Array.isArray(listed?.data) ? listed.data : undefined
        if (rows === undefined) return reject(new Error('the MCP server list was not a list'))
        const names = rows.map(row => row?.name)
        if (names.some(name => typeof name !== 'string' || !MCP_NAME.test(name))) return reject(new Error('the MCP server list named a server that cannot be turned off'))
        resolve([...new Set(names)])
      })
    } catch {
      reject(new Error('the MCP server list could not be read'))
    }
  })
}

/** A refusal the caller shows as it is: `code` says which. */
export const imageRefusal = (code, message) => Object.assign(new Error(message), { code })
export const SIGNED_OUT = 'acp/image-signed-out'
export const USAGE_LIMIT = 'acp/image-usage-limit'
export const TIMED_OUT = 'acp/image-timeout'
export const UNAVAILABLE = 'acp/image-unavailable'
export const FAILED = 'acp/image-failed'
export const STOPPED = 'acp/image-stopped'
export const REFUSED = 'acp/image-refused'

const signedOut = () => imageRefusal(SIGNED_OUT, 'Codex is not signed in. Sign in to Codex from a Bot\'s chat, or add an OpenAI key, then try again.')
const usageLimit = () => imageRefusal(USAGE_LIMIT, 'Codex has reached its usage limit on this ChatGPT plan. Try again when the limit resets, or add an OpenAI key.')
const USAGE_TEXT = /usage limit|usage_limit|quota/i

/** What the agent is asked: one call of its image tool, the size and background in words. */
export function imagePrompt({ prompt, size, quality, background } = {}) {
  const lines = [
    'Use your image generation tool exactly once to draw the image described below. Do not run commands, read or write files, or browse; do not ask questions; do not describe the image afterwards.',
  ]
  if (SIZE_WORDS[size]) lines.push(`Size: ${SIZE_WORDS[size]}.`)
  if (QUALITY_WORDS[quality]) lines.push(`Detail: ${QUALITY_WORDS[quality]}.`)
  if (background === 'transparent') lines.push('Background: transparent, a cut-out with no backdrop.')
  else if (background === 'opaque') lines.push('Background: opaque, filled to the edges.')
  lines.push('', 'The image:', String(prompt ?? ''))
  return lines.join('\n')
}

const isImageCall = tool => tool?.title === IMAGE_TITLE

/** The PNG of a finished image call, as base64, from its content or its raw output; never its saved file. */
export function imageOf(tool) {
  if (!isImageCall(tool)) return undefined
  for (const item of Array.isArray(tool.content) ? tool.content : []) {
    const block = item?.type === 'content' ? item.content : item
    if (block?.type === 'image' && typeof block.data === 'string' && block.data !== '') return block.data
  }
  const result = tool.rawOutput?.result
  return typeof result === 'string' && result !== '' ? result : undefined
}

/** Whether base64 holds a PNG. */
export const isPng = (base64) => {
  try {
    return Buffer.from(String(base64).slice(0, 16), 'base64').subarray(0, 4).equals(PNG_MAGIC)
  } catch {
    return false
  }
}

// The run, with its own answers to the agent: only the image call may go ahead.
class ImageRun extends AgentRun {
  onPermission(params) {
    const known = this.tools.get(params?.toolCall?.toolCallId)
    const image = isImageCall(known) || (known === undefined && params?.toolCall?.title === IMAGE_TITLE)
    const allow = image ? (params?.options ?? []).find(option => option.kind === 'allow_once') : undefined
    if (!image) this.refusedCalls = (this.refusedCalls ?? 0) + 1
    return Promise.resolve(allow === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: allow.optionId } })
  }

  // Every call the agent reports, new or changed, is seen: a call that never asked still shows.
  seeTool(update) {
    const fresh = !this.tools.has(update?.toolCallId)
    const tool = super.seeTool(update)
    if (fresh) this.spec.onTool?.(tool)
    return tool
  }

  changeTool(tool, update) {
    super.changeTool(tool, update)
    this.spec.onTool?.(tool)
  }
}

/**
 * Draws one image with Codex. `spawn()` is the acp-codex launch ({ command, args, env }), and
 * may throw when its connector is not installed yet. Resolves { base64, mimeType }; rejects with
 * an `imageRefusal` (signed out, usage limit, timeout, stopped, failed, refused).
 * @param {{ spawn: () => { command: string, args?: string[], env?: Record<string, string> }, prompt: string, size?: string, quality?: string, background?: string, signal?: AbortSignal, timeoutMs?: number, name?: string, scratch?: () => Promise<string>, Run?: typeof AgentRun }} request
 */
export async function drawImage({ spawn, prompt, size, quality, background, signal, timeoutMs = IMAGE_TIMEOUT_MS, name = 'Codex', scratch = () => mkdtemp(join(tmpdir(), 'automagik-image-')), Run = ImageRun, listServers = mcpServerNames }) {
  if (signal?.aborted) throw imageRefusal(STOPPED, 'The image was stopped before it was started.')
  // The draw holds the event loop from start to cleanup: the run lets go of it once a turn ends,
  // and its close and cancel guards must not be cut short by a process with nothing else alive.
  const keepAlive = setInterval(() => {}, 1 << 30)
  try {
    return await draw({ spawn, prompt, size, quality, background, signal, timeoutMs, name, scratch, Run, listServers })
  } finally {
    clearInterval(keepAlive)
  }
}

async function draw({ spawn, prompt, size, quality, background, signal, timeoutMs, name, scratch, Run, listServers }) {
  let launch
  try {
    launch = spawn()
  } catch (error) {
    throw imageRefusal(UNAVAILABLE, `Codex cannot draw yet: ${String(error?.message ?? error).slice(0, 200)}`)
  }
  // The person's own MCP servers, each turned off for this run; none is started when the list
  // cannot be read.
  let servers
  try {
    servers = await listServers(launch)
  } catch {
    throw imageRefusal(UNAVAILABLE, 'Codex\'s MCP servers could not be listed, so the image was not started (none of them may run while it draws). Try again.')
  }
  if (signal?.aborted) throw imageRefusal(STOPPED, 'The image was stopped before it was started.')
  const dir = await scratch()
  let found
  let foundError
  let wake
  const settled = new Promise((resolve) => { wake = resolve })
  const run = new Run({
    ...launch,
    env: { ...launch.env, CODEX_CONFIG: imageConfig(servers) },
    cwd: dir,
    name,
    mcpServers: [],
    onTool: (tool) => {
      if (found !== undefined || foundError !== undefined) return
      if (!isImageCall(tool)) {
        foundError = imageRefusal(REFUSED, 'Codex tried to do something other than draw (a command, a file or a tool), so the image was stopped. Try again, or describe it differently.')
        wake()
        return
      }
      const base64 = imageOf(tool)
      if (base64 !== undefined) {
        found = base64
        wake()
      } else if (tool.status === 'failed') {
        foundError = imageRefusal(FAILED, 'Codex could not draw this image. Try again, or describe it differently.')
        wake()
      }
    },
  })
  let timer
  const onAbort = () => wake()
  try {
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => wake(), timeoutMs)
    timer.unref?.()
    const started = run.start().then(() => run.setMode(IMAGE_MODE))
    started.catch(() => {})
    try {
      await Promise.race([started, settled.then(() => { throw undefined })])
    } catch (error) {
      if (signal?.aborted) throw imageRefusal(STOPPED, 'The image was stopped before it was finished.')
      if (error === undefined) throw imageRefusal(TIMED_OUT, 'Codex did not start in time. Try again.')
      if (isAuthRequired(error)) throw signedOut()
      throw imageRefusal(UNAVAILABLE, `Codex did not start: ${String(error?.message ?? error).slice(0, 200)}`)
    }
    let said = ''
    let ended
    const prompting = run.prompt([{ type: 'text', text: imagePrompt({ prompt, size, quality, background }) }])
    // The agent's words are read only for a usage-limit notice; they are kept nowhere.
    const reading = (async () => {
      for (;;) {
        const event = await run.next()
        if (event.type === 'text') said = (said + event.text).slice(-2000)
        if (event.type === 'end' || event.type === 'error' || event.type === 'aborted') {
          ended = event
          wake()
          return
        }
      }
    })()
    reading.catch(() => {})
    void prompting
    await settled
    if (foundError?.code === REFUSED) throw foundError
    if (found !== undefined) {
      if (!isPng(found)) throw imageRefusal(FAILED, 'Codex answered with something that is not a PNG image. Try again.')
      return { base64: found, mimeType: 'image/png' }
    }
    if (signal?.aborted) throw imageRefusal(STOPPED, 'The image was stopped before it was finished.')
    if (foundError !== undefined) throw foundError
    if (ended === undefined) throw imageRefusal(TIMED_OUT, `Codex did not finish the image within ${Math.round(timeoutMs / 1000)} seconds. Try again.`)
    if (ended.type === 'error' && isAuthRequired(ended)) throw signedOut()
    if (USAGE_TEXT.test(said) || (ended.type === 'error' && USAGE_TEXT.test(String(ended.message ?? '')))) throw usageLimit()
    throw imageRefusal(FAILED, 'Codex ended without drawing an image. Try again.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (run.busy) await Promise.race([run.cancel(), new Promise(resolve => setTimeout(resolve, 2000).unref?.())])
    if (run.sessionId !== undefined && typeof run.conn?.closeSession === 'function' && run.alive) {
      await Promise.race([run.conn.closeSession({ sessionId: run.sessionId }).catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000).unref?.())])
    }
    run.dispose()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
