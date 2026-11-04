# RFC 0010: Desktop sandbox and supervision

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | not scheduled |
| Lanes | desktop (3.N); plugin (3.N.P) for the secrets broker; Omni upstream |
| Created | 2026-11-03 |

## Summary

The desktop wrapper (D12, D13) has to run DSH, Omni and later Herdr's code mode inside "a clean,
safe sandbox". This RFC compares what Unfold 0.5, Omni's `sandbox run --embedded` and our
Electron app do today, layer by layer. It names the gaps all three share and proposes six
deliveries. Each delivery is small and can be reverted, and none of them waits for Arca.
Felipe's answers (D19) are under Decided. They defer secret swapping and egress control to a
later phase.

## Motivation

Felipe says Unfold's approach is "still missing something". Unfold's shipped layer is a
well-built supervisor, but it is not a sandbox. Six things are missing:

- **Parent-death.** No PDEATHSIG or kqueue watch, so a SIGKILLed Unfold leaves DSH and Omni
  running until the next switch-on (`dsh_child.rs:995`).
- **The environment is filtered by a denylist.** The base is the app's whole environment
  (`dsh_child.rs:1038`), minus a few rows (`:255-256`).
- **HOME is the person's real home** on purpose (`dsh_child.rs:122`).
- **No fence around the servers.** The only Seatbelt profile is the speech sidecar's
  (`S/nemo.rs:28`); the DSH fence is a bench rehearsal (`bench/unfold-own-dsh-g6/fence.sh`).
- **No egress control** in the shipped path.
- **The codesign check passes no `-R` requirement**, and the per-start manifest "guards against
  accidents, not against this user" (`dsh_pack.rs:28-31`).

Our app has the same gaps, plus some of its own (table below). Omni's sandbox is the same shape:
a supervisor around plain child processes.

## Layer model

Seven layers. Each one is a policy the wrapper owns, enforced wherever the boundary lives: host
processes today, an Arca guest later.

1. **Supervision.** Spawn, environment, readiness, crash policy, orphan and parent-death cleanup.
2. **Filesystem and homes.** Instance homes, what agents may read and write, and the public
   `~/.automagik/bots` contract (AGENTS.md).
3. **Network.** What servers bind to, and where agent processes may connect.
4. **Secrets.** Where provider keys, the Omni key and Bot secrets live, and which processes can
   read them.
5. **GUI and web exposure.** The window, Bot browser views, local endpoints, and their tokens.
6. **Updates and integrity.** What is pinned and verified, when, and how it rolls back.
7. **Cross-OS path to Arca.** The same policy table expressed as guest configuration.

## What each does today

Unfold paths are under `~/workspace/repos/rth` (not a git repo, read 2026-11-03).
`S=scratchpad/dmg-step2/app-05-trial-6/src-tauri/src`. Omni paths are at `origin/dev`
`0c388fae3`. Automagik paths are at `origin/dev` `87b8cad`, under `apps/desktop/` unless noted.
DSH package READMEs are the 0.2.1-rc.3 copies under `apps/bots-dsh/dev/harness/node_modules`;
the desktop pins rc.5 (`runtime/package-lock.json:1115,1139`).

