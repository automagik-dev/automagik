# RFC 0026: bot-tag coverage

| Field | Value |
|---|---|
| Status | Queued |
| Milestone | none (ships outside the five milestones) |
| Lanes | none here (docs); meter (3.N.P); herdr (3.N.P) for the fleet step; DSH upstream |
| Created | 2026-11-10 |

## Summary

RFC 0021's deliveries 2 to 6 give the meter the means to say who a call belonged to, or why it
cannot say. This RFC turns that into the number the owner's goal needs: the share of a store's
usage that names a bot, per window, with every unattributed class broken out. It fixes the
definition (the unit, the denominator, the window, per bot, and the fleet), says where the number
is reported without changing query contract 1, and closes or narrows the five classes as far as
durable records allow: worker labels, dsh-tui seats and linked machines (RFC 0021's Decided 5 and
6, reopened by the owner on 2026-11-10), and history from the native logs. It sets the tests and
the before and after measurement, and it names what stays unknown. No query-contract and no
store-schema change is needed; RFC 0021 is amended in the same pull request. Chat ruled its four
C questions and genie acked its four G ones on 2026-11-10.

## Motivation

Issue #897 owns the outcome. The meter can now attribute usage to a bot (RFC 0021), but the
outcome is a number the owner can watch move toward the 30-day goal, and today only about 12% of
usage rows carry a bot tag. That 12% is not the number this RFC defines, and the difference
matters:

- **What 12% counted.** A row of the hourly rollups carrying a non-null `bot`, written by the
  old live-terminal rule (`Attributor::actor`), with no evidence behind it. RFC 0021 (c) forbids
  counting such a frozen tag as attributed: it can never be replayed. So the new metric's
  baseline must be measured with the new definition, not compared with the old figure.
- **What the meter can now say.** RFC 0021 delivery 2 put four counts on every row and on every
  answer, `attributed`, `ambiguous`, `unlinked` and `before_evidence`, the last three with a
  reason; delivery 6 (PR 875) fills them from per-call evidence. The four counts always add up to
  the row's tokens, so the coverage share is arithmetic over a shape that already exists.
- **Why it is low, class by class.** The causes are the ones RFC 0021's Motivation names, and
  they are now separable: a worker terminal carries `worker.of` and `worker.role`, not `bot`
  and `role`, and an unlogged worker names nothing; bot seats share the project root, and a seat
  has no session record until something writes one; history before the evidence has no per-call
  key to re-tag it. The five reasons of `actor_unattributed` are exactly the places to look:
  `claimants_differ`, `no_record`, `dsh_tui_seat`, `other_machine` and `before_evidence`.
- **Two decisions came back.** The owner reopened RFC 0021's Decided 5 (dsh-tui seats stay
  unlinked) and Decided 6 (linked-machine panes are unknown) on 2026-11-10: both are tagged. The
  mechanisms, their owners and their limits are this RFC's (d) and (e); RFC 0021's own text is
  amended in the same pull request.

## Design

### Words

- A **store** is one meter database on one machine: the unit a query answers for, and the unit
  the local report prints.
- A **class** is one of the five reasons with its state: `claimants_differ` (ambiguous), the
  three unlinked reasons, and `before_evidence`.
