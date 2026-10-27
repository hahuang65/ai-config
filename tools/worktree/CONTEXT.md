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

**Cleanup** removes a managed worktree only after proving integration of its exact branch tip and verifying its non-ignored files are unchanged.
Integration proof is local ancestry or an exact-head merged GitHub PR.
Local mode without ancestry also requires **synchronized merged-PR proof**.
Ignored files are disposable.
Cleanup deletes the local task branch only with local ancestry or synchronized merged-PR proof.
GitHub-mode worktree-only cleanup can retain the branch when local proof is absent.

**Synchronized merged-PR proof** combines an exact-head merged PR with identical task and integration trees.
The recorded local integration branch, remote-tracking branch, and currently advertised remote integration branch must all identify the same commit.
This permits full cleanup after a squash or rebase merge without treating tree equality alone as integration.

**Git worktree lock** is an explicit Git protection against moving or removing a worktree.
Native harness adapters do not acquire or release it.
WT's ordinary entry and cleanup commands respect existing Git locks without treating them as proof of an active session.

**Shell completion** suggests public commands and current-project managed task names, not flags, without performing a lifecycle operation.
The CLI prints manual Bash setup on request, and package installation owns standard per-user `bash-completion` entries for both command names.
An existing loader can discover them without startup-file edits.
A suggestion never grants entry or cleanup authority.
Completion does not fetch, acquire the WT operation lock, or retain a cache between requests.
