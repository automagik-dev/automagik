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
// "Restart when idle" (#413): one hc wait at a time, each at most IDLE_WAIT_S (hc's own --timeout),
// run through exec with IDLE_EXEC_MS, below Herdr's 10 min exec cap (hc() itself stops at 30 s);
// at most IDLE_WAITS of them, IDLE_TOTAL_MIN in all (on a Herdr that cuts every exec at 30 s,
// four short ones). Then one restart, only when the pane is live and not working.
const IDLE_WAIT_S = 450;
const IDLE_EXEC_MS = 480_000;
const IDLE_WAITS = 4;
const IDLE_TOTAL_MIN = 30;
// One bot's restart through exec: room for the CLI's own waits (a new pane's 30 s, twice).
const RESTART_EXEC_MS = 300_000;
/** The bot CLI, run the way the sidebar runs it (am-sidebar/launch.js runCli). */
const SIDEBAR = "am-sidebar";

const expand = (p) => (p.startsWith("~/") ? `${home()}${p.slice(1)}` : p);
const slug = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
const wake = (context) => context.notify();
const message = (err) => String(err?.message ?? err);
/**
 * Why a bot CLI run failed, as cli() gives it (#413): the --json \`error\` when it printed one (a
 * restart whose new pane exited names its agent's own last line there), else stderr's last line.
 * The refusal is the CLI's last word: warnings come before it, so never its first line.
 */
