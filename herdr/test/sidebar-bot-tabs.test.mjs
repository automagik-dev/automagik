// Tab naming through the sidebar's render, with the fake Herdr API only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, setSnapshot, sidebar, state } from "./sidebar-tree.mjs";

const Spaces = await load();
const ID = "b-genieaaaaa";
const bot = { id: ID, name: "Team Guide" };

function scene({ named = false, labels = { bot: ID }, remote = false, panes = null } = {}) {
  const prefix = remote ? "box/" : "";
  const tab = { id: `${prefix}tab1`, name: "1", named };
  const terminal = { address: `${prefix}t1`, state: "live", labels };
  const snap = {
    spaces: [{ id: `${prefix}s1`, name: "proj", folder: "/work/proj", machine: remote ? "box" : null, tabs: [tab] }],
    panes: panes ?? [{ pane: `${prefix}p1`, terminal: terminal.address, tab: tab.id }],
    terminals: [terminal], agents: [], machines: [],
    bots: [{ key: "/work/proj", machine: remote ? "box" : null, file: { version: 1, categories: [], bots: [bot] }, spaces: [`${prefix}s1`] }],
  };
  setSnapshot(snap);
  state.runs = [];
  const s = sidebar(Spaces, snap);
  const render = () => s.render({ notify() {} });
  return { s, render, tab, terminal };
}

test("an unnamed bot tab is renamed once, including renders before the named flag arrives", () => {
  const { render } = scene();
  render(); render();
  assert.deepEqual(state.runs, [["tab.rename", { id: "tab1", name: "Team Guide" }]]);
});

test("a person-named tab is never renamed", () => {
  const { render } = scene({ named: true });
  render();
  assert.deepEqual(state.runs, []);
});

test("unlabelled, worker-only and unknown-bot tabs are untouched", () => {
  for (const labels of [{}, { "worker.of": ID }, { bot: "b-unknownaaa" }]) {
    scene({ labels }).render();
    assert.deepEqual(state.runs, [], JSON.stringify(labels));
  }
});

test("only the first terminal counts, skipping mod panes but never skipping a shell", () => {
  const panes = [{ pane: "mod", terminal: null, tab: "tab1" },
    { pane: "p2", terminal: "t2", tab: "tab1" }, { pane: "p1", terminal: "t1", tab: "tab1" }];
  const { render } = scene({ panes });
  state.terminals.push({ address: "t2", state: "live", labels: {} });
  render();
  assert.deepEqual(state.runs, []);
  scene({ panes: [panes[0], panes[2]] }).render();
  assert.deepEqual(state.runs, [["tab.rename", { id: "tab1", name: "Team Guide" }]]);
});

test("a remote tab uses its machine-prefixed id as given", () => {
  scene({ remote: true }).render();
  assert.deepEqual(state.runs, [["tab.rename", { id: "box/tab1", name: "Team Guide" }]]);
});

test("a later bot restart in the same tab keeps the original name", () => {
  const { render, s } = scene();
  render();
  s.bots[0].file.bots = [{ ...bot, id: "b-restartaaa", name: "Replacement" }];
  state.terminals[0] = { address: "t9", state: "live", labels: { bot: "b-restartaaa" } };
  state.panes[0].terminal = "t9";
  render();
  assert.deepEqual(state.runs, [["tab.rename", { id: "tab1", name: "Team Guide" }]]);
  // A fresh mod instance relies on the app's persisted named flag too.
  scene({ named: true }).render();
  assert.deepEqual(state.runs, []);
});
