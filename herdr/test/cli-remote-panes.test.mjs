// automagik-herdr's pane commands on a linked machine (automagik#206 part b): start, attach,
// detach, restart and whois with --machine, against fake-hc's linked machine "vm" (a scratch
// home; its terminals are "vm/tN"). Shaped on the Atlas bot on lab: a Hermes pane under hc's
// keep wrapper, reporting no status. The ledger rows keep the bare terminal, `machine` and that
// machine's core id (bots.attach-ledger@1); whois keeps its shape (bots.whois-json@1). No call
// ever sends a pane keys. The real hc and window are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attachPath, readAttach } from "../mods/am-sidebar/attach.js";
import { readJsonLines } from "./log-lines.mjs";

const CLI = new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url).pathname;
const FAKE_HC = new URL("./fake-hc.mjs", import.meta.url).pathname;
const FAKE_APP = new URL("./fake-herdr-app.mjs", import.meta.url).pathname;
const FAKE_PGREP = new URL("./fake-pgrep.mjs", import.meta.url).pathname;
const CORE = "core-of-vm";
const ATLAS = "b-atlasaaaaa", HEDGE = "b-hedgeaaaaa";
const KEEP = ["sh", "-c", "\"$@\"; exec \"${SHELL:-sh}\" -i", "sh", "hermes", "--tui"];
const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };

