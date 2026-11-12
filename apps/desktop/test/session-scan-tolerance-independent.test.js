// Independent rows for issue #861: the repaired session-scan tolerance patch.
//
// The tests run the real pinned bytes, never a stand-in for the listing: the unmodified
// lib/index.js of @deepseek-ai/dsh-session-persistence-jsonl 0.2.2-rc.2 and of
// @deepseek-ai/dsh-workspace 0.2.2-rc.2 (both checked in under fixtures/session-scan-tolerance,
// pinned by the hashes below) are copied into an ephemeral runtime, and the carried
// runtime/patches/session-scan-tolerance.patch is applied there by the real
// scripts/runtime-patches.mjs. Nothing in this repository is patched or written: every tree is
// synthetic, lives under an ephemeral temp root, and is removed by t.after.
//
// Rows, in the priority order the repaired patch is held to:
// 1. the pins: fixture bytes are patches.json's before-image, the apply yields its after-image,
//    and a re-run is a no-op that does not rewrite the file;
// 2. the strict root: a .zstd log under a "none" backend still fails the root check (never
//    caches OK), the root still fails after construction, and the real WorkspaceRegistry
//    activation throws exactly as it does on the pinned bytes;
// 3. the skip set on the listing paths: format, corruption, identity and the four named
//    filesystem codes are skipped and reported once each (capped at 20 lines plus a summary),
//    while EIO, EMFILE and aborts still fail the scan;
// 4. the boundary (#885): an unreadable session folder is skipped and reported at the root
//    check too, but that pass is never cached, so the folder still fails the root once it is
//    readable and holds the other compression; a pass that skipped nothing is cached, and a
//    folder that turns unreadable after it is skipped by the listing;
// 5. duplicates keep the first copy in sorted sourcePath order, the migration child catalog
//    lists strictly, and a genuinely fatal header still fails;
// 6. the held tree: one valid session plus a backup-shaped folder, a stray flat file and a
//    duplicate id are all skipped and reported, the real registry activates and groups the
//    kept session, the tree stays byte-identical, and the backup-shaped warning points at
//    session-backups/ outside the tree.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchRuntime } from '../scripts/runtime-patches.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const FIXTURE = join(HERE, 'fixtures', 'session-scan-tolerance')
const PERSIST_FIXTURE = join(FIXTURE, 'persistence-jsonl.js')
const WORKSPACE_FIXTURE = join(FIXTURE, 'workspace.js')
const LICENSE_FIXTURE = join(FIXTURE, 'LICENSE')
const PATCHES = join(APP, 'runtime', 'patches')
const PATCH = 'session-scan-tolerance.patch'
const PERSIST = '@deepseek-ai/dsh-session-persistence-jsonl'
const WORKSPACE = '@deepseek-ai/dsh-workspace'
const LIB = 'lib/index.js'
const DSH = '0.2.2-rc.2'
const VERSION = '0.2.2-rc.2'
// patches.json's session-scan-tolerance entry: the published bytes and the carried result.
const BEFORE = '69efef5f84dddf947032bc1425067878fa610416c8885acde2ded9b01230c9b7'
const AFTER = 'fae8a417cfa075e3cab004add29a3fe010270fdf925f75b7fafe02775aee51a0'
// The workspace fixture is unchanged 0.2.2-rc.2 activation glue: it has no patches.json entry,
// so this rows its bytes independently of the persistence pin.
const WORKSPACE_SHA256 = '8964c54f3c3f2fd79ed92e5fb1413d84ba80272c4eb984677aaf70bf4d687848'
// The cordis stand-in registers Service.init under this key; the real registry fixture extends it.
const SERVICE_INIT = Symbol.for('automagik.test.serviceInit')
const OUTSIDE_HINT = '(session backups belong outside the sessions tree, in session-backups/)'
// The one id the held tree rows on, and the sibling folder name a user's backup copy would have.
const HELD_ID = 'held-session'
const BACKUP_NAME = `${HELD_ID}.backup-20260101T000000`
const STRAY_NAME = 'stray-notes.jsonl'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = data => createHash('sha256').update(data).digest('hex')
const importFile = (path, tag) => import(`${pathToFileURL(path).href}?${tag}`)
// The scan JSON-stringifies a path in its warning; mirror that so a Windows separator is portable.
const jsonPath = path => JSON.stringify(path).slice(1, -1)

// Synthetic runtimes go under os.tmpdir(), so the suite follows the run's own TMPDIR (the
// gate's scratch rule) and reproduces on any machine (#885). Each test removes its own.
const TEMP_ROOT = tmpdir()

/** Install one package.json-only node_modules package and return its directory. */
function installPackage(root, name, version = VERSION, fields = {}) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', main: 'index.js', ...fields }))
  return dir
}

/** Install one ESM stand-in module for an import of the pinned fixtures. */
function installSource(root, name, source, fields = {}) {
  const dir = installPackage(root, name, VERSION, fields)
  writeFileSync(join(dir, 'index.js'), source)
  return dir
}

