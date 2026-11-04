// node --test chat/tail.test.mjs: following a transcript here (temp files) and on another
// machine (the fake hc). The poll path is what is tested; fs.watch only wakes it sooner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, renameSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTail, RemoteTail } from './tail.js'
import { createFakeHc } from './fake-hc.mjs'

const noTimers = { setTimeout: () => ({}), clearTimeout: () => {}, setInterval: () => ({}), clearInterval: () => {} }
const tmp = () => join(mkdtempSync(join(tmpdir(), 'chat-tail-')), 's.jsonl')

function localTail(path) {
  const got = []
  let resets = 0
  const tail = new LocalTail(path, { onLines: (l) => got.push(...l), onReset: () => { resets += 1 }, watch: null, timers: noTimers })
  return { tail, got, resets: () => resets }
}

test('local: complete lines with their numbers; a partial last line waits for its newline', async () => {
  const p = tmp()
  writeFileSync(p, 'one\ntwo\nthr')
  const { tail, got } = localTail(p)
  await tail.start()
  assert.deepEqual(got, [{ n: 1, text: 'one' }, { n: 2, text: 'two' }])
  appendFileSync(p, 'ee\r\nfour\n')
  await tail.tick()
  assert.deepEqual(got.slice(2), [{ n: 3, text: 'three' }, { n: 4, text: 'four' }])
  await tail.tick()
  assert.equal(got.length, 4, 'nothing new, nothing again')
  await tail.stop()
})

test('local: a UTF-8 character split across two writes arrives whole', async () => {
  const p = tmp()
  const bytes = Buffer.from('olá 👋\n', 'utf8')
  writeFileSync(p, bytes.subarray(0, 6))
  const { tail, got } = localTail(p)
  await tail.start()
  appendFileSync(p, bytes.subarray(6))
  await tail.tick()
  assert.deepEqual(got, [{ n: 1, text: 'olá 👋' }])
  await tail.stop()
})

test('local: a file that shrinks or is replaced starts again from line 1', async () => {
  const p = tmp()
  writeFileSync(p, 'a\nb\n')
  const { tail, got, resets } = localTail(p)
  await tail.start()
  truncateSync(p, 0)
  appendFileSync(p, 'c\n')
  await tail.tick()
  assert.equal(resets(), 1)
  assert.deepEqual(got.at(-1), { n: 1, text: 'c' })
  const other = `${p}.new`
  writeFileSync(other, 'x\ny\nz\n')
  renameSync(other, p)
  await tail.tick()
  assert.equal(resets(), 2)
  assert.deepEqual(got.slice(-3), [{ n: 1, text: 'x' }, { n: 2, text: 'y' }, { n: 3, text: 'z' }])
  await tail.stop()
})

test('local: a file that is not there yet is waited for', async () => {
  const p = tmp()
  const { tail, got } = localTail(p)
  await tail.start()
  assert.deepEqual(got, [])
  writeFileSync(p, 'late\n')
  await tail.tick()
  assert.deepEqual(got, [{ n: 1, text: 'late' }])
  await tail.stop()
})

test('local: concurrent ticks read once', async () => {
  const p = tmp()
  writeFileSync(p, 'a\n')
  const { tail, got } = localTail(p)
  await Promise.all([tail.start(), tail.tick(), tail.tick()])
  assert.deepEqual(got, [{ n: 1, text: 'a' }])
  await tail.stop()
})

function remoteTail(hc, extra = {}) {
  const got = []
  let resets = 0
  const delays = []
  const timers = { ...noTimers, setTimeout: (_, ms) => { delays.push(ms); return {} } }
  const tail = new RemoteTail({ hc, on: 'box', path: '.claude/projects/p/s.jsonl', onLines: (l) => got.push(...l), onReset: () => { resets += 1 }, timers, ...extra })
  return { tail, got, delays, resets: () => resets }
}

test('remote: reads by offset with on from the address and no cwd, paging by limit', async () => {
  const hc = createFakeHc({ files: { box: { '.claude/projects/p/s.jsonl': 'a\nb\nc\nd\ne\n' } } })
  const { tail, got } = remoteTail(hc, { page: 2 })
  await tail.start()
  assert.deepEqual(got.map((l) => l.text), ['a', 'b', 'c', 'd', 'e'])
  const reads = hc.calls.filter((c) => c.method === 'file.read').map((c) => c.params)
  assert.deepEqual(reads.map((p) => p.offset), [1, 3, 5])
  for (const p of reads) {
    assert.equal(p.on, 'box')
    assert.equal(p.path, '.claude/projects/p/s.jsonl')
    assert.equal(p.limit, 2)
    assert.ok(!('cwd' in p), 'no cwd: the base is that machine home')
  }
  hc.append('box', '.claude/projects/p/s.jsonl', 'f\n')
  await tail.tick()
  assert.equal(hc.calls.filter((c) => c.method === 'file.read').at(-1).params.offset, 6)
  assert.deepEqual(got.at(-1), { n: 6, text: 'f' })
  await tail.stop()
})

test('remote: a last line without its newline is read again next time', async () => {
  const hc = createFakeHc({ files: { box: { '.claude/projects/p/s.jsonl': 'a\npart' } } })
  const { tail, got } = remoteTail(hc)
  await tail.start()
  assert.deepEqual(got, [{ n: 1, text: 'a' }])
  hc.append('box', '.claude/projects/p/s.jsonl', 'ial\n')
  await tail.tick()
  assert.deepEqual(got, [{ n: 1, text: 'a' }, { n: 2, text: 'partial' }])
  await tail.stop()
})

test('remote: a file with fewer lines than read starts again', async () => {
  const hc = createFakeHc({ files: { box: { '.claude/projects/p/s.jsonl': 'a\nb\nc\n' } } })
  const { tail, got, resets } = remoteTail(hc)
  await tail.start()
  hc.files.box['.claude/projects/p/s.jsonl'] = 'new\n'
  await tail.tick()
  assert.equal(resets(), 1)
  assert.deepEqual(got.at(-1), { n: 1, text: 'new' })
  await tail.stop()
})

test('remote: polls every 2 s while working and 10 s when idle; a failed read is reported, not thrown', async () => {
  let working = true
  const hc = createFakeHc({ files: { box: { '.claude/projects/p/s.jsonl': 'a\n' } } })
  const errors = []
  const { tail, delays } = remoteTail(hc, { working: () => working, onError: (e) => errors.push(e.message) })
  await tail.start()
  working = false
  await tail.tick()
  delete hc.files.box['.claude/projects/p/s.jsonl']
  await tail.tick()
  assert.deepEqual(delays, [2000, 10_000, 10_000])
  assert.deepEqual(errors, ['not_found'])
  await tail.stop()
})
