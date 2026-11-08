---
title: "dsh-tui --resume on a session the desktop DSH host serves (spike)"
type: research
created: 2026-11-07
updated: 2026-11-07
tags: [research, spike, dsh, dsh-tui, herdr, universal-bot, rfc-0014]
---
# dsh-tui --resume on a session the desktop DSH host serves (spike)

Date: **2026-11-07**. For the [RFC 0014](../rfcs/0014-shared-bot-registry.md) amendment
("Universal Bots") and wish `pocket-four-tabs`, Group 0a. It ran in a scratch home only: a copy
of the dsh-tui profile, its own `HOME` and `DSH_HOME`, no credentials, and the model endpoint
pointed at a closed local port. No live install was touched and no product code was written.

**Question.** Can `dsh-tui --resume <id>` join a DSH Session that the desktop app's DSH host is
serving, so that a Herdr pane and the Automagik window drive one Session at the same time? Is
that concurrent use safe?

## Answer

**No: it cannot join while the host holds the Session. That is DSH's safety rule, so concurrent
use cannot happen.** DSH lets one process write a Session at a time. A second process that
resumes it is refused before it writes anything, and nothing interleaves. `dsh-tui --resume`
works only as a **handoff**: it takes the Session once the holder has let go of it.

What this means for the Herdr face of a universal Bot (RFC 0014, Amendments): while the desktop
host serves the Session, the pane is a read-and-type view of it through the host, not a second
dsh-tui runtime. The wish already named this fallback ("If it cannot, the Herdr face stays a
read-and-type view of the DSH session, not a second runtime").

## Why: two locks, both refuse

1. **DSH's write lease (any DSH process).** `@deepseek-ai/dsh-session-persistence-jsonl`
   0.2.2-rc.1, `lib/index.js` (read from DeepSeek Harness.app's `app.asar`, the runtime the
   spike's dsh-tui booted):
   - `:619-646` define the lease as "Cross-process write-ownership lock for one session's
     artifact directory, held for the whole life of a write handle". It is a non-blocking
     `flock(2)` on `session.lock` beside the log. The kernel frees it when the holder exits.
     "Readers never touch the lock."
   - `:243-250`: "An open write handle holds it from construction."
   - `:693-698`: a busy lock throws `SessionAlreadyOwnedError`.

   A profile only adds plugins; DSH's own packages, this one included, come from the DSH runtime
   that boots it (the `tui` profile's `node_modules/.pnpm` holds no `@deepseek-ai` package). The
   Automagik desktop host boots its own bundled runtime (`apps/desktop/src/dsh.js:44-47`) with
   the `omni` profile, which bundles `@deepseek-ai/dsh-base`, `@automagik/bots-dsh` and
   `@automagik/acp-dsh`. That runtime, in the installed `Automagik.app`, carries the same
   `dsh-session-persistence-jsonl` 0.2.2-rc.1, with the same lease (`lib/index.js:244`, `:648`,
   `:698`). So any process holding the lease stands in for the desktop host here.
2. **dsh-tui's own mount ledger (TUI against TUI).**
   `@deepseek-harness-tui/dsh-tui` 0.19.0, `lib/types/dsh-adapter/plugin.js:3020-3035` refuses a
   `--resume` of a Session another dsh-tui has mounted. The ledger lives in `~/.dsh-tui`, so it
   only sees other dsh-tui processes under the same `HOME`, never a DSH host.

A resume from inside dsh-tui (`/resume`) maps the lease error to its own message
(`lib/types/dsh-adapter/channel/session-resume.js:98-102`, text at `lib/types/i18n.js:371`):
"Another DSH process is writing this session. Release it in that process (for example, dsh
web), then retry resume. Do not delete the session or lock files."

## What ran

| | |
|---|---|
| DSH | 0.2.2-rc.1 (`dsh --version`) |
| dsh-tui | `@deepseek-harness-tui/dsh-tui` 0.19.0, profile copied from the person's `tui` profile |
| Host | macOS 25.5, arm64 |
| Home | `HOME=$H`, `DSH_HOME=$H/.dsh`, `$H` a new folder in a session scratchpad `$S` |
| Model | `DEEPSEEK_API_KEY=sk-spike-not-a-key`, `DEEPSEEK_BASE_URL=http://127.0.0.1:9`: every model call fails on the machine, nothing leaves it |
| Terminal | BSD `script -q` gives each dsh-tui a pty; keys are piped in (Esc skips the first-run guide) |

Setup: one dsh-tui session took the prompt `hello spike`. The turn failed ("DeepSeek Messages
transport failed"), but the Session was written: `815965b3-e795-4db2-924c-a88c307b9154`, with
`session.v4.jsonl.zstd` and `session.lock` under `$H/.dsh/sessions/<cwd>/`.

**Run 1: a dsh-tui holds the Session (A), a second resumes it (B), then again after A exits
(B2).** The driver logged the `session.lock` holders with `lsof -t`:

```
[21:20:26] versions: dsh 0.2.2-rc.1; dsh-tui 0.19.0
[21:20:27] before A: session.lock holders: none
[21:20:52] A running (job 49309): session.lock holders: 49313
[21:20:52]   holder 49313: .../DeepSeek Harness ... args: --profile tui --resume 815965b3-e795-4db2-924c-a88c307b9154
[21:21:02] B (while A holds) exit: 1
[21:21:42] A ended (killed at its 75 s cap): session.lock holders: none
[21:22:04] B2 running: session.lock holders: 52948
[21:22:12] B2 ended: session.lock holders: none
```

A's screen showed the Session's history (`❯ hello spike`, then the failed turn): a resume
replays the Session. B printed, and exited 1:

```
dsh-tui startup failed: dsh-tui: cannot resume session "815965b3-e795-4db2-924c-a88c307b9154":
it is mounted by another TUI terminal (pid 49313) — two processes driving one session log would
corrupt it. Close that terminal, or drop --resume to start a fresh session.
```

That is the mount ledger (lock 2), which a DSH host never writes. So run 2 holds the lease
without a TUI.

**Run 2: a plain process holds DSH's lease (the host's case), dsh-tui resumes (C), then again
after release (D).** The holder takes `flock(fd, LOCK_EX | LOCK_NB)` on the Session's
`session.lock`, the same kernel lock the lease takes, and holds it for 45 s. C printed, and
exited:

```
dsh-tui startup failed: dsh-tui: cannot resume session "815965b3-e795-4db2-924c-a88c307b9154":
session "815965b3-e795-4db2-924c-a88c307b9154" is already owned by an active write handle — the
stored log is unreadable or corrupt; no fresh session was started instead. Drop --resume to
start fresh, or repair the session log first.
```

The driver's log:

```
[21:22:22] before: session.lock holders: none; tui mounts: { ... "pid": 52948, "sessionIds": [ "815965b3-..." ] }
holder pid 54856 took the lease
[21:22:25] holder running: session.lock holders: 54856
[21:22:35] C (while the lease is held) exit: 1
holder released the lease
[21:23:07] holder ended: session.lock holders: none
[21:23:27] D running: session.lock holders: 57357
[21:23:33] D ended: session.lock holders: none
```

The mount ledger still listed B2 (pid 52948, already gone). dsh-tui read that entry as stale and
let C through to DSH, so C's refusal came from the lease alone. D took the lease within seconds
of its release, with nothing to repair.

The startup path appends "the stored log is unreadable or corrupt" and "repair the session log"
to every resume failure, the lease refusal included. The log was intact: D opened it once the
lease was free. Whatever drives the Herdr face must read the lease refusal as "busy", never
offer a repair, and never delete `session.lock` (deleting it forfeits the exclusion,
`lib/index.js:631-636`).

## What it does not settle

- **When the desktop host lets go.** The lease lives as long as the host's write handle. Whether
  bots-dsh's host keeps a Bot's Session open while it idles is not settled here. That decides
  whether a handoff to dsh-tui is ever possible while the app runs. *Settles it:* in a scratch
  `AUTOMAGIK_HOME`, start the desktop app's DSH host, open a Bot's chat, leave it idle, and read
  `lsof -t <session>/session.lock` over time.
- **Two stores today.** The desktop host's `DSH_HOME` is `~/.automagik/desktop/dsh`
  (`apps/desktop/src/dsh.js:771`); the dsh-tui shim runs with `${DSH_HOME:-$HOME/.dsh}`
  (`herdr/mods/am-sidebar/dshTui.mjs:66`, `:83`). By default a dsh-tui pane does not even see the
  desktop host's Sessions. Pointing `DSH_HOME` at the desktop store also moves the profiles
  folder, where no `dsh-tui` profile exists. Wish Group 6 decides this.
- **The `acp-claude` route in dsh-tui.** A resume runs the Session's recorded route first
  (`session-resume.js:85-95`). A universal Bot's route is `acp-claude`, which comes from
  Automagik's acp-dsh plugin, and the dsh-tui profile bundles only `@deepseek-ai/dsh-base` and
  dsh-tui. Whether such a resume fails or falls back is not tested. *Settles it:* a scratch
  profile with acp-dsh added, a Session recorded on `acp-claude`, then `--resume`.
- No model turn ran: the endpoint was closed. Nothing here measures turn-time behaviour.

## Reproduce

Scratch only, never against a live home. From an empty folder `$S`, with `$H` a new folder
inside it:

1. `mkdir -p $H/.dsh/profiles $S/work`, then `cp -R ~/.dsh/profiles/tui $H/.dsh/profiles/tui`.
2. In `$S/work`, with the environment in "What ran", run `dsh --profile tui` under
   `script -q`. Press Esc to skip the guide, type a prompt and Enter. The Session folder appears
   under `$H/.dsh/sessions/`.
3. Hold the lease from another process: `flock(LOCK_EX | LOCK_NB)` on that folder's
   `session.lock`. Then run `dsh --profile tui --resume <id>`: refused.
4. Release the lease and run the same command again: it opens and replays the Session.
