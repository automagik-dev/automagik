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
