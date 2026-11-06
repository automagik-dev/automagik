// DSH as a Herdr agent: dsh-TUI, pinned, in its own `tui` DSH profile, behind the `dsh-tui` shim
// Herdr's built-in program table starts (#561). Node only, like update.mjs: Herdr never loads
// this file; the CLI and the pack's doctor read it.
//
// What this never does: write the `desktop` profile, DSH's credentials or Desktop's settings;
// ship a key (the BWS launcher stays out of the pack); or pick a model. dsh-TUI's own sign-in
// works (`/model` -> DeepSeek Account, or `/auth`), and a key already in DSH's credential store
// or DEEPSEEK_API_KEY works; this installer writes neither. Sessions go to ~/.dsh; DSH Desktop
// shows them after a quit and reopen, never live.
//
// The pin is exact and carries the registry integrity: dsh's plugin add (`pnpm add --save-exact`)
// writes that version, and the profile's lockfile must record DSH_TUI.integrity. pnpm 11's
// minimumReleaseAge (1440 minutes by default) refuses a version published hours ago, so its
// automatic exclusion must name exactly `@deepseek-harness-tui/dsh-tui@0.19.0`, never the bare
// package. Once the version has aged past the profile's threshold, install/update removes that
// exact entry again; uninstall removes it too.
//
// The shim uses the long `--profile tui` form on purpose: dsh-TUI reads the profile name from the
// app's arguments (`dsh tui` leaves only `tui` there), and the built-in Herdr entry only checks
// that its first word, `dsh-tui`, resolves on PATH.
//
// Apache-2.0.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { removePath } from "./layoutSafe.mjs";

/** The one version this pack installs, and the npm registry's integrity for its tarball. */
export const DSH_TUI = Object.freeze({
  package: "@deepseek-harness-tui/dsh-tui",
  version: "0.19.0",
  integrity: "sha512-4TAPhsTqfL+oG1H39Fbj13tfaVVGnwV9N33dV8Acn/YBoZT/YgXwF+ZnbhvRi0l55bNc6X6loKkngxrNL8NX3w==",
});
/** dsh-TUI's DSH profile. Its own: never the reserved `desktop` profile. */
export const PROFILE = "tui";
/** The command Herdr's built-in `dsh-tui` program entry looks for on PATH (#335). */
export const SHIM = "dsh-tui";
export const PIN = `${DSH_TUI.package}@${DSH_TUI.version}`;
/** pnpm 11's default minimumReleaseAge, in minutes (pnpm.io/11.x/settings). */
export const RELEASE_AGE_MINUTES = 1440;
export const SHIM_MARK = "# Automagik Herdr's dsh-tui shim";
export const SHIM_TEXT = `#!/bin/sh
${SHIM_MARK} (installed by \`automagik-herdr dsh-tui install\`).
# The long --profile form is deliberate: dsh-TUI reads the profile name from the app's arguments.
# \`--\` keeps an app argument that looks like a launcher flag (--resume, --help) away from dsh.
if ! command -v dsh >/dev/null 2>&1; then
  echo "dsh-tui: DSH (dsh) is not on PATH. Install DSH Desktop or 'npm install -g @deepseek-ai/dsh'." >&2
  exit 127
fi
exec dsh --profile tui -- "$@"
`;
/** The ownership record the installer leaves in the tui profile (never pnpm's files). */
export const RECORD_FILE = ".automagik-herdr-dsh-tui.json";
/** The one honest line a machine with no DSH gets, and nothing else. */
export const SKIP = "DSH is not installed (no dsh on PATH): skipped dsh-TUI. Install DSH Desktop or `npm install -g @deepseek-ai/dsh`, then run `automagik-herdr dsh-tui install`.";

