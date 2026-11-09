# RFC 0019: the GitLab mirror

| Field | Value |
|---|---|
| Status | Draft (owner's answers: questions 1-9, 2026-11-09; the switch waits on its acceptance gates) |
| Milestone | none (ships outside the five milestones) |
| Lanes | none: CI, workflow and process changes (`.github/` and `scripts/` never ship; `.gitlab-ci.yml` is added to `NEVER_SHIPPED` by delivery 2) |
| Created | 2026-11-09 |

## Summary

The team's work moves to a self-hosted GitLab instance that Arca runs: merge requests, review,
verdicts, merges and the Linux gates before a merge. GitHub stays the official public source and
the release host. A one-way push mirror carries `dev`, `main` and the tags from GitLab to GitHub,
and nothing else writes GitHub's `dev`. Every release, signed pointer and download URL stays where
it is today, so no installed pack, am, desktop app or phone changes how it finds updates. The
release keeps running on GitHub Actions, where the signing keys and the Mac signing and
notarisation runners already are. It writes its version commit and tag to GitLab first. Because
the mirror is a new path onto GitHub's `dev`, every job that signs anything moves behind a GitHub
Environment that the mirror cannot satisfy on its own, before the switch. The switch itself (phase
3) happens only when its acceptance gates hold, and every phase has a rollback.

## Motivation

The owner asked for this RFC on 2026-11-09: "draft the gitlab mirror rfc, we already have
inspiration, brain repo, where this is already going on with certain success. our arca will have
its own git lab instance". There are two goals:

- **Less GitHub load.** The team's bots do almost all of their work through `gh` on one shared
  login: they open pull requests, read diffs and checks, post every verdict as a comment, and
  merge. That login's REST and GraphQL quotas (5,000 an hour each) and GitHub's secondary limits
  on writing content are shared by every bot that uses it. Actions minutes are spent on every push.
  **The load is not measured yet.** One read-only snapshot of the shared login on 2026-11-09
  showed about 6% of the core REST quota and 1.6% of the GraphQL quota used. Phase 3 does not
  start until a week or more of per-login API use and Actions minutes is recorded (gate G1).
- **No single forge.** Today one forge holds the code, the review history, the CI, the secrets,
  the releases and every download URL in the field. An outage, a lockout or a policy change there
  stops all of them at once. This RFC moves the work. Releases and downloads still depend on GitHub
  until phase 5's second download host (Decision 3).

What the motivation is not: the "couldn't check" the owner saw on 2026-11-09 is bug #786 (am-status
gives up on a check request queued behind an automatic update), not a rate limit. #786 is still
open, and its fix is pull request #789, also open. The pack's update check reads release downloads
(`releases/download/herdr-lane/pack.json`), not the REST API.

## Decided

