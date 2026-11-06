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
import { DEADLINE_CALL_MS, DEADLINE_MARGIN_MS, DEADLINE_PLACE_MS } from "../mods/am-sidebar/bin/automagik-herdr.mjs";
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
  const cli = (args, more = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env: { ...env, ...more }, encoding: "utf8" });
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

test("restart --machine names a pane's stale flags without their values (#597 review F2/F4)", (t) => {
  const stale = ["/usr/bin/env", "PATH=/old", "hermes", "--tui", "--proxy=http://user:token@proxy.example:8080"];
  const s = scene(t, { terminals: [atlasPane({ status: { state: "idle", app: "hermes" }, argv: stale })] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  const r = s.cli(["restart", "Atlas", ...s.on, "--force", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /Atlas: its pane's command differs from its source now \(drops --proxy=\*\*\*\): restarting from the source/);
  assert.equal(r.err.includes("proxy.example"), false, "the value is masked");
  assert.equal(r.err.includes("user:token"), false, "the URL's userinfo is masked");
  const run = s.calls().find((c) => c[0] === "run");
  assert.ok(run.includes("--proxy=http://user:token@proxy.example:8080") === false, "the source's command, never the pane's flag");
});

test("restart --machine --tree is refused before anything is read there (#437): the bot and its helper keep running, and what to do by hand is said", (t) => {
  const helper = atlasPane({ address: "vm/t9", created_ms: 1700000000009, parent: "vm/t8", die_with_parent: true, status: { state: "idle", app: "claude" } });
  const s = scene(t, { terminals: [atlasPane({ status: { state: "idle", app: "hermes" } }), helper] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  const before = s.calls().length;
  for (const extra of [[], ["--force"], ["--fresh"], ["--fresh-shared"], ["--json"]]) {
    const r = s.cli(["restart", "Atlas", ...s.on, "--tree", ...extra]);
    assert.equal(r.code, 2, extra.join(" "));
    assert.match(r.err, /Restarting a bot's helpers on a linked machine isn't built yet, so nothing was read or restarted: Atlas and its helpers on vm still run as they were, on the account they started with./);
    assert.match(r.err, /By hand: wait for a helper still working to finish, end each helper's pane \(hc kill vm\/tN for one\), then restart Atlas there without --tree\. A helper that still had work to do, start again yourself with hc run on vm once Atlas is back\./);
    assert.doesNotMatch(r.err, /--force/, "--force would drop the other checks too (a bot mid-turn)");
    assert.equal(r.out, "", "--json prints nothing, as the other flag refusals on a linked machine");
  }
  assert.deepEqual(s.calls().slice(before), [], "not one hc call: nothing read, started or ended there");
  assert.deepEqual(s.hcState().terminals.map((x) => [x.address, x.state]), [["vm/t8", "live"], ["vm/t9", "live"]]);
  assert.deepEqual(s.rows().map((x) => [x.event, x.terminal]), [["attach", "t8"]], "the ledger still has Atlas in t8");
});

test("restart --machine of a bot whose helper ends with its pane there (#437): never offers --tree or --force; ending the finished helper's pane by hand, as it says, lets the restart through", (t) => {
  // A finished worker keeps its pane open: live, its agent done, and it ends with its parent.
  const helper = atlasPane({ address: "vm/t9", created_ms: 1700000000009, parent: "vm/t8", die_with_parent: true, status: { state: "done", app: "claude" } });
  const s = scene(t, { terminals: [atlasPane({ status: { state: "idle", app: "hermes" } }), helper] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  const r = s.cli(["restart", "Atlas", ...s.on, "--fresh", "--json"]);
  assert.equal(r.code, 1);
  const said = "vm/t8 has a helper that ends with it: vm/t9. Restarting helpers on a linked machine isn't built yet, so nothing was restarted. "
    + "End its pane (hc kill vm/t9) and restart Atlas again.";
  assert.deepEqual(r.json(), { error: said, refused: "helpers", terminal: "vm/t8" }, "the --json shape of a busy refusal, unchanged");
  assert.doesNotMatch(r.err, /--tree|--force/);
  // Still working: wait for it first.
  s.setState((st) => { st.terminals.find((x) => x.address === "vm/t9").status = { state: "working", app: "claude" }; });
  const busy = s.cli(["restart", "Atlas", ...s.on, "--fresh"]);
  assert.equal(busy.code, 1);
  assert.match(busy.err, /Wait for vm\/t9 to finish, then end its pane \(hc kill vm\/t9\) and restart Atlas again\./);
  assert.doesNotMatch(busy.err, /--tree|--force/);
  assert.equal(s.calls().filter((c) => c[0] === "run" || c[0] === "kill").length, 0, "nothing started or ended");
  // Done as it says: the helper's pane ended, the same restart goes through.
  s.setState((st) => { Object.assign(st.terminals.find((x) => x.address === "vm/t9"), { state: "finished", status: { state: "done", app: "claude" } }); });
  const ok = s.cli(["restart", "Atlas", ...s.on, "--fresh", "--json"]);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual([ok.json().machine, ok.json().replaced], ["vm", "t8"]);
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

// ---- the agent's PATH there (#425): herdr-core as a service never read ~/.profile ----

/** What the pane was started with: the argv after hc run's `--`. */
const launched = (s) => { const run = s.calls().find((c) => c[0] === "run"); return run.slice(run.indexOf("--") + 1); };
/** Runs that argv with nothing in its environment, as a pane there would: proof the launch works. */
const pane = (argv) => spawnSync(argv[0], argv.slice(1), { env: {}, encoding: "utf8" });
const execs = (s) => s.calls().filter((c) => c[0] === "exec");
const SAYS = "#!/bin/sh\necho agent ran\n";

/** An agent only the login shell reaches, under an interpreter only it reaches too (codex under node). */
function loginOnly(s, { noise } = {}) {
  rmSync(join(s.root, "vm-bin/hermes"));
  const dir = join(s.root, "vm/.nvm-like/bin");
  mkdirSync(dir, { recursive: true });
  exe(join(dir, "hermes"), "#!/usr/bin/env fakenode\n");
  exe(join(dir, "fakenode"), SAYS);
  s.setState((st) => { st.machines[0].login = { path: `${dir}:/usr/bin:/bin`, noise }; });
  return dir;
}

test("start --machine: an agent only the login shell finds passes the check and the pane gets that PATH, so it really runs", (t) => {
  const s = scene(t);
  const dir = loginOnly(s);
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().warnings, []);
  assert.deepEqual(r.json().argv, ["hermes", "--tui"], "the agent's own words, never rewritten");
  const argv = launched(s);
  assert.equal(argv[0], "/usr/bin/env");
  assert.ok(argv[1].startsWith(`PATH=${dir}:`), argv[1]);
  assert.deepEqual(argv.slice(2), ["hermes", "--tui"]);
  assert.ok(argv[1].includes(join(s.root, "vm-bin")), "what hc's own PATH reached stays reachable");
  assert.equal(pane(argv).stdout, "agent ran\n");
  // Bounded, and only ever on the machine: the login shell's call and the check both.
  for (const c of execs(s).slice(-3)) assert.deepEqual([c[c.indexOf("--timeout") + 1], c[c.indexOf("--on") + 1]], ["10", "vm"]);
});

test("restart --machine: the same check and the same PATH, and the old pane ends only after", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  const dir = loginOnly(s);
  const r = s.cli(["restart", "Atlas", ...s.on, "--force", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().argv, ["hermes", "--tui", "--continue"]);
  const argv = launched(s);
  assert.ok(argv[1].startsWith(`PATH=${dir}:`), argv[1]);
  assert.deepEqual(argv.slice(2), ["hermes", "--tui", "--continue"]);
  assert.equal(pane(argv).stdout, "agent ran\n");
  assert.deepEqual(s.calls().map((c) => c[0]).filter((c) => c === "run" || c === "kill"), ["run", "kill"]);
});

test("restart --machine: an agent really missing there is refused and the old pane is left running", (t) => {
  const s = scene(t, { terminals: [atlasPane()] });
  assert.equal(s.cli(["attach", "Atlas", "vm/t8", ...s.on]).code, 0);
  rmSync(join(s.root, "vm-bin/hermes"));
  const r = s.cli(["restart", "Atlas", ...s.on, "--force"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Hermes[^\n]* \(hermes\) isn't installed on vm/);
  assert.deepEqual(s.calls().filter((c) => c[0] === "run" || c[0] === "kill"), []);
});

test("start --machine: a broken login shell falls back to the user bin folders, for the check and the pane, and says so", (t) => {
  const s = scene(t);
  rmSync(join(s.root, "vm-bin/hermes"));
  mkdirSync(join(s.root, "vm/.local/bin"), { recursive: true });
  exe(join(s.root, "vm/.local/bin/hermes"), SAYS);
  s.setState((st) => { st.machines[0].login = { exit: "1" }; });
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.json().warnings.join(), /vm's login shell gave no PATH, so Hermes starts with the PATH hc runs programs with there/);
  assert.equal(pane(launched(s)).stdout, "agent ran\n");
});

test("start --machine: a login shell that never answers is ended at the bound; ~/.bun/bin still finds the agent", (t) => {
  const s = scene(t);
  rmSync(join(s.root, "vm-bin/hermes"));
  mkdirSync(join(s.root, "vm/.bun/bin"), { recursive: true });
  exe(join(s.root, "vm/.bun/bin/hermes"), SAYS);
  s.setState((st) => { st.execTimedOut = ["-lc"]; });
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.json().warnings.join(), /vm's login shell didn't answer within 10 s/);
  assert.equal(pane(launched(s)).stdout, "agent ran\n");
});

test("start --machine: a stalled login shell over a slow link gets the warning and the fallback, never \"can't be reached\"", (t) => {
  const s = scene(t);
  rmSync(join(s.root, "vm-bin/hermes"));
  mkdirSync(join(s.root, "vm/.bun/bin"), { recursive: true });
  exe(join(s.root, "vm/.bun/bin/hermes"), SAYS);
  // hc's own 10 s plus 6 s of link: past the 15 s a plain hc call gets, inside the 20 s this one does.
  s.setState((st) => { st.execTimedOut = ["-lc"]; st.execTimedOutAfterMs = 16000; });
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.json().warnings.join(), /vm's login shell didn't answer within 10 s/);
  assert.equal(pane(launched(s)).stdout, "agent ran\n");
});

test("start --machine: really missing keeps the refusal, whether or not the login shell answered, and nothing runs", (t) => {
  const s = scene(t);
  rmSync(join(s.root, "vm-bin/hermes"));
  const r = s.cli(["start", "Atlas", ...s.on]);
  assert.equal(r.code, 1);
  assert.match(r.err, /\(hermes\) isn't installed on vm, or isn't on the PATH hc runs programs with there, its login shell's PATH, ~\/\.local\/bin or ~\/\.bun\/bin\./);
  s.setState((st) => { st.execTimedOut = ["-lc"]; });
  const slow = s.cli(["start", "Atlas", ...s.on]);
  assert.equal(slow.code, 1);
  assert.match(slow.err, /isn't installed on vm.*\(vm's login shell didn't answer within 10 s\)\./);
  assert.deepEqual(s.calls().filter((c) => c[0] === "run"), []);
});

test("start --machine: a profile that prints to stdout is only text: its lines are never run, and never reach the PATH", (t) => {
  const s = scene(t);
  const canary = join(s.root, "ran-profile-output");
  const dir = loginOnly(s, { noise: `Welcome to vm!\nPATH=/evil:/bin\n$(touch ${canary})\n\`touch ${canary}\`\ntouch ${canary}; am-path-0-from/evil\n` });
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().warnings, [], "the marker's line was found past the noise");
  const argv = launched(s);
  assert.ok(argv[1].startsWith(`PATH=${dir}:`), argv[1]);
  assert.ok(!argv[1].includes("evil") && !argv[1].includes("Welcome"), argv[1]);
  assert.equal(existsSync(canary), false);
});

test("start --machine: an agent whose interpreter a pane there couldn't find is refused, never a dead pane", (t) => {
  const s = scene(t);
  rmSync(join(s.root, "vm-bin/hermes"));
  exe(join(s.root, "vm-bin/hermes"), "#!/usr/bin/env no-such-runtime\n");
  const r = s.cli(["start", "Atlas", ...s.on]);
  assert.equal(r.code, 1);
  assert.match(r.err, /runs under no-such-runtime, which isn't on the PATH a pane on vm gets/);
  assert.deepEqual(s.calls().filter((c) => c[0] === "run"), []);
});

test("start --machine: a slow login shell's interpreter refusal says the shell was quiet, as the missing refusal does", (t) => {
  const s = scene(t);
  rmSync(join(s.root, "vm-bin/hermes"));
  exe(join(s.root, "vm-bin/hermes"), "#!/usr/bin/env no-such-runtime\n");
  s.setState((st) => { st.execTimedOut = ["-lc"]; });
  const r = s.cli(["start", "Atlas", ...s.on]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Put no-such-runtime on the PATH of vm's login shell \(vm's login shell didn't answer within 10 s\)\./);
  assert.deepEqual(s.calls().filter((c) => c[0] === "run"), []);
});

test("start --machine: a working machine keeps hc's copy of the agent and its interpreter, whatever the login shell's PATH shadows", (t) => {
  const s = scene(t);
  const login = join(s.root, "vm/login-bin");
  mkdirSync(login);
  exe(join(s.root, "vm-bin/hermes"), "#!/usr/bin/env fakenode\n");
  exe(join(s.root, "vm-bin/fakenode"), SAYS);
  exe(join(login, "hermes"), "#!/usr/bin/env no-such-runtime\n");
  exe(join(login, "fakenode"), "#!/bin/sh\nexit 1\n");
  s.setState((st) => { st.machines[0].login = { path: `${login}:/usr/bin:/bin` }; });
  const r = s.cli(["start", "Atlas", ...s.on, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch((r.json().warnings ?? []).join(), /login shell/);
  assert.equal(pane(launched(s)).stdout, "agent ran\n");
});

test("start --machine: a machine that stops answering is refused as unreachable, asked once, and nothing runs", (t) => {
  const s = scene(t);
  s.setState((st) => { st.execUnanswered = ["sh"]; });
  const r = s.cli(["start", "Atlas", ...s.on]);
  assert.equal(r.code, 1);
  assert.match(r.err, /vm can't be reached: vm stopped answering/);
  assert.doesNotMatch(r.err, /isn't installed/);
  assert.deepEqual(s.calls().filter((c) => c[0] === "run"), []);
  assert.equal(execs(s).filter((c) => c.includes("sh")).length, 1, "no second wait on a machine that is away");
});

test("start --machine under the sidebar's 30 s deadline (#444): too little left -> nothing started, the terminal command; enough -> started", (t) => {
  const s = scene(t);
  // The margin: hc run and at most two more calls at DEADLINE_CALL_MS each, 1 s for the row and the exit.
  assert.equal(DEADLINE_MARGIN_MS, 3 * DEADLINE_CALL_MS + 1000);
  const late = s.cli(["start", "Atlas", ...s.on], { AUTOMAGIK_HERDR_DEADLINE: String(Date.now() + 5000) });
  assert.equal(late.code, 1, late.err);
  assert.match(late.err, /Only \d s of this Herdr's 30 s limit for the sidebar's programs was left, and starting Atlas on vm needs 20 s to finish once its pane starts, so nothing was started\. /);
  assert.ok(late.err.trim().endsWith(`Start it from a terminal: automagik-herdr start ${ATLAS} --project ${s.project} --machine vm`), late.err);
  assert.equal((DEADLINE_MARGIN_MS + DEADLINE_PLACE_MS) / 1000, 20);
  assert.deepEqual(s.calls().filter((c) => c[0] === "run"), []);
  assert.deepEqual(s.rows(), []);
  // With the whole 30 s ahead the start goes on: hc run there, and its row.
  const r = s.cli(["start", "Atlas", ...s.on, "--json"], { AUTOMAGIK_HERDR_DEADLINE: String(Date.now() + 30_000) });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().terminal, "t100");
  assert.equal(s.calls().filter((c) => c[0] === "run").length, 1);
  assert.deepEqual(s.rows().map((x) => [x.event, x.terminal, x.machine]), [["attach", "t100", "vm"]]);
});
