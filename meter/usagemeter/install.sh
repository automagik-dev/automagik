#!/bin/sh
# Installs usagemeter to ~/.local/bin/usagemeter from a GitHub release of automagik-dev/usagemeter.
#
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/usagemeter/dev/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/automagik-dev/usagemeter/dev/install.sh | sh -s -- 0.3.0
#
# The version is the first argument or USAGEMETER_VERSION (0.3.0 or v0.3.0); without one it
# installs the latest release. It picks the binary for this OS and CPU, checks it against the
# release's SHA256SUMS and replaces the old one atomically. It needs curl and sha256sum or
# shasum, and no sudo. Run again with the same version installed, it changes nothing and exits 0:
# a pinned version is checked with `usagemeter --version` without touching the network; the latest
# by comparing the installed file with the release's SHA256SUMS.
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

# A pinned version that is already installed: done, no network.
if [ -n "$want" ] && [ -x "$dest" ] && [ "$("$dest" --version 2> /dev/null || true)" = "usagemeter $want" ]; then
  say "usagemeter $want is already installed at $dest"
  exit 0
fi

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
mv -f "$tmp" "$dest"
say "installed $("$dest" --version 2> /dev/null || echo "$asset") at $dest"

case ":${PATH:-}:" in
  *":$dir:"*) ;;
  *) say "note: $dir is not on PATH" >&2 ;;
esac
