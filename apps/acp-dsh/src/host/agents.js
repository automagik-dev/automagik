// The agents this plugin offers and where they come from. Each runs the person's own CLI, the
// one they sign in to and that updates itself, through the newest release of its ACP adapter
// (installed in the background by install.js, never fetched when a Session starts).
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const AGENTS = Object.freeze({
  'acp-claude': Object.freeze({
    key: 'claude',
    name: 'Claude Code (ACP)',
    model: Object.freeze({ id: 'default', name: 'Claude Code' }),
    cli: 'claude',
    adapter: '@agentclientprotocol/claude-agent-acp',
    bin: 'dist/index.js',
    // The adapter's own Claude Agent SDK would run the CLI it bundles; this runs the person's.
    env: cli => ({ CLAUDE_CODE_EXECUTABLE: cli }),
    // DSH's level, as the agent's own permission mode: Manual asks for every call (through
    // DSH's dialog), whatever default mode the person's Claude Code settings name. DSH's Auto is
    // Claude Code's own auto mode, never bypassPermissions (RFC 0003, Retired).
    modeFor: level => (level.full ? 'bypassPermissions' : level.auto ? 'auto' : 'default'),
  }),
  'acp-codex': Object.freeze({
    key: 'codex',
    name: 'Codex (ACP)',
    model: Object.freeze({ id: 'default', name: 'Codex' }),
    cli: 'codex',
    adapter: '@agentclientprotocol/codex-acp',
    bin: 'dist/index.js',
    // CODEX_PATH wins over the Codex the adapter depends on (codex-acp startCodexConnection).
    env: cli => ({ CODEX_PATH: cli }),
    // DSH's sandbox, as Codex's own: it asks (through DSH's dialog) for anything beyond it.
    // DSH's Auto is Codex's auto review.
    modeFor: level => (level.full ? 'agent-full-access' : level.auto ? 'agent' : level.sandbox === 'read-only' ? 'read-only' : 'workspace-write'),
  }),
})

// Where the CLIs' own installers put them, for a DSH started from the desktop with a short PATH.
export function searchPath(env = process.env, home = homedir()) {
  const dirs = String(env.PATH ?? '').split(delimiter).filter(Boolean)
  const extra = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]
  return [...new Set([...dirs, ...extra])]
}

const executable = (path) => {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The first executable named `name` on the search path, or undefined. */
export function findCommand(name, { env = process.env, home = homedir() } = {}) {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  for (const dir of searchPath(env, home)) {
    for (const file of names) {
      const path = join(dir, file)
      if (executable(path)) return path
    }
  }
  return undefined
}
