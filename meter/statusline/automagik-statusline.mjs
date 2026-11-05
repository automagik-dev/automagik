#!/usr/bin/env node
// Automagik Meter's Claude Code status line. Claude Code pipes a JSON status object to its
// statusline command on every turn; this prints one line from it (two when the terminal is too
// narrow for one: the quota moves to the second):
//
//   🤖 Meter Captain  🧠 Opus 5.5 ⚡high  ┃  📁 my-app  ┃  💬 Context ▰▰▰▰▱▱▱▱▱▱ 400k/1M  ┃
//   Quota 5h ▰▱▱▱▱ 24%  Resets 2h14m  ┃  Quota 7d ▰▰▰▱▱ 58%  Left 1d2h  Resets 4d2h
//
// - 🤖: the bot this Herdr pane plays (HC_TERMINAL_ID set): `automagik-herdr whois --json`, run
//   by its absolute path (~/.local/bin/automagik-herdr, a sh launcher that finds its own node),
//   then the name in <project>/.herdr/bots.json. Cached 10 minutes per terminal in the Meter
//   state folder (statusline-bots.json), a miss included, every live pane kept; whois gets 1.5 s,
//   then SIGKILL. No pane, no bot.
// - ⚡: effort.level from stdin. Claude Code sends none when the model has no effort setting.
// - Context: a 10-cell bar of the context window used, then the tokens used and the window. Its
//   colour is measured against the auto-compact window, found the way Claude Code finds it
//   (code.claude.com/docs/en/model-config, "Set the auto-compact window"): none when
//   DISABLE_AUTO_COMPACT or DISABLE_COMPACT is set or autoCompactEnabled is false; else
//   CLAUDE_CODE_AUTO_COMPACT_WINDOW when it is a usable size (200000, 200k, 1M; held to
//   100k-1M); else the first of .claude/settings.local.json, .claude/settings.json and the user
//   settings.json that names a window: modelSettings["<model id>"].autoCompactWindow, or the
//   top-level autoCompactWindow, the model's entry winning within one file. The local file is
//   read where Claude Code keeps it (code.claude.com/docs/en/settings, "Where Claude Code keeps
//   the local file in a git repository"): at the repository root, the main checkout's root in a
//   worktree, then one an older version left in the launch folder; the shared file in the launch
//   folder (workspace.project_dir). "auto" (the model's tuned window) or no window anywhere: the
//   colour is measured against the context window instead; no default is guessed. The window is
//   capped at the context window, as Claude Code caps it. A one-launch --autocompact flag and
//   managed settings are not visible to a status line.
// - Quota 5h / 7d: a 5-cell bar and the used % of each rate_limits window, the time until it
//   resets, and before that, in red, "Left": when the window runs out at the current rate, shown
//   only when that comes before the reset. The rate is the rise over the last hour (5h) or six
//   hours (7d) in the limits logger's log (claude-limits.jsonl, its last 256 KiB only, readings
//   of the same window), the used % at a time being the highest reading up to it (a resumed
//   session logs a stale lower one), over the time the readings cover (idle gaps over 15 minutes
//   left out); with no reading in the lookback, the used % over the time since the window started.
// - Green under 70%, yellow from 70%, red from 90%. NO_COLOR turns the colours off.
//
// Node, no dependencies, never throws: a field it cannot read drops its segment. Run it with
// node's absolute path (Claude Code's PATH can be bare). It wraps cleanly in the limits logger:
// `node claude-limits-statusline.mjs -- node automagik-statusline.mjs`. METER_STATE_DIR moves
// the state folder (the logger's too).
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, lstatSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RED = "\x1b[31m", CYAN = "\x1b[36m", BOLD = "\x1b[1m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const BOTS_KEEP = 512;
const SETTLE = 300, GAP = 900, MIN_COVERED = 900;
const TAIL = 256 << 10;
const BOT_TTL = 10 * 60 * 1000;
export const WHOIS_TIMEOUT = 1500;
// Each quota window: its length and how far back the log's rate looks (seconds).
const WINDOWS = { five_hour: { label: "Quota 5h", span: 5 * 3600, look: 3600 }, seven_day: { label: "Quota 7d", span: 7 * 86400, look: 6 * 3600 } };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
/** A string from stdin or a file, safe to print: control characters (escapes, newlines) removed. */
const clean = (v) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim() : "");

