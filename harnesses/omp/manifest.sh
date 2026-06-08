# oh-my-pi harness module manifest (sourced by install.sh, ADR-0010).
#
# The "agent" subfolder is oh-my-pi convention. Cross-discovery of sibling
# config roots is disabled in config.yml (ADR-0010), so installing config.yml
# is what makes sharing push-only — no separate action needed here.

config_root="$HOME/.omp/agent"
consumed_categories=(skills commands agents rules)

# oh-my-pi has no Claude-style duplicate-slash-command problem, so every
# command installs.
dedupe_commands_with_skills=false

instruction_target=""

install_module() {
  # Copy base config once (regular file, not symlink) so oh-my-pi can write
  # runtime fields (lastChangelogVersion, etc.) without dirtying git.
  # Machine-specific edits (model, etc.) go directly into the installed copy.
  # Use install.sh --force to overwrite an existing copy with the repo base.
  [ -L "$config_root/config.yml" ] && rm "$config_root/config.yml"
  if [ ! -f "$config_root/config.yml" ] || [ "${INSTALL_FORCE:-false}" = true ]; then
    cp "$MOD/config.yml" "$config_root/config.yml"
    dim "  $config_root/config.yml"
  else
    dim "  $config_root/config.yml — exists, skipping (--force to overwrite)"
  fi
  ln -sf "$MOD/RULES.md" "$config_root/RULES.md"
  dim "  $config_root/RULES.md"

  mkdir -p "$config_root/extensions" "$config_root/hooks/pre" "$config_root/hooks/post"
  prune_dangling "$config_root/extensions"
  prune_dangling "$config_root/hooks/pre"
  prune_dangling "$config_root/hooks/post"

  # Extensions and hooks are TS/JS only — README.md and other non-code are
  # skipped so oh-my-pi's loader doesn't try to import them.
  local f
  for f in "$MOD"/extensions/*.ts "$MOD"/extensions/*.js; do
    [ -f "$f" ] || continue
    ln -sf "$f" "$config_root/extensions/$(basename "$f")"
    dim "  $config_root/extensions/$(basename "$f")"
  done
  for f in "$MOD"/hooks/pre/*.ts "$MOD"/hooks/pre/*.js; do
    [ -f "$f" ] || continue
    ln -sf "$f" "$config_root/hooks/pre/$(basename "$f")"
    dim "  $config_root/hooks/pre/$(basename "$f")"
  done
  for f in "$MOD"/hooks/post/*.ts "$MOD"/hooks/post/*.js; do
    [ -f "$f" ] || continue
    ln -sf "$f" "$config_root/hooks/post/$(basename "$f")"
    dim "  $config_root/hooks/post/$(basename "$f")"
  done
}
