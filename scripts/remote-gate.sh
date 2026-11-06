#!/usr/bin/env bash
# Run one gate on a pull request or a commit, once, in a throwaway git worktree of a local clone,
# and print its test counts. Made for a shared Linux box that runs the gates the Mac should not.
#
#   remote-gate.sh --pr 123 herdr            the herdr pack's gate (AGENTS.md), per Node version
#   remote-gate.sh --sha 1a2b3c4 plugin bots-dsh   a plugin's install, lint and node --test
#   remote-gate.sh --sha 1a2b3c4 bun          the repository's bun run check
#
# The ref is fetched read-only from REMOTE_GATE_REMOTE into refs/remote-gate/, checked out in a
# detached worktree, and the worktree is removed on any exit (git worktree remove --force, then
# prune). At most REMOTE_GATE_SLOTS gates run at once (mkdir slots); a gate waits for a free slot
# up to REMOTE_GATE_LOCK_TIMEOUT seconds, then gives up. Each step's full output goes to a log
# folder that is kept; the screen gets one line per step and the counts.
#
# Environment (all optional):
#   REMOTE_GATE_ENV            a file sourced first (PATH, NVM_DIR, the variables below)
#   REMOTE_GATE_REPO           the clone (default: the checkout holding this script)
#   REMOTE_GATE_BASE           worktrees, locks and logs (default: <repo>/.remote-gate)
#   REMOTE_GATE_REMOTE         remote to fetch from (default: origin)
#   REMOTE_GATE_SLOTS          gates at once (default: 3)
#   REMOTE_GATE_LOCK_TIMEOUT   seconds to wait for a slot (default: 1800)
#   REMOTE_GATE_NODE_VERSIONS  herdr gate's Node versions, nvm-installed (default: "24 22 24.9.0")
#   REMOTE_GATE_PLUGIN_NODE    Node for the plugin and bun gates (default: 24.9, as CI)
#   REMOTE_GATE_TEST_CONCURRENCY  herdr node --test concurrency (default: 8)
#   NVM_DIR                    where nvm keeps Node (default: $HOME/.nvm)
#
# The herdr gate leaves out test/am-quota-write.test.mjs and scripts/usagemeter-pin.mjs (it
# reads a release over the network). The plugin gate does not fetch Omni for welcome-dsh, and
# runs the browser layout check only where CHROME_BIN names a browser.
set -euo pipefail
# As on a Mac and on CI's runners. Under a 002 umask (one group per user, common on Linux) the
# tests' fixture files come out group-writable, and the worker refuses to read those.
umask 022

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

if [ -n "${REMOTE_GATE_ENV:-}" ]; then
  # shellcheck source=/dev/null
  . "$REMOTE_GATE_ENV"
fi

kind=''
ref=''
while [ $# -gt 0 ]; do
  case $1 in
    --pr | --sha)
      [ $# -ge 2 ] || usage
      kind=${1#--}
      ref=$2
      shift 2
      ;;
    -h | --help) usage ;;
    *) break ;;
  esac
done
gate=${1:-}
app=${2:-${REMOTE_GATE_APP:-bots-dsh}}

case $kind in
  pr) [[ $ref =~ ^[0-9]+$ ]] || usage ;;
  sha) [[ $ref =~ ^[0-9a-f]{7,40}$ ]] || usage ;;
  *) usage ;;
esac
case $gate in
  herdr | bun) ;;
  plugin) [[ $app =~ ^[a-z0-9-]+$ ]] || usage ;;
  *) usage ;;
esac

script_dir=$(cd "$(dirname "$0")" && pwd)
repo=${REMOTE_GATE_REPO:-$(git -C "$script_dir" rev-parse --show-toplevel)}
base=${REMOTE_GATE_BASE:-$repo/.remote-gate}
remote=${REMOTE_GATE_REMOTE:-origin}
slots=${REMOTE_GATE_SLOTS:-3}
lock_timeout=${REMOTE_GATE_LOCK_TIMEOUT:-1800}
node_versions=${REMOTE_GATE_NODE_VERSIONS:-24 22 24.9.0}
plugin_node=${REMOTE_GATE_PLUGIN_NODE:-24.9}
concurrency=${REMOTE_GATE_TEST_CONCURRENCY:-8}
nvm_dir=${NVM_DIR:-$HOME/.nvm}
lock_dir=$base/locks
git_lock=$lock_dir/git

slot=''
wt=''
held_git=''
failed=0
summary=()
started=$SECONDS

say() { printf 'remote-gate: %s\n' "$*"; }
load() { cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || uptime | sed 's/.*load averages*: //'; }

