// The deny-by-default hc guard (#624, stopgap C): every allowed verb passes to a stub hc
// unchanged; every refused verb is one stderr line naming #624, #628 and #631 and never calls it;
// send is scoped to the caller's team, widened for a pm, integrator or fixer caller to any bot
// the project lists (its workers do not inherit it), and the declared lead chain reaches a
// planned lead; the dsh-tui worker run shape is exact. Hermetic: a temp app home, a temp project
// and a stub hc on PATH; the real hc is never run. No escape route (an absolute hc path, a raw
// socket, `hc connect`) is tested here: the guard is a guardrail, not a boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { GUARD_DIR, guardPath, workerArgs } from "../mods/am-sidebar/workers.js";
import { startArgs } from "../mods/am-sidebar/launchArgs.js";

const ID = {
  main: "b-aaaaaaaaaa", cap: "b-bbbbbbbbbb", dev: "b-cccccccccc",
  junior: "b-dddddddddd", tester: "b-eeeeeeeeee", other: "b-ffffffffff",
};
const bot = (id, kind, extra = {}) => ({
  id, name: id, kind, look: { character: "star", colour: "blue" }, role: "r", instructions: "i", agent: "dsh-tui", ...extra,
});
const team = () => ({
  version: 1,
  categories: [],
  bots: [
    bot(ID.main, "main", { name: "Main" }),
    bot(ID.cap, "member", { name: "Captain", rank: "captain" }),
    bot(ID.dev, "member", { name: "Dev", lead: ID.cap }),
    bot(ID.junior, "member", { name: "Junior", lead: ID.dev }),
    bot(ID.tester, "member", { name: "Tester", lead: ID.main, rank: "reviewer" }),
    bot(ID.other, "member", { name: "Other", lead: ID.main }),
  ],
});

