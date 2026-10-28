import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createPets, sheetVersion, webpSize } from '../src/host/pets.js'

// The player is client code: bundled with a stand-in React, like the marks' tests.
const bundle = await build({
  stdin: { contents: "export { CELL, ROWS, cellOf, directionOf, petRowOf } from './src/client/pet.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['react'],
})
const player = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, { module: player, exports: player.exports, require: () => ({ createElement: () => null, useEffect: () => {}, useRef: () => ({}), useState: v => [v, () => {}] }) })
const { CELL, ROWS, cellOf, directionOf, petRowOf } = player.exports

// A WebP header of a given size, in each of the three encodings (the bytes past it are not read).
function vp8x(width, height) {
  const bytes = Buffer.alloc(40)
  bytes.write('RIFF', 0, 'latin1'); bytes.write('WEBP', 8, 'latin1'); bytes.write('VP8X', 12, 'latin1')
  bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}
function vp8l(width, height) {
  const bytes = Buffer.alloc(40)
  bytes.write('RIFF', 0, 'latin1'); bytes.write('WEBP', 8, 'latin1'); bytes.write('VP8L', 12, 'latin1')
  bytes[20] = 0x2f
  bytes.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21)
  return bytes
}

const roots = []
async function homes() {
  const root = await mkdtemp(join(tmpdir(), 'bt-pets-'))
  roots.push(root)
  return { home: join(root, 'team'), codexHome: join(root, 'codex') }
}
test.after(() => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))))

test('a spritesheet is a Codex atlas only at the v1 or v2 size, read from its own header', () => {
  assert.deepEqual(webpSize(vp8x(1536, 2288)), [1536, 2288])
  assert.deepEqual(webpSize(vp8l(1536, 1872)), [1536, 1872])
  assert.equal(sheetVersion(vp8x(1536, 2288)), 2)
  assert.equal(sheetVersion(vp8l(1536, 1872)), 1)
  assert.equal(sheetVersion(vp8x(1024, 1024)), undefined)
  assert.equal(sheetVersion(Buffer.from('\x89PNG\r\n\x1a\n not a webp')), undefined)
})

