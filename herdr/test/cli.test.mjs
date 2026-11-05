// automagik-herdr, the command line (A11): every subcommand run as a program against scratch git
// projects under $TMPDIR, with a fake `hc` first on PATH (test/fake-hc.mjs) that records
// each call and answers from a state file, and a fake `herdr-app` (test/fake-herdr-app.mjs; no
// window unless a test opens one). The real hc and window are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkBots, parseBots } from "../mods/am-sidebar/model.js";
import { writeBotsFile, findBot, CliError, listProject } from "../mods/am-sidebar/bin/automagik-herdr.mjs";
import { ledgerPath, readLedger } from "../mods/am-sidebar/workers.js";
import { withoutBriefing } from "../mods/am-sidebar/models.js";
import { restartAnswer } from "../mods/am-sidebar/restart.js";
// Start and Restart put each bot's briefing in its agent's command (models.js withBriefing);
// the tests on the rest of the command compare it with those words out.
const strip = (words) => withoutBriefing("codex", withoutBriefing("claude", words));
const plain = (argv) => { const i = argv.indexOf("--"); return i < 0 ? strip(argv) : [...argv.slice(0, i + 1), ...strip(argv.slice(i + 1))]; };
import { attachPath as attachFile, foldAttach as foldRows, readAttach as readRows } from "../mods/am-sidebar/attach.js";

const CLI = new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url).pathname;
// AUTOMAGIK_HERDR_TEST_RUNTIME=<bun or node path> runs the CLI with that runtime instead.
const RUNTIME = process.env.AUTOMAGIK_HERDR_TEST_RUNTIME || process.execPath;
const FAKE_HC = new URL("./fake-hc.mjs", import.meta.url).pathname;
const FAKE_APP = new URL("./fake-herdr-app.mjs", import.meta.url).pathname;
const ID = { main: "b-aaaaaaaaaa", cap: "b-bbbbbbbbbb", dev: "b-cccccccccc", plan: "b-eeeeeeeeee" };

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };

