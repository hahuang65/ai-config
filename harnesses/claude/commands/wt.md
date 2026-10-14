---
description: Leave a task for the primary directory, or create/resume a WT task through native Claude controls.
argument-hint: "leave | new TASK | enter TASK"
---

# Native worktree command

Treat `$ARGUMENTS` as literal data.
Accept only `leave`, `new TASK`, or `enter TASK`; reject other arguments before effects.
Resolve the package-owned WT executable and transition instructions through the `worktree` skill.
Never substitute a shell `cd` for a running harness transition.

## leave

Return to this project's primary directory with the current conversation, without cleanup.
Use `wt list --all --json` to verify the source task and primary directory.
If already at primary, report that and do nothing.
Otherwise check both checkouts for changes and stop on dirty or unverified state.
Call native `ExitWorktree` with `action: keep`.
The post-exit hook records the verified primary location while retaining the task's saved conversation reference.
Verify the actual working directory and repository before using primary-directory tools.
If native exit fails or the location cannot be verified, retain the worktree and report the block.
Do not remove a worktree, delete a branch, commit, or integrate as part of `leave`.

## new TASK

Follow the worktree skill's native creation flow.
A saved task conversation must be forked with native `/branch` before creating a different task.

## enter TASK

Inspect the task's saved Claude conversation through `wt session inspect TASK --harness claude`.
Follow the native resume instructions; never overwrite another saved conversation.
If `atPrimary` is true, resume that saved conversation first, then use native `EnterWorktree` with the verified task path to re-enter it.
If this is already the saved conversation at primary, enter that path directly.
The entry hook restores task-directory verification.
