// The Claude logins signed in on this Mac, as the Accounts panel sees them (#453,
// docs/local-logins.md): the record `<app home>/claude-logins.json`, which this panel alone
// writes and the bot CLI reads at each Claude launch (am-sidebar/logins.js); what each login says
// it is (`claude auth status`, run with the words a launch would get); what outranks it (section
// 5); and which login a running pane was launched on, by value. Nothing here reads, copies or
// writes a credential: no token is ever seen, and `claude auth status`'s output is read for four
// fields and dropped. Pure: `exec`, `readTextFile` and `writeTextFile` are passed in, so `node
// --test` runs it. The record's rules mirror the CLI's, word for word in what they say, so the
// panel's red line and a launch's warning name the same problem (tested over one corpus).

export const LOGINS_FILE = "claude-logins.json";
export const CONFIG_VAR = "CLAUDE_CONFIG_DIR";
export const DEFAULT_LOGIN = "default";
/** The words a launch on login A gets: the variable unset, never set to ~/.claude. */
export const DEFAULT_WORDS = Object.freeze(["-u", CONFIG_VAR]);
/** Variables that outrank a sign-in when Herdr has them (section 5): their names only, never a value. */
export const CREDENTIAL_VARS = Object.freeze(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]);

/** How long one check (a folder, `claude auth status`, the variables) may take: well under Herdr's 30 s exec cap. */
export const PROBE_MS = 10_000;
const LATE = Object.freeze({ late: true });

const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const shown = (s) => String(s).replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
const trim = (p) => String(p).replace(/\/+$/, "");

export const loginsPath = (appHome) => `${trim(appHome)}/${LOGINS_FILE}`;
/** How the panel names a login: "the default login", "login 2". */
export const loginName = (id) => (id === DEFAULT_LOGIN ? "the default login" : `login ${id}`);
/** The words a launch on login `l` gets ({ id, dir }). */
export const loginWords = (l) => (l.id === DEFAULT_LOGIN ? [...DEFAULT_WORDS] : [`${CONFIG_VAR}=${l.dir}`]);
/** `dir` as a person types it in a terminal: `"$HOME/.claude-2"` under the home folder. */
export const typed = (dir, home) => (dir.startsWith(`${trim(home)}/`) ? `"$HOME/${dir.slice(trim(home).length + 1)}"` : `'${dir.replace(/'/g, "'\\''")}'`);

/** The record's text as { use, logins }, or { problem }: the CLI's parseLogins, same words. */
export function parseLogins(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { problem: "is not valid JSON" }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { problem: "is not a record" };
  const { use, logins } = data;
  if (typeof use !== "string" || !use) return { problem: "has no use" };
  if (!Array.isArray(logins)) return { problem: "has no logins list" };
  const seen = new Set();
  for (const l of logins) {
    if (!l || typeof l !== "object" || !ID_SHAPE.test(l.id ?? "") || l.id === DEFAULT_LOGIN || typeof l.dir !== "string") {
      return { problem: "has a login entry this CLI can't read" };
    }
    if (seen.has(l.id)) return { problem: `lists login ${l.id} twice` };
    seen.add(l.id);
  }
  return { use, logins: logins.map((l) => ({ id: l.id, dir: l.dir })) };
}

/** The form rule's part that needs no file system (the CLI's formProblem, same words). */
export function shapeProblem(dir, home) {
  if (typeof dir !== "string" || !dir) return "has no folder";
  if (!dir.startsWith("/") || dir.includes("~")) return `folder ${shown(dir)} is not an absolute path`;
  if (dir === "/" || dir.endsWith("/") || dir.split("/").slice(1).some((p) => p === "" || p === "." || p === "..")) {
    return `folder ${shown(dir)} is not in the form launches use`;
  }
  if (home && dir === `${trim(home)}/.claude`) return `folder ${shown(dir)} is the default login's own folder`;
  return null;
}

