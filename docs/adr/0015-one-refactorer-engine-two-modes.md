# One refactorer engine with two modes replaces the separate cleanup components

The catalog carried three overlapping behavior-preserving-change components: the `code-cleaner` skill (review-chain step 2, "Clean up" — reuse, simplification, cruft removal, run inline), the `refactor-cleaner` agent (review-chain step 3, "Refactor cleanup" — dead code, unused dependencies, duplicate consolidation, run as a subagent), and the `refactor` skill + `refactorer` agent pair (standalone, user-directed transformations behind a plan-approval gate). The two chain steps were ~80% the same job run back-to-back on the same files, and `refactor-cleaner` carried a "commit with descriptive messages" instruction that contradicted the repo-wide never-commit convention.

We consolidated onto a single engine: the `refactorer` agent gains a second entry mode, and both cleanup components are deleted.

## Decision

- **`refactorer` is the single execution engine** for all behavior-preserving change, with two entry modes:
  - **Plan mode** (pre-existing): execute an approved numbered transformation plan incrementally, testing between steps, reverting on failure.
  - **Hygiene mode** (new — absorbs both cleaners): given changed files and no plan, sweep for dead code, unused imports/dependencies, duplication, simplification, and idiom fixes. SAFE changes applied directly; CAREFUL/RISKY findings reported, never auto-applied. Never commits.
- **Review-chain steps 2 and 3 collapse into one step, "Refactor"**, which invokes `refactorer` in hygiene mode (no approval gate — it runs unattended inside `/implement`).
- **`/refactor` routes by goal specificity** instead of rejecting vague goals: a specific structural goal gets the full plan → approve → execute path; a vague goal ("clean up X") dispatches hygiene mode on the named area directly.
- **`skills/code-cleaner/` and `agents/refactor-cleaner.md` are deleted.** Their unique capabilities (deletion-risk categories, dependency cleanup, simplify/idiom duties) fold into hygiene mode.

## Considered Options

- **Keep all three, sharpen the chain-step boundaries** — rejected: the naming confusion (clean up / refactor cleanup / refactor) survives, and the double sweep over the same files remains.
- **Merge the cleaners into one inline skill, leave `refactor` untouched** — rejected in favor of the engine shape: the user wanted the chain step named "refactor", which collides with the skill name unless the merged component is an agent; and the safety cores of `refactorer` and `refactor-cleaner` were already identical, making the agent the natural home.

## Consequences

- This partially reverses the 20260310 decision (`docs/features/20260310-1141-refactor-skill-agent/plan.md`) that kept `/refactor` standalone *because* `refactor-cleaner` owned cleanup — the separation of concerns survives, but as two modes of one agent rather than two components.
- The review chain invokes `refactorer` **without** the plan-approval gate its namesake skill requires. The gate belongs to directed refactors (user-named goals), not hygiene sweeps — a future reader should not "fix" the chain by adding an approval step.
- Hygiene mode loses the inline-session context `code-cleaner` had (the subagent starts cold and must be told the changed files), traded for keeping cleanup token-churn out of the main session after long `/implement` runs.
- The risk vocabulary is unified but context-dependent: SAFE/CAREFUL/RISKY measures *deletion* risk in hygiene mode and *transformation* risk in plan mode.
- See the **Hygiene sweep** and **Directed refactor** glossary entries in `CONTEXT.md`.
