// A dead app does not prove its detached login tree has stopped. Persist before spawn;
// an interrupted/unknown launch stays blocked rather than guessing which processes to kill.
import { randomUUID } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const LOGIN_OWNER_ENV = 'AUTOMAGIK_BOT_CLI_OWNER'
export const LOGIN_RECORD_VERSION = 'login-trees-v1'
const blocked = () => Object.assign(new Error(
  'Cannot verify that a previous Bot sign-in stopped. Account changes remain blocked. '
  + 'Use Reset Bot sign-in in Bot settings to start fresh.',
), { code: 'acp-account/unverified-login' })

export function recordLogin(env) {
  const home = env.AUTOMAGIK_BOT_CLI_HOME
  if (!home) return
  const directory = join(home, 'login-trees')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, randomUUID())
  const record = { owner: env[LOGIN_OWNER_ENV], app: process.pid, kind: 'starting' }
  const update = identity => {
    const next = `${file}.next`
    writeFileSync(next, JSON.stringify({ ...record, ...identity }), { mode: 0o600 })
    renameSync(next, file)
  }
  update({})
  return { update, clear: () => {
    rmSync(file, { force: true })
    rmSync(`${file}.next`, { force: true })
  } }
}

export function verifyLoginRecords(home, owner) {
  const directory = join(home, 'login-trees')
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    const file = join(directory, name)
    let record
    try { record = JSON.parse(readFileSync(file, 'utf8')) } catch { throw blocked() }
    if (!record || typeof record !== 'object') throw blocked()
    // The current instance's in-memory controller is drained by sign-out/new login.
    if (record.owner === owner && record.app === process.pid) continue
    let proved = false
    if (record.kind === 'unix' && process.platform !== 'win32'
      && Number.isInteger(record.group) && record.group > 1) {
      try { process.kill(-record.group, 0) } catch (error) {
        proved = error.code === 'ESRCH'
      }
    }
    // A Windows stop nonce is used only by its live in-memory controller. After app death,
    // the durable record stays blocked even with a stale nonce: owner Reset selects a fresh
    // home without trusting or deleting this one. Automatic crash recovery is Unix-only.
    if (!proved) throw blocked()
    // A Unix PID/group that has been reused blocks recovery; never signal an uncertain PID.
    rmSync(file, { force: true })
  }
}

export function unverifiedLogin() { return blocked() }
