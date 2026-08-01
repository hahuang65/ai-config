---
name: merge
description: Integrate the current managed Treehouse task through the installed fast-forward-only lifecycle CLI, return to the main project directory, and recycle safely. Use when the user explicitly asks to merge, land, or finish a Treehouse task.
argument-hint: "[intent] [--keep]"
---

# Merge

This skill is a thin alias for the Treehouse merge flow.
It owns no Git integration behavior.

Read [../treehouse/references/workflow.md](../treehouse/references/workflow.md) before continuing.

Run Treehouse preflight and require the current checkout to be a managed task worktree.
If the executable is absent or protocol-incompatible, stop with Git dotfiles installation guidance.
If the current checkout is unmanaged, stop rather than guessing an integration target.

Forward `$ARGUMENTS` unchanged to the installed Treehouse merge command through the harness transition described in the workflow reference.
Use Treehouse's returned transition and cleanup operation exactly.
Never fall back to raw Git integration, and never publish remote state.
