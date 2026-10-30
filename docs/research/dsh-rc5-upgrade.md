# DSH rc.5 source upgrade: impact, opportunities and readiness

Owner: **Automagik**. Assessment date: **2026-10-30 UTC**.

**Status: source preview only; readiness BLOCKED.** This is not an app installation, a release, a PR, or proof of what the running app loaded. Required service-dependent coverage is prohibited by this wish and remains unverified. No migration ran against installed state; no profile, credentials, permission defaults or user drafts were changed.

## 1. Provenance and actual baseline

| Layer | Observed baseline / target | Evidence |
|---|---|---|
| Automagik source | `3.51.6`, baseline `e883d2253195c9bd91ec758a3e807746075ee208` | Supplied isolated branch; `git status --short --branch`, `git log`; [root manifest](<package.json>) |
| Fresh upstream Automagik dev | `e883d2253195c9bd91ec758a3e807746075ee208` | `git ls-remote https://github.com/automagik-dev/automagik.git refs/heads/dev`, retrieval 2026-10-30T21:44Z, equal to source base |
| Actual DSH source dependency baseline | `0.2.1-rc.4` | [desktop runtime manifest](<apps/desktop/runtime/package.json>), baseline Git bytes of its [lock](<apps/desktop/runtime/package-lock.json>); all twelve harness manifests and root market parser agreed |
| Published baseline source | `504a01a9578abc2c6f1fb896b1dc322c9fe24f66` | Official tag `dsh-v0.2.1-rc.4`, resolved with `git ls-remote --tags` |
| Published target source | **`0.2.1-rc.5`**, **`b830ec950faba0a46dda564be3e2d854afed94f1`** | [Official release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5), published **2026-10-30T02:12:26Z**; exact tag resolution agrees with release target |
| Published target package | `@deepseek-ai/dsh@0.2.1-rc.5` | [First-party npm registry metadata](https://registry.npmjs.org/@deepseek-ai/dsh/0.2.1-rc.5), retrieved 2026-10-30T21:45Z; immutable tarball and integrity below |
| Desktop profile/add-ons | Unchanged source pins, not reinstalled | [profile manifest](<apps/desktop/profile/package.json>): subscriptions commit `2eff034ede95c9d06ecee290517101e6419c7fee`; Claude commit `f6e9158f71031cf3a3abbf9c805263792cad7d11`; [Omni pin](<apps/desktop/omni.json>) `2.261030.5` / `4a0acf2d4b18258545d2ef05256a1c9438838ff6` |
| Installed app metadata / live-loaded runtime | **Not inspected / UNKNOWN** | No app-state reads or live process introspection performed. Source pins, published availability, integration and installed/loaded versions are different claims. |

Target artifact: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.5.tgz`.

Target SRI: `sha512-WkyJZv4zl9sCAxSzRctGm58m0rilGqwR6pniBiLOz5CPDfHfDuAUicg0AAazXI7oj/Cph6/cjNTncA/rpLTXpw==`.

Baseline CLI SRI, from actual baseline lock: `sha512-8gxl6zOi6vx1sDolH+vjh9txrpbXD+t74Z2YfWkEBtR3xP2YEtk0bbLkgLZRnYQgDxCoXitXyXDKn5k0+6iXrg==`. Registry metadata does not supply a `gitHead` proving a reproducible package build: the official tag/release identifies source, while tarball SRI pins the independently retrieved published package. No unsupported source-to-binary attestation is claimed.

The target is **not master**, `0.2.2-alpha.2`, a stable substitute, or a guessed installed version. No duplicate rc5 wish/design history or open PR was found in this copy / read-only forge searches. Related merged [PR #35](https://github.com/automagik-dev/automagik/pull/35) owns the all-pin tooling; [PR #160](https://github.com/automagik-dev/automagik/pull/160) separately pinned the Claude default source.

## 2. Exact upstream delta

[Immutable published rc.4 → rc.5 comparison](https://github.com/deepseek-ai/deepseek-harness/compare/504a01a9578abc2c6f1fb896b1dc322c9fe24f66...b830ec950faba0a46dda564be3e2d854afed94f1).

Four commits, in order:

1. `083bdcf6252e46183c35810798ceee78b1f77a47` — merge rc.4 release metadata.
2. **`534dac8c81662689169fcca12c52066c59a57058`** — **customize thinking-block rendering**.
3. `31cfe2aafead959a4dbd9d8cfaae258eb28a19fd` — release rc.5.
4. `b830ec950faba0a46dda564be3e2d854afed94f1` — merge rc.5 release.

The comparison API's 300-file response is truncated by its file limit, so it is not sufficient evidence of absence. The research reader additionally compared both recursive Git trees (`truncated=false`, 18,816 / 18,823 entries) and paginated release commits: **368 changed blobs = 349 package manifests + 19 non-package files**. All 19 non-package files belong to the single behavior commit: six docs/i18n files, seven source files and six test/fixture files. Primary endpoints: [baseline tree](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/504a01a9578abc2c6f1fb896b1dc322c9fe24f66?recursive=1), [target tree](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/b830ec950faba0a46dda564be3e2d854afed94f1?recursive=1), [behavior commit](https://api.github.com/repos/deepseek-ai/deepseek-harness/commits/534dac8c81662689169fcca12c52066c59a57058). Retrieval: 2026-10-30T21:48:49Z–21:51:05Z.

### Impact matrix

“Unchanged” below means **no implementation change in the complete published source interval**, not a passing runtime test or a guarantee about previously buggy behavior.

| Category | Upstream evidence / what changed | Automagik seam and action | Verification / uncertainty |
|---|---|---|---|
| Breaking/API behavior | [Reasoning body contract](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-chat/src/client/contract/slots.ts#L78-L96): new required `rawText`; existing `text` becomes display-ready. Content Factory still accepts selected `text`, `running`, optional labels. | Audit shipped slot consumers; no direct `conversation.chat.reasoning.body`/content consumer found in Automagik source. Future wrappers needing model-original text must use `rawText`, not double-process display text. | Verified source API change; not a persistence schema migration. [Official migration guide](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props/guide.md#L10-L20) is misleadingly under an rc.4 directory but introduced in this rc.5 delta. |
| UI/reasoning and reliability | [reasoningText](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-chat/src/client/reasoning-text.ts#L8-L23) removes **only an exact leading** `<signature>…</signature>`, hides partial opening/missing closing payload, skips following LF/CRLF. [ReasoningRow](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-chat/src/client/chat/ReasoningRow.tsx#L49-L81) filters collapsed/expanded text and hides transformed-empty rows. | Native upstream reasoning rows gain filtering. Automagik's [assistant-step override](<apps/bots-dsh/src/client/index.js#L1002>), [custom ThinkingRow](<apps/bots-dsh/src/client/cells.js#L186-L220>) and [raw block concatenation](<apps/bots-dsh/src/client/turn-reasoning.js#L4-L27>) bypass that implementation. **Do not claim the custom Bot view is fixed.** | Verified call-site gap, potential metadata display exposure inferred from source; not live reproduced. No feature fix included. Leading whitespace/arbitrary tags are not sanitized. |
| UI/Live process detail/extensions | [process activity](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts#L96-L110) applies the same filter to running reasoning detail. [Slot catalog](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts#L403-L444) reflects new props. | Native DSH process details/extensions affected; [Automagik sidebar registration](<apps/bots-dsh/src/client/index.js>) and Unfold event projections remain on their existing interfaces. | Source compatibility audit only for sidebar/Live; no browser/server fixture permitted. This is not a new extension execution feature or retention fix. |
| Translation | [TranslationBody](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/client-ui-cot-translation/src/client/TranslationBody.tsx#L30-L59) inherits display-text semantics for requests and untranslated view; runtime-file delta is a comment, contract/input change is real. | Profile carries upstream bundle, but no local translation wrapper needed migration. Never send `rawText` to translation solely to restore previous display behavior. | Verified source semantics; no translation-provider/network calls executed. |
| Composer/drafts/input lifecycle | No implementation changes beyond reasoning rendering in this interval. | [Bot composer/draft source](<apps/bots-dsh/src/client/index.js>); #141 remains separate. | Unchanged source, not a crash/draft-recovery test. |
| Agent Teams/model routing | Team/tool-team implementations unchanged; package versions moved. | Keep [teammate patch](<apps/desktop/runtime/patches/teammate-models.patch>); [runtime guards](<apps/desktop/scripts/runtime-patches.mjs#L75-L98>) otherwise reject old version metadata. Existing owner tooling now retargets **version fields only**, preserving all hashes/hunks. | Patch applicability/idempotence evidence below; full real route/cold-resume fixture prohibited. Do not remove patch or claim upstream parity. |
| Tools/MCP/OAuth/authorization | No corresponding implementation changes. | [capabilities](<apps/bots-dsh/src/host/capabilities.js>), [profile add-ons](<apps/desktop/profile/package.json>); retain existing auth flow and credential provenance. | No OAuth login, MCP network service or credential access. #162 not fixed by this release. |
| Permission modes / Claude bridge | No corresponding implementation changes. | [permission adapter](<apps/bots-dsh/src/host/permissions.js>) and Claude source pin unchanged. No Bypass/never/auto-review activation. | Offline existing permission tests attributable below; no live Claude/default claim. |
| Persistence/resume/usage/context/memory/checkpoints | No corresponding implementation changes; all relevant manifest versions move with the release. | [memory](<apps/bots-dsh/src/host/memory.js>), [usage](<apps/bots-dsh/src/host/usage.js>) and native/session hooks retained. No new migration written or run. | Existing offline fixture evidence only; installed session compatibility/cold resume remains unverified. |
| Performance | No measured performance change in the one behavior commit. | No speculative caching/refactor or benchmark added. | **No zero-overhead, latency, token-cost or throughput claim.** |

Upstream changed tests are evidence of intended behavior, not fresh execution here. [Ordinary reasoning unit cases](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/client/ui-chat/tests/reasoning-text.client.spec.ts#L4-L13) do not exercise signature branches (those carry a v8-ignore comment). [Web fixture](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/apps/web/tests/reasoning-preview.e2e.ts#L124-L150) covers full signature prefix while collapsed/open/streaming; running it would launch a forbidden server. [Translation fixture](https://github.com/deepseek-ai/deepseek-harness/blob/b830ec950faba0a46dda564be3e2d854afed94f1/packages/experimental/client-ui-cot-translation/tests/translation-body.client.spec.tsx#L27-L38) distinguishes display from raw text.

## 3. Owning source inventory and integration decisions

- [follow-dsh tooling](<apps/desktop/scripts/follow-dsh.mjs>) owns runtime pin/lock plus twelve plugin engine floors and exact harness pins: bots, welcome, locale-pt-br, unfold bridge/bot/sse/events/capabilities/settings/mind/trajectory/session. Its existing `--all` transaction is used, not hand-edited manifests.
- Root [manifest](<package.json>)/[Bun lock](<bun.lock>) separately own the market parser; moved with `bun add --dev --exact @deepseek-ai/dsh-plugin-market-index@0.2.1-rc.5`.
- [Runtime lock](<apps/desktop/runtime/package-lock.json>) is generated by the declared owner’s `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Runtime pnpm `10.34.6` and zod `4.4.3` must stay fixed unless exact upstream requirements prove otherwise.
- Plugin Bun locks contain no exact rc.4 DSH pins; their intentionally unversioned peers remain supplied by DSH. Frozen plugin installs must not rewrite those locks. Harness installs follow declared `--no-save` policy, rather than inventing committed harness locks.
- [Profile bundle names](<apps/desktop/profile/package.json>) are unversioned names resolved from the pinned runtime, not independent rc.4 pins. Profile overlays and reviewed addon/Omni commits unchanged. No IDs/routes/storage prefixes/team-home/public API rename.
- [Patch metadata](<apps/desktop/runtime/patches/patches.json>) retains both before/after SHA256 values and exact hunks. Tool version retargeting is **not proof of patch compatibility**: exact-byte checks still fail closed. No permission bypass was added. The patch is not upstream in rc.5.
- Locale [copy-check reference](<apps/locale-pt-br-dsh/scripts/copy-check.mjs#L19>) deliberately remains the rc.4 English fixture: the complete upstream delta has no dictionary change. Locale/generated checks are run; no invented rc.5 snapshot or translation churn. Existing README “tested rc.4” statements remain historical validation statements, not silently promoted to a claim of full rc.5 verification. Historical release/market index and compatibility test examples are not runtime pins and remain unchanged.
- Packaging [prepare-runtime](<apps/desktop/scripts/prepare-runtime.mjs#L95-L119>) checks Bot exact pin and carried Omni compatible engine range before assembly; it is not executed here because it installs a disposable profile and invokes DSH CLI/addon resolution. Actual packaged build remains a promotion prerequisite.

## 4. Existing issues: what rc.5 does not prove

Read-only issue evidence retrieved 2026-10-30T21:48Z–21:51Z; all below were OPEN, no comments. Issue bodies are reports, not freshly reproduced results. Private identifiers/content omitted.

| Existing track | Attributable conclusion |
|---|---|
| [#141 drafts](https://github.com/automagik-dev/automagik/issues/141) | Reasoning-only delta does not address ephemeral-origin draft persistence. No crash/draft deletion experiment; exhausted planning budget not revived. |
| [#162 MCP auth](https://github.com/automagik-dev/automagik/issues/162) | Report distinguishes configuration save from HTTP401 auth failure; no MCP/OAuth implementation changed. Root cause still unknown; no login or auth fix claimed. |
| [#161 rendering](https://github.com/automagik-dev/automagik/issues/161) | A thinking display fix is not evidence that blank historical conversation bodies are fixed. Missing root cause and attributable reproduction/test remain open. |
| [#164 stopped wish retention](https://github.com/automagik-dev/automagik/issues/164) | No task/Live retention change. Disappearing UI entries are not proof of deleted sessions or checkouts. No retention-policy change implemented. |
| [#166 memory review](https://github.com/automagik-dev/automagik/issues/166) | No memory/checkpoint behavior change. Reported no-op/limit symptoms remain unproven causes; exhausted memory budget not reset. |
| Claude defaults / [PR #160](https://github.com/automagik-dev/automagik/pull/160) | Existing reviewed Claude Auto source commit retained. No upstream Claude change in this interval. [#120 task permissions](https://github.com/automagik-dev/automagik/issues/120) is a distinct open source-analysis report, not proof about Claude adapter defaults. No default-permission widening. |

## 5. Ranked opportunities (recommendations only)

| Rank | When | Opportunity / enabling change | Cost / risk / authorization |
|---|---|---|---|
| 1 | NOW, review-only | Audit custom Bot thinking rendering against upstream display-text semantics. rc.5 exposes an explicit raw/display boundary and exact-prefix sanitizer, but our custom assistant-step bypasses it. | Small investigation + focused offline renderer tests; medium UI regression/security-presentation risk. **New authorization required for implementing behavior changes**, particularly anything conflated with held #161. Not implemented here. |
| 2 | NOW, upgrade gate | Retain/revalidate teammate patch and exact package artifacts; keep version tooling from leaving obsolete patch guards behind. | Small source/tooling adjustment already scoped to this upgrade; medium packaging risk. Full route/cold-resume fixture and assembled desktop remain missing promotion evidence. |
| 3 | NOW, offline QA | Deterministic streamed/settled signature, partial prefix, absent closer, ordinary tag/whitespace and raw/display-wrapper coverage is **already authorized by this wish**, not a future authorization request. | Extracted compiled-function coverage was added during validation (details below). Retained runnable regression coverage and full mounted integration remain missing; upstream unit coverage excludes signature branches. No paid models needed. |
| 4 | LATER | Prefer documented reasoning body/content extension seams over maintaining a shadow rendering pipeline, if product requirements permit. | Medium design/migration cost; high risk to Bot visuals/slots. Separate reviewed design, compatibility and build/UI authorization; not a mandatory rc.5 fix. |
| 5 | LATER | Revisit drafts, MCP auth, blank rendering, stopped retention and memory with their own attributable reproductions. | Separate held-track budget/decision and test authorization. rc.5 supplies no backend implementation that resolves them; no automatic reopening or repair extension. |

## 6. Validation, review and publication

Toolchain acquired **inside this checkout only**, no system tool installation:

- Bun **1.4.2**, official npm `@oven/bun-darwin-aarch64@1.4.2`; SHA512 `MXdZkP1featqxZ+/VTXWG1BVjM4OGBehVY2Q88EeUj/7L0UMeCGItmyPYTN+wxvlGJ6F66JEtzsw+GvQWewnag==`; retrieved `2026-10-30T21:48:21.918Z`.
- Node **v22.23.4**, [official tarball](https://nodejs.org/dist/v22.23.4/node-v22.23.4-darwin-arm64.tar.gz); SHA256 `c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428`; [official checksums](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt); retrieved `2026-10-30T21:48:26.095Z`.
- Host platform macOS arm64, not CI Ubuntu. CI declares Node22/Bun1.4.2 ([CI](<.github/workflows/ci.yml#L55-L61>)); Bot README separately mentions Node24, a documentation mismatch not repaired here. Default host Node26/Bun1.3.14 were **not** substituted for the matrix.

Both matrices use the same exact binaries, canonical realpath harness, checkout-private HOME/TMPDIR/XDG/npm/Bun cache; tests receive a strict environment allowlist, `DO_NOT_TRACK=1`, telemetry disabled, no app flags, no inherited credentials. `OMNI_CLIENT_ID` and `DS_BOT_APP` are absent only in test environment; production identity is not changed. A test-only preload denies TCP/TLS connection/listen and global network fetch. This is not a product permission change and guard failures are reported, not waived.

Declared root install/check: `bun install --frozen-lockfile --ignore-scripts`; `bun run check` = version check + `bun test scripts` + local Git-backed marketplace check. Each plugin: frozen install, canonical shared harness from the declared Bot harness package, declared lint, generated-client `--check` where present, Node test runner with the manifest's actual preload policy. Desktop: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-fund --no-audit`; `npm test`.

Complete files excluded **before execution**, because they directly start HTTP/TCP/headless model fixtures:

```text
apps/bots-dsh/test/teammate-models.test.js
apps/bots-dsh/test/mock-llm.test.js
apps/bots-dsh/test/web-search.test.js
apps/unfold-events-dsh/test/events.test.js
apps/unfold-events-dsh/test/channel.test.js
apps/unfold-session-dsh/test/control.test.js
apps/unfold-capabilities-dsh/test/capmap.test.js
```

Other helpers attempted listeners and were denied before binding; those tests remain red. No source test was patched or marked skipped to manufacture a green suite. The first baseline runner incorrectly added a nonexistent harness preload to four packages; its failed setup logs were preserved, the scratch runner was corrected to read each package’s declared test script, and the baseline rerun completed **before source edits**. Those setup failures are not product regressions or upgrade repair rounds. A failed `/usr/bin/realpath` discovery (not present on host) was replaced by Node’s `realpathSync`; canonicalization was not weakened.

**Not run:** full unfiltered plugin suites, real teammate provider/model follow-ups+cold resume, supported network MCP fixture, upstream browser reasoning fixture, real sidebar mount/browser proof, complete native/core integration, `boot-check`, `prepare-runtime`, Electron/package build, app startup, live/paid models. These are **blocked/missing**, not passed. Existing in-memory permission/session tests do not substitute for full native integration.

Repair accounting: `genie config get budgets.maxEscalationsPerGroup` returned **2**; no matching prior upgrade wish/design/ledger found, so historical consumed attempts remain **UNKNOWN**, not zero. No repair round is dispatched under that uncertainty. Existing #141/#166/brainstorm/full-inheritance/wakeup holds remain untouched. Initial plan lint failed once on required Design spelling, then passed; this was plan structure, not a reset of any held budget. Native procedural execution has no saved-workflow accounting record or fabricated run ID.

Independent reviewer was given criteria **before repository access**, then read only the plan. Preflight verdict **BLOCKED for full readiness**, not a grant of new authorization; source preview proceeds solely under this wish’s explicit authorization. Final immutable review and exact gate results are recorded below when available. No reviewer authored retained design or patches.

### Attributable gate results

Counts are Node runner summaries, **pass / fail / skipped**. Excluded files above are additional missing coverage, not included in these counts. No cancelled tests reported.

| Gate | Baseline rc.4 | rc.5 source preview |
|---|---:|---:|
| Root aggregate | exit0; 41/0 | **postcommit exit0; 41/0**, marketplace 6 OK (precommit failure retained below) |
| bots | exit1; 1397/5/2 | exit1; 1397/5/2 |
| welcome | exit0; 171/0/1 | exit0; 171/0/1 |
| locale-pt-br | exit0; 18/0/0 | exit0; 18/0/0 |
| unfold-bridge | exit1; 75/38/0 | exit1; 75/38/0 |
| unfold-bot | exit0; 15/0/0 | exit0; 15/0/0 |
| unfold-sse | exit0; 13/0/0 | exit0; 13/0/0 |
| unfold-events | exit0; 70/0/0 | exit0; 70/0/0 |
| unfold-capabilities | exit0; 2/0/0 | exit0; 2/0/0 |
| unfold-settings | exit0; 40/0/0 | exit0; 40/0/0 |
| unfold-mind | exit0; 140/0/0 | exit0; 140/0/0 |
| unfold-trajectory | exit0; 71/0/0 | exit0; 71/0/0 |
| unfold-session | exit0; 118/0/0 | exit0; 118/0/0 |
| Desktop | exit1; 95/2/0 | exit1; 97/2/0 (two new tooling tests passed) |
| Frozen root/plugin installs + desktop npm ci | all exit0 | all exit0 |
| Twelve plugin lints | all exit0 | all exit0 |
| Ten existing generated client checks | all exit0 | all exit0; committed bundles unchanged |
| Focused follow-dsh tests | existing suite in desktop run | exit0; 10/0/0 |

The baseline and preview still have **45 guard-denied failures**: five Bot root-session tests through fake-control listeners, 38 bridge tests through bridge listeners, and two desktop startup/freePort tests. Full names and stack output were compared, not only counts. No product fix for these inherited failures is attempted.

Representative actual failure output (same reason before and after):

```text
not ok - the first message in the Unfold root Session reaches Unfold once and stays in that Session
error: RC5_ISOLATED_OFFLINE_GUARD: network/service operation prohibited
  Server.deny [as listen]
  apps/unfold-session-dsh/test/fake-control.js:103

not ok - binds 127.0.0.1 only, on a port of its own
error: RC5_ISOLATED_OFFLINE_GUARD: network/service operation prohibited
  apps/unfold-bridge-dsh/src/host/bridge.js:92

not ok - dsh starts on the given loopback port, its URL resolves, and stopping ends it
error: RC5_ISOLATED_OFFLINE_GUARD: network/service operation prohibited
  apps/desktop/src/dsh.js:385
```

Precommit root check really failed one Git-backed fixture:

```text
(fail) market index > a commit that holds the package passes
@automagik/bots-dsh@3.51.6: lists dsh >=0.2.1-rc.5 <0.2.2-0
but its package.json declares >=0.2.1-rc.4 <0.2.2-0
40 pass / 1 fail; exit1
```

That fixture compares a working-tree manifest with `git show HEAD`. The full `bun run check` rerun on immutable implementation commit **`46962004b123b093abc99b09d3232db20c461371`** completed **exit0**, 41 pass / 0 fail, version 3.51.6 everywhere and marketplace 6 plugins OK. HEAD readback was the same SHA. No test or marketplace edit was used; the precommit invocation remains recorded as failed. Remote dev was re-read at **2026-10-30T22:00:35Z** and still equaled baseline `e883d2253195c9bd91ec758a3e807746075ee208`.

Actual rc.5 package bytes were copied into disposable patch fixtures, not the app: `patchRuntime` with **version checks enabled** applied both files, a second application returned `already patched`, and deliberate tampering was rejected. Before SHA256 values exactly matched rc.4: team `b2d337d10c841773e4e69836475f5c21dce8cd87beb70d73413a7868e9403322`; tool-team `cac22fe5f83a179056469cf329def58393c7620eae23b018c66f42c37d849f63`. After hashes remain the checked-in metadata values. This proves byte/hunk compatibility and idempotence, **not** full semantic routing/resume.

An additional guarded offline fixture evaluated the actual patched route-policy helper bytes (tool-team after SHA256 `f7f2c992e0c55a701b6cb90edb74f0fcb8e45ae53e271159e1731c7a422643a6`), with a synthetic config resolver: omitted options inherit without resolution; selected provider/model picks model-default effort; explicit effort retained; fork overrides, incomplete pairs, disallowed models, invalid effort, disabled selection, and a changed live allowlist are rejected. It passed, exit0, with no network/model call. This is a helper-level fixture, **not** full tool registration, backend spawning, or cold session resume.

Runtime lock audit: **296 DSH package entries** move rc.4→rc.5, root parser also moves its DSH manifest dependency. **Zero package-major changes, zero removed runtime package paths.** The declared npm resolver additionally refreshed **25 non-DSH transitive package entries** within existing major ranges: AWS core/credential/env/http/ini/login/node/process/sso/web-identity/eventstream/middleware/nested-client/signature/xml families, two nested Smithy HTTP handlers, OpenTelemetry semantic conventions, Smithy core/signature, Node typings, encodeurl, jose and tslib. These refreshes are not attributed to a new upstream feature and are not proven necessary compatibility fixes. A scratch `--prefer-dedupe` resolution did not eliminate them and additionally downgraded fflate, so that experiment was **not retained**. Their complete versions/integrities are in the committed lock diff; they remain a supply-chain/promotion review item rather than an implicit authorization for unrelated dependency work.

### Additional affected-seam validation (no product repair)

The independent reviewer correctly flagged that offline reasoning fixtures were required by the original scope, not something needing new authorization. Additional **validation only** was run against unchanged implementation commit `46962004b123b093abc99b09d3232db20c461371`:

- Exact installed `@deepseek-ai/dsh-client-ui-chat@0.2.1-rc.4` bundle SHA256: `a00e5176d1257d51604cefbe9a15d326d4283439df31f76ba20ff690c76e10a1`.
- Exact installed rc.5 bundle SHA256: `181f766f2fe12ad27eed4f1c0cd4609e8d2211d397890355eb476b6a9ee311c2`. [Artifact lock entry](<apps/desktop/runtime/package-lock.json#L1382-L1385>) SRI: `sha512-/UzmkMvOW94RtwHNbnU36+U5syK3QBRoDYzX9n6iyb+w9PrlKjUIckGqZNZnAoEG374htpvUrrT0YPSp4BDJ+A==`.
- Fixture SHA256: `e79abb67e249bf0c18ab2768626c11fae85573f0fcd1d7f6b8aae159f46db298`, executed 2026-10-30T22:02:31.888Z. **rc.4 negative control exit1**, precisely `AssertionError: assert.ok(!JSON.stringify(collapsed).includes('synthetic-payload'))`, not a missing module or typo. **rc.5 exit0**.
- Extracted **actual published bundle function bodies**, not rewritten sanitizer logic: `reasoningText` and `ReasoningRow`, with deterministic `memo`/`useMemo` and JSX object stubs. Covers streamed/settled collapsed/expanded text, exact rawText preservation vs display text, complete/partial signature prefixes, absent closer, LF/CRLF, ordinary/Chinese/whitespace/other tags, and actual local `turnReasoning` bypass.
- **Limitations:** this is extracted-function evidence, not execution of the full shipped plugin entrypoint, mounted React DOM, disclosure lifecycle, process-activity fallback, translation runtime or browser integration. Those coverage items remain blocked/missing. No source repair or budget reset occurred. The scratch fixture remains available locally as [validation script](<.cache/rc5/check-reasoning.mjs>), [negative output](<.cache/rc5/reasoning-baseline.log>), and [positive evidence](<.cache/rc5/reasoning-evidence.json>); they are ignored checkout-private artifacts, not promised committed regression tests. The durable report records inputs, exact identities, assertions and limitations so the finding is not tmp-only.

### Independent lock metadata finding

The initial lock audit counted version changes only. Independent review and a separate all-field comparison also found **20 unchanged-version native optional entries lost their `libc` selector arrays** in npm's generated lock. This broadens recorded platform eligibility; actual Linux/glibc/musl install effects are **UNKNOWN**, not a demonstrated failure. No Linux CI or assembled desktop build was run. No permission-mode change is implied, but this is a real supply-chain/platform compatibility review item and an additional reason not to promote this preview. No manual lock repair was made under unknown historical repair consumption.

Exact entries (prefix `node_modules/` omitted):

```text
@img/sharp-libvips-linux-arm         1.3.4  removed [glibc]
@img/sharp-libvips-linux-arm64       1.3.4  removed [glibc]
@img/sharp-libvips-linux-ppc64       1.3.4  removed [glibc]
@img/sharp-libvips-linux-riscv64     1.3.4  removed [glibc]
@img/sharp-libvips-linux-s390x       1.3.4  removed [glibc]
@img/sharp-libvips-linux-x64         1.3.4  removed [glibc]
@img/sharp-libvips-linuxmusl-arm64   1.3.4  removed [musl]
@img/sharp-libvips-linuxmusl-x64     1.3.4  removed [musl]
@img/sharp-linux-arm                0.35.5 removed [glibc]
@img/sharp-linux-arm64              0.35.5 removed [glibc]
@img/sharp-linux-ppc64              0.35.5 removed [glibc]
@img/sharp-linux-riscv64            0.35.5 removed [glibc]
@img/sharp-linux-s390x              0.35.5 removed [glibc]
@img/sharp-linux-x64                0.35.5 removed [glibc]
@img/sharp-linuxmusl-arm64          0.35.5 removed [musl]
@img/sharp-linuxmusl-x64            0.35.5 removed [musl]
node-addon-require-builtin-linux-arm64-gnu  0.1.9 removed [glibc]
node-addon-require-builtin-linux-arm64-musl 0.1.9 removed [musl]
node-addon-require-builtin-linux-x64-gnu    0.1.9 removed [glibc]
node-addon-require-builtin-linux-x64-musl   0.1.9 removed [musl]
```

### Independent review disposition

Reviewer: `independent-reviewer`, genuinely uninvolved author, read-only. Criteria were frozen before repository inspection. Target implementation SHA: **`46962004b123b093abc99b09d3232db20c461371`**. Reviewer inspected chronological commit/cumulative source, lock and unchanged generated artifacts plus attributable logs; did not author retained design/patch or run tests.

**Verdict: BLOCKED**, never SHIP. Full native/plugin/desktop integration remains missing; same-baseline red tests are not passes. Reviewer found and Lead independently confirmed the 20 `libc` selector removals. Initial HIGH “missing affected reasoning offline fixture” was **closed at extracted-function/stub level** after reviewer checked actual bundle regions, both bundle hashes, fixture hash and negative/positive outputs. That closure is not a mounted/shipped-entrypoint integration pass. Scratch fixture is not a committed regression test. Provenance/fresh-base evidence is identified as Lead/research primary-source retrieval, not reviewer-run remote verification.

No product repair round was dispatched with unknown historical consumption. Remaining decisions: establish legitimate repair accounting, assess/minimize resolver-driven transitive/platform metadata changes, and arrange authorized isolated full integration/CI coverage before promotion. Do not widen live permissions, install/restart the user's app, or revive held features to close these gaps. Final source/evidence commits are local only; see branch/head handoff in the final response.

Measured source diff before adding these notes: 32 modified files, +2389/-2409 (runtime lock dominates). With plan/report, the complete change exceeds the single-unit 25-file/2000-insertion wish band; it is explicitly a multi-group **blocked preview**, not a falsely admitted single green wish.

Publication restriction: origin push URL is deliberately `/dev/null/genie-wish-copies-push-nowhere`. **No push route; no PR created.** Do not alter that remote. A legitimate operator must publish the exact reviewed commit to a new scoped branch/PR targeting dev, inspect remote head/base/files/changed lines/comments/checks, and complete missing promotion gates before considering a merge. Source commit ≠ PR ≠ release ≠ installed/loaded app.
