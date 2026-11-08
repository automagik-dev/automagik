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
