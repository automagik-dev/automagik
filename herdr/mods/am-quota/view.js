// am-quota's panel as plain data: for one tool (Claude Code or Codex), the account this Mac uses,
// one sentence on whether it lasts until its window resets, the one switch the policy asks for
// and why, and the tool's other accounts on the proxy. Also the proxy's display name and which
// bots still run on the account a switch replaced.
//
// No `herdr`, no gpui, no network: `node --test` runs it, and main.js only draws what it returns.
// Accounts are shown by email and plan, never by the credential's file name (that stays the id).

import { DEFAULTS, bindingWindow, choose, headroom, minutesToReset } from "./policy.js";
import { DEFAULT_LOGIN, loginName, methodLine, nextSlot, paneLogin, typed } from "./logins.js";

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
    const tied = fresh.filter((f) => at(f) === at(me));
    // A full tie (same reset, same room) is broken by the account's id: say it's a tie.
    if (tied.some((f) => f.headroom === me.headroom)) rule = "ties with another on its reset and its room";
    else if (tied.length) rule = "resets as soon as another, and has more room";
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
  // Only Codex is installed from the proxy. A Claude login never is (#453): its card shows the
  // proxy's usage with no Use or Switch until it lists the logins signed in on this Mac.
  const installs = provider === "codex";
  const mine = accounts.filter((a) => a.provider === provider)
    .sort((a, b) => who(a).localeCompare(who(b)) || String(a.id).localeCompare(String(b.id)));
  const current = installs && record ? mine.find((a) => a.id === record.name) ?? null : null;
  const managed = Boolean(current) && (!badge || badge.text === "in use");
  const verdict = choose(mine, { provider, now, activeId: managed ? current.id : null });
  const pick = verdict.action === "switch" ? mine.find((a) => a.id === verdict.to) ?? null : null;
  const row = (a, next = false) => ({
    account: a, who: who(a), usage: usage(a, now), next,
    switchable: installs && !a.disabled && !a.requires_sign_in,
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
    if (!installs) {
      headline = "No switch for now";
      text = `${label} keeps the login it has on this Mac. This panel no longer installs ${label} logins from ${source}, because that `
        + "overwrote the Mac's own sign-in; switching between the logins signed in on this Mac comes next.";
    }
    if (!mine.length) text += ` ${source} has no ${label} account yet.`;
    if (pick && installs) out.primary = { account: pick, label: `Use ${pick.email || "this account"}`, why: why(pick, verdict, null, now) };
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
  return { ...out, ...standing({ current, fact, u, pick, label, source }) };
}

/**
 * How the account in use stands, for its card: { state, dot, pill, sentence, fine }. `fact`: its
 * policy fact; `u`: its usage; `pick`: the account the policy would move to, or null.
 */
function standing({ current, fact, u, pick, label, source }) {
  const moveFine = pick ? `Bots already running stay on ${current.email || "it"} until restarted. You get that button next.` : `No other ${label} account has room right now.`;
  if (!fact.usable) {
    const what = current.requires_sign_in ? `it needs a new sign-in on ${source}` : current.disabled ? `it is disabled on ${source}` : `${source} reports it unusable`;
    return { state: "low", dot: "warn", pill: { text: "Can't be used", tone: "warn" },
      sentence: { text: `It can't be used right now: ${what}.`, tone: "warn" }, fine: moveFine };
  }
  if (!u.tracked) {
    return { state: "ok", dot: "none", pill: { text: "In use", tone: "none" },
      sentence: { text: `${source} doesn't track this account's usage, so the panel can't say how long it lasts.`, tone: "none" } };
  }
  const dry = fact.minutesToDry, reset = fact.minutesToReset;
  const due = dry !== null && reset !== null && dry <= reset + DEFAULTS.marginMinutes;
  if (due) {
    const text = dry <= 0
      ? `It has run out${u.reset ? `; it ${u.reset}` : ""}.`
      : `At this pace it runs out in about ${span(dry)}, before it resets`;
    return { state: "low", dot: "warn", pill: { text: "Running out", tone: "warn" }, sentence: { text, tone: "warn" }, fine: moveFine };
  }
  if (dry === null) {
    return { state: "ok", dot: u.hot ? "warn" : "good", pill: { text: "In use", tone: "good" },
      sentence: { text: "Measuring its pace; the panel says in a minute whether it lasts", tone: "none" } };
  }
  // The dot follows the bar: amber at 85% used even while the pace says it lasts.
  return { state: "ok", dot: u.hot ? "warn" : "good", pill: { text: "In use", tone: "good" },
    sentence: { text: "Lasts until it resets", tone: "good" } };
}

const slotFor = (s, home) => ({ ...s, signIn: `CLAUDE_CONFIG_DIR=${typed(s.dir, home)} claude auth login` });
const lower = (e) => (typeof e === "string" ? e.toLowerCase() : null);
const NOT_TRACKED = Object.freeze({ tracked: false, used: null, hot: false, text: "usage not tracked", reset: null, flags: [] });

/**
 * One login's row (#453, docs/local-logins.md sections 4 to 6), from its probe (logins.js
 * probeLogin): who it is, its lines, and whether Use may go to it. `bad`: the record can't be
 * followed, so nothing is offered. `inUse`: new Claude launches get this login.
 */
function loginRow(p, { home, inUse, bad, recordUse }) {
  const name = loginName(p.id);
  const lines = [];
  const st = p.status ?? { state: "unread" };
  const want = p.id === DEFAULT_LOGIN ? `${String(home).replace(/\/+$/, "")}/.claude` : p.dir;
  let owned = true;   // its quota is this sign-in's
  let usable = !p.problem;
  if (p.problem) lines.push({ text: `${name}'s ${p.problem}`, tone: "bad" });
  else if (st.state === "nobin") lines.push({ text: "claude isn't on this app's PATH, so the panel can't tell who this login is", tone: "warn" });
  else if (st.state === "unread") lines.push({ text: "claude auth status gave no answer the panel can read", tone: "warn" });
  if (!p.problem && st.configDirectory && st.configDirectory.replace(/\/+$/, "") !== want) {
    lines.push({ text: `settings move ${name} to another folder: switching can't choose it`, tone: "bad" });
    usable = false;
  }
  if (!p.problem && st.authMethod && st.authMethod !== "claude.ai") {
    lines.push({ text: methodLine(st.authMethod), tone: "warn" });
    owned = false;
    usable = false;
  }
  for (const f of p.unlinked ?? []) lines.push({ text: `${f} in ${name} is no longer shared`, tone: "warn" });
  const signIn = !p.problem && st.state === "out"
    ? `${p.id === DEFAULT_LOGIN ? "" : `CLAUDE_CONFIG_DIR=${typed(p.dir, home)} `}claude auth login` : null;
  if (signIn) lines.push({ text: "Not signed in. Sign in again from a terminal, then press ↻:", tone: "warn" });
  usable &&= st.state === "in";
  // The onboarding and folder-trust questions of a fresh `.claude.json` (section 4, unverified).
  if (usable && p.id !== DEFAULT_LOGIN) lines.push({ text: `The first launch under ${name} needs one answer in its pane.`, tone: "none" });
  return { id: p.id, dir: p.dir, name, email: owned ? p.email ?? null : null, shownEmail: p.email ?? null, inUse, lines, signIn,
    use: usable && !bad && !inUse, remove: !bad && p.id !== DEFAULT_LOGIN && p.id !== recordUse };
}

/**
 * The Claude card (#453): the logins signed in on this Mac, not the proxy's accounts. `record`:
 * logins.js readRecord's; `probes`: probeLogin of the default login and each listed one, or null
 * before the first look; `accounts`: the sampled proxy accounts (quota only, matched by email);
 * `vars`: credential variables set in this app (presentVars), or null.
 *
 * Returns toolView's card fields (state, dot, headline, pill, sentence, primary, fine, usage,
 * current) plus { problem: why the record can't be followed or null, rows, notHere: proxy
 * accounts with no login here (never a button), add: the next slot { id, dir, signIn } or null,
 * envLines }. `primary` is { row, label, why } for the login the policy would move to.
 */
export function loginsView({ record, probes, accounts = [], now = Date.now(), source = "CLIProxyAPI", home = "", vars = null }) {
  const label = TOOLS.claude;
  const proxy = accounts.filter((a) => a.provider === "claude");
  const base = { provider: "claude", label, primary: null, fine: null, current: null, usage: null, rows: [], notHere: [], add: null,
    envLines: (vars ?? []).map((n) => `${n} is set in Herdr's environment: it outranks a sign-in for whatever starts with it`) };
  if (!probes) {
    return { ...base, problem: record?.problem ?? null, state: "new", dot: "none", headline: "Reading the logins on this Mac…",
      pill: { text: "Reading", tone: "none" }, sentence: { text: "", tone: "none" }, notHere: proxy.map((a) => ({ account: a, who: who(a), usage: usage(a, now) })) };
  }
  // A record the CLI can't follow, or whose login in use has a folder the CLI refuses: launches
  // are on the default login with a warning, and nothing is offered until it is fixed.
  const used = probes.find((p) => p.id === record.use);
  const problem = record.problem ?? (used?.problem ? `login ${used.id}'s ${used.problem}` : null);
  const effective = problem ? DEFAULT_LOGIN : record.use;
  const rows = probes.map((p) => loginRow(p, { home, inUse: p.id === effective, bad: Boolean(problem), recordUse: record.use }));
  for (const r of rows) {
    r.account = r.email ? proxy.find((a) => lower(a.email) === lower(r.email)) ?? null : null;
    r.usage = r.account ? usage(r.account, now) : r.shownEmail && !r.email ? { ...NOT_TRACKED, text: "not this sign-in's" } : NOT_TRACKED;
    r.who = r.shownEmail ? `${r.shownEmail} · ${r.name}` : r.name;
  }
  const here = new Set(rows.map((r) => lower(r.shownEmail)).filter(Boolean));
  const out = { ...base, problem, rows, notHere: proxy.filter((a) => !here.has(lower(a.email))).map((a) => ({ account: a, who: who(a), usage: usage(a, now) })),
    add: problem ? null : slotFor(nextSlot(record.logins, home), home) };
  const current = rows.find((r) => r.inUse);
  out.current = current;
  // policy.choose over the local logins only, by their proxy quota.
  const pool = rows.filter((r) => r.account && (r.use || r === current)).map((r) => r.account);
  const activeId = current?.account && pool.includes(current.account) ? current.account.id : null;
  const verdict = choose(pool, { provider: "claude", now, activeId });
  const pickRow = verdict.action === "switch" ? rows.find((r) => r.account?.id === verdict.to && r.use) ?? null : null;
  if (pickRow) out.primary = { row: pickRow, label: `Use ${pickRow.email}`, why: why(pickRow.account, verdict, activeId, now) };
  out.headline = current.who;
  if (current.signIn) {
    return { ...out, state: "low", dot: "warn", pill: { text: "Not signed in", tone: "warn" },
      sentence: { text: `New Claude launches use ${current.name}, which is not signed in.`, tone: "warn" } };
  }
  if (!activeId) {
    return { ...out, state: "ok", dot: "none", pill: { text: "In use", tone: "none" },
      sentence: { text: `${source} doesn't list this login's account, so the panel can't say how long it lasts.`, tone: "none" } };
  }
  out.usage = usage(current.account, now, { unit: true });
  const fact = verdict.facts.find((f) => f.id === activeId);
  return { ...out, ...standing({ current: current.account, fact, u: out.usage, pick: pickRow?.account ?? null, label, source }) };
}

const NOT_RUNNING = new Set(["not running", "planned", "hc unavailable"]);

/** The running bots of `provider` in `automagik-herdr ls --all --json`: [{ id, name, project, terminal, since }]. */
export function runningBots(ls, provider) {
  const running = [];
  for (const p of ls?.projects ?? []) {
    if (p?.error) continue;
    for (const b of p?.bots ?? []) {
      if (b?.agent !== provider || !b.terminal || NOT_RUNNING.has(b.status)) continue;
      running.push({ id: b.id, name: b.name ?? b.id, project: b.project ?? p.project, terminal: b.terminal, since: Date.parse(b.since ?? "") });
    }
  }
  return running;
}

/**
 * The bots still on the account a switch replaced, from `automagik-herdr ls --all --json`.
 * A bot of this tool that started before `at` (its pane's `since`) still has the old login. When
 * any running bot of the tool has no start time, the split can't be trusted: all of them are
 * listed and `reliable` is false. Returns { bots: [{ id, name, project }], reliable }.
 */
export function staleBots(ls, provider, at) {
  const running = runningBots(ls, provider);
  const reliable = Number.isFinite(at) && running.every((b) => Number.isFinite(b.since));
  const bots = (reliable ? running.filter((b) => b.since < at) : running)
    .map(({ id, name, project }) => ({ id, name, project }));
  return { bots, reliable };
}

/**
 * The Claude bots not on login `chosen` (#453 section 3), by value: `gets[i]` is hc get of
 * `bots[i]`'s pane (null: gone, undefined: unreadable). Each is listed with the login its launch
 * argv names, or why that can't be told. Returns staleBots's shape, each bot with `on`.
 */
export function offLogin(bots, gets, logins, chosen) {
  const out = [];
  bots.forEach((b, i) => {
    if (gets[i] === null) return;
    const on = gets[i] === undefined ? { why: "hc can't read its pane" } : paneLogin(gets[i].argv, logins);
    if (on.id === chosen) return;
    out.push({ id: b.id, name: b.name, project: b.project,
      on: on.id ? loginName(on.id) : on.unknown ? `an unknown login (${on.unknown})` : on.why });
  });
  return { bots: out, reliable: true };
}
