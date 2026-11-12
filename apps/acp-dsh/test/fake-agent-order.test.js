// The fake agent takes what it is sent in the order it was sent. The SDK walks its handlers
// once per message, each message by itself, so a handler registered late is reached late: a
// cancel written right before a prompt (what a new turn does when the last prompt is still
// ending, adapter.js `stopping`) must still be taken before that prompt, or the fake would
// cancel the new turn. Raw JSON-RPC over the fake's stdio: both messages go in one write.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk/unstable'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const line = message => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`

function rawAgent(t, env = {}) {
  const child = spawn(process.execPath, [FAKE], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
  t.after(() => child.kill('SIGKILL'))
  const waiting = new Map()
  let rest = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    rest += chunk
    for (;;) {
      const at = rest.indexOf('\n')
      if (at === -1) return
      const text = rest.slice(0, at)
      rest = rest.slice(at + 1)
      if (text.trim() === '') continue
      const message = JSON.parse(text)
      // The agent's own question: every tool call is allowed.
      if (message.method === 'session/request_permission') child.stdin.write(line({ id: message.id, result: { outcome: { outcome: 'selected', optionId: 'yes' } } }))
      else if (message.method === undefined && waiting.has(message.id)) waiting.get(message.id)(message)
    }
  })
  const answerTo = id => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to request ${id}`)), 20_000)
    waiting.set(id, (message) => { clearTimeout(timer); resolve(message) })
  })
  return {
    request(id, method, params) {
      const answer = answerTo(id)
      child.stdin.write(line({ id, method, params }))
      return answer
    },
    /** Several messages in one write, so the agent reads them together. */
    together(id, messages) {
      const answer = answerTo(id)
      child.stdin.write(messages.map(line).join(''))
      return answer
    },
  }
}

for (const sessionModels of [false, true]) {
  test(`a cancel sent right before a prompt does not cancel that prompt${sessionModels ? ' (a fake with its session\'s own model list)' : ''}`, async (t) => {
    const agent = rawAgent(t, sessionModels ? { FAKE_ACP_SESSION_MODELS: '1' } : {})
    await agent.request(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { result: session } = await agent.request(2, 'session/new', { cwd: import.meta.dirname, mcpServers: [] })
    for (let round = 0; round < 20; round += 1) {
      const id = 10 + round
      const answer = await agent.together(id, [
        { method: 'session/cancel', params: { sessionId: session.sessionId } },
        { id, method: 'session/prompt', params: { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hi' }] } },
      ])
      assert.deepEqual(answer.result, { stopReason: 'end_turn' }, `round ${round}: ${JSON.stringify(answer.error ?? answer.result)}`)
    }
  })
}