// Only what module construction and the listing/registry paths touch is implemented. Everything
// under test (the listing, the root check, the migration catalog, WorkspaceRegistry) is the real
// pinned code copied from the fixtures; a few rows replace one method on the real instance to
// inject a fault a synthetic tree cannot portably produce (an unportable errno, a corrupted
// zstd frame), and the format catalog returns an unsupported status for one sentinel id.
const STUBS = [
  ['@deepseek-ai/schemastery', `const proxy = new Proxy(function () {}, { get: () => proxy, apply: () => proxy })
export default proxy
`],
  ['@deepseek-ai/dsh-session-format-catalog', `export class SessionFormatUnsupportedMigrationError extends Error {}
const catalog = {
  currentVersion: 4,
  readHeader(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { status: 'malformed' }
    if (value.id === 'format-unsupported') return { status: 'unsupported', reason: 'session has no usable format in this catalog' }
    if (value.version !== 4) return { status: 'unsupported', storedVersion: value.version, reason: 'session uses format v' + value.version }
    return { status: 'current', header: value }
  },
  encodeCurrentHeader: header => header,
  encodeCurrentEvent: event => event,
  createRestore: () => ({}),
}
export const sessionFormatCatalog = catalog
export const historicalSessionFormatCatalog = catalog
export const createSessionFormatCatalogWithChildren = () => catalog
`, { exports: { '.': './index.js', './message-projections': './message-projections.js' } }],
  ['@deepseek-ai/dsh-session-persistence', `export class SessionPersistence {
  constructor(ctx, key = 'sessionPersistence') {
    this.ctx = ctx
    if (ctx !== undefined) ctx[key] = this
  }
}
export class SessionFormatUnsupportedError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'SessionFormatUnsupportedError'
    this.location = options
  }
}
export class SessionPersistenceCorruptionError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'SessionPersistenceCorruptionError'
  }
}
export class SessionPersistenceNotFoundError extends Error {}
export class SessionAlreadyExistsError extends Error {}
export class SessionAlreadyOwnedError extends Error {}
export class SessionHandleClosedError extends Error {}
export class SessionReadOnlyError extends Error {}
export const SessionPersistenceRevision = value => value
export const assertContiguous = () => {}
export const assertStoredId = () => {}
export const materializeAppendBatch = () => {}
export const materializeCreateHeader = header => header
export const validateStoredEvents = () => {}
export const sessionFormatVersionRefusal = (id, version) => 'session "' + id + '" uses unsupported format version ' + version
`],
  ['@deepseek-ai/dsh-llm', `export class BlockAssembler {}
export const errorChain = () => []
export const expandAssistantStream = () => []
`],
  ['@deepseek-ai/dsh-session-format', `export class SessionFormatError extends Error {}
export class SessionFormatUnsupportedMigrationError extends SessionFormatError {}
export const sessionFormatLogFilename = version => version === 0 ? 'session.jsonl' : 'session.v' + version + '.jsonl'
export const parseSessionFormatLogFilename = name => {
  const match = /^session(?:\\.v([1-9]\\d*))?\\.jsonl$/.exec(name)
  if (match === null) return undefined
  return match[1] === undefined ? 0 : Number(match[1])
}
`],
  ['@deepseek-ai/dsh-session', `export const SESSION_FORMAT_VERSION = 4
export const KNOWN_SESSION_EVENT_TYPES = new Set()
export const SessionId = value => value
export const SessionLogOffset = value => value ?? 0
export class Session {}
`],
  ['@deepseek-ai/dsh-session-format-v3-to-v4', `export const assertReleasedV4Relationships = () => {}
export const assertV4RowAdmission = () => {}
export const historicalChildCatalogSource = () => undefined
`],
  ['@deepseek-ai/cordis', `export class Service {
  static init = Symbol.for('automagik.test.serviceInit')
  constructor(ctx) { this.ctx = ctx }
}
`],
  ['zod', `const proxy = new Proxy(function () {}, { get: () => proxy, apply: () => proxy })
export const z = proxy
export default { z }
`],
  ['@deepseek-ai/dsh-brand', 'export const brandString = value => value\n'],
  ['@deepseek-ai/dsh-storage-domain', 'export const defineDomain = spec => spec\nexport const domainTable = schema => schema\n'],
  ['p-limit', 'const pLimit = () => fn => Promise.resolve().then(fn)\nexport default pLimit\n'],
]

