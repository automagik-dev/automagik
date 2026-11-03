// The sidebar's update runs (A14), wired to what Herdr gives a mod but taking it all as arguments,
// so `node --test` drives it with a fake exec, fake timers and a Map for the shared values: the
// checks (CHECK_EVERY_MS), the status bar's requests (REQUEST_KEY), an install (asked for, or on
// its own when "Install updates automatically" is on), the setting's switch, and the notice the
// new build posts after Herdr reloads the mods. The plain-data rules are updateCheck.js's.
// Apache-2.0.

import { AUTO_FILE, formatAuto, parseAuto } from "./release.js";
import {
  FIRST_CHECK_MS, LANDING_WAIT_MS, REQUEST_KEY, RELOAD_GRACE_MS, RETRY_MS, SHOWN_KEY, STATE_KEY, announce, applyNotice, applyPatch,
  applyRefusal, autoFailedNotice, autoFailure, autoPlan, busyOf, checkPatch, claim, coolingDown, finish, heldNotice, landedNotice,
  landing, nextCheckIn, noReloadNotice, requestDue, runCheck, shownFrom, stateFrom,
} from "./updateCheck.js";

export class Updater {
  /**
   * `exec(command, args)`: Herdr's exec. `get`/`set`: shared/setShared. `notify`: Herdr's notify.
   * `after(ms, fn)`: a one-shot timer that stops when this build is reloaded (the mod passes its
   * init cx's timer). `spawn(fn)`: runs an async task (cx.spawn). `readText`/`writeText`: Herdr's
   * readTextFile/writeTextFile. `appHome`: the app home. `now`: the clock.
   */
  constructor({ exec, get, set, notify, after, spawn = (fn) => { fn(); }, readText, writeText, appHome, now = Date.now }) {
    Object.assign(this, { exec, get, set, notify, after, spawn, readText, writeText, now });
    this.script = `${appHome}/mods/am-sidebar/update.mjs`;
    this.mods = `${appHome}/mods`;
    this.autoFile = `${appHome}/automagik-herdr/${AUTO_FILE}`;
    this.version = `${appHome}/mods/am-sidebar/VERSION`;
    this.node = null;
    // A request saved before this load was someone else's to answer.
    this.seen = stateFrom(get(REQUEST_KEY)).id ?? null;
  }

  state() { return stateFrom(this.get(STATE_KEY)); }
  patch(fields) { this.set(STATE_KEY, { ...this.state(), ...fields }); }

  /** At load: the first check after FIRST_CHECK_MS, and the notice for an install that just landed. */
  start() {
    this.after(FIRST_CHECK_MS, () => this.check());
    this.spawn(() => this.arrive());
  }

  // One look through `node update.mjs check`, one notice per new version, then the next look
  // scheduled by what it found (`scheduled`; a look the status bar asked for schedules nothing).
  // One look or install at a time across sidebar copies (claim): a timer that finds one running
  // looks again after RETRY_MS. A newer release goes in on its own when autoPlan says so.
  check(scheduled = true, request = null) {
    const started = this.now();
    const id = claim(this.get, this.set, "check", started, request ? { request } : {});
    if (id === null) {
      if (scheduled) this.after(RETRY_MS, () => this.check());
      return;
    }
    this.spawn(async () => {
      let patch = { kind: "retry", why: "the check did not run", at: this.now() };
      try {
        const sleep = (ms) => new Promise((done) => this.after(ms, done));
        const { node, result } = await runCheck(this.exec, this.script, this.node, { mods: this.mods, sleep });
        if (node) this.node = node;
        patch = checkPatch(result, this.now());
      } catch {}
      // The switch flipped while this check ran: its answer is older than the switch.
      const before = this.state();
      if (patch.auto && typeof before.auto?.at === "number" && before.auto.at >= started) patch.auto = before.auto;
      try { finish(this.get, this.set, id, { ...patch, request, autoHeld: null }); } catch {}
      const plan = autoPlan(this.state(), this.now());
      if (plan?.apply && this.apply(null, plan.apply, { auto: true })) {
        // Announced by the install's own notice; SHOWN_KEY keeps a later check quiet about it.
        this.set(SHOWN_KEY, plan.apply);
      } else if (plan?.hold) {
        this.patch({ autoHeld: plan.hold });
        const note = shownFrom(this.get(SHOWN_KEY)) === patch.update.version ? null : heldNotice(plan, patch.update);
        if (note) { this.set(SHOWN_KEY, patch.update.version); try { this.notify(note); } catch {} }
      } else {
        // The version already announced is shared, so a reload or a second view stays quiet.
        try { announce(patch, this.get, this.set, this.notify); } catch {}
      }
      const wait = nextCheckIn(patch.kind);
      if (scheduled && wait !== null) this.after(wait, () => this.check());
    });
  }

