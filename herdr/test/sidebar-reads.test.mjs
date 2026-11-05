// Herdr's snapshot calls (spaces, panes, terminals, agents, machines, focused) each copy the
// whole key, so the sidebar reads each one at most once per render and once per tick of its
// 250 ms timer, whatever the number of spaces, rows and machines (sidebar-herdr-stub.mjs counts
// them). Drawn on sidebar-tree.mjs's cases, whose trees sidebar-tree.test.mjs checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, load, cases, setSnapshot, sidebar } from "./sidebar-tree.mjs";

const Spaces = await load();
const KEYS = ["spaces", "panes", "terminals", "agents", "machines", "focused"];
const total = (reads) => Object.values(reads).reduce((a, b) => a + b, 0);

test("sidebar render: each snapshot key is read at most once per render", (t) => {
  for (const [name, snap] of cases()) for (const collapsed of [false, true]) {
    setSnapshot(snap, collapsed);
    const s = sidebar(Spaces, snap);
    for (const pass of ["first", "second"]) {
      state.reads = {};
      s.render({ notify() {} });
      t.diagnostic(`${name}${collapsed ? " (collapsed)" : ""}, ${pass} render: ${total(state.reads)} reads ${JSON.stringify(state.reads)}`);
      for (const key of KEYS) assert.ok((state.reads[key] ?? 0) <= 1, `${name}${collapsed ? " (collapsed)" : ""}, ${pass} render: ${key}() read ${state.reads[key]} times`);
    }
  }
});

// The 250 ms timer's body (init: checkNew, botTick, the updater's request), after a render.
test("sidebar 250 ms timer: each snapshot key is read at most once per tick", (t) => {
  const cx = { notify() {}, spawn() {}, timer: { after() {}, every() {} } };
  for (const [name, snap] of cases()) {
    setSnapshot(snap);
    const s = sidebar(Spaces, snap);
    s.updater = { request() {} };
    s.render(cx);
    for (const pass of ["first", "second"]) {
      state.reads = {};
      s.checkNew(cx); s.botTick(cx); s.updater.request();
      t.diagnostic(`${name}, ${pass} tick: ${total(state.reads)} reads ${JSON.stringify(state.reads)}`);
      for (const key of KEYS) assert.ok((state.reads[key] ?? 0) <= 1, `${name}, ${pass} tick: ${key}() read ${state.reads[key]} times`);
    }
  }
});
