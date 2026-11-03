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
before, and each part's updater finds the newest release that carries its own asset (the desktop
app by its feed, the plugins and the herdr pack through a signed rolling pointer). A desktop-only
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
| Herdr pack | `herdr/` | `automagik-herdr-pack-<v>.tgz` and `automagik-herdr-pack-<v>.tgz.sha256`; the `herdr-lane` pointer is re-signed | the rolling `herdr-lane` release (`scripts/herdr-lane.ts`), checked against the pack's `pack-keys.json` |
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
- On its first monorepo release the pack jumps from automagik-herdr's v0.8.x (v0.8.0 or later, the
  source at the final import) to the monorepo's 3.N.P. Semver only goes up, so every updater accepts
  it.

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
  verifies (a re-run of an older release's run). A posted pointer that does not verify is replaced.
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

## Bridge and cutover (after this change)

1. The monorepo publishes the first release that carries the pack (the first merge after this
   change that ships something under `herdr/`), with `HERDR_PACK_KEY` set and the `herdr-lane`
   pointer signed.
2. automagik-herdr cuts one bridge release from v0.8.x. It ships this verifier and
   `pack-keys.json`: its `release.js`, `update.mjs` and `install.sh` read this repository's
   `herdr-lane` pointer and check it against the keys it carries, as here. An installed v0.8.x
   takes the bridge from automagik-herdr with the hash check alone (that release's `.sha256`), so
   the bridge release is the trust anchor for every 0.x install; from then on each update is the
   3.N.P the signed pointer names.
3. An installed copy is seen to update across the bridge; then automagik-herdr is archived with a
   README pointer here.

Until the bridge, installed packs keep updating from automagik-herdr.

## Open questions

1. `herdr/catalog/repos.json` lists Pocket Link as an external entry at `automagik-dev/automagik-pocket`;
   Pocket's import moves it. (t16r)

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
