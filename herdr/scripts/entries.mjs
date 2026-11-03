#!/usr/bin/env node
// herdr.dev's crawler skips a whole repository when a herdr-mod entry folder holds `layouts/`,
// and a skip deletes the listing it had (RFC 0011). A herdr-mod entry folder is any folder of the
// repository that holds `mods/<name>/main.js` (the repo root included), as am-mods' findPackages
// reads a package. The layout lives in its own top-level folder instead (herdr-layout/).
//
//   node scripts/entries.mjs --check    exit 1, naming each, when an entry folder holds layouts/
//
// It reads the files git tracks, from the repository's top, wherever it runs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The herdr-mod entry folders among `files` (repo paths): "" for the root, else the folder. */
export function entryFolders(files) {
  const found = new Set();
  for (const f of files) {
    const m = /^(?:(.*)\/)?mods\/[^/]+\/main\.js$/.exec(f);
    if (m) found.add(m[1] ?? "");
  }
  return [...found].sort();
}

/** Each entry folder's `layouts/` that `files` hold, as `<folder>/layouts/` (or `layouts/` at the root). */
export function layoutsInEntries(files) {
  return entryFolders(files)
    .map((folder) => (folder ? `${folder}/layouts/` : "layouts/"))
    .filter((dir) => files.some((f) => f.startsWith(dir)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--check" || process.argv.length !== 3) {
    console.error("usage: node scripts/entries.mjs --check");
    process.exit(2);
  }
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: top, encoding: "utf8" }).split("\0").filter(Boolean);
  const bad = layoutsInEntries(files);
  if (bad.length > 0) {
    for (const dir of bad) console.error(`${dir}: a herdr-mod entry folder holds layouts/, and herdr.dev skips the whole repository for it; move the layout to its own top-level folder (herdr-layout/)`);
    process.exit(1);
  }
  console.log(`no herdr-mod entry folder holds layouts/: ${entryFolders(files).map((f) => f || ".").join(", ")}`);
}
