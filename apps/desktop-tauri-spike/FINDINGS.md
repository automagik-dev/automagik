# Tauri 2 wrapper spike: findings

Question (D12): can a Tauri 2 thin wrapper replace the Electron app in `apps/desktop`?
Throwaway spike, measured on one Mac (Apple silicon, macOS 26.5.2) on 2026-11-02.
Tauri 2.12.5, wry 0.57.1, system WKWebView. How to run it: RUNNING.md.

> **Cross-OS (2026-11-03):** Electron is the only wrapper that passes every check on macOS, Linux and
> Windows. Tauri's Bot automation over CDP works only on Windows (WebView2). See "Cross-OS matrix" at the end.

## Recommendation: no-go as a drop-in replacement today; go for a follow-up spike on one blocker

Tauri does what the wrapper needs: it starts DSH, signs in, draws the page and answers IPC from
`http://127.0.0.1`. It uses **about 0.4 GB idle instead of about 1.0 GB**. It does not start any faster,
and the bundle shrinks only by Electron's 288 MB framework. A like-for-like re-measure on this Mac
narrows the memory win to about 0.35 GB (see "Like-for-like RSS (macOS)"; preliminary, screen locked).

Blockers:

1. **Bot browser automation is broken.** Bots drive their in-app browser with Playwright over
   CDP. In `bot-relay.js:202`, `webContents.debugger.attach` relays every page command to that
   view's Chromium debugger. WKWebView has no CDP and Playwright cannot attach to a system
   WKWebView, so Bots could not use the browser panel. The fix is either a new driver (scripts
   run in the page plus WKWebView snapshots: no trusted input, no network interception, no
   per-iframe or worker sessions) or a separate Chromium for Bot browsing. A separate Chromium
   gives back much of the memory win.
2. **Voice is unverified end to end.** The recording pipeline works, and the microphone
   and speech requests reach macOS's permission prompt. Nobody answered the prompt in
   this run (on purpose: speech recognition can send room audio to Apple), so recording
   from a real microphone and webkitSpeechRecognition were never tested with permission
   granted. While the prompt was pending, speech recognition only fired `end`.
3. **Node has to come from somewhere.** DSH needs Node >= 22.19 (node:sqlite, N-API addons).
   A Mac without one cannot start the app, so a release has to ship Node (+116 MB) or a
   launcher that installs one.

The Electron survey said per-bot browser views were off in the app; they are live on `origin/dev`
(bot-views.js:24, preload.cjs:49), which is why blocker 1 and the per-bot store check are here.

Everything else found is fixable in the wrapper (see "Breaks and fixes").

Next step if D12 keeps Tauri in play: a short spike of a WKWebView Bot driver, to measure how much
of the Playwright tool surface survives. That decides between "Tauri everywhere" and
"Tauri shell + Chromium only while a Bot browses".

## Checks

