// The status line's formatter against fixture stdin objects (shaped after a real Claude Code
// 2.1.318 statusline input), its run-out estimate, limits-log tail, bot lookup and settings lookup
// in temp folders, and the command end to end under a bare PATH, alone and wrapped by the limits
// logger.
//   node --test 'meter/statusline/test/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WHOIS_TIMEOUT, autoCompactWindowFor, bar, botName, envWindow, format, legacyStateDir, localSettingsRoot, readLimits, readLimitsTail, runOut, stateDir, tokens, until } from "../automagik-statusline.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(here(`fixtures/${name}.json`), "utf8"));
const NOW = 1_793_800_000_000;
const plain = { now: NOW, autoCompactWindow: 500_000, color: false };
const temp = () => mkdtempSync(join(tmpdir(), "meter-statusline-"));
const iso = (s) => new Date(s * 1000).toISOString();

test("fixtures (NO_COLOR): fresh session, mid session with quota, outside Herdr, near the limits", () => {
  assert.equal(format(fixture("fresh-session"), plain),
    "🧠 Opus 5.5 ⚡medium  ┃  📁 my-app  ┃  💬 ▱▱▱▱▱▱▱▱▱▱ 0/1M");
  assert.equal(format(fixture("mid-session-quota"), { ...plain, bot: "Meter Captain" }),
    "🤖 Meter Captain  🧠 Opus 5.5 ⚡high  ┃  📁 api  ┃  💬 ▰▰▰▰▱▱▱▱▱▱ 400k/1M"
    + "  ┃  Quota 5h ▰▱▱▱▱ 24%  Resets 2h14m  ┃  Quota 7d ▰▰▱▱▱ 31%  Resets 4d2h");
  // Outside a Herdr pane there is no bot: the line starts at the model.
  assert.equal(format(fixture("mid-session-quota"), plain),
    "🧠 Opus 5.5 ⚡high  ┃  📁 api  ┃  💬 ▰▰▰▰▱▱▱▱▱▱ 400k/1M"
    + "  ┃  Quota 5h ▰▱▱▱▱ 24%  Resets 2h14m  ┃  Quota 7d ▰▰▱▱▱ 31%  Resets 4d2h");
  // Near the limits, no log: 94% after 4h01m of the 5h window runs out in 16m, before its reset
  // in 59m; 91% after 5d22h of the 7d window in 13h47m, before 1d1h.
  assert.equal(format(fixture("quota-near-limit"), { ...plain, bot: "Meter Captain" }),
    "🤖 Meter Captain  🧠 Opus 5.5 ⚡xhigh  ┃  📁 my-app  ┃  💬 ▰▰▰▰▰▱▱▱▱▱ 472k/1M"
    + "  ┃  Quota 5h ▰▰▰▰▰ 94%  Left 16m  Resets 59m  ┃  Quota 7d ▰▰▰▰▰ 91%  Left 13h47m  Resets 1d1h");
});

