// scripts/entries.mjs: no herdr-mod entry folder holds layouts/ (herdr.dev skips the whole
// repository for one, RFC 0011).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { entryFolders, layoutsInEntries } from "../scripts/entries.mjs";

test("an entry folder is any folder holding mods/<name>/main.js; its layouts/ is refused", () => {
  const files = [
    "herdr/mods/am-sidebar/main.js", "herdr/mods/am-tabs/main.js", "herdr/install.sh",
    "herdr-layout/automagik.json", "herdr-layout/RECIPE.md",
    "apps/x/mods/y/main.js", "apps/x/README.md",
    "mods/root/main.js",
    "docs/layouts/note.md",
  ];
  assert.deepEqual(entryFolders(files), ["", "apps/x", "herdr"]);
  assert.deepEqual(layoutsInEntries(files), [], "a layout folder of its own, and layouts/ outside an entry, are fine");
  assert.deepEqual(layoutsInEntries([...files, "herdr/layouts/automagik.json"]), ["herdr/layouts/"]);
  assert.deepEqual(layoutsInEntries([...files, "layouts/a.json", "apps/x/layouts/b.json"]), ["layouts/", "apps/x/layouts/"], "in entry-folder order: the root first");
  assert.deepEqual(layoutsInEntries(["mods/a/main.js", "mods/a/layouts/x.json"]), [], "a mod's own folder is not the entry's layouts/");
});

test("this repository: no herdr-mod entry folder holds layouts/", () => {
  const script = fileURLToPath(new URL("../scripts/entries.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no herdr-mod entry folder holds layouts\/: .*herdr/);
});
