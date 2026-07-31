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

# pi does not have a native commands/ resource type — its only /-triggered
# resources are prompt templates (prompts/), skills (/skill:name), built-in
# commands, and extension-registered commands. Commands are a Claude Code
# concept not used here.

# Small always-on bootstrap: critical baseline plus lazy-rule load triggers.
instruction_target="AGENTS.md"

install_module() {
  # Remove the former per-harness rule mirror; preserve unrelated user files.
  prune_repo_rule_links "$config_root/rules"

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

  mkdir -p "$config_root/extensions"
  prune_dangling "$config_root/extensions"

  # pi auto-discovers extensions from extensions/, but it does not
  # realpath-resolve a symlinked extension, so the adapter can't reach
  # the repo's shared/ via a relative import through a symlink. We therefore
  # ship a committed, self-contained BUNDLE (built by `make bundle`, kept current
  # by a gate drift-check) and symlink that: with no relative imports there is
  # nothing for pi to fail to resolve. Keeping install.sh symlink-only (no bun)
  # also keeps the install loop toolchain-free.
  ln -sf "$MOD/guard-policies.bundle.ts" "$config_root/extensions/guard-policies.ts"
  dim "  $config_root/extensions/guard-policies.ts (bundled guard)"

  # local-models.ts is self-contained (type-only imports erase at transpile),
  # so unlike the guard it needs no bundle — pi loads it fine through a symlink.
  ln -sf "$MOD/extensions/local-models.ts" "$config_root/extensions/local-models.ts"
  dim "  $config_root/extensions/local-models.ts (local model auto-discovery)"

  # Active only inside the standalone Change review CLI process tree.
  # It blocks structured writes and common mutation commands inside the CLI's
  # disposable clone, plus Git/provider delivery mutation across the process tree.
  ln -sf "$MOD/extensions/change-review-guard.ts" "$config_root/extensions/change-review-guard.ts"
  dim "  $config_root/extensions/change-review-guard.ts (standalone Change review boundary)"
  ln -sf "$MOD/extensions/change-review-progress.ts" "$config_root/extensions/change-review-progress.ts"
  dim "  $config_root/extensions/change-review-progress.ts (standalone Change review TUI telemetry)"

  # Subagent extension — ships as an example with pi. Symlinked if present;
  # skipped gracefully on a system where pi is not installed. Resolves the
  # subagent path dynamically from the pi binary's real location rather than
  # hardcoding a filesystem path that varies by install method (Homebrew,
  # npm -g, etc.).
  local pi_subagent_src=""
  local pi_bin; pi_bin="$(command -v pi 2>/dev/null)" || true
  if [ -n "$pi_bin" ] && [ -x "$pi_bin" ]; then
    local pi_real; pi_real="$(readlink -f "$pi_bin" 2>/dev/null)" || pi_real="$pi_bin"
    # The binary's depth within the package root varies by install method: under
    # bin/ (Homebrew/npm: .../bin/pi) or directly in the root (Linux tarball:
    # /opt/pi-coding-agent/pi). Homebrew adds a wrinkle: Cellar/<ver>/bin/pi is
    # a bash shim (not a symlink), so readlink -f stops outside the real npm
    # package root, which lives in the SIBLING subtree
    # libexec/lib/node_modules/@earendil-works/pi-coding-agent/. Walk up from
    # the binary probing both layouts, instead of hardcoding a dirname count.
    local dir; dir="$(dirname "$pi_real")"
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
      dir="$(dirname "$dir")"
    done
  fi
  if [ -n "$pi_subagent_src" ] && [ -d "$pi_subagent_src" ]; then
    mkdir -p "$config_root/extensions/subagent"
    ln -sf "$pi_subagent_src/index.ts" "$config_root/extensions/subagent/index.ts"
    # Keep the upstream runner but adapt agent discovery locally: shared agent
    # frontmatter uses YAML tool arrays for Claude compatibility, while pi's
    # example parser accepts only comma-separated strings. The adapter handles
    # both and maps Claude's Glob tool to pi's find tool.
    ln -sf "$MOD/extensions/subagent/agents.ts" "$config_root/extensions/subagent/agents.ts"
    ln -sf "$MOD/extensions/subagent/tool-names.ts" "$config_root/extensions/subagent/tool-names.ts"
    ln -sf "$MOD/extensions/subagent/model-selection.ts" "$config_root/extensions/subagent/model-selection.ts"
    dim "  $config_root/extensions/subagent/ (subagent extension + shared-agent adapter)"

    # Workflow prompt templates (e.g. /implement, /scout-and-plan)
    if [ -d "$pi_subagent_src/prompts" ]; then
      mkdir -p "$config_root/prompts"
      for f in "$pi_subagent_src"/prompts/*.md; do
        name="$(basename "$f")"
        ln -sf "$f" "$config_root/prompts/$name"
      done
      dim "    $config_root/prompts/ — subagent workflow prompts"
    fi

    # Agent definitions (scout, planner, reviewer, worker)
    if [ -d "$pi_subagent_src/agents" ]; then
      mkdir -p "$config_root/agents"
      for f in "$pi_subagent_src"/agents/*.md; do
        name="$(basename "$f")"
        ln -sf "$f" "$config_root/agents/$name"
      done
      dim "    $config_root/agents/ — subagent agent definitions"
    fi
  fi

  # Clean up directories no longer consumed or managed by pi.
  # commands/ was previously mirrored but pi doesn't use it.
  # prompts/ is consumed by pi for prompt templates (e.g. /implement, /scout-and-plan)
  # so we keep it.
  for stale in commands; do
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
