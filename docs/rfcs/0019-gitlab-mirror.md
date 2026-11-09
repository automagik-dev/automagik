# RFC 0019: the GitLab mirror

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | none (ships outside the five milestones) |
| Lanes | none: CI, workflow and process changes (`.github/` and `scripts/` never ship; `.gitlab-ci.yml` is added to `NEVER_SHIPPED` by delivery 2) |
| Created | 2026-11-09 |

## Summary

The team's work moves to a self-hosted GitLab instance that Arca runs: merge requests, review,
verdicts, merges and the pre-merge Linux gates. GitHub stays the public repository and the release
host. A one-way push mirror carries `dev`, `main` and the tags from GitLab to GitHub, and nothing
is pushed to GitHub by hand. Every release, signed pointer and download URL stays where it is
today, so no installed pack, am, desktop app or phone changes how it finds updates. The release
workflow keeps running on GitHub Actions, where the signing keys and the Mac signing and
notarisation runners already are; it writes its version commit and tag to GitLab instead of
GitHub. A second download host is a later, separate step, and this RFC says what it needs.

## Motivation

The owner asked for this RFC on 2026-11-09: "draft the gitlab mirror rfc, we already have
inspiration, brain repo, where this is already going on with certain success. our arca will have
its own git lab instance". There are two goals:

- **Less GitHub load.** The team's bots do almost all of their work through `gh` on one shared
  login: they open pull requests, read diffs and checks, post every verdict as a comment, and
  merge. A login's REST and GraphQL quotas (5,000 an hour each) and GitHub's secondary limits on
  writing content are shared by every bot that uses that login. Actions minutes on hosted runners
  are spent on every push.
- **No single forge.** Today one forge holds the code, the review history, the CI, the secrets,
  the releases and every download URL in the field. An outage, a lockout or a policy change at
  that forge stops all of them at once.

What the motivation is not: the "couldn't check" Felipe saw on 2026-11-09 was bug #786 (am-status
gives up on a check request that is queued behind an automatic update), not a rate limit. The
pack's update check reads release downloads (`releases/download/herdr-lane/pack.json`), not the
REST API, and API quota was far from its limit on both machines that day. This RFC would not have
prevented that report; #786 is fixed on its own.

## What Brain teaches

The Brain repository already works this way. What follows was read from a local checkout (its
`.gitlab-ci.yml`, its docs and RFCs, its remotes), and nothing there was changed or run. The
checkout has no `.tools/` folder at its last commit (2026-11-06), so Brain's merge helpers were
not read; what is said about its merge flow comes from its docs.

- **GitLab is the workspace, GitHub is the source others read.** Brain first named GitLab the
  source of truth, then changed that (owner decision, 2026-11-01): GitHub is the official source,
  GitLab the development workspace. Unchanged by that decision: a one-way push mirror from
  GitLab's protected `dev` to GitHub, "never push to GitHub directly", protected `dev` and merge
  request review on GitLab.
- **The release runs on GitHub Actions, on the mirror.** Every push to the mirror's `dev` (every
  GitLab merge) is a release, because hosted runners give macOS and arm64 builds "without
  operating our own runner fleet". Nothing in Actions pushes back to GitLab, so the workflow never
  needs a GitLab credential. Brain can do that because its version is taken from the tag and no
  bot commits to `dev`.
- **The push mirror removes refs that exist only on GitHub.** Brain's release tags live on a
  separate releases repository for that reason. GitLab's documentation says the same in its own
  words: without "Keep divergent refs", the source "overwrites any changes on the remote"; with
  it, "any refs that exist in the remote mirror, but not the upstream, are left untouched".
- **Pre-merge checks run on GitLab, platform builds after merge.** Brain's GitLab CI runs its
  gates on merge requests and on `dev`, on runners tagged to its own host; the macOS and arm64
  builds run on GitHub after the merge. A macOS-only failure is fixed forward.
- **Bots review on GitLab.** Verdict tokens (`SHIP`, `FIX-FIRST`, `BLOCKED`, `PASS`, `FAIL`) are
  merge request notes, read through a read-only `glab` login. GitHub issues are copied into
  GitLab by a scheduled job (dormant until its token exists); the GitHub acknowledgement carries
  no GitLab URL.
