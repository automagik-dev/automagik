// The Automations panel (am-automations) without its scheduler (#220): one line says what is
// missing, the exact install command is shown and copied by Copy, nothing runs it, and the panel
// finds the scheduler once it is installed. gpui and herdr are stood in for (gpui-stub.mjs,
// am-automations-herdr.mjs); the in-app check in the mod's RECIPE still applies.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./am-automations-herdr.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
const fromMod = (context) => context.parentURL?.includes("/mods/am-automations/");
registerHooks({
  resolve: (specifier, context, next) =>
    stubs[specifier] && fromMod(context) ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context),
});

const { state } = await import(stubs.herdr);
const { nodes, index, textOf } = await import(stubs["gpui-kit"]);
const { default: Automations, SCHEDULER, repairCommand } = await import("../mods/am-automations/main.js");

function makeCx() {
  const cx = { pending: [], ticks: [], clipboard: [],
    spawn(fn) { const p = Promise.resolve().then(() => fn(cx)); cx.pending.push(p); return p; },
    timer: { every: (_ms, fn) => { cx.ticks.push(fn); return { cancel() {} }; } },
    focus_handle: () => ({}), notify() {}, stop_propagation() {}, write_to_clipboard(x) { cx.clipboard.push(x); } };
  cx.settle = async () => { while (cx.pending.length) await Promise.allSettled(cx.pending.splice(0)); };
  return cx;
}

/** An exec where only `uname -m` answers, unless `scheduler` names a binary that does too. */
function answer({ machine = "arm64", scheduler = null } = {}) {
  state.exec = async (command, args) => {
    if (command === "uname") return { code: 0, stdout: `${machine}\n`, stderr: "" };
    if (command !== scheduler) return { code: 127, stdout: "", stderr: `cannot run ${command}: no such file` };
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ automations: [], invalid: [], scheduler: { pid: 1 }, paused: false }), stderr: "" };
    if (args[0] === "history") return { code: 0, stdout: "[]", stderr: "" };
    return { code: 0, stdout: "0.12.1\n", stderr: "" };
  };
}

async function panel() {
  state.calls = [];
  const cx = makeCx();
  const view = new Automations();
  view.init({}, cx);
  await cx.settle();
  return { view, cx, draw: () => { index(view.render(cx)); return nodes; } };
}

test("the repair command: our pinned release for this Mac's arch, hash-checked, into ~/.local/bin", () => {
  const arm = repairCommand("arm64");
  assert.match(arm, /\/automagik-dev\/automagik\/releases\/download\/herdr-automations-v0\.12\.1-am\.1\/herdr-automations_darwin_arm64 /);
  assert.ok(arm.includes(`echo "${SCHEDULER.sha256.arm64}  herdr-automations" | shasum -a 256 -c`));
  assert.match(arm, /shasum -a 256 -c && chmod 755 herdr-automations && mv herdr-automations ~\/\.local\/bin\/; s=\$\?; /, "moved in only once the hash matches");
  // Its scratch folder goes whether it worked or not, and the subshell keeps the install's status.
  assert.ok(arm.startsWith('(mkdir -p ~/.local/bin && d="$(mktemp -d)" && cd "$d" && curl '));
  assert.ok(arm.endsWith('; s=$?; cd /; [ -z "$d" ] || rm -rf "$d"; exit "$s")'));
  const intel = repairCommand("x86_64");
  assert.match(intel, /herdr-automations-v[^/]+\/herdr-automations_darwin_amd64 /);
  assert.ok(intel.includes(SCHEDULER.sha256.amd64));
  assert.doesNotMatch(arm + intel, /service install|launchctl|LaunchAgents/, "it installs the program, never a login service");
  // A Linux Herdr gets the Linux build, checked with sha256sum (no shasum there).
  const linux = repairCommand("x86_64", "Linux"), linuxArm = repairCommand("aarch64", "Linux");
  assert.match(linux, /herdr-automations-v0\.12\.1-am\.1\/herdr-automations_linux_amd64 /);
  assert.ok(linux.includes(`echo "${SCHEDULER.linux.amd64}  herdr-automations" | sha256sum -c && chmod 755`));
  assert.match(linuxArm, /herdr-automations_linux_arm64 /);
  assert.ok(linuxArm.includes(SCHEDULER.linux.arm64));
  assert.equal(repairCommand("arm64", "Darwin"), arm, "a Mac is the default");
});

// The release the Integrator cuts carries the checksums; until they are pasted in, this fails loudly
// so nothing merges with the repair command pointing at placeholder hashes.
test("the scheduler pin is a real release hash, never the PENDING-SHA256 placeholder", () => {
  assert.equal(SCHEDULER.repo, "automagik-dev/automagik");
  assert.equal(SCHEDULER.version, "0.12.1-am.1");
  for (const arch of ["arm64", "amd64"]) {
    assert.notEqual(SCHEDULER.sha256[arch], "PENDING-SHA256", `${arch}: paste the release's checksums.txt sha256`);
    assert.match(SCHEDULER.sha256[arch], /^[0-9a-f]{64}$/, `${arch}: a sha256`);
    assert.match(SCHEDULER.linux[arch], /^[0-9a-f]{64}$/, `linux ${arch}: a sha256`);
  }
  assert.equal(new Set([...Object.values(SCHEDULER.sha256), ...Object.values(SCHEDULER.linux)]).size, 4, "four builds, four hashes");
});

