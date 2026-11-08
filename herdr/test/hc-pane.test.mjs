// The per-pane hc helper (#631 PR B): one helper per pane starts the proxy before DSH, gives
// the pane the three mask names, and refuses to start the pane when the proxy refuses. Hermetic:
// a fake core, temp app home/project/runtime, and a tiny child that records its environment.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installSandboxRow, sandboxRootOf } from "../mods/am-sidebar/dshTui.mjs";
import { startFakeCore } from "./fake-hc-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HELPER = join(here, "..", "mods", "am-sidebar", "hcPane.mjs");
const ID = { dev: "b-cccccccccc" };

/** One scene: temp app home, project + roster, runtime, home and a fake core. */
async function scene(t, { version = "0.1.14", labels = { bot: ID.dev }, address = "t300", sandboxRow = true } = {}) {
  // A short root: the per-pane socket path must fit the platform's sun_path bound.
  const shortBase = existsSync("/tmp") ? "/tmp" : tmpdir();
  const root = realpathSync(mkdtempSync(join(shortBase, "hp-")));
  const app = join(root, "app"), project = join(root, "project"), home = join(root, "home"), runtime = join(root, "run");
  for (const dir of [app, join(app, "automagik-herdr"), project, join(project, ".herdr"), home, runtime]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(join(project, ".herdr", "bots.json"), `${JSON.stringify({ version: 1, categories: [], bots: [
    { id: ID.dev, name: "Dev", kind: "main", look: { character: "star", colour: "blue" }, role: "r", instructions: "i", agent: "dsh-tui" },
  ] }, null, 2)}\n`);
  const socket = join(root, "core.sock");
  const fake = await startFakeCore({ socket, version, terminals: [
    { address, name: "pane", labels, cwd: project, state: "live" },
  ] });
  t.after(async () => {
    try { await fake.close(); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  });
  const env = { ...process.env, XDG_RUNTIME_DIR: runtime, HOME: home, DSH_HOME: join(home, ".dsh"), HERDR_APP_HOME: app,
    HC_TERMINAL_ID: address, HC_TERMINAL_SOCKET: socket };
  if (sandboxRow) installSandboxRow({ env });
  return { root, app, project, home, runtime, socket, fake, env };
}

/** Run the helper with a child Node script that records the environment it was given. */
function runHelper(s, { bot = ID.dev, project = s.project, worker = false, out, childScript = envScript, extraArgs = [] } = {}) {
  const args = [HELPER, ...(bot ? ["--bot", bot] : []), ...(project ? ["--project", project] : []),
    ...(worker ? ["--worker"] : []), ...extraArgs, "--", process.execPath, "-e", childScript];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...s.env, PANE_OUT: out }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/** The child: prove the proxy socket exists now, then write what the helper set. */
const envScript = `
const fs = require("node:fs"), path = require("node:path");
const proxy = process.env.AM_HC_PROXY_SOCKET;
const info = { env: { mask: process.env.DSH_SANDBOX_MASK, real: process.env.AM_HC_REAL_SOCKET,
  proxy, hcSocket: process.env.HC_SOCKET }, socket: false, folderMode: null };
try {
  info.socket = fs.statSync(proxy).isSocket();
  info.folderMode = fs.statSync(path.dirname(proxy)).mode & 0o777;
} catch {}
fs.writeFileSync(process.env.PANE_OUT, JSON.stringify(info));
`;

test("one pane: the helper starts the proxy before the command and gives the pane the mask names", async (t) => {
  const s = await scene(t);
  const out = join(s.root, "child.json");
  const r = await runHelper(s, { out });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "", "the helper is quiet on a clean start");
  const got = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(got.env, { mask: "1", real: s.socket, proxy: join(s.runtime, "automagik-hc-proxy", "t300", "hc.sock"), hcSocket: s.socket });
  assert.equal(got.socket, true, "the proxy was listening when the command started");
  assert.equal(got.folderMode, 0o700, "the pane's own runtime folder is 0700");
  assert.equal(got.env.proxy.startsWith(`${s.runtime}/`), true);
  assert.equal(got.env.proxy.startsWith(s.project), false, "outside the project");
  assert.equal(got.env.proxy.startsWith(s.app), false, "outside the app home");
  assert.equal(existsSync(got.env.proxy), false, "the proxy socket is removed with the pane");
});

test("the helper refuses to start the pane when the proxy refuses (fail closed, no sandbox)", async (t) => {
  const s = await scene(t, { version: "0.1.13" });
  const out = join(s.root, "child.json");
  const r = await runHelper(s, { out });
  assert.notEqual(r.code, 0, "the pane command was not started");
  assert.match(r.stderr, /^hc-pane: /m);
  assert.match(r.stderr, /not the pinned 0\.1\.14/);
  assert.equal(existsSync(out), false, "the sandboxed command never ran");
  assert.equal(existsSync(join(s.runtime, "automagik-hc-proxy", "t300")), false, "no socket folder was made");
});

test("a worker pane starts the proxy with its worker.of caller", async (t) => {
  const s = await scene(t, { labels: { "worker.of": ID.dev }, address: "t302" });
  const out = join(s.root, "worker.json");
  const r = await runHelper(s, { worker: true, out });
  assert.equal(r.code, 0, r.stderr);
  const got = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(got.socket, true);
  assert.match(got.env.proxy, /\/automagik-hc-proxy\/t302\/hc\.sock$/);
});

test("a stale stable execution copy is refused before the proxy starts", async (t) => {
  const s = await scene(t);
  writeFileSync(join(sandboxRootOf(s.env), "hcPane.mjs"), "// stale\n");
  const out = join(s.root, "child.json");
  const r = await runHelper(s, { out });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /sandbox row is not current/);
  assert.equal(existsSync(out), false);
});

