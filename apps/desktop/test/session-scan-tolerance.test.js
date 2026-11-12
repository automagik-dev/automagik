// Issue #861: one bad folder in the sessions tree must not abort the whole listing and with it
// the desktop's workspace activation. A backup copy of a session (a sibling folder carrying the
// original header), a misnamed or unreadable folder, or a stray session file made
// SessionPersistence.list() throw; WorkspaceRegistry.listStoredHeaders() is its first call, so
// the registry never activated and none of the registered workspaces started.
//
// These tests run against the real pinned package bytes, not stand-ins:
// fixtures/session-scan-tolerance/persistence-jsonl.js is the unmodified lib/index.js of
// @deepseek-ai/dsh-session-persistence-jsonl 0.2.2-rc.2 (the carried patch's target, pinned by
// sha256 in runtime/patches/patches.json), and workspace.js is the unmodified lib/index.js of
// @deepseek-ai/dsh-workspace 0.2.2-rc.2 (MIT; LICENSE beside them). Each test applies the carried
// patch to the bytes npm installs, imports the patched listing, and runs it on a synthetic
// sessions tree made in this file. The unpatched listing is the fail-before control and throws on
// the same tree; the patched one skips and reports each bad folder, returns the valid snapshot,
// and the real WorkspaceRegistry activates over that snapshot.
//
// What this does NOT cover: a real DSH home or session, the full app startup and the server image
// build. Directory permissions are not portable (Windows, or a run as root, reads a mode-000
// folder), so the rows that need a failing read replace one method on the real backend instance:
// a header read or a folder read that fails with EIO or EACCES, and the listing's arrival order.
// One more row takes the read permission away for real where the platform honours it (#885).
// The stand-ins cover the pinned modules' imports (the catalog reads a synthetic v4 header, and a
// minimal cordis context constructs the plugin); the listing path and the registry are the real
// pinned code.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const PATCHES = join(APP, 'runtime', 'patches')
const FIXTURE = join(HERE, 'fixtures', 'session-scan-tolerance')
const PERSIST_FIXTURE = join(FIXTURE, 'persistence-jsonl.js')
const WORKSPACE_FIXTURE = join(FIXTURE, 'workspace.js')
const LICENSE = join(FIXTURE, 'LICENSE')
const DSH = '0.2.2-rc.2'
const VERSION = '0.2.2-rc.2'
const PATCH = 'session-scan-tolerance.patch'
const PERSIST = '@deepseek-ai/dsh-session-persistence-jsonl'
const WORKSPACE = '@deepseek-ai/dsh-workspace'
const FILE = 'lib/index.js'
// Warnings JSON-escape absolute paths on Windows, so assertions use these separator-free names.
const SESSION = 'valid-one'
const BACKUP = `${SESSION}.backup-20260101T000000`
const STRAY = 'notes.jsonl'
// The workspace module is unchanged glue, so it has no patches.json entry; this pins the copy
// the activation test reads to the same published 0.2.2-rc.2 bytes.
const WORKSPACE_SHA256 = '8964c54f3c3f2fd79ed92e5fb1413d84ba80272c4eb984677aaf70bf4d687848'
// The cordis stand-in registers Service.init under this key; the registry fixture extends it.
const SERVICE_INIT = Symbol.for('automagik.test.serviceInit')

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

function writeStub(root, name, source, fields = {}) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: VERSION, type: 'module', main: 'index.js', ...fields }))
  writeFileSync(join(dir, 'index.js'), source)
}

function writePackage(root, name, version = VERSION, fields = {}) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', ...fields }))
  return dir
}

