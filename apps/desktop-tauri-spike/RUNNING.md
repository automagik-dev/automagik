# Running the Tauri spike

Throwaway spike for D12 (see FINDINGS.md). Nothing here ships.

```sh
cd apps/desktop-tauri-spike/src-tauri
cargo tauri build --bundles app          # release .app, ~2 min (LTO)
cargo build                              # or a debug binary, for quick runs
```

The app needs DSH's runtime and the `omni` profile: `apps/desktop/build` when it was built
(`node scripts/prepare-runtime.mjs` in apps/desktop), else the installed
`/Applications/Automagik.app/Contents/Resources` (read-only; the profile is copied out).
It never uses `~/.automagik`: the home defaults to `$TMPDIR/automagik-tauri-spike/desktop`.

Measure one launch (cold start timeline, idle RSS of app + DSH + WebKit, then stop all):

```sh
./measure.sh "src-tauri/target/release/bundle/macos/Automagik Spike.app" /tmp/spike-home 20
./measure.sh "…/Automagik Spike.app" /tmp/spike-home 5 SPIKE_PROBES=basic   # + WebKit probes
./measure.sh "…/Automagik Spike.app" /tmp/spike-home 5 SPIKE_PROBES=mic     # + microphone, speech
```

The probe report lands in `<home>/report.json`. Bot browser views (two child webviews, each on
its own persistent data store) next to DSH's page:

```sh
python3 -m http.server 8771 --bind 127.0.0.1 -d test &
./measure.sh "…/Automagik Spike.app" /tmp/spike-home 5 SPIKE_BOT_URL=http://127.0.0.1:8771/bot.html
```

Knobs: `SPIKE_HOME`, `SPIKE_RESOURCES`, `SPIKE_NODE`, `SPIKE_URL`, `SPIKE_PROBES`,
`SPIKE_REPORT`, `SPIKE_BOT_URL` (top of `src-tauri/src/main.rs`).

Cross-OS matrix (macOS, Ubuntu, Windows; both shells; FINDINGS.md "Cross-OS matrix"), by hand only:

```sh
gh workflow run cross-os.yml --ref spike/cross-os -f desktop_ref=<dev commit>
```

The harness is `cross-os/run.mjs` (one JSON line per check); the run summary has the table.
`SPIKE_CDP_PORT` (Windows) opens WebView2's CDP on each Bot view.
