// The fleet coverage record (RFC 0026 (e), delivery 5; test T5): the sidebar's meter run asks
// each machine's usagemeter for its bot-tag coverage and writes one record beside the install
// record. A fake fleet (a fake exec, no hc, no real usagemeter, no live Herdr): two machines sum
// token-weighted, a failing machine is in `missing` with its exit or `timeout`, one outside the
// scope is `out_of_scope`, a bot on two machines joins on its id, nothing a meter prints beyond
// the checked fields reaches the record, and the record and the example validate against
// meter/schema/fleet/v1/. The file itself: 0600, replaced in one rename, in a scratch folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { COVERAGE, METER_EVERY_MS, METER_EXEC_LIMIT_MS, SYNC, fleetPath, syncMeter, writeFleetRecord } from "../mods/am-sidebar/meter.js";
import { FLEET_ENTRY_MAX, FLEET_FILE, FLEET_PARTS, FLEET_REASONS, FLEET_RECORD_MAX, FLEET_WINDOW, coverageEntry, exitReason, fleetPlan,
  fleetRatio, fleetRecord, fleetSum, utf8Length } from "../mods/am-sidebar/meterFleet.js";
import { scratchRoot } from "./scratch-project.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA_DIR = join(ROOT, "..", "meter", "schema", "fleet", "v1");
const SCHEMA = JSON.parse(readFileSync(join(SCHEMA_DIR, "fleet-coverage.schema.json"), "utf8"));
const EXAMPLE = JSON.parse(readFileSync(join(SCHEMA_DIR, "examples", "fleet.json"), "utf8"));

// ---- A JSON Schema 2020-12 checker for the keywords the fleet schema uses, and no others ----
const KNOWN = new Set(["$schema", "$id", "$defs", "$ref", "title", "description", "type", "const", "enum", "required", "properties",
  "additionalProperties", "items", "minItems", "maxItems", "pattern", "maxLength", "minimum", "maximum", "anyOf"]);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
function check(schema, value, path = "$", errors = []) {
  for (const k of Object.keys(schema)) assert.ok(KNOWN.has(k), `the checker does not know the keyword ${k} (${path})`);
  if (schema.$ref) {
    assert.match(schema.$ref, /^#\/\$defs\/[a-z_]+$/);
    check(SCHEMA.$defs[schema.$ref.slice("#/$defs/".length)], value, path, errors);
  }
  const t = typeOf(value);
  if (schema.type) {
    const types = [schema.type].flat();
    if (!types.some((want) => want === t || (want === "number" && t === "integer"))) errors.push(`${path}: is ${t}, not ${types.join("|")}`);
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: is not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of the enum`);
  if (schema.anyOf && !schema.anyOf.some((s) => check(s, value, path, []).length === 0)) errors.push(`${path}: matches none of anyOf`);
  if (t === "string") {
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (t === "integer" || t === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (t === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errors));
  }
  if (t === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: no ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) check(schema.properties[k], v, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: ${k} is not a field of the record`);
    }
  }
  return errors;
}
const valid = (record) => assert.deepEqual(check(SCHEMA, record), []);

// ---- What a machine's `usagemeter coverage --window d30 --json` prints (coverage.rs Record) ----
const totalsOf = (attributed, ambiguous, unlinked, before) => ({ attributed, ambiguous, unlinked, before_evidence: before, total: attributed + ambiguous + unlinked + before });
const bot = (id, tokens, basis = "session") => ({ bot: id, tokens, share: 0.1, tokens_by_basis: { session: 0, label: 0, worktree: 0, [basis]: tokens },
  unrecorded: [], tokens_unrecorded: 0, harnesses: ["claude-code"], lower_bound: false });