// The pinned modules' imports. Only what module construction and the listing/registry paths
// touch is implemented; the code under test is the pinned bytes copied from the fixtures.
const STUBS = {
  '@deepseek-ai/schemastery': `const proxy = new Proxy(function () {}, { get: () => proxy, apply: () => proxy })\nexport default proxy\n`,
  '@deepseek-ai/dsh-session-format': [
    'export class SessionFormatError extends Error {}',
    'export class SessionFormatUnsupportedMigrationError extends SessionFormatError {}',
    "export const sessionFormatLogFilename = version => version === 0 ? 'session.jsonl' : `session.v${version}.jsonl`",
    'export const parseSessionFormatLogFilename = name => {',
    '  const match = /^session(?:\\.v([1-9]\\d*))?\\.jsonl$/.exec(name)',
    '  if (match === null) return undefined',
    '  return match[1] === undefined ? 0 : Number(match[1])',
    '}',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-session-format-catalog': [
    'export class SessionFormatUnsupportedMigrationError extends Error {}',
    'export const sessionFormatCatalog = {',
    '  currentVersion: 4,',
    '  readHeader(value) {',
    "    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { status: 'malformed' }",
    '    if (value.version !== 4) return { status: \'unsupported\', storedVersion: value.version, reason: `session "${value.id}" uses format v${value.version}` }',
    '    return { status: \'current\', header: value }',
    '  },',
    '  encodeCurrentHeader: header => header,',
    '  encodeCurrentEvent: event => event,',
    '  createRestore: () => ({}),',
    '}',
    'export const historicalSessionFormatCatalog = sessionFormatCatalog',
    'export const createSessionFormatCatalogWithChildren = () => sessionFormatCatalog',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-session': [
    'export const SESSION_FORMAT_VERSION = 4',
    'export const KNOWN_SESSION_EVENT_TYPES = new Set()',
    'export const SessionId = value => value',
    'export const SessionLogOffset = value => value ?? 0',
    'export class Session {}',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-session-persistence': [
    'export class SessionPersistence {',
    "  constructor(ctx, key = 'sessionPersistence') { this.ctx = ctx; if (ctx !== undefined) ctx[key] = this }",
    '}',
    'export class SessionFormatUnsupportedError extends Error {',
    "  constructor(message, options) { super(message, options); this.name = 'SessionFormatUnsupportedError'; this.location = options }",
    '}',
    'export class SessionPersistenceCorruptionError extends Error {',
    "  constructor(message, options) { super(message, options); this.name = 'SessionPersistenceCorruptionError' }",
    '}',
    'export class SessionPersistenceNotFoundError extends Error {}',
    'export class SessionAlreadyExistsError extends Error {}',
    'export class SessionAlreadyOwnedError extends Error {}',
    'export class SessionHandleClosedError extends Error {}',
    'export class SessionReadOnlyError extends Error {}',
    'export const SessionPersistenceRevision = value => value',
    'export const assertContiguous = () => {}',
    'export const assertStoredId = () => {}',
    'export const materializeAppendBatch = () => {}',
    'export const materializeCreateHeader = header => header',
    'export const validateStoredEvents = () => {}',
    "export const sessionFormatVersionRefusal = (id, version) => `session \"${id}\" uses unsupported format version ${version}`",
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-llm': [
    'export class BlockAssembler {}',
    'export const errorChain = () => []',
    'export const expandAssistantStream = () => []',
    '',
  ].join('\n'),
  '@deepseek-ai/dsh-session-format-v3-to-v4': [
    'export const assertReleasedV4Relationships = () => {}',
    'export const assertV4RowAdmission = () => {}',
    'export const historicalChildCatalogSource = () => undefined',
    '',
  ].join('\n'),
  '@deepseek-ai/cordis': [
    'export class Service {',
    '  static init = Symbol.for(\'automagik.test.serviceInit\')',
    '  constructor(ctx) { this.ctx = ctx }',
    '}',
    '',
  ].join('\n'),
  'zod': `const proxy = new Proxy(function () {}, { get: () => proxy, apply: () => proxy })\nexport const z = proxy\nexport default { z }\n`,
  '@deepseek-ai/dsh-brand': 'export const brandString = value => value\n',
  '@deepseek-ai/dsh-storage-domain': 'export const defineDomain = spec => spec\nexport const domainTable = schema => schema\n',
  'p-limit': 'const pLimit = () => fn => Promise.resolve().then(fn)\nexport default pLimit\n',
}

// A temp runtime laid out like apps/desktop/build/runtime after prepare-runtime: the pinned
// packages at their installed version and the carried patch next to patches.json. Only the one
// entry under test is copied, so an unrelated patch cannot change this test's result.
function makeRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), 'automagik-scan-tolerance-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, 'node_modules')

  writePackage(root, '@deepseek-ai/dsh', DSH)
  for (const [name, source] of Object.entries(STUBS)) writeStub(root, name, source)

  const persist = writePackage(root, PERSIST)
  mkdirSync(join(persist, 'lib'), { recursive: true })
  cpSync(PERSIST_FIXTURE, join(persist, FILE))

  const workspace = writePackage(root, WORKSPACE)
  mkdirSync(join(workspace, 'lib'), { recursive: true })
  cpSync(WORKSPACE_FIXTURE, join(workspace, FILE))

  // The catalog also has the message-projections subpath the pinned bytes import.
  const catalog = writePackage(root, '@deepseek-ai/dsh-session-format-catalog', VERSION, {
    main: 'index.js',
    exports: { '.': './index.js', './message-projections': './message-projections.js' },
  })
  writeFileSync(join(catalog, 'message-projections.js'), 'export const currentSessionMessageProjections = {}\n')

  // node-addon-system exports ./flock as a subpath, not as its main entry.
  const addon = writePackage(root, '@deepseek-ai/node-addon-system', VERSION, {
    exports: { './flock': './flock.js' },
  })
  writeFileSync(join(addon, 'flock.js'), 'export const tryLockExclusive = async () => ({})\n')

  const patches = join(root, 'patches')
  mkdirSync(patches)
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === PATCH)
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify(entries, null, 2)}\n`)
  for (const item of entries) cpSync(join(PATCHES, item.patch), join(patches, item.patch))
  return { root, modules, patches, persist: join(persist, FILE), workspace: join(workspace, FILE) }
}

function entryOf(name) {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(item => item.patch === name)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${name}`)
  return entries[0]
}

