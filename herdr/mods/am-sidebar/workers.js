// Bot workers: a bot writes no code; for each task it starts one worker, an hc child of its
// pane, in the task's worktree (`automagik-herdr worker`). This file holds the plain-data
// parts: which agent, model and effort (or hc template) a worker runs, its `hc run` arguments, the task
// worktree's folder and the git answers about worktrees, and the rows of the workers ledger
// usagemeter reads. Pure: no `herdr`, `gpui-*` or `fs`, so `node --test`, the CLI and the
// briefing hook share it. Apache-2.0.

import { AGENTS, effortArgs, hasEffortFlag, modelArgs, modelRefusal, promptArgs, resolveAgent } from "./models.js";
import { TEMPLATE_SHAPE } from "./model.js";
import { envWords } from "./logins.js";

export { TEMPLATE_SHAPE };

/** A Windows drive-letter path (`C:/x`, `C:\x`): `new URL` would read `C:` as a scheme. */
const DRIVE_LETTER = /^[A-Za-z]:[\\/]/;
/** A URL scheme (`file:`, `http:`), as opposed to a bare path. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** `path`'s folder plus `/guard`; a bare path loses its query/hash first. */
function guardDirUnder(path) {
  const file = path.replace(/[?#].*$/, "");
  const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return `${cut === -1 ? "." : file.slice(0, cut)}/guard`;
}

/**
 * The guard folder beside a mod file, from `import.meta.url`. Node gives a `file:` URL; Herdr's
 * mod runtime gives a bare path with its `?v=1` cache buster, which `new URL` cannot take as a
 * base. A Windows drive-letter path is bare too: `new URL` would read `C:` as a scheme and drop
 * the drive. A file: pathname that does not decode (a lone `%`) falls back to the undecoded
 * pathname, never the raw `file:` string. A bare path is stripped of its query/hash, then its
 * folder gets `/guard`; never throws.
 */
export function guardDirOf(metaUrl) {
  const raw = String(metaUrl);
  if (DRIVE_LETTER.test(raw) || !SCHEME.test(raw)) return guardDirUnder(raw);
  let pathname;
  try {
    pathname = new URL("./guard/", raw).pathname;
  } catch {
    // Not a URL this Node can read (say a relative path): the bare-path rule is all that is left.
    return guardDirUnder(raw);
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // A lone `%` is not an escape: keep the pathname the parser gave.
  }
  return pathname.replace(/\/+$/, "");
}

/**
 * The deny-by-default hc guard's folder (automagik#624, `guard/hc`): put first on a dsh-tui
 * pane's PATH only, by startArgs and workerArgs. A guardrail, never a boundary: an absolute
 * hc path, a raw socket or `hc connect` skips it; #628 is the full send/keys/attach scope; #631 is the hard boundary.
 */
export const GUARD_DIR = guardDirOf(import.meta.url);

/**
 * `path` with `guard` first; a guard folder already on the PATH is moved to the front, never
 * repeated. A null guard leaves the path exactly as it is.
 */
export function guardPathWith(path, guard) {
  if (!guard || !path) return path;
  return [guard, ...String(path).split(":").filter((dir) => dir !== guard)].join(":");
}

/**
 * `path` with this pack's guard folder first for a dsh-tui pane; any other agent's path
 * unchanged (byte for byte, so a non-dsh-tui start stays as it was).
 */
export function guardPath(path, agent) {
  return agent === "dsh-tui" ? guardPathWith(path, GUARD_DIR) : path;
}

// The usage-tagging contract (usagemeter reads these): a worker terminal carries
// `worker.of=<botId>`, `branch=<branch>` and `worker.role=<role>`, and its cwd is the task
// worktree. Started with Genie's task id (`--task`), it also carries `task=<id>`,
// `task.project=<main checkout>` and `task.lead=<lead bot>`; usagemeter joins on (project, task).
// A worker started before the task contract has no `branch` label: its `task` label is the
// branch (workerBranch reads either).
export const WORKER_OF_LABEL = "worker.of";
export const TASK_LABEL = "task";
export const TASK_PROJECT_LABEL = "task.project";
export const TASK_LEAD_LABEL = "task.lead";
export const BRANCH_LABEL = "branch";
/** What a worker does in its worktree: one of ROLES. */
export const WORKER_ROLE_LABEL = "worker.role";
export const WORKER_MODEL_LABEL = "worker.model";
export const WORKER_EFFORT_LABEL = "worker.effort";
/** The hc template a worker runs (`--template`, or the bot's `worker.template`). */
export const WORKER_TEMPLATE_LABEL = "worker.template";
/** The Claude session a terminal runs, set by the briefing hook when it changes. */
export const SESSION_LABEL = "agent.session";
/** The pane label the briefing hook sets to the session's transcript path (RFC 0015 delivery 2). */
export const TRANSCRIPT_LABEL = "agent.transcript";

/** A worker's roles. Dev, test and fix write to the worktree; review never does. */
export const ROLES = ["dev", "test", "review", "fix"];
export const WRITER_ROLES = ["dev", "test", "fix"];
const ROLE_OF_RANK = { tester: "test", reviewer: "review", fixer: "fix" };

/**
 * A worker's role: `given` (--role) when it is one of ROLES, else from the bot's rank
 * (tester: test, reviewer: review, fixer: fix, any other rank or none: dev). { role } or { error }.
 */
export function workerRole(bot, given) {
  if (given === undefined || given === null) return { role: ROLE_OF_RANK[bot?.rank] ?? "dev" };
  if (ROLES.includes(given)) return { role: given };
  return { error: `--role is one of ${ROLES.join(", ")}, not "${given}".` };
}

/**
 * Whether a live worker's labels make it a writer: a writer role, or no role label at all
 * (a worker started before roles holds its worktree until it ends).
 */
export const writesWorktree = (labels) => labels?.[WORKER_ROLE_LABEL] !== "review";

/** Genie's short task id (gh-1415, gl-231, gn-42); the internal `t_…` key is refused apart. */
export const TASK_SHAPE = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** A lead: a bot id (`b-` plus 10 base32 characters) or a Genie session (`session-<uuid>`). */
export const LEAD_SHAPE = /^(?:b-[a-z2-7]{10}|session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** The ranks whose task workers name their lead: the task belongs to another bot. */
export const LEAD_RANKS = ["reviewer", "fixer"];
/** hc's terminal names: 1-32 of a-z 0-9 - _ (`hc run --name`). */
export const HC_NAME_MAX = 32;

/** Why `--task <id>` can't be used, or null. */
export function taskIdProblem(taskId) {
  if (typeof taskId !== "string") return "--task needs Genie's short task id (gn-N, gh-N or gl-N).";
  if (taskId.startsWith("t_")) return "internal Genie id; pass the short id gn-N, gh-N or gl-N";
  if (!TASK_SHAPE.test(taskId)) {
    return `--task: "${taskId}" isn't a short task id (a-z, 0-9 and "-", at most 41, no dash first: gn-42, gh-1415, gl-231).`;
  }
  return null;
}

/**
 * Whether `branch` names task `taskId` as a whole token: preceded by its start, "/", "-" or
 * "_", and followed by its end, "/", "-" or "_" (fix/gl-231-login names gl-231, not gl-23).
 */
export function branchNamesTask(branch, taskId) {
  if (typeof branch !== "string" || typeof taskId !== "string" || !taskId) return false;
  for (let at = branch.indexOf(taskId); at >= 0; at = branch.indexOf(taskId, at + 1)) {
    const before = at === 0 ? "" : branch[at - 1];
    const after = branch[at + taskId.length] ?? "";
    if ((before === "" || "/-_".includes(before)) && (after === "" || "/-_".includes(after))) return true;
  }
  return false;
}

/** A task worker's terminal name: exactly `<id>-<role>`, never suffixed. */
export const taskWorkerName = (taskId, role) => `${taskId}-${role}`;

/** A worker's branch from its labels: `branch`, else (started before the task contract) `task`. */
export const workerBranch = (labels) => labels?.[BRANCH_LABEL] || labels?.[TASK_LABEL] || null;
/** A worker's Genie task id: `task` beside a `branch` label (without one, `task` is the old branch). */
export const workerTaskId = (labels) => (labels?.[BRANCH_LABEL] ? labels?.[TASK_LABEL] || null : null);

/**
 * Whether a task runs its bot's other arm (planned swaps): `byte` is the first byte of
 * sha256(`${botId}:${projectKey}:${taskId}`), computed by the caller (no `node:` import
 * here). One task in three, by rule, the same for every worker of that bot on that task.
 */
export const swapByte = (byte) => Number.isInteger(byte) && byte % 3 === 0;

/** A bot's swap arm (`worker.swap`: { agent?, model?, effort? }) as a workerPlan pick, or null. */
export function swapArm(bot) {
  const w = bot?.worker;
  const swap = w && typeof w === "object" && w.swap && typeof w.swap === "object" && !Array.isArray(w.swap) ? w.swap : null;
  if (!swap) return null;
  const arm = {};
  for (const k of ["agent", "model", "effort"]) if (typeof swap[k] === "string" && swap[k]) arm[k] = swap[k];
  return Object.keys(arm).length ? arm : null;
}

/**
 * Whether a worker with this `pick` runs an hc template: a per-task template, or the bot's
 * default template with no per-task agent, model or effort. A template worker never swaps.
 */
export function runsTemplate(bot, pick = {}) {
  if (pick.template) return true;
  const defaults = bot?.worker && typeof bot.worker === "object" ? bot.worker : {};
  return Boolean(defaults.template) && !["agent", "model", "effort"].some((k) => pick[k]);
}

/** A value the agent would read as an option (a model, a task text starting with a dash). */
export const optionLike = (value) => typeof value === "string" && value.trimStart().startsWith("-");

/** An effort level as the agents spell them (low, medium, high, xhigh, max, …). */
export const EFFORT_SHAPE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * What a worker runs: the per-task `pick` ({ template, agent, model, effort }, each optional)
 * over the bot's `worker` defaults, over the bot's own agent. A template owns its command, so
 * it runs alone: a pick naming a template and an agent, model or effort is refused; a default
 * template wins over default agent, model and effort (with a warning); and any per-task agent,
 * model or effort sets a default template aside. A bot's default model is for its default
 * worker agent: a task that picks another agent runs that agent's own default model unless it
 * names one. The bot's own model pin is its seat's, never its workers'. A model or effort the
 * agent has no flag for is left out with a warning. `agents`: the table Herdr starts from.
 * Returns { template, agent, model, effort, argv, warnings } (template null, or agent, model,
 * effort and argv null) or { error }.
 */
export function workerPlan(bot, pick = {}, agents = AGENTS) {
  const warnings = [];
  const defaults = bot?.worker && typeof bot.worker === "object" ? bot.worker : {};
  const picked = ["agent", "model", "effort"].filter((k) => pick[k]);
  const asTemplate = (template) => (TEMPLATE_SHAPE.test(template) ? { template, agent: null, model: null, effort: null, argv: null, warnings }
    : { error: `"${template}" isn't an hc template name (letters, digits, ".", "_" and "-", no dash first).` });
  if (pick.template) {
    if (picked.length) return { error: `A template owns its command: --template goes alone, without --${picked.join(", --")}.` };
    return asTemplate(pick.template);
  }
  if (defaults.template && !picked.length) {
    const shadowed = ["agent", "model", "effort"].filter((k) => defaults[k]);
    if (shadowed.length) warnings.push(`${bot.name}'s worker template ${defaults.template} owns its command; its worker ${shadowed.join(", ")} default${shadowed.length > 1 ? "s are" : " is"} ignored.`);
    return asTemplate(defaults.template);
  }
  let fallback = bot?.agent ?? null;
  if (defaults.agent) {
    const key = resolveAgent(defaults.agent, agents);
    if (key) fallback = key;
    else warnings.push(`${bot.name}'s worker agent "${defaults.agent}" isn't one Herdr knows; its own agent ${fallback} is used.`);
  }
  let agent = fallback;
  if (pick.agent) {
    agent = resolveAgent(pick.agent, agents);
    if (!agent) return { error: `"${pick.agent}" isn't a coding agent Herdr knows. Known: ${Object.keys(agents).join(", ")}.` };
  }
  if (!agent || !agents[agent]?.run?.length) return { error: `${bot?.name ?? "This bot"} has no coding agent for its workers; pass --agent.` };
  // An agent whose model and effort its own setup decides (dsh-tui, #598): a model or effort
  // asked for, or set in the bot's worker defaults for it, is refused, never left out unsaid.
  // Defaults count only when they are that agent's (the bot's own agent), as the model default
  // does: a Claude captain's worker effort never stops its dsh-tui worker (#600 review F4).
  const refusal = modelRefusal(agent);
  if (refusal && (pick.model || pick.effort || (agent === fallback && (defaults.effort || defaults.model)))) return { error: refusal };
  let model = pick.model || null;
  if (!model && defaults.model) {
    if (agent === fallback) model = defaults.model;
    else warnings.push(`${bot.name}'s worker model ${defaults.model} is for ${fallback}; ${agent} runs its own default.`);
  }
  if (model && optionLike(model)) return { error: `"${model}" isn't a model: it starts with a dash, so ${agent} would read it as an option.` };
  let effort = pick.effort || (defaults.effort && (agent === fallback || !refusal) ? defaults.effort : null) || null;
  if (!pick.effort && defaults.effort && agent !== fallback && refusal) {
    warnings.push(`${bot.name}'s worker effort ${defaults.effort} is for ${fallback}; ${agent} runs its own default.`);
  }
  if (effort && !EFFORT_SHAPE.test(effort)) return { error: `"${effort}" isn't an effort level (low, medium, high, …).` };
  if (model && !modelArgs(agent, model).length) {
    warnings.push(`${agents[agent].name} has no model flag this pack knows; model ${model} left out.`);
    model = null;
  }
  if (effort && !hasEffortFlag(agent)) {
    warnings.push(`${agents[agent].name} has no effort flag; effort ${effort} left out.`);
    effort = null;
  }
  const argv = [...agents[agent].run, ...modelArgs(agent, model), ...effortArgs(agent, effort)];
  return { template: null, agent, model, effort, argv, warnings };
}

/**
 * `hc run` arguments for a worker: in the background, a child of the bot's pane, in the
 * task worktree, with the usage labels and no `bot` label (a worker is never a bot, so the
 * sidebar folds it under its bot as a helper). The task text is the agent's last argument
 * (behind `-i` for agy: models.js promptArgs, by `agent`), after `--`, never part of a shell string. An agent runs as `/usr/bin/env PATH=<path> <argv>`
 * (env by its full path, so nothing hangs on core's PATH), so it gets the calling pane's PATH,
 * not herdr-core's (a bun script like omp needs ~/.bun/bin). A
 * `template` runs in hc's documented template form, `<template> <task>` after the options,
 * with no `--` (neither starts with a dash: both are refused before): it sets its own command.
 * `login`: a Claude worker's login words (logins.js chooseLogin), after PATH. A Claude template
 * can't take them through hc's template form, so it runs its own command instead
 * (`templateArgv`, `sh -c '<command> "$@"' sh <task>`, as Restart re-runs a template) under
 * `/usr/bin/env <login words>`, its template label kept. `agent` `dsh-tui`: the pack's
 * deny-by-default hc guard folder goes first on the worker PATH (GUARD_DIR); a guardrail, not a
 * boundary (#624, #628, #631).
 */
export function workerArgs({ botId, branch, role, name, cwd, parent, agent, model, effort, argv, task, template, path,
  taskId, project, lead, space, login = [], templateArgv = null }) {
  const args = ["run", "--bg", "--json"];
  if (name) args.push("--name", name);
  args.push("--cwd", cwd, "--label", `${WORKER_OF_LABEL}=${botId}`);
  if (taskId) {
    args.push("--label", `${TASK_LABEL}=${taskId}`, "--label", `${TASK_PROJECT_LABEL}=${project}`);
    if (lead) args.push("--label", `${TASK_LEAD_LABEL}=${lead}`);
  }
  args.push("--label", `${BRANCH_LABEL}=${branch}`);
  if (role) args.push("--label", `${WORKER_ROLE_LABEL}=${role}`);
  // The bot's Herdr space and no tab: the worker opens in a tab of its own there.
  if (space) args.push("--label", `herdr.space=${space}`);
  if (template && templateArgv) {
    return [...args, "--label", `${WORKER_TEMPLATE_LABEL}=${template}`, "--parent", parent, "--", ENV, ...envWords([], login), ...templateArgv];
  }
  if (template) return [...args, "--label", `${WORKER_TEMPLATE_LABEL}=${template}`, "--parent", parent, template, task];
  if (model) args.push("--label", `${WORKER_MODEL_LABEL}=${model}`);
  if (effort) args.push("--label", `${WORKER_EFFORT_LABEL}=${effort}`);
  const vars = envWords(path ? [`PATH=${guardPath(path, agent)}`] : [], login);
  const env = vars.length ? [ENV, ...vars] : [];
  return [...args, "--parent", parent, "--", ...env, ...argv, ...promptArgs(agent, task)];
}

/** A program path's own name (`/bin/sh` is `sh`). */
const shellBase = (p) => String(p ?? "").split("/").pop();

// The shells whose `-c` carries a script a template's command may be wrapped in.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);

// The characters that end a simple command in a shell command string.
const SEPARATORS = new Set([";", "&", "|", "(", ")", "<", ">", "\n"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A shell command string's simple commands: each a word list, split on ; & | ( ) < > and
 * newlines outside quotes. Quotes group a word and are dropped, a backslash escapes the next
 * character. Never throws on an unclosed quote.
 */
function shellCommands(text) {
  const commands = [];
  let words = [], word = "", quote = null, has = false;
  const endWord = () => { if (has) { words.push(word); word = ""; has = false; } };
  const endCommand = () => { endWord(); if (words.length) { commands.push(words); words = []; } };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === "\\" && quote === '"' && i + 1 < text.length) { word += text[++i]; has = true; continue; }
      word += ch; has = true; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (ch === "\\" && i + 1 < text.length) { word += text[++i]; has = true; continue; }
    if (SEPARATORS.has(ch)) { endCommand(); continue; }
    if (/\s/.test(ch)) { endWord(); continue; }
    word += ch; has = true;
  }
  endCommand();
  return commands;
}

/**
 * The programs a command string runs: for each simple command, its first word after env
 * assignments and the wrappers env, exec and nohup; a shell's `-c` script is followed the same
 * way, a few levels deep. A word in argument position is never a program.
 */
function commandPrograms(text, depth = 0) {
  const out = [];
  for (const words of shellCommands(text)) {
    let i = 0;
    for (;;) {
      while (i < words.length && ASSIGNMENT.test(words[i])) i += 1;
      const name = shellBase(words[i]);
      if (name === "env") {
        i += 1;
        while (i < words.length) {
          if (words[i] === "-u" || words[i] === "--unset") { i += 2; continue; }
          if (words[i].startsWith("-") || ASSIGNMENT.test(words[i])) { i += 1; continue; }
          break;
        }
        continue;
      }
      if (name === "exec" || name === "nohup") { i += 1; continue; }
      if (SHELLS.has(name) && words[i + 1] === "-c" && typeof words[i + 2] === "string") {
        if (depth < 4) out.push(...commandPrograms(words[i + 2], depth + 1));
        i = words.length;
        break;
      }
      break;
    }
    if (i < words.length) out.push(shellBase(words[i]));
  }
  return out;
}

/** The agent key `program` names (a key, an agent's run[0] or a match name), or null. */
function agentOfProgram(program, agents) {
  for (const [key, agent] of Object.entries(agents)) {
    if (key === program || shellBase(agent?.run?.[0]) === program || (agent?.match ?? []).includes(program)) return key;
  }
  return null;
}

/**
 * The agent an hc template's command runs: the one agent its simple commands' programs name,
 * after env assignments and the wrappers env, exec and nohup, a shell's `-c` script followed the
 * same way (`sh -c "omp --auto-approve"`, also behind env assignments). A word in argument
 * position never counts (`echo omp` names nothing), and more than one agent fails closed (null),
 * so the restart falls back to the source rather than adopt another agent's command.
 */
export function templateAgent(command, agents = AGENTS) {
  const found = new Set();
  for (const program of commandPrograms(String(command ?? ""))) {
    const key = agentOfProgram(program, agents);
    if (key) found.add(key);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** The env program agent workers start under, by its full path (macOS and Linux both have it). */
export const ENV = "/usr/bin/env";

/** A branch name as a folder name: lowercase, `/` and other marks as `-`. */
export function branchSlug(branch) {
  return String(branch).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64) || "task";
}

/** The exclude line that keeps task worktrees out of the main checkout's `git add -A`. */
export const WORKTREES_EXCLUDE = "/.claude/worktrees/";

/** Where a new task worktree goes: `<main checkout>/.claude/worktrees/<slug>`. */
export const worktreeFolder = (mainCheckout, branch) => `${mainCheckout === "/" ? "" : mainCheckout.replace(/\/+$/, "")}/.claude/worktrees/${branchSlug(branch)}`;

/** `git worktree list --porcelain` as [{ path, branch (short name, or null), detached, bare }]. */
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const ref = lines.find((l) => l.startsWith("branch "))?.slice(7) ?? null;
    out.push({ path, branch: ref?.startsWith("refs/heads/") ? ref.slice(11) : ref,
      detached: lines.includes("detached"), bare: lines.includes("bare") });
  }
  return out;
}

/**
 * The refs a new task branch may start from, in order: `--base` alone when given; else
 * origin/HEAD's branch, then dev, then main, then master (each as origin's, then local). The caller takes
 * the first that git verifies.
 */
export function baseCandidates(given, originHead) {
  if (given) return [given];
  const out = [];
  if (originHead) out.push(originHead);
  for (const name of ["dev", "main", "master"]) out.push(`origin/${name}`, name);
  return [...new Set(out)];
}

// ---- the workers ledger: <app home>/automagik-herdr/workers.jsonl ----
//
// Append-only, one JSON object per line, each line one O_APPEND write. Rows outlive the
// terminals: usagemeter joins its usage to bots and tasks through them.

export const LEDGER_FILE = "automagik-herdr/workers.jsonl";
export const ledgerPath = (appHome) => `${String(appHome).replace(/\/+$/, "")}/${LEDGER_FILE}`;
const stamp = (at) => new Date(at ?? Date.now()).toISOString();
const orNull = (x) => (x === undefined || x === "" ? null : x);

/**
 * A start row: a worker (`kind: "worker"`, `worktree` its cwd as a real path) or a bot seat
 * (`kind: "seat"`, from start and attach; `worktree` its folder). `task`: Genie's task id
 * (`--task`), else null; rows written before the task contract hold the branch there, with
 * no `branch` key. `branch`: the worker's branch. `project`: the main checkout (usagemeter
 * joins on project and task); `lead`: the task's lead bot; `base`: the commit the worktree
 * started from; `created`: this command made the worktree. `swap`: the task ran the bot's
 * other arm (planned swaps); `override`: the bot picked the agent, model, effort or template
 * itself; `override_requested`: on a swap task, the { agent?, model?, effort? } it asked for
 * and didn't get, else null. `pid` is the terminal's foreground pid when hc gave one.
 * `template`: the hc template a worker runs (its agent, model and effort are then null),
 * else null. `role`: a worker's role (ROLES). A seat's worker fields are null or false.
 */
export function startRow({ kind, terminal, pid, botId, task, branch, project, lead, worktree, base, created, agent, model, effort,
  template, role, swap, override, overrideRequested, at }) {
  const requested = overrideRequested && Object.keys(overrideRequested).length ? { ...overrideRequested } : null;
  return { event: "start", kind, terminal, pid: Number.isInteger(pid) ? pid : null, botId, task: orNull(task),
    worktree: orNull(worktree), agent: orNull(agent), model: orNull(model), effort: orNull(effort), template: orNull(template),
    role: orNull(role), branch: orNull(branch), project: orNull(project), lead: orNull(lead), base: orNull(base),
    created: created === true, swap: swap === true, override: override === true, override_requested: requested, at: stamp(at) };
}

/** A session row: the Claude session (and its transcript) a terminal now runs. */
export function sessionRow({ terminal, session, transcript, at }) {
  return { event: "session", terminal, session, transcript: orNull(transcript), at: stamp(at) };
}

/** One ledger line. */
export const ledgerLine = (row) => `${JSON.stringify(row)}\n`;

/** A ledger's rows; a line that isn't a JSON object (a torn write) is skipped. */
export function readLedger(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row); } catch { /* skipped */ }
  }
  return rows;
}