const read = (path) => {
  try { return readFileSync(path, "utf8"); } catch (e) { if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null; throw e; }
};
const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, "$2");
const lastLine = (text) => String(text ?? "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
const executable = (path) => {
  try { if (!statSync(path).isFile()) return false; accessSync(path, constants.X_OK); return true; } catch { return false; }
};
/** Whether anything, a dangling link included, is at `path` (readFileSync would call a dangling link absent). */
const present = (path) => {
  try { lstatSync(path); return true; } catch { return false; }
};

/** The person's login shell, or /bin/sh; an absolute, running one only. */
export function loginShellOf(env = process.env) {
  const shell = env.SHELL;
  return typeof shell === "string" && isAbsolute(shell) && executable(shell) ? shell : "/bin/sh";
}
/** The file a person edits to change their PATH, for the shell Herdr panes start in. */
export function shellConfigOf(shell, platform = process.platform) {
  const name = basename(String(shell ?? ""));
  if (name === "zsh") return "~/.zshrc";
  if (name === "fish") return "~/.config/fish/config.fish";
  if (name === "bash") return platform === "darwin" ? "~/.bash_profile" : "~/.bashrc";
  return "~/.profile";
}
/**
 * The PATH Herdr panes actually get: an interactive login shell's, the way herdr-core starts a
 * program (#453's launchPath starts from this CLI's, which is not the pane's). The shell's startup
 * files may print anything, so the answer is read between markers. No answer (too slow, a broken
 * shell): this process's PATH, and `login: false` says so.
 */
export function panePathOf({ env = process.env, timeout = 5000 } = {}) {
  const shell = loginShellOf(env);
  const marker = `__AM_HDR_PATH_${process.pid}_${randomBytes(3).toString("hex")}__`;
  let stdout = "";
  try {
    const r = spawnSync(shell, ["-ilc", `printf '${marker}'; printenv PATH; printf ':${marker}'`],
      { env, timeout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    stdout = r.stdout ?? "";
  } catch { /* no answer */ }
  const start = stdout.lastIndexOf(marker), end = stdout.lastIndexOf(`:${marker}`);
  const path = start >= 0 && end > start ? stdout.slice(start + marker.length, end) : "";
  return { shell, config: shellConfigOf(shell), path: path || String(env.PATH ?? ""), login: Boolean(path) };
}

/** DSH's home: $DSH_HOME, else ~/.dsh (the store DSH Desktop and the CLI share). */
export const dshHomeOf = (env = process.env) => resolve(env.DSH_HOME?.trim() ? env.DSH_HOME.trim() : join(env.HOME || homedir(), ".dsh"));
/** The tui profile: the only profile this installer writes, and never the reserved desktop one. */
export function profileDirOf(dshHome) {
  if (PROFILE === "desktop") throw new Error("refusing to install dsh-TUI into the desktop profile");
  const dir = join(dshHome, "profiles", PROFILE);
  if (dir === join(dshHome, "profiles", "desktop")) throw new Error("refusing to install dsh-TUI into the desktop profile");
  return dir;
}
export const binDirOf = (env = process.env) => join(env.HOME || homedir(), ".local", "bin");
export const shimPathOf = (env = process.env) => join(binDirOf(env), SHIM);

/** `dsh` on PATH, as an absolute file, or null. No program runs (the doctor reads only). */
export function findDsh(env = process.env) {
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, "dsh");
    if (executable(file)) return file;
  }
  return null;
}

/** Whether a file at the shim's path is this installer's, by its marker and its exec line. */
export function shimIsOurs(text) {
  return typeof text === "string" && text.includes(SHIM_MARK) && /^exec dsh --profile tui -- "\$@"$/m.test(text);
}

function writeAtomic(path, text, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, text, { mode });
  renameSync(temp, path);
}

/** JSON at `path`, or null (unreadable or not JSON). */
function json(path) {
  const text = read(path);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * The tui profile's record of the dsh-TUI this installer added, or null (the person's own).
 * Keyed on the package and the version recorded at install time, never the current pin: a
 * record from an older release is still this installer's after a pin bump.
 */
export function ownershipOf(profile) {
  const record = json(join(profile, RECORD_FILE));
  return record?.package === DSH_TUI.package && typeof record.version === "string" && /^\d+\.\d+\.\d+/.test(record.version)
    ? record : null;
}

