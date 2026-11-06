// layoutSafe.mjs change() on its own, in a temp app home: the decision before any op, and the ops
// journalled (a failure undoes every one done). The routes that use it are layout-safe-matrix*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { change, removePath } from "../mods/am-sidebar/layoutSafe.mjs";

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const layout = (...mods) => JSON.stringify({ id: "root", children: mods.map((m, i) => ({ id: `b${i}`, content: { mod: m } })) });
function home(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "am-layout-safe-unit-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "app");
  for (const m of ["a", "b"]) write(join(app, "mods", m, "main.js"), `// ${m}\n`);
  return { root, app, mods: join(app, "mods"), kept: join(root, "kept") };
}

test("a failing op undoes every one done before it, and nothing is removed", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "x.json"), layout("z"));
  let n = 0;
  const rename = (from, to) => { if (++n === 2) throw new Error("disk full"); renameSync(from, to); };
  assert.throws(() => change(h.app, [
    { op: "remove", path: join(h.app, "layouts", "x.json") },
    { op: "move", from: join(h.mods, "a"), to: join(h.kept, "a"), mkdir: true },
    { op: "move", from: join(h.mods, "b"), to: join(h.kept, "b"), mkdir: true },
  ], { rename }), /disk full/);
  assert.ok(existsSync(join(h.mods, "a", "main.js")) && existsSync(join(h.mods, "b", "main.js")));
  assert.equal(readFileSync(join(h.app, "layouts", "x.json"), "utf8"), layout("z"));
  assert.deepEqual(readdirSync(join(h.app, "layouts")), ["x.json"], "no aside name left behind");
});

test("a remove: done once the batch stands; missing with force, nothing; missing without it, rmSync's error", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "x.json"), "{}");
  const r = change(h.app, [{ op: "remove", path: join(h.app, "layouts", "x.json") }, { op: "remove", path: join(h.app, "layouts", "gone.json"), force: true }]);
  assert.equal(r.done, true);
  assert.deepEqual(readdirSync(join(h.app, "layouts")), []);
  assert.throws(() => change(h.app, [{ op: "remove", path: join(h.app, "layouts", "gone.json") }]), { code: "ENOENT" });
});

test("a remove of a link, dangling or live, takes the link and leaves no aside name; its target stays (#550)", (t) => {
  const h = home(t);
  const elsewhere = join(h.root, "elsewhere");
  write(join(elsewhere, "live", "main.js"), "// the person's\n");
  symlinkSync(join(elsewhere, "gone"), join(h.mods, "dangling")); // a linked mod folder whose target is gone
  symlinkSync(join(elsewhere, "live"), join(h.mods, "live"));
  write(join(h.app, "layouts", "keep.json"), "{}");
  symlinkSync(join(elsewhere, "gone.json"), join(h.app, "layouts", "dangling.json"));
  const r = change(h.app, [
    { op: "remove", path: join(h.mods, "dangling") },
    { op: "remove", path: join(h.mods, "live") },
    { op: "remove", path: join(h.app, "layouts", "dangling.json") },
  ]);
  assert.equal(r.done, true);
  // Node 24.0 to 24.9's rmSync returned on a dangling link and left it under its .am-rm- name.
  assert.deepEqual(readdirSync(h.mods).sort(), ["a", "b"]);
  assert.deepEqual(readdirSync(join(h.app, "layouts")), ["keep.json"]);
  assert.equal(readFileSync(join(elsewhere, "live", "main.js"), "utf8"), "// the person's\n");
  assert.equal(existsSync(join(elsewhere, "gone")), false);
});

test("removePath: a link, dangling or live, is unlinked and never followed; anything else is rmSync's (#550)", (t) => {
  const h = home(t);
  const at = (n) => join(h.root, n);
  const there = (p) => lstatSync(p, { throwIfNoEntry: false }) !== undefined;
  symlinkSync(at("nowhere"), at("dangling"));
  removePath(at("dangling"), { force: true });
  assert.equal(there(at("dangling")), false);
  write(at("target/keep"), "x");
  symlinkSync(at("target"), at("live"));
  removePath(at("live"), { recursive: true, force: true });
  assert.equal(there(at("live")), false);
  assert.equal(readFileSync(at("target/keep"), "utf8"), "x", "the link's target is left");
  symlinkSync(at("nowhere"), at("again"));
  removePath(at("again")); // no options: a link still goes
  assert.equal(there(at("again")), false);
  write(at("file"), "x");
  removePath(at("file"));
  assert.equal(there(at("file")), false);
  write(at("folder/inner/f"), "x");
  assert.throws(() => removePath(at("folder")), { code: "ERR_FS_EISDIR" });
  removePath(at("folder"), { recursive: true, force: true });
  assert.equal(there(at("folder")), false);
  removePath(at("missing"), { force: true });
  assert.throws(() => removePath(at("missing")), { code: "ENOENT" });
});

