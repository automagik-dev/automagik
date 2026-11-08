// The home file's shown[] picks for Pocket chat (shown.js), on a temp file: never the person's
// ~/.automagik.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { homeRegistryPathOf, shownReader } from '../src/host/shown.js'

const A = 'b-aaaaaaaaaa'
const B = 'b-bbbbbbbbbb'

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'shown-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'bots.json')
  const write = (shown, bots = []) => writeFileSync(path, JSON.stringify({ version: 2, bots, projects: [], shown }))
  return { dir, path, write }
}

test('the home file is $AUTOMAGIK_HOME/bots/bots.json', () => {
  assert.equal(homeRegistryPathOf({ AUTOMAGIK_HOME: '/srv/am' }), '/srv/am/bots/bots.json')
})

test('an entry grants its listed ids only', (t) => {
  const h = home(t)
  h.write([{ project: '/repo/a', bots: [A] }])
  const { shown } = shownReader({ path: h.path })
  assert.equal(shown({ id: A, project: '/repo/a' }), true)
  assert.equal(shown({ id: B, project: '/repo/a' }), false)
})

test('a global Bot needs no entry, even with no file or a broken one', (t) => {
  const h = home(t)
  assert.equal(shownReader({ path: h.path }).shown({ id: A, project: null }), true)
  writeFileSync(h.path, 'nope')
  assert.equal(shownReader({ path: h.path }).shown({ id: A }), true)
})

test('two projects with the same id do not cross-grant', (t) => {
  const h = home(t)
  h.write([{ project: '/repo/a', bots: [A] }])
  const { shown } = shownReader({ path: h.path })
  assert.equal(shown({ id: A, project: '/repo/b' }), false)
})

test('a pick on one machine does not grant the same folder on another, or on this computer', (t) => {
  const h = home(t)
  h.write([{ project: '/repo/a', machine: 'box-1', bots: [A] }])
  const { shown } = shownReader({ path: h.path })
  assert.equal(shown({ id: A, project: '/repo/a', machine: 'box-1' }), true)
  assert.equal(shown({ id: A, project: '/repo/a', machine: 'box-2' }), false)
  assert.equal(shown({ id: A, project: '/repo/a' }), false)
})

test('no file: no project Bot is shown', (t) => {
  const h = home(t)
  const reader = shownReader({ path: h.path })
  assert.equal(reader.shown({ id: A, project: '/repo/a' }), false)
  assert.deepEqual([...reader.places()], [])
})

test('a parse error or an unreadable file fails closed for project Bots', (t) => {
  const h = home(t)
  for (const text of ['{ not json', JSON.stringify({ version: 1, bots: [] }), JSON.stringify({ version: 2 })]) {
    writeFileSync(h.path, text)
    const warns = []
    const reader = shownReader({ path: h.path, warn: (...args) => warns.push(args) })
    assert.equal(reader.shown({ id: A, project: '/repo/a' }), false, text)
    assert.equal(reader.places(), null, 'places unknown')
    assert.equal(warns.length, 1)
  }
  // A folder where the file should be: unreadable (EISDIR).
  rmSync(h.path)
  mkdirSync(h.path)
  const reader = shownReader({ path: h.path })
  assert.equal(reader.shown({ id: A, project: '/repo/a' }), false)
  assert.equal(reader.places(), null)
  assert.equal(reader.shown({ id: A, project: '/repo/a', placeUnknown: true }), false)
})

test('a broken file after a good read serves the last good read, with one warn', (t) => {
  const h = home(t)
  h.write([{ project: '/repo/a', bots: [A] }], [{ id: A, name: 'A', folder: '/repo/a' }])
  const warns = []
  const reader = shownReader({ path: h.path, warn: (...args) => warns.push(args) })
  assert.equal(reader.shown({ id: A, project: '/repo/a' }), true)
  writeFileSync(h.path, '{ broken')
  assert.equal(reader.shown({ id: A, project: '/repo/a' }), true)
  assert.equal(reader.places().get(A).folder, '/repo/a')
  assert.equal(warns.length, 1, 'once for the same error')
  // The file removed: no picks, and the last good read no longer stands in.
  rmSync(h.path)
  assert.equal(reader.shown({ id: A, project: '/repo/a' }), false)
})

test('a yes taken back holds at the next read', (t) => {
  const h = home(t)
  h.write([{ project: '/repo/a', bots: [A] }])
  const { shown } = shownReader({ path: h.path })
  assert.equal(shown({ id: A, project: '/repo/a' }), true)
  h.write([])
  assert.equal(shown({ id: A, project: '/repo/a' }), false)
})

test('folder and machine from the home bots[] are each Bot\'s place', (t) => {
  const h = home(t)
  h.write([], [{ id: A, name: 'A', folder: '/repo/a', machine: 'box-1' }, { id: B, name: 'B' }])
  assert.deepEqual([...shownReader({ path: h.path }).places()], [[A, { folder: '/repo/a', machine: 'box-1' }]])
})

// ---- registry ids (#672): the Herdr Bot a DSH Bot is, for Pocket to join dsh:<sessionId> to it

const SESSION = 'session-11111111-1111-1111-1111-111111111111'
const SESSION2 = 'session-22222222-2222-2222-2222-222222222222'
const C = 'b-cccccccccc'

