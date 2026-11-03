// scripts/pack.mjs, the pack tarball release.yml attaches and am builds from a checkout: every part.json
// lands at <select>part.json, and every tarball it builds is one the oldest installed updaters accept
// (their own update.mjs, read from the tags: a pointer must never send an install a tarball it refuses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LAYOUT_FILES, pack, parseArgs } from "../scripts/pack.mjs";
import { validateParts } from "../scripts/parts.mjs";
import { PACK_MODS } from "../mods/am-sidebar/release.js";
import { readVersion } from "../mods/am-sidebar/update.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOP = execFileSync("git", ["-C", ROOT, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const VERSION = readVersion(join(ROOT, "mods", "am-sidebar"));
/** The oldest updaters still installed: the bridge release (old repository layout) and the monorepo's first pack. */
const OLDEST = [["v0.15.0", "mods/am-sidebar"], ["v3.63.1", "herdr/mods/am-sidebar"]];

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-pack-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const listing = (tgz) => execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).split("\n").filter(Boolean);

test("pack.mjs arguments: --out is needed; --ref and --worktree exclude each other", () => {
  assert.deepEqual(parseArgs(["--out", "x.tgz", "--repo", "/r"]), { ref: "HEAD", worktree: false, repo: "/r", out: "x.tgz" });
  assert.equal(parseArgs(["--out", "x.tgz", "--repo", "/r", "--worktree"]).worktree, true);
  for (const bad of [[], ["--out"], ["--out", "x", "--ref", "v1", "--worktree"], ["--out", "x", "--nope"]]) assert.throws(() => parseArgs(bad), /usage/, bad.join(" "));
});

for (const worktree of [true, false]) {
  const mode = worktree ? "--worktree" : "--ref HEAD";
  test(`${mode}: PACK_MODS plus layouts/, and every part.json at its <select>part.json, byte for byte`, async (t) => {
    const out = join(scratch(t), "p.tgz");
    assert.deepEqual(await pack({ repo: TOP, out, worktree }), [...PACK_MODS, "layouts"].sort());
    const names = listing(out);
    assert.ok(names.includes("layouts/automagik.json"));
    assert.ok(names.includes(LAYOUT_FILES["part.json"]));
    assert.ok(!names.some((n) => n.startsWith("pocket-link")), "never Pocket Link");
    const x = join(scratch(t), "x");
    mkdirSync(x);
    execFileSync("tar", ["-xzf", out, "-C", x]);
    const files = execFileSync("git", ["-C", TOP, "ls-files", ...(worktree ? ["--cached", "--others", "--exclude-standard"] : [])], { encoding: "utf8" }).split("\n").filter(Boolean);
    const at = (f) => (worktree ? readFileSync(join(TOP, f), "utf8") : execFileSync("git", ["-C", TOP, "show", `HEAD:${f}`], { encoding: "utf8" }));
    const herdrParts = files.filter((f) => /^(herdr|herdr-layout)\/(.*\/)?part\.json$/.test(f));
    assert.ok(herdrParts.length >= PACK_MODS.length + 2);
    for (const f of herdrParts) {
      const part = JSON.parse(at(f));
      assert.equal(readFileSync(join(x, part.select, "part.json"), "utf8"), at(f), `${part.id}: ${part.select}part.json`);
    }
    if (worktree) assert.deepEqual(validateParts({ files, read: at, packMods: PACK_MODS }).problems, []);
  });
}

for (const [tag, folder] of OLDEST) {
  test(`every tarball pack.mjs builds installs through ${tag}'s own updater (unsafeEntries, stagePack, applyUpdate)`, async (t) => {
    const dir = scratch(t);
    const old = join(dir, "old");
    mkdirSync(old);
    execFileSync("sh", ["-c", `git -C "$1" archive "$2" "$3" | tar -x -C "$4"`, "sh", TOP, tag, folder, old]);
    const updater = await import(pathToFileURL(join(old, folder, "update.mjs")).href);
    for (const worktree of [true, false]) {
      const out = join(dir, `p-${worktree}.tgz`);
      await pack({ repo: TOP, out, worktree });
      const names = listing(out);
      const lines = execFileSync("tar", ["-tvzf", out], { encoding: "utf8" }).split("\n").filter(Boolean);
      assert.deepEqual(updater.unsafeEntries(names, lines), [], `${tag}'s unsafeEntries`);
      const home = join(dir, `home-${worktree}`);
      mkdirSync(join(home, "mods"), { recursive: true });
      const done = await updater.applyUpdate({ tgzPath: out, version: VERSION, modsDir: join(home, "mods") });
      assert.deepEqual([...done.mods].sort(), [...PACK_MODS].sort(), `${tag} installed every pack mod`);
      assert.ok(readFileSync(join(home, "mods", "am-sidebar", "layout", "part.json"), "utf8").includes('"herdr.layout"'));
      assert.ok(readFileSync(join(home, "mods", "am-sidebar", "pack", "part.json"), "utf8").includes('"herdr.pack"'));
    }
  });
}

test("release.yml packs the tag through the tag's own pack.mjs", () => {
  const yml = readFileSync(join(TOP, ".github", "workflows", "release.yml"), "utf8");
  assert.match(yml, /git show "v\$\{VERSION\}:herdr\/scripts\/pack\.mjs" > "\$\{RUNNER_TEMP\}\/pack\.mjs"/);
  assert.match(yml, /node "\$\{RUNNER_TEMP\}\/pack\.mjs" --repo \. --ref "v\$\{VERSION\}" --out "release\/\$\{tgz\}"/);
});
