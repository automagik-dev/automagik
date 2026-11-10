// Independent rows for issue #846: a browser_screenshot result is a text line plus an image, and
// the bridge must carry the image to the model instead of flattening it into text. The rows are
// this test's own: the real Backchannel, Session, AgentRun and mirror tool, with stubs for the
// DSH tools service and the attachment store. No real session, id or payload is read or copied.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Session } from '@deepseek-ai/dsh-session'
import * as acp from '../src/host/acp.js'
import { Backchannel } from '../src/host/backchannel.js'
import { callArguments, mirrorTool } from '../src/host/tool.js'

// A 1x1 PNG, small enough to compare as a string, shaped like the bytes a screenshot carries.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
// A 1x1 JPEG (ffmpeg), real image bytes so the guard's pass-through row is not a media-type guess.
const JPEG = [
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgEBAQEBAUFBQUFBQ',
  'YGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABL',
  'AAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAB',
  'EBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAEAAQMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z',
].join('')
const SHOT_TEXT = 'Screenshot of https://example.com/.'
const SHOT_REF = { attachmentId: `sha256:${'c'.repeat(64)}`, mediaType: 'image/png', bytes: 68, width: 1, height: 1 }
const SHOT_TOOL = { name: 'browser_screenshot', description: 'Take a screenshot of the current page.', parameters: { type: 'object', properties: {} } }
const TOOLS = [
  { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
  SHOT_TOOL,
]
// The one block shape the model side accepts for a picture, as ACP defines it.
const ACP_IMAGE = { type: 'image', data: PNG, mimeType: 'image/png' }

// One synthetic Session with an open step, plus the services the bridge reads. The tools
// service answers with the content this row gives it, so a row is one stub result end to end.
function bridge({ content = [], attachments, sessionId }) {
  const session = Session.create(sessionId)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'acp-image-probe', model: 'probe' }, tools: TOOLS },
    reason: 'initial',
  })
  const agent = { session }
  const executed = []
  const ctx = {
    agents: { turnBoundaryOf: () => ({ lastTurn: 1 }) },
    get: (name) => {
      if (name === 'tools') {
        return {
          definitions: () => TOOLS,
          executable: toolName => TOOLS.find(tool => tool.name === toolName),
          execute: async ({ calls }) => {
            executed.push({ name: calls[0].name, arguments: calls[0].arguments })
            return { results: [{ callId: calls[0].id, result: { content, isError: false } }] }
          },
        }
      }
      if (name === 'approval') return { effectivePolicy: () => 'ask', request: async () => 'allowed-once' }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      if (name === 'agentPresets') return { presetForSession: () => 'standard' }
      if (name === 'attachments') return attachments
      return undefined
    },
  }
  return { session, agent, ctx, executed, backchannel: new Backchannel({ ctx }) }
}

async function serve(host) {
  await host.backchannel.listen()
  host.record = host.backchannel.mint({ sessionId: host.session.id, agent: host.agent, name: 'Probe agent' })
  host.backchannel.announce(host.record)
  return host
}

