# Consolidate Refactor & Cleanup Components — PRD

## Problem Statement

The catalog carries three components that all claim behavior-preserving code improvement, and the boundaries between them are muddled. The post-implementation review chain runs two of them back-to-back — a "Clean up" step (the `code-cleaner` skill) and a "Refactor cleanup" step (the `refactor-cleaner` agent) — whose job descriptions overlap by roughly 80%: both remove dead code and unused imports, and both consolidate duplicated logic. Meanwhile a third component, the `refactor` skill (backed by the `refactorer` agent), owns user-directed restructuring. Anyone maintaining the catalog has to answer "which cleaner is this, and why are there two?" — the author of this PRD couldn't, which is the problem.

The duplication also hides a real defect: `refactor-cleaner` instructs its agent to commit with descriptive messages, contradicting the repo-wide convention that nothing commits unless the user asks.

## Solution

Collapse the three components onto **one execution engine with two modes**, per ADR-0015:

- The `refactorer` agent becomes the single engine for all behavior-preserving change. Its existing plan-execution behavior becomes **plan mode**; a new **hygiene mode** absorbs everything the two cleaners did (dead code, unused imports and dependencies, duplicate consolidation, simplification, idiom fixes).
- The review chain's two cleanup steps become one step, **"Refactor"**, which invokes the engine in hygiene mode — no approval gate, because a hygiene sweep applies only SAFE changes and reports the rest.
- The `refactor` skill remains the user-facing front-end and gains **goal-specificity routing**: a specific structural goal takes the existing plan → approve → execute path; a vague goal ("clean up X") dispatches a hygiene sweep directly instead of being rejected.
- The `code-cleaner` skill and `refactor-cleaner` agent are deleted, and the contradictory commit instruction dies with them.

The distinction the catalog now teaches is **hygiene sweep** (automatic, plan-less, SAFE-only) versus **directed refactor** (user goal, plan-gated) — pinned in the glossary.

## User Stories

1. As a catalog maintainer, I want exactly one component responsible for post-implementation cleanup, so that I never have to explain why two near-identical cleaners run back-to-back.
2. As a `/build` user, I want the review chain to sweep my changed files once instead of twice, so that the post-implementation phase is faster and its report isn't split across two overlapping steps.
3. As a `/refactor` user with a specific goal, I want the existing plan → approve → execute path unchanged, so that directed refactors keep their safety gate.
4. As a `/refactor` user with a vague goal ("clean up the auth module"), I want the skill to run a hygiene sweep on that area instead of rejecting me, so that I have a standalone entry point for cleanup after `code-cleaner` disappears.
5. As a `/implement` user, I want the hygiene sweep to apply SAFE changes automatically and only report CAREFUL/RISKY findings, so that the chain runs unattended without risky deletions slipping through.
6. As an `/implement-coach` user, I want CAREFUL/RISKY hygiene findings surfaced to me for decision while mechanical fixes are applied directly, so that the coach-mode ownership split survives the merge.
7. As a catalog maintainer, I want the engine to never commit in either mode, so that the contradictory commit instruction in `refactor-cleaner` cannot resurface.
8. As a catalog maintainer, I want the retired names (`code-cleaner`, `refactor-cleaner`) purged from every skill, agent, reference, and doc, so that no component instructs the model to invoke something that no longer exists.
9. As a catalog maintainer, I want the content-check pipeline to enforce the new shape (and reject the retired names), so that a future edit can't silently reintroduce the split.
10. As a future contributor reading the glossary, I want "hygiene sweep" and "directed refactor" defined with an explicit avoid-list, so that the vocabulary that caused this confusion stays pinned.
11. As an `/improve-codebase` user, I want that skill's boundary note to point at the hygiene sweep instead of the two retired components, so that its scope contrast stays accurate.
12. As a pi/oh-my-pi user, I want the consolidated components to keep working across all harnesses, so that the merge doesn't regress the multi-harness contract.

## Implementation Decisions

