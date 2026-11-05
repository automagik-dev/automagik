// The launcher's parts on their own: framing, the open policy, the handoff's shape, seeds.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FrameReader, MAX_CHUNK, MAX_FRAME, decode, encode } from '../lib/frame.mjs'
import { callbackPortOf, openBudget, openPolicy } from '../lib/open.mjs'
import { readHandoff } from '../lib/lane.mjs'
import { plantSeeds } from '../lib/seeds.mjs'

const read = (chunks) => {
  const frames = []
  const errors = []
  const reader = new FrameReader(frame => frames.push(frame), error => errors.push(error))
  for (const chunk of chunks) reader.push(chunk)
  return { frames, errors, reader }
}

test('a frame is one ASCII line with v and type', () => {
  const line = encode({ type: 'log', level: 'info', text: 'olá ✓ 🎉' })
  assert.match(line, /^[\x20-\x7e]*\n$/)
  assert.equal(line.split('\n').length, 2)
  assert.deepEqual(decode(line.trim()), { v: 1, type: 'log', level: 'info', text: 'olá ✓ 🎉' })
})

test('frames survive any split, CRLF and blank lines', () => {
  const text = `${encode({ type: 'ipc', message: { a: 'é' } })}\r\n${encode({ type: 'ready', url: 'x', port: 1 })}`
  const bytes = Buffer.from(text.replace('\n', '\r\n'))
  const chunks = [...bytes].map(byte => Buffer.from([byte]))
  const { frames, errors } = read(chunks)
  assert.deepEqual(errors, [])
  assert.deepEqual(frames.map(frame => frame.type), ['ipc', 'ready'])
  // Raw UTF-8 from a sender that does not escape still reads, even split inside a character.
  const raw = Buffer.from('{"v":1,"type":"log","text":"ação"}\n')
  const split = read([raw.subarray(0, 30), raw.subarray(30)])
  assert.equal(split.frames[0].text, 'ação')
})

test('a reader stops at the first line that is no frame', () => {
  for (const line of ['not json', '[]', '{"type":"x"}', '{"v":2,"type":"x"}', '{"v":1}', '{"v":"1","type":"x"}']) {
    const { frames, errors } = read([`${line}\n${encode({ type: 'log' })}`])
    assert.equal(errors.length, 1, line)
    assert.equal(errors[0].code, 'EFRAME')
    assert.deepEqual(frames, [], line)
  }
})

test('frames are bounded on both sides', () => {
  assert.throws(() => encode({ type: 'ipc', message: 'x'.repeat(MAX_FRAME) }), { code: 'EFRAME' })
  const { errors } = read([Buffer.alloc(MAX_FRAME + 10, 0x61)])
  assert.equal(errors.length, 1)
  const { reader, errors: ended } = read(['{"v":1,"type":"log"'])
  reader.end()
  assert.equal(ended.length, 1)
  // The largest tunnel chunk fits a frame with room to spare.
  assert.ok(encode({ type: 'tunnel', op: 'data', id: 1, data: Buffer.alloc(MAX_CHUNK).toString('base64') }).length < MAX_FRAME / 8)
})

test('only https: links with a host and no credentials open', () => {
  assert.deepEqual(openPolicy('https://claude.ai/oauth/authorize?x=1'), { ok: true, url: 'https://claude.ai/oauth/authorize?x=1' })
  for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x', '/tmp/a.html', 'https://user:pw@example.com',
    'https://bank.example@evil.example/', `https://example.com/${'a'.repeat(9000)}`, '', 42, null]) {
    assert.equal(openPolicy(url).ok, false, String(url).slice(0, 40))
  }
})

