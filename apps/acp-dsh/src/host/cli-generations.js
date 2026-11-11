// Installation-level ownership must outlive a replaceable vendor home. Each mutex contender
// announces a unique PID/UUID directory before checking peers; dead claims never need a
// second recovery claim, and no contender deletes a pathname another contender will reuse.
import { randomUUID } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { unverifiedLogin } from './login-ownership.js'

export const POINTER_ENV = 'AUTOMAGIK_BOT_CLI_POINTER'
export const GENERATION_ENV = 'AUTOMAGIK_BOT_CLI_GENERATION'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const busy = () => Object.assign(new Error(
  'Close other Automagik sessions before changing the Bot account.',
), { code: 'acp-account/busy' })

export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return true
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

export function generationAt(pointer) {
  let generation
  try { generation = readFileSync(pointer, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') {
      const root = dirname(dirname(pointer))
      const vendor = basename(pointer)
      if (existsSync(`${pointer}.activated`) || existsSync(join(root, 'homes', vendor))
        || existsSync(join(root, 'retired', vendor))) throw unverifiedLogin()
      return 'legacy'
    }
    throw unverifiedLogin()
  }
  if (!UUID.test(generation)) throw unverifiedLogin()
  return generation
}

export function assertGeneration(env) {
  if (env[POINTER_ENV] === undefined) return
  if (generationAt(env[POINTER_ENV]) !== env[GENERATION_ENV]) {
    throw Object.assign(new Error(
      'The Bot account changed. Start this work again after signing in.',
    ), { code: 'acp-account/busy' })
  }
}

export class CliGenerations {
  constructor(root, instance) {
    this.root = root
    this.instance = instance
    this.held = new Map()
    this.registered = new Set()
  }

  pointer(vendor) { return join(this.root, 'current', vendor) }
  current(vendor) { return generationAt(this.pointer(vendor)) }
  folder(vendor, generation = this.current(vendor)) {
    return generation === 'legacy' ? join(this.root, vendor)
      : join(this.root, 'homes', vendor, generation)
  }
  claims(vendor) { return join(this.root, 'mutations', vendor) }
  instances(vendor) { return join(this.root, 'instances', vendor) }

  register(vendor) {
    const directory = this.instances(vendor)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(join(directory, this.instance), '', { mode: 0o600 })
    this.registered.add(vendor)
  }

  unregister(vendor) {
    rmSync(join(this.instances(vendor), this.instance), { force: true })
    this.registered.delete(vendor)
  }

  otherApps(vendor, home) {
    for (const directory of [this.instances(vendor), join(home, 'instances')]) {
      if (!existsSync(directory)) continue
      for (const name of readdirSync(directory)) {
        if (name === this.instance) continue
        if (alive(Number(name.split('-')[0]))) throw busy()
      }
    }
  }

  check(vendor) {
    const directory = this.claims(vendor)
    if (!existsSync(directory)) return
    for (const name of readdirSync(directory)) {
      if (name === this.held.get(vendor)) continue
      if (alive(Number(name.split('-')[0]))) throw busy()
    }
  }

  acquire(vendor) {
    if (this.held.has(vendor)) throw busy()
    const directory = this.claims(vendor)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const claim = `${this.instance}-${randomUUID()}`
    mkdirSync(join(directory, claim), { mode: 0o700 })
    this.held.set(vendor, claim)
    try {
      this.check(vendor)
      for (const name of readdirSync(directory)) {
        if (name !== claim && !alive(Number(name.split('-')[0]))) {
          rmSync(join(directory, name), { recursive: true, force: true })
        }
      }
    } catch (error) {
      this.held.delete(vendor)
      rmSync(join(directory, claim), { recursive: true, force: true })
      throw error
    }
    return () => {
      this.held.delete(vendor)
      rmSync(join(directory, claim), { recursive: true, force: true })
    }
  }

  exclusive(vendor, change) {
    const release = this.acquire(vendor)
    try { return change() } finally { release() }
  }

  select(vendor, generation) {
    const pointer = this.pointer(vendor)
    mkdirSync(join(this.root, 'current'), { recursive: true, mode: 0o700 })
    // An absent selection after activation is damage, never permission to revive legacy.
    writeFileSync(`${pointer}.activated`, '', { mode: 0o600 })
    const next = `${pointer}.${randomUUID()}`
    writeFileSync(next, generation, { mode: 0o600 })
    renameSync(next, pointer)
  }

  dispose() {
    for (const vendor of this.registered) this.unregister(vendor)
  }
}
