// am-quota's Accounts panel under a stub runtime (./am-quota-herdr.mjs: files in memory, `exec`
// recorded and never spawned, Linux, so no Keychain item is ever asked for) and a fake proxy.
// The switch itself is a fake module: what it writes is am-quota-switch.test.mjs's subject. Not
// Herdr: the in-app check in the mod's RECIPE still applies.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const FAKE_SWITCH = "data:text/javascript," + encodeURIComponent(`
  export const installs = [];
  export async function install({ provider, account }) {
    installs.push({ provider, id: account.id });
    return { label: provider === "claude" ? "Claude Code" : "Codex", fingerprint: "fp-new" };
  }`);
const stubs = { herdr: here("./am-quota-herdr.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
const fromMod = (context) => context.parentURL?.includes("/mods/am-quota/");
registerHooks({
  resolve: (specifier, context, next) => {
    if (stubs[specifier] && fromMod(context)) return { url: stubs[specifier], shortCircuit: true };
    if (specifier === "./switch.js" && context.parentURL?.endsWith("/mods/am-quota/main.js")) return { url: FAKE_SWITCH, shortCircuit: true };
    return next(specifier, context);
  },
});

const { state } = await import(stubs.herdr);
const { installs } = await import(FAKE_SWITCH);
const { default: Panel, plain, records } = await import("../mods/am-quota/main.js");
const { all, index, nodes, textOf } = await import(stubs["gpui-kit"]);

const NOW = Date.now();
const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const BASE = "https://proxy.example.com";

// Two tools, example accounts: Codex's in-use account runs out (88% an hour ago, 92% now: 2 h
// left, its reset 10 h away), Claude's has nothing recorded. `poll` 0 is the earlier reading.
let poll = 1;
const quotas = () => ({ accounts: QUOTAS.accounts.map((a) => ({ ...a, fetched_at: iso(poll ? NOW : NOW - H),
  windows: a.windows.map((w) => ({ ...w, used_percent: a.email === "ana@example.com" && !poll ? 88 : w.used_percent })) })) });
const QUOTAS = { accounts: [
  { name: "codex-0a-ana-pro.json", provider: "codex", email: "ana@example.com", plan: "pro",
    windows: [{ id: "primary", used_percent: 92, reset_at: iso(NOW + 10 * H) }] },
  { name: "codex-0b-bo-pro.json", provider: "codex", email: "bo@example.com", plan: "pro",
    windows: [{ id: "primary", used_percent: 12, reset_at: iso(NOW + 6 * H) }] },
  { name: "claude-0c-cy.json", provider: "claude", email: "cy@example.com",
    windows: [{ id: "seven_day", used_percent: 41, reset_at: iso(NOW + 50 * H) }] },
] };
const CREDENTIALS = { files: QUOTAS.accounts.map((a) => ({ name: a.name, provider: a.provider, email: a.email, status: "active" })) };

function fakeFetch() {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    const body = url.endsWith("/v1/quotas") ? quotas() : url.endsWith("/v8/management/credentials") ? CREDENTIALS : null;
    if (!body) return { status: 404, json: async () => ({}) };
    return { status: 200, json: async () => body };
  };
  return asked;
}

function makeCx() {
  const cx = { pending: [], spawn(fn) { const p = Promise.resolve().then(() => fn(cx)); cx.pending.push(p); return p; },
    timer: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) }, notify() {} };
  cx.settle = async () => { while (cx.pending.length) await Promise.allSettled(cx.pending.splice(0)); };
  return cx;
}

const ACTIVE = `${state.appHome}/data/am-quota/active.json`;
const RUNNER = `${state.appHome}/mods/am-sidebar/bin/run.sh`;

async function panel({ config = { url: BASE, name: "lab" }, key = "example-key", active = { codex: { name: "codex-0a-ana-pro.json" } }, sidebar = true } = {}) {
  state.files = new Map();
  state.calls = [];
  if (config) state.files.set(`${state.appHome}/cliproxy.json`, JSON.stringify(config));
  if (key) state.files.set(`${state.home}/.config/cliproxyapi/mgmt.key`, `${key}\n`);
  if (active) state.files.set(ACTIVE, JSON.stringify(active));
  if (sidebar) state.files.set(RUNNER, "#!/bin/sh\n");
  const asked = fakeFetch();
  const cx = makeCx();
  const view = new Panel();
  poll = 0;
  view.init({}, cx);
  await cx.settle();
  poll = 1;
  view.reload(cx);
  await cx.settle();
  return { view, cx, asked, draw: () => index(view.render()) };
}

const text = (root) => textOf(root);

test("the tool switch shows one tool at a time; Codex lists its accounts by email · plan", async () => {
  const { view, cx, draw } = await panel();
  let root = draw();
  assert.ok(nodes.has("tool-claude") && nodes.has("tool-codex"));
  assert.match(text(root), /No account from lab/, "Claude first: nothing recorded, so Not managed");
  assert.match(text(root), /Not managed/);
  assert.ok(!text(root).includes("ana@example.com"), "no Codex account on the Claude card");
  nodes.get("tool-codex").click(null, cx);
  root = draw();
  const shown = text(root);
  assert.match(shown, /ana@example\.com · Pro/);
  assert.match(shown, /Running out/);
  assert.match(shown, /Other Codex accounts on lab/);
  assert.ok(!shown.includes(".json"), "never a credential file name");
  void view;
});

test("no saved-login UI: no name box, no Restore, no footer notes about saved logins", async () => {
  const { draw } = await panel();
  const root = draw();
  assert.equal(all(root).some((n) => n.kind === "input"), false);
  assert.doesNotMatch(text(root), /save this login|Restore|Re-save|Forget|saved/i);
});

test("the footer names the proxy and opens its URL; with no name, the host", async () => {
  let p = await panel();
  let root = p.draw();
  assert.match(text(root), /Accounts come from your CLIProxyAPI, lab\. To add one, sign in to it there\./);
  state.calls = [];
  nodes.get("am-open-proxy").click(null, p.cx);
  assert.deepEqual(state.calls, [["xdg-open", BASE]]);
  p = await panel({ config: { url: `${BASE}/` } });
  root = p.draw();
  assert.match(text(root), /CLIProxyAPI, proxy\.example\.com\./);
});

test("no cliproxy.json: a setup line, the generic name, no Open button and no request", async () => {
  const { draw, asked } = await panel({ config: null });
  const root = draw();
  assert.match(text(root), /your own CLIProxyAPI/);
  assert.match(text(root), /Accounts come from your CLIProxyAPI\. To add one/);
  assert.equal(nodes.has("am-open-proxy"), false);
  assert.deepEqual(asked, []);
});

test("Switch to <email>, then the bots still on the old account, and Restart after a confirmation", async () => {
  const { view, cx, draw, asked } = await panel();
  view.tool = "codex";
  draw();
  const bots = { projects: [{ project: "/work/a", bots: [
    { id: "orch", name: "Orchestrator", agent: "codex", project: "/work/a", terminal: "t1", status: "idle", since: iso(NOW - H) },
    { id: "late", name: "Late", agent: "codex", project: "/work/a", terminal: "t2", status: "idle", since: iso(NOW + 10 * H) },
    { id: "cl", name: "Claude bot", agent: "claude", project: "/work/a", terminal: "t3", status: "idle", since: iso(NOW - H) },
  ] }] };
  state.exec = (command, args) => {
    if (command === "env" && args.includes("ls")) return { code: 0, stdout: JSON.stringify(bots), stderr: "" };
    if (command === "env" && args.includes("restart")) return { code: 0, stdout: "{}", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  nodes.get("primary-codex").click(null, cx);
  await cx.settle();
  assert.deepEqual(installs.at(-1), { provider: "codex", id: "codex-0b-bo-pro.json" });
  assert.equal(JSON.parse(state.files.get(ACTIVE)).codex.name, "codex-0b-bo-pro.json");
  assert.ok(!asked.some((u) => u.includes("/download")), "the fake switch downloads nothing");

  let root = draw();
  assert.match(text(root), /Codex is now on bo@example\.com · Pro/);
  assert.match(text(root), /This one started earlier and still uses ana@example\.com · Pro/);
  assert.match(text(root), /Orchestrator/);
  assert.ok(!text(root).includes("Late") && !text(root).includes("Claude bot"));

  const ls = state.calls.find((c) => c[0] === "env" && c.includes("ls"));
  assert.deepEqual(ls, ["env", "HERDR_APP_HOME=/stub-app", "sh", RUNNER, "/stub-app/mods/am-sidebar/bin/automagik-herdr.mjs", "ls", "--all", "--json"]);

  state.calls = [];
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  assert.equal(state.calls.length, 0, "the first press only asks to confirm");
  root = draw();
  assert.match(text(root), /Restart 1 bot\? Press again to confirm/);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  assert.deepEqual(state.calls.map((c) => c.slice(5)), [["restart", "orch", "--project", "/work/a", "--json"]]);
  root = draw();
  assert.match(text(root), /Restarted 1: every Codex bot is on the new account/);
});

test("a refused restart is named, and the others still run", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }, { id: "b", name: "B", project: "/p" }], reliable: true } };
  state.exec = (_c, args) => (args.includes("a")
    ? { code: 1, stdout: "", stderr: "automagik-herdr: A is working; restart it when it is idle, or pass --force" }
    : { code: 0, stdout: "{}", stderr: "" });
  draw();
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  let root = draw();
  assert.match(text(root), /Restarted 1 of 2\. Not restarted:/);
  assert.match(text(root), /A: A is working; restart it when it is idle\./);
  // Pressing again retries only the one that failed.
  assert.match(text(root), /Restart 1 bot/);
  state.calls = [];
  state.exec = () => ({ code: 0, stdout: "{}", stderr: "" });
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  assert.deepEqual(state.calls.map((c) => c.slice(5, 7)), [["restart", "a"]]);
  root = draw();
  assert.match(text(root), /Restarted 2: every Codex bot is on the new account/);
});

test("a restart whose new pane exited names its agent's own cause, not the CLI's first stderr line (#413)", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }], reliable: true } };
  const cause = "Error: model provider example-proxy is no longer configured (modelProviderNotConfigured)";
  const error = `t100 exited before its agent was up; its agent said: "${cause}" (hc read t100 shows the rest); t5 still runs A, untouched.`;
  state.exec = () => ({ code: 1, stdout: JSON.stringify({ error, terminal: "t100", cause }),
    stderr: `automagik-herdr: A's pane moved to tab tb3.\nautomagik-herdr: ${error}\n` });
  draw();
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.match(text(root), /Restarted 0 of 1\. Not restarted:/);
  assert.ok(text(root).includes(`A: ${error}`), text(root));
  assert.ok(!text(root).includes("moved to tab"), "a warning before the refusal is not the reason");
});

