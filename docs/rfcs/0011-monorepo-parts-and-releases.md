# RFC 0011: Monorepo parts and releases

| Field | Value |
|---|---|
| Status | Accepted (the owner OKd one version and the jump, 2026-11-03) |
| Milestone | n/a (process) |
| Lanes | herdr (3.N.P), added here; pocket (3.N.P), added by Pocket's import; usagemeter (3.N.P), proposed |
| Created | 2026-11-03 |

## Summary

Automagik is one repository whose parts ship on their own: the desktop app, the DSH plugins, the
herdr pack, and Pocket, the phone app. Every release has the one version and the one tag
`vX.Y.Z`. A release rebuilds and attaches only the parts whose paths changed since the release
before, and each part's updater finds the newest release that carries its own asset (the desktop
app by its feed, the plugins and the herdr pack through a signed rolling pointer, Pocket through
the rolling `pocket-lane` release). A desktop-only
release never offers a pack update, and a pack-only release never cuts a desktop build.

This RFC covers the herdr part, imported from `automagik-dev/automagik-herdr` with its history,
and Pocket, imported from `automagik-dev/automagik-pocket` with its history ("Pocket" below: its
lane, the versionCode guard, `latest.json` on `pocket-lane`, the signing secrets, the bridge).
It also proposes importing usagemeter, the token meter, from `automagik-dev/usagemeter` with its
history ("Usagemeter" below: a plan with four open questions; nothing is built yet).

**Amended by [RFC 0012](0012-am-cli-and-parts.md) (D35, 2026-11-03).** `am` is its own part,
in a top-level `am/` folder, and the one exception to "a release attaches only the parts it
rebuilt": every `vX.Y.Z` release attaches `automagik-am-<v>.tgz` and re-signs a rolling `am-lane`
pointer with am's own key, whatever its lane kind. An am-only merge is a new lane kind, `am`
(3.N.P). `am-lane` follows `herdr-lane`'s rules below (check-key before the tag, fail-closed
posting, no lower sequence). RFC 0012's deliveries make the `release.yml` and `lane.ts` changes;
until they ship, this RFC describes the releases as they are.

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
| Herdr pack | `herdr/`, `herdr-layout/` | `automagik-herdr-pack-<v>.tgz` and `automagik-herdr-pack-<v>.tgz.sha256`; the `herdr-lane` pointer is re-signed | the rolling `herdr-lane` release (`scripts/herdr-lane.ts`), checked against the pack's `pack-keys.json` |
| Pocket | `apps/pocket/` (Pocket Link, `herdr/mods/pocket-link`, is on the herdr lane) | `automagik-pocket-<v>.apk` and `latest.json`; `latest.json` on the rolling `pocket-lane` release is replaced | `latest.json` on `pocket-lane` (`apps/pocket/android/app/build.gradle.kts`, `UPDATE_URL`) |
| Usagemeter (proposed, "Usagemeter") | `apps/usagemeter/` | `usagemeter-<os>-<arch>` (four builds), `usagemeter.SHA256SUMS`, `usagemeter-install.sh`; the rolling `usagemeter-lane` release's assets and `usagemeter.json` are replaced | no updater of its own: the herdr pack installs the version and sha256 values `herdr/mods/am-sidebar/release.js` pins; `usagemeter-install.sh` alone reads `usagemeter-lane` |

`herdr/` is a top-level folder because Herdr's crawler (herdr.dev) indexes top-level folders. The
herdr.dev listing waits on the owner's gate: no `herdr-mod` or `herdr-layout` topic is set on this
repository until then.

The pack's layout is its own top-level entry folder, `herdr-layout/` (`layouts/automagik.json`,
`RECIPE.md`, `preview.png`), not `herdr/layouts/`: the crawler skips the whole repository when a herdr-mod entry
folder holds `layouts/`, and a skip deletes a listing it had (probe-confirmed, t22n and t259). A
herdr-mod entry folder is any folder holding `mods/<name>/main.js`, as the mod manager reads a
package. `herdr/scripts/entries.mjs --check` fails when one holds `layouts/`; CI runs it on every
pull request and the release with the pack's gates. The probe's layout test
settled the shape: herdr.dev lists a layout only from its entry folder's `layouts/<name>.json`
and ignores a `.json` at the folder's root (e2 went unlisted for want of `layouts/`, not because of
its root `.json`: 60 listed layout entries hold one), and the entry needs no `mods/` of its own
(its RECIPE tells people to add `herdr/` first). `entries.mjs --check` also fails when `herdr-layout/` loses
that shape. Until then the mod manager,
which installs a package's own `layouts/`, no longer installs the layout with the pack from the
catalog; `install.sh` and the updater still do, from the tarball.

## Versioning

- One version (`bun scripts/version.ts`). It writes `herdr/package.json` and the pack's
  `herdr/mods/am-sidebar/VERSION`, a plain-text field (the version alone on one line, which the
  pack's updater reads). `herdr/scripts/version.mjs` only checks that the pack carries the root's
  version; the pack has no bump or release logic of its own.
- No `herdr-v*` tags. The import fetches no tags: the old repository's `v0.N.P` are not releases
  of this one.
- On its first monorepo release the pack jumps from automagik-herdr's v0.14.x (the final import is
  v0.14.1, `513f91ac`, its frozen `dev`) to the monorepo's 3.N.P. Semver only goes up, so every updater accepts
  it.

