// am-quota: the Accounts panel, and the one thing it changes: which account the local clients use.
//
// Reads: the proxy's own endpoints (via ./proxy.js), the management key from cliproxyapi's key
// file or $CLIPROXY_MGMT_KEY, the base URL and optional display name from <app home>/cliproxy.json,
// and what this panel installed from <app home>/data/am-quota/active.json. ./view.js turns that
// into what each tool's card says; this file draws it.
// Writes: only when the person presses Switch or Use: a credential file (Codex) or the Keychain
// item plus .credentials.json (Claude), through ./switch.js, with a backup, 0600, temp + atomic
// rename, and never a token in a log, a notify, shared state or an error message. After a
// switch, Restart runs `automagik-herdr restart <bot>` for the bots still on the old account,
// once the person confirms.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, hc, theme, appHome, home, readTextFile, window as appWindow, writeTextFile } from "herdr";
import { client, QuotaSampler } from "./proxy.js";
import { credentialTarget, keychainReadScript, keychainService, tokenIdentity, TARGETS } from "./translate.js";
import { install } from "./switch.js";
import { claim, release } from "./lock.js";
import { payloadDir, sweepScript } from "./write.js";
import { TOOLS, instanceName, openUrl, staleBots, toolView, who } from "./view.js";

const POLL = 60000;
/** How often the installed credential's identity is re-read. It is a token-bearing item; the
 *  badge does not need it sixty times an hour. */
const IDENTITY_EVERY = 300000;
const KEY_FILE = "~/.config/cliproxyapi/mgmt.key";
const KEY_ENV = "CLIPROXY_MGMT_KEY";
const STATE = "am-quota/active.json";
/** How long the Restart button stays armed for its confirming second click. */
const ARMED = 5000;
// Waiting for a busy bot (#413): one hc wait at a time, each at most IDLE_WAIT_S (hc's own
// --timeout), through exec with IDLE_EXEC_MS, under Herdr's 10 min exec cap (hc() stops at 30 s, and
// a Herdr with no exec timeout cuts each wait at 30 s). IDLE_WAITS waits at most, plus one for each
// helper, and never past IDLE_WAITS * IDLE_WAIT_S in all. What it waited is said, never promised.
const IDLE_WAIT_S = 450;
const IDLE_EXEC_MS = 480_000;
const IDLE_WAITS = 4;
// A restart runs in an hc terminal of its own (#433), not through exec: Herdr ends what exec runs at
// its limit (30 s on a Herdr that ignores exec's timeout), which can be part-way through a restart.
// The panel follows that terminal to its end and reads the CLI's answer from the files it leaves.
// Each look: the answer's files, then hc get of the terminal, then one hc wait of RUN_WAIT_S (under
// 30 s, so it ends by itself on any Herdr). The panel follows a restart RUN_FOLLOW_MS, plus
// RUN_HELPER_MS per helper on a --tree one (65 s for the bot at worst, then 40 s per helper, one at
// a time: its old pane's end 10 s, its new one 30 s), then says it still runs and where.
const RUN_WAIT_S = 25;
const RUN_WAIT_EXEC_MS = 28_000;
const RUN_FOLLOW_MS = 300_000;
const RUN_HELPER_MS = 40_000;
// A wait that answers at once (hc refusing it, say) is followed by this pause, so a look is never a busy loop.
const RUN_PAUSE_MS = 5_000;
/** The label of a restart's terminal: the bot's id, so a second press finds a run still going. */
const RUN_LABEL = "am-quota.restart";
/** Where a restart's terminal leaves the CLI's stdout, stderr and exit code, under the app's data. */
const RUNS = "data/am-quota/runs";
// The restart terminal's program: `sh -c RUN_SCRIPT sh <out> <err> <code> <the CLI's argv…>`. The
// paths and the argv are its arguments, never part of the script. Files older than a day go first.
// The exit code is written last, through a rename, so a code read means the other two are whole.
// HC_TERMINAL_ID is unset so the CLI runs as it does under exec: not inside a pane of its own. The
// folder is made before (PREPARE_SCRIPT), so a folder that can't be made is said: nothing ran.
const RUN_SCRIPT = [
  'out=$1 err=$2 code=$3; shift 3',
  'find "${out%/*}" -maxdepth 1 -type f -mmin +1440 -exec rm -f {} + 2>/dev/null',
  'unset HC_TERMINAL_ID',
  '"$@" >"$out" 2>"$err"; c=$?',
  'cat "$err" >&2',
  'printf "%s\\n" "$c" >"$code.tmp" && mv -f "$code.tmp" "$code"',
].join("\n");
// Run through exec before each restart, in Herdr's environment: `sh -c PREPARE_SCRIPT sh <runs
// folder> <names…>` makes the folder (exit 3 when it can't) and prints NAME=value for each name set.
const PREPARE_SCRIPT = 'mkdir -p -- "$1" || exit 3; shift; for n; do v=$(printenv -- "$n") && printf "%s=%s\\n" "$n" "$v"; done; exit 0';
// What the CLI reads from its environment: PATH (its node through run.sh, hc, an agent's program and
// the PATH a new pane gets), HOME, NVM_DIR (run.sh's nvm node), VIRTUAL_ENV (left off a pane's PATH)
// and HERMES_HOME. A restart's terminal starts in herdr-core's environment, not Herdr's, so these are
// passed as Herdr has them (one Herdr hasn't set is unset): the CLI runs as it did under exec.
const CLI_ENV = ["PATH", "HOME", "NVM_DIR", "VIRTUAL_ENV", "HERMES_HOME"];
// A --tree restart: the panel has waited already, so the CLI's own wait for a turn (10 min unless
// told) is only a guard against a race.
const TREE_TURN_WAIT_MS = 10_000;
/** The bot CLI, run the way the sidebar runs it (am-sidebar/launch.js runCli). */
const SIDEBAR = "am-sidebar";

