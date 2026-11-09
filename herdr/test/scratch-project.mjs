// Shared scratch-folder and scratch-project helpers for herdr tests (#858).
// Refuses any TMPDIR that lies inside a git checkout or a folder holding .herdr/bots.json,
// and initializes isolated scratch projects so git and .herdr walk-ups never escape into
// a real repository's roster. Apache-2.0.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

process.umask(0o022);

const realOrResolved = (dir) => {
  const abs = resolve(dir);
  try { return realpathSync(abs); } catch { return abs; }
};

/**
 * Verifies that `dir` (defaulting to `os.tmpdir()`) and every ancestor up to `/` are outside
 * any git checkout (`.git` directory or worktree file) and any Herdr project (`.herdr/bots.json`).
 * Throws an Error naming `TMPDIR` when an ancestor holds either marker.
 */
export function assertSafeTmpdir(dir = tmpdir()) {
  const raw = String(dir || tmpdir());
  const candidates = new Set([resolve(raw), realOrResolved(raw)]);
  for (const start of candidates) {
    for (let cur = start; ; cur = dirname(cur)) {
      let realCur = cur;
      try { realCur = realpathSync(cur); } catch { /* not created yet */ }
      for (const check of new Set([cur, realCur])) {
        if (existsSync(join(check, ".herdr", "bots.json")) || existsSync(join(check, ".git"))) {
          throw new Error(
            `Refusing to create herdr test scratch folders inside project/git directory ${check} (from TMPDIR=${raw}); `
            + "set TMPDIR to a directory outside every repository and .herdr project, such as /tmp.",
          );
        }
      }
      const parent = dirname(cur);
      if (parent === cur) break;
    }
  }
  return realOrResolved(raw);
}

/**
 * Creates a temporary scratch root under `tmp` (after `assertSafeTmpdir(tmp)`) and registers
 * cleanup on `t.after` when `t` is a node:test context or a `{ after }` hook holder.
 */
export function scratchRoot(t, prefix = "hb-test-", { tmp = tmpdir() } = {}) {
  const safeTmp = assertSafeTmpdir(tmp);
  const root = realpathSync(mkdtempSync(join(safeTmp, prefix)));
  if (typeof t === "function") t(() => rmSync(root, { recursive: true, force: true }));
  else t?.after?.(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * Creates a scratch project folder inside `root`. By default initializes its own git repository
 * (`isGit: true`) so `git rev-parse` stops at `project` and never walks up to an outer checkout.
 */
export function scratchProject(root, name = "proj", { isGit = true, commit = false, branch = null, template = null, bots = null } = {}) {
  assertSafeTmpdir(dirname(root));
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  if (isGit) {
    const args = ["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q"];
    if (branch) args.push("-b", branch);
    if (template !== null) args.push(`--template=${template}`);
    execFileSync("git", args, { cwd: project, encoding: "utf8" });
    if (commit) {
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start"], {
        cwd: project,
        encoding: "utf8",
      });
    }
  }
  if (bots !== null) {
    mkdirSync(join(project, ".herdr"), { recursive: true });
    writeFileSync(join(project, ".herdr", "bots.json"), typeof bots === "string" ? bots : `${JSON.stringify(bots, null, 2)}\n`);
  }
  return project;
}
