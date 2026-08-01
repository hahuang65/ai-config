---
name: merge
description: Integrate the current managed Orchard task through the installed rebase-first, fast-forward-only lifecycle CLI, return to the main project directory, and recycle safely. Use when the user explicitly asks to merge, land, or finish an Orchard task.
argument-hint: "[intent] [--keep]"
---

# Merge

This skill is a thin alias for the Orchard merge flow.
It owns no Git integration behavior.

Read [../orchard/references/workflow.md](../orchard/references/workflow.md) before continuing.

Run Orchard preflight and require the current checkout to be a managed task worktree.
If the executable is absent or protocol-incompatible, stop with Git dotfiles installation guidance.
If the current checkout is unmanaged, stop rather than guessing an integration target.

Forward `$ARGUMENTS` unchanged to the installed Orchard merge command through the harness transition described in the workflow reference.
Use Orchard's returned transition and cleanup operation exactly.
The installed merge flow rebases clean local task commits onto synchronized trunk, automatically aborts failures, and never creates a merge commit.
Never fall back to raw Git integration, and never publish remote state.
