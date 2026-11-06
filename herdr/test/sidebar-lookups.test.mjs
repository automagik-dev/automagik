// The sidebar's render (main.js) under `node --test`, with gpui and herdr stood in for
// (gpui-stub.mjs, sidebar-herdr-stub.mjs): the searches that join agents, terminals, panes and
// tabs read each snapshot row a bounded number of times, so a render's cost grows with the
// rows, not with agents x terminals. Every row is a Proxy that counts its property reads.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./sidebar-herdr-stub.mjs"), "fs/promises": here("./fs-stub.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
const fromPack = (context) => context.parentURL?.includes("/mods/am-sidebar/");
registerHooks({
  resolve: (specifier, context, next) => (stubs[specifier] && fromPack(context) ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context)),
});
const { state } = await import(stubs.herdr);
const { all } = await import(stubs["gpui-kit"]);
const { default: Spaces } = await import("../mods/am-sidebar/main.js");

let reads = 0;
const counted = (row) => new Proxy(row, { get(t, k, r) { reads += 1; return Reflect.get(t, k, r); } });

// `n` spaces of two tabs each. Per tab: two agents (each with a live sub-agent, the first
// with a grandchild too) and two shells. agents() and panes() alternate the tabs of a space,
// so a lookup grouped per tab would reorder them. Dead terminals pad terminals() to about
// four times the live ones, as an app open for a while has.
function fixture(n) {
  const terminals = [], panes = [], agents = [], spaces = [], expected = [];
  let seq = 0;
  const term = (extra) => { const address = `t${++seq}`; terminals.push({ address, state: "live", labels: {}, ...extra }); return address; };
  for (let s = 0; s < n; s += 1) {
    const tabs = [`s${s}a`, `s${s}b`].map((id, i) => ({ id, name: `tab ${i + 1}` }));
    spaces.push({ id: `s${s}`, name: `space ${s}`, folder: `/work/s${s}`, tabs });
    const rows = [];
    for (let i = 0; i < 2; i += 1) {
      for (const tab of tabs) {
        const address = term({ program: { key: "claude", name: "Claude Code", agent: true }, status: "working" });
        const sub = term({ parent: address, name: `helper of ${address}`, status: "working" });
        const kids = [sub];
        if (i === 0) kids.push(term({ parent: sub, name: `helper of ${sub}`, status: "idle" }));
        const pane = `p${address}`;
        panes.push({ pane, terminal: address, tab: tab.id, cwd: `/work/s${s}/${tab.id}`, program: { key: "claude", name: "Claude Code", agent: true }, title: `agent ${address}` });
        agents.push({ address, pane, tab: tab.id, status: "working", program: { key: "claude", name: "Claude Code" }, title: `agent ${address}`, space: `s${s}`, space_name: `space ${s}`, seq });
        rows.push(`ag-${address}`, ...kids.map((k) => `sub-${k}`));
      }
      for (const tab of tabs) {
        const address = term({ program: { key: "zsh", name: "zsh", shell: true } });
        panes.push({ pane: `p${address}`, terminal: address, tab: tab.id, cwd: `/work/s${s}`, program: { key: "zsh", name: "zsh", shell: true }, title: "zsh" });
      }
    }
    expected.push(...rows);
  }
  const live = terminals.length;
  for (let d = 0; d < live * 3; d += 1) terminals.push({ address: `t${++seq}`, state: "exited", labels: {}, parent: `t${(d % live) + 1}` });
  return {
    terminals: terminals.map(counted), panes: panes.map(counted), agents: agents.map(counted),
    spaces: spaces.map((s) => ({ ...s, tabs: s.tabs.map(counted) })), expected,
  };
}

// A sidebar as init leaves it, without init's timers, discovery and file reads.
function sidebar(spaces) {
  const s = Object.create(Spaces.prototype);
  Object.assign(s, {
    git: {}, checked: {}, unsure: new Set(), pending: new Set(), busy: {}, ready: {}, at: {}, watching: new Set(),
    shown: new Set(spaces.map((w) => w.id)), born: {}, pressed: null, over: null, machines: [], folded: new Set(),
    screen: {}, extra: {}, bots: [], open: new Map(), hoverRow: null, trees: [], places: new Map(), botOf: new Map(),
    pets: new Set(), petsWanted: new Map(), petsFailed: new Set(), wakeAt: null, modelTexts: {}, modelDefaults: {},
    argvOf: new Map(), paneKeys: new Map(), opening: new Set(), known: [],
    hermes: { key: "hermes", name: "Hermes", icon: "icons/hermes.svg", tint: true },
  });
  return s;
}

// One render of a fixture of `n` spaces: the property reads it made and the agent rows drawn.
function render(n) {
  const f = fixture(n);
  Object.assign(state, { terminals: f.terminals, panes: f.panes, agentRows: f.agents, spaces: f.spaces, machineRows: [] });
  state.shared.clear();
  state.shared.set("am.space.colors", Object.fromEntries(f.spaces.map((w) => [w.id, "ansi6"])));
  const s = sidebar(f.spaces);
  reads = 0;
  const root = s.render({ notify() {} });
  const counts = reads;
  const drawn = all(root).map((node) => node.id).filter((id) => typeof id === "string" && /^(ag|sub)-/.test(id));
  return { reads: counts, drawn, expected: f.expected, terminals: f.terminals.length };
}

test("sidebar render: the agent and sub-agent rows come in agents() order, each with its helpers", () => {
  const { drawn, expected } = render(3);
  assert.deepEqual(drawn, expected);
});

test("sidebar render: snapshot reads grow with the rows, not with agents x terminals", (t) => {
  const small = render(12), large = render(24);
  assert.deepEqual(large.drawn, large.expected);
  const ratio = large.reads / small.reads;
  t.diagnostic(`reads ${small.reads} -> ${large.reads} (x${ratio.toFixed(2)}) for ${small.terminals} -> ${large.terminals} terminals`);
  // Twice the spaces, agents, panes and terminals: linear work reads about twice as much,
  // a search of every terminal per agent about four times as much.
  assert.ok(ratio < 2.5, `reads ${small.reads} -> ${large.reads} (x${ratio.toFixed(2)}) for ${small.terminals} -> ${large.terminals} terminals`);
});
