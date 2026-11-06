// Coding agents and their models (A12): how each agent is started, which model a running
// one uses (read from its foreground command line), its own configured default, a short
// list of models a bot may be pinned to, and the flag that passes a pin at Start.
// Pure: no `herdr`, `gpui-kit`, `gpui-base` or `fs`; files are read through an injected
// `read(path) => string | null`, so `node --test` runs it and the CLI and the mod share it.
// Apache-2.0.
import { LEGACY_AGENTS } from "./retired.js";

/**
 * The agents people start, keyed as Herdr's shipped programs table keys them (the table in
 * the Herdr binary, 2026-11-01: the entries with a `run`), plus `omp` (Oh My Pi, which this
 * host's templates start). `run` is how Herdr starts each one; `match` other process names.
 * `programs.json` in the app home may override `run` or add entries (see withOverrides).
 */
export const AGENTS = Object.freeze({
  claude: { name: "Claude Code", run: ["claude"], match: ["claude-code"] },
  codex: { name: "Codex", run: ["codex"] },
  pi: { name: "Pi", run: ["pi"] },
  omp: { name: "Oh My Pi", run: ["omp"] },
  opencode: { name: "OpenCode", run: ["opencode"] },
  cursor: { name: "Cursor", run: ["cursor-agent"], match: ["cursor-agent"] },
  copilot: { name: "Copilot", run: ["copilot"], match: ["github-copilot"] },
  amp: { name: "Amp", run: ["amp"] },
  grok: { name: "Grok", run: ["grok"] },
  antigravity: { name: "Antigravity", run: ["agy"], match: ["agy"] },
  kimi: { name: "Kimi", run: ["kimi"] },
  kiro: { name: "Kiro", run: ["kiro-cli"], match: ["kiro-cli"] },
  hermes: { name: "Hermes", run: ["hermes"] },
  qoder: { name: "Qoder", run: ["qodercli"], match: ["qodercli"] },
  crush: { name: "Crush", run: ["crush"] },
  // DSH in a pane (#598), through the dsh-tui command (the installer's shim, dshTui.mjs), which
  // picks its own DSH profile: this pack names only the command. Interactive only (DSH 0.2.2-rc.1:
  // `dsh-tui run` and `-p` exit 3, ADAPTER_UNAVAILABLE), and never with a permission, add-dir or
  // approval flag: the profile on that machine sets its sandbox, and dsh-tui would read such a
  // flag as prompt text. Its permission presets gate only the filesystem sandbox and the approval
  // policy: network is unrestricted by design (the lead's ruling, as on the Mac), so the usual
  // rules hold: no secret printed, no external post or production access without the owner.
  "dsh-tui": { name: "dsh-TUI", run: ["dsh-tui"] },
});

// Agents whose model and effort come from elsewhere, never a launch flag (#598): a --model or
// --effort for one (a bot's pin, a worker's, a bot's worker defaults) is refused with this line,
// where any other agent with no such flag has it left out with a warning.
const FIXED_MODEL = {
  "dsh-tui": "dsh-TUI takes no --model or --effort: its DSH profile on the machine it runs on sets both.",
};
/** Why `agentKey` takes no --model or --effort (FIXED_MODEL), or null when it may. */
export const modelRefusal = (agentKey) => FIXED_MODEL[agentKey] ?? null;

/**
 * Agents that are gone, mapped to the one that replaces them (retired.js, the pack's one list):
 * a bot or a typed --agent naming `gemini` runs Antigravity (`agy`). Herdr's own table still
 * lists gemini; the bot form leaves these keys out of its picker.
 */
export { LEGACY_AGENTS };

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/**
 * AGENTS with an app home's `programs.json` text applied (null: none): an entry there with
 * a `run` list overrides that agent's `run` or adds an agent, as Herdr's knownAgents() does.
 * A text that doesn't parse changes nothing.
 */
export function withOverrides(programsText) {
  const out = Object.fromEntries(Object.entries(AGENTS).map(([k, v]) => [k, { ...v }]));
  let programs = null;
  try { programs = programsText ? JSON.parse(programsText)?.programs : null; } catch { programs = null; }
  if (!isObject(programs)) return out;
  for (const [key, p] of Object.entries(programs)) {
    if (!isObject(p)) continue;
    const run = Array.isArray(p.run) && p.run.length && p.run.every((w) => typeof w === "string") ? p.run : null;
    if (out[key]) { if (run) out[key].run = run; if (typeof p.name === "string") out[key].name = p.name; }
    else if (run) out[key] = { name: typeof p.name === "string" ? p.name : key, run, ...(Array.isArray(p.match) ? { match: p.match } : {}) };
  }
  return out;
}