/** A scratch world: a git project, a fake hc, a fake home and app home. */
function scene(t, { terminals = [], briefing = true, window = { down: true } } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hb-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "proj");
  mkdirSync(project);
  git(project, "init", "-q");
  git(project, "commit", "-q", "--allow-empty", "-m", "start");
  const bin = join(root, "bin");
  mkdirSync(bin);
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  exe(join(bin, "herdr-app"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_APP}" "$@"\n`);
  exe(join(bin, "claude"), "#!/bin/sh\nexit 0\n");
  exe(join(bin, "codex"), "#!/bin/sh\nexit 0\n");
  const home = join(root, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ model: "sonnet" }));
  const app = join(root, "app");
  mkdirSync(join(app, "mods/am-sidebar"), { recursive: true });
  if (briefing) writeFileSync(join(app, "mods/am-sidebar/briefing.mjs"), "// stand-in\n");
  const statePath = join(root, "hc.json");
  const logPath = join(root, "hc.log");
  writeFileSync(statePath, JSON.stringify({ terminals, next: 100 }));
  writeFileSync(logPath, "");
  const appState = join(root, "herdr-app.json"), appLog = join(root, "herdr-app.log");
  writeFileSync(appState, JSON.stringify(window));
  writeFileSync(appLog, "");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, HERDR_APP_HOME: app, HC_FAKE_STATE: statePath, HC_FAKE_LOG: logPath,
    HERDR_APP_FAKE_STATE: appState, HERDR_APP_FAKE_LOG: appLog, AUTOMAGIK_HERDR_TAB_WAIT_MS: "300" };
  delete env.HC_TERMINAL_ID;
  delete env.HERMES_HOME; // a runner's own hermes home must not decide the hermes tests
  const cli = (args, { cwd = project, input, env: extra = {} } = {}) => {
    const r = spawnSync(RUNTIME, [CLI, ...args], { cwd, env: { ...env, ...extra }, input, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  const calls = () => readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const hcState = () => JSON.parse(readFileSync(statePath, "utf8"));
  const appCalls = () => readFileSync(appLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const windowNow = () => JSON.parse(readFileSync(appState, "utf8"));
  const botsPath = join(project, ".herdr/bots.json");
  const bots = () => JSON.parse(readFileSync(botsPath, "utf8"));
  const seed = (file) => { mkdirSync(join(project, ".herdr"), { recursive: true }); writeFileSync(botsPath, `${JSON.stringify(file, null, 2)}\n`); };
  return { root, project, app, home, cli, calls, hcState, appCalls, windowNow, bots, botsPath, seed };
}

const bot = (id, kind, extra = {}) => ({ id, name: `Bot ${id.slice(2, 4)}`, kind, look: { character: "star", colour: "blue" }, role: "r", instructions: "i", agent: "claude", ...extra });
const team = (extra = {}) => ({
  version: 1,
  categories: [{ id: "eng", title: "Engineering" }],
  bots: [
    bot(ID.main, "main", { name: "Genie" }),
    bot(ID.cap, "member", { name: "Captain", category: "eng" }),
    bot(ID.dev, "member", { name: "Dev", lead: ID.cap }),
    bot(ID.plan, "member", { name: "Studio", agent: undefined, planned: { wave: 3, note: "later" } }),
  ],
  ...extra,
});
/** An `hc get` answer for a terminal. */
const term = (address, { bot: b, argv = ["claude"], cwd = "/x", app = "claude-code", state = "live", created = 1, parent = null, msg, status = "idle" } = {}) => ({
  address, name: address, cwd, state, parent, created_ms: created, labels: b ? { bot: b } : {},
  foreground: { argv, cwd }, status: { app, state: status, ...(msg ? { msg } : {}) },
});
const runCall = (calls) => calls.find((c) => c[0] === "run");
/** What an hc run call runs: the words after `--`, past the `/usr/bin/env PATH=…` every pane gets (#213). */
const agentWords = (run) => {
  const w = run.slice(run.indexOf("--") + 1);
  return w[0] === "/usr/bin/env" && w[1]?.startsWith("PATH=") ? w.slice(2) : w;
};
const labelCalls = (calls) => calls.filter((c) => c[0] === "label");

// ---- create ----

test("create: the first bot must be main; then the main bot is written with an id, a default look and the agent", (t) => {
  const s = scene(t);
  const refused = s.cli(["create", "--name", "Dev", "--agent", "claude", "--kind", "member"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /first bot in a project must be its main bot/);
  assert.equal(existsSync(s.botsPath), false, "nothing written");
  const made = s.cli(["create", "--name", "Genie", "--agent", "claude", "--role", "runs the team"]);
  assert.equal(made.code, 0, made.err);
  const id = made.out.trim();
  assert.match(id, /^b-[a-z2-7]{10}$/);
  const file = s.bots();
  assert.deepEqual(checkBots(file), []);
  assert.equal(file.bots[0].id, id);
  assert.equal(file.bots[0].kind, "main");
  assert.equal(file.bots[0].role, "runs the team");
  assert.equal(file.bots[0].instructions, "");
  assert.ok(file.bots[0].look.character && file.bots[0].look.colour);
  // A second bot defaults to member; a second main is refused.
  assert.equal(s.cli(["create", "--name", "Two", "--agent", "codex"]).code, 0);
  assert.equal(s.bots().bots[1].kind, "member");
  const twoMains = s.cli(["create", "--name", "Three", "--agent", "claude", "--kind", "main"]);
  assert.equal(twoMains.code, 1);
  assert.match(twoMains.err, /already has a main bot, Genie/);
});

// #234, RFC 0014 Q16: an edit made from a worktree is written in that worktree, so the main
// checkout stays clean for the merge's git pull; reads (ls, the project key) stay on the main checkout.
test("create and edit from a worktree write that worktree's file; the main checkout stays clean and is still what ls reads", (t) => {
  const s = scene(t);
  s.seed(team());
  git(s.project, "add", ".herdr/bots.json");
  git(s.project, "commit", "-q", "-m", "bots");
  const mainText = readFileSync(s.botsPath, "utf8");
  const wt = join(s.root, "wt");
  git(s.project, "worktree", "add", "-q", wt);
  const wtPath = join(wt, ".herdr/bots.json");
  const wtBots = () => JSON.parse(readFileSync(wtPath, "utf8")).bots;
  // From the worktree's folder (a subfolder of it too): its file, the project still the main checkout.
  mkdirSync(join(wt, "src"));
  const r = s.cli(["create", "--name", "Scout", "--agent", "claude", "--lead", ID.cap, "--json"], { cwd: join(wt, "src") });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().project, s.project);
  assert.match(r.err, new RegExp(`saved in ${wtPath}.*read ${s.botsPath}`));
  const scout = r.json().id;
  assert.deepEqual(wtBots().map((b) => b.name), ["Genie", "Captain", "Dev", "Studio", "Scout"]);
  assert.equal(readFileSync(s.botsPath, "utf8"), mainText, "the main checkout's file is untouched");
  assert.equal(git(s.project, "status", "--porcelain"), "", "the main checkout stays clean for git pull");
  // Reads stay on the main checkout: ls from the worktree shows its file, without Scout.
  const ls = s.cli(["ls", "--json"], { cwd: wt }).json().projects[0];
  assert.equal(ls.project, s.project);
  assert.ok(!ls.bots.some((b) => b.id === scout));
  // show and start read the main checkout, which hasn't Scout yet: the refusal names both files.
  for (const cmd of ["show", "start"]) {
    const no = s.cli([cmd, scout], { cwd: wt });
    assert.equal(no.code, 1, `${cmd}: ${no.err}`);
    assert.match(no.err, new RegExp(`No bot "${scout}" in ${s.botsPath}, which this command reads; it is in ${wtPath} \\(this worktree\\)`));
  }
  assert.equal(git(s.project, "status", "--porcelain"), "", "the main checkout stays clean");
  // A second edit from the same worktree starts from (and checks) the worktree's file: Scout is kept.
  const e = s.cli(["edit", scout, "--role", "scouting"], { cwd: wt });
  assert.equal(e.code, 0, e.err);
  const again = s.cli(["create", "--name", "Ranger", "--agent", "claude", "--lead", ID.cap], { cwd: wt });
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(wtBots().map((b) => b.name), ["Genie", "Captain", "Dev", "Studio", "Scout", "Ranger"], "both worktree edits kept");
  assert.equal(wtBots().find((b) => b.id === scout).role, "scouting");
  // --project <worktree>, run from elsewhere: the worktree's file too.
  const named = s.cli(["category", "add", "ops", "--title", "Ops", "--project", wt], { cwd: s.root });
  assert.equal(named.code, 0, named.err);
  assert.ok(JSON.parse(readFileSync(wtPath, "utf8")).categories.some((c) => c.title === "Ops"));
  assert.equal(readFileSync(s.botsPath, "utf8"), mainText);
  assert.equal(git(s.project, "status", "--porcelain"), "");
  // From the main checkout: its own file, as before, with no note.
  const home = s.cli(["edit", ID.dev, "--role", "builds"]);
  assert.equal(home.code, 0, home.err);
  assert.doesNotMatch(home.err, /saved in/);
  assert.equal(s.bots().bots.find((b) => b.id === ID.dev).role, "builds");
  assert.ok(!wtBots().some((b) => b.id === ID.dev && b.role === "builds"), "the worktree's file is left alone");
});

test("a worktree with no bots.json of its own: the first edit starts from the main checkout's, written whole in the worktree", (t) => {
  const s = scene(t);
  const wt = join(s.root, "wt");
  git(s.project, "worktree", "add", "-q", wt);
  s.seed(team()); // the main checkout's file, not committed: the worktree has none
  const mainText = readFileSync(s.botsPath, "utf8");
  const wtPath = join(wt, ".herdr/bots.json");
  const r = s.cli(["create", "--name", "Scout", "--agent", "claude", "--lead", ID.cap, "--project", wt, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().project, s.project);
  const written = readFileSync(wtPath, "utf8");
  assert.deepEqual(JSON.parse(written).bots.map((b) => b.name), ["Genie", "Captain", "Dev", "Studio", "Scout"]);
  assert.deepEqual(JSON.parse(written).categories, team().categories);
  assert.equal(written, `${JSON.stringify(JSON.parse(written), null, 2)}\n`, "the same format as any save");
  assert.equal(readFileSync(s.botsPath, "utf8"), mainText);
  // The main checkout's file was never committed: the note says its pull would stop on it.
  assert.match(r.err, new RegExp(`${s.botsPath} isn't committed: commit or remove it before pulling, or git pull stops on it`));
  // The second edit's guard checks the worktree's file (now there), not the main checkout's text.
  const e = s.cli(["edit", r.json().id, "--role", "scouting"], { cwd: wt });
  assert.equal(e.code, 0, e.err);
  assert.equal(JSON.parse(readFileSync(wtPath, "utf8")).bots.find((b) => b.name === "Scout").role, "scouting");
  assert.equal(readFileSync(s.botsPath, "utf8"), mainText);
  // The worktree's change merged: as warned, git stops on the untracked file; removed first, it goes in.
  git(wt, "add", ".herdr/bots.json");
  git(wt, "commit", "-q", "-m", "bots");
  assert.throws(() => execFileSync("git", ["merge", "-q", "wt"], { cwd: s.project, encoding: "utf8", stdio: "pipe" }),
    (err) => /untracked working tree files would be overwritten/.test(String(err.stderr)));
  rmSync(s.botsPath);
  git(s.project, "merge", "-q", "wt");
  assert.equal(git(s.project, "status", "--porcelain"), "");
  assert.equal(JSON.parse(readFileSync(s.botsPath, "utf8")).bots.find((b) => b.name === "Scout").role, "scouting");
  // Committed, the main checkout's file draws no warning.
  const after = s.cli(["edit", r.json().id, "--role", "ranging"], { cwd: wt });
  assert.equal(after.code, 0, after.err);
  assert.match(after.err, /saved in /);
  assert.doesNotMatch(after.err, /isn't committed/);
});

test("from a worktree branched before a bot was added: edit names both files, restart --save says why nothing was saved", (t) => {
  const s = restartScene(t);
  const wt = join(s.root, "wt");
  git(s.project, "worktree", "add", "-q", wt);
  // The worktree's own file, from before Genie: another main bot only.
  const wtText = `${JSON.stringify({ version: 1, categories: [], bots: [bot(ID.plan, "main", { name: "Old" })] }, null, 2)}\n`;
  mkdirSync(join(wt, ".herdr"));
  writeFileSync(join(wt, ".herdr/bots.json"), wtText);
  const mainText = readFileSync(s.botsPath, "utf8");
  const e = s.cli(["edit", "Genie", "--role", "x"], { cwd: wt });
  assert.equal(e.code, 1, e.err);
  assert.match(e.err, new RegExp(`No bot "Genie" in ${join(wt, ".herdr/bots.json")}, this worktree's file, which edits change; ${s.botsPath} has it`));
  const r = s.cli(["restart", "Genie", "--agent", "codex", "--save", "--force", "--json"], { cwd: wt });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().saved, false);
  assert.match(r.err, /--save: .*wt\/\.herdr\/bots\.json, this worktree's file, has no Genie \(b-aaaaaaaaaa\), so codex wasn't saved/);
  assert.equal(readFileSync(join(wt, ".herdr/bots.json"), "utf8"), wtText);
  assert.equal(readFileSync(s.botsPath, "utf8"), mainText);
});

test("rm of the last bot from a worktree with no bots.json of its own is refused, and nothing is written", (t) => {
  const s = scene(t);
  const wt = join(s.root, "wt");
  git(s.project, "worktree", "add", "-q", wt);
  s.seed({ version: 1, categories: [], bots: [bot(ID.main, "main", { name: "Genie" })] });
  const mainText = readFileSync(s.botsPath, "utf8");
  const r = s.cli(["rm", ID.main], { cwd: wt });
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /last bot and .*wt\/\.herdr\/bots\.json isn't there, so nothing was removed/);
  assert.equal(existsSync(join(wt, ".herdr")), false);
  assert.equal(readFileSync(s.botsPath, "utf8"), mainText);
});

test("outside git, --project names the folder written, as before", (t) => {
  const s = scene(t);
  const other = join(s.root, "plain");
  mkdirSync(other);
  assert.equal(s.cli(["create", "--name", "Solo", "--agent", "claude", "--project", other]).code, 0);
  assert.ok(existsSync(join(other, ".herdr/bots.json")));
});

test("create --project names the project itself outside git, never the parent project above it", (t) => {
  const s = scene(t);
  // The owner's case: repos (no git) holds another project's bots.json; child under it has none.
  const repos = join(s.root, "repos");
  const child = join(repos, "child");
  mkdirSync(join(repos, ".herdr"), { recursive: true });
  mkdirSync(child);
  const parentText = `${JSON.stringify(team(), null, 2)}\n`;
  writeFileSync(join(repos, ".herdr/bots.json"), parentText);
  const r = s.cli(["create", "--name", "Child", "--agent", "claude", "--project", child, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().project, child);
  const own = JSON.parse(readFileSync(join(child, ".herdr/bots.json"), "utf8"));
  assert.deepEqual(own.bots.map((b) => [b.name, b.kind]), [["Child", "main"]]);
  assert.equal(readFileSync(join(repos, ".herdr/bots.json"), "utf8"), parentText, "the parent's file is untouched");
  // Run from inside child with no --project, the walk-up now finds child's own file first.
  assert.equal(s.cli(["ls", "--json"], { cwd: child }).json().projects[0].project, child);
  // A folder that isn't there is refused, not made.
  const gone = s.cli(["create", "--name", "X", "--agent", "claude", "--project", join(repos, "nope")]);
  assert.equal(gone.code, 2);
  assert.match(gone.err, /is not a folder/);
  assert.equal(existsSync(join(repos, "nope")), false);
});

test("create refuses instructions over 4,000 characters, from the flag, a file or stdin", (t) => {
  const s = scene(t);
  const long = "x".repeat(4001);
  const r = s.cli(["create", "--name", "Genie", "--agent", "claude", "--instructions", long]);
  assert.equal(r.code, 1);
  assert.match(r.err, /4001 characters; the limit is 4000/);
  assert.equal(existsSync(s.botsPath), false);
  assert.equal(s.cli(["create", "--name", "Genie", "--agent", "claude", "--instructions-file", "-"], { input: long }).code, 1);
  const ok = s.cli(["create", "--name", "Genie", "--agent", "claude", "--instructions-file", "-"], { input: `${"y".repeat(4000)}\n` });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(s.bots().bots[0].instructions.length, 4000);
});

test("create: lead, category, planned, look, model pin from the agent's list only", (t) => {
  const s = scene(t);
  s.seed(team());
  const bad = s.cli(["create", "--name", "Tess", "--agent", "claude", "--model", "gpt-free-text"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /isn't a known claude model. Pick one of: .*claude-opus-5-5/);
  const unknownAgent = s.cli(["create", "--name", "Tess", "--agent", "nope"]);
  assert.match(unknownAgent.err, /isn't a coding agent Herdr knows/);
  const catUnderCaptain = s.cli(["create", "--name", "Tess", "--agent", "claude", "--lead", "Captain", "--category", "eng"]);
  assert.match(catUnderCaptain.err, /category goes only on a member that reports to the main bot/);
  const leadPlanned = s.cli(["create", "--name", "Tess", "--agent", "claude", "--lead", "Studio"]);
  assert.match(leadPlanned.err, /Studio is planned/);
  const dupName = s.cli(["create", "--name", "dev", "--agent", "claude"]);
  assert.match(dupName.err, /already named "Dev"/);

  const r = s.cli(["create", "--name", "Tess", "--agent", "claude", "--lead", "Captain", "--model", "claude-opus-5-5", "--character", "gem", "--colour", "rose", "--json"]);
  assert.equal(r.code, 0, r.err);
  const made = s.bots().bots.find((b) => b.id === r.json().id);
  assert.equal(made.lead, ID.cap);
  assert.equal(made.model, "claude-opus-5-5");
  assert.deepEqual(made.look, { character: "gem", colour: "rose" });
  const omni = s.cli(["create", "--name", "Octo", "--agent", "codex", "--category", "Engineering", "--omni", "--json"]);
  const o = s.bots().bots.find((b) => b.id === omni.json().id);
  assert.deepEqual(o.look, { character: "octopus", colour: "deepseek" });
  assert.equal(o.category, "eng");
  assert.equal(o.lead, undefined);
  const planned = s.cli(["create", "--name", "Later", "--planned-wave", "2", "--planned-note", "after auth", "--json"]);
  assert.equal(planned.code, 0, planned.err);
  const p = s.bots().bots.find((b) => b.id === planned.json().id);
  assert.deepEqual(p.planned, { wave: 2, note: "after auth" });
  assert.equal(p.agent, undefined);
  assert.equal(s.cli(["create", "--name", "Nobody"]).code, 2, "no agent and not planned");
  assert.deepEqual(checkBots(s.bots()), []);
});

// ---- edit, rm, category ----

test("edit: partial changes keep the rest; --unplanned, --no-model; a lead cycle is refused", (t) => {
  const s = scene(t);
  const f = team();
  f.bots[1].model = "opus";
  f.bots[1].extra = "kept";
  s.seed(f);
  assert.equal(s.cli(["edit", "Captain", "--role", "leads eng", "--no-model"]).code, 0);
  let cap = s.bots().bots.find((b) => b.id === ID.cap);
  assert.equal(cap.role, "leads eng");
  assert.equal(cap.model, undefined);
  assert.equal(cap.extra, "kept");
  assert.equal(cap.category, "eng");
  assert.equal(cap.instructions, "i");
  const cycle = s.cli(["edit", "Captain", "--lead", "Dev"]);
  assert.equal(cycle.code, 1);
  assert.match(cycle.err, /Dev reports to Captain, so it can't be its lead/);
  const unplan = s.cli(["edit", ID.plan, "--unplanned"]);
  assert.match(unplan.err, /needs a coding agent/);
  assert.equal(s.cli(["edit", ID.plan, "--unplanned", "--agent", "codex"]).code, 0);
  assert.equal(s.bots().bots.find((b) => b.id === ID.plan).planned, undefined);
  assert.equal(s.cli(["edit", "Dev", "--lead", "Genie"]).code, 0);
  assert.equal(s.bots().bots.find((b) => b.id === ID.dev).lead, undefined, "the main bot as lead is stored as no lead");
  const json = s.cli(["edit", "Dev", "--name", "Developer", "--json"]).json();
  assert.equal(json.id, ID.dev);
  assert.equal(json.bot.name, "Developer");
  cap = s.bots().bots.find((b) => b.id === ID.cap);
  assert.equal(cap.name, "Captain");
});

test("rm: a main bot with members and a lead with members are refused; a member goes; the last bot deletes the file", (t) => {
  const s = scene(t);
  s.seed(team());
  const main = s.cli(["rm", "Genie"]);
  assert.equal(main.code, 1);
  assert.match(main.err, /main bot and its project still has 3 other bots/);
  const lead = s.cli(["rm", "Captain"]);
  assert.equal(lead.code, 1);
  assert.match(lead.err, /Captain leads Dev/);
  assert.equal(s.bots().bots.length, 4, "nothing written");
  for (const b of ["Dev", "Captain", "Studio"]) assert.equal(s.cli(["rm", b]).code, 0);
  const last = s.cli(["rm", "Genie", "--json"]);
  assert.equal(last.code, 0, last.err);
  assert.equal(last.json().deletedFile, true);
  assert.equal(existsSync(s.botsPath), false);
});

test("category add, edit, order, rm (refused while used); ls --json lists them", (t) => {
  const s = scene(t);
  s.seed(team());
  assert.equal(s.cli(["category", "add", "--title", "Quality", "--sub", "tests"]).out.trim(), "quality");
  assert.equal(s.cli(["category", "add", "--title", "Shared"]).out.trim(), "shared");
  assert.equal(s.cli(["category", "edit", "quality", "--sub", ""]).code, 0);
  assert.equal(s.bots().categories.find((c) => c.id === "quality").sub, undefined);
  assert.equal(s.cli(["category", "order", "shared", "quality"]).code, 0);
  assert.deepEqual(s.bots().categories.map((c) => c.id), ["shared", "quality", "eng"]);
  const used = s.cli(["category", "rm", "eng"]);
  assert.equal(used.code, 1);
  assert.match(used.err, /Captain is in eng/);
  assert.equal(s.cli(["category", "rm", "Shared"]).code, 0);
  const ls = s.cli(["category", "ls", "--json"]).json();
  assert.deepEqual(ls.categories.map((c) => [c.id, c.bots]), [["quality", []], ["eng", [ID.cap]]]);
});

// ---- the stale-snapshot rule ----

test("writeBotsFile refuses a stale snapshot and a file that appeared, writing nothing", (t) => {
  const s = scene(t);
  s.seed(team());
  const read = readFileSync(s.botsPath, "utf8");
  const raw = parseBots(read).raw;
  raw.bots[0].role = "changed";
  // Someone else's edit lands between the read and the write.
  const theirs = read.replace('"role": "r"', '"role": "theirs"');
  writeFileSync(s.botsPath, theirs);
  assert.throws(() => writeBotsFile(s.project, raw, read), (e) => e instanceof CliError && /changed since it was read/.test(e.message));
  assert.equal(readFileSync(s.botsPath, "utf8"), theirs);
  // A new file written by someone else after we saw none.
  const fresh = join(s.root, "fresh");
  mkdirSync(join(fresh, ".herdr"), { recursive: true });
  writeFileSync(join(fresh, ".herdr/bots.json"), "{}");
  assert.throws(() => writeBotsFile(fresh, team(), null), /changed since it was read/);
  // A write that would break the schema is refused before any read.
  assert.throws(() => writeBotsFile(s.project, { version: 1, categories: [], bots: [] }, theirs), /0 main bots/);
  // Through the injected file access: the re-read differs, so neither write runs.
  const io = { read: () => "y", mkdir() { throw new Error("no"); }, create() { throw new Error("no"); }, replace() { throw new Error("no"); } };
  assert.throws(() => writeBotsFile(s.project, team(), "x", io), /changed since/);
});

// ---- ls, show, model ----

test("ls --json: kind, lead, category, planned, agent, model detected → pinned → default, terminal, status", (t) => {
  const f = team();
  f.bots[2].model = "claude-opus-5-5";
  const s = scene(t, { terminals: [term("t5", { bot: ID.cap, argv: ["claude", "--dangerously-skip-permissions", "--model", "claude-opus-5-5"], status: "working" })] });
  s.seed(f);
  const r = s.cli(["ls", "--json"]);
  assert.equal(r.code, 0, r.err);
  const [p] = r.json().projects;
  assert.equal(p.project, s.project);
  assert.deepEqual(p.categories, [{ id: "eng", title: "Engineering" }]);
  const by = Object.fromEntries(p.bots.map((b) => [b.name, b]));
  assert.deepEqual(Object.keys(by), ["Genie", "Captain", "Dev", "Studio"]);
  assert.equal(by.Genie.kind, "main");
  assert.equal(by.Genie.lead, null);
  assert.deepEqual([by.Genie.model, by.Genie.modelSource, by.Genie.status, by.Genie.terminal], ["sonnet", "default", "not running", null]);
  assert.deepEqual([by.Captain.lead, by.Captain.category, by.Captain.model, by.Captain.modelSource, by.Captain.terminal, by.Captain.status],
    [ID.main, "eng", "claude-opus-5-5", "detected", "t5", "working"]);
  assert.deepEqual([by.Dev.lead, by.Dev.leadName, by.Dev.model, by.Dev.modelSource], [ID.cap, "Captain", "claude-opus-5-5", "pinned"]);
  assert.deepEqual(by.Studio.planned, { wave: 3, note: "later" });
  assert.equal(by.Studio.status, "planned");
  for (const key of ["id", "name", "kind", "lead", "category", "planned", "agent", "model", "modelSource", "terminal", "status", "duplicate"]) assert.ok(key in by.Dev, key);
  const text = s.cli(["ls"]);
  assert.match(text.out, /Captain .* claude-opus-5-5 \(detected\) {2}working in t5/);
  const show = s.cli(["show", "dev", "--json"]).json();
  assert.equal(show.id, ID.dev);
  assert.equal(show.instructions, "i");
  assert.match(s.cli(["show", "Captain"]).out, /model {8}claude-opus-5-5 \(detected\)/);
  assert.match(s.cli(["show", "nobody"]).err, /No bot "nobody"/);
});

test("ls by the ledger: a shell pane shows no agent in front; the import takes the newest agent pane; --all adds remembered projects", (t) => {
  const s = scene(t, { terminals: [
    term("t1", { bot: ID.main, argv: ["zsh"] }),
    term("t2", { bot: ID.cap, created: 5 }), term("t3", { bot: ID.cap, created: 9, argv: ["claude", "--model", "opus"] }),
  ] });
  s.seed(team());
  const other = join(s.root, "other");
  mkdirSync(join(other, ".herdr"), { recursive: true });
  writeFileSync(join(other, ".herdr/bots.json"), JSON.stringify({ version: 1, categories: [], bots: [bot("b-dddddddddd", "main", { name: "Solo" })] }));
  writeFileSync(join(s.app, "shared.json"), JSON.stringify({ "spaces-agents.projects": [{ key: other, machine: null }, { key: join(s.root, "gone"), machine: null }, { key: "/r", machine: "vps" }] }));
  const by = Object.fromEntries(s.cli(["ls", "--json"]).json().projects[0].bots.map((b) => [b.name, b]));
  // The first run imports the labels: Genie's only pane, though a shell is in front; of
  // Captain's two, the newest with an agent in front. The ledger then ties one pane each.
  assert.deepEqual([by.Genie.terminal, by.Genie.status], ["t1", "no agent in front"]);
  assert.deepEqual([by.Captain.terminal, by.Captain.duplicate, by.Captain.model], ["t3", false, "opus"]);
  const all = s.cli(["ls", "--all", "--json"]).json().projects;
  assert.deepEqual(all.map((p) => p.project), [s.project, other]);
});

// automagik#227 (RFC 0014 Q16): a clone carries the main checkout's bot ids; a pane counts for
// its own project only, and an older ledger row with no project still counts by id alone.
test("ls and show (#227): the main checkout's pane is not the clone's; a row with no project counts by id", (t) => {
  const s = scene(t);
  // The pane runs in the main checkout (scene() makes the folder, so the terminal comes after).
  writeFileSync(join(s.root, "hc.json"), JSON.stringify({ ...s.hcState(),
    terminals: [term("t5", { bot: ID.cap, cwd: s.project, created: 7, status: "working" })] }));
  s.seed(team());
  const rows = () => readRows(readFileSync(attachFile(s.app), "utf8")).rows;
  const clone = join(s.root, "proj-clone");
  git(s.root, "clone", "-q", s.project, clone);
  mkdirSync(join(clone, ".herdr"));
  writeFileSync(join(clone, ".herdr/bots.json"), readFileSync(s.botsPath, "utf8"));
  const captain = (cwd) => s.cli(["ls", "--json"], { cwd }).json().projects[0].bots.find((b) => b.id === ID.cap);
  // The first ls imports t5 into the ledger, bound to the main checkout that defines the bot.
  assert.deepEqual([captain(s.project).terminal, captain(s.project).status], ["t5", "working"]);
  assert.equal(rows().at(-1).project, s.project);
  assert.deepEqual([captain(clone).terminal, captain(clone).status], [null, "not running"]);
  const show = s.cli(["show", "Captain", "--json"], { cwd: clone }).json();
  assert.deepEqual([show.terminal, show.status], [null, "not running"]);
  assert.match(s.cli(["show", "Captain"], { cwd: s.project }).out, /t5/);
  // Start in the clone still refuses a second pane (the fold binds a bot once here) and says whose it is.
  const start = s.cli(["start", "Captain"], { cwd: clone });
  assert.equal(start.code, 0, start.err);
  assert.equal(start.out.trim(), `Captain is already running in t5, for ${s.project}.`);
  assert.equal(s.cli(["start", "Captain"], { cwd: s.project }).out.trim(), "Captain is already running in t5.");
  // An older row with no project: the pane counts for both checkouts, as before.
  writeFileSync(attachFile(s.app), `${JSON.stringify({ ...rows().at(-1), project: null })}\n`);
  assert.deepEqual([captain(clone).terminal, captain(clone).status], ["t5", "working"]);
  assert.deepEqual([captain(s.project).terminal, captain(s.project).status], ["t5", "working"]);
});

test("create, edit, category, start and attach list their project for the sidebar; ls --all reads the list", (t) => {
  const s = scene(t, { terminals: [term("t9", { cwd: "/x" })] });
  const list = join(s.app, "am-sidebar-projects.json");
  const listed = () => JSON.parse(readFileSync(list, "utf8"));
  // A folder that is there: start, attach and create take a gone one off the list (tidy).
  const elsewhere = join(s.root, "elsewhere");
  mkdirSync(elsewhere);
  writeFileSync(list, JSON.stringify([elsewhere]));
  assert.equal(s.cli(["create", "--name", "Genie", "--agent", "claude"]).code, 0);
  assert.deepEqual(listed(), [elsewhere, s.project]);
  // Once each, the newest last.
  writeFileSync(list, JSON.stringify([s.project, elsewhere]));
  assert.equal(s.cli(["edit", "Genie", "--role", "lead"]).code, 0);
  assert.deepEqual(listed(), [elsewhere, s.project]);
  writeFileSync(list, "[]");
  assert.equal(s.cli(["category", "add", "--title", "Eng"]).code, 0);
  assert.deepEqual(listed(), [s.project]);
  writeFileSync(list, "[]");
  assert.equal(s.cli(["start", "Genie"]).code, 0);
  assert.deepEqual(listed(), [s.project]);
  // ls --all adds a listed project the sidebar never remembered.
  const other = join(s.root, "other");
  mkdirSync(join(other, ".herdr"), { recursive: true });
  writeFileSync(join(other, ".herdr/bots.json"), JSON.stringify({ version: 1, categories: [], bots: [bot("b-dddddddddd", "main", { name: "Solo" })] }));
  writeFileSync(list, JSON.stringify([other]));
  assert.deepEqual(s.cli(["ls", "--all", "--json"]).json().projects.map((p) => p.project), [s.project, other]);
  // Reading leaves the list alone; a read-only command adds nothing.
  assert.equal(s.cli(["show", "Genie"]).code, 0);
  assert.deepEqual(listed(), [other]);
});

test("twenty CLIs listing projects at once lose none of them", async (t) => {
  const app = realpathSync(mkdtempSync(join(tmpdir(), "hb-list-")));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  const writer = `import { listProject } from ${JSON.stringify(CLI)};\nprocess.exitCode = listProject(process.argv[1], process.argv[2]) ? 0 : 1;`;
  const keys = Array.from({ length: 20 }, (_, i) => `/p/${i}`);
  const codes = await Promise.all(keys.map((key) => new Promise((done) => {
    execFile(process.execPath, ["--input-type=module", "-e", writer, key, app], (err) => done(err ? err.code ?? 1 : 0));
  })));
  assert.deepEqual(codes, keys.map(() => 0));
  const listed = JSON.parse(readFileSync(join(app, "am-sidebar-projects.json"), "utf8"));
  assert.deepEqual([...listed].sort(), [...keys].sort());
  assert.equal(existsSync(join(app, "am-sidebar-projects.json.lock")), false);
});

test("a stale project-list lock (a CLI killed mid-write) is taken over, and nothing is left behind", (t) => {
  const app = realpathSync(mkdtempSync(join(tmpdir(), "hb-lock-")));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  const lock = join(app, "am-sidebar-projects.json.lock");
  writeFileSync(lock, "999999 someone-else");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  assert.equal(listProject("/p/a", app), true);
  assert.deepEqual(JSON.parse(readFileSync(join(app, "am-sidebar-projects.json"), "utf8")), ["/p/a"]);
  assert.deepEqual(readdirSync(app), ["am-sidebar-projects.json"]);
});

test("with no app home, nothing is listed and the command still succeeds; an unwritable list only warns", (t) => {
  const s = scene(t);
  rmSync(s.app, { recursive: true, force: true });
  assert.equal(s.cli(["create", "--name", "Genie", "--agent", "claude"]).code, 0);
  assert.equal(existsSync(s.app), false);
  mkdirSync(join(s.app, "am-sidebar-projects.json"), { recursive: true }); // a folder where the file goes
  const r = s.cli(["edit", "Genie", "--role", "lead"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /couldn't list .* so the sidebar shows it only once a space is open on it/);
});

// ---- start ----

test("start a main bot: hc run --bg with the label, name, cwd, --no-parent, the pinned model; never --no-notify; the hook written and excluded", (t) => {
  const f = team();
  f.bots[0].model = "claude-opus-5-5";
  const s = scene(t);
  s.seed(f);
  const r = s.cli(["start", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().terminal, "t100");
  const run = runCall(s.calls());
  // Every seat runs as /usr/bin/env PATH=<this PATH> <agent>, as a worker does (#213): without it
  // the pane would get herdr-core's PATH, which may have no node for an npm agent.
  assert.deepEqual(run.slice(0, run.indexOf("--") + 2), ["run", "--bg", "--json", "--name", "genie", "--cwd", s.project, "--label", `bot=${ID.main}`, "--label", "role=main", "--no-parent",
    "--", "/usr/bin/env"]);
  assert.ok(run[run.indexOf("--") + 2].startsWith("PATH="), run.join(" "));
  assert.deepEqual(plain(agentWords(run)), ["claude", "--model", "claude-opus-5-5"]);
  const words = agentWords(run);
  assert.equal(words[1], "--append-system-prompt-file", "the briefing in its system prompt, right after the executable");
  assert.match(readFileSync(words[2], "utf8"), /^<herdr-bot>\nAutomagik Herdr briefing, written from \.herdr\/bots\.json/);
  assert.equal(run.includes("--no-notify"), false);
  assert.equal(run.some((a) => a.startsWith("herdr.space=") || a.startsWith("herdr.tab=")), false, "no placement labels unless asked");
  const settings = JSON.parse(readFileSync(join(s.project, ".claude/settings.local.json"), "utf8"));
  assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, new RegExp(`${s.app}/mods/am-sidebar/briefing.mjs`));
  assert.match(readFileSync(join(s.project, ".git/info/exclude"), "utf8"), /\*\*\/\.claude\/settings\.local\.json/);
  assert.equal(git(s.project, "status", "--porcelain", "--", ".claude"), "");
  // Started: the next start reports the running pane and runs nothing.
  const again = s.cli(["start", "Genie"]);
  assert.equal(again.code, 0);
  assert.match(again.out, /already running in t100/);
  assert.equal(s.calls().filter((c) => c[0] === "run").length, 1);
});

test("start (#56) lands in the project's space, a project terminal's only when it shows the project; in a tab of its own", (t) => {
  // The window: the caller's space on another folder, and the project's, its second tab selected.
  const startIn = (callerLabels, { projectSpace = true } = {}) => {
    const s = scene(t);
    const spaces = [{ id: "sp-caller", folder: "/", machine: null, active: true, tabs: [{ id: "tb-c", active: true, terminals: [] }] }];
    if (projectSpace) {
      spaces.push({ id: "sp-proj", folder: s.project, machine: null, active: false,
        tabs: [{ id: "tb-a", active: false, terminals: [] }, { id: "tb-b", active: true, terminals: [] }] });
    }
    writeFileSync(join(s.root, "herdr-app.json"), JSON.stringify({ spaces }));
    s.seed(team());
    const caller = term("t20", { cwd: s.project, argv: ["claude"] }); // e.g. an orchestrator working in the project
    caller.labels = callerLabels;
    writeFileSync(join(s.root, "hc.json"), JSON.stringify({ terminals: [caller], next: 100 }));
    const r = s.cli(["start", "Genie", "--json"]);
    assert.equal(r.code, 0, r.err);
    r.appCalls = s.appCalls();
    r.calls = s.calls();
    return r;
  };
  // The caller's tab is in another space: the bot goes to the project's space, never its selected
  // tab, with one herdr-app ls for the whole start (placementOf and windowPlace share it).
  const away = startIn({ "herdr.space": "sp-caller", "herdr.tab": "tb-c" });
  assert.deepEqual([away.json().space, away.json().tab], ["sp-proj", null]);
  assert.deepEqual(away.appCalls, [["ls"]]);
  // The caller's tab is in the project's space: its space takes the bot, never its tab (an
  // orchestrator's), so Herdr opens the bot in a tab of its own.
  const home = startIn({ "herdr.space": "sp-proj", "herdr.tab": "tb-a" });
  assert.deepEqual([home.json().space, home.json().tab], ["sp-proj", null]);
  const labels = runCall(home.calls);
  assert.ok(labels.includes("herdr.space=sp-proj"), labels.join(" "));
  assert.equal(labels.some((a) => a.startsWith("herdr.tab=")), false, labels.join(" "));
  // No space shows the project: never the caller's tab; a new space on the project is opened (#71).
  const none = startIn({ "herdr.space": "sp-caller", "herdr.tab": "tb-c" }, { projectSpace: false });
  assert.deepEqual([none.json().space, none.json().tab], ["sp-new1", null]);
  assert.deepEqual(none.appCalls.slice(0, 3).map((c) => c.slice(0, 2)), [["ls"], ["do", "space.new"], ["ls"]]);
  // Then only looks at the window (for the bot's tab, to close the new space's spare shell's):
  // this fake window never shows the bot, so nothing is closed.
  assert.deepEqual([...new Set(none.appCalls.slice(3).map((c) => c[0]))], none.appCalls.length > 3 ? ["ls"] : []);
});

test("start a member: parent is its lead's live terminal, outliving it; else --no-parent; --space/--tab add placement labels", (t) => {
  const s = scene(t, { terminals: [term("t7", { bot: ID.cap, cwd: "/p" }), term("t8", { bot: ID.main, argv: ["bash"] })] });
  s.seed(team());
  assert.equal(s.cli(["start", "Dev", "--space", "sp1", "--tab", "tb2"]).code, 0);
  const run = runCall(s.calls());
  assert.deepEqual(run.slice(run.indexOf("--parent"), run.indexOf("--")), ["--parent", "t7", "--outlive-parent"]);
  assert.ok(run.includes("herdr.space=sp1") && run.includes("herdr.tab=tb2"));
  // Captain is attached to t7 (imported from its label): reported, not started twice. So is
  // Genie in t8, a shell in front or not: the ledger ties it. Detached, Genie starts, with no parent.
  assert.match(s.cli(["start", "Captain"]).out, /already running in t7/);
  assert.match(s.cli(["start", "Genie"]).out, /already running in t8/);
  assert.equal(s.cli(["detach", "Genie"]).code, 0);
  assert.equal(s.cli(["start", "Genie"]).code, 0);
  const runs = s.calls().filter((c) => c[0] === "run");
  assert.equal(runs.length, 2);
  assert.ok(runs[1].includes("--no-parent"));
});

test("start: --tab without --space is a usage mistake (exit 2), nothing started", (t) => {
  const s = scene(t);
  s.seed(team());
  const r = s.cli(["start", "Genie", "--tab", "tb2"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--tab needs --space/);
  assert.equal(runCall(s.calls()), undefined);
});

test("start: the main bot not live gives --no-parent; planned and agentless bots are refused; a missing briefing script only warns", (t) => {
  const s = scene(t, { briefing: false });
  s.seed(team());
  const r = s.cli(["start", "Captain"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /gets no per-turn briefing: .*briefing\.mjs isn't there/);
  assert.equal(existsSync(join(s.project, ".claude/settings.local.json")), false);
  const run = runCall(s.calls());
  assert.ok(run.includes("--no-parent"));
  assert.equal(run.includes("--parent"), false);
  const planned = s.cli(["start", "Studio"]);
  assert.equal(planned.code, 1);
  assert.match(planned.err, /Studio is planned \(wave 3\)/);
  assert.equal(s.calls().filter((c) => c[0] === "run").length, 1);
});

// ---- attach, detach ----

test("attach refuses a Claude pane whose session runs outside the project, naming both folders; nothing written", (t) => {
  const s = scene(t, { terminals: [term("t9", { cwd: "/elsewhere" })] });
  s.seed(team());
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "hb-out-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const st = s.hcState();
  st.terminals[0].foreground.cwd = outside;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["attach", "Genie", "t9"]);
  assert.equal(r.code, 1);
  assert.match(r.err, new RegExp(`runs in ${outside}.*not to Genie's project ${s.project}`));
  assert.deepEqual(labelCalls(s.calls()), []);
  assert.equal(existsSync(join(outside, ".claude")), false);
  assert.deepEqual(s.hcState().terminals[0].labels, {});
});

test("attach refuses another bot's pane and a pane that isn't live; a planned bot is refused", (t) => {
  const s = scene(t, { terminals: [term("t4", { bot: ID.cap }), term("t5", { state: "finished" })] });
  s.seed(team());
  assert.match(s.cli(["attach", "Genie", "t4"]).err, /t4 already plays Captain \(b-bbbbbbbbbb\)/);
  assert.match(s.cli(["attach", "Genie", "t5"]).err, /t5 isn't a live terminal/);
  assert.match(s.cli(["attach", "Studio", "t4"]).err, /Studio is planned/);
  assert.match(s.cli(["attach", "Genie", "vps/t4"]).err, /vps\/t4 is on vps; name the bot's project there: --machine vps/);
  assert.deepEqual(labelCalls(s.calls()), []);
});

test("attach of a bot attached elsewhere is refused, naming the holder; --move moves it, labels following", (t) => {
  const s = scene(t);
  const sub = join(s.project, "pkg");
  mkdirSync(sub);
  const st = { terminals: [term("t1", { bot: ID.main, cwd: s.project }), term("t2", { cwd: sub })], next: 100 };
  st.terminals[1].foreground.cwd = sub;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  s.seed(team());
  const bare = s.cli(["attach", "Genie", "t2"]);
  assert.equal(bare.code, 1);
  assert.match(bare.err, /Genie \(b-aaaaaaaaaa\) is attached to t1 \(since .*\); nothing was attached\. Move it with: automagik-herdr attach b-aaaaaaaaaa t2 --move/);
  assert.deepEqual(labelCalls(s.calls()), []);
  const r = s.cli(["attach", "Genie", "t2", "--move", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().movedFrom, ["t1"]);
  assert.deepEqual(labelCalls(s.calls()), [["label", "t1", "bot="], ["label", "t2", `bot=${ID.main}`], ["label", "t2", "role=main"]]);
  const labels = Object.fromEntries(s.hcState().terminals.map((x) => [x.address, x.labels]));
  assert.deepEqual(labels, { t1: {}, t2: { bot: ID.main, role: "main" } });
  assert.ok(existsSync(join(sub, ".claude/settings.local.json")));
  assert.match(r.err, /no briefing, restart the bot: automagik-herdr restart b-[a-z2-7]{10} \(or the bot row's Restart\)/);
});

test("attach: a label write that fails only warns: the ledger has the move", (t) => {
  const s = scene(t);
  writeFileSync(join(s.root, "hc.json"), JSON.stringify({ terminals: [term("t1", { bot: ID.dev, app: "codex", argv: ["codex"] }), term("t2", { app: "codex", argv: ["codex"] })], failLabel: "t2" }));
  s.seed(team());
  const r = s.cli(["attach", "Dev", "t2", "--move"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /the ledger has it, but hc label t2 bot=b-cccccccccc failed/);
  assert.equal(s.cli(["whois", "t2", "--json"]).json().bot, ID.dev);
  assert.equal(s.cli(["whois", "t1", "--json"]).json().bot, null);
});

test("detach unties the bot from its ledger pane and takes the label off every local pane carrying it", (t) => {
  const s = scene(t, { terminals: [term("t1", { bot: ID.cap }), term("t2", { bot: ID.cap, argv: ["zsh"] })] });
  s.seed(team());
  const r = s.cli(["detach", "Captain", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json(), { id: ID.cap, defined: true, detached: ["t1"], labelsCleared: ["t1", "t2"] });
  assert.deepEqual(s.hcState().terminals.map((x) => x.labels), [{}, {}]);
  assert.match(s.cli(["detach", "Captain"]).out, /no pane on this computer/);
});

// ---- brief, errors ----

test("brief prints the bot's briefing: a lead sees its members' status and reports; planned bots get none", (t) => {
  const s = scene(t, { terminals: [term("t3", { bot: ID.dev, status: "blocked", msg: "waiting on the schema" }), term("t2", { bot: ID.cap })] });
  s.seed(team());
  const r = s.cli(["brief", "Captain"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Captain/);
  assert.match(r.out, /Dev/);
  assert.match(r.out, /waiting on the schema/);
  const dev = s.cli(["brief", "Dev", "--json"]).json();
  assert.match(dev.briefing, /t2/, "a member is told its lead's terminal");
  assert.equal(s.cli(["brief", "Studio", "--json"]).json().briefing, null);
});

test("errors: stderr and a non-zero exit; unknown commands and options are usage errors; names must be unique", (t) => {
  const s = scene(t);
  s.seed(team());
  const unknown = s.cli(["frob"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown command "frob"/);
  assert.equal(s.cli(["ls", "--bogus"]).code, 2);
  assert.equal(s.cli(["show"]).code, 2);
  assert.equal(s.cli(["--help"]).code, 0);
  const f = team();
  assert.throws(() => findBot({ ...f, bots: [...f.bots, bot("b-ffffffffff", "member", { name: "Dev" })] }, "Dev"), /2 bots are named "Dev"/);
  assert.equal(findBot(f, "genie").id, ID.main);
  const broken = s.botsPath;
  writeFileSync(broken, "{nope");
  const r = s.cli(["ls"]);
  assert.match(r.out, /not valid JSON|Unexpected token|Expected property name|JSON Parse error/);
});

// ---- review fixes ----

test("rm never deletes a file that still holds bots: members with no main bot are refused, file intact", (t) => {
  const s = scene(t);
  const f = team();
  f.bots = f.bots.filter((b) => b.kind !== "main"); // parseBots only warns about this
  s.seed(f);
  const before = readFileSync(s.botsPath, "utf8");
  const r = s.cli(["rm", "Studio"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Not saved: .*0 main bots/);
  assert.equal(readFileSync(s.botsPath, "utf8"), before);
});

test("rm of the main bot counts entries parseBots left out as other bots", (t) => {
  const s = scene(t);
  s.seed({ version: 1, categories: [], bots: [bot(ID.main, "main", { name: "Genie" }), { id: ID.dev, kind: "member" }] });
  const r = s.cli(["rm", "Genie"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /still has 1 other bot/);
  assert.ok(existsSync(s.botsPath));
});

test("start places the pane in the space of a live terminal in the project; with none it warns the pane is unseen", (t) => {
  const s = scene(t);
  s.seed(team());
  const sub = join(s.project, "pkg");
  mkdirSync(sub);
  const placed = term("t20", { cwd: sub, argv: ["zsh"], app: "zsh" });
  placed.labels = { "herdr.space": "sp9", "herdr.tab": "tb3" };
  const elsewhere = term("t21", { cwd: s.root, argv: ["zsh"], app: "zsh" });
  elsewhere.labels = { "herdr.space": "sp-other" };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify({ terminals: [elsewhere, placed], next: 100 }));
  const r = s.cli(["start", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().space, r.json().tab], ["sp9", null]);
  const run = runCall(s.calls());
  assert.ok(run.includes("herdr.space=sp9") && !run.some((a) => a.startsWith("herdr.tab=")), run.join(" "));
  assert.doesNotMatch(r.err, /unseen/);
  // No terminal of the project carries a space and no window answers: started, with the warning.
  const s2 = scene(t);
  s2.seed(team());
  const r2 = s2.cli(["start", "Genie"]);
  assert.equal(r2.code, 0, r2.err);
  assert.match(r2.err, /No open Herdr space shows .*, so Herdr gives t100 no pane: it runs, unseen\. Watch it with hc attach t100/);
});

test("start with no space showing the project opens one on its folder and starts the bot in it; an open one is used", (t) => {
  const s = scene(t, { window: { spaces: [{ id: "sp1", name: "Other", folder: "/elsewhere", machine: null, active: true,
    tabs: [{ id: "tb1", name: "1", active: true, terminals: [] }] }] } });
  s.seed(team());
  const r = s.cli(["start", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  const made = s.appCalls().find((c) => c[0] === "do");
  assert.deepEqual(made && [made[1], JSON.parse(made[2])], ["space.new", { name: "proj", folder: s.project, machine: "" }]);
  assert.deepEqual([r.json().space, r.json().tab], ["sp-new1", null]);
  const run = runCall(s.calls());
  assert.ok(run.includes("herdr.space=sp-new1") && !run.some((a) => a.startsWith("herdr.tab=")), run.join(" "));
  assert.doesNotMatch(r.err, /unseen/);
  // That space is open now: the next bot starts in it, and no second space is made.
  assert.equal(s.cli(["start", "Captain"]).code, 0);
  assert.equal(s.appCalls().filter((c) => c[0] === "do").length, 1);
  assert.equal(s.windowNow().spaces.length, 2);
  assert.ok(runCall(s.calls().filter((c) => c.includes("bot=" + ID.cap))).includes("herdr.space=sp-new1"));
  // A project terminal still labelled with a space the window no longer shows (its last
  // pane closed): that label is passed over and a space is opened.
  const s3 = scene(t, { window: { spaces: [] } });
  s3.seed(team());
  const stale = term("t20", { cwd: s3.project, argv: ["zsh"], app: "zsh" });
  stale.labels = { "herdr.space": "sp9", "herdr.tab": "tb3" };
  writeFileSync(join(s3.root, "hc.json"), JSON.stringify({ terminals: [stale], next: 100 }));
  const r3 = s3.cli(["start", "Genie", "--json"]);
  assert.equal(r3.code, 0, r3.err);
  assert.deepEqual([r3.json().space, r3.json().tab], ["sp-new1", null]);
  // Another start opened a space on the folder at the same time: the first one is used and
  // the space this start opened is closed, so one space shows the project.
  const s4 = scene(t, { window: { spaces: [], rival: true } });
  s4.seed(team());
  const r4 = s4.cli(["start", "Genie", "--json"]);
  assert.equal(r4.code, 0, r4.err);
  assert.equal(r4.json().space, "sp-rival");
  assert.deepEqual(s4.appCalls().filter((c) => c[0] === "do").map((c) => [c[1], JSON.parse(c[2]).id ?? null]),
    [["space.new", null], ["space.close", "sp-new1"]]);
  assert.deepEqual(s4.windowNow().spaces.map((x) => x.id), ["sp-rival"]);
  // --space still picks the place: the window isn't asked.
  const s2 = scene(t, { window: { spaces: [] } });
  s2.seed(team());
  assert.equal(s2.cli(["start", "Genie", "--space", "sp7"]).code, 0);
  assert.deepEqual(s2.appCalls(), []);
});

test("start in a space it opened closes its lone shell tab only when ls counts one pane there and the shell is idle", (t) => {
  // ls with a pane count per tab: the shell (t-sh1) alone in tb-new1, idle; Herdr shows the bot (t100) in tb-t100.
  const s = scene(t, { window: { spaces: [], place: true, paneCounts: true } });
  s.seed(team());
  const r = s.cli(["start", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().space, r.json().tab], ["sp-new1", null]);
  // Never `confirmed`: Herdr asks the person whenever it would.
  assert.deepEqual(s.appCalls().filter((c) => c[0] === "do").map((c) => [c[1], JSON.parse(c[2])]),
    [["space.new", { name: "proj", folder: s.project, machine: "" }], ["tab.close", { id: "tb-new1" }]]);
  assert.deepEqual(s.windowNow().spaces.map((x) => [x.id, x.tabs.map((tb) => tb.id)]), [["sp-new1", ["tb-t100"]]]);
  // The next bot starts in that space: nothing else is closed.
  assert.equal(s.cli(["start", "Captain"]).code, 0);
  assert.equal(s.appCalls().filter((c) => c[0] === "do").length, 2);
  // Kept: Herdr's real ls shape (no pane count: a mod pane there can't be seen); a counted mod pane
  // beside the shell; vim in front of the shell; and a bot Herdr doesn't show in time.
  for (const extra of [{}, { paneCounts: true, modInSpare: true }, { paneCounts: true, shellBusy: true }]) {
    const k = scene(t, { window: { spaces: [], place: true, ...extra } });
    k.seed(team());
    assert.equal(k.cli(["start", "Genie"]).code, 0);
    assert.deepEqual(k.appCalls().filter((c) => c[0] === "do").map((c) => c[1]), ["space.new"], JSON.stringify(extra));
    assert.deepEqual(k.windowNow().spaces[0].tabs.map((tb) => tb.id), ["tb-new1", "tb-t100"], JSON.stringify(extra));
  }
  const n = scene(t, { window: { spaces: [], paneCounts: true } });
  n.seed(team());
  assert.equal(n.cli(["start", "Genie"]).code, 0);
  assert.deepEqual(n.appCalls().filter((c) => c[0] === "do").map((c) => c[1]), ["space.new"]);
  assert.deepEqual(n.windowNow().spaces[0].tabs.map((tb) => tb.id), ["tb-new1"]);
  // AUTOMAGIK_HERDR_TAB_WAIT_MS=0 turns it off: no wait for the bot's tab, nothing closed.
  const off = scene(t, { window: { spaces: [], place: true, paneCounts: true } });
  off.seed(team());
  assert.equal(off.cli(["start", "Genie"], { env: { AUTOMAGIK_HERDR_TAB_WAIT_MS: "0" } }).code, 0);
  assert.deepEqual(off.appCalls().map((c) => c.slice(0, 2)), [["ls"], ["do", "space.new"], ["ls"]]);
});


test("start refuses an old free-text model pin, naming the fix; a pane started under a minute ago counts as running", (t) => {
  const f = team();
  f.bots[0].model = "Opus 5.5";
  const s = scene(t, { terminals: [term("t30", { bot: ID.cap, argv: ["sh", "-c", "claude"], app: "sh", created: Date.now() })] });
  s.seed(f);
  const r = s.cli(["start", "Genie"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /pinned to "Opus 5\.5", which isn't a claude model this computer lists\. Pick one with automagik-herdr edit b-aaaaaaaaaa --model/);
  const young = s.cli(["start", "Captain"]);
  assert.equal(young.code, 0);
  assert.match(young.out, /already running in t30/);
  assert.equal(s.calls().some((c) => c[0] === "run"), false);
});

test("a failing hc never reads as 'no pane': start, attach and detach refuse; ls and show say hc is unavailable", (t) => {
  const s = scene(t);
  s.seed(team());
  const st = { terminals: [term("t1", { bot: ID.main, cwd: s.project })], fail: ["server"] };
  st.terminals[0].foreground.cwd = s.project;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  for (const args of [["start", "Genie"], ["attach", "Genie", "t1"], ["detach", "Genie"]]) {
    const r = s.cli(args);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.err, /hc server status failed: hc: can't reach the server/);
  }
  assert.equal(s.calls().some((c) => c[0] === "run" || c[0] === "label"), false);
  const ls = s.cli(["ls", "--json"]);
  assert.equal(ls.code, 0, ls.err);
  const genie = ls.json().projects[0].bots[0];
  assert.equal(genie.status, "hc unavailable");
  assert.match(genie.hcError, /can't reach the server/);
  assert.match(s.cli(["ls"]).out, /panes unknown: hc server status/);
  assert.equal(s.cli(["show", "Genie", "--json"]).json().status, "hc unavailable");
  assert.equal(s.cli(["brief", "Genie"]).code, 0, "the briefing still prints, members unreachable");
});

test("an attached pane with a shell in front stays the bot's: shown as no agent in front, never as another's", (t) => {
  const s = scene(t, { terminals: [term("t1", { bot: ID.main, argv: ["zsh"], app: "zsh" }), term("t2", { bot: ID.cap })] });
  s.seed(team());
  const bots = s.cli(["ls", "--json"]).json().projects[0].bots;
  const gets = s.calls().filter((c) => c[0] === "get").map((c) => c[1]);
  assert.ok(gets.includes("t2") && gets.includes("t1"));
  assert.deepEqual([bots.find((b) => b.id === ID.main).terminal, bots.find((b) => b.id === ID.main).status], ["t1", "no agent in front"]);
  assert.equal(bots.find((b) => b.id === ID.cap).terminal, "t2");
});

test("attach: a terminal argument that looks like an option is refused; a claude wrapper counts as a Claude pane", (t) => {
  const s = scene(t, { terminals: [term("t9", { argv: ["node", "/opt/claude.js"], app: "agent", cwd: "/elsewhere" })] });
  s.seed(team());
  const opt = s.cli(["attach", "Genie", "--", "--all"]);
  assert.equal(opt.code, 2);
  assert.match(opt.err, /"--all" isn't a terminal/);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "hb-out-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const st = s.hcState();
  st.terminals[0].foreground.cwd = outside;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["attach", "Genie", "t9"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Not attached: this Claude session runs in/);
  assert.deepEqual(labelCalls(s.calls()), []);
});

test("ls over more bots than the eight-process cap completes, each live pane found", (t) => {
  const ids = Array.from({ length: 12 }, (_, i) => `b-${"abcdefghijkl"[i].repeat(10)}`);
  const s = scene(t, { terminals: ids.map((id, i) => term(`t${i + 1}`, { bot: id })) });
  s.seed({ version: 1, categories: [], bots: ids.map((id, i) => bot(id, i === 0 ? "main" : "member", { name: `B${i}` })) });
  const r = s.cli(["ls", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().projects[0].bots.map((b) => b.terminal), ids.map((_, i) => `t${i + 1}`));
});

test("detach takes a removed bot's label off by its bare id; an unknown name is still refused", (t) => {
  const s = scene(t, { terminals: [term("t1", { bot: ID.dev }), term("t2", { bot: ID.dev, argv: ["zsh"], app: "zsh" })] });
  s.seed(team());
  const rm = s.cli(["rm", "Dev"]);
  assert.equal(rm.code, 0, rm.err);
  assert.match(rm.err, new RegExp(`t1 is still attached to it; detach it with: automagik-herdr detach ${ID.dev}`));
  const r = s.cli(["detach", ID.dev, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json(), { id: ID.dev, defined: false, detached: ["t1"], labelsCleared: ["t1", "t2"] });
  assert.deepEqual(s.hcState().terminals.map((x) => x.labels), [{}, {}]);
  assert.match(s.cli(["detach", "Ghost"]).err, /No bot "Ghost"/);
  // No bots.json at all: a bare id still works.
  rmSync(s.botsPath);
  assert.equal(s.cli(["detach", ID.dev]).code, 0);
});

// ---- A16: pane labels ----

const labelsIn = (s) => Object.fromEntries(s.hcState().terminals.map((x) => [x.address, x.labels]));

test("--rank on create and edit: checked against the set, '' clears it; show and ls --json carry it", (t) => {
  const s = scene(t);
  s.seed(team());
  const bad = s.cli(["edit", "Dev", "--rank", "boss"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--rank is one of captain, dev, tester, reviewer, fixer, integrator, pm, owner/);
  assert.equal(s.cli(["create", "--name", "Ana", "--agent", "claude", "--rank", "tester"]).code, 0);
  assert.equal(s.bots().bots.find((b) => b.name === "Ana").rank, "tester");
  assert.equal(s.cli(["edit", "Dev", "--rank", "reviewer"]).code, 0);
  assert.equal(s.cli(["show", "Dev", "--json"]).json().rank, "reviewer");
  assert.match(s.cli(["show", "Dev"]).out, /rank\s+reviewer/);
  assert.equal(s.cli(["ls", "--json"]).json().projects[0].bots.find((b) => b.name === "Dev").rank, "reviewer");
  assert.equal(s.cli(["edit", "Dev", "--rank", ""]).code, 0);
  assert.equal("rank" in s.bots().bots.find((b) => b.name === "Dev"), false);
  assert.equal(s.cli(["show", "Dev", "--json"]).json().rank, null);
});

test("start labels the pane: role from rank or captaincy, category, and the lead pane's squad, marked", (t) => {
  const lead = term("t7", { bot: ID.cap });
  lead.labels.squad = "memory";
  const s = scene(t, { terminals: [lead] });
  const f = team();
  f.bots.find((b) => b.id === ID.dev).rank = "dev";
  s.seed(f);
  assert.equal(s.cli(["start", "Dev"]).code, 0);
  const run = runCall(s.calls());
  const labels = run.flatMap((w, i) => (run[i - 1] === "--label" ? [w] : []));
  assert.deepEqual(labels, [`bot=${ID.dev}`, "role=dev", "category=eng", "squad=memory", "automagik-herdr.squad=memory"]);
});

test("attach labels the pane and keeps its own squad; detach takes off bot, role, category and only a copied squad", (t) => {
  const lead = term("t7", { bot: ID.cap });
  lead.labels.squad = "memory";
  const own = term("t8", { cwd: "/x" });
  own.labels.squad = "infra";
  const s = scene(t, { terminals: [lead, own, term("t9", { cwd: "/x" })] });
  const f = team();
  f.bots.find((b) => b.id === ID.dev).rank = "tester";
  s.seed(f);
  for (const [address] of [["t8"], ["t9"]]) {
    const st = s.hcState();
    st.terminals.find((x) => x.address === address).foreground.cwd = s.project;
    writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  }
  assert.equal(s.cli(["attach", "Dev", "t8"]).code, 0);
  assert.deepEqual(labelsIn(s).t8, { squad: "infra", bot: ID.dev, role: "tester", category: "eng" });
  // Moved to t9: t8 loses what Detach takes off, keeping its own squad; t9 copies the lead's.
  assert.equal(s.cli(["attach", "Dev", "t9", "--move"]).code, 0);
  assert.deepEqual(labelsIn(s).t8, { squad: "infra" });
  assert.deepEqual(labelsIn(s).t9, { bot: ID.dev, role: "tester", category: "eng", squad: "memory", "automagik-herdr.squad": "memory" });
  assert.equal(s.cli(["detach", "Dev"]).code, 0);
  assert.deepEqual(labelsIn(s).t9, {});
  // The captain's own squad stays on detach: this pack didn't put it there.
  assert.equal(s.cli(["detach", "Captain"]).code, 0);
  assert.deepEqual(labelsIn(s).t7, { squad: "memory" });
});

test("an edit relabels the live local panes it changes, the old and new leads included; a remote pane is never touched", (t) => {
  const s = scene(t, { terminals: [
    term("t1", { bot: ID.main }), term("t7", { bot: ID.cap }), term("t8", { bot: ID.dev }), term("far/t9", { bot: ID.dev }),
  ] });
  const f = team();
  f.bots.find((b) => b.id === ID.cap).rank = "integrator";
  s.seed(f);
  // Labels as Start would have set them.
  const st = s.hcState();
  Object.assign(st.terminals.find((x) => x.address === "t7").labels, { role: "captain", category: "eng" });
  Object.assign(st.terminals.find((x) => x.address === "t8").labels, { category: "eng" });
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  // Dev moves to the main bot, no category, rank dev: the captain leads nobody now.
  const r = s.cli(["edit", "Dev", "--lead", "Genie", "--rank", "dev", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().relabelled.sort(), ["t7", "t8"]);
  const labels = labelsIn(s);
  assert.deepEqual(labels.t7, { bot: ID.cap, role: "integrator", category: "eng" });
  assert.deepEqual(labels.t8, { bot: ID.dev, role: "dev" });
  assert.deepEqual(labels["far/t9"], { bot: ID.dev });
  assert.equal(labelCalls(s.calls()).some((c) => c[1].includes("/")), false);
  // A change that moves no label: no label call.
  const before = labelCalls(s.calls()).length;
  assert.equal(s.cli(["edit", "Dev", "--role", "writes code"]).code, 0);
  assert.equal(labelCalls(s.calls()).length, before);
});

test("category add --id takes slug ids only; a hand-written non-slug id stays usable, with no category label", (t) => {
  const s = scene(t, { terminals: [term("t8", { bot: ID.dev })] });
  s.seed(team());
  const bad = s.cli(["category", "add", "--title", "Quality", "--id", "Quality Gate"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--id "Quality Gate" isn't a category id: a lowercase slug/);
  assert.equal(s.cli(["category", "add", "--title", "Quality Gate!"]).code, 0);
  assert.ok(s.bots().categories.some((c) => c.id === "quality-gate"));
  // brain-v3 style: "Knowledge" written by hand. Edits of the file still work.
  const f = team();
  f.categories.push({ id: "Knowledge", title: "Knowledge" });
  s.seed(f);
  const r = s.cli(["edit", "Dev", "--lead", "Genie", "--category", "Knowledge", "--rank", "dev"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(s.bots().bots.find((b) => b.id === ID.dev).category, "Knowledge");
  assert.equal(s.cli(["edit", "Captain", "--role", "still editable"]).code, 0);
  // Its pane gets a role but no category= label.
  assert.deepEqual(labelsIn(s).t8, { bot: ID.dev, role: "dev" });
});

test("a lead change moves the squad copied from the old lead, and leaves a pane's own squad", (t) => {
  const cap = term("t7", { bot: ID.cap });
  cap.labels.squad = "memory";
  const main = term("t1", { bot: ID.main });
  main.labels.squad = "core";
  const dev = term("t8", { bot: ID.dev });
  Object.assign(dev.labels, { squad: "memory", "automagik-herdr.squad": "memory" });
  const s = scene(t, { terminals: [main, cap, dev] });
  s.seed(team());
  assert.equal(s.cli(["edit", "Dev", "--lead", "Genie"]).code, 0);
  assert.deepEqual([labelsIn(s).t8.squad, labelsIn(s).t8["automagik-herdr.squad"]], ["core", "core"]);
  // Its own squad (set after the copy) stays when the lead changes again.
  const st = s.hcState();
  st.terminals.find((x) => x.address === "t8").labels.squad = "ops";
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  assert.equal(s.cli(["edit", "Dev", "--lead", "Captain"]).code, 0);
  assert.equal(labelsIn(s).t8.squad, "ops");
  // Detach keeps that squad and takes the mark off.
  assert.equal(s.cli(["detach", "Dev"]).code, 0);
  assert.deepEqual(labelsIn(s).t8, { squad: "ops" });
});

test("attach leaves the pane matching the bot: a stale role or category from its last bot comes off; an unmarked squad stays", (t) => {
  const pane = term("t8", { cwd: "/x" });
  Object.assign(pane.labels, { role: "captain", category: "old", squad: "ops" });
  const s = scene(t, { terminals: [pane] });
  s.seed(team()); // Dev: no rank, under the captain (category eng)
  const st = s.hcState();
  st.terminals[0].foreground.cwd = s.project;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  assert.equal(s.cli(["attach", "Dev", "t8"]).code, 0);
  assert.deepEqual(labelsIn(s).t8, { squad: "ops", bot: ID.dev, category: "eng" });
});

test("start: an edit landing during hc run relabels the new pane; a failed relabel reaches stderr", (t) => {
  const s = scene(t);
  s.seed(team());
  const edited = team();
  edited.bots.find((b) => b.id === ID.dev).rank = "reviewer";
  const st = s.hcState();
  st.onRunWrite = { path: s.botsPath, text: `${JSON.stringify(edited, null, 2)}\n` };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const ok = s.cli(["start", "Dev"]);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(labelsIn(s).t100.role, "reviewer");
  // Again, with the new pane refusing the label.
  s.seed(team());
  const st2 = s.hcState();
  st2.terminals = [];
  st2.failLabel = "t101";
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st2));
  const r = s.cli(["start", "Dev"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /t101's labels role=reviewer weren't set\./);
});

// ---- restart ----

// The replacement must keep its agent in front this long before the old pane ends (5s live).
process.env.AUTOMAGIK_HERDR_RESTART_STABLE_MS = "300";
const SID = "0f3c2a4e-1b2d-4c5e-9f60-718293a4b5c6";
const SID2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ledgerOf = (s) => readLedger(existsSync(ledgerPath(s.app)) ? readFileSync(ledgerPath(s.app), "utf8") : "");
const attachOf = (s) => readRows(existsSync(attachFile(s.app)) ? readFileSync(attachFile(s.app), "utf8") : "").rows;

/** Genie's live pane t5 in the project, placed in sp9/tb3, with a Claude session and a squad. */
function restartScene(t, { status = "idle", extra = [], session = SID, runAs } = {}) {
  const s = scene(t);
  s.seed(team());
  const old = term("t5", { bot: ID.main, cwd: s.project, status });
  old.foreground.cwd = s.project;
  old.labels = { ...old.labels, role: "main", "herdr.space": "sp9", "herdr.tab": "tb3", squad: "core", ...(session ? { "agent.session": session } : {}) };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify({ terminals: [old, ...extra], next: 100, ...(runAs ? { runAs } : {}) }));
  return s;
}
const at = (calls, word, target) => calls.findIndex((c) => c[0] === word && (target === undefined || c[1] === target));

test("restart: the new pane resumes the session in the old one's space and tab, folder and labels; the old one ends only after", (t) => {
  const s = restartScene(t);
  const r = s.cli(["restart", "Genie"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), "t100", "prints the new terminal");
  assert.match(r.err, new RegExp(`Genie: t100 replaces t5, resuming session ${SID}\\.`));
  const calls = s.calls();
  const run = runCall(calls);
  assert.deepEqual(plain(agentWords(run)), ["claude", "--resume", SID]);
  assert.equal(agentWords(run).filter((w) => w === "--append-system-prompt-file").length, 1, "a restart starts with it too, once");
  assert.ok(["herdr.space=sp9", "herdr.tab=tb3", `bot=${ID.main}`, "role=main", "squad=core", `agent.session=${SID}`].every((l) => run.includes(l)), run.join(" "));
  assert.equal(run[run.indexOf("--cwd") + 1], s.project);
  // Started, seen live at several checks (hc get of the new pane), and only then the old one killed.
  const ran = at(calls, "run"), killed = at(calls, "kill", "t5");
  assert.ok(ran >= 0 && ran < killed, JSON.stringify(calls));
  const seen = calls.slice(ran, killed).filter((c) => c[0] === "get" && c[1] === "t100").length;
  assert.ok(seen >= 2, `the new pane was checked before the kill: ${JSON.stringify(calls)}`);
  assert.equal(calls.filter((c) => c[0] === "kill").length, 1);
  const state = s.hcState();
  assert.equal(state.terminals.find((x) => x.address === "t5").state, "finished");
  assert.equal(state.terminals.find((x) => x.address === "t100").state, "live");
  // The attach ledger: t5's binding detached (by start, moved), t100 attached (by start), and
  // exactly one live binding for Genie, on t100.
  const attach = attachOf(s);
  assert.deepEqual(attach.slice(-2).map((x) => [x.event, x.terminal, x.by, x.reason ?? null]), [["detach", "t5", "start", "moved"], ["attach", "t100", "start", null]]);
  const bound = [...foldRows(attach).byKey.values()].filter((b) => b.bot === ID.main);
  assert.deepEqual(bound.map((b) => b.terminal), ["t100"]);
  assert.equal(foldRows(attach).byBot.get(ID.main).terminal, "t100");
  const whois = s.cli(["whois", "--bot", ID.main, "--json"]);
  assert.equal(whois.json().terminal, "t100", whois.err);
  // The seat row and the resumed session's row, for t100.
  const rows = ledgerOf(s).filter((x) => x.terminal === "t100");
  assert.deepEqual(rows.map((x) => [x.event, x.kind ?? x.session]), [["start", "seat"], ["session", SID]]);
  assert.equal(rows[0].project, s.project);
  // A second restart resumes the same conversation: the label went with it (t100 is mid-turn in the fake).
  const again = s.cli(["restart", "Genie", "--force"]);
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(plain(s.calls().filter((c) => c[0] === "run")[1]).slice(-3), ["claude", "--resume", SID]);
});

test("restart refuses a working bot (nothing started or ended) unless --force", (t) => {
  const s = restartScene(t, { status: "working" });
  const r = s.cli(["restart", "Genie"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Genie is working in t5; restarting now would cut its turn in half\. Wait until it is idle, or pass --force\./);
  assert.equal(runCall(s.calls()), undefined);
  assert.equal(at(s.calls(), "kill"), -1);
  const forced = s.cli(["restart", "Genie", "--force"]);
  assert.equal(forced.code, 0, forced.err);
  assert.ok(at(s.calls(), "run") < at(s.calls(), "kill", "t5"));
});

test("restart refuses while a helper would end with the pane; a member bot that outlives it doesn't count", (t) => {
  const worker = { ...term("t7", { argv: ["codex"], app: "codex", parent: "t5" }), die_with_parent: true };
  const member = { ...term("t8", { bot: ID.cap, parent: "t5" }), die_with_parent: false };
  const s = restartScene(t, { extra: [worker, member] });
  const r = s.cli(["restart", "Genie"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /t5 has a helper that ends with it: t7\. Let it finish, pass --tree to restart it too \(resumed, under the new pane\), or pass --force to end it with the pane\./);
  assert.equal(runCall(s.calls()), undefined);
});

test("restart keeps the old pane when the new one never brings its agent up, exits, or exits after coming up", (t) => {
  process.env.AUTOMAGIK_HERDR_RESTART_WAIT_MS = "400";
  t.after(() => { delete process.env.AUTOMAGIK_HERDR_RESTART_WAIT_MS; });
  const s = restartScene(t, { runAs: "shell" });
  assert.equal(s.cli(["whois", "--bot", ID.main, "--json"]).json().terminal, "t5"); // the ledger imported t5
  const before = attachOf(s);
  const r = s.cli(["restart", "Genie"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /t100 didn't keep an agent in front within 0\.4s, so it was ended; t5 still runs Genie, untouched\./);
  assert.deepEqual(s.calls().filter((c) => c[0] === "kill").map((c) => c[1]), ["t100"], "the abandoned pane ended, never t5");
  assert.equal(s.hcState().terminals.find((x) => x.address === "t5").state, "live");
  assert.equal(ledgerOf(s).some((x) => x.terminal === "t100"), false, "no seat row for the abandoned pane");
  assert.deepEqual(attachOf(s).filter((x) => x.event !== "end"), before, "a failed replacement writes no attach rows");
  assert.equal(foldRows(attachOf(s)).byBot.get(ID.main).terminal, "t5");
  const s2 = restartScene(t, { runAs: "exit" });
  const r2 = s2.cli(["restart", "Genie"]);
  assert.equal(r2.code, 1);
  assert.match(r2.err, /t100 exited before its agent was up .*t5 still runs Genie, untouched\. Try automagik-herdr restart b-aaaaaaaaaa --fresh\./);
  assert.equal(at(s2.calls(), "kill"), -1);
  // Its agent in front at the first check, then gone (a stale --resume id): the old pane survives.
  delete process.env.AUTOMAGIK_HERDR_RESTART_WAIT_MS;
  const s3 = restartScene(t, { runAs: "flaky" });
  const r3 = s3.cli(["restart", "Genie"]);
  assert.equal(r3.code, 1);
  assert.match(r3.err, /t100 exited before its agent was up/);
  assert.equal(at(s3.calls(), "kill"), -1);
  assert.equal(s3.hcState().terminals.find((x) => x.address === "t5").state, "live");
  assert.equal(ledgerOf(s3).some((x) => x.terminal === "t100"), false);
  assert.equal(attachOf(s3).some((x) => x.terminal === "t100"), false, "no attach row for the replacement that exited");
  assert.equal(foldRows(attachOf(s3)).byBot.get(ID.main).terminal, "t5");
});

test("restart with no session id known: claude --continue, with a warning; --fresh starts a new conversation", (t) => {
  const s = restartScene(t, { session: "-rf" }); // not a session id: never passed to --resume
  const r = s.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().mode, r.json().replaced, r.json().terminal], ["resume", "t5", "t100"]);
  assert.deepEqual(plain(runCall(s.calls())).slice(-2), ["claude", "--continue"]);
  assert.match(r.err, /No Claude session id was known for t5, so t100 resumes the latest conversation in .* \(--continue\)/);
  const s2 = restartScene(t);
  const fresh = s2.cli(["restart", "Genie", "--fresh", "--json"]);
  assert.equal(fresh.code, 0, fresh.err);
  assert.equal(fresh.json().mode, "fresh");
  assert.deepEqual(plain(agentWords(runCall(s2.calls()))), ["claude"]);
});

test("restart --agent swaps fresh without touching bots.json; --save writes the agent and drops the old pin; --save alone is a usage mistake", (t) => {
  const s = restartScene(t);
  const before = readFileSync(s.botsPath, "utf8");
  const r = s.cli(["restart", "Genie", "--agent", "codex", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().mode, r.json().agent, r.json().saved], ["swap", "codex", false]);
  assert.deepEqual(plain(agentWords(runCall(s.calls()))), ["codex"]);
  assert.equal(readFileSync(s.botsPath, "utf8"), before, "bots.json untouched");
  // Again from the claude pin, written down this time (t100 is mid-turn in the fake: --force).
  const f = team();
  f.bots[0].model = "claude-opus-5-5";
  s.seed(f);
  const saved = s.cli(["restart", "Genie", "--agent", "codex", "--save", "--force"]);
  assert.equal(saved.code, 0, saved.err);
  assert.equal(s.bots().bots[0].agent, "codex");
  assert.equal("model" in s.bots().bots[0], false, "the claude pin is dropped");
  assert.match(saved.err, /bots\.json now says codex/);
  const lone = s.cli(["restart", "Genie", "--save"]);
  assert.equal(lone.code, 2);
  assert.match(lone.err, /--save keeps a swap/);
});

test("restart a codex bot resumes with codex resume --last; a bot not running is started as start does", (t) => {
  const s = scene(t, { terminals: [term("t6", { bot: ID.cap, argv: ["codex"], app: "codex", cwd: "/p" })] });
  const f = team();
  f.bots[1].agent = "codex";
  s.seed(f);
  const r = s.cli(["restart", "Captain", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(plain(runCall(s.calls())).slice(-3), ["codex", "resume", "--last"]);
  assert.equal(r.json().replaced, "t6");
  // Genie isn't running: a plain start, nothing killed but t6.
  const started = s.cli(["restart", "Genie", "--json"]);
  assert.equal(started.code, 0, started.err);
  assert.deepEqual([started.json().mode, started.json().replaced], ["start", null]);
  assert.deepEqual(plain(agentWords(s.calls().filter((c) => c[0] === "run")[1])), ["claude"]);
  assert.deepEqual(s.calls().filter((c) => c[0] === "kill").map((c) => c[1]), ["t6"]);
});

test("restart: the ledger's session row for the old pane stands in for a missing label; beside another bot's Claude, a new conversation, not --continue", (t) => {
  const s = restartScene(t, { session: null });
  mkdirSync(join(s.app, "automagik-herdr"), { recursive: true });
  writeFileSync(ledgerPath(s.app), [{ event: "session", terminal: "t5", session: SID2, transcript: "/x.jsonl" }, { event: "session", terminal: "t6", session: SID }]
    .map((x) => `${JSON.stringify(x)}\n`).join(""));
  const r = s.cli(["restart", "Genie"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(plain(runCall(s.calls())).slice(-3), ["claude", "--resume", SID2]);
  assert.deepEqual(ledgerOf(s).filter((x) => x.terminal === "t100" && x.event === "session").map((x) => [x.session, x.transcript]), [[SID2, "/x.jsonl"]]);
  // No label, no ledger row, and Captain's Claude in the same folder: refused, nothing started.
  const mate = term("t9", { bot: ID.cap, cwd: "" });
  const s2 = restartScene(t, { session: null, extra: [mate] });
  const st = s2.hcState();
  st.terminals.find((x) => x.address === "t9").cwd = s2.project;
  st.terminals.find((x) => x.address === "t9").foreground.cwd = s2.project;
  writeFileSync(join(s2.root, "hc.json"), JSON.stringify(st));
  const r2 = s2.cli(["restart", "Genie", "--json"]);
  assert.equal(r2.code, 0, r2.err);
  assert.equal(r2.json().mode, "fresh");
  assert.equal(r2.json().note, `no Claude session id is known for t5, and Captain (t9) also runs Claude in ${s2.project}, so --continue could resume theirs instead of Genie's`);
  assert.deepEqual(plain(agentWords(runCall(s2.calls()))), ["claude"], "no --continue");
  assert.doesNotMatch(r2.err, /No Claude session id was known/, "no --continue warning: it didn't continue");
});

// ---- #328: two bots on one agent in one folder ----

/**
 * Genie (t5) and Captain (t9) on `agent` in the project folder; `labels`: each pane's agent.session
 * (null: none); `captain`: over Captain's hc get, null for no pane at all; `extra`: more terminals.
 */
function shareScene(t, agent, { labels = [null, null], ledger = [], captain = {}, extra = [] } = {}) {
  const s = scene(t);
  const program = agent === "antigravity" ? "agy" : agent;
  if (agent !== "claude" && agent !== "codex") exe(join(s.root, "bin", program), "#!/bin/sh\nexit 0\n");
  const f = team();
  f.bots[0].agent = agent;
  f.bots[1].agent = agent;
  s.seed(f);
  const pane = (address, b, label, over = {}) => {
    const x = term(address, { bot: b, argv: [program], app: agent, cwd: s.project, ...over });
    if (label) x.labels = { ...x.labels, "agent.session": label };
    return x;
  };
  const terminals = [pane("t5", ID.main, labels[0]), ...(captain === null ? [] : [pane("t9", ID.cap, labels[1], captain)]), ...extra];
  writeFileSync(join(s.root, "hc.json"), JSON.stringify({ terminals, next: 100 }));
  if (ledger.length) {
    mkdirSync(join(s.app, "automagik-herdr"), { recursive: true });
    writeFileSync(ledgerPath(s.app), ledger.map((x) => `${JSON.stringify(x)}\n`).join(""));
  }
  return s;
}
const runsOf = (s) => s.calls().filter((c) => c[0] === "run");
/** A run's agent words without the briefing omp and its kin get at launch (models.js BRIEFING). */
const ownWords = (run) => plain(agentWords(run)).filter((w) => !w.includes("<herdr-bot>"));

test("restart (#328): two bots on omp, then codex, in one folder: each resumes its own session id, from its label or the ledger", (t) => {
  for (const [agent, words] of [["omp", (id) => [`--resume=${id}`]], ["codex", (id) => ["resume", id]]]) {
    const s = shareScene(t, agent, { labels: ["sess-tester", "sess-dev"] });
    const a = s.cli(["restart", "Genie", "--json"]);
    assert.equal(a.code, 0, a.err);
    assert.deepEqual([a.json().mode, a.json().session], ["resume", "sess-tester"], agent);
    assert.deepEqual(ownWords(runsOf(s)[0]), [agent, ...words("sess-tester")], agent);
    assert.ok(runsOf(s)[0].includes("agent.session=sess-tester"), "the new pane keeps its own id for the next restart");
    const b = s.cli(["restart", "Captain", "--json"]);
    assert.equal(b.code, 0, b.err);
    assert.deepEqual([b.json().mode, b.json().session], ["resume", "sess-dev"], agent);
    assert.deepEqual(ownWords(runsOf(s)[1]), [agent, ...words("sess-dev")], agent);
  }
  // No labels: the ledger's session rows, each naming its agent, feed the same ids.
  const s = shareScene(t, "omp", { ledger: [{ event: "session", terminal: "t5", session: "sess-tester", agent: "omp" },
    { event: "session", terminal: "t9", session: "sess-dev", agent: "omp" }] });
  assert.equal(s.cli(["restart", "Genie"]).code, 0);
  assert.equal(s.cli(["restart", "Captain"]).code, 0);
  assert.deepEqual(runsOf(s).map(ownWords), [["omp", "--resume=sess-tester"], ["omp", "--resume=sess-dev"]]);
});

test("restart (#328): omp with no session id beside another bot's omp (its pane, or its seat row) starts fresh and says why; alone, --continue as before", (t) => {
  const s = shareScene(t, "omp");
  const r = s.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().mode, r.json().session], ["fresh", null]);
  const note = `no Oh My Pi session id is known for t5, and Captain (t9) also runs Oh My Pi in ${s.project}, so --continue could resume theirs instead of Genie's`;
  assert.equal(r.json().note, note);
  // The sidebar's Restart shows --json's warnings (restart.js restartAnswer): the why is there too.
  assert.ok(restartAnswer({ code: 0, out: r.json(), err: r.err }).warnings.includes(`Genie starts on a new conversation: ${note}.`), r.err);
  assert.deepEqual(ownWords(runCall(s.calls())), ["omp"], "no --continue");
  const text = shareScene(t, "omp").cli(["restart", "Genie"]);
  assert.equal(text.code, 0, text.err);
  assert.ok(text.err.includes("Genie: t100 replaces t5, a new conversation (no Oh My Pi session id is known for t5, and Captain (t9)"), text.err);
  assert.match(text.err, /also runs Oh My Pi in .*, so --continue could resume theirs instead of Genie's\)\./);
  // Captain's pane shows a shell now, but the workers ledger seated it there on omp: still a sharer.
  const seated = shareScene(t, "omp", { captain: { argv: ["zsh"], app: "zsh" },
    ledger: [{ event: "start", kind: "seat", terminal: "t9", botId: ID.cap, worktree: "", agent: "omp" }] });
  writeFileSync(ledgerPath(seated.app), `${JSON.stringify({ event: "start", kind: "seat", terminal: "t9", botId: ID.cap, worktree: seated.project, agent: "omp" })}\n`);
  const r3 = seated.cli(["restart", "Genie", "--json"]);
  assert.equal(r3.code, 0, r3.err);
  assert.equal(r3.json().mode, "fresh");
  assert.match(r3.json().note, /Captain \(t9\) also runs Oh My Pi/);
  // Captain on another agent, or in another folder: no sharer, so omp --continue as today, with the warning.
  for (const captain of [{ argv: ["codex"], app: "codex" }, { cwd: "/elsewhere" }]) {
    const alone = shareScene(t, "omp", { captain });
    const a = alone.cli(["restart", "Genie", "--json"]);
    assert.equal(a.code, 0, a.err);
    assert.equal(a.json().mode, "resume", JSON.stringify(captain));
    assert.deepEqual(ownWords(runCall(alone.calls())), ["omp", "--continue"]);
    assert.match(a.err, /No Oh My Pi session id was known for t5, so t100 resumes the latest conversation in .* \(--continue\)\. No other bot's Oh My Pi runs there/);
  }
  // --fresh is untouched: a new conversation, no note.
  const f = shareScene(t, "omp").cli(["restart", "Genie", "--fresh", "--json"]);
  assert.deepEqual([f.code, f.json().mode, f.json().note], [0, "fresh", null]);
});

/** Genie's restart in `s`: fresh, no --continue; its note. */
const freshNote = (s) => {
  const r = s.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().mode, "fresh", r.err);
  assert.deepEqual(ownWords(runCall(s.calls())), ["omp"], "no --continue");
  return r.json().note;
};
const fresh = freshNote;

test("restart (#328 review): an ended teammate's seat row in the folder is a sharer; one elsewhere or on another agent isn't", (t) => {
  // Captain's pane is gone (not in hc at all); its last seat row put it here on omp.
  const ended = shareScene(t, "omp", { captain: null,
    ledger: [{ event: "start", kind: "seat", terminal: "t9", botId: ID.cap, worktree: "", agent: "omp" }] });
  writeFileSync(ledgerPath(ended.app), `${JSON.stringify({ event: "start", kind: "seat", terminal: "t9", botId: ID.cap, worktree: ended.project, agent: "omp" })}\n`);
  assert.match(fresh(ended), /Captain \(t9, ended\) also ran Oh My Pi in .*, so --continue could resume theirs instead of Genie's/);
  // A seat row elsewhere, or on another agent, isn't one.
  for (const row of [{ worktree: "/elsewhere", agent: "omp" }, { agent: "codex" }]) {
    const other = shareScene(t, "omp", { captain: null, ledger: [{ event: "start", kind: "seat", terminal: "t9", botId: ID.cap, worktree: "", agent: "omp" }] });
    writeFileSync(ledgerPath(other.app), `${JSON.stringify({ event: "start", kind: "seat", terminal: "t9", botId: ID.cap, worktree: other.project, ...row })}\n`);
    assert.equal(other.cli(["restart", "Genie", "--json"]).json().mode, "resume", JSON.stringify(row));
  }
});

test("restart (#328 review): a teammate's omp inside the keep wrapper is a sharer", (t) => {
  // Captain's omp runs inside the keep wrapper (launchArgs.js unwrapKeep).
  const wrapped = shareScene(t, "omp", { captain: { argv: ["sh", "-c", '"$@"; exec "${SHELL:-sh}" -i', "sh", "omp"] } });
  assert.match(fresh(wrapped), /Captain \(t9\) also runs Oh My Pi/);
});

test("restart (#328 review): an omp started by hand in the folder (no bot) is a sharer", (t) => {
  // No bot label on t12; Captain elsewhere.
  const byHand = shareScene(t, "omp", { captain: { cwd: "/elsewhere" }, extra: [term("t12", { argv: ["omp"], app: "omp", cwd: "" })] });
  const st = byHand.hcState();
  for (const x of st.terminals.filter((x) => x.address === "t12")) { x.cwd = byHand.project; x.foreground.cwd = byHand.project; }
  writeFileSync(join(byHand.root, "hc.json"), JSON.stringify(st));
  assert.match(fresh(byHand), /a pane \(t12\) also runs Oh My Pi in /);
});

test("restart (#328 review): agy's --continue isn't limited to the folder, so another bot's agy anywhere is a sharer", (t) => {
  const s = shareScene(t, "antigravity", { captain: { cwd: "/elsewhere" } });
  const r = s.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().mode, "fresh", r.err);
  assert.equal(r.json().note, "no Antigravity session id is known for t5, and Captain (t9) also runs Antigravity, so --continue could resume theirs "
    + "instead of Genie's (Antigravity's --continue isn't limited to one folder)");
  assert.deepEqual(ownWords(runCall(s.calls())), ["agy"]);
  // Alone on agy: --continue, as before.
  const alone = shareScene(t, "antigravity", { captain: { argv: ["codex"], app: "codex", cwd: "/elsewhere" } });
  const a = alone.cli(["restart", "Genie", "--json"]);
  assert.equal(a.json().mode, "resume", a.err);
  assert.deepEqual(ownWords(runCall(alone.calls())), ["agy", "--continue"]);
});

test("restart (#328 review): a ledger session row from an earlier pane at a reused address is never resumed", (t) => {
  // t5 was created at created_ms 5000; a row stamped before then is another pane's.
  const row = (at) => ({ event: "session", terminal: "t5", session: "old-pane", agent: "omp", at });
  const reused = shareScene(t, "omp", { captain: { argv: ["codex"], app: "codex" }, ledger: [row("1970-01-01T00:00:01.000Z")] });
  const st = reused.hcState();
  st.terminals.find((x) => x.address === "t5").created_ms = 5000;
  writeFileSync(join(reused.root, "hc.json"), JSON.stringify(st));
  const r = reused.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().mode, r.json().session], ["resume", null]);
  assert.deepEqual(ownWords(runCall(reused.calls())), ["omp", "--continue"], "no --resume=old-pane");
  // Stamped after the pane was created: its own, resumed.
  const own = shareScene(t, "omp", { captain: { argv: ["codex"], app: "codex" }, ledger: [row("1970-01-01T00:00:09.000Z")] });
  const st2 = own.hcState();
  st2.terminals.find((x) => x.address === "t5").created_ms = 5000;
  writeFileSync(join(own.root, "hc.json"), JSON.stringify(st2));
  assert.equal(own.cli(["restart", "Genie", "--json"]).json().session, "old-pane");
});

test("restart (#328): an agent with no resume starts fresh as before, a teammate beside it or not", (t) => {
  const s = shareScene(t, "opencode");
  const r = s.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().mode, r.json().note], ["fresh", "opencode has no resume this pack knows"]);
  assert.deepEqual(ownWords(runCall(s.calls())), ["opencode"]);
});

test("a bot restarting itself writes and prints everything before the kill that ends its own pane", (t) => {
  const s = restartScene(t);
  const r = s.cli(["restart", "Genie", "--agent", "codex", "--save", "--json"], { env: { HC_TERMINAL_ID: "t5" } });
  // The fake hc ends the CLI as the real kill of its own pane would: what it printed first stands.
  assert.equal(r.json().terminal, "t100", r.err);
  assert.deepEqual([r.json().replaced, r.json().mode, r.json().saved], ["t5", "swap", true]);
  assert.equal(s.bots().bots[0].agent, "codex", "saved before the kill");
  const calls = s.calls();
  assert.deepEqual(calls.at(-1), ["kill", "t5"], "the kill is the last hc call");
  assert.ok(ledgerOf(s).some((x) => x.terminal === "t100" && x.kind === "seat"));
});

test("restart: the bot attached elsewhere while the new pane came up: the new pane is ended, no rows written, the other binding kept", (t) => {
  const other = term("t9", { bot: null, cwd: "/elsewhere", created: 77 });
  const s = restartScene(t, { extra: [other] });
  assert.equal(s.cli(["whois", "--bot", ID.main, "--json"]).json().terminal, "t5");
  // While hc run starts t100, another CLI attaches Genie to t9 (an attach row, as attach --move writes).
  const rows = attachOf(s);
  const moved = { ...rows.find((x) => x.terminal === "t5"), terminal: "t9", created_ms: 77, by: "attach", at: new Date().toISOString() };
  const st = s.hcState();
  st.onRunWrite = { path: attachFile(s.app), text: [...rows, moved].map((x) => `${JSON.stringify(x)}\n`).join("") };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["restart", "Genie"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Genie was attached to t9 while it restarted, so t100 was ended and nothing changed\./);
  assert.deepEqual(s.calls().filter((c) => c[0] === "kill").map((c) => c[1]), ["t100"]);
  assert.equal(attachOf(s).some((x) => x.terminal === "t100"), false);
  assert.equal(foldRows(attachOf(s)).byBot.get(ID.main).terminal, "t9");
});

// ---- history (#85): what a bot did, by the two ledgers ----

test("history: the bot's panes, starts, sessions (only while it held the pane) and workers; text and --json", (t) => {
  const s = scene(t);
  s.seed(team());
  mkdirSync(join(s.app, "automagik-herdr"), { recursive: true });
  const at = (m) => `2026-11-03T10:0${m}:00.000Z`;
  const row = (event, b, terminal, m, by) => ({ v: 1, event, bot: b, project: s.project, terminal, core: "c1", created_ms: 1, machine: null, by, at: at(m) });
  writeFileSync(attachFile(s.app), [row("attach", ID.dev, "t5", 1, "start"), row("detach", ID.dev, "t5", 3, "detach"), row("attach", ID.cap, "t5", 4, "attach")]
    .map((r) => `${JSON.stringify(r)}\n`).join(""), { mode: 0o600 });
  writeFileSync(ledgerPath(s.app), [
    { event: "start", kind: "seat", terminal: "t5", botId: ID.dev, agent: "claude", model: null, at: at(1) },
    { event: "session", terminal: "t5", session: "11111111-aaaa", transcript: "/x/dev.jsonl", at: at(2) },
    { event: "start", kind: "worker", terminal: "t8", botId: ID.dev, branch: "fix-x", role: "dev", agent: "codex", at: at(2) },
    { event: "session", terminal: "t5", session: "22222222-bbbb", transcript: "/x/captain.jsonl", at: at(5) },
  ].map((r) => `${JSON.stringify(r)}\n`).join(""));
  const json = s.cli(["history", "Dev", "--json"]);
  assert.equal(json.code, 0, json.err);
  const h = json.json();
  assert.equal(h.id, ID.dev);
  assert.equal(h.name, "Dev");
  assert.deepEqual(h.attach.map((r) => r.event), ["attach", "detach"]);
  assert.deepEqual(h.starts.map((r) => r.terminal), ["t5"]);
  assert.deepEqual(h.workers.map((r) => r.branch), ["fix-x"]);
  assert.deepEqual(h.sessions.map((r) => r.session), ["11111111-aaaa"], "Captain's later session in t5 isn't Dev's");
  assert.equal(h.transcript, "/x/dev.jsonl");
  const text = s.cli(["history", "Dev"]);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /^Dev \(b-cccccccccc\)\n {2}what happened\n {4}2026-11-03 10:03 detached from t5 · by detach\n/);
  assert.match(text.out, / {2}workers\n {4}2026-11-03 10:02 fix-x · dev · codex · t8\n/);
  assert.match(text.out, / {2}transcript {3}\/x\/dev\.jsonl/);
  // The ledgers are only read.
  assert.equal(attachOf(s).length, 3);
  assert.equal(ledgerOf(s).length, 4);
});

test("history: no ledgers is an empty history; a removed bot by its bare id; an unknown name is refused", (t) => {
  const s = scene(t);
  s.seed(team());
  assert.match(s.cli(["history", "Studio"]).out, /nothing recorded on this computer/);
  const gone = s.cli(["history", "b-zzzzzzzzzz", "--json"]);
  assert.equal(gone.code, 0, gone.err);
  assert.deepEqual(gone.json(), { id: "b-zzzzzzzzzz", name: null, bot: "b-zzzzzzzzzz", attach: [], starts: [], workers: [], sessions: [], transcript: null });
  assert.match(s.cli(["history", "nobody"]).err, /No bot "nobody"/);
  assert.equal(s.cli(["history"]).code, 2);
});

// ---- restart #213: the old pane's folder, command and session; PATH; --tree ----

/** Captain on `agent` in pane t6 (hc get fields `over`), in project folder `cwd`, with an `omp` on PATH. */
function captainScene(t, { agent = "omp", over = {}, extra = [] } = {}) {
  const s = scene(t);
  const f = team();
  f.bots[1].agent = agent;
  s.seed(f);
  exe(join(s.root, "bin", "omp"), "#!/bin/sh\nexit 0\n");
  const old = { ...term("t6", { bot: ID.cap, app: agent }), ...over };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify({ terminals: [old, ...extra], next: 100 }));
  return s;
}
const runs = (s) => s.calls().filter((c) => c[0] === "run");

test("restart #213: an omp bot from a template, in a worktree, comes back in that folder on the template's command, resumed", (t) => {
  const s0 = scene(t);
  const wt = join(s0.root, "proj.worktrees", "rust-cap");
  mkdirSync(wt, { recursive: true });
  const cmd = 'env PATH="$HOME/.bun/bin:$PATH" omp --auto-approve --model kimi/k3';
  const s = captainScene(t, { over: { cwd: wt, foreground: { argv: ["bun", "/h/.bun/bin/omp", "--auto-approve", "--model", "kimi/k3"], cwd: wt },
    argv: ["sh", "-c", cmd], template: "dev-kimi" } });
  const r = s.cli(["restart", "Captain", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().replaced, r.json().mode, r.json().agent], ["t6", "resume", "omp"]);
  const run = runCall(s.calls());
  assert.equal(run[run.indexOf("--cwd") + 1], wt, "the old pane's folder, not the project's");
  // The template's own command (its env, flags and model), with --continue as a real argument.
  assert.deepEqual(agentWords(run), ["sh", "-c", `${cmd} "$@"`, "sh", "--continue"]);
  // Again (t100 is mid-turn in the fake: --force), now with an omp session id on the pane: the
  // command isn't wrapped twice and the old --continue is dropped.
  const st = s.hcState();
  st.terminals.find((x) => x.address === "t100").labels["agent.session"] = SID2;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const again = s.cli(["restart", "Captain", "--force", "--json"]);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.json().session, SID2);
  const next = runs(s)[1];
  assert.equal(next[next.indexOf("--cwd") + 1], wt);
  assert.deepEqual(agentWords(next), ["sh", "-c", `${cmd} "$@"`, "sh", `--resume=${SID2}`]);
  assert.ok(next.includes(`agent.session=${SID2}`), "the session label goes with it");
});

test("restart #213: a hand-started codex bot keeps its flags and resumes its session by id; the old pane's folder gone: the project's, said", (t) => {
  const s = captainScene(t, { agent: "codex", over: {
    cwd: "/gone/folder", foreground: { argv: ["codex", "-m", "gpt-a", "-c", "model_reasoning_effort=high", "resume", "--last"], cwd: "/gone/folder" },
    argv: ["/usr/bin/env", "PATH=/old", "codex", "-m", "gpt-a", "-c", "model_reasoning_effort=high", "resume", "--last"],
    labels: { bot: ID.cap, "agent.session": SID } } });
  const r = s.cli(["restart", "Captain", "--json"]);
  assert.equal(r.code, 0, r.err);
  const run = runCall(s.calls());
  assert.deepEqual(plain(agentWords(run)), ["codex", "-m", "gpt-a", "-c", "model_reasoning_effort=high", "resume", SID], "a person's own -c stays");
  assert.equal(r.json().session, SID);
  assert.equal(run[run.indexOf("--cwd") + 1], s.project);
  assert.match(r.err, /t6's folder \/gone\/folder isn't there now, so t100 runs in .*; its conversation may not be found there\./);
  assert.equal(ledgerOf(s).some((x) => x.event === "session"), false, "session rows stay Claude's");
});

test("restart #213: the pane always gets the CLI's PATH, so a bare codex (#!/usr/bin/env node) finds the node this PATH has", (t) => {
  const s = captainScene(t, { agent: "codex", over: { foreground: { argv: ["codex"], cwd: "/x" }, argv: ["codex"] } });
  const nodeDir = join(s.root, "node-bin");
  mkdirSync(nodeDir);
  exe(join(nodeDir, "node"), "#!/bin/sh\necho v24.1.0\n");
  exe(join(s.root, "bin", "codex"), "#!/usr/bin/env node\n");
  const path = `${nodeDir}:${join(s.root, "bin")}:/usr/bin:/bin`;
  const r = s.cli(["restart", "Captain", "--json"], { env: { PATH: path } });
  assert.equal(r.code, 0, r.err);
  const run = runCall(s.calls());
  // Before #213 nothing was passed here (this PATH already had node), and the pane got herdr-core's.
  assert.deepEqual(plain(run.slice(run.indexOf("--") + 1)), ["/usr/bin/env", `PATH=${path}`, "codex", "resume", "--last"]);
});

/** Genie in t5 with two helpers that end with it (a worker on omp, a template on omp) and a member bot that outlives it. */
const SID3 = "3c3c3c3c-1b2d-4c5e-9f60-718293a4b5c6";

/**
 * The invariant --tree keeps (#256 reviews), at every fake hc call (the fake's .doubles file) and
 * at the end: no session id (agent.session or revive.session) is on two live panes, but for the
 * bot's own while its new pane proves itself (`bot`: [old, new], both idle then: a restart
 * without --tree has that window too, so a failed new pane leaves the old one running).
 */
function onePanePerSession(s, { bot = ["t5", "t100"] } = {}) {
  const live = new Map();
  for (const x of s.hcState().terminals.filter((y) => y.state === "live")) {
    const id = x.labels?.["agent.session"] ?? x.labels?.["revive.session"];
    if (id) live.set(id, [...(live.get(id) ?? []), x.address]);
  }
  for (const [id, panes] of live) assert.equal(panes.length, 1, `session ${id} is live in ${panes.join(", ")} at the end`);
  const file = join(s.root, "hc.json.doubles");
  const doubles = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  for (const d of doubles) assert.deepEqual(d.panes, bot, `call ${d.call} (${d.word}): session ${d.session} live in ${d.panes.join(", ")}`);
  // The bot's pair only between the new pane's run and the old pane's kill.
  const calls = s.calls();
  const ran = calls.findIndex((c) => c[0] === "run" && c.includes(`agent.session=${SID}`));
  const killed = calls.findIndex((c) => c[0] === "kill" && c[1] === bot[0]);
  // d.call counts the fake's calls from 1, itself included, and sees the state before it acts: call ran+1 is the run itself.
  for (const d of doubles) assert.ok(d.call - 1 > ran && d.call - 1 <= killed, `call ${d.call} (${d.word}) outside the up-check (run ${ran}, kill ${killed})`);
}

/** treeScene with `third`: a codex helper t10 ("probe", session SID3) in a third folder, after t7 and t8. */
function treeScene(t, { workerStatus = "idle", third = false } = {}) {
  const s = restartScene(t);
  exe(join(s.root, "bin", "omp"), "#!/bin/sh\nexit 0\n");
  const wt1 = join(s.root, "proj.worktrees", "fix-213"), wt2 = join(s.root, "proj.worktrees", "review");
  mkdirSync(wt1, { recursive: true });
  mkdirSync(wt2, { recursive: true });
  const worker = { ...term("t7", { argv: ["bun", "/h/.bun/bin/omp", "--model=kimi/k3", "--thinking=high", "do the task"], app: "omp", cwd: wt1, parent: "t5", status: workerStatus }),
    name: "fix-213-dev", die_with_parent: true, argv: ["/usr/bin/env", "PATH=/x", "omp", "--model=kimi/k3", "--thinking=high", "do the task"],
    labels: { "worker.of": ID.main, branch: "fix/213", "worker.role": "dev", "worker.model": "kimi/k3", "worker.effort": "high" } };
  const reviewer = { ...term("t8", { argv: ["omp", "--auto-approve", "--model", "deepseek/flash"], app: "omp", cwd: wt2, parent: "t5" }),
    name: "rev-1", die_with_parent: true, argv: ["sh", "-c", "omp --auto-approve --model deepseek/flash"], template: "reviewer-flash",
    labels: { where: "Brain / review", "revive.agent": "omp", "revive.session": SID2 } };
  const member = { ...term("t9", { bot: ID.cap, parent: "t5" }), die_with_parent: false };
  const st = s.hcState();
  st.terminals.push(worker, reviewer, member);
  const wt3 = join(s.root, "proj.worktrees", "probe");
  if (third) {
    mkdirSync(wt3, { recursive: true });
    st.terminals.push({ ...term("t10", { argv: ["codex", "-m", "gpt-a"], app: "codex", cwd: wt3, parent: "t5" }), name: "probe", die_with_parent: true,
      argv: ["codex", "-m", "gpt-a"], labels: { "agent.session": SID3 } });
  }
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  mkdirSync(join(s.app, "automagik-herdr"), { recursive: true });
  writeFileSync(ledgerPath(s.app), `${JSON.stringify({ event: "start", kind: "worker", terminal: "t7", pid: 1, botId: ID.main, task: "fix-213", branch: "fix/213",
    project: s.project, lead: ID.main, worktree: wt1, agent: "omp", model: "kimi/k3", effort: "high", template: null, role: "dev" })}\n`);
  return { s, wt1, wt2, wt3 };
}

test("restart --tree: the helpers that end with the bot run again under its new pane, each in its folder, on its command, resumed", (t) => {
  const { s, wt1, wt2 } = treeScene(t);
  const r = s.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().terminal, "t100");
  assert.deepEqual(r.json().helpers.map((h) => [h.name, h.replaced, h.terminal, h.agent, h.mode, h.up, h.error]),
    [["fix-213-dev", "t7", "t101", "omp", "resume", true, null], ["rev-1", "t8", "t102", "omp", "resume", true, null]]);
  const [, w, v] = runs(s);
  // The worker: rebuilt from its ledger row, so its task isn't sent again; its name, folder and labels kept.
  assert.deepEqual([w[w.indexOf("--name") + 1], w[w.indexOf("--cwd") + 1], w[w.indexOf("--parent") + 1]], ["fix-213-dev", wt1, "t100"]);
  assert.ok(["worker.of=b-aaaaaaaaaa", "branch=fix/213", "worker.role=dev"].every((l) => w.includes(l)), w.join(" "));
  assert.deepEqual(agentWords(w), ["omp", "--model=kimi/k3", "--thinking=high", "--continue"]);
  // The template helper: its own command, resumed.
  assert.deepEqual([v[v.indexOf("--name") + 1], v[v.indexOf("--cwd") + 1], v[v.indexOf("--parent") + 1]], ["rev-1", wt2, "t100"]);
  // The template helper: its own command, resumed by the session a reviver keeps in revive.session.
  assert.deepEqual(agentWords(v), ["sh", "-c", 'omp --auto-approve --model deepseek/flash "$@"', "sh", `--resume=${SID2}`]);
  // The old helpers end before their replacements start; the old pane last.
  const calls = s.calls();
  const killAt = (x) => at(calls, "kill", x), runAt = (name) => calls.findIndex((c) => c[0] === "run" && c.includes(name));
  // The old pane ends (its helpers with it) before any helper runs again; none is killed on its own.
  assert.ok(killAt("t5") > 0 && killAt("t5") < runAt("fix-213-dev") && runAt("fix-213-dev") < runAt("rev-1"), JSON.stringify(calls));
  assert.deepEqual([killAt("t7"), killAt("t8")], [-1, -1]);
  const state = s.hcState();
  assert.deepEqual(["t5", "t7", "t8", "t9", "t101", "t102"].map((x) => state.terminals.find((y) => y.address === x).state),
    ["finished", "finished", "finished", "live", "live", "live"], "the member bot that outlives the pane is left alone");
  // The worker's ledger row goes to its new terminal; helpers get no attach rows (they are no bots).
  assert.deepEqual(ledgerOf(s).filter((x) => x.terminal === "t101").map((x) => [x.kind, x.task, x.agent, x.model, x.effort]), [["worker", "fix-213", "omp", "kimi/k3", "high"]]);
  assert.equal(attachOf(s).some((x) => ["t101", "t102"].includes(x.terminal)), false);
  onePanePerSession(s);
  const text = treeScene(t).s.cli(["restart", "Genie", "--tree"]);
  assert.equal(text.code, 0, text.err);
  const lines = text.err.split("\n");
  assert.ok(lines.includes(`automagik-herdr: Genie's helper fix-213-dev: t101 replaces t7, resuming its last conversation (--continue).`), text.err);
  assert.ok(lines.includes(`automagik-herdr: Genie's helper rev-1: t102 replaces t8, resuming session ${SID2} (--resume=${SID2}).`), text.err);
  assert.equal(text.code, 0);
});

test("restart --tree waits, before anything starts, for helpers and the old pane to be idle: a turn's note types into the old pane only then; still mid-turn after the wait refuses", (t) => {
  const busy = treeScene(t, { workerStatus: "working" }).s;
  const st = busy.hcState();
  st.terminals.find((x) => x.address === "t7").idleAfterGets = 2; // its turn ends during the wait: a note into t5, whose agent takes a turn
  writeFileSync(join(busy.root, "hc.json"), JSON.stringify(st));
  const r = busy.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().helpers.map((h) => [h.replaced, h.up]), [["t7", true], ["t8", true]]);
  const calls = busy.calls();
  const ran = calls.findIndex((c) => c[0] === "run");
  const notes = busy.hcState().notes ?? [];
  assert.deepEqual(notes.map((n) => [n.to, n.from]), [["t5", "t7"]]);
  assert.ok(notes.every((n) => n.call < ran), "the note went in, and t5's turn ended, before the new pane started");
  assert.ok(calls.slice(0, ran).filter((c) => c[0] === "get" && c[1] === "t5").length >= 3, "t5's own turn was waited for too");
  onePanePerSession(busy);
  // Still mid-turn when the wait runs out: refused, nothing started or ended.
  const stays = treeScene(t, { workerStatus: "working" }).s;
  const w = stays.cli(["restart", "Genie", "--tree"], { env: { AUTOMAGIK_HERDR_TREE_TURN_WAIT_MS: "1000" } });
  assert.equal(w.code, 1);
  assert.match(w.err, /t7 was still mid-turn 1s later\. Nothing was started: restart once it is idle, or pass --force to cut its turn\./);
  assert.equal(runCall(stays.calls()), undefined);
  assert.equal(at(stays.calls(), "kill"), -1);
  // From inside a helper, or inside the old pane (which --tree ends before its helpers run again): refused.
  const inside = treeScene(t).s;
  const me = inside.cli(["restart", "Genie", "--tree"], { env: { HC_TERMINAL_ID: "t7" } });
  assert.equal(me.code, 1);
  assert.match(me.err, /This runs in t7, one of t5's helpers, which --tree ends and runs again: run it from another terminal\./);
  const self = inside.cli(["restart", "Genie", "--tree"], { env: { HC_TERMINAL_ID: "t5" } });
  assert.equal(self.code, 1);
  assert.match(self.err, /This runs in t5, the pane --tree ends before its helpers run again: run restart --tree from another terminal\./);
  assert.equal(runCall(inside.calls()), undefined);
  // --force alone (no --tree): the helpers end with the pane, as before.
  const forced = treeScene(t).s;
  const f = forced.cli(["restart", "Genie", "--force", "--json"]);
  assert.equal(f.code, 0, f.err);
  assert.equal(runs(forced).length, 1, "only the bot runs again");
  assert.equal("helpers" in f.json(), false);
  assert.deepEqual(["t7", "t8"].map((x) => forced.hcState().terminals.find((y) => y.address === x).state), ["finished", "finished"]);
});

test("restart --tree: a helper whose turn starts and ends once the new pane is up types into no pane older than it (the old one has ended)", (t) => {
  const s = treeScene(t).s;
  const st = s.hcState();
  // t8 starts a turn as the bot's new pane starts (the 1st hc run) and ends it on its own clock at
  // the 2nd hc run (the first helper's), looked at or not. Had the old pane still run then (a
  // tree that runs helpers again before ending it), the note would go into t5.
  st.workingOnRun = ["t8"];
  st.terminals.find((x) => x.address === "t8").endTurnOn = { word: "run", nth: 2 };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 0, r.err);
  const calls = s.calls();
  const ran = calls.findIndex((c) => c[0] === "run");
  const notes = (s.hcState().notes ?? []).filter((n) => n.call - 1 > ran);
  assert.deepEqual(notes.filter((n) => !["t100", "t101", "t102"].includes(n.to)), [], `a note went into an old pane: ${JSON.stringify(notes)}`);
  assert.deepEqual(r.json().helpers.map((h) => [h.replaced, h.up]), [["t7", true], ["t8", true]]);
  onePanePerSession(s);
});

test("restart --tree: a helper that is itself a bot (started under the pane, then attached) keeps its binding: moved to its new terminal", (t) => {
  const s = restartScene(t);
  const wt = join(s.root, "proj.worktrees", "dev");
  mkdirSync(wt, { recursive: true });
  const dev = { ...term("t8", { bot: ID.dev, parent: "t5", cwd: wt }), die_with_parent: true, argv: ["claude", "--model", "m"] };
  const st = s.hcState();
  st.terminals.push(dev);
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  assert.equal(s.cli(["whois", "--bot", ID.dev, "--json"]).json().terminal, "t8", "the ledger imported t8 for Dev");
  const r = s.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().helpers.map((h) => [h.replaced, h.terminal, h.bot, h.up]), [["t8", "t101", ID.dev, true]]);
  assert.deepEqual(agentWords(runs(s)[1]), ["claude", "--model", "m", "--continue"]);
  const rows = attachOf(s).filter((x) => x.bot === ID.dev);
  assert.deepEqual(rows.slice(-2).map((x) => [x.event, x.terminal, x.by, x.reason ?? null]), [["detach", "t8", "start", "moved"], ["attach", "t101", "start", null]]);
  assert.equal(s.cli(["whois", "--bot", ID.dev, "--json"]).json().terminal, "t101");
  assert.deepEqual(ledgerOf(s).filter((x) => x.terminal === "t101").map((x) => [x.kind, x.botId, x.worktree]), [["seat", ID.dev, wt]]);
});

// ---- restart --tree: shared folders and failure paths (#256 review) ----

/** Genie's t5 with six codex helpers of one template in one folder (as t2p6's integrators), each with `labels(n)`. */
function sixScene(t, labels = () => ({})) {
  const s = restartScene(t);
  const wt = join(s.root, "proj.worktrees", "integration");
  mkdirSync(wt, { recursive: true });
  const cmd = 'env PATH="$HOME/.bun/bin:$PATH" codex --no-daemon -m gpt-6.1-sol -c model_reasoning_effort=high';
  const names = ["acc-262", "acc-261b", "acc-218", "acc-264b", "acc-265", "e8-v16b"];
  const st = s.hcState();
  names.forEach((name, n) => st.terminals.push({ ...term(`t${20 + n}`, { argv: ["codex", "--no-daemon", "-m", "gpt-6.1-sol"], app: "codex", cwd: wt, parent: "t5" }),
    name, die_with_parent: true, argv: ["sh", "-c", cmd], template: "integrator", labels: { where: "Brain / Integrator", ...labels(n) } }));
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  return { s, wt, cmd, names };
}
const idOf = (n) => `01a1a160-cb95-74a2-b6ad-6b0a3ae94f1${n}`;

test("restart --tree: six codex helpers in one folder resume each its own session (revive.session); with none known, refused, or fresh with --fresh-shared", (t) => {
  const { s, wt, cmd, names } = sixScene(t, (n) => ({ "revive.agent": "codex", "revive.session": idOf(n), "revive.cwd": "x" }));
  const r = s.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().helpers.map((h) => [h.name, h.session, h.mode, h.up]), names.map((name, n) => [name, idOf(n), "resume", true]));
  assert.deepEqual(runs(s).slice(1).map((w) => [w[w.indexOf("--cwd") + 1], ...agentWords(w).slice(-2)]), names.map((_, n) => [wt, "resume", idOf(n)]));
  assert.ok(runs(s).slice(1).every((w) => agentWords(w)[2] === `${cmd} "$@"`));
  onePanePerSession(s);
  // None known: every one of them would take the folder's latest. Refused before anything starts.
  const bare = sixScene(t).s;
  const refused = bare.cli(["restart", "Genie", "--tree"]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, new RegExp(`${names.join(", ")} would resume the latest codex conversation in .*integration \\(no session id\\), `
    + `which ${names.join(", ")} all use: one could pick up another's\\. Nothing was started\\. Give each an agent\\.session label, or pass --fresh-shared`));
  assert.equal(runCall(bare.calls()), undefined);
  assert.equal(at(bare.calls(), "kill"), -1);
  // --fresh-shared: each starts its own new conversation, with its command, and says why.
  const fresh = bare.cli(["restart", "Genie", "--tree", "--fresh-shared", "--json"]);
  assert.equal(fresh.code, 0, fresh.err);
  assert.deepEqual(fresh.json().helpers.map((h) => [h.mode, h.session]), names.map(() => ["fresh", null]));
  assert.match(fresh.json().helpers[0].note, /no session id, and its folder .*integration has other codex sessions \(--fresh-shared\)/);
  assert.ok(runs(bare).slice(1).every((w) => JSON.stringify(agentWords(w)) === JSON.stringify(["sh", "-c", cmd])));
  assert.equal(s.cli(["restart", "Genie", "--fresh-shared"]).code, 2, "--fresh-shared goes with --tree");
});

/** The resume line --tree printed (its hc run line), checked to parse as sh, then run as sh would split it. */
function pastedLine(t, line) {
  const r = spawnSync("sh", ["-n", "-c", line], { encoding: "utf8" });
  assert.equal(r.status, 0, `sh -n rejects: ${line}\n${r.stderr}`);
  const words = spawnSync("sh", ["-c", `for w in ${line.replace(/^hc /, "")}; do printf '%s\\0' "$w"; done`], { encoding: "utf8" });
  return words.stdout.split("\0").slice(0, -1);
}

test("restart --tree: hc run failing for helper 2 of 3: helpers 1 and 3 run again, the old pane ends, helper 2's line runs as pasted, exit 1", (t) => {
  const { s, wt2 } = treeScene(t, { third: true });
  const st = s.hcState();
  st.failRun = ["rev-1"];
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 1, "the bot and two helpers restarted, one didn't");
  assert.equal(r.json().terminal, "t100");
  assert.deepEqual(r.json().helpers.map((h) => [h.replaced, h.terminal, h.up, Boolean(h.error)]), [["t7", "t101", true, false], ["t8", null, false, true], ["t10", "t102", true, false]]);
  const line = r.json().helpers[1].by_hand;
  // The same words the restart ran for it: its name, folder, labels, parent, the seat's PATH and its command, resumed.
  const tried = s.calls().find((c) => c[0] === "run" && c.includes("rev-1"));
  assert.deepEqual(pastedLine(t, line), tried);
  assert.deepEqual([tried[tried.indexOf("--cwd") + 1], tried[tried.indexOf("--parent") + 1]], [wt2, "t100"]);
  assert.ok(tried.includes(`revive.session=${SID2}`) && tried.includes("/usr/bin/env") && tried.some((w) => w.startsWith("PATH=")), tried.join(" "));
  assert.deepEqual(agentWords(tried).slice(-2), ["sh", `--resume=${SID2}`]);
  assert.ok(r.err.includes(`t8 (rev-1) wasn't run again: hc run failed (hc: can't start rev-1). Its conversation is kept; to run it again by hand:\n`
    + `automagik-herdr:   ${line}\n`) || r.err.includes(`  ${line}\n  # resumes session ${SID2}`), r.err);
  assert.match(r.err, new RegExp(`# resumes session ${SID2}`));
  assert.deepEqual(agentWords(runs(s).at(-1)), ["codex", "-m", "gpt-a", "resume", SID3], "helper 3 resumed by its id");
  const state = s.hcState();
  assert.deepEqual(["t5", "t7", "t8", "t10", "t100", "t101", "t102"].map((x) => state.terminals.find((y) => y.address === x).state),
    ["finished", "finished", "finished", "finished", "live", "live", "live"], "the old pane always ends");
  onePanePerSession(s);
});

test("restart --tree: a helper that survives its parent's end (and its kill) is said, never run twice nor offered by hand; one never up, or that hc can't read, is reported", (t) => {
  // t7 outlives t5's end and its own kill fails: it holds its session, so no second pane and no hand line.
  const stuck = treeScene(t).s;
  const st = stuck.hcState();
  st.surviveParent = ["t7"];
  st.failKill = "t7";
  writeFileSync(join(stuck.root, "hc.json"), JSON.stringify(st));
  const k = stuck.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(k.code, 1);
  assert.match(k.err, /t7 \(fix-213-dev\) it still runs after its parent ended \(hc kill t7 failed: kill refused on t7\): it holds its session, so it isn't run again/);
  assert.deepEqual(k.json().helpers.map((h) => [h.replaced, h.up, h.still_running, h.by_hand]), [["t7", false, true, null], ["t8", true, false, null]]);
  assert.equal(runs(stuck).filter((c) => c.includes("fix-213-dev")).length, 0, "t7 never started twice");
  assert.deepEqual(["t5", "t7"].map((x) => stuck.hcState().terminals.find((y) => y.address === x).state), ["finished", "live"]);
  onePanePerSession(stuck);
  // A helper that survives its parent but ends on its own kill: run again.
  const once = treeScene(t).s;
  const st1 = once.hcState();
  st1.surviveParent = ["t7"];
  writeFileSync(join(once.root, "hc.json"), JSON.stringify(st1));
  const o = once.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(o.code, 0, o.err);
  assert.ok(at(once.calls(), "kill", "t7") > at(once.calls(), "kill", "t5"));
  assert.deepEqual(o.json().helpers.map((h) => h.up), [true, true]);
  // Never up: reported with its line, which parses.
  process.env.AUTOMAGIK_HERDR_RESTART_WAIT_MS = "400";
  t.after(() => { delete process.env.AUTOMAGIK_HERDR_RESTART_WAIT_MS; });
  const late = treeScene(t).s;
  const st2 = late.hcState();
  st2.runAsFor = { "fix-213-dev": "shell" };
  writeFileSync(join(late.root, "hc.json"), JSON.stringify(st2));
  const r = late.cli(["restart", "Genie", "--tree", "--json"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /t7 \(fix-213-dev\) wasn't run again: t101 didn't keep an agent in front within 0\.4s, so it was ended\. Its conversation is kept/);
  assert.match(r.err, /# a worker: its workers-ledger row \(task fix-213\) isn't copied/);
  pastedLine(t, r.json().helpers[0].by_hand);
  assert.deepEqual(["t101", "t102", "t5"].map((x) => late.hcState().terminals.find((y) => y.address === x).state), ["finished", "live", "finished"]);
  onePanePerSession(late);
  // hc get of t7 fails once the bot's pane starts: unknown is not gone; no second copy.
  const blind = treeScene(t).s;
  const st3 = blind.hcState();
  st3.failGetOnRun = ["t7"];
  writeFileSync(join(blind.root, "hc.json"), JSON.stringify(st3));
  const b = blind.cli(["restart", "Genie", "--tree"]);
  assert.equal(b.code, 1);
  assert.match(b.err, /t7 \(fix-213-dev\) wasn't run again: hc get t7 failed \(hc: server error reading t7\), so it may still run; with it possibly running, a second copy would share its session\./);
  assert.equal(runs(blind).filter((c) => c.includes("fix-213-dev")).length, 0);
  assert.equal(blind.hcState().terminals.find((y) => y.address === "t5").state, "finished");
});

test("restart --tree refuses before anything starts: a gone folder, a helper hc can't read, a helper's own helpers, one session named twice", (t) => {
  const { s: gone, wt2 } = treeScene(t);
  rmSync(wt2, { recursive: true });
  const g = gone.cli(["restart", "Genie", "--tree"]);
  assert.equal(g.code, 1);
  assert.match(g.err, new RegExp(`t8's folder ${wt2} isn't there\\. Nothing was started\\.`));
  assert.equal(runCall(gone.calls()), undefined);
  const blind = treeScene(t).s;
  const st = blind.hcState();
  st.failGet = ["t8"];
  writeFileSync(join(blind.root, "hc.json"), JSON.stringify(st));
  const b = blind.cli(["restart", "Genie", "--tree"]);
  assert.equal(b.code, 1);
  assert.match(b.err, /hc get t8 failed \(hc: server error reading t8\): --tree can't check t5's helper\. Nothing was started\./);
  assert.equal(runCall(blind.calls()), undefined);
  const nest = treeScene(t).s;
  const st4 = nest.hcState();
  st4.terminals.push({ ...term("t30", { argv: ["codex"], app: "codex", parent: "t7" }), die_with_parent: true });
  writeFileSync(join(nest.root, "hc.json"), JSON.stringify(st4));
  const n = nest.cli(["restart", "Genie", "--tree"]);
  assert.equal(n.code, 1);
  assert.match(n.err, /--tree restarts t5's helpers, not theirs: t30 \(under t7\) would end with its parent and not run again\. Nothing was started\./);
  assert.equal(runCall(nest.calls()), undefined);
  const f = nest.cli(["restart", "Genie", "--tree", "--force"]);
  assert.equal(f.code, 0, f.err);
  assert.match(f.err, /--force: t30 \(under t7\) ends with its parent and isn't run again\./);
  // t8 labelled with Genie's own session: two panes would run it.
  const dup = treeScene(t).s;
  const st5 = dup.hcState();
  st5.terminals.find((x) => x.address === "t8").labels["revive.session"] = SID;
  writeFileSync(join(dup.root, "hc.json"), JSON.stringify(st5));
  const d = dup.cli(["restart", "Genie", "--tree"]);
  assert.equal(d.code, 1);
  assert.match(d.err, new RegExp(`Genie and rev-1 would all resume session ${SID}: one session runs in one pane\\. Nothing was started\\.`));
  assert.equal(runCall(dup.calls()), undefined);
});

test("restart --tree: a helper bot whose attach row can't be written runs, and is named with the attach to run; exit 1", (t) => {
  const s = restartScene(t);
  const wt = join(s.root, "proj.worktrees", "dev");
  mkdirSync(wt, { recursive: true });
  const st = s.hcState();
  st.terminals.push({ ...term("t8", { bot: ID.dev, parent: "t5", cwd: wt }), die_with_parent: true, argv: ["claude"] });
  st.noCreated = ["t8"]; // its replacement (named t8 too) has no created_ms: attachMoved can't be given one
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  assert.equal(s.cli(["whois", "--bot", ID.dev, "--json"]).json().terminal, "t8");
  const r = s.cli(["restart", "Genie", "--tree"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /t8 runs again in t101, but bot b-cccccccccc's attach row wasn't written \(hc get gave no created_ms for t101\): automagik-herdr attach b-cccccccccc t101\./);
  assert.equal(s.hcState().terminals.find((y) => y.address === "t101").state, "live");
});

test("restart: the pane's PATH leaves out the caller's venv, node_modules/.bin and folders under the project, and always has /usr/bin and /bin", (t) => {
  const s = captainScene(t, { agent: "codex", over: { foreground: { argv: ["codex"], cwd: "/x" }, argv: ["codex"] } });
  const bin = join(s.root, "bin");
  const path = [join(s.project, ".venv/bin"), join(s.project, "node_modules/.bin"), "/opt/tool/node_modules/.bin", "/v/env/bin", bin].join(":");
  const r = s.cli(["restart", "Captain", "--json"], { env: { PATH: path, VIRTUAL_ENV: "/v/env" } });
  assert.equal(r.code, 0, r.err);
  const run = runCall(s.calls());
  assert.equal(run[run.indexOf("--") + 2], `PATH=${bin}:/usr/bin:/bin`);
});

test("attach by a pane's name writes hc's terminal id, so whois by id finds it (#261 review)", (t) => {
  const s = scene(t);
  s.seed(team());
  const st = JSON.parse(readFileSync(join(s.root, "hc.json"), "utf8"));
  st.terminals = [{ ...term("t4", { cwd: s.project }), name: "mypane" }];
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["attach", "Genie", "mypane", "--json"]);
  assert.equal(r.code, 0, r.err);
  const w = s.cli(["whois", "t4", "--json"]);
  assert.equal(w.json().bot, ID.main);
  assert.equal(w.json().terminal, "t4");
});

test("restart --cwd: a folder of the same Claude slug resumes the session by id there; another slug is refused unless --fresh; helpers keep their folders", (t) => {
  const s = restartScene(t);
  const from = join(s.root, "repos", "automagik-herdr"), to = join(s.root, "repos", "automagik", "herdr"), other = join(s.root, "elsewhere");
  for (const d of [from, to, other]) mkdirSync(d, { recursive: true });
  const st = s.hcState();
  const t5 = st.terminals.find((x) => x.address === "t5");
  t5.cwd = from;
  t5.foreground.cwd = from;
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  // automagik-herdr and automagik/herdr: one slug, so Claude finds the session in the new folder.
  const r = s.cli(["restart", "Genie", "--cwd", to, "--json"]);
  assert.equal(r.code, 0, r.err);
  const run = runCall(s.calls());
  assert.equal(run[run.indexOf("--cwd") + 1], to);
  assert.deepEqual(plain(agentWords(run)), ["claude", "--resume", SID]);
  assert.deepEqual([r.json().mode, r.json().session, r.json().replaced], ["resume", SID, "t5"]);
  // Another slug: refused, nothing started or ended; --fresh starts a new conversation there.
  const s2 = restartScene(t);
  const st2 = s2.hcState();
  Object.assign(st2.terminals.find((x) => x.address === "t5"), { cwd: from, foreground: { ...st2.terminals[0].foreground, cwd: from } });
  writeFileSync(join(s2.root, "hc.json"), JSON.stringify(st2));
  const refused = s2.cli(["restart", "Genie", "--cwd", other]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, new RegExp(`Claude keeps Genie's conversation under its folder's slug, .*automagik-herdr \\(.*\\); .*elsewhere is .*-elsewhere, `
    + `so a resume there would find nothing\\. Nothing was started\\. Restart with --fresh`));
  assert.equal(runCall(s2.calls()), undefined);
  assert.equal(at(s2.calls(), "kill"), -1);
  const fresh = s2.cli(["restart", "Genie", "--cwd", other, "--fresh", "--json"]);
  assert.equal(fresh.code, 0, fresh.err);
  const run2 = runCall(s2.calls());
  assert.equal(run2[run2.indexOf("--cwd") + 1], other);
  assert.deepEqual([plain(agentWords(run2)), fresh.json().mode], [["claude"], "fresh"]);
  // Not a folder: a usage mistake.
  assert.equal(s2.cli(["restart", "Genie", "--cwd", join(s2.root, "nope")]).code, 2);
  // --tree --cwd: the bot moves, its helpers run again in their own folders.
  const { s: tr, wt1, wt2 } = treeScene(t);
  const moved = join(tr.root, "moved");
  mkdirSync(moved);
  const tree = tr.cli(["restart", "Genie", "--tree", "--cwd", moved, "--fresh", "--json"]);
  assert.equal(tree.code, 0, tree.err);
  const [bot, w, v] = runs(tr);
  assert.deepEqual([bot, w, v].map((c) => c[c.indexOf("--cwd") + 1]), [moved, wt1, wt2]);
  onePanePerSession(tr);
});

test("restart --cwd: a non-Claude resume into another folder is said; --cwd with --machine is refused; a Claude bot's briefing hook goes into DIR", (t) => {
  const from = "/never/used";
  const s = captainScene(t, { agent: "codex", over: { foreground: { argv: ["codex"], cwd: from }, argv: ["codex"], cwd: from } });
  const a = join(s.root, "a"), b = join(s.root, "b");
  mkdirSync(a);
  mkdirSync(b);
  const st = s.hcState();
  Object.assign(st.terminals.find((x) => x.address === "t6"), { cwd: a, foreground: { argv: ["codex"], cwd: a } });
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const r = s.cli(["restart", "Captain", "--cwd", b, "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, new RegExp(`t100 runs in ${b}, not ${a}: codex finds its last conversation by folder, so it may not find it there\\.`));
  const run = runCall(s.calls());
  assert.deepEqual([run[run.indexOf("--cwd") + 1], ...plain(agentWords(run))], [b, "codex", "resume", "--last"]);
  // --machine: refused before anything is read or started, whatever DIR is.
  const m = s.cli(["restart", "Captain", "--machine", "box", "--cwd", b]);
  assert.equal(m.code, 2);
  assert.match(m.err, /--cwd is a folder on this computer; a restart on a linked machine keeps the old pane's\./);
  assert.equal(runs(s).length, 1, "nothing more started");
  // Claude: the briefing hook is written into DIR, as the help says.
  const c = restartScene(t);
  const dir = join(c.root, "moved");
  mkdirSync(dir);
  const moved = c.cli(["restart", "Genie", "--cwd", dir, "--fresh"]);
  assert.equal(moved.code, 0, moved.err);
  const hook = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
  assert.match(hook.hooks.UserPromptSubmit[0].hooks[0].command, /briefing\.mjs/);
});

// ---- the briefing in each agent's command: once, right after the executable ----

/** A scene whose main bot runs `agent` (a stand-in executable on PATH), started once. */
function agentScene(t, agent, { config = null } = {}) {
  const s = scene(t);
  exe(join(s.root, "bin", agent), "#!/bin/sh\nexit 0\n");
  if (config) { mkdirSync(join(s.home, dirname(config.path)), { recursive: true }); writeFileSync(join(s.home, config.path), config.text); }
  const file = team();
  file.bots[0].agent = agent;
  s.seed(file);
  return s;
}
const briefingWords = (words) => words.map((w, i) => [w, i]).filter(([w]) => w.includes("<herdr-bot>"));

test("start: omp, pi and grok get the briefing once, as the word or value right after their executable", (t) => {
  for (const [agent, flag] of [["omp", null], ["pi", "--append-system-prompt"], ["grok", "--rules"]]) {
    const s = agentScene(t, agent);
    const r = s.cli(["start", "Genie", "--json"]);
    assert.equal(r.code, 0, r.err);
    const words = agentWords(runCall(s.calls()));
    assert.equal(words[0], agent);
    const found = briefingWords(words);
    assert.equal(found.length, 1, `${agent}: one copy`);
    if (flag) assert.deepEqual([words[1], found[0][1]], [flag, 2], `${agent}: ${flag} <text> first`);
    else assert.deepEqual([found[0][1], found[0][0].startsWith("--append-system-prompt=<herdr-bot>\n")], [1, true]);
    assert.match(found[0][0], /You are Genie, this project's main bot/);
  }
});

test("restart: an omp bot's command reused keeps one briefing, the new one, and its own flags", (t) => {
  const s = agentScene(t, "omp");
  assert.equal(s.cli(["start", "Genie", "--json"]).code, 0);
  const first = agentWords(runCall(s.calls()));
  const st = s.hcState();
  const pane = st.terminals.find((x) => x.labels?.bot === ID.main);
  pane.argv = ["/usr/bin/env", "PATH=/bin", "omp", "--thinking=high", ...first.slice(1)];
  pane.foreground = { argv: ["omp", "--thinking=high", ...first.slice(1)], cwd: s.project };
  pane.status = { app: "omp", state: "idle" };
  writeFileSync(join(s.root, "hc.json"), JSON.stringify(st));
  const file = s.bots();
  file.bots[0].instructions = "Edited.";
  s.seed(file);
  const r = s.cli(["restart", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  const words = agentWords(s.calls().filter((c) => c[0] === "run").at(-1));
  const found = briefingWords(words);
  assert.equal(found.length, 1, "never twice");
  assert.equal(found[0][1], 1, "right after the executable");
  assert.match(found[0][0], /Edited\./, "the new text, not the old");
  assert.ok(words.includes("--thinking=high"), "its own flag kept");
});

test("start: hermes gets the briefing in its environment, unless its config sets its own prompt (then a warning)", (t) => {
  const plainStart = agentScene(t, "hermes");
  const r = plainStart.cli(["start", "Genie", "--json"]);
  assert.equal(r.code, 0, r.err);
  const run = runCall(plainStart.calls());
  const w = run.slice(run.indexOf("--") + 1);
  assert.equal(w[0], "/usr/bin/env");
  assert.match(w[1], /^PATH=/);
  assert.match(w[2], /^HERMES_EPHEMERAL_SYSTEM_PROMPT=<herdr-bot>\n/);
  assert.equal(w[3], "hermes");
  for (const text of ["agent:\n  system_prompt: Be terse.\n", "display:\n  personality: pirate\n"]) {
    const own = agentScene(t, "hermes", { config: { path: ".hermes/config.yaml", text } });
    const o = own.cli(["start", "Genie", "--json"]);
    assert.equal(o.code, 0, o.err);
    assert.ok(!runCall(own.calls()).some((x) => x.startsWith("HERMES_EPHEMERAL_SYSTEM_PROMPT=")), text);
    assert.match(o.json().warnings.join("\n"), /hermes' config\.yaml sets a personality or agent\.system_prompt/);
  }
});
