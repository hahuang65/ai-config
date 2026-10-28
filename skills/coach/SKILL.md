---
name: coach
description: Coach a clear request, issue, spec, or plan with one AI-written failing test at a time; the user owns implementation, refactoring, and selected review repairs.
---

# Coach

Accept a clear request, issue, spec, or plan as intent.
No mandatory artifact or specialist agent is needed.
Read the relevant current sources, tests, context, and project rules.
Read `coding-style.md` through the baseline's rule-loading instructions before proposing implementation options.
Use its reuse order to discuss the smallest complete change.
Agree on scope and acceptance criteria, then propose the public interface to test and wait for the user's confirmation.
Do not force work through a new document or every application layer.
Use an available structured-question tool only for actual intent blockers, not routine checkpoints.
Offer trade-offs and free text, or use ordinary chat when the tool is absent or unavailable.
Cancellation is not an answer, and clarification answers do not transfer implementation ownership or grant action authority.
Record the starting revision and prior edits so review accounts for both committed and uncommitted task changes without absorbing unrelated work.

The user owns implementation, refactoring, and source changes throughout coaching.
The AI writes one test at a time and verifies when the user is ready.
An optional session checklist tracks only the agreed current cycle and necessary checks, never speculative future tests.
Use available native task-list tools or a concise list in ordinary chat, with at most one active step.
Checklist state does not transfer implementation ownership, replace user readiness, or authorize file polling.

## One behavior at a time

1. Write one behavior test through the agreed public interface.
   Run it and confirm RED for the intended missing behavior, not a test-harness failure.
2. Show the test, failure, and a concise explanation of the expected behavior.
   End the turn and wait for the user to implement.
3. When the user signals readiness in ordinary language, run the focused test.
   If still RED, explain the failure and offer guidance; do not implement the fix.
4. When GREEN, discuss useful refactoring for the user to perform, then verify any change before writing the next test.

Never batch tests, queue speculative next tests, or infer progress from incomplete-task reminders.
Never poll files or silently inspect implementation to discover whether the user has finished.
Silence is not consent to take over.
While waiting, answer questions without writing implementation; otherwise stay waiting.
Only an explicit user request to switch ownership permits takeover, and confirm the new scope before proceeding.
Do not perform source cleanup, even mechanical cleanup after tests pass.
Do not weaken a test to accommodate a failing implementation.
A defective AI-written test can be corrected transparently to preserve the agreed behavior, not erase it.

## Verify and review

When the user is ready, run project verification checks, including applicable type checks, lint, tests, and build.
Report exact outcomes and checks not run; ask before installing tools or starting external services.
Guide the user through implementation failures instead of editing their code.
Always review the change, including small changes, through [review-change](../review-change/SKILL.md).
If the review tool is missing or unavailable, review is not complete; report that limit.

Show findings and ask which repairs the user selects.
The user handles selected review repairs to source and tests; the AI explains and verifies, but does not apply them.
Do not use another agent to bypass this ownership boundary.
After the user signals that repairs are ready, rerun affected checks and obtain a fresh review of the changed state.
Do not mark the task complete while blocking findings or required evidence remain unresolved.

Summarize behavior, test evidence, review outcome, and remaining limits.
Update an existing plan only from verified evidence, and use [worklog](../worklog/SKILL.md) for meaningful progress once.
Do not stage, commit, push, merge, or publish by implication.
Do not automatically start another task or change coaching mode.
