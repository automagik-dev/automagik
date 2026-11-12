// One Codex launch mode (#1125, the owner's ruling of 10 and 12 Nov): every Codex seat and every
// worker the pack builds runs `--approve-for-me` with the sandbox on, `--no-daemon` (hc --skill:
// else its commands run in Codex's shared server, outside hc) and the sandbox's network access,
// plus an `--add-dir` for each folder the launch derives (its git common dir, herdr-core's state
// and data folders, the tool caches), never the home folder or a whole XDG folder. A source's own
// approval and sandbox words are left out by name; an hc worker template keeps its own command
// (the owner's exception), a seat never runs a template's bypass, and Restart --tree keeps the
// exception only for a template worker. hc's not_found (exit 3) is the one answer that reads as a
// missing pane. Scratch projects and a fake hc only: the real hc, Codex and window are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AGENTS, CODEX_MODE_ARGS, CODEX_NETWORK, absPath, codexClean, codexCleanNote, codexDirAllowed, codexGrants, codexKeepDirs, codexWhere,
  homeWide, launchRun, withCodexGrants, withoutBriefing } from "../mods/am-sidebar/models.js";
import { helperPlan, restartPlan } from "../mods/am-sidebar/restart.js";
import { codexCommandCheck, codexTemplateRefusal, codexTemplateWarning, workerPlan } from "../mods/am-sidebar/workers.js";
import { RESOLVE_PROBE, resolvedThere } from "../mods/am-sidebar/bin/automagik-herdr.mjs";
import { readJsonLines } from "./log-lines.mjs";
import { scratchProject, scratchRoot } from "./scratch-project.mjs";

const CLI = new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url).pathname;
const FAKE_HC = new URL("./fake-hc.mjs", import.meta.url).pathname;
const MODE = [...CODEX_MODE_ARGS];
const ID = { main: "b-aaaaaaaaaa", dev: "b-cccccccccc" };
const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
const count = (words, w) => words.filter((x) => x === w).length;
// The flags that turn Codex's sandbox or approvals off: none may reach a seat or an ordinary worker.
const BYPASS = ["--dangerously-bypass-approvals-and-sandbox", "--yolo"];

// ---- the source's own words (codexClean) ----

test("codexClean leaves out every approval and sandbox form it knows, by flag name, and keeps every other word", () => {
  const home = "/home/u";
  const cases = [
    [["--dangerously-bypass-approvals-and-sandbox"], "--dangerously-bypass-approvals-and-sandbox"],
    [["--yolo"], "--yolo"],
    [["-a", "never"], "-a"], [["-anever"], "-a"], [["-a=never"], "-a"],
    [["--ask-for-approval", "never"], "--ask-for-approval"], [["--ask-for-approval=on-request"], "--ask-for-approval"],
    [["-s", "danger-full-access"], "-s"], [["-sdanger-full-access"], "-s"], [["--sandbox", "read-only"], "--sandbox"],
    [["--sandbox=danger-full-access"], "--sandbox"],
    [["-c", 'sandbox_mode="danger-full-access"'], "-c sandbox_mode"], [["--config", 'approval_policy="never"'], "-c approval_policy"],
    [['--config=approvals_reviewer="user"'], "-c approvals_reviewer"], [['-csandbox_mode="danger-full-access"'], "-c sandbox_mode"],
    // codex-cli 0.167.0: this one overrides --approve-for-me (the effective sandbox becomes danger-full-access).
    [["-c", 'default_permissions=":danger-full-access"'], "-c default_permissions"],
    [['-cdefault_permissions=":danger-full-access"'], "-c default_permissions"],
    [['--config=default_permissions=":danger-full-access"'], "-c default_permissions"],
    [["-c", 'permission_profile="full"'], "-c permission_profile"], [["-c", "permissions.p.network.enabled=true"], "-c permissions"],
    [["-c", "sandbox_workspace_write.network_access=false"], "-c sandbox_workspace_write"],
    [["-c", 'sandbox_workspace_write.writable_roots=["/"]'], "-c sandbox_workspace_write"],
    [["--remote", "unix:///x.sock"], "--remote"], [["--remote=ws://h:1"], "--remote"], [["--remote-auth-token-env", "T"], "--remote-auth-token-env"],
    [["--add-dir", "/"], "--add-dir"], [["--add-dir", home], "--add-dir"], [["--add-dir=/home"], "--add-dir"],
  ];
  for (const [words, name] of cases) {
    const { argv, dropped } = codexClean(["codex", ...words, "-m", "gpt-6"], home);
    assert.deepEqual(argv, ["codex", "-m", "gpt-6"], `${words.join(" ")} is left out`);
    assert.deepEqual(dropped, [name], `${words.join(" ")} is named ${name}`);
  }
  // Unrelated words stay as written, a value that looks like a flag included; the pack's own words go quietly.
  const kept = ["codex", "-m", "-a", "-c", 'model="o3"', "--profile", "p", "--add-dir", "/srv/cache", "--enable", "x", "--disable", "hooks",
    "-C", "/w", "--worktree"];
  assert.deepEqual(codexClean([...kept, "--approve-for-me", "--no-daemon", "-c", CODEX_NETWORK], home), { argv: kept, dropped: [] });
  // After `--` nothing is a flag.
  assert.deepEqual(codexClean(["codex", "--", "-a", "--yolo"], home), { argv: ["codex", "--", "-a", "--yolo"], dropped: [] });
});

test("codexCleanNote names flags only, never a value", () => {
  const note = codexCleanNote(["codex", "-a", "never", "-c", 'default_permissions=":danger-full-access"', "--add-dir", "/home/u",
    "--sandbox=danger-full-access", "--remote", "unix:///home/u/s.sock"], "/home/u");
  assert.match(note, /-a, -c default_permissions, --add-dir, --sandbox, --remote: left out/);
  for (const value of ["never", "danger-full-access", "/home/u", "unix:"]) assert.equal(note.includes(value), false, value);
  assert.equal(codexCleanNote(["codex", "-m", "x"]), null);
});

