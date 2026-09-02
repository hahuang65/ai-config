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
  # ship a committed, self-contained BUNDLE (built by `make bundle`, kept current
  # by a gate drift-check) and symlink that: with no relative imports there is
  # nothing for pi to fail to resolve. Keeping install.sh symlink-only (no bun)
  # also keeps the install loop toolchain-free.
  ln -sf "$MOD/guard-policies.bundle.ts" "$config_root/extensions/guard-policies.ts"
  dim "  $config_root/extensions/guard-policies.ts (bundled guard)"

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

  # Subagent extension — ships as an example with pi. Symlinked if present;
  # skipped gracefully on a system where pi is not installed. Resolves the
  # subagent path dynamically from the pi binary's real location rather than
  # hardcoding a filesystem path that varies by install method (Homebrew,
  # npm -g, etc.).
  local pi_subagent_src=""
  local pi_bin; pi_bin="$(command -v pi 2>/dev/null)" || true
  if [ -n "$pi_bin" ] && [ -x "$pi_bin" ]; then
    local pi_real; pi_real="$(readlink -f "$pi_bin" 2>/dev/null)" || pi_real="$pi_bin"
    case "$pi_real" in
      /*) ;;
      *) pi_real="$(pwd -P)/$pi_real" ;;
    esac
    # The binary's depth within the package root varies by install method: under
    # bin/ (Homebrew/npm: .../bin/pi) or directly in the root (Linux tarball:
    # /opt/pi-coding-agent/pi). Homebrew adds a wrinkle: Cellar/<ver>/bin/pi is
    # a bash shim (not a symlink), so readlink -f stops outside the real npm
    # package root, which lives in the SIBLING subtree
    # libexec/lib/node_modules/@earendil-works/pi-coding-agent/. Walk up from
    # the binary probing both layouts, instead of hardcoding a dirname count.
    local dir="${pi_real%/*}"
    local brew_pkg="libexec/lib/node_modules/@earendil-works/pi-coding-agent"
    while [ "$dir" != "/" ] && [ -n "$dir" ]; do
      if [ -d "$dir/examples/extensions/subagent" ]; then
        pi_subagent_src="$dir/examples/extensions/subagent"
        break
      fi
      if [ -d "$dir/$brew_pkg/examples/extensions/subagent" ]; then
        pi_subagent_src="$dir/$brew_pkg/examples/extensions/subagent"
        break
      fi
      local parent="${dir%/*}"
      [ "$parent" = "$dir" ] && break
      dir="$parent"
    done
  fi
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

    # Agent definitions (scout, planner, reviewer, worker)
    if [ -d "$pi_subagent_src/agents" ]; then
      mkdir -p "$config_root/agents"
      local -a agent_files=("$pi_subagent_src"/agents/*.md)
      [ ${#agent_files[@]} -eq 0 ] || ln -sf "${agent_files[@]}" "$config_root/agents"
      dim "    $config_root/agents/ — subagent agent definitions"
    fi
  fi

}
