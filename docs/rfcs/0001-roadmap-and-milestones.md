# RFC 0001: Roadmap and milestones

| Field | Value |
|---|---|
| Status | Accepted |
| Milestone | n/a (process) |
| Lanes | none (docs and GitHub only) |
| Created | 2026-10-30 |

## Summary

The public roadmap is a set of GitHub milestones named for outcomes, never for versions. Each
delivery is one issue under a milestone and one PR that closes it. Work in other repositories
is tracked by an Automagik issue that links out. Security gaps are named by title only until
fixed.

## Motivation

Every merge to `dev` cuts a release, so a version number says nothing about what a user gets.
Milestones named "3.60" would be wrong within a day. The work also spans several repositories
(Genie, Omni, Herdr's core, DeepSeek Harness), and a GitHub milestone holds issues from one
repository only.

## Design

### Milestones

- A milestone names an outcome a user can feel: "One message box", "The app opens fast".
- It has no due date and no version. It closes when its last issue closes.
- Each RFC names its milestone in its header and in the index.
- A milestone is created only for scheduled work. Draft and Parked RFCs have none.

### Milestone order

Decided by the owner. Milestones and one issue per delivery are created after the PR that lands
these RFCs merges.

| Order | Milestone | Holds |
|---|---|---|
| 1 | Safe browser and everyday fixes | RFC 0002; fixes #120, #88/#91, #153, #141 |
| 2 | One message box | RFC 0003 route descriptor; RFC 0004 chat kinds and picker |
| 3 | Other agents in the same chat | RFC 0003 ACP plugin, Claude Code and Codex first |
| 4 | Projects in one place | RFC 0005 repos base and picker, then Genie Simple |
| 5 | The app opens fast | RFC 0007, measured first |

Herdr (0006), Genie Publish (0005) and Platform (0008) stay at the RFC stage, with no
milestone, until their open questions are answered.

### Deliveries

- One delivery is one issue and one PR. The PR body says `Closes #N`.
- The issue copies the delivery's acceptance check and rollback note from the RFC.
- A delivery is complete for users at merge, or hidden behind a setting that is off.

### Cross-repo work

- Work that lands in another repository gets a tracking issue here, under the right milestone.
  It links to the issue or PR in the other repository and closes when that one merges.
- The tracking issue carries the `cross-repo` label, so the milestone never shows false
  completion.
- An org-level GitHub Project can be added later if the owner wants one view across repositories.

### Release lanes

- **Plugin lane, 3.N.P.** A merge that changes only the plugins ships as a patch with the plugin
  tarballs alone. Installed apps pick it up without a desktop build, and a failed trial rolls
  back to the previous plugins.
- **Desktop lane, 3.N.** A merge that touches `apps/desktop` cuts a full release with a desktop
  build. Users get an update prompt and a restart.
- A PR never mixes the two lanes. Slices are cut so that most of them ride the plugin lane.
- RFC and docs PRs: every commit is typed `docs(...)`, so the merge cuts no release. `docs/` is
  not on the never-shipped path list today, so a `feat:` or `chore:` commit under `docs/rfcs`
  would cut a full release.

### Batching

Decided by the owner. More small deliveries means more releases, and a desktop release costs
every user a restart.

- Plugin-only PRs ship alone, each as a 3.N.P patch.
- Desktop-touching PRs go one PR each into a standing staging branch. The staging branch
  reaches `dev` about once a week, as one desktop release.
- The staging branch replaces the per-round branches.

### Public roadmap

Decided by the owner: the RFCs and the roadmap are public now, scrubbed by the rules below.

### Security gaps

- A gap is named by its title only, for example "the script worker must reach the approval
  gate", until its fix merges.
- Issues, milestones, RFCs and PR titles carry no file, line, reproduction or exploit detail of
  an unfixed gap. Those go to a private GitHub security advisory.
- After the fix merges, the advisory can be published and linked.
- Public text carries no host names, home paths of real users, addresses, tokens or customer
  data.

### Labels

| Label | Use |
|---|---|
| `rfc` | The PR or issue that carries an RFC. |
| `lane:plugin` | A delivery that ships as 3.N.P. |
| `lane:desktop` | A delivery that ships as 3.N. |
| `cross-repo` | A tracking issue for work in another repository. |
| `security` | A security fix. Its title follows the title-only rule. |
| `needs-owner` | Waits on an owner answer. |
| `not-scheduled` | Belongs to a Draft or Parked RFC. |

## Contracts introduced

- Milestone names are public. Renaming one is allowed; issues follow it.
- Labels above are new. No existing label changes.

## Deliveries

1. Create the labels. Lane: none. Check: the labels exist. Rollback: delete them.
2. After this PR merges, create the five milestones in the order above, and one issue per
   delivery. Lane: none. Check: each milestone holds its delivery issues, and each cross-repo
   delivery has its tracking issue. Rollback: close the milestone.
3. Optional: add `^docs/` to the never-shipped path list in its own small PR. Lane: none (a
   `scripts/` change ships nothing). Check: a test commit under `docs/` reports no ship.
   Rollback: revert.

## Open questions

1. **Org Project or milestones only?** Recommended: milestones plus tracking issues now. Add an
   org Project only when more than one repository has active milestones.
2. **Add `^docs/` to the never-shipped list?** Recommended: yes, in its own PR, so a mistyped
   commit under `docs/` cannot cut a release.
3. **Staging branch name and cadence.** Recommended: `staging/desktop`, merged to `dev` on one
   fixed weekday, and earlier only for a security fix.

## Links

- [RFC index](README.md)
- Release lanes: `scripts/lane.ts`, `scripts/version.ts`
