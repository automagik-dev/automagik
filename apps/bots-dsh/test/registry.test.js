import assert from 'node:assert/strict'
import fs from 'node:fs'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  BOT_ID, checkRegistry, dropBot, dropLock, emptyRegistry, indentOf, isBotId, newBotId, parseRegistry, putBot,
  readRegistryText, takeLock, updateRegistry, writeRegistry,
} from '../src/shared/registry.js'

const ID = { main: 'b-mainmain22', dev: 'b-devdevdev3', dsh: 'session-0b3c1f9e-4d1a-4c55-9a7e-2f6b8d1e0a77' }
const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-registry-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))
  return dir
}
const repoFile = () => ({
  version: 2,
  name: 'Automagik',
  categories: [{ id: 'core', title: 'Core' }],
  bots: [
    { id: ID.main, name: 'Captain', role: 'leads', instructions: 'Lead.', main: true, agent: 'claude', rank: 'captain' },
    { id: ID.dev, name: 'Dev', role: 'builds', instructions: '', agent: 'codex', lead: ID.main, category: 'core' },
  ],
})
const homeFile = () => ({
  version: 2,
  bots: [
    { id: ID.dsh, name: 'Omni', role: '', instructions: 'Hi.', main: true, identity: 'omni',
      pet: { source: 'builtin', id: 'genie-clay' }, dsh: { model: 'deepseek/v4', effort: 'high', color: 'teal' } },
    { id: ID.main, name: 'Remote', folder: '/srv/repo', machine: 'khal-labs' },
  ],
  projects: [{ folder: '/Users/me/repo' }, { folder: '/srv/repo', machine: 'g9' }],
  shown: [{ project: null, bots: [ID.dsh] }, { project: '/Users/me/repo', bots: [ID.main] }],
})
const text = (raw, indent = 2) => `${JSON.stringify(raw, null, indent)}\n`

test('ids: newBotId mints b- plus 10 base32, and both shapes are accepted', () => {
  for (let i = 0; i < 1000; i += 1) assert.match(newBotId(), /^b-[a-z2-7]{10}$/)
  assert.equal(newBotId(() => 0), 'b-aaaaaaaaaa')
  assert.equal(newBotId(() => 0.999999), 'b-7777777777')
  assert.ok(isBotId(ID.main))
  assert.ok(isBotId(ID.dsh))
  assert.ok(BOT_ID.test(`session-${crypto.randomUUID()}`))
  for (const bad of ['unfold-root', 'b-short', 'b-ABCDEFGHIJ', 'b-0123456789', 'session-xyz', 'session-1234', '', null, 7]) {
    assert.equal(isBotId(bad), false, String(bad))
  }
})

test('parse: a good repo file and a good home file read as written', () => {
  const repo = parseRegistry(text(repoFile()), { kind: 'repo' })
  assert.deepEqual(repo.warnings, [])
  assert.deepEqual(repo.file, repoFile())
  assert.equal(repo.indent, '  ')
  const home = parseRegistry(text(homeFile()), { kind: 'home' })
  assert.deepEqual(home.warnings, [])
  assert.deepEqual(home.file.bots.map(b => b.id), [ID.dsh, ID.main])
  assert.equal(home.file.bots[1].machine, 'khal-labs')
  assert.deepEqual(home.file.shown, homeFile().shown)
  assert.deepEqual(checkRegistry(repo.file, { kind: 'repo' }), [])
  assert.deepEqual(checkRegistry(home.file, { kind: 'home' }), [])
})

test('parse: what is not a version 2 file throws', () => {
  for (const [bad, why] of [
    ['{', /JSON|Expected|Unexpected/],
    ['[]', /not an object/],
    [text({ version: 1, bots: [] }), /version 1, expected 2/],
    [text({ version: 2 }), /no bots list/],
  ]) assert.throws(() => parseRegistry(bad, { kind: 'repo' }), why)
  assert.throws(() => parseRegistry(text(repoFile()), {}), /kind is "home" or "repo"/)
})

