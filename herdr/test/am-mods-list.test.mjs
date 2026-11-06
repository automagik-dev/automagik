// The mod manager's list (mods/am-mods/core.js): which kind each folder is, what its VERSION,
// SOURCE and INSTALLED columns say, and the groups the panel draws — run against a scratch
// HERDR_APP_HOME shaped like an installed pack beside a person's own mods and Herdr's built-in ones.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as core from "../mods/am-mods/core.js";
import * as release from "../mods/am-sidebar/release.js";
import { PACK_MODS, formatMarker, parseMarker } from "../mods/am-sidebar/release.js";

const io = {
  exec: async (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
  },
  readText: async (path) => readFileSync(path, "utf8"),
  writeText: async (path, text) => writeFileSync(path, text),
};
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const INSTALLED = "2026-11-03T14:05:00.000Z";

/** A home with the pack (am-tabs switched off), a person's clone and folder, two built-in mods. */
function home(t, { marker = formatMarker({ version: "0.5.1", mods: [...PACK_MODS], layout: "added", installed: INSTALLED }) } = {}) {
  const appHome = realpathSync(mkdtempSync(join(tmpdir(), "am-mods-list-")));
  t.after(() => rmSync(appHome, { recursive: true, force: true }));
  for (const m of PACK_MODS) {
    const dir = join(appHome, m === "am-tabs" ? "mods-disabled" : "mods", m);
    write(join(dir, "mod.json"), JSON.stringify({ place: "none", title: m }));
    write(join(dir, "main.js"), "");
  }
  write(join(appHome, "mods", "am-sidebar", "VERSION"), "0.5.1\n");
  write(join(appHome, "mods", "my-menu", "mod.json"), JSON.stringify({ place: "none", cloned_from: { name: "menu", version: "0.1.10" } }));
  write(join(appHome, "mods", "scratch", "mod.json"), "{}");
  for (const m of ["spaces", "workspace-chrome"]) write(join(appHome, "mods", m, "mod.json"), "{}");
  write(join(appHome, "installed.json"), JSON.stringify({ spaces: {}, "workspace-chrome": {} }));
  if (marker != null) write(join(appHome, core.PACK_MARKER), marker);
  return appHome;
}
const byName = (mods) => Object.fromEntries(mods.map((m) => [m.name, m]));

test("parsePackMarker reads version, mods and installed= as release.js parseMarker does", () => {
  const texts = [
    formatMarker({ version: "0.5.1", mods: [...PACK_MODS], layout: "added", installed: INSTALLED, usagemeter: "0.2.0" }),
    "version=0.5.1\nmods=am-mods,am-sidebar\nlayout=added\nbefore=none\nusagemeter=0.2.0\n",
    "version=0.3.0\nmods=\nbefore=none\n",
    "version=0.2.2\nbefore=none\n",
    "version=0.5.1\nmods=am-mods\ninstalled=yesterday\n",
  ];
  for (const text of texts) {
    const a = parseMarker(text);
    assert.deepEqual(core.parsePackMarker(text), { version: a.version, mods: a.mods, installed: a.installed }, text);
  }
  assert.equal(parseMarker(texts[0]).installed, INSTALLED);
  assert.equal(core.parsePackMarker(null), null);
});

test("formatMarker keeps installed= before usagemeter=, where install.sh's rewrite leaves it", () => {
  const text = formatMarker({ version: "1.0.0", mods: ["am-mods"], installed: INSTALLED, usagemeter: "0.2.0" });
  assert.equal(text, `version=1.0.0\nmods=am-mods\nbefore=none\ninstalled=${INSTALLED}\nusagemeter=0.2.0\n`);
  assert.equal(parseMarker(formatMarker(parseMarker(text))).installed, INSTALLED);
  assert.doesNotMatch(formatMarker({ version: "1.0.0", mods: [] }), /installed=/);
});

