# pi harness module manifest (sourced by install.sh, ADR-0010/0011/0013).
#
# pi (@earendil-works/pi-coding-agent) reads its config from ~/.pi/agent. It is
# a different engine from oh-my-pi but exposes the same tool_call adapter shape,
# so its guardrail adapter (extensions/guard-policies.ts) is a thin twin that
# routes the shared guard core (tier A, ADR-0011/0012) — no detection logic of
# its own. pi has no built-in permission system, so that extension is its whole
# policy layer (sandboxing is a separate, deferred concern).
#
# pi has no native rulebook, so the shared advisory rules reach it via
# individual rule files symlinked into ~/.pi/agent/rules/ (available for
# sub-agents to read on demand) — not as a generated AGENTS.md concatenation.

config_root="$HOME/.pi/agent"
consumed_categories=(skills agents rules)

# pi does not have a native commands/ resource type — its only /-triggered
# resources are prompt templates (prompts/), skills (/skill:name), built-in
# commands, and extension-registered commands. Commands are a Claude Code
# concept not used here.

instruction_target=""

install_module() {
  ln -sf "$MOD/settings.json" "$config_root/settings.json"
  dim "  $config_root/settings.json"

  mkdir -p "$config_root/extensions"
  prune_dangling "$config_root/extensions"

  # pi auto-discovers extensions from extensions/, but — unlike oh-my-pi — it
  # does NOT realpath-resolve a symlinked extension, so the adapter can't reach
  # the repo's shared/ via a relative import through a symlink. We therefore
  # ship a committed, self-contained BUNDLE (built by `make bundle`, kept current
  # by a gate drift-check) and symlink that: with no relative imports there is
  # nothing for pi to fail to resolve. Keeping install.sh symlink-only (no bun)
  # also keeps the install loop toolchain-free.
  ln -sf "$MOD/guard-policies.bundle.ts" "$config_root/extensions/guard-policies.ts"
  dim "  $config_root/extensions/guard-policies.ts (bundled guard)"

  # Subagent extension — ships as an example with pi. Symlinked if present;
  # skipped gracefully on a system where pi is not installed.
  local pi_subagent_src="/opt/pi-coding-agent/examples/extensions/subagent"
  if [ -d "$pi_subagent_src" ]; then
    mkdir -p "$config_root/extensions/subagent"
    ln -sf "$pi_subagent_src/index.ts" "$config_root/extensions/subagent/index.ts"
    ln -sf "$pi_subagent_src/agents.ts" "$config_root/extensions/subagent/agents.ts"
    dim "  $config_root/extensions/subagent/ (subagent extension)"
  fi

  # Clean up directories no longer consumed or managed by pi.
  # commands/ was previously mirrored but pi doesn't use it;
  # prompts/ was a user-side arrangement that duplicates the skill entries.
  for stale in commands prompts; do
    if [ -d "$config_root/$stale" ]; then
      # Remove all symlinked .md files placed by this repo or the user
      find "$config_root/$stale" -maxdepth 1 -type l -name "*.md" -delete 2>/dev/null || true
      # Remove the directory itself if now empty
      rmdir "$config_root/$stale" 2>/dev/null && \
        dim "  $config_root/$stale — removed (not used by pi)" || \
        dim "  $config_root/$stale — cleaned symlinks (dir kept, has non-repo content)"
    fi
  done
}
