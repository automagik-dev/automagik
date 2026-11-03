# RFC 0013: The work and code switch

| Field | Value |
|---|---|
| Status | Draft (owner's answers in: D27 and Decided) |
| Milestone | not scheduled |
| Lanes | desktop (3.N), plugin (3.N.P), herdr (3.N.P, [RFC 0011](0011-monorepo-parts-and-releases.md)) |
| Created | 2026-11-03 |

## Summary

Automagik is one product with two windows. Work is the app as it is today: DSH and the Bot
team. Code is herdr-app, used exactly as today with its mods. Nothing in Herdr is rebuilt; this
RFC only glues the two together. A Work / Code switch in Automagik brings the real herdr-app
window forward, on the space for the current Bot's folder. A button in Herdr brings the person
back to that Bot. One install sets up DSH, herdr-app and the Automagik Herdr pack. Both modes
read one Bot registry and one pet system. Felipe's answers are D27 (2026-11-03).

## Motivation

Felipe wants one Automagik for work and code (D7, D12; "start the switch", 2026-11-03). Today
people switch between the two apps by hand. Nothing carries the Bot or the folder across.
Nothing tells them Herdr is missing, out of date, or has an agent that needs them.

He first asked for one window with both modes in it. A spike tried that
(`spike/code-mode-in-wrapper`, see Alternatives). One window works only by rebuilding Herdr's
UI inside the wrapper. D27 rejects any rebuild: two windows, one product, glue only.

## Design

### Where the switch lives

On macOS the app has no title bar. DSH's page fills the window, and the traffic lights sit in
the Bot sidebar's top row (`frame.js`, `sidebar.js:800`). So the switch goes in the sidebar's
top row (`.bt-side-top`), the same place on every OS. It is part of the Bot team plugin. It
shows only when the app's preload exposes `omniDesktop.herdr`, the same feature check as
`desktop-update.js:30`. DSH in a browser, or an older app, shows no switch.

The switch is two segments, Work and Code. Work is lit while this window is in front. The Code
segment carries Herdr's state:

| State | How it is known | What Code shows | A click does |
|---|---|---|---|
| Not set up | no herdr-app, or no pack | "Set up" | runs the code set's install (delivery 6) |
| Update due | a newer herdr-app exists | "Update" dot | offers the update; yes updates, then opens; no opens the installed one |
| Closed | herdr-app found, `status` exits 2 ("no Herdr window") | plain | starts Herdr, then opens |
| Open | `status` exits 0 | a count of agents that need the person, from `ls` | opens |

The state is read when the window gains focus and when the person hovers the switch. There is
no timer. The switch moves only on a click. There is no keyboard shortcut and no menu item, and
nothing switches on its own (D27). Automagik stays open behind Herdr; it never hides.

### Launch and focus protocol

It runs in Electron's main process (`apps/desktop`), never in the Bot team server. RFC 0010's
server fence will confine DSH, and the launch must not come from inside it. The sidebar sends
`{ botId, folder, machine }` over IPC. Main accepts it only from DSH's page, the same check as
the update channel. Every call to herdr-app is `execFile` with an argv array, never a shell,
with a 10 s limit.

1. **Find.** The path the installer recorded for the code set (delivery 6). Before that, in
   order: the `AUTOMAGIK_HERDR_APP` override; herdr's own install path for the OS (see
   Cross-OS); then `herdr-app` on PATH. An app started from Finder has no `~/.local/bin` on its
   PATH, so the install paths come first.
2. **Latest.** The installed `--version` is compared with the feed's `latest.json`. When a newer
   herdr-app exists, the switch offers the update. On yes, it updates
   before code mode opens; on no, it opens the installed one. With no network it opens the
   installed one, with a note. herdr-app's own `app.update` restarts the window, and its
   terminals keep running in herdr-core.
3. **Start or raise.** On macOS through LaunchServices (`open -a <Herdr.app>`): it starts or
   raises the app, and Herdr is not a child of Automagik. On Linux and Windows, the bare binary,
   detached, which "opens or raises the window" (herdr-app skill). herdr-app has no raise
   command, so raising on Linux and Windows is an acceptance check per OS.
