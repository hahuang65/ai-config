---
name: worktree
description: Before a repository task adds, edits, or removes files, verify or establish its task worktree; handle explicit create, enter, list, and clean requests through WT. Do not make a worktree for read-only work.
---

# Work in a task worktree

Follow the shared bootstrap's write-before-worktree policy.
Use only the replacement-owned `../../tools/worktree/target/release/wt`, resolved from this skill's absolute source path.
The installed `wt` and `worktree` aliases invoke this executable; read its command help before an unfamiliar operation.
WT manages Git worktrees, not conversations.

## Before the first repository write

1. Identify the actual Git repository and checkout, including a submodule's own repository rather than its `~/.dotfiles` parent.
   Check the current branch, staged/unstaged/untracked state, and Git worktree inventory.
   Never branch, stage, commit, or make a worktree in the `~/.dotfiles` parent; keep it on `main` and change its files only when explicitly requested.
2. If already in a verified task worktree on a named task branch, reuse it; do not create a nested or duplicate task.
   Respect an existing WT task lock and another session's ownership; ask rather than editing concurrently.
3. Otherwise, for a user-requested edit in a clean checkout, choose a short task name and run `wt new TASK` using the validated executable.
   Ordinary permission to edit authorizes creating that task worktree, but not staging, committing, fetching by another command, pushing, or cleanup.
   WT may fetch its configured integration branch as part of creation; if that fails, stop rather than silently choosing `--local` or a different base.
   Use `wt enter TASK` to find an existing managed task; verify the returned repository and task branch before use.
4. Do not move, stash, reset, or copy existing changes into a new checkout.
   If the checkout is dirty, the repository lacks an initial commit, the base is ambiguous, a task is locked, or the worktree cannot be verified, pause for a decision before writing.
5. Confirm that the **current session** runs in the chosen task checkout before editing.
   WT prints a path but cannot change the parent shell or a running session's working directory.
   Without a verified session transition, report the path and ask the user to open or resume a session there; never keep editing the original checkout via absolute paths or a temporary shell `cd`.
   Do not claim conversations automatically transfer or resume between worktrees.

## Narrow direct-checkout exception

Only for a single self-contained change, the user may choose the current checkout **in advance** and separately grant commit authorization up front.
A one-line change or a documentation edit does not qualify by size alone.
Use a named task branch, never trunk; if a safe branch transition cannot be proved, ask instead of editing.
The authorization covers only the named change, not unrelated files, automatic staging, or an unapproved commit.
If review or checks prevent immediate completion, retain the changed branch and ask rather than forcing a commit or moving the work afterward.
The `~/.dotfiles` parent remains on `main` and never gains a branch, worktree, staged change, or commit from this exception.

## Finish

Do not clean, delete, or switch tasks automatically when work ends.
Only a separate explicit cleanup request permits `wt clean`; run its non-destructive check first and respect dirty files, locks, and integration proof.
Report the checkout and branch used, whether the current session entered it, and any work that must wait.
