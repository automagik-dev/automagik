# The Automagik desktop app: how it is built

The [README](../README.md) is for people who use the app. This page is for people who build, release or change it.

It is Automagik's Bot team on a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) of its own, with the plugins already in it: the Bot team and the welcome from this repository (`apps/bots-dsh`, `apps/welcome-dsh`), and Omni's channels and canvases from one Omni release (`omni.json`). The app carries Automagik's version (`3.N.0`, the repository's), like the plugins built beside it.

Until 2.261023.x it was automagik-dev/omni-desktop, versioned as the Omni release it carried, and until 3.261023.x it was named Omni. Its last release there is this app, so an installed omni-desktop updates into it and then follows this repository's releases. On its first start an update moves the profile from the old plugin names (`@automagik/omni-dsh`, `@automagik/omni-ai-dsh`) to the new ones, keeping every setting row, and the Bot team's home is untouched (`src/dsh.js` `migrateRenamed`).

### The name, and the identity that stays

The app is **Automagik** wherever a person sees it: the bundle and its menu bar, the window, the update notice (`src/identity.js` `PRODUCT`), the desktop entry's Name, the dmg and the artifacts (`Automagik-<version>-…`). What an installed copy is known by stays as Omni shipped it, so it updates in place and keeps its data:

| Kept | Why |
|---|---|
| appId `ai.namastex.omni.desktop` | macOS (Squirrel) installs an update only for the same bundle id and signer; TCC permissions and preferences are filed under it. |
| `~/.omni/desktop` (`src/dsh.js` `appHome`) | the profile, the Bots, chats, memory, the Omni link (`ui/omni.json`), credentials (`dsh/.credentials.yaml`), logs and `preload`. No name is part of it. |
| Electron's userData `…/Omni` (`src/identity.js` `dataPathsOf`) | Electron names it after the app; `main.js` pins it before anything reads it, so the page's storage, each Bot browser's partition and the single-instance lock stay put. |
| Linux: executable `omni-desktop`, desktop entry id `omni-desktop.desktop` (`desktopName`), deb package `omni` | the window's app id and WM class, `/usr/bin/omni-desktop` and the AppArmor profile keep matching, and a new deb upgrades the installed package. It installs to `/opt/Automagik`. |
| the `omni://` scheme, `OMNI_DESKTOP_*` variables, `window.omniDesktop` | what Omni's pages, the CLIs and the plugins already use. |

There are no keychain items to carry: Electron keeps its cookies unencrypted (the cookie-encryption fuse is off), the app uses no `safeStorage`, and its credentials are the files above.

What an updated install shows: the update into the rename is announced by the installed app, so that one notice still reads "Omni <version> is ready"; after the restart the window, title bar, later notices and (macOS) menu bar and About say Automagik. On macOS the updater replaces the bundle where it is, so it stays `/Applications/Omni.app` (with `CFBundleName` and `CFBundleDisplayName` Automagik and the executable `Contents/MacOS/Automagik`), and Finder, Launchpad and the Dock may keep showing the file's name until the person renames it; a fresh install from the dmg is `Automagik.app`. A versioned AppImage is replaced by `Automagik-<version>-linux-x86_64.AppImage` in the same folder (electron-updater keeps a name without a version as it is).

> Labs: macOS (Apple silicon, signed and notarized) and Linux x64 (AppImage, deb; also WSL with WSLg). Windows itself is not supported.

## Install from the command line

```sh
omni desktop      # Omni's CLI: opens it with Omni preloaded
genie desktop     # Genie's CLI: opens it with Genie preloaded
```

downloads the build for this machine from this repository's releases, checks it against the release's `SHA256SUMS`, and opens it with `--preload=omni` or `--preload=genie`. Or download the dmg, AppImage or deb from [Releases](https://github.com/automagik-dev/automagik/releases).

### The preload

`--preload=omni|genie` (or `AUTOMAGIK_PRELOAD`) says which product the app was opened for. It is a preference, not another build: the launch that passes it saves it in `~/.omni/desktop/preload`, so later launches from the Dock or a desktop entry keep it, and the app hands it to DSH as `AUTOMAGIK_PRELOAD`. The welcome's team step lists that product first and starts with it chosen; the other stays a click away, then or later. No flag and nothing saved is no preference. The profile is the same either way.

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
- The window's own frame (`src/shell.html`, `shell.css`: the title bar, the update notice and the splash while dsh starts) wears the clay theme of the app inside, light or dark as the system is set (`prefers-color-scheme`). Before dsh's page paints, it and macOS's window show the clay table (`frame.js` `TABLE`, from Electron's `nativeTheme`), so a light system sees no dark flash. macOS has no vibrancy: clay is matte. Manrope and DM Sans are bundled in `src/fonts` with their licences (SIL OFL 1.1).
- Linux sandbox: Chromium needs user namespaces or a setuid helper, and Ubuntu 24.04+ restricts user namespaces. The deb installs an AppArmor profile that allows them for the app, so the window is sandboxed. An AppImage cannot carry one; on such a system its launcher runs without the sandbox and says so on stderr. Prefer the deb there.
- An AppImage opened directly is mounted with FUSE and needs `libfuse2` (`sudo apt install libfuse2t64` on Ubuntu 24.04+; WSL rarely has it). `omni desktop` needs none: it unpacks the AppImage once into `~/.omni/desktop/app/extracted/` and runs it from there. By hand: `./Automagik-*.AppImage --appimage-extract`, then `squashfs-root/AppRun`.
- Its profile switches DSH's own welcome notice and credential step off (`profile/cordis.patch.yml`), so the octopus opens the app.
- The app updates itself from this repository's releases (`v<version>`, the same ones `omni desktop` downloads; `src/update.js`). A release without desktop files (no update feed) is skipped. It checks 20 seconds after start, every 4 hours, 30 minutes after a failed check, and from **Check for Updates…** (the macOS app menu, or a right click on the title bar). A build follows its own release's channel: stable builds skip prereleases, and prerelease builds take both (`OMNI_DESKTOP_UPDATE_CHANNEL=stable|prerelease` overrides it). A newer build downloads in the background, and its sha512 is checked. The title bar then shows a notice with **Restart now** and **Later** (`frame.js` `updateView`, drawn by `shell.js`), and quitting installs it too. On macOS the update must carry the installed app's own signature, so only signed releases offer one. On Linux the AppImage updates itself when opened as an AppImage. A deb only says a newer release is out, and **Download** opens its release page. An AppImage unpacked by `omni desktop` updates by opening a newer one. Set `OMNI_DESKTOP_UPDATES=off` to turn updates off, or `OMNI_DESKTOP_UPDATE_FEED` to take them from another feed folder (https, or http on loopback). Every check is logged in `logs/update.log`, including "up to date".
- An update replaces the profile's packages and keeps everything you set: a setting a newer build ships is added to your `cordis.patch.yml` only when your file has no entry with its id, and `pnpm-workspace.yaml` is added when missing.