const importModule = (path, tag) => import(`${pathToFileURL(path).href}?${tag}`)

// Construct the pinned JSONL backend through its plugin `apply` with a minimal cordis-shaped
// context. `ctx.plugin` runs the descriptor, which constructs the real backend; the backend
// registers itself on the service context under its service key.
async function openPersistence(modulePath, sessionsRoot, tag) {
  const module = await importModule(modulePath, tag)
  const instances = []
  const ctx = {
    effect(generator) {
      for (const _ of generator()) void _
    },
    on() {
      return () => {}
    },
    plugin(descriptor) {
      const serviceCtx = {}
      descriptor.apply(serviceCtx)
      instances.push(serviceCtx.sessionPersistence)
      return { await: async () => {}, dispose: Promise.resolve() }
    },
  }
  await module.apply(ctx, { root: sessionsRoot, compression: 'none' })
  assert.ok(instances[0], 'the backend must construct')
  return instances[0]
}

// Run the real WorkspaceRegistry[Service.init] over a persistence listing. `storageDomain` is a
// small in-memory stand-in: activation only reads the empty state and may write one workspace
// record for the valid session's cwd.
async function activateWorkspace(runtime, persistence, tag) {
  const module = await importModule(runtime.workspace, tag)
  const { WorkspaceRegistry } = module
  let state = { initialized: false, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] }
  const rows = new Map()
  const table = {
    get size() {
      return rows.size
    },
    get: id => rows.get(id),
    put: async (id, record) => rows.set(id, record),
    update: async (id, update) => rows.set(id, update(rows.get(id))),
    delete: async id => rows.delete(id),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    values: () => rows.values(),
  }
  const domain = {
    table: () => table,
    global: {
      get: () => state,
      set: async next => {
        state = next
      },
    },
    close: () => {},
  }
  const warnings = []
  const ctx = {
    sessionPersistence: persistence,
    storageDomain: { open: async () => domain },
    get: () => undefined,
    effect: () => {},
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
  }
  const registry = new WorkspaceRegistry(ctx)
  await registry[SERVICE_INIT]()
  return { registry, rows, state: () => state, warnings }
}

// The project directory key the pinned backend uses to place one session artifact. It is
// mirrored here only to lay out the synthetic tree at the canonical path the identity check
// expects; the listing under test computes it itself.
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

// A synthetic current-generation session log: one header line, no real session content. `dirName`
// lets a backup copy carry the original header under a sibling folder name.
function writeSession(sessions, cwd, { id = 'valid-one', dirName = id, headerId = id, headerCwd = cwd, extra = {} } = {}) {
  const dir = join(sessions, projectKey(headerCwd), dirName)
  mkdirSync(dir, { recursive: true })
  const header = { type: 'session', version: 4, id: headerId, createdAt: 1, isSeeded: false, delegationDepth: 0, cwd: headerCwd, ...extra }
  writeFileSync(join(dir, 'session.v4.jsonl'), `${JSON.stringify(header)}\n`)
  return dir
}

function syntheticTree(runtime) {
  const sessions = join(runtime.root, 'sessions')
  const cwd = join(runtime.root, 'project')
  mkdirSync(sessions, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  return { sessions, cwd }
}

// Capture every console.warn the pinned scan emits, and return it alongside the outcome.
async function withWarnings(operation) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    return { value: await operation(), warnings }
  } finally {
    console.warn = original
  }
}

// Hash every file in the tree, so a test can prove the scan rewrote nothing.
function snapshotTree(root) {
  const files = {}
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else files[relative(root, path)] = sha256(readFileSync(path))
    }
  }
  walk(root)
  return files
}

