// Codex auto mode (#946): every Codex launch the pack makes passes Codex's `--approve-for-me`,
// so an approval request goes to Codex's own reviewer instead of stopping for a person: a bot's
// Start, its Restart, and `automagik-herdr worker` with a Codex agent. A bot's `codexAuto: false`
// opts out, a restart rebuilds the flag from the definition (never the old pane's command), and
// an hc template that owns a worker's command gets no flag. Scratch projects and a fake hc
// (test/fake-hc.mjs) only: the real hc and window are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { checkBots, parseBots } from "../mods/am-sidebar/model.js";
import { AGENTS, withoutBriefing } from "../mods/am-sidebar/models.js";
import { helperPlan, restartPlan } from "../mods/am-sidebar/restart.js";
import { workerArgs, workerPlan } from "../mods/am-sidebar/workers.js";
import { readJsonLines } from "./log-lines.mjs";
import { scratchProject, scratchRoot } from "./scratch-project.mjs";

const CLI = new URL("../mods/am-sidebar/bin/automagik-herdr.mjs", import.meta.url).pathname;
const FAKE_HC = new URL("./fake-hc.mjs", import.meta.url).pathname;
const ID = "b-codexaaaaa";
const exe = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
const MAIN = { id: ID, name: "Genie", kind: "main", agent: "codex", look: { character: "star", colour: "blue" }, role: "r", instructions: "i" };

