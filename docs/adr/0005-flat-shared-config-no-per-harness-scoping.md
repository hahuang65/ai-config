# Flat shared config; per-harness scoping only for runtime config files

The natural question when adding a 3rd harness with its own frontmatter conventions (omp's TTSR `condition:` / `scope:` keys, etc.) is whether to fork the source layout per harness — e.g. `rules/shared/`, `rules/claude/`, `rules/omp/`. We **rejected this** and kept the flat layout: every rule/skill/command/agent file lives at the top of its category directory and is symlinked into every harness's runtime root by `install.sh`. Per-harness directories exist only for the things that **genuinely** differ — the runtime config files themselves (`claude/settings.json`, `opencode/opencode.jsonc`, `omp/config.yml`).

The principle: **per-harness scoping is for content that differs per harness, not for metadata that happens to differ.** Today:

- Every rule body, skill body, command body, and agent body applies verbatim to every harness.
- Only the frontmatter keys differ (`condition:`/`scope:` are omp-only; `alwaysApply:` is omp-only).
- Each harness's YAML parser ignores keys it doesn't recognize — the omp-specific frontmatter is inert noise in Claude and OpenCode contexts.

Reasons we picked flat over scoped:

1. **Symlink-as-source is a load-bearing property.** `install.sh` symlinks the same file into multiple roots, and the user edits the source. Per-harness directories force either duplication (drift risk — the security rule body could fork) or a build step (overlay, preprocess) — both erode the property that makes "configure once, install everywhere" simple.
2. **The empirical noise cost is near-zero.** omp-specific frontmatter (`condition:`, `scope:`) lands in Claude's system prompt as YAML the parser strips before injection — same behavior Claude already applies to skill/agent/command frontmatter. The theoretical context tax is real, the observed context tax is not.
3. **The principle scales.** When we eventually hit a case where bodies *do* need to differ per harness (none today), we add a single per-harness file as a documented exception, not a structural reorg. Keep the simple case simple; pay complexity only when a real case demands it.
4. **OpenCode's existing gap is the proof.** OpenCode reads our skills and commands but not our rules. We didn't introduce per-harness scoping to handle that asymmetry — we just accepted it. The same posture works for omp's TTSR-specific keys.

Where the line *is* drawn: the three harness-specific runtime config files (`claude/settings.json`, `opencode/opencode.jsonc`, `omp/config.yml`) live in per-harness directories because their content is genuinely incompatible across harnesses. That's the correct granularity.

When to revisit: if a future harness has a rule/skill/command/agent format whose noise *isn't* parser-stripped — e.g. requires a fundamentally incompatible body syntax — we'd revisit by introducing the minimal per-harness exception for that case, not by reorganizing everything.
