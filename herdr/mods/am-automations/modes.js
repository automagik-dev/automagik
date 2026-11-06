// What an automation's fresh session may do without asking (#498): the permission flags in its
// agent_args or in its template's command, read as a mode to show, and the automatic mode a new
// automation starts with. Plus the address check on a prompt. Pure: no `herdr`, so `node --test`
// runs it. Apache-2.0.

// The permission flags each agent takes: plain ones and ones with a value (`--flag v` or
// `--flag=v`). Every other word of agent_args is left alone.
const PERMISSION = Object.freeze({
  claude: { flags: ["--dangerously-skip-permissions"], valued: ["--permission-mode"] },
  codex: { flags: ["--dangerously-bypass-approvals-and-sandbox", "--yolo", "--full-auto"], valued: ["-a", "--ask-for-approval", "-s", "--sandbox"] },
  omp: { flags: ["--auto-approve"], valued: [] },
});

// The automatic mode a new fresh-session automation starts with, per agent (#498, owner ruling
// 2026-11-06): an unattended run must be able to work, so codex skips its approvals and sandbox and
// claude its permission prompts, the same pair of flags. One table, so turning one down is one
// line. pi and every other agent: none, and the form says so. A template's command is never
// given these (its own flags stand).
export const AUTO_ARGS = Object.freeze({
  codex: Object.freeze(["--dangerously-bypass-approvals-and-sandbox"]),
  claude: Object.freeze(["--dangerously-skip-permissions"]),
});

/** `argv` split into its permission words (in order, values kept with their flag) and the rest. */
export function splitPermission(agent, argv) {
  const p = PERMISSION[agent], perm = [], rest = [];
  const words = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < words.length; i += 1) {
    const w = String(words[i]), name = w.split("=")[0];
    if (p?.flags.includes(w)) perm.push(w);
    else if (p?.valued.includes(name)) { perm.push(w); if (!w.includes("=") && i + 1 < words.length) perm.push(String(words[++i])); }
    else rest.push(w);
  }
  return { perm, rest };
}

/** The automatic mode's flags for a new `agent` automation (AUTO_ARGS), or null when it has none. */
export function autoArgs(agent) {
  return Object.hasOwn(AUTO_ARGS, agent) ? [...AUTO_ARGS[agent]] : null;
}

const value = (perm, names) => {
  for (let i = 0; i < perm.length; i += 1) {
    const [name, v] = perm[i].split(/=(.*)/s);
    if (names.includes(name)) return v ?? perm[i + 1] ?? "";
  }
  return null;
};

/** The mode `argv` gives `agent`, in words: "automatic (…)", the flags' own values, or "agent default". */
export function modeOf(agent, argv) {
  const { perm } = splitPermission(agent, argv);
  if (!perm.length) return "agent default";
  if (agent === "claude") {
    if (perm.includes("--dangerously-skip-permissions")) return "automatic (skips permissions)";
    return `permission mode ${value(perm, ["--permission-mode"])}`;
  }
  if (agent === "codex") {
    if (perm.includes("--dangerously-bypass-approvals-and-sandbox") || perm.includes("--yolo")) return "automatic (no approvals, no sandbox)";
    if (perm.includes("--full-auto")) return "full auto (sandboxed)";
    const a = value(perm, ["-a", "--ask-for-approval"]), s = value(perm, ["-s", "--sandbox"]);
    return [a !== null && `approvals ${a}`, s !== null && `sandbox ${s}`].filter(Boolean).join(" · ");
  }
  return "automatic (auto-approve)";
}

const base = (w) => String(w).split("/").pop();

/** A template's mode, from its hc command: the agent its command starts, then that agent's flags. */
export function templateMode(command) {
  const words = String(command ?? "").trim().split(/\s+/);
  const at = words.findIndex((w) => Object.hasOwn(PERMISSION, base(w)) || base(w) === "pi");
  return at < 0 ? "not known (no agent in its command)" : modeOf(base(words[at]), words.slice(at + 1));
}

/** agent_args as one line to edit: a word with a space or a quote in it is double-quoted. */
export function argsText(args) {
  return (Array.isArray(args) ? args : []).map((w) => (/^[^\s"'\\]+$/.test(w) ? w : JSON.stringify(w))).join(" ");
}

/** argsText's line back into words: spaces split, "…" and '…' keep theirs. */
export function parseArgs(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] ?? m[3]);
  }
  return out;
}

// An hc terminal address, bare (t3q1) or with its machine (build-box/t9): a t and a digit first,
// so English words stay out. A name given with hc --name can't be told apart; it isn't caught.
const ADDRESS = /(?<![\w./-])(?:[a-z0-9][a-z0-9._-]*\/)?t[0-9][0-9a-z]*(?![\w-])/g;

/** The terminal addresses in `text`, each once, in order. */
export function addressesIn(text) {
  return [...new Set([...String(text ?? "").matchAll(ADDRESS)].map((m) => m[0]))];
}

/** The warning for a prompt that names terminals, or null. It never stops a save. */
export function addressWarning(text) {
  const found = addressesIn(text);
  if (!found.length) return null;
  const one = found.length === 1;
  return `${found.join(", ")} ${one ? "is a terminal address" : "are terminal addresses"}; `
    + `${one ? "it changes" : "they change"} on restart. Name the bot instead (its name or b-… id).`;
}
