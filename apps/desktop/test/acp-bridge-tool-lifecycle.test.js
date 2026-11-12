// The v4 loader's recovery contract for a bridged tool call (issue #842), tested against the
// real pinned package bytes rather than stand-ins: fixtures/acp-bridge-tool-lifecycle/
// format-v3-to-v4.js is the unmodified lib/index.js of @deepseek-ai/dsh-session-format-v3-to-v4
// 0.2.2-rc.1, and worker.cjs is the unmodified lib/worker.cjs of
// @deepseek-ai/dsh-session-persistence-jsonl 0.2.2-rc.1 (MIT; LICENSE beside them). Their
// sha256 must be the `before` hashes in runtime/patches/patches.json, so these tests apply the
// carried patch to the bytes npm actually installs, import the patched loader, and run the
// patched migration verifier on a synthetic session log. The broken shape is the one a bridge
// tool call wrote before the bridge always advertised it: a tool/call row with no assistant
// message carrying the tool-call block, which the loader refused with
// `SessionFormatError: tool/call <id> has no advertised tool lifecycle`.
//
// What this does NOT cover: prepare-runtime's install (npm ci, the profile, pruning), the
// desktop build and the server image build, and a real desktop session. The loader's own two
// imports are load-time stand-ins; the code under test is Relationships.tool in the patched
// bytes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const PATCHES = join(APP, 'runtime', 'patches')
const FIXTURE = join(HERE, 'fixtures', 'acp-bridge-tool-lifecycle')
const FORMAT_FIXTURE = join(FIXTURE, 'format-v3-to-v4.js')
const WORKER_FIXTURE = join(FIXTURE, 'worker.cjs')
const LICENSE = join(FIXTURE, 'LICENSE')
const DSH = '0.2.2-rc.1'
const VERSION = '0.2.2-rc.1'
const PATCH = 'acp-bridge-tool-lifecycle.patch'
const FORMAT = '@deepseek-ai/dsh-session-format-v3-to-v4'
const PERSIST = '@deepseek-ai/dsh-session-persistence-jsonl'
const FORMAT_FILE = 'lib/index.js'
const WORKER_FILE = 'lib/worker.cjs'
const ERROR = 'tool/call bridge_synthetic has no advertised tool lifecycle'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = text => createHash('sha256').update(text).digest('hex')

// The patched loader's two imports. They only have to load and construct the module: the v4
// relationships use the error class, the JSON guard, and the count/safe-integer validator.
const STUBS = {
  '@deepseek-ai/dsh-session-format': [
    "export class SessionFormatError extends Error { name = 'SessionFormatError' }",
    "export class SessionFormatUnsupportedMigrationError extends SessionFormatError { name = 'SessionFormatUnsupportedMigrationError' }",
    'export const defineSessionFormatMigration = value => value',
    'export const isSessionFormatJsonObject = value => typeof value === \'object\' && value !== null && !Array.isArray(value)',
    'export const sessionFormatCount = value => value',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-session-format-v2-to-v3': [
    'export const assertReleasedV3Header = () => {}',
    'export const releasedV2SessionFormatCodec = {}',
    'export const releasedV3SessionFormatCodec = {}',
    '',
  ].join('\n'),
}

function writeStub(root, name, source) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0-test', type: 'module', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), source)
}

function writePackage(dir, name, fields = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: VERSION, type: 'module', ...fields }))
}

