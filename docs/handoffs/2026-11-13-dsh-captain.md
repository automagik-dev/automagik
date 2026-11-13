# DSH Captain handoff — 2026-11-13 ~14:20Z, before the ryzen reinstall

All work below is on GitHub; the box's local state dies with the disk.

## Merged today (nothing owed, all on dev)
- #1202 PR #1213 51fed5c8; #1083 PR #1221 6afcc8df (issue #1083 still open for its 24 h check)
- #1210 PR #1224 0f8748a4; #1223 PR #1233 8630de15
- #1238 dee15733; #1029 PR #1239 4164e7c9
- #1201 PR #1237 312057b0; #1252 5ea8b320
- #1223 fixture PR #1245 694fcc75 (closed #1223)
- #1201 rows PR #1255 cf6d151e; #1240 PR #1246 29dfbe7d3

## Open — pushed and safe
### PR #1256 — four-row #1223 low follow-up, tests only
- head 178e4ac453805d7d693b5589294cfe53c2cdf82d
- branch test/1223-hermes-fixture-notes (pushed, upstream set)
- worktree /mnt/ai/automagik/.claude/worktrees/test-1223-hermes-fixture-notes
- title test(bots-dsh): pin the Hermes SSH clock grants and per-script handoff
- one red check: Conventional commits (run 43430136409, 13:02Z) though the commit and title look conventional - inspect/rerun after restore
- next: orchestrator routes Reviewer + DSH Tester, then merge. Rows/M1-M4 and the body are in the PR.

## Open — nothing committed (must be redone after restore)
### Batch A+B+legacy (#1240 follow-ups)
- branch fix/1240-hold-followups, worktree .claude/worktrees/fix-1240-hold-followups, head 29dfbe7d3 (= dev tip then; no unique commits, not pushed)
- plan-first, never finished: (A) held-table test title still says every pill is held while plugins are staged though it is now every pill but the two labelled app pills; (B) a held pill keeps its live look so the solid "Update Bot team ... now" reads now while doing nothing - dim it or say why; (LEGACY) the hold rule skips the unsplit plugins-ready kind on apps v3.25 to v3.59, so that pill still reaches open and puts plugins in without asking - one line in src/client/update-hold.js for both About and the sidebar, plus a legacy-bridge row in test/about.test.js and test/desktop-update-progress.test.js.
- next: plan + one mutant per row to the orchestrator before edits.

### #1021 ACP drift — read-only cause
- branch investigate/1021-acp-drift, worktree .claude/worktrees/investigate-1021-acp-drift, head 896f5be5 (no commits), not pushed
- evidence: 13 macOS-only tests fail "Error: The Bot process could not be stopped." at src/host/acp.js:431 via src/host/cli-homes.js:317 (isolated stop/login/logout/switch/reset family for acp-claude and acp-codex, config refusal, one-image scratch session) against claude-agent-acp 0.106.0 and codex-acp 2.6.0, run 43431810989
- next: cause + plan to the orchestrator; macOS proof on CI only (drift workflow dispatch).

## Owed / recreate after restore
- #1083: close once 24 h of dev CI kept acp-dsh (Windows spawns) green. The 24 h background job was killed for the reinstall; the script and note were under .tmp (lost). At last check every dev CI run since 6afcc8df5 had Windows green.
- Follow-up queue (was .tmp/dsh/follow-ups.md): #1246-A stale test title; #1246-B held-pill live look; #1240 legacy state (above); #1021 cause/plan.
- Worker seats t2n8, t2nc, t2nd end with the box.

## Unsaved / at risk
- No uncommitted work in the three worktrees at handoff time (checked clean).
- The 24 h #1083 job and all .tmp notes are lost with the disk; this file and the pushed WIP branch are the durable copy.
