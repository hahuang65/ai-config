---
description: Commit when needed, then deliver the active worktree or ordinary branch through project policy
argument-hint: "[worktree-intent] [--keep]"
---

Load and follow the `orchard` skill for its deliver operation, forwarding `$ARGUMENTS` unchanged.

If Orchard returns a structured `needs-commit` outcome, use the supported Orchard protocol to validate it as either the active managed task or ordinary local branch, including the exact checkout path and branch.
Then load and follow the `commit` skill against that already-validated checkout and retry Orchard deliver with the original arguments.
Do not treat the delivery argument as commit scope.
Stop if commit asks for user input, fails, or leaves changes behind.
For every other outcome, follow Orchard's transition or terminal delivery result exactly without reproducing delivery policy in this prompt.
