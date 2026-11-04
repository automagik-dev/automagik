// Restart over plain data (restart.js, models.js resumeArgs): what the replacement runs per
// agent (resume, fresh, swap), the refusals (a turn in progress, helpers that end with the
// pane) and the labels carried over. The hc side is in cli.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENTS, canResume, resumeArgs, withoutModel, withoutResume } from "../mods/am-sidebar/models.js";
import { carriedLabels, commandArgv, continueRefusal, helperArgs, helperPlan, ledgerSession, paneCommand, paneSession, planText, restartAnswer, restartArgs,
  claudeSlug, restartPlan, restartRefusal, sameSessions, sessionId, sessionOf, sharedFolders, sharedFresh, takesWords, withoutPrompt } from "../mods/am-sidebar/restart.js";

const SID = "0f3c2a4e-1b2d-4c5e-9f60-718293a4b5c6";
const SID2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const claude = { agent: "claude", model: "claude-opus-5-5" };

test("resumeArgs: claude by session id, else --continue; codex resume --last; --continue for pi, omp, kimi, agy, hermes; none for the rest", () => {
  assert.deepEqual(resumeArgs("claude", "s-1"), ["--resume", "s-1"]);
  assert.deepEqual(resumeArgs("claude", null), ["--continue"]);
  assert.deepEqual(resumeArgs("claude", "  "), ["--continue"]);
  assert.deepEqual(resumeArgs("codex"), ["resume", "--last"]);
  for (const k of ["pi", "omp", "kimi", "antigravity", "hermes"]) assert.deepEqual(resumeArgs(k), ["--continue"], k);
  for (const k of ["opencode", "cursor", "copilot", "amp", "grok", "kiro", "qoder", "crush", "nope"]) {
    assert.equal(resumeArgs(k), null, k);
    assert.equal(canResume(k), false, k);
  }
});

test("restartPlan resume: claude with the pane's session and the bot's pin; --continue without one; codex resume before its model flag", () => {
  const withId = restartPlan({ bot: claude, run: ["claude"], runningAgent: "claude", session: SID });
  assert.equal(withId.mode, "resume");
  assert.deepEqual(withId.argv, ["claude", "--resume", SID, "--model", "claude-opus-5-5"]);
  assert.equal(planText(withId, SID), `resuming session ${SID}`);
  const latest = restartPlan({ bot: claude, run: ["claude"], runningAgent: "claude" });
  assert.deepEqual(latest.argv, ["claude", "--continue", "--model", "claude-opus-5-5"]);
  assert.match(planText(latest, null), /--continue/);
  const codex = restartPlan({ bot: { agent: "codex", model: "gpt-5.5" }, run: ["codex", "--yolo"], runningAgent: "codex", session: "-rf" }); // not a session id: --last
  assert.deepEqual(codex.argv, ["codex", "--yolo", "resume", "--last", "--model", "gpt-5.5"]);
  assert.equal(planText(codex), "resuming its last conversation (resume --last)");
  const pi = restartPlan({ bot: { agent: "pi" }, run: ["pi"], runningAgent: "pi" });
  assert.deepEqual(pi.argv, ["pi", "--continue"]);
});