test("needed: refuse asks the shown layout and refuses before any op, naming it; a menu's mod goes with a note", (t) => {
  const h = home(t);
  const ask = () => ({ name: "mine", tree: { ...JSON.parse(layout("a")), terminal_menu: "b" }, why: null });
  const move = (m) => ({ op: "move", from: join(h.mods, m), to: join(h.kept, m), mkdir: true });
  const r = change(h.app, [move("a"), move("b")], { ask, needed: "refuse", then: "uninstall it" });
  assert.match(r.refused, /^a stays on: the mine layout shows it, .*then uninstall it; from a terminal: herdr-app do layout\.switch/);
  assert.equal(r.done, false);
  assert.ok(existsSync(join(h.mods, "a")) && existsSync(join(h.mods, "b")) && !existsSync(h.kept));
  const notes = [];
  const ok = change(h.app, [move("b")], { ask, needed: "refuse", log: (l) => notes.push(l) });
  assert.equal(ok.refused, null);
  assert.deepEqual(notes, ["b was the mine layout's right-click menu: Herdr's own menu shows instead"]);
  assert.ok(!existsSync(join(h.mods, "b")) && existsSync(join(h.kept, "b")));
});

test("needed: refuse without ask (a rollback, #488): any file in layouts/ naming a mod that leaves refuses; exclude leaves one out", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "mine.json"), layout("a"));
  write(join(h.app, "layouts", "work.json"), layout("a", "b"));
  write(join(h.app, "layouts", "other.json"), layout("z"));
  const move = (m) => ({ op: "move", from: join(h.mods, m), to: join(h.kept, m), mkdir: true });
  const asked = [];
  const r = change(h.app, [move("a"), move("b")], { needed: "refuse", then: "roll back", prepare: () => asked.push("prepare") });
  assert.match(r.refused, /^a would leave mods\/, but the layouts mine, work still name it \(and a layout names b too\), .*then roll back$/);
  assert.equal(r.done, false);
  assert.deepEqual(asked, [], "prepare never runs on a refusal");
  assert.ok(existsSync(join(h.mods, "a")) && existsSync(join(h.mods, "b")) && !existsSync(h.kept));
  const one = change(h.app, [move("b")], { needed: "refuse", then: "roll back" });
  assert.match(one.refused, /^b would leave mods\/, but the work layout still names it, .*Take b out of that layout/);
  const ok = change(h.app, [move("b")], { needed: "refuse", exclude: (name, body) => name === "work.json" && body().includes('"b"') });
  assert.equal(ok.refused, null);
  assert.ok(!existsSync(join(h.mods, "b")) && existsSync(join(h.kept, "b")));
});

test("needed: refuse without ask, unknown: warn: a layout that does not read is said, and the batch goes on", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "mine.json"), `${layout("a").slice(0, -1)},\n`);
  write(join(h.app, "layouts", "fine.json"), layout("z"));
  const move = (m) => ({ op: "move", from: join(h.mods, m), to: join(h.kept, m), mkdir: true });
  const quiet = [];
  assert.equal(change(h.app, [move("b")], { needed: "refuse", log: (l) => quiet.push(l) }).refused, null);
  assert.deepEqual(quiet, [], "unset: nothing said");
  const lines = [];
  const r = change(h.app, [move("a")], { needed: "refuse", unknown: "warn", log: (l) => lines.push(l) });
  assert.equal(r.refused, null);
  assert.equal(r.done, true);
  assert.deepEqual(lines, ["going on without knowing the layout Herdr shows (Herdr is not asked here, and layouts/mine.json does not read): "
    + "if one names a and Herdr shows it, Herdr drops it (plain Herdr instead)"]);
  assert.deepEqual(r.notes, lines);
});

test("#489: ask with no tree, unknown: warn: a layout that does not parse but names the mod in its text is said, skip or not", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "mine.json"), `${layout("a").slice(0, -1)},\n`);
  write(join(h.app, "layouts", "broken.json"), "{");
  const move = (m) => ({ op: "move", from: join(h.mods, m), to: join(h.kept, m), mkdir: true });
  const ask = () => ({ name: null, tree: null, why: "herdr-app status gave no layout: is Herdr running?" });
  const quiet = [];
  change(h.app, [move("b")], { ask, needed: "refuse", unknown: "warn", log: (l) => quiet.push(l) });
  assert.deepEqual(quiet, [], "a mod no file's text names: nothing said (broken.json names none)");
  const lines = [];
  const r = change(h.app, [move("a")], { ask, needed: "refuse", unknown: "warn", skip: ["mine.json"], log: (l) => lines.push(l) });
  assert.equal(r.done, true);
  assert.deepEqual(lines, ["switching a off without knowing the layout Herdr shows (herdr-app status gave no layout: is Herdr running?), "
    + "and layouts/mine.json does not read: its text names it, and Herdr drops a layout whose mod is off (plain Herdr instead). "
    + "Showing it? Switch layouts (ctrl-shift-l), or `am install herdr.a` switches it back on"]);
  assert.deepEqual(r.notes, lines);
});

