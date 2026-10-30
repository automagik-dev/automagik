# Wish: Finish approved official sidebar and Advanced statistics

| Field | Value |
|-------|-------|
| **Status** | IN_PROGRESS |
| **Slug** | `restore-official-sidebar-with-advanced-b` |
| **Date** | 2026-10-29 |
| **Author** | lead, native coordinator |
| **Appetite** | large, bounded dependent groups |
| **Branch** | `wish/restore-official-sidebar-with-advanced-b` |
| **Repos touched** | automagik, apps/bots-dsh only implementation |
| **Design** | [Reviewed design](../../brainstorms/restore-official-sidebar-with-advanced-b/DESIGN.md) |

## Summary

Deliver the owner's complete approved sidebar/Advanced/Context/Stats initiative and publish only the existing named wish branch to a PR against dev. Keep official native sidebar ownership, presentation-only Advanced, Bot-owned context safety, and truthful usage evidence. No merge, release, deployment, runtime install or restart.

## Scope

### IN

- Restore official right sidebar with Live tab, native API open/close and supported native controls behind per-Bot durable default-off Advanced; retain Browser/phone/plugin routes and mobile/focus/header contracts.
- Resolve persisted per-Bot soft threshold/carry policy; expose measured-or-estimated context and separate memory review; implement safe same-session idle checkpoint distinct from fresh part.
- Add data-preserving missingness-aware durable attempt/request/turn/session/Bot accounting, overhead breakdowns and compatible weighted cache coverage.
- Compact Bot Settings integration, regression/interaction fixtures, full relevant checks, independent review, authorized branch/PR publication and read-back.

### OUT

- DSH upgrade, unrelated inherited commits, versions/dependency/lockfile changes, execution-authority changes, live benchmarks/model calls, real profiles/drafts/secrets, live server mutation, app installation/restart, merge/release/deploy.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Preserve recorded owner choices without reasking | Explicit scoped follow-up settles all product choices |
| 2 | Native page registry owns Live geometry/focus | Avoid duplicate rail/width state |
| 3 | Advanced only controls presentation | No permission/model/identity side effects |
| 4 | Hard95 protected; per-Bot overrides resolve to plugin defaults then safe constants | Actual policy, not UI placebo |
| 5 | Checkpoint now reserves existing maintenance path; fresh part separate | Avoid running-work and rollover races |
| 6 | Unknown provenance stays unknown; additive migration preserves old rows | No fabricated cache0, overwritten auxiliary history, inferred parity/cost/time |
| 7 | Publish repaired existing wish branch nonforce only, PR dev | No duplicate PR; new provided branch remains unchanged |

## Simplicity Case

- **Simplest complete design:** existing native slots, optional Bot fields, existing maintenance path and ledger plus a compact settings card.
- **Added machinery:** missingness metadata is necessary for truthful statistics; a manual checkpoint exclusion is necessary to prevent races.
- **Deferred until measured:** live effectiveness benchmarks, cost tables and historical reconstruction require new evidence/authorization.
- **Complexity removed:** fixed Live rail ownership and implied absent=0 cache semantics; no parallel compaction policy or authorization mode.

## Dependencies

**depends-on:** none
**blocks:** none

## Success Criteria

- [ ] All six frozen design success criteria satisfied with actual behavior evidence.
- [ ] Independent design/plan and implementation reviews; configured repair budget 2 per group, initial attempts0/2, counters carried below.
- [ ] Root and full affected plugin suite/build/lint plus isolated UI/native fixtures pass; accurate baseline comparison and any failures preserved.
- [ ] Authorized existing branch published nonforce; exact PR URL/base/head/files/remoteSHA/checks read back, never merged.

## Execution Strategy

### Wave 1 (parallel disjoint writers after plan approval)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | sidebar engineer | Medium: native slot/control lifecycle and responsive geometry; ≤25 files/2000 handwritten insertions | inherit | Native sidebar/Live/control adapter and tests |
| 2 | context engineer | High: maintenance races and persistence, ≤10 files/2000 insertions | inherit | Bot fields, policy/status/checkpoint backend and tests |
| 3 | accounting engineer | High: durable schema/knownness and retries, ≤10 files/2000 insertions | inherit | Additive ledger and scoped read queries with fixtures |

### Wave 2 (dependent integration)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 4 | lead integration engineer | High parent wave: bounded subunits4a and4b below, each ≤25 files/2000 handwritten insertions | inherit | Host endpoints, settings/stats UI, fixtures, bundle, checks/review/publication |

