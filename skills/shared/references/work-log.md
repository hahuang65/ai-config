# Work log protocol

The **Work log** is one universal, hidden, host-local, authoritative record shared by every configured harness and repository.
Each work item belongs to one Git repository, but repository identity is metadata for association and filtering rather than an access boundary.
Load and follow [record-work](../../record-work/SKILL.md) before the first Work log write in a workflow.

## Before meaningful work

Verify that the current directory belongs to the relevant Git repository.
Outside Git, ask the user to enter, select, or create the repository, or explicitly continue without Work log capture.
At workflow entry, use the compact repository digest to find an associated active or paused item and the count of other planned work.
Use an explicit identifier first, one strong title and repository match second, and ask when several matches remain.
Record lifecycle and progress checkpoints from the repository that owns the work item; universal access does not move an item between repositories.
Create a new active work item when work starts without a match.

## Required checkpoints

Record a checkpoint for:

- Every transition between planned, active, paused, completed, and abandoned.
- A resolved design or domain decision.
- Approval of a canonical artifact.
- Completion of an independent implementation slice.
- A Git commit related to active work.
- A material blocker or changed next action.
- Final review and completion.

Do not record routine reads, intermediate edits, repeated test runs, or discussion without a durable outcome.
File activity is evidence, not a work item.

## Build pipeline mapping

A `/build` goal is one parent work item.
Create child work items only for independently actionable implementation slices.
Record grilling decisions, artifact approvals, commits, and reviews as checkpoints or evidence.
The final approved Review change records completion of the parent work item.
If a build stops without completion, record paused or abandoned only when that state is semantically true; session shutdown alone never implies either state.

## Content and interaction

Write concise synthesized facts: outcome, decisions, blockers, next action, relevant files and commits, state, repository, branch, ticket keys, harness, and session identifier.
Never store raw prompts, transcripts, tool output, diffs, secrets, personal data, customer data, or artifact URLs.
Keep successful automatic checkpoints quiet.
Confirm explicit capture requests, and report failures or ambiguity immediately.
Harness reconciliation is a safety net for missing checkpoints; it does not infer semantic state.

## Terminal work and corrections

Completed and abandoned are terminal.
Create a linked follow-up work item when later work appears.
Append a correction checkpoint for an ordinary mistake.
Physically purge sensitive content instead of preserving it in append-only history.
