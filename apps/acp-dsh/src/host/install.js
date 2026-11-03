// The ACP adapters, at their newest release, installed in the background: at DSH's start and
// once a day after, never when a Session starts. Each install goes to a fresh folder that is
// renamed into place only once complete, and `current.json` then names it, so a spawn never
// runs a half-installed adapter. They live in Automagik's home, not in the DSH profile: DSH's
// pnpm owns the profile's node_modules and would reconcile anything put there.
//
// Not pinned (RFC 0003, as amended): the agents' CLIs update themselves, and an adapter that
// lags its CLI breaks first. What is checked is what npm publishes: the exact package name, the
// registry's integrity for every tarball, and no install scripts.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findCommand } from './agents.js'

const run = promisify(execFile)
const REGISTRY = 'https://registry.npmjs.org'
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

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
export async function latestVersion(pkg, { fetch = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const res = await fetch(`${REGISTRY}/${pkg.replace('/', '%2F')}/latest`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`npm answered ${res.status} for ${pkg}`)
  const { version } = await res.json()
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) throw new Error(`npm gave no version for ${pkg}`)
  return version
}

// pnpm first: the desktop app puts its own on DSH's PATH; else the person's npm.
async function defaultInstall(dir, pkg, version, env) {
  const pnpm = findCommand('pnpm', { env })
  const npm = pnpm ? undefined : findCommand('npm', { env })
  if (!pnpm && !npm) throw new Error('neither pnpm nor npm is on the PATH to install the ACP adapter with')
  const options = { cwd: dir, env: { ...env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' }, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 << 20 }
  // No optional dependencies: they are the CLIs the adapters bundle, which the person's own
  // replace. pnpm skips them through package.json's supportedArchitectures (see updateNow):
  // pnpm 10.34's --no-optional breaks on Codex's aliased platform packages
  // (ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY).
  if (pnpm) await run(pnpm, ['install', '--prod', '--ignore-scripts', '--config.node-linker=hoisted', '--config.ignore-workspace=true', '--reporter=silent'], options)
  else await run(npm, ['install', '--omit=optional', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], options)
}

export class AdapterStore {
  /**
   * @param {{ home?: string, env?: NodeJS.ProcessEnv, latest?: typeof latestVersion, install?: typeof defaultInstall, now?: () => number, log?: (message: string) => void }} [options]
   */
  constructor({ home = adaptersHome(), env = process.env, latest = latestVersion, install = defaultInstall, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { home, env, latest, install, now, log })
    this.running = new Map()
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
    const job = this.updateNow(pkg, bin, force).finally(() => this.running.delete(pkg))
    this.running.set(pkg, job)
    return job
  }

  async updateNow(pkg, bin, force) {
    const folder = join(this.home, folderOf(pkg))
    const current = readJson(join(folder, 'current.json'))
    const have = this.binOf(pkg, bin)
    if (!force && have && current?.checkedAt && this.now() - current.checkedAt < CHECK_EVERY_MS) return have
    const version = await this.latest(pkg)
    mkdirSync(folder, { recursive: true })
    if (have?.version !== version) {
      const tmp = join(folder, `.install-${process.pid}-${this.now()}`)
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      try {
        // A platform nothing runs on: pnpm installs no platform-specific optional package.
        writeJson(join(tmp, 'package.json'), { name: 'automagik-acp-adapter', private: true, dependencies: { [pkg]: version }, pnpm: { supportedArchitectures: { os: ['none'], cpu: ['none'], libc: ['none'] } } })
        await this.install(tmp, pkg, version, this.env)
        if (!existsSync(join(tmp, 'node_modules', ...pkg.split('/'), bin))) throw new Error(`${pkg}@${version} installed without ${bin}`)
        const target = join(folder, version)
        rmSync(target, { recursive: true, force: true })
        renameSync(tmp, target)
      } catch (error) {
        rmSync(tmp, { recursive: true, force: true })
        throw error
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
}