/** Forget the installer's ownership record in `profile` (the tui profile only). */
function dropRecord(profile) {
  removePath(join(profile, RECORD_FILE), { force: true });
}

/** The exact exclusions in a profile's pnpm-workspace.yaml, read-only. */
export function releaseAgeEntries(text) {
  if (typeof text !== "string") return [];
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^minimumReleaseAgeExclude:/.test(line));
  if (start < 0) return [];
  const inline = /^minimumReleaseAgeExclude:\s*\[(.*)\]\s*$/.exec(lines[start]);
  if (inline) return inline[1].split(",").map((v) => unquote(v)).filter(Boolean);
  const entries = [];
  for (let i = start + 1; i < lines.length; i++) {
    const item = /^\s+-\s+(.*)$/.exec(lines[i]);
    if (!item) { if (/^\s*$/.test(lines[i])) continue; break; }
    entries.push(unquote(item[1]));
  }
  return entries;
}

/** A release-age entry's package name (`@scope/name@1.2.3` and `name` both give the name). */
export function packageOfEntry(entry) {
  const at = String(entry).indexOf("@", 1);
  return at > 0 ? entry.slice(0, at) : entry;
}

/** The profile's minimumReleaseAge in minutes; pnpm 11's default when it sets none. */
export function minimumReleaseAge(text) {
  const m = /^minimumReleaseAge:\s*(\d+)\s*$/m.exec(String(text ?? ""));
  return m ? Number(m[1]) : RELEASE_AGE_MINUTES;
}

/**
 * A pnpm-workspace.yaml whose exclusions for our package are exactly `keep` (an exact version, or
 * [] once it has aged out). Other packages' entries, and everything else in the file, stay.
 */
export function scopeReleaseAge(text, keep) {
  const lines = String(text ?? "").split("\n");
  const start = lines.findIndex((line) => /^minimumReleaseAgeExclude:/.test(line));
  const current = releaseAgeEntries(text);
  const ours = current.filter((entry) => packageOfEntry(entry) === DSH_TUI.package);
  const same = ours.length === keep.length && ours.every((entry, i) => entry === keep[i]);
  if (same) return { text, changed: false };
  if (start < 0) {
    if (keep.length === 0) return { text, changed: false };
    const block = `minimumReleaseAgeExclude:\n${keep.map((entry) => `  - '${entry}'`).join("\n")}`;
    return { text: `${String(text ?? "").replace(/\n?$/, "\n")}${block}\n`, changed: true };
  }
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end]) && lines[end].trim() !== "") end++;
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const kept = current.filter((entry) => packageOfEntry(entry) !== DSH_TUI.package);
  const all = [...kept, ...keep];
  const block = all.length ? ["minimumReleaseAgeExclude:", ...all.map((entry) => `  - '${entry}'`)] : ["minimumReleaseAgeExclude: []"];
  return { text: [...before, ...block, ...after].join("\n"), changed: true };
}

/** The integrity pnpm's lockfile records for `pkg@version`, or null. */
export function lockIntegrity(text, pkg = DSH_TUI.package, version = DSH_TUI.version) {
  const key = `'${pkg}@${version}':`;
  let from = 0;
  while (true) {
    const at = String(text ?? "").indexOf(key, from);
    if (at < 0) return null;
    const block = String(text).slice(at + key.length).split(/\n\s*\n/)[0];
    const m = /resolution: \{integrity: ([^}]+)\}/.exec(block);
    if (m) return m[1].trim();
    from = at + key.length;
  }
}

/** The tui profile's state: what is pinned, recorded and installed. Read-only. */
export function profileState(dshHome) {
  const dir = profileDirOf(dshHome);
  const pkg = json(join(dir, "package.json"));
  const lock = read(join(dir, "pnpm-lock.yaml")) ?? "";
  const installed = json(join(dir, "node_modules", ...DSH_TUI.package.split("/"), "package.json"));
  return {
    dir,
    exists: existsSync(dir),
    pin: typeof pkg?.dependencies?.[DSH_TUI.package] === "string" ? pkg.dependencies[DSH_TUI.package] : null,
    integrity: lockIntegrity(lock),
    installed: typeof installed?.version === "string" ? installed.version : null,
    workspace: read(join(dir, "pnpm-workspace.yaml")),
  };
}

