#!/usr/bin/env bash
#
# install.sh — Install ai-config for Claude Code and oh-my-pi
#
# Installs harness by harness: one self-contained block per harness symlinks
# that harness's own config plus every shared primitive (skills, commands,
# agents, rules) into the harness's config root. Run from the ai-config repo
# root: ./install.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

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

# ── Claude Code (first harness — config + all primitives) ────────────────────
#
# Self-contained block: the settings / statusline / hooks config plus skills,
# rules, agents, and commands symlinked into ~/.claude/. Commands that share a
# name with a skill are skipped — Claude Code registers both as slash commands,
# which would duplicate /name.

echo ""
green "Installing Claude Code config..."
mkdir -p "$HOME/.claude"
ln -sf "$REPO_DIR/claude/settings.json" "$HOME/.claude/settings.json"
dim "  ~/.claude/settings.json → $REPO_DIR/claude/settings.json"
ln -sf "$REPO_DIR/claude/statusline.sh" "$HOME/.claude/statusline.sh"
dim "  ~/.claude/statusline.sh → $REPO_DIR/claude/statusline.sh"
ln -sf "$REPO_DIR/claude/hooks.json" "$HOME/.claude/hooks.json"
dim "  ~/.claude/hooks.json → $REPO_DIR/claude/hooks.json"

echo ""
green "Installing skills, commands, agents, rules for Claude Code..."
mkdir -p "$HOME/.claude/skills" "$HOME/.claude/commands" \
         "$HOME/.claude/agents" "$HOME/.claude/rules"
prune_dangling "$HOME/.claude/skills"
prune_dangling "$HOME/.claude/commands"
prune_dangling "$HOME/.claude/agents"
prune_dangling "$HOME/.claude/rules"
for skill in "$REPO_DIR"/skills/*/; do
  name="$(basename "$skill")"
  ln -sfn "$skill" "$HOME/.claude/skills/$name"
  dim "  ~/.claude/skills/$name → $skill"
done
for rule in "$REPO_DIR"/rules/*.md; do
  [ -f "$rule" ] || continue
  name="$(basename "$rule")"
  ln -sf "$rule" "$HOME/.claude/rules/$name"
  dim "  ~/.claude/rules/$name → $rule"
done
for cmd in "$REPO_DIR"/commands/*.md; do
  [ -f "$cmd" ] || continue
  name="$(basename "$cmd")"
  if [ -d "$REPO_DIR/skills/${name%.md}" ]; then
    rm -f "$HOME/.claude/commands/$name"
    dim "  ~/.claude/commands/$name — skipped (registered as skill)"
    continue
  fi
  ln -sf "$cmd" "$HOME/.claude/commands/$name"
  dim "  ~/.claude/commands/$name → $cmd"
done
for agent in "$REPO_DIR"/agents/*.md; do
  [ -f "$agent" ] || continue
  name="$(basename "$agent")"
  ln -sf "$agent" "$HOME/.claude/agents/$name"
  dim "  ~/.claude/agents/$name → $agent"
done

# ── oh-my-pi (second harness — config + all primitives at native priority) ────────
#
# Self-contained block: mirrors skills, commands, agents, rules into oh-my-pi's
# user-level root (~/.omp/agent/ — the "agent" subfolder is oh-my-pi convention)
# and installs the hand-authored config.yml. Per docs/adr/0001 we mirror at
# native priority instead of relying on oh-my-pi's `.claude` fallback. The skill /
# command duality skip-rule (skip commands with a matching skill dir) does NOT
# apply here — oh-my-pi doesn't have Claude's duplicate-slash-command registration
# problem, so all commands install.

echo ""
green "Installing oh-my-pi config..."
mkdir -p "$HOME/.omp/agent"
ln -sf "$REPO_DIR/omp/config.yml" "$HOME/.omp/agent/config.yml"
dim "  ~/.omp/agent/config.yml → $REPO_DIR/omp/config.yml"
ln -sf "$REPO_DIR/omp/RULES.md" "$HOME/.omp/agent/RULES.md"
dim "  ~/.omp/agent/RULES.md → $REPO_DIR/omp/RULES.md"

echo ""
green "Installing skills, commands, agents, rules, extensions, hooks for oh-my-pi..."
mkdir -p "$HOME/.omp/agent/skills" "$HOME/.omp/agent/commands" \
         "$HOME/.omp/agent/agents" "$HOME/.omp/agent/rules" \
         "$HOME/.omp/agent/extensions" \
         "$HOME/.omp/agent/hooks/pre" "$HOME/.omp/agent/hooks/post"
prune_dangling "$HOME/.omp/agent/skills"
prune_dangling "$HOME/.omp/agent/commands"
prune_dangling "$HOME/.omp/agent/agents"
prune_dangling "$HOME/.omp/agent/rules"
prune_dangling "$HOME/.omp/agent/extensions"
prune_dangling "$HOME/.omp/agent/hooks/pre"
prune_dangling "$HOME/.omp/agent/hooks/post"
for skill in "$REPO_DIR"/skills/*/; do
  name="$(basename "$skill")"
  ln -sfn "$skill" "$HOME/.omp/agent/skills/$name"
  dim "  ~/.omp/agent/skills/$name → $skill"
done
for cmd in "$REPO_DIR"/commands/*.md; do
  [ -f "$cmd" ] || continue
  name="$(basename "$cmd")"
  ln -sf "$cmd" "$HOME/.omp/agent/commands/$name"
  dim "  ~/.omp/agent/commands/$name → $cmd"
done
for agent in "$REPO_DIR"/agents/*.md; do
  [ -f "$agent" ] || continue
  name="$(basename "$agent")"
  ln -sf "$agent" "$HOME/.omp/agent/agents/$name"
  dim "  ~/.omp/agent/agents/$name → $agent"
done
for rule in "$REPO_DIR"/rules/*.md; do
  [ -f "$rule" ] || continue
  name="$(basename "$rule")"
  ln -sf "$rule" "$HOME/.omp/agent/rules/$name"
  dim "  ~/.omp/agent/rules/$name → $rule"
done
# Extensions: TS/JS only — README.md and other non-code files are skipped so
# oh-my-pi's native extension loader doesn't try to import them.
for ext in "$REPO_DIR"/omp/extensions/*.ts "$REPO_DIR"/omp/extensions/*.js; do
  [ -f "$ext" ] || continue
  name="$(basename "$ext")"
  ln -sf "$ext" "$HOME/.omp/agent/extensions/$name"
  dim "  ~/.omp/agent/extensions/$name → $ext"
done
# Hooks: pre/post TS/JS modules — README.md and other non-code files are
# skipped so oh-my-pi's native hook loader doesn't try to import them.
for hook in "$REPO_DIR"/omp/hooks/pre/*.ts "$REPO_DIR"/omp/hooks/pre/*.js; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook")"
  ln -sf "$hook" "$HOME/.omp/agent/hooks/pre/$name"
  dim "  ~/.omp/agent/hooks/pre/$name → $hook"
done
for hook in "$REPO_DIR"/omp/hooks/post/*.ts "$REPO_DIR"/omp/hooks/post/*.js; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook")"
  ln -sf "$hook" "$HOME/.omp/agent/hooks/post/$name"
  dim "  ~/.omp/agent/hooks/post/$name → $hook"
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
echo "  $skill_count skills, $cmd_count commands, and $rule_count rules installed."
echo ""
