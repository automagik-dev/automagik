#!/bin/sh
# Exercises install.sh against a release laid out on disk: tests/install.sh <dir with usagemeter-* binaries>
# Fresh install, an idempotent re-run (latest and pinned), never a downgrade (older, equal and
# newer installed binaries, compared as numbers), a tampered binary that must not be installed,
# and a bad version argument.
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
[ "$version" != 0.0.0 ] || fail "the release under test must be newer than 0.0.0"

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

# Never a downgrade. Stand-in binaries answer --version like the real one; 9000.x is newer than
# any release under test, and 9000.10.0 > 9000.9.0 only when compared as numbers.
fake() { printf '#!/bin/sh\necho "usagemeter %s"\n' "$1" > "$2" && chmod 755 "$2"; }
offline() { HOME=$home USAGEMETER_BASE_URL=file:///nonexistent sh "$root/install.sh" "$@"; }
expect() { case $1 in *"$2"*) ;; *) fail "$3: expected '$2' in: $1" ;; esac; }
fakerel=$rel/download/v9000.10.0
mkdir -p "$fakerel"
fake 9000.10.0 "$fakerel/$host"
(cd "$fakerel" && sums "$host" > SHA256SUMS)

# Older (9000.9.0, string-greater than 9000.10.0): replaced by the pinned 9000.10.0.
fake 9000.9.0 "$dest"
out=$(run 9000.10.0) || fail "upgrade from an older binary failed"
echo "$out"
[ "$("$dest" --version)" = "usagemeter 9000.10.0" ] || fail "the older binary was not replaced"

# Equal: nothing to do, no network.
out=$(offline 9000.10.0) || fail "pinned equal version failed"
echo "$out"
expect "$out" "already installed" "pinned equal version"

# Newer installed than pinned: kept, exit 0, no network (as strings, 9000.10.0 < 9000.9.0).
cp "$dest" "$work/kept"
out=$(offline 9000.9.0) || fail "pinned older version failed"
echo "$out"
expect "$out" "not downgrading" "pinned older version"
out=$(offline "$version") || fail "pinned release version under a newer binary failed"
echo "$out"
expect "$out" "not downgrading" "pinned release version under a newer binary"
cmp -s "$dest" "$work/kept" || fail "a pinned older version replaced a newer binary"

# Newer installed than the latest release: the download is checked and dropped.
out=$(run) || fail "latest under a newer binary failed"
echo "$out"
expect "$out" "not downgrading" "latest under a newer binary"
cmp -s "$dest" "$work/kept" || fail "the latest release replaced a newer binary"
[ "$(ls -A "$home/.local/bin")" = usagemeter ] || fail "temp files left behind: $(ls -A "$home/.local/bin")"

# Older installed than the latest release, and than a pinned one: replaced as before.
fake 0.0.0 "$dest"
out=$(run) || fail "latest over an older binary failed"
echo "$out"
[ "$("$dest" --version)" = "usagemeter $version" ] || fail "latest did not replace an older binary"
fake 0.0.0 "$dest"
out=$(run "$version") || fail "pinned over an older binary failed"
echo "$out"
[ "$("$dest" --version)" = "usagemeter $version" ] || fail "pinned did not replace an older binary"

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
