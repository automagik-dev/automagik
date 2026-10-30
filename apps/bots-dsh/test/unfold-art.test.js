// The Unfold Bot (kind unfold, @automagik/unfold-bot-dsh) in its own clay: the expression strip
// for its marks, and the Unfold pet for the ones that move and for the character picker.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createPets, webpSize } from '../src/host/pets.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = await build({
  stdin: { contents: "export { automagikRoster, currentKey } from './src/client/character-select.js'\nexport { lookOf } from './src/client/characters.js'\nexport { petOf } from './src/client/mark.js'\nexport { clayArtOf } from './src/client/clay-art.js'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['react', 'react-dom'],
})
const client = { exports: {} }
const react = { createElement: () => null, useEffect: () => {}, useLayoutEffect: () => {}, useMemo: f => f(), useRef: () => ({}), useState: v => [v, () => {}], Fragment: 'f' }
runInNewContext(bundle.outputFiles[0].text, { module: client, exports: client.exports, URLSearchParams, require: name => (name === 'react' ? react : { createPortal: x => x }) })
const { automagikRoster, currentKey, lookOf, petOf, clayArtOf } = client.exports
const plain = value => JSON.parse(JSON.stringify(value))

const UNFOLD = { id: 'u', name: 'Unfold', kind: 'unfold' }

test('the Unfold Bot is drawn in Unfold\'s clay; a photo still wins', () => {
  assert.equal(clayArtOf(UNFOLD, lookOf(UNFOLD)), 'unfold')
  assert.equal(clayArtOf(UNFOLD, { image: 'data:image/png;base64,AA==' }), null)
  assert.equal(clayArtOf({ id: 'b' }, lookOf({ id: 'b' })), null)
})

test('a large Unfold mark wears the Unfold pet the plugin ships; a small one stays clay', () => {
  assert.deepEqual(plain(petOf(UNFOLD, lookOf(UNFOLD), { live: true, size: 64 })), { served: { source: 'builtin', id: 'unfold', version: 2, sleep: true } })
  assert.equal(petOf(UNFOLD, lookOf(UNFOLD), { live: true, size: 24 }), null)
})

test('the character picker has the Unfold pet in Unfold\'s own instance only, and starts on it for the Unfold Bot', () => {
  assert.equal(automagikRoster().find(item => item.key === 'pet:builtin:unfold'), undefined)
  const roster = automagikRoster({ unfold: true })
  const entry = roster.find(item => item.key === 'pet:builtin:unfold')
  assert.ok(entry)
  assert.deepEqual(plain(roster.slice(2, 5).map(item => item.key)), ['pet:builtin:automagik', 'pet:builtin:unfold', 'pet:builtin:wisp'])
  assert.deepEqual([entry.kind, entry.name], ['pet', 'Unfold'])
  assert.deepEqual(plain(entry.pet), { source: 'builtin', id: 'unfold', name: 'Unfold', version: 2, sleep: true })
  assert.equal(currentKey(UNFOLD, lookOf(UNFOLD)), 'pet:builtin:unfold')
})

test('the Unfold pet ships as a v2 Codex pet with its sleep strip, at their exact sizes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bots-unfold-pet-'))
  try {
    const pets = createPets({ home: join(root, 'team'), codexHome: join(root, 'codex'), fetch: () => { throw new Error('no network') }, unfold: () => true })
    const pet = (await pets.list()).find(item => item.source === 'builtin' && item.id === 'unfold')
    assert.deepEqual([pet.name, pet.version, pet.sleep], ['Unfold', 2, true])
    const sheet = await pets.file('builtin', 'unfold')
    const sleep = await pets.file('builtin', 'unfold', 'sleep')
    assert.deepEqual(webpSize(sheet), [1536, 2288])
    assert.deepEqual(webpSize(sleep), [1152, 208])
    const dir = new URL('../src/host/pets/unfold/', import.meta.url)
    assert.equal(statSync(new URL('spritesheet.webp', dir)).size, 1974602)
    assert.equal(statSync(new URL('sleep.webp', dir)).size, 157700)
    assert.equal(JSON.parse(readFileSync(new URL('pet.json', dir), 'utf8')).spriteVersionNumber, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the expression strip is one row of seven 192x208 faces, and reaches the bundle', async () => {
  const strip = readFileSync(new URL('../src/client/art/unfold-expressions.webp', import.meta.url))
  assert.deepEqual(webpSize(strip), [1344, 208])
  // The approved strip, byte for byte: lossless, never re-encoded (dev/art/unfold-expressions.sh).
  assert.equal(createHash('sha256').update(strip).digest('hex'), '081a3d3677e78c5b3b15db45dfeb2aed67b5a49b69f4eb16e6d225950155dbb0')
  const { unfoldExpressions } = await import('../src/client/art/inline.js')
  assert.equal(unfoldExpressions, `data:image/webp;base64,${strip.toString('base64')}`)
})
