// The usage meter on every machine this desktop reaches: keeps `usagemeter`
// (https://github.com/automagik-dev/usagemeter) installed at ~/.local/bin/usagemeter (the latest
// release's binary for that machine, verified against that release's SHA256SUMS) and runs
// `nice -n 19 usagemeter sync` on each one, 10 minutes after the last pass finished.
//
// - Herdr desktop installs usagemeter too, at the same path. Shared rules: never downgrade (an
//   installed usagemeter that reports a newer version than the latest release stays), and
//   concurrent syncs are safe (usagemeter takes meter.lock).
// - It replaced `automagik-meter`, which this repo used to ship: same store, same doc. Once a
//   usagemeter sync has succeeded on a machine, the old ~/.local/bin/automagik-meter is removed.
// - Fixed commands only: nothing a phone sends reaches them. The meter decides what is stale.
// - Network: the GitHub release download (from here for the latest version and SHA256SUMS, from
//   each machine for its binary) and herdr-core (`hc exec`). Nothing else.
// - One pass at a time; a pass still going when the next is due is skipped, never queued.
// - A machine on battery is skipped. Nothing ever throws out of here into the bridge.
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'

export const RELEASES = 'https://github.com/automagik-dev/usagemeter/releases'
const EVERY_MS = 10 * 60_000
const FIRST_MS = 60_000
const RELEASE_TTL_MS = 60 * 60_000
/** Failures in a row before the dialog shows them. */
export const SHOW_AFTER = 3

/** `uname -sm` → release asset. */
export const ASSETS = {
  'Darwin arm64': 'usagemeter-darwin-arm64',
  'Darwin aarch64': 'usagemeter-darwin-arm64',
  'Darwin x86_64': 'usagemeter-darwin-x86_64',
  'Linux x86_64': 'usagemeter-linux-x86_64',
  'Linux amd64': 'usagemeter-linux-x86_64',
  'Linux aarch64': 'usagemeter-linux-aarch64',
  'Linux arm64': 'usagemeter-linux-aarch64',
}

/** The URL of one file of one release. */
export const assetUrl = (version, file) => `${RELEASES}/download/v${version}/${file}`

// Installs or updates ~/.local/bin/usagemeter from $1 (an https URL) if its SHA-256 is not $2.
// $3 is the version that URL holds: an installed usagemeter reporting a newer one stays (never
// downgrade). The download goes to a temporary file beside it and replaces it only once the hash
// matches. Prints current, newer or installed.
export const INSTALL = `set -eu
url=$1; want=$2; version=$3
dir=$HOME/.local/bin; dest=$dir/usagemeter
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
if [ -f "$dest" ] && [ "$(sum "$dest")" = "$want" ]; then echo current; exit 0; fi
if [ -x "$dest" ]; then
  have=$("$dest" --version 2>/dev/null | awk 'NR == 1 && $1 == "usagemeter" { v = $2; sub(/^v/, "", v); print v }' || true)
  case $have in [0-9]*.[0-9]*.[0-9]*) ;; *) have= ;; esac
  if [ -n "$have" ] && awk -v a="$have" -v b="$version" 'BEGIN { split(a, x, "."); split(b, y, "."); for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 1 }'; then
    echo newer; exit 0
  fi
fi
command -v curl >/dev/null 2>&1 || { echo "curl is not installed" >&2; exit 4; }
mkdir -p "$dir"
tmp=$(mktemp "$dir/.usagemeter.XXXXXX")
trap 'rm -f "$tmp"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 --max-time 120 -o "$tmp" "$url"
[ "$(sum "$tmp")" = "$want" ] || { echo "checksum mismatch" >&2; exit 3; }
chmod 755 "$tmp"
mv -f "$tmp" "$dest"
trap - EXIT
echo installed`

// Runs the installed meter at the lowest priority, unless the machine is on battery. After a
// sync that worked, removes the automagik-meter usagemeter replaced; a failed sync keeps it.
export const SYNC = `set -eu
dest=$HOME/.local/bin/usagemeter
[ -x "$dest" ] || { echo "usagemeter is not installed" >&2; exit 5; }
case $(uname -s) in
  Darwin) if pmset -g batt 2>/dev/null | grep -q "'Battery Power'"; then echo on-battery; exit 0; fi ;;
  Linux)
    ac=; for f in /sys/class/power_supply/*/online; do [ -r "$f" ] && ac="$ac$(cat "$f")"; done
    if [ -n "$ac" ] && ! printf %s "$ac" | grep -q 1 && ls /sys/class/power_supply/BAT* >/dev/null 2>&1; then echo on-battery; exit 0; fi ;;
esac
nice -n 19 "$dest" sync
rm -f "$HOME/.local/bin/automagik-meter"`

const short = (s) => String(s ?? '').trim().split('\n').filter(Boolean).pop()?.slice(0, 200) ?? ''

/** `hc exec` on one machine (null: here). Never rejects. */
export function hcExec(hc, on, argv, timeoutSecs) {
  const args = ['exec', '--json', '--timeout', String(timeoutSecs)]
  if (on) args.push('--on', on)
  else args.push('--cwd', homedir())
  args.push('--', ...argv)
  return new Promise((resolve) => {
    execFile(hc, args, { timeout: (timeoutSecs + 15) * 1000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      // {code, stdout, stderr, timed_out}; the output fields are base64.
      let r = null
      try { r = JSON.parse(stdout) } catch {}
      const text = (b) => { try { return Buffer.from(String(b ?? ''), 'base64').toString('utf8') } catch { return '' } }
      if (r && typeof r === 'object' && 'code' in r) {
        resolve(r.timed_out
          ? { code: -1, stdout: '', stderr: `timed out after ${timeoutSecs} s` }
          : { code: r.code ?? -1, stdout: text(r.stdout), stderr: text(r.stderr) })
      } else resolve({ code: -1, stdout: '', stderr: short(stderr) || err?.message || 'hc exec failed' })
    })
  })
}

