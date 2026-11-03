import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION, drift, monorepoVersion } from "../scripts/version.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/version.mjs", import.meta.url));

// A monorepo in a temp folder: its root package.json at `root`, the pack at herdr/ carrying `pack`.
function scratchMonorepo(root = "3.7.0", pack = root) {
  const top = mkdtempSync(join(tmpdir(), "version-test-"));
  const herdr = join(top, "herdr");
  mkdirSync(join(herdr, "scripts"), { recursive: true });
  mkdirSync(join(herdr, "mods", "am-sidebar"), { recursive: true });
  copyFileSync(SCRIPT, join(herdr, "scripts", "version.mjs"));
  writeFileSync(join(top, "package.json"), `${JSON.stringify({ name: "automagik", private: true, version: root }, null, 2)}\n`);
  writeFileSync(join(herdr, "package.json"), `${JSON.stringify({ name: "automagik-herdr", private: true, version: pack, type: "module" }, null, 2)}\n`);
  writeFileSync(join(herdr, "mods", "am-sidebar", "VERSION"), `${pack}\n`);
  return { top, herdr };
}
const cli = (herdr, ...args) => spawnSync(process.execPath, [join(herdr, "scripts", "version.mjs"), ...args], { cwd: herdr, encoding: "utf8" });

test("the pack carries the monorepo's one version", () => {
  const herdr = fileURLToPath(new URL("..", import.meta.url));
  const version = monorepoVersion(herdr);
  assert.match(version, VERSION);
  assert.deepEqual(drift(version, herdr), []);
});

test("check passes when the pack carries the root's version, and names every field that does not", () => {
  const ok = scratchMonorepo("3.7.0");
  try {
    const run = cli(ok.herdr, "check");
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /the pack carries 3\.7\.0/);
    assert.equal(cli(ok.herdr, "current").stdout.trim(), "3.7.0");
  } finally { rmSync(ok.top, { recursive: true, force: true }); }

  // A pack still on its own 0.N.P (as automagik-herdr released it) is drift, not a version of its own.
  const old = scratchMonorepo("3.7.0", "0.7.0");
  try {
    const run = cli(old.herdr, "check");
    assert.equal(run.status, 1);
    assert.match(run.stderr, /herdr\/package\.json:version = 0\.7\.0, not 3\.7\.0/);
    assert.match(run.stderr, /herdr\/mods\/am-sidebar\/VERSION = 0\.7\.0, not 3\.7\.0/);
    assert.deepEqual(drift("3.7.0", old.herdr), ["herdr/package.json:version = 0.7.0", "herdr/mods/am-sidebar/VERSION = 0.7.0"]);
  } finally { rmSync(old.top, { recursive: true, force: true }); }
});

test("the pack has no bump of its own: set, next and plan are gone", () => {
  const { top, herdr } = scratchMonorepo("3.7.0");
  try {
    for (const command of ["set", "next", "plan", "ships", "last"]) {
      const run = cli(herdr, command, "3.8.0");
      assert.equal(run.status, 2, command);
      assert.match(run.stderr, /usage: node scripts\/version\.mjs check \| current/);
    }
    assert.equal(readFileSync(join(herdr, "mods", "am-sidebar", "VERSION"), "utf8"), "3.7.0\n");
  } finally { rmSync(top, { recursive: true, force: true }); }
});

test("an unreadable field is drift, with the reason", () => {
  const { top, herdr } = scratchMonorepo("3.7.0");
  try {
    rmSync(join(herdr, "mods", "am-sidebar", "VERSION"));
    assert.deepEqual(drift("3.7.0", herdr), ["herdr/mods/am-sidebar/VERSION = unreadable (ENOENT)"]);
  } finally { rmSync(top, { recursive: true, force: true }); }
});
