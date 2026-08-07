# Claude Code harness module manifest (sourced by install.sh, ADR-0010).
#
# Declares the config root, the shared categories this harness consumes, and
# an install_module hook for its own runtime files. Adding/removing Claude is
# adding/removing this directory.

config_root="$HOME/.claude"
consumed_categories=(skills agents)
command_target="commands"

# Detailed rules stay at the canonical ~/.dotfiles/ai/rules/ path. Mirroring
# them into Claude's special rules/ directory would auto-load all of them.
# Shared explicit workflows project into Claude's native commands directory.

# The source is harness-system-prompt.md, not the repo-root authoring contract.
instruction_target="CLAUDE.md"

# The guardrail shim (tier B) is referenced by absolute path from settings.json,
# so it needs no symlink.
install_module() {
  # Migrate retired rule mirrors while preserving unrelated user files.
  prune_repo_rule_links "$config_root/rules"
  prune_repo_rule_links "$config_root/rulebook"

  ln -sf "$MOD/settings.json" "$MOD/statusline.sh" "$MOD/hooks.json" "$config_root"
  dim "  $config_root/settings.json"
  dim "  $config_root/statusline.sh"
  dim "  $config_root/hooks.json"
}