/** A release's SHA256SUMS: { asset: sha }. */
export function parseSums(text) {
  const sums = {}
  for (const line of String(text).split('\n')) {
    const m = line.match(/^([0-9a-f]{64}) [ *]?(usagemeter-[a-z0-9_-]+)$/)
    if (m) sums[m[2]] = m[1]
  }
  return sums
}

/** The version in the `Location` of releases/latest (…/releases/tag/v0.1.0), or null. */
export function parseLatest(location) {
  const m = String(location ?? '').match(/\/automagik-dev\/usagemeter\/releases\/tag\/v(\d+\.\d+\.\d+)$/)
  return m ? m[1] : null
}

/**
 * The latest release: { version, sums }. The version comes from where releases/latest redirects;
 * SHA256SUMS and the binaries are then read from that tag, so they always belong together.
 */
export async function fetchRelease() {
  const l = await fetch(`${RELEASES}/latest`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
  const version = parseLatest(l.headers.get('location'))
  if (!version) throw new Error(`latest release: HTTP ${l.status}`)
  const r = await fetch(assetUrl(version, 'SHA256SUMS'), { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`SHA256SUMS: HTTP ${r.status}`)
  return { version, sums: parseSums(await r.text()) }
}

/**
 * One machine: install or update if a release is known (`release`: { version, sums }), then
 * sync. Returns what happened.
 */
export async function meterOne(hc, on, release) {
  const u = await hcExec(hc, on, ['uname', '-sm'], 20)
  if (u.code !== 0) return { ok: false, error: short(u.stderr) || 'cannot reach the machine' }
  const platform = u.stdout.trim()
  const asset = ASSETS[platform]
  const sha = release?.sums?.[asset]
  let installed = null
  if (asset && sha) {
    const i = await hcExec(hc, on, ['sh', '-c', INSTALL, 'sh', assetUrl(release.version, asset), sha, release.version], 180)
    if (i.code !== 0) return { ok: false, error: `install: ${short(i.stderr) || `exit ${i.code}`}` }
    installed = i.stdout.trim()
  } else if (!asset) {
    return { ok: false, error: `no meter build for ${platform.slice(0, 40)}` }
  }
  const s = await hcExec(hc, on, ['sh', '-c', SYNC], 90)
  // Not installed and no release to install from yet (or GitHub unreachable): wait, not an error.
  if (s.code === 5 && !sha) return { ok: true, installed: null, skipped: 'no release to install yet' }
  if (s.code !== 0) return { ok: false, error: `sync: ${short(s.stderr) || `exit ${s.code}`}` }
  return { ok: true, installed, skipped: s.stdout.trim() === 'on-battery' ? 'on battery' : null }
}

/** Machines this desktop reaches: here (null) and every connected herdr-core machine. */
async function machines(hc) {
  const r = await new Promise((resolve) => execFile(hc, ['machine', 'ls', '--json'], { timeout: 20_000 }, (err, stdout) => resolve(err ? '' : stdout)))
  let list = []
  try { list = JSON.parse(r).machines ?? [] } catch {}
  return [null, ...list.filter((m) => m.state === 'connected' && typeof m.name === 'string').map((m) => m.name)]
}

/**
 * Starts the loop. `read()`/`write(state)` persist {machines: {name: {ok, failures, error, at}}};
 * `log` gets one line per failure; `only`: this computer and that one machine (a manual run);
 * `latest`: what fetches the latest release (tests replace it). Returns { pass(), stop() }.
 */
export function startMeter({ hc, read, write, log, only = null, latest = fetchRelease }) {
  let running = false
  let timer = null
  let stopped = false
  let release = null
  let releaseAt = 0

  async function pass() {
    if (running) return { skipped: true }
    running = true
    try {
      if (Date.now() - releaseAt > RELEASE_TTL_MS) {
        try { release = await latest(); releaseAt = Date.now() } catch (e) { log(`meter: ${e.message}`); releaseAt = Date.now() - RELEASE_TTL_MS + 10 * 60_000 }
      }
      const state = read() ?? {}
      state.machines ??= {}
      for (const on of (await machines(hc)).filter((m) => !only || m === null || m === only)) {
        if (stopped) break
        const key = on ?? 'this computer'
        const prev = state.machines[key] ?? { failures: 0 }
        let r
        try { r = await meterOne(hc, on, release) } catch (e) { r = { ok: false, error: e.message } }
        state.machines[key] = r.ok
          ? { ok: Date.now(), failures: 0, error: null, skipped: r.skipped ?? null }
          : { ...prev, failures: (prev.failures ?? 0) + 1, error: r.error, at: Date.now() }
        if (!r.ok) log(`meter: ${key}: ${r.error}`)
        try { write(state) } catch {}
      }
      return state
    } finally {
      running = false
    }
  }

  const schedule = (ms) => {
    if (stopped) return
    timer = setTimeout(() => { pass().catch((e) => log(`meter: ${e.message}`)).finally(() => schedule(EVERY_MS)) }, ms)
    timer.unref?.()
  }
  schedule(FIRST_MS)
  return { pass, stop: () => { stopped = true; if (timer) clearTimeout(timer) } }
}

/** The machines the dialog should show: failing at least SHOW_AFTER times in a row. */
export function failing(state) {
  return Object.entries(state?.machines ?? {})
    .filter(([, m]) => (m.failures ?? 0) >= SHOW_AFTER)
    .map(([machine, m]) => ({ machine, error: m.error, failures: m.failures }))
}