test('parse: bad entries are left out with a warning, as Herdr does', () => {
  const raw = repoFile()
  raw.bots.push(
    { id: 'unfold-root', name: 'Unfold' },
    { id: ID.dev, name: 'Twice' },
    { id: 'b-nonamenone', name: ' ' },
    { id: 'b-badpetbad2', name: 'Pet', pet: { source: 'team', id: '../../.ssh' } },
    { id: 'b-badmainxx2', name: 'Main?', main: 'yes', role: 7 },
  )
  const { file, warnings } = parseRegistry(text(raw), { kind: 'repo' })
  assert.deepEqual(file.bots.map(b => b.id), [ID.main, ID.dev, 'b-badpetbad2', 'b-badmainxx2'])
  assert.equal(file.bots[2].pet, undefined)
  assert.equal(file.bots[3].main, undefined)
  assert.equal(file.bots[3].role, '')
  assert.equal(warnings.length, 6, warnings.join('\n'))
  assert.ok(warnings.some(w => /unfold-root: id is not/.test(w)))
  assert.ok(warnings.some(w => /id used twice/.test(w)))
  assert.ok(warnings.some(w => /pet id "..\/..\/.ssh" is not one path segment/.test(w)))
})

test('parse: a repo file with two main Bots warns and the first counts', () => {
  const raw = repoFile()
  raw.bots[1].main = true
  const { file, warnings } = parseRegistry(text(raw), { kind: 'repo' })
  assert.deepEqual(file.bots.map(b => b.main), [true, false])
  assert.deepEqual(warnings, [`2 main bots; ${ID.main} counts`])
})

test('a repo file cannot set folder, machine, dsh, shown or projects', () => {
  const raw = repoFile()
  Object.assign(raw.bots[0], { folder: '/', machine: 'g9', dsh: { model: 'x' } })
  raw.shown = [{ project: null, bots: [ID.main] }]
  raw.projects = [{ folder: '/etc' }]
  const parsed = parseRegistry(text(raw), { kind: 'repo' })
  assert.equal(parsed.file.shown, undefined)
  assert.equal(parsed.file.projects, undefined)
  for (const key of ['folder', 'machine', 'dsh']) assert.equal(parsed.file.bots[0][key], undefined)
  assert.equal(parsed.warnings.length, 5, parsed.warnings.join('\n'))
  // The raw copy still holds them: a reader keeps what it does not use.
  assert.equal(parsed.raw.bots[0].folder, '/')
  // A writer may not add them; one a hand-written file already had stays writable.
  const errors = checkRegistry(raw, { kind: 'repo', before: text(repoFile()) })
  assert.deepEqual(errors.sort(), [
    `${ID.main}: dsh: only the home file holds it`,
    `${ID.main}: folder: only the home file holds it`,
    `${ID.main}: machine: only the home file holds it`,
    'projects: only the home file holds it',
    'shown: only the home file holds it',
  ])
  assert.deepEqual(checkRegistry(raw, { kind: 'repo', before: text(raw) }), [])
})

test('check: what a write refuses', () => {
  const noMain = repoFile()
  noMain.bots[0].main = false
  assert.deepEqual(checkRegistry(noMain, { kind: 'repo' }), ['0 main bots; a project has exactly one'])
  assert.deepEqual(checkRegistry({ version: 2, bots: [] }, { kind: 'repo' }), [])
  assert.deepEqual(checkRegistry({ version: 1, bots: [] }, { kind: 'home' }), ['not a version 2 bots file'])
  const bad = homeFile()
  bad.bots.push({ id: 'unfold-root', name: 'U' }, { id: ID.dsh, name: '' })
  bad.bots[0].pet = { source: 'codex', id: 'x' }
  bad.bots[1].machine = '-oProxyCommand'
  bad.shown.push({ project: '/x', bots: ['nope'] })
  bad.projects.push({ machine: 'g9' })
  assert.deepEqual(checkRegistry(bad, { kind: 'home' }).sort(), [
    'a project with no folder',
    `${ID.dsh}: id used twice`,
    `${ID.dsh}: no name`,
    `${ID.dsh}: pet source "codex" is not builtin or team`,
    `${ID.main}: machine needs a folder and a machine name`,
    'shown /x: an id that is not a Bot id',
    'unfold-root: id is not b- plus 10 base32 characters or session-<uuid>',
  ].sort())
  // A home file may hold any number of team Main Bots.
  const mains = homeFile()
  mains.bots[1].main = true
  assert.deepEqual(checkRegistry(mains, { kind: 'home' }), [])
})

