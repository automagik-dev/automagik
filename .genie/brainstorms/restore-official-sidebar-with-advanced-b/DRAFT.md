# DRAFT: restore-official-sidebar-with-advanced-b

## Status

Simmering — source-base adoption blocked before design crystallization or implementation.
This document freezes the owner's supplied scope, not a SHIP design. No design-review digest or saved workflow run ID exists.

## Owner decisions (verbatim, imported from the wish)

These answers are already decided; do not re-ask them. Their original question-card IDs were not supplied, so no ledger IDs are invented. The empty generated Settled ledger below means no answers have been applied through this new local ledger, not that these product decisions are open.

- Q 'What should Advanced Bot mode expose?' → 'Full native controls' (DSH available session/model/context controls alongside Bot UI; enabling doesn't automatically change permissions).
- Q 'How should the Advanced Bot switch be saved?' → 'Per Bot, off initially' (remember each Bot across sessions/restarts, ordinary DSH sessions retain native controls).
- Q 'How should Live appear inside the official sidebar?' → 'A Live view/tab' (switch Live/native views in ONE official pane, no duplicate rail; Browser/phone remain reachable).

## Frozen objective and boundaries

Restore the official DSH right sidebar in MAIN and other Bot chats. Replace the competing custom Details/Browser drawer and Live rail with integration into one official pane. Include a visible open/close toggle and programmatic opening through the verified official DSH API, never simulated clicks. Keep Live content/actions and Browser/phone/plugin extensions and ownership reachable.

Advanced changes UI visibility only: default false, durably persisted by stable Bot identity on the host, not port-scoped localStorage alone. No identity/auth/model-access/permission changes. Explicit native controls retain their genuine semantics and restrictions. Plain DSH sessions remain unchanged. Inventory the native session/model/context controls actually supported for Bot sessions before choosing exact integration contracts; unsupported full-native requirements require a precise new decision, not silent narrowing.

Preserve mobile/narrow layouts, pane width/collapse, keyboard/focus, traffic lights, header click/drag regions and browser-control routes. No generic dashboard redesign, unrelated upstream pulls, privacy/learning changes, DSH upgrade, localhost browser-security bypass, live setting/profile mutation, service restart, install, merge or release. Only authorized isolated disposable loopback fixtures may run. Runtime resources are read-only.

Delivery requires failing behavioral regressions before the fix, generated client rebuild, full relevant repository gates, isolated browser/native interaction evidence (not snapshots or screenshots alone), independent read-only design and implementation reviews distinct from authors, and bounded repairs (configured 2). Publication must be routed to Main because the enclosing wish-thread instructions prohibit push. A local SHIP is not PR delivery.

## Round 1 evidence and gap map

Clock supplied by owner: 2026-10-29, America/Sao_Paulo. Native fallback; no saved-run accounting available. Installed config reads returned repair budget 2 and council ceiling 1. No council convened.

WRS: **60/100** — Problem 20, Scope 20, Decisions 15, Risks 5, Criteria 0. The three original choices and requested outcomes are explicit; the newly discovered unsupported-compaction presentation decision remains open, and exact supported native control inventory and executable proof still need current-base investigation. This is not WRS 100 and must not crystallize into a SHIP design.

Size: M provisional, one initiative; estimate pending read-only scout, not an admitted implementation band. Scope is not reduced by this blocked attempt.

Settled: all three product choices above and frozen boundaries. Open: exact current-dev integration contracts, execution-base adoption, and the newly verified unsupported-compaction presentation decision below. Read-only current-dev scouting and design investigation remain possible here; only implementation on a clean current-dev base needs coordinator reprovisioning. Assumed: no authority to rewrite the assigned branch through reset/rebase/merge; native wish execution explicitly forbids those operations.

### Verified source-base blocker

Commands were run only in this assigned workspace. Initial tree was clean on `wish/restore-official-sidebar-with-advanced-b` at `04296879d06b2d1d58d48b59dd9d3ad99bdb0b0b`. GitHub authenticated `gh api repos/automagik-dev/automagik/branches/dev --jq .commit.sha` and HTTPS `git ls-remote` both returned current dev `fd9b42b1de3cb6f7dc5a397a6ebf2e3eeebf15ec`. `git fetch https://github.com/automagik-dev/automagik.git dev` succeeded without switching branches. `git rev-list --left-right --count HEAD...FETCH_HEAD` returned **8 294**.

The eight local-only commits are unrelated wake-log work: `0429687`, `9e0ad9b`, `26ad7b5`, `e6d87ef`, `c96eeb3`, `3d64062`, `8757dd8`, `d0119f6`. These must not enter a sidebar PR. The relevant bots tree differs from current dev by 179 files, 18,563 insertions and 6,268 deletions. Implementing on this stale source or restoring the whole current-dev tree into a new commit would not satisfy the scoped-current-dev requirement.

The native wish fallback's Work rules prohibit reset, rebase and merge. The enclosing user instructions prohibit touching another branch, push and merge. Therefore no current-dev implementation was admitted in this copy. Coordinator should provision a clean isolated current-dev copy/branch through its legitimate branch-creation route, preserve this record, then resume the full scope there; do not silently strip history or widen the diff.

### Duplicate and tooling findings

Authenticated read-only GitHub search found [issue #89](https://github.com/automagik-dev/automagik/issues/89), open: “Bot chat needs discoverable Details toggle and accessible pane focus.” Its existing acceptance covers visible labeling, open feedback, focus/Escape and narrow layouts. Reuse it for that defect rather than filing a duplicate. Its custom-pane approach is superseded by this owner's official-pane decision; broader Advanced/Live integration is not claimed resolved by that issue.

`command -v bun` produced no path in this shell. Attempting required root gate `bun run check` exited **127**, `bash: bun: command not found`; no checks actually executed and no install was attempted. `gh` and `genie` were available. Root required check is `bun run check` (`bun scripts/version.ts check && bun test scripts && bun scripts/marketplace.ts check`); Bot package additionally declares harness, test, lint, build and `check` scripts. Commands and exact current-dev dependencies must be re-frozen after clean-base admission.

## Newly verified native-control compatibility gap

Read-only scout identified a concrete restriction, independently confirmed against **current dev** with `git show fd9b42b1de3cb6f7dc5a397a6ebf2e3eeebf15ec:apps/bots-dsh/src/host/parts.js` (lines 277–321). The Bot compaction wrapper intentionally rejects native `compactNow` and `compactRegion` calls for Bot/group sessions. This is product semantics, not a security bypass or a missing sidebar registration. The comments explicitly reserve condensation to the Bot steward. File history's latest change is upstream DS Bot import `b77926a8ba5431f7ad96727f7b26089a226c3332`.

Consequently the approved “Full native controls” cannot be implemented as an unconditional promise that every native context action works in Bot sessions. Do not change those semantics under a UI-only toggle or expose a misleading active dead control. Precise new decision to resolve after clean-base continuation: **May native compaction controls remain visible but disabled with an explanation of Bot-managed context, while all supported native controls work normally?** Making those controls functional instead would require separate authorization to change Bot context-management semantics. This does not reopen the already decided Advanced persistence, initial-off choice, or Live tab UX.

Pinned current-dev harness is DSH `0.2.1-rc.4`, verified by `git show fd9b42b1de3cb6f7dc5a397a6ebf2e3eeebf15ec:apps/bots-dsh/dev/harness/package.json`. The stale assigned source is rc.3; do not mistake it for current API provenance.

## Next route

Independent read-only assessment of this blocker record, then coordinator source-base reprovisioning. Continue repository/API scouting, exact design, independent design review and verified stamp before implementation. Do not treat this DRAFT or a blocker assessment as design SHIP, wish APPROVED, gate success, or PR delivery.

## Settled

_Nothing settled yet._

## Asked

_No open questions._

## Size

_Not sized yet._

## Scope ratchet

_No IN items yet._

## Councils

_None convened._

## Ledger

```ledger
{
  "settled": [],
  "asked": [],
  "size": [],
  "scopeIn": [],
  "councils": [],
  "reviews": []
}
```
