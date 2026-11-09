// usagemeter on every linked machine: the pack is the one usagemeter installer for the fleet.
// Each machine's own `usagemeter sync` writes that machine's `herdr-meter` doc to its own
// herdr-core, and the phone reads each doc there (`doc.get {name: "herdr-meter", on: <machine>}`),
// so the binary has to be installed, and run, on every machine, not just this computer.
//
// - Install: the signed meter-lane pointer is read and checked once, on the computer running the
//   command (meterLane.mjs); `uname -sm` on each machine picks its target, and the pointer names
//   that build's asset and sha256. The machine itself downloads the asset from the release the
//   pointer names, checks it against that sha256, and renames a temp file beside
//   ~/.local/bin/usagemeter into place. One that already reports the pointer's version stays, a
//   newer one (or a dev build not older by its X.Y.Z) is never downgraded, and a link, a folder or
//   a binary that reports no version is left as it is.
// - Sync: the sidebar's (meter.js SYNC) on each connected machine, one at a time.
// - Uninstall: only a binary that still reports the version the pack recorded for that machine.
// Fixed scripts only, arguments as argv (never spliced into the script). Pure: the runner (`hc
// exec` for the CLI, Herdr's exec for the sidebar) is passed in, so `node --test` runs it.
// Apache-2.0.

/** `uname -sm` → the pointer's target (the aliases Pocket Link knew too); the Intel Mac build stays for good. */
const PLATFORMS = Object.freeze({
  "Darwin arm64": "darwin-arm64", "Darwin aarch64": "darwin-arm64", "Darwin x86_64": "darwin-x86_64",
  "Linux x86_64": "linux-x86_64", "Linux amd64": "linux-x86_64", "Linux aarch64": "linux-aarch64", "Linux arm64": "linux-aarch64",
});
/** The target for a machine's `uname -sm`, or null when no build is made for it. */
export const targetFor = (uname) => PLATFORMS[String(uname ?? "").trim().replace(/\s+/g, " ")] ?? null;
/** The build a checked pointer names for a machine's `uname -sm` (`{ name, sha256, size }`), or null. */
export const assetFor = (uname, pointer) => pointer?.assets?.[targetFor(uname)] ?? null;

/**
 * Where the person agreed to usagemeter, from the install record: `all` (this computer and every
 * linked machine), `local`, `none`, or null when nobody asked. The record's scope line says it,
 * and only an explicit `automagik-herdr meter install` or an install.sh run of this release writes
 * `all`. A record without one (an install.sh before this one wrote none, even for --no-usagemeter)
 * is never `all`: `local` when it shows the pack installed usagemeter on this computer, else
 * null (`update` then installs nowhere and prints OPT_IN).
 */
export function meterScope(record) {
  if (!record) return null;
  if (record.usagemeterScope) return record.usagemeterScope;
  return record.usagemeter ? "local" : null;
}

/** The line `update` prints when nobody asked: how to opt in. */
export const OPT_IN = "usagemeter: not installed by the update (no install has asked for it). To install it on this computer and every linked machine: automagik-herdr meter install";

/** A machine name as `hc machine ls` gives it, safe in the ownership record (`name:version,…`). */
export const MACHINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The linked machines in `hc machine ls --json` (it never lists this computer): `{ name, connected }`
 * each, temporary ones left out (the sidebar does the same), names the record can't hold dropped.
 */
export function linkedMachines(json) {
  let list = [];
  try { list = (typeof json === "string" ? JSON.parse(json) : json)?.machines ?? []; } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m && !m.temporary && typeof m.name === "string" && MACHINE_NAME.test(m.name))
    .map((m) => ({ name: m.name, connected: m.state === "connected" }));
}