**Global constraints:** No DSH upgrade, unrelated inherited commits, versions/dependency/lockfile changes, execution-authority changes, live benchmarks/model calls, real profiles/drafts/secrets, live server mutation, app installation/restart, merge/release/deploy.

Expected handwritten sizes (stop and split a group before exceeding hard25files/2000 insertions, never shrink approved scope): G1 12files,700 source+500 test insertions; G2 8files,600 source+650 test; G3 5files,650 source+500 test; G4 13files,850 source+900 fixture/test plus generated bundle. Planning records and generated bundle are measured/reported separately, not hidden as authored code.

Group4 is a parent integration wave, not one unbounded executor: **4a UI/API/accounting-oracle integration** owns16 app files including generated client (lead, native tasks6/7/8;16 after the matched-native test); **4b isolated native fixture** owns10 app files (fixture, native task5; the extra no-op host entry is required by the verified public client loader). Each unit independently remains below25 files/2000 handwritten insertions. 4b may prepare against frozen interfaces independently, but actual execution depends on source1–3 and4a built/green; final parent verification/publication depends on both. Documentary provenance/planning is recorded separately. This splits execution only, never drops a deliverable or reopens product scope; one real Genie group4 card coordinates the parent, actual native child IDs remain recorded rather than invented.

Shared checkout; writers do not move HEAD/index or build shared generated client. Lead alone owns git, endpoint/client integration and build. Generated client is reviewed as a generated artifact and not hidden in handwritten size estimates. Required aggregate checks remain required; group checks do not replace them. All commands run in the supplied checkout with absolute paths. Validation shell must prepend `/Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/.tools/bun-darwin-aarch64` to PATH for pinned Bun1.4.2 and unset inherited OMNI_CLIENT_ID, DS_BOT_APP, AUTOMAGIK_HOST, AUTOMAGIK_PRELOAD only in the test subprocess. The plugin-scoped validation blocks below describe package-relative arguments: execute each via `node --import <absolute-checkout>/apps/bots-dsh/test/harness-resolve.mjs --test <absolute-checkout>/apps/bots-dsh/test/<named-test>` with workdir at the supplied root, preserving the same declared test set. Aggregate commands use `bun run --cwd <absolute-checkout>` / `--cwd <absolute-checkout>/apps/bots-dsh`; build uses the absolute script path. No installed environment/config is modified. Only authorized existing wish branch is published.

## Execution Groups

### Group 1: Native sidebar and Live

**Goal:** Make the official native pane the sole Live layout owner and expose supported native controls per-Bot Advanced.

**Deliverables:**
1. Native page registration/disposal, genuine sidebar toggle/open action, relative Live content; no body-portaled competing rail.
2. Original native header/control integration without dropping injected store/view navigation; unsupported Bot native compaction explained.
3. Tests for registration/cleanup, ordinary DSH, main/other Bot, responsive focus/keyboard/header and retained Browser/plugin routes.

**Interfaces:**
- Consumes: `bot.advanced === true` from Group2; existing roster current/earlier Bot mapping.
- Produces: native Live page kind `bot-live` plus `actions.openLive()` and `actions.toggleRightSidebar()`, supported original-slot lifecycle adapter; no host mutation.
- Owned files: client/index.js, header.js, header-navigation.js, overlays.js, live-rail.js, styles.js, native-sidebar.js (new), corresponding sidebar/header/live tests only. Existing Browser lifecycle unchanged unless source proves adapter-only fix needed.

**Acceptance Criteria:**
- [ ] One native Live tab, actual native API navigation, no duplicate fixed width reservation, native mobile docking owns layout.
- [ ] Advanced-only native controls, default-off Bot state, ordinary DSH unchanged, no fake clicks or changed execution settings; preserve all supported Browser/phone/plugin routes.

**Validation:**
```bash
node --import /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/harness-resolve.mjs --test /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/native-sidebar.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/live-rail.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/header.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/right-panel.test.js
```

**depends-on:** none

### Group 2: Per-Bot context policy and checkpoint

**Goal:** Persist real context policy and provide safe Bot-owned status/checkpoint operations.

**Deliverables:**
1. Strict optional advanced/contextCheckRatio/contextRecentTokens validation and persistence with presentation-only side-effect isolation.
2. Shared resolver used by automatic steward and both checkpoint/handoff carry paths; hard95 protected.
3. Truthful context status and same-session idle checkpoint through existing guarded backend, revalidating ownership/cancellation/persistence.