test('unknown fields round-trip through a write, and the indentation is kept', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  const raw = homeFile()
  raw.futureTop = { keep: true }
  raw.bots[0].dsh.futureInk = 'x'
  raw.bots[1].rank = 'dev'
  raw.bots[1].worker = { agent: 'codex', template: 'reviewer', swap: { agent: 'claude' } }
  raw.bots[1].somethingNew = [1, 2]
  const before = text(raw, '\t')
  writeFileSync(path, before)
  const { raw: written } = await updateRegistry(path, r => putBot(r, { id: ID.main, name: 'Renamed' }), { kind: 'home' })
  const after = readFileSync(path, 'utf8')
  assert.equal(indentOf(after), '\t')
  const expected = structuredClone(raw)
  expected.bots[1].name = 'Renamed'
  assert.deepEqual(JSON.parse(after), expected)
  assert.deepEqual(written, expected)
  assert.equal(existsSync(`${path}.lock`), false)
})

test('a new file gets its folder, two spaces, and is created exclusively', async (t) => {
  const path = join(tempDir(t), 'repo', '.automagik', 'bots', 'bots.json')
  const bot = { id: newBotId(), name: 'Captain', main: true }
  const written = await writeRegistry(path, { version: 2, bots: [bot] }, null, { kind: 'repo' })
  assert.equal(readFileSync(path, 'utf8'), written)
  assert.equal(indentOf(written), '  ')
  await assert.rejects(writeRegistry(path, { version: 2, bots: [bot] }, null, { kind: 'repo' }), { code: 'registry/stale' })
})

test('two writers from the same text: one saved, one refused', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  const start = text(repoFile())
  writeFileSync(path, start)
  const edit = name => putBot(parseRegistry(start, { kind: 'repo' }).raw, { id: ID.dev, name })
  const results = await Promise.allSettled([
    writeRegistry(path, edit('From DSH'), start, { kind: 'repo' }),
    writeRegistry(path, edit('From the CLI'), start, { kind: 'repo' }),
  ])
  const saved = results.filter(r => r.status === 'fulfilled')
  const refused = results.filter(r => r.status === 'rejected')
  assert.equal(saved.length, 1)
  assert.equal(refused.length, 1)
  assert.equal(refused[0].reason.code, 'registry/stale')
  assert.match(refused[0].reason.message, /changed since it was read/)
  assert.equal(readFileSync(path, 'utf8'), saved[0].value)
  assert.deepEqual(readdirSync(join(path, '..')), ['bots.json'])
})

test('updateRegistry redoes the edit on the fresh text when another write landed first', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  writeFileSync(path, text(repoFile()))
  let calls = 0
  const { raw } = await updateRegistry(path, r => {
    calls += 1
    // Another writer lands between this edit's read and its write, once.
    if (calls === 1) writeFileSync(path, text(putBot(repoFile(), { id: ID.main, role: 'from Herdr' })))
    return putBot(r, { id: ID.dev, role: 'from DSH' })
  }, { kind: 'repo' })
  assert.equal(calls, 2)
  assert.equal(raw.bots[0].role, 'from Herdr')
  assert.equal(raw.bots[1].role, 'from DSH')
  // It gives up after `tries`.
  await assert.rejects(updateRegistry(path, r => {
    writeFileSync(path, text(putBot(JSON.parse(readFileSync(path, 'utf8')), { id: ID.main, name: newBotId() })))
    return r
  }, { kind: 'repo', tries: 3 }), { code: 'registry/stale' })
  // A file that does not parse is never written.
  writeFileSync(path, '{ broken')
  await assert.rejects(updateRegistry(path, r => r, { kind: 'repo' }), SyntaxError)
  assert.equal(readFileSync(path, 'utf8'), '{ broken')
})

