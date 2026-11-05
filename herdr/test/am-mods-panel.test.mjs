// The mod manager's panel (mods/am-mods/main.js) drawn under the gpui and herdr stand-ins over a
// scratch HERDR_APP_HOME: the groups, the pack's row and detail line, the folded built-in row, and
// `u` on a pack mod running the pack's own `automagik-herdr update` (a fake command here).
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const stubs = { herdr: here("./footer-herdr.mjs"), "gpui-kit": here("./gpui-stub.mjs"), "gpui-base": here("./gpui-stub.mjs") };
registerHooks({ resolve: (specifier, context, next) => (stubs[specifier] ? { url: stubs[specifier], shortCircuit: true } : next(specifier, context)) });
const { state, ui } = await import(stubs.herdr);
const { default: ModManager } = await import("../mods/am-mods/main.js");
const { index, nodes, textOf } = await import(stubs["gpui-kit"]);
const { PACK_MODS, formatMarker } = await import("../mods/am-sidebar/release.js");
const core = await import("../mods/am-mods/core.js");

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const makeCx = () => {
  const cx = { pending: [], spawn(fn) { const p = Promise.resolve().then(() => fn(cx)); cx.pending.push(p); return p; },
    timer: { after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) }, notify() {}, stop_propagation() {},
    focus_handle: () => ({ focus() {} }) };
  cx.settle = async () => { while (cx.pending.length) await Promise.allSettled(cx.pending.splice(0)); };
  return cx;
};

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "am-mods-panel-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appHome = join(root, "app");
  for (const m of PACK_MODS) write(join(appHome, m === "am-tabs" ? "mods-disabled" : "mods", m, "mod.json"), "{}");
  write(join(appHome, "mods", "my-menu", "mod.json"), JSON.stringify({ cloned_from: { name: "menu", version: "0.1.10" } }));
  write(join(appHome, "mods", "scratch", "mod.json"), "{}");
  for (const m of ["spaces", "workspace-chrome"]) write(join(appHome, "mods", m, "mod.json"), "{}");
  write(join(appHome, "installed.json"), JSON.stringify({ spaces: {}, "workspace-chrome": {} }));
  write(join(appHome, core.PACK_MARKER), formatMarker({ version: "0.5.1", mods: [...PACK_MODS], installed: "2026-11-03T14:05:00.000Z" }));
  // The catalog lists a pack mod and one of the person's: a local file, never the network.
  const catalog = join(root, "index.json");
  write(catalog, JSON.stringify({ mods: [
    { name: "Automagik", fullName: "automagik-dev/automagik-herdr", modNames: ["am-mods", "am-tabs"], stars: 1 },
    { name: "Scratch", fullName: "someone/scratch", modNames: ["scratch"], headCommit: "abcdef1234", stars: 7 },
  ] }));
  write(join(appHome, "data", "am-mods", "catalog.json"), JSON.stringify({ url: catalog }));
  // A herdr-app that passes every check, and the pack's command, which records how it was called.
  const bin = join(root, "bin");
  write(join(bin, "herdr-app"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "herdr-app"), 0o755);
  const calls = join(root, "cli-calls");
  write(join(appHome, core.PACK_CLI), `#!/bin/sh\nprintf '%s %s\\n' "$HERDR_APP_HOME" "$*" >> '${calls}'\necho "Automagik Herdr 0.5.1 is installed; the latest release is 0.5.1. Up to date."\n`);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  t.after(() => { process.env.PATH = path; });
  state.appHome = appHome;
  state.shared.clear?.();
  ui.props = {};
  ui.layout = null;
  return { appHome, calls };
}

const key = async (view, cx, k, ch = k) => { view.onKey({ key: k, key_char: ch }, cx); await cx.settle(); };
const draw = (view, cx) => index(view.render(cx));
const select = (view, name) => { view.at = view.grouped().rows.findIndex((r) => r.mod?.name === name); };