test("a refusal is shown in the CLI's words, past its warnings, without the clause that names a flag (#413)", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }, { id: "b", name: "B", project: "/p" }], reliable: true } };
  const working = "A is working in t5; restarting now would cut its turn in half. Wait until it is idle.";
  const noId = "t6 carries no session id, so codex would resume the latest conversation in /p. Nothing was restarted.";
  state.exec = (_c, args) => ({ code: 1, stdout: "",
    stderr: args.includes("a") ? `automagik-herdr: a warning first\nautomagik-herdr: A is working in t5; restarting now would cut its turn in half. Wait until it is idle, or pass --force.\n`
      : `automagik-herdr: ${noId} Restart with --fresh for a new conversation, or pass --force to resume the latest one.\n` });
  draw();
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.ok(text(root).includes(`A: ${working}`), text(root));
  assert.ok(text(root).includes(`B: ${noId}`), text(root));
  assert.ok(!text(root).includes("a warning first"));
  assert.doesNotMatch(text(root), /--[a-z]/);
});

test("plain: every clause that names a flag goes; what an agent said, in quotes, stays as it said it (#413)", () => {
  assert.equal(plain("Let it finish, pass --tree to restart it too (resumed, under the new pane), or pass --force to end it."), "Let it finish.");
  assert.equal(plain("A is working; restart it when it is idle, or pass --force"), "A is working; restart it when it is idle.");
  assert.equal(plain("t100 exited; t5 still runs A, untouched. Try automagik-herdr restart b-a --fresh."), "t100 exited; t5 still runs A, untouched.");
  assert.equal(plain(`its agent said: "Error: unknown option --foo. See help" (hc read t1 shows the rest). Pass --force.`),
    `its agent said: "Error: unknown option --foo. See help" (hc read t1 shows the rest).`);
  assert.equal(plain("Restart with --fresh (or --tree)."), "");
  assert.equal(plain("Keep a well-known-word and t-5."), "Keep a well-known-word and t-5.");
});

