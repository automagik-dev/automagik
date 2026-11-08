# The per-pane hc proxy (#631)

**Status: opt-in (`AM_HC_PROXY=1`), wired for pack-started dsh-tui panes and workers.** With
the switch on, `startArgs` and `workerArgs` run a dsh-tui pane through `hcPane.mjs`, one helper
per pane. The helper starts the proxy in its own process **before DSH**, then runs the agent as
its child, so the proxy snapshots the roster and the attach ledger before the pane can create a
sandbox. The proxy ends with the pane; there is no service. **A roster change needs a pane restart**, because the new pane starts a new proxy that reads the new file. Nothing sets the
switch by default, so a default seat and worker keep the old argv; PR C turns it on for the PM.
A pack update that changes the wrapper needs `automagik-herdr dsh-tui install` again: the helper
refuses an opted-in pane while the profile's sandbox row is stale.

## Run

The pack starts it through the helper, never as a standalone service:

```sh
sh mods/am-sidebar/bin/run.sh mods/am-sidebar/hcPane.mjs \
  --bot b-xxxxxxxxxx --project /path/to/project \
  -- dsh-tui --resume <id>
```

The helper reads `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` from the pane, passes the caller it
resolved outside the sandbox (the proxy still checks the pane's own label), and starts nothing
if the proxy refuses. It gives the pane `DSH_SANDBOX_MASK=1`, `AM_HC_REAL_SOCKET` and
`AM_HC_PROXY_SOCKET`, and keeps `HC_SOCKET` on the same real path the DSH wrapper binds the
proxy onto. The proxy listens on `$XDG_RUNTIME_DIR/automagik-hc-proxy/<terminal>/hc.sock`
(folder 0700, socket 0600), then serves until the child ends; the helper closes it and removes
the socket. Starting fails closed when the core is not the pin, the caller's pane label does
not match the bot it was started for, the roster or ledger cannot be read, or the runtime
folder is inside the writable project or app home.

`hcProxy.mjs` can still be run by hand with `--terminal <tN> --upstream <socket>
[--app-home <dir>]`; without an explicit caller it uses the attach ledger (or a worker's
`worker.of` label) as before.

The socket-path limit is the platform's: 107 bytes on Linux, 104 on macOS; an over-limit path
is refused with the named error before the folder or socket exists.

## What it speaks

Plain-mode JSON-RPC 2.0, one message per line, exactly hc 0.1.14. It opens **one upstream
connection per downstream client connection**, so one client's long `terminal.wait` cannot block
another's read. `hello` is refused, so the connection never switches to framed mode and
`terminal.attach` is unreachable. Every reply line is capped at 2 MiB and `terminal.read` is
capped at 5,000 lines: a 6 MiB read is a clear `hc-proxy:` error, never a buffered line. A
request line is capped at 256 KiB. A pane socket accepts at most 16 client connections at once;
a connection with no request in flight is closed after 5 minutes (an in-flight `terminal.wait`,
or a `send` with `wait`, keeps it alive); a forwarded call other than those is answered with an
error after 30 seconds.

`params.caller` is always overwritten with the pane's terminal id, fixed at start. A caller the
client supplies is never forwarded. Every allowed call is resolved first with one short
`terminal.get`, checked against the policy, then forwarded by the **resolved address**; terminal
ids are never reused, so a rename between the check and the call cannot redirect it.

## Policy (default deny)

| Method | Rule |
|---|---|
| `terminal.list` | allowed as is: metadata only (no screen text) |
| `terminal.get`, `terminal.read`, `terminal.wait` | the caller itself, hcGuard's `teamOf` graph, and its own workers |
| `terminal.send` | the same, plus hcGuard's pm/integrator/fixer widening for a bot whose bots.json entry has that rank, and the shared reviewer/fixer targets. The widening never reaches a worker pane |
| `terminal.kill`, `terminal.rm`, `terminal.label` | the caller's **own workers only**: the target's `parent` is the caller's pane, or its `worker.of` is the caller's bot. A team member, another bot's worker and a worker caller are refused |
| `terminal.run` | only the per-pane helper worker shape: `--bg`, `parent` = the caller, `cwd` under the caller's project `.claude/worktrees/`, `worker.of` = the caller's bot, only the worker labels, then `/usr/bin/env PATH=… /bin/sh <pack>/bin/run.sh <pack>/hcPane.mjs --bot <caller> --project <project> --worker -- dsh-tui -- <task>`, no `on`/`line`, identity env only. The old plain five-word shape (`/usr/bin/env PATH=… dsh-tui -- <task>`) is refused: a proxied bot could unset `AM_HC_PROXY` in its own shell, and a plain worker would have no proxy of its own, so its sandbox would reach the real core one hop later. The sandbox row binds the pack folder read-only, so its guard/helper/runner cannot be rewritten; any other guard is refused inside the writable project and app home. Only a ledger-bound bot pane starts a worker |

`terminal.send` keeps hc's `force`, `if` and `timeout`; `force` only skips the busy wait, and the
target is still team-scoped.

Everything else is refused with a JSON-RPC error whose message starts `hc-proxy: `, including
`terminal.put`, `terminal.keys`, `terminal.attach`, `terminal.interrupt`, `terminal.keep`,
`terminal.label` (on a non-own target), `file.*`, `doc.*`, `machine.*`, `server.*`,
`events.subscribe`, `rpc.discover` and `templates.list`. `hello` is refused before it can switch
the connection to framed mode.

`terminal.label` forwards only `terminal` and `labels`; the 0.1.14 schema lists no caller for
label. It is allowed on an own worker because the pack's worker start does **not** set the
worker's tab label: `workerArgs` sets `worker.of`, `branch`, `worker.role`, `task*` and
`herdr.space`, and the sidebar's `keptSteps` sets `herdr.space`/`herdr.tab` with a later
`hc label` once the pane is in the window. Without that call the worker's tab marker could not be
written from the pane.

## Team data is a start-time snapshot

The policy is built from two reads at start and **never re-read from the writable tree**:

- the attach ledger, `<app home>/automagik-herdr/attach.jsonl` (the caller and its project;
  `modeProblem` still refuses a group- or world-writable ledger), and
- the project's `.herdr/bots.json` (the team graph via `teamOf`).

The sandbox's writable cwd holds both the project's `.herdr/bots.json` and, on the box, the app
home; a bot that edits either widens nothing while the proxy runs. **A roster change therefore
needs a pane restart**, not only a proxy restart: the helper starts the proxy before DSH, so
the new pane's proxy sees the new file, and nothing in the old sandbox can write it first. This
is the design correction in #631: a snapshot (or a copy outside the cwd) instead of a live read
of bot-writable team data. The proxy's own socket folder is also outside both trees:
`$XDG_RUNTIME_DIR/automagik-hc-proxy/<terminal>/hc.sock`, not under the app home.

## Version pin and fail-closed behaviour

At start the proxy calls `server.status`; the core must answer `version: "0.1.14"` (the box's
core, hc 0.1.14), or the proxy refuses to start. One constant names it: `HC_PIN` in
`hcProxy.mjs`. The wslc image's separate 0.1.18 pin is a separate note, not this pin.

A dead or vanished upstream is a JSON-RPC error on every call; it never falls back to another
socket or to a locally started core. `hc` auto-starts a core when it cannot connect, so a pane
without a live proxy would create one inside its sandbox. The helper keeps that from happening:
if the proxy cannot start, the pane's command is not started at all, so no sandbox exists and
there is no `hc` inside one to auto-start anything. A proxy that dies after start takes its
pane with it.

## Left for PR C

The project's `.herdr/bots.json` and the attach ledger under the app home are writable inside the
sandbox in the live configuration. The proxy's start-time snapshot stops a later edit from
widening the running pane, but the edit persists and the next pane restart (a new proxy) reads
it. PR C owns narrowing that for the PM; until then, a bot can widen its next start's team by
editing either file now.

## Limits and the real hc 0.1.14 params

The proxy trusts any same-uid client (Node cannot check peer credentials); the 0700 folder and
0600 socket are the only access control, and every pane has its own folder.

`terminal.run`'s closed parameter set was checked against hc 0.1.14's real request on a pane
(`hc run --bg --json` from inside a pane): the CLI sends `argv`, `caller`, `cwd`,
`die_with_parent`, `env`, `keep`, `labels`, `name`, `no_notify`, `no_parent`, `outlive_parent`,
`parent`, `rm`, `timeout` and `wait`. `--json` is CLI output only and is not an RPC member, so
there is no `json` gap; `line` and `on` are listed by the schema but the proxy refuses them by
design, as the worker shape. The `terminal.list` caller refusal stays as it is.

## What a filesystem mask cannot do

The hc proxy filters one Unix socket. It does not filter the network: the network stays open,
and a path mask cannot hide a listening port without a network namespace (or equivalent). Any
service that must not be reachable belongs on a root-only Unix socket or behind a network
namespace.

The `terminal.run` shape also constrains a process, not the task text: a deliberately forged
worker start can still choose the task word after `--`. The final fix for that is starting
workers from the pack side rather than exposing `terminal.run` to the pane; the pack keeps the shape
because its worker start still uses it. The pack's own guard, helper and runner are allowed inside the app home because the sandbox row
binds the pack folder read-only (`--pack-root`); any other guard and the resolved `dsh-tui` are
required to be outside the writable project and app home, and every PATH word must be absolute,
so a file dropped in the worktree cannot pose as the pack's guard or program.
