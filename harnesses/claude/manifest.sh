# Claude Code harness module manifest (sourced by install.sh, ADR-0010).
#
# Declares the config root, the shared categories this harness consumes, and
# an install_module hook for its own runtime files. Adding/removing Claude is
# adding/removing this directory.

config_root="$HOME/.claude"
consumed_categories=(skills commands agents rules)

# Claude registers BOTH skills and commands as /name, so a command sharing a
# skill's name would duplicate the slash command — skip it.
dedupe_commands_with_skills=true

# No neutral global-instruction file wired (the repo-root AGENTS.md is an
# in-repo authoring contract, not a per-project instruction).
instruction_target=""

# Claude reads no sibling config root, so there is no cross-discovery to
# disable here (contrast oh-my-pi). The guardrail shim (tier B) is referenced
# by absolute path from settings.json, so it needs no symlink.
install_module() {
  ln -sf "$MOD/settings.json" "$config_root/settings.json"
  dim "  $config_root/settings.json"
  ln -sf "$MOD/statusline.sh" "$config_root/statusline.sh"
  dim "  $config_root/statusline.sh"
  ln -sf "$MOD/hooks.json" "$config_root/hooks.json"
  dim "  $config_root/hooks.json"
}