test("the list: the pack as one group with its version, Yours, Herdr built-in folded; one language", async (t) => {
  scratch(t);
  const cx = makeCx();
  const view = new ModManager();
  view.init({}, cx);
  await cx.settle();
  const text = textOf(draw(view, cx));
  assert.match(text, new RegExp(`${PACK_MODS.length} Automagik Herdr · 2 yours · 2 built-in · 1 off`));
  for (const head of ["ON", "NAME", "KIND", "CHECK", "VERSION", "SOURCE", "INSTALLED", "CHANGED"]) assert.match(text, new RegExp(`\\b${head}\\b`));
  assert.doesNotMatch(text, /\bPATH\b/, "the path is in the detail line, not an untitled column");
  assert.doesNotMatch(text, /seus|do Herdr|desligad|catálogo|atualiz|upstream \?|←/);
  assert.match(textOf(nodes.get("group-pack")), new RegExp(`Automagik Herdr 0\\.5\\.1 · ${PACK_MODS.length}`));
  assert.match(textOf(nodes.get("group-yours")), /Yours · 2/);
  assert.match(textOf(nodes.get("group-herdr")), /▸ Herdr built-in · 2 mods/);
  assert.equal(nodes.get("mod-spaces"), undefined, "built-in mods fold into one row");
  for (const m of PACK_MODS) {
    const row = textOf(nodes.get(`mod-${m}`));
    assert.match(row, m === "am-tabs" ? /\boff\b/ : /Automagik Herdr/, m);
    assert.match(row, /0\.5\.1 automagik-herdr 2026-11-03/, m);
  }
  assert.match(textOf(nodes.get("mod-scratch")), /catalog .*upstream abcdef1 someone\/scratch ★7/);
  assert.match(textOf(nodes.get("mod-my-menu")), /clone .*from menu v0\.1\.10/);

  select(view, "am-sidebar");
  assert.match(textOf(draw(view, cx)), /Automagik Herdr 0\.5\.1 · installed 2026-11-03 · u updates the pack/);
  // b unfolds the built-in group, wherever the cursor is; again folds it.
  await key(view, cx, "b");
  draw(view, cx);
  assert.match(textOf(nodes.get("mod-spaces")), /built-in .*Herdr/);
  assert.equal(view.selectedMod()?.name, "am-sidebar", "the cursor stays on its mod");
  await key(view, cx, "b");
  draw(view, cx);
  assert.equal(nodes.get("mod-spaces"), undefined);
  // The cursor skips the pack's and Yours's headings; the built-in heading takes it, enter unfolds.
  view.at = 0;
  view.clampAt();
  assert.equal(view.at, 1, "from the pack's heading to its first mod");
  view.step(-1);
  assert.equal(view.at, 1, "nothing selectable above it");
  view.at = view.grouped().rows.findIndex((r) => r.mod?.name === "am-tabs");
  view.step(1);
  assert.equal(view.selectedMod()?.name, "my-menu", "past the Yours heading");
  view.at = view.grouped().rows.length - 1;
  await key(view, cx, "enter");
  assert.ok(view.grouped().rows.some((r) => r.mod?.name === "spaces"));
});

test("u on a pack mod asks, then runs automagik-herdr update in this app home; no clone", async (t) => {
  const s = scratch(t);
  const cx = makeCx();
  const view = new ModManager();
  view.init({}, cx);
  await cx.settle();
  select(view, "am-footer");
  await key(view, cx, "u");
  assert.match(view.confirm?.text ?? "", new RegExp(`update Automagik Herdr \\(all ${PACK_MODS.length} of its mods\\) with automagik-herdr update\\? \\(y/n\\)`));
  await key(view, cx, "y");
  await cx.settle();
  assert.equal(readFileSync(s.calls, "utf8"), `${s.appHome} update\n`);
  assert.match(view.message, /Up to date/);
  assert.ok(!state.calls.some((c) => c.kind === "exec" && c.command === "git"), "no per-mod clone");
  // d on a pack mod says how the pack checks itself; it never clones to compare.
  await key(view, cx, "d");
  assert.match(view.message, /Automagik Herdr checks its own files/);
});

// #305: Herdr drops a layout whose block names a mod missing from mods/ ("needs mods that aren't
// here") and shows plain Herdr. The switch reads the shown layout (layout(), shared("layout")): the
// stock one here, from the repo, never an app home's.
const STOCK_LAYOUT = JSON.parse(readFileSync(new URL("../../herdr-layout/layouts/automagik.json", import.meta.url), "utf8"));
async function shownLayout(t) {
  const s = scratch(t);
  ui.layout = STOCK_LAYOUT;
  state.shared.set("layout", "automagik");
  const cx = makeCx();
  const view = new ModManager();
  view.init({}, cx);
  await cx.settle();
  const flip = async (name) => { view.toggle(view.mods.find((m) => m.name === name), cx); await cx.settle(); };
  const on = (name) => existsSync(join(s.appHome, "mods", name, "mod.json"));
  const off = (name) => existsSync(join(s.appHome, core.OFF_DIR, name, "mod.json"));
  return { view, flip, on, off };
}

