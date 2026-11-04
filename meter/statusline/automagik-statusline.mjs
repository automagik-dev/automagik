#!/usr/bin/env node
// Automagik Meter's Claude Code status line. Claude Code pipes a JSON status object to its
// statusline command on every turn; this prints one short line from it (two when the terminal is
// too narrow for one):
//
//   Opus 5.5 · my-repo | ctx 40% 400k/1M · 100k to compact · 2 compacts | 5h 23% ↺2h10m · 7d 58% ↺3d4h
//
// - ctx: used % and tokens of the context window, then the distance to the auto-compact window,
//   found the way Claude Code finds it (code.claude.com/docs/en/model-config, "Set the auto-compact
//   window"): none when DISABLE_AUTO_COMPACT or DISABLE_COMPACT is set or autoCompactEnabled is
//   false; else CLAUDE_CODE_AUTO_COMPACT_WINDOW when it is a usable size (200000, 200k, 1M; held to
//   100k-1M); else the first of .claude/settings.local.json, .claude/settings.json and the user
//   settings.json that names a window: modelSettings["<model id>"].autoCompactWindow, or the
//   top-level autoCompactWindow, the model's entry winning within one file. "auto" (the model's
//   tuned window) or no window anywhere leaves the distance out: no default is guessed. The window
//   is capped at the context window, as Claude Code caps it. A one-launch --autocompact flag and
//   managed settings are not visible to a status line.
// - compacts: compact_boundary records in the session's transcript, counted incrementally (only
//   the bytes appended since the last turn are read) and cached in the Meter state folder.
// - 5h / 7d: rate_limits used % and the time until each window resets.
//
// Node, no dependencies, never throws: any field it cannot read is left out. It reads stdin only,
// so it runs under a bare PATH as long as the command names node by its absolute path. It wraps
// cleanly in the limits logger: `node claude-limits-statusline.mjs -- node automagik-statusline.mjs`.
// NO_COLOR turns the colours off. METER_STATE_DIR moves the cache (same folder as the logger's).
import { closeSync, fstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const BOUNDARY = Buffer.from('"subtype":"compact_boundary"');
const CHUNK = 4 << 20;
const KEEP = 16;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 0 → "0", 78400 → "78k", 1000000 → "1M", 1250000 → "1.3M". */
export function tokens(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  const m = Math.round(n / 100_000) / 10;
  return `${m}M`;
}

/** Seconds until a reset as "45m", "2h10m" or "3d4h"; null once it has passed. */
export function until(seconds) {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.ceil(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

/**
 * The status line for one stdin object. Pure: `now` (ms), the auto-compact window, the compact
 * count and the terminal width come in through `opts`, so a fixture gives the same line every time.
 */
export function format(input, opts = {}) {
  const { now = Date.now(), autoCompactWindow = null, compacts = null, columns = null, color = true } = opts;
  const paint = (code, text) => (color && code ? `${code}${text}${RESET}` : text);
  const level = (pct) => (pct == null ? null : pct >= 90 ? RED : pct >= 70 ? YELLOW : null);
  const i = input && typeof input === "object" ? input : {};

  const head = [];
  const model = i.model?.display_name || i.model?.id;
  if (typeof model === "string" && model) head.push(model);
  const dir = i.workspace?.current_dir || i.cwd;
  if (typeof dir === "string" && dir) head.push(basename(dir) || dir);

  const ctx = [];
  const cw = i.context_window ?? {};
  const size = num(cw.context_window_size);
  let used = num(cw.total_input_tokens);
  if (used == null && cw.current_usage && typeof cw.current_usage === "object") {
    const u = cw.current_usage;
    used = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
  }
  let pct = num(cw.used_percentage);
  if (pct == null && used != null && size) pct = (used / size) * 100;
  const window = num(autoCompactWindow);
  // Colour the context by how close it is to compacting when that is known, else to the window.
  const pressure = window && used != null ? (used / window) * 100 : pct;
  const parts = [];
  if (pct != null) parts.push(`${Math.round(pct)}%`);
  if (used != null) parts.push(size ? `${tokens(used)}/${tokens(size)}` : tokens(used));
  if (parts.length) ctx.push(paint(level(pressure), `ctx ${parts.join(" ")}`));
  if (window && used != null) ctx.push(paint(level(pressure), used >= window ? "compact due" : `${tokens(window - used)} to compact`));
  if (num(compacts) && compacts > 0) ctx.push(`${compacts} compact${compacts === 1 ? "" : "s"}`);

  const quota = [];
  for (const [key, label] of [["five_hour", "5h"], ["seven_day", "7d"]]) {
    const w = i.rate_limits?.[key];
    const p = num(w?.used_percentage);
    if (p == null) continue;
    const left = num(w.resets_at) != null ? until(w.resets_at - now / 1000) : null;
    quota.push(paint(level(p), `${label} ${Math.round(p)}%`) + (left ? ` ↺${left}` : ""));
  }

  const dot = paint(DIM, " · "), bar = paint(DIM, " | ");
  const groups = [head, ctx, quota].filter((g) => g.length).map((g) => g.join(dot));
  const one = groups.join(bar);
  if (!columns || visible(one) <= columns - 2 || quota.length === 0 || groups.length < 2) return one;
  return [groups.slice(0, -1).join(bar), groups.at(-1)].join("\n");
}

const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Where Meter keeps its state; the limits logger uses the same folder. */
export function stateDir(env = process.env) {
  if (env.METER_STATE_DIR) return env.METER_STATE_DIR;
  const home = homedir();
  return platform() === "darwin" ? join(home, "Library/Application Support/automagik")
    : join(env.XDG_STATE_HOME || join(home, ".local/state"), "automagik");
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

const MIN_WINDOW = 100_000, MAX_WINDOW = 1_000_000;
const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
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
 * The auto-compact window this session runs at, in tokens, or null when auto-compact is off or
 * the window is Claude Code's own ("auto", or none set). Sources and order: the file header.
 */
export function autoCompactWindowFor(input, env = process.env) {
  if (flag(env.DISABLE_AUTO_COMPACT) || flag(env.DISABLE_COMPACT)) return null;
  const config = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const project = input?.workspace?.project_dir;
  const files = typeof project === "string" && project
    ? [join(project, ".claude/settings.local.json"), join(project, ".claude/settings.json")] : [];
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
 * How many times the session compacted: compact_boundary records in its transcript. Only the
 * bytes appended since the last count are read; a shorter or replaced file is counted again from
 * the start. The cache is best effort: unreadable, it is rebuilt.
 */
export function countCompacts(transcript, dir = stateDir()) {
  if (typeof transcript !== "string" || !transcript) return null;
  const cacheFile = join(dir, "statusline-compacts.json");
  const cache = readJson(cacheFile);
  const entries = cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {};
  let fd;
  try { fd = openSync(transcript, "r"); } catch { return null; }
  try {
    const st = fstatSync(fd);
    let prev = entries[transcript];
    if (!prev || prev.ino !== st.ino || !(prev.offset <= st.size) || typeof prev.count !== "number") prev = { offset: 0, count: 0 };
    if (prev.size === st.size && prev.offset <= st.size) return prev.count;
    let offset = prev.offset, count = prev.count, carry = Buffer.alloc(0);
    while (offset + carry.length < st.size) {
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - offset - carry.length));
      const n = readSync(fd, buf, 0, buf.length, offset + carry.length);
      if (n <= 0) break;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const end = data.lastIndexOf(10);
      if (end < 0) { carry = data; continue; }
      for (let at = data.indexOf(BOUNDARY); at >= 0 && at < end; at = data.indexOf(BOUNDARY, at + BOUNDARY.length)) count++;
      offset += end + 1;
      carry = data.subarray(end + 1);
    }
    entries[transcript] = { ino: st.ino, size: st.size, offset, count, at: Date.now() };
    save(cacheFile, dir, entries);
    return count;
  } catch { return null; } finally { try { closeSync(fd); } catch { /* closed */ } }
}

function save(cacheFile, dir, entries) {
  try {
    const kept = Object.fromEntries(Object.entries(entries).sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0)).slice(0, KEEP));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(kept), { mode: 0o600 });
    renameSync(tmp, cacheFile);
  } catch { /* the next turn counts again */ }
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
      line = format(input, {
        autoCompactWindow: safe(() => autoCompactWindowFor(input)),
        compacts: safe(() => countCompacts(input?.transcript_path)),
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
