#!/usr/bin/env node
// herdr.dev's crawler skips a whole repository when a herdr-mod entry folder holds `layouts/`,
// and a skip deletes the listing it had (RFC 0011). A herdr-mod entry folder is any folder of the
// repository that holds `mods/<name>/main.js` (the repo root included), as am-mods' findPackages
// reads a package. The layout lives in its own top-level folder instead (herdr-layout/), which
// herdr.dev lists as a layout entry only in its documented shape: layouts/<name>.json beside
// RECIPE.md and preview.png. A layout .json at that folder's own root is skipped (the crawler
// probe's e2).
//
//   node scripts/entries.mjs --check    exit 1, naming each problem: an entry folder holds layouts/,
//                                       herdr/ is no entry, or herdr-layout/ is not a layout entry
//
// It reads the files git tracks, from the repository's top, wherever it runs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The pack's mod entry, the herdr.dev Community entry's folder. */
export const MOD_ENTRY = "herdr";
/** The pack's layout entry, a folder of its own beside the mod entry. */
export const LAYOUT_ENTRY = "herdr-layout";

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

/** What keeps `folder` from being listed as a layout entry, one line each; [] when it would be. */
export function layoutEntryProblems(files, folder = LAYOUT_ENTRY) {
  const inside = files.filter((f) => f.startsWith(`${folder}/`)).map((f) => f.slice(folder.length + 1));
  const problems = [];
  if (!inside.some((f) => /^layouts\/[^/]+\.json$/.test(f))) problems.push(`${folder}/layouts/<name>.json: missing; herdr.dev lists a layout only from its entry's layouts/`);
  for (const f of ["RECIPE.md", "preview.png"]) if (!inside.includes(f)) problems.push(`${folder}/${f}: missing; a layout entry needs it`);
  // part.json is the layout part's manifest (RFC 0012), not a layout.
  for (const f of inside.filter((p) => /^[^/]+\.json$/.test(p) && p !== "part.json")) {
    problems.push(`${folder}/${f}: herdr.dev skips a layout .json at the entry's root; move it to ${folder}/layouts/`);
  }
  return problems;
}

/** Every problem `files` (git's tracked paths) have, one line each. */
export function problemsOf(files) {
  const problems = layoutsInEntries(files).map((dir) => `${dir}: a herdr-mod entry folder holds layouts/, and herdr.dev skips the whole repository for it; move the layout to its own top-level folder (${LAYOUT_ENTRY}/layouts/)`);
  if (!entryFolders(files).includes(MOD_ENTRY)) problems.push(`${MOD_ENTRY}/: no mods/<name>/main.js, so it is no herdr-mod entry`);
  return [...problems, ...layoutEntryProblems(files)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--check" || process.argv.length !== 3) {
    console.error("usage: node scripts/entries.mjs --check");
    process.exit(2);
  }
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: top, encoding: "utf8" }).split("\0").filter(Boolean);
  const problems = problemsOf(files);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`no herdr-mod entry folder holds layouts/: ${entryFolders(files).map((f) => f || ".").join(", ")}; ${LAYOUT_ENTRY}/ is a layout entry`);
}
