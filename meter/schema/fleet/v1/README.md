# Fleet v1

`fleet-usage.schema.json` defines `usagemeter.fleet.usage` / `meter.fleet.usage@1`.
`fleet-outcomes.schema.json` defines `usagemeter.fleet.outcomes` / `meter.fleet.outcomes@1`.
Both have `contract_version: 1`, a meter version and generation time, machine health,
explicit missing machines, and `ok`, `partial`, `usage` or `error` status. The existing
`fleet-coverage.schema.json` is a separate collector contract.

```sh
usagemeter fleet usage --json machine-a1b2c3.json machine-d4e5f6.json
usagemeter fleet outcomes --json --missing machine-z9y8x7:unreachable:ssh_timeout machine-a1b2c3.json
```

These commands read local JSON files only. Collection, remote access and deciding which
machines should be present belong to the caller. No store is opened or written, no schema
is migrated, and no network, git or hc command runs. Exit status is 0 for `ok` and `partial`,
2 for `usage`, and 1 for `error`; stdout is always one compact JSON line. `--json` is required.
Use `--` before filenames beginning with `-`. A `--missing MACHINE:REASON` without a message
uses the reason as its message. All three missing fields must be nonempty.

No inputs and no missing machines is a usage refusal. Missing-only reports are partial with
empty machine and result lists. Bad JSON, unreadable files, unsupported input contracts,
duplicate machine inputs and incompatible queries produce error envelopes with empty result
lists. Integer or price sums outside the reducer's arithmetic range are refused. Supply one
snapshot per machine. The reducer does not try to deduplicate token events copied between
stores. Missing entries are sorted by machine, reason and message and deduplicated exactly.

## Usage reduction

Inputs are `usagemeter.query` contract 1 envelopes. Non-ok query envelopes become `missing`
entries, retaining their status and error message. Their machine id is used when available;
otherwise the CLI uses the file stem, and the in-memory reducer uses `unknown`.

Successful inputs must agree on repo, aliases, window, grouping, since/until and the ordered
branch list. The fleet query echo keeps these fields and `branch_count`; collector hashes and
per-store request truncation metadata are not fleet query fields. Machines are sorted by id.
`ok` requires at least one machine, no missing machines, and every machine complete, fresh and
unclipped. Otherwise the result is partial. `as_of` is the earliest lexicographic RFC 3339
watermark only when every successful machine has one and none is missing; otherwise it is null.
Use the local reports' normalized UTC timestamps.

Tokens, price coverage counters, actor counts and activity hours add across contributing rows
with positive token totals. Reasoning stays null if any contributing row lacks its split.
Costs stay unpriced with null USD fields when no token has a price or reported cost. Model
calls and tokens add by model name; model cost stays null when every contribution is null.
Models sort by descending tokens then name and are capped at eight. Input omissions and newly
omitted models are counted. Unpriced model names, activity harnesses and incomplete sources
are sorted unions. Activity spans the earliest first hour through the latest last hour.

Branch rows group by branch. A zero is proven only by an ok fleet and an explicit zero from
every successful store for that branch, with no branch-unattributed tokens. Otherwise a
zero-token result has missing, unsupported or stale state and null numbers. Positive observed
usage remains a lower bound beside partial machine health. Attribution coverage is partial
when branch-unattributed tokens could belong to the requested branch filter.

Bot rows group by `(bot, kind, role, squad, unrecorded, harness)`; task rows group by task.
Task actors form a sorted union in bot-key order (null first, the unrecorded enum in its
canonical order). Any task_ambiguous contribution makes that task missing with null numbers
and no guessed actors. Actor-unattributed reason parts use claimants_differ, no_record,
dsh_tui_seat, other_machine, before_evidence order. `absent_bot_is_zero` requires an ok bot
fleet, zero actor- and branch-unattributed tokens and the flag true in every input.

## Outcomes reduction