**Interfaces:**
- Consumes: existing Bot `updateBot(id,patch,actorId?,fromSessionId?)`, compaction backend and automatic-check maintenance.
- Produces: `contextPolicy(bot,config) -> {checkRatio:number,recentTokens:number}`; `rt.contextStatus(botId) -> Promise<{id:string,sessionId:string,status:string,readOnly:boolean,policy:{checkRatio:number,recentTokens:number},usage:{tokens:number|null,source:'measured'|'estimated'|'unavailable'},lines:{window:number,usable:number,check:number,hard:number}|null,counts:{messages:number|null,user:number|null,assistant:number|null,tool:number|null,checkpoints:number|null,parts:number},markers:{checking:boolean,condensing:boolean,switching:boolean},canCheckpoint:boolean,checkpointReason:string|null}>`; unloaded Sessions report unavailable/null rather than being materialized by a read. `rt.checkpointBot(botId,{sessionId:string}) -> Promise<{id:string,sessionId:string,status:'checkpointed',context:ContextStatus}>`. Refusals use existing error codes bot/invalid, bot/not-found, bot/read-only, bot/stale, bot/busy, bot/refused; same-session backend failure/cancel rejects, never switches. `bot.memoryReview?:boolean` is validated/persisted here; Group4 implements its independent scheduling/status.
- Owned files: host/roster.js, parts.js, steward.js, shared/context-policy.js (new), test/context-policy.test.js, context-checkpoint.test.js (new), relevant roster/steward tests. Lead owns channel/client.

**Acceptance Criteria:**
- [ ] Defaults80/16384, immutable hard95, valid per-Bot overrides/reset/restart and isolation; no model/identity/permission changes or greeting from advanced-only patch.
- [ ] Context measured/estimated/unknown and part/count markers accurate; busy/stale/deleted/native/readonly/unavailable/racing requests fail safely; no switch fallback or native guard bypass.

**Validation:**
```bash
node --import /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/harness-resolve.mjs --test /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/context-policy.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/context-checkpoint.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/steward.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/roster.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/session-identity.test.js
```

**depends-on:** none

### Group 3: Honest durable accounting

**Goal:** Expose read-only scoped billing attempts and cache coverage without data loss or false precision.

**Deliverables:**
1. Nullable/knownness attempt metadata and additive migration preserving v2 auxiliary/owner/kind data and legacy unknown provenance.
2. Deterministic logged request/turn/attempt identities; auxiliary isolation/deduplication; per-Bot session authorization.
3. Compatible token-weighted normalized cache groups and scopes with calls/attempts/retries, foreground/overhead/all-in totals; no cost/timing invention.

**Interfaces:**
- Consumes: existing durable assistant settlement and `rt.tagUsage(request,{session,kind})` stream tagging.
- Produces: `rt.usageStats(botId,{sessionId}={}) -> Promise<{version:1,botId,sessionId,scanning,coverage:{status:'complete'|'partial'|'scanning',unreadableSessionIds:string[],unresolvedSessionIds:string[]},scopes:{lastRequest:Scope|null,lastTurn:Scope|null,session:Scope|null,bot:Scope}}>`; `Scope={id:string,allIn:Totals,byKind:Record<string,Totals>,byProvider:ProviderTotals[]}`; `Totals={input:number|null,output:number|null,cacheRead:number|null,cacheWrite:number|null,calls:number|null,attempts:number,retries:number|null}`; `ProviderTotals={provider:string,semantics:string|null,totals:Totals,cacheRatio:{read:number,prompt:number,ratio:number}|null}`. Latest request/turn refer only to selected current own-chat Session; auxiliary parent linkage stays null unless explicit. Query refreshes only derived ledger through bounded existing scan/open, never models/settings/Sessions. Existing `rt.usageView({timeZone})` compatibility retained.
- Owned files: host/usage.js, shared/usage-stats.js (new), test/usage.test.js and new usage-stats/migration fixtures. Lead owns channel/client; context writer may add more precise auxiliary kind tags only after coordination.

**Acceptance Criteria:**
- [ ] Missing vs known0 and legacy unknown survive durable roundtrip/migration/restart; all scopes do not count inherited or streamed foreground twice.
- [ ] Retry/partial/failed/fork/paged samples and auxiliary categories have explicit evidence; provider unknowns not averaged or presented as0; session query cannot cross Bot/private scope.

