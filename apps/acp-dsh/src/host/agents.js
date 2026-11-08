// The agents this plugin offers and where they come from. Each runs the person's own CLI
// or a verified desktop-managed copy, through the newest release of its ACP adapter
// (installed in the background by install.js, never fetched when a Session starts).
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { delimiter, dirname, join } from 'node:path'
import { batchSafe } from './batch-spawn.js'

// Efforts as DSH lists them, from least to most.
const efforts = (...ids) => Object.freeze({ efforts: Object.freeze(ids.map(id => Object.freeze({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }))) })

export const AGENTS = Object.freeze({
  'acp-claude': Object.freeze({
    key: 'claude',
    name: 'Claude Code (ACP)',
    // The models and efforts come from the agent itself (catalog.js). Until it has answered once,
    // these stand in: names its adapter accepts and the efforts every one of them takes.
    defaultName: 'Claude Code',
    fallback: Object.freeze(['default', 'opus', 'sonnet', 'haiku'].map(id => Object.freeze({ id, name: id === 'default' ? 'Claude Code' : id.charAt(0).toUpperCase() + id.slice(1), reasoning: efforts('low', 'medium', 'high') }))),
    cli: 'claude',
    cliPackage: '@anthropic-ai/claude-code',
    // Where the person gets the CLI when it is not on this computer.
    installUrl: 'https://code.claude.com/docs/en/setup',
    // `claude auth status --json` answers { loggedIn } (and who: never read past loggedIn).
    signIn: Object.freeze({ args: ['auth', 'status', '--json'], read: ({ stdout }) => { try { const { loggedIn } = JSON.parse(stdout); return typeof loggedIn === 'boolean' ? loggedIn : undefined } catch { return undefined } } }),
    adapter: '@agentclientprotocol/claude-agent-acp',
    bin: 'dist/index.js',
    // The adapter's own Claude Agent SDK would run the CLI it bundles; this runs the person's.
    env: cli => ({ CLAUDE_CODE_EXECUTABLE: cli }),
    // DSH's level, as the agent's own permission mode, most wanted first. Manual is Claude
    // Code's `default` mode, whatever default mode the person's settings name. With `dshTools`
    // off, Claude Code still loads the person's own settings (allow rules, hooks) and asks DSH
    // only for what those leave as "ask". With it on, those rules still answer Claude Code's own
    // permission request and can never skip the bridge's DSH approval. DSH's Auto is Claude
    // Code's own auto mode, never bypassPermissions (RFC 0003, Retired). The last mode of each
    // list is the strict one: an agent that does not offer it fails the turn (acp.js setMode).
    modeFor: level => (level.full ? ['bypassPermissions', 'default'] : level.auto ? ['auto', 'default'] : ['default']),
    // With dshTools on: `_meta.disableBuiltInTools: true` leaves DSH's tools working and removes
    // the built-in file tools (and Bash, read from the adapter's bundle), so a structured call
    // that is not an MCP name is drift. A changed tool list is announced, not forked.
    disableBuiltInTools: true,
    drift: true,
    refresh: 'list',
  }),
  'acp-codex': Object.freeze({
    key: 'codex',
    name: 'Codex (ACP)',
    defaultName: 'Codex',
    fallback: Object.freeze([Object.freeze({ id: 'default', name: 'Codex', reasoning: efforts('low', 'medium', 'high') })]),
    cli: 'codex',
    cliPackage: '@openai/codex',
    installUrl: 'https://developers.openai.com/codex/cli',
    // `codex login status` exits 0 when signed in, 1 when not.
    signIn: Object.freeze({ args: ['login', 'status'], read: ({ code }) => (code === 0 ? true : code === 1 ? false : undefined) }),
    adapter: '@agentclientprotocol/codex-acp',
    bin: 'dist/index.js',
    // CODEX_PATH wins over the Codex the adapter depends on (codex-acp startCodexConnection).
    env: cli => ({ CODEX_PATH: cli }),
    // DSH's sandbox, as Codex's own: it asks (through DSH's dialog) for anything beyond it.
    // DSH's Auto is Codex's auto review. Most wanted first, the strict mode last (see above).
    modeFor: level => (level.full ? ['agent-full-access', 'workspace-write'] : level.auto ? ['agent', 'workspace-write'] : level.sandbox === 'read-only' ? ['read-only'] : ['workspace-write']),
    // codex-acp has no switch for its built-in tools, so they stay and are named in the turn;
    // it ignores `tools/list_changed` and a new server list on resume, so a changed tool set
    // arrives by fork (session/fork with the new servers, then session/close on the source).
    refresh: 'fork',
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

export const SIGN_IN_TIMEOUT_MS = 8000

/**
 * Whether the person is signed in to `spec`'s CLI, as the CLI itself says: true, false, or
 * undefined when it cannot tell (an old CLI, a timeout). Runs no agent turn. The CLI's own
 * folder leads PATH, so a CLI that is a Node script finds the Node it was installed with.
 */
export function signedInOf(spec, cli, { env = process.env, run = execFile } = {}) {
  if (spec.signIn === undefined || cli === undefined) return Promise.resolve(undefined)
  return new Promise((done) => {
    try {
      // A CLI npm installed on Windows is a batch file (codex.cmd): through cmd.exe (batch-spawn.js).
      run(...batchSafe(cli, spec.signIn.args, { env: { ...env, PATH: [dirname(cli), env.PATH].filter(Boolean).join(delimiter), NO_COLOR: '1' }, timeout: SIGN_IN_TIMEOUT_MS, maxBuffer: 1 << 20, windowsHide: true }), (error, stdout) => {
        const code = error ? (typeof error.code === 'number' ? error.code : undefined) : 0
        if (error && code === undefined) return done(undefined)
        try { done(spec.signIn.read({ code, stdout: String(stdout ?? '') })) } catch { done(undefined) }
      })
    } catch {
      done(undefined)
    }
  })
}
