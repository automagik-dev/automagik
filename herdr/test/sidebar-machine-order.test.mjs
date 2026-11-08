// The machines' order in the sidebar: this computer first, then the others by name, unless the
// person moved one to the top (a header's "Move to top", kept in the sidebar's localStorage as
// machines.order). Drawn through the whole sidebar with the fake Herdr API and a stand-in
// localStorage only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, setSnapshot, sidebar } from "./sidebar-tree.mjs";
import { all } from "./gpui-stub.mjs";
import { orderMachines, movedToTop, readMachineOrder } from "../mods/am-sidebar/rows.js";

const Spaces = await load();
const cx = { notify() {}, stop_propagation() {} };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

// This computer and two remote machines with a space each, and a third remote one asleep.
function scene(order, collapsed = false) {
  const space = (id, machine) => ({ id, name: id, folder: `/work/${id}`, machine, tabs: [] });
  const snap = {
    spaces: [space("s1", null), space("box-b/s2", "box-b"), space("box-a/s3", "box-a")],
    panes: [], terminals: [], agents: [], machines: [{ name: "box-a", layout: "ready" }, { name: "box-b", layout: "ready" }],
    hcMachines: [{ name: "box-a", state: "connected" }, { name: "box-b", state: "connected" }, { name: "box-c", state: "asleep" }],
  };
  setSnapshot(snap, collapsed);
  const s = sidebar(Spaces, snap);
  if (order !== undefined) s.machineOrder = order;
  return s;
}
const HEAD = /^machine-(?!add-|top-|new-|loading-)(.+)$/;
const nodes = (s) => all(s.render(cx));
const heads = (s) => nodes(s).map((n) => HEAD.exec(n.id ?? "")?.[1]).filter(Boolean);
const node = (s, id) => nodes(s).find((n) => n.id === id);
const hover = (s, m) => node(s, `machine-${m ?? "local"}`).calls.find((c) => c[0] === "on_hover")[1](true, cx);

test("orderMachines: the saved names first, every other one in its drawn place", () => {
  const drawn = [null, "box-a", "box-b", "box-c"];
  assert.deepEqual(orderMachines(drawn), drawn);
  assert.deepEqual(orderMachines(drawn, []), drawn);
  assert.deepEqual(orderMachines(drawn, ["box-c"]), ["box-c", null, "box-a", "box-b"]);
  assert.deepEqual(orderMachines(drawn, ["box-b", null]), ["box-b", null, "box-a", "box-c"]);
  // A removed machine takes no place; a name saved twice counts once.
  assert.deepEqual(orderMachines(drawn, ["gone", "box-c", "box-c"]), ["box-c", null, "box-a", "box-b"]);
});

test("movedToTop and readMachineOrder", () => {
  assert.deepEqual(movedToTop([], "box-b"), ["box-b"]);
  assert.deepEqual(movedToTop(["box-b", "gone", null], null), [null, "box-b", "gone"]);
  assert.deepEqual(readMachineOrder(null), []);
  assert.deepEqual(readMachineOrder("not json"), []);
  assert.deepEqual(readMachineOrder('{"a":1}'), []);
  assert.deepEqual(readMachineOrder('["box-a",null,3,"",{}]'), ["box-a", null]);
});

test("no saved order: this computer first, then the others by name, as before", () => {
  assert.deepEqual(heads(scene()), ["local", "box-a", "box-b", "box-c"]);
  assert.deepEqual(heads(scene([])), ["local", "box-a", "box-b", "box-c"]);
});

test("a saved order draws first; unknown and removed machines keep their place after it", () => {
  assert.deepEqual(heads(scene(["box-b"])), ["box-b", "local", "box-a", "box-c"]);
  assert.deepEqual(heads(scene(["gone", "box-c", null])), ["box-c", "local", "box-a", "box-b"]);
  // Each machine's spaces stay under its own header.
  const ids = nodes(scene(["box-b"])).map((n) => n.id).filter((id) => /^(machine-(local|box-.)|space-((box-.\/)?s\d))$/.test(id ?? ""));
  assert.deepEqual(ids, ["machine-box-b", "space-box-b/s2", "machine-local", "space-s1", "machine-box-a", "space-box-a/s3", "machine-box-c"]);
});

test("Move to top: on every header but the first, seen and pressable only while hovered", () => {
  const s = scene();
  assert.equal(node(s, "machine-top-local"), undefined);
  const hidden = node(s, "machine-top-box-b");
  assert.equal(hidden.props.opacity, 0);
  assert.equal(hidden.click, undefined);
  hover(s, "box-b");
  const shown = node(s, "machine-top-box-b");
  assert.equal(shown.props.tooltip, "Move to top");
  assert.equal(node(s, "machine-top-box-a").props.opacity, 0);
  let stopped = false;
  store.clear();
  shown.click({}, { ...cx, stop_propagation() { stopped = true; } });
  assert.equal(stopped, true, "the header's fold toggle does not also run");
  assert.deepEqual(JSON.parse(store.get("machines.order")), ["box-b"]);
  assert.deepEqual(heads(s), ["box-b", "local", "box-a", "box-c"]);
  // This computer has the action too once it is not first.
  hover(s, null);
  node(s, "machine-top-local").click({}, cx);
  assert.deepEqual(JSON.parse(store.get("machines.order")), [null, "box-b"]);
  assert.deepEqual(heads(s), ["local", "box-b", "box-a", "box-c"]);
});

test("collapsed: no Move to top, the saved order still holds", () => {
  const s = scene(["box-c"], true);
  s.hoverMachine = "box-a";
  assert.deepEqual(heads(s), ["box-c", "local", "box-a", "box-b"]);
  assert.equal(nodes(s).some((n) => n.id?.startsWith("machine-top-")), false);
});
