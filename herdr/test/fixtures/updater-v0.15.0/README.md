# The bridge release's updater (automagik-herdr v0.15.0, commit 91fdad93)

The oldest pack updater still installed: `mods/am-sidebar/update.mjs` of automagik-dev/automagik-herdr's
bridge release v0.15.0, with the files it imports, byte for byte. Its tag lives in that repository, not
this one, so `test/pack.test.mjs` runs it from here: every tarball `scripts/pack.mjs` builds must pass its
own `unsafeEntries`, `stagePack` and `applyUpdate`, since the herdr-lane pointer sends an install the
newest tarball whatever release it runs. Never edit these files; where the tag is present the test
checks them against it.
