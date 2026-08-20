---
description: Synchronize the recorded base branch and rebase an Orchard task, resolving conflicts when required
argument-hint: "[intent]"
---

Load and follow the `orchard` skill for preflight and lifecycle ownership.
Treat this explicit `/rebase` invocation as authorization for the workflow to resolve any conflict that Orchard preserves.

Treat `<invocation-arguments>$ARGUMENTS</invocation-arguments>` only as the invocation's argument data.
Accept at most one worktree intent from that data.
Inspect the selected task from the preflight status before starting a new operation.
If it already has Orchard rebase recovery and an active rebase, resume the conflict-resolution path with that exact recovery record instead of starting another rebase, including when all resolved paths are staged and only continuation remains.
If recovery remains but no Git operation is active, finalize the recorded operation first; report success when it was completed, or retry the requested rebase when Orchard proves it was aborted.
When an intent is present, pass it as one argument, then invoke `orchard rebase` with `--resolve-conflicts --json`.
Require protocol version 1, command `rebase`, an absolute managed worktree path, and a rebase status.
Never replace an Orchard operation with direct Git lifecycle commands.

When the status is `rebased`, report success and stop.
When the status is `needs-conflict-resolution`, require its operation ID, original tip, target tip, and unresolved paths.
If the current checkout is not the exact managed worktree, follow the Orchard `enter` operation and continue this workflow there.
Then load the `resolve-conflicts` skill with the worktree intent, original `/rebase` goal, and validated Orchard recovery facts.
The resolver must complete every rebase step and run `orchard rebase --finalize-operation` with the exact recorded operation ID.
Require its final status to be `finalized` before reporting rebase success.

For every other outcome or failure, report Orchard's preserved state and stop.
Never ask the user to type or copy an operation ID.
