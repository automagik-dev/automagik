#!/usr/bin/env bash
# Imports automagik-dev/automagik-pocket (branch dev) with its history into the branch checked out
# here (docs/rfcs/0011-monorepo-parts-and-releases.md, "Pocket"): the phone app and its docs under
# apps/pocket/, Pocket Link (desktop/pocket-link/) under herdr/mods/pocket-link/, its README, recipe,
# keys, licence and preview beside the mod, the way the pack's own mods keep theirs.
#
#   scripts/import-pocket.sh [<source>] [<branch>]
#
# <source> defaults to https://github.com/automagik-dev/automagik-pocket.git, <branch> to dev.
# It clones the source into a temporary folder, rewrites THAT clone with `git filter-repo` (never
# this repository), and merges the result here with `--allow-unrelated-histories`. Tags are not
# fetched: the old repo's v0.N.0 tags are not releases of this one.
#
# Re-runnable until the cutover: filter-repo is deterministic, so the commits already imported get
# the same ids again and a re-run merges only the source's newer commits. A conflict with what this
# repository changed since (the workflows it retired, version.properties it dropped, the URLs it
# repointed) stops the run with the merge in progress: resolve it by hand (keep this repository's
# side) and commit.
#
# Needs git-filter-repo (`brew install git-filter-repo` or `pip install git-filter-repo`).
set -euo pipefail

SOURCE=${1:-https://github.com/automagik-dev/automagik-pocket.git}
BRANCH=${2:-dev}
PREFIX=apps/pocket
LINK=herdr/mods/pocket-link

command -v git-filter-repo >/dev/null 2>&1 || { echo "git-filter-repo is missing: brew install git-filter-repo" >&2; exit 1; }
ROOT=$(git rev-parse --show-toplevel)
cd "${ROOT}"
[[ -z "$(git status --porcelain)" ]] || { echo "the working tree is not clean: commit or put the changes aside first" >&2; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/import-pocket.XXXXXX")
trap 'rm -rf "${TMP}"' EXIT

git clone -q --no-tags --single-branch --branch "${BRANCH}" "${SOURCE}" "${TMP}/src"
SOURCE_COMMIT=$(git -C "${TMP}/src" rev-parse HEAD)

# Private data never comes in: a database, a signing key or a machine's properties anywhere in the
# source's history (merged lines included) stops the run.
if git -C "${TMP}/src" log --all --format= --name-only | sort -u | grep -E '(^|/)(genie\.db|[^/]*\.(db|sqlite|pem|p12|key|jks|keystore)|\.env(\..*)?|local\.properties|signing\.properties)$'; then
  echo "the source's history holds the files above: refusing to import it" >&2
  exit 1
fi

# filter-repo rewrites the repository it runs in: make sure that is the temporary clone.
[[ "$(git -C "${TMP}/src" rev-parse --show-toplevel)" == "$(cd "${TMP}/src" && pwd -P)" ]] || { echo "not the temporary clone" >&2; exit 1; }
# Everything under apps/pocket/ first; then Pocket Link out of it, beside the pack's mods. The mod's
# own folder goes first (desktop/pocket-link/mods/pocket-link/, and mods/pocket-link/ at the root of
# the old automagik-pocket-link history a subtree merge brought in), then the files around it.
(cd "${TMP}/src" && git filter-repo --quiet --force --to-subdirectory-filter "${PREFIX}")
(cd "${TMP}/src" && git filter-repo --quiet --force \
  --path-rename "${PREFIX}/desktop/pocket-link/mods/pocket-link/:${LINK}/" \
  --path-rename "${PREFIX}/desktop/pocket-link/:${LINK}/" \
  --path-rename "${PREFIX}/mods/pocket-link/:${LINK}/" \
  --path-rename "${PREFIX}/RECIPE.md:${LINK}/RECIPE.md" \
  --path-rename "${PREFIX}/keys.json:${LINK}/keys.json" \
  --path-rename "${PREFIX}/preview.png:${LINK}/preview.png")
FILTERED=$(git -C "${TMP}/src" rev-parse HEAD)

git fetch -q --no-tags "${TMP}/src" "${FILTERED}"
if git merge-base --is-ancestor "${FILTERED}" HEAD; then
  echo "automagik-pocket ${BRANCH} at ${SOURCE_COMMIT} (${FILTERED} here) is already imported"
  exit 0
fi
git merge --no-ff --allow-unrelated-histories -m "feat(pocket): import automagik-pocket ${BRANCH} at ${SOURCE_COMMIT:0:12} into apps/pocket/ and herdr/mods/" \
  -m "Source: ${SOURCE} ${BRANCH} at ${SOURCE_COMMIT}, history kept (scripts/import-pocket.sh)." "${FILTERED}"
echo "imported automagik-pocket ${BRANCH} at ${SOURCE_COMMIT} as ${FILTERED}"