// ---- worktree cleanup (#567): <app home>/automagik-herdr/worker-reap.jsonl ----
//
// A worker's created worktree is removed once its workers have ended. What the sweep did with
// each one is kept in a file of its own, never in the workers ledger (its readers and shapes
// stay as they are): { worktree, result: "removed" | "kept" | "failed" | "gone", why, at }.

export const REAP_FILE = "automagik-herdr/worker-reap.jsonl";
export const reapPath = (appHome) => `${String(appHome).replace(/\/+$/, "")}/${REAP_FILE}`;

/** A cleanup row: what the sweep did with `worktree`, and why (null when there is nothing to say). */
export const reapRow = ({ worktree, result, why, at }) => ({ worktree, result, why: orNull(why), at: stamp(at) });

/**
 * The worktrees a sweep looks at, from the workers ledger's `rows` and the cleanup file's
 * `reaps`: each path a worker start row says this command made (`created: true`), as
 * { worktree, project, branch, terminals, last }, newest created first. `branch`: the worker's
 * branch (a row from before the task contract has no `branch` key and holds it in `task`).
 * `terminals`: every start row's terminal on that path since its newest created row (a
 * restart's new pane, a later worker given the same worktree), all of which must have ended.
 * `last`: the newest cleanup row for it since then ({ result, why, at }), else null. A path
 * already removed or gone is left out; one only ever given (`created: false`: --worktree, a
 * branch's existing worktree) is never in the list.
 */