## Which plugins it carries

The Bot team and the welcome come from this repository at the same commit (`apps/*-dsh`, at the app's version). `omni.json` pins the Omni release whose channels and canvases the app carries: its version and commit. The build packs each plugin with `npm pack` and refuses one at another version. It also refuses a dsh other than the one the plugins are tested on (`runtime/package.json` against `apps/bots-dsh/dev/harness` here and Omni's `apps/omni-channels-dsh/dev/harness`).

`follow-omni.yml` (repository root) checks Omni's releases every 30 minutes. When Omni has cut a newer one tested on the same dsh, it moves `omni.json` to it on dev and cuts an Automagik release (`release.yml`), which builds the app (`desktop-build.yml`).

## Build

```sh
npm ci                  # Electron and electron-builder
npm test                # the main-process logic, without Electron
npm run dist:linux      # dist/Automagik-<version>-linux-x86_64.AppImage and -amd64.deb
npm run dist:mac        # on macOS: dist/Automagik-<version>-mac-<arch>.dmg and .zip, signed and notarized (see macOS)
```

The profile also ships the add-ons that connect AI subscriptions, each from Omni's reviewed fork at the commit `profile/package.json` pins (the version it holds is under `omni.addonVersions`, and the build checks it): `@goodandready/dsh-subscriptions` ([automagik-genie/dsh-subscriptions](https://github.com/automagik-genie/dsh-subscriptions), the plans DSH doesn't sign in to itself, with no updater of its own) and `dsh-oh-my-claude` (Claude through the person's own Claude Code). The profile is installed the way DSH installs any plugin, with the pinned dsh's own `dsh plugin --profile omni install` (pnpm, hoisted, no install scripts), so its pnpm lockfile ships with it.

`dist:*` first runs `scripts/prepare-runtime.mjs`: it packs the Bot team and the welcome from `../bots-dsh` and `../welcome-dsh`, fetches Omni at `omni.json`'s commit (only its plugin folders) into `build/omni`, installs the pinned dsh into `build/runtime`, and installs the packed plugins into `build/profile`, in one install. Set `OMNI_SOURCE` to a local Omni checkout to pack its channels and canvases instead. Native packages are per platform, so build each target on its own platform. Builds run with `DO_NOT_TRACK=1`.

To run from a checkout: `npm run prepare-runtime`, then `npx electron .` (add `--no-sandbox` on a system where Chromium's sandbox cannot start unpackaged).

### The icon

`assets/icon.svg` is the icon's source: the owner's clay triskelion (`assets/mark.png`, the kit-v4 source, kept as delivered) on a cream clay tile. electron-builder makes every platform's icons from `assets/icon.png`, which is the SVG rendered by headless Chromium (`--no-sandbox` where its sandbox cannot start; the SVG loads `mark.png` beside it):

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

Releases are signed with the Developer ID Application certificate and notarized in CI (`desktop-build.yml`, with the `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` secrets). Without them the dmg is unsigned and the release offers no macOS update.

`npm run dist:mac` on a Mac signs with the certificate in its login keychain, under the hardened runtime (`assets/entitlements.mac.plist`), and notarizes when `APPLE_KEYCHAIN_PROFILE` names a `notarytool` profile:

```sh
xcrun notarytool store-credentials omni-notary   # once
APPLE_KEYCHAIN_PROFILE=omni-notary npm run dist:mac
```

Signing reads the login keychain, so run it from a Terminal in the Mac's own session (over ssh the keychain is locked).

The dmg is signed, notarized and stapled too (`electron-builder.yml` `dmg.sign`, and `desktop-build.yml` sends it to Apple's notary and writes its new checksum into `latest-mac.yml` with `scripts/restamp-feed.mjs`). Every release is the repository's Latest and also carries `Automagik-Mac.dmg`, `Automagik-Linux.AppImage` and `Automagik-Linux.deb`, and the same files as `Omni-Mac.dmg`, `Omni-Linux.AppImage` and `Omni-Linux.deb` for links made before the rename, so `releases/latest/download/<name>` always fetches the newest. `omni desktop`, `genie desktop` and the updater read only the versioned names, and match them by what follows the version (`-linux-x86_64.AppImage`, `-mac-arm64.dmg`), so the name in front can change.
