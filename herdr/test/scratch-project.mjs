// Shared scratch-folder and scratch-project helpers for herdr tests (#858).
// Warns once on stderr when TMPDIR lies inside a git checkout or a folder holding
// .herdr/bots.json, makes every scratch project its own isolated project before any CLI call,
// and asserts that projectOf/projectKeyOf(scratch) resolves to the scratch folder itself.
// Apache-2.0.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BOTS_PATH, projectKeyOf, projectOf } from "../mods/am-sidebar/model.js";

process.umask(0o022);

const realOrResolved = (dir) => {
  const abs = resolve(dir);
  try { return realpathSync(abs); } catch { return abs; }
};

/**
 * Returns `{ outer, raw }` when `dir` or any ancestor up to `/` holds `.herdr/bots.json` or `.git`,
 * or `null` when `dir` is outside every project and git checkout.
 */
export function findOuterProject(dir = process.env.TMPDIR || tmpdir()) {
  const raw = String(dir || process.env.TMPDIR || tmpdir());
  let cursors = [...new Set([realOrResolved(raw), resolve(raw)])];
  while (cursors.length) {
    const next = [];
    for (const cur of cursors) {
      let realCur = cur;
      try { realCur = realpathSync(cur); } catch { /* not created yet */ }
      for (const check of new Set([realCur, cur])) {
        if (existsSync(join(check, BOTS_PATH)) || existsSync(join(check, ".git"))) {
          return { outer: check, raw };
        }
      }
      const parent = dirname(cur);
      if (parent !== cur) next.push(parent);
    }
    cursors = [...new Set(next)];
  }
  return null;
}

let warnedTmpdir = false;

/**
 * Emits a one-line warning to stderr (once per process by default) when `dir` is inside a folder
 * holding `.herdr/bots.json` or `.git`. Never throws or refuses.
 */
export function warnTmpdir(
  dir = process.env.TMPDIR || tmpdir(),
  { write = (line) => process.stderr.write(line), once = true } = {},
) {
  const found = findOuterProject(dir);
  if (!found) return null;
  const line = `automagik-herdr test warning: TMPDIR (${found.raw}) is inside project/git folder ${found.outer}; set TMPDIR to a folder outside every project folder (for example TMPDIR=/tmp); relying on scratchProject isolation (#858).\n`;
  if (!once || !warnedTmpdir) {
    if (once) warnedTmpdir = true;
    write(line);
  }
  return line;
}

/**
 * Warns once if `dir` is inside a git checkout or `.herdr` project and returns its canonical path.
 */
export function assertSafeTmpdir(dir = process.env.TMPDIR || tmpdir()) {
  warnTmpdir(dir);
  return realOrResolved(String(dir || process.env.TMPDIR || tmpdir()));
}

warnTmpdir();

/**
 * Resolves `scratch` using `model.js` `projectOf`/`projectKeyOf` rules and asserts that the folder
 * resolves to itself (`key === scratch && own === scratch`). Throws a one-line Error naming the
 * outer project when walk-up escapes `scratch`.
 */