// Programs that run another program named in their arguments (Herdr's "interpreters").
const INTERPRETERS = new Set(["node", "bun", "bunx", "deno", "python", "python3", "npx", "pnpm", "yarn", "uv", "uvx",
  "ruby", "bundle", "env", "sudo", "nice", "time", "watch", "nodemon"]);
const base = (p) => String(p ?? "").split("/").pop().replace(/^-/, "");

// The index of the agent's own executable in `words`: past any interpreter and its flags. env's
// `-u NAME` (`--unset NAME`) takes the next word, so `env -u CLAUDE_CONFIG_DIR PATH=… claude`
// (a launch on the default Claude login, logins.js) runs claude, not CLAUDE_CONFIG_DIR.
function programAt(words) {
  let i = 0;
  while (i < words.length && INTERPRETERS.has(base(words[i]))) {
    const env = base(words[i]) === "env";
    i += 1;
    while (i < words.length && (words[i].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) {
      i += env && (words[i] === "-u" || words[i] === "--unset") ? 2 : 1;
    }
  }
  return i;
}

/**
 * The agent's own arguments in a foreground argv: past any interpreter (`bun …/omp`,
 * `node …/codex.js`, `env K=V claude`) and its flags. Returns { program, args }, `program`
 * the basename of the agent's executable (".js"/".mjs"/".cjs" dropped).
 */
export function agentArgv(argv) {
  const words = Array.isArray(argv) ? argv.map(String) : [];
  const i = programAt(words);
  if (i >= words.length) return { program: words.length ? base(words[0]) : "", args: [] };
  return { program: base(words[i]).replace(/\.(m|c)?js$/, ""), args: words.slice(i + 1) };
}

/** The agent key a foreground argv runs, by `run[0]`, key or `match` in `agents`, or null. */
export function agentKeyOfArgv(argv, agents = AGENTS) {
  const { program } = agentArgv(argv);
  if (!program) return null;
  for (const [key, a] of Object.entries(agents)) {
    if (key === program || base(a.run?.[0]) === program || (a.match ?? []).includes(program)) return key;
  }
  return null;
}

// Each agent's model flags, read from `<agent> --help` on this host (2026-11-01: Claude Code
// 2.1.316, codex, omp, pi; 2026-11-02: agy 1.4.12, whose Go parser takes -model as --model). Agents not installed here have none listed, so their
// model is never guessed: detectModel and modelArgs give null / [] for them.
const FLAGS = {
  claude: { long: ["--model"] },
  codex: { long: ["--model"], short: ["-m"], config: ["-c", "--config"] },
  antigravity: { long: ["--model", "-model"] },
  pi: { long: ["--model"] },
  omp: { long: ["--model"] },
};

const unquote = (v) => String(v).trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The model a running agent was started with, read from its foreground argv (A12), or
 * null when the command line names none (the agent then runs its own default). The last
 * flag wins, as each agent's own parser has it. Exact flags only: `--fallback-model`,
 * `--models` or codex's `-c model_provider=…` are not the model.
 */
export function detectModel(argv, agentKey) {
  const { program, args } = agentArgv(argv);
  const key = FLAGS[agentKey] ? agentKey : agentKeyOfArgv(argv);
  const flags = FLAGS[key];
  if (!flags || !program) return null;
  let model = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    const eq = a.indexOf("=");
    const name = a.startsWith("--") && eq > 0 ? a.slice(0, eq) : a;
    const inline = a.startsWith("--") && eq > 0 ? a.slice(eq + 1) : null;
    if ((flags.long ?? []).includes(name) || (flags.short ?? []).includes(name)) {
      const v = inline ?? args[i + 1];
      if (inline === null) i += 1;
      if (typeof v === "string" && v !== "" && !v.startsWith("-")) model = unquote(v);
    } else if ((flags.short ?? []).some((s) => a.startsWith(s) && a.length > s.length && !a.startsWith("--"))) {
      model = unquote(a.slice(2)); // -mgpt-x
    } else if ((flags.config ?? []).includes(name)) {
      const v = inline ?? args[i + 1];
      if (inline === null) i += 1;
      const m = /^\s*model\s*=\s*(.+)$/.exec(v ?? "");
      if (m) model = unquote(m[1]);
    }
  }
  return model;
}

