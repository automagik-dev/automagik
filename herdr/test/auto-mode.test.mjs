// Every agent's automatic mode (#955, #953): the launch line of each agent kind carries its
// automatic mode by default, from the definition (models.js AUTO_MODE), on a start, a restart, a
// worker and a restart --tree helper. Antigravity runs on --dangerously-skip-permissions only
// beside a --settings file, whose fixed deny list is the same for seats and workers and whose
// trustedWorkspaces names a writer's own folder. A stand-in agy (this file writes it) checks the
// file a launch really writes: a compound command returns its output, a denied one is refused.
// With AUTOMAGIK_HERDR_REAL_AGY=1 the same two commands go to the real agy (it spends a little
// of the signed-in account's quota, so it is never on by default). No real hc, home or window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AGENTS, AGY_FIXED_DENY, AGY_SKIP_PERMISSIONS, AUTO_MODE, AUTO_MODE_NONE,
  agyGuarded, agyModeWarning, agySettingsDir, agySettingsPlan, autoModeArgs, launchRun,
} from "../mods/am-sidebar/models.js";
import { helperPlan, restartPlan } from "../mods/am-sidebar/restart.js";
import { workerArgs, workerPlan } from "../mods/am-sidebar/workers.js";

const ID = "b-aaaaaaaaaa";
const APP = "/home/u/.config/herdr-app";
// The flags that answer every approval with yes. Only Antigravity's may be on a launch line, and
// only beside its deny list (the owner's word, #955).
const SKIP_ALL = ["--dangerously-skip-permissions", "--dangerously-bypass-approvals-and-sandbox", "--yolo", "--auto-approve",
  "--approval-mode=yolo", "--force", "--allow-all-tools", "--dangerously-allow-all", "bypassPermissions"];
// What each kind's launch adds, written out here so a change to the table is a change to this list.
const EXPECTED = {
  claude: ["--permission-mode", "auto"],
  codex: ["--approve-for-me"],
  antigravity: ["--dangerously-skip-permissions"],
};

test("every agent kind is in exactly one table: an automatic mode, or the reason it has none", () => {
  for (const key of Object.keys(AGENTS)) {
    assert.equal(Boolean(AUTO_MODE[key]) !== Boolean(AUTO_MODE_NONE[key]), true, `${key} is in one table`);
    assert.deepEqual(AUTO_MODE[key]?.args ?? [], EXPECTED[key] ?? [], `${key}'s automatic mode`);
  }
  assert.deepEqual(Object.keys({ ...AUTO_MODE, ...AUTO_MODE_NONE }).filter((key) => !AGENTS[key]), [], "no row for an agent that isn't one");
});

for (const key of Object.keys(AGENTS)) {
  test(`${key}: a start, a restart, a worker and a tree helper carry its automatic mode by default`, () => {
    const bot = { id: ID, name: "Genie", agent: key };
    const run = AGENTS[key].run;
    const auto = EXPECTED[key] ?? [];
    const head = [...run, ...auto];
    // A start (launchSeat and seatOnMachine build their line from launchRun).
    assert.deepEqual(launchRun(key, run, bot), head);
    // A restart, here and on a linked machine: the callers hand restartPlan launchRun's words.
    const fresh = restartPlan({ bot, run: launchRun(key, run, bot), fresh: true });
    assert.deepEqual(fresh.argv.slice(0, head.length), head);
    // A worker (the CLI's and the hc proxy's approved plan are both workerPlan's).
    const worker = workerPlan({ ...bot, agent: "claude" }, { agent: key });
    assert.equal(worker.error, undefined);
    assert.deepEqual(worker.argv.slice(0, head.length), head);
    // A restart --tree worker helper, rebuilt from the definition.
    const helper = helperPlan({ get: { address: "t7", cwd: "/w", state: "live", argv: run, foreground: { argv: run, cwd: "/w" } },
      worker: { agent: key, worktree: "/w" }, agents: AGENTS, bot,
      agy: { appHomeDir: APP, bot, realpath: null, homeDir: "/home/u" } });
    assert.equal(helper.error, undefined);
    assert.deepEqual(helper.argv.filter((w) => auto.includes(w)), auto);
    // No skip-all flag reaches any agent but Antigravity.
    if (key !== "antigravity") {
      for (const argv of [fresh.argv, worker.argv, helper.argv]) {
        assert.deepEqual(argv.filter((w) => SKIP_ALL.includes(w)), [], `${key} gets no skip-all flag`);
      }
    }
  });
}

