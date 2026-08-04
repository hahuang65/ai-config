# Claude Code harness module manifest (sourced by install.sh, ADR-0010).
#
# Declares the config root, the shared categories this harness consumes, and
# an install_module hook for its own runtime files. Adding/removing Claude is
# adding/removing this directory.

config_root="$HOME/.claude"
consumed_categories=(skills agents)

# Detailed rules stay at the canonical ~/.dotfiles/ai/rules/ path. Mirroring
# them into Claude's special rules/ directory would auto-load all of them.
# Claude registers skills directly as /name, so no separate command wrappers
# are needed.

# The source is harness-system-prompt.md, not the repo-root authoring contract.
instruction_target="CLAUDE.md"

# The guardrail shim (tier B) is referenced by absolute path from settings.json,
# so it needs no symlink.
install_module() {
  # Migrate retired mirrors and wrappers while preserving unrelated user files.
  prune_repo_rule_links "$config_root/rules"
  prune_repo_rule_links "$config_root/rulebook"
  prune_repo_command_links "$config_root/commands"

  ln -sf "$MOD/settings.json" "$config_root/settings.json"
  dim "  $config_root/settings.json"
  ln -sf "$MOD/statusline.sh" "$config_root/statusline.sh"
  dim "  $config_root/statusline.sh"
  ln -sf "$MOD/hooks.json" "$config_root/hooks.json"
  dim "  $config_root/hooks.json"
}
