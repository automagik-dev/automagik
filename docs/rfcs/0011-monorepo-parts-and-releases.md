# RFC 0011: Monorepo parts and releases

| Field | Value |
|---|---|
| Status | Accepted (the owner OKd one version and the jump, 2026-11-03) |
| Milestone | n/a (process) |
| Lanes | herdr (3.N.P), added here; pocket, added by Pocket's import |
| Created | 2026-11-03 |

## Summary

Automagik is one repository whose parts ship on their own: the desktop app, the DSH plugins, the
herdr pack, and Pocket (when it is imported). Every release has the one version and the one tag
`vX.Y.Z`. A release rebuilds and attaches only the parts whose paths changed since the release
before, and each part's updater takes the newest release that carries its own asset. A desktop-only
release never offers a pack update, and a pack-only release never cuts a desktop build.

This RFC covers the herdr part, imported from `automagik-dev/automagik-herdr` with its history.
Pocket's import adds its own part (its `latest.json`, the versionCode guard) to this RFC.

## Motivation

The owner decided (2026-11-03) that the herdr pack and Pocket are Automagik, not standalone
products, and that everything ends up in this monorepo. The repository already releases on every
merge into `dev` (`.github/workflows/release.yml`), and every installed app takes those releases.
Importing a part therefore needs three things in the same pull request: a lane, so a change to the
part does not cut builds of the others; the part's own artifacts on the releases that rebuilt it;
and updaters that find their asset among releases that are mostly someone else's.

## Parts

| Part | Paths | On a release that rebuilt it | Its updater reads |
|---|---|---|---|
| Desktop app | everything not below (`apps/desktop/`, the profile, lockfiles…) | the dmg, AppImage and deb, `latest-*.yml`, `SHA256SUMS` | `apps/desktop/src/update.js`: the newest release with its platform's feed |
| Plugins | `apps/<plugin>/` | `automagik-<plugin>-<v>.tgz`, `plugins.json`, `PLUGINS.SHA256SUMS`, `lane.json` | the rolling `plugin-lane` release (`scripts/lane.ts`) |
| Herdr pack | `herdr/` | `automagik-herdr-pack-<v>.tgz` and `automagik-herdr-pack-<v>.tgz.sha256` | `herdr/mods/am-sidebar/release.js`: the newest release carrying both |
| Pocket | `apps/pocket/`, `herdr/mods/pocket-link` | (Pocket's import) | (Pocket's import) |

`herdr/` is a top-level folder because Herdr's crawler (herdr.dev) indexes top-level folders. The
herdr.dev listing waits on the owner's gate: no `herdr-mod` or `herdr-layout` topic is set on this
repository until then.

## Versioning

- One version (`bun scripts/version.ts`). It writes `herdr/package.json` and the pack's
  `herdr/mods/am-sidebar/VERSION`, a plain-text field (the version alone on one line, which the
  pack's updater reads). `herdr/scripts/version.mjs` only checks that the pack carries the root's
  version; the pack has no bump or release logic of its own.
- No `herdr-v*` tags. The import fetches no tags: the old repository's `v0.N.P` are not releases
  of this one.
- On its first monorepo release the pack jumps from 0.7.x to the monorepo's 3.N.P. Semver only goes
  up, so every updater accepts it.

## Lanes

`scripts/lane.ts kind <last-full-tag> <last-tag>` and `scripts/lane.ts herdr <last-tag>` decide
what a release is and whether it attaches the pack:

| What shipped | Kind | Version | Attaches | Desktop build | Plugin lane | Market index |
|---|---|---|---|---|---|---|
| Since the last release (any tag), only `herdr/` | `herdr` | 3.N.P (next patch) | the pack | no | not re-signed | not re-pinned |
| Since the last full release, only plugins (and `herdr/`) | `plugins` | 3.N.P | the plugins, the lane, the pack when `herdr/` shipped since the last release | no | signed | pinned |
| Anything else | `full` | 3.(N+1).0 | everything, the pack when `herdr/` shipped since the last release | yes | signed | pinned |

- `herdr/` shipped since the last release when one of its paths changed that is neither never
  shipped nor a version-only bump. Never shipped in the part: its top-level `*.md`, `docs/`,
  `.genie/`, `mockup/`, `test/` and `catalog/` (installed mod managers read the catalog from `dev`
  directly). The repository's own `docs/` ships nothing either (this change adds it to
  `NEVER_SHIPPED`; no build reads it).