const repo = (name, totals) => ({ repo: name, state: totals.total > 0 ? "measured" : "no_usage", totals, bot_coverage: fleetRatio(totals.attributed, totals.total) });
function answer({ machine = "core-1", totals, noRecord = totals.unlinked, bots = [], repos = [], window = FLEET_WINDOW, more = {}, windowMore = {} }) {
  const parts = [["ambiguous", "claimants_differ", totals.ambiguous], ["unlinked", "no_record", noRecord], ["unlinked", "dsh_tui_seat", totals.unlinked - noRecord],
    ["unlinked", "other_machine", 0], ["before_evidence", "before_evidence", totals.before_evidence]]
    .map(([state, reason, tokens]) => ({ state, reason, tokens, share: fleetRatio(tokens, totals.total), vouched: true, harnesses: tokens ? ["claude-code"] : [] }));
  return `${JSON.stringify({
    v: 1, generated_at: "2026-01-15T12:04:30Z", meter_version: "0.4.0", schema_version: 3, machine, store: { schema_version: 3, location: "current" },
    counted_from: "2025-12-17T00:00:00Z", records_from: "2025-12-18T00:00:00Z", evidence_from: "2025-12-20T00:00:00Z", complete: true, stale: false,
    as_of: "2026-01-15T12:04:00Z", all_vouch: true, incomplete_sources: [], truncated: false, ...more,
    windows: [{ window, requested_start: "2025-12-16T13:00:00Z", start: "2025-12-17T00:00:00Z", end: "2026-01-15T13:00:00Z", clipped: true, evidence: "partial",
      evidence_from: "2025-12-20T00:00:00Z", complete: true, stale: false, totals, bot_coverage: fleetRatio(totals.attributed, totals.total), inspected: 0.5,
      parts, before_evidence_tagged: 7, no_repo: { tokens: 3, note: "store-wide" }, repos, repos_shown: repos.length, repos_omitted: 0, repos_other: null,
      bots, bots_shown: bots.length, bots_omitted: 0, bots_other: null, truncated: false, ...windowMore }],
  })}\n`;
}
const A_TOTALS = totalsOf(600, 50, 250, 100);   // 1000 tokens, 60% attributed
const B_TOTALS = totalsOf(100, 0, 900, 8000);   // 9000 tokens, 1.11% attributed
const HERE = answer({ machine: "core-1", totals: A_TOTALS, noRecord: 200, bots: [bot("b-atlasaaaaa", 400), bot("b-hedgeaaaaa", 200, "worktree")],
  repos: [repo("example.com/acme/widgets", A_TOTALS)] });
const LIN = answer({ machine: "core-2", totals: B_TOTALS, bots: [bot("b-atlasaaaaa", 90, "label"), bot("b-scoutaaaaa", 10, "label")],
  repos: [repo("example.com/acme/widgets", totalsOf(60, 0, 900, 8000)), repo("example.com/acme/gears", totalsOf(40, 0, 0, 0))] });

/** A fake fleet: `machines` { name: stdout | { code } | "hang" | "offline" }; the calls, and what was written. */
function fakeFleet(machines, { here = HERE } = {}) {
  const calls = [], written = [], timers = [];
  const reply = (what) => {
    if (what === "hang") return new Promise(() => {});
    if (what === "offline") return Promise.reject(new Error("the machine is unreachable"));
    if (typeof what === "string") return Promise.resolve({ code: 0, stdout: what, stderr: "" });
    return Promise.resolve({ code: what.code, stdout: "", stderr: what.stderr ?? "" });
  };
  const exec = (command, args, opts = {}) => {
    const script = args[1] === SYNC ? "sync" : args[1] === COVERAGE ? "coverage" : "other";
    calls.push([opts.on ?? "here", script]);
    if (script === "sync") return machines[opts.on] === "hang-sync" ? new Promise(() => {}) : Promise.resolve({ code: 0, stdout: "", stderr: "" });
    return reply(opts.on ? machines[opts.on] : here);
  };
  // The caller's timer: a machine's limit fires at once when it is the one the run waits on.
  const sleep = (ms) => { timers.push(ms); return new Promise((done) => setTimeout(done, 20)); };
  return { calls, written, timers, exec, sleep, write: async (text) => { written.push(text); return true; } };
}

