# DSH startup profile, 2026-11-02

Where the desktop app's ~1.6 s from launch to page goes (warm start; ~2.1 s on a first start),
who owns each part, and the cheapest cuts. Nothing was changed: these are measurements on
origin/dev `295deca` (v3.52.2). The cuts below are proposals.

## Summary

Top 3 costs (warm start, median):

1. **DSH core loads its whole plugin graph before it reports ready: ~0.8–1.0 s of the 1.09 s
   spawn→ready.** That is 252 entries, 1,551 modules and 15.2 MB of server code, all on one
   thread. `dsh web:` is printed only after the entire loader tree settles
   (`dsh-web-app/lib/index.js:156-175`). Owner: DSH core. It becomes an upstream ask.
2. **Every launch re-downloads and recompiles 19.1 MB of page JavaScript (7.4 MB gzip), because
   the app picks a new random port each launch** (`apps/desktop/src/main.js:209`). Chromium's
   HTTP cache and V8 code cache are keyed by URL, so they never hit. On a reused port,
   `did-finish-load` falls from 611–649 ms to 324–478 ms. Owner: ours. This is the cheapest
   cut.
3. **Renderer main thread on page load: DSH core ~234 ms, then ours ~100 ms.** About 85 ms of
   ours is one function: the Bot team's 28 `installCompiledStyles` calls each re-scan every
   stylesheet (`apps/bots-dsh/src/client/styles.js:1233-1250`). Owners: DSH core (upstream
   ask) and ours.

Our own server-side plugins are small at boot: `bots-dsh` takes 40 ms of CPU and
`welcome-dsh` 5 ms. A further ~150 ms comes from things we pin or depend on: the add-ons at
~116 ms, and a second copy of `zod` at 35 ms.

## What was run

- **Same start as the app.** The harness imports the launcher's own functions from
  `apps/desktop/src/dsh.js`: `installProfile`, `pinProfileStore`, `writeTools`, `dshEnv`,
  `freePort` and `startDsh`. It also imports `readChoices` and `writeOverlay` from
  `privacy.js`. It calls them in the order of `main.js:194-221`. The child is the same
  command line as `dsh.js:463`: `dsh --profile omni --patch <privacy overlay> --no-open
  --host 127.0.0.1 --port <port>`, with `cwd` set to the app home and the `ipc` channel open.
- **Runtime.** `prepare-runtime.mjs` on origin/dev built the runtime and profile: dsh
  `0.2.1-rc.5`, `@automagik/bots-dsh` 3.52.2, `@automagik/welcome-dsh` 3.52.2,
  `omni-channels-dsh` 2.261030.4, `omni-canvas-dsh` 2.261029.12, `dsh-subscriptions`
  0.7.21-omni.1 and `dsh-oh-my-claude` 1.5.6-omni.7. Node was Electron 44.5.0 with
  `ELECTRON_RUN_AS_NODE=1`, the version `apps/desktop/package.json` pins.
- **Homes.** Every run used a scratch `AUTOMAGIK_HOME` under the session's temp directory;
  `~/.automagik` was never used. The installed Automagik.app was not launched or touched.
- **Plugins loaded.** The omni profile loads `bots-dsh`, `welcome-dsh`, Omni's
  `omni-channels-dsh` and `omni-canvas-dsh`, and the two add-ons. The `unfold-*` and
  `locale-pt-br-dsh` plugins are **not** in this profile (`apps/desktop/profile/package.json`
  bundles), so they cost nothing at desktop start.
- **Cold start.** A new empty home for each run: the first start copies the profile, and the
  browser cache is empty. The OS page cache was not purged, because that needs sudo.
- **Warm start.** The same home again. Of six runs, the first is discarded.
- **Page load.** A small Electron 44.5.0 app loads the launch URL the way `main.js` does, in a
  hidden window on the default session. It records `did-finish-load` (what `main.js` marks
  as `page in`), paints, every request via `webRequest`, and resource timing. Cold-start runs
  use a fresh browser profile; warm-start runs reuse one, as the app's default session does.
  One extra run recorded an Electron `contentTracing` trace that included the renderer's CPU
  profiler.
