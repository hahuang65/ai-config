# pi harness module manifest (sourced by install.sh, ADR-0010/0011/0013).
#
# pi (@earendil-works/pi-coding-agent) reads its config from ~/.pi/agent.
# Its guardrail adapter (extensions/guard-policies.ts) routes the shared guard
# core (tier A, ADR-0011/0012) with no detection logic of its own. pi has no
# built-in permission system, so that extension is its whole policy layer
# (sandboxing is a separate, deferred concern).
#
# pi has no native rulebook. Main sessions and isolated subagents read detailed
# rules on demand from the canonical ~/.dotfiles/ai/rules/ directory.

config_root="$HOME/.pi/agent"
consumed_categories=(skills agents)
command_target="prompts"

# Small always-on bootstrap: critical baseline plus lazy-rule load triggers.
instruction_target="AGENTS.md"

resolve_pi_subagent_source() {
  local pi_bin; pi_bin="$(command -v pi 2>/dev/null)" || return 0
  [ -n "$pi_bin" ] && [ -x "$pi_bin" ] || return 0

  case "$pi_bin" in
    /*) ;;
    *) pi_bin="$(pwd -P)/$pi_bin" ;;
  esac

  local brew_pkg="libexec/lib/node_modules/@earendil-works/pi-coding-agent"
  local pi_bin_dir="${pi_bin%/*}"
  local stable_homebrew_source="${pi_bin_dir%/*}/opt/pi-coding-agent/$brew_pkg/examples/extensions/subagent"
  if [ "${pi_bin_dir##*/}" = bin ] && [ -d "$stable_homebrew_source" ]; then
    printf '%s\n' "$stable_homebrew_source"
    return 0
  fi

  local pi_real; pi_real="$(readlink -f "$pi_bin" 2>/dev/null)" || pi_real="$pi_bin"
  case "$pi_real" in
    /*) ;;
    *) pi_real="$(pwd -P)/$pi_real" ;;
  esac

  local dir="${pi_real%/*}"
  while [ "$dir" != "/" ] && [ -n "$dir" ]; do
    if [ -d "$dir/examples/extensions/subagent" ]; then
      printf '%s\n' "$dir/examples/extensions/subagent"
      return 0
    fi
    if [ -d "$dir/$brew_pkg/examples/extensions/subagent" ]; then
      printf '%s\n' "$dir/$brew_pkg/examples/extensions/subagent"
      return 0
    fi
    local parent="${dir%/*}"
    [ "$parent" = "$dir" ] && break
    dir="$parent"
  done
}

remove_pi_example_agent_links() {
  local agent link raw
  for agent in planner reviewer scout worker; do
    link="$config_root/agents/$agent.md"
    [ -L "$link" ] || continue
    raw="$(readlink "$link" 2>/dev/null || true)"
    case "$raw" in
      */pi-coding-agent/examples/extensions/subagent/agents/"$agent".md) rm -f "$link" ;;
    esac
  done
}

