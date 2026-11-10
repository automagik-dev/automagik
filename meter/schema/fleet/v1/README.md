# The fleet coverage record, v1

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