## Lanes

`scripts/lane.ts kind <last-full-tag> <last-tag>` and `scripts/lane.ts herdr <last-tag>` decide
what a release is and whether it attaches the pack:

| What shipped | Kind | Version | Attaches | Desktop build | Plugin lane | Market index |
|---|---|---|---|---|---|---|
| Since the last release (any tag), only `herdr/` | `herdr` | 3.N.P (next patch) | the pack | no | not re-signed | not re-pinned |
| Since the last release, only `apps/pocket/` (or `apps/pocket/` and the herdr part) | `pocket` | 3.N.P | the APK and `latest.json`, the pack when `herdr/` shipped | no | not re-signed | not re-pinned |
| Since the last full release, only plugins (and `herdr/`) | `plugins` | 3.N.P | the plugins, the lane, the pack when `herdr/` shipped since the last release | no | signed | pinned |
| Anything else | `full` | 3.(N+1).0 | everything, the pack when `herdr/` shipped since the last release | yes | signed | pinned |

- `herdr/` shipped since the last release when one of its paths changed that is neither never
  shipped nor a version-only bump. Never shipped in the part: its top-level `*.md`, `docs/`,
  `.genie/`, `mockup/`, `test/` and `catalog/` (installed mod managers read the catalog from `dev`
  directly). `herdr-layout/` is part of the herdr part: its `layouts/automagik.json` ships in the pack, its
  `RECIPE.md` and `preview.png` do not. The repository's own `docs/` ships nothing either (this change adds it to
  `NEVER_SHIPPED`; no build reads it).
- The herdr kind is measured since the last release of any kind, not since the last full one:
  measured since the full one, a herdr-only merge after a plugin patch would pack the plugins again
  and re-sign the lane, and every desktop app would reinstall plugins that did not change.
- A herdr patch, like a plugin patch, is not marked Latest; `main` still moves to it.

## The pack on a release

`release.yml`'s "Pack the herdr pack" step is the old repository's Pack step, under `herdr/`:

- From the tag, not the working tree: `git archive` of the tag's `herdr/mods/<PACK_MODS>` plus
  `herdr-layout/layouts/automagik.json` as `layouts/automagik.json` (inside the tarball, `layouts/` is where
  the updater and the installer look; in the repository it is never under `herdr/`). The folder list is the tag's
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

A release carries the pack only when `herdr/` changed, so most releases carry none, and the
`.sha256` beside a tarball comes from the same release, which proves integrity, not who published
it (t259). Both are answered by a signed rolling pointer, as `plugin-lane` answers them for the
plugins (`scripts/herdr-lane.ts`):

- A rolling `herdr-lane` release (a prerelease, never Latest) holds only `pack.json` and
  `pack.json.sig`. `pack.json` names the newest pack release: its version, tag and commit, the
  tarball's URL, sha256 and size, a monotonic `sequence` (3.N.P as N·10000 + P), the key id and the
  time it was issued. A release that rebuilt the pack uploads the pack to its own versioned release
  first, then rewrites both with `--clobber`. `--clobber` replaces each asset in turn, so a reader
  may briefly see a pointer and a signature that do not match, or neither; both fail closed (refused,
  or no update yet).
