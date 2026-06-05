# Single modular repo with pluggable harness modules; isolation by explicit mirror

The repo configures multiple harnesses from one source, but adding or removing one is friction: `install.sh` carries a hand-written ~40-line block per harness, and harness-specific config is interleaved with shared content. With **pi** about to be added (and **oh-my-pi** a removal candidate), we needed add/remove to be a one-directory operation. We **keep a single repo** and restructure so each harness is a self-contained **module**; we **rejected separate repos per harness and git submodules**.

## Considered options

- **Separate repo per harness.** Rejected: re-introduces the N-way drift the unified repo exists to kill, and these are one conceptual thing (the user's AI config). The deprecated `pi-config` repo was a clean-room refactor sandbox, *not* a split experiment — it provides no evidence for splitting, and its changes were melded back here.
- **Git submodule for shared content.** Rejected: submodule friction (detached HEADs, two-step commits, update choreography) outweighs the benefit when one repo with a curated shared set achieves the same DRY.
- **Single repo, modular per-harness (chosen).** Each harness is a directory holding its runtime config, its guardrail adapter (see ADR-0011), and a declaration of its **config root** and consumed shared categories. `install.sh` becomes a generic loop over whatever modules exist. Flat shared dirs (`skills/`, `commands/`, `agents/`, advisory `rules/`) stay symlink-shared exactly as before — ADR-0001 and ADR-0005 remain in force *for shared content*; only harness-specific config moves into a module.

## Isolation pillar

Modularity alone doesn't stop one harness's config from polluting another. Harnesses ship **cross-discovery** providers that scavenge sibling config roots — oh-my-pi natively reads `~/.claude/skills/` at priority 80. ADR-0001 mirrored to oh-my-pi's *native* priority to win collisions but left that fallback **enabled**, so the leak path stayed open. We close it:

- **Each config root is owned exclusively by one module.** `install.sh` *pushes* the curated shared set into each root; nothing is *pulled* by a harness reaching into a sibling's home dir.
- **Cross-discovery is disabled** (`skills.enableClaudeUser: false`, etc.), converting implicit, uncontrolled sharing into an explicit, auditable mirror.
- **An isolation test makes it an invariant, not a hope:** each config root must contain only `{its module's files} ∪ {the curated shared set}`, with no symlink resolving into a sibling harness's directory and cross-discovery flags off. A leak fails CI.

This extends ADR-0001's "full mirror over delegation" from *priority insulation* to *full scavenge-disable*, and it is the security counterpart to ADR-0005's "honest, explicit divergence" posture.

## Consequences

- Adding **pi** is a deferred follow-up effort: drop in a module, run install. Removing **oh-my-pi** is now decided on its *merits* (do we use it?), not on a pollution fear — the fear had a clean fix (disable cross-discovery), so the two questions are decoupled.
- `install.sh` shrinks to a module loop instead of per-harness blocks.
- The repo gains two CI-checked invariants that travel together: the **isolation test** (here) and the **conformance test** (ADR-0011).
- Runtime VM **sandboxing** (e.g. Gondolin for pi) is a separate, orthogonal concern — not what "isolation" means in this ADR.