test("no scheduler: one line says what is missing, the command is shown, Copy copies it, nothing runs it", async () => {
  answer({ machine: "x86_64" });
  const { view, cx, draw } = await panel();
  assert.equal(view.bin, null);
  const n = draw();
  assert.ok(n.has("scheduler-missing"));
  assert.match(textOf(n.get("scheduler-missing")), /Missing the scheduler: herdr-automations is not on PATH or in ~\/\.local\/bin\./);
  assert.equal(textOf(n.get("repair-command")), repairCommand("x86_64"));
  assert.equal(view.error, null, "no 'no such file' error under it");
  assert.doesNotMatch(textOf(view.render(cx)), /Loading/, "the repair block is all the body says");
  assert.ok(!n.has("new"), "no + while there is no scheduler to save to");
  n.get("copy-repair").click({}, cx);
  assert.deepEqual(cx.clipboard, [repairCommand("x86_64")]);
  assert.equal(textOf(draw().get("copy-repair")), "Copied");
  const ran = state.calls.map(([c]) => c);
  assert.ok(ran.every((c) => c === "herdr-automations" || c === "uname" || c.endsWith("/.local/bin/herdr-automations")), ran.join(" "));
  assert.ok(!state.calls.some((c) => c.includes("service")), "no service install");
});

test("installed later: the next refresh finds it in ~/.local/bin and the repair line goes", async () => {
  answer();
  const { view, cx, draw } = await panel();
  assert.ok(draw().has("scheduler-missing"));
  const local = `${state.home}/.local/bin/herdr-automations`;
  answer({ scheduler: local });
  await cx.ticks[0](cx);
  await cx.settle();
  assert.equal(view.bin, local);
  assert.equal(view.missing, null);
  const after = draw();
  assert.ok(!after.has("scheduler-missing"));
  assert.ok(after.has("new"), "+ is back");
  assert.deepEqual(view.list.automations, []);
});

// The repair action (#220): Install runs the shown command, once, from a click only; the panel then
// finds the scheduler without waiting for the 30 s refresh, and starts no service by itself.
test("Install runs the shown command once; the panel then finds the scheduler and offers Start", async () => {
  const local = `${state.home}/.local/bin/herdr-automations`;
  let installed = false;
  const shell = [];
  state.exec = async (command, args) => {
    if (command === "uname") return { code: 0, stdout: args[0] === "-s" ? "Linux\n" : "x86_64\n", stderr: "" };
    if (command === "sh") { shell.push(args); installed = true; return { code: 0, stdout: "herdr-automations: OK\n", stderr: "" }; }
    if (command !== local || !installed) return { code: 127, stdout: "", stderr: `cannot run ${command}: no such file` };
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ automations: [], invalid: [], scheduler: 0, backend: "hc", paused: false }), stderr: "" };
    if (args[0] === "history") return { code: 0, stdout: "[]", stderr: "" };
    return { code: 0, stdout: "0.12.1-am.1\n", stderr: "" };
  };
  const { view, cx, draw } = await panel();
  const n = draw();
  assert.equal(textOf(n.get("repair-command")), repairCommand("x86_64", "Linux"), "this machine's own build");
  assert.equal(textOf(n.get("install-repair")), "Install");
  assert.deepEqual(shell, [], "nothing ran before the click");
  n.get("install-repair").click({}, cx);
  assert.equal(textOf(draw().get("install-repair")), "Installing…");
  draw().get("install-repair").click({}, cx); // a second click while it runs starts nothing
  await cx.settle();
  assert.deepEqual(shell, [["-c", repairCommand("x86_64", "Linux")]], "exactly the shown command, once");
  assert.equal(view.bin, local);
  const after = draw();
  assert.ok(!after.has("scheduler-missing"), "the repair block is gone");
  assert.ok(after.has("start"), "the stopped scheduler's Start is offered");
  assert.ok(!after.has("backend-notice"), "backend hc is ready");
  assert.ok(!state.calls.some((c) => c.includes("service")), "the panel started no service by itself");
});

test("a failed Install keeps the repair block and says why", async () => {
  state.exec = async (command) => {
    if (command === "uname") return { code: 0, stdout: "arm64\n", stderr: "" };
    if (command === "sh") return { code: 1, stdout: "", stderr: "curl: (22) The requested URL returned error: 404\nherdr-automations: FAILED\n" };
    return { code: 127, stdout: "", stderr: "no such file" };
  };
  const { view, cx, draw } = await panel();
  draw().get("install-repair").click({}, cx);
  await cx.settle();
  assert.equal(view.bin, null);
  assert.equal(view.note, "The scheduler was not installed: herdr-automations: FAILED");
  const n = draw();
  assert.ok(n.has("scheduler-missing"));
  assert.equal(textOf(n.get("install-repair")), "Install", "ready to try again");
  assert.match(textOf(view.render(cx)), /The scheduler was not installed: herdr-automations: FAILED/);
});

// Readiness (#220): ls --json answers, but under backend herdr nothing would open in this app.
test("backend herdr, or none named: the panel says runs open in the TUI and names the file; hc and auto say nothing", async () => {
  const serve = (backend) => {
    state.exec = async (command, args) => {
      if (command !== "herdr-automations") return { code: 127, stdout: "", stderr: "no such file" };
      if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ automations: [], invalid: [], scheduler: 7, backend, paused: false }), stderr: "" };
      if (args[0] === "history") return { code: 0, stdout: "[]", stderr: "" };
      return { code: 0, stdout: "0.12.1-am.1\n", stderr: "" };
    };
  };
  serve("herdr");
  const tui = await panel();
  assert.equal(textOf(tui.draw().get("backend-notice")), 'Backend is herdr: runs open in the Herdr TUI, not in this app. Set "backend: hc" in automations.yaml.');
  // With the config path ls --json reports (set here: the stub's folder watch never returns), the file is named.
  tui.view.list.config = `${state.home}/.config/herdr/plugins/config/automations/automations.yaml`;
  assert.equal(textOf(tui.draw().get("backend-notice")),
    'Backend is herdr: runs open in the Herdr TUI, not in this app. Set "backend: hc" in ~/.config/herdr/plugins/config/automations/automations.yaml.');
  // No automations.yaml yet: ls --json names no backend, and the scheduler's default is herdr.
  serve("");
  assert.ok((await panel()).draw().has("backend-notice"), "no backend named is herdr");
  for (const backend of ["hc", "auto"]) {
    serve(backend);
    assert.ok(!(await panel()).draw().has("backend-notice"), backend);
  }
});

