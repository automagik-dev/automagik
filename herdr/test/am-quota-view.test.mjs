// am-quota's view model (mods/am-quota/view.js): what each tool's card says, from plain data.
// Example accounts only; no proxy, no Keychain, no file.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceName, openUrl, resetText, staleBots, toolView, usage, who } from "../mods/am-quota/view.js";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const H = 3600000;
const at = (ms) => new Date(ms).toISOString();

/** One proxy account (proxy.js mergeAccounts shape), its binding window `used`% resetting in `resetH`. */
function acct(id, { provider = "codex", email = `${id}@example.com`, plan = "pro", used = 20, resetH = 9,
  win = "primary", prev = null, ...flags } = {}) {
  const a = { id: `${provider}-${id}.json`, name: `${provider}-${id}.json`, provider, email, plan, status: "active",
    windows: used === null ? [] : [{ id: win, used_percent: used, reset_at: at(NOW + resetH * H) }], ...flags };
  if (prev !== null) a.previous = { [win]: { used_percent: prev, at: NOW - H } };
  return a;
}
const rec = (a) => ({ name: a.id, fingerprint: "fp" });
const IN_USE = { text: "in use" };

test("the proxy's name: cliproxy.json's name, else the URL host, else CLIProxyAPI", () => {
  assert.equal(instanceName({ url: "https://proxy.example.com/base", name: " lab " }), "lab");
  assert.equal(instanceName({ url: "https://user:pw@proxy.example.com:8443/x?k=1" }), "proxy.example.com");
  assert.equal(instanceName({ url: "http://127.0.0.1:8317" }), "127.0.0.1");
  assert.equal(instanceName(null), "CLIProxyAPI");
  assert.equal(instanceName({ url: "not a url" }), "CLIProxyAPI");
});

test("Open goes to the base URL without userinfo, query or fragment", () => {
  assert.equal(openUrl({ url: "https://user:pw@proxy.example.com:8443/base/?k=1#x" }), "https://proxy.example.com:8443/base");
  assert.equal(openUrl({ url: "https://proxy.example.com" }), "https://proxy.example.com");
  assert.equal(openUrl({ url: "file:///etc/passwd" }), null);
  assert.equal(openUrl(null), null);
});

test("an account reads as email · plan, never its file name; Claude has no plan to show", () => {
  assert.equal(who(acct("ana")), "ana@example.com · Pro");
  assert.equal(who(acct("bo", { provider: "claude", plan: null })), "bo@example.com");
  assert.ok(!who(acct("x", { email: null })).includes(".json"));
});

test("resets: hours within a day, else the day and time", () => {
  const win = (h) => ({ reset_at: at(NOW + h * H) });
  assert.equal(resetText(win(9), NOW), "resets in 9 h");
  assert.equal(resetText(win(0.5), NOW), "resets in 30 min");
  assert.match(resetText(win(72), NOW), /^resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/);
  assert.equal(resetText({}, NOW), null);
});

test("usage: an account with no window says usage not tracked, with no bar", () => {
  assert.deepEqual(usage(acct("n", { used: null }), NOW), { tracked: false, used: null, hot: false, text: "usage not tracked", reset: null, flags: [] });
  assert.equal(usage(acct("w", { provider: "claude", win: "seven_day" }), NOW, { unit: true }).text, "20% used of this week");
  assert.equal(usage(acct("h", { used: 90 }), NOW).hot, true);
});

test("all good: the account in use lasts until it resets, no button, the rest listed with a next", () => {
  const cur = acct("ana", { used: 30, resetH: 50, prev: 29 });       // 1%/h: 70 h left, resets in 50 h
  const soon = acct("bo", { used: 50, resetH: 5 });
  const late = acct("cy", { used: 10, resetH: 50 });
  const v = toolView({ provider: "codex", accounts: [late, cur, soon], record: rec(cur), badge: IN_USE, now: NOW, source: "lab" });
  assert.equal(v.state, "ok");
  assert.equal(v.dot, "good");
  assert.equal(v.headline, "ana@example.com · Pro");
  assert.deepEqual(v.pill, { text: "In use", tone: "good" });
  assert.deepEqual(v.sentence, { text: "Lasts until it resets", tone: "good" });
  assert.equal(v.primary, null);
  assert.deepEqual(v.others.map((r) => [r.who, r.next]), [["bo@example.com · Pro", true], ["cy@example.com · Pro", false]]);
});