- **Bot coverage** (the report's `bot_coverage`) is the share of a store's counted tokens in a
  window that names a bot, with the classes as its complement. It is not the contract's
  `attribution.coverage`, which is about branches; the names stay apart on purpose. The
  **inspected** share is the same numerator over the usage that is not before evidence: a
  diagnostic, never the headline.
- The **horizon** is the oldest moment a backfill can re-tag: the later of the evidence bound and
  the oldest launch or link record.
- The **fleet** is the stores the person linked; it is a reader's sum, not a meter in one store.

### (a) The metric

**What is counted.** Every row of the `usage` table whose `repo` is one of the repos the answer
names (or any repo, store-wide) and whose hour falls in the answer's effective window, whatever
its branch, with `tokens.total` above zero. That is the same row set `query` reads for a repo, so
the two cannot drift. The rows partition into RFC 0021's four counts:

| Count | What it holds |
|---|---|
| `attributed` | one launch names a bot, or several whose tags are equal |
| `ambiguous` | two claimants differ, or a claimant cannot be read (`claimants_differ`) |
| `unlinked` | no launch names a bot: `no_record`, `dsh_tui_seat`, `other_machine` |
| `before_evidence` | before `evidence_from`, or all of it while it is null |

The classes are also the work list: `no_record` is (c)'s worker labels, `dsh_tui_seat` is (d)'s
terminal record, `other_machine` is (e)'s fleet number, and `before_evidence` is (f)'s backfill;
`claimants_differ` falls as those records separate launches that used to be guessed between.

- `total` is their sum. `bot_coverage = attributed / total`, a fraction in `[0, 1]` rounded to
  four decimals; **null**, never 0, when `total` is 0 (no usage in the window, a `missing` row's
  case). The classes' shares are `part / total` and are not rounded to 0 while above 0.
- `inspected = attributed / (attributed + ambiguous + unlinked)`, null when that denominator is
  0, and `inspected` is printed beside the headline, always marked as the diagnostic.

**The unit is tokens, not rows and not cost.** A row-based share would weigh a 10-token call like
a 10-million-token one; a cost-based one would drop the usage of models the price table does not
know (`cost.state: unpriced`), exactly the usage a coverage number must not lose. Tokens are the
store's own unit, every token kind is counted, and the four counts already add up to them.

**The window** is contract 1's: `d1`, `d7` or `d30`, clipped to `counted_from`, ending at the end
of the hour that holds the watermark (`generated_at`'s hour while it is null). The report prints
all three windows in one run, because they answer different questions: `d1` freshness, `d7` the
mechanism inside the evidence bound, `d30` the outcome. The report prints `window` beside each,
so the same number is never read against a different window.

**Evidence, and the two states that change the reading.** The report prints `evidence_from` and
whether the window is wholly at or after it (`full`), starts before it (`partial`), or has none
(`none`). With `none`, bot coverage is 0 by RFC 0021's rule (every token is before evidence, a
measured 0, not unknown), and the report says so in words, never as an unexplained 0%. With
`partial`, the headline includes the part the meter cannot vouch for, and `inspected` is the part
it can.

**Per repo and overall.** Each repo gets its four counts and its ratio; the overall number is
computed over the summed tokens, never as the mean of the repos' ratios. A repo with no usage is
`no_usage` with a null ratio, never a 0. `repos_shown` and `repos_omitted` bound the list (50 at
most, the rest summed into `other`), and every total includes every repo.

**Per bot.** A bot's line is its attributed tokens, its `share` (its tokens over the same
`total`), and its tie mix (`tokens_by_basis`). A bot's line sums the contract's bot-key rows for
one bot id and keeps their `unrecorded` fields visible, so a launch whose squad was not recorded
never hides behind one whose squad was. The sum of the bot shares is the bot coverage: the
per-bot lines are the numerator's split, not a second metric. The bot list is capped at 50
lines by tokens, with `bots_shown` and `bots_omitted`; every total includes every bot.

**A per-bot rate is not computable, and is not faked.** "Of this bot's usage, how much is
tagged" needs the usage the bot failed to get, and untagged usage names no bot; an ambiguous call
names several, and RFC 0021's rollups key it with a null bot. Claimant tags would have to be
stored per ambiguous row and reported, which is a store change and a contract addition; C1's
ruling says why this RFC does not build it. What the owner compares bots on (tokens,
cost, squad, harness) is complete without it.

**What is outside the denominator, and shown beside it.** Usage whose `repo` is null (a folder
that is not a checkout with a remote) belongs to no query answer, so it is not in the ratio;
`no_repo` prints its tokens and says so. Usage before the window is not counted. Usage whose
store is on another machine is another store's, summed by the fleet (e), never guessed here.

**The old figure, kept as a diagnostic.** `before_evidence_tagged` counts the tokens in
`before_evidence` whose frozen rollup still carries a bot tag: the old definition's residue. It is
never in the numerator; it exists so a reader can see the ~12% and the new number side by side
without believing bot coverage fell.

**A ratio is never a bound.** A ratio over an incomplete answer (`ingestion.complete` false, a
stale watermark, a clipped window) is the ratio of what is counted: uncounted usage can move it
either way, so it is printed as "over counted usage", with the flags beside it. Only token totals
are lower bounds ("at least"); the PR body never labels a ratio that way. A fleet number over
machines that did not answer says "over N of M machines", never "the fleet's coverage" (e).

### (b) Where it is reported

**Contract 1 already carries every count. No new field is proposed.** For a `--by bot` answer
that names no branch, RFC 0021 (d) makes the bot rows and `actor_unattributed` a partition of the
repo's window: the sum of the rows' `tokens.total` plus `actor_unattributed.tokens_total` is
`total`, the rows are the per-bot split, and `actor_unattributed.parts` is the classes. A reader
that wants the number from the query computes exactly (a) from those fields. For a branch answer,
each row's `attribution.actor` already gives that branch's actor share, and `actor_unattributed`
gives the rest; the repo-wide number is the `--by bot` call's.

**The number is printed by a new local verb, `usagemeter coverage`.** It is the operator's and
the PR body's instrument:

```
usagemeter coverage [--window d1|d7|d30 ...] [--repo <host/owner/repo> ...] [--json]
```