- **Instrumented runs: 1 cold, 3 warm.** A `--import` preload, reaching the child through
  `NODE_OPTIONS`, did four things without touching any file on disk:
  - rewrote `cordis-plugin-loader`'s `Entry._init` in memory with `module.registerHooks`, to
    timestamp each entry's import, apply and settle;
  - counted the modules and bytes loaded per package;
  - logged network calls;
  - took inspector CPU profiles at 200 µs sampling, one from spawn to ready and one from
    ready to stop.

  Spawn→ready ranged 1.09–1.42 s instrumented, against 0.94–1.24 s uninstrumented, so the
  profiles give each owner's *share*. The headline times come from the uninstrumented runs.
- **CPU attribution.** JavaScript a package runs is charged to that package. Module resolution
  inside DSH's resolve wrappers, which includes Node's own resolution, is shared out by module
  count. Module loading and compilation (Node's loader under `cordis-plugin-loader`'s
  `import()`) is shared out by source bytes. Per-entry import times overlap, because all 270
  entries import at once. They are shown for our plugins but are not additive.
- **Machine.** Load average was 17–27 on 18 cores for the whole session: other agents were
  working and the installed app was running. The A/B comparisons were run interleaved, 8
  rounds each, and report median and minimum. About 67 starts in total.

## Headline numbers

Times from the uninstrumented batch; 5 runs each.