test("a run that already picks its approvals (programs.json) is left as the person wrote it; codexAuto false opts Codex out", () => {
  assert.deepEqual(launchRun("claude", ["claude", "--permission-mode", "manual"], {}), ["claude", "--permission-mode", "manual"]);
  assert.deepEqual(launchRun("claude", ["claude", "--permission-mode=plan"], {}), ["claude", "--permission-mode=plan"]);
  assert.deepEqual(launchRun("codex", ["codex", "-a", "never"], {}), ["codex", "-a", "never"]);
  assert.deepEqual(launchRun("antigravity", ["agy", AGY_SKIP_PERMISSIONS], {}), ["agy", AGY_SKIP_PERMISSIONS]);
  assert.deepEqual(autoModeArgs("codex", { codexAuto: false }, ["codex"]), []);
  assert.deepEqual(autoModeArgs("claude", { codexAuto: false }, ["claude"]), ["--permission-mode", "auto"], "the opt-out only touches Codex");
  // A flag after `--` is a prompt word, never the run's own choice.
  assert.deepEqual(launchRun("claude", ["claude", "--", "--permission-mode"], {}), ["claude", "--", "--permission-mode", "--permission-mode", "auto"]);
});

// ---- Antigravity: skip-permissions only beside the deny list ----

const AGY_BOT = Object.freeze({ id: ID, name: "Genie", agent: "antigravity" });
const NEW_DENY = ["command(gh api -X)", "command(gh api --method)", "command(gh api -f)", "command(gh api -F)",
  "command(automagik-herdr edit)", "command(automagik-herdr restart)", "command(automagik-herdr rm)", "command(automagik-herdr create)",
  "command(hc keys)", "command(hc kill)", "command(hc interrupt)", "command(hc exec)"];
const OLD_DENY = ["command(git push --force)", "command(git push --force-with-lease)", "command(git push -f)",
  "command(git push origin --force)", "command(git push origin -f)", "command(git push --mirror)", "command(git push --delete)",
  "command(git reset --hard)", "command(git branch -D)", "command(git clean)", "command(git rebase)", "command(git stash)",
  "command(git checkout --)", "command(git -C)", "command(rm -rf)", "command(gh pr merge)", "command(gh release)"];

test("Antigravity: the fixed deny list is the same on a seat and on every worker role, and a roster can't drop a rule", () => {
  assert.deepEqual([...AGY_FIXED_DENY], [...OLD_DENY, ...NEW_DENY]);
  const plans = [
    agySettingsPlan({ bot: AGY_BOT, scope: "seat", folder: "/work/proj", settingsDir: agySettingsDir(APP) }),
    agySettingsPlan({ bot: { ...AGY_BOT, rank: "reviewer" }, scope: "seat", folder: "/work/proj", settingsDir: agySettingsDir(APP) }),
    ...["dev", "test", "fix", "review"].map((role) => agySettingsPlan({ bot: AGY_BOT, scope: "worker", role, folder: "/work/wt",
      settingsDir: agySettingsDir(APP) })),
    agySettingsPlan({ bot: { ...AGY_BOT, agyPermissions: { allow: ["command(hc kill)", "command(gh api)"], deny: [] } }, scope: "seat",
      folder: "/work/proj", settingsDir: agySettingsDir(APP) }),
  ];
  for (const plan of plans) {
    assert.deepEqual(plan.deny.slice(0, AGY_FIXED_DENY.length), [...AGY_FIXED_DENY]);
    assert.deepEqual(JSON.parse(plan.text).permissions.deny.slice(0, AGY_FIXED_DENY.length), [...AGY_FIXED_DENY], "the file agy reads holds it");
  }
});

test("Antigravity #953: a dev, test or fix worker's file trusts its own worktree; a review launch lists nothing", () => {
  for (const role of ["dev", "test", "fix"]) {
    const plan = agySettingsPlan({ bot: AGY_BOT, scope: "worker", role, folder: "/work/wt/", settingsDir: agySettingsDir(APP),
      realpath: (p) => p, homeDir: "/home/u" });
    assert.deepEqual(JSON.parse(plan.text).trustedWorkspaces, ["/work/wt"], `${role} trusts its worktree`);
  }
  const review = agySettingsPlan({ bot: AGY_BOT, scope: "worker", role: "review", folder: "/work/wt", settingsDir: agySettingsDir(APP),
    realpath: (p) => p, homeDir: "/home/u" });
  assert.equal("trustedWorkspaces" in JSON.parse(review.text), false, "a read-only review launch is never trusted for the person");
  assert.deepEqual(review.deny.slice(0, AGY_FIXED_DENY.length), [...AGY_FIXED_DENY], "its deny list is still whole");
});

