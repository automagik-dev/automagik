// The credential shapes removed from diagnostics, installer output and failure rows. This is
// the one edited source; apps/acp-dsh/src/host/redact.js, apps/welcome-dsh/src/host/redact.js
// and apps/welcome-dsh/src/client/redact.js are byte-equal copies (each plugin installs on its
// own), checked by scripts/redact-copies.test.ts.
//
// No imports: the client copy is bundled into the welcome's browser half.
const HOME_MARK = '[hidden]'

export const CREDENTIALS = [
  [/\bsk-[A-Za-z0-9_*.-]{6,}/g, 'sk-[hidden]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, HOME_MARK],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, HOME_MARK],
  [/\bAKIA[0-9A-Z]{16}\b/g, HOME_MARK],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, HOME_MARK],
  [/\bAIza[A-Za-z0-9_-]{20,}/g, HOME_MARK],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, HOME_MARK],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=*-]{8,}/gi, `$1 ${HOME_MARK}`],
  [/([?&#](?:token|access_token|api_key|apikey|key|secret|password)=)[^&\s"']+/gi, `$1${HOME_MARK}`],
  // npm registry credentials: an access token, the .npmrc keys, and userinfo in a URL.
  [/\bnpm_[A-Za-z0-9]{16,}/g, 'npm_[hidden]'],
  [/(\b_(?:authToken|auth|password)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"',}]+)/gi, `$1${HOME_MARK}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${HOME_MARK}@`],
  [/(["']?(?:api[_-]?key|authorization|x-api-key|password|secret)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, `$1${HOME_MARK}`],
]

/** Remove credential-shaped strings from text before it is stored or shown. */
export function redactText(text) {
  let out = String(text ?? '')
  for (const [pattern, replacement] of CREDENTIALS) out = out.replace(pattern, replacement)
  return out
}
