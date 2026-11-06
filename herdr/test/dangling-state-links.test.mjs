// #566: the state folder's leftovers on Node 24.0 to 24.9, where fs.rmSync on a dangling link
// returns without an error and leaves the link. One row per removal: a dangling link planted at the
// exact name that removal deletes. Node 22 and the newest 24 remove the link with rmSync too, so
// these rows fail only on 24.0-24.9 without removePath (layoutSafe.mjs, #550). Temp app homes only;
// the parts rows get an exec that runs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUpdate, lockOf, markerOf, prevSetOf, readVersion, stateDirOf, takeLock } from "../mods/am-sidebar/update.mjs";
import { contextOf, partOf, uninstall } from "../mods/am-sidebar/parts.mjs";

const MODS = ["am-sidebar", "am-tabs"];

/** A scratch folder, removed after the test (a recursive rmSync of a folder removes a dangling link inside on 24.9 too). */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "am-dangling-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** An app home with the pack's two folders at `version` in mods/ (none: an empty mods/) and its record. */
function appHome(dir, version, { folders = true } = {}) {
  const app = join(dir, "app"), mods = join(app, "mods");
  mkdirSync(mods, { recursive: true });
  if (folders) {
    for (const m of MODS) {
      mkdirSync(join(mods, m));
      writeFileSync(join(mods, m, "main.js"), `export const v = "${version}";\n`);
      writeFileSync(join(mods, m, "mod.json"), '{ "place": "none" }\n');
    }
    writeFileSync(join(mods, "am-sidebar", "VERSION"), `${version}\n`);
  }
  mkdirSync(stateDirOf(mods), { recursive: true });
  writeFileSync(markerOf(mods), `version=${version}\nmods=${MODS.join(",")}\nbefore=none\n`);
  return { app, mods };
}
/** A dangling link at `at`: its target was never made. */
const dangle = (dir, at) => { symlinkSync(join(dir, "never-made"), at); assert.equal(lstatSync(at).isSymbolicLink(), true); };
/** The state folder's names starting with `prefix`: what a removal left behind. */
const left = (mods, prefix) => readdirSync(stateDirOf(mods)).filter((n) => n.startsWith(prefix));
const isRealDir = (p) => { const s = lstatSync(p, { throwIfNoEntry: false }); return Boolean(s?.isDirectory() && !s.isSymbolicLink()); };
/** A parts context in the scratch folder: HOME and the app home there, and an exec that runs nothing. */
const partsCtx = (dir, app, logs) => contextOf({
  env: { HOME: join(dir, "home"), HERDR_APP_HOME: app, PATH: "/usr/bin:/bin" },
  exec: () => ({ code: 127, stdout: "", stderr: "", missing: true }), log: (l) => logs.push(l), platform: "darwin",
});

test("update.mjs takeLock: a dangling update.lock taken over leaves no .update.lock-stale-* link", (t) => {
  const dir = scratch(t);
  const { mods } = appHome(dir, "0.1.0");
  dangle(dir, lockOf(mods));
  const free = takeLock(mods);
  assert.ok(isRealDir(lockOf(mods)), "the lock is this run's folder");
  assert.deepEqual(left(mods, ".update.lock-stale-"), [], "the aside name of the dangling lock is gone");
  free();
  assert.equal(lstatSync(lockOf(mods), { throwIfNoEntry: false }), undefined);
});

test("update.mjs takeLock's free: a lock whose link dangles by the remove leaves no .update.lock-free-* link", (t) => {
  const dir = scratch(t);
  const { mods } = appHome(dir, "0.1.0");
  const free = takeLock(mods);
  // The lock becomes a link to a folder holding this run's token; that folder goes once the token
  // was read through the renamed link, so the remove meets a dangling .update.lock-free-<pid>-<hex>.
  const target = join(dir, "lock-target");
  renameSync(lockOf(mods), target);
  symlinkSync(target, lockOf(mods));
  const read = fs.readFileSync;
  fs.readFileSync = (path, ...rest) => {
    const out = read(path, ...rest);
    if (String(path).includes(".update.lock-free-")) rmSync(target, { recursive: true, force: true });
    return out;
  };
  syncBuiltinESMExports();
  try { free(); } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
  assert.equal(lstatSync(target, { throwIfNoEntry: false }), undefined, "the target went, so the link dangled at the remove");
  assert.deepEqual(left(mods, ".update.lock-free-"), [], "the freed lock's link is gone");
  assert.equal(lstatSync(lockOf(mods), { throwIfNoEntry: false }), undefined);
});

test("update.mjs keepSet: a dangling .prev set aside by an update leaves no .prev-old-* link", async (t) => {
  const dir = scratch(t);
  const { mods } = appHome(dir, "0.1.0");
  dangle(dir, prevSetOf(mods));
  const tree = join(dir, "tree");
  for (const m of MODS) {
    mkdirSync(join(tree, m), { recursive: true });
    writeFileSync(join(tree, m, "main.js"), 'export const v = "0.2.0";\n');
    writeFileSync(join(tree, m, "mod.json"), '{ "place": "none" }\n');
  }
  writeFileSync(join(tree, "am-sidebar", "VERSION"), "0.2.0\n");
  writeFileSync(join(tree, "am-sidebar", "release.js"), `export const PACK_MODS = ${JSON.stringify(MODS)};\n`);
  writeFileSync(join(tree, "am-sidebar", "update.mjs"), "// the pack's updater\n");
  const tgz = join(dir, "automagik-herdr-pack-0.2.0.tgz");
  execFileSync("tar", ["czf", tgz, "-C", tree, ...MODS], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const r = await applyUpdate({ tgzPath: tgz, version: "0.2.0", modsDir: mods });
  assert.equal(readVersion(join(mods, "am-sidebar")), "0.2.0");
  assert.deepEqual(r.warnings, []);
  assert.ok(isRealDir(prevSetOf(mods)), "the replaced folders are the kept set");
  assert.equal(readVersion(join(prevSetOf(mods), "am-sidebar")), "0.1.0");
  assert.deepEqual(left(mods, ".prev-old-"), [], "the older set's link is gone");
});

test("parts.mjs uninstall: a dangling .prev set aside leaves no .prev-old-* link", (t) => {
  const dir = scratch(t);
  const { app, mods } = appHome(dir, "0.1.0");
  dangle(dir, prevSetOf(mods));
  const logs = [];
  const r = uninstall(partsCtx(dir, app, logs), partOf("herdr.pack"));
  assert.equal(r.ok, true);
  assert.deepEqual(readdirSync(mods), [], "the pack's folders left mods/");
  assert.ok(isRealDir(prevSetOf(mods)), "they are the kept set");
  assert.deepEqual(readdirSync(prevSetOf(mods)).sort(), [".pack", ...MODS]);
  assert.deepEqual(left(mods, ".prev-old-"), [], "the older set's link is gone");
});

test("parts.mjs uninstall --purge with nothing to move: a dangling .prev goes, and only then is it said deleted", (t) => {
  const dir = scratch(t);
  const { app, mods } = appHome(dir, "0.1.0", { folders: false });
  dangle(dir, prevSetOf(mods));
  const logs = [];
  const r = uninstall(partsCtx(dir, app, logs), partOf("herdr.pack"), { purge: true });
  assert.equal(r.ok, true);
  assert.equal(lstatSync(prevSetOf(mods), { throwIfNoEntry: false }), undefined, "the kept set's link is gone");
  assert.ok(logs.includes(`deleted the kept set ${prevSetOf(mods)} (--purge)`), logs.join("\n"));
  assert.deepEqual(left(mods, ".prev"), []);
});
