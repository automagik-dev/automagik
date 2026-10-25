import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { watchBusy } from '../src/host/busy.js'
import { fakeContext } from './fake-ctx.js'

const read = file => JSON.parse(readFileSync(file, 'utf8'))

test('the busy file counts the agents at work, from the start', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'omni-ai-busy-')), 'busy.json')
  const { ctx } = fakeContext()
  let clock = 1
  watchBusy(ctx, { env: { AUTOMAGIK_BUSY_FILE: file }, now: () => clock })
  assert.deepEqual(read(file), { running: 0, at: 1 })
  clock = 2
  ctx.emit('agent/status', { agent: { id: 'a' }, status: 'running' })
  ctx.emit('agent/status', { agent: { id: 'b' }, status: 'running' })
  assert.deepEqual(read(file), { running: 2, at: 2 })
  clock = 3
  ctx.emit('agent/status', { agent: { id: 'a' }, status: 'idle' })
  assert.deepEqual(read(file), { running: 1, at: 3 })
  clock = 4
  ctx.emit('agent/disposed', { agent: { id: 'b' } })
  assert.deepEqual(read(file), { running: 0, at: 4 })
})

test('a status that changes nothing leaves the file as it was', () => {
  const writes = []
  const { ctx } = fakeContext()
  watchBusy(ctx, { env: { AUTOMAGIK_BUSY_FILE: '/busy.json' }, write: (_file, text) => writes.push(text), now: () => 0 })
  ctx.emit('agent/status', { agent: { id: 'a' }, status: 'idle' })
  ctx.emit('agent/disposed', { agent: { id: 'a' } })
  assert.equal(writes.length, 1)
})

test('without the desktop app naming a file, nothing is watched or written', () => {
  const writes = []
  const { ctx } = fakeContext()
  watchBusy(ctx, { env: {}, write: () => writes.push(1) })
  ctx.emit('agent/status', { agent: { id: 'a' }, status: 'running' })
  assert.equal(writes.length, 0)
})

test('a welcome that reloads while agents work counts them from the start', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'omni-ai-busy-')), 'busy.json')
  const agents = { list: () => [{ id: 'a', status: 'running' }, { id: 'b', status: 'idle' }] }
  const { ctx } = fakeContext({ services: { agents } })
  watchBusy(ctx, { env: { AUTOMAGIK_BUSY_FILE: file }, now: () => 7 })
  assert.deepEqual(read(file), { running: 1, at: 7 })
  ctx.emit('agent/status', { agent: { id: 'a' }, status: 'idle' })
  assert.equal(read(file).running, 0)
})