export function reapCandidates(rows, reaps = []) {
  const by = new Map();
  for (const r of rows) {
    if (r?.event !== "start" || typeof r.worktree !== "string" || !r.worktree) continue;
    if (r.kind === "worker" && r.created === true) {
      const branch = orNull("branch" in r ? r.branch : r.task);
      by.delete(r.worktree);
      by.set(r.worktree, { worktree: r.worktree, project: orNull(r.project), branch, terminals: [], since: String(r.at ?? ""), last: null });
    }
    const c = by.get(r.worktree);
    if (c && typeof r.terminal === "string" && r.terminal) c.terminals.push(r.terminal);
  }
  for (const r of reaps) {
    const c = typeof r?.worktree === "string" ? by.get(r.worktree) : null;
    if (c && String(r.at ?? "") >= c.since) c.last = { result: r.result, why: r.why ?? null, at: r.at ?? null };
  }
  return [...by.values()].filter((c) => c.last?.result !== "removed" && c.last?.result !== "gone")
    .reverse().map(({ since, ...c }) => c);
}

/**
 * Why a worktree with no live worker is kept, or null when it may go: `changes`, the lines of
 * `git status --porcelain`; `unpushed`, the commits on no remote branch; `branch`, the branch
 * checked out (null: a detached HEAD); `expected`, the worker's branch from the ledger; `prs`,
 * the branch's pull requests as gh lists them ([{ state }]), or null when gh couldn't say. A
 * worktree no longer on the worker's branch is kept (the folder may be another tree now); a
 * detached HEAD with commits on no remote is kept whatever its branch's pull requests say. Commits
 * on no remote keep it unless the branch has pull requests and every one is MERGED or CLOSED (a
 * squash merge leaves its commits on no remote once the branch is deleted).
 */
