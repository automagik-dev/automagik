// The deny-by-default hc guard for pack-started dsh-tui panes (automagik#624, stopgap C).
//
// A GUARDRAIL, NOT A BOUNDARY. This wrapper sits first on the pane PATH only because the pack
// put it there (launchArgs.js startArgs and workers.js workerArgs, dsh-tui only). It refuses the
// ordinary `hc exec` / bare `run` / file writes / machine and server commands with one line
// naming #624, #628 and #631, and passes the allowed calls to the real hc unchanged. It is bypassable
// by design: an absolute path to the real hc, a raw socket client, or `hc connect` skips it.
// The hard boundary is the sandboxed socket mask plus the per-pane filtering proxy (#624),
// tracked in #631; #628 is the full send/keys/attach scope. Labels and .herdr/bots.json are
// writable by the bot; the team check is a
// guardrail over that data, never a boundary. Apache-2.0.
//
// The caller comes from the attach ledger (attach.js), the authority: a worker pane has no
// ledger row, so its `worker.of` label names its bot and its cwd's project is the team's
// project. The target is resolved with the real hc: `hc ls` rows carry no labels, `hc get`
// does, as the pack's workersIn does. The team is model.js's graph: the caller's lead chain
// (effectiveLead), its members (descendantsOf), the project's main bot (mainBotOf), its own
// workers (worker.of = the caller's bot) and the shared reviewer/fixer roles (RANKS).

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { attachPath, foldAttach, modeProblem, readAttach } from "./attach.js";
import { descendantsOf, effectiveLead, mainBotOf, parseBots, RANKS } from "./model.js";
import { ENV, WORKER_OF_LABEL } from "./workers.js";

/** The commands a sandboxed bot may call unchanged. */
export const ALLOWED_VERBS = new Set([
  "send", "read", "ls", "get", "wait", "put", "label", "kill", "rm", "events", "schema", "templates",
]);
/** Doc-only forms that touch no core (and `hc send --help` and friends for an allowed command). */
const DOC_ONLY = new Set(["--help", "-h", "--version", "--skill"]);
/** The `operation` of `hc run`: the one worker start the pack emits. */
const WORKER_LABELS = new Set([
  WORKER_OF_LABEL, "task", "task.project", "task.lead", "branch", "worker.role", "herdr.space",
]);
/** The shared review roles: a target pane carrying one of these role= labels is reachable. */
export const SHARED_ROLES = ["reviewer", "fixer"].filter((role) => RANKS.includes(role));
/** The guard's own folder, beside this module; the pane PATH word must start with it. */
export const GUARD_DIR = join(dirname(fileURLToPath(import.meta.url)), "guard");
/** The executable this module backs; PATH scans skip its real path. */
const SELF_ENTRY = join(GUARD_DIR, "hc");

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const say = (line) => process.stderr.write(`${line}\n`);
const refused = (reason, code = 2) => {
  say(`hc guard: refused ${oneLine(reason)} (#624; the full send/keys/attach scope is #628): this wrapper is a guardrail, not a boundary; the hard boundary is #631.`);
  return code;
};
const failedClosed = (reason = "the real hc could not be run") => {
  say(`hc guard: failed closed (#624; the full send/keys/attach scope is #628): ${oneLine(reason)}; this wrapper is a guardrail, not a boundary (#631).`);
  return 1;
};

/** The hc guard: `argv` as the pane's shell gave it, `env` the pane's environment. Returns the exit code. */
export async function runGuard(argv, env = process.env) {
  try {
    const args = Array.isArray(argv) ? argv.map(String) : [];
    const verb = args[0] ?? "";
    if (docOnly(args)) {
      const real = findRealHc(env);
      return real ? passthrough(real, args, env) : failedClosed("the real hc is not on PATH");
    }
    if (!verb || verb.startsWith("-")) return refused("hc without a command");
    if (!ALLOWED_VERBS.has(verb) && verb !== "run") return refused(verb === "file" ? `file ${args[1] ?? ""}` : verb);
    const on = onWord(args);
    if (on.present && verb !== "send") return refused(`${verb} with --on`);
    const targets = verb === "events"
      ? optionValues(args, EVENTS_TARGET_OPTIONS)
      : TARGETED_VERBS.has(verb) ? [firstPositional(args, TARGET_VALUE_OPTIONS[verb])].filter(Boolean) : [];
    if (verb !== "send" && targets.some((target) => target.includes("/"))) return refused(`${verb} with a machine target`);
    const terminal = terminalOf(env);
    if (!terminal) return refused("a command without HC_TERMINAL_ID");
    const real = findRealHc(env);
    if (!real) return failedClosed("the real hc is not on PATH");
    if (verb === "run") {
      const why = runProblem(args, env, terminal);
      if (why) return refused(`run: ${why}`);
      return passthrough(real, args, env);
    }
    if (verb === "send") {
      const why = sendProblem(real, args, env, terminal, on);
      if (why) return refused(`send: ${why}`);
      return passthrough(real, args, env);
    }
    if (verb === "label") {
      const why = labelProblem(real, args, env, terminal, on);
      if (why) return refused(`label: ${why}`);
      return passthrough(real, args, env);
    }
    return passthrough(real, args, env);
  } catch (e) {
    return failedClosed(e?.message ?? e);
  }
}

