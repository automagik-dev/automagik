#!/usr/bin/env bash
# Staple and validate a notarized macOS artifact, retrying only Apple's transient network errors.
#
#   scripts/staple-retry.sh <artifact>
#
# The artifact is a notarized .app bundle or .dmg: `xcrun stapler` handles both. On macOS the
# updater's zip is packed from the .app, so the .app is stapled first (the build's afterSign hook,
# apps/desktop/scripts/after-sign.cjs) and the dmg later (the workflow).
#
# `xcrun stapler staple` asks Apple's notary service for the ticket (api.apple-cloudkit.com), and
# `xcrun stapler validate` asks again. A dropped connection there says nothing about the artifact:
# the notarization already succeeded, and the same command on the same bytes works on the next
# try. This runs the staple/validate round-trip up to 3 times, waiting 10 s, 30 s and then 90 s
# (the last wait is before the re-staple pass), and only when the failure's TOP-LEVEL NSError pair
# has a domain AND code in the transient set:
#
#   NSURLErrorDomain -1001 (timed out), -1004 (cannot connect), -1005 (connection lost),
#   -1009 (offline)
#   kCFErrorDomainCFNetwork, the same codes: a direct CFNetwork connection failure is the same
#   transient failure, and it is also the NSUnderlyingError of the NSURLErrorDomain one.
#
# NSError nests its underlying error in the outer UserInfo (`NSUnderlyingError=0x... {Error
# Domain=... Code=...}`); only the top-level pairs decide a retry, so the nested CFNetwork pair of
# the real -1005 is part of the same transient failure, not a refusal reason.
#
# Any other top-level domain or code, a missing or unparsable domain/code, `status: Invalid`, and
# every other failure (a real rejection, a missing stapler, a bad artifact) fails on the first
# response and is never retried. The error output stays in the log. After the three attempts, one
# re-staple pass (staple again, then validate; stapling is idempotent) runs before the final
# failure: the artifact is already notarized, so there is no re-notarization and no rebuild.
#
# Every attempt logs its number, the parsed Domain/Code, and the action taken (retry in Ns,
# non-transient -> fail, re-staple, success), so the job log alone diagnoses the step.
#
# Environment:
#   STAPLE_RETRY_DELAYS  three space-separated whole seconds, the wait after attempts 1-3
#                        (default: "10 30 90"; a test passes "0 0 0" to stay fast)
set -euo pipefail

readonly MAX_ATTEMPTS=3
readonly TRANSIENT_DOMAIN="NSURLErrorDomain"
readonly CFNETWORK_DOMAIN="kCFErrorDomainCFNetwork"
readonly TRANSIENT_CODES=(-1001 -1004 -1005 -1009)

die() {
  echo "::error::[staple-retry] $*" >&2
  exit 2
}

