import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { noteRestart, restartLine, steps } from '../src/timeline.js'

const folder = () => mkdtempSync(join(tmpdir(), 'automagik-timeline-'))

test('a run of steps says how long after its start each one came, once each', () => {
  const lines = []
  let clock = 10_000
  const run = steps('start', { write: line => lines.push(line), since: 9_000, now: () => clock })
  run.mark('window shown')
  clock = 12_345
  run.mark('page in')
  run.mark('page in')
  assert.deepEqual(lines, [
    `${new Date(10_000).toISOString()} start: window shown +1000 ms\n`,
    `${new Date(12_345).toISOString()} start: page in +3345 ms\n`,
  ])
})

test('an update restart is timed from the copy that asked for it to the one that came back', () => {
  const file = join(folder(), 'restart.json')
  noteRestart(file, { from: '3.14.0', to: '3.15.0', at: 1_000 })
  assert.equal(restartLine(file, { version: '3.15.0', now: 24_400 }),
    `${new Date(24_400).toISOString()} update restart: 3.14.0 → 3.15.0, back after 23.4 s\n`)
  assert.equal(existsSync(file), false)
  assert.equal(restartLine(file, { version: '3.15.0', now: 30_000 }), null)
})

test('a restart that came back on the old copy says the update did not take', () => {
  const file = join(folder(), 'restart.json')
  noteRestart(file, { from: '3.14.0', to: '3.15.0', at: 0 })
  assert.match(restartLine(file, { version: '3.14.0', now: 5_000 }), /3\.14\.0 came back \(the update did not take\)/)
})

test('a note that is not one is dropped without a line', () => {
  const file = join(folder(), 'restart.json')
  writeFileSync(file, 'not json')
  assert.equal(restartLine(file, { version: '3.15.0' }), null)
  assert.equal(existsSync(file), false)
})
