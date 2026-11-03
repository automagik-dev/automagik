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
    // DSH's level, as the agent's own permission mode, most wanted first. Manual is Claude
    // Code's `default` mode, whatever default mode the person's settings name. Claude Code
    // still loads the person's own settings (user, project and local: allow rules, saved
    // "always allow" rules, PreToolUse and PermissionRequest hooks), and asks DSH only for what
    // those leave as "ask": a call they allow runs with no DSH dialog. DSH's Auto is Claude
    // Code's own auto mode, never bypassPermissions (RFC 0003, Retired). The last mode of each
    // list is the strict one: an agent that does not offer it fails the turn (acp.js setMode).
    modeFor: level => (level.full ? ['bypassPermissions', 'default'] : level.auto ? ['auto', 'default'] : ['default']),
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
    // DSH's Auto is Codex's auto review. Most wanted first, the strict mode last (see above).
    modeFor: level => (level.full ? ['agent-full-access', 'workspace-write'] : level.auto ? ['agent', 'workspace-write'] : level.sandbox === 'read-only' ? ['read-only'] : ['workspace-write']),
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

/** Whether `path` is a file this user can run. */
export const isExecutable = (path) => {
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
      if (isExecutable(path)) return path
    }
  }
  return undefined
}