// #413: the CLI's --json refusals of a busy bot, as cmdRestart prints them.
const WORKING = "A is working in t5; restarting now would cut its turn in half. Wait until it is idle, or pass --force.";
const HELPERS = "t5 has a helper that ends with it: t7. Let it finish, pass --tree to restart it too (resumed, under the new pane), or pass --force to end it with the pane.";
const busyAnswer = (refused = "working", error = WORKING) => ({ code: 1, stdout: JSON.stringify({ error, refused, terminal: "t5" }), stderr: `automagik-herdr: ${error}\n` });
const OK = { code: 0, stdout: JSON.stringify({ terminal: "t100", mode: "resume" }), stderr: "" };
const ticks = async () => { for (let i = 0; i < 20; i += 1) await new Promise((go) => setImmediate(go)); };
// The hc a busy panel sees: `panes` (address → status, "gone", "broken" when hc get fails with no
// not_found, or null for a pane reporting none), t5's helpers as its rows. Read each time, so a test changes them while a wait runs.
const fakeHc = (panes, { outlives = [] } = {}) => (args) => {
  if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ terminals: Object.keys(panes).filter((a) => a !== "t5").map((address) => ({ address, parent: "t5", state: "live" })) }), stderr: "" };
  const st = panes[args[1]];
  if (st === undefined || st === "gone") return { code: 3, stdout: "", stderr: JSON.stringify({ error: { kind: "not_found", message: "no terminal" } }) };
  if (st === "broken") return { code: 1, stdout: "", stderr: "hc: can't reach the server" };
  return { code: 0, stdout: JSON.stringify({ address: args[1], state: "live", status: st === null ? null : { state: st }, die_with_parent: !outlives.includes(args[1]) }), stderr: "" };
};
// A panel with A refused as `answer`. Its restart again answers `then`, and hc wait `wait(terminal)`.
// `probe`: how this Herdr answers an exec timeout that isn't a number: "runs" it (ignores the option,
// like every release so far), "refuses" it (honours the option), or "fails" some other way.
async function busyPanel({ answer = busyAnswer(), panes = { t5: "done" }, outlives = [], then = OK, wait = () => ({ code: 0, stdout: "{}", stderr: "" }), press = true, probe = "runs" } = {}) {
  const p = await panel();
  p.view.tool = "codex";
  p.view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }], reliable: true } };
  state.hcCalls = [];
  state.calls = [];
  state.execOptions = [];
  state.hc = fakeHc(panes, { outlives });
  let refused = false;
  state.exec = (command, args) => {
    if (command === "hc") return wait(args[1]);
    if (command === "true") {
      if (probe === "refuses") throw new Error("timeout must be a positive number of milliseconds");
      if (probe === "fails") throw new Error("cannot run true");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (!refused) { refused = true; return answer; }
    return typeof then === "function" ? then(args) : then;
  };
  p.draw();
  if (press) {
    nodes.get("restart-codex").click(null, p.cx);
    nodes.get("restart-codex").click(null, p.cx);
    await p.cx.settle();
    p.draw(); // the busy row's button, drawn
  }
  return p;
}
const restarts = () => state.calls.filter((c) => c[0] === "env" && c.includes("restart"));
const secondRestart = () => restarts()[1];
const waits = () => state.calls.filter((c) => c[0] === "hc");
const optionsOf = (call) => state.execOptions[state.calls.indexOf(call)];