// A temp runtime laid out like apps/desktop/build/runtime after prepare-runtime: the pinned
// packages and the carried patch with its own filtered patches.json. Only the one entry under
// test is copied, so an unrelated patch cannot change this file's result.
function makeRuntime(t) {
  const root = mkdtempSync(join(TEMP_ROOT, 'automagik-861-independent-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  installPackage(root, '@deepseek-ai/dsh', DSH)
  for (const [name, source, fields] of STUBS) installSource(root, name, source, fields)
  const catalog = join(root, 'node_modules', '@deepseek-ai', 'dsh-session-format-catalog')
  writeFileSync(join(catalog, 'message-projections.js'), 'export const currentSessionMessageProjections = {}\n')

  const persist = installPackage(root, PERSIST)
  mkdirSync(join(persist, 'lib'), { recursive: true })
  cpSync(PERSIST_FIXTURE, join(persist, LIB))
  const workspace = installPackage(root, WORKSPACE)
  mkdirSync(join(workspace, 'lib'), { recursive: true })
  cpSync(WORKSPACE_FIXTURE, join(workspace, LIB))

  // @deepseek-ai/node-addon-system exports ./flock as a subpath, not as its main entry.
  const addon = installPackage(root, '@deepseek-ai/node-addon-system', VERSION, {
    exports: { './flock': './flock.js' },
  })
  writeFileSync(join(addon, 'flock.js'), 'export const tryLockExclusive = async () => ({})\n')

  const patches = join(root, 'patches')
  mkdirSync(patches)
  const entries = readJson(join(PATCHES, 'patches.json')).filter(entry => entry.patch === PATCH)
  writeFileSync(join(patches, 'patches.json'), `${JSON.stringify(entries, null, 2)}\n`)
  for (const entry of entries) cpSync(join(PATCHES, entry.patch), join(patches, entry.patch))
  return {
    root,
    modules: join(root, 'node_modules'),
    patches,
    persist: join(persist, LIB),
    workspace: join(workspace, LIB),
  }
}

function patchEntry() {
  const entries = readJson(join(PATCHES, 'patches.json')).filter(entry => entry.patch === PATCH)
  assert.equal(entries.length, 1, `patches.json must carry exactly one ${PATCH}`)
  return entries[0]
}

// Construct the pinned JSONL backend through its plugin apply with a minimal cordis-shaped
// context. ctx.plugin runs the service descriptor, so the real backend registers itself under
// its service key; the module is imported fresh per instance with a cache-busting tag.
async function openPersistence(modulePath, sessionsRoot, tag) {
  const module = await importFile(modulePath, tag)
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
  assert.ok(instances[0], 'the pinned backend must construct')
  return instances[0]
}

// Run the real WorkspaceRegistry[Service.init] over a persistence listing. storageDomain is a
// small in-memory stand-in: activation only reads the empty state and may write workspace
// records for the valid sessions' cwds.
async function activateWorkspace(runtime, persistence, tag) {
  const { WorkspaceRegistry } = await importFile(runtime.workspace, tag)
  let state = { initialized: false, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] }
  const rows = new Map()
  const table = {
    get size() {
      return rows.size
    },
    get: id => rows.get(id),
    put: async (id, record) => {
      rows.set(id, record)
    },
    update: async (id, update) => {
      rows.set(id, update(rows.get(id)))
    },
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
  const logs = []
  const ctx = {
    sessionPersistence: persistence,
    storageDomain: { open: async () => domain },
    get: () => undefined,
    effect: () => {},
    logger: { warn: (...args) => logs.push(args.join(' ')) },
  }
  const registry = new WorkspaceRegistry(ctx)
  await registry[SERVICE_INIT]()
  return { registry, rows, state: () => state, logs }
}

// The project directory key the pinned backend uses to place one session artifact. Mirrored
// only to lay out a synthetic tree at the canonical path the identity check expects; the
// listing under test computes it itself.
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

const sourceOf = dir => join(dir, 'session.v4.jsonl')

// A synthetic current-generation session log: one header line, no real session content.
// `dirName` lets a backup copy carry the original header under a sibling folder name, and
// `headerVersion` lets a row write a header that does not match the v4 filename.
function writeSession(sessions, cwd, {
  id = HELD_ID, dirName = id, headerCwd = cwd, headerVersion = 4, extra = {},
} = {}) {
  const dir = join(sessions, projectKey(headerCwd), dirName)
  mkdirSync(dir, { recursive: true })
  const header = {
    type: 'session', version: headerVersion, id, createdAt: 1, isSeeded: false, delegationDepth: 0,
    cwd: headerCwd, ...extra,
  }
  writeFileSync(join(dir, 'session.v4.jsonl'), `${JSON.stringify(header)}\n`)
  return dir
}

function makeTree(runtime, label) {
  const sessions = join(runtime.root, `${label}-sessions`)
  const cwd = join(runtime.root, `${label}-project`)
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

async function rejectionOf(operation) {
  try {
    await operation()
  } catch (error) {
    return error
  }
  assert.fail('the operation was expected to reject')
}

// Hash every file in the tree, so a row can prove the scan rewrote nothing.
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

// Row 1: the pins and the apply.
test('row 1: the fixture bytes are the pinned before-images; the patch yields the after hash once', (t) => {
  const entry = patchEntry()
  assert.equal(entry.dsh, DSH)
  assert.deepEqual(
    entry.files.map(file => ({ package: file.package, version: file.version, file: file.file })),
    [{ package: PERSIST, version: VERSION, file: LIB }],
  )
  const [file] = entry.files
  assert.equal(file.before, BEFORE)
  assert.equal(file.after, AFTER)
  assert.match(file.before, /^[0-9a-f]{64}$/)
  assert.match(file.after, /^[0-9a-f]{64}$/)
  assert.notEqual(file.before, file.after)
  assert.equal(sha256(readFileSync(PERSIST_FIXTURE)), BEFORE, 'the persistence fixture is the pinned 0.2.2-rc.2 before-image')
  assert.equal(sha256(readFileSync(WORKSPACE_FIXTURE)), WORKSPACE_SHA256, 'the workspace fixture is the unchanged 0.2.2-rc.2 glue')
  assert.match(readFileSync(LICENSE_FIXTURE, 'utf8'), /^MIT License\n/)
  assert.ok(
    !readJson(join(PATCHES, 'patches.json')).some(item => item.files?.some(changed => changed.package === WORKSPACE)),
    'the workspace fixture is unchanged glue and must have no patches.json entry',
  )
  const patchText = readFileSync(join(PATCHES, PATCH), 'utf8')
  assert.ok(patchText.startsWith(`--- a/${PERSIST}/${LIB}\n+++ b/${PERSIST}/${LIB}\n`), patchText.slice(0, 120))
  assert.ok(patchText.includes('+const SKIPPED_SESSION_LINES = 20;'), 'the patch carries the skip-line cap')
  assert.ok(patchText.includes('this.listArtifacts(signal, { strict: true })'), 'the migration child catalog lists strictly')
  assert.ok(patchText.includes('+\t\t\tskipFlatFiles: true,\n+\t\t\tonUnreadable: () => {'), 'the root check skips only flat files and unreadable folders')
  assert.ok(patchText.includes('+\t\tif (unreadable) this.rootEncodingCheck = void 0;'), 'a root pass that skipped a folder is never cached')

  const runtime = makeRuntime(t)
  assert.equal(sha256(readFileSync(runtime.persist)), BEFORE, 'the runtime copy starts at the pinned bytes')
  const dry = patchRuntime(runtime.modules, runtime.patches, { write: false })
  assert.deepEqual(dry.map(result => ({ name: result.name, state: result.state })), [
    { name: `${PERSIST}/${LIB}`, state: 'patched' },
  ])
  assert.equal(sha256(readFileSync(runtime.persist)), BEFORE, 'a dry run must not write')
  const first = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(first.map(result => ({ name: result.name, state: result.state })), [
    { name: `${PERSIST}/${LIB}`, state: 'patched' },
  ])
  assert.equal(sha256(readFileSync(runtime.persist)), AFTER, 'applying the carried patch yields patches.json after')
  const patched = readFileSync(runtime.persist)
  const touched = statSync(runtime.persist).mtimeMs
  const second = patchRuntime(runtime.modules, runtime.patches)
  assert.deepEqual(second.map(result => result.state), ['already patched'])
  assert.deepEqual(readFileSync(runtime.persist), patched, 'a second apply must be a no-op, not a rewrite')
  assert.equal(statSync(runtime.persist).mtimeMs, touched, 'a second apply must not touch the patched file')
  assert.equal(sha256(readFileSync(PERSIST_FIXTURE)), BEFORE, 'the checked-in fixture must stay the before-image')
})

// Row 2: the strict root encoding check.
test('row 2: a zstd log under a none root still fails the root check, twice, and registry activation', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'zstd-root')
  writeSession(sessions, cwd, { id: 'plain-one' })
  const zstd = writeSession(sessions, cwd, { id: 'zstd-one' })
  renameSync(sourceOf(zstd), `${sourceOf(zstd)}.zstd`)
  const mismatch = error => error.message.includes('uses .jsonl.zstd, but this backend is configured for compression "none"')
    && error.message.includes('zstd-one')

  const unpatched = await openPersistence(runtime.persist, sessions, 'zstd-unpatched')
  const unpatchedError = await rejectionOf(() => unpatched.list())
  assert.ok(mismatch(unpatchedError), unpatchedError.message)
  const unpatchedRegistry = await rejectionOf(() => activateWorkspace(runtime, unpatched, 'zstd-workspace-unpatched'))
  assert.equal(unpatchedRegistry.message, unpatchedError.message, 'unpatched activation throws the encoding refusal')

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await openPersistence(runtime.persist, sessions, 'zstd-patched')
  const { warnings } = await withWarnings(async () => {
    const first = await rejectionOf(() => patched.list())
    const second = await rejectionOf(() => patched.list())
    assert.ok(mismatch(first), first.message)
    assert.equal(second.message, first.message, 'a refused root check must not cache OK')
    assert.equal(first.message, unpatchedError.message, 'the patched root check refuses exactly as the unpatched one')
  })
  assert.deepEqual(warnings, [], 'the encoding mismatch is a refusal, not a skipped entry')
  const patchedRegistry = await rejectionOf(() => activateWorkspace(runtime, patched, 'zstd-workspace-patched'))
  assert.equal(patchedRegistry.message, unpatchedError.message, 'the real registry activation throws on the strict root')
})

// Row 2b: the root check after construction.
test('row 2b: the root check still fails after construction when the root stops being a directory', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'late-root')
  writeSession(sessions, cwd, { id: 'late-one' })
  const unpatched = await openPersistence(runtime.persist, sessions, 'late-unpatched')
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await openPersistence(runtime.persist, sessions, 'late-patched')
  // Both backends are constructed while the root is a directory; then the root goes.
  rmSync(sessions, { recursive: true, force: true })
  writeFileSync(sessions, 'not a directory\n')
  const unpatchedError = await rejectionOf(() => unpatched.list())
  const patchedError = await rejectionOf(() => patched.list())
  assert.equal(unpatchedError.code, 'ENOTDIR')
  assert.equal(patchedError.code, 'ENOTDIR')
  assert.equal(patchedError.message, unpatchedError.message, 'the patched root fails exactly as the unpatched one')
  const { warnings } = await withWarnings(async () => {
    const unpatchedRegistry = await rejectionOf(() => activateWorkspace(runtime, unpatched, 'late-workspace-unpatched'))
    const patchedRegistry = await rejectionOf(() => activateWorkspace(runtime, patched, 'late-workspace-patched'))
    assert.equal(unpatchedRegistry.code, 'ENOTDIR')
    assert.equal(patchedRegistry.code, 'ENOTDIR')
    assert.equal(patchedRegistry.message, unpatchedRegistry.message)
  })
  assert.deepEqual(warnings, [], 'a broken root is a refusal, not a skipped project')
})

