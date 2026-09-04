#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT_INPUT="${AI_CONFIG_REPO_DIR:-$(dirname "$0")/..}"
REPOSITORY_ROOT="$(cd "$REPOSITORY_ROOT_INPUT" && pwd)"
INSTALL_FORCE="${AI_CONFIG_INSTALL_FORCE:-false}"
PLATFORM="${AI_CONFIG_SERVICE_PLATFORM:-$(uname -s)}"
SERVICE_ENABLE="${AI_CONFIG_SERVICE_ENABLE:-auto}"
MISE_BIN="${AI_CONFIG_MISE_BIN:-$(command -v mise 2>/dev/null || true)}"
LAUNCHCTL_BIN="${AI_CONFIG_LAUNCHCTL_BIN:-$(command -v launchctl 2>/dev/null || true)}"
SYSTEMCTL_BIN="${AI_CONFIG_SYSTEMCTL_BIN:-$(command -v systemctl 2>/dev/null || true)}"
AGENTMEMORY_TOOL="npm:@agentmemory/agentmemory@0.9.29"
LAUNCHD_LABEL="dev.agentmemory"
SYSTEMD_UNIT="agentmemory.service"
INSTALL_STATE="$HOME/.agentmemory/service-install-state"

status() { printf '  %s\n' "$1"; }

install_link() {
  local source="$1" target="$2" label="$3"
  mkdir -p "$(dirname "$target")"
  if [ -L "$target" ]; then
    ln -sfn "$source" "$target"
  elif [ -e "$target" ]; then
    if [ "$INSTALL_FORCE" = true ] || cmp -s "$source" "$target"; then
      rm -f "$target"
      ln -s "$source" "$target"
    else
      status "$target — exists, skipping (--force to overwrite)"
      return 0
    fi
  else
    ln -s "$source" "$target"
  fi
  status "$target → $label"
}

install_file() {
  local source="$1" target="$2" label="$3"
  mkdir -p "$(dirname "$target")"
  rm -f "$target"
  cp "$source" "$target"
  chmod 0644 "$target"
  status "$target ← $label"
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

should_enable_service() {
  case "$SERVICE_ENABLE" in
    true) return 0 ;;
    false) return 1 ;;
    auto)
      [ "$PLATFORM" = Darwin ] || [ "$PLATFORM" = Linux ] || return 1
      [ "$(account_home)" = "$HOME" ]
      ;;
    *)
      printf 'Invalid AI_CONFIG_SERVICE_ENABLE: %s\n' "$SERVICE_ENABLE" >&2
      return 2
      ;;
  esac
}

service_fingerprint() {
  local service_source="$1"
  {
    cksum "$REPOSITORY_ROOT/mise.toml"
    cksum "$REPOSITORY_ROOT/agentmemory/iii-config.yaml"
    cksum "$service_source"
    printf '%s\n' "$AGENTMEMORY_TOOL"
  } | cksum | awk '{print $1 "-" $2}'
}

service_state_matches() {
  [ -L "$INSTALL_STATE" ] && [ "$(readlink "$INSTALL_STATE")" = "$1" ]
}

record_service_state() {
  mkdir -p "$(dirname "$INSTALL_STATE")"
  ln -sfn "$1" "$INSTALL_STATE"
}

agentmemory_is_healthy() {
  "$HOME/.local/bin/agentmemory" status >/dev/null 2>&1
}

install_runtime() {
  if [ -z "$MISE_BIN" ]; then
    printf 'mise is required to install agentmemory.\n' >&2
    return 1
  fi
  local executable
  if ! executable="$(cd "$REPOSITORY_ROOT" && "$MISE_BIN" which agentmemory 2>/dev/null)"; then
    (cd "$REPOSITORY_ROOT" && "$MISE_BIN" install "$AGENTMEMORY_TOOL")
    executable="$(cd "$REPOSITORY_ROOT" && "$MISE_BIN" which agentmemory)"
  fi
  if [ ! -x "$HOME/.local/share/mise/shims/agentmemory" ]; then
    "$MISE_BIN" reshim
  fi
  install_link "$executable" "$HOME/.local/bin/agentmemory" "mise agentmemory executable"
}

install_launchd_service() {
  local plist="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
  install_file \
    "$REPOSITORY_ROOT/agentmemory/$LAUNCHD_LABEL.plist" \
    "$plist" \
    "agentmemory/$LAUNCHD_LABEL.plist"
  should_enable_service || return 0
  [ -n "$LAUNCHCTL_BIN" ] || { printf 'launchctl is required on macOS.\n' >&2; return 1; }
  install_runtime
  local domain="${AI_CONFIG_SERVICE_DOMAIN:-gui/$(id -u)}"
  local service="$domain/$LAUNCHD_LABEL"
  local fingerprint
  fingerprint="$(service_fingerprint "$REPOSITORY_ROOT/agentmemory/$LAUNCHD_LABEL.plist")"
  if service_state_matches "$fingerprint" \
      && "$LAUNCHCTL_BIN" print "$service" >/dev/null 2>&1 \
      && agentmemory_is_healthy; then
    status "$LAUNCHD_LABEL is already current and healthy"
    return 0
  fi
  if "$LAUNCHCTL_BIN" print "$service" >/dev/null 2>&1; then
    "$LAUNCHCTL_BIN" bootout "$service"
  fi
  "$HOME/.local/bin/agentmemory" stop >/dev/null 2>&1 || true
  "$LAUNCHCTL_BIN" bootstrap "$domain" "$plist"
  "$LAUNCHCTL_BIN" enable "$service"
  "$LAUNCHCTL_BIN" kickstart -k "$service"
  record_service_state "$fingerprint"
  status "$LAUNCHD_LABEL enabled and started"
}

install_systemd_service() {
  local unit="$HOME/.config/systemd/user/$SYSTEMD_UNIT"
  install_link \
    "$REPOSITORY_ROOT/agentmemory/$SYSTEMD_UNIT" \
    "$unit" \
    "agentmemory/$SYSTEMD_UNIT"
  should_enable_service || return 0
  [ -n "$SYSTEMCTL_BIN" ] || { printf 'systemctl is required on Linux.\n' >&2; return 1; }
  install_runtime
  local fingerprint
  fingerprint="$(service_fingerprint "$REPOSITORY_ROOT/agentmemory/$SYSTEMD_UNIT")"
  if service_state_matches "$fingerprint" \
      && "$SYSTEMCTL_BIN" --user is-active --quiet "$SYSTEMD_UNIT" \
      && agentmemory_is_healthy; then
    status "$SYSTEMD_UNIT is already current and healthy"
    return 0
  fi
  "$SYSTEMCTL_BIN" --user daemon-reload
  "$SYSTEMCTL_BIN" --user enable "$SYSTEMD_UNIT"
  "$SYSTEMCTL_BIN" --user restart "$SYSTEMD_UNIT"
  record_service_state "$fingerprint"
  status "$SYSTEMD_UNIT enabled and started"
}

install_link \
  "$REPOSITORY_ROOT/agentmemory/iii-config.yaml" \
  "$HOME/.agentmemory/iii-config.yaml" \
  "agentmemory/iii-config.yaml"

case "$PLATFORM" in
  Darwin) install_launchd_service ;;
  Linux) install_systemd_service ;;
  *) status "agentmemory service installation is not supported on $PLATFORM" ;;
esac
