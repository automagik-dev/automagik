// am-quota's saved logins: Claude Code accounts kept on this machine, so swapping between them
// needs no new sign-in.
//
// A saved login is ONLY the `claudeAiOauth` part of the client's credential, kept in its own
// Keychain item (`am-quota saved: <name>`) on macOS, or in a `0600` file in a `0700` folder under
// the app's data folder elsewhere — never in a plain file on a Mac. Everything is written through
// `switch.place`, the proxy switch's own path: a payload file, one hex `security -i` add, a
// read-back, the old item put back on failure. A token never enters argv, a log, a notify, shared
// state, an error or a return value; what comes back is a name, a fingerprint and the plan.
//
// Claude rotates its refresh token on use, so a saved copy goes stale as soon as the login it was
// taken from is used. That is why `useSaved` re-saves the login in use into ITS saved copy first,
// and why a proxy switch does the same (`resaveActive`). Which saved login is in use is the
// panel's record (`active.json`'s `saved`): a rotated token cannot be told from another account's,
// so the record is the identity, checked against the saved copy's plan before it is trusted.
//
// `exec`, `readTextFile`, `writeTextFile` and `unlink` are injected, as in `switch.js`.
import * as fs from "fs/promises";
import { credentialTarget, fingerprint, itemText, keychainService } from "./translate.js";
import { place } from "./switch.js";
import { keychainBackupPath, keychainBackupScript, payloadDir, prepareScript } from "./write.js";

/** The prefix of every saved login's Keychain service. */
export const SAVED_PREFIX = "am-quota saved: ";

/** A name is a word: it becomes part of a Keychain service and a file name, so nothing else. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** Why a name cannot be used, for people; null when it can. */
export function nameProblem(name) {
  if (typeof name !== "string" || !name.trim()) return "give the login a name";
  if (!NAME.test(name.trim())) return "a name is up to 32 letters, digits, '.', '_' or '-', starting with a letter or digit";
  return null;
}

const checked = (name) => {
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  return name.trim();
};

/** The Keychain service a saved login is kept under. */
export const savedService = (name) => `${SAVED_PREFIX}${checked(name)}`;

/** Where a saved login is kept without a Keychain: its own file in a `0700` folder. */
export const savedFile = (appHome, name) => `${payloadDir(appHome)}/saved/${checked(name)}.json`;

/**
 * The copy a re-save replaced, one level deep, so a re-save into the wrong name (the record can be
 * wrong: a /login outside the panel, an old session refreshing its tokens back in) loses nothing.
 * The service holds a space and the file sits in its own folder, so no saved name can reach either.
 */
export const previousService = (name) => `${SAVED_PREFIX}${checked(name)} (previous)`;
export const previousFile = (appHome, name) => `${payloadDir(appHome)}/saved/previous/${checked(name)}.json`;

/** The index: names and what to show for them (plan, email, org, saved-at). Never a token. */
export const indexPath = (appHome) => `${payloadDir(appHome)}/saved.json`;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const isToken = (v) => { const s = str(v); return s.length >= 16 && !/\s/.test(s); };
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/**
 * Removes a saved login's Keychain item and proves it gone. `$1` is the service. Exit 0: there is
 * no such item now (it was deleted, or there was none). Anything else: it is still there.
 */
export function keychainForgetScript() {
  return `set -u
security delete-generic-password -s "$1" >/dev/null 2>&1 || true
if security find-generic-password -w -s "$1" >/dev/null 2>&1; then
  echo "am-quota: the saved login is still in the Keychain" >&2
  exit 1
fi`;
}

/** Removes a saved login's file where there is no Keychain. `$1` is the file. */
export function fileForgetScript() {
  return `set -u
rm -f "$1"
[ ! -e "$1" ]`;
}

/** What a saved login's row shows: from the token data only, and only when it carries it. */
export function describe(oauth) {
  return {
    email: str(oauth?.emailAddress) || str(oauth?.email) || null,
    org: str(oauth?.organizationName) || str(oauth?.organization_name) || null,
    plan: str(oauth?.subscriptionType) || null,
  };
}