test("the pack's folders are one kind: Automagik Herdr, the pack's version, its install date, automagik-herdr", async (t) => {
  const appHome = home(t);
  const mods = byName(await core.listMods(io, { appHome, records: [] }));
  for (const m of PACK_MODS) {
    assert.equal(mods[m].kind, "pack", m);
    // The catalog may list a pack mod (the pack's own entry): it never turns it into "catalog".
    const d = core.describeMod(mods[m], { fullName: "automagik-dev/automagik-herdr", headCommit: null, stars: 3 });
    assert.deepEqual([d.kind, d.version, d.source, d.installed], ["pack", "0.5.1", "automagik-herdr", "2026-11-03"], m);
    assert.equal(d.label, m === "am-tabs" ? "off" : "Automagik Herdr", m);
  }
  assert.equal(mods["am-tabs"].enabled, false, "switched off, still the pack's");
  assert.equal(mods["my-menu"].kind, "clone", "a person's own mod.clone keeps its lineage");
  assert.deepEqual(
    [core.describeMod(mods["my-menu"]).version, core.describeMod(mods["my-menu"]).label],
    ["from menu v0.1.10", "clone"],
  );
  assert.equal(mods.scratch.kind, "local");
  assert.deepEqual(core.describeMod(mods.scratch, { fullName: "someone/scratch", path: "mods/scratch", headCommit: "abcdef1234", stars: 7 }),
    { kind: "catalog", label: "catalog", version: "upstream abcdef1", source: "someone/scratch/mods/scratch ★7", installed: "—",
      origin: { fullName: "someone/scratch", path: "mods/scratch", headCommit: "abcdef1234", stars: 7 } });
  assert.deepEqual([mods.spaces.kind, core.describeMod(mods.spaces).label, core.describeMod(mods.spaces).source], ["herdr", "built-in", "Herdr"]);
});

test("the pack's own mod.json files carry no cloned_from (the lineage is in RECIPE.md / NOTICE)", () => {
  for (const m of PACK_MODS) {
    const meta = JSON.parse(readFileSync(new URL(`../mods/${m}/mod.json`, import.meta.url), "utf8"));
    assert.equal(meta.cloned_from, undefined, m);
  }
});

test("only folders the marker lists are the pack's; without a marker a pack-named folder is the person's", async (t) => {
  const partial = home(t, { marker: formatMarker({ version: "0.5.1", mods: ["am-sidebar", "am-mods"], installed: INSTALLED }) });
  const mods = byName(await core.listMods(io, { appHome: partial, records: [] }));
  assert.deepEqual(PACK_MODS.filter((m) => mods[m].kind === "pack"), ["am-mods", "am-sidebar"]);
  assert.equal(mods["am-footer"].kind, "local", "left alone by the installer: not the pack's");
  const none = byName(await core.listMods(io, { appHome: home(t, { marker: null }), records: [] }));
  assert.ok(PACK_MODS.every((m) => none[m].kind !== "pack"));
});

test("a marker from before installed= dates the install by the marker file; no version= reads VERSION",
  { skip: process.platform !== "darwin" && "stat -f %m is the macOS form" }, async (t) => {
    const appHome = home(t, { marker: "mods=am-mods,am-sidebar\nlayout=added\nbefore=none\n" });
    const at = new Date("2026-10-30T09:00:00Z");
    utimesSync(join(appHome, core.PACK_MARKER), at, at);
    const mods = byName(await core.listMods(io, { appHome, records: [] }));
    assert.deepEqual(mods["am-mods"].pack, { version: "0.5.1", installed: at.getTime() });
    assert.equal(core.describeMod(mods["am-mods"]).installed, "2026-10-30");
  });

