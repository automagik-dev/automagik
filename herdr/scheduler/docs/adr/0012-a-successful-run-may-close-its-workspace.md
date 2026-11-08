# ADR 0012 — a successful run may close its workspace

**Status**: accepted · **Date**: 2026-11-04 · amends [ADR 0001](0001-cleanup-is-never-scheduled.md)

## Context

ADR 0001 keeps a run's workspace open as the signal that nobody has read it.
For a chore checked on weekends, or one that runs hourly, that signal is noise:
workspaces pile up, and before the agent-name fallback an unread run made the
next one fail (#13). Users worked around it by telling the agent to run
`herdr workspace close $HERDR_WORKSPACE_ID` at the end of its prompt.

## Decision

An opt-in key, `close_workspace: never | on-success`, default `never`. With
`on-success` the runner records the run `done`, then asks the host to close
the run's workspace, or the tab the run opened when the automation shares a
workspace. Existing-mode closes in one scheduler process serialize per workspace
(and Herdr session) and re-read the tab list under the lock immediately before
acting. This prevents two scheduler runs from each seeing two tabs and both
closing. It leaves the last tab it can see:

- TUI, `workspace: worktree | root`: `herdr workspace close <id>`. The worktree
  and its uncommitted files stay (measured 2026-11-04), so `cleanup` keeps its
  job.
- TUI, `workspace: existing`: `herdr tab close <tab_id>`, aimed at the tab this
  run created. The space's tabs are read first; a run whose tab is the space's
  last one at that moment, whose tab is no longer listed, or whose tab list
  cannot be read closes nothing and says why in the log. A person closing the
  other tabs between that read and the close can still leave it last; the
  scheduler issues no space close itself, and the app then closes the space.
  The lock is process-local: a manual `run` or a second daemon can race the
  same way, since its closes do not share this process's mutex.
- hc, `workspace: worktree | root`: `hc kill` then `hc rm` on the run's
  terminal. The app removes the space itself once its terminal is killed
  (measured 2026-11-04).
- hc, `workspace: existing`: the same `hc kill` and `hc rm` on the run's
  terminal, but only while another terminal remains at the time of the read.
  The app removes a tab when its last pane goes and the space with its last tab
  (`remove_pane` → `remove_tab` → `remove_space`). A person closing the other
  tabs between the read and the kill can still leave it last; the scheduler
  issues no space close itself, and the app then closes the space. A manual
  `run` or a second daemon has its own lock and can race the same way.

Both agent backends fail a run that stays blocked past `blocked_grace_minutes`
(default 2, `-1` waits the timeout out), with the dialog line in history and a
notice. Herdr's `agent wait` also settles on blocked, so the scheduler checks
the status after every wait slice. On hc it kills the terminal without removing
its record. On herdr it re-reads `pane process-info` and the agent status before
the signal. If the dialog cleared, the run resumes without a blocked failure.
It requests SIGTERM only for an unchanged foreground group, refusing a missing,
shell, or scheduler group. The error and log say "asked the agent to stop
(SIGTERM)": exit is not confirmed, SIGTERM is not escalated, and a TERM-ignoring
dialog can survive. Refused or unsuccessful requests are reported as such.
The rechecks narrow the read/signal window without making it atomic. Neither
failure path asks to close the pane, tab, or space.

## Why

The author of the automation is the one who knows whether its runs need
reading. A per-automation opt-in leaves ADR 0001 true for every automation that
does not say otherwise, and only touches runs that finished cleanly, which are
the ones with nothing to review.

Recording `done` before closing matters: closing is also how a person cancels a
run, and the hc host reads a killed terminal as cancelled.

## Rejected

- **`on-finish`, closing failures too** — a failed run's workspace is exactly
  the one to read.
- **Reaping on a timer, or `cleanup` closing workspaces** — cannot tell read
  from unread; the reason ADR 0001 exists.
- **Closing by default, with a `keep` opt-out** — changes every existing
  automation, including those whose workspaces are their inbox.

## Consequences

- A closed run is reachable only through `history` and its worktree.
- A close that fails is logged; the run stays `done` and its workspace open.