/** 0 → "0", 78400 → "78k", 1000000 → "1M", 1250000 → "1.3M". */
export function tokens(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  const m = Math.round(n / 100_000) / 10;
  return `${m}M`;
}

/** Seconds as "45m", "2h10m" or "3d4h"; null once it has passed. */
export function until(seconds) {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.ceil(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

/** A bar of `cells` cells, `pct` of them filled: bar(40, 10) → "▰▰▰▰▱▱▱▱▱▱". */
export function bar(pct, cells) {
  const fill = Math.max(0, Math.min(cells, Math.round(((num(pct) ?? 0) / 100) * cells)));
  return "▰".repeat(fill) + "▱".repeat(cells - fill);
}

/**
 * Seconds until a quota window runs out at the current rate, or null when it does not run out
 * before it resets. `key` is five_hour or seven_day, `w` its stdin reading, `now` in ms, `rows`
 * the limits log's readings.
 *
 * The log is no single series: each session logs the reading it last saw, so a resumed session
 * logs its value from before the resume (lower than the truth, with a fresh ts) until its first
 * reply, and sessions side by side alternate between neighbouring values. Used % never falls
 * within a window, so the used % at a time is the highest reading of this same window (same
 * resets_at) up to it, the stdin reading at `now` included, and a stale low reading changes
 * nothing.
 *
 * The rate is the rise over the time the log covers in the lookback (1 h for 5h, 6 h for 7d):
 * only the spans between consecutive readings at most 15 minutes apart (the logger writes at least
 * every 5 minutes while a session runs). A longer span is idle time, and counts neither its time
 * nor any rise across it. The first 5 minutes after each idle span are left out as well: a resumed
 * session's stale first reading lands there. Under 15 minutes or a quarter of the lookback covered
 * (15 minutes for 5h, 90 for 7d) measures too little (one 1% step of a whole-number reading would
 * read as a run), so there is no Left; a measured rise of nothing means no run-out. With no
 * reading of the window in the lookback at all, the rate is the used % over the time since the
 * window started (once it is 10 minutes old).
 */
export function runOut(key, w, now, rows) {
  const spec = WINDOWS[key];
  const used = num(w?.used_percentage), reset = num(w?.resets_at), t = num(now) / 1000;
  if (!spec || used == null || reset == null || !(reset > t)) return null;
  const pts = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = r?.[key], ts = typeof r?.ts === "string" ? Date.parse(r.ts) / 1000 : NaN;
    if (isObject(x) && num(x.used_percentage) != null && x.resets_at === reset && ts <= t) pts.push([ts, x.used_percentage]);
  }
  pts.sort((p, q) => p[0] - q[0]);
  const edge = t - spec.look;
  const logged = pts.some(([ts]) => ts > edge);
  pts.push([t, used]);
  let high = -Infinity;
  const env = pts.map(([ts, v]) => [ts, (high = Math.max(high, v))]);
  const current = high;
  if (current >= 100) return null;
  let rate = null; // % per second
  if (logged) {
    let covered = 0, rise = 0, runStart = env[0][0];
    for (let i = 1; i < env.length; i++) {
      const [a, va] = env[i - 1], [b, vb] = env[i];
      if (b - a > GAP) { runStart = b; continue; }
      if (b <= edge || a < runStart + SETTLE) continue;
      covered += b - a;
      rise += vb - va;
    }
    if (covered < Math.max(MIN_COVERED, spec.look / 4)) return null;
    rate = rise / covered;
  } else {
    const elapsed = t - (reset - spec.span);
    if (elapsed > 600 && current > 0) rate = current / elapsed;
  }
  if (!(rate > 0)) return null;
  const left = (100 - current) / rate;
  return left < reset - t ? left : null;
}

/**
 * The status line for one stdin object. Pure: `now` (ms), the auto-compact window, the bot's
 * name, the limits log's readings and the terminal width come in through `opts`, so a fixture
 * gives the same line every time.
 */
export function format(input, opts = {}) {
  const { now = Date.now(), autoCompactWindow = null, bot = null, limits = null, columns = null, color = true } = opts;
  const paint = (code, text) => (color && code ? `${code}${text}${RESET}` : text);
  const dim = (text) => paint(DIM, text);
  const level = (pct) => (pct == null ? null : pct >= 90 ? RED : pct >= 70 ? YELLOW : GREEN);
  const i = isObject(input) ? input : {};
  const groups = [];

  const who = [];
  const name = clean(bot);
  if (name) who.push(`🤖 ${paint(CYAN + BOLD, name)}`);
  const model = clean(i.model?.display_name) || clean(i.model?.id);
  const effort = clean(i.effort?.level);
  const brain = [model && `🧠 ${paint(BOLD, model)}`, effort && `⚡${effort}`].filter(Boolean).join(" ");
  if (brain) who.push(brain);
  if (who.length) groups.push(who.join("  "));

  const dir = clean(i.workspace?.current_dir) || clean(i.cwd);
  if (dir) groups.push(`📁 ${basename(dir) || dir}`);

  const cw = isObject(i.context_window) ? i.context_window : {};
  const size = num(cw.context_window_size);
  let used = num(cw.total_input_tokens);
  if (used == null && isObject(cw.current_usage)) {
    const u = cw.current_usage;
    used = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
  }
  let pct = num(cw.used_percentage);
  if (used == null && pct != null && size) used = (pct / 100) * size;
  if (used != null && size) pct = (used / size) * 100;
  if (pct != null) {
    // The bar fills against the context window; its colour is measured against the compact window.
    const window = num(autoCompactWindow);
    const tint = level(window && used != null ? (used / window) * 100 : pct);
    const count = used == null ? `${Math.round(pct)}%` : paint(tint, tokens(used)) + (size ? dim(`/${tokens(size)}`) : "");
    groups.push(`💬 ${dim("Context")} ${paint(tint, bar(pct, 10))} ${count}`);
  }

  const quota = [];
  for (const [key, spec] of Object.entries(WINDOWS)) {
    const w = i.rate_limits?.[key];
    const p = num(w?.used_percentage);
    if (p == null) continue;
    const reset = num(w.resets_at) != null ? until(w.resets_at - now / 1000) : null;
    const left = runOut(key, w, now, limits);
    quota.push(`${dim(spec.label)} ${paint(level(p), bar(p, 5))} ${paint(level(p), `${Math.round(p)}%`)}`
      + (left != null ? `  ${dim("Left")} ${paint(RED, until(left))}` : "")
      + (reset ? `  ${dim("Resets")} ${reset}` : ""));
  }

  const sep = dim("  ┃  ");
  const one = [...groups, ...quota].join(sep);
  if (!columns || visible(one) <= columns - 2 || !quota.length || !groups.length) return one;
  return `${groups.join(sep)}\n${quota.join(sep)}`;
}

// Columns a line takes: colours take none; the emoji take two each.
const visible = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].reduce((n, c) => n + (/\p{Extended_Pictographic}/u.test(c) ? 2 : 1), 0);

