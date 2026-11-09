# The per-pane hc proxy (#631)

**Status: C2b-2 preparation, off by default.** The effective rollout setting is the bot entry's
`hcProxy` boolean in the project's **approved roster snapshot**, read afresh at each start,
restart and worker start. Edit the working value with
`automagik-herdr edit <bot> --hc-proxy on|off`, then run `automagik-herdr proxy approve`
and review the diff before restarting. A valid approved on stays on if a pane changes or removes
the working key. Working on with approval off or missing refuses and names `proxy approve`;
an invalid approval refuses only when the working switch is on. With working off, an invalid
record starts plain with the existing argv byte for byte and a loud STDERR warning naming
the record, the problem and `automagik-herdr proxy approve`. An invalid record cannot be
trusted to say on. This applies to starts, restarts, tree helpers, workers and linked starts.
Doctor prints a project WARN row for invalid approval, whatever the switches.
Approved off (or no record with working off)
keeps the existing command byte for byte. Only approved `true` on Linux wraps a
pack-started dsh-tui bot or dsh-tui worker in `hcPane.mjs`. Other agents and templates keep their
existing launch. `AM_HC_PROXY` no longer enables anything: the saved setting belongs to one bot.
`automagik-herdr show <bot>` reports both working and approved values, including missing
approval. Editing it never restarts a running pane.

**Known limit:** if a bot was approved on, its working switch was turned off, and the approved
record is also invalid, it starts plain with that warning. A sandboxed pane cannot write the
approved record, so only an outside change can cause this combination. Repair the record and
review `proxy approve` before restarting to restore the intended setting.

The helper starts the proxy **before DSH** and closes it when the child ends. A failed proxy
start never launches the child; a listening proxy that errors or closes ends the child and
returns failure. There is no fallback launch against the real core. A stale execution copy or
profile row refuses startup and names `automagik-herdr dsh-tui install` as the repair.

C2b-2 adds approved-worker allowance through the proxy. Every switch stays off; the managed
sandbox profile row and socket mask are unchanged. The coordinated profile-row enablement
and mask review follow in C2c. No bot is opted in by this preparation. Administration endpoints
remain outside this work.

## Rollout and rollback

After the remaining slices land, the captain can roll out one bot at a time from an ordinary
terminal on the computer running that bot:

1. Run `automagik-herdr dsh-tui update`, then `automagik-herdr dsh-tui doctor`.
   Install and update refresh the stable helper, proxy, guard and wrapper together. Doctor
   checks the stable execution copy and managed profile row without changing either.
   `dsh-tui doctor --project <project>` also shows every bot's working and approved `hcProxy` and
   whether its attached local pane's proxy answers. Off with a proxy still up means the pane
   has not completed rollback and prints a warning. A malformed roster adds one failed row
   while install checks still print. A missing proxy is reported down; doctor never starts a core,
   proxy or pane. Install and update preserve every saved switch, including an absent value.
2. Run `automagik-herdr edit <bot> --hc-proxy on`, then
   `automagik-herdr proxy approve --project <project>`. Review the printed roster diff,
   including the switch change. A **roster change needs a pane restart** after approval.
3. Run `automagik-herdr restart <bot>`. Check that bot before opting in the next.
4. To roll back, run `automagik-herdr edit <bot> --hc-proxy off`, then
   `automagik-herdr proxy approve --project <project>` (review the diff), then
   `automagik-herdr restart <bot>`. With a valid approved-on record, off without approval
   keeps the pane proxied; the invalid-record exception above starts plain with a warning.
   Existing workers keep their launch until restarted;
   end and relaunch any workers that also need rollback.

Linked starts and restarts check the target platform first. Non-Linux ignores the switch.
On Linux they read the target's approved record and refuse an unapproved opt-in; approved on
refuses because that path cannot verify the stable proxy execution path. Start it locally
on the target computer instead.
If checking the target platform fails, working off starts plain with a loud STDERR warning;
working on refuses. An unreadable or invalid linked approval follows the same on/off rule
as a local start.

## Run

The pack starts it through the helper, never as a standalone service:

```sh
sh mods/am-sidebar/bin/run.sh mods/am-sidebar/hcPane.mjs \
  --bot b-xxxxxxxxxx --project /path/to/project \
  -- dsh-tui --resume <id>
```