**Validation:**
```bash
node --import /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/harness-resolve.mjs --test /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/usage.test.js /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/test/usage-stats.test.js
```

**depends-on:** none

### Group 4: Settings tracer slice and integrated verification/publication

**Goal:** Wire all approved behavior into compact Bot Settings and deliver a verified PR.

**Deliverables:**
1. Read-only context-status/usage-stats and mutable checkpoint-bot endpoints under existing host route protections, client actions, Advanced switch, numeric context controls, separate memory-review settings/status, Checkpoint now versus Start new part.
2. Context and Stats rendered with scopes/privacy/knownness/compatible weighted cache provenance; no generic dashboard or imaginary timing/cost.
3. Isolated browser/native fixture, baseline comparison, bundle/docs, full root/plugin/build/lint and distinct implementation+quality reviews, bounded repairs, authorized PR publication/read-back.

**Interfaces:**
- Consumes: all Group1-3 interfaces, existing `bot-fresh`, `updateBot`, memory review setting/status API.
- Produces: endpoint `context-status` request `{botId:string}` -> ContextStatus; `usage-stats` request `{botId:string,sessionId?:string}` -> Group3 Stats; `checkpoint-bot` request `{botId:string,sessionId:string}` -> Group2 checkpoint result (expected Session required). Read endpoints are added to existing READS; checkpoint remains a mutation. Client actions `contextStatus(botId)`, `usageStats(botId,sessionId?)`, `checkpointBot(botId,sessionId)` mirror these. `memory-review-status` read request `{botId:string}` returns `{enabled:boolean,allowed:boolean,pending:boolean,running:boolean}` for own chat only; updateBot persists per-Bot override, while config.memoryReview=false remains a global off guard. Settings integrate in both existing entrypoints; generated client.js.
- Owned files: host/channel.js and memory.js; client/team-actions.js, bot-settings.js, advanced-settings.js (new), relevant text/usage-data rendering if needed, test/advanced-ui.test.js and advanced-endpoints.test.js, memory-review focused regression, dev/advanced-check.mjs isolated native fixture runner (new), client.js, README.md; planning/provenance evidence. Other source changes require coordinated writer release and independent review, not hidden scope expansion.

**Acceptance Criteria:**
- [ ] Actual settings clicks mutate only intended Bot fields; rendered query/actions display current ownership and disable unsupported actions with explanations; stale response guards protect Bot switching.
- [ ] Matched synthetic provider/model/effort/tools native-vs-Bot accounting fixtures demonstrate correctness only, not effectiveness parity.
- [ ] Green relevant aggregate gates and independent SHIP on exact delivered SHA; remote PR head equals local, base dev, files limited to this initiative, checks accurately reported.

**Validation:**
```bash
export PATH="/Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/.tools/bun-darwin-aarch64:$PATH"
unset OMNI_CLIENT_ID DS_BOT_APP AUTOMAGIK_HOST AUTOMAGIK_PRELOAD
bun run --cwd /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta check
bun run --cwd /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh test
bun run --cwd /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh lint
node /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/scripts/build-client.mjs --check
node /Users/feliperosa/.automagik/desktop/bots/workspace/wishes/automagik/finish-approved-sidebar-and-advanced-sta/apps/bots-dsh/dev/advanced-check.mjs
```
The named advanced-check.mjs fixture must use isolated synthetic native/sidebar and Bot settings data on disposable loopback only and assert actual click/tab/toggle/persistence/keyboard/narrow behavior; no screenshots-only pass. It substitutes initiative-specific rendered/native integration, not the full existing smoke/web suite. Existing dev/check.sh smoke/web need a full DSH checkout absent here, and desktop needs Linux/Xvfb unavailable on macOS; these gates are explicitly UNAVAILABLE/BLOCKING for any merge-ready claim until equivalent relevant integration evidence is independently accepted. Do not invoke its cleanup against unknown shared bench paths, reduce tests, or claim unrun steps passed.

**depends-on:** 1, 2, 3

## QA Criteria