export function workLeft({ changes, unpushed, prs = null, branch = null, expected = null }) {
  if (changes > 0) return "uncommitted changes";
  if (!branch) {
    return unpushed > 0 ? `HEAD is detached with ${unpushed} ${unpushed === 1 ? "commit" : "commits"} on no remote`
      : `HEAD is detached, not on the worker's branch ${expected ?? "(none recorded)"}`;
  }
  if (!expected) return `on ${branch}, and the workers ledger names no branch for it`;
  if (branch !== expected) return `on ${branch}, not the worker's branch ${expected}`;
  if (unpushed > 0) {
    if (Array.isArray(prs) && prs.length && prs.every((p) => p?.state === "MERGED" || p?.state === "CLOSED")) return null;
    const commits = `${unpushed} ${unpushed === 1 ? "commit" : "commits"} on no remote`;
    if (prs === null) return `${commits}; gh couldn't tell whether ${branch} has a merged or closed pull request`;
    return prs.length ? `${commits}; ${branch} has an open pull request` : `${commits}; ${branch} has no pull request`;
  }
  return null;
}

/**
 * What the briefing hook does about a Claude session: `get` is `hc get` of its terminal,
 * `input` the hook's stdin text, `resolve(path)` the transcript folder rule: a real path when
 * the path passes, else null (none given: no path passes). Null when there is nothing to do;
 * else { session, transcript, fresh, label }: `fresh` when SESSION_LABEL doesn't hold the
 * session yet (label it, append a row); `label` the TRANSCRIPT_LABEL value to set (the hook's
 * transcript_path as given, once the rule passes it, when the label is missing or differs; ""
 * removes a new session's stale one) or null to leave it. The row's `transcript` is the
 * hook's path as given, as before.
 */
export function sessionChange(get, input, resolve = () => null) {
  let data = null;
  try { data = typeof input === "string" && input.trim() ? JSON.parse(input) : null; } catch { data = null; }
  const session = data?.session_id;
  if (typeof session !== "string" || !session.trim() || !get || typeof get !== "object") return null;
  const transcript = typeof data.transcript_path === "string" ? data.transcript_path : null;
  const fresh = get.labels?.[SESSION_LABEL] !== session;
  const had = get.labels?.[TRANSCRIPT_LABEL];
  const real = transcript === null ? null : resolve(transcript);
  const ok = typeof real === "string" && real !== "";
  const label = ok ? (had === transcript ? null : transcript) : (fresh && had ? "" : null);
  if (!fresh && label === null) return null;
  return { session, transcript, fresh, label };
}