// Top-level `model = "…"` of a TOML text: before the first [section] (profiles carry their own).
function tomlTopModel(text) {
  for (const line of String(text).split("\n")) {
    if (/^\s*\[/.test(line)) break;
    const m = /^\s*model\s*=\s*(["'])(.*?)\1\s*(#.*)?$/.exec(line);
    if (m) return m[2];
  }
  return null;
}

/**
 * The agents' own config files this module reads, by name, under a home folder. A caller
 * whose file reads are async (the mod's readTextFile) reads these first and passes the
 * texts to defaultModelFrom / knownModelsFrom.
 */
export function configPaths(home) {
  return {
    claudeSettings: `${home}/.claude/settings.json`,
    codexConfig: `${home}/.codex/config.toml`,
    codexModels: `${home}/.codex/models_cache.json`,
    hermesConfig: `${home}/.hermes/config.yaml`,
    antigravitySettings: `${home}/.gemini/antigravity-cli/settings.json`,
  };
}

// Every config text (null when missing) through a synchronous `read(path)`.
function textsOf(home, read) {
  const out = {};
  for (const [name, path] of Object.entries(configPaths(home))) {
    try { out[name] = read(path) ?? null; } catch { out[name] = null; }
  }
  return out;
}

const parseJson = (t) => { try { return typeof t === "string" && t ? JSON.parse(t) : null; } catch { return null; } };

/**
 * The model an agent runs when its command line names none: its own configured default,
 * when that is one cheap local file (Claude Code: `~/.claude/settings.json` `model`; Codex:
 * `~/.codex/config.toml` top-level `model`; Antigravity: `~/.gemini/antigravity-cli/settings.json`
 * `model`, the label `/model` saved). Null for every other agent, or when the file or key is missing.
 * `texts`: configPaths' names mapped to each file's text (null or absent: no file).
 */
export function defaultModelFrom(agentKey, texts = {}) {
  if (agentKey === "claude") {
    const m = parseJson(texts.claudeSettings)?.model;
    return typeof m === "string" && m ? m : null;
  }
  if (agentKey === "codex") return typeof texts.codexConfig === "string" ? tomlTopModel(texts.codexConfig) : null;
  if (agentKey === "antigravity") {
    const m = parseJson(texts.antigravitySettings)?.model;
    return typeof m === "string" && m ? m : null;
  }
  return null;
}

/** defaultModelFrom over a synchronous `read(path) => string | null` under `home` (the CLI). */
export function defaultModel(agentKey, { home, read }) {
  return defaultModelFrom(agentKey, textsOf(home, read));
}

// Claude Code: the aliases `claude --help` names ("an alias for the latest model (e.g.
// 'sonnet' or 'opus')") and the current model ids of the Claude 5 family (2026-11-01).
const CLAUDE_MODELS = ["opus", "sonnet", "haiku", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/**
 * The models a bot running `agentKey` may be pinned to (A12: picked from a list, never
 * typed). Claude Code: CLAUDE_MODELS above. Codex: the slugs in its own model cache,
 * `~/.codex/models_cache.json` `.models[].slug`, which Codex refreshes itself. Any agent:
 * plus its configured default (defaultModelFrom), except Antigravity, whose settings keep a
 * label that `--model` may not take (`agy models` names those). Others: empty (no pin offered).
 * `texts` as for defaultModelFrom.
 */
export function knownModelsFrom(agentKey, texts = {}) {
  const out = [];
  const add = (m) => { if (typeof m === "string" && m && !out.includes(m)) out.push(m); };
  if (agentKey === "claude") CLAUDE_MODELS.forEach(add);
  if (agentKey === "codex") {
    const cache = parseJson(texts.codexModels);
    for (const m of Array.isArray(cache?.models) ? cache.models : []) add(m?.slug ?? m?.id);
  }
  if (agentKey !== "antigravity") add(defaultModelFrom(agentKey, texts));
  return out;
}

/** knownModelsFrom over a synchronous `read(path)` under `home` (the CLI); no reader: the static list. */
export function knownModels(agentKey, { home, read } = {}) {
  return knownModelsFrom(agentKey, read && home ? textsOf(home, read) : {});
}

/** The arguments that start `agentKey` on `model` (A12), [] when there is no pin or no known flag. */
export function modelArgs(agentKey, model) {
  if (!model) return [];
  if (agentKey === "omp") return [`--model=${model}`]; // omp's help spells it --model=<value>
  const flags = FLAGS[agentKey];
  if (!flags) return [];
  return [flags.long?.[0] ?? flags.short[0], model];
}

/**
 * The model a bot's row shows (A12): for a running bot (`argv`: its pane's foreground), what
 * runs: the model its command line names, else the agent's own default (a pin it wasn't
 * started with doesn't run). For a bot that isn't running: its pin, else the default.
 * Returns { model, source: "detected" | "pinned" | "default" } or { model: null, source: null }.
 */
export function shownModel({ argv, agentKey, pinned, fallback }) {
  if (argv) {
    const detected = detectModel(argv, agentKey);
    if (detected) return { model: detected, source: "detected" };
  } else if (pinned) return { model: pinned, source: "pinned" };
  if (fallback) return { model: fallback, source: "default" };
  return { model: null, source: null };
}

/**
 * The agent key a name stands for in `agents` (a key, an executable or a `match` name, so
 * `claude-code` is `claude`), or null. What a person types for --agent goes through this. A
 * retired name (LEGACY_AGENTS) that `agents` doesn't list stands for its replacement.
 */
export function resolveAgent(name, agents = AGENTS) {
  if (typeof name !== "string" || !name.trim()) return null;
  if (agents[name]) return name;
  const found = agentKeyOfArgv([name], agents);
  if (found) return found;
  const next = LEGACY_AGENTS[name.trim()];
  return next && agents[next] ? next : null;
}

// Each agent's reasoning-effort flag, read from `<agent> --help` on this host (2026-11-02):
// Claude Code 2.1.316 `--effort <level>`; codex's config key `model_reasoning_effort`
// through `-c`; pi `--thinking <level>`; omp `--thinking=<value>`; agy 1.4.12
// `--effort` (low|medium|high|xhigh|max).
const EFFORT = {
  claude: (level) => ["--effort", level],
  codex: (level) => ["-c", `model_reasoning_effort=${level}`],
  pi: (level) => ["--thinking", level],
  omp: (level) => [`--thinking=${level}`],
  antigravity: (level) => ["--effort", level],
};

/** True when `agentKey` has an effort flag effortArgs knows. */
export const hasEffortFlag = (agentKey) => Boolean(EFFORT[agentKey]);

/** The arguments that start `agentKey` at reasoning `effort`, [] when none is given or known. */
export function effortArgs(agentKey, effort) {
  if (!effort || !EFFORT[agentKey]) return [];
  return EFFORT[agentKey](effort);
}

// How each agent takes a first prompt that starts an interactive session. Most read a bare
// trailing argument; agy 1.4.12 only through `-i` / `--prompt-interactive` (a stray
// trailing argument is an error).
const PROMPT = {
  antigravity: (task) => ["-i", task],
  "dsh-tui": (task) => ["--", plainPrompt(task)],
};

// dsh-tui's first prompt (a worker's task, a bot's briefing) goes after `--`, which DSH drops
// before it parses the next word: text that starts with "-" (`--resume=x`, `-c`) would be read
// as that option (#591 review N4). Such text gets a plain label in front; any other goes as it is.
const PROMPT_LABEL = "Prompt:";
/** `text` as a first prompt that never starts with "-": PROMPT_LABEL in front when it would. */
export const plainPrompt = (text) => (/^\s*-/.test(String(text)) ? `${PROMPT_LABEL} ${text}` : String(text));

/** The arguments that hand `agentKey` its first prompt `task`: the bare task unless PROMPT says otherwise. */
export function promptArgs(agentKey, task) {
  return PROMPT[agentKey] ? PROMPT[agentKey](task) : [task];
}

// How each agent picks up where it left off, for Restart: the words after its `run`. Each
// was read from that agent's own --help on 2026-11-03 (claude, codex resume, pi, omp, kimi,
// agy, hermes) and again on 2026-11-04 (omp 18.14.2 `-r, --resume=<value>` by ID prefix;
// codex-cli 0.166.0 `resume [SESSION_ID]` / `--last`; pi 1.5.0 `--session <path|id>`; kimi
// 2.5.0 `-S, --session [id]`; agy 1.5.0 `--conversation` by ID; hermes wasn't runnable then).
// Each resumes a known session by id, else (--continue, resume --last) the latest one, in its
// folder for most (codex resume --last filters by folder unless --all; agy's help says only "the
// most recent conversation"), which may be another bot's: so with no id and another bot on that
// agent in the folder, Restart starts fresh instead (#328). codex resume
// is a subcommand, which still goes after `run` (its top-level options come before it). An
// agent missing here has no resume this pack knows: Restart starts it fresh.
const RESUME = {
  claude: (session) => (session ? ["--resume", session] : ["--continue"]),
  codex: (session) => ["resume", session ?? "--last"],
  pi: (session) => (session ? ["--session", session] : ["--continue"]),
  omp: (session) => (session ? [`--resume=${session}`] : ["--continue"]),
  kimi: (session) => (session ? [`--session=${session}`] : ["--continue"]),
  antigravity: (session) => (session ? ["--conversation", session] : ["--continue"]),
  hermes: (session) => (session ? ["--resume", session] : ["--continue"]),
  // dsh-tui 0.19.0 (the DSH lane, #598): --resume <id>, else -c, the folder's last session.
  "dsh-tui": (session) => (session ? ["--resume", session] : ["-c"]),
};

// The agents whose id-less resume needs a turn finished in the old pane first (#598): dsh-tui's
// -c before any turn has ended there would pick up a session that isn't this pane's, or none.
// Restart reads the old pane's hc turn counter; a missing one counts as none: a new conversation.
const RESUME_AFTER_TURN = new Set(["dsh-tui"]);
/** True when `agentKey`'s id-less resume needs a finished turn in the old pane (RESUME_AFTER_TURN). */
export const resumeAfterTurn = (agentKey) => RESUME_AFTER_TURN.has(agentKey);

// The agents whose id-less resume isn't limited to the folder (agy 1.5.0: "Continue the most
// recent conversation"): any other bot on that agent, wherever it runs, may own that one.
const CONTINUES_ANYWHERE = new Set(["antigravity"]);
/** True when `agentKey`'s id-less resume may take a conversation from any folder (CONTINUES_ANYWHERE). */
export const continuesAnywhere = (agentKey) => CONTINUES_ANYWHERE.has(agentKey);

/** True when Restart can resume `agentKey`'s conversation (RESUME lists it). */
export const canResume = (agentKey) => Boolean(RESUME[agentKey]);

/** True when `agentKey` resumes a known session by its id (its RESUME entry takes one: every agent RESUME lists). */
export const resumesById = (agentKey) => typeof RESUME[agentKey] === "function" && RESUME[agentKey].length > 0;

/**
 * The words that resume `agentKey`'s last conversation, appended to its `run`: `session` is a
 * known session id (the pane's agent.session label), null when none is known. Null when the
 * agent has no resume (Restart then starts it fresh, and says so).
 */
export function resumeArgs(agentKey, session = null) {
  // Never a value that reads as a flag (the CLI passes only UUIDs; restart.js sessionId).
  const s = typeof session === "string" && session.trim() && !session.trim().startsWith("-") && resumesById(agentKey) ? session.trim() : null;
  return RESUME[agentKey] ? RESUME[agentKey](s) : null;
}

// The words an earlier resume left in a command line, per agent, so a reused command doesn't
// resume twice: `flags` stand alone, `valued` take the next word (or `=value`), `inline` only
// take `=value` (omp's --resume picks a session when bare), `optional` take `=value` or the next
// word unless it is a flag (kimi's -S, --session [id]). codex's is the `resume` subcommand with
// its --last or session id. -c is --continue (codex's is --config).
const RESUMED = {
  claude: { flags: ["--continue", "-c"], valued: ["--resume", "-r"] },
  omp: { flags: ["--continue", "-c", "--resume", "-r"], inline: ["--resume", "-r", "--restore"] },
  pi: { flags: ["--continue", "-c", "--resume", "-r"], valued: ["--session"] },
  kimi: { flags: ["--continue", "-c"], optional: ["--session", "-S"] },
  antigravity: { flags: ["--continue", "-c"], valued: ["--conversation", "-conversation"] },
  hermes: { flags: ["--continue"] },
  "dsh-tui": { flags: ["-c", "--continue"], valued: ["--resume"] },
};

/**
 * `args` (a command line) without the words that resumed a conversation (RESUMED; codex's
 * `resume --last` / `resume <id>`), for a restart that reuses the command and adds its own.
 */
export function withoutResume(agentKey, args) {
  const words = Array.isArray(args) ? args.map(String) : [];
  if (agentKey === "codex") {
    const i = words.indexOf("resume");
    if (i < 0) return words;
    const next = words[i + 1];
    const drop = next !== undefined && (next === "--last" || !next.startsWith("-")) ? 2 : 1;
    return [...words.slice(0, i), ...words.slice(i + drop)];
  }
  const r = RESUMED[agentKey];
  if (!r) return words;
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === "--") { out.push(...words.slice(i)); break; }
    const eq = w.startsWith("-") ? w.indexOf("=") : -1;
    const name = eq > 0 ? w.slice(0, eq) : w;
    if (eq > 0 && ((r.valued ?? []).includes(name) || (r.inline ?? []).includes(name) || (r.optional ?? []).includes(name))) continue;
    if (eq < 0 && (r.valued ?? []).includes(w)) { i += 1; continue; }
    if (eq < 0 && (r.optional ?? []).includes(w)) { if (i + 1 < words.length && !words[i + 1].startsWith("-")) i += 1; continue; }
    if (eq < 0 && (r.flags ?? []).includes(w)) continue;
    out.push(w);
  }
  return out;
}

// How each agent takes a bot's briefing at launch, as an addition to its own system prompt,
// so no hook has to print it on every turn. Each was read on 2026-11-04 from the agent itself:
// Claude Code 2.1.318 `--append-system-prompt-file <path>` (its parser takes it; a missing file
// is an error, even interactive), codex 0.166.0 `-c developer_instructions=<TOML string>`
// (`codex debug prompt-input` shows it as a developer message), omp 18.14.2
// `--append-system-prompt=<text or file>`, grok 1.0.70 `--rules <text>` ("extra rules to append
// to the system prompt"), pi 1.5.0 `--append-system-prompt <text>` ("text or file contents"),
// hermes 0.22.5's HERMES_EPHEMERAL_SYSTEM_PROMPT (its CLI reads it at start and adds it at every
// API call, never saving it). Hermes' variable REPLACES the owner's own overlay (its config's
// display.personality, else agent.system_prompt), and a codex -c replaces a developer_instructions
// in config.toml: the CLI skips both then (ownPromptIn), so an owner's own prompt is never lost. `file` takes the briefing's
// path, `text` its text, `env` names variables; `ours` tells this pack's own words apart from a
// person's. `hook`: it also takes the per-turn hook (Claude Code's UserPromptSubmit in the
// project's .claude/settings.local.json); `ownConfig`: its briefing yields to a prompt its own config
// file may set, which only this computer's is read for, so a linked machine's start leaves it out
// (#582). An agent missing here gets no briefing at launch (agy, cursor-agent, opencode and kimi
// have no flag that appends).
export const BRIEFING_MARK = "<herdr-bot>";
/** The folder, under an app home, that holds the briefings `file` agents are started with. */
export const BRIEFINGS_DIR = "automagik-herdr/briefings";
const ourText = (v) => String(v).startsWith(BRIEFING_MARK);
const ourFile = (v) => String(v).includes(`/${BRIEFINGS_DIR}/`);
const BRIEFING = {
  claude: { file: (path) => ["--append-system-prompt-file", path], names: ["--append-system-prompt-file"], ours: ourFile, hook: true },
  codex: {
    text: (t) => ["-c", `developer_instructions=${tomlString(t)}`], names: ["-c", "--config"],
    ours: (v) => /^developer_instructions\s*=/.test(String(v)) && String(v).includes(BRIEFING_MARK), ownConfig: true,
  },
  omp: { text: (t) => [`--append-system-prompt=${t}`], names: ["--append-system-prompt"], ours: ourText },
  pi: { text: (t) => ["--append-system-prompt", t], names: ["--append-system-prompt"], ours: ourText },
  grok: { text: (t) => ["--rules", t], names: ["--rules"], ours: ourText },
  hermes: { env: (t) => ({ HERMES_EPHEMERAL_SYSTEM_PROMPT: t }), ownConfig: true },
  // dsh-tui has no system-prompt flag and no hook (#598): the briefing is its first prompt, the
  // last words of its command after `--` (plainPrompt), on every launch, a resumed one too.
  "dsh-tui": { prompt: (t) => ["--", plainPrompt(t)], ours: (v) => ourText(String(v).replace(/^Prompt: /, "")) },
};

/**
 * `text` as a TOML basic string: JSON's escapes are TOML's, but TOML also wants U+007F escaped
 * and has no lone surrogates (a value codex can't parse would reach it as the raw literal).
 */
export function tomlString(text) {
  const whole = String(text).replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  return JSON.stringify(whole).replace(/\x7f/g, "\\u007f");
}

/**
 * Whether an agent's own config text (configPaths: codex's config.toml, hermes' config.yaml) sets
 * the prompt this pack's briefing would replace: codex's top-level developer_instructions, hermes'
 * display.personality or agent.system_prompt with a value. A key read loosely errs toward true:
 * the briefing is then left out with a warning, never the owner's prompt.
 */
export function ownPromptIn(agentKey, text) {
  const t = typeof text === "string" ? text : "";
  if (agentKey === "codex") return /^\s*developer_instructions\s*=/m.test(t);
  if (agentKey === "hermes") return hermesPromptIn(t);
  return false;
}

// Hermes' display.personality or agent.system_prompt with a value: inline (not "", '', null or
// ~), or on the lines below the key, more indented (a plain or block scalar). Unsure reads as set.
function hermesPromptIn(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^([ \t]*)(system_prompt|personality)[ \t]*:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[3].replace(/(^|[ \t])#.*$/, "").trim();
    if (inline && !/^(""|''|null|~|Null|NULL)$/.test(inline)) return true;
    if (inline) continue;
    const next = lines.slice(i + 1).find((l) => l.trim() && !/^[ \t]*#/.test(l));
    if (next !== undefined && /^[ \t]*/.exec(next)[0].length > m[1].length) return true;
  }
  return false;
}

/** How `agentKey` takes a briefing at launch: "file", "text", "env", "prompt" (its first prompt, last), or null when it has no way. */
export function briefingWay(agentKey) {
  const b = BRIEFING[agentKey];
  return b?.file ? "file" : b?.text ? "text" : b?.env ? "env" : b?.prompt ? "prompt" : null;
}

/** Whether `agentKey` takes the per-turn briefing hook (BRIEFING's `hook`). */
export const briefingHook = (agentKey) => Boolean(BRIEFING[agentKey]?.hook);
/** Whether `agentKey`'s briefing yields to a prompt in its own config file (BRIEFING's `ownConfig`). */
export const briefingOwnConfig = (agentKey) => Boolean(BRIEFING[agentKey]?.ownConfig);

/**
 * What starts `agentKey` with its briefing: { args, env }, `path` the briefing file (for a
 * "file" agent; null: it couldn't be written, so nothing), `text` the briefing itself. Null
 * when the agent has no way, or what it needs is missing.
 */
export function briefingLaunch(agentKey, { path = null, text = null } = {}) {
  const b = BRIEFING[agentKey];
  if (b?.file) return path ? { args: b.file(path), env: {} } : null;
  if (!text) return null;
  if (b?.text) return { args: b.text(text), env: {} };
  if (b?.env) return { args: [], env: b.env(text) };
  if (b?.prompt) return { args: b.prompt(text), env: {} };
  return null;
}

/** `args` without the briefing words this pack put in for `agentKey` (a person's own stay). */
export function withoutBriefing(agentKey, args) {
  const words = Array.isArray(args) ? args.map(String) : [];
  const b = BRIEFING[agentKey];
  // A "prompt" agent's briefing is `-- <it>`, last; a first prompt of a person's own stays.
  if (b?.prompt) {
    const i = words.indexOf("--");
    return i >= 0 && i + 1 < words.length && b.ours(words[i + 1]) ? [...words.slice(0, i), ...words.slice(i + 2)] : words;
  }
  if (!b?.names) return words;
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === "--") { out.push(...words.slice(i)); break; }
    if (b.names.includes(w) && i + 1 < words.length && b.ours(words[i + 1])) { i += 1; continue; }
    const eq = w.indexOf("=");
    if (eq > 0 && b.names.includes(w.slice(0, eq)) && b.ours(w.slice(eq + 1))) continue;
    out.push(w);
  }
  return out;
}

/**
 * `argv` (a whole command) with `launch` (briefingLaunch) put in right after the agent's own
 * executable, before any subcommand (codex's `resume` takes its -c there), and any briefing it
 * already carried taken out. A "prompt" agent's goes last instead (its first prompt), unless the
 * command already carries a first prompt of its own. A command that doesn't run `agentKey` (a
 * shell line) is left as it is.
 */
export function withBriefing(agentKey, argv, launch, agents = AGENTS) {
  const words = Array.isArray(argv) ? argv.map(String) : [];
  if (agentKeyOfArgv(words, agents) !== agentKey) return words;
  const at = programAt(words);
  const rest = withoutBriefing(agentKey, words.slice(at + 1));
  if (BRIEFING[agentKey]?.prompt) return [...words.slice(0, at + 1), ...rest, ...(rest.includes("--") ? [] : launch?.args ?? [])];
  return [...words.slice(0, at + 1), ...(launch?.args ?? []), ...rest];
}

/** The briefing file of this pack's that a Claude Code `argv` was started with (its last such flag), or null. */
export function briefingFileOf(argv) {
  const words = Array.isArray(argv) ? argv.map(String) : [];
  if (agentKeyOfArgv(words) !== "claude") return null;
  const { args } = agentArgv(words);
  const name = BRIEFING.claude.names[0];
  let found = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--") break;
    const value = args[i] === name ? args[i + 1] : args[i].startsWith(`${name}=`) ? args[i].slice(name.length + 1) : null;
    if (value != null) found = ourFile(value) ? value : null;
  }
  return found;
}

