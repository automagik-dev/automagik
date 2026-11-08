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
workspace:

- TUI, `workspace: worktree | root`: `herdr workspace close <id>`. The worktree
  and its uncommitted files stay (measured 2026-11-04), so `cleanup` keeps its
  job.
- TUI, `workspace: existing`: `herdr tab close <tab_id>`, aimed at the tab this
  run created. The shared workspace and every other tab stay open. The space's
  tabs are read first; a run whose tab is the space's last one, whose tab is no
  longer listed, or whose tab list cannot be read closes nothing and says why in
  the log. Closing the last tab would close the space with it.
- hc, `workspace: worktree | root`: `hc kill` then `hc rm` on the run's
  terminal. The app removes the space itself once its terminal is killed
  (measured 2026-11-04).
- hc, `workspace: existing`: the same `hc kill` and `hc rm` on the run's
  terminal, but only while another terminal remains in the space. The app
  removes a tab when its last pane goes and the space with its last tab
  (`remove_pane` → `remove_tab` → `remove_space`), so a run whose tab is the
  space's only one closes nothing and says why in the log.

A run whose agent ended `blocked` is not closed: Herdr's `agent wait` counts
blocked as settled, so it is recorded `done` while waiting on a person. The hc
host instead fails a run that stays blocked past `blocked_grace_minutes`
(default 2, `-1` waits the timeout out) and ends that agent's terminal; like any
failure, its space stays open.

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