test("on PATH: no repair line, and uname is never asked", async () => {
  answer({ scheduler: "herdr-automations" });
  const { view, draw } = await panel();
  assert.equal(view.bin, "herdr-automations");
  assert.ok(!draw().has("scheduler-missing"));
  assert.ok(!state.calls.some(([c]) => c === "uname"));
});

/** The scheduler on PATH listing `automations`; every put (through `sh -c`) is kept and answers ok. */
function listing(automations) {
  const puts = [];
  state.exec = async (command, args) => {
    if (command === "sh") { puts.push({ entry: JSON.parse(args[4]), args: args.slice(5) }); return { code: 0, stdout: "{}", stderr: "" }; }
    if (command !== "herdr-automations") return { code: 127, stdout: "", stderr: `cannot run ${command}: no such file` };
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ automations, invalid: [], scheduler: { pid: 1 }, paused: false }), stderr: "" };
    if (args[0] === "history") return { code: 0, stdout: "[]", stderr: "" };
    return { code: 0, stdout: "0.12.1\n", stderr: "" };
  };
  return puts;
}

const nightly = (agent) => ({ name: "nightly", cron: "0 9 * * 1-5", repo: "/r", workspace: "worktree", agent, prompt: "p", timeout_minutes: 60 });
const border = (node) => node.calls.filter(([m]) => m === "border_color").map(([, c]) => c).at(-1);
const bg = (node) => node.calls.filter(([m]) => m === "bg").map(([, c]) => c).at(-1);

test("an automation saved with gemini shows a dimmed, picked 'gemini (retired)' pill and saves gemini back (#224)", async () => {
  const puts = listing([nightly("gemini")]);
  state.agents = [{ key: "claude", installed: true }, { key: "gemini", installed: true }];
  const { view, cx, draw } = await panel();
  view.edit("nightly", cx);
  await cx.settle();
  const t = (await import(stubs.herdr)).theme();
  const n = draw();
  const pill = n.get("f-agent-gemini");
  assert.ok(pill, "the saved agent has a pill");
  assert.equal(textOf(pill), "gemini (retired)");
  assert.equal(pill.props.color, t.dim, "dim text");
  assert.equal(pill.props.opacity, 0.6, "dimmed");
  assert.equal(border(pill), t.accent, "it is the picked one");
  const claude = n.get("f-agent-claude");
  assert.equal(claude.props.color, t.muted, "the offered agents are drawn as before");
  assert.equal(claude.props.opacity, undefined);
  assert.equal(border(claude), t.border);
  assert.ok(![...n.keys()].some((id) => /^f-agent-(codex|pi)$/.test(id)), "only installed agents are offered");
  assert.equal(view.form.agent, "gemini", "the value is kept");
  assert.equal(view.entry().agent, "gemini");
  view.save(cx);
  await cx.settle();
  const saved = puts.filter((p) => !p.args.includes("--dry-run"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].entry.agent, "gemini", "saved back unchanged");
  assert.deepEqual(saved[0].args, ["put", "--original", "nightly"]);
});

test("a non-retired automation: no retired pill, its agent picked as before; a new one never offers gemini", async () => {
  listing([nightly("claude")]);
  state.agents = [{ key: "claude", installed: true }, { key: "gemini", installed: true }];
  const { view, cx, draw } = await panel();
  const t = (await import(stubs.herdr)).theme();
  for (const name of ["nightly", undefined]) {
    view.edit(name, cx);
    await cx.settle();
    const n = draw();
    assert.ok(!n.has("f-agent-gemini"), `no gemini pill (${name ?? "new"})`);
    assert.ok(![...n.values()].some((node) => /retired/.test(textOf(node))), "no retired label");
    const claude = n.get("f-agent-claude");
    assert.equal(claude.props.color, t.foreground);
    assert.equal(claude.props.opacity, undefined);
    assert.equal(border(claude), t.accent);
    assert.equal(view.entry().agent, "claude");
  }
});

// ---- the stub scheduler (#501, #498) ----
// A stand-in herdr-automations in a temp home's ~/.local/bin: it records every argv and every
// put's JSON, and keeps its entries in a fake automations.yaml (JSON, which YAML reads) in that
// home. Its put changes only the keys it is sent and removes a sent key whose value is empty, as
// v0.12.1's config.Put does (edit.go setKeys; the yaml tags are omitempty), and its ls leaves out
// the keys v0.12.1's api.Automation has no field for (close_workspace, session). Only the stub
// and `sh` (the panel's stdin hand-over) really run; any other program, the real scheduler's
// bare name included, is refused, so no test can reach a real config.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";