/** A fresh scratch world: a git project, a fake hc and herdr-app, a home and an app home. */
function scene(t, bots = [MAIN]) {
  const root = scratchRoot(t, "hb-codex-");
  const bin = join(root, "bin"), home = join(root, "home"), app = join(root, "app");
  for (const d of [bin, home, join(app, "mods/am-sidebar")]) mkdirSync(d, { recursive: true });
  // No template: a runner's own init.templateDir can't change the exclude file a start writes.
  const project = scratchProject(root, "proj", { template: "" });
  exe(join(bin, "hc"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  exe(join(bin, "herdr-app"), "#!/bin/sh\necho \"no window in tests\" >&2\nexit 1\n");
  exe(join(bin, "codex"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(app, "mods/am-sidebar/briefing.mjs"), "// stand-in\n");
  writeFileSync(join(project, ".herdr/bots.json"), `${JSON.stringify({ version: 1, categories: [], bots }, null, 2)}\n`);
  const statePath = join(root, "hc.json"), logPath = join(root, "hc.log");
  writeFileSync(statePath, JSON.stringify({ terminals: [], next: 100 }));
  writeFileSync(logPath, "");
  // A pinned PATH, so the pane's PATH is the same on every runner.
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, HERDR_APP_HOME: app, HC_FAKE_STATE: statePath, HC_FAKE_LOG: logPath,
    LANG: "C", GIT_CEILING_DIRECTORIES: root, AUTOMAGIK_HERDR_RESTART_STABLE_MS: "1" };
  const cli = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const idle = () => {
    const now = state();
    for (const x of now.terminals) if (x.labels?.bot === ID && x.state === "live") x.status = { ...(x.status ?? {}), state: "idle" };
    writeFileSync(statePath, JSON.stringify(now));
  };
  return { project, statePath, cli, calls: () => readJsonLines(logPath), state, idle };
}

/** What an `hc run` call launches, past `/usr/bin/env PATH=…` and the agents' briefings. */
function launched(call) {
  const words = call.slice(call.indexOf("--") + 1);
  let i = 0;
  if (words[0] === "/usr/bin/env") {
    i = 1;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
  }
  return withoutBriefing("claude", withoutBriefing("codex", words.slice(i)));
}
const runs = (calls) => calls.filter((c) => c[0] === "run");

test("start and restart of a Codex bot pass --approve-for-me from its definition, never the old pane's command (#946)", (t) => {
  const s = scene(t);
  const started = s.cli(["start", "Genie"]);
  assert.equal(started.code, 0, started.err);
  assert.deepEqual(launched(runs(s.calls())[0]), ["codex", "--approve-for-me"]);
  // The old pane's command is not the definition: the restart replaces it with the source's words.
  s.idle();
  const now = s.state();
  const old = now.terminals.find((x) => x.labels?.bot === ID);
  old.argv = ["codex", "--yolo"];
  old.foreground.argv = ["codex", "--yolo"];
  writeFileSync(s.statePath, JSON.stringify(now));
  const restarted = s.cli(["restart", "Genie"]);
  assert.equal(restarted.code, 0, restarted.err);
  const plan = launched(runs(s.calls()).at(-1));
  assert.deepEqual(plan, ["codex", "--approve-for-me", "resume", "--last"]);
  assert.equal(plan.includes("--yolo"), false, "the old pane's command is never reused");
});

test("codexAuto false on the bot's definition leaves its Codex seat and restart on Codex's default approvals (#946)", (t) => {
  const s = scene(t, [{ ...MAIN, codexAuto: false }]);
  assert.equal(s.cli(["start", "Genie"]).code, 0);
  assert.deepEqual(launched(runs(s.calls())[0]), ["codex"]);
  s.idle();
  assert.equal(s.cli(["restart", "Genie"]).code, 0);
  assert.deepEqual(launched(runs(s.calls()).at(-1)), ["codex", "resume", "--last"]);
});

test("a Codex worker passes --approve-for-me from the bot's definition; codexAuto false opts out (#946)", () => {
  const bot = { id: ID, name: "Genie", agent: "claude" };
  const on = workerPlan(bot, { agent: "codex" });
  assert.equal(on.error, undefined);
  assert.deepEqual(on.argv, ["codex", "--approve-for-me"]);
  assert.deepEqual(workerArgs({ botId: ID, branch: "fix/946", cwd: "/w", parent: "t1", agent: "codex", argv: on.argv, task: "do it" })
    .slice(-3), ["codex", "--approve-for-me", "do it"]);
  const off = workerPlan({ ...bot, codexAuto: false }, { agent: "codex" });
  assert.deepEqual(off.argv, ["codex"]);
  const other = workerPlan({ ...bot, codexAuto: false }, { agent: "claude" });
  assert.deepEqual(other.argv, ["claude", "--permission-mode", "auto"], "the opt-out only ever touches Codex");
});

test("Restart --tree's Codex worker helper keeps the auto mode from the bot's definition; a template gets none (#946)", () => {
  const get = { address: "t7", cwd: "/w", state: "live", argv: ["codex"], foreground: { argv: ["codex"], cwd: "/w" } };
  const worker = { agent: "codex", worktree: "/w" };
  const on = helperPlan({ get, worker, agents: AGENTS, bot: { codexAuto: true } });
  assert.deepEqual(on.argv, ["codex", "--approve-for-me", "resume", "--last"]);
  const off = helperPlan({ get: { ...get, argv: ["codex", "--approve-for-me"], foreground: { argv: ["codex", "--approve-for-me"], cwd: "/w" } },
    worker, agents: AGENTS, bot: { codexAuto: false } });
  assert.deepEqual(off.argv, ["codex", "resume", "--last"]);
  // A template owns its command: the pack adds no flag to it, on a restart or a worker start.
  const tpl = restartPlan({ bot: { agent: "codex" }, run: ["codex", "--approve-for-me"], runningAgent: "codex", session: null,
    template: { name: "rev", command: "codex --model g" } });
  assert.deepEqual(tpl.argv, ["sh", "-c", 'codex --model g "$@"', "sh", "resume", "--last"]);
  const viaTpl = workerPlan({ id: ID, name: "Genie", agent: "codex" }, { template: "rev" });
  assert.deepEqual([viaTpl.template, viaTpl.argv], ["rev", null]);
  assert.deepEqual(workerArgs({ botId: ID, branch: "b", cwd: "/w", parent: "t1", template: "rev", task: "do it" }).slice(-2), ["rev", "do it"]);
});

test("codexAuto is validated: parseBots drops an invalid value with a warning, checkBots refuses it (#946)", () => {
  const text = (value) => JSON.stringify({ version: 1, categories: [], bots: [{ ...MAIN, codexAuto: value }] });
  const parsed = parseBots(text("false"));
  assert.match(parsed.warnings.join("\n"), /codexAuto is not a boolean; ignored/);
  assert.equal("codexAuto" in parsed.file.bots[0], false);
  assert.deepEqual(parseBots(text(false)).file.bots[0].codexAuto, false, "the explicit opt-out is kept");
  assert.deepEqual(parseBots(text(true)).file.bots[0].codexAuto, true);
  assert.deepEqual(checkBots(parseBots(text(false)).file), []);
  const bad = { version: 1, categories: [], bots: [{ ...MAIN, codexAuto: "no" }] };
  assert.deepEqual(checkBots(bad), [`${ID}: codexAuto is not a boolean`]);
});
