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
consumed_categories=(skills commands agents rules)

# pi surfaces skills as /skill:name and commands as clean /name, so every
# command installs (no Claude-style duplicate-slash-command problem).
dedupe_commands_with_skills=false

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
}