test("running out: the projection in hours, one Switch to <email> with the policy's reason", () => {
  const cur = acct("ana", { used: 92, resetH: 10, prev: 88 });       // 4%/h: 2 h left, resets in 10 h
  const soon = acct("bo", { used: 12, resetH: 6 });
  const late = acct("cy", { used: 10, resetH: 50 });
  const v = toolView({ provider: "codex", accounts: [cur, soon, late], record: rec(cur), badge: IN_USE, now: NOW, source: "lab" });
  assert.equal(v.state, "low");
  assert.equal(v.dot, "warn");
  assert.deepEqual(v.pill, { text: "Running out", tone: "warn" });
  assert.deepEqual(v.sentence, { text: "At this pace it runs out in about 2 h, before it resets", tone: "warn" });
  assert.equal(v.primary.label, "Switch to bo@example.com");
  assert.equal(v.primary.account, soon);
  assert.equal(v.primary.why, "12% used · resets in 6 h · resets soonest, so none of its hours go to waste");
  assert.match(v.fine, /Bots already running stay on ana@example\.com until restarted/);
  assert.ok(!JSON.stringify(v.sentence).includes(".json") && !v.primary.why.includes(".json"), "no file name in what is shown");
});

test("running out with nowhere to go: amber, no button, and it says so", () => {
  const cur = acct("ana", { used: 92, resetH: 10, prev: 88 });
  const full = acct("bo", { used: 100, resetH: 6 });
  const v = toolView({ provider: "codex", accounts: [cur, full], record: rec(cur), badge: IN_USE, now: NOW });
  assert.equal(v.state, "low");
  assert.equal(v.primary, null);
  assert.equal(v.fine, "No other Codex account has room right now.");
});