test("launchRun: a Codex run always ends in the launch mode, each word once, before a `--`, whatever its source or codexAuto says", () => {
  for (const run of [["codex"], ["codex", "--approve-for-me"], ["codex", "--no-daemon", "--approve-for-me", "-c", CODEX_NETWORK],
    ["codex", "--dangerously-bypass-approvals-and-sandbox"], ["codex", "-a", "never", "-s", "workspace-write"], ["/opt/codex", "--yolo"]]) {
    for (const bot of [{}, { codexAuto: false }, { codexAuto: true }]) {
      const argv = launchRun("codex", run, bot);
      assert.deepEqual(argv.slice(-MODE.length), MODE, run.join(" "));
      for (const w of ["--approve-for-me", "--no-daemon"]) assert.equal(count(argv, w), 1, `${w} once: ${run.join(" ")}`);
      assert.deepEqual(argv.filter((w) => BYPASS.includes(w) || ["-a", "-s"].includes(w)), [], run.join(" "));
    }
  }
  assert.deepEqual(launchRun("codex", ["codex", "-m", "x", "--", "task"], {}), ["codex", "-m", "x", ...MODE, "--", "task"]);
  // Only Codex: another agent's run is as before.
  assert.deepEqual(launchRun("claude", ["claude"], { codexAuto: false }), ["claude", "--permission-mode", "auto"]);
});

test("--no-daemon and the network word survive every restart shape, the worker plan and a tree helper's rebuild", () => {
  const bot = { id: ID.main, name: "Genie", agent: "codex", model: "gpt-6" };
  const run = launchRun("codex", ["codex", "--yolo"], bot);
  const shapes = {
    resume: restartPlan({ bot, run, runningAgent: "codex", session: "s-1" }),
    fresh: restartPlan({ bot, run, runningAgent: "codex", fresh: true }),
    swapModel: restartPlan({ bot, run, runningAgent: "codex", model: "gpt-7" }),
    swapAgent: restartPlan({ bot: { ...bot, agent: "claude" }, run, runningAgent: "claude", agent: "codex" }),
    worker: { argv: workerPlan({ ...bot, agent: "claude" }, { agent: "codex" }).argv },
    helper: helperPlan({ get: { address: "t7", cwd: "/w", argv: ["codex", "--yolo"], foreground: { argv: ["codex", "--yolo"], cwd: "/w" } },
      worker: { agent: "codex", worktree: "/w" }, agents: AGENTS, bot }),
  };
  for (const [name, p] of Object.entries(shapes)) {
    assert.deepEqual(p.argv.slice(1, 1 + MODE.length), MODE, name);
    // Spelled out, not read from the table: hc requires --no-daemon (hc --skill), and the network word with it.
    assert.equal(count(p.argv, "--no-daemon"), 1, `${name}: --no-daemon`);
    assert.equal(p.argv.includes("sandbox_workspace_write.network_access=true"), true, `${name}: network on`);
    assert.deepEqual(p.argv.filter((w) => BYPASS.includes(w)), [], name);
  }
  assert.deepEqual(shapes.resume.argv.slice(1 + MODE.length), ["resume", "s-1", "--model", "gpt-6"]);
});

// ---- the folders a launch may write (codexGrants, withCodexGrants) ----

test("codexGrants: the git dirs, herdr-core's state and data folders and the tool caches, from the environment, only when there", () => {
  const home = "/home/u";
  const there = new Set(["/r/.git/worktrees/w", "/r/.git", "/x/state/herdr-core", "/home/u/.local/share/herdr-core", "/home/u/go/pkg/mod", "/home/u/.cache/go-build",
    "/home/u/.npm", "/home/u/.local/share/pnpm/store", "/home/u/.cache/pnpm", "/home/u/.bun/install/cache"]);
  const env = { XDG_STATE_HOME: "/x/state" };
  assert.deepEqual(codexGrants({ home, env, gitDir: "/r/.git/worktrees/w", gitCommonDir: "/r/.git", isDir: (d) => there.has(d) }), [...there]);
  // A main checkout's git dir is its common dir: granted once.
  assert.deepEqual(codexGrants({ home, env, gitDir: "/r/.git", gitCommonDir: "/r/.git", isDir: (d) => d === "/r/.git" }), ["/r/.git"]);
  // Only what is there; no git dir when there is none.
  assert.deepEqual(codexGrants({ home, env: {}, gitCommonDir: null, isDir: (d) => d === "/home/u/.npm" }), ["/home/u/.npm"]);
  // The environment names each cache; a relative or `..` path is not a path to grant.
  assert.deepEqual(codexGrants({ home, env: { GOMODCACHE: "/m", GOCACHE: "/b", npm_config_cache: "/n", BUN_INSTALL_CACHE_DIR: "/c",
    XDG_DATA_HOME: "rel", XDG_CACHE_HOME: "/q/../q" }, isDir: () => true }).filter((d) => !d.includes("herdr-core") && !d.includes("pnpm")),
  ["/m", "/b", "/n", "/c"]);
});

test("codexGrants never grants the root, the home folder, a folder above it, or a whole XDG, cache, GOPATH or Bun folder", () => {
  const home = "/home/u";
  const wide = { GOMODCACHE: home, GOCACHE: "/", npm_config_cache: "/home", BUN_INSTALL_CACHE_DIR: `${home}/.cache`,
    XDG_STATE_HOME: home, XDG_DATA_HOME: "/", GOPATH: `${home}/.local` };
  const got = codexGrants({ home, env: wide, gitDir: home, gitCommonDir: "/", isDir: () => true });
  for (const d of got) {
    assert.equal(homeWide(d, home), false, d);
    for (const general of [`${home}/.cache`, `${home}/.local`, `${home}/.local/share`, `${home}/.local/state`, `${home}/.config`, `${home}/go`, `${home}/.bun`]) {
      assert.notEqual(d, general, d);
    }
  }
  assert.equal(got.includes("/"), false);
  assert.equal(homeWide("/home/u/.npm", home), false);
  assert.equal(homeWide("/home", home), true);
});

