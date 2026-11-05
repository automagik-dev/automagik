// The whole sidebar (main.js) drawn under `node --test`, with gpui and herdr stood in for
// (gpui-stub.mjs, sidebar-herdr-stub.mjs), as one serialized tree per case: every element's
// kind, id, props and builder calls, the agent order handed to Herdr and the shared values
// written. Shared by sidebar-tree.test.mjs (the trees against their golden) and
// sidebar-reads.test.mjs (snapshot reads per render). The golden keeps each case's sha256 of
// that whole serialization, with its row ids and agent order to read a difference by. Run as a
// script, it records the golden from any main.js (its folder must be a mods/am-sidebar/):
//   node test/sidebar-tree.mjs <path to mods/am-sidebar/main.js> [golden.json] [--full]
// (--full writes the whole trees instead, to diff two main.js files by).
// The cases cover what the render joins: a machine renamed in the app (one alias, one
// ambiguous), Hermes extras, sibling sub-agents, a bot terminal that is someone's child, a
// duplicated address, worktrees nested under their checkout, a remote machine, tabs named by
// number, and the focused row.
import { registerHooks } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./sidebar-herdr-stub.mjs"), "fs/promises": here("./fs-stub.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
const fromPack = (context) => context.parentURL?.includes("/mods/am-sidebar/");
registerHooks({
  resolve: (specifier, context, next) => (stubs[specifier] && fromPack(context) ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context)),
});
export const { state } = await import(stubs.herdr);
const { parseBots } = await import("../mods/am-sidebar/model.js");

export const GOLDEN = new URL("./fixtures/sidebar/render-tree.golden.json", import.meta.url);
const NOW = 1_800_000_000_000;

/** The sidebar class of a main.js (a path, or the pack's own). */
export async function load(path = new URL("../mods/am-sidebar/main.js", import.meta.url)) {
  return (await import(typeof path === "string" ? pathToFileURL(path).href : path.href)).default;
}

const ser = (x) => {
  if (x === null || x === undefined || (typeof x !== "object" && typeof x !== "function")) return x;
  if (typeof x === "function") return "[fn]";
  const n = x.__node;
  if (n) return { kind: n.kind, arg: ser(n.arg), id: n.id, props: n.props, click: Boolean(n.click), calls: n.calls.map((c) => c.map(ser)), kids: n.kids.map(ser) };
  if (Array.isArray(x)) return x.map(ser);
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ser(v)]));
};

/** A sidebar as init leaves it, without init's timers, discovery and file reads. */
export function sidebar(Spaces, snap) {
  const s = Object.create(Spaces.prototype);
  Object.assign(s, {
    git: structuredClone(snap.git ?? {}), checked: {}, unsure: new Set(), pending: new Set(), busy: {}, ready: {}, at: {}, watching: new Set(),
    shown: new Set(snap.spaces.map((w) => w.id)), born: {}, pressed: null, over: null, machines: snap.hcMachines ?? [], folded: new Set(),
    screen: snap.screen ?? {}, extra: snap.extra ?? {}, bots: snap.bots ?? [], open: new Map(snap.open ?? []), hoverRow: null, trees: [],
    places: new Map(), botOf: new Map(), pets: new Set(), petsWanted: new Map(), petsFailed: new Set(), wakeAt: null, modelTexts: {},
    modelDefaults: {}, argvOf: new Map(), paneKeys: new Map(), opening: new Set(), known: snap.known ?? [],
    hermes: { key: "hermes", name: "Hermes", icon: "icons/hermes.svg", tint: true },
  });
  return s;
}

/** Sets the stub's snapshot (a fresh copy, so no render sees another's rows). */
export function setSnapshot(snap, collapsed = false) {
  Object.assign(state, { terminals: structuredClone(snap.terminals), panes: structuredClone(snap.panes), agentRows: structuredClone(snap.agents),
    spaces: structuredClone(snap.spaces), machineRows: structuredClone(snap.machines ?? []), focused: structuredClone(snap.focused ?? null),
    agentOrder: null, setSharedCalls: 0 });
  state.shared.clear();
  if (collapsed) state.shared.set("am.sidebar.collapsed", true);
}

/** Two renders of one sidebar (the second with the first one's cached state), serialized. */
export function draw(Spaces, snap, collapsed) {
  setSnapshot(snap, collapsed);
  const s = sidebar(Spaces, snap);
  const now = Date.now;
  Date.now = () => NOW;
  try {
    const tree = [ser(s.render({ notify() {} })), ser(s.render({ notify() {} }))];
    return { tree, order: state.agentOrder, shared: [...state.shared], sets: state.setSharedCalls, shown: [...s.shown] };
  } finally { Date.now = now; }
}

