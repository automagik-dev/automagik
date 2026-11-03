# Spike: code mode inside the Automagik desktop window

Date: 2026-11-03. Branch `spike/code-mode-in-wrapper`. Time-boxed (~3 h), not for merge.
Question (Felipe): "i need one thing wrapper with both in it": can apps/desktop (Electron) show
code mode in its own window, so one app window holds both work and code?

## Answer

**Yes, by route A: our own code mode on herdr-core.** It works in this spike. One Electron window
lists herdr-app's real spaces, tabs and split layouts, and runs live xterm.js terminals on herdr-core's
attach stream. Transport and render cost are negligible next to typing.

Routes B and C rule themselves out. Upstream has no embed, host-window or webview mode, documented
or planned (B). macOS has no cross-process way to put herdr-app's window inside ours (C). herdr-app itself
reaches the core through `herdr-core connect`, the same protocol this spike uses.

Recommendation: build **"code mode lite"** in apps/desktop on herdr-core:
- Terminals, agents, spaces and splits live in the window.
- An "Open in Herdr" button covers what only herdr-app has, mods above all.

Both apps read the same spaces from the same core, so Herdr stays available next to the wrapper and
nothing is either/or. Cost: **about 5 dev-days** for the first shippable version, plus **3–4 days** to edit
layouts. Mod parity is out of scope (see Cost).

## How the spike ran (and what it never touched)

- **Isolated core.** All live work ran on a separate core: `HC_SESSION=spike` with scratch XDG paths
  (`XDG_STATE_HOME=/private/tmp/claude-501/hcs/state`; a short path is needed because macOS caps
  socket paths at 103 bytes). Its terminals: `demo-echo` (`cat`), `demo-shell` (`bash`) and `demo-top`,
  all labelled `spike=code-mode`. Its `herdr-app` doc was seeded by `seed.mjs`, which refuses the
  default core.
- **Felipe's core was read only.** The calls were `doc.get herdr-app`, `events.subscribe` and the
  `machine ls` listing; there was no attach, no send and no write. `main.mjs` refuses to attach on a
  read-only core and refuses any terminal without the spike label.
- **herdr-app was never started, driven or reconfigured.** It was observed only passively: its memory
  and child process with `ps`, its sockets with `lsof`, and its files read from disk without changing
  them (`view.json`, `window.json`, `herdr.d.ts`, the telemetry folder listing, and the core's
  `docs.json` and `machines` list).
- **Files** (all in this folder):
  - `hc-client.mjs`: about 150 lines; the whole client.
  - `bench.mjs`: transport numbers in bare Node.
  - `main.mjs`, `index.html`, `renderer.js`: the Electron window.
  - `seed.mjs`: seeds the isolated core.
- **Run it:** `bun install && node node_modules/electron/install.js`, then
  `CODE_MODE_SOCKET=<isolated sock> CODE_MODE_READONLY_SOCKET=~/.local/state/herdr-core/default/default.sock ./node_modules/.bin/electron .`
  Add `CODE_MODE_BENCH=<file> CODE_MODE_QUIT=1` to measure, screenshot and quit.
- **Screenshot (local only, gitignored):** `apps/desktop-code-mode-spike/shots/code-mode-window.png`,
  2800×1656, captured with `webContents.capturePage()` of our own window. It shows:
  - the header Work | **Code** switch and the breadcrumb "Spike › split";
  - a sidebar with the real core (read-only badge) and its 10 spaces, then the spike core's "Spike" space;
  - a two-pane split, weights 1 : 1.5, which became 61 and 92 columns. The right pane has
    `seq 1 1000000` scrolled to `BENCH-DONE` and a live `bash-3.2$` prompt.

  The window's text dump is in `shots/bench-electron-3.json` → `window_text`. It is not committed
  because it lists Felipe's space names.

## Route A: our own code mode on herdr-core

### The real protocol (decoded, then confirmed upstream)

This was decoded first by proxying `hc attach` through a logging unix-socket proxy (`config.toml
socket = …`). It was then confirmed in herdr-core's own `schema/README.md`
(github.com/herdrdev/herdr-core, Apache-2.0, "preview, protocol generation 1"; the API in
`hc.openrpc.json`, also returned by `hc schema` and `rpc.discover`).

