#!/bin/sh
# Installs usagemeter to ~/.local/bin/usagemeter from a GitHub release of automagik-dev/usagemeter.
#
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/usagemeter/dev/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/usagemeter/dev/install.sh | sh -s -- 0.3.0
#
# The version is the first argument or USAGEMETER_VERSION (0.3.0 or v0.3.0); without one it
# installs the latest release. It picks the binary for this OS and CPU, checks it against the
# release's SHA256SUMS and replaces the old one atomically. It needs curl and sha256sum or
# shasum, and no sudo. It never downgrades: when the installed binary reports a version (its
# `usagemeter --version` prints `usagemeter X.Y.Z`, compared field by field as numbers) at least
# the one asked for, it changes nothing and exits 0. A pinned version is checked without touching
# the network; the latest by comparing the installed file with the release's SHA256SUMS, then the
# version of the verified download. An older binary, or one without a version, is replaced.
#
# USAGEMETER_BASE_URL replaces https://github.com/automagik-dev/usagemeter/releases (a mirror, or
# a local copy for tests); it must keep the same layout: latest/download/<file> and
# download/v<version>/<file>.
set -eu

base=${USAGEMETER_BASE_URL:-https://github.com/automagik-dev/usagemeter/releases}
want=${1:-${USAGEMETER_VERSION:-}}

say() { printf '%s\n' "$*"; }
die() { printf 'usagemeter: %s\n' "$*" >&2; exit 1; }

[ -n "${HOME:-}" ] || die "HOME is not set"
dir=$HOME/.local/bin
dest=$dir/usagemeter

want=${want#v}
case $want in
  '') ;;
  *[!0-9.]* | .* | *. | *..* ) die "not a version: $want (want 0.N.P)" ;;
  *.*.*) ;;
  *) die "not a version: $want (want 0.N.P)" ;;
esac

os=$(uname -s)
cpu=$(uname -m)
case "$os $cpu" in
  'Darwin arm64' | 'Darwin aarch64') asset=usagemeter-darwin-arm64 ;;
  'Darwin x86_64') asset=usagemeter-darwin-x86_64 ;;
  'Linux x86_64' | 'Linux amd64') asset=usagemeter-linux-x86_64 ;;
  'Linux aarch64' | 'Linux arm64') asset=usagemeter-linux-aarch64 ;;
  *) die "no build for $os $cpu" ;;
esac

if command -v sha256sum > /dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum > /dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "needs sha256sum or shasum"
fi
command -v curl > /dev/null 2>&1 || die "needs curl"

# The X.Y.Z that a usagemeter binary reports, or nothing.
version_of() {
  "$1" --version 2> /dev/null | sed -n 's/^usagemeter \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$/\1/p' || true
}
# Whether version $1 >= version $2, numerically field by field (0.10.0 >= 0.9.0).
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, "."); if (m > n) n = m
    for (i = 1; i <= n; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 0
  }'
}
# Installed $have against wanted $1: when it is not older, say so and exit 0.
keep_if_not_older() {
  [ -n "$have" ] && version_ge "$have" "$1" || return 0
  if version_ge "$1" "$have"; then
    say "usagemeter $have is already installed at $dest"
  else
    say "usagemeter $have is installed at $dest, newer than $1: not downgrading"
  fi
  exit 0
}

have=
[ -x "$dest" ] && have=$(version_of "$dest")

# A pinned version that is installed, or older than the installed one: done, no network.
[ -z "$want" ] || keep_if_not_older "$want"

# Unpinned, SHA256SUMS and the binary are two requests to latest/download: a release published
# between them fails the checksum and nothing is installed; the next run gets a matching pair.
if [ -n "$want" ]; then
  url=$base/download/v$want
else
  url=$base/latest/download
fi

mkdir -p "$dir"
tmp=$(mktemp "$dir/.usagemeter.XXXXXX")
sums=$tmp.sums
trap 'rm -f "$tmp" "$sums"' EXIT
trap 'exit 1' HUP INT TERM

fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }

fetch "$url/SHA256SUMS" "$sums" || die "could not download $url/SHA256SUMS"
sum=$(awk -v a="$asset" '$2 == a || $2 == "*" a { print $1; exit }' "$sums")
case $sum in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) [ ${#sum} -eq 64 ] || die "bad SHA256SUMS line for $asset" ;;
  *) die "$url/SHA256SUMS has no $asset" ;;
esac

if [ -f "$dest" ] && [ "$(sha256 "$dest")" = "$sum" ]; then
  say "$("$dest" --version 2> /dev/null || echo "$asset") is already installed at $dest"
  exit 0
fi

fetch "$url/$asset" "$tmp" || die "could not download $url/$asset"
got=$(sha256 "$tmp")
[ "$got" = "$sum" ] || die "checksum mismatch for $asset: expected $sum, got $got"
chmod 755 "$tmp"
# The latest release can be older than the installed binary: keep the newer one.
if [ -z "$want" ]; then
  new=$(version_of "$tmp")
  [ -z "$new" ] || keep_if_not_older "$new"
fi
mv -f "$tmp" "$dest"
say "installed $("$dest" --version 2> /dev/null || echo "$asset") at $dest"

case ":${PATH:-}:" in
  *":$dir:"*) ;;
  *) say "note: $dir is not on PATH" >&2 ;;
esac
