// Antigravity's per-launch permission list (#823): the rules agy 1.5.3 takes, the effective
// allow and deny lists by scope and role, the deterministic settings file under the app home,
// the launch words, and the host's terminal-sandbox evidence. Pure: no program runs, no file is
// read from the real home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AGY_FIXED_DENY, AGY_READ_ALLOW, AGY_SHELL_READ, AGY_WRITE_ALLOW,
  agyPermissionPlan, agyRuleProblem, agySandbox, agySettingsArgs, agySettingsDir, agySettingsFile, agySettingsPlan,
  normalizeAgyPermissions, withAgySettings, withoutAgySettings,
} from "../mods/am-sidebar/models.js";
import { checkBots, parseBots } from "../mods/am-sidebar/model.js";
import { helperPlan, restartPlan } from "../mods/am-sidebar/restart.js";

const BOT = Object.freeze({ id: "b-aaaaaaaaaa", name: "Genie", agent: "antigravity" });
const SEAT = "/work/proj";
const APP = "/home/u/.config/herdr-app";
const SETTINGS = agySettingsDir(APP);
const SHELL_READ = Object.freeze([
  "ls", "cat", "head", "tail", "grep", "wc", "diff", "pwd", "echo", "cut", "tr", "jq", "printf",
  "basename", "dirname", "true", "which", "stat", "realpath", "readlink", "date", "nl", "comm",
  "column",
]);
const WRITER_ONLY_SHELL = Object.freeze([
  "command(mkdir)", "command(chmod)", "command(rg)", "command(sort)", "command(uniq)", "command(sed -n)",
]);
const READ_HC_RULES = Object.freeze([
  "command(hc ls)", "command(hc get)", "command(hc read)", "command(hc wait)", "command(hc send)",
]);
const FORBIDDEN_SHELL = Object.freeze([
  "command(bash)", "command(sh)", "command(env)", "command(xargs)",
  "command(find)", "command(awk)", "command(tee)", "command(sed)",
]);

