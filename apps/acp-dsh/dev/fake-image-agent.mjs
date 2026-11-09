#!/usr/bin/env node
// A fake codex-acp for the image tests (image.js): it offers Codex's modes and answers a prompt
// the way codex-acp reports Codex's built-in image tool, an `other` call titled "Image
// generation" whose finished update carries the PNG as an ACP image block, its raw output and
// a saved path under a Codex home that must never be opened. No network, no real Codex.
//
// FAKE_IMAGE_MODE picks the answer:
//   ok (default)  the image in the call's content
//   raw           the image only in rawOutput.result
//   ask           a shell call asking permission first (must be cancelled), then the image call
//                 asking permission (must be allowed), then the image
//   limit         no image: a usage-limit notice, then the turn fails
//   auth          `session/new` refuses with ACP's auth_required
//   failed        the image call fails
//   hang          the image call starts and never ends (until cancelled)
//   peek          a read command that runs without asking (as Codex's read-only mode lets it),
//                 then the image call: the draw must refuse, and the image must not come back
//   nothing       the turn ends with no call
// `cli mcp list --json` (codex-acp's passthrough to Codex) prints FAKE_MCP_LIST (default `[]`)
// and exits; FAKE_MCP_LIST=fail exits 1 with nothing printed.
// FAKE_IMAGE_TRACE names a file the agent appends what it was asked to (cwd, servers, mode,
// CODEX_CONFIG, CODEX_HOME, permission answers, cancel, close) as JSON lines.
import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, PROTOCOL_VERSION, RequestError, ndJsonStream } from '@agentclientprotocol/sdk'

const MODE = process.env.FAKE_IMAGE_MODE ?? 'ok'
const TRACE = process.env.FAKE_IMAGE_TRACE
// A 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const trace = (entry) => {
  if (TRACE === undefined) return
  try { appendFileSync(TRACE, `${JSON.stringify(entry)}\n`) } catch {}
}
if (process.argv[2] === 'cli') {
  trace({ event: 'cli', args: process.argv.slice(3) })
  const listed = process.env.FAKE_MCP_LIST ?? '[]'
  if (listed === 'fail') process.exit(1)
  process.stdout.write(listed)
  process.exit(0)
}
trace({ event: 'start', codexConfig: process.env.CODEX_CONFIG ?? null, codexHome: process.env.CODEX_HOME ?? null, codexPath: process.env.CODEX_PATH ?? null })

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
const sessions = new Map()
let created = 0
const MODES = { currentModeId: 'workspace-write', availableModes: [{ id: 'read-only', name: 'Read-only' }, { id: 'workspace-write', name: 'Workspace access' }, { id: 'agent-full-access', name: 'Full access' }] }

const implementation = {
  async initialize() {
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [] }
  },
  async newSession(params) {
    if (MODE === 'auth') throw RequestError.authRequired(undefined, 'run codex login first')
    const sessionId = `img-${++created}`
    sessions.set(sessionId, { cancelled: false, wake: undefined })
    trace({ event: 'new-session', cwd: params.cwd, servers: (params.mcpServers ?? []).length })
    return { sessionId, modes: MODES }
  },
  async setSessionMode({ modeId }) {
    trace({ event: 'mode', modeId })
    return {}
  },
  async closeSession({ sessionId }) {
    trace({ event: 'close', sessionId })
    return {}
  },
  async cancel({ sessionId }) {
    trace({ event: 'cancel' })
    const session = sessions.get(sessionId)
    if (session) {
      session.cancelled = true
      session.wake?.()
    }
  },
  async prompt({ sessionId, prompt }) {
    const session = sessions.get(sessionId)
    const text = prompt.map(block => block.text ?? '').join('')
    trace({ event: 'prompt', mentionsTool: /image generation tool/i.test(text), text })
    const update = body => conn.sessionUpdate({ sessionId, update: body })
    if (MODE === 'nothing') {
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'I would rather not.' } })
      return { stopReason: 'end_turn' }
    }
    if (MODE === 'limit') {
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'You\'ve hit your usage limit. Try again later.' } })
      throw RequestError.internalError({ codexErrorInfo: 'usageLimitExceeded' })
    }
    if (MODE === 'ask') {
      const shell = await conn.requestPermission({
        sessionId,
        toolCall: { toolCallId: 'shell-1', title: 'Run ls ~', kind: 'execute' },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
      })
      trace({ event: 'answer', call: 'shell', outcome: shell.outcome })
    }
    if (MODE === 'peek') {
      await update({ sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'Read id_rsa', kind: 'read', status: 'in_progress', rawInput: { command: ['cat', '~/.ssh/id_rsa'] } })
      await update({ sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'completed' })
      trace({ event: 'peeked' })
      if (session.cancelled) return { stopReason: 'cancelled' }
    }
    const toolCallId = 'ig-1'
    await update({ sessionUpdate: 'tool_call', toolCallId, title: 'Image generation', kind: 'other', status: 'in_progress', rawInput: { id: toolCallId } })
    if (MODE === 'ask') {
      const image = await conn.requestPermission({
        sessionId,
        toolCall: { toolCallId, title: 'Allow image generation?', kind: 'other' },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
      })
      trace({ event: 'answer', call: 'image', outcome: image.outcome })
      if (image.outcome.outcome !== 'selected') return { stopReason: 'cancelled' }
    }
    if (MODE === 'hang') {
      await new Promise((resolve) => { session.wake = resolve })
      return { stopReason: 'cancelled' }
    }
    if (MODE === 'failed') {
      await update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed', rawOutput: { status: 'failed' } })
      return { stopReason: 'end_turn' }
    }
    const savedPath = '/fake-codex-home/generated_images/never-open-me.png'
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      content: MODE === 'raw' ? [] : [{ type: 'content', content: { type: 'text', text: 'Revised prompt: a fox' } }, { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png', uri: savedPath } }],
      rawOutput: { status: 'completed', revisedPrompt: 'a fox', result: PNG, savedPath },
    })
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } })
    return { stopReason: 'end_turn' }
  },
}

const conn = new AgentSideConnection(() => implementation, stream)
