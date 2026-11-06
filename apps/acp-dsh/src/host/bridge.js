#!/usr/bin/env node
// The per-session MCP bridge, named `dsh` (RFC 0003, amendment, "The bridge"). The ACP agent's
// adapter spawns this process itself and speaks MCP to it over stdio, so there is no listen
// socket on this leg: the only way in is the adapter's pipe. Its tools are DSH's, reached over
// the loopback back-channel to acp-dsh with the credential minted for this session; DSH executes
// them, asks its own approval, and writes the Session's tool rows.
//
// Plain Node and its builtins only: this file runs as the agent's child, outside a DSH profile,
// so it must not import the plugin's peers or the ACP SDK. It speaks newline-delimited JSON-RPC
// (MCP). `server/discover` is answered `-32601`, as the spike shows both adapters then fall back
// to the 2025-06-18/2025-11-25 handshake.
import { createInterface } from 'node:readline'

const CREDENTIAL = process.env.DSH_BRIDGE_CREDENTIAL
const URL = process.env.DSH_BRIDGE_URL
const WAIT_MS = 20_000

if (typeof CREDENTIAL !== 'string' || CREDENTIAL === '' || typeof URL !== 'string' || URL === '') {
  process.stderr.write('acp-dsh bridge: DSH_BRIDGE_CREDENTIAL and DSH_BRIDGE_URL are required\n')
  process.exit(2)
}

let generation = 0
let listed = false
let stopped = false

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
const reply = (id, result) => write({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })
const notify = (method, params) => write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })

class Fatal extends Error {}
class Refused extends Error {}

async function rpc(op, payload = {}) {
  let response
  try {
    response = await fetch(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op, ...payload }),
      signal: AbortSignal.timeout(op === 'wait' ? WAIT_MS + 10_000 : 60_000),
    })
  } catch (error) {
    throw new Refused(`back-channel unreachable: ${error?.message ?? error}`)
  }
  if (response.status === 401) throw new Fatal('the bridge credential is not valid for this Session')
  if (!response.ok) throw new Refused(`back-channel answered ${response.status}`)
  return response.json()
}

async function tools() {
  const answer = await rpc('list')
  if (typeof answer.generation === 'number') generation = answer.generation
  listed = true
  return Array.isArray(answer.tools) ? answer.tools : []
}

async function readList() {
  try {
    return await tools()
  } catch (error) {
    if (error instanceof Fatal) {
      process.stderr.write(`acp-dsh bridge: ${error.message}\n`)
      process.exit(1)
    }
    throw error
  }
}

async function call(params) {
  const name = typeof params?.name === 'string' ? params.name : ''
  if (name === '') return { content: [{ type: 'text', text: 'The bridge needs a tool name.' }], isError: true }
  const answer = await rpc('call', { name, arguments: params.arguments ?? {}, callId: typeof params._meta?.callId === 'string' ? params._meta.callId : undefined })
  const content = Array.isArray(answer.content) ? answer.content : []
  return { content: content.length > 0 ? content : [{ type: 'text', text: '' }], isError: answer.isError === true }
}

// Announce every new list the back-channel reports, but only after the first list was served:
// the spike's ordering rule (a `list_changed` before `session/new` answered produced no re-list;
// the plugin holds `announced` until then, so this loop simply never sees one early).
async function poll() {
  let last = generation
  while (!stopped) {
    let answer
    try {
      answer = await rpc('wait', { generation: last, timeoutMs: WAIT_MS })
    } catch (error) {
      if (error instanceof Fatal) return process.exit(1)
      await new Promise((resolve) => setTimeout(resolve, 1000).unref?.())
      continue
    }
    if (answer.closed === true) return stop()
    if (typeof answer.generation === 'number' && answer.generation > last) {
      last = answer.generation
      if (listed) notify('notifications/tools/list_changed')
    }
  }
}

function stop() {
  stopped = true
  try {
    process.stdin.pause()
  } catch {}
  // Let the last reply flush before leaving; `bye` is best effort.
  rpc('bye').catch(() => {}).finally(() => process.exit(0))
}

const handlers = {
  async initialize(params) {
    return {
      protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'dsh', version: '1' },
    }
  },
  async ping() {
    return {}
  },
  async 'tools/list'() {
    return { tools: await readList() }
  },
  async 'tools/call'(params) {
    return call(params)
  },
}

async function handle(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message === null || typeof message !== 'object' || typeof message.method !== 'string') return
  const id = message.id
  // Notifications (no id) are acknowledged by doing nothing; `notifications/cancelled` included.
  if (id === undefined) return
  if (message.method === 'shutdown') {
    reply(id, null)
    return stop()
  }
  const handler = handlers[message.method]
  if (handler === undefined) {
    // `server/discover` and every unadvertised method: method not found, the MCP fallback.
    return fail(id, -32601, `method not found: ${message.method}`)
  }
  try {
    const result = await handler(message.params)
    reply(id, result)
    if (message.method === 'tools/list' && !stopped) void poll()
  } catch (error) {
    if (error instanceof Fatal) {
      process.stderr.write(`acp-dsh bridge: ${error.message}\n`)
      process.exit(1)
    }
    fail(id, -32603, `bridge failed: ${error?.message ?? error}`)
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  if (line.trim() === '') return
  void handle(line)
})
lines.on('close', () => stop())
process.on('SIGTERM', () => stop())
process.on('SIGINT', () => stop())