// One event log in the broken shape, made here and never copied from a real session: turn 1
// makes a model request and carries its header, turn 2 has a bridged tool call and its result
// but no request/header and no assistant advertisement before the call.
const EVENTS = [
  { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
  { type: 'request/header', seq: 2, time: 0, data: { header: { config: { provider: 'acp-fake', model: 'fake' } }, reason: 'initial' } },
  { type: 'step/end', seq: 3, time: 0, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 4, time: 0, data: { turn: 1, reason: 'stop' } },
  { type: 'turn/start', seq: 5, time: 0, data: { turn: 2 } },
  { type: 'step/start', seq: 6, time: 0, data: { turn: 2, step: 1 } },
  { type: 'tool/call', seq: 7, time: 0, data: { turn: 2, step: 1, callId: 'bridge_synthetic', name: 'bash', arguments: '{}' } },
  {
    type: 'tool/result',
    seq: 8,
    time: 0,
    data: {
      turn: 2,
      step: 1,
      message: {
        id: 'result-synthetic',
        role: 'tool',
        toolCallId: 'bridge_synthetic',
        source: { kind: 'tool', callId: 'bridge_synthetic' },
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    },
    surfaceOp: 'append',
    sourceEventSeqs: [7],
  },
  { type: 'step/end', seq: 9, time: 0, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 10, time: 0, data: { turn: 2, reason: 'stop' } },
]
const HEADER = { version: 4, id: 'synthetic-842', createdAt: 0, isSeeded: false, delegationDepth: 0 }
const KNOWN = new Set(EVENTS.map(event => event.type))
const artifactOf = (events = EVENTS) => ({ header: HEADER, events: structuredClone(events), inheritedEventCount: 0 })

// Turn 1 and the start of turn 2 as in EVENTS, then the given rows: ['call', id] is an
// unadvertised bridged tool/call, ['result', id] its tool/result citing that id's latest call.
function turnTwo(rows) {
  const events = structuredClone(EVENTS.slice(0, 7))
  const calls = new Map()
  for (const [kind, id] of rows) {
    const seq = events.length
    if (kind === 'call') {
      events.push({ type: 'tool/call', seq, time: 0, data: { turn: 2, step: 1, callId: id, name: 'bash', arguments: '{}' } })
      calls.set(id, seq)
      continue
    }
    const result = structuredClone(EVENTS[8])
    result.seq = seq
    result.data.message = { ...result.data.message, id: `result-${seq}`, toolCallId: id, source: { kind: 'tool', callId: id } }
    result.sourceEventSeqs = calls.has(id) ? [calls.get(id)] : []
    events.push(result)
  }
  events.push({ ...structuredClone(EVENTS[9]), seq: events.length })
  events.push({ ...structuredClone(EVENTS[10]), seq: events.length })
  return events
}
const REPEATED = turnTwo([['call', 'bridge_synthetic'], ['result', 'bridge_synthetic'], ['call', 'bridge_synthetic'], ['result', 'bridge_synthetic']])
const DISTINCT = turnTwo([['call', 'bridge_synthetic'], ['result', 'bridge_synthetic'], ['call', 'bridge_other'], ['result', 'bridge_other']])
const ORPHAN = turnTwo([['result', 'bridge_synthetic']])
const ORPHAN_ERROR = 'tool/result bridge_synthetic has no advertised tool lifecycle'
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The unmodified worker needs its package's manifest one directory up; the fixtures keep only
// the file the patch names, so the test runtime supplies the same package around it.
function makeRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-bridge-lifecycle-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')
  writePackage(join(modules, '@deepseek-ai', 'dsh'), '@deepseek-ai/dsh', { version: DSH })

  const format = join(modules, FORMAT)
  writePackage(format, FORMAT)
  mkdirSync(join(format, 'lib'), { recursive: true })
  cpSync(FORMAT_FIXTURE, join(format, FORMAT_FILE))

  const persist = join(modules, PERSIST)
  writePackage(persist, PERSIST)
  mkdirSync(join(persist, 'lib'), { recursive: true })
  cpSync(WORKER_FIXTURE, join(persist, WORKER_FILE))

  for (const [name, source] of Object.entries(STUBS)) writeStub(root, name, source)

  const patches = join(root, 'patches')
  mkdirSync(patches)
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === PATCH)
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify(entries, null, 2)}\n`)
  for (const item of entries) cpSync(join(PATCHES, item.patch), join(patches, item.patch))
  return { root, modules, patches, format: join(format, FORMAT_FILE), worker: join(persist, WORKER_FILE) }
}

function entryOf(name) {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === name)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${name}`)
  return entries[0]
}

function loadWarnings(module, artifact) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    return { warnings, result: module.restoreReleasedV4Artifact(artifact, KNOWN) }
  } finally {
    console.warn = original
  }
}

// A synthetic current-generation log, plaintext so no Zstandard codec is needed: one header
// line, then one event per line.
function writeSyntheticLog(file, events = EVENTS) {
  const header = { type: 'session', ...HEADER }
  writeFileSync(file, [JSON.stringify(header), ...events.map(event => JSON.stringify(event))].join('\n') + '\n')
}

