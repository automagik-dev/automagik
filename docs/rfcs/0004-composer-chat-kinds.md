# RFC 0004: Composer and chat kinds

| Field | Value |
|---|---|
| Status | Accepted |
| Milestone | 2. One message box |
| Lanes | plugin (3.N.P) |
| Created | 2026-10-30 |

## Summary

One message box serves every kind of chat. Each kind turns pieces on or off. A kind may have no
input box at all. The box gets a two-row layout, quiet controls, a model picker with a provider
column, a status line, a queue, an approval card and a "where it runs" strip. It ships in small
slices, each complete for users.

## Motivation

Today each chat surface grew its own box. Controls misalign (#88), the queue dock overlaps the
box (#91), the model dock can crash (#153), and approvals stall or repeat (#136). A design mock
covers the target (private link available on request).

## Design

### Chat kinds

| Kind | Input box | Git and folder | Level | Model picker | Voice |
|---|---|---|---|---|---|
| Genie Simple | yes | project name, versions, Publish (RFC 0005) | yes | yes | dictation |
| Genie Advanced | yes | folder, machine, branch, worktree | yes | full route | dictation |
| Omni | yes | none | none | small model name | dictation |
| DSH bot | yes | folder, mode | yes | model and thinking | dictation |
| Bot (friendly) | yes, with suggestion chips | none | folded | folded | dictation, realtime voice |
| Herdr | **none** | folder (RFC 0006) | Bot's | agent's own | none |

- A kind is a client-side description: which pieces it shows. `input: false` is allowed, and
  then the chat area is the kind's own view. Herdr is the first such kind.
- Realtime voice is only in the friendly Bot kind. Omni gets dictation only (owner decision).
- Simple or Advanced is set per Genie, and new Genies start Simple (owner decision, RFC 0005).
- A Session's kind is derived from its Bot type and, for Genie, the Genie's mode. Nothing new is
  stored per Session.

### Layout and controls

- **Two rows.** The text field on top, the controls in their own row below. The placeholder
  fits on one line. At narrow widths (a task worker pane) chips keep their glyph and model name;
  the rest moves into their menus.
- **Quiet controls.** Level, model and attach are small chips. They open menus; they never
  show text the user did not ask for.
- **Picker.** Providers in a left column, their models in the middle. Below: Harness,
  Connected by (RFC 0003) and Thinking. Only routes and levels the pick really has are shown.
- **Status line.** While a turn runs, a line shows the activity, elapsed time and tokens, with
  Stop.
- **Queue.** A message typed during a turn waits in a queue shown above the box, with a count.
- **"Where it runs" strip.** Above the box for code kinds: the folder, the machine ("This
  computer" today; a web instance later, RFC 0008) and the branch or worktree.

### Approval card

The card docks above the box and shows the action and its target from host data, never from
model-written text. Its answers:

- **Reject** and **Allow once**, as today.
- **Allow for this task.** A grant scoped to one task id. It ends when the task ends and never
  carries to a new task.
- **Run this task on Auto.** Switches only this task to Auto. It needs a direct click in the UI.
  No model, tool or route can trigger it. Where Auto is not available, the card says so and the
  button is not shown.

### Serialized client PRs

The Bot team's `client.js` is a committed bundle. Every slice regenerates it, so parallel PRs
conflict. Composer PRs merge one at a time; each rebases on `dev` and rebuilds `client.js`.

## Contracts introduced

- Kind ids: `genie-simple`, `genie-advanced`, `omni`, `dsh-bot`, `bot`, `herdr`. Client-only.
  Compatibility: existing Sessions map to a kind from their Bot type; nothing migrates.
- Task grants, scoped `task:<taskId>`, kept with the task's record. Compatibility: new; no
  existing grant changes, and a task grant is deleted when its task ends.

## Threat model

The approval card raises privilege, so it is a trust boundary.

- **Who can reach it.** Only the owner's click in the UI answers it. The answer is sent through
  an authenticated owner route.
- **What it can do.** "Allow for this task" allows one kind of action for one task. "Run this
  task on Auto" raises one task to Auto. Neither reaches other tasks or the Bot's own level.
- **Injection.** Card text comes from host data. A model cannot word a card, press it, or start a
  task that inherits a grant.
- **Undo.** Grants end with the task. The owner can revoke a task grant from the card's menu.

## Deliveries

Each slice is plugin lane, serialized as above. Slices 1 to 6 are milestone 2, after the
browser work and everyday fixes of milestone 1.

1. **Two-row layout.** The fix for #88 and #91. Check: screenshots of every kind at full and
   420 px width. Rollback: revert.
2. **Kind registry and quiet controls.** Check: each kind shows exactly its pieces; an
   input-less test kind renders its view. Rollback: revert.
3. **Status line and queue.** Check: a message typed during a turn queues and sends after it.
   Rollback: revert.
4. **Picker.** Needs #153 fixed and RFC 0003 delivery 1. Check: every route shows its
   Harness and Connected by. Rollback: revert to today's picker.
5. **Approval card.** With the task-scoped grant on the host. Check: a grant ends with its task
   and is absent in a new task; a tool cannot trigger "Run this task on Auto". Rollback: revert;
   leftover task grants expire with their tasks.
6. **"Where it runs" strip.** Check: folder, machine and branch match the Session. Rollback:
   revert.
7. **Genie kinds.** Needs RFC 0005. Tracked with a cross-repo issue, in milestone 4.

## Open questions

1. **Do a task's workers inherit "Allow for this task"?** Recommended: no. Each worker asks for
   itself; the grant names one task id.
2. **Herdr kind in this milestone?** Recommended: no. The registry allows input-less kinds now;
   the Herdr kind itself waits for RFC 0006.

## Links

- #88, #91, #136, #153
- [0003](0003-model-routes-and-acp.md), [0005](0005-workspace-and-genie-projects.md),
  [0006](0006-herdr-terminal-mode.md)
