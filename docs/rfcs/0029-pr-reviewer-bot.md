# RFC 0029: The PR Reviewer bot

| Field | Value |
|---|---|
| Status | Queued (written 2026-11-10 from the owner's direction in #991; Q1-Q8 open for the owner) |
| Milestone | none (ships outside the five milestones) |
| Lanes | none (docs here; every delivery is under `.github/` or `scripts/`, which never ship, so none cuts a release) |
| Created | 2026-11-10 |

## Summary

Every pull request against `dev` is reviewed by one bot as soon as it opens, re-reviewed on every
push and every answer, and merged by GitHub's merge queue when the bot approves. The author never
merges, and the repository refuses a merge without the bot's pass, whoever asks. This RFC decides
how that holds: the bot speaks through a GitHub App, so it can approve `automagik-genie`'s own
PRs and post a check no write-access account can forge; a new ruleset on `dev` requires that
check and the merge queue, with no bypass for any person; merges stay serial and wait for the
previous release run to finish green; billing-path PRs and held PRs are reviewed but never merged
without the owner. It also places today's Reviewer, Tester, Fixer and Integrator lanes behind the
bot, fixes the verdict format, and says what happens when the bot is down.

The RFC is docs only. It creates no App, changes no ruleset and edits no workflow.

## Motivation

On 2026-11-10 five PRs (#961, #962, #965, #967, #972) were merged into `dev` by their author with
no review, and each cut a release (`.github/workflows/release.yml` cuts one on every push to
`dev`). Nothing in the repository stops that today:

- **`dev` has no review rule.** Its only ruleset, "dev and main: no force push or deletion",
  forbids force pushes and deletion and nothing else; branch protection is not set. Any account
  with write access can merge any PR, green or not.
- **Serial merging is a habit, not a rule.** The team waits for the previous release run before
  the next merge (a merge during a cut makes that cut lose its push, #668, still open), and checks
  that a PR's CI postdates the last `dev` merge in the same part. Both live in a helper outside the
  repository and in people's memory. `ci.yml` runs with `cancel-in-progress: true` on the group
  `ci-${{ github.ref }}`, so two merges seconds apart cancel the first one's `dev` CI: on
  2026-11-10 three of eight `dev` CI runs in under an hour were cancelled that way.
- **Review is a relay.** A Reviewer and a Tester seat give verdicts, the Orchestrator merges, the
  Integrator watches releases and re-runs CI. A team member who is not a bot has to know all of
  that to land a change. The owner's words: no contributor should have to merge their own work.

## Decided by the owner, 2026-11-10 (#991)

1. One event-driven PR Reviewer bot. On every PR opened against `dev` it reviews at once; no one
   has to ask. It works for PRs from any team member, not only the bots.
2. It leaves comments on what must be fixed, including where the PR does not follow the RFC
   system (missing RFC, wrong status, a decision the RFC does not cover).
3. It reads PR comments, replies, and re-reviews on every new push or answer.
4. It opens and closes issues itself, coordinating with the PM bot.
5. When it approves, the PR merges automatically. The author never merges.
6. Its approval is the second approver `dev` requires.
7. Billing, ledger, payments, grants and quote-signing PRs keep the owner's own review
   (`docs/rfcs/0025-cloud-economics.md`, "The review rule (Decided 3)"); so do PRs labelled
   `do not merge` or `blocked`, and anything the owner holds.

## Design

### (a) Identity: a GitHub App, not the `automagik-genie` account

Most bot PRs are authored by `automagik-genie`, and GitHub never lets an account approve its own
PR. The issue offers two ways out; only one closes the gate.

- **A required status check set by `automagik-genie`'s token** is forgeable: any account with
  write access can post a commit status with the same name through the statuses API, and a
  ruleset can pin a required check only to a GitHub App as its source, never to a user's token.
  So it leaves a path around the rule for every writer.
- **A GitHub App** is a second identity. It can approve `automagik-genie`'s PRs, and its check
  run can be pinned in the ruleset to the App's own id, so a status from anyone else does not
  count. A second machine user would also approve, but it is one more paid seat and one more
  password, and its check could not be pinned either.

**Recommended (Q1): the bot acts through a GitHub App,** working name "Automagik Reviewer",
installed on this repository only. `automagik-genie` stays the author of the team's PRs; the bot
is still the team's Genie, only its GitHub voice is the App. The App holds no right to push code.

The release's own pushes need a second, separate App (Q2), described in (c).

### (b) Trigger: a poll as the source of truth

The bot is a long-running team service on the team's own machine, beside the review seats. It
does not wait for events; every 60 seconds it asks GitHub, in one GraphQL call, for the open PRs
against `dev` (number, head sha, author, draft state, labels, comments since its last cursor) and
the merge queue's entries, and acts on what changed:

- a new head sha: it posts the `pr-reviewer` check run `in_progress` on that sha ("review
  queued") within that poll, and starts a review;
- a new comment by the author or a team member: it reads it and replies, and re-reviews when the
  answer changes a finding;
- a draft: no review until it is marked ready; the check says "draft".

**Why a poll, not a webhook or an Action.** A webhook needs a public endpoint reaching a private
machine: a new trust boundary, and missed deliveries still need a reconcile. A review run inside
Actions needs `pull_request_target` with secrets on untrusted code in a public repository, and
the review seats run on the team's own subscriptions, not on API keys in Actions. A poll is
level-triggered: a missed minute is caught by the next, and a restart picks up every open PR.
Two calls a minute are far inside an App's hourly API budget. A webhook to a relay that only
wakes the poll early can come later without changing anything here.

Any author works the same way. A PR from an account without write access (a fork) is reviewed
by reading only: the bot runs none of its code on the team's machine, and it merges only after
a team member also approves that head (Q5).

### (c) The ruleset on `dev`

A new active ruleset, "dev: reviewed merges only", targets `dev` beside the existing one:

- **Require a pull request:** one approval; dismiss stale approvals on push; require approval of
  the most recent push. The App's approval is the second approver of decision 6.
- **Require status checks:** `pr-reviewer`, pinned to the Reviewer App as its source, and
  `CI result`, pinned to GitHub Actions (a new aggregate job, (f)). Not "up to date with `dev`":
  the queue tests the merged result instead.
- **Require the merge queue** ((d)).
- **Bypass list: the Release App alone**, for its pushes. No user, team or repository role is on
  it, the owner included. The one path around the rule is an organisation owner editing the
  ruleset, which the organisation's audit log records (Q3: no standing emergency bypass).

**The release's pushes have to move first.** `release.yml` pushes the version commit and tag to
`dev` (`git push -q --atomic origin HEAD:refs/heads/dev`, the cut job) and the market index
listing (the `list` job), and `follow-omni.yml` pushes the `omni.json` bump, all with the
workflow token (`github.token`). The new ruleset refuses those pushes. Putting GitHub Actions on
the bypass list would let any workflow run with a write token push to `dev`, including one a
writer adds on their own branch: a path around. So those three pushes move to a Release App
token, minted in a job bound to a `release` environment whose deployment rule allows `dev`
only; the App's key is that environment's secret, so a run on any other ref cannot read it.

One change of behaviour comes with it. GitHub starts no run for a push made with the workflow
token (`release.yml` relies on that, "The workflow's own pushes ... start no run"), but it does
for an App's push. The cut job and `ci.yml` therefore skip a push whose actor is the Release App,
so a release commit starts no second cut. A PR that edits `release.yml`, `follow-omni.yml` or the
reviewer's own files is an owner-review PR ((g)), so the push path cannot be changed by review
alone. `main` keeps today's ruleset and its fast-forward to each release.

### (d) Merge order: the merge queue, one at a time, after the release is green

**Recommended: GitHub's merge queue** (this repository is public and owned by an organisation,
where the queue is available), squash only, one PR per group, one group building at a time. On
a SHIP the bot enqueues the PR; nobody else needs to. A writer may also press "merge when
ready", but the queue admits a PR only once its required checks pass, that is after the SHIP, so
that button is never a way around the review. The queue then:

- builds the PR on top of the current `dev` and runs CI there (`merge_group`), so the CI that
  admits a merge always postdates the current `dev`: the stale-CI rule holds by construction,
  where today it is checked by hand;
- merges one PR at a time, so no two merges land seconds apart.

The wait for the release is the bot's part. On each merge group the bot posts its own
`pr-reviewer` check, and completes it only when the PR's SHIP still stands at its head, no
Release or Follow Omni run is queued or running (Follow Omni calls the release as a reusable
workflow, so the Release list alone misses it), and the newest Release run's jobs all ended
green or skipped, the lane jobs included. While a release runs, the check stays in progress; the
queue's check timeout (120 minutes) drops a PR that waited too long, and the bot puts it back
once the release is green. When a release run fails, the bot tells the Integrator once.

**Rejected: the bot's own lock** (it merges through the API when its conditions hold). It needs
the bot on the bypass list (only the bypass can enforce "only the bot merges"), so one bug in the
bot merges a PR with red CI; the queue keeps every condition in GitHub, with the bot holding no
bypass. The queue's cost is CI twice per PR (on the PR and on its group) and a `merge_group`
trigger in `ci.yml`.

### (e) The review, and today's lanes

Each review runs in a fresh folder of the exact head sha, never in the author's worktree.

- **Docs-only PRs** (every changed path under `docs/` or a top-level `*.md`): one Reviewer pass.
- **Code PRs:** a Reviewer pass and a Tester pass on the same head, at the same time, by two
  independent agents. The Tester runs the part's gate from `AGENTS.md` through the shared gate
  lock and names a mutant it expects the tests to kill. SHIP needs both passes (Q6).

This is today's merge rule (2026-11-10: docs on one Reviewer verdict, code on Reviewer and Tester
in parallel) moved inside the bot. The lanes become:

| Lane today | With the bot |
|---|---|
| Reviewer | The bot's Reviewer pass. Its verdicts reach the PR only through the bot. |
| Tester | The bot's Tester pass on code PRs. Same rule. |
| Fixer | Unchanged: after a FIX-FIRST on a team bot's PR, the squad hands it the finding. On a person's PR the author fixes. The bot never pushes to a PR branch. |
| Integrator | Keeps watching release runs and owns CI re-runs; the bot asks it once when a check failed for an infrastructure reason. It stops merging. |
| Orchestrator | Keeps squad order and owner asks. It stops merging. |

### (f) Gates

The bot's check on a PR head passes only when all of these hold:

- its own verdict on that head is SHIP;
- every other check run and status on that head is success, skipped or neutral (the bot reads
  them all, not a fixed list, so a new job is covered the day it is added); commit messages
  included (`commitlint.yml`);
- the PR targets `dev`, is not a draft, and carries none of the hold labels ((g));
- for an owner-review PR, the owner has approved that same head.

`ci.yml` gains a `merge_group` trigger and one `CI result` job that needs every other job and
fails when any of them failed or was cancelled. The ruleset names only `CI result` and
`pr-reviewer`, so a job added to `ci.yml` never needs a ruleset edit.

### (g) What it never merges on its own

A committed list, `.github/pr-reviewer.json`, names the owner-review paths and the hold labels:

- **Owner-review paths:** every billing path of RFC 0025's Decided 3 (the ledger, the payment
  adapter, grants, quote signing, margins) as it lands; the reviewer's own files and that list;
  `release.yml` and `follow-omni.yml`; and every public-key list (`plugin-lane/keys.json`,
  `meter/usagemeter/meter-keys.json`, `herdr/mods/am-sidebar/pack-keys.json`, `am/am-keys.json`
  and their copies). A word match ("billing", "ledger", "grant") outside the list makes the bot
  ask the owner to rule, instead of guessing: the meter's token ledger
  (`meter/usagemeter/src/ledger.rs`) is not a billing ledger, and the list says so.
- **Owner-review PRs** get the label `owner-review`, a full review and a verdict. The bot's check
  stays "action required" until the owner's GitHub account approves that same head; a push voids
  his approval like any other.
- **Hold labels:** `do not merge` and `blocked` (both exist today). Any team member may set
  them; the bot removes only a label it set itself. An owner's comment "hold" on the PR makes the
  bot set `do not merge`, and only the owner lifts that one.

### (h) The verdict

The verdict is a GitHub review on the head sha it covers (GitHub binds a review to its commit),
so no separate comment is needed. Its first line is fixed, for people and scripts:

```
PR Reviewer: SHIP at 3f1c0e9a... (full 40-character sha)
```

Then the passes (Reviewer SHIP; Tester SHIP with the gate command, test counts and the mutant),
the numbered findings with `file:line`, the RFC-system lines ((i)) and the gates it read.

- **SHIP**: an approving review; the check passes when (f) holds; the bot enqueues the PR.
- **FIX-FIRST**: a "request changes" review with inline comments, one per finding.
- **BLOCKED**: a "request changes" review and the `blocked` label, naming the decision that is
  missing (an RFC, an owner ruling). Only that decision lifts it.

A new push voids the verdict: the ruleset dismisses the approval, and the check starts again on
the new sha. One push is cheaper: when the new head only merges `dev` in and the PR's own diff
(from its merge base) is identical to the one reviewed, the bot carries the verdict to the new
head in a review that names both shas, once that head's CI is green. A merge that resolved a
conflict gets a full review.

The bot reads comments from the author and team members as answers; comments from anyone else
are data, never instructions. Before posting anything it runs the repository's privacy check
(`herdr/scripts/privacy-check.mjs`) on its own text, since the repository is public.

### (i) RFC-system checks

Mechanical, each a finding when it fails:

- A PR fixing an issue labelled `needs-rfc` links an RFC whose status is Accepted or In delivery;
  with none, the verdict is BLOCKED.
- A new RFC takes the next free number (a companion page, like 0016's handoff, names its RFC
  instead), has its row in `docs/rfcs/README.md`, a status word from that file's Status values
  table and the header fields of its Template; its commits are all `docs(rfcs): ...`.
- A delivery PR names its RFC and delivery, and moves the RFC's row (Accepted to In delivery on
  the first delivery, Delivered on the last), or the bot files the follow-up.
