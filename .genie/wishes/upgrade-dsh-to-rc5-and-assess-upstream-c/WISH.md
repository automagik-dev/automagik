# Wish: Upgrade DSH to rc5 and assess upstream changes

| Field | Value |
|-------|-------|
| **Status** | IN_PROGRESS |
| **Slug** | `upgrade-dsh-to-rc5-and-assess-upstream-c` |
| **Date** | 2026-10-30 |
| **Author** | Automagik / lead |
| **Appetite** | medium |
| **Branch** | `wish/upgrade-dsh-to-rc5-and-assess-upstream-c` |
| **Repos touched** | automagik (isolated copy only) |
| **Design** | _No brainstorm — direct wish_ |

## Summary

Move the actual rc.4 source dependency set to officially published DSH 0.2.1-rc.5, using existing package/version tooling, and assess the immutable upstream range. Source readiness is distinct from installation, loaded runtime, and deployment; unmet verification gates must remain explicit.

## Scope

### IN

- Existing 12 plugin manifests and harness manifests, desktop runtime manifest/lock, root market-parser dependency/lock; minimal compatibility changes only when proved necessary.
- Patch applicability, unchanged upstream seam audit, offline isolated validation, committed impact and evidence report.

### OUT

- Installation in the user's app, release, restart, services, network model calls, profile changes, credential changes, permission widening, merge, push or PR creation.
- Held drafts #141, MCP auth #162, rendering #161, stopped retention #164, memory #166, full inheritance and wakeups feature work or repair-budget resets.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Pin 0.2.1-rc.5 / b830ec950faba0a46dda564be3e2d854afed94f1 | First-party release/tag verified, not master. |
| 2 | Use follow-dsh.mjs --all and Bun exact dependency tooling | No hand-edited versions; public contracts stay unchanged. |
| 3 | Three sequential groups, single writer | Existing --all writes 26 files; exceeds single-unit 25-file admission limit. |
| 4 | No service-launching tests | Explicit user prohibition outranks CI boot/headless fixtures. Missing evidence is BLOCKED, not green. |
| 5 | Repair ceiling B=2 | `genie config get budgets.maxEscalationsPerGroup` returned 2. No prior upgrade ledger discovered yet; consumption UNKNOWN until search completes. Existing held-track budgets do not transfer. |

## Simplicity Case

- **Simplest complete design:** update exact dependency pins with their existing owner; retain patches if upstream has not absorbed them; document evidence and limitations.
- **Added machinery:** none in shipped code. Checkout-private ignored validation tooling only.
- **Deferred until measured:** reasoning wrappers, memory, durable drafts, MCP auth, default-model changes and performance work require separate authorization.
- **Complexity removed:** no migration, new permission mode, new background process or versioning mechanism.

## Dependencies

**depends-on:** none
**blocks:** none

## Success Criteria

- [ ] Exact published baseline and target source/package provenance recorded, fresh remote dev verified, no guessed installed version.
- [ ] All owning DSH source dependencies synchronized through existing tooling without unrelated package-major drift.
- [ ] Public contracts and permission/profile/credential state unchanged; teammate patch neither dropped nor double-applied.
- [ ] Same isolated CI toolchain used for baseline and upgraded offline checks; failures/skips/prohibited coverage reported exactly.
- [ ] Evidence-backed impact/opportunity report distinguishes verified source changes from inference, integration, installation and live-loaded unknowns.
- [ ] Independent read-only preflight and immutable final review; no SHIP claim with missing required gates.

## Execution Strategy

### Wave 1 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | mechanical, 24 owning pin files | inherit | Synchronize plugin/harness manifests using --all transaction. |
| 2 | engineer | runtime trust boundary and lock resolution | inherit | Runtime and root dependency tooling, preserve patches; isolated gates. |
| 3 | engineer + independent reviewer | evidence/report only | inherit | Compatibility audit, report, final review and commit-only handoff. |

**Global constraints:** No app installation, restart, service launch, live model calls, profile mutation, credential changes, permission widening, merge or push. Preserve IDs/routes/storage prefixes/team home. No held-track implementation. Use checkout-private caches/HOME/temp and DO_NOT_TRACK=1. B=2 ceiling; missing historical consumption is UNKNOWN, never zero. Existing user authorization covers implementation after reviewed preflight without asking again.

