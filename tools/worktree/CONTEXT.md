# Worktree

Worktree (WT) manages persistent Git worktrees for independent tasks.
Agents use `worktree`; `wt` is the shell shortcut to the same executable.
It does not commit, publish, merge, or manage agent conversations.

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

**Active-session lock** is a normal Git worktree lock held by the Pi adapter while a task conversation is open.
WT will not remove a locked worktree.
An interrupted session may leave a lock that needs manual review.
