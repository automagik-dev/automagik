// scripts/entries.mjs: no herdr-mod entry folder holds layouts/ (herdr.dev skips the whole
// repository for one, RFC 0011).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { entryFolders, layoutEntryProblems, layoutsInEntries, problemsOf } from "../scripts/entries.mjs";

test("an entry folder is any folder holding mods/<name>/main.js; its layouts/ is refused", () => {
  const files = [
    "herdr/mods/am-sidebar/main.js", "herdr/mods/am-tabs/main.js", "herdr/install.sh",
    "herdr-layout/layouts/automagik.json", "herdr-layout/RECIPE.md", "herdr-layout/preview.png", "herdr-layout/part.json",
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

test("herdr/ must stay a mod entry with no layouts/; herdr-layout/ a layout entry in herdr.dev's shape", () => {
  const files = [
    "herdr/mods/am-sidebar/main.js", "herdr/RECIPE.md",
    "herdr-layout/layouts/automagik.json", "herdr-layout/RECIPE.md", "herdr-layout/preview.png", "herdr-layout/part.json",
  ];
  assert.deepEqual(problemsOf(files), [], "part.json at the layout entry's root is its manifest, not a layout");
  assert.match(problemsOf([...files, "herdr/layouts/automagik.json"]).join("\n"), /^herdr\/layouts\/: a herdr-mod entry folder holds layouts\//);
  assert.match(problemsOf(files.filter((f) => !f.startsWith("herdr/mods/"))).join("\n"), /^herdr\/: no mods\/<name>\/main\.js/);
  // The crawler probe's e2: a layout .json at the entry's root, no layouts/, is not listed.
  const e2 = files.map((f) => f.replace("herdr-layout/layouts/", "herdr-layout/"));
  assert.deepEqual(layoutEntryProblems(e2), [
    "herdr-layout/layouts/<name>.json: missing; herdr.dev lists a layout only from its entry's layouts/",
    "herdr-layout/automagik.json: herdr.dev skips a layout .json at the entry's root; move it to herdr-layout/layouts/",
  ]);
  assert.deepEqual(layoutEntryProblems(files.filter((f) => !f.endsWith(".png"))), ["herdr-layout/preview.png: missing; a layout entry needs it"]);
  assert.deepEqual(layoutEntryProblems([...files, "herdr-layout/layouts/nested/x.json"]), [], "a layout of its own beside it is fine");
});

test("this repository: no herdr-mod entry folder holds layouts/", () => {
  const script = fileURLToPath(new URL("../scripts/entries.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no herdr-mod entry folder holds layouts\/: .*herdr; herdr-layout\/ is a layout entry/);
});