The helper runs from the stable execution copy (`run.sh`, `hcPane.mjs`, their modules and the guard,
written byte-equal under the data home by `dsh-tui install`), never from the writable pack
folder itself. It reads `HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` from the pane, passes the caller it
resolved outside the sandbox (the proxy still checks the pane's own label), and starts nothing
if the proxy refuses. A worker's `--project` is mandatory: it is the main checkout the pack
resolved (the lead seat's project), never the worker's worktree, so the approved record is the
main project's even when the worktree's own `.herdr/bots.json` differs. It gives the pane
`DSH_SANDBOX_MASK=1`, `AM_HC_REAL_SOCKET` and `AM_HC_PROXY_SOCKET`, and keeps `HC_SOCKET` on the
same real path the DSH wrapper binds the
proxy onto. The mask hides the shared `automagik-hc-proxy` parent and binds only the pane's own socket. The
proxy listens on `$XDG_RUNTIME_DIR/automagik-hc-proxy/<terminal>/hc.sock`
(folder 0700, socket 0600), then serves until the child ends; the helper closes it and removes
the socket. Starting fails closed when the core is not the pin, the caller's pane label does
not match the bot it was started for, an explicit caller has no usable approved record, the
by-hand path's ledger or working roster cannot be read, or the runtime folder, data root or
stable root is inside a writable tree.

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
| `terminal.run` | the helper shape, or the exact approved template/agent shape below; bound bot panes only |
| `templates.list` | only the approved worker template, with its metadata unchanged |
| `proxy.workerTransport` | local transport identification for the wrapper's verified bot pane; never forwarded |

A worker start needs `--bg`, `parent` = the caller, `cwd` under the caller's project
`.claude/worktrees/`, `worker.of` = the caller's bot, only the worker labels, and this argv:

```sh
/usr/bin/env PATH=… /bin/sh <stable>/bin/run.sh <stable>/hcPane.mjs \
  --bot <caller> --project <project> --worker -- dsh-tui -- <task>
```

No `on` or `line` is accepted, and only identity environment variables are allowed. The old
plain five-word shape (`/usr/bin/env PATH=… dsh-tui -- <task>`) is refused: a proxied bot could
change its local rollout setting, and a plain worker would have no proxy of its own, so its
sandbox would reach the real core one hop later. The sandbox row binds the data parent
read-only (covering the stable folder and `approved/`), so its guard, helper and runner cannot
be rewritten. Any other guard is refused inside the writable project and app home. Only a
bound bot pane (the helper's seat, or a by-hand ledger row) starts a worker.

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

## Approved template and agent workers

At each worker spawn the proxy calls `readApprovedRecord` again. A missing, unreadable or
invalid record refuses the allowance. Its digest, approval time and approver must still match
the record with which this pane started. A newly approved snapshot needs a pane restart.
Neither the live `bots.json` nor the cached team graph supplies worker allowance.

Only the snapshot's `worker.template` or `worker.agent` is allowed. The proxy derives the plan
from the approved defaults and rebuilds argv through the same `workerArgs` function the CLI
uses. It checks exact equality, including the approved model and effort; the task remains one
text argument and cannot be an option. Extra args, changed programs, environment assignments
and unapproved templates or agents are refused with one `hc-proxy:` line explaining why.
For templates the proxy reads metadata from the core, and `templates.list` returns only the
approved name, preserving that entry's metadata. A missing template cannot become a program.

Only dsh-tui workers take the helper wrapper and mask. An approved template or other agent
worker keeps its existing plain launch, outside the dsh-tui sandbox, as the owner's choice.
The single generated env exception is the default Claude login wrapper,
`/usr/bin/env -u CLAUDE_CONFIG_DIR`: trusted code rebuilds it from the approved plan and core
template text. The caller cannot add or change an unset or assignment. Separately, the real
worker CLI wire carries `TERM`, `COLORTERM`, `TERM_PROGRAM` and `TERM_PROGRAM_VERSION`; only
those four optional RPC env keys are allowed, each matching `[A-Za-z0-9._+-]{1,64}`. All other
keys and bad values refuse. Parent, caller and worker identity come from the verified pane.

The CLI skips the PATH guard only when the actual transport answers the proxy's local
`proxy.workerTransport` request for this pane. It then uses the real hc on that same proxy
transport, so the proxy checks the approved start. A working roster edit or caller-added env
marker cannot select this route. Without that proxy response, it keeps today's guard route
and its refusal. This is necessary because the old guard accepts only its plain dsh-tui shape.

**Known limit next to this allowance:** a bot approved on whose working switch was turned off,
while its record is also invalid, starts plain with the loud warning. Only an outside change
can make the record invalid; the sandbox binds the whole data root read-only.

The fixture test `approved snapshot write and rename are refused inside the sandbox wrapper`
runs real bwrap with a fixture data root, never live resources. Its unmasked control allows
both operations; its masked run refuses both. It reports a capability skip when bwrap or
namespaces are unavailable. The required local Herdr gate runs this proof without a skip;
CI without those capabilities skips this proof.

## Team data is a start-time snapshot

A proxied pane's policy is built from one record read at start and **never re-read from the
writable tree**:

- the project's approved roster, `<data root>/approved/<key>.json`, where the data root is
  `$XDG_DATA_HOME/automagik-herdr` (default `~/.local/share/automagik-herdr`) and the key is
  sha256 of the project's canonical realpath, truncated. The record is
  `{ v, project, roster, sha256, approvedAt, approvedBy }`: the exact approved `.herdr/bots.json`
  bytes, their digest and the person's approval, mode 0600.

The record lives outside the project and the app home; the sandbox row binds the whole data root
read-only once, so every stable file and every approved record is reachable but not writable
inside a sandbox. `automagik-herdr proxy approve --project <dir>` is the only writer: it reads
the working roster, prints the diff against the previous record (bots added/removed,
rank/lead/kind changes), then writes the new record. `dsh-tui install` never approves.
Only `proxy approve` and a proxied start check the approved data root. Plain `dsh-tui`
install/check keeps its stable execution root checks without validating approval storage.

A working-tree roster that differs from the record **warns once and still starts**, naming
`automagik-herdr proxy approve`; the approved roster stays in force. A missing record **refuses**
a proxied pane. **A roster change therefore needs a pane restart**, after
`automagik-herdr proxy approve`: the helper starts the proxy before DSH, so the new pane's proxy
reads the newly approved record, and
nothing in the old sandbox can write it first. The proxy's own socket folder is outside both
trees: `$XDG_RUNTIME_DIR/automagik-hc-proxy/<terminal>/hc.sock`, not under the app home.

The by-hand path (`hcProxy.mjs` started without an explicit caller) is unchanged and outside
the enablement: it still reads the attach ledger, `<app home>/automagik-herdr/attach.jsonl`
(`modeProblem` still refuses a group- or world-writable ledger), and the working
`.herdr/bots.json` (the team graph via `teamOf`). An explicit caller never opens the ledger.

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

## C1 and C2

C1 added the approved roster and moved the explicit caller off the attach ledger. C2b-1
made the approved snapshot authoritative for the per-bot switch. C2b-2 adds the worker
allowance above. Every switch stays off in this preparation.

Residual, recorded for the person who approves: a sandboxed bot can ask an in-team unsandboxed
pane to run `automagik-herdr proxy approve`. The printed diff is the check, and approving is the
person's act. The record is outside the sandbox; the command that writes it is not automatically
trusted because it ran in an unsandboxed pane.

C2c coordinates the later sandbox profile change and mask review. This slice changes neither.

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
binds the data parent read-only (`--pack-root`; it covers the stable folder and `approved/`);
any other guard and the resolved
`dsh-tui` are required to be outside the writable project and app home, and every PATH word must
be absolute, so a file dropped in the worktree cannot pose as the pack's guard or program. A bot
that changes its own PATH gets its worker start refused (fail closed): the proxy records the pane
PATH it was started with outside the sandbox and requires the exact `guardPathWith` of it. The
installed shim under `~/.local/bin` and the stable root's parent are assumed read-only inside the
sandbox, as the policy states; a stable root inside the project, the app home, the temp folder or
the runtime folder is refused by `dsh-tui install` and by the proxy at start. The stable runner
bakes one absolute node at install; a custom `NVM_DIR` or `AUTOMAGIK_HERDR_RUNTIME_DIRS` inside a
writable tree is refused too. A node upgrade (nvm, Homebrew, bun) needs `automagik-herdr dsh-tui
install` again: the stable runner bakes one absolute node and a missing one is refused.