const expand = (p) => (p.startsWith("~/") ? `${home()}${p.slice(1)}` : p);
const slug = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
const wake = (context) => context.notify();
const message = (err) => String(err?.message ?? err);
const QUOTED = /"[^"]*"/g;
/** A sentence up to the clause that names a flag ("Let it finish, or pass …": "Let it finish."). */
const beforeFlag = (line) => {
  const at = line.search(/(^|[\s(])--[a-z]/);
  if (at < 0) return line;
  const comma = line.slice(0, at).lastIndexOf(", ");
  return comma > 0 ? `${line.slice(0, comma)}.` : "";
};
/**
 * CLI text as the panel may show it (#413): no clause that names a flag, because the panel never
 * offers one as a way out. What an agent said is in double quotes, kept as it said it.
 */
export function plain(text) {
  const quotes = [];
  const masked = String(text ?? "").replace(QUOTED, (q) => `\u0000${quotes.push(q) - 1}\u0000`);
  const kept = masked.split(/(?<=[.!?])\s+/).map(beforeFlag).filter(Boolean).join(" ");
  return kept.replace(/\u0000(\d+)\u0000/g, (_m, i) => quotes[Number(i)]);
}
/** A restart's note for the panel: its resume words ("resume --last") as words, not a flag. */
const noteText = (note) => note.replace(/(resume )?--[a-z][a-z-]*/g, "a resume");
/**
 * Why a bot CLI run failed, as cli() gives it (#413): the --json \`error\` when it printed one (a
 * restart whose new pane exited names its agent's own last line there), else stderr's last line.
 * The refusal is the CLI's last word: warnings come before it, so never its first line.
 */
const refusal = (r) => plain(typeof r?.out?.error === "string" && r.out.error.trim()
  ? r.out.error.trim() : String(r?.err ?? "").split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "");
/**
 * The bot CLI's argv with --json, run the way the sidebar runs it (am-sidebar/launch.js runCli), or
 * null when the sidebar mod (which carries the CLI) is not installed. `env`: more KEY=value words.
 */
async function cliArgv(args, env = [], unset = []) {
  const dir = appHome().replace(/\/+$/, "");
  const runner = `${dir}/mods/${SIDEBAR}/bin/run.sh`;
  const there = await readTextFile(runner).then((t) => t !== null && t !== undefined, () => false);
  if (!there) return null;
  return ["env", ...unset.flatMap((n) => ["-u", n]), `HERDR_APP_HOME=${dir}`, ...env, "sh", runner, `${dir}/mods/${SIDEBAR}/bin/automagik-herdr.mjs`, ...args, "--json"];
}
/** What hc said when it failed, in plain words: its JSON error's message, else its last line, never a flag. */
function hcSaid(r) {
  const text = String(r?.stderr || r?.stdout || "").trim();
  let said = text.split("\n").at(-1) ?? "";
  try {
    const e = JSON.parse(text)?.error;
    if (typeof e?.message === "string" && e.message.trim()) said = e.message.trim();
    else if (typeof e?.kind === "string") said = e.kind.replace(/_/g, " ");
  } catch {}
  // Up to the first clause that names a flag ("…; pass --start to start it"), then plain().
  const clauses = said.replace(/^hc: /, "").split(/(?<=[;,])\s+/);
  const flagged = clauses.findIndex((c) => /(^|[\s(])--[a-z]/.test(c));
  const kept = flagged < 0 ? clauses : clauses.slice(0, flagged);
  return plain(kept.join(" ").replace(/[;,.]\s*$/, "")).replace(/[.]$/, "");
}
/** A CLI run's { code, out: its --json stdout or null, err: stderr without the CLI's name }. */
function cliAnswer(code, stdout, stderr) {
  let out = null;
  try {
    out = JSON.parse(stdout ?? "");
  } catch {}
  return { code, out, err: String(stderr ?? "").replace(/^automagik-herdr: /gm, "").trim() };
}
/** Why a restart's terminal gave no answer; `partway`: it may have stopped part-way. */
function runError(why, { partway = false } = {}) {
  return Object.assign(new Error(why), { partway });
}
/** The live rows of `hc ls --json`'s stdout (a list, or { terminals }), each with an address. */
function liveRows(stdout) {
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return [];
  }
  const list = Array.isArray(rows) ? rows : rows?.terminals ?? [];
  return list.filter((r) => r?.address && (r.state === undefined || r.state === "live"));
}
/** "2 min", from ms: what a wait really took. */
const waited = (ms) => (ms < 60000 ? "under a minute" : `${Math.round(ms / 60000)} min`);
/** The platform the panel runs on: `security` exists on macOS only. */
const platform = () => {
  try {
    return appWindow()?.platform ?? "macos";
  } catch {
    return "macos";
  }
};
/**
 * Values of the named environment variables (the shell's real environment): never logged. An unset
 * variable is not a failure (the script exits 0); a read that could not run rejects, because an
 * unknown CLAUDE_CONFIG_DIR must not be mistaken for none — that would act on the default login.
 */
const readEnv = async (names) => {
  const out = {};
  await Promise.all(names.map(async (name) => {
    const r = await exec("sh", ["-c", 'v=$(printenv -- "$1") || exit 0; printf %s "$v"', "sh", name]);
    if (r?.code !== 0) throw new Error(`could not read ${name}`);
    const v = String(r.stdout ?? "").trim();
    if (v) out[name] = v;
  }));
  return out;
};
/**
 * What the record this panel keeps says about the login on the Mac. The record is only a claim:
 * an open session can refresh the *old* account back into the Keychain, so it is checked against
 * the installed credential. An unreadable item (no `security`, a locked Keychain) keeps the claim,
 * because a guess is worse than the record.
 */
export const badgeFor = (record, installed) => {
  if (!record) return null;
  if (!record.fingerprint || !installed?.known) return { text: "in use" };
  if (!installed.fingerprint) return { text: "no longer installed" };
  return installed.fingerprint === record.fingerprint ? { text: "in use" } : { text: "changed outside this panel" };
};

/**
 * `active.json`, tolerant of its older shapes: a bare name is a record, and a record left by the
 * saved Claude logins this panel no longer keeps (`saved:<name>`) is no proxy account's.
 */
export const records = (raw) => {
  const out = {};
  for (const [provider, value] of Object.entries(raw ?? {})) {
    const name = typeof value === "string" ? value : typeof value?.name === "string" ? value.name : null;
    if (!name || name.startsWith("saved:")) continue;
    out[provider] = { name, fingerprint: typeof value?.fingerprint === "string" ? value.fingerprint : null };
  }
  return out;
};

export default class AmQuota extends View {
  init(_given, cx) {
    this.tool = "claude";   // the tool the switch at the top shows
    this.accounts = null;   // the proxy's accounts, sampled for a burn rate; null before a read
    this.badges = {};       // provider → badgeFor(...) of the last read
    this.config = null;     // cliproxy.json: { url, name? }
    this.error = null;      // the proxy read's own error
    this.setup = null;      // what is missing before there is anything to read
    this.switchError = null; // a failed switch, kept until the next one
    this.busy = null;       // the running switch, or null
    this.active = {};       // provider → { name, fingerprint } this panel installed
    this.identities = {};   // provider → { at, value }: the last read of what is installed
    this.env = {};          // the clients' environment (CODEX_HOME, CLAUDE_CONFIG_DIR)
    this.quotaError = null;
    this.switched = {};     // provider → the last switch: { at, from, to, look, result }
    this.armed = null;      // "restart:<provider>" waiting for its second click
    this.restarting = {};   // provider → true while its bots restart (lock.claim reads it)
    this.seen = 0;          // last render; a hidden copy stops polling
    this.hidden = false;
    this.sampler = new QuotaSampler();
    cx.timer.every(POLL, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      // Which account this panel installed, read once — before the first proxy read, so the
      // first verdict already knows what is in use.
      try {
        const raw = await readTextFile(`${appHome()}/data/${STATE}`);
        if (raw) this.active = records(JSON.parse(raw));
      } catch {}
      await exec("sh", ["-c", sweepScript(), "sh", payloadDir(appHome())]).catch(() => {});
      this.reload(cx);
    });
  }

  async settings() {
    // The app's environment does not change while it runs: read it once, not once a minute. A
    // failed read is not cached (the next call tries again) and is reported as `envKnown: false`.
    let env = {};
    let envKnown = true;
    try {
      env = await (this.envVars ??= readEnv([KEY_ENV, "CODEX_HOME", "CLAUDE_CONFIG_DIR"]));
    } catch {
      this.envVars = null;
      envKnown = false;
    }
    let config = null;
    try {
      const parsed = JSON.parse((await readTextFile(`${appHome()}/cliproxy.json`)) ?? "null");
      if (parsed && typeof parsed.url === "string") config = { url: parsed.url, name: parsed.name ?? null };
    } catch {}
    let key = env[KEY_ENV] || null;
    if (!key) {
      try {
        key = ((await readTextFile(expand(KEY_FILE))) ?? "").trim() || null;
      } catch {}
    }
    const clients = { CODEX_HOME: env.CODEX_HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR };
    return { config, key, envKnown, env: clients };
  }

  /** The timer's body: a hidden panel does not need a fresh read (its timer keeps running). */
  tick(cx) {
    if (this.hidden) return;
    if (this.seen && Date.now() - this.seen > POLL * 2) return;
    this.reload(cx);
  }

  reload(cx) {
    const seq = (this.seq ?? 0) + 1;
    this.seq = seq;
    cx.spawn(async (cx) => {   // one read of the proxy; the newest wins
      const { config, key, env } = await this.settings();
      if (seq !== this.seq) return;
      this.env = env;
      this.config = config;
      try {
        this.setup = !config ? "proxy" : !key ? "key" : null;
        if (this.setup) {
          this.accounts = null;
          this.error = null;
          return;
        }
        const api = client({ base: config.url, key, fetch });
        const { accounts, quotaError } = await api.accounts();
        if (seq !== this.seq) return;   // a newer read owns the panel, and the samples
        const sampled = this.sampler.read(accounts, { now: Date.now() });
        const badges = {};
        for (const provider of Object.keys(TOOLS)) {
          const installed = await this.installedIdentity(provider, env);
          badges[provider] = badgeFor(this.active[provider] ?? null, installed);
        }
        if (seq !== this.seq) return;
        this.api = api;
        this.accounts = sampled;
        this.badges = badges;
        this.quotaError = quotaError;
        this.error = null;
      } catch (err) {
        if (seq !== this.seq) return;
        this.error = message(err);
        this.accounts = null;
      } finally {
        if (seq === this.seq) wake(cx);
      }
    });
  }

  /**
   * The token identity of what is installed now, for the badge. Read when the panel opens, after a
   * switch, and then at most every five minutes: the item holds tokens, and a fingerprint compare
   * is not worth reading it on every 60 s poll. `known` is false when nothing can be read (no
   * `security`, a locked Keychain): an unverifiable record keeps its badge rather than flipping on
   * a guess. Never logged.
   */
  async installedIdentity(provider, env) {
    if (!this.active[provider]?.fingerprint) return null;
    const now = Date.now();
    const cached = this.identities[provider];
    if (cached && now - cached.at < IDENTITY_EVERY) return cached.value;
    const value = await this.readIdentity(provider, env);
    this.identities[provider] = { at: now, value };
    return value;
  }

  async readIdentity(provider, env) {
    const plan = credentialTarget(provider, { home: home(), env, keychainWritten: true, platform: platform() });
    try {
      // macOS Claude reads the Keychain first — with or without a CLAUDE_CONFIG_DIR — so the item
      // is what says which account the CLI would use; the file is the answer only where there is
      // no `security`.
      if (plan.keychain) {
        const service = await keychainService(plan, { exec });
        if (!service) return null;
        const r = await exec("sh", ["-c", keychainReadScript(), "sh", service]);
        if (r.code === 0) return { known: true, fingerprint: tokenIdentity(provider, r.stdout) };
        if (r.code === 44) return { known: true, fingerprint: null };   // no item: nothing is installed
        return null;
      }
      return { known: true, fingerprint: tokenIdentity(provider, await readTextFile(plan.file)) };
    } catch {
      return null;
    }
  }

  /** The card for one tool, from the last read. */
  view(provider) {
    return toolView({
      provider, accounts: this.accounts ?? [], record: this.active[provider] ?? null,
      badge: this.badges[provider] ?? null, now: Date.now(), source: instanceName(this.config),
    });
  }

  // Installs one credential into the client that owns that provider. The flow lives in ./switch.js
  // (tested with its shell and files injected); the panel owns the record, the banner and the lock.
  use(provider, account, cx) {
    if (!TARGETS[provider]) return;
    if (!this.api) {
      this.switchError = "no proxy read yet";
      wake(cx);
      return;
    }
    // A second click starts nothing; the busy line names the account by email, never its file.
    const refused = claim(this, provider, account, `switching ${TOOLS[provider]} to ${who(account)}…`);
    if (refused) {
      this.switchError = refused;
      wake(cx);
      return;
    }
    this.switchError = null;
    const before = this.view(provider).current;
    cx.spawn(async (cx) => {   // one switch at a time
      wake(cx);
      try {
        // Claude's item depends on CLAUDE_CONFIG_DIR: an unknown environment is a refusal.
        if (provider === "claude") await this.knownEnv();
        const result = await install({ api: this.api, provider, account, ...this.io() });
        this.active[provider] = { name: account.name, fingerprint: result.fingerprint };
        await this.record(provider);
        this.armed = null;
        this.switched[provider] = { at: Date.now(), from: before ? who(before) : null, to: who(account), look: "loading" };
        this.findBots(provider, cx);
        this.reload(cx);   // the card and the verdict follow the credential that is now installed
      } catch (err) {
        this.switchError = message(err);
      } finally {
        release(this);
        wake(cx);
      }
    });
  }

  /** The machine the writers act on: the runtime's files and shell, the clients' environment. */
  io() {
    return { home: home(), appHome: appHome(), env: this.env, platform: platform(), exec, readTextFile, writeTextFile };
  }

  /**
   * Writes `active.json` and drops the cached identity, so the card follows what was written. A
   * failed write is shown, not swallowed: a stale record would name the wrong account in use.
   */
  async record(provider) {
    delete this.identities[provider];
    // writeTextFile wants the snapshot it replaces: null only creates.
    const statePath = `${appHome()}/data/${STATE}`;
    const before = await readTextFile(statePath).catch(() => null);
    try {
      await writeTextFile(statePath, JSON.stringify(this.active, null, 2) + "\n", before ?? null);
    } catch (err) {
      // Keep memory equal to disk: the record on disk is what the next session will read.
      try {
        this.active = before ? records(JSON.parse(before)) : {};
      } catch {}
      throw new Error(`the login was written, but active.json could not record it (${message(err).slice(0, 80)}) — the panel may name the wrong account in use`);
    }
  }

  /** The clients' environment, or a refusal: an unknown CLAUDE_CONFIG_DIR names an unknown item. */
  async knownEnv() {
    const s = await this.settings();
    if (!s.envKnown) throw new Error("could not read this app's environment (CLAUDE_CONFIG_DIR), so which login Claude uses is unknown; nothing was changed");
    this.env = s.env;
  }

  /**
   * The bot CLI with --json through exec, as the sidebar runs it: { code, out, err }, or null when
   * the sidebar mod (which carries the CLI) is not installed. Under exec's 30 s: a quick question
   * only (ls); a restart goes through cliRun.
   */
  async cli(args) {
    const argv = await cliArgv(args);
    if (!argv) return null;
    const r = await exec(argv[0], argv.slice(1));
    return cliAnswer(r?.code ?? 1, r?.stdout, r?.stderr);
  }

  /**
   * The bot CLI with --json in an hc terminal of its own (#433), followed to its end: what cli()
   * resolves, so outside exec's limit, or null when the sidebar mod is not installed. `label`: the
   * bot's id, on the terminal; one still running for it refuses a second. `followMs`: how long the
   * panel follows it. Throws a RunError when there is no answer: not started (nothing ran), its
   * terminal gone or ended with none (`partway`: it may have stopped part-way), or still running.
   */
  async cliRun(args, { env = [], label, followMs }) {
    if (!(await cliArgv(args))) return null;
    const dir = appHome().replace(/\/+$/, "");
    const mine = ["ls", "--label", `${RUN_LABEL}=${label}`, "--json"];
    const before = await hc(mine);
    if (before?.code !== 0) throw runError("hc can't list the restarts still running, so none was started");
    const going = liveRows(before.stdout)[0];
    if (going) throw runError(`its restart started earlier still runs in ${going.address}, so no second one was started`);
    // Its own names: never a file an earlier run left, even one started in the same millisecond.
    const base = `${dir}/${RUNS}/${slug(label)}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const files = { out: `${base}.out`, err: `${base}.err`, code: `${base}.code` };
    const herdr = await this.prepare(`${dir}/${RUNS}`);
    const argv = await cliArgv(args, [...CLI_ENV.filter((n) => n in herdr).map((n) => `${n}=${herdr[n]}`), ...env],
      CLI_ENV.filter((n) => !(n in herdr)));
    // --rm: hc removes it once it ends; its answer is in the files.
    const r = await hc(["run", "--bg", "--json", "--rm", "--no-parent", "--cwd", dir, "--label", `${RUN_LABEL}=${label}`,
      "--", "sh", "-c", RUN_SCRIPT, "sh", files.out, files.err, files.code, ...argv]);
    if (r?.code !== 0) {
      const said = hcSaid(r);
      throw runError(`hc couldn't start its restart in a terminal of its own${said ? ` (${said})` : ""}; nothing was restarted`);
    }
    let terminal = null;
    try {
      terminal = JSON.parse(r.stdout).address ?? null;
    } catch {}
    // It may run anyway: found by its label.
    if (typeof terminal !== "string" || !terminal) {
      const after = await hc(mine).catch(() => null);
      terminal = after?.code === 0 ? liveRows(after.stdout)[0]?.address ?? null : null;
    }
    if (!terminal) {
      const got = await this.runAnswer(files);
      if (got) return got;
      throw runError("hc started its restart without saying in which terminal, and none was found", { partway: true });
    }
    return this.follow(terminal, files, followMs);
  }

  /**
   * Before a restart, through exec (Herdr's environment): makes the runs folder and reads CLI_ENV as
   * Herdr has them, { NAME: value } for each one set. Throws when either fails: nothing ran.
   */
  async prepare(folder) {
    let r;
    try {
      r = await exec("sh", ["-c", PREPARE_SCRIPT, "sh", folder, ...CLI_ENV]);
    } catch (err) {
      r = { code: null, stderr: message(err) };
    }
    if (r?.code === 3) throw runError(`couldn't make ${folder} for its answer, so no restart was started`);
    if (r?.code !== 0) throw runError("couldn't read this app's environment for it, so no restart was started");
    const vars = {};
    for (const line of String(r.stdout ?? "").split("\n")) {
      const at = line.indexOf("=");
      const name = line.slice(0, at);
      if (at > 0 && CLI_ENV.includes(name) && !(name in vars) && line.slice(at + 1)) vars[name] = line.slice(at + 1);
    }
    return vars;
  }

  /** The CLI's answer a restart's terminal left (cli()'s shape), or null while its exit code isn't written. */
  async runAnswer(files) {
    const read = (path) => readTextFile(path).catch(() => null);
    const code = await read(files.code);
    if (code === null || code === undefined) return null;
    const n = Number.parseInt(String(code).trim(), 10);
    return cliAnswer(Number.isSafeInteger(n) ? n : 1, await read(files.out), await read(files.err));
  }

  /**
   * Follows a restart's terminal until its answer is written (see RUN_WAIT_S). Its terminal gone or
   * ended with no answer, or still running after `followMs`: a RunError, never a silent end.
   */
  async follow(terminal, files, followMs) {
    const started = Date.now();
    let quick = false;
    for (;;) {
      const got = await this.runAnswer(files);
      if (got) return got;
      if (quick) await this.pause(RUN_PAUSE_MS);
      let pane;
      let unread = false;
      try {
        pane = await this.paneGet(terminal);
      } catch {
        unread = true;
      }
      if (pane === null || (pane && pane.state && pane.state !== "live")) {
        // The answer may land just before the terminal ends.
        const late = await this.runAnswer(files);
        if (late) return late;
        throw runError(pane === null ? `its restart's terminal ${terminal} is gone, with no answer from it`
          : `its restart in ${terminal} ended with no answer`, { partway: true });
      }
      // Wall time, not waits: a wait that answers at once is followed by a pause, never counted.
      if (Date.now() - started >= followMs) {
        throw runError(`its restart ${unread ? `may still run in ${terminal} (hc can't say how it is)` : `still runs in ${terminal}`} after `
          + `${waited(Date.now() - started)}; the panel stopped following it, so how it ends isn't shown here. Check whether the bot is back once ${terminal} is gone`);
      }
      const asked = Date.now();
      try {
        await exec("hc", ["wait", terminal, "--timeout", String(RUN_WAIT_S), "--json"], { timeout: RUN_WAIT_EXEC_MS });
      } catch {}
      quick = Date.now() - asked < 1000;
    }
  }

  /** A pause between looks at a restart's terminal (a test replaces it). */
  pause(ms) {
    return new Promise((go) => setTimeout(go, ms));
  }

  /** After a switch: the bots of that tool that started before it, by `automagik-herdr ls`. */
  findBots(provider, cx) {
    const s = this.switched[provider];
    cx.spawn(async (cx) => {
      try {
        const r = await this.cli(["ls", "--all"]);
        if (this.switched[provider] !== s) return;
        if (!r) s.look = "no-cli";
        else if (r.code !== 0 || !r.out) s.look = { error: refusal(r) || `automagik-herdr ls failed (exit ${r.code})` };
        else s.look = staleBots(r.out, provider, s.at);
      } catch (err) {
        if (this.switched[provider] === s) s.look = { error: message(err) };
      }
      wake(cx);
    });
  }

  /**
   * Restart N bots: the first click arms it, a second within five seconds runs each restart. Not
   * while a switch runs (the bots would restart onto a login that is still being written). After a
   * run only the bots that failed stay listed, so pressing again retries those alone.
   */
  restartBots(provider, cx) {
    const s = this.switched[provider];
    const bots = s?.look?.bots ?? [];
    if (!bots.length || s.restarting) return;
    if (this.busy) {
      this.armed = null;
      this.switchError = "a switch is running: restart the bots once it is done";
      wake(cx);
      return;
    }
    const key = `restart:${provider}`;
    if (this.armed !== key) {
      this.armed = key;
      cx.timer.after(ARMED, (cx) => {
        if (this.armed === key) {
          this.armed = null;
          wake(cx);
        }
      });
      wake(cx);
      return;
    }
    this.armed = null;
    s.restarting = true;
    // lock.claim refuses this provider's switch until its restarts are done; the other's is free.
    this.restarting = { ...this.restarting, [provider]: true };
    s.result = null;
    s.waiting = {}; // this run replaces any wait still going
    cx.spawn(async (cx) => {
      wake(cx);
      const failed = [];
      const left = [];
      // The ones that restarted on a new conversation, and why (#328: no session id known and a
      // teammate on that agent in the folder; #413: codex can't resume the thread): the CLI's note.
      const fresh = [];
      // The ones refused as busy (#413): { bot, why, refused, terminal }, each with Restart when idle.
      const busy = [];
      let done = (s.done ?? 0);
      // One at a time: each restart waits for the new pane's agent to stay up.
      for (const bot of bots) {
        const one = await this.restartOne(bot);
        if (one.note) fresh.push(`${bot.name}: ${noteText(one.note)}`);
        if (one.busy) busy.push(one.busy);
        else if (one.why !== null) failed.push(`${bot.name}: ${one.why}`);
        if (one.why === null) done += 1;
        else left.push(bot);
      }
      s.restarting = false;
      delete this.restarting[provider];
      s.done = done;
      s.result = { done, failed, fresh, busy, helpers: [] };
      // Only the ones that failed are left to restart.
      s.look = { bots: left, reliable: left.length ? s.look.reliable : true };
      // A bot held only by its helpers needs no second press (the owner's rule): the panel sees to it,
      // one bot at a time, outside the restart lock, so a Cancel and a switch stay open meanwhile.
      const held = busy.filter((b) => b.refused === "helpers");
      for (const b of held) s.waiting[b.bot.id] = {};
      wake(cx);
      for (const b of held) await this.whenReady(provider, s, b, cx);
    });
  }

  /**
   * One bot's restart through the CLI: { why: null | the reason it wasn't, note: a fresh start's
   * note or null, busy: { bot, why, refused, terminal } when the CLI refused it as busy (its
   * --json `refused`: "working", or "helpers" that would end with its pane), helpers: the lines of
   * helpers `tree` didn't run again }. `tree`: its helpers restart with it. Such a restart exits 1
   * when a helper wasn't run again, though the bot did restart: its new `terminal` with no `error`
   * says so. A refusal can carry a `terminal` too (a new pane that exited, a turn started again).
   */
  async restartOne(bot, { tree = false, helpers: count = 0 } = {}) {
    try {
      const args = ["restart", bot.id, "--project", bot.project, ...(tree ? ["--tree"] : [])];
      // In a terminal of its own (#433): a restart waits up to 30 s for its new pane, twice when
      // codex can't resume (#413), and a --tree one 40 s more per helper, past exec's limit.
      const r = await this.cliRun(args, { label: bot.id, followMs: RUN_FOLLOW_MS + (tree ? count * RUN_HELPER_MS : 0),
        env: tree ? [`AUTOMAGIK_HERDR_TREE_TURN_WAIT_MS=${TREE_TURN_WAIT_MS}`] : [] });
      const helpers = (Array.isArray(r?.out?.helpers) ? r.out.helpers : []).filter((h) => h?.error)
        .map((h) => `${bot.name}'s helper ${h.name ?? h.replaced}: ${plain(h.error)}`);
      if (r?.code === 0 || (tree && typeof r?.out?.terminal === "string" && r.out.error === undefined)) {
        return { why: null, note: r.out?.mode === "fresh" && typeof r.out.note === "string" && r.out.note ? r.out.note : null, busy: null, helpers };
      }
      const why = refusal(r) || `exit ${r?.code ?? "?"}`;
      const refused = r?.out?.refused;
      const busy = (refused === "working" || refused === "helpers") && typeof r.out.terminal === "string"
        ? { bot, why, refused, terminal: r.out.terminal } : null;
      return { why, note: null, busy, helpers };
    } catch (err) {
      // Its terminal ended with no answer: the restart may have stopped part-way.
      const back = tree ? `${bot.name} and its helpers are back` : `${bot.name} is back`;
      const why = err?.partway ? `${message(err)}. It may have stopped part-way: check whether ${back}, then restart what is missing from a terminal, not from here` : message(err);
      return { why, note: null, busy: null, helpers: [] };
    }
  }

  /**
   * Restart when idle (#413): the button for a bot mid-turn, and the press that retries one the
   * panel gave up on. A second press cancels: the wait's answer is dropped (hc wait itself ends by
   * its timeout). Kept in this panel only, so a reload of the panel clears it.
   */
  restartWhenIdle(provider, botId, cx) {
    const s = this.switched[provider];
    const entry = s?.result?.busy?.find((b) => b.bot.id === botId);
    if (!entry) return;
    s.waiting ??= {};
    if (s.waiting[botId]) {
      delete s.waiting[botId];
      entry.why = "canceled; nothing was restarted";
      wake(cx);
      return;
    }
    s.waiting[botId] = {};
    cx.spawn(async (cx) => {
      wake(cx);
      await this.whenReady(provider, s, entry, cx);
    });
  }

  /**
   * Waits for a busy bot, then restarts it once. Each look re-reads hc: the bot's pane and every
   * helper that would end with it. Its pane done, idle or in error and its helpers done or idle:
   * one restart, with its helpers if it has any. Something working: one wait, on that pane only,
   * then look again, within the bounds above. Anything else (a question waiting, gone, unreadable,
   * a helper in error): no restart, and the bot stays listed with why. A look is what decides, not
   * how a wait ended: Herdr may cut a wait, and the pane may be finished by then.
   */
  async whenReady(provider, s, entry, cx) {
    const id = entry.bot.id;
    const token = s.waiting?.[id];
    if (!token) return;
    const live = () => this.switched[provider] === s && s.waiting?.[id] === token;
    const stop = (why, next = "") => {
      delete s.waiting[id];
      entry.why = `${why}; nothing was restarted${next}`;
      wake(cx);
    };
    const started = Date.now();
    let waits = 0;
    let most = null;
    let helpers = 0;
    for (;;) {
      const now = await this.lookAt(entry.terminal);
      if (!live()) return;
      if (now.stop) return stop(now.stop);
      helpers = now.helpers;
      if (!now.working.length) break;
      most ??= IDLE_WAITS + now.helpers;
      if (waits >= most || Date.now() - started >= IDLE_WAITS * IDLE_WAIT_S * 1000) {
        return stop(`${now.working.join(", ")} still working after ${waited(Date.now() - started)} of waiting`);
      }
      waits += 1;
      entry.why = `waiting for ${now.working.join(", ")} to finish`;
      wake(cx);
      try {
        await exec("hc", ["wait", now.working[0], "--timeout", String(IDLE_WAIT_S), "--json"], { timeout: IDLE_EXEC_MS });
      } catch {}
      if (!live()) return;
    }
    // A switch or another restart running now: this one does not wait for it.
    if (this.busy || s.restarting) {
      delete s.waiting[id];
      entry.why = `${entry.bot.name} is ready, but ${this.busy ? "a switch" : "a restart"} was running; nothing was restarted`;
      wake(cx);
      return;
    }
    s.restarting = true;
    this.restarting = { ...this.restarting, [provider]: true };
    wake(cx);
    const one = await this.restartOne(entry.bot, { tree: helpers > 0, helpers });
    s.restarting = false;
    delete this.restarting[provider];
    delete s.waiting[id];
    const r = s.result;
    r.busy = r.busy.filter((b) => b.bot.id !== id);
    if (one.note) r.fresh = [...r.fresh, `${entry.bot.name}: ${noteText(one.note)}`];
    r.helpers = [...r.helpers, ...one.helpers];
    if (one.busy) r.busy = [...r.busy, one.busy];
    else if (one.why !== null) r.failed = [...r.failed, `${entry.bot.name}: ${one.why}`];
    if (one.why === null) {
      r.done += 1;
      s.done = r.done;
      const left = (s.look?.bots ?? []).filter((b) => b.id !== id);
      s.look = { bots: left, reliable: left.length ? s.look.reliable : true };
    }
    wake(cx);
  }

  /**
   * `hc get` of `terminal`, or null when hc says there is no such pane (exit 3, not_found). Any other
   * failure throws: a pane hc can't read may still be running, so it is never taken for gone.
   */
  async paneGet(terminal) {
    const r = await hc(["get", terminal, "--json"]);
    if (r?.code === 0) return JSON.parse(r.stdout);
    if (r?.code === 3 || /not_found/.test(r?.stderr ?? "")) return null;
    throw new Error(`hc get ${terminal} failed`);
  }

  /** `hc get` of each of `rows`: { lost: the first address hc can't read, or null, gets }. */
  async paneGets(rows) {
    const reads = await Promise.all(rows.map((r) => this.paneGet(r.address).then((get) => ({ get }), () => ({ lost: r.address }))));
    return { lost: reads.find((x) => x.lost)?.lost ?? null, gets: reads.map((x) => x.get) };
  }

  /**
   * How a bot's pane and the helpers that would end with it stand now: { stop: why nothing may
   * restart, or null, working: the panes working, helpers: how many there are }.
   */
  async lookAt(terminal) {
    const none = (stop) => ({ stop, working: [], helpers: 0 });
    try {
      const pane = await this.paneGet(terminal);
      if (!pane || (pane.state && pane.state !== "live")) return none(`its pane ${terminal} is gone`);
      const state = pane.status?.state;
      if (typeof state !== "string") return none(`hc can't say how ${terminal} is`);
      if (state === "blocked") return none(`its pane ${terminal} is waiting for an answer`);
      const ls = await hc(["ls", "--json"]);
      if (ls?.code !== 0) return none(`hc can't list ${terminal}'s helpers`);
      const rows = JSON.parse(ls.stdout);
      const list = Array.isArray(rows) ? rows : rows?.terminals ?? [];
      const kids = list.filter((r) => r?.parent === terminal && r.state !== "finished" && r.address);
      const { lost, gets } = await this.paneGets(kids);
      if (lost) return none(`hc can't say how its helper ${lost} is`);
      // A member bot outlives the pane, and one gone by now has nothing left to end.
      const helpers = gets.filter((g) => g?.state === "live" && g.die_with_parent !== false);
      const working = state === "working" ? [terminal] : [];
      for (const h of helpers) {
        // A restart runs a bot's helpers again, not theirs: those would end and stay ended.
        const under = list.filter((r) => r?.parent === h.address && r.state !== "finished" && r.address);
        const nested = await this.paneGets(under);
        if (nested.lost) return none(`hc can't say how its helper ${nested.lost} is`);
        if (nested.gets.some((g) => g?.state === "live" && g.die_with_parent !== false)) {
          return none(`its helper ${h.address} has helpers of its own, which a restart wouldn't bring back`);
        }
        const st = h.status?.state;
        if (st === "working") working.push(h.address);
        else if (st === "blocked") return none(`its helper ${h.address} is waiting for an answer`);
        // No status: a plain program, or an agent that may be mid-turn. Only the CLI knows which, and
        // its last check refuses the agent.
        else if (typeof st === "string" && st !== "idle" && st !== "done") return none(`its helper ${h.address} is in ${st}`);
      }
      return { stop: null, working, helpers: helpers.length };
    } catch {
      return none(`hc can't say how ${terminal} is`);
    }
  }

  // ---- drawing ----

  tone(t, name) {
    return name === "good" ? t.done : name === "warn" ? t.working : t.dim;
  }

  button(t, id, label, onClick, { primary = false, small = null } = {}) {
    const el = v_flex().id(id).justify_center().cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick)
      .bg(primary ? t.accent : t.raised).text_color(primary ? t.accent_foreground : t.foreground)
      .text_size(primary ? 12.5 : 11).child(div().font_semibold().child(label));
    if (primary) el.px(12).py(7).rounded(8);
    else el.flex_none().px(8).h(22).rounded(6);
    if (small) el.child(div().text_size(10.5).opacity(0.85).child(small));
    return el;
  }

  bar(t, usage) {
    const fill = div().h_full().bg(usage.hot ? t.working : t.done).w(`${usage.used ?? 0}%`);
    return h_flex().h(5).w_full().rounded(3).bg(t.raised).overflow_hidden().child(fill);
  }

  meta(t, usage) {
    const line = h_flex().gap(8).text_size(10.5).text_color(t.dim).child(div().child(usage.text));
    if (usage.reset) line.child(div().flex_1().min_w(0)).child(div().child(usage.reset));
    for (const f of usage.flags) line.child(div().text_color(t.working).child(f));
    return line;
  }

  pill(t, pill) {
    return div().px(6).h(16).flex().items_center().rounded(8).bg(t.raised).text_size(10)
      .text_color(this.tone(t, pill.tone)).child(pill.text);
  }

  segment(t) {
    const seg = h_flex().mx(14).mt(10).p(3).gap(4).rounded(9).bg(t.chrome ?? t.raised);
    for (const provider of Object.keys(TOOLS)) {
      const on = provider === this.tool;
      const dot = this.accounts ? this.view(provider).dot : "none";
      seg.child(h_flex().id(`tool-${provider}`).flex_1().h(28).gap(6).items_center().justify_center()
        .rounded(7).cursor_pointer().bg(on ? t.raised : t.background ?? t.raised)
        .text_color(on ? t.foreground : t.muted).text_size(12.5).font_semibold()
        .on_click((_e, cx) => {
          this.tool = provider;
          this.armed = null;
          wake(cx);
        })
        .child(div().size(7).rounded_full().bg(this.tone(t, dot)))
        .child(TOOLS[provider]));
    }
    return seg;
  }

  banner(t, provider) {
    const s = this.switched[provider];
    const label = TOOLS[provider];
    const box = v_flex().id(`switched-${provider}`).mx(14).p(10).gap(6).rounded(9).bg(t.selected ?? t.raised)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).font_semibold().text_size(12.5).child(`${label} is now on ${s.to}`))
        .child(div().id(`switched-close-${provider}`).px(4).rounded(5).text_color(t.dim).cursor_pointer()
          .hover((x) => x.text_color(t.foreground)).on_click((_e, cx) => {
            delete this.switched[provider];
            this.armed = null;
            wake(cx);
          }).child("×")));
    const hint = (text) => box.child(div().text_size(11).text_color(t.dim).child(text));
    const look = s.look;
    if (look === "loading") hint("New bots start on it. Looking for bots still on the old account…");
    else if (look === "no-cli") hint(`New bots start on it. Bots already running keep the old account until restarted: automagik-herdr restart <bot>.`);
    else if (look?.error) hint(`New bots start on it. The panel couldn't list the bots (${look.error}); restart the ones that use ${label} to move them.`);
    else if (!look.bots.length) hint(s.result ? `Restarted ${s.result.done}: every ${label} bot is on the new account.` : `New bots start on it. No running ${label} bot started before the switch.`);
    else {
      const n = look.bots.length;
      hint(look.reliable
        ? `New bots start on it. ${n === 1 ? "This one started earlier and still uses" : `These ${n} started earlier and still use`} ${s.from ?? "the old login"}:`
        : `New bots start on it. The panel can't tell which of these ${n} ${label} bots started before the switch, so it lists them all:`);
      const chips = h_flex().gap(4).flex_wrap();
      const shown = look.bots.slice(0, 6);
      for (const b of shown) chips.child(div().px(6).h(18).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).child(b.name));
      if (n > shown.length) chips.child(div().px(6).h(18).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).child(`+${n - shown.length}`));
      box.child(chips);
      const armed = this.armed === `restart:${provider}`;
      const what = `Restart ${n} bot${n === 1 ? "" : "s"}`;
      box.child(this.button(t, `restart-${provider}`, s.restarting ? "Restarting…" : armed ? `${what}? Press again to confirm` : what,
        (_e, cx) => this.restartBots(provider, cx), { primary: true, small: "Each one resumes its conversation on the new account where it can" }));
      const busy = s.result?.busy ?? [];
      if (s.result?.failed.length || busy.length) {
        hint(`Restarted ${s.result.done} of ${s.result.done + s.result.failed.length + busy.length}. Not restarted:`);
        for (const f of s.result.failed) box.child(div().text_size(10.5).text_color(t.working).child(f));
        // Busy (#413): its refusal as the CLI words it, and Restart when idle (pressed: Cancel).
        for (const b of busy) {
          const waiting = Boolean(s.waiting?.[b.bot.id]);
          box.child(div().text_size(10.5).text_color(t.working).child(`${b.bot.name} is busy: ${b.why}`));
          box.child(this.button(t, `idle-${provider}-${b.bot.id}`,
            waiting ? `Waiting for ${b.bot.name} · Cancel` : `Restart ${b.bot.name} when idle`,
            (_e, cx) => this.restartWhenIdle(provider, b.bot.id, cx)));
        }
      }
    }
    if (s.result?.helpers?.length) {
      hint("Restarted, but a helper wasn't run again:");
      for (const f of s.result.helpers) box.child(div().text_size(10.5).text_color(t.working).child(f));
    }
    if (s.result?.fresh?.length) {
      hint("Started on a new conversation instead of resuming it:");
      for (const f of s.result.fresh) box.child(div().text_size(10.5).text_color(t.working).child(f));
    }
    if (provider === "claude") {
      box.child(div().text_size(10.5).text_color(t.dim).child(`This Mac now shares that sign-in with ${instanceName(this.config)}: if one side refreshes it, the other may have to sign in again.`));
    }
    return box;
  }

  card(t, v) {
    const now = v_flex().mx(14).p(10).gap(6).rounded(9).bg(t.raised).border_l(3)
      .border_color(v.state === "low" ? t.working : v.state === "new" ? t.border : t.done)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12.5).child(v.headline))
        .child(this.pill(t, v.pill)));
    if (v.current && v.usage?.tracked) now.child(this.bar(t, v.usage)).child(this.meta(t, v.usage));
    now.child(div().text_size(12).text_color(this.tone(t, v.sentence.tone)).child(v.sentence.text));
    if (v.primary) {
      const target = v.primary.account;
      now.child(this.button(t, `primary-${v.provider}`, v.primary.label, (_e, cx) => this.use(v.provider, target, cx),
        { primary: true, small: v.primary.why }));
    }
    if (v.fine) now.child(div().text_size(10.5).text_color(t.dim).child(v.fine));
    return now;
  }

  row(t, v, r) {
    const line = h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(r.who));
    if (r.next) line.child(div().px(5).h(15).flex().items_center().rounded(4).bg(t.raised).text_size(9.5).text_color(t.accent).child("next"));
    if (r.switchable) {
      line.child(this.button(t, `use-${slug(r.account.id)}`, v.state === "new" ? "Use" : "Switch",
        (_e, cx) => this.use(v.provider, r.account, cx)));
    }
    const el = v_flex().id(`acct-${slug(r.account.id)}`).px(8).py(6).gap(4).rounded(7).hover((s) => s.bg(t.hover)).child(line);
    if (r.usage.tracked) el.child(this.bar(t, r.usage));
    return el.child(this.meta(t, r.usage));
  }

  setupText() {
    return this.setup === "proxy"
      ? "This panel lists the Claude Code and Codex accounts on your own CLIProxyAPI and moves this Mac between them. Point it at yours in cliproxy.json in the Herdr app folder (see the mod's RECIPE)."
      : `No management key for your CLIProxyAPI: set $${KEY_ENV} or put it in ${KEY_FILE}.`;
  }

  render() {
    const t = theme();
    this.seen = Date.now();
    const source = instanceName(this.config);
    const root = v_flex().id("am-quota").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => {
        const shown = size.width > 0 && size.height > 0;
        const was = this.hidden;
        this.hidden = !shown;
        // Shown again: the panel may be an hour old. Deferred, because this runs in the layout
        // pass — the read belongs on the foreground executor.
        if (was && shown) cx.timer.after(0, (cx) => this.reload(cx));
      });
    root.child(h_flex().flex_none().px(14).pt(12).gap(8).items_start()
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().font_semibold().child("Accounts"))
        .child(div().text_size(11).text_color(t.dim).child("Keeps your bots working when a plan hits its limit")))
      .child(div().id("am-refresh").px(4).rounded(5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.reload(cx)).child("↻")));
    root.child(this.segment(t));

    const lines = v_flex().px(14).pt(8).gap(4).text_size(11.5);
    if (this.busy) lines.child(div().text_color(t.dim).child(this.busy));
    if (this.switchError) lines.child(div().text_color(t.blocked).child(this.switchError));
    if (this.error) lines.child(div().text_color(t.blocked).child(this.error));
    if (this.quotaError && this.accounts) {
      lines.child(div().text_color(t.working).child(`${source} didn't send usage (${this.quotaError}), so no account's use is known right now`));
    }
    root.child(lines);

    const body = v_flex().flex_1().min_h(0).overflow_y_scrollbar().pt(6).pb(10).gap(10);
    if (this.setup) body.child(div().mx(14).text_size(12).text_color(t.dim).child(this.setupText()));
    else if (!this.accounts) body.child(div().mx(14).text_size(12).text_color(t.dim).child(this.error ? "" : `Reading ${source}…`));
    else {
      const v = this.view(this.tool);
      if (this.switched[this.tool]) body.child(this.banner(t, this.tool));
      body.child(this.card(t, v));
      const list = v_flex().mx(6).gap(2);
      list.child(div().px(8).pt(2).text_size(10.5).text_color(t.dim)
        .child(`${v.state === "new" ? "" : "Other "}${v.label} accounts on ${source}`));
      if (!v.others.length) list.child(div().px(8).text_size(11).text_color(t.dim).child("None."));
      for (const r of v.others) list.child(this.row(t, v, r));
      body.child(list);
    }
    root.child(body);

    const url = openUrl(this.config);
    const foot = h_flex().flex_none().px(14).py(10).gap(10).items_center().border_t(1).border_color(t.border)
      .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim)
        .child(`Accounts come from your CLIProxyAPI${this.config ? `, ${source}` : ""}. To add one, sign in to it there.`));
    if (url) {
      foot.child(this.button(t, "am-open-proxy", `Open ${source}`, () => {
        exec(platform() === "macos" ? "open" : "xdg-open", [url]).catch(() => {});
      }));
    }
    root.child(foot);
    return root;
  }
}
