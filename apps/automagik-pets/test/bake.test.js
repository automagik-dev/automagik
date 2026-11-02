// automagik-pets bakes into a temporary home only: every test passes --home (or
// AUTOMAGIK_BOTS_HOME) and runs the CLI with HOME pointed at a temporary folder too, so the real
// ~/.automagik is never read or written.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { createPets, sheetVersion, webpSize } from '../../bots-dsh/src/host/pets.js'
import { ROWS, SLEEP } from '../../bots-dsh/src/client/pet-poses.js'
import { CHARACTER_IDS, COLOUR_IDS, allLookIds, cellPlan, lookParts, mixSrgb, parseLookId, resolveInks } from '../src/art.js'
import { VERSION, bakePet, botsHomeOf, renderCell } from '../src/bake.js'

const BIN = fileURLToPath(new URL('../bin/automagik-pets.js', import.meta.url))
const run = promisify(execFile)
const temps = []
async function tempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'automagik-pets-'))
  temps.push(dir)
  return dir
}
after(() => Promise.all(temps.map(dir => rm(dir, { recursive: true, force: true }))))

// The CLI in a child process with a temporary HOME and none of Automagik's variables.
async function cli(args, env = {}) {
  const home = await tempHome()
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AUTOMAGIK_')))
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], { env: { ...clean, HOME: home, ...env } })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}
const lastLine = text => JSON.parse(text.trim().split('\n').at(-1))
const FRAME_COUNT = Object.values(ROWS).reduce((sum, { ms }) => sum + ms.length, 0) + 1 + 16 + SLEEP.ms.length

