// The ACP adapters, at their newest release, installed in the background: at DSH's start and
// once a day after, never when a Session starts. Each install goes to a fresh folder that is
// renamed into place only once complete, and `current.json` then names it, so a spawn never
// runs a half-installed adapter. They live in Automagik's home, not in the DSH profile: DSH's
// pnpm owns the profile's node_modules and would reconcile anything put there.
//
// Not pinned (RFC 0003, as amended): the agents' CLIs update themselves, and an adapter that
// lags its CLI breaks first. What is checked is what npm publishes: the exact package name, the
// registry's integrity for every tarball, no install scripts, and no bundled CLI.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findCommand, isExecutable } from './agents.js'

const REGISTRY = 'https://registry.npmjs.org'
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

export const adaptersHome = (env = process.env) => join(env.AUTOMAGIK_HOME || join(homedir(), '.automagik'), 'acp', 'adapters')
const folderOf = pkg => pkg.replace(/^@/, '').replace(/\//g, '__')
const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}
const writeJson = (file, value) => {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tmp, file)
}

/** The newest version npm publishes for `pkg`. */
export async function latestVersion(pkg, { fetch = globalThis.fetch, timeoutMs = 15_000, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const res = await fetch(`${REGISTRY}/${pkg.replace('/', '%2F')}/latest`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`npm answered ${res.status} for ${pkg}`)
  const { version } = await res.json()
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) throw new Error(`npm gave no version for ${pkg}`)
  return version
}

// The platform packages that hold the CLIs the adapters bundle (Claude Agent SDK's `claude`,
// Codex's `codex`; hundreds of MB each). The person's own CLI replaces them, so an install that
// pulls one in is refused. `@openai/codex` itself, with no platform in its name, is a small
// launcher codex-acp depends on, and stays.
const PLATFORM = /^(@anthropic-ai[/+]claude-agent-sdk|@openai[/+]codex)-(darwin|linux|win32)-/
const dirsOf = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) } catch { return [] }
}

/** The platform CLI packages anywhere in the node_modules under `dir`. */
export function platformPackages(dir) {
  const found = []
  const walk = (modules) => {
    for (const name of dirsOf(modules)) {
      if (name === '.pnpm') {
        for (const entry of dirsOf(join(modules, name))) {
          if (PLATFORM.test(entry)) found.push(entry)
          else walk(join(modules, name, entry, 'node_modules'))
        }
      } else if (name.startsWith('@')) {
        for (const pkg of dirsOf(join(modules, name))) {
          if (PLATFORM.test(`${name}/${pkg}`)) found.push(`${name}/${pkg}`)
          else walk(join(modules, name, pkg, 'node_modules'))
        }
      } else if (!name.startsWith('.')) {
        walk(join(modules, name, 'node_modules'))
      }
    }
  }
  walk(join(dir, 'node_modules'))
  return found
}

// The package manager: the desktop app's own pnpm (AUTOMAGIK_PNPM, the pnpm 10 it bundles),
// never the person's, whose newer pnpm installs the platform packages anyway (pnpm 12 pulled
// about 700 MB for the two adapters); else npm, which skips optional dependencies itself.
export function packageManagerOf(env = process.env) {
  if (env.AUTOMAGIK_PNPM && isExecutable(env.AUTOMAGIK_PNPM)) return { kind: 'pnpm', command: env.AUTOMAGIK_PNPM }
  const npm = findCommand('npm', { env })
  return npm ? { kind: 'npm', command: npm } : undefined
}

/** The pids under `root`, from `ps`: its children, theirs, and so on. */
export function descendantsOf(root) {
  let table
  try { table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 }) } catch { return [] }
  const children = new Map()
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid || ppid === undefined) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const found = []
  const queue = [root]
  while (queue.length > 0) {
    for (const pid of children.get(queue.shift()) ?? []) {
      if (found.includes(pid)) continue
      found.push(pid)
      queue.push(pid)
    }
  }
  return found
}

const sendSignal = (pid, name) => {
  try { process.kill(pid, name); return true } catch { return false }
}

