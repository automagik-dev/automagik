# Design: Official sidebar and Advanced Bot context/statistics

| Field | Value |
|-------|-------|
| **Slug** | `restore-official-sidebar-with-advanced-b` |
| **Date** | 2026-10-29 |
| **WRS** | 100/100 |
| **Size** | G · four bounded execution groups plus integration (owner follow-up, resumed round 1) |

## Problem

Bot chats hide native DSH controls, compete with the official right sidebar through a fixed Live rail, and offer no per-Bot context policy or trustworthy scoped request accounting. Restore the supported native surface without changing Bot execution authority or pretending unavailable usage is zero.

## Scope

### IN

| # | Deliverable | Files changed | Source |
|---|-------------|---------------|--------|
| 1 | One native right sidebar, Live tab, discoverable real API toggle, supported native controls gated by per-Bot Advanced | `apps/bots-dsh/src/client/index.js`, `header.js`, `header-navigation.js`, `overlays.js`, `live-rail.js`, `styles.js`, new `native-sidebar.js`, relevant tests | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |
| 2 | Persisted presentation flag and per-Bot soft threshold/carry budget, safe Bot checkpoint and truthful context status | `apps/bots-dsh/src/host/roster.js`, `parts.js`, `steward.js`, new shared context-policy module and context tests | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |
| 3 | Durable missingness-aware scoped attempt accounting, preserving old ledger data | `apps/bots-dsh/src/host/usage.js`, new shared usage-stats module and usage tests | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |
| 4 | Bot Settings Advanced/Context/Stats tracer slice, read-only host queries, client actions, behavior fixtures and generated bundle | `apps/bots-dsh/src/host/channel.js`, `src/client/team-actions.js`, `bot-settings.js`, new Advanced settings component, affected text/usage presentation tests, `client.js`, `README.md` | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |

### OUT

- No DSH upgrade, dependency/version/lockfile rewrite, unrelated history/upstream pull, identity/auth/permission/model-access changes, live benchmark/model calls, generic dashboard, merge/release/install into running app/restart. Source: `AGENTS.md` and canonical DRAFT.
- No recovery of information providers or legacy ledgers already erased; report unknown provenance explicitly. No inferred cost, timing, effectiveness or Bot/native parity. Reconsider only with actual provider evidence and separate benchmark authorization (Source: `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md`).

## Approach

Use rc.4's registered page types and keyed `sidebar.right.pane.tab` bodies. `sidebarRight.openTab`/`toggleExpanded` own navigation, sizing, focus, narrow fullscreen and persistence; the Bot never synthesizes clicks or reserves another Live width. Keep Browser/phone/plugin routes and existing last-action panel arbitration intact where those surfaces still need their own lifecycle. Advanced mounts the original supported native header/controls through the existing slot registration/injection/store contract; plain DSH retains its original surface. Source-proven unsupported native Bot compaction is explained and disabled rather than changing its guard. A strict host-persisted optional `advanced` boolean is default false and is independent of model/permission/context mutations.

Context policy resolves per-Bot optional `contextCheckRatio` and `contextRecentTokens` over validated plugin defaults (0.8 / 16384); hard remains 0.95 of usable window. The same resolver governs automatic steward checks and checkpoint/handoff carry. Read-only context status distinguishes measured pressure from fallback estimates and returns effective policy, current Session/part, checkpoint count and independent memory-review status. A Bot-only checkpoint command captures an expected current Session, reserves the existing maintenance path, refuses running/stale/read-only/unavailable/deleted state, respects cancellation, uses the internal native condensation backend, persists checkpoint metadata, and never silently creates a new part. Existing fresh-part action stays distinct with its current carry-discard semantics. Memory-review controls use existing per-Bot memory-review policy, never imply sequencing with compaction.

Keep one ledger row per billed attempt and the existing logged-versus-auxiliary separation. Add metadata/missingness through an additive, data-preserving migration rather than version-triggered table deletion. Legacy zeros with no knownness remain legacy/unknown; never reconstruct absence. Expose latest request, latest turn, selected current Session and Bot total with non-overlapping foreground/auxiliary category breakdowns. Session selection must belong to the requested Bot; no cross-Bot or group-private drilldown. Stable attempt keys retain retries and replace updated samples, fork inheritance is cut, auxiliary usage is counted once. Retain old aggregate Usage compatibility while exposing coverage for new Stats. Capture explicit provider normalization only where adapter source proves it; unsupported or erased semantics report unknown. Token-weighted cache ratios use an explicit compatible prompt denominator, never a cross-provider average. No fabricated cost/timing.

## Simplicity Case