function scene(t, { terminals = [], tui = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-panes-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"), home = join(root, "home"), app = join(root, "app"), vm = join(root, "vm"), vmBin = join(root, "vm-bin");
  for (const d of [bin, home, app, vm, vmBin]) mkdirSync(d, { recursive: true });
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  // Never the real window: a herdr-app that fails, first on PATH.
  exe(join(bin, "herdr-app"), "#!/bin/sh\necho \"no window in tests\" >&2\nexit 1\n");
  // On vm: hermes and claude are installed (what `command -v` finds there).
  exe(join(vmBin, "hermes"), "#!/bin/sh\nexit 0\n");
  exe(join(vmBin, "claude"), "#!/bin/sh\nexit 0\n");
  // A shell's children there (pgrep -P through hc exec): never the host's processes.
  exe(join(vmBin, "pgrep"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_PGREP}" "$@"\n`);
  // The owner's override, as programs.json holds it: Atlas runs the TUI.
  if (tui) writeFileSync(join(app, "programs.json"), JSON.stringify({ programs: { hermes: { run: ["hermes", "--tui"] } } }));
  const project = join(vm, "atlas");
  mkdirSync(project);
  execFileSync("git", ["init", "-q", project]);
  const look = { character: "star", colour: "blue" };
  mkdirSync(join(project, ".herdr"));
  writeFileSync(join(project, ".herdr/bots.json"), `${JSON.stringify({ version: 1, categories: [], bots: [
    { id: ATLAS, name: "Atlas", kind: "main", look, role: "incident agent", instructions: "", agent: "hermes" },
    { id: HEDGE, name: "Hedge", kind: "member", look, role: "r", instructions: "", agent: "claude" },
  ] }, null, 2)}\n`);
  const statePath = join(root, "hc.json"), logPath = join(root, "hc.log");
  writeFileSync(statePath, JSON.stringify({ next: 100, noStatus: ["hermes"], terminals: terminals.map((x) => ({ cwd: project, ...x })),
    machines: [{ name: "vm", id: CORE, state: "connected", uname: "Linux x86_64", home: vm, path: vmBin }] }));
  writeFileSync(logPath, "");
  const appState = join(root, "herdr-app.json"), appLog = join(root, "herdr-app.log");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, HERDR_APP_HOME: app, HC_FAKE_STATE: statePath, HC_FAKE_LOG: logPath,
    HERDR_APP_FAKE_STATE: appState, HERDR_APP_FAKE_LOG: appLog,
    AUTOMAGIK_HERDR_RESTART_STABLE_MS: "300", AUTOMAGIK_HERDR_RESTART_WAIT_MS: "4000", AUTOMAGIK_HERDR_TAB_WAIT_MS: "300" };
  // Run from a pane (t1), as a bot would: hc run's default parent is the calling terminal.
  env.HC_TERMINAL_ID = "t1";
  const cli = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  const on = ["--machine", "vm", "--project", project];
  const calls = () => readJsonLines(logPath);
  const hcState = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setState = (fn) => { const s = hcState(); fn(s); writeFileSync(statePath, JSON.stringify(s)); };
  const rows = () => (existsSync(attachPath(app)) ? readAttach(readFileSync(attachPath(app), "utf8")).rows : []);
  // A window that shows `spaces` (herdr-app ls); any other herdr-app call fails.
  const windowShows = (spaces) => {
    writeFileSync(join(root, "window.json"), JSON.stringify({ spaces }));
    exe(join(bin, "herdr-app"), `#!/bin/sh\n[ "$1" = ls ] && exec cat "${join(root, "window.json")}"\nexit 1\n`);
  };
  // fake-herdr-app.mjs as the window, from `state` (its space.new, tab.close and `place`).
  const fakeWindow = (state) => {
    writeFileSync(appState, JSON.stringify(state));
    writeFileSync(appLog, "");
    exe(join(bin, "herdr-app"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_APP}" "$@"\n`);
  };
  const appCalls = () => readJsonLines(appLog);
  const windowNow = () => JSON.parse(readFileSync(appState, "utf8"));
  return { root, project, app, home, cli, on, calls, hcState, setState, rows, windowShows, fakeWindow, appCalls, windowNow };
}

// The Atlas pane as lab/t8 is: live, under the keep wrapper, no status reported.
const atlasPane = (extra = {}) => ({ address: "vm/t8", name: null, state: "live", created_ms: 1700000000008, parent: null, labels: {},
  foreground: { argv: KEEP, name: "sh" }, status: null, ...extra });
const keysSent = (calls) => calls.filter((c) => ["send", "keys", "interrupt"].includes(c[0]));

test("start --machine: hc run --on there with the Mac's agent table (programs.json's hermes --tui); the row keeps tN, machine and its core", (t) => {
  const s = scene(t);
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  const out = r.json();
  assert.equal(out.terminal, "t100");
  assert.equal(out.machine, "vm");
  assert.deepEqual(out.argv, ["hermes", "--tui"], "the override, read on this computer, builds the command there");
  const run = s.calls().find((c) => c[0] === "run");
  assert.deepEqual(run.slice(0, 3), ["run", "--on", "vm"]);
  assert.ok(run.includes(`bot=${ATLAS}`) && run.includes(s.project));
  // Never the calling terminal as its hc parent (hc run's default), which it would end with.
  assert.ok(run.includes("--no-parent") && !run.includes("--parent"));
  const pane = s.hcState().terminals.find((x) => x.address === "vm/t100");
  assert.deepEqual([pane.parent, pane.die_with_parent], [null, false], "run from t1, still no parent: it never ends with t1");
  const [row] = s.rows();
  assert.deepEqual([row.event, row.terminal, row.machine, row.core, row.by], ["attach", "t100", "vm", CORE, "start"]);
  // A second start: already running, by its address.
  assert.match(s.cli(["start", "Atlas", ...s.on]).out, /Atlas is already running in vm\/t100/);
  assert.equal(s.calls().filter((c) => c[0] === "run").length, 1);
  // ls: its status from the pane there.
  const ls = s.cli(["ls", ...s.on, "--json"]).json().projects[0].bots.find((b) => b.id === ATLAS);
  assert.deepEqual([ls.terminal, ls.machine, ls.status], ["t100", "vm", "running"]);
  assert.deepEqual(keysSent(s.calls()), []);
});

test("start --machine lands in that machine's space on the project, in a tab of its own: never the space's selected tab", (t) => {
  const s = scene(t);
  s.windowShows([{ id: "sp-vm", folder: s.project, machine: "vm", active: true,
    tabs: [{ id: "tb-a", active: false }, { id: "tb-b", active: true }] }]);
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().space, r.json().tab], ["sp-vm", null]);
  const run = s.calls().find((c) => c[0] === "run");
  assert.ok(run.includes("herdr.space=sp-vm"), run.join(" "));
  assert.equal(run.some((a) => a.startsWith("herdr.tab=")), false, run.join(" "));
});