/** A home file with any body (the helper above fixes projects[] to none). */
const homeBody = (path, body) => writeFileSync(path, JSON.stringify({ version: 2, bots: [], projects: [], shown: [], ...body }))
/** A project's repo file, where the registry reader looks for it. */
const repoFile = (folder, bots) => {
  mkdirSync(join(folder, '.automagik', 'bots'), { recursive: true })
  writeFileSync(join(folder, '.automagik', 'bots', 'bots.json'), JSON.stringify({ version: 2, bots, projects: [], shown: [] }))
}

test('a DSH Bot links to the registry Bot with the same id first (#672)', (t) => {
  const h = home(t)
  h.write([], [{ id: A, name: 'Ada', folder: '/repo/a' }, { id: B, name: 'Bea', folder: '/repo/b' }])
  const reader = shownReader({ path: h.path })
  // The same id is the link DSH's own export keeps; a name or a folder never overrides it.
  assert.equal(reader.registryIdOf({ id: A, name: 'Someone else', project: '/repo/z' }), A)
})

test('a unique name links inside its own project only (#672)', (t) => {
  const h = home(t)
  h.write([], [{ id: A, name: 'Ada', folder: '/repo/a' }, { id: B, name: 'Bea', folder: '/repo/b' }])
  const reader = shownReader({ path: h.path })
  // The name link is trimmed and case-insensitive inside the Bot's own project.
  assert.equal(reader.registryIdOf({ id: SESSION, name: ' ada ', project: '/repo/a' }), A)
  // A single same-named Bot in ANOTHER project must not be linked cross-project (the review fix).
  assert.equal(reader.registryIdOf({ id: SESSION, name: 'Ada', project: '/repo/b' }), null)
  // A global Bot (no project) links one same-named Bot.
  assert.equal(reader.registryIdOf({ id: SESSION, name: 'Ada' }), A)
})

test('two namesakes give null, and a project narrows to its own (#672)', (t) => {
  const h = home(t)
  h.write([], [{ id: A, name: 'Ada', folder: '/repo/a' }, { id: B, name: 'Ada', folder: '/repo/b' }])
  const reader = shownReader({ path: h.path })
  assert.equal(reader.registryIdOf({ id: SESSION, name: 'Ada' }), null)
  assert.equal(reader.registryIdOf({ id: SESSION, name: 'Ada', project: '/repo/b' }), B)
  assert.equal(reader.registryIdOf({ id: SESSION, name: 'Ada', project: '/repo/z' }), null)
})

test('a session-<uuid> entry is never served as a registry id (#672)', (t) => {
  const h = home(t)
  h.write([], [{ id: SESSION, name: 'Ada', folder: '/repo/a' }])
  const reader = shownReader({ path: h.path })
  // The session id is DSH's own; only Herdr's b- ids are the key Pocket joins by.
  assert.equal(reader.registryIdOf({ id: SESSION, name: 'Ada', project: '/repo/a' }), null)
  assert.equal(reader.registryIdOf({ id: SESSION2, name: 'Ada' }), null)
})

test("another machine's registry entry contributes nothing (#672)", (t) => {
  const h = home(t)
  h.write([], [{ id: A, name: 'Ada', folder: '/repo/a', machine: 'box-1' }])
  assert.equal(shownReader({ path: h.path }).registryIdOf({ id: SESSION, name: 'Ada' }), null)
})

test("a project repo file links a universal Bot, and another machine's or a relative folder does not (#672)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shown-repo-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const folder = join(dir, 'project')
  mkdirSync(folder)
  repoFile(folder, [{ id: C, name: 'Main', folder }])
  const h = home(t)
  homeBody(h.path, { projects: [{ folder }] })
  // A universal Bot is the project's main Bot under a b- id in its repo file.
  assert.equal(shownReader({ path: h.path }).registryIdOf({ id: SESSION, name: 'main', project: folder }), C)
  // Another machine's project file is not readable here.
  homeBody(h.path, { projects: [{ folder, machine: 'box-1' }] })
  assert.equal(shownReader({ path: h.path }).registryIdOf({ id: SESSION, name: 'Main', project: folder }), null)
  // A relative folder has no root to read from.
  homeBody(h.path, { projects: [{ folder: 'relative/project' }] })
  assert.equal(shownReader({ path: h.path }).registryIdOf({ id: SESSION, name: 'Main' }), null)
})

test('an unreadable or missing repo file and a missing home file give null (#672)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shown-gone-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const folder = join(dir, 'project')
  mkdirSync(folder)
  const h = home(t)
  homeBody(h.path, { projects: [{ folder }] })
  // No repo file yet: nothing to link.
  assert.equal(shownReader({ path: h.path }).registryIdOf({ id: SESSION, name: 'Main', project: folder }), null)
  // A repo file that does not parse contributes nothing.
  mkdirSync(join(folder, '.automagik', 'bots'), { recursive: true })
  writeFileSync(join(folder, '.automagik', 'bots', 'bots.json'), 'not json')
  assert.equal(shownReader({ path: h.path }).registryIdOf({ id: SESSION, name: 'Main', project: folder }), null)
  // A missing home file links nothing.
  assert.equal(shownReader({ path: join(dir, 'missing.json') }).registryIdOf({ id: SESSION, name: 'Main' }), null)
})