// Row 2c (#885): the same loss after a cached passing root check. The first listing passes and
// caches the check, so the refusal here comes from the tolerant listing's own root read.
test('row 2c: a cached passing root check, then the root goes: the tolerant listing still refuses', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'cached-root')
  writeSession(sessions, cwd, { id: 'cached-one' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await openPersistence(runtime.persist, sessions, 'cached-patched')
  assert.deepEqual((await patched.list()).map(snapshot => snapshot.header.id), ['cached-one'])
  assert.ok(patched.rootEncodingCheck instanceof Promise, 'the first listing cached the passing root check')
  rmSync(sessions, { recursive: true, force: true })
  writeFileSync(sessions, 'not a directory\n')
  const { warnings } = await withWarnings(async () => {
    const first = await rejectionOf(() => patched.list())
    const second = await rejectionOf(() => patched.list())
    assert.equal(first.code, 'ENOTDIR')
    assert.equal(second.code, 'ENOTDIR')
    const registry = await rejectionOf(() => activateWorkspace(runtime, patched, 'cached-workspace'))
    assert.equal(registry.code, 'ENOTDIR')
  })
  assert.deepEqual(warnings, [], 'a root lost after a cached pass is a refusal, not a skipped project')
})

// Row 3a: the named skip set.
test('row 3a: the listing skips and reports format, corruption, identity, ENOENT, ENOTDIR, EACCES and EPERM', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'skip-set')
  writeSession(sessions, cwd, { id: 'valid-one' })
  writeSession(sessions, cwd, { id: 'format-unsupported' })
  writeSession(sessions, cwd, { id: 'corrupt-one' })
  writeSession(sessions, cwd, { id: 'identity-one', dirName: 'identity-one.backup-20260101T000000' })
  writeSession(sessions, cwd, { id: 'gone-one' })
  writeSession(sessions, cwd, { id: 'notdir-one' })
  writeSession(sessions, cwd, { id: 'denied-one' })
  writeSession(sessions, cwd, { id: 'owned-one' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'skip-set-patched')
  // A synthetic tree cannot portably corrupt a header without a zstd frame, so the real
  // instance's header read throws the pinned corruption class for one folder; every other
  // folder (and the valid session) is read for real.
  const errors = await import(pathToFileURL(join(runtime.modules, '@deepseek-ai/dsh-session-persistence', 'index.js')).href)
  const corruptError = new errors.SessionPersistenceCorruptionError('session "corrupt-one": stored log is corrupt (synthetic header failure)')
  const listingFaults = new Map([
    ['gone-one', 'ENOENT'],
    ['notdir-one', 'ENOTDIR'],
    ['denied-one', 'EACCES'],
    ['owned-one', 'EPERM'],
  ])
  const resolve = persistence.resolveGenerationInDirectory.bind(persistence)
  persistence.resolveGenerationInDirectory = async (dir, signal) => {
    const code = listingFaults.get(basename(dir))
    if (code !== undefined) throw Object.assign(new Error(`${code}: synthetic listing failure for ${basename(dir)}`), { code })
    return resolve(dir, signal)
  }
  const readHeader = persistence.readGenerationHeader.bind(persistence)
  persistence.readGenerationHeader = async (selected, ...rest) => {
    if (basename(dirname(selected.sourcePath)) === 'corrupt-one') throw corruptError
    return readHeader(selected, ...rest)
  }
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.equal(warnings.length, 7, warnings.join('\n'))
  const checks = [
    ['format-unsupported', /no usable format/],
    ['corrupt-one', /stored log is corrupt/],
    ['identity-one', /corrupt session log .*header id "identity-one"/],
    ['gone-one', /ENOENT/],
    ['notdir-one', /ENOTDIR/],
    ['denied-one', /EACCES/],
    ['owned-one', /EPERM/],
  ]
  for (const [name, reason] of checks) {
    const lines = warnings.filter(line => line.includes(name))
    assert.equal(lines.length, 1, `${name} must be reported exactly once`)
    assert.match(lines[0], /^dsh-session: skipped session folder /)
    assert.match(lines[0], reason, lines[0])
  }
  const identityWarning = warnings.find(line => line.includes('identity-one'))
  assert.ok(identityWarning.endsWith(OUTSIDE_HINT), identityWarning)
  // The per-instance set keeps a second listing quiet for the same paths.
  const { value: again, warnings: repeated } = await withWarnings(() => persistence.list())
  assert.deepEqual(again.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.deepEqual(repeated, [], 'a later listing of the same paths repeats nothing')
})