const STUB = String.raw`
const fs = require("node:fs"), path = require("node:path");
const home = process.env.STUB_HOME, args = process.argv.slice(2);
const version = process.env.STUB_VERSION || "0.12.1";
const OUR = version.includes("-am.");
// putCmd's api.Automation keys, the fields a put writes: 15 upstream, close_workspace the 16th in
// our build (herdr/scheduler). A sent key outside them is not in the entry put encodes, so
// config.Put's setKeys removes it from the config, exactly as the real put does (held #595 Low).
const FIELDS = ["name", "cron", "repo", "workspace", "workspace_id", "agent", "model", "template",
  "prompt", "workflow", "mcp_config", "agent_args", "timeout_minutes", "catch_up_minutes", "disabled"];
if (OUR) FIELDS.push("close_workspace");
const yaml = path.join(home, ".config/herdr-automations/automations.yaml");
const read = () => JSON.parse(fs.readFileSync(yaml, "utf8"));
const out = (x) => process.stdout.write(JSON.stringify(x));
let input = "";
if (args[0] === "put") input = fs.readFileSync(0, "utf8");
fs.appendFileSync(path.join(home, "argv.jsonl"), JSON.stringify({ argv: args, input }) + "\n");
if (args[0] === "version") process.stdout.write(version + "\n");
else if (args[0] === "ls") out({ automations: read().map(({ session, ...a }) => {
  if (OUR) a.close_workspace = a.close_workspace ?? "never";
  else delete a.close_workspace; // upstream's api.Automation has no field for it
  return a;
}), invalid: [], scheduler: { pid: 1 }, paused: false });
else if (args[0] === "history") out([]);
else if (args[0] === "put") {
  const entry = JSON.parse(input), list = read();
  const at = args[1] === "--original" ? list.findIndex((a) => a.name === args[2]) : -1;
  if (!args.includes("--dry-run")) {
    const empty = (k, v) => !["name", "cron", "repo"].includes(k)
      && (v === undefined || v === null || v === "" || v === 0 || v === false || (Array.isArray(v) && !v.length));
    const into = at >= 0 ? list[at] : {};
    for (const [k, v] of Object.entries(entry)) if (!FIELDS.includes(k) || empty(k, v)) delete into[k]; else into[k] = v;
    if (at < 0) list.push(into);
    fs.writeFileSync(yaml, JSON.stringify(list, null, 2));
  }
  out({ next: ["2026-11-09T09:00:00Z"] });
} else { process.stderr.write("stub: not offered: " + args.join(" ")); process.exit(2); }
`;

function stubScheduler(automations, { version = "0.12.1" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "am-automations-"));
  mkdirSync(join(dir, ".local/bin"), { recursive: true });
  mkdirSync(join(dir, ".config/herdr-automations"), { recursive: true });
  const bin = join(dir, ".local/bin/herdr-automations");
  writeFileSync(bin, `#!${process.execPath}\n${STUB}`);
  chmodSync(bin, 0o755);
  const yaml = join(dir, ".config/herdr-automations/automations.yaml");
  writeFileSync(yaml, JSON.stringify(automations, null, 2));
  state.home = dir;
  let running = version; // the installed build; useVersion() swaps it, like a repair does
  state.exec = (command, args) => new Promise((resolve) => {
    if (command !== "sh" && command !== bin) { resolve({ code: 127, stdout: "", stderr: `cannot run ${command}: refused` }); return; }
    execFile(command, args, { env: { PATH: "/usr/bin:/bin", STUB_HOME: dir, STUB_VERSION: running } }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }));
  });
  const calls = () => readFileSync(join(dir, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return {
    dir, bin, version,
    useVersion: (v) => { running = v; },
    saves: () => calls().filter((c) => c.argv[0] === "put" && !c.argv.includes("--dry-run")).map((c) => ({ argv: c.argv, raw: c.input, entry: JSON.parse(c.input) })),
    yaml: () => JSON.parse(readFileSync(yaml, "utf8")),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const handArgs = ["--sandbox", "workspace-write", "-c", "model_reasoning_effort=high"];

test("an edit that changes only the prompt keeps hand-written agent_args exactly (#501)", async () => {
  const s = stubScheduler([{ ...nightly("codex"), agent_args: handArgs }]);
  try {
    state.agents = [{ key: "codex", installed: true, run: ["codex"] }];
    const { view, cx } = await panel();
    assert.equal(view.bin, s.bin, "the stub, found in the temp home");
    view.edit("nightly", cx);
    await cx.settle();
    view.form.prompt.type("p, said again", cx);
    view.save(cx);
    await cx.settle();
    const saved = s.saves();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].argv, ["put", "--original", "nightly"]);
    assert.equal(saved[0].entry.prompt, "p, said again");
    assert.deepEqual(saved[0].entry.agent_args, handArgs, "sent to put as they were");
    assert.deepEqual(s.yaml()[0].agent_args, handArgs, "and still in the config after the put");
  } finally { s.done(); }
});

test("an edit of a paused automation keeps it paused (#501)", async () => {
  const s = stubScheduler([{ ...nightly("claude"), disabled: true }]);
  try {
    state.agents = [{ key: "claude", installed: true, run: ["claude"] }];
    const { view, cx } = await panel();
    view.edit("nightly", cx);
    await cx.settle();
    view.form.prompt.type("p, said again", cx);
    view.save(cx);
    await cx.settle();
    const saved = s.saves();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].entry.disabled, true, "sent to put still paused");
    assert.equal(s.yaml()[0].disabled, true, "and still paused in the config");
  } finally { s.done(); }
});

// ---- permission modes (#498) and the other fields put would erase (#501) ----
const { AUTO_ARGS, addressesIn, addressWarning, argsText, modeOf, parseArgs, splitPermission, templateMode } =
  await import("../mods/am-automations/modes.js");
const ALL = [{ key: "claude", installed: true, run: ["claude"] }, { key: "codex", installed: true, run: ["codex"] }, { key: "pi", installed: true, run: ["pi"] }];
const TEMPLATES = { templates: [
  { name: "reviewer-opus", command: 'env PATH="$HOME/.local/bin:$PATH" claude --dangerously-skip-permissions --model claude-opus-5-5' },
  { name: "dev-sol", command: "codex --no-daemon --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol" },
  { name: "plain", command: "pi --model x" },
] };

