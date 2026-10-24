import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/host/endpoint.js'
import { hintsFile, seedStarterOff } from '../src/host/starter.js'
import { fakeContext } from './fake-ctx.js'

const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })
const folder = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-ai-starter-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const read = file => JSON.parse(readFileSync(file, 'utf8'))

test('the hints live where dsh-oh-my-claude keeps them', () => {
  assert.equal(hintsFile({ DSH_OMC_STATE_DIR: '/state/omc' }), '/state/omc/hints.json')
  assert.match(hintsFile({}), /\.local\/state\/dsh-oh-my-claude\/hints\.json$/)
})

test('the starter hint is hidden once, and a value already there is never changed', async (t) => {
  const dir = folder(t)
  const fresh = join(dir, 'new', 'hints.json')
  assert.equal(await seedStarterOff(fresh), true)
  assert.deepEqual(read(fresh), { starterOff: true })
  // Other hints stay; a starterOff that is there, either way, stays.
  const other = join(dir, 'other.json')
  writeFileSync(other, JSON.stringify({ themeSplit: 1 }))
  assert.equal(await seedStarterOff(other), true)
  assert.deepEqual(read(other), { themeSplit: 1, starterOff: true })
  const kept = join(dir, 'kept.json')
  writeFileSync(kept, JSON.stringify({ starterOff: false }))
  assert.equal(await seedStarterOff(kept), false)
  assert.deepEqual(read(kept), { starterOff: false })
  // A file it cannot read is left alone.
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{not json')
  assert.equal(await seedStarterOff(broken), false)
  assert.equal(readFileSync(broken, 'utf8'), '{not json')
})

function host(t, own = {}) {
  const file = join(folder(t), 'hints.json')
  const fake = fakeContext({ entries: { 'omni-ai': own } })
  const { handle } = install(fake.ctx, { checkClaude: noClaude, hintsFile: file })
  return { ...fake, handle, file }
}

test('a fresh install\'s first finished step hides the starter hint; later ones do not', async (t) => {
  const fresh = host(t)
  await fresh.handle('done', { stepId: 'omni-companion' })
  assert.deepEqual(read(fresh.file), { starterOff: true })
  assert.equal(fresh.valueOf('omni-ai').starterSeeded, true)
  // The person turns the hint back on (the plugin drops the key): it stays on.
  writeFileSync(fresh.file, '{}')
  await fresh.handle('done', { stepId: 'omni-team' })
  assert.deepEqual(read(fresh.file), {})
})

test('an install that finished onboarding before is left as it is', async (t) => {
  const old = host(t, { companionDone: true, connectAiDone: true })
  await old.handle('done', { stepId: 'omni-team' })
  assert.equal(existsSync(old.file), false)
  assert.equal(old.valueOf('omni-ai').starterSeeded, undefined)
})