describe('looks', () => {
  test('21 characters in 19 inks, 399 look ids, each [a-z0-9-]', () => {
    assert.equal(CHARACTER_IDS.length, 21)
    assert.equal(COLOUR_IDS.length, 19)
    const ids = allLookIds()
    assert.equal(new Set(ids).size, 399)
    for (const id of ids) {
      assert.match(id, /^[a-z0-9-]+$/)
      assert.deepEqual(parseLookId(id) && `${parseLookId(id).character}-${parseLookId(id).colour}`, id)
    }
  })

  test('a bad id names no look', () => {
    for (const id of ['', 'kitty', 'kitty-', '-blue', 'kitty-Blue', 'Kitty-blue', 'kitty-blue-x', 'nope-blue', 'kitty-nope', 'kitty-kimi', 'kitty-#2a92fe', '../kitty-blue', 'kitty_blue', undefined, 7]) {
      assert.equal(parseLookId(id), undefined, String(id))
    }
  })

  test('every look resolves to plain colors: no ink variable or color-mix is left', () => {
    for (const id of allLookIds()) {
      const parts = lookParts(parseLookId(id))
      for (const svg of [parts.body, ...Object.values(parts.faces)]) {
        assert.doesNotMatch(svg, /var\(|color-mix\(/, id)
      }
    }
  })

  test('color-mix in srgb mixes the encoded channels, three-digit hex included', () => {
    assert.equal(resolveInks('var(--bt-ink-blue)'), '#2A92FE')
    assert.equal(resolveInks('var(--bt-ink-blue)', 'dark'), '#0E74E0')
    assert.equal(mixSrgb('#2A92FE', 58, '#fff'), '#83C0FE')
    assert.equal(resolveInks('color-mix(in srgb, var(--bt-ink-blue) 72%, #000)'), mixSrgb('#2A92FE', 72, '#000000'))
    assert.equal(mixSrgb('#2A92FE', 72, '#000'), '#1E69B7')
  })
})

describe('bake', () => {
  test('bakes a v2 pet folder into the given home', async () => {
    const home = await tempHome()
    const { dir } = await bakePet('kitty-blue', { home })
    assert.equal(dir, join(home, 'pets', 'kitty-blue'))
    const manifest = JSON.parse(await readFile(join(dir, 'pet.json'), 'utf8'))
    assert.equal(manifest.id, 'kitty-blue')
    assert.equal(manifest.displayName, 'Kitty (blue)')
    assert.equal(manifest.spriteVersionNumber, 2)
    assert.equal(manifest.spritesheetPath, 'spritesheet.webp')
    assert.deepEqual(manifest.look, { character: 'kitty', colour: 'blue' })
    assert.deepEqual(manifest.bake, { tool: 'automagik-pets', version: VERSION, theme: 'light' })

    const sheet = await readFile(join(dir, 'spritesheet.webp'))
    assert.equal(sheetVersion(sheet), 2)
    assert.deepEqual(webpSize(sheet), [1536, 2288])
    assert.deepEqual(webpSize(await readFile(join(dir, 'sleep.webp'))), [1152, 208])

    // Every row, with its frame count, ms and files; the files are exactly the frames folder.
    for (const [name, { row, ms }] of Object.entries(ROWS)) {
      const entry = manifest.rows[name]
      assert.equal(entry.frames, ms.length, name)
      assert.deepEqual(entry.ms, ms, name)
      assert.deepEqual(entry.cells, ms.map((_, frame) => [row, frame]), name)
      assert.deepEqual(entry.files, ms.map((_, frame) => `frames/${name}-${frame}.png`), name)
    }
    assert.deepEqual(manifest.rows.sleep, { image: 'sleep.webp', frames: 6, ms: [...SLEEP.ms], cells: [0, 1, 2, 3, 4, 5].map(n => [0, n]), files: [0, 1, 2, 3, 4, 5].map(n => `frames/sleep-${n}.png`) })
    assert.equal(manifest.rows.look.frames, 16)
    assert.equal(manifest.rows.look.ms, null)
    assert.deepEqual(manifest.rows.look.cells.slice(7, 9), [[9, 7], [10, 0]])
    assert.deepEqual(manifest.rows.neutral.cells, [[0, 6]])
    const listed = Object.values(manifest.rows).flatMap(entry => entry.files).sort()
    assert.equal(listed.length, FRAME_COUNT)
    assert.deepEqual((await readdir(join(dir, 'frames'))).map(name => `frames/${name}`).sort(), listed)
    assert.deepEqual((await readdir(dir)).sort(), ['frames', 'pet.json', 'sleep.webp', 'spritesheet.webp'])
  })

  test('each frame PNG is its atlas cell, pixel for pixel', async () => {
    const home = await tempHome()
    const { dir } = await bakePet('octopus-deepseek', { home })
    const atlas = sharp(await readFile(join(dir, 'spritesheet.webp')))
    for (const cell of cellPlan().filter(entry => ['idle-3', 'neutral-0', 'look-12', 'jumping-2'].includes(entry.name))) {
      const png = await readFile(join(dir, 'frames', `${cell.name}.png`))
      const meta = await sharp(png).metadata()
      assert.deepEqual([meta.width, meta.height], [192, 208], cell.name)
      const frame = await sharp(png).ensureAlpha().raw().toBuffer()
      const fromAtlas = await atlas.clone().extract({ left: cell.column * 192, top: cell.row * 208, width: 192, height: 208 }).ensureAlpha().raw().toBuffer()
      assert.ok(frame.equals(fromAtlas), cell.name)
      assert.ok(frame.some((value, index) => index % 4 === 3 && value === 255), `${cell.name} draws the character`)
    }
  })

  test('a second bake replaces the folder whole and leaves nothing beside it', async () => {
    const home = await tempHome()
    const { dir } = await bakePet('star-rose', { home })
    await writeFile(join(dir, 'left-over.txt'), 'from the first bake')
    await bakePet('star-rose', { home })
    await assert.rejects(stat(join(dir, 'left-over.txt')), { code: 'ENOENT' })
    assert.deepEqual(await readdir(join(home, 'pets')), ['star-rose'])
  })

  test('a bake that fails keeps the pet already there and removes its temporary folder', async () => {
    const home = await tempHome()
    const { dir } = await bakePet('moon-green', { home })
    const before = await readFile(join(dir, 'spritesheet.webp'))
    let calls = 0
    const render = async (svg) => {
      calls += 1
      if (calls === 40) throw new Error('the renderer broke')
      return renderCell(svg)
    }
    await assert.rejects(bakePet('moon-green', { home, render }), /the renderer broke/)
    assert.ok((await readFile(join(dir, 'spritesheet.webp'))).equals(before))
    assert.deepEqual(await readdir(join(home, 'pets')), ['moon-green'])
  })

  test('a bad id fails before anything is written', async () => {
    const home = await tempHome()
    await assert.rejects(bakePet('nope-blue', { home }), /not a look id/)
    await assert.rejects(stat(join(home, 'pets')), { code: 'ENOENT' })
  })

  test('the bots home: --home, else as the Bot team resolves it', () => {
    assert.equal(botsHomeOf('/x/home', { AUTOMAGIK_BOTS_HOME: '/y' }), '/x/home')
    assert.equal(botsHomeOf(undefined, { AUTOMAGIK_BOTS_HOME: '/y/bots' }), '/y/bots')
    assert.equal(botsHomeOf(undefined, { AUTOMAGIK_BOTS_HOME: ' ', AUTOMAGIK_HOME: '/z' }), '/z/bots')
    assert.equal(botsHomeOf('  ', { AUTOMAGIK_HOME: '/z' }), '/z/bots')
  })
})

describe('the Bot team reads the baked pet', () => {
  test('createPets({home}).list() lists it from the team source as version 2', async () => {
    const home = await tempHome()
    await bakePet('whale-blue', { home })
    // A crashed bake's temporary folder stays invisible: its name starts with a dot.
    await mkdir(join(home, 'pets', '.whale-red.123.ab.tmp', 'frames'), { recursive: true })
    const pets = JSON.parse(JSON.stringify(await createPets({ home, codexHome: join(home, 'no-codex') }).list()))
    const team = pets.filter(pet => pet.source === 'team')
    assert.deepEqual(team, [{ id: 'whale-blue', name: 'Whale (blue)', description: "Automagik's Whale in blue, baked by automagik-pets.", source: 'team', version: 2, sleep: true }])
  })
})

describe('the command line', () => {
  test('bake --json ends with {"ok":true,"dir"} and exits 0', async () => {
    const home = await tempHome()
    const result = await cli(['bake', 'gem-violet', '--home', home, '--json'])
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(lastLine(result.stdout), { ok: true, dir: join(home, 'pets', 'gem-violet') })
    assert.equal(result.stdout.trim().split('\n').length, 1)
    await stat(join(home, 'pets', 'gem-violet', 'pet.json'))
  })

  test('without --home it bakes into $AUTOMAGIK_BOTS_HOME', async () => {
    const home = await tempHome()
    const result = await cli(['bake', 'acorn-brown', '--json'], { AUTOMAGIK_BOTS_HOME: home })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(lastLine(result.stdout), { ok: true, dir: join(home, 'pets', 'acorn-brown') })
  })

  test('a bad id ends with {"ok":false,"error"} and exits non-zero', async () => {
    const home = await tempHome()
    for (const id of ['nope-blue', 'kitty-Blue', '../escape']) {
      const result = await cli(['bake', id, '--home', home, '--json'])
      assert.notEqual(result.code, 0, id)
      const line = lastLine(result.stdout)
      assert.equal(line.ok, false, id)
      assert.match(line.error, /not a look id/, id)
    }
    await assert.rejects(stat(join(home, 'pets')), { code: 'ENOENT' })
  })

  test('a wrong command line answers in the same shape and exits 2', async () => {
    for (const args of [['bake'], ['paint', 'kitty-blue'], ['bake', 'kitty-blue', '--colour']]) {
      const result = await cli([...args, '--json'])
      assert.equal(result.code, 2, args.join(' '))
      assert.equal(lastLine(result.stdout).ok, false)
    }
  })

  test('--version prints the one version', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal((await cli(['--version'])).stdout.trim(), pkg.version)
    assert.deepEqual(lastLine((await cli(['--version', '--json'])).stdout), { ok: true, version: pkg.version })
  })
})