test("groupMods: the pack, yours, then built-in folded to one row; the counts are the groups'", async (t) => {
  const appHome = home(t);
  const mods = await core.listMods(io, { appHome, records: [] });
  const folded = core.groupMods(mods);
  assert.deepEqual(folded.groups.map((g) => [g.key, g.title, g.mods.length, g.folded]),
    [["pack", "Automagik Herdr 0.5.1", PACK_MODS.length, false], ["yours", "Yours", 2, false], ["herdr", "Herdr built-in", 2, true]]);
  assert.deepEqual(folded.counts, [`${PACK_MODS.length} Automagik Herdr`, "2 yours", "2 built-in", "1 off"]);
  // Heading, every pack mod, heading, 2 of yours, one built-in row (the heading, selectable).
  assert.equal(folded.rows.length, 1 + PACK_MODS.length + 1 + 2 + 1);
  assert.deepEqual(folded.rows.filter((r) => r.group).map((r) => [r.group.key, r.selectable]), [["pack", false], ["yours", false], ["herdr", true]]);
  assert.ok(folded.rows.every((r) => !r.mod || r.mod.kind !== "herdr"));
  assert.equal(folded.rows.at(-1).group.key, "herdr");
  const open = core.groupMods(mods, { builtInOpen: true });
  assert.deepEqual(open.rows.slice(-3).map((r) => r.group?.key ?? r.mod.name), ["herdr", "spaces", "workspace-chrome"]);
  assert.deepEqual(open.counts, folded.counts);
  // An empty group is not drawn; a home without the pack starts with Yours.
  const bare = core.groupMods(mods.filter((m) => m.kind !== "pack"));
  assert.deepEqual(bare.groups.map((g) => g.key), ["yours", "herdr"]);
  assert.deepEqual(bare.counts, ["2 yours", "2 built-in"], "no count for a group that is not drawn");
});

// #305: Herdr drops a layout whose block names a mod missing from mods/, so the switch reads what
// the stock layout names. The tree is the repo's own herdr-layout file, never an app home's.
const STOCK_LAYOUT = JSON.parse(readFileSync(new URL("../../herdr-layout/layouts/automagik.json", import.meta.url), "utf8"));

test("layoutNeeds: the stock layout's blocks (header and floating ones too) and its right-click menu", () => {
  const { blocks, menu } = core.layoutNeeds(STOCK_LAYOUT);
  assert.deepEqual([...blocks].sort(), ["am-footer", "am-sidebar", "am-status", "am-tabs", "changes", "files", "pane", "workspace-chrome"]);
  assert.equal(menu, "am-markdown");
  const floating = { id: "root", children: [{ id: "a", floating: [{ id: "f", content: { mod: "float-mod" } }] }] };
  assert.deepEqual([...core.layoutNeeds(floating).blocks], ["float-mod"]);
  assert.deepEqual(core.layoutNeeds(null), { blocks: new Set(), menu: null });
  assert.deepEqual(core.layoutNeeds({}), { blocks: new Set(), menu: null });
});