// The stub: logs every call, answers hc ls/get from the state file, and for any other verb
// prints the pass-through markers and exits HC_STUB_CODE.
const STUB = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.HC_STUB_LOG, JSON.stringify({ argv: args }) + "\\n");
const state = JSON.parse(readFileSync(process.env.HC_STUB_STATE, "utf8"));
if (args[0] === "ls") { process.stdout.write(JSON.stringify({ terminals: state.terminals }) + "\\n"); process.exit(0); }
if (args[0] === "get") {
  const at = args[1];
  const found = state.get[at] ?? Object.values(state.get).find((g) => g.name === at);
  if (!found) { process.stderr.write(JSON.stringify({ error: { kind: "not_found" } }) + "\\n"); process.exit(3); }
  process.stdout.write(JSON.stringify(found) + "\\n"); process.exit(0);
}
process.stdout.write("stub-out " + JSON.stringify(args) + "\\n");
process.stderr.write("stub-err " + args[0] + "\\n");
process.exit(Number(process.env.HC_STUB_CODE ?? 0));
`;

const get = (address, labels, extra = {}) => ({ address, state: "live", created_ms: 100, labels, ...extra });

/** One hermetic scene: temp app home, project, worktree, stub hc and a ledger-bound bot pane. */
function scene(t, { caller = "t100" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hc-guard-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "app"), project = join(root, "project"), bin = join(root, "bin"), home = join(root, "home");
  for (const dir of [app, project, bin, home, join(project, ".herdr"), join(project, ".claude", "worktrees", "wt")]) mkdirSync(dir, { recursive: true });
  const worktree = realpathSync(join(project, ".claude", "worktrees", "wt"));
  writeFileSync(join(project, ".herdr", "bots.json"), `${JSON.stringify(team(), null, 2)}\n`);
  const terminals = [
    { address: "t100", name: "dev", state: "live" }, { address: "t101", name: "cap", state: "live" },
    { address: "t102", name: "junior", state: "live" }, { address: "t103", name: "main", state: "live" },
    { address: "t105", name: "worker", state: "live" }, { address: "t106", name: "reviewer", state: "live" },
    { address: "t107", name: "fixer", state: "live" }, { address: "t108", name: "tester", state: "live" },
    { address: "t110", name: "worker-dev", state: "live" },
    { address: "t120", name: "other", state: "live" }, { address: "t121", name: "bare", state: "live" },
  ];
  const state = {
    terminals,
    get: {
      t100: get("t100", { bot: ID.dev }, { cwd: project }),
      t101: get("t101", { bot: ID.cap }, { cwd: project, name: "cap" }),
      t102: get("t102", { bot: ID.junior }, { cwd: project, name: "junior" }),
      t103: get("t103", { bot: ID.main }, { cwd: project, name: "main" }),
      t105: get("t105", { "worker.of": ID.dev }, { cwd: worktree, name: "worker", parent: "t100" }),
      t106: get("t106", { role: "reviewer" }, { cwd: project, name: "reviewer" }),
      t107: get("t107", { role: "fixer" }, { cwd: project, name: "fixer" }),
      t108: get("t108", { bot: ID.tester }, { cwd: project, name: "tester" }),
      t110: get("t110", { "worker.of": ID.dev }, { cwd: worktree, created_ms: 200, name: "worker-dev" }),
      t120: get("t120", { bot: ID.other }, { cwd: project, name: "other" }),
      t121: get("t121", {}, { cwd: project, name: "bare" }),
      "m/t101": get("m/t101", { bot: ID.cap }, { cwd: project, name: "cap" }),
      "m/t120": get("m/t120", { bot: ID.other }, { cwd: project, name: "other" }),
    },
  };
  const statePath = join(root, "hc-state.json"), logPath = join(root, "hc.log");
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(logPath, "");
  writeFileSync(join(bin, "hc"), STUB);
  chmodSync(join(bin, "hc"), 0o755);
  const ledgerDir = join(app, "automagik-herdr");
  mkdirSync(ledgerDir, { recursive: true });
  if (caller === "t100") {
    const row = { v: 1, event: "attach", bot: ID.dev, project, terminal: "t100", core: "core", created_ms: 100, machine: null,
      at: "2026-11-01T00:00:00.000Z", by: "start" };
    const ledger = join(ledgerDir, "attach.jsonl");
    writeFileSync(ledger, `${JSON.stringify(row)}\n`);
    chmodSync(ledger, 0o600);
  }
  return { root, app, project, bin, home, worktree, statePath, logPath, guard: join(GUARD_DIR, "hc") };
}

const envFor = (s, extra = {}) => ({
  PATH: `${GUARD_DIR}:${s.bin}:${dirname(process.execPath)}`,
  HOME: s.home,
  HERDR_APP_HOME: s.app,
  HC_TERMINAL_ID: "t100",
  HC_STUB_LOG: s.logPath,
  HC_STUB_STATE: s.statePath,
  HC_STUB_CODE: "0",
  ...extra,
});

const guardRun = (s, args, extra = {}) => {
  const r = spawnSync(process.execPath, [s.guard, ...args], { env: envFor(s, extra), encoding: "utf8" });
  return r;
};

const readLog = (s) => readFileSync(s.logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const calls = (s) => readLog(s).map((row) => row.argv);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function assertRefused(r) {
  assert.notEqual(r.status, 0, "a refusal exits non-zero");
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one stderr line: ${JSON.stringify(r.stderr)}`);
  assert.match(r.stderr, /#624/);
  assert.match(r.stderr, /#628/);
  assert.match(r.stderr, /#631/);
  assert.equal(r.stdout, "", "a refusal prints no stdout");
}

// ---- the allow list ----

test("every allowed verb reaches the stub unchanged", (t) => {
  const s = scene(t);
  const allowed = [
    ["send", "t101", "hello"], ["read", "t101"], ["ls"], ["get", "t101"], ["wait", "t101"],
    ["put", "t101", "/tmp/file"], ["label", "t105", "role=dev"], ["kill", "t101"], ["rm", "t101"],
    ["events"], ["schema"], ["templates"],
  ];
  for (const args of allowed) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.ok(calls(s).some((argv) => same(argv, args)), `${args.join(" ")} arrived unchanged: ${JSON.stringify(calls(s))}`);
  }
});

test("the allowed call keeps the stub's stdout, stderr and exit code", (t) => {
  const s = scene(t);
  const r = guardRun(s, ["read", "t101"], { HC_STUB_CODE: "7" });
  assert.equal(r.status, 7);
  assert.equal(r.stdout, 'stub-out ["read","t101"]\n');
  assert.equal(r.stderr, "stub-err read\n");
  assert.deepEqual(calls(s), [["read", "t101"]]);
});

test("the doc-only forms pass; a doc flag on a refused command does not", (t) => {
  const s = scene(t);
  for (const args of [["--help"], ["-h"], ["--version"], ["--skill"]]) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.deepEqual(calls(s), [args]);
  }
  writeFileSync(s.logPath, "");
  const r = guardRun(s, ["exec", "--help"]);
  assertRefused(r);
  assert.deepEqual(calls(s), [], "exec --help is refused before hc");
});