The owner's answers to this RFC's questions (2026-11-09, on PR #791):

1. **Canonical forge: GitLab**, for the work: merge requests, review, merges and the Linux gates.
   GitHub is the public push mirror and the release host. The owner chose this after a council
   review asked for a revision. The council's corrections are in this text. Its evidence items are
   phase 3's acceptance gates, not a separate decision later. Phase 3 stays in the plan.
2. **Arca's own instance already exists.** It is dedicated to this and runs on the team's build
   host. Phase 0 runs only on it, never on the instance Brain uses. Its name and address appear in
   no public text.
3. **Issues stay on GitHub**, with GitLab's issues off.
4. **Feature branches are not public.** The mirror carries protected branches and tags only.
5. **No macOS runner on Arca now.**
6. **One GitLab user per bot role.**
7. **The desktop app's REST call gets its own feed pointer**, in a separate desktop delivery.
8. **A second download host comes after phase 4**, as its own RFC.
9. **The owner alone administers the instance**, with two-factor login for every account.

## What Brain teaches

The Brain repository already works this way. What follows is summarised from a read-only look at
a local checkout (its `.gitlab-ci.yml`, its docs, RFCs and team notes, and its remotes). Nothing
there was changed or run. That checkout is stale (last commit 2026-11-06) and has no `.tools/`
folder, so Brain's merge and review scripts could not be read. What is said about its merge flow
comes from its docs.

- **GitLab is the workspace, GitHub is the source others read.** Brain first named GitLab its
  source of truth. Two days later its owner reversed that: GitHub became the official source and
  GitLab the development workspace. A one-way push mirror carries GitLab's protected `dev` to
  GitHub, nobody pushes to GitHub directly, and review happens in merge requests on GitLab.
- **The release runs on GitHub Actions, on the mirror.** Every merge reaching the mirror's `dev` is
  a release, built on hosted macOS and arm64 runners, so Brain runs no runner fleet of its own. Its
  workflow holds no GitLab credential. It can do without one because Brain's version comes from
  the tag, so no bot commits to `dev`.
- **The push mirror removes refs that exist only on GitHub.** Brain keeps its release tags in a
  separate releases repository for that reason. GitLab's documentation says the same: without
  "Keep divergent refs", the source "overwrites any changes on the remote". With it, "any refs that
  exist in the remote mirror, but not the upstream, are left untouched".
- **Checks run on GitLab before the merge, platform builds after it.** Brain's GitLab CI runs its
  gates on merge requests and on `dev`, on runners of its own. Its macOS and arm64 builds run on
  GitHub after the merge. Its Linux lane before the merge started as advisory and became required
  only after it had proven itself.
- **Bots review on GitLab.** Verdicts are merge request notes carrying the head commit. A merge is
  pinned to the reviewed head, so a head that moved is refused. Counts come from the API's total
  header, because `glab`'s list commands stop at 100 rows. A 405 right after a push is temporary
  (GitLab is recomputing whether the merge can go ahead). GitHub issues are copied into GitLab by a
  scheduled job, and the acknowledgement on GitHub carries no GitLab URL.
- **GitLab is never the download host.** Brain's clients read a signed pointer from a host of their
  own.

Where Automagik differs, and why Brain is thin precedent here: Brain has about ten days of history
in this shape, on a private mirror with three people, a separate releases repository and no bot
writing `dev`. This repository is public and has outside readers (herdr.dev, Omni's market,
installed clients). Its release commits the version to `dev`. Its releases already sit on this
repository, under download URLs that every installed client has compiled in.

## Decision 1: which forge is canonical

"Canonical" here means where `dev` and `main` are written: where merges happen and where the
protected branches live. The other forge receives them through the mirror. In the owner's words,
as Brain settled it, GitHub stays the official public source and the release host. GitLab is the
workspace where merges are made.

**GitHub canonical, with GitLab a read-only copy.** For it: everything already runs on GitHub (ten
workflows, about 3,200 lines; every secret; the Mac and Windows runners; the release writes).
herdr.dev, Omni (`repository_dispatch` into `follow-omni.yml`), Genie's lane and every installed
client read it. Nothing moves, so nothing breaks. Against it: it serves neither goal. The bots
would still work through `gh`, and a GitHub lockout would still stop review, CI and releases.

**GitLab canonical for the work, GitHub the public mirror and release host.** For it: it moves the
traffic the bots generate (pull request reads, check polling, verdict comments, merges) to an
instance whose limits the owner sets. Review and merges go on through a GitHub outage. Brain runs
this shape today. Against it:
- Two forges must be kept in step.
- A release needs both forges up.
- Outside contributors still arrive on GitHub.
- The release must write its version commit to GitLab, which needs one new credential.
- The mirror is a new path onto GitHub's `dev`, and `dev` runs with every signing key (Decision 4).
- The load it removes is not yet measured.
- Review history leaves the public repository.

**GitLab canonical for everything, releases included.** Not proposed. The signing keys, the Mac
notarisation runners and the download URLs in the field are all on GitHub, and the field cannot
move until clients have been released that can read elsewhere (Decision 3).

**Decided: GitLab canonical for the work** (owner, 2026-11-09). It ships in phases, and the switch
waits for its gates. Item by item:

| | GitLab (Arca's instance) | GitHub (`automagik-dev/automagik`) |
|---|---|---|
| Protected `dev` and `main`, merges | yes | read-only: written only by the mirror |
| Merge requests, review, verdicts, merge questions | yes | outside contributors' pull requests only, carried over by hand |
| Gates before a merge (Linux) | GitLab CI, required to merge | outside contributors' pull requests |
| macOS and Windows legs | none | GitHub Actions, as jobs the release waits for (Decision 6) |
| Release, desktop builds, images | none | GitHub Actions, on `dev` after the mirror push |
| Releases, rolling pointers, download URLs | none (a copy only in phase 5) | yes, unchanged |
| Signing keys and certificates | none | GitHub Environment secrets (Decision 4) |
| Issues | off | yes, the public intake |
| herdr.dev, Omni, Genie's lane, raw catalog and installer URLs | none | yes, unchanged |

## Decision 2: how the mirror syncs

- **Direction: one way, from GitLab to GitHub, by a GitLab push mirror** (available on every GitLab
  tier, Free included). GitHub has no pull mirror of its own, and a mirror in both directions
  cannot settle two writes to the same branch. Phase 0 runs the other way only to seed and test the
  instance while GitHub is still canonical. It uses a GitLab pull mirror where the instance's tier
  offers one (Premium and up). Otherwise a scheduled job on Arca fetches the public repository and
  pushes it to the project, which needs no GitHub credential.
- **The mirror's credential: a GitHub deploy key over SSH, with write access.** GitLab's push
  mirror can authenticate by SSH, and GitHub then shows GitLab's public key as a deploy key on this
  one repository. A deploy key is git-only. It cannot call the REST API, so it cannot delete or
  replace release assets, which a contents-write token could (the unsigned `latest.json` on
  `pocket-lane` included). The scratch proof (below) confirms two things: that it can push
  `.github/workflows` changes, and that a ruleset can name it as the only actor allowed to update
  `dev` and `main`. If a ruleset cannot name it, the fallback is a GitHub App installed on this one
  repository with contents write and no other permission. Its token is minted per push and lives
  nowhere else.
- **Refs.** Protected branches (`dev`, `main`) and every tag. Feature branches stay on GitLab
  (decided). "Only mirror protected branches" is on, which also shortens the lag. GitLab's
  documentation does not say whether tags travel with that setting. The scratch proof settles it,
  but nothing depends on the answer: the release pushes its own tag to GitHub (below), and the only
  other tags are the ones imported before the switch, which exist on both forges.
- **Refs that exist only on GitHub.** Several tags exist only on GitHub. Each rolling lane release
  (`plugin-lane`, `herdr-lane`, `pocket-lane`, `am-lane`, and any later one such as RFC 0017's
  proposed `meter-lane`) was made by `gh release create --target dev`, which made its tag. So were
  the `herdr-automations-v*` tags that `scheduler-release.yml` makes. A release whose tag is deleted
  is no longer served at its `releases/download/<tag>/` URLs, and every installed pack, am, desktop
  app and phone would stop updating. Three guards, all required before the switch:
  1. Each of those tags is imported into GitLab as a protected tag, at the exact commit GitHub has,
     so the mirror sees nothing to change.
  2. "Keep divergent refs" is on, so a tag made on GitHub later is left alone.
  3. A GitHub tag ruleset forbids deleting or moving every rolling lane tag, `herdr-automations-v*`
     and `v*`.

  From then on, no lane release is ever deleted or re-created by hand. `refs/pull/*` on GitHub is
  read-only and never touched.
- **The scratch proof, before phase 2.** In a scratch GitLab project mirrored to a scratch GitHub
  repository, with the settings above, record:
  - whether "Only mirror protected branches" carries tags;
  - that "Keep divergent refs" leaves a GitHub-only tag alone;
  - what happens to a tag that exists on both forges at different commits, as `release.yml` would
    make by re-creating a missing lane release;
  - that a push the GitHub ruleset refuses shows up as a mirror error in GitLab;
  - that the deploy key can push `.github/workflows` and can be a ruleset bypass actor.

  The evidence goes in the phase 1 report. Phase 2 does not start without it.
- **Lag.** GitLab's documentation: a push mirror "receives it in five minutes, or one minute if the
  setting Only mirror protected branches is on". GitHub's copy of `dev`, the raw `main` the
  installer one-liner reads and the raw `dev` the catalog is read from all trail GitLab by up to a
  minute.
- **Divergence.** With "Keep divergent refs" on, a GitHub `dev` that something else wrote is
  skipped, not overwritten. The mirror stalls on that branch and GitLab reports an error. Two guards
  prevent it. First, GitHub rulesets: `dev` and `main` accept updates from the mirror's key alone.
  `v*` tags may be created only by the release's identity (the Actions integration if a ruleset
  accepts it as a bypass actor, otherwise a GitHub App token used only for the cut's tag push),
  and never deleted or moved. Lane tags and `herdr-automations-v*` may be created (so
  `scheduler-release.yml` and a re-created lane release keep working) but never deleted or moved.
  Second, a head check (delivery 3) runs on Arca every five minutes. It compares GitLab's
  `dev` and `main` with public GitHub's, needs no GitHub credential, and alerts the owner when they
  differ for more than ten minutes. Repair is always GitLab wins: find the stray commits, carry
  them over as a merge request if they are wanted, and force-update the mirror. The phase 2
  rehearsal tests the rulesets against every branch and tag writer in `.github/workflows`: the
  cut's tag, `scheduler-release.yml`'s tags, a re-created lane release, and the mirror's own push.
- **GitLab's protected branches.** `dev` and `main` accept merges from maintainers through merge
  requests only. Direct pushes come only from the release's token: the version commit, the market
  index commit, `main`'s fast-forward and `follow-omni.yml`'s pin. `v*` and the imported lane tags
  are protected, and only that token creates `v*`.
- **Merge commit messages are public.** The mirror publishes every merge commit message. GitLab's
  merge and squash commit templates hold `%{title}` only: never `%{url}`, never `%{reference}`
  (whose default "See merge request" line names the instance's project path), never
  `%{description}`. The merging bot writes the body itself, with `glab mr merge --sha <reviewed
  head>` and an explicit message. The body is the title plus the closing lines from the merge
  request's Issue section, in the form `Closes automagik-dev/automagik#N`, and the privacy check
  runs on that text first. GitHub's default branch is `dev`, so a closing keyword in a commit the
  mirror pushes closes the GitHub issue. GitLab's issues are off, so it closes nothing there.

**The release's writes, and the remote it reads.** Today `release.yml` writes `dev` (the atomic
push of the version commit and its tag, then the market index commit) and `main` (the
fast-forward). `follow-omni.yml` writes its pin commit. Under the mirror, all of them write GitLab
and read GitLab:

- **The cut** fetches `dev` from GitLab and cuts from GitLab's head, not from the GitHub copy that
  started the run. GitLab's head may be up to a minute ahead, and it then releases those merges
  too, as a queued run does today. It pushes `dev` and the tag to GitLab atomically. After a failed
  push it fetches from GitLab, and keeps today's rule: when `dev` moved meanwhile, neither lands,
  and the run for the newer merge releases both. Only then does it push the same tag object to
  GitHub, so the GitHub release and the desktop builds start without waiting for the mirror. No tag
  or release exists on GitHub before the GitLab push succeeds.
- **The `list` job** pulls and rebases against GitLab's `dev`, and runs `main`'s ancestor check
  against GitLab's `main`.
- **`follow-omni.yml`** reads `dev` (its checkout, and its `ls-remote` before the push) from GitLab
  and pushes the pin there. It no longer calls `release.yml` itself, because that call would read
  a `dev` that may not have the pin yet. The mirror's push of the pin starts the release. Its
  report says so.
- **Mirrored bot commits now start runs.** Today the workflow token's pushes start no run (GitHub
  never starts one for that token). Through the mirror they arrive by the deploy key, so each
  starts `ci.yml` (push to `dev` or `main`) and, on `dev`, `release.yml`. The commits are:
  - `chore(release): v<v>`;
  - the index listing, `chore(release): list v<v> in the market index`;
  - `main`'s fast-forward;
  - `chore(desktop): carry Omni …`.

  The release run started by any of the first three cuts nothing (the existing guard: nothing
  since the last release but the workflow's own commits). The pin's run is the one that releases
  it. `ci.yml` skips a push whose new commits are all bot commits. Its `ci-${{ github.ref }}` group
  with `cancel-in-progress` is keyed by commit for pushes, so a bot commit never cancels the run
  for the merge before it.
- **The GitLab remote's URL is a masked secret**, never a repository variable or a workflow
  literal: variables print in public Actions logs. A credential helper reads the token, so neither
  the URL nor the token appears in argv or in `git remote -v` output. Phase 2's dry run checks that
  no public Actions log or release note shows the host.
- **Tests.** `scripts/release-workflows.test.ts` covers every fetch, pull, `ls-remote` and compare
  in `release.yml` and `follow-omni.yml` reading the remote it writes. It also covers the
  bot-commit skip and the concurrency key, plus a staged lag case: GitHub's `dev` one merge behind
  GitLab's, and GitLab's `dev` moving during the cut.

Brain avoids the GitLab credential by taking the version from the tag. Doing the same here would
change the one-version rule (`version.ts`, the pack's `VERSION`, Pocket's Gradle reading
`package.json`), so it is not proposed.

## Decision 3: releases and the signed rolling pointers stay on GitHub

Every client in the field has its read path compiled in, and most check the host as well:

| Client | Where it reads | What it checks about the host |
|---|---|---|
| Pack updater (`release.js`, `update.mjs`) | `POINTER_URL`, `releases/download/herdr-lane/pack.json` on GitHub | the tarball URL in the signed pointer may be any `https://` (`release.js` `packOfPointer`) |
| `herdr/install.sh` | `RELEASES`, GitHub; the one-liner from raw `main` | refuses any `AUTOMAGIK_HERDR_RELEASE_URL` but `file://` or this GitHub repository; takes the tarball from `$RELEASES/download/v<v>/` |
| am (`am/lib/lane.mjs`, `self.mjs`) | `am-lane` on GitHub | the signed pointer's `repository` must be this GitHub repository and its tarball URL must sit under its `releases/download/<tag>/` (`checkPointer`); `self.mjs` refuses any other release URL |
| Desktop plugin lane (`apps/desktop/src/lane.js`) | `LANE_URL`, `plugin-lane` on GitHub | every plugin URL must start with `https://github.com/` (`laneUpdate`) |
| Desktop app (`apps/desktop/src/update.js`) | the REST API's release list, then GitHub downloads | the one client that uses the REST API: unauthenticated, every 15 minutes, from each install's own address |
| Pocket (`build.gradle.kts`, `Updater.kt`) | `UPDATE_URL`, `releases/download/pocket-lane/latest.json` on GitHub | the APK URL may be any `https://`; its sha256 and the same-signer rule are the check |
| Mod manager | raw `dev`, `herdr/catalog/index.json` on GitHub | none |

So a pointer that moved, or one naming an artifact on another host, would be refused by every
installed am and by every desktop app's plugin lane. The pack, the installer and Pocket would never
read it at all. GitHub cannot redirect a release download to another host, so redirects are not an
option either.

**GitHub release assets stay the stable read path, indefinitely.** Nothing in phases 0 to 4 moves
a pointer, a release, an asset name or a field. `plugin-lane`, `herdr-lane`, `am-lane` and
`pocket-lane` keep their tags, their files and their writers in `release.yml`. Their rules stay as
they are: fail-closed posting, no lower sequence, and `pocket-lane` never Latest and never edited.
RFC 0011 says that moving `latest.json` or changing its fields needs an RFC, and this RFC does
neither. Phase 5 is what would let a client survive GitHub being away (decided: after phase 4, as
its own RFC):

1. **Clients first.** Each client learns a second base URL, used only when the first fails. Every
   check stays the same: the pointer's signature against the same keys, the artifact against the
   pointer's sha256, Pocket's APK against its signer. The host carries no trust, because the
   signature and the hash do. am's `checkPointer` and the plugin lane's `https://github.com/` check
   are relaxed to "the tarball URL is under the base this pointer was read from". The pointer's
   `repository` stays this GitHub repository, as an identity. Pocket gets a list in place of one
   `UPDATE_URL`. Each change is a release of its own part, like the first phase of a key rotation
   (RFC 0011, "Making the key").
2. **Dual-publish second.** After uploading to GitHub, the release uploads the same bytes to the
   second host: the artifacts, `pack.json`, `am.json` and `lane.json` with their `.sig` files, and
   `latest.json`. The same fail-closed and no-lower-sequence rules apply. No pointer is re-signed
   for it: the second host serves the files GitHub serves.
3. **Never switch until the field has the fallback.** GitHub stays first in every client. Making
   the second host first would need its own RFC, once the clients that know about it are most of
   the field.

*Council dissent (2026-11-09):* phase 5 should ship before the switch or alongside it, because
it is the change that keeps installed clients updating when GitHub is away. The switch moves only
the work. The owner placed phase 5 after phase 4 (question 8).

The desktop app's REST API call is the one place an installed client spends GitHub API quota. It
gets a feed pointer like the other parts', in a desktop delivery of its own (decided, question 7).

## Decision 4: keys and secrets

**What the mirror changes.** Release secrets are repository secrets today, with no
`environment:` gate anywhere in `.github/workflows`. `release.yml` runs on every push to `dev`, and
the copy that runs is the pushed one. Anyone who can put a commit on GitHub's `dev` can therefore
change a workflow, a script the cut runs or a dependency it installs, and read
`HERDR_PACK_KEY(_NEXT)`, `AM_LANE_KEY(_NEXT)`, `PLUGIN_LANE_KEY` and `POCKET_SIGNING_*` on the
first run. Under the mirror, each of these can put a commit on GitHub's `dev`:
- a merge on GitLab's `dev`;
- an instance admin;
- root on the instance's host;
- the instance's backups;
- the mirror's key.

Each of them would reach every signing key. Required before the switch:

- **Every signing job runs behind a GitHub Environment the mirror cannot satisfy alone.** The
  signing secrets move from repository secrets to the secrets of one Environment (proposed
  `release-signing`). Every job that uses one names it: in `release.yml`, `cut` (pack, plugin lane
  and am check-key), `pocket` and `am-lane`; in `desktop-build.yml`, the Mac and Windows signing
  legs. A workflow changed to drop the `environment:` line loses the secrets, it does not gain
  them. The Environment requires a reviewer whose credentials live nowhere the mirror path reaches
  (not on Arca's instance or its host). That is the owner, with "prevent self-review" on, so the
  actor that started a run cannot approve it. One approval covers every signing job of a run.
- **A GitHub-side check on workflow changes.** The release's first job runs without secrets. It
  lists every change since the last release under `.github/workflows/`, `scripts/` and the
  lockfiles, and writes that list into the run summary the reviewer sees before approving. A run
  whose range changes `.github/workflows/` is marked in red.
- **GitHub write access narrows.** `workflow_dispatch` on `release.yml` and the schedule and
  dispatch on `follow-omni.yml` remain. After the switch, GitHub write access is held only by the
  owner and the release's own identities. Bots get the Triage role (issues and labels, no write),
  so no bot can dispatch a release or push.

What this costs: a release stops being fully automatic. It waits for one approval per run. That is
the price of a second path onto `dev`. The alternative the council allowed, the owner accepting
the larger trust boundary in writing, is not proposed.

| Secret | Where it lives | Which runner sees it |
|---|---|---|
| `HERDR_PACK_KEY`, `HERDR_PACK_KEY_NEXT` | the `release-signing` Environment | `release.yml`'s `cut`, GitHub-hosted Linux, after approval |
| `AM_LANE_KEY`, `AM_LANE_KEY_NEXT` | the `release-signing` Environment | `cut` (check-key) and `am-lane`, GitHub-hosted Linux, after approval |
| `PLUGIN_LANE_KEY` | the `release-signing` Environment | `cut`, GitHub-hosted Linux, after approval |
| `POCKET_SIGNING_KEYSTORE`, `POCKET_SIGNING_PASSWORD` | the `release-signing` Environment | `cut` (presence only) and `pocket`, GitHub-hosted Linux, after approval |
| Mac and Windows signing (`MAC_CSC_*`, `APPLE_API_*`, `WIN_CSC_*`, `AZURE_CLIENT_ID`) | the `release-signing` Environment | `desktop-build.yml`'s signing legs, GitHub-hosted macOS and Windows, after approval |
| The mirror's deploy key (new) | GitLab's push mirror setting; GitHub holds only its public half | GitLab itself; no CI job |
| The release's GitLab token and the remote's URL (new) | masked GitHub Actions secrets (proposed `GITLAB_RELEASE_TOKEN`, `GITLAB_RELEASE_REMOTE`) | the push steps of `cut` and `list`, and `follow-omni.yml`'s push step |

- **No signing key goes to GitLab or to an Arca runner**, in any phase. GitLab CI runs gates only,
  with no secret at all.
- **The release's GitLab token** is a project access token with `write_repository` on the one
  project. Its bot user may push the protected `dev` and `main` and create `v*` tags. It holds over
  GitLab what `release.yml`'s workflow token holds over GitHub's `dev` today. A leak is answered by
  revoking it in GitLab, after which the release stops at its push.
- The token expires. Its renewal date goes in the owner's calendar, and an expired token stops the
  cut loudly. A broken mirror key shows up in the head check.

## Decision 5: the herdr.dev listing

herdr.dev's crawler reads this GitHub repository: its top-level folders and the topics set in its
settings. Under the mirror, GitHub's tree is GitLab's `dev` and `main` within a minute. Topics are
repository settings, not git content, so the listing sees exactly what it sees today. Nothing
changes and nothing is added: no `herdr-mod` or `herdr-layout` topic until the owner opens the
listing (AGENTS.md), no `layouts/` in a herdr-mod entry folder, and `herdr-layout/` as it is. A
stalled mirror makes the listing and the raw catalog stale, never wrong, and the head check reports
it.

## Decision 6: CI parity

| Today on GitHub Actions | Under the mirror |
|---|---|
| `ci.yml`'s Linux jobs (`repo`, `herdr`, `scheduler`, `am`, `pocket`, `meter`, `dsh-sandbox`, `plugin`, `pets`, `boot`, the Linux legs) | GitLab CI on Arca's Linux runners, before the merge, required to merge; on GitHub only for outside contributors' pull requests (phase 4) |
| `ci.yml`'s macOS legs (`pocket-link`, `usagemeter`) and Windows legs (`desktop`, `acp-windows`) | GitHub Actions, as jobs `release.yml` runs on the commit it cuts and waits for before it tags |
| `commitlint.yml` | GitLab CI, on every merge request |
| `release.yml`, `desktop-build.yml` (macOS signing and notarisation on hosted macOS) | GitHub Actions, started by the mirror's push to `dev`, behind `release-signing` |
| `follow-omni.yml` (schedule, Omni's `repository_dispatch`) | GitHub Actions; reads and pushes GitLab (Decision 2) |
| `server-image.yml`, `linux-image.yml` (GHCR), `scheduler-release.yml`, `boot-check.yml`, `herdr-harness.yml` | GitHub Actions, unchanged |

- **The release waits for macOS and Windows.** Every merge to `dev` is a release, so a platform leg
  that ran only after the merge would let a macOS-only or Windows-only failure reach installed apps
  before anyone saw it. Platform-only failures have happened here before. The four legs therefore
  become a reusable workflow that `release.yml` calls on the commit it is about to cut, and the cut
  `needs` them. A red leg stops the release before the tag, and the merge is fixed forward. This
  adds the legs' run time to every release.
- **Same commands, two schedulers.** Every gate is already a command in the repository (AGENTS.md
  lists each part's). The GitLab jobs call the same commands with the same pins: Node 22 newest and
  24, Bun 1.4.4, JDK 17 and SDK 35, the meter crate's toolchain. A test beside
  `release-workflows.test.ts` checks that each `ci.yml` Linux job has a GitLab job running the same
  commands, so the two cannot drift. Two herdr gate steps pass the workflow token as a GitHub API
  fallback. On GitLab they run unauthenticated, and the parity test records that as a known
  difference.
- **Runners.** GitLab's runners use an ephemeral container executor: no shell executor, no Docker
  socket in jobs, no secrets, and not shared with Brain or other projects. The `usagemeter` job's
  Linux leg keeps AGENTS.md's build rule: one cargo build at a time (a GitLab `resource_group`,
  plus the host's gate lock), with `CARGO_BUILD_JOBS=4`.
- **Mac signing and notarisation stay on GitHub's hosted macOS runners** (decided: no macOS runner
  on Arca now). They need macOS, the Apple credentials and the certificates. Moving them would put
  those secrets on a second system.
- **Shadow first.** Phase 1 runs the GitLab jobs beside Actions for two weeks. Both must agree on
  every pull request before GitLab CI becomes the merge gate.

## Decision 7: how the team's bots work

| Today (`gh`) | Under the mirror (`glab`, against Arca's instance) |
|---|---|
| `gh pr create --base dev` | `glab mr create --target-branch dev` |
| `gh pr view`, `gh pr diff`, `gh pr checks` | `glab mr view`, `glab mr diff`, `glab ci status` |
| a verdict as a pull request comment carrying the head (`SHIP`, `FIX-FIRST`, `BLOCKED`, the gate's count) | the same verdict as a merge request note, same tokens, format and head |
| the merge question to Chat, then `gh pr merge --match-head-commit` by Chat | the same question, then `glab mr merge --sha <reviewed head>` by Chat, which GitLab refuses if the head moved |
| the merge rules (CI newer than `dev`, no push after a SHIP, three verdicts on one head, no merge while a release runs) | unchanged; enforced by the merging bot, since GitLab Free does not enforce approval rules; release runs are still read on GitHub (`gh run view`, read-only) |
| issues, labels, releases (`gh issue`, `gh release view`) | unchanged on GitHub, Triage role |

- **Rate limits.** The instance's limits are the owner's to set, so the bots' review traffic no
  longer spends GitHub quota. GitHub keeps the issue and release reads, and the release workflow's
  own calls on the workflow token's quota. Phase 3's gate G1 records whether this matters: the
  per-login data, compared with the cheaper alternatives (one GitHub login per bot role, or a
  GitHub App).
- **`glab` habits.** Counts come from the API's total header, never from the rows a list command
  prints (they stop at 100). State filters use `glab api`. A 405 right after a push is retried only
  after checking whether the merge request already merged.
- **One user per role** (decided). Reviewers and testers get reporter rights, workers get developer
  rights (pushing feature branches), and Chat and the owner get maintainer rights (merging).
  Separate users make a verdict's author checkable. Bot users authenticate with tokens, so
  two-factor login does not cover them. Their tokens are scoped to the one project and expire.
- **Numbers change.** A merge request is `!N`, not `#N`, and its numbering starts again. Briefs,
  memories and reports name a merge request as `!N`. An issue keeps GitHub's `#N`.
- **Outside contributors.** A pull request on GitHub is reviewed there in the open, then carried to
  GitLab by a maintainer as a merge request that keeps the author's commits. The GitHub pull
  request is closed with a note naming the merge commit, never an instance URL.
- **The public repository rule** covers everything the mirror publishes (merge commit messages, the
  release's notes) as it covers GitHub's own text. Merge request notes on the instance are not
  public, but still carry no secrets. The privacy check scans `herdr/` only, so for `docs/` and
  merge messages the reviewer greps for names, hosts, addresses and paths.

## Decision 8: phased rollout

| Phase | What changes | Acceptance check | Rollback |
|---|---|---|---|
| 0. Read replica | Arca's GitLab copies GitHub (all branches and tags) by a pull mirror or a scheduled fetch-and-push job; issues and merge requests off | GitLab's `dev` equals GitHub's within the copy interval for a week | delete the project; nothing reads it |
| 1. Shadow CI and the scratch proof | `.gitlab-ci.yml` with the Linux gates and commitlint, not required; the scratch mirror proof (Decision 2); the load measurement for G1 starts | two weeks in which GitLab and Actions agree on every Linux job; the proof's evidence recorded | remove the file or stop the runner; delete the scratch projects |
| 2. Ready to switch, still on GitHub | the release and `follow-omni.yml` read and push the remote named by the masked secret (still GitHub); the platform legs become jobs the release waits for; `release-signing` and its approval live on GitHub; the lane and `herdr-automations-v*` tags imported to GitLab as protected tags at GitHub's commits; the rulesets drafted and tested against every writer; the merge commit template set; the bots' `glab` users and briefs ready; the head check running | a dry run against the scratch projects: the release pushes there, the tag lands on the scratch GitHub, no public log or release note shows the host; a full merge request rehearsed there (three verdicts on the head, Chat's `glab mr merge --sha`) | revert; the secret keeps GitHub as the remote |
| 3. The switch | see below | see below | the runbook below |
| 4. Settle | `AGENTS.md`, the RFC process (`docs/rfcs/README.md`: merge requests to `dev`), the brief templates and memories say merge request and `glab`; `ci.yml`'s Linux jobs run on GitHub only for outside pull requests | a week of merges with no manual mirror repair | revert the docs with phase 3's rollback |
| 5. Second download host (its own RFC) | clients learn a fallback base URL (one release per part); then the release dual-publishes to a host on Arca | an install in the field updates from the fallback with GitHub blocked | stop dual-publishing; clients still read GitHub first |

**Phase 3, the switch.** Merges freeze for the window, which starts when no release run is still
going. GitLab stops copying and becomes canonical, with protected `dev`, `main`, `v*` and the
imported tags. The push mirror goes on, with protected branches only and divergent refs kept, and
the GitHub rulesets go on. The masked secret points the release at GitLab, and GitLab CI becomes
required. Open pull requests are carried over as merge requests, the bots move to `glab`, and bots
lose GitHub write access.

**Phase 3's acceptance gates.** All of these hold before the switch:
- **G1, load.** A week or more of per-login REST, GraphQL and secondary-limit data and of Actions
  minutes, recorded from phase 1, beside what one GitHub login per bot role or a GitHub App would
  give. The owner sees it before the window.
- **G2, mirror semantics.** The scratch proof's evidence, from phase 1.
- **G3, the instance.** A stated uptime target and backup target, a tested restore, runner
  capacity, a patch cadence (critical GitLab security releases within 72 hours), and a list of who
  has root on its host.
- **G4, signing.** `release-signing` holds every signing secret, no repository secret is left,
  every signing job names it, the approval has been exercised once, and the workflow-change
  summary shows in the approval.
- **G5, rulesets.** Tested against every branch and tag writer (Decision 2).
- **G6, Brain's record.** Brain's mirror lag, stalls and manual repairs, from its maintainers
  through the owner.
- **G7, the runbook.** The rollback runbook for "GitLab unreachable" is written and has been
  rehearsed once on the scratch projects.

All of these hold after the switch, or it is rolled back:
- An installed pack, am, desktop app and phone each update from a release cut after the switch.
- `pack.json`, `am.json`, `lane.json` and `latest.json` and their signatures read correctly at their
  `releases/download` URLs.
- A deliberate probe shows that a GitHub-only tag survives a mirror run.

**Rollback, and the runbook for "GitLab unreachable".**
1. **Freeze.** No merge on either forge and no release run (the cut's remote secret is emptied,
   so a run stops before anything is written).
2. **The baseline.** Only the mirror writes GitHub's `dev`, so GitHub's `dev` is the last
   successful mirror. No comparison with GitLab is needed to know it, which matters when GitLab
   cannot be read.
3. **Resume on GitHub.** The push mirror goes off, the rulesets come off, the remote secret points
   the release at GitHub, bots get write access back, and merges resume on GitHub. Each open merge
   request is re-opened by its author as a pull request.
4. **When GitLab is back.** Every commit on GitLab's `dev` that GitHub's lacks (merged but never
   mirrored) is carried over as a pull request, and the runbook lists them. GitLab-only branches
   are kept, and the merge request history stays on GitLab, archived. GitLab's protected `dev`,
   `main` and `v*` are unprotected, so phase 0's copy can force-update them, and GitLab goes back
   to phase 0.

The owner decides when an outage is long enough to run this.

## Decision 9: what Arca's own instance changes

- **The limits are ours.** The instance's rate limits, runner capacity and retention are the
  owner's settings, not a hosted plan's.
- **It is part of the release's trust.** A merge on its `dev`, an instance admin, root on its host,
  its backups or the mirror's key can each put code on GitHub's `dev`. Decision 4's Environment is
  what keeps that code away from the signing keys. The owner alone administers it (decided), and
  every human account uses two-factor login.
- **How GitHub reaches it.** The release's push and nothing else crosses from GitHub to the
  instance: GitHub-hosted runners push the version commit and tag over HTTPS with the release's
  token. So the instance accepts inbound HTTPS, through a reverse proxy that passes only the git
  endpoints of the one project. It is hardened like a public GitLab: sign-up off, two-factor login
  enforced instance-wide, no public projects, critical security releases applied within 72 hours.
  The head check and phase 0's copy run on Arca and need no inbound path. The TLS certificate
  appears in public Certificate Transparency logs, so the host's name can be found anyway. Keeping
  it out of our text is hygiene, not a security boundary.
- **When GitHub cannot reach it,** the cut fails at its GitLab push. That is before any tag or
  GitHub release exists, so nothing is published and no lane moves. Merges keep landing on GitLab,
  and the next run that can push releases them together, as queued runs do today.
- **A release needs both forges up.** GitHub runs and publishes the release, and GitLab takes the
  version commit. While the instance is down, nothing merges and nothing releases, but releases
  already out keep serving from GitHub and no installed client notices. A long outage is answered
  by the runbook above.
- **It is private.** Its address appears in no public text. Outside contributors cannot reach it,
  which is why GitHub stays the public intake.
- **Operations.** Backups (repositories and merge request history), restores, upgrades and the
  runners are a new duty. Review history now lives on the instance first, and GitHub keeps only
  the merged commits.
- **Not Brain's instance.** Automagik goes on Arca's own instance (decided). The two share
  practices, not a server.

*Council dissent (2026-11-09):* the owner as the only admin is a bus factor on the system that
gates every merge, and on the approval every release now waits for. A second admin, or a written
break-glass procedure, would remove it. The owner chose sole administration (question 9).
The runbook above is the break-glass path for merges.

*Council minority (security lens, 2026-11-09):* keep the instance closed to all inbound traffic,
and replace the release's push with jobs on Arca that pull the release commit and tag from public
GitHub. Not proposed: a tag published on GitHub before GitLab's `dev` holds its commit breaks the
cut's atomic "both or neither" rule, and a merge landing meanwhile would leave a release tag off
`dev`.

## Contracts introduced

- **No client contract changes.** Every download URL, rolling release, pointer file, field, key and
  asset name stays as RFC 0011, RFC 0012 and RFC 0017 define it.
- **Canonical branches move.** `dev` and `main` are written on Arca's GitLab, and GitHub's are a
  mirror. A pull request on GitHub is no longer merged there.
- **Signing secrets move** from repository secrets to the `release-signing` Environment (proposed
  name). Each release run waits for one approval.
- **New secrets and settings.** The mirror's deploy key; `GITLAB_RELEASE_TOKEN` and
  `GITLAB_RELEASE_REMOTE` (proposed names, masked secrets); GitHub rulesets on `dev`, `main`, `v*`,
  every rolling lane tag and `herdr-automations-v*`; GitLab protected branches and tags; merge and
  squash commit templates of `%{title}` only.
- **New files.** `.gitlab-ci.yml` (added to `scripts/lane.ts`'s `NEVER_SHIPPED`, so a CI-only change
  cuts no desktop build), its parity test, and a reusable workflow for the macOS and Windows legs.
- **Process.** Merge requests to `dev` on GitLab; verdicts as merge request notes; `!N` for merge
  requests and `#N` for GitHub issues; bots hold the Triage role on GitHub.

## Threat model

- **The new path onto `dev`.** Five things can each put code on GitHub's `dev`, which runs with
  every signing secret: a merge on GitLab's `dev`, an instance admin, root on the instance's host,
  its backups, and the mirror's key. Without Decision 4, any of them reads `HERDR_PACK_KEY(_NEXT)`,
  `AM_LANE_KEY(_NEXT)`, `PLUGIN_LANE_KEY` and `POCKET_SIGNING_*` on its first run, and could sign a
  pack, an am, a plugin lane or an APK that every installed client would take. Answered by:
  - the `release-signing` Environment, whose approver's credentials are off that path;
  - the workflow-change summary in the approval;
  - protected `dev` on both forges;
  - owner-only administration;
  - the head check, which shows a GitHub `dev` that moved without GitLab.
- **The mirror's key.** It is git-only, cannot touch release assets, and is the only actor the
  ruleset lets update `dev` and `main`. A leak lets an attacker push `dev` (answered as above) but
  not delete or move a protected tag. It is answered by removing the deploy key on GitHub.
- **The release's GitLab token.** It can push `dev`, `main` and `v*` on GitLab. It sits where the
  workflow token's matching power already sits, and only the push steps receive it. A leak is
  answered by revoking it.
- **`workflow_dispatch`.** Any GitHub writer can dispatch `release.yml` or `follow-omni.yml`. After
  the switch, only the owner and the release's identities hold write, and a dispatched release
  still waits for the approval.
- **Deleted or moved tags.** The mirror could delete the rolling lane tags and stop every installed
  client's updates. Answered by importing them as protected GitLab tags at GitHub's commits, by
  keeping divergent refs, by the tag ruleset, and by the scratch proof and the post-switch probe.
- **Leaking the instance's address.** Merge commit messages, release notes and Actions logs are
  public. Answered by the `%{title}`-only templates, merge bodies written and privacy-checked by
  the merging bot, and the remote's URL kept in a masked secret and checked absent in phase 2. The
  certificate's name in public logs is accepted (Decision 9).
- **Runners.** GitLab CI runs code from any feature branch. Answered by ephemeral container
  runners with no secrets, no Docker socket, and no project shared with them.
- **Undo.** The runbook restores today's setup without losing a merge: GitHub's `dev` is known to
  be the last mirror, and GitLab-only commits are carried over as pull requests.

## Deliveries

Each delivery is one merge request (one pull request before the switch), on no part's lane:
`.github/`, `scripts/` and `docs/` never ship, and delivery 2 makes `.gitlab-ci.yml` never ship.

1. **Instance and read replica** (phase 0; settings only, no repository change). Acceptance:
   GitLab's `dev` equals GitHub's for a week. Rollback: delete the project.
2. **GitLab CI shadow and the scratch proof** (phase 1). `.gitlab-ci.yml`, the parity test and
   `NEVER_SHIPPED`; the proof's evidence; the load measurement. Acceptance: two weeks of agreement
   with Actions, and the proof recorded. Rollback: revert; nothing depends on it.
3. **The head check** (phase 2). A scheduled job on Arca comparing GitLab's `dev` and `main` with
   public GitHub's, alerting after ten minutes of difference. Acceptance: it alerts on a staged
   difference in the scratch projects. Rollback: remove it.
4. **Release remote and its races** (phase 2). `release.yml` and `follow-omni.yml` read and push the
   remote the masked secret names (GitHub until the switch), then push the tag to GitHub.
   `follow-omni.yml` hands the release off to the mirror's push. `ci.yml` skips bot-only pushes and
   keys its push concurrency by commit. `release-workflows.test.ts` covers both remotes, the
   bot-commit runs and the staged lag case. Acceptance: the scratch dry run, with no host in any
   public log. Rollback: the secret, or a revert.
5. **Signing behind an Environment, and the platform legs before the tag** (phase 2).
   `release-signing` and its approval; the workflow-change summary; the macOS and Windows legs as a
   reusable workflow the cut needs. Acceptance: one release approved and cut with the secrets read
   only from the Environment; a staged red leg stops a release before its tag. Rollback: revert,
   and copy the secrets back to the repository.
6. **The switch** (phase 3; settings, the secret, the bots' tooling). Acceptance: gates G1 to G7
   before, the post-switch checks after. Rollback: the runbook.
7. **Docs and process** (phase 4). `AGENTS.md`, `docs/rfcs/README.md`, brief templates; `ci.yml`'s
   Linux jobs limited to outside pull requests. Acceptance: a week of merges with no mirror repair.
   Rollback: revert, with the runbook.
8. **Second download host** (phase 5): its own RFC, before any client change.

## Open questions

All nine of this RFC's questions are answered (see Decided, 2026-11-09). One question comes from
the review, and it blocks delivery 5:

1. **Who may approve `release-signing` besides the owner?** Recommended: the owner alone at first,
   with the approval done from GitHub's mobile app so releases do not queue for long, and a
   second approver added once one exists whose credentials are off the mirror path.

## Links

- RFC 0011 (parts, lanes, the signed rolling pointers, Pocket's `latest.json` rule), RFC 0012 (am,
  sources and trust), RFC 0017 (the meter part, `meter-lane` proposed), RFC 0018.
- `.github/workflows/release.yml`, `ci.yml`, `desktop-build.yml`, `follow-omni.yml`,
  `scheduler-release.yml`; `scripts/lane.ts`, `scripts/herdr-lane.ts`, `scripts/am-lane.ts`,
  `scripts/release-workflows.test.ts`.
- Readers: `herdr/mods/am-sidebar/release.js`, `herdr/mods/am-sidebar/update.mjs`,
  `herdr/install.sh`, `am/lib/lane.mjs`, `am/lib/self.mjs`, `apps/desktop/src/lane.js`,
  `apps/desktop/src/update.js`, `apps/pocket/android/app/build.gradle.kts`,
  `apps/pocket/android/app/src/main/java/ai/namastex/automagik/Updater.kt`.
- #786 (the "couldn't check" seen on 2026-11-09) and its fix, pull request #789 (both open).
- GitLab's documentation on push and pull mirroring (lag, "Keep divergent refs", tiers).