/** A panel on the stub scheduler with every agent installed and the fake hc's templates. */
async function stubPanel(automations, options) {
  const s = stubScheduler(automations, options);
  state.agents = ALL;
  state.hc = async (args) => (args.join(" ") === "templates --json"
    ? { code: 0, stdout: JSON.stringify(TEMPLATES), stderr: "" } : { code: 2, stdout: "", stderr: "fake hc: not offered" });
  const p = await panel();
  return { s, ...p };
}

/** Fills a new automation's name, repo and prompt, then picks `agent` by its pill. */
async function fillNew(view, cx, draw, agent, prompt = "tidy up") {
  view.edit(null, cx);
  await cx.settle();
  view.form.name.type("job", cx);
  view.form.repo.type("/r", cx);
  view.form.prompt.type(prompt, cx);
  draw().get(`f-agent-${agent}`).click({}, cx);
  await cx.settle();
}

async function saveIt(view, cx) { view.save(cx); await cx.settle(); }

test("the automatic flags: codex skips approvals and sandbox, claude its permission prompts, pi none", () => {
  assert.deepEqual(AUTO_ARGS.codex, ["--dangerously-bypass-approvals-and-sandbox"]);
  assert.deepEqual(AUTO_ARGS.claude, ["--dangerously-skip-permissions"]);
  assert.equal(AUTO_ARGS.pi, undefined);
});

for (const [agent, flag] of [["codex", "--dangerously-bypass-approvals-and-sandbox"], ["claude", "--dangerously-skip-permissions"]]) {
  test(`a new ${agent} automation saves with its automatic flag, and the form says so (#498)`, async () => {
    const { s, view, cx, draw } = await stubPanel([]);
    try {
      await fillNew(view, cx, draw, agent);
      const n = draw();
      assert.match(textOf(n.get("f-mode-auto")), new RegExp(flag), "the Automatic pill names the flag");
      assert.match(textOf(n.get("f-mode-now")), /^Runs automatic/);
      assert.ok(!n.has("f-mode-kept"), "a new entry has no saved args to keep");
      await saveIt(view, cx);
      const saved = s.saves();
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].argv, ["put"]);
      assert.equal(saved[0].entry.agent, agent);
      assert.deepEqual(saved[0].entry.agent_args, [flag]);
      assert.deepEqual(s.yaml()[0].agent_args, [flag]);
    } finally { s.done(); }
  });
}

test("a new pi automation: no automatic mode, the form says so, and it saves no flags", async () => {
  const { s, view, cx, draw } = await stubPanel([]);
  try {
    await fillNew(view, cx, draw, "pi");
    const n = draw();
    assert.ok(!n.has("f-mode-auto"));
    assert.equal(textOf(n.get("f-mode-none")), "pi has no known automatic mode: it runs with its own default.");
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[0].entry.agent_args, [], "sent empty: put keeps a key it is not sent");
    assert.ok(!("agent_args" in s.yaml()[0]), "none in the config");
  } finally { s.done(); }
});

test("turning a new automation down to Agent default saves no automatic flag; extra words still go", async () => {
  const { s, view, cx, draw } = await stubPanel([]);
  try {
    await fillNew(view, cx, draw, "codex");
    draw().get("f-mode-default").click({}, cx);
    view.form.args.type('-c "model_reasoning_effort=high"', cx);
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[0].entry.agent_args, ["-c", "model_reasoning_effort=high"]);
  } finally { s.done(); }
});

test("an existing entry with no agent_args shows 'agent default' and stays without after a prompt-only edit", async () => {
  const { s, view, cx, draw } = await stubPanel([nightly("codex")]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    const n = draw();
    assert.equal(textOf(n.get("f-mode-kept")), "As saved: agent default");
    assert.equal(border(n.get("f-mode-kept")), "#accent", "picked: nothing is migrated on load");
    assert.equal(s.saves().length, 0, "opening the form saves nothing");
    view.form.prompt.type("p, said again", cx);
    await saveIt(view, cx);
    const saved = s.saves();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].entry.agent_args, [], "sent empty, which keeps none");
    assert.ok(!("agent_args" in s.yaml()[0]), "none in the config");
  } finally { s.done(); }
});

test("an existing entry shows its hand-written mode, and picking Automatic adds the flag and keeps its other words", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("codex"), agent_args: handArgs }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    assert.equal(textOf(draw().get("f-mode-kept")), "As saved: sandbox workspace-write");
    assert.equal(view.form.args.value(), "-c model_reasoning_effort=high", "the extra words, without the permission flags");
    draw().get("f-mode-auto").click({}, cx);
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[0].entry.agent_args, ["--dangerously-bypass-approvals-and-sandbox", "-c", "model_reasoning_effort=high"]);
  } finally { s.done(); }
});

test("an existing automatic entry turned down to Agent default loses only the permission flag", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("claude"), agent_args: ["--dangerously-skip-permissions", "--verbose"] }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    draw().get("f-mode-default").click({}, cx);
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[0].entry.agent_args, ["--verbose"]);
  } finally { s.done(); }
});

// v0.12.0 changed put to keep every key it is not sent (edit.go setKeys). A form that sent no
// agent_args for "none" would leave the old flag in place: agent_args always goes, [] for none.
test("an automatic-only entry turned down to Agent default keeps no flag in the config (v0.12 put)", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("codex"), agent_args: ["--dangerously-bypass-approvals-and-sandbox"] }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    draw().get("f-mode-default").click({}, cx);
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.ok(saved.raw.includes(`"agent_args":[]`), "sent, and empty");
    assert.ok(!("agent_args" in s.yaml()[0]), "the bypass flag is gone from the config");
  } finally { s.done(); }
});

