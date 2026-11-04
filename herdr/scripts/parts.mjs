#!/usr/bin/env node
// The herdr parts' manifests (RFC 0012): one part.json at each part's root, beside its own manifest
// (mod.json). `am` reads them to install, uninstall and check each part on its own; the pack's
// marker stays the install record during the bridge cycle (RFC 0012, "One install authority").
// This checks every part.json under herdr/ and herdr-layout/ against the fields RFC 0012 defines,
// and that what each one names exists: its paths match files git tracks, its select is its own
// folder inside the pack tarball, and each entry's script ships in that tarball. Across every
// part.json the repository tracks (am/ and apps/ too), no two may write the same path, glob or
// file#key unless one replaces the other.
//
//   node scripts/parts.mjs --check    exit 1, naming each problem
//
// It reads the files git tracks, from the repository's top, wherever it runs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KINDS = Object.freeze(["dsh-plugin", "herdr-mod", "herdr-layout", "binary", "android-app", "desktop-app"]);
export const OSES = Object.freeze(["macos", "linux", "windows"]);
export const TARGETS = Object.freeze(["local", "fleet"]);
export const SETS = Object.freeze(["code", "work"]);
export const VERBS = Object.freeze(["install", "uninstall", "doctor"]);
const REQUIRED = Object.freeze(["id", "title", "kind", "paths", "provides", "requires", "os", "targets", "artifact", "select", "entry", "writes", "set"]);
/** A fork replacing a part names it here (RFC 0012, "Replaceable through capabilities"). */
const OPTIONAL = Object.freeze(["replaces"]);
/** The pack tarball every herdr part comes from; release.js tarballName with the version left open. */
export const PACK_ARTIFACT = "automagik-herdr-pack-{version}.tgz";
/** The script every herdr part's entries run, inside the tarball. */
export const PACK_ENTRY = "am-sidebar/pack/part.mjs";

