# Use an authoritative append-only work log with hybrid checkpoint capture

A user can ask one harness to retain planned work, start it in another harness, and complete it through `/build`; a completed-task journal or session-end hook alone cannot preserve that lifecycle reliably.

Use one hidden, host-local work log as the authoritative source for planned and performed work across every configured harness and repository.
Repository identity is metadata for association and filtering, not an access boundary or separate store.
Each work item has a stable identity, and immutable UTC-timestamped checkpoints record state transitions and meaningful outcomes.
DuckDB derives current state, active duration, history, **Open work**, and summaries from those checkpoints.
Workflow skills record semantic checkpoints because they know what happened, while harness lifecycle integration detects missing checkpoints and requests reconciliation while the agent still has context.

## Considered Options

- A completed-work journal cannot represent planned, active, or paused work and cannot provide authoritative **Open work**.
- One mutable record per work item makes current state simple to read but destroys transition history and creates cross-harness update conflicts.
- Harness-only capture observes sessions and file activity but cannot reliably distinguish completion, abandonment, a decision, or routine edits.
- Workflow-only capture understands semantic transitions but can miss them when a workflow exits unexpectedly or guidance is not followed.

## Consequences

- The work log is authoritative for work state; Jira and GitHub status are outside the initial design.
- Every work item belongs to a Git repository.
When a session is outside Git, the agent asks the user to enter, select, or create a repository or to continue without work-log capture.
A normalized origin identifies a repository when available; otherwise a persisted identity for the resolved common Git directory keeps linked worktrees together and remains stable if an origin is added later.
- Work states are planned, active, paused, completed, and abandoned.
Completed and abandoned work items are terminal, and later work uses a linked follow-up item.
- A `/build` goal is a parent work item, and independently actionable implementation slices are child work items.
Commits, approvals, decisions, blockers, and other meaningful outcomes are checkpoints or checkpoint evidence rather than separate work items.
- **Open work** is a derived, unordered collection of planned, active, and paused work items rather than a separate store.
It has no priority or semantic ordering.
- Successful automatic checkpoints are quiet, while explicit capture requests receive confirmation and failures or ambiguity are reported immediately.
- Harness shutdown preserves pending evidence but does not infer a semantic state transition.
- The append-only event store must support concurrent writers and package the DuckDB schema and views used by every harness.