test('a sign-in redirect to the guest loopback names its port', () => {
  const url = 'https://auth.example/authorize?redirect_uri=' + encodeURIComponent('http://localhost:54545/callback') + '&state=s'
  assert.equal(callbackPortOf(url), 54545)
  assert.equal(callbackPortOf('https://auth.example/authorize?redirect_uri=' + encodeURIComponent('http://127.0.0.1:1455/cb')), 1455)
  assert.equal(callbackPortOf('https://auth.example/authorize?redirect_uri=' + encodeURIComponent('https://app.example/cb')), null)
  assert.equal(callbackPortOf('https://auth.example/'), null)
})

test('opens are capped per minute', () => {
  let now = 0
  const budget = openBudget(3, () => now)
  assert.deepEqual([budget.take(), budget.take(), budget.take(), budget.take()], [true, true, true, false])
  now = 60_000
  assert.equal(budget.take(), true)
})

const plugin = { publisher: 'automagik', name: '@automagik/welcome-dsh', version: '3.84.1', file: 'automagik-welcome-dsh-3.84.1.tgz', size: 10, sha256: 'a'.repeat(64), integrity: 'sha512-AAAA' }
const handoff = (change = {}, lanes = { automagik: { version: '3.84.1', sequence: 7 } }) => JSON.stringify({ v: 1, lanes, plugins: [{ ...plugin, ...change }] })

test('a handoff names known plugins of known lanes, by bare file names', () => {
  assert.deepEqual(readHandoff(handoff()), [{ publisher: 'automagik', version: '3.84.1', sequence: 7, plugins: [{ name: plugin.name, version: plugin.version, file: plugin.file, size: 10, sha256: plugin.sha256, integrity: plugin.integrity }] }])
  const bad = [
    'nope', JSON.stringify({ v: 2, lanes: {}, plugins: [plugin] }), JSON.stringify({ v: 1, lanes: {}, plugins: [] }),
    handoff({ publisher: 'someone' }), handoff({ name: '@automagik/genie-dsh' }), handoff({ name: 'left-pad' }),
    handoff({ file: '../../etc/x.tgz' }), handoff({ file: 'sub/x.tgz' }), handoff({ file: 'x.tar' }), handoff({ file: '.x.tgz' }),
    handoff({ size: 0 }), handoff({ size: 65 * 1024 * 1024 }), handoff({ sha256: 'xyz' }), handoff({ integrity: 'sha1-x' }),
    handoff({ version: 'latest' }), handoff({}, { automagik: { version: '3.84.1' } }), handoff({}, {}),
  ]
  for (const text of bad) assert.throws(() => readHandoff(text), { code: 'handoff' }, text.slice(0, 120))
})

test('seeds go in only where the home has nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wslc-seeds-'))
  try {
    const from = join(dir, 'seeds')
    const home = join(dir, 'home')
    mkdirSync(join(from, 'tree', '.local', 'share', 'tool'), { recursive: true })
    writeFileSync(join(from, 'tree', '.local', 'share', 'tool', 'v'), 'seed')
    mkdirSync(join(from, 'tree', 'kept'), { recursive: true })
    writeFileSync(join(from, 'tree', 'kept', 'v'), 'seed')
    mkdirSync(join(home, 'kept'), { recursive: true })
    writeFileSync(join(home, 'kept', 'v'), 'mine')
    writeFileSync(join(from, 'seeds.json'), JSON.stringify({ v: 1, seeds: [{ path: '.local/share/tool' }, { path: 'kept' }, { path: '../out' }, { path: '/abs' }] }))
    const logs = []
    assert.deepEqual(plantSeeds({ from, home, log: (level, text) => logs.push(text) }), ['.local/share/tool'])
    assert.equal(readFileSync(join(home, '.local', 'share', 'tool', 'v'), 'utf8'), 'seed')
    assert.equal(readFileSync(join(home, 'kept', 'v'), 'utf8'), 'mine')
    assert.equal(existsSync(join(dir, 'out')), false)
    assert.equal(logs.length, 2)
    // A second start plants nothing.
    assert.deepEqual(plantSeeds({ from, home }), [])
    // No list, no seeds.
    assert.deepEqual(plantSeeds({ from: join(dir, 'none'), home }), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
