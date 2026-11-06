// A stand-in for herdr-core's `hc`, for the CLI tests: every call is appended to
// $HC_FAKE_LOG as one JSON argv line, and answers come from the terminals in
// $HC_FAKE_STATE ({ terminals: [hc get objects], next: number }), which `label` and `run`
// change. Only the calls automagik-herdr makes: ls [--label k=v], get, read, label, run (its
// launch argv kept as `argv`, `sh -c <command>` for a template, as hc's own get shows), server
// status (state.core), kill (the terminal finishes, and its live die_with_parent children with
// it, as hc ends them), templates (state.templates:
// [{ name, command }]), machine ls and exec --on (state.machines: [{ name, state, uname, home,
// path?, temporary? }]: a linked machine is a scratch home folder; its `uname -sm` is `uname`,
// anything else runs here with HOME=home and `path` (a folder of fakes) first on PATH, in
// --cwd or its home), and file read|edit --on (its files are paths here; hc's answers: exit 3
// not_found, 1 edit_failed or unavailable, 4 machine_unknown, errors as JSON on stderr), and
// connect: JSON-RPC lines on stdin, answered on stdout. Only doc.get, from state.docs (or the
// machine's docs with `on`): { name: { value, version } }, absent { value: null, version: 0 }.
// Every request is kept in state.connectRequests; doc.set (or anything else) fails the call
// (exit 2), and state.connectHang answers nothing and runs on (its pid in state.connectPid).
// state.connectBefore: raw lines printed before any answer (a notification, a broken line);
// state.connectAnswer: a raw line printed in place of every answer.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { appendLine, readJsonLines } from "./log-lines.mjs";

const args = process.argv.slice(2);
appendLine(process.env.HC_FAKE_LOG, JSON.stringify(args));
const state = JSON.parse(readFileSync(process.env.HC_FAKE_STATE, "utf8"));
// The CLI runs several hc calls at once: a save writes a file of its own beside the state and
// renames it over it (atomic in one folder), so another call never reads one half written.
const save = () => {
  const tmp = `${process.env.HC_FAKE_STATE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, process.env.HC_FAKE_STATE);
};
const out = (x) => process.stdout.write(`${JSON.stringify(x)}\n`);
const fail = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const words = args.filter((a) => a !== "--json");
const find = (t) => state.terminals.find((x) => x.address === t || x.name === t);
// The log, read once: other calls append to it at the same time, so only its complete lines
// (log-lines.mjs, #421). This call's own line is among them: it was written whole above.
const logged = readJsonLines(process.env.HC_FAKE_LOG);
// The call's number (lines in the log so far), and at every call the sessions (agent.session or
// revive.session labels) live in more than one pane then, appended to $HC_FAKE_STATE.doubles.
const callNo = logged.length;
{
  const by = new Map();
  for (const x of state.terminals.filter((y) => y.state === "live")) {
    const id = x.labels?.["agent.session"] ?? x.labels?.["revive.session"];
    if (id) by.set(id, [...(by.get(id) ?? []), x.address]);
  }
  for (const [session, panes] of by) {
    if (panes.length > 1) appendLine(`${process.env.HC_FAKE_STATE}.doubles`, JSON.stringify({ call: callNo, word: words[0], session, panes }));
  }
}
// endTurnOn: { word, nth } on a terminal: its turn ends when the nth `hc <word>` call happens
// (this one counted), whatever that call is about: a turn that ends on its own clock, not when
// the CLI looks at it. As hc does, the end types a note into its parent (state.notes) when that
// parent still runs, and the parent's agent takes a short turn of its own.
{
  let changed = false;
  for (const t of state.terminals) {
    const due = t.endTurnOn;
    if (!due || logged.filter((a) => a.filter((w) => w !== "--json")[0] === due.word).length < due.nth) continue;
    delete t.endTurnOn;
    changed = true;
    if (t.state !== "live" || t.status?.state !== "working") continue;
    t.status.state = "idle";
    const up = t.parent ? find(t.parent) : null;
    if (up?.state === "live") {
      state.notes = [...(state.notes ?? []), { to: up.address, from: t.address, call: callNo }];
      up.status = { ...(up.status ?? {}), state: "working" };
      up.idleAfterGets = 1;
    }
  }
  if (changed) save();
}
// state.fail: commands that fail as a server that is down would (exit 1).
if ((state.fail ?? []).includes(words[0])) fail(`hc: can't reach the server (${words[0]})`);
// A linked machine's terminal ("vm/t8") on a machine that isn't connected: unavailable, as hc says.
if (["get", "label", "kill", "read", "send", "keys", "interrupt"].includes(words[0]) && words[1]?.includes("/")) {
  const m = (state.machines ?? []).find((x) => x.name === words[1].split("/")[0]);
  if (!m || m.state !== "connected") fail(JSON.stringify({ error: { kind: m ? "unavailable" : "machine_unknown", message: `${words[1].split("/")[0]} isn't connected` } }), m ? 1 : 4);
}

/**
 * What a launch argv has in front once it runs: `sh -c <command> [$0 args…]` (behind any
 * `env K=V`) is the command's words and the args (sh execs a simple command, as the real one
 * does); anything else is itself.
 */
function foregroundOf(launch) {
  let w = [...launch];
  if (/(^|\/)env$/.test(w[0] ?? "")) { let j = 1; while (j < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[j])) j += 1; w = w.slice(j); }
  if (/(^|\/)(sh|bash)$/.test(w[0] ?? "") && w[1] === "-c" && typeof w[2] === "string") {
    return [...w[2].replace(/ "\$@"$/, "").split(/\s+/).filter(Boolean), ...w.slice(4)];
  }
  return launch;
}

