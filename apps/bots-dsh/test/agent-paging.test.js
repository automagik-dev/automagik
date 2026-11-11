import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const message = seq => ({ seq, time: seq, type: 'user/message', data: {
  source: { kind: 'user' }, content: [{ type: 'text', text: `Message ${seq}` }],
} })
const range = (start, count) => Array.from({ length: count }, (_, i) => message(start + i))
const decode = cursor => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'agent-paging-'))
  await writeFile(join(home, 'state.json'), JSON.stringify({ version: 1, revision: 1,
    mainBotIds: ['a'], workspaceId: 'w', bots: {
      a: { id: 'a', name: 'Alpha', instructions: '', capabilities: [] },
    }, rooms: {}, agents: {}, exchanges: [] }))
  const ctx = fakeContext()
  const logs = new Map([['a', range(1, 500)]])
  ctx.llm = { listProviders: () => [], listModels: async () => [] }
  ctx.workspaceRegistry = { get: () => ({ id: 'w', path: home }) }
  ctx.sessionController = {
    resolveAgent: async id => ({ agent: { session: {
      id, seq: (logs.get(id)?.at(-1)?.seq ?? 0) + 1,
    } } }),
    page: async ({ address, beforeSeq = Infinity, throughSeq = Infinity, maxMessages }) => {
      const events = logs.get(address.sessionId).filter(event => event.seq < beforeSeq
        && event.seq <= throughSeq)
      return { records: events.slice(-maxMessages).map(event => ({ event })),
        hasMore: events.length > maxMessages }
    },
  }
  const rt = createRuntime(ctx, { home, memory: false, browser: false, updateCheck: false })
  await rt.load()
  const read = (id, cursor, limit = 1) => rt.spaceReads.read('space-messages', {
    id, ...(cursor ? { cursor } : {}), limit,
  }, async (_, body) => ({ ok: true, value: await rt.chatPage(body.botId, body.cursor) }))
  t.after(async () => { await ctx.dispose(); await rm(home, { recursive: true, force: true }) })
  return { rt, logs, read }
}

test('Bot subpages retain their sequence window when a new message arrives', async t => {
  const { logs, read } = await fixture(t)
  const first = await read('a')
  assert.equal(first.items[0].seq, 441)
  logs.get('a').push(message(501))
  const second = await read('a', first.nextCursor)
  assert.equal(second.items[0].seq, 442)
  const seen = [...first.items, ...second.items]
  let cursor = second.nextCursor
  while (cursor) {
    const page = await read('a', cursor, 17)
    seen.push(...page.items)
    cursor = page.nextCursor
  }
  assert.equal(seen.length, 500)
  assert.equal(new Set(seen.map(item => item.seq)).size, 500)
  assert.deepEqual([...seen.map(item => item.seq)].sort((a, b) => a - b),
    Array.from({ length: 500 }, (_, i) => i + 1))
  const fresh = await read('a', undefined, 100)
  assert.equal(fresh.items.some(item => item.seq === 501), true)
})

test('Bot subpages pin the part and hidden trailing event boundary', async t => {
  const { rt, logs, read } = await fixture(t)
  logs.get('a').push({ seq: 501, type: 'tool/result', data: {} })
  const first = await read('a')
  assert.equal(first.items[0].seq, 442)
  assert.equal(decode(first.nextCursor).beforeSeq, 502)
  rt.state.bots.a.segments = [{ sessionId: 'a' }]
  const priorChatOf = rt.chatOf
  rt.chatOf = id => id === 'a' ? 'new-part' : priorChatOf(id)
  logs.set('new-part', range(1, 70))
  const second = await read('a', first.nextCursor)
  assert.equal(second.items[0].seq, 443)
  assert.equal(decode(second.nextCursor).part, 0)
})

test('Bot subpages keep multiple text blocks sharing a sequence exactly once', async t => {
  const { logs, read } = await fixture(t)
  logs.set('a', [{ seq: 1, type: 'assistant/message', data: { message: { content: [
    { type: 'text', text: 'First block' }, { type: 'text', text: 'Second block' },
  ] } } }, message(2)])
  const first = await read('a')
  logs.get('a').push(message(3))
  const second = await read('a', first.nextCursor)
  const third = await read('a', second.nextCursor)
  assert.deepEqual([first, second, third].flatMap(page => page.items.map(item => item.text)),
    ['First block', 'Second block', 'Message 2'])
  assert.equal(third.nextCursor, null)
})

test('Bot sequence cursors cross backend pages and earlier parts without repeats', async t => {
  const { rt, logs, read } = await fixture(t)
  rt.state.bots.a.segments = [{ sessionId: 'earlier' }]
  logs.set('earlier', range(1, 3).map(event => ({ ...event, data: { ...event.data,
    content: [{ type: 'text', text: `Earlier ${event.seq}` }],
  } })))
  const seen = []
  let cursor
  do {
    const page = await read('a', cursor, 17)
    seen.push(...page.items.map(item => item.text))
    cursor = page.nextCursor
    if (seen.length === 17) logs.get('a').push(message(501))
  } while (cursor)
  assert.equal(seen.length, 503)
  assert.equal(new Set(seen).size, 503)
  assert.deepEqual(seen.slice(-3), ['Earlier 1', 'Earlier 2', 'Earlier 3'])
})

test('group subpages neither skip nor repeat messages when a new row arrives', async t => {
  const { rt, read } = await fixture(t)
  const room = { id: 'room', seq: 3, log: range(1, 3).map(event => ({
    seq: event.seq, text: `Group ${event.seq}`,
  })) }
  rt.state.rooms.room = room
  const first = await read('room')
  room.log.push({ seq: 4, text: 'New arrival' })
  const rest = await read('room', first.nextCursor, 100)
  assert.deepEqual([...first.items, ...rest.items].map(item => item.seq), [3, 2, 1])
  assert.equal(rest.nextCursor, null)
  assert.equal((await read('room')).items[0].seq, 4)
})

test('group subpages retain sequence boundaries across appends and log trimming', async t => {
  const { rt, read } = await fixture(t)
  const room = { id: 'room', seq: 60, log: range(1, 60).map(event => ({
    seq: event.seq, text: `Group ${event.seq}`,
  })) }
  rt.state.rooms.room = room
  const first = await read('room')
  assert.equal(first.items[0].seq, 60)
  room.log.push({ seq: 61, text: 'New arrival' })
  room.log.shift()
  const second = await read('room', first.nextCursor)
  assert.equal(second.items[0].seq, 59)
  const rest = await read('room', second.nextCursor, 100)
  const seen = [...first.items, ...second.items, ...rest.items].map(item => item.seq)
  assert.deepEqual(seen, Array.from({ length: 59 }, (_, i) => 60 - i))
  assert.equal(new Set(seen).size, seen.length)
  assert.equal(rest.nextCursor, null)
  assert.equal((await read('room')).items[0].seq, 61)
})
