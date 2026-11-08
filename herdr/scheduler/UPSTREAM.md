# Upstream: herdr-automations

The scheduler that fires the automations the pack's panel edits is vendored here from
[DnzzL/herdr-automations](https://github.com/DnzzL/herdr-automations) (MIT, © 2026 Thomas Legrand;
its notice is upstream's `LICENSE`, kept here as `LICENSE` and repeated in `LICENSE-upstream` under
the pack's naming convention). The folder is upstream's tarball, byte for byte, apart from the
excluded paths below and the fork's patch listed under Local changes. `go.mod` keeps upstream's
module path, `github.com/DnzzL/herdr-automations`.

This is not a herdr mod: there is no `mods/` or `main.js` here. The panel stays
`herdr/mods/am-automations`; this folder is the Go binary the panel and the automations run on.

- **Tag:** `v0.12.1`
- **Commit:** `900b4f258f5c1c3a42e13b9115c0df80782f2f4c` (short `900b4f25`)
- **Date:** 2026-11-04 (the commit is dated 2026-11-04T21:01:12Z)

## Excluded upstream paths

```
app/
herdr-automations
docs/*.gif
docs/*.png
.github/
```

- `app/` — upstream's own herdr mod (`app/mods/automations`, its preview and RECIPE). In this
  repository it would show up as a second `herdr-mod` entry; the panel is `herdr/mods/am-automations`.
- `herdr-automations` — the binary upstream commits at its root. Our binary is built by
  `.github/workflows/scheduler-release.yml` and attached to its own release, never committed.
- `docs/*.gif`, `docs/*.png` — the demo recordings and screenshots; they are not source.
- `.github/` — upstream's CI and release workflows. This repository's CI owns our builds.

Every other path is upstream's, byte for byte, except the fork's patch under Local changes. This
folder also adds two files that are not upstream's, which the check script below knows: `UPSTREAM.md`
(this note) and `LICENSE-upstream` (a copy of the tarball's `LICENSE`, checked against it; `LICENSE`
itself stays where upstream puts it).

## Local changes

The fork's patch, one line per path: the check script allows exactly these to differ (or, for a new
file, to be here) and prints each as patched or added; any other difference fails.

```
docs/adr/0012-a-successful-run-may-close-its-workspace.md — patched: existing mode closes its own tab; blocked grace
internal/api/api.go            — patched: ls --json carries blocked_grace_minutes
internal/api/api_test.go       — patched: the listing carries blocked_grace_minutes and its default
internal/config/config.go      — patched: blocked_grace_minutes, its default and range; existing mode may close its tab
internal/config/config_test.go — patched: the grace defaults, -1, and existing + on-success load
internal/config/edit_test.go   — patched: put's merge cases for blocked_grace_minutes; existing + on-success accepted
internal/hc/hc.go              — patched: hc read, the blocked run's screen
internal/herdr/herdr.go        — patched: tab create returns the tab id; tab close
internal/herdr/herdr_test.go   — patched: tab id and tab close wire cases
internal/host/hc.go            — patched: blocked fail-fast ends the blocked terminal; existing runs keep their tab id
internal/host/hc_test.go       — patched: blocked past the grace, a blip, and -1
internal/host/host.go          — patched: Session carries the run's tab; existing mode closes only that tab
internal/host/host_test.go     — patched: own-tab close, a missing tab id, worktree/root unchanged
internal/host/ops.go           — patched: TabCreate returns the tab id and TabClose is in the seam
internal/host/screen.go        — added: the dialog line read from a blocked screen
internal/host/screen_test.go   — added: dialog line, control characters, the bound and the fallback
internal/runner/runner_test.go — patched: the blocked failure's notice; existing mode's default
main.go                        — patched: put copies blocked_grace_minutes into the entry
main_test.go                   — added: the put wire path carries blocked_grace_minutes; existing + on-success accepted
README.md                      — patched: blocked_grace_minutes, and existing mode's own-tab close
```

Why: the #498 stopgap, two scheduler changes. An agent that stays `blocked` on a
dialog longer than `blocked_grace_minutes` (default 2, `-1` keeps the old
wait-for-the-timeout behaviour) now fails at once. The history error carries the
dialog line from the screen, the failure goes out through notify, and the blocked
terminal is ended; its workspace/tab stays open like any failed run's. And
`close_workspace: on-success` is valid with `workspace: existing`: it closes only
the tab the run opened, never the shared workspace or any other tab, and closes
nothing when the run has no tab id. The loader no longer refuses that combination,
and `ls --json` / `put` carry `blocked_grace_minutes` like the other keys.

The earlier patch is still why `close_workspace` exists in the API at all: the pack's
panel sets it per automation (issue #498). `ls --json` names it for every entry, and
`put` accepts it with the same merge rules as the other keys: a value writes it, a
request without the key keeps the hand-written value, an empty value removes the key.
An invalid value is refused by the loader. Keep the patch to this list.

## Refreshing

1. Put the new tarball in a scratch folder (`.cache/` is gitignored and outside the comparison):

   ```sh
   mkdir -p .cache/upstream-v0.12.1
   gh api repos/DnzzL/herdr-automations/tarball/v0.12.1 > .cache/upstream-v0.12.1.tar.gz
   tar -xzf .cache/upstream-v0.12.1.tar.gz -C .cache/upstream-v0.12.1 --strip-components=1
   ```

2. Replace the copy, leaving the excluded paths out. This overwrites the local changes above: re-apply
   them after (or restore your copies), and update the list when the patch changes:

   ```sh
   tar -C .cache/upstream-v0.12.1 -cf - \
     --exclude='./app' --exclude='./herdr-automations' \
     --exclude='./docs/*.gif' --exclude='./docs/*.png' --exclude='./.github' . \
     | tar -C herdr/scheduler -xf -
   ```

3. Prove it. The script downloads that tag's tarball into a temp folder, compares every path the
   exclusion list leaves in, checks `LICENSE-upstream` against the tarball's `LICENSE`, and prints
   the local changes it allowed as patched or added:

   ```sh
   node herdr/scripts/scheduler-upstream.mjs --tag v0.12.1 --dir herdr/scheduler
   ```

   It prints each differing, missing or extra path and exits 1 on any difference; exit 0 means the
   copy is byte-identical to upstream minus the exclusions, with only the Local changes above
   differing.

4. Update the tag, commit and date above, the Local changes list and the entry in `herdr/NOTICE`.
   No lane change is
   needed: `scripts/lane.ts` lists `herdr/scheduler/` in `NEVER_SHIPPED`, so a scheduler refresh
   cuts no release of its own (the binary ships from its own release lane).
