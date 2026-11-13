# Handoff — #1223 Hermes SSH fixture clocks (PR #1256)

Written 2026-11-13T14:08Z, host reinstall stop.

## State

- Worktree: `/mnt/ai/automagik/.claude/worktrees/test-1223-hermes-fixture-notes`
- Branch: `test/1223-hermes-fixture-notes`
- Commit / PR head: `178e4ac453805d7d693b5589294cfe53c2cdf82d`
- PR: [#1256](https://github.com/automagik-si/automagik/pull/1256), OPEN, base `dev`, refs #1223 (no closing keyword; issue already closed)
- Diff: one file, `apps/bots-dsh/test/hermes-ssh.test.js`, +72/−11; no product code.
- Uncommitted work: none. Branch and PR head are pushed and equal to origin.
- There is no `.mut-scratch` copy left; M1–M4 were removed by literal path and the empty parent was removed.

## What shipped

Four pinning rows in the tests-only follow-up to #1245:

1. Never-ready drops its own `cancel: 800`; the fixture's 2000 ms stop window applies and the handoff is asserted through its own spawn wrapper.
2. Force-stop and the three group-cleanup cases keep their 1000 ms local stop and pin the fixture's 300 ms script grant inside the 800 ms wait.
3. Bad-port half restores its pre-#1245 10000/5000 start/control windows while the fixture keeps the 2000 ms stop window / 300 ms script cancel.
4. Handoff is per start script (`handed()` last, `handoffs()` count), with a new second-open test; PR body explains why this is right and that every old once-per-fixture test passes for the right reason.

## Evidence

- `test/hermes-ssh.test.js`: 40 tests, 40 pass, 0 fail.
- Full gate from `apps/bots-dsh`, Node v22.19.0: 3414 tests, 3301 pass, 0 fail, 113 skipped, complete plan.
- `node scripts/lint.mjs`: 39 warnings, 0 errors.
- M1 red: never-ready, `the stop window is the fixture's long one...`, `800 !== 2000`.
- M2 red: force-stop, `the script's clock ends inside the wait this computer keeps`, `300 < 240` false.
- M3 red: never-ready, `the start script keeps a start clock wider than the fixture default (4250 ms)`.
- M4 red: second-open test, actual `[300, 2000]` vs `[300, 300]`.
- Scratch mutants ran one at a time, single file, `nice -n 10`, 4 GiB `prlimit --as`, no gate lock.

## Next step / owners

- Integrator owns CI on PR #1256; do not rerun CI manually.
- Reviewer: review the new head; the earlier #1245 verdict does not cover this follow-up.
- Merge only after review and green CI; never merge here, never push main, no force-push.
- No local work is needed. If the worktree is lost in the reinstall, both the PR branch and this handoff branch are on origin.

## Risks

- Gate dependencies were linked from an existing scratch because `bun install` is blocked by the read-only mount (pinned dsh 0.2.2-rc.2, oxlint 1.76.0, jsdom 29.1.1, esbuild 0.28.2); links were removed after the gate.
- 4 GiB cap used `prlimit --as=4294967296` because `systemd-run --user` is unavailable.