/** Where Meter keeps its state; the limits logger uses the same folder. */
export function stateDir(env = process.env) {
  if (env.METER_STATE_DIR) return env.METER_STATE_DIR;
  const home = homedir();
  return platform() === "darwin" ? join(home, "Library/Application Support/automagik")
    : join(env.XDG_STATE_HOME || join(home, ".local/state"), "automagik");
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

const MIN_WINDOW = 100_000, MAX_WINDOW = 1_000_000;
const flag = (v) => typeof v === "string" && v.trim() !== "" && !/^(0|false|no|off)$/i.test(v.trim());

/**
 * A CLAUDE_CODE_AUTO_COMPACT_WINDOW value in tokens: a count ("200000") or with k or M ("200k",
 * "1M"), held to 100k-1M as Claude Code holds it; null when it is no usable size, which Claude
 * Code ignores (the settings decide then).
 */
export function envWindow(value) {
  const m = typeof value === "string" ? /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(value) : null;
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "" ? 1 : /k/i.test(m[2]) ? 1e3 : 1e6);
  return n > 0 ? Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.round(n))) : null;
}

/**
 * The folder whose .claude/settings.local.json Claude Code reads for a session launched in
 * `start`, or null when the file stays in `start`. Per code.claude.com/docs/en/settings: the
 * repository root, and in a linked worktree the main checkout's root (its .git file names a
 * gitdir whose commondir is the main .git); the file stays in `start` outside a git repository,
 * on Windows, when the root is the home folder, or when the root, its .git or its .claude is not
 * the user's. Reads the files git keeps, never runs git. Never throws.
 */
