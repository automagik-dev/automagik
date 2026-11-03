// am-quota: the sidebar panel and the one thing it changes — which account the local clients use.
//
// Reads: the proxy's own endpoints (via ./proxy.js and ./policy.js, beside this file), the
// management key from cliproxyapi's key file or $CLIPROXY_MGMT_KEY, the base URL from
// <app home>/cliproxy.json, and what this panel installed from <app home>/data/am-quota/active.json.
// Writes: only when the person clicks Use — a credential file (Codex) or the Keychain item plus
// .credentials.json (Claude), through ./switch.js, with a backup, 0600, temp + atomic rename, and
// never a token in a log, a notify, shared state or an error message. Saved Claude logins
// (./saved.js) are kept in their own Keychain items and swapped in through the same path; they
// need no proxy.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, appHome, home, readTextFile, window as appWindow, writeTextFile } from "herdr";
import { client, QuotaSampler } from "./proxy.js";
import { choose, headroom, minutesToReset, bindingWindow } from "./policy.js";
import { credentialTarget, keychainReadScript, keychainService, tokenIdentity, TARGETS } from "./translate.js";
import { install } from "./switch.js";
import { claim, release } from "./lock.js";
import { payloadDir, sweepScript } from "./write.js";
import { forgetSaved, nameProblem, readIndex, resaveActive, restorePrevious, saveLogin, useSaved } from "./saved.js";

const POLL = 60000;
/** How often the installed credential's identity is re-read. It is a token-bearing item; the
 *  badge does not need it sixty times an hour. */
const IDENTITY_EVERY = 300000;
const KEY_FILE = "~/.config/cliproxyapi/mgmt.key";
const KEY_ENV = "CLIPROXY_MGMT_KEY";
const STATE = "am-quota/active.json";

const expand = (p) => (p.startsWith("~/") ? `${home()}${p.slice(1)}` : p);
const slug = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
const wake = (context) => context.notify();
const message = (err) => String(err?.message ?? err);
const minute = (ms) => (ms === null ? "—" : ms <= 0 ? "now" : ms < 60 ? `${Math.round(ms)}m` : ms < 1440 ? `${Math.round(ms / 60)}h` : `${Math.round(ms / 1440)}d`);
/** How long ago an ISO time was, in the panel's short units. */
const ago = (iso) => {
  const at = Date.parse(iso ?? "");
  return Number.isFinite(at) ? `${minute(Math.max(0, (Date.now() - at) / 60000))} ago` : "—";
};
/** How long a destructive button stays armed for its confirming second click. */
const ARMED = 5000;
const RESTART = "restart sessions to use it: automagik-herdr restart <bot> resumes a bot on the new account";
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
 * The badge for the row this panel installed. Its record is only a claim: an open session can
 * refresh the *old* account back into the Keychain, so the claim is checked against the installed
 * credential. A change since the switch is named rather than called "in use"; an unreadable item
 * (no `security`, a locked Keychain) keeps the claim, because a guess is worse than the record.
 */
const badgeFor = (record, installed) => {
  if (!record) return null;
  if (!record.fingerprint || !installed?.known) return { text: "in use", color: "accent" };
  if (!installed.fingerprint) return { text: "no longer installed", color: "blocked" };
  return installed.fingerprint === record.fingerprint
    ? { text: "in use", color: "accent" }
    : { text: "changed outside this panel", color: "dim" };
};

/**
 * `active.json` from before the record carried a fingerprint: a bare name is still a record.
 * `saved` names the saved login (./saved.js) the installed credential belongs to, if any.
 */
const records = (raw) => {
  const out = {};
  for (const [provider, value] of Object.entries(raw ?? {})) {
    if (typeof value === "string") out[provider] = { name: value, fingerprint: null };
    else if (value && typeof value.name === "string") {
      out[provider] = { name: value.name, fingerprint: typeof value.fingerprint === "string" ? value.fingerprint : null };
      if (typeof value.saved === "string" && !nameProblem(value.saved)) out[provider].saved = value.saved;
    }
  }
  return out;
};

