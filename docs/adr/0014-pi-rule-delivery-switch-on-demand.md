# Pi advisory rules switch from always-on (AGENTS.md) to on-demand (individual files)

The pi harness (`@earendil-works/pi-coding-agent`) originally received its advisory rules (coding-style, testing, security, performance, git-commit, mise) as a committed, generated concatenation symlinked as `~/.pi/agent/AGENTS.md` — always-on, every turn (ADR-0013).

Two factors motivated the reversal: the per-turn token cost of always-on injection (~2,700 tokens every turn, even during phases where no rule is relevant), and the need for pi to support sub-agents spawned during the build pipeline's review chain (which require individual rule files to `read` explicitly, matching the pattern Claude Code and oh-my-pi already use).

Rules are now delivered to pi as individual files at `~/.pi/agent/rules/` (symlinked by the generic install loop) and loaded on demand — the AI reads them when entering a rules-relevant phase. This matches oh-my-pi's on-demand delivery (via `rule://<name>`), while Claude Code keeps its native always-on auto-injection.

## Decision

- **pi no longer carries an always-on rules concatenation.** The generated `harnesses/pi/advisory-rules.md`, its generation script (`scripts/gen-pi-agents.sh`), and the `make rules` target are all removed.
- **`rules` is added to pi's `consumed_categories`**, so the generic install loop symlinks individual rule files into `~/.pi/agent/rules/`, matching the pattern Claude Code and oh-my-pi already use.
- **Sub-agent rules are read on demand.** Build-pipeline skills instruct pi to `read from ~/.pi/agent/rules/` when entering a rules-relevant phase. Agent files list `~/.pi/agent/rules/` as a lookup path for spawned sub-agents.

## Consequences

- Pi users save ~2,700 tokens per turn during grilling, task breakdown, and casual sessions — roughly half a dollar per full build session.
- The `rules/` category is now consumed by all three harnesses, simplifying the install model: one generic loop path, no per-harness special-casing.
- The three harnesses now have three different always-on/on-demand profiles: Claude (always-on), oh-my-pi (on-demand via rulebook), pi (on-demand via files). There is no single shared delivery mechanism — each harness uses what its native context model supports.
- ADR-0013 is superseded for its rules-projection mechanism but its other consequences (the guard extension bundling, the AGENTS.md naming convention to avoid gitignore confusion) remain unaffected.
- The "always-on concatenation" pattern is deliberately not replicated for any other harness. Future harness additions should use either individual file mirroring (pi/omp pattern) or their native always-on mechanism if they have one.
