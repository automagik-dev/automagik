# RFC 0013: The work and code switch

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | not scheduled |
| Lanes | desktop (3.N), plugin (3.N.P), herdr (3.N.P, RFC 0011, after #190) |
| Created | 2026-11-03 |

## Summary

The Automagik app gets a Work / Code switch. Work is the app as it is today: DSH and the Bot
team. Code is Herdr: the herdr-app window and its terminals. The switch does not embed Herdr.
It finds herdr-app, starts it if needed, brings its window forward and shows the space for the
current Bot's folder. A button in Herdr brings the person back. Both modes read one Bot
registry and one pet system. This RFC decides where the switch sits, the launch and focus
protocol, the install offer, what each side reads and writes, and the delivery order.

## Motivation

Felipe wants one Automagik app for work and code (D7, D12; "start the switch", 2026-11-03).
The desktop council (2026-11-02) found that no shell can embed herdr-app today. Its GPUI window
has no webview pane, no host-window API and no reparenting (`herdr.d.ts`). D10 forbids a fork.
So, under any shell, code mode is a launch and focus protocol over the herdr-app CLI or socket.
The cross-OS spike (#191) keeps Electron on macOS, Linux and Windows, and shows herdr-app has
builds for all three. People who use both today switch by hand. Nothing carries the Bot or the
folder across, and nothing tells them Herdr is missing or that an agent there needs them.

## Design

### Where the switch lives

On macOS the app has no title bar. DSH's page fills the window, and the traffic lights sit in
the Bot sidebar's top row (`frame.js`, `sidebar.js:800`). On Linux the shell bar exists, but the
sidebar's top row does too. So the switch goes in the sidebar's top row (`.bt-side-top`), the
same place on every OS. It is part of the Bot team plugin. It shows only when the app's preload
exposes `omniDesktop.herdr`, the same feature check as `desktop-update.js:30`. DSH in a browser,
or an older app, shows no switch.

The switch is two segments, Work and Code. Work is lit while this window is in front. The Code
segment carries Herdr's state:

| State | How it is known | What Code shows | A click does |
|---|---|---|---|
| Missing | no binary found | "Install" dot | opens the install card |
| Too old | `--version` below the supported minimum | "Update" dot | opens the update card |
| Closed | binary found, `status` exits 2 ("no Herdr window") | plain | starts Herdr, then opens the space |
| Open | `status` exits 0 | a count of agents that need the person, from `ls` | opens the space |

The state is read when the window gains focus and when the person hovers or clicks the switch.
There is no timer. An app menu item, "Switch to Code", does the same as a click. It lives in
the desktop app and asks the page for the Bot on screen (`onSwitch()`).

### Launch and focus protocol

It runs in Electron's main process (`apps/desktop`), never in the Bot team server. RFC 0010's
server fence will confine DSH. Herdr is outside that boundary, so the launch must not come
from inside it. The sidebar sends `{ folder, botId }` over IPC. Main accepts it only from DSH's
page, the same check as the update channel. Every call to herdr-app is `execFile` with an argv
array, never a shell, with a 10 s limit.

1. **Find.** In order: the `AUTOMAGIK_HERDR_APP` override; on macOS `/Applications/Herdr.app`,
   then `~/Applications/Herdr.app`; then `herdr-app` and `herdr-gpui` on PATH. An app started
   from Finder has no `~/.local/bin` on its PATH, so the macOS bundle paths come first.
2. **Check the version.** `--version` against the supported minimum (0.1.12 today). The release
   tags (`v20261102.2`) use another scheme; the CLI's own version is the one compared.
3. **Start or raise.** On macOS through LaunchServices (`open -a <Herdr.app>`): it starts or
   raises the app, and Herdr is not a child of Automagik. On Linux and Windows, the bare binary,
   detached, which "opens or raises the window" (herdr-app skill). herdr-app has no raise
   command, so raise behaviour on Linux and Windows is checked per OS (see Cross-OS).
4. **Wait.** `status` until it exits 0, for up to 10 s. Exit 2 means no window yet.
5. **Open the space.** `ls`, then match a space whose `folder` is the Bot's folder (`workDir`,
   `roster.js:200`) and whose `machine` is this computer. A match gets `space.select --id`. Two
   matches: the active one, else the first. No match: `space.new --name <folder name> --folder
   <folder> --machine ''`. That starts the person's shell there and no agent: the bridge has no
   argv or task field. A Bot without a folder (a global Bot, D3) only raises Herdr.
6. **Focus the Bot.** Later (delivery 6): once both apps share Bot ids, `automagik-herdr whois
   --bot <id> --json` names the Bot's pane, and `agent.focus` shows it. Until then the space is
   the target.

RFC 0006 names mirrored spaces after Bots. This RFC matches by folder, because the folder is
what `ls` returns and what a person's own spaces already carry. If 0006 ships, its spaces have
the Bot's folder too, so the rule still finds them.

**The return path.** The Automagik Herdr pack gets a Work button (in `am-footer`). It runs the
OS's link opener (`open`, `xdg-open`, `start`) on `omni://open`. The app already registers
`omni://` and focuses its window on `open` (`deeplink.js`, `main.js:101-131`). The link carries
nothing, so a page that fires it can only bring Automagik forward. The window still shows the
Bot the person left. A Herdr key for the same action is open question 13.

The Automagik window does not hide when Code comes forward, and nothing switches on its own
(see Open questions).

### When herdr-app is not installed

The Code segment opens a card. It says what Herdr is and offers the install for the OS:

- **macOS, today.** `brew install --cask penso/tap/herdr-gpui` (macOS 14+). When Homebrew is
  present, the card runs it on the person's click, in the background, with its output in the
  card. Without Homebrew, the card shows the command and a link to brew.sh.
- **Linux and Windows, today.** A link to the penso/herdr-gpui GitHub releases (deb, rpm,
  tar.gz; setup.exe, zip). Linux needs `libxkbcommon-x11-0`. The app downloads nothing itself.
- **Later, every OS.** `am install --set code` through the parts plan (RFC 0012, not yet
  written; `part.json`, `set: ["code"]`). It installs herdr-app and the Automagik Herdr pack,
  checks sha256 against our signed manifest, and `am doctor` feeds the switch's state.

The update card works the same way (`brew upgrade --cask herdr-gpui`, or the release link).
Nothing installs without a click.

### Shared state

The registry format belongs to the Bot system design (handoff: D1, D4, D6, "Agreed" and
"Conflicts"). This RFC states only who reads and writes what. The switch itself writes none
of it: it passes a Bot id and a folder.

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

Two moves come first, and both are tracked outside this RFC:

- The desktop app's Bot home is `~/.automagik/desktop/bots` today (`dsh.js:707`). D6 moves it
  to `~/.automagik/bots`. Until then, work mode in the app and Herdr see different pets and Bots.
- Herdr reads `.herdr/bots.json` (`model.js:13`). `botsFileOf()` reads the new file first.

### Cross-OS

| | macOS | Linux | Windows |
|---|---|---|---|
| Herdr build | cask, macOS 14+ | GitHub release, x86_64 and aarch64 | GitHub release, x86_64 and aarch64 |
| Binary | `Herdr.app`, CLI `herdr-app` | `herdr-gpui` | `herdr-gpui.exe` |
| `ls`, `do`, `status` | verified (0.1.12) | unverified: #191 ran `--help` only | unverified; the socket transport is unknown |
| Start or raise | LaunchServices | detached binary; Wayland may refuse focus | detached binary; Windows may flash the taskbar instead |
| Return link | `open` | `xdg-open`; deb registers `omni://`, AppImage unverified | `start`; NSIS registers `omni://` |
| Automagik app | ships | packages (#191) | needs #191's four fixes first |
| Window close | keeps running | quits herdr-app (`window.close`) | unverified |

Terminals live in herdr-core, so a quit window loses none of them. The next switch starts it
again. Where the OS refuses to raise a window, the card says "Herdr is open in another window".
macOS ships first. Linux and Windows follow once the cross-OS harness proves `ls` and `do`.

### Sandbox (RFC 0010)

Code mode sits outside every boundary. RFC 0010 already records this (gap 6) as decided:
herdr-app is a third-party app, its mods can exec, and its agents run as the person. This RFC
keeps it that way and adds:

- herdr-app never runs as a child of the app or DSH. On macOS LaunchServices starts it. On
  Linux and Windows it starts detached, with the app's own launch environment and none of the
  names the supervisor sets for DSH (`DSH_HOME`, `AUTOMAGIK_*`).
- The launch runs in the main process, so 0010's fence on DSH does not break it.
- Under the fence, DSH writes `~/.automagik/bots` (its home) and repo files only inside a
  session's workspace. A repo's `bots.json` is in its Bot's workspace, so that write stays
  allowed.
- If services move into an Arca guest later, `~/.automagik/bots` needs 0010's mount contract,
  with file-watch, or the two modes stop seeing each other's edits. herdr-app stays on the host.

## Contracts introduced

- **Preload bridge `omniDesktop.herdr`**: `status()`, `open({ folder?, botId? })` and
  `onSwitch(callback)`, which the menu item fires. New.
  The plugin checks for it; an app without it shows no switch.
- **IPC channels** `automagik-herdr-status`, `automagik-herdr-open` and `automagik-herdr-switch`.
  Between the preload and the main process only.
- **`AUTOMAGIK_HERDR_APP`**: a path override for the binary. New. Unset means the search order.
- **`omni://open`**: unchanged. No new parameters in this RFC.
- **Log** `~/.automagik/desktop/logs/switch.log`. New, local only.
- **The herdr-app surface we depend on** (not ours): `--version`; `status` exit codes (0 open,
  2 no window); `ls` JSON (`spaces[].id`, `folder`, `machine`, `active`, terminal `status`);
  `do space.select`, `space.new`, `agent.focus`. Pinned by the supported minimum version.
- Plugin ids, routes, storage prefixes, `~/.automagik/bots` and the `omni://` scheme do not
  change.

## Threat model

- **Who reaches the bridge.** Any script in DSH's page, so any DSH client plugin. The most it can
  do is start Herdr, and select or create a space at a folder. A new space starts the person's
  shell there and no agent. The folder must be absolute and an existing directory, and goes as
  one argv element.
- **The return link.** Any web page or app can fire `omni://open`. It only brings Automagik
  forward. The app takes no other action.
- **Herdr's socket.** `~/.config/herdr-app/herdr-app.sock` is mode 0755, so only its owner can
  connect. Any process of the same user can already drive Herdr. The switch adds nothing to that.
- **The install.** A third-party tap and release page. The cask carries its own sha256. Nothing
  installs without a click, and the app downloads no binary itself until parts check against our
  signed manifest.
- **Undo.** Revert the release. The switch keeps no state but its log.

## Failure modes

| Failure | What the person sees | Log line |
|---|---|---|
| No binary | the install card | `missing` |
| Version too old | the update card | `old <version>` |
| No window within 10 s | "Herdr didn't open", with Retry | `timeout`, the last stderr line |
| A stale socket (exit 2 after a crash) | treated as closed: start, then retry once | `restart` |
| `do` answers `{ "error" }` (exit 1) | Herdr comes forward; the card shows the message | `do-error` and the message |
| The folder is gone, or the Bot has none | Herdr comes forward on its last space | `raise-only` |
| The OS refuses focus | "Herdr is open in another window" | `no-focus` |
| An older app and a newer plugin | no switch | nothing |
| Two writers on a repo's `bots.json` | the second write is refused; it re-reads | the writer's own error |

## Telemetry

There is no remote product telemetry today (`privacy.js` holds only third-party shares). The
switch writes local lines to `logs/switch.log`, in `timeline.js`'s step format: found, version,
started, ready, space, raised, each with its ms, and the outcome. Bot ids, never names. Any remote
send would be a new share on the Privacy page, off by default.

## Test plan

- **Unit (desktop, `node --test`).** A pure planner turns `ls` JSON, a folder and a Bot id into
  the herdr-app argv list: match, no match, two matches, a remote space, no folder. The finder
  runs against a fake file system for each OS. A fake `herdr-app` on PATH records argv and
  answers canned JSON and exit codes, as `deeplink.test.js` fakes its inputs.
- **Unit (plugin).** The switch renders only with the bridge, and each state shows its label.
- **Mod.** `herdr-app check` on the pack's mod with the Work button.
- **Cross-OS.** Extend #191's `workflow_dispatch` harness. Install the herdr-gpui release on
  Linux (under xvfb) and Windows, start a window on a temp `HERDR_APP_HOME`, run `ls` and
  `do space.new`. Record whether the window raised.
- **Manual, macOS, with Felipe's OK** (it drives the real window): the switch with Herdr closed,
  open and missing (through `AUTOMAGIK_HERDR_APP`), and the Work button back.

## Deliveries

1. **Find and raise** (desktop). The finder, the version check, start or raise, the wait, and the
   `omniDesktop.herdr` bridge with `status()` and `open()` (raise only). No UI.
   *Check:* the unit tests; `status()` on macOS answers missing, closed and open correctly.
   *Rollback:* revert. Nothing is stored.
2. **The right space** (desktop). `open({ folder })` selects or creates the space. The app menu
   gets "Switch to Code". It tells the page through the bridge's `onSwitch()`; with no listener
   (an older plugin) it only raises Herdr.
   *Check:* the planner's argv for each case; on macOS the menu item raises Herdr.
   *Rollback:* revert; `open()` raises only again.
3. **The switch** (plugin). The sidebar control and its states, the install card with the
   command and links, and the `onSwitch()` listener that sends the Bot on screen.
   It ships after delivery 2, so it is complete at merge.
   *Check:* the plugin test; on macOS, Code opens the Bot's space.
   *Rollback:* revert. The bridge and the menu item stay.
4. **The way back** (herdr). The Work button in `am-footer` opens `omni://open`. It ships on the
   herdr lane after #190, or from automagik-herdr until then.
   *Check:* `herdr-app check`; a click brings Automagik forward on the same Bot.
   *Rollback:* revert the pack.
5. **Install from the app** (desktop). On macOS with Homebrew, the card runs the cask install on
   a click and shows its output; the update card the same.
   *Check:* on a Mac without Herdr, one click ends with Herdr open on the Bot's space.
   *Rollback:* revert; `brew uninstall --cask herdr-gpui` removes Herdr.
6. **The Bot's own pane** (desktop). After D6's home move, `botsFileOf()` and shared ids:
   `whois --bot`, then `agent.focus`.
   *Check:* a Bot with a live Herdr pane is shown, not only its space.
   *Rollback:* revert; the space stays the target.
7. **Linux and Windows** (desktop). The finder's paths and the raise checks for each OS. Windows
   waits for #191's four fixes.
   *Check:* the cross-OS harness passes on that OS.
   *Rollback:* the switch hides on that OS.
8. **Install through parts** (desktop, after RFC 0012). The card runs `am install --set code`
   on every OS, and `am doctor` feeds the state.
   *Check:* a fresh machine reaches Code in one click.
   *Rollback:* back to delivery 5 and the links.

## Open questions

1. **One window, or two?** This RFC gives two windows and a switch. One window needs a host-window
   or webview pane in herdr-app, or a fork, which D10 rules out. Who owns herdr-app's source is
   still open (D7, t22n's question). Recommended: ship two windows; ask upstream for a pane.
2. **Hide Automagik when Code comes forward?** Recommended: no. Voice and Bot browsers keep
   running, and a hidden window is easy to lose.
3. **Switch "on its own" (D7)?** For example, when a Bot starts a coding worker. Recommended:
   never move focus without a click; light the Code segment instead.
4. **Start the Bot's agent in Herdr when it has no pane?** Recommended: no. Show the space;
   starting an agent stays the person's choice in Herdr.
5. **A Bot without a folder.** Recommended: raise Herdr only, with no new space.
6. **Run Homebrew from the app?** Recommended: yes, on a click, when Homebrew is present.
7. **Install the Automagik Herdr pack from the same card?** Recommended: yes, once
   `am install --set code` exists; a link until then.
8. **The supported herdr-app version.** Recommended: a minimum, by `--version`, bumped by a
   reviewed PR, the same review as RFC 0006's pinned binary.
9. **macOS first?** Recommended: yes. Linux and Windows follow the harness.
10. **Remote spaces.** Recommended: match only spaces on this computer.
11. **A Bot in the return link** (`omni://open?bot=<id>`). Recommended: later, and it only
    selects the Bot.
12. **The scheme.** Recommended: keep `omni://`. An `automagik://` scheme waits for a naming
    decision across the app.
13. **The shortcut.** Recommended: one key for "Switch to Code" in the app menu, and the same key
    bound in Herdr to go back; chosen in delivery 2.
14. **Who writes the registry design?** The `bots.json` v2 shape, the id mint, global Bots in
    Herdr (D3) and the D6 move have no RFC. Recommended: one RFC before delivery 6.

## Links

- Handoffs: `~/.config/herdr-app/handoffs/bot-system-unification.md` (D1, D4, D6, D7, D10, D12,
  D13, D15, D20, D22); `council-desktop-shell-2026-11-02.md` (synthesis, finding 4);
  `pocket-into-automagik-monorepo.md` ("One am CLI", "Parts").
- PRs: #182 (Tauri spike, FINDINGS.md), #191 (cross-OS matrix), #190 (Herdr import).
- RFCs: [0006](0006-herdr-terminal-mode.md) Herdr terminal mode,
  [0010](0010-desktop-sandbox.md) desktop sandbox; 0011 (monorepo parts and releases, #190);
  0012 (`am` CLI and parts, not yet written).
- Code: `apps/desktop/src/deeplink.js`, `main.js:101-131`, `frame.js`, `dsh.js:707`;
  `apps/bots-dsh/src/client/sidebar.js:800`, `client/pet.js`, `host/pets.js`, `host/roster.js:200`;
  Herdr `herdr/mods/am-sidebar/model.js:13` (#190).