- [ ] Actual responsive interaction and keyboard/focus checks on native sidebar/Live/Advanced/settings, not screenshots alone.
- [ ] Durable policy and accounting roundtrip, maintenance races/cancellation/guards, plain DSH regression, host scope/privacy.
- [ ] Generated client matches source, root and affected plugin checks pass in isolated environment, independent review evidence current.
- [ ] PR exact URL/base/head/files/remote SHA/checks confirmed; source-ready never described as installed.

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Provider has erased absence before plugin | High | Inspect pinned source and expose unknown semantics; no reconstruction claim |
| Manual checkpoint overlaps automatic maintenance/input | High | Reserve/revalidate identity, cancellation and existing guarded backend; explicit concurrency tests |
| Native model controls diverge from Bot ownership | High | Inventory supported controls and test canonical synchronization; never change visibility into execution mode |
| Legacy migration loses live auxiliary data | High | Additive columns/metadata and reopen fixture, retain all old rows |
| Native macOS titlebar cannot be exercised without live app | Medium | Isolated DOM/native layout and source contract checks, report platform limitation honestly |

## Review Results

Independent design-review returned DESIGN SHIP and PLAN conditional SHIP at 2026-10-30T01:26:24.740Z; condition satisfied by stamping reviewer-provided design digest2183a415d6667f0de33a9561c991092705ba75ce7a607be067349b78aeda1b55 and verifier exit0, wish lint exit0. Reviewed plan raw SHA256d89a752d13da404fb6e118b8143a434a2417b61aeae25bfd19b0ffe3d2aec3f5,23252bytes; only status/evidence bookkeeping appended afterward. APPROVED on disk before execution. No blocking design/plan findings remain. Earlier independent design SHIP12022a was invalidated by citation-only structural fix and freshly reviewed, not restamped with a coordinator digest. Earlier plan review BLOCKED changing snapshot (not product scope); exact interfaces/commands/sizes and named fixture corrected before fresh review.

Repair counters: G1 0/2; G2 2/2 completed and independently accepted SHIP (final provenance repair); G3 1/2 completed and independently accepted SHIP; G4 0/2. Separate source-quality loop1/1 completed and independently accepted SHIP for bounded Stats SQL/polling; no implementation budget reset. Effort escalations0/2 each; budget source configured2. Initial implementation changes are not counted as review repair rounds.

### Independent implementation review, first pass

- G1 SHIP for exact source/unit scope only, reviewer independent delegated session, 2026-10-30T01:43:43Z–01:47:08Z. Ten-file manifest aggregate8dcd34f574611fd0b5047f572dc9fcef294df2dabc111e1ccef129c0cd7f873d unchanged before/after; HEADad7da349.32/32 focus plus actual-toggle mutation sensitivity verified; native rc.4 registry/header/control lifecycle traced. No confirmed findings. Actual browser/native/mobile/focus/platform proof still Group4; no final initiative SHIP.
- G2 FIX-FIRST, independent reviewer2026-10-30T01:46:01Z–01:49:19Z, eight-file scoped manifesta47334574a9b24180d115f11f7dd4bdaa727ce2f5572eb5d014318336f7fb2a1 unchanged. HIGH: parts.js internal ALS Session-id bypass is inherited by real runMaintenance wake/driver descendants after checkpoint reservation ends, allowing native automatic compaction. MEDIUM: contextStatus readOnly null/string violates boolean contract. Repair1 authorized: revocable operation capability, deactivate finally, actual maintenance-wake/delayed-assembly guard regression; boolean status.189/189 focus independently rerun by lead, not sufficient to cover this new race. Other policy/default/persistence/carry/status/same-session guard criteria source-traced satisfactory.
- G3 FIX-FIRST, independent reviewer2026-10-30T01:49:14Z, four-file scoped manifest6988c8d3593581748d41768b6deb53cae94e59b917fdba5a6c7ed7506a7de1ac unchanged. HIGH: task kind is not journaled until scan, so bounded task eviction before first scan permanently reclassifies billed task attempts as chat. Independent in-memory reproduction returned chat8input/2output instead of task. Repair1 authorized: capture owner/kind during ingestion before async metadata loss, evict-before-first-scan/reopen regression. Other additive migration/knownness/provenance/retry/fork/dedupe/scope/privacy/coverage criteria traced against real rc.4 adapters.29/29 focus independently rerun by lead; dedupe and destructive migration mutants fail with exact amount/count mismatches.

Attributable logs under .tools/evidence: context-final-tests.log (lead189/189); context-policy-behavior-red.log (policy-ignore mutation expected failure); accounting-lead-tests.log (lead29/29); accounting-behavior-{baseline,dedupe,migration}.log (expected failure); advanced-ui-behavior-red.log (0 versus Unknown); memory-review-behavior-red.log (override ignored). No candidate reset/revert or live model calls. Native tracking tasks5/6/7 are independent Group4 fixture/presentation/memory preparation against frozen interfaces; final integrated Group4 still depends on reviewed1–3.