- Read-only and fork-and-exit, on the query's read-only open: no lock, no DDL, no `meta` write,
  no sync, no hc call, no network. It reuses the query's window and class derivation, so the two
  cannot disagree; a test pins the equality (h, T2).
- Default: all three windows, every repo, text. `--json` prints the record the fleet step reads.
  A repo named narrows the rows; the classes stay scoped to the repos named.
- Exit codes follow the query's store states (2 bad arguments, 10 absent, 11 locked, 12 newer,
  13 outdated, 1 unreadable); its own output is bounded (g), and it never refuses a whole answer
  for its size: the repo, bot and window lists are capped and counted.

**The fleet record is the pack's, not the meter's.** The pack's fleet step (the loop that already
runs `usagemeter sync` on each connected machine, `meter.js`) runs `usagemeter coverage --json`
there, one machine at a time under the existing 30 s cap, and writes one record beside its
install record (0600): the machines that answered with their counts, parts and bots, and the
machines that did not, by name. The reader is genie, on the machine that runs the fleet step;
the phone keeps reading each machine's `herdr-meter` doc, which the fleet record is not. The
meter never contacts another machine, and no new timer or daemon exists.

**Not `status`, and not the envelope.** `status` is the store's health and takes no window; a
coverage block there would duplicate the report and grow the envelope's job. A new field in the
query answer would be a schema change beyond RFC 0021 delivery 2, which is out of scope here; it
is not designed, and it is not needed, because (b)'s partition already carries the arithmetic. If
the owner ever wants the ratio inside the envelope, it is an additive contract-1 change with
genie's review, on its own.

**No schema change is needed; three descriptions read narrower.** `tokens_by_basis.session` is
worded for "a Herdr row", and now also covers a harness's own start record (d); the
`dsh_tui_seat` and `other_machine` reason descriptions point at Decided 5 and 6, whose reach this
RFC narrows. No enum value, field, state or sum changes, but the three descriptions' cases do:
`other_machine` used to be the name for a linked-machine pane's call and now covers only a call
whose record here is another machine's (a moved log); `dsh_tui_seat` no longer covers a seat
with a terminal record. That wording change is named here and **not designed** now (G4): one
wording-only schema change carries the three and PR 875's two description Lows, landing no later
than delivery 4, so no other delivery touches the schema.

### (c) The label claims: `worker.of`, `worker.role` and a seat's `bot`

**What is there now.** The pack sets `worker.of=<bot>`, `worker.role=<dev|test|review|fix>` and
`branch=<branch>` on every worker pane at launch (`workers.js`, `workerArgs`); hc lists those
labels on the terminal, and `hc.rs` already reads them into the snapshot (`Labels::worker_of`,
`worker_role`). The resolver then drops them: a launch the snapshot saw with no start row claims
nothing (`Claim::Unrecorded`), so its calls are unlinked even though the terminal names its bot.

**The rule.** A launch that the snapshot shows with no start row, on a terminal whose labels
carry `worker.of`, is a worker launch with `bot = worker.of`, `role = worker.role` when it is one
of the worker roles, `kind = worker`, and an unrecorded squad. The tag is persisted on the launch
row at sync; `source = snapshot` remains the marker that these tags came from the snapshot's
labels, so a later recompute replays the same answer. A seat the snapshot shows with no start
row and no attach binding, whose labels carry `bot`, takes its tag the same way (kind seat, role
`role`); that tag is used only for calls a session record ties to the launch, never for the
seat's project-root cwd ((e)). A start row or binding always wins.

- **The span.** The claim runs from the first sync that saw the label to the launch's end. Usage
  before that sync stays unlinked: the meter claims only what it saw, and a label can be set after
  a terminal started. The cost is at most one sync period at each launch's start, and it is
  printed, not hidden.
- **Arbitration.** Equal tags collapse, as everywhere (a restarted worker on its own worktree is
  still that worker). Two live workers on one worktree with different tags make the call
  ambiguous (`claimants_differ`) and not a guess between them. A start row always wins: every
  field the ledger recorded is left alone, and the label never overwrites it.
- **A label that changes.** A worker's label is set at launch and never rewritten: a later
  different `worker.of` clears the launch's claim, and its calls become unlinked, never re-tagged
  to the last label seen. A seat's `bot` label can change with a reattach, so it is kept as a
  timeline in the launch row's existing `bound` column (the attach binding's own shape), and the
  claim follows each interval: the sync that saw the change moves the later calls to the new bot.
  No new column; a recompute replays both states.
