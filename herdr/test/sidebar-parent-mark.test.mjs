// automagik#231 in the sidebar's render (main.js) under `node --test`, with gpui and herdr
// stood in for (gpui-stub.mjs, sidebar-herdr-stub.mjs): a bot row whose live pane's hc parent
// is not its lead's pane draws a mark whose tooltip names both addresses; other rows draw none.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBots } from "../mods/am-sidebar/model.js";
import { botFold, categoryFold } from "../mods/am-sidebar/rows.js";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./sidebar-herdr-stub.mjs"), "fs/promises": here("./fs-stub.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
const fromPack = (context) => context.parentURL?.includes("/mods/am-sidebar/");
registerHooks({
  resolve: (specifier, context, next) => (stubs[specifier] && fromPack(context) ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context)),
});
const { state } = await import(stubs.herdr);
const { all } = await import(stubs["gpui-kit"]);
const { default: Spaces } = await import("../mods/am-sidebar/main.js");

const KEY = "/work/proj";
const look = { character: "star", colour: "blue" };
const bot = (id, name, more = {}) => ({ id, name, kind: "member", look, role: "role", instructions: "", agent: "claude", ...more });
const { file } = parseBots(JSON.stringify({
  version: 1, categories: [{ id: "eng", title: "Engineering" }],
  bots: [bot("b-mainmainma", "Main", { kind: "main" }), bot("b-captaincap", "Captain", { category: "eng" }),
    bot("b-devdevdevd", "Dev", { lead: "b-captaincap", category: "eng" }), bot("b-testtestte", "Tester", { lead: "b-captaincap", category: "eng" })],
}));
const pane = (address, id, parent = null) => ({ address, state: "live", labels: { bot: id }, parent, status: "idle", status_ms: Date.now(),
  created_ms: 1, program: { key: "claude", name: "Claude Code", agent: true }, foreground: { argv: ["claude"] } });

// A sidebar as init leaves it, without init's timers, discovery and file reads, every fold open.
function render(terminals, machine = null) {
  const space = { id: "s1", name: "proj", folder: KEY, tabs: [{ id: "tab1", name: "tab 1" }] };
  Object.assign(state, { terminals, panes: [], agentRows: [], spaces: [space], machineRows: [] });
  state.shared.clear();
  const tree = { key: KEY, machine };
  const s = Object.create(Spaces.prototype);
  Object.assign(s, {
    git: {}, checked: {}, unsure: new Set(), pending: new Set(), busy: {}, ready: {}, at: {}, watching: new Set(),
    shown: new Set(["s1"]), born: {}, pressed: null, over: null, machines: [], folded: new Set(),
    screen: {}, extra: {}, bots: [{ key: KEY, machine, file, spaces: ["s1"] }], hoverRow: null, trees: [], places: new Map(), botOf: new Map(),
    open: new Map([botFold("b-mainmainma"), botFold("b-captaincap"), categoryFold(tree, "eng")].map((k) => [k, true])),
    pets: new Set(), petsWanted: new Map(), petsFailed: new Set(), wakeAt: null, modelTexts: {}, modelDefaults: {},
    argvOf: new Map(), paneKeys: new Map(), opening: new Set(), known: [],
    hermes: { key: "hermes", name: "Hermes", icon: "icons/hermes.svg", tint: true },
  });
  const nodes = all(s.render({ notify() {} }));
  const ids = new Set(nodes.map((n) => n.id));
  for (const id of ["b-mainmainma", "b-captaincap", "b-devdevdevd"]) assert.ok(ids.has(`row-b:${id}`), `${id}'s row is drawn`);
  const marks = nodes.filter((n) => typeof n.id === "string" && n.id.startsWith("parent-"));
  return { marks: Object.fromEntries(marks.map((n) => [n.id, n.props.tooltip])) };
}

test("#231 render: the marked row's tooltip names the hc parent and the lead's pane; no other row is marked", () => {
  const { marks } = render([pane("t1", "b-mainmainma"), pane("t2", "b-captaincap", "t1"), pane("t3", "b-devdevdevd", "t1"), pane("t4", "b-testtestte", "t2")]);
  assert.deepEqual(marks, { "parent-b-devdevdevd": "Its hc parent is t1, not its lead's pane t2 (Captain)" });
});

test("#231 render: no mark when the parent is absent or the lead's pane, or the lead has no live pane", () => {
  assert.deepEqual(render([pane("t1", "b-mainmainma"), pane("t2", "b-captaincap"), pane("t3", "b-devdevdevd")]).marks, {});
  assert.deepEqual(render([pane("t1", "b-mainmainma"), pane("t2", "b-captaincap", "t1"), pane("t3", "b-devdevdevd", "t2")]).marks, {});
  assert.deepEqual(render([pane("t1", "b-mainmainma"), pane("t3", "b-devdevdevd", "t9")]).marks, {});
});

test("#231 render: a lead with two live panes: the older pane as parent is no mark; a third terminal is, naming both", () => {
  const two = (parent) => [pane("t1", "b-mainmainma"), { ...pane("t2", "b-captaincap", "t1"), created_ms: 1 }, { ...pane("t5", "b-captaincap", "t1"), created_ms: 2 },
    pane("t3", "b-devdevdevd", parent)];
  assert.deepEqual(render(two("t2")).marks, {});
  assert.deepEqual(render(two("t9")).marks, { "parent-b-devdevdevd": "Its hc parent is t9, not its lead's panes t5, t2 (Captain)" });
});

test("#231 render: a remote project compares on its machine", () => {
  const box = (a) => `box/${a}`;
  assert.deepEqual(render([pane(box("t1"), "b-mainmainma"), pane(box("t2"), "b-captaincap", "t1"), pane(box("t3"), "b-devdevdevd", "t2")], "box").marks, {});
  assert.deepEqual(render([pane(box("t1"), "b-mainmainma"), pane(box("t2"), "b-captaincap", "t1"), pane(box("t3"), "b-devdevdevd", "t9")], "box").marks,
    { "parent-b-devdevdevd": "Its hc parent is box/t9, not its lead's pane box/t2 (Captain)" });
});