test("T5: the fleet step writes one record: who answered, who did not and why, and who is out of scope", async () => {
  const f = fakeFleet({ lin: LIN, far: "hang", old: { code: 2, stderr: "meter: unknown command \"coverage\"" }, empty: { code: 10 }, bare: { code: 127 }, gone: "offline" });
  const r = await syncMeter({ exec: f.exec, bin: "/h/.local/bin/usagemeter", now: () => Date.parse("2026-01-15T12:10:00Z"), sleep: f.sleep,
    machines: ["lin", "far", "old", "empty", "bare", "gone"], fleet: { write: f.write, disconnected: ["away"], outOfScope: ["guest"] } });
  // One machine at a time: its sync, then its coverage, this computer first.
  assert.deepEqual(f.calls, [["here", "sync"], ["here", "coverage"], ...["lin", "far", "old", "empty", "bare", "gone"].flatMap((m) => [[m, "sync"], [m, "coverage"]])]);
  assert.ok(f.timers.every((ms) => ms === METER_EXEC_LIMIT_MS), "the coverage run shares the sync's 30 s cap: one timer per machine");
  assert.equal(f.timers.length, 7);
  assert.deepEqual(r, { started: true, code: 0, wait: METER_EVERY_MS, on: { lin: 0, far: 0, old: 0, empty: 0, bare: 0, gone: 0 },
    coverage: { answered: 2, machines: 8, written: true } });
  assert.equal(f.written.length, 1, "one record a run, the latest only");
  const record = JSON.parse(f.written[0]);
  valid(record);
  assert.equal(record.v, 1);
  assert.equal(record.window, "d30");
  assert.equal(record.generated_at, "2026-01-15T12:10:00.000Z");
  assert.deepEqual(record.machines.map((m) => [m.machine, m.here, m.machine_id]), [["local", true, "core-1"], ["lin", false, "core-2"]]);
  // A machine that fails is named with its exit or `timeout`; none of them is an entry with 0 tokens.
  assert.deepEqual(record.missing, [
    { machine: "far", here: false, reason: "timeout" },
    { machine: "old", here: false, reason: "no_coverage", exit: 2 },
    { machine: "empty", here: false, reason: "no_store", exit: 10 },
    { machine: "bare", here: false, reason: "no_meter", exit: 127 },
    { machine: "gone", here: false, reason: "unreachable" },
    { machine: "away", here: false, reason: "disconnected" },
  ]);
  assert.deepEqual(record.out_of_scope, ["guest"]);
  assert.deepEqual(record.machines[0].totals, A_TOTALS);
  assert.equal(record.machines[0].bot_coverage, 0.6);
  assert.equal(record.machines[1].bot_coverage, 0.0111);
  assert.deepEqual(record.machines[0].parts, [
    { state: "ambiguous", reason: "claimants_differ", tokens: 50 }, { state: "unlinked", reason: "no_record", tokens: 200 },
    { state: "unlinked", reason: "dsh_tui_seat", tokens: 50 }, { state: "unlinked", reason: "other_machine", tokens: 0 },
    { state: "before_evidence", reason: "before_evidence", tokens: 100 }]);

  // The fleet number: over the summed tokens, never the mean of the machines' ratios.
  const sum = fleetSum(record);
  assert.deepEqual(sum.totals, totalsOf(700, 50, 1150, 8100));
  assert.equal(sum.bot_coverage, 0.07);
  assert.notEqual(sum.bot_coverage, fleetRatio(0.6 + 0.0111, 2), "not the mean of 0.6 and 0.0111");
  assert.equal(sum.inspected, fleetRatio(700, 1900));
  assert.equal(sum.over, "over 2 of 8 machines");
  assert.deepEqual([sum.answered, sum.machines], [2, 8]);
  assert.deepEqual(sum.missing, ["far", "old", "empty", "bare", "gone", "away"]);
  assert.deepEqual(sum.out_of_scope, ["guest"], "apart from missing, and not one of the 8");
  assert.equal(sum.lower_bound, true, "a clipped window: the token totals are at least, the ratio is over counted usage");
  assert.deepEqual(sum.parts.map((p) => [p.reason, p.tokens]), [["claimants_differ", 50], ["no_record", 1100], ["dsh_tui_seat", 50], ["other_machine", 0], ["before_evidence", 8100]]);
  assert.equal(sum.parts.reduce((n, p) => n + p.tokens, 0) + sum.totals.attributed, sum.totals.total, "the classes and attributed are the total");
  // A bot on two machines joins on its id; its tie mix adds by basis.
  assert.deepEqual(sum.bots.map((b) => [b.bot, b.tokens, b.machines]), [["b-atlasaaaaa", 490, ["local", "lin"]], ["b-hedgeaaaaa", 200, ["local"]], ["b-scoutaaaaa", 10, ["lin"]]]);
  assert.deepEqual(sum.bots[0].tokens_by_basis, { session: 400, label: 90, worktree: 0 });
  assert.equal(sum.bots.reduce((n, b) => n + b.share, 0).toFixed(4), "0.0700", "the bot shares add up to the fleet coverage");
  assert.deepEqual(sum.repos.map((r) => [r.repo, r.totals.total, r.machines]), [["example.com/acme/widgets", 9960, ["local", "lin"]], ["example.com/acme/gears", 40, ["lin"]]]);
  assert.equal(sum.repos[0].bot_coverage, fleetRatio(660, 9960));
});

