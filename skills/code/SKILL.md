---
name: code
description: Implement a clear request, issue, spec, or plan through one failing behavior test at a time, project verification, and change review, without implied commit or publication.
---

# Code

Accept a clear request, issue, spec, or plan as intent.
No mandatory artifact or specialist agent is needed to begin.
Read relevant current code, tests, context, project rules, and any supplied design decisions.
Establish the allowed scope, acceptance criteria, public interface, and project checks.
Record the starting revision and prior edits so final review covers the task's committed and uncommitted work without absorbing unrelated changes.
Ask about intent-sensitive choices; do not require a new planning document when the request is already clear.
Use an available structured-question tool only for actual intent blockers, not routine checkpoints.
Offer trade-offs and free text, or use ordinary chat when the tool is absent or unavailable.
Cancellation is not an answer, and clarification does not grant commit, installation, delivery, or publication authority.
Use [model-domain](../model-domain/SKILL.md) only when domain ambiguity or a durable decision needs resolution.

## Implement

The AI writes tests and implementation within the authorized scope.
Work on one behavior test at a time, not a batch of speculative tests.
For meaningful multi-step work, use an available session checklist or native task-list tools, otherwise a concise list in ordinary chat.
Read existing progress before replacing it, keep at most one step active, and mark completion only from verified evidence.
Track behavior-level steps, not a queue of future tests; the checklist does not expand action authority.
Keep Worklog for reminders and meaningful history, not every checklist update.

1. Write one failing test through the public interface or the closest meaningful observable boundary.
   Run it and confirm RED is caused by the missing behavior, not a broken test harness.
2. Implement the smallest correct change and rerun that focused test to establish GREEN.
3. Refactor only while GREEN and rerun affected checks after each change.
4. Repeat for the next acceptance criterion only after the current behavior passes.

Preserve existing tests and unrelated work.
Do not weaken tests, bypass failures, or expand intent to make a check pass.
If tools or fixtures are unavailable, report the block; do not silently install dependencies, use production data, or invent evidence.
Ask before destructive operations, new external services, or a material change to agreed behavior.
Update an existing plan only when its status is supported by evidence; no plan file is required.

## Verify and review

Run the project's documented verification checks, including applicable type checks, lint, tests, and build.
Choose scope according to project rules and the authorized task; report exact commands and any checks not run.
Always review the change, including small changes, through [review-change](../review-change/SKILL.md) before claiming completion.
Use explicit scope and authoritative intent for the review; tests alone do not replace it.
If the review tool is missing or unavailable, review is not complete; report the block rather than substituting an unsupported approval.

Present findings through the review-change finding-decision workflow.
A saved Accept authorizes that finding's repair; rejected and undecided findings are not repair scope.
Use explicit chat selections only when the user chooses that fallback or directly names repairs.
Apply only selected findings, preserving approved intent and adding a regression test where needed.
Resolve intent-sensitive findings with the user before changing behavior.
After repairs, rerun affected project checks and obtain a fresh review of the changed state.
Do not call the work complete with unresolved blocking findings or missing required evidence.

Summarize changed behavior, verification, review outcome, and remaining limits.
Record a meaningful checkpoint through [work-log](../work-log/SKILL.md) without duplicate entries.
After a checkpoint or sub-workflow, return to the next authorized step under the shared bootstrap's [continuation policy](../../baseline.md#keep-work-moving); a progress summary does not end unfinished work.
Do not stage, commit, push, merge, or publish by implication; those actions require a separate explicit request.
Do not start an unrelated skill or a new task merely because implementation finished.