test("agyRuleProblem: command and write_file rules, never junk", () => {
  for (const rule of ["command(hc)", "command(gh pr view)", "write_file(/work/proj)", "write_file(/)"]) {
    assert.equal(agyRuleProblem(rule), null, rule);
  }
  assert.match(agyRuleProblem(""), /a rule is text/);
  assert.match(agyRuleProblem(42), /a rule is text/);
  assert.match(agyRuleProblem("hc"), /isn't a rule/);
  assert.match(agyRuleProblem("exec(hc)"), /unknown rule type exec/);
  assert.match(agyRuleProblem("command()"), /no command/);
  assert.match(agyRuleProblem("write_file(relative/path)"), /absolute folder/);
  assert.match(agyRuleProblem("write_file(/a)b)"), /can't hold/);
  assert.match(agyRuleProblem("command(hc)\ncommand(git)"), /line break/);
});

test("normalizeAgyPermissions: trims, dedupes, keeps the good rules and says what it dropped", () => {
  const ok = normalizeAgyPermissions({ allow: [" command(hc) ", "command(npm)", "command(hc)"], deny: ["command(gh release)"] });
  assert.deepEqual([ok.allow, ok.deny, ok.problems], [["command(hc)", "command(npm)"], ["command(gh release)"], []]);
  const bad = normalizeAgyPermissions({ allow: ["command(hc)", "nope"], deny: "command(git)", extra: 1 });
  assert.deepEqual(bad.allow, ["command(hc)"]);
  assert.deepEqual(bad.deny, []);
  assert.equal(bad.problems.length, 3);
  assert.match(bad.problems.join("\n"), /"nope" isn't a rule/);
  assert.match(bad.problems.join("\n"), /deny is not a list/);
  assert.match(bad.problems.join("\n"), /extra isn't allow or deny/);
  assert.match(normalizeAgyPermissions(null).problems[0], /not an object/);
});

test("agyPermissionPlan: a writer seat gets its project's write_file, tools, gates, PR-writing gh verbs and every fixed deny", () => {
  const plan = agyPermissionPlan({ bot: BOT, scope: "seat", folder: SEAT });
  for (const rule of ["command(hc)", "command(git)", "command(node)", "command(bun)", ...WRITER_ONLY_SHELL,
    "command(gh pr view)", "command(gh pr create)", "command(gh pr edit)", "command(gh pr comment)",
    "command(node --test)", "command(node --check)", "command(bun test)", "command(node scripts/privacy-check.mjs)",
    "command(node ../scripts/am-copies.mjs)", `write_file(${SEAT})`]) {
    assert.ok(plan.allow.includes(rule), rule);
  }
  for (const tool of SHELL_READ) assert.ok(plan.allow.includes(`command(${tool})`), `writer allow command(${tool})`);
  for (const bad of FORBIDDEN_SHELL) assert.equal(plan.allow.includes(bad), false, `writer never allows ${bad}`);
  assert.ok(!plan.allow.includes("command(gh pr merge)"), "merge is never allowed by the defaults");
  assert.ok(!plan.allow.includes("command(gh release view)"), "the fixed gh release deny would shadow it");
  for (const rule of AGY_FIXED_DENY) assert.equal(plan.allow.includes(rule), false, `no allow shadowed by ${rule}`);
  assert.deepEqual(plan.deny, [...AGY_FIXED_DENY], "the fixed denies, all of them");
  for (const rule of ["command(git push --force)", "command(git push --force-with-lease)", "command(git push -f)",
    "command(git push origin --force)", "command(git push origin -f)",
    "command(git push --mirror)", "command(git push --delete)", "command(git reset --hard)",
    "command(git branch -D)", "command(git clean)", "command(git rebase)", "command(git stash)",
    "command(git checkout --)", "command(git -C)", "command(rm -rf)", "command(gh pr merge)",
    "command(gh release)"]) assert.ok(plan.deny.includes(rule), rule);
  assert.deepEqual(plan.warnings, []);
});

test("agyPermissionPlan: a reviewer seat and a review worker are read-only: no write_file, no writer shell", () => {
  const seat = agyPermissionPlan({ bot: { ...BOT, rank: "reviewer" }, scope: "seat", folder: SEAT });
  const worker = agyPermissionPlan({ bot: BOT, scope: "worker", role: "review", folder: "/work/wt" });
  for (const plan of [seat, worker]) {
    assert.equal(plan.allow.some((r) => r.startsWith("write_file(")), false, "nothing writable");
    for (const rule of READ_HC_RULES) assert.ok(plan.allow.includes(rule), `read-only hc ${rule}`);
    for (const rule of ["command(hc)", "command(hc run)", "command(hc exec)"]) {
      assert.equal(plan.allow.includes(rule), false, `read-only excludes ${rule}`);
    }
    for (const tool of SHELL_READ) assert.ok(plan.allow.includes(`command(${tool})`), `read-only allow command(${tool})`);
    for (const bad of FORBIDDEN_SHELL) assert.equal(plan.allow.includes(bad), false, `read-only never allows ${bad}`);
    assert.ok(plan.allow.includes("command(git diff)"));
    assert.ok(!plan.allow.includes("command(git)"), "no git subcommand at all");
    assert.ok(!plan.allow.includes("command(node)"), "no generic node");
    for (const rule of WRITER_ONLY_SHELL) {
      assert.equal(plan.allow.includes(rule), false, `no ${rule} on read-only roles`);
    }
    assert.ok(plan.allow.includes("command(node --test)"), "the test runners stay: they read");
    assert.ok(plan.allow.includes("command(bun test)"));
    assert.ok(plan.allow.includes("command(gh pr view)"), "reads stay");
    for (const rule of ["command(gh pr create)", "command(gh pr edit)", "command(gh pr comment)", "command(gh release view)"]) {
      assert.equal(plan.allow.includes(rule), false, `a read-only launch never gets ${rule}`);
    }
    assert.deepEqual(plan.deny, [...AGY_FIXED_DENY]);
  }
  // The writer roles keep write_file, bare command(hc), and the writer-only shell tools; the review role doesn't.
  for (const role of ["dev", "test", "fix"]) {
    const w = agyPermissionPlan({ bot: BOT, scope: "worker", role, folder: "/work/wt" });
    assert.ok(w.allow.includes("write_file(/work/wt)"), role);
    assert.ok(w.allow.includes("command(hc)"), `${role} gets command(hc)`);
    for (const rule of WRITER_ONLY_SHELL) assert.ok(w.allow.includes(rule), `${role} gets ${rule}`);
    for (const tool of SHELL_READ) assert.ok(w.allow.includes(`command(${tool})`), `${role} gets command(${tool})`);
    for (const bad of FORBIDDEN_SHELL) assert.equal(w.allow.includes(bad), false, `${role} excludes ${bad}`);
  }
});

test("AGY_SHELL_READ (#840): 24 read-only shell tools in both default allow lists; writer-only tools and launchers excluded", () => {
  assert.deepEqual(AGY_SHELL_READ, SHELL_READ);
  assert.ok(AGY_WRITE_ALLOW.includes("command(hc)"));
  for (const rule of READ_HC_RULES) assert.ok(AGY_READ_ALLOW.includes(rule), `AGY_READ_ALLOW includes ${rule}`);
  for (const rule of ["command(hc)", "command(hc run)", "command(hc exec)"]) {
    assert.equal(AGY_READ_ALLOW.includes(rule), false, `AGY_READ_ALLOW excludes ${rule}`);
  }
  for (const tool of SHELL_READ) {
    assert.ok(AGY_WRITE_ALLOW.includes(`command(${tool})`), `AGY_WRITE_ALLOW includes command(${tool})`);
    assert.ok(AGY_READ_ALLOW.includes(`command(${tool})`), `AGY_READ_ALLOW includes command(${tool})`);
  }
  for (const bad of FORBIDDEN_SHELL) {
    assert.equal(AGY_WRITE_ALLOW.includes(bad), false, `AGY_WRITE_ALLOW excludes ${bad}`);
    assert.equal(AGY_READ_ALLOW.includes(bad), false, `AGY_READ_ALLOW excludes ${bad}`);
  }
  for (const rule of WRITER_ONLY_SHELL) {
    assert.ok(AGY_WRITE_ALLOW.includes(rule), `AGY_WRITE_ALLOW includes ${rule}`);
    assert.equal(AGY_READ_ALLOW.includes(rule), false, `AGY_READ_ALLOW excludes ${rule}`);
  }
});

test("README (#840): Antigravity permission caveat documents writer-only tools, prefix caveats, pipeline checks on agy 1.5.3, and read-only hc subcommands", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /sed -n.*GNU `sed`'s `e` command.*`w` command.*`-i`/s);
  assert.match(readme, /`rg --pre`/);
  assert.match(readme, /`sort --compress-program`/);
  assert.match(readme, /`sort -o`/);
  assert.match(readme, /`uniq IN OUT`/);
  assert.match(readme, /`echo`\/`printf` with a shell redirection/);
  assert.match(readme, /observed on\s+`agy 1\.5\.3`, not documented by agy/);
  assert.match(readme, /`hc ls`, `hc get`, `hc read`, `hc wait`, and `hc send`.*`hc run` and\s+`hc exec` are not allowed on read-only roles/s);
});

test("agySettingsPlan: a roster allow identical to a fixed deny never cancels the deny", () => {
  const bot = { ...BOT, agyPermissions: { allow: ["command(git stash)", "command(git clean)"], deny: [] } };
  const plan = agySettingsPlan({ bot, scope: "seat", folder: SEAT, settingsDir: SETTINGS });
  const data = JSON.parse(plan.text).permissions;
  for (const rule of ["command(git stash)", "command(git clean)"]) {
    assert.ok(data.deny.includes(rule), `the fixed deny stays: ${rule}`);
    assert.ok(data.allow.includes(rule), "the roster's allow is carried beside it (agy's deny still wins)");
  }
});

test("agyPermissionPlan: the roster adds rules and can never drop a fixed deny", () => {
  const bot = { ...BOT, agyPermissions: { allow: ["command(npm publish)", "command(hc)", "command(gh release)"], deny: ["command(git stash)", "command(gh release)"] } };
  const plan = agyPermissionPlan({ bot, scope: "seat", folder: SEAT });
  assert.ok(plan.allow.includes("command(npm publish)"), "a roster rule is added");
  assert.equal(plan.allow.filter((r) => r === "command(hc)").length, 1, "a repeated rule is deduped");
  assert.ok(plan.allow.includes("command(gh release)"), "an allow can't drop a fixed deny (agy's deny wins)");
  assert.ok(plan.deny.includes("command(git stash)"), "a roster deny is added");
  assert.deepEqual(plan.deny.filter((r) => r === "command(gh release)").length, 1);
  for (const rule of AGY_FIXED_DENY) assert.ok(plan.deny.includes(rule), `kept ${rule}`);
});

test("agyPermissionPlan: a folder a rule can't hold leaves the write_file out with a plain warning", () => {
  const plan = agyPermissionPlan({ bot: BOT, scope: "worker", role: "dev", folder: "/work/a)b" });
  assert.equal(plan.allow.some((r) => r.startsWith("write_file(")), false);
  assert.match(plan.warnings.join("\n"), /Genie: .*can't hold/);
});

test("agySettingsFile: deterministic from the bot, scope, role and worktree; the folder's slash isn't doubled", () => {
  const seat = agySettingsFile(`${SETTINGS}/`, BOT.id);
  assert.equal(seat, `${SETTINGS}/${BOT.id}-seat.json`);
  assert.equal(agySettingsFile(SETTINGS, BOT.id, "seat"), seat, "same inputs, same path");
  const one = agySettingsFile(SETTINGS, BOT.id, "worker", "dev", "/work/a");
  assert.equal(agySettingsFile(SETTINGS, BOT.id, "worker", "dev", "/work/a"), one, "a restart of the same worker names the same file");
  assert.notEqual(agySettingsFile(SETTINGS, BOT.id, "worker", "dev", "/work/b"), one, "another worktree, another file");
  assert.notEqual(agySettingsFile(SETTINGS, BOT.id, "worker", "review", "/work/a"), one, "another role, another file");
  assert.ok(!one.includes("/work/a"), "the worktree is a tag, not a path in the name");
});

test("agySettingsPlan: the JSON agy reads, both arrays in full, private path under the app home", () => {
  const bot = { ...BOT, agyPermissions: { allow: ["command(npm publish)"], deny: [] } };
  const plan = agySettingsPlan({ bot, scope: "seat", folder: SEAT, settingsDir: SETTINGS });
  assert.equal(plan.path, agySettingsFile(SETTINGS, bot.id));
  const data = JSON.parse(plan.text);
  assert.deepEqual(Object.keys(data), ["permissions"]);
  assert.deepEqual(Object.keys(data.permissions), ["allow", "deny"]);
  assert.ok(data.permissions.allow.includes("command(npm publish)"));
  assert.ok(data.permissions.allow.includes(`write_file(${SEAT})`));
  assert.deepEqual(data.permissions.deny, [...AGY_FIXED_DENY]);
  assert.equal(plan.allow.length, data.permissions.allow.length);
  assert.equal(agySettingsPlan({ bot: BOT, settingsDir: null }), null, "no folder, no file");
  assert.equal(agySettingsPlan({ bot: { name: "no id" }, settingsDir: SETTINGS }), null);
});

test("agySettingsArgs, withoutAgySettings, withAgySettings: only agy changes, right after its program", () => {
  const path = "/app/automagik-herdr/agy-settings/b-seat.json";
  assert.deepEqual(agySettingsArgs("antigravity", path), ["--settings", path]);
  assert.deepEqual(agySettingsArgs("claude", path), []);
  assert.deepEqual(agySettingsArgs("antigravity", null), []);
  assert.deepEqual(withoutAgySettings("antigravity", ["agy", "--mode", "auto", "--settings", "/old.json", "-i", "t"]),
    ["agy", "--mode", "auto", "-i", "t"]);
  assert.deepEqual(withoutAgySettings("antigravity", ["agy", "--settings=/old.json", "--continue"]), ["agy", "--continue"]);
  assert.deepEqual(withoutAgySettings("claude", ["claude", "--settings", "x"]), ["claude", "--settings", "x"], "not agy's flag");
  assert.deepEqual(withAgySettings("antigravity", ["agy", "--mode", "auto", "--continue"], path),
    ["agy", "--settings", path, "--mode", "auto", "--continue"]);
  assert.deepEqual(withAgySettings("antigravity", ["agy", "--settings", "/old.json", "--mode", "plan"], path),
    ["agy", "--settings", path, "--mode", "plan"], "the old file is replaced, never doubled");
  const claude = ["claude", "--model", "m"];
  assert.deepEqual(withAgySettings("claude", claude, path), claude, "another agent's launch line is byte-identical");
  assert.deepEqual(withAgySettings("antigravity", ["sh", "-c", "agy --mode auto"], path), ["sh", "-c", "agy --mode auto"],
    "a shell command is left to its own builder");
});

test("agySandbox: Linux restrictions are a warning, unknown evidence only a note, other platforms unknown", () => {
  const read = (map) => (path) => (path in map ? map[path] : null);
  const clone = "/proc/sys/kernel/unprivileged_userns_clone";
  const max = "/proc/sys/user/max_user_namespaces";
  const apparmor = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
  assert.equal(agySandbox({ platform: "linux", read: read({ [max]: "0\n" }) }).state, "missing");
  assert.equal(agySandbox({ platform: "linux", read: read({ [clone]: "0" }) }).state, "missing");
  assert.equal(agySandbox({ platform: "linux", read: read({ [apparmor]: "1\n" }) }).state, "missing");
  const open = agySandbox({ platform: "linux", read: read({ [max]: "15000\n", [apparmor]: "0\n" }) });
  assert.equal(open.state, "available");
  assert.match(open.detail, /not restricted/);
  const unknown = agySandbox({ platform: "linux", read: (path) => (path === max ? "15000" : undefined) });
  assert.equal(unknown.state, "unknown", "some controls unreadable, none restricted: a note");
  assert.equal(agySandbox({ platform: "linux", read: () => undefined }).state, "missing", "every control unreadable is evidence");
  assert.equal(agySandbox({ platform: "darwin", read: read({ "/usr/bin/sandbox-exec": "Mach-O" }) }).state, "available");
  assert.equal(agySandbox({ platform: "darwin", read: () => null }).state, "missing");
  assert.equal(agySandbox({ platform: "darwin", read: () => undefined }).state, "unknown");
  assert.equal(agySandbox({ platform: "win32", read: () => null }).state, "unknown");
  assert.equal(agySandbox({ platform: "linux", read: () => { throw new Error("nope"); } }).state, "missing",
    "a read that throws is unreadable evidence");
});

test("parseBots and checkBots: agyPermissions is normalized on load, refused by name on a save", () => {
  const text = JSON.stringify({ version: 1, categories: [], bots: [{ id: BOT.id, name: "A", kind: "main",
    look: { character: "star", colour: "blue" }, role: "", instructions: "", agent: "antigravity",
    agyPermissions: { allow: [" command(npm) ", "nope"], deny: ["command(git stash)"] } }] });
  const parsed = parseBots(text);
  assert.deepEqual(parsed.file.bots[0].agyPermissions, { allow: ["command(npm)"], deny: ["command(git stash)"] });
  assert.match(parsed.warnings.join("\n"), /agyPermissions: "nope" isn't a rule/);
  const empty = parseBots(JSON.stringify({ version: 1, categories: [], bots: [{ ...parsed.file.bots[0], agyPermissions: { allow: [] } }] }));
  assert.equal(empty.file.bots[0].agyPermissions, undefined, "no rules at all: no field");
  const badShape = parseBots(JSON.stringify({ version: 1, categories: [], bots: [{ ...parsed.file.bots[0], agyPermissions: "yolo" }] }));
  assert.equal(badShape.file.bots[0].agyPermissions, undefined);
  assert.match(badShape.warnings.join("\n"), /agyPermissions is not an object/);
  assert.deepEqual(checkBots(parsed.file), []);
  const errors = checkBots({ ...parsed.file, bots: [{ ...parsed.file.bots[0], agyPermissions: { allow: ["nope"], exec: [] } }] });
  assert.match(errors.join("\n"), /agyPermissions allow: "nope" isn't a rule/);
  assert.match(errors.join("\n"), /agyPermissions exec isn't allow or deny/);
});

test("restartPlan with the launch's file: --settings on the agent's row, its text in agySettings", () => {
  const bot = { id: BOT.id, agent: "antigravity", rank: "dev", agyPermissions: { allow: ["command(npm)"], deny: [] } };
  const plan = restartPlan({ bot, run: ["agy"], runningAgent: "antigravity", session: null, agy: { appHomeDir: APP, folder: SEAT } });
  const path = agySettingsFile(SETTINGS, BOT.id);
  assert.deepEqual(plan.argv, ["agy", "--mode", "auto", "--settings", path, "--continue"]);
  assert.equal(plan.agySettings.path, path);
  assert.deepEqual(plan.source, ["agy", "--mode", "auto"], "the comparison source names no settings file");
  assert.deepEqual(JSON.parse(plan.agySettings.text).permissions.allow.includes("command(npm)"), true);
  const claude = restartPlan({ bot: { agent: "claude" }, run: ["claude"], runningAgent: "claude" });
  assert.deepEqual(claude.argv, ["claude", "--continue"], "another agent's line is untouched");
  assert.equal(claude.agySettings, null);
});

test("helperPlan with the launch's file: a worker gets its worktree rule and file, a reused command's old file is replaced", () => {
  const agents = { antigravity: { run: ["agy"] } };
  const bot = { id: BOT.id, name: "Genie", agent: "antigravity", rank: "dev" };
  const worker = helperPlan({ get: { address: "t7", name: "w", cwd: SEAT, labels: { "worker.of": BOT.id, "worker.role": "dev" } },
    worker: { botId: BOT.id, worktree: SEAT, agent: "antigravity" }, session: null, agents,
    agy: { appHomeDir: APP, bot } });
  const path = agySettingsFile(SETTINGS, BOT.id, "worker", "dev", SEAT);
  assert.deepEqual(worker.argv, ["agy", "--mode", "auto", "--settings", path, "--continue"]);
  assert.equal(worker.agySettings.path, path);
  assert.ok(JSON.parse(worker.agySettings.text).permissions.allow.includes(`write_file(${SEAT})`));
  // A non-worker pane's command is reused, its older permission file replaced, never doubled.
  const old = ["agy", "--mode", "plan", "--settings", "/old.json", "--continue"];
  const pane = helperPlan({ get: { address: "t9", name: "p", cwd: SEAT, argv: old, foreground: { argv: old } },
    session: null, agents, agy: { appHomeDir: APP, bot } });
  assert.deepEqual(pane.argv, ["agy", "--mode", "plan", "--settings", agySettingsFile(SETTINGS, BOT.id, "helper", null, SEAT), "--continue"]);
  assert.equal(pane.agySettings.path, agySettingsFile(SETTINGS, BOT.id, "helper", null, SEAT), "its own file, never the seat's");
  // A shell template that can't take words runs without the list, and the note says so.
  const shell = ["sh", "-c", "agy --mode auto; # no words"];
  const broken = helperPlan({ get: { address: "t10", name: "t", cwd: SEAT, argv: shell, foreground: { argv: ["agy"] } },
    session: null, agents, fresh: null, agy: { appHomeDir: APP, bot } });
  assert.equal(broken.agySettings, null);
  assert.equal(broken.argv.includes("--settings"), false);
  assert.match(broken.note, /permission list/);
});

test("restartPlan: a template that can take the words gets the permission list; one that can't says why and leaves it out", () => {
  const bot = { id: BOT.id, agent: "antigravity" };
  const template = { name: "agy-sol", command: "agy --mode auto" };
  const plan = restartPlan({ bot, run: ["agy"], runningAgent: "antigravity", fresh: true, template, agy: { appHomeDir: APP, folder: SEAT } });
  const path = agySettingsFile(SETTINGS, BOT.id);
  assert.deepEqual(plan.argv, ["sh", "-c", `agy --mode auto "$@"`, "sh", "--settings", path]);
  assert.equal(plan.agySettings.path, path);
  const blocked = restartPlan({ bot, run: ["agy"], runningAgent: "antigravity", fresh: false,
    template: { name: "agy-sol", command: "agy --mode auto; # no words" }, agy: { appHomeDir: APP, folder: SEAT } });
  assert.equal(blocked.agySettings, null);
  assert.ok(!blocked.argv.includes("--settings"));
  assert.match(blocked.note, /separator or a comment.*permission list can't be added/);
});