test('patches.json pins the real 0.2.2-rc.2 listing to the desktop runtime', () => {
  const patch = entryOf(PATCH)
  assert.equal(patch.dsh, DSH)
  assert.equal(readJson(join(APP, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh'], DSH)
  assert.deepEqual(
    patch.files.map(file => ({ package: file.package, version: file.version, file: file.file })),
    [{ package: PERSIST, version: VERSION, file: FILE }],
  )
  const lock = readJson(join(APP, 'runtime', 'package-lock.json')).packages
  assert.equal(lock[`node_modules/${PERSIST}`]?.version, VERSION)
  const [file] = patch.files
  assert.match(file.before, /^[0-9a-f]{64}$/)
  assert.match(file.after, /^[0-9a-f]{64}$/)
  assert.notEqual(file.before, file.after)
  assert.equal(sha256(readFileSync(PERSIST_FIXTURE)), file.before, 'the persistence fixture must be the exact file the entry was made against')
  assert.equal(sha256(readFileSync(WORKSPACE_FIXTURE)), WORKSPACE_SHA256, 'the workspace fixture must be the pinned 0.2.2-rc.2 bytes')
  assert.match(readFileSync(LICENSE, 'utf8'), /^MIT License\n/)
  const text = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(text.startsWith(`--- a/${PERSIST}/${FILE}\n+++ b/${PERSIST}/${FILE}\n`), text.slice(0, 120))
  assert.ok(text.includes('+\tskippedPaths = /* @__PURE__ */ new Set();'), 'the patch adds the per-instance skipped set')
  assert.ok(text.includes('+function warnSkippedSession(kind, path, error) {'), 'the patch adds the one-line reporter')
  assert.ok(text.includes('this.warnSkipped("session folder", dirname(selected.sourcePath), error ?? "no readable session header");'), 'the header stage reports the skipped folder')
  assert.ok(text.includes('+\t\t\tskipFlatFiles: true,\n+\t\t\tonUnreadable: () => {'), 'the root encoding check skips only a flat file and an unreadable folder')
  assert.ok(text.includes('+\t\tif (unreadable) this.rootEncodingCheck = void 0;'), 'a root check that skipped a folder is never cached')
  assert.ok(text.includes('+\t\t\tconst children = async () => (await this.listArtifacts(signal, { strict: true })).filter('), 'the migration child catalog lists strictly')
  assert.ok(text.includes('session backups belong outside the sessions tree, in session-backups/'), 'the skip warning points backups outside the tree')
})

test('the carried patch applies to the real pinned bytes, and a re-run leaves them alone', (t) => {
  const runtime = makeRuntime(t)
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(({ name, state }) => ({ name, state })), [{ name: `${PERSIST}/${FILE}`, state: 'patched' }])
  const [file] = entryOf(PATCH).files
  assert.equal(sha256(readFileSync(runtime.persist)), file.after)
  assert.deepEqual(patchRuntime(runtime.modules, runtime.patches).map(result => result.state), ['already patched'])
})

test('a backup sibling aborts the unpatched listing; the patched one lists the valid session and reports the folder', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { dirName: BACKUP })
  const before = snapshotTree(sessions)

  await assert.rejects(
    async () => (await openPersistence(runtime.persist, sessions, 'unpatched')).list(),
    error => /^corrupt session log /.test(error.message) && error.message.includes(BACKUP) && error.message.includes(`header id "${SESSION}"`),
  )

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const { value: listed, warnings } = await withWarnings(async () => (await openPersistence(runtime.persist, sessions, 'patched')).list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.equal(warnings.length, 1, 'one line per skipped folder')
  assert.match(warnings[0], /^dsh-session: skipped session folder /)
  assert.ok(warnings[0].includes(BACKUP), warnings[0])
  assert.match(warnings[0], /corrupt session log .*header id "valid-one"/)
  assert.ok(warnings[0].endsWith('(session backups belong outside the sessions tree, in session-backups/)'), warnings[0])
  assert.deepEqual(snapshotTree(sessions), before, 'the scan must not rewrite the tree')
})

test('a stray session file aborts the unpatched listing; the patched one reports it and keeps the valid session', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  const stray = join(sessions, projectKey(cwd), STRAY)
  writeFileSync(stray, '{"not":"a session"}\n')

  await assert.rejects(
    async () => (await openPersistence(runtime.persist, sessions, 'unpatched')).list(),
    error => error.message.includes(STRAY) && /flat-file layout/.test(error.message),
  )

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const { value: listed, warnings } = await withWarnings(async () => (await openPersistence(runtime.persist, sessions, 'patched')).list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.equal(warnings.length, 1, 'one line per stray file')
  assert.ok(warnings[0].includes(STRAY), warnings[0])
  assert.match(warnings[0], /flat-file layout/)
  assert.ok(warnings[0].endsWith('(session backups belong outside the sessions tree, in session-backups/)'), warnings[0])
})

test('a duplicate session id aborts the unpatched listing; the patched one keeps the first valid entry and reports the other', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd, { id: 'same-id' })
  const copyCwd = `${cwd}-copy`
  writeSession(sessions, cwd, { dirName: 'same-id', id: 'same-id', headerCwd: copyCwd })

  await assert.rejects(
    async () => (await openPersistence(runtime.persist, sessions, 'unpatched')).list(),
    error => /^duplicate JSONL session id "same-id" appears in multiple project directories$/.test(error.message),
  )

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const { value: listed, warnings } = await withWarnings(async () => (await openPersistence(runtime.persist, sessions, 'patched')).list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['same-id'], 'the valid session is kept, not silently dropped')
  assert.equal(warnings.length, 1, 'one line per skipped folder')
  assert.ok(warnings[0].includes(projectKey(cwd)) || warnings[0].includes(projectKey(copyCwd)), warnings[0])
  assert.match(warnings[0], /duplicate session id "same-id" \(kept ".*"\) \(session backups/)
  assert.ok(warnings[0].endsWith('(session backups belong outside the sessions tree, in session-backups/)'), warnings[0])
})

