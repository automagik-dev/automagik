// The DeepSeek Harness the app runs is the one its plugins are tested on: the Bot team's
// (apps/bots-dsh/dev/harness) and the carried Omni release's (apps/omni-channels-dsh/dev/harness
// in Omni). prepare-runtime refuses a build where they differ. When the Bot team moves to a
// new DSH, this moves runtime/package.json and its lock with it. The runtime also pins the zod
// DSH's packages pin exactly (one copy instead of one per package): when the new DSH pins
// another, move that pin too (test/prune-runtime.test.js fails until it matches).
//
// Usage: node scripts/follow-dsh.mjs <dsh version>
//   prints `same` when the runtime already pins it, else rewrites the pin, refreshes
//   runtime/package-lock.json with npm and prints `changed`.
// node scripts/follow-dsh.mjs --all <dsh version>
//   also moves the plugins with it: the DSH the Bot team's and the welcome's tests run on
//   (apps/*-dsh/dev/harness) and the DSH range each declares (engines.dsh, see rangeFor), so the
//   whole bump is one change for CI to test and one release.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/

/** The DSH range a plugin tested on `version` declares: from it up to the next patch, previews included. */
export function rangeFor(version) {
  const match = VERSION.exec(String(version ?? '')) && /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`not a dsh version: '${version}'`)
  return `>=${version} <${match[1]}.${match[2]}.${Number(match[3]) + 1}-0`
}

/** A plugin's manifest declaring the range for `version`, or null when it already does. */
export function pinRange(manifest, version) {
  const dsh = rangeFor(version)
  return manifest.engines?.dsh === dsh ? null : { ...manifest, engines: { ...manifest.engines, dsh } }
}

/** The runtime manifest pinned to `version`, or null when it already is. */
export function pinRuntime(manifest, version) {
  if (!VERSION.test(String(version ?? ''))) throw new Error(`not a dsh version: '${version}'`)
  if (manifest.dependencies?.['@deepseek-ai/dsh'] === version) return null
  return { ...manifest, dependencies: { ...manifest.dependencies, '@deepseek-ai/dsh': version } }
}

// The plugins whose tests pin a DSH and whose manifest declares the range.
export const PLUGINS = Object.freeze(['bots-dsh', 'welcome-dsh'])

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = process.argv[2] === '--all'
  const version = process.argv[all ? 3 : 2]
  const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
  const runtime = join(desktop, 'runtime')
  const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
  const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  let changed = false
  const next = pinRuntime(readJson(join(runtime, 'package.json')), version)
  if (next !== null) {
    writeJson(join(runtime, 'package.json'), next)
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' })
    changed = true
  }
  if (all) {
    for (const name of PLUGINS) {
      const plugin = join(desktop, '..', name)
      const harness = pinRuntime(readJson(join(plugin, 'dev', 'harness', 'package.json')), version)
      if (harness !== null) { writeJson(join(plugin, 'dev', 'harness', 'package.json'), harness); changed = true }
      const manifest = pinRange(readJson(join(plugin, 'package.json')), version)
      if (manifest !== null) { writeJson(join(plugin, 'package.json'), manifest); changed = true }
    }
  }
  console.log(changed ? 'changed' : 'same')
}