| Layer | Unfold 0.5 (shipped) | Omni `sandbox run --embedded` | Automagik desktop |
|---|---|---|---|
| Supervision | `env_clear` over a denylist of the app env (`S/dsh_child.rs:255-256,1038`); closed-bin PATH shims (`:190-248`); process group, SIGTERM then SIGKILL (`S/tray.rs:305,325-367`); backoff 1-16 s, gives up after the 6th crash (`dsh_child.rs:337-345`); orphans matched by PID and start time (`:440-470`); no parent-death watch | Allowlist env of 9 vars (`packages/cli/src/sandbox.ts:258-260`); pg, then nats, then api, ready on a TCP connect (`sandbox-supervisor.ts:146-153,203-209`); backoff, stops after 5 fast crashes (`:268-275`); orphans swept with `ps` (`sandbox.ts:1013-1070`); SIGTERM and SIGINT only (`sandbox-supervisor.ts:170-173`) | Full `process.env` spread into DSH's env (`src/dsh.js:573`), on Electron as Node (`:593`); SIGTERM then SIGKILL on quit (`src/dsh.js:647-655`, `src/main.js:661-671`); no restart policy; no parent-death watch in `src/dsh.js` |
| Filesystem and homes | Per-instance homes, 0700 (`dsh_child.rs:523-529`); HOME shared (`:122`); no server fence | One home per sandbox, 0700 (`sandbox.ts:129-151,876`); no fence | `~/.automagik/desktop/{dsh,bots,bin}` (`src/dsh.js:5-13`). DSH's per-call fence is mounted through `dsh-base` (`profile/package.json:22`; dsh-base `cordis.patch.yml:240-247`): Seatbelt, or bwrap/Landlock on Linux, mode `workspace-write`. It governs writes only, reads stay open (sandbox-local README:79) |
| Network | DSH link on 127.0.0.1 (`dsh_child.rs:316`); port band 41700-41799 under `flock` (`S/dsh_ports.rs:1-9,69`); no egress control | API and NATS on 127.0.0.1 (`sandbox.ts:385,400`); NATS without auth (`packages/cli/src/nats-server-args.ts:92-93`); Postgres `postgres:postgres` by default (`sandbox.ts:250`); egress "owned by the app" (`docs/cli/sandbox.md:138`) | DSH on `--host 127.0.0.1`, port kept across launches (`src/dsh.js:450-452,608`); the policy has no network vocabulary (sandbox-policy README:147); no egress control |
| Secrets | DeepSeek key from the Keychain into DSH's env (`dsh_child.rs:159,1447-1448`), inherited by tools unless DSH scrubs it (not verified); Omni key written to `bots/omni.json` (`S/omni_child.rs:250`); channel vars stripped by the preload (`dsh_child.rs:482`) | API key in `config.json` 0600, passed as env `OMNI_API_KEY` (`sandbox.ts:236-242,406`) | Keys in a 0600 credentials file that "cannot isolate secrets from the agent" (credentials-local README:12,32); Bot secrets in `secrets.json` 0600, given to shells as `$DSH_SECRET_*` and masked toward models (`apps/bots-dsh/src/host/secrets.js:1-4`); shell env keys pass through (`src/dsh.js:573`) |
| GUI and web exposure | Control socket 0600 in a checked 0700 dir, peer PID and start time checked, token file read once (`S/dsh_control.rs:4-14`, `S/dsh_sockdir.rs:20-48`) | Loopback API, key-gated; NATS and Postgres reachable by any local process (`sandbox.ts:250,385,400`) | Context isolation and renderer sandbox (`src/main.js:277-278`); permissions only for DSH's origin, audio only (`:643-651`); `window.open` denied (`:569-570`); per-Bot partitions and request filter (`src/bot-views.js:24,47-50`); per-Bot CDP token on loopback (`src/bot-relay.js:63-73`) |
| Updates and integrity | Pack sha256 pinned at build, codesign without `-R`, manifest checked at every start (`dsh_pack.rs:28-31,186,214,223`) | autopg and nats-server sha256-pinned (`sandbox.ts:1308-1313`, `packages/cli/src/nats-install.ts:54-57`); runtime from `bun install --production` (`sandbox.ts:907-938`) | electron-updater sha512, plus Squirrel's signature match on macOS (`src/update.js:4-6`); signed plugin lane with ed25519, tarball sha256/sha512 and a trial start that rolls back (`src/lane.js:1-10,64-70,132`) |
| Path to Arca | Owner ruled DSH "not in a VM" (`council/rfc/0008-dsh.md:74`); the microVM (microsandbox/libkrun) denies egress and header-swaps a key, web placement only (`crates/rth-deploy/src/controller.rs:799-815`); verdict "later" (`council/31-dsh-in-guest.md:232`) | none | none; Arca is not in the repo |

## What is missing across all three

In order of how much each one matters. The first two compound: together they make a
prompt-injected Bot an exfiltration path today in all three products.

1. **Secrets are readable by agents.** Every key that DSH, Omni or the Bots use is a file or an
   environment variable owned by the same OS user as the agent's shell. DSH's own README says so
   (credentials-local README:12). Masking toward models (`secrets.js:1-4`) stops a key from
   reaching a model's input. It does not stop a tool call from sending the key somewhere.
2. **No egress control in any shipped path.** The only egress deny anywhere is rth's microVM,
   and only with a web placement (`controller.rs:806-815`). DSH's policy covers file effects
   only (sandbox-policy README:147).
3. **The servers themselves are unfenced, and the local services are unauthenticated.** DSH's
   per-call fence covers tool commands, not the DSH and Omni server processes, and it confines
   writes, not reads. An Omni next to the agents exposes NATS with no auth and Postgres with a
   fixed login on loopback, and Omni's own docs list the scoped role as not done
   (`docs/cli/sandbox.md:201-212`). The supervisor gaps belong here as well: environment
   passthrough (Unfold, Automagik) and no parent-death watch (all three).
4. **No per-Bot isolation.** Bots share one OS user, one DSH process and one egress. DSH's
   per-session mode and workspace (sandbox-policy README:54) and the per-Bot secret scope
   (`secrets.js` `canUse`) are the only per-Bot boundaries.
5. **No Linux fence around the servers.** The *per-call* fence on Linux does exist (bwrap, then
   Landlock; sandbox-local README:71-75). What is missing is a server fence on any OS. Unfold's
   fence is macOS-only and was never run. Its notes warn that `localhost:*` in Seatbelt means
   every address of the Mac, not loopback only (`bench/unfold-own-dsh-g6/README.md:36`).