Inputs are local `usagemeter outcomes --json` v1 records. Machines sort by id. An ok fleet
requires every machine recorded, complete and fresh and none missing. Windows are emitted in
d1, d7, d30 order; start is the earliest start, end the latest end and clipping is an OR.
A window is no_data only when every contributing window is no_data and no machine is missing;
it is ok only when every machine supplies an ok window; otherwise it is partial.

The reducer accepts fleet-oriented `total`/`ok` error counters and `time_to_pr.by_branch`,
as well as the current local v1 `count`/`full` and `time_to_pr.branches` spellings. It emits
`total`/`ok`, `by_branch`, `overall` and `by_repo`. Local v1 does not expose a launches summary:
`launches` is null when an input lacks it, rather than invented zero counters. When present,
all launches integer fields add. Run-end counts add using the supplied fields (local v1's
exited_ok/failed/killed/stopped_by_restart/other/unknown, or clean/failed/unclassified).
Run-end by_bot groups by bot, kind, role, squad, unrecorded and agent. Null run ends remain
null when no store recorded them or the whole window is no_data.

PR details deduplicate by `(repo, branch, pr)`. Duplicate details keep earliest first commit,
PR creation, non-null merge and first launch times, the maximum launches and OR of shared.
Durations are recomputed from those timestamps, falling back to the minimum known duration.
Overall and per-repo percentiles are recomputed from the deduplicated visible PRs using
nearest rank; null PR ids are not samples. Summary opened counts subtract duplicate PRs;
merged and open counts subtract overlaps in those states. If input summaries are absent,
counts derive from the visible PR list. They cannot recover PRs omitted by a local report.
Detail omissions remain explicit; percentiles describe the visible deduplicated samples.

Abandoned branches deduplicate by repo and branch, summing launches. Error breakdowns group
by harness, bot key, repo/branch or repo/task. Local per-bot error rows are pivoted into those
fleet breakdowns. Counts and source omissions add; lists sort by key and cap at 50, carrying
both omitted group counts and omitted failure counts. `not_recorded` remains null when no
store has recorded a tool/API failure counter. Mixed recording or missing machines makes
recorded counters partial. Branch and task tool/API counts are null whenever that fleet
counter is null. Run failures add and are partial unless every input is ok and none missing.

## Examples and regression tests

The four `examples/fleet-{usage,outcomes}[-partial].json` files are synthetic. The fleet
integration tests validate them against these schemas and reproduce them from synthetic
per-machine inputs. To refresh them after an intentional contract change, run the fleet test
with `UPDATE_FLEET_EXAMPLES=1` under the host's shared Cargo gate and scratch configuration.
Negative tests reject false ok claims. M1 covers cross-machine token, price, model and actor
sums; M2 covers missing machines and unknown zero rows; M3 covers PR deduplication, percentile
recalculation and failure nullability.

## Fleet coverage collector record

RFC 0026 (e), delivery 5. The Automagik Herdr pack writes it; genie reads it.

- `fleet-coverage.schema.json`: the record's JSON Schema (2020-12).
- `examples/fleet.json`: one synthetic record (made-up numbers): this computer and one linked
  machine answered, one linked machine timed out, one has an older meter, one is out of scope.

Where: `automagik-herdr/fleet-coverage.json` under the app home, beside the pack's install
record, mode 0600, replaced on every run of the sidebar's meter step (the latest only).

Reading it: the fleet number is the reader's sum. Add the machines' `totals` as tokens, `parts`
by `reason`, `bots` by `bot` and `repos` by `repo`, then compute `attributed / total` over the
sums: token-weighted, never the mean of the machines' `bot_coverage`. With the example,
`(600 + 100) / (1000 + 9000) = 0.07`, not the mean of 0.6 and 0.0111. While `missing` is not
empty the number is "over N of M machines" (N = `machines`, M = `machines` + `missing`), never
the fleet's coverage; a machine in `missing` or `out_of_scope` is unknown, never 0. The pack's
own reader is `fleetSum` in `herdr/mods/am-sidebar/meterFleet.js`.

The record holds no session id, no request hash, no path and no raw log id: the pack copies each
field of a machine's answer by name after checking it, and passes nothing through.