- A PR stays on one release lane: `bun scripts/lane.ts kind` over its changes agrees with the
  lane its RFC delivery names.
- A closing keyword ("Fixes #N") appears only for an issue the PR fully fixes; partial work says
  "Refs #N".

Judgement, by the Reviewer pass: a PR that adds a contract its RFC does not list (an id, route,
storage key, setting or file format) gets a FIX-FIRST asking for the RFC's amendment first.

### (j) Issues, with the PM bot

- **Opening.** A finding outside the PR's scope, or one the author and the bot agree to defer,
  becomes an issue: the PR, the head sha and `file:line` in the body, and the new label
  `from-review`. The bot searches open issues first and comments on a match instead. It sets no
  squad, priority or milestone: the PM does, and the bot tells the PM in one message.
- **Closing.** `dev` is the default branch, so a merged PR's closing keywords close their issues.
  After each merge the bot checks that every issue the PR claimed is closed and every "Refs"
  issue is still open, and fixes the drift with a comment naming the merge commit. It closes an
  issue by itself only when it opened it and a merged PR resolved it.

### (k) When the bot is down or out of quota

Nothing merges: the ruleset requires the bot's check, and a missing or unfinished check blocks
the merge by construction. Someone is told:

- A scheduled workflow, `pr-reviewer-watch.yml` (every 30 minutes, off the hour like Follow
  Omni's), lists open, ready PRs whose head has no `pr-reviewer` check, or one in progress for
  more than 60 minutes outside a release wait. If any, it opens or updates one issue, "PR
  Reviewer is not answering", labelled `squad:lead`; the bot closes it when it catches up. The
  watch holds only a read token and the right to write issues.
- When a review seat is out of quota, the check says "waiting: reviewer out of quota until
  <time>" and the bot tells the Orchestrator. It may move a pass to another model the team lists
  for that pass; it never skips a pass to SHIP sooner.

### Until it exists

Every PR merged without review, the five above included, gets an after-the-fact review with its
verdict on the PR. Today's merge rule stays in force until delivery 5.

## Contracts introduced

- **Two GitHub Apps** on this repository only: the Reviewer App (reads code, writes reviews,
  check runs, labels and issues, enqueues; never pushes) and the Release App (pushes to `dev` and
  the tags; never reviews). Uninstalling either undoes it.
- **The ruleset** "dev: reviewed merges only" and the merge queue on `dev`. The existing rulesets
  stay as they are.
- **The check names** `pr-reviewer` (the Reviewer App's, on PR heads and merge groups) and
  `CI result` (`ci.yml`'s aggregate job).
- **The verdict's first line,** `PR Reviewer: <SHIP|FIX-FIRST|BLOCKED> at <sha>`.
- **`.github/pr-reviewer.json`**: owner-review paths, the word-match exceptions, hold labels,
  the models each pass may use.
- **Labels** `owner-review` and `from-review` (new); `do not merge` and `blocked` (kept).
- **The `release` environment** (deployment rule `dev` only) holding the Release App's key.
- **`pr-reviewer-watch.yml`**, the watch.
- **The bot's code** under `scripts/pr-reviewer/` (Bun, the repository's tooling rule).

No install changes: `.github/` and `scripts/` are in `NEVER_SHIPPED` (`scripts/lane.ts`), so
`bun scripts/lane.ts ships <last tag>` says no for every delivery.

## Threat model

- **The Reviewer App's private key** can approve and pass any PR that is not owner-review. It
  stays on the team's machine, readable only by the bot's service user, never in a worktree,
  an environment dump or a log. A leak is undone by revoking the key in the App's settings; the
  ruleset then blocks every merge until a new key is in place.
- **The Release App's key** can push to `dev`. It lives only in the `release` environment; a run
  on any ref but `dev` cannot read it. Changing that path is an owner-review PR.
- **Prompt injection through a PR** (its text, code or comments telling the bot to SHIP). The
  model decides the findings; the merge conditions in (f) and (g) are code, not the model: checks,
  labels, owner-review paths and the owner's approval. Comments from accounts without write
  access are data. A fork's code never runs on the team's machine.
- **A writer working around the rule**: a direct merge is refused (no person bypasses); a forged
  `pr-reviewer` status does not count (pinned to the App); a workflow on a branch cannot push to
  `dev` (Actions is not on the bypass list); editing the reviewer, its list or the release path
  needs the owner's approval.
- **Undo:** the owner sets the ruleset to disabled, and `dev` is back to today in one step.

## Deliveries

Each delivery is one PR against `dev`; none cuts a release.

**D1. The Release App takes the release's pushes.** The owner creates the Release App and the
`release` environment (the key goes straight into the secret, never printed). `release.yml`'s
`cut` and `list` jobs and `follow-omni.yml`'s bump push with its token; the cut job and
`ci.yml` skip a push by the Release App.
- *Check:* the next release cuts, tags and lists as before; its own pushes start no second cut;
  a dispatch of `release.yml` on another ref fails at the environment.
- *Rollback:* revert; the pushes go back to `github.token`.

**D2. CI ready for the queue.** `ci.yml` gains `merge_group` and the `CI result` job.
- *Check:* `CI result` shows on every PR; a scratch PR with one failing test shows it failed;
  cancelling one job shows it failed.
- *Rollback:* revert; nothing requires the check yet.

**D3. The bot in shadow.** The Reviewer App is created; the bot polls, posts its check (not
required yet), reviews with both passes, posts verdicts in the format of (h), runs the (i) checks
and opens issues with the PM, beside today's Reviewer and Tester.
- *Check:* #991's first two acceptance items: a PR opened by a team member, with no further
  action, gets a review within 5 minutes; a fixing push gets a re-review unasked. Over the shadow
  period (Q7) the bot's verdicts are tallied against the human-run pair's on the same heads.
- *Rollback:* stop the service; the check is not required, so nothing waits on it.

**D4. The watch.** `pr-reviewer-watch.yml`.
- *Check:* with the bot stopped for 70 minutes on a scratch PR, the issue opens; on restart the
  bot reviews it and closes the issue.
- *Rollback:* revert.

**D5. The switch.** The owner activates the ruleset and the queue; the bot enqueues on SHIP and
gates merge groups on the release.
- *Check:* #991's last three items: two SHIP PRs at once merge one after the other, the second
  only after the first's release run is all green; a write-access team member's `gh pr merge` on
  a SHIP PR is refused, and so is a forged `pr-reviewer` status; an owner-review PR is reviewed
  and waits until the owner approves its head. The App's approval counts as the required one.
- *Rollback:* the owner disables the ruleset; merges work as today.

**D6. The old path retires.** `AGENTS.md` says PRs merge through the queue; the Orchestrator and
the Integrator stop merging; the outside merge helper is retired.
- *Check:* every PR merged in the week after D5 was merged by the queue.
- *Rollback:* revert the text; the ruleset still holds.

## Open questions

**Q1. The bot's GitHub identity.** The direction says "acting as the `automagik-genie` account".
*Recommended:* a GitHub App ((a)): that account cannot approve its own PRs, and only an App's
check can be pinned. The owner picks its name; "Automagik Reviewer" is the working one.

**Q2. One App or two.** *Recommended:* two, so the key that approves cannot push and the key that
pushes cannot approve.

**Q3. An emergency bypass.** *Recommended:* none standing. In an emergency the owner disables
the ruleset, merges, and enables it again; the audit log keeps the record.

**Q4. The owner-review scope.** *Recommended:* the list in (g): billing paths, the reviewer's
own files, the two workflows that push, and the key lists. Not every `.github/` change, which
would put routine CI fixes on the owner's desk.

**Q5. PRs from accounts without write access.** *Recommended:* reviewed by reading only, and
merged only when a team member also approves the head.

**Q6. The Tester on code PRs.** *Recommended:* yes, as today; docs-only PRs need the Reviewer
pass alone.

**Q7. How long the shadow runs.** *Recommended:* three working days and at least ten PRs, with no
SHIP the human pair would have stopped on a correctness finding.

**Q8. Merge method.** The queue merges with one method. *Recommended:* squash. A history import
(RFC 0011, "Importing a repository with its history") needs a true merge: the owner does it by
disabling the queue rule for that one merge.

## Links

- **Issue:** #991 (the direction and its acceptance items). Unreviewed merges: #961, #962, #965,
  #967, #972. The cut race: #668.
- **RFCs:** [0001](0001-roadmap-and-milestones.md) docs never ship;
  [0011](0011-monorepo-parts-and-releases.md) parts, lanes and history imports;
  [0025](0025-cloud-economics.md) the billing review rule (Decided 3).
- **Files:** `.github/workflows/release.yml` (the `cut` and `list` jobs, the `release-cut`
  concurrency group), `.github/workflows/follow-omni.yml` (the bump push, the release call),
  `.github/workflows/ci.yml` (its concurrency group), `.github/workflows/commitlint.yml`,
  `scripts/lane.ts` (`kind`, `ships`, `NEVER_SHIPPED`), `herdr/scripts/privacy-check.mjs`,
  `docs/rfcs/README.md` (status values, template), `AGENTS.md`.
