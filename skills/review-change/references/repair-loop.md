# Repair and Rereview

AI build mode permits at most three fix/recheck rounds per validation stage.
The initial adversarial review and every final convergence review dispatch a fresh complete Change reviewer, which never receives Change fixer rationale.
Intermediate source or test repairs use a targeted rereview of the current-round delta and its dependency closure instead of another complete review.

## Decision ledger

Carry the Finding decision ledger between rounds.
Keep any orchestrator material-change assessment in private workflow history.
The targeted reviewer-facing decision ledger projection contains only stable Finding IDs, explicit user dispositions and instructions, repair round, and reviewed state; it never carries a material-change judgment.
Do not carry private reviewer or fixer chain-of-thought, session history, or rationale.
A user-dispositioned Finding remains closed unless the targeted reviewer establishes from current source that materially changed code creates a distinct problem.

## Review manifest

Before each Change reviewer dispatch, assemble a Review manifest as routing data rather than review evidence.
Every manifest contains the review kind, immutable full scope or exact working state, complete changed-file list, Authoritative intent provenance, and a content record for each routed path.
Each content record identifies path state as present, deleted, or renamed and uses an explicit tombstone for an absent endpoint.
For a complete review, records compare base and current states and identities; for a targeted rereview, records compare round-start and post-round states and identities, including deletion or rename of a path that did not exist at the immutable base.
A complete Review manifest can include substantiated specialist Findings for normalization.
A targeted Review manifest contains the repaired Finding IDs, their neutral prior Finding records, the reviewer-facing decision ledger projection, the actual current-round delta, the dependency closure of affected callers, interfaces, shared state, tests, and invariants, and the prior Inspection ledger for unchanged content identities.
Targeted routing excludes specialist Finding evidence summaries and repair directions; relevant specialist defects travel only as neutral prior Finding records.
Prior Finding records contain stable ID, original anchor, and source-verifiable invariant or acceptance statement without reviewer reasoning or Change fixer rationale.
The prior Inspection ledger is coverage routing data, not reviewer reasoning or Change fixer rationale.
An Inspection ledger carries only neutral interface and invariant identifiers and never behavior conclusions, evidence summaries, Finding judgments, or rationale.
Use the Change fixer's changed files and affected interfaces only to seed the dependency closure, never as the authoritative current-round delta.
If the manifest cannot reconcile a path state or content identity with the current working state, stop instead of reviewing stale content.

Carry the prior Inspection ledger only into a targeted rereview so unchanged content with the same identity does not need another read.
A final complete review starts with a new Inspection ledger and independently covers the complete change.

## Coherent repair batches

Partition selected Findings into coherent repair batches by shared component, interface, state transition, or invariant.
Merge batches whose authorized files or behavior overlap.
Before the first batch, capture recoverable round-start content, the changed-path inventory, path states, and content identities in a workflow-owned temporary snapshot outside the repository.
Run distinct batches sequentially against the latest working state, with one Change fixer invocation per batch.
Do not run a full review between coherent repair batches.
After every source or test batch has finished, derive the actual before/after current-round delta from the recoverable round-start snapshot and current working state, then dispatch one fresh targeted Change reviewer.
Remove exactly the workflow-owned temporary snapshot after the round delta is reconciled or the workflow stops.
Documentation-only batches restart at documentation check, and formatting-only batches rerun lint without a targeted adversarial rereview.

Do not turn a local repair into a broad feature addition merely to keep a batch together.
When a Finding requires a product decision or materially broader scope, leave it unresolved as `ask-user`.

## Targeted rereview

The targeted Change reviewer verifies every repaired Finding from its neutral prior Finding record, inspects the complete current-round delta and dependency closure, and checks for repair-caused regressions.
It does not reopen unrelated unchanged scope.
It can expand the dependency closure when concrete source evidence requires another caller, shared helper, test, or invariant, and records that expansion in its Inspection ledger.
If it cannot establish sufficient coverage, return unproven coverage as `ask-user` instead of claiming the repair is clean.

After a source or test repair, every terminal targeted rereview result—clean, `ask-user`, no progress, or round limit—advances to a final convergence review when no further repair will run.
Retain unresolved Findings and unproven coverage in report history instead of treating targeted coverage as the final safety gate.
The final convergence review is a fresh complete Change reviewer pass over the complete current change and Authoritative intent.
The final convergence manifest receives all complete-review routing fields, the complete current scope, Authoritative intent, relevant project context, and permitted specialist Findings.
The final complete manifest excludes the decision ledger, prior Finding records, and unresolved Findings so the reviewer independently discovers current defects.
After that independent result returns, the orchestrator reconciles prior user dispositions against the current Findings and preserves them unless materially changed code created a distinct defect.
If the final complete review finds a new selected repair-eligible Finding and repair budget remains, start the next bounded repair round, use the restart path for the resulting change, and require another final convergence review after any source or test repair.
After a round limit, new repairs require explicit human authorization that starts a new bounded cycle.

## Mode ownership

Coached build mode does not automatically modify source or tests; guide the user through those repairs.
For selected documentation and mechanical-formatting Findings only, dispatch the Change fixer with an explicit coached-mode scope that prohibits source and test edits.
Pull-request, explicit local-range, and every standalone CLI mode are read-only and never invoke the Change fixer.

## Automatic rounds

An `auto-fix` action means the repair is objective and low-risk; it does not guarantee that the current mode permits mutation.
In AI build mode, partition eligible objective Findings into coherent repair batches, invoke each Change fixer sequentially, and inspect every changed-file, affected-interface, and verification result.
For source or test changes, derive the combined current-round delta from the actual before/after working states and run one targeted rereview; route documentation-only changes to documentation check and formatting-only changes to lint.
In coached build mode, use the same bounded invocation only for eligible documentation and mechanical-formatting Findings and reject any returned source or test change as outside scope.
Stop automatic repair when the stage is clean, three rounds have run, a repair makes no progress, or only `ask-user` Findings remain.
If source or test repairs occurred after the latest complete review, run the final convergence review before presenting unresolved Findings at the Review-to-done gate.

## Restart selection

- Source or test changes restart at targeted adversarial rereview after the round's coherent repair batches finish, followed by one final complete review when no further repair will run, regardless of the targeted outcome.
- Documentation-only changes restart at documentation check.
- Formatting-only changes rerun lint.
- No change returns the unresolved Finding to the decision surface.

After a restart, rerun every downstream stage and regenerate the report from the latest validated state.