- The herdr kind is measured since the last release of any kind, not since the last full one:
  measured since the full one, a herdr-only merge after a plugin patch would pack the plugins again
  and re-sign the lane, and every desktop app would reinstall plugins that did not change.
- A herdr patch, like a plugin patch, is not marked Latest; `main` still moves to it.

## The pack on a release

`release.yml`'s "Pack the herdr pack" step is the old repository's Pack step, under `herdr/`:

- From the tag, not the working tree: `git archive` of the tag's `herdr/mods/<PACK_MODS>` plus
  `herdr/layouts/automagik.json` as `layouts/automagik.json`. The folder list is the tag's
  `PACK_MODS` (`herdr/mods/am-sidebar/release.js`); every other folder of `herdr/mods/` but
  `pocket-link` must be in it, and the archive's top level must be exactly it plus `layouts/`.
- `automagik-herdr-pack-<v>.tgz.sha256` is `sha256sum` of the tarball alone: the same line the old
  release's `SHA256SUMS` held. It is named after the tarball because a full release's desktop build
  writes its own `SHA256SUMS` to the same release.
- The pack goes into `release/` before the plugins' `PLUGINS.SHA256SUMS` is written, so that list
  names it too: a full release's desktop build deletes any asset the list does not name (except
  `automagik-*.tgz`), and would otherwise delete the `.sha256`.
- The release re-runs the pack's CI gate before it tags, when `herdr/` shipped, and regenerates
  `herdr/catalog/index.json` in the release commit, as the old release did.

## Updaters and the installer

- The pack's updater (`release.js`, `update.mjs`, the sidebar's check through `updateCheck.js`)
  reads `https://api.github.com/repos/automagik-dev/automagik/releases?per_page=100` page by page
  (`&page=N`), until a page holds a pack, a page comes back short, or 10 pages (1000 releases,
  `MAX_RELEASE_PAGES`) were read. It takes the newest release, by version, that is neither a draft
  nor a prerelease and carries both `automagik-herdr-pack-<v>.tgz` and its `.sha256`, as the
  desktop's `update.js` does. `latest` is the newest such release, not GitHub's Latest. A single
  page would not do: at a few releases an hour, a quiet pack falls out of the newest 100 within a
  day or two (t259).
- `herdr/install.sh` picks the same release the same way (the same cap, `MAX_PAGES`, kept equal by
  a test; Node is checked before it reads the list), downloads the tarball and its `.sha256` from
  `releases/download/v<v>/`, and checks the hash before anything is written. `--version <v>` takes
  a release that carries the pack. The one-liner is
  `curl -fsSL https://raw.githubusercontent.com/automagik-dev/automagik/main/herdr/install.sh | bash`;
  `main` moves to every release, so it serves the released installer.
- Past the cap, both say there is no pack. The search is the stopgap until the signed pointer
  below, which answers in one request.
- The mod manager's catalog is `https://raw.githubusercontent.com/automagik-dev/automagik/dev/herdr/catalog/index.json`.
  The old repository's two catalog URLs count as written by the pack: an install or update rewrites
  them to the new one, and until then the mod manager reads the new one. The index names the pack as
  `automagik-dev/automagik`, path `herdr`.

## CI

