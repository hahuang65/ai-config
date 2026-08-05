---
description: Deliver an Orchard-managed worktree or the current ordinary local branch through the correct owner
argument-hint: "[worktree-intent] [--keep]"
---

Before delivery, classify the checkout using Git only.
Do not invoke Orchard to perform this classification.

Treat the request as Orchard-managed only when `$ARGUMENTS` contains an explicit worktree intent rather than only options, or when the canonical current Git root is inside the canonical `~/.orchard/` root.
For that managed case, load the `orchard` skill and follow its deliver operation with `$ARGUMENTS` unchanged.
If Orchard returns `needs-commit`, validate the exact managed worktree path and branch, load the `commit` skill there, and retry Orchard delivery.
Do not treat the worktree intent as commit scope.
Stop if commit fails or leaves changes behind, and follow every other Orchard transition or terminal result exactly.

For every other checkout, deliver the current ordinary local feature branch directly through Git as follows.
Never invoke Orchard for an ordinary local branch, including Orchard status, discovery, rebase, delivery, or cleanup.

1. Resolve and canonicalize the current Git root, the absolute Git directory from `git rev-parse --absolute-git-dir`, the common Git directory from `git rev-parse --git-common-dir`, and the first path from `git worktree list --porcelain`.
Require the absolute Git directory and common Git directory to match; otherwise this is a linked worktree rather than the primary checkout, so stop.
Normally require the current Git root and first worktree path to match.
Allow a mismatch only for a primary absorbed Git submodule: `git rev-parse --show-superproject-working-tree` must return a non-empty superproject, the first worktree path must equal the common Git directory, and `core.worktree` resolved relative to that common Git directory must resolve to the current Git root.
If any part of that submodule proof fails, stop.
Require a named feature branch.
2. Resolve trunk from the local branch named by `refs/remotes/origin/HEAD`.
If that is unavailable, accept exactly one existing local candidate from `main` or `master`; stop if trunk is ambiguous or already checked out.
3. Read short status.
If dirty, load the `commit` skill for the current checkout and continue only after commit succeeds and status is clean.
Do not treat `--keep` as commit scope.
4. Read effective `ai.projectFamily` with its Git scope and origin.
Treat this as an A5 project only when the value is `a5` from global or system scope; repository-local and command scopes cannot grant A5 classification.
5. Record the feature branch and original tip, then run `git rebase <trunk>` without fetching or pulling.
On failure, run `git rebase --abort`, verify the original tip was restored, report the conflict, and stop with both branches preserved.
Verify that trunk is an ancestor of the rebased feature tip.
6. For an A5 project, require the trusted global `git pr` alias, run exactly `git pr create --web --fill`, and retain the feature branch because opening the form does not prove creation or merge.
7. Otherwise switch to trunk, run `git merge --ff-only <feature-branch>`, and verify that trunk equals the exact rebased feature tip with no merge commit.
If integration fails before that proof, preserve the feature branch and return to it when safe.
After successful proof, delete the feature branch unless `--keep` was supplied.
Successful ordinary delivery returns on trunk in the same checkout and never pushes.