test("#489: needed: hold, unknown: warn: a mod that leaves while a layout that does not parse names it is said; a held one is not", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "mine.json"), `${layout("a", "b").slice(0, -1)},\n`);
  write(join(h.app, "layouts", "fine.json"), layout("b"));
  let n = 0;
  const move = (m) => ({ op: "move", from: join(h.mods, m), to: join(h.kept, `${++n}`, m), mkdir: true });
  const quiet = [];
  change(h.app, [move("a")], { needed: "hold", log: (l) => quiet.push(l), prepare: () => {} });
  assert.deepEqual(quiet, [], "unset: nothing said");
  write(join(h.root, "a2", "main.js"), "// a\n");
  renameSync(join(h.root, "a2"), join(h.mods, "a"));
  const lines = [];
  const r = change(h.app, [move("a"), move("b")], { needed: "hold", unknown: "warn", log: (l) => lines.push(l) });
  assert.deepEqual(r.held, [{ mod: "b", layouts: ["fine"] }]);
  assert.ok(existsSync(join(h.mods, "b", "main.js")) && !existsSync(join(h.mods, "a")));
  assert.deepEqual(lines, ["going on without knowing the layout Herdr shows (Herdr is not asked here, and layouts/mine.json does not read): "
    + "if one names a and Herdr shows it, Herdr drops it (plain Herdr instead)"]);
  const excluded = [];
  rmSync(join(h.app, "layouts", "fine.json"));
  change(h.app, [move("b")], { needed: "hold", unknown: "warn", exclude: (n) => n === "mine.json", log: (l) => excluded.push(l) });
  assert.deepEqual(excluded, [], "exclude leaves the file out");
});

test("a mod folder put back later in the batch is not taken (a replace); one only moved out is", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "mine.json"), layout("a", "b"));
  write(join(h.root, "staged", "a", "main.js"), "// a v2\n");
  const r = change(h.app, [
    { op: "move", from: join(h.mods, "a"), to: join(h.kept, "a"), mkdir: true },
    { op: "move", from: join(h.root, "staged", "a"), to: join(h.mods, "a") },
    { op: "move", from: join(h.mods, "b"), to: join(h.kept, "b"), mkdir: true },
  ], { needed: "hold" });
  assert.deepEqual(r.held, [{ mod: "b", layouts: ["mine"] }]);
  assert.equal(readFileSync(join(h.mods, "a", "main.js"), "utf8"), "// a v2\n");
  assert.ok(existsSync(join(h.mods, "b", "main.js")), "held: b stays");
});