// Row 3b: the warning cap.
test('row 3b: skip lines cap at 20 per instance and one summary line counts the rest', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'cap')
  writeSession(sessions, cwd, { id: 'valid-one' })
  for (let i = 0; i < 25; i++) writeFileSync(join(sessions, projectKey(cwd), `stray-${String(i).padStart(2, '0')}.jsonl`), '{}\n')
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'cap-patched')
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.equal(warnings.length, 21, warnings.join('\n'))
  assert.equal(warnings.filter(line => /^dsh-session: skipped session file /.test(line)).length, 20)
  assert.equal(warnings[20], 'dsh-session: skipped 5 more session paths without a line each (the first 20 are reported)')
  const { warnings: repeated } = await withWarnings(() => persistence.list())
  assert.deepEqual(repeated, [], 'the cap must not repeat lines or a summary on a later listing')
})

// Row 3c: the errors that are deliberately not in the skip set.
test('row 3c: EIO, EMFILE and aborts still fail the scan instead of being skipped', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'fatal')
  writeSession(sessions, cwd, { id: 'valid-one' })
  writeSession(sessions, cwd, { id: 'eio-one' })
  writeSession(sessions, cwd, { id: 'emfile-one' })
  writeSession(sessions, cwd, { id: 'abort-one' })
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')

  for (const code of ['EIO', 'EMFILE']) {
    const persistence = await openPersistence(runtime.persist, sessions, `fatal-${code}`)
    const readHeader = persistence.readGenerationHeader.bind(persistence)
    persistence.readGenerationHeader = async (selected, ...rest) => {
      if (basename(dirname(selected.sourcePath)) === `${code.toLowerCase()}-one`) {
        throw Object.assign(new Error(`${code}: synthetic header read failure`), { code })
      }
      return readHeader(selected, ...rest)
    }
    const { warnings } = await withWarnings(async () => {
      const error = await rejectionOf(() => persistence.list())
      assert.equal(error.code, code)
    })
    assert.deepEqual(warnings, [], `${code} is not a skipped entry`)
  }

  const aborted = await openPersistence(runtime.persist, sessions, 'fatal-aborted')
  const already = new AbortController()
  already.abort()
  const { warnings: abortWarnings } = await withWarnings(async () => {
    const error = await rejectionOf(() => aborted.list({ signal: already.signal }))
    assert.equal(error.name, 'AbortError')
  })
  assert.deepEqual(abortWarnings, [], 'a pre-aborted scan fails before reporting anything')

  // An abort that arrives while a skippable error is being classified must win over the skip.
  const during = await openPersistence(runtime.persist, sessions, 'fatal-during')
  const controller = new AbortController()
  const resolve = during.resolveGenerationInDirectory.bind(during)
  during.resolveGenerationInDirectory = async (dir, signal) => {
    if (basename(dir) === 'abort-one') {
      controller.abort()
      throw Object.assign(new Error('EACCES: permission denied, scandir abort-one'), { code: 'EACCES' })
    }
    return resolve(dir, signal)
  }
  const { warnings: duringWarnings } = await withWarnings(async () => {
    const error = await rejectionOf(() => during.list({ signal: controller.signal }))
    assert.equal(error.name, 'AbortError')
  })
  assert.deepEqual(duringWarnings, [], 'an abort is not converted into a skip line')
})

