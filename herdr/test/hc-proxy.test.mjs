// The per-pane hc proxy (#631 PR A): every row the brief asks for, against a fake herdr-core
// 0.1.14 over a scratch Unix socket. Hermetic: temp app home, project, worktree and runtime
// folder; no real core, no pane, no socket from the host. The proxy is imported and started
// in-process (one row spawns its CLI), and the fake records what actually reached the core.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { HC_PIN, MAX_CONNECTIONS, MAX_READ_LINES, MAX_REPLY_BYTES, MAX_SOCKET_PATH, startProxy } from "../mods/am-sidebar/hcProxy.mjs";
import { ENV, GUARD_DIR, WORKER_OF_LABEL } from "../mods/am-sidebar/workers.js";
import { startFakeCore } from "./fake-hc-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PROXY = join(here, "..", "mods", "am-sidebar", "hcProxy.mjs");

const ID = {
  main: "b-aaaaaaaaaa", cap: "b-bbbbbbbbbb", dev: "b-cccccccccc", jun: "b-dddddddddd",
  rev: "b-eeeeeeeeee", fix: "b-ffffffffff", other: "b-gggggggggg", pm: "b-hhhhhhhhhh",
};
const bot = (id, kind, extra = {}) => ({
  id, name: id, kind, look: { character: "star", colour: "blue" }, role: "r", instructions: "i",
  agent: "dsh-tui", ...extra,
});
const team = () => ({
  version: 1,
  categories: [],
  bots: [
    bot(ID.main, "main", { name: "Main" }),
    bot(ID.cap, "member", { name: "Captain", rank: "captain" }),
    bot(ID.dev, "member", { name: "Dev", lead: ID.cap }),
    bot(ID.jun, "member", { name: "Junior", lead: ID.dev }),
    bot(ID.rev, "member", { name: "Reviewer", lead: ID.main, rank: "reviewer" }),
    bot(ID.fix, "member", { name: "Fixer", lead: ID.main, rank: "fixer" }),
    bot(ID.other, "member", { name: "Other", lead: ID.main }),
    bot(ID.pm, "member", { name: "PM", lead: ID.main, rank: "pm" }),
  ],
});

/** One scene: temp app home + ledger, project + bots.json, a worktree and the runtime folder. */
function scene() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hcp-")));
  const app = join(root, "app"), project = join(root, "project"), home = join(root, "home"), runtime = join(root, "run");
  const worktree = join(project, ".claude", "worktrees", "wt");
  const bin = join(root, "bin");
  for (const dir of [app, join(app, "automagik-herdr"), project, join(project, ".herdr"), worktree, home, runtime, bin]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  writeFileSync(join(bin, "dsh-tui"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "dsh-tui"), 0o755);
  writeFileSync(join(project, ".herdr", "bots.json"), `${JSON.stringify(team(), null, 2)}\n`);
  const ledger = join(app, "automagik-herdr", "attach.jsonl");
  writeFileSync(ledger, `${JSON.stringify({
    v: 1, event: "attach", bot: ID.dev, project, terminal: "t100", core: "fake-core",
    created_ms: 100, machine: null, at: "2026-11-01T00:00:00.000Z", by: "start",
  })}\n`);
  chmodSync(ledger, 0o600);
  const rec = (address, labels, extra = {}) => ({
    address, name: address, agent: "dsh-tui", cwd: project, state: "live", status: "working",
    turn: 0, where: "test", labels, ...extra,
  });
  const terminals = [
    rec("t100", { bot: ID.dev }, { name: "dev" }),
    rec("t101", { bot: ID.cap }, { name: "cap" }),
    rec("t102", { bot: ID.jun }, { name: "junior" }),
    rec("t103", { bot: ID.main }, { name: "main" }),
    rec("t104", { bot: ID.rev }, { name: "reviewer" }),
    rec("t105", { [WORKER_OF_LABEL]: ID.dev }, { name: "worker", parent: "t100", cwd: worktree }),
    rec("t106", { [WORKER_OF_LABEL]: ID.other }, { name: "other-worker", parent: "t120", cwd: worktree }),
    rec("t107", { role: "fixer" }, { name: "fixer-pane" }),
    rec("t108", { bot: ID.pm }, { name: "pm" }),
    rec("t110", { bot: ID.other }, { name: "other" }),
    rec("t111", {}, { name: "bare" }),
    rec("t112", { bot: ID.jun }, { name: "huge", huge: true }),
    rec("t120", { bot: ID.other }, { name: "other-bot" }),
    rec("t121", { [WORKER_OF_LABEL]: ID.cap }, { name: "cap-worker", parent: "t101", cwd: worktree }),
  ];
  const env = { XDG_RUNTIME_DIR: runtime, HOME: home, HERDR_APP_HOME: app };
  return { root, app, project, home, runtime, worktree, bin, ledger, terminals, env };
}