test("T5: a machine whose sync used up its 30 s is not asked: timeout; this computer failing is named too", async () => {
  const f = fakeFleet({ slow: "hang-sync", lin: LIN }, { here: { code: 11 } });
  const r = await syncMeter({ exec: f.exec, bin: "/b", sleep: f.sleep, machines: ["slow", "lin"], fleet: { write: f.write } });
  assert.deepEqual(f.calls, [["here", "sync"], ["here", "coverage"], ["slow", "sync"], ["lin", "sync"], ["lin", "coverage"]]);
  assert.equal(r.on.slow, "timed out");
  const record = JSON.parse(f.written[0]);
  valid(record);
  assert.deepEqual(record.missing, [{ machine: "local", here: true, reason: "locked", exit: 11 }, { machine: "slow", here: false, reason: "timeout" }]);
  assert.deepEqual(record.machines.map((m) => m.machine), ["lin"]);
  assert.equal(fleetSum(record).over, "over 1 of 3 machines");
  assert.deepEqual(fleetSum(record).totals, B_TOTALS, "the missing machines add nothing, not a 0 share");
});

test("T5: no fleet asked (no scope, or none): the run is the sync alone, no coverage and no record", async () => {
  const f = fakeFleet({ lin: LIN });
  const r = await syncMeter({ exec: f.exec, bin: "/b", sleep: f.sleep, machines: ["lin"] });
  assert.deepEqual(f.calls, [["here", "sync"], ["lin", "sync"]]);
  assert.deepEqual(r, { started: true, code: 0, wait: METER_EVERY_MS, on: { lin: 0 } });
  // A write that fails or throws is silent, and the next run is due as usual.
  for (const write of [async () => false, async () => { throw new Error("disk"); }]) {
    const again = await syncMeter({ exec: f.exec, bin: "/b", sleep: f.sleep, machines: [], fleet: { write } });
    assert.deepEqual(again, { started: true, code: 0, wait: METER_EVERY_MS, coverage: { answered: 1, machines: 1, written: false } });
  }
  // A name the record cannot hold is synced as before and is in none of the record's lists.
  const odd = fakeFleet({ "bad name": LIN });
  await syncMeter({ exec: odd.exec, bin: "/b", machines: ["bad name"], fleet: { write: odd.write } });
  assert.deepEqual(odd.calls, [["here", "sync"], ["here", "coverage"], ["bad name", "sync"]]);
  valid(JSON.parse(odd.written[0]));
});