// The recorded owner state (fixtures/sidebar/owner-2026-11-02.json), as Herdr's snapshot calls
// would answer it.
function recorded(focusedAt) {
  const r = JSON.parse(readFileSync(new URL("./fixtures/sidebar/owner-2026-11-02.json", import.meta.url), "utf8"));
  const term = new Map(r.terminals.map((t) => [t.address, t]));
  const panes = [], agents = [];
  for (const s of r.spaces) for (const tab of s.tabs) for (const p of tab.panes) {
    const k = term.get(p.terminal);
    panes.push({ ...p, tab: tab.id, cwd: k?.cwd, program: k?.program, title: k?.agent ?? "zsh", focused: false });
    if (k?.state === "live" && k.program?.agent) agents.push({ address: k.address, pane: p.pane, tab: tab.id, status: k.status, program: k.program, title: `✳ ${k.agent}`, space: s.id, space_name: s.name, seq: 0 });
  }
  const bots = r.projects.map((p) => ({ ...p, ...parseBots(JSON.stringify(p.file)) }));
  const f = focusedAt?.(r.terminals.filter((t) => t.state === "live"));
  return { terminals: r.terminals, panes, agents, spaces: r.spaces, bots, focused: f ? { terminal: f.address, agent: f.address } : null };
}

// `n` spaces of three tabs, the last one on machine hx. Per tab, two agents: each with live
// sibling sub-agents (the first with a grandchild) and an exited one. Per space: shells, a
// Hermes pane, a bot pane whose children are a member bot (with its own helper) and a helper.
// `focus` picks the focused terminal from the addresses made.
function synthetic(n, focus = () => null) {
  const terminals = [], panes = [], agents = [], spaces = [], made = { agents: [], subs: [], helpers: [], members: [] };
  let seq = 0;
  const term = (x) => { const address = x.address ?? `t${++seq}`; terminals.push({ address, state: "live", labels: {}, ...x }); return address; };
  const claude = { key: "claude", name: "Claude Code", agent: true };
  for (let s = 0; s < n; s += 1) {
    const tabs = [`s${s}a`, `s${s}b`, `s${s}c`].map((id, i) => ({ id, name: i === 2 ? "3" : i === 1 ? "Claude Code" : `tab ${i}` }));
    spaces.push({ id: `s${s}`, name: `space ${s}`, folder: `/work/s${s}`, machine: s === n - 1 && n > 1 ? "hx" : null, active: s === 0, status: s ? "idle" : "working", tabs });
    for (let i = 0; i < 2; i += 1) for (const tab of [...tabs].reverse()) {
      const address = term({ program: claude, status: i ? "idle" : "working" });
      made.agents.push(address);
      made.subs.push(term({ parent: address, name: `h${address}`, status: "blocked" }));
      if (i === 0) made.subs.push(term({ parent: `t${seq}`, status: "error", program: claude }));
      made.subs.push(term({ parent: address, name: `second of ${address}`, status: "idle", program: claude }));
      term({ parent: address, state: "exited" });
      const pane = `p${address}`;
      panes.push({ pane, terminal: address, tab: tab.id, cwd: s % 2 ? `/work/s${s}/${tab.id}` : null, program: claude, title: i ? "Claude Code" : `✳ task ${address}`, focused: i === 1 && s === 0 });
      agents.push({ address, pane, tab: tab.id, status: i ? "idle" : "working", program: { key: "claude", name: "Claude Code" }, title: i ? "Claude Code" : `✳ task ${address}`, space: `s${s}`, space_name: `space ${s % 3}`, seq });
    }
    for (const tab of tabs) { const a = term({ program: { key: "zsh", shell: true } }); panes.push({ pane: `p${a}`, terminal: a, tab: tab.id, cwd: `/work/s${s}/${tab.id}/sh`, program: { key: "zsh", shell: true }, title: "zsh" }); }
    const h = term({ argv: ["/usr/bin/hermes", "chat"], program: { key: "python" } });
    panes.push({ pane: `p${h}`, terminal: h, tab: tabs[1].id, cwd: null, program: { key: "python" }, title: "⠋ Hermes job" });
    const b = term({ program: claude, status: "working", labels: { bot: `b-bot${s}aaaa` } });
    const member = term({ parent: b, labels: { bot: `b-bot${s}bbbb` }, status: "working", program: claude });
    made.members.push(member);
    made.helpers.push(term({ parent: member, status: "working", name: `helper of ${member}` }));
    made.helpers.push(term({ parent: b, status: "idle", name: `helper of ${b}` }));
    panes.push({ pane: `p${b}`, terminal: b, tab: tabs[0].id, cwd: `/work/s${s}`, program: claude, title: "bot" });
    agents.push({ address: b, pane: `p${b}`, tab: tabs[0].id, status: "working", program: { key: "claude", name: "Claude Code" }, title: "bot", space: `s${s}`, space_name: `space ${s % 3}`, seq });
  }
  // A machine renamed in the app: host-b/t2's pane, core terminal server/t2 (one match), and
  // host-b/t3 with two candidates (no alias). A duplicate address: the first one wins.
  const s0 = spaces[0];
  term({ address: "server/t2", status: "working", report: { app: "claude-code" }, labels: { "herdr.tab": s0.tabs[2].id } });
  term({ address: "server/t3", status: "working", report: { app: "claude" }, labels: { "herdr.tab": s0.tabs[2].id } });
  term({ address: "other/t3", status: "working", report: { app: "claude" }, labels: { "herdr.tab": s0.tabs[2].id } });
  term({ address: "server/t4", status: "idle", report: { app: "claude" }, labels: { "herdr.tab": s0.tabs[1].id } });
  term({ address: "hx/t4", status: "working", report: { app: "claude" }, labels: { "herdr.tab": s0.tabs[1].id } });
  term({ address: "t1", state: "exited", status: "done" });
  panes.push({ pane: "pr2", terminal: "host-b/t2", tab: s0.tabs[2].id, cwd: "/r", title: "remote 2" });
  panes.push({ pane: "pr4", terminal: "host-b/t4", tab: s0.tabs[1].id, cwd: null, title: "remote 4" });
  panes.push({ pane: "pr3", terminal: "host-b/t3", tab: s0.tabs[2].id, cwd: "/r", title: "remote 3" });
  const bots = [{ key: "/work/s0", machine: null, spaces: [s0.id], ...parseBots(JSON.stringify({ version: 1, categories: [], bots: [
    { id: "b-bot0aaaa", kind: "main", name: "Main", role: "", instructions: "", agent: "claude", look: { character: "octopus", colour: "deepseek" } },
    { id: "b-bot0bbbb", kind: "member", name: "Helper", role: "r", instructions: "", agent: "claude", look: { character: "gem", colour: "rose" } }] })) }];
  const git = {};
  spaces.forEach((w, s) => {
    const cwd = s % 2 ? `/work/s${s}/${w.tabs[2].id}` : `/work/s${s}/${w.tabs[0].id}/sh`;
    git[JSON.stringify([w.machine ?? null, cwd])] = { name: `repo${s >> 1}`, branch: s % 2 ? "feat" : "main", ahead: s, behind: 0, repo: JSON.stringify([null, `/repo${s >> 1}`]), linked: s % 2 === 1 };
  });
  const f = focus(made);
  return { terminals, panes, agents, spaces, bots, git, machines: [{ name: "hx", layout: "ready" }, { name: "server-renamed", layout: "ready" }],
    hcMachines: [{ name: "hx", state: "connected" }, { name: "away", state: "asleep" }, { name: "boot", state: "connected" }],
    known: [{ key: "claude", name: "Claude Code", icon: "icons/claude.svg" }], extra: { [`t${seq}`]: { name: "x" } }, screen: {},
    open: [["b:b-bot0bbbb", true]], focused: f ? { terminal: f, agent: f } : null };
}

