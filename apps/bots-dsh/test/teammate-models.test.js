// Agent Teams teammates on their own LLM route: the desktop app's runtime patch
// (apps/desktop/runtime/patches) on this harness's DSH, booted headless against the mock model
// with two providers. The patched files load in place of the harness's own (same URLs, so their
// imports resolve as before); the harness itself is not changed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchRuntime } from '../../desktop/scripts/runtime-patches.mjs'

const MOCK = fileURLToPath(new URL('../dev/mock-llm.mjs', import.meta.url))
const PATCHES = fileURLToPath(new URL('../../desktop/runtime/patches', import.meta.url))
const MODULES = join(process.env.DSH_HARNESS, 'node_modules')
const BIN = join(MODULES, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const HOOK = `import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
const swap = new Map(JSON.parse(process.env.TEAM_PATCHED))
registerHooks({ load(url, context, next) {
  const file = swap.get(url.split('?')[0])
  return file === undefined ? next(url, context) : { format: 'module', source: readFileSync(file, 'utf8'), shortCircuit: true }
} })`

function startMock(t, home) {
  const mock = spawn(process.execPath, [MOCK], {
    env: { ...process.env, MOCK_PORT: '0', MOCK_LOG: join(home, 'mock.jsonl'), MOCK_DELAY_MS: '40', MOCK_JITTER_MS: '0' },
  })
  t.after(() => mock.kill())
  mock.stderr.on('data', chunk => process.stderr.write(chunk))
  return new Promise((resolve, reject) => {
    mock.stdout.on('data', chunk => {
      const found = /127\.0\.0\.1:(\d+)\/v1/.exec(String(chunk))
      if (found !== null) resolve(Number(found[1]))
    })
    mock.once('exit', code => reject(new Error(`mock-llm exited ${code}`)))
  })
}

// Two providers on the mock (/a and /b), three allowed routes, and omega left off the list.
const overlay = port => `- id: agent-default-model
  config: { provider: mock-a, model: alpha, reasoningEffort: low }
- id: session-title-llm
  disabled: true
- id: llm-pi-ai
  config:
    providers:
      mock-a:
        api: anthropic-messages
        apiKeyEnv: MOCK_KEY
        baseURL: http://127.0.0.1:${port}/a
        models:
          - { id: alpha, contextWindow: 200000, reasoningEfforts: { low: low, high: high } }
          - { id: gamma, contextWindow: 200000, reasoningEfforts: { medium: medium, high: high } }
      mock-b:
        api: anthropic-messages
        apiKeyEnv: MOCK_KEY
        baseURL: http://127.0.0.1:${port}/b
        models:
          - { id: beta, contextWindow: 200000, reasoningEfforts: { medium: medium, max: max } }
          - { id: omega, contextWindow: 200000 }
- insert:
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
      config:
        enabled: true
        allowedModels:
          - { provider: mock-a, model: alpha }
          - { provider: mock-a, model: gamma }
          - { provider: mock-b, model: beta }
`

// One headless run, as its JSON events.
function dsh(home, swap, args) {
  const child = spawn(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(HOOK)}`,
    BIN, '--profile', 'headless', '--patch', join(home, 'overlay.yml'), '--json', ...args,
  ], {
    cwd: join(home, 'work'),
    env: { ...process.env, HOME: home, DSH_HOME: join(home, 'dsh'), MOCK_KEY: 'mock-key', DO_NOT_TRACK: '1', DSH_TELEMETRY_DISABLED: '1', TEAM_PATCHED: JSON.stringify(swap) },
  })
  let out = ''
  let err = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.stderr.on('data', chunk => { err += chunk })
  return new Promise((resolve, reject) => {
    child.once('exit', code => {
      if (code !== 0) return reject(new Error(`dsh headless exited ${code}: ${err.slice(-2000)}`))
      resolve(out.trim().split('\n').map(line => JSON.parse(line)))
    })
  })
}
const results = (events, tool) => events.filter(event => event.type === 'tool_result'
  && events.some(call => call.type === 'tool_call' && call.callId === event.callId && call.tool === tool))
const routes = rows => Object.fromEntries(rows.map(({ target, llmProvider, model, reasoningEffort }) => [target, { llmProvider, model, reasoningEffort }]))

test('fresh teammates keep their own LLM route through follow-ups and a cold resume', { timeout: 120_000, skip: !existsSync(BIN) && 'needs an installed harness (bun run harness)' }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsb-teammates-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }))
  // The harness may hold another RC of the same files; their hashes are what the patch checks.
  const swap = patchRuntime(MODULES, PATCHES, { versions: false, write: false }).map(({ name, path, text }) => {
    const file = join(home, name.replaceAll('/', '_'))
    writeFileSync(file, text)
    return [pathToFileURL(path).href, file]
  })
  writeFileSync(join(home, 'overlay.yml'), overlay(await startMock(t, home)))
  mkdirSync(join(home, 'work'))
  mkdirSync(join(home, 'dsh', 'profiles', 'headless'), { recursive: true })
  writeFileSync(join(home, 'dsh', 'profiles', 'headless', 'package.json'), JSON.stringify({
    name: 'dsh-profile-headless', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-experimental-agent-team-profile'] } },
  }))

  const job = { description: 'Say hello', prompt: '说你好' }
  const plan = {
    spawn: [
      { name: 'alpha', ...job, llm_provider: 'mock-b', model: 'beta', reasoning_effort: 'max' },
      { name: 'bravo', ...job, llm_provider: 'mock-a', model: 'gamma' },
      { name: 'heir', ...job },
      { name: 'off-list', ...job, llm_provider: 'mock-b', model: 'omega' },
      { name: 'turbo', ...job, llm_provider: 'mock-b', model: 'beta', reasoning_effort: 'turbo' },
      { name: 'forked', ...job, context: 'fork', llm_provider: 'mock-b', model: 'beta' },
    ],
    followUp: ['alpha', 'bravo', 'heir'],
  }
  const first = await dsh(home, swap, [`组队 ${JSON.stringify(plan)}`])
  const readLog = () => readFileSync(join(home, 'mock.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.team)
  const before = readLog().length
  // A new process: no teammate is loaded until the Lead's message cold-resumes alpha.
  const second = await dsh(home, swap, ['--session-id', first.find(event => event.type === 'session').sessionId, '唤醒 alpha'])

  const expected = {
    lead: { llmProvider: 'mock-a', model: 'alpha', reasoningEffort: 'low' },
    alpha: { llmProvider: 'mock-b', model: 'beta', reasoningEffort: 'max' },
    bravo: { llmProvider: 'mock-a', model: 'gamma', reasoningEffort: undefined },
    heir: { llmProvider: 'mock-a', model: 'alpha', reasoningEffort: 'low' },
  }
  const spawned = results(first, 'spawn_teammate')
  assert.deepEqual(routes(spawned.filter(result => result.status === 'completed').map(result => JSON.parse(result.result).member)),
    { alpha: expected.alpha, bravo: expected.bravo, heir: expected.heir })
  assert.deepEqual(spawned.filter(result => result.status === 'error').map(result => result.result), [
    'Error: teammate LLM route "mock-b/omega" is not allowed; list_teammate_models shows the allowed routes',
    'Error: provider "mock-b" model "beta" does not support reasoning effort "turbo"',
    'Error: a fork teammate keeps the Team Lead\'s LLM route: omit llm_provider, model, and reasoning_effort, or use context "fresh"',
  ])
  // The roster read from the child Sessions' descriptors before any teammate was loaded again.
  assert.deepEqual(routes(JSON.parse(results(second, 'list_agents')[0].result)), expected)

  // What each member actually sent: one route each, before and after the cold resume.
  const log = readLog()
  const sent = {}
  for (const entry of log) (sent[entry.team] ??= new Set()).add(JSON.stringify([entry.path, entry.model, entry.thinking ?? null]))
  const only = member => { assert.equal(sent[member].size, 1, `${member} sent on ${[...sent[member]].join(' and ')}`); return JSON.parse([...sent[member]][0]) }
  const [lead, alpha, bravo, heir] = ['lead', 'alpha', 'bravo', 'heir'].map(only)
  assert.deepEqual([lead[0], lead[1], alpha[0], alpha[1], bravo[0], bravo[1], bravo[2]], ['/a/v1/messages', 'alpha', '/b/v1/messages', 'beta', '/a/v1/messages', 'gamma', null])
  assert.notDeepEqual(alpha[2], lead[2])
  assert.deepEqual(heir, lead)
  const count = (entries, member) => entries.filter(entry => entry.team === member).length
  for (const member of ['alpha', 'bravo', 'heir']) assert.ok(count(log.slice(0, before), member) >= 2, `${member} answered its prompt and the follow-up`)
  assert.ok(count(log.slice(before), 'alpha') >= 1, 'alpha answered after the cold resume')
})