- **GitLab is never the download host.** Brain's clients read a signed pointer from a host of its
  own; the GitLab instance is not public.

Where Automagik differs: this repository is public and has outside readers (herdr.dev, Omni's
market, installed clients); its release commits the version to `dev`; and its releases already
sit on this repository, under download URLs that every installed client has compiled in.

## Decision 1: which forge is canonical

"Canonical" here means where `dev` and `main` are written: where merges happen and where the
protected branches live. The other forge receives them through the mirror.

**Option A: GitHub canonical, GitLab a read-only copy.** Evidence for it: everything already runs on
GitHub (ten workflows, about 3,200 lines; every secret; the Mac and Windows runners; the release
writes); herdr.dev, Omni (`repository_dispatch` into `follow-omni.yml`), Genie's lane and every
installed client read it; nothing moves, so nothing breaks. Evidence against: it lowers neither
goal. The bots would still work through `gh`, so the load stays; GitLab would hold a copy of the
code and nothing else, so a GitHub lockout would still stop review, CI and releases.

**Option B: GitLab canonical for the work, GitHub the public mirror and release host.** Evidence
for it: it moves the load that exists (pull request reads, check polling, verdict comments,
merges) to an instance whose limits the owner sets; review and merges go on through a GitHub
outage; Brain runs this shape today. Evidence against: two forges to keep in step; the release
must write its version commit to GitLab, which needs one new credential (below); outside
contributors still arrive on GitHub; Arca's instance becomes part of the release's trust (anyone
who can merge to its `dev` starts a signed release).

**Option C: GitLab canonical for everything, releases included.** Rejected for now. The signing
keys, the Mac notarisation runners and the download URLs in the field are all on GitHub, and the
field cannot move without client releases first (Decision 3).

**Recommendation: B**, in phases (below), with GitHub kept as the release host and the stable read
path. Item by item:

| | GitLab (Arca's instance) | GitHub (`automagik-dev/automagik`) |
|---|---|---|
| Protected `dev` and `main`, merges | yes | read-only: written only by the mirror |
| Merge requests, review, verdicts, merge questions | yes | outside contributors' pull requests only, carried over by hand |
| Pre-merge gates (Linux) | GitLab CI, required to merge | none |
| macOS and Windows legs, release, desktop builds, images | none | GitHub Actions, on `dev` after the mirror push |
| Releases, rolling pointers, download URLs | none (a copy only in phase 5) | yes, unchanged |
| Signing keys and certificates | none | Actions secrets, unchanged |
| Issues | off (question 3) | yes, the public intake |
| herdr.dev, Omni, Genie's lane, raw catalog and installer URLs | none | yes, unchanged |

## Decision 2: how the mirror syncs

- **Direction: one way, GitLab to GitHub, by a GitLab push mirror** (available on every GitLab
  tier, Free included). GitHub has no pull mirror of its own, and a mirror in both directions has
  no answer for two writes to the same branch. Phase 0 runs the other way, GitHub to GitLab, only
  to seed and test the instance while GitHub is still canonical: a GitLab pull mirror where the
  instance has a tier that offers one (Premium and up), or else a scheduled job on Arca that
  fetches the public repository and pushes it to the project, which needs no GitHub credential.
- **Refs.** Protected branches (`dev`, `main`) and every tag. Feature branches stay on GitLab:
  they are the team's working state and need not be public. The setting "Only mirror protected
  branches" is on, which also shortens the lag (below). GitLab's documentation does not say
  whether tags travel with that setting, and nothing depends on it: the release pushes its own tag
  to GitHub (below), and the only other tags are the ones imported before the flip, which already
  exist on both. Phase 3's acceptance check records which way it goes.
- **Refs that exist only on GitHub.** The four rolling releases (`plugin-lane`, `herdr-lane`,
  `pocket-lane`, `am-lane`) were made with `gh release create --target dev`, so their tags exist
  only on GitHub; so do the `herdr-automations-v*` tags `scheduler-release.yml` makes. A release
  whose tag is deleted is no longer served at its `releases/download/<tag>/` URLs: every installed
  pack, am, desktop app and phone would stop updating. Two guards, both required before the flip:
  every one of those tags is pushed to GitLab first, at the same commit, as a protected tag, so
  the mirror sees nothing to change; and "Keep divergent refs" is on, so a tag made on GitHub
  later is left alone. `refs/pull/*` on GitHub is read-only and never touched.
- **Lag.** GitLab's documentation: a push mirror "receives it in five minutes, or one minute if the
  setting Only mirror protected branches is on". A release on GitHub therefore starts up to a
  minute after the merge; the raw `main` the installer one-liner reads and the raw `dev` the
  catalog is read from trail GitLab by as much.
- **Divergence.** With "Keep divergent refs" on, a GitHub `dev` that someone wrote directly is
  skipped, not overwritten: the mirror stalls on that branch and reports an error in GitLab. Two
  guards: a GitHub ruleset lets only the mirror's account push `dev` and `main`, and the GitHub
  Actions workflow token push `v*` tags only; and a scheduled check (delivery 3) compares the two
  heads and fails loudly when they differ for more than ten minutes. Repair is always GitLab wins:
  find the stray commits, carry them over as a merge request if they are wanted, and force-update
  the mirror.
- **Protected branches.** On GitLab: `dev` and `main` accept merges from maintainers through merge
  requests only, and direct pushes from the release's token only (the version commit, the market
  index, `main`'s fast-forward, `follow-omni.yml`'s pin). `v*` tags are protected; only that token
  creates them. On GitHub: the ruleset above. No one else pushes to GitHub's `dev`, the owner
  included.
