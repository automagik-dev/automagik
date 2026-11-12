import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { GENIE_CLAY, sheetVersion, webpSize } from '../src/host/pets.js'

// Genie is the approved full-body figure (dev/art/genie-approved-v5): the pet the plugin
// ships under the id teams already keep, the seven faces cut from its atlas, and the figure
// in the Mac install window. These hold the files to the approved delivery and the player to
// the delivery's state map.
const REPO = new URL('../../../', import.meta.url)
const file = path => readFileSync(new URL(path, REPO))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const SOURCE = JSON.parse(file('apps/bots-dsh/dev/art/genie-approved-v5/SOURCE.json'))
const PET = 'apps/bots-dsh/src/host/pets/genie-clay'

// The player is client code: bundled with a stand-in React whose effects run at once and
// whose timers are kept, so a test can see what a mark would do next without waiting.
const bundle = await build({
  stdin: { contents: "export { CELL, ONCE, PetSprite, ROWS, SLEEP, rowsOf } from './src/client/pet.js'\nexport { FACES } from './src/client/clay-art.js'\nexport { GENIE_PET, servedPet } from './src/client/mark.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const states = []
const sets = []
const timers = []
const motion = { reduce: false, level: undefined }
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => [states.length > 0 ? states.shift() : initial, value => sets.push(value)],
  useEffect: (effect) => { effect() },
  useRef: current => ({ current }),
}
const player = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module: player, exports: player.exports, URLSearchParams,
  require: name => (name === 'react' ? react : {}),
  setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length },
  clearTimeout: () => {},
  matchMedia: () => ({ matches: motion.reduce }),
  document: { body: { get dataset() { return { btMotion: motion.level } } } },
})
const { CELL, ONCE, PetSprite, ROWS, SLEEP, rowsOf, FACES, GENIE_PET, servedPet } = player.exports

// One render of Genie's sprite at `frame`: its cell's style, the row it names, and the timers it set.
const GENIE = { sheet: 'genie-sheet', sleep: 'genie-sleep', version: 2 }
function draw(state, { frame = 0, live = true, size = CELL.height, onOnce } = {}) {
  states.length = 0; sets.length = 0; timers.length = 0
  states.push(frame)
  const sprite = PetSprite({ pet: GENIE, size, state, live, onOnce })
  return { row: sprite.props['data-row'], style: sprite.children[0].props.style, timers: [...timers], sets: [...sets] }
}

test('the pet the plugin ships as Genie is the approved delivery\'s atlas and sleep strip, byte for byte', () => {
  for (const { path, sha256 } of [...SOURCE.source, ...SOURCE.reference]) assert.equal(sha(file(path)), sha256, `${path} is not the approved file`)
  assert.deepEqual(SOURCE.source.map(entry => entry.path).sort(), ['apps/bots-dsh/dev/art/genie-approved-v5/approved-genie.png', `${PET}/sleep.webp`, `${PET}/spritesheet.webp`])
  // The Codex v2 atlas: eight columns and eleven rows of 192x208 cells; the sleep strip is six.
  const sheet = file(`${PET}/spritesheet.webp`)
  assert.deepEqual(webpSize(sheet), [CELL.columns * CELL.width, 11 * CELL.height])
  assert.deepEqual(webpSize(sheet), [1536, 2288])
  assert.equal(sheetVersion(sheet), 2)
  assert.deepEqual(webpSize(file(`${PET}/sleep.webp`)), [SLEEP.ms.length * CELL.width, CELL.height])
  // The id and the name are the ones installed teams keep; only the atlas's version moved.
  const manifest = JSON.parse(file(`${PET}/pet.json`))
  assert.deepEqual([manifest.id, manifest.displayName, manifest.spriteVersionNumber, manifest.spritesheetPath], ['genie-clay', 'Genie', 2, 'spritesheet.webp'])
  assert.deepEqual({ ...GENIE_CLAY }, { source: 'builtin', id: 'genie-clay', version: 2, sleep: true })
  assert.deepEqual({ ...GENIE_PET }, { ...GENIE_CLAY })
  assert.equal(rowsOf(GENIE_PET.version), 11)
})

