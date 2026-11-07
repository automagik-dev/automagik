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
internal/api/api.go            — patched: Automation carries close_workspace, set from the entry in List()
internal/api/api_test.go       — patched: ls --json shows close_workspace, and never by default
internal/config/edit_test.go   — patched: put's merge cases for close_workspace
main.go                        — patched: put copies close_workspace into the entry; an empty one removes it
main_test.go                   — added: the put wire path carries close_workspace
```

Why: the pack's panel is to set `close_workspace` per automation (issue #498). Upstream's config
layer, validation, default and runner already honour it (`never` | `on-success`, default `never`,
refused with `workspace: existing`); the API did not. `ls --json` now names it for every entry, and
`put` accepts it with the same merge rules as the other keys: a value writes it, a request without
the key keeps the hand-written value, an empty value removes the key, and an invalid value (including
`on-success` with `workspace: existing`) is refused by the loader. Keep the patch to this list.

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