async function callBridge(host, { callId, name = 'browser_screenshot', args = {} }) {
  const response = await fetch(host.backchannel.urlFor(host.record), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${host.record.credential}` },
    body: JSON.stringify({ op: 'call', name, arguments: args, callId }),
  })
  return { status: response.status, body: await response.json() }
}

// A store that reads one attachment and records every read; it must never be asked to store
// anything on this path.
function readStore(data = Buffer.from(PNG, 'base64')) {
  const reads = []
  return {
    reads,
    saveImage: async () => { throw new Error('the back-channel must not store an image') },
    readImage: async (attachment) => {
      reads.push(attachment)
      return { ref: attachment, data }
    },
  }
}

const countOf = (haystack, needle) => haystack.split(needle).length - 1

// A fake agent run holding one of its own tool calls, without ever spawning a process.
function agentRun(toolCallId, title = 'browser_screenshot') {
  const run = new acp.AgentRun({ command: process.execPath, cwd: process.cwd(), name: 'Probe agent' })
  run.onUpdate({ sessionUpdate: 'tool_call', toolCallId, title, kind: 'other', status: 'pending', content: [] })
  return run
}

function mirror(run, attachments) {
  return mirrorTool({
    runOf: () => ({ run, name: 'Probe agent' }),
    approval: () => undefined,
    attachments: () => attachments,
  })
}

const EXEC = { callId: 'mirror-shot', agent: { session: { id: 'image-mirror' } }, signal: new AbortController().signal }

test('a stored screenshot attachment reaches the MCP call as one ACP image beside its text', async () => {
  const store = readStore()
  const host = bridge({
    sessionId: 'image-store',
    attachments: store,
    content: [
      { type: 'text', text: SHOT_TEXT },
      { type: 'image', attachment: SHOT_REF },
    ],
  })
  try {
    await serve(host)
    const { status, body } = await callBridge(host, { callId: 'shot-store' })
    assert.equal(status, 200)
    assert.equal(body.isError, false)
    // The agent's MCP result is ACP image content beside the text line, never an empty block.
    assert.deepEqual(body.content, [{ type: 'text', text: SHOT_TEXT }, ACP_IMAGE])
    // Read exactly once: nothing lost, nothing duplicated.
    assert.deepEqual(store.reads, [SHOT_REF])
    assert.equal(countOf(JSON.stringify(body), PNG), 1, 'the bytes are encoded once')
    // DSH's own row keeps the durable reference, not a second copy of the bytes.
    const [row] = host.session.snapshotEvents().filter(event => event.type === 'tool/result')
    assert.deepEqual(row.data.message.content, [
      { type: 'text', text: SHOT_TEXT },
      { type: 'image', attachment: SHOT_REF },
    ])
    assert.equal(countOf(JSON.stringify(row.data), PNG), 0, 'the log keeps the attachment, never base64')
  } finally {
    host.backchannel.dispose()
  }
})

test('an inline image passes through as the same base64 exactly once, never re-encoded', async () => {
  const store = {
    readImage: async () => { throw new Error('an inline image must not be read from a store') },
  }
  const host = bridge({
    sessionId: 'image-inline',
    attachments: store,
    content: [{ type: 'text', text: SHOT_TEXT }, { type: 'image', data: PNG, mimeType: 'image/png' }],
  })
  try {
    await serve(host)
    const { body } = await callBridge(host, { callId: 'shot-inline' })
    assert.deepEqual(body.content, [{ type: 'text', text: SHOT_TEXT }, ACP_IMAGE])
    // The exact base64 the agent sent, once: a re-encode would change data or add a copy.
    assert.equal(body.content[1].data, PNG)
    assert.equal(countOf(JSON.stringify(body), PNG), 1)
  } finally {
    host.backchannel.dispose()
  }
})

test('an unreadable attachment becomes a text placeholder, never an empty result', async () => {
  const reads = []
  const host = bridge({
    sessionId: 'image-unreadable',
    attachments: {
      readImage: async (attachment) => {
        reads.push(attachment)
        throw new Error('the attachment is gone')
      },
    },
    content: [{ type: 'text', text: SHOT_TEXT }, { type: 'image', attachment: SHOT_REF }],
  })
  try {
    await serve(host)
    const { body } = await callBridge(host, { callId: 'shot-unreadable' })
    assert.equal(body.isError, false)
    assert.equal(body.content.length, 2)
    assert.deepEqual(body.content[0], { type: 'text', text: SHOT_TEXT })
    assert.equal(body.content[1].type, 'text')
    // The placeholder is the guarantee; it does not name the ref's media type when the read fails.
    assert.match(body.content[1].text, /^\[image unavailable: .+; the attachment could not be read\]$/)
    assert.ok(body.content.every(block => typeof block.text === 'string' && block.text !== ''), 'no block is empty')
    assert.deepEqual(reads, [SHOT_REF], 'the unreadable attachment was tried exactly once')
  } finally {
    host.backchannel.dispose()
  }
})

test('contentImages takes the image from a tool_call and from a tool_call_update', () => {
  const atCall = agentRun('shot-call')
  atCall.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'shot-call',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: SHOT_TEXT } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const onCall = atCall.tools.get('shot-call')
  assert.deepEqual(acp.contentImages(onCall.content), [ACP_IMAGE])
  assert.equal(acp.contentText(onCall.content), SHOT_TEXT)

  const atUpdate = agentRun('shot-update')
  atUpdate.onUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'shot-update',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: SHOT_TEXT } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const onUpdate = atUpdate.tools.get('shot-update')
  assert.deepEqual(acp.contentImages(onUpdate.content), [ACP_IMAGE])
  assert.equal(acp.contentText(onUpdate.content), SHOT_TEXT)
})

test('the mirror DSH result stores the image once and carries an attachment block', async () => {
  const run = agentRun('shot-mirror')
  run.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'shot-mirror',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: SHOT_TEXT } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const tool = run.tools.get('shot-mirror')
  const saved = []
  const definition = mirror(run, {
    saveImage: async (input) => {
      saved.push(input)
      return SHOT_REF
    },
  })
  const args = callArguments(tool)
  const value = await definition.execute(args, EXEC)
  assert.equal(value.text, SHOT_TEXT)
  assert.deepEqual(value.images, [{ type: 'image', attachment: SHOT_REF }])
  assert.equal(countOf(JSON.stringify(value), PNG), 0, 'the result names the attachment, never the bytes')
  assert.deepEqual(definition.output.render(args, value), [
    { type: 'text', text: SHOT_TEXT },
    { type: 'image', attachment: SHOT_REF },
  ])
  // Stored exactly once, decoded exactly once on the way in.
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.equal(Buffer.isBuffer(saved[0].data), true)
  assert.equal(saved[0].data.toString('base64'), PNG)
})

test('with no attachment store mounted the mirror result keeps its text as before', async () => {
  const run = agentRun('shot-nostore')
  run.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'shot-nostore',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: SHOT_TEXT } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const tool = run.tools.get('shot-nostore')
  const definition = mirror(run)
  const args = callArguments(tool)
  const value = await definition.execute(args, EXEC)
  assert.equal(value.text, SHOT_TEXT)
  assert.equal(value.images, undefined)
  assert.equal(countOf(JSON.stringify(value), PNG), 0, 'an image is never forced into the result inline')
  assert.deepEqual(definition.output.render(args, value), [{ type: 'text', text: SHOT_TEXT }])
  assert.equal(tool.content[1].content.data, PNG, 'the call itself still holds the image')
})

test('text-only and resource content keep their single joined text block on both paths', async () => {
  const blocks = [
    { type: 'text', text: 'first line' },
    { type: 'resource_link', uri: 'file:///notes.txt' },
    { type: 'resource', resource: { uri: 'file:///notes.txt', text: 'resource text' } },
  ]
  // The back-channel's textOf has always joined text and resource text only: the link itself
  // was never part of its text, and this change does not add it.
  const backchannelText = 'first line\nresource text'
  const host = bridge({ sessionId: 'image-text', content: blocks })
  try {
    await serve(host)
    const { body } = await callBridge(host, { callId: 'text-only', name: 'bash', args: { command: 'probe' } })
    assert.deepEqual(body.content, [{ type: 'text', text: backchannelText }])
  } finally {
    host.backchannel.dispose()
  }
  // The mirror's contentText keeps the link's uri, as it did before, in one joined block.
  const run = agentRun('read-text', 'Read notes.txt')
  run.onUpdate({ sessionUpdate: 'tool_call', toolCallId: 'read-text', status: 'completed', content: blocks })
  const tool = run.tools.get('read-text')
  const definition = mirror(run)
  const args = callArguments(tool)
  const value = await definition.execute(args, EXEC)
  assert.equal(value.text, 'first line\nfile:///notes.txt\nresource text')
  assert.equal(value.images, undefined)
  assert.deepEqual(definition.output.render(args, value), [{ type: 'text', text: value.text }])
})

test('a stub browser_screenshot tool result keeps its image in the model-facing content', async () => {
  // The browser tool's own model-facing shape: a line of text and the picture itself.
  const host = bridge({
    sessionId: 'image-stub',
    content: [{ type: 'text', text: SHOT_TEXT }, { type: 'image', data: PNG, mimeType: 'image/png' }],
  })
  try {
    await serve(host)
    const { status, body } = await callBridge(host, { callId: 'shot-stub' })
    assert.equal(status, 200)
    const images = body.content.filter(block => block.type === 'image')
    assert.equal(images.length, 1, 'the model-facing content carries the one image')
    assert.equal(images[0].data, PNG)
    assert.equal(images[0].mimeType, 'image/png')
    // The base64 decodes to PNG bytes, so the model receives the picture, not its text form.
    const bytes = Buffer.from(images[0].data, 'base64')
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert.deepEqual(body.content[0], { type: 'text', text: SHOT_TEXT })
    assert.equal(body.content.length, 2)
    assert.equal(host.executed.length, 1)
    assert.equal(host.executed[0].name, 'browser_screenshot')
  } finally {
    host.backchannel.dispose()
  }
})

// M1 rows for the repair at 2ab5339c: an inline image reaches the model only when its type is one
// the agent decodes and its decoded bytes fit the cap; anything else is the reasoned placeholder.

test('M1: an inline image decoded over 5 MiB becomes the reasoned placeholder, never image content', async () => {
  // One byte over the cap. The bridge sizes base64 from its length, so it never decodes this.
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')
  const host = bridge({
    sessionId: 'm1-oversized-inline',
    content: [{ type: 'text', text: SHOT_TEXT }, { type: 'image', data: oversized, mimeType: 'image/png' }],
  })
  try {
    await serve(host)
    const { status, body } = await callBridge(host, { callId: 'm1-oversized' })
    assert.equal(status, 200)
    assert.equal(body.isError, false)
    // Checked first so a pre-repair failure names the block type, not the 7 MB payload.
    assert.equal(body.content.filter(block => block.type === 'image').length, 0, 'no image reaches the model')
    assert.equal(body.content.length, 2)
    assert.deepEqual(body.content, [
      { type: 'text', text: SHOT_TEXT },
      { type: 'text', text: '[image unavailable: image/png; larger than 5 MiB]' },
    ])
    // The placeholder is the whole answer: the oversized base64 never travels back.
    const reply = JSON.stringify(body)
    assert.ok(reply.length < 1024, 'the response carries no unbounded payload')
    assert.equal(reply.includes(oversized.slice(0, 64)), false)
  } finally {
    host.backchannel.dispose()
  }
})

test('M1: a non-image inline block becomes the same reasoned placeholder, never image content', async () => {
  const payload = Buffer.from('not an image, only bytes').toString('base64')
  const host = bridge({
    sessionId: 'm1-non-image-inline',
    content: [
      { type: 'text', text: SHOT_TEXT },
      { type: 'image', data: payload, mimeType: 'text/plain' },
      { type: 'image', data: payload, mimeType: 'application/pdf' },
    ],
  })
  try {
    await serve(host)
    const { body } = await callBridge(host, { callId: 'm1-non-image' })
    // Checked first so a pre-repair failure names the block type, not the payload.
    assert.equal(body.content.filter(block => block.type === 'image').length, 0, 'a non-image stays text')
    assert.deepEqual(body.content, [
      { type: 'text', text: SHOT_TEXT },
      { type: 'text', text: '[image unavailable: text/plain; not a supported image type]' },
      { type: 'text', text: '[image unavailable: application/pdf; not a supported image type]' },
    ])
    assert.equal(countOf(JSON.stringify(body), payload), 0, 'the payload never travels as image data')
  } finally {
    host.backchannel.dispose()
  }
})

test('M1: a small png and a small jpeg still pass as ACP image content exactly once', async () => {
  // The guard must not over-block: both are real images under the cap and pass byte for byte.
  // One block names mimeType, the other mediaType; both are the block's media type.
  for (const [data, mimeType, field] of [[PNG, 'image/png', 'mimeType'], [JPEG, 'image/jpeg', 'mediaType']]) {
    const kind = mimeType.split('/')[1]
    const host = bridge({
      sessionId: `m1-small-${kind}`,
      content: [{ type: 'text', text: SHOT_TEXT }, { type: 'image', data, [field]: mimeType }],
    })
    try {
      await serve(host)
      const { body } = await callBridge(host, { callId: `m1-small-${kind}` })
      assert.deepEqual(body.content, [
        { type: 'text', text: SHOT_TEXT },
        { type: 'image', data, mimeType },
      ])
      assert.equal(countOf(JSON.stringify(body), data), 1, 'the base64 passes exactly once')
      // The bytes are a real image container, so the pass-through is of a picture, not a label.
      const bytes = Buffer.from(data, 'base64')
      if (mimeType === 'image/png') {
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      } else {
        assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'jpeg starts with SOI')
        assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xd9], 'jpeg ends with EOI')
      }
    } finally {
      host.backchannel.dispose()
    }
  }
})
