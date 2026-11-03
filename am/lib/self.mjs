// am's own part, automagik.am (RFC 0012, "The am part"): where it lives, how it updates from the
// signed am-lane, how it rolls back, the links it owns and the briefing entry it writes.
//
//   <AM_HOME, else ~/.automagik>/parts/automagik.am/
//     <version>/      a whole verified extract of automagik-am-<version>.tgz (or the folder
//                     `am self install` ran from); only `current` and `previous` are kept
//     current, previous   links to a <version>/, each swapped by one rename
//     record.json     { current, previous, seen }: each { version, sequence, signed, source,
//                     sha256, installed, part (its part.json) }; `seen` the highest sequence taken
//   ~/.local/bin/am                -> parts/automagik.am/current/bin/am
//   ~/.local/bin/automagik-herdr   -> parts/automagik.am/current/bin/automagik-herdr, taken only
//                     when it is missing or points into the pack (the pack leaves a link that
//                     points elsewhere alone); handed back to the pack's on uninstall
//   <HERDR_APP_HOME>/automagik-herdr/briefing.mjs   am's copy of the pack's briefing entry, the
//                     same bytes the pack writes (it tries am's briefing first, then the sidebar's)
//
// am-lane is read from https://github.com/automagik-dev/automagik/releases/download/am-lane/. For
// tests only: AM_RELEASE_URL, a file:// folder (files at <url>/download/<tag>/<file>), and with a
// file:// one only, AM_TRUSTED_KEYS (am-keys.json's shape, a test's own keys): never honoured for
// a GitHub URL. Apache-2.0.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_RELEASE, PART, POINTER, RELEASES, REPOSITORY, SIGNATURE, verifyPointer } from "./lane.mjs";

/** This am's own folder (the extract it runs from). */
export const OWN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const homeOf = (env) => env.HOME || homedir();
export const amHomeOf = (env = process.env) => (env.AM_HOME || join(homeOf(env), ".automagik")).replace(/\/+$/, "");
export const storeOf = (env = process.env) => join(amHomeOf(env), "parts", PART);
export const binDirOf = (env = process.env) => join(homeOf(env), ".local", "bin");
export const appHomeOf = (env = process.env) => (env.HERDR_APP_HOME || join(homeOf(env), ".config", "herdr-app")).replace(/\/+$/, "");

const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } };
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
const linkOf = (path) => { try { return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null; } catch { return null; } };
const exists = (path) => { try { lstatSync(path); return true; } catch { return false; } };
const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);
const absolute = (link, target) => resolve(dirname(link), target);

/** The keys this am trusts for am-lane: its own am-keys.json. */
export const ownKeys = (dir = OWN_DIR) => readJson(join(dir, "am-keys.json"))?.keys ?? [];

/** Where am-lane and the releases are read from, and the keys checked: { releases, keys, file }. */
export function sourceOf(env = process.env, keys = ownKeys()) {
  const url = env.AM_RELEASE_URL;
  if (!url) return { releases: RELEASES, keys, file: false };
  const file = url.startsWith("file://");
  if (!file && !url.startsWith(`${REPOSITORY}/`)) throw new Error(`AM_RELEASE_URL must be a file:// folder or ${REPOSITORY}/…; not ${url}`);
  // A test's own keys: honoured for a file:// folder only, never for a GitHub URL.
  const override = file && env.AM_TRUSTED_KEYS ? JSON.parse(env.AM_TRUSTED_KEYS).keys : null;
  return { releases: url.replace(/\/+$/, ""), keys: override ?? keys, file };
}