| Check | Result | Evidence |
|---|---|---|
| Spawn DSH as a sidecar, as dsh.js does | **works** | Rust spawns `node <runtime>/@deepseek-ai/dsh/lib/bin.js --profile omni --patch <privacy overlay> --no-open --host 127.0.0.1 --port <free>` with dshEnv's variables; it reads the `dsh web:` line for the token URL and stops DSH with SIGTERM, then SIGKILL after 8 s. |
| Node lookup (PATH → nvm → Homebrew) | **works** | Launched from a shell: found on PATH. Launched with `PATH=/usr/bin:/bin` (a Dock-style environment): found via nvm (`~/.nvm/versions/node/v24.13.1`). The Homebrew branch was not hit on this Mac. |
| Same runtime and profile as apps/desktop | **works** | `/Applications/Automagik.app/Contents/Resources/{runtime,profile}` (the installed 3.51.0, dsh 0.2.1-rc.4; the repo is at 3.52.2 and `apps/desktop/build` was not built). The profile is copied into a temp home; `~/.automagik` was not touched. |
| Load DSH's page with the token | **broken as first built, works with either fix** | DSH's sign-in cookie is `SameSite=Strict`, set on a `303` from `/?token=`. A window that opened on `tauri://localhost` and then navigated to DSH got "dsh web authentication required": WebKit held the cookie back on the cross-site redirect. Fix A (`SPIKE_START=direct`): open the window on DSH's URL. Fix B (`SPIKE_AUTH_RETRY=1`): one same-site reload of the origin. Both draw the app. |
| Bridge from the remote origin (init script + one command) | **works** | The capability `dsh.json` has `remote.urls: ["http://127.0.0.1:*"]` and `allow-spike-bridge` (an app manifest command). `spike_bridge` answered from ports 8765, 49321 and every DSH port. A page on `http://localhost:8767` loaded (the server logged the GET) but none of its calls arrived: the ACL holds. The init script plays the role of preload.cjs (`omniDesktop`, `data-automagik-desktop`). |
| MediaRecorder + decodeAudioData (voice) | **works** (recording pipeline, synthetic input) | speech.js's path on a synthetic stream: `new MediaRecorder(stream)` records `audio/mp4; codecs=mp4a.40.2`, `decodeAudioData` decodes it (48 kHz, 1.19 s) and a 16 kHz OfflineAudioContext renders it (19,093 samples). |
| Microphone (`getUserMedia`) | **degraded** (unverified past the macOS permission prompt) | macOS logged `AUTHREQ_PROMPTING service=kTCCServiceMicrophone` for the spike. Nobody answered, and the call was still pending after 20 s. `NSMicrophoneUsageDescription` is in `src-tauri/Info.plist`. |
| webkitSpeechRecognition | **degraded** (unverified past the macOS permission prompt) | `webkitSpeechRecognition` exists (unprefixed `SpeechRecognition` does not). `start()` led to a `kTCCServiceSpeechRecognition` prompt, and the engine fired only `end`: no `start`, no `error`. composer.js shows the mic button, which may then do nothing. |
| canvas `toBlob('image/webp')` | **broken** | Gives `image/png`, and `toDataURL` does too. pet-bake.js would store PNG bytes as `spritesheet.webp`. The headless bake (D11) removes the need. |
| CSS `corner-shape` | **degraded, no visible loss** | `CSS.supports` is false for `round` and `squircle`. Every use in bots-dsh and welcome-dsh is `corner-shape:round` beside `border-radius:50%`, which draws the same circle. |
| CSS `field-sizing: content` | **works** | Supported; a test textarea grew from 20 to 80 px with four lines. |
| CSS `@property` | **works** | `CSS.registerProperty` exists; an `@property` initial value resolves (`7deg`), and the page's own `--op-angle` (task-card.js) resolves to `0deg`. |
| ClipboardItem (image copy) | **works** | Supported, including `image/png`. With a real click, `navigator.clipboard.write([new ClipboardItem({'image/png': …})])` resolved and the PNG was on the clipboard. Without a gesture it is refused (`NotAllowedError`), as in Safari; image-cell.js copies on click. |
| Per-bot browser views: own persistent, isolated store; several beside the page (t259) | **works** (storage and layout) | Two child webviews (`Window::add_child`, Tauri `unstable` feature) laid next to DSH's page, each with `data_store_identifier` (WKWebsiteDataStore per UUID, macOS 14+), all on the same origin `http://127.0.0.1:8771`. Run 1 from empty stores: bot A read nothing and wrote `a`; bot B, 2 s later, also read nothing (`cookie:""`, localStorage `null`, IndexedDB `null`) and wrote `b`. Run 2 after a relaunch: A read `a` and B read `b` for the cookie, localStorage and IndexedDB. All three views reported `visibilityState: visible`. Each store is its own folder under `~/Library/WebKit/<bundle id>/WebsiteDataStore/<uuid>`; `AppHandle::remove_data_store` deletes one (the Electron app's "forget"). See blocker 1 for driving them. |
| Bot browser automation (CDP relay) | **broken: blocker** | WKWebView has no CDP endpoint (see blocker 1). |

## Numbers

### Cold start (process start → DSH's page drawn)