6. **Code mode sits outside every boundary.** herdr-app is a third-party cask whose mods can
   exec, and its agents run on the host with the person's full credentials. The council already
   resolved this: launch-and-focus over the herdr-app CLI or socket, the cask pinned, and the
   code mode documented as outside the boundary. This RFC records that as a decision, not a
   delivery.

The council also listed the Electron fuse and entitlement hardening item. It is tracked there
by title (council-desktop-shell-2026-11-02, security conditions) and not repeated here.

## Design

**One boundary API.** The wrapper only ever talks to a boundary: `start(instance, policy)`,
`stop`, `status`, `events`. A host supervisor implements it today, and an Arca guest implements
it later. The policy is one table per instance: homes, read denies, write roots, egress
allowlist (per Bot), secrets by reference, and port band. The shell choice (Electron or Tauri)
does not change this table.

- **Supervision.** The environment is an allowlist, as in Omni (`sandbox.ts:260`), never a spread.
  Restarts back off with a crash-loop stop and a Retry, as in Unfold. A parent-death watch
  stops DSH and Omni when the wrapper dies. Endpoints are handed out over an authenticated 0600
  Unix socket, as in Unfold's control socket, which replaces the `process.send` handshake the
  council flagged.
- **Filesystem.** HOME stays the person's home, so agents keep working on their files. The
  server fence denies reads of credential stores, other Automagik and Omni homes, `~/.ssh` and
  browser profiles. Writes are limited to the instance home, the session workspaces and temp
  folders.
- **Network.** Servers bind 127.0.0.1 only. Agent tool processes reach the network only
  through a loopback egress proxy that the supervisor runs. The proxy logs every host per Bot
  and, once switched to deny, enforces per-Bot allowlists. Later phase (D19): outbound is
  allow-all for now.
- **Secrets.** Later phase (D19): for now provider keys pass through the environment, and
  agents can read them. The design for that phase: a broker in the DSH server holds provider keys and Bot secrets. Tool processes
  get placeholders, and the proxy swaps in the real value only for the allowed host, the
  pattern rth's microVM already uses (`controller.rs:799-801`). Credential files move out of
  the agent's readable set through the fence's read denies. `bots/omni.json` keeps its path and
  format (a public contract). What changes is the key it holds: a scoped one, not the primary.
- **GUI.** No change. The Electron guards in the table are the bar any shell must meet.
- **Arca.** The same policy table, expressed as guest configuration. Arca today is an alpha
  Incus kernel for Linux hosts, not an app sandbox (handoff, 2026-11-03 Arca answer). Its plan:
  a Mac joins as a compute node through an Apple `container` Linux guest, Linux runs Incus, and
  Windows is not planned. A guest gives egress deny and secret swap for free, but costs about
  9-10 s of boot against 3 s (`council/31-dsh-in-guest.md:232-261`) and needs a mount contract
  for `~/.automagik/bots`.
- **Windows** (amended by [0016](0016-windows-wslc.md), D38 and D39). Windows has no host
  supervisor: every server runs in a WSL container guest, which implements the boundary API
  there, and the VM is the server fence that delivery 4 builds by hand on macOS and Linux.
  Only the Electron window and herdr-app run natively. The parent-death watch and the handshake
  off `process.send` (delivery 1) come on Windows from 0016's guest launcher (stdin EOF, framed
  stdio).

## Deliveries

One PR per lane, each with its check and rollback. Where two lanes are named, the plugin half
lands first and stays compatible with the older app.

1. **Supervisor hygiene** (desktop). An environment allowlist for DSH, with known provider
   variables carried by name; a parent-death watch; a restart backoff. The endpoint handshake
   over a 0600 socket touches the Bot team's browser bridge too, so it is its own two-lane item
   (plugin first).
   *Check:* a test asserts the exact key set; an integration test SIGKILLs the parent and sees
   DSH exit within 5 s; a crash-loop test.
   *Rollback:* revert. The allowlist is a single constant.
2. **Secrets broker** (plugin, then desktop). Later phase (D19). Provider keys resolved in the server, tool
   processes scrubbed of them, and Bot secrets as placeholders. The Omni link holds a scoped
   key. Omni already narrows scopes per device client (`packages/api/src/login/config.ts:72-100`).
   *Check:* `env` in a Bot shell shows no real key, and a provider call still succeeds. The
   credential file stays readable until delivery 4's read denies.
   *Rollback:* a setting returns to direct env injection.
