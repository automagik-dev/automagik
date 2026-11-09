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
const artifactOf = () => ({ header: HEADER, events: structuredClone(EVENTS), inheritedEventCount: 0 })

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
function writeSyntheticLog(file) {
  const header = { type: 'session', ...HEADER }
  writeFileSync(file, [JSON.stringify(header), ...EVENTS.map(event => JSON.stringify(event))].join('\n') + '\n')
}

function verifyWithWorker(workerPath, logPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(pathToFileURL(workerPath), {
      workerData: { path: logPath, compression: 'none', expectedId: HEADER.id, expectedEventCount: EVENTS.length },
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
  assert.match(text, /^\+\t\tif \(pending === void 0 && message === void 0\) \{$/m)
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
