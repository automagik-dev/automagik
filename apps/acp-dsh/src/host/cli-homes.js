// Bot authentication belongs to this installation, never to the terminal (#869).
import { randomUUID } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

export const HOME_ENV = 'AUTOMAGIK_BOT_CLI_HOME'
const VERSION_ENV = 'AUTOMAGIK_BOT_CLI_VERSION'
const vendors = new Set(['claude', 'codex'])
const runs = new Map()
// An allowlist, rather than a list of known tokens: future CLI auth overrides must not leak
// in either. Undefined entries mask process.env where older spawn helpers merge environments.
const inherited = new RegExp([
  '^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LANGUAGE|LC_.*|TZ|TERM',
  '|COLORTERM|USER|USERNAME|LOGNAME|SHELL|HTTPS?_PROXY|ALL_PROXY|NO_PROXY',
  '|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|DBUS_SESSION_BUS_ADDRESS',
  '|DISPLAY|WAYLAND_DISPLAY)$',
].join(''), 'i')
const failure = message => Object.assign(new Error(message), { code: 'acp-account/busy' })

export class CliHomes {
  constructor(root) {
    this.root = resolve(root)
    this.instance = `${process.pid}-${randomUUID()}`
    this.registered = new Set()
    this.changes = new Set()
  }

  home(vendor) {
    if (!vendors.has(vendor)) throw new Error('No isolated home for this agent.')
    return join(this.root, vendor)
  }

  environment(vendor, source = process.env) {
    const home = this.home(vendor)
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const instances = join(home, 'instances')
    mkdirSync(instances, { recursive: true, mode: 0o700 })
    // Register before checking the mutation lock: either a concurrent changer sees us and
    // refuses, or we see its lock and refuse. Other app processes can never change live auth.
    if (!this.registered.has(vendor)) {
      writeFileSync(join(instances, this.instance), '', { mode: 0o600 })
      if (existsSync(join(home, 'changing'))) {
        rmSync(join(instances, this.instance), { force: true })
        throw failure('The Bot account is changing. Try again when it finishes.')
      }
      this.registered.add(vendor)
    }
    const env = Object.fromEntries(Object.keys(source).map(key => [
      key, inherited.test(key) ? source[key] : undefined,
    ]))
    const config = join(home, `.${vendor}`)
    for (const dir of [config, 'config', 'data', 'cache', 'state', 'roaming', 'local']) {
      mkdirSync(dir === config ? dir : join(home, dir), { recursive: true, mode: 0o700 })
    }
    return {
      ...env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'roaming'),
      LOCALAPPDATA: join(home, 'local'),
      HOMEDRIVE: undefined,
      HOMEPATH: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_STATE_HOME: join(home, 'state'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CLAUDE_SECURESTORAGE_CONFIG_DIR: join(home, '.claude'),
      CODEX_HOME: join(home, '.codex'),
      [HOME_ENV]: home,
      [VERSION_ENV]: existsSync(join(home, 'version'))
        ? readFileSync(join(home, 'version'), 'utf8') : '',
    }
  }

  changing(vendor) { return existsSync(join(this.home(vendor), 'changing')) }
  paused(vendor) { return existsSync(join(this.home(vendor), 'paused')) }
  resume(vendor) { rmSync(join(this.home(vendor), 'paused'), { force: true }) }

  // Deliberately fail closed after a crashed account operation: the app must not resume on
  // credentials whose logout could not be confirmed. A new attempt can explicitly recover
  // the lock only when its owning process is gone.
  begin(vendor) {
    const home = this.home(vendor)
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const lock = join(home, 'changing')
    if (existsSync(lock)) {
      let pid
      try { pid = Number(readFileSync(join(lock, 'pid'), 'utf8')) } catch {}
      if (!alive(pid)) rmSync(lock, { recursive: true, force: true })
    }
    this.environment(vendor)
    try { mkdirSync(lock, { mode: 0o700 }) } catch {
      throw failure('The Bot account is already changing. Try again when it finishes.')
    }
    this.changes.add(vendor)
    try {
      writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 })
      const instances = join(home, 'instances')
      for (const name of readdirSync(instances)) {
        if (name === this.instance) continue
        if (alive(Number(name.split('-')[0]))) {
          throw failure('Close other Automagik sessions before changing the Bot account.')
        }
        rmSync(join(instances, name), { force: true })
      }
      writeFileSync(join(home, 'paused'), '', { mode: 0o600 })
      writeFileSync(join(home, 'version'), randomUUID(), { mode: 0o600 })
    } catch (error) {
      this.end(vendor)
      throw error
    }
  }

  end(vendor) {
    if (!this.changes.delete(vendor)) return
    rmSync(join(this.home(vendor), 'changing'), { recursive: true, force: true })
  }

  dispose() {
    for (const vendor of this.registered) {
      rmSync(join(this.home(vendor), 'instances', this.instance), { force: true })
    }
    this.registered.clear()
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return true
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

export function trackRun(run) {
  const home = run.spec.env?.[HOME_ENV]
  if (home === undefined) return
  if (existsSync(join(home, 'changing')) || existsSync(join(home, 'paused'))) {
    throw failure('The Bot account is changing. Sign in again when it finishes.')
  }
  const current = existsSync(join(home, 'version'))
    ? readFileSync(join(home, 'version'), 'utf8') : ''
  if (run.spec.env[VERSION_ENV] !== current) {
    throw failure('The Bot account changed. Start this work again after signing in.')
  }
  if (!runs.has(home)) runs.set(home, new Set())
  runs.get(home).add(run)
}

export function releaseRun(run) {
  const home = run.spec.env?.[HOME_ENV]
  if (!runs.get(home)?.has(run)) return Promise.resolve()
  if (run.accountStopping === undefined) {
    run.accountStopping = Promise.resolve().then(() => run.stop()).then(() => {
      runs.get(home)?.delete(run)
      if (runs.get(home)?.size === 0) runs.delete(home)
    })
    // The changer awaits this rejection. Background cleanup must not reject unobserved.
    run.accountStopping.catch(() => { run.accountStopping = undefined })
  }
  return run.accountStopping
}

export async function stopRuns(home) {
  await Promise.all([...(runs.get(home) ?? [])].map(releaseRun))
}
