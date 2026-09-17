#!/usr/bin/env bash
set -eEuo pipefail

REPOSITORY_ROOT_INPUT="${AI_CONFIG_REPO_DIR:-$(dirname "$0")/..}"
REPOSITORY_ROOT="$(cd "$REPOSITORY_ROOT_INPUT" && pwd)"
PLATFORM="${AI_CONFIG_SERVICE_PLATFORM:-$(uname -s)}"
SERVICE_ENABLE="${AI_CONFIG_SERVICE_ENABLE:-auto}"
INSTALL_FORCE="${AI_CONFIG_INSTALL_FORCE:-false}"
LAUNCHCTL_BIN="${AI_CONFIG_LAUNCHCTL_BIN:-$(command -v launchctl 2>/dev/null || true)}"
SYSTEMCTL_BIN="${AI_CONFIG_SYSTEMCTL_BIN:-$(command -v systemctl 2>/dev/null || true)}"

status() { printf '  %s\n' "$1"; }

resolve_executable() {
  local name="$1" configured="$2" executable
  executable="$configured"
  [ -n "$executable" ] || executable="$(command -v "$name" 2>/dev/null || true)"
  case "$executable" in
    /*) ;;
    *) printf '%s must resolve to an absolute executable path.\n' "$name" >&2; return 1 ;;
  esac
  if [ ! -f "$executable" ] || [ ! -x "$executable" ]; then
    printf '%s is not an executable file: %s\n' "$name" "$executable" >&2
    return 1
  fi
  printf '%s\n' "$executable"
}

account_home() {
  if [ "$PLATFORM" = Darwin ] && command -v dscl >/dev/null 2>&1; then
    dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | awk '{print $2}'
    return
  fi
  if command -v getent >/dev/null 2>&1; then
    getent passwd "$(id -u)" | awk -F: '{print $6}'
  fi
}

should_enable() {
  case "$SERVICE_ENABLE" in
    true) return 0 ;;
    false) return 1 ;;
    auto)
      [ "$PLATFORM" = Darwin ] || [ "$PLATFORM" = Linux ] || return 1
      [ "$(account_home)" = "$HOME" ]
      ;;
    *) printf 'Invalid AI_CONFIG_SERVICE_ENABLE: %s\n' "$SERVICE_ENABLE" >&2; return 2 ;;
  esac
}

case "$PLATFORM" in
  Darwin|Linux) ;;
  *)
    if [ "$SERVICE_ENABLE" = false ]; then
      status "Review publication activation skipped on unsupported platform $PLATFORM"
      exit 0
    fi
    printf 'Review publication requires macOS launchd or Linux systemd user services; %s is unsupported.\n' "$PLATFORM" >&2
    exit 1
    ;;
esac

NODE_CANDIDATE="${AI_CONFIG_NODE_BIN:-}"
if [ -z "$NODE_CANDIDATE" ]; then
  NODE_COMMAND="$(resolve_executable node "")"
  NODE_CANDIDATE="$("$NODE_COMMAND" -p 'process.execPath')"
fi
NODE_BIN="$(resolve_executable node "$NODE_CANDIDATE")"
RENDERER="$REPOSITORY_ROOT/review-publication/render-installation.mjs"
WORKER_ARTIFACT="$REPOSITORY_ROOT/review-publication/review-publication-worker.bundle.mjs"
WORKER_DIGEST="$WORKER_ARTIFACT.sha256"
WORKER="$HOME/.review-publication/review-publication-worker.mjs"
GH_CANDIDATE="$(resolve_executable gh "${AI_CONFIG_GH_BIN:-}")"
GH_VALIDATOR="$REPOSITORY_ROOT/skills/review-change/bin/review-publication.mjs"
GH_BIN="$("$NODE_BIN" "$GH_VALIDATOR" --validate-github-executable "$GH_CANDIDATE")"
case "$PLATFORM" in
  Darwin) CONFIRMATION_BIN="$(resolve_executable osascript "${AI_CONFIG_CONFIRMATION_BIN:-/usr/bin/osascript}")" ;;
  Linux) CONFIRMATION_BIN="$(resolve_executable zenity "${AI_CONFIG_CONFIRMATION_BIN:-}")" ;;
esac
"$NODE_BIN" "$REPOSITORY_ROOT/review-publication/check-managed-state.mjs" "$HOME"
ENABLE_REQUESTED=false
if should_enable; then
  ENABLE_REQUESTED=true
else
  enable_status=$?
  [ "$enable_status" -eq 1 ] || exit "$enable_status"
fi
PORT_CHECK_BIN="${AI_CONFIG_PORT_CHECK_BIN:-}"
if [ -n "$PORT_CHECK_BIN" ]; then
  PORT_CHECK_BIN="$(resolve_executable port-check "$PORT_CHECK_BIN")"
else
  PORT_CHECK_BIN="$REPOSITORY_ROOT/review-publication/check-port.mjs"
fi
set +e
if [ "$PORT_CHECK_BIN" = "$REPOSITORY_ROOT/review-publication/check-port.mjs" ]; then
  "$NODE_BIN" "$PORT_CHECK_BIN"
else
  "$PORT_CHECK_BIN" 4392
fi
port_status=$?
set -e
MANAGED_LISTENER_ACTIVE=false
case "$port_status" in
  0) ;;
  10) MANAGED_LISTENER_ACTIVE=true ;;
  *) exit "$port_status" ;;
esac

DOMAIN="${AI_CONFIG_SERVICE_DOMAIN:-gui/$(id -u)}"
SERVICE_MANAGER=""
if [ "$ENABLE_REQUESTED" = true ] || [ "$MANAGED_LISTENER_ACTIVE" = true ]; then
  case "$PLATFORM" in
    Darwin) SERVICE_MANAGER="$(resolve_executable launchctl "$LAUNCHCTL_BIN")" ;;
    Linux) SERVICE_MANAGER="$(resolve_executable systemctl "$SYSTEMCTL_BIN")" ;;
  esac
fi
SYSTEMD_STATE_SNAPSHOTTED=false
SYSTEMD_PRIOR_LOAD_STATE=""
SYSTEMD_PRIOR_ENABLE_STATE=""
SYSTEMD_PRIOR_ACTIVE_STATE=""
snapshot_systemd_state() {
  local load_output load_status enabled_output enabled_status active_output active_status
  set +e
  load_output="$("$SERVICE_MANAGER" --user show review-publication.socket --property=LoadState --value 2>/dev/null)"
  load_status=$?
  enabled_output="$("$SERVICE_MANAGER" --user is-enabled review-publication.socket 2>/dev/null)"
  enabled_status=$?
  active_output="$("$SERVICE_MANAGER" --user is-active review-publication.socket 2>/dev/null)"
  active_status=$?
  set -e
  SYSTEMD_PRIOR_LOAD_STATE="$(printf '%s\n' "$load_output" | awk -F= '/^LoadState=/{print $2; exit}')"
  [ -n "$SYSTEMD_PRIOR_LOAD_STATE" ] || SYSTEMD_PRIOR_LOAD_STATE="$(printf '%s' "$load_output" | head -n 1)"
  [ -n "$SYSTEMD_PRIOR_LOAD_STATE" ] || { [ "$load_status" -eq 0 ] && SYSTEMD_PRIOR_LOAD_STATE=loaded || SYSTEMD_PRIOR_LOAD_STATE=not-found; }
  SYSTEMD_PRIOR_ENABLE_STATE="$(printf '%s' "$enabled_output" | head -n 1)"
  [ "$SYSTEMD_PRIOR_ENABLE_STATE" = enabled ] || [ "$SYSTEMD_PRIOR_ENABLE_STATE" = disabled ] \
    || { [ "$enabled_status" -eq 0 ] && SYSTEMD_PRIOR_ENABLE_STATE=enabled || SYSTEMD_PRIOR_ENABLE_STATE=disabled; }
  SYSTEMD_PRIOR_ACTIVE_STATE="$(printf '%s' "$active_output" | head -n 1)"
  [ "$SYSTEMD_PRIOR_ACTIVE_STATE" = active ] || [ "$SYSTEMD_PRIOR_ACTIVE_STATE" = inactive ] \
    || { [ "$active_status" -eq 0 ] && SYSTEMD_PRIOR_ACTIVE_STATE=active || SYSTEMD_PRIOR_ACTIVE_STATE=inactive; }
  SYSTEMD_STATE_SNAPSHOTTED=true
}
if [ "$PLATFORM" = Linux ] && [ -n "$SERVICE_MANAGER" ]; then snapshot_systemd_state; fi
if [ "$MANAGED_LISTENER_ACTIVE" = true ]; then
  "$NODE_BIN" "$REPOSITORY_ROOT/review-publication/verify-managed-listener.mjs" \
    "$PLATFORM" "$HOME" "$SERVICE_MANAGER" "$DOMAIN"
fi

WRAPPER="$HOME/.local/bin/review-publication"
CONFIGURATION="$HOME/.review-publication/worker-config.json"
case "$PLATFORM" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/dev.review-publication.plist"
    MANAGED_DESTINATIONS=("$WORKER" "$WRAPPER" "$CONFIGURATION" "$PLIST")
    ;;
  Linux)
    SOCKET="$HOME/.config/systemd/user/review-publication.socket"
    SERVICE="$HOME/.config/systemd/user/review-publication@.service"
    MANAGED_DESTINATIONS=("$WORKER" "$WRAPPER" "$CONFIGURATION" "$SOCKET" "$SERVICE")
    ;;
esac
"$NODE_BIN" "$RENDERER" worker "$WORKER_ARTIFACT" "$WORKER" unused unused \
  "$WORKER_DIGEST" "" "$INSTALL_FORCE" "" validate-only
"$NODE_BIN" "$RENDERER" wrapper unused "$WRAPPER" "$NODE_BIN" "$WORKER" "$GH_BIN" \
  "$WORKER" "$INSTALL_FORCE" "" validate-only
"$NODE_BIN" "$RENDERER" worker-config unused "$CONFIGURATION" "$NODE_BIN" "$WORKER" "$GH_BIN" \
  "" "$INSTALL_FORCE" "$CONFIRMATION_BIN" validate-only
case "$PLATFORM" in
  Darwin)
    "$NODE_BIN" "$RENDERER" launchd "$REPOSITORY_ROOT/review-publication/dev.review-publication.plist" \
      "$PLIST" "$NODE_BIN" "$WORKER" "$GH_BIN" "" "$INSTALL_FORCE" "$CONFIRMATION_BIN" validate-only
    ;;
  Linux)
    for unit in review-publication.socket review-publication@.service; do
      "$NODE_BIN" "$RENDERER" systemd "$REPOSITORY_ROOT/review-publication/$unit" \
        "$HOME/.config/systemd/user/$unit" "$NODE_BIN" "$WORKER" "$GH_BIN" \
        "$REPOSITORY_ROOT/review-publication/$unit" "$INSTALL_FORCE" "$CONFIRMATION_BIN" validate-only
    done
    ;;
esac

TRANSACTION_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/review-publication-install.XXXXXX")"
for index in "${!MANAGED_DESTINATIONS[@]}"; do
  destination="${MANAGED_DESTINATIONS[$index]}"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    mkdir -p "$TRANSACTION_ROOT/$index"
    cp -Pp "$destination" "$TRANSACTION_ROOT/$index/original"
  fi
done

quiesce_service() {
  case "$PLATFORM" in
    Darwin) "$SERVICE_MANAGER" bootout "$DOMAIN/dev.review-publication" >/dev/null 2>&1 ;;
    Linux)
      "$SERVICE_MANAGER" --user stop review-publication.socket
      "$SERVICE_MANAGER" --user stop 'review-publication@*.service'
      ;;
  esac
}

activate_service() {
  case "$PLATFORM" in
    Darwin)
      "$SERVICE_MANAGER" bootstrap "$DOMAIN" "$PLIST"
      "$SERVICE_MANAGER" enable "$DOMAIN/dev.review-publication"
      ;;
    Linux)
      "$SERVICE_MANAGER" --user daemon-reload
      if [ "$ENABLE_REQUESTED" = true ]; then
        "$SERVICE_MANAGER" --user enable --now review-publication.socket
      else
        "$SERVICE_MANAGER" --user start review-publication.socket
      fi
      ;;
  esac
}

restore_installation() {
  local restore_failed=0
  for index in "${!MANAGED_DESTINATIONS[@]}"; do
    destination="${MANAGED_DESTINATIONS[$index]}"
    rm -f "$destination" || restore_failed=1
    if [ -e "$TRANSACTION_ROOT/$index/original" ] || [ -L "$TRANSACTION_ROOT/$index/original" ]; then
      mkdir -p "$(dirname "$destination")" || restore_failed=1
      cp -Pp "$TRANSACTION_ROOT/$index/original" "$destination" || restore_failed=1
    fi
  done
  return "$restore_failed"
}

rollback_action() {
  local description="$1"
  shift
  if ! "$@"; then
    printf 'Review publication rollback failed while %s.\n' "$description" >&2
    ROLLBACK_FAILED=true
  fi
}

restore_systemd_state() {
  if [ "$SYSTEMD_PRIOR_ENABLE_STATE" = disabled ]; then
    rollback_action "restoring systemd enablement" "$SERVICE_MANAGER" --user disable review-publication.socket
  fi
  rollback_action "stopping the systemd socket" "$SERVICE_MANAGER" --user stop review-publication.socket
  rollback_action "stopping systemd workers" "$SERVICE_MANAGER" --user stop 'review-publication@*.service'
  rollback_action "restoring managed files" restore_installation
  rollback_action "reloading systemd" "$SERVICE_MANAGER" --user daemon-reload
  if [ "$SYSTEMD_PRIOR_ENABLE_STATE" = enabled ]; then
    rollback_action "restoring systemd enablement" "$SERVICE_MANAGER" --user enable review-publication.socket
  else
    rollback_action "restoring systemd enablement" "$SERVICE_MANAGER" --user disable review-publication.socket
  fi
  if [ "$SYSTEMD_PRIOR_ACTIVE_STATE" = active ]; then
    rollback_action "restoring systemd activity" "$SERVICE_MANAGER" --user start review-publication.socket
  else
    rollback_action "restoring systemd activity" "$SERVICE_MANAGER" --user stop review-publication.socket
  fi
}

rollback_installation() {
  failure_status=$?
  trap - ERR
  set +e
  ROLLBACK_FAILED=false
  if [ "$PLATFORM" = Linux ] && [ "$SYSTEMD_STATE_SNAPSHOTTED" = true ]; then
    restore_systemd_state
  else
    if [ -n "$SERVICE_MANAGER" ]; then rollback_action "quiescing the prior service" quiesce_service; fi
    rollback_action "restoring managed files" restore_installation
    if [ "$MANAGED_LISTENER_ACTIVE" = true ]; then rollback_action "restoring the prior service" activate_service; fi
  fi
  rollback_action "removing temporary installation state" rm -rf "$TRANSACTION_ROOT"
  exit "$failure_status"
}
trap rollback_installation ERR

if [ "$MANAGED_LISTENER_ACTIVE" = true ]; then quiesce_service; fi
"$NODE_BIN" "$RENDERER" worker "$WORKER_ARTIFACT" "$WORKER" unused unused \
  "$WORKER_DIGEST" "" "$INSTALL_FORCE" ""
status "$WORKER ← Review publication worker artifact"
"$NODE_BIN" "$RENDERER" wrapper unused "$WRAPPER" "$NODE_BIN" "$WORKER" "$GH_BIN" "$WORKER" "$INSTALL_FORCE" ""
status "$WRAPPER ← Review publication worker"
"$NODE_BIN" "$RENDERER" worker-config unused "$CONFIGURATION" \
  "$NODE_BIN" "$WORKER" "$GH_BIN" "" "$INSTALL_FORCE" "$CONFIRMATION_BIN"
status "$CONFIGURATION ← Review publication worker configuration"
case "$PLATFORM" in
  Darwin)
    "$NODE_BIN" "$RENDERER" launchd \
      "$REPOSITORY_ROOT/review-publication/dev.review-publication.plist" \
      "$PLIST" "$NODE_BIN" "$WORKER" "$GH_BIN" "" "$INSTALL_FORCE" "$CONFIRMATION_BIN"
    status "$PLIST ← Review publication LaunchAgent"
    ;;
  Linux)
    "$NODE_BIN" "$RENDERER" systemd \
      "$REPOSITORY_ROOT/review-publication/review-publication.socket" \
      "$SOCKET" "$NODE_BIN" "$WORKER" "$GH_BIN" \
      "$REPOSITORY_ROOT/review-publication/review-publication.socket" "$INSTALL_FORCE" "$CONFIRMATION_BIN"
    status "$SOCKET ← Review publication socket"
    "$NODE_BIN" "$RENDERER" systemd \
      "$REPOSITORY_ROOT/review-publication/review-publication@.service" \
      "$SERVICE" "$NODE_BIN" "$WORKER" "$GH_BIN" \
      "$REPOSITORY_ROOT/review-publication/review-publication@.service" "$INSTALL_FORCE" "$CONFIRMATION_BIN"
    status "$SERVICE ← Review publication worker"
    ;;
esac
if [ "$ENABLE_REQUESTED" = true ] || [ "$MANAGED_LISTENER_ACTIVE" = true ]; then activate_service; fi
trap - ERR
rm -rf "$TRANSACTION_ROOT"