// Under an upstream scheduler close_workspace (and session) can only be hand-written: v0.12.1's put
// has no field for them, and a key it is sent with no value is removed. The panel never sends either
// there, so an edit keeps them.
test("a hand-written close_workspace and session survive a prompt-only edit; put is never sent them", async () => {
  const { s, view, cx } = await stubPanel([{ ...nightly("claude"), close_workspace: "on-success", session: "night" }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    view.form.prompt.type("p, said again", cx);
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.ok(!("close_workspace" in saved.entry) && !("session" in saved.entry), "neither key sent");
    assert.equal(s.yaml()[0].close_workspace, "on-success");
    assert.equal(s.yaml()[0].session, "night");
    assert.equal(s.yaml()[0].prompt, "p, said again");
  } finally { s.done(); }
});

// ---- our scheduler build (#498): the close_workspace switch ----
// The panel installs and drives our build of the vendored fork (herdr/scheduler/), whose ls --json
// and put carry close_workspace; upstream DnzzL's v0.12.1 has no field for it. `version` tells them
// apart: ours contains "-am.".
const OUR = "0.12.1-am.1";

test("our scheduler: a new worktree automation closes its space after a successful run by default (D2)", async () => {
  const { s, view, cx, draw } = await stubPanel([], { version: OUR });
  try {
    const t = (await import(stubs.herdr)).theme();
    await fillNew(view, cx, draw, "claude");
    const toggle = draw().get("f-close");
    assert.ok(toggle, "the close switch is shown for a new worktree entry");
    assert.equal(bg(toggle), t.accent, "on by default");
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.equal(saved.entry.close_workspace, "on-success");
    assert.equal(s.yaml()[0].close_workspace, "on-success");
  } finally { s.done(); }
});

test("upstream: close_workspace is never sent, and one line says our build is needed (#595)", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("claude"), close_workspace: "on-success" }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    const n = draw();
    assert.ok(!n.has("f-close"), "no switch for an upstream binary");
    assert.match(textOf(n.get("f-close-upstream")), /Our scheduler build \(0\.12\.1-am\.1\) is needed/);
    view.form.prompt.type("p, said again", cx);
    await saveIt(view, cx);
    assert.ok(!("close_workspace" in s.saves()[0].entry), "never sent");
    assert.equal(s.yaml()[0].close_workspace, "on-success", "the stub would have removed it had it been sent");
  } finally { s.done(); }
});

test("an existing space hides the switch: close_workspace on-success is refused with workspace existing", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("claude"), workspace: "existing", workspace_id: "w7" }], { version: OUR });
  try {
    view.edit("nightly", cx);
    await cx.settle();
    assert.ok(!draw().has("f-close"), "no switch");
    assert.ok(!draw().has("f-close-upstream"), "and no upstream line: ours is installed");
    await saveIt(view, cx);
    assert.equal(s.saves()[0].entry.close_workspace, "never", "sent never, never on-success");
    assert.equal(s.yaml()[0].close_workspace, "never");
  } finally { s.done(); }
});

test("an existing entry shows ls's on-success, and switching the close switch off sends never", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("claude"), close_workspace: "on-success" }], { version: OUR });
  try {
    const t = (await import(stubs.herdr)).theme();
    view.edit("nightly", cx);
    await cx.settle();
    const toggle = draw().get("f-close");
    assert.ok(toggle, "shown for a worktree entry");
    assert.equal(bg(toggle), t.accent, "on: ls --json said on-success");
    toggle.click({}, cx);
    await cx.settle();
    assert.equal(bg(draw().get("f-close")), t.input, "off after the click");
    await saveIt(view, cx);
    assert.equal(s.saves()[0].entry.close_workspace, "never");
    assert.equal(s.yaml()[0].close_workspace, "never");
  } finally { s.done(); }
});

test("a binary swapped for upstream before Save: close_workspace is withheld (fail closed)", async () => {
  const { s, view, cx, draw } = await stubPanel([], { version: OUR });
  try {
    const t = (await import(stubs.herdr)).theme();
    await fillNew(view, cx, draw, "claude");
    assert.equal(bg(draw().get("f-close")), t.accent, "ours at start: the switch is on");
    s.useVersion("0.12.1"); // repaired to upstream while the panel is open, before the 30 s refresh
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.ok(!("close_workspace" in saved.entry), "the probe right before put says upstream");
    assert.ok(!("close_workspace" in s.yaml()[0]), "and nothing was written");
  } finally { s.done(); }
});

test("upstream at start, ours at Save: the key goes, because the switch is on", async () => {
  const { s, view, cx, draw } = await stubPanel([], { version: "0.12.1" });
  try {
    await fillNew(view, cx, draw, "claude");
    assert.ok(!draw().has("f-close"), "upstream at start: no switch");
    assert.ok(draw().has("f-close-upstream"), "one line says our build is needed");
    s.useVersion(OUR); // repaired to our build while the panel is open
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.equal(saved.entry.close_workspace, "on-success", "the fresh probe says ours, D2 is on");
    assert.equal(s.yaml()[0].close_workspace, "on-success");
  } finally { s.done(); }
});

test("the stub's put deletes a key outside putCmd's field list, like the real put (held #595 Low)", () => {
  const entry = { name: "nightly", cron: "0 9 * * 1-5", repo: "/r", workspace: "worktree", agent: "claude",
    prompt: "p", timeout_minutes: 60, close_workspace: "on-success", session: "night" };
  const upstream = stubScheduler([{ ...nightly("claude"), close_workspace: "on-success", session: "night" }]);
  const ours = stubScheduler([{ ...nightly("claude"), session: "night" }], { version: OUR });
  try {
    const put = (s) => execFileSync(s.bin, ["put", "--original", "nightly"], {
      input: JSON.stringify(entry), env: { PATH: "/usr/bin:/bin", STUB_HOME: s.dir, STUB_VERSION: s.version },
    });
    put(upstream);
    assert.ok(!("close_workspace" in upstream.yaml()[0]), "upstream's 15 fields: the 16th is removed");
    assert.ok(!("session" in upstream.yaml()[0]), "session is no field of either build");
    put(ours);
    assert.equal(ours.yaml()[0].close_workspace, "on-success", "ours' 16th field is written");
    assert.ok(!("session" in ours.yaml()[0]), "session is still no field of ours");
  } finally { upstream.done(); ours.done(); }
});