function verifyWithWorker(workerPath, logPath, eventCount = EVENTS.length) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(pathToFileURL(workerPath), {
      workerData: { path: logPath, compression: 'none', expectedId: HEADER.id, expectedEventCount: eventCount },
      stderr: true,
    })
    let stderr = ''
    worker.stderr.on('data', chunk => { stderr += chunk })
    worker.once('message', message => resolve({ message, stderr }))
    worker.once('error', reject)
  })
}

test('patches.json pins the real 0.2.2-rc.1 loader and verifier to the desktop runtime', () => {
  const patch = entryOf(PATCH)
  assert.equal(patch.dsh, DSH)
  assert.equal(readJson(join(APP, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh'], DSH)
  assert.deepEqual(
    patch.files.map(file => ({ package: file.package, version: file.version, file: file.file })),
    [{ package: FORMAT, version: VERSION, file: FORMAT_FILE }, { package: PERSIST, version: VERSION, file: WORKER_FILE }],
  )
  const lock = readJson(join(APP, 'runtime', 'package-lock.json')).packages
  assert.equal(lock[`node_modules/${FORMAT}`]?.version, VERSION)
  assert.equal(lock[`node_modules/${PERSIST}`]?.version, VERSION)
  for (const file of patch.files) {
    assert.match(file.before, /^[0-9a-f]{64}$/)
    assert.match(file.after, /^[0-9a-f]{64}$/)
    assert.notEqual(file.before, file.after)
  }
  assert.equal(sha256(readFileSync(FORMAT_FIXTURE)), patch.files[0].before, 'the format fixture must be the exact file the entry was made against')
  assert.equal(sha256(readFileSync(WORKER_FIXTURE)), patch.files[1].before, 'the worker fixture must be the exact file the entry was made against')
  assert.match(readFileSync(LICENSE, 'utf8'), /^MIT License\n/)
  const text = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(text.startsWith(`--- a/${FORMAT}/${FORMAT_FILE}\n+++ b/${FORMAT}/${FORMAT_FILE}\n`), text.slice(0, 120))
  assert.match(text, /^\+\t\tif \(pending === void 0 && message === void 0 && !this\.called\.has\(id\)\) \{$/m)
  assert.match(text, /^\+\tif \(state\.unadvertised > 0\) console\.warn\(/m)
  assert.ok(text.includes(`+++ b/${PERSIST}/${WORKER_FILE}\n`))
})

test('the carried patch applies to the real pinned bytes, and a re-run leaves them alone', (t) => {
  const runtime = makeRuntime(t)
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(({ name, state }) => ({ name, state })), [
    { name: `${FORMAT}/${FORMAT_FILE}`, state: 'patched' },
    { name: `${PERSIST}/${WORKER_FILE}`, state: 'patched' },
  ])
  const [format, worker] = entryOf(PATCH).files
  assert.equal(sha256(readFileSync(runtime.format)), format.after)
  assert.equal(sha256(readFileSync(runtime.worker)), worker.after)
  assert.deepEqual(patchRuntime(runtime.modules, runtime.patches).map(result => result.state), ['already patched', 'already patched'])
})

test('the unpatched loader refuses the synthetic log, the patched one recovers it without losing events', async (t) => {
  const runtime = makeRuntime(t)
  const before = await import(pathToFileURL(runtime.format).href)
  assert.throws(
    () => before.restoreReleasedV4Artifact(artifactOf(), KNOWN),
    error => error.name === 'SessionFormatError' && error.message === ERROR,
  )

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await import(`${pathToFileURL(runtime.format).href}?patched`)
  const artifact = artifactOf()
  const { warnings, result } = loadWarnings(patched, artifact)
  assert.equal(result, artifact)
  assert.equal(result.events.length, EVENTS.length, 'no event is discarded')
  assert.deepEqual(result.events, EVENTS, 'no event is rewritten')
  assert.equal(warnings.length, 1, 'one line reports the recovery')
  assert.match(warnings[0], /tolerated 1 tool call\(s\) with no advertised lifecycle/)

  // Tolerance is only for the missing advertisement: a result with no call is still refused.
  const orphan = artifactOf()
  orphan.events = orphan.events.filter(event => event.type !== 'tool/call').map((event, seq) => ({
    ...event,
    seq,
    ...(Array.isArray(event.sourceEventSeqs) ? { sourceEventSeqs: event.sourceEventSeqs.map(source => (source > 7 ? source - 1 : source)) } : {}),
  }))
  assert.throws(
    () => patched.restoreReleasedV4Artifact(orphan, KNOWN),
    error => error.name === 'SessionFormatError' && /has no advertised tool lifecycle/.test(error.message),
  )
})

test('the unpatched verifier refuses the synthetic session file, the patched one recovers it in place', async (t) => {
  const runtime = makeRuntime(t)
  const log = join(runtime.root, 'session.v4.jsonl')
  writeSyntheticLog(log)
  const bytes = readFileSync(log, 'utf8')

  const refused = await verifyWithWorker(runtime.worker, log)
  assert.equal(refused.message.ok, false)
  assert.match(refused.message.message, new RegExp(ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[1].state, 'patched')
  const recovered = await verifyWithWorker(runtime.worker, log)
  assert.equal(recovered.message.ok, true, recovered.message.message)
  assert.equal(recovered.stderr.trim().split('\n').length, 1, 'one line reports the recovery')
  assert.match(recovered.stderr, /tolerated 1 tool call\(s\) with no advertised lifecycle/)
  assert.equal(readFileSync(log, 'utf8'), bytes, 'tolerance must not rewrite the session file')
  assert.equal(existsSync(`${log}.bak`), false)
  assert.equal(existsSync(`${log}.pre-repair`), false)
  assert.equal(readdirSync(runtime.root).some(name => name.startsWith('session.v4.jsonl.')), false, 'no backup is written when nothing is repaired')
})

test('a call repeated after its result still fails on the patched loader and verifier', async (t) => {
  const runtime = makeRuntime(t)
  assert.deepEqual(patchRuntime(runtime.modules, runtime.patches).map(result => result.state), ['patched', 'patched'])
  const patched = await import(`${pathToFileURL(runtime.format).href}?repeated`)

  // Control: the same shape with two distinct ids is two tolerated first calls.
  const { warnings } = loadWarnings(patched, artifactOf(DISTINCT))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /tolerated 2 tool call\(s\) with no advertised lifecycle/)

  assert.throws(
    () => loadWarnings(patched, artifactOf(REPEATED)),
    error => error.name === 'SessionFormatError' && error.message === ERROR,
  )

  const distinct = join(runtime.root, 'distinct.v4.jsonl')
  writeSyntheticLog(distinct, DISTINCT)
  const accepted = await verifyWithWorker(runtime.worker, distinct, DISTINCT.length)
  assert.equal(accepted.message.ok, true, accepted.message.message)

  const repeated = join(runtime.root, 'repeated.v4.jsonl')
  writeSyntheticLog(repeated, REPEATED)
  const refused = await verifyWithWorker(runtime.worker, repeated, REPEATED.length)
  assert.equal(refused.message.ok, false)
  assert.match(refused.message.message, new RegExp(escape(ERROR)))
})

test('an orphan tool/result still fails on the patched verifier', async (t) => {
  const runtime = makeRuntime(t)
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[1].state, 'patched')
  const log = join(runtime.root, 'orphan.v4.jsonl')
  writeSyntheticLog(log, ORPHAN)
  const refused = await verifyWithWorker(runtime.worker, log, ORPHAN.length)
  assert.equal(refused.message.ok, false)
  assert.match(refused.message.message, new RegExp(escape(ORPHAN_ERROR)))
})

// Issue #957: the shapes a bridged call left behind when its step ended before it did. Made
// here, never copied from a real session. In turn 2 the bridge advertises call A (a marked
// assistant block), records it, and step 1 ends with A open; step 2 then holds the bridge's
// late rows, all stamped with step 1.
const KNOWN_957 = new Set([...KNOWN, 'assistant/message', 'developer/message'])
const advert = id => ({
  type: 'assistant/message',
  time: 0,
  data: {
    turn: 2,
    step: 1,
    stream: [],
    message: { id: `ad-${id}`, role: 'assistant', content: [{ type: 'tool-call', id, name: 'job_output', arguments: '{}' }], source: { kind: 'model', provider: 'acp-fake', model: 'fake', bridge: true, synthetic: 'acp-bridge' } },
  },
  surfaceOp: 'append',
})
const callRow = id => ({ type: 'tool/call', time: 0, data: { turn: 2, step: 1, callId: id, name: 'job_output', arguments: '{}' } })
const resultRow = (id, callSeq, step = 1) => ({
  type: 'tool/result',
  time: 0,
  data: { turn: 2, step, message: { id: `result-${id}-${callSeq}-${step}`, role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, content: [{ type: 'text', text: 'ok' }], isError: false } },
  surfaceOp: 'append',
  sourceEventSeqs: [callSeq],
})
const hideRow = adSeq => ({
  type: 'developer/message',
  time: 0,
  data: { turn: 2, step: 1, message: { id: `hide-${adSeq}`, role: 'developer', content: [], source: { kind: 'acp-bridge' } } },
  surfaceOp: { op: 'replace', startSeq: adSeq, endSeq: adSeq },
  sourceEventSeqs: [adSeq],
})
const stepEnd = step => ({ type: 'step/end', time: 0, data: { turn: 2, step } })
const stepStart = step => ({ type: 'step/start', time: 0, data: { turn: 2, step } })
const turnEnd = { type: 'turn/end', time: 0, data: { turn: 2, reason: 'stop' } }
// Turn 1 and the start of turn 2 as in EVENTS, then the given rows, numbered in order.
const turnTwoRows = rows => [...structuredClone(EVENTS.slice(0, 7)), ...rows].map((event, seq) => ({ ...structuredClone(event), seq }))

// seq 7 is A's advertisement, 8 its call, 9 B's advertisement, 10 B's call.
const OPEN_HEAD = [advert('bridge_a'), callRow('bridge_a'), advert('bridge_b'), callRow('bridge_b'), resultRow('bridge_b', 10), hideRow(9)]
const SHAPES = {
  // The table in the issue: A open at step/end, its result and its block's replacement in step 2.
  'the late result lands in the next step': turnTwoRows([...OPEN_HEAD, stepEnd(1), stepStart(2), resultRow('bridge_a', 8), hideRow(7), stepEnd(2), turnEnd]),
  // The call never answers at all.
  'the call is never answered': turnTwoRows([...OPEN_HEAD, stepEnd(1), turnEnd]),
  // The late rows come after the turn has ended.
  'the late result lands after turn/end': turnTwoRows([...OPEN_HEAD, stepEnd(1), turnEnd, resultRow('bridge_a', 8), hideRow(7)]),
  // DSH's own recovery answered A in its step; the bridge's result came anyway (a double result).
  'a second result after the recovery result': turnTwoRows([...OPEN_HEAD, resultRow('bridge_a', 8), stepEnd(1), stepStart(2), resultRow('bridge_a', 8), hideRow(7), stepEnd(2), turnEnd]),
  // The second broken session: the bridge advertised A (seq 7) and hid the block again, but its
  // tool/call row was never written, so the error names an id with no tool/call row at all.
  'an advertised call with no tool/call row': turnTwoRows([advert('bridge_a'), hideRow(7), advert('bridge_b'), callRow('bridge_b'), resultRow('bridge_b', 10), hideRow(9), stepEnd(1), turnEnd]),
  // The same, with a result row for the call that never started.
  'a result for an advertised call with no tool/call row': turnTwoRows([advert('bridge_a'), (({ sourceEventSeqs: _none, ...row }) => row)(resultRow('bridge_a', 7)), hideRow(7), stepEnd(1), turnEnd]),
}
const STILL_REFUSED = {
  // Two late results for one call: only one is matched to it.
  'two late results for one call': [turnTwoRows([...OPEN_HEAD, stepEnd(1), stepStart(2), resultRow('bridge_a', 8), resultRow('bridge_a', 8), stepEnd(2), turnEnd]), /tool\/result does not match an open turn and step/],
  // A late result that claims the step it lands in was never recorded there.
  'a late result stamped with the later step': [turnTwoRows([...OPEN_HEAD, stepEnd(1), stepStart(2), resultRow('bridge_a', 8, 2), stepEnd(2), turnEnd]), /has no advertised tool lifecycle/],
  // A call that is not the bridge's (no marked block) left open: DSH's own rule stands.
  'an open call that is not bridged': [turnTwoRows([
    { ...advert('native_a'), data: { ...advert('native_a').data, message: { ...advert('native_a').data.message, source: { kind: 'model', provider: 'acp-fake', model: 'fake' } } } },
    callRow('native_a'), stepEnd(1), turnEnd,
  ]), /step\/end leaves unresolved tool call native_a/],
  // An advertised call that never started and is not the bridge's: DSH's own rule stands.
  'an advertised call that is not bridged and never started': [turnTwoRows([
    { ...advert('native_a'), data: { ...advert('native_a').data, message: { ...advert('native_a').data.message, source: { kind: 'model', provider: 'acp-fake', model: 'fake' } } } },
    stepEnd(1), turnEnd,
  ]), /step\/end leaves unresolved tool call native_a/],
}

test('#957: the unpatched loader and verifier refuse each open-call shape, the patched ones load it untouched', async (t) => {
  const runtime = makeRuntime(t)
  const before = await import(`${pathToFileURL(runtime.format).href}?before-957`)
  const logs = {}
  for (const [name, events] of Object.entries(SHAPES)) {
    assert.throws(
      () => before.restoreReleasedV4Artifact(artifactOf(events), KNOWN_957),
      error => error.name === 'SessionFormatError',
      `unpatched loader: ${name}`,
    )
    if (name === 'an advertised call with no tool/call row') {
      assert.throws(() => before.restoreReleasedV4Artifact(artifactOf(events), KNOWN_957), error => error.message === 'step/end leaves unresolved tool call bridge_a')
      assert.equal(events.some(event => event.type === 'tool/call' && event.data.callId === 'bridge_a'), false)
    }
    logs[name] = join(runtime.root, `${Object.keys(logs).length}.v4.jsonl`)
    writeSyntheticLog(logs[name], events)
    const refused = await verifyWithWorker(runtime.worker, logs[name], events.length)
    assert.equal(refused.message.ok, false, `unpatched verifier: ${name}`)
  }
  // The issue's own error, on the issue's own shape.
  assert.throws(
    () => before.restoreReleasedV4Artifact(artifactOf(SHAPES['the late result lands in the next step']), KNOWN_957),
    error => error.message === 'step/end leaves unresolved tool call bridge_a',
  )

  assert.deepEqual(patchRuntime(runtime.modules, runtime.patches).map(result => result.state), ['patched', 'patched'])
  const patched = await import(`${pathToFileURL(runtime.format).href}?patched-957`)
  for (const [name, events] of Object.entries(SHAPES)) {
    const artifact = artifactOf(events)
    const original = console.warn
    const warnings = []
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      assert.equal(patched.restoreReleasedV4Artifact(artifact, KNOWN_957), artifact, name)
    } finally {
      console.warn = original
    }
    assert.deepEqual(artifact.events, events, `${name}: no event is rewritten or discarded`)
    assert.equal(warnings.length, 1, `${name}: one line reports the recovery`)
    assert.match(warnings[0], /bridged tool call\(s\) left open at a step or turn end and \d+ late bridge row\(s\) \(#957\)/)
    const bytes = readFileSync(logs[name], 'utf8')
    const recovered = await verifyWithWorker(runtime.worker, logs[name], events.length)
    assert.equal(recovered.message.ok, true, `patched verifier: ${name}: ${recovered.message.message}`)
    assert.equal(readFileSync(logs[name], 'utf8'), bytes, `${name}: the session file is not rewritten`)
  }
  assert.match(
    (() => {
      const lines = []
      const original = console.warn
      console.warn = (...args) => lines.push(args.join(' '))
      try { patched.restoreReleasedV4Artifact(artifactOf(SHAPES['the late result lands in the next step']), KNOWN_957) } finally { console.warn = original }
      return lines[0]
    })(),
    /tolerated 1 bridged tool call\(s\) left open at a step or turn end and 2 late bridge row\(s\)/,
  )
})

test('#957: the recovery stays narrow: a second late result, a wrong stamp and a call that is not bridged still fail', async (t) => {
  const runtime = makeRuntime(t)
  assert.deepEqual(patchRuntime(runtime.modules, runtime.patches).map(result => result.state), ['patched', 'patched'])
  const patched = await import(`${pathToFileURL(runtime.format).href}?narrow-957`)
  let index = 0
  for (const [name, [events, message]] of Object.entries(STILL_REFUSED)) {
    assert.throws(
      () => loadWarnings({ restoreReleasedV4Artifact: artifact => patched.restoreReleasedV4Artifact(artifact, KNOWN_957) }, artifactOf(events)),
      error => error.name === 'SessionFormatError' && message.test(error.message),
      name,
    )
    const log = join(runtime.root, `refused-${index++}.v4.jsonl`)
    writeSyntheticLog(log, events)
    const refused = await verifyWithWorker(runtime.worker, log, events.length)
    assert.equal(refused.message.ok, false, `patched verifier: ${name}`)
    assert.match(refused.message.message, message, name)
  }
})
