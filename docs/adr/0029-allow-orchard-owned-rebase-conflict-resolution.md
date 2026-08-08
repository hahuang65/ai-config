# Allow Orchard-owned rebase conflict resolution

The `/rebase` workflow needs to preserve both compatible intents instead of stopping whenever replayed task work conflicts with synchronized trunk.
A prompt-only retry cannot do this because Orchard previously aborted every failed rebase and restored the original task tip before returning control.

Orchard keeps automatic abort and restoration as the default for standalone rebases and for workflows that do not explicitly own conflict resolution.
The `/rebase` command explicitly requests machine-only conflict preservation through `orchard rebase --resolve-conflicts --json`.
Orchard returns `needs-conflict-resolution` only when Git has both an active rebase and unresolved entries.
All other failures retain the existing automatic-abort behavior.

Before starting the owned rebase, Orchard records a random operation ID, the original task tip, and the synchronized target tip in durable slot recovery metadata.
A preserved conflict updates that record to `conflicted` and leaves the Git operation active in the exact managed worktree.
Recovery reconciliation accepts detached `HEAD` only when durable `rebasing` or `conflicted` state and Git's active rebase metadata agree.
The `/rebase` workflow resumes an interrupted active conflict, including staged resolutions that await continuation, or finalizes a completed or aborted recorded operation before it starts another rebase.
Other lifecycle mutations remain blocked by the unresolved recovery record.

The `/rebase` command enters the managed worktree through Orchard when necessary and invokes the `resolve-conflicts` skill with the validated operation context.
The resolver preserves compatible intent, requests human decisions for incompatible hunks, completes every replay step, and asks Orchard to finalize the exact recorded operation.
The owned rebase reapplies cherry-picks, keeps empty commits, and records the original task commit count.
Finalization verifies that no Git operation remains, the assigned branch is bound to the managed path, the worktree is clean, the synchronized target tip is an ancestor of the resolved task tip, the task commit count is unchanged, and the branch reflog records Git's completed rebase before clearing recovery metadata.
A project-level completed-operation ledger preserves each immutable final outcome when the workflow loses the first response, even if the worktree slot is later reused.
Operation IDs remain internal workflow values and are never copied or typed by the user.

Managed and ordinary delivery keep their existing abort-on-conflict behavior.
This decision changes only explicit `/rebase` conflict ownership and supersedes ADR-0023's automatic-abort requirement for that machine-owned mode.