- **Transport.** A unix socket at `~/.local/state/herdr-core/<session>/<session>.sock` (a named pipe on
  Windows). `hc connect` speaks the same protocol over stdin/stdout, and `ssh box hc connect` works too.
- **herdr-app uses this same protocol.** Checked passively with `ps` and `lsof`: Herdr (pid 672)
  spawns `herdr-core connect` (pid 742) with pipes on stdin and stdout. That process's unix socket
  peer, `0xbca3321e5811cb12`, is a connection on the core's `default.sock`.
- **Handshake.** Plain JSON-RPC 2.0, one message per line. `hello {framed:true, generation:1}`
  switches the connection to framed mode after its reply.
- **Frames.** `[channel u32 LE][kind u8][len u32 LE][payload]`. Channel 0 carries JSON-RPC. The kinds:

  | kind | name | payload |
  |---|---|---|
  | 0 | DATA | terminal bytes |
  | 1 | CREDIT | u32 |
  | 2 | CLOSE | – |
  | 3 | RESIZE | u16 cols, u16 rows |
  | 4 | FOCUS | u8 |
  | 5 | FACTS | JSON display facts |
  | 6 | AUTOMATIC_INPUT | query replies; negotiated |

- **Attach.** `terminal.attach {terminal, cols, rows}` returns a channel. That channel carries a first
  paint, then the raw program output.
- **Flow control.** A stream starts with 256 KiB of credit. Measured: 261,651 bytes arrive before the
  stall with no CREDIT sent. A viewer more than 4 MiB behind gets a repaint instead of the backlog.
- **Spaces are in herdr-core, not in herdr-app.** herdr-app keeps its whole layout in the core
  document `doc.get("herdr-app")`:
  - `{spaces:[{id,name,folder,tabs:[{id,name,root}]}]}`, where `root` is a tree of `row` nodes and
    `block` nodes. Each block has `size.weight` and `content.terminal: "t21v"`.
  - On Felipe's core: 10 spaces, 27 panes. Every pane is a terminal; mods are not in the doc.
  - The doc is versioned (`doc.set` with a version, compare-and-swap), and `events.subscribe` emits
    a `doc` event when it changes. Not tested: whether herdr-app re-reads the doc live on that event.
  - Spaces of other machines (`g10/sp…`) probably come from those machines' cores. This is inferred
    from the `view.json` key prefixes and was not checked on a remote core.
  - `~/.config/herdr-app/view.json` holds only per-window view state (active space, focus, attention).

### Numbers

Sources: `bench.mjs` (bare Node over the socket) and the Electron window
(`shots/bench-electron-{1,2,3}.json`, 3 runs). macOS on Apple Silicon, hc 0.1.17, Electron 44.5.0,
xterm.js 5.5.0 with WebGL.

| Measure | Result |
|---|---|
| Key → echo, transport only (`cat`, n=280) | p50 **0.28 ms**, p95 0.43, p99 0.51 |
| Key → echo arrives in the renderer (IPC + hc + pty), n=200 ×3 | p50 **0.6 ms**, p95 0.8–1.5, p99 1.6–4.7 |
| Key → next animation frame after xterm parsed it, n=200 ×3 | p50 **1.0–1.2 ms**, p95 7.5–7.9, p99 8.9–12.6 |
| Throughput `seq 1 1000000` (7.9 MB): raw pty, no hc | 8.7–9.4 MB/s |
| Same through hc attach, bare Node | 8.5–9.6 MB/s (**no overhead**; the pty is the limit) |
| Same through hc + IPC + xterm.js, credit after parse | **7.4–8.7 MB/s**, about 1 s; every byte, nothing dropped |
| Electron RSS, 2 live panes after 1 M lines | 664–696 MB total: Tab 291–335, Browser 224–229, GPU 91–101 |
| herdr-app RSS (passive `ps`, 9.5 h uptime, 10 spaces, 35 mods) | 184 MB; herdr-core processes 4 + 32 + 18 MB |

How to read these:

- **Latency.** "Next frame" is the next `requestAnimationFrame` after xterm parsed the echo. Real
  pixels add the compositor and vsync, one frame (8–16 ms) on any app. The p95 jump to about 8 ms is
  waiting for the next frame, not transport.
