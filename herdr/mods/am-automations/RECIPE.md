# am-automations

Scheduled agent prompts, as a side panel: a prompt, a cron line and a repo — every weekday at 09:00
an agent starts in a fresh worktree and works. The panel is where you find what ran while you were
away, start one now, pause them all, or write a new one with its next runs previewed. It needs
the `herdr-automations` scheduler, a separate program the pack does not install.

**It ships switched off**, footer tab included (#220): a fresh install puts it in
`<app home>/mods-disabled/am-automations`, where Herdr does not load it. To turn it on, open the
**Mods** panel, find *Automagik Automations* and switch it on; the footer's **Automations** tab then
appears. Without the scheduler the panel says what is missing and shows the command that installs
it (the pinned release, hash-checked, into `~/.local/bin`), with **Copy**; it never runs it. An
install that already has the mod keeps its state through updates, on or off (`OFF_BY_DEFAULT` in
`am-sidebar/release.js`; `am install herdr.am-automations` also switches it on).

Our fork of `DnzzL/herdr-automations` (MIT, kept verbatim in `LICENSE-upstream`, credited in
`NOTICE`): the pack owns this copy, upstream's two files are otherwise unchanged apart from this
mod's title and a fork header. The panel draws and asks; the Go scheduler `herdr-automations`
launches the runs and keeps the files — that binary is installed separately and is not part of the
pack.

## What you see

A card filling its block (`rounded(10)`, 1 px `border`, `background`), three parts top to bottom:
a 42 px header — "Automations", "Active" / "All paused", a switch, and `+`; while the scheduler
binary is missing, a `blocked`-tinted block with one line ("Missing the scheduler: herdr-automations
is not on PATH or in ~/.local/bin."), the install command and **Copy**; a `blocked`-tinted banner
with a solid **Start** button while no scheduler holds the lock; and a scrolling body in one of
three views:

- **List**: `INBOX` (finished runs not yet seen, with "Mark all read" and "Nothing new."), then
  `AUTOMATIONS` — per entry a dot, the name, `▶`, its schedule and next run, and "agent · model ·
  workspace · permissions"; entries that did not load follow on an `ansi1` tint with the message.
- **Detail**: name, `Run now` / `Pause` / `Edit` / `Delete` (delete asks once), schedule, next, repo,
  where it runs, agent, permissions, the prompt, and `HISTORY` per run with status, duration or error, and when.
- **Form**: name, schedule pills over a cron field, repo with `Choose…`, "runs in" (new worktree,
  repo root, existing space), agent pills (installed agents plus hc templates), model, `PERMISSIONS`,
  prompt, timeout, MCP config, and `Next: …` previewed live; `Cancel` / `Save`. A prompt naming a
  terminal address gets a `blocked`-coloured line under it.
- **PERMISSIONS** (#498): pills for the mode the run starts the agent in — `As saved: <mode>` (an
  existing entry), `Automatic (<flag>)` (codex and claude), `Agent default` — a line "Runs <mode>:
  <agent> <args>", and a field for more words to the agent (`agent_args` past the permission flags;
  quote a word with a space). pi and any agent without a known automatic mode get "<agent> has no
  known automatic mode: it runs with its own default." A template shows its command's mode instead,
  "<template>: <mode>. The template's command brings its own flags; the panel adds none."
  An entry saved with a retired agent (`gemini`) shows it as a dimmed `gemini (retired)` pill, picked;
  the value is kept and saved back unchanged, and no other form offers it.

## How it behaves

- **Finding the scheduler**: `herdr-automations version` on PATH, then
  `~/.local/bin/herdr-automations`. Neither answers: the repair block shows `repairCommand()` for
  this Mac's `uname -m` (`SCHEDULER` pins the release and its sha256s, from its `checksums.txt`),
  and every 30 s refresh looks again, so a scheduler installed meanwhile is picked up. Copy writes
  the command to the clipboard; the panel never runs it and never installs a login service (only
  **Start**, pressed by you, runs `service install`).
- Every read and write goes through the CLI (`ls --json`, `history --json`, `put [--dry-run]`,
  `rm`, `seen`, `run --bg`, `pause|resume`, `service install`); the panel never edits
  `automations.yaml` or `history.jsonl` itself. Config and state folders are watched to know when to
  ask again, plus a 30 s timer for next-run times and the scheduler's state.
- **Dot colours**: `working` while a run of it is live, `blocked` while it waits on you, `ansi1` when
  the last run failed or was missed, `dim` when paused, else `idle`; a run's terminal is found by the
  label `automation=<name>`.
- **Inbox**: clicking a finished run marks it seen and focuses its terminal if still live, else opens
  the automation.
- **Permissions** (#498, owner ruling 2026-11-06): a new automation starts on `Automatic`, the
  flags in `modes.js` `AUTO_ARGS` (codex `--dangerously-bypass-approvals-and-sandbox`, claude
  `--dangerously-skip-permissions`: an unattended run must be able to work); `Agent default` saves
  no permission flag. An existing entry opens on `As saved` and goes back exactly as it came:
  nothing is migrated or rewritten on load or on an edit that leaves the mode and args alone. Its
  saved args are kept exactly only while its agent is the saved one: switching to another agent drops
  every permission flag from the words that carry over and lands on `Agent default`, never on
  `Automatic`; switching back brings `As saved` back. A template run is given no flags (the
  scheduler passes none to a template anyway).
- **Put changes only the keys it is sent** (v0.12.0; up to v0.11.3 it replaced the whole entry,
  #501). A sent key with an empty value is removed, a key not sent is kept. So `agent_args` always
  goes, `[]` for none (leaving it out would keep the old flags after `Agent default`), and the form
  still sends back `catch_up_minutes`, `disabled` (a paused entry stays paused) and `workflow`.
- **Closing a run's workspace** (#498): the scheduler closes a fresh run's workspace once the run
  is `done` when its entry says `close_workspace: on-success` (v0.12.0; failed and blocked runs
  stay open; refused with `workspace: existing`, so a workspace you already had is never closed).
  The panel cannot set it yet: v0.12.1's `put` and `ls --json` have no such field, and a sent key
  with no value is removed. Write it by hand in `automations.yaml`; the panel never sends the key,
  so an edit keeps it (and `session` too).
- **Address warning** (#498): a prompt holding an hc address (`t3q1`, `build-box/t9`: a `t`, a
  digit, then letters and digits) is warned about on every preview and on Save, "… is a terminal
  address; it changes on restart. Name the bot instead"; it is saved all the same. A name given with
  `hc --name` is not caught, and a branch shaped like one (`feat/t3q1`) is warned about too, by design.
- **Form** re-runs `put --dry-run` on every keystroke or pill (last answer wins), so the previewed
  next runs are the server's; `Save` runs `put` (with `--original` when editing).
- **Toasts**: a run that turns `failed` or `missed` after the panel started posts a notification;
  clicking it focuses the run's terminal when live.
- `bash: put` gets its JSON through `sh -c 'printf %s "$json" | "$bin" put …'` because `exec` has no
  stdin; `run` is always `--bg` so the 30 s exec limit never truncates a run.

## Built from

`mods/am-automations/main.js`, `agents.js` (which agents the form offers, never a retired one),
`modes.js` (permission flags read as a mode, the automatic flags, the address check; pure),
`retired.js` (the retired agents: a byte-equal copy of am-sidebar's, the pack's one list),
`automations.svg` (a clock, 24×24 stroke), `mod.json`
(`place: "none"`, title "Automations"), `LICENSE` (this pack's Apache-2.0) and `LICENSE-upstream`
(DnzzL's MIT, verbatim). Herdr API: `exec`, `hc`, `home`, `theme`, `terminals`, `spaces`, `run`,
`notify`, `pickFolder`, `watchFolder`, `knownAgents`; `InputState`, `TextareaState`.

Programs: `herdr-automations` (the scheduler; installed separately as a login service), `hc`
templates, `sh`, and the agents a run starts (`claude`, `codex`, `pi`).

## Watch out

- **It runs programs**: `herdr-automations` on every action, `hc templates` for the form, and it
  starts agents. It reaches no network and writes no file itself.
- Without the scheduler binary the panel shows the repair block instead of the list. Shipping the
  scheduler with the pack (an RFC 0012 part, installed by `am install`) comes later; until then a
  new scheduler release means updating `SCHEDULER` (version and both sha256s) by hand.
- `exec` has no stdin and a 30 s limit: both are worked around (shell printf, `--bg`), and a very
  slow `ls`/`history` would show as an error rather than a hang.
- The fork means upstream changes arrive by hand; `LICENSE-upstream` and the NOTICE entry must stay.

## Done when

`herdr-app check mods/am-automations` passes; with the scheduler installed the panel lists the automations
the CLI lists; `+` saves a new one with its next three runs previewed; `▶` opens a run in a new space;
the switch writes `paused: true` and the header reads "All paused".