// Row 4: the root-check boundary (#885).
test('row 4: an unreadable folder is skipped at the root check, which never caches that pass', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'boundary')
  writeSession(sessions, cwd, { id: 'valid-one' })
  const lockedDir = writeSession(sessions, cwd, { id: 'locked-one' })
  const unreadable = dir => Object.assign(new Error(`EACCES: permission denied, scandir '${basename(dir)}'`), { code: 'EACCES' })
  // Every read of the folder by the real instance fails until the returned switch is turned off.
  const lockFolder = (persistence) => {
    const state = { locked: true }
    for (const method of ['findOppositeGenerationInDirectory', 'resolveGenerationInDirectory']) {
      const real = persistence[method].bind(persistence)
      persistence[method] = async (dir, ...rest) => {
        if (state.locked && basename(dir) === 'locked-one') throw unreadable(dir)
        return real(dir, ...rest)
      }
    }
    return state
  }

  const unpatched = await openPersistence(runtime.persist, sessions, 'boundary-unpatched')
  lockFolder(unpatched)
  const unpatchedError = await rejectionOf(() => unpatched.list())
  assert.equal(unpatchedError.code, 'EACCES')
  const unpatchedRegistry = await rejectionOf(() => activateWorkspace(runtime, unpatched, 'boundary-workspace-unpatched'))
  assert.equal(unpatchedRegistry.code, 'EACCES', 'unpatched, the registry does not activate')

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const checked = await openPersistence(runtime.persist, sessions, 'boundary-patched')
  const lock = lockFolder(checked)
  const first = await withWarnings(() => activateWorkspace(runtime, checked, 'boundary-workspace-patched'))
  assert.deepEqual([...first.value.registry.headers.keys()], ['valid-one'], 'the registry activates over the readable session')
  assert.equal(first.value.state().initialized, true)
  assert.equal(first.warnings.length, 1, first.warnings.join('\n'))
  assert.ok(first.warnings[0].includes('locked-one'), first.warnings[0])
  assert.match(first.warnings[0], /^dsh-session: skipped session folder .*EACCES/)
  assert.equal(checked.rootEncodingCheck, undefined, 'a pass that skipped a folder is not cached')
  const again = await withWarnings(() => checked.list())
  assert.deepEqual(again.value.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.deepEqual(again.warnings, [], 'the folder is reported once per backend instance')

  // Never a cached OK: the folder turns readable holding the other compression, and the next
  // call refuses the root exactly as a root that never had an unreadable folder.
  renameSync(sourceOf(lockedDir), `${sourceOf(lockedDir)}.zstd`)
  lock.locked = false
  const refused = await withWarnings(async () => {
    const error = await rejectionOf(() => checked.list())
    assert.ok(error.message.includes('uses .jsonl.zstd, but this backend is configured for compression "none"'), error.message)
    assert.ok(error.message.includes('locked-one'), error.message)
    assert.equal((await rejectionOf(() => checked.list())).message, error.message)
  })
  assert.deepEqual(refused.warnings, [], 'the mismatch is a refusal, not a skipped folder')
  renameSync(`${sourceOf(lockedDir)}.zstd`, sourceOf(lockedDir))

  // A pass that skipped nothing is cached; the same folder failure after it is the listing's skip.
  const late = await openPersistence(runtime.persist, sessions, 'boundary-late')
  assert.deepEqual(
    (await late.list()).map(snapshot => snapshot.header.id).sort(),
    ['locked-one', 'valid-one'],
    'the first listing passes the root check',
  )
  const cached = late.rootEncodingCheck
  assert.ok(cached instanceof Promise, 'a clean pass is cached')
  lockFolder(late)
  const skipped = await withWarnings(() => late.list())
  assert.deepEqual(skipped.value.map(snapshot => snapshot.header.id), ['valid-one'])
  assert.equal(skipped.warnings.length, 1, skipped.warnings.join('\n'))
  assert.ok(skipped.warnings[0].includes('locked-one'), skipped.warnings[0])
  assert.match(skipped.warnings[0], /EACCES/)
  assert.equal(late.rootEncodingCheck, cached, 'the cached pass is kept')
})