test("withCodexGrants puts each --add-dir right after the mode words: before resume and the task; nothing without them", () => {
  const argv = [...launchRun("codex", ["codex"], {}), "resume", "--last", "-m", "x"];
  assert.deepEqual(withCodexGrants(argv, ["/r/.git", "/c"]), ["codex", ...MODE, "--add-dir", "/r/.git", "--add-dir", "/c", "resume", "--last", "-m", "x"]);
  assert.deepEqual(withCodexGrants(argv, []), argv);
  const shell = ["sh", "-c", 'codex --yolo "$@"', "sh", "resume"];
  assert.deepEqual(withCodexGrants(shell, ["/r/.git"]), shell, "a template's command is never rewritten");
  assert.deepEqual(withCodexGrants(["claude", "--permission-mode", "auto"], ["/r/.git"]), ["claude", "--permission-mode", "auto"]);
});

// ---- templates: read, never rewritten ----

test("codexCommandCheck reads a template's Codex words; the --no-daemon warning names the template and the fix", () => {
  const full = `codex --approve-for-me --disable hooks --no-daemon -c ${CODEX_NETWORK} -m x`;
  assert.deepEqual(codexCommandCheck(full), { conflicts: [], missing: [], lost: [], forwards: true, single: true });
  assert.deepEqual(codexCommandCheck("env A=1 codex -m x"), { conflicts: [], missing: MODE, lost: [], forwards: true, single: true });
  assert.deepEqual(codexCommandCheck("codex --no-daemon --dangerously-bypass-approvals-and-sandbox -a never").conflicts,
    ["--dangerously-bypass-approvals-and-sandbox", "-a"]);
  assert.equal(codexCommandCheck('sh -c "codex --approve-for-me"').single, false, "words after an outer sh -c never reach codex");
  assert.equal(codexCommandCheck("codex -m a; codex -m b").single, false);
  assert.equal(codexCommandCheck("claude --model x"), null);
  assert.equal(codexCommandCheck("codex x; claude y"), null, "two agents: not read as Codex's");
  // The local template before t1wb's fix: workspace-write, approval never, no --no-daemon.
  const local = "codex --sandbox workspace-write --ask-for-approval never -c sandbox_workspace_write.network_access=true --add-dir /r/.git";
  assert.match(codexTemplateWarning("codex-worker", local), /^Template codex-worker runs Codex without --no-daemon.*Add --no-daemon/);
  assert.equal(codexTemplateWarning("mac-dev", "codex --no-daemon --dangerously-bypass-approvals-and-sandbox -m x"), null,
    "the owner's bypass template: no warning, no refusal");
  assert.equal(codexTemplateWarning("rev", "claude --model x"), null);
});

test("a seat's Codex template: kept with the words it lacks and the grants through \"$@\", or set aside by flag name", () => {
  const bot = { agent: "codex" };
  const run = launchRun("codex", ["codex"], bot);
  const plan = (command, extra = {}) => restartPlan({ bot, run, runningAgent: "codex", session: "s-1",
    template: { name: "seat-tpl", command }, grants: ["/r/.git"], ...extra });
  // Compliant, words missing: the template's command, then the missing mode words, the grants, the resume.
  const kept = plan("codex -m x");
  assert.deepEqual(kept.argv, ["sh", "-c", 'codex -m x "$@"', "sh", ...MODE, "--add-dir", "/r/.git", "resume", "s-1"]);
  assert.deepEqual([kept.template, kept.granted, kept.templateNote], ["seat-tpl", true, null]);
  // Compliant and complete: only the grants and the resume.
  const full = plan(`codex --approve-for-me --disable hooks --no-daemon -c ${CODEX_NETWORK}`);
  assert.deepEqual(full.argv.slice(4), ["--add-dir", "/r/.git", "resume", "s-1"]);
  // The owner's worker bypass never reaches a seat: the agent row, and a note with flag names only.
  const bypass = plan("codex --no-daemon --dangerously-bypass-approvals-and-sandbox -s danger-full-access");
  assert.deepEqual([bypass.template, bypass.granted], [null, false]);
  assert.deepEqual(bypass.argv, [...run, "resume", "s-1"]);
  assert.match(bypass.templateNote, /template seat-tpl names --dangerously-bypass-approvals-and-sandbox, -s, so it started from its agent row/);
  assert.equal(bypass.templateNote.includes("danger-full-access"), false, "a flag's value is never printed");
  // One that can't take words after it (an outer sh -c, a trailing comment) is set aside too.
  for (const command of ['sh -c "codex -m x"', "codex -m x # pinned"]) {
    const p = plan(command);
    assert.deepEqual([p.template, p.argv.slice(0, run.length)], [null, run], command);
    assert.match(p.templateNote, /can't pass the pack's Codex words to Codex as options/);
  }
  // Another agent's template is as before (#213).
  const claude = restartPlan({ bot: { agent: "claude" }, run: ["claude"], runningAgent: "claude", template: { name: "c", command: "claude --x" }, fresh: true });
  assert.deepEqual([claude.template, claude.templateNote], ["c", null]);
});

