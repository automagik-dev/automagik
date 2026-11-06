#!/usr/bin/env node
// herdr/scheduler is a vendored copy of DnzzL/herdr-automations (MIT): its UPSTREAM.md names the
// tag, the commit and the upstream paths this repository leaves out. This script proves the copy is
// byte-identical to that tag's tarball minus those exclusions. It fetches the tarball into a temp
// folder (gh api, or codeload over https), compares every path the exclusion list leaves in, checks
// LICENSE-upstream against the tarball's LICENSE, and prints each differing, missing or extra path.
//
//   node herdr/scripts/scheduler-upstream.mjs --tag v0.12.1 [--dir herdr/scheduler]
//
// Exit 0 when identical to upstream minus the exclusions, 1 on any difference, 2 when the tag's
// tarball cannot be read. The exclusion list is read from --dir's UPSTREAM.md ("## Excluded upstream
// paths", the fenced block under it), so the note and the check cannot drift. Plain Node, no
// dependencies (it runs with this repository's tooling, not the pack's). Apache-2.0.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "DnzzL/herdr-automations";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** This repository's own files in the folder; neither is upstream's (LICENSE-upstream is checked). */
const OURS = new Set(["UPSTREAM.md"]);
const LICENSE_COPY = "LICENSE-upstream";
const USAGE = "usage: node herdr/scripts/scheduler-upstream.mjs --tag <tag> [--dir herdr/scheduler]";

/** A --flag value, refusing a missing one or another flag as its value. */
function option(name) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value\n${USAGE}`);
  return value;
}

/** Every file under root, as a sorted list of `/`-separated paths relative to it. */
function walk(root) {
  const files = [];
  const visit = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path).split(sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

/** An exclusion as a pattern over relative paths: `dir/`, `path`, `docs/*.gif`, `**` any depth. */
function matcher(glob) {
  const folder = glob.endsWith("/");
  const body = folder ? glob.slice(0, -1) : glob;
  let source = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "*" && body[i + 1] === "*") { source += ".*"; i++; }
    else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}${folder ? "/" : "$"}`);
}

/** The exclusion list UPSTREAM.md names, as { pattern, test }. */
function exclusions(dir) {
  const note = join(dir, "UPSTREAM.md");
  if (!existsSync(note)) throw new Error(`${note}: not found`);
  const after = readFileSync(note, "utf8").split(/^## Excluded upstream paths\s*$/m)[1];
  const block = after && /```[^\n]*\n([\s\S]*?)```/.exec(after.split(/^## /m)[0]);
  if (!block) throw new Error(`${note}: no fenced list under "## Excluded upstream paths"`);
  const patterns = block[1].split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (patterns.length === 0) throw new Error(`${note}: the exclusion list is empty`);
  return patterns.map((pattern) => ({ pattern, test: matcher(pattern) }));
}

/** The tag's tarball, into the temp folder: gh first, then codeload (no token needed). */
async function tarball(tag, into) {
  const file = join(into, "upstream.tar.gz");
  try {
    writeFileSync(file, execFileSync("gh", ["api", `repos/${REPO}/tarball/${tag}`], { maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }));
    return file;
  } catch {
    // No gh, no auth, or the API refused: the public tag is a plain download.
  }
  const url = `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${tag}`;
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/** Compares dir against the tag's tarball; returns 0 identical, 1 any difference. */
async function check(tag, dir) {
  const excluded = exclusions(dir);
  const skip = (path) => excluded.some((entry) => entry.test.test(path));
  const tmp = mkdtempSync(join(tmpdir(), "scheduler-upstream-"));
  try {
    const archive = await tarball(tag, tmp);
    const source = join(tmp, "upstream");
    mkdirSync(source);
    execFileSync("tar", ["-xzf", archive, "-C", source, "--strip-components=1"], { stdio: ["ignore", "ignore", "inherit"] });
    const upstream = walk(source);
    const expected = upstream.filter((path) => !skip(path));
    const local = walk(dir);
    const here = new Set(local);
    const differences = [];
    for (const path of expected) {
      if (!here.has(path)) differences.push(`missing: ${path}`);
      else if (!readFileSync(join(source, path)).equals(readFileSync(join(dir, path)))) differences.push(`differs: ${path}`);
    }
    for (const path of local) {
      if (expected.includes(path) || OURS.has(path)) continue;
      if (path === LICENSE_COPY) {
        const licence = join(source, "LICENSE");
        if (!existsSync(licence)) throw new Error(`${tag}'s tarball has no LICENSE for ${LICENSE_COPY}`);
        if (!readFileSync(licence).equals(readFileSync(join(dir, path)))) differences.push(`differs: ${path} (from upstream LICENSE)`);
      } else {
        differences.push(`extra: ${path}`);
      }
    }
    if (!here.has(LICENSE_COPY)) differences.push(`missing: ${LICENSE_COPY} (the upstream LICENSE, under the pack's convention)`);
    console.log(`scheduler-upstream: ${tag}, ${expected.length} upstream path(s) compared, ${upstream.length - expected.length} excluded (${excluded.map((entry) => entry.pattern).join(", ")})`);
    if (differences.length > 0) {
      for (const difference of differences.sort()) console.error(difference);
      console.error(`scheduler-upstream: ${differences.length} difference(s) from ${tag}`);
      return 1;
    }
    console.log(`scheduler-upstream: ${JSON.stringify(dir)} is byte-identical to ${tag} minus the exclusions`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

let status;
try {
  const tag = option("--tag");
  if (!tag) throw new Error(USAGE);
  if (!/^[0-9A-Za-z][0-9A-Za-z._/-]*$/.test(tag)) throw new Error(`not a tag: ${tag}`);
  status = await check(tag, resolve(option("--dir") ?? join(ROOT, "herdr", "scheduler")));
} catch (error) {
  console.error(`scheduler-upstream: ${error.message}`);
  status = 2;
}
process.exit(status);