// Row 5a: the duplicate pick.
test('row 5a: a duplicate id keeps the copy first in sorted sourcePath order, not arrival order', async (t) => {
  const runtime = makeRuntime(t)
  const sessions = join(runtime.root, 'duplicate-sessions')
  const cwdA = join(runtime.root, 'duplicate-project-a')
  const cwdB = join(runtime.root, 'duplicate-project-b')
  mkdirSync(sessions, { recursive: true })
  mkdirSync(cwdA, { recursive: true })
  mkdirSync(cwdB, { recursive: true })
  const dirA = writeSession(sessions, cwdA, { id: 'dup-one' })
  const dirB = writeSession(sessions, cwdB, { id: 'dup-one' })
  const sourceA = sourceOf(dirA)
  const sourceB = sourceOf(dirB)
  const kept = sourceA < sourceB ? sourceA : sourceB
  const dropped = kept === sourceA ? sourceB : sourceA

  const unpatched = await openPersistence(runtime.persist, sessions, 'duplicate-unpatched')
  const unpatchedError = await rejectionOf(() => unpatched.list())
  assert.match(unpatchedError.message, /^duplicate JSONL session id "dup-one" appears in multiple project directories$/)

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  // readdir order is the filesystem's, so each pass hands the listing the same generations in
  // one order and then the reverse; the pick must stay the sorted first either way.
  for (const [tag, order] of [['forward', list => list], ['reverse', list => [...list].reverse()]]) {
    const persistence = await openPersistence(runtime.persist, sessions, `duplicate-${tag}`)
    const listGenerations = persistence.listGenerations.bind(persistence)
    persistence.listGenerations = async (...args) => order(await listGenerations(...args))
    const { value: artifacts, warnings } = await withWarnings(() => persistence.listArtifacts())
    assert.equal(artifacts.length, 1, tag)
    assert.equal(artifacts[0].path, kept, `${tag}: the sorted first copy is kept`)
    assert.equal(warnings.length, 1, tag)
    assert.ok(warnings[0].includes(jsonPath(dirname(dropped))), `${tag}: ${warnings[0]}`)
    assert.match(warnings[0], /duplicate session id "dup-one" \(kept ".*"\)/)
    assert.ok(warnings[0].endsWith(OUTSIDE_HINT), warnings[0])
  }
})

// Row 5b: the migration child catalog stays strict.
test('row 5b: the migration child catalog still lists strictly, so a skipped child cannot drop out', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'migration')
  const parent = writeSession(sessions, cwd, { id: 'parent-one' })
  writeSession(sessions, cwd, {
    id: 'child-one',
    dirName: 'child-one.backup-20260101T000000',
    extra: { origin: 'subagent', parentSession: 'parent-one' },
  })
  const selected = {
    sourcePath: sourceOf(parent),
    sourceVersion: 4,
    currentPath: sourceOf(parent),
  }
  const childIdentity = /corrupt session log .*header id "child-one"/

  const unpatched = await openPersistence(runtime.persist, sessions, 'migration-unpatched')
  const unpatchedList = await rejectionOf(() => unpatched.list())
  assert.match(unpatchedList.message, childIdentity)
  const unpatchedMigration = await rejectionOf(
    () => unpatched.prepareStoredMigration('parent-one', selected, new AbortController().signal),
  )
  assert.match(unpatchedMigration.message, childIdentity)

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'migration-patched')
  const { value: listed, warnings } = await withWarnings(() => persistence.list())
  assert.deepEqual(listed.map(snapshot => snapshot.header.id), ['parent-one'], 'the tolerant listing skips the child')
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes('child-one'), warnings[0])
  // prepareStoredMigration's children() lists strictly, so the child cannot silently drop out
  // of the parent's catalog: the migration refuses exactly as the unpatched one does.
  const { warnings: strictWarnings } = await withWarnings(async () => {
    const error = await rejectionOf(
      () => persistence.prepareStoredMigration('parent-one', selected, new AbortController().signal),
    )
    assert.match(error.message, childIdentity)
  })
  assert.deepEqual(strictWarnings, [], 'the strict catalog does not report a skip')
})

// Row 5c: one genuinely fatal header still fails.
test('row 5c: a filename/header version mismatch is still fatal to the listing', async (t) => {
  const runtime = makeRuntime(t)
  const { sessions, cwd } = makeTree(runtime, 'fatal-version')
  writeSession(sessions, cwd, { id: 'valid-one' })
  writeSession(sessions, cwd, { id: 'mismatch-one', headerVersion: 3 })
  const mismatch = /session generation filename identifies v4, but its header identifies v3/

  const unpatched = await openPersistence(runtime.persist, sessions, 'fatal-version-unpatched')
  assert.match((await rejectionOf(() => unpatched.list())).message, mismatch)

  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const persistence = await openPersistence(runtime.persist, sessions, 'fatal-version-patched')
  const { warnings } = await withWarnings(async () => {
    assert.match((await rejectionOf(() => persistence.list())).message, mismatch)
  })
  assert.deepEqual(warnings, [], 'a version mismatch is a refusal, not a skipped folder')
})