| | Tauri spike (release .app, opened with `open`) | Electron 3.51.0 (this Mac, `~/.automagik/desktop/logs/start.log`, 8 launches) |
|---|---|---|
| DSH ready | 1.73 / 1.76 / 1.79 / 2.24 s (median 1.78) | 1.32–2.54 s (median 1.82) |
| Page loaded (`load` ≈ Electron's `page in`) | 3.14 / 3.22 / 3.40 / 3.78 s (median **3.31**) | 2.03–3.61 s (median **2.73**) |
| Page drawn with app content | +10–15 ms after `load` | — |
| Window on screen | at DSH ready (direct start); 0.34 s with the placeholder + retry start (page at 4.8 s) | 0.2–0.7 s (survey) |
| First launch (copies the 47 MB profile) | 5.07 s; the copy takes 0.85 s | — |

The startup time is DSH's: it is ready at the same time under both shells. WKWebView loads DSH's
page about 0.5 s slower: 1.4–1.6 s from DSH ready to `load`, against 0.7–1.1 s in Electron.
Electron's numbers come from a real home with more data, Tauri's from a fresh temp home, so the
Tauri side is, if anything, flattered.

### Idle RSS (60 s after the page was drawn)

| | Tauri spike | Electron (DEVELOPMENT.md:106) |
|---|---|---|
| App process | 74–88 MB | |
| DSH (+ children) | 122–163 MB | ~290 MB |
| WebKit WebContent (DSH's page) | 84–122 MB | |
| WebKit GPU + Networking | 51–59 MB | |
| **Total** | **372–397 MB** (4 runs) | **~1.0 GB** |
| Total without DSH | 215–270 MB | ~710 MB |

- **Method:** RSS from `ps`. DSH's tree comes from its pid; WebKit's XPC processes are launchd's children, so they are counted by before/after snapshots. RSS overcounts shared framework pages on both sides.
- **Not like-for-like:** the Electron figure is the labs prototype on Linux x64 (2026-10-20). The installed Electron app was not launched here: it shares its Chromium profile with the real one and downloads updates on start. Tauri's DSH ran on a fresh home showing "Setting up your Main Bot…", which explains its smaller DSH. The installed app was measured later under one protocol for both shells: see "Like-for-like RSS (macOS)".
- **With two Bot views:** 0.82–0.96 GB, read only 6 s after load. DSH's page process was still at ~320 MB then (before it settles), and each Bot view's WebContent was ~29 MB.

### Bundle size (macOS arm64)

| | Size |
|---|---|
| Tauri shell `.app` (5.2 MB binary + icons) | **6.1 MB** |
| Electron `.app` total | 797 MB, of which Electron Frameworks 288 MB, runtime 433 MB, profile 47 MB, app.asar 2.6 MB |
| Tauri + the same runtime and profile | ~486 MB (−311 MB, −39%) |
| … + a bundled Node 24 | ~602 MB (−24%) |

DSH's runtime is the bulk on both sides. Download sizes (compressed dmg/zip) were not measured.

## Breaks and fixes (not blockers)

- **Window dragging:** `-webkit-app-region: drag` (sidebar.js:803-806, styles.js:353) is not supported in WKWebView (`CSS.supports` false), so the title area does not move the window. Fix: the init script maps those regions to `data-tauri-drag-region` or calls `startDragging`; the remote capability then needs `core:window:allow-start-dragging`. Untested.
- **Sign-in cookie:** see "Load DSH's page with the token". Either fix is a few lines.
- **No Node IPC channel:** with a Rust parent, DSH has no `process.send`. The spike leaves `AUTOMAGIK_APP_BROWSER` unset, so the Bot team does not ask the app for a browser endpoint over fd 3. A port needs another channel, for example a loopback socket in DSH's environment.
- **Orphaned DSH:** if the app is killed with SIGKILL or crashes, DSH keeps running; the spike handles only SIGTERM, SIGINT and a normal quit. A port needs a parent-death watch (kqueue `NOTE_EXIT`, or a DSH flag).
- **Steps skipped from `installProfile`:** upgrades of an existing profile, `pinProfileStore` (pnpm's store) and the lane were not ported. Plugin installs from the market may fail until they are.
- **Not ported:**
  - the updater (electron-updater → tauri-plugin-updater, a new feed and signing)
  - deep links, the menu, notifications, the Bot cursor overlay, splash and lane handling
  - `<a download>` (chart export in widget-chart.js), which needs Tauri's download handler. Untested.
- **Not a Tauri break:** the page logs `slot entry crashed in 'conversation.input.dock': Minified React error #290 (claude-code/opus)`. Headless Chrome shows the same error on the same DSH, so it is a DSH/profile issue in a fresh home.
- **Throttling:** WebKit pauses `requestAnimationFrame` (and may throttle timers) in a window behind others. A page that paces work on rAF stalls until it is in front. That is how the spike's first "page visible" check failed.

## What the spike is

- `src-tauri/src/main.rs`: Node lookup, profile copy, tools and privacy overlay, DSH spawn and stop, window, `spike_bridge`, Bot views.
- `src-tauri/src/bridge.js`: the init script (preload equivalent, timings, error capture, the WebKit probes).
- `src-tauri/capabilities/dsh.json`: the remote-origin capability. `src-tauri/Info.plist`: microphone and speech usage strings.
- `measure.sh`: one timed launch, RSS, and a full stop. `test/bot.html`: the per-Bot store probe.

## Like-for-like RSS (macOS)

**Preliminary: measured with the console locked.** The Mac's screen was locked from 21:56 UTC
(`IOConsoleLocked = Yes`), before the first run, so every window was hidden. Chromium throttles hidden
pages; WebKit suspends their timers and `requestAnimationFrame`. Page and GPU processes are probably
smaller on both sides than with the window in front (the unlocked spike runs above had a 84–122 MB
WebContent; here it is 46–52 MB). The DSH rows are the least affected: DSH is a server, not a window.
Redo all six runs with the screen unlocked before quoting these numbers as final.

Same Mac (Apple silicon, 48 GB, macOS 26.5.2), 2026-11-02, 22:30–23:04 UTC. Both shells run the
installed 3.51.0 runtime and profile (`/Applications/Automagik.app/Contents/Resources`, dsh 0.2.1-rc.4)
on the same data: Electron on the real `~/.automagik/desktop`, Tauri on an APFS clone of it taken right
after the last Electron run (`cp -c -a`, 53 GB, of which 52 GB is `bots/workspace`). The spike logged
"profile already there", so it used the installed profile in the copy, not a fresh one.

### Idle RSS, 0 Bot browser views (MB, 60 s after the page was drawn)

| Process | Electron run 1 | run 2 | run 3 | Tauri run 1 | run 2 | run 3 |
|---|---|---|---|---|---|---|
| App process | 143.9 | 143.5 | 144.3 | 71.0 | 77.5 | 78.8 |
| Window frame (Electron renderer 1) | 101.5 | 97.9 | 102.3 | — | — | — |
| DSH's page (Electron renderer 2 / WebKit WebContent) | 167.2 | 128.6 | 157.2 | 46.2 | 51.7 | 51.7 |
| GPU (Electron helper / WebKit GPU) | 65.0 | 66.6 | 65.0 | 19.6 | 23.0 | 22.7 |
| Network (Electron utility / WebKit Networking) | 49.2 | 48.1 | 48.6 | 15.3 | 15.5 | 15.2 |
| DSH (no children at the read point) | 319.3 | 172.7 | 170.4 | 131.7 | 110.8 | 114.9 |
| **Total** | **846.1** | **657.4** | **687.8** | **283.8** | **278.5** | **283.3** |
| Total without DSH | 526.8 | 484.7 | 517.4 | 152.1 | 167.7 | 168.4 |

- **Electron:** 0.66–0.85 GB on the real home, not the ~1.0 GB of the Linux prototype figure. Run 1
  was a cold start (DSH ready after 11.3 s, against 1.9–2.8 s in runs 2–3); its DSH was 319 MB, against
  ~171 MB warm. The two renderers are told apart by start order: the first starts when the window is
  shown (the frame), the second after DSH is ready (DSH's page).
- **Tauri:** 0.28 GB on the same data. Its DSH was 111–132 MB here, against 122–163 MB on a fresh
  home: the fresh home was not why the spike's DSH looked small.
- **Shell overhead (total without DSH):** 0.48–0.53 GB for Electron, 0.15–0.17 GB for Tauri. That
  ~0.35 GB difference is what the wrapper itself saves.
- **DSH difference (~170 vs 111–132 MB warm) is not credited to Tauri.** Electron runs DSH on its own
  binary as Node (`ELECTRON_RUN_AS_NODE`, Node 24.21.0, Electron 44.5.0); the spike uses nvm's Node
  24.13.1. Electron's DSH also adopts the four live Claude keepers in `~/.local/state/dsh-oh-my-claude`,
  while the spike's was pointed at an empty state dir (below). Electron also sets `AUTOMAGIK_APP_BROWSER`
  and the user's privacy overlay; the spike leaves the first unset and writes its default overlay.

### Method

- **Total:** the app process and its process tree (Electron's helpers and DSH are its children; DSH
  had no children at the read point on either side), plus every new process since launch that is off
  that tree and related to the app (WebKit's WebContent, GPU and Networking XPC services are launchd's
  children). RSS from one `ps -axo pid,ppid,rss,command` read, in KB, shown here in MB (/1024). RSS
  overcounts shared framework pages on both sides.
- **Launch:** like a person, through Launch Services: `open /Applications/Automagik.app`, and
  `open -n --env …` for the spike's release `.app` (built from this branch). Before each run, no
  Automagik or spike app was running (checked with `pgrep`).
- **Page drawn:** Electron: the `start: page in` line in `~/.automagik/desktop/logs/start.log`
  (`did-finish-load`), 3.0–4.1 s after `open` (13.5 s in the cold run 1). Tauri: the bridge's `load`
  from DSH's origin, 3.5–5.2 s after `open`. With the screen locked, the spike's own "page visible"
  check never runs (its timers are suspended), so `load` is used on both sides.
- **Read point:** `ps` 60 s after that line. **Quit:** an Apple Event quit to each app's bundle id;
  start.log showed `quit: dsh stopped` for every Electron run and the spike logged `dsh stopped`.
- **Spike settings:** `SPIKE_START=direct` (the default placeholder start runs into the
  `SameSite=Strict` cookie break and never shows DSH's app: three earlier runs were thrown away for
  this, `load` at 86 ms), `SPIKE_RESOURCES` set to the installed app, `SPIKE_HOME` set to the copy,
  `DSH_OMC_STATE_DIR` set to an empty temp dir. Without that last one, the copy's DSH would adopt the
  real app's live Claude keepers in `~/.local/state/dsh-oh-my-claude`.
- **Excluded:** processes that were already running (four keeper processes on the Automagik binary, and
  a DSH of another home, `~/automagik-gtm`), and processes from other sessions that overlapped
  (an Electron startup benchmark in Electron run 3, an automagik-herdr node in Tauri runs 2–3). Every
  row counted belongs to the app's tree or is a WebKit service that started after launch.
- **Updates:** the app checked for updates and stayed at 3.51.0 ("newest stable release"); nothing
  was downloaded.
- **Data safety:** `find -newer` on a marker written at the last Electron quit, run again after the last
  Tauri run, lists 79 files under `~/.automagik/desktop`. All 79 are one git pack: a single file
  (one inode, 80 hard links) shared by the Bots' wish clones in `bots/workspace` and the main repository
  `~/workspace/repos/automagik/.git`. Git refreshed its mtime at 23:05:25 UTC, after the last run had
  stopped (23:04:16), during a git operation in the main repository; the contents did not change.
  Nothing else in the home changed. The copy was deleted afterwards. Nothing started by these runs was
  left running.

### 2 Bot browser views: not measured

- **Electron:** the only route without code or data changes is the app's own Bot browser panel: two
  Bots have saved tabs (`bots/browser-profiles/*/tabs.json`: a GitHub sign-in page and iana.org), and
  opening their panels reopens them as views. With the screen locked the app's window could not be
  driven: no accessibility tree, a blank capture, and macOS refused to bring it to the front.
- **Tauri:** the switch exists (`SPIKE_BOT_URL`), but it was not run: there is no Electron number to
  compare with, and hidden views say little about their size on screen.

### How this changes the recommendation

The memory win is smaller than the "0.4 instead of 1.0 GB" above. On the same Mac and data the
wrapper saves about 0.35 GB at idle with no Bot browsing (0.15–0.17 against 0.48–0.53 GB of shell),
and the whole app goes from 0.66–0.85 GB to about 0.28 GB. That saving disappears whenever a Bot
browses if blocker 1 is solved with a separate Chromium: that brings back roughly the Electron shell's
browser, GPU, network and renderer processes. The recommendation stays the same: no-go as a drop-in
replacement. Memory alone does not justify a port; the WKWebView Bot-driver spike decides between
"Tauri everywhere" and "Tauri shell + Chromium only while a Bot browses". Before D12 cites these
numbers, redo the six runs (and the 2-view runs) with the screen unlocked.

## Cross-OS matrix

Question (Felipe, 2026-11-03): which desktop wrapper works on every OS? `.github/workflows/cross-os.yml`
(run by hand only) builds today's Electron app (apps/desktop at dev `dbcb95c`: Automagik 3.57.0,
Electron 44.5.0, dsh 0.2.1-rc.5) and this spike on GitHub's macos-latest (Apple M1 virtual, 3 vCPU,
7 GB), ubuntu-24.04 (x64, 4 vCPU, 16 GB, xvfb and a D-Bus session) and windows-latest (x64, 4 vCPU,
16 GB). Results: runs [41583307473](https://github.com/automagik-dev/automagik/actions/runs/41583307473)
and [41585438311](https://github.com/automagik-dev/automagik/actions/runs/41585438311), same app
commit. Run [41580712280](https://github.com/automagik-dev/automagik/actions/runs/41580712280)
found the CI problems listed under "Harness". The harness is `cross-os/run.mjs`. Each check writes
one JSON line (`cross-os-out-<os>` artifacts), and the Report job renders them into the run summary.

### Recommendation: Electron is the only wrapper that works on every OS; keep it (option C)

- **Electron passes every step on all three OSes.** On each one it builds, packages, loads DSH's
  page and opens two Bot views with isolated, persistent stores, through the real app's
  `dsBotApp.browser` and bot-views.js. Bots drive those views over CDP (debugger.attach). What it
  takes to ship on Windows is listed below; none of it is a wrapper limit.
- **Tauri works everywhere except Bot browser automation.** It builds, packages, loads DSH and gives
  each Bot its own persistent store on all three OSes. CDP works only on Windows (WebView2). macOS
  (WKWebView) and Linux (WebKitGTK) have no CDP, so Playwright cannot attach. A Tauri app would need
  a separate Chromium for Bots on two OSes and a WebView2 path on the third. Bots would then behave
  differently per OS, which D13's "same app on every OS" rules out. This confirms the council
  dissent and settles its "WebView2 CDP" evidence gap: WebView2 exposes CDP, and the blocker
  remains on macOS and Linux.
- **Tauri's memory win depends on the OS.** Shell overhead (total RSS without DSH) at idle: about
  0.2–0.3 GB less on macOS (441–542 against 720–723 MB) and about 0.42 GB less on Linux (537–544
  against 961–965 MB). On Windows it is the same (478–481 against 523–527 MB). With two Bot views
  Windows reverses: each Bot's data directory is a WebView2 browser of its own, so 20 processes and
  1003–1010 MB against Electron's 8 processes and 718–721 MB.
- **herdr-app is not the OS blocker.** The Homebrew cask `penso/tap/herdr-gpui` is macOS-only
  (`depends_on macos: :sonoma`). The GitHub releases of penso/herdr-gpui (v20261102.2) also ship
  Linux builds (deb, rpm, pkg.tar.zst and tar.gz, x86_64 and aarch64) and Windows builds (setup.exe
  and zip, x86_64 and aarch64). `herdr-gpui --help` runs on all three runners. This proves only
  that the binary runs: no daemon or window was started.

What Electron needs before it ships on Windows (found here, not fixed: apps/desktop is unchanged):

1. `scripts/prepare-runtime.mjs` runs `npm.cmd` through `execFileSync` without a shell. Node ≥
   18.20.2 refuses that with `spawnSync npm.cmd EINVAL` (CVE-2024-27980). Fix: `shell: true` for
   `.cmd`, as `cross-os/win-cmd-shim.cjs` does for the matrix.
2. A Windows code-signing certificate (none in the repo). Until one signs the installers,
   SmartScreen warns on every download.
3. A `win` section in electron-builder.yml and a Windows update feed. The matrix built nsis and msi
   from electron-builder's defaults.
4. dsh.js `writeTools` writes `#!/bin/sh` shims for `node` and `pnpm`, which do not run on Windows.
   DSH's page loads anyway; plugin installs that go through those shims were not tested.

On Linux, the app's own Bot browser smoke test fails 4 of 24 checks in all three runs (details in
the table). The other three OSes pass 24 of 24.

### Per-OS results

| Step | Shell | macOS (arm64) | Ubuntu 24.04 | Windows |
|---|---|---|---|---|
| 1. Build | Electron | **works** | **works** | **degraded**: `prepare-runtime.mjs` fails with `spawnSync npm.cmd EINVAL`; builds with `shell: true` for `.cmd` (fix 1 above) |
| 1. Build | Tauri | **works** | **works** | **works** (after gating the spike's macOS-only calls, see "Harness") |
| 2. DSH page (omni profile, temp home), first and warm launch | Electron | **works** | **works** | **works** |
| 2. DSH page | Tauri | **works** | **works** | **works** |
| 3. 2 Bot views: isolated stores | Electron | **works** (real app: `dsBotApp.browser.views`, persist partitions) | **works** | **works** |
| 3. 2 Bot views: isolated stores | Tauri | **works** (WKWebsiteDataStore per Bot) | **works** (`data_directory` per Bot) | **works** (`data_directory` per Bot: one WebView2 browser per Bot) |
| 3. 2 Bot views: persistent across relaunch | Electron | **works** | **works** | **works** |
| 3. 2 Bot views: persistent across relaunch | Tauri | **works** | **works** | **works** |
| 4. Bot browser automation | Electron | **works**: `scripts/browser-smoke.mjs` 24/24 (Playwright `connectOverCDP` through bot-relay.js `debugger.attach`) | **degraded**: 20/24, the same 4 in all 3 runs. After a forced renderer crash the relay does not drop the Bot's connection within 10 s; the next 3 checks (cursor follows a click, cursor on the next session, closing tabs closes the cursor) time out on `page.goto` or `connectOverCDP`. Not investigated further | **works**: 24/24 (exit 1 only from the temp folder's cleanup, EPERM) |
| 4. Bot browser automation | Tauri | **broken**: WKWebView has no CDP endpoint and no switch for one; only DSH listens in the app's process tree | **broken**: WebKitGTK's inspector server (`WEBKIT_INSPECTOR_HTTP_SERVER`) speaks WebKit's own protocol; `/json/version` answers 404 and `connectOverCDP` fails | **works**: `--remote-debugging-port` per Bot view (`additional_browser_args`); Playwright `connectOverCDP` ran evaluate, screenshot, a trusted click and a `route` abort. Needs one TCP debug port per Bot, which the council's security lens rules out; WebView2's `CallDevToolsProtocolMethod` is a port-free relay like Electron's, untested |
| 6. Package (unsigned) | Electron | **works**: dmg | **works**: AppImage, deb | **works**: nsis exe, msi |
| 6. Package (unsigned) | Tauri | **works**: dmg | **works**: AppImage, deb | **works**: nsis exe, msi |
| 6. Signing | both | **degraded**: ad-hoc (linker-signed) only. Blocker: Developer ID and notarization (release.yml has the secrets for Electron; Tauri's bundler takes the same identity, and its updater needs a new minisign key) | **works**: AppImage and deb need no signature | **degraded**: `NotSigned`. Blocker: no Windows code-signing certificate in the repo |
| 7. herdr-app build for the OS | herdr-gpui | **works**: cask and dmg (macOS 14+) | **works**: 8 builds in GitHub releases, none in the cask | **works**: 4 builds in GitHub releases, none in the cask |
| 7. herdr-app binary runs (`--help`) | herdr-gpui | **works** | **works** (needs `libxkbcommon-x11-0`) | **works** (`herdr-gpui.exe`) |

### Numbers (run 2 / run 3)

These are CI VMs with no GPU (Linux under xvfb with software rendering), so compare within an OS
only. Times are ms from process start. Page: Electron's start.log `page in` (`did-finish-load`),
Tauri's bridge `load`. RSS is the app's process tree, plus WebKit's XPC services on macOS. On
Windows it is the working set. Read 60 s after the page was drawn.

| | macOS Electron | macOS Tauri | Linux Electron | Linux Tauri | Windows Electron | Windows Tauri |
|---|---|---|---|---|---|---|
| Warm launch: DSH ready | 2930 / 3741 | 3072 / 5069 | 2003 / 1589 | 4682 / 1814 | 3445 / 2109 | 3139 / 1998 |
| Warm launch: page | 11591 / 12664 | 6911 / 10151 | 3261 / 2555 | 7657 / 4313 | 5437 / 3348 | 5106 / 3308 |
| First launch: page | 13090 / 29737¹ | 9634 / 13497 | 4237 / 3396 | 13566 / 6368 | 9794 / 6487 | 14003 / 10406 |
| Idle RSS total (MB) | 942 / 994 | 799 / 903 | 1183 / 1255 | 923 / 915 | 712 / 712 | 699 / 689 |
| … without DSH (the shell) | 720 / 723 | 441 / 542 | 965 / 961 | 537 / 544 | 523 / 527 | 481 / 478 |
| … DSH | 222 / 272 | 359 / 361 | 218 / 294 | 386 / 372 | 189 / 185 | 218 / 211 |
| 2 Bot views: total (MB) | 1126 / 1183 | 877 / 1046 | 1400 / 1464 | 1338 / 1335 | 907 / 907 | 1360 / 1214 |
| … without DSH | 912 / 911 | 534 / 669 | 1174 / 1170 | 969 / 971 | 718 / 721 | 1003 / 1010 |
| … processes | 8 | 7 | 11 | 8 | 8 | 20 |
| Installed app (MB) | 737 | 6.1 + 428 runtime and profile | 714 | 5.5 + 429 | 826 | 7.0 + 457 |
| Installers (MB) | dmg 275 | dmg 3.9 | AppImage 257, deb 200 | AppImage 78, deb 2.4 | exe 241, msi 244 | exe 1.8, msi 2.6 |

¹ The harness's "content seen" time (start.log had no `page in` line yet when it was read).

- **Start time is not a reason to switch.** On Linux and Windows, Electron is at least as fast. On
  macOS, Electron's 8–9 s from DSH ready to page is a property of this VM: on a real Mac it is
  0.7–1.1 s ("Cold start" above). Do not quote the macOS CI times.
- **Tauri's DSH is larger on macOS and Linux** (359–386 against 218–294 MB). It runs on the
  runner's Node 24.22 instead of Electron's own. The "without DSH" rows compare the shells.
- **Tauri's sizes leave out Node.** A release has to ship one (about +116 MB on macOS, see blocker
  3) or install one. The 2.4 MB deb and the 2–3 MB Windows installers are the shell alone.

### Harness

- **The spike on Linux and Windows:** `src-tauri/src/main.rs` gates its macOS-only calls with
  `cfg`: title bar style, `data_store_identifier` (replaced by `data_directory` per Bot), `kill`
  (replaced by `taskkill`), `cp -R` (replaced by Node's `fs.cpSync`) and the `#!/bin/sh` tool shims
  (replaced by `.cmd` files). `node.exe` is looked up on PATH. `SPIKE_CDP_PORT` opens WebView2's
  CDP per Bot view. `icons/icon.ico` was added for Windows.
- **Bot views in Electron:** the matrix drives the packaged app's own views. Through CDP on DSH's
  page it calls `dsBotApp.browser.views.create`, `place` and `read` (`test/bot.html` also leaves its
  result in `window.__probe`). Automation is the app's `scripts/browser-smoke.mjs`, unchanged.
- **CI-only fixes from run 1:**
  - Linux has no D-Bus session bus, so GTK waits 25 s (the D-Bus timeout) before Tauri's setup
    runs. Run 1 put Tauri's "DSH ready" at 26 s for that reason; runs 2–3 use `dbus-run-session`
    for both shells.
  - Windows runners check files out with CRLF line endings, and `runtime-patches.mjs` then rejects
    its own patches (`changes …lib/index.js, but patches.json lists …lib/index.js`, with a hidden
    `\r`). Runs 2–3 check out with `core.autocrlf false`. A Windows developer with autocrlf on
    hits the same error.
  - On Windows, ephemeral ports are handed out in order, so DSH took the CDP port meant for
    bot a. CDP ports now come from below the ephemeral range.
- **Registering the workflow:** GitHub dispatches only workflows it has registered, and a file that
  exists only on a branch is registered only by a push or PR run. With Felipe's OK, one commit
  carried a push trigger whose jobs were all skipped (run 41580685041); the next commit removed it.
- **Not tested:** voice, real signing and notarization, the updater, Arca, a herdr daemon or
  window, WebView2's `CallDevToolsProtocolMethod`, and plugin installs through DSH on Windows.
