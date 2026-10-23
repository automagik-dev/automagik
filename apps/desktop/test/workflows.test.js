import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The input names declared under one trigger (`on.<trigger>.inputs`) of a workflow file.
function inputsOf(text, trigger) {
  const block = text.split('\n').reduce((state, line) => {
    if (state.done) return state
    if (line === `  ${trigger}:`) return { ...state, inside: true }
    if (state.inside && /^ {0,2}\S/.test(line)) return { ...state, done: true }
    if (state.inside) {
      const name = line.match(/^ {6}([A-Za-z_][\w-]*):\s*$/)
      if (name) state.names.add(name[1])
    }
    return state
  }, { inside: false, done: false, names: new Set() })
  return block.names
}

test('desktop-build.yml declares every input it reads for release.yml, which calls it', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  const read = new Set([...text.matchAll(/inputs\.([A-Za-z_][\w-]*)/g)].map(match => match[1]))
  // An input a caller cannot see reads as '', which equals false: `publish != false` was
  // false for every release follow-omni made, and they were never published.
  for (const trigger of ['workflow_call', 'workflow_dispatch']) {
    const declared = inputsOf(text, trigger)
    assert.deepEqual([...read].filter(name => !declared.has(name)), [], `${trigger} lacks inputs the jobs read`)
  }
})

test('release.yml declares every input it reads for follow-omni, which calls it', () => {
  const text = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const read = new Set([...text.matchAll(/inputs\.([A-Za-z_][\w-]*)/g)].map(match => match[1]))
  for (const trigger of ['workflow_call', 'workflow_dispatch']) {
    const declared = inputsOf(text, trigger)
    assert.deepEqual([...read].filter(name => !declared.has(name)), [], `${trigger} lacks inputs the jobs read`)
  }
})

test('a desktop rebuild keeps the plugins its release carries', () => {
  const text = readFileSync(new URL('../../../.github/workflows/desktop-build.yml', import.meta.url), 'utf8')
  assert.match(text, /case "\$\{name\}" in automagik-\*\.tgz\|plugins\.json\|PLUGINS\.SHA256SUMS\) continue ;; esac/)
})
