// The briefing hook for a Claude bot (DESIGN Approach "Group 3", Decision 9, A1, A3).
// Claude Code runs it on UserPromptSubmit from the per-person hook Start and Attach write
// in the session's .claude/settings.local.json; whatever it prints reaches the agent as
// context. Never every turn: a bot Start or Restart launched has its briefing in its system
// prompt (--append-system-prompt-file, models.js), so the hook prints nothing for it; a pane it
// couldn't launch so (Attach on a running pane, a bot started before this pack, a resumed
// conversation whose recorded system prompt predates the file) gets it once, on its first turn,
// and again only when the launch text changes or Claude compacted the conversation
// (briefingText.mjs shouldBrief; what it printed is kept per terminal under the app home). Plain node, outside Herdr: it imports no `herdr` or `gpui`, only the pack's pure
// modules. Fail-open: it prints nothing and exits 0 unless the attach ledger (attach.js) ties
// HC_TERMINAL_ID's terminal to a bot defined in the project $CLAUDE_PROJECT_DIR keys to; on an
// error it prints one stderr line and still exits 0. It only reads the ledger (the CLI alone
// writes it); before the CLI's first run has made one, the `bot` label stands in.
// It also ties a Claude session to its terminal for usagemeter, bot or worker alike: when the
// hook's stdin names a session_id the terminal's agent.session label doesn't hold yet, it
// appends a session row to the workers ledger and sets the label (once per change). Beside it
// goes agent.transcript, the hook's transcript_path, only when it is inside Claude's own
// transcript folder (transcriptFolder.mjs); a pane labelled before that gets it at its next
// prompt, with no second row. That part never fails the hook and never changes the briefing.
// Apache-2.0.

import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync, writeSync }
  from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BOT_LABEL, BOTS_PATH, effectiveLead, parseBots, projectKeyOf } from "./model.js";
import { UNANSWERED, paneOf, rowsOf, unwrapKeep } from "./launchArgs.js";
import { attachKey, attachPath, confirmBindings, foldAttach, modeProblem, readAttach, verdictOf } from "./attach.js";
import { botOfBriefingFile, briefedPath, briefingText, directMembers, latestReport, launchBriefingText, shouldBrief, textHash }
  from "./briefingText.mjs";
import { briefingFileOf, resumesConversation } from "./models.js";
import { SESSION_LABEL, TRANSCRIPT_LABEL, ledgerLine, ledgerPath, sessionChange, sessionRow }
  from "./workers.js";
import { transcriptRealPath } from "./transcriptFolder.mjs";

// About two seconds in all (the hook's limit is five): no hc call waits more than 1.5 s,
// none starts after the 2 s budget, a call that runs out counts as unreachable, and a last
// guard ends the process silently at 2.4 s. One away machine can't hold the prompt.
// The clock starts when the script runs as the hook, not when another program imports it.
// HERDR_BRIEFING_TIME_SCALE (a whole number, 1 to 10) multiplies all three: the tests' slow
// fakes run on loaded machines. It only ever lengthens them; unset, the times are as above.
export const BUDGET_MS = 2000;
export const CALL_MS = 1500;
export const GUARD_MS = 2400;
export const timeScale = (raw) => (/^([1-9]|10)$/.test(String(raw ?? "").trim()) ? Number(String(raw).trim()) : 1);
let until = Infinity;
let callMs = CALL_MS;

const MAX_HELPERS = 30;
let hcMissing = false;

// A program's stdout; null when it failed or is missing; UNANSWERED when it ran out of time.
function run(command, args, cwd) {
  const timeout = Math.min(callMs, until - Date.now());
  if (timeout <= 0) return Promise.resolve(UNANSWERED);
  return new Promise((resolve) => {
    try {
      execFile(command, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (!err) return resolve(stdout);
        if (err.killed || err.signal === "SIGTERM") return resolve(UNANSWERED);
        if (err.code === "ENOENT" && command === "hc") hcMissing = true;
        resolve(null);
      });
    } catch { resolve(null); }
  });
}
async function hcJson(args) {
  const out = await run("hc", [...args, "--json"]);
  if (out === null || out === UNANSWERED) return out;
  try { return JSON.parse(out); } catch { return null; }
}

const git = async (args, cwd) => { const out = await run("git", args, cwd); return out === UNANSWERED ? null : out; };
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