- **Merge commits.** The mirror publishes every merge commit message, so GitLab's merge commit
  template carries no instance URL or host (`%{url}` is never used). GitLab offers the merge
  methods GitHub does (a merge commit, or a squash), so the choice made per change today carries
  over, a history import's merge commit included. Closing keywords follow question 3.

**The release's writes.** `release.yml` writes `dev` today (the atomic push of the version commit
and its tag, the market index commit) and `main` (the fast-forward), and `follow-omni.yml` writes
its pin commit. Under the mirror those writes go to GitLab: the release keeps checking out the
GitHub copy it was started from, pushes `dev` and the tag atomically to GitLab with a GitLab
project token, then pushes the same tag object to GitHub with the workflow token, so the GitHub
release and the desktop builds start at once instead of waiting for the mirror. The atomic push
keeps today's rule: when GitLab's `dev` moved meanwhile, neither lands, and the run for the newer
merge releases both. The version commit, mirrored back to GitHub, starts one more run, which the
existing guard ends ("a dev that has nothing since the last release but those commits cuts
nothing"). Brain avoids the GitLab credential by taking the version from the tag; that would
change the one-version rule (`version.ts`, the pack's `VERSION`, Pocket's Gradle reading
`package.json`), so it is not proposed here.

## Decision 3: releases and the signed rolling pointers stay on GitHub

Every client in the field has its read path compiled in, and most check the host as well:

| Client | Where it reads | What it checks about the host |
|---|---|---|
| Pack updater (`release.js`, `update.mjs`) | `POINTER_URL`, `releases/download/herdr-lane/pack.json` on GitHub | the tarball URL in the signed pointer may be any `https://` (`release.js` `packOfPointer`) |
| `herdr/install.sh` | `RELEASES`, GitHub; the one-liner from raw `main` | refuses any `AUTOMAGIK_HERDR_RELEASE_URL` but `file://` or this GitHub repository; takes the tarball from `$RELEASES/download/v<v>/` |
| am (`am/lib/lane.mjs`, `self.mjs`) | `am-lane` on GitHub | the signed pointer's `repository` must be this GitHub repository and its tarball URL must sit under its `releases/download/<tag>/` (`checkPointer`) |
| Desktop plugin lane (`apps/desktop/src/lane.js`) | `LANE_URL`, `plugin-lane` on GitHub | every plugin URL must start with `https://github.com/` (`laneUpdate`) |
| Desktop app (`apps/desktop/src/update.js`) | the REST API's release list, then GitHub downloads | the one client that uses the REST API: unauthenticated, every 15 minutes, from each install's own address |
| Pocket (`build.gradle.kts`, `Updater.kt`) | `UPDATE_URL`, `releases/download/pocket-lane/latest.json` on GitHub | the APK URL may be any `https://`; its sha256 and the same-signer rule are the check |
| Mod manager | raw `dev`, `herdr/catalog/index.json` on GitHub | none |

So a pointer that moved, or a pointer naming an artifact on another host, would be refused by
every installed am and every desktop app's plugin lane, and never even read by the pack, the
installer or Pocket. GitHub cannot redirect a release download to another host, so redirects are
not available either.

**Recommendation: GitHub release assets stay the stable read path, indefinitely.** Nothing in this
RFC's phases 0 to 4 moves a pointer, a release, an asset name or a field: `plugin-lane`,
`herdr-lane`, `am-lane` and `pocket-lane` keep their tags, their files and their writers in
`release.yml`, and their rules (fail-closed posting, no lower sequence, `pocket-lane` never Latest
and never edited) are unchanged. RFC 0011 says moving `latest.json` or changing its fields needs
an RFC; this RFC moves neither. What would let a client survive GitHub being away is phase 5:

1. **Clients first.** Each client learns a second base URL, used only when the first fails, with
   every check unchanged: the pointer's signature against the same keys, the artifact against the
   pointer's sha256, Pocket's APK against its signer. The host carries no trust, because the
   signature and the hash do. am's `checkPointer` and the plugin lane's `https://github.com/`
   check are relaxed to "the tarball URL is under the base this pointer was read from", and the
   pointer's `repository` stays this GitHub repository as an identity. Pocket gets a list in
   place of one `UPDATE_URL`. Each change is a release of its own part, like the first phase of a
   key rotation (RFC 0011, "Making the key").
2. **Dual-publish second.** The release uploads the same bytes (artifacts, `pack.json` and its
   `.sig`, `am.json` and its `.sig`, `lane.json` and its `.sig`, `latest.json`) to the second host
   after GitHub, with the same fail-closed and no-lower-sequence rules. No pointer is re-signed for
   it: the second host serves the files GitHub serves.
3. **Never flip until the field has the fallback.** GitHub stays first in every client. Making
   the second host first is its own RFC, after the clients that know it are most of the field.

The desktop app's REST API call is the one place an installed client spends GitHub API quota. A
desktop feed pointer like the others' would remove it; that is a desktop delivery of its own,
out of this RFC's scope, and listed as question 7.

## Decision 4: keys and secrets, with no new exposure for them

| Secret | Where it lives | Which runner sees it |
|---|---|---|
| `HERDR_PACK_KEY`, `HERDR_PACK_KEY_NEXT` | GitHub Actions secrets, unchanged | `release.yml`'s `cut` job, GitHub-hosted Linux |
| `AM_LANE_KEY`, `AM_LANE_KEY_NEXT` | GitHub Actions secrets, unchanged | `cut` (check-key) and `am-lane`, GitHub-hosted Linux |
| `PLUGIN_LANE_KEY` | GitHub Actions secret, unchanged | `cut`, GitHub-hosted Linux |
| `POCKET_SIGNING_KEYSTORE`, `POCKET_SIGNING_PASSWORD` | GitHub Actions secrets, unchanged | `cut` (presence only) and `pocket`, GitHub-hosted Linux |
| Mac and Windows signing (`MAC_CSC_*`, `APPLE_API_*`, `WIN_CSC_*`, `AZURE_CLIENT_ID`) | GitHub Actions secrets, unchanged | `desktop-build.yml`, GitHub-hosted macOS and Windows |
| The mirror's GitHub token (new) | GitLab's push mirror setting | GitLab itself; no CI job |
| The release's GitLab token (new) | GitHub Actions secret (proposed `GITLAB_RELEASE_TOKEN`) | `cut`, `list` and `follow-omni.yml`'s push step only |

- **No signing key goes to GitLab**, in any phase. GitLab CI runs gates only, on Arca's runners,
  with no secret at all: a merge request from any branch can run them safely.
- **The mirror's token** is a GitHub fine-grained token for this one repository, contents and
  workflows read and write (GitLab's documentation requires workflows access when the repository
  has `.github/workflows`), owned by a dedicated machine account that the GitHub ruleset names.
  It can push `dev`, `main` and tags to GitHub, which starts a release. That is the new trust the
  RFC adds (Threat model).
- **The release's GitLab token** is a project access token with `write_repository` on the one
  project, whose bot user may push the protected `dev` and `main` and create `v*` tags. It holds
  the same power `release.yml`'s workflow token holds over GitHub's `dev` today, and it is
  passed only to the steps that push.
- Both new tokens expire; their renewal dates go in the owner's calendar, and an expired one stops
  the mirror or the cut loudly, never silently (delivery 3's check catches the first).

## Decision 5: the herdr.dev listing

herdr.dev's crawler reads this GitHub repository: its top-level folders and the topics set in its
settings. Under the mirror, GitHub's tree is GitLab's `dev` and `main` within a minute, and topics
are repository settings, not git content, so the listing sees exactly what it sees today. Nothing
changes and nothing is added: no `herdr-mod` or `herdr-layout` topic until the owner opens the
listing (AGENTS.md), no `layouts/` in a herdr-mod entry folder, `herdr-layout/` as it is. A stalled
mirror makes the listing and the raw catalog stale, never wrong; delivery 3's check reports it.

## Decision 6: CI parity

| Today on GitHub Actions | Under the mirror |
|---|---|
| `ci.yml`'s Linux jobs (`repo`, `herdr`, `scheduler`, `am`, `pocket`, `meter`, `dsh-sandbox`, `plugin`, `pets`, `boot`, the Linux legs) | GitLab CI on Arca's Linux runners, before the merge, required to merge |
| `ci.yml`'s macOS legs (`pocket-link`, `usagemeter`) and Windows legs (`desktop`, `acp-windows`) | GitHub Actions on `dev` after the mirror push, until Arca has such runners |
| `commitlint.yml` | GitLab CI, on every merge request |
| `release.yml`, `desktop-build.yml` (macOS signing and notarisation on hosted macOS) | GitHub Actions, triggered by the mirror's push to `dev`, as today |
| `follow-omni.yml` (schedule, Omni's `repository_dispatch`) | GitHub Actions; its pin push goes to GitLab |
| `server-image.yml`, `linux-image.yml` (GHCR), `scheduler-release.yml`, `boot-check.yml`, `herdr-harness.yml` | GitHub Actions, unchanged |

- **Same commands, two schedulers.** Every gate is already a command in the repository (AGENTS.md
  lists each part's). The GitLab jobs call the same commands with the same pins (Node 22 newest
  and 24, Bun 1.4.4, JDK 17 and SDK 35, the meter crate's toolchain). A test beside
  `release-workflows.test.ts` checks that each `ci.yml` Linux job has a GitLab job running the same
  commands, so the two cannot drift.
- **The build rule holds.** The `usagemeter` job's Linux leg runs on a GitLab runner that keeps
  AGENTS.md's build rule: one cargo build at a time behind the host's gate lock,
  `CARGO_BUILD_JOBS=4`. Its macOS leg stays on GitHub.
- **What is lost.** A macOS-only or Windows-only failure is seen after the merge, on GitHub, and is
  fixed forward, as Brain accepts. Today that is two macOS legs and two Windows legs. Mirroring
  merge request branches to GitHub to run them before the merge (Brain's option b) is possible
  later, and would make feature branches public.
- **Mac signing and notarisation stay on GitHub's hosted macOS runners.** They need macOS, the
  Apple credentials and the certificates, and moving them would put those secrets on a second
  system. A macOS runner on Arca is question 5.
- **Shadow first.** Phase 1 runs the GitLab jobs beside Actions for two weeks; both must agree on
  every pull request before GitLab CI becomes the merge gate.

## Decision 7: how the team's bots work

| Today (`gh`) | Under the mirror (`glab`, against Arca's instance) |
|---|---|
| `gh pr create --base dev` | `glab mr create --target-branch dev` |
| `gh pr view`, `gh pr diff`, `gh pr checks` | `glab mr view`, `glab mr diff`, `glab ci status` |
| a verdict as a pull request comment (`SHIP`, `FIX-FIRST`, `BLOCKED`, the gate's count) | the same verdict as a merge request note, same tokens and format |
| the merge question to Chat, then `gh pr merge` by Chat | the same question, then `glab mr merge` by Chat; GitLab's protected `dev` is the gate |
| the merge rules (CI newer than `dev`, no push after a SHIP, no merge while a release runs) | unchanged; release runs are still read on GitHub (`gh run view`, read-only) |
| issues, labels, releases (`gh issue`, `gh release view`) | unchanged on GitHub while issues stay there (question 3) |

- **Rate limits.** The instance's limits are the owner's to set, so the bots' review traffic no
  longer spends GitHub quota. GitHub keeps the issue and release reads, and the release
  workflow's own calls, which use the workflow token's quota.
- **One login per role.** Each bot's `glab` login is a GitLab user whose rights match its role
  (reviewers and testers: reporter; workers: developer, pushing feature branches; Chat and the
  owner: maintainer, merging). Brain shares one author for all its bots; separate users make a
  verdict's author checkable.
- **Numbers change.** A merge request is `!N`, not `#N`, and its numbers start again. Briefs,
  memories and reports name a merge request as `!N`, and an issue keeps GitHub's `#N`.
- **Outside contributors.** A pull request on GitHub is reviewed there in the open, then carried to
  GitLab by a maintainer as a merge request that keeps the author's commits; the GitHub pull
  request is closed with a note naming the merge commit, never an instance URL.
- **The public repository rule** covers GitLab text that the mirror publishes (merge commits, the
  release's notes) as it covers GitHub's; merge request notes on the instance are not public, but
  stay free of secrets.

## Decision 8: phased rollout

| Phase | What changes | Acceptance check | Rollback |
|---|---|---|---|
| 0. Read replica | Arca's GitLab copies GitHub (all branches and tags) by a pull mirror or a scheduled fetch-and-push job (Decision 2); issues and merge requests off | GitLab's `dev` equals GitHub's within the copy interval for a week | delete the project; nothing reads it |
| 1. Shadow CI | `.gitlab-ci.yml` with the Linux gates and commitlint, on mirrored branches; not required | two weeks of pull requests where GitLab and Actions agree on every Linux job | remove the file or stop the runner |
| 2. Ready to flip, still on GitHub | the release and `follow-omni.yml` push to a remote set by a repository variable (still GitHub); the lane and `herdr-automations-v*` tags imported to GitLab as protected tags; the GitHub ruleset drafted; the merge commit template set; the bots' `glab` logins and briefs ready; the head check running | a dry run: the release pushes to a scratch GitLab project and the tag lands on GitHub | revert; the variable keeps GitHub as the remote |
| 3. The flip | merges frozen for the window; GitLab stops copying and becomes canonical (protected `dev`, `main`, `v*`); the push mirror on, protected branches only, divergent refs kept; the GitHub ruleset on; the variable points the release at GitLab; GitLab CI required; open pull requests carried over as merge requests; the bots move to `glab` | one merge on GitLab is cut on GitHub, its version commit is back on GitLab and mirrored, and an installed pack, am, desktop app and phone each update from it | push mirror off, ruleset off, the variable back to GitHub, merges back on GitHub; GitLab goes back to phase 0's copy. Nothing is lost: first check that the two `dev` heads are equal |
| 4. Settle | `AGENTS.md`, the RFC process (`docs/rfcs/README.md`: merge requests to `dev`), the brief templates and memories say merge request and `glab`; the macOS and Windows legs reported back to the merge request | a week of merges with no manual mirror repair | revert the docs with phase 3's rollback |
| 5. Second download host (its own RFC or amendment) | clients learn a fallback base URL (one release per part); then the release dual-publishes to a host on Arca | an install in the field updates from the fallback with GitHub blocked | stop dual-publishing; clients still read GitHub first |

Phases 0 and 1 need only the instance and a runner. Phase 3 is the one owner decision with a
window: it is scheduled when no release run is still going, every job of the last one done.

## Decision 9: what Arca's own instance changes

- **The limits are ours.** The instance's rate limits, runner capacity and retention are the
  owner's settings, not a hosted plan's.
- **It is part of the release's trust.** Whoever can merge to its `dev`, administer the instance,
  or read the mirror's token can start a signed release on GitHub. Its admins are the owner alone,
  every account uses two-factor login, and it is patched on GitLab's security releases.
- **It is private.** Its address appears in no public text. Outside contributors cannot reach it,
  which is why GitHub stays the public intake.
- **Its outage stops merges, not users.** While it is down, nothing merges, but releases already
  out keep serving from GitHub and no installed client notices. A long outage is answered by phase
  3's rollback: merges resume on GitHub, and GitLab pulls them when it is back.
- **Operations.** Backups (repositories, merge request history), upgrades and the runners are a
  new duty. The review history now lives on Arca's instance first; GitHub keeps only the merged
  commits.
- **Not Brain's instance.** Automagik goes on Arca's own instance, as the owner said, not on the
  instance Brain uses; the two share practices, not a server.

## Contracts introduced

- **No client contract changes.** Every download URL, rolling release, pointer file, field, key
  and asset name stays as RFC 0011, RFC 0012 and RFC 0017 define it.
- **Canonical branches move.** `dev` and `main` are written on Arca's GitLab; GitHub's are a
  mirror. A pull request on GitHub is no longer merged there.
- **New secrets and settings.** `GITLAB_RELEASE_TOKEN` (proposed name) in GitHub Actions; the
  mirror's GitHub token in GitLab; a repository variable naming the release's push remote; a
  GitHub ruleset on `dev`, `main` and `v*`.
- **New files.** `.gitlab-ci.yml` (added to `scripts/lane.ts`'s `NEVER_SHIPPED`, so a CI-only
  change cuts no desktop build) and its parity test.
- **Process.** Merge requests to `dev` on GitLab; verdicts as merge request notes; `!N` for merge
  requests, `#N` for GitHub issues.

## Threat model

- **The new path to a release.** Today a release starts from a push to GitHub's `dev`. Under the
  mirror it also starts from a merge on GitLab, an instance admin, or a leak of the mirror's
  token. Any of them can put code on `dev` that the next release builds and signs with every
  lane's key. Answered by: protected `dev` on both forges, maintainers only; the instance's admins
  limited to the owner; the mirror's token scoped to one repository and owned by a machine
  account the GitHub ruleset names; the head check, which shows a GitHub `dev` that moved without
  GitLab. The signing keys themselves never leave GitHub, so a compromised instance cannot sign
  anything without going through a reviewed release run.
- **The release's GitLab token.** It can push `dev`, `main` and `v*` on GitLab. It sits where the
  workflow token's identical power already sits, in GitHub Actions, and is passed only to the
  push steps. A leak is answered by revoking it in GitLab; the release then stops at its push.
- **Deleted tags.** The mirror could delete the four lane tags and break every installed client's
  updates. Answered by importing them to GitLab as protected tags before the flip and keeping
  divergent refs; phase 3's acceptance check reads each lane's files after the first mirrored
  release.
- **Leaking the instance's address.** Merge commit messages, release notes and anything the mirror
  carries are public. The merge commit template has no URL, and the privacy check
  (`herdr/scripts/privacy-check.mjs`) runs on every merge request as it runs today.
- **Undo.** Phase 3's rollback restores today's setup without data loss, provided the two `dev`
  heads are equal when it starts.

## Deliveries

Each is one merge request (one pull request before the flip), on no part's lane: `.github/`,
`scripts/` and `docs/` never ship, and delivery 2 makes `.gitlab-ci.yml` never ship.

1. **Instance and read replica** (phase 0; settings only, no repository change). Acceptance:
   GitLab's `dev` equals GitHub's for a week. Rollback: delete the project.
2. **GitLab CI shadow** (phase 1). `.gitlab-ci.yml`, the parity test, `NEVER_SHIPPED`. Acceptance:
   two weeks of agreement with Actions. Rollback: revert; nothing depends on it.
3. **The head check** (phase 2). A scheduled workflow on GitHub comparing GitLab's and GitHub's
   `dev` and `main`, failing after ten minutes of difference. Acceptance: it fails on a staged
   difference in the scratch project. Rollback: revert.
4. **Release remote** (phase 2). `release.yml` and `follow-omni.yml` push `dev`, `main` and the
   tag to the remote a repository variable names (GitHub until the flip), then the tag to GitHub;
   `release-workflows.test.ts` covers both remotes. Acceptance: the scratch dry run. Rollback:
   the variable, or a revert.
5. **The flip** (phase 3; settings, the variable, the bots' tooling). Acceptance and rollback as
   in the phase table.
6. **Docs and process** (phase 4). `AGENTS.md`, `docs/rfcs/README.md`, brief templates.
   Acceptance: a week of merges with no mirror repair. Rollback: revert with phase 3's.
7. **Second download host** (phase 5): its own RFC or an amendment here, before any client
   change.

## Open questions

1. **Which forge is canonical?** Recommended: GitLab for the work, GitHub the public mirror and
   release host (Decision 1, option B).
2. **When does Arca's instance exist, and does phase 0 wait for it?** Recommended: phase 0 starts
   on Arca's own instance only; nothing goes on the instance Brain uses.
3. **Where do issues live?** Recommended: on GitHub, the public intake, with GitLab's issues off,
   so `#N` means one thing and a closing keyword in a mirrored merge commit closes the GitHub
   issue (GitHub closes issues named by closing keywords in commits that reach its default
   branch). A sync job like Brain's waits until the team needs GitLab issues.
4. **Are feature branches public?** Recommended: no; the mirror carries protected branches and
   tags only.
5. **A macOS runner on Arca?** Recommended: not now; the Mac legs and notarisation stay on GitHub's
   hosted macOS. Revisit if Mac failures fixed forward become frequent.
6. **One GitLab user per bot role, or one shared author as Brain does?** Recommended: one per role,
   so a verdict's author is checkable and rights follow the role.
7. **The desktop app's REST API call.** Recommended: a separate desktop delivery gives the app a
   feed pointer like the other parts', so no installed client spends API quota; not part of this
   RFC.
8. **A second download host (phase 5): when, and where on Arca?** Recommended: after phase 4 has
   settled, as its own RFC; clients learn the fallback first, GitHub stays first.
9. **Who may administer the instance?** Recommended: the owner alone, two-factor login for every
   account, since an admin can start a signed release.

## Links

- RFC 0011 (parts, lanes, the signed rolling pointers, Pocket's `latest.json` rule), RFC 0012 (am,
  sources and trust), RFC 0017 (the meter part, `meter-lane` proposed), RFC 0018.
- `.github/workflows/release.yml`, `ci.yml`, `desktop-build.yml`, `follow-omni.yml`,
  `scheduler-release.yml`; `scripts/lane.ts`, `scripts/herdr-lane.ts`, `scripts/am-lane.ts`.
- Readers: `herdr/mods/am-sidebar/release.js`, `herdr/mods/am-sidebar/update.mjs`,
  `herdr/install.sh`, `am/lib/lane.mjs`, `am/lib/self.mjs`, `apps/desktop/src/lane.js`,
  `apps/desktop/src/update.js`, `apps/pocket/android/app/build.gradle.kts`,
  `apps/pocket/android/app/src/main/java/ai/namastex/automagik/Updater.kt`.
- #786 (the "couldn't check" seen on 2026-11-09).
- GitLab's documentation on push mirroring (lag, "Keep divergent refs", the GitHub token's
  scopes).