test("T5 leak: no session id, request hash, path or raw log id reaches the record, whatever a meter answers", () => {
  const SECRET = ["0f3c9a52-7b1e-4c7d-9a55-1c2d3e4f5a6b", "a".repeat(64), "/home/someone/project/.claude/session.jsonl", "rollout-2026-01-15T12-00-00-raw-log-id"];
  const more = { session_id: SECRET[0], request_sha256: SECRET[1], state_dir: SECRET[2], log: SECRET[3], sessions: [SECRET[0]] };
  const spiced = (b) => ({ ...b, session: SECRET[0], request_sha256: SECRET[1], cwd: SECRET[2], log_id: SECRET[3] });
  const out = answer({ totals: A_TOTALS, more, windowMore: { ...more, no_repo: { tokens: 3, note: SECRET[2] } },
    bots: [spiced(bot("b-atlasaaaaa", 600))], repos: [spiced(repo("example.com/acme/widgets", A_TOTALS))] });
  const { entry } = coverageEntry("lin", out);
  assert.ok(entry, "the checked fields are still read");
  const text = JSON.stringify(fleetRecord({ generatedAt: "2026-01-15T12:10:00.000Z", answers: [{ machine: "lin", entry }] }));
  for (const s of SECRET) assert.equal(text.includes(s), false, `${s} leaked`);
  assert.doesNotMatch(text, /session_id|request_sha256|cwd|log_id|state_dir|"\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64}/);
  valid(JSON.parse(text));
  // Every key of an entry is one the schema names: nothing is passed through.
  assert.deepEqual(Object.keys(entry).sort(), [...SCHEMA.$defs.entry.required].sort());
  // A value that would itself be a path, in a field that is kept, makes the whole answer invalid.
  const bad = (over) => coverageEntry("lin", answer({ totals: A_TOTALS, bots: [bot("b-atlasaaaaa", 600)], repos: [repo("example.com/acme/widgets", A_TOTALS)], ...over }));
  assert.deepEqual(bad({ bots: [bot("/home/someone/bot", 600)] }), { reason: "invalid" });
  assert.deepEqual(bad({ bots: [bot("..\\bot", 600)] }), { reason: "invalid" });
  assert.deepEqual(bad({ bots: [bot("b ".repeat(40), 600)] }), { reason: "invalid" });
  assert.deepEqual(bad({ repos: [repo("/home/someone/widgets", A_TOTALS)] }), { reason: "invalid" });
  assert.deepEqual(bad({ repos: [repo("example.com/../../etc", A_TOTALS)] }), { reason: "invalid" });
  assert.deepEqual(bad({ more: { meter_version: "/usr/local/bin/usagemeter" } }), { reason: "invalid" });
  assert.deepEqual(bad({ more: { as_of: "/var/log/meter" } }), { reason: "invalid" });
  // A store's own machine name that reads as a path is dropped (null), not copied.
  assert.equal(bad({ machine: "/home/someone" }).entry.machine_id, null);
});

test("an answer is read only when it is a v1 coverage record for the window whose counts add up", () => {
  const ok = { totals: A_TOTALS, noRecord: 200 };
  assert.ok(coverageEntry("lin", answer(ok)).entry);
  const invalid = (stdout) => assert.deepEqual(coverageEntry("lin", stdout), { reason: "invalid" });
  invalid("");
  invalid("usagemeter 0.3.0\n");
  invalid("[]");
  invalid(answer({ ...ok, more: { v: 2 } }));
  invalid(answer({ ...ok, window: "d7" }));
  invalid(answer({ ...ok, totals: { ...A_TOTALS, total: 999 } }));                       // total is not the four counts
  invalid(answer({ ...ok, totals: { ...A_TOTALS, attributed: -600, total: -200 } }));
  invalid(answer({ ...ok, totals: { ...A_TOTALS, attributed: 600.5 } }));
  invalid(answer({ ...ok, totals: { ...A_TOTALS, attributed: "600" } }));
  invalid(answer({ ...ok, windowMore: { parts: [] } }));
  // A class the record does not know is never dropped: the answer is invalid, not a smaller total.
  const withPart = (edit) => { const j = JSON.parse(answer(ok)); edit(j.windows[0].parts); return JSON.stringify(j); };
  invalid(withPart((p) => { p[1].reason = "new_reason"; }));
  invalid(withPart((p) => { p[1].tokens = 199; }));                                      // unlinked's classes no longer add up
  invalid(withPart((p) => { p.push({ ...p[0] }); }));
  invalid(answer({ ...ok, windowMore: { bots: Array.from({ length: 51 }, (_, i) => bot(`b-${i}`, 1)) } }));
  invalid(answer({ ...ok, windowMore: { complete: "yes" } }));
  invalid(answer({ ...ok, windowMore: { evidence: "some" } }));
  invalid(`${" ".repeat(600 * 1024)}${answer(ok)}`);
  // Exits by name; anything else is `error` with its exit beside it.
  assert.deepEqual([1, 2, 10, 11, 12, 13, 127, 3, null].map((c) => exitReason(c)), [
    { reason: "error", exit: 1 }, { reason: "no_coverage", exit: 2 }, { reason: "no_store", exit: 10 }, { reason: "locked", exit: 11 },
    { reason: "newer_store", exit: 12 }, { reason: "outdated_store", exit: 13 }, { reason: "no_meter", exit: 127 }, { reason: "error", exit: 3 },
    { reason: "error", exit: null }]);
  assert.deepEqual(SCHEMA.$defs.missing.properties.reason.enum, FLEET_REASONS, "the schema's reasons are the pack's");
  assert.deepEqual(SCHEMA.$defs.part.properties.reason.enum, FLEET_PARTS.map((p) => p[1]));
  assert.deepEqual(SCHEMA.properties.window.enum, [FLEET_WINDOW]);
  // Ratios: four decimals, null over nothing, never rounded to 0 above 0.
  assert.deepEqual([fleetRatio(0, 0), fleetRatio(0, 5), fleetRatio(1, 3), fleetRatio(1, 1_000_000)], [null, 0, 0.3333, 0.000001]);
  assert.equal(coverageEntry("lin", answer({ totals: totalsOf(0, 0, 0, 0) })).entry.bot_coverage, null, "no usage is null, never 0");
});

test("the example validates against the schema, sums as its README says, and a record off the contract does not", () => {
  valid(EXAMPLE);
  const sum = fleetSum(EXAMPLE);
  assert.equal(sum.bot_coverage, 0.07);
  assert.equal(sum.over, "over 2 of 5 machines");
  assert.deepEqual(sum.bots.find((b) => b.bot === "b-examplebot1").machines, ["local", "lin"]);
  assert.deepEqual(sum.bots_other, { tokens: 10, tokens_by_basis: { session: 0, label: 10, worktree: 0 } });
  assert.match(readFileSync(join(SCHEMA_DIR, "README.md"), "utf8"), /\(600 \+ 100\) \/ \(1000 \+ 9000\) = 0\.07/);
  for (const e of EXAMPLE.machines) {
    assert.equal(e.bot_coverage, fleetRatio(e.totals.attributed, e.totals.total));
    assert.equal(e.bots.reduce((n, b) => n + b.tokens, 0) + (e.bots_other?.tokens ?? 0), e.totals.attributed);
  }
  const broken = (edit) => { const r = structuredClone(EXAMPLE); edit(r); return check(SCHEMA, r); };
  assert.notDeepEqual(broken((r) => { r.v = 2; }), []);
  assert.notDeepEqual(broken((r) => { r.machines[0].session_id = "x"; }), [], "no field the contract does not name");
  assert.notDeepEqual(broken((r) => { r.machines[0].repos[0].repo = "/home/someone/widgets"; }), []);
  assert.notDeepEqual(broken((r) => { r.machines[0].bots[0].bot = "a/b"; }), []);
  assert.notDeepEqual(broken((r) => { r.missing[0].reason = "asleep"; }), []);
  assert.notDeepEqual(broken((r) => { delete r.out_of_scope; }), []);
  assert.notDeepEqual(broken((r) => { r.machines[0].totals.total = -1; }), []);
  assert.notDeepEqual(broken((r) => { r.machines[0].parts.pop(); }), []);
});

test("the bounds: 64 KiB a machine entry and 1 MiB in all, cut lines counted and summed, never a silent cut", () => {
  // 50 bots and 50 repos with the longest names the contract allows: past 64 KiB as the report gives them.
  const long = (i, n) => `${String(i).padStart(3, "0")}${"世".repeat(n)}`;
  const bots = Array.from({ length: 50 }, (_, i) => bot(long(i, 61), 1000 - i));
  const repos = Array.from({ length: 50 }, (_, i) => repo(`example.com/${long(i, 497)}`, totalsOf(1000 - i, 0, 0, 0)));
  const attributed = bots.reduce((n, b) => n + b.tokens, 0);
  const totals = totalsOf(attributed, 0, 0, 0);
  const { entry } = coverageEntry("lin", answer({ totals, bots, repos }));
  assert.ok(utf8Length(JSON.stringify({ ...entry, bots, repos })) > FLEET_ENTRY_MAX, "the fixture is past the bound uncut");
  assert.ok(utf8Length(JSON.stringify(entry)) <= FLEET_ENTRY_MAX);
  assert.equal(utf8Length(JSON.stringify(entry)), Buffer.byteLength(JSON.stringify(entry)), "bytes, not characters");
  assert.equal(entry.truncated, true);
  assert.ok(entry.bots.length < 50 && entry.repos.length < 50);
  assert.equal(entry.bots.length + entry.bots_omitted, 50);
  assert.equal(entry.repos.length + entry.repos_omitted, 50);
  // The largest lines are the ones kept, and every total still includes every bot and repo.
  assert.equal(entry.bots[0].tokens, 1000);
  assert.equal(entry.bots.reduce((n, b) => n + b.tokens, 0) + entry.bots_other.tokens, attributed);
  assert.equal(entry.repos.reduce((n, r) => n + r.totals.total, 0) + entry.repos_other.totals.total, attributed);
  assert.deepEqual(entry.totals, totals);
  valid(fleetRecord({ generatedAt: "2026-01-15T12:10:00.000Z", answers: [{ machine: "lin", entry }] }));
  // The report's own cap (its `other` lines) is carried and added to.
  const capped = coverageEntry("lin", answer({ totals: totalsOf(700, 0, 0, 0), bots: [bot("b-atlasaaaaa", 600)], repos: [repo("example.com/acme/widgets", totalsOf(600, 0, 0, 0))],
    windowMore: { bots_omitted: 3, bots_other: bot("other", 100, "label"), repos_omitted: 2, repos_other: { ...repo("other", totalsOf(100, 0, 0, 0)), state: "other" }, truncated: true } })).entry;
  assert.deepEqual([capped.truncated, capped.bots_omitted, capped.bots_other, capped.repos_omitted, capped.repos_other.totals.total],
    [true, 3, { tokens: 100, tokens_by_basis: { session: 0, label: 100, worktree: 0 } }, 2, 100]);

  // 1 MiB in all: 40 machines of ~60 KiB each are cut, largest first, and the fleet sum is unchanged.
  const full = Array.from({ length: 40 }, (_, i) => ({ machine: `m${i}`, entry: { ...entry, machine: `m${i}` } }));
  const record = fleetRecord({ generatedAt: "2026-01-15T12:10:00.000Z", answers: full });
  assert.ok(utf8Length(JSON.stringify(record)) <= FLEET_RECORD_MAX);
  valid(record);
  assert.equal(record.machines.length, 40);
  assert.ok(record.machines.every((m) => m.truncated));
  const sum = fleetSum(record);
  assert.equal(sum.totals.attributed, attributed * 40);
  assert.equal(sum.bots.reduce((n, b) => n + b.tokens, 0) + sum.bots_other.tokens, attributed * 40);
  assert.equal(sum.bot_coverage, 1);
  // Past what cutting lists can do, an entry leaves for `missing` (record_full), last first: named, not dropped.
  const bare = { ...entry, bots: [], repos: [] };
  const many = Array.from({ length: 1500 }, (_, i) => ({ machine: `m${i}`, entry: { ...bare, machine: `m${i}` } }));
  const tight = fleetRecord({ generatedAt: "2026-01-15T12:10:00.000Z", answers: many });
  assert.ok(utf8Length(JSON.stringify(tight)) <= FLEET_RECORD_MAX);
  assert.equal(tight.machines.length + tight.missing.length, 1500);
  assert.ok(tight.missing.length > 0 && tight.missing.every((m) => m.reason === "record_full"));
  assert.equal(tight.machines[0].machine, "m0");
});

test("fleetPlan: in scope and connected is asked, in scope and away is missing, the rest is out of scope", () => {
  const machines = [{ name: "lin", state: "connected" }, { name: "away", state: "disconnected" }, { name: "guest", state: "connected" },
    { name: "tmp", state: "connected", temporary: true }, { name: "bad name", state: "connected" }, null];
  assert.deepEqual(fleetPlan(machines, "all"), { ask: ["lin", "guest"], disconnected: ["away"], outOfScope: [] });
  assert.deepEqual(fleetPlan(machines, "local", ["lin", "away"]), { ask: ["lin"], disconnected: ["away"], outOfScope: ["guest"] });
  assert.deepEqual(fleetPlan(machines, "local"), { ask: [], disconnected: [], outOfScope: ["lin", "away", "guest"] });
  assert.deepEqual(fleetPlan(machines, "none", ["lin"]), { ask: [], disconnected: [], outOfScope: ["lin", "away", "guest"] });
  assert.deepEqual(fleetPlan(null, "all"), { ask: [], disconnected: [], outOfScope: [] });
});

test("COVERAGE on a machine: no usagemeter is exit 127; one there runs `coverage --window d30 --json` and its exit is the answer's", (t) => {
  const root = scratchRoot(t, "am-cover-");
  const home = join(root, "home"), bin = join(home, ".local", "bin"), log = join(root, "args.log");
  mkdirSync(home, { recursive: true });
  const run = (args = []) => spawnSync("sh", ["-c", COVERAGE, ...args], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
  assert.equal(run().status, 127);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "usagemeter"), `#!/bin/sh\necho "$*" >> "${log}"\necho '{"v":1}'\nexit 11\n`);
  chmodSync(join(bin, "usagemeter"), 0o755);
  const there = run();
  assert.deepEqual([there.status, there.stdout], [11, "{\"v\":1}\n"]);
  // Here: Herdr's absolute path is the binary run, never the default beside it.
  const named = join(root, "named-usagemeter");
  writeFileSync(named, `#!/bin/sh\necho "named $*" >> "${log}"\n`);
  chmodSync(named, 0o755);
  assert.equal(run(["sh", named]).status, 0);
  assert.equal(readFileSync(log, "utf8"), "coverage --window d30 --json\nnamed coverage --window d30 --json\n");
});

