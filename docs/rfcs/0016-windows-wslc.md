# RFC 0016: Windows on a Linux sandbox (WSL containers)

| Field | Value |
|---|---|
| Status | In delivery (delivery 2: #349; the Windows build turned off by #284; 3-6 open; accepted 2026-11-04, by the owner; answers: D38, D39, Q1-Q9) |
| Milestone | not scheduled |
| Lanes | desktop (3.N); herdr (3.N.P) for the pack's split install; am (3.N.P) |
| Created | 2026-11-04 |
| Amends | [0010](0010-desktop-sandbox.md) (sandbox), [0012](0012-am-cli-and-parts.md) (targets) |

## Summary

On Windows, Automagik keeps two programs native: the Electron window and herdr-app. Everything
else runs in Linux inside a WSL container (WSLC, WSL 3.0.1 or later): DSH on its own Node,
pnpm, the plugins, Claude Code, Codex, the ACP adapters, git, bash, herdr-core `hc` and every
terminal. First run asks for one UAC prompt, plus a restart only if Virtual Machine Platform was
off; after that it is silent. Where WSL cannot run, the app explains why and stops: there is no
native mode. Projects live on the Linux disk. This RFC decides the processes and links, the
image and how it updates, the first-run screens, the caps, the inner fence, uninstall, the
threat model and the deliveries, starting with a spike that measures what the research could
not.

## Motivation

Native Windows did not work well enough to ship. The owner pulled it (D38): the v3.69.0 Windows
assets were removed and Windows publishing stopped. The tools the product runs on are weakest
there: Claude Code's sandboxing is "not supported" on native Windows and WSL1, and is supported
on WSL2 **[doc]** ([Claude Code setup](https://code.claude.com/docs/en/setup)). Codex's Windows
sandbox is Windows process isolation, and Codex itself recommends WSL for Linux-native tooling
**[doc]** ([Codex Windows](https://learn.chatgpt.com/docs/windows/windows-sandbox)). RFC 0010's
four Windows fixes (`npm.cmd` through a shell, `#!/bin/sh` shims, signing, a feed) would only
make the weakest platform limp along. VS Code Remote-WSL is the precedent for this split: UI on
Windows, server and extensions in Linux, over a local TCP port **[doc]**
([VS Code WSL](https://code.visualstudio.com/docs/remote/wsl)).

Research: `~/.config/herdr-app/handoffs/windows-linux-sandbox-research-2026-11-04.md` (labels
**[doc]**, **[src]**, **[press]**, **[unverified]**, **[estimate]** are its own and are kept
here). No Windows machine was used for it, so every number below is a source's or is marked.

## Decided

- **D38** (the owner, 2026-11-04): native Windows is pulled. Windows comes back only as a
  Linux-sandboxed build. It supersedes D36 and D37 for shipping.
- **D39** (the owner, 2026-11-04): WSLC, WSL 3.0.1+; only the Electron window and herdr-app run
  natively; one UAC prompt at first run, plus a restart only if Virtual Machine Platform was
  off; no WSL means explain and stop; projects live inside the Linux disk (`\\wsl.localhost`).
- **Spike venue and the Windows deliveries** (the owner, 2026-11-04, answering where the spike
  runs): "i got a coworker with windows, one we can hand off this specific task to, for him to
  finish. hes currently using automagik herdr via wsl", and later "the pr with context and
  handoff for my windows dev to finish the wslc". So the spike (delivery 1) runs on that
  coworker's own Windows x86_64 PC, not on a VM on the Mac (an ARM VM there would measure the
  wrong hardware). The Windows deliveries go to the same developer: 3, the desktop half of 4,
  and 5 ([the handoff](0016-windows-handoff.md)).

D39 overrides the research on two points. The research ranked a private WSL2 distro first and
WSLC second, and it kept native Windows as the last rung of a fallback ladder. D39 takes WSLC
and drops the ladder. WSLC fits D39 better than a distro for three reasons. A session's CPU and
memory are set in code, and the user's `.wslconfig` does not apply to it **[doc]**
([container settings](https://learn.microsoft.com/en-us/windows/wsl/wsl-container-settings)).
It is not a distro **[doc]**, so it does not show in `wsl -l` and is not one of the user's own
distros to edit. And the app owns its storage path. The cost: WSLC went GA on 2026-09-29 in
WSL 3.0.1 **[doc]** ([GA post][ga],
[3.0.1](https://github.com/microsoft/WSL/releases/tag/3.0.1)), five weeks ago, and Windows 10
support is reported only by the press **[press]**
([Windows Latest][winlatest]).
The research's `wsl.exe -d automagik` commands belong to the distro design and are not used
here.

Two parts of D39 the design could not promise. The owner settled both:

- **`\\wsl.localhost`.** That share lists WSL distros, and a WSLC session is not one, so the
  projects volume may not show there (Design, "Projects"). Q1 below decides what happens then.
- **Only two native programs.** The design already needs app-internal processes on Windows:
  `automagik-wslc.exe` stays alive while it holds `dsh-launch`'s stdio, plus one per
  `hc --via` link. herdr-app may also need a bridge `hc` on Windows to reach the guest's core.
  This RFC reads D39 as: **app-internal helpers that hold no terminals and run no tools count
  as the app.** Both the helper and a bridge `hc` pass that test; every terminal, agent, shell
  and tool still runs in Linux. The owner confirmed the reading (Q3 below).

**Answers to the open questions** (the owner, 2026-11-04, each as the draft recommended; Q3 also
says the helpers ship on the app's lane and version). The numbers are the draft's question
numbers.

- **Q1. `\\wsl.localhost` if the volume does not show there.** (a) or (b), whichever the spike's
  measurements support. (a): projects stay on the volume, and Windows reaches them only through
  the app and Herdr. (b): projects move to a Windows folder mounted over virtiofs. The rule: (a)
  if the spike's virtiofs `git status` and `pnpm install` are more than 2x slower than the
  volume, else (b), which also keeps projects safe through an uninstall. (c), a companion
  distro, is dropped. If the volume does show at `\\wsl.localhost`, nothing changes.
- **Q2. How Electron drives WSLC.** A helper exe, `automagik-wslc.exe`, against the flat WSLC C
  API (NuGet `Microsoft.WSL.Containers`). Not FFI to `wslcsdk.dll` from Electron, and not
  `wslc.exe`'s output.
- **Q3. Native helpers under D39.** Helpers with no terminals and no tools count as part of the
  app: the same lane and the same version as the desktop app. Both stay: `automagik-wslc.exe`
  and the bridge `hc`. herdr-app attaching to a core over a command (a herdrdev question) would
  remove the bridge; that is a nicety, not a blocker.
- **Q4. Windows 10.** Windows 11 only. Windows 10 22H2 is supported only if the spike passes
  there.
- **Q5. The image.** Downloaded at first run and when its pinned hash changes, not bundled in
  the installer.
- **Q6. Signing.** Windows builds (`automagik-wslc.exe` and the installer) are code-signed
  before delivery 6. Signing is owner-held.
- **Q7. Caps.** Half the logical CPUs (at least 2), and half the RAM up to 8 GB (at least
  4 GB), until the spike's numbers say otherwise.
- **Q8. Native Windows data from before D38.** No migration. First run offers once to copy
  `%USERPROFILE%\.automagik\desktop\bots` into the guest, if it exists.
- **Q9. am-quota on Windows.** am-quota runs through the machine (the guest): it reads the
  guest's Claude Code credentials, as for any remote machine. It does not run natively and does
  not use Windows' credential store.

## Design

### Processes and where each runs

| Where | What |
|---|---|
| Windows, as the user | Electron (window, updater, Bot browser views, the CDP relay `bot-relay.js`, the WSLC boundary); `automagik-wslc.exe`, the app's helper for the WSLC API; herdr-app and the pack's mod files it loads; a local `hc` with no terminals, as herdr-app's bridge (Q3) |
| Windows, elevated once | `automagik-wslc.exe install`, the first-run component install (the UAC prompt) |
| WSL service (Microsoft's) | `wslservice.exe` (privileged) creates the VM through HCS and hands it to a per-user `wslcsession.exe` **[doc]** ([architecture](https://devblogs.microsoft.com/commandline/wslc-architecture-deep-dive/)) |
| WSLC session `automagik`, one container `automagik`, user `automagik` (uid 1000) | `dsh-launch` (the guest launcher), DSH on the image's Node, pnpm, plugins, Claude Code, Codex, ACP adapters, git, bash, `hc` and all its terminals, `am` and the pack's CLI (`automagik-herdr`, hooks, `run.sh`); Omni later |

One session, one long-lived container. DSH and the terminals share it, so a Bot's workspace and
a Herdr terminal see the same files, as on macOS.

**Inside the container.** The image is read-only code at `/opt/automagik`. One named VHD volume
(`WslcCreateSessionVhdVolume` **[doc]**, [API reference](https://wsl.dev/api-reference/)) is
mounted at `/home/automagik`. It holds everything that is the person's: `~/.automagik` (the
desktop home with `dsh/`, `bots/` and `bin/`, as `src/dsh.js` lays it out today, and
`~/.automagik/bots`, the public contract), `~/projects`, the pnpm store, the agent CLIs' logins
and updates. A new image never touches the volume.

### Electron to DSH

Today (`apps/desktop/src/dsh.js:756`) Electron spawns DSH on Electron-as-Node
(`ELECTRON_RUN_AS_NODE`) with stdio `['ignore', 'pipe', 'pipe', 'ipc']`. It reads DSH's launch
URL (`dsh web: http://127.0.0.1:<port>/…token=…`, `launchUrlOf`) from stdout and answers the Bot
browser bridge over the `ipc` channel (`answerDsh`, `ds-bot:browser-endpoint`,
`src/main.js:340`). Neither the `ipc` file descriptor nor AF_UNIX crosses into a WSL VM
(AF_UNIX host to guest is open [WSL #5961](https://github.com/microsoft/WSL/issues/5961)
**[issue]**). So on Windows:

1. **The launcher.** Electron asks the helper to run `/opt/automagik/bin/dsh-launch` in the
   container with piped stdio (process stdio through the API **[doc]**). The launcher spawns DSH
   inside the guest exactly as `startDsh` does today, with an `ipc` channel. It relays that
   channel to Electron as framed messages on its own stdin and stdout. DSH's log goes to a file
   in the volume and to the launcher's stderr. The Bot team's plugin keeps calling
   `process.send` and needs no change.
2. **Port and token handshake.** DSH listens on a fixed container port (41700). Its network
   namespace is private, so the port cannot collide with anything. The container is created
   with a port mapping from Windows `127.0.0.1:<host port>` to it; the default bind is
   127.0.0.1 **[doc]** ([WSL container][wslc]).
   The host port is today's stable one (`portFileOf`, RFC 0007), so the page's origin and
   storage stay the same across launches. A taken port is today's behaviour, unchanged: the app
   checks the kept port before it starts (`launchPort`), and on DSH's `EADDRINUSE` it starts
   once more on a fresh one and keeps that (`startDshOnPort`, `apps/desktop/src/dsh.js:593-604`).
   Here the start on a fresh port also recreates the container's mapping; the volume is
   untouched. As today, the page's origin changes with the port, so that origin's
   localStorage (unsent drafts) is not carried over; the Bot team's data lives in DSH, not in
   the page, and survives. DSH may have to bind the container's interface rather than
   127.0.0.1 for the mapping to reach it **[unverified]**: the spike checks. The launcher sends
   one framed `ready` message with the in-guest URL; Electron swaps in the host port and keeps
   the token. Every token check stays: any Windows process of this user can reach a mapped
   loopback port.
3. **Fallback over stdio.** If port mapping is refused or broken, Electron runs its own loopback
   listener and tunnels each connection through the launcher's framed stdio. It is slower, and
   it exists so that a broken mapping is a degraded start, not a dead one.
4. **The Bot browser.** `bot-relay.js` listens on Windows `127.0.0.1` and hands DSH a
   `ws://127.0.0.1:<port>/devtools/browser/<token>` URL for Playwright. Inside the container,
   127.0.0.1 is the container. Whether the guest can reach the Windows host's loopback under
   WSLC's networking ("Consommé" **[doc]**), and at which address, is **[unverified]**. The design
   does not depend on it: the launcher listens on the container's 127.0.0.1 and tunnels each
   connection over the framed stdio to Electron, which connects to the relay from 127.0.0.1. The
   relay's checks (a loopback peer, no Origin, a 64-hex token per Bot) hold unchanged. The URL
   handed to DSH names the launcher's port.
5. **The exchange folder.** One Windows folder, `%LOCALAPPDATA%\Automagik\exchange`, is
   mounted into the container over virtiofs (volumes are virtiofs **[doc]**) at
   `/mnt/automagik-exchange`. It is the only Windows folder mounted. It has two parts.
   `downloads/` is where a Bot's browser downloads land: the relay's `downloadRoots` are paths,
   and the launcher translates them both ways. `lane/` is where Electron hands over verified
   plugin tarballs (see "The image").
6. **Links out and sign-in callbacks.** Claude Code's and Codex's sign-in flows open a browser.
   `xdg-open` in the guest has nowhere to go, so the image puts an `xdg-open` (and `BROWSER`)
   shim on PATH that hands the URL to the launcher. The launcher's `open` message asks Electron
   to open it with `shell.openExternal`, for `https:` URLs only. A browser OAuth flow then
   redirects to a listener on `localhost:<port>` inside the container, and only 41700 is
   mapped. So when the opened URL's `redirect_uri` names `localhost` or `127.0.0.1`, the
   launcher asks Electron for a **reverse tunnel**, the mirror of the CDP one: Electron listens
   on Windows `127.0.0.1:<that port>` and carries each connection over the framed stdio to the
   guest's `127.0.0.1:<that port>`. It closes after the first callback or 10 minutes. If the
   port is taken on Windows, the sign-in falls back to the CLI's no-callback path: Claude
   Code's paste-the-code prompt, and Codex's device-code login **[unverified for both; the
   spike checks]**.
7. **Parent death.** When Electron dies, the helper's process ends and the launcher's stdin
   closes. The launcher stops DSH on stdin EOF (RFC 0010 delivery 1's watch, done here by
   construction).

### herdr-app to hc

herdr-app stays native: it has a Windows build (x86_64, Windows 10 1803+, RFC 0013's table).
Electron's control of herdr-app (RFC 0013: `ls`, `do`, `status`, the Windows socket or named
pipe) is unchanged, since both are on Windows. herdr-core and every terminal run in the guest.

`hc` already speaks its API over stdio (`hc connect`). It adds a machine reached through a
command with `hc machine add --via <command> --name <n>`, where the command "must pass bytes
both ways untouched and ask nothing" (`hc machine add --help`). The link is therefore
`hc machine add --via "automagik-wslc.exe exec --" --name linux`: the helper runs the given
shell line in the container with byte-clean stdio. Whether WSLC's process stdio is byte-clean
for the framed protocol is **[unverified]**, the spike's first herdr check. To herdr-app the
guest is a machine like any remote one. The pack already reads and writes a linked machine's
`.herdr/bots.json` through herdr-core (`hc file read --on <machine>` and `hc file edit`,
`herdr/mods/am-sidebar/remoteFile.js`), so the sidebar's Bot list works the same against the
guest. Other mods that read local files read them through the machine too (delivery 4).

Whether herdr-app can attach to a core that is not local, without an `hc` on Windows, is a
question for herdrdev (Q3: a nicety, not a blocker). Until it can, the only way with today's
`hc` is a local `hc` on Windows as the bridge, with `linux` as its default machine and no
terminals of its own. It passes the reading in Decided (no terminals, no tools), as the helper
does.

**The pack splits.** Mod `.js` files are loaded by herdr-app, so they install on Windows into
herdr-app's home. The pack's CLI, hooks and `run.sh` run in panes, so they install in the
guest. Each half has one writer. **On Windows the desktop app is the only writer of the mods**:
Windows has no `sh` for `install.sh`, and the pack's updater runs in the guest. The app reads
the `herdr-lane` pointer, checks it against `herdr/mods/am-sidebar/pack-keys.json` and the
tarball against its sha256, as `install.sh` does, and never downgrades. **In the guest, `am` is
the only writer** of the CLI half, from the same tarball. The pack's updater in the guest
updates only that half.

### The image

- **Base: Debian slim** (glibc). Claude Code on musl needs extra packages and
  `USE_BUILTIN_RIPGREP=0` **[doc]**, Codex and the ACP adapters on musl are **[unverified]**,
  and native pnpm modules expect glibc. Size with Node, git and the CLIs: about 300-500 MB
  **[estimate]**.
- **Baked in:** Node (the newest 24 LTS, at least 22.19, the floor DSH needs: RFC 0010 question
  2), the app's pinned pnpm 10, git, bash, coreutils, openssh-client, ripgrep, bubblewrap,
  ca-certificates, `hc`, the DSH runtime the desktop ships today (`runtime/`), `dsh-launch`,
  `am`, and seed copies of Claude Code, Codex and the ACP adapters. On first start the seeds are
  copied into the volume. From then on each updates as it does today (Claude Code's updater;
  acp-dsh's pnpm installs), so a new CLI never needs a new image.
- **Code updates ride the signed plugin lane.** `lane.js` keeps every check it has (ed25519
  pointer, sha256 and sha512, size, the 3.N line, engines.dsh, bad versions) and stays in
  Electron, with its state files (`staged.json`, `applied.json`, `bad.json`). Only its last
  step moves: Electron writes the verified tarball into the exchange folder's `lane/`, and
  `dsh-launch` unpacks it into the profile before DSH starts, and puts `.lane-prev` back when
  Electron reports a failed trial. Electron verifies, so the trust root stays in the signed
  app. An agent in the guest could write into `lane/` too, but it can already write its own
  profile; the lane guards the download, not the guest from itself. The guest unpacks, because
  the profile and pnpm's records are Linux paths and the unpack is the code that already does
  it (`pinLanePackage`).
  The trial and its rollback are unchanged: the page must draw the Bot team, or the previous
  plugins come back.
- **The base image updates with the desktop lane.** Each desktop release (3.N) that changes an
  input of the image attaches `automagik-linux-image-<v>.tar` and its `.sha256` (an OCI image
  tarball for `WslcImportSessionImageFromFile` **[doc]**). The app's build pins the image's
  sha256, so the image's trust rides electron-updater's sha512 check of the app. After an app
  update, Electron downloads the image when the pinned hash differs from the running one,
  checks it, imports it, and starts a new container from it on the same volume. That start is a
  trial, as the lane's is: no `ready` and no Bot team in time, and the previous image (kept
  until the next good start) comes back. Plugin patches (3.N.P) never touch the image.

### First run, screen by screen

The installer stays per-user NSIS with no admin. The app's first launch:

1. **Checking this PC.** No UI unless it takes over a second. The helper calls
   `WslcGetMissingComponents` **[doc]** ([WslcComponentFlags][flags])
   and reads the WSL policy keys (`WSL.admx` **[doc]**).
2. **Nothing missing:** straight to step 5.
3. **"Automagik runs its tools in Linux."** One screen: what will be installed (Windows'
   Virtual Machine Platform and WSL, about 367 MB for the 3.0.3 x64 MSI **[doc]**), that Windows
   will ask once for permission, and that a restart may follow. One button, **Set up**. It runs
   `automagik-wslc.exe install` elevated: the one UAC prompt. The SDK's install refuses to run
   unelevated (`ERROR_ELEVATION_REQUIRED`) **[src]**
   ([wslcsdk.cpp](https://github.com/microsoft/WSL/blob/master/src/windows/WslcSDK/wslcsdk.cpp)).
   If the Store is blocked, it installs from the web download or the GitHub MSI **[doc]**
   ([basic commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)).
4. **"Restart to finish"**, only when DISM returned `ERROR_SUCCESS_REBOOT_REQUIRED` **[src]**.
   Buttons **Restart now** and **Later**. A per-user RunOnce entry reopens the app after the
   restart, and any later launch resumes here too. Dev Home found that a first install stays
   unregistered until after the reboot **[issue]** ([devhome #3410][devhome]),
   so nothing past this step runs before it.
5. **"Preparing your workspace."** A progress bar: the image is downloaded (Q5: it is not in the
   installer), checked against its sha256, imported, the session and the volume are created, and
   the container starts. Then the usual splash, and the Bot team.

After this no step asks anything. The policy is read again at every launch, since an admin can
turn WSL off later.

**Failure screens.** Each one says what is wrong in one sentence, who can fix it, links
Microsoft's page, and has **Check again** and **Quit**. None of them offers a native mode.

| Cause (detected by) | Screen |
|---|---|
| "Allow the Windows Subsystem for Linux" off (policy) | Your organization turned off WSL on this PC; ask your IT admin. |
| "Allow WSL containers" or "Allow privileged WSL containers" off, or a registry allowlist without us (policy) | Your organization does not allow WSL containers. |
| Inbox WSL disabled and the Store blocked (policy) | WSL cannot be installed here; ask IT for the WSL 3.0.1 or later MSI. |
| Virtualization off in firmware (component check, or the session fails with a virtualization error) | Turn on virtualization (VT-x or AMD-V) in your PC's firmware settings. |
| No nested virtualization (a VDI or cloud desktop) | This virtual desktop cannot run Linux; ask for one with nested virtualization. |
| WSL older than 3.0.1 | Update WSL (one UAC prompt, the same flow as step 3). |
| Windows too old (below 19041, or Windows 10 if the spike rules it out) | This Windows version cannot run Automagik. |
| UAC declined | Setup needs your permission once; **Set up** again. |

The enterprise gates come from the research's table (Intune's baseline disables inbox WSL
**[doc]**, [Intune settings](https://learn.microsoft.com/en-us/windows/wsl/intune)).

### Resource caps

A session gets its `CpuCount` and `MemoryMB` in code, and `.wslconfig` does not apply **[doc]**.
Defaults (Q7): half the logical CPUs (at least 2), and half the RAM capped at 8 GB (at least
4 GB). Settings gets a "Linux workspace" row for both; a change applies at the next session
start. The volume grows on demand **[unverified: whether the API sets a maximum]**. With no
Electron window, no herdr-app and no live `hc` terminal, the session stops after 15 minutes
idle. Whether a session outlives the process that created it is **[unverified]** (the spike
measures it); the design wants terminals to survive a closed window, as they do on macOS.

**When the session ends under a running app.** `wsl --shutdown`, a WSL update, or sleep and
hibernate may end the session **[unverified; the spike checks each]**. Electron sees the
launcher's stdio close without a stop it asked for. It shows "Restarting the Linux workspace",
starts the container again on the same volume, and reloads the page once `ready` comes back, as
its restart of DSH alone does today. A crash loop stops after RFC 0010 delivery 1's backoff,
with a Retry. Terminals in the guest end with the VM; kept ones (`hc keep`) come back as shells.
The bridge `hc` sees machine `linux` as away and reconnects through the helper on its next call,
so herdr-app's spaces there come back without the person adding the machine again.

### The fence inside

The VM is the outer fence, and it is the strongest one the product has on any OS. The guest
sees its image, its volume and the exchange folder, and nothing else of Windows: not
`C:\Users`, not the credential stores, not the browser profiles. WSL distros run Windows `.exe`
files through interop; a WSLC container must not, and the spike checks that it cannot.

DSH's per-call fence (`workspace-write` through `dsh-base`, bwrap then Landlock on Linux,
RFC 0010's table) still runs inside, so one Bot's tool call cannot write another's files. bwrap
needs user namespaces, which an unprivileged container may not grant, and "Allow privileged WSL
containers" can refuse the privileged kind **[doc for the policy, unverified for bwrap]**.
Landlock needs no privilege, if WSL's kernel enables it **[unverified]**. The order is: bwrap
when the spike shows it works in an unprivileged container; else Landlock; else the per-call
fence is off, which Settings shows, and the VM is the only fence. The container is never made
privileged for bwrap's sake.

### Projects and `\\wsl.localhost`

D39 puts projects on the Linux disk, in `~/projects` on the volume, where git and pnpm are fast
(ext4 rather than 9P, which Microsoft calls slow for this **[doc]**,
[filesystems](https://learn.microsoft.com/en-us/windows/wsl/filesystems)). D39 also says they
are visible at `\\wsl.localhost`. That share lists WSL distros, and a WSLC session is not a
distro, so whether its volume shows there is **[unverified]** and may well be no. The spike
checks. If it is no, Q1 picks (a) or (b) from the spike's numbers.

### Uninstall

The NSIS uninstaller runs `automagik-wslc.exe uninstall`. Because projects live on the volume,
the first screen asks: **Keep my projects and Bots** (the default) or **Delete everything**.
Keep leaves the session's storage in place, so reinstalling finds it, and also writes a tarball
of `~/projects` and `~/.automagik` to `%USERPROFILE%\Automagik backup <date>.tar`. Delete
terminates the session and removes the app's storage folder
(`%LOCALAPPDATA%\Automagik\wslc`). WSL and Virtual Machine Platform stay: other programs may use
them, and removing them would need another UAC prompt.

## Contracts introduced

| Contract | Rule for existing installs |
|---|---|
| WSLC session name `automagik`, container `automagik`, guest user `automagik` (uid 1000) | New. Fixed once shipped: renaming orphans a person's data. |
| Storage folder `%LOCALAPPDATA%\Automagik\wslc` (the session's `storagePath`) | New. Uninstall's Delete removes it; nothing else does. |
| Volume at `/home/automagik`; `~/.automagik` and `~/.automagik/bots` inside it | The same public paths as macOS and Linux, inside the guest. Windows installs had native data until D38; it is not migrated; first run offers one copy of the Bots (Q8). |
| `/opt/automagik/bin/dsh-launch` and its framed stdio messages (`ready`, `ipc`, `tunnel`, `open`, `log`) | New, versioned by a `v` field; Electron refuses a launcher with an unknown major version. |
| Container port 41700 for DSH; the host port stays `dsh-port` | New container port; the host port's rule is RFC 0007's. |
| Release asset `automagik-linux-image-<v>.tar` and `.sha256`, desktop lane | New. An image is attached only when its inputs changed; the app pins the hash of the one it runs. RFC 0011 gets one line for it. |
| `%LOCALAPPDATA%\Automagik\exchange` (`downloads/`, `lane/`), mounted at `/mnt/automagik-exchange` | New. The only Windows folder in the guest. |
| hc machine name `linux` on Windows | New. Spaces recorded on it keep working across updates. |
| `automagik-wslc.exe` verbs: `status`, `install`, `start`, `exec`, `stop`, `uninstall` | Internal to the app; argv in, JSON out, stdio passed through for `exec`. |

## Threat model

The boundary is new: a VM between the agents and Windows.

- **Into the guest.** Electron, through the helper, can start processes there; that is the
  app's own trust. The mapped port is reachable by any Windows process of this user, so DSH's
  per-launch token stays the gate, as on macOS. The CDP tunnel carries the relay's per-Bot
  token, and the relay's own checks run on Windows. The exchange folder is the only Windows
  path the guest can write; nothing on Windows runs what lands there. A sign-in's reverse
  tunnel opens a Windows loopback port for at most 10 minutes; the CLI's OAuth `state` check
  is what refuses a callback from any other local process, as it does on macOS.
- **Out of the guest.** Agents can no longer read the Windows user's files, credentials or
  browser profiles. They can read everything on the volume, including the CLIs' logins and
  provider keys passed to DSH (D19, unchanged). Egress stays allow-all (D19). The `open` message
  can only open `https:` URLs in the default browser.
- **Guest files from Windows.** If the volume shows at `\\wsl.localhost`, every Windows process
  of this user can read and write it. That is the same reach they have over `%USERPROFILE%`,
  not more.
- **Policy.** The only elevated code is `install`, run once, through UAC. The app holds no
  service and no admin right after it. The UAC prompt shows the helper's publisher: unsigned
  (D36) it shows "Unknown publisher", so Windows builds are signed before delivery 6 (Q6).
- **Undo.** Uninstall's Delete removes the storage folder; WSL itself stays.

## Deliveries

Lanes per RFC 0011. Desktop items are 3.N. Each lists its check and its rollback.

1. **Spike** (no lane, throwaway; on a coworker's own Windows x86_64 PC, Decided "Spike
   venue"). Measure and answer, on Windows 11 (Q4):
   - WSLC on Windows 11, and on Windows 10 22H2 if one is at hand (Windows 10 is supported only
     if it passes): does `WslcGetMissingComponents` pass, and does a session start;
   - whether each WSLC session boots its own VM, apart from the user's WSL2 distro VM;
   - bwrap inside an unprivileged WSLC container; Landlock in WSL's kernel;
   - whether WSLC process stdio is byte-clean for `hc connect` (`hc machine add --via` against
     the container, then a terminal running `cat` of a binary file and a full-screen TUI);
   - idle RAM (session alone; session with DSH up and the Bot team drawn);
   - cold start (from no session to the launcher's `ready`; from a stopped container);
   - `pnpm install` and `git status` on a large repo, on the volume against a virtiofs folder;
   - and the ones this RFC adds: guest to Windows-host loopback under Consommé; whether the
     volume shows at `\\wsl.localhost`; whether a session outlives its creating process; and
     that interop cannot run a Windows `.exe` from the container;
   - Claude Code and Codex sign-in completes from inside the container, through the reverse
     tunnel and through each CLI's no-callback fallback;
   - whether `wsl --shutdown`, a WSL update, and sleep or hibernate end a running WSLC session.
   *Check:* a PR adding `docs/rfcs/0016-spike-findings.md`, with each number, how it was taken
   and the Windows build. *Rollback:* revert that PR.
2. **The image and the launcher** (desktop). The image build in CI and `dsh-launch`: the ipc
   relay, the CDP tunnel, `open`, stdin-EOF stop, the lane's unpack step. This half needs no
   Windows: it runs on GitHub's Linux runners, under Docker, with stdio driven by a test.
   *Check:* the image starts, `dsh-launch` prints `ready`, a scripted browser-endpoint request
   goes round trip, closing stdin stops DSH within 5 s, and a staged plugin is put in place.
   *Rollback:* revert; no shipped app reads the image yet.
3. **The Windows boundary** (desktop). `automagik-wslc.exe`; the WSLC implementation of RFC
   0010's boundary API (`start`, `stop`, `status`, `events`); the first-run and failure
   screens; the caps; the image's download and trial. Windows builds stay unpublished.
   *Check:* on a Windows runner, from a snapshot with no WSL: install, one UAC, restart,
   resume, the Bot team draws; from a snapshot with WSL 3.0.1: no prompt at all; each policy
   gate set by registry shows its screen. Until a self-hosted runner exists (the owner's call),
   the WSL 3.0.1 run is done by hand on the coworker's PC. The no-WSL run and the policy gates
   are not: they remove or turn off the WSL that PC's own distro needs. The owner says where
   they run.
   *Rollback:* revert; nothing was published.
4. **herdr on Windows** (desktop for the bridge `hc` and the Windows mod writer; herdr lane for
   the guest's updater limited to the CLI half and mods reading through the machine; the CLI
   half itself is written by `am`, RFC 0012 delivery 6).
   *Check:* the Code switch opens herdr-app on a space on machine `linux`; a terminal there
   prints `Linux` for `uname`; the sidebar lists the Bots from the guest.
   *Rollback:* revert the pack; herdr-app stays installed.
5. **Uninstall** (desktop). Keep, backup and Delete.
   *Check:* Keep then reinstall finds the projects; Delete leaves no `%LOCALAPPDATA%\Automagik`.
   *Rollback:* revert; the older uninstaller leaves the storage in place, which is safe.
6. **Windows ships again** (desktop). Reverses D38's `ci/windows-build-off`: the Windows NSIS
   build and the image asset are published, with "Windows x86_64 via WSLC" in the notes.
   *Check:* a release's Windows asset installs on a clean machine through delivery 3's check.
   *Rollback:* turn the Windows build off again; installed apps keep running on the last image.

### Where Windows CI and the spike run

GitHub's hosted Windows runners have no nested virtualization, so WSLC cannot start there.
Options:

- **A coworker's own Windows x86_64 PC.** No cost and real hardware, but by hand and not
  for CI. Best for the spike, since it measures the hardware people have. Not the owner's Mac: a
  Windows on ARM VM there would measure the wrong hardware.
- **A self-hosted Windows box** registered as a runner, with snapshot restore for the "no WSL"
  state. Real timings and a stable CI venue. Costs one machine, and its runner must never take
  jobs from forks.
- **Azure VMs with nested virtualization** (sizes that support it **[unverified: which series,
  check before buying]**). On demand and scriptable, with timings from a VM inside a VM, so
  RAM and cold-start numbers read high.

Decided (the owner, 2026-11-04, "Spike venue"): the spike runs on a coworker's own Windows x86_64
PC (the handoff, [0016-windows-handoff.md](0016-windows-handoff.md)). Recommended for CI: a
self-hosted box, with Azure as the spare. Not decided: the CI runner is the owner's call (its
cost and registration). Until it exists, the Windows checks run by hand on the coworker's PC,
except those that remove or turn off WSL (delivery 3's check).
The guest half (delivery 2) runs on hosted Linux runners and gates every PR.

## Amendments

### RFC 0010 (desktop sandbox)

- Layer 7 and Design's "Arca" bullet: "Windows is not planned" becomes "Windows runs every server
  in a WSLC guest (RFC 0016)". On Windows the guest is the boundary API's implementation, and
  the VM is the server fence that 0010's delivery 4 builds by hand on macOS and Linux.
- Open question 2 is answered for Windows: DSH runs on the image's own Node, not on Electron as
  Node. The four native Windows fixes are dropped (D38). Signing is decided for Windows:
  builds are signed before 0016's delivery 6 (0016's Q6).
- Delivery 1's parent-death watch and its handshake off `process.send` are done on Windows by
  the launcher's stdin EOF and framed stdio (0016's Design).

### RFC 0012 (am and parts)

- The Windows target is now **"Windows x86_64 via WSLC"**. On Windows, `am` and every part
  whose `os` is `linux` run in the guest, where `am` sees Linux. Only the desktop app, herdr-app
  and the pack's mod files live on Windows. `os` stays OS-only (D35).
- "Operating systems": `~/.automagik` is the guest's (`/home/automagik/.automagik`), not
  `%USERPROFILE%\.automagik`. There are no `.cmd` shims and no Windows PATH entry.
- Delivery 6 ("Windows port") becomes "Windows via WSLC": the guest runs `am install code`, and
  the desktop app installs herdr-app and the pack's mods on the Windows side and reports them
  into the guest's parts.json. The guest's `am doctor` cannot see Windows. For those parts it
  shows the desktop's last report, marked with when it came, as 0012 already does for a remote
  machine's entry. A report that says ok counts as ok. A missing report, or one that says not
  ok, fails that part, naming the desktop app as the fixer. *Check:* on delivery 3's Windows
  runner, `am install code` in
  the guest, then `am doctor` exits 0, Herdr opens with the pack, and its spaces are on
  `linux`. *Rollback:* revert; Windows goes back to "not applicable".
- am-quota's Keychain reads become the guest's Claude Code credentials file, read through the
  machine, not Windows' credential store (0016's Q9).

## Open questions

None left. The owner answered all nine on 2026-11-04, each as the draft recommended: Q1-Q9 in
Decided. The spike's numbers still pick between Q1's (a) and (b), and decide Q4's Windows 10.

## Tracking

Ledger pass (2026-11-10): the board links this RFC from its file.

- Open issues: none (all tracked work is merged).
- Merged changes: #288, #292, #330, #349, #791 (last merged 2026-11-09).

## Links

- Handoff for the Windows developer: [0016-windows-handoff.md](0016-windows-handoff.md).
- Handoffs: `~/.config/herdr-app/handoffs/bot-system-unification.md` (D19, D36-D39);
  `windows-linux-sandbox-research-2026-11-04.md` (the research and its sources).
- RFCs: [0007](0007-desktop-speed.md) stable port, [0010](0010-desktop-sandbox.md) sandbox,
  [0011](0011-monorepo-parts-and-releases.md) lanes, [0012](0012-am-cli-and-parts.md) parts,
  [0013](0013-work-code-switch.md) herdr-app control.
- Code read at `2362a716`: `apps/desktop/src/dsh.js` (`startDsh`, `dshEnv`, `writeTools`),
  `src/main.js` (`spawnDsh`, `answerDsh`), `src/bot-relay.js`, `src/lane.js`, `src/herdr.js`.
- Microsoft: [WSL container](https://learn.microsoft.com/en-us/windows/wsl/wsl-container),
  [container settings](https://learn.microsoft.com/en-us/windows/wsl/wsl-container-settings),
  [API reference](https://wsl.dev/api-reference/),
  [architecture](https://devblogs.microsoft.com/commandline/wslc-architecture-deep-dive/),
  [install](https://learn.microsoft.com/en-us/windows/wsl/install),
  [enterprise](https://learn.microsoft.com/en-us/windows/wsl/enterprise),
  [WSL.admx](https://github.com/microsoft/WSL/blob/master/intune/WSL.admx),
  [releases](https://github.com/microsoft/WSL/releases).

[ga]: https://blogs.windows.com/windowsdeveloper/2026/09/29/wsl-containers-now-generally-available/
[winlatest]: https://www.windowslatest.com/2026/07/09/windows-10-is-still-getting-windows-11-features-but-its-only-for-developers/
[wslc]: https://learn.microsoft.com/en-us/windows/wsl/wsl-container
[flags]: https://github.com/microsoft/WSL/blob/master/doc/docs/api-reference/c/enumerations/wslccomponentflags.md
[devhome]: https://github.com/microsoft/devhome/pull/3410
