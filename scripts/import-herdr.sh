#!/usr/bin/env bash
# Imports automagik-dev/automagik-herdr (branch dev) under herdr/, with its history, into the
# branch checked out here (docs/rfcs/0010-monorepo-parts-and-releases.md).
#
#   scripts/import-herdr.sh [<source>] [<branch>]
#
# <source> defaults to https://github.com/automagik-dev/automagik-herdr.git, <branch> to dev.
# It clones the source into a temporary folder, rewrites THAT clone with
# `git filter-repo --to-subdirectory-filter herdr` (never this repository), and merges the result
# here with `--allow-unrelated-histories`. Tags are not fetched: the old repo's v0.N.P tags are not
# releases of this one.
#
# Re-runnable until the cutover: filter-repo is deterministic, so the commits already imported get
# the same ids again and a re-run merges only the source's newer commits. A conflict with what this
# repository changed under herdr/ since (the workflows it retired, the pack pointed at this
# repository) stops the run with the merge in progress: resolve it by hand (keep this repository's
# side for herdr/.github, deleted here) and commit.
#
# Needs git-filter-repo (`brew install git-filter-repo` or `pip install git-filter-repo`).
set -euo pipefail

SOURCE=${1:-https://github.com/automagik-dev/automagik-herdr.git}
BRANCH=${2:-dev}
PREFIX=herdr

command -v git-filter-repo >/dev/null 2>&1 || { echo "git-filter-repo is missing: brew install git-filter-repo" >&2; exit 1; }
ROOT=$(git rev-parse --show-toplevel)
cd "${ROOT}"
[[ -z "$(git status --porcelain)" ]] || { echo "the working tree is not clean: commit or put the changes aside first" >&2; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/import-herdr.XXXXXX")
trap 'rm -rf "${TMP}"' EXIT

git clone -q --no-tags --single-branch --branch "${BRANCH}" "${SOURCE}" "${TMP}/src"
SOURCE_COMMIT=$(git -C "${TMP}/src" rev-parse HEAD)

# Private data never comes in: a database or a secret anywhere in the source's history stops the run.
if git -C "${TMP}/src" log --format= --name-only HEAD | sort -u | grep -E '(^|/)(genie\.db|[^/]*\.(db|sqlite|pem|p12|key)|\.env(\..*)?)$'; then
  echo "the source's history holds the files above: refusing to import it" >&2
  exit 1
fi

# filter-repo rewrites the repository it runs in: make sure that is the temporary clone.
[[ "$(git -C "${TMP}/src" rev-parse --show-toplevel)" == "$(cd "${TMP}/src" && pwd -P)" ]] || { echo "not the temporary clone" >&2; exit 1; }
(cd "${TMP}/src" && git filter-repo --quiet --force --to-subdirectory-filter "${PREFIX}")
FILTERED=$(git -C "${TMP}/src" rev-parse HEAD)

git fetch -q --no-tags "${TMP}/src" "${FILTERED}"
if git merge-base --is-ancestor "${FILTERED}" HEAD; then
  echo "automagik-herdr ${BRANCH} at ${SOURCE_COMMIT} (${FILTERED} here) is already imported"
  exit 0
fi
git merge --no-ff --allow-unrelated-histories -m "feat(herdr): import automagik-herdr ${BRANCH} at ${SOURCE_COMMIT:0:12} under herdr/" \
  -m "Source: ${SOURCE} ${BRANCH} at ${SOURCE_COMMIT}, history kept (scripts/import-herdr.sh)." "${FILTERED}"
echo "imported automagik-herdr ${BRANCH} at ${SOURCE_COMMIT} as ${FILTERED}"