- **Not measured: herdr-app end to end.** That needs typing into Felipe's herdr-app window. herdr-app
  reaches the core through `herdr-core connect` (see above): the same protocol plus one stdio pipe hop.
  So the 0.28 ms transport is common to both, and the difference is mostly the renderer (GPUI against
  xterm.js WebGL). herdr-app's local `telemetry/` folder (frozen, id, last-sent.json, queue, running,
  today.json) has no latency, frame or render fields. A like-for-like test
  is a follow-up that needs t2fp's approval: one dedicated space and `cat` terminal, the same key
  injection, and a frame capture of both windows.
- **Memory.** The wrapper already pays for Electron in work mode, so code mode's marginal cost is one
  renderer view, about 300 MB with two busy panes. Felipe's herdr-app is 184 MB. The spike was not
  tuned (scrollback, a single renderer for many panes).

### What Herdr features this keeps or loses

| Feature | In the wrapper | Evidence / note |
|---|---|---|
| Live terminals and agents, typing, resize, focus | **Keeps** | Working in the spike |
| Spaces, tabs, split layouts (read and show) | **Keeps** | `doc herdr-app`; the spike renders the tree with weights |
| Editing layouts (split, close, new tab, rename) | Keeps, with work | `doc.set` is compare-and-swap and emits a `doc` event. Whether herdr-app picks the change up live is unverified. The doc schema is herdr-app's private format, not a public contract |
| Agent status (working, blocked, done) and attention | **Keeps** | `events.subscribe` streams status, turn and title. `view.json`'s attention "seen" flags are herdr-app-local |
| Agents on other machines (6 connected: khal-labs, felipe, g9, g10, ryzen, hx470) | **Keeps** | Addresses like `machine/t7` attach through the core relay (schema README "core-to-core relays"). Not exercised: those terminals are not ours |
| Running beside herdr-app on the same spaces | **Keeps** (by design) | One core, one doc, and the core supports many viewers per terminal. Not exercised against Felipe's live herdr-app |
| One terminal open in both apps at once | Caveat | "The last active viewer sets the size", so the size flips to whichever app was used last |
| Mods (am-sidebar, am-tabs, am-footer, am-quota, pets, tasks, files, changes… 35 installed) | **Loses** | Mods are JS inside the GPUI process that render with `gpui-kit` (`herdr.d.ts`: `openOverlay`, `spaces()`, `agents()`). The logic (hc calls, exec) ports to the web; every UI is a rewrite |
| herdr-app keybindings, themes, command palette, update notes | Loses | `keys.json` and themes are herdr-app's. Themes map to xterm colors cheaply |
| Terminal emulation parity | Partial | The core advertises a `ghostty` identity, and agents use: synchronized output `?2026` (xterm.js 6.0 has it, 5.5 does not, so ship on 6.0); kitty keyboard (not in xterm.js); `?2031` colour-scheme reports (no); mode 2048 in-band resize (no); kitty graphics (no; sixel and iTerm images via `addon-image`). Query replies from xterm.js should go out as kind 6 AUTOMATIC_INPUT, or they take size ownership; xterm.js does not tag them at the source, so this needs a small filter |

## Route B: upstream (desk research)

**No.** Nothing documents or plans an embed, host-window, parent-window, reparenting, webview-pane or
SDK mode.

- **Installed app.** `/Applications/Herdr.app` is `dev.herdr.app` 0.1.12, from github.com/herdrdev/herdr-app.
  Its changelog matches `~/.config/herdr-app/update-notes-cache.md:3` ("[0.1.12] - 2026-11-02").
- **The cask.** `penso/tap/herdr-gpui` (v20261103.1) points at a different repo, github.com/penso/herdr-gpui.
- **Local grep.** The only hit is `update-notes-cache.md:52`, "Mod tooltips show in embedded windows".
  herdr-app PR #182 explains it as mod roots embedded inside Herdr's own `AppWindow`. The other hit,
  `gpui-kit.d.ts:146` `embedded_object`, is an accessibility role.
- **Webview goes the other way.** penso/herdr-gpui embeds web pages *in* Herdr ("Browser tabs" via
  wry, README:434). Its `docs/linux-browser-plan.md:45-46` "reparents" only wry inside its own window.
- **Issues and discussions.** Searches for embed, webview, parent window, reparent, SDK and electron
  across herdr-app, herdr-gpui and herdr-core found nothing relevant. The newest source seen is dated
  2026-11-03.