switch (words[0]) {
  case "ls": {
    const want = [];
    for (let i = 1; i < words.length; i += 1) if (words[i] === "--label") want.push(words[++i]);
    const rows = state.terminals.filter((t) => t.state !== "finished" && want.every((kv) => {
      const [k, v] = [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)];
      return (t.labels ?? {})[k] === v;
    }));
    // Like the real one: rows carry no labels and no created_ms.
    out({ terminals: rows.map(({ address, name, cwd, state: s, parent, status }) => ({ address, name, cwd, state: s, parent, status: status?.state, agent: status?.app })) });
    break;
  }
  case "get": {
    // state.failGet: terminals hc can't answer for (a server error, not "no such terminal").
    if ((state.failGet ?? []).includes(words[1])) fail(`hc: server error reading ${words[1]}`);
    const t = find(words[1]);
    // Like the real one: exit 3 and a not_found error on stderr.
    if (!t) fail(JSON.stringify({ error: { kind: "not_found", message: `no terminal "${words[1]}"` } }), 3);
    // idleAfterGets: while mid-turn, answered that many times, then its turn ends (idle). As hc
    // does, the turn's end types a note into its parent (state.notes), whose agent then takes a
    // short turn of its own (one more look).
    if (typeof t.idleAfterGets === "number" && t.status?.state === "working") {
      if (t.idleAfterGets <= 0) {
        t.status.state = "idle";
        delete t.idleAfterGets;
        const up = t.parent ? find(t.parent) : null;
        if (up?.state === "live") {
          state.notes = [...(state.notes ?? []), { to: up.address, from: t.address, call: callNo }];
          up.status = { ...(up.status ?? {}), state: "working" };
          up.idleAfterGets = 1;
        }
      } else t.idleAfterGets -= 1;
      save();
    }
    // exitAfterGets: answered live that many times, then the program exits (a failed resume).
    if (typeof t.exitAfterGets === "number") {
      if (t.exitAfterGets <= 0) { t.state = "finished"; delete t.exitAfterGets; } else t.exitAfterGets -= 1;
      save();
    }
    // reuseAfterGets: answered that many times, then its id is another terminal (reuseCreated).
    if (typeof t.reuseAfterGets === "number") {
      if (t.reuseAfterGets <= 0) { t.created_ms = t.reuseCreated; delete t.reuseAfterGets; } else t.reuseAfterGets -= 1;
      save();
    }
    out(t);
    break;
  }
  case "read": {
    const t = find(words[1]);
    if (!t) fail(`no terminal ${words[1]}`);
    out({ text: t.screen ?? "" });
    break;
  }
  case "label": {
    const t = find(words[1]);
    if (!t) fail(`no terminal ${words[1]}`);
    if (state.failLabel === words[1]) fail(`label refused on ${words[1]}`);
    t.labels ??= {};
    for (const kv of words.slice(2)) {
      const eq = kv.indexOf("=");
      const [k, v] = [kv.slice(0, eq), kv.slice(eq + 1)];
      if (v === "") delete t.labels[k]; else t.labels[k] = v;
    }
    save();
    out({ address: t.address, labels: t.labels });
    break;
  }
  case "run": {
    const labels = {};
    let name = null, cwd = null, parent = null, outlive = false, on = null, noParent = false;
    let i = 1;
    // Options, then argv: after `--`, or from the first word that isn't an option (a template).
    for (; i < words.length && words[i] !== "--" && words[i].startsWith("--"); i += 1) {
      if (words[i] === "--label") { const kv = words[++i]; labels[kv.slice(0, kv.indexOf("="))] = kv.slice(kv.indexOf("=") + 1); }
      else if (words[i] === "--name") name = words[++i];
      else if (words[i] === "--cwd") cwd = words[++i];
      else if (words[i] === "--parent") parent = words[++i];
      else if (words[i] === "--on") on = words[++i];
      else if (words[i] === "--outlive-parent") outlive = true;
      else if (words[i] === "--no-parent") noParent = true;
    }
    const given = words.slice(words[i] === "--" ? i + 1 : i);
    // A template (no `--`, a name state.templates lists): hc runs its command through sh -c
    // and types the task in as the first message; its foreground is the command's program.
    const template = words[i] !== "--" ? (state.templates ?? []).find((x) => x.name === given[0]) ?? null : null;
    const launch = template ? ["sh", "-c", template.command] : given;
    const argv = foregroundOf(launch);
    // Like the real one: with no --parent and no --no-parent, the calling terminal is its parent.
    if (!parent && !noParent && process.env.HC_TERMINAL_ID) parent = process.env.HC_TERMINAL_ID;
    // `env K=V … program …`: the program is the first word after the assignments.
    const program = /(^|\/)env$/.test(argv[0] ?? "") ? argv.slice(1).find((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) : argv[0];
    // --on M: a linked machine's terminal, addressed "M/tN" (refused when M isn't connected).
    if (on) {
      const m = (state.machines ?? []).find((x) => x.name === on);
      if (!m) fail(JSON.stringify({ error: { kind: "machine_unknown", message: `unknown machine "${on}"` } }), 4);
      if (m.state !== "connected") fail(JSON.stringify({ error: { kind: "unavailable", message: `${on} isn't connected` } }));
    }
    // state.failRun: names whose hc run fails (a name taken, the server refusing).
    if ((state.failRun ?? []).includes(name)) fail(`hc: can't start ${name}`);
    const n = state.next ?? 100;
    const address = on ? `${on}/t${n}` : `t${n}`;
    state.next = n + 1;
    // state.runAs: "shell" (the agent never comes in front), "exit" (it ends at once) or
    // "flaky" (its agent is in front for one hc get, then it exits); state.runAsFor[name]: the
    // same, for the run of that name only.
    const runAs = state.runAsFor?.[name] ?? state.runAs;
    const shell = runAs === "shell";
    // state.workingOnRun: terminals whose agent starts a turn when this run happens (once).
    for (const a of state.workingOnRun ?? []) { const w = find(a); if (w) w.status = { ...(w.status ?? {}), state: "working" }; }
    delete state.workingOnRun;
    // state.failGetOnRun: terminals whose hc get starts failing when this run happens.
    if (state.failGetOnRun) { state.failGet = [...(state.failGet ?? []), ...state.failGetOnRun]; delete state.failGetOnRun; }
    // state.noCreated: names whose hc get gives no created_ms.
    state.terminals.push({ address, name, cwd, labels, parent, die_with_parent: Boolean(parent) && !outlive, state: runAs === "exit" ? "finished" : "live",
      ...((state.noCreated ?? []).includes(name) ? {} : { created_ms: Date.now() }),
      argv: launch, template: template?.name ?? null,
      pid: 9000 + n, foreground: { argv: shell ? ["zsh"] : argv, cwd, pid: 5000 + n }, // state.noStatus: programs that report no status to hc (hermes): status null.
      status: (state.noStatus ?? []).includes(program) ? null : { app: program === "claude" ? "claude-code" : program, state: "working" },
      ...(runAs === "flaky" ? { exitAfterGets: 1 } : {}) });
    // state.onRunWrite: { path, text }: a file edit that lands while this run happens.
    if (state.onRunWrite) writeFileSync(state.onRunWrite.path, state.onRunWrite.text);
    save();
    // state.runNoAddress: the pane starts, but the answer carries no address.
    if (state.runNoAddress) { out({}); break; }
    out({ address });
    break;
  }
  case "kill": {
    const t = find(words[1]);
    if (!t) fail(`no terminal ${words[1]}`);
    if (state.failKill === words[1]) fail(`kill refused on ${words[1]}`);
    t.state = "finished";
    // state.surviveParent: children that outlive their parent's end anyway (a kill that didn't take).
    for (const c of state.terminals) if (c.parent === t.address && c.state === "live" && c.die_with_parent && !(state.surviveParent ?? []).includes(c.address)) c.state = "finished";
    save();
    out({ address: t.address, state: t.state });
    // Killing the caller's own terminal ends the caller (this fake runs exec'd by the wrapper,
    // so its parent is the program that called hc).
    if (process.env.HC_TERMINAL_ID && [t.address, t.name].includes(process.env.HC_TERMINAL_ID)) process.kill(process.ppid, "SIGKILL");
    break;
  }
  case "server": {
    // `hc server status`: the core's permanent id (state.core, else a fixed one).
    if (words[1] !== "status") fail(`fake hc: no server ${words[1]}`, 2);
    out({ core: state.core ?? { id: "fakecore0000", name: "fake" }, live: state.terminals.filter((t) => t.state === "live").length });
    break;
  }
  case "templates": {
    if (!state.templates) fail("hc: no templates folder");
    out({ templates: state.templates });
    break;
  }
  case "machine": {
    if (words[1] !== "ls") fail(`fake hc: no machine ${words[1]}`, 2);
    out({ machines: (state.machines ?? []).map(({ name, id, state: s, temporary = false }) => ({ name, id: id ?? `core-${name}`, host: name, state: s, temporary, target: name })) });
    break;
  }
  case "exec": {
    // hc exec [--json] [--timeout N] [--on M] -- argv… (argv as given: not filtered for --json).
    let i = args.indexOf("exec") + 1, on = null, cwd = null;
    for (; i < args.length && args[i] !== "--"; i += 1) {
      if (args[i] === "--on") on = args[++i]; else if (args[i] === "--cwd") cwd = args[++i]; else if (args[i] === "--timeout") i += 1;
    }
    const argv = args.slice(i + 1);
    const m = (state.machines ?? []).find((x) => x.name === on);
    if (!m) fail(JSON.stringify({ error: { kind: "not_found", message: `no machine "${on}"` } }), 3);
    if (m.state !== "connected") fail(`hc: ${on} is not connected`);
    const b64 = (s) => Buffer.from(s ?? "").toString("base64");
    // state.execUnanswered: programs whose call gets no answer (the machine dropped mid-call).
    if ((state.execUnanswered ?? []).includes(argv[0])) fail(JSON.stringify({ error: { kind: "unavailable", message: `${on} stopped answering` } }));
    if (argv[0] === "uname") { out({ code: 0, stdout: b64(`${m.uname}\n`), stderr: "", timed_out: false }); break; }
    // state.execTimedOut: words whose call hc ends at its --timeout (a login shell that never answers);
    // state.execTimedOutAfterMs: how long that answer takes to come back over the link, really waited.
    if ((state.execTimedOut ?? []).some((w) => argv.join(" ").includes(w))) { if (state.execTimedOutAfterMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, state.execTimedOutAfterMs); out({ code: null, stdout: "", stderr: "", timed_out: true }); break; }
    // Its login shell is fake-login-shell, never the host's, and never reads a real profile:
    // m.login { path, noise, exit }, the PATH it has (default: the one hc runs programs with).
    const r = spawnSync(argv[0], argv.slice(1), { cwd: cwd ?? m.home, encoding: "utf8",
      env: { ...process.env, HOME: m.home, PATH: `${m.path ? `${m.path}:` : ""}/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: new URL("./fake-login-shell", import.meta.url).pathname, FAKE_LOGIN_PATH: m.login?.path ?? "",
        FAKE_LOGIN_NOISE: m.login?.noise ?? "", FAKE_LOGIN_EXIT: m.login?.exit ?? "" } });
    // state.loseExecAnswer: a program (by name) ran there, then the link dropped: unavailable, as hc says.
    if (state.loseExecAnswer && state.loseExecAnswer === argv[0]) { delete state.loseExecAnswer; save(); fail(JSON.stringify({ error: { kind: "unavailable", message: `${on} stopped answering` } })); }
    out({ code: r.status ?? -1, stdout: b64(r.stdout), stderr: b64(r.stderr), timed_out: false });
    break;
  }
  case "file": {
    // hc file read|edit --json --on M [--old=X --new=Y] <path>
    const err = (code, kind, message) => fail(JSON.stringify({ error: { kind, message } }), code);
    const on = args.includes("--on") ? args[args.indexOf("--on") + 1] : null;
    const m = (state.machines ?? []).find((x) => x.name === on);
    if (on && !m) err(4, "machine_unknown", `unknown machine "${on}"`);
    if (m && m.state !== "connected") err(1, "unavailable", `${on} is not connected`);
    const path = args.at(-1);
    if (!existsSync(path)) err(3, "not_found", `no file ${path}`);
    const text = readFileSync(path, "utf8");
    if (words[1] === "read") {
      const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
      out({ first: 1, last: lines, lines, text });
      break;
    }
    if (words[1] !== "edit") err(2, "invalid_params", `fake hc: no file ${words[1]}`);
    const old = args.find((a) => a.startsWith("--old=")).slice(6), now = args.find((a) => a.startsWith("--new=")).slice(6);
    // state.editRace: someone's edit lands between the CLI's read and this edit.
    if (state.editRace) { writeFileSync(path, state.editRace); delete state.editRace; save(); }
    const current = readFileSync(path, "utf8");
    const at = current.indexOf(old);
    if (at < 0 || current.indexOf(old, at + 1) >= 0) err(1, "edit_failed", "the old text is not in the file");
    writeFileSync(path, current.slice(0, at) + now + current.slice(at + old.length));
    // state.loseEditAnswer: the edit lands, then the link drops: hc's real answer, unavailable.
    if (state.loseEditAnswer) { delete state.loseEditAnswer; save(); fail(JSON.stringify({ error: { kind: "unavailable", message: `${on} stopped answering` } })); }
    out({ bytes: now.length, path });
    break;
  }
  case "connect": {
    if (state.connectHang) { state.connectPid = process.pid; save(); }
    const lines = readFileSync(0, "utf8").split("\n").filter((l) => l.trim());
    state.connectRequests = [...(state.connectRequests ?? []), ...lines.map((l) => JSON.parse(l))];
    if (state.connectHang) {
      save();
      setInterval(() => {}, 1000);
      break;
    }
    save();
    for (const raw of state.connectBefore ?? []) process.stdout.write(`${raw}\n`);
    for (const line of lines) {
      const { id, method, params } = JSON.parse(line);
      if (state.connectAnswer !== undefined) { process.stdout.write(`${state.connectAnswer}\n`); continue; }
      if (method !== "doc.get") fail(`fake hc: connect refuses ${method}`, 2);
      const error = (kind, message) => out({ jsonrpc: "2.0", id, error: { code: -32000, message, data: { kind } } });
      let docs = state.docs ?? {};
      if (params.on !== undefined && params.on !== null) {
        const m = (state.machines ?? []).find((x) => x.name === params.on);
        if (!m) { error("machine_unknown", `unknown machine "${params.on}"`); continue; }
        if (m.state !== "connected") { error("unavailable", `${params.on} isn't connected`); continue; }
        docs = m.docs ?? {};
      }
      out({ jsonrpc: "2.0", id, result: docs[params.name] ?? { value: null, version: 0 } });
    }
    break;
  }
  default:
    fail(`fake hc: no ${words[0]}`, 2);
}