/**
 * The briefing of `bot` in `file`, gathered through `ask` (launchArgs.js paneOf's contract:
 * parsed `hc … --json`, null on failure, UNANSWERED when out of time). `address` is the bot's
 * own live terminal, whose unlabelled children are its helpers (null: no helpers counted).
 * Shared with the CLI's `automagik-herdr brief`.
 */
export async function gatherBriefing({ file, bot, address, ask, locate = (id) => paneOf(id, ask) }) {
  const team = directMembers(file, bot.id);
  const leadId = bot.kind === "member" ? effectiveLead(file, bot.id).lead : "";
  const leadBot = leadId ? file.bots.find((b) => b.id === leadId) : null;

  // One `hc ls` for the helpers (its rows carry parent and status), one label query per
  // team bot; `hc get` only for the bot panes found and the children no query named.
  const [all, panes, leadPane] = await Promise.all([
    address ? ask(["ls"]) : null,
    Promise.all(team.map((m) => locate(m.id))),
    leadBot ? locate(leadBot.id) : null,
  ]);
  const known = new Set([...panes, leadPane].flatMap((p) => p?.addresses ?? []));
  const [members, helpers] = await Promise.all([
    Promise.all(team.map(async (m, i) => {
      const p = panes[i];
      if (p.unreachable) return { bot: m, unreachable: true };
      if (!p.get) return { bot: m };
      return { bot: m, terminal: p.get.address, status: p.get.status?.state, report: await latestReport(p.get, ask) };
    })),
    helpersOf(all, address, known, ask),
  ]);
  const lead = leadBot
    ? { bot: leadBot, terminal: leadPane?.get?.address ?? "", status: leadPane?.get?.status?.state, unreachable: Boolean(leadPane?.unreachable) }
    : undefined;
  return briefingText({ self: bot, file, members, lead, helpers });
}

/**
 * The attach ledger under `appHome`, read only, through `ask`: null when there is no file
 * yet; a group- or world-writable one throws. Resolves { botAt(get), locate(botId) }:
 * botAt is the bot a terminal's `hc get` plays (null: none), locate a bot's pane in
 * paneOf's shape, each binding confirmed with `hc get` (live, the same created_ms) on demand.
 */
export async function ledgerOf(appHome, ask) {
  const path = attachPath(appHome);
  let st;
  try { st = statSync(path); } catch (e) { if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null; throw e; }
  const why = modeProblem(path, st.mode);
  if (why) throw new Error(why);
  const { byBot, byKey } = foldAttach(readAttach(readFileSync(path, "utf8")).rows);
  const status = await ask(["server", "status"]);
  const core = status && status !== UNANSWERED ? status.core?.id : null;
  if (typeof core !== "string" || !core) throw new Error("hc server status gave no core id");
  const none = { get: null, duplicate: false, addresses: [], gets: [] };
  return {
    botAt: (get) => {
      const b = get && typeof get === "object" ? byKey.get(attachKey({ core, terminal: get.address, created_ms: get.created_ms })) : null;
      return b && verdictOf(b, get) === "live" ? b.bot : null;
    },
    locate: async (botId) => {
      const b = byBot.get(botId);
      if (!b) return none;
      const { live, unknown } = await confirmBindings([b], core, ask, UNANSWERED);
      if (unknown.length) return { ...none, addresses: [b.terminal], unreachable: true };
      if (!live.length) return none;
      const get = { ...live[0].get, address: live[0].get.address ?? b.terminal };
      return { get, duplicate: false, addresses: [get.address], gets: [get] };
    },
  };
}

