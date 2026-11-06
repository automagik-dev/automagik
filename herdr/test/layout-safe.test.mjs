// layoutSafe.mjs change() on its own, in a temp app home: the decision before any op, and the ops
// journalled (a failure undoes every one done). The routes that use it are layout-safe-matrix*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { change } from "../mods/am-sidebar/layoutSafe.mjs";

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

test("an op inside a linked folder of the app home is found as writing through a link", (t) => {
  const h = home(t);
  write(join(h.root, "mine", "automagik.json"), "{}");
  symlinkSync(join(h.root, "mine"), join(h.app, "layouts"));
  const r = change(h.app, [{ op: "remove", path: join(h.app, "layouts", "automagik.json") }]);
  assert.deepEqual(r.throughLinks, [join(h.app, "layouts", "automagik.json")]);
  assert.equal(change(h.app, [{ op: "move", from: join(h.mods, "a"), to: join(h.kept, "a"), mkdir: true }]).throughLinks.length, 0);
});