# The newest nvm-installed Node matching a version prefix (24, 24.9, 24.9.0), as its bin folder.
node_bin() {
  local spec=$1 d best
  best=$(for d in "$nvm_dir/versions/node/v$spec" "$nvm_dir/versions/node/v$spec".*; do
    if [ -x "$d/bin/node" ]; then printf '%s\n' "$d"; fi
  done | sort -V | tail -n 1)
  if [ -z "$best" ]; then
    say "no Node $spec under $nvm_dir/versions/node" >&2
    return 1
  fi
  printf '%s/bin\n' "$best"
}

# A short mutex for the clone's fetch and worktree bookkeeping, shared by every slot.
git_lock_take() {
  local deadline=$((SECONDS + 120))
  until mkdir "$git_lock" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      say "the clone's git lock ($git_lock) is held for 120 s; remove it if no gate is running" >&2
      return 1
    fi
    sleep 1
  done
  held_git=1
}
git_lock_drop() {
  if [ -n "$held_git" ]; then rmdir "$git_lock" 2>/dev/null || true; fi
  held_git=''
}

# One of the box's gate slots. A slot whose owner is gone (its pid no longer runs) is reclaimed.
slot_take() {
  local deadline=$((SECONDS + lock_timeout)) i dir pid again waited=''
  mkdir -p "$lock_dir"
  while :; do
    for i in $(seq 1 "$slots"); do
      dir=$lock_dir/slot-$i
      if mkdir "$dir" 2>/dev/null; then
        echo $$ >"$dir/pid"
        slot=$dir
        say "slot $i of $slots (pid $$)"
        return 0
      fi
      pid=$(cat "$dir/pid" 2>/dev/null || true)
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        again=$(cat "$dir/pid" 2>/dev/null || true)
        if [ "$again" = "$pid" ]; then
          say "reclaiming slot $i from gone pid $pid"
          rm -rf "$dir"
        fi
      fi
    done
    if [ "$SECONDS" -ge "$deadline" ]; then
      say "all $slots slots busy for $lock_timeout s; giving up" >&2
      return 1
    fi
    if [ -z "$waited" ]; then
      say "all $slots slots busy; waiting up to $lock_timeout s"
      waited=1
    fi
    sleep 5
  done
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  git_lock_drop
  if [ -n "$wt" ]; then
    cd / || true
    git_lock_take || true
    git -C "$repo" worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"
    git -C "$repo" worktree prune
    git_lock_drop
    say "worktree removed"
  fi
  if [ -n "$slot" ] && [ "$(cat "$slot/pid" 2>/dev/null)" = "$$" ]; then rm -rf "$slot"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Run one step with its output in the log folder; one line per step, the log's tail on failure.
step() {
  local name=$1 log rc=0 t0=$SECONDS
  shift
  log=$logs/$name.log
  "$@" >"$log" 2>&1 || rc=$?
  say "step $name: exit $rc, $((SECONDS - t0)) s"
  if [ "$rc" -ne 0 ]; then
    failed=1
    if grep -qE '^not ok ' "$log"; then
      grep -E '^not ok ' "$log" | head -n 20
      grep -m 3 -A 8 -E '^not ok ' "$log" | grep -E '^ +(location|error):|^    [^ ]' | head -n 12 \
        | sed 's/^/  | /'
    else
      tail -n 25 "$log" | sed 's/^/  | /'
    fi
  fi
  return 0
}

# Counts from node --test output, TAP (# tests 12) or spec (a glyph, tests 12); the last one wins.
node_counts() {
  LC_ALL=C awk '/^[^ \t]/ && NF == 3 && $2 ~ /^(tests|pass|fail|skipped|todo|cancelled)$/ \
         && $3 ~ /^[0-9]+$/ && $1 !~ /^[[:alnum:]]/ { c[$2] = $3 }
       END { printf "tests=%d pass=%d fail=%d skip=%d todo=%d cancelled=%d", \
         c["tests"], c["pass"], c["fail"], c["skipped"], c["todo"], c["cancelled"] }' "$1"
}

# Counts from bun test's summary (" 12 pass", "Ran 14 tests across 3 files.").
bun_counts() {
  awk '$1 ~ /^[0-9]+$/ && NF == 2 && $2 ~ /^(pass|fail|skip|todo)$/ { c[$2] = $1 }
       $1 == "Ran" && $3 ~ /^tests?$/ && $4 == "across" { t = $2; f = $5 }
       END { printf "files=%d tests=%d pass=%d fail=%d skip=%d todo=%d", \
         f, t, c["pass"], c["fail"], c["skip"], c["todo"] }' "$1"
}

record() {
  local line=$1
  summary+=("$line")
  say "$line"
}

herdr_syntax() {
  local f rc=0 n=0
  for f in mods/*/*.js mods/*/*.mjs mods/*/bin/*.mjs mods/*/pack/*.mjs scripts/*.mjs scripts/*/*.mjs; do
    [ -e "$f" ] || continue
    n=$((n + 1))
    node --check "$f" || { echo "node --check failed: $f"; rc=1; }
  done
  echo "node --check: $n files"
  sh -n install.sh || rc=1
  sh -n mods/am-sidebar/bin/run.sh || rc=1
  sh -n mods/am-sidebar/bin/automagik-herdr || rc=1
  shellcheck -s sh install.sh mods/am-sidebar/bin/run.sh mods/am-sidebar/bin/automagik-herdr || rc=1
  return "$rc"
}

gate_herdr() {
  local files=() f v bin ver t0
  cd "$wt/herdr"
  for f in test/*.test.mjs; do
    [ "$f" = test/am-quota-write.test.mjs ] || files+=("$f")
  done
  say "herdr: ${#files[@]} test files (test/am-quota-write.test.mjs left out)"
  for v in $node_versions; do
    bin=$(node_bin "$v")
    ver=$("$bin/node" --version)
    t0=$SECONDS
    step "test-node-$ver" env PATH="$bin:$PATH" node --test --test-reporter=tap \
      --test-concurrency="$concurrency" "${files[@]}"
    record "gate=herdr node=$ver files=${#files[@]} $(node_counts "$logs/test-node-$ver.log") wall=$((SECONDS - t0))s"
  done
  bin=$(node_bin "${node_versions%% *}")
  export PATH="$bin:$PATH"
  step syntax herdr_syntax
  step privacy node scripts/privacy-check.mjs
  step catalog node scripts/catalog.mjs --check
  step version node scripts/version.mjs check
  step entries node scripts/entries.mjs --check
  step parts node scripts/parts.mjs --check
  step am-copies node ../scripts/am-copies.mjs --check
}

gate_plugin() {
  local dir=$wt/apps/$app bin n t0
  [ -f "$dir/package.json" ] || { say "no plugin at apps/$app" >&2; return 1; }
  cd "$dir"
  bin=$(node_bin "$plugin_node")
  export PATH="$bin:$PATH"
  unset CI GITHUB_ACTIONS
  step install bun install --frozen-lockfile
  if grep -q '"harness"' package.json && [ ! -d dev/harness/node_modules ]; then
    step harness bun run harness
  fi
  if [ -f scripts/build-client.mjs ]; then step client node scripts/build-client.mjs --check; fi
  step lint bun run lint
  n=$(find test -maxdepth 1 -name '*.test.js' | wc -l | tr -d ' ')
  t0=$SECONDS
  step test bun run test
  record "gate=plugin app=$app node=$(node --version) files=$n $(node_counts "$logs/test.log") wall=$((SECONDS - t0))s"
}

gate_bun() {
  local bin t0
  cd "$wt"
  bin=$(node_bin "$plugin_node")
  export PATH="$bin:$PATH"
  step install bun install --frozen-lockfile --ignore-scripts
  t0=$SECONDS
  step check bun run check
  record "gate=bun node=$(node --version) bun=$(bun --version) $(bun_counts "$logs/check.log") wall=$((SECONDS - t0))s"
}

slot_take

git_lock_take
if [ "$kind" = pr ]; then
  git -C "$repo" -c gc.auto=0 fetch -q --no-write-fetch-head "$remote" \
    "+refs/pull/$ref/head:refs/remote-gate/pr-$ref"
  sha=$(git -C "$repo" rev-parse --verify "refs/remote-gate/pr-$ref^{commit}")
else
  if ! git -C "$repo" cat-file -e "$ref^{commit}" 2>/dev/null; then
    git -C "$repo" -c gc.auto=0 fetch -q --no-write-fetch-head "$remote"
  fi
  if ! git -C "$repo" cat-file -e "$ref^{commit}" 2>/dev/null && [ ${#ref} -eq 40 ]; then
    git -C "$repo" -c gc.auto=0 fetch -q --no-write-fetch-head "$remote" "$ref"
  fi
  sha=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
  git -C "$repo" update-ref "refs/remote-gate/sha-$sha" "$sha"
fi
mkdir -p "$base/worktrees"
wt=$base/worktrees/$gate-${sha:0:12}-$$
git -C "$repo" worktree add -q --detach "$wt" "$sha"
git_lock_drop

logs=$base/logs/$gate-${sha:0:12}-$(date +%Y%m%d-%H%M%S)-$$
mkdir -p "$logs"
say "gate=$gate $kind $ref at $sha"
say "logs in $logs"
say "load before: $(load)"

"gate_$gate"

say "load after: $(load)"
for line in ${summary[@]+"${summary[@]}"}; do say "summary $line"; done
if [ "$failed" -ne 0 ]; then
  say "gate=$gate sha=${sha:0:12} FAIL in $((SECONDS - started)) s"
  exit 1
fi
say "gate=$gate sha=${sha:0:12} PASS in $((SECONDS - started)) s"
