#!/usr/bin/env node
// Install the newest ACP adapters through the plugin's own AdapterStore into a home of the
// caller's choosing, and print where each landed. The daily compatibility run uses it, so what
// it starts is what an installed app would have installed today (#958).
//
//   node dev/install-adapters.mjs <home>
//
// Prints one `NAME=value` line per fact, ready for a CI environment file:
//   AUTOMAGIK_TEST_CLAUDE_ACP, AUTOMAGIK_TEST_CODEX_ACP   each adapter's entry script
//   ACP_CLAUDE_VERSION, ACP_CODEX_VERSION                 the versions installed
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { AGENTS } from '../src/host/agents.js'
import { AdapterStore } from '../src/host/install.js'

const home = process.argv[2]
if (!home) {
  console.error('usage: node dev/install-adapters.mjs <home>')
  process.exit(2)
}
mkdirSync(resolve(home), { recursive: true })
const store = new AdapterStore({ home: resolve(home), log: message => console.error(`install-adapters: ${message}`) })
for (const spec of Object.values(AGENTS)) {
  // An agent whose CLI is itself the ACP server (Hermes, Antigravity, omp) has no adapter
  // package: there is nothing to install for it, and no line to print.
  if (typeof spec.adapter !== 'string') continue
  const found = await store.update(spec.adapter, spec.bin)
  const key = spec.key.toUpperCase()
  console.log(`AUTOMAGIK_TEST_${key}_ACP=${found.path}`)
  console.log(`ACP_${key}_VERSION=${found.version}`)
}
