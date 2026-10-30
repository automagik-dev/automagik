# RFC 0005: Workspace and Genie projects

| Field | Value |
|---|---|
| Status | Accepted |
| Milestone | 4. Projects in one place (Publish not scheduled) |
| Lanes | plugin (3.N.P); Genie repository (cross-repo) |
| Created | 2026-10-30 |

## Summary

Repositories live under one base, `~/.automagik/workspace/repos`, set in Genie's settings. A
Finder-style column picker chooses folders inside it. Genie Simple gives each Genie one project
with its folder and git handled for the user, and shows versions and Publish with no git words.
Genie Advanced stays manual.

## Motivation

Folders are picked from a flat menu today, and projects end up anywhere on disk. People who do
not use git still need versions they can go back to. Developers need to bring their own repos,
branches and worktrees.

## Design

### Repos base

- The base is `<Automagik home>/workspace/repos`, by default `~/.automagik/workspace/repos`.
- It is set in Genie's plugin settings. Changing it moves nothing; it only changes where new
  projects go and where the picker is rooted.
- Genie creates and opens projects only inside the base.
- Every path is resolved to its real path and checked to stay inside the base after symlinks.
  A new folder name may not contain `..` or a path separator. Genie's tools run the same check
  on the host, not only in the picker.

### Folder picker

- Columns, like Finder, rooted at the base. The user cannot go above it.
- "New folder" works in any column. A git repository shows its branch.
- A "Recent" list sits beside the base.

### Genie Simple

- **One project per Genie.** Creating the Genie creates `<base>/<project-name>`.
- **Git underneath.** The folder is a git repository from the start, with a default
  `.gitignore` that covers `.env` files, keys and credentials. The UI never shows git words.
- **Changes.** Edits pile up as "N changes since vN", each with a one-line summary.
  "Undo all" returns to the last version.
- **Versions.** "Save as vN" keeps a version: a commit and a tag underneath. Any saved version
  can be opened, compared or put live again.
- **Publish.** Built on Automagik's own release model: a version becomes a release. Decided by
  the owner: a GitHub release first; a hosted site later, as its own RFC. Publish stays at the
  RFC stage until the questions below are answered.

### Simple or Advanced

Decided by the owner: the mode is set per Genie, and new Genies start Simple.

### Genie Advanced

Nothing is automatic. The user picks a folder inside the base, the machine, the branch to start
from and whether to use a worktree.

## Contracts introduced

- The repos base path and its Genie setting. Compatibility: existing Bots and Genies whose
  folder is outside the base keep working in it. The picker lists such a folder under
  "Elsewhere" until the user moves it. Only new projects must be inside the base.
- Genie Simple's version tags, `vN` in the project's repository. Compatibility: new projects
  only; an existing folder becomes a Simple project only by an explicit action.

## Threat model

Publish sends a project's files out of the machine, so it is a trust boundary.

- **Who can reach it.** Only the owner, by a click in the UI. A Genie can prepare a version but
  cannot publish.
- **What it can do.** Make a saved version public, or visible to whoever the target allows.
- **Before publishing.** The UI lists exactly what will be published, scans it for secrets
  first, and defaults to private.
- **Undo.** A release can be deleted or set private again. Anything already copied by others
  cannot be recalled; the UI says so before the first public publish.

## Deliveries

1. **Repos base and path checks.** Genie setting and host-side checks. Lane: Genie repository,
   tracked here by a cross-repo issue. Check: a path that escapes the base through `..` or a
   symlink is refused by a Genie tool. Rollback: revert; no data moves.
2. **Column picker with New folder.** Lane: plugin. Check: the picker cannot leave the base, and
   an existing outside folder appears under "Elsewhere". Rollback: revert to today's menu.
3. **Genie Simple project.** Automatic folder, git and `.gitignore`. Lane: Genie repository
   (cross-repo issue). Check: a new Simple Genie has its folder, an initial version and a
   `.gitignore` that excludes `.env`. Rollback: revert; created projects stay as plain folders.
4. **Versions.** Changes list, Save as vN, Undo all, open or compare a version. Lanes: Genie
   repository and plugin (one PR each). Check: save, change, undo, and reopen v1. Rollback:
   revert; tags stay in the repositories.
5. **Publish.** Not scheduled until question 3 is answered.

## Open questions

1. **Can a Genie switch modes?** Recommended: Simple to Advanced is allowed at any time; going
   back to Simple is not offered.
2. **Moving an outside folder into the base.** Recommended: offer "Move into repos" in the
   picker, never move anything without that click.
3. **Where does the GitHub account come from for Publish?** Recommended: the user's own sign-in
   through the GitHub CLI or a device-code flow, stored in the OS keychain.

## Links

- #155 adopted DSH Bot project selection
- [0004](0004-composer-chat-kinds.md) Genie kinds in the composer
- [0001](0001-roadmap-and-milestones.md) cross-repo tracking