// ---- the refuse list ----

test("every refused verb is one line naming #624, #628 and #631, and the stub is never called", (t) => {
  const s = scene(t);
  const refused = [
    ["exec", "echo", "x"], ["file", "write", "/tmp/x"], ["file", "edit", "/tmp/x", "--old", "a", "--new", "b"],
    ["file", "read", "/tmp/x"], ["machine", "ls"], ["server", "status"], ["update"], ["connect"],
    ["keys", "t101", "enter"], ["attach", "t101"], ["read", "--on", "m", "t101"], ["ls", "--on=m"],
  ];
  for (const args of refused) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assertRefused(r);
    assert.deepEqual(calls(s), [], `${args.join(" ")} never reaches hc`);
  }
});

test("receiving a command without HC_TERMINAL_ID is refused, not passed through", (t) => {
  const s = scene(t);
  const r = guardRun(s, ["ls"], { HC_TERMINAL_ID: "" });
  assertRefused(r);
  assert.deepEqual(calls(s), []);
});

test("no real hc: the guard fails closed with one line", (t) => {
  const s = scene(t);
  const r = spawnSync(process.execPath, [s.guard, "ls"], {
    env: { ...envFor(s), PATH: `${GUARD_DIR}:${dirname(process.execPath)}` }, encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
  assert.match(r.stderr, /#624/);
  assert.match(r.stderr, /#628/);
  assert.match(r.stderr, /#631/);
});

// ---- send: the team, deny by default ----

test("send is allowed to each kind of team target", (t) => {
  const s = scene(t);
  const targets = [
    ["t101", "the lead"], ["t102", "a member"], ["t103", "the main bot"], ["t105", "its own worker"],
    ["t106", "a reviewer"], ["t107", "a fixer"], ["t108", "a reviewer-rank bot"],
    ["m/t101", "a machine address"], ["--on", "m", "t101", "with --on"],
  ];
  for (const target of targets) {
    const args = target[0] === "--on" ? ["send", ...target] : ["send", ...target, "hi"];
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.ok(calls(s).some((argv) => same(argv, args)), `${args.join(" ")} arrived: ${JSON.stringify(calls(s))}`);
  }
});

test("send to a target outside the team or an unresolvable target is refused", (t) => {
  const s = scene(t);
  for (const args of [["send", "t120", "hi"], ["send", "t121", "hi"], ["send", "t999", "hi"], ["send"]]) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assertRefused(r);
    assert.equal(calls(s).some((argv) => argv[0] === "send"), false, `${args.join(" ")} never reaches send`);
  }
});

test("a worker pane sends to its bot through its worker.of label", (t) => {
  const s = scene(t);
  const r = guardRun(s, ["send", "t100", "report"], { HC_TERMINAL_ID: "t110" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(calls(s).some((argv) => same(argv, ["send", "t100", "report"])));
  const bad = guardRun(s, ["send", "t120", "report"], { HC_TERMINAL_ID: "t110" });
  assertRefused(bad);
});

test("a worker's team is the main checkout's, not a bots file in its worktree", (t) => {
  const s = scene(t);
  mkdirSync(join(s.worktree, ".herdr"), { recursive: true });
  writeFileSync(join(s.worktree, ".herdr", "bots.json"), `${JSON.stringify({
    version: 1, categories: [], bots: [bot(ID.other, "main", { name: "Other" })],
  })}\n`);
  const r = guardRun(s, ["send", "t100", "report"], { HC_TERMINAL_ID: "t110" });
  assert.equal(r.status, 0, r.stderr);
});

// ---- send: the shared coordination roles and the declared lead chain ----

const SHARED_ID = {
  pm: "b-gggggggggg", integrator: "b-hhhhhhhhhh", fixer: "b-iiiiiiiiii",
  capB: "b-jjjjjjjjjj", devB: "b-kkkkkkkkkk", testerB: "b-llllllllll",
  plain: "b-mmmmmmmmmm", planned: "b-nnnnnnnnnn", unlisted: "b-oooooooooo",
  capOrch: "b-pppppppppp", capMissing: "b-qqqqqqqqqq",
};
const plannedBot = (id, extra = {}) => ({
  id, name: id, kind: "member", look: { character: "star", colour: "blue" }, role: "r",
  instructions: "i", planned: { wave: 3 }, ...extra,
});
const sharedTeam = () => {
  const file = team();
  file.bots.push(
    bot(SHARED_ID.pm, "member", { name: "PM", rank: "pm", lead: ID.main }),
    bot(SHARED_ID.integrator, "member", { name: "Integrator", rank: "integrator", lead: ID.main }),
    bot(SHARED_ID.fixer, "member", { name: "Fixer", rank: "fixer", lead: ID.main }),
    bot(SHARED_ID.capB, "member", { name: "Captain B", rank: "captain", lead: ID.main }),
    bot(SHARED_ID.devB, "member", { name: "Dev B", rank: "dev", lead: SHARED_ID.capB }),
    bot(SHARED_ID.testerB, "member", { name: "Tester B", rank: "tester", lead: ID.main }),
    bot(SHARED_ID.plain, "member", { name: "Plain", lead: ID.main }),
    plannedBot(SHARED_ID.planned, { name: "Orchestrator" }),
    bot(SHARED_ID.capOrch, "member", { name: "Captain Orch", rank: "captain", lead: SHARED_ID.planned }),
    bot(SHARED_ID.capMissing, "member", { name: "Captain Missing", rank: "captain", lead: SHARED_ID.unlisted }),
  );
  return file;
};

/**
 * The base scene plus the shared roles, another squad, a planned listed bot and an unlisted
 * bot. The shared-role pane labels carry the same rank bots.json does, so a mutant that reads
 * role= still passes the ordinary rows and only the forged-label row catches it.
 */
function sharedScene(t) {
  const s = scene(t);
  writeFileSync(join(s.project, ".herdr", "bots.json"), `${JSON.stringify(sharedTeam(), null, 2)}\n`);
  const state = JSON.parse(readFileSync(s.statePath, "utf8"));
  const add = (address, labels, extra = {}) => {
    state.terminals.push({ address, name: address, state: "live" });
    state.get[address] = get(address, labels, { cwd: s.project, name: address, ...extra });
  };
  add("t200", { bot: SHARED_ID.pm, role: "pm" });
  add("t201", { bot: SHARED_ID.integrator, role: "integrator" });
  add("t202", { bot: SHARED_ID.fixer, role: "fixer" });
  add("t203", { bot: SHARED_ID.capB, role: "captain" });
  add("t204", { bot: SHARED_ID.planned });
  add("t205", { bot: SHARED_ID.devB, role: "dev" });
  add("t206", { bot: SHARED_ID.testerB, role: "tester" });
  add("t207", { bot: SHARED_ID.plain });
  add("t208", { bot: ID.dev, role: "pm" }, { name: "forged" });
  add("t209", { bot: SHARED_ID.unlisted });
  add("t210", { bot: SHARED_ID.capOrch, role: "captain" });
  add("t211", { "worker.of": SHARED_ID.pm }, { cwd: s.worktree, parent: "t200" });
  add("t212", { "worker.of": SHARED_ID.integrator }, { cwd: s.worktree, parent: "t201" });
  add("t213", { "worker.of": SHARED_ID.fixer }, { cwd: s.worktree, parent: "t202" });
  add("t214", { bot: SHARED_ID.capMissing, role: "captain" });
  writeFileSync(s.statePath, JSON.stringify(state));
  const bind = (terminal, id) => ({ v: 1, event: "attach", bot: id, project: s.project, terminal, core: "core",
    created_ms: 100, machine: null, at: "2026-11-01T00:00:00.000Z", by: "start" });
  const rows = [
    ["t200", SHARED_ID.pm], ["t201", SHARED_ID.integrator], ["t202", SHARED_ID.fixer],
    ["t203", SHARED_ID.capB], ["t205", SHARED_ID.devB], ["t206", SHARED_ID.testerB],
    ["t207", SHARED_ID.plain], ["t208", ID.dev], ["t210", SHARED_ID.capOrch],
    ["t214", SHARED_ID.capMissing],
  ];
  const ledger = join(s.app, "automagik-herdr", "attach.jsonl");
  appendFileSync(ledger, rows.map(([terminal, id]) => `${JSON.stringify(bind(terminal, id))}\n`).join(""));
  chmodSync(ledger, 0o600);
  return s;
}

test("pm, integrator and fixer callers send to any listed bot outside their team", (t) => {
  const s = sharedScene(t);
  const cases = [
    ["t200", "t203", "a captain of another squad"], ["t200", "t201", "another shared role"],
    ["t200", "t204", "a planned listed bot"],
    ["t201", "t203", "a captain of another squad"], ["t201", "t200", "another shared role"],
    ["t201", "t204", "a planned listed bot"],
    ["t202", "t203", "a captain of another squad"], ["t202", "t200", "another shared role"],
    ["t202", "t201", "another shared role"],
  ];
  for (const [caller, target, why] of cases) {
    writeFileSync(s.logPath, "");
    const args = ["send", target, "sync"];
    const r = guardRun(s, args, { HC_TERMINAL_ID: caller });
    assert.equal(r.status, 0, `${caller} -> ${target} (${why}): ${r.stderr}`);
    assert.deepEqual(calls(s).filter((argv) => argv[0] === "send"), [args], `${caller} -> ${target} (${why}) arrives once, unchanged`);
  }
});

test("another rank sending sideways to a listed bot outside its team is refused", (t) => {
  const s = sharedScene(t);
  const cases = [
    ["t203", "t204", "captain"], ["t205", "t200", "dev"],
    ["t206", "t201", "tester"], ["t207", "t204", "no rank"],
  ];
  for (const [caller, target, rank] of cases) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, ["send", target, "hi"], { HC_TERMINAL_ID: caller });
    assertRefused(r);
    assert.equal(calls(s).some((argv) => argv[0] === "send"), false, `${rank} -> ${target} never reaches send`);
  }
});

test("a worker of a pm, integrator or fixer bot does not inherit the widening", (t) => {
  const s = sharedScene(t);
  const cases = [["t211", "t203"], ["t212", "t200"], ["t213", "t204"]];
  for (const [caller, target] of cases) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, ["send", target, "hi"], { HC_TERMINAL_ID: caller });
    assertRefused(r);
    assert.equal(calls(s).some((argv) => argv[0] === "send"), false, `${caller} -> ${target} never reaches send`);
  }
});

test("the rank comes from bots.json, not the caller pane's role= label", (t) => {
  const s = sharedScene(t);
  writeFileSync(s.logPath, "");
  const r = guardRun(s, ["send", "t203", "hi"], { HC_TERMINAL_ID: "t208" });
  assertRefused(r);
  assert.equal(calls(s).some((argv) => argv[0] === "send"), false, "a forged role=pm on a dev bot's pane never widens send");
});

test("a pm caller cannot send to a pane whose bot= is not listed", (t) => {
  const s = sharedScene(t);
  writeFileSync(s.logPath, "");
  const r = guardRun(s, ["send", "t209", "hi"], { HC_TERMINAL_ID: "t200" });
  assertRefused(r);
  assert.equal(calls(s).some((argv) => argv[0] === "send"), false, "an unlisted bot= target never reaches send");
});

test("the widening is send only: keys is refused and kill/rm keep today's unscoped pass", (t) => {
  const s = sharedScene(t);
  writeFileSync(s.logPath, "");
  const keys = guardRun(s, ["keys", "t203", "enter"], { HC_TERMINAL_ID: "t200" });
  assertRefused(keys);
  assert.deepEqual(calls(s), [], "keys never reaches hc");
  // #636 leaves kill and rm unscoped (#628 owns that scope); the widening does not touch them.
  for (const args of [["kill", "t203"], ["rm", "t203"]]) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args, { HC_TERMINAL_ID: "t200" });
    assert.equal(r.status, 0, `${args[0]} is unchanged: ${r.stderr}`);
    assert.ok(calls(s).some((argv) => same(argv, args)), `${args[0]} arrives unchanged`);
  }
});

