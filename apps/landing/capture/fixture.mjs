// The isolated runtime the landing captures render in: relocated homes, an allowlisted
// environment, an owned empty cwd per child, loopback-only sockets (the advanced fixture's
// fence), a fresh browser profile with every non-owned origin blocked, and the real plugins
// at their pinned release sources. Shared by capture.mjs; nothing here touches a live DSH,
// the installed app or its profile.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export const root = resolve(here, '../../..')
export const bots = join(root, 'apps/bots-dsh')
export const welcome = join(root, 'apps/welcome-dsh')
export const cli = join(bots, 'dev/harness/node_modules/@deepseek-ai/dsh/lib/bin.js')
export const guard = join(bots, 'dev/advanced-fixture/loopback-only.mjs')
export const chrome = process.env.LANDING_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const redact = value => String(value).replace(/token=[^\s&"'<>]+/g, 'token=[redacted]')
// Ports of live DSH GUIs on the maintainers' machines: never touched.
const LIVE_PORTS = ['60237', '55677', '56091']

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const json = async path => JSON.parse(await readFile(path, 'utf8'))

// The runtime the plugins declare, never a silent upgrade: the harness the Bot team tests
// against and the runtime the desktop app ships must name one version, and the installed
// harness must be exactly it.
export async function declaredRuntime() {
  const harness = (await json(join(bots, 'dev/harness/package.json'))).dependencies['@deepseek-ai/dsh']
  const desktop = (await json(join(root, 'apps/desktop/runtime/package.json'))).dependencies['@deepseek-ai/dsh']
  assert.equal(harness, desktop, 'The Bot team harness and the desktop runtime declare different DSH versions')
  const installed = (await json(join(dirname(dirname(cli)), 'package.json'))).version
  assert.equal(installed, harness, `Installed harness ${installed} is not the declared ${harness}: run bun run harness in apps/bots-dsh`)
  return installed
}

// The plugin sources, each at the commit the market index pins for it.
export async function pinnedSources(fixture, { includeGenie = true } = {}) {
  const market = await json(join(root, 'marketplace/automagik.json'))
  const latest = name => {
    const entry = market.plugins.find(plugin => plugin.name === name)
    assert.ok(entry, `${name} is not in the market index`)
    return { version: entry.versions[0].version, ...entry.versions[0].source }
  }
  const sources = {}
  for (const [name, dir] of [['@automagik/bots-dsh', bots], ['@automagik/welcome-dsh', welcome]]) {
    const pin = latest(name)
    // The checkout's plugin folder is linked (it has its own node_modules), so every file the
    // package ships (package.json and its "files") must be the pinned release's, unmodified.
    git(root, 'cat-file', '-e', `${pin.commit}^{commit}`)
    const manifest = await json(join(dir, 'package.json'))
    assert.equal(manifest.version, pin.version)
    const shipped = ['package.json', ...manifest.files].map(file => `${pin.path}/${file.replace(/\/$/, '')}`)
    assert.equal(git(root, 'diff', '--name-only', pin.commit, '--', ...shipped), '', `${pin.path} ships files that differ from its pinned release ${pin.commit}`)
    assert.equal(git(root, 'status', '--porcelain', '--', ...shipped), '', `${pin.path} has uncommitted changes in shipped files`)
    sources[name] = { dir, ...pin, tree: git(root, 'rev-parse', `${pin.commit}:${pin.path}`) }
  }
  if (!includeGenie) return sources
  // Genie's plugin lives in the genie repository: exported from a local clone at exactly the
  // pinned commit (GENIE_REPO, default the sibling checkout), never from its working tree.
  const genie = latest('@automagik/genie-dsh')
  // (beside the main checkout, so a linked worktree finds it too).
  const mainCheckout = dirname(resolve(root, git(root, 'rev-parse', '--git-common-dir')))
  const genieRepo = process.env.GENIE_REPO ?? resolve(mainCheckout, '../genie')
  assert.ok(existsSync(join(genieRepo, '.git')), `No genie clone at ${genieRepo} (set GENIE_REPO)`)
  git(genieRepo, 'cat-file', '-e', `${genie.commit}^{commit}`)
  const genieDir = join(fixture, 'sources/genie-dsh')
  await mkdir(genieDir, { recursive: true })
  execFileSync('sh', ['-c', `git -C "$1" archive "$2:$3" | tar -x -C "$4"`, 'sh', genieRepo, genie.commit, genie.path, genieDir])
  assert.equal((await json(join(genieDir, 'package.json'))).version, genie.version)
  sources['@automagik/genie-dsh'] = { dir: genieDir, ...genie, tree: git(genieRepo, 'rev-parse', `${genie.commit}:${genie.path}`) }
  return sources
}

// Chrome on Linux binds a socket under its TMPDIR, and a socket path holds about a hundred
// characters: the browser's temp folder is the short one at the top of the run's own folder.
const browserTmp = fixture => resolve(fixture, '../../..', 'c')

// Outside the checkout: a DSH session reads AGENTS.md from every folder above its own, and
// the repository's must not reach the fictional person's Bots. The fence requires the
// `.tools/advanced-fixture` segment.
export async function createFixture() {
  // LANDING_FIXTURE_BASE: another scratch folder outside the checkout, where /tmp is small.
  const base = await mkdtemp(join(realpathSync(process.env.LANDING_FIXTURE_BASE ?? '/tmp'), 'am-landing-'))
  await mkdir(browserTmp(join(base, '.tools/advanced-fixture/run')))
  const parent = join(base, '.tools/advanced-fixture')
  await mkdir(parent, { recursive: true })
  const fixture = await mkdtemp(join(parent, 'run-'))
  assert.ok(fixture.startsWith(`${parent}${sep}`))
  for (let dir = fixture; dir !== dirname(dir); dir = dirname(dir)) assert.ok(!existsSync(join(dir, 'AGENTS.md')) && !existsSync(join(dir, 'CLAUDE.md')), `Instructions file above the fixture in ${dir}`)
  await mkdir(join(fixture, 'tmp'), { recursive: true })
  process.env.TMPDIR = join(fixture, 'tmp')
  return fixture
}

// A neutral person: HOME is /…/fixture/<name>/home, never the maintainer's.
export function environment(fixture, home) {
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
    GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    DSH_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', ADVANCED_FIXTURE_ROOT: fixture,
  }
}

export async function prepareHome(fixture, name) {
  const home = join(fixture, name)
  const env = environment(fixture, home)
  for (const key of ['HOME', 'DSH_HOME', 'AUTOMAGIK_HOME', 'AUTOMAGIK_BOTS_HOME', 'OMNI_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'PNPM_HOME', 'npm_config_cache', 'npm_config_store_dir', 'COREPACK_HOME']) await mkdir(env[key], { recursive: true })
  await writeFile(env.npm_config_userconfig, '')
  await writeFile(env.npm_config_globalconfig, '')
  // A fictional author for the commits a wish makes.
  await writeFile(env.GIT_CONFIG_GLOBAL, '[user]\n\tname = Northwind Demo\n\temail = demo@northwind.invalid\n[init]\n\tdefaultBranch = dev\n[advice]\n\tdetachedHead = false\n')
  return { home, env }
}

export function createProcesses() {
  const children = []
  let stopping = false
  function start(name, args, cwd, env, { node = true } = {}) {
    assert.ok(!stopping, 'Fixture is stopping; refuse another child')
    // An empty owned cwd: DSH reads cwd/.env even with an allowlisted environment.
    const child = spawn(node ? process.execPath : args[0], node ? ['--import', guard, ...args] : args.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const job = { name, child, output: '', exitCode: null }
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
      // Bounded readiness backoff inside one run, not a background polling loop.
      await new Promise(done => setTimeout(done, 150))
    }
    throw new Error(`Timed out: ${label}`)
  }
  async function outputMatch(job, expression, timeout) {
    return until(`${job.name} output ${expression}`, () => {
      const match = job.output.match(expression)
      if (match) return match
      if (job.error || job.child.exitCode !== null) throw new Error(`${job.name} exited: ${redact(job.output.slice(-4000))}`)
      return null
    }, timeout)
  }
  async function finished(job, timeout = 120_000) {
    let timer
    await Promise.race([job.ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${job.name} exceeded ${timeout} ms`)), timeout) })])
    clearTimeout(timer)
    return job
  }
  async function stop(job) {
    if (!job.child.pid || job.stopped) return
    job.stopped = true
    // Only process groups this runner created; never a pidfile or a name.
    try { process.kill(-job.child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    let timer
    await Promise.race([job.ended, new Promise(done => { timer = setTimeout(done, 5000) })])
    clearTimeout(timer)
    try { process.kill(-job.child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    await job.ended
  }
  async function stopAll(fixture) {
    stopping = true
    for (const job of [...children].reverse()) await stop(job).catch(() => {})
    for (const job of children) await writeFile(join(fixture, `${job.name}.log`), redact(job.output)).catch(() => {})
  }
  return { start, until, outputMatch, finished, stop, stopAll }
}

export async function openBrowser(fixture, name, login, env, viewport) {
  const { chromium } = await import('playwright-core')
  const url = new URL(login)
  assert.equal(url.hostname, '127.0.0.1')
  assert.ok(!LIVE_PORTS.includes(url.port), 'Never access a live GUI port')
  const context = await chromium.launchPersistentContext(join(fixture, `${name}-chrome-profile`), {
    executablePath: chrome, env: { ...env, TMPDIR: browserTmp(fixture) }, headless: true, viewport, deviceScaleFactor: 2,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    serviceWorkers: 'block',
  })
  const blocked = []
  const diagnostics = []
  await context.route('**/*', route => {
    const request = new URL(route.request().url())
    if (request.origin === url.origin || ['data:', 'blob:', 'about:'].includes(request.protocol)) return route.continue()
    blocked.push(request.origin)
    return route.abort('blockedbyclient')
  })
  await context.routeWebSocket('**/*', socket => {
    const ws = new URL(socket.url())
    if (ws.host === url.host) socket.connectToServer()
    else { blocked.push(ws.origin); socket.close() }
  })
  const page = context.pages()[0] ?? await context.newPage()
  page.on('pageerror', error => diagnostics.push(`pageerror ${redact(error.message)}`))
  page.setDefaultTimeout(20_000)
  await page.goto(login)
  // The Bot team's own route, the one its client calls.
  const api = async (endpoint, payload = {}, route = '/api/omni-ui') => {
    const result = await page.evaluate(async ({ endpoint, payload, route }) => {
      const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) })
      return response.json()
    }, { endpoint, payload, route })
    assert.equal(result.ok, true, `${endpoint}: ${result.error?.message ?? JSON.stringify(result).slice(0, 400)}`)
    return result.value
  }
  return { context, page, api, blocked, diagnostics }
}