test("a bot mid-turn shows busy with Restart when idle: hc wait through exec under its 10 min cap, then one restart (#413)", async () => {
  const panes = { t5: "working" };
  const { cx, draw } = await busyPanel({ panes, wait: () => { panes.t5 = "done"; return { code: 0, stdout: "{}", stderr: "" }; } });
  let root = draw();
  assert.match(text(root), /Restarted 0 of 1\. Not restarted:/);
  assert.ok(text(root).includes("A is busy: A is working in t5; restarting now would cut its turn in half. Wait until it is idle."), text(root));
  assert.match(text(root), /Restart A when idle/);
  assert.doesNotMatch(text(root), /\d+ min/, "no time is promised: a Herdr with no exec timeout cuts each wait at 30 s");
  assert.equal(restarts().length, 1, "no restart before the press");
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.deepEqual(waits(), [["hc", "wait", "t5", "--timeout", "450", "--json"]], "one wait, through exec (hc() stops at 30 s)");
  assert.deepEqual(optionsOf(waits()[0]), { timeout: 480000 }, "exec's own limit above hc's 450 s, below Herdr's 600 s cap");
  assert.equal(restarts().length, 2, "then one restart");
  assert.deepEqual(secondRestart().slice(5), ["restart", "a", "--project", "/p", "--json"], "no helpers: no tree");
  assert.deepEqual(optionsOf(secondRestart()), { timeout: 300000 }, "a restart outlasts exec's 30 s default");
  root = draw();
  assert.match(text(root), /Restarted 1: every Codex bot is on the new account/);
});

test("Restart when idle: a pane done, idle or in error restarts, with no wait; only a question, gone or unreadable stay out (#413)", async () => {
  for (const status of ["done", "idle", "error"]) {
    const { cx } = await busyPanel({ panes: { t5: status } });
    nodes.get("idle-codex-a").click(null, cx);
    await cx.settle();
    assert.equal(restarts().length, 2, status);
    assert.equal(waits().length, 0, status);
  }
  for (const [status, why] of [["blocked", "its pane t5 is waiting for an answer"], ["gone", "its pane t5 is gone"], [null, "hc can't say how t5 is"], ["broken", "hc can't say how t5 is"]]) {
    const { cx, draw } = await busyPanel({ panes: { t5: status } });
    nodes.get("idle-codex-a").click(null, cx);
    await cx.settle();
    assert.equal(restarts().length, 1, why);
    assert.ok(text(draw()).includes(`A is busy: ${why}; nothing was restarted`), text(draw()));
  }
});

