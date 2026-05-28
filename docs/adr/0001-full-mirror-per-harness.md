# Full per-harness mirror, not cross-harness discovery

omp natively discovers `~/.claude/skills/` and `~/.claude/commands/` at priority 80 via its built-in Claude provider, so a "minimal" integration could install only an omp-specific `config.yml` and let omp scavenge from the Claude install. We deliberately rejected that and chose to **symlink `skills/`, `commands/`, `rules/`, and `agents/` into `~/.omp/agent/` from `install.sh`**, exactly mirroring the existing Claude and OpenCode loops, even though it creates three-way symlink fanout to the same source files.

Reasons we picked redundant install over delegation:

1. **Priority insulation.** Mirrored into `~/.omp/agent/`, our config loads at omp's native priority (100). Discovery-only would load at priority 80, where any other third-party `.omp` skill the user installs later silently wins on name collisions.
2. **No source-toggle dependency.** Discovery-only relies on omp's `skills.enableClaudeUser` / `commands.enableClaudeUser` / etc. settings staying enabled. A user flipping them off in their personal `config.yml` would silently break our integration.
3. **Asymmetric carve-out for rules.** omp has no Claude rule provider — `~/.claude/rules/` is invisible to omp regardless. Discovery-only would have meant "everything via Claude fallback except rules, which need a one-off omp symlink." Mirroring everywhere removes that special case.
4. **Repo philosophy.** The stated goal is "a single configuration that can power any arbitrary AI harness" — that's configure-once-install-everywhere, not configure-for-Claude-and-let-others-scavenge. Treating each harness as a first-class peer in install.sh makes adding a 4th harness later a copy-paste exercise.

The cost is acceptable: omp's skill/command/rule loaders all dedup by `realpath` (symlink-safe), so the same file referenced from three symlink paths is loaded once at runtime. Disk and load-time overhead are zero; only `install.sh` grows by ~15 lines.