export function localSettingsRoot(start, { home = homedir(), os = platform(), uid = typeof process.getuid === "function" ? process.getuid() : null } = {}) {
  try {
    if (typeof start !== "string" || !start || os === "win32") return null;
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      const git = join(dir, ".git");
      let entry = null;
      try { entry = statSync(git); } catch { /* not here: look one folder up */ }
      if (entry) {
        let root = dir;
        if (entry.isFile()) {
          const m = /^gitdir:[ \t]*(.+?)\s*$/m.exec(readFileSync(git, "utf8"));
          if (!m) return null;
          const gitdir = resolve(dir, m[1]);
          let common = null;
          try { common = resolve(gitdir, readFileSync(join(gitdir, "commondir"), "utf8").trim()); } catch { /* a submodule: its own root */ }
          if (common) {
            if (basename(common) !== ".git") return null; // a bare repository has no checkout to hold it
            root = dirname(common);
          }
        }
        if (root === resolve(home)) return null;
        if (uid != null) {
          if (statSync(root).uid !== uid || lstatSync(join(root, ".git")).uid !== uid) return null;
          let claude = null;
          try { claude = lstatSync(join(root, ".claude")); } catch { /* no .claude yet */ }
          if (claude && claude.uid !== uid) return null;
        }
        return root;
      }
      if (dirname(dir) === dir) return null;
    }
  } catch { return null; }
}

/**
 * The auto-compact window this session runs at, in tokens, or null when auto-compact is off or
 * the window is Claude Code's own ("auto", or none set). Sources and order: the file header.
 */
export function autoCompactWindowFor(input, env = process.env) {
  if (flag(env.DISABLE_AUTO_COMPACT) || flag(env.DISABLE_COMPACT)) return null;
  const config = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const project = input?.workspace?.project_dir;
  const files = [];
  if (typeof project === "string" && project) {
    const root = localSettingsRoot(project);
    if (root) files.push(join(root, ".claude/settings.local.json"));
    const here = join(resolve(project), ".claude/settings.local.json");
    if (!files.includes(here)) files.push(here); // where a version before 2.1.211 kept it
    files.push(join(project, ".claude/settings.json"));
  }
  files.push(join(config, "settings.json"));
  const settings = files.map(readJson).filter(isObject);
  const enabled = settings.find((s) => typeof s.autoCompactEnabled === "boolean")?.autoCompactEnabled ?? true;
  if (!enabled) return null;
  let window = envWindow(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (window == null) {
    const id = typeof input?.model?.id === "string" ? input.model.id : "";
    for (const s of settings) {
      const models = isObject(s.modelSettings) ? s.modelSettings : {};
      const entry = id ? (models[id] ?? models[id.replace(/\[.*\]$/, "")]) : undefined;
      const value = isObject(entry) && entry.autoCompactWindow !== undefined ? entry.autoCompactWindow : s.autoCompactWindow;
      if (value === undefined) continue;
      window = num(value) > 0 ? value : null; // "auto" or no number: the model's tuned window, not known here
      break;
    }
  }
  const size = num(input?.context_window?.context_window_size);
  return window && size ? Math.min(window, size) : window;
}


/**
 * The limits logger's readings from the last 256 KiB of claude-limits.jsonl in `dir` (a line cut
 * at the start of the tail is skipped), or [] when there is no log. Never throws.
 */
export function readLimitsTail(dir = stateDir()) {
  let fd;
  try { fd = openSync(join(dir, "claude-limits.jsonl"), "r"); } catch { return []; }
  try {
    const size = fstatSync(fd).size, n = Math.min(size, TAIL);
    const buf = Buffer.alloc(n);
    let got = 0;
    while (got < n) {
      const r = readSync(fd, buf, got, n - got, size - n + got);
      if (r <= 0) break;
      got += r;
    }
    const lines = buf.subarray(0, got).toString("utf8").split("\n");
    if (size > n) lines.shift();
    const rows = [];
    for (const line of lines) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (isObject(r)) rows.push(r); } catch { /* a bad line */ }
    }
    return rows;
  } catch { return []; } finally { try { closeSync(fd); } catch { /* closed */ } }
}

