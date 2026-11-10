---
title: "One shared debug signing key for Pocket PR builds"
type: decision
status: Proposed
created: 2026-11-10
updated: 2026-11-10
pr: ""
tags: [decisions, build, signing, ci]
---
# One shared debug signing key for Pocket PR builds

Without the release key, as in CI and the gate, two debug APKs built in different worktrees carry
different certificates today: each worktree gets its own debug keystore. One phone can then install
neither over the other. Pull-request builds should share one debug certificate, held in a repository
secret and never in git.

## Decision

Proposed, awaiting the Orchestrator's check. No secret is set and no build file changes in this
note's pull request.

- **CI signs debug APKs with one debug key from a repository secret.**
  `POCKET_DEBUG_SIGNING_KEYSTORE` holds the base64 keystore, alias `androiddebugkey`, store and key
  password `android` (the standard, public debug credentials). The owner creates a new debug-only
  key (never the release key) once and sets the secret; it is never committed or printed.
- **The pocket CI job materializes the key for the build and removes it after.** The job decodes the
  secret into the runner's temporary folder, exports `POCKET_DEBUG_STORE` (and the password),
  builds the debug APK, prints `apksigner verify --print-certs`, uploads the APK as a workflow
  artifact named for the pull request (or the run on a push), and deletes the keystore on exit. The
  certificate fingerprint in the log and the artifact let two PRs be compared.
- **The build reads a fixed debug-keystore path, with today's fallback.** `signingConfigs.debug`
  takes `POCKET_DEBUG_STORE` (or `-Ppocket.debugStore`), with the password from
  `POCKET_DEBUG_SIGNING_PASSWORD`, defaulting to `android`; when set it signs with that keystore and
  alias `androiddebugkey`. When unset, AGP's default debug keystore is used exactly as today.
- **The release key keeps priority and stays untouched.** A debug build still uses the release key
  when it is present, as it does today, so Android Studio builds and published releases update each
  other. `signingConfigs.pocket`, the release build type, the app ID, versionCode and latest.json do
  not change.
- **Local gates keep the default unless a developer opts in.** A gate without the secret uses its
  worktree's own AGP debug keystore. A developer who wants a local APK to install over a PR APK
  exports `POCKET_DEBUG_STORE` to a local copy of the CI key; the development guide will document
  the variable, not the key.

## Current state

- Each gate sets its own Android user home and `user.home`, so AGP creates a per-worktree debug
  keystore. The build only pins the location for a read-only home, to a folder under Gradle's user
  home (`apps/pocket/android/app/build.gradle.kts:98-114`).
- Debug builds use the release key when it is configured, else the AGP debug keystore
  (`apps/pocket/android/app/build.gradle.kts:61-68`).
- CI builds, tests and lints the app but publishes no APK (`.github/workflows/ci.yml` `pocket` job).
- Fork pull requests cannot read repository secrets, so they keep the fallback.

## Why not commit the debug keystore

A debug keystore still holds a private key, and this repository never commits one. The standard
debug credentials make it low risk, but they do not make it a public file: the owner's route is a
repository secret, and this note stops for that check before any build file changes.

## What changes after approval

1. `apps/pocket/android/app/build.gradle.kts`: `signingConfigs.debug` reads the variable; the
   read-only-home fallback at the end of the file yields to an explicit store.
2. `.github/workflows/ci.yml`'s `pocket` job: materialize the secret, export it to the Gradle step,
   print the certificate, upload `app-debug.apk`.
3. `apps/pocket/docs/guides/development.md`: the variable, the fallback, and how to compare a local
   APK with a PR artifact.

No other workflow changes. `release.yml` and the release signing config are out of scope.

## Verification

After the owner sets the secret:

1. Open or re-run two pull requests that build Pocket (for example the deck and chat PRs).
2. Download each run's debug APK artifact.
3. Compare the `apksigner verify --print-certs` SHA-256 digests: they must be equal.
4. `adb install -r` the first, then the second: the second replaces the first. The same versionCode
   is fine for `-r` when the certificate matches.
5. Record the certificate's SHA-256 digest in the implementation PR body.

## Risks

- A build without the secret (a fork, or the secret removed) still runs and publishes, but its APK
  may not install over another PR's. The certificate step makes the mismatch visible.
- Rotating the debug key is a one-time uninstall for debug installs; release signing is unaffected.

## Open questions

1. Does the Orchestrator approve a repository secret for the debug key, rather than a committed
   keystore? (Orchestrator)
2. Keep the standard `android` password (one secret), or use a second password secret? (Owner)
3. Upload the APK as a workflow artifact only, or also comment its link on the pull request (needs
   `pull-requests: write`)? (Orchestrator)
4. How long should the debug APK artifact be retained? (Orchestrator)
5. Does a debug-only key cross the "never change the signing key" rule, and so need an RFC, even
   though the release key and its config stay untouched? (Orchestrator)
6. Should the host gate wrapper export `POCKET_DEBUG_STORE` to a provisioned copy of the key, so
   local gates match CI, or keep local gates on their own default? (Orchestrator)

## Related

- [Development](../guides/development.md): today's build, debug and release-key behavior.
- [Releasing](../guides/releasing.md): how the release key signs published APKs.
