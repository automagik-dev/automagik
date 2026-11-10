import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { DRAFT_MAX_BYTES, DRAFT_PREFIX, DRAFTS_MAX_BYTES, draftEntries, PAGE_DRAFTS, draftsFileOf, readDrafts, saveDrafts, takeDrafts } from '../src/drafts.js'

const A = 'http://127.0.0.1:41001'
const B = 'http://127.0.0.1:41002'
const entry = draft => JSON.stringify({ draft, view: null, viewRequest: null })
const fresh = () => draftsFileOf(mkdtempSync(join(tmpdir(), 'automagik-drafts-')))

test('the copy is DSH\'s own keys and strings, in the app\'s home, written whole for this user only', () => {
  const file = fresh()
  assert.equal(DRAFT_PREFIX, 'dsh.conversation.')
  assert.equal(readDrafts(file), null)
  const entries = { 'dsh.conversation.s1': entry('hello'), 'dsh.conversation.s2': entry({ text: 'two', references: [] }) }
  assert.equal(saveDrafts(file, A, entries), true)
  assert.deepEqual(readDrafts(file), { origin: A, entries })
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(join(file, '..')), ['drafts.json'], 'no temporary file left')
})

test('long Unicode and IME text comes back byte for byte, each Session under its own key', () => {
  const file = fresh()
  const long = `${'ação 😀 日本語 한글 ́e\n'.repeat(4000)}fim`
  const entries = { 'dsh.conversation.a': entry(long), 'dsh.conversation.b': entry('other') }
  assert.equal(saveDrafts(file, A, entries), true)
  assert.deepEqual(takeDrafts(file, B), { moved: true, entries })
  assert.equal(JSON.parse(readDrafts(file).entries['dsh.conversation.a']).draft, long)
})

test('what is not a page\'s drafts is refused, and the earlier copy stays', () => {
  const file = fresh()
  const good = { 'dsh.conversation.s1': entry('kept') }
  saveDrafts(file, A, good)
  const refused = [
    [A, null], [A, 'text'], [A, []], [A, { 'dsh.keybindings.v1': '{}' }], [A, { 'dsh.conversation.': '{}' }],
    [A, { 'dsh.conversation.s1': 7 }], [A, { 'dsh.conversation.s1': { draft: 'x' } }],
    ['https://evil.example', good], ['http://127.0.0.1', good], ['http://127.0.0.1:1/x', good], [undefined, good],
  ]
  for (const [origin, entries] of refused) {
    assert.equal(saveDrafts(file, origin, entries), false, JSON.stringify([origin, typeof entries]))
    assert.deepEqual(readDrafts(file), { origin: A, entries: good })
  }
  assert.equal(draftEntries({ __proto__: null, 'dsh.conversation.s1': 'v' })['dsh.conversation.s1'], 'v')
})

test('a copy that is not one reads as none, and nothing comes back from it', () => {
  const file = fresh()
  for (const text of ['', 'not json', 'null', '[]', '{"origin":"x","entries":{}}', `{"origin":"${A}","entries":{"other":"v"}}`, `{"origin":"${A}"}`]) {
    writeFileSync(file, text)
    assert.equal(readDrafts(file), null, text)
    assert.deepEqual(takeDrafts(file, B), { moved: false, entries: {} })
  }
})

test('an entry too large to keep is left out, and the others are still kept', () => {
  const file = fresh()
  const small = { 'dsh.conversation.s1': entry('kept'), 'dsh.conversation.s2': entry('also kept') }
  assert.equal(saveDrafts(file, A, { 'dsh.conversation.s1': small['dsh.conversation.s1'], 'dsh.conversation.big': entry('x'.repeat(DRAFT_MAX_BYTES)), 'dsh.conversation.s2': small['dsh.conversation.s2'] }), true)
  assert.deepEqual(readDrafts(file), { origin: A, entries: small })
  // Many entries: the copy stops growing at its limit, and what fits is kept.
  const many = {}
  const each = entry('y'.repeat(200 * 1024))
  for (let i = 0; i < 20; i++) many[`dsh.conversation.m${i}`] = each
  many['dsh.conversation.last'] = entry('small, still fits')
  assert.equal(saveDrafts(file, A, many), true)
  const kept = readDrafts(file).entries
  const size = Object.entries(kept).reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(value), 0)
  assert.ok(size <= DRAFTS_MAX_BYTES)
  assert.ok(Object.keys(kept).length >= 9 && Object.keys(kept).length < 21)
  assert.equal(kept['dsh.conversation.last'], entry('small, still fits'))
})

