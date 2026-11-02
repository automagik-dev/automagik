# Tauri 2 wrapper spike: findings

Question (D12): can a Tauri 2 thin wrapper replace the Electron app in `apps/desktop`?
Throwaway spike, measured on one Mac (Apple silicon, macOS 26.5.2) on 2026-11-02.
Tauri 2.12.5, wry 0.57.1, system WKWebView. How to run it: RUNNING.md.

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