// The version a usagemeter reports (`usagemeter X.Y.Z`, a dev build `X.Y.Z-dev` or `X.Y.Z+b`),
// install.sh's meter_version, and its version_ge (field by field as numbers).
const VERSION_SH = `ver() {
  "$1" --version </dev/null 2>/dev/null \\
    | sed -n 's/^usagemeter \\([0-9][0-9]*\\.[0-9][0-9]*\\.[0-9][0-9]*\\([-+][0-9A-Za-z.+-]*\\)\\{0,1\\}\\)$/\\1/p' | head -n 1
}
ge() {
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 0 }' </dev/null
}
dest=$HOME/.local/bin/usagemeter`;

/**
 * Run on the machine as `sh -c INSTALL sh <base> <asset> <version> <sha256>`: <base> the download
 * folder of the release the checked pointer names (https, or a test's file://), <sha256> the one it
 * names for <asset>. One download, checked against <sha256> before anything is written beside the
 * binary. Only then is the new binary run once, from beside the binary (a temp folder may be
 * noexec): `--version` under `env -i` (no variable but a bare PATH and a scratch HOME; usagemeter
 * opens no network connection), killed after SMOKE_SECONDS, and its whole output must be exactly
 * `usagemeter <version>`. The binary it replaces, which at that point can only be a regular file
 * reporting an older version (a link, an unversioned or a newer one never reaches the swap), is kept
 * as ~/.local/bin/usagemeter.prev: a hard link, so its mode is the binary's, replaced at the next
 * swap. A broken release still leaves a working meter and one rename back:
 * `mv ~/.local/bin/usagemeter.prev ~/.local/bin/usagemeter`. Prints one line: `current`,
 * `newer <v>`, `link`, `unknown` (left as it is), `installed`, or `installed prev` (the old one
 * kept). Fails (stderr, exit 3: checksum, 4: no curl, 5: download, 6: write, 7: the new binary
 * does not run as <version>) with the old binary in place and no temp file left. The state is
 * looked at again just before the rename, in case something else put a usagemeter there meanwhile.
 */
/** How long the new binary's `--version` may take before the swap is refused. */
export const SMOKE_SECONDS = 10;
export const INSTALL = `set -u
base=$1; asset=$2; want=$3; sum=$4
${VERSION_SH}
dir=\${dest%/*}
state() {
  if [ -L "$dest" ] || { [ -e "$dest" ] && [ ! -f "$dest" ]; }; then echo link; return 0; fi
  [ -f "$dest" ] || return 0
  have=$(ver "$dest")
  if [ -z "$have" ]; then echo unknown
  elif [ "$have" = "$want" ]; then echo current
  elif ge "\${have%%[-+]*}" "$want"; then echo "newer $have"
  fi
}
s=$(state); if [ -n "$s" ]; then echo "$s"; exit 0; fi
case $sum in *[!0-9a-f]*|'') echo "no sha256 for $asset" >&2; exit 3 ;; esac
[ \${#sum} -eq 64 ] || { echo "no sha256 for $asset" >&2; exit 3; }
command -v curl >/dev/null 2>&1 || { echo "curl is not installed" >&2; exit 4; }
case $base in https://*) proto='=https' ;; file://*) proto='=file' ;; *) echo "not a release folder: $base" >&2; exit 5 ;; esac
tmp=$(mktemp -d "\${TMPDIR:-/tmp}/usagemeter.XXXXXX") || { echo "could not make a temporary folder" >&2; exit 6; }
part=
trap 'rm -rf "$tmp"; if [ -n "$part" ]; then rm -f "$part"; fi' EXIT
curl -fsSL --path-as-is --proto "$proto" --proto-redir '=https' "$base/$asset" -o "$tmp/$asset" </dev/null 2>/dev/null \\
  || { echo "could not download $base/$asset" >&2; exit 5; }
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" </dev/null); else got=$(shasum -a 256 "$tmp/$asset" </dev/null); fi
got=\${got%% *}
[ "$got" = "$sum" ] || { echo "$asset is not the build the signed meter-lane pointer names (sha256 $got, expected $sum): nothing was installed" >&2; exit 3; }
mkdir -p "$dir" || { echo "could not make $dir" >&2; exit 6; }
part=$(mktemp "$dir/.usagemeter.XXXXXX") || { echo "could not write in $dir" >&2; exit 6; }
cp "$tmp/$asset" "$part" && chmod 755 "$part" || { echo "could not write $dest" >&2; exit 6; }
env -i PATH=/usr/bin:/bin HOME="$tmp" "$part" --version </dev/null >"$tmp/smoke" 2>/dev/null & sp=$!
( sleep ${SMOKE_SECONDS}; kill -9 "$sp" ) </dev/null >/dev/null 2>&1 & kp=$!
wait "$sp"; kill "$kp" 2>/dev/null
runs=$(cat "$tmp/smoke")
[ "$runs" = "usagemeter $want" ] || { said=$(printf '%s' "$runs" | tr '\\n' ' ' | cut -c1-80); echo "the new usagemeter does not run as $want (--version said: \${said:-nothing}): the old binary stays, nothing was installed" >&2; exit 7; }
s=$(state); if [ -n "$s" ]; then echo "$s"; exit 0; fi
prev="$dest.prev"; kept=
if [ -f "$dest" ] && [ ! -L "$dest" ]; then
  if [ -L "$prev" ] || { [ -e "$prev" ] && [ ! -f "$prev" ]; }; then echo "$prev is a link or a folder, not the backup this keeps: nothing was installed" >&2; exit 6; fi
  ln -f "$dest" "$prev" 2>/dev/null || { echo "could not keep the previous binary as $prev: nothing was installed" >&2; exit 6; }
  kept=prev
fi
mv -f "$part" "$dest" || { echo "could not write $dest" >&2; exit 6; }
part=
echo "installed $kept"`;

