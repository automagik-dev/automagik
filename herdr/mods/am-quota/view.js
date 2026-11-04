// am-quota's panel as plain data: for one tool (Claude Code or Codex), the account this Mac uses,
// one sentence on whether it lasts until its window resets, the one switch the policy asks for
// and why, and the tool's other accounts on the proxy. Also the proxy's display name and which
// bots still run on the account a switch replaced.
//
// No `herdr`, no gpui, no network: `node --test` runs it, and main.js only draws what it returns.
// Accounts are shown by email and plan, never by the credential's file name (that stays the id).

import { DEFAULTS, bindingWindow, choose, headroom, minutesToReset } from "./policy.js";

export const TOOLS = Object.freeze({ claude: "Claude Code", codex: "Codex" });
/** What the binding window is a share of, where the window id says it. */
const WINDOW_UNIT = { seven_day: "of this week", five_hour: "of this 5 h window" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** A bar this full is amber whatever the projection says. */
const HOT = 0.15;

// scheme, userinfo (dropped), host[:port], path; query and fragment are dropped. A regex, not
// `URL`: the mod runtime is not Node.
const BASE = /^(https?):\/\/(?:[^@/?#]*@)?(\[[^\]/?#]*\]|[^:/?#]+)(:\d+)?([^?#]*)/i;

/** The proxy's name as the person set it in cliproxy.json, else its URL's host, else generic. */
export function instanceName(config) {
  const given = typeof config?.name === "string" ? config.name.trim() : "";
  if (given) return given.slice(0, 60);
  const m = BASE.exec(String(config?.url ?? "").trim());
  return m ? m[2] : "CLIProxyAPI";
}

/** The page the Open button opens: the base URL without userinfo, query or fragment. */
export function openUrl(config) {
  const m = BASE.exec(String(config?.url ?? "").trim());
  return m ? `${m[1].toLowerCase()}://${m[2]}${m[3] ?? ""}${m[4].replace(/\/+$/, "")}` : null;
}

const plan = (p) => (typeof p === "string" && p ? p[0].toUpperCase() + p.slice(1) : null);
/** "ana@example.com · Pro"; the email alone where the proxy gives no plan (Claude). */
export function who(account) {
  const email = account?.email || "an account with no email";
  const p = plan(account?.plan);
  return p ? `${email} · ${p}` : email;
}

/** A span of minutes as the panel says it: "40 min", "about 3 h", "2 d". */
export function span(min) {
  if (min === null || !Number.isFinite(min)) return null;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

/** "resets in 9 h", or the day and time when it is a day or more away: "resets Thu 09:00". */
export function resetText(win, now) {
  const min = minutesToReset(win, now);
  if (min === null) return null;
  if (min <= 0) return "resets now";
  if (min < 24 * 60) return `resets in ${span(min)}`;
  const at = new Date(now + min * 60000);
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `resets ${DAYS[at.getDay()]} ${hh}:${mm}`;
}

/** One account's line under its name: the bar, "N% used", the reset, and what blocks it. */
export function usage(account, now, { unit = false } = {}) {
  const win = bindingWindow(account);
  const flags = [];
  if (account?.requires_sign_in) flags.push("needs a new sign-in");
  if (account?.disabled) flags.push("disabled");
  if (!win) return { tracked: false, used: null, hot: false, text: "usage not tracked", reset: null, flags };
  const used = Math.round(win.used_percent);
  const suffix = unit && WINDOW_UNIT[win.id] ? ` ${WINDOW_UNIT[win.id]}` : "";
  return {
    tracked: true,
    used: Math.min(100, Math.max(0, used)),
    hot: (headroom(win) ?? 1) <= HOT,
    text: `${used}% used${suffix}`,
    reset: resetText(win, now),
    flags,
  };
}

/** The accounts a switch could go to: policy's own pool (bestCandidate), as its facts. */
const pool = (verdict, activeId) => verdict.facts.filter((f) => f.usable && f.window !== null
  && f.headroom !== null && f.headroom > DEFAULTS.floorHeadroom && f.id !== activeId);

/**
 * Why the policy's pick is the one, in its own terms: its use and reset, then the rule that chose
 * it. bestCandidate puts accounts about to reset (`held`) last, then takes the soonest reset, then
 * the most headroom; the phrase says which of those decided, never "soonest" for a pick that only
 * won because sooner ones were held back.
 */
export function why(pick, verdict, activeId, now) {
  const u = usage(pick, now);
  const all = pool(verdict, activeId);
  const me = all.find((f) => f.id === pick.id);
  const at = (f) => f.minutesToReset ?? Number.POSITIVE_INFINITY;
  let rule;
  if (!me || all.length <= 1) rule = "the only other account with room";
  else if (me.held) rule = "every account with room resets within minutes; this one resets first";
  else {
    const fresh = all.filter((f) => !f.held && f.id !== me.id);
    const skipped = all.some((f) => f.held && at(f) < at(me));
    const tied = fresh.some((f) => at(f) === at(me));
    if (tied) rule = "resets as soon as another, and has more room";
    else if (skipped) rule = "resets soonest of the accounts not about to reset";
    else rule = "resets soonest, so none of its hours go to waste";
  }
  return [u.tracked ? u.text : null, u.reset, rule].filter(Boolean).join(" · ");
}

/**
 * One tool's card. `accounts`: the sampled proxy accounts of this provider (proxy.js shape);
 * `record`: { name } this panel installed, or null; `badge`: main.js's check of that record against
 * the credential on the Mac ("in use", "changed outside this panel", "no longer installed"), or
 * null; `source`: the proxy's display name.
 *
 * Returns { provider, label, state: "ok" | "low" | "new", dot: "good" | "warn" | "none",
 *           current, headline, pill: { text, tone }, sentence: { text, tone }, primary, fine,
 *           others: [{ account, who, usage, next, switchable }] }.
 * `primary` is { account, label, why } when the policy says switch; tones are good | warn | none.
 */
export function toolView({ provider, accounts = [], record = null, badge = null, now = Date.now(), source = "CLIProxyAPI" }) {
  const label = TOOLS[provider] ?? provider;
  const mine = accounts.filter((a) => a.provider === provider)
    .sort((a, b) => who(a).localeCompare(who(b)) || String(a.id).localeCompare(String(b.id)));
  const current = record ? mine.find((a) => a.id === record.name) ?? null : null;
  const managed = Boolean(current) && (!badge || badge.text === "in use");
  const verdict = choose(mine, { provider, now, activeId: managed ? current.id : null });
  const pick = verdict.action === "switch" ? mine.find((a) => a.id === verdict.to) ?? null : null;
  const row = (a, next = false) => ({
    account: a, who: who(a), usage: usage(a, now), next,
    switchable: !a.disabled && !a.requires_sign_in,
  });
  const out = { provider, label, current: managed ? current : null, primary: null, fine: null };

  if (!managed) {
    let headline = `No account from ${source}`;
    let text = `${label} on this Mac uses a login the panel didn't install, so it can't tell how long it lasts.`;
    if (record && badge?.text === "changed outside this panel") {
      headline = "Changed outside this panel";
      text = `${label}'s login on this Mac changed since the panel installed it, so it can't tell which account it is.`;
    } else if (record && badge?.text === "no longer installed") {
      headline = "No login on this Mac";
      text = `${label} has no login on this Mac right now.`;
    } else if (record && !current) {
      headline = `Not on ${source} any more`;
      text = `The account the panel installed for ${label} is no longer on ${source}, so it can't tell how long it lasts.`;
    }
    if (!mine.length) text += ` ${source} has no ${label} account yet.`;
    if (pick) out.primary = { account: pick, label: `Use ${pick.email || "this account"}`, why: why(pick, verdict, null, now) };
    return { ...out, state: "new", dot: "none", headline, pill: { text: "Not managed", tone: "none" },
      sentence: { text, tone: "none" }, others: mine.map((a) => row(a)) };
  }

  const fact = verdict.facts.find((f) => f.id === current.id);
  const others = mine.filter((a) => a !== current);
  const u = usage(current, now, { unit: true });
  out.headline = who(current);
  out.usage = u;
  // The one the rule would move to next, when nothing asks for a move yet.
  const ahead = pick ? null : choose(others, { provider, now, activeId: null });
  const nextId = ahead?.action === "switch" ? ahead.to : null;
  out.others = others.map((a) => row(a, a.id === nextId));
  if (pick) {
    out.primary = { account: pick, label: `Switch to ${pick.email || "the next account"}`, why: why(pick, verdict, current.id, now) };
  }

  if (!fact.usable) {
    const what = current.requires_sign_in ? `it needs a new sign-in on ${source}` : current.disabled ? `it is disabled on ${source}` : `${source} reports it unusable`;
    return { ...out, state: "low", dot: "warn", pill: { text: "Can't be used", tone: "warn" },
      sentence: { text: `It can't be used right now: ${what}.`, tone: "warn" },
      fine: pick ? `Bots already running stay on ${current.email || "it"} until restarted. You get that button next.` : `No other ${label} account has room right now.` };
  }
  if (!u.tracked) {
    return { ...out, state: "ok", dot: "none", pill: { text: "In use", tone: "none" },
      sentence: { text: `${source} doesn't track this account's usage, so the panel can't say how long it lasts.`, tone: "none" } };
  }
  const dry = fact.minutesToDry, reset = fact.minutesToReset;
  const due = dry !== null && reset !== null && dry <= reset + DEFAULTS.marginMinutes;
  if (due) {
    const text = dry <= 0
      ? `It has run out${u.reset ? `; it ${u.reset}` : ""}.`
      : `At this pace it runs out in about ${span(dry)}, before it resets`;
    return { ...out, state: "low", dot: "warn", pill: { text: "Running out", tone: "warn" }, sentence: { text, tone: "warn" },
      fine: pick ? `Bots already running stay on ${current.email || "it"} until restarted. You get that button next.` : `No other ${label} account has room right now.` };
  }
  if (dry === null) {
    return { ...out, state: "ok", dot: u.hot ? "warn" : "good", pill: { text: "In use", tone: "good" },
      sentence: { text: "Measuring its pace; the panel says in a minute whether it lasts", tone: "none" } };
  }
  // The dot follows the bar: amber at 85% used even while the pace says it lasts.
  return { ...out, state: "ok", dot: u.hot ? "warn" : "good", pill: { text: "In use", tone: "good" },
    sentence: { text: "Lasts until it resets", tone: "good" } };
}

const NOT_RUNNING = new Set(["not running", "planned", "hc unavailable"]);

/**
 * The bots still on the account a switch replaced, from `automagik-herdr ls --all --json`.
 * A bot of this tool that started before `at` (its pane's `since`) still has the old login. When
 * any running bot of the tool has no start time, the split can't be trusted: all of them are
 * listed and `reliable` is false. Returns { bots: [{ id, name, project }], reliable }.
 */
export function staleBots(ls, provider, at) {
  const running = [];
  for (const p of ls?.projects ?? []) {
    if (p?.error) continue;
    for (const b of p?.bots ?? []) {
      if (b?.agent !== provider || !b.terminal || NOT_RUNNING.has(b.status)) continue;
      running.push({ id: b.id, name: b.name ?? b.id, project: b.project ?? p.project, since: Date.parse(b.since ?? "") });
    }
  }
  const reliable = Number.isFinite(at) && running.every((b) => Number.isFinite(b.since));
  const bots = (reliable ? running.filter((b) => b.since < at) : running)
    .map(({ id, name, project }) => ({ id, name, project }));
  return { bots, reliable };
}
