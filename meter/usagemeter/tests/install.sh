#!/bin/sh
# Exercises install.sh against a release laid out on disk: tests/install.sh <dir with usagemeter-* binaries>
# Fresh install, an idempotent re-run (latest and pinned), a tampered binary that must not be
# installed, and a bad version argument.
set -eu

src=$(cd "$1" && pwd)
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

if command -v sha256sum > /dev/null 2>&1; then sums() { sha256sum "$@"; }; else sums() { shasum -a 256 "$@"; }; fi

for b in "$src"/usagemeter-*; do
  [ -f "$b" ] && chmod 755 "$b"
done
case "$(uname -s) $(uname -m)" in
  'Darwin arm64') host=usagemeter-darwin-arm64 ;;
  'Darwin x86_64') host=usagemeter-darwin-x86_64 ;;
  'Linux x86_64') host=usagemeter-linux-x86_64 ;;
  'Linux aarch64') host=usagemeter-linux-aarch64 ;;
  *) fail "no build for this host" ;;
esac
[ -f "$src/$host" ] || fail "missing $src/$host"
version=$("$src/$host" --version | sed -n 's/^usagemeter //p')
[ -n "$version" ] || fail "$host --version does not print 'usagemeter <version>'"

# The GitHub layout: latest/download/<file> and download/v<version>/<file>.
rel=$work/releases
for d in "$rel/latest/download" "$rel/download/v$version"; do
  mkdir -p "$d"
  cp "$src"/usagemeter-* "$d/"
  (cd "$d" && sums usagemeter-* > SHA256SUMS)
done

home=$work/home
mkdir -p "$home"
run() { HOME=$home USAGEMETER_BASE_URL=file://$rel sh "$root/install.sh" "$@"; }
dest=$home/.local/bin/usagemeter

out=$(run) || fail "fresh install failed"
echo "$out"
[ -x "$dest" ] || fail "not installed"
[ "$("$dest" --version)" = "usagemeter $version" ] || fail "wrong binary installed"
[ "$(ls -A "$home/.local/bin")" = usagemeter ] || fail "temp files left behind: $(ls -A "$home/.local/bin")"

before=$(ls -i "$dest")
out=$(run) || fail "re-run failed"
echo "$out"
case $out in *"already installed"*) ;; *) fail "re-run did not see the installed binary" ;; esac
[ "$(ls -i "$dest")" = "$before" ] || fail "re-run replaced the binary"

# Pinned and present: no download at all (the base URL does not even exist).
out=$(HOME=$home USAGEMETER_BASE_URL=file:///nonexistent sh "$root/install.sh" "v$version") || fail "pinned re-run failed"
echo "$out"
case $out in *"already installed"*) ;; *) fail "pinned re-run did not see the installed binary" ;; esac

# A pinned version installs from download/v<version>.
rm -f "$dest"
out=$(USAGEMETER_VERSION=$version run) || fail "pinned install failed"
echo "$out"
[ "$("$dest" --version)" = "usagemeter $version" ] || fail "pinned install"

# A binary that does not match SHA256SUMS is refused and the installed one stays.
printf 'tampered' >> "$rel/latest/download/$host"
printf 'x' >> "$dest"   # make the installed one differ so the installer tries to download
pre=$(sums "$dest")
if run 2> "$work/err"; then fail "a tampered binary was installed"; fi
cat "$work/err"
grep -q 'checksum mismatch' "$work/err" || fail "no checksum error"
[ "$(sums "$dest")" = "$pre" ] || fail "the tampered download replaced the installed binary"
[ "$(ls -A "$home/.local/bin")" = usagemeter ] || fail "temp files left behind: $(ls -A "$home/.local/bin")"

if run 0.x 2> "$work/err"; then fail "accepted a bad version"; fi
cat "$work/err"

echo "install.sh: all checks passed"
