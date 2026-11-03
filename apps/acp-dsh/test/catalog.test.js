// The catalog of an agent's models and efforts: read from the agent, kept on disk, stood in for
// while the agent has not answered.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Catalog, readCatalog, reasoningOf } from '../src/host/catalog.js'

const FAKE = join(import.meta.dirname, '..', 'dev', 'fake-agent.mjs')
const FALLBACK = [{ id: 'default', name: 'Stand-in' }]
const scratch = () => mkdtempSync(join(tmpdir(), 'acp-dsh-catalog-'))
const fake = { command: process.execPath, args: [FAKE] }
const broken = { command: process.execPath, args: [join(import.meta.dirname, 'fixtures', 'no-such-agent.mjs')] }

function catalog(home, { spawn = () => fake, key = () => 'v1', now } = {}) {
  const logs = []
  const made = new Catalog({ id: 'acp-test', name: 'Test agent', defaultName: 'Test agent', fallback: FALLBACK, home, key, spawn, log: line => logs.push(line), ...(now ? { now } : {}) })
  return Object.assign(made, { logs })
}

test('a probe is kept on disk, and the next start lists it before the agent answers again', async (t) => {
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const first = catalog(home)
  t.after(() => first.dispose())
  assert.deepEqual((await first.models()).map(model => model.id), ['default', 'fake-large', 'fake-small', 'fake-plain'])
  await first.probing
  const kept = JSON.parse(readFileSync(join(home, 'acp-test.json'), 'utf8'))
  assert.equal(kept.key, 'v1')
  assert.deepEqual(kept.models.find(model => model.id === 'fake-small').reasoning.efforts.map(effort => effort.id), ['low', 'high'])
  assert.equal(kept.models.some(model => 'probed' in model), false)
  // Next start: the agent cannot answer now, yet what it said last time is listed at once.
  const next = catalog(home, { spawn: () => broken, key: () => 'v2' })
  t.after(() => next.dispose())
  assert.deepEqual((await next.models()).map(model => model.id), ['default', 'fake-large', 'fake-small', 'fake-plain'])
  assert.deepEqual((await next.model('fake-small')).reasoning.defaultEffort, 'low')
})

test('an agent that does not answer leaves the stand-ins, and is asked again only after a while', async (t) => {
  let now = 1000
  let spawned = 0
  const made = catalog(undefined, { spawn: () => { spawned++; return broken }, now: () => now })
  t.after(() => made.dispose())
  assert.deepEqual(await made.models(), FALLBACK)
  await made.probing
  assert.match(made.logs.join('\n'), /could not read Test agent's models, offering its usual ones/)
  await made.models()
  assert.equal(spawned, 1)
  now += 11 * 60 * 1000
  await made.models()
  await made.probing
  assert.equal(spawned, 2)
})

test("a new release of the agent's adapter is asked again", async (t) => {
  let key = 'v1'
  let spawned = 0
  const made = catalog(undefined, { spawn: () => { spawned++; return fake }, key: () => key })
  t.after(() => made.dispose())
  await made.models()
  await made.probing
  await made.models()
  assert.equal(spawned, 1)
  key = 'v2'
  await made.models()
  await made.probing
  assert.equal(spawned, 2)
  // No adapter installed: no probe, the stand-ins (or what was read) stay.
  key = undefined
  await made.models()
  assert.equal(made.probing, undefined)
})

test("an agent's own default model is kept as it names it; efforts come per model, its default row left out", async () => {
  // Claude Code's adapter: `default` is one of its models, and each model brings its own efforts.
  const efforts = { default: ['default', 'low', 'high'], opus: ['default', 'low', 'high', 'max'], haiku: [] }
  let model = 'default'
  const option = (category) => {
    if (category === 'model') return { id: 'model', category: 'model', type: 'select', currentValue: model, options: [{ group: 'all', name: 'All', options: Object.keys(efforts).map(value => ({ value, name: value === 'default' ? 'Default (recommended)' : value })) }] }
    if (efforts[model].length === 0) return undefined
    return { id: 'effort', category: 'thought_level', type: 'select', currentValue: model === 'opus' ? 'max' : 'default', options: efforts[model].map(value => ({ value, name: value })) }
  }
  const run = { startModel: 'default', option, setOption: async (category, value) => { model = value } }
  const state = await readCatalog(run, { defaultName: 'Claude Code' })
  assert.equal(state.complete, true)
  assert.deepEqual(state.models.map(entry => [entry.id, entry.name]), [['default', 'Default (recommended)'], ['opus', 'opus'], ['haiku', 'haiku']])
  assert.deepEqual(state.models[0].reasoning, { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] })
  assert.deepEqual(state.models[1].reasoning.defaultEffort, 'max')
  assert.equal(state.models[2].reasoning, undefined)
  assert.equal(reasoningOf(undefined), undefined)
})


test('a kept file of any other shape is not used: the stand-ins answer until a probe writes it again', async (t) => {
  const { writeFileSync } = await import('node:fs')
  const shapes = [
    { models: [null] },
    { models: [{ id: 'opus', name: 'Opus', reasoning: { efforts: 'high' } }] },
    { models: [{ id: 'opus', name: 'Opus', reasoning: { efforts: [{ id: 3, name: 'x' }] } }] },
    { models: [{ id: 'opus', name: 'Opus', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'max' } }] },
    { models: [{ id: 'opus' }] },
    { models: [] },
    'not json',
  ]
  for (const shape of shapes) {
    const home = scratch()
    t.after(() => rmSync(home, { recursive: true, force: true }))
    writeFileSync(join(home, 'acp-test.json'), typeof shape === 'string' ? shape : JSON.stringify({ key: 'v1', ...shape }))
    // No adapter installed: no probe, so only the kept file could answer.
    const made = catalog(home, { key: () => undefined })
    t.after(() => made.dispose())
    assert.deepEqual(await made.models(), FALLBACK, JSON.stringify(shape))
  }
  // A well-formed one is used.
  const home = scratch()
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(join(home, 'acp-test.json'), JSON.stringify({ key: 'v1', models: [{ id: 'opus', name: 'Opus', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } }] }))
  assert.deepEqual((await catalog(home, { key: () => undefined }).models()).map(model => model.id), ['opus'])
})

test("a model's own effort is the one read for it: a probe still reading it is waited on, a stand-in never answers", async (t) => {
  const made = catalog(undefined, { key: () => undefined })
  t.after(() => made.dispose())
  const effort = (id, defaultEffort) => ({ efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }].filter(level => id === 'default' || level.id !== 'medium'), defaultEffort })
  // Mid-probe: the start model is read, the other not yet, so its listed efforts stand in from the start model's.
  made.live = { complete: false, models: [{ id: 'default', name: 'Default', reasoning: effort('default', 'medium'), probed: true }, { id: 'small', name: 'Small', probed: false }] }
  let done
  made.probing = new Promise((resolve) => { done = resolve })
  assert.equal((await made.model('small')).reasoning.defaultEffort, 'medium')
  const own = made.ownEffort('small')
  made.live.models[1] = { id: 'small', name: 'Small', reasoning: effort('small', 'low'), probed: true }
  done()
  assert.equal(await own, 'low')
  assert.equal(await made.ownEffort('default'), 'medium')
  // Nothing read and nothing kept: no own effort, whatever the stand-ins list.
  const cold = catalog(undefined, { key: () => undefined })
  t.after(() => cold.dispose())
  assert.equal(await cold.ownEffort('default'), undefined)
})