Tooling observation: genie context --wish and --re-resolve both returned stale origin042968 despite actual localHEADad7da349 and publish/dev7b85d098. This output is explicitly NOT the wave base; all workers received real git identities and WISH is authoritative. No source was based on stale metadata. Existing sidebar bug deduped to issue89; source-confirmed usage knownness/migration bug filed/readback issue152. Quality repair cap: one separate loop. Real Genie cards: G1 t_mvuakksj94d8f060; G2 t_mvuakku9db5d0e9e; G3 t_mvuakkvx6f29c450; G4 t_mvuakkxnddcd11e6. Native board task-1/2/3/4 records write scopes and task4 dependencies; neither system identifier is a saved workflow run ID.

### Repair1 independent acceptance and integration evidence

- G2 independent repair re-review SHIP (source/unit scope),2026-10-30T01:55:31Z–01:57:52Z. Full eight-file manifest45e25dab4a2d1722f508af83f7a7b7adf1b777ee249cc52565acba9cb53a989c unchanged. Revocable per-operation token checked for active Session and revoked finally in both paths; actual rc.4 maintenance/followup/wake/native hook regression covers delayed assembly after success, failure and automatic compaction.194/194 pass; revocation/readOnly mutant4 expected behavioral failures. Strict boolean status restored. Logs context-repair1-{tests,behavior-red}.log. No remaining confirmed findings; actual integration still required.
- G3 independent repair re-review SHIP (source/unit scope),2026-10-30T01:55:31Z–01:57:34Z. Full four-file manifest28613ed5e5c284241dfe596297fc9564781e9fedda7368ea575675e5d631a344 unchanged. Ingestion captures positive owner/kind before awaits; atomic durable journal and cache-on-success; pre-first-scan eviction/reopen asserts exacttask8/2 and no chat.30/30 pass and scopedlint0warnings0errors. Owner-only mutant failsundefined!=8. Logs accounting-repair1-{tests,red,mutant}.log. No remaining confirmed findings.
- G4 independent prep against frozen contracts: actual endpoints and client actions wired, single Bot Settings form contains Advanced, Context, Stats; stale Bot/part/poll responses guarded. Per-Bot own-chat memory-review scheduling/status honors global-off and group separation. New API3/3 and presentation/memory/i18n/legacy-cache13/13 focused tests pass; expected baseline/mutation reds preserved. Legacy projection/cache summary no longer manufactures0% or cross-provider averages.
- Initial integrated root check/build/generated check/lint exit0; fullplugin initially failed ONLY exact install-order snapshot for the two new required lifecycle cancellation registrations. Test now asserts those precise agent/disposed and cancel-explicit-checkpoints entries without loosening ordering. This is new-feature contract evidence, not a workaround for the19 pristine environment failures. Full affected suite rerun1369 tests,1367 pass,0fail,2 pre-existing skip,exit0 (.tools/evidence/integration-plugin2.log). Initial lint23warnings0errors, including a new empty-generator fixture warning subsequently fixed; final lint recorded later. Generated bundle is faithful esbuild output; dependency-order shifts cause a large generated-only diff, separately disclosed from handwritten groups.
- Fixture runner has six scoped files and594 lines, reviewed clean-environment/owned-home/loopback-only/telemetry-off/own-process-group cleanup. Real native rc.4 CLI/frontend, fresh Chrome pipe/profile, actual source plugin installed only into disposable profile through supported dsh plugin/pnpm link, genuine fixture view/header extension. Never app60237/CDP/live profiles. Parent starts exactly one managed run at a time and collects it; fixture process restarts are disposable-profile persistence tests, not installed-app restarts. Named command requires explicit `--run`; source macOS strip contracts never represented as native traffic-light proof.

### Additional quality/provenance findings and bounded closure