/**
 * The conversation a Claude Code `argv` resumes: its id (`--resume <id>`, `-r <id>`,
 * `--resume=<id>`), null for one with no id (`--continue`, `-c`, a bare --resume), undefined
 * when it resumes none.
 */
export function resumedSessionOf(agentKey, argv) {
  if (agentKey !== "claude") return resumesConversation(agentKey, argv) ? null : undefined;
  const { args } = agentArgv(argv);
  let found;
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i];
    if (w === "--") break;
    if (w === "--continue" || w === "-c") found ??= null;
    else if (w === "--resume" || w === "-r") { const v = args[i + 1]; found = v && !v.startsWith("-") ? v : null; }
    else if (w.startsWith("--resume=")) found = w.slice(9) || null;
  }
  return found;
}

/** True when `argv` resumes an earlier conversation of `agentKey` (the words RESUMED knows). */
export function resumesConversation(agentKey, argv) {
  const { args } = agentArgv(argv);
  return withoutResume(agentKey, args).length !== args.length;
}

/**
 * `args` (a command line) without the flags that name `agentKey`'s model (FLAGS: `--model X`,
 * `--model=X`, codex's `-m X`, `-mX` and `-c model=X`), so a bot's pin can replace them.
 */
export function withoutModel(agentKey, args) {
  const words = Array.isArray(args) ? args.map(String) : [];
  const flags = FLAGS[agentKey];
  if (!flags) return words;
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === "--") { out.push(...words.slice(i)); break; }
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    const name = eq > 0 ? w.slice(0, eq) : w;
    if ((flags.long ?? []).includes(name) || (flags.short ?? []).includes(name)) { if (eq < 0) i += 1; continue; }
    if ((flags.short ?? []).some((f) => w.startsWith(f) && w.length > f.length && !w.startsWith("--"))) continue;
    if ((flags.config ?? []).includes(name)) {
      const v = eq > 0 ? w.slice(eq + 1) : words[i + 1];
      if (typeof v === "string" && /^model\s*=/.test(v.trim())) { if (eq < 0) i += 1; continue; }
    }
    out.push(w);
  }
  return out;
}
