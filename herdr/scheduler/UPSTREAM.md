# Upstream: herdr-automations

The scheduler that fires the automations the pack's panel edits is vendored here from
[DnzzL/herdr-automations](https://github.com/DnzzL/herdr-automations) (MIT, © 2026 Thomas Legrand;
its notice is upstream's `LICENSE`, kept here as `LICENSE` and repeated in `LICENSE-upstream` under
the pack's naming convention). The folder is upstream's tarball, byte for byte, apart from the
excluded paths below. No Go file is edited here, and `go.mod` keeps upstream's module path,
`github.com/DnzzL/herdr-automations`.

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

Every other path is upstream's, byte for byte. This folder adds two files, which the check script
below knows: `UPSTREAM.md` (this note) and `LICENSE-upstream` (a copy of the tarball's `LICENSE`,
checked against it; `LICENSE` itself stays where upstream puts it).

## Refreshing

1. Put the new tarball in a scratch folder (`.cache/` is gitignored and outside the comparison):

   ```sh
   mkdir -p .cache/upstream-v0.12.1
   gh api repos/DnzzL/herdr-automations/tarball/v0.12.1 > .cache/upstream-v0.12.1.tar.gz
   tar -xzf .cache/upstream-v0.12.1.tar.gz -C .cache/upstream-v0.12.1 --strip-components=1
   ```

2. Replace the copy, leaving the excluded paths out:

   ```sh
   tar -C .cache/upstream-v0.12.1 -cf - \
     --exclude='./app' --exclude='./herdr-automations' \
     --exclude='./docs/*.gif' --exclude='./docs/*.png' --exclude='./.github' . \
     | tar -C herdr/scheduler -xf -
   ```

3. Prove it. The script downloads that tag's tarball into a temp folder, compares every path the
   exclusion list leaves in, and checks `LICENSE-upstream` against the tarball's `LICENSE`:

   ```sh
   node herdr/scripts/scheduler-upstream.mjs --tag v0.12.1 --dir herdr/scheduler
   ```

   It prints each differing, missing or extra path and exits 1 on any difference; exit 0 means the
   copy is byte-identical to upstream minus the exclusions.

4. Update the tag, commit and date above and the entry in `herdr/NOTICE`. No lane change is
   needed: `scripts/lane.ts` lists `herdr/scheduler/` in `NEVER_SHIPPED`, so a scheduler refresh
   cuts no release of its own (the binary ships from its own release lane).
