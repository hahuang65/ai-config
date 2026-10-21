# Worktree

Worktree (WT) manages persistent Git worktrees for independent tasks.
Agents use `worktree`; `wt` is the shell shortcut to the same executable.
It does not commit, publish, merge, or read agent transcripts.
It stores harness-specific saved-conversation references; native harness adapters perform conversation transitions.
References do not confer exclusive session ownership or require session locks.

## Terms

**Main checkout** is the project's original non-bare checkout.
WT leaves its checked-out branch and files unchanged when creating a task.

**Task** is one unit of work with a named branch and its own worktree.
A task can remain open for weeks; age never makes it safe to remove.

**Managed worktree** is a Git worktree created by WT with a small ownership record in its Git administrative directory.
Other worktrees appear in the inventory but WT does not remove them.

**Integration branch** is the branch where the task's work must arrive before cleanup.
A different starting revision does not change this destination.

**Cleanup** removes a managed worktree only after verifying its exact branch tip is integrated and its non-ignored files are unchanged.
Ignored files are disposable.
The branch remains available after cleanup.

**Git worktree lock** is an explicit Git protection against moving or removing a worktree.
Native harness adapters do not acquire or release it.
WT's ordinary entry and cleanup commands respect existing Git locks without treating them as proof of an active session.

**Shell completion** suggests public commands, options, and current-project managed task names without performing a lifecycle operation.
Bash setup is opt-in, and a suggestion never grants entry or cleanup authority.
Completion does not fetch, acquire the WT operation lock, or retain a cache between requests.
