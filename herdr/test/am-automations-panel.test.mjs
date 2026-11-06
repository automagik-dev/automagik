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
    return { code: 0, stdout: "0.11.3\n", stderr: "" };
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

test("the repair command: the pinned release for this Mac's arch, hash-checked, into ~/.local/bin", () => {
  const arm = repairCommand("arm64");
  assert.match(arm, new RegExp(`/${SCHEDULER.repo}/releases/download/v${SCHEDULER.version}/herdr-automations_darwin_arm64 `));
  assert.ok(arm.includes(`echo "${SCHEDULER.sha256.arm64}  herdr-automations" | shasum -a 256 -c`));
  assert.match(arm, /shasum -a 256 -c && chmod 755 herdr-automations && mv herdr-automations ~\/\.local\/bin\/\)$/, "moved in only once the hash matches");
  const intel = repairCommand("x86_64");
  assert.match(intel, /herdr-automations_darwin_amd64 /);
  assert.ok(intel.includes(SCHEDULER.sha256.amd64));
  for (const h of Object.values(SCHEDULER.sha256)) assert.match(h, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(arm + intel, /service install|launchctl|LaunchAgents/, "it installs the program, never a login service");
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
    return { code: 0, stdout: "0.11.3\n", stderr: "" };
  };
  return puts;
}

const nightly = (agent) => ({ name: "nightly", cron: "0 9 * * 1-5", repo: "/r", workspace: "worktree", agent, prompt: "p", timeout_minutes: 60 });
const border = (node) => node.calls.filter(([m]) => m === "border_color").map(([, c]) => c).at(-1);

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
// home. Its put replaces the whole entry, as v0.11.3's config.Put does (edit.go). Only the stub
// and `sh` (the panel's stdin hand-over) really run; any other program, the real scheduler's
// bare name included, is refused, so no test can reach a real config.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const STUB = String.raw`
const fs = require("node:fs"), path = require("node:path");
const home = process.env.STUB_HOME, args = process.argv.slice(2);
const yaml = path.join(home, ".config/herdr-automations/automations.yaml");
const read = () => JSON.parse(fs.readFileSync(yaml, "utf8"));
const out = (x) => process.stdout.write(JSON.stringify(x));
let input = "";
if (args[0] === "put") input = fs.readFileSync(0, "utf8");
fs.appendFileSync(path.join(home, "argv.jsonl"), JSON.stringify({ argv: args, input }) + "\n");
if (args[0] === "version") process.stdout.write("0.11.3\n");
else if (args[0] === "ls") out({ automations: read(), invalid: [], scheduler: { pid: 1 }, paused: false });
else if (args[0] === "history") out([]);
else if (args[0] === "put") {
  const entry = JSON.parse(input), list = read();
  const at = args[1] === "--original" ? list.findIndex((a) => a.name === args[2]) : -1;
  if (!args.includes("--dry-run")) {
    if (at >= 0) list[at] = entry; else list.push(entry);
    fs.writeFileSync(yaml, JSON.stringify(list, null, 2));
  }
  out({ next: ["2026-11-09T09:00:00Z"] });
} else { process.stderr.write("stub: not offered: " + args.join(" ")); process.exit(2); }
`;

function stubScheduler(automations) {
  const dir = mkdtempSync(join(tmpdir(), "am-automations-"));
  mkdirSync(join(dir, ".local/bin"), { recursive: true });
  mkdirSync(join(dir, ".config/herdr-automations"), { recursive: true });
  const bin = join(dir, ".local/bin/herdr-automations");
  writeFileSync(bin, `#!${process.execPath}\n${STUB}`);
  chmodSync(bin, 0o755);
  const yaml = join(dir, ".config/herdr-automations/automations.yaml");
  writeFileSync(yaml, JSON.stringify(automations, null, 2));
  state.home = dir;
  state.exec = (command, args) => new Promise((resolve) => {
    if (command !== "sh" && command !== bin) { resolve({ code: 127, stdout: "", stderr: `cannot run ${command}: refused` }); return; }
    execFile(command, args, { env: { PATH: "/usr/bin:/bin", STUB_HOME: dir } }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }));
  });
  const calls = () => readFileSync(join(dir, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return {
    dir, bin,
    saves: () => calls().filter((c) => c.argv[0] === "put" && !c.argv.includes("--dry-run")).map((c) => ({ argv: c.argv, entry: JSON.parse(c.input) })),
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