const refusal = (r) => (typeof r?.out?.error === "string" && r.out.error.trim()
  ? r.out.error.trim() : String(r?.err ?? "").split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "");
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
   * The bot CLI with --json, as the sidebar runs it: { code, out, err }, or null when the sidebar
   * mod (which carries the CLI) is not installed. `timeout` (ms): exec's limit, which ends the
   * CLI when passed (30 s unless given, Herdr's cap 10 min).
   */
  async cli(args, { timeout } = {}) {
    const dir = appHome().replace(/\/+$/, "");
    const runner = `${dir}/mods/${SIDEBAR}/bin/run.sh`;
    const there = await readTextFile(runner).then((t) => t !== null, () => false);
    if (!there) return null;
    const r = await exec("env", [`HERDR_APP_HOME=${dir}`, "sh", runner, `${dir}/mods/${SIDEBAR}/bin/automagik-herdr.mjs`, ...args, "--json"],
      ...(timeout ? [{ timeout }] : []));
    let out = null;
    try {
      out = JSON.parse(r?.stdout ?? "");
    } catch {}
    return { code: r?.code ?? 1, out, err: String(r?.stderr ?? "").replace(/^automagik-herdr: /gm, "").trim() };
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
        if (one.note) fresh.push(`${bot.name}: ${one.note}`);
        if (one.busy) busy.push(one.busy);
        else if (one.why !== null) failed.push(`${bot.name}: ${one.why}`);
        if (one.why === null) done += 1;
        else left.push(bot);
      }
      s.restarting = false;
      delete this.restarting[provider];
      s.done = done;
      s.waiting = {};
      s.result = { done, failed, fresh, busy };
      // Only the ones that failed are left to restart.
      s.look = { bots: left, reliable: left.length ? s.look.reliable : true };
      wake(cx);
    });
  }

  /**
   * One bot's restart through the CLI: { why: null | the reason it wasn't, note: a fresh start's
   * note or null, busy: { bot, why, refused, terminal } when the CLI refused it as busy (its
   * --json `refused`: "working", or "helpers" that would end with its pane) }.
   */
  async restartOne(bot) {
    try {
      // A restart waits up to 30 s for its new pane, twice when codex can't resume (#413): exec's
      // 30 s default would end the CLI mid-restart.
      const r = await this.cli(["restart", bot.id, "--project", bot.project], { timeout: RESTART_EXEC_MS });
      if (r?.code === 0) return { why: null, note: r.out?.mode === "fresh" && typeof r.out.note === "string" && r.out.note ? r.out.note : null, busy: null };
      const why = refusal(r) || `exit ${r?.code ?? "?"}`;
      const refused = r?.out?.refused;
      const busy = (refused === "working" || refused === "helpers") && typeof r.out.terminal === "string"
        ? { bot, why, refused, terminal: r.out.terminal } : null;
      return { why, note: null, busy };
    } catch (err) {
      return { why: message(err), note: null, busy: null };
    }
  }

  /**
   * Restart when idle (#413): `hc wait` on the busy bot's pane (its turn; with helpers, until
   * none of them works), one at a time, at most IDLE_WAITS (IDLE_TOTAL_MIN in all), then one
   * restart only if the wait ended and `hc get` says the pane is idle. Otherwise no restart: it
   * is listed busy again with why. Refused by the CLI again, it is listed again. A second press cancels: the wait's answer is then dropped (hc wait
   * itself ends by its timeout). Kept in this panel only, so a reload of the panel clears it.
   */
  restartWhenIdle(provider, botId, cx) {
    const s = this.switched[provider];
    const entry = s?.result?.busy?.find((b) => b.bot.id === botId);
    if (!entry) return;
    s.waiting ??= {};
    if (s.waiting[botId]) {
      delete s.waiting[botId];
      wake(cx);
      return;
    }
    const token = {};
    s.waiting[botId] = token;
    const live = () => this.switched[provider] === s && s.waiting?.[botId] === token;
    cx.spawn(async (cx) => {
      wake(cx);
      // One wait at a time; another only while the pane still works, never past IDLE_WAITS.
      let still = null;
      for (let n = 1; ; n += 1) {
        let ended = false;
        try {
          const w = await exec("hc", ["wait", entry.terminal, ...(entry.refused === "helpers" ? ["--children", "all"] : []), "--timeout", String(IDLE_WAIT_S), "--json"],
            { timeout: IDLE_EXEC_MS });
          ended = w?.code === 0;
        } catch {}
        if (!live()) return;
        const state = await this.paneState(entry.terminal);
        if (!live()) return;
        if (ended && state === "idle") break;
        still = state === "working" ? `still working after ${n === IDLE_WAITS ? `the panel's ${IDLE_TOTAL_MIN} min wait` : "the wait"}`
          : state === "gone" ? `its pane ${entry.terminal} is gone` : state === "unknown" ? `hc can't say how ${entry.terminal} is`
          : state === "idle" ? "the wait was cut short" : `its pane is ${state}`;
        if (state !== "working" && state !== "idle") break;
        if (n >= IDLE_WAITS) break;
        still = null;
      }
      if (still !== null) {
        // Not idle: no restart. Listed busy again, with why, and the button to wait again.
        delete s.waiting[botId];
        entry.why = `${still}; nothing was restarted`;
        wake(cx);
        return;
      }
      // A switch or another restart running now: this one waits for no second turn.
      if (this.busy || s.restarting) {
        delete s.waiting[botId];
        this.switchError = `${entry.bot.name}'s turn ended while ${this.busy ? "a switch" : "a restart"} ran: press Restart when idle again`;
        wake(cx);
        return;
      }
      s.restarting = true;
      this.restarting = { ...this.restarting, [provider]: true };
      wake(cx);
      const one = await this.restartOne(entry.bot);
      s.restarting = false;
      delete this.restarting[provider];
      delete s.waiting[botId];
      const r = s.result;
      r.busy = r.busy.filter((b) => b.bot.id !== botId);
      if (one.note) r.fresh = [...r.fresh, `${entry.bot.name}: ${one.note}`];
      if (one.busy) r.busy = [...r.busy, one.busy];
      else if (one.why !== null) r.failed = [...r.failed, `${entry.bot.name}: ${one.why}`];
      if (one.why === null) {
        r.done += 1;
        s.done = r.done;
        const left = (s.look?.bots ?? []).filter((b) => b.id !== botId);
        s.look = { bots: left, reliable: left.length ? s.look.reliable : true };
      }
      wake(cx);
    });
  }

  /** How hc sees `terminal` now: its status ("idle", "working", "blocked", …), "gone" or "unknown". */
  async paneState(terminal) {
    try {
      const r = await hc(["get", terminal, "--json"]);
      if (r?.code !== 0) return "gone";
      const g = JSON.parse(r.stdout);
      if (g?.state && g.state !== "live") return "gone";
      return typeof g?.status?.state === "string" ? g.status.state : "unknown";
    } catch {
      return "unknown";
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
            waiting ? `Waiting for ${b.bot.name} to be idle · Cancel` : `Restart ${b.bot.name} when idle (waits up to ${IDLE_TOTAL_MIN} min)`,
            (_e, cx) => this.restartWhenIdle(provider, b.bot.id, cx)));
        }
      }
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
