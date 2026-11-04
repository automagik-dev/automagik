# RFC 0016 handoff: the Windows half

You are finishing the Windows half of [RFC 0016](0016-windows-wslc.md). On Windows, Automagik
keeps two programs native: the Electron window and herdr-app. Everything else runs in Linux,
inside a WSL container (WSLC). Read the RFC first, whole. This page says what exists, what is
yours, in which order, and how to work with the team.

## How to reach us

Ask questions as a comment on your own PR, or as an issue in
[automagik-dev/automagik](https://github.com/automagik-dev/automagik/issues), and mention Felipe
there (`@namastex888`). Send them to Felipe directly too. Wherever this page says "ask", it means
this.

## What exists

- **The RFC.** Accepted by Felipe on 2026-11-04. Its open questions are answered (Q1-Q9 under
  "Decided"). Where this page and the RFC disagree, the RFC wins; tell us.
- **Delivery 2, the image and the launcher.** The DSH squad is building it, on GitHub's Linux
  runners, with no Windows. It makes the Linux image and `dsh-launch`, the guest launcher with
  its framed stdio (`ready`, `ipc`, `tunnel`, `open`, `log`). It is not merged yet; ask for its
  PR.
- **`am`, not on `dev` yet.** Its first PR is open (#263, RFC 0012 delivery 1). Its Windows part
  is RFC 0012 delivery 6, which nobody is assigned to yet. Delivery 4 needs both.
- **Not started:** delivery 1 (the spike), 3 (the Windows boundary), 4 (herdr on Windows),
  5 (uninstall) and 6 (Windows ships). There is no `automagik-wslc.exe` yet.
- **No Windows CI runner.** Whether to have one, and where, is Felipe's call (see "Owner-held").
  Until one exists, Windows checks run by hand on your PC.
- **Windows publishing is off** (D38). No Windows build reaches users until delivery 6.

## Your part, in order

Felipe gave you the spike and the Windows deliveries (RFC, Decided, 2026-11-04): 1, 3, 4a and
5, in that order. 4b, on the herdr lane, is the team's; it is below so you know what 4a meets.
Each delivery is one PR to `dev`. The check and the rollback are the RFC's own ("Deliveries").

### 1. The spike (no lane; docs only)

It runs on your own Windows x86_64 PC (Felipe's answer, in the RFC's Decided). An ARM VM on the
Mac would measure the wrong hardware. Measure what the RFC marks **[unverified]**. Write each
number and how you took it.

**First step: a minimal WSLC client.** The RFC names no ready client for the spike. It names
the WSLC flat C API: NuGet `Microsoft.WSL.Containers` (`wslcsdk.dll`), documented in the
[API reference](https://wsl.dev/api-reference/). Write a small client against it that can:
check components (`WslcGetMissingComponents`); create a session with its CPU and memory; create
a named VHD volume (`WslcCreateSessionVhdVolume`); import an OCI image tarball
(`WslcImportSessionImageFromFile`); start a container; and run a process in it with piped stdio.
Call it `automagik-wslc.exe` with an `exec` verb, so the RFC's link works unchanged (item 4). It
is throwaway; delivery 3 builds the real one. The RFC also mentions a `wslc.exe` CLI, but not
its commands; if you use it for a step, say so in that row.

The RFC names three of the calls above. Find the session, container and process calls in the
API reference, and name each call you used in the findings note. Use any language that can call
a C API; the RFC does not pick one. The client's source goes in its own folder in the spike PR,
kept out of shipped paths until delivery 3: `docs/rfcs/0016-spike/`, since `scripts/lane.ts`
ships nothing under `docs/`. Not under `apps/`: a change there can cut a desktop release. Its
README says how to build it and run each step.

1. WSLC on this Windows: does `WslcGetMissingComponents` pass, and does a session start?
   Windows 11 is the target (Q4). If you also have a Windows 10 22H2 PC, run this item there
   too: Windows 10 is supported only if it passes. If you have none, say so.
2. Does each WSLC session boot its own VM, apart from your WSL2 distro's VM?
3. Inside an unprivileged WSLC container: does bwrap work? Is Landlock in WSL's kernel?
4. Is WSLC process stdio byte-clean for `hc connect`? Link the container with the RFC's line,
   `hc machine add --via "automagik-wslc.exe exec --" --name linux`. Your `exec` runs the given
   shell line in the container, passes bytes both ways untouched, and asks nothing. Then open a
   terminal there running `cat` of a binary file, then a full-screen TUI.
5. Idle RAM: the session alone; then with DSH up and the Bot team drawn.
6. Cold start: from no session to the launcher's `ready`; from a stopped container.
7. `pnpm install` and `git status` on a large repo: on the container volume, and on a virtiofs
   (Windows) folder. If item 9 is no, Q1 picks the projects' home from these numbers.
8. Guest to Windows-host loopback (127.0.0.1) under Consommé.
9. Does the container volume show at `\\wsl.localhost`?
10. Does a session outlive the process that created it?
11. Interop must not run a Windows `.exe` from the container: confirm it cannot.
12. Claude Code and Codex sign-in from inside the container: through a reverse tunnel, and
    through each CLI's no-callback fallback (paste-the-code, device code).
13. Do `wsl --shutdown`, a WSL update, and sleep or hibernate end a running WSLC session?

What each item needs:

- Items 1-3, 7-11 and 13 need only your client and a Debian slim OCI image tarball.
- Item 4 needs `hc` on Windows and `hc` in the container. Ask for both builds.
- Item 12 needs Claude Code and Codex in the container, signed in with your own accounts.
- Items 5 and 6 need delivery 2's image and `dsh-launch`. If they are not ready, measure the
  session alone now, mark the rest "waits for delivery 2", and add them in a second commit.

*Check:* a PR adding `docs/rfcs/0016-spike-findings.md` (see "Report back") and the client's
folder. *Rollback:* revert that PR.

### 3. The Windows boundary (desktop lane)

`automagik-wslc.exe` against the WSLC C API (Q2); the WSLC side of RFC 0010's boundary API
(`start`, `stop`, `status`, `events`); the first-run and failure screens; the caps (Q7); the
image's download (Q5) and its trial.

- *You need first:* the spike's findings merged; delivery 2's image (`.tar` and `.sha256`) and
  the launcher's framed protocol. Agree the helper's language and build before you write it.
- *Check:* from a machine with no WSL: install, one UAC, restart, resume, the Bot team draws.
  From a machine with WSL 3.0.1: no prompt at all. Each policy gate set by registry shows its
  screen.
- *Where the check runs:* until a self-hosted Windows runner exists, the WSL 3.0.1 run is by
  hand on your PC; write in the PR what you ran and what you saw. The no-WSL run and the policy
  gates are not for your PC: they remove or turn off the WSL your distro needs. Felipe says
  where they run (the RFC says the same).
- *Rollback:* revert; nothing was published.

### 4a. herdr on Windows, the desktop half (desktop lane)

The RFC's Design ("The pack splits") has three writers. On Windows, the **desktop app** is the
only writer of the pack's mods: Windows has no `sh` for `install.sh`. In the guest, **`am`** is
the only writer of the pack's CLI half (its CLI, hooks and `run.sh`). The pack's updater in the
guest updates only that half. A PR never mixes lanes, so delivery 4 is two PRs; 4a is yours.

4a is the bridge `hc` on Windows (Q3), with `linux` as its default machine and no terminals;
and the desktop app's mod writer. The writer reads the `herdr-lane` pointer, checks it against
`herdr/mods/am-sidebar/pack-keys.json` and the tarball against its sha256, as `install.sh`
does, and never downgrades.

- *You need first:* delivery 3's helper (`automagik-wslc.exe exec`), which the `hc --via` link
  uses; 4b merged; and for the guest's CLI half, `am` on `dev` (#263) and RFC 0012 delivery 6
  (the guest runs `am install code`).
- *Not in 4a:* the desktop app's report of the mods into the guest's `parts.json`. That is RFC
  0012 delivery 6, with no owner yet; ask before you take it. Until it lands, the guest's
  `am doctor` fails those parts and names the desktop app, as RFC 0012 says for a missing
  report.
- *Check:* the Code switch opens herdr-app on a space on machine `linux`; a terminal there
  prints `Linux` for `uname`; the sidebar lists the Bots from the guest. For 4a alone: the app
  refuses a pointer that fails `pack-keys.json`, a tarball that fails its sha256, and a lower
  version.
- *Rollback:* revert; herdr-app stays installed.

### 4b. herdr on Windows, the guest half (herdr lane; the team's)

The pack's updater, in the guest, updates only the CLI half; mods that read local files read
them through the machine. It follows [herdr/AGENTS.md](../../herdr/AGENTS.md) and runs its
gate.

- *Guest signal:* the RFC names none. One candidate is the image's launcher,
  `/opt/automagik/bin/dsh-launch`, a contract path the image puts in the guest. The 4b PR
  proposes a signal, shows macOS and Linux installs never have it, and the review settles it.
- *Check:* with the signal set (a temp home in the pack's tests), the updater leaves the mods
  alone and updates the CLI half. Without it, the pack's tests pass unchanged: macOS and Linux
  see no change.
- *Rollback:* revert the pack.

### 5. Uninstall (desktop lane)

Keep, backup and Delete.

- *You need first:* delivery 3 (the storage folder and the session exist).
- *Check:* Keep then reinstall finds the projects; Delete leaves no `%LOCALAPPDATA%\Automagik`.
  It runs by hand on your PC, as delivery 3's does.
- *Rollback:* revert; the older uninstaller leaves the storage in place, which is safe.

### 6. Windows ships again (owner-gated)

Felipe decides when. It needs signed Windows builds (Q6), and signing is owner-held. You do
not start it. *Check:* a release's Windows asset installs on a clean machine through delivery
3's check. *Rollback:* turn the Windows build off again; installed apps keep running on the
last image.

## Setup

- **Windows 11, x86_64.** Not Windows on ARM: the spike measures the hardware people have.
- **WSL 3.0.1 or later.** Record `wsl --version` before and after any update.
- **Your WSL2 distro must keep working.** Before you start, record its state: `wsl -l -v`,
  `wsl --version`, and what runs in it. A WSL update and `wsl --shutdown` (item 13) stop
  running distros; save your work there first. If anything would change or remove that distro,
  stop and ask.
- **Repo tooling:** git with `core.autocrlf false` (CI checks out that way); Bun 1.4.4, the
  version CI pins; Node 22 for the desktop tests (`npm ci` and `npm test` in `apps/desktop`, as
  `ci.yml`'s desktop job runs them).
- **The herdr gate** ([herdr/AGENTS.md](../../herdr/AGENTS.md)) uses `sh` and `shellcheck`, and
  its tests need Node 22.15 or later, or 24. Run it in a Linux shell, such as your WSL2 distro.
  Its tests use temp homes; never point them, the installer or `herdr-app` at your live Herdr.

## How to work with the team

- Branch from `dev`. One PR per delivery (two for delivery 4), to `dev`. Never to `main`.
- Commits are conventional: `type(scope): description`. Every line of the message, header and
  body, is at most 100 characters; CI fails the PR otherwise. Docs-only commits are
  `docs(rfcs): ...`.
- Each PR gets an independent review from the team. You never merge.
- A merge into `dev` releases to installed macOS and Linux apps. A desktop PR keeps them working
  as they are: Windows code stays off their path.
- **Owner-held** (Felipe's; ask Felipe before anything that touches them): signing keys, release
  publishing, Pocket's versionCodes, every secret, and the Windows CI runner (whether to have
  one, its cost, and its registration; not decided).
- Nothing is published to npm.
- One version for everything, set by `bun scripts/version.ts` at release. Never edit a version
  by hand.
- The rules for the whole repository are in [AGENTS.md](../../AGENTS.md); lanes and releases in
  [RFC 0011](0011-monorepo-parts-and-releases.md).

## Report back

The spike's output is a PR adding `docs/rfcs/0016-spike-findings.md`. Put first: Windows edition
and build (`winver`), CPU, RAM, disk type, `wsl --version`. Then one table row per item (1-13):
result, number, how measured, Windows build. End with anything that surprised you.

A good number has a value with its unit, how it was measured (the command, how many runs, and
whether it is a median), and the Windows build. For example: "Cold start to `ready`: 4.2 s,
median of 5 runs, timed from `start` to the first `ready` line, Windows 11 26100.2314". A yes or
no gets the command and its output. Share no keys, tokens or account names.

## Stop and ask

Stop and ask Felipe before you:

- change or remove your existing WSL2 distro, or do anything that might;
- make an admin policy or registry change you are unsure about, on your own PC;
- touch signing, secrets, release publishing, versionCodes or the Windows build switch;
- set up, register or pay for a Windows CI runner;
- make a container privileged (the RFC never does, even for bwrap);
- change a contract in the RFC's "Contracts introduced" table, or a public path, id or route;
- run the herdr pack's tests, its installer or `herdr-app` against your live Herdr install (they
  use temp homes; [herdr/AGENTS.md](../../herdr/AGENTS.md));
- build on a finding that breaks the design: stdio not byte-clean, port mapping refused, no
  session past its creator. Report it first.
