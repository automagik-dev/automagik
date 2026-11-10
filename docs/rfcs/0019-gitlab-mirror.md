# RFC 0019: the GitLab mirror

| Field | Value |
|---|---|
| Status | Queued (owner's answers: 1-11, 2026-11-09; the switch waits on gates G1-G8; only the RFC: #791; deliveries 0-1 unverified) |
| Milestone | none (ships outside the five milestones) |
| Lanes | none: CI, workflow and process changes (`.github/` and `scripts/` never ship; `.gitlab-ci.yml` is added to `NEVER_SHIPPED` by delivery 2) |
| Created | 2026-11-09 |

## Summary

The team's work moves to a self-hosted GitLab instance that Arca runs: merge requests, review,
verdicts, merges and the Linux gates before a merge. GitHub stays the official public source and
the release host. A one-way push mirror carries `dev`, `main` and the tags from GitLab to GitHub,
and nothing else writes GitHub's `dev`. Every release, signed pointer and download URL stays where
it is today, so no installed pack, am or phone changes how it finds updates. The release keeps
running on GitHub Actions, where the signing keys and the Mac signing and notarisation runners
already are. A run cuts only the commit that started it, and it writes its version commit and tag
to GitLab first. The mirror is a new path onto GitHub's `dev`, so before the switch every job that
signs anything moves behind a GitHub Environment, `release-signing`. The project's orchestrator bot
approves that Environment on an identity of its own. The desktop app's unsigned update feed is
closed before the switch (gate G8). The switch itself (phase 3) happens only when its acceptance
gates hold, and every phase has a rollback. A section on alternatives compares other forges and
their limits; it informs the decision and does not reopen it.

## Motivation

The owner asked for this RFC on 2026-11-09: "draft the gitlab mirror rfc, we already have
inspiration, brain repo, where this is already going on with certain success. our arca will have
its own git lab instance". There are two goals:

- **Less GitHub load.** The team's bots do almost all of their work through `gh` on one shared
  login: they open pull requests, read diffs and checks, post every verdict as a comment, and
  merge. That login's REST and GraphQL quotas (5,000 an hour each) and GitHub's secondary limits
  on writing content are shared by every bot that uses it. **The load is not measured yet.** One
  read-only snapshot of the shared login on 2026-11-09 showed about 6% of the core REST quota and
  1.6% of the GraphQL quota used. Phase 1 records a week or more of per-login API use and Actions
  minutes (gate G1, informational), and the alternatives below show the cheaper levers.
- **No single forge.** Today one forge holds the code, the review history, the CI, the secrets,
  the releases and every download URL in the field. An outage, a lockout or a policy change there
  stops all of them at once. This RFC moves the work. Releases and downloads still depend on GitHub
  until phase 5's second download host (Decision 3).

What the motivation is not: the "couldn't check" the owner saw on 2026-11-09 is bug #786 (am-status
gives up on a check request queued behind an automatic update), not a rate limit. #786 is still
open, and its fix is pull request #789, also open. The pack's update check reads release downloads
(`releases/download/herdr-lane/pack.json`), not the REST API.

## Decided

The owner's answers (2026-11-09, on PR #791):

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
10. **The project's orchestrator bot approves signing runs** (asked at head cb744ea6). It approves
    on its own GitHub identity, which is not the mirror's credential, not the account that merges
    and not the release workflow's token. So no single one of them can both put a workflow on `dev`
    and unlock signing (Decision 4). Asked again after the second council review, the owner kept
    the bot and asked for the risk to be recorded. Root on the build host, or an agent there whose
    groups are equal to root, gets both the mirror path and the approval. The owner accepts this in
    writing at gate G4, before the switch.