- **Simplest complete design:** native pane registry and original controls; optional Bot fields; existing maintenance path; additive metadata on the existing ledger; one compact Advanced settings component.
- **Added machinery:** missingness/attempt metadata are required for truthful scopes and retries; one maintenance reservation is required to prevent checkpoint races. No second layout engine, background service, permission mode, provider adapter fork or accounting database.
- **Deferred until measured:** live effectiveness benchmarks, cost/rate tables and historical recovery require new data/authorization; no speculative dashboard or synchronization layer.
- **Complexity removed:** fixed Live portal/width reservation and ambiguous context/cache zeros; no parallel native/Bot compaction policy.

## Decisions

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| 1 | Advanced is per Bot, persisted, absent=false; native controls outside team unchanged | Explicit owner choice, presentation only | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |
| 2 | Live is a native tab with the native sidebar as sole Live layout owner | Eliminates competing rails; mobile inherits native fullscreen/focus | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |
| 3 | Native Bot compaction remains guarded; Bot checkpoint is an explicit idle command | Owner-approved exception and existing steward invariants | `apps/bots-dsh/src/host/parts.js` |
| 4 | Unknown metadata stays unknown, provider-compatible weighted ratios only | Missingness and legacy normalization cannot be reconstructed | `apps/bots-dsh/src/host/usage.js` |
| 5 | Publish only repaired existing wish branch to base dev, nonforce | Direct scoped follow-up supersedes historical report-only blocker | `.genie/brainstorms/restore-official-sidebar-with-advanced-b/DRAFT.md` |

## Risks & Assumptions

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Native controls bypass canonical Bot model state | High | Inventory original controls, route genuinely supported mutations through existing canonical synchronization, prove ownership and ordinary DSH regression |
| 2 | Checkpoint races running work, automatic steward, cancellation or Session rollover | High | Existing maintenance exclusion, expected Session identity, before/after await rechecks, failure/race fixtures |
| 3 | Migration destroys auxiliary history or legacy zeros fake completeness | High | Additive migration, preserved historical rows/owners, explicit legacy unknown coverage, reopen fixture |
| 4 | Provider adapters already erase missingness | High | Inspect pinned source; retain unknown provenance rather than claiming end-to-end recovery; fixtures preserve raw absence when actually delivered |
| 5 | Header drag, traffic lights, mobile keyboard/focus break | High | Preserve original injected store and native docking; isolated responsive interaction fixture, native shell slot contracts, no installed-app claims |
| 6 | Shared edits contaminate diffs | Medium | Disjoint writer scopes, lead-only integration/build/git, exact current-dev diff and final read-only review |

## Success Criteria

- [ ] Main and other Bot chats expose one native sidebar and a working Live tab, with no fixed duplicate rail; Browser/phone/plugin paths remain reachable. **Proof:** native adapter and rendered responsive click/keyboard fixtures.
- [ ] Advanced defaults off, persists per Bot across reload/part changes, exposes supported native controls without changing execution settings; ordinary DSH unchanged. **Proof:** host roundtrip/isolation/no-side-effect and original-header/slot tests.
- [ ] Per-Bot soft/carry controls resolve durably and affect actual steward/checkpoint/handoff behavior; hard95 protected; context measured/estimated/count/part and memory state truthful. **Proof:** policy resolver and runtime integration tests.
- [ ] Checkpoint now uses Bot maintenance/cancellation/persistence and rejects busy/stale/readonly/unavailable/racing requests; Start new part stays distinct; native compaction guard intact. **Proof:** host action race/guard tests.
- [ ] Durable request/turn/Session/Bot Stats keep unknown distinct from zero, count billed retries and overhead without duplicates/inheritance, preserve old ledger data/privacy, and show compatible weighted cache coverage without invented cost/time. **Proof:** matched provider/model/effort/tools fixtures, SQLite migration/restart, fork/retry/page/stream tests and rendered Stats tests.
- [ ] Root check, full affected plugin tests, lint and generated build checks pass with isolated environment; independent implementation verdict SHIP; exact authorized PR/base/head/files read back. **Proof:** recorded command exits and remote SHA/PR/check evidence.

## Next Step

Independent design review and stamp, then an approved bounded group plan and implementation. Preserve all failures and review/repair counters. Source-ready is not installed; no merge is authorized.

<!-- genie-design-review:start -->
## Design Review Evidence

- **Verdict:** SHIP
- **Reviewed content SHA-256:** `2183a415d6667f0de33a9561c991092705ba75ce7a607be067349b78aeda1b55`
- **Reviewer:** design-review
- **Reviewed at:** 2026-10-30T01:26:24.740Z
<!-- genie-design-review:end -->
