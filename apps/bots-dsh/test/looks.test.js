import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_COLORS, DEFAULT_SHAPES, DSH_LOOK, MAIN_LOOK, defaultColor, defaultShape, lookOf } from '../src/client/characters.js'
import { indexRoster } from '../src/client/sources.js'

const ids = Array.from({ length: 3000 }, (_, index) => `session-${index.toString(16).padStart(8, '0')}-look`)

test('the id look a Genie still wears never gets the octopus, gray, brown, or black', () => {
  assert.ok(!DEFAULT_SHAPES.includes('octopus'))
  for (const color of ['gray', 'brown', 'black', 'aurora']) assert.ok(!DEFAULT_COLORS.includes(color), color)
  const shapes = new Set(ids.map(defaultShape))
  const colors = new Set(ids.map(defaultColor))
  assert.deepEqual([...shapes].sort(), [...DEFAULT_SHAPES].sort())
  assert.deepEqual([...colors].sort(), [...DEFAULT_COLORS].sort())
})

const roster = (bots, mainBotIds) => indexRoster({ bots, rooms: [], mainBotIds, mainBotId: mainBotIds[0] ?? null })

test('a Bot with no look of its own wears DSH\'s blue whale, and a stored look wins', () => {
  const chief = { id: 'chief', name: 'Omni', createdAt: 1, color: 'deepseek', avatar: { shape: 'octopus' } }
  const writer = { id: 'writer', name: 'Writer', createdAt: 2 }
  // Stored looks stay as they are: the team's first Main Bot keeps its octopus.
  assert.deepEqual(lookOf(roster([writer, chief], ['chief']).byId.chief), { ...MAIN_LOOK, image: undefined, pet: undefined })
  // A Bot backed by DSH with no look of its own wears DSH's mark, wherever it sits in
  // the team: the Main Bot role is not what picks the whale.
  assert.deepEqual(lookOf(roster([writer], ['writer']).byId.writer), { ...DSH_LOOK, image: undefined, pet: undefined })
  assert.deepEqual(lookOf({ id: 'kept', avatar: { shape: 'star' } }).shape, 'star')
  assert.equal(lookOf({ id: 'kept', color: 'magenta', avatar: { shape: 'star' } }).color, 'magenta')
  const photo = lookOf({ id: 'chief', avatar: { image: 'data:image/png;base64,AA==' } })
  assert.equal(photo.image, 'data:image/png;base64,AA==')
  assert.equal(photo.shape, 'whale')
})

test('a Genie keeps its own art: the genie-cosmic pet, and the id look under it', () => {
  const genie = { id: 'g1', kind: 'genie', name: 'cogna-cx-kb', createdAt: 3 }
  const look = lookOf(genie)
  assert.deepEqual(look, { shape: defaultShape('g1'), color: defaultColor('g1'), image: undefined, pet: undefined })
  // A Genie in a color of its own keeps that color too.
  assert.equal(lookOf({ ...genie, color: 'magenta' }).color, 'magenta')
})

test('Bot settings is the only settings entry; nothing is called Team settings', () => {
  const dir = new URL('../src/client/', import.meta.url)
  const sources = readdirSync(dir).filter(name => name.endsWith('.js')).map(name => [name, readFileSync(new URL(name, dir), 'utf8')])
  for (const [name, text] of [...sources, ['client.js', readFileSync(new URL('../client.js', import.meta.url), 'utf8')]]) {
    assert.ok(!text.includes('Team settings'), `${name} still names Team settings`)
  }
  const text = name => sources.find(([file]) => file === name)[1]
  assert.match(text('sidebar.js'), /\[t\('Bot settings'\), GearIcon, \(\) => actions\.openSettings\('general'\)\]/)
  assert.match(text('palette.js'), /title: t\('Bot settings'\), run: \(\) => actions\.openSettings\('general'\)/)
  // One Bot's own entries open that Bot, so they read Edit Bot instead.
  assert.match(text('context-menu.js'), /\[t\('Edit Bot'\), GearIcon, \(\) => actions\.openSettings\('bots', bot\.id\)\]/)
  assert.match(text('details-drawer.js'), /'aria-label': bot \? t\('Edit Bot'\) : t\('Group settings'\), title: bot \? t\('Edit Bot'\) : t\('Group settings'\)/)
  // A group chat's entries open its own settings the same way.
  assert.match(text('context-menu.js'), /\[t\('Group settings'\), GearIcon, \(\) => actions\.openSettings\('groups', room\.id\)\]/)
  // A DSH bot's own menu adopts it into a Bot; the tasks record has no such entry.
  assert.match(text('context-menu.js'), /\[t\('Adopt as Bot'\), PeopleIcon, \(\) => actions\.adoptAgentAsBot\(agent\.id\)\]/)
  assert.ok(!text('mark.js').includes('WhaleLogo'))
})