/** Start the fake core and, unless proxy: false, the pane t100 proxy; one cleanup for all. */
async function sceneWithCore(t, { version = "0.1.14", proxy = true, proxyOptions = {} } = {}) {
  const s = scene();
  const fake = await startFakeCore({ socket: join(s.root, "core.sock"), terminals: s.terminals, version });
  const proxies = [];
  const start = async (terminal = "t100", extra = {}) => {
    const started = await startProxy({ terminal, upstream: fake.socket, appHome: s.app, env: s.env, ...extra });
    proxies.push(started);
    return started;
  };
  t.after(async () => {
    for (const started of proxies) { try { await started.close(); } catch { /* gone */ } }
    try { await fake.close(); } catch { /* gone */ }
    rmSync(s.root, { recursive: true, force: true });
  });
  const first = proxy ? await start("t100", proxyOptions) : null;
  return { s, fake, start, proxy: first };
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.lines = [];
    this.waiters = [];
    this.nextId = 1;
    this.closed = false;
    socket.on("data", (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      for (;;) {
        const at = this.buffer.indexOf(10);
        if (at < 0) break;
        const line = this.buffer.subarray(0, at).toString("utf8");
        this.buffer = this.buffer.subarray(at + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line); else this.lines.push(line);
      }
    });
    socket.on("close", () => {
      this.closed = true;
      while (this.waiters.length) this.waiters.shift()(null);
    });
    socket.on("error", () => { /* the proxy may end the connection after a cap */ });
  }

  static async connect(path) {
    const socket = await new Promise((resolve, reject) => {
      const opened = net.connect(path);
      opened.once("connect", () => resolve(opened));
      opened.once("error", reject);
    });
    return new Client(socket);
  }

  next(timeout = 5000) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer within the test timeout")), timeout);
      this.waiters.push((line) => {
        clearTimeout(timer);
        if (line === null) reject(new Error("the proxy closed the connection"));
        else resolve(line);
      });
    });
  }

  async call(method, params = {}, timeout = 5000) {
    const id = this.nextId++;
    this.socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const line = await this.next(timeout);
    return JSON.parse(line);
  }

  close() {
    this.socket.destroy();
  }
}

const clientFor = (path) => Client.connect(path);

/** The exact worker shape the pack's workerArgs emits, as hc's CLI turns it into RPC params. */
const runParams = (s, extra = {}) => ({
  argv: [ENV, `PATH=${GUARD_DIR}:${s.bin}:/usr/bin:/bin`, "dsh-tui", "--", "do the task"],
  name: "worker-one",
  cwd: s.worktree,
  env: { TERM: "xterm-256color", TERM_PROGRAM: "herdr" },
  labels: { [WORKER_OF_LABEL]: ID.dev, branch: "feat/worker", "worker.role": "dev", task: "gn-1" },
  parent: "t100",
  no_parent: false, no_notify: false, outlive_parent: false, die_with_parent: true,
  rm: false, keep: false, wait: false,
  caller: "t5q",
  ...extra,
});

const REFUSED_METHODS = [
  "doc.get", "doc.set", "events.subscribe", "file.edit", "file.read", "file.write", "hello",
  "machine.add", "machine.connect", "machine.exec", "machine.list", "machine.rename", "machine.rm",
  "rpc.discover", "server.restart", "server.status", "server.stop", "templates.list",
  "terminal.attach", "terminal.interrupt", "terminal.keep", "terminal.keys", "terminal.put",
];

const waitFor = async (check, timeout = 4000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
};