11. **The unsigned desktop feed is closed before phase 3** (gate G8). Either the signed desktop feed
    (question 7's delivery) ships first, or Windows builds are signed with `publisherName` and Linux
    updates are checked against something signed.

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

## Alternatives: other forges and their limits

The owner asked (2026-11-09) how GitLab's cloud, Gitea, or an open-source programme compare, and
whether any of them is more generous than GitHub on free runners and API limits. This section
informs Decision 1 and does not reopen it. Every number comes from the vendor's own documentation,
read on 2026-11-09 (links at the end of the section). Anything the docs did not state is marked
unverified.

**Our measured use.** One read-only snapshot of the team's shared GitHub login (2026-11-09): about
6% of the core REST quota and 1.6% of the GraphQL quota used. One login, one moment: peak hours and
secondary-limit hits are not measured (gate G1).

**GitHub, as it is today**
- Actions minutes: standard GitHub-hosted runners in public repositories are free and do not count
  against the included usage, and so are self-hosted runners [1].
- Concurrent jobs on the Free plan: 20 in total, 5 of them macOS [2]. "GitHub Support can increase
  job concurrency limits" [2]. Which plan this organisation is on was not checked (unverified).
- A hosted job runs at most 6 hours, and a self-hosted job up to 5 days [2].
- REST: 5,000 requests an hour per user; a GitHub App installation starts at 5,000 and scales by
  repositories and users up to 12,500; `GITHUB_TOKEN` gets 1,000 an hour per repository;
  unauthenticated, 60 an hour per address [3].
- GraphQL: 5,000 points an hour per user; an installation 5,000, up to 12,500; `GITHUB_TOKEN` 1,000
  points an hour per repository [4].
- Secondary limits, shared by REST and GraphQL: 100 concurrent requests; 900 points a minute on
  REST and 2,000 on GraphQL; 80 content-generating requests a minute and 500 an hour [3].
- No GitHub programme for open-source projects that raises Actions or API limits was found in
  these docs (unverified as absent).

**GitLab.com (GitLab's cloud)**
- Free tier: 400 compute minutes a month per namespace [5]. macOS hosted runners (beta) cost 6 or
  12 minutes per minute, Windows 1 [5].
- GitLab for Open Source: Ultimate features and 50,000 compute minutes at a programme cost factor
  [6]. The page does not say the minutes are monthly (unverified). Public projects in the programme
  are charged at half rate [5]. Eligibility: every project in the namespace under an OSI-approved
  licence (this repository is Apache-2.0), public, and an organisation that may accept donations
  but "can't seek to make a profit" by selling services or add-ons; membership is renewed every
  year, with no support [6]. Whether this organisation qualifies was not checked (unverified).
- API: today 2,000 authenticated requests a minute per user, 500 a minute per address
  unauthenticated. Proposed Free-tier limits, not yet in effect: 5,000 an hour per user and per
  top-level group [7].

**GitLab, self-managed (Arca's instance)**
- API rate limits are off by default, and the admin sets them [8]. The compute-minutes page says
  quotas cover instance runners, are off by default, and are enabled per group or namespace [5].
  That no quota applies to our own runners unless the admin enables one is our reading of that
  page, not its words.

**Gitea, Forgejo and Codeberg**
- Gitea Actions is built in since Gitea 1.19, and runners are run by the user ("Gitea doesn't run
  the jobs itself") [9]. Whether Gitea Cloud offers hosted runners is not stated (unverified).
- Codeberg (Forgejo) provides hosted Actions "in limited fashion" [10]: fair use, runners of 1 to 4
  CPUs with 2, 5 or 10 minute runtimes, public projects under a "free/libre license" only, and "no
  extensive pipelines to assist LLM-driven workflows" [11]. Users may connect their own runners,
  which need no public address [10]. Codeberg points hosted CI to Woodpecker CI [10]. The "limited
  open alpha" wording in the brief was not found (unverified).

**Self-hosted runners, on any forge**
- Free of minute limits on GitHub [1], GitLab [5] and Forgejo or Gitea [9, 10]. On a public GitHub
  repository a self-hosted runner can run code from outside pull requests, so it needs the same
  isolation as Decision 6's GitLab runners.

**What each one changes for the two goals**

| Option | Load (API and runners) | Forge independence |
|---|---|---|
| Stay on GitHub, change nothing | none; measured use is low | none |
| GitHub with one GitHub App per bot role | each App installation has its own quota (5,000 to 12,500 an hour), so roles stop sharing one login's budget | none |
| GitHub with self-hosted runners | no minute limits, and Linux jobs leave hosted capacity | none |
| GitLab.com Free or Open Source | bots' API traffic moves; 400 minutes a month is likely far below our use (G1 measures it), and the programme's eligibility is unverified | partly: the work moves to another vendor's cloud |
| Codeberg or Gitea | hosted runners are limited or unstated; fair use excludes heavy LLM-driven pipelines | partly, as above |
| Arca's own GitLab (decided) | API limits and runners are ours | the work no longer depends on one vendor; releases still do until phase 5 |

The cheapest levers need no switch at all: one GitHub App per bot role, so each role has its own
quota, and self-hosted runners for the Linux jobs. They address load, not forge independence. The
owner chose Arca's GitLab for both goals (Decided 1).

Sources (vendor documentation, read 2026-11-09):
1. GitHub, "GitHub Actions billing": https://docs.github.com/en/billing/concepts/product-billing/github-actions
2. GitHub, "Actions limits": https://docs.github.com/en/actions/reference/limits
3. GitHub, "Rate limits for the REST API": https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
4. GitHub, "Rate limits and query limits for the GraphQL API": https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
5. GitLab, "Compute minutes": https://docs.gitlab.com/ci/pipelines/compute_minutes/
6. GitLab, "GitLab for Open Source": https://about.gitlab.com/solutions/open-source/join/
7. GitLab, "GitLab.com rate limits": https://docs.gitlab.com/user/gitlab_com/rate_limits/
8. GitLab, "User and IP rate limits": https://docs.gitlab.com/administration/settings/user_and_ip_rate_limits/
9. Gitea, "Gitea Actions overview": https://docs.gitea.com/usage/actions/overview
10. Codeberg, "Using Forgejo Actions": https://docs.codeberg.org/ci/actions/
11. Codeberg, "actions/meta": https://codeberg.org/actions/meta

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
  `pocket-lane` included). It is the only deploy key on the repository, and the deploy keys are
  inventoried at G4. The owner's account adds it, never a bot's. The scratch proof (below) confirms
  that it can push `.github/workflows` changes and that a ruleset can name it as a bypass actor. If
  a ruleset can name only "deploy keys" as a class, the one-key inventory is what makes that safe.
  If it cannot be named at all, the fallback is a GitHub App installed on this one repository with
  contents write and no other permission, its token minted per push and kept nowhere else.
- **Refs.** Protected branches (`dev`, `main`) and every tag. Feature branches stay on GitLab
  (decided). "Only mirror protected branches" is on, which also shortens the lag. GitLab's
  documentation does not say whether tags travel with that setting, and the scratch proof settles
  it. The only tags are `v*`, which the cut pushes to both forges as the same tag object, and the
  tags imported before the switch, which exist on both.
- **Refs that exist only on GitHub.** Several tags exist only on GitHub. Each rolling lane release
  (`plugin-lane`, `herdr-lane`, `pocket-lane`, `am-lane`, and any later one such as RFC 0017's
  proposed `meter-lane`) was made by `gh release create --target dev`, which made its tag. So were
  the `herdr-automations-v*` tags that `scheduler-release.yml` makes. A release whose tag is deleted
  is no longer served at its `releases/download/<tag>/` URLs, and every installed pack, am, desktop
  app and phone would stop updating. Three guards, all required before the switch:
  1. Each of those tags is imported into GitLab as a protected tag, at the exact commit GitHub has,
     so the mirror sees nothing to change.
  2. "Keep divergent refs" is on, so a tag made on GitHub later is left alone.
  3. A GitHub tag ruleset forbids deleting or moving every rolling lane tag and every
     `herdr-automations-v*` tag, with an empty bypass list. Creating them stays allowed, so
     `scheduler-release.yml` and a re-created lane release keep working. This ruleset only adds
     protection, so it may land now (delivery 0).

  From then on, no lane release is ever deleted or re-created by hand. `refs/pull/*` on GitHub is
  read-only and never touched.
- **GitHub rulesets.** Today the repository has two: "dev and main: no force push or deletion" and
  "v3 tags: no moving or deletion". Both keep empty bypass lists. Three are added:
  - "Only the mirror updates dev and main", a separate ruleset, so a leaked mirror key still cannot
    force-push or delete `dev` or `main`. It restricts updates, and its only bypass actor is the
    mirror's key.
  - The lane and `herdr-automations-v*` tag ruleset above.
  - A ruleset that blocks creating any branch but `dev` and `main` (feature branches live on
    GitLab).

  `v*` tags and the releases on them are created only by a GitHub App whose private key is a
  secret of `release-signing` (Decision 4), never by an Actions-integration bypass. If tags travel
  with the mirror, its push of a new `v*` tag is refused whenever it lands before the App's. The
  scratch proof records whether that refusal also blocks the same push's update of `dev`. If it
  does, the mirror's key is added as a second `v*` creator, and the App stays the only creator of
  releases. The phase 2 rehearsal tests every ruleset against every branch and tag writer in
  `.github/workflows`: the cut's tag, `scheduler-release.yml`'s tags, a re-created lane release,
  and the mirror's own push.
- **The scratch proof, before phase 2.** In a scratch GitLab project mirrored to a scratch GitHub
  repository, with the settings above, record:
  - whether "Only mirror protected branches" carries tags;
  - that "Keep divergent refs" leaves a GitHub-only tag alone;
  - what happens to a tag that exists on both forges at different commits, as `release.yml` would
    make by re-creating a missing lane release;
  - that a push a ruleset refuses shows up as a mirror error in GitLab, and whether it blocks the
    other refs of the same push;
  - that the deploy key can push `.github/workflows`, and how a ruleset can name it;
  - the race between the mirror's push and the App's push of the same `v*` tag, in both orders;
  - which identity GitHub records as the actor of a run started by a mirrored push;
  - that a dispatched `replace_unverified_*` run and a run started by a mirrored push can both be
    approved under "prevent self-review" (Decision 4);
  - whether a job waiting for an Environment approval holds its concurrency group, and whether
    GitHub drops an older waiting run.

  The evidence goes in the phase 1 report. Delivery 5 and phase 2 do not start without it.
- **Lag.** GitLab's documentation: a push mirror "receives it in five minutes, or one minute if the
  setting Only mirror protected branches is on". GitHub's copy of `dev`, the raw `main` the
  installer one-liner reads and the raw `dev` the catalog is read from all trail GitLab by up to a
  minute.
- **Divergence.** With "Keep divergent refs" on, a GitHub `dev` that something else wrote is
  skipped, not overwritten. The mirror stalls on that branch and GitLab reports an error. The
  rulesets above make that hard. A head check (delivery 3) runs on Arca every five minutes. It
  compares GitLab's `dev` and `main` with public GitHub's, needs no GitHub credential, and alerts
  the owner when they differ for more than ten minutes. It also flags any commit on GitLab's `dev`
  that is neither a merge request's merge nor a known release-bot commit. Repair is always GitLab
  wins: find the stray commits, carry them over as a merge request if they are wanted, then
  force-update GitHub. A force-update needs the "dev and main: no force push or deletion" ruleset
  switched off for the repair and back on after it. Only the owner, as repository admin, does that.
- **GitLab's protected branches.** `dev` and `main` accept merges from maintainers through merge
  requests only. Direct pushes come only from the release's token: the version commit, the market
  index commit, `main`'s fast-forward and `follow-omni.yml`'s pin. `v*` and the imported lane tags
  are protected, and only that token creates `v*` there.
- **Merge commit messages are public.** The mirror publishes every merge commit message. GitLab's
  merge and squash commit templates hold `%{title}` only: never `%{url}`, never `%{reference}`
  (whose default "See merge request" line names the instance's project path), never
  `%{description}`. The merging bot writes the body itself, with `glab mr merge --sha <reviewed
  head>` and an explicit message. The body is the title plus the closing lines from the merge
  request's Issue section, in the form `Closes automagik-dev/automagik#N`, and the privacy check
  runs on that text first. GitHub's default branch is `dev`, so a closing keyword in a commit the
  mirror pushes closes the GitHub issue. GitLab's issues are off, so it closes nothing there.

**One sequencing rule: a run cuts only the commit that started it.** That commit is one GitHub
holds and the platform legs tested (Decision 6). Today `release.yml` writes `dev` (the atomic push
of the version commit and its tag, then the market index commit) and `main` (the fast-forward), and
`follow-omni.yml` writes its pin commit. Under the mirror:

- **Tags are read from GitLab, the side the cut writes.** The cut pushes `dev` and its tag to GitLab
  in one atomic push, so on GitLab a version commit never exists without its tag. On GitHub it can,
  for up to a minute: the mirror may deliver `chore(release): v<v>` before the App's tag push lands.
  A run started by that commit and reading GitHub's tags would see the previous tag and the merges
  since it, ask for approval, and cut an empty duplicate `v<v+1>`. So the first job reads `v*` tags
  from the remote that `gitlab-read` names (GitHub until the switch, GitLab after) and fetches each
  tag's commit, not only its name, because GitHub may not hold that commit yet. After approval the
  cut repeats the same "anything new" check against GitLab's newest tag, through the GitLab
  credentials `release-signing` holds (Decision 4), and exits cleanly when nothing is new. The
  recovery below exists only after the switch.
- **The cut** checks out the commit that started the run. It makes the version commit on top and
  pushes `dev` and the tag to GitLab atomically. If GitLab's `dev` has moved past that commit, the
  push is refused, and the run exits "dev moved" with nothing written. The run the mirror starts for
  the newer head releases both, as today's rule already does. After the GitLab push, the App pushes
  the same tag object to GitHub, and only then does the GitHub release exist.
- **Recovery: GitLab took the push, GitHub's tag push failed.** The first job flags a possible
  recovery when GitLab's newest `v*` tag is missing on GitHub and is more than ten minutes old by
  its tagger date. A younger tag is still in flight: its own cut is about to push it, so it is never
  a recovery. A flagged run starts the recovery job. That job is the cut itself in a mode that makes
  no new commit, and it runs in the `release-cut` concurrency queue behind any cut still publishing.
  Once it has the queue and the approval, it checks GitHub's tags again. If the tag has appeared, it
  exits cleanly. Only a tag still missing then is recovered: the job takes the version commit and
  tag from GitLab, pushes the tag to GitHub through the App, then does everything the cut does after
  its push (build, publish, sign and post the lanes). It names `release-signing` (its one
  Environment, which also holds the GitLab credentials), so it waits for the bot's approval. The bot
  approves it only if GitHub still lacks the tag, by the same compare-view procedure from the
  previous `v*` tag to the recovered tag. It runs before anything new is cut.
- **The `list` job** pulls and rebases against GitLab's `dev`, and runs `main`'s ancestor check
  against GitLab's `main`.
- **`follow-omni.yml`** reads `dev` (its checkout, and its `ls-remote` before the push) from the
  remote it pushes to. While that remote is GitHub (until the switch), it keeps calling
  `release.yml` through `workflow_call`, as today. At the switch it pushes the pin to GitLab and
  hands off: the mirror's push of the pin starts the release, which cuts that commit by the rule
  above. Its report says so.
- **Mirrored bot commits now start runs.** Today the workflow token's pushes start no run (GitHub
  never starts one for that token). Through the mirror they arrive by the deploy key, so each
  starts runs:
  - `chore(release): v<v>` starts `ci.yml` and `release.yml`;
  - the index listing, `chore(release): list v<v> in the market index`, starts `ci.yml` and
    `release.yml`;
  - `main`'s fast-forward starts `ci.yml` only (`release.yml` runs on `dev` alone);
  - `chore(desktop): carry Omni …` starts `ci.yml` and `release.yml`.

  The release runs started by the two `chore(release)` commits cut nothing: the existing guard sees
  nothing since the last release but the workflow's own commits. That decision is made by the first
  job, which holds no signing secret (Decision 4), so those runs never wait for an approval. The
  pin's run is the one that releases it. Today `ci.yml` groups runs as `ci-${{ github.ref }}` with
  `cancel-in-progress: true`, so a mirrored bot commit would cancel the run for the merge before it.
  Delivery 4 changes two things: `ci.yml` skips a push whose new commits are all bot commits, and
  its push concurrency is keyed by commit.
- **The GitLab remote stays out of public logs.** Its URL and its bare hostname are secrets of the
  Environments that hold the GitLab credentials (Decision 4), never a repository variable or a
  workflow literal:
  variables print in public Actions logs. Every job that receives them runs `::add-mask::` on the
  bare hostname as well, because git, DNS and TLS errors print the host without the URL ("could not
  resolve host", a certificate name mismatch). A credential helper reads the token, so neither the
  URL nor the token appears in argv or in `git remote -v` output. Phase 2's dry run scans the public
  Actions logs and release notes for the host after a success and after failed DNS, TLS and
  authentication pushes.
- **Tests.** `scripts/release-workflows.test.ts` covers:
  - every fetch, pull, `ls-remote` and compare in `release.yml` and `follow-omni.yml` reading the
    remote it writes;
  - the bot-commit skip and the concurrency key;
  - that runs started by the mirrored version, index and `main` fast-forward commits never reach a
    job that names `release-signing`, unless a recovery is flagged;
  - "`dev` mirrored before the tag": a run started by `chore(release): v<v>` while GitHub still
    lacks `v<v>` decides there is nothing to release, because it reads GitLab's tags;
  - "a tag in flight is not a recovery": a tag younger than ten minutes is never flagged, and a
    recovery job that finds the tag on GitHub after the queue and the approval exits without
    publishing anything;
  - the tag-push recovery of a tag that really is missing, and the approval it waits for;
  - a staged lag case: a run started on GitHub for a commit that GitLab's `dev` has already moved
    past exits "dev moved", and the newer run releases both.

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
| Desktop app (`apps/desktop/src/update.js`, electron-updater) | the REST API's release list, then the feed (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`) and builds on GitHub | the one client that uses the REST API: unauthenticated, every 15 minutes, from each install's own address; the feed is checked only by its sha512, macOS updates must carry the app's signature, Windows builds are unsigned and Linux AppImage updates are not signature-checked (G8) |
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
change a workflow, a script the cut runs, a test or a dependency it installs, and read
`HERDR_PACK_KEY(_NEXT)`, `AM_LANE_KEY(_NEXT)`, `PLUGIN_LANE_KEY` and `POCKET_SIGNING_*` on the
first run. Under the mirror, each of these can put a commit on GitHub's `dev`:
- a merge on GitLab's `dev`;
- an instance admin;
- root on the instance's host, or an agent there whose groups are equal to root;
- the instance's backups;
- the mirror's key.

Each of them would reach every signing key. They also reach what needs no key at all (Threat
model): a job on `dev` can ask for a `GITHUB_TOKEN` with `contents: write` or `packages: write`
without naming any Environment. Required before the switch:

- **Signing secrets live in one Environment, `release-signing`** (proposed name). Every job that
  uses one names it: in `release.yml`, `cut` (pack, plugin lane and am check-key), `pocket` and
  `am-lane`; in `desktop-build.yml`, the Mac and Windows signing legs; and the GitHub App that
  creates `v*` tags and releases (Decision 2). A workflow changed to drop the `environment:` line
  loses the secrets; it does not gain them.
- **It is a real boundary only with admin bypass off.** The Environment's administrator bypass is
  off. Its deployment refs are `dev` plus named rehearsal refs. The organisation's owners and the
  repository's admins are listed in writing, privately, at G4. A bot login holds admin on the
  repository today. Every bot login drops admin before G4, not at the switch.
- **Only runs that ship ask for approval.** A new first job holds no signing secret. It names only
  `gitlab-read`, an Environment with no reviewers, so it never pauses. Its read-only token reads
  GitLab's tags and their commits. It holds:
  - the "Anything new since the last release" step (now inside `cut`), against GitLab's tags;
  - the `lane.ts ships` decision and the lane outputs;
  - the gates the release stands on;
  - the flag for a possible tag-push recovery (Decision 2).

  Only jobs with `if: release == 'true'`, or the recovery job when a recovery is flagged, name
  `release-signing`. A docs, CI, version or index commit never waits for an approval and never
  holds the `release-cut` queue, unless a recovery is flagged.
- **Each signing job pauses on its own.** GitHub holds every job that names the Environment when it
  reaches it. From today's job graph, a full release waits at most four times: `cut`; then
  `pocket` and `am-lane`, side by side after the cut; then the desktop signing legs (the Mac leg,
  and the Windows leg when it is on). That is up to five paused jobs, plus the recovery job when one
  is due. A herdr, pocket or am patch waits once or twice, and a no-op never. The approver bot
  approves each paused job of a run. A refusal rejects the deployment rather than leaving it
  pending. Delivery 5 confirms the bound: it runs for about a week while GitHub is still canonical
  and records the approvals per run kind (full, herdr, pocket, am, no-op) and the wait from
  approval to cut. Then it either merges signing jobs or states the real cost here.
- **`desktop-build.yml` splits its signing.** Its `build` job is one matrix, so naming the
  Environment there would pause the Linux leg too. The Mac and Windows legs become a job of their
  own that names `release-signing`, and the Linux leg stays without it. The `release` job today
  checks `secrets.MAC_CSC_LINK` to decide whether the Mac zip and `latest-mac.yml` are required.
  Once that secret moves, the check would quietly read false and drop them. The Mac leg instead
  reports, as a job output, whether it signed, and `release` reads that output with no secret.
- **The approver is the orchestrator bot role, on its own GitHub identity** (Decided 10). The
  Environment's required reviewers are that account and the owner. The account is used for nothing
  else, holds no admin, and is separate from:
  - the mirror's deploy key;
  - the account that merges (Chat's GitLab user and any GitHub login it holds);
  - the release workflow's token, the release's GitLab token and the tag App.

  So putting a workflow on `dev` and unlocking signing need two different credentials. The account
  uses two-factor login. Its token is a fine-grained token on this one repository, with only the
  permission that approving a pending deployment needs (confirmed in phase 2), and it expires. It
  holds no contents write, no GitLab access and no other repository.
- **Self-review, settled before delivery 5.** "Prevent self-review" is on, so neither reviewer can
  approve a run its own identity started. The bot approves runs the owner dispatches by hand (the
  pointer recoveries, `replace_unverified_herdr_pointer` and `replace_unverified_am_pointer`). The
  owner approves a run the bot's identity started (it holds no write, so only if that ever
  changes). The owner's account adds the deploy key, so the bot can approve every mirror-started
  run whatever actor GitHub records. The scratch proof shows both cases and records the actor.
- **How the bot approves (proposed).** The run summary is written by the code under review, so it
  is advisory only. The bot reads GitHub's own compare view from the last `v*` tag to the run's
  commit, covering everything that runs in a job holding a key:
  - `.github/workflows/` and `.github/scripts/`;
  - `scripts/`;
  - tests;
  - Gradle build files;
  - `package.json` scripts and the lockfiles.

  It approves only when that commit is on GitLab's `dev` through merged merge requests that carry
  the review verdicts on their heads. When the compare shows a change under `.github/`, it asks the
  owner first. Anything else it refuses, and it says why in the run's thread.
- **The shared-host risk, stated plainly.** The instance runs on the team's build host (Decided 2),
  and so does the orchestrator bot, whose approval token lives there. Root on that host, or an agent
  there whose groups are equal to root, therefore gets both halves: a path onto `dev` and the
  approval. The separation above protects against any one leaked credential, not against that.
  The approver's login has no admin. The owner accepts this risk in writing at G4, before the
  switch (Decided 10). *Note, not a requirement:* moving the approver's token off that host, or
  onto a hardware-backed key, would remove this risk later.
- **GitHub write access narrows.** `workflow_dispatch` on `release.yml` and the schedule and
  dispatch on `follow-omni.yml` remain. After the switch, GitHub write access is held only by the
  owner and the release's own identities. Bots get the Triage role (issues and labels, no write).
  Omni's dispatch token into `follow-omni.yml` counts as a write credential and is narrowed to
  dispatch alone.
- **How the secrets reach the Environment.** GitHub never returns a secret's value, so nothing is
  copied:
  - The lane keys move by RFC 0011's two-phase rotation, straight into the Environment
    (`keygen` gains `--env release-signing`). Each rotation ships the new public key first and
    switches the signer later, so the move takes at least one release cycle per lane, and longer
    for installs that update slowly. The plan budgets about two weeks.
  - `POCKET_SIGNING_*` and the Mac and Windows certificates are entered again from offline copies.
    The owner confirms that those copies exist before delivery 5. The Pocket key is never
    regenerated (AGENTS.md).
  - Repository secrets are deleted only after one release has signed from the Environment. After
    phase 3, `release-signing` is never removed and no secret goes back to repository level.
- **One Environment per job, so the GitLab credentials sit where the jobs are.** A GitHub job names
  only one Environment. The signing jobs that push to GitLab (`cut` and the recovery job) therefore
  find the GitLab write token, the remote's URL and its bare hostname in `release-signing`, beside
  the keys. The bot's approval then guards the GitLab push as well as the signing. The other GitLab
  credentials:
  - `gitlab-release` holds a second write token, URL and hostname, for the two pushes that sign
    nothing: `list`'s index commit and `follow-omni.yml`'s pin. It is limited to `dev`, with no
    reviewers. A job on `dev` that names it can push GitLab's `dev`. That job's code already came
    from `dev`, so this opens no new path.
  - `gitlab-read` is limited to `dev`, with no reviewers, and its token has `read_repository` only.
    It is read by the first job. Any job on `dev` can name it without approval, so a leak exposes
    GitLab's non-public refs and the hostname, and is answered by revoking the token.

  Every token is a project access token on the one project, with the shortest workable expiry, and
  revoking it stops only its own jobs. The write tokens' bot users may push the protected `dev` and
  `main`, and the signing one may also create `v*` tags. Splitting the GitLab push into a job of its
  own was the other option. It is not proposed, because the cut's atomic push and its signing are
  one job: splitting them would mean handing the commit between jobs, and losing "both or neither".

What this costs: each signing job of a release that ships waits for the bot's approval. That takes
seconds to minutes while the bot runs, and longer when it is not running. A run that changes
`.github/` also waits for the owner. Runs that ship nothing never wait. Delivery 5 measures the
real numbers. That is the price of a second path onto `dev`.

| Secret | Where it lives | Which runner sees it |
|---|---|---|
| `HERDR_PACK_KEY`, `HERDR_PACK_KEY_NEXT` | `release-signing` | `release.yml`'s `cut`, GitHub-hosted Linux, after approval |
| `AM_LANE_KEY`, `AM_LANE_KEY_NEXT` | `release-signing` | `cut` (check-key) and `am-lane`, GitHub-hosted Linux, after approval |
| `PLUGIN_LANE_KEY` | `release-signing` | `cut`, GitHub-hosted Linux, after approval |
| `POCKET_SIGNING_KEYSTORE`, `POCKET_SIGNING_PASSWORD` | `release-signing` | `cut` (presence only, before the tag) and `pocket`, GitHub-hosted Linux, after approval |
| Mac and Windows signing (`MAC_CSC_*`, `APPLE_API_*`, `WIN_CSC_*`, `AZURE_CLIENT_ID`) | `release-signing` | `desktop-build.yml`'s signing legs, GitHub-hosted macOS and Windows, after approval |
| The tag App's private key (new) | `release-signing` | `cut`'s tag push and the release's creation, after approval |
| The mirror's deploy key (new) | GitLab's push mirror setting; GitHub holds only its public half | GitLab itself; no CI job |
| The approver's token (new) | the orchestrator bot role's own GitHub account, on the build host | no runner; it approves pending deployments only |
| The signing GitLab write token (`write_repository`, creates `v*`), the remote's URL and hostname (new) | `release-signing` | `cut`'s push and re-check, and the recovery job, after approval |
| A second GitLab write token (`write_repository`), URL and hostname (new) | `gitlab-release`, limited to `dev`, no reviewers | `list`'s index push and `follow-omni.yml`'s pin push |
| A read-only GitLab token (`read_repository` only), URL and hostname (new) | `gitlab-read`, limited to `dev`, no reviewers | the first job, to read GitLab's tags and their commits; it can push nothing |

- **No signing key goes to GitLab or to a self-hosted runner**, in any phase. GitLab CI runs gates
  only, with no secret at all.

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
| `ci.yml`'s macOS legs (`pocket-link`, `usagemeter`) and Windows legs (`desktop`, `acp-windows`) | GitHub Actions, as jobs `release.yml` runs on the commit it cuts, before the tag, for the lanes that ship their builds |
| `commitlint.yml` | GitLab CI, on every merge request |
| `release.yml`, `desktop-build.yml` (macOS signing and notarisation on hosted macOS) | GitHub Actions, started by the mirror's push to `dev`, signing jobs behind `release-signing` |
| `follow-omni.yml` (schedule, Omni's `repository_dispatch`) | GitHub Actions; reads and pushes the remote of Decision 2 |
| `server-image.yml`, `linux-image.yml` (GHCR), `scheduler-release.yml`, `boot-check.yml`, `herdr-harness.yml` | GitHub Actions, unchanged |

- **The release waits for the platform legs that cover what it ships.** Every merge to `dev` is a
  release, so a leg that ran only after the merge would let a macOS-only or Windows-only failure
  reach installed apps before anyone saw it. Platform-only failures have happened here before. The
  four legs become a reusable workflow that `release.yml` calls on the commit that started the run
  (Decision 2's rule), and a leg gates only the lanes that ship its builds:
  - the Windows `desktop` leg gates a release that builds the desktop app;
  - `acp-windows` gates a release that packs the plugins;
  - the macOS `pocket-link` leg gates a release that ships the herdr part;
  - the macOS `usagemeter` leg gates nothing until the meter lane exists (RFC 0017).

  A red leg stops those lanes before the tag, and the merge is fixed forward. A herdr hotfix may
  skip the macOS leg only by a written override: a dispatch input the owner sets, recorded in the
  run and the release notes.
- **Who re-runs a failed leg.** Once bots hold Triage they cannot re-run a workflow. The Integrator
  role reports the failed leg on the merge request, and the owner re-runs it. Re-running needs
  write access, which only the owner holds.
- **Same commands, two schedulers.** Every gate is already a command in the repository (AGENTS.md
  lists each part's). The GitLab jobs call the same commands with the same pins: Node 22 newest and
  24, Bun 1.4.4, JDK 17 and SDK 35, the meter crate's toolchain. A test beside
  `release-workflows.test.ts` checks that each `ci.yml` Linux job has a GitLab job running the same
  commands, so the two cannot drift. Two herdr gate steps pass the workflow token as a GitHub API
  fallback. On GitLab they run unauthenticated, and the parity test records that as a known
  difference.
- **Runners.** GitLab's runners use an ephemeral container executor: no shell executor, no Docker
  socket in jobs, no host bind mounts, no secrets, and not shared with Brain or any other project.
  No runner sits on the instance's host. The `usagemeter` job's Linux leg keeps AGENTS.md's one
  cargo build at a time through a GitLab `resource_group`, which replaces the host's shared gate
  lock there, with `CARGO_BUILD_JOBS=4`.
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
| the merge rules (CI newer than `dev`, no push after a SHIP, three verdicts on one head, no merge while a release runs) | the same, with "no merge while a release is past approval" in place of the last; enforced by the merging bot, since GitLab Free does not enforce approval rules; release runs are still read on GitHub (`gh run view`, read-only) |
| issues, labels, releases (`gh issue`, `gh release view`) | unchanged on GitHub, Triage role |

- **Rate limits.** The instance's limits are the owner's to set, so the bots' review traffic no
  longer spends GitHub quota. GitHub keeps the issue and release reads, and the release workflow's
  own calls on the workflow token's quota. Gate G1 (informational) records whether this matters:
  the per-login data, beside the cheaper lever of one GitHub App per bot role (Alternatives).
- **`glab` habits.** Counts come from the API's total header, never from the rows a list command
  prints (they stop at 100). State filters use `glab api`. A 405 right after a push is retried only
  after checking whether the merge request already merged.
- **One user per role** (decided). Reviewers and testers get reporter rights, workers get developer
  rights (pushing feature branches), and Chat and the owner get maintainer rights (merging).
  Separate users make a verdict's author checkable. Bot users keep two-factor login on for the
  web, but they work through tokens, which two-factor login does not cover. Their tokens are scoped
  to the one project and expire.
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
| 0. Read replica | Arca's GitLab copies GitHub (all branches and tags) by a pull mirror or a scheduled fetch-and-push job; issues and merge requests off; the lane and `herdr-automations-v*` tag ruleset lands (delivery 0) | GitLab's `dev` equals GitHub's within the copy interval for a week | delete the project; nothing reads it (the tag ruleset stays: it only protects) |
| 1. Shadow CI and the scratch proof | `.gitlab-ci.yml` with the Linux gates and commitlint, not required; the scratch proof (Decision 2); the G1 record starts | two weeks in which GitLab and Actions agree on every Linux job; the proof's evidence recorded | remove the file or stop the runner; delete the scratch projects |
| 2. Ready to switch, still on GitHub | delivery 4 (the release's remote, still GitHub) and delivery 5 (signing behind `release-signing`, measured for a week); the lane tags imported to GitLab as protected tags at GitHub's commits; the rulesets tested against every writer; the merge commit template set; the bots' `glab` users and briefs ready; the head check running | a dry run against the scratch projects with per-run test keys and key files, never real secrets: the release pushes there, the tag lands on the scratch GitHub, and no public log or release note shows the host after a success or after failed DNS, TLS and authentication pushes; a full merge request rehearsed there (three verdicts on the head, Chat's `glab mr merge --sha`) | revert; the remote secrets keep GitHub as the remote |
| 3. The switch | see below | see below | the runbook below |
| 4. Settle | `AGENTS.md`, the RFC process (`docs/rfcs/README.md`: merge requests to `dev`), the brief templates and memories say merge request and `glab`; `ci.yml`'s Linux jobs run on GitHub only for outside pull requests | a week of merges with no manual mirror repair | revert the docs with phase 3's rollback |
| 5. Second download host (its own RFC) | clients learn a fallback base URL (one release per part); then the release dual-publishes to a host on Arca | an install in the field updates from the fallback with GitHub blocked | stop dual-publishing; clients still read GitHub first |

**Phase 3, the switch.** Merges freeze for the window, which starts when no release is past
approval. GitLab stops copying and becomes canonical, with protected `dev`, `main`, `v*` and the
imported tags. The push mirror goes on, with protected branches only and divergent refs kept, and
the "only the mirror updates dev and main" ruleset goes on. The GitLab remote secrets point the
release at GitLab, and GitLab CI becomes required. Open pull requests are carried over as merge
requests, the bots move to `glab`, and bots lose GitHub write access.

**Phase 3's acceptance gates.** All of these hold before the switch:
- **G1, load (informational).** A week or more of per-login REST, GraphQL and secondary-limit data
  and of Actions minutes, recorded from phase 1, beside what one GitHub App per bot role would give
  (Alternatives). It is shown to the owner before the window; it sets no pass mark.
- **G2, mirror semantics.** The scratch proof's evidence, from phase 1.
- **G3, the instance.** Shown privately to the owner:
  - the instance's host, named;
  - a stated uptime target and backup target, a tested restore, runner capacity, and a patch
    cadence (critical GitLab security releases within 72 hours);
  - who has root on the instance's host and on the runner hosts;
  - that agent accounts there hold no root-equivalent groups (`docker`, `lxd`, `incus-admin`), or
    else the owner's written acceptance that they do;
  - that no other project's CI shares that kernel or container daemon;
  - that no runner sits on the instance's host.
- **G4, signing.** `release-signing` holds every signing secret, migrated as Decision 4 says, and
  no repository secret is left (deleted only after one release signed from the Environment). Every
  signing job names it, and admin bypass is off. The owners and admins are listed in writing, and
  no bot login holds admin. The deploy keys are inventoried (the mirror's alone). The bot's
  identity has approved runs by the compare-view procedure, and holds no contents write, no GitLab
  access and none of the other credentials. The owner has accepted the shared-host risk in writing
  (Decided 10).
- **G5, rulesets.** Tested against every branch and tag writer (Decision 2), with the two existing
  rulesets' bypass lists still empty.
- **G6, Brain's record.** Brain's mirror lag, stalls and manual repairs, from its maintainers
  through the owner.
- **G7, the runbook.** The rollback runbook for "GitLab unreachable" is written and has been
  rehearsed once on the scratch projects, including the case of a `v*` tag ahead of `dev`.
- **G8, the desktop feed** (Decided 11). The unsigned desktop update feed is closed. Either the
  signed desktop feed (question 7's delivery) has shipped, or Windows builds are signed with
  `publisherName` and Linux updates are checked against a feed signed with a lane key (ed25519,
  like the plugin lane's) that names each build's sha512.

After the switch, within seven days, a deliberate release rebuilds the pack, am, the desktop app
and Pocket. Missing the window counts as a failure, and the switch is rolled back. In that window:
- an installed pack, am, desktop app and phone each update from that release;
- `pack.json`, `am.json`, `lane.json` and `latest.json` and their signatures read correctly at
  their `releases/download` URLs;
- a deliberate probe shows that a GitHub-only tag survives a mirror run.

**Rollback, and the runbook for "GitLab unreachable".** The tag rulesets and `release-signing` stay
on throughout.
1. **Freeze.** No merge on either forge and no release run: the GitLab remote secrets (in
   `release-signing` and `gitlab-release`) are emptied, so a run stops before anything is written.
2. **The baseline.** Only the mirror writes GitHub's `dev`, so GitHub's `dev` is the last successful
   mirror. No comparison with GitLab is needed to know it, which matters when GitLab cannot be read.
   Then compare the newest `v*` tag with GitHub's `dev`. If GitLab died after a cut pushed to it and
   the App pushed the tag, but before the mirror ran, the tag's commit is ahead of `dev` and
   descends from it. `dev` is then fast-forwarded to that commit, which the owner does with the
   "only the mirror updates" ruleset switched off.
3. **Resume on GitHub.** The push mirror goes off, and the "only the mirror updates dev and main"
   ruleset is switched off by the owner. The remote secret points the release at GitHub, bots get
   write access back, and merges resume on GitHub. Each open merge request is re-opened by its
   author as a pull request.
4. **When GitLab is back.** Every commit on GitLab's `dev` that GitHub's lacks (merged but never
   mirrored) is carried over as a pull request, and the runbook lists them. GitLab-only branches
   are kept, and the merge request history stays on GitLab, archived. GitLab's protected `dev`,
   `main` and `v*` are unprotected, so phase 0's copy can force-update them, and GitLab goes back
   to phase 0.

The owner decides when an outage is long enough to run this.

## Decision 9: what Arca's own instance changes

- **The limits are ours.** The instance's rate limits, runner capacity and retention are the
  owner's settings, not a hosted plan's.
- **It is part of the release's trust.** A merge on its `dev`, an instance admin, root on its host
  (or an agent there whose groups are equal to root), its backups or the mirror's key can each put
  code on GitHub's `dev`. Decision 4's Environment is what keeps that code away from the signing
  keys, except on the build host itself, where the approver's token also lives (Decided 10). The
  owner alone administers the instance (decided), and every account uses two-factor login (bot
  users too, for the web; their tokens are scoped and expire).
- **How GitHub reaches it.** Only the release's git traffic crosses from GitHub to the instance:
  GitHub-hosted runners fetch `dev` and `main`, run `ls-remote`, and push the version commit, the
  tag, the index commit and the pin, all over HTTPS with the release's token. So the instance
  accepts inbound HTTPS, through a reverse proxy that passes only the git endpoints of the one
  project. It is hardened like a public GitLab: sign-up off, two-factor login enforced
  instance-wide, no public projects, critical security releases applied within 72 hours. The head
  check and phase 0's copy run on Arca and need no inbound path. The TLS certificate appears in
  public Certificate Transparency logs, so the host's name can be found anyway. Keeping it out of
  our text is hygiene, not a security boundary.
- **When GitHub cannot reach it,** the cut fails at its GitLab push. That is before any tag or
  GitHub release exists, so nothing is published and no lane moves. Merges keep landing on GitLab,
  and the run the mirror starts for the newest head releases them together.
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
gates every merge. A second admin, or a written break-glass procedure, would remove it. The owner
chose sole administration (question 9). The runbook above is the break-glass path for merges.

*Council minority (security lens, 2026-11-09):* keep the instance closed to all inbound traffic,
and replace the release's push with jobs on Arca that pull the release commit and tag from public
GitHub. Not proposed: a tag published on GitHub before GitLab's `dev` holds its commit breaks the
cut's atomic "both or neither" rule, and a merge landing meanwhile would leave a release tag off
`dev`.

*Council dissent (second review, 2026-11-09):*
- Mirrored code can reach installed clients without any signing key, through a `GITHUB_TOKEN` with
  `contents: write` that any job on `dev` may request. G8 closes the desktop feed, the worst case,
  and the threat model lists the rest.
- The long-term shape would sign in a repository or workflow the mirror cannot write, running no
  code from this repository. That is recorded as the dissent's position, not required here.

## Contracts introduced

- **No client contract changes.** Every download URL, rolling release, pointer file, field, key and
  asset name stays as RFC 0011, RFC 0012 and RFC 0017 define it. G8 changes how the desktop feed is
  checked, through its own delivery.
- **Canonical branches move.** `dev` and `main` are written on Arca's GitLab, and GitHub's are a
  mirror. A pull request on GitHub is no longer merged there.
- **Signing secrets move** into the `release-signing` Environment (proposed name), by rotation or
  by entering them again, never by copying. Each signing job of a release that ships waits for an
  approval by the orchestrator bot role's own GitHub identity.
- **New secrets and settings:**
  - the mirror's deploy key;
  - the tag App;
  - three GitLab project tokens: the signing write token in `release-signing`, a second write token
    in `gitlab-release` for the index and the pin, and a `read_repository` token in `gitlab-read`;
  - three GitHub rulesets ("only the mirror updates dev and main", the lane and
    `herdr-automations-v*` tags, no other branches) beside the two that exist;
  - GitLab protected branches and tags;
  - merge and squash commit templates of `%{title}` only;
  - `keygen --env`.
- **New files.** `.gitlab-ci.yml` (added to `scripts/lane.ts`'s `NEVER_SHIPPED`, so a CI-only change
  cuts no desktop build), its parity test, and a reusable workflow for the macOS and Windows legs.
- **Process.** Merge requests to `dev` on GitLab; verdicts as merge request notes; `!N` for merge
  requests and `#N` for GitHub issues; bots hold the Triage role on GitHub. The merge rule reads
  "no merge while a release is past approval".

## Threat model

- **The new path onto `dev`.** Five things can each put code on GitHub's `dev`:
  - a merge on GitLab's `dev`;
  - an instance admin;
  - root on the instance's host, or an agent there whose groups are equal to root;
  - its backups;
  - the mirror's key.

  Code on `dev` runs with every signing secret. Without Decision 4, any of these reads
  `HERDR_PACK_KEY(_NEXT)`, `AM_LANE_KEY(_NEXT)`, `PLUGIN_LANE_KEY` and `POCKET_SIGNING_*` on its
  first run. It could sign a pack, an am, a plugin lane or an APK that every installed client would
  take. Answered by:
  - the `release-signing` Environment with admin bypass off, approved only by a separate identity
    (below), after a compare-view review;
  - protected `dev` on both forges;
  - owner-only administration;
  - the head check, which shows a GitHub `dev` that moved without GitLab, and a GitLab commit that
    is neither a merge nor a known bot commit.
- **The approver's identity.** The orchestrator bot role's GitHub account is one more thing that
  reaches the keys. Its approval unlocks signing for whatever commit a run carries, so it matters
  together with any path onto `dev`. Alone it cannot put code on `dev`: it holds no contents write
  and no admin. Protections:
  - two-factor login;
  - a token scoped to approving deployments on this one repository, and expiring;
  - "prevent self-review";
  - the compare-view procedure;
  - the owner's yes for any run that changes `.github/`.

  A leak is answered by removing the account from the Environment's reviewers. *Proposed, for the
  owner to confirm at G4:* until a new identity exists, the owner approves alone, and "prevent
  self-review" is relaxed for that interval so the owner can approve runs the owner started. The
  change and its end are recorded. Its token lives on
  the build host with the instance, so root on that host, or an agent there with root-equivalent
  groups, holds both halves: a path onto `dev` and the approval. This is the one place the
  separation does not hold. The owner accepts it in writing at G4 (Decided 10). Moving the token off
  that host, or onto a hardware-backed key, would remove it.
- **Admins.** An admin can bypass an Environment and switch off a ruleset. Admin bypass is off,
  admins are listed at G4, and no bot login holds admin.
- **What needs no key.** Any job on `dev` may request a `GITHUB_TOKEN` with `contents: write` or
  `packages: write` without naming an Environment. Whether repository settings can cap a permission
  a workflow asks for explicitly is believed not, and unverified. With that token, mirrored code can
  do the following:
  - **Replace release assets and create releases.** Signed pointers (`pack.json`, `am.json`,
    `lane.json`) would be refused by clients. Pocket's unsigned `latest.json` cannot install
    anything the release key did not sign (RFC 0011). The desktop app's electron-updater feeds
    (`latest.yml`, `latest-linux.yml`) are checked only by the sha512 they name. Windows builds are
    unsigned, with no `publisherName` set, and Linux AppImage updates have no signature check. So
    Windows and Linux desktop users could be updated to arbitrary code with no approval. macOS
    updates must carry the running app's signature. G8 closes this before the switch (Decided 11).
  - **Move GHCR's `automagik-server:latest`.** `server-image.yml` publishes it with
    `packages: write`, and nothing signs it. Who pulls it, and whether any consumer verifies it,
    is unknown (unverified). It is listed here as a residual risk. A signed image or a digest pin
    for consumers would close it, in its own delivery.
  - **Push tags.** Rulesets limit this: `v*` only through the tag App, lane tags never moved.
- **The mirror's key.** It is git-only and cannot touch release assets. It is the only deploy key,
  and the only bypass actor of the "only the mirror updates" ruleset, which cannot force-push or
  delete. A leak lets an attacker push `dev` (answered as above) but not delete or move a protected
  tag. It is answered by removing the deploy key on GitHub.
- **The GitLab tokens.** The signing write token can push `dev`, `main` and `v*` on GitLab. It lives
  in `release-signing`, so only an approved job reads it. The second write token (in
  `gitlab-release`) pushes `dev` for the index and the pin, without approval. The read token (in
  `gitlab-read`) can only read. Each is short-lived, and a leak is answered by revoking that one
  token.
- **`workflow_dispatch`.** Any GitHub writer can dispatch `release.yml` or `follow-omni.yml`. After
  the switch only the owner and the release's identities hold write, Omni's dispatch token is
  narrowed to dispatch, and a dispatched release still waits for the approval.
- **Deleted or moved tags.** The mirror could delete the rolling lane tags and stop every installed
  client's updates. Answered by importing them as protected GitLab tags at GitHub's commits, by
  keeping divergent refs, by the tag ruleset (which may land now), and by the scratch proof and the
  post-switch probe.
- **Leaking the instance's address.** Merge commit messages, release notes and Actions logs are
  public. Answered by:
  - the `%{title}`-only templates;
  - merge bodies written and privacy-checked by the merging bot;
  - the remote's URL and bare hostname kept as Environment secrets and masked;
  - the phase 2 log scan after successful and failed pushes.

  The certificate's name in public logs is accepted (Decision 9).
- **Runners.** GitLab CI runs code from any feature branch. Answered by ephemeral container runners
  with no secrets, no Docker socket, no host bind mounts, none on the instance's host, and none
  shared with another project. G3 checks the host's root-equivalent groups.
- **Undo.** The runbook restores today's setup without losing a merge: GitHub's `dev` is known to
  be the last mirror, a tag ahead of it is fast-forwarded to, and GitLab-only commits are carried
  over as pull requests. The tag rulesets and `release-signing` stay on throughout.

## Deliveries

Each delivery is one merge request (one pull request before the switch), on no part's lane:
`.github/`, `scripts/` and `docs/` never ship, and delivery 2 makes `.gitlab-ci.yml` never ship.
This RFC settles the direction and the gates. The deliveries prove the wiring: job wiring,
Environment names, token scopes and test cases live in each delivery's Acceptance list. A review
finding about an implementation detail is added to the matching list, not to the decisions above.

0. **The lane tag ruleset** (now; settings only).
   - Acceptance:
     - lane tags and `herdr-automations-v*` cannot be deleted or moved, can still be created, and
       the ruleset's bypass list is empty;
     - a re-created lane release and `scheduler-release.yml` still work;
     - a delete is refused.
   - Rollback: switch the ruleset off.
1. **Instance and read replica** (phase 0; settings only, no repository change).
   - Acceptance:
     - GitLab's `dev` equals GitHub's within the copy interval for a week;
     - issues and merge requests are off on the project.
   - Rollback: delete the project.
2. **GitLab CI shadow and the scratch proof** (phase 1).
   - Acceptance:
     - `.gitlab-ci.yml` runs the Linux gates and commitlint;
     - `NEVER_SHIPPED` has `.gitlab-ci.yml`;
     - the parity test ties each `ci.yml` Linux job to a GitLab job with the same commands, and
       records the two herdr steps that run unauthenticated there;
     - the runners are ephemeral containers with no secrets, no Docker socket and no host bind
       mounts, none on the instance's host, and `usagemeter` runs in a `resource_group`;
     - two weeks in which GitLab and Actions agree on every Linux job;
     - every item of the scratch proof (Decision 2) recorded;
     - the G1 record started.
   - Rollback: revert; nothing depends on it.
3. **The head check** (phase 2).
   - Acceptance:
     - it runs on Arca every five minutes and compares GitLab's `dev` and `main` with public
       GitHub's, needing no GitHub credential;
     - it flags a GitLab commit that is neither a merge request's merge nor a known bot commit;
     - it alerts the owner on a staged difference over ten minutes and on a staged stray commit.
   - Rollback: remove it.
4. **Release remote and the sequencing rule** (phase 2).
   - Acceptance:
     - `release.yml` (cut, `list`) and `follow-omni.yml` fetch, pull, `ls-remote`, compare and push
       one remote, set by the remote secrets (GitHub until the switch);
     - a run cuts only the commit that started it, and a refused push exits "dev moved" with
       nothing written;
     - `follow-omni.yml` keeps its `workflow_call` release while the remote is GitHub;
     - `ci.yml` skips a push whose new commits are all bot commits, and keys its push concurrency
       by commit;
     - every job holding a remote secret masks the bare hostname with `::add-mask::`;
     - `release-workflows.test.ts` covers both remotes, the bot-commit runs, and the staged lag
       case (a run for a commit GitLab's `dev` has moved past exits "dev moved");
     - the scratch dry run with per-run test keys and key files leaves no host in any public log
       or release note, after a success and after failed DNS, TLS and authentication pushes.
   - Rollback: the remote secrets, or a revert.
5. **Signing behind an Environment, the first job, and the platform legs** (phase 2, while GitHub
   is still canonical; it runs for about a week).
   - Acceptance:
     - `release-signing` has the bot's identity and the owner as reviewers, "prevent self-review"
       on, admin bypass off, deployment refs `dev` plus named rehearsal refs;
     - `release-signing` holds the signing keys, the tag App's key, and the signing GitLab write
       token, URL and hostname (`write_repository`, may create `v*`);
     - `gitlab-release` (limited to `dev`, no reviewers) holds the second write token
       (`write_repository`), for `list` and `follow-omni.yml`;
     - `gitlab-read` (limited to `dev`, no reviewers) holds a `read_repository`-only token;
     - each GitLab token is a project access token on the one project with a short expiry;
     - each job names at most one Environment: the first job `gitlab-read`; `cut`, `pocket`,
       `am-lane`, the recovery job and the desktop Mac and Windows signing legs `release-signing`;
       `list` `gitlab-release`;
     - the first job holds the "anything new" step, `lane.ts ships`, the lane outputs, the gates
       and the recovery flag. It reads tags from the remote `gitlab-read` names and fetches each
       tag's commit;
     - the cut repeats "anything new" after approval and exits cleanly when nothing is new;
     - the recovery job runs in the `release-cut` concurrency group, is flagged only for a tag
       older than ten minutes, and re-checks GitHub's tags after the queue and the approval;
     - `desktop-build.yml`'s Linux leg names no Environment, and the Mac leg reports "signed" as
       a job output that `release` reads instead of a secret;
     - `v*` tags and releases are created only through the tag App;
     - the secrets are migrated as Decision 4 says (lane keys by two-phase rotation with
       `keygen --env`, the Pocket and desktop certificates entered again from offline copies the
       owner has confirmed), and repository secrets are deleted only after one release signed from
       the Environment;
     - the macOS and Windows legs are a reusable workflow, gating only the lanes that ship their
       builds, with the herdr-hotfix override recorded;
     - tests:
       - mirrored version, index and `main` fast-forward runs never reach `release-signing` unless
         a recovery is flagged;
       - "`dev` mirrored before the tag";
       - "a tag in flight is not a recovery";
       - the recovery of a tag that really is missing;
       - a docs-only merge runs without any approval;
       - a staged red leg stops its lane before the tag;
     - one release cut with every paused signing job approved by the bot;
     - the week's approvals per run kind and the waits recorded in Decision 4.
   - Rollback: before the repository secrets are deleted, revert, and they are still there. After
     that, there is no rollback to repository secrets: a fault is fixed forward inside the
     Environment.
6. **The switch** (phase 3; settings, the remote secrets, the bots' tooling).
   - Acceptance:
     - gates G1 to G8 hold before the switch;
     - the seven-day checks hold after it.
   - Rollback: the runbook.
7. **Docs and process** (phase 4).
   - Acceptance:
     - `AGENTS.md`, `docs/rfcs/README.md` and the brief templates say merge request and `glab`;
     - `ci.yml`'s Linux jobs run on GitHub only for outside pull requests;
     - a week of merges with no mirror repair.
   - Rollback: revert, with the runbook.
8. **Second download host** (phase 5): its own RFC, before any client change.

G8's desktop feed is its own desktop delivery (question 7), on the desktop lane, outside this list.

## Open questions

None. All the owner's answers are under Decided (2026-11-09).

## Links

- RFC 0011 (parts, lanes, the signed rolling pointers, key rotation, Pocket's `latest.json` rule),
  RFC 0012 (am, sources and trust), RFC 0017 (the meter part, `meter-lane` proposed), RFC 0018.
- `.github/workflows/release.yml`, `ci.yml`, `desktop-build.yml`, `follow-omni.yml`,
  `scheduler-release.yml`, `server-image.yml`; `scripts/lane.ts`, `scripts/herdr-lane.ts`,
  `scripts/am-lane.ts`, `scripts/release-workflows.test.ts`; `apps/desktop/electron-builder.yml`.
- Readers: `herdr/mods/am-sidebar/release.js`, `herdr/mods/am-sidebar/update.mjs`,
  `herdr/install.sh`, `am/lib/lane.mjs`, `am/lib/self.mjs`, `apps/desktop/src/lane.js`,
  `apps/desktop/src/update.js`, `apps/pocket/android/app/build.gradle.kts`,
  `apps/pocket/android/app/src/main/java/ai/namastex/automagik/Updater.kt`.
- #786 (the "couldn't check" seen on 2026-11-09) and its fix, pull request #789 (both open).
- GitLab's documentation on push and pull mirroring (lag, "Keep divergent refs", tiers); the
  vendor sources listed under Alternatives.
