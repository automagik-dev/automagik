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
  // agy 1.5.3 takes permission flags (--dangerously-skip-permissions, --mode
  // accept-edits|auto|plan, --sandbox); this pack passes only --mode (agyModeArgs: auto unless
  // the roster names another mode), never a skip-permissions flag, and never writes agy's own
  // settings, so its trust list and saved settings stay the person's.
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
// 2.1.316, codex, omp, pi; 2026-11-09: agy 1.5.3, whose Go parser takes -model as --model). Agents not installed here have none listed, so their
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

/** Where the cache lives under an app home; the folder holds the pack's ledgers too. */
export const AG_MODELS_FILE = "automagik-herdr/antigravity-models.json";
// A list longer than this is not `agy models` (a corrupted file or a noisy program): refused.
const MAX_MODELS = 200;
// A model id the cache may keep: one word, never an option (it goes to --model).
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** `~`-free path of the cache under `appHome` (a trailing slash is not doubled). */
export const agModelsPath = (appHome) => `${String(appHome).replace(/\/+$/, "")}/${AG_MODELS_FILE}`;

/**
 * The models in `agy models`' stdout: one `id<TAB>label` line each (a run of spaces between the
 * two reads the same; a line with no separator, or an id that isn't one word, is skipped).
 * Duplicates keep the first; at most MAX_MODELS.
 */