test('the lock: a fresh one is waited for, then refused; another holder\'s is never removed', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  const start = text(repoFile())
  writeFileSync(path, start)
  // The CLI's lock: its pid and a token, made a moment ago.
  const cliToken = `99999 ${crypto.randomUUID()}`
  writeFileSync(`${path}.lock`, cliToken)
  const began = Date.now()
  await assert.rejects(writeRegistry(path, repoFile(), start, { kind: 'repo', wait: 150 }), { code: 'registry/locked' })
  assert.ok(Date.now() - began >= 150)
  assert.equal(readFileSync(path, 'utf8'), start)
  await dropLock(`${path}.lock`, 'not its token')
  assert.equal(readFileSync(`${path}.lock`, 'utf8'), cliToken)
})

test('the lock: a stale one (a writer killed mid-write) is taken over', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  const start = text(repoFile())
  writeFileSync(path, start)
  writeFileSync(`${path}.lock`, `99999 ${crypto.randomUUID()}`)
  const old = (Date.now() - 11_000) / 1000
  utimesSync(`${path}.lock`, old, old)
  const next = putBot(repoFile(), { id: ID.dev, name: 'Saved' })
  await writeRegistry(path, next, start, { kind: 'repo', wait: 500 })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).bots[1].name, 'Saved')
  assert.deepEqual(readdirSync(join(path, '..')), ['bots.json'])
})

test('the lock holds the CLI\'s format, and a holder drops only its own', async (t) => {
  const lock = join(tempDir(t), 'bots.json.lock')
  const token = await takeLock(lock)
  assert.match(token, new RegExp(`^${process.pid} [0-9a-f-]{36}$`))
  assert.equal(readFileSync(lock, 'utf8'), token)
  await assert.rejects(takeLock(lock, { wait: 50 }), { code: 'registry/locked' })
  await dropLock(lock, token)
  assert.equal(existsSync(lock), false)
})

test('a rename Windows refuses is retried, then not saved; the temporary file goes', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  const start = text(repoFile())
  writeFileSync(path, start)
  let refusals = 2
  const flaky = { ...fs, renameSync: (from, to) => {
    if (to === path && refusals-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' })
    return fs.renameSync(from, to)
  } }
  await writeRegistry(path, putBot(repoFile(), { id: ID.dev, name: 'Late' }), start, { kind: 'repo', fs: flaky })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).bots[1].name, 'Late')
  const now = readFileSync(path, 'utf8')
  const stuck = { ...fs, renameSync: (from, to) => {
    if (to === path) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    return fs.renameSync(from, to)
  } }
  await assert.rejects(writeRegistry(path, repoFile(), now, { kind: 'repo', fs: stuck }), { code: 'EBUSY' })
  assert.equal(readFileSync(path, 'utf8'), now)
  assert.deepEqual(readdirSync(join(path, '..')), ['bots.json'])
})

test('an invalid file is refused before anything is touched', async (t) => {
  const path = join(tempDir(t), 'bots.json')
  await assert.rejects(writeRegistry(path, { version: 2, bots: [{ id: 'unfold-root', name: 'U' }] }, null, { kind: 'home' }), { code: 'registry/invalid' })
  assert.equal(await readRegistryText(path), null)
  await assert.rejects(writeRegistry(path, emptyRegistry('home')), /pass the text the edit started from/)
})

test('putBot changes only the fields it names; dropBot removes one Bot', () => {
  const raw = repoFile()
  raw.bots[1].somethingNew = 1
  putBot(raw, { id: ID.dev, role: undefined, name: 'Dev 2' })
  assert.deepEqual(raw.bots[1], { id: ID.dev, name: 'Dev 2', instructions: '', agent: 'codex', lead: ID.main, category: 'core', somethingNew: 1 })
  putBot(raw, { id: ID.dsh, name: 'New' })
  assert.deepEqual(raw.bots.at(-1), { id: ID.dsh, name: 'New' })
  dropBot(raw, ID.dsh)
  assert.deepEqual(raw.bots.map(b => b.id), [ID.main, ID.dev])
  assert.throws(() => putBot(raw, { id: 'unfold-root' }), /not a Bot id/)
})

test('the module imports nothing, so it can be copied byte-equal into Herdr', () => {
  const source = readFileSync(new URL('../src/shared/registry.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*import\s/m)
  assert.doesNotMatch(source, /\brequire\(/)
  const dynamic = [...source.matchAll(/import\(\s*(['"])([^'"]+)\1\s*\)/g)].map(m => m[2])
  assert.deepEqual(dynamic, ['node:fs'])
})
