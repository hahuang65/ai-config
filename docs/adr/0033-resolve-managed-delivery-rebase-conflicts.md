# Resolve managed delivery rebase conflicts

Managed delivery rebases a task before integration, but its standalone-safe default aborts a conflicting rebase and restores the original task tip.
Stopping at that point forces the user to invoke `/rebase` or remind the harness to continue, even though explicit `/deliver` already authorizes the lifecycle operation that encountered the conflict.

The `/deliver` composition now treats its explicit invocation as authorization to resolve a managed delivery rebase conflict.
After Orchard proves that it automatically aborted the failed rebase, restored the original task tip, and preserved synchronized trunk, the composition runs the same harness-owned `orchard rebase --resolve-conflicts --json` path as `/rebase`.
A `needs-conflict-resolution` outcome invokes the `resolve-conflicts` skill with validated durable recovery facts, completes and finalizes the recorded operation, then retries Orchard delivery with the original arguments.
Other delivery and rebase failures still stop with preserved state.

The Orchard CLI keeps abort-on-conflict as the safe default for standalone delivery.
Conflict interpretation remains a harness workflow because the CLI cannot make intent-sensitive hunk decisions.
This decision supersedes ADR-0029 only where it said managed delivery must always stop after an automatically aborted conflict; ordinary local-branch delivery keeps its existing abort-and-stop behavior.