3. **Egress, observe mode** (desktop). A loopback proxy, with `HTTP(S)_PROXY` set for tool
   processes, logging each host per Bot. On Linux, DSH's `runnerCommand` override (a
   bwrap-compatible runner, sandbox-local README:45) can add the network rule without forking
   DSH; on macOS the rule comes with delivery 4.
   It blocks nothing, so it fits D19's allow-all.
   *Check:* the log lists provider and fetch hosts for a scripted session, and nothing is blocked.
   *Rollback:* unset the proxy.
4. **Server fence, macOS and Linux** (desktop). DSH and Omni under Seatbelt, or bwrap and
   Landlock, with the read denies and write roots above. Explicit `127.0.0.1` rules, never
   `localhost:*`. Outbound stays open for now (D19). In the later phase, direct outbound is
   denied except to the proxy's loopback port, since `HTTP(S)_PROXY` alone is advisory. Fail
   closed, with a visible setting to turn it off.
   *Check:* denial tests for each denied path (the credential file included), a bind on the LAN
   IP refused, and every Bot tool suite green with the fence on. In the later phase, a direct
   connect to an outside host from a tool shell is refused.
   *Rollback:* the setting, then revert.
5. **Egress deny and per-Bot policy** (desktop and plugin). Later phase (D19). The proxy switches to allowlists
   built from the observe logs, plus a per-Bot workspace root and mode on DSH's session
   policy. The "Ask" flow from `folders.js:148-170` extends to new hosts.
   *Check:* an unlisted host is refused with a clear message and allowed after approval.
   *Rollback:* flip back to observe.
6. **Arca guest spike** (no lane, throwaway). Run the boundary API against an Apple `container`
   guest and an Incus container. Measure boot, RSS and file-watch on the bots mount, against
   council/31's gates (a)-(e) (`:263-270`).
   *Check:* a findings note.
   *Rollback:* delete.

Omni upstream asks, in Omni's repo, needed before the desktop runs a local Omni: NATS auth, the
scoped Postgres role, a machine-readable readiness line, and a parent-death watch (Omni's own
DESIGN.md already lists the first two).

## Decided

Felipe answered these on 2026-11-03 (D19).

1. **Shell-env API keys.** They keep passing through to DSH's environment, as today. Agents
   can read them. Header-swapped secrets (the broker in Design and delivery 2) are deferred to
   a later phase. The read fence still denies the credential file, but the keys stay readable
   through the environment.
2. **Egress.** Outbound traffic is allow-all for now. Egress control is a later phase: the
   proxy allowlists, the fence's outbound deny (delivery 4) and delivery 5. Delivery 3 only
   observes, so it can ship before then.
3. **Server read fence.** The fence around the DSH and Omni servers is a denylist of sensitive
   paths. Agents need the person's files; an allowlist breaks too much work.

Until the later phase, the first two gaps under "What is missing" stay open. A prompt-injected
Bot can read a key and send it out. D19 accepts this for now.

## Open questions

1. **Omni hardening: upstream or wrapped by us?** Recommended: upstream. Omni's design already
   names it, and wrapping would fork its lifecycle.
2. **A separate Node for DSH (drops RunAsNode) now, or with a shell move?** Still open after
   D19. The cross-OS spike (#191) keeps Electron on macOS, Linux and Windows. Windows needs four
   fixes: `npm.cmd` run through a shell, a code-signing certificate, a Windows build and its
   update feed, and the `#!/bin/sh` tool shims in `src/dsh.js`. Recommended: now. The fence and
   the fuses both want DSH to be its own binary, and both shells need the same Node ≥ 22.19.
   *Answered for Windows* by [0016](0016-windows-wslc.md): DSH runs on the guest image's own
   Node, and the four native Windows fixes are dropped (D38); signing stays open (D36).
3. **Per-Bot OS processes or policy-only?** Recommended: policy-only (deliveries 4 and 5)
   until a measured need appears. One process per Bot multiplies RSS.
4. **Apple `container` floor.** Apple's README asks for Apple silicon and macOS 26 (not verified
   here). The app sets no floor below Electron's. Recommended: keep the host supervisor as the
   default and offer the guest only where it runs.
5. **Unfold.** Recommended: Unfold consumes the same boundary API, so one supervisor serves
   both products.

## Links

- Handoff: `~/.config/herdr-app/handoffs/bot-system-unification.md` (D12, D13, D18, Arca and
  Unfold notes, 2026-11-03); council: `council-desktop-shell-2026-11-02.md` (synthesis).
- [0006](0006-herdr-terminal-mode.md) Herdr terminal mode, [0007](0007-desktop-speed.md)
  desktop speed, [0008](0008-platform-and-web-instances.md) platforms,
  [0016](0016-windows-wslc.md) Windows on a Linux sandbox (amends this RFC).
- Decisions: D19 (2026-11-03) in the handoff above. Cross-OS spike: #191.
- Omni `origin/dev` `0c388fae3`: `docs/cli/sandbox.md`, `.genie/brainstorms/omni-local-daemon/DESIGN.md`.