test("without the dsh-tui sandbox row the helper starts neither proxy nor pane (no fallback)", async (t) => {
  const s = await scene(t, { sandboxRow: false });
  const out = join(s.root, "child.json");
  const r = await runHelper(s, { out });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /sandbox row is not current/);
  assert.match(r.stderr, /automagik-herdr dsh-tui install/);
  assert.equal(existsSync(out), false);
  assert.equal(existsSync(join(s.runtime, "automagik-hc-proxy")), false);
});

test("the helper refuses a pane whose own label names another bot", async (t) => {
  const s = await scene(t, { labels: { bot: "b-zzzzzzzzzz" } });
  const out = join(s.root, "child.json");
  const r = await runHelper(s, { out });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /does not carry the bot label/);
  assert.equal(existsSync(out), false);
});

test("each pane gets its own proxy folder", async (t) => {
  const s = await scene(t);
  const outA = join(s.root, "a.json"), outB = join(s.root, "b.json");
  const a = await runHelper(s, { out: outA });
  assert.equal(a.code, 0, a.stderr);
  s.env.HC_TERMINAL_ID = "t301";
  s.fake.state.terminals.push({ address: "t301", name: "pane-b", labels: { bot: ID.dev }, cwd: s.project, state: "live" });
  const b = await runHelper(s, { out: outB });
  assert.equal(b.code, 0, b.stderr);
  const first = JSON.parse(readFileSync(outA, "utf8")).env.proxy;
  const second = JSON.parse(readFileSync(outB, "utf8")).env.proxy;
  assert.notEqual(dirname(first), dirname(second));
  assert.match(first, /\/automagik-hc-proxy\/t300\/hc\.sock$/);
  assert.match(second, /\/automagik-hc-proxy\/t301\/hc\.sock$/);
});

test("the helper runs when it is started through a symlink", async (t) => {
  const s = await scene(t);
  const link = join(s.root, "hcPane-link.mjs");
  symlinkSync(HELPER, link);
  const r = spawnSync(process.execPath, [link, "--help"], { env: s.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage: hcPane\.mjs/);
});

test("the pack's sandbox wrapper and helper are byte-equal to the DSH lane's sources", () => {
  const source = join(here, "..", "..", "apps", "dsh-sandbox", "bin");
  for (const name of ["hc-socket-mask.mjs", "dsh-sandbox.mjs"]) {
    const from = join(source, name), to = join(here, "..", "mods", "am-sidebar", "bin", name);
    assert.ok(readFileSync(from).equals(readFileSync(to)), `${to} is byte-equal to ${from}`);
    assert.ok(statSync(to).mode & 0o111, `${to} is executable`);
  }
});