if [[ $# -ne 1 || -z ${1:-} ]]; then
  die "usage: $0 <artifact>"
fi
artifact=$1
# A file (.dmg) or a directory (.app bundle): stapler takes either.
[[ -e ${artifact} ]] || die "artifact not found: ${artifact}"
command -v xcrun >/dev/null 2>&1 || die "xcrun is not on PATH"

IFS=' ' read -r -a delays <<< "${STAPLE_RETRY_DELAYS:-10 30 90}"
if (( ${#delays[@]} != MAX_ATTEMPTS )); then
  die "STAPLE_RETRY_DELAYS must hold ${MAX_ATTEMPTS} delays, got '${STAPLE_RETRY_DELAYS:-}'"
fi
for delay in "${delays[@]}"; do
  [[ ${delay} =~ ^[0-9]+$ ]] || die "STAPLE_RETRY_DELAYS must hold whole seconds, got '${STAPLE_RETRY_DELAYS:-}'"
done

step_output=""
last_stage=""
last_status=0
failure_reason=""
error_domains=()
error_codes=()
error_levels=()

# Run one command, keep its stdout and stderr in step_output and still print them, and return its
# exit status.
capture() {
  local status=0
  step_output=$("$@" 2>&1) || status=$?
  [[ -z ${step_output} ]] || printf '%s\n' "${step_output}"
  return "${status}"
}

# Run the round-trip: staple, then validate. A failure leaves the failing stage in last_stage, its
# exit status in last_status, and its combined output in step_output.
run_round_trip() {
  local stage status
  for stage in staple validate; do
    last_stage=${stage}
    status=0
    capture xcrun stapler "${stage}" "${artifact}" || status=$?
    if (( status != 0 )); then
      last_status=${status}
      return "${status}"
    fi
  done
  return 0
}

# Collect every `Domain=<domain> Code=<code>` and `(<domain> error <code>.)` pair in step_output
# into error_domains/error_codes, with `top` or `nested` in error_levels. The outer NSError opens
# its UserInfo with `{`, and an underlying error is another pair inside it, so brace depth tells
# the top-level pair (the one that decides a retry) from the nested one. The domain and the code
# are what decide a retry; free text such as "The network connection was lost" does not.
collect_error_pairs() {
  local line rest match prefix inner i ch depth=0
  error_domains=()
  error_codes=()
  error_levels=()
  while IFS= read -r line || [[ -n ${line} ]]; do
    rest=${line}
    while [[ ${rest} =~ (Domain=[A-Za-z0-9_.-]+[[:space:]]+Code=-?[0-9]+|\([A-Za-z0-9_.-]+[[:space:]]+error[[:space:]]+-?[0-9]+\.?\)) ]]; do
      match=${BASH_REMATCH[0]}
      prefix=${rest%%"${match}"*}
      for ((i = 0; i < ${#prefix}; i++)); do
        ch=${prefix:i:1}
        if [[ ${ch} == '{' ]]; then
          depth=$((depth + 1))
        elif [[ ${ch} == '}' ]]; then
          depth=$((depth - 1))
        fi
      done
      if [[ ${match} == Domain=* ]]; then
        inner=${match#Domain=}
        error_domains+=("${inner%%[[:space:]]*}")
        error_codes+=("${match##*Code=}")
      else
        inner=${match#(}
        inner=${inner%)}
        inner=${inner%.}
        error_domains+=("${inner%% error *}")
        error_codes+=("${inner##* error }")
      fi
      if (( depth == 0 )); then
        error_levels+=("top")
      else
        error_levels+=("nested")
      fi
      rest=${rest#*"${match}"}
    done
    for ((i = 0; i < ${#rest}; i++)); do
      ch=${rest:i:1}
      if [[ ${ch} == '{' ]]; then
        depth=$((depth + 1))
      elif [[ ${ch} == '}' ]]; then
        depth=$((depth - 1))
      fi
    done
  done <<< "${step_output}"
}

log_parsed_errors() {
  local i
  if (( ${#error_domains[@]} == 0 )); then
    echo "::notice::[staple-retry] no error Domain/Code parsed from the output"
    return 0
  fi
  for i in "${!error_domains[@]}"; do
    echo "::notice::[staple-retry] parsed Domain=${error_domains[i]} Code=${error_codes[i]}"
  done
}

is_transient_code() {
  local code=$1 candidate
  for candidate in "${TRANSIENT_CODES[@]}"; do
    [[ ${code} == "${candidate}" ]] && return 0
  done
  return 1
}

is_transient_domain() {
  local domain=$1
  [[ ${domain} == "${TRANSIENT_DOMAIN}" || ${domain} == "${CFNETWORK_DOMAIN}" ]]
}

# Return 0 only when step_output holds at least one TOP-LEVEL error pair and every top-level pair
# is a transient network failure. A pair nested inside the outer UserInfo/NSUnderlyingError is
# part of that same failure and does not decide the retry. Otherwise set failure_reason and
# return 1.
classify_failure() {
  local i top_level_pairs=0
  collect_error_pairs
  log_parsed_errors
  failure_reason=""
  if grep -qiE 'status:[[:space:]]*invalid' <<< "${step_output}"; then
    failure_reason="notary status: Invalid is a rejection"
    return 1
  fi
  for ((i = 0; i < ${#error_domains[@]}; i++)); do
    if [[ ${error_levels[i]} == top ]]; then
      top_level_pairs=$((top_level_pairs + 1))
    fi
  done
  if (( top_level_pairs == 0 )); then
    failure_reason="the output has no parsable top-level error Domain/Code"
    return 1
  fi
  for ((i = 0; i < ${#error_domains[@]}; i++)); do
    [[ ${error_levels[i]} == top ]] || continue
    if ! is_transient_domain "${error_domains[i]}"; then
      failure_reason="top-level Domain=${error_domains[i]} Code=${error_codes[i]} is not a transient network domain (not ${TRANSIENT_DOMAIN}/${CFNETWORK_DOMAIN})"
      return 1
    fi
    if ! is_transient_code "${error_codes[i]}"; then
      failure_reason="top-level Domain=${error_domains[i]} Code=${error_codes[i]} is not transient (not ${TRANSIENT_CODES[*]})"
      return 1
    fi
  done
  return 0
}

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  echo "::notice::[staple-retry] attempt ${attempt}/${MAX_ATTEMPTS}: xcrun stapler staple + validate ${artifact}"
  if run_round_trip; then
    echo "::notice::[staple-retry] attempt ${attempt}/${MAX_ATTEMPTS} succeeded: staple and validate"
    exit 0
  fi
  echo "::warning::[staple-retry] attempt ${attempt}/${MAX_ATTEMPTS} failed at 'stapler ${last_stage}' (exit ${last_status})"
  if ! classify_failure; then
    echo "::error::[staple-retry] attempt ${attempt}/${MAX_ATTEMPTS}: ${failure_reason}; failing on the first response, not retrying"
    exit 1
  fi
  delay=${delays[attempt - 1]}
  if (( attempt < MAX_ATTEMPTS )); then
    echo "::warning::[staple-retry] attempt ${attempt}/${MAX_ATTEMPTS}: transient network failure; retrying in ${delay}s"
  else
    echo "::warning::[staple-retry] attempt ${attempt}/${MAX_ATTEMPTS}: transient network failure; waiting ${delay}s, then one re-staple pass"
  fi
  sleep "${delay}"
done

echo "::notice::[staple-retry] re-staple pass: staple ${artifact} again, then validate"
if run_round_trip; then
  echo "::notice::[staple-retry] re-staple pass succeeded: staple and validate"
  exit 0
fi
echo "::warning::[staple-retry] re-staple pass failed at 'stapler ${last_stage}' (exit ${last_status})"
if classify_failure; then
  echo "::warning::[staple-retry] the re-staple pass failed with a transient network error too"
else
  echo "::warning::[staple-retry] the re-staple pass failed: ${failure_reason}"
fi
echo "::error::[staple-retry] giving up after ${MAX_ATTEMPTS} transient attempts and one re-staple pass"
exit 1
