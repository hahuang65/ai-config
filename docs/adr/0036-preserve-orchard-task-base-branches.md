# Preserve Orchard task base branches

A converted task branch can be stacked on another integration branch instead of trunk.
Treating every managed task as trunk-based rebases stacked work onto the wrong history, opens its pull request against the wrong branch, and prevents safe recycling after that pull request is merged.

Orchard records a base branch on every new task slot.
An acquired task records trunk.
A converted task records the branch named by its Git branch-creation reflog, with the corresponding checkout reflog as a fallback when Git recorded the creation source as `HEAD`.
If Git cannot prove another branch, conversion records trunk to preserve the established behavior.
Existing task slots without this field use the same read-only inference when needed.

Rebase and delivery use the recorded base branch.
Local delivery updates a non-checked-out base branch only after proving a fast-forward and leaves the main project directory on trunk.
Pull-request delivery fetches and rebases onto the base from the selected publication remote, then supplies that branch to the pull-request form when it is not trunk.

Cleanup accepts either exact-tip ancestry on the recorded base branch or read-only forge evidence for an exact-head merged pull request.
The pull request can target any branch because its merged state and exact feature-tip identity prove that the task completed without assuming trunk ancestry.
Dirty, occupied, closed, mismatched-tip, or unverifiable tasks remain preserved.

## Consequences

- Stacked tasks retain their intended integration relationship through conversion, rebase, delivery, and cleanup.
- Ordinary trunk-based tasks keep their existing behavior.
- Local non-trunk integration does not change the branch checked out in the main project directory.
- Legacy slots remain compatible while durable base recording protects new slots from reflog expiry.
- Pull-request metadata cannot recycle later commits that were not part of the merged exact-head pull request.
