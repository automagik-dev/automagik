#!/usr/bin/env node
// Claude limit reading for usagemeter. Claude Code pipes a JSON status object to its
// statusline command on every turn; it carries rate_limits (five_hour / seven_day
// used_percentage). This wrapper appends one reading to a local log when a value changes
// (or every 5 minutes), then runs the real statusline with the same input and prints its
// output. It never blocks the statusline: any logging error is ignored.
//
// Log: claude-limits.jsonl in the meter's state folder, ~/.automagik/meter (<AM_HOME>/meter when
// AM_HOME is an absolute path; METER_STATE_DIR overrides both), 0600. The old folder (before the
// meter moved it: ~/Library/Application Support/automagik on macOS, else $XDG_STATE_HOME/automagik
// or ~/.local/state/automagik) is read once: a log and its last reading still there are moved into
// the new folder (a hard link, then the old name removed; never over a file already there, the
// meter's own rule), so the meter's first sync finds nothing of ours left to move; a move cut short
// after the link is finished. When the link cannot be made (the old folder on another filesystem),
// the logger keeps writing the old folder and starts no log in the new one: the meter's first sync
// then moves both files itself (its own verified copy) and finds nothing left to warn about, and
// the logger follows them. The new folder is kept at 0700, tightened when it is looser.
// One line: {ts, account, plan, five_hour, seven_day, model, session}. `account` is the
// first 16 hex of sha256(accountUuid): the same account on two machines matches, and the
// raw id is never written. No prompt text, no tokens, no email.
//
// Usage (settings.json): "statusLine": {"type":"command","command":
//   "node ~/.local/bin/claude-limits-statusline.mjs -- <the previous statusline command>"}
// The words after `--` are the command's own argv, as the shell running the statusline split
// them: the first is the program, the rest its arguments, run directly (no second shell), so an
// argument holding a space stays one argument. A command that needs a shell (a pipe, `&&`) is
// written as one: `-- sh -c '<command>'`.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, linkSync, lstatSync, statSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

const HOME = process.env.HOME || homedir();
// automagik-statusline.mjs stateDir and legacyStateDir, kept equal by a test (this file runs alone).
const AM_HOME = process.env.AM_HOME;
const stateDir = process.env.METER_STATE_DIR
  || (AM_HOME && isAbsolute(AM_HOME) ? join(AM_HOME, "meter") : join(HOME, ".automagik/meter"));
const XDG = process.env.XDG_STATE_HOME;
const oldDir = process.env.METER_STATE_DIR ? null
  : platform() === "darwin" ? join(HOME, "Library/Application Support/automagik")
    : join(XDG && isAbsolute(XDG) ? XDG : join(HOME, ".local/state"), "automagik");
const NAMES = ["claude-limits.jsonl", "claude-limits.last.json"];
const EVERY_MS = 5 * 60 * 1000;

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const raw = Buffer.concat(chunks);
  try { record(JSON.parse(raw.toString("utf8"))); } catch { /* never break the statusline */ }
  passThrough(raw);
});

function accountInfo() {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  const file = dir ? join(dir, ".claude.json") : join(HOME, ".claude.json");
  try {
    const a = JSON.parse(readFileSync(file, "utf8")).oauthAccount ?? {};
    const id = a.accountUuid ? createHash("sha256").update(a.accountUuid).digest("hex").slice(0, 16) : null;
    return { account: id, plan: a.userRateLimitTier ?? a.organizationRateLimitTier ?? a.billingType ?? null };
  } catch { return { account: null, plan: null }; }
}

const isFile = (p) => { try { return lstatSync(p).isFile(); } catch { return false; } };

/**
 * Moves the log and its last reading out of the old folder, once; a file of its own already in the
 * new folder leaves them. A move cut short between the link and the unlink (both names on one
 * file) is finished: the old name goes. Returns the folder to write in: the new one, or the old one
 * while its log could not be moved and the new folder has none (the meter moves it then).
 */
function adopt() {
  if (!oldDir || oldDir === stateDir) return stateDir;
  for (const name of NAMES) {
    const from = join(oldDir, name), to = join(stateDir, name);
    try {
      const src = lstatSync(from);
      if (!src.isFile()) continue;
      let dst = null;
      try { dst = lstatSync(to); } catch { /* not there yet */ }
      if (dst && !(dst.dev === src.dev && dst.ino === src.ino)) continue; // never replaced
      if (!dst) {
        mkdirSync(dirname(stateDir), { recursive: true });
        mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        linkSync(from, to); // never replaces: a file there by now throws
      }
      unlinkSync(from);
    } catch { /* absent, or left where it is */ }
  }
  return isFile(join(oldDir, NAMES[0])) && !lstatOk(join(stateDir, NAMES[0])) ? oldDir : stateDir;
}

const lstatOk = (p) => { try { lstatSync(p); return true; } catch { return false; } };

/** The new state folder at 0700: made so, or tightened when it is looser (the meter keeps it so too). */
function ownFolder(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (statSync(dir).mode & 0o077) chmodSync(dir, 0o700);
}

function record(input) {
  const rl = input?.rate_limits;
  if (!rl || typeof rl !== "object") return;
  const dir = adopt();
  const LOG = join(dir, NAMES[0]), LAST = join(dir, NAMES[1]);
  const { account, plan } = accountInfo();
  const pick = (w) => (w && typeof w === "object") ? { used_percentage: w.used_percentage ?? null, resets_at: w.resets_at ?? null } : null;
  const reading = { account, plan, five_hour: pick(rl.five_hour), seven_day: pick(rl.seven_day) };
  const key = JSON.stringify(reading);
  const now = Date.now();
  let last = null;
  try { last = JSON.parse(readFileSync(LAST, "utf8")); } catch { /* first reading */ }
  if (last && last.key === key && now - last.at < EVERY_MS) return;
  if (dir === stateDir) ownFolder(stateDir);
  const line = JSON.stringify({ ts: new Date(now).toISOString(), ...reading, model: input?.model?.id ?? null, session: input?.session_id ?? null }) + "\n";
  const fresh = !existsSync(LOG);
  appendFileSync(LOG, line, { mode: 0o600 });
  if (fresh) chmodSync(LOG, 0o600);
  writeFileSync(LAST, JSON.stringify({ key, at: now }), { mode: 0o600 });
}

function passThrough(raw) {
  const i = process.argv.indexOf("--");
  const [cmd, ...args] = i >= 0 ? process.argv.slice(i + 1) : [];
  if (!cmd) return;
  const child = spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(raw);
  child.on("exit", (code) => process.exit(code ?? 0));
}