// The held tree: one valid session, a backup-shaped sibling, a stray flat file and a duplicate
// id. The duplicate is a second valid copy of the same session under a second project, so the
// patched scan keeps exactly one session and the registry groups it once.
function buildHeldTree(base, { backup = true, stray = true, duplicate = true } = {}) {
  const sessions = join(base, 'sessions')
  const cwdOne = join(base, 'project-one')
  const cwdTwo = join(base, 'project-two')
  mkdirSync(sessions, { recursive: true })
  mkdirSync(cwdOne, { recursive: true })
  const valid = writeSession(sessions, cwdOne, { id: HELD_ID })
  const backupDir = backup ? writeSession(sessions, cwdOne, { id: HELD_ID, dirName: BACKUP_NAME }) : undefined
  const strayPath = stray ? join(sessions, projectKey(cwdOne), STRAY_NAME) : undefined
  if (strayPath !== undefined) writeFileSync(strayPath, '{"stray": true}\n')
  let duplicateDir
  if (duplicate) {
    mkdirSync(cwdTwo, { recursive: true })
    duplicateDir = writeSession(sessions, cwdTwo, { id: HELD_ID })
  }
  const validSource = sourceOf(valid)
  const duplicateSource = duplicateDir === undefined ? validSource : sourceOf(duplicateDir)
  const keptSource = validSource <= duplicateSource ? validSource : duplicateSource
  const droppedSource = keptSource === validSource ? duplicateSource : validSource
  return {
    sessions,
    cwdOne,
    cwdTwo,
    validSource,
    duplicateSource,
    keptSource,
    droppedSource,
    keptCwd: keptSource === validSource ? cwdOne : cwdTwo,
    backupDir,
    strayPath,
  }
}

// Row 6: the held tree, end to end.
test('row 6: the held tree skips and reports each bad entry, the real registry activates, nothing is rewritten', async (t) => {
  const runtime = makeRuntime(t)

  // Fail-before on the pinned bytes, each invalid entry in isolation: the exact error is
  // recorded so the repaired patch's skip can be contrasted with the unpatched scan.
  const isolatedRoot = join(runtime.root, 'fail-before')
  mkdirSync(isolatedRoot)
  const isolated = {
    backup: buildHeldTree(join(isolatedRoot, 'backup'), { stray: false, duplicate: false }),
    stray: buildHeldTree(join(isolatedRoot, 'stray'), { backup: false, duplicate: false }),
    duplicate: buildHeldTree(join(isolatedRoot, 'duplicate'), { backup: false, stray: false }),
  }
  const isolatedErrors = {}
  for (const [name, tree] of Object.entries(isolated)) {
    const backend = await openPersistence(runtime.persist, tree.sessions, `held-isolated-${name}`)
    isolatedErrors[name] = (await rejectionOf(() => backend.list())).message
  }
  assert.match(isolatedErrors.backup, /^corrupt session log .*header id "held-session"/)
  assert.match(isolatedErrors.stray, /flat-file layout/)
  assert.ok(isolatedErrors.stray.includes(STRAY_NAME), isolatedErrors.stray)
  assert.match(isolatedErrors.duplicate, /^duplicate JSONL session id "held-session"/)

  // The combined tree: the unpatched scan and the real registry activation both throw.
  const held = buildHeldTree(join(runtime.root, 'held'))
  const before = snapshotTree(held.sessions)
  const unpatched = await openPersistence(runtime.persist, held.sessions, 'held-unpatched')
  const scanError = await rejectionOf(() => unpatched.list())
  assert.match(scanError.message, /flat-file layout/)
  assert.ok(scanError.message.includes(STRAY_NAME), scanError.message)
  const registryError = await rejectionOf(() => activateWorkspace(runtime, unpatched, 'held-workspace-unpatched'))
  assert.equal(registryError.message, scanError.message, 'unpatched activation dies on the same scan throw')

  // The repaired patch: every invalid entry is skipped and reported; the valid session stays.
  assert.equal(patchRuntime(runtime.modules, runtime.patches)[0].state, 'patched')
  const patched = await openPersistence(runtime.persist, held.sessions, 'held-patched')
  const scan = await withWarnings(() => patched.list())
  assert.deepEqual(scan.value.map(snapshot => snapshot.header.id), [HELD_ID])
  assert.equal(scan.value[0].location.path, held.keptSource, 'the sorted first duplicate copy is the one listed')
  assert.equal(scan.warnings.length, 3, scan.warnings.join('\n'))
  const backupWarning = scan.warnings.find(line => line.includes(BACKUP_NAME))
  assert.ok(backupWarning, scan.warnings.join('\n'))
  assert.match(backupWarning, /corrupt session log .*header id "held-session"/)
  assert.ok(backupWarning.includes('session-backups/'), backupWarning)
  assert.ok(backupWarning.endsWith(OUTSIDE_HINT), backupWarning)
  const strayWarning = scan.warnings.find(line => line.includes(STRAY_NAME))
  assert.ok(strayWarning, scan.warnings.join('\n'))
  assert.match(strayWarning, /flat-file layout/)
  assert.ok(strayWarning.endsWith(OUTSIDE_HINT), strayWarning)
  const duplicateWarning = scan.warnings.find(line => line.includes('duplicate session id'))
  assert.ok(duplicateWarning, scan.warnings.join('\n'))
  assert.ok(duplicateWarning.includes(jsonPath(dirname(held.droppedSource))), duplicateWarning)
  assert.ok(duplicateWarning.includes(jsonPath(dirname(held.keptSource))), duplicateWarning)
  assert.ok(duplicateWarning.endsWith(OUTSIDE_HINT), duplicateWarning)

  // The real registry activates over the patched listing and groups the kept session.
  const activated = await withWarnings(() => activateWorkspace(runtime, patched, 'held-workspace-patched'))
  assert.deepEqual([...activated.value.registry.headers.keys()], [HELD_ID])
  assert.equal(activated.value.registry.entities.size, 1, 'the registry activates and groups the kept session once')
  assert.equal(await realpath(activated.value.registry.sessionPaths.get(HELD_ID)), await realpath(held.keptCwd))
  assert.equal(activated.value.state().initialized, true)
  assert.deepEqual(activated.value.logs, [])
  assert.deepEqual(activated.warnings, [], 'the same backend instance reports each skipped path only once')
  assert.deepEqual(snapshotTree(held.sessions), before, 'the scan and activation must leave every file byte-identical')
})
