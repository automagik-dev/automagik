// Restart over plain data: what a bot's replacement pane runs (resume the conversation, a
// fresh one, or a swap to another agent or model), why a restart is refused, and the labels
// the replacement carries over from the old pane. The CLI's `restart` runs it with hc; the
// sidebar's Restart runs the CLI. Pure: no `herdr`, so `node --test` runs it. Apache-2.0.

import { agentKeyOfArgv, canResume, detectModel, effortArgs, modelArgs, resumeArgs, resumesById, withoutModel, withoutResume } from "./models.js";
import { SQUAD_LABEL, SQUAD_MARK } from "./launchArgs.js";
import { ENV, WORKER_EFFORT_LABEL, WORKER_MODEL_LABEL, WORKER_OF_LABEL, WORKER_TEMPLATE_LABEL } from "./workers.js";

/** The pane label the briefing hook sets to the Claude session a terminal runs (workers.js SESSION_LABEL). */
const SESSION = "agent.session";

// A Claude session id is a UUID; anything else (a value starting with "-" would read as a
// flag) is not passed to --resume.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `s` trimmed when it is a session id Restart may resume (UUID-shaped), else null. */
export const sessionId = (s) => (typeof s === "string" && UUID.test(s.trim()) ? s.trim() : null);

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const base = (p) => String(p ?? "").split("/").pop();
// What a reused shell command gets after it, so the resume words arrive as real arguments.
const ARGS = ' "$@"';

/**
 * The command an hc pane was started with (`get.argv`, hc get's launch argv), ready to be run
 * again: { shell } for a `sh -c <command>` (an hc template, which hc runs that way, or a
 * replacement of one: its ` "$@"` and arguments dropped), else { argv } (this pack's
 * `/usr/bin/env PATH=…` prefix dropped: the CLI puts its own on). Null when hc gave none.
 */
export function paneCommand(get) {
  let argv = Array.isArray(get?.argv) && get.argv.length && get.argv.every((w) => typeof w === "string") ? [...get.argv] : null;
  if (!argv) return null;
  if (argv[0] === ENV && argv[1]?.startsWith("PATH=") && argv.length > 2) argv = argv.slice(2);
  if (SHELLS.has(base(argv[0])) && argv[1] === "-c" && typeof argv[2] === "string" && argv[2].trim()) {
    const cmd = argv[2];
    return { shell: argv.length > 3 && cmd.endsWith(ARGS) ? cmd.slice(0, -ARGS.length) : cmd };
  }
  return { argv };
}

/** `command` (paneCommand) with `words` after it: argv for hc run. */
export const commandArgv = (command, words = []) => (command.shell !== undefined
  ? (words.length ? ["sh", "-c", `${command.shell}${ARGS}`, "sh", ...words] : ["sh", "-c", command.shell])
  : [...command.argv, ...words]);

/**
 * What the replacement runs. `bot`: { agent, model } as stored; `run`: the target agent's
 * `run` (Herdr's table, programs.json applied); `runningAgent`: the agent key the old pane's
 * foreground runs (agentKeyOfArgv), null when unknown or when nothing runs; `session`: the old
 * pane's session id (its agent.session label, or the ledger's); `fresh`, `agent`, `model`: the
 * options (undefined: not given); `launch`: the old pane's command (paneCommand), null when
 * unknown; `runningModel`: the model its foreground names (detectModel), null when none.
 * An --agent or --model is a swap, always fresh: a conversation doesn't cross agents, and the
 * command is the agent table's. Otherwise, when the old pane runs the bot's agent, its own
 * command is reused (#213: the template's or hand-given flags, model and effort), its old resume
 * words replaced: a pin in the definition replaces the model it names (a template, which owns
 * its command, keeps its own). Returns { mode: "resume" | "fresh" | "swap", agent, model,
 * resume (the resume words, [] for a new conversation), argv, reused, note } (`note`: why a
 * resume wasn't possible, else null; `reused`: the old pane's command was kept).
 */
