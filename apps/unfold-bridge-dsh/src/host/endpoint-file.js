// Where Unfold finds the bridge: one small JSON file, in this plugin's own state folder,
// readable only by the person who runs DSH. It holds the port and the key of this start;
// Unfold reads it and hands the key to its agent only. It is removed when the bridge stops.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

// XDG_STATE_HOME when it is absolute (the spec ignores a relative one), else ~/.local/state.
export function endpointFile(env = process.env, home = homedir()) {
  const state = env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : join(home, '.local', 'state')
  return join(state, 'unfold-bridge', 'endpoint.json')
}

// Written whole or not at all: a temporary file beside it, then a rename.
export function writeEndpoint(file, { port, key, pid, started }) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const temp = join(dir, `.endpoint.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temp, `${JSON.stringify({ v: 1, port, key, pid, started })}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

// Only this start's file goes: a newer start (another DSH, or this one restarted) keeps its own.
export function removeEndpoint(file, key) {
  let current
  try { current = JSON.parse(readFileSync(file, 'utf8')) } catch { return }
  if (current?.key === key) rmSync(file, { force: true })
}