test("Restart when idle: waits cut by Herdr's exec limit while the pane works restart nothing: 4 waits, then still busy, the wait it really did (#413)", async () => {
  const { cx, draw } = await busyPanel({ panes: { t5: "working" }, wait: () => { throw new Error("hc took longer than 30 s and was stopped"); } });
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.equal(waits().length, 4, "one wait at a time, four at most, never a loop");
  assert.equal(restarts().length, 1, "never restarted while it works");
  const root = draw();
  assert.ok(text(root).includes("A is busy: t5 still working after under a minute of waiting; nothing was restarted"), text(root));
  assert.match(text(root), /Restart A when idle/, "offered again");
});

test("Restart when idle: a wait cut at the limit on a pane that finished meanwhile still restarts: the look decides (#413)", async () => {
  const panes = { t5: "working" };
  const { cx } = await busyPanel({ panes, wait: () => { panes.t5 = "done"; throw new Error("hc took longer than 30 s and was stopped"); } });
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.equal(waits().length, 1);
  assert.equal(restarts().length, 2);
});

test("helpers all finished: the bot restarts with them at once, with no extra press and no wait (#413)", async () => {
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done", t8: "idle" } });
  assert.equal(waits().length, 0, "nothing to wait for");
  assert.equal(restarts().length, 2, "the confirmed press is enough");
  const tree = secondRestart();
  assert.deepEqual(tree.slice(tree.indexOf("restart")), ["restart", "a", "--project", "/p", "--tree", "--json"]);
  assert.ok(tree.includes("AUTOMAGIK_HERDR_TREE_TURN_WAIT_MS=10000"), "the panel waited: the CLI's own wait is only a race guard");
  assert.deepEqual(optionsOf(tree), { timeout: 600000 });
  assert.match(text(draw()), /Restarted 1: every Codex bot is on the new account/);
  assert.doesNotMatch(text(draw()), /--[a-z]/);
});

test("a helper still working: the panel waits for that helper only, then restarts with --tree, reading them again first (#413)", async () => {
  const panes = { t5: "idle", t7: "done", t8: "working" };
  const asked = [];
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes, wait: (t) => { asked.push(t); panes.t8 = "done"; return { code: 0, stdout: "{}", stderr: "" }; } });
  assert.deepEqual(asked, ["t8"], "only the one working");
  assert.equal(restarts().length, 2);
  assert.ok(secondRestart().includes("--tree"));
  assert.match(text(draw()), /Restarted 1: every Codex bot is on the new account/);
});

test("helpers: one that turns blocked during the wait stops the restart; so does a new one started meanwhile, until it is read (#413)", async () => {
  let panes = { t5: "idle", t8: "working" };
  let p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes, wait: () => { panes.t8 = "blocked"; return { code: 0, stdout: "{}", stderr: "" }; } });
  assert.equal(restarts().length, 1, "the read right before the restart caught it");
  assert.ok(text(p.draw()).includes("A is busy: its helper t8 is waiting for an answer; nothing was restarted"), text(p.draw()));
  panes = { t5: "idle", t8: "working" };
  p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes, wait: (t) => { if (t === "t8") { panes.t8 = "done"; panes.t9 = "working"; } else panes.t9 = "done"; return { code: 0, stdout: "{}", stderr: "" }; } });
  assert.deepEqual(waits().map((c) => c[2]), ["t8", "t9"], "one wait at a time, each on a pane working then");
  assert.ok(secondRestart().includes("--tree"));
});

test("a helper whose hc get fails with no not_found is not gone: no restart, with the reason, even as the sole helper (#413)", async () => {
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "broken" } });
  assert.equal(restarts().length, 1, "no plain restart that would end it with no word");
  assert.equal(waits().length, 0);
  assert.ok(text(draw()).includes("A is busy: hc can't say how its helper t7 is; nothing was restarted"), text(draw()));
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "gone" } });
  assert.equal(restarts().length, 2, "truly gone (exit 3, not_found): nothing left to end");
  assert.ok(!secondRestart().includes("--tree"));
});

test("a helper reporting no status doesn't hold the panel up: --tree runs, and the CLI's check judges it; an agent's refusal is listed without a flag (#413)", async () => {
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: null } });
  assert.ok(secondRestart().includes("--tree"), "a plain program such as a dev server passes");
  const said = "t7 doesn't tell hc whether it is busy, so --tree can't tell whether it has finished. Nothing was started. Look at it first, then pass --force to restart anyway.";
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: null }, then: { code: 1, stdout: "", stderr: `automagik-herdr: ${said}\n` } });
  const shown = text(draw());
  assert.ok(shown.includes("A: t7 doesn't tell hc whether it is busy. Nothing was started. Look at it first."), shown);
  assert.doesNotMatch(shown, /--[a-z]/);
  assert.match(shown, /Restart 1 bot/, "it stays on the list");
});