export default class AmQuota extends View {
  init(_given, cx) {
    this.rows = null;       // accounts, with the policy's verdict
    this.error = null;      // the proxy read's own error
    this.switchError = null; // a failed switch, kept until the next one
    this.busy = null;       // the running switch, or null
    this.note = null;       // what the last switch did, until the next one
    this.active = {};       // provider → { name, fingerprint } this panel installed
    this.identities = {};   // provider → { at, value }: the last read of what is installed
    this.env = {};          // the clients' environment (CODEX_HOME, CLAUDE_CONFIG_DIR)
    this.quotaError = null;
    this.seen = 0;          // last render; a hidden copy stops polling
    this.hidden = false;
    this.saved = {};        // saved Claude logins: name → { savedAt, plan, email, org }
    this.armed = null;      // "resave:<name>" / "forget:<name>" waiting for its second click
    this.sampler = new QuotaSampler();
    this.nameInput = InputState.new({ placeholder: "save this login as… (a name, Enter saves)" });
    this.nameInput.on("submit", (_e, cx) => this.saveAs(this.nameInput.value(), cx));
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
    let base = null;
    try {
      base = JSON.parse((await readTextFile(`${appHome()}/cliproxy.json`)) ?? "{}")?.url ?? null;
    } catch {}
    let key = env[KEY_ENV] || null;
    if (!key) {
      try {
        key = ((await readTextFile(expand(KEY_FILE))) ?? "").trim() || null;
      } catch {}
    }
    return { base, key, envKnown, env: { CODEX_HOME: env.CODEX_HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR } };
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
      // The clients' environment and the saved logins come first, and need no proxy: a saved
      // login must go to the item a CLAUDE_CONFIG_DIR profile reads even when no proxy is set.
      const { base, key, env } = await this.settings();
      const saved = await readIndex({ appHome: appHome(), readTextFile }).catch(() => ({}));
      if (seq !== this.seq) return;
      this.env = env;
      this.saved = saved;
      try {
        if (!base) {
          this.quiet = true;   // not an error when the saved logins are what this machine uses
          throw new Error("no proxy configured (cliproxy.json) — saved logins still work");
        }
        this.quiet = false;
        if (!key) throw new Error(`no management key: set $${KEY_ENV} or ${KEY_FILE}`);
        const api = client({ base, key, fetch });
        const { accounts, quotaError } = await api.accounts();
        if (seq !== this.seq) return;   // a newer read owns the panel, and the samples
        const sampled = this.sampler.read(accounts, { now: Date.now() });
        const now = Date.now();
        const rows = [];
        for (const provider of ["claude", "codex"]) {
          const record = this.active[provider] ?? null;
          const installed = await this.installedIdentity(provider, env);
          const verdict = choose(sampled, { provider, now, activeId: record?.name ?? null });
          rows.push({ provider, verdict, badge: badgeFor(record, installed), accounts: sampled.filter((a) => a.provider === provider) });
        }
        if (seq !== this.seq) return;
        this.api = api;
        this.rows = rows;
        this.quotaError = quotaError;
        this.error = null;
      } catch (err) {
        if (seq !== this.seq) return;
        this.error = message(err);
        this.rows = null;
      }
      if (seq === this.seq) wake(cx);
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

  // Installs one credential into the client that owns that provider. The flow lives in ./switch.js
  // (tested with its shell and files injected); the panel owns the record, the note and the lock.
  use(provider, account, cx) {
    if (!TARGETS[provider]) return;
    if (!this.api) {
      this.switchError = "no proxy read yet";
      wake(cx);
      return;
    }
    const refused = claim(this, provider, account);   // a second click starts nothing
    if (refused) {
      this.note = null;
      this.switchError = refused;
      wake(cx);
      return;
    }
    this.switchError = null;
    cx.spawn(async (cx) => {   // one switch at a time
      wake(cx);
      try {
        // A saved login in use is about to be replaced: keep its newest refresh token first.
        // Claude's item depends on CLAUDE_CONFIG_DIR: an unknown environment is a refusal.
        if (provider === "claude") await this.knownEnv();
        const kept = provider === "claude" ? this.active.claude?.saved : null;
        if (kept) await resaveActive({ ...this.io(), name: kept });
        const result = await install({ api: this.api, provider, account, ...this.io() });
        this.active[provider] = { name: account.name, fingerprint: result.fingerprint };
        await this.record(provider);
        this.note = `${result.label}: now on ${account.name} — restart new sessions${provider === "claude" ? " (or /restart an open one); its refresh token is now shared with the proxy: whichever side refreshes first can sign the other out" : ""}`;
        this.reload(cx);   // the badge and the verdict follow the credential that is now installed
      } catch (err) {
        this.note = null;
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
   * Writes `active.json` and drops the cached identity, so the badge follows what was written. A
   * failed write is shown, not swallowed: the record says which saved login a later Use re-saves
   * into, and a stale one would point that re-save at the wrong account.
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
      throw new Error(`the login was written, but active.json could not record it (${message(err).slice(0, 80)}) — the panel may name the wrong login in use`);
    }
  }

  /** The clients' environment, or a refusal: an unknown CLAUDE_CONFIG_DIR names an unknown item. */
  async knownEnv() {
    const s = await this.settings();
    if (!s.envKnown) throw new Error("could not read this app's environment (CLAUDE_CONFIG_DIR), so which login Claude uses is unknown; nothing was changed");
    this.env = s.env;
  }

  /**
   * One saved-login write under the switch lock (a save, a re-save, a forget and a switch all read
   * or write the client's item, so none may interleave). `work` answers the note to show.
   */
  savedWrite(cx, busyText, work) {
    this.armed = null;
    const refused = claim(this, "claude", null, busyText);
    if (refused) {
      this.note = null;
      this.switchError = refused;
      wake(cx);
      return;
    }
    this.switchError = null;
    cx.spawn(async (cx) => {
      wake(cx);
      try {
        // The environment is read once and cached; a click before the first read finishes must
        // still see CLAUDE_CONFIG_DIR, or it would act on the default profile's login.
        await this.knownEnv();
        this.note = await work();
        this.saved = await readIndex({ appHome: appHome(), readTextFile }).catch(() => this.saved);
        this.reload(cx);
      } catch (err) {
        this.note = null;
        this.switchError = message(err);
      } finally {
        release(this);
        wake(cx);
      }
    });
  }

  /**
   * "Save this login as <name>" (`replace` false) or Re-save (`replace` true). The login in use
   * then belongs to that saved name; the record keeps a proxy credential's name when the login is
   * still the one the panel installed, so its proxy row keeps its badge.
   */
  saveAs(raw, cx, { replace = false } = {}) {
    const name = String(raw ?? "").trim();
    const problem = nameProblem(name);
    if (problem) {
      this.switchError = problem;
      wake(cx);
      return;
    }
    this.savedWrite(cx, `saving the Claude login as ${name}…`, async () => {
      const out = await saveLogin({ ...this.io(), name, replace });
      const rec = this.active.claude;
      const same = rec?.fingerprint && rec.fingerprint === out.fingerprint;
      this.active.claude = { name: same ? rec.name : `saved:${name}`, fingerprint: out.fingerprint, saved: name };
      await this.record("claude");
      if (!replace) this.nameInput.set_value("");
      return `Claude Code: the login in use is saved as ${name}`;
    });
  }

  /** Use on a saved login: re-save the one in use, then swap this one in. */
  useSavedLogin(name, cx) {
    this.savedWrite(cx, `switching Claude Code to ${name}…`, async () => {
      const out = await useSaved({ ...this.io(), name, current: this.active.claude?.saved ?? null });
      this.active.claude = { name: `saved:${name}`, fingerprint: out.fingerprint, saved: name };
      await this.record("claude");
      return `${out.label}: now on ${name}${out.resaved ? " (the previous login was re-saved)" : ""} — ${RESTART}`;
    });
  }

  /** Puts back the copy the last re-save of `name` replaced (a swap, so it can be undone). */
  restore(name, cx) {
    this.savedWrite(cx, `restoring the previous copy of ${name}…`, async () => {
      await restorePrevious({ ...this.io(), name });
      return `${name}: the previous copy is back (the one it replaced is now the previous); the login in use was not changed`;
    });
  }

  forget(name, cx) {
    this.savedWrite(cx, `forgetting ${name}…`, async () => {
      await forgetSaved({ ...this.io(), name });
      if (this.active.claude?.saved === name) {
        delete this.active.claude.saved;   // the login stays installed; it is just not kept any more
        await this.record("claude");
      }
      return `forgot ${name}; the login in use was not changed`;
    });
  }

  /** A destructive button's first click arms it; a second within ARMED seconds runs it. */
  armedOrArm(key, cx) {
    if (this.armed === key) return true;
    this.armed = key;
    cx.timer.after(ARMED, (cx) => {
      if (this.armed === key) {
        this.armed = null;
        wake(cx);
      }
    });
    wake(cx);
    return false;
  }

  savedRow(t, name, meta) {
    const inUse = this.active.claude?.saved === name;
    const button = (id, text, onClick, strong = false) => div().id(id).px(6).h(18).flex().items_center().rounded(4)
      .text_size(10.5).bg(strong ? t.solid : t.raised).text_color(strong ? t.solid_foreground : t.foreground)
      .cursor_pointer().hover((s) => s.opacity(0.85)).on_click(onClick).child(text);
    const resaveKey = `resave:${name}`;
    const forgetKey = `forget:${name}`;
    const nameLine = h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(name));
    if (inUse) nameLine.child(div().text_size(10).text_color(t.accent).child("in use"));
    else nameLine.child(button(`saved-use-${slug(name)}`, "Use", (_e, cx) => this.useSavedLogin(name, cx)));
    // Re-saving the login in use into its own name is safe; into another name it replaces that
    // account's saved copy, so it asks for a second click.
    nameLine.child(button(`saved-resave-${slug(name)}`, this.armed === resaveKey ? `Replace ${name}?` : "Re-save", (_e, cx) => {
      if (inUse || this.armedOrArm(resaveKey, cx)) this.saveAs(name, cx, { replace: true });
    }, this.armed === resaveKey));
    nameLine.child(button(`saved-forget-${slug(name)}`, this.armed === forgetKey ? "Forget?" : "Forget", (_e, cx) => {
      if (this.armedOrArm(forgetKey, cx)) this.forget(name, cx);
    }, this.armed === forgetKey));
    if (meta.previousAt) {
      nameLine.child(button(`saved-restore-${slug(name)}`, "Restore previous", (_e, cx) => this.restore(name, cx)));
    }
    const who = [meta.email, meta.org].filter(Boolean).join(" · ") || (meta.plan ? `${meta.plan} plan` : "Claude login");
    const facts = h_flex().gap(8).text_size(10.5).text_color(t.dim)
      .child(div().truncate().child(who))
      .child(div().child(`saved ${ago(meta.savedAt)}`));
    const row = v_flex().id(`saved-${slug(name)}`).mx(8).px(8).py(6).gap(3).rounded(7);
    if (inUse) row.bg(t.selected); else row.hover((s) => s.bg(t.hover));
    return row.child(nameLine).child(facts);
  }

  savedBlock(t) {
    const head = h_flex().px(8).pt(6).gap(6).items_center()
      .child(div().text_size(10.5).text_color(t.dim).child("SAVED CLAUDE LOGINS"))
      .child(div().flex_1().min_w(0))
      .child(div().text_size(10.5).text_color(t.dim).child("swap accounts without signing in"));
    const save = h_flex().mx(8).h(26).px(8).items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
      .child(Input.new(this.nameInput).flex_1().h_full().text_size(11.5).text_color(t.foreground));
    const list = v_flex().gap(2);
    for (const name of Object.keys(this.saved).sort()) list.child(this.savedRow(t, name, this.saved[name]));
    return v_flex().gap(4).child(head).child(save).child(list);
  }

  winBar(t, win) {
    const used = Math.round(win?.used_percent ?? 0);
    const left = headroom(win);
    const color = left === null ? t.dim : left <= 0.02 ? t.blocked : left <= 0.25 ? t.working : t.done;
    const fill = div().h_full().bg(color).w(`${Math.min(100, Math.max(0, used))}%`);
    return h_flex().h(5).w_full().rounded(3).bg(t.raised).overflow_hidden().child(fill);
  }

  accountRow(t, provider, a, verdict, badge) {
    const win = bindingWindow(a);
    const active = this.active[provider]?.name === a.name;
    const suggested = verdict.action === "switch" && verdict.to === a.name;
    const facts = h_flex().gap(8).text_size(10.5).text_color(t.dim)
      .child(div().child(`${Math.round(win?.used_percent ?? 0)}% used`))
      .child(div().child(`resets in ${minute(minutesToReset(win, Date.now()))}`));
    if (!a.windows.length) facts.child(div().text_color(t.blocked).child("no window"));
    if (a.requires_sign_in) facts.child(div().text_color(t.blocked).child("sign-in needed"));
    if (a.disabled) facts.child(div().text_color(t.dim).child("disabled"));
    const use = div().id(`use-${slug(a.name)}`).px(6).h(18).flex().items_center().rounded(4).text_size(10.5)
      .bg(suggested ? t.solid : t.raised).text_color(suggested ? t.solid_foreground : t.foreground)
      .cursor_pointer().hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => this.use(provider, a, cx)).child("Use");
    const nameLine = h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(a.name));
    if (active && badge) nameLine.child(div().text_size(10).text_color(t[badge.color]).child(badge.text));
    if (suggested) nameLine.child(div().text_size(10).text_color(t.blocked).child("suggested"));
    nameLine.child(use);
    const row = v_flex().id(`acct-${slug(a.name)}`).mx(8).px(8).py(6).gap(3).rounded(7);
    if (active) row.bg(t.selected); else row.hover((s) => s.bg(t.hover));
    return row.child(nameLine).child(this.winBar(t, win)).child(facts);
  }