test('the plugin ships Genie as a v2 pet with its sleep strip, and lists Codex\'s own pets', async () => {
  const { home, codexHome } = await homes()
  await mkdir(join(codexHome, 'pets', 'fox'), { recursive: true })
  await writeFile(join(codexHome, 'pets', 'fox', 'pet.json'), JSON.stringify({ id: 'fox', displayName: 'Fox', spriteVersionNumber: 1, spritesheetPath: 'spritesheet.webp' }))
  await writeFile(join(codexHome, 'pets', 'fox', 'spritesheet.webp'), vp8l(1536, 1872))
  // A folder whose sheet is not an atlas is left out, not shown broken.
  await mkdir(join(codexHome, 'pets', 'broken'), { recursive: true })
  await writeFile(join(codexHome, 'pets', 'broken', 'pet.json'), JSON.stringify({ id: 'broken' }))
  await writeFile(join(codexHome, 'pets', 'broken', 'spritesheet.webp'), vp8x(512, 512))
  const pets = createPets({ home, codexHome, fetch: () => { throw new Error('no network') } })
  const list = await pets.list()
  // Directory order is filesystem-dependent: compare by identity, not by readdir order.
  const shapes = list.map(pet => [pet.source, pet.id, pet.version, pet.sleep]).sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`))
  assert.deepEqual(shapes, [['builtin', 'automagik', 2, true], ['builtin', 'genie-cosmic', 2, true], ['builtin', 'unfold', 2, true], ['codex', 'fox', 1, false]])
  assert.equal(sheetVersion(await pets.file('builtin', 'genie-cosmic')), 2)
  assert.ok((await pets.file('builtin', 'genie-cosmic', 'sleep')).length > 0)
  assert.equal(await pets.file('builtin', '../etc'), undefined)
  // Picked from Codex, a pet is copied to the team, which then lists it as its own.
  const kept = await pets.adopt('codex', 'fox')
  assert.deepEqual([kept.source, kept.id, kept.version], ['team', 'fox', 1])
  assert.deepEqual((await pets.list()).map(pet => `${pet.source}:${pet.id}`).sort(), ['builtin:automagik', 'builtin:genie-cosmic', 'builtin:unfold', 'team:fox'])
})

test('Automagik ships its original v2 atlas and sleep strip without network adoption', async () => {
  const pets = createPets({ ...await homes(), fetch: () => { throw new Error('no network') } })
  const pet = await pets.adopt('builtin', 'automagik')
  assert.deepEqual([pet.id, pet.name, pet.source, pet.version, pet.sleep], ['automagik', 'Automagik', 'builtin', 2, true])
  const sheet = await pets.file('builtin', pet.id)
  const sleep = await pets.file('builtin', pet.id, 'sleep')
  assert.equal(sheetVersion(sheet), 2)
  assert.deepEqual(webpSize(sleep), [1152, 208])
  assert.deepEqual(sheet, await readFile(new URL('../src/host/pets/automagik/spritesheet.webp', import.meta.url)))
  assert.deepEqual(sleep, await readFile(new URL('../src/host/pets/automagik/sleep.webp', import.meta.url)))
  for (const bytes of [sheet, sleep]) {
    assert.equal(bytes.toString('latin1', 12, 16), 'VP8L')
    assert.ok(bytes.readUInt32LE(21) & (1 << 28), 'the lossless WebP retains its alpha channel')
  }
})

test('a pet from codex-pets.net is checked and kept with the team; nothing else is fetched', async () => {
  const { home, codexHome } = await homes()
  const asked = []
  const sheet = vp8x(1536, 2288)
  const fetch = async (url) => {
    asked.push(String(url))
    if (String(url).startsWith('https://codex-pets.net/api/pets?')) return Response.json({ pets: [{ id: 'sayo', displayName: 'Sayo', spriteVersionNumber: 2, posterUrl: 'https://codex-pets.net/assets/pets/v/1/sayo/poster.webp', ownerName: 'hsfz' }, { id: 'hidden', ownerShadowbanned: true }], page: 1, totalPages: 3, total: 70 })
    if (String(url) === 'https://codex-pets.net/api/pets/sayo') return Response.json({ pet: { id: 'sayo', displayName: 'Sayo', description: 'A guitarist.', spriteVersionNumber: 2, spritesheetUrl: 'https://codex-pets.net/assets/pets/v/1/sayo/spritesheet.webp' } })
    if (String(url) === 'https://codex-pets.net/api/pets/evil') return Response.json({ pet: { id: 'evil', spritesheetUrl: 'https://elsewhere.example/sheet.webp' } })
    if (String(url).endsWith('/sayo/spritesheet.webp')) return new Response(sheet)
    return new Response('no', { status: 404 })
  }
  const pets = createPets({ home, codexHome, fetch })
  const page = await pets.browse({ query: 'sayo', sort: 'popular' })
  assert.equal(asked[0], 'https://codex-pets.net/api/pets?page=1&pageSize=24&q=sayo&sort=popular')
  assert.deepEqual(page.pets.map(pet => [pet.id, pet.version, pet.by]), [['sayo', 2, 'hsfz']])
  assert.equal(page.pages, 3)
  const kept = await pets.adopt('market', 'sayo')
  assert.deepEqual([kept.source, kept.id, kept.version, kept.name], ['team', 'sayo', 2, 'Sayo'])
  assert.deepEqual(await readFile(join(home, 'pets', 'sayo', 'spritesheet.webp')), sheet)
  // A sheet hosted anywhere but codex-pets.net's assets is refused before it is fetched.
  await assert.rejects(pets.adopt('market', 'evil'), /does not list that pet/)
  assert.ok(!asked.some(url => url.includes('elsewhere.example')))
})

test('a Bot\'s states play the rows the adoption contract maps them to', () => {
  const rows = Object.fromEntries(['idle', 'thinking', 'working', 'sending', 'orbit', 'searching', 'waiting', 'alert', 'done', 'poked', 'failed', 'review', 'sleeping'].map(state => [state, petRowOf(state)]))
  assert.deepEqual(rows, { idle: 'idle', thinking: 'running', working: 'running', sending: 'running', orbit: 'running', searching: 'review', waiting: 'idle', alert: 'waiting', done: 'jumping', poked: 'waving', failed: 'failed', review: 'review', sleeping: 'idle' })
  // The rows and their cells, as Codex lays them out.
  assert.deepEqual(Object.entries(ROWS).map(([name, row]) => [name, row.row, row.ms.length]), [['idle', 0, 6], ['running-right', 1, 8], ['running-left', 2, 8], ['waving', 3, 4], ['jumping', 4, 5], ['failed', 5, 8], ['waiting', 6, 6], ['running', 7, 6], ['review', 8, 6]])
  assert.deepEqual([CELL.width, CELL.height, CELL.columns], [192, 208, 8])
})

test('a pet looks toward the pointer in sixteen directions, up first and clockwise', () => {
  assert.equal(directionOf(0, -10), 0)
  assert.equal(directionOf(10, 0), 4)
  assert.equal(directionOf(0, 10), 8)
  assert.equal(directionOf(-10, 0), 12)
  assert.equal(directionOf(10, -10), 2)
  assert.deepEqual({ ...cellOf('idle', 0, 4) }, { row: 9, frame: 4 })
  assert.deepEqual({ ...cellOf('idle', 0, 12) }, { row: 10, frame: 4 })
  assert.deepEqual({ ...cellOf('waving', 5) }, { row: 3, frame: 1 })
})

test('a Bot\'s look goes into Codex\'s pets folder as a Codex package, its sleep strip beside it', async () => {
  const { home, codexHome } = await homes()
  const pets = createPets({ home, codexHome, fetch: () => { throw new Error('no network') } })
  await assert.rejects(pets.toCodex('automagik-writer', { name: 'Writer', bytes: vp8x(1024, 1024) }), /not in the Codex format/)
  await assert.rejects(pets.toCodex('automagik-writer', { bytes: vp8x(1152, 208), part: 'sleep' }), /before its sleep strip/)
  await pets.toCodex('automagik-writer', { name: 'Writer', description: 'Writes.', bytes: vp8x(1536, 2288) })
  await pets.toCodex('automagik-writer', { bytes: vp8x(1152, 208), part: 'sleep' })
  const manifest = JSON.parse(await readFile(join(codexHome, 'pets', 'automagik-writer', 'pet.json'), 'utf8'))
  assert.deepEqual(manifest, { id: 'automagik-writer', displayName: 'Writer', description: 'Writes.', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' })
  // Codex's own folder now lists it, as any Codex pet.
  assert.deepEqual((await pets.list()).filter(pet => pet.source === 'codex').map(pet => [pet.id, pet.version, pet.sleep]), [['automagik-writer', 2, true]])
  await assert.rejects(pets.toCodex('../escape', { bytes: vp8x(1536, 2288) }), /Unknown pet/)
})
