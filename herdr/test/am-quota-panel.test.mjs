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
const { default: Panel, records } = await import("../mods/am-quota/main.js");
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
  assert.match(text(root), /A: A is working; restart it when it is idle, or pass --force/);
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

test("a busy bot's refusal (working, or with helpers) is shown as the CLI words it, past its warnings (#413)", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }, { id: "b", name: "B", project: "/p" }], reliable: true } };
  const working = "A is working in t5; restarting now would cut its turn in half. Wait until it is idle, or pass --force.";
  const helpers = "t6 has a helper that ends with it: t7. Let it finish, pass --tree to restart it too (resumed, under the new pane), or pass --force to end it with the pane.";
  state.exec = (_c, args) => ({ code: 1, stdout: "",
    stderr: args.includes("a") ? `automagik-herdr: a warning first\nautomagik-herdr: ${working}\n` : `automagik-herdr: ${helpers}\n` });
  draw();
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.ok(text(root).includes(`A: ${working}`), text(root));
  assert.ok(text(root).includes(`B: ${helpers}`), text(root));
  assert.ok(!text(root).includes("a warning first"));
});

// #413: the CLI's --json refusal of a busy bot, as cmdRestart prints it.
const WORKING = "A is working in t5; restarting now would cut its turn in half. Wait until it is idle, or pass --force.";
const busyAnswer = (refused = "working", error = WORKING) => ({ code: 1, stdout: JSON.stringify({ error, refused, terminal: "t5" }), stderr: `automagik-herdr: ${error}\n` });
const paneIs = (status, state = "live") => ({ code: 0, stdout: JSON.stringify({ address: "t5", state, status: { state: status } }), stderr: "" });
const ticks = async () => { for (let i = 0; i < 20; i += 1) await new Promise((go) => setImmediate(go)); };
// A busy panel: A refused as `answer`; then hc wait (exec "hc") answers `wait`, and hc get the pane as `pane`.
async function busyPanel(answer = busyAnswer(), { wait = () => ({ code: 0, stdout: "{}", stderr: "" }), pane = () => paneIs("idle") } = {}) {
  const p = await panel();
  p.view.tool = "codex";
  p.view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }], reliable: true } };
  state.hcCalls = [];
  state.hc = (args) => (args[0] === "get" ? pane() : { code: 1, stdout: "", stderr: "unexpected" });
  state.exec = (command) => (command === "hc" ? wait() : answer);
  p.draw();
  nodes.get("restart-codex").click(null, p.cx);
  nodes.get("restart-codex").click(null, p.cx);
  await p.cx.settle();
  state.calls = [];
  state.execOptions = [];
  p.draw(); // the busy row's button, drawn
  return p;
}
const restarts = () => state.calls.filter((c) => c[0] === "env" && c.includes("restart"));
const waits = () => state.calls.filter((c) => c[0] === "hc");
const waitOptions = () => state.execOptions.filter((_o, i) => state.calls[i][0] === "hc");

test("a busy bot shows busy with Restart when idle: hc wait through exec under its 10 min cap, then one restart (#413)", async () => {
  const { cx, draw } = await busyPanel();
  let root = draw();
  assert.match(text(root), /Restarted 0 of 1\. Not restarted:/);
  assert.ok(text(root).includes(`A is busy: ${WORKING}`), text(root));
  assert.match(text(root), /Restart A when idle \(waits up to 30 min\)/);
  state.exec = (command) => (command === "hc" ? { code: 0, stdout: "{}", stderr: "" } : { code: 0, stdout: "{}", stderr: "" });
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.deepEqual(waits(), [["hc", "wait", "t5", "--timeout", "450", "--json"]], "one wait, through exec (hc() stops at 30 s)");
  assert.deepEqual(waitOptions(), [{ timeout: 480000 }], "exec's own limit above hc's 450 s, below Herdr's 600 s cap");
  assert.deepEqual(state.hcCalls, [["get", "t5", "--json"]], "then how the pane is");
  assert.deepEqual(restarts().map((c) => c.slice(5)), [["restart", "a", "--project", "/p", "--json"]], "then one restart");
  assert.deepEqual(state.execOptions[state.calls.findIndex((c) => c[0] === "env" && c.includes("restart"))], { timeout: 300000 },
    "a restart outlasts exec's 30 s default (its new pane's wait, twice for codex): its own limit");
  root = draw();
  assert.match(text(root), /Restarted 1: every Codex bot is on the new account/);
});

