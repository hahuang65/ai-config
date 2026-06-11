---
description: Create a focused git commit using rules/git-commit.md and ~/.gitmessage
---
Load the commit skill, then commit: $ARGUMENTS

Before staging or committing, read `rules/git-commit.md` and `~/.gitmessage`. Follow the commit skill workflow: inspect status and diffs, choose one logical change, stage explicit paths safely, write the message from the template, and commit with `git commit -F <temp-message-file>` only when the staged set is unambiguous or the user confirms.
