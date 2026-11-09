#!/usr/bin/env bash
# The release version, Automagik's way: every release is 0.N.0 and the next one is 0.(highest N + 1).0.
# Cargo.toml's [package] version holds it, and Cargo.lock repeats it (CI builds with --locked). Usage:
#   scripts/version.sh current      print the package version
#   scripts/version.sh next         the next release from the v0.N.0 tags
#   scripts/version.sh set <x.y.z>  write it to Cargo.toml and Cargo.lock
set -euo pipefail
cd "$(dirname "$0")/.."
MAJOR=0
PKG=usagemeter
case "${1:-}" in
  current) sed -n '/^\[package\]/,/^\[/s/^version = "\(.*\)"$/\1/p' Cargo.toml ;;
  next)
    n=$(git tag --list "v${MAJOR}.*.0" | sed -nE "s/^v${MAJOR}\.(0|[1-9][0-9]{0,3})\.0$/\1/p" | sort -n | tail -1)
    echo "${MAJOR}.$(( ${n:-0} + 1 )).0" ;;
  set)
    [[ "${2:-}" =~ ^${MAJOR}\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$ ]] || { echo "not a version: ${2:-} (want ${MAJOR}.N.P)" >&2; exit 1; }
    v=$2
    # Cargo.toml: the version line of [package] only.
    awk -v v="$v" '
      /^\[/ { inpkg = ($0 == "[package]") }
      inpkg && !done && /^version = "/ { print "version = \"" v "\""; done = 1; next }
      { print }
      END { if (!done) exit 1 }' Cargo.toml > Cargo.toml.new
    # Cargo.lock: the version line right after this package's name.
    awk -v v="$v" -v pkg="$PKG" '
      $0 == "name = \"" pkg "\"" { print; getline; if ($0 !~ /^version = "/) exit 1; print "version = \"" v "\""; done = 1; next }
      { print }
      END { if (!done) exit 1 }' Cargo.lock > Cargo.lock.new
    mv Cargo.toml.new Cargo.toml
    mv Cargo.lock.new Cargo.lock ;;
  *) echo "usage: scripts/version.sh current | next | set <version>" >&2; exit 2 ;;
esac
