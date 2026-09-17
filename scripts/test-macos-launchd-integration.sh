#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != Darwin ]; then
  printf 'The macOS launchd integration lane requires macOS.\n' >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/review-publication-launchd.XXXXXX")"
chmod 700 "$ROOT"
TOKEN="$(basename "$ROOT" | tr -cd 'A-Za-z0-9')"
LABEL="dev.review-publication.integration.$(id -u).$$.$TOKEN"
DOMAIN="gui/$(id -u)"
CONFIG="$ROOT/worker-config.json"
CHECK_PID=""
WATCHDOG_PID=""

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ -n "$WATCHDOG_PID" ]; then
    kill "$WATCHDOG_PID" >/dev/null 2>&1 || true
    wait "$WATCHDOG_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$CHECK_PID" ] && kill -0 "$CHECK_PID" >/dev/null 2>&1; then
    kill -TERM "$CHECK_PID" >/dev/null 2>&1 || true
    sleep 0.2
    kill -KILL "$CHECK_PID" >/dev/null 2>&1 || true
    wait "$CHECK_PID" >/dev/null 2>&1 || true
  fi
  /bin/launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  sleep 0.1
  local worker_pids
  worker_pids="$(pgrep -f -- "$CONFIG" 2>/dev/null || true)"
  if [ -n "$worker_pids" ]; then
    kill $worker_pids >/dev/null 2>&1 || true
    sleep 0.2
  fi
  rm -rf -- "$ROOT"

  local label_removed=true artifacts_removed=true workers_removed=true
  /bin/launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && label_removed=false
  [ ! -e "$ROOT" ] || artifacts_removed=false
  pgrep -f -- "$CONFIG" >/dev/null 2>&1 && workers_removed=false
  printf 'launchd cleanup verification: label_removed=%s artifacts_removed=%s workers_removed=%s\n' \
    "$label_removed" "$artifacts_removed" "$workers_removed"
  if [ "$label_removed" != true ] || [ "$artifacts_removed" != true ] || [ "$workers_removed" != true ]; then
    status=1
  fi
  exit "$status"
}

on_signal() {
  exit 124
}

trap cleanup EXIT
trap on_signal HUP INT TERM

REVIEW_PUBLICATION_LAUNCHD_ROOT="$ROOT" \
REVIEW_PUBLICATION_LAUNCHD_LABEL="$LABEL" \
REVIEW_PUBLICATION_LAUNCHD_CONFIG="$CONFIG" \
node "$REPO_DIR/test/review-publication-launchd.integration.mjs" &
CHECK_PID=$!

(
  sleep 35
  kill -TERM "$CHECK_PID" >/dev/null 2>&1 || true
  sleep 5
  kill -KILL "$CHECK_PID" >/dev/null 2>&1 || true
) &
WATCHDOG_PID=$!

set +e
wait "$CHECK_PID"
STATUS=$?
set -e
CHECK_PID=""
kill "$WATCHDOG_PID" >/dev/null 2>&1 || true
wait "$WATCHDOG_PID" >/dev/null 2>&1 || true
WATCHDOG_PID=""
exit "$STATUS"