test('Genie\'s faces and install-window figure are the files built from the approved figure', () => {
  const derived = Object.keys(SOURCE.derived).sort()
  assert.deepEqual(derived, ['apps/bots-dsh/src/client/art/genie-expressions.webp', 'apps/desktop/assets/dmg-source/genie.png', 'apps/welcome-dsh/src/client/vendor/art/genie-expressions.webp'])
  for (const path of derived) assert.equal(sha(file(path)), SOURCE.derived[path], `${path} changed: run dev/art/genie-approved-v5/build.py and commit SOURCE.json`)
  // One row of seven 192x208 cells, a face each, as the marks and the welcome slice it.
  assert.deepEqual([...FACES], ['calm', 'pleased', 'delighted', 'focused', 'curious', 'asleep', 'sad'])
  assert.deepEqual(webpSize(file('apps/bots-dsh/src/client/art/genie-expressions.webp')), [FACES.length * 192, 208])
  // The install window's figure is a 1024 px square PNG with alpha (IHDR: width, height, 8-bit RGBA).
  const png = file('apps/desktop/assets/dmg-source/genie.png')
  assert.equal(png.toString('latin1', 1, 4), 'PNG')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [1024, 1024, 8, 6])
})

// The delivery's state map (its README, "Recovered DSH contract"), with the two states the
// app adds: a reply waiting to be read reviews, and asleep is the sleep strip.
const DELIVERED = JSON.parse(file('apps/bots-dsh/dev/art/genie-approved-v5/state-map.json'))
const STATE_MAP = {
  idle: 'idle', thinking: 'running', working: 'running', sending: 'running', orbit: 'running', searching: 'review',
  waiting: 'idle', alert: 'waiting', done: 'jumping', poked: 'waving', failed: 'failed', review: 'review',
}
// Where each animation is in the atlas, and how many cells it has.
const ATLAS = { idle: [0, 6], waving: [3, 4], jumping: [4, 5], failed: [5, 8], waiting: [6, 6], running: [7, 6], review: [8, 6] }

test('every state plays its own row of Genie\'s atlas, cell by cell', () => {
  // The map and the rows are the delivery's own (state-map.json is its dsh/pet.json).
  const { sleeping, ...delivered } = DELIVERED.stateMap
  assert.equal(sleeping, 'sleep')
  assert.deepEqual(delivered, Object.fromEntries(Object.entries(STATE_MAP).filter(([state]) => state !== 'review')))
  assert.deepEqual(Object.fromEntries(Object.entries(DELIVERED.animations).filter(([name]) => name in ATLAS).map(([name, row]) => [name, [row.row, row.frames]])), ATLAS)
  assert.deepEqual([DELIVERED.cellWidth, DELIVERED.cellHeight, DELIVERED.columns, DELIVERED.rows, DELIVERED.sleep.frames, [...DELIVERED.once].sort()], [192, 208, 8, 11, 6, ['jumping', 'waving']])
  for (const [state, name] of Object.entries(STATE_MAP)) {
    const [row, count] = ATLAS[name]
    assert.deepEqual([ROWS[name].row, ROWS[name].ms.length], [row, count], name)
    for (let frame = 0; frame < count; frame += 1) {
      const { row: shown, style } = draw(state, { frame })
      assert.equal(shown, name, state)
      assert.equal(style.backgroundImage, 'url("genie-sheet")', state)
      assert.equal(style.backgroundSize, '1536px 2288px', state)
      assert.equal(style.backgroundPosition, `${-frame * 192}px ${-row * 208}px`, `${state} frame ${frame}`)
      assert.deepEqual([style.width, style.height], [192, 208], state)
    }
  }
  // Asleep is its own image: six cells in one row.
  for (let frame = 0; frame < 6; frame += 1) {
    const { row, style } = draw('sleeping', { frame })
    assert.equal(row, 'sleep')
    assert.deepEqual([style.backgroundImage, style.backgroundSize, style.backgroundPosition], ['url("genie-sleep")', '1152px 208px', `${-frame * 192}px 0`])
  }
  // A mark is drawn at its own size: the cell keeps 192:208, fit to the mark's height.
  const small = draw('alert', { frame: 2, size: 52 }).style
  assert.deepEqual([small.width, small.height, small.backgroundSize, small.backgroundPosition], [48, 52, '384px 572px', '-96px -312px'])
})