/** The files this installer must leave alone, as path -> a digest (or null when absent). */
const DESKTOP_FILES = Object.freeze([
  ".credentials.yaml",
  "profiles/desktop/package.json",
  "profiles/desktop/cordis.yml",
  "profiles/desktop/cordis.patch.yml",
  "profiles/desktop/pnpm-workspace.yaml",
  "profiles/desktop/pnpm-lock.yaml",
]);
export function desktopFingerprint(dshHome) {
  return Object.fromEntries(DESKTOP_FILES.map((file) => {
    const text = read(join(dshHome, file));
    return [file, text === null ? null : createHash("sha256").update(text).digest("hex")];
  }));
}
const desktopChanged = (before, after) => DESKTOP_FILES.filter((file) => before[file] !== after[file]);

/** A registry publish time for the pin, or null when the registry cannot be read. */
export async function registryPublishedAt({ pkg = DSH_TUI.package, version = DSH_TUI.version, fetch = globalThis.fetch, timeout = 5000 } = {}) {
  if (typeof fetch !== "function") return null;
  const url = `https://registry.npmjs.org/${pkg.replace("/", "%2F").replace("@", "%40")}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const packument = await res.json();
    return typeof packument?.time?.[version] === "string" ? packument.time[version] : null;
  } catch { return null; }
}

/** Runs `dsh args...`: `{ code, stdout, stderr, missing }`, like parts.mjs's runCommand. */
export function runDsh(dsh, args, { env, cwd, timeout = 600_000 } = {}) {
  const r = spawnSync(dsh, args, { cwd, env, timeout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? "", stderr: r.stderr ?? "", missing: r.error?.code === "ENOENT" };
}

const tempCwd = () => mkdtempSync(join(tmpdir(), "am-dsh-tui-"));
const withTemp = (fn) => {
  const cwd = tempCwd();
  try { return fn(cwd); } finally { removePath(cwd, { recursive: true, force: true }); }
};

/** Whether `binDir` is on PATH, for the shim Herdr's built-in entry looks up. */
const onPath = (env, dir) => String(env.PATH ?? "").split(delimiter).includes(dir);

/**
 * `dsh-tui install` (and `update`, which is the same idempotent add): DSH into the tui profile
 * only, the shim, and the guide's one setting. `{ status, changed, lines, detail }`, never throws
 * for a missing DSH; a failed dsh/pnpm step is `status: "failed"`.
 */
export async function installDshTui(options = {}) {
  const { env = process.env, exec = runDsh, now = () => Date.now() } = options;
  const dsh = findDsh(env);
  if (!dsh) return { status: "skipped", changed: false, detail: SKIP, lines: [SKIP] };
  const dshHome = dshHomeOf(env);
  const profile = profileDirOf(dshHome);
  const binDir = binDirOf(env);
  const shim = join(binDir, SHIM);
  const priorShim = read(shim);
  const shimPresent = present(shim);
  if (shimPresent && !shimIsOurs(priorShim)) {
    return { status: "failed", changed: false, detail: `${shim} exists and is not this installer's${priorShim === null ? " (a dangling link or unreadable file)" : ""}: left alone. Remove it, or make it exec dsh --profile tui -- "$@", then run this again.`, lines: [] };
  }
  const before = profileState(dshHome);
  const ownedBefore = ownershipOf(profile);
  const recordBefore = read(join(profile, RECORD_FILE));
  // Ownership is the package and the exact version recorded at install time, never the current
  // pin: a pack-owned 0.18.0 is still the pack's after the constant moves to 0.19.0. A record
  // whose pin has moved is no longer ours and is dropped.
  const staleRecord = ownedBefore !== null && before.pin !== null && before.pin !== ownedBefore.version;
  if (staleRecord) dropRecord(profile);
  const owns = before.pin === null || (ownedBefore !== null && before.pin === ownedBefore.version);
  // A pin this installer did not record is the person's: never run `plugin add` over it (pnpm
  // would rewrite their lockfile). Skip the step and say how to hand it over, even when it is
  // already the pinned version. A stale record was already dropped above.
  if (before.pin !== null && !owns) {
    const same = before.pin === DSH_TUI.version ? "" : `, not ${DSH_TUI.version}`;
    return { status: "skipped", changed: staleRecord, detail: `the ${PROFILE} profile already pins ${DSH_TUI.package} ${before.pin}${same}, which this installer did not add: left it and its lockfile unchanged. To let the pack manage it, remove it first (\`dsh plugin --profile ${PROFILE} remove ${DSH_TUI.package}\`) and run this again.`, lines: [] };
  }
  const desktopBefore = desktopFingerprint(dshHome);
  let result;
  try {
    result = withTemp((cwd) => exec(dsh, ["plugin", "--profile", PROFILE, "add", PIN, "--save-exact"], { cwd, env: { ...env, DSH_HOME: dshHome } }));
  } catch (e) {
    return { status: "failed", changed: false, detail: `dsh plugin --profile ${PROFILE} add ${PIN} could not run: ${e?.message ?? e}`, lines: [] };
  }
  if (result.code !== 0) {
    return { status: "failed", changed: false, detail: `dsh plugin --profile ${PROFILE} add ${PIN} failed: ${lastLine(result.stderr || result.stdout) || `exit ${result.code}`}`, lines: [] };
  }
  const undo = () => {
    try { withTemp((cwd) => exec(dsh, ["plugin", "--profile", PROFILE, "remove", DSH_TUI.package], { cwd, env: { ...env, DSH_HOME: dshHome } })); } catch { /* the report says what is wrong */ }
  };
  const state = profileState(dshHome);
  if (state.pin !== DSH_TUI.version || state.installed !== DSH_TUI.version) {
    undo();
    return { status: "failed", changed: false, detail: `the tui profile did not land on ${PIN}: package.json pins ${state.pin ?? "nothing"} and node_modules has ${state.installed ?? "nothing"}; removed what was added.`, lines: [] };
  }
  if (state.integrity !== DSH_TUI.integrity) {
    undo();
    return { status: "failed", changed: false, detail: `the tui profile's lockfile records ${state.integrity ?? "no integrity"} for ${PIN}, not the pinned ${DSH_TUI.integrity}; removed what was added.`, lines: [] };
  }
  const changedDesktop = desktopChanged(desktopBefore, desktopFingerprint(dshHome));
  if (changedDesktop.length) {
    return { status: "failed", changed: false, detail: `the install changed ${changedDesktop.join(", ")} under ${dshHome}; this installer never writes the desktop profile, its settings or DSH's credentials, so check them.`, lines: [] };
  }

  // The record follows the version this install set, so a later uninstall still knows it is ours.
  const recordText = `${JSON.stringify({ package: DSH_TUI.package, version: DSH_TUI.version, integrity: DSH_TUI.integrity }, null, 2)}\n`;
  const recordChanged = owns && recordBefore !== recordText;
  if (recordChanged) writeAtomic(join(profile, RECORD_FILE), recordText, 0o600);
  let workspace = state.workspace ?? "";
  const published = "publishedAt" in options ? options.publishedAt : await registryPublishedAt();
  const aged = typeof published === "string" && Number.isFinite(Date.parse(published))
    && (now() - Date.parse(published)) / 60000 >= minimumReleaseAge(workspace);
  const kept = aged ? [] : [PIN];
  const had = releaseAgeEntries(workspace).filter((entry) => packageOfEntry(entry) === DSH_TUI.package);
  const scoped = owns ? scopeReleaseAge(workspace, kept) : { text: workspace, changed: false };
  if (scoped.changed) {
    writeAtomic(join(profile, "pnpm-workspace.yaml"), scoped.text, 0o644);
    workspace = scoped.text;
  }

  // dsh-TUI's own first-run guide state: mark it done only when it has none. /setup still opens it.
  const guide = join(env.HOME || homedir(), ".dsh-tui", "onboarding.json");
  const guideBefore = read(guide);
  if (guideBefore === null) writeAtomic(guide, `${JSON.stringify({ completed: true, version: 1 }, null, 2)}\n`, 0o600);

  if (priorShim !== SHIM_TEXT) writeAtomic(shim, SHIM_TEXT, 0o755);

  const lines = [
    before.pin === DSH_TUI.version && before.integrity === DSH_TUI.integrity
      ? `dsh-TUI ${DSH_TUI.version} is already installed in the ${PROFILE} profile (${profile}).`
      : `DSH at ${dsh}: installed dsh-TUI ${DSH_TUI.version} in the ${PROFILE} profile (${profile}).`,
    `The ${SHIM} shim is at ${shim}${onPath(env, binDir) ? "" : `; add ${binDir} to PATH so Herdr's built-in menu entry finds it`}.`,
    guideBefore === null ? "Marked dsh-TUI's first-run guide done (open it later with /setup)." : "Kept dsh-TUI's first-run guide state.",
    "Sign in inside dsh-TUI with /model (DeepSeek Account) or /auth; a key already in DSH's credential store or DEEPSEEK_API_KEY works too. No key is stored by this installer.",
    `Sessions go to ${dshHome}; DSH Desktop shows them after you quit and reopen it (no live refresh).`,
    "The desktop profile, its settings and DSH's credentials are untouched.",
  ];
  if (had.length && !aged && owns) lines.splice(2, 0, `The ${PROFILE} profile excludes ${PIN} from pnpm's release-age gate (exact version only).`);
  if (aged && had.includes(PIN) && owns) lines.splice(2, 0, `Removed the release-age exception for ${PIN}: it is older than the profile's minimumReleaseAge now.`);
  return { status: "installed", changed: before.pin !== DSH_TUI.version || before.integrity !== DSH_TUI.integrity || priorShim !== SHIM_TEXT || scoped.changed || guideBefore === null || recordChanged || staleRecord, lines, detail: lines[0] };
}

