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