/** The bytes at `url`, or null when there are none (a 404, a missing file). */
async function fetchBytes(url, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (url.startsWith("file://")) {
    try { return readFileSync(fileURLToPath(url)); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  const response = await fetch(url, { headers: { "user-agent": "am" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The newest am as am-lane's signed pointer names it, or null when nothing is posted yet. */
export async function readLane({ env = process.env, keys = ownKeys(), fetch } = {}) {
  const { releases, keys: trusted } = sourceOf(env, keys);
  const base = `${releases}/download/${LANE_RELEASE}`;
  const bytes = await fetchBytes(`${base}/${POINTER}`, { fetch });
  if (bytes === null) return null;
  const sig = await fetchBytes(`${base}/${SIGNATURE}`, { fetch });
  if (sig === null) throw new Error(`am lane: ${SIGNATURE} is missing: refusing the pointer`);
  return verifyPointer(bytes, sig.toString("utf8"), trusted);
}

/** The record (record.json), with empty slots when there is none. */
export function readRecord(store) {
  const r = readJson(join(store, "record.json"));
  return { current: r?.current ?? null, previous: r?.previous ?? null, seen: Number.isSafeInteger(r?.seen) ? r.seen : null };
}

function writeRecord(store, record) {
  const tmp = join(store, `.record-${randomBytes(4).toString("hex")}`);
  writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, id: PART, ...record }, null, 2)}\n`);
  renameSync(tmp, join(store, "record.json"));
}

/** Points the link `name` in `store` at `target` (a folder name in it) by one rename. */
function swapLink(store, name, target) {
  const tmp = join(store, `.${name}-${randomBytes(4).toString("hex")}`);
  symlinkSync(target, tmp);
  renameSync(tmp, join(store, name));
}

/** What is wrong with an am extract in `dir`: empty when it is one, of `version` when given. */
export function extractProblems(dir, version) {
  const out = [];
  const part = readJson(join(dir, "part.json"));
  if (part?.id !== PART) out.push(`part.json is not ${PART}'s`);
  const v = readText(join(dir, "VERSION"))?.trim();
  if (!v) out.push("it has no VERSION");
  else if (version && v !== version) out.push(`its VERSION is ${v}, not ${version}`);
  for (const f of ["bin/am", "bin/am.mjs", "bin/automagik-herdr", "bin/automagik-herdr.mjs", "bin/run.sh", "briefing.mjs", "briefingEntry.mjs"]) {
    if (!existsSync(join(dir, f))) out.push(`${f} is missing`);
  }
  return out;
}

/**
 * Installs the am extract in `dir` as current: copies it into the store as <version>/ (unless it is
 * that folder already), keeps the one it replaces as previous, prunes the rest, records it, links
 * and writes the briefing entry. Returns { version, from, links, entry }.
 */
export function installExtract(dir, { env = process.env, sequence = null, signed = false, source, sha256 = null, now = () => new Date() } = {}) {
  const problems = extractProblems(dir);
  if (problems.length) throw new Error(`not an am to install (${dir}): ${problems.join("; ")}`);
  const version = readText(join(dir, "VERSION")).trim();
  const store = storeOf(env);
  mkdirSync(store, { recursive: true });
  const target = join(store, version);
  const record = readRecord(store);
  const from = record.current?.version ?? null;
  if (!(exists(target) && realpathSync(target) === realpathSync(dir))) {
    // An update's extract is already staged in the store: it moves in; any other folder is copied.
    const staged = dirname(realpathSync(dir)) === realpathSync(store) && basename(dir).startsWith(".staging-");
    const staging = staged ? dir : mkdtempSync(join(store, ".staging-"));
    if (!staged) cpSync(dir, staging, { recursive: true, verbatimSymlinks: true });
    chmodSync(staging, 0o755);
    if (exists(target)) {
      const old = join(store, `.old-${randomBytes(4).toString("hex")}`);
      renameSync(target, old);
      renameSync(staging, target);
      rmSync(old, { recursive: true, force: true });
    } else {
      renameSync(staging, target);
    }
  }
  const entry = {
    version, sequence, signed, source: source ?? dir, sha256, installed: now().toISOString(),
    part: readJson(join(target, "part.json")),
  };
  const previous = from && from !== version ? record.current : record.previous?.version === version ? null : record.previous;
  if (previous) swapLink(store, "previous", previous.version);
  else rmSync(join(store, "previous"), { force: true });
  swapLink(store, "current", version);
  const seen = [record.seen, sequence].filter(Number.isSafeInteger);
  writeRecord(store, { current: entry, previous, seen: seen.length ? Math.max(...seen) : null });
  prune(store);
  return { version, from, links: linkCommands(env), entry: writeEntry(env) };
}

/** Removes every folder in the store but current's and previous's (and stray staging). */
export function prune(store) {
  const keep = new Set(["record.json", "current", "previous"]);
  for (const name of ["current", "previous"]) { const to = linkOf(join(store, name)); if (to) keep.add(to); }
  for (const name of readdirSync(store)) if (!keep.has(name)) rmSync(join(store, name), { recursive: true, force: true });
}

/** The pack's CLI entries a ~/.local/bin/automagik-herdr link may point at (install.sh's). */
const packEntries = (env) => ["am-sidebar", "spaces-agents"].flatMap((m) =>
  ["automagik-herdr", "automagik-herdr.mjs"].map((f) => join(appHomeOf(env), "mods", m, "bin", f)));

/**
 * Links ~/.local/bin/am and ~/.local/bin/automagik-herdr to the current am. `am` is am's alone: a
 * file there, or a link elsewhere, is left alone and reported. automagik-herdr is taken only when it
 * is missing, already am's, or one of the pack's own links. Returns one line per link.
 */
export function linkCommands(env = process.env) {
  const bin = binDirOf(env);
  const store = storeOf(env);
  mkdirSync(bin, { recursive: true });
  const ours = (to) => inside(to, store);
  const pack = new Set(packEntries(env));
  const one = (name, takes) => {
    const link = join(bin, name);
    const want = join(store, "current", "bin", name);
    const to = linkOf(link);
    if (to !== null && absolute(link, to) === want) return { link, state: "linked" };
    if (exists(link) && (to === null || !takes(absolute(link, to)))) {
      return { link, state: "left", detail: to === null ? "a file, not a link" : `it points at ${to}` };
    }
    const tmp = join(bin, `.${name}-${randomBytes(4).toString("hex")}`);
    symlinkSync(want, tmp);
    renameSync(tmp, link);
    return { link, state: to === null ? "created" : "moved", detail: to ?? undefined };
  };
  return [one("am", ours), one("automagik-herdr", (to) => ours(to) || pack.has(to))];
}

/** Writes am's copy of the briefing entry to <app home>/automagik-herdr/briefing.mjs, when Herdr's app home exists. */
export function writeEntry(env = process.env) {
  const appHome = appHomeOf(env);
  try { if (!statSync(appHome).isDirectory()) return { state: "no-app-home" }; } catch { return { state: "no-app-home" }; }
  const text = readFileSync(join(storeOf(env), "current", "briefingEntry.mjs"));
  const dir = join(appHome, "automagik-herdr");
  const path = join(dir, "briefing.mjs");
  try { if (readFileSync(path).equals(text)) return { path, state: "same" }; } catch { /* missing */ }
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.briefing-${randomBytes(4).toString("hex")}.mjs`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return { path, state: "written" };
}

/**
 * am's half of an uninstall: ~/.local/bin/am goes, and automagik-herdr goes back to the pack's
 * entry when a pack is installed (else it goes). The store stays, unless `purge`.
 */
export function uninstallSelf({ env = process.env, purge = false } = {}) {
  const bin = binDirOf(env);
  const store = storeOf(env);
  const lines = [];
  for (const name of ["am", "automagik-herdr"]) {
    const link = join(bin, name);
    const to = linkOf(link);
    if (to === null || !inside(absolute(link, to), store)) continue;
    const back = name === "automagik-herdr" ? packEntries(env).find((p) => existsSync(p)) : null;
    if (back) {
      const tmp = join(bin, `.${name}-${randomBytes(4).toString("hex")}`);
      symlinkSync(back, tmp);
      renameSync(tmp, link);
      lines.push({ link, state: "handed back", detail: back });
    } else {
      rmSync(link, { force: true });
      lines.push({ link, state: "removed" });
    }
  }
  if (purge) rmSync(store, { recursive: true, force: true });
  return { links: lines, purged: purge };
}

/** Swaps current and previous; returns { from, to }. */
export function rollbackSelf({ env = process.env } = {}) {
  const store = storeOf(env);
  const record = readRecord(store);
  if (!record.previous || !existsSync(join(store, record.previous.version))) throw new Error("am has no previous version to roll back to");
  swapLink(store, "current", record.previous.version);
  swapLink(store, "previous", record.current.version);
  writeRecord(store, { current: record.previous, previous: record.current, seen: record.seen });
  return { from: record.current.version, to: record.previous.version, links: linkCommands(env), entry: writeEntry(env) };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** What is wrong with a tarball's entries (`tar -tzf`'s names, `tar -tvzf`'s lines): empty when all is well. */
export function unsafeEntries(names, lines) {
  if (names.length === 0) return ["the tarball is empty"];
  if (names.length !== lines.length) return ["the tarball's listing does not add up (a name with a line break?)"];
  const problems = [];
  names.forEach((name, i) => {
    const type = lines[i][0];
    if (name.startsWith("/")) problems.push(`${name}: an absolute path`);
    else if (name.split("/").includes("..")) problems.push(`${name}: a .. segment`);
    else if ((type !== "-" && type !== "d") || lines[i].includes(" link to ") || lines[i].includes(" -> ")) problems.push(`${name}: not a plain file or folder`);
  });
  return problems;
}

const tarList = (tgz, flags) => execFileSync("tar", [flags, tgz], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean);

/**
 * Updates am from am-lane: refuses a pointer older than one this machine took (`seen`), does
 * nothing when current, downloads the tarball from the pointer's release, checks it against the
 * pointer's sha256 and size and its entries, extracts it beside the installed copy and swaps.
 * `check`: only reports. Returns { state: none|current|available|updated, from, to, detail }.
 */
export async function updateSelf({ env = process.env, keys = ownKeys(), fetch, check = false } = {}) {
  const store = storeOf(env);
  const record = readRecord(store);
  const from = record.current?.version ?? null;
  const pointer = await readLane({ env, keys, fetch });
  if (!pointer) return { state: "none", from, to: null, detail: "nothing is posted on am-lane yet" };
  if (record.seen !== null && pointer.sequence < record.seen) {
    throw new Error(`am lane: it names ${pointer.version} (sequence ${pointer.sequence}), older than the newest this machine took (sequence ${record.seen}): refusing it`);
  }
  if (record.current?.sequence === pointer.sequence && existsSync(join(store, "current"))) return { state: "current", from, to: pointer.version };
  if (check) return { state: "available", from, to: pointer.version };
  const { releases } = sourceOf(env, keys);
  const bytes = await fetchBytes(`${releases}/download/${pointer.tag}/${pointer.tarball.name}`, { fetch, timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (bytes === null) throw new Error(`${pointer.tarball.name} is not on ${pointer.tag}`);
  const got = sha256(bytes);
  if (got !== pointer.tarball.sha256 || bytes.byteLength !== pointer.tarball.size) {
    throw new Error(`${pointer.tarball.name} does not match the signed pointer (sha256 ${got}, expected ${pointer.tarball.sha256}): refusing it`);
  }
  mkdirSync(store, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "am-update-"));
  try {
    const tgz = join(work, pointer.tarball.name);
    writeFileSync(tgz, bytes);
    const unsafe = unsafeEntries(tarList(tgz, "-tzf"), tarList(tgz, "-tvzf"));
    if (unsafe.length) throw new Error(`${pointer.tarball.name}: ${unsafe.join("; ")}: refusing it`);
    const staging = mkdtempSync(join(store, ".staging-"));
    execFileSync("tar", ["-xzf", tgz, "-C", staging], { stdio: ["ignore", "ignore", "pipe"] });
    const problems = extractProblems(staging, pointer.version);
    if (problems.length) { rmSync(staging, { recursive: true, force: true }); throw new Error(`${pointer.tarball.name}: ${problems.join("; ")}: refusing it`); }
    const done = installExtract(staging, { env, sequence: pointer.sequence, signed: true, source: LANE_RELEASE, sha256: got });
    return { state: "updated", from, to: pointer.version, links: done.links, entry: done.entry };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * am's doctor lines ({ part, check, ok, detail, fix }) and its exit code: 0 healthy, 1 broken.
 */
export function doctorSelf({ env = process.env } = {}) {
  const store = storeOf(env);
  const record = readRecord(store);
  const line = (check, ok, detail, fix) => ({ part: PART, check, ok, detail, ...(ok ? {} : { fix }) });
  const lines = [];
  const current = join(store, "current");
  const problems = existsSync(current) ? extractProblems(current, record.current?.version) : ["it is not installed"];
  lines.push(line("installed", problems.length === 0, problems.length ? problems.join("; ") : `${record.current?.version} in ${realpathSync(current)}`,
    "am self install, from an am extract"));
  for (const name of ["am", "automagik-herdr"]) {
    const link = join(binDirOf(env), name);
    const to = linkOf(link);
    const want = join(store, "current", "bin", name);
    const ok = to !== null && absolute(link, to) === want;
    lines.push(line(`link ${name}`, ok, ok ? `${link} -> ${to}` : to ? `${link} points at ${to}` : exists(link) ? `${link} is a file` : `${link} is missing`,
      `am self install (a ${name} that is not am's is left alone: remove it first)`));
  }
  if (existsSync(appHomeOf(env))) {
    const path = join(appHomeOf(env), "automagik-herdr", "briefing.mjs");
    const text = readText(path);
    const ok = text !== null && existsSync(join(current, "briefingEntry.mjs")) && text === readText(join(current, "briefingEntry.mjs"));
    lines.push(line("briefing entry", ok, ok ? path : text === null ? `${path} is missing` : `${path} is not am's copy`, "am self install"));
  }
  const keys = ownKeys(existsSync(current) ? current : OWN_DIR);
  // Not a fault of this machine: until a release ships am's key, am only cannot update itself.
  lines.push(line("am-lane keys", true, keys.length ? keys.map((k) => k.keyId).join(", ") : "am-keys.json lists no key yet: am cannot update itself until a release ships one"));
  return { lines, code: lines.every((l) => l.ok) ? 0 : 1 };
}