- **The basis is `label`.** A tag a label supplied is reported at `label` basis, whatever tied
  the call to the launch: the label is the weakest link in it. `session` stays a start-time
  record naming the session, and `worktree` a cwd match to a *logged* launch, for tags those
  records supplied (0018's `tokens_by_basis`). `label`'s wording, "an hc label seen at a sync
  named it", covers it. No new value, no schema edit; genie acked the reading (G1). A new value
  would be a contract change and is out.
- **The branch and task are not filled.** The worker labels fill only bot, role and kind:
  `task`, `project` and `branch` are never taken from them. The branch vocabulary is `log`,
  `ledger` and `none`, so a label-tagged dsh-tui or OMP worker keeps its branch null: it counts
  as attributed and as `unattributed` (branch-less) at once, so bot coverage rises while branch
  coverage stays partial. Adding a fourth value would be a contract change and is out.

**What it closes.** Unlogged workers (a hand-started `hc run`, a start row whose append failed),
workers on a machine whose pack predates RFC 0021 delivery 3 (their rows carry no `core`,
`created_ms` or `session`), a worker whose harness logs no branch but whose label names it, and a
seat the local ledger has no row for (one started on a linked machine, (e)), when a session record
ties it. **What it cannot.** A worker or seat that started and ended between two syncs was never
seen; a label set after the usage can only claim from its first sighting; a seat with no session
record (a codex or omp linked seat before one exists) stays unknown; and a machine whose pack
predates the labels entirely has neither record.

### (d) dsh-tui seats: Decided 5, reopened

**The problem.** A dsh-tui call is found by its session header's `cwd` and the worker launch whose
worktree it is. A seat's `cwd` is the project root, shared by seats and by whatever runs there by
hand, so the worktree path names no single launch; a seat that nothing else claims is
`dsh_tui_seat`, and Decided 5 left it there because no record tied the session to a terminal.

**The record: DSH writes the terminal it runs in.** hc sets `HC_TERMINAL_ID` in every pane it
starts, and the CLI already relies on it. DSH's session start line (`type: "session"`, the file's
first line) gains one optional field, the value of `HC_TERMINAL_ID` when it is set. The format is
DSH's v4 session file; the field is additive, and a DSH that does not write it stays readable.
Owner: **DSH**. Contract: DSH's session format, additive; the meter reads it when present.