// `me`: the pending `hc get` of HC_TERMINAL_ID, `input` the hook's parsed stdin, both shared
// with joinSession. Resolves { text, record } (record: what to keep once the text is out), or null.
async function main(mePending, inputPending, appHome) {
  const self = process.env.HC_TERMINAL_ID;
  const dir = process.env.CLAUDE_PROJECT_DIR;
  if (!self || !dir) return null;
  const [me, key] = await Promise.all([mePending, projectKeyOf(dir, git, exists)]);
  if (hcMissing) throw new Error("hc is not on PATH");
  if (!me || me === UNANSWERED) return null;
  const terminal = me.address ?? self;
  const argv = unwrapKeep(me.foreground?.argv);
  const started = briefingFileOf(argv);
  const ledger = await ledgerOf(appHome, hcJson);
  const botId = ledger ? ledger.botAt({ ...me, address: terminal }) : me.labels?.[BOT_LABEL];
  if (!botId) return null;
  // Started with this bot's own briefing on a new conversation: its system prompt has it.
  const covered = Boolean(started) && botOfBriefingFile(started) === botId;
  const resumed = covered && resumesConversation("claude", argv);
  if (covered && !resumed) return null;
  const { file } = parseBots(await readFile(`${key === "/" ? "" : key}/${BOTS_PATH}`, "utf8"));
  const bot = file.bots.find((b) => b.id === botId);
  if (!bot || bot.planned) return null;
  const input = await inputPending;
  const now = { created_ms: me.created_ms ?? null, session: typeof input.session_id === "string" ? input.session_id : null,
    hash: textHash(launchBriefingText({ self: bot, file })) };
  const seen = readSeen(appHome, terminal);
  const transcript = typeof input.transcript_path === "string" ? transcriptRealPath(input.transcript_path, "claude", homedir()) : null;
  const same = seen && seen.created_ms === now.created_ms && seen.session === now.session;
  const scan = same && transcript ? compactedSince(transcript, seen.offset) : { compacted: false, size: seen?.offset ?? 0 };
  const record = () => writeSeen(appHome, terminal, { ...now, offset: transcript ? sizeOf(transcript) : 0 });
  if (!shouldBrief({ covered, resumed, seen, now, compacted: scan.compacted })) {
    if (same && transcript && scan.size !== seen.offset) writeSeen(appHome, terminal, { ...seen, offset: scan.size });
    return null;
  }
  const text = await gatherBriefing({ file, bot, address: terminal, ask: hcJson, ...(ledger ? { locate: ledger.locate } : {}) });
  return { text, record };
}

// ---- what the hook printed, per terminal (never every turn) ----

/** What the last print on `terminal` recorded: { created_ms, session, hash, offset }, or null. */
export function readSeen(appHome, terminal) {
  try {
    const seen = JSON.parse(readFileSync(briefedPath(appHome, terminal), "utf8"));
    return seen && typeof seen === "object" && typeof seen.hash === "string" ? { ...seen, offset: Number(seen.offset) || 0 } : null;
  } catch { return null; }
}
/** Records `seen` for `terminal`, replacing the file whole; a failure means the next turn prints again. */
export function writeSeen(appHome, terminal, seen) {
  try {
    const path = briefedPath(appHome, terminal);
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(seen)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch { /* fail open: the briefing comes again next turn */ }
}
const sizeOf = (path) => { try { return statSync(path).size; } catch { return 0; } };

/** Claude Code's mark of a compaction in its transcript (one JSON line per entry). */
export const COMPACT_MARK = '"subtype":"compact_boundary"';
const SCAN_CHUNK = 1 << 20;
const SCAN_MAX = 64 * SCAN_CHUNK;

/**
 * Whether the transcript at `path` gained a compaction past byte `offset` (a shorter file: it
 * was rewritten, which counts as one). Reads only what is new, its last SCAN_MAX bytes at most.
 * Resolves { compacted, size }; unreadable: { compacted: false, size: offset }.
 */
export function compactedSince(path, offset) {
  let fd = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    if (size < offset) return { compacted: true, size };
    const mark = Buffer.from(COMPACT_MARK);
    const chunk = Buffer.alloc(SCAN_CHUNK);
    let at = Math.max(offset, size - SCAN_MAX);
    // The last bytes of the window before, so a mark across two reads is still found.
    let tail = Buffer.alloc(0);
    while (at < size) {
      const n = readSync(fd, chunk, 0, Math.min(SCAN_CHUNK, size - at), at);
      if (n <= 0) break;
      const window = Buffer.concat([tail, chunk.subarray(0, n)]);
      if (window.includes(mark)) return { compacted: true, size };
      tail = Buffer.from(window.subarray(Math.max(0, window.length - (mark.length - 1))));
      at += n;
    }
    return { compacted: false, size };
  } catch { return { compacted: false, size: offset }; } finally { if (fd !== null) try { closeSync(fd); } catch {} }
}

/**
 * Its children (`hc ls` rows whose parent is its terminal, status from the row), never one
 * that carries a bot label. A row the team's label queries above named is a bot; any other
 * child (a helper, or a bot of another team or project) is asked with `hc get` for its
 * labels, at most MAX_HELPERS of them, and one that gives no answer is left out.
 */
