#!/usr/bin/env node
// automagik-herdr: Automagik Herdr from the command line (A11, A15): a project's bots, and
// updates of the installed pack (A14, update.mjs). The bots follow the same rules as the
// sidebar (model.js, launchArgs.js, briefingText.mjs, models.js, briefing.mjs' gathering),
// with herdr-core reached through `hc` directly. Plain node (≥ 24): no `herdr` or `gpui`
// import, no Herdr window.
// Install: ln -s ~/.config/herdr-app/mods/am-sidebar/bin/automagik-herdr ~/.local/bin/automagik-herdr
// (that wrapper runs this file through bin/run.sh, which finds node 22.7+ or bun without node on PATH).
// Apache-2.0.

import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, chmodSync, closeSync, constants, existsSync, fchmodSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync,
  renameSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { BOT_LABEL, BOTS_PATH, CHARACTERS, COLOURS, KINDS, MAX_INSTRUCTIONS, OMNI_LOOK, applyBotEdit, checkBots,
  CATEGORY_ID, PROJECTS_FILE, RANKS, defaultLook, descendantsOf, effectiveLead, listedProjects, mainBotOf, newBotId, newCategoryId,
  botsText, parseBots, plannedOf, projectKeyOf, projectOf, squadOf, withListedProject, writeFolderOf } from "../model.js";
import { UNANSWERED, agentInForeground, attachRefusal, attachWords, detachWords, hcName, isClaude, leadIdOf, leadPane, newest,
  paneLabels, paneOf, parentArgs, placementFrom, relabel, relabelPlan, relabelWarning, relabelWords, rowsOf, spaceOnly, spacePlace,
  freshSpare, roleOf, shellIdle, spareTab, startArgs, startRefusal, unwrapKeep } from "../launchArgs.js";
import { tabSteps, workerSpace, workerTabName } from "../workerTab.js";
import { addressOf, attachKey, attachLine, attachPath, attachRow, closingRow, confirmBindings, foldAttach, heldIn, machinesById, modeProblem, placeOf as placeOfRow, readAttach } from "../attach.js";
import { PANE_ENV_PATH, agentOnMachine, interpreterPath, paneEnvOf } from "../agentPath.mjs";
import { briefingFilePath, installHook, launchBriefingText, screenTail, stableBriefingPath, withExclude } from "../briefingText.mjs";
import { gatherBriefing } from "../briefing.mjs";
import { AGENTS, AGY_MODE_DEFAULT, AGY_MODES, agentKeyOfArgv, agyModeArgs, agyModeOf, agyModeProblem, agyPermissionPlan, agyRuleProblem, agySandbox, agySettingsArgs, agySettingsDir, agySettingsPlan, choosesSession, continuesAnywhere, briefingHook, briefingLaunch, briefingOwnConfig, briefingWay, configPaths, defaultModel, detectModel, knownModels, modelArgs, modelRefusal, ownPromptIn, ownsSession, resolveAgent, resumeAfterTurn, resumesById,
  sessionIdArgs, shownModel, withAgySettings, withBriefing, withOverrides } from "../models.js";
import { AG_MODELS_TIMEOUT_MS, agModelsSpawnResult, refreshAgModelsSync } from "../modelCache.js";
import { EFFORT_SHAPE, HC_NAME_MAX, LEAD_RANKS, LEAD_SHAPE, LEDGER_FILE, ROLES, WORKER_OF_LABEL, WORKER_ROLE_LABEL, WORKER_TEMPLATE_LABEL, WORKTREES_EXCLUDE,
  GUARD_DIR, SESSION_LABEL, baseCandidates, branchNamesTask, branchSlug, guardPathWith,
  LEDGER_MODE, endRow, finishedEnds, launchKey, ledgerLine, ledgerPath, optionLike, paneArgs, readLedger, reapCandidates, reapPath, reapRow,
  sessionRow, stableGuardDir, stableRootOf,
  parseWorktrees, runsTemplate, startRow, swapArm, swapByte,
  taskIdProblem, taskWorkerName, TEMPLATE_SHAPE, templateAgent, workerArgs, workerBranch, workerPlan, workerRole, worktreeFolder,
  workLeft, writesWorktree } from "../workers.js";
import { SESSION_MASK, carriedLabels, maskSession, commandArgv, continueRefusal, doomedHelpers, helperArgs, helperPlan, launchChange, ledgerSession, maskedArgv,
  paneCommand, planText as restartText, restartPlan, sharedFresh, claudeSlug, paneSession, restartRefusal, sameSessions, sessionFor, sessionId, sharedFolders } from "../restart.js";
import { autoStatus, readAuto, binDirOf, checkForUpdate, defaultModsDir, installUpdate, liveHome, managedPack, readMarker, relinkCli, rollback as rollbackPack, writeAuto, writeMarker } from "../update.mjs";
import { NO_UPDATE_ENV, PACK_NAME, POCKET_LINK, heldModLine, updatesOff } from "../release.js";
import { MACHINE_NAME, OPT_IN, decodeExec, hcExecArgs, installOn, linkedMachines, meterScope, recordAfter, resultLine, uninstallOn } from "../meterFleet.js";
import { readMeterLane } from "../meterLane.mjs";
import { SHARED_RENAMES, renamedFrom } from "../migrate.js";
import { REMOTE_TEXT_MAX, RemoteFileError, StaleSnapshot, readRemoteText, removeRemoteText, utf8Length, writeRemoteText } from "../remoteFile.js";
import { botHistory, historyLines } from "../inspect.js";
import { chooseLogin } from "../logins.js";
import { DocError, docGet } from "../docGet.mjs";
import { DSH_TUI, approvedDataRootProblem, doctorBotProxies, doctorDshTui, installDshTui,
  uninstallDshTui, workerProxyTransport } from "../dshTui.mjs";
import { approveProject, approvedProxyEnabled, approvedProxyState, approvedSettingsDir, parseApprovedRecord,
  projectKey, proxyStateFor, recordFileOf } from "../approved.js";
import { hooksNotice } from "../migrateHooks.mjs";
import { SPACE_LABEL, plan as tidyPlan, planText } from "../tidy.js";
import { fixNonVisual, readState, spacesOf } from "./state.mjs";

/**
 * A refusal or a usage mistake: printed on stderr, exit `code`. `detail`: fields a --json run
 * also prints on stdout, beside `error` (the message), for a caller that shows them (#413).
 */
export class CliError extends Error {
  constructor(message, code = 1, detail = null) { super(message); this.code = code; this.detail = detail; }
}

// ---- files and programs ----

/** A file's text, or null when it isn't there. Any other read failure is a CliError. */
export function readText(path) {
  try { return readFileSync(path, "utf8"); } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw new CliError(`Can't read ${path}: ${e?.message ?? e}`);
  }
}
const exists = async (path) => { try { accessSync(path); return true; } catch { return false; } };
/** Where a link points (its text, as readlink gives it), or null when `path` is not a link. */
const readLink = (path) => { try { return readlinkSync(path); } catch { return null; } };
const under = (key, rest) => `${key === "/" ? "" : key}/${rest}`;

// At most this many programs at once: `ls --all` over many bots stays a handful of processes.
const MAX_RUNNING = 8;
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= MAX_RUNNING) await new Promise((go) => waiting.push(go));
  running += 1;
  try { return await fn(); } finally { running -= 1; waiting.shift()?.(); }
}

/** Runs a program: { code, stdout, stderr }; code 127 when it isn't there; killed: true when its timeout ended it. */
export function runProgram(command, args, { cwd, timeout = 15000 } = {}) {
  return slot(() => new Promise((done) => {
    try {
      execFile(command, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (!err) return done({ code: 0, stdout, stderr });
        done({ code: err.code === "ENOENT" ? 127 : (typeof err.code === "number" ? err.code : 1), stdout: stdout ?? "", stderr: stderr || String(err.message),
          ...(err.killed ? { killed: true } : {}) });
      });
    } catch (e) { done({ code: 127, stdout: "", stderr: String(e?.message ?? e) }); }
  }));
}
const git = async (args, cwd) => { const r = await runProgram("git", args, { cwd }); return r.code === 0 ? r.stdout : null; };

/** Check the project's own filesystem, including linked projects, before adding worker advice. */
async function projectIsGit(project) {
  const args = ["rev-parse", "--is-inside-work-tree"];
  if (project.machine) {
    const r = await remoteIo.exec("git", args, project.machine, { cwd: project.key });
    return r.code === 0 && r.stdout.trim() === "true";
  }
  return (await git(args, project.key))?.trim() === "true";
}

/** The project a folder keys to (DESIGN Decision 15): the walk-up, for the folder a command runs in. */
export const keyOf = (folder) => projectKeyOf(resolvePath(folder), git, exists);

/**
 * The project `--project <dir>` names: the folder itself outside git, never a parent
 * project's (its git main checkout in git). A folder that isn't there is refused.
 */
export async function namedKeyOf(folder) {
  const dir = resolvePath(folder);
  let isDir = false;
  try { isDir = statSync(dir).isDirectory(); } catch { /* not there */ }
  if (!isDir) throw new CliError(`--project: ${dir} is not a folder.`, 2);
  return (await projectOf(dir, git, exists)).own;
}
// The projects this run named, for the attach ledger's one-time import (projectDefining).
const namedKeys = new Set();
const commandKeyOf = async (opts) => {
  const key = await (opts.project !== undefined ? namedKeyOf(opts.project) : keyOf(process.cwd()));
  namedKeys.add(key);
  return key;
};

async function hc(args, { timeout } = {}) {
  const r = await runProgram(programPath("hc") ?? "hc", args, { timeout });
  if (r.code === 127) throw new CliError("hc (herdr-core) is not on PATH.");
  return r;
}
const parsed = (r, args) => {
  try { return JSON.parse(r.stdout); } catch { throw new CliError(`hc ${args.join(" ")} printed no JSON: ${r.stdout.slice(0, 200)}`); }
};
/** `hc <args> --json`, parsed. A failed call throws: a failure never reads as "no pane". */
async function hcJson(args) {
  const r = await hc([...args, "--json"]);
  if (r.code !== 0) throw new CliError(`hc ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return parsed(r, args);
}
/** `hc get <t> --json`, or null when hc says there is no such terminal (hc itself missing still throws). */
async function hcGet(terminal, { timeout } = {}) {
  const r = await hc(["get", terminal, "--json"], { timeout });
  return r.code === 0 ? parsed(r, ["get", terminal]) : null;
}
const local = (address) => typeof address === "string" && !address.includes("/");

function appHome(env = process.env) { return (env.HERDR_APP_HOME || `${homedir()}/.config/herdr-app`).replace(/\/+$/, ""); }
/**
 * The am part's installed store (am/lib/self.mjs storeOf): <AM_HOME, else ~/.automagik>/
 * parts/automagik.am. A CLI-only host's hook goes through it (briefingText.mjs installHook).
 */
const amStore = (env = process.env) => `${(env.AM_HOME || `${env.HOME || homedir()}/.automagik`).replace(/\/+$/, "")}/parts/automagik.am`;
const home = () => process.env.HOME || homedir();
/** The agent a launch argv runs: a `sh -c <command>` (a template's) by its command, else by its program. */
const launchAgent = (argv, agents = agentTable()) => (Array.isArray(argv) && /(^|\/)(ba|z|da)?sh$/.test(argv[0] ?? "") && argv[1] === "-c"
  ? templateAgent(argv[2], agents) : agentKeyOfArgv(argv, agents));
/**
 * The Claude login words for a local launch of `argv` (#453, logins.js): read from the app home's
 * claude-logins.json at this launch, only when `argv` runs Claude Code; [] for any other agent,
 * which never reads the record. A record that can't be followed gives login A's words and its
 * warning (pushed on `warnings`), never a refusal.
 */
function claudeLogin(argv, warnings = []) {
  if (launchAgent(argv) !== "claude") return [];
  let chosen;
  try {
    chosen = chooseLogin(appHome(), { read: (p) => readFileSync(p, "utf8"), realpath: realpathSync, isDir: (p) => statSync(p).isDirectory(), home: home() });
  } catch (e) {
    chosen = { words: ["-u", "CLAUDE_CONFIG_DIR"], warning: `claude-logins.json: ${e?.code ?? "error"}; started on the default login` };
  }
  if (chosen.warning) warnings.push(chosen.warning);
  return chosen.words;
}
const modelIo = () => ({ home: home(), appHome: appHome(), read: (p) => { try { return readText(p); } catch { return null; } } });
/** The agents Herdr can start: its shipped table with the app home's programs.json applied. */
const agentTable = () => withOverrides(readText(`${appHome()}/programs.json`));

/**
 * Where `program` runs from: PATH, then two folders a PATH may lack when the sidebar runs this
 * CLI with Herdr's own (~/.local/bin, where hc and Claude Code install, and the folder of the
 * node running this, where an nvm-installed agent such as codex is). Null when none has it.
 */
function programPath(program) {
  if (program.includes("/")) { try { accessSync(program, constants.X_OK); return program; } catch { return null; } }
  const dirs = [...(process.env.PATH ?? "").split(":"), `${home()}/.local/bin`, dirname(process.execPath)];
  for (const dir of dirs) {
    if (!dir) continue;
    try { accessSync(`${dir}/${program}`, constants.X_OK); return `${dir}/${program}`; } catch { /* next */ }
  }
  return null;
}
const onPath = (program) => programPath(program) !== null;

/** This CLI's guard folder and bytes: a copy must be byte-equal to them (#643). */
const SELF_GUARD_BYTES = (() => { try { return readFileSync(join(GUARD_DIR, "..", "hcGuard.mjs")); } catch { return null; } })();
const SELF_GUARD_DIR = (() => { try { return realpathSync(GUARD_DIR); } catch { return null; } })();
/**
 * A guard folder the CLI can vouch for (#643): this copy's own guard folder, or one whose
 * hcGuard.mjs is byte-equal to this copy's. A planted hcGuard.mjs no longer hides a folder
 * from realHcPath or gets a worker PATH word accepted.
 */
function isGuardDir(dir) {
  if (typeof dir !== "string" || dir === "") return false;
  let real;
  try { real = realpathSync(dir); } catch { return false; }
  if (SELF_GUARD_DIR && real === SELF_GUARD_DIR) return true;
  let bytes;
  try { bytes = readFileSync(join(dir, "..", "hcGuard.mjs")); } catch { return false; }
  return SELF_GUARD_BYTES !== null && bytes.equals(SELF_GUARD_BYTES);
}

/**
 * The real hc for the CLI's own trusted calls (system status, machine lists, remote file/exec,
 * docs): the first PATH hc that isn't inside any guard folder. The guard is a guardrail for
 * the bot's direct calls (#624; #628 scopes send/keys/attach), not for the pack's own commands.
 * Skipping every guard folder (the pack's and am's) keeps `automagik-herdr worker` and the
 * remote commands working in a guarded pane, and never treats one guard as the real hc.
 */
function realHcPath() {
  const dirs = [...(process.env.PATH ?? "").split(":"), `${home()}/.local/bin`, dirname(process.execPath)];
  for (const dir of dirs) {
    if (!dir || isGuardDir(dir)) continue;
    const file = `${dir}/hc`;
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch { /* next */ }
  }
  return null;
}
async function hcReal(args, { timeout } = {}) {
  const r = await runProgram(realHcPath() ?? "hc", args, { timeout });
  if (r.code === 127) throw new CliError("hc (herdr-core) is not on PATH.");
  return r;
}
/** `hc <args> --json` through the real hc, parsed; a failed call throws (as hcJson does). */
async function hcRealJson(args) {
  const r = await hcReal([...args, "--json"]);
  if (r.code !== 0) throw new CliError(`hc ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return parsed(r, args);
}

/**
 * The PATH a pane this CLI starts in folder `cwd` runs with (#56, #213): this one, less what
 * belongs to the caller's folder (entries under its working folder or the pane's, a
 * node_modules/.bin, $VIRTUAL_ENV/bin: a venv or a project's tools aren't frozen into the pane),
 * with the folder of the program's interpreter first when it lacks it (an npm agent's node, a bun
 * script's bun: agentPath.mjs interpreterPath, given the file programPath found), the program's
 * own folder when only programPath found it there, and /usr/bin and /bin last when missing (sh
 * and env, which the pane's command needs). Always passed, as a worker's is: a pane started
 * without one gets herdr-core's PATH, which may have no node (a bare codex, exit 127).
 * { path, note }.
 */
function launchPath(program, cwd = null) {
  const homeDir = home().replace(/\/+$/, "");
  // A folder that is home or above it (/, /Users) isn't the caller's own: nothing is dropped for it.
  const here = [process.cwd(), cwd].filter((d) => typeof d === "string" && d).map((d) => d.replace(/\/+$/, "") || "/")
    .filter((d) => d !== "/" && !`${homeDir}/`.startsWith(`${d}/`));
  const venv = process.env.VIRTUAL_ENV ? `${process.env.VIRTUAL_ENV.replace(/\/+$/, "")}/bin` : null;
  const kept = (process.env.PATH ?? "").split(":").filter((d) => d && d !== venv && !/(^|\/)node_modules\/\.bin\/?$/.test(d)
    && !here.some((h) => d === h || d.startsWith(`${h}/`)));
  const file = program ? programPath(program) : null;
  const runPath = interpreterPath(file ?? program, kept.join(":"));
  const dirs = String(runPath.path ?? "").split(":").filter(Boolean);
  const dir = file?.includes("/") ? dirname(file) : null;
  if (dir && !dirs.includes(dir)) dirs.push(dir);
  for (const d of ["/usr/bin", "/bin"]) if (!dirs.includes(d)) dirs.push(d);
  return { path: dirs.join(":"), note: runPath.note };
}

// ---- the definitions file ----

const EMPTY = () => ({ version: 1, categories: [], bots: [] });

/**
 * A project's definitions: { key, machine: null, dir, text (null: no file), expected, raw,
 * file, warnings }. `dir` is where an edit is written (key unless given): an edit made from a
 * worktree is written in that worktree, reads stay on the key (RFC 0014 Q16, #234). With a
 * `dir` other than the key, the edit starts from dir's file, or the key's where dir has none;
 * `expected` is the text at dir (the write's snapshot), `text` the one the edit started from.
 */
export function loadProject(key, dir = key) {
  const text = readText(under(key === dir ? key : dir, BOTS_PATH));
  if (dir === key || text !== null) return projectFrom(key, null, text, dir);
  return { ...projectFrom(key, null, readText(under(key, BOTS_PATH))), dir, expected: null };
}

function projectFrom(key, machine, text, dir = key) {
  if (text === null) return { key, machine, dir, text, expected: text, raw: EMPTY(), file: EMPTY(), warnings: [] };
  let parsedFile;
  try { parsedFile = parseBots(text); } catch (e) { throw new CliError(`${fileName({ key, machine, dir })}: ${e?.message ?? e}`); }
  return { key, machine, dir, text, expected: text, raw: parsedFile.raw, file: parsedFile.file, warnings: parsedFile.warnings };
}
/** A project's file, named for people: `<dir>/.herdr/bots.json`, `… on <machine>` for a linked one's. */
const fileName = ({ key, machine, dir = key }) => `${under(dir, BOTS_PATH)}${machine ? ` on ${machine}` : ""}`;

// ---- a project on a linked machine (--machine M --project DIR; automagik#206) ----

// herdr-core there: its file ops (remoteFile.js) and one program, as `hc exec --on` runs it.
const remoteIo = {
  hc: hcReal,
  exec: async (command, args, machine, { cwd, timeout } = {}) =>
    decodeExec(await hcReal(["exec", "--json", ...(timeout ? ["--timeout", String(timeout)] : []), "--on", machine, ...(cwd ? ["--cwd", cwd] : []), "--", command, ...args], { timeout: timeout ? (timeout + 10) * 1000 : undefined }), timeout ?? 60),
};

// What hc said: its error's message when it printed one as JSON.
const hcSaid = (text) => { try { return JSON.parse(text)?.error?.message ?? text; } catch { return text; } };

/**
 * The project `--project <dir>` names on `--machine`, by namedKeyOf's rule there (its git
 * main checkout in git, else the folder itself). The folder is an absolute path on that
 * machine and must be there; a machine that can't be reached is refused, never guessed.
 */
export async function remoteKeyOf(opts) {
  const machine = opts.machine;
  if (!MACHINE_NAME.test(machine)) throw new CliError(`--machine: "${machine}" isn't a machine name (hc machine ls).`, 2);
  if (opts.project === undefined) throw new CliError(`--machine needs --project: the project's folder on ${machine}, as an absolute path.`, 2);
  if (!opts.project.startsWith("/")) throw new CliError(`--project: ${opts.project} is a folder on ${machine}, so give it as an absolute path.`, 2);
  const dir = opts.project.replace(/\/+$/, "") || "/";
  const there = await remoteIo.exec("test", ["-d", dir], machine);
  if (there.code === -1) throw new CliError(`${machine} can't be reached: ${hcSaid(there.stderr)}`);
  if (there.code !== 0) throw new CliError(`--project: ${dir} is not a folder on ${machine}.`, 2);
  return (await remoteProjectOf(machine, dir)).own;
}

/** model.js projectOf for a folder on `machine`: { key, own }, asked there through hc. */
async function remoteProjectOf(machine, dir) {
  // A call that got no answer (code -1: hc failed, a timeout) means the machine is away, never
  // "not in git" or "not there".
  const ask = async (command, args, cwd) => {
    const r = await remoteIo.exec(command, args, machine, { cwd });
    if (r.code === -1) throw new CliError(`${machine} can't be reached: ${hcSaid(r.stderr)}`);
    return r;
  };
  const gitThere = async (args, cwd) => { const r = await ask("git", args, cwd); return r.code === 0 ? r.stdout : null; };
  const existsThere = async (path) => (await ask("test", ["-e", path])).code === 0;
  return projectOf(dir, gitThere, existsThere);
}

let machinesOnce = null;
/** The linked machines by core id (attach.js machinesById), asked once per run; hc failing: none. */
const machinesNow = () => (machinesOnce ??= hcReal(["machine", "ls", "--json"]).then((r) => (r.code === 0 ? machinesById(r.stdout) : new Map()), () => new Map()));
/** A linked machine by name: { id, name, connected }, or null. */
async function machineNamed(name) {
  for (const [id, m] of await machinesNow()) if (m.name === name) return { id, ...m };
  return null;
}
/** The machine `name`, refused unless linked and connected now. */
async function connectedMachine(name, what = "nothing was changed") {
  const m = await machineNamed(name);
  if (!m) throw new CliError(`${name} isn't a linked machine (hc machine ls); ${what}.`);
  if (!m.connected) throw new CliError(`${name} isn't connected; ${what}.`);
  return m;
}

/** loadProject for a project on a linked machine, read there through herdr-core. */
export async function loadRemoteProject(key, machine) {
  let text;
  try { text = await readRemoteText(remoteIo, machine, under(key, BOTS_PATH)); } catch (e) {
    if (e instanceof RemoteFileError) throw new CliError(e.message);
    throw e;
  }
  return projectFrom(key, machine, text);
}

/**
 * writeBotsFile's rule on a linked machine: the whole raw file must pass checkBots, and the
 * file there must still hold the text read (null: none), else nothing is written
 * (remoteFile.js: hc file edit for an edit, an exclusive create for a new file, a checked
 * remove for `raw === null`).
 */
async function writeRemoteBots(project, raw) {
  const { key, machine, text: expected } = project;
  const path = under(key, BOTS_PATH);
  if (raw !== null) checkBotsForSave(raw, expected);
  try {
    if (raw === null) await removeRemoteText(remoteIo, machine, path, expected);
    else await writeRemoteText(remoteIo, machine, path, botsText(raw, expected), expected);
  } catch (e) {
    if (e instanceof StaleSnapshot) throw new CliError(`Not saved: ${fileName(project)} changed since it was read (another edit landed first). Run the command again.`);
    // A write whose answer was lost and that the file doesn't show: said as it is.
    if (e instanceof RemoteFileError && e.kind === "unknown_state") throw new CliError(e.message);
    if (e instanceof RemoteFileError) throw new CliError(`Not saved: ${e.message}`);
    throw e;
  }
}

/**
 * Saves a project's raw file where it is (raw null: deletes it) and, on this computer, lists
 * the project for the sidebar (`list`). The CLI's project list holds this computer's projects
 * only: a linked machine's shows in the sidebar from its open space, or once the sidebar
 * itself has written it.
 */
async function saveProject(project, raw, { list = true } = {}) {
  if (project.machine) return writeRemoteBots(project, raw);
  writeBotsFile(project.dir, raw, project.expected, fsIo, project.text);
  if (list) listProject(project.key);
  if (project.dir !== project.key) report([worktreeNote(project, await changesIn(project.key, project.dir))]);
}
/**
 * Said after an edit written in a worktree: where it went, what the readers show meanwhile, and,
 * when the main checkout's file was never committed or has local changes, that its pull would
 * stop on it (git won't overwrite an untracked file, nor local changes, with the merged one);
 * when it is deleted in the working tree, that a merge pull restores it with the worktree's
 * version and a rebase pull refuses until it is committed or discarded, unless
 * rebase.autoStash=true stashes the deletion and the stash apply then conflicts (UD); when the
 * deletion is staged, that committing it turns the pull into a modify/delete conflict; when the
 * deletion is committed after the worktree branched, that the pull ends in that conflict too.
 * The wording matches the form's (create.js worktreeNote): only the file each shows may differ.
 */
const worktreeNote = ({ key, dir }, changes = null) => `saved in ${under(dir, BOTS_PATH)} (this worktree); ls, `
  + `whois and the sidebar read ${under(key, BOTS_PATH)} until that change is merged there.`
  + (changes === "untracked" ? ` ${under(key, BOTS_PATH)} isn't committed: commit or remove it before pulling, or the pull stops on it.` : "")
  + (changes === "modified" ? ` ${under(key, BOTS_PATH)} has local changes: commit or discard them before pulling, or the pull stops on it.` : "")
  + (changes === "deleted" ? ` ${under(key, BOTS_PATH)} is deleted: a merge pull brings it back with this worktree's version (a committed deletion would be a modify/delete conflict instead); pull.rebase=true refuses the pull until the deletion is committed or discarded.` : "")
  + (changes === "deleted-autostash" ? ` ${under(key, BOTS_PATH)} is deleted: a merge pull brings it back with this worktree's version (a committed deletion would be a modify/delete conflict instead); pull.rebase=true with rebase.autoStash=true stashes the deletion and lets the pull through, then the stash apply conflicts (UD).` : "")
  + (changes === "staged-deletion" ? ` ${under(key, BOTS_PATH)} has a staged deletion: restore and commit the file, or unstage the deletion, before pulling; committing the deletion ends the pull in a modify/delete conflict.` : "")
  + (changes === "committed-deletion" ? ` ${under(key, BOTS_PATH)} has a committed deletion: a pull that brings this worktree's version ends in a modify/delete conflict; restore and commit the file before pulling, or resolve the conflict after.` : "");
/**
 * What git says about `key`'s .herdr/bots.json: "untracked" when git doesn't know the file,
 * "modified" when it is committed but has local changes, "deleted" when it is committed and
 * deleted in the working tree without that deletion being staged, "deleted-autostash" when that
 * deletion would be stashed for a rebase pull instead (rebase.autoStash=true), "staged-deletion"
 * when the deletion is staged, "committed-deletion" when HEAD has no file, `dir` (the worktree an
 * edit came from) does, and the merge base of HEAD and that worktree had it; null when it is
 * clean or git can't say. A pull that brings a worktree's committed file stops on the first two
 * (#234, #332); an unstaged deletion is restored by a merge pull and refused by a rebase pull
 * instead (#626); a deletion committed after the worktree branched ends in modify/delete too,
 * one before it only adds.
 */
async function changesIn(key, dir = null) {
  // porcelain=v2 keeps the state an explicit field: v1's unstaged " D" loses its leading
  // space to a trimmed stdout, while a v2 record's "1" is its first character (#626).
  const out = (await git(["status", "--porcelain=v2", "--", BOTS_PATH], key)) ?? "";
  if (!out.trim()) return await committedDeletion(key, dir);
  const line = out.split("\n").find((l) => l);
  if (line.startsWith("? ")) return "untracked";
  if (line.startsWith("1 ")) {
    const state = line.split(" ")[1];
    // A staged deletion is not "modified": committing it turns the pull into modify/delete (#665).
    if (state === "D.") return "staged-deletion";
    if (state === ".D") return (await autoStashOn(key)) ? "deleted-autostash" : "deleted";
  }
  return "modified";
}
/** Whether `key` stashes an unstaged deletion for a rebase pull instead of refusing it (#665). */
async function autoStashOn(key) {
  return (await git(["config", "--bool", "--get", "rebase.autoStash"], key))?.trim() === "true";
}
/**
 * #626: a committed deletion leaves `git status` empty, yet a pull that brings the worktree's
 * version of a file the merge base has, and HEAD has deleted, ends in a modify/delete conflict.
 * The merge base, not the path's history, is the test: a deletion committed before the worktree
 * branched leaves no file at the base, and the pull only adds the worktree's file.
 */
async function committedDeletion(key, dir) {
  if (!dir || dir === key) return null;
  if ((await git(["show", `HEAD:${BOTS_PATH}`], key)) !== null) return null;
  if (readText(under(dir, BOTS_PATH)) === null) return null;
  const worktreeHead = (await git(["rev-parse", "HEAD"], dir))?.trim();
  if (!worktreeHead) return null;
  const base = (await git(["merge-base", "HEAD", worktreeHead], key))?.trim();
  if (!base) return null;
  return (await git(["cat-file", "-e", `${base}:${BOTS_PATH}`], key)) !== null ? "committed-deletion" : null;
}

const fsIo = {
  read: readText,
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  create: (path, text) => writeFileSync(path, text, { flag: "wx" }),
  replace: (path, text, mode) => {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* gone already */ } throw e; }
  },
  remove: (path) => unlinkSync(path),
};

/** Shared save validation: hard errors refuse; read warnings remain visible on stderr. */
function checkBotsForSave(raw, before) {
  const errors = checkBots(raw, before);
  if (errors.length) throw new CliError(`Not saved: ${errors.join("; ")}`);
  report(parseBots(JSON.stringify(raw)).warnings.map((w) => `Warning: ${w}`));
}

/**
 * Writes a project's definitions by bots.js writeBots' rule: the whole raw file must pass
 * checkBots, and the file must still hold `expected`, the text the edit started from (null:
 * no file yet), else nothing is written. A new file gets its `.herdr/` folder first and is
 * created exclusively; an existing one is replaced whole (written beside, then renamed).
 * `raw === null` deletes the file (the project's last bot removed). `before`, for checkBots, is
 * the text the edit started from when that isn't the file written (a worktree's first edit).
 */
export function writeBotsFile(key, raw, expected, io = fsIo, before = expected) {
  if (expected === undefined) throw new Error("writeBotsFile: pass the text the edit started from (null for a new file)");
  const path = under(key, BOTS_PATH);
  if (raw !== null) checkBotsForSave(raw, before);
  let now;
  try { now = io.read(path); } catch (e) { throw new CliError(`Not saved: can't read ${path} again: ${e?.message ?? e}`); }
  if (now !== expected) throw new CliError(`Not saved: ${path} changed since it was read (another edit landed first). Run the command again.`);
  try {
    if (raw === null) return io.remove(path);
    const text = botsText(raw, expected ?? before); // indented as the file is (#230)
    if (expected === null) { io.mkdir(under(key, ".herdr")); io.create(path, text); } else io.replace(path, text);
  } catch (e) {
    if (e?.code === "EEXIST") throw new CliError(`Not saved: ${path} appeared since it was read. Run the command again.`);
    throw new CliError(`Not saved: ${e?.message ?? e}`);
  }
}

// A lock beside the project list: made exclusively (wx) holding its holder's pid and a token,
// so one CLI at a time edits the list, and a holder removes only its own lock. Waited for up
// to LOCK_WAIT ms; one older than LOCK_STALE ms (a CLI killed mid-write) is taken over.
// Without it, two CLIs that read the list at once each write their own copy.
const LOCK_WAIT = 3000;
/**
 * LOCK_STALE from AUTOMAGIK_HERDR_LOCK_STALE_MS (`raw`), for the tests only: 10 s when unset
 * or not a number, else clamped to 100 ms..60 s. Far below, this CLI would take a lock bots-dsh
 * holds (the same protocol on disk, its own 10 s); far above, the refresh timer breaks.
 */
export function staleLimit(raw) {
  const ms = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(ms) ? Math.min(60_000, Math.max(100, ms)) : 10_000;
}
const LOCK_STALE = staleLimit(process.env.AUTOMAGIK_HERDR_LOCK_STALE_MS);
// A wait longer than this says so on stderr, once, naming the lock and its holder.
const LOCK_NOTE_AFTER = 3000;
// An async holder (withLockAsync) touches its lock this often, so a hold across slow hc calls
// (15 s each) never reads as stale; a holder that dies stops touching it (#225, #223).
const LOCK_REFRESH = Math.max(10, Math.floor(LOCK_STALE / 3));
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const stale = (path) => { try { return Date.now() - statSync(path).mtimeMs > LOCK_STALE; } catch { return false; } };

// A stale lock is moved aside first, so of two waiters only one takes it. Aside, it is checked
// again: a lock made fresh in between goes back (by link, which never replaces a newer one).
function takeOverStale(lock) {
  if (!stale(lock)) return;
  const aside = `${lock}.${process.pid}`;
  try { renameSync(lock, aside); } catch { return; } // another waiter moved it first
  if (!stale(aside)) { try { linkSync(aside, lock); } catch { /* a newer lock is there */ } }
  try { unlinkSync(aside); } catch { /* gone already */ }
}

/**
 * Who holds `lock`, from its token's pid: "pid N", "pid N, no longer running" (taken once
 * stale), or null when the file is gone or names no pid.
 */
function lockHolder(lock) {
  let pid;
  try { pid = Number(readFileSync(lock, "utf8").split(" ")[0]); } catch { return null; }
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); } catch (e) { if (e?.code === "ESRCH") return `pid ${pid}, no longer running`; }
  return `pid ${pid}`;
}

/**
 * One try at `lock` for a waiter (`w`: its token, start, wait, what, noted): true once taken.
 * A wait past LOCK_NOTE_AFTER is said once on stderr, naming `what` (else the lock) and its
 * holder: written with writeSync, so a sync waiter's Atomics.wait never holds the line back.
 * Past the wait it throws, naming `what` beside the lock.
 */
function tryLock(lock, w) {
  try { writeFileSync(lock, w.token, { flag: "wx" }); return true; } catch (e) {
    if (e?.code !== "EEXIST") throw e;
  }
  takeOverStale(lock);
  if (Date.now() > w.start + w.wait) {
    const who = lockHolder(lock);
    throw new Error(`${w.what ? `${w.what} (${lock})` : lock} is held by another automagik-herdr${who ? ` (${who})` : ""}`
      + `${w.noted && w.wait > LOCK_NOTE_AFTER ? ` after ${Math.round(w.wait / 1000)} s` : ""}`);
  }
  if (!w.noted && Date.now() - w.start >= LOCK_NOTE_AFTER) {
    w.noted = true;
    const who = lockHolder(lock) ?? "another automagik-herdr";
    const line = `automagik-herdr: waiting for ${w.what ?? lock} (${lock}), held by ${who}; up to ${Math.round(w.wait / 1000)} s in all.\n`;
    try { writeSync(2, line); } catch { /* stderr closed */ }
  }
  return false;
}
const waiter = (wait, what) => ({ token: `${process.pid} ${randomUUID()}`, start: Date.now(), wait, what, noted: wait <= LOCK_NOTE_AFTER });
const retryIn = () => 5 + Math.floor(Math.random() * 20);
/** Takes `lock`, waiting up to `wait` ms with Atomics.wait: for sync holders only (withLock). */
function takeLock(lock, wait = LOCK_WAIT, what = null) {
  const w = waiter(wait, what);
  while (!tryLock(lock, w)) pause(retryIn());
  return w.token;
}
/**
 * takeLock with timers in place of Atomics.wait, so the event loop runs while it waits: a lock
 * this CLI already holds (a task's name lock while it waits for its worktree's, #552) keeps
 * being refreshed and never goes stale under a long wait.
 */
async function takeLockAsync(lock, wait = LOCK_WAIT, what = null) {
  const w = waiter(wait, what);
  while (!tryLock(lock, w)) await new Promise((resolve) => setTimeout(resolve, retryIn()));
  return w.token;
}
function dropLock(lock, token) {
  try { if (readFileSync(lock, "utf8") === token) unlinkSync(lock); } catch { /* gone already */ }
}
function withLock(lock, fn) {
  const token = takeLock(lock);
  try { return fn(); } finally { dropLock(lock, token); }
}
/**
 * Keeps a held lock fresh: its mtime is set to now every LOCK_REFRESH ms while it still holds
 * this holder's token (a lock taken over is never touched). Returns the stop. The timer is
 * unref'd: it never keeps the CLI running.
 */
function keepFresh(lock, token) {
  const timer = setInterval(() => {
    try { if (readFileSync(lock, "utf8") === token) { const now = new Date(); utimesSync(lock, now, now); } } catch { /* gone */ }
  }, LOCK_REFRESH);
  timer.unref();
  return () => clearInterval(timer);
}
/**
 * withLock for an async `fn`, the lock kept fresh while fn awaits (keepFresh); waits up to
 * `wait` ms for it without holding the event loop (takeLockAsync), a long wait named as
 * `what` on stderr.
 */
async function withLockAsync(lock, fn, { wait = LOCK_WAIT, what = null } = {}) {
  const token = await takeLockAsync(lock, wait, what);
  const stop = keepFresh(lock, token);
  try { return await fn(); } finally { stop(); dropLock(lock, token); }
}

/**
 * Adds a project to the list the sidebar reads beside its own remembered projects
 * (model.js PROJECTS_FILE, in the app home outside mods/, so the write reloads nothing), so a
 * project managed from here shows in the sidebar with no space open on it. Under a lock:
 * read, add, write beside, rename, read again; tried three times until the key is there.
 * No app home (Herdr isn't set up here): nothing is written. A failure only warns: the
 * command's own work is done.
 */
export function listProject(key, dir = appHome()) {
  const path = `${dir}/${PROJECTS_FILE}`;
  const read = () => { try { return readFileSync(path, "utf8"); } catch (e) { if (e?.code === "ENOENT") return null; throw e; } };
  let why = "it was still missing after three writes";
  if (!existsSync(dir)) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      withLock(`${path}.lock`, () => {
        const text = read();
        const next = withListedProject(text, key);
        if (next !== text) fsIo.replace(path, next);
      });
      if (listedProjects(read()).includes(key)) return true;
    } catch (e) { why = e?.message ?? String(e); }
  }
  process.stderr.write(`automagik-herdr: couldn't list ${key} in ${path}, so the sidebar shows it only once a space is open on it: ${why}\n`);
  return false;
}

/**
 * Takes keys off the CLI's project list (tidy's registry prune, forget), under listProject's
 * lock. Resolves with the keys it found there and took off (none: the file is unchanged).
 */
export function unlistProjects(keys, dir = appHome()) {
  const path = `${dir}/${PROJECTS_FILE}`;
  return withLock(`${path}.lock`, () => {
    let text;
    try { text = readFileSync(path, "utf8"); } catch (e) { if (e?.code === "ENOENT") return []; throw e; }
    const listed = listedProjects(text);
    const taken = listed.filter((k) => keys.includes(k));
    if (!taken.length) return [];
    const next = `${JSON.stringify(listed.filter((k) => !keys.includes(k)), null, 2)}\n`;
    if (next !== text) fsIo.replace(path, next);
    return taken;
  });
}

/** A bot by id, else by its name (exact, then ignoring case), unique in the project. */
export function findBot(file, ref) {
  if (!ref) throw new CliError("Name a bot (its id or its name).", 2);
  const byId = file.bots.find((b) => b.id === ref);
  if (byId) return byId;
  for (const same of [(b) => b.name === ref, (b) => b.name.toLowerCase() === String(ref).toLowerCase()]) {
    const hits = file.bots.filter(same);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new CliError(`${hits.length} bots are named "${ref}" (${hits.map((b) => b.id).join(", ")}); use the id.`);
  }
  throw new CliError(`No bot "${ref}" in this project.`);
}

/**
 * findBot in a project's file, for a command run from `opts`' folder. When the bot isn't
 * there but is in the other file of a worktree edit (RFC 0014 Q16: edits are written in the
 * worktree, reads stay on the main checkout), the refusal names both files and why.
 */
async function botIn(project, ref, opts) {
  try { return findBot(project.file, ref); } catch (e) {
    if (!(e instanceof CliError) || !e.message.startsWith("No bot ") || project.machine) throw e;
    const editing = project.dir !== project.key;
    const dir = editing ? project.dir : await writeDirOf(opts, project.key).catch(() => project.key);
    if (dir === project.key) throw e;
    let other = null;
    try { other = editing ? loadProject(project.key) : projectFrom(project.key, null, readText(under(dir, BOTS_PATH)), dir); } catch { throw e; }
    let found = null;
    try { found = other.text === null ? null : findBot(other.file, ref); } catch { /* not there either */ }
    if (!found) throw e;
    const main = under(project.key, BOTS_PATH), wt = under(dir, BOTS_PATH);
    throw new CliError(editing
      ? `No bot "${ref}" in ${wt}, this worktree's file, which edits change; ${main} has it. Update this worktree from `
        + `the main checkout's branch first, or run the edit in ${project.key}.`
      : `No bot "${ref}" in ${main}, which this command reads; it is in ${wt} (this worktree) and shows here once that `
        + `change is merged into ${project.key}.`);
  }
}

function findCategory(file, ref) {
  const hit = file.categories.find((c) => c.id === ref) ?? file.categories.find((c) => c.title.toLowerCase() === String(ref).toLowerCase());
  if (!hit) throw new CliError(`No category "${ref}" in this project; add it first: automagik-herdr category add --title "${ref}".`);
  return hit;
}

// ---- the attach ledger (attach.js): which terminal plays which bot ----

/** The attach ledger can't be trusted or read: never mistaken for "hc unavailable". */
export class LedgerRefusal extends CliError {}

/**
 * `hc get <t> --json`; null only when hc answers not_found (exit 3), any other failure throws
 * (no answer within `timeout` ms, hc's 15 s when not given, included).
 */
async function hcLookup(terminal, { timeout } = {}) {
  const r = await hc(["get", terminal, "--json"], { timeout });
  if (r.code === 0) return parsed(r, ["get", terminal]);
  if (r.killed) throw new CliError(`hc get ${terminal} gave no answer in ${(timeout ?? 15_000) / 1000} s`);
  let kind = null;
  try { kind = JSON.parse(r.stderr || r.stdout)?.error?.kind ?? null; } catch { kind = null; }
  if (r.code === 3 || kind === "not_found") return null;
  throw new CliError(`hc get ${terminal} failed: ${(r.stderr || r.stdout).trim()}`);
}

// The single transport reply supplies both verified terminal and startup-verified core id.
// This caches transport identity only; worker allowance is re-read by the proxy at each spawn.
let workerTransportOnce = null;
const workerTransport = () => (workerTransportOnce ??=
  workerProxyTransport(process.env.HC_SOCKET, process.env.HC_TERMINAL_ID));
let coreOnce = null;
/**
 * This computer's hc core id: `hc server status`'s core.id, "permanent random id, reset only
 * when state is wiped" (hc schema CoreInfo). Asked once per run; a failure throws.
 */
function coreId() {
  coreOnce ??= workerTransport().then(async (transport) => {
    const status = transport || await hcRealJson(["server", "status"]);
    const id = status?.core?.id;
    if (typeof id !== "string" || !id) throw new CliError("hc server status gave no core id.");
    return id;
  });
  return coreOnce;
}

/** The ledger's rows, or null when there is no file. A group- or world-writable file is refused. */
export function readAttachFile(path = attachPath(appHome())) {
  let st;
  try { st = statSync(path); } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw new LedgerRefusal(`Can't read ${path}: ${e?.message ?? e}`);
  }
  const why = modeProblem(path, st.mode);
  if (why) throw new LedgerRefusal(why);
  let text;
  try { text = readFileSync(path, "utf8"); } catch (e) { throw new LedgerRefusal(`Can't read ${path}: ${e?.message ?? e}`); }
  return readAttach(text).rows;
}

/** Appends rows, one O_APPEND write each, the file made 0600 when new (`flag` "ax": only when absent). */
function appendAttach(path, rows, flag = "a") {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, flag, 0o600);
  try { for (const row of rows) writeSync(fd, attachLine(row)); } finally { closeSync(fd); }
}

/** The ledger's lock, beside it (its folder made first). */
const ledgerLock = (path) => { mkdirSync(dirname(path), { recursive: true }); return `${path}.lock`; };
const asCliError = (e) => (e instanceof CliError ? e : new CliError(e?.message ?? String(e)));

/**
 * Which project defines `botId`: the one `folder` keys to, else one this run named, the
 * current folder's, or a remembered one; null when none does.
 */
async function projectDefining(botId, folder) {
  const keys = [];
  for (const f of [folder, process.cwd()]) {
    if (typeof f === "string") { try { keys.push(await keyOf(f)); } catch { /* a folder gone */ } }
  }
  for (const k of [...namedKeys, ...rememberedKeys()]) if (!keys.includes(k)) keys.push(k);
  for (const k of keys) {
    try { if (loadProject(k).file.bots.some((b) => b.id === botId)) return k; } catch { /* unreadable: not this one */ }
  }
  return null;
}

/**
 * The one-time import (Ruling: labels seed the ledger once): with no ledger file yet, every
 * live terminal on this computer carrying `bot=<id>` becomes an attach row (by "import"),
 * one per bot by the old live rule (an agent in front, then the newest), its project the one
 * that defines the bot. The file is created, even empty, so it happens once.
 */
async function importLabels(path) {
  const found = await labelRows();
  try {
    await withLockAsync(ledgerLock(path), async () => {
      if (existsSync(path)) return; // another CLI imported first
      appendAttach(path, found, "ax");
    });
  } catch (e) { throw asCliError(e); }
}

/** The one-time import's rows (importLabels), worked out and not written. */
async function labelRows() {
  const core = await coreId();
  const rows = rowsOf(await hcJson(["ls"])).filter((r) => local(r?.address) && r.state !== "finished");
  // One terminal hc fails to answer for is left out, never the whole import.
  const gets = (await Promise.all(rows.map((r) => hcLookup(r.address).catch(() => null))))
    .filter((g) => g?.state === "live" && local(g.address) && typeof g.labels?.[BOT_LABEL] === "string" && Number.isSafeInteger(g.created_ms));
  const byBot = new Map();
  for (const g of gets) byBot.set(g.labels[BOT_LABEL], [...(byBot.get(g.labels[BOT_LABEL]) ?? []), g]);
  const found = [];
  for (const [bot, all] of byBot) {
    const agents = all.filter(agentInForeground);
    const pick = newest(agents.length ? agents : all);
    // A label naming no bot defined here (a stale or hand-set one) is left out.
    const project = await projectDefining(bot, pick.foreground?.cwd ?? pick.cwd);
    if (project) found.push(attachRow({ event: "attach", bot, project, terminal: pick.address, core, created_ms: pick.created_ms, by: "import" }));
  }
  return found;
}

/** End rows (by "sweep") for bindings hc no longer confirms, under the lock; a failure only warns. */
async function sweep(path, ended) {
  try {
    await withLockAsync(ledgerLock(path), async () => {
      const { byKey } = foldAttach(readAttachFile(path) ?? []);
      const rows = ended.filter(({ binding }) => byKey.get(attachKey(binding))?.bot === binding.bot)
        .map(({ binding, reason }) => closingRow(binding, "end", "sweep", reason));
      if (rows.length) appendAttach(path, rows);
    });
  } catch (e) {
    if (e instanceof LedgerRefusal) throw e;
    report([`couldn't write end rows to ${path}: ${e?.message ?? e}`]);
  }
}

/**
 * The ledger's rows, the one-time import done first when there is no file. With no app home
 * (Herdr not set up here) nothing is imported or made: no rows, until a start or attach.
 * readOnly (the import's dry run, #486): the one-time import's rows as it would write them,
 * and no file made.
 */
async function ledgerRows(path, readOnly = false) {
  const rows = readAttachFile(path);
  if (rows !== null) return rows;
  if (!existsSync(appHome())) return [];
  if (readOnly) return labelRows();
  await importLabels(path);
  return readAttachFile(path) ?? [];
}

let viewOnce = null;
/**
 * The ledger as hc confirms it now: { core, path, live: Map bot -> { binding, get },
 * byTerminal: Map address -> { binding, get } }. Every binding is checked with `hc get`;
 * one hc no longer confirms (finished, gone, or its id reused) is left out, and its end row
 * written. Once per run: commands that write the ledger decide again under its lock.
 * readOnly (the import's dry run, #486, the run's first caller): the same view, with no
 * one-time import written and no end row; the run's later calls get that view too.
 */
export function attachView({ readOnly = false } = {}) {
  viewOnce ??= (async () => {
    const path = attachPath(appHome());
    const rows = await ledgerRows(path, readOnly);
    const core = await coreId();
    const machines = await machinesNow();
    const { byKey } = foldAttach(rows);
    const { live, ended, unknown } = await confirmBindings([...byKey.values()], core, lookup, UNANSWERED, machines);
    if (ended.length && !readOnly) await sweep(path, ended);
    // live: this computer's bindings by bot. liveAt / unknownAt: every binding by place and bot
    // (atKey; a linked machine's place is its core id, and a project's checkouts on two
    // machines share their bots' ids). byTerminal: by hc address ("lab/t8" for a machine's).
    // unknown: a machine's rows whose machine isn't connected (neither live nor ended).
    return { core, path, machines, live: new Map(live.filter((l) => placeOfRow(l.binding) === null).map((l) => [l.binding.bot, l])),
      liveAt: new Map(live.map((l) => [atKey(l.binding.bot, placeOfRow(l.binding)), l])),
      unknownAt: new Map(unknown.map((b) => [atKey(b.bot, placeOfRow(b)), b])),
      byTerminal: new Map(live.map((l) => [addressOf(l.binding, machines), l])) };
  })();
  return viewOnce;
}

/** The view's key for a bot in a place (attach.js placeOf: null, or a machine's core id). */
const atKey = (bot, place) => `${place ?? ""}\n${bot}`;
/** The core id hc gives the machine named `name` now (`machines`, machinesById), or null. */
const coreOfName = (machines, name) => { for (const [id, m] of machines ?? []) if (m.name === name) return id; return null; };
/**
 * A bot's live binding for a project, as the view has it: on this computer, or on the linked
 * machine `project.machine` (its core) and in that project there, never a same-id bot elsewhere.
 * On this computer too (automagik#227, RFC 0014 Q16: a clone carries the same ids): a binding
 * counts for its own project; one with no project (an older row) counts by id alone.
 */
function liveFor(view, botId, project) {
  if (!project?.machine) {
    const l = view.live.get(botId);
    return l && (l.binding.project == null || l.binding.project === project?.key) ? l : null;
  }
  const l = view.liveAt.get(atKey(botId, coreOfName(view.machines, project.machine)));
  return l && l.binding.project === project.key ? l : null;
}
function unknownFor(view, botId, project) {
  if (!project?.machine) return null;
  const b = view.unknownAt.get(atKey(botId, coreOfName(view.machines, project.machine)));
  return b && b.project === project.key ? b : null;
}

// hc get for confirmBindings: a linked machine that stops answering mid-run leaves its row
// unknown (UNANSWERED), never failing the whole view.
const lookup = (args) => (args[1].includes("/") ? hcLookup(args[1]).catch(() => UNANSWERED) : hcLookup(args[1]));

/**
 * Runs `fn` under the ledger's lock with the fold read again: fn({ core, byBot, byKey, holds,
 * write }). `holds(binding)` confirms a binding with hc ({ binding, get } or null; an ended
 * one gets its end row), `write(rows)` appends. Two CLIs never both attach one bot.
 */
async function underLedger(fn) {
  const path = attachPath(appHome());
  await ledgerRows(path);
  const core = await coreId();
  const machines = await machinesNow();
  try {
    return await withLockAsync(ledgerLock(path), async () => {
      const fold = foldAttach(readAttachFile(path) ?? []);
      const { byBot, byKey } = fold;
      // A bot's binding in a place (null: this computer; a linked machine's core id).
      const heldBy = (bot, place) => heldIn(fold, bot, place);
      const ends = [];
      const holds = async (binding) => {
        if (!binding) return null;
        const { live, ended, unknown } = await confirmBindings([binding], core, lookup, UNANSWERED, machines);
        if (live.length) return live[0];
        if (unknown.length) return { binding, get: null };
        ends.push(closingRow(binding, "end", "sweep", ended[0].reason));
        return null;
      };
      const write = (rows) => appendAttach(path, [...ends.splice(0), ...rows]);
      try { return await fn({ core, machines, byBot, byKey, heldBy, holds, write }); } finally { if (ends.length) appendAttach(path, ends.splice(0)); }
    });
  } catch (e) { throw asCliError(e); }
}

/** A binding as whois prints it. */
const whoisOf = ({ binding }) => ({ terminal: binding.terminal, core: binding.core, created_ms: binding.created_ms, bot: binding.bot,
  project: binding.project, since: binding.at });

/** The `hc get` of a bot's attached terminal on this computer, or null. */
async function attachedGet(botId) {
  const held = (await attachView()).live.get(botId);
  return held?.get && local(held.get.address ?? held.binding.terminal) ? { ...held.get, address: held.get.address ?? held.binding.terminal } : null;
}

/** One bot as ls and show print it. With hc failing, the bot is still shown, its pane unknown. */
function describe(project, bot, view, hcError) {
  const { file } = project;
  const held = !bot.planned && view ? liveFor(view, bot.id, project) : null;
  const live = held?.get ?? null;
  const lead = bot.kind === "member" ? effectiveLead(file, bot.id) : { lead: "" };
  const fallback = bot.agent ? defaultModel(bot.agent, modelIo()) : null;
  const shown = shownModel({ argv: live?.foreground?.argv, agentKey: bot.agent, pinned: bot.model, fallback });
  // The workers' Antigravity mode is shown as the default (auto) when their agent is Antigravity.
  const worker = bot.worker && typeof bot.worker === "object" ? { ...bot.worker } : null;
  if (worker && resolveAgent(worker.agent ?? bot.agent) === "antigravity") worker.agyMode = agyModeOf(worker.agyMode);
  let status = "not running";
  if (bot.planned) status = "planned";
  else if (hcError) status = "hc unavailable";
  else if (!held && view && unknownFor(view, bot.id, project)) status = "unknown"; // its machine isn't answering
  else if (held) status = agentInForeground(live) ? live.status?.state ?? "running" : "no agent in front";
  // #823: the effective permission lists the launch carries: a seat's on the project folder,
  // and a worker default's (its task worktree is added at its launch).
  const seatAgy = bot.agent === "antigravity" ? agyPermissionPlan({ bot, scope: "seat", folder: project.key }) : null;
  const workerAgent = !worker ? resolveAgent(bot.agent) : worker.template ? null : resolveAgent(worker.agent ?? bot.agent);
  const workerAgy = workerAgent === "antigravity"
    ? agyPermissionPlan({ bot, scope: "worker", role: workerRole(bot).role, folder: null }) : null;
  const out = {
    id: bot.id, name: bot.name, kind: bot.kind, ...placeOf(project),
    lead: lead.lead || null, leadName: file.bots.find((b) => b.id === lead.lead)?.name ?? null,
    category: bot.kind === "member" && lead.lead === mainBotOf(file)?.id ? (bot.category ?? null) : null,
    planned: bot.planned ?? null, agent: bot.agent ?? null,
    model: shown.model, modelSource: shown.source, pinnedModel: bot.model ?? null,
    agyMode: bot.agent === "antigravity" ? agyModeOf(bot.agyMode) : (typeof bot.agyMode === "string" && bot.agyMode ? bot.agyMode : null),
    terminal: held?.binding.terminal ?? null, status, duplicate: false, since: held?.binding.at ?? null,
    role: bot.role, rank: bot.rank ?? null, code: bot.code !== false, look: bot.look,
    hcProxy: bot.hcProxy === true,
    worker,
    ...(seatAgy ? { agyPermissions: { allow: seatAgy.allow, deny: seatAgy.deny, trustedWorkspaces: seatAgy.trustedWorkspaces } } : {}),
    ...(workerAgy ? { workerAgyPermissions: { allow: workerAgy.allow, deny: workerAgy.deny, trustedWorkspaces: ["<worktree>"] } } : {}),
  };
  if (lead.warning) out.warning = lead.warning;
  if (hcError && !bot.planned) out.hcError = hcError;
  return out;
}

/** The view for ls and show: { view, hcError }; a refused ledger still throws. */
async function viewOrError() {
  try { return { view: await attachView(), hcError: null }; } catch (e) {
    if (e instanceof LedgerRefusal || !(e instanceof CliError)) throw e;
    return { view: null, hcError: e.message };
  }
}

// ---- the briefing hook (briefingText.mjs installHook, as launch.js afterBind uses it) ----

const hookIo = {
  git: (args, cwd) => runProgram("git", args, { cwd }),
  read: async (path) => readText(path),
  write: async (path, text, before, { mode } = {}) => {
    if (readText(path) !== before) throw new Error(`${path} changed while being edited`);
    fsIo.replace(path, text, mode);
  },
  mkdir: async (dir) => { mkdirSync(dir, { recursive: true }); },
};

/**
 * Merges the briefing hook for a Claude bot (the session ledger, the once-only fallback); never throws: { written, warnings }.
 * With no pack under the app home, it names the am part's own entry and runner instead (CLI-only host).
 */
export function writeBriefingHook(bot, folder, appHomeDir = appHome(), options = {}) {
  return installHook(bot.name, folder, appHomeDir, hookIo, { amStore: amStore(), ...options });
}

// ---- the briefing at launch (models.js briefingLaunch): the agent's system prompt ----

// The config file an agent's own prompt lives in (models.js ownPromptIn), or null.
const ownConfigOf = (agentKey) => (agentKey === "codex" ? configPaths(home()).codexConfig
  : agentKey === "hermes" ? (process.env.HERMES_HOME ? `${process.env.HERMES_HOME.replace(/\/+$/, "")}/config.yaml` : configPaths(home()).hermesConfig)
    : null);

/**
 * `argv` (what starts `bot`'s agent `agentKey`) with the bot's launch briefing put in as that
 * agent takes it (a file under the app home for Claude Code, written now, before the agent
 * reads it; text or an environment variable for the others), any older one taken out. An agent
 * with no way, or a command that doesn't run it, starts as it is. Never throws: a file that
 * can't be written, or a codex config that sets its own developer_instructions, means no
 * briefing at launch and a warning. Returns { argv, env, warnings }.
 */
export async function briefedLaunch(project, bot, agentKey, argv, appHomeDir = appHome()) {
  const warnings = [];
  const way = briefingWay(agentKey);
  const agents = agentTable();
  if (!way || agentKeyOfArgv(argv, agents) !== agentKey) return { argv, env: {}, warnings };
  const text = launchBriefingText({ self: bot, file: project.file, isGit: await projectIsGit(project) });
  let launch = null;
  if (way === "file") {
    const path = briefingFilePath(appHomeDir, project.key, bot.id);
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${text}\n`, { mode: 0o600 });
      renameSync(tmp, path);
      launch = briefingLaunch(agentKey, { path });
    } catch (e) {
      warnings.push(`${bot.name} starts without its briefing in its system prompt (${path}: ${e?.message ?? e}); its hook gives it once instead.`);
    }
  } else if (ownPromptIn(agentKey, modelIo().read(ownConfigOf(agentKey)))) {
    warnings.push(`${bot.name} starts without its briefing: ${agentKey === "codex"
      ? "codex's config.toml sets developer_instructions, which a -c would replace"
      : "hermes' config.yaml sets a personality or agent.system_prompt, which HERMES_EPHEMERAL_SYSTEM_PROMPT would replace"}.`);
  } else {
    launch = briefingLaunch(agentKey, { text });
  }
  return { argv: withBriefing(agentKey, argv, launch, agents), env: launch?.env ?? {}, warnings };
}

/**
 * Writes an Antigravity launch's permission file (#823): 0600 in a 0700 folder under the pack's
 * app home, never agy's own settings. A failed write refuses the launch: starting without the
 * list would stop the bot at its first prompt. `settings`: models.js agySettingsPlan.
 */
function writeAgySettingsFile(settings, bot) {
  try {
    const dir = dirname(settings.path);
    // Never follow a symlinked folder or file: this file decides what agy may do. A temp in the
    // real folder (created O_EXCL) renamed onto the path replaces a link, never its target.
    let st = null;
    try { st = lstatSync(dir); } catch (e) { if (e?.code !== "ENOENT") throw e; }
    if (st) {
      if (st.isSymbolicLink()) throw new Error(`${dir} is a symlink`);
      if (!st.isDirectory()) throw new Error(`${dir} is not a folder`);
    } else {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (lstatSync(dir).isSymbolicLink()) throw new Error(`${dir} is a symlink`);
    }
    try { if (lstatSync(settings.path).isSymbolicLink()) throw new Error(`${settings.path} is a symlink`); }
    catch (e) { if (e?.code !== "ENOENT") throw e; }
    const tmp = `${settings.path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, settings.text, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, settings.path);
    chmodSync(settings.path, 0o600);
  } catch (e) {
    throw new CliError(`${bot?.name ?? "The bot"} wasn't started: its Antigravity permission list couldn't be written `
      + `(${settings.path}: ${e?.message ?? e}).`);
  }
}

// ---- arguments ----

const OPTIONS = {
  json: { type: "boolean" }, all: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean" },
  project: { type: "string" }, name: { type: "string" }, agent: { type: "string" }, kind: { type: "string" },
  role: { type: "string" }, instructions: { type: "string" }, "instructions-file": { type: "string" },
  code: { type: "string" },
  lead: { type: "string" }, category: { type: "string" }, "no-category": { type: "boolean" },
  character: { type: "string" }, colour: { type: "string" }, color: { type: "string" }, omni: { type: "boolean" },
  model: { type: "string" }, "no-model": { type: "boolean" }, rank: { type: "string" }, "hc-proxy": { type: "string" },
  "agy-mode": { type: "string" }, "worker-agy-mode": { type: "string" },
  "agy-allow": { type: "string", multiple: true }, "agy-deny": { type: "string", multiple: true },
  "no-agy-permissions": { type: "boolean" },
  "planned-wave": { type: "string" }, "planned-note": { type: "string" }, unplanned: { type: "boolean" },
  space: { type: "string" }, tab: { type: "string" },
  title: { type: "string" }, sub: { type: "string" }, id: { type: "string" },
  check: { type: "boolean" }, rollback: { type: "boolean" }, auto: { type: "string" },
  "worker-agent": { type: "string" }, "worker-model": { type: "string" }, "worker-effort": { type: "string" },
  "worker-template": { type: "string" }, template: { type: "string" },
  branch: { type: "string" }, worktree: { type: "string" }, base: { type: "string" }, effort: { type: "string" },
  task: { type: "string" }, bot: { type: "string" }, move: { type: "boolean" },
  fresh: { type: "boolean" }, force: { type: "boolean" }, save: { type: "boolean" }, tree: { type: "boolean" }, "fresh-shared": { type: "boolean" },
  cwd: { type: "string" },
  machine: { type: "string" }, linked: { type: "boolean" }, local: { type: "boolean" },
  "from-hc": { type: "boolean" }, "squad-label": { type: "string" }, apply: { type: "boolean" },
};

export const USAGE = `automagik-herdr: Automagik Herdr's bots and updates from the command line

Usage: automagik-herdr <command> [options]      (every command takes --json and --project <folder>)
       automagik-herdr <command> --machine M --project <folder there> ...
                                                 ls, show, create, edit, rm, category, start,
                                                 restart, attach, detach and whois on a linked
                                                 machine (hc machine ls), through hc
       automagik-herdr --version                 the installed pack's version

  ls [--all]                    bots with kind, lead, category, rank, code, planned, agent, model, agy-mode, pane, status
  show <bot>                    one bot in full
  create --name N --agent A [--kind main|member] [--role R]
         [--code true|false]            false omits the worker instruction; default true
         [--instructions TEXT | --instructions-file F|-] [--lead BOT] [--category ID]
         [--character C --colour K | --omni] [--model M] [--rank R]
         [--agy-mode accept-edits|auto|plan]   Antigravity's --mode; default auto
         [--agy-allow RULE]... [--agy-deny RULE]...
                                       Antigravity permission rules this bot and its workers add
                                       to their launch's own lists (repeatable; never removes a
                                       fixed deny). An empty value clears that list
         [--planned-wave N [--planned-note T]]          prints the new bot's id
         [--worker-agent A] [--worker-model M] [--worker-effort E]   its workers' defaults
         [--worker-agy-mode accept-edits|auto|plan]                  (Antigravity's --mode)
         [--hc-proxy on|off]            per-bot Linux proxy; default off. Edit, proxy approve
                                       (review the diff), then restart to apply or roll back
         [--worker-template T]          (an hc template: owns the command, so it wins)
  edit <bot> [the create options] [--code true|false] [--unplanned] [--no-model] [--no-category] [--rank=]
             [--worker-agent=] [--worker-model=] [--worker-effort=] [--worker-template=]
             [--agy-mode=auto] [--worker-agy-mode=auto]   (empty: cleared; auto is the default)
             [--agy-allow=] [--agy-deny=] [--no-agy-permissions]   (empty: that list cleared)
  rm <bot>
  category ls | add --title T [--sub S] [--id ID] | edit <id> [--title T] [--sub S]
           | rm <id> | order <id>...
  start <bot> [--space ID] [--tab ID]   a new pane on this computer (prints its terminal)
  restart <bot> [--fresh] [--agent A] [--model M [--save]] [--tree [--fresh-shared]] [--force] [--cwd DIR]
                                the bot's agent again in its pane's place (same space and tab,
                                same folder, labels kept), launched from its current source
                                (a live hc template's current command, else the definition's
                                agent and model, plus the agent's own resume words), never from
                                the old pane's command: a flag the source no longer names is
                                dropped, with one line naming the flag names only (their values
                                masked). The new pane starts, and the old one ends only
                                once the new one's agent has stayed up (prints the new
                                terminal). It resumes the conversation in that folder
                                by the pane's session id (its agent.session label, or the
                                ledger's row): claude --resume <session>, codex resume
                                <session>, omp --resume=<session>, pi --session <session>,
                                kimi --session=<session>, agy --conversation <session>, hermes
                                --resume <session>; with no id, the folder's latest (codex
                                resume --last, --continue for the rest), unless another bot
                                on that agent runs there: then a new one, and why;
                                --fresh: a new one; --agent/--model: a swap (always new;
                                --save: also into ${BOTS_PATH}). Refused while the bot is
                                working or has helpers that would end with it, unless --force
                                (they end with it) or --tree (they run again under the new pane,
                                one at a time, each in its folder with its command, resumed: by
                                its agent.session or revive.session id, else its folder's latest,
                                refused when another of them shares that folder and agent unless
                                --fresh-shared starts those on a new conversation; a helper
                                unreadable, in a gone folder, with helpers of its own or a session
                                another names refuses before anything starts; the pane and its
                                helpers are waited for until idle first; the old pane ends, its
                                helpers with it, before they run again; one that fails is
                                reported with the hc run line that resumes it by hand, exit 1;
                                one that won't end is said and never run twice). Not from inside
                                the old pane. A bot not running is started.
                                --cwd DIR: the new pane starts in DIR, not the old pane's folder
                                (helpers keep theirs). Claude finds a conversation by folder slug
                                (the path, every non-alphanumeric as "-"): a resume into a DIR of
                                another slug is refused unless --fresh. A Claude bot's briefing
                                hook is written into DIR (.claude/settings.local.json), as start
                                writes it into the project folder.
  attach <bot> <terminal> [--move]   tie a running pane to the bot; a bot attached elsewhere
                                is refused unless --move (its old pane is detached first)
  detach <bot>                  untie the bot from its pane (a removed bot: by its id)
  import --from-hc [--squad-label L] [--apply]
                                a running hc team as bots: each live pane on this computer
                                labelled L= (default: squad) with an hc name and an agent in front
                                becomes a bot of that name, attached to that pane. In each squad
                                the captain (the pane labelled role=captain, else the one whose
                                name or template is the squad's name then -cap or -captain, as
                                web-cap) reports to the main bot and the others to their
                                captain; a member's rank is its role= label when that is a rank,
                                else its name's last word (dev, test, review, fix, pm). Prints
                                the plan and writes nothing, the attach ledger included, unless
                                --apply, which prints it, then creates and attaches. A pane
                                already playing its bot only gets its lost labels back, so a
                                second run changes nothing. Any conflict (a pane playing or
                                labelled for another bot, a bot of that name attached
                                elsewhere, under another lead or of another agent, a squad
                                without one captain) refuses the whole import. Never starts,
                                moves or restarts a pane
  whois <terminal> | whois --bot <bot>   who plays where, by the attach ledger
  history <bot>                 what the bot did, by the attach and workers ledgers: its panes,
                                starts, sessions (and the newest transcript) and workers
  brief <bot>                   print the bot's briefing with its team's live state, as it is now
  tidy                          what drifted in the window, labels and project list, as a plan;
                                changes nothing (--json: the plan's actions)
  forget <project>              take a project's folder off this CLI's project list; its folder,
                                worktrees, bots and panes stay as they are. ls --all and the
                                sidebar also show the sidebar's own remembered projects, which
                                the sidebar forgets once the bots file is gone: forget says when
                                it remembers this one (--json: sidebar_remembers). start,
                                restart, attach and create already drop an entry whose folder
                                is gone, with a note when the command succeeds
  worker "<task>" (--branch B [--base REF] | --worktree DIR)
         [[--agent A] [--model M] [--effort E] | --template T] [--name N]
         [--role dev|test|review|fix] [--task ID [--lead BOT]]
                                from a bot's pane: start one worker for the task, an hc
                                child of the bot in the task's worktree (prints its terminal);
                                --template runs an hc template, alone; --role defaults from
                                the bot's rank (tester: test, reviewer: review, fixer: fix,
                                else dev). One writer (dev, test, fix) per worktree, any bot;
                                reviewers run alongside. --task: Genie's short id (gl-231);
                                the worker is named <id>-<role>, a --branch must contain the
                                id, and --lead (default: this bot; a reviewer or fixer must
                                pass it) is the task's lead bot. A bot with a worker.swap
                                runs it on about one task in three, by rule. Each call then
                                removes up to 5 worktrees this command made whose workers
                                have all ended (reap)
  reap                          remove every worktree a worker call made whose workers have
                                all ended (killed or done), then git worktree prune. Kept, with
                                one line naming the path and why: uncommitted changes, or
                                commits on no remote unless gh lists the branch's pull
                                requests as merged or closed. A worktree only given to a worker
                                (--worktree, a branch's existing one) is never removed
  update [--check | --rollback] install the latest release (checksum verified), only report
                                current and latest (--check), or put the replaced pack back;
                                an update then runs meter install where you agreed to it
                                (install.sh, or an earlier meter install); nobody asked: nowhere
  update --auto on|off|status   Install updates automatically (on by default): Herdr installs
                                each newer verified release on its own; a version you rolled
                                back is skipped until a newer one is out. Only for a pack
                                install.sh put in place, never a checkout
  meter install [--machine M | --linked | --local]
                                usagemeter, the build the signed meter-lane pointer names (its
                                sha256 checked on each machine, never a downgrade, a pointer
                                older than one already taken refused) in ~/.local/bin on this computer and
                                every connected linked machine (hc machine ls); --machine: that
                                one, e.g. one linked later; --linked: the machines only; --local:
                                this computer only. A machine that fails is a warning. Running
                                it records your yes (--local: this computer only) for updates
  meter uninstall               remove it from the linked machines the pack put it on (the
                                install record says which), only where it is still that version
  dsh-tui install | update      DSH as a Herdr agent: the pinned dsh-TUI ${DSH_TUI.version} in its
                                own \`dsh-tui\` DSH profile, the dsh-tui shim on PATH (Herdr's
                                built-in DSH entry finds it), and dsh-TUI's first-run guide
                                marked done. No dsh on PATH: one honest line, skipped.
  dsh-tui uninstall             dsh-TUI out of the dsh-tui profile and the shim away (sessions,
                                dsh-TUI's state and the profile stay)
  dsh-tui doctor                whether dsh, the dsh-tui profile and the shim are there, and
                                whether the profile is the pinned one, plus each bot's hcProxy
                                working and approved settings and whether its attached proxy
                                answers, and each Antigravity bot's effective permission lists
                                and whether agy's terminal sandbox is there (read-only); off
                                with proxy up warns: rollback unfinished
  proxy approve --project <dir> approve a project's working .herdr/bots.json as the proxy's
                                roster and hcProxy switch: print the diff against the previous
                                approval, then
                                write the record 0600 outside the project. The proxy reads
                                only this record: a working-tree edit warns until approved,
                                and a missing record refuses a proxied pane. Approving is the
                                person's act; the printed diff is the check.
  doc get <name> [--machine M]  a herdr-core doc's value, as one line of JSON on stdout (hc's
                                doc.get through hc connect; read-only, 10 s at most); --machine:
                                that linked machine's doc. Exit 0 with the JSON; 3: no such doc
                                (never written, or deleted); 2: a usage mistake; 1: any other
                                failure (a bad name, hc down, no answer). A message on stderr for
                                every exit but 0: anything but 0 or 3 is a failure. A name is
                                1-128 of A-Z a-z 0-9 . _ -, not . or .. (hc may refuse more).
                                Made for mods: their exec has no stdin to speak hc connect with.
  launch-path <program>         where a launch finds <program> (PATH, ~/.local/bin, this CLI's
                                node folder) and the PATH its pane gets, as one line of JSON:
                                {"program": null, "path": null} when none has it. For the
                                Accounts panel, which runs claude auth status as a launch would.

Antigravity (\`agy\`, 1.5.3): --model takes the ids \`agy models\` lists (a Gemini or Claude
id, e.g. gemini-4-argon-high), never the label its settings.json keeps. The pack caches that
list under <app home>/automagik-herdr/antigravity-models.json, refreshed at most once a run
when it is missing or a day old; agy not installed, signed in or listing nothing keeps the
last cached list and the refusal says when there is none. Every Antigravity launch passes
\`--mode\` (auto, accept-edits or plan): a bot's \`agyMode\` field, else auto; its workers'
\`worker.agyMode\`, else auto. Each launch also writes its own session permission list, 0600
under <app home>/automagik-herdr/agy-settings/, and passes it as \`--settings\`: a narrow allow
list for its scope and the fixed denies --force pushes, hard resets, rm -rf, PR merges and
releases -- plus the bot's \`agyPermissions\` additions, never a fixed deny dropped. The file
also lists the launch's own folder in \`trustedWorkspaces\` -- the project folder for a seat,
the worker's worktree for a worker, never a parent or the home folder -- so agy's first-run
trust question is already answered. The pack never passes --dangerously-skip-permissions and
never writes agy's own saved settings, so the rest of its trust list and saved settings stay
the person's. Its first prompt goes through -i, its resume
through --conversation <id> (--fresh starts new).

--rank R sets the pane's role= label, one of: ${RANKS.join(", ")}.
The main bot's pane is role=main, and a bot that leads others is role=captain, whatever their
rank. Start, attach, detach and an edit keep the panes' bot, role, category and squad labels
in step on this computer.

Which pane plays which bot is the attach ledger's answer (<app home>/automagik-herdr/attach.jsonl,
written by start, attach and detach only); the bot label is a display hint, and relabelling a
pane with hc label changes nothing.

A bot is its id or its name in the project. The project is the one the current folder
keys to (its git main checkout), or --project's. With --machine, --project is an absolute
folder on that machine and the file is read and written there by the same rule (a file
changed since it was read is never overwritten); its panes run there (M/tN). A pane that
reports no status to hc can't say it is waiting for an approval: restart refuses it unless
--force, which still sends it no keys. restart --tree is this computer's only for now: with
--machine it is refused before anything is read or started there, and a bot whose helpers
end with its pane there is refused until each helper's pane is ended (hc kill M/tN).`;

/** `proxy approve`'s own help: the residual is part of the command's contract. */
export const PROXY_USAGE = `usage: automagik-herdr proxy approve --project <dir>

Approve a project's worked roster: reads <dir>'s .herdr/bots.json, prints the diff against the
previous approval (bots added/removed, rank/lead/kind changes), then writes the record
0600 outside the project. The proxy reads only this record; a working-tree roster that
differs warns once naming this command and still starts on the approved one. A missing
record refuses a proxied pane.

Residual: a sandboxed bot can ask an in-team unsandboxed pane to run this command. The
printed diff is the check, and approving is the person's act.
`;

function readInstructions(opts) {
  if (opts.instructions !== undefined && opts["instructions-file"] !== undefined) throw new CliError("Give --instructions or --instructions-file, not both.", 2);
  let text = opts.instructions;
  if (opts["instructions-file"] !== undefined) {
    const f = opts["instructions-file"];
    try { text = readFileSync(f === "-" ? 0 : f, "utf8"); } catch (e) { throw new CliError(`Can't read ${f}: ${e?.message ?? e}`); }
    text = text.replace(/\n$/, "");
  }
  if (text !== undefined && text.length > MAX_INSTRUCTIONS) {
    throw new CliError(`Instructions are ${text.length} characters; the limit is ${MAX_INSTRUCTIONS}. Nothing was saved.`);
  }
  return text;
}

/**
 * The models `agent` may be pinned to (models.js knownModels), cache-first for Antigravity
 * (#793): a pin the cache already lists is used as it is, even when the cache is old, with no
 * `agy models`; a missing cache or an unlisted pin refreshes once in this run (modelCache.js)
 * and reads again. A refresh that fails (agy isn't installed, isn't signed in) keeps the last
 * cached list; with none, the pin is refused and the message says why.
 */
function modelList(agent, pin = null) {
  let list = knownModels(agent, modelIo());
  if (agent !== "antigravity" || !pin || list.includes(pin)) return list;
  if (agModelsLooked) return list;
  agModelsLooked = true;
  try {
    refreshAgModelsSync({
      appHome: appHome(),
      read: (path) => readText(path),
      write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); },
      rename: (from, to) => renameSync(from, to),
      exec: (command, args, options) => {
        const file = programPath(command);
        if (!file) throw new Error(`${command} isn't installed`);
        return agModelsSpawnResult(spawnSync(file, args, { encoding: "utf8", timeout: options?.timeout ?? AG_MODELS_TIMEOUT_MS }));
      },
      now: Date.now(),
    });
  } catch { /* no cache and no list: knownModels reads what is there */ }
  return knownModels(agent, modelIo());
}

// Whether this CLI run has already looked at `agy models`: one refresh a run at most.
let agModelsLooked = false;

function checkModel(agent, model) {
  if (!agent) throw new CliError("A model pin needs a coding agent (--agent).", 2);
  if (modelRefusal(agent)) throw new CliError(modelRefusal(agent), 2);
  const list = modelList(agent, model);
  if (!list.includes(model)) {
    throw new CliError(list.length ? `${model} isn't a known ${agent} model. Pick one of: ${list.join(", ")}.`
      : `There is no list of ${agent} models to pin from${agent === "antigravity" ? " (agy models has listed none: agy may not be installed, signed in, or cached yet)" : ""}; leave the model unpinned (the running one is detected).`);
  }
}

/**
 * The execution mode a launch of `bot` on `agentKey` passes: auto unless the roster's
 * agyMode names another one; null for every other agent, whose launch line stays unchanged. An
 * unknown roster mode is refused here, one line, before anything starts.
 */
function launchAgyMode(bot, agentKey) {
  if (agentKey !== "antigravity") return null;
  const why = agyModeProblem(bot.agyMode);
  if (why) throw new CliError(`${bot.name}: ${why} Fix it with automagik-herdr edit ${bot.id} --agy-mode <accept-edits|auto|plan>.`);
  return agyModeOf(bot.agyMode);
}

/**
 * The entry create or edit writes: `base` (the stored raw entry, or a new one) with the
 * options given applied and checked against the project. Throws a CliError on a refusal.
 */
export function entryFrom(opts, base, project, { creating }) {
  const { file } = project;
  const entry = JSON.parse(JSON.stringify(base));
  if (opts.name !== undefined) {
    if (!opts.name.trim()) throw new CliError("A bot needs a name.", 2);
    entry.name = opts.name.trim();
  }
  if (!entry.name) throw new CliError("A bot needs a name (--name).", 2);
  const twin = file.bots.find((b) => b.id !== entry.id && b.name.toLowerCase() === entry.name.toLowerCase());
  if (twin) throw new CliError(`${twin.id} is already named "${twin.name}" in this project; names pick bots, so pick another.`);
  if (opts.kind !== undefined) {
    if (!KINDS.includes(opts.kind)) throw new CliError(`--kind is main or member, not "${opts.kind}".`, 2);
    entry.kind = opts.kind;
  }
  const main = mainBotOf(file);
  if (creating && !main && entry.kind !== "main") throw new CliError("The first bot in a project must be its main bot (--kind main).");
  if (entry.kind === "main" && main && main.id !== entry.id) throw new CliError(`This project already has a main bot, ${main.name} (${main.id}).`);
  if (opts.role !== undefined) entry.role = opts.role;
  if (opts.code !== undefined) {
    if (!["true", "false"].includes(opts.code)) throw new CliError("--code is true or false; nothing was saved.", 2);
    entry.code = opts.code === "true";
  }
  entry.role ??= "";
  // Rank (A16): one of RANKS, for the pane's role= label; --rank= clears it (kept empty so
  // applyBotEdit removes the stored one).
  if (opts.rank !== undefined) {
    if (opts.rank !== "" && !RANKS.includes(opts.rank)) throw new CliError(`--rank is one of ${RANKS.join(", ")} (or --rank= to clear), not "${opts.rank}".`, 2);
    entry.rank = opts.rank;
  }
  if (opts["hc-proxy"] !== undefined) {
    if (!["on", "off"].includes(opts["hc-proxy"])) {
      throw new CliError("--hc-proxy is on or off; nothing was saved.", 2);
    }
    entry.hcProxy = opts["hc-proxy"] === "on";
  }
  const instructions = readInstructions(opts);
  if (instructions !== undefined) entry.instructions = instructions;
  entry.instructions ??= "";
  if (opts.agent !== undefined) {
    const agents = agentTable();
    const key = resolveAgent(opts.agent, agents);
    if (!key) throw new CliError(`"${opts.agent}" isn't a coding agent Herdr knows. Known: ${Object.keys(agents).join(", ")}.`);
    entry.agent = key;
  }
  // Planned (A3): a wave and an optional note; --unplanned clears it.
  if (opts.unplanned && opts["planned-wave"] !== undefined) throw new CliError("Give --planned-wave or --unplanned, not both.", 2);
  if (opts.unplanned) delete entry.planned;
  if (opts["planned-wave"] !== undefined) {
    const wave = Number(opts["planned-wave"]);
    if (!Number.isInteger(wave) || wave < 1) throw new CliError("--planned-wave is a positive whole number.", 2);
    entry.planned = plannedOf(entry.planned, wave, opts["planned-note"] ?? entry.planned?.note);
  } else if (opts["planned-note"] !== undefined) {
    if (!entry.planned) throw new CliError("--planned-note goes with --planned-wave.", 2);
    entry.planned = plannedOf(entry.planned, entry.planned.wave, opts["planned-note"]);
  }
  if (!entry.agent && !entry.planned) throw new CliError("A bot needs a coding agent (--agent), unless it is planned.", 2);
  // Model pin (A12): from the agent's list, never free text.
  if (opts.model !== undefined && opts["no-model"]) throw new CliError("Give --model or --no-model, not both.", 2);
  if (opts["no-model"]) delete entry.model;
  if (opts.model !== undefined) { checkModel(entry.agent, opts.model); entry.model = opts.model; }
  else if (entry.model && opts.agent !== undefined && !modelList(entry.agent, entry.model).includes(entry.model)) {
    throw new CliError(`${entry.name} is pinned to ${entry.model}, which ${entry.agent} doesn't list; pass --model or --no-model.`);
  }
  // Antigravity's execution mode: applied at launch (auto unless another is stored), so the
  // default is written as no field at all and auto clears a stored one.
  if (opts["agy-mode"] !== undefined) {
    const why = agyModeProblem(opts["agy-mode"]);
    if (why) throw new CliError(`--agy-mode: ${why}`, 2);
    const mode = agyModeOf(opts["agy-mode"]);
    entry.agyMode = mode === AGY_MODE_DEFAULT ? "" : mode;
  }
  // Antigravity's permission additions (#823): repeatable rules that add to the fixed deny rules
  // and the launch's own allow list; one empty value clears that list, and --no-agy-permissions
  // clears both. They only ever add: the fixed denies are added at launch.
  if (opts["no-agy-permissions"] && (opts["agy-allow"] !== undefined || opts["agy-deny"] !== undefined)) {
    throw new CliError("Give --no-agy-permissions or --agy-allow/--agy-deny, not both.", 2);
  }
  if (opts["no-agy-permissions"]) delete entry.agyPermissions;
  if (opts["agy-allow"] !== undefined || opts["agy-deny"] !== undefined) {
    const stored = entry.agyPermissions && typeof entry.agyPermissions === "object" && !Array.isArray(entry.agyPermissions)
      ? entry.agyPermissions : {};
    const pick = (given, kept, flag) => {
      if (given === undefined) return Array.isArray(kept) ? kept.filter((r) => typeof r === "string") : [];
      const rules = given.filter((r) => r.trim() !== "");
      for (const rule of rules) {
        const why = agyRuleProblem(rule);
        if (why) throw new CliError(`${flag}: ${why}`, 2);
      }
      return [...new Set(rules.map((r) => r.trim()))];
    };
    const allow = pick(opts["agy-allow"], stored.allow, "--agy-allow");
    const deny = pick(opts["agy-deny"], stored.deny, "--agy-deny");
    if (allow.length || deny.length) entry.agyPermissions = { allow, deny };
    else delete entry.agyPermissions;
  }
  workerDefaults(opts, entry);
  // Lead (A1): the main bot or another non-planned member, never itself or one of its own.
  if (opts.lead !== undefined) {
    if (entry.kind === "main") throw new CliError("A main bot has no lead.", 2);
    const lead = findBot(file, opts.lead);
    if (lead.id === entry.id) throw new CliError(`${entry.name} can't lead itself.`);
    if (lead.planned) throw new CliError(`${lead.name} is planned, so it can't lead a bot yet.`);
    if (!creating && descendantsOf(file, entry.id).has(lead.id)) throw new CliError(`${lead.name} reports to ${entry.name}, so it can't be its lead.`);
    entry.lead = lead.id;
  }
  if (entry.kind === "main") delete entry.lead;
  // Category (A2): only for a bot whose lead is the main bot.
  if (opts.category !== undefined && opts["no-category"]) throw new CliError("Give --category or --no-category, not both.", 2);
  if (opts["no-category"]) delete entry.category;
  if (opts.category !== undefined) {
    const leadsToMain = entry.kind === "member" && (!entry.lead || entry.lead === main?.id);
    if (!leadsToMain) throw new CliError("A category goes only on a member that reports to the main bot.", 2);
    entry.category = findCategory(file, opts.category).id;
  }
  // Look: --omni, or a character and colour (one left out keeps the stored or default one).
  const colour = opts.colour ?? opts.color;
  if (opts.omni && (opts.character !== undefined || colour !== undefined)) throw new CliError("Give --omni or --character/--colour, not both.", 2);
  if (opts.character !== undefined && !CHARACTERS.includes(opts.character)) throw new CliError(`Unknown character "${opts.character}". Characters: ${CHARACTERS.join(", ")}.`, 2);
  if (colour !== undefined && !COLOURS.includes(colour)) throw new CliError(`Unknown colour "${colour}". Colours: ${COLOURS.join(", ")}.`, 2);
  const look = entry.look && typeof entry.look === "object" ? entry.look : defaultLook(entry.id);
  if (opts.omni) entry.look = { ...OMNI_LOOK };
  else entry.look = { character: opts.character ?? look.character, colour: colour ?? look.colour };
  return entry;
}

/**
 * The bot's worker defaults (`worker: { agent?, model?, effort?, template?, agyMode? }`) from
 * --worker-agent, --worker-model, --worker-effort, --worker-template and --worker-agy-mode; an
 * empty value clears that one. A template is an hc template name; it isn't looked up here (edit runs anywhere). The agent is canonical
 * (`claude-code` is stored as `claude`); a model must be on the worker agent's list when it
 * has one (an agent with no list takes any model: workers' models are swap-test data). An
 * Antigravity mode is one of AGY_MODES; auto, the default, clears a stored one.
 */
function workerDefaults(opts, entry) {
  const given = ["agent", "model", "effort", "template", "agy-mode"].filter((k) => opts[`worker-${k}`] !== undefined);
  if (!given.length) return;
  const w = entry.worker && typeof entry.worker === "object" && !Array.isArray(entry.worker) ? { ...entry.worker } : {};
  const agentText = opts["worker-agent"];
  if (agentText === "") delete w.agent;
  else if (agentText !== undefined) {
    const agents = agentTable();
    const key = resolveAgent(agentText, agents);
    if (!key) throw new CliError(`--worker-agent: "${agentText}" isn't a coding agent Herdr knows. Known: ${Object.keys(agents).join(", ")}.`, 2);
    w.agent = key;
  }
  const agyMode = opts["worker-agy-mode"];
  if (agyMode === "") delete w.agyMode;
  else if (agyMode !== undefined) {
    const why = agyModeProblem(agyMode);
    if (why) throw new CliError(`--worker-agy-mode: ${why}`, 2);
    const mode = agyModeOf(agyMode);
    if (mode === AGY_MODE_DEFAULT) delete w.agyMode; else w.agyMode = mode;
  }
  const effort = opts["worker-effort"];
  if (effort === "") delete w.effort;
  else if (effort !== undefined) {
    if (!EFFORT_SHAPE.test(effort)) throw new CliError(`--worker-effort: "${effort}" isn't an effort level (low, medium, high, …).`, 2);
    w.effort = effort;
  }
  const template = opts["worker-template"];
  if (template === "") delete w.template;
  else if (template !== undefined) {
    if (!TEMPLATE_SHAPE.test(template)) throw new CliError(`--worker-template: "${template}" isn't an hc template name (letters, digits, ".", "_" and "-", no dash first).`, 2);
    w.template = template;
  }
  const model = opts["worker-model"];
  if (model === "") delete w.model;
  else if (model !== undefined) {
    if (optionLike(model)) throw new CliError(`--worker-model: "${model}" starts with a dash, so an agent would read it as an option.`, 2);
    const agent = w.agent ?? entry.agent;
    const list = agent ? modelList(agent, model) : [];
    if (list.length && !list.includes(model)) throw new CliError(`--worker-model: ${model} isn't a known ${agent} model. Pick one of: ${list.join(", ")}.`);
    w.model = model;
  }
  // dsh-tui workers take neither (#598): refused here, as workerPlan refuses them at a worker's start.
  const refusal = modelRefusal(w.agent ?? entry.agent);
  if (refusal && (w.model || w.effort)) throw new CliError(`--worker-model / --worker-effort: ${refusal}`, 2);
  entry.worker = w; // empty: applyBotEdit removes it
}

// ---- commands ----

async function projectFor(opts) {
  if (opts.machine !== undefined) return loadRemoteProject(await remoteKeyOf(opts), opts.machine);
  return loadProject(await commandKeyOf(opts));
}
/**
 * Where this command's edit is written (RFC 0014 Q16, #234): the git top level of the folder
 * it was run in or named with --project (a worktree's own folder), else the project key (a
 * main checkout's top level is its key; outside git the key, as before). A linked machine's:
 * its key, as before.
 */
async function writeDirOf(opts, key) {
  if (opts.machine !== undefined) return key;
  return (await writeFolderOf(resolvePath(opts.project ?? process.cwd()), git)) ?? key;
}
/** projectFor for a command that edits the file: read from, and written to, writeDirOf's folder. */
async function editProjectFor(opts) {
  if (opts.machine !== undefined) return projectFor(opts);
  const key = await commandKeyOf(opts);
  return loadProject(key, await writeDirOf(opts, key));
}
// The commands that take --machine: the definitions ones (and meter's own --machine).
const ON_MACHINE = new Set(["ls", "show", "create", "edit", "rm", "category", "start", "restart", "attach", "detach", "whois", "meter", "doc"]);
// A project's place in --json answers: `machine` only for a linked machine's.
const placeOf = (project) => ({ project: project.key, ...(project.machine ? { machine: project.machine } : {}) });

// The sidebar's own remembered projects on this computer: am.* since the rename, else the old
// key. Read only: the sidebar writes them (and forgets one whose bots file is gone).
function sidebarRemembered() {
  try {
    const held = JSON.parse(readText(`${appHome()}/shared.json`) ?? "{}");
    const list = held?.["am.sidebar.projects"] ?? held?.[renamedFrom(SHARED_RENAMES, "am.sidebar.projects")];
    return Array.isArray(list) ? list.filter((p) => typeof p?.key === "string" && !p.machine).map((p) => p.key) : [];
  } catch { return []; /* unreadable: none */ }
}

// The projects the sidebar shows with no space open: its remembered list, then this CLI's.
function rememberedKeys() {
  const keys = sidebarRemembered();
  let listed = [];
  try { listed = listedProjects(readText(`${appHome()}/${PROJECTS_FILE}`)); } catch { /* unreadable: none */ }
  return [...new Set([...keys, ...listed])];
}

/**
 * `forget <project>`: takes the project's folder off this CLI's project list, under the list's
 * lock. Only that entry: no folder, worktree, bots file or terminal is touched. An unknown name
 * is refused, the file unchanged. `ls --all` and the sidebar also show the sidebar's own
 * remembered projects (shared.json), which only the sidebar writes: when it remembers this one
 * too, forget says so (stderr, and `sidebar_remembers` in --json).
 */
async function cmdForget(opts, [ref]) {
  if (!ref) throw new CliError("forget needs a project: its folder, as ls --all prints it.", 2);
  if (opts.project !== undefined) throw new CliError("forget takes the project as its argument, not --project.", 2);
  const key = resolvePath(ref);
  const path = `${appHome()}/${PROJECTS_FILE}`;
  let taken;
  // No app home (Herdr isn't set up here): there is no list, so nothing is on it.
  try { taken = existsSync(appHome()) ? unlistProjects([key]) : []; } catch (e) {
    throw new CliError(`${key} wasn't taken off ${path}: ${String(e?.message ?? e).split("\n")[0]}`, 1, { project: key, forgotten: false });
  }
  const sidebar = sidebarRemembered().includes(key);
  const sidebarLine = `the sidebar remembers it on its own and forgets it once its ${BOTS_PATH} is gone, so ls --all and the sidebar `
    + "still show it until then.";
  if (taken.includes(key)) {
    if (sidebar) process.stderr.write(`automagik-herdr: ${key} is off this CLI's project list, but ${sidebarLine}\n`);
    return opts.json ? { forgotten: key, list: path, sidebar_remembers: sidebar } : `${key} forgotten: off ${path}.`;
  }
  const why = sidebar
    ? `${key} isn't on this CLI's project list (${path}); ${sidebarLine}`
    : `${key} isn't on the project list (${path}); automagik-herdr ls --all shows the projects there.`;
  throw new CliError(why, 1, { project: key, forgotten: false });
}

async function cmdLs(opts) {
  if (opts.machine !== undefined) {
    if (opts.all) throw new CliError("ls --all lists this computer's projects; give --machine without --all.", 2);
    const project = await projectFor(opts);
    const { view, hcError } = await viewOrError();
    const bots = project.file.bots.map((b) => describe(project, b, view, hcError));
    const one = { ...placeOf(project), categories: project.file.categories, warnings: project.warnings, bots };
    return opts.json ? { projects: [one] } : lsLines([one]);
  }
  const keys = [await commandKeyOf(opts)];
  if (opts.all) for (const k of rememberedKeys()) if (!keys.includes(k)) keys.push(k);
  const projects = [];
  const { view, hcError } = await viewOrError();
  for (const key of keys) {
    let project;
    try { project = loadProject(key); } catch (e) { projects.push({ project: key, error: e.message, categories: [], bots: [], warnings: [] }); continue; }
    if (project.text === null && opts.all && key !== keys[0]) continue; // a remembered project whose file is gone
    const bots = project.file.bots.map((b) => describe(project, b, view, hcError));
    projects.push({ project: key, categories: project.file.categories, warnings: project.warnings, bots });
  }
  if (opts.json) return { projects };
  return lsLines(projects);
}

function lsLines(projects) {
  const lines = [];
  for (const p of projects) {
    lines.push(`${p.project}${p.machine ? ` on ${p.machine}` : ""}${p.error ? `  (${p.error})` : ""}`);
    if (!p.bots.length && !p.error) lines.push("  no bots");
    for (const b of p.bots) {
      const where = b.kind === "main" ? "main" : `→ ${b.leadName ?? "?"}${b.category ? ` [${b.category}]` : ""}`;
      const model = b.model ? `${b.model} (${b.modelSource})` : "-";
      const agy = b.agyMode ? `  agy-mode ${b.agyMode}` : "";
      const perms = b.agyPermissions || b.workerAgyPermissions
        ? `  agy-allow ${(b.agyPermissions ?? b.workerAgyPermissions).allow.length} deny ${(b.agyPermissions ?? b.workerAgyPermissions).deny.length}` : "";
      const status = b.planned ? `planned, wave ${b.planned.wave}` : b.terminal ? `${b.status} in ${p.machine ? `${p.machine}/` : ""}${b.terminal}` : b.status;
      lines.push(`  ${b.id}  ${b.name}${b.rank ? ` (${b.rank})` : ""}  ${where}  code ${b.code}  ${b.agent ?? "-"}  ${model}${agy}${perms}  ${status}${b.warning ? `  ! ${b.warning}` : ""}`);
    }
    for (const w of p.warnings ?? []) lines.push(`  ! ${w}`);
    const hcError = p.bots.find((b) => b.hcError)?.hcError;
    if (hcError) lines.push(`  ! panes unknown: ${hcError}`);
  }
  return lines.join("\n");
}

/** A bot's worker defaults (or its swap arm) as one line: `agent codex · model gpt-5.5 · agy mode plan`. */
const workerText = (w) => {
  if (!w) return "";
  const mode = w.agyMode ? [`agy mode ${w.agyMode}`] : [];
  return ["template", "agent", "model", "effort"].filter((k) => typeof w[k] === "string" && w[k])
    .map((k) => `${k} ${w[k]}`).concat(mode).join(" · ");
};

const proxyStateText = (state) => `working ${state.working ? "on" : "off"}; approved `
  + `${state.error ? "unknown" : state.approved === null ? "missing" : state.approved ? "on" : "off"}`
  + `${state.error ? `; ${state.error}` : ""}`;

const proxyWarning = (state) => `WARNING hc proxy: ${state.error}; working switch off; `
  + "starting plain; run automagik-herdr proxy approve";
const reportProxyWarning = (warning) => report([warning]);

function proxyEnabled(state, platform = process.platform, warn = reportProxyWarning) {
  try {
    const enabled = approvedProxyEnabled(state, platform);
    if (platform === "linux" && state.error && !state.working) warn(proxyWarning(state));
    return enabled;
  }
  catch (e) { throw new CliError(e.message); }
}

// Read approval on the target, never from this computer's data root. Only Linux launches
// use the switch, so a linked non-Linux launch needs no approval probe.
async function proxyStateOn(project, bot) {
  const { key, machine } = project;
  let path;
  try {
    const location = await remoteIo.exec("sh", ["-c",
      'CDPATH= cd -- "$1" || exit 1; pwd -P; '
      + 'printf "%s\\n" "${XDG_DATA_HOME:-$HOME/.local/share}/automagik-herdr/approved"',
      "sh", key], machine, { timeout: AGENT_WAIT_S });
    if (location.code !== 0) throw new Error("cannot locate the target's approved roster");
    const [canonical, root, extra] = location.stdout.trimEnd().split("\n");
    if (!canonical?.startsWith("/") || !root?.startsWith("/") || extra !== undefined) {
      throw new Error("the target's approval location is invalid");
    }
    const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
    // Same canonical key and suffix as approved.js recordFileOf; fixture test pins both.
    path = `${root}/${hash}.json`;
    const mode = await remoteIo.exec("sh", ["-c",
      'if [ ! -e "$1" ] && [ ! -L "$1" ]; then exit 3; fi; '
      + '[ -f "$1" ] && [ ! -L "$1" ] || exit 1; stat -c %a -- "$1" 2>/dev/null || stat -f %Lp "$1"',
      "sh", path], machine, { timeout: AGENT_WAIT_S });
    if (mode.code === 3) return proxyStateFor(bot);
    if (mode.code !== 0 || !/^[0-7]{3,4}\s*$/.test(mode.stdout)
      || (parseInt(mode.stdout, 8) & 0o077) !== 0) {
      throw new Error("the target's approved record is unreadable or not private");
    }
    const text = await readRemoteText(remoteIo, machine, path);
    if (text === null) throw new Error("the target's approved record disappeared");
    return proxyStateFor(bot, parseApprovedRecord(text, canonical).file);
  } catch (e) {
    return proxyStateFor(bot, null,
      `invalid approved record ${path ?? `for project ${key}`}: ${e?.message ?? e}`);
  }
}

async function checkLinkedProxy(project, bot, agent, warn = reportProxyWarning) {
  if (agent !== "dsh-tui") return;
  const target = await remoteIo.exec("uname", ["-s"], project.machine,
    { timeout: AGENT_WAIT_S });
  if (target.code !== 0) {
    const why = String(target.stderr || target.stdout || `exit ${target.code}`)
      .replace(/\s+/g, " ").trim();
    const state = proxyStateFor(bot, null, `cannot check the target platform: ${why}`);
    proxyEnabled(state, "linux", warn);
    return;
  }
  if (!/^Linux(?:\s|$)/.test(target.stdout)) return;
  if (proxyEnabled(await proxyStateOn(project, bot), "linux", warn)) {
    throw new CliError("hc proxy: start this opted-in bot on its own computer; "
      + "linked Linux launches cannot verify the proxy execution path.");
  }
}

async function cmdShow(opts, [ref]) {
  const project = await projectFor(opts);
  const bot = await botIn(project, ref, opts);
  const { view, hcError } = await viewOrError();
  const info = { ...describe(project, bot, view, hcError), instructions: bot.instructions };
  info.hcProxyState = project.machine ? await proxyStateOn(project, bot)
    : approvedProxyState({ project: project.key, bot });
  if (opts.json) return info;
  return [
    `${info.name} (${info.id})`, `  project      ${info.project}${info.machine ? ` on ${info.machine}` : ""}`, `  kind         ${info.kind}`,
    ...(info.lead ? [`  lead         ${info.leadName} (${info.lead})`] : []),
    ...(info.category ? [`  category     ${info.category}`] : []),
    ...(info.planned ? [`  planned      wave ${info.planned.wave}${info.planned.note ? ` · ${info.planned.note}` : ""}`] : []),
    `  agent        ${info.agent ?? "-"}`, `  model        ${info.model ? `${info.model} (${info.modelSource})` : "-"}${info.pinnedModel && info.modelSource !== "pinned" ? `, pinned ${info.pinnedModel}` : ""}`,
    ...(info.agyMode ? [`  agy mode     ${info.agyMode}`] : []),
    ...(info.agyPermissions ? [`  agy trusted  ${(info.agyPermissions.trustedWorkspaces ?? []).join(", ") || "-"}`,
      `  agy allow    ${info.agyPermissions.allow.join(", ") || "-"}`,
      `  agy deny     ${info.agyPermissions.deny.join(", ") || "-"}`] : []),
    ...(info.workerAgyPermissions ? [`  worker agy allow  ${info.workerAgyPermissions.allow.join(", ")}`,
      `  worker agy deny   ${info.workerAgyPermissions.deny.join(", ")}`] : []),
    `  status       ${info.status}${info.terminal ? ` in ${info.terminal} (since ${info.since})` : ""}`,
    `  look         ${info.look.character} in ${info.look.colour}`, `  role         ${info.role || "-"}`,
    `  rank         ${info.rank ?? "-"}`, `  code         ${info.code}`,
    `  hc proxy     ${proxyStateText(info.hcProxyState)}`,
    `  worker       ${workerText(info.worker) || "-"}`,
    ...(info.worker?.swap ? [`  swap         ${workerText(info.worker.swap)} (planned swaps: about 1 task in 3)`] : []),
    ...(info.warning ? [`  warning      ${info.warning}`] : []),
    "  instructions", ...(info.instructions ? info.instructions.split("\n").map((l) => `    ${l}`) : ["    -"]),
  ].join("\n");
}

// ---- A16 pane labels (launchArgs.js): this computer's panes only ----

/** The `hc get` of a bot's attached live pane on this computer, as a list (launchArgs relabel's io.rows). */
async function liveRows(botId) {
  const get = await attachedGet(botId);
  return get ? [get] : [];
}
const labelIo = { rows: liveRows, label: async (address, words) => (await hc(["label", address, ...words])).code === 0 };

/**
 * After a write, the live local panes of every bot whose labels the edit changed (rank, lead
 * or category, and a lead's captain status) get them rewritten, by launchArgs.js relabel as
 * the sidebar does. The file is saved already, so a failure only warns. Resolves with the
 * terminals relabelled.
 */
async function relabelAfter(beforeFile, afterRaw) {
  let afterFile;
  try { afterFile = parseBots(JSON.stringify(afterRaw)).file; } catch { return []; }
  const out = await relabel(relabelPlan(beforeFile, afterFile), labelIo);
  const warning = relabelWarning(out);
  if (warning) report([warning]);
  return out.done;
}

async function cmdCreate(opts) {
  const project = await editProjectFor(opts);
  const id = newBotId();
  const entry = entryFrom(opts, { id, kind: mainBotOf(project.file) ? "member" : "main" }, project, { creating: true });
  const raw = applyBotEdit(project.raw, entry);
  await saveProject(project, raw);
  // A lead that becomes a captain; another machine's panes are left as they are.
  const relabelled = project.machine ? [] : await relabelAfter(project.file, raw);
  return opts.json ? { id, ...placeOf(project), bot: entry, relabelled } : id;
}

async function cmdEdit(opts, [ref]) {
  const project = await editProjectFor(opts);
  const bot = await botIn(project, ref, opts);
  const stored = project.raw.bots.find((b) => b?.id === bot.id);
  const entry = entryFrom(opts, stored, project, { creating: false });
  const raw = applyBotEdit(project.raw, entry);
  await saveProject(project, raw);
  const relabelled = project.machine ? [] : await relabelAfter(project.file, raw);
  return opts.json ? { id: bot.id, ...placeOf(project), bot: entry, relabelled } : `${entry.name} (${bot.id}) saved.`;
}

async function cmdRm(opts, [ref]) {
  const project = await editProjectFor(opts);
  const { file } = project;
  const bot = await botIn(project, ref, opts);
  // Its pane by the ledger, read before the write (the import, on a first run, needs the bot
  // still defined). hc missing or failing only drops the note.
  let holders = [];
  if (!bot.planned && !project.machine) {
    try { const held = (await attachView()).live.get(bot.id); holders = held ? [held.binding.terminal] : []; } catch (e) {
      if (e instanceof LedgerRefusal) throw e;
      holders = [];
    }
  }
  // Every other entry as stored, those parseBots left out included: they are still bots.
  const others = project.raw.bots.filter((b) => b?.id !== bot.id);
  if (bot.kind === "main" && others.length) {
    throw new CliError(`${bot.name} is the main bot and its project still has ${others.length} other bot${others.length > 1 ? "s" : ""}; remove them first.`);
  }
  const team = [...descendantsOf(file, bot.id)].map((id) => file.bots.find((b) => b.id === id)?.name ?? id);
  const leads = others.filter((b) => b?.lead === bot.id).map((b) => b.name ?? b.id);
  if (team.length || leads.length) throw new CliError(`${bot.name} leads ${[...new Set([...leads, ...team])].join(", ")}; give them another lead first (automagik-herdr edit <bot> --lead …).`);
  const raw = JSON.parse(JSON.stringify(project.raw));
  raw.bots = raw.bots.filter((b) => b?.id !== bot.id);
  // Only an empty list deletes the file; anything else must pass checkBots (a file left
  // with members and no main bot is refused, never deleted).
  const last = raw.bots.length === 0;
  // A worktree with no file of its own holds nothing to delete: its edit would only show the key's.
  if (last && project.expected === null) {
    throw new CliError(`${bot.name} is the project's last bot and ${fileName(project)} isn't there, so nothing was removed; `
      + `remove it from ${project.key}.`);
  }
  await saveProject(project, last ? null : raw, { list: false });
  if (!last && !project.machine) await relabelAfter(file, raw); // its lead may stop being a captain
  const notes = [];
  if (last) notes.push(`${bot.name} was the project's last bot: ${fileName(project)} was deleted.`);
  if (holders.length) notes.push(`${holders.join(", ")} is still attached to it; detach it with: automagik-herdr detach ${bot.id}`);
  for (const n of notes) process.stderr.write(`automagik-herdr: ${n}\n`);
  return opts.json ? { removed: bot.id, ...placeOf(project), deletedFile: last, attachedTerminals: holders } : `${bot.name} (${bot.id}) removed.`;
}

async function cmdCategory(opts, [verb, ...rest]) {
  // Listing reads the project's file; the other verbs edit, in writeDirOf's folder.
  const project = verb === "ls" || verb === undefined ? await projectFor(opts) : await editProjectFor(opts);
  const raw = JSON.parse(JSON.stringify(project.raw));
  raw.categories = Array.isArray(raw.categories) ? raw.categories : [];
  const save = async () => {
    if (project.text === null) throw new CliError("This project has no bots yet; create its main bot first.");
    await saveProject(project, raw);
  };
  const find = (ref) => {
    const hit = findCategory(project.file, ref);
    return raw.categories.find((c) => c?.id === hit.id);
  };
  if (verb === "ls" || verb === undefined) {
    const list = project.file.categories.map((c) => ({ ...c, bots: project.file.bots.filter((b) => b.category === c.id).map((b) => b.id) }));
    return opts.json ? { ...placeOf(project), categories: list } : list.map((c) => `${c.id}  ${c.title}${c.sub ? ` · ${c.sub}` : ""}  (${c.bots.length} bot${c.bots.length === 1 ? "" : "s"})`).join("\n") || "no categories";
  }
  if (verb === "add") {
    if (!opts.title?.trim()) throw new CliError("A category needs a title (--title).", 2);
    const id = opts.id ?? newCategoryId(opts.title, raw.categories);
    if (!CATEGORY_ID.test(id)) throw new CliError(`--id "${id}" isn't a category id: a lowercase slug (a-z, 0-9, single dashes), as it goes into a pane's category= label.`, 2);
    if (raw.categories.some((c) => c?.id === id)) throw new CliError(`Category ${id} is there already.`);
    const cat = { id, title: opts.title.trim() };
    if (opts.sub?.trim()) cat.sub = opts.sub.trim();
    raw.categories.push(cat);
    await save();
    return opts.json ? { ...placeOf(project), category: cat } : id;
  }
  if (verb === "edit") {
    const cat = find(rest[0]);
    if (opts.title !== undefined) { if (!opts.title.trim()) throw new CliError("A category's title can't be empty.", 2); cat.title = opts.title.trim(); }
    if (opts.sub !== undefined) { if (opts.sub.trim()) cat.sub = opts.sub.trim(); else delete cat.sub; }
    await save();
    return opts.json ? { ...placeOf(project), category: cat } : `${cat.id} saved.`;
  }
  if (verb === "rm") {
    const cat = find(rest[0]);
    const users = project.file.bots.filter((b) => b.category === cat.id).map((b) => b.name);
    if (users.length) throw new CliError(`${users.join(", ")} ${users.length > 1 ? "are" : "is"} in ${cat.id}; move them first (automagik-herdr edit <bot> --category … or --no-category).`);
    raw.categories = raw.categories.filter((c) => c?.id !== cat.id);
    await save();
    return opts.json ? { ...placeOf(project), removed: cat.id } : `${cat.id} removed.`;
  }
  if (verb === "order") {
    if (!rest.length) throw new CliError("Name the categories in their new order.", 2);
    const ids = rest.map((r) => find(r).id);
    if (new Set(ids).size !== ids.length) throw new CliError("A category is named twice.", 2);
    raw.categories = [...ids.map((id) => raw.categories.find((c) => c?.id === id)), ...raw.categories.filter((c) => !ids.includes(c?.id))];
    await save();
    return opts.json ? { ...placeOf(project), categories: raw.categories.map((c) => c.id) } : raw.categories.map((c) => c.id).join(" ");
  }
  throw new CliError(`category ${verb}: unknown; use ls, add, edit, rm or order.`, 2);
}

/**
 * The session ids this run has handled (chosen for a launch, resumed, carried, read from a pane or
 * the ledger): RFC 0021 keeps them in the machine's ledgers and labels, never in output, so
 * everything the CLI prints (report, its answer, an error) shows each as SESSION_MASK (`unprinted`).
 */
const heldIds = new Set();
/** Registers `id` as a session id that is never printed; returns it. */
const holdId = (id) => { if (typeof id === "string" && id.trim().length >= 6) heldIds.add(id.trim()); return id; };
/** `text` with every held session id shown as SESSION_MASK. */
const unprinted = (text) => { let out = String(text); for (const id of heldIds) out = out.split(id).join(SESSION_MASK); return out; };
const report = (warnings) => { for (const w of warnings) process.stderr.write(`automagik-herdr: ${unprinted(w)}\n`); };

/**
 * Appends one row to the workers ledger (workers.js) with a single O_APPEND write, the file the
 * owner's alone: made 0600, and set to 0600 again before every append (a file made under umask
 * 002 is 0664, and usagemeter refuses a group- or world-writable one; RFC 0021 (f) 6). Before
 * its first write in a run, an app home inside a git work tree (a project's) is kept out of git
 * (keepAppHomeOutOfGit): its rows hold session ids. The terminal runs already, so a failure only
 * comes back as a warning; null when written with nothing to say.
 */
export function appendLedger(row, appHomeDir = appHome()) {
  const path = ledgerPath(appHomeDir);
  const notes = [];
  try {
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    const outOfGit = keepAppHomeOutOfGit(appHomeDir);
    if (outOfGit) notes.push(outOfGit);
    const fd = openSync(path, "a", LEDGER_MODE);
    try {
      try { fchmodSync(fd, LEDGER_MODE); } catch (e) {
        notes.push(`${path} couldn't be made private (chmod 600: ${e?.message ?? e}); usagemeter won't read a ledger others can write`);
      }
      writeSync(fd, ledgerLine(row));
    } finally { closeSync(fd); }
  } catch (e) {
    notes.push(`${row.terminal} runs, but it isn't in ${LEDGER_FILE}, so its usage won't be tied to it: ${e?.message ?? e}`);
  }
  return notes.length ? notes.join("; ") : null;
}

/**
 * Appends an end row unless the ledger already ends that launch (one end row per launch key:
 * restart, --tree and the worktree sweep may each see the same terminal end). A warning, or null.
 */
function appendEnd(row) {
  const key = launchKey(row);
  if (key && workerLedgerRows().some((r) => r?.event === "end" && launchKey(r) === key)) return null;
  return appendLedger(row);
}

/** The app homes keepAppHomeOutOfGit has looked at in this run: each is checked once. */
const outOfGitSeen = new Set();
/**
 * Keeps an app home inside a git work tree (a project's `.herdr/app-home`, RFC 0021 delivery 3)
 * out of git: git runs from the work tree's root, every path relative to it. When git doesn't
 * ignore the app home's workers ledger already, the app home's folder is added to that clone's
 * own exclude file (`git rev-parse --git-path info/exclude`), once (withExclude: a line already
 * there adds nothing), never to .gitignore or any tracked file; an app home that is the work
 * tree's root itself gets only its ledger folder (`/automagik-herdr/`), never the whole tree.
 * A ledger git tracks already can't be excluded: an exclude never untracks a file, so its rows
 * (session ids among them) stay in git until it is untracked. The CLI says so and how, and adds
 * the line anyway so the file stays out once untracked. Not in git, or ignored already: nothing.
 * Looked at once per app home per run. Returns one warning line, or null.
 */
export function keepAppHomeOutOfGit(appHomeDir) {
  const dir = String(appHomeDir).replace(/\/+$/, "");
  if (outOfGitSeen.has(dir)) return null;
  outOfGitSeen.add(dir);
  if (!isDir(dir)) return null;
  const top = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 15_000 });
  if (top.status !== 0 || !top.stdout.trim()) return null; // not in a work tree
  const root = realDir(top.stdout.trim()) ?? top.stdout.trim();
  const real = realDir(dir) ?? dir;
  if (real !== root && !real.startsWith(`${root}/`)) return null;
  // From the root, so every path below is the root's (a path is read against git's cwd).
  const git = (args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 15_000 });
  const rel = real === root ? "" : real.slice(root.length + 1);
  const ledger = `${rel ? `${rel}/` : ""}${LEDGER_FILE}`;
  const line = rel ? `/${rel}/` : `/${LEDGER_FILE.slice(0, LEDGER_FILE.indexOf("/"))}/`;
  const tracked = git(["ls-files", "--error-unmatch", "--", ledger]).status === 0;
  if (!tracked) {
    const ignored = git(["check-ignore", "-q", "--", ledger]);
    if (ignored.status === 0) return null;
    if (ignored.status !== 1) return `git couldn't tell whether ${root} ignores ${dir}: keep it out of your commits (its ledgers hold session ids).`;
  }
  let file = null;
  let added = false;
  let failed = null;
  try {
    const r = git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
    file = r.status === 0 ? r.stdout.trim() : null;
    if (!file) throw new Error((r.stderr || "git failed").trim());
    const after = withExclude(readText(file), line);
    if (after !== null) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, after);
      added = true;
    }
  } catch (e) { failed = e?.message ?? String(e); }
  if (tracked) {
    return `${ledger} is tracked by git in ${root}, and its rows hold session ids: an exclude can't untrack a file, so it stays `
      + `in git until you run git rm --cached ${ledger} there and commit that`
      + (failed ? `; ${line} couldn't be added to ${file ?? "its git exclude file"} (${failed}).`
        : `; ${line} is in ${file}, so it stays out after that.`);
  }
  if (failed) {
    return `${dir} is in ${root}, which doesn't ignore it, and ${line} couldn't be added to ${file ?? "its git exclude file"} `
      + `(${failed}): keep it out of your commits, its ledgers hold session ids.`;
  }
  if (!added) return `${file} lists ${line}, but git still doesn't ignore ${dir} (a later rule takes it back?): keep it out of your commits.`;
  return `${dir} is in ${root}, which didn't ignore it: added ${line} to ${file}, so its session ids stay out of git.`;
}

/** A terminal's foreground pid from `hc get`, or null (hc failing, or no pid yet). */
async function pidOf(terminal) {
  try { const get = await hcGet(terminal); return get?.foreground?.pid ?? get?.pid ?? null; } catch { return null; }
}
/** A terminal's foreground pid and created_ms from one `hc get`: { pid, createdMs }, each null when hc gave none. */
async function launchOf(terminal) {
  let get = null;
  try { get = await hcGet(terminal); } catch { get = null; }
  return { pid: get?.foreground?.pid ?? get?.pid ?? null, createdMs: Number.isSafeInteger(get?.created_ms) ? get.created_ms : null };
}
/** This computer's hc core id for a ledger row, or null when hc server status can't give it (the row is still written). */
const rowCore = () => coreId().catch(() => null);
/**
 * A seat start row's tags (RFC 0021 (f) 3), from `file` at launch and frozen there: its pane
 * role (roleOf), its effective lead (null for the main bot) and its squad (squadOf).
 */
function seatTags(file, botId) {
  if (!file) return { role: null, lead: null, squad: null };
  return { role: roleOf(file, botId), lead: leadIdOf(file, botId) || null, squad: squadOf(file, botId) };
}
/** A fresh Claude launch's session id, chosen here (RFC 0021 (f) 2): a random UUID. */
const newSessionId = () => holdId(randomUUID());

/**
 * Where Herdr shows a bot started here (DESIGN: the space whose folder keys to the project):
 * the `herdr.space` / `herdr.tab` labels of a live terminal on this computer whose folder
 * keys to the project, while the window (herdr-app ls) shows the project in that space: a
 * caller's tab in another space never takes the bot. Else the window's space on the project, in
 * its selected tab. Null when none does; the pane then has no place in Herdr's window. `seen`:
 * windowSpaces(), read once by the caller; null (no window to ask): the first labelled
 * terminal's place.
 */
async function placementOf(key, seen = null) {
  const rows = rowsOf(await hcJson(["ls"])).filter((r) => local(r?.address) && r.state === "live" && typeof r.cwd === "string");
  const keys = new Map();
  await Promise.all([...new Set(rows.map((r) => r.cwd))].map(async (cwd) => {
    try { keys.set(cwd, await keyOf(cwd)); } catch { /* a folder gone: not this project */ }
  }));
  const mine = rows.filter((r) => keys.get(r.cwd) === key);
  const shows = (place) => !seen || spacePlace(seen.spaces.filter((s) => s.id === place.space), seen.keys, key) !== null;
  for (const r of mine) {
    const place = placementFrom([await hcGet(r.address)].filter(Boolean));
    if (place && shows(place)) return place;
  }
  if (seen) return spacePlace(seen.spaces, seen.keys, key);
  return null;
}

/** `herdr-app ls` as State spaces (spacesOf), or null: no herdr-app, no window. */
async function windowRead() {
  const r = await runProgram("herdr-app", ["ls"]);
  try { return r.code === 0 ? spacesOf(JSON.parse(r.stdout)) : null; } catch { return null; }
}

/** `herdr-app ls` as State spaces (spacesOf) and each folder's key, or null: no herdr-app, no window. */
async function windowSpaces() {
  const spaces = await windowRead();
  if (!spaces) return null;
  const keys = new Map();
  await Promise.all([...new Set(spaces.map((s) => s.folder).filter(Boolean))].map(async (f) => {
    try { keys.set(f, await keyOf(f)); } catch { /* a folder gone: not this project */ }
  }));
  return { spaces, keys };
}

/**
 * Where a start with no --space goes: a project terminal's place (placementOf) while the window
 * still shows that space, else a window space on the project, else a new one (herdr-app do
 * space.new, named after the folder). With no window to ask, the terminal's place, or null.
 * `seen`: windowSpaces(), read once per start and shared with placementOf.
 * Two starts at once can each open one: both then use the first space on the project in the
 * window, and the one that opened another closes it (it holds only its new shell).
 */
async function windowPlace(key, labelled = null, seen = null) {
  if (!seen) return labelled;
  if (labelled && seen.spaces.some((s) => s.id === labelled.space)) return labelled;
  // This ls is the check right before space.new: nothing else runs between them.
  const open = spacePlace(seen.spaces, seen.keys, key);
  if (open) return open;
  const name = key.replace(/\/+$/, "").split("/").pop();
  const r = await runProgram("herdr-app", ["do", "space.new", JSON.stringify({ name, folder: key, machine: "" })]);
  if (r.code !== 0) return null;
  let out = {};
  try { out = JSON.parse(r.stdout) ?? {}; } catch { /* the space is found in ls instead */ }
  const now = await windowSpaces();
  const first = now && spacePlace(now.spaces, now.keys, key);
  const ours = now?.spaces.find((s) => s.id === out.space || s.tabs.some((t) => t.panes.some((p) => p.terminal === out.terminal)));
  if (first && ours && ours.id !== first.space) {
    await runProgram("herdr-app", ["do", "space.close", JSON.stringify({ id: ours.id, confirmed: true })]);
  }
  const place = first || (typeof out.space === "string" ? { space: out.space, tab: null, from: null } : null);
  // The space is this start's: its first tab holds only the shell space.new started, closed
  // once the bot shows in a tab of its own there (launchSeat, closeSpare).
  const spare = ours && place?.space === ours.id ? freshSpare(ours, out.terminal) : null;
  return spare ? { ...place, spare } : place;
}

/**
 * How long a start or worker waits for Herdr to show its new pane before its tab setup is left
 * out (AUTOMAGIK_HERDR_TAB_WAIT_MS; 0 turns the setup off: no wait, no tab moved or closed).
 */
const TAB_WAIT_MS = (() => {
  const raw = process.env.AUTOMAGIK_HERDR_TAB_WAIT_MS;
  const ms = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : 5000;
})();
const TAB_STEP_MS = 200;

/**
 * `pgrep <args>` on this computer as pgrep exited: { code, stdout, stderr }, its own; null when
 * it never exited by itself (not run, killed, past its 15 s): what it would have said is unknown.
 */
const pgrepHere = (args) => new Promise((done) => {
  try {
    execFile("pgrep", args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (!err) return done({ code: 0, stdout, stderr });
      done(typeof err.code === "number" ? { code: err.code, stdout: stdout ?? "", stderr: stderr ?? "" } : null);
    });
  } catch { done(null); }
});

/** A terminal id without the machine name a linked machine's may come with (`vm/t5` -> `t5`). */
const bareId = (t) => (typeof t === "string" ? t.slice(t.indexOf("/") + 1) : t);

/**
 * Waits for the window to show `terminal` (a terminal of this computer, or of `machine` in that
 * machine's spaces) in a pane: the window's spaces then, with each tab's `index` (its
 * position, from 1, as tab.move counts) and `terminals` (a machine's as bare ids, bareId), and
 * the space and tab showing it: { spaces, space, tab }. Null when no window answers, or the pane
 * hasn't shown after TAB_WAIT_MS.
 */
async function windowShows(terminal, ms = TAB_WAIT_MS, machine = null) {
  const until = Date.now() + ms;
  const id = machine ? bareId : (t) => t;
  for (;;) {
    const read = await windowRead();
    if (!read) return null;
    const spaces = read.map((s) => ({ ...s, tabs: s.tabs.map((t, i) => ({ ...t, index: i + 1, terminals: t.panes.map((p) => id(p.terminal)),
      count: t.paneCount })) }));
    for (const space of spaces.filter((x) => (machine ? x.machine === machine : !x.machine))) {
      const tab = space.tabs.find((t) => t.terminals.includes(terminal));
      if (tab) return { spaces, space, tab };
    }
    if (Date.now() >= until) return null;
    await later(TAB_STEP_MS);
  }
}

/** `herdr-app do <command> <args>`: null when it ran, else what it said. */
async function windowDo(command, args) {
  const r = await runProgram("herdr-app", ["do", command, JSON.stringify(args)]);
  return r.code === 0 ? null : (r.stderr || r.stdout || `exit ${r.code}`).trim();
}

async function cmdStart(opts, [ref]) {
  if (opts.tab && !opts.space) throw new CliError("--tab needs --space (the space that tab is in).", 2);
  const project = await projectFor(opts);
  const { file, key } = project;
  if (project.text === null) throw new CliError(`No ${BOTS_PATH} in ${key}.`);
  const bot = await botIn(project, ref, opts);
  const why = startRefusal(file, bot.id);
  if (why) throw new CliError(why);
  // launch.js checks the folder Start launches in against the project (attachRefusal on
  // keyOf(projectKey)). Here that folder is `key`, which keyOf already returned, and a key
  // keys to itself, so the check can't refuse: it is left out, not forgotten.
  if (project.machine) return startOnMachine(opts, project, bot);
  // One terminal plays a bot: the one the attach ledger names is reported, never a second
  // start (decided again under the ledger's lock, below, with hc run).
  const view = await attachView();
  // By id alone, whatever the project (the fold binds a bot once per place): a clone's start
  // names the checkout whose pane it is (automagik#227).
  const held = view.live.get(bot.id);
  const elsewhere = held?.binding.project && held.binding.project !== key ? `, for ${held.binding.project}` : "";
  if (held) return opts.json ? { id: bot.id, running: held.binding.terminal } : `${bot.name} is already running in ${held.binding.terminal}${elsewhere}.`;
  const seat = await launchSeat(project, bot, { place: opts.space ? { space: opts.space, tab: opts.tab ?? null, from: null } : undefined });
  if (seat.running) return opts.json ? { id: bot.id, running: seat.running } : `${bot.name} is already running in ${seat.running}.`;
  return opts.json ? seatJson(bot, seat) : seat.terminal;
}

// ---- a bot's pane on a linked machine (automagik#206 part b): start and restart ----

// How long one question to a linked machine may take, in seconds: a login shell runs the person's
// profile, so this bounds it. remoteIo.exec gives hc 10 s over it, so a slow link still brings
// hc's own "timed out" back: ended earlier, hc answers nothing and the machine reads as away.
const AGENT_WAIT_S = 10;

// A start from the sidebar on a Herdr that ends a mod's programs at 30 s (#444): the time that
// limit ends this CLI, ms since the epoch (launch.js machineCli, before its exec, so it counts
// run.sh's node search and node's own startup). Unset (a terminal, a Herdr that takes exec's
// timeout): no deadline. hc's own bound for one call, 15 s, doesn't fit twice in that limit, so
// the calls after the last check get DEADLINE_CALL_MS each: hc run, then at most two more (hc get
// and, with no created_ms, hc kill; or, with no address, hc ls and hc kill), and 1 s for the row
// and the exit: DEADLINE_MARGIN_MS. Checked before a new space is asked for (with
// DEADLINE_PLACE_MS more for windowPlaceOn's calls) and again just before hc run.
const DEADLINE = (() => { const n = Number(process.env.AUTOMAGIK_HERDR_DEADLINE); return Number.isSafeInteger(n) && n > 0 ? n : null; })();
export const DEADLINE_CALL_MS = 5000;
export const DEADLINE_MARGIN_MS = 3 * DEADLINE_CALL_MS + 1000;
export const DEADLINE_PLACE_MS = 4000;
const deadlineLeft = () => (DEADLINE === null ? Infinity : DEADLINE - Date.now());
const callBound = () => (DEADLINE === null ? {} : { timeout: DEADLINE_CALL_MS });
/** A start the deadline stops before it starts anything: why, and the command for a terminal. */
function tooLate(bot, machine, key, need, space = null) {
  const left = Math.max(0, Math.floor(deadlineLeft() / 1000));
  return new CliError(`Only ${left} s of this Herdr's 30 s limit for the sidebar's programs was left, and starting ${bot.name} `
    + `on ${machine} needs ${need / 1000} s to finish once its pane starts, so nothing was started`
    + `${space ? ` (the space it opened, ${space}, stays, with only its shell)` : ""}. `
    + `Start it from a terminal: automagik-herdr start ${shellWord(bot.id)} --project ${shellWord(key)} --machine ${shellWord(machine)}`);
}

const quietOn = (machine, seen) => seen.login === "timed out" ? `${machine}'s login shell didn't answer within ${AGENT_WAIT_S} s`
  : seen.login === false ? `${machine}'s login shell gave no PATH` : null;
const quietWarning = (name, quiet) => (quiet ? [`${quiet}, so ${name} starts with the PATH hc runs programs with there and its user bin folders.`] : []);
const unreachable = (machine, seen) => new CliError(`${machine} can't be reached: ${hcSaid(seen.why)}`);

/** The refusal for a program that isn't on `machine`; `also` (#612): the shipped run, missing too. */
function notInstalledThere(name, program, machine, quiet, also = null) {
  return new CliError(`${name} (${program}) isn't installed on ${machine}, or isn't on the PATH hc runs programs with there, `
    + `its login shell's PATH, ~/.local/bin or ~/.bun/bin${also ? `; its shipped run (${also}) isn't either` : ""}${quiet ? ` (${quiet})` : ""}.`);
}

/** The refusal for a program on `machine` whose #! interpreter a pane there couldn't run. */
function noInterpreterThere(name, seen, machine, quiet) {
  return new CliError(`${name} (${seen.file}) runs under ${seen.interpreter}, which isn't on the PATH a pane on ${machine} gets; `
    + `it would fail with "env: ${seen.interpreter}: No such file or directory". Put ${seen.interpreter} on the PATH of ${machine}'s login shell${quiet ? ` (${quiet})` : ""}.`);
}

/**
 * #612: `{ run: shipped, tail }` when `command` starts with the table's run (`run`: this
 * computer's programs.json override) whose first word differs from Herdr's shipped run for the
 * same agent key, `tail` the command's words after the override (its model and resume words);
 * null when there is no shipped run to fall back to, or the command isn't built from the table.
 */
function shippedRunFor(agentKey, run, command) {
  const shipped = AGENTS[agentKey]?.run;
  if (!shipped?.length || !run?.length || shipped[0] === run[0]) return null;
  if (command.length < run.length || run.some((word, i) => command[i] !== word)) return null;
  return { run: shipped, tail: command.slice(run.length) };
}

/**
 * The agent `argv` starts, looked for on `machine` under the PATH its pane will get
 * (agentOnMachine: the login shell's, asked once, plus hc's, hc's first when it finds the agent,
 * and the user bin folders; `prepend`'s folders first, a project's pane-env PATH_PREPEND), so a
 * check that passes is a launch that finds it: refused when it
 * isn't there, when the interpreter its #! line names isn't, or when the machine doesn't answer.
 * `shipped` (#612, shippedRunFor): when the table's override isn't there but the shipped run is,
 * that run and `tail` replace the command, with one warning naming the agent and the skipped
 * override's first word; when neither is there the refusal names both. Resolves
 * { path, argv, warnings }: the PATH seatOnMachine starts it with and the command it starts.
 */
async function agentThere(machine, argv, name, prepend = null, shipped = null) {
  const exec = (command, args, opts) => remoteIo.exec(command, args, machine, opts);
  const seen = await agentOnMachine(exec, argv[0], { wait: AGENT_WAIT_S, prepend });
  const quiet = quietOn(machine, seen);
  if (seen.state === "away") throw unreachable(machine, seen);
  if (seen.state === "missing" && shipped) {
    const alt = await agentOnMachine(exec, shipped.run[0], { wait: AGENT_WAIT_S, prepend });
    const altQuiet = quietOn(machine, alt);
    if (alt.state === "away") throw unreachable(machine, alt);
    if (alt.state === "found") {
      return { path: alt.path, argv: [...shipped.run, ...shipped.tail],
        warnings: [`${name} starts on ${machine} from its shipped run (${shipped.run[0]}), skipping the `
          + `programs.json override here (${argv[0]}), which isn't installed there.`, ...quietWarning(name, altQuiet)] };
    }
    if (alt.state === "no-interpreter") throw noInterpreterThere(name, alt, machine, altQuiet);
    throw notInstalledThere(name, argv[0], machine, altQuiet, shipped.run[0]);
  }
  if (seen.state === "missing") throw notInstalledThere(name, argv[0], machine, quiet);
  if (seen.state === "no-interpreter") throw noInterpreterThere(name, seen, machine, quiet);
  return { path: seen.path, argv, warnings: quietWarning(name, quiet) };
}

/**
 * The hc guard folder beside `automagik-herdr` on `path`, that machine's pane PATH (#624): the
 * pack's or am's `bin/../guard`, with hcGuard.mjs beside it. Resolves `{ dir, why }`: `dir` is
 * null when that machine has no automagik-herdr there, the probe could not run, or the folder
 * a PATH word cannot carry (#643), and `why` says which. A remote dsh-tui seat then gets no
 * guard, and no briefing paragraph claiming one.
 */
const GUARD_PROBE_SH = `PATH=$1; export PATH
p=$(command -v automagik-herdr 2>/dev/null) || exit 4
case $p in /*) ;; *) exit 4 ;; esac
while [ -L "$p" ]; do
  to=$(readlink "$p") || exit 5
  case $to in /*) p=$to ;; *) p=$(dirname "$p")/$to ;; esac
done
dir=$(cd "$(dirname "$p")" && pwd -P) || exit 5
guard=$dir/../guard
[ -x "$guard/hc" ] && [ -f "$dir/../hcGuard.mjs" ] || exit 4
cd "$guard" && pwd -P`;
async function guardThere(machine, path) {
  if (typeof path !== "string" || !path) return { dir: null, why: "it gave no pane PATH to probe" };
  const r = await remoteIo.exec("sh", ["-c", GUARD_PROBE_SH, "sh", path], machine, { timeout: AGENT_WAIT_S });
  if (r.code === -1) {
    return { dir: null, why: `its guard probe could not run there (${hcSaid(r.stderr) || "no answer"})` };
  }
  if (r.code === 4) {
    return { dir: null, why: "no automagik-herdr with guard/hc and hcGuard.mjs beside it was found on its pane PATH" };
  }
  if (r.code !== 0) {
    return { dir: null, why: `its guard probe failed there (${hcSaid(r.stderr) || `exit ${r.code}`})` };
  }
  const dir = r.stdout.trim();
  // A guard folder goes into one PATH word: an absolute path with no control character, space
  // or colon. #643 refuses the rest rather than break the word.
  // eslint-disable-next-line no-control-regex
  if (!dir.startsWith("/") || /[\x00-\x1f\x7f]/.test(dir)) {
    return { dir: null, why: "its guard probe named no usable absolute folder" };
  }
  if (/[ :]/.test(dir)) {
    return { dir: null, why: `the guard folder it found there (${dir}) has a space or a colon, so it cannot go on PATH` };
  }
  return { dir, why: null };
}

/**
 * A project's pane-env on `machine` (agentPath.mjs paneEnvOf: PATH_PREPEND, HERDR_APP_HOME), read
 * there through hc: { prepend, appHome, refused, warnings }. No file: nothing, so the start is as
 * before #582. A file it refuses, or one that can't be read, is one warning, `refused` and nothing
 * else: the start goes on, and briefingHomeOn then uses no app home there at all.
 */
async function paneEnvOn(machine, key) {
  const path = under(key, PANE_ENV_PATH);
  const none = (why) => ({ prepend: null, appHome: null, refused: true,
    warnings: [`${path} on ${machine} was left out (${why}): the pane starts as it would without it.`] });
  let text;
  try { text = await readRemoteText(remoteIo, machine, path); } catch (e) { return none(e?.message ?? String(e)); }
  const env = paneEnvOf(text);
  return env.error ? none(env.error) : { prepend: env.prepend, appHome: env.appHome, refused: false, warnings: [] };
}

/** That machine's default app home, ~/.config/herdr-app by its own $HOME, or null when it gives none. */
async function appHomeOn(machine) {
  const r = await remoteIo.exec("sh", ["-c", 'printf %s "$HOME"'], machine, { timeout: AGENT_WAIT_S });
  const home = r.code === 0 ? r.stdout : "";
  // eslint-disable-next-line no-control-regex
  return home.startsWith("/") && !/[\x00-\x1f\x7f]/.test(home) ? `${home.replace(/\/+$/, "")}/.config/herdr-app` : null;
}

/**
 * The app home on `machine` a launch's private file goes in (#582, #823): pane-env's
 * HERDR_APP_HOME, else that machine's ~/.config/herdr-app, and only while that folder is there
 * already: a start never makes an app home on a linked machine (it may be a shared one). A
 * pane-env that was left out means none at all, never the default. Resolves { dir (null: none),
 * warning (why, null when dir) }.
 */
async function launchHomeOn(machine, bot, paneEnv, purpose) {
  const none = (why) => ({ dir: null, warning: `${bot.name} runs on ${machine} without ${purpose}: ${why}` });
  if (paneEnv.refused) return none(`its ${PANE_ENV_PATH} there was left out, so no app home there is used, not even the default one`);
  const dir = paneEnv.appHome ?? await appHomeOn(machine);
  if (!dir) return none(`${machine} gave no home folder for its app home`);
  if ((await remoteIo.exec("test", ["-d", dir], machine, { timeout: AGENT_WAIT_S })).code !== 0) {
    return none(`its app home there, ${dir}, isn't a folder, and a start never makes one. Install automagik-herdr on ${machine}, `
      + `or set HERDR_APP_HOME in the project's ${PANE_ENV_PATH} there to an app home that is there`);
  }
  return { dir, warning: null };
}

/** launchHomeOn for the briefing (#582): { dir (null: no briefing file and no hook there), warnings (one when null) }. */
async function briefingHomeOn(machine, bot, paneEnv) {
  const home = await launchHomeOn(machine, bot, paneEnv, "its briefing in its system prompt or per turn");
  if (home.dir) return { dir: home.dir, warnings: [] };
  return { dir: null, warnings: [`${home.warning}. Its role and team still come from ${BOTS_PATH}.`] };
}

// A file of the pack's own on `machine` (a briefing), private as briefedLaunch's (0600 in a 0700
// folder). A new one is made under umask 077 with noclobber, so a file that appeared since the read
// is never replaced; one already there is edited by remoteFile.js's compare-and-swap and set to
// 0600 (no "--": BSD chmod reads it as a file after the mode; the path is absolute). Only ever
// under an app home that is there (briefingHomeOn); remoteFile.js's own create is
// left as it is for bots.json.
const PRIVATE_CREATE_SH = 'umask 077; p=$1; mkdir -p -- "${p%/*}" || exit 1; '
  + 'if [ -e "$p" ] || [ -L "$p" ]; then exit 17; fi; set -C; '
  + '{ : > "$p"; } 2>/dev/null || exit 1; '
  + 'printf "%s" "$2" >| "$p" || { rm -f -- "$p"; exit 1; }';
async function ownFileOn(machine, path, text) {
  if (utf8Length(text) > REMOTE_TEXT_MAX) throw new Error(`over ${REMOTE_TEXT_MAX / 1024} KiB, too large to send there`);
  const before = await readRemoteText(remoteIo, machine, path);
  const said = (r) => hcSaid((r.stderr || r.stdout).trim()) || `exit ${r.code}`;
  if (before === null) {
    const r = await remoteIo.exec("sh", ["-c", PRIVATE_CREATE_SH, "sh", path, text], machine, { timeout: AGENT_WAIT_S });
    if (r.code === 17) throw new Error("it appeared there since it was read");
    if (r.code !== 0) throw new Error(`couldn't create it: ${said(r)}`);
    return;
  }
  if (before !== text) await writeRemoteText(remoteIo, machine, path, text, before);
  const r = await remoteIo.exec("chmod", ["600", path], machine, { timeout: AGENT_WAIT_S });
  if (r.code !== 0) throw new Error(`couldn't make it private (chmod 600): ${said(r)}`);
}

/**
 * briefedLaunch on a linked machine (#582): `argv` with the bot's launch briefing put in as the
 * agent takes it (models.js BRIEFING: its file, its text or its environment), a file written on
 * `machine` through hc under `boxHome`, that machine's app home (briefingHomeOn's; null: no file,
 * that warning said why). An agent whose briefing yields
 * to its own config file (BRIEFING's ownConfig: codex, hermes) starts as it is, since only this
 * computer's config is read. Never throws: { argv, env, warnings }.
 */
async function briefedOn(machine, project, bot, agentKey, argv, boxHome, guard = null) {
  const way = briefingWay(agentKey);
  const agents = agentTable();
  if (!way || briefingOwnConfig(agentKey) || agentKeyOfArgv(argv, agents) !== agentKey) return { argv, env: {}, warnings: [] };
  const text = launchBriefingText({ self: bot, file: project.file, guard, isGit: await projectIsGit(project) });
  const warnings = [];
  let launch = null;
  if (way === "file") {
    const path = boxHome ? briefingFilePath(boxHome, project.key, bot.id) : null;
    try {
      if (path) {
        await ownFileOn(machine, path, `${text}\n`);
        launch = briefingLaunch(agentKey, { path });
      }
    } catch (e) {
      warnings.push(`${bot.name} starts on ${machine} without its briefing in its system prompt (${path}: ${e?.message ?? e}).`);
    }
  } else {
    launch = briefingLaunch(agentKey, { text });
  }
  return { argv: withBriefing(agentKey, argv, launch, agents), env: launch?.env ?? {}, warnings };
}

// installHook's io on a linked machine: git and the files there, through hc (remoteFile.js).
const hookIoOn = (machine) => ({
  git: (args, cwd) => remoteIo.exec("git", args, machine, { cwd, timeout: AGENT_WAIT_S }),
  read: (path) => readRemoteText(remoteIo, machine, path),
  write: (path, text, before) => writeRemoteText(remoteIo, machine, path, text, before),
  mkdir: async () => {}, // writeRemoteText's create makes the folders there (mkdir -p)
});

/**
 * writeBriefingHook on a linked machine (#582): the per-turn hook in `folder`'s
 * .claude/settings.local.json there, running the briefing entry under `boxHome`, that machine's
 * app home. No entry there (the pack isn't installed on it): nothing written, and noHookThere's
 * warning. Never throws: { written, warnings }.
 */
async function briefingHookOn(machine, bot, folder, boxHome) {
  const io = hookIoOn(machine);
  let entry = null;
  try { entry = boxHome ? await io.read(stableBriefingPath(boxHome)) : null; } catch { entry = null; }
  if (entry === null) return { written: false, warnings: [noHookThere(bot, machine)] };
  return installHook(bot.name, folder, boxHome, io);
}

/**
 * Where a start on `machine` goes in Herdr's window: a space of that machine showing the
 * project (its folder, or one keying to it there), else a new one (space.new on that machine),
 * with its `spare` shell (freshSpare, its terminal as a bare id) for closeSpare once the bot
 * shows there; null with no window to ask.
 */
async function windowPlaceOn(machine, key) {
  const find = async () => {
    const r = await runProgram("herdr-app", ["ls"]);
    let spaces;
    try { spaces = r.code === 0 ? spacesOf(JSON.parse(r.stdout)) : null; } catch { spaces = null; }
    if (!spaces) return { spaces: null, hit: null };
    for (const s of spaces.filter((x) => x.machine === machine && x.folder)) {
      let k = s.folder === key ? key : null;
      if (!k) { try { k = (await remoteProjectOf(machine, s.folder)).key; } catch { k = null; } }
      if (k === key) return { spaces, hit: { space: s.id, tab: s.tabs?.find((t) => t.selected)?.id ?? null, from: null } };
    }
    return { spaces, hit: null };
  };
  const seen = await find();
  if (!seen.spaces) return null;
  if (seen.hit) return seen.hit;
  const name = key.replace(/\/+$/, "").split("/").pop();
  const r = await runProgram("herdr-app", ["do", "space.new", JSON.stringify({ name, folder: key, machine })]);
  if (r.code !== 0) return null;
  let out = {};
  try { out = JSON.parse(r.stdout) ?? {}; } catch { /* found in ls instead */ }
  const now = await find();
  const place = now.hit ?? (typeof out.space === "string" ? { space: out.space, tab: null, from: null } : null);
  // The space is this start's when it is the one found: its shell's tab, as windowPlace's.
  const shell = typeof out.terminal === "string" ? bareId(out.terminal) : null;
  const ours = shell && now.spaces?.find((s) => s.id === place?.space && s.machine === machine
    && (s.id === out.space || s.tabs.some((t) => t.panes.some((p) => bareId(p.terminal) === shell))));
  const spare = ours ? freshSpare(ours, shell, (a, b) => bareId(a) === b) : null;
  return spare ? { ...place, spare } : place;
}

/**
 * A bot's pane on the project's linked machine: `hc run --on` with Start's labels and the PATH
 * agentThere checked the agent under (the project's pane-env PATH_PREPEND first), as /usr/bin/env
 * PATH=<it>, and HERDR_APP_HOME=<pane-env's> when it sets one (hc run has no --env; --no-parent: no
 * lead as its hc parent there yet, and never the calling terminal), placed in the window on that machine's space. `over`: argv, cwd, place (the old
 * pane's, a restart), carry (labels kept), replacing (a restart: no "already running" check
 * and no attach row here; restartOnMachine writes them once the new pane is up). The briefing is
 * the local start's (#582): in the command (briefedOn) and, for an agent that takes it, the
 * per-turn hook in that project there (briefingHookOn), both in that machine's app home. Never
 * sends keys to any pane. Resolves { address, terminal (bare), created_ms, machine, core, argv,
 * labels, place, hookWritten, warnings }, or
 * { running } when the ledger names a pane for the bot by the time its lock is taken.
 */
async function seatOnMachine(project, bot, over = {}) {
  const { file, key, machine } = project;
  await checkLinkedProxy(project, bot, over.agent ?? bot.agent);
  const m = await connectedMachine(machine, "nothing was started");
  const agentKey = over.agent ?? bot.agent;
  const agent = agentTable()[agentKey];
  if (!agent?.run?.length) throw new CliError(`${bot.name}'s coding agent "${agentKey}" isn't one Herdr can start.`);
  // Antigravity's mode: validated even when over.argv (a restart's plan) already carries it.
  const agyMode = launchAgyMode(bot, agentKey);
  if (!over.argv && bot.model && !modelList(bot.agent, bot.model).includes(bot.model)) {
    throw new CliError(`${bot.name} is pinned to "${bot.model}", which isn't a ${bot.agent} model this computer lists. `
      + `Pick one with automagik-herdr edit ${bot.id} --model <model> --machine ${machine} --project ${key}, or clear it with --no-model.`);
  }
  const paneEnv = await paneEnvOn(machine, key);
  // #823: agy reads its permission list from a file on its own machine, under that machine's
  // app home; with none there the start is refused rather than launched without its list.
  let agySettings = null;
  if (agentKey === "antigravity") {
    const agyHome = await launchHomeOn(machine, bot, paneEnv, "its Antigravity permission list");
    if (!agyHome.dir) throw new CliError(`${agyHome.warning}. Nothing was started.`);
    agySettings = agySettingsPlan({ bot, scope: "seat", folder: key, settingsDir: agySettingsDir(agyHome.dir) });
    try { await ownFileOn(machine, agySettings.path, agySettings.text); }
    catch (e) {
      throw new CliError(`${bot.name} wasn't started on ${machine}: its Antigravity permission list couldn't be written `
        + `(${agySettings.path}: ${e?.message ?? e}).`);
    }
  }
  // Herdr's table as this computer has it (programs.json applied): the Mac builds the command.
  const command = withAgySettings(agentKey, over.argv ?? [...agent.run, ...agyModeArgs(agentKey, agyMode), ...modelArgs(bot.agent, bot.model)],
    agySettings?.path);
  // #612: a local absolute override that isn't there falls back to the shipped run when that is.
  const there = await agentThere(machine, command, agent.name ?? agentKey, paneEnv.prepend,
    shippedRunFor(agentKey, agent.run, command));
  // A remote dsh-tui seat gets the guard its own machine has, resolved there (#624); with none,
  // no guard on PATH and no briefing paragraph claiming one, and one warning says what the
  // probe found: no guard, a failed probe, or a folder a PATH word cannot carry (#643).
  const remote = agentKey === "dsh-tui" ? await guardThere(machine, there.path) : null;
  const remoteGuard = remote?.dir ?? null;
  const guardWarnings = agentKey === "dsh-tui" && !remoteGuard
    ? [`${bot.name} runs on ${machine} without the hc guard (#624): ${remote?.why ?? "its guard was not found"}; `
      + `its hc calls are not guarded.`]
    : [];
  // The briefing there, as a local start has it (#582), in that machine's app home while it is
  // there (briefingHomeOn: asked only when a file or the hook needs one; never made).
  const needsHome = !briefingOwnConfig(agentKey) && (briefingWay(agentKey) === "file" || briefingHook(agentKey));
  const home = needsHome ? await briefingHomeOn(machine, bot, paneEnv) : { dir: null, warnings: [] };
  const briefed = await briefedOn(machine, project, bot, agentKey, there.argv, home.dir,
    agentKey === "dsh-tui" ? Boolean(remoteGuard) : null);
  const argv = briefed.argv;
  // The hook goes in before the session starts, so Claude Code reads it at startup.
  const hook = briefingHook(agentKey) && home.dir ? await briefingHookOn(machine, bot, over.cwd ?? key, home.dir)
    : { written: false, warnings: [] };
  const env = { ...(paneEnv.appHome ? { HERDR_APP_HOME: paneEnv.appHome } : {}), ...briefed.env };
  const carry = over.carry ?? {};
  const labels = { ...paneLabels(file, bot.id, carry, null), ...carry };
  const taken = new Set(rowsOf(await hcJson(["ls"])).map((r) => r?.name).filter(Boolean));
  // A start: that space only, the bot in a tab of its own (as launchSeat).
  if (over.place === undefined && deadlineLeft() < DEADLINE_MARGIN_MS + DEADLINE_PLACE_MS) {
    throw tooLate(bot, machine, key, DEADLINE_MARGIN_MS + DEADLINE_PLACE_MS);
  }
  const place = over.place !== undefined ? over.place : spaceOnly(await windowPlaceOn(machine, key));
  const name = hcName(bot.name, bot.id, taken);
  const args = startArgs({ botId: bot.id, name, cwd: over.cwd ?? key, space: place?.space, tab: place?.tab,
    // No hc parent: hc run's default is the terminal it is started from, and the pane would end with it.
    parent: ["--no-parent"], argv, labels, path: there.path, env, agent: agentKey, guard: remoteGuard });
  args.splice(1, 0, "--on", machine);
  const warnings = [...paneEnv.warnings, ...there.warnings, ...guardWarnings, ...home.warnings, ...briefed.warnings, ...hook.warnings,
    ...(agySettings?.warnings ?? [])];
  const run = async () => {
    if (deadlineLeft() < DEADLINE_MARGIN_MS) throw tooLate(bot, machine, key, DEADLINE_MARGIN_MS, place?.spare ? place.space : null);
    const r = await hc(args, callBound());
    // Ended at its bound, hc run may still have started the pane there: looked for by name below.
    if (r.code !== 0 && !r.killed) throw new CliError(`hc run on ${machine} failed: ${hcSaid((r.stderr || r.stdout).trim())}`);
    let address = null;
    try { address = r.killed ? null : JSON.parse(r.stdout).address ?? null; } catch { address = null; }
    if (typeof address !== "string" || !address.includes("/")) {
      // It may run anyway: found by the name it was given (hc ls) and ended, never left beside the bot's pane.
      let stray = null;
      try { stray = rowsOf(parsed(await hc(["ls", "--json"], callBound()), ["ls"])).find((x) => x?.name === name && String(x.address ?? "").startsWith(`${machine}/`))?.address ?? null; } catch { stray = null; }
      const killed = stray ? (await hc(["kill", stray], callBound())).code === 0 : false;
      const said = r.killed ? `didn't answer within ${(DEADLINE === null ? 15000 : DEADLINE_CALL_MS) / 1000} s` : `gave no terminal address (${r.stdout.trim() || "nothing"})`;
      throw new CliError(`hc run on ${machine} ${said}; `
        + (killed ? `the pane it started (${stray}, named ${name}) was ended.` : `if a pane named ${name} started there, end it with hc kill.`));
    }
    const get = await hcGet(address, callBound()).catch(() => null);
    if (!Number.isSafeInteger(get?.created_ms)) {
      // No created_ms: no row can name it, so it isn't left running beside the bot's pane.
      const killed = (await hc(["kill", address], callBound())).code === 0;
      throw new CliError(`${address} started, but hc get gave no created_ms, so it could have no attach row; `
        + (killed ? "it was ended." : `it couldn't be ended: end it with hc kill ${address}.`));
    }
    return { address, terminal: address.slice(address.indexOf("/") + 1), created_ms: get.created_ms, machine, core: m.id, argv, labels, place,
      hookWritten: hook.written, warnings };
  };
  if (over.replacing) return run();
  const seat = await underLedger(async ({ machines, heldBy, holds, write }) => {
    const mine = await holds(heldBy(bot.id, m.id));
    if (mine && mine.binding.project === key) return { running: addressOf(mine.binding, machines) };
    const seat = await run();
    try {
      write([attachRow({ event: "attach", bot: bot.id, project: key, terminal: seat.terminal, core: m.id, created_ms: seat.created_ms, machine, by: "start" })]);
    } catch (e) {
      throw new CliError(`${seat.address} runs, but its attach row wasn't written (${e?.message ?? e}): attach it with `
        + `automagik-herdr attach ${bot.id} ${seat.address} --machine ${machine} --project ${key}`);
    }
    return seat;
  });
  // A space this start made: its spare shell's tab closed once the bot shows there (closeSpare).
  if (!seat.running && place?.spare && TAB_WAIT_MS > 0) {
    // Under a deadline its waits (TAB_WAIT_MS, then four calls) don't fit: the tab stays, said.
    const why = DEADLINE !== null ? `The new space's spare shell tab wasn't closed: this Herdr's 30 s limit for the sidebar's programs leaves no time for it.`
      : await closeSpare(place.spare, seat.terminal, machine);
    if (why) seat.warnings.push(why);
  }
  return seat;
}

const seatOnJson = (bot, seat) => ({ id: bot.id, terminal: seat.terminal, machine: seat.machine,
  argv: maskedArgv(seat.argv, seat.labels?.[SESSION_LABEL] ?? null), labels: maskedLabels(seat.labels),
  space: seat.place?.space ?? null, tab: seat.place?.tab ?? null, hookWritten: seat.hookWritten ?? false, warnings: seat.warnings });

/** start --machine: the bot's pane there (seatOnMachine); one that runs already is reported. */
async function startOnMachine(opts, project, bot) {
  await connectedMachine(project.machine, "nothing was started");
  const view = await attachView();
  const held = liveFor(view, bot.id, project);
  if (held) {
    const at = addressOf(held.binding, view.machines);
    return opts.json ? { id: bot.id, running: held.binding.terminal, machine: held.binding.machine } : `${bot.name} is already running in ${at}.`;
  }
  if (unknownFor(view, bot.id, project)) {
    const b = unknownFor(view, bot.id, project);
    throw new CliError(`${bot.name}'s pane on ${b.machine} (${b.terminal}) can't be checked: ${b.machine} isn't answering. Nothing was started.`);
  }
  if (opts.space) throw new CliError("--space and --tab are this computer's window places; a start on a linked machine finds its own.", 2);
  const seat = await seatOnMachine(project, bot);
  if (seat.running) return opts.json ? { id: bot.id, running: seat.running } : `${bot.name} is already running in ${seat.running}.`;
  report(seat.warnings);
  return opts.json ? seatOnJson(bot, seat) : seat.address;
}

/**
 * restart --machine: cmdRestart's rule on the project's linked machine, without --tree (cmdRestart
 * refuses it there, #437). The old pane must say whether its agent is busy: one that reports no
 * status to hc (Hermes) is refused unless --force, as is a busy one or one with helpers. The new pane starts in the old one's place and
 * folder, resuming as restartPlan says (an agent's own --continue resumes the folder's latest
 * conversation: refused while another bot's same agent runs in that folder there); the old
 * pane is ended (hc kill) only once the new one has kept its agent in front. No keys are sent.
 */
async function restartOnMachine(opts, project, bot, entry) {
  if (opts.space) throw new CliError("--space and --tab are this computer's window places; a restart on a linked machine keeps the old pane's.", 2);
  const { file, key, machine } = project;
  await checkLinkedProxy(project, bot, opts.agent ?? bot.agent, () => {});
  const m = await connectedMachine(machine, "nothing was restarted");
  const view = await attachView();
  const held = liveFor(view, bot.id, project);
  if (!held && unknownFor(view, bot.id, project)) {
    throw new CliError(`${bot.name}'s pane on ${machine} can't be checked: ${machine} isn't answering. Nothing was restarted.`);
  }
  const old = held ? { ...held.get, address: addressOf(held.binding, view.machines) } : null;
  if (old) {
    const refusal = restartRefusal({ name: bot.name, old, helpers: await helpersOf(old.address), force: opts.force, onMachine: true });
    if (refusal) throw busyRefusal(refusal, old);
    if (!old.status && !opts.force) {
      throw new CliError(`${old.address} doesn't tell hc whether ${bot.name}'s agent is busy or waiting for an approval, so a restart `
        + `could end it mid-turn. Nothing was restarted. Look at the pane first, then pass --force to restart anyway `
        + `(it sends the pane no keys: it starts a new pane, then ends this one).`);
    }
  }
  const agentKey = entry?.agent ?? bot.agent;
  const run = agentTable()[agentKey]?.run;
  if (!run?.length) throw new CliError(`${bot.name}'s coding agent "${agentKey}" isn't one Herdr can start.`);
  // The old pane's agent.session label, as restartPlan reads it for the agent.
  const label = old?.labels?.[SESSION_LABEL] ?? null;
  for (const k of ["agent.session", "revive.session"]) holdId(old?.labels?.[k]);
  // The old pane's launch, only to say when it differs from what the source launches now (#597).
  const oldLaunch = old ? paneCommand(old) : null;
  const planned = {
    bot, run, runningAgent: old ? agentKeyOfArgv(unwrapKeep(old.foreground?.argv), agentTable()) : null, session: label,
    fresh: opts.fresh || !old, agent: entry ? entry.agent : undefined, model: entry ? (entry.model ?? "") : undefined,
  };
  let plan = restartPlan(planned);
  let cwd = key;
  const oldCwd = old?.foreground?.cwd ?? old?.cwd ?? null;
  if (oldCwd && oldCwd !== key) { try { if ((await remoteProjectOf(machine, oldCwd)).key === key) cwd = oldCwd; } catch { /* the project's */ } }
  // A session counts only when the command really resumes it by id (--resume <id> in its argv).
  let session = plan.mode === "resume" && plan.resume[0] === "--resume" && plan.argv.includes(plan.resume[1]) ? plan.resume[1] : null;
  // #598: dsh-tui's id-less -c only once a turn has finished in the old pane (hc's turn counter;
  // missing or unreadable is 0): else a new conversation, and why, in --json's warnings too (F3).
  let turnNote = null;
  if (plan.mode === "resume" && !session && resumeAfterTurn(plan.agent) && !(Number.isSafeInteger(old?.turn) && old.turn >= 1)) {
    const note = noTurnNote(agentTable(), plan.agent, old);
    plan = { ...restartPlan({ ...planned, fresh: true }), note };
    turnNote = `${bot.name} starts on a new conversation: ${note}.`;
  }
  // With no session id, a resume takes the workspace's latest conversation, which may be one
  // someone started there by hand: refused unless --force, and even then while any other live
  // pane on that machine runs the same agent in that folder (bot or not: hc ls, not the ledger).
  if (plan.mode === "resume" && !session) {
    if (!opts.force) {
      throw new CliError(`${old.address} carries no session id, so ${plan.agent} would resume the latest conversation in ${cwd}, `
        + `which may not be ${bot.name}'s (one started there by hand, say). Nothing was restarted. Restart with --fresh for a new `
        + `conversation, or pass --force to resume the latest one.`);
    }
    const rows = rowsOf(await hcJson(["ls"])).filter((r) => typeof r?.address === "string" && r.address.startsWith(`${machine}/`)
      && r.address !== old.address && r.state === "live");
    const gets = (await Promise.all(rows.map((r) => hcGet(r.address).catch(() => null)))).filter(Boolean);
    const sharers = gets.filter((g) => (g.foreground?.cwd ?? g.cwd) === cwd && agentKeyOfArgv(unwrapKeep(g.foreground?.argv), agentTable()) === plan.agent)
      .map((g) => ({ address: g.address, name: file.bots.find((b) => b.id === g.labels?.[BOT_LABEL])?.name ?? "a pane" }));
    const refusal = continueRefusal({ name: bot.name, old, cwd, sharers, agent: agentTable()[plan.agent]?.name ?? plan.agent });
    if (refusal) throw new CliError(refusal);
  }
  let seat = await seatOnMachine(project, bot, { agent: plan.agent, argv: plan.argv, cwd, place: old ? placementFrom([old]) : undefined,
    carry: { ...carriedLabels(old), ...(session ? { [SESSION_LABEL]: session } : {}) }, replacing: Boolean(old) });
  if (seat.running) return opts.json ? { id: bot.id, running: seat.running } : `${bot.name} is already running in ${seat.running}.`;
  const warnings = [...(turnNote ? [turnNote] : []), ...seat.warnings];
  // #597: the replacement is built from bots.json, never the pane's command; when they differ,
  // one line names only flag names, values masked, and a template by name. A linked machine's
  // templates aren't read here, so a template pane is named rather than resolved.
  if (oldLaunch && !entry && (planned.runningAgent === null || planned.runningAgent === plan.agent)) {
    const template = typeof old?.template === "string" && old.template.trim() ? { name: old.template.trim() } : null;
    const changed = launchChange({ name: bot.name, launch: oldLaunch, agent: plan.agent, argv: plan.source, template });
    if (changed) warnings.push(changed);
  }
  report(warnings);
  if (old) {
    let up = await agentUp(seat.address);
    // Codex can't resume the thread at all (#413): one new pane on a new thread, as cmdRestart does.
    const gone = up.state === "ended" ? await endedCause(seat.address) : null;
    if (providerGone(plan, gone)) {
      const thread = plan.resume[0] === "resume" && plan.resume[1] && plan.resume[1] !== "--last" ? plan.resume[1] : null;
      const note = providerGoneNote(thread, seat.address, gone);
      plan = { ...restartPlan({ ...planned, fresh: true }), note };
      session = null;
      warnings.push(`${bot.name} starts on a new conversation: ${note}.`);
      report([warnings.at(-1)]);
      const again = await seatOnMachine(project, bot, { agent: plan.agent, argv: plan.argv, cwd, place: placementFrom([old]), carry: carriedLabels(old), replacing: true });
      if (again.running) throw new CliError(`${bot.name} is running in ${again.running} now, so no new pane was started; ${old.address} still runs it, untouched.`);
      warnings.push(...again.warnings);
      report(again.warnings);
      seat = again;
      up = await agentUp(seat.address);
    }
    if (up.state !== "live") {
      if (up.state === "ended") {
        throw await exitedBefore(seat.address, `${old.address} still runs ${bot.name}, untouched.`
          + (plan.mode === "resume" ? ` Try automagik-herdr restart ${bot.id} --machine ${machine} --project ${key} --fresh.` : ""));
      }
      const ended = (await hc(["kill", seat.address])).code === 0;
      throw new CliError(`${seat.address} didn't keep an agent in front within ${RESTART_WAIT_MS / 1000}s${ended ? ", so it was ended" : ` and couldn't be ended (hc kill ${seat.address})`}; `
          + `${old.address} still runs ${bot.name}, untouched.`);
    }
    const created = Number.isSafeInteger(up.get?.created_ms) ? up.get.created_ms : seat.created_ms;
    let lost;
    try {
      lost = await underLedger(async ({ machines, heldBy, holds, write }) => {
        const now = heldBy(bot.id, m.id);
        const rows = [];
        if (now && attachKey(now) === attachKey(held.binding)) rows.push(closingRow(held.binding, "detach", "start", "moved"));
        else if (now && now.project !== key) return addressOf(now, machines);
        else if (now && (await holds(now))) return addressOf(now, machines);
        rows.push(attachRow({ event: "attach", bot: bot.id, project: key, terminal: seat.terminal, core: seat.core, created_ms: created, machine, by: "start" }));
        write(rows);
        return undefined;
      });
    } catch (e) {
      await hc(["kill", seat.address]);
      throw new CliError(`${seat.address} was ended and ${old.address} still runs ${bot.name}: the attach ledger wasn't written (${e?.message ?? e}).`);
    }
    if (lost !== undefined) {
      await hc(["kill", seat.address]);
      throw new CliError(`${bot.name} was attached to ${lost} while it restarted, so ${seat.address} was ended and nothing changed.`);
    }
    // The old pane is the one the ledger moved from, never a terminal id reused there since.
    const before = await hcGet(old.address).catch(() => null);
    if (before && before.created_ms !== held.binding.created_ms) {
      const w = `${old.address} is another terminal now (its created_ms changed), so it wasn't ended; ${seat.address} plays ${bot.name}.`;
      warnings.push(w); report([w]);
    } else if (before) {
    const killed = await hc(["kill", old.address]);
    if (killed.code !== 0) { const w = `${old.address} wasn't ended (hc kill: ${hcSaid((killed.stderr || killed.stdout).trim())}); end it with hc kill ${old.address}.`; warnings.push(w); report([w]); }
    }
  }
  let saved = false;
  if (opts.save) {
    const now = await loadRemoteProject(key, machine);
    const stored = now.raw.bots.find((b) => b?.id === bot.id);
    if (stored) { await saveProject(now, applyBotEdit(now.raw, { ...stored, agent: entry.agent, ...(entry.model ? { model: entry.model } : { model: undefined }) })); saved = true; }
  }
  if (!opts.json) report([`${bot.name}: ${old ? `${seat.address} replaces ${old.address}, ${restartText(plan, session)}` : `${bot.name} wasn't running; started in ${seat.address}`}${saved ? `; ${BOTS_PATH} now says ${plan.agent}` : ""}.`]);
  return opts.json ? { ...seatOnJson(bot, seat), warnings, replaced: old ? held.binding.terminal : null, mode: old ? plan.mode : "start",
    agent: plan.agent, model: plan.model, session: session ? SESSION_MASK : null, note: plan.note, saved } : seat.address;
}

/** The agent a bot starts on, from Herdr's table: refused when it isn't one, or isn't installed. */
function startableAgent(bot, agentKey = bot.agent) {
  const agent = agentTable()[agentKey];
  if (!agent?.run?.length) throw new CliError(`${bot.name}'s coding agent "${agentKey}" isn't one Herdr can start.`);
  if (!onPath(agent.run[0])) throw new CliError(`${agent.name} (${agent.run[0]}) isn't installed on this computer.`);
  return agent;
}

// Output never shows a session id (RFC 0021): the argv's --session-id value and the label as ***.
const maskedLabels = (labels) => (labels?.[SESSION_LABEL] ? { ...labels, [SESSION_LABEL]: SESSION_MASK } : labels);
const seatJson = (bot, seat) => ({ id: bot.id, terminal: seat.terminal, parent: seat.parent[0] === "--parent" ? seat.parent[1] : null,
  argv: maskedArgv(seat.argv, seat.session), labels: maskedLabels(seat.labels), space: seat.place?.space ?? null, tab: seat.place?.tab ?? null, hookWritten: seat.hook.written, warnings: seat.hook.warnings });

/**
 * Starts a bot's pane on this computer (Start, and Restart's replacement): the agent and its
 * model pin, the A1 parent, the A16 labels, the place in Herdr's window, the briefing hook, the
 * attach row (by "start", under the ledger's lock) and the seat row. `over` (Restart): `argv`
 * (the whole command, checked by the caller), `agent`, `model`, `cwd`, `place` (undefined:
 * placementOf the project), `carry` (labels kept from the old pane), `replacing` (the old pane's
 * binding: hc run alone, past the "already running" check; the attach rows are restart's, once
 * the new pane has stayed up, and the seat row is left to `logSeat(createdMs)`), `session` (the
 * session the restart's command runs: the id it chose with --session-id, or the one it resumes;
 * Claude's goes on the pane as its agent.session label and in the seat row). A Start of a Claude
 * bot whose command picks no session of its own (ownsSession) runs on a session id chosen here
 * (RFC 0021 (f) 2). A pane of a CLI that
 * runs with HERDR_APP_HOME set also gets it as an env word (#650), as a linked machine's pane
 * gets the project's pane-env one. Resolves { terminal,
 * created_ms, parent, argv, labels, place, hook, logSeat, session }, or { running } when the
 * ledger names another terminal for the bot by the time the lock is taken.
 */
async function launchSeat(project, bot, over = {}) {
  const { file, key } = project;
  const agentKey = over.agent ?? bot.agent;
  const model = over.argv ? (over.model ?? null) : bot.model;
  // A12: a pin that isn't one of the agent's listed models (an old free-text model) is refused.
  if (!over.argv && bot.model && !modelList(bot.agent, bot.model).includes(bot.model)) {
    throw new CliError(`${bot.name} is pinned to "${bot.model}", which isn't a ${bot.agent} model this computer lists. `
      + `Pick one with automagik-herdr edit ${bot.id} --model <model> (the error lists them), or clear it with --no-model.`);
  }
  const agent = startableAgent(bot, agentKey);
  // Antigravity always gets a mode (auto by default); every other agent's argv is unchanged.
  const agyMode = launchAgyMode(bot, agentKey);
  // #823: the session's permission list, written private under the app home before the launch;
  // a restart's plan names the same file, so it is written again with the roster as it is now.
  const agySettings = agentKey === "antigravity"
    ? (over.agySettings ?? agySettingsPlan({ bot, scope: "seat", folder: key, settingsDir: agySettingsDir(appHome()) })) : null;
  if (agySettings) writeAgySettingsFile(agySettings, bot);
  // A1: the effective lead's live terminal as parent, outliving it; the main bot has none.
  const lead = bot.kind === "member" ? effectiveLead(file, bot.id).lead : "";
  const leadGet = lead ? await attachedGet(lead) : null;
  const leadLive = leadGet?.address ?? null;
  const parent = parentArgs(file, bot.id, (id) => (id === lead ? leadLive : null));
  const carry = over.carry ?? {};
  const labels = { ...paneLabels(file, bot.id, carry, lead ? leadPane(await liveRows(lead))?.labels ?? null : null), ...carry }; // A16
  const taken = new Set(rowsOf(await hcJson(["ls"])).map((r) => r?.name).filter(Boolean));
  // A Start's command, on a new session whose id Herdr chooses (Claude), unless it picks its own.
  const source = over.argv ?? [...agent.run, ...agyModeArgs(agentKey, agyMode), ...modelArgs(bot.agent, bot.model)];
  const chosen = !over.argv && choosesSession(agentKey) && !ownsSession(source) ? newSessionId() : null;
  const session = over.argv ? (over.session ?? null) : chosen;
  if (session && agentKey === "claude") labels[SESSION_LABEL] = session;
  // The briefing goes into the command itself (start and restart alike), so no hook prints it every turn.
  const seatArgv = chosen ? [...source, ...sessionIdArgs(agentKey, chosen)] : source;
  const briefed = await briefedLaunch(project, bot, agentKey, withAgySettings(agentKey, seatArgv, agySettings?.path));
  if (agySettings?.warnings?.length) briefed.warnings.push(...agySettings.warnings);
  const argv = briefed.argv;
  // As a worker (cmdWorker): the pane gets this PATH, with an npm agent's (#!/usr/bin/env node,
  // like codex) interpreter folder first when it lacks it (#56); start and restart both come
  // here. Always passed (#213): without it the pane has herdr-core's PATH, which may lack node.
  const cwd = over.cwd ?? key;
  const runPath = launchPath(argv[0], cwd);
  const path = runPath.path;
  // A restart's own place (the old pane's space and tab) stands; a start asks the window too:
  // one herdr-app ls, shared by placementOf (a label whose space doesn't show the project is
  // dropped) and windowPlace (an open space on the project, else a new one). The space only:
  // the bot opens in a tab of its own, never another pane's (start --tab picks one).
  let place = over.place;
  if (place === undefined) {
    const seen = await windowSpaces();
    place = spaceOnly(await windowPlace(key, await placementOf(key, seen), seen));
  }
  // The Claude login this launch uses (#453): read from claude-logins.json now, Claude only.
  const login = claudeLogin(argv, briefed.warnings);
  const proxyOn = agentKey === "dsh-tui" && proxyEnabled(
    approvedProxyState({ project: key, bot }), process.platform,
    (warning) => briefed.warnings.push(warning));
  const env = { ...(process.env.HERDR_APP_HOME ? { HERDR_APP_HOME: appHome() } : {}),
    ...briefed.env };
  const args = startArgs({ botId: bot.id, name: hcName(bot.name, bot.id, taken), cwd, space: place?.space, tab: place?.tab, parent, argv, labels, path,
    env, login, agent: agentKey, project: key, sandbox: proxyOn });
  // The hook goes in before the session starts, so Claude Code reads it at startup.
  const hook = agentKey === "claude" ? await writeBriefingHook(bot, cwd) : { written: false, warnings: [] };
  hook.warnings.unshift(...briefed.warnings);
  if (runPath.note) hook.warnings.unshift(runPath.note);
  report(hook.warnings);
  const run = async (ledger) => {
    const r = await hc(args);
    if (r.code !== 0) throw new CliError(`hc run failed: ${(r.stderr || r.stdout).trim()}`);
    let address = null;
    try { address = JSON.parse(r.stdout).address ?? null; } catch { address = null; }
    if (!address) throw new CliError(`hc run gave no terminal address: ${r.stdout.trim()}`);
    const get = await hcGet(address).catch(() => null);
    if (ledger) {
      if (!Number.isSafeInteger(get?.created_ms)) {
        throw new CliError(`${address} runs, but hc get gave no created_ms, so it has no attach row: attach it with automagik-herdr attach ${bot.id} ${address}`);
      }
      try { ledger.write([attachRow({ event: "attach", bot: bot.id, project: key, terminal: address, core: ledger.core, created_ms: get.created_ms, by: "start" })]); } catch (e) {
        throw new CliError(`${address} runs, but its attach row wasn't written (${e?.message ?? e}): attach it with automagik-herdr attach ${bot.id} ${address}`);
      }
    }
    return { terminal: address, created_ms: get?.created_ms ?? null, pid: get?.foreground?.pid ?? get?.pid ?? null };
  };
  // Start: under the ledger's lock, still unattached, then hc run and the attach row (by
  // "start"). Restart: hc run alone (the old pane still holds the bot).
  const started = over.replacing ? await run(null) : await underLedger(async ({ core, byBot, holds, write }) => {
    const now = await holds(byBot.get(bot.id));
    if (now) return { running: now.binding.terminal };
    return run({ core, write });
  });
  if (started.running) return { running: started.running };
  const { terminal } = started;
  // Restart writes the seat row only once the pane has proved itself. Its tags come from the
  // file this launch started from, frozen in the row (RFC 0021 (e)).
  const tags = seatTags(file, bot.id);
  const logSeat = async (createdMs = started.created_ms) => {
    const unlogged = appendLedger(startRow({ kind: "seat", terminal, pid: started.pid ?? await pidOf(terminal), botId: bot.id, worktree: cwd,
      project: key, agent: agentKey, model, ...tags, core: await rowCore(), createdMs, session: agentKey === "claude" ? session : null }));
    if (unlogged) { hook.warnings.push(unlogged); report([unlogged]); }
  };
  if (!over.replacing) await logSeat();
  if (place?.spare && TAB_WAIT_MS > 0) {
    const why = await closeSpare(place.spare, terminal);
    if (why) { hook.warnings.push(why); report([why]); }
  }
  listProject(key);
  // An edit that landed while this Start ran: the file read again, its role and category
  // put on the new pane (relabelWords against the labels it started with).
  try {
    const fresh = loadProject(key).file;
    if (fresh.bots.some((b) => b.id === bot.id && !b.planned)) {
      const words = relabelWords(labels, paneLabels(fresh, bot.id), labels);
      if (words.length && (await hc(["label", terminal, ...words])).code !== 0) {
        const warning = `${terminal}'s labels ${words.join(" ")} weren't set.`;
        hook.warnings.push(warning);
        report([warning]); // the hook's warnings were printed before hc run
      }
    }
  } catch { /* the file can't be read now: the labels it started with stand */ }
  if (!place) {
    hook.warnings.push(`No open Herdr space shows ${key}, so Herdr gives ${terminal} no pane: it runs, unseen. `
      + `Watch it with hc attach ${terminal}. To give the next start a pane, open a space on ${key} first, or pass --space <id> (herdr-app ls lists the ids).`);
    report(hook.warnings.slice(-1));
  }
  return { terminal, created_ms: started.created_ms, parent, argv, labels, place, hook, logSeat, session };
}

/**
 * The child processes of the shell `get` names (`pgrep -P` its pid, on `machine` through hc
 * for a linked one's): their pids, [] for none, or null when that can't be told (no pid, no
 * pgrep, an error, the machine not answering), and shellIdle then never counts it idle. None
 * only as pgrep itself says it: it exited 1 with nothing on stdout or stderr. Here pgrep runs
 * through pgrepHere, never runProgram, which gives code 1 and its own message on stderr for a
 * pgrep it couldn't run (EACCES) or killed at its timeout as well as for every failed exit.
 */
async function shellChildren(get, machine = null) {
  if (!Number.isSafeInteger(get?.pid) || get.pid <= 0) return null;
  const args = ["-P", String(get.pid)];
  const r = machine ? await remoteIo.exec("pgrep", args, machine) : await pgrepHere(args);
  if (!r) return null;
  const pids = (r.stdout ?? "").split(/\s+/).filter(Boolean);
  if (r.code === 1 && !pids.length && !(r.stderr ?? "").trim()) return [];
  return r.code === 0 && pids.length && pids.every((x) => /^\d+$/.test(x)) ? pids : null;
}

/**
 * Closes the spare shell's tab of a space this start made (windowPlace's or windowPlaceOn's
 * `spare`) once the window shows the bot's pane (`terminal`; on `machine`, a linked one's) in
 * another tab there: never before, so the space always keeps a tab, and only while that tab
 * holds the shell alone with nothing but the shell itself in front and no job of its own
 * running (spareTab, shellIdle, shellChildren). Never `confirmed`: Herdr asks the person only
 * before closing a space's last tab, which this never is. Null, or a warning when it failed.
 */
async function closeSpare(spare, terminal, machine = null) {
  const shown = await windowShows(terminal, TAB_WAIT_MS, machine);
  if (!shown || shown.space.id !== spare.space) return null;
  if (!spareTab(spare, shown.space.tabs, terminal, true)) return null;
  const get = await hcGet(machine ? `${machine}/${spare.terminal}` : spare.terminal).catch(() => null);
  const idle = shellIdle(get, await shellChildren(get, machine));
  const tab = spareTab(spare, shown.space.tabs, terminal, idle);
  if (!tab) return null;
  const why = await windowDo("tab.close", { id: tab });
  return why ? `The new space's spare shell tab (${tab}) wasn't closed: ${why}` : null;
}

// ---- restart: the bot's agent again, in its pane's place ----

/** How long Restart gives the replacement to prove itself before it gives up on it. */
const RESTART_WAIT_MS = Number(process.env.AUTOMAGIK_HERDR_RESTART_WAIT_MS) || 30_000;
/**
 * How long the replacement's agent must stay in front, every check, before the old pane ends:
 * an agent is in front at once and only then reads its arguments (claude --resume with a stale
 * id, --continue with no conversation, a swap to an agent that fails at startup exit in 1-3s).
 * An agent that reports its own status to hc (`reported`) has started its session: a shorter
 * settle then.
 */
const RESTART_STABLE_MS = Number(process.env.AUTOMAGIK_HERDR_RESTART_STABLE_MS) || 5000;
const RESTART_SETTLE_MS = Math.min(1500, RESTART_STABLE_MS);
const later = (ms) => new Promise((go) => setTimeout(go, ms));

/**
 * Waits until `terminal` has had an agent in front (Decision 3's live rule) at every check for
 * RESTART_STABLE_MS (RESTART_SETTLE_MS once it reports): { state: "live" | "ended" | "late",
 * get }. "ended": its program exited (a resume that found nothing, say).
 */
async function agentUp(terminal, ms = RESTART_WAIT_MS) {
  const until = Date.now() + ms;
  let since = null;
  for (;;) {
    const get = await hcGet(terminal);
    if (!get || get.state === "finished") return { state: "ended", get };
    if (get.state === "live" && agentInForeground(get)) {
      since ??= Date.now();
      if (Date.now() - since >= (get.reported === true ? RESTART_SETTLE_MS : RESTART_STABLE_MS)) return { state: "live", get };
    } else since = null;
    if (Date.now() >= until) return { state: "late", get };
    await later(250);
  }
}

// A line that names a failure: an error word, or a code in brackets as codex gives one
// ("model provider example-proxy is no longer configured (modelProviderNotConfigured)").
const FAILURE_WORD = /\b(error|fatal|failed|failure|panic|denied|invalid|unauthori[sz]ed|refused|cannot|can't|not configured|no longer)\b/i;
const FAILURE_CODE = /\([a-z]+[A-Z][A-Za-z]*\)/; // camelCase only: never "(quit)" or "(default)"
const failureLine = (l) => FAILURE_WORD.test(l) || FAILURE_CODE.test(l);
// A line with nothing to say: box drawing, rules, a bare shell prompt.
const EMPTY_LINE = /^[\s\u2500-\u257f\u2580-\u259f\-_=*•·.:>❯›$%#]*$/;

/**
 * The agent's own last word on a screen (`hc read`'s text), #413: of its last lines with
 * something on them, the last one that names a failure, else the last one; null for none.
 */
export function causeLine(text) {
  const lines = screenTail(text, 40).split("\n").map((l) => l.trim()).filter((l) => l && !EMPTY_LINE.test(l));
  const line = lines.findLast(failureLine) ?? lines.at(-1);
  if (!line) return null;
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

/** The last line `terminal`'s agent left on its screen (causeLine), or null when it can't be read. */
async function endedCause(terminal) {
  try {
    const r = await hc(["read", terminal, "--lines", "40", "--json"]);
    if (r.code !== 0) return null;
    let text = r.stdout;
    try { const j = JSON.parse(r.stdout); text = typeof j?.text === "string" ? j.text : null; } catch { /* plain text */ }
    if (text === null) return null;
    return causeLine(text);
  } catch { return null; }
}

/** Why `terminal` ended before its agent was up: { text, cause }, the text naming the agent's last line (endedCause) when it left one. */
async function exitedWhy(terminal) {
  const cause = await endedCause(terminal);
  return { cause, text: `${terminal} exited before its agent was up${cause ? `; its agent said: "${cause}" (hc read ${terminal} shows the rest)` : ` (hc read ${terminal} says why)`}` };
}

/**
 * restartRefusal's refusal of a busy pane: --json prints `refused` ("working": mid-turn;
 * "helpers": helpers that end with it) and its `terminal`, so a caller can wait for it (#413).
 */
const busyRefusal = (refusal, old) => new CliError(refusal, 1, { refused: old?.status?.state === "working" ? "working" : "helpers", terminal: old.address });

// Codex refusing a thread whose model provider is no longer in its config (#413: threads begun
// on a provider since removed from the config): that thread can't be resumed, only left behind.
// Its own error code only, never a bare "no longer configured" another failure might print.
const PROVIDER_GONE = /\bmodelProviderNotConfigured\b/;

/**
 * Whether a resume that exited (its agent's last line `cause`) is codex unable to resume the
 * thread at all (PROVIDER_GONE: codex's modelProviderNotConfigured), the one failure a restart
 * answers by starting fresh (#413).
 */
const providerGone = (plan, cause) => plan.mode === "resume" && plan.agent === "codex" && PROVIDER_GONE.test(cause ?? "");
/**
 * The note a restart that left such a thread behind carries: that it had one, and what codex said.
 * The thread's id is never printed (RFC 0021): it stays in the old pane's labels and the ledger.
 */
const providerGoneNote = (thread, terminal, cause) =>
  `codex can't resume ${thread ? `its thread (${SESSION_MASK})` : "the folder's latest thread"} (${terminal} said "${cause}"), so it starts on a new one`;

/** A replacement that exited before its agent was up: the refusal; --json prints the cause beside the replacement `terminal`. */
async function exitedBefore(terminal, rest) {
  const { cause, text } = await exitedWhy(terminal);
  return new CliError(`${text}; ${rest}`, 1, { terminal, cause });
}

/** The workers ledger's rows ([] when it can't be read). */
function workerLedgerRows() {
  try { return readLedger(readText(ledgerPath(appHome())) ?? ""); } catch { return []; }
}

/**
 * Who else may own the latest `agentKey` conversation in the folder `cwd` (#328), the panes and
 * bots a restart with no session id must not take it from: [{ address, name, ended }]. Over-
 * counting is safe (the restart then starts fresh and says why), so all three count: the live
 * panes on this computer running that agent there (a bot's, or one started by hand: hc ls), the
 * bound bots there by the attach ledger (`view`), and each other bot any of whose seat rows in the
 * workers ledger (`ledger`) put it there on that agent, its pane since ended or moved or not. `old`:
 * the pane being replaced (never counted); `anywhere`: the agent's id-less resume isn't
 * limited to one folder (models.js continuesAnywhere), so any folder counts.
 */
async function sharersOf({ view, cwd, botId, file, agentKey, ledger = [], old, anywhere = false }) {
  const real = realDir(cwd) ?? cwd;
  const here = (dir) => anywhere || (typeof dir === "string" && dir !== "" && (dir === cwd || (realDir(dir) ?? dir) === real));
  const agents = agentTable();
  // The agent in front, past the keep wrapper (launchArgs.js unwrapKeep) a pane may run it in.
  const runs = (get) => agentInForeground(get) && ((agentKey === "claude" && isClaude(null, get))
    || agentKeyOfArgv(unwrapKeep(get.foreground?.argv), agents) === agentKey);
  const nameOf = (id) => (id ? file.bots.find((b) => b.id === id)?.name ?? `bot ${id}` : null);
  const out = new Map();
  const add = (address, name, ended = false) => { if (address && address !== old?.address && !out.has(address)) out.set(address, { address, name, ended }); };
  for (const { binding, get } of view.live.values()) {
    if (binding.bot !== botId && get && runs(get) && here(get.foreground?.cwd ?? get.cwd)) add(binding.terminal, nameOf(binding.bot));
  }
  let rows = [];
  try { rows = rowsOf(await hcJson(["ls"])).filter((r) => local(r?.address) && r.state === "live" && r.address !== old?.address && !out.has(r.address)); }
  catch { rows = []; }
  for (const get of (await Promise.all(rows.map((r) => hcGet(r.address).catch(() => null)))).filter(Boolean)) {
    if (get.labels?.[BOT_LABEL] === botId || !runs(get) || !here(get.foreground?.cwd ?? get.cwd)) continue;
    add(get.address, nameOf(get.labels?.[BOT_LABEL]) ?? "a pane");
  }
  // Every seat row counts, not only each bot's last (#341): a bot re-seated in a worktree or a
  // clone still left its conversation here. Each bot is named once, by its latest pane here.
  const seatedHere = new Map();
  for (const r of ledger) {
    if (r?.event === "start" && r.kind === "seat" && typeof r.botId === "string" && r.botId !== botId
      && r.agent === agentKey && here(r.worktree)) seatedHere.set(r.botId, r);
  }
  for (const r of seatedHere.values()) add(r.terminal, nameOf(r.botId), !(view.live.get(r.botId)?.binding.terminal === r.terminal));
  return [...out.values()];
}

/**
 * The attach rows of a restart, under the ledger's lock, once the new pane has stayed up: the
 * old binding detached (by "start", "moved"), then the new terminal attached (by "start").
 * When the ledger no longer names the old binding (another CLI attached or moved the bot
 * meanwhile) nothing is written: { lost: the terminal it names, or null }. With the old pane
 * already ended (its end row written), the new one is attached alone.
 */
async function attachMoved(bot, oldBinding, terminal, created_ms, key) {
  return underLedger(async ({ core, byBot, holds, write }) => {
    const now = byBot.get(bot.id);
    const rows = [];
    if (now && attachKey(now) === attachKey(oldBinding)) rows.push(closingRow(oldBinding, "detach", "start", "moved"));
    else if (now && (await holds(now))) return { lost: now.terminal };
    rows.push(attachRow({ event: "attach", bot: bot.id, project: key, terminal, core, created_ms, by: "start" }));
    write(rows);
    return { lost: undefined };
  });
}

/** The exit code a command that printed its answer still fails with (a --tree that stopped part way): 0 else. */
const exitAfter = { code: 0 };

/** Why a restart of an agent whose -c needs a finished turn (models.js resumeAfterTurn) starts a new conversation. */
const noTurnNote = (agents, agentKey, old) => `${agents[agentKey]?.name ?? agentKey} has no finished turn in ${old?.address ?? "the old pane"} to continue`;

/** What cmdRestart returns once it has printed its own answer (a bot restarting itself). */
export const PRINTED = Symbol.for("automagik-herdr.printed");

/**
 * The live terminals whose hc parent is `address`, as hc get answers (they may end with it).
 * `strict` (--tree): one hc can't read refuses the restart (CliError), since it couldn't be
 * checked or run again; otherwise it is left out.
 */
async function helpersOf(address, { strict = false } = {}) {
  const rows = rowsOf(await hcJson(["ls"])).filter((r) => r?.parent === address && r.state !== "finished" && r.address);
  const states = await Promise.all(rows.map((r) => hcState(r.address)));
  const unread = states.filter((x) => x.state === "unknown").map((x) => x.why);
  if (strict && unread.length) {
    throw new CliError(`${unread.join("; ")}: --tree can't check ${address}'s ${unread.length === 1 ? "helper" : "helpers"}. Nothing was started.`);
  }
  return states.filter((x) => x.get).map((x) => x.get);
}

/** The workers ledger's last worker start row for `terminal`, or null. */
function workerRowOf(rows, terminal) {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]?.event === "start" && rows[i].kind === "worker" && rows[i].terminal === terminal) return rows[i];
  return null;
}

/** `dir` is a folder that is there now. */
const isDir = (dir) => { try { return statSync(dir).isDirectory(); } catch { return false; } };

/**
 * `hc get` of `terminal`: { state: "live" | "finished", get }, { state: "gone" } when hc says
 * there is no such terminal, or { state: "unknown", why } when hc failed otherwise (never read
 * as gone).
 */
async function hcState(terminal) {
  const r = await hc(["get", terminal, "--json"]);
  if (r.code === 0) {
    try { const get = JSON.parse(r.stdout); return { state: get?.state === "finished" ? "finished" : "live", get }; } catch { /* below */ }
    return { state: "unknown", why: `hc get ${terminal} printed no JSON` };
  }
  if (r.code === 3 || /not_found/.test(r.stderr ?? "")) return { state: "gone" };
  return { state: "unknown", why: `hc get ${terminal} failed (${(r.stderr || r.stdout).trim() || `exit ${r.code}`})` };
}

/** How long --tree waits, before anything starts, for the bot's pane and its helpers to be idle, and how often it looks. */
const TREE_TURN_WAIT_MS = Number(process.env.AUTOMAGIK_HERDR_TREE_TURN_WAIT_MS) || 600_000;
const TREE_TURN_POLL_MS = Math.min(2000, Math.max(100, Math.floor(TREE_TURN_WAIT_MS / 10)));

/**
 * --tree, before the bot's new pane starts: refused (unless --force) while the old pane or a helper
 * in `plans` waits for an answer, or has an agent that reports no status to hc, which may be
 * mid-turn (#413; a plain program reports none and passes); else waits (TREE_TURN_WAIT_MS) until the old pane and every
 * helper in `plans` are idle at one look, so no turn ends (and types its note into the old pane)
 * once two panes could hold the bot's session. A helper's note can start the old pane's turn, so
 * all are looked at again each time. Refused (CliError), nothing started, when one is still
 * mid-turn at the end, or hc can't read one. Resolves the plans whose helper still runs (one that
 * ended by itself is said and left out). `force`: no wait.
 */
async function treeIdle(old, plans, say, { force = false } = {}) {
  if (force) return plans;
  const until = Date.now() + TREE_TURN_WAIT_MS;
  for (;;) {
    const states = await Promise.all([old.address, ...plans.map((q) => q.replaced)].map((a) => hcState(a)));
    const unread = states.filter((x) => x.state === "unknown").map((x) => x.why);
    if (unread.length) throw new CliError(`${unread.join("; ")}: --tree can't tell whether it is mid-turn. Nothing was started.`);
    const panes = [{ address: old.address, agent: agentKeyOfArgv(unwrapKeep(old.foreground?.argv), agentTable()) }, ...plans.map((q) => ({ address: q.replaced, agent: q.agent }))]
      .map((p, i) => ({ ...p, live: states[i].state === "live", status: states[i].get?.status?.state }));
    const asking = panes.filter((p) => p.live && p.status === "blocked").map((p) => p.address);
    if (asking.length) {
      const one = asking.length === 1;
      throw new CliError(`${asking.join(", ")} ${one ? "is" : "are"} waiting for an answer. Nothing was started: answer ${one ? "it" : "them"} first, or pass --force to end ${one ? "it" : "them"}.`);
    }
    const silent = panes.filter((p) => p.agent && p.live && typeof p.status !== "string").map((p) => p.address);
    if (silent.length) {
      const one = silent.length === 1;
      throw new CliError(`${silent.join(", ")} ${one ? "doesn't" : "don't"} tell hc whether ${one ? "it is" : "they are"} busy, so --tree can't tell whether ${one ? "it has" : "they have"} finished. `
        + `Nothing was started. Look at ${one ? "it" : "them"} first, then pass --force to restart anyway.`);
    }
    const busy = panes.filter((p) => p.live && p.status === "working").map((p) => p.address);
    if (!busy.length) {
      const live = plans.filter((_, i) => states[i + 1].state === "live");
      for (const q of plans.filter((_, i) => states[i + 1].state !== "live")) say(`${q.replaced} ended by itself before the restart, so it isn't run again.`);
      return live;
    }
    if (Date.now() >= until) {
      throw new CliError(`${busy.join(", ")} ${busy.length === 1 ? "was" : "were"} still mid-turn ${TREE_TURN_WAIT_MS / 1000}s later. Nothing was started: `
        + `restart once ${busy.length === 1 ? "it is" : "they are"} idle, or pass --force to cut ${busy.length === 1 ? "its turn" : "their turns"}.`);
    }
    await later(TREE_TURN_POLL_MS);
  }
}

/**
 * After the old pane ended: waits (bounded) until helper `terminal`, which ends with it, has.
 * One still running is ended (hc kill) and looked at again. { ended: true }, or { ended: false,
 * live, why }: `live` when it still runs (never run a second time then, nor offered by hand),
 * else hc can't say (unknown is never gone).
 */
async function helperEnded(terminal, ms = 5000) {
  const wait = async (limit) => {
    const until = Date.now() + limit;
    for (;;) {
      const now = await hcState(terminal);
      if (now.state === "gone" || now.state === "finished") return { ended: true };
      if (now.state === "unknown") return { ended: false, live: false, why: `${now.why}, so it may still run` };
      if (Date.now() >= until) return null;
      await later(100);
    }
  };
  const first = await wait(ms);
  if (first) return first;
  const k = await hc(["kill", terminal]);
  const second = await wait(k.code === 0 ? ms : 0);
  if (second) return second;
  return { ended: false, live: true, why: `it still runs after its parent ended${k.code === 0 ? ` and ${ms / 1000}s after hc kill ${terminal}` : ` (hc kill ${terminal} failed: ${(k.stderr || k.stdout).trim()})`}` };
}

/** `w` as one shell word. */
const shellWord = (w) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(w) ? w : `'${String(w).replace(/'/g, "'\\''")}'`);

/**
 * How to run helper plan `p` again by hand, as a child of `parent`: the hc run line the restart
 * would have run (its name, folder, labels, the seat's PATH, its command resumed), which runs as
 * pasted into sh, bash or zsh once the session id is put back where the line shows *** (RFC 0021:
 * no session id is printed; the note says where it is kept); then comment lines: its session,
 * and for a worker that its ledger row isn't copied by hand, and a claude-logins.json warning
 * when the line is on the default login because the record can't be followed. { line, notes }.
 */
function byHand(p, parent) {
  const loginWarnings = [];
  const args = helperArgs({ name: p.name, cwd: p.cwd, labels: p.labels, parent, ...helperCommand(p),
    login: claudeLogin(p.argv, loginWarnings) });
  const notes = [p.session ? `# resumes its session by id: put the id where *** stands; hc get ${p.replaced} shows it (its agent.session `
    + "or revive.session label), and so does the workers ledger"
    : "# no session id known: it resumes its folder's latest conversation"];
  // A record that can't be followed: the line carries the default login's words, and says so.
  for (const w of loginWarnings) notes.push(`# ${w}`);
  if (p.worker) notes.push(`# a worker: its workers-ledger row (task ${p.worker.task ?? "none"}) isn't copied, so history won't link the new terminal`);
  return { line: maskSession(["hc", ...args], p.session).map(shellWord).join(" "), notes };
}

/** A --tree helper is another start: resolve its own bot's approved switch afresh too. */
function helperCommand(p, warn = () => {}) {
  const path = launchPath(p.argv[0], p.cwd).path;
  if (!p.proxyIdentity) return { argv: p.argv, path };
  const { botId, project } = p.proxyIdentity;
  const bot = loadProject(project).file.bots.find((entry) => entry.id === botId) ?? { id: botId };
  if (!proxyEnabled(approvedProxyState({ project, bot }), process.platform, warn)) {
    return { argv: p.argv, path };
  }
  return { argv: paneArgs(p.argv, p.proxyIdentity),
    path: guardPathWith(path, stableGuardDir(stableRootOf())) };
}

/**
 * Restart --tree's second half (#213), once the bot's new pane is up and the old one has ended
 * (its helpers with it, so nothing types into a pane that shares the bot's session): each helper
 * (`plans`, all checked before anything started), one at a time: seen ended (helperEnded: one
 * still running is ended, and if it won't end it is said and never run twice), then run again as
 * a child of `parent` (the bot's new pane), in its folder, with its name and labels, its command
 * resumed and a seat's PATH, and waited on as the bot's was. A worker's ledger row is copied to
 * its new terminal. A helper that is itself a bot (`binding`) has its binding moved to it
 * (attachMoved) and a seat row. One that fails is reported with the hc run line that resumes it
 * by hand (`by_hand`), and the rest go on. `say` takes the warnings. Resolves [{ name,
 * replaced, terminal, bot, agent, mode, session, up, note, error, by_hand, still_running }].
 */
async function rerunHelpers(plans, parent, say) {
  const out = plans.map((p) => ({ name: p.name, replaced: p.replaced, terminal: null, bot: p.binding?.bot ?? null, agent: p.agent ?? null,
    mode: p.mode ?? null, session: p.session ?? null, up: false, note: p.note ?? null, error: null, cause: null, by_hand: null, still_running: false }));
  for (const [i, p] of plans.entries()) {
    const who = `${p.replaced}${p.name && p.name !== p.replaced ? ` (${p.name})` : ""}`;
    const failed = (why) => {
      let hand;
      try { hand = byHand(p, parent); }
      catch { hand = { line: "# repair approval before restarting this helper", notes: [] }; }
      out[i].error = why;
      out[i].by_hand = hand.line;
      say(`${who} wasn't run again: ${why}. Its conversation is kept; to run it again by hand:\n  ${hand.line}\n  ${hand.notes.join("\n  ")}`);
    };
    const end = await helperEnded(p.replaced);
    // Ended (its parent's kill took it, or its own): a logged launch's end row (RFC 0021 (f) 4).
    if (end.ended && (p.worker || p.binding)) {
      // Keyed as its own start row or binding keyed the launch, so the sweep sees it ended.
      const unlogged = appendEnd(endRow({ kind: p.binding ? "seat" : "worker", terminal: p.replaced,
        core: p.binding?.core ?? p.worker?.core ?? await rowCore(),
        createdMs: p.binding?.created_ms ?? p.worker?.created_ms ?? p.createdMs, reason: "replaced" }));
      if (unlogged) say(unlogged);
    }
    if (!end.ended) {
      out[i].error = end.why;
      out[i].still_running = end.live;
      say(end.live ? `${who} ${end.why}: it holds its session, so it isn't run again (no second pane on one session); end it with hc kill ${p.replaced}, then restart it.`
        : `${who} wasn't run again: ${end.why}; with it possibly running, a second copy would share its session. Check it with hc get ${p.replaced}.`);
      continue;
    }
    const taken = new Set(rowsOf(await hcJson(["ls"])).map((r) => r?.name).filter(Boolean));
    const name = p.name && !taken.has(p.name) ? p.name : null;
    const loginWarnings = [];
    const login = claudeLogin(p.argv, loginWarnings);
    for (const w of loginWarnings) say(`${who}: ${w}`);
    let command;
    try { command = helperCommand(p, say); }
    catch (e) { failed(e.message); continue; }
    // #823: the Antigravity permission file this helper's argv names, written as its start does.
    if (p.agySettings) {
      try { writeAgySettingsFile(p.agySettings, { name: p.name ?? p.replaced }); }
      catch (e) { failed(e.message); continue; }
    }
    const r = await hc(helperArgs({ name, cwd: p.cwd, labels: p.labels, parent, ...command, login }));
    let address = null;
    try { address = JSON.parse(r.stdout).address ?? null; } catch { address = null; }
    if (r.code !== 0 || !address) { failed(`hc run failed (${(r.stderr || r.stdout).trim()})`); continue; }
    const up = await agentUp(address);
    if (up.state !== "live") {
      if (up.state === "ended") {
        const why = await exitedWhy(address);
        out[i].cause = why.cause;
        failed(why.text);
        continue;
      }
      const killed = (await hc(["kill", address])).code === 0;
      failed(`${address} didn't keep an agent in front within ${RESTART_WAIT_MS / 1000}s${killed ? ", so it was ended" : ` and couldn't be ended (hc kill ${address})`}`);
      continue;
    }
    out[i].terminal = address;
    out[i].up = true;
    const createdMs = Number.isSafeInteger(up.get?.created_ms) ? up.get.created_ms : null;
    const core = await rowCore();
    if (p.worker) {
      const w = p.worker;
      // The same worker again: its squad, lead and role as its row froze them (RFC 0021 (e));
      // a row from before squads gets its bot's squad now.
      let squad = w.squad ?? null;
      if (!("squad" in w)) { try { squad = squadOf(loadProject(w.project).file, w.botId); } catch { squad = null; } }
      const unlogged = appendLedger(startRow({ kind: "worker", terminal: address, pid: await pidOf(address), botId: w.botId, task: w.task, branch: w.branch,
        project: w.project, lead: w.lead, worktree: w.worktree, base: w.base, created: false, agent: w.agent, model: w.model, effort: w.effort,
        template: w.template, role: w.role, swap: w.swap, override: w.override, overrideRequested: w.override_requested,
        core, createdMs, squad, session: p.agent === "claude" ? p.session : null }));
      if (unlogged) say(unlogged);
    }
    if (p.binding) {
      const b = p.binding;
      const created = Number.isSafeInteger(up.get?.created_ms) ? up.get.created_ms : null;
      let moved;
      try {
        if (created === null) throw new CliError(`hc get gave no created_ms for ${address}`);
        moved = await attachMoved({ id: b.bot }, b, address, created, b.project);
      } catch (e) {
        out[i].error = `its attach row wasn't written (${e?.message ?? e})`;
        say(`${who} runs again in ${address}, but bot ${b.bot}'s attach row wasn't written (${e?.message ?? e}): automagik-herdr attach ${b.bot} ${address}.`);
        continue;
      }
      if (moved.lost !== undefined) {
        out[i].error = `bot ${b.bot} was attached to ${moved.lost} meanwhile`;
        say(`bot ${b.bot} was attached to ${moved.lost} while --tree ran, so ${address} isn't attached to it.`);
        continue;
      }
      let tags = seatTags(null, b.bot);
      try { tags = seatTags(loadProject(b.project).file, b.bot); } catch { /* its file can't be read now: no tags */ }
      const unlogged = appendLedger(startRow({ kind: "seat", terminal: address, pid: await pidOf(address), botId: b.bot, worktree: p.cwd, project: b.project,
        agent: p.agent, model: null, ...tags, core, createdMs, session: p.agent === "claude" ? p.session : null }));
      if (unlogged) say(unlogged);
    }
    // A session id carried onto the new terminal, any harness (RFC 0021 (f) 5): a session row.
    if (p.session && (p.worker || p.binding)) {
      const unrow = appendLedger(sessionRow({ terminal: address, session: p.session, transcript: null, agent: p.agent, core, createdMs }));
      if (unrow) say(unrow);
    }
  }
  return out;
}

/**
 * Restart --tree's first half (#213), before anything starts: the helpers that end with the old
 * pane (`helpers`, hc get answers), each planned (helperPlan: its folder, command, agent and
 * session) and checked, the restart refused (CliError) when one can't be run again, its folder is
 * gone, it has helpers of its own that would end with it (unless `force`: they end, said), the
 * CLI runs inside it, or two runs (the bot's or a helper's) name one session id (one session runs
 * in one pane). One hc can't read was refused by helpersOf already; one mid-turn by restartRefusal. `run`: the bot's own restart ({ who, agent, cwd, session, mode }).
 * Id-less resumes that share a folder and agent with another of them (sharedFolders) are refused,
 * or, with `freshShared`, those helpers start a new conversation; the bot itself never does
 * (restart it with --fresh). Resolves { tree: [plan + { worker, binding }], treeWarnings }.
 */
async function treePlans({ project, bot, old, helpers, view, ledger, agents, knownSession, force, freshShared, run }) {
  const doomed = doomedHelpers(helpers);
  const me = process.env.HC_TERMINAL_ID;
  const mine = me && doomed.find((h) => [h.address, h.name].includes(me));
  if (mine) throw new CliError(`This runs in ${mine.address}, one of ${old.address}'s helpers, which --tree ends and runs again: run it from another terminal.`);
  // The old pane ends before its helpers run again (so nothing types into it on the bot's session); this CLI would end with it.
  if (doomed.length && me && [old.address, old.name].includes(me)) {
    throw new CliError(`This runs in ${old.address}, the pane --tree ends before its helpers run again: run restart --tree from another terminal.`);
  }
  const treeWarnings = [];
  // --tree restarts one level: a helper's own helpers that would end with it are refused (or, with --force, said).
  const nested = (await Promise.all(doomed.map(async (h) => doomedHelpers(await helpersOf(h.address, { strict: true })).map((c) => `${c.address} (under ${h.address})`)))).flat();
  if (nested.length) {
    const one = nested.length === 1;
    if (!force) {
      throw new CliError(`--tree restarts ${old.address}'s helpers, not theirs: ${nested.join(", ")} would end with ${one ? "its parent" : "their parents"} `
        + `and not run again. Nothing was started. Let ${one ? "it" : "them"} finish first, or pass --force to end ${one ? "it" : "them"}.`);
    }
    treeWarnings.push(`--force: ${nested.join(", ")} ${one ? "ends" : "end"} with ${one ? "its parent" : "their parents"} and ${one ? "isn't" : "aren't"} run again.`);
  }
  const planOf = (h, fresh = null) => {
    const worker = workerRowOf(ledger, h.address);
    const agentKey = agentKeyOfArgv(h.foreground?.argv, agents) ?? worker?.agent ?? null;
    // A helper that is itself a bot (attached by hand): its binding moves with it.
    const binding = view.byTerminal.get(h.address)?.binding ?? null;
    const proxyIdentity = agentKey === "dsh-tui" && process.platform === "linux" ? {
      botId: binding?.bot ?? worker?.botId ?? h.labels?.[WORKER_OF_LABEL] ?? bot.id,
      project: binding?.project ?? worker?.project ?? project.key, worker: !binding,
    } : null;
    // #823: the bot whose permission list an Antigravity helper gets: the one the pane plays
    // (an attached bot), else its worker row's bot, else the bot being restarted.
    const agyBot = [binding?.bot, worker?.botId].map((id) => project.file.bots.find((b) => b.id === id)).find(Boolean)
      ?? project.file.bots.find((b) => b.id === bot.id) ?? bot;
    for (const k of ["agent.session", "revive.session"]) holdId(h.labels?.[k]);
    holdId(knownSession(h, agentKey)?.session);
    return { ...helperPlan({ get: h, worker, session: knownSession(h, agentKey)?.session ?? null,
      agents, fresh, agy: { appHomeDir: appHome(), bot: agyBot } }), worker, binding, proxyIdentity,
      createdMs: Number.isSafeInteger(h.created_ms) ? h.created_ms : null };
  };
  let tree = doomed.map((h) => planOf(h));
  const broken = tree.filter((p) => p.error).map((p) => p.error);
  const gone = tree.filter((p) => !p.error && !isDir(p.cwd)).map((p) => `${p.replaced}'s folder ${p.cwd} isn't there`);
  if (broken.length || gone.length) {
    throw new CliError(`${[...broken, ...gone].join("; ")}. Nothing was started. Restart without --tree (--force ends ${old.address}'s helpers with it).`);
  }
  for (const plan of tree) if (plan.proxyIdentity) helperCommand(plan);
  const whoOf = (p) => p.name ?? p.replaced;
  const runs = () => [run, ...tree.map((p) => ({ who: whoOf(p), agent: p.agent, cwd: p.cwd, session: p.session, mode: p.mode }))];
  // Two of them naming one session would run it in two panes at once.
  const twice = sameSessions(runs());
  if (twice.length) {
    throw new CliError(`${twice.map((g) => `${g.who.join(" and ")} would all resume one session (${SESSION_MASK})`).join("; ")}: one session runs in one pane. `
      + `Nothing was started. Fix the agent.session (or revive.session) label of the wrong one, or restart without --tree.`);
  }
  let shared = sharedFolders(runs());
  if (shared.length && freshShared) {
    const helperIdless = new Set(shared.flatMap((g) => g.idless).filter((w) => w !== run.who));
    tree = tree.map((p, i) => (helperIdless.has(whoOf(p)) ? planOf(doomed[i], `no session id, and its folder ${p.cwd} has other ${p.agent} sessions (--fresh-shared)`) : p));
    shared = sharedFolders(runs());
  }
  if (shared.length) {
    const lines = shared.map((g) => `${g.idless.join(", ")} would resume the latest ${g.agent} conversation in ${g.cwd} (no session id), which ${g.who.join(", ")} all use`);
    const botToo = shared.some((g) => g.idless.includes(run.who));
    throw new CliError(`${lines.join("; ")}: one could pick up another's. Nothing was started. Give each an agent.session label, `
      + `${botToo && freshShared ? `or restart ${bot.name} with --fresh too` : `or pass --fresh-shared to start those helpers on a new conversation${botToo ? ` (and --fresh for ${bot.name})` : ""}`}.`);
  }
  return { tree, treeWarnings };
}

async function cmdRestart(opts, [ref]) {
  if (opts.tab && !opts.space) throw new CliError("--tab needs --space (the space that tab is in).", 2);
  const swap = opts.agent !== undefined || opts.model !== undefined;
  if (opts.save && !swap) throw new CliError("--save keeps a swap in the bot's definition; it goes with --agent or --model.", 2);
  if (opts["fresh-shared"] && !opts.tree) throw new CliError("--fresh-shared picks how --tree restarts helpers; it goes with --tree.", 2);
  // --cwd DIR: the folder the new pane starts in (a real path, as Claude Code and hc see it).
  let wanted = null;
  if (opts.cwd !== undefined && opts.machine !== undefined) {
    throw new CliError("--cwd is a folder on this computer; a restart on a linked machine keeps the old pane's.", 2);
  }
  // --tree on a linked machine isn't built yet (#437): refused before anything is read there, so
  // its helpers are never left behind by a restart that looks done. Each sentence that says what
  // happened names no flag: the Accounts panel shows a refusal without the clauses that name one.
  if (opts.tree && opts.machine !== undefined) {
    throw new CliError(`Restarting a bot's helpers on a linked machine isn't built yet, so nothing was read or restarted: `
      + `${ref} and its helpers on ${opts.machine} still run as they were, on the account they started with. `
      + `By hand: wait for a helper still working to finish, end each helper's pane (hc kill ${opts.machine}/tN for one), `
      + `then restart ${ref} there without --tree. A helper that still had work to do, start again yourself with hc run `
      + `on ${opts.machine} once ${ref} is back.`, 2);
  }
  if (opts.cwd !== undefined) {
    const dir = opts.cwd ? realDir(resolvePath(opts.cwd)) : null;
    if (!dir || !isDir(dir)) throw new CliError(`--cwd ${opts.cwd || '""'} isn't a folder on this computer.`, 2);
    wanted = dir;
  }
  const project = await projectFor(opts);
  const { file, key } = project;
  if (project.text === null) throw new CliError(`No ${BOTS_PATH} in ${key}.`);
  const bot = await botIn(project, ref, opts);
  const why = startRefusal(file, bot.id);
  if (why) throw new CliError(why);
  // A swap's agent and model are checked as an edit checks them (entryFrom); a new agent
  // without --model drops the old agent's pin. bots.json changes only with --save.
  let entry = null;
  if (swap) {
    const stored = project.raw.bots.find((b) => b?.id === bot.id);
    const target = opts.agent !== undefined ? resolveAgent(opts.agent, agentTable()) : bot.agent;
    const edit = { agent: opts.agent, model: opts.model };
    if (opts.model === undefined && target !== bot.agent) edit["no-model"] = true;
    entry = entryFrom(edit, stored, project, { creating: false });
  } else if (bot.model && !modelList(bot.agent, bot.model).includes(bot.model)) {
    throw new CliError(`${bot.name} is pinned to "${bot.model}", which isn't a ${bot.agent} model this computer lists. `
      + `Pick one with automagik-herdr edit ${bot.id} --model <model>, restart it on one with --model <model>, or clear the pin with --no-model.`);
  }
  if (project.machine) return restartOnMachine(opts, project, bot, entry);
  // The old pane: the one the attach ledger names for the bot, as hc confirms it.
  const view = await attachView();
  const held = view.live.get(bot.id) ?? null;
  const old = held && local(held.get?.address ?? held.binding.terminal) ? { ...held.get, address: held.get?.address ?? held.binding.terminal } : null;
  const helpers = old ? await helpersOf(old.address, { strict: Boolean(opts.tree) }) : [];
  if (old) {
    const refusal = restartRefusal({ name: bot.name, old, helpers, force: opts.force, tree: opts.tree });
    if (refusal) throw busyRefusal(refusal, old);
  }
  const agents = agentTable();
  const ledger = workerLedgerRows();
  const runningAgent = old ? agentKeyOfArgv(old.foreground?.argv, agents) : null;
  // An agent as the restart's lines name it ("Claude", not "Claude Code").
  const agentName = (k) => (k === "claude" ? "Claude" : agents[k]?.name ?? k);
  // The session to resume: the old pane's agent.session label (or a reviver's revive.session),
  // else the ledger's last session row for that terminal (the Claude hook writes them), for
  // every agent that resumes by id.
  const knownSession = (get, agentKey) => {
    const id = paneSession(get, agentKey);
    if (id) return { session: id, transcript: null };
    return resumesById(agentKey) ? ledgerSession(ledger, get.address, agentKey, get.created_ms) : null;
  };
  const known = old ? knownSession(old, runningAgent ?? bot.agent) : null;
  // Every id the old pane carries or the ledger names, whatever the agent: never printed.
  holdId(known?.session);
  for (const k of ["agent.session", "revive.session"]) holdId(old?.labels?.[k]);
  // The old pane's launch and hc template, only to rebuild from the source and to say when they
  // differ from it (#597): a template hc still lists owns the command, with its CURRENT words.
  const oldLaunch = old ? paneCommand(old) : null;
  const oldTemplate = old ? await paneTemplate(old) : null;
  const planned = {
    bot, run: startableAgent(bot, entry?.agent ?? bot.agent).run,
    runningAgent, session: known?.session ?? null,
    fresh: opts.fresh || !old, agent: entry ? entry.agent : undefined, model: entry ? (entry.model ?? "") : undefined,
    template: oldTemplate?.command ? { name: oldTemplate.name, command: oldTemplate.command } : null,
    agy: { appHomeDir: appHome(), folder: key },
    // A new conversation on Claude runs on an id chosen here (RFC 0021 (f) 2); a resume keeps its own.
    newSession: newSessionId(),
  };
  let plan = restartPlan(planned);
  // The old pane's folder (#213: a worktree too, where its conversation is), unless it is gone;
  // the same space and tab (its Herdr labels).
  const oldCwd = old?.foreground?.cwd ?? old?.cwd ?? null;
  const cwd = wanted ?? (oldCwd && isDir(oldCwd) ? oldCwd : key);
  // --cwd: Claude resumes only within one folder slug (~/.claude/projects/<slug>), by id or --continue.
  const movedFrom = wanted && old && oldCwd ? (realDir(oldCwd) ?? oldCwd) : null;
  const slugMoved = movedFrom && claudeSlug(movedFrom) !== claudeSlug(wanted);
  if (slugMoved && plan.mode === "resume" && plan.agent === "claude") {
    throw new CliError(`Claude keeps ${bot.name}'s conversation under its folder's slug, ${claudeSlug(movedFrom)} (${movedFrom}); ${wanted} is `
      + `${claudeSlug(wanted)}, so a resume there would find nothing. Nothing was started. Restart with --fresh for a new conversation in ${wanted}, `
      + `or pick a folder whose slug is the same.`);
  }
  const place = opts.space ? { space: opts.space, tab: opts.tab ?? null, from: null } : (old ? placementFrom([old]) ?? undefined : undefined);
  let resumeId = plan.mode === "resume" && resumesById(plan.agent) ? sessionFor(plan.agent, known?.session) : null;
  // With no id, a resume takes the folder's latest conversation (--continue, codex resume
  // --last), for every agent: beside another bot on that agent there, a new conversation, and
  // why (#328: an omp --continue picked up a teammate's). Alone there, the resume as before.
  let sharedNote = null;
  if (plan.mode === "resume" && !resumeId) {
    const anywhere = continuesAnywhere(plan.agent);
    const sharers = await sharersOf({ view, cwd, botId: bot.id, file, agentKey: plan.agent, ledger, old, anywhere });
    const note = sharedFresh({ name: bot.name, old, cwd, sharers, agent: agentName(plan.agent), words: plan.resume.join(" "), anywhere });
    if (note) { plan = { ...restartPlan({ ...planned, fresh: true }), note }; sharedNote = note; }
  }
  // #598: dsh-tui's id-less -c only once a turn has finished in the old pane (hc's turn counter;
  // missing or unreadable is 0): else a new conversation, and why.
  if (plan.mode === "resume" && !resumeId && resumeAfterTurn(plan.agent) && !(Number.isSafeInteger(old?.turn) && old.turn >= 1)) {
    const note = noTurnNote(agents, plan.agent, old);
    plan = { ...restartPlan({ ...planned, fresh: true }), note };
    sharedNote = note;
  }
  const { tree, treeWarnings } = old && opts.tree
    ? await treePlans({ project, bot, old, helpers, view, ledger, agents, knownSession, force: opts.force, freshShared: opts["fresh-shared"],
      run: { who: bot.name, agent: plan.agent, cwd, session: resumeId, mode: plan.mode } })
    : { tree: [], treeWarnings: [] };
  // --tree: the old pane and its helpers idle first (no turn ends once two panes could hold the bot's session).
  let plans = tree;
  const early = [];
  if (tree.length) plans = await treeIdle(old, tree, (w) => early.push(w), { force: opts.force });
  // A resumed session keeps its label on the new pane, so the next restart resumes it too; a
  // template keeps its name in the worker.template label, so the next restart finds it again.
  const carry = { ...carriedLabels(old), ...(resumeId ? { [SESSION_LABEL]: resumeId } : {}),
    ...(plan.template ? { [WORKER_TEMPLATE_LABEL]: plan.template } : {}) };
  // The session the new pane runs, for its label and seat row: the id chosen for a new one, or the resumed one.
  const sessionOfPlan = (p, resumed) => p.sessionId ?? (p.mode === "resume" ? resumed : null);
  let seat = await launchSeat(project, bot, { agent: plan.agent, model: plan.model, argv: plan.argv, cwd, place,
    carry: { ...carry, ...(plan.sessionId ? { [SESSION_LABEL]: plan.sessionId } : {}) }, session: sessionOfPlan(plan, resumeId),
    replacing: old ? held.binding : null });
  if (seat.running) return opts.json ? { id: bot.id, running: seat.running } : `${bot.name} is already running in ${seat.running}.`;
  const warnings = seat.hook.warnings;
  const say = (w) => { warnings.push(w); report([w]); };
  // #597: the replacement is built from the bot's source (a live template's current command, or
  // bots.json), never the pane's copy; when they differ, one line names only flag names, values
  // masked, and a template by name.
  if (oldLaunch && !swap && (runningAgent === null || runningAgent === plan.agent)) {
    const changed = launchChange({ name: bot.name, launch: oldLaunch, agent: plan.agent, argv: plan.source, template: oldTemplate,
      usedTemplate: Boolean(plan.template) });
    if (changed) say(changed);
  }
  // The sidebar's Restart shows only --json's warnings: why it didn't resume goes there too
  // (the text answer says it in its own line).
  if (sharedNote) warnings.push(`${bot.name} starts on a new conversation: ${sharedNote}.`);
  if (movedFrom && movedFrom !== wanted && plan.mode === "resume" && plan.agent !== "claude") {
    say(`${seat.terminal} runs in ${wanted}, not ${movedFrom}: ${plan.agent} finds its last conversation by folder${resumeId ? "" : ", so it may not find it there"}.`);
  }
  if (!wanted && oldCwd && cwd !== oldCwd) say(`${old.address}'s folder ${oldCwd} isn't there now, so ${seat.terminal} runs in ${key}${plan.mode === "resume" ? "; its conversation may not be found there" : ""}.`);
  for (const w of [...treeWarnings, ...early]) say(w);
  let rerun = [];
  let oldEnded = false;
  // The old launch's end row (RFC 0021 (f) 4), written only after hc kill of it succeeded.
  const endOld = async () => {
    const unlogged = appendEnd(endRow({ kind: "seat", terminal: old.address, core: held.binding.core ?? await rowCore(),
      createdMs: held.binding.created_ms ?? old.created_ms, reason: "replaced" }));
    if (unlogged) say(unlogged);
  };
  if (old) {
    // The old pane ends only once the new one has kept its agent up: the space is never left empty.
    let up = await agentUp(seat.terminal);
    // Codex can't resume the thread at all (its model provider is gone, #413): one new pane on a
    // new thread, the old one named in the note; any other failure stays a failure.
    const gone = up.state === "ended" ? await endedCause(seat.terminal) : null;
    if (providerGone(plan, gone)) {
      const note = providerGoneNote(resumeId, seat.terminal, gone);
      plan = { ...restartPlan({ ...planned, fresh: true }), note };
      resumeId = null;
      say(`${bot.name} starts on a new conversation: ${note}.`);
      const again = await launchSeat(project, bot, { agent: plan.agent, model: plan.model, argv: plan.argv, cwd, place,
        carry: { ...carriedLabels(old), ...(plan.template ? { [WORKER_TEMPLATE_LABEL]: plan.template } : {}),
          ...(plan.sessionId ? { [SESSION_LABEL]: plan.sessionId } : {}) }, session: sessionOfPlan(plan, null), replacing: held.binding });
      if (again.running) throw new CliError(`${bot.name} is running in ${again.running} now, so no new pane was started; ${old.address} still runs it, untouched.`);
      for (const w of again.hook.warnings) say(w);
      seat = again;
      up = await agentUp(seat.terminal);
    }
    if (up.state !== "live") {
      // An abandoned replacement is ended (no seat row was written for it); the old pane stays.
      if (up.state === "ended") {
        throw await exitedBefore(seat.terminal, `${old.address} still runs ${bot.name}, untouched.`
          + (plan.mode === "resume" ? ` Try automagik-herdr restart ${bot.id} --fresh.` : ""));
      }
      const ended = (await hc(["kill", seat.terminal])).code === 0;
      throw new CliError(`${seat.terminal} didn't keep an agent in front within ${RESTART_WAIT_MS / 1000}s${ended ? ", so it was ended" : ` and couldn't be ended (hc kill ${seat.terminal})`}; `
          + `${old.address} still runs ${bot.name}, untouched.`);
    }
    // Up: the ledger moves the bot to the new terminal, under its lock.
    const created = Number.isSafeInteger(up.get?.created_ms) ? up.get.created_ms : seat.created_ms;
    let moved;
    try {
      if (!Number.isSafeInteger(created)) throw new CliError(`hc get gave no created_ms for ${seat.terminal}`);
      moved = await attachMoved(bot, held.binding, seat.terminal, created, key);
    } catch (e) {
      await hc(["kill", seat.terminal]);
      throw new CliError(`${seat.terminal} was ended and ${old.address} still runs ${bot.name}: the attach ledger wasn't written (${e?.message ?? e}).`);
    }
    if (moved.lost !== undefined) {
      await hc(["kill", seat.terminal]);
      throw new CliError(`${bot.name} was attached to ${moved.lost} while it restarted, so ${seat.terminal} was ended and nothing changed.`);
    }
    await seat.logSeat(created);
    // A session id carried onto the new pane, any harness (RFC 0021 (f) 5): a session row too.
    if (resumeId) {
      const unlogged = appendLedger(sessionRow({ terminal: seat.terminal, session: resumeId, transcript: known?.transcript ?? null,
        agent: plan.agent, core: await rowCore(), createdMs: created }));
      if (unlogged) say(unlogged);
    }
    // --tree: the old pane ends now, its helpers with it, so nothing types into a pane on the
    // bot's session while the new one runs it; then each helper runs again under the new pane.
    if (plans.length) {
      const k = await hc(["kill", old.address]);
      if (k.code === 0) {
        oldEnded = true;
        await endOld();
        rerun = await rerunHelpers(plans, seat.terminal, say);
      } else {
        const why = `${old.address} wasn't ended (hc kill: ${(k.stderr || k.stdout).trim()}), so its helpers still run under it`;
        say(`${why}; none was run again. End it with hc kill ${old.address}, then restart them.`);
        rerun = plans.map((q) => ({ name: q.name, replaced: q.replaced, terminal: null, bot: q.binding?.bot ?? null, agent: q.agent ?? null, mode: q.mode ?? null,
          session: q.session ?? null, up: false, note: q.note ?? null, error: why, by_hand: null, still_running: true }));
      }
    }
  }
  // A helper --tree couldn't run again: the command fails (the bot did restart; its line says how).
  if (rerun.some((h) => h.error)) exitAfter.code = 1;
  if (plan.mode === "resume" && !resumeId) {
    const name = agentName(plan.agent);
    say(`No ${name} session id was known for ${old.address}, so ${seat.terminal} resumes the latest conversation in ${cwd} (${plan.resume.join(" ")}). `
      + `No other bot's ${name} runs there; if it isn't ${bot.name}'s, restart again with --fresh.`);
  }
  let saved = false;
  if (opts.save) {
    // Written where the command runs (writeDirOf: a worktree's own file, #234).
    const now = loadProject(key, await writeDirOf(opts, key));
    const stored = now.raw.bots.find((b) => b?.id === bot.id);
    if (stored) {
      await saveProject(now, applyBotEdit(now.raw, { ...stored, agent: entry.agent, ...(entry.model ? { model: entry.model } : { model: undefined }) }), { list: false });
      saved = true;
    } else {
      // A worktree branched before the bot was added: its file has no entry to change.
      say(`--save: ${fileName(now)}, this worktree's file, has no ${bot.name} (${bot.id}), so ${plan.agent} wasn't saved; `
        + `update this worktree from the main checkout's branch, or restart with --save in ${key}.`);
    }
  }
  const what = old ? `${seat.terminal} replaces ${old.address}, ${restartText(plan, resumeId)}` : `${bot.name} wasn't running; started in ${seat.terminal}${swap ? ` on ${plan.agent}` : ""}`;
  // One line per helper --tree ran again (its new terminal), after the bot's.
  const helperLine = (h, i) => `${bot.name}'s helper ${h.name ?? h.replaced}: ${h.terminal
    ? `${h.terminal} replaces ${h.replaced}, ${restartText({ ...h, resume: plans[i].resume ?? [] }, h.session)}${h.up ? "" : " (not up: see above)"}`
    : `${h.replaced} wasn't run again (${h.still_running ? "it still runs" : h.by_hand ? "its hc run line is above" : "see above"})`}.`;
  const answer = () => {
    if (!opts.json) report([`${bot.name}: ${what}${saved ? `; ${BOTS_PATH} now says ${plan.agent}${plan.model ? ` (${plan.model})` : ""}` : ""}.`, ...rerun.map(helperLine)]);
    // The session ids themselves stay in the ledger: --json shows *** where one is known (RFC 0021).
    return opts.json ? { ...seatJson(bot, seat), replaced: old?.address ?? null, mode: old ? plan.mode : "start", agent: plan.agent, model: plan.model,
      session: resumeId ? SESSION_MASK : null, note: plan.note, saved, warnings,
      ...(opts.tree ? { helpers: rerun.map((h) => ({ ...h, session: h.session ? SESSION_MASK : null })) } : {}) } : seat.terminal;
  };
  if (!old || oldEnded || (opts.tree && plans.length)) return answer();
  // A bot restarting itself runs this inside the pane the kill ends: everything is written and
  // printed first, then the kill, the last thing it does.
  if (process.env.HC_TERMINAL_ID && [old.address, old.name].includes(process.env.HC_TERMINAL_ID)) {
    const out = answer();
    // Flushed (a pipe's write can be asynchronous) before the kill takes this process with it.
    await new Promise((done) => process.stdout.write(unprinted(opts.json ? `${JSON.stringify(out, null, 2)}\n` : `${out}\n`), done));
    await new Promise((done) => process.stderr.write("", done));
    // The end row only once the kill succeeded: this process usually ends with the pane first,
    // and then the old launch has none (usagemeter's snapshot ends it instead).
    if ((await hc(["kill", old.address])).code === 0) await endOld();
    return PRINTED;
  }
  const killed = await hc(["kill", old.address]);
  if (killed.code !== 0) say(`${old.address} wasn't ended (hc kill: ${(killed.stderr || killed.stdout).trim()}); end it with hc kill ${old.address}.`);
  else await endOld();
  return answer();
}

const BOT_ID_SHAPE = /^b-[a-z2-7]{10}$/;

/** Where a holder plays, for a refusal: `t7 (since 2026-11-02T10:00:00.000Z)`. */
const heldAt = (b) => `${b.machine ? `${b.machine}/` : ""}${b.terminal} (since ${b.at})`;

/**
 * Where a terminal named on the command line runs: { machine, core, address, bare }. A
 * "<machine>/tN" (or a bare id with --machine) is on that linked machine, which must be the
 * project's and be connected; `core` is then its core id, else null (this computer's).
 */
async function terminalPlace(terminal, project) {
  const slash = terminal.indexOf("/");
  const named = slash >= 0 ? terminal.slice(0, slash) : null;
  const bare = slash >= 0 ? terminal.slice(slash + 1) : terminal;
  if (!/^[A-Za-z0-9._-]+$/.test(bare) || bare.startsWith("-")) throw new CliError(`"${terminal}" isn't a terminal; name one like t7 or ${project.machine ?? "machine"}/t7.`, 2);
  if (named && named !== project.machine) {
    throw new CliError(`${terminal} is on ${named}; name the bot's project there: --machine ${named} --project <its folder there>.`, 2);
  }
  const machine = project.machine ?? null;
  if (!machine) return { machine: null, core: null, address: bare, bare };
  const m = await connectedMachine(machine, "nothing was attached");
  return { machine, core: m.id, address: `${machine}/${bare}`, bare };
}

/** Why a Claude bot on a linked machine has no briefing hook yet (automagik#206 part b2). */
const noHookThere = (bot, machine) => `${bot.name} runs on ${machine} without its per-turn briefing: the hook needs automagik-herdr `
  + `installed on ${machine}, which comes next (automagik-herdr machine install ${machine}). Its role and team still come from ${BOTS_PATH}.`;

async function cmdAttach(opts, [ref, terminal]) {
  if (!terminal) throw new CliError("attach needs a bot and a terminal: automagik-herdr attach <bot> <terminal> [--move].", 2);
  if (terminal.startsWith("-")) throw new CliError(`"${terminal}" isn't a terminal; name one like t7.`, 2);
  const project = await projectFor(opts);
  const { file, key } = project;
  const at = await terminalPlace(terminal, project);
  const bot = await botIn(project, ref, opts);
  if (bot.planned) throw new CliError(`${bot.name} is planned (wave ${bot.planned.wave}); clear "planned" before attaching it.`);
  const get = await hcGet(at.address);
  if (!get || get.state !== "live") throw new CliError(`${at.address} isn't a live terminal.`);
  const address = get.address ?? at.address;
  // The row's terminal is hc's id, never the name typed ("mypane"): whois asks by id.
  const bareId = address.includes("/") ? address.slice(address.indexOf("/") + 1) : address;
  if (at.machine && !address.startsWith(`${at.machine}/`)) throw new CliError(`hc get ${at.address} answered for ${address}; nothing was attached.`);
  if (!Number.isSafeInteger(get.created_ms)) throw new CliError(`hc get ${address} gave no created_ms; nothing was attached.`);
  const nameOf = (id) => { const n = file.bots.find((b) => b.id === id)?.name; return n ? `${n} (${id})` : `bot ${id}`; };
  const playsAnother = (b) => new CliError(`${address} already plays ${nameOf(b.bot)}, since ${b.at}; nothing was attached. `
    + `Detach that bot first: automagik-herdr detach ${b.bot}`);
  // Another bot's pane is refused first, by this run's view (and again under the lock).
  const seen = (await attachView()).byTerminal.get(address)?.binding;
  if (seen && seen.bot !== bot.id && seen.created_ms === get.created_ms) throw playsAnother(seen);
  // Claude by its report, its foreground, or a wrapper whose argv runs claude (models.js).
  const claude = isClaude({ report: { app: get.status?.app } }, get) || agentKeyOfArgv(get.foreground?.argv) === "claude";
  let sessionFolder = get.foreground?.cwd ?? get.cwd ?? null;
  if (claude) {
    if (!get.foreground?.cwd) throw new CliError(`Can't read where ${address}'s Claude session runs (hc get ${address}); nothing was attached.`);
    sessionFolder = get.foreground.cwd;
    const sessionKey = at.machine ? (await remoteProjectOf(at.machine, sessionFolder)).key : await keyOf(sessionFolder);
    const refusal = attachRefusal({ botName: bot.name, projectKey: key, sessionFolder, sessionKey });
    if (refusal) throw new CliError(refusal);
  }
  // The ledger decides, under its lock: the terminal held by another bot is refused, and so is
  // the bot held by another terminal unless --move, which writes its detach (moved) first.
  const decided = await underLedger(async ({ core, machines, heldBy, byKey, holds, write }) => {
    const here = await holds(byKey.get(attachKey({ core: at.core ?? core, terminal: bareId, created_ms: get.created_ms })));
    if (here && here.binding.bot !== bot.id) throw playsAnother(here.binding);
    if (here) return { already: true, movedFrom: null };
    const mine = await holds(heldBy(bot.id, at.core));
    if (mine && !opts.move) {
      throw new CliError(`${bot.name} (${bot.id}) is attached to ${heldAt(mine.binding)}; nothing was attached. `
        + `Move it with: automagik-herdr attach ${bot.id} ${address} --move (or detach it first).`);
    }
    const rows = mine ? [closingRow(mine.binding, "detach", "attach", "moved")] : [];
    rows.push(attachRow({ event: "attach", bot: bot.id, project: key, terminal: bareId, core: at.core ?? core, created_ms: get.created_ms,
      machine: at.machine, by: "attach" }));
    write(rows);
    return { already: false, movedFrom: mine ? addressOf(mine.binding, machines) : null };
  });
  const warnings = [];
  const label = async (t, words) => {
    if (!words.length) return;
    const r = await hc(["label", t, ...words]);
    if (r.code !== 0) warnings.push(`the ledger has it, but hc label ${t} ${words.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  };
  // The labels follow as a display hint: off the old pane, then bot, role, category and a
  // squad copied from the lead (A16) on this one. A label failure only warns.
  if (decided.movedFrom) {
    const old = await hcGet(decided.movedFrom).catch(() => null);
    if (old?.state === "live") await label(decided.movedFrom, detachWords(old.labels ?? {}));
  }
  const have = get.labels ?? {};
  if (have[BOT_LABEL] !== bot.id) await label(address, [`${BOT_LABEL}=${bot.id}`]);
  const lead = leadIdOf(file, bot.id);
  let leadRows = [];
  try { leadRows = lead ? await liveRows(lead) : []; } catch { leadRows = []; }
  await label(address, attachWords(file, bot.id, { ...have, [BOT_LABEL]: bot.id }, leadRows));
  const hook = claude && !at.machine ? await writeBriefingHook(bot, sessionFolder) : { written: false, warnings: [] };
  if (claude && at.machine) hook.warnings.push(noHookThere(bot, at.machine));
  hook.warnings.unshift(...warnings);
  // The workers ledger's seat rows are this computer's (restart's session lookup).
  if (!decided.already && !at.machine) {
    const argv = get.foreground?.argv;
    const seatAgent = agentKeyOfArgv(argv, agentTable()) ?? (claude ? "claude" : bot.agent ?? null);
    const unlogged = appendLedger(startRow({ kind: "seat", terminal: address, pid: get.foreground?.pid ?? get.pid ?? null, botId: bot.id,
      worktree: sessionFolder, project: key, agent: seatAgent, model: detectModel(argv, seatAgent), ...seatTags(file, bot.id),
      core: await rowCore(), createdMs: get.created_ms }));
    if (unlogged) hook.warnings.push(unlogged);
  }
  if (hook.written) hook.warnings.push(`${bot.name}'s briefing hook was added while its Claude session was running. If its next prompt brings no briefing, restart the bot: automagik-herdr restart ${bot.id} (or the bot row's Restart).`);
  report(hook.warnings);
  if (!project.machine) listProject(key);
  const movedFrom = decided.movedFrom ? [decided.movedFrom] : [];
  // A linked machine's terminal goes as its bare id beside `machine`, as the ledger holds it.
  if (opts.json) return { id: bot.id, terminal: at.machine ? bareId : address, ...(at.machine ? { machine: at.machine } : {}),
    already: decided.already, movedFrom, hookWritten: hook.written, warnings: hook.warnings };
  if (decided.already) return `${bot.name} is already ${address}.`;
  return `${bot.name} is now ${address}${movedFrom.length ? ` (moved from ${movedFrom[0]})` : ""}.`;
}

async function cmdDetach(opts, [ref]) {
  // A bare id needs no definition: a bot removed with rm can still be detached.
  const bareId = BOT_ID_SHAPE.test(ref ?? "");
  let bot = null;
  try { bot = findBot((await projectFor(opts)).file, ref); } catch (e) { if (!bareId || !(e instanceof CliError)) throw e; }
  const id = bot?.id ?? ref;
  const name = bot?.name ?? `bot ${id}`;
  const place = opts.machine !== undefined ? (await connectedMachine(opts.machine, "nothing was detached")).id : null;
  const key = opts.machine !== undefined && bot ? (await projectFor(opts)).key : null;
  const held = await underLedger(async ({ machines, heldBy, holds, write }) => {
    const mine = await holds(heldBy(id, place));
    if (mine && key && mine.binding.project !== key) return null;
    if (!mine) return null;
    write([closingRow(mine.binding, "detach", "detach")]);
    return { address: addressOf(mine.binding, machines), binding: mine.binding };
  });
  const from = held?.address ?? null;
  // The labels, a display hint, come off the detached pane and any other local pane carrying
  // them. A16: role= and category= go with bot=; squad= only when this pack copied it there.
  // The row is written already: a failure here only warns.
  const cleared = [];
  try {
    // --machine: that machine's pane only; this computer's panes carrying the id are another bot.
    const { addresses, gets } = place ? { addresses: [], gets: [] } : await paneOf(id, hcJson, { localOnly: true });
    for (const t of new Set([...(from ? [from] : []), ...addresses])) {
      const have = gets.find((g) => g?.address === t)?.labels ?? (await hcGet(t).catch(() => null))?.labels ?? {};
      if (have[BOT_LABEL] !== id) continue;
      const words = detachWords(have);
      const r = await hc(["label", t, ...words]);
      if (r.code !== 0) report([`${name} is detached, but hc label ${t} ${words.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`]);
      else cleared.push(t);
    }
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    report([`${name} is detached${from ? ` from ${from}` : ""}, but its labels weren't cleared: ${e.message}`]);
  }
  const detached = held ? [held.binding.terminal] : [];
  const machine = held?.binding.machine ?? null;
  return opts.json ? { id, defined: Boolean(bot), detached, ...(machine ? { machine } : {}), labelsCleared: cleared }
    : from ? `${name} detached from ${from}.` : `${name} has no pane on this computer.`;
}

// ---- import (#232): a running hc team as bots ----

// The squad's captain by its hc name or template, when no seat of the squad is labelled
// role=captain: the squad's name, a separator, then cap or captain (web-cap, web_captain), so
// escape-cap is no captain of web, and a bare "cap" none at all (#486).
const CAPTAIN_NAME = /^(.+)[-_.](cap|captain)$/i;
// A member's rank by its name's last word, when its pane's role= label is not a rank.
const RANK_WORDS = { dev: "dev", test: "tester", tester: "tester", qa: "tester", review: "reviewer", reviewer: "reviewer",
  fix: "fixer", fixer: "fixer", pm: "pm", int: "integrator", integrator: "integrator" };
const byTerminal = (a, b) => a.terminal.localeCompare(b.terminal, undefined, { numeric: true });

/** How a seat is its squad's captain by name (#486): "name", "template" or null; never a seat whose role= is another rank. */
function captainByName(squad, seat) {
  const role = seat.get.labels?.role;
  if (RANKS.includes(role) && role !== "captain") return null;
  const of = (n) => typeof n === "string" && CAPTAIN_NAME.exec(n.trim())?.[1].toLowerCase() === squad.toLowerCase();
  return of(seat.name) ? "name" : of(seat.get.template) ? "template" : null;
}

function seatRank(get, name) {
  const role = get.labels?.role;
  if (RANKS.includes(role) && role !== "captain") return role;
  return RANK_WORDS[name.toLowerCase().split(/[-_.]/).pop()] ?? null;
}

/**
 * The import's plan (#232): { seats, skipped, conflicts, raw }, from this computer's live panes
 * labelled `label`=. A seat is one with an hc name and an agent in front: "already" (it plays the
 * bot of its name, by the attach ledger), "attach" (that bot is defined and attached nowhere, as
 * a run cut short before its attaches leaves it) or "create" (then attach). Captains first, every
 * new bot is checked as create checks it against the file as the plan grows it; `raw` is that
 * file. Nothing is written here; readOnly (the dry run, #486) keeps the ledger view from
 * writing too (attachView).
 */
async function importPlan(project, label, { readOnly = false } = {}) {
  const { file } = project;
  const main = mainBotOf(file);
  const conflicts = [];
  const skipped = [];
  if (!main) {
    conflicts.push(`${under(project.key, BOTS_PATH)} has no main bot; the import makes captains and members under it. `
      + "Create it first: automagik-herdr create --name N --agent A");
  }
  const rows = rowsOf(await hcJson(["ls"])).filter((r) => local(r?.address) && r.state !== "finished");
  const gets = (await Promise.all(rows.map(async (r) => {
    const g = await hcLookup(r.address);
    return g ? { ...g, address: g.address ?? r.address, name: g.name ?? r.name ?? null } : null;
  }))).filter((g) => g?.state === "live" && local(g.address) && typeof g.labels?.[label] === "string" && g.labels[label].trim());
  const view = await attachView({ readOnly });
  const agents = agentTable();
  const botName = (id) => { const b = file.bots.find((x) => x.id === id); return b ? `${b.name} (${b.id})` : `bot ${id}`; };
  const seats = [];
  for (const get of gets) {
    const terminal = get.address;
    const name = typeof get.name === "string" && get.name.trim() && get.name !== terminal ? get.name.trim() : null;
    const seat = { squad: get.labels[label].trim(), terminal, name, agent: null, rank: null, captain: false, action: "create", id: null, get };
    const named = name ? file.bots.find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? null : null;
    const at = `${terminal}${name ? ` (${name})` : ""}`;
    const held = view.byTerminal.get(terminal)?.binding ?? null;
    if (held) {
      if (named && held.bot === named.id) {
        // Its labels as attach sets them (#486): lost ones come back by attaching again, which
        // writes no ledger row for a pane that already plays its bot.
        const have = get.labels ?? {};
        const lead = leadIdOf(file, named.id);
        let leadRows = [];
        try { leadRows = lead ? await liveRows(lead) : []; } catch { leadRows = []; }
        const relabel = [...(have[BOT_LABEL] !== named.id ? [`${BOT_LABEL}=${named.id}`] : []),
          ...attachWords(file, named.id, { ...have, [BOT_LABEL]: named.id }, leadRows)];
        seats.push({ ...seat, action: "already", id: named.id, bot: named, relabel });
        continue;
      }
      conflicts.push(`${at} already plays ${botName(held.bot)}; the import never takes another bot's pane. Detach that bot `
        + `first, or take ${label}= off the pane (hc label ${terminal} ${label}=).`);
      continue;
    }
    if (get.labels[WORKER_OF_LABEL]) { skipped.push({ terminal, name, why: "a worker (worker.of), not a seat" }); continue; }
    if (!name) { skipped.push({ terminal, name, why: "no hc name to name its bot by" }); continue; }
    const claude = isClaude({ report: { app: get.status?.app } }, get) || agentKeyOfArgv(get.foreground?.argv) === "claude";
    const agent = agentKeyOfArgv(get.foreground?.argv, agents) ?? (claude ? "claude" : null);
    if (!agent) { skipped.push({ terminal, name, why: "no coding agent in front" }); continue; }
    const tagged = get.labels[BOT_LABEL];
    if (tagged && tagged !== named?.id && file.bots.some((b) => b.id === tagged)) {
      conflicts.push(`${at} is labelled ${BOT_LABEL}=${tagged}, ${botName(tagged)}; the import never takes another bot's pane.`);
      continue;
    }
    if (claude) {
      const cwd = get.foreground?.cwd;
      if (!cwd) { conflicts.push(`Can't read where ${at}'s Claude session runs (hc get ${terminal}).`); continue; }
      const refusal = attachRefusal({ botName: name, projectKey: project.key, sessionFolder: cwd, sessionKey: await keyOf(cwd) });
      if (refusal) { conflicts.push(`${at}: ${refusal}`); continue; }
    }
    if (named) {
      const there = liveFor(view, named.id, project);
      if (there) {
        conflicts.push(`${botName(named.id)} already plays ${there.binding.terminal}, not ${terminal}; the import never moves a bot. `
          + `Detach it first (automagik-herdr detach ${named.id}), or give the seat another hc name.`);
        continue;
      }
      if (named.kind === "main" || named.planned) {
        conflicts.push(`${at}: ${botName(named.id)} is ${named.kind === "main" ? "the main bot" : "planned"}, so the import can't make it a squad's seat.`);
        continue;
      }
      if (named.agent && named.agent !== agent) {
        conflicts.push(`${at} runs ${agent}, and ${botName(named.id)} is defined with agent ${named.agent}; the import never attaches `
          + `a bot to another agent's pane. Edit it first (automagik-herdr edit ${named.id} --agent ${agent}), or give the seat another hc name.`);
        continue;
      }
      seats.push({ ...seat, agent, action: "attach", id: named.id, bot: named });
      continue;
    }
    seats.push({ ...seat, agent });
  }
  const byName = new Map();
  for (const s of seats) byName.set(s.name.toLowerCase(), [...(byName.get(s.name.toLowerCase()) ?? []), s.terminal]);
  for (const [n, ts] of byName) if (ts.length > 1) conflicts.push(`${ts.join(", ")} share the hc name "${n}"; names pick bots, so rename all but one.`);
  // Each squad: its one captain first, then its members by terminal.
  const ordered = [];
  const squads = new Map();
  for (const s of seats) squads.set(s.squad, [...(squads.get(s.squad) ?? []), s]);
  for (const squad of [...squads.keys()].sort()) {
    const all = squads.get(squad).sort(byTerminal);
    const labelled = all.filter((s) => s.get.labels?.role === "captain");
    const caps = labelled.length ? labelled : all.filter((s) => captainByName(squad, s));
    const by = labelled.length ? "role" : caps.length === 1 ? captainByName(squad, caps[0]) : null;
    if (caps.length !== 1) {
      conflicts.push(caps.length
        ? `Squad ${squad} has ${caps.length} captains (${caps.map((s) => `${s.terminal} ${s.name}`).join(", ")}); keep role=captain on one: hc label <terminal> role=captain.`
        : `Squad ${squad} has no captain: label one pane role=captain (hc label <terminal> role=captain), or name it ${squad}-cap.`);
      continue;
    }
    for (const s of [caps[0], ...all.filter((x) => x !== caps[0])]) {
      s.captain = s === caps[0];
      s.captainBy = s.captain ? by : null;
      s.lead = s.captain ? main : null;
      s.rank = s.captain ? "captain" : seatRank(s.get, s.name);
      if (!s.captain) s.leadSeat = caps[0];
      ordered.push(s);
    }
  }
  if (!main) return { seats: ordered, skipped, conflicts, raw: project.raw };
  // A defined bot is attached only where the plan would have put it: same lead.
  let raw = project.raw;
  let grown = file;
  for (const s of ordered) {
    const leadId = s.captain ? main.id : s.leadSeat.id;
    if (s.action === "attach") {
      const has = s.bot.lead ?? main.id;
      if (!leadId || has !== leadId) {
        conflicts.push(`${s.terminal} (${s.name}): ${botName(s.bot.id)} is defined with lead ${botName(has)}, and the import would `
          + `make it ${s.captain ? `the ${s.squad} captain, under ${botName(main.id)}` : `report to ${s.leadSeat.name}`}. Edit it first.`);
      }
      continue;
    }
    if (s.action !== "create") continue;
    if (!leadId) continue; // its captain is refused above
    const id = newBotId();
    try {
      const entry = entryFrom({ name: s.name, agent: s.agent, rank: s.rank ?? undefined, lead: s.captain ? undefined : leadId,
        role: s.captain ? `Captain of the ${s.squad} squad` : `Member of the ${s.squad} squad` }, { id, kind: "member" }, { file: grown }, { creating: true });
      raw = applyBotEdit(raw, entry);
      grown = parseBots(JSON.stringify(raw)).file;
      s.id = id;
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      conflicts.push(`${s.terminal} (${s.name}): ${e.message}`);
    }
  }
  return { seats: ordered, skipped, conflicts, raw };
}

/** A seat as the plan prints it; a new bot's id only once it is made. captainBy: "role", "name", "template" or null. */
const seatOut = (s, made) => ({ squad: s.squad, terminal: s.terminal, name: s.name, action: s.action, captain: s.captain, captainBy: s.captainBy ?? null,
  lead: s.captain ? (s.lead?.name ?? null) : s.leadSeat.name, rank: s.action === "create" ? s.rank : (s.bot.rank ?? null),
  agent: s.agent ?? s.bot?.agent ?? null, id: s.action === "create" && !made ? null : s.id, relabel: s.relabel ?? [] });
/** A seat --apply attaches: every one but a seat already playing its bot with all its labels (#486). */
const importTodo = (s) => s.action !== "already" || s.relabel.length > 0;
const CAPTAIN_BY = { role: " by role=captain", name: " by name", template: " by template" };

function importText(plan, { key, label, apply }) {
  const lines = [`Import of the panes labelled ${label}= into ${key}${apply ? "" : " (dry run: nothing is changed)"}:`];
  if (!plan.seats.length && !plan.skipped.length && !plan.conflicts.length) lines.push(`  No live pane on this computer is labelled ${label}=.`);
  let squad = null;
  for (const s of plan.seats) {
    if (s.squad !== squad) { squad = s.squad; lines.push(`  squad ${squad}`); }
    const who = s.captain ? `captain${CAPTAIN_BY[s.captainBy] ?? ""}, reports to ${s.lead?.name ?? "the main bot"}` : `member, lead ${s.leadSeat.name}${s.rank ? `, rank ${s.rank}` : ""}`;
    lines.push(`    ${s.terminal}  ${s.action === "already" ? `${s.name} (${s.id}) already plays it: ${s.relabel.length ? `its lost labels go back (${s.relabel.join(" ")})` : "nothing to do"}`
      : s.action === "attach" ? `attach ${s.name} (${s.id}), defined already`
        : `create ${s.name} (${who}, ${s.agent}), then attach`}`);
  }
  for (const k of plan.skipped) lines.push(`  skipped ${k.terminal}${k.name ? ` (${k.name})` : ""}: ${k.why}`);
  for (const c of plan.conflicts) lines.push(`  conflict: ${c}`);
  const todo = plan.seats.filter(importTodo).length;
  if (plan.conflicts.length) lines.push(`Nothing was changed: ${plan.conflicts.length} conflict(s) refuse the import.`);
  else if (!todo) lines.push("Nothing to do: every seat already plays its bot.");
  else if (!apply) lines.push(`Run it with --apply: ${todo} seat(s) to import.`);
  return lines.join("\n");
}

async function cmdImport(opts) {
  if (!opts["from-hc"]) throw new CliError("import needs its source: automagik-herdr import --from-hc [--squad-label L] [--apply].", 2);
  const label = opts["squad-label"] ?? "squad";
  if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new CliError(`--squad-label: "${label}" isn't an hc label key.`, 2);
  const project = await editProjectFor(opts);
  if (project.dir !== project.key) {
    throw new CliError(`Run the import in ${project.key}: attach reads ${under(project.key, BOTS_PATH)}, and from this worktree the bots `
      + `would go to ${under(project.dir, BOTS_PATH)}. Nothing was changed.`);
  }
  const plan = await importPlan(project, label, { readOnly: !opts.apply });
  const apply = Boolean(opts.apply) && !plan.conflicts.length;
  const todo = plan.seats.filter(importTodo);
  const out = { project: project.key, squadLabel: label, dryRun: !opts.apply, seats: plan.seats.map((s) => seatOut(s, false)),
    skipped: plan.skipped, conflicts: plan.conflicts, attached: [], stopped: null };
  if (plan.conflicts.length) {
    exitAfter.code = 1;
    report([`import refused, nothing was changed: ${plan.conflicts.length} conflict(s).`]);
  }
  if (!opts.json) process.stdout.write(`${importText(plan, { key: project.key, label, apply: Boolean(opts.apply) })}\n`);
  if (apply && todo.length) {
    // One write for every new bot, then one attach per seat, captains first: attach checks
    // again under the ledger's lock and never moves a bot (no --move).
    if (todo.some((s) => s.action === "create")) {
      await saveProject(project, plan.raw);
      await relabelAfter(project.file, plan.raw);
    }
    for (const s of todo) {
      try {
        const r = await cmdAttach({ project: opts.project, json: true }, [s.id, s.terminal]);
        out.attached.push({ id: s.id, name: s.name, terminal: s.terminal, created: s.action === "create", already: r.already, warnings: r.warnings });
        const now = s.action === "already" ? "is" : "is now";
        if (!opts.json) process.stdout.write(`  ${s.name} (${s.id}) ${now} ${s.terminal}${s.action === "create" ? ", created" : s.action === "already" ? ", its labels back" : ""}.\n`);
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        out.stopped = { terminal: s.terminal, name: s.name, error: e.message };
        exitAfter.code = 1;
        report([`import stopped at ${s.terminal} (${s.name}): ${e.message} The bots made so far are saved; run the import again to attach the rest.`]);
        break;
      }
    }
    out.seats = plan.seats.map((s) => seatOut(s, true));
    await tidyQuietly();
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return PRINTED;
}

async function cmdWhois(opts, [terminal]) {
  if ((opts.bot === undefined) === (terminal === undefined)) {
    throw new CliError("whois needs a terminal or --bot <id>: automagik-herdr whois <terminal> | whois --bot <id>.", 2);
  }
  if (opts.bot !== undefined) {
    const id = BOT_ID_SHAPE.test(opts.bot) || opts.bot.startsWith("session-") ? opts.bot : findBot((await projectFor(opts)).file, opts.bot).id;
    // --machine: the bot's binding on that linked machine (its core), else this computer's.
    const there = opts.machine !== undefined ? await connectedMachine(opts.machine, "nothing to answer") : null;
    const view = await attachView();
    const held = there ? view.liveAt.get(atKey(id, there.id)) ?? null : view.live.get(id);
    const out = held ? whoisOf(held) : { terminal: null, core: there ? there.id : view.core, created_ms: null, bot: id, project: null, since: null };
    if (opts.json) return out;
    return held ? `${id} plays in ${addressOf(held.binding, view.machines)} (${out.project}) since ${out.since}.` : `${id} is attached to no terminal.`;
  }
  if (terminal.startsWith("-")) throw new CliError(`"${terminal}" isn't a terminal; name one like t7.`, 2);
  // A linked machine's terminal, "<machine>/tN": the answer keeps whois' shape, its terminal
  // the bare id and its core that machine's, as the ledger holds them; never the address.
  // A bare id with --machine is that machine's.
  if (opts.machine !== undefined && !terminal.includes("/")) terminal = `${opts.machine}/${terminal}`;
  const slash = terminal.indexOf("/");
  const there = slash >= 0 ? await connectedMachine(terminal.slice(0, slash), "nothing to answer") : null;
  const view = await attachView();
  const get = await hcLookup(terminal);
  const address = get?.address ?? terminal;
  const held = view.byTerminal.get(address);
  const out = held ? whoisOf(held)
    : { terminal: there ? address.slice(address.indexOf("/") + 1) : address, core: there ? there.id : view.core, created_ms: get?.created_ms ?? null, bot: null };
  if (opts.json) return out;
  return held ? `${address} plays ${out.bot} (${out.project}) since ${out.since}.` : `${address} plays no bot.`;
}

/** `value` with every string in it rid of each id in `ids` (shown as SESSION_MASK), objects and arrays walked. */
function scrubIds(value, ids) {
  if (!ids.size) return value;
  if (typeof value === "string") { let out = value; for (const id of ids) out = out.split(id).join(SESSION_MASK); return out; }
  if (Array.isArray(value)) return value.map((x) => scrubIds(x, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubIds(v, ids)]));
  return value;
}

async function cmdHistory(opts, [ref]) {
  // A bare id needs no definition (as detach): a removed bot's history is still there.
  const bareId = BOT_ID_SHAPE.test(ref ?? "");
  let bot = null;
  try { bot = findBot((await projectFor(opts)).file, ref); } catch (e) { if (!bareId || !(e instanceof CliError)) throw e; }
  const id = bot?.id ?? ref;
  const ledgerRows = workerLedgerRows();
  // RFC 0021: no session id is printed, in --json or text: every id the ledger holds is shown as
  // *** wherever it appears (its rows, the timeline, a transcript path named after it).
  const ids = new Set(ledgerRows.map((r) => holdId(r?.session)).filter((x) => typeof x === "string" && x.length >= 4));
  const h = scrubIds(botHistory({ attachRows: readAttachFile() ?? [], ledgerRows, botId: id }), ids);
  if (opts.json) return { id, name: bot?.name ?? null, ...h };
  const { timeline, workers, transcript } = historyLines(h);
  return [
    `${bot?.name ?? `bot ${id}`} (${id})`,
    "  what happened", ...(timeline.length ? timeline.map((e) => `    ${e.text}`) : ["    nothing recorded on this computer"]),
    ...(workers.length ? ["  workers", ...workers.map((w) => `    ${w}`)] : []),
    ...(transcript ? [`  transcript   ${transcript}`] : []),
  ].join("\n");
}

async function cmdBrief(opts, [ref]) {
  const project = await projectFor(opts);
  const bot = await botIn(project, ref, opts);
  if (bot.planned) {
    if (opts.json) return { id: bot.id, briefing: null, reason: "planned bots get no briefing" };
    process.stderr.write(`automagik-herdr: ${bot.name} is planned; planned bots get no briefing.\n`);
    return "";
  }
  // briefing.mjs' own gathering; a failed hc call reads as "no answer" (unreachable), as
  // it does in the hook, so the briefing still prints.
  const ask = async (args) => { try { return await hcJson(args); } catch (e) { if (e instanceof CliError) return UNANSWERED; throw e; } };
  // The panes by the attach ledger, as this run's view confirms them; with hc failing, every
  // pane reads as unreachable, as a failed call does in the hook.
  const { view } = await viewOrError();
  const locate = async (id) => {
    if (!view) return { get: null, duplicate: false, addresses: [], gets: [], unreachable: true };
    const held = view.live.get(id);
    if (!held) return { get: null, duplicate: false, addresses: [], gets: [] };
    const get = { ...held.get, address: held.get?.address ?? held.binding.terminal };
    return { get, duplicate: false, addresses: [get.address], gets: [get] };
  };
  const self = await locate(bot.id);
  const text = await gatherBriefing({ file: project.file, bot, address: self.get?.address ?? null, ask, locate, isGit: await projectIsGit(project) });
  return opts.json ? { id: bot.id, briefing: text } : text;
}

// ---- workers: a bot's one worker per task ----

/**
 * The folders that may hold the calling pane's project, most telling first: its foreground's
 * folder (where the agent works now), the folders of the other terminals in its Herdr space
 * (one space = one project; the sidebar's own rule, from hc alone so no window is needed),
 * its launch folder, this command's folder, then the remembered projects. Fallbacks only: callingBot
 * asks the attach binding's project first, and keeps the hints whose bots file defines the bot.
 */
async function botProjectHints(me, address) {
  const hints = [me.foreground?.cwd];
  const space = me.labels?.[SPACE_LABEL];
  if (space) {
    try {
      const peers = rowsOf(await hcJson(["ls", "--label", `${SPACE_LABEL}=${space}`]));
      hints.push(...peers.filter((r) => local(r?.address) && r.address !== address && r.state === "live").map((r) => r.cwd));
    } catch { /* hc ls failing: the space gives no hint */ }
  }
  hints.push(me.cwd, process.cwd());
  return [...hints.filter((h) => typeof h === "string" && h.startsWith("/")), ...rememberedKeys()];
}

/**
 * The projects among `folders` whose bots file defines `botId`, in the folders' order, each
 * once: [{ key, project, bot }]. A folder gone, outside any project or with a bots file that
 * doesn't parse is skipped (another project's broken file never blocks this bot).
 */
async function projectsDefining(botId, folders) {
  const seen = new Set();
  const found = [];
  for (const folder of folders) {
    let key;
    try { key = await keyOf(folder); } catch { continue; }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let project;
    try { project = loadProject(key); } catch { continue; }
    const bot = project.file.bots.find((b) => b.id === botId);
    if (bot) found.push({ key, project, bot });
  }
  return { found, looked: [...seen] };
}

/** A project (by key) as { key, project, bot } when its bots file defines `botId`, else null. */
function definedIn(key, botId, { strict = false } = {}) {
  let project;
  try { project = loadProject(key); } catch (e) { if (strict) throw e; return null; }
  const bot = project.file.bots.find((b) => b.id === botId);
  return bot ? { key, project, bot } : null;
}

/**
 * The bot whose pane runs this command: { me (hc get), bot, project }. Anyone else is refused.
 * The bot is the attach ledger's binding of the pane, never its label. Its project is the one
 * whose bots file defines it: `--project` when that one does; else the project the binding
 * names (attach.js: the bot's main checkout) when it does; else the one project among the
 * fallbacks (botProjectHints) that does. Two fallbacks defining it are refused, never chosen between.
 */
async function callingBot(opts) {
  const self = process.env.HC_TERMINAL_ID;
  if (!self) throw new CliError("Only a bot starts workers, from its own pane: HC_TERMINAL_ID isn't set here, so this isn't a bot's pane.");
  const me = await hcGet(self);
  if (!me) throw new CliError(`${self} isn't a terminal hc knows; start workers from a bot's pane.`);
  const address = me.address ?? self;
  // Named before the ledger is read: its one-time label import looks in a --project too.
  const named = opts.project !== undefined ? await namedKeyOf(opts.project) : null;
  if (named) namedKeys.add(named);
  // Which bot this pane plays is the attach ledger's answer, never its label.
  const binding = (await attachView()).byTerminal.get(address)?.binding;
  const botId = binding?.bot;
  if (!botId) throw new CliError(await unboundRefusal(me, address));
  // The named project as namedKeyOf keys it (never a parent's); its bots file must parse.
  let hit = named ? definedIn(named, botId, { strict: true }) : null;
  if (!hit && !named && typeof binding.project === "string") hit = definedIn(binding.project, botId);
  if (!hit) {
    const hints = [...(typeof binding.project === "string" ? [binding.project] : []), ...await botProjectHints(me, address)];
    const { found, looked } = await projectsDefining(botId, hints);
    const defining = found.filter((f) => f.key !== named);
    if (named) {
      const which = defining.length ? `it's defined in ${defining.map((f) => f.key).join(" and ")}` : "no project here defines it";
      throw new CliError(`--project ${named} doesn't define bot ${botId}, which ${address} plays (${under(named, BOTS_PATH)}); ${which}. `
        + "A bot starts workers only in its own project.");
    }
    if (defining.length > 1) {
      throw new CliError(`${address} plays bot ${botId}, which ${defining.length} projects define: ${defining.map((f) => f.key).join(", ")}. `
        + "Pick its project with --project <folder>.");
    }
    if (!defining.length) {
      throw new CliError(`${address} plays bot ${botId}, which no project here defines (looked in ${looked.join(", ") || "none"}). `
        + "A bot starts workers only in its own project.");
    }
    hit = defining[0];
  }
  if (hit.bot.planned) throw new CliError(`${hit.bot.name} is planned; a planned bot starts no workers.`);
  return { me: { ...me, address }, bot: hit.bot, project: hit.project };
}

/**
 * Why a pane the attach ledger ties no bot to can't start workers. A pane still carrying a
 * `bot` label from before the ledger (its one-time import found no project defining that bot
 * from the pane's folder, or ran before) is told how to tie it: attach, from its project; a
 * Claude session outside the project can't be attached (attachRefusal), so start it there.
 */
async function unboundRefusal(me, address) {
  const base = `${address} isn't a bot's pane (the attach ledger ties no bot to it).`;
  const labelled = me.labels?.[BOT_LABEL];
  if (typeof labelled !== "string" || !labelled) return `${base} Only a bot starts workers.`;
  const { found } = await projectsDefining(labelled, await botProjectHints(me, address));
  const key = found.length === 1 ? found[0].key : "<its project>";
  return `${base} Its ${BOT_LABEL}=${labelled} label is from before the ledger, which no longer reads labels. `
    + `Tie it: automagik-herdr attach ${labelled} ${address} --project ${key}. A Claude session must run in that project to be `
    + `attached; if it doesn't, start the bot there: automagik-herdr start ${labelled} --project ${key}.`;
}

const realDir = (p) => { try { return realpathSync(p); } catch { return null; } };
/** A path as the file system spells it (realpathSync.native: on a case-insensitive disk, the folder's own case). */
const nativeDir = (p) => { try { return realpathSync.native(p); } catch { return null; } };

/** --worktree: an existing worktree of the bot's project, not its main checkout, on a branch. */
async function givenWorktree(path, key, bot) {
  const dir = realDir(resolvePath(path));
  let isDir = false;
  try { isDir = Boolean(dir) && statSync(dir).isDirectory(); } catch { /* not there */ }
  if (!isDir) throw new CliError(`--worktree: ${resolvePath(path)} is not a folder.`, 2);
  const top = (await git(["rev-parse", "--show-toplevel"], dir))?.trim();
  if (!top) throw new CliError(`--worktree: ${dir} isn't in a git worktree.`);
  const owner = (await projectOf(top, git, exists)).key;
  if (owner !== key) throw new CliError(`${top} is a worktree of ${owner}, not of ${bot.name}'s project ${key}. A bot starts workers only in its own project.`);
  if (top === key) throw new CliError(`${top} is the project's main checkout; a worker works in a task worktree (--branch makes one).`);
  const branch = (await git(["symbolic-ref", "--short", "-q", "HEAD"], top))?.trim();
  if (!branch) throw new CliError(`${top} has no branch checked out (a detached HEAD); a worker's task is its branch.`);
  return { worktree: top, branch, created: false, base: null };
}

/**
 * --branch: the worktree already on that branch, or the folder a new one gets,
 * `<main checkout>/.claude/worktrees/<slug>`, as { pending: true } (makeBranchWorktree makes
 * it). Makes nothing: every refusal here comes before the worktree, the hook or hc run.
 */
async function branchPlace(branch, base, key, warnings) {
  const ok = !branch.startsWith("-") && (await runProgram("git", ["check-ref-format", "--branch", branch], { cwd: key })).code === 0;
  if (!ok) throw new CliError(`--branch: "${branch}" isn't a valid branch name.`, 2);
  const listed = await git(["worktree", "list", "--porcelain"], key);
  if (listed === null) throw new CliError(`${key} isn't a git project, so there is no worktree for --branch; pass --worktree.`);
  const hit = parseWorktrees(listed).find((w) => w.branch === branch);
  if (hit) {
    if (realDir(hit.path) === key) throw new CliError(`${branch} is checked out in the main checkout ${key}; a worker never works there. Pass --worktree, or use another branch.`);
    if (base) warnings.push(`${branch} has a worktree already, so --base ${base} was not used.`);
    return { worktree: realDir(hit.path) ?? hit.path, branch, created: false, base: null };
  }
  const path = worktreeFolder(key, branch);
  const same = parseWorktrees(listed).find((w) => (realDir(w.path) ?? w.path) === (realDir(path) ?? path));
  if (same) {
    throw new CliError(`Branch ${branch} uses the same folder as branch ${same.branch ?? "(a detached HEAD)"}: ${path}. `
      + "Pick another branch name, or pass --worktree to work in that one.");
  }
  if (existsSync(path)) throw new CliError(`${path} is there already, but not as a worktree on ${branch}. Move it, or pass --worktree.`);
  return { worktree: path, branch, created: false, base: null, pending: true };
}

/**
 * Makes branchPlace's pending worktree (`place.worktree`, on `place.branch`). A new branch
 * starts from --base, else origin's own branch of that name, else origin/HEAD's branch, else
 * dev, else main, after a fetch. Only `git worktree add` runs: the main checkout's HEAD is
 * never touched. The new branch tracks nothing unless it continues origin's branch of the same name.
 */
async function makeBranchWorktree(place, base, key, warnings) {
  const { worktree: path, branch } = place;
  const unexcluded = await excludeWorktrees(key);
  if (unexcluded) warnings.push(unexcluded);
  const has = async (ref) => (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], key)) !== null;
  let args;
  let from = null;
  if (await has(`refs/heads/${branch}`)) {
    if (base) warnings.push(`${branch} exists already, so --base ${base} was not used.`);
    args = ["worktree", "add", path, branch];
  } else {
    if ((await git(["remote"], key))?.split("\n").includes("origin")) {
      const f = await runProgram("git", ["fetch", "--quiet", "origin"], { cwd: key, timeout: 60_000 });
      if (f.code !== 0) warnings.push(`git fetch origin failed, so the base may be behind: ${(f.stderr || f.stdout).trim().split("\n")[0]}`);
    }
    const originHead = (await git(["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], key))?.trim() || null;
    const candidates = base ? [base] : [`origin/${branch}`, ...baseCandidates(null, originHead)];
    for (const ref of candidates) if (await has(ref)) { from = ref; break; }
    if (!from) throw new CliError(base ? `--base: ${base} isn't a commit in ${key}.` : `${key} has no origin/HEAD, dev or main to start ${branch} from; pass --base.`);
    // Only origin's own branch of that name becomes the upstream. Any other start (origin/dev)
    // would, by git's branch.autoSetupMerge, make a plain `git pull` merge it and a plain
    // `git push` (push.default=upstream) push to it; the worker's first push sets its own.
    const track = from === `origin/${branch}` ? "--track" : "--no-track";
    args = ["worktree", "add", track, "-b", branch, path, from];
  }
  const r = await runProgram("git", args, { cwd: key, timeout: 60_000 });
  if (r.code !== 0) throw new CliError(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return { worktree: realDir(path) ?? path, branch, created: true, base: from };
}

/** `path` is still a folder and one of `key`'s worktrees (git worktree list); false when git can't say. */
async function stillWorktree(path, key) {
  const real = realDir(path);
  if (!real || !isDir(real)) return false;
  const listed = await git(["worktree", "list", "--porcelain"], key);
  return listed !== null && parseWorktrees(listed).some((w) => (realDir(w.path) ?? w.path) === real);
}

/**
 * Keeps the task worktrees out of the main checkout's `git add -A`: WORKTREES_EXCLUDE in the
 * clone's own exclude file, as the briefing hook's settings file is. A warning, or null.
 */
async function excludeWorktrees(key) {
  let path = null;
  try {
    path = (await git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], key))?.trim() || null;
    if (!path) throw new Error("git gave no exclude path");
    const before = readText(path);
    const after = withExclude(before, WORKTREES_EXCLUDE);
    if (after === null) return null;
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await hookIo.write(path, after, before);
    return null;
  } catch (e) {
    return `Couldn't add ${WORKTREES_EXCLUDE} to ${path ?? "the git exclude file"} (${e?.message ?? e}); keep .claude/worktrees out of the main checkout's commits.`;
  }
}

/**
 * WORKER_LOCK_WAIT from AUTOMAGIK_HERDR_WORKER_WAIT_MS (`raw`), for the tests only: 75 s when
 * unset or not a number, else clamped to 100 ms..75 s, so it never lengthens a real call's wait.
 */
export function workerWait(raw) {
  const ms = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(ms) ? Math.min(75_000, Math.max(100, ms)) : 75_000;
}
/**
 * How long a worker call waits for its locks in all (saying so after LOCK_NOTE_AFTER): a task's
 * name lock, then its worktree's, from one deadline. On the common path a call that waited stays
 * under a bot shell tool's 120 s limit: 75 s, then hc ls (15 s), the worker check's hc gets
 * (WORKER_GET_TIMEOUT, at once) and hc run (15 s). That is not a bound: more rows than one batch
 * of gets, the git calls under the lock (15 s each), a fetch and git worktree add (60 s each)
 * when the waiter makes the worktree itself, and pidOf and the tab setup after it can each run to
 * their own timeouts. A hold that outlasts the wait refuses the waiting call, with the holder
 * named, and nothing made.
 */
const WORKER_LOCK_WAIT = workerWait(process.env.AUTOMAGIK_HERDR_WORKER_WAIT_MS);
/** How long the worker check waits for each `hc get` of a live terminal in the worktree. */
const WORKER_GET_TIMEOUT = 5000;
/**
 * The lock a worker's check and start run under: one per worktree, named by a hash of the
 * worktree's real path, in `lockDir`. Local: it orders the CLIs on this computer only.
 */
export function worktreeLock(lockDir, worktree) {
  const real = nativeDir(worktree) ?? resolvePath(worktree);
  return `${lockDir}/worktree-${createHash("sha256").update(real).digest("hex").slice(0, 16)}.lock`;
}
/**
 * The lock a task's worker takes before its worktree's (#538): one per terminal name
 * (`<id>-<role>`), in `lockDir`. Two calls for one task on two branches take two worktree
 * locks, so without it both pass the name check before either hc run, and the second makes its
 * worktree and hook before hc refuses the name. Always taken first, never while a worktree lock
 * is held, so the two never wait on each other.
 */
export function taskLock(lockDir, name) {
  return `${lockDir}/task-${createHash("sha256").update(name).digest("hex").slice(0, 16)}.lock`;
}

/**
 * The live workers in `worktree` (a real path), of any bot: from `ls` (`hc ls`), the live
 * terminals on this computer whose cwd is that folder as a real path and that carry a
 * worker.of label, as { address, labels }. Labels come from the row, else from `hc get`, all
 * at once, each within WORKER_GET_TIMEOUT. A terminal hc says is gone is left out; one hc
 * doesn't answer for is refused (fails closed): it may be a writer.
 * Workers on other machines aren't seen (their cwd isn't a folder here).
 */
async function workersIn(worktree, ls) {
  const here = nativeDir(worktree) ?? worktree;
  const rows = rowsOf(ls).filter((r) => {
    if (!local(r?.address) || (r.state !== undefined && r.state !== "live") || typeof r.cwd !== "string") return false;
    const cwd = r.cwd.startsWith("~/") ? `${home()}${r.cwd.slice(1)}` : r.cwd;
    return (nativeDir(cwd) ?? cwd) === here;
  });
  const found = await Promise.all(rows.map(async (r) => {
    if (r.labels && typeof r.labels === "object") return { address: r.address, labels: r.labels };
    try {
      return { address: r.address, labels: (await hcLookup(r.address, { timeout: WORKER_GET_TIMEOUT }))?.labels };
    } catch (e) {
      throw new CliError(`${r.address} is live in ${worktree}, but whether it's a worker can't be told: ${e?.message ?? e}. Not started. `
        + `Try again, or check it with hc get ${r.address}.`);
    }
  }));
  return found.filter((w) => w.labels?.[WORKER_OF_LABEL]);
}

/** What `hc templates --json` lists: { list: [{ name, command }], why }; list null when it gives none. */
async function hcTemplates() {
  const r = await hc(["templates", "--json"]);
  let list = null;
  try { list = r.code === 0 ? JSON.parse(r.stdout).templates : null; } catch { list = null; }
  return { list: Array.isArray(list) ? list : null, why: (r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.code}` };
}

/**
 * The agent an hc template runs, from its command in `hc templates`: { runs: an agent key, or
 * undefined when no known agent is in the command; command: that command }. A template hc doesn't list, or no list at
 * all, is refused here, before any worktree is made: `hc run` runs an unlisted name as a
 * program (`--template rm` would run rm).
 */
async function templateRuns(template, agents) {
  const { list, why } = await hcTemplates();
  if (!list) {
    throw new CliError(`hc templates gave no list (${why}), `
      + `so ${template} can't be checked as a template; hc run would start an unlisted name as a program. Not started.`);
  }
  const hit = list.find((x) => x?.name === template);
  if (!hit) {
    const names = list.map((x) => x?.name).filter(Boolean);
    throw new CliError(`hc has no template ${template}${names.length ? `. Its templates: ${names.join(", ")}` : ""}.`);
  }
  return { runs: templateAgent(hit.command, agents) ?? undefined, command: typeof hit.command === "string" ? hit.command : null };
}

/**
 * The hc template an old pane was started from: `get.template`, else the worker.template label a
 * Restart through a template leaves on its new pane (so the next restart finds it again), with
 * the template's CURRENT command when hc still lists it: { name, command }. { name } when hc
 * doesn't list it (or gives no list): the restart falls back to the agent row, and its line
 * names the template (#597 review F1). Null when the pane names none.
 */
async function paneTemplate(get) {
  const own = typeof get?.template === "string" && get.template.trim() ? get.template.trim() : null;
  const labeled = get?.labels?.[WORKER_TEMPLATE_LABEL];
  const name = own ?? (typeof labeled === "string" && labeled.trim() ? labeled.trim() : null);
  if (!name) return null;
  const { list } = await hcTemplates();
  const hit = list?.find((x) => x?.name === name);
  const command = typeof hit?.command === "string" && hit.command.trim() ? hit.command : null;
  return command ? { name, command } : { name };
}

/**
 * Planned swaps: whether bot `botId`'s task `taskId` in project `key` runs the bot's other
 * arm (worker.swap). The first byte of sha256(`${botId}:${key}:${taskId}`), mod 3, is 0:
 * about one task in three, the same answer for every worker of that bot on that task.
 */
export const swapTask = (botId, key, taskId) => swapByte(createHash("sha256").update(`${botId}:${key}:${taskId}`).digest()[0]);

/**
 * The commit a worker's worktree started from: the base ref this command made it from, as a
 * SHA; else the branch's oldest reflog entry (where it was created here: Genie's worktree
 * from a fresh-fetched base); null when git keeps neither.
 */
async function baseCommit(place, key) {
  if (place.created && place.base) {
    const sha = (await git(["rev-parse", "--verify", "--quiet", `${place.base}^{commit}`], key))?.trim();
    if (sha) return sha;
  }
  const log = await git(["reflog", "show", "--format=%H", `refs/heads/${place.branch}`], key);
  return log?.trim().split("\n").filter(Boolean).at(-1) ?? null;
}

/**
 * A new worker's tab, once the window shows its pane (`terminal`): renamed `name` and moved
 * after the tab of its bot's pane (`botTerminal`) when both are in one space (workerTab.js
 * tabSteps, the setup a sidebar click gives a worker). Never focused: the person's focus
 * stays where it is. Null, or a warning when the pane didn't show in time or a step failed.
 */
async function workerTabSetup(terminal, botTerminal, name) {
  const shown = await windowShows(terminal);
  if (!shown) return `Herdr hadn't shown ${terminal} after ${TAB_WAIT_MS / 1000}s, so its tab isn't named or moved beside its bot's.`;
  const space = shown.spaces.find((s) => !s.machine && s.tabs.some((t) => t.terminals.includes(botTerminal)));
  const botTab = space?.tabs.find((t) => t.terminals.includes(botTerminal)) ?? null;
  const steps = tabSteps({ space: space?.id ?? null, tab: botTab?.id ?? null, name }, { tab: shown.tab.id }, shown.spaces);
  for (const [command, args] of steps) {
    const why = await windowDo(command, args);
    if (why) return `${terminal}'s tab: ${command} failed: ${why}`;
  }
  return null;
}

// ---- worktree cleanup (#567) ----

/** A worker call's sweep removes at most this many worktrees, and starts no new check after this long. */
const REAP_MAX = 5;
const REAP_BUDGET_MS = 20_000;
/** How long the sweep waits for gh's list of a branch's pull requests. */
const GH_TIMEOUT = 5000;
/**
 * How long one git worktree remove may take (a large tree). Not cut to the budget left: a remove
 * stopped halfway leaves a half-deleted tree, which then reads as uncommitted changes. So a worker
 * call's sweep usually takes up to about REAP_BUDGET_MS, and at worst one check's program calls
 * (15 s each, gh 5 s) and one remove (this) past it.
 */
const REMOVE_TIMEOUT = 120_000;
/**
 * How long ago every terminal of a candidate must have finished (hc's finished_ms) before it is
 * looked at. Restart --tree ends a bot's workers with its old pane and runs them again in the
 * same worktrees, without the worktree lock, one at a time once the new pane is up (about 1 min
 * at worst: hc run, agentUp's 30 s and a get). Each helper takes at worst about 2 min (helperEnded's
 * get, hc ls, hc run, agentUp's 30 s plus a get, a kill, pidOf: 15 s calls), so the k-th is run
 * again at worst about 1 + 2k min after it ended: 15 min covers 7 helpers at their worst (a
 * short-limit Herdr caps --tree at 2). Longer only costs disk while it waits.
 */
const REAP_SETTLE_MS = 15 * 60_000;
/** A worker call's sweep skips a kept worktree whose reason hasn't changed in this long (reap still checks it). */
const REAP_QUIET_MS = 24 * 60 * 60 * 1000;

/** The cleanup file's rows ([] when it can't be read). */
function reapRows() {
  try { return readLedger(readText(reapPath(appHome())) ?? ""); } catch { return []; }
}
/** Appends a cleanup row; a warning, or null. */
function appendReap(row) {
  const path = reapPath(appHome());
  try {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, "a", 0o600);
    try { writeSync(fd, ledgerLine(row)); } finally { closeSync(fd); }
    return null;
  } catch (e) {
    return `couldn't record the cleanup of ${row.worktree} in ${path}: ${e?.message ?? e}`;
  }
}
/** hc's terminals from `hc ls [--all] --json`, or null when hc failed or printed no list. */
async function hcTerminals(all) {
  const r = await hc(["ls", ...(all ? ["--all"] : []), "--json"]);
  if (r.code !== 0) return null;
  try { const list = JSON.parse(r.stdout)?.terminals; return Array.isArray(list) ? list : null; } catch { return null; }
}
/** The local terminals among `terms` that haven't finished and whose cwd is `dir` or inside it (both as the disk spells them). */
function liveIn(terms, dir) {
  const here = nativeDir(dir) ?? dir;
  return terms.filter((t) => {
    if (!local(t?.address) || t.state === "finished" || typeof t.cwd !== "string") return false;
    const cwd = t.cwd.startsWith("~/") ? `${home()}${t.cwd.slice(1)}` : t.cwd;
    const real = nativeDir(cwd) ?? cwd;
    return real === here || real.startsWith(`${here}/`);
  });
}
/**
 * Whether every terminal in `names` that `terms` (hc ls --all) still lists finished at least
 * REAP_SETTLE_MS ago, by hc get's finished_ms. One hc no longer has counts as settled; one hc
 * can't date doesn't (fails closed). Each answer hc gave is kept in `gets` by address, for the
 * sweep's end rows.
 */
async function settled(names, terms, gets = new Map()) {
  const listed = names.filter((t) => terms.some((x) => x?.address === t));
  const ends = await Promise.all(listed.map(async (t) => {
    const r = await hc(["get", t, "--json"]);
    if (r.code !== 0) return r.code === 3 || /not_found/.test(r.stderr ?? "") ? 0 : null;
    try {
      const get = JSON.parse(r.stdout);
      if (get && typeof get === "object") gets.set(t, get);
      const ms = get?.finished_ms;
      return Number.isSafeInteger(ms) ? ms : null;
    } catch { return null; }
  }));
  return ends.every((ms) => ms !== null && Date.now() - ms >= REAP_SETTLE_MS);
}
const firstLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n")[0];

/** The branch's pull requests as gh lists them ([{ state }]), or null when gh is missing or fails. */
async function pullRequestsOf(branch, cwd) {
  const gh = programPath("gh");
  if (!gh || !branch) return null;
  const r = await runProgram(gh, ["pr", "list", "--head", branch, "--state", "all", "--json", "number,state", "--limit", "20"],
    { cwd, timeout: GH_TIMEOUT });
  if (r.code !== 0) return null;
  try { const list = JSON.parse(r.stdout); return Array.isArray(list) ? list : null; } catch { return null; }
}

/**
 * One candidate, under its worktree's lock: looked at again for a live terminal (a worker
 * started in it since the sweep's hc ls), then checked for work (workLeft), looked at for a live
 * terminal once more, and removed with git worktree remove (no --force), then git worktree prune. Never throws: { result, why }, result
 * "waiting" (left for a later sweep, nothing recorded), "kept", "failed" or "removed". Any git
 * or hc failure keeps it (fails closed).
 */
async function reapOne(c) {
  const path = c.worktree;
  const now = await hcTerminals(false);
  if (!now) return { result: "waiting" };
  if (liveIn(now, path).length) return { result: "waiting" };
  const common = await runProgram("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: path });
  if (common.code !== 0) return { result: "kept", why: `git can't read it: ${firstLine(common)}` };
  const main = c.project && isDir(c.project) ? c.project : dirname(common.stdout.trim());
  const status = await runProgram("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: path });
  if (status.code !== 0) return { result: "kept", why: `git status failed: ${firstLine(status)}` };
  const changes = status.stdout.split("\n").filter(Boolean).length;
  let unpushed = 0;
  let prs = null;
  let branch = null;
  if (!changes) {
    const count = await runProgram("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], { cwd: path });
    unpushed = Number(count.stdout.trim());
    if (count.code !== 0 || !Number.isSafeInteger(unpushed)) return { result: "kept", why: `git rev-list failed: ${firstLine(count)}` };
    branch = (await git(["symbolic-ref", "--short", "-q", "HEAD"], path))?.trim() || null;
    if (unpushed > 0 && branch && branch === c.branch) prs = await pullRequestsOf(branch, main);
  }
  const why = workLeft({ changes, unpushed, prs, branch, expected: c.branch });
  if (why) return { result: "kept", why };
  // Looked at once more just before the remove: a pane started in it without the worktree lock
  // (a hand-made one, hc run) since the first look. No --force: git itself refuses a tree that
  // has gained changes since the status above.
  const last = await hcTerminals(false);
  if (!last || liveIn(last, path).length) return { result: "waiting" };
  const rm = await runProgram("git", ["worktree", "remove", path], { cwd: main, timeout: REMOVE_TIMEOUT });
  await runProgram("git", ["worktree", "prune"], { cwd: main });
  if (rm.code !== 0) return { result: "failed", why: `git worktree remove failed: ${firstLine(rm)}` };
  return { result: "removed", why: null };
}

/**
 * The sweep (#567): every worktree a worker call made (reapCandidates) whose start rows'
 * terminals have all ended, finished or gone in `hc ls --all`, killed or done alike, and in
 * which no live local terminal works, is removed unless it holds work (reapOne), once those
 * terminals finished REAP_SETTLE_MS ago. Newest first. A worktree only given to a worker is never
 * a candidate. One sweep at a time (a held lock: none now); a worktree whose worker lock is held
 * is left for later. At most `max` removals, and no new check once `budget` ms have passed.
 * hc failing skips the sweep. Each new outcome is a row in the cleanup file and a line.
 * `every` (reap): a line for every kept or failed one, even unchanged; without it (a worker
 * call), a kept one whose reason hasn't changed in REAP_QUIET_MS is skipped.
 * Never throws: { removed, kept, failed, waiting, more, lines }.
 */
async function reapWorktrees({ max = REAP_MAX, budget = REAP_BUDGET_MS, every = false } = {}) {
  const out = { removed: [], kept: [], failed: [], waiting: 0, more: 0, lines: [] };
  try {
    const candidates = reapCandidates(workerLedgerRows(), reapRows());
    if (!candidates.length) return out;
    const lockDir = dirname(ledgerPath(appHome()));
    mkdirSync(lockDir, { recursive: true });
    let token;
    const lock = `${lockDir}/worker-reap.lock`;
    try { token = await takeLockAsync(lock, 0); } catch { return out; }
    const stop = keepFresh(lock, token);
    try {
      const terms = await hcTerminals(true);
      if (!terms) { out.lines.push("worktree cleanup skipped: hc ls --all failed"); return out; }
      const start = Date.now();
      // The finished workers' terminals hc answered for: their end rows, after the loop.
      const gets = new Map();
      for (const c of candidates) {
        if (!every && c.last?.result === "kept" && Date.now() - Date.parse(c.last.at) > REAP_QUIET_MS) continue;
        if (c.terminals.some((t) => terms.some((x) => x?.address === t && x.state !== "finished"))) { out.waiting += 1; continue; }
        if (out.removed.length >= max || Date.now() - start > budget) { out.more += 1; continue; }
        const path = c.worktree;
        let done;
        if (!(await settled(c.terminals, terms, gets))) {
          done = { result: "waiting" };
        } else if (!isDir(path)) {
          if (c.project && isDir(c.project)) await runProgram("git", ["worktree", "prune"], { cwd: c.project });
          done = { result: "gone", why: null };
        } else if (liveIn(terms, path).length) {
          done = { result: "waiting" };
        } else {
          try {
            done = await withLockAsync(worktreeLock(lockDir, path), () => reapOne(c), { wait: 0 });
          } catch { done = { result: "waiting" }; }
        }
        if (done.result === "waiting") { out.waiting += 1; continue; }
        const changed = c.last?.result !== done.result || c.last?.why !== (done.why ?? null);
        if (changed) { const unrecorded = appendReap(reapRow({ worktree: path, ...done })); if (unrecorded) out.lines.push(unrecorded); }
        if (done.result === "removed") { out.removed.push(path); out.lines.push(`removed ${path}: its workers ended`); }
        if (done.result === "kept") out.kept.push({ worktree: path, why: done.why });
        if (done.result === "failed") out.failed.push({ worktree: path, why: done.why });
        if ((done.result === "kept" || done.result === "failed") && (changed || every)) {
          out.lines.push(`${done.result === "kept" ? "kept" : "couldn't remove"} ${path}: ${done.why}`);
        }
      }
      // RFC 0021 (f) 4: a worker launch the sweep found finished gets its end row, once.
      if (gets.size) {
        const core = await rowCore();
        for (const row of core ? finishedEnds(workerLedgerRows(), gets, core) : []) {
          const unlogged = appendLedger(row);
          if (unlogged) out.lines.push(unlogged);
        }
      }
      if (out.more) out.lines.push(`${out.more} more finished ${out.more === 1 ? "worker's worktree" : "workers' worktrees"} left for the next cleanup (automagik-herdr reap)`);
    } finally { stop(); dropLock(lock, token); }
  } catch (e) {
    out.lines.push(`worktree cleanup failed: ${e?.message ?? e}`);
  }
  return out;
}

async function cmdReap(opts, rest) {
  if (rest.length) throw new CliError("reap takes no arguments.", 2);
  const r = await reapWorktrees({ max: Infinity, budget: Infinity, every: true });
  const { lines, ...out } = r;
  if (opts.json) { report(lines.filter((l) => !l.startsWith("removed ") && !l.startsWith("kept ") && !l.startsWith("couldn't remove "))); return out; }
  return lines.length ? lines.join("\n") : "No finished worker's worktree to remove.";
}

async function cmdWorker(opts, rest) {
  const task = rest.join(" ").trim();
  if (!task) throw new CliError('worker needs the task text: automagik-herdr worker "<task>" --branch <name>.', 2);
  if (optionLike(task)) throw new CliError("The task text can't start with a dash; the agent would read it as an option.", 2);
  if ((opts.branch === undefined) === (opts.worktree === undefined)) throw new CliError("Give --branch or --worktree (one of them).", 2);
  if (opts.base !== undefined && opts.branch === undefined) throw new CliError("--base goes with --branch.", 2);
  if (opts.template === "") throw new CliError("--template needs a name: --template <name> (hc templates lists them).", 2);
  if (opts.role !== undefined && !ROLES.includes(opts.role)) throw new CliError(`--role is one of ${ROLES.join(", ")}, not "${opts.role}".`, 2);
  const given = { template: opts.template, agent: opts.agent, model: opts.model, effort: opts.effort };
  const alongside = ["agent", "model", "effort"].filter((k) => given[k] !== undefined);
  if (given.template !== undefined && alongside.length) {
    throw new CliError(`A template owns its command: --template goes alone, without --${alongside.join(", --")}.`, 2);
  }
  // The task contract (Genie R1-17): --task is Genie's short id; the worker is named after it.
  const taskId = opts.task;
  if (taskId !== undefined) {
    const why = taskIdProblem(taskId);
    if (why) throw new CliError(why, 2);
    if (opts.name !== undefined) throw new CliError(`--name goes without --task: a task's worker is named ${taskId}-<role>.`, 2);
    if (opts.branch !== undefined && !branchNamesTask(opts.branch, taskId)) {
      throw new CliError(`--branch ${opts.branch} doesn't contain the task id ${taskId}; a task's branch names it (fix/${taskId}-login).`, 2);
    }
  }
  if (opts.lead !== undefined && !LEAD_SHAPE.test(opts.lead)) {
    throw new CliError(`--lead: "${opts.lead}" isn't a bot id (b- plus 10 base32 characters) or a Genie session (session-<uuid>).`, 2);
  }
  const { me, bot, project } = await callingBot(opts);
  // The bots file's warnings about this bot (model.js names it first: a bad worker field dropped,
  // a retired agent), on stderr at once, so a refused call shows them too; --json lists them.
  const fileWarnings = project.warnings.filter((w) => w.startsWith(`${bot.id}: `));
  report(fileWarnings);
  const { role, error: roleError } = workerRole(bot, opts.role);
  if (roleError) throw new CliError(roleError, 2);
  if (taskId !== undefined && opts.lead === undefined && LEAD_RANKS.includes(bot.rank)) throw new CliError("pass --lead <the task's lead bot>", 2);
  const lead = opts.lead ?? bot.id;
  const taskName = taskId !== undefined ? taskWorkerName(taskId, role) : null;
  if (taskName && taskName.length > HC_NAME_MAX) {
    throw new CliError(`${taskName} is longer than hc's ${HC_NAME_MAX}-character terminal names; a task's worker is named exactly <id>-<role>.`, 2);
  }
  const agents = agentTable();
  const warnings = [];
  // Planned swaps (owner, council #4): on a task the rule picks, the bot's worker.swap replaces
  // its worker defaults, and a per-task --agent, --model or --effort is recorded, not used.
  // Never for a template worker; off a swap task, a per-task pick is an override.
  let pick = given;
  let swap = false;
  let overrideRequested = null;
  const arm = taskId !== undefined && !runsTemplate(bot, given) && swapTask(bot.id, project.key, taskId) ? swapArm(bot) : null;
  if (arm?.agent && !resolveAgent(arm.agent, agents)) {
    warnings.push(`${bot.name}'s worker swap agent "${arm.agent}" isn't one Herdr knows; this swap task runs without it.`);
    delete arm.agent;
  }
  if (arm && Object.keys(arm).length) {
    swap = true;
    pick = { ...arm };
    if (alongside.length) {
      overrideRequested = Object.fromEntries(alongside.map((k) => [k, given[k]]));
      warnings.push(`${taskId} is one of ${bot.name}'s planned swap tasks, so it runs ${workerText(arm)}; `
        + `${alongside.map((k) => `--${k} ${given[k]}`).join(", ")} recorded, not used.`);
    }
  }
  const override = !swap && Object.values(given).some((v) => v !== undefined);
  const plan = workerPlan(bot, pick, agents);
  if (plan.error) throw new CliError(plan.error, 2);
  warnings.push(...plan.warnings);
  // The agent that runs: the plan's, or the one a template's command names (null: can't tell).
  let runs = plan.agent;
  // A Claude template runs its own command under the login words (#453): hc's template form takes
  // no environment. One that can't take its task as a last argument is refused, as unrunnable.
  let templateArgv = null;
  let templateCommand = null;
  if (plan.template) {
    const t = await templateRuns(plan.template, agents);
    runs = t.runs;
    templateCommand = t.command?.trim() ? t.command : null;
    if (runs === "claude") {
      templateArgv = t.command?.trim() ? commandArgv({ shell: t.command }, [task]) : null;
      if (!templateArgv) {
        throw new CliError(`Template ${plan.template} runs Claude, but ${t.command?.trim() ? "its command ends in a separator or a comment, so it can't take the task"
          : "hc gave no command for it"}; it can't be started on the chosen Claude login. Not started.`);
      }
    }
  } else {
    if (!onPath(plan.argv[0])) throw new CliError(`${agents[plan.agent].name} (${plan.argv[0]}) isn't installed on this computer.`);
    const list = plan.model ? modelList(plan.agent, plan.model) : [];
    if (list.length && !list.includes(plan.model)) warnings.push(`${plan.model} isn't on ${plan.agent}'s model list; started with it anyway.`);
  }
  // Where it works: --worktree's, the branch's worktree, or the folder a new one gets (made
  // below, once the check passes). Nothing is made yet.
  let place = opts.worktree !== undefined ? await givenWorktree(opts.worktree, project.key, bot)
    : await branchPlace(opts.branch, opts.base, project.key, warnings);
  // One writer (dev, test, fix) per worktree, whatever its bot; reviewers run alongside, but
  // one bot runs one reviewer per branch. A worker with no role label counts as a writer.
  // Checked and started under one lock per worktree, so two calls at once can't both pass. The
  // check comes first: a refused call (hc ls failing included) makes no worktree and no hook.
  const lockDir = ledgerPath(appHome()).replace(/\/[^/]*$/, "");
  try { mkdirSync(lockDir, { recursive: true }); } catch (e) { throw new CliError(`Can't make ${lockDir}: ${e?.message ?? e}`); }
  const planned = realDir(place.worktree) ?? place.worktree;
  // The bot's space, no tab: Herdr opens the worker in a tab of its own there, at hc run. The
  // window is asked first (workerSpace): a label naming a space it no longer has is left out.
  const window = await windowRead();
  const space = workerSpace(placementFrom([me])?.space ?? null, window, me.address);
  let worktree = planned;
  let base = null;
  // A new Claude worker runs on a session id chosen here (RFC 0021 (f) 2), passed with
  // --session-id, labelled and in its start row; a template's own command is left as it is.
  const session = !plan.template && choosesSession(plan.agent) && !ownsSession(plan.argv) ? newSessionId() : null;
  const launchArgv = session ? [...plan.argv, ...sessionIdArgs(plan.agent, session)] : plan.argv;
  // Held across a fetch and git worktree add (60 s each) and the hc calls, so a second call on
  // this worktree waits for the first's start rather than failing; kept fresh while held. A
  // task's worker takes its name's lock first (taskLock), so a second call for the task on
  // another branch waits too, then is refused by the name check with nothing made (#538).
  const deadline = Date.now() + WORKER_LOCK_WAIT;
  const inWorktree = () => withLockAsync(worktreeLock(lockDir, planned), async () => {
    const ls = await hcJson(["ls"]);
    // A task's worker is named exactly <id>-<role>: a live holder of that name is refused, never suffixed.
    // This computer's terminals only (hc names are unique per core), as workersIn sees them.
    const holder = taskName && rowsOf(ls).find((r) => r?.name === taskName && local(r.address)
      && (r.state === undefined || r.state === "live"));
    if (holder) {
      throw new CliError(`${taskName} is taken by a live terminal: ${holder.address}. A task's worker is named exactly <id>-<role>, `
        + `never suffixed. Check it (hc read ${holder.address}) or end it (hc kill ${holder.address}) before starting another.`);
    }
    const live = await workersIn(worktree, ls);
    const nameOf = (id) => project.file.bots.find((b) => b.id === id)?.name ?? id;
    const writing = role !== "review" && live.find((w) => writesWorktree(w.labels));
    const reviewing = role === "review" && live.find((w) => w.labels[WORKER_OF_LABEL] === bot.id
      && workerBranch(w.labels) === place.branch && w.labels[WORKER_ROLE_LABEL] === "review");
    const hit = writing || reviewing;
    if (hit) {
      const what = writing ? `${place.worktree} already has a live writer: ${hit.address} (${nameOf(hit.labels[WORKER_OF_LABEL])}'s `
        + `${hit.labels[WORKER_ROLE_LABEL] ?? "worker, no role label"}). One writer per worktree.`
        : `${bot.name} already has a live review worker on ${place.branch}: ${hit.address}.`;
      throw new CliError(`${what} Check it (hc read ${hit.address}) or end it (hc kill ${hit.address}) before starting another.`);
    }
    if (place.pending) {
      // Looked for again under the lock: a call that held it before this one may have made it.
      const found = [];
      const now = await branchPlace(opts.branch, opts.base, project.key, found);
      if (now.pending) place = await makeBranchWorktree(now, opts.base, project.key, warnings);
      else { place = now; warnings.push(...found); }
    } else if (!(await stillWorktree(place.worktree, project.key))) {
      // Removed while this call waited for the lock (a sweep's cleanup, #567): never started in
      // what is left, since a hook's folder would make it a plain folder whose git is the main
      // checkout's. A branch's own folder is made again; anything else is refused.
      const gone = `${place.worktree} is no longer a worktree of ${project.key}: it was removed while this call waited for its lock.`;
      if (opts.worktree !== undefined) throw new CliError(`${gone} Not started; pass --branch ${place.branch} to make it again.`);
      const now = await branchPlace(opts.branch, opts.base, project.key, []);
      if (!now.pending || now.worktree !== planned) throw new CliError(`${gone} Not started; run the worker call again.`);
      place = await makeBranchWorktree(now, opts.base, project.key, warnings);
    }
    worktree = realDir(place.worktree) ?? place.worktree;
    base = await baseCommit(place, project.key);
    // Only the actual proxy transport can authorize skipping the PATH guard. Caller-added flags
    // and working roster edits cannot do so; the same socket still checks terminal.run.
    const transport = await workerTransport();
    const proxied = transport && transport.terminal === me.address;
    // #823: an Antigravity worker's permission file, written before it starts; a template that
    // runs agy is rebuilt with `--settings` (hc's template form takes no extra words), or runs
    // without the list with a plain warning when its command can't take them. H1: for a proxied
    // start the proxy writes the file from the approved snapshot under the data root, which the
    // sandbox binds read-only; this pane only names that path and never writes it.
    const settingsDir = proxied ? approvedSettingsDir() : agySettingsDir(appHome());
    let agySettings = null;
    if (plan.agent === "antigravity" || (plan.template && runs === "antigravity")) {
      agySettings = agySettingsPlan({ bot, scope: "worker", role, folder: place.worktree, settingsDir });
      if (agySettings?.warnings.length) warnings.push(...agySettings.warnings);
      if (agySettings && !proxied) writeAgySettingsFile(agySettings, bot);
      if (plan.template && runs === "antigravity") {
        const built = templateCommand
          ? commandArgv({ shell: templateCommand }, [...agySettingsArgs("antigravity", agySettings?.path), task]) : null;
        if (built) templateArgv = built;
        else warnings.push(`${bot.name}'s template ${plan.template} ${templateCommand
          ? "ends in a separator or a comment, so its Antigravity permission list can't be added" : "gave no command, so its Antigravity permission list can't be added"}; it runs without one.`);
      }
    }
    // A Claude worker gets the per-turn hook in its worktree: it prints no briefing there (the
    // worker is no bot), but it ties the Claude session to the terminal (briefing.mjs).
    if (runs === undefined) {
      warnings.push(`Can't tell which agent template ${plan.template} runs, so no session hook was written in ${place.worktree}; `
        + `if it runs Claude, the ${place.branch} worker's session won't be linked to usage.`);
    } else if (runs === "claude") {
      const lost = `The ${place.branch} worker's Claude session won't be linked to usage`;
      warnings.push(...(await writeBriefingHook(bot, place.worktree, appHome(), { lost })).warnings);
    }
    // An npm agent (#!/usr/bin/env node) gets its interpreter's folder on PATH when the pane lacks it.
    const runPath = plan.template ? null : launchPath(plan.argv[0], place.worktree);
    if (runPath?.note) warnings.push(runPath.note);
    const taken = new Set(rowsOf(ls).map((r) => r?.name).filter(Boolean));
    const name = taskName ?? hcName(opts.name ?? branchSlug(place.branch), bot.id, taken);
    const args = workerArgs({ botId: bot.id, branch: place.branch, role, name, cwd: place.worktree, parent: me.address, space,
      agent: plan.agent, model: plan.model, effort: plan.effort, agyMode: plan.agyMode, argv: launchArgv, session, task, template: plan.template,
      templateArgv,
      login: claudeLogin(templateArgv ?? plan.argv ?? [], warnings),
      path: runPath?.path ?? process.env.PATH, taskId, project: project.key, lead,
      agySettingsPath: agySettings && !templateArgv ? agySettings.path : null,
      sandbox: plan.agent === "dsh-tui" && proxyEnabled(
        approvedProxyState({ project: project.key, bot }), process.platform,
        (warning) => warnings.push(warning)) });
    const r = await (proxied ? hcReal(args) : hc(args));
    if (r.code !== 0) throw new CliError(`hc run failed: ${(r.stderr || r.stdout).trim()}`);
    let address = null;
    try { address = JSON.parse(r.stdout).address ?? null; } catch { address = null; }
    if (!address) throw new CliError(`hc run gave no terminal address: ${r.stdout.trim()}`);
    return { address, name };
  }, { wait: Math.max(0, deadline - Date.now()), what: `the worker lock on ${place.worktree}` });
  const started = await (taskName ? withLockAsync(taskLock(lockDir, taskName), inWorktree,
    { wait: WORKER_LOCK_WAIT, what: `the task name ${taskName}` }) : inWorktree())
    .catch((e) => { throw e instanceof CliError ? e : new CliError(e?.message ?? String(e)); });
  const terminal = started.address;
  // The ledger row first, as launchSeat writes its rows before anything waits on the window.
  const { pid, createdMs } = await launchOf(terminal);
  const unlogged = appendLedger(startRow({ kind: "worker", terminal, pid, botId: bot.id, task: taskId, branch: place.branch,
    project: project.key, lead, worktree, base, created: place.created, agent: plan.agent, model: plan.model, effort: plan.effort,
    template: plan.template, role, swap, override, overrideRequested, core: await rowCore(), createdMs, squad: squadOf(project.file, bot.id),
    session }));
  if (unlogged) warnings.push(unlogged);
  // Herdr shows a labelled worker at once, so the sidebar's tab setup (workerTab.js) never
  // runs for it: its tab is named and moved after the bot's tab here, as a click would.
  if (space && window && TAB_WAIT_MS > 0) {
    const why = await workerTabSetup(terminal, me.address, workerTabName({ branch: place.branch, name: started.name }));
    if (why) warnings.push(why);
  }
  // The worktrees earlier workers made, once they have all ended (#567): after this worker
  // started, outside its locks, capped, and never failing the call.
  warnings.push(...(await reapWorktrees()).lines);
  report(warnings);
  const out = { terminal, bot: bot.id, role, parent: me.address, worktree: place.worktree, branch: place.branch, created: place.created,
    base: place.base, template: plan.template, agent: plan.agent, model: plan.model, effort: plan.effort, agyMode: plan.agyMode, pid,
    argv: maskedArgv(launchArgv, session),
    warnings: [...fileWarnings, ...warnings],
    task: taskId ?? null, project: project.key, lead, baseCommit: base, swap, override, override_requested: overrideRequested };
  if (opts.json) return out;
  const how = place.created ? `new, from ${place.base ?? place.branch}` : "existing";
  const what = plan.template ? [`  template  ${plan.template}${runs ? ` (runs ${runs})` : ""}`]
    : [`  agent     ${plan.agent}`, `  model     ${plan.model ?? "(the agent's default)"}`,
      `  effort    ${plan.effort ?? "(the agent's default)"}`,
      ...(plan.agyMode ? [`  agy mode  ${plan.agyMode}`] : [])];
  const contract = taskId !== undefined ? [`  task      ${taskId} (lead ${lead})`] : [];
  const swapped = swap ? [`  swap      yes: ${bot.name}'s planned swap task`] : [];
  return [terminal, `  role      ${role}`, ...contract, `  worktree  ${place.worktree}`, `  branch    ${place.branch} (${how})`, ...what,
    ...swapped,
    `End it once the task merges: hc kill ${terminal}`].join("\n");
}

// ---- updates (A14) ----

/** The hooks notice (migrateHooks.mjs hooksNotice) on lines of its own after the summary, or "". */
const hooksLines = (hooks) => { const lines = hooksNotice(hooks); return lines.length ? `\n${lines.join("\n")}` : ""; };
/** Each mod an install held for a layout (update.mjs `held`, #420, #432) on a line of its own, or "". */
const heldLines = (installed) => (installed.held ?? []).map((h) => `\n${heldModLine(h, installed.version)}`).join("");

/**
 * `update`: install the latest release, `--check` only reports, `--rollback` swaps the kept
 * pack back. `io` is injected by the tests (fetch, env, modsDir, binDir); the pack is the installed
 * one under $HERDR_APP_HOME/mods, never this checkout (update.mjs). The CLI link (~/.local/bin) and
 * the open spaces are looked at only for this computer's own pack: with `io.modsDir`, only `io.binDir`.
 */
export async function cmdUpdate(opts, _rest = [], io = {}) {
  if (opts.auto !== undefined) return autoSetting(opts, io);
  if (opts.check && opts.rollback) throw new CliError("Give --check or --rollback, not both.", 2);
  const host = io.modsDir ? { binDir: io.binDir ?? null, window: false }
    : { binDir: io.binDir ?? binDirOf(io.env ?? process.env), window: liveHome(`${appHome(io.env ?? process.env)}/mods`) };
  const where = { ...(io.env ? { env: io.env } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.keys ? { keys: io.keys } : {}), ...(io.modsDir ? { modsDir: io.modsDir } : {}), ...host };
  const failed = (what, e) => new CliError(`${what}: ${String(e?.message ?? e).split("\n")[0]}`);
  // The pack just swapped (or one an older CLI installed) may name its CLI otherwise
  // (bin/automagik-herdr, or only the .mjs before it): the ~/.local/bin link follows, so a
  // rollback never leaves it dangling. Idempotent, never fatal; `--check` changes nothing.
  // `from`: where the link pointed before a rollback, whose own relink (update.mjs moveHooks) may
  // already have moved it: either way the move is reported. The link is host.binDir's: with an
  // injected io.modsDir only io.binDir, never this computer's ~/.local/bin.
  const relink = (from = null) => {
    const { binDir } = host;
    try {
      let r = relinkCli({ modsDir: io.modsDir ?? defaultModsDir(io.env ?? process.env), binDir });
      if (!r && from && binDir) {
        const link = join(binDir, "automagik-herdr");
        const to = readLink(link);
        if (to && to !== from) r = { link, from, to };
      }
      return { relinked: r, note: r ? ` ${r.link} now points at ${r.to}.` : "" };
    } catch (e) {
      return { relinked: null, note: ` The automagik-herdr link was not repointed (${String(e?.message ?? e).split("\n")[0]}): run install.sh again.` };
    }
  };
  if (opts.rollback) {
    const before = host.binDir ? readLink(join(host.binDir, "automagik-herdr")) : null;
    let r;
    try { r = rollbackPack({ ...(io.modsDir ? { modsDir: io.modsDir } : {}), ...host }); } catch (e) { throw failed("Nothing rolled back", e); }
    const { relinked, note } = relink(before);
    const warned = r.warnings?.length ? ` Warning: ${r.warnings.join("; ")}.` : "";
    return opts.json ? { rolledBack: r, relinked } : `Rolled back to Automagik Herdr ${r.version ?? "(no VERSION)"} at ${r.pack}. Herdr reloads its mods on its own.${r.from && readAuto(io.modsDir ?? defaultModsDir(io.env ?? process.env)).on ? ` Updates installed automatically skip ${r.from} and wait for a newer release.` : ""}${warned}${note}${hooksLines(r.hooks?.hooks)}`;
  }
  let r;
  try { r = opts.check ? await checkForUpdate(where) : await installUpdate(where); } catch (e) {
    throw failed(opts.check ? "Couldn't check for updates" : "Not updated", e);
  }
  const { relinked, note } = opts.check ? { relinked: null, note: "" } : relink();
  const meter = r.installed && !r.installed.restored && !r.installed.restoreError ? await meterAfterUpdate(io) : null;
  if (opts.json) return opts.check ? r : { ...r, relinked, ...(meter ? { meter: meter.results } : {}) };
  const current = r.current ?? "not installed";
  if (r.disabled) return `Automagik Herdr ${current} is installed. Updates are off (${NO_UPDATE_ENV}=1).${note}`;
  if (r.installed?.restored) {
    const restore = r.installed.restored;
    const mods = (restore.failed?.length ? restore.failed : [restore.mod]).filter(Boolean).join(", ");
    const stopped = restore.unavailable ? `; ${restore.unavailable}` : "";
    const removed = restore.prevRemoved ? " The failed pack was removed, so `automagik-herdr update --rollback` has nothing to go back to." : "";
    const warnings = Array.isArray(restore.warnings) ? restore.warnings.filter((w) => typeof w === "string" && w !== "") : [];
    const warned = warnings.length > 0 ? ` Warning: ${warnings.join(" ")}` : "";
    return `Automagik Herdr ${restore.failedVersion ?? r.installed.version} failed to load (${mods} failed herdr-app check${stopped}): `
      + `the previous version ${restore.version} is back.${removed}${warned} The bad version is held back; a newer release installs on its own.${note}`;
  }
  if (r.installed?.restoreError) {
    return `Automagik Herdr ${r.installed.version} failed to load, and ${r.installed.restoreError}. `
      + `It is still installed; auto-update waits for a newer release.${note}`;
  }
  if (r.installed) {
    return `Updated Automagik Herdr ${current} → ${r.installed.version}. The replaced pack is kept: \`automagik-herdr update --rollback\` puts it back. Herdr reloads its mods on its own.${note}${hooksLines(r.installed.hooks?.hooks)}${heldLines(r.installed)}${meter.lines.map((l) => `\n${l}`).join("")}`;
  }
  if (r.update) return `Automagik Herdr ${current} is installed; ${r.update.version} is out (${r.update.page}). Run \`automagik-herdr update\` to install it.`;
  return `Automagik Herdr ${current} is installed; the latest release is ${r.latest ?? "none yet"}. Up to date.${note}`;
}

/** `update --auto on|off|status`: the pack's own setting (update.mjs writeAuto), and whether it applies here. */
function autoSetting(opts, io) {
  if (opts.check || opts.rollback) throw new CliError("Give --auto alone, without --check or --rollback.", 2);
  if (!["on", "off", "status"].includes(opts.auto)) throw new CliError("--auto takes on, off or status.", 2);
  const env = io.env ?? process.env;
  const modsDir = io.modsDir ?? defaultModsDir(env);
  let s;
  try { s = opts.auto === "status" ? autoStatus(modsDir) : { ...writeAuto(modsDir, { on: opts.auto === "on" }), ...managedPack(modsDir) }; } catch (e) {
    throw new CliError(`The setting was not saved: ${String(e?.message ?? e).split("\n")[0]}`);
  }
  if (opts.json) return { ...s, checks: !updatesOff(env) };
  const lines = [`Install updates automatically: ${s.on ? "on" : "off"}.`];
  if (!s.managed) lines.push(`It doesn't apply to this pack (${s.why}): updates stay a notice and \`automagik-herdr update\`.`);
  else if (s.on && s.skip) lines.push(`${s.skip} was rolled back here: it waits for a release newer than ${s.skip}.`);
  if (updatesOff(env)) lines.push(`Update checks are off (${NO_UPDATE_ENV}=1), so nothing is installed.`);
  return lines.join("\n");
}

// ---- tidy (sidebar-rules Group 2) ----

const tidyIo = () => ({ run: runProgram, home: home(), appHome: appHome(), prune: (keys) => unlistProjects(keys) });

/** `tidy`: the plan (tidy.js), read from hc, herdr-app, git and the files; it changes nothing. */
async function cmdTidy(opts) {
  let state;
  try { state = await readState(tidyIo(), { window: true }); } catch (e) { throw new CliError(`Can't plan: ${e?.message ?? e}`); }
  const actions = tidyPlan(state, { now: Date.now(), home: home(), appHome: appHome() });
  return opts.json ? actions : planText(actions);
}

/**
 * After start, attach and create: the plan's non-visual fixes only; a failure only warns. A
 * prune's note only when the command succeeded: a failed one's last stderr line stays its own
 * error (the sidebar shows that line, restart.js restartAnswer).
 */
async function tidyQuietly() {
  try {
    const io = tidyIo();
    const actions = tidyPlan(await readState(io, { window: false }), { now: Date.now(), home: io.home, appHome: io.appHome });
    report(await fixNonVisual(actions.filter((a) => !a.visual), io, { notes: exitAfter.code === 0 }));
  } catch (e) { report([`tidy: ${e?.message ?? e}`]); }
}
const TIDIES = new Set(["start", "restart", "attach", "create"]);

// ---- usagemeter on every linked machine (meterFleet.js) ----

const hcProgram = () => realHcPath();
/** meterFleet.js's runner: on a linked machine through `hc exec`, else here from the home folder. */
const meterRun = (argv, { on, timeout }) => (on
  ? runProgram(hcProgram() ?? "hc", hcExecArgs(on, argv, timeout), { timeout: (timeout + 15) * 1000 }).then((r) => decodeExec(r, timeout))
  : runProgram(argv[0], argv.slice(1), { cwd: home(), timeout: timeout * 1000 }));

/** The linked machines (`{ name, connected }`), or `{ why }` when hc can't say. */
async function meterMachines() {
  if (!hcProgram()) return { why: "hc (herdr-core) is not on PATH" };
  const r = await runProgram(hcProgram(), ["machine", "ls", "--json"], { timeout: 20000 });
  if (r.code !== 0) return { why: `hc machine ls failed: ${(r.stderr || r.stdout).trim().split("\n")[0]}` };
  return { machines: linkedMachines(r.stdout) };
}

/**
 * The install record after `results` (only a v2 one install.sh wrote; none: nothing is noted), the
 * scope an explicit `meter install` agreed to (`scope`: all, or local; never narrower than all), and
 * the meter-lane pointer's `sequence` it took (never lowered).
 */
function noteMeter(modsDir, results, scope = null, sequence = null) {
  const record = readMarker(modsDir);
  if (!record || record.v1) return;
  const usagemeterScope = scope === "all" || (scope === "local" && record.usagemeterScope !== "all") ? scope : record.usagemeterScope;
  const here = results.find((r) => r.machine === null);
  const usagemeter = here?.status === "installed" ? here.version : ["newer", "link", "unknown"].includes(here?.status) ? null : record.usagemeter;
  const usagemeterOn = recordAfter(record.usagemeterOn, results);
  const usagemeterSequence = Number.isSafeInteger(sequence) && !(record.usagemeterSequence > sequence) ? sequence : record.usagemeterSequence;
  if (usagemeter === record.usagemeter && usagemeterScope === record.usagemeterScope && usagemeterSequence === record.usagemeterSequence
    && JSON.stringify(usagemeterOn) === JSON.stringify(record.usagemeterOn)) return;
  writeMarker(modsDir, { ...record, usagemeter, usagemeterSequence, usagemeterOn, usagemeterScope });
}

/**
 * `meter install` / `meter uninstall`. One machine at a time; a machine that fails is a warning
 * line, and the command still succeeds (but `--machine M` failing exits 1).
 */
export async function cmdMeter(opts, [verb, ...rest], io = {}) {
  const modsDir = io.modsDir ?? defaultModsDir(process.env);
  if (rest.length) throw new CliError(`meter ${verb} takes no arguments (got ${rest.join(" ")}).`, 2);
  const results = [], notes = [];
  let lane = null;
  if (verb === "install") {
    if ([opts.machine !== undefined, opts.linked, opts.local].filter(Boolean).length > 1) throw new CliError("Give one of --machine, --linked and --local.", 2);
    // The signed pointer, read and checked here once, before any machine is asked anything: a
    // refusal (its signature, its fields, a sequence older than the record's) changes nothing.
    try {
      lane = await readMeterLane({ env: process.env, recorded: readMarker(modsDir)?.usagemeterSequence ?? null });
    } catch (e) { throw new CliError(`usagemeter: ${e?.message ?? e}.`); }
    if (opts.machine === undefined && !opts.linked) results.push(await installOn(meterRun, null, lane));
    if (!opts.local) {
      const found = await meterMachines();
      if (found.why) {
        if (opts.machine !== undefined) throw new CliError(`usagemeter on ${opts.machine}: ${found.why}.`);
        notes.push(`usagemeter on linked machines: skipped (${found.why}).`);
      }
      let list = found.machines ?? [];
      if (opts.machine !== undefined) {
        list = list.filter((m) => m.name === opts.machine);
        if (!list.length) throw new CliError(`No linked machine "${opts.machine}" (hc machine ls).`, 2);
      }
      for (const m of list) results.push(m.connected ? await installOn(meterRun, m.name, lane) : { machine: m.name, status: "disconnected" });
    }
  } else if (verb === "uninstall") {
    if (opts.machine !== undefined || opts.linked || opts.local) throw new CliError("meter uninstall takes no --machine, --linked or --local.", 2);
    const owned = readMarker(modsDir)?.usagemeterOn ?? {};
    const names = Object.keys(owned);
    const pocket = join(modsDir, POCKET_LINK);
    const found = names.length && !existsSync(pocket) ? await meterMachines() : {};
    for (const name of names) {
      const m = found.machines?.find((k) => k.name === name);
      if (existsSync(pocket)) results.push({ machine: name, status: "kept", why: `Pocket Link (${pocket}) runs it too` });
      else if (found.why) results.push({ machine: name, status: "kept", why: found.why });
      else if (!m?.connected) results.push({ machine: name, status: "kept", why: m ? "the machine is not connected" : "no such linked machine any more" });
      else results.push(await uninstallOn(meterRun, name, owned[name]));
    }
  } else {
    throw new CliError(`meter needs install or uninstall${verb ? `, not "${verb}"` : ""}.`, 2);
  }
  // An explicit `meter install` is the person's yes (install.sh's own run passes --linked
  // and records its scope itself; `update` asks only within the scope already agreed).
  const agreed = verb === "install" && !opts.linked && opts.machine === undefined ? (opts.local ? "local" : "all") : null;
  try { noteMeter(modsDir, results, agreed, lane?.pointer.sequence ?? null); } catch (e) { notes.push(`usagemeter: the install record could not note it (${e?.message ?? e}).`); }
  if (opts.machine !== undefined && results.some((r) => r.status === "failed" || r.status === "disconnected")) {
    throw new CliError(results.map(resultLine).join("\n").replace(/^Warning: /, ""));
  }
  if (opts.json) return { results, notes };
  return [...results.map(resultLine), ...notes].join("\n")
    || (verb === "install" ? "usagemeter: no connected linked machine (hc machine ls)." : "usagemeter: no linked machine has the pack's usagemeter.");
}

/**
 * `dsh-tui install|update|uninstall|doctor` (#561): DSH as a Herdr agent, in its own `dsh-tui`
 * profile, through the pinned dsh-TUI and the `dsh-tui` shim. `update` is the same idempotent
 * install (a newer pin in a later pack replaces it). Local only: the profile is this computer's.
 */
export async function cmdDshTui(opts, [verb, ...rest], io = {}) {
  if (rest.length) throw new CliError(`dsh-tui ${verb ?? ""} takes no arguments (got ${rest.join(" ")}).`, 2);
  if (!["install", "update", "uninstall", "doctor"].includes(verb)) throw new CliError(`dsh-tui needs install, update, uninstall or doctor${verb ? `, not "${verb}"` : ""}.`, 2);
  const env = io.env ?? process.env;
  if (verb === "doctor") {
    const r = doctorDshTui({ env, forbiddenRoots: io.forbiddenRoots });
    r.bots = [];
    let roster = [];
    let projectKey = null;
    try {
      const project = io.project ?? await projectFor(opts);
      roster = project.file.bots;
      projectKey = project.key;
      const approval = approvedProxyState({ project: project.key, bot: { id: "" }, env });
      if (approval.error) r.checks.push({ check: "approved-roster", ok: true, warning: true,
        detail: approval.error, fix: "automagik-herdr proxy approve (review the diff)" });
      const app = env.HERDR_APP_HOME || join(env.HOME || homedir(), ".config/herdr-app");
      const bindings = foldAttach(readAttachFile(attachPath(app)) ?? []).byBot;
      r.bots = await doctorBotProxies({ bots: project.file.bots, project: project.key,
        bindings, env });
    } catch (e) {
      r.checks.push({ check: "roster", ok: false,
        detail: String(e?.message ?? e).replace(/\s+/g, " "), fix: "repair the project roster" });
      r.code = 1;
    }
    const byId = new Map(roster.map((b) => [b.id, b]));
    // #823: whether agy's terminal sandbox, and so --mode, can work on this host, from local
    // evidence only; a host with no Antigravity bot or worker needs no row.
    const agyBots = roster.filter((b) => b.agent === "antigravity" || resolveAgent(b.worker?.agent ?? "") === "antigravity");
    if (agyBots.length) {
      const read = (path) => {
        try { return readFileSync(path, "utf8"); } catch (e) { return e?.code === "ENOENT" ? null : undefined; }
      };
      const sandbox = agySandbox({ platform: process.platform, read });
      r.checks.push({ check: "agy-sandbox", ok: true, warning: sandbox.state === "missing",
        detail: sandbox.state === "available" ? `${sandbox.detail}: Antigravity's --mode takes effect`
          : sandbox.state === "missing"
            ? `${sandbox.detail}, so agy's terminal sandbox is unavailable and --mode doesn't take effect: `
              + "the launch's own permission list still lets the bot work"
            : `Antigravity's terminal sandbox is unverified (${sandbox.detail}), so whether --mode takes effect is unknown` });
    }
    for (const bot of r.bots) {
      const state = bot.hcProxyState;
      const needsApproval = state.working && state.approved !== true;
      const ok = !bot.applicable || (!needsApproval
        && (state.approved !== true || !bot.terminal || bot.up));
      const agent = byId.get(bot.id);
      const agy = agent?.agent === "antigravity" ? `agy mode ${agyModeOf(agent.agyMode)}; ` : "";
      // The effective allow and deny lists each Antigravity launch of this bot carries: its
      // seat's, and its worker defaults' (a task's worktree is added to a worker's at launch).
      const seatAgy = agent?.agent === "antigravity" && projectKey
        ? agyPermissionPlan({ bot: agent, scope: "seat", folder: projectKey }) : null;
      const workerAgent = agent && !agent.worker?.template ? resolveAgent(agent.worker?.agent ?? agent.agent) : null;
      const workerAgy = workerAgent === "antigravity"
        ? agyPermissionPlan({ bot: agent, scope: "worker", role: workerRole(agent).role, folder: null }) : null;
      if (seatAgy) bot.agyPermissions = { allow: seatAgy.allow, deny: seatAgy.deny, trustedWorkspaces: seatAgy.trustedWorkspaces };
      if (workerAgy) bot.workerAgyPermissions = { allow: workerAgy.allow, deny: workerAgy.deny, trustedWorkspaces: ["<worktree>"] };
      const perms = [
        seatAgy ? `agy trusted ${seatAgy.trustedWorkspaces.join(", ") || "-"}; agy allow ${seatAgy.allow.join(", ")}; `
          + `agy deny ${seatAgy.deny.join(", ")}` : "",
        workerAgy ? `worker agy trusted <worktree>; worker agy allow ${workerAgy.allow.join(", ")}; `
          + `worker agy deny ${workerAgy.deny.join(", ")}` : "",
      ].filter(Boolean).join("; ");
      // The lists are a guardrail against accidents, never the boundary: say so wherever they print.
      const guardrail = perms ? "these lists are a guardrail against accidents, not a security boundary: "
        + "a rule matches word prefixes only (a force refspec with + attached, combined short flags like -fu, "
        + "and a reset reaching --hard after other words aren't caught); a review launch's git subcommands "
        + "take every argument, so some write; allowing node, bun or git with any arguments lets a determined "
        + "agent do anything" : "";
      r.checks.push({ check: `hc-proxy:${bot.id}`, ok, warning: bot.warning === true,
        detail: `${bot.name}: ${agy}${perms ? `${perms}; ${guardrail}; ` : ""}hcProxy ${proxyStateText(state)}; ${bot.detail}`,
        ...(seatAgy ? { agyPermissions: { allow: seatAgy.allow, deny: seatAgy.deny, trustedWorkspaces: seatAgy.trustedWorkspaces } } : {}),
        ...(workerAgy ? { workerAgyPermissions: { allow: workerAgy.allow, deny: workerAgy.deny, trustedWorkspaces: ["<worktree>"] } } : {}),
        fix: needsApproval ? "automagik-herdr proxy approve (review the diff), then restart"
          : !ok || bot.warning ? `automagik-herdr restart ${bot.id}` : null });
      if (!ok) r.code = 1;
    }
    exitAfter.code = r.code;
    return opts.json ? r : r.checks.map((c) => `${!c.ok ? "FAIL" : c.warning ? "WARN" : "ok  "} ${c.check}: ${c.detail}${c.fix ? ` (fix: ${c.fix})` : ""}`).join("\n");
  }
  // A test's own publish time: the registry is never reached for a file:// run or a unit test.
  const published = Object.hasOwn(env, "AUTOMAGIK_HERDR_DSH_TUI_PUBLISHED")
    ? (env.AUTOMAGIK_HERDR_DSH_TUI_PUBLISHED || null) : undefined;
  const r = verb === "uninstall"
    ? uninstallDshTui({ env, exec: io.exec, forbiddenRoots: io.forbiddenRoots })
    : await installDshTui({ env, exec: io.exec, forbiddenRoots: io.forbiddenRoots, ...(published === undefined ? {} : { publishedAt: published }) });
  exitAfter.code = r.status === "failed" ? 1 : 0;
  const lines = r.lines?.length ? r.lines : [r.detail];
  return opts.json ? r : lines.join("\n");
}

/**
 * After `update` installed a pack: that pack's own `meter install` (the build the signed meter-lane
 * pointer names now, checked with that pack's keys), as install.sh's scope says. Lines to print;
 * never throws.
 */
export async function meterAfterUpdate(io) {
  const modsDir = io.modsDir ?? defaultModsDir(io.env ?? process.env);
  const scope = meterScope(readMarker(modsDir));
  if (scope === "none") return { lines: ["usagemeter: skipped (install.sh --no-usagemeter)."], results: [] };
  // Nobody asked (an older install.sh recorded no --no-usagemeter): nowhere, and how to opt in.
  if (!scope) return { lines: [OPT_IN], results: [] };
  const args = ["meter", "install", "--json", ...(scope === "local" ? ["--local"] : [])];
  let r;
  if (io.meter) r = await io.meter(args);
  else if (io.modsDir) return { lines: [], results: [] };
  else r = await runProgram(process.execPath, [join(modsDir, PACK_NAME, "bin", "automagik-herdr.mjs"), ...args], { timeout: 30 * 60 * 1000 });
  try {
    const out = JSON.parse(r.stdout);
    return { lines: [...out.results.map(resultLine), ...(out.notes ?? [])], results: out.results };
  } catch {
    return { lines: [`Warning: usagemeter was not checked: ${(r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop()}. Run \`automagik-herdr meter install\` to retry.`], results: [] };
  }
}

/**
 * `proxy approve --project <dir>` (#631 PR C1): the one writer of a project's approved roster
 * record. It reads the project's working .herdr/bots.json, prints the diff from the previous
 * approval, then writes the record 0600 under the data root, outside the project. `--project`
 * is mandatory: the record is keyed by the project's canonical main-checkout realpath.
 */
export async function cmdProxy(opts, [verb, ...rest], { forbiddenRoots } = {}) {
  if (verb !== "approve") {
    const extra = verb ? `, not "${verb}"` : "";
    throw new CliError(`proxy needs approve${extra}: proxy approve --project <dir>.`, 2);
  }
  if (rest.length) {
    throw new CliError(`proxy approve takes no argument after --project `
      + `(got ${rest.join(" ")}).`, 2);
  }
  if (opts.project === undefined)
    throw new CliError("proxy approve needs --project <dir>: the project to approve.", 2);
  const project = await namedKeyOf(opts.project);
  const unsafe = approvedDataRootProblem({ env: process.env, project, appHome: appHome(),
    forbiddenRoots });
  if (unsafe) throw new CliError(unsafe);
  const countOf = (record) => JSON.parse(record.roster).bots.length;
  let result;
  try {
    result = approveProject({
      project,
      beforeWrite: ({ diff, record, previous, note }) => {
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({
            project, key: projectKey(project), record: recordFileOf(project),
            approvedAt: record.approvedAt, approvedBy: record.approvedBy,
            bots: countOf(record), previous, note, diff,
          }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`approved ${countOf(record)} bots for ${project}\n`);
        if (note) process.stdout.write(`note: ${note}\n`);
        if (diff.length) for (const line of diff) process.stdout.write(`${line}\n`);
        else process.stdout.write("no roster changes from the previous approval\n");
      },
    });
  } catch (e) {
    throw new CliError(`proxy approve: ${e?.message ?? e}`);
  }
  if (opts.json) return PRINTED;
  process.stdout.write(`record: ${result.path} (0600)\n`);
  return PRINTED;
}

/**
 * `doc get <name> [--machine M]`: a herdr-core doc's value as JSON on stdout (docGet.mjs: doc.get
 * through hc connect, read-only), for a mod that can only exec a program. Exit 3 when the doc is
 * not there, 2 for a usage mistake, 1 for any other failure.
 */
export async function cmdDoc(opts, [verb, name, ...rest]) {
  if (verb !== "get") throw new CliError(`doc needs get${verb ? `, not "${verb}"` : ""}: doc get <name> [--machine M].`, 2);
  if (name === undefined) throw new CliError("doc get needs a doc name.", 2);
  if (rest.length) throw new CliError(`doc get takes one name (got ${[name, ...rest].join(" ")}).`, 2);
  let value;
  try {
    value = await docGet(name, { machine: opts.machine, hc: realHcPath() ?? "hc" });
  } catch (e) {
    if (e instanceof DocError) throw new CliError(e.message, e.code);
    throw e;
  }
  process.stdout.write(`${JSON.stringify(value)}\n`);
  return PRINTED;
}

/**
 * `launch-path <program>` (#453): { program, path }: the file a launch of `program` runs
 * (programPath) and the PATH its pane gets (launchPath), both null when it isn't found. The
 * Accounts panel runs `claude auth status` from there, so it finds claude the way launches do.
 */
export async function cmdLaunchPath(_opts, [program, ...rest]) {
  if (!program || program.startsWith("-") || rest.length) throw new CliError("launch-path takes one program name.", 2);
  const file = programPath(program);
  process.stdout.write(`${JSON.stringify({ program: file, path: file ? launchPath(program).path : null })}\n`);
  return PRINTED;
}

const COMMANDS = { ls: cmdLs, show: cmdShow, create: cmdCreate, edit: cmdEdit, rm: cmdRm, category: cmdCategory,
  start: cmdStart, restart: cmdRestart, attach: cmdAttach, detach: cmdDetach, import: cmdImport, whois: cmdWhois, history: cmdHistory, brief: cmdBrief, update: cmdUpdate,
  tidy: cmdTidy, forget: cmdForget, worker: cmdWorker, reap: cmdReap, meter: cmdMeter, "dsh-tui": cmdDshTui, doc: cmdDoc,
  proxy: cmdProxy, "launch-path": cmdLaunchPath };
const NEEDS_BOT = new Set(["show", "edit", "rm", "start", "restart", "attach", "detach", "history", "brief"]);

/** Runs one command line; resolves with the exit code. Output goes to stdout, problems to stderr. */
export async function main(argv = process.argv.slice(2), io = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    process.stderr.write(`automagik-herdr: ${e.message}\n\n${USAGE}\n`);
    return 2;
  }
  const { values: opts, positionals } = parsed;
  const [command, ...rest] = positionals;
  // The pack this command belongs to (its VERSION file; 0.0.0 for a checkout never released).
  if (opts.version && !command) {
    let version = "0.0.0";
    try { version = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim() || version; } catch { /* no VERSION file */ }
    process.stdout.write(opts.json ? `${JSON.stringify({ version })}\n` : `automagik-herdr ${version}\n`);
    return 0;
  }
  if (opts.help && command === "proxy") { process.stdout.write(`${PROXY_USAGE}\n`); return 0; }
  if (opts.help || !command || command === "help") { process.stdout.write(`${USAGE}\n`); return command || opts.help ? 0 : 2; }
  const run = COMMANDS[command];
  if (!run) { process.stderr.write(`automagik-herdr: unknown command "${command}"\n\n${USAGE}\n`); return 2; }
  try {
    if (NEEDS_BOT.has(command) && !rest[0]) throw new CliError(`${command} needs a bot (its id or name).`, 2);
    if (opts.machine !== undefined && !ON_MACHINE.has(command)) {
      throw new CliError(`${command} works on this computer only for now; --machine goes with ls, show, create, edit, rm, category, start, restart, attach, detach, whois, meter and doc.`, 2);
    }
    exitAfter.code = 0;
    const out = command === "proxy" ? await run(opts, rest, io) : await run(opts, rest);
    if (out === PRINTED) return exitAfter.code;
    if (opts.json) process.stdout.write(unprinted(`${JSON.stringify(out, null, 2)}\n`));
    else if (out) process.stdout.write(unprinted(`${out}\n`));
    // Tidy is this computer's window and labels: never after a command on a linked machine.
    if (TIDIES.has(command) && opts.machine === undefined) await tidyQuietly();
    return exitAfter.code;
  } catch (e) {
    const message = e instanceof CliError ? e.message : `${e?.stack ?? e}`;
    process.stderr.write(unprinted(`automagik-herdr: ${message}\n`));
    if (opts.json && e instanceof CliError && e.detail) process.stdout.write(unprinted(`${JSON.stringify({ error: message, ...e.detail }, null, 2)}\n`));
    return e instanceof CliError ? e.code : 1;
  }
}

// Run as a program (also through the ~/.local/bin symlink, hence the realpath), not on import.
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; } })();
if (import.meta.url === invoked) {
  // An update made by an older CLI (0.3.4 and before) left the link on the .mjs, which needs node
  // on PATH: the first start that has a runtime moves it to the wrapper. Silent, never fatal.
  try { relinkCli(); } catch { /* the link stays; `automagik-herdr update` reports why */ }
  process.exitCode = await main();
}
