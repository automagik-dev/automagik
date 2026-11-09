# RFC 0021: meter attribution

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); herdr (3.N.P) for ledger rows; meter (3.N.P, RFC 0017) for the crate |
| Created | 2026-11-09 |

## Summary

The owner wants to compare bots across agents: what a dev bot on Claude costs next to one on
dsh-tui, per role, per squad. Today the meter cannot answer: every usage row in an installed
store has `bot`, `role` and `squad` empty, and no row can be tied to a worker or a task. This RFC
decides, before any attribution code, where each of bot, role, squad, task and branch comes from
for every harness and for both workers and bot seats; the durable session-to-terminal record and
who writes it; how the store keeps attribution so history can be re-tagged; what the query
reports; the Herdr-side rows it needs; and the order of the deliveries, including where RFC
0017's meter lane must land for any of it to reach a machine. It builds on RFC 0018's
evidence-retention contract (b) and slice M3, and keeps its invariants.

## Motivation

A read-only discovery on one machine found why nothing is attributed. The causes stack:

1. **The sync could not find hc.** The sidebar ran `usagemeter sync` with a PATH that did not
   hold hc, so the meter saw no terminals, no labels and fell back to a stored machine id. Fixed
   on `dev` by the herdr patch in #798 (`meter.js`), which reaches machines with the next pack
   release.
2. **Workers carry other labels.** Worker terminals carry `worker.of` and `worker.role`, not the
   `bot` and `role` the meter reads (`hc.rs`), so no worker is ever tagged. Bot seats do carry
   `bot` and `role`, but every seat runs in the project root, so the meter's one rule (exactly one
   live terminal with the same harness and cwd, `sync.rs` `Attributor::actor`) finds several and
   gives nothing.
3. **Snapshot only, and no way back.** The meter sees only terminals alive at sync time. Usage
   whose terminal ended before a sync is never tagged, and the stored hourly rollups have no
   session key, so a tag learned later cannot be applied to them. History can be re-tagged only
   by a rebuild from the native logs, while they still exist.
4. **`squad` has no source.** No ledger and no registry field carries it; a pane label exists
   but is almost never set.
