# Build Mode

Build mode validates only the feature change from its branch point through the current working state.
Receive and read approved `mockups.html` when present with canonical `specs.html` and `tasks.html` as Authoritative intent, and receive the implementation mode from the orchestrator so repair ownership is explicit.
Do not require committed work; `/build` deliberately leaves final version-control ownership to the user.

## Entry

1. Receive the feature directory, branch point, current head, working-tree changes, and complete changed-file list from the `/build` orchestrator; do not independently replace that supplied scope.
2. Read the approved mockup when present, spec, tasks, selected context documentation, and relevant decision records.
Use their **ubiquitous language**: the shared canonical vocabulary used by domain experts, users, documentation, tests, and code.
3. Record whether implementation used AI code mode or coached mode, plus every final implementation verification command, scope, and outcome supplied by Phase 4.
Label that result as prior broad Validation evidence in the final report and never rerun it during Review change.
4. Run the fixed validation kernel and repair loop without introducing another approval gate before the report.

## Specialist database Findings

If the change contains SQL, migrations, schema changes, ORM operations, transaction logic, or database configuration, dispatch `database-reviewer` read-only on the same feature scope.
Normalize its substantiated results into the common Finding fields and pass them to the fresh Change reviewer for one combined risk assessment.
Do not let the specialist edit code, run mutating queries, or widen review beyond changed database behavior.

## Documentation stage

Ask the Change reviewer to identify change-caused documentation gaps, stale examples, broken references, and misplaced duplicate facts.
In AI build mode, dispatch selected objective gaps to the Change fixer and restart at documentation check.
In coached mode, documentation may be repaired automatically while source and test ownership stays with the user.
Do not modify generated changelogs or create a new documentation surface when an authoritative owner already exists.

## Mockup validation evidence

When approved `mockups.html` is present, validate its authoritative interaction, hierarchy, state, responsive, and accessibility decisions with the smallest available evidence: focused behavior tests, browser checks, rendered screenshots, or documented manual checks.
Report material implementation drift rather than harmless pixel differences or directional decorative changes.
When the environment provides insufficient UI evidence, emit an `ask-user` Finding instead of claiming conformance.
Do not rewrite approved mockup intent to match an implementation that drifted from it.

## Material UI redesign during final review

Ordinary conformance repair corrects the implementation to the approved artifacts and remains inside the existing fourth Review-to-done gate.
When the user deliberately requests a material UI redesign during final Review change, use this return path instead:

1. Pause final Review change; do not process the redesign as ordinary conformance repair.
2. Update the canonical `mockups.html` through the `mockup` and `review-artifact` workflows until the user gives explicit approval.
3. Synchronize canonical `specs.html` and `tasks.html` with the newly approved mockup.
4. Renew every approval invalidated by the refreshed intent at its existing gate.
5. Restart Review change with the refreshed Authoritative intent and a fresh complete validation scope.

This return path reuses the existing boundaries and keeps exactly four approval gates; it does not create a fifth gate.

## Feature-artifact synchronization

After source validation, documentation, and lint are clean, dispatch `fact-checker` on canonical `specs.html` and `tasks.html` from a cold context.
Re-derive factual claims from final code and Git history, correct the canonical HTML in place, preserve its semantic structure and stable task metadata, and record corrections in the report.
Inspect the fact-checker's changed-file result.
If either artifact changed, count it as a documentation repair round, restart at documentation check, rerun lint, and return to cold fact-checking; stop after the documentation stage's three-round limit or when a second clean pass leaves both files byte-for-byte unchanged.
Do not generate a Markdown companion or automatic diff-review artifact; `/visualize-diff` remains standalone.

Build mode runs `database-reviewer` conditionally, validates approved mockup intent when present, then cold-fact-checks canonical `specs.html` and `tasks.html` in place before rendering the final report for `review-artifact`.

## Review-to-done gate

The Review change report is the existing fourth `/build` gate.
Feedback, dispositions, and repair cycles remain inside that one gate.
Approval ends the pipeline, but the user alone decides whether and when to commit.