test('a duplicate session id keeps the copy first in sorted path order, whatever order the scan arrives in', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd, { id: 'same-id' })
  const copyCwd = `${cwd}-copy`
  writeSession(sessions, cwd, { id: 'same-id', headerCwd: copyCwd })
  // "--…-project--" sorts before "--…-project-copy--" ("-" < "c"), so the original folder is kept.
  const keptKey = projectKey(cwd)
  const otherKey = projectKey(copyCwd)

  await assert.rejects(
    async () => (await openPersistence(runtime.persist, sessions, 'unpatched')).list(),
    error => /^duplicate JSONL session id "same-id"/.test(error.message),
  )

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  // readdir order is the filesystem's, so each pass replaces listGenerations on the real instance
  // to hand listArtifacts the same generations in one order and then the reverse.
  for (const [tag, order] of [['forward', list => list], ['reverse', list => [...list].reverse()]]) {
    const persistence = await openPersistence(runtime.persist, sessions, `patched-order-${tag}`)
    const listGenerations = persistence.listGenerations.bind(persistence)
    persistence.listGenerations = async (...args) => order(await listGenerations(...args))
    const { value: artifacts, warnings } = await withWarnings(() => persistence.listArtifacts())
    assert.equal(artifacts.length, 1, tag)
    assert.ok(artifacts[0].path.includes(keptKey) && !artifacts[0].path.includes(otherKey), `${tag}: ${artifacts[0].path}`)
    assert.equal(warnings.length, 1, tag)
    assert.ok(warnings[0].includes(otherKey), `${tag}: ${warnings[0]}`)
    assert.match(warnings[0], /duplicate session id "same-id" \(kept ".*"\)/, tag)
  }
})

test('a session of the other compression still fails the patched listing with the root encoding mismatch', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  const other = writeSession(sessions, cwd, { id: 'other-one' })
  renameSync(join(other, 'session.v4.jsonl'), join(other, 'session.v4.jsonl.zstd'))
  const mismatch = error => /uses \.jsonl\.zstd, but this backend is configured for compression "none"/.test(error.message) && error.message.includes('other-one')

  await assert.rejects(async () => (await openPersistence(runtime.persist, sessions, 'unpatched')).list(), mismatch)

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched')
  const { warnings } = await withWarnings(async () => {
    await assert.rejects(() => persistence.list(), mismatch)
    // ensureRootEncoding caches its first result: a second listing must refuse again, not pass.
    await assert.rejects(() => persistence.list(), mismatch)
  })
  assert.deepEqual(warnings, [], 'the mismatch is a refusal, not a skipped folder')
})

// A folder the backend cannot read: every read of it by the real instance (the root check's
// encoding probe and the listing's generation lookup) throws `code`, until `unlock()`.
function lockFolder(persistence, name, code = 'EACCES') {
  let locked = true
  const refuse = (dir) => { throw Object.assign(new Error(`${code}: permission denied, scandir '${dir}'`), { code }) }
  for (const method of ['findOppositeGenerationInDirectory', 'resolveGenerationInDirectory']) {
    const real = persistence[method].bind(persistence)
    persistence[method] = async (dir, ...rest) => (locked && dir.includes(name) ? refuse(dir) : real(dir, ...rest))
  }
  return { unlock: () => { locked = false } }
}

test('a session folder the root check cannot read is skipped and reported, and that pass is never cached (#885)', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  const lockedDir = writeSession(sessions, cwd, { id: 'locked-one' })

  // Fail-before: the unpatched root check throws on the folder, so nothing lists.
  const unpatched = await openPersistence(runtime.persist, sessions, 'unpatched')
  lockFolder(unpatched, 'locked-one')
  await assert.rejects(() => unpatched.list(), error => error.code === 'EACCES')

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched')
  const lock = lockFolder(persistence, 'locked-one')
  const first = await withWarnings(() => persistence.list())
  assert.deepEqual(first.value.map(snapshot => snapshot.header.id), [SESSION])
  assert.equal(first.warnings.length, 1, first.warnings.join('\n'))
  assert.match(first.warnings[0], /^dsh-session: skipped session folder /)
  assert.ok(first.warnings[0].includes('locked-one') && first.warnings[0].includes('EACCES'), first.warnings[0])
  assert.ok(!first.warnings[0].includes('session-backups/'), 'an unreadable folder is not backup-shaped')
  assert.equal(persistence.rootEncodingCheck, undefined, 'a pass that skipped a folder is not cached')

  // The folder is still skipped, and reported only once per backend instance.
  const again = await withWarnings(() => persistence.list())
  assert.deepEqual(again.value.map(snapshot => snapshot.header.id), [SESSION])
  assert.deepEqual(again.warnings, [])

  // The guard stayed armed: the folder turns readable holding the other compression, and the
  // very next call refuses the root. A cached OK from the skipped pass would have listed it.
  renameSync(join(lockedDir, 'session.v4.jsonl'), join(lockedDir, 'session.v4.jsonl.zstd'))
  lock.unlock()
  const mismatch = error => /uses \.jsonl\.zstd, but this backend is configured for compression "none"/.test(error.message) && error.message.includes('locked-one')
  await assert.rejects(() => persistence.list(), mismatch)
  await assert.rejects(() => persistence.list(), mismatch)
})

