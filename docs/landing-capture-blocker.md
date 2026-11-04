# Landing repair — blocked before implementation

This is a blocker record, **not a repaired landing page or delivery claim**.

> **Resolved on this branch.** The runtime expectation in `apps/bots-dsh/dev/advanced-check.mjs`
> now follows the declared runtime (0.2.1-rc.5). `apps/landing/capture/capture.mjs` provisions
> the real Bot team, welcome and Genie plugins at their pinned sources in an owned fixture,
> seeds the fictional Northwind scenario, asserts each state and captures it. Omni at work is
> still not captured, and the page leaves it out. Provenance: `apps/landing/assets/CAPTURES.md`.
> The record below is kept as it was written.

## Source and ownership

- Starting HEAD: `c9b1625eff458b70b2096aa1fcc8192e3ef1d127`; working branch: `wish/make-landing-page-show-the-actual-produc`.
- Authorized predecessor `wish/build-automagik-launch-landing-page` ends at `7f4fb5076cf947677ee86bb9c0e7fb712bd04912`, following implementation `c8a559e`.
- The rejected redesign is `7a7155132c219f1a0a705a68717a14e6da2cd4a1`, reachable through `origin/wish/deliver-landing-redesign-preview`. It was read, not cherry-picked, edited, or published.
- Actual http://127.0.0.1:4178/ is served by Python PID 46234, parent 49044, from the separate `deliver-landing-redesign-preview` worktree. Its actual `apps/landing/index.html` was read. This is not the current worktree, where `apps/landing` is absent.
- The lead was the only writer here; the independent investigators/reviewer were read-only. No ownership of the existing server or permission to edit its worktree was assumed. The server and both predecessor branches remain unchanged.

## Fresh browser comparison

A fresh headless Chrome context inspected the actual preview and https://deepseek.com/en/harness/ at 1440 × 1000. Inspection-only screenshots are in ignored `.cache/inspection/rejected.png` and `.cache/inspection/reference.png`; neither is a new repaired-page deliverable.

The current page has exactly two image elements: the logo and `product-team.png` (980 × 720). Both loaded. Its large product image is the welcome screen's “Grow your team” card with powered-off Omni and Genie. The Build and Connect sections are copy only. There is no project coordination, wish thread, branch, change report, or communications screenshot. The page itself explicitly says those captures are absent. Layout polish or a passing image-load assertion cannot close this content failure.

The reference visibly places a recognizable conversation/workspace beneath its hero. Browser-extracted content also demonstrates plugin creation, a code diff, a recurring reminder, and execution traces beside concrete explanations. The reference's below-fold animations had not activated in the initial full-page capture, so that image alone is not complete below-fold visual evidence.

## Asset provenance and concrete capture gap

1. `7a71551:apps/landing/capture-entry.js` directly imports the shipped welcome `TeamStep` and real styles. Its fetch override supplies synthetic in-memory onboarding responses and rejects unknown endpoints. This establishes a reasonable source route for an authentic **welcome component**, not a working team/project/wish demonstration. Its runner captures only `.oai-card`.
2. The supplied launch-film README says its app screens are **rebuilt in HTML**. They cannot satisfy the request for actual shipped UI screenshots. The supplied demo assets include branding, mascots, audio, and unnamed images; there is no inspected provenance establishing the unnamed images as synthetic, privacy-safe product captures. They were not published or treated as safe merely because they exist. The protected film/take assets were not modified. A filename search for Northwind in the supplied GTM tree found no named evidence; that does not establish that no differently named rehearsal exists.
3. `apps/bots-dsh/dev/advanced-check.mjs` is the best existing isolated-runtime foundation: explicit relocated homes, an allowlisted environment, an empty owned child cwd, a fresh browser profile, and network fencing. However, line 23 asserts runtime `0.2.1-rc.4`, while its declared harness and plugin engine require rc.5. Its Bot scenario installs the Bot plugin and a test probe, not the actual Genie or Omni plugins. Its screenshots are failure diagnostics, not successful product-state captures. Its interactions do not seed a Genie project/wish with a branch and delivery report.
4. `scripts/boot-check.mjs` was inspected but not executed: it inherits the environment, can fetch/install Omni, and accepts welcome OR team. Running it unchanged would not establish the requested isolation or screen acceptance. `dev/ui-shots.mjs` expects a bench login or desktop attachment and must not be pointed at a live profile.

**Missing asset prerequisite:** authenticated-by-provenance screenshots of actual Automagik team/project work and actual Genie wish/branch/report UI, rendered from real plugin sources in a newly owned synthetic profile. Omni communication/reminder screenshots require the relevant real plugin and a verified synthetic scenario too; they must be omitted rather than claimed without proof. No such successful capture was produced in this run.

This is unfinished fixture/scenario engineering and missing visual evidence, **not evidence that the user denied access**. Isolated fixture work is already authorized. No live session, credential, personal conversation, or channel access is needed or requested. A continuation must align a dedicated capture fixture with rc.5, provision pinned real Genie/Omni sources as needed, seed synthetic scenarios through supported services, assert the intended successful states, and capture them before changing the page. Do not reuse test-probe UI, redraw screenshots, or remove acceptance requirements to make a check pass.

## Checks and publication

- Root frozen dependency installation succeeded with existing Bun 1.4.4 after its cache access was approved. The initial sandbox-denied attempt failed; no denial bypass was used.
- The repository's declared harness install also succeeded. Missing Bun, Playwright, or DSH packages are **no longer current blockers**.
- `bun run check` (existing Bun directory prepended to PATH): exit 0; version consistency passed; 41 tests passed, zero failed; marketplace validated six plugins. This validates the unchanged baseline, not a landing repair.
- Read-only remote inspection confirmed `publish/dev` is `c9b1625eff458b70b2096aa1fcc8192e3ef1d127`; neither authorized wish branch had a remote head. The only returned open PR was unrelated #176 targeting dev. Logged-in `gh` is available. No authentication failure is alleged.
- No new public landing screenshots, responsive/link checks on a repair, changed preview URL, SHIP verdict, push, PR, merge, release, or deployment is claimed. Publication is withheld because the requested screen evidence and implementation are absent, not because repository tests or GitHub authentication failed.
- The accountable Automagik owner has not reviewed new repaired screenshots: none exist. User visual acceptance remains outstanding.

## Independent acceptance review

Reviewer `ae8e9005-8c21-48ca-844c-2f237b8855d8`, a separate read-only agent, froze criteria before inspecting artifacts and returned **FIX-FIRST**. Target: unchanged baseline `c9b1625` plus predecessor `7a71551` and the fresh inspection screenshots, not a newly implemented landing. The reviewer directly read both images, the predecessor capture source, the film provenance README, and the isolated fixture. No criteria were added after reading.

- HIGH: hero shows inactive onboarding, not the working app/team.
- HIGH: team/project actions and outcomes, Genie wish → branch → report, and operational Omni evidence are absent.
- Partial authenticity pass: actual shipped welcome components with fail-closed synthetic fetch responses; this does not prove work scenarios.
- Rebuilt film HTML is not acceptable screenshot provenance.
- Desktop has no visibly broken image, but repaired desktop/mobile, image-request, overflow and readability evidence are absent.
- Installation/gate results above were reused as attributable coordinator results, not rerun by the reviewer. Old missing-tooling claims must not be repeated.

The requested product evidence remains outstanding. This review does not approve delivery or publication.

Native execution only; saved-workflow accounting unavailable.
