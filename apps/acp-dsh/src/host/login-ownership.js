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
  + 'Close the previous sign-in and try again; contact support if this persists.',
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
    } else if (record.kind === 'windows' && process.platform === 'win32'
      && /^\.login-job-[a-zA-Z0-9]+$/.test(record.directory)
      && typeof record.nonce === 'string' && record.nonce.length > 0) {
      try {
        proved = readFileSync(join(home, record.directory, 'done'), 'utf8') === record.nonce
      } catch {}
    }
    if (!proved) throw blocked()
    // A Job's nonce proof means zero active processes, even if its supervisor is exiting.
    // A Unix PID/group that has been reused blocks recovery; never signal an uncertain PID.
    rmSync(file, { force: true })
  }
}

export function unverifiedLogin() { return blocked() }
