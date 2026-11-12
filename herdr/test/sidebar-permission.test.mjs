import { test } from "node:test";
import assert from "node:assert/strict";
import { load, setSnapshot, sidebar } from "./sidebar-tree.mjs";
import { parseBots } from "../mods/am-sidebar/model.js";
import { index, nodes, textOf } from "./gpui-stub.mjs";

const Spaces = await load();

test("the sidebar's blocked chips name a permission on agent, sub-agent, bot and helper rows", () => {
  const bot = "b-adaaaaaaaa";
  const program = { key: "claude", name: "Claude Code", agent: true };
  const terminal = (address, kind, extra = {}) => ({
    address, state: "live", status: "blocked", report: { state: "blocked", kind },
    labels: {}, program, ...extra,
  });
  const snap = {
    spaces: [{ id: "s1", name: "x", folder: "/work/x", machine: null, active: true,
      tabs: [{ id: "tab1", name: "x", named: true }] }],
    panes: [1, 2, 4].map((n) => ({ pane: `p${n}`, terminal: `t${n}`, tab: "tab1", cwd: "/work/x", program })),
    agents: [1, 2, 4].map((n) => ({ address: `t${n}`, pane: `p${n}`, tab: "tab1", status: "blocked",
      program, title: "x", space: "s1", space_name: "x", seq: n })),
    terminals: [terminal("t1", "permission"), terminal("t2", "question"),
      terminal("t3", "permission", { parent: "t1" }),
      terminal("t4", "permission", { labels: { bot } }),
      terminal("t5", "permission", { parent: "t4" })],
    machines: [],
    bots: [{ key: "/work/x", machine: null, spaces: ["s1"], ...parseBots(JSON.stringify({
      version: 1, categories: [], bots: [{ id: bot, kind: "main", name: "ada", role: "",
        instructions: "", agent: "claude", look: { character: "octopus", colour: "deepseek" } }],
    })) }],
    open: [[`b:${bot}`, true]],
  };
  setSnapshot(snap);
  const s = sidebar(Spaces, snap);
  index(s.render({ notify() {} }));
  for (const id of ["ag-t1", "sub-t3", `row-b:${bot}`, "row-h:t5"]) {
    assert.ok(nodes.has(id), id);
    assert.match(textOf(nodes.get(id)), /Needs you: permission/, id);
  }
  assert.ok(nodes.has("ag-t2"));
  assert.match(textOf(nodes.get("ag-t2")), /Needs you/);
  assert.doesNotMatch(textOf(nodes.get("ag-t2")), /permission/);

  snap.agents[0].status = "working";
  snap.terminals[0].status = "working";
  snap.terminals[0].report = { state: "working", kind: "permission" };
  setSnapshot(snap);
  index(s.render({ notify() {} }));
  assert.ok(nodes.has("ag-t1"));
  assert.doesNotMatch(textOf(nodes.get("ag-t1")), /Needs you/);
});
