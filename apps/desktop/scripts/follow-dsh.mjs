// The DeepSeek Harness the app runs is the one its plugins are tested on: the Bot team's
// (apps/bots-dsh/dev/harness) and the carried Omni release's (apps/omni-channels-dsh/dev/harness
// in Omni). prepare-runtime refuses a build where they differ. When the Bot team moves to a
// new DSH, this moves runtime/package.json and its lock with it.
//
// Usage: node scripts/follow-dsh.mjs <dsh version>
//   prints `same` when the runtime already pins it, else rewrites the pin, refreshes
//   runtime/package-lock.json with npm and prints `changed`.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/

/** The runtime manifest pinned to `version`, or null when it already is. */
export function pinRuntime(manifest, version) {
  if (!VERSION.test(String(version ?? ''))) throw new Error(`not a dsh version: '${version}'`)
  if (manifest.dependencies?.['@deepseek-ai/dsh'] === version) return null
  return { ...manifest, dependencies: { ...manifest.dependencies, '@deepseek-ai/dsh': version } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtime = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')
  const file = join(runtime, 'package.json')
  const next = pinRuntime(JSON.parse(readFileSync(file, 'utf8')), process.argv[2])
  if (next === null) {
    console.log('same')
  } else {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' })
    console.log('changed')
  }
}