test("start --machine in a space it opened closes that space's shell tab only while it is the fresh bare idle shell", (t) => {
  // No space on the project there: space.new on vm makes one, its shell (vm/t-sh1, printed bare)
  // the one tab's one terminal; Herdr shows the bot (vm/t100) in a tab of its own.
  const s = scene(t);
  s.fakeWindow({ spaces: [], place: true });
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().space, r.json().tab], ["sp-new1", null]);
  // Never `confirmed`: Herdr asks the person only before closing a space's last tab.
  assert.deepEqual(s.appCalls().filter((c) => c[0] === "do").map((c) => [c[1], JSON.parse(c[2])]),
    [["space.new", { name: "atlas", folder: s.project, machine: "vm" }], ["tab.close", { id: "tb-new1" }]]);
  assert.deepEqual(s.windowNow().spaces.map((x) => [x.id, x.tabs.map((tb) => tb.id)]), [["sp-new1", ["tb-vm/t100"]]]);
  // Its shell was asked of hc there, and its children of that machine (pgrep -P through hc exec).
  assert.ok(s.calls().some((c) => c[0] === "get" && c[1] === "vm/t-sh1"), JSON.stringify(s.calls()));
  assert.ok(s.calls().some((c) => c[0] === "exec" && c.includes("vm") && c.slice(-3).join(" ") === "pgrep -P 9001"));
  // Kept: vim in front of the shell, a job left running at its prompt, its children unknown.
  for (const extra of [{ shellBusy: true }, { shellJob: true }, { shellUnknown: true }, { shellPgrepError: true },
    { shellPgrepKilled: true }]) {
    const k = scene(t);
    k.fakeWindow({ spaces: [], place: true, ...extra });
    const kr = k.cli(["start", "Atlas", ...k.on]);
    assert.equal(kr.code, 0, kr.err);
    assert.deepEqual(k.appCalls().filter((c) => c[0] === "do").map((c) => c[1]), ["space.new"], JSON.stringify(extra));
    assert.deepEqual(k.windowNow().spaces[0].tabs.map((tb) => tb.id), ["tb-new1", "tb-vm/t100"], JSON.stringify(extra));
  }
  // A bot Herdr doesn't show in time: the shell's tab is the space's only one, kept.
  const n = scene(t);
  n.fakeWindow({ spaces: [] });
  assert.equal(n.cli(["start", "Atlas", ...n.on]).code, 0);
  assert.deepEqual(n.appCalls().filter((c) => c[0] === "do").map((c) => c[1]), ["space.new"]);
  assert.deepEqual(n.windowNow().spaces[0].tabs.map((tb) => tb.id), ["tb-new1"]);
  // A space of vm open on the project already is never this start's: nothing is closed there.
  const o = scene(t);
  o.fakeWindow({ place: true, spaces: [{ id: "sp-vm", name: "atlas", folder: o.project, machine: "vm", active: true,
    tabs: [{ id: "tb-a", name: "1", active: true, terminals: [{ terminal: "vm/t-sh9", pane: "p9" }] }] }] });
  assert.equal(o.cli(["start", "Atlas", ...o.on]).code, 0);
  assert.deepEqual(o.appCalls().filter((c) => c[0] === "do"), []);
  // (No spare to close, so the window isn't read again: the fake never adds the bot's tab.)
  assert.deepEqual(o.windowNow().spaces[0].tabs.map((tb) => tb.id), ["tb-a"]);
});

