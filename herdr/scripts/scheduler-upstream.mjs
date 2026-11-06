#!/usr/bin/env node
// herdr/scheduler is a vendored copy of DnzzL/herdr-automations (MIT): its UPSTREAM.md names the
// tag, the commit and the upstream paths this repository leaves out. This script proves the copy is
// byte-identical to that tag's tarball minus those exclusions. It fetches the tarball into a temp
// folder (gh api, or codeload over https), compares every path the exclusion list leaves in, checks
// LICENSE-upstream against the tarball's LICENSE, and prints each differing, missing or extra path.
// The fork's own patch (issue #498) is listed under UPSTREAM.md's "Local changes": those files may
// differ and print as patched (a new file there prints as added); an unlisted difference still fails.
//
//   node herdr/scripts/scheduler-upstream.mjs --tag v0.12.1 [--dir herdr/scheduler]
//
// Exit 0 when identical to upstream minus the exclusions (the Local changes listed), 1 on any other
// difference, 2 when the tag's tarball cannot be read. Both lists come from --dir's UPSTREAM.md
// ("## Excluded upstream paths", "## Local changes", the fenced block under each), so the note and
// the check cannot drift. Plain Node, no dependencies (it runs with this repository's tooling, not
// the pack's). Apache-2.0.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
export function matcher(glob) {
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
export function exclusions(dir) {
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

/** The paths UPSTREAM.md lists under "## Local changes": the fork's patch, one path per line. */
export function localChanges(dir) {
  const note = join(dir, "UPSTREAM.md");
  if (!existsSync(note)) throw new Error(`${note}: not found`);
  const after = readFileSync(note, "utf8").split(/^## Local changes\s*$/m)[1];
  if (!after) return [];
  const block = /```[^\n]*\n([\s\S]*?)```/.exec(after.split(/^## /m)[0]);
  if (!block) throw new Error(`${note}: no fenced list under "## Local changes"`);
  return block[1].split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const path = line.split(/\s+—\s+/)[0].trim();
    if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error(`${note}: not a relative path under "## Local changes": ${line}`);
    return path;
  });
}

/**
 * Compares the extracted tarball at source with dir: every path the exclusions leave in must be
 * byte-identical, unless "Local changes" lists it (patched), and a listed path upstream does not
 * have is an addition (added). Anything else is a problem. Returns the counts and both lists.
 */
export function compare(source, dir) {
  const excluded = exclusions(dir);
  const skip = (path) => excluded.some((entry) => entry.test.test(path));
  const listed = new Set(localChanges(dir));
  const upstream = walk(source);
  const expected = upstream.filter((path) => !skip(path));
  const local = walk(dir);
  const here = new Set(local);
  const patched = [];
  const added = [];
  const problems = [];
  for (const path of expected) {
    if (!here.has(path)) { problems.push({ kind: "missing", path }); continue; }
    if (readFileSync(join(source, path)).equals(readFileSync(join(dir, path)))) continue;
    if (listed.has(path)) patched.push(path);
    else problems.push({ kind: "differs", path });
  }
  for (const path of local) {
    if (expected.includes(path) || OURS.has(path) || path === LICENSE_COPY) continue;
    if (listed.has(path)) added.push(path);
    else problems.push({ kind: "extra", path });
  }
  // The pack keeps upstream's notice under its own name too; it is a copy, not ours to edit.
  if (expected.includes("LICENSE")) {
    if (!here.has(LICENSE_COPY)) problems.push({ kind: "missing", path: LICENSE_COPY, note: "the upstream LICENSE, under the pack's convention" });
    else if (!readFileSync(join(source, "LICENSE")).equals(readFileSync(join(dir, LICENSE_COPY)))) problems.push({ kind: "differs", path: LICENSE_COPY, note: "from upstream LICENSE" });
  }
  for (const path of listed) {
    if (!here.has(path) && !upstream.includes(path)) problems.push({ kind: "missing", path, note: "listed as a local change, but neither upstream nor here" });
  }
  return { compared: expected.length, excluded: upstream.length - expected.length, patched: patched.sort(), added: added.sort(), problems };
}

/** Compares dir against the tag's tarball; returns 0 identical (patches included), 1 any difference. */
async function check(tag, dir) {
  const tmp = mkdtempSync(join(tmpdir(), "scheduler-upstream-"));
  try {
    const archive = await tarball(tag, tmp);
    const source = join(tmp, "upstream");
    mkdirSync(source);
    execFileSync("tar", ["-xzf", archive, "-C", source, "--strip-components=1"], { stdio: ["ignore", "ignore", "inherit"] });
    const result = compare(source, dir);
    const patterns = exclusions(dir).map((entry) => entry.pattern).join(", ");
    console.log(`scheduler-upstream: ${tag}, ${result.compared} upstream path(s) compared, ${result.excluded} excluded (${patterns})`);
    for (const path of result.patched) console.log(`patched: ${path} (listed under Local changes)`);
    for (const path of result.added) console.log(`added: ${path} (listed under Local changes)`);
    if (result.problems.length > 0) {
      for (const problem of result.problems.sort((a, b) => a.path.localeCompare(b.path))) {
        console.error(`${problem.kind}: ${problem.path}${problem.note ? ` (${problem.note})` : ""}`);
      }
      console.error(`scheduler-upstream: ${result.problems.length} difference(s) from ${tag}`);
      return 1;
    }
    console.log(`scheduler-upstream: ${JSON.stringify(dir)} is byte-identical to ${tag} minus the exclusions, with ${result.patched.length + result.added.length} listed local change(s)`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Imported by its test, run by a person or the Reviewer: only the direct invocation checks anything.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
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
}