test("colour: green under 70, yellow from 70, red from 90; Left in red; context against the compact window", () => {
  const E = (c) => `\x1b[${c}m`, R = E(0), dim = (s) => `${E(2)}${s}${R}`, red = (s) => `${E(31)}${s}${R}`;
  const sep = dim("  ┃  ");
  assert.equal(format(fixture("quota-near-limit"), { now: NOW, autoCompactWindow: 500_000, bot: "Meter Captain" }),
    `🤖 ${E(36)}${E(1)}Meter Captain${R}  🧠 ${E(1)}Opus 5.5${R} ⚡xhigh${sep}📁 my-app${sep}`
    + `💬 ${red("▰▰▰▰▰▱▱▱▱▱")} ${red("472k")}${dim("/1M")}${sep}` // 94% of the 500k window
    + `${dim("Quota 5h")} ${red("▰▰▰▰▰")} ${red("94%")}  ${dim("Left")} ${red("16m")}  ${dim("Resets")} 59m${sep}`
    + `${dim("Quota 7d")} ${red("▰▰▰▰▰")} ${red("91%")}  ${dim("Left")} ${red("13h47m")}  ${dim("Resets")} 1d1h`);
  // 400k is 80% of a 500k compact window (yellow) though the bar is 40% of the context window.
  const mid = format(fixture("mid-session-quota"), { now: NOW, autoCompactWindow: 500_000 });
  assert.ok(mid.includes(`${E(33)}▰▰▰▰▱▱▱▱▱▱${R} ${E(33)}400k${R}`), mid);
  assert.ok(mid.includes(`${E(32)}▰▱▱▱▱${R} ${E(32)}24%${R}`), mid);
  // No compact window: measured against the context window, 40%: green.
  assert.ok(format(fixture("mid-session-quota"), { now: NOW }).includes(`${E(32)}▰▰▰▰▱▱▱▱▱▱${R}`));
  const at = (p) => format({ rate_limits: { five_hour: { used_percentage: p } } }, { now: NOW });
  assert.equal([69.4, 70, 89, 90].map((p) => at(p).match(/\x1b\[3(\d)m\d+%/)[1]).join(), "2,3,3,1");
});

test("a narrow terminal gets two lines: the quota moves to the second", () => {
  assert.equal(format(fixture("mid-session-quota"), { ...plain, columns: 120 }),
    "🧠 Opus 5.5 ⚡high  ┃  📁 api  ┃  💬 ▰▰▰▰▱▱▱▱▱▱ 400k/1M\n"
    + "Quota 5h ▰▱▱▱▱ 24%  Resets 2h14m  ┃  Quota 7d ▰▰▱▱▱ 31%  Resets 4d2h");
  assert.equal(format(fixture("mid-session-quota"), { ...plain, columns: 200 }).includes("\n"), false);
});

test("missing fields drop their segment, and it never throws", () => {
  for (const input of [null, undefined, "text", 42, [], {}, { model: null, context_window: null, rate_limits: null, effort: "high" }]) {
    assert.equal(typeof format(input, plain), "string");
  }
  assert.equal(format({}, plain), "");
  // No effort (a model without the setting): no effort word.
  const { effort, ...noEffort } = fixture("fresh-session");
  assert.equal(effort.level, "medium");
  assert.equal(format(noEffort, plain), "🧠 Opus 5.5  ┃  📁 my-app  ┃  💬 ▱▱▱▱▱▱▱▱▱▱ 0/1M");
  // One window only, as Claude Code sends once the other has reset; a passed reset shows no timer.
  const real = { model: { id: "claude-opus-5-5", display_name: "Opus 5.5" }, rate_limits: { seven_day: { used_percentage: 58, resets_at: 1_793_700_000 } } };
  assert.equal(format(real, plain), "🧠 Opus 5.5  ┃  Quota 7d ▰▰▰▱▱ 58%");
  // Tokens worked out from current_usage when the totals are absent; from the % when only it is there.
  const usage = { context_window: { context_window_size: 200_000, current_usage: { input_tokens: 10, cache_creation_input_tokens: 990, cache_read_input_tokens: 49_000 } } };
  assert.equal(format(usage, plain), "💬 ▰▰▰▱▱▱▱▱▱▱ 50k/200k");
  assert.equal(format({ context_window: { context_window_size: 1_000_000, used_percentage: 52 } }, plain), "💬 ▰▰▰▰▰▱▱▱▱▱ 520k/1M");
  assert.equal(format({ context_window: { used_percentage: 52 } }, plain), "💬 ▰▰▰▰▰▱▱▱▱▱ 52%");
  // Text from stdin or bots.json is printed without its control characters.
  assert.equal(format({ model: { display_name: "Opus\x1b[2J 5.5\n" }, workspace: { current_dir: "/x/a\x07b" } }, { ...plain, bot: "\x1b]0;t\x07Bot" }),
    "🤖 ]0;tBot  🧠 Opus[2J 5.5  ┃  📁 ab");
});

test("tokens, times and bars read short", () => {
  assert.deepEqual([0, 999, 1000, 78_400, 999_400, 1_000_000, 1_250_000].map(tokens), ["0", "999", "1k", "78k", "999k", "1M", "1.3M"]);
  assert.deepEqual([null, -5, 0, 30, 2700, 3600, 7_840, 86_400, 353_600].map(until), [null, null, null, "1m", "45m", "1h00m", "2h11m", "1d0h", "4d2h"]);
  assert.deepEqual([[0, 10], [4, 10], [5, 10], [40, 10], [100, 10], [140, 5], [-3, 5], [null, 5], [94, 5]].map(([p, n]) => bar(p, n)),
    ["▱▱▱▱▱▱▱▱▱▱", "▱▱▱▱▱▱▱▱▱▱", "▰▱▱▱▱▱▱▱▱▱", "▰▰▰▰▱▱▱▱▱▱", "▰▰▰▰▰▰▰▰▰▰", "▰▰▰▰▰", "▱▱▱▱▱", "▱▱▱▱▱", "▰▰▰▰▰"]);
});

test("Left: the rise over the time the log covers, idle gaps left out; else since the window started", () => {
  const t = NOW / 1000, reset = t + 3600; // a 5h window started 4h ago, 1h to its reset
  const w = (used) => ({ used_percentage: used, resets_at: reset });
  const row = (ago, used, resetsAt = reset) => ({ ts: iso(t - ago), five_hour: { used_percentage: used, resets_at: resetsAt } });
  // Readings every 5 minutes (the logger's heartbeat), from `from` seconds ago to `to`.
  const every5 = (from, to, at, make = row) => Array.from({ length: (from - to) / 300 + 1 }, (_, n) => make(from - n * 300, at(from - n * 300)));
  const left = (...a) => { const s = runOut(...a); return s == null ? null : Math.round(s); };
  // 1% a minute over the last 70 minutes: at 70%, 30% left runs out in 30 minutes.
  const steady = every5(4200, 0, (ago) => 70 - ago / 60);
  assert.equal(left("five_hour", w(70), NOW, steady), 1800);
  // A stale stdin reading changes nothing: the log's highest reading is the current used %.
  assert.equal(left("five_hour", w(50), NOW, steady), 1800);
  // 0.1% a minute runs out after the reset: no Left. No rise at all: no Left, though the
  // window's average would give one.
  assert.equal(left("five_hour", w(70), NOW, every5(4200, 0, (ago) => 70 - ago / 600)), null);
  assert.equal(left("five_hour", w(90), NOW, every5(4200, 0, () => 90)), null);
  // An idle gap counts neither its time nor a rise across it: a reading at 20% 50 minutes ago,
  // nothing, then 1% a minute over the last 20 minutes (less the 5 settling minutes after the
  // gap): 20% left in 20 minutes.
  assert.equal(left("five_hour", w(80), NOW, [row(3000, 20), ...every5(1200, 0, (ago) => 80 - ago / 60)]), 1200);
  // A lone reading 10 minutes old covers too little to measure: no Left.
  assert.equal(left("five_hour", w(90), NOW, [row(600, 10)]), null);
  // No reading of the window in the lookback: the average since the window started, 90% in 4h,
  // 10% left in 1600 s. Readings of another window (an older reset), from the future or
  // malformed are none.
  assert.equal(left("five_hour", w(90), NOW, []), 1600);
  const ignored = [row(2400, 10, reset - 18000), row(-60, 10), { ts: "x", five_hour: { used_percentage: 10, resets_at: reset } }, null, 5];
  assert.equal(left("five_hour", w(90), NOW, ignored), 1600);

  // The 7d window looks back 6h. 2% in 6h at 90%: 10% left in 30h (1d6h).
  const reset7 = t + 2 * 86400, w7 = { used_percentage: 90, resets_at: reset7 };
  const row7 = (ago, used) => ({ ts: iso(t - ago), seven_day: { used_percentage: used, resets_at: reset7 } });
  // A resumed session logs its value from before the resume (54%) with a fresh ts, a second
  // before its current one: the shape of the owner's log. It changes nothing.
  assert.equal(left("seven_day", w7, NOW, [...every5(25200, 0, (ago) => 90 - ago / 10800, row7), row7(17999, 54)]), 108_000);
  assert.equal(until(108_000), "1d6h");
  // The log starts with that resumed session 5h ago: the 5 settling minutes keep its stale first
  // reading out; 2% in 5h, 10% left in 25h (1d1h), not 1h24m.
  const resumed = [row7(18000, 54), row7(17999, 88), ...every5(17700, 0, (ago) => 88 + 2 * (18000 - ago) / 18000, row7)];
  assert.equal(left("seven_day", w7, NOW, resumed), 90_000);
  // A gap: one reading 11.5h ago (80%), idle, then 2% an hour over the last 100 minutes (95
  // covered, past the 90-minute floor): 10% left in 5h. b65c385e started the rate at the old
  // reading and counted the idle hours: 11h30m.
  const gap = [row7(41_400, 80), ...every5(6000, 0, (ago) => 90 - 2 * ago / 3600, row7)];
  assert.equal(left("seven_day", w7, NOW, gap), 18_000);
  assert.equal(until(18_000), "5h00m");

  // Nothing to show: a reset that passed, a full window (stdin or log), an unknown window, a
  // fresh window.
  assert.equal(runOut("five_hour", { used_percentage: 50, resets_at: t - 1 }, NOW, []), null);
  assert.equal(runOut("five_hour", w(100), NOW, []), null);
  assert.equal(runOut("five_hour", w(90), NOW, [row(600, 100)]), null);
  assert.equal(runOut("one_day", w(90), NOW, []), null);
  assert.equal(runOut("five_hour", { used_percentage: 90, resets_at: t + 18000 - 300 }, NOW, []), null);
  // format() shows the log's rate.
  const input = { rate_limits: { five_hour: w(70) } };
  assert.equal(format(input, { ...plain, limits: steady }), "Quota 5h ▰▰▰▰▱ 70%  Left 30m  Resets 1h00m");
  assert.equal(format(input, plain), "Quota 5h ▰▰▰▰▱ 70%  Resets 1h00m");
});

test("Left on the owner's log shape after an overnight gap: none until 90 minutes are covered", () => {
  // The 7d window on the owner's log, 2026-11-05: a last reading at 78% at 03:15Z, nothing for
  // 8h24m, then readings from 11:39Z at 79%, whole-percent steps at the minutes below after it
  // (the real step times), about 3.2% an hour. Readings every 5 minutes and at each step.
  const resume = NOW / 1000 - 3 * 3600, reset7 = resume + 3 * 86400;
  const steps = [[0, 79], [19, 80], [55, 81], [74, 82], [87, 83], [100, 84], [115, 85], [125, 86]];
  const at = (s) => steps.filter(([m]) => m * 60 <= s).at(-1)[1];
  const row7 = (ts, used) => ({ ts: iso(ts), seven_day: { used_percentage: used, resets_at: reset7 } });
  const rowsTill = (s) => [row7(resume - 30_240, 78),
    ...[...new Set([...Array.from({ length: Math.floor(s / 300) + 1 }, (_, n) => n * 300), ...steps.map(([m]) => m * 60).filter((x) => x <= s)])]
      .sort((a, b) => a - b).map((x) => row7(resume + x, at(x)))];
  const leftAt = (min) => {
    const s = min * 60;
    return runOut("seven_day", { used_percentage: at(s), resets_at: reset7 }, (resume + s) * 1000, rowsTill(s));
  };
  // Under 90 minutes covered (5 of them settling after the gap): no Left. ca8b3822 measured
  // from 15 minutes on, and at 53 minutes, flat at 80% since minute 19, showed 16h00m (the real
  // log: 6h09m at 12:04Z climbing to 15h29m at 12:32Z, then halving).
  for (let min = 10; min <= 94; min += 1) assert.equal(leftAt(min), null, `minute ${min}`);
  // From 95 minutes on, the pace the log covers: within 4.5 to 2.5% an hour, never 15h.
  for (let min = 95; min <= 130; min += 1) {
    const s = leftAt(min), used = at(min * 60);
    assert.ok(s != null && s >= ((100 - used) / 4.5) * 3600 && s <= ((100 - used) / 2.5) * 3600, `minute ${min}: ${s}`);
  }
  assert.equal(until(leftAt(101)), "5h08m"); // 84%: 5% in 96 covered minutes
});

test("the limits log: only its last 256 KiB, a cut first line and bad lines skipped", () => {
  const dir = temp();
  try {
    assert.deepEqual(readLimitsTail(dir), []);
    const log = join(dir, "claude-limits.jsonl");
    writeFileSync(log, `${JSON.stringify({ ts: "a" })}\nnot json\n[1]\n\n${JSON.stringify({ ts: "b" })}\n{"ts":"half`);
    assert.deepEqual(readLimitsTail(dir), [{ ts: "a" }, { ts: "b" }]);
    const line = (n) => `${JSON.stringify({ ts: String(n), pad: "x".repeat(90) })}\n`;
    const lines = Array.from({ length: 4000 }, (_, n) => line(n)).join(""); // about 450 KiB
    writeFileSync(log, lines);
    const rows = readLimitsTail(dir);
    assert.equal(rows.at(-1).ts, "3999");
    assert.ok(rows.length < 2700 && rows.length > 2000, String(rows.length));
    assert.equal(Buffer.byteLength(rows.map((r) => line(Number(r.ts))).join("")) <= 256 << 10, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** A fake automagik-herdr: answers whois from a table (an object: printed as JSON; a string: run as sh), counts its calls. */
function fakeHerdr(dir, answers) {
  const calls = join(dir, "calls");
  const launcher = join(dir, "automagik-herdr");
  const cases = Object.entries(answers).map(([term, out]) => `  ${term}) ${typeof out === "string" ? out : `printf '%s' '${JSON.stringify(out)}'`} ;;`).join("\n");
  writeFileSync(launcher, `#!/bin/sh\necho "$*" >> '${calls}'\n[ "$1 $2" = "whois --json" ] || exit 2\ncase $3 in\n${cases}\n  *) exit 1 ;;\nesac\n`);
  return { launcher, calls: () => { try { return readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; } } };
}

test("bot name: whois in a Herdr pane, the name from the project's bots.json, cached 10 minutes", () => {
  const dir = temp();
  try {
    const project = join(dir, "project"), state = join(dir, "state");
    mkdirSync(join(project, ".herdr"), { recursive: true });
    writeFileSync(join(project, ".herdr/bots.json"), JSON.stringify({ version: 1, bots: [{ id: "b-one", name: "Meter Captain" }, { id: "b-esc", name: "Bad\x1b[2J" }] }));
    const one = JSON.stringify({ terminal: "t6", bot: "b-one", project });
    const herdr = fakeHerdr(dir, {
      t1: { terminal: "t1", core: "c", created_ms: 1, bot: "b-one", project, since: "x" },
      t2: { terminal: "t2", core: "c", created_ms: 1, bot: null },
      t3: { terminal: "t3", bot: "b-esc", project },
      t4: { terminal: "t4", bot: "b-one", project: "project" }, // not an absolute path
      t5: { terminal: "t5", bot: "b-gone", project },
      t6: `sleep 1; printf '%s' '${one}'`, // answers in 1 s: inside the bound
      t8: `trap '' TERM; exec sleep 4`, // hangs, deaf to SIGTERM
    });
    const opts = { dir: state, launcher: herdr.launcher, now: NOW };
    // Outside Herdr: nothing is asked.
    assert.equal(botName({}, opts), null);
    assert.equal(herdr.calls(), 0);
    assert.equal(botName({ HC_TERMINAL_ID: "t1" }, opts), "Meter Captain");
    assert.equal(herdr.calls(), 1);
    // Cached, misses too, for 10 minutes; then asked again.
    assert.equal(botName({ HC_TERMINAL_ID: "t1" }, { ...opts, now: NOW + 599_000 }), "Meter Captain");
    assert.equal(botName({ HC_TERMINAL_ID: "t2" }, opts), null);
    assert.equal(botName({ HC_TERMINAL_ID: "t2" }, opts), null);
    assert.equal(herdr.calls(), 2);
    assert.equal(botName({ HC_TERMINAL_ID: "t1" }, { ...opts, now: NOW + 600_000 }), "Meter Captain");
    assert.equal(herdr.calls(), 3);
    // Another socket (another Herdr core) is another terminal.
    assert.equal(botName({ HC_TERMINAL_ID: "t1", HC_TERMINAL_SOCKET: "/other.sock" }, opts), "Meter Captain");
    assert.equal(herdr.calls(), 4);
    assert.equal(botName({ HC_TERMINAL_ID: "t3" }, opts), "Bad[2J");
    for (const term of ["t4", "t5", "t9"]) assert.equal(botName({ HC_TERMINAL_ID: term }, opts), null, term);
    // The bound is 1.5 s: a whois answering in 1 s is waited for; one that hangs, even deaf to
    // SIGTERM, is killed (SIGKILL) at the bound, well before its 4 s, and cached like a miss.
    assert.equal(WHOIS_TIMEOUT, 1500);
    assert.equal(botName({ HC_TERMINAL_ID: "t6" }, opts), "Meter Captain");
    const started = Date.now();
    assert.equal(botName({ HC_TERMINAL_ID: "t8" }, opts), null);
    const took = Date.now() - started;
    assert.ok(took >= 1400 && took < 3000, `whois took ${took} ms`);
    const before = herdr.calls();
    assert.equal(botName({ HC_TERMINAL_ID: "t8" }, opts), null);
    assert.equal(herdr.calls(), before);
    // No launcher, or a corrupt cache: no bot, no throw.
    assert.equal(botName({ HC_TERMINAL_ID: "t7" }, { ...opts, launcher: join(dir, "missing") }), null);
    writeFileSync(join(state, "statusline-bots.json"), "garbage");
    assert.equal(botName({ HC_TERMINAL_ID: "t1" }, opts), "Meter Captain");
    const cache = JSON.parse(readFileSync(join(state, "statusline-bots.json"), "utf8"));
    assert.deepEqual(cache["#t1"], { name: "Meter Captain", at: NOW });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("bot name: 24 panes keep their entries, one whois each in 10 minutes; expired ones drop", () => {
  const dir = temp();
  try {
    const project = join(dir, "project"), state = join(dir, "state");
    const terms = Array.from({ length: 24 }, (_, n) => `t${100 + n}`);
    mkdirSync(join(project, ".herdr"), { recursive: true });
    writeFileSync(join(project, ".herdr/bots.json"), JSON.stringify({ bots: terms.map((term) => ({ id: `b-${term}`, name: `Bot ${term}` })) }));
    const herdr = fakeHerdr(dir, Object.fromEntries(terms.map((term) => [term, { terminal: term, bot: `b-${term}`, project }])));
    // Five renders of every pane, interleaved, over 9 minutes: 24 whois runs, not 120.
    for (let round = 0; round < 5; round++) {
      for (const [n, term] of terms.entries()) {
        const now = NOW + round * 135_000 + n * 1000;
        assert.equal(botName({ HC_TERMINAL_ID: term }, { dir: state, launcher: herdr.launcher, now }), `Bot ${term}`);
      }
    }
    assert.equal(herdr.calls(), 24);
    assert.equal(Object.keys(JSON.parse(readFileSync(join(state, "statusline-bots.json"), "utf8"))).length, 24);
    // 11 minutes on, every entry has expired: one pane asks again and the file keeps only it.
    assert.equal(botName({ HC_TERMINAL_ID: "t100" }, { dir: state, launcher: herdr.launcher, now: NOW + 660_000 + 23_000 }), "Bot t100");
    assert.equal(herdr.calls(), 25);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(state, "statusline-bots.json"), "utf8"))), ["#t100"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("auto-compact window: the model's entry in user settings, the project overriding, off when disabled", () => {
  const dir = temp();
  try {
    const config = join(dir, "config"), project = join(dir, "project");
    mkdirSync(config); mkdirSync(join(project, ".claude"), { recursive: true });
    const env = { CLAUDE_CONFIG_DIR: config };
    const input = { model: { id: "claude-opus-5-5" }, workspace: { project_dir: project } };
    assert.equal(autoCompactWindowFor(input, env), null); // no settings at all
    writeFileSync(join(config, "settings.json"), JSON.stringify({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: 500000 } } }));
    assert.equal(autoCompactWindowFor(input, env), 500000);
    assert.equal(autoCompactWindowFor({ model: { id: "claude-opus-5-5[1m]" } }, env), 500000);
    assert.equal(autoCompactWindowFor({ model: { id: "claude-sonnet-5-5" } }, env), null);
    writeFileSync(join(project, ".claude/settings.local.json"), JSON.stringify({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: 300000 } } }));
    assert.equal(autoCompactWindowFor(input, env), 300000);
    writeFileSync(join(project, ".claude/settings.json"), "{ not json");
    assert.equal(autoCompactWindowFor(input, env), 300000);
    writeFileSync(join(project, ".claude/settings.local.json"), JSON.stringify({ autoCompactEnabled: false }));
    assert.equal(autoCompactWindowFor(input, env), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("auto-compact window: Claude Code's sources and order (review cases A-E)", () => {
  const dir = temp();
  try {
    const config = join(dir, "config"), project = join(dir, "project");
    mkdirSync(config); mkdirSync(join(project, ".claude"), { recursive: true });
    const user = join(config, "settings.json"), shared = join(project, ".claude/settings.json"), local = join(project, ".claude/settings.local.json");
    const input = { model: { id: "claude-opus-5-5" }, workspace: { project_dir: project } };
    const env = { CLAUDE_CONFIG_DIR: config };
    const only = (files) => {
      for (const f of [user, shared, local]) rmSync(f, { force: true });
      for (const [f, o] of files) writeFileSync(f, JSON.stringify(o));
    };
    const perModel = (w) => ({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: w } } });
    // A: a top-level window (what /autocompact saved before 2.1.288) applies to every model.
    only([[user, { autoCompactWindow: 400000 }]]);
    assert.equal(autoCompactWindowFor(input, env), 400000);
    // B: a higher file's top-level window beats a lower file's model entry.
    only([[user, perModel(500000)], [shared, { autoCompactWindow: 300000 }]]);
    assert.equal(autoCompactWindowFor(input, env), 300000);
    // C: "auto" in a higher file is the model's tuned window: not known here, so no distance.
    only([[user, perModel(500000)], [local, perModel("auto")]]);
    assert.equal(autoCompactWindowFor(input, env), null);
    // D: CLAUDE_CODE_AUTO_COMPACT_WINDOW beats every settings file.
    only([[user, perModel(500000)]]);
    assert.equal(autoCompactWindowFor(input, { ...env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000" }), 200000);
    // E: DISABLE_AUTO_COMPACT turns auto-compact off whatever else is set; DISABLE_COMPACT too.
    assert.equal(autoCompactWindowFor(input, { ...env, DISABLE_AUTO_COMPACT: "1" }), null);
    assert.equal(autoCompactWindowFor(input, { ...env, DISABLE_COMPACT: "1", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200k" }), null);
    assert.equal(autoCompactWindowFor(input, { ...env, DISABLE_AUTO_COMPACT: "0" }), 500000);
    // Within one file the model's entry beats the top-level key; another model falls back to it.
    only([[user, { autoCompactWindow: 400000, ...perModel(500000) }]]);
    assert.equal(autoCompactWindowFor(input, env), 500000);
    assert.equal(autoCompactWindowFor({ model: { id: "claude-sonnet-5-5" } }, env), 400000);
    // An unusable variable is ignored, as Claude Code ignores it, and the settings decide.
    assert.equal(autoCompactWindowFor(input, { ...env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "auto" }), 500000);
    // autoCompactEnabled false in any file turns it off, the variable included; the window is
    // capped at the context window.
    only([[user, perModel(500000)], [shared, { autoCompactEnabled: false }]]);
    assert.equal(autoCompactWindowFor(input, { ...env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000" }), null);
    only([[user, perModel(500000)]]);
    assert.equal(autoCompactWindowFor({ ...input, context_window: { context_window_size: 200000 } }, env), 200000);
    // A non-number window in the deciding file is no window.
    only([[user, perModel("500k")]]);
    assert.equal(autoCompactWindowFor(input, env), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("local settings: read at the repository root, the main checkout's root for a worktree", () => {
  const dir = temp();
  try {
    // main/ is a checkout; wt/ a linked worktree of it (a .git file, relative gitdir, commondir);
    // main/sub a submodule (a .git file, no commondir); bare.git a bare repository's worktree.
    const main = join(dir, "main"), wt = join(dir, "wt"), sub = join(main, "sub"), bareWt = join(dir, "bare-wt");
    mkdirSync(join(main, ".git/worktrees/wt"), { recursive: true });
    mkdirSync(join(main, ".git/modules/sub"), { recursive: true });
    mkdirSync(join(wt, "deep/er"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(dir, "bare.git/worktrees/b"), { recursive: true });
    mkdirSync(bareWt);
    writeFileSync(join(wt, ".git"), "gitdir: ../main/.git/worktrees/wt\n");
    writeFileSync(join(main, ".git/worktrees/wt/commondir"), "../..\n");
    writeFileSync(join(sub, ".git"), `gitdir: ${join(main, ".git/modules/sub")}\n`);
    writeFileSync(join(bareWt, ".git"), `gitdir: ${join(dir, "bare.git/worktrees/b")}\n`);
    writeFileSync(join(dir, "bare.git/worktrees/b/commondir"), "../..\n");
    assert.equal(localSettingsRoot(main), main);
    assert.equal(localSettingsRoot(join(main, "sub")), sub);
    assert.equal(localSettingsRoot(wt), main);
    assert.equal(localSettingsRoot(join(wt, "deep/er")), main);
    // The cases where the file stays in the launch folder.
    assert.equal(localSettingsRoot(dir), null); // no repository
    assert.equal(localSettingsRoot(bareWt), null);
    assert.equal(localSettingsRoot(wt, { os: "win32" }), null);
    assert.equal(localSettingsRoot(wt, { home: main }), null);
    assert.equal(localSettingsRoot(wt, { uid: process.getuid() + 1 }), null);
    for (const bad of [undefined, "", 42]) assert.equal(localSettingsRoot(bad), null);

    // autoCompactWindowFor in the worktree: the root's local file first, then one an older
    // version left in the launch folder, then the launch folder's shared file.
    const config = join(dir, "config");
    mkdirSync(config); mkdirSync(join(main, ".claude")); mkdirSync(join(wt, ".claude"));
    const window = (n) => JSON.stringify({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: n } } });
    const input = { model: { id: "claude-opus-5-5" }, workspace: { project_dir: wt } };
    const env = { CLAUDE_CONFIG_DIR: config };
    writeFileSync(join(wt, ".claude/settings.json"), window(500000));
    assert.equal(autoCompactWindowFor(input, env), 500000);
    writeFileSync(join(wt, ".claude/settings.local.json"), window(400000));
    assert.equal(autoCompactWindowFor(input, env), 400000);
    writeFileSync(join(main, ".claude/settings.local.json"), window(300000));
    assert.equal(autoCompactWindowFor(input, env), 300000);
    writeFileSync(join(main, ".claude/settings.local.json"), JSON.stringify({ autoCompactEnabled: false }));
    assert.equal(autoCompactWindowFor(input, env), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLAUDE_CODE_AUTO_COMPACT_WINDOW reads counts and k/M, held to 100k-1M", () => {
  assert.deepEqual(["200000", "200k", " 1M ", "1.5M", "200", "0", "-5", "auto", "", undefined].map(envWindow),
    [200000, 200000, 1000000, 1000000, 100000, null, null, null, null, null]);
});

test("the command under a bare PATH, alone and wrapped by the limits logger", () => {
  const dir = temp();
  try {
    const config = join(dir, "config"), state = join(dir, "state"), project = join(dir, "project");
    mkdirSync(config);
    writeFileSync(join(config, "settings.json"), JSON.stringify({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: 500000 } } }));
    // The bot lookup's launcher where install.sh links it: ~/.local/bin/automagik-herdr.
    mkdirSync(join(project, ".herdr"), { recursive: true });
    writeFileSync(join(project, ".herdr/bots.json"), JSON.stringify({ bots: [{ id: "b-one", name: "Meter Captain" }] }));
    mkdirSync(join(dir, ".local/bin"), { recursive: true });
    const herdr = fakeHerdr(join(dir, ".local/bin"), { t1: { terminal: "t1", bot: "b-one", project } });
    const input = { ...fixture("mid-session-quota"), rate_limits: undefined };
    const env = { PATH: "/usr/bin:/bin", HOME: dir, CLAUDE_CONFIG_DIR: config, METER_STATE_DIR: state, NO_COLOR: "1", COLUMNS: "200" };
    const run = (args, stdin, extra = {}) => spawnSync(process.execPath, args, { input: stdin, env: { ...env, ...extra }, encoding: "utf8" });
    const statusline = here("../automagik-statusline.mjs");
    const expected = "🧠 Opus 5.5 ⚡high  ┃  📁 api  ┃  💬 ▰▰▰▰▱▱▱▱▱▱ 400k/1M\n";

    // Outside Herdr: no bot, and the launcher is not run.
    const alone = run([statusline], JSON.stringify(input));
    assert.equal(alone.status, 0, alone.stderr);
    assert.equal(alone.stdout, expected);
    assert.equal(alone.stderr, "");
    assert.equal(herdr.calls(), 0);

    // In a Herdr pane: the bot's name, asked once, then from the cache.
    for (let n = 0; n < 2; n++) {
      const inPane = run([statusline], JSON.stringify(input), { HC_TERMINAL_ID: "t1" });
      assert.equal(inPane.status, 0, inPane.stderr);
      assert.equal(inPane.stdout, `🤖 Meter Captain  ${expected}`);
    }
    assert.equal(herdr.calls(), 1);

    // Colours on without NO_COLOR: 400k of the 500k compact window is yellow.
    const { NO_COLOR, ...colourEnv } = env;
    const coloured = spawnSync(process.execPath, [statusline], { input: JSON.stringify(input), env: colourEnv, encoding: "utf8" });
    assert.equal(NO_COLOR, "1");
    assert.match(coloured.stdout, /\x1b\[33m▰▰▰▰▱▱▱▱▱▱\x1b\[0m \x1b\[33m400k\x1b\[0m\x1b\[2m\/1M\x1b\[0m/);

    const logger = here("../claude-limits-statusline.mjs");
    const wrapped = run([logger, "--", process.execPath, statusline], JSON.stringify(input));
    assert.equal(wrapped.status, 0, wrapped.stderr);
    assert.equal(wrapped.stdout, expected);

    // The settings.json form, run through a shell as Claude Code runs it: node X -- node Y.
    const q = (s) => `'${s.replaceAll("'", "'\\''")}'`;
    const settingsForm = `${q(process.execPath)} ${q(logger)} -- ${q(process.execPath)} ${q(statusline)}`;
    const viaShell = spawnSync("/bin/sh", ["-c", settingsForm], { input: JSON.stringify(input), env, encoding: "utf8" });
    assert.equal(viaShell.status, 0, viaShell.stderr);
    assert.equal(viaShell.stdout, expected);

    // Each word after -- stays one argument: no second shell splits "a b" or reads "$HOME".
    const echo = "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{console.log(JSON.stringify([process.argv.slice(1),s]));process.exit(3)})";
    const args = run([logger, "--", process.execPath, "-e", echo, "a b", "$HOME", "it's"], "stdin");
    assert.equal(args.status, 3, args.stderr);
    assert.deepEqual(JSON.parse(args.stdout), [["a b", "$HOME", "it's"], "stdin"]);
    // No command after --, or one that does not exist: the logger still exits quietly.
    for (const tail of [[], ["--"], ["--", join(dir, "no such program")]]) {
      const r = run([logger, ...tail], JSON.stringify(input));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "");
    }

    for (const garbage of ["", "not json", "[]", "null"]) {
      const r = run([statusline], garbage);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "Claude\n");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the state folder: the meter's own rule, METER_STATE_DIR first; the old folder only without it", () => {
  assert.equal(stateDir({ HOME: "/h" }), "/h/.automagik/meter");
  assert.equal(stateDir({ HOME: "/h", AM_HOME: "/am" }), "/am/meter");
  assert.equal(stateDir({ HOME: "/h", AM_HOME: "am" }), "/h/.automagik/meter", "a relative AM_HOME is ignored, as the meter ignores it");
  assert.equal(stateDir({ HOME: "/h", AM_HOME: "/am", METER_STATE_DIR: "/s" }), "/s");
  assert.equal(legacyStateDir({ HOME: "/h" }, "linux"), "/h/.local/state/automagik");
  assert.equal(legacyStateDir({ HOME: "/h", XDG_STATE_HOME: "/x" }, "linux"), "/x/automagik");
  assert.equal(legacyStateDir({ HOME: "/h", XDG_STATE_HOME: "x" }, "linux"), "/h/.local/state/automagik");
  assert.equal(legacyStateDir({ HOME: "/h", XDG_STATE_HOME: "/x" }, "darwin"), "/h/Library/Application Support/automagik");
  assert.equal(legacyStateDir({ HOME: "/h", METER_STATE_DIR: "/s" }, "linux"), null, "nothing moves with METER_STATE_DIR");
});

const logger = here("../claude-limits-statusline.mjs");
const reading = (pct) => ({ ...fixture("mid-session-quota"), rate_limits: { five_hour: { used_percentage: pct, resets_at: 1_793_810_000 } } });
/** Runs the limits logger alone (no command after --) with exactly `env`. */
const log = (env, pct = 40) => {
  const r = spawnSync(process.execPath, [logger], { input: JSON.stringify(reading(pct)), env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
};
const lines = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("the limits logger writes where the status line reads, for each rule", () => {
  const dir = temp();
  try {
    for (const extra of [{}, { AM_HOME: join(dir, "am") }, { AM_HOME: "relative" }, { METER_STATE_DIR: join(dir, "s") }]) {
      const env = { HOME: dir, ...extra };
      log(env);
      const rows = readLimitsTail(stateDir(env));
      assert.equal(rows.length, 1, JSON.stringify(extra));
      assert.equal(rows[0].five_hour.used_percentage, 40);
      assert.equal(statSync(stateDir(env)).mode & 0o777, 0o700, JSON.stringify(extra));
      assert.equal(statSync(join(stateDir(env), "claude-limits.jsonl")).mode & 0o777, 0o600);
      rmSync(stateDir(env), { recursive: true, force: true });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a log in the old folder: read, moved once into the new folder, never over one already there", () => {
  const dir = temp();
  try {
    const env = { HOME: dir };
    const old = legacyStateDir(env), now = stateDir(env);
    assert.ok(old && old.startsWith(dir), old);
    mkdirSync(old, { recursive: true });
    const before = [{ ts: iso(1_793_790_000), five_hour: { used_percentage: 10, resets_at: 1_793_810_000 } },
      { ts: iso(1_793_791_000), five_hour: { used_percentage: 12, resets_at: 1_793_810_000 } }];
    writeFileSync(join(old, "claude-limits.jsonl"), before.map((r) => `${JSON.stringify(r)}\n`).join(""), { mode: 0o600 });
    writeFileSync(join(old, "claude-limits.last.json"), JSON.stringify({ key: "an older reading", at: 1 }));
    // The meter's own files and anything else stay: they are the meter's to move.
    for (const name of ["meter.db", "prices.json", "statusline-bots.json"]) writeFileSync(join(old, name), name);

    // Before the logger runs again, the status line reads the old log.
    assert.deepEqual(readLimits(env), before);
    assert.equal(existsSync(now), false);

    log(env, 15);
    assert.deepEqual(readdirSync(old).sort(), ["meter.db", "prices.json", "statusline-bots.json"]);
    const moved = lines(join(now, "claude-limits.jsonl"));
    assert.deepEqual(moved.slice(0, 2), before, "the old readings come along");
    assert.equal(moved.length, 3);
    assert.equal(moved[2].five_hour.used_percentage, 15);
    assert.equal(statSync(now).mode & 0o777, 0o700);
    assert.equal(statSync(join(now, "claude-limits.jsonl")).mode & 0o777, 0o600, "the mode is kept");
    assert.deepEqual(readLimits(env), moved, "read once: nothing is left in the old folder");

    // A log left in the old folder again (another filesystem, an older logger) while the new one has
    // its own: neither is replaced or merged on disk, and the status line reads both.
    const stray = { ts: iso(1_793_792_000), five_hour: { used_percentage: 13, resets_at: 1_793_810_000 } };
    writeFileSync(join(old, "claude-limits.jsonl"), `${JSON.stringify(stray)}\n`);
    log(env, 16);
    assert.deepEqual(lines(join(old, "claude-limits.jsonl")), [stray]);
    assert.equal(lines(join(now, "claude-limits.jsonl")).length, 4);
    assert.deepEqual(readLimits(env), [stray, ...lines(join(now, "claude-limits.jsonl"))]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the old folder is left alone with METER_STATE_DIR, and a link there is never followed", () => {
  const dir = temp();
  try {
    const old = legacyStateDir({ HOME: dir });
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "claude-limits.jsonl"), `${JSON.stringify({ ts: "old" })}\n`);
    const state = join(dir, "s");
    log({ HOME: dir, METER_STATE_DIR: state });
    assert.deepEqual(lines(join(old, "claude-limits.jsonl")), [{ ts: "old" }]);
    assert.deepEqual(readLimits({ HOME: dir, METER_STATE_DIR: state }).length, 1, "only METER_STATE_DIR's log");
    assert.equal(existsSync(join(dir, ".automagik")), false);

    // A link in the old folder stays a link there; the logger starts a log of its own.
    rmSync(join(old, "claude-limits.jsonl"));
    const elsewhere = join(dir, "elsewhere.jsonl");
    writeFileSync(elsewhere, `${JSON.stringify({ ts: "elsewhere" })}\n`);
    symlinkSync(elsewhere, join(old, "claude-limits.jsonl"));
    log({ HOME: dir });
    assert.ok(lstatSync(join(old, "claude-limits.jsonl")).isSymbolicLink());
    assert.equal(lstatSync(join(stateDir({ HOME: dir }), "claude-limits.jsonl")).isFile(), true);
    assert.equal(lines(join(stateDir({ HOME: dir }), "claude-limits.jsonl")).length, 1);
    assert.deepEqual(lines(elsewhere), [{ ts: "elsewhere" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