4. **Wait.** `status` until it exits 0, for up to 10 s. Exit 2 means no window yet.
5. **Pick the space.** `ls`, then the space whose `folder` is the Bot's folder (`workDir`,
   `roster.js:200`) on the Bot's machine. Spaces on every machine count, remote ones too (D27).
   A Bot's machine is this computer unless its registry entry names another. A match gets
   `space.select --id`. Two matches: the active one, else the first. No match: `space.new --name
   <folder name> --folder <folder> --machine <machine>`. A Bot with no folder (a global Bot,
   D3) gets code mode with no space picked: Herdr comes forward as it was.
6. **The Bot's agent.** Once both apps share Bot ids (the registry RFC, delivery 7):
   `automagik-herdr whois --bot <id> --json` names the Bot's pane, and `agent.focus` shows it.
   A Bot with no pane in its space gets its agent started (D27), through Herdr's own `start
   <bot> --space <id>`. That keeps Herdr's labels, attach ledger and briefing. The pack starts
   agents on this computer today; remote starts come as soon as it supports them. Until the
   registry lands, the space is the target and nothing starts.

RFC 0006 names mirrored spaces after Bots. This RFC matches by folder, because the folder is
what `ls` returns and what a person's own spaces already carry.

**The way back.** The Automagik Herdr pack gets a Work button (in `am-footer`). It opens
`automagik://open?bot=<id>` with the OS's link opener (`open`, `xdg-open`, `start`). The id is
the Bot attached to the focused pane, or none. The app focuses its window and selects that Bot.
The app registers `automagik://` and keeps `omni://` as an alias (D27): both open the same way,
and `omni://connect` is unchanged (`deeplink.js`, `main.js:101-131`).

### One install

One install sets up the whole environment: DSH, herdr-app and the Automagik Herdr pack (D27).
It runs through the `am` and parts plan (RFC 0012, not yet written): the code set (`part.json`,
`set: ["code"]`) installs herdr-app and the pack. The pack is checked against our signed
manifest, herdr-app against the sha256 in herdrdev's feed. `am doctor` feeds the switch's state. There is no Homebrew card. The herdr-app it installs
is `dev.herdr.app`, from herdrdev, which updates itself. Updates follow step 2: offered, and
done on yes.

Until that installer ships, the switch shows only where herdr-app is already set up.

### Shared state

The registry format belongs to its own RFC, written before the shared-Bot delivery (D27). This
RFC states only who reads and writes what. The switch itself writes none of it: it passes a Bot
id, a folder and a machine.

| Data | Where | Work (Bot team) | Code (Herdr pack) |
|---|---|---|---|
| Team state: Sessions, rooms, memory, schedules | `~/.automagik/bots` (`state.json`) | reads, writes | never |
| A repo's Bot definitions | `<repo>/.automagik/bots/bots.json`, version 2; fallback `.herdr/bots.json` | reads, writes, if unchanged since read | reads, writes, if unchanged since read |
| A repo's custom pets | `<repo>/.automagik/bots/pets/` | reads | reads |
| Pets | `~/.automagik/bots/pets/<character>-<colour>/` | reads (team source, `pets.js`) | reads `frames/` |
| Pet bakes | `automagik-pets bake` writes the folder above, atomically | calls it | calls it |
| Pose map | `STATE_ROWS` / `EVENT_ROWS` in `pet.js` | owns | reads the same map |
| Layout, spaces, attach ledger | `~/.config/herdr-app`, the pack's ledger | reads through the CLI only | owns |

The repo copy holds definitions only: never memory, rooms, schedules, secrets or browser
partitions. Ids are opaque and never rewritten. Both shapes are valid (`b-` + 10 base32, and
`session-<uuid>`).

Two moves come first. The registry RFC owns both:

- The desktop app's Bot home is `~/.automagik/desktop/bots` today (`dsh.js:707`). D6 moves it
  to `~/.automagik/bots`. Until then, the app and Herdr see different pets and Bots.
- Herdr reads `.herdr/bots.json` (`model.js:13`). `botsFileOf()` reads the new file first.

### Cross-OS

All three OSes ship at once (D27).