/** Every case: [name, snapshot]. Each is drawn expanded and collapsed. */
export function cases() {
  return [
    ["recorded owner fixture", recorded()],
    ["recorded owner fixture, a bot's helper focused", recorded((live) => live.find((t) => t.address === "t1qw"))],
    ["synthetic n=1, a sub-agent focused", synthetic(1, (m) => m.subs[1])],
    ["synthetic n=4, a bot's helper focused", synthetic(4, (m) => m.helpers[0])],
    ["synthetic n=4, a member bot focused", synthetic(4, (m) => m.members[0])],
    ["synthetic n=6, an agent focused", synthetic(6, (m) => m.agents[2])],
  ];
}

/** Every case drawn by `Spaces`, by case name (expanded, then collapsed). */
export function trees(Spaces) {
  const out = {};
  for (const [name, snap] of cases()) out[name] = [draw(Spaces, snap, false), draw(Spaces, snap, true)];
  return out;
}

const ids = (x, out = []) => {
  if (x && typeof x === "object") { if (x.kind && typeof x.id === "string") out.push(x.id); (x.kids ?? []).forEach((k) => ids(k, out)); }
  return out;
};

/** The golden's form of trees(): per case, the sha256 of both draws, the expanded draw's ids and order. */
export function digest(all) {
  return Object.fromEntries(Object.entries(all).map(([name, draws]) => [name, {
    sha256: createHash("sha256").update(JSON.stringify(draws)).digest("hex"), ids: ids(draws[0].tree[0]), order: draws[0].order,
  }]));
}

// As a script: record the golden (or, with --full, the whole trees) from the main.js named.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2), full = args.includes("--full");
  const [main, file = GOLDEN] = args.filter((a) => a !== "--full");
  const all = trees(await load(main));
  writeFileSync(file, `${JSON.stringify(full ? all : digest(all), null, full ? 0 : 1)}\n`);
}
