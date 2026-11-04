// The status line's formatter against fixture stdin objects (shaped after a real Claude Code
// 2.1.318 statusline input), its settings lookup and compact counter in temp folders, and the
// command end to end under a bare PATH, alone and wrapped by the limits logger.
//   node --test meter/statusline/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { autoCompactWindowFor, countCompacts, envWindow, format, tokens, until } from "../automagik-statusline.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(here(`fixtures/${name}.json`), "utf8"));
const NOW = 1_793_800_000_000;
const plain = { now: NOW, autoCompactWindow: 500_000, color: false };
const temp = () => mkdtempSync(join(tmpdir(), "meter-statusline-"));

test("fixtures: fresh session, 40% with 2 compacts, quota near its limit", () => {
  assert.equal(format(fixture("fresh-session"), { ...plain, compacts: 0 }),
    "Opus 5.5 · my-app | ctx 0% 0/1M · 500k to compact");
  assert.equal(format(fixture("forty-percent-two-compacts"), { ...plain, compacts: 2 }),
    "Opus 5.5 · api | ctx 40% 400k/1M · 100k to compact · 2 compacts | 5h 24% ↺2h14m · 7d 58% ↺4d2h");
  assert.equal(format(fixture("quota-near-limit"), { ...plain, compacts: 1 }),
    "Opus 5.5 · my-app | ctx 47% 472k/1M · 29k to compact · 1 compact | 5h 94% ↺59m · 7d 91% ↺1d1h");
});

