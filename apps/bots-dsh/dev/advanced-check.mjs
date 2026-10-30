// Explicit opt-in integration fixture. Never uses dev/check.sh, bench.sh, live DSH or CDP.
// Run from the supplied checkout: node <absolute path>/dev/advanced-check.mjs --run
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkBotInteractions, checkPlainInteractions, checkRestartPersistence } from './advanced-fixture/interactions.mjs'

const plugin = dirname(dirname(fileURLToPath(import.meta.url)))
const root = resolve(plugin, '../..')
const cli = join(plugin, 'dev/harness/node_modules/@deepseek-ai/dsh/lib/bin.js')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const guard = join(plugin, 'dev/advanced-fixture/loopback-only.mjs')
const redact = value => String(value).replace(/token=[^\s&"'<>]+/g, 'token=[redacted]')
if (process.argv.length !== 3 || process.argv[2] !== '--run') {
  console.log('Preparation only. Execution requires explicit approval, then --run. No services started.')
  process.exit(2)
}
assert.equal(resolve(process.cwd()), root, 'Run only from the approved checkout root')
await Promise.all([access(cli), access(chrome), access(join(plugin, 'client.js'))])
const manifest = JSON.parse(await readFile(join(dirname(dirname(cli)), 'package.json'), 'utf8'))
assert.equal(manifest.version, '0.2.1-rc.4', 'Do not silently upgrade the fixture runtime')
const { chromium } = await import('playwright-core')
const parent = join(root, '.tools/advanced-fixture')
await mkdir(parent, { recursive: true })
const fixture = await mkdtemp(join(parent, 'run-'))
assert.ok(fixture.startsWith(`${parent}${sep}`))
// Playwright itself creates temporary artifact directories in its parent process.
await mkdir(join(fixture, 'tmp'), { recursive: true })
process.env.TMPDIR = join(fixture, 'tmp')
const children = []
const contexts = []
const launches = new Set()
let cleanupPromise
const results = []
const blocked = []
const browserDiagnostics = []
let stopping = false
let failed = false
let plainFocus

function environment(home) {
  // No credentials, desktop flags, proxy, NODE_OPTIONS, CDP, session IDs or inherited PATH.
  return {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8', TZ: 'UTC',
    HOME: join(home, 'home'), DSH_HOME: join(home, 'dsh'),
    AUTOMAGIK_HOME: join(home, 'automagik'), AUTOMAGIK_BOTS_HOME: join(home, 'bots'),
    OMNI_HOME: join(home, 'omni'), XDG_CONFIG_HOME: join(home, 'config'),
    XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'),
    TMPDIR: join(home, 'tmp'), PNPM_HOME: join(home, 'pnpm'),
    npm_config_cache: join(home, 'npm-cache'), npm_config_store_dir: join(home, 'pnpm-store'),
    npm_config_userconfig: join(home, 'npmrc'), npm_config_globalconfig: join(home, 'global-npmrc'),
    COREPACK_HOME: join(home, 'corepack'), COREPACK_ENABLE_NETWORK: '0', npm_config_update_notifier: 'false',
    DSH_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', ADVANCED_FIXTURE_ROOT: fixture,
  }
}
async function prepareHome(name) {
  const home = join(fixture, name)
  const env = environment(home)
  await mkdir(home, { recursive: true })
  for (const key of ['HOME', 'DSH_HOME', 'AUTOMAGIK_HOME', 'AUTOMAGIK_BOTS_HOME', 'OMNI_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'PNPM_HOME', 'npm_config_cache', 'npm_config_store_dir', 'COREPACK_HOME']) await mkdir(env[key], { recursive: true })
  await mkdir(join(env.HOME, 'native-workspace'), { recursive: true })
  await writeFile(env.npm_config_userconfig, '')
  await writeFile(env.npm_config_globalconfig, '')
  return { home, env }
}
function start(name, args, home, env) {
  assert.ok(!stopping, 'Fixture is stopping; refuse another child')
  // Child cwd is indispensable: DSH loadLayeredEnv reads cwd/.env even with an env allowlist.
  // Parent invocation stays in root; an empty owned child cwd prevents checkout .env leakage.
  const child = spawn(process.execPath, ['--import', guard, ...args], {
    cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const job = { name, child, output: '', ended: null, exitCode: null }
  children.push(job)
  const record = chunk => { job.output += chunk; if (job.output.length > 2_000_000) job.output = job.output.slice(-2_000_000) }
  child.stdout.on('data', record)
  child.stderr.on('data', record)
  job.ended = new Promise(done => {
    child.once('error', error => { job.error = error; done() })
    child.once('close', code => { job.exitCode = code; done() })
  })
  return job
}
async function until(label, probe, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    assert.ok(!stopping, 'Fixture interrupted')
    const value = await probe()
    if (value) return value
    // Bounded readiness backoff, not a background-job polling loop.
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
async function outputMatch(job, expression) {
  return until(`${job.name} startup`, () => {
    const match = job.output.match(expression)
    if (match) return match
    if (job.error || job.child.exitCode !== null) throw new Error(`${job.name} exited before startup: ${redact(job.output)}`)
    return null
  })
}
async function stop(job) {
  if (!job.child.pid || job.stopped) return
  job.stopped = true
  // Only a process group we created ourselves; never read a shared pidfile or kill by name.
  try { process.kill(-job.child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  let timer
  await Promise.race([job.ended, new Promise(done => { timer = setTimeout(done, 5000) })])
  clearTimeout(timer)
  // Include descendants even if the group leader already exited but its pipes remain open.
  try { process.kill(-job.child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await job.ended
}
function cleanup() {
  if (cleanupPromise) return cleanupPromise
  stopping = true
  cleanupPromise = (async () => {
    // Include launches in flight: a signal must not orphan Chrome before its context resolves.
    const cleanupFailure = error => { failed = true; results.push({ ok: false, message: `Cleanup: ${redact(error.message)}` }) }
    for (const launch of [...launches]) await launch.then(context => context.close()).catch(cleanupFailure)
    for (const context of [...contexts].reverse()) await context.close().catch(cleanupFailure)
    // One failure must never prevent cleanup of the remaining owned process groups.
    for (const child of [...children].reverse()) await stop(child).catch(cleanupFailure)
    for (const job of children) await writeFile(join(fixture, `${job.name}.log`), redact(job.output)).catch(cleanupFailure)
  })()
  return cleanupPromise
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  failed = true
  void cleanup().finally(() => process.exit(130))
})
function check(ok, message, evidence = {}) {
  results.push({ message, ok: Boolean(ok), ...evidence })
  assert.ok(ok, message)
  console.log(`ok ${message}`)
}
async function browser(name, login, env) {
  const url = new URL(login)
  assert.equal(url.hostname, '127.0.0.1')
  assert.ok(!['60237', '55677', '56091'].includes(url.port), 'Never access a live GUI port')
  assert.ok(!stopping, 'Fixture is stopping; refuse browser launch')
  const launch = chromium.launchPersistentContext(join(fixture, `${name}-chrome-profile`), {
    executablePath: chrome, env, headless: true, viewport: { width: 1440, height: 960 },
    locale: 'en-US', colorScheme: 'light', reducedMotion: 'reduce',
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    serviceWorkers: 'block',
  })
  launches.add(launch)
  let context
  try { context = await launch } finally { launches.delete(launch) }
  if (stopping) { await context.close(); throw new Error('Fixture interrupted during Chrome launch') }
  contexts.push(context)
  const ownedOrigin = url.origin
  await context.route('**/*', route => {
    const request = new URL(route.request().url())
    if (request.origin === ownedOrigin || ['data:', 'blob:', 'about:'].includes(request.protocol)) return route.continue()
    blocked.push({ browser: name, origin: request.origin })
    return route.abort('blockedbyclient')
  })
  await context.routeWebSocket('**/*', socket => {
    const ws = new URL(socket.url())
    if (['ws:', 'wss:'].includes(ws.protocol) && ws.host === url.host) socket.connectToServer()
    else { blocked.push({ browser: name, origin: ws.origin }); socket.close() }
  })
  const observe = page => {
    page.on('pageerror', error => browserDiagnostics.push({ browser: name, kind: 'pageerror', text: redact(error.message) }))
    page.on('console', message => {
      if (browserDiagnostics.length < 500) browserDiagnostics.push({ browser: name, kind: `console:${message.type()}`, text: redact(message.text()).slice(0, 4000) })
    })
  }
  context.pages().forEach(observe)
  context.on('page', observe)
  const page = context.pages()[0] ?? await context.newPage()
  page.setDefaultTimeout(15_000)
  await page.goto(login)
  const api = async (endpoint, payload = {}) => {
    const result = await page.evaluate(async ({ endpoint, payload }) => {
      const response = await fetch('/api/omni-ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })
      return response.json()
    }, { endpoint, payload })
    assert.equal(result.ok, true, `${endpoint}: ${result.error?.message ?? 'request refused'}`)
    return result.value
  }
  const probeStatus = () => Object.fromEntries(['PROBE_APPLIED', 'VIEW_REGISTERED', 'ACTION_REGISTERED'].map(marker => [marker, browserDiagnostics.filter(event => event.browser === name && event.text === `ADVANCED_FIXTURE_${marker}`).length]))
  return { context, page, api, check, until, fixture, probeStatus }
}
try {
  const mockHome = await prepareHome('mock')
  const mock = start('mock', [join(plugin, 'dev/mock-llm.mjs')], mockHome.home, {
    ...mockHome.env, MOCK_PORT: '0', MOCK_LOG: join(fixture, 'mock.jsonl'),
    MOCK_DELAY_MS: '50', MOCK_JITTER_MS: '0', MOCK_NATIVE_SEARCH: 'off', MOCK_LOG_TOOLS: '1',
  })
  const mockPort = (await outputMatch(mock, /ds-bot mock on http:\/\/127\.0\.0\.1:(\d+)\/v1/))[1]
  const patch = join(fixture, 'fixture.patch.yml')
  await writeFile(patch, `- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: '2026-09-28.1'\n- id: ui-settings-models\n  config:\n    credentialOnboarding: false\n`)
  for (const name of ['plain', 'bots']) {
    const { home, env } = await prepareHome(name)
    {
      // Public dsh plugin -> pnpm; plain has only a host data seed, no Bot/client override.
      const sources = name === 'bots' ? [plugin, join(plugin, 'dev/advanced-fixture/probe')] : [join(plugin, 'dev/advanced-fixture/seed')]
      const install = start(`plugin-link-${name}`, [cli, 'plugin', '--profile', 'web', 'add', '--offline', '--ignore-scripts', ...sources.map(path => `link:${path}`)], home, env)
      await Promise.race([install.ended, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Plugin link exceeded 60 seconds')), 60_000)
        timer.unref()
      })])
      assert.equal(install.exitCode, 0, `Supported source link failed; no install fallback allowed: ${redact(install.output)}`)
      const profile = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/package.json'), 'utf8'))
      if (name === 'bots') check(profile.dependencies['@automagik/bots-dsh'] === `link:${plugin}`, 'Profile uses supported pnpm link to checkout')
      else check(!profile.dependencies['@automagik/bots-dsh'] && !profile.dsh.profile.bundles.includes('@automagik/bots-dsh'), 'Plain profile has only native services plus host-only public-API data seed, no Bot plugin')
    }
    const runtime = start(name, [cli, '--profile', 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', '0'], home, {
      ...env, DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}/v1`, DEEPSEEK_API_KEY: 'mock-key',
      ADVANCED_FIXTURE_PORTS: mockPort,
    })
    const login = (await outputMatch(runtime, /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*token=\S+)/))[1]
    const app = await browser(name, login, env)
    let persisted
    if (name === 'plain') {
      const seed = JSON.parse((await outputMatch(runtime, /ADVANCED_FIXTURE_SEED (\{[^\n]+\})/))[1])
      assert.equal(seed.path, join(env.HOME, 'native-workspace'), 'Native seed must use only the owned workspace')
      plainFocus = await checkPlainInteractions({ ...app, seed })
    }
    else persisted = await checkBotInteractions({ ...app, plainFocus })
    await app.context.close()
    contexts.splice(contexts.indexOf(app.context), 1)
    await stop(runtime)
    if (persisted) {
      const restarted = start('bots-restarted', [cli, '--profile', 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', '0'], home, {
        ...env, DEEPSEEK_BASE_URL: `http://127.0.0.1:${mockPort}/v1`, DEEPSEEK_API_KEY: 'mock-key', ADVANCED_FIXTURE_PORTS: mockPort,
      })
      const restartLogin = (await outputMatch(restarted, /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*token=\S+)/))[1]
      const restartedApp = await browser('bots-restarted', restartLogin, env)
      await checkRestartPersistence(restartedApp, persisted)
      await restartedApp.context.close()
      contexts.splice(contexts.indexOf(restartedApp.context), 1)
      await stop(restarted)
    }
  }
  const native = await readFile(join(plugin, 'dev/harness/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js'), 'utf8')
  check(native.includes('[data-platform=darwin]') && native.includes('--dsh-dockkit-strip-inline-start:88px') && native.includes('[data-fullscreen]'), 'Pinned native macOS strip CSS source contract exists (not OS traffic-light proof)')
  const calls = (await readFile(join(fixture, 'mock.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
  check(calls.length > 0, 'Bot interactions reached the owned synthetic mock', { calls: calls.length })
  console.log('Synthetic integration only; native Electron traffic lights and effectiveness parity are not claimed.')
} catch (error) {
  failed = true
  results.push({ ok: false, message: redact(error.stack ?? error) })
  console.error(redact(error.stack ?? error))
  // Failure diagnostics only, from contexts this runner owns; never screenshot-as-pass proof.
  for (const [contextIndex, context] of contexts.entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      const stem = join(fixture, `failure-page-${contextIndex}-${pageIndex}`)
      try { await writeFile(`${stem}.html`, redact(await page.content())) }
      catch (diagnostic) { results.push({ ok: false, message: `HTML diagnostic: ${redact(diagnostic.message)}` }) }
      try { await page.screenshot({ path: `${stem}.png`, timeout: 5000 }) }
      catch (diagnostic) { results.push({ ok: false, message: `Screenshot diagnostic: ${redact(diagnostic.message)}` }) }
    }
  }
} finally {
  await cleanup()
  await writeFile(join(fixture, 'results.json'), JSON.stringify({ passed: !failed, results, blocked, browserDiagnostics, nativeFocusBaseline: plainFocus, limitations: ['Chrome does not prove native Electron/macOS traffic lights', 'Mock usage is synthetic, not effectiveness parity', ...(plainFocus && !plainFocus.automatic.visibleControl ? ['Same-run plain native toggle collapse did not automatically restore visible focus; only equal-or-better Bot behavior, actual Tab recovery and keyboard reopen are asserted. Independent criterion acceptance required.'] : [])] }, null, 2))
  console.log(`Fixture evidence: ${fixture}`)
}
process.exitCode = failed ? 1 : 0