test("the record's file: beside the install record, 0600, replaced in one rename, no scratch left; never through a link", async (t) => {
  const root = scratchRoot(t, "am-fleet-file-");
  const app = join(root, "app"), dir = join(app, "automagik-herdr");
  const exec = (command, args) => new Promise((done) => {
    const r = spawnSync(command, args, { encoding: "utf8" });
    done({ code: r.status, stdout: r.stdout, stderr: r.stderr });
  });
  // A mod's writeTextFile: create-only with `before: null`, whatever mode the umask gives.
  const writeText = async (path, text, before) => { assert.equal(before, null); writeFileSync(path, text, { flag: "wx", mode: 0o644 }); };
  const file = fleetPath(`${app}/`);
  assert.equal(file, join(app, FLEET_FILE));
  // No install record's folder: no fleet record, and the folder is not made.
  assert.equal(await writeFleetRecord({ exec, writeText, appHome: app, text: "{}\n" }), false);
  assert.equal(existsSync(dir), false);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "installed-by-install.sh"), "version=9.9.0\n");
  const old = process.umask(0o022);
  t.after(() => process.umask(old));
  assert.equal(await writeFleetRecord({ exec, writeText, appHome: app, text: "{\"v\":1}\n" }), true);
  assert.equal(readFileSync(file, "utf8"), "{\"v\":1}\n");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir).sort(), ["fleet-coverage.json", "installed-by-install.sh"]);
  // Replaced, the latest only; a looser mode left on the old one does not survive.
  chmodSync(file, 0o644);
  assert.equal(await writeFleetRecord({ exec, writeText, appHome: app, text: "{\"v\":1,\"n\":2}\n" }), true);
  assert.equal(readFileSync(file, "utf8"), "{\"v\":1,\"n\":2}\n");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  // A scratch folder a killed run left is cleared; a write that fails leaves the last record and no scratch.
  mkdirSync(join(dir, ".fleet-coverage.tmp"));
  writeFileSync(join(dir, ".fleet-coverage.tmp", "record.json"), "stale");
  assert.equal(await writeFleetRecord({ exec, writeText: async () => { throw new Error("disk"); }, appHome: app, text: "x" }), false);
  assert.equal(readFileSync(file, "utf8"), "{\"v\":1,\"n\":2}\n");
  assert.deepEqual(readdirSync(dir).sort(), ["fleet-coverage.json", "installed-by-install.sh"]);
  // The scratch folder is the owner's alone while the bytes are in it.
  let scratchMode = null;
  await writeFleetRecord({ exec, appHome: app, text: "{}\n", writeText: async (path, text) => { scratchMode = statSync(join(path, "..")).mode & 0o777; writeFileSync(path, text); } });
  assert.equal(scratchMode, 0o700);
  // A link where the record goes is never written through.
  const target = join(root, "elsewhere");
  writeFileSync(target, "theirs");
  execFileSync("rm", ["-f", file]);
  symlinkSync(target, file);
  assert.equal(await writeFleetRecord({ exec, writeText, appHome: app, text: "{\"v\":1}\n" }), false);
  assert.equal(readFileSync(target, "utf8"), "theirs");
  assert.deepEqual(readdirSync(dir).sort(), ["fleet-coverage.json", "installed-by-install.sh"]);
  // exec failing outright is a quiet false.
  assert.equal(await writeFleetRecord({ exec: async () => { throw new Error("no sh"); }, writeText, appHome: app, text: "x" }), false);
});

test("main.js asks the fleet only where the person agreed to usagemeter, and writes through writeFleetRecord", () => {
  const main = readFileSync(join(ROOT, "mods", "am-sidebar", "main.js"), "utf8");
  assert.match(main, /const plan = fleetPlan\(this\.machines, scope, owned\);/);
  assert.match(main, /const fleet = scope === "all" \|\| scope === "local" \? \{ disconnected: plan\.disconnected, outOfScope: plan\.outOfScope,\n\s+write: \(text\) => writeFleetRecord\(\{ exec, writeText: writeTextFile, appHome: appHome\(\), text \}\) \} : null;/);
  assert.match(main, /syncMeter\(\{[^}]*\bfleet \}\)/);
});