/**
 * Whether two logins can be the same account: a token rotation keeps the plan, the rate tier and
 * the scopes, while another account often differs in one of them. A field missing on either side
 * is not evidence. This is a guard against re-saving the wrong account, not an identity.
 */
export function sameAccountShape(a, b) {
  const same = (x, y) => !x || !y || x === y;
  const scopes = (o) => (Array.isArray(o?.scopes) ? [...o.scopes].map(String).sort().join(" ") : "");
  return same(str(a?.subscriptionType), str(b?.subscriptionType))
    && same(str(a?.rateLimitTier), str(b?.rateLimitTier))
    && same(scopes(a), scopes(b));
}

/** The index as stored, or an empty one; a damaged index is an empty one, not an error. */
export async function readIndex({ appHome, readTextFile }) {
  let raw = null;
  try {
    raw = await readTextFile(indexPath(appHome));
  } catch {}
  try {
    const parsed = JSON.parse(raw ?? "{}");
    const out = {};
    for (const [name, meta] of Object.entries(parsed?.logins ?? {})) {
      if (nameProblem(name) || !meta || typeof meta !== "object") continue;
      out[name] = {
        savedAt: str(meta.savedAt) || null,
        email: str(meta.email) || null,
        org: str(meta.org) || null,
        plan: str(meta.plan) || null,
        previousAt: str(meta.previousAt) || null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeIndex(logins, { appHome, readTextFile, writeTextFile }) {
  const path = indexPath(appHome);
  // writeTextFile wants the snapshot it replaces: null only creates.
  const before = await Promise.resolve().then(() => readTextFile(path)).catch(() => null);
  await writeTextFile(path, `${JSON.stringify({ version: 1, logins }, null, 2)}\n`, before ?? null);
}

async function updateIndex(io, change) {
  const logins = await readIndex(io);
  change(logins);
  await writeIndex(logins, io);
  return logins;
}

/** Where the client keeps its login now: `{ service }` or `{ file }`. Throws when unknowable. */
async function clientSource({ home, env, platform, exec }) {
  const plan = credentialTarget("claude", { home, env, keychainWritten: true, platform });
  if (!plan.keychain) return { file: plan.file };
  const service = await keychainService(plan, { exec });
  if (!service) throw new Error("could not tell which Keychain item this profile reads; nothing was changed");
  return { service };
}

/** Where a saved login lives on this platform. The rule for "is there a Keychain" is translate.js's. */
function savedSource(name, { home, env, platform, appHome }) {
  const plan = credentialTarget("claude", { home, env, platform });
  return plan.keychain ? { service: savedService(name) } : { file: savedFile(appHome, name) };
}

/** Where the copy a re-save replaced is kept. */
function previousSource(name, { home, env, platform, appHome }) {
  const plan = credentialTarget("claude", { home, env, platform });
  return plan.keychain ? { service: previousService(name) } : { file: previousFile(appHome, name) };
}

/** Removes one item or file and proves it gone. */
async function remove(where, io) {
  const r = where.service
    ? await io.exec("sh", ["-c", keychainForgetScript(), "sh", where.service])
    : await io.exec("sh", ["-c", fileForgetScript(), "sh", where.file]);
  return r.code === 0;
}

/** Writes the index, naming the failure: the copies themselves have already changed. */
async function indexed(io, done, change) {
  try {
    await updateIndex(io, change);
  } catch {
    throw new Error(`${done}, but the list of saved logins could not be updated — reopen the panel`);
  }
}

/**
 * The `claudeAiOauth` held by an item or a file, or null when there is none. The item is copied to
 * a `0600` hex file in the `0700` payload folder (the switch's own backup script, read-only on the
 * item), read, and the copy removed. Throws, without detail, when the item exists but cannot be
 * read, or holds something that is not a login.
 */
export async function readLogin(source, { appHome, exec, readTextFile, unlink = (p) => fs.unlink(p) }, what = "the saved login") {
  let text = null;
  if (source.service) {
    const prep = await exec("sh", ["-c", prepareScript(), "sh", payloadDir(appHome)]);
    if (prep.code !== 0) throw new Error("could not prepare a private file to read the login into");
    const copy = keychainBackupPath(appHome, "read", stamp());
    try {
      const r = await exec("sh", ["-c", keychainBackupScript(), "sh", source.service, copy]);
      if (r.code === 3) return null;
      if (r.code !== 0) throw new Error("could not read the login from the Keychain (is it locked?)");
      text = await readTextFile(copy).catch(() => null);
    } finally {
      await unlink(copy).catch(() => {});
    }
  } else {
    try {
      text = await readTextFile(source.file);
    } catch {
      return null;
    }
    if (!text) return null;
  }
  const body = itemText(text);
  let oauth = null;
  try {
    oauth = body ? JSON.parse(body)?.claudeAiOauth ?? null : null;
  } catch {}
  if (!oauth || typeof oauth !== "object" || !isToken(oauth.accessToken) || !isToken(oauth.refreshToken)) {
    throw new Error(`${what} is not a Claude Code login`);
  }
  return oauth;
}

const ioOf = (o) => ({
  home: o.home, appHome: o.appHome, env: o.env ?? {}, platform: o.platform ?? "macos",
  exec: o.exec, readTextFile: o.readTextFile, writeTextFile: o.writeTextFile,
  unlink: o.unlink ?? ((p) => fs.unlink(p)),
});

const body = (oauth) => JSON.stringify({ claudeAiOauth: oauth });
const sameToken = (a, b) => fingerprint(str(a?.refreshToken)) === fingerprint(str(b?.refreshToken));

/**
 * Writes one login into a saved copy and the index. A copy it replaces that holds another refresh
 * token (`prior`, read by the caller) is first written to the previous slot, the same safe way; if
 * that fails nothing is replaced.
 */
async function keep(name, oauth, io, prior = null) {
  const keepPrior = Boolean(prior) && !sameToken(prior, oauth);
  if (keepPrior) await place({ provider: "claude", body: body(prior), to: previousSource(name, io), ...io });
  const placed = await place({ provider: "claude", body: body(oauth), to: savedSource(name, io), ...io });
  const now = new Date().toISOString();
  await indexed(io, `saved ${name}`, (logins) => {
    const was = logins[name];
    logins[name] = { savedAt: now, ...describe(oauth), previousAt: keepPrior ? (was?.savedAt ?? now) : (was?.previousAt ?? null) };
  });
  return placed;
}

/**
 * "Save this login as <name>": the client's current login, its `claudeAiOauth` only, into the
 * saved copy. `replace: false` refuses a name that is already saved (that is Re-save's job).
 * Answers `{ name, fingerprint, plan, email, org }`.
 */
export async function saveLogin(options) {
  const io = ioOf(options);
  const name = checked(options.name);
  if (options.replace === false && (await readIndex(io))[name]) {
    throw new Error(`${name} is already saved — use its Re-save to replace it with the login in use`);
  }
  const current = await readLogin(await clientSource(io), io, "the login in use");
  if (!current) throw new Error("there is no Claude Code login on this machine to save — sign in first");
  const prior = await readLogin(savedSource(name, io), io).catch(() => null);
  const placed = await keep(name, current, io, prior);
  return { name, fingerprint: placed.fingerprint, ...describe(current) };
}

/**
 * Re-saves the login in use into its saved copy — the record says which (`name`) — so the newest
 * refresh token is kept before something else replaces it. Refuses when the login in use does not
 * look like that saved account (see `sameAccountShape`): it may have been signed in outside the
 * panel, and re-saving it would overwrite the saved account with another one. Answers
 * `{ resaved }`; nothing to re-save (no login in use, or the copy already holds this token) is
 * `false`.
 */
export async function resaveActive(options) {
  const io = ioOf(options);
  const name = checked(options.name);
  const current = await readLogin(await clientSource(io), io, "the login in use");
  if (!current) return { resaved: false };
  const copy = await readLogin(savedSource(name, io), io).catch(() => null);
  if (copy && fingerprint(str(copy.refreshToken)) === fingerprint(str(current.refreshToken))) return { resaved: false };
  if (copy && !sameAccountShape(copy, current)) {
    throw new Error(`the login in use does not look like ${name} (its plan differs) — save it under its own name, or Re-save ${name} to confirm; nothing was changed`);
  }
  // The record can be wrong, and two accounts on one plan pass the check above: the copy being
  // replaced is kept as the previous one, so a wrong re-save can be undone (`restorePrevious`).
  await keep(name, current, io, copy);
  return { resaved: true };
}

/**
 * Use a saved login: the saved copy is read first (a missing one changes nothing); then the login
 * in use is re-saved into its own copy (`current`, the record's name — none means it is not saved,
 * and it would be lost, so this refuses); then the saved login goes into the client's item or file
 * through the proxy switch's path (merge, backup, read-back, put back on failure).
 * Answers `{ label, fingerprint, name, resaved }`.
 */
export async function useSaved(options) {
  const io = ioOf(options);
  const name = checked(options.name);
  const current = options.current ? checked(options.current) : null;
  if (current === name) throw new Error(`${name} is already in use`);
  const chosen = await readLogin(savedSource(name, io), io);
  if (!chosen) throw new Error(`there is no saved login named ${name}; nothing was changed`);
  if (!current) {
    throw new Error("the login in use is not saved, so it would be lost — save it first (Save this login as…); nothing was changed");
  }
  const { resaved } = await resaveActive({ ...io, name: current });
  const placed = await place({ provider: "claude", body: JSON.stringify({ claudeAiOauth: chosen }), ...io });
  return { label: placed.label, fingerprint: placed.fingerprint, name, resaved };
}

/**
 * "Restore previous": the copy the last re-save replaced goes back into the saved login, and the
 * copy it replaces becomes the previous one — a swap, so a restore can itself be undone. The
 * previous copy is written first: if the second write fails, both slots hold it and nothing that
 * was asked for is lost.
 */
export async function restorePrevious(options) {
  const io = ioOf(options);
  const name = checked(options.name);
  const prev = await readLogin(previousSource(name, io), io);
  if (!prev) throw new Error(`there is no previous copy of ${name}; nothing was changed`);
  const now = await readLogin(savedSource(name, io), io).catch(() => null);
  await place({ provider: "claude", body: body(prev), to: savedSource(name, io), ...io });
  if (now) {
    try {
      await place({ provider: "claude", body: body(now), to: previousSource(name, io), ...io });
    } catch {
      throw new Error(`${name} is restored, but the copy it replaced could not be kept as the previous one`);
    }
  } else if (!(await remove(previousSource(name, io), io))) {
    throw new Error(`${name} is restored, but its previous copy could not be removed`);
  }
  await indexed(io, `restored ${name}`, (logins) => {
    const was = logins[name] ?? {};
    logins[name] = { ...was, ...describe(prev), savedAt: was.previousAt ?? new Date().toISOString(), previousAt: now ? (was.savedAt ?? null) : null };
  });
  return { name };
}

/**
 * Forget a saved login: its copy and its previous copy are removed and proved gone; only then is
 * its index entry dropped, and a failure there is reported.
 */
export async function forgetSaved(options) {
  const io = ioOf(options);
  const name = checked(options.name);
  if (!(await remove(savedSource(name, io), io))) throw new Error(`could not remove the saved login ${name}`);
  if (!(await remove(previousSource(name, io), io))) throw new Error(`removed ${name}, but not its previous copy`);
  await indexed(io, `removed ${name}`, (logins) => { delete logins[name]; });
  return { name };
}