test("--tree refused though its JSON names a terminal is no restart: a new pane that exited, a turn started again; the bot stays listed (#413)", async () => {
  const cause = "Error: not logged in";
  const error = `t100 exited before its agent was up; its agent said: "${cause}" (hc read t100 shows the rest); t5 still runs A, untouched.`;
  let p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done" }, then: { code: 1, stdout: JSON.stringify({ error, terminal: "t100", cause }), stderr: `automagik-herdr: ${error}\n` } });
  let shown = text(p.draw());
  assert.doesNotMatch(shown, /every Codex bot is on the new account/);
  assert.ok(shown.includes(`A: ${error}`), shown);
  assert.deepEqual(p.view.switched.codex.look.bots.map((b) => b.id), ["a"], "still on the old account, still listed");
  p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done" }, then: busyAnswer("working") });
  shown = text(p.draw());
  assert.doesNotMatch(shown, /every Codex bot is on the new account/);
  assert.ok(shown.includes("A is busy: A is working in t5; restarting now would cut its turn in half. Wait until it is idle."), shown);
  assert.deepEqual(p.view.switched.codex.look.bots.map((b) => b.id), ["a"]);
});

test("a bot on a linked machine that needs --tree: the CLI's refusal (#437) keeps it on the old account, listed with why and no flag", async () => {
  // The CLI's words for restart --machine --tree, exit 2 with nothing on stdout, as the bot's name and machine fill them in.
  const said = "Restarting a bot's helpers on a linked machine isn't built yet, so nothing was read or restarted: A and its helpers on vm still run "
    + "as they were, on the account they started with. By hand: wait for a helper still working to finish, end each helper's pane "
    + "(hc kill vm/tN for one), then restart A there without --tree. A helper that still had work to do, start again yourself with hc run "
    + "on vm once A is back.";
  const p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done" }, then: { code: 2, stdout: "", stderr: `automagik-herdr: ${said}\n` } });
  assert.ok(secondRestart().includes("--tree"));
  const shown = text(p.draw());
  assert.ok(shown.includes("A: Restarting a bot's helpers on a linked machine isn't built yet, so nothing was read or restarted: A and its helpers on vm "
    + "still run as they were, on the account they started with. By hand: wait for a helper still working to finish, end each helper's pane "
    + "(hc kill vm/tN for one). A helper that still had work to do, start again yourself with hc run on vm once A is back."), shown);
  assert.doesNotMatch(shown, /--[a-z]/);
  assert.doesNotMatch(shown, /every Codex bot is on the new account/);
  assert.equal(p.view.switched.codex.result.done, 0, "never counted as restarted");
  assert.deepEqual(p.view.switched.codex.look.bots.map((b) => b.id), ["a"], "still on the old account, still listed");
});

test("helpers: blocked on a question or in error are not finished: no restart, with the reason; a pane that outlives the bot doesn't count (#413)", async () => {
  for (const [status, why] of [["blocked", "its helper t7 is waiting for an answer"], ["error", "its helper t7 is in error"]]) {
    const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: status, t8: "done" } });
    assert.equal(restarts().length, 1, why);
    assert.equal(waits().length, 0, why);
    const shown = text(draw());
    assert.ok(shown.includes(`A is busy: ${why}; nothing was restarted`), shown);
    assert.doesNotMatch(shown, /--[a-z]/);
  }
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "blocked" }, outlives: ["t7"] });
  assert.ok(!secondRestart().includes("--tree"), "a member bot isn't its helper");
});

test("a helper with helpers of its own: no restart, and why, before the CLI is asked (#413)", async () => {
  const panes = { t5: "idle", t7: "done" };
  const p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes, press: false });
  const hcOf = state.hc;
  state.hc = (args) => {
    if (args[0] !== "ls") return hcOf(args);
    return { code: 0, stdout: JSON.stringify({ terminals: [{ address: "t7", parent: "t5", state: "live" }, { address: "t9", parent: "t7", state: "live" }] }), stderr: "" };
  };
  panes.t9 = "idle";
  nodes.get("restart-codex").click(null, p.cx);
  nodes.get("restart-codex").click(null, p.cx);
  await p.cx.settle();
  assert.equal(restarts().length, 1);
  assert.ok(text(p.draw()).includes("A is busy: its helper t7 has helpers of its own, which a restart wouldn't bring back; nothing was restarted"), text(p.draw()));
});