test("the allow-list forwards every allowed method and refuses every other one", async (t) => {
  const { s, fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const allowed = [
    ["terminal.list", {}],
    ["terminal.get", { terminal: "t101" }],
    ["terminal.read", { terminal: "t101", lines: 5 }],
    ["terminal.wait", { terminal: "t101", timeout: 1 }],
    ["terminal.send", { terminal: "t101", text: "hi" }],
    ["terminal.kill", { terminal: "t105" }],
    ["terminal.rm", { terminal: "t105" }],
    ["terminal.label", { terminal: "t105", labels: { "herdr.tab": "tab-1" } }],
    ["terminal.run", runParams(s)],
  ];
  for (const [method, params] of allowed) {
    const client = await clientFor(proxy.socket);
    const answer = await client.call(method, params);
    client.close();
    assert.ok(answer.result, `${method} answers a result: ${JSON.stringify(answer)}`);
    assert.equal(answer.error, undefined, `${method} has no error`);
  }
  assert.equal(fake.calls("terminal.run").length, 1, "the exact worker shape reached the core");
  assert.equal(fake.calls("terminal.list").length, 1);
  assert.deepEqual(fake.calls("terminal.list")[0].params, {}, "list is forwarded as is");

  for (const method of REFUSED_METHODS) {
    const before = fake.log.length;
    const client = await clientFor(proxy.socket);
    const answer = await client.call(method, { terminal: "t101" });
    client.close();
    assert.ok(answer.error, `${method} is refused`);
    assert.match(answer.error.message, /^hc-proxy: /, `${method} names the proxy`);
    assert.equal(fake.log.length, before, `${method} never reached the core`);
  }
});

test("a forged caller is overwritten on every forwarded request", async (t) => {
  const { s, fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const calls = [
    ["terminal.send", { terminal: "t101", caller: "t5q", text: "hi" }],
    ["terminal.get", { terminal: "t101", caller: "t5q" }],
    ["terminal.read", { terminal: "t101", caller: "t5q" }],
    ["terminal.run", runParams(s, { caller: "t5q" })],
  ];
  for (const [method, params] of calls) {
    const client = await clientFor(proxy.socket);
    const answer = await client.call(method, params);
    client.close();
    assert.ok(answer.result, `${method} answers: ${JSON.stringify(answer)}`);
  }
  for (const row of fake.log.filter((entry) => entry.params.caller !== undefined)) {
    assert.equal(row.params.caller, "t100", `${row.method}'s caller is the pane's`);
  }
  const send = fake.calls("terminal.send")[0].params;
  assert.equal(send.caller, "t100");
  assert.notEqual(send.caller, "t5q");
  assert.equal(fake.calls("terminal.run")[0].params.caller, "t100");
  const list = await (await clientFor(proxy.socket)).call("terminal.list", { caller: "t5q" });
  assert.ok(list.error, "terminal.list refuses a caller parameter it does not own");
  assert.match(list.error.message, /terminal\.list: unknown parameter caller/);
  assert.equal(fake.calls("terminal.list").length, 0, "the refused list never reached the core");
});

test("get/read/wait/send are scoped to the team and its own workers", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const allowed = (method, target, extra = {}) => [method, target, extra];
  for (const [method, target, extra] of [
    allowed("terminal.get", "t101"),
    allowed("terminal.get", "t102"),
    allowed("terminal.get", "t105"),
    allowed("terminal.get", "t100"),
    allowed("terminal.read", "t101", { lines: 3 }),
    allowed("terminal.wait", "t102", { timeout: 1 }),
    allowed("terminal.send", "t101", { text: "team" }),
    allowed("terminal.send", "t105", { text: "own worker" }),
    allowed("terminal.send", "t104", { text: "shared reviewer" }),
    allowed("terminal.send", "t107", { text: "shared fixer" }),
  ]) {
    const client = await clientFor(proxy.socket);
    const answer = await client.call(method, { ...extra, terminal: target });
    client.close();
    assert.ok(answer.result, `${method} ${target} is allowed: ${JSON.stringify(answer)}`);
  }
  for (const [method, target, extra] of [
    allowed("terminal.get", "t110"),
    allowed("terminal.read", "t110", { lines: 3 }),
    allowed("terminal.wait", "t110", { timeout: 1 }),
    allowed("terminal.send", "t110", { text: "not mine" }),
    allowed("terminal.send", "t121", { text: "another bot's worker" }),
    allowed("terminal.get", "t121"),
    allowed("terminal.read", "t104", { lines: 3 }),
    allowed("terminal.read", "t107", { lines: 3 }),
    allowed("terminal.send", "mac/t37n", { text: "elsewhere" }),
    allowed("terminal.read", "mac/t37n", { lines: 3 }),
  ]) {
    const before = fake.log.length;
    const client = await clientFor(proxy.socket);
    const answer = await client.call(method, { ...extra, terminal: target });
    client.close();
    assert.ok(answer.error, `${method} ${target} is refused`);
    assert.match(answer.error.message, /^hc-proxy: /);
    if (target.includes("/")) assert.equal(fake.log.length, before, "a machine target is refused before any call");
  }
  // --children waits on the caller's own children; it needs no target and cannot name one.
  const client = await clientFor(proxy.socket);
  const answer = await client.call("terminal.wait", { children: true, timeout: 1 });
  client.close();
  assert.ok(answer.result);
  const forwarded = fake.calls("terminal.wait").at(-1).params;
  assert.equal(forwarded.terminal, undefined);
  assert.equal(forwarded.caller, "t100");
});

test("the pm/integrator/fixer send widening is send only", async (t) => {
  const { s, fake, start } = await sceneWithCore(t);
  appendFileSync(s.ledger, `${JSON.stringify({
    v: 1, event: "attach", bot: ID.pm, project: s.project, terminal: "t108", core: "fake-core",
    created_ms: 150, machine: null, at: "2026-11-01T00:01:00.000Z", by: "attach",
  })}\n`);
  const pm = await start("t108");
  fake.clearLog();
  const send = await (await clientFor(pm.socket)).call("terminal.send", { terminal: "t110", text: "listed" });
  assert.ok(send.result, "a pm may send to a listed bot outside its team");
  const read = await (await clientFor(pm.socket)).call("terminal.read", { terminal: "t110", lines: 2 });
  assert.ok(read.error, "the widening does not reach reads");
  assert.match(read.error.message, /not in the caller's team/);
  const worker = await (await clientFor(pm.socket)).call("terminal.send", { terminal: "t105", text: "a worker" });
  assert.ok(worker.error, "another bot's worker is not a listed bot");
});

test("terminal.run accepts only the exact worker shape and refuses the rest", async (t) => {
  const { s, fake, proxy, start } = await sceneWithCore(t);
  fake.clearLog();
  const client = await clientFor(proxy.socket);
  const exact = await client.call("terminal.run", runParams(s));
  client.close();
  assert.ok(exact.result, `the worker shape is allowed: ${JSON.stringify(exact)}`);
  const forwarded = fake.calls("terminal.run")[0].params;
  assert.equal(forwarded.caller, "t100");
  assert.equal(forwarded.parent, "t100");
  assert.equal(forwarded.labels[WORKER_OF_LABEL], ID.dev);
  assert.deepEqual(forwarded.argv, runParams(s).argv);

  // A fake guard and a fake dsh-tui inside the writable worktree must not pass the shape.
  mkdirSync(join(s.worktree, "guard"), { recursive: true });
  writeFileSync(join(s.worktree, "hcGuard.mjs"), "// a fake beside the fake guard\n");
  writeFileSync(join(s.worktree, "dsh-tui"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(s.worktree, "dsh-tui"), 0o755);
  // The app home is writable too; a guard there is not the pack's guard either.
  mkdirSync(join(s.app, "guard"), { recursive: true });
  writeFileSync(join(s.app, "hcGuard.mjs"), "// a fake in the app home\n");

  const bad = [
    ["an on param", { on: "mac" }],
    ["a line", { line: "echo hi" }],
    ["a non-worker argv", { argv: ["sh", "-c", "id"] }],
    ["a short argv", { argv: [ENV, `PATH=${GUARD_DIR}:/usr/bin`, "dsh-tui", "--"] }],
    ["a parent that is not the caller", { parent: "t101" }],
    ["a cwd outside the worktrees", { cwd: s.root }],
    ["an extra label", { labels: { [WORKER_OF_LABEL]: ID.dev, bot: ID.dev } }],
    ["another bot's worker.of", { labels: { [WORKER_OF_LABEL]: ID.other } }],
    ["a shell key", { shell: true }],
    ["an agent key", { agent: "omp" }],
    ["die_with_parent false", { die_with_parent: false }],
    ["no die_with_parent", { die_with_parent: undefined }],
    ["a PATH without a guard", { argv: [ENV, "PATH=/usr/bin:/bin", "dsh-tui", "--", "task"] }],
    ["a guard inside the writable worktree", {
      argv: [ENV, `PATH=${join(s.worktree, "guard")}:/usr/bin:/bin`, "dsh-tui", "--", "task"],
    }],
    ["a guard inside the writable app home", {
      argv: [ENV, `PATH=${join(s.app, "guard")}:/usr/bin:/bin`, "dsh-tui", "--", "task"],
    }],
    ["a dsh-tui inside the writable worktree", {
      argv: [ENV, `PATH=${GUARD_DIR}:${s.worktree}:/usr/bin:/bin`, "dsh-tui", "--", "task"],
    }],
    ["a dsh-tui that is not on the worker PATH", {
      argv: [ENV, `PATH=${GUARD_DIR}:${s.home}`, "dsh-tui", "--", "task"],
    }],
    ["an env that is not identity only", { env: { LD_PRELOAD: "/tmp/escape.so" } }],
    ["a timeout", { timeout: 5 }],
    ["wait", { wait: true }],
  ];
  for (const [name, extra] of bad) {
    const before = fake.log.length;
    const badClient = await clientFor(proxy.socket);
    const call = await badClient.call("terminal.run", runParams(s, extra));
    badClient.close();
    assert.ok(call.error, `${name} is refused`);
    assert.match(call.error.message, /^hc-proxy: terminal\.run: /);
    assert.equal(fake.log.length, before, `${name} never reached the core`);
  }

  // A worker pane has no ledger row: it starts no workers, even with a worker's own shape.
  const workerProxy = await start("t105");
  const fromWorker = await (await clientFor(workerProxy.socket)).call("terminal.run", runParams(s, { parent: "t105" }));
  assert.ok(fromWorker.error);
  assert.match(fromWorker.error.message, /only a bot pane the attach ledger binds/);
});

test("a rename between the check and the forward cannot redirect the target", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  const victim = fake.state.terminals.find((row) => row.address === "t105");
  victim.name = "victim";
  fake.state.afterGet = (found) => {
    if (found.address !== "t105") return;
    found.name = "renamed";
    fake.state.terminals.find((row) => row.address === "t110").name = "victim";
  };
  const answer = await (await clientFor(proxy.socket)).call("terminal.send", { terminal: "victim", text: "hi" });
  assert.ok(answer.result, JSON.stringify(answer));
  const forwarded = fake.calls("terminal.send").at(-1).params;
  assert.equal(forwarded.terminal, "t105", "the resolved address is forwarded, not the name");
  assert.equal(answer.result.target, "t105", "the renamed name cannot redirect it to another terminal");});

test("the read cap refuses an over-long request and a reply over the byte cap", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const tooMany = await (await clientFor(proxy.socket)).call("terminal.read", {
    terminal: "t101", lines: MAX_READ_LINES + 1,
  });
  assert.ok(tooMany.error);
  assert.match(tooMany.error.message, new RegExp(`^hc-proxy: terminal\\.read: ${MAX_READ_LINES + 1} lines is over`));
  assert.equal(fake.calls("terminal.read").length, 0, "the core never sees an over-long read");

  const huge = await (await clientFor(proxy.socket)).call("terminal.read", { terminal: "t112", lines: 10 });
  assert.ok(huge.error, "a reply over the cap is a clear error");
  assert.match(huge.error.message, new RegExp(`over the ${MAX_REPLY_BYTES}-byte reply cap`));
  assert.ok(JSON.stringify(huge).length < MAX_REPLY_BYTES, "the proxy did not buffer the reply for the client");
});

test("hello is refused: framed mode and attach are unreachable", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const answer = await (await clientFor(proxy.socket)).call("hello", { framed: true });
  assert.ok(answer.error);
  assert.match(answer.error.message, /^hc-proxy: hello is not allowed/);
  assert.equal(fake.calls("hello").length, 0);
});