test('a loop goes round; the jump after a run and the wave of a poke play once and hand back', () => {
  for (const [state, name] of Object.entries(STATE_MAP)) {
    const last = ATLAS[name][1] - 1
    const ended = []
    const { timers: set } = draw(state, { frame: last, onOnce: row => ended.push(row) })
    assert.equal(set.length, 1, state)
    assert.equal(set[0].ms, ROWS[name].ms[last], state)
    sets.length = 0
    set[0].run()
    if (state === 'done' || state === 'poked') {
      assert.deepEqual([ended, [...sets]], [[name], []], `${state} hands back after its last cell`)
      assert.ok(ONCE.includes(name))
    } else {
      assert.deepEqual([ended, [...sets]], [[], [0]], `${state} starts its row again`)
      assert.ok(!ONCE.includes(name))
    }
  }
  // Mid-row, every state steps to its next cell.
  const { timers: set } = draw('done', { frame: 1 })
  sets.length = 0
  set[0].run()
  assert.deepEqual([...sets], [2])
})

test('reduced motion shows one frame of every state, and a row that plays once still hands back', (t) => {
  t.after(() => Object.assign(motion, { reduce: false, level: undefined }))
  for (const quiet of [{ reduce: true }, { level: 'quiet' }]) {
    Object.assign(motion, { reduce: false, level: undefined }, quiet)
    for (const [state, name] of Object.entries(STATE_MAP)) {
      const ended = []
      const { row, style, timers: set } = draw(state, { onOnce: done => ended.push(done) })
      assert.equal(row, name, state)
      assert.equal(style.backgroundPosition, `0px ${-ATLAS[name][0] * 208}px`, `${state} rests on its row's first cell`)
      if (ONCE.includes(name)) {
        // Held for the row's length, never stepped, then the mark goes back to its state.
        assert.deepEqual(set.map(timer => timer.ms), [ROWS[name].ms.reduce((sum, ms) => sum + ms, 0)], state)
        sets.length = 0
        set[0].run()
        assert.deepEqual([ended, [...sets]], [[name], []], state)
      } else {
        assert.deepEqual(set, [], `${state} sets no timer`)
      }
    }
    const asleep = draw('sleeping')
    assert.deepEqual([asleep.row, asleep.style.backgroundPosition, asleep.timers], ['sleep', '0px 0', []])
  }
  // With motion on, the same marks move.
  Object.assign(motion, { reduce: false, level: undefined })
  assert.equal(draw('idle').timers.length, 1)
  assert.equal(draw('sleeping').timers.length, 1)
  // A mark that is not live (a transcript's) never moves, whatever the motion setting.
  assert.deepEqual(draw('working', { live: false }).timers, [])
})

test('a look kept from Genie\'s v1 atlas is served as the v2 Genie shipped now', () => {
  const kept = servedPet({ source: 'builtin', id: 'genie-clay', version: 1 })
  assert.deepEqual({ ...kept }, { sheet: 'api/omni-ui/pet?source=builtin&id=genie-clay', sleep: 'api/omni-ui/pet?source=builtin&id=genie-clay&part=sleep', version: 2 })
  // Another pet is served as it was kept.
  assert.deepEqual({ ...servedPet({ source: 'team', id: 'genie-clay', version: 1 }) }, { sheet: 'api/omni-ui/pet?source=team&id=genie-clay', sleep: undefined, version: 1 })
})
