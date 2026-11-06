// am-quota's writes: the shell that installs a Codex credential, as text.
//
// Pure, like `translate.js`, so `node --test` can read every line of it. The rules live here and
// are asserted by `test/am-quota-write.test.mjs`:
//   1. the secret is only ever read from a file, never interpolated into a command line;
//   2. the final file is 0600 before it becomes visible and arrives by atomic rename;
//   3. a failed backup aborts the write instead of overwriting unbacked-up.
// Nothing here writes, reads or deletes a Keychain item: a Claude login is never installed from
// the proxy (#453, docs/local-logins.md).
//
// `$1`/`$2` are always positional: nothing here is spliced by string concatenation, so a home
// directory with spaces or `$` cannot change what runs.

import { toCodex } from "./translate.js";

/**
 * What goes into the payload file: Codex's `auth.json`, pretty-printed, the shape the client
 * itself writes. Any other provider has no payload.
 */
export const payload = (provider, credential) => {
  if (provider !== "codex") throw new Error("no writer for that provider");
  return `${JSON.stringify(toCodex(credential), null, 2)}\n`;
};

/** Where the per-switch payload file lives. 0700 folder, 0600 file for as long as it exists. */
export const payloadDir = (appHome) => `${appHome}/data/am-quota`;

/** `payloadPath` names one payload; the provider and a timestamp keep runs apart. */
export const payloadPath = (appHome, provider, stamp) => `${payloadDir(appHome)}/${provider}-${stamp}.json`;

/**
 * Makes the payload folder private *before* a payload exists. The file itself cannot be pre-made:
 * `writeTextFile(path, text, null)` means "create", and rejects when the file is already there, so
 * the mod creates it. The folder's 0700 is what keeps the file unreadable to anyone else, whatever
 * mode the writer gives it; the mod then narrows the file to 0600 as well.
 */
export function prepareScript() {
  return `set -eu
mkdir -p "$1"
chmod 700 "$1"`;
}

/** Empties a directory of payloads and item backups older than an hour (an interrupted switch
 *  leaves one behind; `claude-*.json` and `keychain-*.hex` only from an older version's Claude
 *  switch, swept all the same). Only those names: the panel's records (`active.json`, and the `saved.json`
 *  an older version kept) live in the same folder and must outlive the hour. */
export function sweepScript() {
  return `set -eu
find "$1" -maxdepth 1 -type f \\( -name "claude-*.json" -o -name "codex-*.json" -o -name "keychain-*.hex" \\) -mmin +60 -delete 2>/dev/null || true`;
}

/**
 * Installs the payload file as the client's credential: back up (and tighten) what is there,
 * copy to a sibling temp file, 0600, atomic `mv`, then remove the payload. `set -eu` means a
 * failed backup aborts; the temp file is removed on any exit path.
 */
export function installScript(stamp) {
  return `set -eu
trap 'rm -f "$2.tmp-${stamp}"' EXIT
mkdir -p "$(dirname "$2")"
if [ -e "$2" ]; then
  cp -p "$2" "$2.bak-${stamp}"
  chmod 600 "$2.bak-${stamp}"
fi
cp "$1" "$2.tmp-${stamp}"
chmod 600 "$2.tmp-${stamp}"
mv "$2.tmp-${stamp}" "$2"
rm -f "$1"
# Keep three backups, not one per click. Only files with this script's own stamp shape count,
# so a hand-made "<file>.bak-mine" is never touched; the stamps sort, so the earliest go first.
# Rotation is cosmetic: a failure here must not turn a successful install into an error.
count=0
for old in "$2".bak-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*; do [ -e "$old" ] && count=$((count + 1)); done
i=0
for old in "$2".bak-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*; do
  [ -e "$old" ] || continue
  i=$((i + 1))
  [ "$i" -le $((count - 3)) ] && rm -f "$old" 2>/dev/null || true
done
true`;
}
