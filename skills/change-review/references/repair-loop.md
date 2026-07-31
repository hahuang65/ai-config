# Repair and Rereview

AI build mode permits at most three fix/recheck rounds per validation stage; every repair that changes source or tests triggers a fresh complete Change reviewer pass, and that reviewer never receives Change fixer rationale.
The Change fixer receives only selected Findings, explicit per-Finding instructions, and the authorized scope.

## Decision ledger

Carry the Finding decision ledger between rounds.
Record stable Finding ID, disposition, user instruction, repair round, reviewed state, and whether later code changed materially.
Do not carry private reviewer or fixer chain-of-thought, session history, or rationale.
A user-dispositioned Finding remains closed unless materially changed code creates a distinct problem.

## Mode ownership

Coached build mode does not automatically modify source or tests; guide the user through those repairs.
For selected documentation and mechanical-formatting Findings only, dispatch the Change fixer with an explicit coached-mode scope that prohibits source and test edits.
Pull-request, explicit local-range, and every standalone CLI mode are read-only and never invoke the Change fixer.

## Automatic rounds

An `auto-fix` action means the repair is objective and low-risk; it does not guarantee that the current mode permits mutation.
In AI build mode, select eligible objective Findings, invoke the Change fixer once, inspect its changed-file and verification result, then restart from the applicable stage.
In coached build mode, use the same bounded invocation only for eligible documentation and mechanical-formatting Findings and reject any returned source or test change as outside scope.
Stop automatic repair when the stage is clean, three rounds have run, a repair makes no progress, or only `ask-user` Findings remain.
Present unresolved Findings at the Review-to-done gate.

## Restart selection

- Source or test changes restart at adversarial review.
- Documentation-only changes restart at documentation check.
- Formatting-only changes rerun lint.
- No change returns the unresolved Finding to the decision surface.

After a restart, rerun every downstream stage and regenerate the report from the latest validated state.
