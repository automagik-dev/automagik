#!/usr/bin/env node
// Claude limit reading for usagemeter. Claude Code pipes a JSON status object to its
// statusline command on every turn; it carries rate_limits (five_hour / seven_day
// used_percentage). This wrapper appends one reading to a local log when a value changes
// (or every 5 minutes), then runs the real statusline with the same input and prints its
// output. It never blocks the statusline: any logging error is ignored.
//
// Log: ~/Library/Application Support/automagik/claude-limits.jsonl (Linux:
// $XDG_STATE_HOME/automagik or ~/.local/state/automagik; METER_STATE_DIR overrides), 0600.
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
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const stateDir = process.env.METER_STATE_DIR
  || (platform() === "darwin" ? join(HOME, "Library/Application Support/automagik")
    : join(process.env.XDG_STATE_HOME || join(HOME, ".local/state"), "automagik"));
const LOG = join(stateDir, "claude-limits.jsonl");
const LAST = join(stateDir, "claude-limits.last.json");
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

function record(input) {
  const rl = input?.rate_limits;
  if (!rl || typeof rl !== "object") return;
  const { account, plan } = accountInfo();
  const pick = (w) => (w && typeof w === "object") ? { used_percentage: w.used_percentage ?? null, resets_at: w.resets_at ?? null } : null;
  const reading = { account, plan, five_hour: pick(rl.five_hour), seven_day: pick(rl.seven_day) };
  const key = JSON.stringify(reading);
  const now = Date.now();
  let last = null;
  try { last = JSON.parse(readFileSync(LAST, "utf8")); } catch { /* first reading */ }
  if (last && last.key === key && now - last.at < EVERY_MS) return;
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
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
