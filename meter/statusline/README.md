# Meter status line

Automagik Meter's Claude Code status line, and the limits logger it runs behind. Both are local
tools: no release ships them (`scripts/lane.ts`, `NEVER_SHIPPED`).

```
Opus 5.5 · my-app | ctx 40% 400k/1M · 100k to compact · 2 compacts | 5h 24% ↺2h14m · 7d 58% ↺4d2h
```

- `ctx`: used % and tokens of the context window, then the tokens left before the auto-compact
  window, read from `modelSettings["<model id>"].autoCompactWindow` in Claude Code's settings (user
  settings, then the project's `.claude/settings.json` and `.claude/settings.local.json`). With no
  window set, or `autoCompactEnabled: false`, the distance is left out.
- `N compacts`: the session's `compact_boundary` records in `transcript_path`, shown once there is one.
  Only bytes appended since the last turn are read; the count is cached in the Meter state folder
  (`statusline-compacts.json`, beside the logger's files; `METER_STATE_DIR` moves it).
- `5h` / `7d`: `rate_limits` used % and the time until the window resets (`↺`). Claude Code drops a
  window once it resets, and sends none before the session's first reply.
- Yellow from 70%, red from 90% (the context against the compact window). `NO_COLOR` turns colour off.
  Narrower than one line (`COLUMNS`), the quota moves to a second line.

| File | What it is |
| - | - |
| `automagik-statusline.mjs` | The status line: stdin JSON in, one line out. Node, no dependencies, never throws. |
| `claude-limits-statusline.mjs` | The limits logger (verbatim from the copy the owner ran): appends `rate_limits` readings to `claude-limits.jsonl`, then runs the command after `--` with the same stdin. |

## Install

Claude Code runs the command with a minimal PATH, so name node by an absolute path. On a host
where node lives under nvm, a stable symlink (`~/.local/bin/node`) keeps the line working across
upgrades of the symlink's target.

```sh
install -m 755 meter/statusline/automagik-statusline.mjs meter/statusline/claude-limits-statusline.mjs ~/.local/bin/
```

```json
"statusLine": {
  "type": "command",
  "command": "/ABSOLUTE/node ~/.local/bin/claude-limits-statusline.mjs -- /ABSOLUTE/node ~/.local/bin/automagik-statusline.mjs"
}
```

Without the logger: `"/ABSOLUTE/node ~/.local/bin/automagik-statusline.mjs"`.

## Test

```sh
node --test 'meter/statusline/test/*.test.mjs'
```