install_module() {
  # Remove former per-harness resources; preserve unrelated user files.
  prune_repo_rule_links "$config_root/rules"
  prune_repo_command_links "$config_root/commands"

  # Copy base settings once (regular file, not symlink) so pi can write
  # runtime fields (lastChangelogVersion, etc.) without dirtying git.
  # Machine-specific edits (model, etc.) go directly into the installed copy.
  # Use install.sh --force to overwrite an existing copy with the repo base.
  [ -L "$config_root/settings.json" ] && rm "$config_root/settings.json"
  if [ ! -f "$config_root/settings.json" ] || [ "${INSTALL_FORCE:-false}" = true ]; then
    cp "$MOD/settings.json" "$config_root/settings.json"
    dim "  $config_root/settings.json"
  else
    dim "  $config_root/settings.json — exists, skipping (--force to overwrite)"
  fi

  mkdir -p "$config_root/extensions" "$config_root/themes"
  prune_dangling "$config_root/extensions"
  prune_dangling "$config_root/themes"

  # pi auto-discovers extensions from extensions/, but it does not
  # realpath-resolve a symlinked extension, so the adapter can't reach
  # the repo's shared/ via a relative import through a symlink. We therefore
  # ship committed, self-contained bundles (built by `make bundle`, kept current
  # by gate drift-checks) and symlink them: with no relative imports there is
  # nothing for pi to fail to resolve. Keeping install.sh symlink-only (no bun)
  # also keeps the install loop toolchain-free.
  ln -sf "$MOD/guard-policies.bundle.ts" "$config_root/extensions/guard-policies.ts"
  ln -sf "$MOD/review-change-publication.bundle.ts" "$config_root/extensions/review-change-publication.ts"
  ln -sf "$MOD/work-log-reconcile.bundle.ts" "$config_root/extensions/work-log-reconcile.ts"
  dim "  $config_root/extensions/guard-policies.ts (bundled guard)"
  dim "  $config_root/extensions/review-change-publication.ts (trusted in-session Review publication boundary)"
  dim "  $config_root/extensions/work-log-reconcile.ts (Work log checkpoint safety net)"

  # Replace agentmemory's copied pi adapter with the managed explicit-recall
  # adapter while preserving its directory for compatibility with upgrades.
  mkdir -p "$config_root/extensions/agentmemory"
  prune_dangling "$config_root/extensions/agentmemory"
  ln -sf \
    "$MOD/extensions/agentmemory/client.ts" \
    "$MOD/extensions/agentmemory/commands.ts" \
    "$MOD/extensions/agentmemory/config.ts" \
    "$MOD/extensions/agentmemory/events.ts" \
    "$MOD/extensions/agentmemory/footer.ts" \
    "$MOD/extensions/agentmemory/index.ts" \
    "$MOD/extensions/agentmemory/runtime.ts" \
    "$MOD/extensions/agentmemory/support.ts" \
    "$MOD/extensions/agentmemory/tools.ts" \
    "$MOD/extensions/agentmemory/types.ts" \
    "$config_root/extensions/agentmemory"

  # These extensions are self-contained (type-only imports erase at transpile),
  # so unlike the guard they need no bundle — pi loads them through symlinks.
  ln -sf \
    "$MOD/extensions/agentmemory-owner.ts" \
    "$MOD/extensions/local-models.ts" \
    "$MOD/extensions/orchard.ts" \
    "$MOD/extensions/review-change-guard.ts" \
    "$MOD/extensions/review-change-progress.ts" \
    "$MOD/extensions/write-tool-highlights.ts" \
    "$config_root/extensions"
  dim "  $config_root/extensions/agentmemory/index.ts (optional explicit historical memory)"
  dim "  $config_root/extensions/agentmemory-owner.ts (agentmemory adapter repair)"
  dim "  $config_root/extensions/local-models.ts (local model auto-discovery)"
  dim "  $config_root/extensions/orchard.ts (Orchard session transitions)"
  dim "  $config_root/extensions/review-change-guard.ts (standalone Review change boundary)"
  dim "  $config_root/extensions/review-change-progress.ts (standalone Review change TUI telemetry)"
  dim "  $config_root/extensions/write-tool-highlights.ts (yellow write success backgrounds)"

  ln -sf "$MOD/themes/catppuccin-mocha.json" "$config_root/themes"
  dim "  $config_root/themes/catppuccin-mocha.json (default pi theme)"

  # The subagent runtime ships as a pi example. Homebrew installations use the
  # stable opt prefix so upgrades do not leave links to a removed Cellar version.
  # Other installation methods fall back to bounded package-root discovery.
  # Repository-managed agent definitions remain the only installed agents.
  remove_pi_example_agent_links
  local pi_subagent_src; pi_subagent_src="$(resolve_pi_subagent_source)"
  if [ -n "$pi_subagent_src" ] && [ -d "$pi_subagent_src" ]; then
    mkdir -p "$config_root/extensions/subagent"
    # Keep the upstream runner but adapt agent discovery locally: shared agent
    # frontmatter uses YAML tool arrays for Claude compatibility, while pi's
    # example parser accepts only comma-separated strings. The adapter handles
    # both and maps Claude's Glob tool to pi's find tool.
    ln -sf \
      "$pi_subagent_src/index.ts" \
      "$MOD/extensions/subagent/agents.ts" \
      "$MOD/extensions/subagent/tool-names.ts" \
      "$MOD/extensions/subagent/model-selection.ts" \
      "$config_root/extensions/subagent"
    dim "  $config_root/extensions/subagent/ (subagent extension + shared-agent adapter)"
  fi

}