test("a captain reaches its declared lead even when that lead is planned", (t) => {
  const s = sharedScene(t);
  writeFileSync(s.logPath, "");
  const args = ["send", "t204", "status"];
  const r = guardRun(s, args, { HC_TERMINAL_ID: "t210" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(s).filter((argv) => argv[0] === "send"), [args]);
});

test("a captain with a declared lead still cannot send sideways to another squad's captain", (t) => {
  const s = sharedScene(t);
  writeFileSync(s.logPath, "");
  const r = guardRun(s, ["send", "t203", "hi"], { HC_TERMINAL_ID: "t210" });
  assertRefused(r);
  assert.equal(calls(s).some((argv) => argv[0] === "send"), false);
});

test("a declared lead id not listed in bots.json adds nothing", (t) => {
  const s = sharedScene(t);
  writeFileSync(s.logPath, "");
  const r = guardRun(s, ["send", "t209", "hi"], { HC_TERMINAL_ID: "t214" });
  assertRefused(r);
  assert.equal(calls(s).some((argv) => argv[0] === "send"), false, "an unlisted declared lead never names a target");
});

// ---- machine targets, and label on the caller's own workers ----

test("a machine target is refused on every allowed verb but send", (t) => {
  const s = scene(t);
  const cases = [
    ["read", "m/t101"], ["read", "--lines", "5", "m/t101"], ["get", "m/t101"], ["wait", "m/t101"],
    ["put", "m/t101", "/tmp/file"], ["label", "m/t101", "role=reviewer"], ["kill", "m/t101"], ["rm", "m/t101"],
  ];
  for (const args of cases) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assertRefused(r);
    assert.match(r.stderr, /machine target/, args.join(" "));
    assert.deepEqual(calls(s), [], `${args.join(" ")} never reaches hc`);
  }
  writeFileSync(s.logPath, "");
  const team = guardRun(s, ["send", "m/t101", "hi"]);
  assert.equal(team.status, 0, team.stderr);
  assert.ok(calls(s).some((argv) => same(argv, ["send", "m/t101", "hi"])));
  for (const args of [["send", "m/t120", "hi"], ["send", "--on", "m", "t120", "hi"]]) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assertRefused(r);
    assert.equal(calls(s).some((argv) => argv[0] === "send"), false);
  }
});