Groups execute sequentially in this supplied isolated branch. The owner tool writes groups 1 and 2 atomically; no competing writer or artificial partial commit is introduced. Full aggregate gates remain required for readiness, even where user restrictions prevent executing them.

## Execution Groups

### Group 1: Plugin source pins

**Goal:** Move all twelve shipped plugin test harnesses and compatibility floors together.

**Deliverables:**
1. `apps/{bots,welcome,locale-pt-br,unfold-bridge,unfold-bot,unfold-sse,unfold-events,unfold-capabilities,unfold-settings,unfold-mind,unfold-trajectory,unfold-session}-dsh/package.json`.
2. The corresponding `dev/harness/package.json` files (24 files total).

**Interfaces:**
- Consumes: `follow-dsh.mjs --all <version>` with `version = 0.2.1-rc.5`.
- Produces: `dependencies['@deepseek-ai/dsh'] = '0.2.1-rc.5'`; `engines.dsh = '>=0.2.1-rc.5 <0.2.2-0'`.

**Acceptance Criteria:**
- [ ] All twelve manifest/harness pairs agree; no Automagik version, ID or public path changes.

**Validation:**
```bash
node --test apps/desktop/test/follow-dsh.test.js
```

**depends-on:** none

### Group 2: Runtime, market parser and gates

**Goal:** Resolve immutable runtime and root package artifacts without changing unrelated dependency majors or runtime patches.

**Deliverables:**
1. `apps/desktop/runtime/package.json`, `apps/desktop/runtime/package-lock.json`, root `package.json`, `bun.lock`.
2. Baseline and patched gate logs in ignored checkout-private `.cache/rc5/`; no user data used.
3. Proven-required patch metadata port through `apps/desktop/scripts/follow-dsh.mjs` and its `apps/desktop/test/follow-dsh.test.js`: synchronize patch version fields using existing owner tooling, preserving before/after hashes and fail-closed runtime checks; update `apps/desktop/runtime/patches/patches.json` and explanatory `apps/desktop/docs/DEVELOPMENT.md`. No patch hunk or permission changes.

**Interfaces:**
- Consumes: Group 1 manifest values and `pinRuntime(manifest, version)`.
- Produces: frozen lock integrity plus `patchRuntime(modules, patches)` applicability/idempotence evidence.

**Acceptance Criteria:**
- [ ] Runtime/root DSH set exactly rc.5; no unrelated major drift; teammate route patch remains applicable once and detects already-applied bytes.
- [ ] Baseline/patched same toolchain and isolated environment; no prohibited network/service tests run.

**Validation:**
```bash
bun run check
```
Also run permitted offline plugin and desktop tests, declared lint and client checks. CI requires Bun 1.4.2, Node 22; local default Bun absent from PATH and Node 26 are not substitutes. Acquire exact tooling privately if possible; missing artifacts block readiness. Do not run boot-check or service-launching teammate-model fixtures. Record those gates as missing, not passed.

**depends-on:** Group 1

### Group 3: Impact assessment and independent final review

**Goal:** Persist attributable change/impact/opportunity and readiness evidence.

**Deliverables:**
1. `docs/research/dsh-rc5-upgrade.md` and this wish record.
2. Optional proven-required compatibility updates limited to locale reference generator/snapshot and patch documentation/metadata; no product behavior changes without new preflight.

**Interfaces:**
- Consumes: immutable rc4..rc5 diff, local call-site reads and gate outputs.
- Produces: exact branch/head, source-only status, independent verdict and publication handoff.

**Acceptance Criteria:**
- [ ] Report covers requested upstream categories and held issues with source citations and verified/inferred/unknown labels.
- [ ] Final reviewer has not authored retained design/patch; reviews immutable commits in order and locks/generated artifacts.

**Validation:**
```bash
bun run check
```
Final `git diff --check` and independent read-only review supplement, not replace, aggregate gates.

**depends-on:** Group 2

## QA Criteria

- [ ] Offline root/plugin/desktop gates, lint, generated-client checks and patch applicability complete.
- [ ] Real provider/model route + cold resume, MCP fixture, sidebar integration and desktop assembly are demonstrated or explicitly blocked/skipped with exact reason.
- [ ] No user's installed data/profile touched; no app/service launched. No claim of app installation or live-loaded rc5.

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| User restrictions prevent complete CI boot/headless evidence | High | Preserve missing prerequisite explicitly; do not claim source ready/SHIP. |
| Transitive ranges may resolve new packages | High | Compare complete before/after lock and reject unintended major drift. |
| Reasoning body text changes meaning | Medium | Audit all shipped slot consumers and unchanged seams; rawText migration only if required. |
| Existing repair consumption unavailable | High | No speculative repair rounds; record history/source, never reset held tracks. |

