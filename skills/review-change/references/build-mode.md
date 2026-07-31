# Build Mode

Build mode validates only the feature change from its branch point through the current working state.
Use the approved canonical `specs.html` and `tasks.html` as Authoritative intent and receive the implementation mode from the orchestrator so repair ownership is explicit.
Do not require committed work; `/build` deliberately leaves final version-control ownership to the user.

## Entry

1. Receive the feature directory, branch point, current head, working-tree changes, and complete changed-file list from the `/build` orchestrator; do not independently replace that supplied scope.
2. Read the approved spec, tasks, `CONTEXT.md`, and relevant ADRs.
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

## Feature-artifact synchronization

After source validation, documentation, and lint are clean, dispatch `fact-checker` on canonical `specs.html` and `tasks.html` from a cold context.
Re-derive factual claims from final code and Git history, correct the canonical HTML in place, preserve its semantic structure and stable task metadata, and record corrections in the report.
Inspect the fact-checker's changed-file result.
If either artifact changed, count it as a documentation repair round, restart at documentation check, rerun lint, and return to cold fact-checking; stop after the documentation stage's three-round limit or when a second clean pass leaves both files byte-for-byte unchanged.
Do not generate a Markdown companion or automatic diff-review artifact; `/visualize-diff` remains standalone.

Build mode runs `database-reviewer` conditionally, then cold-fact-checks canonical `specs.html` and `tasks.html` in place before rendering the final report for `review-artifact`.

## Review-to-done gate

The Review change report is the existing fourth `/build` gate.
Feedback, dispositions, and repair cycles remain inside that one gate.
Approval ends the pipeline, but the user alone decides whether and when to commit.
