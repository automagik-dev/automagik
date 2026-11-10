#!/usr/bin/env bash
# Imports automagik-si/usagemeter (branch dev) under meter/usagemeter/, with its history, into the
# branch checked out here (docs/rfcs/0017-usagemeter-crate.md, "The import").
#
#   scripts/import-usagemeter.sh [<source>] [<branch>] [<commit>]
#
# <source> defaults to https://github.com/automagik-si/usagemeter.git, <branch> to dev and
# <commit> to 61165ba1959c (chore(release): v0.5.0), the commit upstream froze at after its pull
# requests 6 and 7 (RFC 0017, "Decided"). The commit must be the branch's tip or reachable from
# it, else the run stops before anything is merged.
# It clones the source into a temporary folder, rewrites THAT clone with
# `git filter-repo --to-subdirectory-filter meter/usagemeter` (never this repository), and merges
# the result here with `--no-ff --allow-unrelated-histories`. Tags are not fetched: the old
# repository's v0.N.0 tags are not releases of this one. Every upstream commit comes in, the first
# nine (from automagik-pocket's meter/) included (RFC 0017, question 2).
#
# Re-runnable: filter-repo is deterministic, so the commits already imported get the same ids
# again and a re-run with the same commit says it is already imported. Files this repository
# dropped after the import (upstream's .github/, .herdr/, LICENSE and scripts/version.sh) are not
# brought back by a re-run of the same commit.
#
# Needs git-filter-repo (`brew install git-filter-repo` or `pip install git-filter-repo`).
set -euo pipefail

SOURCE=${1:-https://github.com/automagik-si/usagemeter.git}
BRANCH=${2:-dev}
COMMIT=${3:-61165ba1959c71b095c191c315850d81a00507a3}
PREFIX=meter/usagemeter

command -v git-filter-repo >/dev/null 2>&1 || { echo "git-filter-repo is missing: brew install git-filter-repo" >&2; exit 1; }
ROOT=$(git rev-parse --show-toplevel)
cd "${ROOT}"
[[ -z "$(git status --porcelain)" ]] || { echo "the working tree is not clean: commit or put the changes aside first" >&2; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/import-usagemeter.XXXXXX")
trap 'rm -rf "${TMP}"' EXIT

git clone -q --no-tags --single-branch --branch "${BRANCH}" "${SOURCE}" "${TMP}/src"
git -C "${TMP}/src" merge-base --is-ancestor "${COMMIT}" HEAD 2>/dev/null \
  || { echo "${COMMIT} is not on ${BRANCH} of ${SOURCE}: refusing to import" >&2; exit 1; }
# The temporary clone only: its branch moves back to the pinned commit.
git -C "${TMP}/src" reset -q --hard "${COMMIT}"
SOURCE_COMMIT=$(git -C "${TMP}/src" rev-parse HEAD)

# Private data never comes in: a database, a key or an .env anywhere in the source's history
# (merged lines included) stops the run.
if git -C "${TMP}/src" log --format= --name-only HEAD | sort -u | grep -E '(^|/)(genie\.db|[^/]*\.(db|sqlite|pem|p12|key|jks|keystore)|\.env(\..*)?|local\.properties|signing\.properties)$'; then
  echo "the source's history holds the files above: refusing to import it" >&2
  exit 1
fi

# filter-repo rewrites the repository it runs in: make sure that is the temporary clone.
[[ "$(git -C "${TMP}/src" rev-parse --show-toplevel)" == "$(cd "${TMP}/src" && pwd -P)" ]] || { echo "not the temporary clone" >&2; exit 1; }
(cd "${TMP}/src" && git filter-repo --quiet --force --to-subdirectory-filter "${PREFIX}")
FILTERED=$(git -C "${TMP}/src" rev-parse HEAD)

git fetch -q --no-tags "${TMP}/src" "${FILTERED}"
if git merge-base --is-ancestor "${FILTERED}" HEAD; then
  echo "usagemeter ${BRANCH} at ${SOURCE_COMMIT} (${FILTERED} here) is already imported"
  exit 0
fi
git merge --no-ff --allow-unrelated-histories \
  -m "feat(meter): import usagemeter ${BRANCH} at ${SOURCE_COMMIT:0:12} under meter/usagemeter/" \
  -m "Source: ${SOURCE} ${BRANCH}
at ${SOURCE_COMMIT},
history kept (scripts/import-usagemeter.sh, RFC 0017 delivery 2)." "${FILTERED}"
echo "imported usagemeter ${BRANCH} at ${SOURCE_COMMIT} as ${FILTERED}"