- **One engine, two modes (ADR-0015).** The `refactorer` agent gains a mode switch driven by its input: given a numbered transformation plan, it runs plan mode exactly as today; given a changed-file list and no plan, it runs hygiene mode. No new agent is created.
- **Hygiene mode duties** are the union of the two retired components: dead-code detection and removal, unused import and unused dependency cleanup, duplicate consolidation into existing helpers, simplification (early returns, built-ins over hand-rolled loops), and language-idiom fixes.
- **Risk policy in hygiene mode:** SAFE changes applied directly with grep verification and a test run per batch; CAREFUL and RISKY findings reported, never auto-applied. The SAFE/CAREFUL/RISKY vocabulary is retained but its meaning is mode-dependent — deletion risk in hygiene mode, transformation risk in plan mode (recorded in ADR-0015).
- **Never commit, either mode.** Stated in the engine's safety rules; the review chain no longer carries any commit warning. The refactor skill keeps its own never-commit guardrails as defense in depth — the engine rule is what makes the retired agent's contradictory instruction unrepresentable.
- **Review chain shrinks by one step.** The former "Clean up" and "Refactor cleanup" steps become a single "Refactor" step that dispatches the engine in hygiene mode on the changed files. The coach-mode split (mechanical fixes applied, judgment calls surfaced) moves into that step's wording.
- **Goal-specificity routing in the `refactor` skill.** Specific goal → existing plan path, unchanged. Vague goal → hygiene dispatch on the named area, with the SAFE-apply/report contract, skipping the plan interview. The skill's former "reject vague goals" rule is retired.
- **Deletions:** the `code-cleaner` skill directory and the `refactor-cleaner` agent definition. Every reference in the pipeline skills, the orchestrator, `improve-codebase`, the repo README, the example README, the authoring contract, and the visual guides is rewritten to the new shape.
- **Naming constraint honored:** the review-chain step is called "Refactor" (prose), the engine keeps the name `refactorer`, and the skill keeps `/refactor` — no collision, and no skill shadows the built-in `/simplify`.
- **Glossary and ADR are already written** (this session): **Hygiene sweep** and **Directed refactor** entries in the glossary; ADR-0015 records the shape, the partial reversal of the 20260310 decision, and the no-gate rationale.

## Testing Decisions

A good test in this repo validates the **authoring contract over the markdown**, not the prose itself: the content-check pipeline greps each component (with its transitively gathered references) for load-bearing patterns, the cross-ref check proves every agent a skill references actually exists, and the meta-suite proves the pipeline still catches planted errors. Tests attach to those stable seams — the make targets — not to individual sentences.

- **`refactorer` engine** — direct content checks: both mode names present, hygiene duties present (dead code, unused dependencies, duplication, simplification), SAFE-apply/CAREFUL-report policy present, never-commit present. RED first: the checks are updated before the agent body.
- **Review chain (via `implement` and `implement-coach` phase checks)** — updated to require `refactorer` and hygiene wording where they previously required the two retired names, and extended to **reject** any occurrence of `code-cleaner` or `refactor-cleaner` in gathered content, so the split cannot silently return.
- **`refactor` skill** — existing content checks extended with the routing rule: vague goal → hygiene dispatch, specific goal → plan gate ("Wait for the user" assertions unchanged).
- **Deletions** — covered through the cross-ref check (no dangling agent references) plus explicit absence assertions for the retired skill directory and agent file.
- **Prose reference updates** (orchestrator, `improve-codebase`, READMEs, authoring contract, guides) — covered through the same content pipeline and the rejection checks; no separate direct tests (shallow mentions).
- **The content-check changes themselves** — guarded by the meta-suite (`test/meta`), which verifies the pipeline catches planted errors; the full gate (`make test`) must pass at completion.
- **Prior art:** the phase check-functions for implement/implement-coach and the cross-ref agent-existence checks already in the pipeline are the direct model for every new assertion.

## Out of Scope

- Any change to the `refactor` skill's plan-mode workflow (plan format, 15-file scope warning, revert protocol, feedback loop).
- Any change to the other review-chain steps (`database-reviewer`, `code-reviewer`, `doc-updater`, `fact-checker`, visuals, diff review) beyond renumbering.
- `improve-codebase`'s own deepening workflow — only its boundary note changes.
- The built-in `/simplify` skill (harness-provided, not ours).
- Retroactive edits to the 20260310 feature documents — they are historical records; ADR-0015 records the reversal.
- New hygiene capabilities neither cleaner had (e.g. automated dependency upgrades, formatting sweeps).

## Further Notes

- The 20260310 research explicitly kept `refactor` standalone *because* `refactor-cleaner` owned cleanup. ADR-0015 supersedes that rationale: separation of concerns survives as two modes of one engine rather than two components.
- Hygiene mode trades the inline-session context the `code-cleaner` skill had (it knew what was just implemented) for subagent isolation (cleanup token-churn stays out of the main session after long implement runs). The changed-file list passed at dispatch is the compensation.
- The engine, as an agent, is shared verbatim across harnesses like every other agent in the catalog; the review chain already invokes agents via each harness's task mechanism, so no harness-module work is expected.

## Verification Summary

Fact-checked 2026-07-09 against the implemented working tree (branch `refactor/consolidate-refactor-cleanup`).

- **Claims checked:** 14 verifiable claims (chain step count and ordering, component deletions, engine mode contract, risk-vocabulary duality, retired commit instruction on main, glossary/ADR existence, naming constraints, story count).
- **Confirmed:** 13 — including: review chain has exactly 8 steps with "Refactor" at step 2 invoking `refactorer` in hygiene mode; `skills/code-cleaner/` and `agents/refactor-cleaner.md` deleted; the engine's two-mode contract and never-commit rule pinned by `test_agent_refactorer`; `refactor-cleaner`'s "Commit with descriptive messages" line verified present on `main`; ADR-0015 and both glossary entries exist.
- **Corrected:** 1 — the "Never commit" decision claimed the refactor skill would drop its per-step commit warnings; the implemented skill deliberately retains them as defense in depth (only the review chain dropped commit wording). Sentence updated to match.
- **Unverifiable:** none.