test("not managed: no record, a change outside the panel, or a record the proxy no longer has", () => {
  const a = acct("ana");
  const b = acct("bo", { resetH: 3 });
  const base = { provider: "codex", accounts: [a, b], now: NOW, source: "lab" };
  const none = toolView({ ...base, record: null });
  assert.equal(none.state, "new");
  assert.equal(none.dot, "none");
  assert.equal(none.headline, "No account from lab");
  assert.deepEqual(none.pill, { text: "Not managed", tone: "none" });
  assert.match(none.sentence.text, /Codex on this Mac uses a login the panel didn't install/);
  assert.equal(none.primary.label, "Use bo@example.com");
  assert.equal(none.others.length, 2, "every account is listed");

  const changed = toolView({ ...base, record: rec(a), badge: { text: "changed outside this panel" } });
  assert.equal(changed.state, "new");
  assert.equal(changed.headline, "Changed outside this panel");
  const gone = toolView({ ...base, record: { name: "codex-removed.json", fingerprint: "fp" }, badge: IN_USE });
  assert.equal(gone.headline, "Not on lab any more");
  const removed = toolView({ ...base, record: rec(a), badge: { text: "no longer installed" } });
  assert.equal(removed.headline, "No login on this Mac");
});

test("Claude, until it lists the logins on this Mac (#453): the proxy's usage, no Use and no Switch, even with a record", () => {
  const a = acct("ana", { provider: "claude", plan: null, win: "seven_day", used: 95 });
  const b = acct("bo", { provider: "claude", plan: null, win: "seven_day", resetH: 3 });
  for (const record of [null, rec(a)]) {
    const v = toolView({ provider: "claude", accounts: [a, b], record, badge: record ? IN_USE : null, now: NOW, source: "lab" });
    assert.equal(v.state, "new");
    assert.equal(v.current, null, "no proxy account is ever Claude's account in use");
    assert.equal(v.primary, null, "no Use or Switch button");
    assert.equal(v.headline, "No switch for now");
    assert.match(v.sentence.text, /keeps the login it has on this Mac/);
    assert.match(v.sentence.text, /no longer installs Claude Code logins from lab/);
    assert.equal(v.others.length, 2, "both listed, for their usage");
    assert.ok(v.others.every((r) => r.switchable === false), "no row offers a switch");
  }
});

test("an account in use with no window, or one that needs a sign-in, says so honestly", () => {
  const cur = acct("ana", { used: null });
  const v = toolView({ provider: "codex", accounts: [cur], record: rec(cur), badge: IN_USE, now: NOW, source: "lab" });
  assert.equal(v.state, "ok");
  assert.equal(v.dot, "none");
  assert.match(v.sentence.text, /lab doesn't track this account's usage/);

  const dead = acct("ana", { requires_sign_in: true });
  const other = acct("bo");
  const w = toolView({ provider: "codex", accounts: [dead, other], record: rec(dead), badge: IN_USE, now: NOW, source: "lab" });
  assert.equal(w.state, "low");
  assert.equal(w.sentence.text, "It can't be used right now: it needs a new sign-in on lab.");
  assert.equal(w.primary.label, "Switch to bo@example.com");
});

test("the first reading has no pace yet: it says it is measuring, not that it lasts", () => {
  const cur = acct("ana", { used: 40 });
  const v = toolView({ provider: "codex", accounts: [cur], record: rec(cur), badge: IN_USE, now: NOW });
  assert.equal(v.state, "ok");
  assert.match(v.sentence.text, /^Measuring its pace/);
});

test("a tool shows only its own accounts", () => {
  const c = acct("ana", { provider: "claude" });
  const x = acct("bo", { provider: "codex" });
  const v = toolView({ provider: "codex", accounts: [c, x], record: null, now: NOW });
  assert.deepEqual(v.others.map((r) => r.account.id), ["codex-bo.json"]);
});

test("rows that cannot be used get no Switch button", () => {
  const cur = acct("ana");
  const off = acct("bo", { disabled: true });
  const v = toolView({ provider: "codex", accounts: [cur, off], record: rec(cur), badge: IN_USE, now: NOW });
  assert.equal(v.others[0].switchable, false);
  assert.deepEqual(v.others[0].usage.flags, ["disabled"]);
});

const LS = (bots) => ({ projects: [{ project: "/work/a", bots }, { project: "/work/bad", error: "unreadable", bots: [] }] });
const bot = (id, agent, since, extra = {}) => ({ id, name: id.toUpperCase(), agent, project: "/work/a", terminal: since === undefined ? null : `t-${id}`,
  status: since === undefined ? "not running" : "idle", since: since ?? null, ...extra });

test("bots still on the old account: running bots of that tool that started before the switch", () => {
  const switchAt = NOW;
  const out = staleBots(LS([
    bot("a", "codex", at(NOW - H)),
    bot("b", "codex", at(NOW + 60000)),     // started after the switch: already on the new account
    bot("c", "claude", at(NOW - H)),        // another tool
    bot("d", "codex"),                      // not running
    bot("e", "codex", at(NOW - 2 * H), { status: "planned" }),
  ]), "codex", switchAt);
  assert.deepEqual(out, { bots: [{ id: "a", name: "A", project: "/work/a" }], reliable: true });
});

test("a running bot with no start time: all of that tool's running bots, and not reliable", () => {
  const out = staleBots(LS([bot("a", "codex", at(NOW - H)), bot("b", "codex", at(NOW + 60000)), bot("c", "codex", "")]), "codex", NOW);
  assert.equal(out.reliable, false);
  assert.deepEqual(out.bots.map((b) => b.id), ["a", "b", "c"]);
  assert.deepEqual(staleBots(null, "codex", NOW), { bots: [], reliable: true });
});

test("the reason is the rule that chose: held accounts skipped, all held, a tie on the reset", () => {
  const cur = acct("ana", { used: 92, resetH: 10, prev: 88 });
  const reason = (others) => toolView({ provider: "codex", accounts: [cur, ...others], record: rec(cur), badge: IN_USE, now: NOW }).primary.why;
  // bo resets in 6 min (held: its fresh window is minutes away), so cy wins though bo is sooner.
  const held = acct("bo", { used: 10, resetH: 0.1 });
  const cy = acct("cy", { used: 30, resetH: 6 });
  assert.match(reason([held, cy]), /resets soonest of the accounts not about to reset$/);
  assert.doesNotMatch(reason([held, cy]), /none of its hours/);
  // Every account with room is about to reset: the soonest of them.
  assert.match(reason([held, acct("dee", { used: 10, resetH: 0.2 })]), /every account with room resets within minutes; this one resets first$/);
  // Two reset together: the one with more room.
  assert.match(reason([acct("ed", { used: 40, resetH: 6 }), acct("flo", { used: 10, resetH: 6 })]), /resets as soon as another, and has more room$/);
  assert.match(reason([cy]), /the only other account with room$/);
  // Same reset and same room: a tie, not "more room".
  assert.match(reason([acct("gus", { used: 20, resetH: 6 }), acct("hal", { used: 20, resetH: 6 })]), /ties with another on its reset and its room$/);
});

test("the dot follows the bar: amber from 85% used even while the account lasts", () => {
  const cur = acct("ana", { used: 86, resetH: 20, prev: 86 });   // flat: it lasts
  const v = toolView({ provider: "codex", accounts: [cur], record: rec(cur), badge: IN_USE, now: NOW });
  assert.equal(v.sentence.text, "Lasts until it resets");
  assert.equal(v.usage.hot, true);
  assert.equal(v.dot, "warn");
  const calm = acct("ana", { used: 84, resetH: 20, prev: 84 });
  assert.equal(toolView({ provider: "codex", accounts: [calm], record: rec(calm), badge: IN_USE, now: NOW }).dot, "good");
});
