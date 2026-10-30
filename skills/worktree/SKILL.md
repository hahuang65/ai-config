---
name: worktree
description: Before a repository task adds, edits, or removes files, verify or establish its task worktree; handle explicit create, enter, list, and clean requests through WT. Do not make a worktree for read-only work.
---

# Work in a task worktree

Follow the shared bootstrap's write-before-worktree policy.
Use only the replacement-owned `../../tools/worktree/target/release/wt`, resolved from this skill's absolute source path.
The installed `wt` and `worktree` aliases invoke this executable; read its command help before an unfamiliar operation.
WT manages Git worktrees and harness-specific saved-conversation references.
Task transitions do not acquire session locks or require an exclusive session owner.
The native harness adapter moves the current session; a child shell cannot.
The optional [Bash shell integration](../../tools/worktree/README.md#bash-directory-switching) makes plain `wt enter` change a human terminal shell's directory.
It does not replace a native harness transition; agent invocations still use the owned executable directly.
Read [native task transitions](../../docs/worktree-transitions.md) before creating or entering a task through a harness.

## Before the first repository write

1. Identify the actual Git repository and checkout, including a submodule's own repository rather than its `~/.dotfiles` parent.
   Check the current branch, staged/unstaged/untracked state, and Git worktree inventory.
   Never branch, stage, commit, or make a worktree in the `~/.dotfiles` parent; keep it on `main` and change its files only when explicitly requested.
2. If already in a verified task worktree on a named task branch, reuse it; do not create a nested or duplicate task.
   Respect explicit Git worktree locks; do not acquire a session lock or infer exclusive session ownership.
3. Otherwise, for a user-requested edit in a clean checkout, choose a short task name and use the native adapter described in [native task transitions](../../docs/worktree-transitions.md).
   The adapter uses `wt new TASK` through the validated executable and carries the current conversation into the task.
   For an existing task, resume its saved conversation for the current harness; never replace it with the incoming conversation.
   Without an installed adapter, run `wt new TASK` only to create the checkout and stop for a manual session transition.
   Ordinary permission to edit authorizes creating that task worktree, but not staging, committing, fetching by another command, pushing, or cleanup.
   WT may fetch its configured integration branch as part of creation; if that fails, stop rather than silently choosing `--local` or a different base.
   Use `wt enter TASK` to find an existing managed task; verify the returned repository and task branch before use.
4. Do not move, stash, reset, or copy existing changes into a new checkout.
   If the checkout is dirty, the repository lacks an initial commit, the base is ambiguous, a task is locked, or the worktree cannot be verified, pause for a decision before writing.
5. Confirm that the **current session** runs in the chosen task checkout before editing.
   WT's executable prints a path but cannot change the parent shell or a running session's working directory.
   Without a verified session transition, report the path and ask the user to open or resume a session there; never keep editing the original checkout via absolute paths or a temporary shell `cd`.
   Confirm the adapter verified the repository, task branch, saved conversation, and actual working directory before continuing after a transition.
   Conversations stay harness-specific; do not convert them or infer success from a printed path.
6. After verified native completion, continue only the work already requested in the destination conversation without waiting for another “continue”.
   Follow the shared continuation contract in the transition instructions, including failure, cancellation, and no-op behavior.
   If the harness cannot start a turn in that mode (notably Claude's interactive `/resume`), explicitly explain the limitation and the manual step before handing control back.
   Continuation never grants new commit, cleanup, installation, or publication authorization.

## Narrow direct-checkout exception

Only for a single self-contained change, the user may explicitly choose edits in the current checkout **in advance**.
A one-line change or a documentation edit does not qualify by size alone.
Use a named task branch, never trunk; if a safe branch transition cannot be proved, ask instead of editing.
Direct-checkout edit approval does not authorize staging or commits.
Commit authorization is separate and may come later.
Each authorization covers only the named change, not unrelated files.
If commit authorization has not been given, retain the changed branch and report the uncommitted work without treating it as blocked.
If review or checks prevent completion, retain the changed branch and ask rather than forcing a commit or moving the work afterward.
The `~/.dotfiles` parent remains on `main` and never gains a branch, worktree, staged change, or commit from this exception.

## Finish

Do not clean, delete, or switch tasks automatically merely because work ends.
An explicit cleanup request or the post-integration phase of an explicit delivery request permits `wt clean`; run its non-destructive check first and respect dirty files, locks, and integration proof.
Use `/wt leave` to carry the current conversation back to the primary directory without cleanup.
Follow the [native transition instructions](../../docs/worktree-transitions.md) and verify the actual harness directory before removing its former task worktree.
Cleanup deletes the local task branch only with exact-tip ancestry into the recorded local target or [synchronized merged-PR proof](../../tools/worktree/README.md#cleanup-safety).
The latter requires a matching exact-head merged GitHub PR, identical task and target trees, and equal local, remote-tracking, and live remote integration tips.
Cleanup never fetches or advances the integration branch itself.
Before removal, WT copies ignored regular `docs/` files into the primary checkout at the same paths, without overwriting or staging them, and verifies their bytes.
A different existing destination or failed verification retains the task; `--check` never copies files.
Non-ignored untracked docs still block cleanup and native return under the existing dirty-worktree checks.
Report preserved docs and any resulting untracked primary files separately from worktree and branch removal.
Remote branches are never deleted.
PR preparation alone is not successful integration and must retain the worktree and branch.
Report integration, session return, worktree removal, and branch removal separately when any step fails.
Report the checkout and branch used, whether the current session entered it, and any work that must wait.