5. **The ledger reader is not wired.** `meter/usagemeter/src/ledger.rs` (from
   automagik-dev/usagemeter#6) resolves a session to a worker launch from Herdr's worker ledger.
   It is compiled, but nothing calls it.
6. **The ledgers have no session rows.** Herdr writes `workers.jsonl` and `attach.jsonl` under
   each project's app home and under the global one. Neither holds a `session` row on the
   measured machine (the briefing hook that writes them is not installed for seats started with
   `--append-system-prompt-file`), so Claude sessions cannot resolve through them. `ledger.rs`
   also reads only the global ledger, never a project's.
7. **dsh-tui logs no branch.** Its usage reaches the store with the branch null. A worker's cwd
   is its worktree, and the worker ledger records that worker's branch.

On the measured machine, wiring `ledger.rs` as written would tag only a small share of the rows
since the ledger began; adding a Claude worktree path and the per-project ledgers would tag most
worker rows, but not seats and not the hours before the ledger existed. Seats need a
session-to-terminal record. No figure from that machine is copied here.

## Decided

Carried, not new:

- From RFC 0018 (its Decided and invariants): no daemon and no resident poller, fork and exit;
  null or unknown is never shown as 0; no fabricated ids, so no task from a PR number or the digits
  of a branch name; session ids stay machine-local and never enter git-tracked state; a read never
  writes, creates or migrates; a contract change is a pull request here that genie reviews; task
  cost waits for M3.
- From RFC 0017: the crate ships only on the meter lane (its deliveries 4 to 6); cargo runs only on
  the build host, one build at a time, with `CARGO_BUILD_JOBS` capped; upstream is frozen after the
  import.
- From the Meter Captain's brief (2026-11-09), confirmed by the owner when this RFC is scheduled:
  ambiguity stays unknown and a bot is never guessed; anything captured comes from fork-and-exit
  runs (the sync) or from records Herdr already writes at start time.

Decided by Chat, 2026-11-09, for this RFC's six questions. They are technical, and they serve the
owner's ask to compare bots across agents:

1. **Squad** is the head of the launching bot's lead chain, frozen in the start row at launch (e).
   Decided by Chat, 2026-11-09: one rule for every bot, stable for history.
2. **Herdr chooses Claude session ids**, with `--session-id` on every fresh Claude launch (f).
   Decided by Chat, 2026-11-09: it removes the timing race for the best-covered harness.
3. **No earlier route to machines**: no upstream bridge release; attribution waits for RFC 0017's
   deliveries 4 and 6. Decided by Chat, 2026-11-09: a bridge would break the freeze RFC 0017 set.
4. **The backfill**: the operator runs it once per machine after delivery 7, back to the oldest
   ledger row; earlier hours stay unknown. Decided by Chat, 2026-11-09: explicit and bounded.
5. **dsh-tui seats stay unlinked for now.** Decided by Chat, 2026-11-09: no record ties them to a
   terminal, and DSH's live session index is a private file whose format may change. Later,
   either DSH records the terminal it runs in, or Herdr labels a dsh-tui pane with its session id
   when it learns it (a resume), which (f) 5 then writes as a session row.
6. **Linked-machine panes are unknown** until a fleet query is designed (RFC 0018's question 3):
   such a launch has its rows on one computer and its logs on another. Decided by Chat,
   2026-11-09: neither meter can link it without guessing.

Proposed here: everything else.

## Design

### Words

- A **launch** is one agent started by Herdr in one terminal: a worker (on a task worktree) or a
  seat (a bot's long-lived pane). It is keyed by `(core, terminal, created_ms)`, the attach
  ledger's key, because hc reuses terminal ids after a restart.
- A **link** says a session ran in a launch over a half-open interval `[valid_from, valid_to)`.
- A **basis** says how a call was tied to a launch, strongest first: `session` (a Herdr row names
  the session), `label` (an hc label seen at a sync named it), `worktree` (the call's cwd is the
  worktree of exactly one logged launch), or none.

### (a) Where each field comes from

The rule for every harness: find the launch a call belongs to, then read the fields from that
launch's start row, frozen at launch time. Labels and the registry as they are today never
overwrite what the start row recorded.

**Finding the launch, per harness.**

| Harness | Worker | Seat |
|---|---|---|
| claude | session (start or session row); label; worktree | session (start or session row); label |
| codex | worktree; label (`revive.session`) | label; session row when Herdr learns it |
| omp | worktree; label (`revive.session`) | label; session row when Herdr learns it |
| dsh-tui | worktree (the header's `cwd`) | none yet (Decided, 5) |
| agy | later: the conversation's workspace folder | later |

- **Claude** sessions are the best covered: Herdr can choose a new Claude session's id itself
  (`--session-id`, (f)), so the start row names the session and no timing is involved. A
  `/clear` or `/resume` inside the pane is a new session row (the briefing hook, restart, resume),
  and the hc `agent.session` label seen at a sync is a second witness. A Claude worker that no row
  names falls back to the worktree path, as codex's does (new for Claude: `ledger.rs` gives
  Claude only the session path today).
- **codex and omp** workers resolve by worktree, as `ledger.rs` does. Their seats share the
  project root, so the worktree path can never tell them apart: they need a session id, from the
  `revive.session` or `agent.session` label seen at a sync, or from a session row Herdr writes
  whenever it sets that label (f).
- **dsh-tui** workers resolve by worktree from the session header's `cwd`. A dsh-tui seat has no
  session-to-terminal record yet; Decided 5 says how one could come.
- **agy** is later: the meter has no agy source yet. Its conversations record their workspace
  folder, so its workers resolve by worktree once Herdr launches agy workers with start rows.

**The fields, once the launch is found.**

| Field | Worker | Seat |
|---|---|---|
| bot | start row `botId` | the attach ledger's binding for the launch; else start row `botId` |
| role | start row `role` (`dev`, `test`, `review`, `fix`) | start row `role` (new): `roleOf` |
| squad | start row `squad` (new, (e)) | start row `squad` (new, (e)) |
| task | start row `task` with `project`, when started with `--task` | always null |
| branch | the log's branch; else start row `branch` | the log's branch; else null |

- A new `kind` (`worker` or `seat`) is kept beside `role`, so a seat's role (`main`, `captain`, a
  rank) and a worker's role never share one column by accident.
- **Task** comes from the start row only when Genie passed `--task`, joined on (project, task) as
  `ledger.rs` does. Today no start row carries one. Task intervals from genie's `tasks.jsonl` and
  link events stay RFC 0018 M2 and M3's; this RFC adds the start row as one more piece of evidence
  and nothing else.
- **Branch for dsh-tui (and omp)**, whose logs carry none, is filled from the worker's start row
  when the call resolves to a worker launch, on any basis, with `branch_basis: ledger`. A branch
  the harness logged (Claude, a Codex thread) is `branch_basis: log` and is never replaced. Never
  from git on today's checkout and never from another harness's session at the same hour. Calls
  that resolve to no worker (seats, ambiguous worktrees) keep the branch null and stay in RFC
  0018's `unattributed`. This amends RFC 0018 (a), which matched branches only against the log or
  the Codex thread; its matching sentence and its "Usage with no branch" rule say so too.

**What stays unknown.** A call with no claimant is `unlinked`; one with two claimants that differ
is `ambiguous`. Both are kept as such, counted, and never given a bot.

**The resolution rules** (carried from the review of automagik-dev/usagemeter#6, all binding):

- *Collapse equal tags.* Several claimants whose attribution fields are equal (bot, kind, role,
  squad, task, project, branch) give that tag, not `ambiguous`: a worker restarted on its own
  worktree is still that worker. Fields that are only requested (agent, model, effort) do not have
  to agree; when they differ the result keeps none of them.
- *"Never wrong" holds only for logged launches.* A launch with no start row (a hand-started
  `hc run`, a start whose ledger append failed, a machine whose ledger is not read) is invisible
  to the ledger. Two guards: a live harness terminal seen at a sync in the same cwd with no start
  row counts as a claimant from its `created_ms` for as long as it was seen, so the worktree path
  turns ambiguous instead of wrong; and every answer carries its basis, so `worktree` is never
  presented as strongly as `session`. What remains, an unlogged launch that ended before any sync,
  is accepted and written down here.
- *A start comes before its session row.* Today a seat's start row is written after `hc run`
  returns, so the briefing hook can write the session row first, and `ledger.rs` (latest start on
  the terminal whose `at` is not after the row's) would then miss it. Pinned: a launch is valid
  from its terminal's `created_ms`, which start rows will carry (f), not from the row's write time.
  A session row on a terminal counts from its own `at`, compared with that `created_ms`, whatever
  the file order. A new Claude launch with a Herdr-chosen id has no race at all.
- *codex and omp coverage is thin; improved, then accepted.* Every Herdr launch is a new terminal
  and the worker ledger has no end rows, so a launch never ends in the ledger's eyes: after a
  restart on the same worktree, or any second seat in a folder, the old launch is a claimant for
  good and the folder stays unmatched. Improved by end evidence, best first: an `end` row Herdr
  writes when it stops or replaces a terminal (f); the attach ledger's `detach` and `end` rows for
  seats; and the hc snapshot at each sync, where a terminal with `finished_ms` ends there, and one
  that is gone ends somewhere between the last sync that saw it and the first that did not. A call
  inside such a gap, with another claimant, stays ambiguous. Accepted: a seat that starts and ends
  between two syncs with no session row is unlinked.

### (b) The session-to-terminal record

Three ways to get it:

| | A. Herdr rows at start time | B. hc label snapshot at sync | C. Both |
|---|---|---|---|
| Durable for ended terminals | yes | only if seen alive once | yes |
| Catches in-pane session changes | when the hook or the CLI writes a row | at the next sync | yes |
| Sees unlogged launches | no | yes, as claimants | yes |
| New process | none: the CLI that starts the pane writes it | none: sync's `terminal.list` | none |

**Recommended: C.** The ledger is the authority, the snapshot the second witness. They never vote:
when the two disagree about one interval, that interval is ambiguous.

The meter folds both into two tables in its state folder (mode 0600, machine-local), as RFC 0018
(b) evidence with validity intervals.

`launch`, one row per launch:

| Field | Meaning |
|---|---|
| `core`, `terminal`, `created_ms` | the key |
| `kind`, `bot`, `role`, `squad`, `lead`, `task` | from the start row; null when not recorded |
| `project`, `branch`, `worktree`, `agent` | the same |
| `valid_from` | `created_ms`; the row's `at` for an old row without it |
| `valid_to`, `end_basis` | null while open; `end_row`, `replaced`, `finished`, `detached`, `gone` |
| `gone_after` | for `gone`: the last sync that saw it live; it ended in `[gone_after, valid_to)` |
| `source` | `ledger` (the ledger's hash and the row offset), or `snapshot` for an unlogged launch |

`link`, one row per session in a launch:

| Field | Meaning |
|---|---|
| `harness`, `session` | the session, as RFC 0018's keyed hash, never the raw id |
| `core`, `terminal`, `created_ms` | the launch |
| `valid_from`, `valid_to` | half-open; `valid_to` null while open |
| (closing) | the launch's end, or a later link of the session elsewhere (`/resume` in a new pane) |
| `basis` | `session` (start or session row), `label` (snapshot), `worktree` |
| `seen_first`, `seen_last` | for `label`: the syncs that saw it; later ones only move `seen_last` |
| `superseded_by` | kept marked, never deleted, so a rebuild replays the same answer |

A `label` link proves the session ran in that launch at the sync that saw it. It is valid from the
later of the launch's `created_ms` and the session's first call, up to the launch's end; where
another link of the same session covers part of that span, the overlap is ambiguous.

- **Reading the ledgers.** Each sync reads, from an offset it keeps per file (the head-hash rule
  logs already use), the global app home's ledgers, `$HERDR_WORKERS_LEDGER` when set, and each
  project app home (`.herdr/app-home/automagik-herdr/`) found by walking up from the cwds of the
  sessions it is attributing: only that ancestry, never a scan of the disk. Rows naming another
  machine (`machine` set in the attach ledger) are skipped: their usage is in that machine's logs.
  A ledger that is group- or world-writable is not read, by the rule `attach.js` already applies,
  and the source reports it.
- **The snapshot** is what `terminal.list` already returns at sync, now read for `worker.of`,
  `worker.role`, `bot`, `role`, `squad`, `agent.session` and `revive.session` too. A snapshot only
  extends rows it already has, so the tables grow per launch and per session, not per sync.
- **Retention**, RFC 0018's: links and launches 400 days; per-call evidence 90 days or 1 GiB,
  whichever comes first. Before `evidence_from`, the rollups keep their frozen columns for the
  doc and `status`, but a query counts that usage as `tokens_before_evidence`, never as attributed
  (d).

### (c) The store change

| | C1. Session column in rollups | C2. Per-call evidence, derived | C3. Join at read time |
|---|---|---|---|
| Re-tag later | per session-hour | per call, exact interval bounds | yes |
| Store growth | rows × sessions | RFC 0018 (b)'s, bounded | none |
| Read cost | as today | as today | a join over evidence on every query |
| Fits RFC 0018 | duplicates M3 | is M3's evidence table | breaks the warm-query ceiling |

**Recommended: C2**, as part of M3:

- The per-call evidence of RFC 0018 (b) holds the session (keyed hash), the time in ms, the cwd
  and the branch as logged. That is the session key the rollups never had.
- Attribution is derived, never typed in: per call, the launch and basis its session's links give
  at the call's time, and the fields that launch recorded. It is stored as columns of the evidence
  row (`bot`, `kind`, `role`, `squad`, `task`, `filled_branch`, `basis`, `ambiguous`) so a query
  reads it without a join.
- `sync` recomputes attribution only for the sessions whose links or launches changed in that run,
  in the same chunked transactions as ingestion, under the read budget.
- The hourly rollups keep their key, extended with `kind`, `basis` and `branch_basis`. Their actor
  columns become a cache of the evidence: when a call's attribution changes, `sync` moves its
  tokens from the old rollup key to the new one in the same transaction. Before `evidence_from`
  the rollups are frozen, and an empty actor there means unknown. `branch_basis` stays on them
  after the evidence is pruned, so a filled branch is still told apart from a logged one.
- The store's `schema_version` goes from 2 to 3 for the evidence, `launch` and `link` tables, with
  RFC 0018 (d)'s migration rules: a generation first, the free-space refusal, one transaction.

**History.** Re-tagging the past is a rebuild from the native logs, and it is
`usagemeter sync --evidence-backfill --days <n>` from RFC 0018 (b), now also recomputing
attribution: explicit, bounded by the retention and the read budget, chunked and resumable, a
generation kept first, never automatic and never on a read. The operator runs it once per
machine after attribution ships, back to the oldest ledger row (Decided, 4). What stays
unknown for good: hours before the ledgers existed, logs already deleted, and calls whose session
no record names.

### (d) What the query reports

Contract 1's branch rows keep their meaning. Additive, so genie reads them only when it asks:

- **`--by bot`.** One row per `(bot, kind, role, harness)` with usage in the repo and window
  (branches optional as a filter), with `squad`, the same `tokens`, `cost`, `activity` and
  `incomplete_sources` as a branch row, and `attribution.precision: actor_interval`. This is the
  row that compares bots across agents.
- **Per row, on every row kind**, an optional `attribution.actor` object with four counts that
  add up to `tokens.total`: `tokens_attributed`, `tokens_ambiguous`, `tokens_unlinked` and
  `tokens_before_evidence` (below). Then `tokens_by_basis` (`session`, `label`, `worktree`),
  which adds up to `tokens_attributed`: how calls were tied to a launch. A bot row holds only
  attributed usage, so its other three counts are 0; the rest is in the envelope (below).
- **Where the branch came from** is its own count, apart from how the call was tied:
  `tokens_by_branch_basis` (`log`, `ledger`, `none`), which adds up to `tokens.total`. On a branch
  row `none` is always 0, and `ledger` is the usage whose branch was filled from a start row.
  A Claude call tied by worktree still has its branch from its log, and a dsh-tui call tied by
  session still has its branch from the ledger, so neither basis stands in for the other.
- **In the envelope**, `actor_unattributed` beside `unattributed`: the repo's ambiguous, unlinked
  and before-evidence tokens in the window, with their harnesses and a reason for each part
  (delivery 2, D5). A bot row is a lower bound whenever any of it is above zero, and a reader
  shows "at least". Branch rows' `attribution.coverage` keeps RFC 0018's meaning (usage with no
  branch) and is never moved by the actor share.

**A window that straddles `evidence_from`.** Two rules would keep "unknown is never 0":

| | A. A fourth count, `tokens_before_evidence` | B. The whole `actor` object null |
|---|---|---|
| The sum | holds: four counts add up to `tokens.total` | no sum: nothing is reported |
| d30 in M3's first 30 days | the attributed part shows, as a lower bound | no actor data at all |
| After the 1 GiB bound prunes | the same, the pruned part counted | none until the window clears |
| Reader's rule | "at least", as for any partial row | unknown |

**Recommended: A.** Every d30 window straddles `evidence_from` for the first 30 days after M3
lands, and again whenever the size bound prunes evidence, so B would hide all actor data exactly
when the owner first compares bots. A keeps the sum exact and says how much is unvouched. The
part before `evidence_from` is never counted as attributed, even where frozen rollup columns
name a bot, because it can no longer be replayed. A window wholly before `evidence_from` has
every token in `tokens_before_evidence` and 0 in each other count, which is a measured 0, not an
unknown one.

`attribution.precision` is `"branch_window"` alone in the v1 schema. RFC 0018 says widening a
type is breaking once a release carries contract 1, and M3 already plans `task_interval`. No
release carries the meter yet (`NEVER_SHIPPED` holds `meter/`), so **recommended**: widen the
enum to `branch_window`, `task_interval`, `actor_interval` and add the optional fields above in
one schema pull request now (delivery 2), before RFC 0017's delivery 4 cuts the first meter
release. Otherwise the same change makes contract 2. Either way genie reviews it.

### (e) Squad

| | A. Lead chain, frozen at launch | B. The pane's `squad` label | C. Defer |
|---|---|---|---|
| Source | the registry's `lead` links | a free label copied from the lead's pane | none |
| Stable for history | yes, written in the start row | only while the label is set | n/a |
| Meaning | one rule for every bot | whatever whoever set it meant | n/a |

**Decided: A** (Decided, 1). Herdr writes `squad` in every start row: the id of the bot heading the
launching bot's chain of effective leads (the last bot before the main bot, by the registry's
`lead` and the pack's `effectiveLead`), the bot itself when it leads others and reports to the main
bot, and null for the main bot. It is frozen at launch, because the registry changes. The pane
label stays a display hint the meter only records in the snapshot. Named squads (a `squad`
field in the registry, copied into the start row) would need a later amendment.

### (f) Herdr-side changes

For the Herdr Captain's review. All are additive to `workers.jsonl`, whose other reader in the
pack (`reapCandidates`) reads `start` rows only and ignores unknown fields:

1. **Start rows gain `core` and `created_ms`**, from the `hc get` the CLI already does, on every
   path that writes one (start, attach, restart, `--tree`, resume).
2. **Claude launches get their session id from Herdr.** A fresh Claude launch is started with
   `--session-id <uuid>` that the CLI chooses, and its start row records `session`. A resume
   records the resumed id. The flag is checked against the pinned Claude Code version first, as
   `models.js` does for every flag.
3. **Seat start rows record `role`** (the pane role `roleOf` gives at launch) **and `lead`**;
   every start row records **`squad`** per (e).
4. **An `end` row** (`event: "end"`, the launch key, `reason`, `at`) when the CLI stops or replaces
   a terminal (stop, restart, `--tree`), and from the worktree sweep when it finds a worker's
   terminal finished.
5. **A session row whenever Herdr sets a session label** (`agent.session`, `revive.session`) for
   any harness, so codex and omp seats get one at the moment Herdr learns the id. The briefing
   hook's session rows keep working for in-pane changes; its install for seats started with
   `--append-system-prompt-file` is checked.
6. **Ledger files are created 0600**, like the attach ledger, because the meter refuses a group-
   or world-writable one.
7. The usage-tagging comment in `workers.js` says the meter reads the ledger first and the labels
   as a second witness.

These ride the herdr lane and reach machines with the next pack release, well before the crate.
That is on purpose: rows written from then on are durable, so attribution can cover them when the
meter arrives.

### What changes in the crate

For orientation; each delivery says its own scope. `hc.rs` reads the new labels and records the
snapshot; `ledger.rs` reads several ledgers, `created_ms`, `end` rows, the attach ledger and
session rows on every harness, collapses equal tags and gives Claude workers the worktree path;
`sync.rs` replaces `Attributor::actor` with the derived attribution; `store.rs` gains the tables;
`sources/dsh_tui.rs` fixes forks (below); `query.rs` adds (d).

**dsh-tui forks.** A forked session starts with copies of its parent's rows, ids included. The
store's dedupe counts each call once, but the event carries the session of whichever file was
read first, so a copied call can be credited to the fork. Fixed: a line before
`session/end-seed {inherited: true}` is a copy. Its call's evidence takes the session of the
non-copied read (the parent's file) whenever that file is read, whichever comes first; when the
parent's file is gone, the session the fork's header names as its seed, if DSH records one
(checked against DSH's format in delivery 4); else the session is unknown and the call is
`unlinked`, never the fork's.

## Contracts introduced

- `workers.jsonl`: start rows gain `core`, `created_ms`, `session` (Claude), `squad`, and on seats
  `role` and `lead`; a new `end` event; files created 0600. Additive: old rows still read, with the
  row's `at` as `valid_from` and no end.
- Herdr starts a fresh Claude launch with a session id it chooses (`--session-id`).
- The meter reads `worker.of`, `worker.role`, `agent.session` and `revive.session` from hc and
  reads the attach ledger. `workers.js`'s label contract is unchanged; the ledger outranks it.
- The meter's store: `schema_version` 3, with evidence, `launch` and `link` tables, and `kind`,
  `basis` and `branch_basis` on the rollups. Private to the meter, migrated by `sync` alone under
  RFC 0018 (d).
- Query contract 1, additive: `--by bot`, `attribution.actor` (its four counts,
  `tokens_by_basis`, `tokens_by_branch_basis`), `actor_unattributed`, and the
  `attribution.precision` enum widened before the first release that carries contract 1.
- Amends RFC 0018 (a): a branch may come from a worker launch's start row, with
  `branch_basis: ledger`, for a harness that logs none.
- Unchanged: the `herdr-meter` doc stays `schema_version` 2; its `tasks[].bots` simply fills in.

## Threat model

- **Who can steer attribution.** Anyone who can write a ledger can move usage between bots on that
  machine, never change its amount. Ledgers are the owner's alone (0600), a group- or
  world-writable one is refused, and paths inside rows are compared as strings, never opened.
- **Labels are weaker.** Any process that can run `hc label` can set a label, so a label is only
  the `label` basis and never outranks a ledger row; a disagreement makes the interval ambiguous.
- **Privacy.** Session ids are kept as keyed hashes in the state folder (0600). No session or
  terminal id reaches a query answer, the doc, git or any telemetry. Bot ids appear in a local
  query answer only, to a caller that could already read the store's folder.
- **No new process.** Nothing is added beyond the sync's existing hc call and file reads.
- **Undo.** Derived attribution can be dropped and recomputed from evidence and links. A generation
  is kept before the migration. Reverting the Herdr rows leaves extra fields that old readers
  ignore.

## Deliveries

Each is one pull request with an independent review. Order: 1, then 2 and 3 in parallel; 4 after
3; 5 after 4 and with RFC 0018's M3 (it is M3's evidence table); 6 after 5; 7 is RFC 0017's; 8
after 6 and 7. RFC 0017's delivery 4 (the meter lane) is scheduled right after this RFC merges,
in parallel with deliveries 2 and 3; delivery 2 still merges before it cuts the first meter
release.

1. **This RFC** (docs; cuts nothing).
   *Check:* `bun scripts/lane.ts ships` on the merge says no.
2. **The contract** (`meter/schema/query/v1/`; ships nothing). The widened
   `attribution.precision`, `attribution.actor` with its four counts, `tokens_by_basis` and
   `tokens_by_branch_basis`, `actor_unattributed` and `--by bot`, with examples: a bot row, an
   ambiguous share, a window straddling `evidence_from`, a ledger-filled branch. Merges before RFC
   0017's delivery 4. genie reviews.
   *Acceptance (genie's D1 to D5, required):* this is the last schema change before the first
   meter release, so D1 to D5 are settled here; any one left open costs a contract 2 later.
   - D1: v1 rows are keyed by branch, so a `--by bot` row fits none of them. The schema picks
     one, before the first release: a second row definition chosen by `attribution.precision`
     (`oneOf`), or a nullable `branch` (a widening, allowed only now). `by` is added to the query
     echo and to `request_sha256`.
   - D2: branch rows always carry `attribution.precision: branch_window`, whatever `--by` asks.
   - D3: `attribution.coverage` keeps RFC 0018's meaning (usage with no branch). The actor share
     is reported through `attribution.actor` and `actor_unattributed` only, never through
     branch-row coverage or its vouched zero.
   - D4: task rows get a join key that keeps same-id tasks from different checkouts of one repo
     apart (genie mints its short ids per clone): such tasks are refused or marked ambiguous, or
     genie makes its ids unique per repo. Delivery 2's enum and M3's task row agree on it.
   - D5: `actor_unattributed` gives distinct reasons for usage whose launch row is on another
     machine (Decided, 6) and for dsh-tui seats (Decided, 5), so a card can say why.

   *Check:* every example validates, and the crate's contract test passes on the old ones.
3. **The Herdr rows** (herdr patch). (f) 1 to 7. The Herdr Captain reviews.
   *Check:* on a temp app home with a fake hc: a seat start row carries `core`, `created_ms`,
   `role`, `lead` and `squad`; a Claude start carries `--session-id` and the same id in its row;
   a restart writes an `end` row for the old launch; a new ledger is 0600; `reapCandidates` gives
   the same answer as before on a ledger holding `end` rows.
4. **The resolver** (crate; ships nothing until 7). `ledger.rs` per (a): several ledgers, the
   attach ledger, `created_ms` and `end` rows, equal tags collapsed, the Claude worktree path,
   session rows on every harness; `hc.rs` reading the new labels; the dsh-tui fork fix.
   *Check:* synthetic ledgers and logs: a dev and a reviewer on one worktree are ambiguous; a
   worker restarted on its own worktree keeps its tag; a seat in the project root is unlinked with
   no session row and tagged with one; a session row written before its start row still links; a
   fork's copied call is the parent's whichever file is read first; an unlogged live terminal in
   the worktree makes the call ambiguous.
5. **Evidence and links** (crate; with M3). The `launch` and `link` tables, the snapshot at sync,
   derived attribution, the rollup cache, the dsh-tui and omp branch fill, and schema 3 under RFC
   0018 (d).
   *Check:* RFC 0018's interrupted-backfill and rebuild ceilings hold; a launch learned after its
   usage was ingested moves that usage to its bot on the next sync, and the rollups agree with the
   evidence; no session id appears in any output.
6. **The query** (crate). (d): `--by bot`, `attribution.actor`, `actor_unattributed`, and the
   backfill recomputing attribution.
   *Check:* the delivery 2 examples are reproduced from synthetic stores; a window straddling
   `evidence_from` puts the part before it in `tokens_before_evidence`, and the four counts add up
   to `tokens.total`; a dsh-tui worker's filled branch counts under `ledger`, a Claude worker's
   logged branch under `log`.
7. **Reaching machines** (RFC 0017's deliveries 4 to 6). Deliveries 4 to 6 here ship nowhere until
   RFC 0017's delivery 4 (the meter lane) cuts a meter release and delivery 6's first step moves
   the pack's pin to it. Its delivery 5 (keys) and the rest of 6 (the signed pointer) follow on
   their own; attribution does not wait for them. Delivery 2 here must merge before RFC 0017's
   delivery 4.
   *Check:* a machine that took the pack release runs a meter whose `query --by bot` answers.
8. **The backfill** (the operator, per machine). `usagemeter sync --evidence-backfill` back to the
   oldest ledger row.
   *Check:* `actor_unattributed` falls for the backfilled hours; rows before the ledger stay
   unknown.

agy follows once the meter has an agy source and Herdr launches agy workers with start rows.

## Open questions

None. The six questions this RFC asked were decided by Chat on 2026-11-09 (Decided, 1 to 6).

## Links

- RFCs: [0017](0017-usagemeter-crate.md), the crate, the meter lane (deliveries 4 to 6) and the
  build rule; [0018](0018-meter-query-contract.md), the query contract, the evidence contract (b),
  slice M3 and the invariants; [0014](0014-shared-bot-registry.md), the shared Bot registry.
- Pull requests: #798 (the sync finds hc); automagik-dev/usagemeter#6 (the worker-ledger reader
  and its review).
- Crate: `meter/usagemeter/src/ledger.rs`, `sync.rs` (`Attributor`), `hc.rs` (`LiveTerminal`),
  `store.rs` (`usage`, `sessions`), `sources/dsh_tui.rs`, `query.rs`;
  `meter/schema/query/v1/envelope.schema.json`.
- Herdr pack: `herdr/mods/am-sidebar/workers.js` (labels, `startRow`, `sessionRow`), `attach.js`,
  `launchArgs.js` (`roleOf`, `paneLabels`, the squad label), `model.js` (`effectiveLead`),
  `briefing.mjs`, `restart.js`, `models.js`, `meter.js`, `bin/automagik-herdr.mjs` (`appendLedger`).
