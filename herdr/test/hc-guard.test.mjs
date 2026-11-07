// The deny-by-default hc guard (#624, stopgap C): every allowed verb passes to a stub hc
// unchanged; every refused verb is one stderr line naming #624 and #631 and never calls it;
// send is scoped to the caller's team; the dsh-tui worker run shape is exact. Hermetic: a temp
// app home, a temp project and a stub hc on PATH; the real hc is never run. No escape route
// (an absolute hc path, a raw socket, `hc connect`) is tested here: the guard is a guardrail,
// not a boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import { appendFileSync, readFileSync } from "node:fs";
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
      t105: get("t105", { "worker.of": ID.dev }, { cwd: worktree, name: "worker" }),
      t106: get("t106", { role: "reviewer" }, { cwd: project, name: "reviewer" }),
      t107: get("t107", { role: "fixer" }, { cwd: project, name: "fixer" }),
      t108: get("t108", { bot: ID.tester }, { cwd: project, name: "tester" }),
      t110: get("t110", { "worker.of": ID.dev }, { cwd: worktree, created_ms: 200, name: "worker-dev" }),
      t120: get("t120", { bot: ID.other }, { cwd: project, name: "other" }),
      t121: get("t121", {}, { cwd: project, name: "bare" }),
      "m/t101": get("m/t101", { bot: ID.cap }, { cwd: project, name: "cap" }),
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
  assert.match(r.stderr, /#631/);
  assert.equal(r.stdout, "", "a refusal prints no stdout");
}

// ---- the allow list ----

test("every allowed verb reaches the stub unchanged", (t) => {
  const s = scene(t);
  const allowed = [
    ["send", "t101", "hello"], ["read", "t101"], ["ls"], ["get", "t101"], ["wait", "t101"],
    ["put", "t101", "/tmp/file"], ["label", "t101", "role=dev"], ["kill", "t101"], ["rm", "t101"],
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

test("every refused verb is one line naming #624 and #631, and the stub is never called", (t) => {
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