// `sh -c FOLDER_SCRIPT sh <dir>`: the form rule's file-system part, and the two linked files
// (section 4). One word per line: missing, symlink, notdir, or ok after any `unlinked <file>`.
export const FOLDER_SCRIPT = [
  'd=$1',
  '[ -e "$d" ] || { echo missing; exit 0; }',
  '[ -L "$d" ] && { echo symlink; exit 0; }',
  'p=${d%/*}; [ -n "$p" ] || p=/',
  'r=$(cd -- "$p" 2>/dev/null && pwd -P) || { echo missing; exit 0; }',
  '[ "$r" = "$p" ] || { echo symlink; exit 0; }',
  '[ -d "$d" ] || { echo notdir; exit 0; }',
  'for f in settings.json CLAUDE.md; do if [ -e "$d/$f" ] && [ ! -L "$d/$f" ]; then echo "unlinked $f"; fi; done',
  'echo ok',
].join("\n");
const FOLDER_WORDS = { missing: "does not exist", symlink: "goes through a symlink", notdir: "is not a folder" };

// `sh -c AUTH_SCRIPT sh <login words…>`: `claude auth status` when the CLI can't say where a launch
// finds claude (no sidebar mod): this app's PATH and ~/.local/bin. 127: no claude there.
export const AUTH_SCRIPT = 'PATH="$PATH:$HOME/.local/bin"; command -v claude >/dev/null 2>&1 || exit 127; exec /usr/bin/env "$@" claude auth status';
// `sh -c PRESENT_SCRIPT sh <names…>`: the names set in this app's environment, never a value.
export const PRESENT_SCRIPT = 'for n; do printenv -- "$n" >/dev/null && printf "%s\\n" "$n"; done; exit 0';

/** What outranks a sign-in, in plain words, from `authMethod` (anything but claude.ai). */
export function methodLine(method) {
  const m = String(method);
  if (/key/i.test(m)) return "an API key outranks this sign-in";
  if (/token/i.test(m)) return "a token variable outranks this sign-in";
  if (/bedrock|vertex|foundry|third|provider/i.test(m)) return "a third-party provider is set";
  return `another way to sign in (${shown(m).slice(0, 40)}) outranks this sign-in`;
}

/**
 * `exec` bounded by `ms`: Herdr's own `timeout`, and a race whatever Herdr does with it. The
 * answer, LATE when none came in time, or null when exec threw.
 */