test("a machine target named by an hc events option is refused", (t) => {
  const s = scene(t);
  const cases = [
    ["events", "--terminal", "m/t101"], ["events", "--terminal=m/t101"],
    ["events", "--children-of", "m/t101"], ["events", "--children-of=m/t101"],
  ];
  for (const args of cases) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assertRefused(r);
    assert.match(r.stderr, /machine target/, args.join(" "));
    assert.deepEqual(calls(s), []);
  }
  writeFileSync(s.logPath, "");
  const local = guardRun(s, ["events", "--terminal", "t101"]);
  assert.equal(local.status, 0, local.stderr);
  assert.ok(calls(s).some((argv) => same(argv, ["events", "--terminal", "t101"])));
});

test("label is the caller's own workers only; a label cannot widen send", (t) => {
  const s = scene(t);
  writeFileSync(s.logPath, "");
  let r = guardRun(s, ["label", "t101", "role=reviewer"]);
  assertRefused(r);
  assert.match(r.stderr, /own worker/);
  assert.equal(calls(s).some((argv) => argv[0] === "label"), false, "a foreign label never reaches hc");
  r = guardRun(s, ["label", "t120", "role=reviewer"]);
  assertRefused(r);
  assert.equal(calls(s).some((argv) => argv[0] === "label"), false, "the label-then-send pane is never labelled");
  r = guardRun(s, ["send", "t120", "hi"]);
  assertRefused(r);
  r = guardRun(s, ["label", "t105", "role=dev"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(calls(s).some((argv) => same(argv, ["label", "t105", "role=dev"])));
});

// ---- the dsh-tui worker run shape ----

const exactRun = (s, over = {}) => workerArgs({
  botId: ID.dev, branch: "feat/x", role: "dev", name: "feat-x", cwd: s.worktree, parent: "t100",
  agent: "dsh-tui", argv: ["dsh-tui"], task: "do it", path: "/usr/bin:/bin", space: "sp1", ...over,
});

test("the exact dsh-tui worker argv reaches the stub unchanged", (t) => {
  const s = scene(t);
  const exact = exactRun(s);
  assert.equal(exact[exact.indexOf("--") + 3], "dsh-tui", exact.join(" "));
  assert.ok(exact[exact.indexOf("--") + 2].startsWith(`PATH=${GUARD_DIR}:`), exact.join(" "));
  writeFileSync(s.logPath, "");
  const r = guardRun(s, exact);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(s), [exact]);
});

test("a run that is not the worker shape is refused before hc", (t) => {
  const s = scene(t);
  const exact = exactRun(s);
  const parentAt = exact.indexOf("--parent");
  const withoutParent = [...exact.slice(0, parentAt), "--no-parent", ...exact.slice(parentAt + 2)];
  const beforeDash = exact.indexOf("--");
  const withFlag = (flag) => [...exact.slice(0, beforeDash), flag, ...exact.slice(beforeDash)];
  const noGuardPath = [...exact];
  noGuardPath[noGuardPath.indexOf("--") + 2] = "PATH=/usr/bin:/bin";
  const template = [...exact.slice(0, parentAt), "--label", "worker.template=dev-sol", ...exact.slice(parentAt)];
  const otherAgent = [...exact];
  otherAgent[otherAgent.indexOf("--") + 3] = "claude";
  const wrongCwd = exactRun(s, { cwd: s.project });
  const foreignParent = exactRun(s, { parent: "t101" });
  const foreignBot = exactRun(s, { botId: ID.cap });
  const bare = ["run", "--bg", "--parent", "t100", "--", "/usr/bin/env", `PATH=${GUARD_DIR}:/usr/bin`, "dsh-tui", "--", "task"];
  const cases = [
    ["bare", bare], ["foreign parent", foreignParent], ["foreign worker.of", foreignBot],
    ["cwd outside the worktrees", wrongCwd], ["template", template], ["another agent", otherAgent],
    ["no parent", withoutParent], ["outlive-parent", withFlag("--outlive-parent")], ["keep", withFlag("--keep")],
    ["--on", withFlag("--on")], ["no guard on PATH", noGuardPath],
  ];
  for (const [name, args] of cases) {
    writeFileSync(s.logPath, "");
    const r = guardRun(s, args);
    assertRefused(r);
    assert.equal(calls(s).some((argv) => argv[0] === "run"), false, `${name}: run never reaches hc`);
  }
});

test("a worker pane cannot start a worker: the ledger has no binding for it", (t) => {
  const s = scene(t);
  const withWorker = exactRun(s, { parent: "t110", botId: ID.dev });
  const r = guardRun(s, withWorker, { HC_TERMINAL_ID: "t110" });
  assertRefused(r);
  assert.deepEqual(calls(s).some((argv) => argv[0] === "run"), false);
});

// ---- the PATH word: dsh-tui only ----

test("a mixed am+pack guard PATH reaches the real hc once, never a guard as hc", (t) => {
  const s = scene(t);
  const am = join(s.root, "am"), amGuard = join(am, "guard");
  mkdirSync(amGuard, { recursive: true });
  writeFileSync(join(am, "hcGuard.mjs"), "// fake am guard\n");
  const marker = join(s.root, "am-guard-called");
  writeFileSync(join(amGuard, "hc"), `#!/bin/sh\necho called > "${marker}"\nexit 1\n`);
  chmodSync(join(amGuard, "hc"), 0o755);
  const exact = exactRun(s);
  exact[exact.indexOf("--") + 2] = `PATH=${amGuard}:${GUARD_DIR}:/usr/bin:/bin`;
  writeFileSync(s.logPath, "");
  const r = guardRun(s, exact, { PATH: `${amGuard}:${GUARD_DIR}:${s.bin}:${dirname(process.execPath)}` });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(s), [exact], "the real hc got the mixed-PATH worker argv once");
  assert.equal(existsSync(marker), false, "the am guard was skipped, not run as hc");
});