test("off on a mod the shown layout's blocks name is refused, naming the layout; the folder stays", async (t) => {
  const { view, flip, on, off } = await shownLayout(t);
  for (const name of ["am-sidebar", "am-footer", "am-status"]) {
    await flip(name);
    assert.ok(on(name) && !off(name), `${name} stays in mods/`);
    assert.match(view.message, new RegExp(`^${name} stays on: the automagik layout shows it`));
    assert.ok(view.mods.find((m) => m.name === name).enabled);
  }
});

test("off on a mod the shown layout doesn't name moves it as before", async (t) => {
  const { view, flip, on, off } = await shownLayout(t);
  for (const name of ["scratch", "am-quota"]) {
    await flip(name);
    assert.ok(!on(name) && off(name), `${name} moved to ${core.OFF_DIR}/`);
    assert.equal(view.message, `${name} off · its folder moved to ${core.OFF_DIR}/`);
  }
  await flip("scratch");
  assert.ok(on("scratch"), "and back on");
});

test("a mod the layout names that is already off turns on; the right-click menu's mod turns off with a note", async (t) => {
  const { view, flip, on, off } = await shownLayout(t);
  assert.ok(off("am-tabs"), "am-tabs starts off in this home");
  await flip("am-tabs");
  assert.ok(on("am-tabs") && !off("am-tabs"));
  assert.equal(view.message, "am-tabs on");
  // terminal_menu: Herdr warns and falls back to its own "menu", the layout stays.
  await flip("am-markdown");
  assert.ok(off("am-markdown"));
  assert.match(view.message, /^am-markdown off · its folder moved to mods-disabled\/ · it was the automagik layout's right-click menu: Herdr's own menu shows instead$/);
});

// #414: remove (x) asks the shown layout as off does, before its y/n question: a mod a block names
// stays where it is; the right-click menu's goes, with the note; the rest go as before.
const removeKey = async (view, cx, name) => { select(view, name); await key(view, cx, "x"); };

test("x on a mod the shown layout's blocks name is refused before the question; the folder stays", async (t) => {
  const { view, on } = await shownLayout(t);
  const cx = makeCx();
  for (const name of ["am-sidebar", "am-footer", "am-status"]) {
    await removeKey(view, cx, name);
    assert.equal(view.confirm, null, `${name}: no y/n question`);
    assert.match(view.message, new RegExp(`^${name} stays on: the automagik layout shows it`));
    assert.match(view.message, /Switch layouts first \(ctrl-shift-l\), then remove it$/);
    assert.ok(on(name), `${name} stays in mods/`);
  }
  // A layout switched while the question was open: remove() asks again.
  await removeKey(view, cx, "scratch");
  ui.layout = { id: "root", children: [{ id: "s", content: { mod: "scratch" } }] };
  state.shared.set("layout", "mine");
  await key(view, cx, "y");
  assert.match(view.message, /^scratch stays on: the mine layout shows it/);
  assert.ok(on("scratch"));
});

test("x on a mod the shown layout doesn't name removes it as before; the menu's mod goes with a note", async (t) => {
  const { view, on } = await shownLayout(t);
  const cx = makeCx();
  for (const name of ["scratch", "am-quota"]) {
    await removeKey(view, cx, name);
    assert.equal(view.confirm?.text, `remove the folder mods/${name}? (y/n)`);
    await key(view, cx, "y");
    assert.ok(!on(name), `${name} left mods/`);
    assert.equal(view.message, `removed: ${name}`);
  }
  // terminal_menu: Herdr warns and falls back to its own menu; the layout stays.
  await removeKey(view, cx, "am-markdown");
  await key(view, cx, "y");
  assert.ok(!on("am-markdown"));
  assert.equal(view.message, "removed: am-markdown · it was the automagik layout's right-click menu: Herdr's own menu shows instead");
  // A mod that is already off is not in the layout's way: am-tabs, a block of it, goes.
  await removeKey(view, cx, "am-tabs");
  assert.match(view.confirm?.text ?? "", /^remove /);
});

test("x with no layout to read (layout() gives nothing) removes as before", async (t) => {
  const { view, on } = await shownLayout(t);
  ui.layout = null;
  const cx = makeCx();
  await removeKey(view, cx, "am-footer");
  await key(view, cx, "y");
  assert.ok(!on("am-footer"));
  assert.equal(view.message, "removed: am-footer");
});
