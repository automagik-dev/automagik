import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { waitsOnPermission as sidebarWaits } from "../mods/am-sidebar/launchArgs.js";
import { NEEDS_YOU as SIDEBAR_NEEDS_YOU, NEEDS_YOU_PERMISSION as SIDEBAR_PERMISSION } from "../mods/am-sidebar/rows.js";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./am-tabs-herdr.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
const fromMod = (context) => context.parentURL?.includes("/mods/am-tabs/");
registerHooks({
  resolve: (specifier, context, next) =>
    stubs[specifier] && fromMod(context) ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context),
});

const { state, ui } = await import(stubs.herdr);
const { default: Tabs, waitsOnPermission, NEEDS_YOU, NEEDS_YOU_PERMISSION } = await import("../mods/am-tabs/main.js");
const { all, index, nodes } = await import(stubs["gpui-kit"]);

function scene() {
  const tab = (id, status = "blocked") => ({ id, name: id, status });
  state.spaces = [
    { id: "s1", active: true, tabs: [tab("permission"), tab("question"), tab("mixed"),
      tab("missing"), tab("working", "working"), tab("remote")] },
    { id: "s2", active: false, tabs: [tab("inactive")] },
  ];
  ui.panes = [["permission", "t1"], ["question", "t3"], ["mixed", "t4"], ["mixed", "t5"],
    ["missing", "t6"], ["working", "t7"], ["remote", "host-b/t2"], ["inactive", "t8"]]
    .map(([tab, terminal], i) => ({ pane: `p${i}`, tab, terminal }));
  const row = (address, kind, state = "blocked") => ({ address, report: { state, kind } });
  state.terminals = [row("t2", "permission"), row("t1", "permission"), row("t3", "question"),
    row("t4", "question"), row("t5", "permission"), row("t7", "permission", "working"),
    row("host-b/t2", "question"), row("t8", "permission")];
  ui.terminalReads = 0;
  return Object.assign(Object.create(Tabs.prototype), { pressed: null, hovered: null, settled: null, panels: {} });
}

function chip(id) {
  const tab = nodes.get(`tab-${id}`);
  assert.ok(tab, id);
  return tab.kids.flatMap(all).find((n) => n.kids.length === 1
    && typeof n.kids[0] === "string" && ["Needs you", "Permission"].includes(n.kids[0]))?.kids[0];
}

test("the tab chip names a permission only from herdr-core's report, per tab", () => {
  index(scene().render());
  assert.equal(chip("permission"), "Permission");
  assert.equal(chip("question"), "Needs you");
  assert.equal(chip("mixed"), "Permission");
  assert.equal(chip("missing"), "Needs you");
  assert.equal(chip("working"), undefined);
  assert.equal(chip("remote"), "Needs you");
  assert.equal(nodes.has("tab-inactive"), false);
});

test("terminals() is read once per render, and not without a blocked tab", () => {
  const tabs = scene();
  tabs.render();
  assert.equal(ui.terminalReads, 1);
  for (const c of state.spaces[0].tabs) c.status = "working";
  ui.terminalReads = 0;
  tabs.render();
  assert.equal(ui.terminalReads, 0);
});

test("am-tabs's copies equal the sidebar's", () => {
  assert.equal(NEEDS_YOU, SIDEBAR_NEEDS_YOU);
  assert.equal(NEEDS_YOU_PERMISSION, SIDEBAR_PERMISSION);
  for (const report of [{ app: "claude-code", state: "blocked", kind: "permission", msg: "x" },
    null, undefined, "blocked", {}, { state: "blocked" },
    ...["question", "auth", "Permission"].map((kind) => ({ state: "blocked", kind })),
    ...["working", "done"].map((state) => ({ state, kind: "permission" }))]) {
    assert.equal(waitsOnPermission(report), sidebarWaits(report), JSON.stringify(report));
  }
});