// Stop `root` and everything it started. Each process is frozen before the next walk, so none
// forks or hands its children to init while the tree is read; then all of them are killed. The
// install stays in DSH's process group (not detached): whatever stops DSH's group stops it too.
export function killTree(root) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(root), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 }) } catch {}
    return
  }
  const frozen = []
  for (let walk = 0, fresh = [root]; walk < 10 && fresh.length > 0; walk++) {
    for (const pid of fresh) if (sendSignal(pid, 'SIGSTOP')) frozen.push(pid)
    fresh = descendantsOf(root).filter(pid => !frozen.includes(pid))
  }
  for (const pid of [root, ...frozen]) sendSignal(pid, 'SIGKILL')
}

// One install command: rejects with its last output when it fails, and kills its whole tree
// when `signal` aborts or it runs past INSTALL_TIMEOUT_MS.
export function runInstall(command, args, { cwd, env, signal: abort, timeoutMs = INSTALL_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    if (abort?.aborted) return reject(new Error('install stopped: DSH is quitting'))
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    let stopped
    const keep = (chunk) => { output = (output + chunk).slice(-16_384) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const stop = (why) => {
      if (stopped !== undefined) return
      stopped = why
      if (child.pid !== undefined) killTree(child.pid)
    }
    const onAbort = () => stop('install stopped: DSH is quitting')
    const timer = setTimeout(() => stop(`install timed out after ${Math.round(timeoutMs / 1000)}s`), timeoutMs)
    timer.unref?.()
    abort?.addEventListener('abort', onAbort, { once: true })
    const done = (error) => {
      clearTimeout(timer)
      abort?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    child.once('error', done)
    child.once('close', (code, sig) => {
      if (stopped !== undefined) done(new Error(stopped))
      else if (code !== 0) done(new Error(`${command} ${args[0]} failed (${sig ?? `exit ${code}`})\n${output.trim()}`))
      else done()
    })
  })
}

export async function defaultInstall(dir, pkg, version, env, { signal } = {}) {
  const manager = packageManagerOf(env)
  if (!manager) throw new Error("neither the desktop app's pnpm nor npm is here to install the ACP adapter with")
  const options = { cwd: dir, env: { ...env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' }, signal }
  // No optional dependencies: they are the CLIs the adapters bundle, which the person's own
  // replace. pnpm skips them through package.json's supportedArchitectures (see updateNow):
  // pnpm 10.34's --no-optional breaks on Codex's aliased platform packages
  // (ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY). updateNow refuses an install that has one anyway.
  if (manager.kind === 'pnpm') await runInstall(manager.command, ['install', '--prod', '--ignore-scripts', '--config.node-linker=hoisted', '--config.ignore-workspace=true', '--reporter=silent'], options)
  else await runInstall(manager.command, ['install', '--omit=optional', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], options)
}

export class AdapterStore {
  /**
   * @param {{ home?: string, env?: NodeJS.ProcessEnv, latest?: typeof latestVersion, install?: typeof defaultInstall, now?: () => number, log?: (message: string) => void }} [options]
   */
  constructor({ home = adaptersHome(), env = process.env, latest = latestVersion, install = defaultInstall, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { home, env, latest, install, now, log })
    this.running = new Map()
    this.failures = new Map()
    this.installing = new Set()
    this.quit = new AbortController()
  }

  /**
   * DSH is quitting: kill every running install's process tree and remove its half-done folder
   * now, as DSH may exit before the install's own cleanup runs. No install starts after this.
   */
  dispose() {
    this.quit.abort()
    for (const tmp of this.installing) rmSync(tmp, { recursive: true, force: true })
    this.installing.clear()
  }

  /** Why the last install of `pkg` failed, while no install has worked since. */
  lastError(pkg) {
    return this.failures.get(pkg)
  }

  /** Whether an install of `pkg` is running now. */
  busy(pkg) {
    return this.running.has(pkg)
  }

  /** The installed adapter's entry script, or undefined when none is complete. */
  binOf(pkg, bin) {
    const folder = join(this.home, folderOf(pkg))
    const current = readJson(join(folder, 'current.json'))
    if (!current?.version) return undefined
    const path = join(folder, current.version, 'node_modules', ...pkg.split('/'), bin)
    return existsSync(path) ? { path, version: current.version } : undefined
  }

  /** Install the newest release unless it is already here and was checked within a day. */
  update(pkg, bin, { force = false } = {}) {
    const busy = this.running.get(pkg)
    if (busy) return busy
    if (this.quit.signal.aborted) return Promise.reject(new Error('install stopped: DSH is quitting'))
    const job = this.updateNow(pkg, bin, force).then(
      (found) => { this.failures.delete(pkg); return found },
      (error) => { this.failures.set(pkg, String(error?.message ?? error).split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300)); throw error },
    ).finally(() => this.running.delete(pkg))
    this.running.set(pkg, job)
    return job
  }

  async updateNow(pkg, bin, force) {
    const folder = join(this.home, folderOf(pkg))
    const current = readJson(join(folder, 'current.json'))
    const have = this.binOf(pkg, bin)
    if (!force && have && current?.checkedAt && this.now() - current.checkedAt < CHECK_EVERY_MS) return have
    const { signal } = this.quit
    const version = await this.latest(pkg, { signal })
    if (signal.aborted) throw new Error('install stopped: DSH is quitting')
    mkdirSync(folder, { recursive: true })
    this.dropStale(folder)
    if (have?.version !== version) {
      const tmp = join(folder, `.install-${process.pid}-${this.now()}`)
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      this.installing.add(tmp)
      try {
        // A platform nothing runs on: pnpm installs no platform-specific optional package.
        writeJson(join(tmp, 'package.json'), { name: 'automagik-acp-adapter', private: true, dependencies: { [pkg]: version }, pnpm: { supportedArchitectures: { os: ['none'], cpu: ['none'], libc: ['none'] } } })
        await this.install(tmp, pkg, version, this.env, { signal })
        // Stopped on quit: whatever the installer left is not moved into place.
        if (signal.aborted) throw new Error('install stopped: DSH is quitting')
        if (!existsSync(join(tmp, 'node_modules', ...pkg.split('/'), bin))) throw new Error(`${pkg}@${version} installed without ${bin}`)
        const bundled = platformPackages(tmp)
        if (bundled.length > 0) throw new Error(`${pkg}@${version} installed the CLIs it bundles (${bundled.join(', ')}); refused`)
        const target = join(folder, version)
        rmSync(target, { recursive: true, force: true })
        renameSync(tmp, target)
      } catch (error) {
        rmSync(tmp, { recursive: true, force: true })
        throw error
      } finally {
        this.installing.delete(tmp)
      }
      this.log(`installed ${pkg}@${version}`)
    }
    writeJson(join(folder, 'current.json'), { version, checkedAt: this.now(), ...(have && have.version !== version ? { previous: have.version } : current?.previous ? { previous: current.previous } : {}) })
    // Keep the one in use and the one before it (a Session may still run it); drop the rest.
    const keep = new Set([version, have?.version].filter(Boolean))
    for (const name of readdirSync(folder)) {
      if (name === 'current.json' || name.startsWith('.') || keep.has(name)) continue
      rmSync(join(folder, name), { recursive: true, force: true })
    }
    return this.binOf(pkg, bin)
  }

  // An install DSH was killed in the middle of leaves its folder (`.install-<pid>-<time>`): dropped
  // at once when that DSH is gone, else once older than any install can run, so one another DSH
  // is still running stays.
  dropStale(folder) {
    for (const name of readdirSync(folder)) {
      if (!name.startsWith('.install-')) continue
      const path = join(folder, name)
      const pid = Number(name.split('-')[1])
      try {
        if (!alive(pid) || this.now() - statSync(path).mtimeMs > INSTALL_TIMEOUT_MS) rmSync(path, { recursive: true, force: true })
      } catch {}
    }
  }
}

// Whether a process `pid` runs; one that is not ours (EPERM) still runs.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}
