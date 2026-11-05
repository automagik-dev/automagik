# Meter status line

Automagik Meter's Claude Code status line, and the limits logger it runs behind. Both are local
tools: no release ships them (`scripts/lane.ts`, `NEVER_SHIPPED`).

```
🤖 Meter Captain  🧠 Opus 5.5 ⚡high  ┃  📁 my-app  ┃  💬 Context ▰▰▰▰▱▱▱▱▱▱ 400k/1M  ┃  Quota 5h ▰▰▰▰▰ 94%  Left 16m  Resets 59m  ┃  Quota 7d ▰▰▱▱▱ 31%  Resets 4d2h
```

Each segment is left out when its field is missing. Separators and labels are dim; green under
70%, yellow from 70%, red from 90%. `NO_COLOR` turns colour off. Narrower than one line
(`COLUMNS`, which Claude Code sets), the quota moves to a second line.

- `🤖`: the bot this Herdr pane plays, only in a Herdr pane (`HC_TERMINAL_ID` set):
  `automagik-herdr whois --json <terminal>`, run as `/bin/sh ~/.local/bin/automagik-herdr` (the
  launcher finds its own node, so a bare PATH is fine), then the bot's name in
  `<project>/.herdr/bots.json`. whois gets 1.5 s, then SIGKILL; the answer, a miss included, is
  cached 10 minutes per terminal in the Meter state folder (`statusline-bots.json`). Only expired
  entries are dropped, so every live pane keeps its own (past 512 live terminals, the oldest go).
- `🧠` and `⚡`: the model and `effort.level`
  ([statusline](https://code.claude.com/docs/en/statusline)); Claude Code sends no effort when the
  model has no effort setting, and then no effort word is shown.
- `📁`: the folder the session is in.
- `Context`: a 10-cell bar of the context window used, then the tokens used and the window size.
  The bar fills against the context window; its colour is measured against the auto-compact
  window, found where Claude Code takes it
  ([model-config](https://code.claude.com/docs/en/model-config), "Set the auto-compact window"),
  first match winning:
  1. `DISABLE_AUTO_COMPACT` or `DISABLE_COMPACT` set, or `autoCompactEnabled: false` in the
     highest settings file naming it: auto-compact is off.
  2. `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, when it is a usable size (`200000`, `200k`, `1M`; held to
     100k-1M as Claude Code holds it). An unusable value is ignored, as Claude Code ignores it.
  3. The first of the project's `.claude/settings.local.json`, its `.claude/settings.json` and the
     user `settings.json` (`CLAUDE_CONFIG_DIR` or `~/.claude`) that names a window:
     `modelSettings["<model id>"].autoCompactWindow`, else the top-level `autoCompactWindow` of that
     file. `"auto"` (the model's tuned window) or anything not a number: no window.

  With no window (off, `"auto"`, or none set) the colour is measured against the context window;
  no default is guessed. The window is capped at the context window, as Claude Code caps it. A
  one-launch `--autocompact` flag and managed settings are invisible to a status line.
- `Quota 5h` / `Quota 7d`: a 5-cell bar and the `rate_limits` used %, then `Resets`, the time until
  the window resets. Claude Code drops a window once it resets, and sends none before the
  session's first reply.
- `Left`, in red: when the window runs out at the current rate, shown only when that comes before
  the reset. The rate comes from the limits log's readings of the same window (same `resets_at`);
  only the log's last 256 KiB is read. Each session logs the value it last saw, so a resumed
  session logs a stale lower one with a fresh time, and sessions side by side alternate between
  neighbouring values. Used % never falls within a window, so the used % at a time is the highest
  reading up to it. The rate is the rise from a start to now. The start is the last reading at or
  before the lookback's start (1 h for 5h, 6 h for 7d), when it is no older than two lookbacks;
  else (the log does not reach back, or a gap) 5 minutes after the first reading inside the
  lookback. A start less than a quarter of the lookback ago measures nothing, and a measured rise
  of nothing shows no `Left`. With no measure, the rate is the used % over the time since the
  window started.

| File | What it is |
| - | - |
| `automagik-statusline.mjs` | The status line: stdin JSON in, one line out. Node, no dependencies, never throws. |
| `claude-limits-statusline.mjs` | The limits logger (imported from the copy the owner ran; since #313 it runs the command's argv directly, no second shell): appends `rate_limits` readings to `claude-limits.jsonl`, then runs the command after `--` with the same stdin. |

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
