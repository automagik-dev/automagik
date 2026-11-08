# The per-pane hc proxy (#631 PR A)

**Status: off by default.** This is the hard-boundary proxy from wish #631, shipped in the pack
for PR A but not wired anywhere. Nothing imports it: `startArgs`, `workerArgs`, `install.sh` and
the launcher never name it, so a pane today still runs the #624 guardrail. PR B starts one proxy
before each sandboxed pane, masks the real core socket and binds the proxy at the path the pane
sees. Until then this file is a rulebook and a runnable module, not behaviour.

## Run

```sh
XDG_RUNTIME_DIR=/run/user/1000 node mods/am-sidebar/hcProxy.mjs \
  --terminal t7 \
  --upstream /run/user/1000/herdr-core/default.sock \
  --app-home /path/to/herdr-app-home
```

`--terminal` is the pane's hc terminal id, fixed for the proxy's life; `--upstream` is the real
core's socket and is never guessed. The process listens on
`$XDG_RUNTIME_DIR/automagik-hc-proxy/<terminal>/hc.sock` (folder 0700, socket 0600), then serves
until SIGTERM/SIGINT and removes the socket. Starting fails closed when the core is not the pin,
the caller is neither in the attach ledger nor a worker pane, the roster or ledger cannot be
read, or the runtime folder is inside the writable project or app home.

## What it speaks

Plain-mode JSON-RPC 2.0, one message per line, exactly hc 0.1.14. It opens **one upstream
connection per downstream client connection**, so one client's long `terminal.wait` cannot block
another's read. `hello` is refused, so the connection never switches to framed mode and
`terminal.attach` is unreachable. Every reply line is capped at 2 MiB and `terminal.read` is
capped at 5,000 lines: a 6 MiB read is a clear `hc-proxy:` error, never a buffered line. A
request line is capped at 256 KiB.

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
| `terminal.run` | only hcGuard's exact dsh-tui worker shape: `--bg`, `parent` = the caller, `cwd` under the caller's project `.claude/worktrees/`, `worker.of` = the caller's bot, only the worker labels, `/usr/bin/env PATH=<guard>:… dsh-tui -- <task>`, no `on`/`line`, identity env only, and a guard folder outside the writable project and app home. Only a ledger-bound bot pane starts a worker |

Everything else is refused with a JSON-RPC error whose message starts `hc-proxy: `, including
`terminal.put`, `terminal.keys`, `terminal.attach`, `terminal.interrupt`, `terminal.keep`,
`terminal.label` (on a non-own target), `file.*`, `doc.*`, `machine.*`, `server.*`,
`events.subscribe`, `rpc.discover` and `templates.list`. `hello` is refused before it can switch
the connection to framed mode.

`terminal.label` is allowed on an own worker because the pack's worker start does **not** set the
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
needs a proxy restart.** This is the design correction in #631: a snapshot (or a copy outside the
cwd) instead of a live read of bot-writable team data. The proxy's own socket folder is also
outside both trees: `$XDG_RUNTIME_DIR/automagik-hc-proxy/<terminal>/hc.sock`, not under the app
home.

## Version pin and fail-closed behaviour

At start the proxy calls `server.status`; the core must answer `version: "0.1.14"` (the box's
core, hc 0.1.14), or the proxy refuses to start. One constant names it: `HC_PIN` in
`hcProxy.mjs`. The wslc image's separate 0.1.18 pin is a separate note, not this pin.

A dead or vanished upstream is a JSON-RPC error on every call; it never falls back to another
socket or to a locally started core. Note for PR B: `hc` auto-starts a core when it cannot
connect. The sandbox must keep that from happening (an environment switch or the wrapper) while
the real socket is masked, or a missing proxy would create a new core at the bound path. PR A
does not wire that; it only never falls back.

## What a filesystem mask cannot do

The hc proxy filters one Unix socket. It does not filter the network: the sandbox still reaches
every TCP listener on the box, including localhost admin ports, unless PR B adds a network
namespace (or equivalent). A path mask hides files; it cannot hide a listening port. The PR that
came with this file lists the box's listeners read-only so the owner can decide whether that is a
separate item.

The `terminal.run` shape also constrains a process, not the task text: a deliberately forged
worker start can still choose the task word after `--`. The final fix for that is starting
workers from the pack side rather than exposing `terminal.run` to the pane; PR A keeps the shape
because PR B still uses it. The guard folder and the resolved `dsh-tui` are additionally
required to be outside the writable project and app home, and every PATH word must be absolute,
so a file dropped in the worktree cannot pose as the pack's guard or program.
