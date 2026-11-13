# Handoff — #1021 ACP drift: 13 macOS-only stop failures

Saved 2026-11-13 for the ryzen shutdown. Investigation complete; **no source changes, no PR**.

- Worktree: `/mnt/ai/automagik/.claude/worktrees/investigate-1021-acp-drift`
- Branch: `investigate/1021-acp-drift`
- Base head before this handoff: `896f5be52759ee030ed6e0fb353ddb0d9db45ed5` (`chore(release): v3.139.4`)
- PR: none — read-only investigation; implementation was explicitly out of scope.
- Issue: https://github.com/automagik-si/automagik/issues/1021
- Failing run: https://github.com/automagik-si/automagik/actions/runs/43431810989 (macOS-15 job)

## Cause (proven)

`AgentRun.stop()` (`apps/acp-dsh/src/host/acp.js:422-437`) probes the process group with
`process.kill(-child.pid, 0)` and treats every errno except `ESRCH` as fatal (`acp.js:429-432`).
On Darwin, `kill(-pgid, 0)` returns `EPERM`, not `ESRCH`, while the group's members are zombies —
the state right after `dispose()` sends the group `SIGTERM` (`acp.js:409-418`) and before Node
reaps the leader. A working stop therefore throws `The Bot process could not be stopped.` at
`acp.js:431`, propagated by `releaseRun` (`src/host/cli-homes.js:313-317`) into account
sign-out/switch/reset, image cleanup and every stop. On Linux the same probe returns `0` while
the zombie remains, the loop sleeps 25 ms, Node reaps, and the next probe returns `ESRCH` — hence
macOS-only. The failing tests never launch an installed adapter: they run `node -e`, the fake
image agent, or `node /fake/adapter`; the same adapter versions pass on ubuntu in this run.

This path is new in #1073 (`6e9e1e3ca`, 2026-11-11). 11-13 is the first macOS suite run with it
and a working install: 11-11/11-12 died in `dev/install-adapters.mjs` (`install.js:62`,
`folderOf(undefined)`), fixed by #1148 (`0ca188002`). No adapter rollback is warranted:
claude-agent-acp 0.104.1 → 0.106.0 changes session-index/background-work modules, its bin entry
(signal forwarding + shutdown) is byte-identical; codex-acp is still 2.6.0 from the last record.

Darwin evidence: https://github.com/coleam00/Archon/issues/5309 (zombie-only group → EPERM;
reaped empty group → ESRCH) and https://git.lix.systems/puck/lix/commit/177f3996e28967368791ba0e4ec036f3dbbb88d0
("killing a process group will return EPERM if all processes in the group are zombies", `__APPLE__`).

## Plan (not implemented)

1. `apps/acp-dsh/src/host/acp.js` `stop()`: `ESRCH` = gone; `EPERM` = not proven gone, keep
   polling to the existing 5 s deadline; any other errno stays fatal. Never treat `EPERM` as
   success (it can also mean a live member this process may not signal). Mirror
   `LoginProcess.check()` (`src/host/login-process.js:20-33`) and `alive()`
   (`src/host/cli-generations.js:18-20`).
2. `apps/acp-dsh/test/cli-homes.test.js`: add a fake-child test (first group probe `EPERM`,
   next probe `ESRCH` after the child exits) and a negative test (group stays alive → deadline
   rejection, via a small `stopMs` spec seam). Keep
   `stopping isolated work waits for the real ACP process to exit` (`:232`) as the macOS
   acceptance test. The 13 failing tests are the acceptance list:
   `cli-homes.test.js:232`; `image-profile.test.js:35`; `image.test.js:52`;
   `isolated-accounts.test.js:165` (both ids), `:219`, `:236`, `:252`, `:266`, `:282`, `:315`,
   `:335`, `:348`.
3. macOS proof only on CI: add a `workflow_dispatch` input `adapters_only` (default false) to
   `.github/workflows/acp-drift.yml`, gate `drift`/`bump-check`/`bump-push` so the proof cannot
   comment on #1021 or push a bot branch, then dispatch on the fix branch
   (`gh workflow run acp-drift.yml --ref <branch> -f adapters_only=true`). Accept when both
   matrix jobs are green, the 13 tests pass on macOS, no `The Bot process could not be stopped.`
   appears, and both real-adapter `initialize` checks are present. Never local: the bug is Darwin
   kernel behaviour and local Node is below the app's `>=24.9` engine.
4. Recommended durable guard: an `acp-macos` job in `.github/workflows/ci.yml` (the plugin job is
   ubuntu-only today, `ci.yml:1238-1246`). Optional record move to 0.106.0/2.6.0 after the green
   run (`node scripts/acp-drift.mjs --record`).

## Unsaved / scratch

- No source edits and no uncommitted tracked files. `git status` was clean before this handoff.
- Only ignored `.tmp/` scratch (npm tarballs, run log, probe) — disposable, not work.
- No `.mut-scratch` copy exists in the worktree or workspace (checked), so nothing was removed.
- Earlier drift-run failures for context: 11-10 macOS real-Codex image test (one test,
  claude 0.104.1); 11-11/11-12 install-adapters crash (#1148). Only 11-13 is this stop bug.