test("Restart --tree keeps the template exception only for a template worker; seats' helpers and other panes run the launch mode", () => {
  const bypassShell = "codex --dangerously-bypass-approvals-and-sandbox -m x";
  const get = (labels, extra = {}) => ({ address: "t7", name: "w7", cwd: "/w", labels, argv: ["sh", "-c", bypassShell],
    foreground: { argv: ["codex", "--dangerously-bypass-approvals-and-sandbox", "-m", "x"], cwd: "/w" }, ...extra });
  const base = { agents: AGENTS, bot: { agent: "codex" }, grants: ["/r/.git"] };
  // A template worker (its worker.template label, or its ledger row): its command as it is, the bypass kept.
  for (const [labels, worker] of [[{ "worker.of": ID.dev, "worker.template": "mac-dev" }, null], [{ "worker.of": ID.dev }, { agent: null, template: "mac-dev", worktree: "/w" }]]) {
    const p = helperPlan({ ...base, get: get(labels), worker });
    assert.equal(p.error, undefined);
    assert.deepEqual(p.argv.slice(0, 3), ["sh", "-c", `${bypassShell} "$@"`]);
    assert.match(p.warning, /without --no-daemon/, "named, never refused");
  }
  // The same command on a pane that isn't a template worker (hc's own template record alone, or no label): refused by flag name.
  for (const g of [get({}, { template: "mac-dev" }), get({ "worker.of": ID.dev }, { template: "mac-dev" }), get({})]) {
    const p = helperPlan({ ...base, get: g });
    assert.match(p.error, /can't be run again: its command runs Codex with --dangerously-bypass-approvals-and-sandbox/);
    assert.equal(p.error.includes("-m x"), false);
  }
  // A plain Codex pane (an argv command, not a template): rebuilt in the launch mode, its bypass named and gone.
  const plain = helperPlan({ ...base, get: { address: "t8", name: "h8", cwd: "/w", labels: {}, argv: ["codex", "--yolo", "-m", "x"],
    foreground: { argv: ["codex", "--yolo", "-m", "x"], cwd: "/w" } } });
  assert.deepEqual(plain.argv, ["codex", "-m", "x", ...MODE, "--add-dir", "/r/.git", "resume", "--last"]);
  assert.match(plain.warning, /h8's command named --yolo: left out/);
  // An ordinary worker: rebuilt from its row in the launch mode, with the grants.
  const worker = helperPlan({ ...base, get: get({ "worker.of": ID.dev }), worker: { agent: "codex", worktree: "/w" } });
  assert.deepEqual(worker.argv, ["codex", ...MODE, "--add-dir", "/r/.git", "resume", "--last"]);
  // A compliant shell pane that isn't a template worker: its command, the missing words and grants after it.
  const shell = helperPlan({ ...base, get: { ...get({}), argv: ["sh", "-c", "codex -m x"], foreground: { argv: ["codex", "-m", "x"], cwd: "/w" } } });
  assert.deepEqual(shell.argv, ["sh", "-c", 'codex -m x "$@"', "sh", ...MODE, "--add-dir", "/r/.git", "resume", "--last"]);
});

// ---- #1142: the folder policy, resolved where the launch runs ----

/** A scratch tree standing for a launch's machine: its home, its app home, ordinary folders, links and a file. */
function tree(t) {
  const root = realpathSync(scratchRoot(t, "hb-1142-"));
  const home = join(root, "home"), app = join(home, ".config/herdr-app");
  for (const d of [join(app, "sub"), join(app, "pnpm"), join(home, "work"), join(home, ".config/other"), join(home, ".npm"), join(root, "shared"),
    join(root, "state/herdr-core")]) mkdirSync(d, { recursive: true });
  symlinkSync(home, join(root, "to-home"));
  symlinkSync(app, join(root, "to-app"));
  symlinkSync(join(root, "nowhere"), join(root, "dangling"));
  writeFileSync(join(root, "file"), "x");
  return { root, home, app };
}
/** RESOLVE_PROBE run by a real sh over `paths`, read back by resolvedThere: how that machine resolves each. */
const probe = (paths) => {
  const r = spawnSync("sh", ["-c", RESOLVE_PROBE, "sh", ...[...new Set(paths.map(absPath).filter(Boolean))]], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return resolvedThere(r.stdout);
};
/** The launch rules for a tree, every path in `paths` (and the roots) resolved there by the probe. */
const whereOn = (paths, home, appHome) => codexWhere({ home, appHome, resolve: probe([home, appHome, `${home}/.config/herdr-app`, ...paths]).resolve });

test("#1142 an --add-dir naming the home folder or an app home by any alias (dot, parent, symlink, inside, above) goes; ordinary folders stay", (t) => {
  const { root, home, app } = tree(t);
  const blocked = [`${home}/.`, `${home}/`, `${home}/work/..`, join(root, "to-home"), `${join(root, "to-home")}/`, app, join(app, "sub"),
    join(root, "to-app"), join(root, "to-app", "sub"), join(home, ".config"), join(root, "dangling"), join(root, "dangling", "x"),
    join(root, "file", "x"), root, "/", "..", "sub"];
  const allowed = [join(home, "work"), join(home, ".config/other"), join(home, ".npm"), join(root, "to-home", "work"), join(home, "new-folder"),
    join(root, "shared")];
  const where = whereOn([...blocked, ...allowed], home, app);
  const { argv, dropped } = codexClean(["codex", ...[...blocked, ...allowed].flatMap((d) => ["--add-dir", d]), "-m", "x"], where);
  assert.deepEqual(addDirs(argv), allowed, "positive controls: a project folder, an app home's sibling, a cache, a path through a link, a new folder");
  assert.deepEqual(dropped, ["--add-dir"], "named by flag, never by value");
  assert.deepEqual(codexClean(["codex", `--add-dir=${home}/.`, `--add-dir=${join(home, "work")}`], where).argv, ["codex", `--add-dir=${join(home, "work")}`]);
  // launchRun the same way; a word after -- is no option and stays as written.
  assert.deepEqual(launchRun("codex", ["codex", "--add-dir", join(root, "to-home"), "--", "--add-dir", home], {}, where), ["codex", ...MODE, "--", "--add-dir", home]);
  for (const d of [home, root, "/", app, join(app, "sub"), join(home, ".config")]) assert.equal(codexDirAllowed(d, where), false, d);
  for (const d of [join(home, "work"), join(home, ".config/other"), join(root, "shared")]) assert.equal(codexDirAllowed(d, where), true, d);
  // The default app home under the home folder stays protected whatever the effective one is.
  assert.equal(codexDirAllowed(app, whereOn([], home, join(root, "shared"))), false);
  // A finished argv (a linked machine's): the same rule, by codexKeepDirs.
  assert.deepEqual(codexKeepDirs(["codex", ...MODE, "--add-dir", `${home}/.`, "--add-dir", join(home, "work"), "resume", "--last"], where),
    { argv: ["codex", ...MODE, "--add-dir", join(home, "work"), "resume", "--last"], dropped: true });
});

test("#1142 codexGrants: a cache or XDG override naming the home folder or an app home by any alias is never granted; real caches are", (t) => {
  const { root, home, app } = tree(t);
  const env = { GOCACHE: app, npm_config_cache: `${home}/.`, GOMODCACHE: join(root, "to-home"), XDG_CACHE_HOME: join(root, "to-app"),
    BUN_INSTALL_CACHE_DIR: join(home, ".npm"), XDG_STATE_HOME: join(root, "state") };
  const { resolve, isDir } = probe([home, app, `${home}/.config/herdr-app`, ...Object.values(env), join(root, "to-app/pnpm"), join(root, "to-app/go-build"),
    join(root, "state/herdr-core"), join(home, ".local/share"), join(home, ".local/share/herdr-core"), join(home, ".local/share/pnpm/store"),
    join(home, ".config"), join(home, ".local"), join(home, "go"), join(home, ".bun"), join(home, ".bun/install/cache")]);
  const where = codexWhere({ home, appHome: app, resolve });
  assert.deepEqual(codexGrants({ where, env, isDir }), [join(root, "state/herdr-core"), join(home, ".npm")]);
});

test("#1142 a linked machine's folders are resolved there: the probe answers per path; a path it wasn't asked about proves nothing", (t) => {
  const { root, home, app } = tree(t);
  const { resolve, isDir } = probe([`${home}/.`, join(root, "to-home"), join(root, "dangling", "x"), join(root, "file", "x"), join(home, "new-folder"),
    join(root, "to-app", "sub")]);
  assert.equal(resolve(home), home);
  assert.equal(resolve(join(root, "to-home")), home);
  assert.equal(resolve(join(root, "dangling", "x")), null, "a dangling link proves nothing");
  assert.equal(resolve(join(root, "file", "x")), null, "nor a file in the way");
  assert.equal(resolve(join(home, "new-folder")), join(home, "new-folder"), "a missing tail: its nearest folder's place");
  assert.equal(isDir(join(home, "new-folder")), false);
  assert.equal(resolve(join(root, "to-app", "sub")), join(app, "sub"));
  assert.equal(isDir(join(app, "sub")), true);
  // Never this computer's answer: a path the machine wasn't asked about resolves to nothing, so it goes.
  assert.equal(resolve(join(home, "work")), null);
  assert.deepEqual(codexKeepDirs(["codex", "--add-dir", join(home, "work")], codexWhere({ home, appHome: app, resolve })), { argv: ["codex"], dropped: true });
  // A root it can't resolve is still protected as written.
  assert.equal(codexDirAllowed(app, codexWhere({ home, appHome: app, resolve: () => null })), false);
});

/** A real sh runs `argv` with a fake codex first on PATH that prints its arguments: what Codex receives. */
function codexReceives(t, argv) {
  const bin = join(realpathSync(scratchRoot(t, "hb-fakecodex-")), "bin");
  mkdirSync(bin);
  exe(join(bin, "codex"), '#!/bin/sh\nfor a do printf "%s\\n" "$a"; done\n');
  const r = spawnSync(argv[0], argv.slice(1), { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split("\n").filter(Boolean);
}
/** Codex's options (its words before any --) hold every mode word, and --no-daemon comes once. */
const modeAsOptions = (got, name) => {
  const cut = got.indexOf("--");
  const options = cut < 0 ? got : got.slice(0, cut);
  for (const m of MODE) assert.ok(options.includes(m), `${name}: ${m} before any --: ${JSON.stringify(got)}`);
  assert.equal(count(got, "--no-daemon"), 1, `${name}: --no-daemon once: ${JSON.stringify(got)}`);
};

test("#1142 a seat's Codex template is kept only when Codex provably gets the pack's words as options; checked by a real sh", (t) => {
  const bot = { agent: "codex" };
  const run = launchRun("codex", ["codex"], bot);
  const plan = (command, extra = {}) => restartPlan({ bot, run, runningAgent: "codex", session: "s-1", template: { name: "seat-tpl", command },
    grants: ["/r/.git"], ...extra });
  // Proven: Codex runs last and is the only taker of "$@" (its own, or the one the pack adds).
  for (const command of ["codex -m x", 'codex -m x "$@"', 'env A=1 codex -m x "$@"']) {
    const p = plan(command);
    assert.deepEqual([p.template, p.granted, p.templateNote], ["seat-tpl", true, null], command);
    const got = codexReceives(t, p.argv);
    modeAsOptions(got, command);
    assert.equal(got[got.indexOf("--add-dir") + 1], "/r/.git", command);
  }
  // Not proven: an earlier "$@" or $* takes the words; a -- makes them prompt text. The agent row, said by name.
  for (const [command, why] of [['printf "" "$@"; codex', /can't pass the pack's Codex words to Codex as options/],
    [`printf '%s' "$*"; codex -m x`, /can't pass/], ["codex --", /can't pass/], ['codex -m x -- "$@"', /can't pass/],
    ["codex -- --no-daemon", /puts --no-daemon after its --, where Codex reads them as prompt text/]]) {
    const p = plan(command);
    assert.deepEqual([p.template, p.granted], [null, false], command);
    assert.match(p.templateNote, why, command);
    modeAsOptions(codexReceives(t, p.argv), command);
  }
  // A template naming the home folder or an app home is set aside too (the launch's rules).
  const where = codexWhere({ home: "/home/u", appHome: "/home/u/.config/herdr-app" });
  for (const command of ["codex --add-dir /home/u/.", "codex --add-dir /home/u/.config/herdr-app", "codex --add-dir /home/u/.config"]) {
    const p = plan(command, { where });
    assert.deepEqual([p.template, p.granted], [null, false], command);
    assert.match(p.templateNote, /template seat-tpl names --add-dir, so it started from its agent row/, command);
  }
  assert.equal(plan("codex --add-dir /home/u/work", { where }).template, "seat-tpl", "an ordinary folder is fine");
});

test("#1142 a Restart --tree helper's shell command runs again only when Codex provably gets the words; else refused by name", (t) => {
  const base = { agents: AGENTS, bot: { agent: "codex" }, grants: ["/r/.git"] };
  const helper = (command, extra = {}) => helperPlan({ ...base, ...extra, get: { address: "t7", name: "h7", cwd: "/w", labels: {},
    argv: ["sh", "-c", command], foreground: { argv: ["codex"], cwd: "/w" } } });
  for (const command of ["codex -m x", 'codex -m x "$@"']) {
    const p = helper(command);
    assert.equal(p.error, undefined, command);
    modeAsOptions(codexReceives(t, p.argv), command);
  }
  for (const [command, why] of [['printf "" "$@"; codex', /h7 can't be run again: its command runs Codex but can't pass the pack's Codex words to Codex as options/],
    ["codex --", /can't pass/], ["codex -- --no-daemon", /puts --no-daemon after its --/]]) {
    const p = helper(command);
    assert.match(p.error ?? "", why, command);
    assert.equal(p.argv, undefined, command);
  }
  const home = helper("codex --add-dir /home/u/.", { where: codexWhere({ home: "/home/u" }) });
  assert.match(home.error, /h7 can't be run again: its command runs Codex with --add-dir/);
});

test("#1142 a template worker keeps the owner's command as written, never with the pack's folders; a Codex option after its -- is refused", (t) => {
  const base = { agents: AGENTS, bot: { agent: "codex" }, grants: ["/r/.git"], where: codexWhere({ home: "/home/u" }) };
  const tw = (command) => helperPlan({ ...base, get: { address: "t7", name: "w7", cwd: "/w", labels: { "worker.of": ID.dev, "worker.template": "tpl" },
    argv: ["sh", "-c", command], foreground: { argv: ["codex"], cwd: "/w" } } });
  // Its own flags before --: run as written (its bypass and its own --add-dir too), no pack folder, no granted classification.
  const command = "codex --no-daemon --dangerously-bypass-approvals-and-sandbox --add-dir /home/u -m x";
  const owner = tw(command);
  assert.equal(owner.error, undefined);
  assert.deepEqual(owner.argv.slice(0, 4), ["sh", "-c", `${command} "$@"`, "sh"]);
  assert.equal(owner.argv.includes("/r/.git"), false, "no pack-injected --add-dir");
  assert.equal("granted" in owner, false);
  assert.equal(owner.warning, null);
  const got = codexReceives(t, owner.argv);
  assert.deepEqual(got.slice(0, 2), ["--no-daemon", "--dangerously-bypass-approvals-and-sandbox"], "the owner's flags reach Codex as options");
  // #1142, warning-only (no --no-daemon among its options): recovered as written, warned, never with the pack's folders or granted.
  const warned = tw("codex -m x");
  assert.equal(warned.error, undefined);
  assert.deepEqual(warned.argv.slice(0, 4), ["sh", "-c", 'codex -m x "$@"', "sh"]);
  assert.equal(warned.argv.includes("/r/.git") || warned.argv.includes("--add-dir"), false, "no pack-injected --add-dir");
  assert.equal(warned.argv.includes("--no-daemon"), false, "its command is never rewritten");
  assert.equal("granted" in warned, false);
  assert.match(warned.warning, /^Template tpl runs Codex without --no-daemon/);
  // A Codex option after its --: refused before anything runs, by name.
  const lost = tw("codex -- --no-daemon");
  assert.match(lost.error, /w7 can't be run again: Template tpl runs Codex with --no-daemon after its --, where Codex reads it as prompt text.*not started/);
  assert.equal(lost.argv, undefined);
  assert.match(codexTemplateRefusal("tpl", "codex -m x -- --no-daemon --approve-for-me"), /with --no-daemon, --approve-for-me after its --/);
  assert.match(codexTemplateRefusal("tpl", "codex -- -c sandbox_mode=x --add-dir /r"), /with -c, --add-dir after its --/);
  assert.equal(codexTemplateRefusal("tpl", "codex --no-daemon -m x -- fix-it"), null, "a prompt after -- is no option");
  assert.equal(codexTemplateRefusal("tpl", command), null);
  // The warning reads options only: --no-daemon after -- is missing.
  assert.match(codexTemplateWarning("tpl", "codex -- --no-daemon"), /without --no-daemon/);
  assert.equal(codexCommandCheck("codex -- --no-daemon").missing.includes("--no-daemon"), true);
});

// ---- the CLI: starts, workers and hc's answers ----

/** A scratch world: a git project whose Codex Dev plays t1, a fake hc and an app home; XDG folders under the root. */
function scene(t, { programs = null, templates = [] } = {}) {
  const root = scratchRoot(t, "hb-codexmode-");
  const bots = { version: 1, categories: [], bots: [
    { id: ID.main, name: "Genie", kind: "main", agent: "claude", look: { character: "star", colour: "blue" }, role: "r", instructions: "i" },
    { id: ID.dev, name: "Dev", kind: "member", agent: "codex", look: { character: "star", colour: "blue" }, role: "r", instructions: "i" }] };
  const project = scratchProject(root, "proj", { branch: "main", commit: true, bots });
  const bin = join(root, "bin"), home = join(root, "home"), app = join(root, "app");
  for (const d of [bin, join(home, ".npm"), join(root, "state/herdr-core"), join(root, "data/herdr-core"), join(app, "mods/am-sidebar")]) {
    mkdirSync(d, { recursive: true });
  }
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  exe(join(bin, "herdr-app"), "#!/bin/sh\necho \"no window in tests\" >&2\nexit 1\n");
  for (const a of ["codex", "claude"]) exe(join(bin, a), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(app, "mods/am-sidebar/briefing.mjs"), "// stand-in\n");
  if (programs) writeFileSync(join(app, "programs.json"), `${JSON.stringify({ programs })}\n`);
  const statePath = join(root, "hc.json"), logPath = join(root, "hc.log");
  const term = (address, labels) => ({ address, name: address, cwd: project, state: "live", parent: null, created_ms: 1, labels,
    foreground: { argv: ["codex"], cwd: project, pid: 4000 }, status: { app: "codex", state: "idle" } });
  writeFileSync(statePath, JSON.stringify({ terminals: [term("t1", { bot: ID.dev })], next: 100, templates }));
  writeFileSync(logPath, "");
  // No attach ledger yet: its one-time import ties t1 to Dev by its bot label, as worker.test.mjs's scenes do.
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, HERDR_APP_HOME: app, HC_FAKE_STATE: statePath, HC_FAKE_LOG: logPath, LANG: "C",
    GIT_CEILING_DIRECTORIES: root, XDG_STATE_HOME: join(root, "state"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"),
    HC_SOCKET: join(root, "unproxied.sock"), AUTOMAGIK_HERDR_TAB_WAIT_MS: "0", AUTOMAGIK_HERDR_RESTART_STABLE_MS: "1" };
  env.HC_TERMINAL_SOCKET = env.HC_SOCKET;
  const cli = (args, { from = "t1" } = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: project, env: { ...env, ...(from ? { HC_TERMINAL_ID: from } : {}) }, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const setState = (f) => { const now = state(); f(now); writeFileSync(statePath, JSON.stringify(now)); };
  const runs = () => readJsonLines(logPath).filter((c) => c[0] === "run");
  const grants = [realpathSync(join(project, ".git")), join(root, "state/herdr-core"), join(root, "data/herdr-core"), join(home, ".npm")];
  return { root, project, home, cli, runs, setState, grants };
}
/** What an `hc run` call launches, past `/usr/bin/env NAME=value…` and the seat's briefing. */
const launched = (call) => {
  const words = call.slice(call.indexOf("--") + 1);
  let i = words[0] === "/usr/bin/env" ? 1 : 0;
  while (i && i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
  return withoutBriefing("codex", words.slice(i));
};
const addDirs = (argv) => argv.flatMap((w, i) => (w === "--add-dir" ? [argv[i + 1]] : []));

test("a Codex seat's start: the launch mode, its source's bypass words left out by name, the derived grants and never the home folder", (t) => {
  const s = scene(t, { programs: { codex: { run: ["codex", "--dangerously-bypass-approvals-and-sandbox", "-c", 'sandbox_mode="danger-full-access"',
    "--add-dir", "/"] } } });
  s.setState((st) => { st.terminals = []; }); // Dev isn't running: this is its start.
  const r = s.cli(["start", "Dev", "--json"], { from: null });
  assert.equal(r.code, 0, r.err);
  const argv = launched(s.runs()[0]);
  assert.deepEqual(argv.slice(0, 1 + MODE.length), ["codex", ...MODE]);
  assert.deepEqual(addDirs(argv), s.grants);
  assert.deepEqual(argv.filter((w) => BYPASS.includes(w) || w.startsWith("sandbox_mode")), []);
  assert.equal(addDirs(argv).some((d) => homeWide(d, s.home) || d === "/"), false);
  assert.match(r.err, /programs\.json's Codex command names --dangerously-bypass-approvals-and-sandbox, -c sandbox_mode, --add-dir: left out/);
  assert.equal(r.err.includes("danger-full-access"), false, "no value printed");
});

test("a Codex worker in a linked worktree may write its own git dir and the main checkout's .git (its common dir); a template keeps hc's template form", (t) => {
  const s = scene(t, { templates: [
    { name: "old-codex", command: "codex --sandbox workspace-write --ask-for-approval never -c sandbox_workspace_write.network_access=true" },
    { name: "mac-dev", command: "codex --no-daemon --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol" }] });
  const r = s.cli(["worker", "fix the thing", "--branch", "fix/1125-a", "--agent", "codex", "--json"]);
  assert.equal(r.code, 0, r.err);
  const argv = launched(s.runs().at(-1));
  assert.deepEqual(argv.slice(0, 1 + MODE.length), ["codex", ...MODE]);
  const worktree = realpathSync(join(s.project, ".claude/worktrees/fix-1125-a"));
  assert.equal(git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir").trim(), realpathSync(join(s.project, ".git")));
  // Its own git dir (Codex keeps it read-only beside the common dir: a commit there failed in the e2e without it), then the common dir.
  const own = git(worktree, "rev-parse", "--path-format=absolute", "--git-dir").trim();
  assert.equal(own, join(realpathSync(join(s.project, ".git")), "worktrees/fix-1125-a"));
  assert.deepEqual(addDirs(argv), [own, ...s.grants], "never the worktree's own .git file");
  assert.equal(argv.at(-1), "fix the thing");
  // A template without --no-daemon: started in hc's template form (its instructions kept), one warning with the fix.
  const old = s.cli(["worker", "task two", "--branch", "fix/1125-b", "--template", "old-codex", "--json"]);
  assert.equal(old.code, 0, old.err);
  assert.deepEqual(s.runs().at(-1).slice(-2), ["old-codex", "task two"]);
  assert.match(old.err, /Template old-codex runs Codex without --no-daemon.*Add --no-daemon/);
  // #1142, warning-only: it starts in hc's template form, never with the pack's folders and never classified granted.
  const oldCall = s.runs().at(-1);
  assert.equal(oldCall.includes("--add-dir"), false, "a warning-only template worker gets no pack-injected --add-dir");
  assert.equal(oldCall.includes("worker.template=old-codex"), true, "labelled as that template's worker");
  assert.equal(oldCall.includes("--"), false, "hc's template form: the template runs its own command, never an argv of the pack's");
  assert.equal("granted" in JSON.parse(old.out), false, "a warning-only template worker is never classified granted");
  // The owner's bypass template: neither refused nor warned, its command untouched.
  const mac = s.cli(["worker", "task three", "--branch", "fix/1125-c", "--template", "mac-dev", "--json"]);
  assert.equal(mac.code, 0, mac.err);
  assert.deepEqual(s.runs().at(-1).slice(-2), ["mac-dev", "task three"]);
  assert.equal(/no-daemon/.test(mac.err), false);
});

test("hc's answers about the calling pane are told apart: not found, a failed lookup, an unreadable answer; nothing starts", (t) => {
  const s = scene(t);
  const before = s.runs().length;
  const missing = s.cli(["worker", "x", "--branch", "fix/1125-d", "--agent", "codex"], { from: "t9" });
  assert.equal(missing.code, 1);
  assert.match(missing.err, /t9 isn't a terminal hc knows \(hc get: not found\)/);
  s.setState((st) => { st.failGet = ["t1"]; });
  const failed = s.cli(["worker", "x", "--branch", "fix/1125-d", "--agent", "codex"]);
  assert.equal(failed.code, 1);
  assert.match(failed.err, /hc couldn't look up this pane \(t1\).*hc get t1 failed: hc: server error reading t1 \(exit 1\).*Nothing was started/s);
  assert.equal(/isn't a terminal hc knows/.test(failed.err), false, "a failed lookup never reads as a missing pane");
  s.setState((st) => { st.failGet = []; st.badGet = ["t1"]; });
  const bad = s.cli(["worker", "x", "--branch", "fix/1125-d", "--agent", "codex"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /hc couldn't look up this pane \(t1\).*printed no JSON/s);
  assert.equal(s.runs().length, before, "no hc run on any refusal");
});

test("#1142 a Codex seat's start resolves programs.json's --add-dir here: a symlink to the home folder, an app home, its parent and a dangling link go", (t) => {
  const s = scene(t);
  symlinkSync(s.home, join(s.root, "to-home"));
  symlinkSync(join(s.root, "nowhere"), join(s.root, "dangling"));
  mkdirSync(join(s.root, "shared"));
  const app = join(s.root, "app");
  writeFileSync(join(app, "programs.json"), `${JSON.stringify({ programs: { codex: { run: ["codex", "--add-dir", join(s.root, "to-home"),
    "--add-dir", join(app, "x"), "--add-dir", join(s.home, ".config"), "--add-dir", `${s.home}/work/..`, "--add-dir", join(s.root, "dangling", "x"),
    "--add-dir", join(s.root, "shared")] } } })}\n`);
  s.setState((st) => { st.terminals = []; });
  const r = s.cli(["start", "Dev", "--json"], { from: null });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(addDirs(launched(s.runs()[0])), [join(s.root, "shared"), ...s.grants], "an ordinary folder stays, before the derived ones");
  assert.match(r.err, /programs\.json's Codex command names --add-dir: left out/);
});

test("#1142 the CLI refuses a worker template that puts a Codex option after its --, before anything starts; the owner's flags before -- run", (t) => {
  const s = scene(t, { templates: [{ name: "lost-dd", command: "codex -m x -- --no-daemon" },
    { name: "mac-dev", command: "codex --no-daemon --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol" }] });
  const before = s.runs().length;
  const r = s.cli(["worker", "task", "--branch", "fix/1142-a", "--template", "lost-dd", "--json"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Template lost-dd runs Codex with --no-daemon after its --, where Codex reads it as prompt text.*not started/);
  assert.equal(s.runs().length, before, "no hc run");
  assert.equal(existsSync(join(s.project, ".claude/worktrees/fix-1142-a")), false, "no worktree made");
  const mac = s.cli(["worker", "task", "--branch", "fix/1142-b", "--template", "mac-dev", "--json"]);
  assert.equal(mac.code, 0, mac.err);
  const call = s.runs().at(-1);
  assert.deepEqual(call.slice(-2), ["mac-dev", "task"]);
  assert.equal(call.includes("--add-dir"), false, "no pack-injected --add-dir for a template worker");
  assert.equal("granted" in JSON.parse(mac.out), false);
});

test("#1142 a Codex seat on a linked machine: its --add-dir words and derived folders are weighed by that machine's home and app home", (t) => {
  const root = realpathSync(scratchRoot(t, "hb-1142-vm-"));
  const bin = join(root, "bin"), home = join(root, "home"), app = join(root, "app"), vm = join(root, "vm"), vmBin = join(root, "vm-bin");
  for (const d of [bin, home, app, vmBin, join(vm, ".config/herdr-app"), join(vm, ".npm"), join(vm, ".local/state/herdr-core"), join(vm, "shared")]) {
    mkdirSync(d, { recursive: true });
  }
  symlinkSync(vm, join(vm, "link-home"));
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  exe(join(bin, "herdr-app"), "#!/bin/sh\nexit 1\n");
  exe(join(vmBin, "codex"), "#!/bin/sh\nexit 0\n");
  exe(join(vmBin, "uname"), "#!/bin/sh\necho Linux\n");
  // This computer's rules alone would keep every one of these: none is under its home or app home.
  writeFileSync(join(app, "programs.json"), `${JSON.stringify({ programs: { codex: { run: ["codex", "--add-dir", `${vm}/.`,
    "--add-dir", join(vm, "link-home"), "--add-dir", join(vm, ".config/herdr-app/x"), "--add-dir", join(vm, ".config"), "--add-dir", join(vm, "shared")] } } })}\n`);
  const project = scratchProject(vm, "proj", { commit: true, bots: { version: 1, categories: [], bots: [
    { id: ID.dev, name: "Dev", kind: "main", agent: "codex", look: { character: "star", colour: "blue" }, role: "r", instructions: "i" }] } });
  const statePath = join(root, "hc.json"), logPath = join(root, "hc.log");
  const blank = Object.fromEntries(["HERDR_APP_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "GOPATH", "GOMODCACHE",
    "GOCACHE", "npm_config_cache", "NPM_CONFIG_CACHE", "BUN_INSTALL", "BUN_INSTALL_CACHE_DIR"].map((k) => [k, ""]));
  writeFileSync(statePath, JSON.stringify({ next: 100, terminals: [],
    machines: [{ name: "vm", id: "core-of-vm", state: "connected", uname: "Linux x86_64", home: vm, path: vmBin, env: blank }] }));
  writeFileSync(logPath, "");
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, HERDR_APP_HOME: app, HC_FAKE_STATE: statePath, HC_FAKE_LOG: logPath, LANG: "C",
    GIT_CEILING_DIRECTORIES: root, XDG_DATA_HOME: "", AUTOMAGIK_HERDR_TAB_WAIT_MS: "0" };
  const r = spawnSync(process.execPath, [CLI, "start", "Dev", "--machine", "vm", "--project", project, "--json"], { cwd: root, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const call = readJsonLines(logPath).find((c) => c[0] === "run");
  const argv = launched(call);
  assert.deepEqual(argv.slice(0, 1), ["codex"]);
  assert.deepEqual(addDirs(argv), [join(vm, "shared"), realpathSync(join(project, ".git")), join(vm, ".local/state/herdr-core"), join(vm, ".npm")]);
  modeAsOptions(argv.slice(1), "the linked seat");
  assert.match(r.stderr, /vm: an --add-dir in Codex's command names the home folder, an app home or a folder whose place there can't be proved: left out/);
  assert.ok(readJsonLines(logPath).some((c) => c[0] === "exec" && c.includes("vm") && c.some((w) => typeof w === "string" && w.includes("pwd -P"))),
    "resolved there, through hc exec");
});