test('a clean root check is cached, and a folder that turns unreadable later is skipped by the listing (#885)', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { id: 'locked-one' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched-cached')
  assert.deepEqual((await persistence.list()).map(snapshot => snapshot.header.id).sort(), ['locked-one', SESSION])
  const cached = persistence.rootEncodingCheck
  assert.ok(cached instanceof Promise, 'a pass that skipped nothing is cached')
  lockFolder(persistence, 'locked-one')
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), [SESSION])
  assert.equal(warnings.length, 1, warnings.join('\n'))
  assert.ok(warnings[0].includes('locked-one') && warnings[0].includes('EACCES'), warnings[0])
  assert.equal(persistence.rootEncodingCheck, cached, 'the cached pass is kept: the listing skipped the folder, not the root check')
})

test('the root check skips only the four named codes: an EIO folder still fails it, and that refusal stays', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { id: 'locked-one' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched-eio')
  lockFolder(persistence, 'locked-one', 'EIO')
  const { warnings } = await withWarnings(async () => {
    await assert.rejects(() => persistence.list(), error => error.code === 'EIO')
    await assert.rejects(() => persistence.list(), error => error.code === 'EIO')
  })
  assert.deepEqual(warnings, [], 'an unnamed failure is a refusal, not a skipped folder')
})

test('the real WorkspaceRegistry activates over a tree with an unreadable session folder (#885)', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { id: 'locked-one' })

  const unpatched = await openPersistence(runtime.persist, sessions, 'unpatched')
  lockFolder(unpatched, 'locked-one')
  await assert.rejects(() => activateWorkspace(runtime, unpatched, 'workspace-unpatched'), error => error.code === 'EACCES')

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await openPersistence(runtime.persist, sessions, 'patched')
  lockFolder(patched, 'locked-one')
  const { value: activated, warnings } = await withWarnings(() => activateWorkspace(runtime, patched, 'workspace-patched'))
  assert.deepEqual([...activated.registry.headers.keys()], [SESSION])
  assert.equal(activated.state().initialized, true)
  assert.equal(activated.warnings.length, 0)
  assert.equal(warnings.length, 1, warnings.join('\n'))
  assert.ok(warnings[0].includes('locked-one') && warnings[0].includes('EACCES'), warnings[0])
})

// One rule for files and folders (#885): an unreadable log and an unreadable folder are both
// skipped and reported from the first listing on, so neither session is listed, and the registry
// does not know either until it is readable. An unnamed fault (EIO) is never a skip: it fails
// the listing, so sessionKnown() rejects instead of answering "unknown".
test('an unreadable log and an unreadable folder follow one rule: skipped, reported, not known (#885)', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { id: 'log-locked' })
  writeSession(sessions, cwd, { id: 'folder-locked' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched-rule')
  lockFolder(persistence, 'folder-locked')
  let code = 'EACCES'
  const readGenerationHeader = persistence.readGenerationHeader.bind(persistence)
  persistence.readGenerationHeader = async (selected, ...rest) => {
    if (selected.sourcePath.includes('log-locked')) throw Object.assign(new Error(`${code}: permission denied, open`), { code })
    return readGenerationHeader(selected, ...rest)
  }

  const { value: activated, warnings } = await withWarnings(() => activateWorkspace(runtime, persistence, 'workspace-rule'))
  assert.deepEqual([...activated.registry.headers.keys()], [SESSION])
  assert.equal(warnings.length, 2, warnings.join('\n'))
  for (const name of ['log-locked', 'folder-locked']) {
    const lines = warnings.filter(line => line.includes(name))
    assert.equal(lines.length, 1, `${name} is reported once`)
    assert.match(lines[0], /^dsh-session: skipped session folder .*EACCES/)
  }
  const known = await withWarnings(async () => ({
    valid: await activated.registry.sessionKnown(SESSION),
    log: await activated.registry.sessionKnown('log-locked'),
    folder: await activated.registry.sessionKnown('folder-locked'),
  }))
  assert.deepEqual(known.value, { valid: true, log: false, folder: false })
  assert.deepEqual(known.warnings, [], 'each skip was already reported')

  code = 'EIO'
  await assert.rejects(() => activated.registry.sessionKnown('log-locked'), error => error.code === 'EIO')
})

// Real permissions, where the platform honours them: Windows has no mode bits to take the read
// away with, and root reads a mode-000 folder.
const realModes = { skip: process.platform === 'win32' ? 'no POSIX mode bits' : process.getuid?.() === 0 ? 'root reads a mode-000 folder' : false }