export function restartPlan({ bot, run, runningAgent = null, session = null, fresh = false, agent, model, launch = null, runningModel = null }) {
  const swap = agent !== undefined || model !== undefined;
  const key = agent ?? bot.agent;
  // A new agent without --model starts on its own default: the old pin belongs to the old agent.
  const pin = model !== undefined ? (model || null) : key === bot.agent ? (bot.model ?? null) : null;
  const defined = (mode, extra = [], note = null) => ({ mode, agent: key, model: pin, resume: extra, argv: [...run, ...extra, ...modelArgs(key, pin)], reused: false, note });
  if (swap) return defined("swap");
  if (runningAgent && runningAgent !== key) return defined("fresh", [], `its pane runs ${runningAgent}, not ${key}, and a conversation doesn't cross agents`);
  const own = runningAgent === key && launch ? reusable(launch, key) : null;
  const plan = (mode, extra = [], note = null) => {
    if (!own) return defined(mode, extra, note);
    if (own.shell !== undefined) return { mode, agent: key, model: runningModel, resume: extra, argv: commandArgv(own, extra), reused: true, note };
    const pinned = pin && detectModel(own.argv, key) !== pin ? [...withoutModel(key, own.argv), ...modelArgs(key, pin)] : own.argv;
    return { mode, agent: key, model: pin ?? detectModel(pinned, key), resume: extra, argv: [...pinned, ...extra], reused: true, note };
  };
  if (fresh) return plan("fresh");
  if (!canResume(key)) return plan("fresh", [], `${key} has no resume this pack knows`);
  return plan("resume", resumeArgs(key, sessionId(session)));
}

/** `launch` (paneCommand) as Restart reuses it for agent `key`: its old resume words gone; null when it doesn't run `key`. */
function reusable(launch, key) {
  if (launch.shell !== undefined) return launch;
  if (agentKeyOfArgv(launch.argv) !== key) return null;
  return { argv: withoutResume(key, launch.argv) };
}

/** The old pane's Claude session id (its agent.session label, UUID-shaped), or null. */
export const sessionOf = (get) => sessionId(get?.labels?.[SESSION]);

/**
 * The last Claude session the workers ledger ties to `terminal` (its session rows, workers.js
 * readLedger): { session, transcript }, or null. For a pane whose label is missing.
 */
export function ledgerSession(rows, terminal) {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (r?.event !== "session" || r.terminal !== terminal) continue;
    const session = sessionId(r.session);
    if (session) return { session, transcript: typeof r.transcript === "string" ? r.transcript : null };
  }
  return null;
}

/**
 * Why Restart won't resume with claude --continue, or null: it takes the folder's latest
 * conversation, which may be a teammate's when another bot's Claude pane runs in that folder.
 * `sharers`: those panes as { address, name }.
 */
export function continueRefusal({ name, old, cwd, sharers = [] }) {
  if (!sharers.length) return null;
  const who = sharers.map((x) => `${x.name} (${x.address})`).join(", ");
  return `${name} has no recorded Claude session (${old.address} has no agent.session label and the ledger has no session row for it), `
    + `and ${who} also ${sharers.length === 1 ? "runs" : "run"} Claude in ${cwd}, so --continue could resume theirs. Nothing was started; `
    + `restart with --fresh for a new conversation.`;
}

/** The helpers (hc get answers) that end with their parent's pane: live, die_with_parent. */
export const doomedHelpers = (helpers = []) => helpers.filter((h) => h?.state === "live" && h.die_with_parent !== false && h.address);

/**
 * Why a restart of `old` (hc get of the bot's live pane) is refused, or null. `name`: the
 * bot's name; `helpers`: hc get answers of the live terminals whose parent is the old pane.
 * A pane mid-turn would have the turn cut in half; a helper hc ends with its parent
 * (die_with_parent, as a worker is) would end with it. --tree (`tree`) restarts those helpers
 * under the new pane, so only one mid-turn refuses then. --force (`force`) overrides all.
 */
