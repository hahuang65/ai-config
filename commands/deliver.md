---
description: Deliver an Orchard-managed worktree or the current ordinary local branch through the correct owner
argument-hint: "[worktree-intent] [--keep]"
---

Before delivery, run the read-only `~/.dotfiles/ai/scripts/deliver-preflight.sh` helper to classify the checkout using Git only.
Pass each parsed `$ARGUMENTS` value as a separate quoted shell argument; never use `eval` or interpolate the raw argument string into a command.
The helper does not invoke Orchard and returns stable `key=value` facts.
If it exits nonzero, report its error and stop.
Treat `delivery` as the output discriminator.
Read it and branch on it before validating any mode-specific facts.
Stop if it is missing or is not `managed` or `ordinary`.

When `delivery=managed`, the helper has found either an explicit worktree intent or a canonical current Git root inside the canonical `~/.orchard/` root.
For managed delivery, require `reason` and `keep` in addition to `delivery`.
Do not require or use ordinary-delivery facts such as `root`, `branch`, `trunk`, `feature_tip`, `dirty`, `a5`, or `pr_alias`.
Then load the `orchard` skill and follow its deliver operation with `$ARGUMENTS` unchanged.
If Orchard returns `needs-commit`, validate the exact managed worktree path and branch, load the `commit` skill there, and retry Orchard delivery.
Do not treat the worktree intent as commit scope.
Stop if commit fails or leaves changes behind.

Treat this explicit `/deliver` invocation as authorization to resolve a managed delivery rebase conflict.
When delivery proves that its rebase was automatically aborted, the original task tip was restored, and the synchronized base branch was preserved, run the same harness-owned rebase path as `/rebase`: invoke `orchard rebase` for the selected intent with `--resolve-conflicts --json` and require the versioned rebase outcome.
When its status is `needs-conflict-resolution`, validate the recovery facts and exact managed worktree, enter that worktree through Orchard when required, then load the `resolve-conflicts` skill with the delivery goal and recovery facts.
Require the resolver to complete and finalize the recorded Orchard rebase operation.
After a `rebased` or `finalized` outcome, retry Orchard delivery with the original `$ARGUMENTS` unchanged.
For every other delivery or rebase failure, report Orchard's preserved state and stop.

When `delivery=ordinary`, deliver the reported ordinary local feature branch directly through Git.
Never invoke Orchard for an ordinary local branch, including Orchard status, discovery, rebase, delivery, or cleanup.

1. For ordinary delivery, require `root`, `branch`, `trunk`, `feature_tip`, `dirty`, `keep`, `a5`, and `pr_alias` in addition to `delivery`.
2. If `dirty=true`, load the `commit` skill for the current checkout.
Do not treat `--keep` as commit scope.
Continue only after commit succeeds and status is clean, then rerun the same preflight with the same arguments and require `delivery=ordinary`, `dirty=false`, and unchanged `root`, `branch`, and `trunk`.
3. Record the reported branch and original `feature_tip`, then run `git rebase <trunk>` without fetching or pulling.
On failure, run `git rebase --abort`, verify the original tip was restored, report the conflict, and stop with both branches preserved.
Verify that trunk is an ancestor of the rebased feature tip.
4. The helper reports `a5=true` only for an A5 project whose effective `ai.projectFamily=a5` comes from global or system Git scope.
When `a5=true`, require `pr_alias=true`, run exactly `git pr create --web --fill`, and retain the feature branch because opening the form does not prove creation or merge.
5. Otherwise switch to trunk, run `git merge --ff-only <branch>`, and verify that trunk equals the exact rebased feature tip with no merge commit.
If integration fails before that proof, preserve the feature branch and return to it when safe.
After successful proof, delete the feature branch unless `keep=true`.
Successful ordinary delivery returns on trunk in the same checkout and never pushes.