function docOnly(args) {
  if (args.length === 1 && DOC_ONLY.has(args[0])) return true;
  return args.length === 2 && ALLOWED_VERBS.has(args[0]) && (args[1] === "--help" || args[1] === "-h");
}

function terminalOf(env) {
  return typeof env.HC_TERMINAL_ID === "string" ? env.HC_TERMINAL_ID.trim() : "";
}

/** `--on <machine>` or `--on=<machine>` anywhere after the command. */
function onWord(args) {
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === "--on") return { present: true, value: args[i + 1] ?? null };
    if (args[i].startsWith("--on=")) return { present: true, value: args[i].slice(5) };
  }
  return { present: false, value: null };
}

const executable = (path) => {
  try { return statSync(path).isFile() && (accessSync(path, constants.X_OK), true); } catch { return false; }
};
const realOrNull = (path) => { try { return realpathSync(path); } catch { return null; } };
/** A guard folder: its `hc` entry has `../hcGuard.mjs` beside it (the pack's or am's copy). */
const isGuardFolder = (dir) => typeof dir === "string" && dir !== "" && existsSync(join(dir, "..", "hcGuard.mjs"));

/** The real hc: the first executable `hc` on PATH that is not any guard folder's own entry. */
function findRealHc(env) {
  const self = new Set([realOrNull(SELF_ENTRY), realOrNull(process.argv[1])].filter(Boolean));
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (!dir || isGuardFolder(dir)) continue;
    const candidate = join(dir, "hc");
    if (!executable(candidate)) continue;
    const real = realOrNull(candidate);
    if (!real || self.has(real)) continue;
    return real;
  }
  return null;
}

/** Run the real hc with the pane's stdio and return its exit code (a signal is re-raised). */
function passthrough(real, args, env) {
  const r = spawnSync(real, args, { env, stdio: "inherit" });
  if (r.error) return failedClosed(`the real hc at ${real} did not run: ${r.error.message}`);
  if (typeof r.status === "number") return r.status;
  if (r.signal) {
    try { process.kill(process.pid, r.signal); } catch { /* the caller sees a failure */ }
  }
  return 1;
}

/** `hc <args> --json` through the real hc, parsed; null when it failed or printed no JSON. */
function hcJson(real, args, env) {
  const r = spawnSync(real, [...args, "--json"], { env, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
  if (r.error || r.status !== 0) return null;
  const text = String(r.stdout ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* a line after noise */ }
  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue;
    try { return JSON.parse(line); } catch { /* next */ }
  }
  return null;
}

const rowsOf = (ls) => (Array.isArray(ls?.terminals) ? ls.terminals : Array.isArray(ls) ? ls : []);

// ---- caller: the attach ledger is the authority; a worker pane's worker.of is the fallback ----

const appHome = (env) => (env.HERDR_APP_HOME || join(env.HOME || homedir(), ".config/herdr-app")).replace(/\/+$/, "");

function foldOf(env) {
  const path = attachPath(appHome(env));
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return foldAttach([]);
    throw e;
  }
  const why = modeProblem(path, st.mode);
  if (why) throw new Error(why);
  return foldAttach(readAttach(readFileSync(path, "utf8")).rows);
}

/** The newest this-computer binding of `terminal`, or null. */
function boundCaller(env, terminal) {
  let best = null;
  for (const binding of foldOf(env).byKey.values()) {
    if (binding.terminal !== terminal || binding.machine) continue;
    if (!best || (binding.created_ms ?? 0) > (best.created_ms ?? 0)) best = binding;
  }
  return best && typeof best.bot === "string" ? { bot: best.bot, project: typeof best.project === "string" ? best.project : null, worker: false } : null;
}