**What the meter reads, and how it joins.** The dsh-tui source carries the header's terminal on
the session; the resolver matches it, by address (the variable holds the pane's address), to a
launch on this machine's core whose span covers the session's start. Its bot is the start row's
`botId`, the attach ledger's binding, or the seat's `bot` label ((c)). The link is persisted as a
normal `link` row at `session` basis; a tag the seat's label supplied still reports `label` ((c)).
So a later recompute and a backfill replay it without re-reading the log. The link ends with the
launch: a later session row for the same session in another launch closes it, and when a session
is resumed into the same log, the first line's terminal covers only the first launch's span.
Two launches on the terminal whose spans overlap name no launch: the call is ambiguous, never a
guess. A session whose terminal matches no launch row (an old pack, a ledger not read) stays
unlinked with `no_record`.

**The second witness, where the pack knows the id.** The pack chooses a fresh Claude launch's
session id (`--session-id`) and sets `agent.session`; on a restart it carries a known id and
writes a session row (RFC 0021 (f) 5). That row or label links the session even when the log's
header has no terminal field, and confirms the header's terminal when both exist; a disagreement
is ambiguous. The pack does **not** choose a dsh-tui id: a restart without one uses `-c` and
writes no session row (models.js), so for dsh-tui this witness exists only when a reviver or an
earlier resume supplied the id. Owner: **Herdr**, for the Claude half.

**What stays unknown, and the reason it carries.** A session started before DSH writes the field;
a session in a pane where `HC_TERMINAL_ID` is absent (started by hand, outside hc, or hosted by
the desktop app's own DSH); a session whose launch row is gone or was never read; a log moved
between machines (e). The dsh-tui ones keep `dsh_tui_seat`, "a dsh-tui session no record ties to
a terminal"; its cases narrow as (d)'s records land.

**Retention.** The field is in the log, which is exactly what a backfill re-reads, so the link is
recoverable while the log exists (90 days, or DSH's own pruning, whichever is shorter), and the
launch row is kept 400 days. No new column and no new table: the link row is a normal one, and
the evidence bound is what limits the recovery, not the store.

**The fallback if DSH declines.** The pack writes the label and the session row only when it
knows the id; the gap is every dsh-tui seat whose id it never learned, not only the time before
its first resume, and it is visible as `dsh_tui_seat`. Reading DSH's private live-session index
is not done: RFC 0021 Decided 5 rejected it as an unstable format, and nothing since changes
that. Chat ruled: ask DSH first, and keep this fallback tested either way (C2).

### (e) Linked machines: Decided 6, reopened

**Where linked usage lives.** Each machine's own store. The pack installs and syncs the meter on
every connected machine (RFC 0017 delivery 6; RFC 0018 (a)), so that machine's resolver counts
its own logs, and its own workers are tagged there by their start rows and labels. A seat started
on a linked machine is different: its attach row is written in the starting machine's ledger,
with the linked core and its `machine` name, and a linked meter skips another machine's rows
(ledger.rs). The linked machine's own record of that seat is its hc snapshot: the pane's `bot`
and `role` labels, plus a session record. So the seat's `bot` label, used only through a session
tie ((c)), is the record path; a seat with neither is named unknown, not guessed.

**A linked seat's session record.** A Claude seat started on a linked machine gets the same
Herdr-chosen session id and `agent.session` label as a local start; without that its session has
no local record and the seat stays unknown. A dsh-tui seat gets it from DSH's terminal field
((d)). A codex or omp seat stays unknown until a session label or row names it, as on a local
machine. Owner of the Claude half: **Herdr**. A seat whose session record exists but whose pane
carries no bot label is `no_record`, never the starting machine's binding guessed.

**The fleet number is a sum of answers.** The fleet layer adds the machines' four counts as
tokens, and the per-repo and per-bot lines by their keys, then computes the ratio over the summed
tokens: token-weighted, never the mean of the machines' ratios. A machine that answers but is
stale or incomplete has lower-bound token totals, never a lower-bound ratio: the fleet ratio is
"over counted usage". A machine that does not answer is named in `missing`, with its query exit
(10, 11, 12, 13 or 1) or `timeout`, and its tokens are unknown; the number is reported as "over N
of M machines", never as the fleet's coverage. A machine outside the fleet's meter scope is
`out_of_scope`, apart from `missing`. The coverage run shares the sync's 30 s cap.

**The record.** One JSON object, one entry per machine that answered:

```
{v, generated_at, window,
 machines: [{machine, meter_version, as_of, evidence_from, counted_from,
             complete, stale, clipped, truncated, totals, parts, bots, repos}],
 missing: [{machine, reason}], out_of_scope: [machine, ...]}
```

`totals` is the four counts and `total`, `parts` the classes, `bots` the per-bot lines and
`repos` the per-repo lines (capped like the report's). No session id, no request hash, no path
and no raw log id; the repo names are the normalized `host/owner/repo` form. The record's `v: 1`
ships with a JSON Schema and one example in `meter/schema/fleet/v1/`, which the pack's writer and
genie's reader test against (G3). It is written by the pack, beside its install record, mode
0600, replaced on every run (the latest only, no history). Its own bound, count-kept and never a
silent cut: each machine's entry is at most 64 KiB with its bot and repo lists capped
(`truncated: true` above it), and the whole record is at most 1 MiB. Owner: **Herdr**.

**How `other_machine` shrinks.** A session resumed on another machine runs in a new launch there,
and, where the pack knows the id, its session row names it (RFC 0021 (f) 5), so the calls after
the resume are that launch's on the machine that logged them. A linked seat is tagged on its own
machine by the labels and session record above. What remains is a call whose only record is
another computer's: a log copied or moved between machines, an old session row of a foreign core,
or a shared home folder counted in two stores (which the fleet sum counts twice; it is a named
fleet unknown). That is genuinely unknown without a session-level join, and it keeps
`other_machine`. The reason no longer absorbs a linked machine's usage; the labels and the
fleet's sum do.

**Session-level replication is not built.** It would need a key every store shares for session
hashes (each store's is random and private, RFC 0018 (b)), a second hash for evidence written
before that key existed (the raw ids are gone, so it cannot be backfilled), a transport for the
digests (paths and request ids excluded), a store column and a migration. It serves only the
moved-log case above. Chat ruled: not now (C3); the fleet record's sum closes the number, and
replication, if ever wanted, is its own RFC with its own threat model. The `other_machine`
description narrows (see (b)).

### (f) History, the backfill, and the horizon

The past is re-tagged from the native logs, exactly as RFC 0021 and 0018 (b) decide:
`usagemeter sync --evidence-backfill --days <n>`, run once per machine by the operator, never
automatic, bounded by `n <= 90`, resumable, with a generation kept first. This RFC adds the order
and the horizon, not a new mechanism:

- **Run it once the records are in.** A sync first, so the live snapshot's labels are seen and
  the ledgers read; then the backfill, which re-reads the logs, writes evidence for the calls it
  finds and recomputes attribution over them. The DSH terminal field (d) is in the log and is
  recovered by the backfill; a worker label (c) is not, because it is live only.
- **The horizon is the later of the evidence bound and the oldest record.** The report prints
  `records_from` (the oldest launch or link) and `evidence_from`; a call before both can never be
  re-tagged. The backfill cannot invent a launch: calls whose launch rows do not exist stay
  unlinked, and calls whose logs are gone stay before evidence.
- **The headline can fall, and that is not a regression.** A backfilled call leaves
  `before_evidence` and becomes attributed, ambiguous or unlinked. If most recovered calls are
  unlinkable, bot coverage falls while the meter knows more than before. The report's four counts
  make that visible, and the PR body shows the classes beside the headline, so a fall is never
  read as the mechanism getting worse. `inspected` is the number that must rise when a class is
  closed.
- **What stays unknown for good.** Hours before the oldest record; logs already deleted; a
  session no record names (a hand-run agent); a moved log (e); a machine whose store is gone.

### (g) The bounds this stays inside (RFC 0018)

- **Evidence: 90 days or 1 GiB.** `before_evidence`'s floor: a window reading across it says
  `partial`, and usage the bound prunes is before evidence, never attributed.
- **Launches and links: 400 days.** The launch row a label or terminal claim needs; inside the
  90-day evidence it is present unless it was never read.
- **A row and the query's output: unchanged.** No row field is added, and the report is not
  contract 1: its own bound is below.

The report's own ceilings, proposed and checked under RFC 0018 (e)'s rules, on the ceiling store:

| Case | Ceiling |
|---|---|
| Warm report, all three windows, every repo | 300 ms p95, 250 ms CPU, 64 MiB RSS, 64 KiB out |
| A repo list past 50 | 50 shown, `repos_omitted` counted, every total complete |
| A bot list past 50 | 50 shown, `bots_omitted` counted, every total complete |
| The fleet record | 64 KiB per machine entry (bots and repos capped, `truncated`), 1 MiB total |

- **No daemon, no new process.** The report is one fork-and-exit read. The fleet step rides the
  pack's existing sync loop and its 30 s cap; it adds no timer.
- **No write, no migration.** The report opens the store only; it creates nothing, migrates
  nothing, and writes no `meta`. The fleet record is the pack's file, not the meter's.
- **No store change.** The label claim writes the launch row's existing `bot`, `role`, `kind`
  and `source` columns; the dsh-tui link is a normal `link` row. The store stays schema 3.

### (h) Tests

Each delivery names the test that proves it; the ones this RFC requires:

- **T1, a class is counted, not hidden** (the issue's). A synthetic store with one attributed
  call and one call in each of the five classes: the report's `total` is their tokens,
  `bot_coverage` is below 1, every class prints its tokens and harnesses, and the parts plus
  `attributed` add up to `total`. A mutation that drops a class from the denominator fails T1;
  one that folds `dsh_tui_seat` into `no_record` fails it too.
- **T2, one source of truth.** For the same store and window, the report's repo counts equal the
  query's `--by bot` answer: the sum of the bot rows plus `actor_unattributed.tokens_total`, the
  parts equal `actor_unattributed.parts`, and the per-bot lines sum the bot rows' tokens by bot
  id. For a branch answer, each row's `attribution.actor` adds up to the report's totals for that
  branch.
- **T3, worker labels.** A call in an unlogged, labelled worker's worktree is attributed at
  `label` basis; a call before the first sighting is unlinked; two differently labelled workers on
  one worktree are ambiguous; a label that changes makes the launch's calls unlinked, not the new
  tag; a logged launch is never overwritten.
- **T4, dsh-tui seats.** A header with the terminal field and a launch on that terminal is
  attributed at `session` basis, in a project root shared with a hand-run session; a header
  without it stays `dsh_tui_seat`; two overlapping launches on the terminal are ambiguous; a
  backfill reproduces the link from the log.
- **T5, the fleet.** Two records sum token-weighted (not the mean); a machine that fails is named
  in `missing` with its exit or `timeout`, and one out of scope as `out_of_scope`, neither counted
  as 0; a bot on two machines joins on its key; the record has no session id, request hash or path
  (a leak test over the JSON), and validates against its schema and example.
- **T6, the backfill.** Before evidence falls, the total never changes, and attributed, ambiguous
  and unlinked rise as far as the records allow.
- **T7, retention.** Usage pruned past the bound moves to `before_evidence`, never to attributed,
  and `evidence_from` moves with it.
- **T8, a read.** The state folder is byte-identical after a report, as the query's test checks.
- **T9, a seat's labels.** A snapshot seat in the project root with `bot`/`role` and a session
  label is attributed at `label` basis; with no session record it is unlinked; a changed worker
  label leaves its calls unlinked across a recompute, while a seat's change splits at the
  interval it was seen; a start row or attach binding wins. A Claude seat started on a linked
  machine, with the pack's chosen id and label, is attributed on its own machine.
- The gate is the crate's (`fmt`, `clippy`, `test`), the docs-only lane check for this RFC, and
  `node herdr/scripts/privacy-check.mjs` on the tree.

### (i) The measurement, before and after

**The instrument** is the report (delivery 2), and the fleet record (delivery 5) for the fleet
number. Both are read-only; neither changes the store.

**The points**, on one real store, same machine, same logs:

| Point | State | Expected movement |
|---|---|---|
| P0 | before the closures | the baseline; `before_evidence` and `no_record` dominate |
| P1 | after the worker labels | `no_record` and `claimants_differ` fall; `attributed` rises |
| P2 | after the DSH field | `dsh_tui_seat` falls; `attributed` rises with `session` basis |
| P3 | after the backfill | `before_evidence` falls; the other three move by the records |

- **One run per point**, not a grid, d1/d7/d30 in the one run, with `meter_version`,
  `schema_version`, `evidence_from`, `counted_from`, `records_from`, the watermark and the
  completeness flags recorded beside it. The branch's binary is built under RFC 0017's build rule
  on the build host and run where the store is; nothing is built on the store's machine.
- **The PR body carries aggregate numbers only**: the percentages and token totals per point, per
  window, per class, with no machine, repo, branch, bot or path named. The issue gets the same
  table; the raw records stay with the operator.
- **The windows move.** `d1`, `d7` and `d30` end at each point's watermark, so their bounds
  differ between points. Each row records the exact `window.start` and `window.end`; points are
  compared by class shares and `inspected`, never by adding two answers.
- **The target** is set after P0, not from the old 12%, which counted frozen tags. Chat ruled:
  the owner sets it after P0, and this RFC's proposal is the floor for closing #897 (C4). The
  proposal, unless P0 is below 1% counted attribution: `d7` at least doubles from P0 to P3,
  `d30` does not fall from P0 to P3, `inspected` rises at P1 and P2, and every class's movement
  is explained by its delivery. Below 1% the floor is a rise in points, not a ratio. If a class
  does not move, the delivery is not done and the reason is named.
- **What invalidates a point**: a store reset or migration, the 1 GiB bound pruning between
  points, a pack update landing mid-window, or the definition changing. Any of them restarts the
  comparison; none of them is averaged away.

## Contracts introduced

- `usagemeter coverage`: a new local verb, read-only, fork-and-exit, not contract 1. Nothing genie
  reads changes; no install changes.
- The fleet coverage record: local, versioned `v: 1`, written by the pack beside its install
  record, read by genie, with a JSON Schema and an example in `meter/schema/fleet/v1/`. No
  session ids, request hashes or paths.
- The dsh-tui session header's terminal field: DSH's format, additive, absent is valid.
- The resolver's `label` claim for `worker.of`, `worker.role` and a seat's `bot`: a rule, not a
  store column; the query reports it at `label` basis.
- **Unchanged:** query contract 1 (`meter/schema/query/v1/`), the five reasons and their states,
  the store's schema 3, `workers.jsonl`'s format (the resume row is RFC 0021 (f) 5's),
  `meter.db`'s tables, and the state folder.
- **RFC 0021 amended in the same pull request** (ACKed by genie, 2026-11-10): Decided 5 and 6,
  (a)'s dsh-tui row and bullet, (d)'s reasons' reach, the Contracts list, the delivery pointer,
  the Open questions note and the Links.

## Threat model

- **Labels can be set by anyone who can run `hc label`.** That was already true for the `label`
  basis (RFC 0021); the worker claim extends it to a bot tag. Bounds: one launch, only the span
  the meter saw, never over a start row, a changed label fails closed to unlinked, and the amount
  of usage never moves, only its name. The worst a relabel can do is put a bot's name on usage
  the terminal could already reach.
- **The DSH terminal field.** It is written by the harness in its own local log; a process that
  can write that log can claim a terminal, but the launch must exist and name a bot, so the worst
  case is a name on a call whose terminal the writer could already use. No raw id reaches an
  output.
- **The fleet record.** Machine ids, bot ids, counts, classes and repo names, written 0600 beside
  the pack's record, read by the person's own tools. No session id, request hash, path or log id.
  It is replaced each run; it adds no listener and no credential.
- **Undo.** The label and terminal claims are derived: reverting the code stops new claims, a
  rebuild from evidence recomputes the old ones, and the report changes with it. The fleet record
  is a live file; deleting it loses nothing the meters do not still hold.

## Deliveries

Each is one pull request with an independent review, except where an owner outside this repository
is named.

1. **This RFC and the RFC 0021 amendment** (docs; cuts nothing). *Check:* `bun scripts/lane.ts
   ships <last tag>` says no; the privacy check is clean.
2. **The coverage report** (crate; meter lane). `usagemeter coverage`, the metric of (a), the
   classes, per repo and per bot, the horizons and the frozen-tag diagnostic, on the query's
   read-only open. *Check:* T1, T2, T8 and the (g) ceilings. *Rollback:* revert; no store changed.
3. **The label claims** (crate; meter lane). (c) in the resolver and the snapshot's launch row,
   for workers and seats. *Check:* T3; T9's local cases; P1 measured. *Rollback:* revert and
   rebuild the affected sessions; the claims stop, and a rebuild returns their calls to unlinked.
4. **The dsh-tui seat**, in two parts: **4a**, DSH writes the terminal field (owner: DSH; nothing
   ships here); **4b**, the meter reads it and links (crate; meter lane), plus the check that the
   pack's resume row is written (owner: Herdr). *Check:* T4; P2 measured; the G4 wording-only
   schema change is merged with it or before it. *Rollback:* 4b reverts to `dsh_tui_seat`; 4a's
   field is additive and ignored by an older meter.
5. **The fleet coverage** (Herdr pack; herdr lane). The fleet step runs the report on each
   connected machine and writes the record, and a Claude seat started on a linked machine gets
   Herdr's chosen session id and `agent.session` label. *Check:* T5 with a fake fleet and one
   failing machine, T9's linked seat, and the record validates against its schema and example.
   *Rollback:* revert the pack; each machine's own report stays, the linked seat returns to
   unknown, and the record disappears.
6. **The backfill and the measurement** (operator; no code). A sync, the backfill to the horizon,
   then P0 to P3 on the real store and the aggregate table in the closing PR. *Check:* T6, T7 and
   (i). *Rollback:* none needed; the backfill keeps a generation and never changes a total.

#897 closes with delivery 6's table once 2, 3, 4b and 6 are in; 4a is asked in parallel, and its
absence only leaves the `dsh_tui_seat` share in that table. Delivery 5 is filed under this RFC's
umbrella, and its movement is measured in its own pull request.

## Ruled by Chat, 2026-11-10

- **C1, no per-bot rate.** The per-bot line (tokens, share, tie mix, unrecorded fields) is enough
  for now; a rate needs claimant tags stored per ambiguous call and a new field, and it is not
  built.
- **C2, ask DSH first.** Delivery 4a is the ask; the pack's label-and-row fallback is kept and
  tested either way, and it covers only a seat whose id the pack learns. The gap is every
  dsh-tui seat whose id it never learns, and the `dsh_tui_seat` share shows it.
- **C3, no session replication.** The fleet record (e) closes the fleet number without a
  fleet-wide session key; replication for moved logs stays out.
- **C4, the target is the owner's.** The owner sets it after P0; this RFC's `d7` doubles and
  `d30` does not fall is the floor for closing #897.

## Acked by genie, 2026-11-10

- **G1, the `label` basis stands.** Genie acked it, with start-row-wins and the fail-closed rule
  kept tested (T3) and with worker labels never filling `task` or `branch` ((c)).
- **G2, no envelope field.** Genie acked the derived metric: the counts in the answer, the number
  computed by the reader, no new field in the envelope.
- **G3, the fleet record, versioned.** Genie acked its shape and asked for a schema and an
  example, which (e), Contracts and delivery 5 carry.
- **G4, the three descriptions, with a deadline.** Genie acked leaving them now, and the one
  wording-only schema change that carries them also carries PR 875's two description Lows: the
  `claimants_differ` text not covering an unreadable tag, and the 96-JSON-byte tag rule. It lands
  no later than delivery 4 ((b) and delivery 4).

## Open questions

None: Chat ruled C1 to C4 and genie acked G1 to G4 on 2026-11-10, above, and the delivery checks
carry what the acks added.

## Links

- Issue #897, this RFC's outcome; PR 875, RFC 0021 delivery 6 (the query's actors); the RFC 0021
  Decided 5 and 6 amendment in this pull request.
- RFCs: [0017](0017-usagemeter-crate.md) the crate, the meter lane and the build rule;
  [0018](0018-meter-query-contract.md) contract 1, the evidence bounds (b), the ceilings (e) and
  question 3 (fleet scope); [0021](0021-meter-attribution.md) attribution, the reasons, the
  deliveries, Decided 5 and 6; [0023](0023-dsh-upstream-agent-context-and-chat-rows.md) the other
  asks to DSH.
- Crate: `meter/usagemeter/src/query.rs` (`actor_unattributed`, the four counts),
  `evidence.rs` (the classes and reasons), `ledger.rs` (`Claim`, `Labels`), `hc.rs`
  (`worker.of`, `worker.role`), `sources/dsh_tui.rs` (the session header), `sync.rs` (the
  resolver's call), `main.rs` (the verbs).
- Herdr pack: `herdr/mods/am-sidebar/workers.js` (the worker labels), `meter.js` (the fleet sync
  loop), `attach.js` (the seat bindings), `launchArgs.js` (the seat labels).
- Schema: `meter/schema/query/v1/envelope.schema.json` (D5's reasons and the actor counts).
