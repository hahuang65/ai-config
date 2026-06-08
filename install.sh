#!/usr/bin/env bash
#
# install.sh — Install ai-config across pluggable harness modules
#
# Each harness is a self-contained module under harnesses/<name>/ with a
# manifest.sh declaring its config root, the shared categories it consumes, and
# an install_module hook for its own runtime files. This script is a GENERIC
# LOOP over those modules (ADR-0010): adding a harness is dropping in a module,
# removing one is deleting its directory. Shared primitives (skills, commands,
# agents, rules) stay flat at the repo root and are mirrored into each config
# root. Run from the repo root: ./install.sh
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
# re-running install.sh self-heals after a skill/command/rule is deleted or
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

# Mirror one shared category from the repo root into a config root. Skills are
# directories (symlinked with -n); commands/agents/rules are .md files. When
# `dedupe` is true (Claude Code), a command sharing a name with a skill dir is
# skipped — Claude registers both as /name, which would duplicate the command.
mirror_category() {
  local cat="$1" config_root="$2" dedupe="$3" entry name
  case "$cat" in
    skills)
      for entry in "$REPO_DIR"/skills/*/; do
        [ -d "$entry" ] || continue
        name="$(basename "$entry")"
        ln -sfn "$entry" "$config_root/skills/$name"
        dim "  $config_root/skills/$name"
      done
      ;;
    commands|agents|rules)
      for entry in "$REPO_DIR/$cat"/*.md; do
        [ -f "$entry" ] || continue
        name="$(basename "$entry")"
        if [ "$cat" = commands ] && [ "$dedupe" = true ] && [ -d "$REPO_DIR/skills/${name%.md}" ]; then
          rm -f "$config_root/commands/$name"
          dim "  $config_root/commands/$name — skipped (registered as skill)"
          continue
        fi
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
    dedupe_commands_with_skills=false
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
      mirror_category "$cat" "$config_root" "$dedupe_commands_with_skills"
    done

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

# Neutral instruction source filename (relative to repo root). Empty by
# default — no module wires an instruction file yet.
INSTRUCTION_SOURCE="${INSTRUCTION_SOURCE:-}"

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

# ── Repository git hook (shared dev tooling — not harness-specific) ──────────

echo ""
green "Configuring git hooks..."
git -C "$REPO_DIR" config core.hooksPath .githooks
dim "  core.hooksPath → .githooks"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
green "Done!"
skill_count=$(ls -1d "$REPO_DIR"/skills/*/ 2>/dev/null | wc -l | tr -d ' ')
cmd_count=$(ls -1 "$REPO_DIR"/commands/*.md 2>/dev/null | wc -l | tr -d ' ')
rule_count=$(ls -1 "$REPO_DIR"/rules/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "  $harness_count harness module(s); $skill_count skills, $cmd_count commands, $rule_count rules available to consume."
echo ""