## Review Results

Blind criteria received from independent-reviewer before repository inspection on 2026-10-30: provenance, fresh base/tooling, compatibility, bounded scope, CI-equivalent baseline/patched gates, affected seams/generated artifacts, immutable delivery, bounded repair accounting. SHIP requires all gates; missing evidence is BLOCKED.

2026-10-30 independent-reviewer preflight: BLOCKED for full readiness because explicitly prohibited service/headless gates cannot run; bounded source preview not rejected, and no new authorization granted. Parent proceeds only with the original user's authorized source preview, never claims plan SHIP or merge-ready. Reviewer requested exact command matrix/tool identity, necessity-proven optional locale scope and no repair with unknown historical consumption.

Preflight dispositions: Node v22.23.4 from nodejs.org official tarball verified SHA256 c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428; Bun1.4.2 @oven/bun-darwin-aarch64 artifact verified SHA512 MXdZkP1featqxZ+/VTXWG1BVjM4OGBehVY2Q88EeUj/7L0UMeCGItmyPYTN+wxvlGJ6F66JEtzsw+GvQWewnag==. Both extracted only under ignored .cache/rc5. Optional locale writes removed from execution: rc4 dictionary fixture remains, with unchanged-source evidence to be reported. No repair rounds will be dispatched while historical consumption is UNKNOWN. Configured B=2 from logged CLI output; prior sidebar/draft/memory counters remain separate.

Frozen command matrix, identical baseline/upgraded toolchain and checkout-private environment:
- Root: bun install --frozen-lockfile --ignore-scripts; bun run check (version check, scripts tests, local git-backed market check; no boot script invoked).
- Each of 12 plugins: bun install --frozen-lockfile; existing harness dependency set from bots-dsh/dev/harness shared through canonical DSH_HARNESS; bun run lint; node scripts/build-client.mjs --check when present; Node --import test/harness-resolve.mjs --test over explicitly selected offline test files. Declared bun run test is NOT claimed complete where a file is excluded.
- Excluded complete files: bots-dsh/test/{teammate-models,mock-llm,web-search}.test.js; unfold-events-dsh/test/{events,channel}.test.js; unfold-session-dsh/test/control.test.js; unfold-capabilities-dsh/test/capmap.test.js. These contain direct HTTP/TCP listeners or headless launches. Other tests are guarded against network listeners/connections. In-memory route.fetch calls do not launch services.
- Desktop: npm ci --no-fund --no-audit (Electron binary download disabled); npm test, with network listener/connect guard. No prepare-runtime command: it installs a profile, resolves external add-ons and invokes DSH CLI. Offline runtime patch applicability/idempotence is checked on disposable copied package artifacts instead.
- Forbidden/unrun: node scripts/boot-check.mjs --shot boot.png; real teammate model route+cold resume test; app/server launch, browser/GUI, full packaged desktop build. Full gates remain BLOCKED regardless of permitted subset results.
- Guard lives only in ignored validation scratch and is loaded only for tests, not production or installs. No source tests are weakened; guard failures are failures. Root/package install lifecycle and scripts are inspected before invocation.

## Files to Create/Modify

```
.genie/wishes/upgrade-dsh-to-rc5-and-assess-upstream-c/WISH.md
docs/research/dsh-rc5-upgrade.md
package.json
bun.lock
apps/desktop/runtime/package.json
apps/desktop/runtime/package-lock.json
apps/desktop/runtime/patches/patches.json
apps/desktop/scripts/follow-dsh.mjs
apps/desktop/test/follow-dsh.test.js
apps/desktop/docs/DEVELOPMENT.md
apps/{bots,welcome,locale-pt-br,unfold-bridge,unfold-bot,unfold-sse,unfold-events,unfold-capabilities,unfold-settings,unfold-mind,unfold-trajectory,unfold-session}-dsh/package.json
apps/{bots,welcome,locale-pt-br,unfold-bridge,unfold-bot,unfold-sse,unfold-events,unfold-capabilities,unfold-settings,unfold-mind,unfold-trajectory,unfold-session}-dsh/dev/harness/package.json
```
