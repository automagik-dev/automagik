// Redaction before history crosses a provider boundary: a Session's transcript is replayed into
// another provider (the outbound replay, `switch.js`) only after it passes this filter. Scope is
// exactly that crossing (RFC 0003, amendment, "Live switching"): the agent's own streamed answer
// is logged as a native model's answer is, and the bridge's DSH tool results are DSH's, so
// neither passes through this module. The secret values saved for a Bot's Session go first in the
// replay, then the credential shapes the Bot team's diagnostics mask.
//
// The secret store belongs to the Bot team's runtime (`omniTeam`), which composes only where
// Bots run; acp-dsh reads it when it is there and never requires it. A chat that is not a Bot's
// has no secret store, so only the credential shapes apply.

// Shapes of credentials that are not saved keys: provider keys, bearer tokens, and token or
// key parameters in addresses. The same table as apps/bots-dsh/src/host/diagnostics.js, plus
// npm's token shape below (the Bot team's table does not carry it yet; an agent's streamed
// answer can be replayed to another provider, so it is masked on that crossing too).
export const CREDENTIALS = Object.freeze([
  [/\bsk-[A-Za-z0-9_*.-]{6,}/g, 'sk-[hidden]'],
  [/\bnpm_[A-Za-z0-9]{16,}/g, '[hidden]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, '[hidden]'],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, '[hidden]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[hidden]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, '[hidden]'],
  [/\bAIza[A-Za-z0-9_-]{20,}/g, '[hidden]'],
  // JSON web tokens: three base64url parts, the first always starting eyJ.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[hidden]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=*-]{8,}/gi, '$1 [hidden]'],
  [/([?&#](?:token|access_token|api_key|apikey|key|secret|password)=)[^&\s"']+/gi, '$1[hidden]'],
  [/(["']?(?:api[_-]?key|authorization|x-api-key|password|secret)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, '$1[hidden]'],
])

/** A string with every credential shape masked; other types pass through untouched. */
export function credentialShapes(text) {
  if (typeof text !== 'string') return text
  let out = text
  for (const [pattern, replacement] of CREDENTIALS) out = out.replace(pattern, replacement)
  return out
}

/**
 * The redactor for one Session: the credential shapes first, then the Bot team's saved secrets
 * (when its runtime is composed). The order matters: a saved secret's own label is
 * `[secret:<NAME>]`, and running the shapes over it would mask the label. A store that throws is
 * skipped, never fatal: text that cannot be redacted by it still loses the shapes, and a broken
 * store must not block a turn.
 * @param {{ get?: (name: string) => any } | undefined} ctx the plugin's context
 * @returns {(text: string) => string}
 */
export function redactorFor(ctx) {
  const team = (() => {
    try {
      return ctx?.get?.('omniTeam')
    } catch {
      return undefined
    }
  })()
  const saved = typeof team?.redactSecrets === 'function' ? team.redactSecrets : undefined
  return (text) => {
    if (typeof text !== 'string') return text
    const shaped = credentialShapes(text)
    if (saved === undefined) return shaped
    try {
      return String(saved.call(team, shaped) ?? shaped)
    } catch {
      // The store's values still apply at its own source; the shapes above always land.
      return shaped
    }
  }
}