/** Run as `sh -c UNINSTALL sh <version>`: removes the binary only if it still reports <version>. */
export const UNINSTALL = `set -u
${VERSION_SH}
if [ ! -f "$dest" ] || [ -L "$dest" ]; then echo absent; exit 0; fi
have=$(ver "$dest")
if [ "$have" != "$1" ]; then echo "other \${have:-none}"; exit 0; fi
rm -f "$dest" && echo removed`;

const short = (s) => String(s ?? "").trim().split("\n").filter(Boolean).pop()?.slice(0, 400) ?? "";

/** `hc exec --json` output ({ code, stdout, stderr: base64, timed_out }) as { code, stdout, stderr }. */
export function decodeExec(r, timeout) {
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  if (!j || typeof j !== "object" || !("code" in j)) return { code: -1, stdout: "", stderr: short(r.stderr) || short(r.stdout) || `hc exec failed (exit ${r.code})` };
  if (j.timed_out) return { code: -1, stdout: "", stderr: `timed out after ${timeout} s` };
  const text = (b) => { try { return Buffer.from(String(b ?? ""), "base64").toString("utf8"); } catch { return ""; } };
  return { code: typeof j.code === "number" ? j.code : -1, stdout: text(j.stdout), stderr: text(j.stderr) };
}

/** The `hc` arguments that run `argv` on `machine` within `timeout` seconds. */
export const hcExecArgs = (machine, argv, timeout) => ["exec", "--json", "--timeout", String(timeout), "--on", machine, "--", ...argv];

/**
 * Installs the build a checked meter-lane pointer names (meterLane.mjs readMeterLane: `pointer`, and
 * `base`, its release's download folder) on one machine (null: this computer). `run(argv, { on,
 * timeout })` resolves `{ code, stdout, stderr }` and never rejects. Resolves `{ machine, status,
 * version?, want, why? }`, status one of installed | current | newer | link | unknown | failed.
 */