test("Restart when idle: a wait cut by Herdr's exec limit, the pane still working, restarts nothing: at most 4 waits, then still busy (#413)", async () => {
  const { cx, draw } = await busyPanel(busyAnswer(), { wait: () => { throw new Error("hc timed out after 30s"); }, pane: () => paneIs("working") });
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.equal(waits().length, 4, "one wait at a time, four at most (30 min in all), never a loop");
  assert.equal(restarts().length, 0, "never restarted while it works");
  const root = draw();
  assert.ok(text(root).includes("A is busy: still working after the panel's 30 min wait; nothing was restarted"), text(root));
  assert.match(text(root), /Restart A when idle/, "offered again");
});

test("Restart when idle: a wait that ends on a pane blocked or gone restarts nothing and says why (#413)", async () => {
  for (const [pane, why] of [[paneIs("blocked"), "its pane is blocked"], [{ code: 1, stdout: "", stderr: "no terminal t5" }, "its pane t5 is gone"]]) {
    const { cx, draw } = await busyPanel(busyAnswer(), { pane: () => pane });
    nodes.get("idle-codex-a").click(null, cx);
    await cx.settle();
    assert.equal(waits().length, 1);
    assert.equal(restarts().length, 0);
    assert.ok(text(draw()).includes(`A is busy: ${why}; nothing was restarted`), text(draw()));
  }
});

test("Restart when idle for a bot with helpers waits on them (hc wait --children all); still busy: refused once, listed again (#413)", async () => {
  const helpers = "t5 has a helper that ends with it: t7. Let it finish, pass --tree to restart it too (resumed, under the new pane), or pass --force to end it with the pane.";
  const { cx, draw } = await busyPanel(busyAnswer("helpers", helpers));
  nodes.get("idle-codex-a").click(null, cx);
  await cx.settle();
  assert.deepEqual(waits(), [["hc", "wait", "t5", "--children", "all", "--timeout", "450", "--json"]]);
  assert.equal(restarts().length, 1, "one restart, no second wait");
  const root = draw();
  assert.ok(text(root).includes(`A is busy: ${helpers}`), text(root));
  assert.match(text(root), /Restart A when idle/, "the action is offered again, not run again");
  assert.equal(waits().length, 1);
});

test("Restart when idle is cancelable: pressed again while it waits, the wait's end restarts nothing (#413)", async () => {
  let done;
  const { view, cx, draw } = await busyPanel(busyAnswer(), { wait: () => new Promise((go) => { done = go; }) });
  nodes.get("idle-codex-a").click(null, cx);
  await ticks();
  assert.equal(waits().length, 1);
  assert.match(text(draw()), /Waiting for A to be idle · Cancel/);
  nodes.get("idle-codex-a").click(null, cx);
  assert.match(text(draw()), /Restart A when idle/);
  done({ code: 0, stdout: "{}", stderr: "" });
  await cx.settle();
  assert.equal(restarts().length, 0, "canceled: no restart");
  assert.equal(waits().length, 1, "and no second wait");
  assert.deepEqual(view.switched.codex.waiting, {});
  // A reloaded panel holds no wait at all: it is this panel's memory only.
  const again = await panel();
  assert.equal(again.view.switched.codex, undefined);
});

test("a restart that started fresh says which bot and why (#328: no session id, a teammate in the folder)", async () => {
  const { view, cx, draw } = await panel();
  view.tool = "codex";
  view.switched.codex = { at: NOW, from: "ana@example.com · Pro", to: "bo@example.com · Pro",
    look: { bots: [{ id: "a", name: "A", project: "/p" }, { id: "b", name: "B", project: "/p" }], reliable: true } };
  const note = "no Codex session id is known for t5, and B (t9) also runs Codex in /p, so resume --last could resume theirs instead of A's";
  state.exec = (_c, args) => ({ code: 0, stdout: JSON.stringify(args.includes("a") ? { mode: "fresh", note } : { mode: "resume", note: null }), stderr: "" });
  draw();
  nodes.get("restart-codex").click(null, cx);
  nodes.get("restart-codex").click(null, cx);
  await cx.settle();
  const root = draw();
  assert.match(text(root), /Restarted 2: every Codex bot is on the new account/);
  assert.match(text(root), /Started on a new conversation instead of resuming it:/);
  assert.ok(text(root).includes(`A: ${note}`), text(root));
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