async function helpersOf(all, address, known, ask) {
  if (!address || !all || all === UNANSWERED) return [];
  const kids = rowsOf(all).filter((r) => r?.parent === address && r.address && r.state !== "finished" && !known.has(r.address)).slice(0, MAX_HELPERS);
  const gets = await Promise.all(kids.map((r) => ask(["get", r.address])));
  return kids.filter((_, i) => gets[i] && typeof gets[i] === "object" && !gets[i].labels?.[BOT_LABEL])
    .map((r) => ({ status: typeof r.status === "string" ? r.status : r.status?.state }));
}

// The hook's stdin (Claude Code's JSON, with session_id and transcript_path), or "" when
// none comes within `ms` (a caller that never closes stdin can't hold the hook). Claude Code
// closes it at once, so INPUT_MS is never scaled: it only bounds such a caller.
const INPUT_MS = 300;
function readInput(ms) {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let text = "";
    let timer = null;
    const done = () => { clearTimeout(timer); process.stdin.removeAllListeners("data"); process.stdin.destroy(); resolve(text); };
    timer = setTimeout(done, ms);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { text += d; if (text.length > 1_000_000) done(); });
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

/**
 * Ties the Claude session in the hook's `input` to terminal `me` (its `hc get`) once per
 * change: a session row appended to the ledger under `appHome`, then the agent.session label
 * set (a failed label means the row comes again next turn, never a lost one). The
 * agent.transcript label (the hook's transcript_path, once Claude's folder under `home`
 * holds its real path) goes in the same `hc label` call whenever it is missing or differs:
 * a known session gets it with no row.
 * Never rejects; resolves with whether the session was new.
 */
export async function joinSession(self, me, input, appHome, home = homedir()) {
  try {
    if (!me || me === UNANSWERED) return false;
    const change = sessionChange(me, input, (path) => transcriptRealPath(path, "claude", home));
    if (!change) return false;
    const terminal = me.address ?? self;
    if (change.fresh) {
      const path = ledgerPath(appHome);
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      const fd = openSync(path, "a");
      const row = sessionRow({ terminal, session: change.session, transcript: change.transcript });
      try { writeSync(fd, ledgerLine(row)); } finally { closeSync(fd); }
    }
    const labels = [
      ...(change.fresh ? [`${SESSION_LABEL}=${change.session}`] : []),
      ...(change.label === null ? [] : [`${TRANSCRIPT_LABEL}=${change.label}`]),
    ];
    await run("hc", ["label", terminal, ...labels]);
    return change.fresh;
  } catch { return false; }
}

// The app home this script is installed in (<app home>/mods/am-sidebar/briefing.mjs).
const appHomeOf = () => process.env.HERDR_APP_HOME || fileURLToPath(new URL("../..", import.meta.url)).replace(/\/+$/, "");

// Run as the hook (node briefing.mjs), not when the CLI imports gatherBriefing.
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; } })();
if (import.meta.url === invoked) {
  const scale = timeScale(process.env.HERDR_BRIEFING_TIME_SCALE);
  until = Date.now() + BUDGET_MS * scale;
  callMs = CALL_MS * scale;
  const guard = setTimeout(() => process.exit(0), GUARD_MS * scale);
  guard.unref();
  const self = process.env.HC_TERMINAL_ID;
  const me = self ? hcJson(["get", self]) : Promise.resolve(null);
  const raw = self ? readInput(INPUT_MS) : Promise.resolve("");
  const input = raw.then((text) => { try { const x = JSON.parse(text); return x && typeof x === "object" ? x : {}; } catch { return {}; } });
  const joined = self ? Promise.all([me, raw]).then(([get, text]) => joinSession(self, get, text, appHomeOf()), () => false)
    : Promise.resolve(false);
  try {
    const out = await main(me, input, appHomeOf());
    // Past this point the block is on its way: the guard must not cut the write short.
    clearTimeout(guard);
    if (out?.text) {
      process.stdout.write(`${out.text}\n`);
      out.record();
    }
  } catch (e) {
    // Fail open: no briefing this turn and exit 0, with one line on stderr as a trace.
    clearTimeout(guard);
    process.stderr.write(`automagik-herdr briefing: ${String(e?.message ?? e).split("\n")[0]}\n`);
  }
  await joined;
  process.exitCode = 0;
}