| | macOS | Linux | Windows |
|---|---|---|---|
| Herdr build (`dev.herdr.app`) | aarch64 only, no Intel Mac | x86_64 and aarch64 | x86_64 only, Windows 10 1803+ |
| Installed at | `/Applications/Herdr.app`; CLI `herdr-app` | `~/.local/share/herdr-app`; `herdr-app` in `~/.local/bin` | `%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`, on PATH |
| `ls`, `do`, `status` | verified (0.1.12) | documented, not yet run | documented, not yet run; socket or named pipe unknown |
| Start or raise | LaunchServices | detached binary; Wayland may refuse focus | detached binary; Windows may flash the taskbar instead |
| Return link | `open` | `xdg-open`; deb registers the schemes, AppImage unverified | `start`; NSIS registers the schemes |
| Automagik app | ships | packages (#191) | needs #191's four fixes first |
| Window close | keeps running | quits herdr-app (`window.close`) | unverified |

Terminals live in herdr-core, so a closed window loses none of them; the next click starts it
again. Where the OS refuses to raise a window, the switch says "Herdr is open in another
window". Shipping all three at once makes #191's Windows fixes and the cross-OS harness
prerequisites, not follow-ups.

Every build comes from herdrdev's feed, `https://releases.herdr.dev/app/latest.json`: version,
`core_min`, and a URL and sha256 for each target (`herdr-app-<target>.tar.gz`). herdrdev
publishes no GitHub release assets. Its installers (`install.sh` for Linux and macOS,
`install.ps1` for Windows) install herdr-core and `hc` when missing, and running them again
updates the app. #191's Linux and Windows results were for penso/herdr-gpui, a different
project, so they do not carry over. Linux and Windows `ls` and `do` are proven by delivery 1's
harness, or delivery 1 does not ship.

### Sandbox (RFC 0010)

D27 puts herdr-app inside Automagik's environment. Here that means installed, kept latest and
checked by Automagik's installer, like DSH. It does not yet mean fenced. RFC 0010 recorded code
mode as outside every boundary (gap 6). This RFC keeps the process side of that and changes the
install side:

- herdr-app never runs as a child of the app or DSH. On macOS LaunchServices starts it. On
  Linux and Windows it starts detached, with the app's own launch environment and none of the
  names the supervisor sets for DSH (`DSH_HOME`, `AUTOMAGIK_*`).
- Its agents run as the person and need the person's git and SSH credentials, which 0010's
  server fence denies. herdr-app is installed and kept latest now; a fence for code mode comes
  later, through 0010's boundary API (Decided 2).
- The launch runs in the main process, so 0010's fence on DSH does not break it.
- Under the fence, DSH writes `~/.automagik/bots` and repo files only inside a session's
  workspace. A repo's `bots.json` is in its Bot's workspace, so that write stays allowed.
- If services move into an Arca guest later, `~/.automagik/bots` needs 0010's mount contract,
  with file-watch, or the two modes stop seeing each other's edits. herdr-app stays on the host.

## Contracts introduced

- **The `automagik://` scheme.** New: `automagik://open` and `automagik://open?bot=<id>`.
  `omni://` stays registered as an alias; `omni://connect` keeps its meaning.
- **`bot` on `open`.** New, on both schemes. It only selects the Bot. An unknown or malformed id
  opens the app and selects nothing.
- **Preload bridge `omniDesktop.herdr`**: `status()`, `open({ botId?, folder?, machine? })` and
  `onOpenBot(callback)`, which a link fires. New. The plugin checks for it; an app without it
  shows no switch.
- **IPC channels** `automagik-herdr-status`, `automagik-herdr-open` and `automagik-open-bot`.
  Between the preload and the main process only.
- **`AUTOMAGIK_HERDR_APP`**: a path override for the binary. New.
- **Log** `~/.automagik/desktop/logs/switch.log`. New, local only.
- **The herdr-app surface we depend on** (not ours): `status` exit codes (0 open, 2 no window);
  `ls` JSON (`spaces[].id`, `folder`, `machine`, `active`, terminal `status`); `do
  space.select`, `space.new`, `agent.focus`. Kept latest, so the check is against the newest
  release. The pack's `start` and `whois --json` are ours (`herdr/`), later `am` verbs (D22).
- Plugin ids, routes, storage prefixes and `~/.automagik/bots` do not change.

## Threat model

- **Who reaches the bridge.** Any script in DSH's page, so any DSH client plugin. It can start
  Herdr, select or create a space, and (after delivery 7) start the Bot's agent. Starting an
  agent spends the person's tokens, so it happens only from a click on the switch. The folder
  must be absolute and an existing directory on this computer, or a folder from the registry for
  a remote machine. It goes as one argv element.
- **The links.** Any web page or app can fire `automagik://open?bot=<id>`. It brings Automagik
  forward and selects a Bot. It never starts, sends or changes anything. The id must match the
  registry's id shapes.
- **Herdr's socket.** `~/.config/herdr-app/herdr-app.sock` is mode 0755, so only its owner can
  connect. Any process of the same user can already drive Herdr. The switch adds nothing to that.
- **The install.** herdr-app is a third-party app. Each download is checked against the sha256
  in herdrdev's `latest.json`; that proves the file matches the feed, not who made it. After
  the first install, herdr-app updates itself, and no release passes a review of ours.
- **Undo.** Revert the release. The switch keeps no state but its log.

## Failure modes

| Failure | What the person sees | Log line |
|---|---|---|
| Not set up | "Set up" (after delivery 6); before it, no switch | `missing` |
| The person declines the update | Herdr opens on the installed version | `declined <version>` |
| The update fails or there is no network | Herdr opens on the installed version, with a note | `stale <version>` |
| No window within 10 s | "Herdr didn't open", with Retry | `timeout`, the last stderr line |
| A stale socket (exit 2 after a crash) | treated as closed: start, then retry once | `restart` |
| `do` answers `{ "error" }` (exit 1) | Herdr comes forward; the switch shows the message | `do-error` and the message |
| The folder is gone, or the Bot has none | Herdr comes forward with no space picked | `no-space` |
| The remote machine is offline | Herdr comes forward; "<machine> is offline" | `machine-offline` |
| The Bot's agent fails to start | Herdr shows its own error toast in the space | `start-error` |
| The OS refuses focus | "Herdr is open in another window" | `no-focus` |
| An older app and a newer plugin | no switch | nothing |
| Two writers on a repo's `bots.json` | the second write is refused; it re-reads | the writer's own error |

## Telemetry

There is no remote product telemetry today (`privacy.js` holds only third-party shares). The
switch writes local lines to `logs/switch.log`, in `timeline.js`'s step format: found, latest,
started, ready, space, agent, raised, each with its ms, and the outcome. Bot ids, never names.
Any remote send would be a new share on the Privacy page, off by default.

## Test plan

- **Unit (desktop, `node --test`).** A pure planner turns `ls` JSON, a Bot id, folder and machine
  into the herdr-app argv list: match, no match, two matches, a remote space, no folder, a pane
  to focus, no pane to start. The finder runs against a fake file system for each OS. A fake
  `herdr-app` on PATH records argv and answers canned JSON and exit codes.
- **Unit (desktop).** `deeplink.test.js` covers both schemes, `bot` ids good and bad, and that
  `omni://connect` is unchanged.
- **Unit (plugin).** The switch renders only with the bridge; each state shows its label; a
  link's Bot is selected.
- **Mod.** `herdr-app check` on the pack's mod with the Work button.
- **Cross-OS.** Extend #191's `workflow_dispatch` harness. On macOS, Linux (under xvfb) and
  Windows: install the code set, start a window on a temp `HERDR_APP_HOME`, run `ls` and `do
  space.new`, fire `automagik://open`. Record whether each window raised.
- **Manual, with Felipe's OK** (it drives the real window): Code with Herdr closed, open and not
  set up (through `AUTOMAGIK_HERDR_APP`); a remote space; the Work button back to the same Bot.

## Deliveries

Prerequisites, tracked elsewhere: #191's four Windows fixes for the Electron app; RFC 0012's
`am` shell and parts (for delivery 6); the registry RFC (for delivery 7).

1. **Find and raise** (desktop). The finder, start or raise, the wait, and the bridge with
   `status()` and `open()` (raise only), on all three OSes.
   *Check:* the unit tests; the cross-OS harness raises Herdr on each OS.
   *Rollback:* revert. Nothing is stored.
2. **Automagik's links** (desktop). Register `automagik://`, keep `omni://`, and pass `bot` to
   the page through `onOpenBot()`.
   *Check:* `deeplink.test.js`; on each OS, `automagik://open` brings the app forward.
   *Rollback:* revert; `omni://open` still works.
3. **The right space** (desktop). `open()` picks or creates the space on the Bot's machine, or
   none for a Bot without a folder.
   *Check:* the planner's argv for each case; on macOS a Bot's folder opens its space.
   *Rollback:* revert; `open()` raises only again.
4. **The switch** (plugin). The sidebar control and its states, the click, and the
   `onOpenBot()` listener that selects the Bot. Ships after deliveries 1-3.
   *Check:* the plugin test; Code opens the Bot's space on each OS.
   *Rollback:* revert. The bridge stays unused.
5. **The way back** (herdr). The Work button in `am-footer` opens `automagik://open?bot=<id>`.
   *Check:* `herdr-app check`; a click brings Automagik forward on the same Bot.
   *Rollback:* revert the pack.
6. **One install, always latest** (desktop, after RFC 0012). "Set up" runs the code set's
   install; a click offers the update when a newer herdr-app exists.
   *Check:* on a fresh machine of each OS, one click ends with Herdr open on the Bot's space.
   *Rollback:* revert; the switch hides where code mode is not set up.
7. **The Bot's own agent** (desktop, after the registry RFC). `whois --bot`, then `agent.focus`;
   no pane starts the Bot's agent in its space.
   *Check:* a Bot with a live pane is shown; a Bot without one starts in its space.
   *Rollback:* revert; the space stays the target.

## Alternatives

**One window: code mode lite** (spike `spike/code-mode-in-wrapper`, `FINDINGS.md`, 2026-11-03).
The spike drew herdr-app's real spaces, tabs and splits in the Electron window, with live xterm.js
terminals on herdr-core's attach stream. It worked: key to echo p50 0.6 ms in the renderer, about
8 MB/s throughput, about 300 MB more memory with two busy panes. Its cost was about 5 dev-days,
plus 3-4 for layout editing, plus 1-3 days for each mod. Every mod's UI would be rewritten, and
herdr-app's keys, themes and palette lost. **Rejected (D27):** it rebuilds Herdr.

**One window: upstream embedding.** No embed, host-window, webview-pane or SDK mode exists or is
planned in herdr-app, herdr-gpui or herdr-core (the spike's route B). **Not available.**

**One window: docking herdr-app beside the wrapper.** macOS has no cross-process child windows.
Moving herdr-app through the Accessibility API lags on drag, fights over z-order and focus, and
breaks fullscreen and Spaces (route C). **Rejected.**

## Decided

D27 answered the first fourteen questions. Felipe answered the next five on 2026-11-03 (relayed
by t259).

1. **The Herdr source** is `dev.herdr.app`, from herdrdev, self-updating. It ships macOS,
   Linux and Windows builds (t22n, from herdrdev's feed).
2. **Sandbox.** herdr-app is installed and kept latest now. The fence comes later.
3. **Updates.** The switch offers an update and does it on yes. With no network, it opens the
   installed version with a note.
4. **Remote starts** come as soon as the pack supports them. Spaces on every machine count now.
5. **Before RFC 0012's installer,** the switch shows only where herdr-app is already set up.

## Open questions

1. **No Intel Mac and no Windows on ARM.** herdrdev's feed has `macos-aarch64` and
   `windows-x86_64` only. The Automagik app may run on both, so code mode would be missing
   there, which conflicts with "all three OSes". Recommended: hide the switch on those two and
   ask herdrdev for the builds.
2. **Linux and Windows control is unproven.** herdr-app documents `ls`, `do` and `status` on
   every OS, but nobody has run them on Linux or Windows. The Windows transport (socket or named
   pipe) is unknown. Recommended: delivery 1's harness proves them; ask herdrdev if it fails.

## Links

- Handoffs: `~/.config/herdr-app/handoffs/bot-system-unification.md` (D1, D4, D6, D7, D10, D12,
  D13, D15, D20, D22, D27); `council-desktop-shell-2026-11-02.md` (synthesis, finding 4);
  `pocket-into-automagik-monorepo.md` ("One am CLI", "Parts").
- Spikes: #182 (Tauri, FINDINGS.md), #191 (cross-OS matrix), `spike/code-mode-in-wrapper`
  (`apps/desktop-code-mode-spike/FINDINGS.md`). PR #190 (Herdr import, merged).
- RFCs: [0006](0006-herdr-terminal-mode.md) Herdr terminal mode,
  [0010](0010-desktop-sandbox.md) desktop sandbox;
  [0011](0011-monorepo-parts-and-releases.md) monorepo parts and releases;
  0012 (`am` CLI and parts, not yet written); the registry RFC (not yet written).
- Code: `apps/desktop/src/deeplink.js`, `main.js:101-131`, `frame.js`, `dsh.js:707`;
  `apps/bots-dsh/src/client/sidebar.js:800`, `client/pet.js`, `host/pets.js`, `host/roster.js:200`;
  `herdr/mods/am-sidebar/model.js:13`.
