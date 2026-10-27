---
description: Verify and deliver one local task through the repository's integration policy.
argument-hint: "[exact-task-name]"
---

# Deliver a task

An explicit `/deliver` request authorizes the selected task's commit, rebase, checks, integration, and post-integration return and cleanup.
Treat arguments as literal data, never shell code.
Use the bundled `worktree` CLI and Git.
Never deliver from the `~/.dotfiles` parent repository.

1. Identify the current named task branch or the one exact managed task named by the argument.
   Use `worktree list --json` and Git to verify repository, checkout, branch, and integration branch.
   Stop on trunk without an exact named task, ambiguity, unrelated changes, or an unproved target.
   Saved conversations are resume references, not exclusive session ownership.
2. Inspect staged, unstaged, and untracked changes.
   If the selected task needs a commit, use the `commit` skill for only its authorized changes and verify the checkout is clean.
   Commits always run the required project checks; never bypass a hook or use earlier results to skip a commit's checks.
   Record the verified commit, checkout, required commands, successful results, and relevant configuration/toolchain state.
   A normal successful hook is usable evidence only when its known checks covered the exact committed source, with no untested staged or working changes.
   Commit success alone, a checklist mark, or a remembered summary is not verification evidence.
   Record the feature tip before and after `/rebase` on the verified integration branch; on conflict, use `resolve-conflicts` for that active rebase.
3. Do not repeat successful commit checks for the unchanged verified revision.
   Reuse requires the same clean checkout, exact revision, required commands, and relevant configuration/toolchain state.
   A real rebase invalidates prior verification, even when its final file tree is unchanged; a no-op with the same tip does not.
   Run invalidated or otherwise missing checks after rebase and before integration, recording fresh evidence for the resulting tip.
   Missing or uncertain verification is not reusable; changed source, dependencies, check configuration, or toolchain also invalidates the affected results.
   Run the remaining project checks and stop before integration if required checks fail or remain incomplete.
   Use `review-change` for a needed authorized review, preserving its restricted runner and human finding decisions.
   Do not repeat a current review of the same source and intent; obtain missing review authorization only when it is not already valid for this scope.
   Review and independent checks may overlap only after source-producing build steps finish; changed source invalidates the affected evidence.
   Do not integrate while required checks, review, or selected repairs remain incomplete.
4. Read the explicit `wt.delivery` policy when present; otherwise use local delivery, except for a project classified as A5 from effective global or system Git configuration, which uses GitHub delivery.
   For local delivery, verify the checked feature tip, switch the clean primary checkout to the integration branch, run `git merge --ff-only <verified-task-branch>`, and prove its tip equals the verified tip.
   For GitHub delivery, retain the branch and worktree and report the verified PR preparation steps; do not claim that opening a PR form, a push, or a closed PR proves integration.

5. After successful local integration, run the selected task's `wt clean TASK --check --json` safety check.
   Return the running harness to this project's primary directory through the [native transition](../docs/worktree-transitions.md), preserving the current conversation.
   Verify its actual directory, repository, and integration branch before removing anything.
   Then run `wt clean TASK --json` from primary; WT rechecks safety and deletes the local branch only with exact-tip ancestry or [synchronized merged-PR proof](../tools/worktree/README.md#cleanup-safety).
   Cleanup does not fetch or advance the integration branch.
   The native cleanup command may combine the verified return and cleanup in that order.
   If the session was already at primary, verify that location and clean directly.
   Never use a child shell `cd` as proof that the harness has left the worktree.
6. If transition or cleanup fails or is cancelled, report integration separately from cleanup and retain the remaining worktree or branch.
   Do not force deletion, reset changes, or claim delivery cleanup completed.
   A retry after integration must inspect the actual remaining state rather than repeat the commit or merge blindly.

Never push or force-merge by implication.
PR preparation is not integration and does not authorize cleanup; retain that worktree and branch.
Report the exact integration proof, final harness directory, worktree and branch outcomes, and any next action.