/** The project a folder belongs to: a worktree's main checkout, else the nearest .herdr/bots.json. */
function projectOfFolder(folder) {
  if (typeof folder !== "string" || !folder) return null;
  let at = realOrNull(folder);
  if (!at) return null;
  const marker = `${sep}.claude${sep}worktrees${sep}`;
  const inWorktree = at.lastIndexOf(marker);
  if (inWorktree > 0) {
    const project = at.slice(0, inWorktree);
    if (existsSync(join(project, ".herdr", "bots.json"))) return project;
  }
  for (;;) {
    if (existsSync(join(at, ".herdr", "bots.json"))) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The caller of this call: { bot, project, worker } or a refusal string. A ledger-bound bot
 * pane wins; a pane without a binding must carry a worker.of label (a worker pane), and its
 * project is the main checkout above its worktree, else the nearest .herdr/bots.json above its cwd.
 */
function callerOf(real, env, terminal) {
  const bound = boundCaller(env, terminal);
  if (bound) return { ...bound, project: bound.project ?? null };
  const get = hcJson(real, ["get", terminal], env);
  const of = get && typeof get === "object" && get.labels && typeof get.labels === "object" ? get.labels[WORKER_OF_LABEL] : null;
  if (typeof of !== "string" || !of) return "the caller is neither bound in the attach ledger nor a worker pane";
  return { bot: of, project: projectOfFolder(get.cwd), worker: true };
}

function readBots(project) {
  if (typeof project !== "string" || !project) return null;
  try { return parseBots(readFileSync(join(project, ".herdr", "bots.json"), "utf8")).file; } catch { return null; }
}

/** The bots the caller may address: lead chain up, members down, main, own workers (and its bot for a worker). */
function teamOf(file, caller) {
  const allowed = new Set();
  const main = mainBotOf(file);
  if (main) allowed.add(main.id);
  const seen = new Set([caller.bot]);
  let lead = effectiveLead(file, caller.bot).lead;
  while (lead && !seen.has(lead)) {
    allowed.add(lead);
    seen.add(lead);
    lead = effectiveLead(file, lead).lead;
  }
  for (const id of descendantsOf(file, caller.bot)) allowed.add(id);
  if (caller.worker) allowed.add(caller.bot);
  return allowed;
}

// ---- send: resolve the target with hc, then check its labels and the team graph ----

const SEND_VALUE_OPTIONS = new Set(["--if", "--timeout", "--on"]);
/** The first positional target of a verb and the options that take a value before it. */
const TARGET_VALUE_OPTIONS = {
  read: new Set(["--lines"]),
  get: new Set(),
  wait: new Set(["--children", "--output", "--timeout"]),
  put: new Set(),
  label: new Set(),
  kill: new Set(),
  rm: new Set(),
};
const TARGETED_VERBS = new Set(Object.keys(TARGET_VALUE_OPTIONS));
/** `hc events` names its terminal through option values, not a positional. */
const EVENTS_TARGET_OPTIONS = ["--terminal", "--children-of"];

/** The values of the named options (`--name value` or `--name=value`), in order. */
function optionValues(args, names) {
  const out = [];
  for (let i = 1; i < args.length; i += 1) {
    const word = args[i];
    for (const name of names) {
      if (word === name) {
        if (typeof args[i + 1] === "string") out.push(args[i + 1]);
        i += 1;
        break;
      }
      if (word.startsWith(`${name}=`)) {
        out.push(word.slice(name.length + 1));
        break;
      }
    }
  }
  return out;
}

/** The first positional word after the options, or null (`--` starts the positionals). */
function firstPositional(args, valueOptions = new Set()) {
  for (let i = 1; i < args.length; i += 1) {
    const word = args[i];
    if (word === "--") return args[i + 1] ?? null;
    if (valueOptions.has(word)) { i += 1; continue; }
    if (word.startsWith("-") && word !== "-") continue;
    return word;
  }
  return null;
}

/** The positional words of `hc send`, with its options and their values skipped. */
function sendPositionals(args) {
  const out = [];
  for (let i = 1; i < args.length; i += 1) {
    const word = args[i];
    if (word === "--") { out.push(...args.slice(i + 1)); break; }
    if (SEND_VALUE_OPTIONS.has(word)) { i += 1; continue; }
    if (word.startsWith("-") && word !== "-") continue;
    out.push(word);
  }
  return out;
}

/** The target's hc get answer: an address or name through ls, then get for the labels. */
function targetOf(real, word, on, env) {
  let address = word;
  if (on && !address.includes("/")) address = `${on}/${address}`;
  if (!address.includes("/")) {
    const rows = rowsOf(hcJson(real, ["ls"], env));
    const hit = rows.find((r) => r?.address === address) ?? rows.find((r) => r?.name === address);
    if (hit?.address) address = hit.address;
  }
  const get = hcJson(real, ["get", address], env);
  if (!get || typeof get !== "object" || get.error || !get.labels || typeof get.labels !== "object") return null;
  return { address, get, labels: get.labels };
}

function sendProblem(real, args, env, terminal, on) {
  const words = sendPositionals(args);
  const target = words[0];
  if (!target) return "no target";
  const caller = callerOf(real, env, terminal);
  if (typeof caller === "string") return caller;
  const file = readBots(caller.project);
  if (!file) return "the caller's project has no readable .herdr/bots.json";
  if (!file.bots.some((b) => b.id === caller.bot)) return "the caller is not a bot in the project's .herdr/bots.json";
  const hit = targetOf(real, target, on.value, env);
  if (!hit) return "the target is not resolvable with hc";
  const { labels } = hit;
  const allowed = teamOf(file, caller);
  if (typeof labels.bot === "string" && allowed.has(labels.bot)) return null;
  if (labels[WORKER_OF_LABEL] === caller.bot) return null;
  const role = typeof labels.role === "string" ? labels.role : "";
  if (SHARED_ROLES.includes(role)) return null;
  const def = typeof labels.bot === "string" ? file.bots.find((b) => b.id === labels.bot) : null;
  if (def && SHARED_ROLES.includes(def.rank)) return null;
  return "the target is not in the caller's team";
}

/** label is own-workers only: the target's parent must be the caller's own pane. */
function labelProblem(real, args, env, terminal, on) {
  const target = firstPositional(args, TARGET_VALUE_OPTIONS.label);
  if (!target) return "no target";
  const caller = callerOf(real, env, terminal);
  if (typeof caller === "string") return caller;
  const hit = targetOf(real, target, on.value, env);
  if (!hit) return "the target is not resolvable with hc";
  if (hit.get.parent !== terminal) return "the target is not the caller's own worker";
  return null;
}

// ---- run: exactly the worker start workers.js emits for dsh-tui ----

/** Canonical `cwd` under the project's .claude/worktrees/; false for a link or a path outside it. */
function underWorktrees(cwd, project) {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return false;
  const realCwd = realOrNull(cwd);
  const realProject = realOrNull(project);
  if (!realCwd || !realProject) return false;
  const root = realOrNull(join(realProject, ".claude", "worktrees"));
  if (!root) return false;
  return realCwd !== root && realCwd.startsWith(`${root}${sep}`);
}

/** Why `args` is not the worker shape, or null. */
function runProblem(args, env, terminal) {
  let bg = false, seenJson = false, cwd = null, parent = null, seenName = false, dashes = false;
  const labels = new Map();
  let i = 1;
  for (; i < args.length; i += 1) {
    const word = args[i];
    if (word === "--") { dashes = true; i += 1; break; }
    if (word === "--bg") {
      if (bg) return "--bg twice";
      bg = true;
      continue;
    }
    if (word === "--json") {
      if (seenJson) return "--json twice";
      seenJson = true;
      continue;
    }
    const value = args[i + 1];
    if (word === "--name") {
      if (seenName) return "--name twice";
      if (typeof value !== "string") return "--name without a value";
      seenName = true;
      i += 1;
      continue;
    }
    if (word === "--cwd") {
      if (cwd !== null) return "--cwd twice";
      if (typeof value !== "string") return "--cwd without a value";
      cwd = value;
      i += 1;
      continue;
    }
    if (word === "--parent") {
      if (parent !== null) return "--parent twice";
      if (typeof value !== "string") return "--parent without a value";
      parent = value;
      i += 1;
      continue;
    }
    if (word === "--label") {
      if (typeof value !== "string" || !value.includes("=")) return "--label without K=V";
      const eq = value.indexOf("=");
      const key = value.slice(0, eq);
      if (labels.has(key)) return `--label ${key} twice`;
      labels.set(key, value.slice(eq + 1));
      i += 1;
      continue;
    }
    return `${word} is not the worker shape`;
  }
  if (!dashes) return "no -- before the program";
  if (!bg) return "not --bg";
  if (cwd === null) return "no --cwd";
  if (parent === null) return "no --parent";
  if (parent !== terminal) return "--parent is not the caller's pane";
  if (labels.get(WORKER_OF_LABEL) === undefined) return `no --label ${WORKER_OF_LABEL}=<caller's bot>`;
  for (const key of labels.keys()) if (!WORKER_LABELS.has(key)) return `--label ${key} is not the worker shape`;
  const caller = boundCaller(env, terminal);
  if (!caller) return "only a bot pane the attach ledger binds starts a worker";
  if (labels.get(WORKER_OF_LABEL) !== caller.bot) return `${WORKER_OF_LABEL} is not the caller's bot`;
  if (!underWorktrees(cwd, caller.project)) return "--cwd is not under the caller's project .claude/worktrees/";
  const rest = args.slice(i);
  if (rest[0] !== ENV) return `the program is not ${ENV}`;
  if (!rest[1] || !rest[1].startsWith("PATH=")) return "no PATH word after the program";
  const first = rest[1].slice("PATH=".length).split(delimiter)[0];
  if (!isGuardFolder(first)) return "the PATH word does not start with a guard";
  if (rest[2] !== "dsh-tui") return "the program is not dsh-tui";
  if (rest.length !== 5 || rest[3] !== "--" || typeof rest[4] !== "string") return "the task is not the one -- <task> word";
  return null;
}
