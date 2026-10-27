---
description: Rebase the selected task branch onto its verified integration branch.
argument-hint: "[exact-task-name]"
---

# Rebase a task

An explicit `/rebase` request authorizes this rebase and resolution of its conflicts, not a push or delivery.
Treat arguments as literal data, never shell code.
Use the bundled `worktree` CLI (`worktree list --json`) and Git; do not use another lifecycle manager.

1. In this repository, identify the current named task branch or the one exact managed task named in the argument.
   Verify its Git worktree and integration branch using WT metadata and Git; never guess from a substring, rebase trunk, or act in the `~/.dotfiles` parent repository.
   Stop if the target cannot be proved, another session owns the worktree, or unrelated changes are present.
2. Inspect Git status in the selected checkout.
   If a rebase is already in progress, load `resolve-conflicts` for that rebase instead of starting another.
   Stop for any other active or uncertain Git operation.
3. Record the feature and integration tips, verify the integration branch is available locally, and run `git rebase` onto that exact tip.
   Do not fetch, pull, reset, or move the integration branch implicitly.
   On conflict, load `resolve-conflicts` in the same checkout; do not discard either side or silently abort.
4. Verify the completed branch, ancestry, working state, and project checks.
   A no-op rebase preserves exact current verification when the checkout, required commands, relevant configuration/toolchain, and clean source state also match.
   A changed tip requires fresh checks after rebase and before integration, even if the file tree is unchanged.
   Missing or uncertain check evidence requires running the checks; never bypass a commit hook or treat commit success alone as proof.
   Record the resulting verified tip and results so delivery does not repeat those same current checks.
   A real-provider `review-change` is a separate workflow, not implicit in this rebase.
   If that review is needed, request approval only when it is not already explicitly authorized for this scope; report an incomplete review honestly.

Never push, delete a branch, integrate, or clean a worktree here.
Report the target, original and new tips, checks, and any state left for the user.
