# Omni desktop: how it is built

The [README](../README.md) is for people who use the app. This page is for people who build, release or change it.

It is the Omni UI on a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) of its own, with Omni's plugins already in it: the team, channels, canvases and the welcome. Each release carries one Omni release: the app's version is that Omni's version, and so is every plugin in it.

> Labs: macOS (Apple silicon, signed and notarized) and Linux x64 (AppImage, deb; also WSL with WSLg). Windows itself is not supported.

## Install from the command line

```sh
npx @automagik/omni desktop
```

downloads the build for this machine from this repository's releases, checks it against the release's `SHA256SUMS`, and opens it. Or download the dmg, AppImage or deb from [Releases](https://github.com/automagik-dev/omni-desktop/releases).

## How it works

- Electron's main process starts dsh with Electron's own Node (`ELECTRON_RUN_AS_NODE`), on `127.0.0.1` and a free port, and opens the launch URL dsh prints with its per-launch token. Quitting stops dsh.
- Everything the app keeps is in one folder, `~/.omni/desktop` (`OMNI_DESKTOP_HOME`, or `$OMNI_HOME/desktop`):

  | Folder | What |
  |---|---|
  | `dsh/` | dsh's home (`DSH_HOME`): its Sessions, settings, and the `omni` profile the app copies in from the build |
  | `ui/` | the Omni UI plugin's home: the Bot team, and `omni.json`, the Omni this app is linked to (0600) |
  | `bin/` | `node` and `pnpm` for dsh, written at each launch: both run on the app's own Electron as Node, so installing a plugin (Settings → Plugins, the market) needs nothing on the machine |
  | `logs/dsh.log`, `logs/update.log` | dsh's output, and the update checks |

  It is apart from a dsh you already run (`~/.dsh`) and from the Omni UI plugin installed into that dsh (`~/.omni/ui`).
- The window is a plain page: context isolation and the renderer sandbox are on, there is no Node in it, it stays on dsh's origin, and web links (a `wa.me` link, docs) open in your browser. Other schemes are refused.
- Linux sandbox: Chromium needs user namespaces or a setuid helper, and Ubuntu 24.04+ restricts user namespaces. The deb installs an AppArmor profile that allows them for the app, so the window is sandboxed. An AppImage cannot carry one; on such a system its launcher runs without the sandbox and says so on stderr. Prefer the deb there.
- An AppImage opened directly is mounted with FUSE and needs `libfuse2` (`sudo apt install libfuse2t64` on Ubuntu 24.04+; WSL rarely has it). `omni desktop` needs none: it unpacks the AppImage once into `~/.omni/desktop/app/extracted/` and runs it from there. By hand: `./Omni-*.AppImage --appimage-extract`, then `squashfs-root/AppRun`.
- Its profile switches DSH's own welcome notice and credential step off (`profile/cordis.patch.yml`), so the octopus opens the app.
- The app updates itself from this repository's releases (`v<version>`, the same ones `omni desktop` downloads; `src/update.js`). It checks 20 seconds after start, every 4 hours, 30 minutes after a failed check, and from **Check for Updates…** (the macOS app menu, or a right click on the title bar). A build follows its own release's channel: stable builds skip prereleases, and prerelease builds take both (`OMNI_DESKTOP_UPDATE_CHANNEL=stable|prerelease` overrides it). A newer build downloads in the background, and its sha512 is checked. The title bar then shows a notice with **Restart now** and **Later** (`frame.js` `updateView`, drawn by `shell.js`), and quitting installs it too. On macOS the update must carry the installed app's own signature, so only signed releases offer one. On Linux the AppImage updates itself when opened as an AppImage. A deb only says a newer release is out, and **Download** opens its release page. An AppImage unpacked by `omni desktop` updates by opening a newer one. Set `OMNI_DESKTOP_UPDATES=off` to turn updates off, or `OMNI_DESKTOP_UPDATE_FEED` to take them from another feed folder (https, or http on loopback). Every check is logged in `logs/update.log`, including "up to date".
- An update replaces the profile's packages and keeps everything you set: a setting a newer build ships is added to your `cordis.patch.yml` only when your file has no entry with its id, and `pnpm-workspace.yaml` is added when missing.

## Which Omni it carries

`omni.json` pins the Omni release the app is built from: its version and commit. The build takes Omni's plugins from that commit (`apps/*-dsh` in Omni), packs each with `npm pack`, and refuses one whose version is not that Omni's. It also refuses a dsh other than the one Omni tests its plugins on (`runtime/package.json` against Omni's `apps/omni-ui-dsh/dev/harness`).

`follow-omni.yml` checks Omni's releases every 30 minutes. When Omni has cut a newer one, it moves `omni.json` and the app's version to it, commits that, and releases the app at the same version. Dispatch it to do so at once.

## Build

```sh
npm ci                  # Electron and electron-builder
npm test                # the main-process logic, without Electron
npm run dist:linux      # dist/Omni-<version>-linux-x86_64.AppImage and -amd64.deb
npm run dist:mac        # on macOS: dist/Omni-<version>-mac-<arch>.dmg and .zip, signed and notarized (see macOS)
```

The profile also ships add-ons from npm at the exact versions `profile/package.json` names: `@goodandready/dsh-subscriptions` (AI subscription sign-ins) and `dsh-oh-my-claude` (Claude through the person's own Claude Code). The profile is installed the way DSH installs any plugin, with the pinned dsh's own `dsh plugin --profile omni install` (pnpm, hoisted, no install scripts), so its pnpm lockfile ships with it.

`dist:*` first runs `scripts/prepare-runtime.mjs`: it fetches Omni at `omni.json`'s commit (only its plugin folders) into `build/omni`, installs the pinned dsh into `build/runtime`, and installs the packed plugins into `build/profile`, in one install. Set `OMNI_SOURCE` to a local Omni checkout to pack its plugins instead. Native packages are per platform, so build each target on its own platform. Builds run with `DO_NOT_TRACK=1`.

To run from a checkout: `npm run prepare-runtime`, then `npx electron .` (add `--no-sandbox` on a system where Chromium's sandbox cannot start unpackaged).

### The icon

`assets/icon.svg` is the icon's source: the Omni octopus on a night-sky tile. electron-builder makes every platform's icons from `assets/icon.png`, which is the SVG rendered by headless Chromium:

```sh
chrome-headless-shell --screenshot=assets/icon.png --window-size=1024,1024 \
  --default-background-color=00000000 --hide-scrollbars "file://$PWD/assets/icon.svg"
```

## Measured (labs prototype, 2026-10-20, Linux x64)

| | |
|---|---|
| AppImage | 251 MB |
| deb | 208 MB |
| dsh runtime, unpacked | 864 MB (145 MB of it is LibreOffice WASM for document previews) |
| Memory after start, idle | about 1.0 GB RSS across Electron's processes and dsh (dsh itself about 290 MB) |

## macOS

Releases are signed with the Developer ID Application certificate and notarized in CI (`release.yml`, with the `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` secrets). Without them the dmg is unsigned and the release offers no macOS update.

`npm run dist:mac` on a Mac signs with the certificate in its login keychain, under the hardened runtime (`assets/entitlements.mac.plist`), and notarizes when `APPLE_KEYCHAIN_PROFILE` names a `notarytool` profile:

```sh
xcrun notarytool store-credentials omni-notary   # once
APPLE_KEYCHAIN_PROFILE=omni-notary npm run dist:mac
```

Signing reads the login keychain, so run it from a Terminal in the Mac's own session (over ssh the keychain is locked).

The dmg is signed, notarized and stapled too (`electron-builder.yml` `dmg.sign`, and `release.yml` sends it to Apple's notary and writes its new checksum into `latest-mac.yml` with `scripts/restamp-feed.mjs`). Every release is the repository's Latest and also carries `Omni-Mac.dmg`, `Omni-Linux.AppImage` and `Omni-Linux.deb`, so `releases/latest/download/<name>` always fetches the newest; `omni desktop` and the updater read only the versioned names.
