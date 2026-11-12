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