test("shownFile: refuse refuses a remove of the shown layout's file by its name; another file goes", (t) => {
  const h = home(t);
  write(join(h.app, "layouts", "automagik.json"), "{}");
  write(join(h.app, "layouts", "other.json"), "{}");
  const ask = () => ({ name: "Automagik", tree: null, why: "unreadable" });
  const r = change(h.app, [{ op: "remove", path: join(h.app, "layouts", "automagik.json") }], { ask, shownFile: "refuse", then: "uninstall it" });
  assert.match(r.refused, /^the Automagik layout is this package's \(layouts\/automagik\.json\) and Herdr shows it/);
  assert.ok(existsSync(join(h.app, "layouts", "automagik.json")));
  assert.equal(change(h.app, [{ op: "remove", path: join(h.app, "layouts", "other.json") }], { ask, shownFile: "refuse" }).refused, null);
});

test("#487: shownFile with no answer from Herdr: the layout file removed is said with the mods it names; a kept one too", (t) => {
  const why = "herdr-app status gave no layout: is Herdr running?";
  const after = "If Herdr shows it, Herdr drops it (plain Herdr instead): switch layouts (ctrl-shift-l), or `am install herdr.pack` puts the pack back";
  const batch = (h) => [{ op: "remove", path: join(h.app, "layouts", "automagik.json") },
    ...["a", "b"].map((m) => ({ op: "move", from: join(h.mods, m), to: join(h.kept, m), mkdir: true }))];
  const opts = (ask, lines, more = {}) => ({ ask, needed: "refuse", unknown: "warn", shownFile: "refuse", links: "hold-layouts",
    then: "uninstall the pack", pack: true, skip: ["automagik.json"], log: (l) => lines.push(l), ...more });
  const noAnswer = () => ({ name: null, tree: null, why });

  // Removed: the file, the reason and the mod its blocks name (b, not named, is left out).
  const h = home(t);
  write(join(h.app, "layouts", "automagik.json"), layout("a", "pane"));
  const lines = [];
  const r = change(h.app, batch(h), opts(noAnswer, lines));
  assert.equal(r.done, true);
  assert.deepEqual(lines, [`removing layouts/automagik.json without knowing the layout Herdr shows (${why}), so it may be the one shown: `
    + `its blocks name a, which leaves mods/ too. ${after}`]);
  assert.deepEqual(r.notes, lines);
  assert.ok(!existsSync(join(h.app, "layouts", "automagik.json")) && !existsSync(join(h.mods, "a")));

  // Kept: a linked layouts/ (the person's folder) holds it; its mods still leave.
  const k = home(t);
  write(join(k.root, "mine", "automagik.json"), layout("a", "b"));
  symlinkSync(join(k.root, "mine"), join(k.app, "layouts"));
  const kept = [];
  const rk = change(k.app, batch(k), opts(noAnswer, kept));
  assert.deepEqual(rk.left, [join(k.app, "layouts", "automagik.json")]);
  assert.deepEqual(kept, [`keeping layouts/automagik.json without knowing the layout Herdr shows (${why}): layouts/ is a link, your own folder, `
    + `so it stays, but its blocks name a, b, which leave mods/. ${after}`]);

  // Not said: Herdr gave a name (a path: not this file), or no unknown: "warn" (herdr.layout's own line).
  for (const [ask, more] of [[() => ({ name: "../elsewhere", tree: null, why: "a name with a path" }), {}], [noAnswer, { unknown: null }]]) {
    const q = home(t);
    write(join(q.app, "layouts", "automagik.json"), layout("a"));
    const quiet = [];
    change(q.app, batch(q), opts(ask, quiet, more));
    assert.ok(!quiet.some((l) => /automagik\.json/.test(l)), quiet.join("\n"));
  }
});

test("an op inside a linked folder of the app home is found as writing through a link", (t) => {
  const h = home(t);
  write(join(h.root, "mine", "automagik.json"), "{}");
  symlinkSync(join(h.root, "mine"), join(h.app, "layouts"));
  const r = change(h.app, [{ op: "remove", path: join(h.app, "layouts", "automagik.json") }]);
  assert.deepEqual(r.throughLinks, [join(h.app, "layouts", "automagik.json")]);
  assert.equal(change(h.app, [{ op: "move", from: join(h.mods, "a"), to: join(h.kept, "a"), mkdir: true }]).throughLinks.length, 0);
});

/** The refusal's exact words (#494), written out so a changed line fails here. */
const linkedLine = (mods, to) => `mods/ (${mods}) is a link to ${to}, your own folder, not one this install made: nothing is moved `
  + "through it, and the folders in it stay as they are. Put that folder in the link's place (a plain mods/), then run this again";

test("#494: a linked mods/ refuses an op in it before anything, in its own words; one beside it goes", (t) => {
  const h = home(t);
  const ext = join(h.root, "their-mods");
  renameSync(h.mods, ext);
  symlinkSync(ext, h.mods);
  let asked = false;
  const r = change(h.app, [{ op: "move", from: join(h.mods, "a"), to: join(h.kept, "a"), mkdir: true }], {
    ask: () => { asked = true; return { name: null, tree: null, why: "x" }; }, needed: "refuse", prepare: () => { throw new Error("prepare ran"); },
  });
  assert.equal(r.refused, linkedLine(h.mods, ext));
  assert.equal(r.done, false);
  assert.equal(asked, false, "Herdr is not asked: nothing could be done anyway");
  assert.deepEqual(readdirSync(ext).sort(), ["a", "b"]);
  assert.equal(existsSync(h.kept), false);
  // Into a linked mods/ too (a folder put back), and a remove in it.
  assert.equal(change(h.app, [{ op: "move", from: join(h.root, "x"), to: join(h.mods, "x") }]).refused, linkedLine(h.mods, ext));
  assert.equal(change(h.app, [{ op: "remove", path: join(h.mods, "b") }]).refused, linkedLine(h.mods, ext));
  // An op that never reaches mods/ (mods-disabled/ beside it) goes.
  write(join(h.app, "mods-disabled", "c", "main.js"), "// c\n");
  const off = change(h.app, [{ op: "move", from: join(h.app, "mods-disabled", "c"), to: join(h.kept, "c"), mkdir: true }]);
  assert.equal(off.refused, null);
  assert.ok(existsSync(join(h.kept, "c", "main.js")));
});