test("catch_up_minutes and workflow go back to put as they came (#501)", async () => {
  const wf = { name: "wf", cron: "0 9 * * *", repo: "/r", workspace: "root", agent: "claude", workflow: "nightly-review", catch_up_minutes: -1, timeout_minutes: 30 };
  const { s, view, cx } = await stubPanel([{ ...nightly("claude"), catch_up_minutes: 15 }, wf]);
  try {
    for (const name of ["nightly", "wf"]) {
      view.edit(name, cx);
      await cx.settle();
      view.form.timeout.type("45", cx);
      await saveIt(view, cx);
    }
    const [a, b] = s.saves();
    assert.equal(a.entry.catch_up_minutes, 15);
    assert.equal(b.entry.catch_up_minutes, -1);
    assert.equal(b.entry.workflow, "nightly-review");
    assert.equal(s.yaml()[0].catch_up_minutes, 15);
    assert.equal(s.yaml()[1].workflow, "nightly-review");
  } finally { s.done(); }
});

test("a template run shows its command's mode, and the panel adds no flags to it", async () => {
  const { s, view, cx, draw } = await stubPanel([{ name: "rev", cron: "0 9 * * *", repo: "/r", workspace: "worktree", template: "reviewer-opus", prompt: "p", timeout_minutes: 60 }]);
  try {
    assert.match(textOf(draw().get("auto-rev")), /automatic \(skips permissions\) \(template\)/, "the list row shows it");
    view.edit("rev", cx);
    await cx.settle();
    const n = draw();
    assert.ok(!n.has("f-mode-auto") && !n.has("f-args"), "no mode pills and no args for a template");
    assert.match(textOf(n.get("f-mode-template")), /^reviewer-opus: automatic \(skips permissions\)\. .*adds none/);
    view.form.prompt.type("p2", cx);
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[0].entry.agent_args, [], "a template entry with none sends none");
    await fillNew(view, cx, draw, "codex");
    draw().get("f-agent-template:dev-sol").click({}, cx);
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[1].entry.agent_args, [], "a new template entry gets no automatic flag either");
  } finally { s.done(); }
});

test("the detail view and the list row show the saved mode", async () => {
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("codex"), agent_args: ["--dangerously-bypass-approvals-and-sandbox"] }]);
  try {
    assert.match(textOf(draw().get("auto-nightly")), /automatic \(no approvals, no sandbox\)$/);
    view.view = { kind: "detail", name: "nightly" };
    assert.match(textOf(view.render(cx)), /Permissions\s*automatic \(no approvals, no sandbox\)/);
  } finally { s.done(); }
});

test("modeOf, templateMode and the args line", () => {
  assert.equal(modeOf("claude", []), "agent default");
  assert.equal(modeOf("claude", undefined), "agent default");
  assert.equal(modeOf("claude", ["--permission-mode", "acceptEdits"]), "permission mode acceptEdits");
  assert.equal(modeOf("claude", ["--permission-mode=plan"]), "permission mode plan");
  assert.equal(modeOf("codex", ["--full-auto"]), "full auto (sandboxed)");
  assert.equal(modeOf("codex", ["-a", "never", "-s", "workspace-write"]), "approvals never · sandbox workspace-write");
  assert.equal(modeOf("pi", ["--model", "x"]), "agent default");
  assert.equal(templateMode("omp --auto-approve --model m"), "automatic (auto-approve)");
  assert.equal(templateMode("pi --model x"), "agent default");
  assert.equal(templateMode("./run-thing"), "not known (no agent in its command)");
  assert.deepEqual(splitPermission("codex", ["-c", "x", "-s", "read-only", "--yolo"]), { perm: ["-s", "read-only", "--yolo"], rest: ["-c", "x"] });
  const words = ["-c", 'a b', 'say "hi"', "plain"];
  assert.equal(argsText(words), '-c "a b" "say \\"hi\\"" plain');
  assert.deepEqual(parseArgs(argsText(words)), words);
  assert.deepEqual(parseArgs("  one 'two three'  "), ["one", "two three"]);
});

test("the address check: terminal addresses caught, words, ids, versions, URLs and branches left alone", () => {
  for (const [text, want] of [["ask t3q1 to merge", ["t3q1"]], ["send it to t35n.", ["t35n"]], ["on build-box/t9 first", ["build-box/t9"]],
    ["(t10d)", ["t10d"]], ["t3q1 and t3q1 then t2n3", ["t3q1", "t2n3"]]]) assert.deepEqual(addressesIn(text), want, text);
  for (const text of ["the", "test the tab", "to", "b-6jrz4bmxml", "v0.11.3", "https://example.com/t3q1", "http://h/t9/x",
    "feature/t3q1-fix", "fix/herdr-498-t3", "origin/t10d-x", "t-shirt", "at3q1", "T3Q1"]) assert.deepEqual(addressesIn(text), [], text);
  assert.equal(addressWarning("no address here"), null);
  assert.equal(addressWarning("ping t35n"), "t35n is a terminal address; it changes on restart. Name the bot instead (its name or b-… id).");
});