- **What upstream does offer:** herdr-core's documented, versioned protocol, which is route A.
- **Not reached:** GitHub code search hit its rate limit, so some terms were checked against the
  downloaded docs instead; herdr.dev and herdrui.dev were not fetched.

## Route C: macOS docking (desk research only, no demo)

**Rejected; no demo was built.** A meaningful demo needs a second herdr-app window, which means
starting herdr-app. A substitute window would not prove anything about herdr-app.

- **No cross-process child windows.** `NSWindow.addChildWindow` and NSView reparenting work only
  inside one process. macOS has no public API to make another process's window a child of ours.
- **The only route moves the window from outside.** The wrapper would watch its own `move`, `resize`,
  `minimize` and `enter-full-screen` events, then move herdr-app's window through the Accessibility
  API (`AXUIElementSetAttributeValue` on kAXPosition, kAXSize, kAXMinimized). The wrapper needs the
  Accessibility permission for that, which is a TCC prompt. It cannot make herdr-app borderless:
  only herdr-app sets its style. `herdr.d.ts:241-246` shows layouts can use `"titlebar": "none"`, but
  herdr-app still owns the window.
- **Why it breaks:**
  - **Lag.** Each move is an IPC round trip into another app, so the window trails by one or more
    frames during live drag and resize, and you can see it.
  - **Z-order and focus.** Clicking the wrapper raises it above herdr-app, and re-raising herdr-app
    takes focus away. Keyboard focus, the menu bar and Cmd-Tab belong to two apps.
  - **Fullscreen.** A fullscreen wrapper gets its own Space, and another app's window cannot join it.
  - **Spaces.** Moving the wrapper to another desktop leaves herdr-app behind.
  - **Minimise and Mission Control.** Two windows show, and they have to be minimised together.
  - **Dragging.** The user dragging herdr-app's window fights the glue.
- **Other platforms.** Windows `SetParent` across processes and X11 `XReparentWindow` exist, but
  Wayland has nothing like them, and Felipe's machine is macOS. Streaming the window with
  ScreenCaptureKit and injecting input would need Screen Recording and Accessibility permissions,
  and would add frame latency.

## Recommendation and cost

Build route A as **code mode lite** inside apps/desktop. Keep herdr-app as the power tool, reached
by an "Open in Herdr" button (the council's launch/focus protocol). Both apps share one core and one
spaces doc, so they run side by side.

| Step | What | Estimate |
|---|---|---|
| 1. First shippable version | hc client in main (from `hc-client.mjs`; spawn `hc connect` so the same code works over ssh and on Windows); code-mode view with the spaces sidebar and split layout from `doc herdr-app`, read-only; xterm.js **6.0** + WebGL panes with credit, resize, focus and AUTOMATIC_INPUT; status dots from events; reconnect after core restart and "hc missing → install"; per-tab views with focus and hide on mode switch | **~5 dev-days** |
| 2. Layout editing | New terminal or agent in a space, split, close, rename, and tab moves via `doc.set` with version checks (herdr-app follows live). Needs herdr-app's maintainer to bless the doc shape as a contract, or our own doc name | **3–4 dev-days** |
| 3. Port the mods that matter | Choose two or three (e.g. am-sidebar, am-tabs, am-quota): logic reuse, UI rewrite in our web stack | **1–3 days per mod** |
| Parity with herdr-app | Every mod, keybindings and GPUI rendering. A moving target (herdr-app ships daily) | Not recommended |

Risks to carry:

1. herdr-core's protocol is "preview, generation 1, only grows". It has a `released.openrpc.json`
   guard against breaking changes, so it is safe to build on.
2. The `herdr-app` doc shape is herdr-app's private format. Read it defensively, and ask upstream
   before writing to it.
3. Showing one terminal in two apps makes its size flip to the last active viewer.
4. Kitty keyboard and `?2031` are missing in xterm.js. Most visible: some key combos in agent TUIs.
5. Electron is heavier than herdr-app (a renderer of about 300 MB against 184 MB for all of
   herdr-app), though the wrapper already pays for Electron.

Next step to de-risk: the like-for-like latency test against herdr-app (one dedicated space and
`cat`), which needs t2fp's approval because it drives Herdr's window.
