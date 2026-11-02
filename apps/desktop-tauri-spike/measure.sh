#!/bin/bash
# Launch the spike once, measure, and stop everything it started.
#   measure.sh <app binary> <home> [idle seconds] [extra env assignments...]
# Prints the [spike] timeline, then RSS (KB) of: the app, DSH and its children, and the WebKit
# XPC processes that appeared after launch (WebKit's processes are launchd's children, not the
# app's, so they are told apart by a before/after snapshot).
set -u
BIN=$1; HOME_DIR=$2; IDLE=${3:-20}; shift 3 || shift $#
LOG="$HOME_DIR.log"
mkdir -p "$HOME_DIR"
webkit() { ps -axo pid=,comm= | awk '/com\.apple\.WebKit\./ {print $1}' | sort; }
before=$(webkit)
if [[ "$BIN" == *.app ]]; then
  # Like a person opening it: Launch Services, a bare PATH, the window in front.
  args=(); for kv in SPIKE_HOME="$HOME_DIR" "$@"; do args+=(--env "$kv"); done
  : >"$LOG"
  open -n --stdout "$LOG" --stderr "$LOG" "${args[@]}" "$BIN"
  for _ in $(seq 1 50); do APP=$(pgrep -n -f "$BIN/Contents/MacOS/") && break; sleep 0.1; done
else
  env SPIKE_HOME="$HOME_DIR" "$@" "$BIN" >"$LOG" 2>&1 &
  APP=$!
fi
echo "app pid $APP, log $LOG"
# Wait (bounded, 120 s) for the page to report itself visible, or for the app to die.
for _ in $(seq 1 1200); do
  grep -q "bridge visible\|bridge visible-timeout" "$LOG" && break
  kill -0 "$APP" 2>/dev/null || { echo "app exited early"; break; }
  sleep 0.1
done
grep "^\[spike\]" "$LOG" | sed -E 's/token=[^ "]+/token=…/g'
sleep "$IDLE"
DSH=$(cat "$HOME_DIR/dsh.pid" 2>/dev/null)
tree() { local p=$1; echo "$p"; for c in $(pgrep -P "$p"); do tree "$c"; done; }
new_webkit=$(comm -13 <(echo "$before") <(webkit))
rss() { ps -o rss= -p "$1" 2>/dev/null | tr -d ' '; }
total=0
line() { local label=$1 pid=$2 r; r=$(rss "$pid"); [ -n "$r" ] || return; total=$((total + r)); printf "%-10s %7s KB  %s\n" "$label" "$r" "$(ps -o command= -p "$pid" | cut -c1-110)"; }
echo "--- RSS after ${IDLE}s idle"
line app "$APP"
if [ -n "$DSH" ]; then for p in $(tree "$DSH"); do line dsh "$p"; done; fi
for p in $new_webkit; do line webkit "$p"; done
echo "TOTAL_RSS_KB $total"
echo "--- stopping"
kill -TERM "$APP" 2>/dev/null
for _ in $(seq 1 120); do kill -0 "$APP" 2>/dev/null || break; sleep 0.1; done
kill -0 "$APP" 2>/dev/null && { echo "app still up, SIGKILL"; kill -KILL "$APP"; }
[ -n "$DSH" ] && kill -0 "$DSH" 2>/dev/null && { echo "dsh still up, stopping it"; kill -TERM "$DSH"; sleep 2; kill -KILL "$DSH" 2>/dev/null; }
grep -E "dsh stopped|dsh killed" "$LOG"
echo done