test("a prompt naming a terminal warns in the form and still saves (#498)", async () => {
  const { s, view, cx, draw } = await stubPanel([]);
  try {
    await fillNew(view, cx, draw, "claude", "ask t35n to clean up");
    assert.match(textOf(draw().get("f-address")), /^t35n is a terminal address/);
    await saveIt(view, cx);
    assert.equal(s.saves().length, 1, "saved all the same");
    assert.equal(s.yaml()[0].prompt, "ask t35n to clean up");
  } finally { s.done(); }
});

// ---- review fixes on #505 ----

test("hand-written args with the permission flag in the middle go back byte for byte (#501)", async () => {
  const middle = ["-c", "model_reasoning_effort=high", "--sandbox", "workspace-write", "--add-dir", "/work/a b", "-c", "x=1"];
  const { s, view, cx } = await stubPanel([{ ...nightly("codex"), agent_args: middle }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    view.form.prompt.type("p, said again", cx);
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.ok(saved.raw.includes(`"agent_args":${JSON.stringify(middle)}`), "the same words, in the same order, byte for byte");
    assert.equal(JSON.stringify(s.yaml()[0].agent_args), JSON.stringify(middle));
  } finally { s.done(); }
});

test("switching an existing entry's agent drops the old agent's permission flags and lands on Agent default", async () => {
  const own = ["--verbose", "--dangerously-skip-permissions", "--add-dir", "/work"];
  const { s, view, cx, draw } = await stubPanel([{ ...nightly("claude"), agent_args: own }]);
  try {
    view.edit("nightly", cx);
    await cx.settle();
    assert.equal(textOf(draw().get("f-mode-kept")), "As saved: automatic (skips permissions)");
    draw().get("f-agent-codex").click({}, cx);
    await cx.settle();
    let n = draw();
    assert.ok(!n.has("f-mode-kept"), "no As saved pill for another agent's args");
    assert.equal(border(n.get("f-mode-default")), "#accent", "Agent default is picked, never Automatic");
    assert.equal(border(n.get("f-mode-auto")), "#border");
    assert.equal(textOf(n.get("f-mode-now")), "Runs agent default: codex --verbose --add-dir /work");
    // Back to the saved agent: its own args, exactly, once more.
    draw().get("f-agent-claude").click({}, cx);
    await cx.settle();
    n = draw();
    assert.equal(border(n.get("f-mode-kept")), "#accent");
    assert.deepEqual(view.entry().agent_args, own);
    draw().get("f-agent-codex").click({}, cx);
    await saveIt(view, cx);
    const [saved] = s.saves();
    assert.equal(saved.entry.agent, "codex");
    assert.deepEqual(saved.entry.agent_args, ["--verbose", "--add-dir", "/work"], "no claude flag handed to codex");
  } finally { s.done(); }
});

test("a template entry switched to an agent keeps no permission flags from its saved args", async () => {
  const { s, view, cx, draw } = await stubPanel([{ name: "rev", cron: "0 9 * * *", repo: "/r", workspace: "worktree",
    template: "reviewer-opus", agent_args: ["--dangerously-skip-permissions", "--verbose"], prompt: "p", timeout_minutes: 60 }]);
  try {
    view.edit("rev", cx);
    await cx.settle();
    draw().get("f-agent-codex").click({}, cx);
    await cx.settle();
    assert.equal(border(draw().get("f-mode-default")), "#accent");
    await saveIt(view, cx);
    assert.deepEqual(s.saves()[0].entry.agent_args, ["--verbose"]);
  } finally { s.done(); }
});

test("a template list hc could not give is not kept: the next refresh asks again", async () => {
  const s = stubScheduler([{ name: "rev", cron: "0 9 * * *", repo: "/r", workspace: "worktree", template: "reviewer-opus", prompt: "p", timeout_minutes: 60 }]);
  try {
    state.agents = ALL;
    let up = false;
    state.hc = async () => (up ? { code: 0, stdout: JSON.stringify(TEMPLATES), stderr: "" } : { code: 1, stdout: "", stderr: "hc: no server" });
    const { view, cx, draw } = await panel();
    assert.match(textOf(draw().get("auto-rev")), /not known \(hc lists no such template\)/, "first read failed");
    up = true;
    await cx.ticks[0](cx);
    await cx.settle();
    assert.match(textOf(draw().get("auto-rev")), /automatic \(skips permissions\) \(template\)/, "asked again and shown");
  } finally { s.done(); }
});

// ---- put and the form write the same file (#938) ----
// A bot writes an automation with `herdr-automations put` and no agent_args; the form sends the
// automatic mode's flags. Our put now applies the same default to a new automation, and the proof
// is in two halves over one fixture: here, that `form` is what the real form sends for the
// definition and `put` is that definition without agent_args; in herdr/scheduler/main_test.go, that
// the real put writes the same automations.yaml for both.
const PARITY = JSON.parse(readFileSync(new URL("./fixtures/automation-put-parity.json", import.meta.url), "utf8"));

test("the put/form parity fixture covers every agent the form offers, and no other", () => {
  assert.deepEqual(PARITY.cases.map((c) => c.agent).sort(), ALL.map((a) => a.key).sort());
});

for (const c of PARITY.cases) {
  test(`a new ${c.agent} automation: the form sends the parity fixture's payload (#938)`, async () => {
    const { s, view, cx, draw } = await stubPanel([], { version: OUR });
    try {
      await fillNew(view, cx, draw, c.agent, c.form.prompt);
      await saveIt(view, cx);
      const saved = s.saves();
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].argv, ["put"]);
      assert.deepEqual(saved[0].entry, c.form, "the fixture's form payload is the real form's");
      const { agent_args: flags, ...definition } = c.form;
      assert.deepEqual(c.put, definition, "the put side is the same definition, without agent_args");
      assert.deepEqual(flags, AUTO_ARGS[c.agent] ? [...AUTO_ARGS[c.agent]] : [], "the form's default is the automatic mode");
    } finally { s.done(); }
  });
}