- `ci.yml`'s `herdr` job runs the old repository's gate from `herdr/`, on the newest Node 22 and
  on 24. Two floors (t22n's ruling): the pack's users run it on Node 22.7 or later (the launcher,
  `install.sh`), and its tests need the newest Node 22, as the stubs use `module.registerHooks`
  (22.15+). No stub fallback: `node --test 'test/*.test.mjs'`, `node --check` on every pack mod and
  script, `sh -n` and `shellcheck -s sh` on the installer and the CLI's shell scripts,
  `node scripts/catalog.mjs --check`, `node scripts/version.mjs check`. It runs when `herdr/`, the
  CI or release workflow, or `scripts/lane.ts` or `scripts/version.ts` changed. The other jobs are
  unchanged; the `repo` job's `bun run check` covers the pack's version fields.
- am-quota's Keychain tests run against the stand-in `security` in `herdr/test/am-quota-keychain.mjs`,
  and `am-quota-keychain-guard.test.mjs` fails any that could reach the real one.
- The old repository's workflows were deleted at the import (`herdr/.github/`).

## Importing a repository with its history

- `scripts/import-herdr.sh` clones the source's `dev` into a temporary folder, runs
  `git filter-repo --to-subdirectory-filter herdr` there (never in this repository), and merges it
  with `--allow-unrelated-histories`, without tags. It refuses a history that holds a database, a
  key or an `.env`. filter-repo is deterministic, so a re-run before the cutover merges only the
  source's newer commits.
- `commitlint.yml` skips only the history an import brought. An import merge is a merge whose
  second parent's history never reaches this repository's own first commit (the root of dev's
  first-parent line), and its imported commits are those reachable from that second parent and not
  from its first. The final re-run adds a second such merge, and only its new upstream commits are
  skipped. Every other commit is checked: the pull request's own, ones after dev is merged in, and
  those of a branch of this repository merged with `--no-ff`. The herdr import has ten commits whose
  bodies run past 100 characters; they stay as the source wrote them.

## Required follow-up before the bridge: a signed rolling pointer

The `.sha256` comes from the same release as the tarball, so it proves integrity, not provenance:
anyone who can publish a release (or swap its assets) can publish a matching pair (t259's note).
The releases search above also costs up to ten requests. Both are fixed together, as `plugin-lane`
fixes them for the plugins; the signing and the pointer ship in one change, before the bridge
points installed packs at this repository:

- A rolling `herdr-lane` release holds only `pack.json` and `pack.json.sig`. `pack.json` names the
  newest pack release: its version and tag, the tarball's URL, sha256 and size, a monotonic
  sequence (a consumer refuses one older than the last it took), the key id and the time it was
  issued. Every release that rebuilt the pack rewrites both, with `--clobber`, after the pack is
  uploaded to its own versioned release.
- `pack.json.sig` is ed25519 over the exact bytes of `pack.json`, detached and base64, as
  `scripts/lane.ts sign` does for `lane.json`. It is signed with a key of the pack's own, the
  `HERDR_PACK_KEY` secret, not `PLUGIN_LANE_KEY` (t22n's recommendation, agreed by t259): a leak of
  one key does not reach the other part.
- The trusted public keys ship inside the pack (`release.js`, kept equal to a committed
  `herdr/keys/pack-keys.json` by a test), so the installed copy is the trust anchor. A key rotation
  ships in a pack named by a pointer signed with the old key.
- `update.mjs` and `install.sh` read `releases/download/herdr-lane/pack.json` and its `.sig` in one
  request each, verify the signature (`node:crypto` in both; Node is already required), then check
  the tarball against the sha256 the pointer names. The releases search goes, and so does trusting
  a `.sha256` from the same release. Tests sign their fixtures with a key generated per run, passed
  only in the file:// test mode, never for a GitHub URL.

It is not part of the import: it touches the release step, a new secret, both verifiers, the trust
anchor and every install and update fixture. It is needed from the bridge on, because until then
no installed copy reads this repository's releases. A fresh install through the new one-liner
before it lands gets the hash check alone, as the old repository's installs did.

## Bridge and cutover (after this change)

1. The monorepo publishes the first release that carries the pack (the first merge after this
   change that ships something under `herdr/`), and the signed rolling pointer above has landed.
2. automagik-herdr cuts one bridge release whose `release.js` and `install.sh` read this
   repository's releases, as here. An installed 0.7.x updates to it from automagik-herdr, then to
   3.N.P from here.
3. An installed copy is seen to update across the bridge; then automagik-herdr is archived with a
   README pointer here.

Until the bridge, installed packs keep updating from automagik-herdr.

## Open questions

1. Who builds the signed rolling pointer, and when the `HERDR_PACK_KEY` secret is added (Felipe
   adds it; never printed, never regenerated). (t22n, t259)
2. `herdr/catalog/repos.json` lists Pocket Link as an external entry at `automagik-dev/automagik-pocket`;
   Pocket's import moves it. (t16r)

Resolved (t259's review, t22n's rulings, 2026-11-03):
- Commitlint skips only what an import merge's second parent brought, and keeps working across the
  final re-run's second import merge.
- The 100-release window: page through releases now (capped); the signed rolling pointer, with
  `HERDR_PACK_KEY` as its own key, is a required follow-up before the bridge.
- The Node floors: users' runtime Node 22.7 or later (the launcher, `install.sh`); tests on the
  newest Node 22 (22.15+, for `module.registerHooks`) and 24; no stub fallback.