test('on the same origin the copy only fills in what the page lost, and is left as it is', () => {
  const file = fresh()
  const entries = { 'dsh.conversation.s1': entry('typed') }
  saveDrafts(file, A, entries)
  const before = readFileSync(file, 'utf8')
  assert.deepEqual(takeDrafts(file, A), { moved: false, entries })
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.deepEqual(takeDrafts(file, 'not an origin'), { moved: false, entries: {} })
  assert.deepEqual(takeDrafts(fresh(), A), { moved: false, entries: {} }, 'no copy yet')
})

test('on another origin the drafts replace the page\'s, and the copy is that origin\'s from then on', () => {
  const file = fresh()
  const entries = { 'dsh.conversation.s1': entry('unsent') }
  saveDrafts(file, A, entries)
  assert.deepEqual(takeDrafts(file, B), { moved: true, entries })
  assert.deepEqual(readDrafts(file), { origin: B, entries })
  // The page loads again on B (a reload, the next start): its own storage rules from here.
  assert.deepEqual(takeDrafts(file, B), { moved: false, entries })
})

test('the script main runs in the page reads only DSH\'s draft entries', () => {
  const items = new Map(Object.entries({
    'dsh.conversation.s1': entry('mine'), 'dsh.conversation.contentWidth': '720', 'dsh.keybindings.v1': '{"draft":1}',
    'dsh.conversation.bad': 'not json', 'dsh.conversation.null': 'null', 'omni-ui:prefs': '{}',
  }))
  const localStorage = { get length() { return items.size }, key: i => [...items.keys()][i] ?? null, getItem: key => items.get(key) ?? null }
  const read = vm.runInContext(PAGE_DRAFTS, vm.createContext({ localStorage }))
  assert.deepEqual({ ...read }, { 'dsh.conversation.s1': entry('mine') })
  assert.deepEqual(draftEntries(read), { 'dsh.conversation.s1': entry('mine') })
})

// A page's storage per origin, and the preload's part (take at start, then send what it has).
function app(file) {
  const storages = new Map()
  return {
    storages,
    start(origin, { lost = false } = {}) {
      if (!storages.has(origin)) storages.set(origin, {})
      const storage = storages.get(origin)
      // Chromium had not written this origin's storage when the app went down.
      if (lost) for (const key of Object.keys(storage)) delete storage[key]
      const back = takeDrafts(file, origin)
      for (const [key, value] of Object.entries(back.entries)) if (back.moved || !(key in storage)) storage[key] = value
      saveDrafts(file, origin, { ...storage })
      return {
        storage,
        type(id, text) { storage[`${DRAFT_PREFIX}${id}`] = entry(text); saveDrafts(file, origin, { ...storage }) },
      }
    },
  }
}
const draftOf = (page, id) => JSON.parse(page.storage[`${DRAFT_PREFIX}${id}`] ?? '{"draft":null}').draft

test('a restart on another port: the drafts follow; a sent one stays sent; back on the first port the newest wins', () => {
  const desk = app(fresh())
  let page = desk.start(A)
  page.type('s1', 'first draft')
  page.type('s2', 'second draft')
  // The port was taken: the page starts on B with an empty storage of its own.
  page = desk.start(B)
  assert.equal(draftOf(page, 's1'), 'first draft')
  assert.equal(draftOf(page, 's2'), 'second draft')
  // s1 is sent (DSH stores an empty draft), s3 is new; a restart on the same port keeps both.
  page.type('s1', '')
  page.type('s3', 'third draft')
  page = desk.start(B)
  assert.equal(draftOf(page, 's1'), '')
  assert.equal(draftOf(page, 's3'), 'third draft')
  // Back on A, whose storage still holds the old s1: B's state is the newer one.
  page = desk.start(A)
  assert.equal(draftOf(page, 's1'), '', 'a sent draft is not brought back by the old origin')
  assert.equal(draftOf(page, 's2'), 'second draft')
  assert.equal(draftOf(page, 's3'), 'third draft')
})

test('drafts put back whose storage was then lost are filled in again on the same origin, not wiped from the copy', () => {
  const desk = app(fresh())
  let page = desk.start(A)
  page.type('s1', 'first draft')
  page = desk.start(B)
  assert.equal(draftOf(page, 's1'), 'first draft')
  page = desk.start(B, { lost: true })
  assert.equal(draftOf(page, 's1'), 'first draft')
  // What the page still has is never replaced on the same origin.
  page.type('s1', '')
  page = desk.start(B)
  assert.equal(draftOf(page, 's1'), '')
})
