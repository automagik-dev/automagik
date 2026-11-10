// Claude logins signed in on this computer (#453, mods/am-quota/docs/local-logins.md): the record
// a launch reads (logins.js), the env words it puts on, and every launch-argv parser fed both
// prefix forms: `/usr/bin/env PATH=… …` (and a login's `CLAUDE_CONFIG_DIR=<dir>` after it) and
// `/usr/bin/env -u CLAUDE_CONFIG_DIR PATH=… …` (the default login). Temp homes only: no real
// login folder, credential or Keychain item is ever read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONFIG_VAR, DEFAULT_WORDS, LOGINS_FILE, chooseLogin, envWords, formProblem, loginsPath, parseLogins } from "../mods/am-sidebar/logins.js";
import { agentArgv, agentKeyOfArgv, briefingFileOf, briefingLaunch, detectModel, resumedSessionOf, withBriefing } from "../mods/am-sidebar/models.js";
import { helperArgs, helperPlan, launchChange, paneCommand, restartPlan } from "../mods/am-sidebar/restart.js";
import { startArgs } from "../mods/am-sidebar/launchArgs.js";
import { AGENTS as TABLE } from "../mods/am-sidebar/models.js";
import { KILL_GUARD_DIR, workerArgs } from "../mods/am-sidebar/workers.js";
import { command } from "../mods/am-sidebar/argv.js";

const ENV = "/usr/bin/env";

/** A scratch world: a home with its default folder, an app home, a login folder in the form rule. */
function world(t) {
  // realpath first: the Mac's tmpdir is /var/folders, a link to /private/var, and the form rule
  // refuses a folder reached through a link. The rule is not loosened for the tests.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-logins-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), app = join(root, "app"), two = join(root, "home", ".claude-2");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(two);
  mkdirSync(app);
  const io = { read: (p) => readFileSync(p, "utf8"), realpath: realpathSync, isDir: (p) => statSync(p).isDirectory(), home };
  const record = (data) => writeFileSync(loginsPath(app), typeof data === "string" ? data : JSON.stringify(data));
  return { root, home, app, two, io, record, choose: () => chooseLogin(app, io) };
}

test("the record lives at the app home's top level, never under a mod's folder", () => {
  assert.equal(loginsPath("/app/"), `/app/${LOGINS_FILE}`);
  assert.equal(LOGINS_FILE, "claude-logins.json");
  assert.deepEqual([...DEFAULT_WORDS], ["-u", CONFIG_VAR]);
});

test("no record, or use default: login A, by unsetting the variable, with no warning", (t) => {
  const w = world(t);
  assert.deepEqual(w.choose(), { id: "default", dir: null, words: ["-u", "CLAUDE_CONFIG_DIR"], warning: null });
  w.record({ use: "default", logins: [{ id: "2", dir: w.two }] });
  assert.deepEqual(w.choose(), { id: "default", dir: null, words: ["-u", "CLAUDE_CONFIG_DIR"], warning: null });
});

test("use names a listed login whose folder is in the form rule: CLAUDE_CONFIG_DIR=<that folder>", (t) => {
  const w = world(t);
  w.record({ use: "2", logins: [{ id: "2", dir: w.two }] });
  assert.deepEqual(w.choose(), { id: "2", dir: w.two, words: [`CLAUDE_CONFIG_DIR=${w.two}`], warning: null });
});