test("layoutGuard: a block's mod is refused with the layout's name; the menu's only noted; others pass", () => {
  for (const mod of ["am-sidebar", "am-footer", "am-tabs", "am-status"]) {
    const g = core.layoutGuard({ name: "automagik", tree: STOCK_LAYOUT, mod });
    assert.match(g?.refuse ?? "", new RegExp(`^${mod} stays on: the automagik layout shows it`));
    assert.match(g.refuse, /ctrl-shift-l/);
  }
  const menu = core.layoutGuard({ name: "automagik", tree: STOCK_LAYOUT, mod: "am-markdown" });
  assert.equal(menu?.refuse, undefined);
  assert.match(menu?.note ?? "", /the automagik layout's right-click menu/);
  for (const mod of ["am-quota", "am-automations", "am-new-menu", "scratch"]) {
    assert.equal(core.layoutGuard({ name: "automagik", tree: STOCK_LAYOUT, mod }), null, mod);
  }
  assert.match(core.layoutGuard({ tree: STOCK_LAYOUT, mod: "am-tabs" }).refuse, /the shown layout shows it/);
  assert.equal(core.layoutGuard({ name: "main", tree: {}, mod: "am-sidebar" }), null, "no tree: nothing to guard");
});

// #414: `am uninstall herdr.<mod>` (parts.mjs) asks with release.js's copy, since the pack's entries
// never load another mod's files: both functions byte for byte as the mod manager's.
// #430: `am uninstall herdr.layout` asks with release.js's packageLayoutGuard the same way.
test("layoutNeeds, layoutGuard and packageLayoutGuard: release.js's copies are core.js's, byte for byte", () => {
  assert.equal(String(release.layoutNeeds), String(core.layoutNeeds));
  assert.equal(String(release.layoutGuard), String(core.layoutGuard));
  assert.equal(String(release.packageLayoutGuard), String(core.packageLayoutGuard));
});

test("layoutGuard: `then` names what follows the switch; off is the default", () => {
  const off = core.layoutGuard({ name: "automagik", tree: STOCK_LAYOUT, mod: "am-footer" }).refuse;
  assert.match(off, /Switch layouts first \(ctrl-shift-l\), then turn it off$/);
  for (const then of ["remove it", "uninstall it"]) {
    const g = core.layoutGuard({ name: "automagik", tree: STOCK_LAYOUT, mod: "am-footer", then });
    assert.equal(g.refuse, off.replace(/turn it off$/, then));
  }
});

test("packageLayoutGuard: the package's own layout that Herdr shows is refused; any other passes", () => {
  const g = core.packageLayoutGuard({ name: "Mine", layouts: ["other.json", "mine.json"] });
  assert.match(g.refuse, /^the Mine layout is this package's \(layouts\/mine\.json\) and Herdr shows it: .*then remove it$/);
  assert.equal(core.packageLayoutGuard({ name: "automagik", layouts: ["mine.json"] }), null);
  assert.equal(core.packageLayoutGuard({ name: null, layouts: ["mine.json"] }), null, "no layout shown: nothing to guard");
  assert.equal(core.packageLayoutGuard({ name: "mine", layouts: undefined }), null, "a record with no layouts");
  // `then` names what follows the switch; remove is the default (the mod manager's).
  const un = core.packageLayoutGuard({ name: "Mine", layouts: ["mine.json"], then: "uninstall it" }).refuse;
  assert.equal(un, g.refuse.replace(/remove it$/, "uninstall it"));
});

// #491: with no shown layout to read the remove goes on (fail open) and says why, naming the
// package, every mod and own layout it moved aside, and the layouts naming those mods.
test("packageRemoveLines: no name from Herdr says why, the package, its mods and layouts; a name read says nothing", () => {
  const record = { source: "someone/tools", prefix: "pkgs/scratch", mods: ["scratch", "pane"], layouts: ["scratchy.json"], keys: [] };
  const naming = { scratch: ["scratchy", "work"], pane: ["scratchy"] };
  for (const shown of [undefined, null, ""]) {
    assert.deepEqual(core.packageRemoveLines({ record, shown, naming }), [
      "removed the package someone/tools/pkgs/scratch without knowing the layout Herdr shows (no layout from Herdr, so the remove"
      + " could not check it; is Herdr running?): moved mods/scratch, mods/pane, layouts/scratchy.json to the backup folder;"
      + " the layouts scratchy, work name scratch; the scratchy layout names pane. If Herdr shows the package's layout or one"
      + " naming its mods, Herdr drops it (plain Herdr instead): switch layouts (ctrl-shift-l)",
    ], String(shown));
  }
  // No layout names its mods (or none parses): the reason, the package and what moved are still said.
  assert.deepEqual(core.packageRemoveLines({ record: { source: "someone/scratch", prefix: "", mods: ["scratch"], layouts: [] }, shown: null }), [
    "removed the package someone/scratch without knowing the layout Herdr shows (no layout from Herdr, so the remove could not"
    + " check it; is Herdr running?): moved mods/scratch to the backup folder. If Herdr shows the package's layout or one naming"
    + " its mods, Herdr drops it (plain Herdr instead): switch layouts (ctrl-shift-l)",
  ]);
  // A name read: the guards checked it, nothing to say.
  assert.deepEqual(core.packageRemoveLines({ record, shown: "automagik", naming }), []);
});
