// dev/install-adapters.mjs, the script the daily ACP compatibility run starts with (#958): it
// installs the agents that have an adapter and passes over the ones that run natively (#1110).
// The script itself runs here, on the real AdapterStore, in a scratch home whose adapters were
// checked a moment ago, so it has nothing to ask npm; a `fetch` that throws makes sure of that.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { AGENTS, isNative } from '../src/host/agents.js'
import { AdapterStore } from '../src/host/install.js'

const SCRIPT = resolve(import.meta.dirname, '..', 'dev', 'install-adapters.mjs')
const NO_NETWORK = 'no network in this test'
const BLOCK = `data:text/javascript,globalThis.fetch = () => { throw new Error(${JSON.stringify(NO_NETWORK)}) }`
const run = home => spawnSync(process.execPath, ['--import', BLOCK, SCRIPT, home], { encoding: 'utf8', timeout: 30_000 })
const scratch = () => mkdtempSync(join(tmpdir(), 'acp-dsh-install-adapters-'))
// A package manager that "installs" whatever package.json asks for: one entry script per dep.
const fakeInstall = async (dir) => {
  const { dependencies } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const [pkg, version] of Object.entries(dependencies)) {
    const root = join(dir, 'node_modules', ...pkg.split('/'))
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'index.js'), `// ${pkg}@${version}\n`)
  }
}

test('the script installs the agents that have an adapter and passes over the native ones', async () => {
  const native = Object.values(AGENTS).filter(isNative).map(spec => spec.key)
  assert.deepEqual(native, ['hermes', 'antigravity', 'omp'], 'the native agents this test is about')
  const home = scratch()
  try {
    const versions = { 'acp-claude': '1.2.3', 'acp-codex': '4.5.6' }
    const seeded = {}
    for (const [id, version] of Object.entries(versions)) {
      const store = new AdapterStore({ home, latest: async () => version, install: fakeInstall })
      seeded[id] = await store.update(AGENTS[id].adapter, AGENTS[id].bin)
      assert.equal(seeded[id].version, version)
    }
    const result = run(home)
    assert.equal(result.status, 0, `the script failed:\n${result.stderr}`)
    assert.deepEqual(result.stdout.split('\n'), [
      `AUTOMAGIK_TEST_CLAUDE_ACP=${seeded['acp-claude'].path}`,
      'ACP_CLAUDE_VERSION=1.2.3',
      `AUTOMAGIK_TEST_CODEX_ACP=${seeded['acp-codex'].path}`,
      'ACP_CODEX_VERSION=4.5.6',
      '',
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the script has no network here: with nothing installed it stops at the first adapter', () => {
  const home = scratch()
  try {
    const result = run(home)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, new RegExp(NO_NETWORK))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