test("a record that can't be followed starts on login A with a warning naming the problem, never a refusal", (t) => {
  const w = world(t);
  const linked = join(w.root, "link");
  symlinkSync(join(w.root, "home"), linked);
  const cases = [
    ["{ not json", /is not valid JSON/],
    [[], /is not a record/],
    [{ logins: [] }, /has no use/],
    [{ use: "2" }, /has no logins list/],
    [{ use: "2", logins: [{ id: "2", dir: w.two }, { id: "2", dir: w.two }] }, /lists login 2 twice/],
    [{ use: "2", logins: [{ id: "default", dir: w.two }] }, /a login entry this CLI can't read/],
    [{ use: "3", logins: [{ id: "2", dir: w.two }] }, /use names 3 that it doesn't list/],
    [{ use: "2", logins: [{ id: "2", dir: `${w.two}/` }] }, /not in the form launches use/],
    [{ use: "2", logins: [{ id: "2", dir: "~/.claude-2" }] }, /not an absolute path/],
    [{ use: "2", logins: [{ id: "2", dir: "relative/.claude-2" }] }, /not an absolute path/],
    [{ use: "2", logins: [{ id: "2", dir: `${w.home}/./.claude-2` }] }, /not in the form launches use/],
    [{ use: "2", logins: [{ id: "2", dir: join(w.home, ".claude-9") }] }, /does not exist/],
    [{ use: "2", logins: [{ id: "2", dir: join(linked, ".claude-2") }] }, /goes through a symlink/],
    [{ use: "2", logins: [{ id: "2", dir: join(w.home, ".claude") }] }, /the default login's own folder/],
  ];
  for (const [data, problem] of cases) {
    w.record(data);
    const got = w.choose();
    assert.deepEqual(got.words, ["-u", "CLAUDE_CONFIG_DIR"], JSON.stringify(data));
    assert.match(got.warning, /^claude-logins\.json: /);
    assert.match(got.warning, problem, JSON.stringify(data));
    assert.match(got.warning, /; started on the default login$/);
  }
  // A folder that is a file is no login folder either.
  writeFileSync(join(w.home, ".claude-3"), "");
  w.record({ use: "3", logins: [{ id: "3", dir: join(w.home, ".claude-3") }] });
  assert.match(w.choose().warning, /is not a folder/);
  // Unreadable (here a folder in its place): login A, with the read's own code.
  rmSync(loginsPath(w.app));
  mkdirSync(loginsPath(w.app));
  assert.deepEqual(w.choose().words, ["-u", "CLAUDE_CONFIG_DIR"]);
  assert.match(w.choose().warning, /can't be read \(EISDIR\)/);
});

test("formProblem and parseLogins on their own", () => {
  const io = { realpath: (p) => p, isDir: () => true, home: "/home/you" };
  assert.equal(formProblem("/home/you/.claude-2", io), null);
  assert.match(formProblem("/", io), /not in the form/);
  assert.match(formProblem("/home/you//.claude-2", io), /not in the form/);
  assert.match(formProblem("", io), /has no folder/);
  assert.match(formProblem("/home/you/.claude", io), /default login's own folder/);
  assert.deepEqual(parseLogins('{"use":"default","logins":[]}'), { use: "default", logins: [] });
  assert.deepEqual(parseLogins('{"use":"2","logins":[{"id":"2","dir":"/home/you/.claude-2","extra":1}]}'),
    { use: "2", logins: [{ id: "2", dir: "/home/you/.claude-2" }] }, "only id and dir are kept");
});

test("envWords: an unset goes first (env takes options before assignments), an assignment last", () => {
  assert.deepEqual(envWords(["PATH=/a", "X=1"], ["-u", CONFIG_VAR]), ["-u", CONFIG_VAR, "PATH=/a", "X=1"]);
  assert.deepEqual(envWords(["PATH=/a", "X=1"], [`${CONFIG_VAR}=/home/you/.claude-2`]), ["PATH=/a", "X=1", `${CONFIG_VAR}=/home/you/.claude-2`]);
  assert.deepEqual(envWords(["PATH=/a"]), ["PATH=/a"]);
  assert.deepEqual(envWords([], ["-u", CONFIG_VAR]), ["-u", CONFIG_VAR]);
  assert.deepEqual(envWords(), []);
});

// ---- every launch-argv parser, both prefix forms ----

const DIR = "/home/you/.claude-2";
const BRIEF = "/home/you/.config/herdr-app/automagik-herdr/briefings/b.md";
const AGENT = ["claude", "--model", "opus", "--append-system-prompt-file", BRIEF, "--resume", "0b6c1f43-3b0e-4f6e-9d1c-2a8e5b7f9c10"];
const FORMS = {
  "old (PATH only)": [ENV, "PATH=/a:/b", ...AGENT],
  "login A (-u first)": [ENV, "-u", CONFIG_VAR, "PATH=/a:/b", ...AGENT],
  "login 2 (assignment last)": [ENV, "PATH=/a:/b", `${CONFIG_VAR}=${DIR}`, ...AGENT],
  "--unset form": [ENV, "--unset", CONFIG_VAR, "PATH=/a:/b", ...AGENT],
};

test("programAt (agentArgv, agentKeyOfArgv): env's -u NAME takes the next word, so claude is the program in every form", () => {
  for (const [form, argv] of Object.entries(FORMS)) {
    assert.deepEqual(agentArgv(argv), { program: "claude", args: AGENT.slice(1) }, form);
    assert.equal(agentKeyOfArgv(argv), "claude", form);
  }
  assert.equal(agentKeyOfArgv([ENV, "-u", CONFIG_VAR, "PATH=/a", "codex", "-m", "g"]), "codex");
});

test("the model, briefing and resume readers see through both forms", () => {
  for (const [form, argv] of Object.entries(FORMS)) {
    assert.equal(detectModel(argv, "claude"), "opus", form);
    assert.equal(detectModel(argv), "opus", `${form}, agent read from the argv`);
    assert.equal(briefingFileOf(argv), BRIEF, form);
    assert.equal(resumedSessionOf("claude", argv), "0b6c1f43-3b0e-4f6e-9d1c-2a8e5b7f9c10", form);
    const fresh = "/home/you/.config/herdr-app/automagik-herdr/briefings/c.md";
    const out = withBriefing("claude", argv, briefingLaunch("claude", { path: fresh }));
    const at = out.indexOf("claude");
    assert.deepEqual(out.slice(0, at), argv.slice(0, argv.indexOf("claude")), `${form}: the prefix kept as it was`);
    assert.deepEqual(out.slice(at + 1, at + 3), ["--append-system-prompt-file", fresh], `${form}: the briefing right after claude`);
    assert.equal(out.filter((x) => x === BRIEF).length, 0, `${form}: the old briefing taken out`);
  }
});

test("paneCommand drops this pack's prefix in every form, a template worker's login prefix too; someone else's env stays", () => {
  for (const [form, argv] of Object.entries(FORMS)) {
    if (form === "--unset form") continue; // never written by this pack
    assert.deepEqual(paneCommand({ argv }), { argv: AGENT }, form);
  }
  assert.deepEqual(paneCommand({ argv: [ENV, "-u", CONFIG_VAR, "sh", "-c", 'claude --x "$@"', "sh", "fix it"] }), { shell: "claude --x" });
  assert.deepEqual(paneCommand({ argv: [ENV, `${CONFIG_VAR}=${DIR}`, "sh", "-c", 'claude --x "$@"', "sh", "fix it"] }), { shell: "claude --x" });
  assert.deepEqual(paneCommand({ argv: [ENV, "-u", "OTHER", "claude"] }), { argv: [ENV, "-u", "OTHER", "claude"] }, "not ours");
  assert.deepEqual(paneCommand({ argv: [ENV, "claude"] }), { argv: [ENV, "claude"] }, "a bare env stays as it was");
});

test("restartPlan and helperPlan take the agent through paneCommand in the -u form", () => {
  const get = { address: "t5", cwd: "/r", foreground: { argv: AGENT }, argv: FORMS["login A (-u first)"] };
  const bot = { id: "b-aaaaaaaaaa", name: "Dev", agent: "claude", model: "opus" };
  const plan = restartPlan({ bot, run: ["claude"], runningAgent: "claude", session: "0b6c1f43-3b0e-4f6e-9d1c-2a8e5b7f9c10", launch: paneCommand(get) });
  assert.equal(plan.argv[0], "claude", "Restart runs claude, never env");
  assert.ok(!plan.argv.includes("-u") && !plan.argv.includes(CONFIG_VAR));
  // The source's pin is the model, and the pane's model agrees: nothing differs (#597).
  assert.deepEqual(plan.source, ["claude", "--model", "opus"]);
  assert.equal(launchChange({ name: "Dev", launch: paneCommand(get), agent: "claude", argv: plan.source }), null);
  const helper = helperPlan({ get, agents: TABLE });
  assert.equal(helper.agent, "claude");
  assert.equal(helper.argv[0], "claude");
  assert.ok(!helper.argv.some((x) => x === "-u" || String(x).startsWith(`${CONFIG_VAR}=`)));
});

test("the launch builders put the login words on: start, a --tree helper, a worker, a Claude template worker", () => {
  const login2 = [`${CONFIG_VAR}=${DIR}`];
  const loginA = ["-u", CONFIG_VAR];
  const tail = (args) => args.slice(args.indexOf("--") + 1);
  const start = (login) => tail(startArgs({ botId: "b-aaaaaaaaaa", cwd: "/r", parent: ["--no-parent"], argv: ["claude"], path: "/a", env: { X: "1" }, login }));
  assert.deepEqual(start(loginA), [ENV, "-u", CONFIG_VAR, "PATH=/a", "X=1", "claude"]);
  assert.deepEqual(start(login2), [ENV, "PATH=/a", "X=1", `${CONFIG_VAR}=${DIR}`, "claude"]);
  assert.deepEqual(start(undefined), [ENV, "PATH=/a", "X=1", "claude"], "no login words: as before");

  const helper = (login, argv = ["claude", "--continue"]) => tail(helperArgs({ cwd: "/r", parent: "t1", argv, path: "/a", login }));
  assert.deepEqual(helper(loginA), [ENV, "-u", CONFIG_VAR, "PATH=/a", "claude", "--continue"]);
  assert.deepEqual(helper(login2, ["sh", "-c", 'claude "$@"', "sh", "--continue"]), [ENV, "PATH=/a", `${CONFIG_VAR}=${DIR}`, "sh", "-c", 'claude "$@"', "sh", "--continue"]);

  const base = { botId: "b-aaaaaaaaaa", branch: "feat/x", name: "x", cwd: "/r", parent: "t1", agent: "claude", argv: ["claude"], task: "fix it", path: "/a" };
  assert.deepEqual(tail(workerArgs({ ...base, login: loginA })), [ENV, "-u", CONFIG_VAR, `PATH=${KILL_GUARD_DIR}:/a`, "claude", "fix it"]);
  assert.deepEqual(tail(workerArgs({ ...base, login: login2 })), [ENV, `PATH=${KILL_GUARD_DIR}:/a`, `${CONFIG_VAR}=${DIR}`, "claude", "fix it"]);
  const tpl = workerArgs({ ...base, agent: null, argv: null, template: "opus-rev", login: login2,
    templateArgv: ["sh", "-c", 'claude --model opus "$@"', "sh", "fix it"] });
  assert.ok(tpl.includes("worker.template=opus-rev"), "the template label kept");
  assert.deepEqual(tail(tpl), [ENV, `${CONFIG_VAR}=${DIR}`, "sh", "-c", 'claude --model opus "$@"', "sh", "fix it"]);
  const codexTpl = workerArgs({ ...base, agent: null, argv: null, template: "dev-sol" });
  assert.deepEqual(codexTpl.slice(-2), ["dev-sol", "fix it"], "a template that doesn't run Claude: hc's own form, unchanged");
  assert.equal(codexTpl.includes("--"), false);
});

test("argv.js command(): looks through env's -i and -u NAME to the program; another option stays env (#453 review, Low 4)", () => {
  assert.equal(command([ENV, ...DEFAULT_WORDS, "PATH=/bin", "hermes", "chat"]), "hermes");
  assert.equal(command([ENV, "PATH=/bin", `${CONFIG_VAR}=/x/.claude-2`, "claude"]), "claude");
  assert.equal(command([ENV, "--unset", CONFIG_VAR, "-i", "--unset=A", "-uB", "PATH=/bin", "/opt/hermes"]), "hermes");
  assert.equal(command([ENV, "-S", "hermes"]), "env");
  assert.equal(command([ENV, "-u"]), "env");
  assert.equal(command(["hermes"]), "hermes");
});
