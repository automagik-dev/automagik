---
title: "Releasing"
type: guide
created: 2026-11-01
updated: 2026-11-03
tags: [guide, release, ci, maintainers]
---
# Releasing

**Merge a pull request with a shipping change under `apps/pocket/` into `dev`. CI does the rest.**
Pocket ships as a part of the Automagik monorepo: one version and one tag, `vX.Y.Z`, for everything.
The design, the `latest.json` move and the versionCode rule are in the monorepo's
[RFC 0011](../../../../docs/rfcs/0011-monorepo-parts-and-releases.md) ("Pocket"); the `latest.json`
fields are still [RFC 0002](../rfcs/0002-release-and-update-channel.md)'s.

## 1. What cuts a release

Every merge into `dev` with a shipping commit (not only `docs`, `ci`, `test` or `chore(release)`)
cuts a release (`.github/workflows/release.yml`). `scripts/lane.ts` decides what it carries:

| Shipping changes since the last release | Kind | Version | Pocket |
|---|---|---|---|
| only under `apps/pocket/` (or `apps/pocket/` and the herdr part, `herdr/` and `herdr-layout/`) | `pocket` | `3.N.P`, the next patch | the APK and `latest.json` |
| plugins too | `plugins` | `3.N.P` | the APK and `latest.json` when `apps/pocket/` shipped |
| the desktop app or anything else | `full` | `3.(N+1).0` | the APK and `latest.json` when `apps/pocket/` shipped |

Changes under `apps/pocket/` that no APK carries (its `*.md`, `docs/`, unit tests,
`android/scripts/`) ship nothing. A release with no Pocket change carries no APK: phones stay on
the build they have.

## 2. What CI does

1. **Cut** (job "Cut v<version> on dev"), before tagging: checks that the
   `POCKET_SIGNING_KEYSTORE` and `POCKET_SIGNING_PASSWORD` secrets exist (no key, no release),
   runs the unit tests and lint from `apps/pocket/android/`, then sets the version with
   `bun scripts/version.ts set` (it refuses a minor or patch over 999), commits
   `chore(release): vX.Y.Z`, tags and publishes the release (not Latest, for a patch).
2. **Pocket** (job "Pocket"), from the tag:
   1. Builds the release APK, signed with the release key from the secrets.
   2. Checks that its `versionName` is the tag and its `versionCode` is
      `major*1_000_000 + minor*1_000 + patch`.
   3. Attaches `automagik-pocket-<version>.apk`, then `latest.json` (`versionCode`, `versionName`,
      `url` on this release, `sha256`, `notes`), to `vX.Y.Z`.
   4. Unless the run is a prerelease, replaces `latest.json` on the rolling `pocket-lane` release,
      never with a lower `versionCode`. Installed phones read only that file.

Installed copies find the new `latest.json` at their next check (on launch, then every 6 hours).

The usage meter is released from its own repository,
[automagik-dev/usagemeter](https://github.com/automagik-dev/usagemeter).

## 3. Check a release

1. `gh release view pocket-lane -R automagik-dev/automagik` and
   `gh release download pocket-lane -R automagik-dev/automagik -p latest.json -O -` show the build
   phones are offered; `gh release view vX.Y.Z -R automagik-dev/automagik` shows its APK.
2. Download the APK and check its signer against the fingerprint in
   [SECURITY.md](../../SECURITY.md):

   ```sh
   apksigner verify --print-certs automagik-pocket-<version>.apk
   ```

3. On a phone with the previous release: open the app, or **Settings → About → Check for updates**.

Releases up to v0.23.0, and the bridge release, are on the archived
[automagik-dev/automagik-pocket](https://github.com/automagik-dev/automagik-pocket/releases).

## 4. Don'ts

- Don't edit a version by hand: `bun scripts/version.ts` owns it.
- Don't push to `dev` directly; merge a pull request.
- Don't rotate or regenerate the signing key. Every installed copy would have to uninstall.
- Don't change `latest.json`'s fields, or where phones read it (`pocket-lane`), without an RFC:
  installed copies and forks depend on them.
- Don't create or edit the `pocket-lane` release by hand, or mark it Latest.

## 5. Forks

A fork publishes with its own key and builds with `-Ppocket.updateUrl=<its latest.json URL>` (or
sets `pocket.updateUrl` in `apps/pocket/android/gradle.properties`). Its installs can't take updates
from this repo, and the other way round.
