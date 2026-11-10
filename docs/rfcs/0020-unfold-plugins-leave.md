# RFC 0020: Unfold plugins leave Automagik

| Field | Value |
|---|---|
| Status | Delivered (2026-11-09: #790; hand-over #780, commit d0453789; Unfold's prerelease unfold-dsh-v3.108.7, weunfold/unfold#3; removal #854, commit 14b8fc50; answers: Q1-Q5, 2026-11-09; no question open) |
| Delivered | 2026-11-09 |
| Milestone | none (ships outside the five milestones) |
| Lanes | none: every step here touches only paths that never ship, so no step cuts a release |
| Created | 2026-11-09 |

## Summary

The nine Unfold plugins (`apps/unfold-{bot,bridge,capabilities,events,mind,session,settings,sse,
trajectory}-dsh`) move to Unfold's own repository, and this repository stops building and testing
them. They already ship nowhere from here: since #617 and #622 no release packs, names, checksums
or updates one, no market index lists one, and none is preinstalled. Removing them therefore
changes nothing for installed users. What changes is this repository's tooling: the CI plugin
matrix, the release gate loop, `scripts/version.ts`, the copy tests, and a few tests of the Bot
team, the welcome and the Portuguese pack that import Unfold folders. The hand-over point is the
commit on `dev` after #780 merges.

## Motivation

The owner's direction (2026-11-09, verbatim): "unfold plugins should be moved to unfold
repo, to keep automagik`s lighter, unfold isnt part of automagik".

Today the nine plugins are 332 files and 405 commits of `dev` (the first on 2026-10-26, #78). They
carry their own redaction parser in seven copies, a server-sent events hub in five, and a perf
guard and a test guard from `scripts/`. They take nine of the thirteen jobs in `ci.yml`'s plugin
matrix and nine of the thirteen installs in the release's gate loop, and every redaction fix to
them (#513, #609, #780) is a multi-file change held together by `scripts/unfold-copies.test.ts`.
None of that reaches an Automagik user: the plugins come with Unfold's own instance.

## Decided

- From the owner (2026-11-09): the plugins leave; Unfold is not part of Automagik.
- From the owner's direction as relayed by Chat (2026-11-09): plugin ids, routes, storage
  prefixes and the team's home stay as they are (AGENTS.md calls them a public contract); no new
  Unfold features land here meanwhile; security fixes to the carried copies still land; Unfold's
  side of the move is the Unfold team's, reached through Chat.

The owner's answers to this RFC's questions 1 to 5 (2026-11-09, on #790 at d0d9c1ea; the owner
accepted every recommendation):

1. The Unfold-aware parts of the plugins that stay do not leave in this move: the welcome's Unfold
   Bot type and its plugin list, bots-dsh's Unfold pet and art, and the host-mode switches
   (`inUnfoldInstance`: no update check, no browser, privacy left to Unfold). The host-mode
   switches are how the Bot team behaves inside a host that runs it, and Unfold's instance depends
   on them. The Unfold Bot type, pet and art are a later issue, under the rule AGENTS.md gives
   Omni-specific code (it belongs in that product's plugins), once Unfold's release is live.
2. The hand-over point is #780's merge commit on `dev`. It moves forward only for a later security
   fix to the copies that lands before Unfold confirms step 4, and each move is sent through Chat.
3. #785 is handed over to Unfold with the code, unless a reviewed fix pull request is open here
   before Unfold confirms step 4.
4. `unshipped()` (`scripts/release-plugins.ts`) and `unlisted()` (`scripts/marketplace.ts`) stay
   after the removal, one line each, as guards against this repository ever offering a second
   source for Unfold's package names.
5. `scripts/test-guard.mjs` stays, with its reporter, flush and test (`scripts/test-guard.test.ts`),
   as AGENTS.md's rule for any package whose tests need `--test-force-exit` (#422), even while no
   package uses it.

Proposed here: everything else. Where a sentence proposes rather than records, it says so.

## Inventory (origin/dev at dc7185ee)

### What ships today: nothing

Verified in code, not assumed:

- `scripts/release-plugins.ts` `unshipped()` drops every `@automagik/unfold-*` from
  `pluginNames()`, so no release attaches a tarball, `plugins.json` names none,
  `PLUGINS.SHA256SUMS` lists none, and the plugin lane's `lane.json` carries none (#622; #617
  did the bridge first).
- `scripts/lane.ts`: `PLUGINS` is `acp-dsh`, `bots-dsh`, `locale-pt-br-dsh`, `welcome-dsh`, and
  `NEVER_SHIPPED` holds `/^apps\/unfold-[^/]+\//`, so an Unfold-only merge cuts no release and
  Unfold beside a plugin is that plugin's patch.
- `scripts/marketplace.ts` `unlisted()`: `marketplace/automagik.json` lists none, and `check`
  refuses an index that does. The Automagik market (`automagik-dev/dsh-marketplace`) lists none
  either.
- `apps/desktop/src/lane.js` (`AUTOMAGIK_PLUGINS`) and `apps/desktop/scripts/follow-dsh.mjs`
  (`PLUGINS`) name none; the desktop profile preinstalls none; the desktop lane leaves an installed
  Unfold plugin exactly as it is (`apps/desktop/test/lane.test.js`).
- The boot check (`boot-check.yml`, "Boot with Omni's plugins"; `scripts/boot-check.mjs`) boots
  Omni's plugins and the profile's add-ons. It boots no Unfold plugin and needs no change.
- v3.92.0, the last release that attached Unfold tarballs, keeps its assets.

### What leaves

| Path | What it is |
|---|---|
| `apps/unfold-*-dsh/` (nine folders) | the plugins, their tests, `dev/harness` pins, built `client.js` files |
| `scripts/unfold-copies.test.ts` | the byte-equal copies between Unfold plugins and the redaction blocks |
| `scripts/sse-copies.test.ts` | the five sse hub copies against `apps/unfold-sse-dsh/index.js` |
| `scripts/redact-fuzz-guard.mjs` | the redaction perf guard (#564); only Unfold tests import it |

### What changes here

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | the `plugin` matrix drops the nine (13 to 4) |
| `.github/workflows/release.yml` | the gate loop drops the nine; the header's "Not attached" paragraph goes |
| `scripts/lane.ts` | the `apps/unfold-` entry stays in `NEVER_SHIPPED` as a guard (section 4); its two comments say why |
| `scripts/release-plugins.ts` | `unshipped()` stays as a name guard (section 4); its comment says why |
| `scripts/marketplace.ts` | `unlisted()` stays as a name guard (section 4); its comments say why |
| `scripts/version.ts` | the nine `apps/unfold-*/package.json` entries and "the Unfold bridge" in its header |
| `scripts/lane.test.ts`, `release-plugins.test.ts`, `marketplace.test.ts`, `release-workflows.test.ts` | the Unfold cases go or say "no Unfold folder" |
| `apps/bots-dsh/test/unfold-root-session.test.js`, `work-dir.test.js` | they import `unfold-bot-dsh` and `unfold-session-dsh`: rewritten on fakes, or the Unfold part moves to Unfold |
| `apps/welcome-dsh/test/unfold.test.js`, `unfold-companion.test.js` | they import `unfold-bot-dsh`, and `unfold.test.js` also reads the eight Unfold bundles' `package.json` (each must declare `dsh.bundle.patch`): the list and the bundle check move to a recorded fixture (section 2) |
| `apps/locale-pt-br-dsh/scripts/copy-check.mjs` | imports `unfold-session-dsh`'s strings (`OMNI_PLUGIN_STRINGS`): it reads their keys from a recorded list under `test/fixtures/` instead; the translations stay in `omni-ui.json`. It is outside the plugin's `files`, so `lane.ts`'s `unpackedIn` treats it as inert and the change goes in the removal |
| `AGENTS.md` | the interim rule (step 2), which the removal takes out again; it names no Unfold path today |

Comments in shipped files (`apps/desktop/src/lane.js`, `apps/desktop/scripts/follow-dsh.mjs`,
`apps/welcome-dsh/src/host/bot-types.js`, `apps/bots-dsh/src/host/constants.js` and `roster.js`,
`apps/unfold-session-dsh` named in `locale-pt-br-dsh/README.md`) say "built and tested here" or
point at an Unfold folder. They are
reworded with the next real change to each file, not on their own: a comment edit in a shipped file
would cut a desktop or plugin release for nothing.

Not touched: `docs/research/`, `docs/perf/`, `.genie/wishes/` and the older RFCs (0010, 0013,
0014) are records of their day. `docs/upgrade.md` names the Unfold plugins as an example of
tarballs a profile does not install; it stays true and is reworded only if it confuses.

### Shared code: which copies exist and who uses them

There are two redactors here, and they share no code.

| Family | Source today | Copies | Users outside Unfold |
|---|---|---|---|
| Unfold's redaction parser | `apps/unfold-mind-dsh/src/redact.js`; the quoted, escaped and key-line blocks from `apps/unfold-events-dsh/src/window.js` | `unfold-events-dsh/src/client/redact.js` and `src/window.js`, `unfold-settings-dsh/src/redact.js`, `unfold-mind-dsh/src/mind.js` (blocks), `unfold-mind-dsh/test/support/window.js`, `unfold-trajectory-dsh/test/support/redact.js` and `window.js`; the #348 table in three `test/fixtures/redact-348.json` | none |
| The sse hub | `apps/unfold-sse-dsh/index.js` | `src/sse.js` in capabilities, events, mind, session and settings (the bridge's `src/host/sse.js` is its own) | none |
| The Bot team's credential redactor | `apps/bots-dsh/src/host/redact.js` (82 lines, a list of credential shapes) | `acp-dsh/src/host/redact.js`, `welcome-dsh/src/host/redact.js` and `src/client/redact.js` (`scripts/redact-copies.test.ts`) | is itself the non-Unfold family |

The quote-tail window, the explicit-key fallbacks and every block #513, #609 and #780 touch live
in the Unfold family only. Neither bots-dsh nor acp-dsh carries any of it.

Three smaller things cross the line the other way, from Unfold into plugins that stay:

- the host rule: `inUnfoldInstance` (bots-dsh `constants.js`), `unfoldLeads` (unfold-bot-dsh) and
  `hostOf` (welcome-dsh) answer the same question from `AUTOMAGIK_HOST` and `AUTOMAGIK_PRELOAD`,
  held together by `apps/welcome-dsh/test/unfold.test.js`;
- the welcome's `UNFOLD_PLUGINS` and `UNFOLD_PLUGIN` in `bot-types.js`, copied from
  `unfold-bot-dsh/src/host/unfold.js` and compared by the same test;
- `scripts/test-guard.mjs` (with its reporter and flush): six Unfold plugins run their tests
  through it, and no other package does.

## Design

### 1. What leaves

The nine folders, their tests, and their nine `plugin` matrix jobs, with the three files in "What
leaves" above. **Recommended:** one removal pull request that touches only paths that never ship
(`apps/unfold-*`, `scripts/`, `.github/`, `test/`, `AGENTS.md`, and
`apps/locale-pt-br-dsh/scripts/`, which is outside that plugin's `files`) and keeps the
`apps/unfold-` entry in `NEVER_SHIPPED` (section 4), so `bun scripts/lane.ts ships` says no and
the merge cuts no release.

### 2. What stays, and where each copy's source lives

- **Unfold's redaction parser and the sse hub: Unfold's repository becomes the source.** Every
  copy and every user is an Unfold plugin, so the whole family leaves together and nothing here
  needs to be checked against it afterwards. `unfold-copies.test.ts` and `sse-copies.test.ts`
  leave with the code; what Unfold's repository does to keep its copies equal is its own.
- **The Bot team's redactor stays here,** source `apps/bots-dsh/src/host/redact.js`, checked as
  today by `scripts/redact-copies.test.ts`. Nothing changes.
- **`redact-fuzz-guard.mjs` leaves** (only Unfold imports it). **`test-guard.mjs` stays:**
  AGENTS.md makes it the rule for any package that needs `--test-force-exit`, and a future one will
  use it. Unfold's repository takes its own copy at the hand-over commit.
- **The host rule becomes a written case table.** Recommended: `apps/bots-dsh/test/fixtures/
  unfold-host-rule.json`, the cases `unfold.test.js` runs today, read by bots-dsh's and welcome's
  tests, as `herdr/test/fixtures/transcript-folder-rule.json` holds Pocket Link and am-sidebar to
  one folder rule. Unfold's repository may test `unfoldLeads` against the same file at a pinned
  commit. A change to the rule is a pull request here first.
- **The welcome's Unfold plugin list is pinned, not compared live.** Recommended: the test checks
  `UNFOLD_PLUGINS` against a fixture recorded from `unfold.js` at the hand-over commit, with that
  commit in a comment. The same fixture records that each of those bundles and `unfold-bot-dsh`
  declares `dsh.bundle.patch` (installable by DSH's `installBundle`), which the test reads from the
  eight `package.json` files today. If Unfold changes its default set, it asks through Chat and the
  list and the fixture move together here. No vendored file with a hash is needed for so small a
  record.

No other copy crosses the line, so no cross-repository vendoring scheme is proposed.

### 3. Installed users

Nothing changes for them, because nothing installs from here today:

- Unfold's own instance brings all nine bundled, from Unfold's release.
- No Automagik release, lane, market index or desktop profile offers one. The desktop lane never
  removes an installed one; that test (`lane.test.js`, "a lane carrying every Unfold plugin
  updates none of them") stays.
- A profile that pinned a git source here (`git+…/automagik.git#<commit>&path:/apps/<folder>`,
  the opt-in path #622 kept) still resolves: `dev`'s history is never rewritten, so every pinned
  commit stays reachable after the folders are deleted. Such a profile moves to Unfold's source
  when Unfold says so; this repository has no updater that could move it, and needs none.

So no transition plan for installed profiles is proposed. What does stay a public contract, now
owned across two repositories:

- package names `@automagik/unfold-*-dsh`, their DSH row ids (`unfold-bot` and the others), their
  routes (`/api/unfold-*`), their storage (`<DSH_HOME>/unfold-workspace`, the bridge's
  `unfold-bridge/endpoint.json` and `UNFOLD_BRIDGE_STATE_DIR`), and the root Session id
  `unfold-root` (`unfold-session-dsh`'s `sessionId` default; the Bot team only names it in tests);
- in the Bot team: the Bot kind `unfold`, the `omniTeam` service that `unfold-bot-dsh` injects,
  and the host variables `AUTOMAGIK_HOST=unfold` and `AUTOMAGIK_PRELOAD=unfold`.

Unfold's side keeps the first list; this repository keeps the second, and treats a change to it
as a breaking change for Unfold, said in the pull request.

### 4. Release and lane changes

- **Before (today):** the nine are `NEVER_SHIPPED`; releases carry four plugins; the plugin lane
  and the market index name four; CI tests thirteen; the release's gate loop installs thirteen.
- **During (hand-over to removal):** unchanged. The folders are frozen here except for security
  fixes (section 7).
- **After:** CI tests four, the gate loop installs four, `version.ts` writes nine plugin
  manifests fewer, and `lane.ts` keeps only its `NEVER_SHIPPED` guard for `apps/unfold-`.
  Releases, `plugins.json`, `PLUGINS.SHA256SUMS`, `lane.json` and the market index are byte for
  byte what they are now.

`lane.ts` gains no kind and loses none. The `apps/unfold-` entry stays in `NEVER_SHIPPED`, for
good: the release runs the merge's own `lane.ts ships <last tag>` over every path changed since
the last release, deleted paths included, so a removal that also dropped the entry would count
the nine deleted folders as shipping and cut a full release (the Reviewer simulated it on #790:
`ships: yes, kind: full` without the entry, `ships: no` with it). Kept after that release too, it
costs one pattern and keeps any Unfold folder that came back from cutting a release. When it
may go: only once a release tag is past the removal's merge, since the diff since the last release
then no longer holds the deletions; this RFC keeps it anyway, and taking it out later is a
`scripts/` change that cuts nothing. The two name
guards stay as well, one line each: once Unfold publishes `@automagik/unfold-*`, a
tarball or a lane entry from this repository (`unshipped()` in `release-plugins.ts`) or an entry in
its index (`unlisted()` in `marketplace.ts`) would offer a second source for a package name Unfold
owns. If an Unfold folder ever came back by mistake, the guards keep it out of every release and
index, as they do today.

### 5. History

**Recommended:** Unfold's repository receives the plugins with their history, through
`git filter-repo --path apps/unfold-bot-dsh/ … --path apps/unfold-trajectory-dsh/` (plus the
`scripts/` files it wants, such as `test-guard.mjs`), run in a clone at the hand-over commit,
never in this repository. filter-repo is deterministic, so a re-run at a later commit adds only the
newer commits, which is what makes moving the hand-over point (section 6) cheap. A subtree split
gives one folder at a time and would have to be done nine times; filter-repo gives one history.

The 405 commits include every `chore(release)` bump, since `version.ts` writes all nine
manifests. Whether to keep them is Unfold's call; filter-repo can drop them.

**Here:** nothing is rewritten. No pointer folder is left under `apps/`: `pluginNames()` reads every
`apps/*-dsh`, so a stub folder would be read as a plugin. The pointer is this RFC, which records
the hand-over commit and Unfold's first release when it moves to Delivered, and the removal commit's
message, which names both.

### 6. The order of steps

Each step says what it needs, and how it is undone.

1. **This RFC** (docs; cuts nothing).
   *Rollback:* revert.
2. **The interim rule in AGENTS.md** (docs; cuts nothing): no new Unfold features; security fixes
   to the carried copies still land (section 7).
   *Rollback:* revert.
3. **#780 merges.** Its merge commit on `dev` is the **hand-over point**: the source sha after
   #780. Automagik sends that sha to Unfold through Chat. From then on `apps/unfold-*` is frozen
   here.
   *Rollback:* none needed: nothing has moved yet.
4. **Unfold takes the code** (Unfold's side). What Automagik needs from it, not how:
   - its repository builds and tests the nine at the hand-over sha, green;
   - its release ships them under the same package names, row ids, routes and storage paths, at a
     version above the last one carried here (3.108.x at the time of writing), so no installed
     copy ever sees a lower version;
   - its instance installs them from its own release, not from this repository;
   - it tells Automagik through Chat which release that is.
   If a security fix to the copies must land here before Unfold confirms, it lands, and the
   hand-over point moves to that later merge commit; Unfold re-runs filter-repo.
   *Rollback:* Unfold's own; this repository is unchanged.
5. **The removal** (one pull request; cuts nothing). Everything in "What leaves" and "What
   changes here", the host-rule case table, the welcome's recorded list and the pt-BR copy check's
   recorded keys included. Its message names the hand-over sha and Unfold's release.
   *Check:* `bun run check`, the four remaining plugin jobs, and `bun scripts/lane.ts ships` on the
   merge says no (with the `NEVER_SHIPPED` entry kept; section 4); `git grep -l 'apps/unfold-'`
   lists only records under `docs/` and `.genie/`, the kept guard and its tests
   (`scripts/lane.ts`, `scripts/lane.test.ts`), and the shipped files step 6 rewords later (today
   `apps/welcome-dsh/src/host/bot-types.js` and `apps/locale-pt-br-dsh/README.md`).
   *Rollback:* revert the merge, then `bun scripts/version.ts set <the root version>` in the same
   pull request: the revert brings the nine manifests back at the hand-over version, and after any
   release since, `version.ts check` (and so `bun run check`) fails until they carry the root's
   version again. The revert cuts no release (the entry still holds), and no installed copy
   notices either way.
6. **Comments in shipped files** are reworded with each file's next real change (no pull request of
   their own).

### 7. Interim rule (until step 5 merges)

- No new Unfold features, settings or plugins here. A feature request goes to Unfold through Chat.
- Security fixes to the carried copies still land: #780 (#507, #530), and #785 or any remaining
  part of #530 if a reviewed fix pull request is open before step 4 confirms. After step 3, such a
  fix moves the hand-over point (Decided, 2); one that is not open by then goes to Unfold through
  Chat with its issue (Decided, 3).
- Fixes to shared code that stays (the Bot team's redactor, `test-guard.mjs`) land as usual.

## Contracts introduced

None new. Kept, now across two repositories (section 3): the package names, row ids, routes,
storage paths and the root Session id `unfold-root` of the nine (Unfold's); the Bot kind `unfold`,
the `omniTeam` service and the host variables (this repository's). Kept for good in `lane.ts`:
the `NEVER_SHIPPED` entry for `apps/unfold-` (section 4). Proposed new test fixtures:
`apps/bots-dsh/test/fixtures/unfold-host-rule.json`, readable by Unfold at a pinned commit, and the
welcome's recorded Unfold plugin list (section 2).

## Threat model

No new trust boundary: nothing installs from here before or after. Two notes:

- The redaction parser is security code. Moving it moves its review to Unfold's repository; until
  step 5 merges, this repository's review and `unfold-copies.test.ts` still guard every change.
- A stale git source pinned at an old commit here keeps whatever redaction that commit had. That
  is true today and unchanged by the move; Unfold's release is where such a profile updates.

## Open questions

None. Questions 1 to 5 were answered by the owner on 2026-11-09 and are in Decided.

## Tracking

Ledger pass (2026-11-10): the board links this RFC from its file.

- Open issues: none (all tracked work is merged).
- Merged changes: #790, #854 (last merged 2026-11-09).

## Links

- Owner direction: 2026-11-09, quoted in Motivation.
- Pull requests: #617 (the bridge out of the release), #622 (every Unfold plugin out of the
  release), #513, #609 (redaction fixes to the copies), #780 (open: explicit-key fallbacks, #507
  and #530); issues #530, #785, #564 (the shared perf guard).
- RFCs: [0011](0011-monorepo-parts-and-releases.md) parts and lanes,
  [0012](0012-am-cli-and-parts.md) parts, [0017](0017-usagemeter-crate.md) a history move in the
  other direction.
- Code: `scripts/lane.ts` (`PLUGINS`, `NEVER_SHIPPED`), `scripts/release-plugins.ts`
  (`unshipped`), `scripts/marketplace.ts` (`unlisted`), `scripts/version.ts`,
  `scripts/unfold-copies.test.ts`, `scripts/sse-copies.test.ts`, `scripts/redact-copies.test.ts`,
  `scripts/redact-fuzz-guard.mjs`, `scripts/test-guard.mjs`, `.github/workflows/ci.yml`
  (`plugin`), `.github/workflows/release.yml` (the gate loop), `apps/desktop/src/lane.js`,
  `apps/welcome-dsh/src/host/bot-types.js`, `apps/bots-dsh/src/host/constants.js`.