/**
 * `dsh-tui uninstall`: the plugin out of the tui profile, the exact release-age entry, and the
 * shim (only when it is ours). Sessions, dsh-TUI's own state and the profile stay.
 */
export function uninstallDshTui(options = {}) {
  const { env = process.env, exec = runDsh } = options;
  const dsh = findDsh(env);
  const dshHome = dshHomeOf(env);
  const profile = profileDirOf(dshHome);
  const state = profileState(dshHome);
  const shim = shimPathOf(env);
  const shimPresent = present(shim);
  const shimText = read(shim);
  const record = ownershipOf(profile);
  const owns = record !== null && state.pin === record.version;
  const lines = [];
  let failed = false;
  let changed = false;
  const desktopBefore = desktopFingerprint(dshHome);

  if (state.pin === null && !shimPresent) {
    if (record) { dropRecord(profile); changed = true; }
    return { status: "absent", changed, detail: "dsh-TUI is not installed; nothing to remove.", lines: ["dsh-TUI is not installed; nothing to remove."] };
  }
  if (state.pin !== null) {
    if (!owns) {
      lines.push(`Left ${DSH_TUI.package} in the ${PROFILE} profile (${state.pin}): this installer did not add it.`);
      if (record) { dropRecord(profile); changed = true; }
    } else if (!dsh) {
      failed = true;
      lines.push(`dsh is not on PATH, so ${DSH_TUI.package} could not be removed from the ${PROFILE} profile; install DSH and run this again.`);
    } else {
      let result;
      try {
        result = withTemp((cwd) => exec(dsh, ["plugin", "--profile", PROFILE, "remove", DSH_TUI.package], { cwd, env: { ...env, DSH_HOME: dshHome } }));
      } catch (e) {
        result = { code: 1, stdout: "", stderr: e?.message ?? String(e) };
      }
      if (result.code !== 0) {
        failed = true;
        lines.push(`dsh plugin --profile ${PROFILE} remove ${DSH_TUI.package} failed: ${lastLine(result.stderr || result.stdout) || `exit ${result.code}`}`);
      } else {
        lines.push(`Removed ${DSH_TUI.package} from the ${PROFILE} profile.`);
        changed = true;
        dropRecord(profile);
      }
    }
  } else {
    lines.push(`The ${PROFILE} profile does not have ${DSH_TUI.package}.`);
    if (record) { dropRecord(profile); changed = true; }
  }

  // The release-age entry is ours only when the pin was: a person's own install keeps its entry.
  if (owns) {
    const workspace = read(join(profile, "pnpm-workspace.yaml"));
    if (workspace !== null) {
      const ours = releaseAgeEntries(workspace).filter((entry) => packageOfEntry(entry) === DSH_TUI.package);
      if (ours.length) {
        const scoped = scopeReleaseAge(workspace, []);
        if (scoped.changed) {
          writeAtomic(join(profile, "pnpm-workspace.yaml"), scoped.text, 0o644);
          changed = true;
          lines.push(`Removed the ${PROFILE} profile's release-age exception for ${DSH_TUI.package}.`);
        }
      }
    }
  }

  if (!shimPresent) lines.push(`No ${SHIM} shim at ${shim}.`);
  else if (shimText === null) lines.push(`Left ${shim}: it exists but is unreadable (a dangling link or a file this user cannot read).`);
  else if (!shimIsOurs(shimText)) lines.push(`Left ${shim}: it is not this installer's.`);
  else {
    removePath(shim, { force: true });
    changed = true;
    lines.push(`Removed the ${SHIM} shim (${shim}).`);
  }

  const changedDesktop = desktopChanged(desktopBefore, desktopFingerprint(dshHome));
  if (changedDesktop.length) {
    failed = true;
    lines.push(`The uninstall changed ${changedDesktop.join(", ")} under ${dshHome}; this installer never writes the desktop profile, its settings or DSH's credentials, so check them.`);
  }
  lines.push(`Kept: DSH sessions (${dshHome}), dsh-TUI's own state (~/.dsh-tui) and the tui profile.`);
  return { status: failed ? "failed" : changed ? "removed" : "absent", changed, detail: lines[0], lines };
}

