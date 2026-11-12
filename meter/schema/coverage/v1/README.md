# Coverage JSON v1

`usagemeter coverage --json` prints one newline-terminated record with `v: 1`.
`envelope.schema.json` describes successful reports using JSON Schema Draft
2020-12. Errors use stderr and an exit code rather than a JSON envelope.
The default windows are `d1`, `d7`, and `d30`; `--window` selects a subset.

Coverage measures tokens over counted usage. `bot_coverage` is attributed tokens
/ total; `inspected` is attributed / (attributed + ambiguous + unlinked).
Ratios are rounded to four decimals, retaining a tiny positive value that would
otherwise round to zero. Neither ratio is a bound.

- Every window has exactly five `parts`: ambiguous/claimants_differ,
  unlinked/no_record, unlinked/dsh_tui_seat, unlinked/other_machine, and
  before_evidence/before_evidence. Parts retain their tokens and harnesses.
- When `totals.total` is zero, both ratios are null. With counted usage,
  `bot_coverage` is in [0, 1]; `inspected` can still be null when all usage
  predates evidence. A zero part share that sources cannot vouch for is null.
- Repo lines report measured, no_usage, unknown, or other. A repo without counted
  usage has null coverage. `no_repo` tokens are store-wide and outside the
  denominator, even with a repo filter.
- Repo and bot lists show at most 50 rows each. With zero omitted rows, their
  `*_other` is null. With omitted rows, `repos_other` has `state: "other"` and
  `bots_other` has `lower_bound: true`. Totals include the omitted rows.
- Evidence is full, partial, or none. `complete`, `stale`, `all_vouch`, and
  `incomplete_sources` expose the report's data limits.

All objects reject unknown fields and require every serialized field. The schema
validates structure, ratio ranges, and state/null relationships; sums, ratios'
exact arithmetic, list counts, and part ordering remain report-level rules
tested by the crate.

`examples/coverage.json` shows empty and measured windows with full or partial
evidence. `truncated.json` includes both other aggregates. All values are
synthetic. The coverage integration tests validate the examples, reject mutated
invalid records, and validate every JSON record from both report helpers.
