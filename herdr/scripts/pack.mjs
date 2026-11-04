#!/usr/bin/env node
// The pack tarball, automagik-herdr-pack-<v>.tgz (RFC 0011, RFC 0012): what release.yml attaches,
// and what am builds from a checkout (a ./path or git source) before it reads <staged>/<select>/part.json.
//
//   node herdr/scripts/pack.mjs --out <file.tgz> [--ref <ref> | --worktree] [--repo <dir>]
//
// --ref (default HEAD): the committed tree, as git archive makes it (release.yml packs the tag).
// --worktree: the same tracked files, read from disk (a checkout's uncommitted edits included).
// The tarball's top level is exactly the ref's PACK_MODS (mods/am-sidebar/release.js), each folder of
// herdr/mods/ (every one but pocket-link must be listed), plus layouts/automagik.json (from
// herdr-layout/layouts/, the layout's own top-level entry, at the same path inside it). The layout
// part's part.json rides inside the sidebar's folder, as am-sidebar/layout/part.json: every
// installed updater (update.mjs unsafeEntries and stagePack, back to v0.15.0) refuses any other new
// entry, and a pointer must never send an install a tarball it refuses.
// Self-contained (node: imports only), so release.yml runs the tag's own copy. Apache-2.0.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** herdr-layout/<file> → its path in the tarball (unchanged: old updaters refuse any other). */
export const LAYOUT_FILES = Object.freeze({ "layouts/automagik.json": "layouts/automagik.json", "part.json": "am-sidebar/layout/part.json" });
const POCKET_LINK = "pocket-link";

const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 << 20, ...opts });

/** The pack's folder list at `ref` (or on disk with --worktree), checked against herdr/mods/. */
async function packMods(repo, ref, tmp) {
  const release = join(tmp, "release.mjs");
  if (ref) writeFileSync(release, git(repo, ["show", `${ref}:herdr/mods/am-sidebar/release.js`]));
  else copyFileSync(join(repo, "herdr", "mods", "am-sidebar", "release.js"), release);
  const { PACK_MODS } = await import(pathToFileURL(release).href);
  const listed = ref ? git(repo, ["ls-tree", "--name-only", `${ref}:herdr/mods`]) : git(repo, ["ls-files", "--", "herdr/mods"]).split("\n").map((p) => p.split("/")[2] ?? "").join("\n");
  const folders = [...new Set(listed.split("\n").filter((n) => n && n !== POCKET_LINK))].sort();
  if (folders.join(",") !== [...PACK_MODS].sort().join(",")) {
    throw new Error(`herdr/mods/${ref ? ` at ${ref}` : ""} (${folders.join(" ")}) is not PACK_MODS (${PACK_MODS.join(" ")})`);
  }
  return [...PACK_MODS];
}

/** Builds `out` from `repo`; returns the tarball's top-level entries (PACK_MODS plus layouts). */
export async function pack({ repo, out, ref = "HEAD", worktree = false }) {
  repo = resolve(repo);
  out = resolve(out);
  const tmp = mkdtempSync(join(tmpdir(), "herdr-pack-"));
  try {
    const mods = await packMods(repo, worktree ? null : ref, tmp);
    // Each layout file under its tarball name in a folder of its own, for git archive --add-file
    // (which takes the file's basename under the last --prefix).
    const extra = Object.entries(LAYOUT_FILES).map(([f, to], i) => {
      const dir = join(tmp, `add-${i}`);
      const file = join(dir, basename(to));
      mkdirSync(dir);
      if (worktree) copyFileSync(join(repo, "herdr-layout", f), file);
      else writeFileSync(file, git(repo, ["show", `${ref}:herdr-layout/${f}`]));
      return { file, to };
    });
    mkdirSync(dirname(out), { recursive: true });
    if (!worktree) {
      // As release.yml always made it: the ref's folders by git archive, the layout files beside them.
      git(repo, ["archive", "--format=tar.gz", "-o", out, ...extra.flatMap((e) => [`--prefix=${dirname(e.to)}/`, `--add-file=${e.file}`]),
        "--prefix=", `${ref}:herdr/mods`, "--", ...mods]);
    } else {
      // The same tracked files, from disk, with their exec bits.
      const tree = join(tmp, "tree");
      for (const path of git(repo, ["ls-files", "--", ...mods.map((m) => `herdr/mods/${m}`)]).split("\n").filter(Boolean)) {
        const to = join(tree, path.slice("herdr/mods/".length));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(join(repo, path), to);
        chmodSync(to, statSync(join(repo, path)).mode & 0o777);
      }
      for (const e of extra) { mkdirSync(dirname(join(tree, e.to)), { recursive: true }); copyFileSync(e.file, join(tree, e.to)); }
      execFileSync("tar", ["-czf", out, "-C", tree, ...mods, "layouts"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    }
    const top = [...new Set(execFileSync("tar", ["-tzf", out], { encoding: "utf8" }).split("\n").filter(Boolean).map((p) => p.split("/")[0]))].sort();
    const want = [...mods, "layouts"].sort();
    if (top.join(",") !== want.join(",")) throw new Error(`the archive's top level (${top.join(" ")}) is not PACK_MODS plus layouts`);
    return top;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** `{ out, ref, worktree, repo }` from argv, or throws the usage. */
export function parseArgs(argv, here = dirname(fileURLToPath(import.meta.url))) {
  const usage = new Error("usage: node herdr/scripts/pack.mjs --out <file.tgz> [--ref <ref> | --worktree] [--repo <dir>]");
  const opts = { ref: "HEAD", worktree: false, repo: null, out: null };
  let refGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--worktree") opts.worktree = true;
    else if (["--out", "--ref", "--repo"].includes(a) && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      opts[a.slice(2)] = argv[++i];
      if (a === "--ref") refGiven = true;
    } else throw usage;
  }
  if (!opts.out || (refGiven && opts.worktree)) throw usage;
  opts.repo ??= execFileSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return opts;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(64); }
  try {
    const top = await pack(opts);
    console.log(`${opts.out}: ${top.join(" ")}`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