/**
 * `dsh-tui doctor`: whether dsh, the tui profile and the shim exist, and whether the profile is
 * the pinned one. Read-only. `{ code, checks }`: 0 healthy or installed, 1 broken, 2 not
 * installed or no dsh (not applicable).
 */
export function doctorDshTui({ env = process.env, panePath } = {}) {
  const checks = [];
  const add = (check, ok, detail, fix = null) => checks.push({ check, ok, detail, fix: ok ? null : fix });
  const shell = loginShellOf(env);
  const pane = panePath ? { shell, config: shellConfigOf(shell), login: true, ...panePath } : panePathOf({ env });
  const dsh = findDsh({ ...env, PATH: pane.path });
  const dshHome = dshHomeOf(env);
  const state = profileState(dshHome);
  const record = ownershipOf(state.dir);
  const owned = record !== null && state.pin === record.version;
  const shim = shimPathOf(env);
  const shimPresent = present(shim);
  const shimText = read(shim);
  const ours = shimText !== null && shimIsOurs(shimText);
  const pinned = state.pin === DSH_TUI.version && state.integrity === DSH_TUI.integrity && state.installed === DSH_TUI.version;
  const installed = state.pin !== null || shimPresent;
  const installLine = "automagik-herdr dsh-tui install";

  const processDsh = dsh ?? findDsh(env);
  add("dsh", Boolean(dsh) || !installed,
    dsh ? dsh
      : processDsh ? `${processDsh} is on this process's PATH, not on the PATH Herdr panes get (${pane.login ? `login shell ${pane.shell}` : "no login shell answer"}); add ${dirname(processDsh)} to ${pane.config}`
        : `not found on the PATH Herdr panes get (${pane.login ? `login shell ${pane.shell}` : "no login shell answer; this process's PATH"}): dsh-TUI is skipped`,
    processDsh && !dsh ? `echo 'export PATH="${dirname(processDsh)}:$PATH"' >> ${pane.config}` : "install DSH Desktop or `npm install -g @deepseek-ai/dsh`");

  if (!state.exists) add("dsh-tui-profile", !ours, `not installed: ${state.dir} is missing`, installLine);
  else if (state.pin === null) add("dsh-tui-profile", !ours, `not installed: ${state.dir}/package.json does not list ${DSH_TUI.package}`, installLine);
  else if (state.pin !== DSH_TUI.version || state.installed !== DSH_TUI.version) add("dsh-tui-profile", false, `${state.dir} pins ${state.pin}, but node_modules has ${state.installed ?? "nothing"}; the pin is ${DSH_TUI.version}`, installLine);
  else if (state.integrity !== DSH_TUI.integrity) add("dsh-tui-profile", false, `${state.dir}'s lockfile records ${state.integrity ?? "no integrity"}, not the pinned ${DSH_TUI.integrity}`, installLine);
  else add("dsh-tui-profile", true, `${state.dir}: ${PIN}, integrity ok${owned ? " (added by this installer)" : " (not added by this installer; uninstall leaves it)"}`);

  if (!shimPresent) add("dsh-tui-shim", state.pin === null, `not installed: ${shim} is missing`, installLine);
  else if (shimText === null) add("dsh-tui-shim", false, `${shim} exists but is unreadable (a dangling link?)`, `rm ${shim} && ${installLine}`);
  else if (!ours) add("dsh-tui-shim", false, `${shim} exists and is not this installer's`, `rm ${shim} && ${installLine}`);
  else if (!executable(shim)) add("dsh-tui-shim", false, `${shim} is not executable`, `chmod 755 ${shim}`);
  else add("dsh-tui-shim", true, `${shim} (exec dsh --profile tui -- "$@")`);

  const binDir = binDirOf(env);
  const onPanePath = String(pane.path ?? "").split(delimiter).includes(binDir);
  // A PATH that lacks ~/.local/bin is a note while nothing is installed (the opt-in was not
  // taken), not a broken install: exit 2, never 1. Installed, it is a real break.
  checks.push({
    check: "dsh-tui-path",
    ok: onPanePath || !installed,
    detail: `${binDir} is ${onPanePath ? "" : "not "}on the PATH Herdr panes get (${pane.login ? `login shell ${pane.shell}` : "this process; no login shell answer"})${onPanePath ? "" : "; Herdr's + menu checks its own PATH too, so restart Herdr after adding it"}`,
    fix: onPanePath ? null : `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${pane.config}`,
  });

  const guide = read(join(env.HOME || homedir(), ".dsh-tui", "onboarding.json"));
  add("dsh-tui-guide", true, guide === null ? "not marked: the first-run guide opens once (/setup opens it later)" : "marked done");

  const broken = checks.some((check) => !check.ok);
  const healthy = pinned && ours;
  return { code: broken ? 1 : healthy ? 0 : 2, checks };
}

/** The three presences `am doctor herdr.pack` reports, without running anything. */
export function dshTuiPresence({ env = process.env } = {}) {
  const dshHome = dshHomeOf(env);
  const state = profileState(dshHome);
  const record = ownershipOf(state.dir);
  const owned = record !== null && state.pin === record.version;
  const shim = shimPathOf(env);
  const shimText = read(shim);
  return {
    dsh: findDsh(env),
    profile: state.pin !== null,
    profileDir: state.dir,
    pinned: state.pin === DSH_TUI.version && state.integrity === DSH_TUI.integrity && state.installed === DSH_TUI.version,
    owned,
    shim,
    shimExists: present(shim),
    shimOurs: shimText !== null && shimIsOurs(shimText),
    guide: existsSync(join(env.HOME || homedir(), ".dsh-tui", "onboarding.json")),
  };
}