  // An install: `node update.mjs apply --expect <to>`, the path `automagik-herdr update` takes
  // (the signed pointer, the checksum, the replaced pack kept for --rollback). `auto`: on its own,
  // with --auto so update.mjs holds it back under its lock when the setting or a rollback says so.
  // Returns false when another check or install holds the claim (nothing runs).
  apply(request, to, { auto = false } = {}) {
    const before = this.state();
    const from = before.current ?? null;
    const id = claim(this.get, this.set, "apply", this.now(), { request, to, from, auto, announce: true });
    if (id === null) return false;
    this.spawn(async () => {
      let patch = { applyError: "the install did not run", at: this.now() };
      try {
        const { node, result } = await runCheck(this.exec, this.script, this.node,
          { mods: this.mods, command: "apply", extra: ["--expect", to, ...(auto ? ["--auto"] : [])] });
        if (node) this.node = node;
        patch = applyPatch(result, before, this.now());
      } catch (e) { patch = { applyError: String(e?.message ?? e), at: this.now() }; }
      if (patch.kind === "installed") {
        const landed = { version: patch.current, from: patch.from, restartBots: patch.restartBots === true, at: this.now() };
        try { finish(this.get, this.set, id, { ...patch, request, autoFailed: null, landed }); } catch {}
        // Herdr reloads the mods as the folders swap, and the new build announces it (arrive).
        // Still here after the grace: no reload happened, so say what to do.
        try { this.after(RELOAD_GRACE_MS, () => this.unreloaded(patch.current)); } catch {}
        return;
      }
      if (auto && patch.applyError) {
        // A failed install on its own: one notice per version, then backoffOf before the next try.
        const failed = autoFailure(this.state(), to, patch.applyError, this.now());
        try { finish(this.get, this.set, id, { ...patch, request, ...failed }); } catch {}
        const note = autoFailedNotice(failed.autoFailed);
        if (note) try { this.notify(note); } catch {}
        return;
      }
      try { finish(this.get, this.set, id, { ...patch, request }); } catch {}
      const note = auto ? null : applyNotice(patch);
      if (note) try { this.notify(note); } catch {}
    });
    return true;
  }

  unreloaded(version) {
    if (this.state().announced === version) return;
    this.patch({ announced: version });
    try { this.notify(noReloadNotice(version)); } catch {}
  }

  // At load: when this build is the release an install just put in, say so once. The old build
  // records whether bots need a restart; wait for that up to LANDING_WAIT_MS, then announce anyway
  // (the old build may have stopped with the reload) and free its claim.
  async arrive(waited = 0) {
    let version = null;
    try { version = (await this.readText(this.version))?.trim() || null; } catch { return; }
    const step = landing(this.state(), version, this.now());
    if (!step) return;
    if (!step.ready && waited < LANDING_WAIT_MS) {
      this.after(1000, () => this.spawn(() => this.arrive(waited + 1000)));
      return;
    }
    const state = this.state();
    if (state.announced === version) return;
    if (!step.ready) {
      finish(this.get, this.set, step.id, { kind: "installed", from: step.from, current: version, latest: version, update: null,
        why: null, applyError: null, at: this.now() });
    }
    this.patch({ announced: version });
    try { this.notify(landedNotice(version, step.from, step.restartBots === true)); } catch {}
  }

  // "Install updates automatically", switched from the status bar: written to the pack's own
  // setting file (update.mjs and the CLI read the same), mirrored in STATE_KEY for the bar.
  async setAuto(on, request) {
    let error = null;
    let auto = null;
    try {
      const text = await this.readText(this.autoFile);
      auto = { ...parseAuto(text ?? ""), on };
      await this.writeText(this.autoFile, formatAuto(auto), text ?? null);
    } catch (e) { error = String(e?.message ?? e); }
    const state = this.state();
    const shown = { ...(state.auto ?? { managed: false, skip: null, why: null }), ...(error ? {} : { on }), at: this.now() };
    this.patch({ auto: shown, request, autoError: error });
  }

  // On the 250 ms timer: a new request from the status bar. A look asked for while one runs is
  // answered by it, and one within a minute of the last by that one (GitHub's hourly limit); an
  // install asked for while one runs is that one, one for a version no longer offered is refused
  // (the bar asks again), and one waits for a running look (fresh for REQUEST_FRESH_MS). The
  // switch is written at once.
  request() {
    const value = this.get(REQUEST_KEY);
    const now = this.now();
    const what = requestDue(value, this.seen, now);
    if (!what) return;
    const { id } = value;
    const state = this.state();
    const busy = busyOf(state, now);
    if (what === "auto") {
      this.seen = id;
      if (typeof value.on === "boolean") this.spawn(() => this.setAuto(value.on, id));
      return;
    }
    if (what === "check") {
      this.seen = id;
      if (busy) return;
      if (coolingDown(state, now)) finish(this.get, this.set, null, { request: id });
      else this.check(false, id);
      return;
    }
    if (busy?.what === "apply") { this.seen = id; return; }
    if (busy) return;
    const refused = applyRefusal(value, state);
    if (refused) {
      this.seen = id;
      finish(this.get, this.set, null, { request: id, applyError: refused });
    } else if (this.apply(id, value.to)) this.seen = id;
  }
}
