// Permission levels, across providers. A level is stored as DSH's preset name, and DSH's
// preset runs every provider's tools. Claude Code (dsh-oh-my-claude) derives its own mode
// from the preset's file policy, and DSH reports Auto as full access, so a Claude Session
// on DSH's Auto would run as bypassPermissions. At Auto it gets Claude Code's own `auto`
// as its override instead. Pure apart from globalThis, so the client imports it too.

export const AUTO = 'auto'
// The level a saved Auto runs as where it cannot be applied: never a looser one.
export const AUTO_FALLBACK = 'workspace-write'
export const LEVELS = Object.freeze(['read-only', 'workspace-write', 'danger-full-access', AUTO])

export const isClaudeCode = provider => provider === 'claude-code' || String(provider).startsWith('claude-code-')

// dsh-oh-my-claude's adapters, one per provider id (claude-code, claude-code-<box>). This
// Map is its internal, verified on 1.5.6-omni.7; methods missing from it make Auto fall back.
const ADAPTERS = Symbol.for('dsh-oh-my-claude.adapter')
export const claudeAdapters = () => [...(globalThis[ADAPTERS]?.values() ?? [])]

// Pins Claude Code's mode for a Session on every adapter. `auto`: the override is written
// with restorePermissionMode, which saves it past the ceiling check, and read back through
// getPermissionMode at DSH's full access, as a spawn under Auto computes it. `null`: an
// `auto` override is cleared; a mode the user picked in dsh-oh-my-claude is left alone.
// Resolves whether every adapter holds the result.
export async function pinClaudeMode(sessionId, mode) {
  const adapters = claudeAdapters()
  try {
    if (mode === AUTO) {
      if (adapters.some(adapter => typeof adapter.restorePermissionMode !== 'function' || typeof adapter.getPermissionMode !== 'function')) return false
      for (const adapter of adapters) await adapter.restorePermissionMode(sessionId, AUTO)
      return adapters.every(adapter => adapter.getPermissionMode(sessionId, 'danger-full-access') === AUTO)
    }
    let cleared = true
    for (const adapter of adapters) {
      if (typeof adapter.permissionModeInfo !== 'function' || adapter.permissionModeInfo(sessionId).override !== AUTO) continue
      if (typeof adapter.setPermissionMode !== 'function') { cleared = false; continue }
      await adapter.setPermissionMode(sessionId, null)
      if (adapter.permissionModeInfo(sessionId).override !== null) cleared = false
    }
    return cleared
  } catch {
    return false
  }
}