export function parseAgModelsOutput(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^(\S+)(?:\t+| {2,})(.+?)\s*$/.exec(line);
    if (!m) continue;
    const id = m[1];
    if (!MODEL_ID.test(id) || out.some((x) => x.id === id)) continue;
    out.push({ id, label: m[2].trim() });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** The cache text for `models` listed at `at` (a Date.now() number or an ISO string). */
export function agModelsCacheText(models, at = Date.now()) {
  const when = typeof at === "string" ? at : new Date(at).toISOString();
  const kept = (Array.isArray(models) ? models : []).filter((m) => typeof m?.id === "string" && MODEL_ID.test(m.id))
    .slice(0, MAX_MODELS).map((m) => ({ id: m.id, label: typeof m.label === "string" ? m.label : "" }));
  return `${JSON.stringify({ version: 1, source: "agy models", at: when, models: kept }, null, 2)}\n`;
}

/**
 * A cache text as { at, models: [{ id, label }] }, or null when it isn't the pack's cache (not
 * JSON, no models, a model id that isn't one word). An older file with bare strings still reads.
 */
export function parseAgModelsCache(text) {
  const data = parseJson(text);
  if (!data || typeof data !== "object" || !Array.isArray(data.models)) return null;
  const models = [];
  for (const m of data.models) {
    const id = typeof m === "string" ? m : m?.id;
    if (typeof id !== "string" || !MODEL_ID.test(id) || models.some((x) => x.id === id)) continue;
    models.push({ id, label: typeof m?.label === "string" ? m.label : "" });
    if (models.length >= MAX_MODELS) break;
  }
  if (!models.length) return null;
  const at = typeof data.at === "string" && Number.isFinite(Date.parse(data.at)) ? data.at : null;
  return { at, models };
}

/**
 * The models a bot running `agentKey` may be pinned to (A12: picked from a list, never
 * typed). Claude Code: CLAUDE_MODELS above. Codex: the slugs in its own model cache,
 * `~/.codex/models_cache.json` `.models[].slug`, which Codex refreshes itself. Antigravity:
 * the ids the pack's cache holds from `agy models` (the format above; its settings keep a label
 * `--model` may not take), plus that cache's labels for the picker. Any other agent: plus its
 * configured default (defaultModelFrom). Others: empty (no pin offered).
 * `texts` as for defaultModelFrom; Antigravity's `antigravityModels` text is the cache's.
 */
export function knownModelsFrom(agentKey, texts = {}) {
  const out = [];
  const add = (m) => { if (typeof m === "string" && m && !out.includes(m)) out.push(m); };
  if (agentKey === "claude") CLAUDE_MODELS.forEach(add);
  if (agentKey === "codex") {
    const cache = parseJson(texts.codexModels);
    for (const m of Array.isArray(cache?.models) ? cache.models : []) add(m?.slug ?? m?.id);
  }
  if (agentKey === "antigravity") for (const m of parseAgModelsCache(texts.antigravityModels)?.models ?? []) add(m.id);
  else add(defaultModelFrom(agentKey, texts));
  return out;
}

/**
 * knownModelsFrom over a synchronous `read(path)` under `home`, plus the pack's Antigravity
 * model cache under `appHome`. No reader: the static list (Claude's), and no Antigravity list.
 */
export function knownModels(agentKey, { home, read, appHome } = {}) {
  const texts = read && home ? textsOf(home, read) : {};
  if (read && appHome) {
    try { texts.antigravityModels = read(agModelsPath(appHome)) ?? null; } catch { texts.antigravityModels = null; }
  }
  return knownModelsFrom(agentKey, texts);
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

// Each agent's reasoning-effort flag, read from `<agent> --help` on this host (2026-11-02:
// Claude Code 2.1.316 `--effort <level>`; codex's config key `model_reasoning_effort`
// through `-c`; pi `--thinking <level>`; omp `--thinking=<value>`; 2026-11-09: agy 1.5.3
// `--effort` (low|medium|high|xhigh|max)).
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

// agy 1.5.3's execution mode (`--mode accept-edits|auto|plan`): the pack names one on every
// Antigravity launch, auto unless the roster's agyMode says otherwise, so a bot doesn't stop at
// its first command. Never --dangerously-skip-permissions, and agy's own settings (its trust
// list included) stay the person's: the mode goes on the launch line only.
export const AGY_MODES = Object.freeze(["accept-edits", "auto", "plan"]);
/** The mode an Antigravity launch gets when the roster names none. */
export const AGY_MODE_DEFAULT = "auto";

/** `mode` when it names a launch, else AGY_MODE_DEFAULT (absent and empty included). */
export const agyModeOf = (mode) => (mode === undefined || mode === null || mode === "" ? AGY_MODE_DEFAULT : mode);
/** Why `mode` can't be passed to agy's --mode, or null (absent: the default). One line. */
export const agyModeProblem = (mode) => (AGY_MODES.includes(agyModeOf(mode)) ? null
  : `Antigravity mode ${JSON.stringify(mode)} isn't one of ${AGY_MODES.join(", ")}.`);

/**
 * The arguments that set `agentKey`'s execution mode: `--mode <mode>` for Antigravity, []
 * for every other agent, so its launch line stays byte-identical.
 */
export function agyModeArgs(agentKey, mode = null) {
  return agentKey === "antigravity" ? ["--mode", agyModeOf(mode)] : [];
}

// ---- Antigravity's per-launch permission list (--settings, #823) ----
//
// agy 1.5.3 reads a permission list from a session's --settings file, never saving it: the file
// is a JSON settings object whose `permissions.allow` and `permissions.deny` are arrays of rules.
// A rule is `command(<the words it starts with>)` (a prefix match on the argv) or
// `write_file(<an absolute folder>)` (the files inside it). A deny rule wins over an allow rule.
// agy replaces its saved list field by field, so every launch carries both arrays in full.

/**
 * The rules every Antigravity launch carries; a roster adds rules and can never drop one.
 *
 * This list is a guardrail against accidents, not a security boundary. A deny rule matches the
 * words' prefix only, so a quoted or reordered command, an absolute path or an interpreter call
 * can go around it. Two forms are not caught at all: a force refspec whose `+` is attached to
 * the ref (`git push origin +main`) and combined short flags (`git push -fu`). A reset form that
 * reaches `--hard` after other words (`git reset HEAD~1 --hard`) is not caught either; only the
 * leading-word form is. Allowing `node`, `bun` or `git` with any arguments already lets a
 * determined agent do anything. The real boundary is the sandbox (hcProxy). The list covers the
 * common ways a bot would lose work or land something it shouldn't.
 */
export const AGY_FIXED_DENY = Object.freeze([
  "command(git push --force)",
  "command(git push --force-with-lease)",
  "command(git push -f)",
  "command(git push origin --force)",
  "command(git push origin -f)",
  "command(git push --mirror)",
  "command(git push --delete)",
  "command(git reset --hard)",
  "command(git branch -D)",
  "command(git clean)",
  "command(git rebase)",
  "command(git stash)",
  "command(git checkout --)",
  "command(git -C)",
  "command(rm -rf)",
  "command(gh pr merge)",
  "command(gh release)",
]);

/** The rule types agy 1.5.3 takes: a command prefix, or a folder its files are written under. */
export const AGY_RULE_TYPES = Object.freeze(["command", "write_file"]);

/** Why `rule` can't go in a permission list, or null. One line. */
export function agyRuleProblem(rule) {
  if (typeof rule !== "string" || !rule.trim()) return "a rule is text such as command(git) or write_file(/folder)";
  const text = rule.trim();
  if (/[\n\r]/.test(text)) return `${JSON.stringify(text)} has a line break`;
  const m = /^([a-z_]+)\(([\s\S]*)\)$/.exec(text);
  if (!m) return `${JSON.stringify(text)} isn't a rule (command(...) or write_file(...))`;
  const [, type, inner] = m;
  if (!AGY_RULE_TYPES.includes(type)) return `${JSON.stringify(text)}: unknown rule type ${type} (${AGY_RULE_TYPES.join(" or ")})`;
  if (!inner.trim()) return `${JSON.stringify(text)}: ${type === "write_file" ? "no folder" : "no command"}`;
  if (type === "write_file") {
    if (!inner.trim().startsWith("/")) return `${JSON.stringify(text)}: write_file takes an absolute folder`;
    if (inner.includes(")")) return `${JSON.stringify(text)}: a folder can't hold ")" in a rule`;
  }
  return null;
}

/** A roster `agyPermissions` value as { allow, deny, problems }: only the rules that pass, deduped. */
export function normalizeAgyPermissions(value) {
  if (!isObject(value)) return { allow: [], deny: [], problems: ["agyPermissions is not an object with allow and deny lists"] };
  const problems = [];
  const out = { allow: [], deny: [] };
  for (const key of Object.keys(value)) if (!["allow", "deny"].includes(key)) problems.push(`agyPermissions ${key} isn't allow or deny; ignored`);
  for (const key of ["allow", "deny"]) {
    const list = value[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { problems.push(`agyPermissions ${key} is not a list of rules`); continue; }
    for (const rule of list) {
      const why = agyRuleProblem(rule);
      if (why) { problems.push(why); continue; }
      const text = rule.trim();
      if (!out[key].includes(text)) out[key].push(text);
    }
  }
  return { ...out, problems };
}

// The read-only gh verbs a bot needs to read its task's pull request, checks and issues. No
// release verb is here: the fixed deny `command(gh release)` wins over every one of them, so an
// allow could never take effect.
const AGY_GH_READ = ["gh pr view", "gh pr list", "gh pr diff", "gh pr checks", "gh pr status", "gh issue view",
  "gh issue list", "gh issue status", "gh repo view", "gh run list", "gh run view", "gh workflow list",
  "gh workflow view", "gh label list", "gh search repos", "gh search prs", "gh search issues"];
// The PR-writing verbs a writer needs to open and update its own PR; a read-only launch gets none.
// `gh pr merge` stays out of both: the fixed deny names it.
const AGY_GH_WRITE = ["gh pr create", "gh pr edit", "gh pr comment"];

// The repository's own gates (AGENTS.md, the pack's gate): checks and tests that don't write.
const AGY_GATES = ["node --test", "node --check", "bun test", "node scripts/privacy-check.mjs", "node scripts/am-copies.mjs",
  "node scripts/version.mjs", "node scripts/entries.mjs", "node scripts/parts.mjs", "node scripts/catalog.mjs",
  "node scripts/lane.ts", "node scripts/test-guard.mjs", "node ../scripts/privacy-check.mjs", "node ../scripts/am-copies.mjs"];

// The 24 plain read-only shell tools every Antigravity seat and worker gets by default (#840).
// On GNU/Linux, `sed -n` runs a program (GNU `e` command) and writes (`w` command, `-i`),
// `rg --pre` runs a program, `sort --compress-program` runs one, and `sort -o` and `uniq IN OUT`
// write files: those four stay on writing roles only (alongside `mkdir` and `chmod`, where `node`
// is already allowed) and out of `AGY_SHELL_READ` / `AGY_READ_ALLOW`. Shell launchers and
// wrappers (`bash`, `sh`, `env`, `xargs`, `find`, `awk`, `tee`, plain `sed`) are never in any
// default list.
export const AGY_SHELL_READ = Object.freeze([
  "ls", "cat", "head", "tail", "grep", "wc", "diff", "pwd", "echo", "cut", "tr", "jq", "printf",
  "basename", "dirname", "true", "which", "stat", "realpath", "readlink", "date", "nl", "comm",
  "column",
]);

// A seat or worker that writes: the shell tools the task needs (`mkdir`, `chmod`, `rg`, `sort`,
// `uniq` and `sed -n` only when the role writes, since writers already have `node`), and the
// gates to prove it.
export const AGY_WRITE_ALLOW = Object.freeze(["hc", "git", "node", "bun", "mkdir", "chmod",
  "rg", "sort", "uniq", "sed -n", ...AGY_SHELL_READ, ...AGY_GH_READ, ...AGY_GH_WRITE,
  ...AGY_GATES].map((v) => `command(${v})`));
// A read-only seat (rank reviewer) or worker (role review): hc, the 24 read-only shell tools,
// the test checks and a short list of git subcommands and gh reads. A subcommand is allowed with
// every argument it is given, so some can write (`git diff --output=file`): like the whole list,
// this is a guardrail, not a boundary. A reviewer seat or review worker needs `hc` (`hc ls`,
// `hc get`, `hc read`, `hc wait`, `hc send`) to inspect panes and report its verdict; as a
// word-prefix rule `command(hc)` also matches `hc run`, while `hcGuard` and `hcProxy` are the
// boundary that refuse `hc run` and `hc exec` inside a bot or worker pane.
export const AGY_READ_ALLOW = Object.freeze(["hc", ...AGY_SHELL_READ, "git log", "git diff",
  "git show", "git status", "git rev-parse", "git ls-files", "git blame", "git describe",
  "git merge-base", "git rev-list", "git cat-file", ...AGY_GH_READ, "node --test", "node --check",
  "bun test"].map((v) => `command(${v})`));

/**
 * The effective allow and deny rules of an Antigravity launch: the defaults its scope and role
 * need, plus the roster's own additions (a bot's `agyPermissions` reaches its workers too).
 * `scope`: "seat" (a bot) or "worker"; `role`: a worker's role (models.js callers pass
 * workers.js's ROLES: only "review" is read-only); `folder`: the project or worktree that
 * `write_file` opens to a writer. The fixed deny rules are always there; nothing drops them.
 * These lists are a guardrail against accidents, not a security boundary: a rule matches word
 * prefixes only, and allowing `node`, `bun` or `git` with any arguments lets a determined agent
 * do anything. Returns { allow, deny, warnings }.
 */
export function agyPermissionPlan({ bot, scope = "seat", role = null, folder = null }) {
  const readOnly = scope === "worker" ? role === "review" : bot?.rank === "reviewer";
  const allow = [...(readOnly ? AGY_READ_ALLOW : AGY_WRITE_ALLOW)];
  const warnings = [];
  if (!readOnly && typeof folder === "string" && folder) {
    const why = agyRuleProblem(`write_file(${folder})`);
    if (why) warnings.push(`${bot?.name ?? bot?.id ?? "the bot"}: ${why}`);
    else allow.push(`write_file(${folder})`);
  }
  const roster = bot?.agyPermissions === undefined ? { allow: [], deny: [], problems: [] } : normalizeAgyPermissions(bot.agyPermissions);
  allow.push(...roster.allow);
  for (const why of roster.problems) warnings.push(`${bot?.name ?? bot?.id ?? "the bot"}: ${why}`);
  const deny = [...AGY_FIXED_DENY, ...roster.deny];
  return { allow: [...new Set(allow)], deny: [...new Set(deny)], warnings };
}

// A stable, path-free tag for a folder in a settings file's name: FNV-1a, 8 hex characters.
function agyFolderTag(folder) {
  let h = 0x811c9dc5;
  for (const ch of String(folder)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The folder a launch's permission file goes in, under an app home (`<app home>`). */
export function agySettingsDir(appHomeDir) {
  return `${String(appHomeDir).replace(/\/+$/, "")}/automagik-herdr/agy-settings`;
}

/**
 * The per-launch settings file of `botId`'s launch under the settings folder `dir` (agySettingsDir
 * for a local launch, the proxy's private folder otherwise), deterministic from the approved data
 * an approved-worker plan has too (the bot id, the role and the worktree), so the plan and the
 * argv it approves name the same file. `scope`: "seat", "worker" (whose role and worktree tag the
 * name), or "helper" (a tree helper that is no worker, tagged by its folder so it never rewrites
 * the bot's own seat file).
 */
export function agySettingsFile(dir, botId, scope = "seat", role = null, folder = null) {
  const root = String(dir).replace(/\/+$/, "");
  const safeRole = /^[a-z][a-z0-9-]{0,31}$/.test(String(role ?? "")) ? role : "dev";
  const tail = scope === "worker" ? `worker-${safeRole}${folder ? `-${agyFolderTag(folder)}` : ""}`
    : scope === "seat" ? "seat" : `${String(scope).replace(/[^a-z0-9-]/g, "") || "helper"}${folder ? `-${agyFolderTag(folder)}` : ""}`;
  return `${root}/${botId}-${tail}.json`;
}

/**
 * The settings file an Antigravity launch of `bot` gets: { path, text, allow, deny, warnings },
 * or null for a bot with no id. `settingsDir` is the folder it goes in (agySettingsDir under the
 * app home; the proxy's own folder under the data root for an approved worker). `text` is the JSON
 * agy reads from `--settings`: permissions.allow and permissions.deny, both arrays in full (agy
 * replaces its saved lists field by field).
 */
export function agySettingsPlan({ bot, scope = "seat", role = null, folder = null, settingsDir }) {
  if (!bot?.id || !settingsDir) return null;
  const plan = agyPermissionPlan({ bot, scope, role, folder });
  const path = agySettingsFile(settingsDir, bot.id, scope, role, folder);
  const text = `${JSON.stringify({ permissions: { allow: plan.allow, deny: plan.deny } }, null, 2)}\n`;
  return { path, text, allow: plan.allow, deny: plan.deny, warnings: plan.warnings };
}

/** The words that hand `agentKey` a permission list from `path`: ["--settings", path], or []. */
export function agySettingsArgs(agentKey, path) {
  return agentKey === "antigravity" && path ? ["--settings", path] : [];
}

/** `args` without the --settings words an earlier Antigravity launch left in a command line. */
export function withoutAgySettings(agentKey, args) {
  const words = Array.isArray(args) ? args.map(String) : [];
  if (agentKey !== "antigravity") return words;
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === "--") { out.push(...words.slice(i)); break; }
    if (w === "--settings") { i += 1; continue; }
    if (w.startsWith("--settings=")) continue;
    out.push(w);
  }
  return out;
}

/**
 * `argv` (an Antigravity launch) with `--settings <path>` right after its program, any older
 * settings words taken out. Any other agent's argv, or one that doesn't run agy (a shell
 * template), is returned as it is.
 */
export function withAgySettings(agentKey, argv, path) {
  const words = Array.isArray(argv) ? argv.map(String) : [];
  if (agentKey !== "antigravity" || !path || agentKeyOfArgv(words) !== agentKey) return words;
  const at = programAt(words);
  const rest = withoutAgySettings(agentKey, words.slice(at + 1));
  return [...words.slice(0, at + 1), "--settings", path, ...rest];
}

/**
 * Whether agy's terminal sandbox, and so `--mode`, can work on this host, from local evidence
 * only: injected `platform` and `read(path) => string | null | undefined` (null: the file isn't
 * there, undefined: it couldn't be read). Linux: unprivileged user namespaces restricted when
 * max_user_namespaces is 0, unprivileged_userns_clone is 0 or apparmor_restrict_unprivileged_userns
 * is 1; every control unreadable is evidence too. macOS: the Seatbelt tool agy's sandbox uses,
 * /usr/bin/sandbox-exec. Returns { state: "available" | "missing" | "unknown", detail }.
 */
export function agySandbox({ platform = process.platform, read = () => null } = {}) {
  const view = (path) => {
    try { return read(path); } catch { return undefined; }
  };
  if (platform === "linux") {
    const controls = [
      ["/proc/sys/user/max_user_namespaces", "0", "max_user_namespaces is 0"],
      ["/proc/sys/kernel/unprivileged_userns_clone", "0", "unprivileged_userns_clone is 0"],
      ["/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "1", "apparmor_restrict_unprivileged_userns is 1"],
    ];
    let readable = 0, unreadable = 0;
    for (const [path, restricted, said] of controls) {
      const text = view(path);
      if (typeof text === "string") {
        readable += 1;
        if (text.trim() === restricted) return { state: "missing", detail: `unprivileged user namespaces are restricted (${said})` };
      } else if (text === undefined) unreadable += 1;
    }
    if (readable === 0) return { state: "missing", detail: "the unprivileged user namespace controls are unreadable" };
    if (unreadable) return { state: "unknown", detail: `some unprivileged user namespace controls are unreadable (${unreadable} of ${controls.length})` };
    return { state: "available", detail: "unprivileged user namespaces are not restricted" };
  }
  if (platform === "darwin") {
    const tool = view("/usr/bin/sandbox-exec");
    if (typeof tool === "string") return { state: "available", detail: "the Seatbelt sandbox tool is there (/usr/bin/sandbox-exec)" };
    if (tool === null) return { state: "missing", detail: "the Seatbelt sandbox tool is missing (/usr/bin/sandbox-exec)" };
    return { state: "unknown", detail: "the Seatbelt sandbox tool could not be read (/usr/bin/sandbox-exec)" };
  }
  return { state: "unknown", detail: `this platform (${platform}) isn't one agy's terminal sandbox is known on` };
}

// How each agent takes a first prompt that starts an interactive session. Most read a bare
// trailing argument; agy 1.5.3 only through `-i` / `--prompt-interactive` (a stray trailing
// argument is an error).
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
// 2.5.0 `-S, --session [id]`; 2026-11-09: agy 1.5.3 `--conversation` by ID, `-c`/`--continue`
// the latest; hermes wasn't runnable then).
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

// The agents whose id-less resume isn't limited to the folder (agy 1.5.3: "Continue the most
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

// The agents whose new session's id Herdr chooses at launch (RFC 0021 (f) 2), and the words
// that pass it: Claude Code 2.1.319 `--session-id <uuid>` ("Use a specific session ID for the
// conversation (must be a valid UUID)", read from `claude --help` on 2026-11-09). Claude refuses
// it beside --continue or --resume (unless --fork-session), so it goes only on a fresh launch.
const SESSION_ID = {
  claude: (id) => ["--session-id", id],
};

/** True when Herdr chooses the session id of a fresh `agentKey` launch (SESSION_ID lists it). */
export const choosesSession = (agentKey) => Boolean(SESSION_ID[agentKey]);

/** The words that start `agentKey` on the new session `id`: [] for an agent Herdr doesn't choose ids for. */
export const sessionIdArgs = (agentKey, id) => (SESSION_ID[agentKey] && typeof id === "string" && id ? SESSION_ID[agentKey](id) : []);

// A Claude command line's own session words: a resume, a continue, or a session id of its own.
const CLAUDE_SESSION_WORD = /^(?:--resume|-r|--continue|-c|--session-id|--fork-session)(?:=|$)/;

/**
 * Whether a command already picks its own Claude session: its argv (or, for a template, its
 * shell command's words) holds --resume, -r, --continue, -c, --session-id or --fork-session.
 * Such a launch gets no id from Herdr: a person's own words win.
 */
export function ownsSession(command) {
  const words = Array.isArray(command) ? command.map(String) : String(command ?? "").split(/[\s'"]+/);
  return words.some((w) => CLAUDE_SESSION_WORD.test(w));
}

// The words an earlier resume left in a command line, per agent, so a reused command doesn't
// resume twice: `flags` stand alone, `valued` take the next word (or `=value`), `inline` only
// take `=value` (omp's --resume picks a session when bare), `optional` take `=value` or the next
// word unless it is a flag (kimi's -S, --session [id]). codex's is the `resume` subcommand with
// its --last or session id. -c is --continue (codex's is --config).
const RESUMED = {
  claude: { flags: ["--continue", "-c"], valued: ["--resume", "-r", "--session-id"] },
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
  "dsh-tui": {
    prompt: (t) => {
      const name = String(t).match(/^You are (.+), (?:this project's main bot|a team member) \(bot [^)]+\)\.$/m)?.[1];
      return ["--", plainPrompt(name ? `${name} - ${t}` : t)];
    },
    ours: (v) => ourText(String(v).replace(/^Prompt: /, "").replace(/^.* - (?=<herdr-bot>)/, "")),
  },
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