test("Antigravity: a worker, a restart and a tree helper run on skip-permissions with their --settings file, never without it", () => {
  const plan = workerPlan(AGY_BOT, {});
  assert.deepEqual(plan.argv, ["agy", "--dangerously-skip-permissions", "--mode", "auto"]);
  const base = { botId: ID, branch: "fix/955", cwd: "/w", parent: "t1", agent: "antigravity", argv: plan.argv, task: "do it" };
  assert.deepEqual(workerArgs({ ...base, agySettingsPath: "/s/worker.json" }).slice(-8),
    ["agy", "--dangerously-skip-permissions", "--mode", "auto", "--settings", "/s/worker.json", "-i", "do it"]);
  // No permission file: the flag is taken out, since the deny list is all it leaves standing.
  assert.deepEqual(workerArgs(base).slice(-5), ["agy", "--mode", "auto", "-i", "do it"]);
  // A restart that writes its file (a local seat).
  const seat = restartPlan({ bot: AGY_BOT, run: launchRun("antigravity", ["agy"], AGY_BOT), fresh: true,
    agy: { appHomeDir: APP, folder: "/work/proj", realpath: null, homeDir: "/home/u" } });
  assert.deepEqual(seat.argv, ["agy", "--dangerously-skip-permissions", "--mode", "auto", "--settings", seat.agySettings.path]);
  assert.deepEqual(seat.agySettings.deny.slice(0, AGY_FIXED_DENY.length), [...AGY_FIXED_DENY]);
  // A tree helper with a bot to write the file for, and one with none.
  const get = { address: "t7", cwd: "/w", state: "live", argv: ["agy"], foreground: { argv: ["agy"], cwd: "/w" } };
  const worker = { agent: "antigravity", worktree: "/w", role: "dev" };
  const withFile = helperPlan({ get, worker, agents: AGENTS, bot: AGY_BOT, fresh: "asked",
    agy: { appHomeDir: APP, bot: AGY_BOT, realpath: null, homeDir: "/home/u" } });
  assert.equal(withFile.argv.includes(AGY_SKIP_PERMISSIONS) && withFile.argv.includes("--settings"), true);
  const noFile = helperPlan({ get, worker, agents: AGENTS, bot: AGY_BOT, fresh: "asked" });
  assert.equal(noFile.argv.includes(AGY_SKIP_PERMISSIONS), false, "no file, no skip-permissions");
});

test("agyGuarded: only an agy launch with a named --settings file keeps skip-permissions", () => {
  assert.deepEqual(agyGuarded("antigravity", ["agy", AGY_SKIP_PERMISSIONS, "--settings", "/f.json"]), ["agy", AGY_SKIP_PERMISSIONS, "--settings", "/f.json"]);
  assert.deepEqual(agyGuarded("antigravity", ["agy", "--settings=/f.json", AGY_SKIP_PERMISSIONS]), ["agy", "--settings=/f.json", AGY_SKIP_PERMISSIONS]);
  assert.deepEqual(agyGuarded("antigravity", ["agy", AGY_SKIP_PERMISSIONS, "--mode", "auto"]), ["agy", "--mode", "auto"]);
  assert.deepEqual(agyGuarded("antigravity", ["agy", AGY_SKIP_PERMISSIONS, "--settings"]), ["agy", "--settings"], "a --settings with no file names none");
  assert.deepEqual(agyGuarded("antigravity", ["agy", AGY_SKIP_PERMISSIONS, "--", "--settings", "/f.json"]), ["agy", "--", "--settings", "/f.json"],
    "words after -- are a prompt");
  // Another agent's line, and a shell template (it owns its command), are returned as they are.
  assert.deepEqual(agyGuarded("claude", ["claude", "--dangerously-skip-permissions"]), ["claude", "--dangerously-skip-permissions"]);
  const tpl = ["sh", "-c", `agy ${AGY_SKIP_PERMISSIONS} "$@"`, "sh"];
  assert.deepEqual(agyGuarded("antigravity", tpl), tpl);
});

test("agyModeWarning: a roster that names auto on a host that can't run it is told; the default and a working host say nothing", () => {
  const missing = { state: "missing", detail: "unprivileged user namespaces are restricted (apparmor_restrict_unprivileged_userns is 1)" };
  const line = agyModeWarning({ name: "Genie", explicit: "auto", sandbox: missing });
  assert.match(line, /^Genie: Antigravity's --mode auto is not available on this host \(unprivileged user namespaces are restricted/);
  assert.match(line, /--dangerously-skip-permissions\), under its deny list\.$/);
  assert.equal(agyModeWarning({ name: "Genie", explicit: null, sandbox: missing }), null, "the default mode is not the roster's own choice");
  assert.equal(agyModeWarning({ name: "Genie", explicit: "plan", sandbox: missing }), null);
  assert.equal(agyModeWarning({ name: "Genie", explicit: "auto", sandbox: { state: "available", detail: "" } }), null);
  assert.equal(agyModeWarning({ name: "Genie", explicit: "auto", sandbox: { state: "unknown", detail: "" } }), null);
});

// ---- A run against the file a launch writes ----