/**
 * The name of the bot this Herdr pane plays, or null outside a pane (no HC_TERMINAL_ID) or when
 * it plays none. Asks `automagik-herdr whois --json <terminal>` (the launcher at its absolute
 * path, run with /bin/sh, killed with SIGKILL after `timeout` ms), then reads the name from
 * <project>/.herdr/bots.json. The answer, a miss or a failure included, is cached for 10 minutes
 * per terminal in statusline-bots.json; only expired entries are dropped (and, past 512 live
 * terminals, the oldest), so every live pane keeps its entry. Never throws.
 */
export function botName(env = process.env, { dir = stateDir(env), home = homedir(), launcher = join(home, ".local/bin/automagik-herdr"), now = Date.now(), timeout = WHOIS_TIMEOUT } = {}) {
  try {
    const terminal = clean(env.HC_TERMINAL_ID);
    if (!terminal) return null;
    const key = `${env.HC_TERMINAL_SOCKET ?? ""}#${terminal}`;
    const cacheFile = join(dir, "statusline-bots.json");
    const cache = readJson(cacheFile);
    const entries = isObject(cache) ? cache : {};
    const hit = entries[key];
    if (isObject(hit) && num(hit.at) != null && hit.at <= now && now - hit.at < BOT_TTL) return clean(hit.name) || null;
    let name = "";
    try {
      if (existsSync(launcher)) {
        const out = execFileSync("/bin/sh", [launcher, "whois", "--json", terminal], {
          encoding: "utf8", timeout, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "ignore"],
          env: { ...env, PATH: [join(home, ".local/bin"), env.PATH, "/usr/bin:/bin"].filter(Boolean).join(":") },
        });
        const who = JSON.parse(out);
        if (isObject(who) && typeof who.bot === "string" && typeof who.project === "string" && who.project.startsWith("/")) {
          const bots = readJson(join(who.project, ".herdr/bots.json"))?.bots;
          const found = Array.isArray(bots) ? bots.find((b) => isObject(b) && b.id === who.bot) : null;
          name = clean(found?.name);
        }
      }
    } catch { /* no answer: cached as none */ }
    entries[key] = { name, at: now };
    const live = Object.entries(entries).filter(([, e]) => isObject(e) && num(e.at) != null && e.at <= now && now - e.at < BOT_TTL);
    save(cacheFile, dir, Object.fromEntries(live.sort(([, a], [, b]) => b.at - a.at).slice(0, BOTS_KEEP)));
    return name || null;
  } catch { return null; }
}

function save(cacheFile, dir, entries) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 });
    renameSync(tmp, cacheFile);
  } catch { /* asked again next turn */ }
}

function main() {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("error", () => {});
  process.stdin.on("end", () => {
    let line = "";
    try {
      let input = null;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* print what there is */ }
      const safe = (f) => { try { return f(); } catch { return null; } };
      const quota = isObject(input?.rate_limits) && Object.keys(WINDOWS).some((k) => isObject(input.rate_limits[k]));
      line = format(input, {
        autoCompactWindow: safe(() => autoCompactWindowFor(input)),
        bot: safe(() => botName()),
        limits: quota ? safe(() => readLimitsTail()) : null,
        columns: Number(process.env.COLUMNS) || null,
        color: !process.env.NO_COLOR,
      });
    } catch { /* never break the status line */ }
    process.stdout.write(`${line || "Claude"}\n`);
  });
}

const isMain = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main();