test("restartPlan fresh: --fresh, an agent with no resume, a pane running another agent (each says why)", () => {
  const fresh = restartPlan({ bot: claude, run: ["claude"], runningAgent: "claude", session: SID, fresh: true });
  assert.deepEqual([fresh.mode, fresh.argv, fresh.note], ["fresh", ["claude", "--model", "claude-opus-5-5"], null]);
  const amp = restartPlan({ bot: { agent: "amp" }, run: ["amp"], runningAgent: "amp" });
  assert.equal(amp.mode, "fresh");
  assert.deepEqual(amp.argv, ["amp"]);
  assert.match(amp.note, /amp has no resume this pack knows/);
  assert.match(planText(amp), /a new conversation \(amp has no resume/);
  const crossed = restartPlan({ bot: claude, run: ["claude"], runningAgent: "codex", session: SID });
  assert.equal(crossed.mode, "fresh");
  assert.match(crossed.note, /runs codex, not claude/);
});

test("restartPlan swap: --agent starts fresh on the agent's default (the old pin left behind); --model alone keeps the agent; always new", () => {
  const toCodex = restartPlan({ bot: claude, run: ["codex"], runningAgent: "claude", session: SID, agent: "codex" });
  assert.deepEqual([toCodex.mode, toCodex.agent, toCodex.model, toCodex.argv], ["swap", "codex", null, ["codex"]]);
  const pinned = restartPlan({ bot: claude, run: ["codex"], agent: "codex", model: "gpt-5.5" });
  assert.deepEqual(pinned.argv, ["codex", "--model", "gpt-5.5"]);
  assert.equal(planText(pinned), "on codex (gpt-5.5), a new conversation");
  const sonnet = restartPlan({ bot: claude, run: ["claude"], runningAgent: "claude", session: SID, model: "claude-sonnet-5-5" });
  assert.deepEqual([sonnet.mode, sonnet.argv], ["swap", ["claude", "--model", "claude-sonnet-5-5"]]);
  // An empty model (the CLI's "no pin") starts on the default.
  assert.deepEqual(restartPlan({ bot: claude, run: ["claude"], agent: "claude", model: "" }).argv, ["claude"]);
});

test("restartRefusal: a working pane, then helpers that die with it; outliving helpers and finished ones don't count; --force passes", () => {
  const idle = { address: "t5", status: { state: "idle" } };
  const working = { address: "t5", status: { state: "working" } };
  assert.match(restartRefusal({ name: "Genie", old: working }), /Genie is working in t5; restarting now would cut its turn in half\. .*--force/);
  assert.equal(restartRefusal({ name: "Genie", old: working, force: true }), null);
  const helpers = [
    { address: "t7", state: "live", die_with_parent: true },
    { address: "t8", state: "live", die_with_parent: false }, // a member bot, --outlive-parent
    { address: "t9", state: "finished", die_with_parent: true },
  ];
  assert.match(restartRefusal({ name: "Genie", old: idle, helpers }), /t5 has a helper that ends with it: t7\. .*--force/);
  assert.equal(restartRefusal({ name: "Genie", old: idle, helpers: helpers.slice(1) }), null);
  assert.equal(restartRefusal({ name: "Genie", old: idle, helpers, force: true }), null);
  assert.equal(restartRefusal({ name: "Genie", old: idle }), null);
});

test("carriedLabels keeps the old pane's squad and its mark; sessionOf reads agent.session", () => {
  assert.deepEqual(carriedLabels({ labels: { bot: "b", squad: "s1", "automagik-herdr.squad": "s1", "herdr.space": "sp" } }),
    { squad: "s1", "automagik-herdr.squad": "s1" });
  assert.deepEqual(carriedLabels({ labels: { squad: "theirs" } }), { squad: "theirs" });
  assert.deepEqual(carriedLabels(null), {});
  assert.equal(sessionOf({ labels: { "agent.session": SID } }), SID);
  assert.equal(sessionOf({ labels: { "agent.session": "s-1" } }), null, "not UUID-shaped");
  assert.equal(sessionOf({ labels: {} }), null);
  assert.equal(sessionOf(null), null);
});

test("the sidebar's Restart: the CLI's restart through launch.js runCli; its answer read back", () => {
  assert.deepEqual(restartArgs({ botId: "b-1", projectKey: "/p" }), ["restart", "b-1", "--project", "/p"]);
  assert.deepEqual(restartArgs({ botId: "b-1", projectKey: "/p", agent: "codex", force: true, fresh: true }).slice(4), ["--agent", "codex", "--force", "--fresh"]);
  assert.deepEqual(restartAnswer({ code: 0, out: { terminal: "t100", replaced: "t5", warnings: ["w"] }, err: "" }), { terminal: "t100", replaced: "t5", warnings: ["w"] });
  assert.deepEqual(restartAnswer({ code: 0, out: { id: "b-1", running: "t7" }, err: "" }), { refused: "It is already running in t7.", forceable: false, freshable: false });
  const working = restartAnswer({ code: 1, out: null, err: "a warning\nGenie is working in t5; restarting now would cut its turn in half. Wait until it is idle, or pass --force." });
  assert.match(working.refused, /^Genie is working in t5/);
  assert.equal(working.forceable, true);
  assert.equal(restartAnswer({ code: 1, err: "Genie has no recorded Claude session ... restart with --fresh for a new conversation." }).freshable, true);
  assert.deepEqual(restartAnswer({ code: 1, out: null, err: "No bot x in this project." }), { refused: "No bot x in this project.", forceable: false, freshable: false });
  assert.deepEqual(restartAnswer({ code: 127, out: null, err: "" }), { refused: "Restart failed (exit 127).", forceable: false, freshable: false });
});

test("session ids: only UUID-shaped ones resume; a flag-like value never reaches --resume; the ledger's last row for the terminal stands in", () => {
  assert.equal(sessionId(` ${SID} `), SID);
  for (const bad of ["-rf", "--dangerously-skip-permissions", "s-1", "", null, 7]) assert.equal(sessionId(bad), null, String(bad));
  assert.deepEqual(restartPlan({ bot: claude, run: ["claude"], runningAgent: "claude", session: "--print" }).argv, ["claude", "--continue", "--model", "claude-opus-5-5"]);
  assert.deepEqual(resumeArgs("claude", "-x"), ["--continue"]);
  const other = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const rows = [{ event: "session", terminal: "t5", session: other, transcript: "/a.jsonl" }, { event: "start", terminal: "t5" },
    { event: "session", terminal: "t5", session: SID }, { event: "session", terminal: "t6", session: other }, { event: "session", terminal: "t5", session: "junk" }];
  assert.deepEqual(ledgerSession(rows, "t5"), { session: SID, transcript: null });
  assert.equal(ledgerSession(rows, "t7"), null);
  assert.equal(ledgerSession(null, "t5"), null);
});

test("ledgerSession per agent (#328): a row naming its agent feeds that agent, one safe word; an unnamed row is Claude's; never a flag", () => {
  const rows = [{ event: "session", terminal: "t5", session: "omp-sess-1", agent: "omp" }, { event: "session", terminal: "t5", session: SID },
    { event: "session", terminal: "t6", session: "-rf", agent: "omp" }, { event: "session", terminal: "t7", session: "pi-1", agent: "pi" }];
  assert.deepEqual(ledgerSession(rows, "t5", "omp"), { session: "omp-sess-1", transcript: null });
  assert.deepEqual(ledgerSession(rows, "t5", "claude"), { session: SID, transcript: null }, "an unnamed row is Claude's");
  assert.deepEqual(ledgerSession(rows, "t5"), { session: SID, transcript: null });
  assert.equal(ledgerSession(rows, "t6", "omp"), null, "a flag-like id never passes");
  assert.equal(ledgerSession(rows, "t7", "omp"), null, "another agent's row doesn't feed omp");
  assert.deepEqual(ledgerSession(rows, "t7", "pi"), { session: "pi-1", transcript: null });
});

test("sharedFresh (#328): null with no other bot there; else why the restart starts fresh, naming each sharer, the folder and the skipped resume", () => {
  assert.equal(sharedFresh({ name: "Herdr Tester", old: { address: "t5" }, cwd: "/p", agent: "omp", words: "--continue" }), null);
  assert.equal(sharedFresh({ name: "Herdr Tester", old: { address: "t5" }, cwd: "/p", sharers: [{ address: "t9", name: "Herdr Dev" }], agent: "omp", words: "--continue" }),
    "no omp session id is known for t5, and Herdr Dev (t9) also runs omp in /p, so --continue could resume theirs instead of Herdr Tester's");
  assert.match(sharedFresh({ name: "G", old: { address: "t5" }, cwd: "/p", sharers: [{ address: "t9", name: "A" }, { address: "t8", name: "B" }], agent: "Codex", words: "resume --last" }),
    /A \(t9\), B \(t8\) also run Codex in \/p, so resume --last could resume theirs/);
});

test("continueRefusal: refused only when another bot's Claude shares the folder", () => {
  assert.equal(continueRefusal({ name: "Genie", old: { address: "t5" }, cwd: "/p" }), null);
  assert.match(continueRefusal({ name: "Genie", old: { address: "t5" }, cwd: "/p", sharers: [{ address: "t9", name: "Captain" }, { address: "t8", name: "Dev" }] }),
    /Genie has no recorded Claude session \(t5 has no agent.session label .*\), and Captain \(t9\), Dev \(t8\) also run Claude in \/p, so --continue could resume theirs\. Nothing was started; restart with --fresh/);
});

// ---- #213: the old pane's own command, resume by id, --tree ----

test("resumeArgs by session id: codex resume <id>, omp --resume=<id>, pi --session <id>, hermes --resume <id>, kimi --session=<id>, agy --conversation <id>", () => {
  assert.deepEqual(resumeArgs("codex", SID), ["resume", SID]);
  assert.deepEqual(resumeArgs("omp", SID), [`--resume=${SID}`]);
  assert.deepEqual(resumeArgs("pi", SID), ["--session", SID]);
  assert.deepEqual(resumeArgs("hermes", SID), ["--resume", SID]);
  assert.deepEqual(resumeArgs("kimi", SID), [`--session=${SID}`]);
  assert.deepEqual(resumeArgs("antigravity", SID), ["--conversation", SID]);
  assert.deepEqual(resumeArgs("omp", "-x"), ["--continue"], "never a flag as an id");
  assert.deepEqual(resumeArgs("kimi", "-x"), ["--continue"]);
});

test("withoutResume drops an earlier resume per agent (codex's -c is its config, kept); withoutModel drops the model flags", () => {
  assert.deepEqual(withoutResume("claude", ["claude", "--model", "m", "--resume", SID, "-c"]), ["claude", "--model", "m"]);
  assert.deepEqual(withoutResume("codex", ["codex", "-c", "x=1", "resume", "--last", "-m", "g"]), ["codex", "-c", "x=1", "-m", "g"]);
  assert.deepEqual(withoutResume("codex", ["codex", "resume", SID]), ["codex"]);
  assert.deepEqual(withoutResume("omp", ["omp", "-c", "--resume=abc", "--model=k", "--restore=x"]), ["omp", "--model=k"]);
  assert.deepEqual(withoutResume("pi", ["pi", "--session", SID, "--continue", "--model", "p"]), ["pi", "--model", "p"]);
  assert.deepEqual(withoutResume("kimi", ["kimi", "-c", "--session=abc", "-S", "--yolo"]), ["kimi", "--yolo"]);
  assert.deepEqual(withoutResume("antigravity", ["agy", "-c", "--conversation", "abc", "--model", "m"]), ["agy", "--model", "m"]);
  assert.deepEqual(withoutModel("codex", ["codex", "-m", "a", "-mb", "--model=c", "-c", "model=d", "-c", "model_reasoning_effort=high"]),
    ["codex", "-c", "model_reasoning_effort=high"]);
  assert.deepEqual(withoutModel("omp", ["omp", "--model=k", "--thinking=high"]), ["omp", "--thinking=high"]);
});

test("paneCommand: hc's launch argv without this pack's env PATH prefix; a template's sh -c command, its \"$@\" and old arguments dropped", () => {
  assert.equal(paneCommand({}), null);
  assert.deepEqual(paneCommand({ argv: ["/usr/bin/env", "PATH=/a", "omp", "--model=k"] }), { argv: ["omp", "--model=k"] });
  assert.deepEqual(paneCommand({ argv: ["env", "FOO=1", "omp"] }), { argv: ["env", "FOO=1", "omp"] }, "someone else's env stays");
  assert.deepEqual(paneCommand({ argv: ["sh", "-c", "omp --x"] }), { shell: "omp --x" });
  assert.deepEqual(paneCommand({ argv: ["/usr/bin/env", "PATH=/a", "sh", "-c", 'omp --x "$@"', "sh", "--continue"] }), { shell: "omp --x" });
});

test("restartPlan reuses the old pane's command when it runs the bot's agent: a template resumed through \"$@\", flags kept, a pin replacing the model", () => {
  const omp = { agent: "omp" };
  const tpl = restartPlan({ bot: omp, run: ["omp"], runningAgent: "omp", launch: { shell: "omp --auto-approve --model k" }, runningModel: "k" });
  assert.deepEqual([tpl.mode, tpl.reused, tpl.model], ["resume", true, "k"]);
  assert.deepEqual(tpl.argv, ["sh", "-c", 'omp --auto-approve --model k "$@"', "sh", "--continue"]);
  const fresh = restartPlan({ bot: omp, run: ["omp"], runningAgent: "omp", fresh: true, launch: { shell: "omp --model k" } });
  assert.deepEqual([fresh.mode, fresh.argv], ["fresh", ["sh", "-c", "omp --model k"]], "--fresh: the same command, no resume");
  const codex = restartPlan({ bot: { agent: "codex", model: "gpt-b" }, run: ["codex"], runningAgent: "codex", session: SID,
    launch: { argv: ["codex", "-m", "gpt-a", "-c", "model_reasoning_effort=high", "resume", "--last"] } });
  assert.deepEqual(codex.argv, ["codex", "-c", "model_reasoning_effort=high", "--model", "gpt-b", "resume", SID]);
  assert.equal(codex.model, "gpt-b");
  const same = restartPlan({ bot: claude, run: ["claude"], runningAgent: "claude", session: SID, launch: { argv: ["claude", "--model", "claude-opus-5-5", "--effort", "high"] } });
  assert.deepEqual(same.argv, ["claude", "--model", "claude-opus-5-5", "--effort", "high", "--resume", SID]);
  // Another agent in the pane, or a swap: the definition's command, as before.
  const other = restartPlan({ bot: omp, run: ["omp"], runningAgent: "codex", launch: { argv: ["codex", "-m", "x"] } });
  assert.deepEqual([other.mode, other.reused, other.argv], ["fresh", false, ["omp"]]);
  const swap = restartPlan({ bot: omp, run: ["codex"], runningAgent: "omp", agent: "codex", launch: { shell: "omp" } });
  assert.deepEqual([swap.mode, swap.reused, swap.argv], ["swap", false, ["codex"]]);
});

test("restartRefusal --tree: helpers that end with the pane don't refuse, mid-turn or not (waited for); without it the refusal names --tree and --force", () => {
  const idle = { address: "t5", status: { state: "idle" } };
  const helper = { address: "t7", state: "live", die_with_parent: true, status: { state: "idle" } };
  const without = restartRefusal({ name: "Genie", old: idle, helpers: [helper] });
  assert.match(without, /pass --tree to restart it too \(resumed, under the new pane\), or pass --force to end it with the pane\./);
  assert.equal(restartAnswer({ code: 1, err: without }).forceable, true, "the sidebar still offers --force");
  assert.equal(restartRefusal({ name: "Genie", old: idle, helpers: [helper], tree: true }), null);
  const busy = { ...helper, status: { state: "working" } };
  assert.equal(restartRefusal({ name: "Genie", old: idle, helpers: [busy], tree: true }), null, "--tree waits for it before anything starts (the CLI)");
  assert.equal(restartRefusal({ name: "Genie", old: idle, helpers: [busy], tree: true, force: true }), null);
});

test("helperPlan: a worker rebuilt from its ledger row (its task not sent again), a template's command, anything else's own; resumed in its folder", () => {
  const get = { address: "t7", name: "fix-dev", cwd: "/w", foreground: { argv: ["bun", "/b/omp", "--model=k", "--thinking=high", "the task"], cwd: "/w/sub" },
    labels: { "worker.of": "b-1", "agent.session": SID }, argv: ["/usr/bin/env", "PATH=/x", "omp", "--model=k", "--thinking=high", "the task"] };
  const worker = { agent: "omp", model: "k", effort: "high", template: null };
  const w = helperPlan({ get, worker, session: SID, agents: AGENTS });
  assert.deepEqual([w.name, w.replaced, w.cwd, w.agent, w.mode, w.session], ["fix-dev", "t7", "/w", "omp", "resume", SID]);
  assert.deepEqual(w.argv, ["omp", "--model=k", "--thinking=high", `--resume=${SID}`]);
  const tpl = helperPlan({ get: { address: "t8", cwd: "/r", foreground: { argv: ["codex", "-m", "g"] }, argv: ["sh", "-c", "codex -m g"], template: "rev" }, agents: AGENTS });
  assert.deepEqual(tpl.argv, ["sh", "-c", 'codex -m g "$@"', "sh", "resume", "--last"]);
  const hand = helperPlan({ get: { address: "t9", cwd: "/h", foreground: { argv: ["claude", "--model", "m"] }, argv: ["claude", "--model", "m", "--continue"] }, agents: AGENTS });
  assert.deepEqual(hand.argv, ["claude", "--model", "m", "--continue"]);
  const none = helperPlan({ get: { address: "t10", cwd: "/h", foreground: { argv: ["claude"] } }, agents: AGENTS });
  assert.match(none.error, /t10 can't be run again: hc gave no command this pack can reuse/);
  const plain = helperPlan({ get: { address: "t11", cwd: "/h", foreground: { argv: ["amp"] }, argv: ["amp"] }, agents: AGENTS });
  assert.deepEqual([plain.mode, plain.argv, plain.note], ["fresh", ["amp"], "amp has no resume this pack knows"]);
  assert.deepEqual(helperArgs({ name: "fix-dev", cwd: "/w", labels: { a: "1", gone: "" }, parent: "t100", argv: ["omp"], path: "/p" }),
    ["run", "--bg", "--json", "--name", "fix-dev", "--cwd", "/w", "--label", "a=1", "--parent", "t100", "--", "/usr/bin/env", "PATH=/p", "omp"]);
});

test("sharedFolders: an id-less resume sharing a folder and agent with another run (bot or helper, resumed or fresh) is named; one alone, or every one with an id, isn't", () => {
  const six = ["t2p9", "t2pf", "t2ph", "t2pj", "t2pk", "t2pp"].map((who) => ({ who, agent: "codex", cwd: "/w/integration", session: null, mode: "resume" }));
  const bot = { who: "Genie", agent: "claude", cwd: "/w", session: null, mode: "resume" };
  assert.deepEqual(sharedFolders([bot, ...six]), [{ agent: "codex", cwd: "/w/integration", who: six.map((r) => r.who), idless: six.map((r) => r.who) }]);
  assert.deepEqual(sharedFolders([bot, ...six.map((r, n) => ({ ...r, session: `0f3c2a4e-1b2d-4c5e-9f60-71829300000${n}` }))]), [], "each with its own id");
  const fresh = { who: "Captain", agent: "codex", cwd: "/w/integration", session: null, mode: "fresh" };
  assert.deepEqual(sharedFolders([fresh, six[0]]).map((g) => [g.who, g.idless]), [[["Captain", "t2p9"], ["t2p9"]]], "a fresh run there makes the newest conversation");
  assert.deepEqual(sharedFolders([bot, six[0]]), []);
});

test("paneSession: the agent.session label, else revive.session when revive.agent names the agent (or is unset); never a non-id", () => {
  assert.equal(paneSession({ labels: { "agent.session": SID, "revive.session": SID2 } }, "codex"), SID);
  assert.equal(paneSession({ labels: { "revive.agent": "codex", "revive.session": SID2 } }, "codex"), SID2);
  assert.equal(paneSession({ labels: { "revive.session": SID2 } }, "omp"), SID2);
  assert.equal(paneSession({ labels: { "revive.agent": "claude", "revive.session": SID2 } }, "codex"), null, "another agent's session");
  assert.equal(paneSession({ labels: { "revive.session": "-rf" } }, "codex"), null);
});

test("commandArgv: no \"$@\" after a command ending in a separator or a comment (null), none twice; withoutPrompt drops a trailing first prompt only", () => {
  assert.equal(takesWords("omp --x"), true);
  for (const c of ["omp --x;", "a && b &", "omp |", "omp --x # pinned"]) assert.equal(commandArgv({ shell: c }, ["--continue"]), null, c);
  assert.deepEqual(commandArgv({ shell: 'omp --x "$@"' }, ["--continue"]), ["sh", "-c", 'omp --x "$@"', "sh", "--continue"], "its own \"$@\" takes them");
  assert.deepEqual(commandArgv({ shell: "omp;" }), ["sh", "-c", "omp;"], "no words: as it was");
  assert.deepEqual(withoutPrompt(["omp", "--model=k", "fix the login bug"]), ["omp", "--model=k"]);
  assert.deepEqual(withoutPrompt(["codex", "-c", "a=b c"]), ["codex", "-c", "a=b c"], "an option's value stays");
  assert.deepEqual(withoutPrompt(["omp", "task"]), ["omp", "task"], "a one-word prompt can't be told from an argument");
  const tpl = restartPlan({ bot: { agent: "omp" }, run: ["omp"], runningAgent: "omp", launch: { shell: "omp --x # note" } });
  assert.deepEqual([tpl.mode, tpl.argv, tpl.note], ["fresh", ["sh", "-c", "omp --x # note"], "its command ends in a separator or a comment, so it can't take resume words"]);
});

test("helperPlan: the worker's worktree first, then the pane's folder, then its program's; fresh when asked, with the reason", () => {
  const get = { address: "t7", cwd: "/pane", foreground: { argv: ["omp"], cwd: "/pane/sub" }, labels: { "worker.of": "b-1" } };
  assert.equal(helperPlan({ get, worker: { agent: "omp", worktree: "/wt" }, agents: AGENTS }).cwd, "/wt");
  assert.equal(helperPlan({ get, agents: AGENTS }).cwd, "/pane");
  assert.equal(helperPlan({ get: { ...get, cwd: undefined }, agents: AGENTS }).cwd, "/pane/sub");
  const fresh = helperPlan({ get, worker: { agent: "omp" }, agents: AGENTS, fresh: "shared folder" });
  assert.deepEqual([fresh.mode, fresh.argv, fresh.note], ["fresh", ["omp"], "shared folder"]);
});

test("sameSessions: a session id two runs would resume is named with both; distinct ids and id-less runs aren't", () => {
  assert.deepEqual(sameSessions([{ who: "Genie", session: SID }, { who: "rev-1", session: SID }, { who: "dev", session: SID2 }, { who: "x", session: null }]),
    [{ session: SID, who: ["Genie", "rev-1"] }]);
  assert.deepEqual(sameSessions([{ who: "a", session: SID }, { who: "b", session: SID2 }, { who: "c", session: null }, { who: "d", session: null }]), []);
});

test("restartPlan: Hermes resumes a known session by id (--resume), as Claude does; a bad label falls back to --continue", () => {
  const bot = { agent: "hermes" };
  const run = ["hermes", "--tui"];
  const byId = restartPlan({ bot, run, runningAgent: "hermes", session: "atlas-sess-1" });
  assert.deepEqual(byId.argv, ["hermes", "--tui", "--resume", "atlas-sess-1"]);
  for (const bad of [null, "-x", "has space", ""]) {
    assert.deepEqual(restartPlan({ bot, run, runningAgent: "hermes", session: bad }).argv, ["hermes", "--tui", "--continue"], String(bad));
  }
  // Claude keeps its UUID rule: a word isn't a Claude session id.
  assert.deepEqual(restartPlan({ bot: { agent: "claude" }, run: ["claude"], runningAgent: "claude", session: "atlas-sess-1" }).resume, ["--continue"]);
});

test("claudeSlug: the path with every non-alphanumeric character as -, so automagik-herdr and automagik/herdr share one", () => {
  assert.equal(claudeSlug("/Users/me/workspace/repos/automagik-herdr"), "-Users-me-workspace-repos-automagik-herdr");
  assert.equal(claudeSlug("/Users/me/workspace/repos/automagik-herdr"), claudeSlug("/Users/me/workspace/repos/automagik/herdr"));
  assert.equal(claudeSlug("/a/.claude/worktrees/x_y"), "-a--claude-worktrees-x-y");
  assert.notEqual(claudeSlug("/a/b"), claudeSlug("/a/c"));
});
