# Outcomes JSON v1

`usagemeter outcomes --json` prints one newline-terminated record with `v: 1`.
`envelope.schema.json` describes successful reports using JSON Schema Draft
2020-12. Errors use stderr and an exit code rather than a JSON envelope.
The default windows are `d1`, `d7`, and `d30`; `--window` selects a subset.

Each window reports raw harness-recorded failures, run ends, and time to pull
request. Failure counts include expected failures and usage-limit stops; they
are not a quality score. `error_kinds` describes the sources and harness markers.
Unsupported harnesses have unknown failures, never an implied zero.

- `not_recorded` and `no_data` windows have null `run_ends` and a matching
  `time_to_pr.state`. `ok` and `partial` windows have a run-ends object.
- Each kind's `not_recorded` or `no_data` count is null. `full` and `partial`
  counts are nonnegative integers; partial counts are lower bounds.
- `errors.by_branch` groups failures by `(repo, branch)`, including ambient human
  sessions that log a git branch. `attributed` counts failures linked to a bot;
  `unattributed` counts the rest. A logged branch takes precedence over a linked
  worker's `filled_branch`; only attributed failures may use that fallback.
- `errors.by_task` groups attributed worker failures by `(repo, task)`. Both a
  nonempty project and a valid task id must be recorded; seats are excluded.
  Project paths are never printed. These are additional views of the same
  failures as `rows` and `unattributed`, so the lists must not be added together.
- Branch and task rows carry `tool_error`, `api_error`, and `run_failed` counts.
  Each harness count is null when that window's corresponding kind is
  `not_recorded`, including when only failed runs are available. Recorded zero
  is an integer. Rows with no counted failure are omitted.
- Both breakdowns show at most 50 rows, sorted by total failures descending,
  then repo and branch/task ascending. `by_branch_omitted` / `by_task_omitted`
  count omitted rows; their matching `*_omitted_count` fields count failures.
  The output ceiling can cut these lists further without changing totals.
- Clock statistics use nearest-rank percentiles in whole seconds. With `n: 0`,
  both percentiles are null; otherwise both are nonnegative integers.
  `n_shared` is optional and appears on bot/role statistics to identify samples
  shared across groups. Those groups are views, not a partition.
- Repo and bot clock fields are flattened into their rows. Branches with no
  recorded PR are excluded from percentiles. Null clocks are unknown, not zero.
- Lists may be cut to their caps or to fit the 64 KiB output ceiling;
  `truncated` and the corresponding `*_omitted` fields expose this.

Objects reject unknown fields, except `markers`, a harness-to-rule string map.
Every serialized field is required except `n_shared`. The schema validates
structure and state/null relationships; arithmetic across rows and ordering
remain report-level rules tested by the crate.

`examples/recorded.json` shows ok and partial windows, `not-recorded.json` a
store not yet prepared, and `no-data.json` empty windows. All values are synthetic.
The outcomes integration tests validate the examples, reject mutated invalid
records, and validate every JSON record returned by their report helper.