export async function bounded(exec, command, args, ms = PROBE_MS) {
  let timer;
  const late = new Promise((go) => { timer = setTimeout(() => go(LATE), ms); });
  try {
    return await Promise.race([Promise.resolve().then(() => exec(command, args, { timeout: ms })).catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What `claude auth status` said, as { state: "in" | "out" | "nobin" | "unread" | "late", email,
 * configDirectory, authMethod }: four fields, the rest of its output dropped and never kept.
 * Signed out only when its JSON says `loggedIn: false`; an exit 1 with no such JSON (a crash, a
 * bad config) is unread, never signed out.
 */
export function readStatus(r) {
  if (r?.late) return { state: "late" };
  if (r?.code === 127) return { state: "nobin" };
  let data = null;
  try { data = JSON.parse(String(r?.stdout ?? "")); } catch {}
  if (!data || typeof data !== "object" || Array.isArray(data)) return { state: "unread" };
  const pick = (k) => (typeof data[k] === "string" && data[k] ? data[k] : null);
  const fields = { email: pick("email"), configDirectory: pick("configDirectory"), authMethod: pick("authMethod") };
  if (data.loggedIn === false && (r.code === 0 || r.code === 1)) return { state: "out", ...fields };
  if (r.code !== 0) return { state: "unread" };
  return { state: "in", ...fields };
}

/**
 * The command that asks `claude auth status` of login `l` as a launch on it would run claude:
 * `where` is the CLI's `launch-path claude` ({ program, path }), so claude is the file a launch
 * runs, with the PATH its pane gets and the login's own words in env's order (options first, an
 * assignment last). Without `where` (no sidebar mod), AUTH_SCRIPT. Null: no claude to run.
 */
export function authCommand(l, where) {
  if (where === undefined || where === null) return ["sh", ["-c", AUTH_SCRIPT, "sh", ...loginWords(l)]];
  if (!where.program) return null;
  const words = l.id === DEFAULT_LOGIN ? [...DEFAULT_WORDS, `PATH=${where.path}`] : [`PATH=${where.path}`, `${CONFIG_VAR}=${l.dir}`];
  return ["/usr/bin/env", [...words, where.program, "auth", "status"]];
}

/** `claude auth status` of login `l` (readStatus's shape), bounded; `where` as authCommand takes it. */
export async function askStatus(l, { exec, where, ms = PROBE_MS }) {
  const cmd = authCommand(l, where);
  return cmd ? readStatus(await bounded(exec, cmd[0], cmd[1], ms)) : { state: "nobin" };
}

/** The one email field of a `.claude.json` (its account record), or null; nothing else is kept. */
export function accountEmail(text) {
  try {
    const e = JSON.parse(String(text ?? ""))?.oauthAccount?.emailAddress;
    return typeof e === "string" && e.includes("@") ? e : null;
  } catch {
    return null;
  }
}

/**
 * The record as the panel reads it: { text: the snapshot a write must replace (null: no file),
 * use, logins, problem: why the CLI can't follow it, or null }. No file is login A, no problem.
 */
export async function readRecord(appHome, readTextFile) {
  let text;
  try { text = await readTextFile(loginsPath(appHome)); } catch (e) {
    return { text: undefined, use: DEFAULT_LOGIN, logins: [], problem: `can't be read (${e?.code ?? "error"})` };
  }
  if (text === null || text === undefined) return { text: null, use: DEFAULT_LOGIN, logins: [], problem: null };
  const r = parseLogins(text);
  if (r.problem) return { text, use: DEFAULT_LOGIN, logins: [], problem: r.problem };
  if (r.use !== DEFAULT_LOGIN && !r.logins.some((l) => l.id === r.use)) {
    return { text, use: r.use, logins: r.logins, problem: `use names ${ID_SHAPE.test(r.use) ? r.use : "a login"} that it doesn't list` };
  }
  return { text, use: r.use, logins: r.logins, problem: null };
}

/**
 * The one write of the record: `{ use, logins }`, through writeTextFile with the snapshot it
 * replaces (Herdr's writer compares, then writes a temp file and renames it into place, RFC
 * 0014), so a launch never reads half a record and an edit made since the read is never lost.
 */
export async function writeRecord(appHome, { use, logins }, before, writeTextFile) {
  const text = `${JSON.stringify({ use, logins: logins.map((l) => ({ id: l.id, dir: l.dir })) }, null, 2)}\n`;
  await writeTextFile(loginsPath(appHome), text, before ?? null);
  return text;
}

/**
 * One login, looked at: { id, dir, problem: its folder's form problem or null, unlinked: the
 * linked files that are files of their own, status (readStatus), email }. `io`: { exec, home,
 * readTextFile, where, ms }. A folder with a problem is never asked about its sign-in. Each
 * check is bounded (PROBE_MS): one that doesn't answer is said, never waited on.
 */
export async function probeLogin(login, { exec, home, readTextFile, where, ms = PROBE_MS }) {
  const out = { id: login.id, dir: login.dir, problem: null, unlinked: [], status: { state: "unread" }, email: null };
  if (login.id !== DEFAULT_LOGIN) {
    const shape = shapeProblem(login.dir, home);
    if (shape) return { ...out, problem: shape };
    const r = await bounded(exec, "sh", ["-c", FOLDER_SCRIPT, "sh", login.dir], ms);
    if (r?.late) return { ...out, problem: `folder ${shown(login.dir)} couldn't be checked in ${ms / 1000} s` };
    const lines = String(r?.stdout ?? "").split("\n").filter(Boolean);
    const last = lines.at(-1);
    if (r?.code !== 0 || !last) return { ...out, problem: `folder ${shown(login.dir)} couldn't be checked` };
    if (FOLDER_WORDS[last]) return { ...out, problem: `folder ${shown(login.dir)} ${FOLDER_WORDS[last]}` };
    out.unlinked = lines.filter((l) => l.startsWith("unlinked ")).map((l) => l.slice(9));
  }
  out.status = await askStatus(login, { exec, where, ms });
  out.email = out.status.email;
  if (!out.email && out.status.state === "in") {
    const file = login.id === DEFAULT_LOGIN ? `${trim(home)}/.claude.json` : `${login.dir}/.claude.json`;
    out.email = accountEmail(await readTextFile(file).catch(() => null));
  }
  return out;
}

/** The credential variables set in this app's environment (names), or null when that can't be read. */
export async function presentVars(exec, ms = PROBE_MS) {
  const r = await bounded(exec, "sh", ["-c", PRESENT_SCRIPT, "sh", ...CREDENTIAL_VARS], ms);
  if (r?.code !== 0) return null;
  return String(r.stdout ?? "").split("\n").filter((n) => CREDENTIAL_VARS.includes(n));
}

/**
 * Whether login `l` may leave the record (#453 section 7), asked at the press: { ok } only when
 * `claude auth status` there says `loggedIn: false`, else { why }. Asked even when its folder is
 * gone (its sign-in can outlive the folder); never for a folder the CLI could not launch with.
 */
export async function signedOut(l, { exec, home, where, ms = PROBE_MS }) {
  const shape = shapeProblem(l.dir, home);
  if (shape) return { why: `its ${shape}: fix ${LOGINS_FILE} by hand` };
  const st = await askStatus(l, { exec, where, ms });
  if (st.state === "out") return { ok: true };
  if (st.state === "in") return { why: `it is still signed in: first, in a terminal, run CLAUDE_CONFIG_DIR=${typed(l.dir, home)} claude auth logout` };
  const said = { late: `claude auth status didn't answer in ${ms / 1000} s`, nobin: "claude isn't found where launches look for it",
    unread: "claude auth status gave no answer the panel can read" }[st.state];
  return { why: `the panel can't tell whether ${loginName(l.id)} is signed out (${said})` };
}

// `sh -c REAL_SCRIPT sh <dir>`: the folder's real path, as the form rule compares it.
export const REAL_SCRIPT = 'cd -- "$1" 2>/dev/null && pwd -P';

/**
 * `on` (paneLogin's answer) with an unknown folder matched by its real path, the way the form
 * rule takes a folder: a pane started by hand through a link maps to its login.
 */
export async function matchReal(on, logins, exec, ms = PROBE_MS) {
  if (!on?.unknown) return on;
  const r = await bounded(exec, "sh", ["-c", REAL_SCRIPT, "sh", on.unknown], ms);
  const real = r?.code === 0 ? String(r.stdout ?? "").trim() : null;
  const l = real ? logins.find((x) => x.dir === real) : null;
  return l ? { id: l.id } : on;
}

/**
 * Which login a pane was launched on, from its launch argv (hc get's `argv`, never the process
 * in front), by value (section 3): { id } for a listed folder or `-u CLAUDE_CONFIG_DIR` (login A),
 * { unknown: dir } for a folder no login lists, { why } when it can't be told. Only env's own
 * options and assignments are read, so a `CLAUDE_CONFIG_DIR=` inside a template's command never
 * counts; an assignment wins over an unset, as env applies them.
 */
export function paneLogin(argv, logins) {
  if (!Array.isArray(argv) || !argv.length || !argv.every((w) => typeof w === "string")) return { why: "hc gave no launch argv" };
  const untracked = { why: "started before logins were tracked" };
  if (argv[0].split("/").pop() !== "env") return untracked;
  let i = 1;
  let unset = false;
  for (; i < argv.length; i += 1) {
    const w = argv[i];
    if (w === "-u" || w === "--unset") { unset ||= argv[i + 1] === CONFIG_VAR; i += 1; } else if (w === `-u${CONFIG_VAR}` || w === `--unset=${CONFIG_VAR}` || w === "-i") unset = true;
    else if (!/^(-u.|--unset=)/.test(w)) break;
  }
  let dir = null;
  for (; i < argv.length && ASSIGN.test(argv[i]); i += 1) if (argv[i].startsWith(`${CONFIG_VAR}=`)) dir = argv[i].slice(CONFIG_VAR.length + 1);
  // As text the form rule would take it: no doubled or trailing slash (a link: matchReal).
  if (dir !== null && dir.startsWith("/")) dir = dir.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
  if (dir !== null) {
    const l = logins.find((x) => x.dir === dir);
    return l ? { id: l.id } : { unknown: dir };
  }
  return unset ? { id: DEFAULT_LOGIN } : untracked;
}

/** The next slot for Add login: the lowest n ≥ 2 whose id and `<home>/.claude-<n>` no login has. */
export function nextSlot(logins, home) {
  for (let n = 2; ; n += 1) {
    const id = String(n), dir = `${trim(home)}/.claude-${n}`;
    if (!logins.some((l) => l.id === id || l.dir === dir)) return { id, dir };
  }
}