- Distinct independent quality-review FIX-FIRST at2026-10-30T02:10:54Z–02:13:25Z,22production-file manifest13b591e0fbfdbd8044a4d34d425bf84aacd625e89c759d38c709d2c965a9de4f unchanged. HIGH: new Stats used synchronous full-team historical rows()/allRows.all plus repeated JS arrays on every5s poll, unbounded by unrelated Bot history; scan timeouts do not bound that query. One authorized quality loop pushes ownership/session predicates and missingness-aware full-history totals/provider/kind/latest request/turn into SQL or cooperative bounded iteration, never truncates history. UI now skips ticks while reading and serializes owner-switch replacement. Sensitivity mutant removing single-flight guard fails21requests!=1 (.tools/evidence/poll-overlap-red.log). LOW caption overclaims billing for unknown failed attempts; caller chose narrow copy cleanup to Recorded model attempts, preserving all counters/unknowns and no-cost claims. No unrelated cleanup.
- Independent focused G2 provenance review FIX-FIRST/HIGH at2026-10-30T02:30:29Z,parts.js SHA81f1cf06fc72881e19f536c3c00ef78a0efc7000519c96494e982fbeed546578. Native tokenMeter baseline.kind is none/estimated/usage and surfaceDeltaTokens is heuristic repricing; presence of a finite meter total is not measured evidence. Final G2 repair2/2 authorized: preserve numeric total/safety behavior; measured only explicit usage baseline with finite nonnegative matching baseline.tokens and zero delta; other finite native totals estimated, derived-message fallback still estimated. Tests must cover actual metadata, +/-delta, missing/malformed provenance. No new product decision/schema.
- Added94line matched accounting fixture uses the ACTUAL pinned native tokenUsage projection via temporary test-only load hook, identical synthetic provider/model/effort/tools headers, every settlement/retry/replacement/knownzero prefix. Fully reported native/Bot bucket equality; separate deduped auxiliary overhead expected only in Bot all-in; absence intentionally stays BotUnknown rather than nativelegacy0. No live benchmark/effectiveness/cost/timing inference. Combined33/33 and newfilelintclean before quality changes (.tools/evidence/native-accounting-tests.log); must rerun after quality repair.
- Native fixture development runs1–3 failed and were collected/cleaned, not claimed passed: run1 passed17 real checks but fixture probe slot label incorrectly supplied string instead of public callback; run2 exposed nondeterministic plain hero without real Session; run3 chooser never opened. All failures and owned HTML/PNG retained under .tools/advanced-fixture. Fixture now seeds only disposable plain native workspace/blankSession through public workspaceRegistry/sessionController APIs (host-only fixture plugin; no Bot plugin or client override), then performs actual native UI selection and exact active Session-id retention. Never direct native store/React mutation. Fixtures are frozen through each managed run; no source editing during accepted runs. Actual full native acceptance still pending; screenshots are diagnostics only.

### Accepted final source snapshot before native completion

- Final G2 repair2/2 SHIP by independent design-review at2026-10-30T02:39:36.451Z. Eight-file identity544b8d6d1420933fce5e23835b136d0ead69bd9a3a87a0d4ee83d1c3ba0078c6 (SHA256 of sorted `{path,mode,sha256}` JSON plus newline) unchanged. Actual195/195 pass, tests-first and old-classifier mutant both reject two false-measured classifications. Numeric totals/effective lines unchanged in18 metadata cases. Effort escalations0/2; no implementation attempt remains for G2.
- Distinct final quality loop1/1 SHIP at2026-10-30T02:42:08Z–02:44:05Z,22production-file manifest387395b373c4e5e403686013a3d2fe1c49ae2efdbe9e7588c314c8882148513b unchanged. SQL authorized predicates/indexed scopes, missingness-aware all-history aggregate returns, pending-key replacement and transaction snapshot, and single-flight reads all traced. Actual37 accounting tests and5 UI/i18n tests pass; owner-predicate/raw-materialization/poll-overlap mutants fail. SQL is O(authorized attempts), returned data O(1+kinds+providers); memory fallback O(owned logical-request identities), cooperative256-visit yields/6s abort and explicit partial coverage. No constant-time/production-latency claim.
- Fresh source-wide affected gates after all production repairs: build0/root0/plugin0/lint0/generated0. Root29pass/0fail; plugin1377total/1375pass/0fail/2pre-existing Windows-only skips; lint22warnings/0errors. Receipt quality-gate-exits.log and actual quality-{root,plugin,lint}.log. All production sources frozen thereafter; final exact-commit gate remains required.
- Independent execution-fission review SHIP at2026-10-30T02:54:03Z, WISH snapshot501cd36aae86dd1599523b8c36ed993488513c459fa4b42ce94c387516c03229. Units4a16 and4b10appfiles each meet25-file/2000handwritten cap; parentGroup4 not an oversized single executor. Design SHIP helper digest remains2183a415d6667f0de33a9561c991092705ba75ce7a607be067349b78aeda1b55, unchanged.
- Browser-discovered inherited ModelChoiceDock React290 reported separately and body read back: https://github.com/automagik-dev/automagik/issues/153 . Current and dev model-menu.js Git blob8bdeb03a773fc04c77e3842ce3914ad409c2915a identical (empty diff). Reserved string ref with suggested route is the exact unchanged source cause; official React decoder corroborates it. No-model waiting phase only; existing canonical Settings/API selection still works and normal branch exits once selected. Not fixed/suppressed or attributed to this initiative. No pristine-baseline browser rerun is claimed; attribution is exact unchanged source/blob plus actual captured exception and React semantics.
- Native runs4–6 retained source identity (all changed app paths checked) and all owned processes cleaned. Plain exact public-API-seeded native Session identity, no Bot plugin, real keyboard/narrow/reload checks now pass. Main/other Bot simple+Advanced real sidebar geometry/collapse/reopen, native Chat/Trajectory/plugin views/More discovery/header child action counter and per-Bot presentation-only authority checks now pass. Fixtures initially omitted required no-op host entry (verified public client-loader discovery), then sampled native pane mid-transition; corrected without changing production. Geometry retains strict containment, waits via bounded rAF predicate, never arbitrary sleeps. Run6 next exposed send-helper admission, being diagnosed against real native editor contract; no complete native-run SHIP yet.