test('with real permissions: a mode-000 session folder is skipped, and a mode-000 root still fails closed (#885)', realModes, async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  const lockedDir = writeSession(sessions, cwd, { id: 'locked-one' })
  // Registered first, so it runs after makeRuntime's removal is queued and before it: the tree
  // must be readable again to be removed.
  t.after(() => { for (const path of [sessions, lockedDir]) { try { chmodSync(path, 0o755) } catch {} } })
  chmodSync(lockedDir, 0o000)

  const unpatched = await openPersistence(runtime.persist, sessions, 'unpatched')
  await assert.rejects(() => unpatched.list(), error => error.code === 'EACCES')

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched')
  const first = await withWarnings(() => persistence.list())
  assert.deepEqual(first.value.map(snapshot => snapshot.header.id), [SESSION])
  assert.equal(first.warnings.length, 1, first.warnings.join('\n'))
  assert.ok(first.warnings[0].includes('locked-one') && first.warnings[0].includes('EACCES'), first.warnings[0])
  assert.equal(persistence.rootEncodingCheck, undefined, 'a pass that skipped a folder is not cached')

  // Readable again and clean: this pass skips nothing and is cached. Then the root itself goes
  // unreadable: the listing refuses, twice, and reports no skipped project.
  chmodSync(lockedDir, 0o755)
  assert.deepEqual((await persistence.list()).map(snapshot => snapshot.header.id).sort(), ['locked-one', SESSION])
  assert.ok(persistence.rootEncodingCheck instanceof Promise)
  chmodSync(sessions, 0o000)
  const refused = await withWarnings(async () => {
    await assert.rejects(() => persistence.list(), error => error.code === 'EACCES')
    await assert.rejects(() => persistence.list(), error => error.code === 'EACCES')
  })
  assert.deepEqual(refused.warnings, [], 'an unreadable root is a refusal, not a skipped project')
  chmodSync(sessions, 0o755)
  assert.deepEqual((await persistence.list()).map(snapshot => snapshot.header.id).sort(), ['locked-one', SESSION])
})

// The portable twin of the root row above: the real instance's root read is replaced, so the
// row runs everywhere. A listing (or a root check) that swallowed a root EACCES would list.
test('a root that turns unreadable after a cached pass still fails closed, and a later pass is not a cached OK (#885)', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched-root-eacces')
  assert.deepEqual((await persistence.list()).map(snapshot => snapshot.header.id), [SESSION])
  assert.ok(persistence.rootEncodingCheck instanceof Promise, 'the first listing cached the passing root check')
  const listProjectDirs = persistence.listProjectDirs.bind(persistence)
  let unreadable = true
  persistence.listProjectDirs = async (...args) => {
    if (unreadable) throw Object.assign(new Error(`EACCES: permission denied, scandir '${sessions}'`), { code: 'EACCES' })
    return listProjectDirs(...args)
  }
  const refused = await withWarnings(async () => {
    await assert.rejects(() => persistence.list(), error => error.code === 'EACCES')
    await assert.rejects(() => persistence.list(), error => error.code === 'EACCES')
  })
  assert.deepEqual(refused.warnings, [], 'the root is a refusal, not a skipped project')

  // The same root failing at the root check itself (a backend that never listed) refuses too.
  const fresh = await openPersistence(runtime.persist, sessions, 'patched-root-eacces-fresh')
  fresh.listProjectDirs = persistence.listProjectDirs
  await assert.rejects(() => fresh.list(), error => error.code === 'EACCES')
  unreadable = false
  assert.deepEqual((await persistence.list()).map(snapshot => snapshot.header.id), [SESSION])
})

test('a header read that fails with an unnamed error still fails the patched listing; a named one is skipped', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { id: 'faulty-one' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  // A synthetic tree cannot portably make a read fail with EIO, so the real instance's header read
  // is wrapped to throw a filesystem-shaped error for one folder and read every other one for real.
  const failing = async (code, tag) => {
    const persistence = await openPersistence(runtime.persist, sessions, tag)
    const readGenerationHeader = persistence.readGenerationHeader.bind(persistence)
    persistence.readGenerationHeader = async (selected, ...rest) => {
      if (selected.sourcePath.includes('faulty-one')) throw Object.assign(new Error(`${code}: read failed, read`), { code })
      return readGenerationHeader(selected, ...rest)
    }
    return persistence
  }

  for (const code of ['EIO', 'EMFILE']) {
    const persistence = await failing(code, `patched-${code}`)
    const { warnings } = await withWarnings(() => assert.rejects(() => persistence.list(), error => error.code === code))
    assert.deepEqual(warnings, [], `${code} is not skipped`)
  }

  const persistence = await failing('EACCES', 'patched-EACCES')
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes('faulty-one') && warnings[0].includes('EACCES'), warnings[0])
  assert.ok(!warnings[0].includes('session-backups/'), 'an unreadable folder is not backup-shaped')
})