| Step | Cold: median (min–max) | Warm: median (min–max) | Owner |
|---|---|---|---|
| Pre-spawn: `installProfile`, `pinProfileStore`, tools, overlay | 412 ms (395–463) | 2 ms (1–14) | ours |
| spawn → `dsh web:` (ready) | 1,113 ms (811–1,666) | 1,092 ms (1,084–11,057)¹ | DSH core + plugins |
| `loadURL` → `did-finish-load` | 544 ms (517–589) | 529 ms (518–678) | DSH core + plugins |
| First contentful paint (DSH's skeleton) | 236 ms | 208 ms | DSH core |
| End of the page's first request burst ("UI has data") | 629 ms | 605 ms | |
| **Pre-spawn + ready + load** | **2,093 ms** | **1,622 ms** | |

¹ One warm run took 11 s. It was not reproduced in the other ~60 starts, there is no log of
it, and it is unexplained. Most likely it was machine contention. In the 8-round A/B baseline,
spawn→ready had a median of 1,071 ms (minimum 936 ms).

DSH's CPU time at ready is ~1.8 s against ~1.07 s of wall time: about 0.7 s more runs on
helper threads (the fs pool, GC and zlib).

Inside spawn→ready, in a typical instrumented warm run (ready at 1,095 ms):

```
   0–15 ms    Electron/Node bootstrap to first user code
  15–135 ms   dsh bin + profile boot: compose patches, resolve bundles, install the module router
 135–1,060 ms 270 entries import and apply at once on one thread
              ours imported by ~780 ms, Omni's by ~730, add-ons by ~920 (dsh-oh-my-claude last)
1,060–1,067   last settles: dsh-workspace, dsh-hmr, directory-picker-native
1,067–1,095   auditStartupEntries, then `dsh web:` (dsh-web-app/lib/index.js:173-175)
```

The council's 1.4–2.3 s spawn→ready and 0.8–1.1 s ready→page came from the installed 3.51.0
(dsh rc.4) on the person's real home. This run measured rc.5 on an **empty** home. The gap
was not measured. It most likely sits in the session and credential plugins, which are
concurrent here but scale with stored data: `session-projection-cache` settled in 290–396 ms,
`session-persistence-jsonl` in 209–258 ms and `credentials-local` in 411–475 ms. On the
page side, the probe leaves out Electron-side work (PR #179's domain) and the renderer spawn.

## Ranked costs

Warm start. "Boot CPU" is CPU before ready (instrumented warm median). "Page" is time from
`loadURL` to `did-finish-load`, or renderer main-thread CPU where noted. DSH paths are inside
`apps/desktop/build/runtime/node_modules/@deepseek-ai/` as `prepare-runtime.mjs` installs
them (dsh 0.2.1-rc.5).

| # | Cost | ms | Owner | Evidence |
|---|---|---|---|---|
| 1 | DSH loads its whole plugin graph before ready: 252 entries, 1,551 modules, 15.2 MB | ~810–1,000 boot CPU (of ~1,090 wall) | DSH core | Ready gate `dsh-web-app/lib/index.js:156-175` (`loader.await()`, then `auditStartupEntries`); boot profile split below |
| 1a | ↳ Node loading and compiling modules under the loader's `import()` | 355–525 for all owners, ~72% of it DSH's | DSH core | `cordis-plugin-loader/lib/index.js:214-226`; profile nodes `readFileSync`, `readSync`, `compileSourceTextModule` |
| 1b | ↳ DSH's module router: ESM/CJS resolve wrappers with sync fs per resolve, plus the installation-scope walk on every boot | `dsh-app-boot` 177 (resolve share 115–235); scope walk 30 warm / 138 first | DSH core | `dsh-app-boot/lib/index.js:1846-1930` (`installRuntimeInterception`, `adapted`, `wrapped`), `:1988` (`wrappedFilename`), `:716` (`collectInstallationScopePackages`), `:976` (`packageDirFromAnchor`) |
| 1c | ↳ cordis and the loader's own work | 144 | DSH core | `cordis/lib/index.js` (`_reload`, `_execute`), `cordis-plugin-loader/lib/index.js:58-87,367,438` |
| 1d | ↳ Settings schemas described at boot | ~109 inclusive | DSH core | `dsh-settings/lib/index.js:413` (`describe`) → `schemastery` `toJSON` |
| 2 | Page JS never cached: a new port each launch makes every URL new to the HTTP cache and V8 code cache. 19.1 MB decoded (7.4 MB gzip) is re-sent and recompiled | 150–300 page | **ours** | `apps/desktop/src/main.js:209` → `dsh.js:381` (`freePort`). A/B below: 611 → 448 ms and 649 → 324–358 ms |
| 3 | Page renderer: DSH core | ~234 renderer CPU: `dsh-web-frontend` 107–127; `dsh-client-modules` 95 uncached, 8 with code cache | DSH core | Trace: `/assets/index-*.js`, `/plugins/??` combos |
| 4 | Page payload is eager: 11.3 MB of DSH plugin clients plus 1.7 MB of assets. `dsh-client-ui-settings-account` alone is 3.4 MB, loaded for a settings page on every start | part of 2 and 3 | DSH core | Combo URLs in the page log; file sizes under `build/runtime/node_modules/@deepseek-ai/*/lib/client.browser.js` |
| 5 | Add-ons at boot: `dsh-oh-my-claude` 44; `dsh-subscriptions` 27 plus `undici` 39 and socks 7 it brings | ~116 boot CPU | add-ons (our forks) | `@goodandready/dsh-subscriptions/lib/proxy.js:3` imports `undici` statically, though it is used only with a proxy (`:66`) |
| 6 | Page renderer: ours (`bots-dsh` client) | ~100 renderer CPU; 85 inclusive in `installCompiledStyles` → `sheetClassNames` → `visit` | **ours** | `apps/bots-dsh/src/client/styles.js:1209-1250`, called 28 times from `src/client/index.js:888+`. Each call keeps its own `WeakMap`, so every call walks every sheet |
| 7 | Our server plugins at boot: `bots-dsh` 40 (70 modules, 1.13 MB), `welcome-dsh` 5 | ~45 boot CPU | **ours** | Imported by ~780 ms, ~300 ms before ready: not the tail |
| 8 | Second `zod` in the profile: 95 modules, 852 kB | 35 boot CPU | **ours** + Omni | `apps/welcome-dsh/package.json:64` pins zod 4.6.5, the runtime ships 4.4.3 (`apps/desktop/runtime/package.json`); Omni's channels also depend on zod |
| 9 | Our page plugins in the first burst: the Bot team's first `state` call | 76–93 page (cold home), 10–15 (warm) | **ours** | `apps/bots-dsh/src/host/channel.js:177-182` (`refresh`, `bootstrap`, `catalog`, `loadSecrets`); only ~4 ms of it is CPU |
| 10 | Omni's plugins at boot: channels 16, canvas 12 | ~28 boot CPU | Omni | |
| 11 | First start after an install or update: the profile copy | 395–463 pre-spawn, first start only | ours | `apps/desktop/src/dsh.js:186` (`installProfile`); PR #179 already makes it async |
| 12 | Electron/Node bootstrap to first user code | 14–21 | runtime | `performance.nodeTiming.bootstrapComplete` |

Per-entry wall times for our plugins (warm; overlapping, not additive):

| Entry | Import (wall) | Settle |
|---|---|---|
| `bots-dsh` (`omni-ui`) | ~270 ms | ~30 ms |
| `bots-dsh/web-search` | ~145 ms | ~70 ms |
| `welcome-dsh` (`omni-ai`) | ~420 ms | ~9 ms |

Omni's channels import in ~410 ms and its canvas in ~215 ms. Of the add-ons, `dsh-oh-my-claude`
imports in ~600 ms and `dsh-subscriptions` in ~415 ms. Every import overlaps the others.

## Cheapest cuts

| Cut | Owner | Saves | Risk |
|---|---|---|---|
| **1. Keep the port across launches.** Save the port in the app home and try it first, falling back to `freePort()` when it is taken (`main.js:209`, `dsh.js:381`). The combo bundles are `Cache-Control: immutable` with a content `rev`, and their URLs did not change from first start to second. | ours (desktop) | **150–300 ms** of ready→page on every warm start. Measured on one port: 611 → 448 ms median over 3 pairs, and 649 → 324–358 ms. Cache hits were the three combos, `dsh-oh-my-claude/client.js` and one stylesheet | Low. The fallback covers a taken port. The per-launch token is unchanged, so access is unchanged. A fixed port also stops the per-port `dsh-auth-*` cookies from piling up (the 431 problem `forgetDshLogins` cleans up). |
| **2. One shared stylesheet scan in the Bot team's client.** A module-level class-name cache in `styles.js`, shared by all `installCompiledStyles` calls, so each sheet is walked once instead of once per installer. | ours (`bots-dsh`) | **Up to 50–70 ms** of renderer main thread per page load (85 ms inclusive under the profiler) | Low. Same assumption as today's per-installer cache: a sheet's rules don't change in place. The renderer was ~78% idle, so the saving shows only where this sits on the chain before the first API calls. |
| **3. Import `undici` lazily in our `dsh-subscriptions` fork,** only when a proxy is configured (`lib/proxy.js:3`). | ours (fork `automagik-genie/dsh-subscriptions`) | **~40–45 ms** boot CPU (undici, socks, ip-address, smart-buffer: 126 modules, 1.46 MB) | Low. Proxy users pay the import on their first proxied call. |
| **4. Drop the second `zod`.** `welcome-dsh` declares zod as a peer and uses the one DSH ships (4.4.3), and Omni's channels do the same. | ours + Omni | **~35 ms** boot CPU, and 852 kB less to ship | Medium-low. Only pays if *both* drop their copy. Unverified: that DSH's router (`collectInstallationScopePackages`) hands the runtime's zod to a profile plugin that declares it as a peer, as it does for `@deepseek-ai/*` peers. zod 4.6 → 4.4 API drift needs a test run. |

Together, cuts 1–4 come to ~275–450 ms on a warm start, about a fifth of today's ~1.6 s. Cut 1
alone is most of that and is a small change in `main.js` and `dsh.js`.

## Upstream asks (DSH core)

1. **Report ready earlier.** `dsh web:` waits for every entry of the loader tree
   (`dsh-web-app/lib/index.js:173`). Announce once `webServer` and `connection` are up, and
   let the rest settle after. Or let a profile mark entries as load-after-ready: inspector,
   OpenTelemetry, document preview (fontkit, brotli), and the plugin market. This is the
   largest cut available, potentially several hundred ms. It changes DSH's "all entries
   audited" guarantee, so it is DSH's to design.
2. **Cache module resolution for a read-only runtime.** `collectInstallationScopePackages`
   (`dsh-app-boot:716`) reads every runtime `package.json` on each boot: 30 ms warm, 138 ms
   on a first start. The resolve wrappers (`:1846-1930`, `:1988-2043`) add sync `realpath` and
   `existsSync` calls to every resolution, 115–235 ms in all. Inside a packaged app the
   runtime never changes, so both can be cached by build id.
3. **Describe settings lazily.** `dsh-settings` `describe` (`:413`, ~109 ms inclusive) runs at
   boot. It could run on the first `/api/settings/describe`.
4. **Load the page lazily.** Every start ships all 78 client modules, including
   `dsh-client-ui-settings-account` at 3.4 MB, `dsh-api-remotes` at 1.1 MB and the plugin
   manager. The settings and admin UIs could load when opened.
5. **Cache the hashed assets.** `/assets/index-*.js` and `vendor-*.js` (1.7 MB) carry no
   `Cache-Control`, so they missed the cache even on a reused port.

## Measured, no gain

Interleaved, 8 rounds, warm, spawn→ready:

| Experiment | Median | Min | CPU at ready (median) | Verdict |
|---|---|---|---|---|
| Baseline (Electron 44.5.0 as Node) | 1,071 ms | 936 ms | 1,805 ms | |
| `NODE_COMPILE_CACHE` (Electron's Node honours it; DSH doesn't set it; 1,767 entries written) | 1,198 ms | 927 ms | 1,840 ms | No gain: compile is ~110 ms of the profile, and the cache doesn't touch resolution or reads |
| Plain Node 24.13.1 instead of Electron as Node | 1,286 ms | 1,127 ms | 2,075 ms | Slower. Shipping a separate Node would not help |
| `hmr` entry disabled (overlay patch) | 1,065 ms | 931 ms | 1,785 ms | No gain at boot: its ~500 ms settle is concurrent. Its `hookCommonJsLoad` (~139 ms after ready) was not A/B'd against page load |
| `webserver` with `compression: none` (page, 3 pairs) | did-finish-load 587 vs 611 ms | | | ~25 ms, within noise. Not worth a profile override |

## How to re-run

The harness lived in the session scratchpad and is not in this PR. Its steps:

1. Run `node scripts/prepare-runtime.mjs` in `apps/desktop`.
2. Start DSH through `dsh.js`'s own functions with a scratch `AUTOMAGIK_HOME`, and Electron
   44.5.0 as `node` (`ELECTRON_RUN_AS_NODE=1`).
3. For profiles, pass
   `NODE_OPTIONS=--import=<preload>`. The preload does three things:
   - uses `module.registerHooks` to wrap `cordis-plugin-loader`'s `Entry._init`;
   - subscribes to the `undici:*` and `http.*` diagnostics channels;
   - runs `inspector.Session` with `Profiler.start` at import, and `Profiler.stop` when stdout
     prints `dsh web:`.
4. Load the page with a 30-line Electron main: a hidden `BrowserWindow`, `webRequest`
   listeners, `contentTracing` with `disabled-by-default-v8.cpu_profiler` for the renderer
   split.
5. Map combo-bundle lines back to plugins with the `__ModuleLoader__.load({ id })` markers.