export const ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const CAP = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const PROVIDED = /^([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)@([1-9]\d*)$/;

/**
 * Where a path inside the pack tarball lives in the repository (scripts/pack.mjs packs it so):
 * `layouts/automagik.json` is `herdr-layout/layouts/automagik.json` (herdr.dev lists a layout only
 * from its entry's layouts/), the layout part's folder `am-sidebar/layout/` is `herdr-layout/`
 * (the layout's part.json rides inside the sidebar's folder, the only place every installed
 * updater accepts a new file), and every other `<mod>/…` is `herdr/mods/<mod>/…`. The one place to
 * change when the layout entry's shape does.
 */
export const LAYOUT_PART_DIR = "am-sidebar/layout/";
export function repoPathOf(inPack) {
  if (inPack === "layouts" || inPack.startsWith("layouts/")) return `herdr-layout/${inPack}`;
  if (inPack === LAYOUT_PART_DIR.slice(0, -1) || inPack.startsWith(LAYOUT_PART_DIR)) return `herdr-layout/${inPack.slice(LAYOUT_PART_DIR.length)}`;
  return `herdr/mods/${inPack}`;
}

/** A `paths` glob as a RegExp over repository paths: `**` crosses folders, `*` and `?` do not. */
export function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i += 1;
      if (glob[i + 1] === "/") { i += 1; re += "(?:.*/)?"; } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * A write in one spelling: lowercased (APFS is case-insensitive by default), Herdr's app home as
 * ~/.config/herdr-app ($HERDR_APP_HOME is how parts spell it), `//` collapsed, and `.` segments and a
 * trailing slash dropped. `{ path, key, dotdot }`: key is what follows `#` (null for the whole file).
 */
export function normalWrite(w) {
  const [p, ...k] = String(w).toLowerCase().split("#");
  const segs = p.replace(/^\$herdr_app_home(?=\/|$)/, "~/.config/herdr-app").replace(/\/{2,}/g, "/").split("/");
  const path = segs.filter((s, i) => s !== "." && !(s === "" && i === segs.length - 1 && i > 0)).join("/");
  return { path, key: k.length ? k.join("#") : null, dotdot: segs.includes("..") };
}

const wild = (s) => /[*?]/.test(s);
const escape = (c) => c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
const segRe = (s) => new RegExp(`^${[...s].map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : escape(c))).join("")}$`);
/** Whether two path segments (`*` and `?` wildcards) could name one segment; conservative when both are globs. */
function segsMeet(p, q) {
  if (!wild(p) && !wild(q)) return p === q;
  if (!wild(p)) return segRe(q).test(p);
  if (!wild(q)) return segRe(p).test(q);
  const head = (s) => s.slice(0, s.search(/[*?]/));
  const tail = (s) => s.slice(Math.max(s.lastIndexOf("*"), s.lastIndexOf("?")) + 1);
  const [hp, hq, tp, tq] = [head(p), head(q), tail(p), tail(q)];
  return (hp.startsWith(hq) || hq.startsWith(hp)) && (tp.endsWith(tq) || tq.endsWith(tp));
}
/**
 * Whether two paths or globs (normalWrite's; `**` a whole segment, any depth) could name one path.
 * Conservative: when it cannot tell, it says yes. `touch`: also require that one of `b`'s first
 * `touch` segments meets a segment of `a` that is not `**` (see reaches).
 */
export function pathsMeet(a, b, touch = 0) {
  const A = a.split("/"), B = b.split("/");
  const memo = new Map();
  const f = (i, j, t) => {
    const k = `${i},${j},${t}`;
    if (memo.has(k)) return memo.get(k);
    let r;
    if (i === A.length && j === B.length) r = t;
    else if (A[i] === "**") r = f(i + 1, j, t) || (j < B.length && f(i, j + 1, t));
    else if (B[j] === "**") r = f(i, j + 1, t) || (i < A.length && f(i + 1, j, t));
    else if (i === A.length || j === B.length) r = false;
    else r = segsMeet(A[i], B[j]) && f(i + 1, j + 1, t || j < touch);
    memo.set(k, r);
    return r;
  };
  return f(0, 0, touch === 0);
}
/**
 * Whether `a` and `b` could touch one file: one names the other, or a folder holding the other. A
 * project glob (one starting `**` then `/`: a file in any project) sits under a folder only when its
 * own tail meets that folder's named segments. The hooks' settings.local.json glob is not under
 * data/ just because `**` could walk into it (projects never live there), but a data/x glob is.
 */
const reaches = (a, b) => {
  const project = a.startsWith("**/") || b.startsWith("**/");
  const n = (x) => (project ? x.split("/").length : 0);
  return (pathsMeet(a, b, n(b)) && pathsMeet(b, a, n(a))) || pathsMeet(a, `${b}/**`, n(b)) || pathsMeet(b, `${a}/**`, n(a));
};

/**
 * What no part may write (RFC 0012, `writes`), as the folders and files themselves: Herdr's own
 * (shared.json, data/), Pocket Link's folder, and the LaunchAgents (Pocket Link's is Pocket's). A
 * write is refused when it could name one, sit under one, or hold one.
 */
export const PROTECTED = Object.freeze([
  ["~/.config/herdr-app/shared.json", "Herdr's shared.json"],
  ["~/.config/herdr-app/data", "Herdr's data/"],
  ["~/.config/herdr-app/mods/pocket-link", "Pocket Link (Pocket's part)"],
  ["~/library/launchagents", "a LaunchAgent"],
]);

/** Why a write may not be declared, or null: `..`, or a path or glob that can reach a PROTECTED one. */
export function refusedWrite(w) {
  const { path, dotdot } = normalWrite(w);
  if (dotdot) return "a path with .. is not a part's to write (it can reach anything)";
  for (const [p, why] of PROTECTED) if (reaches(path, p)) return `it can reach ${p}: ${why} is not a part's to write`;
  return null;
}

/**
 * Whether two writes reach one place: paths or globs that could name one file, or one holding the
 * other (conservative: a false alarm is fine), then for one file, keys of which one holds the other
 * (`f#hooks` and `f#hooks.X`; a whole file holds every key).
 */
export function writesOverlap(a, b) {
  const x = normalWrite(a), y = normalWrite(b);
  if (!reaches(x.path, y.path)) return false;
  if (!pathsMeet(x.path, y.path) || x.key === null || y.key === null) return true;
  return x.key === y.key || x.key.startsWith(`${y.key}.`) || y.key.startsWith(`${x.key}.`);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0);
const relative = (p) => typeof p === "string" && p !== "" && !p.startsWith("/") && !p.split("/").includes("..");

/**
 * Checks the part.json files among `files` (repository paths git tracks) under herdr/ and
 * herdr-layout/. `read(path)` returns a file's text; `packMods` is release.js PACK_MODS.
 * Returns `{ parts: [{ file, id }], problems: string[] }`.
 */
export function validateParts({ files, read, packMods }) {
  const tracked = new Set(files);
  const manifests = files.filter((f) => /^(herdr|herdr-layout)\/(.*\/)?part\.json$/.test(f)).sort();
  const problems = [];
  const parts = [];
  const ids = new Map();
  const caps = new Map();
  for (const file of manifests) {
    const bad = (why) => problems.push(`${file}: ${why}`);
    let part;
    try { part = JSON.parse(read(file)); } catch (e) { bad(`not JSON (${e.message})`); continue; }
    if (!isObject(part)) { bad("not a JSON object"); continue; }
    if (Object.hasOwn(part, "version")) bad("has a version: a part's version is the release's (RFC 0012), never written by hand");
    for (const k of Object.keys(part)) if (!REQUIRED.includes(k) && !OPTIONAL.includes(k) && k !== "version") bad(`unknown field ${k}`);
    for (const k of REQUIRED) if (!Object.hasOwn(part, k)) bad(`has no ${k}`);
    const root = `${dirname(file)}/`;

    if (typeof part.id !== "string" || !ID.test(part.id)) bad(`id ${JSON.stringify(part.id)} is not <owner>.<name> in lowercase words`);
    else if (ids.has(part.id)) bad(`id ${part.id} is ${ids.get(part.id)}'s too`);
    else ids.set(part.id, file);
    if (typeof part.title !== "string" || !part.title.trim()) bad("has no title");
    if (!KINDS.includes(part.kind)) bad(`kind ${JSON.stringify(part.kind)} is not one of ${KINDS.join(", ")}`);

    if (!strings(part.paths) || part.paths.length === 0) bad("paths is not a list of globs");
    else for (const p of part.paths) {
      if (!relative(p)) { bad(`path ${p} is not relative to the repository`); continue; }
      const re = globRe(p);
      if (!files.some((f) => re.test(f))) bad(`path ${p} matches no file git tracks`);
    }

    if (!strings(part.provides) || part.provides.length === 0) bad("provides is not a list of capabilities");
    else for (const c of part.provides) {
      const m = PROVIDED.exec(c);
      if (!m) { bad(`provides ${c}: not <capability>@<major>`); continue; }
      if (caps.has(m[1])) bad(`provides ${m[1]}, which ${caps.get(m[1])} provides too`);
      else caps.set(m[1], part.id);
    }
    if (!Array.isArray(part.requires)) bad("requires is not a list");
    else for (const r of part.requires) {
      if (!isObject(r) || Object.keys(r).sort().join() !== "cap,major" || typeof r.cap !== "string" || !CAP.test(r.cap)
        || !Number.isSafeInteger(r.major) || r.major < 1) bad(`requires ${JSON.stringify(r)}: not { cap, major }`);
    }

    if (!strings(part.os) || part.os.length === 0 || part.os.some((o) => !OSES.includes(o)) || new Set(part.os).size !== part.os.length) {
      bad(`os ${JSON.stringify(part.os)} is not a list of ${OSES.join(", ")}`);
    }
    if (!TARGETS.includes(part.targets)) bad(`targets ${JSON.stringify(part.targets)} is not local or fleet`);
    if (!strings(part.set) || part.set.some((s) => !SETS.includes(s))) bad(`set ${JSON.stringify(part.set)} is not a list of ${SETS.join(", ")}`);
    if (Object.hasOwn(part, "replaces") && (!strings(part.replaces) || part.replaces.some((r) => !ID.test(r)))) bad("replaces is not a list of part ids");

    // The pack's parts: one tarball, each part's folder inside it.
    if (part.artifact !== PACK_ARTIFACT) bad(`artifact ${JSON.stringify(part.artifact)} is not ${PACK_ARTIFACT} (every herdr part ships in the pack)`);
    const selectOk = relative(part.select) && part.select.endsWith("/");
    if (!selectOk) bad(`select ${JSON.stringify(part.select)} is not a folder inside the tarball (relative, ending in /)`);
    else {
      if (repoPathOf(part.select) !== root) bad(`select ${part.select} is ${repoPathOf(part.select)} in the repository, not this part's folder ${root}`);
      const top = part.select.split("/")[0];
      if (top !== "layouts" && !packMods.includes(top)) bad(`select ${part.select} is not in the pack (release.js PACK_MODS, or layouts/)`);
    }

    if (!isObject(part.entry)) bad("entry is not an object");
    else {
      for (const k of Object.keys(part.entry)) if (![...VERBS, "rollback"].includes(k)) bad(`entry.${k} is not install, uninstall, doctor or rollback`);
      for (const verb of [...VERBS, ...(Object.hasOwn(part.entry, "rollback") ? ["rollback"] : [])]) {
        const argv = part.entry[verb];
        if (!strings(argv)) { bad(`entry.${verb} is not an argv array`); continue; }
        if (argv[0].includes("/") || argv[0].includes("\\")) bad(`entry.${verb} runs ${argv[0]}: name a program (node), not a path`);
        const script = argv[1];
        if (!selectOk || typeof script !== "string" || !/\.m?js$/.test(script)) { bad(`entry.${verb} names no script`); continue; }
        const inPack = posix.normalize(posix.join(part.select, script));
        if (inPack.startsWith("../")) { bad(`entry.${verb}'s ${script} is outside the tarball`); continue; }
        if (!tracked.has(repoPathOf(inPack))) bad(`entry.${verb}'s ${script} is ${inPack} in the tarball, ${repoPathOf(inPack)} here, which git does not track`);
        if (inPack === PACK_ENTRY && (argv.length !== 4 || argv[2] !== verb || argv[3] !== part.id)) {
          bad(`entry.${verb} must be ["node", "${script}", "${verb}", "${part.id}"]`);
        }
      }
    }

    if (!strings(part.writes) && !(Array.isArray(part.writes) && part.writes.length === 0)) bad("writes is not a list of paths");
    else for (const w of part.writes) {
      if (!/^(~\/|\*\*\/)/.test(normalWrite(w).path)) bad(`writes ${w}: start it with ~/ (the home), $HERDR_APP_HOME/ (Herdr's app home) or **/ (any project), never a machine's own path`);
      const why = refusedWrite(w);
      if (why) bad(`writes ${w}: ${why}`);
    }
    parts.push({ file, id: part.id });
  }
  // No two parts write one place, unless one replaces the other: every part.json git tracks, not only herdr's.
  const writers = [];
  const provided = new Set();
  for (const file of files.filter((f) => /(^|\/)part\.json$/.test(f) && !f.split("/").includes("node_modules")).sort()) {
    let part;
    try { part = JSON.parse(read(file)); } catch { continue; } // a broken one is its own gate's (herdr's: above)
    if (isObject(part) && Array.isArray(part.provides)) for (const c of part.provides) if (typeof c === "string") provided.add(c);
    if (isObject(part) && typeof part.id === "string" && Array.isArray(part.writes)) {
      writers.push({ file, id: part.id, writes: part.writes.filter((w) => typeof w === "string"), replaces: Array.isArray(part.replaces) ? part.replaces : [] });
    }
  }
  for (let i = 0; i < writers.length; i++) {
    for (let j = i + 1; j < writers.length; j++) {
      const a = writers[i], b = writers[j];
      if (a.id === b.id || a.replaces.includes(b.id) || b.replaces.includes(a.id)) continue;
      for (const wa of a.writes) for (const wb of b.writes) {
        if (writesOverlap(wa, wb)) problems.push(`${a.file}: writes ${wa}, and ${b.id} (${b.file}) writes ${wb}: one place, two parts (one must replace the other)`);
      }
    }
  }
  // Every capability a herdr part requires is provided by some part.json the repository tracks.
  for (const file of manifests) {
    let part;
    try { part = JSON.parse(read(file)); } catch { continue; }
    for (const r of Array.isArray(part?.requires) ? part.requires : []) {
      if (isObject(r) && typeof r.cap === "string" && !provided.has(`${r.cap}@${r.major}`)) problems.push(`${file}: requires ${r.cap}@${r.major}, which no part.json provides`);
    }
  }
  for (const m of packMods) {
    if (!manifests.includes(`herdr/mods/${m}/part.json`)) problems.push(`herdr/mods/${m}: a pack mod with no part.json`);
  }
  for (const f of manifests) if (/(^|\/)pocket-link\//.test(f)) problems.push(`${f}: Pocket Link is Pocket's part, not the pack's`);
  return { parts, problems };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] !== "--check" || process.argv.length !== 3) {
    console.error("usage: node scripts/parts.mjs --check");
    process.exit(2);
  }
  const { PACK_MODS } = await import(new URL("../mods/am-sidebar/release.js", import.meta.url).href);
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: top, encoding: "utf8" }).split("\0").filter(Boolean);
  const { parts, problems } = validateParts({ files, read: (f) => readFileSync(join(top, f), "utf8"), packMods: PACK_MODS });
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`${parts.length} part.json valid: ${parts.map((p) => p.id).join(", ")}`);
}
