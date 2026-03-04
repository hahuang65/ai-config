#!/usr/bin/env bash
#
# install.sh — Install ai-config for Claude Code and OpenCode
#
# Symlinks skills, commands, and tool-specific config into the right places.
# Run from the ai-config repo root: ./install.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

# ── Skills (shared: both tools read from ~/.claude/skills/) ──────────────────

echo ""
green "Installing skills..."
mkdir -p "$HOME/.claude/skills"
for skill in "$REPO_DIR"/skills/*/; do
  name="$(basename "$skill")"
  ln -sfn "$skill" "$HOME/.claude/skills/$name"
  dim "  ~/.claude/skills/$name → $skill"
done

# ── Commands for Claude Code (~/.claude/commands/) ───────────────────────────

echo ""
green "Installing commands for Claude Code..."
mkdir -p "$HOME/.claude/commands"
for cmd in "$REPO_DIR"/commands/*.md; do
  name="$(basename "$cmd")"
  ln -sf "$cmd" "$HOME/.claude/commands/$name"
  dim "  ~/.claude/commands/$name → $cmd"
done

# ── Commands for OpenCode (~/.config/opencode/commands/) ─────────────────────
#
# OpenCode natively reads markdown command files with frontmatter from its
# commands/ directory — same format as Claude Code. No JSONC injection needed.

echo ""
green "Installing commands for OpenCode..."
mkdir -p "$HOME/.config/opencode/commands"
for cmd in "$REPO_DIR"/commands/*.md; do
  name="$(basename "$cmd")"
  ln -sf "$cmd" "$HOME/.config/opencode/commands/$name"
  dim "  ~/.config/opencode/commands/$name → $cmd"
done

# ── Claude Code config ───────────────────────────────────────────────────────

echo ""
green "Installing Claude Code config..."
ln -sf "$REPO_DIR/claude/settings.json" "$HOME/.claude/settings.json"
dim "  ~/.claude/settings.json → $REPO_DIR/claude/settings.json"
ln -sf "$REPO_DIR/claude/statusline.sh" "$HOME/.claude/statusline.sh"
dim "  ~/.claude/statusline.sh → $REPO_DIR/claude/statusline.sh"

# ── Git hooks ────────────────────────────────────────────────────────────────

echo ""
green "Configuring git hooks..."
git -C "$REPO_DIR" config core.hooksPath .githooks
dim "  core.hooksPath → .githooks"

# ── Sync permissions (Claude → OpenCode) ────────────────────────────────────

echo ""
green "Syncing permissions from Claude Code to OpenCode..."
python3 "$REPO_DIR/scripts/sync-permissions.py"

# ── OpenCode config ──────────────────────────────────────────────────────────

echo ""
green "Installing OpenCode config..."
mkdir -p "$HOME/.config/opencode"
ln -sf "$REPO_DIR/opencode/opencode.jsonc" "$HOME/.config/opencode/opencode.jsonc"
dim "  ~/.config/opencode/opencode.jsonc → $REPO_DIR/opencode/opencode.jsonc"
ln -sf "$REPO_DIR/opencode/tui.json" "$HOME/.config/opencode/tui.json"
dim "  ~/.config/opencode/tui.json → $REPO_DIR/opencode/tui.json"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
green "Done!"
skill_count=$(ls -1d "$REPO_DIR"/skills/*/ 2>/dev/null | wc -l | tr -d ' ')
cmd_count=$(ls -1 "$REPO_DIR"/commands/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "  $skill_count skills and $cmd_count commands installed for both tools."
echo ""