export function assertScratchProject(scratch, { ceiling = null, env = process.env } = {}) {
  const target = realOrResolved(scratch);
  const ceilingVal = ceiling
    ? (env.GIT_CEILING_DIRECTORIES ? `${realOrResolved(ceiling)}:${env.GIT_CEILING_DIRECTORIES}` : realOrResolved(ceiling))
    : env.GIT_CEILING_DIRECTORIES;
  const gitEnv = ceilingVal ? { ...env, GIT_CEILING_DIRECTORIES: ceilingVal } : env;
  const runGit = (args, cwd) => {
    try {
      return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  let key = target;
  let own = target;
  const common = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], target)?.trim() || null;
  if (common) {
    const clean = common.length > 1 ? common.replace(/\/+$/, "") : common;
    if (clean.slice(clean.lastIndexOf("/") + 1) === ".git") {
      const i = clean.lastIndexOf("/");
      key = own = i <= 0 ? "/" : clean.slice(0, i);
    } else {
      const top = runGit(["rev-parse", "--show-toplevel"], target)?.trim() || null;
      if (top) key = own = top.length > 1 ? top.replace(/\/+$/, "") : top;
    }
  } else {
    for (let dir = target; ; dir = dirname(dir)) {
      if (existsSync(join(dir, BOTS_PATH))) {
        key = dir;
        own = target;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
    }
  }
  if (key !== target || own !== target) {
    const outer = key !== target ? key : own;
    throw new Error(`Scratch project ${target} resolved to outer project ${outer} instead of itself (#858).`);
  }
  projectOf(target, runGit, existsSync).then((found) => {
    if (found.key !== target || found.own !== target) {
      throw new Error(`Scratch project ${target} resolved to outer project ${found.key} instead of itself (#858).`);
    }
  });
  projectKeyOf(target, runGit, existsSync).then((foundKey) => {
    if (foundKey !== target) {
      throw new Error(`Scratch project ${target} resolved to outer project ${foundKey} instead of itself (#858).`);
    }
  });
  return target;
}

/**
 * Creates a temporary scratch root under `tmp`, sets `GIT_CEILING_DIRECTORIES` to stop git walk-ups
 * at `root` and `tmp`, and registers cleanup on `t.after`.
 */
export function scratchRoot(t, prefix = "hb-test-", { tmp = process.env.TMPDIR || tmpdir() } = {}) {
  const safeTmp = assertSafeTmpdir(tmp);
  const root = realpathSync(mkdtempSync(join(safeTmp, prefix)));
  const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
  const added = `${root}:${safeTmp}`;
  process.env.GIT_CEILING_DIRECTORIES = prevCeiling ? `${added}:${prevCeiling}` : added;
  const cleanup = () => {
    if (prevCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
    rmSync(root, { recursive: true, force: true });
  };
  if (typeof t === "function") t(cleanup);
  else t?.after?.(cleanup);
  return root;
}

/**
 * Creates a short `0700` folder under `/tmp` (independent of a long `TMPDIR`) so test Unix socket
 * paths and `XDG_RUNTIME_DIR` stay within the OS `sun_path` bound (#858). Cleaned up on `t.after`.
 */
export function shortSocketDir(t, prefix = "hw-") {
  let dir = null;
  if (existsSync("/tmp")) {
    try { dir = realpathSync(mkdtempSync(join(realOrResolved("/tmp"), prefix))); } catch { dir = null; }
  }
  if (!dir) dir = realpathSync(mkdtempSync(join(assertSafeTmpdir(), prefix)));
  chmodSync(dir, 0o700);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  if (typeof t === "function") t(cleanup);
  else t?.after?.(cleanup);
  return dir;
}

/**
 * Creates an isolated scratch project folder inside `root` (`git init` when `isGit`, its own
 * `.herdr` folder, and `.herdr/bots.json` when `bots !== null` or `!isGit`) and asserts before
 * returning that `projectOf`/`projectKeyOf(project)` resolves to `project` itself.
 */
export function scratchProject(root, name = "proj", { isGit = true, commit = false, branch = null, template = null, bots = null } = {}) {
  const realRoot = realOrResolved(root);
  const project = join(realRoot, name);
  mkdirSync(join(project, ".herdr"), { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_CEILING_DIRECTORIES: process.env.GIT_CEILING_DIRECTORIES
      ? `${realRoot}:${process.env.GIT_CEILING_DIRECTORIES}`
      : realRoot,
  };
  if (isGit) {
    const args = ["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q"];
    if (branch) args.push("-b", branch);
    if (template !== null) args.push(`--template=${template}`);
    execFileSync("git", args, { cwd: project, env: gitEnv, encoding: "utf8" });
    if (commit) {
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start"], {
        cwd: project,
        env: gitEnv,
        encoding: "utf8",
      });
    }
  }
  const initialBots = bots !== null ? bots : (!isGit ? { version: 1, categories: [], bots: [] } : null);
  if (initialBots !== null) {
    writeFileSync(
      join(project, BOTS_PATH),
      typeof initialBots === "string" ? initialBots : `${JSON.stringify(initialBots, null, 2)}\n`,
    );
  }
  assertScratchProject(project, { ceiling: realRoot, env: gitEnv });
  return project;
}