test('a misplaced child drops out of the tolerant listing but still fails the migration child catalog', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  const parent = writeSession(sessions, cwd, { id: 'parent-one' })
  // The child's only copy sits in a backup-named folder, so its header does not identify its path.
  writeSession(sessions, cwd, {
    id: 'child-one',
    dirName: 'child-one.backup-20260101T000000',
    extra: { origin: 'subagent', parentSession: 'parent-one' },
  })
  const selected = { sourcePath: join(parent, 'session.v4.jsonl'), sourceVersion: 4, currentPath: join(parent, 'session.v4.jsonl') }
  const childIdentity = error => /corrupt session log .*header id "child-one"/.test(error.message)

  const unpatched = await openPersistence(runtime.persist, sessions, 'unpatched')
  await assert.rejects(() => unpatched.prepareStoredMigration('parent-one', selected, new AbortController().signal), childIdentity)

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched')
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['parent-one'], 'the tolerant listing skips the child')
  assert.equal(warnings.length, 1)
  // prepareStoredMigration's children() lists strictly, so the child cannot silently drop out of
  // the parent's catalog: the migration refuses exactly as the unpatched one does.
  await assert.rejects(() => persistence.prepareStoredMigration('parent-one', selected, new AbortController().signal), childIdentity)
})

test('the real WorkspaceRegistry does not activate over the unpatched listing, and activates over the patched one', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  writeSession(sessions, cwd, { dirName: BACKUP })
  const stray = join(sessions, projectKey(cwd), STRAY)
  writeFileSync(stray, '{"not":"a session"}\n')

  // The symptom: listStoredHeaders() is the registry's first call, so the scan throw stops
  // activation before any workspace starts.
  await assert.rejects(
    async () => {
      const unpatched = await openPersistence(runtime.persist, sessions, 'unpatched')
      return activateWorkspace(runtime, unpatched, 'workspace-unpatched')
    },
    error => /flat-file layout/.test(error.message),
  )

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await openPersistence(runtime.persist, sessions, 'patched')
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  let activated
  try {
    activated = await activateWorkspace(runtime, patched, 'workspace-patched')
  } finally {
    console.warn = original
  }
  assert.deepEqual([...activated.registry.headers.keys()], [SESSION])
  assert.equal(activated.registry.entities.size, 1, 'the registry activates and groups the valid session')
  // Windows may keep a short (8.3) spelling of tmpdir on one side; normalize exactly as the registry
  // does. fs.realpathSync does not expand the short name here, but fs/promises realpath does.
  assert.equal(await realpath(activated.registry.sessionPaths.get(SESSION)), await realpath(cwd))
  assert.equal(activated.state().initialized, true)
  assert.equal(activated.warnings.length, 0)
  assert.equal(warnings.length, 2, 'the backup folder and the stray file are reported')
  assert.ok(warnings.some(line => line.includes(BACKUP)), warnings.join('\n'))
  assert.ok(warnings.some(line => line.includes(STRAY)), warnings.join('\n'))
  assert.ok(warnings.every(line => line.endsWith('(session backups belong outside the sessions tree, in session-backups/)')), warnings.join('\n'))
})

test('the root still fails closed when it stops being a directory after the backend is built', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched-late-root')
  // The first listing passes and caches the root encoding check; only then does the root go.
  assert.deepEqual((await persistence.list()).map(snapshot => snapshot.header.id), [SESSION])
  rmSync(sessions, { recursive: true, force: true })
  writeFileSync(sessions, 'not a directory\n')
  const { warnings } = await withWarnings(() => assert.rejects(() => persistence.list(), error => error.code === 'ENOTDIR'))
  assert.deepEqual(warnings, [], 'the root is a refusal, not a skipped project')
})

test('many bad folders print at most 20 skip lines and one summary line with the rest', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = syntheticTree(runtime)
  writeSession(sessions, cwd)
  for (let i = 0; i < 25; i++) writeFileSync(join(sessions, projectKey(cwd), `stray-${String(i).padStart(2, '0')}.jsonl`), '{}\n')
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'patched-cap')
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), [SESSION])
  assert.equal(warnings.length, 21, warnings.join('\n'))
  assert.equal(warnings.filter(line => /^dsh-session: skipped session file /.test(line)).length, 20)
  assert.equal(warnings[20], 'dsh-session: skipped 5 more session paths without a line each (the first 20 are reported)')
  const { warnings: again } = await withWarnings(() => persistence.list())
  assert.deepEqual(again, [], 'a later listing of the same tree repeats nothing')
})

test('the root itself still fails closed when it is not a readable directory', async (t) => {
  const runtime = makeRuntime(t)
  const sessions = join(runtime.root, 'sessions')
  writeFileSync(sessions, 'not a directory\n')
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  await assert.rejects(
    () => openPersistence(runtime.persist, sessions, 'root'),
    error => error.code === 'ENOTDIR',
  )
})
