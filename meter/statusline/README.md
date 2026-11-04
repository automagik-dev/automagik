# Meter status line

Automagik Meter's Claude Code status line, and the limits logger it runs behind. Both are local
tools: no release ships them (`scripts/lane.ts`, `NEVER_SHIPPED`).

```
Opus 5.5 · my-app | ctx 40% 400k/1M · 100k to compact · 2 compacts | 5h 24% ↺2h14m · 7d 58% ↺4d2h
```

- `ctx`: used % and tokens of the context window, then the tokens left before the auto-compact
  window. The window comes from where Claude Code takes it
  ([model-config](https://code.claude.com/docs/en/model-config), "Set the auto-compact window"),
  first match winning:
  1. `DISABLE_AUTO_COMPACT` or `DISABLE_COMPACT` set, or `autoCompactEnabled: false` in the
     highest settings file naming it: auto-compact is off, no distance.
  2. `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, when it is a usable size (`200000`, `200k`, `1M`; held to
     100k-1M as Claude Code holds it). An unusable value is ignored, as Claude Code ignores it.
  3. The first of the project's `.claude/settings.local.json`, its `.claude/settings.json` and the
     user `settings.json` (`CLAUDE_CONFIG_DIR` or `~/.claude`) that names a window:
     `modelSettings["<model id>"].autoCompactWindow`, else the top-level `autoCompactWindow` of that
     file. `"auto"` (the model's tuned window) or anything not a number: no distance.

  With no window anywhere the distance is left out: no default is guessed. The window is capped at
  the context window, as Claude Code caps it. A one-launch `--autocompact` flag and managed
  settings are invisible to a status line and are not read.
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
