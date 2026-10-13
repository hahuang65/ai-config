# Keep a small append-only work log

## Decision

Build WL as an independent Rust CLI with evaluation data under its own ignored `.state/` directory.
The same local store covers all projects; the invocation's directory determines the default project, not the storage location.
Do not import, modify, or automatically migrate the existing Work log.

Capture short-term reminders and retain dated work history.
Pi recognizes later-work remarks, confirms the reminder's project and title briefly, and keeps working on the current task.
Record task starts, meaningful progress, successful commits, completion, and abandonment automatically when those events are established.
Combine a final commit and task completion into one entry rather than producing duplicates.
Progress can belong to a task or directly to a project.

All changes append entries, including factual corrections.
Provide no editing or deletion operation.
Preserve completed and abandoned history for period summaries.
Never store secrets, raw transcripts, environment dumps, or private customer data.

After task completion, suggest the oldest unstarted reminder in the same project without starting it.
Use Git repository identity across worktrees, with readable project names and clarification for unknown or ambiguous names.
No explicit project-registration workflow is required.

## Reasons and alternatives

The existing Work log contains more lifecycle and workflow machinery than this evaluation needs.
Keeping reminders and history together supports both resuming work and recalling accomplishments without adopting a long-term issue tracker.
Append-only corrections retain what was recorded and how it was corrected, rather than silently replacing history.

A durable queue, scheduled reminders, automatic expiry, priority ranking, parent-child work trees, duration accounting, background reconciliation, and mandatory session identifiers are not needed.
Jira and GitHub remain the long-term trackers.

## Consequences

Pi must identify real semantic events rather than infer them from file activity, Git commits alone, or session shutdown.
Historical summaries must apply corrections while retaining access to the originals.
Concurrent sessions must not lose entries or silently merge ambiguous tasks.
Because entries are not deleted, input discipline matters: summaries must exclude sensitive material before recording.
Rust replaces neither Pi's host-language adapter nor browser code that must run inside its host.
