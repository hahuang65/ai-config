---
description: Verify, review, and deliver one local task through the repository's integration policy.
argument-hint: "[exact-task-name]"
---

# Deliver a task

An explicit `/deliver` request authorizes only the selected task's commit, rebase, review, and integration.
Treat arguments as literal data, never shell code.
Use the bundled `worktree` CLI and Git.
Never deliver from the `~/.dotfiles` parent repository.

1. Identify the current named task branch or the one exact managed task named by the argument.
   Use `worktree list --json` and Git to verify repository, checkout, branch, and integration branch.
   Stop on trunk, ambiguity, another session's worktree, unrelated changes, or an unproved target.
2. Inspect staged, unstaged, and untracked changes.
   If the selected task needs a commit, use the `commit` skill for only its authorized changes and verify the checkout is clean.
   Use `/rebase` on the verified integration branch; on conflict, use `resolve-conflicts` for that active rebase.
3. Run project checks and review the full task with `review-change`.
   A real-provider review requires separate approval; stop before integration if review or required checks are incomplete or blocking findings remain.
4. Read the explicit `wt.delivery` policy when present; otherwise use local delivery, except for a project classified as A5 from effective global or system Git configuration, which uses GitHub delivery.
   For local delivery, verify the reviewed feature tip, switch the clean primary checkout to the integration branch, run `git merge --ff-only <verified-task-branch>`, and prove its tip equals the reviewed tip.
   For GitHub delivery, retain the branch and worktree and report the verified PR preparation steps; do not claim that opening a PR form, a push, or a closed PR proves integration.

Never push, force-merge, delete a branch, or clean a worktree as an implicit side effect.
Report the exact integration proof, final checkout, retained state, and any next action.