export function restartRefusal({ name, old, helpers = [], force = false, tree = false }) {
  if (force) return null;
  if (old?.status?.state === "working") {
    return `${name} is working in ${old.address}; restarting now would cut its turn in half. Wait until it is idle, or pass --force.`;
  }
  const doomed = doomedHelpers(helpers);
  if (tree) {
    const busy = doomed.filter((h) => h.status?.state === "working").map((h) => h.address);
    if (!busy.length) return null;
    const one = busy.length === 1;
    return `${old.address}'s ${one ? "helper" : "helpers"} ${busy.join(", ")} ${one ? "is" : "are"} working; restarting ${one ? "it" : "them"} now would cut `
      + `${one ? "its turn" : "their turns"} in half. Wait until ${one ? "it is" : "they are"} idle, or pass --force.`;
  }
  if (doomed.length) {
    const one = doomed.length === 1;
    return `${old.address} has ${one ? "a helper that ends" : "helpers that end"} with it: ${doomed.map((h) => h.address).join(", ")}. `
      + `Let ${one ? "it" : "them"} finish, pass --tree to restart ${one ? "it" : "them"} too (resumed, under the new pane), `
      + `or pass --force to end ${one ? "it" : "them"} with the pane.`;
  }
  return null;
}

/**
 * What Restart --tree runs again for one helper that ends with the bot's pane (#213): `get`, its
 * hc get; `worker`, the workers ledger's start row for its terminal (null: not a worker);
 * `session`, its known session id; `agents`, Herdr's table. A worker's command is rebuilt from
 * its row (its task, the last word hc was given, isn't sent twice) unless a template owns it;
 * any other helper's is its own launch command (paneCommand). Returns { name, replaced, cwd,
 * labels, agent, session, mode: "resume" | "fresh", resume, argv, note }, or { name, replaced, error }
 * when there is nothing to run.
 */
export function helperPlan({ get, worker = null, session = null, agents }) {
  const name = typeof get?.name === "string" && get.name ? get.name : null;
  const replaced = get?.address ?? null;
  const cwd = get?.foreground?.cwd ?? get?.cwd ?? null;
  const labels = { ...(get?.labels ?? {}) };
  const agent = agentKeyOfArgv(get?.foreground?.argv, agents) ?? (worker?.agent && agents[worker.agent] ? worker.agent : null);
  const template = worker?.template ?? labels[WORKER_TEMPLATE_LABEL] ?? get?.template ?? null;
  let command = null;
  if (!template && (worker || labels[WORKER_OF_LABEL]) && agent && agents[agent]?.run?.length) {
    const model = worker?.model ?? labels[WORKER_MODEL_LABEL] ?? null;
    const effort = worker?.effort ?? labels[WORKER_EFFORT_LABEL] ?? null;
    command = { argv: [...agents[agent].run, ...modelArgs(agent, model), ...effortArgs(agent, effort)] };
  } else {
    const launch = paneCommand(get);
    if (launch?.shell !== undefined) command = launch;
    else if (launch && agent && agentKeyOfArgv(launch.argv, agents) === agent) command = { argv: withoutResume(agent, launch.argv) };
  }
  if (!command || !cwd) {
    return { name, replaced, error: `${replaced} can't be run again: hc gave ${cwd ? "no command this pack can reuse" : "no folder"} for it` };
  }
  const id = sessionId(session);
  const resume = agent && canResume(agent) ? resumeArgs(agent, id) : null;
  const note = resume ? null : agent ? `${agent} has no resume this pack knows` : "its agent isn't one this pack knows";
  return { name, replaced, cwd, labels, agent, session: resume && resumesById(agent) ? id : null, mode: resume ? "resume" : "fresh",
    resume: resume ?? [], argv: commandArgv(command, resume ?? []), note };
}