  providerBlock(t, group) {
    const v = group.verdict;
    const title = TARGETS[group.provider]?.label ?? group.provider;
    const what = v.action === "switch"
      ? `handoff → ${v.facts.find((f) => f.id === v.to)?.name ?? v.to}`
      : v.action === "keep" ? "keep" : "no advice";
    const head = h_flex().px(8).pt(6).gap(6).items_center()
      .child(div().text_size(10.5).text_color(t.dim).child(String(title).toUpperCase()))
      .child(div().flex_1().min_w(0))
      .child(div().text_size(10.5).truncate().text_color(v.action === "switch" ? t.blocked : t.dim).child(what));
    const list = v_flex().gap(2);
    for (const a of group.accounts) list.child(this.accountRow(t, group.provider, a, v, group.badge));
    return v_flex().gap(4).child(head).child(list);
  }

  render() {
    const tones = theme();
    this.seen = Date.now();
    const status = this.busy ?? this.note
      ?? (this.rows ? "one account per client, switched before it runs dry" : this.error ? "saved logins" : "reading the proxy…");
    const root = v_flex().id("am-quota").size_full().min_h(0).rounded(10).overflow_hidden().bg(tones.background)
      .border_1().border_color(tones.border).text_color(tones.foreground).text_size(13)
      .on_size_change((size, cx) => {
        const shown = size.width > 0 && size.height > 0;
        const was = this.hidden;
        this.hidden = !shown;
        // Shown again: the panel may be an hour old. Deferred, because this runs in the layout
        // pass — the read belongs on the foreground executor.
        if (was && shown) cx.timer.after(0, (cx) => this.reload(cx));
      });
    const head = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(tones.border)
      .child(div().font_semibold().child("Quota"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(tones.dim).child(status))
      .child(div().id("am-refresh").px(4).rounded(5).text_color(tones.dim).cursor_pointer()
        .hover((s) => s.bg(tones.hover).text_color(tones.foreground))
        .on_click((_e, cx) => this.reload(cx)).child("↻"));
    root.child(head);
    if (this.error) root.child(div().px(14).py(8).text_size(12).text_color(this.quiet ? tones.dim : tones.blocked).child(this.error));
    if (this.switchError) root.child(div().px(14).py(8).text_size(12).text_color(tones.blocked).child(this.switchError));
    if (this.quotaError) root.child(div().px(14).py(8).text_size(11).text_color(tones.blocked)
      .child(`no window readings — the quota extension did not answer (${this.quotaError})`));
    const body = v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(10);
    for (const group of this.rows ?? []) body.child(this.providerBlock(tones, group));
    body.child(this.savedBlock(tones));   // with or without a proxy
    root.child(body);
    const foot = v_flex().px(14).py(8).gap(2).text_size(10.5).text_color(tones.dim);
    foot.child(div().child(this.rows
      ? "switching writes this machine's credentials; sessions keep the old account until restarted"
      : "no proxy read yet"));
    if (this.rows) {
      foot.child(div().child("Claude: its refresh token is shared with the proxy — if Anthropic rotates it, the side that refreshes first signs the other out."));
    }
    root.child(foot);
    return root;
  }
}