test("a fake guard pair never loops: every guard folder is skipped and the stub runs once", (t) => {
  const s = scene(t);
  const fakeGuard = (name) => {
    const mod = join(s.root, name);
    mkdirSync(join(mod, "guard"), { recursive: true });
    writeFileSync(join(mod, "hcGuard.mjs"), "// fake guard\n");
    // Bounded by a depth file beside the fake entry itself: even a wrong skip ends here.
    writeFileSync(join(mod, "guard", "hc"), `#!/bin/sh
depth=\${0%/*}/depth
n=0
[ -f "$depth" ] && read n < "$depth"
n=$((n + 1))
echo "$n" > "$depth"
[ "$n" -gt 2 ] && exit 9
exec hc "$@"
`);
    chmodSync(join(mod, "guard", "hc"), 0o755);
    return join(mod, "guard");
  };
  const a = fakeGuard("fake-a"), b = fakeGuard("fake-b");
  writeFileSync(s.logPath, "");
  const r = guardRun(s, ["read", "t101"], { PATH: `${a}:${b}:${s.bin}:${dirname(process.execPath)}` });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(s), [["read", "t101"]], "the real hc ran once; the fake guards did not");
  assert.equal(existsSync(join(a, "depth")), false, "the bounded fake loop never started");
  assert.equal(existsSync(join(b, "depth")), false, "the second fake guard never ran either");
});