test("a bot mid-turn that has helpers: pressed, it waits for the bot, then for them, then restarts with --tree (#413)", async () => {
  const panes = { t5: "working", t7: "working" };
  const { cx } = await busyPanel({ panes, wait: (t) => { panes[t] = "done"; return { code: 0, stdout: "{}", stderr: "" }; } });
  assert.equal(restarts().length, 1, "mid-turn: it waits for the press");
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.deepEqual(waits().map((c) => c[2]), ["t5", "t7"]);
  assert.ok(secondRestart().includes("--tree"));
});

test("--tree exits 1 for a helper not run again though the bot restarted: restarted, and the helper is named without a flag (#413)", async () => {
  const then = { code: 1, stdout: JSON.stringify({ terminal: "t100", mode: "resume", helpers: [{ name: "fix", replaced: "t7", error: "t101 exited before its agent was up (hc read t101 says why)", by_hand: "hc run --name fix -- codex" }] }), stderr: "" };
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done" }, then });
  const shown = text(draw());
  assert.match(shown, /Restarted 1: every Codex bot is on the new account/);
  assert.ok(shown.includes("A's helper fix: t101 exited before its agent was up (hc read t101 says why)"), shown);
  assert.doesNotMatch(shown, /--[a-z]/);
});

test("--tree ended by Herdr's limit says it may have stopped part-way (#413)", async () => {
  const then = () => { throw new Error("env took longer than 30 s and was stopped"); };
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done" }, then });
  assert.ok(text(draw()).includes("A: env took longer than 30 s and was stopped. It may have stopped part-way: check whether A and its helpers are back, then restart what is missing from a terminal, not from here"), text(draw()));
});

const probes = () => state.calls.filter((c) => c[0] === "true");
const THREE = { t5: "idle", t7: "done", t8: "idle", t9: "done" };

test("cap: a Herdr that ignores exec's timeout restarts by itself with 2 helpers, not 3: it says why and how, never a flag (#413)", async () => {
  const { draw } = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: THREE });
  assert.deepEqual(probes(), [["true"]], "a real read of the running Herdr, once");
  assert.deepEqual(state.execOptions[state.calls.indexOf(probes()[0])], { timeout: "probe" });
  assert.equal(restarts().length, 1, "above the cap: no restart");
  const shown = text(draw());
  assert.ok(shown.includes("A is busy: this Herdr stops a restart at 30 s, too soon to bring back 3 helpers; nothing was restarted. Restart A from a terminal"), shown);
  assert.doesNotMatch(shown, /--[a-z]/);
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { t5: "idle", t7: "done", t8: "idle" } });
  assert.equal(probes().length, 0, "at the cap: nothing to ask");
  assert.ok(secondRestart().includes("--tree"));
});

test("cap: a Herdr that honours exec's timeout has none; one that can't be read counts as ignoring it (#413)", async () => {
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: THREE, probe: "refuses" });
  assert.ok(secondRestart().includes("--tree"));
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: THREE, probe: "fails" });
  assert.equal(restarts().length, 1, "unreadable: the safe side");
});

test("cap: above it there is no wait either; no helpers, no probe: today's restart (#413)", async () => {
  await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes: { ...THREE, t7: "working" } });
  assert.equal(waits().length, 0, "nothing to wait for if it can't restart");
  assert.equal(restarts().length, 1);
  const { cx } = await busyPanel({ panes: { t5: "done" } });
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.equal(probes().length, 0);
  assert.equal(restarts().length, 2);
});

test("the wait is cancelable: pressed again, the wait's end restarts nothing; a retry press works; a reload holds no wait (#413)", async () => {
  let done;
  const panes = { t5: "working" };
  const { view, cx, draw } = await busyPanel({ panes, wait: () => new Promise((go) => { done = go; }) });
  nodes.get("idle-codex-a").click(null, cx);
  await ticks();
  assert.equal(waits().length, 1);
  assert.match(text(draw()), /Waiting for A · Cancel/);
  assert.match(text(draw()), /waiting for t5 to finish/);
  nodes.get("idle-codex-a").click(null, cx);
  assert.match(text(draw()), /A is busy: canceled; nothing was restarted/);
  assert.match(text(draw()), /Restart A when idle/);
  panes.t5 = "done";
  done({ code: 0, stdout: "{}", stderr: "" });
  await cx.settle();
  assert.equal(restarts().length, 1, "canceled: no restart");
  assert.equal(waits().length, 1, "and no second wait");
  assert.deepEqual(view.switched.codex.waiting, {});
  // A reloaded panel holds no wait at all: it is this panel's memory only.
  const again = await panel();
  assert.equal(again.view.switched.codex, undefined);
});

