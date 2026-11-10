# ADR 0013 — a command is a run the scheduler does itself

**Status**: accepted · **Date**: 2026-11-10 · amends the README's "one prompt on a clock"

## Context

Until now a run was one of two things: an agent taking a prompt, or a
`workflow:` handed to `hwf` in a pane. Both need a pane, and the first needs a
model. A deterministic job (a daily check that is one script) fits neither:

- With `hwf` not installed there is no way to schedule a plain command at all.
- An agent cannot stand in for one. A sandboxed agent may not write outside its
  folder or reach the network, so the check fails where the same script run by
  hand works; and a model in the loop to run one command costs tokens and adds
  a way to fail that the job does not have.
- The status of both existing kinds is inferred: an agent's from what it
  reports, a workflow's from an exit code scraped off a screen. Runs whose
  output existed were listed `failed`, and runs whose work failed were listed
  `done`. For a job whose whole point is "did the check pass", an inferred
  status is not good enough.

The workarounds on offer were a system cron beside the scheduler, or an agent
seat kept only to type one command. Both leave the job outside the one list
where its owner looks for what ran while they were away.

## Decision

A third kind of work, `command:`, that the scheduler daemon runs itself.

```yaml
- name: daily-check
  cron: "0 7 * * *"
  command:
    argv: ["./check.sh", "--all"]   # the program first; no shell reads it
    cwd: ~/checks                   # working folder; the home folder when absent
    env: { REGION: eu }             # added to the daemon's environment
  timeout_minutes: 10               # the automation's own bound, default 60
  notify: b-captain                 # optional: the bot told the result
```

- **No pane, no agent, no model.** The daemon starts the program as a child
  process, in its own process group, with stdin closed. Nothing is provisioned:
  the run skips the host seam (ADR 0004) entirely, so it works the same under
  either backend and needs neither Herdr's server nor herdr-core to run.
- **It runs as the user the daemon runs as**, like a cron or login-service job:
  that user's network and files. The automation sets only its working folder,
  its environment and its timeout. There is no sandbox.
- **The status is the program's exit status.** Exit 0 is `done`. Any other
  exit, a signal, the timeout, or a program that would not start is `failed`.
  History keeps the exit code (absent when there is none), the last ten lines
  of stderr, and one result line: the last line of stdout when it worked, else
  the failure and the last line of stderr. At the timeout the whole process
  group gets SIGTERM, then SIGKILL ten seconds later.
- **`notify: <bot>` sends that one line to a bot**, the way bots already
  message each other: the terminal labelled `bot=<id>` is looked up
  (`hc ls --label bot=<id>`) and the line goes in through `hc send`. A name no
  terminal is labelled with is tried as a terminal's own name. The run's status
  is recorded first; what became of the report ("sent to …", "not delivered:
  …") is recorded after it and never changes the status.
- **A command entry names nothing an agent needs.** `repo`, `workspace`,
  `session`, `agent`, `model`, `template`, `agent_args`, `mcp_config`,
  `blocked_grace_minutes` and `close_workspace: on-success` are refused on
  load beside `command:`, each by name. `notify` is refused without it.
- `ls --json` names the kinds a build runs (`kinds`), so the panel offers the
  command form only to a scheduler that would keep the key.

Overlap, catch-up, pause, `missed` and `skipped` are unchanged: a command is
still one automation, one schedule, one run at a time (ADR 0006).

## Why

"One prompt on a clock" was a statement about scope: no sequencing, no
branching, no queue. A command keeps all of that. What it drops is the
assumption that the thing on the clock must be a model. The scheduler's value
is the clock, the catch-up after sleep, the one history and the notice when
something fails; none of that depends on what the work is.

Running the program directly, rather than typing it into a pane, is what makes
the status true. A child process has an exit status; a pane does not, which is
why `workflow:` prints a marker and reads the screen back for it. Putting a
command in a pane would have inherited that inference for the one kind of work
that does not need it, and would have tied a job with no interest in Herdr to a
running Herdr.

Reporting through `hc send` to a bot's label uses the path that already
exists. A bot is addressed by its id because a terminal address changes on
every restart, which is the reason the panel warns about addresses in prompts.

The access model is the plain one on purpose. The job this was built for needs
the network and folders outside its own; a sandbox that allows that by named
grants is a second design with its own questions (what is granted by default,
who may widen it). The owner's default is "as a cron job would run", and that
is what ships.

## Rejected

- **A system cron beside the scheduler** — the job leaves the list, the
  history, the catch-up after sleep and the failure notice. Two schedulers to
  look at is the problem automations exist to remove.
- **An agent seat that runs the command** — a model and its sandbox between a
  clock and a script: cost, a new way to fail, and the access the job needs
  refused.
- **The command typed into a pane, like `workflow:`** — a scraped exit code,
  and a run that needs a workspace to exist.
- **A shell string instead of argv** — quoting rules nobody remembers at the
  moment a nightly job breaks. A job that needs pipes is a script, and a script
  is a file that can be run by hand to see what the scheduler saw.
- **A sandbox with named grants in the first cut** — see Why; it stays a
  follow-up if the owner asks for one.
- **The full output in history** — history is a log of what happened, one line
  per state. The command's own log file is the place for its output.

## Consequences

- The scheduler now executes programs with its own user's rights on a
  schedule. Anyone who can write `automations.yaml` could already start an
  agent with `--dangerously-skip-permissions` there, so this adds no new
  capability to that file; it does make it a shorter path. The file's
  permissions are the control, as before.
- The result line and the stderr lines are a program's output shown in the
  panel and pasted into a bot's terminal. Terminal control sequences and
  control characters are removed and each line is cut at 300 characters. The
  bot still reads text it did not write: it is a report, not an instruction.
- A report needs herdr-core's `hc` and a live terminal for the bot. A blocked
  or absent bot gets nothing, and history says so; the report is not retried.
- A command's environment is the daemon's. Under the login service that is the
  PATH captured when the service was installed, not an interactive shell's:
  name the program by path, or set `PATH` in `env`. A bare program name is
  looked up in the daemon's PATH, not in `env`'s.
- A daemon the TUI's startup hook started still ends with its last Herdr
  session (ADR 0010), commands included. A machine that should run commands
  with no Herdr open wants the login service.
- A command run has no workspace to open from the board or the panel; its
  record is the whole of it.
- `herdr-automations cleanup` skips command entries: they have no repo and
  make no worktree.
- CONTEXT.md's "Work" now has three kinds, and the README no longer says an
  automation is only a prompt.