test("the guard goes first on a dsh-tui PATH and nowhere else; non-dsh-tui argv is unchanged", () => {
  assert.equal(guardPath("/a:/b", "claude"), "/a:/b");
  assert.equal(guardPath("/a:/b", null), "/a:/b");
  assert.equal(guardPath(null, "dsh-tui"), null);
  assert.equal(guardPath("/a:/b", "dsh-tui"), `${GUARD_DIR}:/a:/b`);
  assert.equal(guardPath(`${GUARD_DIR}:/a`, "dsh-tui"), `${GUARD_DIR}:/a`, "already first: not repeated");

  const base = { botId: ID.dev, name: "dev", cwd: "/p", parent: ["--no-parent"], path: "/bin" };
  const claude = startArgs({ ...base, argv: ["claude"], agent: "claude" });
  assert.deepEqual(claude, startArgs({ ...base, argv: ["claude"] }), "an old caller (no agent) is unchanged");
  assert.deepEqual(claude, ["run", "--bg", "--json", "--name", "dev", "--cwd", "/p", "--label", `bot=${ID.dev}`,
    "--no-parent", "--", "/usr/bin/env", "PATH=/bin", "claude"]);
  const dsh = startArgs({ ...base, argv: ["dsh-tui"], agent: "dsh-tui" });
  assert.deepEqual(dsh.slice(dsh.indexOf("--") + 1), ["/usr/bin/env", `PATH=${GUARD_DIR}:/bin`, "dsh-tui"]);

  const omp = workerArgs({ botId: ID.dev, branch: "b", cwd: "/w", parent: "t1", agent: "omp", argv: ["omp"], task: "t", path: "/a:/b" });
  assert.deepEqual(omp.slice(omp.indexOf("--") + 1), ["/usr/bin/env", "PATH=/a:/b", "omp", "t"]);
  const dshWorker = workerArgs({ botId: ID.dev, branch: "b", cwd: "/w", parent: "t1", agent: "dsh-tui", argv: ["dsh-tui"], task: "t", path: "/a:/b" });
  assert.deepEqual(dshWorker.slice(dshWorker.indexOf("--") + 1), ["/usr/bin/env", `PATH=${GUARD_DIR}:/a:/b`, "dsh-tui", "--", "t"]);
});