export async function installOn(run, machine, { pointer, base }) {
  const want = pointer.version;
  const u = await run(["uname", "-sm"], { on: machine, timeout: 20 });
  if (u.code !== 0) return { machine, status: "failed", want, why: short(u.stderr) || "could not reach it" };
  const asset = assetFor(u.stdout, pointer);
  if (!asset) return { machine, status: "failed", want, why: `no usagemeter build for ${short(u.stdout).slice(0, 40) || "this system"}` };
  const r = await run(["sh", "-c", INSTALL, "sh", base, asset.name, want, asset.sha256], { on: machine, timeout: 180 });
  if (r.code !== 0) return { machine, status: "failed", want, why: short(r.stderr) || `exit ${r.code}` };
  const [word, have] = short(r.stdout).split(/\s+/);
  if (word === "installed") return { machine, status: word, version: want, want, ...(have === "prev" ? { prev: true } : {}) };
  if (word === "current") return { machine, status: word, version: want, want };
  if (word === "newer") return { machine, status: "newer", version: have ?? null, want };
  if (word === "link" || word === "unknown") return { machine, status: word, want };
  return { machine, status: "failed", want, why: `unexpected answer: ${short(r.stdout) || "(none)"}` };
}

/** Removes the pack's usagemeter from one machine: `{ machine, status: removed|absent|other|failed, why? }`. */
export async function uninstallOn(run, machine, version) {
  const r = await run(["sh", "-c", UNINSTALL, "sh", version], { on: machine, timeout: 30 });
  if (r.code !== 0) return { machine, status: "failed", why: short(r.stderr) || `exit ${r.code}` };
  const [word, have] = short(r.stdout).split(/\s+/);
  if (word === "removed" || word === "absent") return { machine, status: word };
  if (word === "other") return { machine, status: "other", why: have === "none" ? "it reports no usagemeter version" : `it is usagemeter ${have}` };
  return { machine, status: "failed", why: `unexpected answer: ${short(r.stdout) || "(none)"}` };
}

/**
 * The record's per-machine line after `results`: installed → that version, newer/link/unknown → not
 * the pack's any more, current/failed/removed-elsewhere → as it was. `machines`: { name: version }.
 */
export function recordAfter(machines, results) {
  const next = { ...machines };
  for (const r of results) {
    if (!r.machine) continue;
    if (r.status === "installed") next[r.machine] = r.version;
    else if (["newer", "link", "unknown", "removed", "absent", "other"].includes(r.status)) delete next[r.machine];
  }
  return next;
}

/** One line for a person per result. */
export function resultLine(r) {
  const where = r.machine ? `on ${r.machine}` : "on this computer";
  switch (r.status) {
    case "installed": return `usagemeter ${r.version} ${where}: installed (signed pointer, checksum ok)${r.prev ? "; the previous one is kept as ~/.local/bin/usagemeter.prev (to go back: mv ~/.local/bin/usagemeter.prev ~/.local/bin/usagemeter)" : ""}.`;
    case "current": return `usagemeter ${r.version} ${where}: already installed.`;
    case "newer": return `usagemeter ${r.version ?? "(newer)"} ${where} is not older than ${r.want ?? "the meter lane's"}: not replacing it.`;
    case "link": return `usagemeter ${where}: ~/.local/bin/usagemeter is a link or a folder; left as it is.`;
    case "unknown": return `Warning: usagemeter ${where}: ~/.local/bin/usagemeter reports no usagemeter version; left as it is.`;
    case "disconnected": return `Warning: usagemeter ${where}: skipped, the machine is not connected.`;
    case "removed": return `Removed usagemeter ${where}. Its store is kept.`;
    case "absent": return `usagemeter ${where}: nothing to remove.`;
    case "other": return `Left usagemeter ${where}: ${r.why}, not the one the pack put there.`;
    case "kept": return `Left usagemeter ${where}: ${r.why}.`;
    default: return `Warning: usagemeter ${where}: ${r.why ?? "failed"}.`;
  }
}