test("own-worker kill, rm and label are allowed; team and other workers are refused", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  for (const [method, params] of [
    ["terminal.kill", { terminal: "t105" }],
    ["terminal.rm", { terminal: "t105" }],
    ["terminal.label", { terminal: "t105", labels: { "herdr.tab": "tab-1" } }],
  ]) {
    const answer = await (await clientFor(proxy.socket)).call(method, params);
    assert.ok(answer.result, `${method} on the caller's own worker: ${JSON.stringify(answer)}`);
    const forwarded = fake.calls(method).at(-1).params;
    assert.equal(forwarded.terminal, "t105");
    if (method === "terminal.label") assert.equal(forwarded.caller, undefined, "label carries no caller");
    else assert.equal(forwarded.caller, "t100");
    for (const target of ["t101", "t121", "t106"]) {
      const before = fake.calls(method).length;
      const refused = await (await clientFor(proxy.socket)).call(method, { ...params, terminal: target });
      assert.ok(refused.error, `${method} on ${target} is refused`);
      assert.match(refused.error.message, /not the caller's own worker/);
      assert.equal(fake.calls(method).length, before, `${method} ${target} never reached the core`);
    }
  }
});

test("terminal.label forwards only its schema fields and refuses a caller", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const label = await (await clientFor(proxy.socket)).call("terminal.label", {
    terminal: "t105", labels: { "herdr.tab": "tab-1" },
  });
  assert.ok(label.result, JSON.stringify(label));
  assert.deepEqual(fake.calls("terminal.label").at(-1).params,
    { terminal: "t105", labels: { "herdr.tab": "tab-1" } },
    "label forwards exactly terminal and labels, no caller");
  const before = fake.log.length;
  const forged = await (await clientFor(proxy.socket)).call("terminal.label", {
    terminal: "t105", labels: { "herdr.tab": "tab-1" }, caller: "t5q",
  });
  assert.ok(forged.error, "label refuses a caller it does not own");
  assert.match(forged.error.message, /terminal\.label: unknown parameter caller/);
  assert.equal(fake.log.length, before, "the caller-bearing label never reached the core");
});