test("colour: yellow from 70%, red from 90%, context judged against the compact window", () => {
  const line = format(fixture("quota-near-limit"), { now: NOW, autoCompactWindow: 500_000, compacts: 1 });
  assert.match(line, /\x1b\[31mctx 47% 472k\/1M\x1b\[0m/); // 94% of the 500k compact window
  assert.match(line, /\x1b\[31m5h 94%\x1b\[0m/);
  assert.match(line, /\x1b\[31m7d 91%\x1b\[0m/);
  const forty = format(fixture("forty-percent-two-compacts"), { now: NOW, autoCompactWindow: 500_000 });
  assert.match(forty, /\x1b\[33mctx 40%/); // 80% of the compact window
  assert.doesNotMatch(forty, /\x1b\[3[13]m5h/);
});

test("a narrow terminal gets two lines: the quota moves to the second", () => {
  const line = format(fixture("forty-percent-two-compacts"), { ...plain, compacts: 2, columns: 80 });
  assert.equal(line, "Opus 5.5 · api | ctx 40% 400k/1M · 100k to compact · 2 compacts\n5h 24% ↺2h14m · 7d 58% ↺4d2h");
  assert.equal(format(fixture("forty-percent-two-compacts"), { ...plain, compacts: 2, columns: 200 }).includes("\n"), false);
});

test("missing fields: it prints what it has and never throws", () => {
  for (const input of [null, undefined, "text", 42, [], {}, { model: null, context_window: null, rate_limits: null }]) {
    assert.equal(typeof format(input, plain), "string");
  }
  assert.equal(format({}, plain), "");
  // No auto-compact window: no distance, no guessed default.
  assert.equal(format(fixture("forty-percent-two-compacts"), { now: NOW, color: false }),
    "Opus 5.5 · api | ctx 40% 400k/1M | 5h 24% ↺2h14m · 7d 58% ↺4d2h");
  // One window only, as Claude Code sends once the other has reset; a passed reset shows no timer.
  const real = { model: { id: "claude-opus-5-5", display_name: "Opus 5.5" }, rate_limits: { seven_day: { used_percentage: 58, resets_at: 1_793_700_000 } } };
  assert.equal(format(real, plain), "Opus 5.5 | 7d 58%");
  // Percentage worked out from current_usage when the totals are absent.
  const usage = { context_window: { context_window_size: 200_000, current_usage: { input_tokens: 10, cache_creation_input_tokens: 990, cache_read_input_tokens: 49_000 } } };
  assert.equal(format(usage, { ...plain, autoCompactWindow: null }), "ctx 25% 50k/200k");
  assert.equal(format({ context_window: { total_input_tokens: 520_000, context_window_size: 1_000_000, used_percentage: 52 } }, plain), "ctx 52% 520k/1M · compact due");
});

test("tokens and reset times read short", () => {
  assert.deepEqual([0, 999, 1000, 78_400, 999_400, 1_000_000, 1_250_000].map(tokens), ["0", "999", "1k", "78k", "999k", "1M", "1.3M"]);
  assert.deepEqual([null, -5, 0, 30, 2700, 3600, 7_840, 86_400, 353_600].map(until), [null, null, null, "1m", "45m", "1h00m", "2h11m", "1d0h", "4d2h"]);
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

test("CLAUDE_CODE_AUTO_COMPACT_WINDOW reads counts and k/M, held to 100k-1M", () => {
  assert.deepEqual(["200000", "200k", " 1M ", "1.5M", "200", "0", "-5", "auto", "", undefined].map(envWindow),
    [200000, 200000, 1000000, 1000000, 100000, null, null, null, null, null]);
});

test("compacts: counted from compact_boundary records, then only from the appended bytes", () => {
  const dir = temp();
  try {
    const file = join(dir, "t.jsonl"), state = join(dir, "state");
    const boundary = (n) => JSON.stringify({ type: "system", subtype: "compact_boundary", content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: n } }) + "\n";
    // The words inside a message are escaped JSON: they are no record and are not counted.
    const quoted = JSON.stringify({ type: "user", message: { content: 'grep \'"subtype":"compact_boundary"\' t.jsonl' } }) + "\n";
    writeFileSync(file, `{"type":"user"}\n${boundary(1)}${quoted}${boundary(2)}`);
    assert.equal(countCompacts(file, state), 2);
    assert.equal(countCompacts(file, state), 2); // unchanged: served from the cache
    const cached = JSON.parse(readFileSync(join(state, "statusline-compacts.json"), "utf8"))[file];
    assert.equal(cached.offset, cached.size);
    // A record half written when the status line runs is counted once it is complete.
    const third = boundary(3);
    appendFileSync(file, third.slice(0, 20));
    assert.equal(countCompacts(file, state), 2);
    appendFileSync(file, third.slice(20));
    assert.equal(countCompacts(file, state), 3);
    // A shorter file (replaced or rewritten) is counted again from the start.
    writeFileSync(file, boundary(9));
    assert.equal(countCompacts(file, state), 1);
    // Rewritten in place (same inode) and grown past the cached offset: counted again from the
    // start, not from the old offset. The same goes for a rewrite that keeps the size.
    writeFileSync(file, `${boundary(1)}${boundary(2)}${boundary(3)}`);
    assert.equal(countCompacts(file, state), 3);
    const ino = statSync(file).ino;
    const longer = `${JSON.stringify({ type: "user", message: { content: "x".repeat(600) } })}\n${boundary(4)}`;
    writeFileSync(file, longer);
    assert.equal(statSync(file).ino, ino);
    assert.equal(countCompacts(file, state), 1);
    writeFileSync(file, longer.replace('"subtype":"compact_boundary"', '"subtype":"compact_boundarY"'));
    assert.equal(statSync(file).ino, ino);
    assert.equal(countCompacts(file, state), 0);
    // A cache entry from before the check (no hash) is counted again once.
    writeFileSync(file, boundary(9));
    const stale = { [file]: { ino: statSync(file).ino, size: 0, offset: 0, count: 5, at: Date.now() } };
    writeFileSync(join(state, "statusline-compacts.json"), JSON.stringify(stale));
    assert.equal(countCompacts(file, state), 1);
    // A corrupt cache is rebuilt; a missing transcript has no count.
    writeFileSync(join(state, "statusline-compacts.json"), "garbage");
    assert.equal(countCompacts(file, state), 1);
    assert.equal(countCompacts(join(dir, "missing.jsonl"), state), null);
    assert.equal(countCompacts(undefined, state), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the command under a bare PATH, alone and wrapped by the limits logger", () => {
  const dir = temp();
  try {
    const config = join(dir, "config"), state = join(dir, "state"), transcript = join(dir, "t.jsonl");
    mkdirSync(config);
    writeFileSync(join(config, "settings.json"), JSON.stringify({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: 500000 } } }));
    writeFileSync(transcript, `${JSON.stringify({ type: "system", subtype: "compact_boundary" })}\n`.repeat(2));
    const input = { ...fixture("forty-percent-two-compacts"), transcript_path: transcript, rate_limits: undefined };
    const env = { PATH: "/usr/bin:/bin", HOME: dir, CLAUDE_CONFIG_DIR: config, METER_STATE_DIR: state, NO_COLOR: "1", COLUMNS: "200" };
    const run = (args, stdin) => spawnSync(process.execPath, args, { input: stdin, env, encoding: "utf8" });
    const statusline = here("../automagik-statusline.mjs");
    const expected = "Opus 5.5 · api | ctx 40% 400k/1M · 100k to compact · 2 compacts\n";

    const alone = run([statusline], JSON.stringify(input));
    assert.equal(alone.status, 0, alone.stderr);
    assert.equal(alone.stdout, expected);
    assert.equal(alone.stderr, "");

    const wrapped = run([here("../claude-limits-statusline.mjs"), "--", `'${process.execPath}' '${statusline}'`], JSON.stringify(input));
    assert.equal(wrapped.status, 0, wrapped.stderr);
    assert.equal(wrapped.stdout, expected);

    for (const garbage of ["", "not json", "[]", "null"]) {
      const r = run([statusline], garbage);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "Claude\n");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