// A stand-in for agy's permission check, as measured on agy 1.5.4 (2026-11-10, Linux and macOS):
// without --dangerously-skip-permissions a command stops for a person (exit 3 here); with it,
// every part of a compound line is checked against --settings' permissions.deny by word prefix,
// and a match is refused with agy's own sentence. An untrusted folder stops at the trust
// question whatever the flags (exit 4 here). Anything else runs.
const FAKE_AGY = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const argv = process.argv.slice(2);
const at = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : argv[i + 1]; };
const settings = at("--settings") ? JSON.parse(readFileSync(at("--settings"), "utf8")) : {};
const line = at("-p");
if (!(settings.trustedWorkspaces ?? []).includes(process.cwd())) { console.log("Do you trust the contents of this project?"); process.exit(4); }
if (!argv.includes("--dangerously-skip-permissions")) { console.log("Allow this command?"); process.exit(3); }
const deny = (settings.permissions?.deny ?? []).map((rule) => /^command\\((.*)\\)$/.exec(rule)?.[1]).filter(Boolean).map((r) => r.split(/\\s+/));
for (const part of line.split(/&&|\\|\\||;|\\|/)) {
  const words = part.trim().split(/\\s+/);
  if (deny.some((rule) => rule.every((w, i) => words[i] === w))) {
    console.log(\`permission check failed for unsandboxed "\${line}": Permission denied for unsandboxed(\${line}). Matches user-configured deny rule.\`);
    process.exit(1);
  }
}
const r = spawnSync("sh", ["-c", line], { encoding: "utf8" });
process.stdout.write(r.stdout);
process.exit(r.status ?? 1);
`;

/** A worktree, and the settings file a dev worker's launch writes for it, on disk; plus the stand-in agy. */
function launchFiles(t, role = "dev") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-auto-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worktree = join(root, "wt");
  mkdirSync(worktree);
  const plan = agySettingsPlan({ bot: AGY_BOT, scope: "worker", role, folder: worktree, settingsDir: join(root, "settings"),
    realpath: realpathSync, homeDir: join(root, "home") });
  mkdirSync(join(root, "settings"));
  writeFileSync(plan.path, plan.text, { mode: 0o600 });
  const fake = join(root, "agy.mjs");
  writeFileSync(fake, FAKE_AGY);
  chmodSync(fake, 0o755);
  // The launch words of a worker, with the stand-in as the program and a print-mode command.
  const words = (line, argv = workerPlan(AGY_BOT, {}).argv) => agyGuarded("antigravity", [...argv, "--settings", plan.path]).slice(1).concat(["-p", line]);
  const run = (line, argv) => spawnSync(process.execPath, [fake, ...words(line, argv)], { cwd: worktree, encoding: "utf8" });
  return { root, worktree, plan, run, words };
}

test("a worker's launch words and file: a compound command returns its output, a denied command is refused (stand-in agy)", (t) => {
  const s = launchFiles(t);
  const ok = s.run("echo one && echo two");
  assert.deepEqual([ok.status, ok.stdout], [0, "one\ntwo\n"], "no prompt, both parts ran");
  for (const line of ["echo hi && git push --force", "hc kill t12", "gh api -X DELETE repos/o/r", "automagik-herdr restart Genie", "git reset --hard HEAD~1",
    "echo hi; rm -rf build", "hc keys t3 Enter", "gh pr merge 12"]) {
    const no = s.run(line);
    assert.equal(no.status, 1, line);
    assert.match(no.stdout, /Matches user-configured deny rule\./, line);
  }
  // What the launch words buy: the same file without the flag stops for a person.
  const asked = s.run("echo one && echo two", ["agy", "--mode", "auto"]);
  assert.equal(asked.status, 3, "without skip-permissions agy asks");
});

test("#953: the stand-in opens a dev worker's worktree with no trust question, and stops a review launch at it", (t) => {
  assert.equal(launchFiles(t, "dev").run("echo in").status, 0);
  const review = launchFiles(t, "review").run("echo in");
  assert.deepEqual([review.status, review.stdout], [4, "Do you trust the contents of this project?\n"]);
});

test("the real agy: a compound command returns its output and a denied command is refused (AUTOMAGIK_HERDR_REAL_AGY=1)",
  { skip: process.env.AUTOMAGIK_HERDR_REAL_AGY === "1" ? false : "opt-in: it runs the signed-in agy" }, (t) => {
    const s = launchFiles(t);
    const real = (line) => spawnSync("agy", [...s.words(`Run exactly this one shell command once, do not retry, and reply with only its raw output or the exact error text: ${line}`)],
      { cwd: s.worktree, encoding: "utf8", timeout: 180_000 });
    const ok = real("echo one && echo two");
    assert.match(`${ok.stdout}`, /one\s+two/);
    const no = real("echo hi && git push --force");
    assert.match(`${no.stdout}${no.stderr}`, /deny rule|[Pp]ermission denied/);
  });
