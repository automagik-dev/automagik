// The agent's own tool calls: an image an update carries (a screenshot tool, a read of a
// picture) survives the mirror call's result as DSH image content, stored as a durable
// attachment and never as inline base64. Text and resource content keeps the joined text it had.
// The image may arrive on the call's first sight or on a later tool_call_update.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentRun, contentImages, contentText } from '../src/host/acp.js'
import { callArguments, mirrorTool } from '../src/host/tool.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const REF = { attachmentId: `sha256:${'b'.repeat(64)}`, mediaType: 'image/png', bytes: 68, width: 1, height: 1 }
const EXEC = { callId: 'mirror-1', agent: { session: { id: 's1' } }, signal: new AbortController().signal }

function fakeRun(toolCallId, title = 'browser_screenshot') {
  const run = new AgentRun({ command: process.execPath, cwd: process.cwd(), name: 'Fake agent' })
  run.onUpdate({ sessionUpdate: 'tool_call', toolCallId, title, kind: 'other', status: 'pending', content: [] })
  return run
}

function mirror(run, attachments) {
  return mirrorTool({
    runOf: () => ({ run, name: 'Fake agent' }),
    approval: () => undefined,
    attachments: () => attachments,
  })
}

const saving = (saved) => ({
  saveImage: async (input) => {
    saved.push(input)
    return REF
  },
})

test('an image on a tool_call reaches the mirror result as a durable DSH image block', async () => {
  const run = fakeRun('shot-call')
  run.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'shot-call',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: 'Screenshot of https://example.com/.' } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const tool = run.tools.get('shot-call')
  assert.deepEqual(contentImages(tool.content), [{ type: 'image', data: PNG, mimeType: 'image/png' }])
  assert.equal(contentText(tool.content), 'Screenshot of https://example.com/.')
  const saved = []
  const definition = mirror(run, saving(saved))
  const args = callArguments(tool)
  const value = await definition.execute(args, EXEC)
  assert.equal(value.text, 'Screenshot of https://example.com/.')
  assert.deepEqual(value.images, [{ type: 'image', attachment: REF }])
  assert.doesNotMatch(JSON.stringify(value), new RegExp(PNG.slice(0, 24)), 'the image is an attachment, never inline base64')
  assert.deepEqual(definition.output.render(args, value), [
    { type: 'text', text: 'Screenshot of https://example.com/.' },
    { type: 'image', attachment: REF },
  ])
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.equal(saved[0].data.toString('base64'), PNG, 'the bytes are decoded exactly once')
})

test('an image that only arrives on a tool_call_update still reaches the mirror result', async () => {
  const run = fakeRun('shot-update')
  run.onUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'shot-update',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: 'Screenshot of https://example.com/.' } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const tool = run.tools.get('shot-update')
  assert.deepEqual(contentImages(tool.content), [{ type: 'image', data: PNG, mimeType: 'image/png' }])
  const saved = []
  const value = await mirror(run, saving(saved)).execute(callArguments(tool), EXEC)
  assert.equal(value.text, 'Screenshot of https://example.com/.')
  assert.deepEqual(value.images, [{ type: 'image', attachment: REF }])
  assert.equal(saved.length, 1)
})

test('text and resource content keep their joined text and gain no image', async () => {
  const run = fakeRun('read-1', 'Read notes.txt')
  run.onUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'read-1',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: 'first line' } },
      { type: 'content', content: { type: 'resource_link', uri: 'file:///notes.txt' } },
      { type: 'content', content: { type: 'resource', resource: { uri: 'file:///notes.txt', text: 'resource text' } } },
    ],
  })
  const tool = run.tools.get('read-1')
  const text = 'first line\nfile:///notes.txt\nresource text'
  assert.equal(contentText(tool.content), text)
  assert.deepEqual(contentImages(tool.content), [])
  const definition = mirror(run)
  const args = callArguments(tool)
  const value = await definition.execute(args, EXEC)
  assert.equal(value.text, text)
  assert.equal(value.images, undefined)
  assert.deepEqual(definition.output.render(args, value), [{ type: 'text', text }])
})

test('with no attachment store the image is not forced into the result as inline base64', async () => {
  const run = fakeRun('shot-nostore')
  run.onUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'shot-nostore',
    status: 'completed',
    content: [
      { type: 'content', content: { type: 'text', text: 'Screenshot of https://example.com/.' } },
      { type: 'content', content: { type: 'image', data: PNG, mimeType: 'image/png' } },
    ],
  })
  const tool = run.tools.get('shot-nostore')
  const value = await mirror(run).execute(callArguments(tool), EXEC)
  assert.equal(value.text, 'Screenshot of https://example.com/.')
  assert.equal(value.images, undefined)
  assert.doesNotMatch(JSON.stringify(value), new RegExp(PNG.slice(0, 24)))
  assert.deepEqual(run.tools.get('shot-nostore').content[1].content.data, PNG, 'the call still holds the image itself')
})