test("the helper wait is cancelable too, with no press needed to start it (#413)", async () => {
  let done;
  const panes = { t5: "idle", t7: "working" };
  const p = await busyPanel({ answer: busyAnswer("helpers", HELPERS), panes, press: false, wait: () => new Promise((go) => { done = go; }) });
  nodes.get("restart-codex").click(null, p.cx);
  nodes.get("restart-codex").click(null, p.cx);
  await ticks();
  p.draw();
  assert.match(text(p.draw()), /Waiting for A · Cancel/);
  nodes.get("idle-codex-a").click(null, p.cx);
  panes.t7 = "done";
  done({ code: 0, stdout: "{}", stderr: "" });
  await p.cx.settle();
  assert.equal(restarts().length, 1, "canceled: nothing restarted");
});

test("a switch running when the bot is ready: no restart, and it says so (#413)", async () => {
  const { view, cx, draw } = await busyPanel({ panes: { t5: "done" } });
  view.busy = { provider: "claude", label: "x" };
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.equal(restarts().length, 1);
  view.busy = null;
  assert.match(text(draw()), /A is busy: A is ready, but a switch was running; nothing was restarted/);
});

test("a restart that started fresh says which bot and why (#328: no session id, a teammate in the folder)", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }, { id: "b", name: "B", project: "/p" }], reliable: true } };
  const note = "no Codex session id is known for t5, and B (t9) also runs Codex in /p, so resume --last could resume theirs instead of A's";
  const shown = "no Codex session id is known for t5, and B (t9) also runs Codex in /p, so a resume could resume theirs instead of A's";
  state.exec = (_c, args) => ({ code: 0, stdout: JSON.stringify(args.includes("a") ? { mode: "fresh", note } : { mode: "resume", note: null }), stderr: "" });
  draw();
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.match(text(root), /Restarted 2: every Codex bot is on the new account/);
  assert.match(text(root), /Started on a new conversation instead of resuming it:/);
  assert.ok(text(root).includes(`A: ${shown}`), text(root));
  assert.doesNotMatch(text(root), /--[a-z]/);
  assert.ok(!text(root).includes("B: "), "a bot that resumed isn't listed");
});

test("no restart while a switch is running", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }], reliable: true } };
  view.busy = "switching Codex…";
  draw();
  state.calls = [];
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  assert.deepEqual(state.calls, []);
  assert.match(text(draw()), /a switch is running: restart the bots once it is done/);
});

test("no sidebar mod: the banner says how to restart, with no button", async () => {
  const { view, cx, draw } = await panel({ sidebar: false });
  view.tool = "codex";
  draw();
  nodes.get("primary-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.match(text(root), /automagik-herdr restart <bot>/);
  assert.equal(nodes.has("restart-codex"), false);
});

test("an unclear start time lists every bot of that tool, and says so", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  draw();
  state.exec = (command, args) => (command === "env" && args.includes("ls")
    ? { code: 0, stdout: JSON.stringify({ projects: [{ project: "/p", bots: [
      { id: "x", name: "X", agent: "codex", project: "/p", terminal: "t1", status: "idle", since: null },
      { id: "y", name: "Y", agent: "codex", project: "/p", terminal: "t2", status: "idle", since: iso(NOW + H) }] }] }), stderr: "" }
    : { code: 0, stdout: "", stderr: "" });
  nodes.get("primary-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.match(text(root), /can't tell which of these 2 Codex bots started before the switch/);
  assert.match(text(root), /Restart 2 bots/);
});

test("colours: suggestions are never red; running out is amber", async () => {
  const { view, draw } = await panel();
  view.tool = "codex";
  const root = draw();
  const colours = all(root).map((n) => n.props.color).filter(Boolean);
  assert.ok(colours.includes("t.working"), "the amber sentence");
  assert.equal(colours.includes("t.blocked"), false, "no red without an error");
});

test("active.json from before: a bare name is a record, a saved-login record is none", () => {
  assert.deepEqual(records({ codex: "codex-a.json", claude: { name: "saved:work", fingerprint: "f", saved: "work" } }),
    { codex: { name: "codex-a.json", fingerprint: null } });
});

test("no switch while bots restart; a switch's busy line names the account by email", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  draw();
  view.restarting = { codex: true };
  const before = installs.length;
  nodes.get("primary-codex").click(null, cx);
  await cx.settle();
  assert.equal(installs.length, before, "nothing installed");
  assert.match(text(draw()), /bots are restarting: switch once they are done/);
  view.restarting = {};
  view.switchError = null;
  let line = null;
  const busyAt = installs.length;
  nodes.get("primary-codex").click(null, cx);
  line = view.busy;
  await cx.settle();
  assert.equal(line, "switching Codex to bo@example.com · Pro…");
  assert.equal(installs.length, busyAt + 1);
});