test("start --machine: an agent not installed there is refused before anything runs; without the override, plain hermes", (t) => {
  const s = scene(t, { tui: false });
  const plain = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(plain.code, 0, plain.err);
  assert.deepEqual(plain.json().argv, ["hermes"]);
  s.setState((st) => { st.machines[0].path = null; });
  const r = s.cli(["start", "Hedge", ...s.on]);
  assert.equal(r.code, 1);
  assert.match(r.err, /isn't installed on vm/);
  assert.equal(s.calls().filter((c) => c[0] === "run").length, 1);
});

test("start --machine of a Claude bot: started with a warning and no briefing hook anywhere (part b2 installs it)", (t) => {
  const s = scene(t);
  const r = s.cli(["start", "Hedge", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /Hedge runs on vm without its per-turn briefing/);
  assert.match(r.json().warnings.join(" "), /automagik-herdr machine install vm/);
  assert.equal(existsSync(join(s.project, ".claude")), false, "no hook there pointing at a missing briefing.mjs");
  assert.equal(existsSync(join(s.home, ".claude")), false);
});

test("attach --machine vm/t8 as it is: labels only, the row's terminal is t8; whois keeps its shape, no '/' in it", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  const r = s.cli(["attach", "Atlas", "vm/t8", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().terminal, r.json().machine], ["t8", "vm"]);
  const [row] = s.rows();
  assert.deepEqual([row.terminal, row.machine, row.core, row.by, row.created_ms], ["t8", "vm", CORE, "attach", 1700000000008]);
  assert.ok(s.calls().some((c) => c[0] === "label" && c[1] === "vm/t8" && c.includes(`bot=${ATLAS}`)));
  // The bare id with --machine names the same pane.
  assert.match(s.cli(["attach", "Atlas", "t8", ...s.on]).out, /Atlas is already vm\/t8/);
  for (const args of [["whois", "vm/t8", "--json"], ["whois", "t8", "--machine", "vm", "--json"], ["whois", "--bot", ATLAS, "--machine", "vm", "--json"]]) {
    const w = s.cli(args);
    assert.equal(w.code, 0, w.err);
    const out = w.json();
    assert.deepEqual(Object.keys(out).sort(), ["bot", "core", "created_ms", "project", "since", "terminal"], "bots.whois-json@1's keys");
    assert.deepEqual([out.terminal, out.core, out.bot], ["t8", CORE, ATLAS]);
    assert.ok(!Object.entries(out).some(([k, v]) => k !== "project" && typeof v === "string" && v.includes("/")), "no machine address in whois");
  }
  // Its status: the agent under the keep wrapper is in front, though it reports none.
  const ls = s.cli(["ls", ...s.on, "--json"]).json().projects[0].bots.find((b) => b.id === ATLAS);
  assert.deepEqual([ls.terminal, ls.status], ["t8", "running"]);
  assert.deepEqual(keysSent(s.calls()), []);
});

test("attach: a machine's terminal with another project, or this computer's, is refused", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  assert.match(s.cli(["attach", "Atlas", "other/t8", ...s.on]).err, /other\/t8 is on other/);
  const here = s.cli(["attach", "Atlas", "vm/t8"]);
  assert.equal(here.code, 2);
  assert.match(here.err, /vm\/t8 is on vm; name the bot's project there/);
});

test("restart --machine of a pane that reports no status: refused in plain words; --force starts hermes --tui --continue, then ends the old one", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  const refused = s.cli(["restart", "Atlas", ...s.on]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /vm\/t8 doesn't tell hc whether Atlas's agent is busy or waiting for an approval/);
  assert.match(refused.err, /pass --force to restart anyway \(it sends the pane no keys/);
  assert.equal(s.calls().filter((c) => c[0] === "run" || c[0] === "kill").length, 0);
  const r = s.cli(["restart", "Atlas", ...s.on, "--force", "--json"]);
  assert.equal(r.code, 0, r.err);
  const out = r.json();
  assert.deepEqual([out.terminal, out.machine, out.replaced, out.mode], ["t100", "vm", "t8", "resume"]);
  assert.deepEqual(out.argv, ["hermes", "--tui", "--continue"], "Hermes' own resume of the folder's latest conversation");
  const run = s.calls().find((c) => c[0] === "run");
  assert.ok(run.includes("--cwd") && run[run.indexOf("--cwd") + 1] === s.project);
  // The old pane ends only after the new one: run, then kill of vm/t8.
  const order = s.calls().map((c) => `${c[0]} ${c[1] ?? ""}`).filter((x) => /^(run|kill) /.test(x));
  assert.deepEqual(order.map((x) => x.split(" ")[0]), ["run", "kill"]);
  assert.ok(order[1].endsWith("vm/t8"));
  const rows = s.rows();
  assert.deepEqual(rows.slice(-2).map((x) => [x.event, x.terminal, x.machine, x.reason ?? null]), [["detach", "t8", "vm", "moved"], ["attach", "t100", "vm", null]]);
  assert.deepEqual(keysSent(s.calls()), [], "never a key to the pane, so never an approval answered");
});

test("restart --machine: --continue is refused while another bot's same agent runs in that folder there", (t) => {
  const s = scene(t, { terminals: [atlasPane({ status: { state: "idle", app: "hermes" } }), atlasPane({ address: "vm/t9", created_ms: 9 })] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  assert.equal(s.cli(["attach", "Hedge", "vm/t9", ...s.on]).code, 0);
  // No session id: refused unless --force; with --force, refused while another pane shares the folder.
  assert.match(s.cli(["restart", "Atlas", ...s.on]).err, /carries no session id/);
  const r = s.cli(["restart", "Atlas", ...s.on, "--force"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Hedge \(vm\/t9\) also runs Hermes/);
  assert.equal(s.calls().filter((c) => c[0] === "run").length, 0);
});

test("detach --machine: the detach row and the labels off the pane there", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  const r = s.cli(["detach", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().detached, r.json().machine], [["t8"], "vm"]);
  assert.deepEqual(s.rows().at(-1).event, "detach");
  assert.ok(s.calls().some((c) => c[0] === "label" && c[1] === "vm/t8" && c.includes("bot=")));
});

test("a machine away: its rows stay as saved (unknown), never ended; start and whois there are refused, not guessed", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  s.setState((st) => { st.machines[0].state = "disconnected"; });
  const ls = s.cli(["ls", ...s.on, "--json"]);
  assert.equal(ls.code, 1, "the file there can't be read either");
  assert.match(ls.err, /vm/);
  // This computer has no Atlas pane; vm's can't be asked while it is away.
  assert.equal(s.cli(["whois", "--bot", ATLAS, "--json"]).json().terminal, null);
  assert.match(s.cli(["whois", "--bot", ATLAS, "--machine", "vm"]).err, /vm isn't connected/);
  assert.match(s.cli(["whois", "vm/t8"]).err, /vm isn't connected/);
  assert.equal(s.rows().filter((r) => r.event === "end").length, 0, "never ended while away");
  s.setState((st) => { st.machines[0].state = "connected"; });
  assert.equal(s.cli(["whois", "--bot", ATLAS, "--machine", "vm", "--json"]).json().terminal, "t8", "back: as it was");
});

// A project's checkouts on two machines share their bots' ids: Atlas is also bound on this computer (t4).
const localAtlas = (s) => {
  mkdirSync(join(s.app, "automagik-herdr"), { recursive: true });
  writeFileSync(attachPath(s.app), `${JSON.stringify({ v: 1, event: "attach", bot: ATLAS, project: "/Users/me/atlas", terminal: "t4", core: "fakecore0000",
    created_ms: 4, machine: null, at: "2026-11-01T00:00:00.000Z", by: "attach" })}\n`, { mode: 0o600 });
};
const localPane = { address: "t4", name: "atlas-here", state: "live", created_ms: 4, parent: null, labels: { bot: ATLAS },
  foreground: { argv: ["hermes"], cwd: "/Users/me/atlas" }, status: { state: "idle", app: "hermes" } };
const touched = (calls, t) => calls.filter((c) => ["kill", "label", "send", "keys", "interrupt"].includes(c[0]) && c[1] === t);

test("a same-id bot on this computer is never touched by --machine: start, restart and detach act on that machine's only", (t) => {
  const s = scene(t, { terminals: [atlasPane(), localPane] });
  localAtlas(s);
  const start = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(start.code, 0, start.err);
  assert.equal(start.json().terminal, "t100", "started there, not 'already running in t4'");
  const restart = s.cli(["restart", "Atlas", ...s.on, "--force", "--fresh", "--json"]);
  assert.equal(restart.code, 0, restart.err);
  assert.equal(restart.json().replaced, "t100");
  assert.ok(s.calls().some((c) => c[0] === "kill" && c[1] === "vm/t100"));
  const detach = s.cli(["detach", "Atlas", ...s.on, "--json"]);
  assert.equal(detach.code, 0, detach.err);
  assert.deepEqual([detach.json().detached, detach.json().machine], [["t101"], "vm"]);
  assert.deepEqual(touched(s.calls(), "t4"), [], "t4 never killed, relabelled or sent anything");
  assert.equal(s.cli(["whois", "--bot", ATLAS, "--json"]).json().terminal, "t4", "this computer's Atlas still plays t4");
});

test("restart --machine: an old pane whose id is another terminal by the kill is left alone, and says so", (t) => {
  const s = scene(t, { terminals: [atlasPane({ status: { state: "idle", app: "hermes" }, labels: {} })] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  s.setState((st) => { const p = st.terminals.find((x) => x.address === "vm/t8"); p.reuseAfterGets = 1; p.reuseCreated = 77; });
  const r = s.cli(["restart", "Atlas", ...s.on, "--fresh"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /vm\/t8 is another terminal now \(its created_ms changed\), so it wasn't ended/);
  assert.deepEqual(s.calls().filter((c) => c[0] === "kill"), []);
});

test("start --machine: hc run that answers no address has its pane ended by name, never left beside the bot's", (t) => {
  const s = scene(t);
  s.setState((st) => { st.runNoAddress = true; });
  const r = s.cli(["start", "Atlas", ...s.on]);
  assert.equal(r.code, 1);
  assert.match(r.err, /gave no terminal address .*the pane it started \(vm\/t100, named atlas\) was ended/);
  assert.ok(s.calls().some((c) => c[0] === "kill" && c[1] === "vm/t100"));
  assert.deepEqual(s.rows(), []);
});

test("restart --machine resumes by id when the pane carries a session (--resume <id>); a label it can't use still meets the shared-folder refusal", (t) => {
  const pane = (extra) => atlasPane({ status: { state: "idle", app: "hermes" }, ...extra });
  const s = scene(t, { terminals: [pane({ labels: { "agent.session": "atlas-sess-1" } }), pane({ address: "vm/t9", created_ms: 9 })] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  assert.equal(s.cli(["attach", "Hedge", "vm/t9", ...s.on]).code, 0);
  const r = s.cli(["restart", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().argv, ["hermes", "--tui", "--resume", "atlas-sess-1"], "its own conversation, by id, though Hedge shares the folder");
  assert.equal(r.json().session, "atlas-sess-1");
  const now = s.hcState().terminals.find((x) => x.address === "vm/t100");
  assert.equal(now.labels["agent.session"], "atlas-sess-1", "carried, so the next restart resumes it too");
  // A label that can't be an id ("-x"): no --resume, so still refused while Hedge shares the folder, even with --force.
  const s2 = scene(t, { terminals: [pane({ labels: { "agent.session": "-x" } }), pane({ address: "vm/t9", created_ms: 9 })] });
  assert.equal(s2.cli(["attach", "Atlas", "vm/t8", ...s2.on]).code, 0);
  assert.equal(s2.cli(["attach", "Hedge", "vm/t9", ...s2.on]).code, 0);
  const forced = s2.cli(["restart", "Atlas", ...s2.on, "--force"]);
  assert.equal(forced.code, 1);
  assert.match(forced.err, /Hedge \(vm\/t9\) also runs Hermes/);
  assert.equal(s2.calls().filter((c) => c[0] === "run").length, 0);
});

test("restart --machine #413: codex can't resume a thread whose model provider is gone: one new pane there on a new thread, the old id in the note", (t) => {
  const thread = "0f3c2a4e-1b2d-4c5e-9f60-718293a4b5c6";
  const gone = "Error: model provider example-proxy is no longer configured (modelProviderNotConfigured)";
  const s = scene(t, { terminals: [{ address: "vm/t9", name: null, state: "live", created_ms: 1700000000009, parent: null,
    labels: { "agent.session": thread }, foreground: { argv: ["codex", "resume", thread], name: "codex" }, status: { state: "idle", app: "codex" } }] });
  const file = join(s.project, ".herdr/bots.json");
  writeFileSync(file, readFileSync(file, "utf8").replace(/"agent": "claude"/, '"agent": "codex"'));
  writeFileSync(join(s.root, "vm-bin", "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.equal(s.cli(["attach", "Hedge", "vm/t9", ...s.on]).code, 0);
  s.setState((st) => { st.runQueue = [{ runAs: "exit", screen: `${gone}\n$ ` }]; });
  const r = s.cli(["restart", "Hedge", ...s.on, "--force", "--json"]);
  assert.equal(r.code, 0, r.err);
  const runs = s.calls().filter((c) => c[0] === "run");
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].slice(-2), ["resume", thread], "it tried the thread first");
  assert.ok(!runs[1].includes("resume"), "then a new thread");
  const out = r.json();
  assert.deepEqual([out.mode, out.terminal, out.replaced], ["fresh", "t101", "t9"]);
  assert.equal(out.note, `codex can't resume thread ${thread} (vm/t100 said "${gone}"), so it starts on a new one`);
  assert.ok(out.warnings.some((w) => w.includes(`thread ${thread}`)));
  assert.equal(s.hcState().terminals.find((x) => x.address === "vm/t101").labels["agent.session"], undefined);
  assert.ok(s.calls().some((c) => c[0] === "kill" && c[1] === "vm/t9"), "the old pane ends once the new one is up");
});
