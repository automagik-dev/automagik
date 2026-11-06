// am-quota's translations: the proxy's Codex credential shape → the shape Codex actually reads.
//
// Pure, so `node --test` proves them. Claude has no translation and no writer: a Claude login is
// never installed from the proxy, and this mod never reads or writes a Claude Keychain item
// (#453, docs/local-logins.md). The measured shapes (2026-11-01):
//   proxy codex  { access_token, account_id, id_token, refresh_token, expired, email, last_refresh, plan_type }
//   codex auth   { OPENAI_API_KEY: null, auth_mode: "chatgpt", last_refresh, tokens: { access_token,
//                  account_id, id_token, login_owner_id?, oauth_provenance?, refresh_token } }

const str = (v) => (typeof v === "string" ? v.trim() : "");
/** A token is opaque, but it is not arbitrary text: no whitespace, and long enough to be one. */
const isToken = (v) => { const s = str(v); return s.length >= 16 && !/\s/.test(s); };

/** What stops a credential from being installed at all, for people. */
export function problems(provider, credential) {
  const out = [];
  if (!credential || typeof credential !== "object") return ["the proxy returned no credential"];
  if (!isToken(credential.access_token)) out.push(str(credential.access_token) ? "the access token is not a token" : "no access token");
  if (!isToken(credential.refresh_token)) out.push(str(credential.refresh_token) ? "the refresh token is not a token" : "no refresh token");
  if (provider === "codex" && !str(credential.account_id) && !str(credential.id_token)) out.push("no account id or id token");
  return out;
}

/** The proxy's Codex credential, as `~/.codex/auth.json` expects it. */
export function toCodex(credential, { now = new Date() } = {}) {
  const missing = problems("codex", credential);
  if (missing.length) throw new Error(missing.join("; "));
  const tokens = {
    access_token: str(credential.access_token),
    refresh_token: str(credential.refresh_token),
    account_id: str(credential.account_id) || undefined,
    id_token: str(credential.id_token) || undefined,
  };
  for (const key of Object.keys(tokens)) if (tokens[key] === undefined) delete tokens[key];
  return {
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    last_refresh: (typeof credential.last_refresh === "string" && credential.last_refresh) || now.toISOString(),
    tokens,
  };
}

/** A directory from an environment variable, `~` expanded, no trailing slash. */
const envDir = (value, fallback, home) => {
  const s = typeof value === "string" ? value.trim() : "";
  const p = !s ? fallback : s === "~" ? home : s.startsWith("~/") ? `${home}${s.slice(1)}` : s;
  return p.replace(/\/+$/, "") || "/";
};

/**
 * Where a provider's credentials go. Used by the panel's writer, for Codex only. `env` is the
 * client's own environment, so `CODEX_HOME` moves the file the way it moves it for Codex itself;
 * an unset or empty variable means the default folder.
 */
export const TARGETS = {
  codex: {
    label: "Codex",
    file: (home, env = {}) => `${envDir(env.CODEX_HOME, `${home}/.codex`, home)}/auth.json`,
  },
};

/** One provider's write plan: its label and the file. Null for a provider with no writer (Claude). */
export function credentialTarget(provider, { home, env = {} } = {}) {
  const target = TARGETS[provider];
  if (!target) return null;
  return { label: target.label, file: target.file(home, env) };
}

/**
 * UTF-8 text from a hex string of bytes, or null when the string is not whole bytes of hex.
 * `security find-generic-password -w` prints hex when the value holds 0x0a, and a byte is not a
 * character: `String.fromCharCode` would turn `Café` into `CafÃ©`. Malformed sequences decode to
 * U+FFFD, as a `TextDecoder` does; nothing throws.
 */
export function hexToUtf8(hex) {
  if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2})*$/.test(hex)) return null;
  const s = hex;
  let out = "";
  let i = 0;
  const at = (k) => parseInt(s.slice(k, k + 2), 16);
  while (i < s.length) {
    const b = at(i);
    i += 2;
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    let need;
    let cp;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; }
    else { out += "\ufffd"; continue; }
    if (i + need * 2 > s.length) { out += "\ufffd"; break; }
    let ok = true;
    for (let k = 0; k < need; k++) {
      const c = at(i + k * 2);
      if ((c & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok) { out += "\ufffd"; continue; }   // the offending byte is read again, as its own sequence
    i += need * 2;
    const overlong = (need === 1 && cp < 0x80) || (need === 2 && cp < 0x800) || (need === 3 && cp < 0x10000);
    if (overlong || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) { out += "\ufffd"; continue; }
    if (cp > 0xffff) {
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else out += String.fromCharCode(cp);
  }
  return out;
}

/**
 * The text of a Keychain item as `security find-generic-password -w` printed it: the value itself
 * when it holds no 0x0a, its hex when it does (the stored bytes are right either way). Null when
 * neither reading is JSON.
 */
export function itemText(raw) {
  const s = typeof raw === "string" ? raw.replace(/\n+$/, "") : "";
  if (!s) return null;
  const isJson = (v) => { try { JSON.parse(v); return true; } catch { return false; } };
  if (isJson(s)) return s;
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    const out = hexToUtf8(s);
    if (out && isJson(out)) return out;
  }
  return null;
}

/** A stable 32-bit fingerprint (FNV-1a) of a token: an identity to compare, never the token. */
export function fingerprint(value) {
  const s = typeof value === "string" ? value : "";
  if (!s) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * The installed Codex credential's identity, from its file: `account_id`, which a token refresh
 * does not change. Null for any other provider: Claude's identity is never read from a credential.
 */
export function tokenIdentity(provider, text) {
  if (provider !== "codex") return null;
  const body = itemText(text);
  if (!body) return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return fingerprint(str(parsed?.tokens?.account_id) || str(parsed?.tokens?.refresh_token));
}