- The pointer never goes back: before it posts, the release downloads the posted pointer, and
  `herdr-lane.ts posted` refuses to post one whose sequence is lower than a posted pointer that
  verifies (a re-run of an older release's run). It fails closed: only "nothing posted yet" (no
  release, no assets) lets it post without that check; any other error reading the posted pointer
  stops the run. A posted pointer that does not verify (its key since removed from
  `pack-keys.json`, a bad signature, only one of the two files) is refused too, since its sequence
  cannot be trusted; an operator who has checked it dispatches the release with
  `replace_unverified_herdr_pointer=true` to post over it (#207, L1).
- `pack.json.sig` is ed25519 over the exact bytes of `pack.json`, detached and base64, as
  `scripts/lane.ts sign` makes `lane.json.sig`. It is made with a key of the pack's own, the
  `HERDR_PACK_KEY` Actions secret, never `PLUGIN_LANE_KEY` (t22n's recommendation, t259's ruling): a
  leak of one key does not reach the other part. The pointer's `keyId` is the `pack-keys.json` entry
  whose public key is the secret's, so any listed key signs under its own id. The release verifies
  what it signed before it posts it, and `herdr-lane.ts check-key` stops a release that would ship
  the pack before it tags when the secret is missing or its public key is not in `pack-keys.json`.
- The trusted public keys are `herdr/mods/am-sidebar/pack-keys.json`, which the pack tarball
  carries, so the installed copy is the trust anchor. `install.sh` embeds the same list
  (`TRUSTED_KEYS`; `herdr-lane.test.ts` keeps the two equal). Rotation is in two phases ("Making
  the key").
- The pack's updater (`release.js`, `update.mjs`, the sidebar's check through `updateCheck.js`)
  reads `releases/download/herdr-lane/pack.json` and its `.sig`, one request each, verifies the
  signature against the installed `pack-keys.json` (`node:crypto`), offers the pack only when its
  version is newer than the installed one (an older pointer, replayed, offers nothing), and checks
  the downloaded tarball against the sha256 the pointer names before anything is written. No
  pointer yet (404) means no pack released here: no update. A missing signature, a key the pack
  does not list, a signature that does not match, or a tarball whose hash differs is refused.
  Releases are never listed or searched.
- `herdr/install.sh` does the same: the pointer, its signature against its embedded keys (Node is
  checked before it reads them), then the tarball from `releases/download/v<v>/` against the
  pointer's sha256, before anything is written. It never downgrades: it refuses a pointer whose
  version is older than the installed one or whose sequence is lower than the one it recorded
  (the marker's `version=` and `sequence=`; update.mjs records the sequence on every install and
  update through the pointer, and a rollback restores the kept set's). Someone who can write
  release assets but has no key can re-post an older signed pointer; a re-run of the installer then
  stops and says how to downgrade on purpose. `--version <v>` installs a named release, older ones
  included, and checks it against that release's `.sha256` alone, and says so (integrity, not who
  published it); it records no sequence. The
  one-liner is `curl -fsSL https://raw.githubusercontent.com/automagik-dev/automagik/main/herdr/install.sh | bash`;
  `main` moves to every release, so it serves the released installer.
- Tests sign their fixtures with a key generated per run (`herdr/test/pointer.mjs`,
  `scripts/herdr-lane.test.ts`) and pass it only through the file:// test mode
  (`AUTOMAGIK_HERDR_PACK_KEYS`, honoured for a file:// release URL alone), never for a GitHub URL.
  No private key is committed.
- The mod manager's catalog is `https://raw.githubusercontent.com/automagik-dev/automagik/dev/herdr/catalog/index.json`.
  The old repository's two catalog URLs count as written by the pack: an install or update rewrites
  them to the new one, and until then the mod manager reads the new one. The index names the pack as
  `automagik-dev/automagik`, path `herdr`.

### Making the key

`HERDR_PACK_KEY` was created on 2026-11-03 as key id `herdr-pack-2026-11` (fa21806 committed its
public key). `scripts/lane.ts` has no key command (it
only reads `PLUGIN_LANE_KEY`), so how that key was made is not recorded here. This is the
documented process for the pack's key, with the same key type and format as the plugin lane's
(ed25519, PKCS#8 PEM in the secret, SPKI PEM in the keys file):

```sh
bun scripts/herdr-lane.ts keygen --key-id <id>   # --repo automagik-dev/automagik
```

It generates an ed25519 pair in memory and pipes the private key to `gh secret set` on its stdin:
it is never printed and never written to disk. Only when that succeeds does it add the public key
under its key id to `pack-keys.json` and to `install.sh`'s `TRUSTED_KEYS`; both are committed in a
pull request. It refuses a key id `pack-keys.json` already lists.

There are two secret slots, `HERDR_PACK_KEY` and `HERDR_PACK_KEY_NEXT`. The repository variable
`HERDR_PACK_SIGNER` names the one releases sign with (`HERDR_PACK_KEY` when unset). keygen never
writes that slot: the first key goes to `HERDR_PACK_KEY`, and any later key goes to the other slot.
A rotation is two phases:

1. Ship the new public key. `keygen --key-id herdr-pack-<yyyy-mm>` puts the new private key in the
   slot that is not signing and adds the public key to both files. Releases keep signing with the
   old key, so every pack released from then on carries both public keys, under a pointer installs
   already trust.
2. Switch the secret, later, once installs have taken a pack that lists the new key:
   `gh variable set HERDR_PACK_SIGNER --body <the new slot>`. The next release signs with the new
   key, and its `keyId` follows. An install still on a pack that lists only the old key refuses
   the new pointers, so wait long enough for installs to update. Retire the old public key from
   both files in a later release, and leave its slot for the next rotation.

Switched too early, nothing is installed wrongly: those installs stop updating until they reinstall
with `install.sh`. A release whose secret is missing or unlisted stops at `check-key`, before it
tags.

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
- Pocket: `ci.yml`'s `pocket` job (JDK 17, the Android SDK 35) runs automagik-pocket's
  `android.yml` gate from `apps/pocket/android` (`:app:assembleDebug :app:testDebugUnitTest
  :app:lintDebug`) and the terminal page's Playwright test. It runs when `apps/pocket/`, the root
  `package.json` (the version Gradle reads), the CI or release workflow, or `scripts/lane.ts` or
  `scripts/version.ts` changed. The `pocket-link` job (Linux and macOS, Node 22) runs the old
  `pocket-link.yml`, syntax and bridge tests, when `herdr/mods/pocket-link/` or `ci.yml` changed.
  automagik-pocket's workflows were not copied (`apps/pocket/.github/` was deleted at the import);
  its commitlint is the monorepo's.

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
  those of a branch of this repository merged with `--no-ff`. `scripts/import-pocket.sh` does the
  same for automagik-pocket in two filter-repo passes (all of it under `apps/pocket/`, then Pocket
  Link's folder and the files around it, including the old automagik-pocket-link history's root
  `mods/pocket-link/`, to `herdr/mods/pocket-link/`). It also refuses a keystore,
  `local.properties` or `signing.properties` anywhere in the history. The herdr import has ten commits whose
  bodies run past 100 characters; they stay as the source wrote them.

## Bridge and cutover (after this change)

1. The monorepo publishes the first release that carries the pack (the first merge after this
   change that ships something under `herdr/`), with `HERDR_PACK_KEY` set and the `herdr-lane`
   pointer signed.
2. automagik-herdr cuts one bridge release from v0.14.x. It ships this verifier and
   `pack-keys.json`: its `release.js`, `update.mjs` and `install.sh` read this repository's
   `herdr-lane` pointer and check it against the keys it carries, as here. An installed 0.x
   takes the bridge from automagik-herdr with the hash check alone (that release's `.sha256`), so
   the bridge release is the trust anchor for every 0.x install; from then on each update is the
   3.N.P the signed pointer names.
3. An installed copy is seen to update across the bridge; then automagik-herdr is archived with a
   README pointer here.

Until the bridge, installed packs keep updating from automagik-herdr.

## Pocket

Pocket is the Android app (`ai.namastex.automagik`) and Pocket Link, its desktop mod. The owner
decided (2026-11-03) that it ships only as a part of Automagik: no separate listing, no Pocket step
in the herdr.dev layout entry. `scripts/import-pocket.sh` imported automagik-pocket `dev` with its
history: the app and its docs under `apps/pocket/`, Pocket Link under `herdr/mods/pocket-link/` (its
README, recipe, keys, licence and preview beside the mod, as the pack's mods keep theirs).

### Lane

- `pocket` (`apps/pocket/**`). `scripts/lane.ts pocket <tag>` says whether a release rebuilds the
  app: a shipping `apps/pocket/` change since the build phones have, version-only bumps aside. That
  tag is `scripts/lane.ts pocket-since`: the version `pocket-lane`'s `latest.json` names, or the last
  release when there is no lane yet. It is not simply the last tag, because a prerelease never moves
  `pocket-lane`. A Pocket change that shipped only in a prerelease (or whose lane post failed) is
  therefore still ahead of the lane, and the next release builds it again, even when that release
  changes nothing under `apps/pocket/`. Never shipped in the part: its top-level `*.md`, `docs/`, unit tests (`test/`) and
  `android/scripts/` (the terminal page's test, the vendoring script).
- A release whose shipping changes since the last release are all under `apps/pocket/`, or under
  `apps/pocket/` and the herdr part (`herdr/`, `herdr-layout/`), is a `pocket` patch: 3.N.P, the APK (and the pack when `herdr/`
  shipped), no desktop build, no plugin tarballs, no new plugin lane, no market pin, not Latest.
  With plugins or the app in it, the release is a `plugins` patch or a `full` release that also
  builds the APK; Pocket never makes one.
- Pocket Link (`herdr/mods/pocket-link`) is under `herdr/`, so a change to it is on the herdr lane
  (the pack is rebuilt; it never carries Pocket Link). Its bridge tests are `ci.yml`'s `pocket-link`
  job. The pack's catalog (`herdr/scripts/catalog.mjs`) and its no-LaunchAgent test leave it out:
  it is Pocket's, never in `PACK_MODS`.

### Version and versionCode

- Gradle reads the root `package.json` version (the one version); `version.properties` and
  `scripts/version.sh` are gone.
- `versionCode = major*1_000_000 + minor*1_000 + patch` (3.57.0 is 3057000). A minor or patch of
  1000 would give two versions one code (3.1000.0 and 4.0.0), so minor and patch stop at 999:
  `bun scripts/version.ts set` and `next` refuse more, `scripts/lane.ts next-patch` refuses
  3.N.1000 (cut 3.(N+1).0 instead), and Gradle refuses to build one. The release workflow sets the
  version through `version.ts`, so it refuses it too. `bun scripts/version.ts code <v>` prints the
  code; the Pocket job checks the APK's versionCode against it.
- The jump: automagik-pocket's builds used minutes since 2025 (v0.21.0 was 966485, about 966 000 in
  November 2026), and any 3.N.P is at least 3 001 000, so installed phones accept it. The
  `-Ppocket.versionCode=` override stays for local self-update tests.

### Release

- Before the cut, when `pocket` is yes: the `cut` job checks that `POCKET_SIGNING_KEYSTORE` and
  `POCKET_SIGNING_PASSWORD` exist (it reads only whether they are set) and runs the unit tests and
  lint, so a failing app or a missing key stops the run before a tag.
- After it, the `Pocket` job builds the release APK from the tag, signed with the key from those
  secrets (decoded to the runner's temp folder and removed after the build). It checks the APK's
  versionName (the tag) and versionCode (the formula), then attaches `automagik-pocket-<v>.apk` and
  after it `latest.json` (`versionCode`, `versionName`, `url` on that `vX.Y.Z`, `sha256`, `notes`) to
  the release. The asset is no longer `automagik.apk`: a monorepo release is shared, and phones take
  the URL from `latest.json`, never from a name.
- Then, unless the run is a prerelease, a small `pocket-lane` job (`needs: [cut, pocket]`) takes the
  `latest.json` from `vX.Y.Z` and replaces the one on `pocket-lane`.
- `desktop-build.yml`'s sweep of a full release's assets spares `automagik-pocket-*.apk` and
  `latest.json`.

### Updater: the rolling `pocket-lane` release

Installed phones read `https://github.com/automagik-dev/automagik/releases/download/pocket-lane/latest.json`
and nothing else; the APK stays on its own `vX.Y.Z` release. `-Ppocket.updateUrl=` (or
`pocket.updateUrl` in `gradle.properties`) still points a fork or a local test server at its own.

Why not the old URL, and why not the releases API (t16r's ruling, 2026-11-03, after measuring this
repository that day):
- `releases/latest/download/latest.json` (automagik-pocket's) cannot work here: a pocket patch is not
  Latest, and the Latest release is usually a desktop build without Pocket.
- "The newest release carrying `latest.json`, via the releases API" was the plan. This repository
  cut 91 releases in 10 days (about 9 a day), and the API returns about 33 KB of JSON per release
  (100 releases come to 3 MB). Every 6-hour check would download 0.3 to 3 MB over mobile data,
  growing as Pocket releases get rarer than desktop ones. A window of pages would lose a Pocket
  release older than about 11 days. And the unauthenticated API allows 60 calls an hour per IP,
  which carrier NAT shares across many phones; a 403 means no updates.
- A rolling release, as #190 settled for herdr (`herdr-lane`): one small file, no API, no rate limit,
  no window.

The rolling release is never taken for a release:
- Its tag is not `v*`. `apps/desktop/src/update.js` takes only `v`-prefixed tags with its platform's
  feed. `release.yml`'s last-release and last-full-release lookups read `git tag --list 'v3.*'`
  filtered by `^v3\.N\.P$`. `scripts/version.ts` and `scripts/lane.ts` read only v3.N.P tags. Follow
  Omni reads Omni's releases by `^v<semver>$`. None can take `pocket-lane`, `herdr-lane` or
  `plugin-lane`. `scripts/pocket-lane.test.ts` and `apps/desktop/test/update.test.js` check each.
- It is created once with `--prerelease --latest=false` and never edited (no `gh release edit`):
  later runs only `gh release upload --clobber` its `latest.json`. So it is never Latest and never
  flips prerelease. The same test checks that only the Pocket job writes it, only `latest.json`, never
  in a prerelease run, and never to a lower versionCode.

Trust: `latest.json` is not signed (`herdr-lane` signs its `pack.json` with ed25519). That is
acceptable because the pointer cannot make a phone install anything the release key did not sign:
- Android installs an update only when the APK is signed by the installed app's key (the same-signer
  rule). The key is only in this repository's secrets.
- The app downloads only an `https://` URL, checks the APK's SHA-256 against `latest.json` before it
  hands it to the installer (`Release.matches`), and offers only a versionCode above the installed
  one (`UpdatePolicy.isNewer`). `ReleaseTest` covers both.
- So a forged or stale `latest.json` (someone with write access to the releases, or a bad run) can
  point at nothing installable or at an older build: at worst it denies updates until the next good
  release replaces it. The herdr pack runs code from a tarball with no such check, which is why its
  pointer is signed.

Races: `herdr-lane` is posted by the `cut` job, and `pocket-lane` by the `pocket-lane` job, which runs
after the cut and the Pocket build. They are separate releases holding separate files. On `vX.Y.Z`,
the Pocket job adds only its own two assets, so the two never write the same asset. The Pocket build
is in no concurrency group, so every release that rebuilt Pocket gets its APK and `latest.json`.
Only the `pocket-lane` job takes turns, in the `pocket-lane` group, so two runs never interleave on
the pointer. GitHub keeps at most one job waiting in a group and drops an older waiting one when a
newer one arrives, even with `cancel-in-progress: false`. The newer one is always a later
non-prerelease release whose APK built (a prerelease or a failed build never enters the group), so
the pointer still ends on the newest build. The job also never moves it to a lower versionCode, so
an older run that finishes last leaves it alone.

### Signing secrets

`POCKET_SIGNING_KEYSTORE` (the keystore, base64) and `POCKET_SIGNING_PASSWORD`: the same release key
automagik-pocket used, so installed phones accept the monorepo's builds. The owner adds them to this
repository's secrets. They are never printed, and the key is never regenerated (every installed copy
would have to uninstall). The import's own merge ships `apps/pocket/`, so it does not merge before
the secrets exist: that release would stop at the secrets check.

### Bridge and cutover

1. The monorepo publishes the first release that carries Pocket (the import's merge), which creates
   `pocket-lane`.
2. automagik-pocket cuts one bridge release: same key, same app ID, its default `pocket.updateUrl` set
   to `pocket-lane`'s `latest.json`. Its versionCode is still minutes since 2025, below every 3.N.P,
   so a phone takes the bridge from automagik-pocket, then the monorepo's builds.
3. An installed phone is seen to update across the bridge; then automagik-pocket is archived, never
   deleted, with a README pointer here. Its releases stay: phones that have not taken the bridge yet
   download it from there.

Until the bridge, installed phones keep updating from automagik-pocket.

### Names and the Parts manifest (RFC 0012)

No `part.json` comes with this import. The names it adds are the lane kind `pocket`, the release
`pocket-lane` and the asset `automagik-pocket-<v>.apk`; none is a part id, a capability, a
`parts.json` field or an `am` verb, so `apps/pocket/part.json` can take its own id and name this
artifact later.

## Usagemeter

**Status: proposed (2026-11-04). Nothing is built or merged.** This section is the agreed import
plan made exact; deliveries 2 to 4 below make the code changes, and until they ship, today's code
differs where noted. Four questions are open for the owner ("Open questions (usagemeter)" below).

usagemeter is the token meter: a small Rust program (Cargo crate `usagemeter`, binary
`usagemeter`, library `meter`) that each machine runs from `~/.local/bin/usagemeter`
(`herdr/mods/am-sidebar/meter.js:42`). Its CLI noun stays `am meter` (RFC 0012). It comes from
`automagik-dev/usagemeter`, whose `dev` is `fd0ba4c`, v0.3.0, with two open pull requests: #6
(ledger tagging) and #7 (the state folder `~/.automagik/meter`). It goes to `apps/usagemeter/`,
which RFC 0012 calls the meter part.

The import follows "Importing a repository with its history": `scripts/import-usagemeter.sh`,
copied from `import-pocket.sh`, clones usagemeter's `dev` into a temporary folder, runs
`git filter-repo --to-subdirectory-filter apps/usagemeter` there and merges with `--no-ff
--allow-unrelated-histories`, without tags. It drops `.github/` (CI moves to the root) and
`.herdr/`, keeps usagemeter's LICENSE inside the part only if it differs from the root's, and
refuses a database, a key or an `.env` anywhere in the history (none is in its 34 historical
paths). The import pull request lands as a merge commit, never squashed or rebased (as #190 and
#203 did), so the imported commits keep their history; commitlint already skips an import
merge's second-parent history. #6 and #7 merge upstream first (each cuts an upstream 0.N.0); the
final import is then pinned to upstream `dev`'s last commit, as #190's second, pinned run was, and
upstream is frozen after it. Whether the import takes all 25 commits is Q1.

Deliveries, one pull request each, each with an independent review and the owner's OK:

1. Docs: this section (a draft pull request).
2. Import and CI, which ships nothing: the import merge, with `apps/usagemeter/**` in
   `scripts/lane.ts`'s `NEVER_SHIPPED` for now; a path-gated Rust job in `ci.yml`; `version.ts`
   writing the crate's version; `AGENTS.md` naming cargo as the one exception to "Bun for the
   repository's tooling". The pull request's root edits (`.github/`, `scripts/`, `AGENTS.md`) are
   never shipped either, so its merge cuts no tag, as #203's did not.
3. The release lane: the `usagemeter` kind, the assets on `vX.Y.Z`, the rolling `usagemeter-lane`
   release and the installer's new base URL.
4. The cutover: the herdr pack's pin, the bridge release, the archive.

### Lane

- `usagemeter` (`apps/usagemeter/**`), named after its folder and its binary, as `herdr` and
  `pocket` are. A release whose shipping changes since the last release are all under
  `apps/usagemeter/` is a `usagemeter` patch: 3.N.P, the meter's assets, no desktop build, no
  plugin tarballs, no new plugin lane, no market pin, not Latest.
- Today `apps/usagemeter/` matches no plugin, so `kindOf` (`scripts/lane.ts:180-195`) would return
  `full`, a desktop build and 3.(N+1).0. That is why delivery 2 lists the folder in
  `NEVER_SHIPPED` (`scripts/lane.ts:77-79`). Delivery 3 takes it out and adds a `USAGEMETER` regex
  beside `HERDR` and `POCKET` (`scripts/lane.ts:84`, `:86`), a `kindOf` branch, and the `usagemeter`
  kind to every `release.yml` condition that today reads `!= 'herdr' && != 'pocket'` (`:261`,
  `:318`, `:406`, `:564`, `:602`), with `release-workflows` tests.
- Delivery 3 also settles what this plan does not: the tag the kind is measured from (Pocket's
  reason for `pocket-since`, a prerelease that never moves the rolling release, applies the same
  way), whether usagemeter and the herdr part together make one patch, as Pocket and herdr do, and
  which of the part's files never ship.

### Version

- One version. The part jumps from usagemeter's 0.3.0 to the monorepo's 3.N.P on its first
  release here. No old tags are imported (`v0.1.0` to `v0.3.0` are not releases of this one).
- Cargo keeps the version in `Cargo.toml`'s `[package]` and repeats it in `Cargo.lock`; the binary
  prints `CARGO_PKG_VERSION`. `scripts/version.ts` writes only JSON fields and plain-text files
  today (`FIELDS`, `scripts/version.ts:41-62`), so delivery 2 teaches it the crate's two places,
  and the import sets them to the current 3.N.P, so `dev` never holds a 0.3.0 crate. A test, and
  CI's `cargo metadata --locked`, check that they agree. The release's version guard reads only
  `version.ts`'s fields, so this does not repeat #190's failed release.
- The jump is safe for installs. usagemeter's `install.sh` never downgrades and compares versions
  field by field (`automagik-dev/usagemeter` `fd0ba4c`, `install.sh:59-79`); any X.Y.Z above
  0.3.0 passes, and its "want 0.N.P" messages (`:34`, `:36`) are cosmetic. The herdr installer's
  "not older" check (`herdr/install.sh:451`) compares the same way.
- #7's README says "Before 0.4.0 …", a 0.4.0 the jump never produces; delivery 3 rewords it when
  the version scheme changes.

### Release

- CI (delivery 2): a Rust job in `ci.yml`, gated on `apps/usagemeter/` like the other parts' jobs:
  `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --locked` on Ubuntu and macOS,
  shellcheck, and the installer's test. Its actions are pinned by SHA, as every action here is
  (usagemeter's own workflows use `@v4`).
- On a release that rebuilt the meter (delivery 3), it builds the four targets from the tag and
  attaches them to `vX.Y.Z`: `usagemeter-darwin-arm64`, `usagemeter-darwin-x86_64`,
  `usagemeter-linux-x86_64`, `usagemeter-linux-aarch64` (the Linux builds musl, checked static),
  with `usagemeter.SHA256SUMS` and `usagemeter-install.sh`.
- The binaries keep their names: the herdr pack's pins and `herdr/scripts/usagemeter-pin.mjs`
  (`:25-26`, `usagemeter-[a-z0-9_-]+`) name them. The other two are renamed. usagemeter's release
  writes `SHA256SUMS` and attaches `install.sh` (its `release.yml:124`, `:145`), but a full
  release's desktop build writes its own `SHA256SUMS` to the same release
  (`.github/workflows/desktop-build.yml:374`), and its sweep deletes any asset it does not list
  (`:390`). The sweep is taught to keep the meter's six assets, as it keeps Pocket's.
- Then, unless the run is a prerelease, a `usagemeter-lane` job replaces the rolling release's
  assets (below).

### Updater: the rolling `usagemeter-lane` release

usagemeter has no updater of its own. Three things install it, and installed copies move only when
one of them moves:

- The herdr pack's `install.sh` (`herdr/install.sh:73-75`, `:396-399`, `:457-463`, `:475-484`) and
  its fleet install, `am meter install` (`herdr/mods/am-sidebar/meterFleet.js:18-20`), install the
  version `release.js` pins (`USAGEMETER`, `herdr/mods/am-sidebar/release.js:57-70`): one version,
  four assets and four sha256 values. They check the download against the release's checksums,
  then against the pin. A pack install moves the meter only when the pack's pin moves.
- usagemeter's own `install.sh`, the one-liner, reads `releases/latest/download` when no version is
  given (`fd0ba4c`, `install.sh:89-93`). That cannot work here: a usagemeter patch is never Latest,
  and the Latest release is usually a desktop build without the meter (Pocket's reason).

So delivery 3 adds a rolling `usagemeter-lane` release, made like `pocket-lane`: created once with
`--prerelease --latest=false`, never edited, never Latest, written only with
`gh release upload --clobber`, its tag not `v*` so no updater or tag lookup takes it for a
release. It holds `usagemeter.json` (`version`, `tag`, the sha256 of each asset) and, unlike
`pocket-lane`, which holds only its pointer, the newest assets themselves. `usagemeter-install.sh`
reads its base URL from this repository's releases: with no version it reads `usagemeter-lane`;
with one it downloads from `v3.N.P`. It still never downgrades.

Trust (RFC 0012's question 5, Q3 below): the herdr pack is signed through `herdr-lane`, and it
pins the meter's four sha256 values, so a pack install proves who published the meter, not only
that the download is whole. The standalone `usagemeter-install.sh` checks only
`usagemeter.SHA256SUMS` or `usagemeter.json`, from the same place as the binary: integrity, not
who published it, as today. The proposal adds no key now; later, the meter becomes its own
`binary` part with its own lane key (RFC 0012, delivery 8).

### Targets

The four built today: macOS arm64, macOS x86_64, Linux x86_64 and aarch64. D28 dropped Intel Mac
for the app, and `usagemeter-darwin-x86_64` is kept only through the bridge, for installs that
already have it (Q2). No Windows build: the 2026-11-04 direction runs Windows inside a Linux
sandbox, where `usagemeter-linux-x86_64` already works.

### Bridge and cutover

1. #6 and #7 merge upstream, and the final import is pinned to upstream `dev`'s last commit
   (above). Until the cutover, the pack keeps pinning upstream's release; whether it moves once,
   to #7's release, before the import is Q4.
2. The monorepo publishes the first release that carries the meter's assets (delivery 3), which
   creates `usagemeter-lane`.
3. The herdr pack's pin moves to that tag, in the same step as the renamed assets
   (`usagemeter.SHA256SUMS`, `usagemeter-install.sh`), so the bridge is cut once: `release.js`'s
   `USAGEMETER`, `herdr/install.sh` (`METER_VERSION`, `METER_RELEASES`, the pins, the asset URL,
   the checksums file), `meterFleet.js`, `usagemeter-pin.mjs`, and the tests that hold the old
   version (`herdr/test/install.test.mjs:1066-1074`). That is the pack's code (t22n). The nine doc
   links to the old repository are repointed: `herdr/README.md:82`,
   `herdr/mods/pocket-link/README.md:89`, `apps/pocket/AGENTS.md:13`, and six under
   `apps/pocket/docs/`.
4. automagik-dev/usagemeter cuts one bridge release whose `install.sh` and README point at this
   repository.
5. An install is seen updating from the monorepo; then automagik-dev/usagemeter is archived, never
   deleted, with a README pointer here. Its releases stay: a pack that still pins v0.3.0 downloads
   it from there.
6. The bridge ends there, and `usagemeter-darwin-x86_64` with it: later releases build three
   targets and the pack's pins drop it. Intel Macs keep the binary they have.

Until the cutover, installed packs keep installing the meter from automagik-dev/usagemeter.

### Names and the Parts manifest (RFC 0012)

No `part.json` comes with this import. The names it adds are the folder `apps/usagemeter/`, the
lane kind `usagemeter`, the release `usagemeter-lane`, its `usagemeter.json`, and the assets
`usagemeter-<os>-<arch>`, `usagemeter.SHA256SUMS` and `usagemeter-install.sh`. The installed path
`~/.local/bin/usagemeter` and the noun `am meter` are unchanged. None is a part id, a capability,
a `parts.json` field or a new `am` verb, so `apps/usagemeter/part.json` (kind `binary`) can take
its own id later (RFC 0012, delivery 8, t22b).

### Open questions (usagemeter)

For the owner (Felipe), through t2x5. Each has the plan's recommendation; none is decided here.

1. **Q1. Import all 25 commits?** usagemeter's first 9 commits (`d56295e`..`aea4fe7`) were split
   from automagik-pocket's `meter/`, and they are already here as `apps/pocket/meter/`, with other
   ids, deleted since by `5e990c27`. A full import repeats them under `apps/usagemeter/`.
   Recommended: yes. "With its history" means usagemeter's whole log; the ids stay deterministic for
   the pinned re-run; and the copies live under a different path. Cutting at `aea4fe7` instead
   rewrites parents and loses blame for the first files.
2. **Q2. Keep the Intel Mac meter binary?** D28 dropped Intel Mac. The `darwin-x86_64` meter
   binary is kept only through the bridge, for existing installs, and ends with the bridge. It
   costs one CI job. Recommended: yes, on those terms.
3. **Q3. Trust, slice 1: the signed herdr pack keeps pinning the meter's hashes, no new key?** This
   is RFC 0012's question 5 for its first step. Recommended: yes; the meter gets its own lane key
   later, as a `binary` part (RFC 0012, delivery 8).
4. **Q4. Raise the herdr pin once, to #7's release, before the import?** #6 and #7 each cut an
   upstream release (0.4.0, then 0.5.0 with the state folder). Recommended: yes. Once #7's
   release is out, t22n raises the pack's pin once to it, so the fix for the collision with
   Electron's userData folder and the statusline repoint do not wait for the import; the cutover
   then moves the pin a second time, to the first monorepo tag.

## Open questions

1. `herdr/catalog/repos.json` lists Pocket Link as an external entry at `automagik-dev/automagik-pocket`,
   and am-mods' read-only row, its refusal message (`herdr/mods/am-mods/core.js`) and am-footer's
   comments name that repository. They still work after the archive (the repository stays, with a
   pointer here). Repointing them to `herdr/mods/pocket-link` needs an external entry with a path,
   a change to the pack's catalog and manager, so it is left to the pack. (t22n)
2. The Play build (automagik-pocket PR #31) is the Play session's call; if it moves, it moves into
   `apps/pocket/`. (t16r)
3. Usagemeter's import: Q1 to Q4 under "Usagemeter", "Open questions (usagemeter)". (the owner)

Resolved (t259's review, t22n's rulings, 2026-11-03):
- Commitlint skips only what an import merge's second parent brought, and keeps working across the
  final re-run's second import merge.
- The 100-release window: replaced by the signed rolling `herdr-lane` pointer in this change; no
  releases search, no paging. Its key is `HERDR_PACK_KEY`, the pack's own, never `PLUGIN_LANE_KEY`.
- The bridge release ships the verifier and `pack-keys.json`; its own hash-checked update is the
  trust anchor for 0.x installs.
- `HERDR_PACK_KEY` exists (2026-11-03): key id `herdr-pack-2026-11`; its public key is in
  `pack-keys.json` and `install.sh` (fa21806).
- No downgrade (t259's re-review, H1): install.sh refuses a pointer older than what is installed,
  by version or by recorded sequence, and the release refuses to post a lower sequence.
- Key rotation in two phases, the keyId taken from the secret's public key (t259's re-review, M3).
- The Node floors: users' runtime Node 22.7 or later (the launcher, `install.sh`); tests on the
  newest Node 22 (22.15+, for `module.registerHooks`) and 24; no stub fallback.