/**
 * `hc run` arguments for a helper Restart --tree runs again: in the background, its name (null:
 * hc picks), folder and labels, a child of the bot's new pane, its PATH as a seat's (`path`).
 */
export function helperArgs({ name, cwd, labels = {}, parent, argv, path = null }) {
  const args = ["run", "--bg", "--json"];
  if (name) args.push("--name", name);
  args.push("--cwd", cwd);
  for (const [k, v] of Object.entries(labels)) if (typeof v === "string" && v) args.push("--label", `${k}=${v}`);
  return [...args, "--parent", parent, "--", ...(path ? [ENV, `PATH=${path}`] : []), ...argv];
}

/**
 * The resumes that pick up their folder's latest conversation (no session id) and share an
 * agent and folder with another one: they may pick up each other's. `runs`: [{ who, agent, cwd,
 * session, mode }]. One line per such group.
 */
export function sharedResumes(runs) {
  const groups = new Map();
  for (const r of runs) {
    if (r.mode !== "resume" || r.session || !r.agent || !r.cwd) continue;
    const k = `${r.agent}\u0000${r.cwd}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => `${g.map((r) => r.who).join(" and ")} each resume the latest ${g[0].agent} `
    + `conversation in ${g[0].cwd} (no session id known), so one may have picked up another's; check them (hc read).`);
}

/**
 * The labels the replacement carries beyond paneLabels: a squad on the old pane (anyone's,
 * not only one this pack copied) and its mark, so the restart moves the pane, not its squad.
 */
export function carriedLabels(old) {
  const have = old?.labels ?? {};
  const out = {};
  if (have[SQUAD_LABEL]) out[SQUAD_LABEL] = have[SQUAD_LABEL];
  if (have[SQUAD_MARK]) out[SQUAD_MARK] = have[SQUAD_MARK];
  return out;
}

/** One line for the owner: what the replacement does with the conversation. */
export function planText(plan, session) {
  if (plan.mode === "swap") return `on ${plan.agent}${plan.model ? ` (${plan.model})` : ""}, a new conversation`;
  if (plan.mode === "fresh") return plan.note ? `a new conversation (${plan.note})` : "a new conversation";
  if (plan.agent === "claude") return session ? `resuming session ${session}` : "resuming the latest conversation in its folder (--continue)";
  return session ? `resuming session ${session} (${plan.resume.join(" ")})` : `resuming its last conversation (${plan.resume.join(" ")})`;
}

// ---- the sidebar's Restart: the CLI, as launch.js runCli runs it ----

/**
 * The CLI arguments the sidebar's Restart passes to launch.js runCli (which adds --json and
 * this app home): `agent`: Restart on… (a swap); `force`: past a working pane or its helpers;
 * `fresh`: a new conversation.
 */
export function restartArgs({ botId, projectKey, agent = null, force = false, fresh = false }) {
  return ["restart", botId, "--project", projectKey, ...(agent ? ["--agent", agent] : []), ...(force ? ["--force"] : []), ...(fresh ? ["--fresh"] : [])];
}

/**
 * What runCli's answer ({ code, out, err }) to restartArgs means: { terminal, replaced,
 * warnings } on success, else { refused, forceable, freshable } (the refusal is one --force
 * overrides, or one a new conversation, --fresh, avoids).
 */
export function restartAnswer(r) {
  if (r?.code === 0 && r.out?.terminal) {
    return { terminal: r.out.terminal, replaced: r.out.replaced ?? null, warnings: Array.isArray(r.out.warnings) ? r.out.warnings : [] };
  }
  if (r?.code === 0 && r.out?.running) return { refused: `It is already running in ${r.out.running}.`, forceable: false, freshable: false };
  // The CLI's refusal is its last stderr line (warnings come before it).
  const refused = String(r?.err ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? `Restart failed (exit ${r?.code ?? "?"}).`;
  return { refused, forceable: /pass --force/.test(refused), freshable: /--fresh\b/.test(refused) };
}