### Current dev refresh before final commit gate

Authenticated dev advanced from7b85d098d1719ebe5ca503ab7d74edf5097e7472 to f8793314d7c60289d2f345e9e70aad8a2846503d during verification. Compare read back: six commits containing version3.50/market updates, desktop Omni pin and separate upgrade tooling/docs/unit tests; no initiative implementation file changes (Bot package version only). Only that dev ref was fetched, never another upstream project. The allowed existing wish branch is still unpublished, with no remote head or duplicate PR. Coordinator commits the exact52 pending initiative paths, then safely rebases that branch onto current dev without stash/reset/force; unrelated upstream changes belong to the base, not this PR. Re-run source/commit gates on the resulting SHA; inspect new upgrade tests for pure test-only behavior and never execute the host-upgrade procedure. Earlier source hashes/results remain accurately attributed historical evidence, not mislabeled as a gate on the later commit.

### Provenance and baseline

Authenticated GitHub dev and FETCH_HEAD agree on `7b85d098d1719ebe5ca503ab7d74edf5097e7472`. Remote named wish heads/PR absent. Existing branch had planning85fdd2e plus eight unrelated durable-wakeup commits; only planning commit was replayed onto currentdev using authorized safe unpushed rebase. Original historical DRAFT/REVIEW retained; no inherited runtime implementation enters initiative diff. Audit references2152236262ad360f8bab3a9d2cb7d67a48b3ca69 and separate context researche0c7687f9ff407fd95ea3d022663cf59537ee81d are historical leads, not current proof.

CI pins Bun1.4.2; shell Bun1.3.14 rejects lockfileVersion2. Downloaded pinned Bun into ignored `.tools` (no lockfile rewrite). Frozen root/plugin installs pass; harness rc.4 install passes. Initial harness install tempdir denial was retried only with explicit approved wider sandbox; no installed runtime changed.

Pristine currentdev root check exit0. Pristine affected suite:1306 tests,1285 pass,19 fail,2 skip under inherited desktop flags. Identical untouched suite with OMNI_CLIENT_ID/DS_BOT_APP/AUTOMAGIK_HOST/AUTOMAGIK_PRELOAD removed in subprocess exits0. Logs preserved under ignored `.tools/evidence/base-{root,plugin,plugin-isolated}.log`; test source unchanged. Native fallback has no saved-run accounting or fabricated workflow IDs. Genie task query initially reports no tasks; native shared board used only if valid IDs returned.

## Files to Create/Modify

```
.genie/brainstorms/restore-official-sidebar-with-advanced-b/{DRAFT,DESIGN,REVIEW}.md
.genie/wishes/restore-official-sidebar-with-advanced-b/WISH.md
.genie/INDEX.md
apps/bots-dsh/src/client/{index,header,header-navigation,overlays,live-rail,styles,native-sidebar,team-actions,bot-settings,advanced-settings}.js
apps/bots-dsh/src/host/{roster,parts,steward,usage,channel}.js
apps/bots-dsh/src/shared/{context-policy,usage-stats}.js
apps/bots-dsh/test/*focused affected behavior tests*
apps/bots-dsh/client.js
apps/bots-dsh/README.md
```