test("a dead upstream answers an error and never falls back", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  const live = await clientFor(proxy.socket);
  assert.ok((await live.call("terminal.list")).result, "the upstream answers first");
  await fake.close();
  const broken = await live.call("terminal.list");
  assert.ok(broken.error, "a dead upstream is an error");
  assert.match(broken.error.message, /^hc-proxy: .*upstream/);
  const fresh = await clientFor(proxy.socket);
  const refused = await fresh.call("terminal.list");
  assert.ok(refused.error);
  assert.match(refused.error.message, /^hc-proxy: .*upstream/);
});

test("a version mismatch refuses to start and creates no socket", async (t) => {
  const { s, fake } = await sceneWithCore(t, { version: "0.1.18", proxy: false });
  const socket = join(s.runtime, "automagik-hc-proxy", "t100", "hc.sock");
  await assert.rejects(
    startProxy({ terminal: "t100", upstream: fake.socket, appHome: s.app, env: s.env }),
    /0\.1\.18.*not the pinned 0\.1\.14/,
  );
  assert.equal(existsSync(socket), false, "no socket exists after the refusal");

  const child = spawn(process.execPath, [PROXY, "--terminal", "t100", "--upstream", fake.socket, "--app-home", s.app], {
    env: { ...process.env, ...s.env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1, stderr);
  assert.match(stderr, /hc-proxy: .*0\.1\.18.*not the pinned 0\.1\.14/);
  assert.equal(existsSync(socket), false);
});

test("the CLI starts a proxy, serves it, and removes its socket on SIGTERM", async (t) => {
  const { s, fake } = await sceneWithCore(t, { proxy: false });
  const socket = join(s.runtime, "automagik-hc-proxy", "t100", "hc.sock");
  const child = spawn(process.execPath, [PROXY, "--terminal", "t100", "--upstream", fake.socket, "--app-home", s.app], {
    env: { ...process.env, ...s.env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  assert.ok(await waitFor(() => existsSync(socket)), `the CLI listened: ${stderr}`);
  const answer = await (await clientFor(socket)).call("terminal.list");
  assert.ok(answer.result, JSON.stringify(answer));
  child.kill("SIGTERM");
  const [code] = await once(child, "exit");
  assert.equal(code, 0, stderr);
  assert.ok(await waitFor(() => !existsSync(socket)), "the socket was removed");
});

test("a later edit to the writable bots.json or ledger does not widen the snapshot", async (t) => {
  const { s, fake, proxy } = await sceneWithCore(t);
  const baseline = await (await clientFor(proxy.socket)).call("terminal.read", { terminal: "t110", lines: 2 });
  assert.ok(baseline.error, "t110 starts outside the team");
  // If the proxy re-read the roster, `other` would become dev's descendant and t110 readable.
  const file = JSON.parse(readFileSync(join(s.project, ".herdr", "bots.json"), "utf8"));
  file.bots.find((row) => row.id === ID.other).lead = ID.dev;
  writeFileSync(join(s.project, ".herdr", "bots.json"), `${JSON.stringify(file, null, 2)}\n`);
  // If it re-read the ledger, t100 would bind to `other` now.
  appendFileSync(s.ledger, `${JSON.stringify({
    v: 1, event: "attach", bot: ID.other, project: s.project, terminal: "t100", core: "fake-core",
    created_ms: 900, machine: null, at: "2026-11-01T01:00:00.000Z", by: "attach",
  })}\n`);
  fake.clearLog();
  const after = await (await clientFor(proxy.socket)).call("terminal.read", { terminal: "t110", lines: 2 });
  assert.ok(after.error, "a later roster edit does not widen the running policy");
  assert.match(after.error.message, /not in the caller's team/);
  const run = await (await clientFor(proxy.socket)).call("terminal.run", runParams(s));
  assert.ok(run.result, "the snapshot still binds t100 to dev, not to the later ledger row");
});

test("the socket lives in a 0700 folder outside the project, and an inside folder is refused", async (t) => {
  const { s, proxy } = await sceneWithCore(t);
  const folder = dirname(proxy.socket);
  assert.equal(proxy.socket, join(s.runtime, "automagik-hc-proxy", "t100", "hc.sock"));
  assert.equal(statSync(folder).mode & 0o777, 0o700);
  assert.equal(statSync(dirname(folder)).mode & 0o777, 0o700);
  assert.equal(lstatSync(proxy.socket).mode & 0o777, 0o600);
  assert.ok(!proxy.socket.startsWith(`${s.project}${sep}`), "the socket is outside the writable project");
  assert.ok(!proxy.socket.startsWith(`${s.app}${sep}`), "the socket is outside the app home");

  const inside = join(s.project, "run");
  mkdirSync(inside, { recursive: true });
  await assert.rejects(
    startProxy({ terminal: "t100", upstream: proxy.policy.upstream, appHome: s.app, env: { ...s.env, XDG_RUNTIME_DIR: inside } }),
    /inside the writable project/,
  );
});

test("one upstream connection per downstream client", async (t) => {
  const { fake, proxy } = await sceneWithCore(t);
  const before = fake.connections();
  const first = await clientFor(proxy.socket);
  assert.ok((await first.call("terminal.list")).result);
  assert.ok((await first.call("terminal.list")).result);
  assert.equal(fake.connections() - before, 1, "two calls on one client share one upstream");
  const second = await clientFor(proxy.socket);
  assert.ok((await second.call("terminal.list")).result);
  assert.equal(fake.connections() - before, 2, "a second client gets its own upstream");
  first.close();
  second.close();
});

test("an unknown parameter is refused on every allowed method", async (t) => {
  const { s, fake, proxy } = await sceneWithCore(t);
  fake.clearLog();
  const cases = [
    ["terminal.list", { bogus: true }],
    ["terminal.get", { terminal: "t101", bogus: true }],
    ["terminal.read", { terminal: "t101", lines: 2, bogus: true }],
    ["terminal.wait", { terminal: "t101", timeout: 1, bogus: true }],
    ["terminal.send", { terminal: "t101", text: "hi", bogus: true }],
    ["terminal.kill", { terminal: "t105", bogus: true }],
    ["terminal.rm", { terminal: "t105", bogus: true }],
    ["terminal.label", { terminal: "t105", labels: { "herdr.tab": "tab-1" }, bogus: true }],
    ["terminal.run", runParams(s, { bogus: true })],
  ];
  for (const [method, params] of cases) {
    const before = fake.log.length;
    const answer = await (await clientFor(proxy.socket)).call(method, params);
    assert.ok(answer.error, `${method} refuses an unknown parameter`);
    assert.match(answer.error.message, new RegExp(`^hc-proxy: ${method.replace(".", "\\.")}: unknown parameter bogus`));
    assert.equal(fake.log.length, before, `${method} never reached the core`);
  }
});

test("an over-limit socket path refuses to start with a named error", async (t) => {
  const { s, fake } = await sceneWithCore(t, { proxy: false });
  const long = join(s.root, "x".repeat(120));
  mkdirSync(long, { recursive: true });
  await assert.rejects(
    startProxy({ terminal: "t100", upstream: fake.socket, appHome: s.app, env: { ...s.env, XDG_RUNTIME_DIR: long } }),
    new RegExp(`socket path is \\d+ bytes, over the ${MAX_SOCKET_PATH}-byte limit`),
  );
  assert.equal(existsSync(join(long, "automagik-hc-proxy")), false);
  const child = spawn(process.execPath, [PROXY, "--terminal", "t100", "--upstream", fake.socket, "--app-home", s.app], {
    env: { ...process.env, ...s.env, XDG_RUNTIME_DIR: long },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 1, stderr);
  assert.match(stderr, new RegExp(`hc-proxy: socket path is \\d+ bytes, over the ${MAX_SOCKET_PATH}-byte limit`));
});

test("the connection cap refuses the extra client with a proxy error", async (t) => {
  const { proxy } = await sceneWithCore(t);
  const held = [];
  for (let i = 0; i < MAX_CONNECTIONS; i += 1) held.push(await clientFor(proxy.socket));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const extra = await clientFor(proxy.socket);
  const answer = JSON.parse(await extra.next());
  assert.match(answer.error.message, new RegExp(`^hc-proxy: too many connections \\(${MAX_CONNECTIONS} max\\)`));
  extra.close();
  for (const client of held) client.close();
});

test("an idle connection and a slow partial line are closed by the idle timeout", async (t) => {
  const { proxy } = await sceneWithCore(t, { proxyOptions: { idleTimeoutMs: 120 } });
  const idle = await clientFor(proxy.socket);
  assert.ok(await waitFor(() => idle.closed, 2000), "an idle connection is closed");
  const slow = await clientFor(proxy.socket);
  slow.socket.write('{"jsonrpc":"2.0","id":1');
  assert.ok(await waitFor(() => slow.closed, 2000), "a slow partial line is closed");
});

test("an in-flight wait keeps the connection alive", async (t) => {
  const { fake, proxy } = await sceneWithCore(t, { proxyOptions: { idleTimeoutMs: 120 } });
  fake.state.waitMs = 350;
  const answer = await (await clientFor(proxy.socket)).call("terminal.wait", { terminal: "t101", timeout: 1 });
  assert.ok(answer.result, "the wait was allowed to finish");
  fake.state.waitMs = 0;
});

test("a forwarded call other than wait times out", async (t) => {
  const { fake, proxy } = await sceneWithCore(t, { proxyOptions: { forwardTimeoutMs: 120 } });
  fake.state.hang = "terminal.list";
  const answer = await (await clientFor(proxy.socket)).call("terminal.list", {});
  assert.ok(answer.error, "the call is refused");
  assert.match(answer.error.message, /^hc-proxy: terminal\.list: did not answer within 120 ms/);
  fake.state.hang = null;
});

test("the version pin is one constant, 0.1.14", () => {
  assert.equal(HC_PIN, "0.1.14");
  assert.equal(readFileSync(PROXY, "utf8").includes('export const HC_PIN = "0.1.14"'), true);
});
