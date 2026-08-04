#!/usr/bin/env bash
#
# install.sh — Install ai-config across pluggable harness modules
#
# Each harness is a self-contained module under harnesses/<name>/ with a
# manifest.sh declaring its config root, the shared categories it consumes, and
# an install_module hook for its own runtime files. This script is a GENERIC
# LOOP over those modules (ADR-0010): adding a harness is dropping in a module,
# removing one is deleting its directory. Shared primitives (commands, skills,
# agents, rules) stay flat at the repo root and project into each config root.
# Run from the repo root: ./install.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

INSTALL_FORCE=false
if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then
  INSTALL_FORCE=true
fi

# Remove dangling symlinks (target no longer exists) from a managed dir, so
# re-running install.sh self-heals after a skill, agent, or rule is deleted or
# renamed — `ln -sf` refreshes live links but never removes orphaned ones.
prune_dangling() {
  local d="$1" link
  [ -d "$d" ] || return 0
  for link in "$d"/*; do
    if [ -L "$link" ] && [ ! -e "$link" ]; then
      rm -f "$link"
      dim "  pruned dangling → $link"
    fi
  done
}

# Remove this repo's old mirrored rule links from a harness directory while
# preserving unrelated user-managed files. Claude and pi read the canonical
# ~/.dotfiles/ai/rules/ files directly.
prune_repo_rule_links() {
  local d="$1" link raw resolved
  [ -d "$d" ] || return 0
  for link in "$d"/*.md; do
    [ -L "$link" ] || continue
    raw="$(readlink "$link" 2>/dev/null || true)"
    resolved="$(readlink -f "$link" 2>/dev/null || true)"
    case "$raw" in
      "$REPO_DIR"/rules/*) rm -f "$link"; continue ;;
    esac
    case "$resolved" in
      "$REPO_DIR"/rules/*) rm -f "$link" ;;
    esac
  done
  rmdir "$d" 2>/dev/null || true
}

# Remove repo-managed command links from a retired harness location without
# touching commands owned by the user or another package.
prune_repo_command_links() {
  local d="$1" link raw
  [ -d "$d" ] || return 0
  for link in "$d"/*.md; do
    [ -L "$link" ] || continue
    raw="$(readlink "$link" 2>/dev/null || true)"
    case "$raw" in
      "$REPO_DIR"/commands/*) rm -f "$link" ;;
    esac
  done
  rmdir "$d" 2>/dev/null || true
}

# Mirror canonical commands into the harness-native directory selected by its
# manifest: commands/ for Claude Code and prompts/ for pi.
mirror_commands() {
  local target_dir="$1" entry name
  for entry in "$REPO_DIR"/commands/*.md; do
    [ -f "$entry" ] || continue
    name="$(basename "$entry")"
    ln -sf "$entry" "$target_dir/$name"
    dim "  $target_dir/$name"
  done
}

# Mirror one shared category from the repo root into a config root. Skills are
# directories (symlinked with -n); agents and rules are .md files.
mirror_category() {
  local cat="$1" config_root="$2" entry name
  case "$cat" in
    skills)
      for entry in "$REPO_DIR"/skills/*/; do
        [ -d "$entry" ] || continue
        name="$(basename "$entry")"
        ln -sfn "$entry" "$config_root/skills/$name"
        dim "  $config_root/skills/$name"
      done
      ;;
    agents|rules)
      for entry in "$REPO_DIR/$cat"/*.md; do
        [ -f "$entry" ] || continue
        name="$(basename "$entry")"
        ln -sf "$entry" "$config_root/$cat/$name"
        dim "  $config_root/$cat/$name"
      done
      ;;
    *)
      dim "  unknown shared category '$cat' — skipped"
      ;;
  esac
}

# Install a single harness module from its manifest. Run in a subshell so the
# manifest's variables and install_module function never leak between modules.
install_harness() {
  local manifest="$1"
  (
    MOD="$(cd "$(dirname "$manifest")" && pwd)"
    local harness_name
    harness_name="$(basename "$MOD")"

    # Manifest contract (defaults; the manifest overrides what it needs).
    config_root=""
    consumed_categories=()
    command_target=""
    harness_pending=false
    instruction_target=""
    install_module() { :; }

    # shellcheck disable=SC1090
    . "$manifest"

    if [ "${harness_pending}" = true ]; then
      echo ""
      dim "  $harness_name — pending slot, nothing installed (enforcement deferred)"
      exit 0
    fi

    echo ""
    green "Installing $harness_name → $config_root"
    mkdir -p "$config_root"

    local cat
    for cat in "${consumed_categories[@]}"; do
      mkdir -p "$config_root/$cat"
      prune_dangling "$config_root/$cat"
      mirror_category "$cat" "$config_root"
    done

    if [ -n "$command_target" ]; then
      mkdir -p "$config_root/$command_target"
      prune_dangling "$config_root/$command_target"
      mirror_commands "$config_root/$command_target"
    fi

    install_module

    # Optional neutral cross-harness instruction file, installed into the
    # config root under the harness's convention name. Left unset by default —
    # the repo-root AGENTS.md is an in-repo authoring contract, not a global
    # instruction (see docs/adr/0010), so wiring it here would pollute every
    # project. A genuinely-neutral source can be pointed at later.
    if [ -n "$instruction_target" ] && [ -n "$INSTRUCTION_SOURCE" ] && [ -f "$REPO_DIR/$INSTRUCTION_SOURCE" ]; then
      ln -sf "$REPO_DIR/$INSTRUCTION_SOURCE" "$config_root/$instruction_target"
      dim "  $config_root/$instruction_target → $INSTRUCTION_SOURCE"
    fi
  )
}

# Small neutral bootstrap shared by harnesses that support a global context
# file. Harness manifests choose their convention name via instruction_target.
INSTRUCTION_SOURCE="${INSTRUCTION_SOURCE:-harness-system-prompt.md}"

# Modules live under harnesses/ by default; HARNESSES_DIR can override the
# root (used by the install behavior test to exercise add/remove in isolation).
HARNESSES_DIR="${HARNESSES_DIR:-$REPO_DIR/harnesses}"

[ "$INSTALL_FORCE" = true ] && dim "  --force: config files will be overwritten"

green "Installing harness modules from $HARNESSES_DIR/*/manifest.sh"
harness_count=0
for manifest in "$HARNESSES_DIR"/*/manifest.sh; do
  [ -f "$manifest" ] || continue
  install_harness "$manifest"
  harness_count=$((harness_count + 1))
done

# ── Standalone executables (shared tooling — not harness-specific) ──────────

CLI_BIN_DIR="${AI_CONFIG_BIN_DIR:-$HOME/.local/bin}"
CLI_SOURCE="$REPO_DIR/skills/review-change/bin/review-change.mjs"
CLI_TARGET="$CLI_BIN_DIR/review-change"
LEGACY_CLI_SOURCE="$REPO_DIR/skills/change-review/bin/change-review.mjs"
LEGACY_CLI_TARGET="$CLI_BIN_DIR/change-review"
mkdir -p "$CLI_BIN_DIR"
if [ -L "$LEGACY_CLI_TARGET" ] && [ "$(readlink "$LEGACY_CLI_TARGET" 2>/dev/null || true)" = "$LEGACY_CLI_SOURCE" ]; then
  rm -f "$LEGACY_CLI_TARGET"
  dim "  pruned renamed executable → $LEGACY_CLI_TARGET"
fi
if [ -e "$CLI_TARGET" ] || [ -L "$CLI_TARGET" ]; then
  current_cli_target="$(readlink "$CLI_TARGET" 2>/dev/null || true)"
  if [ "$current_cli_target" != "$CLI_SOURCE" ] && [ "$INSTALL_FORCE" != true ]; then
    dim "  $CLI_TARGET — exists, skipping (--force to overwrite)"
  else
    ln -sfn "$CLI_SOURCE" "$CLI_TARGET"
    dim "  $CLI_TARGET → skills/review-change/bin/review-change.mjs"
  fi
else
  ln -s "$CLI_SOURCE" "$CLI_TARGET"
  dim "  $CLI_TARGET → skills/review-change/bin/review-change.mjs"
fi

# ── Repository git hook (shared dev tooling — not harness-specific) ──────────

echo ""
green "Configuring git hooks..."
git -C "$REPO_DIR" config core.hooksPath .githooks
dim "  core.hooksPath → .githooks"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
green "Done!"
command_count=$(ls -1 "$REPO_DIR"/commands/*.md 2>/dev/null | wc -l | tr -d ' ')
skill_count=$(find "$REPO_DIR/skills" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
rule_count=$(ls -1 "$REPO_DIR"/rules/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "  $harness_count harness module(s); $command_count commands, $skill_count skills, and $rule_count rules available to consume."
echo ""
