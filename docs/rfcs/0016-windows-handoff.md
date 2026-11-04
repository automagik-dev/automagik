# RFC 0016 handoff: the Windows half

You are finishing the Windows half of [RFC 0016](0016-windows-wslc.md). On Windows, Automagik
keeps two programs native: the Electron window and herdr-app. Everything else runs in Linux,
inside a WSL container (WSLC). Read the RFC first, whole. This page says what exists, what is
yours, in which order, and how to work with the team.

## What exists

- **The RFC.** Accepted by Felipe on 2026-11-04. Its open questions are answered (Q1-Q9 under
  "Decided"). Where this page and the RFC disagree, the RFC wins; tell us.
- **Delivery 2, the image and the launcher.** The DSH squad is building it, on GitHub's Linux
  runners, with no Windows. It makes the Linux image and `dsh-launch`, the guest launcher with
  its framed stdio (`ready`, `ipc`, `tunnel`, `open`, `log`). Ask the team for its PR; it is
  not merged yet.
- **Not started:** delivery 1 (the spike), 3 (the Windows boundary), 4 (herdr on Windows),
  5 (uninstall) and 6 (Windows ships). There is no `automagik-wslc.exe` yet, and no Windows
  runner.
- **Windows publishing is off** (D38). No Windows build reaches users until delivery 6.

## Your part, in order

Each delivery is one PR to `dev` (delivery 4 is two, one per lane). The check and the rollback
are the RFC's own ("Deliveries").

### 1. The spike (no lane; docs only)

Measure, on your Windows 11 PC, what the RFC marks **[unverified]**. Nothing is merged except
the findings note. Write each number and how you took it.

1. WSLC on this Windows: does `WslcGetMissingComponents` pass, and does a session start?
   Windows 10 22H2 too, if you have one; if not, say so (Q4 depends on it).
2. Does each WSLC session boot its own VM, apart from your WSL2 distro's VM?
3. Inside an unprivileged WSLC container: does bwrap work? Is Landlock in WSL's kernel?
4. Is WSLC process stdio byte-clean for `hc connect`? Run `hc machine add --via` against the
   container, then a terminal running `cat` of a binary file, then a full-screen TUI.
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

- Items 1-3, 7-11 and 13 run now, against any Debian slim image.
- Item 4 needs `hc` in the container. Ask the team for a Linux `hc` build.
- Item 12 needs Claude Code and Codex in the container, signed in with your own accounts.
- Items 5 and 6 need delivery 2's image and `dsh-launch`. If they are not ready, measure the
  session alone now, mark the rest "waits for delivery 2", and add them in a second commit.

*Check:* a PR adding `docs/rfcs/0016-spike-findings.md` (see "Report back").
*Rollback:* revert that PR.

### 3. The Windows boundary (desktop lane)

`automagik-wslc.exe` against the WSLC C API (Q2); the WSLC side of RFC 0010's boundary API
(`start`, `stop`, `status`, `events`); the first-run and failure screens; the caps (Q7); the
image's download (Q5) and its trial.

- *You need first:* the spike's findings merged; delivery 2's image (`.tar` and `.sha256`) and
  the launcher's framed protocol; a Windows test machine with snapshots ("no WSL" and "WSL
  3.0.1"). Agree the helper's language and build with the team before you write it.
- *Check:* on the Windows runner, from a snapshot with no WSL: install, one UAC, restart,
  resume, the Bot team draws. From a snapshot with WSL 3.0.1: no prompt at all. Each policy gate
  set by registry shows its screen.
- *Rollback:* revert; nothing was published.

### 4. herdr on Windows (herdr lane and desktop lane)

The pack's split install (herdr lane) and the bridge `hc` (desktop lane). A PR never mixes
lanes, so this is two PRs. The herdr one follows [herdr/AGENTS.md](../../herdr/AGENTS.md) and
runs its gate.

- *You need first:* delivery 3's helper (`automagik-wslc.exe exec`), which the `hc --via` link
  uses.
- *Check:* the Code switch opens herdr-app on a space on machine `linux`; a terminal there
  prints `Linux` for `uname`; the sidebar lists the Bots from the guest.
- *Rollback:* revert the pack; herdr-app stays installed.

### 5. Uninstall (desktop lane)

Keep, backup and Delete.

- *You need first:* delivery 3 (the storage folder and the session exist).
- *Check:* Keep then reinstall finds the projects; Delete leaves no `%LOCALAPPDATA%\Automagik`.
- *Rollback:* revert; the older uninstaller leaves the storage in place, which is safe.

### 6. Windows ships again (owner-gated)

Felipe decides when. It needs signed Windows builds (Q6), and signing is owner-held. You do not start
it. *Check:* a release's Windows asset installs on a clean machine through delivery 3's check.
*Rollback:* turn the Windows build off again; installed apps keep running on the last image.

## Setup

- **Windows 11, x86_64.** Not Windows on ARM: the spike measures the hardware people have.
- **WSL 3.0.1 or later.** Record `wsl --version` before and after any update.
- **Your WSL2 distro must keep working.** Before you start, record its state: `wsl -l -v`,
  `wsl --version`, and what runs in it. A WSL update and `wsl --shutdown` (item 13) stop
  running distros; save your work there first. If anything would change or remove that distro,
  stop and ask.
- **Repo tooling:** git with `core.autocrlf false` (CI checks out that way), Bun, and Node 22
  for the desktop tests (`npm ci` and `npm test` in `apps/desktop`, as `ci.yml`'s desktop job
  runs them).

## How to work with the team

- Branch from `dev`. One PR per delivery (two for delivery 4), to `dev`. Never to `main`.
- Commits are conventional: `type(scope): description`. Every line of the message, header and
  body, is at most 100 characters; CI fails the PR otherwise. Docs-only commits are
  `docs(rfcs): ...`.
- Each PR gets an independent review from the team. You never merge.
- A merge into `dev` releases to installed macOS and Linux apps. A desktop PR keeps them working
  as they are: Windows code stays off their path.
- Owner-held: signing keys, release publishing, Pocket's versionCodes, and every secret. Ask
  Felipe before anything that touches them.
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
- make a container privileged (the RFC never does, even for bwrap);
- change a contract in the RFC's "Contracts introduced" table, or a public path, id or route;
- run the herdr pack's tests, its installer or `herdr-app` against your live Herdr install (they
  use temp homes; [herdr/AGENTS.md](../../herdr/AGENTS.md));
- build on a finding that breaks the design: stdio not byte-clean, port mapping refused, no
  session past its creator. Report it first.
